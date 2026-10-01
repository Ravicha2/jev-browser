// Probe (#30): what does snapshotText() actually annotate a candidate with?
// The offer shape wants position and state per row, so this asks the live tree
// which attributes exist before any code depends on one.
const task = await useOrCreateTaskSpace('offer-shape-probe')
await gotoAndWait('https://www.linkedin.com/jobs/search?keywords=AI', { timeout: 30 })
await new Promise((r) => setTimeout(r, 3000))
const page = await snapshotText()
const visible = await snapshotText({ scope: 'only_within_viewport' })
const lines = page.split('\n')
const refLines = lines.filter((line) => /\bref=/.test(line))
const keys = new Set()
for (const match of page.matchAll(/\[([^\]]*)\]/g)) {
  for (const pair of match[1].split(',')) keys.add(pair.trim().split('=')[0])
}
const info = await pageInfo()
cliLog(JSON.stringify({
  url: info.url,
  page_chars: page.length,
  visible_chars: visible.length,
  tree_lines: lines.length,
  ref_lines: refLines.length,
  annotation_keys: [...keys],
  first_ref_lines: refLines.slice(0, 30),
  state_mentions: lines.filter((line) => /aria-|selected|expanded|current|checked|pressed|active/i.test(line)).slice(0, 30),
}, null, 2))
