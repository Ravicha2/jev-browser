// Probe 3 for #17: the decisive one. elementCenter's coordinate space, whether
// reveal() fires for a root anchor, and what moves the page when that anchor is
// clicked twice from an off-anchor position.
// Run with:  cat .scratch/probe3-reveal-17.js | ego-browser nodejs
const url = 'https://news.ycombinator.com/item?id=49717558'
const HREF = '#49718492'
const report = {}

await useOrCreateTaskSpace('probe-17-reveal-baseline')
await openOrReuseTab(url, { wait: true, timeout: 30 })
await wait(3)

// The `root` anchor's ref: the accessibility line carries the ref and the url,
// the `text "root"` child carries neither.
const rootRef = async (scope) => {
  const snap = await snapshotText(scope ? { scope } : undefined)
  const lines = snap.split('\n')
  const hit = lines.find((line, index) => (
    /anchor \[ref=\d+/.test(line) && line.includes(HREF) && /"root"/.test(lines[index + 1] ?? '')
  ))
  return hit ? hit.match(/ref=(\d+)/)[1] : null
}
const rectOf = async () => js(`(() => {
  const el = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === ${JSON.stringify(HREF)})
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { rectTop: r.top, height: r.height, absoluteTop: r.top + window.scrollY, sy: window.scrollY }
})()`)

const refAtZero = await rootRef('only_within_viewport')
report.refAtZero = refAtZero
report.atZero = { rect: await rectOf(), elementCenter: refAtZero ? await elementCenter(refAtZero) : null }
report.innerHeight = await js('window.innerHeight')

// Off-anchor, where the run's read-scroll left it.
await js('window.scrollTo(0, 1666)')
await wait(1)
const refAway = await rootRef()
report.refAway = refAway
report.at1666 = { rect: await rectOf(), elementCenter: refAway ? await elementCenter(refAway) : null }

// reveal(), verbatim from explore.js.
if (refAway) {
  const center = await elementCenter(refAway)
  const viewHeight = await js('window.innerHeight')
  const guardBlocks = center.y >= 0 && center.y <= viewHeight
  report.reveal = { center, viewHeight, guardBlocks }
  if (!guardBlocks) {
    const offset = Math.round(center.y)
    await js(`(() => {
      window.scrollTo(0, Math.max(0, ${offset} - window.innerHeight / 2))
      for (const el of document.querySelectorAll('*')) {
        if (el !== document.documentElement && el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 100) {
          el.scrollTop = Math.max(0, ${offset} - el.clientHeight / 2)
        }
      }
    })()`)
  }
  await wait(1)
  report.afterReveal = { sy: await js('window.scrollY'), hash: await js('location.hash') }
}

// The click, from off-anchor, with no reveal first.
await js('window.scrollTo(0, 1666)')
await wait(1)
const refClick1 = await rootRef()
report.beforeClick1 = { sy: await js('window.scrollY'), hash: await js('location.hash'), ref: refClick1 }
if (refClick1) await click(refClick1, { label: 'probe click 1' })
await wait(2)
report.afterClick1 = { sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url }

// The same anchor again, from off-anchor.
await js('window.scrollTo(0, 1666)')
await wait(1)
const refClick2 = await rootRef()
report.beforeClick2 = { sy: await js('window.scrollY'), hash: await js('location.hash'), ref: refClick2 }
if (refClick2) await click(refClick2, { label: 'probe click 2' })
await wait(2)
report.afterClick2 = { sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url }

cliLog(JSON.stringify(report, null, 2))
