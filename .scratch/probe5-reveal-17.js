// Probe 5 for #17: the run's own click, from a clean url off anchor, then again.
// Run with:  cat .scratch/probe5-reveal-17.js | ego-browser nodejs
const url = 'https://news.ycombinator.com/item?id=49717558'
const HREF = '#49718492'
const out = (label, value) => cliLog(`${label}: ${JSON.stringify(value)}`)

await useOrCreateTaskSpace('probe-17-reveal-baseline')
await openOrReuseTab(url, { wait: true, timeout: 30 })
await wait(3)
out('start', { sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url })

const rootRef = async () => {
  const snap = await snapshotText()
  const lines = snap.split('\n')
  const hit = lines.find((line, index) => (
    /anchor \[ref=\d+/.test(line) && line.includes(HREF) && /"root"/.test(lines[index + 1] ?? '')
  ))
  return hit ? hit.match(/ref=(\d+)/)[1] : null
}

// Off anchor, exactly where the run's read-scroll left it.
await js('window.scrollTo(0, 1666)')
await wait(1)
const ref1 = await rootRef()
out('beforeClick1', { sy: await js('window.scrollY'), hash: await js('location.hash'), ref: ref1 })
if (ref1) {
  try {
    await click(ref1, { label: 'probe click 1' })
    out('click1Result', 'ok')
  } catch (error) {
    out('click1Result', `threw: ${error.message}`)
  }
}
await wait(2)
out('afterClick1', { sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url })

// The same anchor again, from off anchor.
await js('window.scrollTo(0, 1666)')
await wait(1)
const ref2 = await rootRef()
out('beforeClick2', { sy: await js('window.scrollY'), hash: await js('location.hash'), ref: ref2 })
if (ref2) {
  try {
    await click(ref2, { label: 'probe click 2' })
    out('click2Result', 'ok')
  } catch (error) {
    out('click2Result', `threw: ${error.message}`)
  }
}
await wait(2)
out('afterClick2', { sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url })
