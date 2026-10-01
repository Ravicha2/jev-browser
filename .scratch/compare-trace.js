// Before/after reading over the LinkedIn traces (#30). Usage:
//   node .scratch/compare-trace.js <run-dir>...
const fs = require('node:fs')
const path = require('node:path')

const stepTally = {}
const confidences = []
const picks = []
for (const dir of process.argv.slice(2)) {
  const trace = path.join(dir, 'trace.jsonl')
  if (!fs.existsSync(trace)) { console.log('missing', dir); continue }
  const run = path.basename(dir)
  for (const line of fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(line)
    const kind = String(entry.decision ?? '').split(':')[0].split(' ')[0]
    stepTally[kind] = (stepTally[kind] ?? 0) + 1
    const next = entry.answers?.next_target
    if (next && typeof next.confidence === 'number') confidences.push({ run, step: entry.step, confidence: next.confidence, decision: entry.decision })
    if (entry.offered && entry.picked_index != null) picks.push(entry.picked_index)
  }
}
const values = confidences.map((row) => row.confidence)
const sorted = [...values].sort((a, b) => a - b)
console.log('steps by decision:', stepTally)
console.log('next_target answers:', values.length)
console.log('confidence: min', sorted[0], 'median', sorted[Math.floor(sorted.length / 2)], 'max', sorted[sorted.length - 1])
console.log('below 0.5:', values.filter((v) => v < 0.5).length, 'of', values.length)
console.log('picked_index values:', picks.join(','))
console.log('picks inside first 10/15/25:', [10, 15, 25].map((w) => picks.filter((i) => i < w).length).join('/'), `of ${picks.length}`)
