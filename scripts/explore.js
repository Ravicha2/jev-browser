// jev-browser explore loop (issue #3, spec.md "The step loop").
//
// Exploratory collection. Snapshot, prune, ask Jev which candidate leads toward
// the goal, branch in code, click what it named, repeat to the step budget. Jev
// never ranks DOM refs for their own sake; it picks which *content* matters, and
// code turns that pick into a click.
//
// Run:   cat scripts/prune.js scripts/explore.js | ego-browser nodejs
// Check: node scripts/explore.js      (guards and the decider, no browser)
//
// One heredoc per round, one JSON object out. job.json carries the goal, the
// start url, the task space id, and the fingerprints the guards need across
// rounds; it is written by the caller, never by this script. Nothing can be
// passed in from the caller, so the root is derived from HOME, as in skeleton.js.
//
// The browser work and the control flow are deliberately separated: everything
// that decides is a pure function, so every guard and every exit is checkable
// from the self-check at the bottom without opening a browser.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const MODEL = 'jev-latest'

// spec.md "Confidence". Thresholds start here and get tuned on our own pages.
const GOAL_MET = 0.8 // >= exits done
const NEXT_TARGET_CONFIDENCE = 0.5 // < retries once with a tighter list, then escalates
const CREDENTIAL_NOUL = 0.7 // > hands off to the user
const CANNOT_CHOOSE_NOUL = 0.6 // > retries once, then escalates
const ONLY_COMMIT_NOUL = 0.5 // > escalates
const LAYOUT_NOUL = 0.6 // spec names no number for this one; mirrors cannot_choose.

// A Choice answer is only used after it validates: the chosen id must be one of
// the ids we offered, the probability keys must be exactly that set, every number
// finite and within 0..1, the total within 0.02 of 1, and the argmax the chosen
// id. Anything else and nothing executes.
const PROBABILITY_SUM_TOLERANCE = 0.02
const NO_ANSWER = 'none'

// Guards. Three consecutive actions with no page change means blocked: that
// counts no *progress*, which is the thing worth counting, not no navigation.
const NO_PROGRESS_LIMIT = 3
const STALE_LIMIT = 2 // a decision invalidated twice by a moved page
const RETRY_CANDIDATES = 20 // the "tighter candidate list" of the retry

// state is capped at 32k including the longest question, so shave before sending.
const MAX_PAGE_CHARS = 12000
const SHORT_PAGE_CHARS = 3000
const SHORT_CANDIDATES = 60
const MAX_REQUEST_CHARS = 28000

// Page load is usually the real bottleneck, so this is generous on purpose.
const SETTLE_SECONDS = 2
const TRAIL_STEPS = 10

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

// The guards that need no decision. Returns an exit object to stop, or null to
// keep going. The least-bad candidate is never picked: an empty list ends the
// round, and so does a list step 7 emptied.
export function preflight({
  step, budget, candidates, commitOnly, fingerprint, noProgress, visited, escalated,
}) {
  if (step > budget) return { reason: 'step_budget' }
  if (noProgress >= NO_PROGRESS_LIMIT) return { reason: 'no_progress' }
  if (candidates.length === 0) {
    return { reason: commitOnly ? 'only_commit_remains' : 'cannot_choose' }
  }
  // Repeat page: this fingerprint has already been decided on in this run.
  if (visited.has(fingerprint)) return { reason: 'repeat_page' }
  // Ping-pong: a previous round escalated here and the caller answered. Refusing
  // to escalate again on the same fingerprint is what makes a resumed run
  // converge instead of spinning. spec.md "Ping-pong guard".
  if (escalated.has(fingerprint)) return { reason: 'ping_pong' }
  return null
}

// Consecutive actions with no page change. `lastFingerprint` is the page an
// action was taken from, still awaiting its post-action observation; null when
// the last step acted on nothing, so a retry neither counts nor resets.
export function progressAfter({ lastFingerprint, noProgress }, fingerprint) {
  if (lastFingerprint === null) return { lastFingerprint: null, noProgress }
  return {
    lastFingerprint: null,
    noProgress: fingerprint === lastFingerprint ? noProgress + 1 : 0,
  }
}

// The ref to click is read from the snapshot taken immediately before the click,
// at the position Jev chose from, and never carried over from the decision step.
// A page that moved between the two is not acted on at all: re-observe and
// re-ask. This is a safety property, not just an accuracy one, because a stale
// ref is a misclick.
export function resolveTarget(decision, observed, fresh) {
  if (!observed || !fresh) return null
  if (fresh.fingerprint !== observed.fingerprint) return null
  const candidate = fresh.candidates[decision.index]
  if (!candidate || candidate.label !== decision.label) return null
  return candidate.ref
}

// What Jev gets of the history: where we went and what was clicked, in words. Not
// the refs, which belong to the step that read them and would mislead here, and
// not the latency and token counts, which are ours.
export function trailForJev(history) {
  return history.slice(-TRAIL_STEPS).map((entry) => ({
    step: entry.step,
    url: entry.url,
    action: entry.label ?? entry.decision,
  }))
}

// Shave `current_page` first, then the candidate tail. Losing the bottom of the
// page is cheaper than losing the question, and the API rejects the request
// outright if the whole thing is over budget.
export function fitState(state, questions, budget = MAX_REQUEST_CHARS) {
  const size = (candidate) => JSON.stringify({ state: candidate, questions }).length
  if (size(state) <= budget) return state
  const shorter = { ...state, current_page: state.current_page.slice(0, SHORT_PAGE_CHARS) }
  if (size(shorter) <= budget) return shorter
  return { ...shorter, candidates: shorter.candidates.slice(0, SHORT_CANDIDATES) }
}

// Jev has no structural invariants (spec.md, Limits), so check the shape before
// trusting a number, and check a Choice harder: it is about to become a click.
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

// Read the answers in the order spec.md "The step loop" branches on them, so a
// credential page stops before anything else is even considered.
export function readDecision({ response, candidates, retried }) {
  const retryOr = (trigger) => (retried ? { kind: 'escalate', reason: trigger } : { kind: 'retry', trigger })

  if (readNoul(response, 'needs_credential') > CREDENTIAL_NOUL) {
    return { kind: 'escalate', reason: 'credentials_required' }
  }
  if (readNoul(response, 'goal_met') >= GOAL_MET) return { kind: 'done' }
  if (readNoul(response, 'layout_unfamiliar') > LAYOUT_NOUL) {
    return { kind: 'escalate', reason: 'layout_unfamiliar' }
  }
  if (readNoul(response, 'only_commit_remains') > ONLY_COMMIT_NOUL) {
    return { kind: 'escalate', reason: 'only_commit_remains' }
  }
  if (readNoul(response, 'cannot_choose') > CANNOT_CHOOSE_NOUL) return retryOr('cannot_choose')

  const offered = [...candidates.map((candidate) => candidate.ref), NO_ANSWER]
  let choice
  let confidence
  try {
    ;({ choice, confidence } = validateChoice(response, 'next_target', offered))
  } catch (error) {
    // Nothing executes on a malformed answer. Same for a Noul that never parsed,
    // which propagates to the one catch-all at the bottom.
    return { kind: 'escalate', reason: 'invalid_response', detail: error.message }
  }

  if (choice === NO_ANSWER) return retryOr('cannot_choose')
  if (confidence < NEXT_TARGET_CONFIDENCE) return retryOr('low_confidence')

  const index = candidates.findIndex((candidate) => candidate.ref === choice)
  return { kind: 'click', index, label: candidates[index].label }
}

// The questions. One request per step, several speculative questions in it:
// output tokens are free and they run in parallel, so ask for branches we may
// not take and read only the one we need. Question ids are for code and are not
// sent to the model, so each instruction has to carry its own meaning.
export function buildQuestions(candidates) {
  const criteria = {}
  for (const candidate of candidates) criteria[candidate.ref] = candidate.label
  criteria[NO_ANSWER] = 'None of these leads toward the goal'

  return {
    next_target: {
      type: 'choice',
      instructions: 'Which candidate is most likely to lead toward `goal`? Choose `none` if none does.',
      criteria,
    },
    goal_met: {
      type: 'noul',
      instructions: 'Does `current_page` already contain what `goal` asks for?',
      criteria: { true: 'The page states or directly contains the answer', false: 'It does not' },
    },
    // Asked here, read by the ledger slice (#9): a page worth reading is where a
    // finding gets collected. Cheap to ask now, and free in output tokens.
    worth_reading: {
      type: 'noul',
      instructions: 'Is `current_page` one of the pages `goal` asks us to read?',
      criteria: { true: 'This page is a target of the goal', false: 'It is navigation, a listing, or unrelated' },
    },
    needs_credential: {
      type: 'noul',
      instructions: 'Does `current_page` require a login or credential to proceed?',
      criteria: { true: 'The page asks to log in, or blocks on a credential', false: 'It does not' },
    },
    cannot_choose: {
      type: 'noul',
      instructions: 'Is there no candidate that clearly advances `goal`?',
      criteria: { true: 'None of the candidates advances the goal', false: 'At least one does' },
    },
    only_commit_remains: {
      type: 'noul',
      instructions: 'Are the only remaining actions ones that submit, send, publish, pay, or delete?',
      criteria: { true: 'Only such actions remain', false: 'Other actions remain, or none at all' },
    },
    layout_unfamiliar: {
      type: 'noul',
      instructions: 'Is this an interface that `candidates` represents poorly, such as a canvas or virtualized editor?',
      criteria: { true: 'The controls are visual, not in the candidate list', false: 'The candidate list represents it' },
    },
  }
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

const refsIn = (snapshot) => new Set([...snapshot.matchAll(/\bref=(\d+)/g)].map((match) => match[1]))

// One observation: the page tree, the pruned candidates, and the fingerprint the
// guards compare.
//
// Off-viewport nodes are the one thing the text tree does not mark, so take the
// viewport-scoped tree beside the full one and subtract: a ref in the page but
// not in the viewport is below the fold. Refs are CDP backend node ids, so the
// same element carries the same number in both calls.
//
// ponytail: two snapshots per observation, and the offscreen set moves when the
// page auto-scrolls, which moves the fingerprint with it. Upgrade path is
// geometry from element rects if the guards ever misfire on a scrolling page.
async function observe() {
  const page = await snapshotText()
  const visible = await snapshotText({ scope: 'only_within_viewport' })
  const info = await pageInfo()
  if (info.dialog) throw new Error('a native browser dialog is open; the page is blocked')

  const onScreen = refsIn(visible)
  const offscreenRefs = [...refsIn(page)].filter((ref) => !onScreen.has(ref))
  const { candidates, commitCount } = pruneDetail(page, { offscreenRefs })

  return {
    url: info.url,
    // What Jev reads is the visible tree, not the head of the full one: on a
    // large page the first 12k characters are navigation chrome, and the answer
    // is nowhere in them.
    pageText: visible,
    candidates,
    commitOnly: candidates.length === 0 && commitCount > 0,
    fingerprint: await pageFingerprint(info.url, candidates),
  }
}

function exitObject({ status, reason, detail, step, steps, state, extra = {} }) {
  const base = {
    status,
    ...(reason ? { reason } : {}),
    ...(detail ? { detail } : {}),
    ...(step ? { step } : {}),
    ...(steps ? { steps } : {}),
    ...(state?.url ? { url: state.url } : {}),
    // The caller records this when it rewrites job.json, which is what lets the
    // next round refuse to escalate twice on the same page.
    page_fingerprint: state?.fingerprint ?? null,
  }
  return { ...base, ...extra }
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
  const key = await readKey()
  const budget = job.step_budget ?? 12

  const visited = new Set(job.visited_fingerprints ?? [])
  const escalated = new Set(job.escalated_fingerprints ?? [])
  const history = []

  const task = await useOrCreateTaskSpace(job.task_space_id)
  await openOrReuseTab(job.start_url, { wait: true, timeout: 20 })

  let steps = 0
  let retried = false
  let tight = false
  let stale = 0
  let progress = { lastFingerprint: null, noProgress: 0 }

  while (true) {
    steps += 1
    const observed = await observe()

    // Moving on from a page we acted on makes that page visited, and coming back
    // to it later is the repeat-page guard. Staying on it is not a repeat: that
    // is the no-progress guard's business, and it counts it.
    if (progress.lastFingerprint && progress.lastFingerprint !== observed.fingerprint) {
      visited.add(progress.lastFingerprint)
    }
    progress = progressAfter(progress, observed.fingerprint)

    const stop = preflight({
      step: steps,
      budget,
      candidates: observed.candidates,
      commitOnly: observed.commitOnly,
      fingerprint: observed.fingerprint,
      noProgress: progress.noProgress,
      visited,
      escalated,
    })
    if (stop) {
      return exitObject({
        status: 'escalate',
        reason: stop.reason,
        step: steps,
        state: observed,
        extra: { goal: job.goal, partial_findings: [], trail: history.slice(-TRAIL_STEPS) },
      })
    }

    // Every step asks again over a fresh snapshot, so an @N ref is only ever used
    // in the step that read it. `tight` is the retry's smaller list.
    const candidates = tight ? observed.candidates.slice(0, RETRY_CANDIDATES) : observed.candidates
    const questions = buildQuestions(candidates)
    const state = fitState({
      goal: job.goal,
      current_page: observed.pageText.slice(0, MAX_PAGE_CHARS),
      candidates,
      trail: trailForJev(history),
    }, questions)

    const startedAt = Date.now()
    const response = await ask({ model: MODEL, state, questions }, key)
    const latencyMs = Date.now() - startedAt

    const decision = readDecision({ response, candidates, retried })
    const record = {
      step: steps,
      url: observed.url,
      fingerprint: observed.fingerprint,
      candidates: candidates.length,
      latency_ms: latencyMs,
      usage: response.usage ?? null,
    }
    const recorded = (what, extra = {}) => {
      history.push({ ...record, decision: what, ...extra })
      return history.slice(-TRAIL_STEPS)
    }

    if (decision.kind === 'done') {
      // The ledger is slice #9, so an empty findings list is the correct outcome
      // here: this slice is the loop, the guards, and the exits.
      return exitObject({
        status: 'done',
        steps,
        state: observed,
        extra: {
          goal: job.goal,
          findings: [],
          model: response.model,
          task_space_id: task.id,
          goal_met: readNoul(response, 'goal_met'),
          usage: response.usage ?? null,
          trail: recorded('done'),
        },
      })
    }

    if (decision.kind === 'escalate') {
      const extra = {
        goal: job.goal,
        model: response.model,
        task_space_id: task.id,
        partial_findings: [],
        trail: recorded(`escalate:${decision.reason}`),
        ...(decision.detail ? { detail: decision.detail } : {}),
      }
      // Credentials are a user problem, not a judgment call: hand the space over
      // and stop. Check `done` before telling the caller the handoff happened.
      if (decision.reason === 'credentials_required') {
        const handoff = await handOffTaskSpace(task.id)
        extra.handoff = handoff
      }
      return exitObject({ status: 'escalate', reason: decision.reason, step: steps, state: observed, extra })
    }

    if (decision.kind === 'retry') {
      // Once, then escalate: a second failure is an answer, not a reason to spin.
      retried = true
      tight = true
      recorded(`retry:${decision.trigger}`)
      continue
    }

    // Act. Both observations are fresh, so a page that moved between deciding and
    // acting is not clicked at all, and the ref is read from the snapshot taken
    // immediately before the click.
    const fresh = await observe()
    const target = resolveTarget(decision, observed, fresh)
    if (!target) {
      stale += 1
      const trail = recorded(`stale:${decision.label}`)
      if (stale > STALE_LIMIT) {
        return exitObject({
          status: 'escalate',
          reason: 'stale_page',
          step: steps,
          state: fresh,
          extra: { goal: job.goal, partial_findings: [], trail },
        })
      }
      continue
    }

    // Consume the decision before any mutation: the ref is used exactly once, so
    // a click that throws cannot be retried into a double-click.
    decision.consumed = true
    let clickError = null
    try {
      await click(target, { label: `step ${steps}: ${decision.label}`.slice(0, 64) })
    } catch (error) {
      clickError = error.message
    }
    await wait(SETTLE_SECONDS)

    // Record the action before the next observation, so a stale post-action
    // snapshot cannot erase the record of something that did happen.
    recorded(`click ${target}`, { label: decision.label, ...(clickError ? { error: clickError } : {}) })

    // The page this action was taken from, awaiting its post-action observation.
    // Acting also refreshes the retry budget: "retry once, then escalate" is a
    // rule about one decision, not about the whole run.
    progress.lastFingerprint = fresh.fingerprint
    retried = false
    tight = false
  }
}

// ------------------------------------------------------------------ self-check

async function runSelfCheck() {
  const assert = (await import('node:assert/strict')).default
  const fp = 'abc12345'
  const base = {
    step: 1, budget: 12, candidates: [{ ref: '@1', label: 'Read more' }], commitOnly: false,
    fingerprint: fp, noProgress: 0, visited: new Set(), escalated: new Set(),
  }
  const reason = (patch) => preflight({ ...base, ...patch })?.reason ?? null

  // Guards.
  assert.equal(reason({ step: 13 }), 'step_budget', 'budget guard')
  assert.equal(reason({ noProgress: 3 }), 'no_progress', 'three actions, no page change')
  assert.equal(reason({ noProgress: 2 }), null, 'two is not blocked yet')
  assert.equal(reason({ visited: new Set([fp]) }), 'repeat_page', 'repeat-page guard')
  assert.equal(reason({ escalated: new Set([fp]) }), 'ping_pong', 'ping-pong guard')
  assert.equal(reason({ candidates: [], commitOnly: true }), 'only_commit_remains', 'commit-only list')
  assert.equal(reason({ candidates: [], commitOnly: false }), 'cannot_choose', 'empty list')
  assert.equal(reason({}), null, 'a healthy step proceeds')

  // No progress: counts consecutive unchanged pages, resets on a change, and
  // ignores a step that acted on nothing.
  let progress = { lastFingerprint: fp, noProgress: 0 }
  progress = progressAfter(progress, fp)
  progress = progressAfter({ ...progress, lastFingerprint: fp }, fp)
  assert.equal(progress.noProgress, 2, 'two actions, same page')
  assert.equal(progressAfter({ lastFingerprint: null, noProgress: 2 }, fp).noProgress, 2, 'no action, no count')
  assert.equal(progressAfter({ lastFingerprint: fp, noProgress: 2 }, 'other').noProgress, 0, 'page changed')

  // The click target comes from the act-time snapshot, never from decision time.
  const observed = { fingerprint: fp, candidates: [{ ref: '@1', label: 'Read more' }] }
  const decision = { index: 0, label: 'Read more' }
  const renumbered = { fingerprint: fp, candidates: [{ ref: '@900', label: 'Read more' }] }
  assert.equal(resolveTarget(decision, observed, renumbered), '@900', 'ref read fresh, not reused')
  assert.equal(resolveTarget(decision, observed, { ...observed, fingerprint: 'moved' }), null, 'page moved')
  assert.equal(
    resolveTarget(decision, observed, { fingerprint: fp, candidates: [{ ref: '@1', label: 'Something else' }] }),
    null,
    'label moved position',
  )
  assert.equal(resolveTarget({ index: 4, label: 'x' }, observed, observed), null, 'index out of range')

  // The trail Jev sees carries no refs: a ref belongs to the step that read it.
  assert.deepEqual(
    trailForJev([{ step: 1, url: 'u', fingerprint: 'f', latency_ms: 5, usage: {}, decision: 'click @7', label: 'Sources' }]),
    [{ step: 1, url: 'u', action: 'Sources' }],
  )
  assert.deepEqual(
    trailForJev([{ step: 2, url: 'u', decision: 'retry:low_confidence' }]),
    [{ step: 2, url: 'u', action: 'retry:low_confidence' }],
  )
  assert.equal(trailForJev(Array.from({ length: 40 }, (_, index) => ({ step: index }))).length, TRAIL_STEPS)

  // The request shaves the page before the questions.
  const questions = buildQuestions([{ ref: '@1', label: 'x'.repeat(200) }])
  const big = { goal: 'g', current_page: 'p'.repeat(MAX_PAGE_CHARS), candidates: base.candidates, trail: [] }
  assert.equal(fitState(big, questions), big, 'a fitting request is untouched')
  const huge = { ...big, current_page: 'p'.repeat(40000) }
  assert.ok(JSON.stringify(fitState(huge, questions)).length < JSON.stringify(huge).length, 'shaved')

  // Answer reading. One good response, then one malformation at a time.
  const noulAnswers = (overrides = {}) => Object.fromEntries(
    Object.entries({
      needs_credential: 0.01, goal_met: 0.2, layout_unfamiliar: 0.05,
      only_commit_remains: 0.05, cannot_choose: 0.02, worth_reading: 0.9, ...overrides,
    }).map(([id, value]) => [id, { type: 'noul', noul: value }]),
  )
  // `choice`, `confidence`, `probabilities` are the three fields of a real answer.
  const response = (answer, nouls = {}) => ({
    model: 'jev-test',
    answers: { ...noulAnswers(nouls), next_target: { type: 'choice', ...answer } },
  })
  const candidates = [{ ref: '@1', label: 'Read more' }]
  const two = [{ ref: '@1', label: 'Read more' }, { ref: '@2', label: 'Help' }]
  const decided = (value, { retried = false, offered = candidates } = {}) => (
    readDecision({ response: value, candidates: offered, retried })
  )

  const sure = { choice: '@1', confidence: 0.8, probabilities: { '@1': 0.8, none: 0.2 } }
  const noMatch = { choice: 'none', confidence: 0.8, probabilities: { '@1': 0.2, none: 0.8 } }
  // Argmax @1, but the distribution is spread thin, which is what confidence is.
  const shaky = { choice: '@1', confidence: 0.44, probabilities: { '@1': 0.4, '@2': 0.35, none: 0.25 } }

  assert.deepEqual(decided(response(sure)), { kind: 'click', index: 0, label: 'Read more' }, 'a clean click')
  assert.equal(decided(response(noMatch)).kind, 'retry', 'no candidate retries')
  assert.equal(decided(response(noMatch), { retried: true }).reason, 'cannot_choose', 'then escalates')
  assert.equal(decided(response(shaky), { offered: two }).trigger, 'low_confidence', 'a shaky pick retries')
  assert.equal(
    decided(response(shaky), { offered: two, retried: true }).reason, 'low_confidence',
    'then escalates',
  )

  // Exits, one trigger each.
  assert.equal(decided(response(sure, { goal_met: 0.8 })).kind, 'done', 'goal met at exactly the threshold')
  assert.equal(decided(response(sure, { goal_met: 0.79 })).kind, 'click', 'below the threshold does not exit')
  assert.equal(
    decided(response(sure, { needs_credential: 0.71 })).reason, 'credentials_required', 'a credential page',
  )
  assert.equal(
    decided(response(sure, { only_commit_remains: 0.6 })).reason, 'only_commit_remains', 'a commit page',
  )
  assert.equal(
    decided(response(sure, { layout_unfamiliar: 0.7 })).reason, 'layout_unfamiliar', 'a canvas page',
  )
  assert.equal(decided(response(sure, { cannot_choose: 0.7 })).trigger, 'cannot_choose', 'nothing advances')
  // A credential page stops before the goal is even read.
  assert.equal(
    decided(response(sure, { needs_credential: 0.9, goal_met: 0.99 })).reason, 'credentials_required',
    'safety first',
  )

  // Choice validation: every rejection is a reason not to act.
  const rejects = (answer, message) => assert.equal(
    decided(response({ ...sure, ...answer })).reason, 'invalid_response', message,
  )
  rejects({ choice: '@9' }, 'an id we never offered')
  rejects({ choice: 'nope' }, 'a choice absent from the ids')
  rejects({ probabilities: { '@1': 1 } }, 'a missing id in the keys')
  rejects({ probabilities: { '@1': 0.8, none: 0.2, '@2': 0 } }, 'an extra id in the keys')
  rejects({ probabilities: { '@1': 0.5, none: 0.5 } }, 'a tie, not a decision')
  rejects({ probabilities: { '@1': 0.8, none: 0.5 } }, 'probabilities that do not sum to 1')
  rejects({ probabilities: { '@1': Number.NaN, none: 1 } }, 'a non-finite probability')
  rejects({ probabilities: { '@1': 1.4, none: -0.4 } }, 'a probability outside 0..1')
  rejects({ probabilities: undefined }, 'no probabilities at all')
  rejects({ confidence: 2 }, 'a confidence outside 0..1')
  rejects({ choice: '@1', confidence: 0.8, probabilities: { '@1': 0.5, none: 0.3 } }, 'a sum below tolerance')
  // A malformed answer never reaches the click: readDecision stops there.
  assert.ok(!('index' in decided(response({ choice: '@9', confidence: 0.9, probabilities: sure.probabilities }))))

  // A malformed Noul is not a number we can threshold, so it never becomes one.
  assert.throws(() => readNoul({ answers: { goal_met: { type: 'noul', noul: 'yes' } } }, 'goal_met'))
  assert.throws(() => readNoul({ answers: {} }, 'goal_met'))

  // The trust boundary travels: no commit-like label can reach the questions.
  const asked = buildQuestions([{ ref: '@2', label: 'Help' }])
  assert.ok(asked.next_target.criteria.none && !asked.next_target.criteria['@1'], 'criteria are the offered ids')
  assert.equal(asked.next_target.criteria['@2'], 'Help')

  return Object.keys(asked).length
}

// Run locally -> the check. Run inside the heredoc -> the loop, because argv[1]
// there is electron's own path, not ours.
if (process.argv[1] && process.argv[1].endsWith('explore.js')) {
  const questionCount = await runSelfCheck()
  console.log(`explore.js self-check ok (${questionCount} questions per step, guards and exits checked)`)
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
