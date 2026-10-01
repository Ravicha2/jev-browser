// Probe 3 (#30): the tree has a `state=` annotation. Where does it land, and
// does it land on the control that would be clicked, or on an ancestor?
await useOrCreateTaskSpace('offer-shape-probe')
await gotoAndWait('https://www.linkedin.com/jobs/search?keywords=AI', { timeout: 30 })
await new Promise((r) => setTimeout(r, 3000))
const page = await snapshotText()
const lines = page.split('\n')
const withState = lines.filter((l) => /\bstate=/.test(l))
const idx = lines.findIndex((l) => /currentJobId/.test(l))
const jobList = lines.filter((l) => /\bref=(4[0-9]|5[0-9])\b/.test(l))
cliLog(JSON.stringify({
  state_lines: withState.slice(0, 20),
  state_count: withState.length,
  job_rows: jobList.slice(0, 16),
  around: lines.slice(idx > 0 ? idx - 2 : 0, idx > 0 ? idx + 3 : 5),
}, null, 2))
