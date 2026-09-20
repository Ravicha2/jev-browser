// jev-browser walking skeleton (issue #1).
//
// One round: open a page, snapshot it, ask Jev one Noul question, print one JSON
// object, exit. No pruning, no loop, no clicking. Everything later is a widening
// of this shape.
//
// Run:  ego-browser nodejs < scripts/skeleton.js
//
// Nothing can be passed in from the caller. Verified in the heredoc runtime:
//   argv          -> electron's own args, not ours
//   env overrides -> stripped by the launcher before the script runs
//   import.meta.dirname -> "/"
//   __filename    -> undefined
// HOME survives, so paths are derived from that, never supplied.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const MODEL = 'jev-latest'

// Goal-met threshold. spec.md, Confidence: exit done at >= 0.8.
const GOAL_MET = 0.8

// state is capped at 32k including the longest question; stay well under it.
const MAX_PAGE_CHARS = 12000

const fs = await import('node:fs')
const crypto = await import('node:crypto')

const HOME = process.env.HOME || ''

// The skill root, found rather than passed. The installed skill wins once it
// exists; the repo checkout is the fallback so this runs before packaging.
const ROOTS = [`${HOME}/.claude/skills/jev-browser`, `${HOME}/AgentOS/jev-browser`]
const ROOT = ROOTS.find((candidate) => fs.existsSync(`${candidate}/.env`)) || null

// Fixed, and it has to be: the caller cannot name a path, and one loop runs at a
// time. Not TMPDIR, which the OS reaps: a login handoff can sit overnight before
// the user confirms, and the task still has to resume. See spec.md Configuration.
const RUN_ROOT = `${HOME}/.claude/jev-browser`
const JOB_PATH = `${RUN_ROOT}/job.json`

const escalate = (reason, extra = {}) => ({
  status: 'escalate',
  reason,
  step: 0,
  page_fingerprint: null,
  partial_findings: [],
  ...extra,
})

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

// Jev has no structural invariants (spec.md, Limits), so check the shape before
// trusting the number rather than reading whatever came back.
function readNoul(response, id) {
  const answer = response?.answers?.[id]
  if (!answer || answer.type !== 'noul') throw new Error(`no noul answer under "${id}"`)
  const value = answer.noul
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`noul "${id}" outside 0..1`)
  }
  return value
}

const fingerprint = (url, pageText) =>
  crypto.createHash('sha256').update(`${url}\n${pageText}`).digest('hex').slice(0, 8)

async function main() {
  if (!ROOT) return escalate('skill_root_not_found', { partial_findings: ROOTS.map((r) => `tried ${r}`) })

  const job = JSON.parse(fs.readFileSync(JOB_PATH, 'utf8'))
  const key = await readKey()

  const task = await useOrCreateTaskSpace(job.task_space_id)
  await openOrReuseTab(job.start_url, { wait: true, timeout: 20 })
  const page = await snapshotText()
  const currentTab = await pageInfo()

  const state = {
    goal: job.goal,
    current_page: page.slice(0, MAX_PAGE_CHARS),
  }

  const response = await ask(
    {
      model: MODEL,
      state,
      questions: {
        goal_met: {
          type: 'noul',
          instructions: 'Does `current_page` already contain what `goal` asks for?',
          criteria: {
            true: 'The page states or directly contains the answer',
            false: 'It does not',
          },
        },
      },
    },
    key,
  )

  const goalMet = readNoul(response, 'goal_met')
  const common = {
    model: response.model,
    task_space_id: task.id,
    goal_met: goalMet,
    usage: response.usage ?? null,
  }

  if (goalMet >= GOAL_MET) {
    return {
      status: 'done',
      goal: job.goal,
      findings: [],
      steps: 1,
      url: currentTab.url,
      ...common,
    }
  }

  return escalate('goal_not_met', {
    step: 1,
    url: currentTab.url,
    page_fingerprint: fingerprint(currentTab.url, page),
    ...common,
  })
}

let result
try {
  result = await main()
} catch (error) {
  // One JSON object out, always, even on failure. The message never carries the key.
  result = escalate('error', { step: 0, detail: String(error && error.message ? error.message : error) })
}
cliLog(JSON.stringify(result))
