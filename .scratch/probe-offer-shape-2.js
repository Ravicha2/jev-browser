// Probe 2 (#30): does the DOM carry per-row state, and does the accessibility
// tree annotation keep it? A click target's state has to come from somewhere,
// and this asks which source actually has it.
await useOrCreateTaskSpace('offer-shape-probe')
await gotoAndWait('https://www.linkedin.com/jobs/search?keywords=AI', { timeout: 30 })
await new Promise((r) => setTimeout(r, 3000))
const page = await snapshotText()
const lines = page.split('\n')
const keys = new Set()
for (const match of page.matchAll(/\[([^\]]*)\]/g)) {
  for (const pair of match[1].split(',')) keys.add(pair.trim().split('=')[0])
}
const stateCounts = await js(`(() => {
  const out = {}
  for (const attr of ['aria-current', 'aria-selected', 'aria-expanded', 'aria-checked', 'aria-pressed', 'data-is-active', 'class']) {
    const all = document.querySelectorAll('[' + attr + ']')
    out[attr] = all.length
  }
  out.activeClass = document.querySelectorAll('[class*="active"]').length
  out.jumpTexts = [...document.querySelectorAll('button, a')].filter((el) => /Jump to/.test(el.textContent || '')).map((el) => ({ text: el.textContent.trim().slice(0, 40), tag: el.tagName, href: (el.getAttribute('href') || '').slice(0, 60) }))
  const cur = [...document.querySelectorAll('[aria-current]')].slice(0, 6).map((el) => ({ tag: el.tagName, value: el.getAttribute('aria-current'), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60) }))
  const sel = [...document.querySelectorAll('[aria-selected]')].slice(0, 6).map((el) => ({ tag: el.tagName, value: el.getAttribute('aria-selected'), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60) }))
  const exp = [...document.querySelectorAll('[aria-expanded]')].slice(0, 6).map((el) => ({ tag: el.tagName, value: el.getAttribute('aria-expanded'), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60) }))
  return { counts: out, ariaCurrent: cur, ariaSelected: sel, ariaExpanded: exp }
})()`)
cliLog(JSON.stringify({
  url: (await pageInfo()).url,
  page_chars: page.length,
  tree_lines: lines.length,
  ref_lines: lines.filter((l) => /\bref=/.test(l)).length,
  annotation_keys: [...keys],
  head_lines: lines.slice(0, 12),
  state: stateCounts,
}, null, 2))
