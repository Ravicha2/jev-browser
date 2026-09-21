// jev-browser form-filling loop (issue #6; spec.md "Core decisions" 2 and 4).
//
// First cut: put a supplied value into the right field and stop. Jev picks the
// field and picks which supplied value belongs in it; it never generates the
// value, because it is not trained to generate text. The values are a closed
// set supplied in job.json, and code does the fillInput.
//
// Same loop shape as explore.js, with per-field questions instead of
// `next_target`: one `choice` per fillable field over the supplied values plus
// `none`, and one companion Noul asking whether the goal mentions that field at
// all. A field whose companion Noul reads low is left alone rather than filled
// wrong, and so is a field that answers `none` or picks shakily. An unfilled
// field is a finding; a wrongly filled one is damage.
//
// Submitting is unreachable, not discouraged — and this cut goes one further:
// the loop never clicks anything at all, so no commit-like control can be
// clicked whatever its label. The commit filter (#2) still prunes upstream, and
// the self-check asserts this file's own source contains no click.
//
// Run:   cat scripts/prune.js scripts/fill-form.js | ego-browser nodejs
// Check: node scripts/fill-form.js      (guards and the decider, no browser)
//
// One heredoc per round, one JSON object out. job.json carries the goal, the
// start url, the task space id, `values` — the closed set as { id: value },
// whose ids become the choice criteria — and optionally step_budget (default
// 20) and filled_refs (fields settled by an earlier round). It is written by
// the caller, never by this script. Nothing can be passed in from the caller,
// so the root is derived from HOME, as in skeleton.js.
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

// ---------------------------------------------------------------- pure control

// From explore.js (#11): fragment and a trailing slash are position, not
// identity. A leftover page from an earlier run must not get filled instead of
// the form we were aimed at.
export function matchesStartUrl(observedUrl, startUrl) {
  if (!observedUrl || !startUrl) return false
  const clean = (url) => url.replace(/#.*$/, '').replace(/\/+$/, '') || '/'
  return clean(observedUrl) === clean(startUrl)
}

// The guards. This cut has two: the step budget, and the start-page check the
// caller of the loop performs on the first observation. The repeat-page and
// ping-pong guards of explore.js are not here yet: a fill changes the page it
// acts on by definition, so a fingerprint seen twice means something else and
// the zero-fill exit below converges the loop first.
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
    page_fingerprint: state?.fingerprint ?? null,
    ...extra,
  }
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
  const values = capValues(job.values)
  if (!values) {
    return exitObject({
      status: 'escalate',
      reason: 'no_values',
      extra: {
        goal: job.goal,
        detail: 'job.values must be a non-empty object of { id: value } strings',
      },
    })
  }
  const valueIds = Object.keys(values)
  const key = await readKey()
  const budget = job.step_budget ?? STEP_BUDGET

  // Fields settled by an earlier round — filled, or found broken — so a resumed
  // run neither refills nor re-hammers them. The caller persists these from the
  // exit object when it rewrites job.json.
  const settledRefs = new Set(job.filled_refs ?? [])
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

  while (true) {
    steps += 1
    const observed = await observe()

    const stop = preflight({ step: steps, budget })
    if (stop) {
      return exitObject({
        status: 'escalate',
        reason: stop.reason,
        step: steps,
        state: observed,
        extra: { goal: job.goal, filled, unfilled },
      })
    }

    // Ask only about what is still open. Fields dropped since last round are
    // the ones code settled; the loop converges when none remain.
    const fields = observed.fields.filter((field) => !settledRefs.has(field.ref))
    if (fields.length === 0) {
      return exitObject({
        status: 'done',
        step: steps,
        state: observed,
        extra: {
          goal: job.goal,
          filled,
          unfilled,
          filled_refs: [...settledRefs],
          task_space_id: task.id,
        },
      })
    }

    const questions = buildQuestions(fields, valueIds)
    const state = fitState({
      goal: job.goal,
      current_page: observed.pageText.slice(0, MAX_PAGE_CHARS),
      supplied_values: values,
    }, questions)

    const response = await ask({ model: MODEL, state, questions }, key)
    tally(response)

    const decisions = decideFields(response, fields, valueIds)
    const fillDecisions = decisions.filter((decision) => decision.action === 'fill')

    const escalateReason = escalationReason(decisions)
    if (escalateReason) {
      return exitObject({
        status: 'escalate',
        reason: escalateReason,
        step: steps,
        state: observed,
        extra: {
          goal: job.goal,
          filled,
          unfilled,
          detail: 'every field came back malformed; nothing was filled',
        },
      })
    }

    // Nothing decided this step is convergence, not failure: Jev is stateless,
    // so a second ask over the same page and the same goal returns the same
    // skips. Report what was filled and what was left alone, and stop before
    // any submit. A multi-step form that reveals new fields after a fill is the
    // reason this is checked per step and not up front — a fill is exactly what
    // happened before this branch can be reached.
    if (fillDecisions.length === 0) {
      for (const decision of decisions) {
        unfilled.push({ ref: decision.ref, label: decision.label, reason: decision.reason })
      }
      return exitObject({
        status: 'done',
        step: steps,
        state: observed,
        extra: {
          goal: job.goal,
          filled,
          unfilled,
          filled_refs: [...settledRefs],
          task_space_id: task.id,
        },
      })
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
        return exitObject({
          status: 'escalate',
          reason: 'stale_page',
          step: steps,
          state: fresh,
          extra: { goal: job.goal, filled, unfilled },
        })
      }
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
        settledRefs.add(decision.ref)
      } catch (error) {
        // A field that cannot take its value is settled as broken, not retried:
        // hammering a readonly input for the rest of the budget helps nobody.
        unfilled.push({
          ref: decision.ref,
          label: decision.label,
          reason: 'fill_failed',
          detail: String(error && error.message ? error.message : error),
        })
        settledRefs.add(decision.ref)
      }
    }
    // Hydrated forms react to fills (conditional fields, validations); let them
    // settle before the next observation reads the result.
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

  return fields.length
}

// Run locally -> the check. Run inside the heredoc -> the loop, because argv[1]
// there is electron's own path, not ours.
if (process.argv[1] && process.argv[1].endsWith('fill-form.js')) {
  const fieldCount = await runSelfCheck()
  console.log(`fill-form.js self-check ok (guards and the per-field decider checked, ${fieldCount} fillable field in the fixture)`)
} else {
  let result
  try {
    result = await main()
  } catch (error) {
    // One JSON object out, always, even on failure. The message never carries the key.
    result = exitObject({
      status: 'escalate',
      reason: 'error',
      extra: { detail: String(error && error.message ? error.message : error) },
    })
  }
  cliLog(JSON.stringify(result))
}
