// Run artifacts for the loops (issue #9; spec.md "Where findings live").
//
// Three artifacts, three audiences:
//
// - `runs/<timestamp>-<slug>/ledger.jsonl` is the payload. One JSON line per
//   finding, appended as it is collected, read back at exit by the caller. A
//   finding's `value` and `evidence` are spans code copied from the page
//   snapshot — selection, never generation, because Jev cannot write text and
//   the acceptance bar is byte-identity with the snapshot.
// - The digest is what Jev sees: a bounded projection of the ledger into
//   `state` — aspect, value, and step, the last 20 entries. Without it
//   `goal_met` fires early on a multi-item goal and the loop re-opens results
//   already collected.
// - `runs/<timestamp>-<slug>/trace.jsonl` is for us: one line per step with
//   the decision, the probabilities, `page_changed`, url, token usage, and
//   latency. Never sent to Jev; M1 (#4) reads exactly these fields.
//
// The directory is resolved here because nothing from the caller reaches the
// heredoc (spec.md Configuration): the exit object names `run_dir`, the caller
// records it in job.json, and round N+1 — after a needs_input or an escalate —
// appends to the same ledger instead of orphaning a partially completed
// collection in a fresh directory.
//
// The heredoc runtime cannot import files, so the loop script is assembled by
// `cat scripts/prune.js scripts/ledger.js scripts/<loop>.js`; under node the
// self-checks import this module directly. Top-level names are therefore
// unique across the concatenation (`LFS`, not the loops' `fs`), and the module
// is imported once at the top level so every write below is synchronous — a
// trace line written fire-and-forget from an async function would land on a
// microtask, and the round's last line would race the process exit.
const LFS = await import('node:fs')

const LEDGER_FILE = 'ledger.jsonl'
const TRACE_FILE = 'trace.jsonl'

// The digest bound: the last 20 findings, values and aspects trimmed. 20 ×
// (80 + 80) characters is a few KB of state — bounded however long the ledger
// grows, which is the point. Exported for the self-checks' sake.
export const DIGEST_ENTRIES = 20
export const DIGEST_VALUE_CHARS = 80
export const DIGEST_ASPECT_CHARS = 80

// Extraction spans are lines of the *visible* snapshot (#9): state.current_page
// is viewport-scoped, and a span cut from the full tree would be off-screen
// text Jev was never shown. 80 spans of 200 characters cover any real viewport
// and keep the extraction request inside the 32k state budget with the digest
// riding along.
export const MAX_SPANS = 80
export const MAX_SPAN_CHARS = 200
export const MAX_ASPECT_CHARS = 120
const RUN_SLUG_CHARS = 40

// The same two line shapes prune.js reads (spec.md platform facts): a child
// `text "..."` line, and a node whose accessible name is inline. Both carry
// page text; the annotations are ego-browser's, not the page's, and stay out
// of the spans. The name group is greedy to the last quote, exactly as in
// prune.js, so what is captured is what the line held.
const TEXT_LINE = /^text "(.*)"$/
const NAMED_NODE = /^([a-z][a-z-]*) "(.*)"(?:\s*\[.*\])?$/

export function slugifyGoal(goal) {
  const slug = String(goal ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, RUN_SLUG_CHARS)
    .replace(/-+$/g, '')
  return slug || 'run'
}

// `runs/<timestamp>-<slug>`, filename-safe: ISO stamps carry colons.
export function runDirName(goal, now = new Date()) {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${slugifyGoal(goal)}`
}

// Reuse the run directory the caller recorded from the last exit; create a
// fresh one otherwise. The guard on `run_dir` is deliberately narrow — it must
// be a single path segment directly inside the runs root, so a typo, a
// traversal (`../`), or a path from another installation cannot redirect the
// findings. `exists`/`mkdirp` are injected so the self-check runs this without
// touching HOME.
export function resolveRunDir(job, { runsRoot, now = new Date(), exists = () => false, mkdirp = () => {} } = {}) {
  const claimed = typeof job?.run_dir === 'string' ? job.run_dir : null
  const rest = claimed !== null && claimed.startsWith(`${runsRoot}/`)
    ? claimed.slice(runsRoot.length + 1)
    : null
  if (rest && rest.length > 0 && !rest.includes('/') && !rest.includes('..') && exists(claimed)) {
    return { dir: claimed, reused: true, ledger: `${claimed}/${LEDGER_FILE}`, trace: `${claimed}/${TRACE_FILE}` }
  }
  const dir = `${runsRoot}/${runDirName(job?.goal, now)}`
  mkdirp(dir)
  return { dir, reused: false, ledger: `${dir}/${LEDGER_FILE}`, trace: `${dir}/${TRACE_FILE}` }
}

// The projection Jev sees (#9): aspect, value, and step of the last 20
// findings, values and aspects trimmed. Whatever the ledger grows to, the
// digest cannot.
export function digestOf(findings, {
  entries = DIGEST_ENTRIES,
  valueChars = DIGEST_VALUE_CHARS,
  aspectChars = DIGEST_ASPECT_CHARS,
} = {}) {
  return (findings ?? [])
    .slice(-entries)
    .map(({ aspect, value, step }) => ({
      aspect: String(aspect ?? '').slice(0, aspectChars),
      value: String(value ?? '').slice(0, valueChars),
      step,
    }))
}

// The lines of the visible snapshot a finding can be selected from. Value is
// the page's own text (the quoted content, or the node's inline name); evidence
// is the exact snapshot line it was read from, so an entry can be audited by
// grepping the snapshot for it. Truncation slices without an ellipsis on
// purpose: `…` would make the span text that appears nowhere on the page, and
// byte-identity with the snapshot is the acceptance bar. Repeated lines — a
// "Read more" listing — collapse onto the first.
export function answerSpans(pageText) {
  const spans = []
  const seen = new Set()
  for (const raw of String(pageText ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const text = line.match(TEXT_LINE)
    const node = text ? null : line.match(NAMED_NODE)
    const value = (text ? text[1] : node ? node[2] : '')
      .trim()
      .slice(0, MAX_SPAN_CHARS)
    if (!value || seen.has(value)) continue
    seen.add(value)
    spans.push({ value, evidence: line })
  }
  return spans.slice(0, MAX_SPANS)
}

// One finding per page per task (#9): a resumed round landing on a page the
// ledger already harvested must not duplicate the entry. Same url and same
// copied span is the same finding.
export function findingIsDuplicate(finding, known) {
  return known.some((existing) => existing.url === finding.url && existing.value === finding.value)
}

// Observable change, the no-progress rule of spec.md "The step loop": the
// fingerprint, or the scroll position beyond a drift epsilon. `null` when
// there is no previous step to compare against — the first trace line has no
// `page_changed` yet.
export function pageChanged(prev, next, epsilon) {
  if (!prev || !next) return null
  return next.fingerprint !== prev.fingerprint
    || Math.abs((next.sy ?? 0) - (prev.sy ?? 0)) > epsilon
}

// The per-step probabilities for the trace: a Noul flattens to its number, a
// Choice keeps the whole distribution — M1 (#4) counts from these, and the
// trail in the exit object does not carry them.
export function answersOf(response) {
  const out = {}
  for (const [id, answer] of Object.entries(response?.answers ?? {})) {
    if (answer?.type === 'noul') out[id] = answer.noul
    else if (answer?.type === 'choice') {
      out[id] = { choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities ?? null }
    }
  }
  return out
}

// Findings off disk. A ledger that does not exist yet is an empty ledger, not
// an error; a torn tail line — a crash mid-append — is skipped, never fatal.
export function readFindings(ledgerPath) {
  if (!ledgerPath) return []
  let text = ''
  try {
    text = LFS.readFileSync(ledgerPath, 'utf8')
  } catch {
    return []
  }
  const findings = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      findings.push(JSON.parse(line))
    } catch {
      // Skip the torn line; the rest of the ledger is still the payload.
    }
  }
  return findings
}

// Append one finding as one JSON line, synchronously. The ledger is the
// deliverable, so a failed append is allowed to throw and end the round —
// silently losing a finding is the one failure this slice must not have.
export function appendFinding(ledgerPath, finding) {
  LFS.appendFileSync(ledgerPath, `${JSON.stringify(finding)}\n`)
}

// Best-effort by design: the trace is never sent to Jev and never the payload,
// so a failed write is swallowed rather than allowed to end a round. The write
// is synchronous — the round's last trace line must be on disk before the
// process exits, not queued on a microtask behind it.
export function appendTrace(tracePath, line) {
  try {
    LFS.appendFileSync(tracePath, `${JSON.stringify(line)}\n`)
    return true
  } catch {
    return false
  }
}
