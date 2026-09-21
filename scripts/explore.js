// jev-browser explore loop (issue #3, reachability fixed in #10; spec.md "The
// step loop").
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
// Pinned (#10): M1 ran every step on jev-1.13.0 through the alias, and an
// alias that moves would make the gate unreadable. Log the response `model`
// field regardless, so a silent bump is visible in the trail.
const MODEL = 'jev-1.13.0'

// spec.md "Confidence". Thresholds start here and get tuned on our own pages.
const GOAL_MET = 0.8 // >= exits done
const NEXT_TARGET_CONFIDENCE = 0.5 // < re-asks once over the same list, then escalates
const CREDENTIAL_NOUL = 0.7 // > hands off to the user
const CANNOT_CHOOSE_NOUL = 0.6 // > retries once, then escalates
const ONLY_COMMIT_NOUL = 0.5 // > escalates
const LAYOUT_NOUL = 0.6 // spec names no number for this one; mirrors cannot_choose.
const WORTH_READING = 0.5 // > and a page the goal asks us to read gets scrolled before escalating
const PAGE_SCROLL_LIMIT = 3 // viewports the loop will read down one page; monsters are served by their TOC anchors
const PROGRESS_SY_EPSILON = 8 // px of scroll drift that still counts as "no change"
const REVISIT_LIMIT = 1 // re-decisions granted per fingerprint before repeat_page escalates for real

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

// The paths spent by a return: the click that left the page we are back on,
// and the click that brought us back. A collection agent returning from a
// wrong cross-reference is recovery, not wandering — the repeat-page guard
// grants one re-decision per fingerprint, and those two paths are exhausted.
// A path is a target url when the tree gave one, and only falls back to the
// label for url-less controls (#11): a same-labelled twin — a docs page's
// cross-reference and its real section anchor share the text — is a different
// path, and spending the label spent both twins, which is how task 5 died.
export function pathsToSpend(history) {
  return history
    .filter((entry) => typeof entry.decision === 'string' && entry.decision.startsWith('click'))
    .slice(-2)
    .map((entry) => ({ label: entry.label ?? null, url: entry.target_url ?? null }))
    .filter((entry) => entry.label)
}

// The round is only ever about the page it started on. openOrReuseTab is
// supposed to aim the tab at `start_url`, but #11's re-run measured the other
// outcome: all 30 task-runs of three M1 runs read a module page left over
// from an earlier run instead of the index, and the gate silently measured
// from the wrong pages. So the start is verified on the same channel the loop
// reads — pageInfo, not the tab's claimed url — and a round that did not land
// on its start page says so instead of measuring the wrong site. Fragment and
// a trailing slash are position, not identity.
export function matchesStartUrl(observedUrl, startUrl) {
  if (!observedUrl || !startUrl) return false
  const clean = (url) => url.replace(/#.*$/, '').replace(/\/+$/, '') || '/'
  return clean(observedUrl) === clean(startUrl)
}

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

// Consecutive actions with no observable change. The fingerprint is
// scroll-stable on purpose, so an action that only moved the viewport — a
// purposeful read-scroll, an in-page anchor jump — counts on `sy`, above a
// small drift epsilon so a sticky header or sub-pixel jitter cannot fake
// progress forever. `lastFingerprint` is null when the last step acted on
// nothing, so a retry neither counts nor resets.
export function progressAfter({ lastFingerprint, lastSy, noProgress }, { fingerprint, sy }) {
  if (lastFingerprint === null) return { lastFingerprint: null, lastSy: null, noProgress }
  const changed = fingerprint !== lastFingerprint
    || Math.abs((sy ?? 0) - (lastSy ?? 0)) > PROGRESS_SY_EPSILON
  return { lastFingerprint: null, lastSy: null, noProgress: changed ? 0 : noProgress + 1 }
}

// The target to click is found in the snapshot taken immediately before the
// click, and never carried over from the decision step. The label is the stable
// key, not the index or the ref: the list order can shift with the page's
// scroll and refs belong to the snapshot that read them, but a deduped
// candidate list carries each label exactly once — per target, since #11, so
// when a label names twins the `spent` predicate picks the live one and the
// spent twin cannot be clicked by accident of DOM order. A page that moved to
// a different fingerprint between the two observations is not acted on at all:
// re-observe and re-ask. A stale ref is a misclick, so this is a safety
// property, not just an accuracy one.
export function resolveTarget(decision, observed, fresh, spent = null) {
  if (!observed || !fresh) return null
  if (fresh.fingerprint !== observed.fingerprint) return null
  const byLabel = fresh.candidates.filter((candidate) => candidate.label === decision.label)
  const alive = spent ? byLabel.filter((candidate) => !spent(candidate)) : byLabel
  return (alive[0] ?? byLabel[0])?.ref ?? null
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
    // Nothing executes on a malformed answer. It gets the one retry the other
    // shaky answers get (#10 change 3: two of M1's nine failures were a Choice
    // disagreeing with itself, and a re-ask is cheaper than an escalation),
    // then escalates with the detail. Same for a Noul that never parsed, which
    // propagates to the one catch-all at the bottom.
    if (retried) return { kind: 'escalate', reason: 'invalid_response', detail: error.message }
    return { kind: 'retry', trigger: 'invalid_response', detail: error.message }
  }

  if (choice === NO_ANSWER) return retryOr('cannot_choose')
  if (confidence < NEXT_TARGET_CONFIDENCE) return retryOr('low_confidence')

  const index = candidates.findIndex((candidate) => candidate.ref === choice)
  return { kind: 'click', index, label: candidates[index].label }
}

// The scroll action (#10 change 2), decided in code and not by Jev, for the
// three shapes a read-scroll answers: the answer for this page is a retry —
// nothing offered advances, or the pick stayed shaky — or it is a confident
// pick that just proved dead (the same label, clicked, changed nothing: Jev is
// stateless between steps and will name it again) — or it is a granted revisit
// (#11: task 1 died crossing between two pages that each held half the story,
// both decided, neither read far enough, so a revisit now reads one viewport
// deeper before it spends its re-decision). In every case, when Jev also says
// this page is one the goal asks us to read, the unread remainder below the
// fold is a better bet than a third identical click, a second guess at the
// same screen, or an escalation. Serves `state.current_page` only;
// reachability is the candidate rule's job. Bounded per page, because a
// 123-viewport page cannot be read a screen at a time inside a step budget —
// long pages are served by their own TOC anchors, which the candidate rule
// now offers.
export function shouldScrollPage({ stuck, revisit = false, worthReading, moreBelow, scrolls }) {
  return (stuck === true || revisit === true)
    && worthReading > WORTH_READING
    && moreBelow
    && scrolls < PAGE_SCROLL_LIMIT
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

// Unread content below the fold, asked of the page itself. js() returns its
// expression's value (verified on the live runtime).
async function moreBelow(observed) {
  const viewHeight = await js('window.innerHeight')
  const scrollHeight = await js('document.documentElement.scrollHeight')
  return scrollHeight > observed.sy + viewHeight + PROGRESS_SY_EPSILON
}

// One observation: the page tree, the pruned candidates, and the fingerprint
// the guards compare.
//
// The viewport is a hint now, never a filter (#10 change 1): candidates come
// from the full tree, and the viewport-scoped tree only says which refs are on
// screen — the off-screen count, and which clicks need a reveal scroll first.
// Refs are CDP backend node ids, so the same element carries the same number in
// both calls, **but only the most recent snapshotText()'s map is addressable**:
// a below-the-fold ref is absent from the viewport map, which is why the
// viewport tree is taken FIRST and the full tree LAST — the live ref map is
// then the superset every candidate ref comes from. (Measured: clicking a
// full-tree-only ref in the other order fails with `Unknown ref`.)
// `pageText` stays viewport-scoped: it is the text channel the read-scroll
// serves, and the full tree of a long page would bury the answer under
// navigation chrome. `sy` is what the no-progress guard counts scrolls and
// in-page anchor jumps on, since the fingerprint cannot move with scroll
// position by design.
async function observe() {
  const visible = await snapshotText({ scope: 'only_within_viewport' })
  const page = await snapshotText()
  const info = await pageInfo()
  if (info.dialog) throw new Error('a native browser dialog is open; the page is blocked')

  const { candidates, commitCount, offscreenCount } = pruneDetail(page, {
    visibleRefs: [...refsIn(visible)],
    currentUrl: info.url,
  })

  return {
    url: info.url,
    sy: info.sy,
    offscreenCount,
    pageText: visible,
    candidates,
    commitOnly: candidates.length === 0 && commitCount > 0,
    fingerprint: await pageFingerprint(info.url, candidates),
  }
}

// An offered candidate can sit below the fold, so a pick may name something
// off-screen. Scrolling it into view first is what makes every offered
// candidate genuinely clickable, and it keeps the post-click observation
// meaningful. Measured on nodejs.org (#10): elementCenter reports the
// element's content offset, and deep links can live inside an independently
// scrolling container (#column2, 2691px of content in a 683px client) where
// page-level scrollTo changes nothing and a click on the clipped element
// silently no-ops. So the reveal scrolls the page AND every independent
// scroll container toward the target's offset: whichever owns the element
// reveals it, the others scroll harmlessly. This must not snapshot: the refs
// belong to the observation the decision was resolved from.
async function reveal(target) {
  const center = await elementCenter(target)
  const viewHeight = await js('window.innerHeight')
  if (center.y >= 0 && center.y <= viewHeight) return false
  const offset = Math.round(center.y)
  await js(`(() => {
    window.scrollTo(0, Math.max(0, ${offset} - window.innerHeight / 2))
    for (const el of document.querySelectorAll('*')) {
      if (el !== document.documentElement && el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 100) {
        el.scrollTop = Math.max(0, ${offset} - el.clientHeight / 2)
      }
    }
  })()`)
  return true
}

// The round's token totals and the model that answered. The trail is only the
// last ten steps, which is enough to read a round back but not to count it, and
// M1 (#4) has to count what a task spent and know which version answered before
// it can pin one.
const usageTotal = { requests: 0 }
let modelSeen = null

function tally(response) {
  usageTotal.requests += 1
  modelSeen = response.model ?? modelSeen
  for (const [key, value] of Object.entries(response.usage ?? {})) {
    if (typeof value === 'number') usageTotal[key] = (usageTotal[key] ?? 0) + value
  }
}

function exitObject({ status, reason, detail, step, steps, state, extra = {} }) {
  const base = {
    status,
    usage_total: usageTotal,
    step_count: steps ?? step ?? 0,
    ...(modelSeen ? { model: modelSeen } : {}),
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

// The start-page half of matchesStartUrl, asked of the live browser.
async function onTheStartPage(startUrl) {
  try {
    return matchesStartUrl((await pageInfo()).url, startUrl)
  } catch {
    return false
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
  const key = await readKey()
  const budget = job.step_budget ?? 12

  const visited = new Set(job.visited_fingerprints ?? [])
  const escalated = new Set(job.escalated_fingerprints ?? [])
  const history = []

  const task = await useOrCreateTaskSpace(job.task_space_id)
  await openOrReuseTab(job.start_url, { wait: true, timeout: 20 })
  // One deliberate navigation retry, then a loud refusal: a round measured
  // from the wrong page is worse than no round.
  if (!(await onTheStartPage(job.start_url))) {
    await gotoAndWait(job.start_url, { timeout: 20 })
    if (!(await onTheStartPage(job.start_url))) {
      return exitObject({
        status: 'escalate',
        reason: 'start_url_mismatch',
        extra: {
          goal: job.goal,
          detail: `the start tab is at ${JSON.stringify((await pageInfo().catch(() => ({}))).url ?? 'unknown')}, not ${job.start_url}`,
        },
      })
    }
  }

  let steps = 0
  let retried = false
  let stale = 0
  let progress = { lastFingerprint: null, lastSy: null, noProgress: 0 }
  // The most recent click's label, cleared whenever the page changes; the
  // input to the dead-repeat half of the scroll decision.
  let lastAction = null
  // Read-scrolls spent per fingerprint. Keyed on the fingerprint, which is
  // scroll-stable, so scrolling a page never resets its own count.
  const pageScrolls = new Map()
  // Re-decisions spent per fingerprint by the repeat-page guard.
  const revisits = new Map()
  // Paths exhausted by the latest revisit-continue; offered to no ask until
  // the next action retires them. Urls when the tree gave one (#11: spending
  // the label spent the twin too), labels only as the url-less fallback.
  const spentUrls = new Set()
  const spentLabels = new Set()
  const spent = (candidate) => (candidate.url
    ? spentUrls.has(candidate.url)
    : spentLabels.has(candidate.label))
  const anySpent = () => spentUrls.size > 0 || spentLabels.size > 0

  while (true) {
    steps += 1
    let observed = await observe()

    // The start check rides on the loop's own observation channel (#11): a
    // pre-loop pageInfo can pass and the round still observe a leftover tab
    // (measured: three M1 runs read the previous run's module pages from step
    // 1, silently, with the guard's check green). The first observation is
    // the truth, so it gets the same verification: re-aim once, re-observe,
    // then refuse loudly with the tab list in the detail.
    if (steps === 1 && !matchesStartUrl(observed.url, job.start_url)) {
      await gotoAndWait(job.start_url, { timeout: 20 })
      const reobserved = await observe()
      if (!matchesStartUrl(reobserved.url, job.start_url)) {
        return exitObject({
          status: 'escalate',
          reason: 'start_url_mismatch',
          step: steps,
          state: reobserved,
          extra: {
            goal: job.goal,
            detail: `the loop observes ${JSON.stringify(reobserved.url)}, not the start url ${job.start_url}`,
            start_tabs: await listTabs().catch(() => null),
          },
        })
      }
      observed = reobserved
    }

    // Moving on from a page we acted on makes that page visited, and coming back
    // to it later is the repeat-page guard. Staying on it is not a repeat — not
    // even scrolled: the fingerprint is scroll-stable, and a read-scroll or an
    // in-page anchor is the no-progress guard's business, counted on `sy`.
    if (progress.lastFingerprint && progress.lastFingerprint !== observed.fingerprint) {
      visited.add(progress.lastFingerprint)
    }
    progress = progressAfter(progress, { fingerprint: observed.fingerprint, sy: observed.sy })
    // A step that observed change retires the last action: only an unbroken
    // run of dead actions makes a pick a dead repeat.
    if (progress.noProgress === 0) lastAction = null

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
    let revisitPending = false
    if (stop?.reason === 'repeat_page') {
      // Coming back to a page after a wrong cross-reference is recovery, not
      // wandering: grant one re-decision with the outbound and inbound paths
      // spent, and escalate only if this page still cannot be left usefully.
      const seen = revisits.get(observed.fingerprint) ?? 0
      if (seen < REVISIT_LIMIT) {
        revisits.set(observed.fingerprint, seen + 1)
        visited.delete(observed.fingerprint)
        for (const path of pathsToSpend(history)) {
          if (path.url) spentUrls.add(path.url)
          else spentLabels.add(path.label)
        }
        revisitPending = true
      } else {
        return exitObject({
          status: 'escalate',
          reason: 'repeat_page',
          step: steps,
          state: observed,
          extra: { goal: job.goal, partial_findings: [], trail: history.slice(-TRAIL_STEPS) },
        })
      }
    } else if (stop) {
      return exitObject({
        status: 'escalate',
        reason: stop.reason,
        step: steps,
        state: observed,
        extra: { goal: job.goal, partial_findings: [], trail: history.slice(-TRAIL_STEPS) },
      })
    }

    // Every step asks again over a fresh snapshot, so an @N ref is only ever used
    // in the step that read it. The retry re-asks over the SAME list: the old
    // tighter slice truncated in DOM order, which on a full-tree list deletes
    // the destination (measured: task 3's answer sat beyond entry 20, and the
    // tightened re-ask exited cannot_choose over a list that no longer held it).
    // Spent paths are the only subtraction, and by target, not label (#11).
    const candidates = anySpent()
      ? observed.candidates.filter((candidate) => !spent(candidate))
      : observed.candidates
    const questions = buildQuestions(candidates)
    const state = fitState({
      goal: job.goal,
      current_page: observed.pageText.slice(0, MAX_PAGE_CHARS),
      // ref, label, count are all Jev gets of a candidate: the target url is
      // for code (spending), never for the request.
      candidates: candidates.map(({ ref, label, count }) => ({ ref, label, count })),
      trail: trailForJev(history),
    }, questions)

    const startedAt = Date.now()
    const response = await ask({ model: MODEL, state, questions }, key)
    const latencyMs = Date.now() - startedAt
    tally(response)

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
    if (revisitPending) recorded('revisit')

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

    // The read-scroll, ahead of both the retry and the click. `lastAction`
    // holds the label of the most recent click and is cleared whenever the
    // page last changed, so `deadRepeat` is true only when the identical pick
    // has already failed to move anything. Jev is stateless between steps and
    // will happily name the same dead target again; code breaks the tie. A
    // granted revisit reads first for the same reason: the re-decision is the
    // one thing the guard still owes this page, and spending it on the same
    // screen is how task 1 died (#11).
    const scrolls = pageScrolls.get(observed.fingerprint) ?? 0
    const deadRepeat = progress.noProgress >= 1 && lastAction?.label === decision.label
    const stuck = decision.kind === 'retry' || (decision.kind === 'click' && deadRepeat)
    if (shouldScrollPage({
      stuck,
      revisit: revisitPending,
      worthReading: readNoul(response, 'worth_reading'),
      moreBelow: await moreBelow(observed),
      scrolls,
    })) {
      const to = Math.round(observed.sy + await js('window.innerHeight'))
      await js(`window.scrollTo(0, ${to})`)
      pageScrolls.set(observed.fingerprint, scrolls + 1)
      recorded(`${revisitPending ? 'revisit-' : ''}scroll to ${to}`)
      progress.lastFingerprint = observed.fingerprint
      progress.lastSy = observed.sy
      continue
    }

    if (decision.kind === 'retry') {
      // Once, then escalate: a second failure is an answer, not a reason to spin.
      retried = true
      recorded(`retry:${decision.trigger}`)
      continue
    }

    // Act. Both observations are fresh, so a page that moved between deciding and
    // acting is not clicked at all, and the ref is read from the snapshot taken
    // immediately before the click. A spent twin is skipped at the label.
    const fresh = await observe()
    const target = resolveTarget(decision, observed, fresh, anySpent() ? spent : null)
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

    // An offered candidate can live below the fold; scroll it into view before
    // clicking. A failed reveal falls through to the click itself: click() by
    // ref does not require the element to be on screen (verified), only the
    // post-click text channel is better when it is.
    let revealed = false
    try {
      revealed = await reveal(target)
    } catch {
      revealed = false
    }

    let clickError = null
    try {
      await click(target, { label: `step ${steps}: ${decision.label}`.slice(0, 64) })
    } catch (error) {
      clickError = error.message
    }
    await wait(SETTLE_SECONDS)

    // Record the action before the next observation, so a stale post-action
    // snapshot cannot erase the record of something that did happen. The
    // target url rides along under its own name — `url` is the observed page
    // and must stay that (spreading a target over it once misread every trail
    // in the #11 re-run as a wrong start) — so a later revisit can spend the
    // path by target (#11).
    recorded(
      `click ${target}`,
      {
        label: decision.label,
        target_url: candidates[decision.index]?.url ?? null,
        ...(revealed ? { revealed: true } : {}),
        ...(clickError ? { error: clickError } : {}),
      },
    )

    // The page this action was taken from, awaiting its post-action observation.
    // Acting also refreshes the retry budget: "retry once, then escalate" is a
    // rule about one decision, not about the whole run.
    progress.lastFingerprint = fresh.fingerprint
    progress.lastSy = fresh.sy
    lastAction = { label: decision.label }
    retried = false
    spentUrls.clear()
    spentLabels.clear()
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

  // No progress: counts consecutive actions with no observable change — the
  // fingerprint OR the scroll position — resets on either changing, ignores a
  // step that acted on nothing, and does not let sub-pixel drift fake progress.
  let progress = { lastFingerprint: fp, lastSy: 0, noProgress: 0 }
  progress = progressAfter(progress, { fingerprint: fp, sy: 0 })
  progress = progressAfter({ ...progress, lastFingerprint: fp, lastSy: 0 }, { fingerprint: fp, sy: 0 })
  assert.equal(progress.noProgress, 2, 'two actions, same page, same scroll')
  assert.equal(
    progressAfter({ lastFingerprint: null, lastSy: null, noProgress: 2 }, { fingerprint: fp, sy: 0 }).noProgress,
    2,
    'no action, no count',
  )
  assert.equal(
    progressAfter({ lastFingerprint: fp, lastSy: 0, noProgress: 2 }, { fingerprint: 'other', sy: 0 }).noProgress,
    0,
    'page changed',
  )
  assert.equal(
    progressAfter({ lastFingerprint: fp, lastSy: 100, noProgress: 2 }, { fingerprint: fp, sy: 900 }).noProgress,
    0,
    'a scroll or an in-page anchor is progress',
  )
  assert.equal(
    progressAfter({ lastFingerprint: fp, lastSy: 100, noProgress: 2 }, { fingerprint: fp, sy: 104 }).noProgress,
    3,
    'drift under the epsilon is not',
  )

  // The click target comes from the act-time snapshot, never from decision
  // time, and is found by label: order and refs can move, a deduped label
  // cannot quietly duplicate.
  const observed = { fingerprint: fp, candidates: [{ ref: '@1', label: 'Read more' }] }
  const decision = { index: 0, label: 'Read more' }
  const renumbered = { fingerprint: fp, candidates: [{ ref: '@900', label: 'Other' }, { ref: '@901', label: 'Read more' }] }
  assert.equal(resolveTarget(decision, observed, renumbered), '@901', 'ref read fresh at the label, not the index')
  assert.equal(resolveTarget(decision, observed, { ...observed, fingerprint: 'moved' }), null, 'page moved')
  assert.equal(
    resolveTarget(decision, observed, { fingerprint: fp, candidates: [{ ref: '@1', label: 'Something else' }] }),
    null,
    'the label left the list',
  )
  assert.equal(resolveTarget({ index: 4, label: 'x' }, observed, observed), null, 'a label that was never offered')

  // The start guard (#11): fragment and a trailing slash are position, not
  // identity; a leftover module page is not the start, whatever aimed the tab.
  assert.equal(matchesStartUrl('https://x.io/docs/api/', 'https://x.io/docs/api'), true, 'a trailing slash is not a page')
  assert.equal(matchesStartUrl('https://x.io/docs/api#top', 'https://x.io/docs/api'), true, 'a fragment is not a page')
  assert.equal(matchesStartUrl('https://x.io/docs/api/sqlite.html', 'https://x.io/docs/api'), false, 'a leftover module page is not the start')
  assert.equal(matchesStartUrl('https://x.io/other', 'https://x.io/docs/api'), false, 'a different page is not the start')
  assert.equal(matchesStartUrl(null, 'https://x.io/'), false, 'no observation, no match')

  // A label can name twins (#11): the spent one — the cross-reference a hop
  // just proved wrong — is skipped, and the live twin is clicked.
  const twins = {
    fingerprint: fp,
    candidates: [
      { ref: '@1', label: 'Usage and example', url: 'https://docs.example/synopsis.html' },
      { ref: '@2', label: 'Usage and example', url: 'https://docs.example/cluster.html#usage' },
    ],
  }
  const spentCrossRef = (candidate) => candidate.url === 'https://docs.example/synopsis.html'
  assert.equal(
    resolveTarget({ index: 1, label: 'Usage and example' }, twins, twins, spentCrossRef),
    '@2',
    'a spent twin is skipped at the label',
  )
  assert.equal(
    resolveTarget({ index: 1, label: 'Usage and example' }, twins, twins),
    '@1',
    'without spending, DOM order picks the twin',
  )

  // The read-scroll: a stuck answer (a retry, or a confident pick that just
  // proved dead) or a granted revisit (#11), on a page worth reading that
  // still has content below the fold, and never more than the per-page limit.
  const scrollCase = { stuck: true, worthReading: 0.9, moreBelow: true, scrolls: 0 }
  assert.ok(shouldScrollPage(scrollCase), 'a stuck read scrolls')
  assert.ok(!shouldScrollPage({ ...scrollCase, stuck: false }), 'a live pick is not intercepted')
  assert.ok(shouldScrollPage({ ...scrollCase, stuck: false, revisit: true }), 'a granted revisit reads first')
  assert.ok(!shouldScrollPage({ ...scrollCase, stuck: false, revisit: true, worthReading: 0.4 }), 'navigation is not scrolled on a revisit either')
  assert.ok(!shouldScrollPage({ ...scrollCase, moreBelow: false }), 'nothing below the fold')
  assert.ok(!shouldScrollPage({ ...scrollCase, scrolls: PAGE_SCROLL_LIMIT }), 'the per-page limit holds')

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

  // A revisit spends the path out and the path back — clicks only, so scrolls
  // and retries around the departure do not burn unrelated paths — and a path
  // is a target url when there is one, so a same-labelled twin survives the
  // spending (#11, task 5).
  assert.deepEqual(
    pathsToSpend([
      { step: 1, decision: 'click @1', label: 'Cluster', target_url: 'https://docs.example/cluster.html' },
      { step: 2, decision: 'scroll to 900' },
      { step: 3, decision: 'click @2', label: 'Usage and example', target_url: 'https://docs.example/synopsis.html' },
      { step: 4, decision: 'click @3', label: 'Cluster', target_url: 'https://docs.example/cluster.html' },
    ]),
    [
      { label: 'Usage and example', url: 'https://docs.example/synopsis.html' },
      { label: 'Cluster', url: 'https://docs.example/cluster.html' },
    ],
  )
  assert.deepEqual(
    pathsToSpend([{ step: 1, decision: 'click @9', label: 'Back' }]),
    [{ label: 'Back', url: null }],
    'a url-less click spends its label',
  )
  assert.deepEqual(pathsToSpend([{ step: 1, decision: 'retry:low_confidence' }]), [], 'no clicks, nothing spent')

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

  // Choice validation: every rejection is a reason not to act, and since #10
  // each one first gets the single retry the other shaky answers get.
  const rejects = (answer, message) => {
    const first = decided(response({ ...sure, ...answer }))
    assert.equal(first.kind, 'retry', message)
    assert.equal(first.trigger, 'invalid_response', message)
    assert.equal(
      decided(response({ ...sure, ...answer }), { retried: true }).reason, 'invalid_response',
      `${message}, then escalate`,
    )
  }
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
  // A malformed answer never reaches the click: the retry carries no index.
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
