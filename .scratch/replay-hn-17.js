// Evidence for #17: replay the recorded HN run's own trace through the loop's
// progress bookkeeping under three baseline rules, using the real guards
// imported from the file under test.
//
//   pre-action  the baseline is the state the action started in (the defect, as
//               recorded) — must reproduce the run's own exit
//   post-reveal the baseline is taken between reveal() and the click (the
//               issue's literal fix line) — measured: the click then follows the
//               anchor's href and moves the page again, so this must not flip the
//               run either
//   post-action the baseline is read once the whole action is over (the fix)
//
// The action's landing is the next recorded observation, which is the position
// the browser was actually in after acting.
const fs = await import('node:fs')
const os = await import('node:os')
// Importing the module runs its own bottom-of-file branch: argv[1] is this
// script, so the loop branch would look for a browser. Point it at the file's
// own name so the import lands on the self-check instead.
process.argv[1] = 'explore.js'
const { progressAfter, preflight, actedBaseline } = await import(
  new URL('../scripts/explore.js', import.meta.url).href
)

const RUN = `${os.homedir()}/.claude/jev-browser/runs/2026-09-21T11-59-15-863Z-find-what-people-are-saying-about-jev-th/trace.jsonl`
const steps = fs.readFileSync(RUN, 'utf8').trim().split('\n')
  .map((line) => { try { return JSON.parse(line) } catch { return null } })
  .filter(Boolean)

const BUDGET = 12
// Measured on the live page: the `root` anchor's target sits at 299.5, and an
// anchor above the fold lands reveal()'s scroll at 0.
const ANCHOR_TOP = 512.33
const REVEAL_LANDING = 0

const acted = (entry) => entry.decision.startsWith('click') || entry.decision.startsWith('scroll')
const landing = (entry, index) => steps[index + 1]?.sy ?? entry.sy

const replay = (rule) => {
  let progress = { lastFingerprint: null, lastSy: null, noProgress: 0 }
  for (const [index, entry] of steps.entries()) {
    // The loop's order: compare the observation, run the guards, act, then write
    // the baseline the next step compares against.
    progress = progressAfter(progress, { fingerprint: entry.fingerprint, sy: entry.sy })
    const exit = preflight({
      step: entry.step,
      budget: BUDGET,
      candidates: Array.from({ length: entry.candidates }, (_, at) => ({ ref: `@${at}` })),
      commitOnly: false,
      fingerprint: entry.fingerprint,
      noProgress: progress.noProgress,
      visited: new Set(),
      escalated: new Set(),
    })
    if (exit) return `${exit.reason} at step ${entry.step} (count was ${progress.noProgress})`
    if (!acted(entry)) continue
    const after = rule === 'post-action' ? landing(entry, index) : null
    const betweenHalves = rule === 'post-reveal' && entry.decision.startsWith('click') && entry.sy > ANCHOR_TOP
      ? REVEAL_LANDING
      : null
    progress = actedBaseline(progress, {
      fingerprint: entry.fingerprint,
      sy: after ?? betweenHalves ?? entry.sy,
    })
  }
  return 'never exited'
}

console.log('recorded exit         ', steps.at(-1).decision)
for (const rule of ['pre-action', 'post-reveal', 'post-action']) {
  console.log(`${rule.padEnd(21)} `, replay(rule))
}
