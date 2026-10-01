// Probe 6 for #17: the run's step 8 -> step 9 sequence, verbatim.
//   hash already set -> page away from the comment -> reveal -> click.
// Does the click re-scroll to the fragment, or does the page stay where the
// reveal left it?
// Run with:  cat .scratch/probe6-reveal-17.js | ego-browser nodejs
const url = 'https://news.ycombinator.com/item?id=49717558'
const HREF = '#49718492'
const out = (label, value) => cliLog(`${label}: ${JSON.stringify(value)}`)

await useOrCreateTaskSpace('probe-17-reveal-baseline')
await openOrReuseTab(url, { wait: true, timeout: 30 })
await wait(3)

const rootRef = async () => {
  const snap = await snapshotText()
  const lines = snap.split('\n')
  const hit = lines.find((line, index) => (
    /anchor \[ref=\d+/.test(line) && line.includes(HREF) && /"root"/.test(lines[index + 1] ?? '')
  ))
  return hit ? hit.match(/ref=(\d+)/)[1] : null
}

const reveal = async (ref) => {
  const center = await elementCenter(ref)
  const viewHeight = await js('window.innerHeight')
  const guardBlocks = center.y >= 0 && center.y <= viewHeight
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
  return { center, viewHeight, revealed: !guardBlocks }
}

// A: the first click, from a clean url, off anchor (the run's step 4).
await js('window.scrollTo(0, 683)')
await wait(1)
const refA = await rootRef()
out('A_before', { sy: await js('window.scrollY'), hash: await js('location.hash'), ref: refA })
const revealA = await reveal(refA)
const refA2 = await rootRef()
const clickA = refA2 ? await click(refA2, { label: 'probe A' }).then(() => 'ok', (e) => `threw ${e.message}`) : 'no ref'
await wait(2)
out('A_afterClick', { reveal: revealA, click: clickA, sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url })

// B: away, then the reveal, then the click with the hash already set — the
//    run's step 8 -> step 9.
await js('window.scrollTo(0, 1666)')
await wait(1)
const refB = await rootRef()
out('B_before', { sy: await js('window.scrollY'), hash: await js('location.hash'), ref: refB })
const revealB = await reveal(refB)
out('B_afterReveal', { reveal: revealB, sy: await js('window.scrollY') })
const refB2 = await rootRef()
const clickB = refB2 ? await click(refB2, { label: 'probe B' }).then(() => 'ok', (e) => `threw ${e.message}`) : 'no ref'
await wait(2)
out('B_afterClick', { click: clickB, sy: await js('window.scrollY'), hash: await js('location.hash'), url: (await pageInfo()).url })

// C: and again, from the comment's own position (the run's step 5 and 9).
const refC = await rootRef()
out('C_before', { sy: await js('window.scrollY'), ref: refC })
const revealC = await reveal(refC)
const refC2 = await rootRef()
const clickC = refC2 ? await click(refC2, { label: 'probe C' }).then(() => 'ok', (e) => `threw ${e.message}`) : 'no ref'
await wait(2)
out('C_afterClick', { reveal: revealC, click: clickC, sy: await js('window.scrollY'), url: (await pageInfo()).url })
