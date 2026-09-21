// M1 (#4): run the explore loop over a list of real goals on one real site and
// record the numbers the gate reads.
//
// Run:   node scripts/measure.js m1-goals.json
//
// The loop is unchanged and unaware. This is the caller of spec.md "Resume
// protocol": it writes job.json between rounds, runs one heredoc per task, reads
// the single JSON object back off stderr, and appends one line per task. Three
// heredoc batches in total, not thirty: open every task space, run the tasks,
// close every task space.
//
// ponytail: every task space is opened up front, so ten tabs are live at once.
// Open and close per task if a run ever gets slow enough to matter.

import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const HERE = import.meta.dirname
const HOME = process.env.HOME
const JOB_PATH = `${HOME}/.claude/jev-browser/job.json`
const STEP_BUDGET = 12
const HEREDOC_TIMEOUT_MS = 15 * 60 * 1000

const goalsPath = process.argv[2]
if (!goalsPath) {
  console.error('usage: node scripts/measure.js <goals.json>')
  process.exit(2)
}

// { start_url, goals: [ "...", ... ] }, with an optional per-task step_budget.
const plan = JSON.parse(readFileSync(goalsPath, 'utf8'))
const startUrl = plan.start_url
const goals = (plan.goals ?? []).map((entry) => (
  typeof entry === 'string' ? { goal: entry } : entry
))
if (!startUrl || goals.length === 0 || goals.some((entry) => !entry.goal)) {
  console.error(`${goalsPath}: needs a start_url and a non-empty goals list`)
  process.exit(2)
}

const loopSource = [
  readFileSync(`${HERE}/prune.js`, 'utf8'),
  readFileSync(`${HERE}/ledger.js`, 'utf8'),
  readFileSync(`${HERE}/explore.js`, 'utf8'),
].join('\n')

function browser(source) {
  const result = spawnSync('ego-browser', ['nodejs'], {
    input: source,
    encoding: 'utf8',
    timeout: HEREDOC_TIMEOUT_MS,
    maxBuffer: 128 * 1024 * 1024,
  })
  return { stderr: result.stderr ?? '', stdout: result.stdout ?? '', signal: result.signal }
}

// cliLog is the only output channel and it writes to stderr, so the answer is
// the last JSON object printed there. Take the last one that parses.
function lastJson(text) {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(line)
    } catch {
      continue
    }
  }
  return null
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const runDir = `${HOME}/.claude/jev-browser/runs/m1-${stamp}`
mkdirSync(runDir, { recursive: true })
const resultsPath = `${runDir}/results.jsonl`

const names = goals.map((_, index) => `jev-m1-${stamp}-${index + 1}`)
const opened = lastJson(browser(`
const ids = []
for (const name of ${JSON.stringify(names)}) ids.push((await useOrCreateTaskSpace(name)).id)
cliLog(JSON.stringify({ mark: 'opened', ids }))
`).stderr)
if (!opened?.ids || opened.ids.length !== goals.length) {
  console.error(`could not open ${goals.length} task spaces:`, JSON.stringify(opened))
  process.exit(1)
}

const results = []
for (const [index, entry] of goals.entries()) {
  const taskSpaceId = opened.ids[index]
  writeFileSync(JOB_PATH, `${JSON.stringify({
    task_space_id: taskSpaceId,
    goal: entry.goal,
    start_url: startUrl,
    step_budget: entry.step_budget ?? plan.step_budget ?? STEP_BUDGET,
    visited_fingerprints: [],
    escalated_fingerprints: [],
  }, null, 2)}\n`)

  const startedAt = Date.now()
  const { stderr, signal } = browser(loopSource)
  const wallMs = Date.now() - startedAt
  const exitObject = lastJson(stderr)

  // A step spent on something other than advancing: a retry, a discard by the
  // freshness guard, or the escalation that ended the round. This is the cost
  // the gate is about, "Jev adding a hop". The trail holds one `escalate:` entry
  // per round that ended in escalate, and guard-exits end that way too, so the
  // status flag counts what the trail cannot.
  const trail = exitObject?.trail ?? []
  const decisionOf = (row) => row?.decision ?? ''
  const retries = trail.filter((row) => decisionOf(row).startsWith('retry:')).length
  const stale = trail.filter((row) => decisionOf(row).startsWith('stale:')).length
  const clicks = trail.filter((row) => decisionOf(row).startsWith('click')).length
  const steps = exitObject?.steps ?? exitObject?.step ?? trail.length
  const escalated = exitObject?.status === 'escalate' ? 1 : 0

  const record = {
    task: index + 1,
    goal: entry.goal,
    task_space_id: taskSpaceId,
    status: exitObject?.status ?? (signal ? `killed:${signal}` : 'no_exit_object'),
    reason: exitObject?.reason ?? null,
    url: exitObject?.url ?? null,
    model: exitObject?.model ?? null,
    steps,
    clicks,
    retries,
    stale,
    escalated,
    non_advancing_steps: retries + stale + escalated,
    escalation_rate: steps ? (retries + stale + escalated) / steps : null,
    wall_ms: wallMs,
    usage: exitObject?.usage_total ?? exitObject?.usage ?? null,
    detail: exitObject?.detail ?? null,
    // Kept verbatim: the counts say a guard fired, only the trail says what the
    // loop was doing when it did, which is the difference between a pruning fix
    // and a threshold fix.
    trail,
    stderr_tail: exitObject ? null : stderr.split('\n').slice(-6).join('\n'),
  }
  results.push(record)
  appendFileSync(resultsPath, `${JSON.stringify(record)}\n`)
  console.log(
    `${String(index + 1).padStart(2)}/${goals.length} ${record.status}`
    + `${record.reason ? ` (${record.reason})` : ''}`
    + ` steps=${steps} rate=${record.escalation_rate === null ? 'n/a' : record.escalation_rate.toFixed(2)}`
    + ` ${(wallMs / 1000).toFixed(1)}s`,
  )
}

browser(`
for (const id of ${JSON.stringify(opened.ids)}) await completeTaskSpace(id, { keep: false })
cliLog(JSON.stringify({ mark: 'closed' }))
`)

// The gate, arithmetically. Pooled over steps, not averaged over tasks: a task
// that escalated on step 2 is not the same weight as one that ran to step 12.
const totalSteps = results.reduce((sum, row) => sum + row.steps, 0)
const nonAdvancing = results.reduce((sum, row) => sum + row.non_advancing_steps, 0)
const done = results.filter((row) => row.status === 'done').length
const tokens = results.reduce((sum, row) => {
  const input = row.usage?.input_tokens ?? row.usage?.prompt_tokens ?? 0
  return sum + input
}, 0)

console.log(`\n${resultsPath}`)
console.log(`done ${done}/${results.length}, steps ${totalSteps}, escalation rate ${(nonAdvancing / totalSteps).toFixed(3)}`)
console.log(`input tokens ${tokens}, wall clock ${(results.reduce((sum, row) => sum + row.wall_ms, 0) / 60000).toFixed(1)} min`)
