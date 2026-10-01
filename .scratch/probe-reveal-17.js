// Probe for #17: what actually moves the page when the loop clicks a
// same-page `root` anchor on the HN thread, and does reveal() fire for it?
// Run with:  cat .scratch/probe-reveal-17.js | ego-browser nodejs
const url = 'https://news.ycombinator.com/item?id=49717558'
const report = {}

const task = await useOrCreateTaskSpace('probe-17-reveal-baseline')
report.spaceId = task.id ?? task.spaceId ?? null
await openOrReuseTab(url, { wait: true, timeout: 30 })
await wait(3)
report.pageInfo = await pageInfo()

const rootRef = async () => {
  const snap = await snapshotText()
  const hits = snap.split('\n').filter((line) => /"root"/.test(line))
  report.rootSample = hits.slice(0, 3)
  for (const line of hits) {
    const match = line.match(/ref[=:](\d+)/)
    if (match) return match[1]
  }
  return null
}

const ref = await rootRef()
report.ref = ref
report.innerHeight = await js('window.innerHeight')
report.elementCenterAtTop = ref ? await elementCenter(ref) : null
report.rectAtTop = await js(`(() => {
  const a = [...document.querySelectorAll('a')].find((el) => el.textContent.trim() === 'root')
  if (!a) return null
  const r = a.getBoundingClientRect()
  return {
    count: [...document.querySelectorAll('a')].filter((el) => el.textContent.trim() === 'root').length,
    rectTop: r.top,
    rectHeight: r.height,
    absoluteTop: r.top + window.scrollY,
    absoluteCenter: r.top + r.height / 2 + window.scrollY,
    href: a.getAttribute('href'),
    hash: location.hash,
    sy: window.scrollY,
  }
})()`)

if (ref) {
  // Away from the anchor, as the run's read-scroll left it (step 7: 1666).
  await js('window.scrollTo(0, 1666)')
  await wait(1)
  const center = await elementCenter(ref)
  const viewHeight = await js('window.innerHeight')
  const guardBlocks = center.y >= 0 && center.y <= viewHeight
  report.at1666 = { center, guardBlocks }
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
  report.afterReveal = { sy: await js('window.scrollY'), hash: await js('location.hash'), revealed: !guardBlocks }
  report.rectAfterReveal = await js(`(() => {
  const a = [...document.querySelectorAll('a')].find((el) => el.textContent.trim() === 'root')
  const r = a.getBoundingClientRect()
  return { rectTop: r.top, absoluteTop: r.top + window.scrollY, sy: window.scrollY }
})()`)

  // The click. Does it move the page at all?
  const hashBeforeClick = await js('location.hash')
  await click(ref, { label: 'probe click 1' })
  await wait(2)
  report.click1 = {
    syBefore: report.afterReveal.sy,
    hashBefore: hashBeforeClick,
    syAfter: await js('window.scrollY'),
    hashAfter: await js('location.hash'),
    url: (await pageInfo()).url,
  }

  // The same anchor again, from where the last click left it.
  await js('window.scrollTo(0, 1666)')
  await wait(1)
  const ref2 = await rootRef()
  const center2 = await elementCenter(ref2)
  const guard2 = center2.y >= 0 && center2.y <= viewHeight
  report.at1666Again = { ref2, center: center2, guardBlocks: guard2 }
  const hashBeforeClick2 = await js('location.hash')
  await click(ref2, { label: 'probe click 2' })
  await wait(2)
  report.click2 = {
    syBefore: 1666,
    hashBefore: hashBeforeClick2,
    syAfter: await js('window.scrollY'),
    hashAfter: await js('location.hash'),
    url: (await pageInfo()).url,
  }

  // And once more from the anchor's own position.
  const ref3 = await rootRef()
  await click(ref3, { label: 'probe click 3' })
  await wait(2)
  report.click3 = { syAfter: await js('window.scrollY') }
}

cliLog(JSON.stringify(report, null, 2))
