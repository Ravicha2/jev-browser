// Probe 4 for #17: four questions, reported incrementally so a failure at the
// end keeps what came before.
//   1. does pageInfo().url carry the fragment?
//   2. where does the fragment jump land?
//   3. elementCenter's coordinate space, in view and off screen
//   4. does reveal() fire for a root anchor at 1666, and where does it land?
// Run with:  cat .scratch/probe4-reveal-17.js | ego-browser nodejs
const url = 'https://news.ycombinator.com/item?id=49717558'
const HREF = '#49718492'
const out = (label, value) => cliLog(`${label}: ${JSON.stringify(value)}`)

await useOrCreateTaskSpace('probe-17-reveal-baseline')
await openOrReuseTab(url, { wait: true, timeout: 30 })
await wait(3)

// 1 + 2: the fragment. Set it by hand and watch the url and the page.
out('clean', { sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url })
await js(`location.hash = ${JSON.stringify(HREF.slice(1))}`)
await wait(2)
out('afterFragmentJump', { sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url })
const targetTop = await js(`(() => {
  const el = document.getElementById('49718492')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { rectTop: r.top, absoluteTop: r.top + window.scrollY, height: r.height, tag: el.tagName, cls: el.className }
})()`)
out('fragmentTarget', targetTop)

// Back to a clean url and the top, then the anchor's own geometry.
await js('window.scrollTo(0, 0)')
await wait(1)
const anchorRect = await js(`(() => {
  const el = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === ${JSON.stringify(HREF)})
  const r = el.getBoundingClientRect()
  return { rectTop: r.top, height: r.height, absoluteTop: r.top + window.scrollY, sy: window.scrollY }
})()`)

const rootRef = async () => {
  const snap = await snapshotText()
  const lines = snap.split('\n')
  const hit = lines.find((line, index) => (
    /anchor \[ref=\d+/.test(line) && line.includes(HREF) && /"root"/.test(lines[index + 1] ?? '')
  ))
  return hit ? hit.match(/ref=(\d+)/)[1] : null
}

// 3: elementCenter, in view at scroll 0 and off screen at 1666.
const ref = await rootRef()
out('anchorRectAt0', { ref, rect: anchorRect, innerHeight: await js('window.innerHeight') })
out('elementCenterAt0', ref ? await elementCenter(ref) : null)
await js('window.scrollTo(0, 1666)')
await wait(1)
const refAway = await rootRef()
out('anchorRectAt1666', await js(`(() => {
  const el = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === ${JSON.stringify(HREF)})
  const r = el.getBoundingClientRect()
  return { rectTop: r.top, absoluteTop: r.top + window.scrollY }
})()`))
out('elementCenterAt1666', refAway ? await elementCenter(refAway) : null)

// 4: reveal(), verbatim.
if (refAway) {
  const center = await elementCenter(refAway)
  const viewHeight = await js('window.innerHeight')
  const guardBlocks = center.y >= 0 && center.y <= viewHeight
  out('revealGuard', { center, viewHeight, guardBlocks })
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
  out('afterReveal', { sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url })
}

// And the click from off anchor, with no reveal: does it work at all?
await js('window.scrollTo(0, 1666)')
await wait(1)
const refClick = await rootRef()
out('beforeClick', { sy: await js('window.scrollY'), hash: await js('location.hash'), ref: refClick })
if (refClick) await click(refClick, { label: 'probe click off screen' })
await wait(2)
out('afterClick', { sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url })
