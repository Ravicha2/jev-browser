Type: AFK
Charting record: `.scratch/jev-browser-scope/issues/06-measure-the-loop.md`

## What to build

The numbers the scope statement cites, measured on the changed loop rather than asserted.

For a fixed set of action-shaped goals, record per goal: whether the round reached `done`, whether the ledger came back non-empty, the requests and tokens spent, and the run directory link.

## Baseline in hand

- Six rounds to date, zero non-empty ledgers. Round 2 died on `step_budget` after a click loop. Round 3 exited `cannot_choose`. The YouTube probe exited `stale_page` with `partial_findings: []`.
- Cost of one whole round, measured: the probe spent 5 requests, 27,731 input tokens, and 3,946 output tokens, about $0.0012 at $42 per Btok with output tokens free.

## Acceptance criteria

- [ ] Three action-shaped goals named on this issue, each with a visibly verifiable terminal state, at increasing difficulty
- [ ] At least one of the three is on a gated site, so the collection mode is measured and not only the action mode
- [ ] Per goal: reached `done` or not, ledger non-empty or not, requests, input tokens, output tokens
- [ ] Commit-pick frequency reported: how often a commit-like control was picked without being clicked, across all rounds
- [ ] The same goal set run twice, control (retry/escalate) against click-and-observe below `NEXT_TARGET_CONFIDENCE`, with the same columns per goal in both arms
- [ ] Per arm: rounds reaching `done`, input and output tokens, and the count of picks that did not advance, which is the wrong-click rate the arm trades against the escalations it avoids
- [ ] The `job.json` field that selects the policy is named here, and a round that does not declare it behaves exactly as today
- [ ] The result is read against #28, and the arm is re-run if #28's post-condition lands first
- [ ] Before numbers cited from the existing run artifacts under `~/.claude/jev-browser/runs/`
- [ ] Every fresh round's run directory linked from this issue

## Method note

The commit-pick frequency falls out of the tagging change for free, because a commit-like pick is logged and not clicked. That is the safer instrument than dropping the guardrail on a live site: the same frequency data, no blast radius, and it also measures what the label filter misses.


## Second arm, folded from #30 (2026-09-22): the sub-bar pick policy

The same goal set runs twice: once on today's retry/escalate path (the control), and once on
**click-and-observe below `NEXT_TARGET_CONFIDENCE`**, where a sub-bar pick is clicked and the
posterior guards judge the landing. This is the test of the decision recorded on #30, whose
argument is the cost asymmetry: an escalate ends the round (session 2: 326,070 input tokens over
nine LinkedIn rounds, about 36k each, four dead before a guard mattered), while a wrong
non-commit click costs one or two steps of a 6 to 12 step budget and is policed by the
dead-action spend, the revisit continue, and `no_progress`.

- The policy is selected by a `job.json` field named in this issue, defaulting to retry, so a
  round that does not declare it behaves exactly as today and the before numbers stay comparable.
- The reversibility it rests on is prune step 8's removal of commit-like controls
  (`prune.js:184`, `isCommitLike` at `prune.js:204`), which is a label-and-loc heuristic rather
  than a proof, and which #18 replaces with tagging.
- The control is not a static baseline: the one retry is not dead weight. In
  `~/.claude/jev-browser/runs/2026-09-22T11-51-12-551Z-...` step 4 retried at 0.45 and the re-ask
  came back at 0.50, which cleared the bar and clicked. The arm has to beat retry-then-click.
- Read the result against #28: the posterior the arm leans on is today's spend, revisit and
  `no_progress`. If #28's post-condition lands first, re-run the arm against it.

## Blocked by

- Blocked by #15, #16, #17, #18, #19

