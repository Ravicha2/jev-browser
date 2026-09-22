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
**Superseded by "The re-measurement (#10)" at the bottom of this file: after the
reachability fix the same gate reads continue.**

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

## The re-measurement (#10): reachability fixed

The resolution slice for the no-go above. Three changes from #10 (the viewport
became a hint, a read-scroll was added, `invalid_response` got its retry) plus
four defects the re-run itself exposed and that died in the same slice:

| Fix | What the re-run measured |
|---|---|
| Viewport is a hint (#10 change 1) | `cannot_choose` over "destination not offered": 9 exits across 30 pre-fix task-runs -> 1 after. The index now yields 74 candidates (was 21), `cli.html` 120 (the cap binds; was 37). |
| Read-scroll (#10 change 2) | Fires on a stuck answer (`retry`, or a confident pick that just proved dead) on a page worth reading, max 3 viewports per page. Ran in tasks 1 and 3 of the record run. |
| `invalid_response` retry (#10 change 3) | 2 pre-fix exits, 0 after. No recurrence to measure the retry itself against. |
| Snapshot order | `snapshotText()` invalidates the previous ref map: candidates from the full tree were unclickable (`Unknown ref`) because the viewport-scoped call was taken last. The viewport call now comes first. |
| Container reveal | nodejs.org's left nav (`#column2`) is an independent scroll container (2691px of content in a 683px client); page-level `scrollTo` reveals nothing in it and `click()` on a clipped element silently no-ops. All 7 `no_progress` exits of the first re-run traced here. The reveal now scrolls every independent scroll container toward the target's offset. |
| Self-referential anchors dropped | A candidate whose url equals the current page's url is a guaranteed no-op click; dropped before the dedupe so a same-labelled sibling with a different target surfaces. |
| Revisit-continue | Returning to a page after a wrong cross-reference is recovery: one re-decision per fingerprint with the outbound and inbound labels spent, then a real `repeat_page` escalate. |
| Retry re-asks over the same list | The old tighter slice truncated in DOM order and deleted the destination on full-tree lists (task 3's answer sat beyond entry 20). `RETRY_CANDIDATES` is removed. |

`MODEL` is pinned to `jev-1.13.0`, the version that answered every step of every
run here. Same goals, same harness, same gate arithmetic as the no-go above.

### Per-task, run of record (`~/.claude/jev-browser/runs/m1-2026-09-20T23-00-50/`)

| # | goal (short) | exit | reason | steps | clicks | retries | rate | wall | in tok | out tok |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `--inspect` host:port | escalate | `repeat_page` | 8 | 5 | 0 | 0.13 | 19.8s | 58,898 | 9,598 |
| 2 | `node:sqlite` version+stability | **done** | | 3 | 2 | 0 | 0.00 | 9.5s | 23,418 | 3,805 |
| 3 | strip-types flag rename | escalate | `cannot_choose` | 6 | 2 | 1 | 0.33 | 17.2s | 48,251 | 8,191 |
| 4 | Permission Model modes | **done** | | 3 | 1 | 0 | 0.00 | 5.0s | 21,114 | 3,475 |
| 5 | cluster worker count | escalate | `low_confidence` | 5 | 3 | 1 | 0.40 | 11.6s | 37,412 | 6,391 |
| 6 | `node:sqlite` sync class | **done** | | 2 | 1 | 0 | 0.00 | 4.6s | 14,556 | 2,343 |
| 7 | `maxBuffer` limits/default | **done** | | 4 | 3 | 0 | 0.00 | 11.8s | 32,592 | 5,234 |
| 8 | test runner watch mode | **done** | | 3 | 2 | 0 | 0.00 | 10.0s | 22,662 | 3,805 |
| 9 | FS permissions default | **done** | | 3 | 2 | 0 | 0.00 | 8.0s | 20,865 | 3,453 |
| 10 | `--inspect-wait` version | escalate | `low_confidence` | 4 | 1 | 2 | 0.75 | 6.4s | 28,457 | 4,686 |

Totals: **41 steps, 6 done, escalation rate 0.195, 308,225 input tokens
(51,273 out), 104s of wall clock.**

| Run | Done | Steps | Escalation rate | Input tokens |
|---|---|---|---|---|
| of record (`23-00-50`) | **6/10** | 41 | **0.195** | 308,225 |
| repeat (`23-02-51`) | 6/10 | 46 | 0.152 | 342,750 |
| repeat (`23-05-32`) | 6/10 | 51 | 0.157 | 389,413 |
| pooled | **18/30** | 138 | **0.167** | 1,040,388 |

Exit reasons across all 30 task-runs: `done` 18, `low_confidence` 6,
`repeat_page` 5, `cannot_choose` 1. `no_progress` and `invalid_response`, the
two dominant pre-fix families, are gone.

### The gate, again

**Continue. Escalation rate 0.167 pooled (0.152-0.195 per run), under the ~20%
line, and 18 of 30 task-runs reach `done` (from 1 of 30).** The measurement is
now about the pick: the destination is in the list, and the pick carries 6 of
10 tasks per run. The honest cost: input tokens roughly doubled per run
(~347k pooled mean vs ~154k pre-fix) because full-tree candidate lists are 3-6x
bigger. At $0.042/Mtok that is ~$0.015 per task — still not a constraint.

### What still fails, one residual each

- **Task 1 (`repeat_page`): cross-page ping-pong.** inspector.html and cli.html
  each hold half the `--inspect` story; the loop crossed between them until the
  revisit budget spent. Not a guard defect: both pages were decided, neither
  half was read far enough.
- **Task 3 (`cannot_choose`): the cap deletes the destination on monsters.**
  `cli.html` yields exactly 120 candidates; the `--experimental-strip-types`
  TOC entry sits beyond the cutoff. The list has to get *better*, not longer —
  this is the measured instance of #10's own warning.
- **Task 5 (`low_confidence`): the revisit spends the label it needs.** The
  first 'Usage and example' click landed on a same-labelled cross-ref to
  `synopsis.html`, and the revisit then spent that label — the real section
  anchor included. Label-keyed spending cannot tell the twins apart.
- **Task 10 (`low_confidence`): ranking accuracy at the new list size.** The
  `--inspect-wait` TOC entry is on offer; the pick stayed shaky twice. This one
  is genuinely about the model, and 6 occurrences across 30 task-runs make
  `low_confidence` the residual to watch.

### Tunables changed or added by this slice

| Tunable | Value | Trades off | Evidence from the re-run |
|---|---|---|---|
| `MODEL` | `jev-1.13.0` (pinned) | Reproducibility vs alias movement | Answered every step of all six runs here; pinned per #10's acceptance. |
| `RETRY_CANDIDATES` | **removed** | — | The tighter slice deleted the destination on full-tree lists (task 3, first re-run). The retry re-asks over the same list. |
| `WORTH_READING` | 0.5 | Lower scrolls navigation; higher skips readables | Distinguished the two pages it needed to: scrolled `cli.html`/`inspector.html`, left the index alone. |
| `PAGE_SCROLL_LIMIT` | 3 | Higher reads deeper into monsters; costs steps | Fired in tasks 1 and 3; 3 viewports cannot cover an 84k px page — the TOC anchors are the real mechanism there, and the cap keeps the loop from grinding. |
| `PROGRESS_SY_EPSILON` | 8 px | Smaller misfires on jitter; larger ignores real scrolls | No false progress across 138 steps (zero `no_progress` exits). |
| `REVISIT_LIMIT` | 1 | Higher tolerates more wandering | 4 fires in the record run; task 4's `done` went through a revisit. The second `repeat_page` (task 1) is a true stop. |

## The re-measurement (#11): residuals batched

Three of #10's four residuals, one slice, all code-local: revisit spending keyed by
**target url instead of label** (with the dedupe key widened to label + target url, so a
same-labelled twin keeps its own seat and can be clicked); a granted revisit **reads one
viewport before it re-decides** (same `worth_reading` gate and `PAGE_SCROLL_LIMIT` as the
stuck-scroll); and the cap now gives **the page's own anchors the seats first** when it
binds, so a monster page's TOC survives its own sidebar. `MAX_CANDIDATES` stays 120. The
fourth residual (task 10, ranking at list size) was watch-only — and is gone: with the
TOC promoted, `--inspect-wait` is picked cleanly in both runs.

Also caught in this slice, and worth its own line because it once invalidated a whole
analysis: a click's trail row now carries the click's **`target_url`** beside the observed
page `url`. An earlier draft spread the target over `url`, which made every run read as if
it had started on the previous run's last page. The start is now also *verified*, not
assumed: `matchesStartUrl` checks the first observation against `start_url`, re-aims once,
then escalates `start_url_mismatch` with the tab list in `detail`. Three pre-#11 task-runs
genuinely did inherit a leftover tab; no run since has.

Runs of record: `~/.claude/jev-browser/runs/m1-2026-09-21T04-28-34/` and
`.../m1-2026-09-21T04-32-30/`. Two runs, not three: the first pair disagreed only on task 9
(one flake), and the marginal third run was not worth its tokens. `jev-1.13.0` answered
every step of both.

### Per-task, both runs

| # | goal (short) | run 1 | run 2 | steps | rate | wall | in tok |
|---|---|---|---|---|---|---|---|
| 1 | `--inspect` host:port | escalate `low_confidence` | escalate `low_confidence` | 7 | 0.29 | ~28s | 57,092 |
| 2 | `node:sqlite` version+stability | done | done | 3 | 0.00 | ~19s | 23,343 |
| 3 | strip-types flag rename | escalate `cannot_choose` | escalate `cannot_choose` | 5 | 0.40 | ~16s | 42,008 |
| 4 | Permission Model modes | done | done | 3 | 0.00 | ~13s | 21,942 |
| 5 | cluster worker count | **done** | **done** | 6 | 0.00 | ~17s | 46,299 |
| 6 | `node:sqlite` sync class | done | done | 2 | 0.00 | ~9s | 14,517 |
| 7 | `maxBuffer` limits/default | escalate `low_confidence` | escalate `low_confidence` | 5 | 0.40 | ~20s | 40,646 |
| 8 | test runner watch mode | done | done | 3 | 0.00 | ~19s | 23,337 |
| 9 | FS permissions default | escalate `cannot_choose` | **done** | 3 | 0.33 | ~10s | 23,990 |
| 10 | `--inspect-wait` version | **done** | **done** | 3.5 | 0.13 | ~13s | 26,759 |

(The two runs are near-byte-identical per task — the pin is paying off. Only tasks 9 and 10
differ, and only in the last step or the retry count.)

| Run | Done | Steps | Escalation rate | Input tokens |
|---|---|---|---|---|
| record 1 (`04-28-34`) | 6/10 | 40 | 0.200 | 319,151 |
| record 2 (`04-32-30`) | 7/10 | 41 | 0.171 | 320,715 |
| pooled | **13/20** | 81 | **0.185** | 639,866 |

### The gate, third reading

**Continue.** Escalation 0.185 pooled, under the ~20% line; 13 of 20 task-runs reach
`done`, against #10's 18 of 30 (0.60 vs 0.65). The two residuals this slice targeted are
fixed: task 5's twin-spending and task 10's ranking are `done` in both runs, and task 3's
destination is provably offered now — the trail shows the loop clicks `#--no-strip-types`
itself. Task 1 no longer ping-pongs; the revisit reads instead of re-crossing.

### What still fails, and the honest cost

Tasks 1, 3, and 7 (and task 9's one flake) now share **one** shape, and it is not
navigation: the loop reaches the right page *and the right section anchor* —
`#inspectoropenport-host-wait`, `#--no-strip-types`, `#maxbuffer-and-unicode` — and then
cannot close. `goal_met` stays under 0.8 on a page that holds part of the answer, and the
next pick goes shaky among the remaining lookalike anchors. That is the extraction family:
`goal_met` returns a probability, not a value, and the loop has no `answer_span`/`has_answer`
question yet. It is #9's slice, by design.

Task 7 deserves its own line, because it is a real regression against #10 (3/3 `done`
there, 0/2 here): the promotion that fixed task 3 also changed which anchor Jev picks
first on `child_process.html` — the `maxBuffer and Unicode` section, which states the
truncation behaviour but not the default value, ahead of `exec()`'s option list, which
states both. A literal-reading model correctly refuses `goal_met` on a half-answer. The
fix is not to un-promote; it is extraction (#9) plus, if it recurs, letting the pick prefer
the candidate whose label names the *field* over the one that names an *adjacent concern*.

The cost, unchanged in kind: input tokens ~320k per run (bigger lists, more grounding per
ask), ~$0.013 per task at $0.042/Mtok. Still not a constraint.

## The offer's shape (#30): what a row carries

The offer is what `next_target` ranks, so its shape is a tunable of the same kind as the
candidate cap — it changes how much list Jev has to hold at once, not whether it can answer.
#30's prerequisite was measurement: the trace recorded the candidate count but neither the
offer order nor where the pick landed, so "was the pick inside the first W" had no answer.
`offerTrace()` now writes `offered` (the refs in order) and `picked_index`, and every reading
below comes off those fields rather than off a guess.

### The measurement

Guest LinkedIn job search, `https://www.linkedin.com/jobs/search/?currentJobId=...&keywords=AI`,
goal `open the first job listing in this LinkedIn search results list so its details are
shown`, `step_budget` 6, `jev-1.13.0` every step. Runs under `~/.claude/jev-browser/runs/`,
2026-09-22, two windows: 11:50-11:51 (flat offer), 11:55-12:00 (numbered and numbered+state).
Each window is its own control, because the guest page drifts between renders (22, 27, 63, 65,
67, 69, 79 and 112 candidates have all been observed on this url in one afternoon).

| Arm | runs | steps | next_target answers | median confidence | < 0.5 | picks, index in the offer |
|---|---|---|---|---|---|---|
| flat, 11:50 window | 5 | 30 | 28 | 0.60 | 8/28 | 14, 22, 46 (all on the named row) |
| flat, 11:56 window | 3 | 11 | 11 | 0.44 | 7/11 | 14, 22 |
| flat, already-open scenario | 3 | 10 | 10 | 0.49 | 6/10 | 14, 18, 22, 46 |
| numbered + state, 11:55 | 5 | 12 | 12 | 0.44 | 10/12 | 14, 22 |
| numbered + state, already-open | 2 | 5 | 5 | 0.52 | 2/5 | 47 (the tracking twin) |
| numbered, no state | 2 | 4 | 4 | 0.38 | 4/4 | none reached a click |
| numbered + state, unambiguous goal | 3 | 10 | 10 | 0.53 | 5/10 | 18, 32, 50 |

Three readings, in the order they matter.

1. **Where the pick lands.** 0 of 19 picks on the flat offer fell inside the first 10, 5
   inside the first 15 (all at index 14, the 22-candidate hydration step), 15 inside the first
  25. The destination itself — the first job listing — is row 23 of 65, behind 21 chrome rows
   (skip links, the search form, five filter buttons, an alert CTA, two jump buttons). So a
   positional window is the wrong fix, exactly as #30's caution predicted: a first-10 or
   first-15 window deletes the destination. This is the reading shape 1 was chosen from.
2. **What the pick was.** Every flat pick landed on the named entry anyway (index 22 = row 23).
   The model was not picking wrong; it was picking right with 0.5 mass among near-identical job
   titles. Numbering changed nothing there, and the same-request control says why: an
   unambiguous goal on the same 65-row offer — `open the job listing titled 'Computational
   Biologist - AI Trainer'` — scored **0.95** on its first ask, against 0.44 to 0.65 for the
   positional one. The mass is thin because the rows are alike, not because the list is long.
3. **What the state half bought.** In the already-open scenario (start_url pinned to a job that
   renders first, so its card is `current`), the marked row was the argmax in all three flat
   rounds (0.47, 0.51, 0.51) and a non-contender in both numbered rounds (0.19, 0.18, 0.11):
   the pick moved off the already-open card, which is what #27 spends a step to achieve after
   the fact. The state mark is therefore the half that earns its keep, and it is the half that
   makes the offer's answer *proactive* rather than corrective.

4. **Landing is not finishing.** Every positional round that got a click away landed the named
   entry (`picked_index` 22 in all of them), and the click navigates: in
   `.../runs/2026-09-22T11-51-12-551Z-open-the-first-job-listing-in-this-linke` step 2 lands
   `/jobs/view/4469156162/`, the first listing's details. No positional round reached `done`
   anyway, because `goal_met` on that page read 0.21 to 0.36 against its 0.8 bar while the
   details panel was visibly open. Shape 1 therefore fixes the offer, not the finish, and the
   finish is the next measurement this page wants.

### The cost

| | |
|---|---|
| Extra requests | none. State and position travel inside text the request already carried. |
| Extra tokens | the position prefix and `(state)` are ~5 characters per row, ~0.3k input per step on a 65-row offer, against ~7.4k per step for the list and page. Under 5%. |
| Extra browser work | one `js()` per observation, in-page, no navigation. Latency is noise against `SETTLE_SECONDS` and the ask. |
| Tokens observed | flat arm 197.5k in / 19.1k out over 30 steps; numbered+state arm 89.2k in / 8.3k out over 12 steps (the arms differ in length, not in per-step cost). |
| Code | `offerRow()` and `stateMarks()` in `explore.js`, ~60 lines with comments; no change to `prune.js`. |

### The tunables this touches, and the one it does not

- `NEXT_TARGET_CONFIDENCE` (0.5) is **not** re-expressed as a margin over the runner-up. #30's
  working view holds: the 0.44 to 0.79 readings on the same list over one afternoon show a gate
  that is not mis-scaled, it is measuring a genuinely ambiguous ranking. Reading 2 above is the
  evidence — the gate fires on a *correct* pick, so a margin would not have saved it either.
- `PROBABILITY_SUM_TOLERANCE` and the argmax rule are what turned one ambiguous round into
  `invalid_response` (a tie at 0.40/0.40): unchanged, and reading 2 says the answer is to make
  the ask easier or the goal sharper, not to loosen validation.
- `MAX_CANDIDATES` (120) and `SHORT_CANDIDATES` (60) are untouched. This offer is 65 to 112
  entries and never hits either.
- The next lever this measurement points at is not an offer shape at all: it is the gate.
  A pick with correct content and 0.5 mass is a threshold problem, and #30 parked that
  decision deliberately.
