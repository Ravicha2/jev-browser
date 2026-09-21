// jev-browser form-filling loop (issues #6 and #7; spec.md "Core decisions" 2
// and 4, "Resume protocol").
//
// Put supplied values into the right fields and stop. Jev picks the field and
// picks which supplied value belongs in it; it never generates the value,
// because it is not trained to generate text. The values are a closed set
// supplied in job.json, and code does the fillInput.
//
// Same loop shape as explore.js, with per-field questions instead of
// `next_target`: one `choice` per fillable field over the supplied values plus
// `none`, and one companion Noul asking whether the goal mentions that field at
// all. A field whose companion Noul reads low is not filled — and since #7 it
// is not silently dropped either: the round exits `needs_input` naming the
// field and what it wants, rather than guessing. Claude Code answers by adding
// the value to `supplied_values` under the field's slug (or an empty string to
// settle the field as intentionally empty), records the ask in
// `visited_fingerprints`, and re-invokes with the same task space id. On the
// resumed round the answer is a direct fill, keyed to the field's own name, no
// Jev judgment on the way: the judgment was Claude Code's when it answered.
//
// The round trip runs entirely through job.json, whose path is absolute and
// derived from HOME — nothing travels through the shell, so a goal string with
// quotes, backticks, or newlines cannot break the invocation, and the
// self-check asserts the source can reach no shell at all. ego-browser resumes
// the task space, so page state survives between rounds.
//
// Submitting is unreachable, not discouraged — and this loop goes one further:
// it never clicks anything at all, so no commit-like control can be clicked
// whatever its label. The commit filter (#2) still prunes upstream, and the
// self-check asserts this file's own source contains no click.
//
// Run:   cat scripts/prune.js scripts/ledger.js scripts/fill-form.js | ego-browser nodejs
// Check: node scripts/fill-form.js      (guards and the decider, no browser)
//
// One heredoc per round, one JSON object out. job.json carries task_space_id,
// goal, start_url, supplied_values (the closed set as { id: value }, whose ids
// become the choice criteria), step_budget (default 20), settled_refs (fields
// an earlier round filled or settled), visited_fingerprints (needs_input asks
// already answered, as `<fingerprint>:<field>`), and escalated_fingerprints
// (fingerprints this task has escalated on). It is written by the caller,
// never by this script. Nothing can be passed in from the caller, so the root
// is derived from HOME, as in skeleton.js.
//
// The browser work and the control flow are deliberately separated, as in
// explore.js: everything that decides is a pure function, so every guard and
// every exit is checkable from the self-check at the bottom without opening a
// browser.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
// Pinned with explore.js (#10): the gate reads the model off the trail, and an
// alias that moves would make it unreadable.
const MODEL = 'jev-1.13.0'

// spec.md "Confidence". A field is filled only when its companion Noul says the
// goal mentions it AND the choice is a confident single argmax over the closed
// set. Everything else is left alone and reported.
const FIELD_STATED_NOUL = 0.5 // < the field is left alone, whatever the choice says
const FIELD_CONFIDENCE = 0.5 // < the pick is shaky, so it is left alone

// The skip reasons a caller can answer with a value (#7). `invalid_response` is
// the system failing, not a value missing, and a fill that threw is a broken
// field, not a question — neither becomes a needs_input.
const WANTS_VALUE = new Set(['not_stated', 'no_value', 'low_confidence'])

// The platform allows 255 choice options; `none` takes one seat.
const MAX_VALUES = 254
const NO_ANSWER = 'none'

// A Choice answer is only used after it validates, exactly as in explore.js:
// the chosen id must be one of the ids we offered, the probability keys must be
// exactly that set, every number finite and within 0..1, the total within 0.02
// of 1, and the argmax the chosen id. Anything else and nothing fills.
const PROBABILITY_SUM_TOLERANCE = 0.02

// spec.md "The step loop": 20 steps for form filling.
const STEP_BUDGET = 20
const STALE_LIMIT = 2 // a decision invalidated twice by a moved page

// state is capped at 32k including the longest question, so shave before sending.
const MAX_PAGE_CHARS = 12000
const SHORT_PAGE_CHARS = 3000
const SHORT_VALUES = 10
const MAX_REQUEST_CHARS = 28000

// Page load is usually the real bottleneck, so this is generous on purpose.
const SETTLE_SECONDS = 2

// Roles code can fillInput. First cut is text-shaped fields only: checkboxes
// and radios are clicks, which this loop does not do, and comboboxes have no
// `select` on this platform (spec.md, platform facts).
const FILLABLE_ROLES = new Set(['textbox', 'searchbox'])

const fs = await import('node:fs')
const HOME = process.env.HOME || ''

// The skill root, found rather than passed. The installed skill wins once it
// exists; the repo checkout is the fallback so this runs before packaging.
const ROOTS = [`${HOME}/.claude/skills/jev-browser`, `${HOME}/AgentOS/jev-browser`]
const ROOT = ROOTS.find((candidate) => fs.existsSync(`${candidate}/.env`)) || null

// Fixed, and it has to be: the caller cannot name a path, and one loop runs at a
// time. Not TMPDIR, which the OS reaps, or a login handoff cannot resume after
// an overnight wait. See spec.md Configuration.
const JOB_PATH = `${HOME}/.claude/jev-browser/job.json`
const RUNS_ROOT = `${HOME}/.claude/jev-browser/runs`

// ---------------------------------------------------------------- pure control

// From explore.js (#11): fragment and a trailing slash are position, not
// identity. A leftover page from an earlier run must not get filled instead of
// the form we were aimed at.
export function matchesStartUrl(observedUrl, startUrl) {
  if (!observedUrl || !startUrl) return false
  const clean = (url) => url.replace(/#.*$/, '').replace(/\/+$/, '') || '/'
  return clean(observedUrl) === clean(startUrl)
}

// The guards. The step budget; the ping-pong guards (#7) ride on the lists the
// caller maintains in job.json and fire where the exits are decided. The
// repeat-page guard of explore.js has no seat here: a fill changes the page it
// acts on by definition, and the open-field set shrinks monotonically, so the
// loop converges before a page can repeat.
export function preflight({ step, budget }) {
  if (step > budget) return { reason: 'step_budget' }
  return null
}

// ref -> role, from the same parse prune.js runs. The pruned candidates carry
// no role, so the fillable filter reads it back out of the tree. `parse` is
// prune.js's parseSnapshot, in scope in the heredoc by concatenation and passed
// explicitly by the self-check, which imports prune.js instead.
export function rolesOf(snapshotText, parse = parseSnapshot) {
  const roles = new Map()
  for (const line of parse(snapshotText)) {
    if (line.kind === 'node' && line.ref) roles.set(line.ref, line.role)
  }
  return roles
}

// The fields Jev is asked about: the pruned candidates — so the commit filter,
// the label rule and the dedupe all still apply — narrowed to the roles code
// can fillInput. A submit button is a `button`, never a textbox, so the trust
// boundary holds twice over.
export function fillableFields(candidates, roles) {
  return candidates
    .filter((candidate) => FILLABLE_ROLES.has(roles.get(candidate.ref.slice(1))))
    .map(({ ref, label }) => ({ ref, label }))
}

// Question ids are for code and are not sent to the model, so they are derived
// from the ref and carry no meaning Jev has to honour.
export function questionId(ref) {
  return `field_${ref.slice(1)}`
}

// The supplied values. job.values is the closed set as { id: value }; the ids
// become the choice criteria verbatim, so they are capped at MAX_VALUES and an
// empty or malformed set stops the loop before the first ask — Jev must never
// be asked to make a value up.
export function capValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  const entries = Object.entries(values)
    .filter(([id, value]) => typeof id === 'string' && id.trim() && typeof value === 'string' && value.length > 0)
    .slice(0, MAX_VALUES)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

// The name a `needs_input` exit uses for a field (#7), and the key the caller
// answers it under in `supplied_values`: the label, folded to an id. Two
// same-labelled fields collapse onto one answer on purpose — same label, same
// question.
export function fieldSlug(label) {
  const slug = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'field'
}

// What the exit asks for, assembled in code from the label Jev already read.
// Jev cannot generate text (spec.md, Limits), so the ask is never written by
// the model — the label is page content code copied, exactly like a finding's
// evidence span.
export function wantsFor(label) {
  return `a value for the "${label}" field`
}

// The ping-pong key of a needs_input ask (#7): which field on which page. A
// bare fingerprint cannot tell "the caller's answer did not unblock this
// field" — a ping-pong — from "this page has a second unknown field" — the
// next legitimate question. Keyed by both, so the first repeats and the second
// proceeds.
export function visitedKey(fingerprint, slug) {
  return `${fingerprint}:${slug}`
}

// The direct channel (#7). A supplied value whose id is the field's own slug
// is the caller answering a needs_input — or pre-supplying a known value — so
// it is an answer, not a candidate: the judgment is Claude Code's, and code
// fills it without an ask. An empty string is an explicit "nothing belongs
// here": the field settles without a value, which is how an optional field the
// goal does not need gets out of the loop instead of deadlocking it. Anything
// else under that key — a number, an object — is a malformed answer, not an
// answer, and leaves the field open for the guard to catch the re-ask.
export function answeredFields(fields, suppliedValues) {
  if (!suppliedValues || typeof suppliedValues !== 'object' || Array.isArray(suppliedValues)) return []
  return fields
    .map((field) => {
      const slug = fieldSlug(field.label)
      if (!Object.prototype.hasOwnProperty.call(suppliedValues, slug)) return null
      const value = suppliedValues[slug]
      if (typeof value !== 'string') return null
      return { ...field, slug, value: value.length > 0 ? value : null }
    })
    .filter(Boolean)
}

// Settled by ref — this run's fills; refs belong to a snapshot, so this half
// is best-effort across a re-render — or by slug, which is stable across
// rounds. The loop records both when it fills; the caller settles an optional
// field by its slug alone.
export function isSettled(field, settled) {
  return settled.has(field.ref) || settled.has(fieldSlug(field.label))
}

// The `needs_input` decision (#7), with its guard. The first field whose skip
// is a missing value — companion Noul low, a `none` pick, or a shaky pick —
// names the exit: the caller can answer exactly that, so asking is cheaper
// than guessing. If this same ask was already answered once (the key is in
// `visited_fingerprints`), asking again is a ping-pong, and the exit escalates
// instead. A skip the system caused (`invalid_response`) is never a question
// for the caller.
export function needsInputFor(decisions, fingerprint, visited) {
  const wanted = decisions.filter((decision) => decision.action === 'skip' && WANTS_VALUE.has(decision.reason))
  if (wanted.length === 0) return null
  const field = wanted[0]
  const slug = fieldSlug(field.label)
  const key = visitedKey(fingerprint, slug)
  if (visited.has(key)) return { field: slug, key, pingPong: true }
  return { field: slug, wants: wantsFor(field.label), key }
}

// The escalate half of the ping-pong guard (#7): a resumed round refuses to
// escalate a second time on a fingerprint the caller already recorded in
// `escalated_fingerprints` — it appends the exit's `page_fingerprint` when it
// rewrites job.json, which the loop never writes. The repeat exits `ping_pong`
// so a caller looping on the same page gets one terminal answer instead of the
// same escalation forever; a caller that has genuinely changed the situation
// clears the entry, because the file is its side of the contract.
export function guardEscalate(reason, fingerprint, escalated) {
  if (!reason || !fingerprint || !escalated.has(fingerprint)) return reason
  return 'ping_pong'
}

// The questions. One choice per field over the closed set plus `none`, and one
// companion Noul per field asking whether the goal mentions that field at all —
// the exact shape spec.md gives (`field_vat_number` / `field_vat_number_stated`).
// Each instruction carries its own meaning, as in explore.js.
export function buildQuestions(fields, valueIds) {
  const ids = valueIds.slice(0, MAX_VALUES)
  const questions = {}
  for (const field of fields) {
    const key = questionId(field.ref)
    const criteria = {}
    for (const id of ids) criteria[id] = `The supplied value \`${id}\``
    criteria[NO_ANSWER] = 'No supplied value belongs in this field'
    questions[key] = {
      type: 'choice',
      instructions: `Which supplied value belongs in the "${field.label}" field? Choose \`none\` if none does.`,
      criteria,
    }
    questions[`${key}_stated`] = {
      type: 'noul',
      instructions: `Does \`goal\` mention a "${field.label}" field at all?`,
      criteria: {
        true: 'The goal asks for such a field to be filled',
        false: 'The goal does not mention it',
      },
    }
  }
  return questions
}

// Shave `current_page` first, then the values tail, as explore.js shaves the
// page then the candidate tail: the API rejects the request outright if the
// whole thing is over budget, and losing a value makes its own question
// meaningless, so the page pays first.
export function fitState(state, questions, budget = MAX_REQUEST_CHARS) {
  const size = (candidate) => JSON.stringify({ state: candidate, questions }).length
  if (size(state) <= budget) return state
  const shorter = { ...state, current_page: state.current_page.slice(0, SHORT_PAGE_CHARS) }
  if (size(shorter) <= budget) return shorter
  return {
    ...shorter,
    supplied_values: Object.fromEntries(
      Object.entries(shorter.supplied_values).slice(0, SHORT_VALUES),
    ),
  }
}

// Jev has no structural invariants (spec.md, Limits), so check the shape before
// trusting a number. Same readers as explore.js, inlined: the heredoc runtime
// cannot import explore.js, which is why the loop script is assembled by `cat`.
export function readNoul(response, id) {
  const answer = response?.answers?.[id]
  if (!answer || answer.type !== 'noul') throw new Error(`no noul answer under "${id}"`)
  const value = answer.noul
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`noul "${id}" outside 0..1`)
  }
  return value
}

export function validateChoice(response, id, offeredIds) {
  const answer = response?.answers?.[id]
  if (!answer || answer.type !== 'choice') throw new Error(`no choice answer under "${id}"`)

  const offered = new Set(offeredIds)
  if (!offered.has(answer.choice)) throw new Error(`chose "${answer.choice}", which was not offered`)

  const probabilities = answer.probabilities
  if (!probabilities || typeof probabilities !== 'object') throw new Error('no probabilities')
  const keys = Object.keys(probabilities)
  if (keys.length !== offered.size || keys.some((key) => !offered.has(key))) {
    throw new Error('probability keys are not exactly the offered ids')
  }

  const values = keys.map((key) => probabilities[key])
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('a probability is not a number in 0..1')
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  if (Math.abs(total - 1) > PROBABILITY_SUM_TOLERANCE) throw new Error(`probabilities sum to ${total}`)

  // A tie is not a decision either: the chosen id has to be the single argmax.
  const highest = Math.max(...values)
  const top = keys.filter((key) => probabilities[key] === highest)
  if (top.length !== 1 || top[0] !== answer.choice) throw new Error('argmax is not the chosen id')

  const confidence = answer.confidence
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('confidence is not a number in 0..1')
  }
  return { choice: answer.choice, confidence }
}

// One decision per field, read independently: a malformed answer skips its own
// field and never spills onto the others (spec.md "Confidence": name the single
// thing that is shaky). Nothing here fills; code acts only after the whole list
// comes back read.
export function decideFields(response, fields, valueIds) {
  const offered = [...valueIds.slice(0, MAX_VALUES), NO_ANSWER]
  const decisions = []
  for (const field of fields) {
    const skip = (reason, detail) => decisions.push({
      ...field,
      action: 'skip',
      reason,
      ...(detail ? { detail } : {}),
    })
    const key = questionId(field.ref)

    // The companion Noul is the gate (issue #6): when the goal does not mention
    // the field, the choice is not even read, let alone filled.
    let stated
    try {
      stated = readNoul(response, `${key}_stated`)
    } catch (error) {
      skip('invalid_response', error.message)
      continue
    }
    if (stated < FIELD_STATED_NOUL) {
      skip('not_stated')
      continue
    }

    let pick
    try {
      pick = validateChoice(response, key, offered)
    } catch (error) {
      skip('invalid_response', error.message)
      continue
    }
    if (pick.choice === NO_ANSWER) {
      skip('no_value')
      continue
    }
    if (pick.confidence < FIELD_CONFIDENCE) {
      skip('low_confidence')
      continue
    }
    decisions.push({ ...field, action: 'fill', value_id: pick.choice, confidence: pick.confidence })
  }
  return decisions
}

// Every field coming back malformed is the system failing, not a value being
// unknown: that escalates. A mix still fills the good fields and reports the
// rest as unfilled.
export function escalationReason(decisions) {
  if (decisions.length === 0) return null
  return decisions.every((decision) => decision.reason === 'invalid_response')
    ? 'invalid_response'
    : null
}

// ------------------------------------------------------------------ transport

async function readKey() {
  const text = fs.readFileSync(`${ROOT}/.env`, 'utf8')
  const match = text.match(/^TYPESAFE_API_KEY=(.*)$/m)
  if (!match || !match[1].trim()) throw new Error(`TYPESAFE_API_KEY is missing from ${ROOT}/.env`)
  return match[1].trim()
}

// Retry the two transient statuses the docs name, with backoff, as their own
// clients do. Messages carry the status only: never the key, never the headers.
async function ask(body, key) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    })
    if ([429, 529, 503].includes(response.status) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
      continue
    }
    if (!response.ok) throw new Error(`TypeSafe returned HTTP ${response.status}`)
    return response.json()
  }
  throw new Error('TypeSafe unavailable after 3 attempts')
}

// -------------------------------------------------------------------- browser

// One observation: the page tree, the pruned candidates narrowed to fillable
// fields, and the fingerprint the guards compare. The full tree is the offer,
// as in explore.js (#10): the viewport is not a filter, and a field below the
// fold still takes its value.
async function observe() {
  const page = await snapshotText()
  const info = await pageInfo()
  if (info.dialog) throw new Error('a native browser dialog is open; the page is blocked')

  const { candidates } = pruneDetail(page, { currentUrl: info.url })
  const fields = fillableFields(candidates, rolesOf(page))

  return {
    url: info.url,
    sy: info.sy,
    pageText: page,
    fields,
    fingerprint: await pageFingerprint(info.url, candidates),
  }
}

// The round's token totals and the model that answered, as in explore.js.
const usageTotal = { requests: 0 }
let modelSeen = null

// The run directory of the live round (#9), set once main has resolved it. The
// run directory is the task's, not the explore loop's: a form round resumed
// after a needs_input addresses the same directory the collection ran in.
let ACTIVE_RUN = null

function tally(response) {
  usageTotal.requests += 1
  modelSeen = response.model ?? modelSeen
  for (const [key, value] of Object.entries(response.usage ?? {})) {
    if (typeof value === 'number') usageTotal[key] = (usageTotal[key] ?? 0) + value
  }
}

function exitObject({ status, reason, detail, step, state, extra = {} }) {
  return {
    status,
    usage_total: usageTotal,
    step_count: step ?? 0,
    ...(modelSeen ? { model: modelSeen } : {}),
    ...(reason ? { reason } : {}),
    ...(detail ? { detail } : {}),
    ...(state?.url ? { url: state.url } : {}),
    // The caller records this when it rewrites job.json: into
    // `escalated_fingerprints` on an escalate, into `visited_fingerprints` as
    // `<fingerprint>:<field>` on a needs_input. That is what lets the next
    // round refuse to repeat either one on the same page (#7).
    page_fingerprint: state?.fingerprint ?? null,
    // The run artifacts (#9): `run_dir` goes back into job.json, and round N+1
    // appends to the same trace (and the same ledger, when a collection ran in
    // this task). A round that exited before the directory existed collected
    // nothing, so it names none.
    ...(ACTIVE_RUN ? { run_dir: ACTIVE_RUN.dir, ledger: ACTIVE_RUN.ledger, trace: ACTIVE_RUN.trace } : {}),
    ...extra,
  }
}

// The needs_input exit (#7), shared by every path that ends up needing a value
// from the caller: a companion Noul that read low, a `none` pick, a shaky pick,
// or no `supplied_values` at all. One field per round — the caller answers it
// and re-invokes, so a many-field form converges over rounds — and every exit
// carries `settled_refs` so the caller persists the round's progress when it
// rewrites the job. Guarded: the same ask on the same page twice is a
// ping-pong, and it escalates instead of asking forever. Callers of this
// helper only reach it with at least one missing-value skip, so `ask` is
// non-null by construction (the self-check pins that invariant).
function needsInputExit(decisions, observed, context, visited) {
  const ask = needsInputFor(decisions, observed.fingerprint, visited)
  const unfilled = decisions.map(({ ref, label, reason }) => ({ ref, label, reason }))
  // Whatever a collection in this task already gathered rides out on every
  // exit (#9), so a form round cannot orphan it.
  const partial = { partial_findings: context.partialFindings ?? [] }
  if (ask.pingPong) {
    return exitObject({
      status: 'escalate',
      reason: 'ping_pong',
      step: context.steps,
      state: observed,
      extra: {
        goal: context.goal,
        filled: context.filled,
        unfilled,
        ...partial,
        settled_refs: [...context.settled],
        task_space_id: context.taskSpaceId,
        detail: `${ask.field} was already asked for on this page and the answer did not unblock it`,
      },
    })
  }
  return exitObject({
    status: 'needs_input',
    step: context.steps,
    state: observed,
    extra: {
      field: ask.field,
      wants: ask.wants,
      goal: context.goal,
      filled: context.filled,
      unfilled,
      ...partial,
      settled_refs: [...context.settled],
      task_space_id: context.taskSpaceId,
    },
  })
}

async function main() {
  if (!ROOT) {
    return exitObject({
      status: 'escalate',
      reason: 'skill_root_not_found',
      extra: { partial_findings: ROOTS.map((root) => `tried ${root}`) },
    })
  }

  const job = JSON.parse(fs.readFileSync(JOB_PATH, 'utf8'))
  // The supplied values, raw and capped. A missing `supplied_values` is round 1
  // of a task whose values are not known yet — the needs_input flow exists for
  // exactly that (#7) — but a malformed one is a caller bug, and it stops
  // before the first ask. Empty-string entries never reach Jev (capValues
  // drops them) and only ever act through the direct channel, where they
  // settle a field as intentionally empty.
  const raw = job.supplied_values
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return exitObject({
      status: 'escalate',
      reason: 'no_values',
      extra: {
        goal: job.goal,
        detail: 'job.supplied_values must be an object of { id: value } strings',
      },
    })
  }
  const supplied = raw ?? {}
  const values = capValues(supplied)
  const valueIds = values ? Object.keys(values) : []
  const key = await readKey()
  const budget = job.step_budget ?? STEP_BUDGET

  // The run directory (#9), shared with the task's other rounds: reused when
  // the caller recorded `run_dir` from the last exit — that is the round trip
  // of a needs_input — created fresh on round 1. The ledger is read once and
  // rides out on every exit, so a collection that ran earlier in this task is
  // never orphaned by the form rounds.
  const run = resolveRunDir(job, {
    runsRoot: RUNS_ROOT,
    exists: (path) => fs.existsSync(path),
    mkdirp: (path) => fs.mkdirSync(path, { recursive: true }),
  })
  ACTIVE_RUN = run
  const partialFindings = readFindings(run.ledger)

  // Cross-round guard state, carried in job.json and written only by the
  // caller (#7): `visited_fingerprints` holds the `<fingerprint>:<field>` keys
  // of needs_input asks already answered once, `escalated_fingerprints` the
  // fingerprints this task has escalated on. The resumed round reads both, so
  // the ping-pong guard works across the resume boundary, not just within one.
  const visited = new Set(job.visited_fingerprints ?? [])
  const escalated = new Set(job.escalated_fingerprints ?? [])

  // Fields settled by an earlier round — filled by the loop (recorded by ref
  // and by slug), or settled without a value by the caller under the field's
  // slug — so a resumed run neither refills nor re-asks them. The caller
  // persists these from the exit object when it rewrites job.json.
  const settled = new Set(job.settled_refs ?? [])
  const filled = []
  const unfilled = []

  const task = await useOrCreateTaskSpace(job.task_space_id)
  await openOrReuseTab(job.start_url, { wait: true, timeout: 20 })
  // Verified, not assumed (#11): a leftover tab from an earlier run would get
  // filled instead of the form we were aimed at. One deliberate re-aim, then a
  // loud refusal.
  const tabUrl = async () => (await pageInfo().catch(() => ({}))).url
  if (!matchesStartUrl(await tabUrl(), job.start_url)) {
    await gotoAndWait(job.start_url, { timeout: 20 })
    if (!matchesStartUrl(await tabUrl(), job.start_url)) {
      return exitObject({
        status: 'escalate',
        reason: 'start_url_mismatch',
        extra: {
          goal: job.goal,
          detail: `the tab is at ${JSON.stringify((await tabUrl()) ?? 'unknown')}, not ${job.start_url}`,
        },
      })
    }
  }

  let steps = 0
  let stale = 0
  // Per-step trace state (#9): one line per step, written when the step's
  // outcome is known. The form loop scrolls never, so `page_changed` is the
  // fingerprint alone (epsilon 0).
  let prevTracePoint = null

  while (true) {
    steps += 1
    const observed = await observe()

    const traceStep = ({ decision, latencyMs = null, usage = null, fields = null }) => {
      if (!ACTIVE_RUN) return
      appendTrace(ACTIVE_RUN.trace, {
        step: steps,
        url: observed.url,
        fingerprint: observed.fingerprint,
        sy: observed.sy,
        page_changed: pageChanged(prevTracePoint, observed, 0),
        decision,
        ...(fields ? { fields } : {}),
        latency_ms: latencyMs,
        usage,
        model: modelSeen,
      })
      prevTracePoint = { fingerprint: observed.fingerprint, sy: observed.sy }
    }
    // An exit is the step's outcome too: the trace names it before the object
    // goes out, so the file reads as the round's whole story.
    const emit = (exit, { latencyMs = null, usage = null, fields = null } = {}) => {
      traceStep({
        decision: exit.status === 'done'
          ? 'done'
          : `${exit.status}:${exit.reason ?? exit.field ?? ''}`,
        latencyMs,
        usage,
        fields,
      })
      return exit
    }

    const stop = preflight({ step: steps, budget })
    if (stop) {
      const reason = guardEscalate(stop.reason, observed.fingerprint, escalated)
      return emit(exitObject({
        status: 'escalate',
        reason,
        step: steps,
        state: observed,
        extra: {
          goal: job.goal,
          filled,
          unfilled,
          partial_findings: partialFindings,
          settled_refs: [...settled],
          task_space_id: task.id,
          ...(reason === 'ping_pong' ? { detail: `${stop.reason} escalated on this page once before` } : {}),
        },
      }))
    }

    // Ask and fill only what is still open. Fields dropped since last round
    // are the ones code settled; the loop converges when none remain.
    const open = observed.fields.filter((field) => !isSettled(field, settled))
    if (open.length === 0) {
      return emit(exitObject({
        status: 'done',
        step: steps,
        state: observed,
        extra: {
          goal: job.goal,
          filled,
          unfilled,
          partial_findings: partialFindings,
          settled_refs: [...settled],
          task_space_id: task.id,
        },
      }))
    }

    // The direct channel (#7): answers the caller keyed to the field's own
    // slug. Code fills them before any ask, because the judgment was Claude
    // Code's when it answered the needs_input — asking Jev to re-approve it
    // would hand the caller's answer back to the companion Noul that read low
    // and ping-pong forever. The fills happen straight off this step's
    // observation with no await in between, so the refs are the ones the
    // snapshot just read; the freshness re-observe below stays reserved for
    // decisions that crossed an API round trip.
    const answered = answeredFields(open, supplied)
    if (answered.length > 0) {
      for (const answer of answered) {
        // An explicitly empty answer settles the field as intentionally empty:
        // the caller was asked, and the answer was "nothing belongs here".
        if (answer.value === null) {
          settled.add(answer.slug)
          unfilled.push({ ref: answer.ref, label: answer.label, reason: 'settled_empty' })
          continue
        }
        try {
          await fillInput(answer.ref, answer.value)
          filled.push({ step: steps, ref: answer.ref, label: answer.label, value: answer.value, via: 'supplied' })
          settled.add(answer.ref)
          settled.add(answer.slug)
        } catch (error) {
          // Settled as broken, exactly like a failed Jev-driven fill: do not
          // hammer a field that refused its value.
          unfilled.push({
            ref: answer.ref,
            label: answer.label,
            reason: 'fill_failed',
            detail: String(error && error.message ? error.message : error),
          })
          settled.add(answer.ref)
          settled.add(answer.slug)
        }
      }
      // Hydrated forms react to fills (conditional fields, validations); let
      // them settle before the next observation reads the result, exactly as
      // after a Jev-driven fill.
      traceStep({ decision: `direct_fill:${answered.map((answer) => answer.slug).join('+')}` })
      await wait(SETTLE_SECONDS)
      continue
    }

    // No values to offer, no question to ask (#7): every open field is a value
    // only the caller can name. Same exit a low companion Noul would produce,
    // under the same guard.
    if (valueIds.length === 0) {
      return emit(needsInputExit(
        open.map((field) => ({ ...field, action: 'skip', reason: 'no_value' })),
        observed,
        { steps, goal: job.goal, filled, unfilled, settled, taskSpaceId: task.id, partialFindings },
        visited,
      ))
    }

    const questions = buildQuestions(open, valueIds)
    const state = fitState({
      goal: job.goal,
      current_page: observed.pageText.slice(0, MAX_PAGE_CHARS),
      supplied_values: values,
    }, questions)

    const startedAt = Date.now()
    const response = await ask({ model: MODEL, state, questions }, key)
    const latencyMs = Date.now() - startedAt
    tally(response)

    const decisions = decideFields(response, open, valueIds)
    const fillDecisions = decisions.filter((decision) => decision.action === 'fill')
    const fieldsTrace = decisions.map(({ ref, action, reason, value_id: valueId }) => (
      action === 'fill' ? { ref, action, value_id: valueId } : { ref, action, reason }
    ))

    const escalateReason = guardEscalate(escalationReason(decisions), observed.fingerprint, escalated)
    if (escalateReason) {
      return emit(exitObject({
        status: 'escalate',
        reason: escalateReason,
        step: steps,
        state: observed,
        extra: {
          goal: job.goal,
          filled,
          unfilled,
          partial_findings: partialFindings,
          settled_refs: [...settled],
          task_space_id: task.id,
          detail: escalateReason === 'ping_pong'
            ? 'invalid_response escalated on this page once before'
            : 'every field came back malformed; nothing was filled',
        },
      }), { latencyMs, usage: response.usage ?? null, fields: fieldsTrace })
    }

    // Nothing decided this step is not failure but a question (#7): the skips
    // name the values the caller has to supply, one per round, instead of a
    // silent `done` over fields the form still needs. A multi-step form that
    // reveals new fields after a fill is the reason this is checked per step
    // and not up front — a fill is exactly what happened before this branch
    // can be reached.
    if (fillDecisions.length === 0) {
      return emit(needsInputExit(
        decisions,
        observed,
        { steps, goal: job.goal, filled, unfilled, settled, taskSpaceId: task.id, partialFindings },
        visited,
      ), { latencyMs, usage: response.usage ?? null, fields: fieldsTrace })
    }

    // Act on fresh eyes only (spec.md "Freshness"): the page is re-observed and
    // the decisions are discarded if it moved between the ask and the fill. A
    // stale ref would put a value in the wrong field, so this is a safety
    // property, not just an accuracy one. The discard counts against the step
    // budget: a page fighting the loop is an answer, not a reason to spin.
    const fresh = await observe()
    if (fresh.fingerprint !== observed.fingerprint) {
      stale += 1
      if (stale > STALE_LIMIT) {
        const reason = guardEscalate('stale_page', fresh.fingerprint, escalated)
        return emit(exitObject({
          status: 'escalate',
          reason,
          step: steps,
          state: fresh,
          extra: {
            goal: job.goal,
            filled,
            unfilled,
            partial_findings: partialFindings,
            settled_refs: [...settled],
            task_space_id: task.id,
            ...(reason === 'ping_pong' ? { detail: 'stale_page escalated on this page once before' } : {}),
          },
        }), { latencyMs, usage: response.usage ?? null, fields: fieldsTrace })
      }
      traceStep({ decision: 'stale', latencyMs, usage: response.usage ?? null, fields: fieldsTrace })
      continue
    }
    stale = 0

    // Consume the decisions before any mutation: each ref is filled exactly
    // once, so a fill that throws cannot be retried into a double-fill.
    for (const decision of fillDecisions) {
      try {
        await fillInput(decision.ref, values[decision.value_id])
        filled.push({
          step: steps,
          ref: decision.ref,
          label: decision.label,
          value_id: decision.value_id,
        })
        settled.add(decision.ref)
        settled.add(fieldSlug(decision.label))
      } catch (error) {
        // A field that cannot take its value is settled as broken, not retried:
        // hammering a readonly input for the rest of the budget helps nobody.
        unfilled.push({
          ref: decision.ref,
          label: decision.label,
          reason: 'fill_failed',
          detail: String(error && error.message ? error.message : error),
        })
        settled.add(decision.ref)
        settled.add(fieldSlug(decision.label))
      }
    }
    // Hydrated forms react to fills (conditional fields, validations); let them
    // settle before the next observation reads the result.
    traceStep({ decision: `fill:${fillDecisions.map((decision) => decision.ref).join('+')}`, latencyMs, usage: response.usage ?? null, fields: fieldsTrace })
    await wait(SETTLE_SECONDS)
  }
}

// ------------------------------------------------------------------ self-check

async function runSelfCheck() {
  const assert = (await import('node:assert/strict')).default
  // prune.js travels with this file in the heredoc by concatenation; under node
  // it is imported, which is what makes the fixture check runnable without a
  // browser.
  const prune = await import(new URL('./prune.js', import.meta.url).href)

  // The fixture form has a visible submit button, a "Buy now", a "Send" and an
  // unsubscribe link. Exactly one fillable field survives: the labelled VAT
  // textbox. The label-less searchbox (@31) is dropped by prune's label rule,
  // and the four commit-like controls never reach the list at all.
  const fixture = fs.readFileSync(new URL('./fixtures/snapshot.txt', import.meta.url), 'utf8')
  const detail = prune.pruneDetail(fixture, {})
  const fields = fillableFields(detail.candidates, rolesOf(fixture, prune.parseSnapshot))
  assert.deepEqual(fields, [{ ref: '@20', label: 'VAT number' }], 'the fixture form has one fillable field')
  assert.ok(!fields.some((field) => field.ref === '@21'), 'the submit button is not a field')

  // The structural guarantee of this cut: the loop never clicks anything, so no
  // commit-like control can ever be clicked, whatever its label. Checked
  // against this file's own source.
  const source = fs.readFileSync(new URL(import.meta.url), 'utf8')
  assert.ok(!/(?<![A-Za-z])click\(/.test(source), 'the fill loop contains a click')
  assert.equal(detail.commitCount, 4, 'the commit filter still fired upstream')

  // The shell guarantee (#7): nothing travels through a shell, so a goal with
  // quotes, backticks, or newlines cannot break the invocation. The only way
  // this runtime can reach a shell is node's child process module; the module
  // name below is assembled from pieces so the check does not find itself.
  // (The exit object still goes out through cliLog, which writes stderr — a
  // caller capturing stdout reads nothing, per spec.md platform facts.)
  assert.ok(!source.includes('child_' + 'process'), 'the loop can reach no shell: goal and answer travel in job.json only')

  // The closed set. The choice criteria are exactly the supplied value ids plus
  // `none` — never free text, never a value Jev could echo back as an answer.
  const values = capValues({ vat_number: 'GB 123 4567 89', company_name: 'Acme Ltd', gap: '' })
  assert.deepEqual(Object.keys(values), ['vat_number', 'company_name'], 'an empty value is not a choice')
  assert.equal(capValues(null), null, 'no values, no loop')
  assert.equal(capValues(['a']), null, 'an array is not the closed-set shape')
  const manyValues = capValues(Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`v${index}`, 'x'])))
  assert.equal(Object.keys(manyValues).length, MAX_VALUES, 'the 255-option ceiling holds')

  const valueIds = Object.keys(values)
  const questions = buildQuestions(fields, valueIds)
  assert.equal(questions.field_20.type, 'choice', 'one choice per field')
  assert.deepEqual(
    Object.keys(questions.field_20.criteria).sort(),
    ['company_name', 'none', 'vat_number'],
    'criteria are the supplied values plus none, never free text',
  )
  assert.equal(questions.field_20_stated.type, 'noul', 'one companion Noul per field')
  assert.equal(questions.field_20_stated.instructions, 'Does `goal` mention a "VAT number" field at all?')
  const capped = buildQuestions(fields, Object.keys(manyValues))
  assert.equal(Object.keys(capped.field_20.criteria).length, MAX_VALUES + 1, 'criteria capped with none')

  // The request shaves the page first, then the values tail.
  const state = { goal: 'g', current_page: 'p'.repeat(MAX_PAGE_CHARS), supplied_values: values }
  assert.equal(fitState(state, questions), state, 'a fitting request is untouched')
  const huge = { ...state, current_page: 'p'.repeat(40000) }
  assert.ok(JSON.stringify(fitState(huge, questions)).length < JSON.stringify(huge).length, 'shaved')

  // Answer reading. One good response, then one skip reason at a time; nothing
  // but the good one fills.
  const noul = (value) => ({ type: 'noul', noul: value })
  const response = (statedValue, choice = {}) => ({
    model: 'jev-test',
    answers: {
      field_20_stated: noul(statedValue),
      field_20: {
        type: 'choice',
        choice: 'vat_number',
        confidence: 0.9,
        probabilities: { vat_number: 0.85, company_name: 0.1, none: 0.05 },
        ...choice,
      },
    },
  })
  const decided = (statedValue, choice) => decideFields(response(statedValue, choice), fields, valueIds)[0]

  assert.deepEqual(
    decided(0.9),
    { ref: '@20', label: 'VAT number', action: 'fill', value_id: 'vat_number', confidence: 0.9 },
    'a clean fill',
  )
  // The companion Noul is the gate: low means the field is left alone without
  // the choice even being read.
  assert.equal(decided(0.3).action, 'skip', 'a field the goal does not mention')
  assert.equal(decided(0.3).reason, 'not_stated')
  assert.equal(decided(0.5).action, 'fill', 'the threshold itself is stated')

  const noneChoice = { choice: 'none', probabilities: { vat_number: 0.1, company_name: 0.1, none: 0.8 } }
  assert.equal(decided(0.9, noneChoice).reason, 'no_value', 'no supplied value belongs there')
  const shaky = {
    confidence: 0.3,
    probabilities: { vat_number: 0.5, company_name: 0.3, none: 0.2 },
  }
  assert.equal(decided(0.9, shaky).reason, 'low_confidence', 'a shaky pick is left alone')

  // Every Choice rejection is a skip, never a fill: wrong id, wrong key set,
  // a tie, a bad sum, a non-finite number, no probabilities, a bad Noul.
  const skips = (choice, message) => {
    const decision = decided(0.9, choice)
    assert.equal(decision.action, 'skip', message)
    assert.equal(decision.reason, 'invalid_response', message)
  }
  skips({ choice: 'vat_9' }, 'an id we never offered')
  skips({ probabilities: { vat_number: 0.9, none: 0.1 } }, 'a missing id in the keys')
  skips(
    { probabilities: { vat_number: 0.4, company_name: 0.4, none: 0.2 } },
    'a tie, not a decision',
  )
  skips({ probabilities: { vat_number: 0.9, company_name: 0.2, none: 0.1 } }, 'a sum over 1')
  skips({ probabilities: { vat_number: Number.NaN, company_name: 0.05, none: 0.05 } }, 'a non-finite probability')
  skips({ probabilities: undefined }, 'no probabilities at all')
  skips({ confidence: 2 }, 'a confidence outside 0..1')
  skips(
    { confidence: 0.9, probabilities: { vat_number: 0.8, company_name: 0.05, none: 0.05 } },
    'a sum under tolerance',
  )
  const badNoul = decided('yes', { choice: 'vat_number' })
  assert.equal(badNoul.reason, 'invalid_response', 'a malformed Noul is not a number we can threshold')

  // Per-field isolation, and the escalation rule: every field invalid is the
  // system failing; a mix still fills the good one.
  const twoFields = [{ ref: '@20', label: 'A' }, { ref: '@31', label: 'B' }]
  const mixed = decideFields(
    {
      answers: {
        field_20_stated: noul(0.9),
        field_20: { type: 'choice', choice: 'vat_number', confidence: 0.9, probabilities: { vat_number: 0.85, company_name: 0.1, none: 0.05 } },
        field_31_stated: noul(0.9),
        field_31: { type: 'choice', choice: 'made_up', confidence: 0.9, probabilities: { vat_number: 0.85, company_name: 0.1, none: 0.05 } },
      },
    },
    twoFields,
    valueIds,
  )
  assert.equal(mixed[0].action, 'fill', 'the good field still fills')
  assert.equal(mixed[1].reason, 'invalid_response', 'the bad field only skips itself')
  assert.equal(escalationReason(mixed), null, 'a mix is not an escalation')
  assert.equal(
    escalationReason([{ reason: 'invalid_response' }, { reason: 'invalid_response' }]),
    'invalid_response',
    'every field invalid is the system failing',
  )
  assert.equal(escalationReason([]), null, 'no fields, no escalation')

  // ---- the needs_input round trip (#7) ----

  // The name the exit uses, and the key the caller answers under: the label
  // folded to a slug, stable across rounds even when refs renumber.
  assert.equal(fieldSlug('VAT number'), 'vat_number', 'a label folds to an id')
  assert.equal(fieldSlug('  Company (No.)  '), 'company_no', 'punctuation collapses to one separator')
  assert.equal(fieldSlug(''), 'field', 'an empty label still names something')
  assert.equal(wantsFor('VAT number'), 'a value for the "VAT number" field', 'the ask is assembled, not generated')
  assert.equal(visitedKey('a1b2c3', 'vat_number'), 'a1b2c3:vat_number', 'a ping-pong key names the field on the page')

  // The direct channel: a value keyed to the field's own slug is the caller's
  // answer, filled without an ask; an empty string settles the field as
  // intentionally empty; anything else is not an answer.
  assert.deepEqual(
    answeredFields(fields, { vat_number: 'GB 123 4567 89', other_id: 'x' }),
    [{ ref: '@20', label: 'VAT number', slug: 'vat_number', value: 'GB 123 4567 89' }],
    'a value keyed to the slug is a direct answer',
  )
  assert.deepEqual(
    answeredFields(fields, { vat_number: '' }),
    [{ ref: '@20', label: 'VAT number', slug: 'vat_number', value: null }],
    'an empty string settles the field without a value',
  )
  assert.deepEqual(answeredFields(fields, { other_id: 'x' }), [], 'an unrelated id is not an answer')
  assert.deepEqual(answeredFields(fields, { vat_number: 42 }), [], 'a non-string answer is not an answer')
  assert.deepEqual(answeredFields(fields, null), [], 'no supplied values, no answers')

  // Settling, by ref for this run's fills and by slug for anything that must
  // survive a re-render or a round boundary.
  assert.equal(isSettled({ ref: '@20', label: 'VAT number' }, new Set(['@20'])), true, 'settled by ref')
  assert.equal(isSettled({ ref: '@20', label: 'VAT number' }, new Set(['vat_number'])), true, 'settled by slug')
  assert.equal(isSettled({ ref: '@20', label: 'VAT number' }, new Set()), false, 'unsettled')

  // The needs_input decision: the first missing-value skip names the exit; a
  // malformed skip is the system failing and never becomes a question; a fill
  // asks for nothing.
  const skipDecisions = [
    { ref: '@20', label: 'VAT number', action: 'skip', reason: 'not_stated' },
    { ref: '@31', label: 'Company number', action: 'skip', reason: 'invalid_response' },
  ]
  assert.deepEqual(
    needsInputFor(skipDecisions, 'fp1', new Set()),
    { field: 'vat_number', wants: 'a value for the "VAT number" field', key: 'fp1:vat_number' },
    'the first answerable field names the exit',
  )
  const repeated = needsInputFor(skipDecisions, 'fp1', new Set(['fp1:vat_number']))
  assert.equal(repeated.pingPong, true, 'the same ask twice is a ping-pong')
  assert.equal(repeated.field, 'vat_number', 'the ping-pong still says which field stalled')
  assert.equal(
    needsInputFor([{ ref: '@1', label: 'X', action: 'skip', reason: 'invalid_response' }], 'fp', new Set()),
    null,
    'a malformed answer is not a question for the caller',
  )
  assert.equal(needsInputFor([{ ref: '@1', label: 'X', action: 'fill' }], 'fp', new Set()), null, 'a fill asks for nothing')
  // A second unknown field on the same page is a new key, so it still asks:
  // the flat fingerprint could not tell this from the ping-pong above.
  assert.equal(
    needsInputFor(
      [{ ref: '@40', label: 'Company number', action: 'skip', reason: 'no_value' }],
      'fp1',
      new Set(['fp1:vat_number']),
    ).field,
    'company_number',
    'a different field on the same page is the next question, not a ping-pong',
  )

  // The escalate half of the guard: a fingerprint already recorded escalates
  // `ping_pong` instead of the same escalation forever; a first one keeps its
  // reason; nothing escalates, nothing guards.
  assert.equal(guardEscalate('stale_page', 'fp9', new Set()), 'stale_page', 'a first escalation keeps its reason')
  assert.equal(guardEscalate('stale_page', 'fp9', new Set(['fp9'])), 'ping_pong', 'a repeat escalation converges')
  assert.equal(guardEscalate(null, 'fp9', new Set(['fp9'])), null, 'no escalation, no guard')
  assert.equal(guardEscalate('stale_page', null, new Set(['fp9'])), 'stale_page', 'no fingerprint, no guard')

  // needs_input and escalate stay distinct, in the exit objects themselves:
  // needs_input names a field the caller can answer and carries no reason;
  // escalate carries a reason from the closed vocabulary and no field.
  const needsExit = needsInputExit(
    skipDecisions,
    { fingerprint: 'fp1', url: 'https://x.io/form' },
    { steps: 2, goal: 'g', filled: [], unfilled: [], settled: [], taskSpaceId: 3 },
    new Set(),
  )
  assert.equal(needsExit.status, 'needs_input', 'a missing value is needs_input')
  assert.equal(needsExit.field, 'vat_number', 'it names the field')
  assert.equal(needsExit.wants, 'a value for the "VAT number" field', 'it says what it wants')
  assert.equal(needsExit.page_fingerprint, 'fp1', 'it carries the fingerprint the caller records')
  assert.equal(needsExit.task_space_id, 3, 'it carries the task space id the caller re-invokes')
  assert.equal(needsExit.reason, undefined, 'and it is not an escalate')
  const pongExit = needsInputExit(
    skipDecisions,
    { fingerprint: 'fp1', url: 'https://x.io/form' },
    { steps: 2, goal: 'g', filled: [], unfilled: [], settled: [], taskSpaceId: 3 },
    new Set(['fp1:vat_number']),
  )
  assert.equal(pongExit.status, 'escalate', 'the repeat is an escalate')
  assert.equal(pongExit.reason, 'ping_pong', 'specifically a ping-pong')
  assert.equal(pongExit.field, undefined, 'and it does not ask again')

  // Criterion 4: a goal string with quotes, backticks, and newlines round-trips
  // unharmed — it lives in job.json, travels in a JSON body, and comes back in
  // the exit object, never once passing through a shell.
  const hostile = 'fill "the VAT" field, `then` say hi;\nnewlines\n$(rm -rf /) ${HOME} `echo pwned`'
  const hostileState = fitState({ goal: hostile, current_page: 'p'.repeat(40), supplied_values: values }, questions)
  const roundTripped = JSON.parse(JSON.stringify({
    status: 'needs_input',
    field: 'vat_number',
    wants: wantsFor('VAT number'),
    goal: hostileState.goal,
    page_fingerprint: 'fp1',
  }))
  assert.equal(roundTripped.goal, hostile, 'the goal survives quotes, backticks, and newlines')
  assert.ok(roundTripped.goal.includes('`then`') && roundTripped.goal.includes('\n'), 'every hostile character intact')
  assert.equal(roundTripped.wants, 'a value for the "VAT number" field', 'the ask rides out next to it')

  // Guards: the budget is 20 by default and a step past it stops.
  assert.equal(STEP_BUDGET, 20)
  assert.equal(preflight({ step: 20, budget: 20 }), null, 'the twentieth step runs')
  assert.equal(preflight({ step: 21, budget: 20 }).reason, 'step_budget', 'the twenty-first does not')

  // The start guard (#11): fragment and trailing slash are position, not
  // identity; a leftover page is not the form we were aimed at.
  assert.equal(matchesStartUrl('https://x.io/form/', 'https://x.io/form'), true, 'a trailing slash is not a page')
  assert.equal(matchesStartUrl('https://x.io/form#top', 'https://x.io/form'), true, 'a fragment is not a page')
  assert.equal(matchesStartUrl('https://x.io/other', 'https://x.io/form'), false, 'a different page is not the start')
  assert.equal(matchesStartUrl(null, 'https://x.io/'), false, 'no observation, no match')

  // Role reading: only text-shaped roles are fillable, straight from the tree.
  const roles = rolesOf(fixture, prune.parseSnapshot)
  assert.equal(roles.get('20'), 'textbox')
  assert.equal(roles.get('21'), 'button', 'the submit control reads as a button')
  assert.equal(fillableFields(detail.candidates, roles).length, 1)

  // ---- the run directory across the needs_input round trip (#9) ----
  // The ledger is the explore loop's payload, but the run directory is the
  // task's: round N+1 after a needs_input reuses the directory the caller
  // recorded from the last exit, so a collection that ran earlier in this task
  // keeps its ledger and its trace.

  const ledger = await import(new URL('./ledger.js', import.meta.url).href)
  const runsRoot = '/tmp/runs-root'
  let madeCalls = 0
  const freshDir = ledger.resolveRunDir({ goal: 'fill the VAT field' }, {
    runsRoot,
    exists: () => false,
    mkdirp: () => { madeCalls += 1 },
  })
  assert.equal(freshDir.reused, false, 'round 1 creates its run directory')
  assert.equal(madeCalls, 1, 'exactly one directory made')
  const resumed = ledger.resolveRunDir(
    { goal: 'fill the VAT field', run_dir: freshDir.dir },
    { runsRoot, exists: () => true, mkdirp: () => { madeCalls += 1 } },
  )
  assert.equal(resumed.dir, freshDir.dir, 'round N+1 after a needs_input addresses the same run directory')
  assert.equal(resumed.ledger, freshDir.ledger, 'so its ledger is the same ledger')
  assert.equal(resumed.trace, freshDir.trace, 'and its trace is the same trace')
  assert.equal(madeCalls, 1, 'reusing makes no directory')
  // A claimed run_dir outside the runs root is a caller bug, not a destination:
  // a fresh directory is made and nothing is redirected.
  const foreign = ledger.resolveRunDir(
    { goal: 'fill the VAT field', run_dir: '/tmp/elsewhere/run' },
    { runsRoot, exists: () => true, mkdirp: () => { madeCalls += 1 } },
  )
  assert.equal(foreign.reused, false, 'a foreign run_dir is refused')
  assert.ok(foreign.dir.startsWith(`${runsRoot}/`), 'and a fresh directory is made under the runs root')

  // needs_input and escalate both carry what the ledger already holds, so a
  // partially completed collection is not discarded across the round trip.
  const withFindings = needsInputExit(
    skipDecisions,
    { fingerprint: 'fp1', url: 'https://x.io/form' },
    { steps: 2, goal: 'g', filled: [], unfilled: [], settled: [], taskSpaceId: 3, partialFindings: [{ id: 'f1', value: 'v' }] },
    new Set(),
  )
  assert.deepEqual(withFindings.partial_findings, [{ id: 'f1', value: 'v' }], 'partial findings ride on a needs_input')
  assert.deepEqual(needsInputExit(
    skipDecisions,
    { fingerprint: 'fp1', url: 'https://x.io/form' },
    { steps: 2, goal: 'g', filled: [], unfilled: [], settled: [], taskSpaceId: 3 },
    new Set(),
  ).partial_findings, [], 'an empty ledger rides as an empty list')

  return fields.length
}

// Run locally -> the check. Run inside the heredoc -> the loop, because argv[1]
// there is electron's own path, not ours.
if (process.argv[1] && process.argv[1].endsWith('fill-form.js')) {
  const fieldCount = await runSelfCheck()
  console.log(`fill-form.js self-check ok (guards, the per-field decider, and the needs_input round trip checked, ${fieldCount} fillable field in the fixture)`)
} else {
  let result
  try {
    result = await main()
  } catch (error) {
    // One JSON object out, always, even on failure. The message never carries
    // the key, and whatever a collection in this task gathered rides out (#9).
    result = exitObject({
      status: 'escalate',
      reason: 'error',
      extra: {
        detail: String(error && error.message ? error.message : error),
        ...(ACTIVE_RUN ? { partial_findings: readFindings(ACTIVE_RUN.ledger) } : {}),
      },
    })
  }
  cliLog(JSON.stringify(result))
}
