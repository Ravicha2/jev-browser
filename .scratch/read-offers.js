// Read the offer/pick out of every trace on disk (#30). Usage:
//   node .scratch/read-offers.js            all runs
//   node .scratch/read-offers.js <run-dir>... only those
const fs = require('node:fs')
const path = require('node:path')
const RUNS = `${process.env.HOME}/.claude/jev-browser/runs`

const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(RUNS).filter((name) => name.startsWith('2026-09-22T1')).map((name) => path.join(RUNS, name))

const windows = [10, 15, 25]
const rows = []
const stepTally = {}
for (const dir of dirs) {
  const trace = path.join(dir, 'trace.jsonl')
  if (!fs.existsSync(trace)) continue
  const lines = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const kind = String(entry.decision ?? '').split(':')[0].split(' ')[0]
    stepTally[kind] = (stepTally[kind] ?? 0) + 1
    if (entry.offered && entry.picked_index != null) {
      rows.push({
        run: path.basename(dir).slice(11, 23),
        step: entry.step,
        offered: entry.offered.length,
        picked_index: entry.picked_index,
        inWindows: Object.fromEntries(windows.map((w) => [w, entry.picked_index < w])),
        states: entry.states ?? null,
      })
    }
  }
}
console.log(JSON.stringify({ runs: dirs.length, stepTally, picks: rows }, null, 1))
const inside = Object.fromEntries(windows.map((w) => [w, rows.filter((row) => row.picked_index < w).length]))
console.log(`picks: ${rows.length}, inside ${JSON.stringify(inside)}`)
