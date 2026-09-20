# Thresholds, and the M1 gate

Every tunable number in `scripts/explore.js` and `scripts/prune.js`, its current
value, and what it trades off. Plus the M1 (#4) measurement that says whether the
thresholds are the thing to tune at all.

M1 is the decision gate for the whole project: if Jev's pick is good, build the
form-filling vocabulary next; if it is not, the answer is a code change in
pruning, not a wider vocabulary. The verdict is at the bottom.

## The measurement

| | |
|---|---|
| Site | `nodejs.org/docs/latest/api/`, every task starting from the API index |
| Goals | 10, in `m1-goals.json` |
| Harness | `scripts/measure.js m1-goals.json` |
| Model answered | `jev-1.13.0` in every step of all three runs (the `jev-latest` alias), so they are comparable |
| Run of record | `~/.claude/jev-browser/runs/m1-2026-09-20T15-03-48/results.jsonl` |
| Repeats | `.../m1-2026-09-20T14-55-21/` and `.../m1-2026-09-20T14-59-19/` |

Each goal is a single fact that lives on a page you must navigate to from the
index, so no task is answerable from the landing page. Every answer was confirmed
present on a reachable page before the run, so a `done` can be checked rather than
trusted.

The two repeat runs used the goals as first written. Goals 5 and 7 were then
reworded, and the run of record uses the amended set, because both originals
presupposed text the docs do not contain: that `cluster` documents deciding its own
worker count, and that `child_process.html` names an error code for `maxBuffer`. As
written, those two tasks were unanswerable rather than hard. This is worth stating
because it changes how one earlier result reads, and because a goal the page cannot
satisfy is indistinguishable from a bad pick unless you check.

**A step is non-advancing when it is a retry, a discard by the freshness guard, or
the escalation that ended the round.** That is the cost the gate is about, and it is
pooled over steps rather than averaged over tasks, because a task that escalated on
step 2 is not the same weight as one that ran to step 12.

### Per-task, run of record

| # | goal (short) | exit | reason | steps | clicks | retries | rate | wall | in tok | out tok |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `--inspect` default host:port | escalate | `no_progress` | 10 | 7 | 2 | 0.30 | 35.7s | 39,558 | 4,616 |
| 2 | `node:sqlite` added-in version | escalate | `cannot_choose` | 2 | 0 | 1 | 1.00 | 4.7s | 6,523 | 692 |
| 3 | type-stripping flag rename | escalate | `repeat_page` | 4 | 3 | 0 | 0.25 | 19.3s | 11,643 | 1,317 |
| 4 | Permission Model modes | escalate | `repeat_page` | 6 | 4 | 1 | 0.33 | 16.1s | 20,079 | 2,292 |
| 5 | worker count in the cluster example | escalate | `invalid_response` | 4 | 3 | 0 | 0.25 | 11.2s | 16,154 | 1,864 |
| 6 | `node:sqlite` sync class name | escalate | `cannot_choose` | 2 | 0 | 1 | 1.00 | 3.2s | 6,517 | 692 |
| 7 | `maxBuffer` limits and default | **done** | | 3 | 2 | 0 | 0.00 | 9.1s | 13,284 | 1,427 |
| 8 | test runner watch mode | escalate | `low_confidence` | 3 | 1 | 1 | 0.67 | 5.2s | 11,355 | 1,218 |
| 9 | File System Permissions default | escalate | `cannot_choose` | 2 | 0 | 1 | 1.00 | 2.3s | 6,531 | 689 |
| 10 | `--inspect-wait` first version | escalate | `invalid_response` | 6 | 3 | 2 | 0.50 | 13.4s | 24,537 | 2,819 |

Totals: **42 steps, 1 done, escalation rate 0.429, 156,181 input tokens (17,626
out), 120s of wall clock.**

| Run | Goals | Done | Steps | Escalation rate | Input tokens |
|---|---|---|---|---|---|
| A | as first written | 0/10 | 40 | 0.525 | 133,416 |
| B | as first written | 0/10 | 50 | 0.500 | 172,484 |
| C | **of record**, goals 5 and 7 amended | **1/10** | 42 | **0.429** | 156,181 |
| pooled | | 1/30 | 132 | 0.485 | 462,081 |

Exit reasons across all 30 task-runs: `repeat_page` 10, `cannot_choose` 9,
`low_confidence` 4, `no_progress` 4, `invalid_response` 2, `done` 1.

## The gate

**No-go. Escalation rate 0.429 in the run of record (0.500 and 0.525 in the two
earlier runs, 0.485 pooled), and 1 of 10 tasks reached `done`.**

One thing to say plainly before the verdict, because the gate as written does not
decide this on its own: the rule is under about 20% continue, over 50% prune
harder, and **0.429 falls in the band neither clause covers.** The two earlier runs
sit on the 50% line rather than past it. So the rate is not what carries the
decision. Two other readings do:

- **Success was 1 of 10.** Ten percent, and that one arrived only after its goal was
  corrected to ask for something the page actually states.
- **Of the 9 failures in the run of record, 8 trace to a defect in code rather than
  to Jev's judgment.** Task 7, the only task whose destination link was actually in
  its candidate list, walked the index to `child_process.html` to the
  `exec()` anchor in two clicks and exited `done` with no retry. When the list is
  fair, the pick is right.

That second point is the one that matters. The gate was meant to measure the quality
of the pick. It cannot, because in 8 of 10 tasks Jev was never shown a candidate
list containing the destination. **The measurement is a no-go, and it is also
inconclusive about the pick.** Fix the observation, then re-run M1; the pick's
quality is not readable from these numbers.

## What actually failed

Three modes, and the first accounts for eight tasks.

### 1. The viewport decides what Jev may click (8 of 9 failures)

`observe()` builds both channels Jev gets from the viewport-scoped tree: the
candidate list, and `state.current_page`. Pruning step 3 then drops every node not
in the viewport. Nothing in the loop can scroll or reveal, because its only action
is clicking a candidate. So the loop is a single-screen loop by construction, on any
page taller than the window.

Measured, on the two page shapes these goals start from:

| Page | Height | Refs in full tree | Refs in viewport | Dropped | Candidates left |
|---|---|---|---|---|---|
| API index | 2,310px | 150 | 40 | 110 | 21 |
| `cli.html` | 84,262px | 1,251 | 43 | 1,208 | 37 |

On the index specifically: `sqliteInCandidates: false` while `sqliteInFullTree: true`.
The `SQLite` link sits at y=1923 in a 683px viewport. The 21 surviving candidates are
the alphabetical head of the module list, `Node.js` through `Deprecated APIs`. Every
module from Diagnostics Channel to Zlib is invisible to Jev, and it is not a ranking
failure: code removed them before the question was asked. Jev answered
`cannot_choose`, which is correct given what it was shown. That is tasks 2, 6, and 9.

It produces two further symptoms on a long page:

- **`no_progress` and `repeat_page` (tasks 1, 3, 4).** On `cli.html` the 37 candidates
  are the sidebar: other modules' nav links plus the current page's own title.
  `--inspect` is at character 31,993 of the full tree and absent from the visible one.
  The only candidate that looks relevant to a CLI-flag goal is `Command-line options`,
  which is the page itself, so Jev clicks it, the page does not change, and it clicks
  it again. Task 1 does that three times, then drifts to `Debugger`.
- **`low_confidence` (task 8).** For a test-runner goal Jev chose `Assertion
  testing`, because `Test runner` is below the fold and nothing better was on offer.
  A wrong pick, forced by the list.

### 2. An in-page jump is not progress (task 1, and half of the `repeat_page` family)

Task 1 is the interesting one, because Jev twice found the right content and the loop
still failed. On `debugger.html` it picked `V8 inspector integration for Node.js`,
which is where the `--inspect` default lives, and clicked that same ref three times.
Each click produced no page change, so the no-progress guard counted three dead
actions and ended the round at step 10.

Clicking an in-page anchor is how a docs site works, and the loop has no way to count
it as progress and no extract step to harvest it. This is the same single-screen root
cause as mode 1, but it is a distinct thing to fix: *what counts as progress*, not
just *which candidates are offered*.

### 3. The answer disagrees with itself (2 of 10, tasks 5 and 10)

Both exits are `invalid_response` with a detail of `argmax is not the chosen id`: the
`choice` field names one candidate while the `probabilities` peak on another. The
validator refused to click, which is exactly the behaviour `spec.md` asks for, and a
tie or a spread would have been handled as `low_confidence` instead.

It cost 10 of the 42 steps. It is also the only failure mode here that is about the
answer rather than the observation. Whether it is worth handling in code (for
example, re-asking once when the two fields disagree, as the retry path already does
for `low_confidence`) is a separate question from the prune, and two occurrences is
not enough to tune on.

## The tunables

Read this column by column: several of these numbers never fired in 132 steps, so
they are not evidence-backed, and saying so is the point of the table.

| Tunable | Value | Trades off | Evidence from M1 |
|---|---|---|---|
| `MODEL` | `jev-latest` | An alias moves under you; a pin is reproducible but needs manual bumps. | Resolved to `jev-1.13.0` in every step of all three runs. **Not pinned yet**: the issue pins it once the thresholds are set, and this gate is a no-go. |
| `GOAL_MET` | 0.8 | Lower exits `done` on a half-answer; higher burns steps then escalates. | Fired once, on task 7, and correctly: the two-clicks-in, `done`-out round is the shape the threshold is for. One data point is not a calibration. |
| `NEXT_TARGET_CONFIDENCE` | 0.5 | Higher rejects more picks into the retry; lower turns shaky picks into clicks. | **The most-fired threshold.** The retry path was entered 35 times across 132 steps: 15 times on `low_confidence` in the two runs that kept trails, and 11 retries in the first run. Almost every firing was on a list missing its destination, so lowering it would only produce more confident self-clicks. Leave it. |
| `CREDENTIAL_NOUL` | 0.7 | Lower hands off on a page that merely looks gated. | Never fired: no goal needed a login. No evidence. |
| `CANNOT_CHOOSE_NOUL` | 0.6 | Lower escalates on a merely-difficult page; higher forces a pick. | Fired 9 times across 30 task-runs, and in every case the list genuinely lacked the answer. Correct, and it is the guard that keeps this defect from turning into a misclick. |
| `ONLY_COMMIT_NOUL` | 0.5 | Lower escalates on pages with any commit-like control. | Never fired. No evidence. |
| `LAYOUT_NOUL` | 0.6 | Mirrors `cannot_choose`; spec names no number. | Never fired. No evidence. |
| `PROBABILITY_SUM_TOLERANCE` | 0.02 | Tighter rejects valid answers; looser accepts a malformed one. | Fired twice as `argmax is not the chosen id` (tasks 5 and 10), plus once on a discarded trial goal. Every time it refused to click, which is the wanted behaviour. |
| `NO_PROGRESS_LIMIT` | 3 | Lower stops a self-click loop sooner at the cost of ending rounds that were about to converge. | Fired 4 times across 30 task-runs, correctly each time, and it is the only guard standing between this defect and a full-budget round. See mode 2 for what it may be stopping early. |
| `STALE_LIMIT` | 2 | Lower escalates on a jittery page; higher spends more snapshots per step. | **Never fired in 132 steps.** Two extra snapshots per step bought nothing on static docs. It earned its keep on `docs.typesafe.ai` (#3), so this is a site-shape difference, not a reason to remove it. |
| `RETRY_CANDIDATES` | 20 | Lower loses destinations; higher keeps noise. | **Suspected defective, and measured as not a cause.** It truncates in DOM order, which is wrong in principle. In practice, on the index the retry goes 21 candidates to 20 and drops exactly one label, `#`, because the answer was never among the 21 to begin with. Do not spend the next slice on this. |
| `MAX_CANDIDATES`, `MAX_LABEL_CHARS` | 120, 120 | Accuracy rots as unrelated state grows; the hard API ceiling is 255 options. | Never reached: the visible tree yields 21 to 37 candidates. The 120 cap is not the binding constraint on these pages. |
| `MAX_PAGE_CHARS` | 12,000 | Smaller loses the answer; larger rots accuracy and can breach the 32k request budget. | **Not the binding constraint**, and worth knowing: the visible tree on `cli.html` is 7,745 characters, well under the cap. The text is limited by viewport scoping, not by this number. |
| `SHORT_PAGE_CHARS`, `SHORT_CANDIDATES`, `MAX_REQUEST_CHARS` | 3,000, 60, 28,000 | When the request is too big, what to shave first. | Never triggered: the largest single request was 5,285 input tokens, well inside the 32k budget, so `fitState` never shaved. |
| `SETTLE_SECONDS` | 2 | Higher wastes wall clock; lower reads a half-rendered page. | 2.0s per step held: zero stale discards in 132 steps, and 42 steps ran in 120s. |
| `step_budget` | 12 | Lower stops a wandering round sooner; higher spends more to converge. | Never reached: the deepest round took 10 steps. Not binding while the loop stalls on one screen. |

### What did not cause them

Worth its own list, because each of these was a plausible suspect and the next
slice should not spend time on any of them:

| Suspect | Verdict |
|---|---|
| `RETRY_CANDIDATES` truncating in DOM order | **Not a cause.** Measured: on the index it drops exactly one label, `#`. The answer was not in the list to be dropped. |
| `MAX_PAGE_CHARS` cutting the answer off | **Not a cause.** The visible tree on `cli.html` is 7,745 characters against a 12,000 cap. It never bound. |
| Statelessness, fresh JS globals per round, refs not surviving across steps, `job.json` | **Not a cause.** Zero `stale` discards in 132 steps, and all 30 task-runs got the right goal and the right fingerprints. The mechanism was handled correctly. |
| The helper quirks below (`scrollBy` dead, `dispatchKey` arity, `scroll`'s argument) | **Not a cause.** The loop never calls any of them. They are latent hazards for whoever adds scrolling, not explanations of this run. |
| `SETTLE_SECONDS` being too short | **Not a cause.** Zero staleness with a 2s settle. |

## The capability the loop is missing

Worth recording separately, because it changes what the fix has to be.

`explore.js` calls exactly one acting helper, `click`. Nothing else in the 682
lines moves the page: the other calls are `snapshotText` twice, `pageInfo`, `wait`,
`openOrReuseTab`, `useOrCreateTaskSpace`, `handOffTaskSpace`, and `fetch`. The word
"scroll" appears in two comments and nowhere else.

The platform is not the constraint. Available and unused: `scroll`, `scrollBy`,
`scrollToBottomUntil`, `js`, `hover`, `doubleClick`, `dragMouse`, `dispatchKey`,
`uploadFile`, `captureScreenshot`, `waitForElement`, `waitForLoad`,
`waitForNetworkIdle`, `snapshot`, `snapshotRaw`. There is no `select`, so the
SELECT operation of the wider space has no primitive here yet.

Verified on `cli.html`, the page three tasks stalled on. An earlier draft of this
file said `scroll` was broken; that was wrong, and the correction is worth keeping
because the helper's argument is stranger than a broken one:

| Probe | Result |
|---|---|
| `scroll(500)`, `scroll(3000)`, `scroll(20000)` | Each advanced `pageInfo().sy` by about **300px, whatever the argument said**. Not a pixel delta. |
| `scroll(4)` | Advanced nothing measurable. So the argument is not ignored either, and I could not establish what it does. |
| `scrollBy(0, 500)` | No movement. |
| `scrollToBottomUntil()` | Worked, `sy` 229.5 to 16,429.5 in one call. The only bulk scroll that behaves. |
| `js('window.scrollTo(0, 3000)')` | Worked precisely, `sy` 2929.5, **and `--inspect` entered the visible tree**. |

So the page scrolls, and the loop simply never asks it to. `pageInfo().sy` matched
`window.scrollY` exactly in every reading. For the fix, treat
`js('window.scrollTo(...)')` as the precise primitive, `scrollToBottomUntil()` as the
bulk one, and `scroll` as unusable until its argument is understood.

**Scrolling fixes one channel and not the other**, which decides the shape of the
fix. Scrolled to the `--inspect` entry on `cli.html` (that entry sits at y=73,149;
scrolled to `sy` 72,878.5):

| Channel | Before | After scrolling to it |
|---|---|---|
| `state.current_page` (the visible text) | `--inspect` absent | **`--inspect` present** |
| The candidate list | `--inspect` absent | **still absent**, and the list was 20 items |

So scrolling is what the `done` path needs and it is not what reachability needs. The
CLI option entries in the page body are definition markup, not links, while the
clickable copies live in the sidebar. Two changes, not one:

- **Scrolling**, for `state.current_page`, so `goal_met` is asked over a window that
  can contain the answer. Verified to work.
- **The candidate rule**, for reachability, which scrolling does not fix because the
  destination is not an interactive node at all.

This also reads back as the reason task 7 is the run's one `done`: its click was an
anchor link, so the URL gained a fragment and the page scrolled, and that is how the
answer text entered `current_page`. Reaching the text is what made `goal_met`
answerable.

So scrolling is available and effective, and the loop simply never does it. Issue
#3's own comment anticipated this and deferred it on purpose: "Their operation space
is wider than ours: CLICK / TYPE_TEXT / SELECT / SCROLL_UP / SCROLL_DOWN / WAIT /
DONE / BLOCKED, with one `choice` head per operation asked in a single request, and
only the head matching the chosen operation validated... not in this slice." M1 has
now measured what that deferral costs. It is the dominant failure of the run.

One framing note, since the gate says "prune harder in code, not widen the
vocabulary": `SCROLL_UP` and `SCROLL_DOWN` are not vocabulary in that sense. They are
new actions for code, and they come with the per-operation `choice` head that #3
already specified. The thing the gate warns against is asking Jev more or wider
*questions*, and the fix still does not need that.

## The next action

**A pruning change, not a vocabulary change.** Specifically `observe()` and pruning
step 3, which currently let the viewport decide both what Jev reads and what it may
click, plus the definition of progress that goes with them.

The rule in `spec.md` is "drop off-viewport nodes" because ref churn and noise come
from them. That is right about noise and wrong about destinations: on a list page the
entries *are* below the fold, and the current rule deletes exactly the links a
`go find X across pages` task needs. 1,208 of 1,251 refs on `cli.html` is not noise
being filtered, it is the page.

Three constraints for whichever slice takes this, so it does not just flip the flag:

- The 120-candidate cap and Jev's accuracy both still apply. Keeping all 1,251 refs
  would put the API index's entire sidebar in front of a model whose documented weak
  spot is ranking among lookalikes. Mode 1's data says the fix is to *choose*
  candidates rather than to keep them all.
- **An in-page anchor click has to count as progress**, or the fix for mode 1 will
  just move the stall to `debugger.html`. Task 1 found the answer and was stopped by
  the guard for reaching it.
- The offscreen set moves when the page scrolls, which moves the fingerprint the
  guards compare. Whatever replaces the rule has to keep the fingerprint ref-free and
  stable, or the repeat-page and ping-pong guards start misfiring. Note that this
  constraint gets *harder* the moment the loop can scroll on purpose: scrolling
  changes the visible tree every step, so the fingerprint has to be built from
  something that does not move with the scroll position.
- Use `js('window.scrollTo(...)')` or `scrollToBottomUntil()`, not `scroll`. The
  argument of `scroll` does not behave like a pixel delta, and a fix built on it will
  look like it works and move 300px.

### What else the platform has, swept

Measured on `cli.html` in one pass, so the next slice does not have to re-derive it:

| Helper | Result |
|---|---|
| `snapshotText()` | Full tree text, 394,699 chars. `{scope: 'full'}` returns the same, so full is already the default. |
| `snapshot()`, `snapshotRaw()` | Objects, about 453,535 JSON chars each. Identical sizes, so effectively the same thing. |
| `elementCenter(ref)` | `{x, y}` for a ref, and y goes negative when the element is above the viewport. This is what makes clicking by coordinate possible instead of by ref. |
| `hover(ref)` | Works, returns undefined. |
| `captureScreenshot()` | Returns a 77-char string, so a path or handle rather than image data. |
| `waitForElement(sel)`, `waitForLoad()`, `waitForNetworkIdle()` | All three return true. Available and unused by the loop. |
| `currentTab()`, `listTabs()` | Objects. |
| `dispatchKey('ArrowDown')` | Fails with `Element not found: ArrowDown`, so it takes a target first and a key second. |
| `click`, `js` | Work. `js` needs a string expression, not a function; a function is auto-wrapped and loses closures. |
| `select` | Does not exist, so no SELECT primitive yet. |

Not in scope for that slice, but now measured: `RETRY_CANDIDATES` truncating in DOM
order, and `invalid_response` on a self-disagreeing Choice. Both are small and both
are second-order next to the prune.

Re-run `scripts/measure.js m1-goals.json` against these same 10 goals afterwards, and
pin `jev-1.13.0` at that point. Only that re-run says anything about the pick.
