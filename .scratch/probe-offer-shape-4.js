// Probe 4 (#30): the offer exactly as the loop builds it, in order, with
// labels. Answers "where does the first job listing actually sit" with the
// loop's own prune, not by eye.
await useOrCreateTaskSpace('jev-linkedin-ai-jobs-smoke')
await gotoAndWait('https://www.linkedin.com/jobs/search/?currentJobId=4463321659&keywords=AI', { timeout: 30 })
await new Promise((r) => setTimeout(r, 3000))
const visible = await snapshotText({ scope: 'only_within_viewport' })
const page = await snapshotText()
const info = await pageInfo()
const { candidates } = pruneDetail(page, { visibleRefs: [...new Set([...visible.matchAll(/\bref=(\d+)/g)].map((m) => m[1]))], currentUrl: info.url })
cliLog(JSON.stringify({
  url: info.url,
  count: candidates.length,
  rows: candidates.map((candidate, index) => `${index + 1}. ${candidate.label.slice(0, 70)}${candidate.url ? '' : ' [no url]'}`),
}, null, 1))
