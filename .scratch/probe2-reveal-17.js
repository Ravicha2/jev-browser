// Probe 2 for #17: locate the root anchor the run clicked (its target sits at
// absolute top ~299.5), learn elementCenter's coordinate space, and find what
// moves the page: the reveal scroll or the click's fragment jump.
// Run with:  cat .scratch/probe2-reveal-17.js | ego-browser nodejs
const url = 'https://news.ycombinator.com/item?id=49717558'
const report = {}

await useOrCreateTaskSpace('probe-17-reveal-baseline')
await openOrReuseTab(url, { wait: true, timeout: 30 })
await wait(3)
report.sy0 = await js('window.scrollY')

// Snapshot structure around a root anchor, so the ref can be read off.
const snap = await snapshotText({ scope: 'only_within_viewport' })
const lines = snap.split('\n')
const firstRoot = lines.findIndex((line) => line.includes('"root"'))
report.snapshotAroundRoot = lines.slice(Math.max(0, firstRoot - 4), firstRoot + 3)

// Every root anchor, with the geometry the run's anchor had.
const anchors = await js(`(() => {
  return [...document.querySelectorAll('a')]
    .filter((el) => el.textContent.trim() === 'root')
    .map((el, index) => {
      const r = el.getBoundingClientRect()
      return { index, href: el.getAttribute('href'), rectTop: r.top, absoluteTop: r.top + window.scrollY, height: r.height }
    })
})()`)
const near299 = anchors.reduce((best, a) => (Math.abs(a.absoluteTop - 299.5) < Math.abs(best.absoluteTop - 299.5) ? a : best), anchors[0])
report.anchorCount = anchors.length
report.near299 = near299
report.firstThree = anchors.slice(0, 3)

// elementCenter's coordinate space: read it at scroll 0 and at 1666 for the
// same element, and compare with that element's own rect.
const refLine = lines.find((line) => /ref[=:]?\d+/.test(line) && line.includes('root'))
report.refLine = refLine ?? null
const refMatch = refLine && refLine.match(/ref[=:]?(\d+)/)
const ref = refMatch ? refMatch[1] : null
report.ref = ref

const measure = async (label) => ({
  label,
  sy: await js('window.scrollY'),
  elementCenter: ref ? await elementCenter(ref) : null,
  rect: await js(`(() => {
    const el = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === ${JSON.stringify(near299.href)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { rectTop: r.top, absoluteTop: r.top + window.scrollY }
  })()`),
})

report.at0 = await measure('page at 0')
await js('window.scrollTo(0, 1666)')
await wait(1)
report.at1666 = await measure('page at 1666')
report.innerHeight = await js('window.innerHeight')

cliLog(JSON.stringify(report, null, 2))
