// The #30 before/after table, straight off the traces on disk.
const fs = require('node:fs')
const path = require('node:path')
const RUNS = `${process.env.HOME}/.claude/jev-browser/runs`

const all = fs.readdirSync(RUNS).filter((name) => name.startsWith('2026-09-22T'))
const pick = (prefixes) => all.filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))

const GROUPS = {
  'morning #27 batch, flat (07:3*)': pick(['2026-09-22T07-3']),
  'afternoon flat, 11:50 window': pick(['2026-09-22T11-50', '2026-09-22T11-51-1', '2026-09-22T11-51-3', '2026-09-22T11-51-5']),
  'afternoon flat, 11:56 window': pick(['2026-09-22T11-56']),
  'flat, #27 scenario (11:59)': pick(['2026-09-22T11-59-2', '2026-09-22T11-59-3', '2026-09-22T11-59-4']),
  'numbered + state (11:55)': pick(['2026-09-22T11-54', '2026-09-22T11-55']),
  'numbered + state, #27 scenario (11:58)': pick(['2026-09-22T11-58', '2026-09-22T11-59-0']),
  'numbered, no state (12:00)': pick(['2026-09-22T12-00']),
  'numbered + state, title goal (11:57)': pick(['2026-09-22T11-57']),
}

for (const [label, dirs] of Object.entries(GROUPS)) {
  const confidences = []
  const decisions = {}
  let steps = 0
  let picks = []
  for (const name of dirs) {
    const trace = path.join(RUNS, name, 'trace.jsonl')
    if (!fs.existsSync(trace)) continue
    for (const line of fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean)) {
      const entry = JSON.parse(line)
      steps += 1
      const kind = String(entry.decision ?? '').split(':')[0].split(' ')[0]
      decisions[kind] = (decisions[kind] ?? 0) + 1
      const next = entry.answers?.next_target
      if (next && typeof next.confidence === 'number') confidences.push(next.confidence)
      if (entry.offered && entry.picked_index != null) picks.push(entry.picked_index)
    }
  }
  const sorted = [...confidences].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
  const weak = confidences.filter((value) => value < 0.5).length
  console.log([
    label.padEnd(40),
    `runs ${String(dirs.length).padStart(2)}`,
    `steps ${String(steps).padStart(3)}`,
    `next ${String(confidences.length).padStart(3)}`,
    `median ${median}`,
    `<0.5 ${String(weak).padStart(2)}/${String(confidences.length).padStart(2)}`,
    `picks@[${picks.join(',')}]`,
    JSON.stringify(decisions),
  ].join('  '))
}
