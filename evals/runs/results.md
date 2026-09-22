# Round 1 results

Every number below is read off `round-record.jsonl` with the invalid rows excluded (`invalid:` rows
carry the reason they do not measure; 75 of 288 rows are invalid and are counted, not deleted).
Arms, goals and thresholds are `evals/eval_plan.md` sections 3, 4 and 6, unchanged.

## What ran

| Goal | Pole | Arms run | Trials per arm |
|---|---|---|---|
| `play the first clip in these YouTube search results, just get it playing` | positive: the clip can play | `fieldless`, `action`, `loop-off` | 15 |
| `play the clip with id aaaaaaaaaaa, just get it playing` | negative: the end state is unreachable | `fieldless`, `action`, `loop-off` | 15 |
| `open the first job listing in this LinkedIn search results list so its details are shown` | positive: the listing can be opened | `fieldless`, `action`, `loop-off` | 15 |
| `open the job listing titled Interstellar Logistics Cargo Astronaut so its details are shown` | negative: the listing is absent from the page's 20,416-character snapshot, measured before the run | `fieldless`, `action`, `loop-off` | 15 |
| `fill in the order form from the supplied values and do not submit anything` | the gated goal: the form carries four commit-like controls | `fill`, `loop-off` | 15 |

`fill` replaces `fieldless`/`action` on the fill goal because `goal_shape` is consulted only by
`explore.js`: `fill-form.js` never reads it and never clicks anything, so the declaration cannot
change a fill round. The fill arm is one configuration by construction, not by omission.

**Round-count reconciliation.** The plan's section 3 budget (120 + 60 = 180) covers its four goals.
Section 3 also extends the set by one gated-collection goal before any arm runs, which this round
did, so the executed set is five goals and about 225 rounds. The 288 rows here are those rounds plus
the invalid re-runs (75), which are retained rather than deleted so every discard stays auditable.

## Decision 1: does the terminal-action judgment (#19) earn its cost?

| Goal | Pole | `fieldless` done | `action` done | Delta | `fieldless` mean input tokens | `action` mean input tokens |
|---|---|---|---|---|---|---|
| YouTube clip | positive | 0/15 | **12/15** | **+12 trials, +80 points** | 19,367 | 14,785 |
| YouTube clip | negative | 0/15 | 0/15 | 0 | 13,833 | 14,150 |
| LinkedIn listing | positive | 0/15 | 0/15 | 0 | 16,455 | 16,507 |
| LinkedIn listing | negative | 0/15 | 0/15 | 0 | 15,362 | 14,281 |

- **On the YouTube positive pole the declaration earns its cost and more.** The delta is 12 trials
  against the plan's 3-of-15 band, and the declared arm is also ~24 percent cheaper in input tokens
  (it finishes in 3.4 steps against 4.1, so it buys fewer asks). All 12 wins finish
  `finished_by: terminal_action`, which is the judgment this ticket was asked to price.
- **The negative poles bound the false-terminal side at 0/15 in both arms.** The plan recorded the
  false-positive floor under `DONE_CONFIDENCE` 0.40 as unmeasured; 30 declared negative trials
  produced no false `done`. The 15-trial upper bound is about 3 in 15.
- **On the LinkedIn positive pole the declaration is inert, and that is a segment flag, not a tie.**
  Both arms are 0/15, all `escalate low_confidence` at step 2, and the trace says why:
  `next_target` reads 0.35 then 0.26 against `NEXT_TARGET_CONFIDENCE` 0.5 on a page offering 69
  candidates, so the round escalates before it ever clicks. The `done` row is offered only from the
  first step that has clicked something, so on this page it is never offered at all. #19 cannot
  help a round that dies at the pick; the LinkedIn pole needs a pick-side fix, not this one.
- `goal_met` on that page read 0.31 and 0.35, matching the plan's recorded expectation ("readings
  that peak at 0.34 on the LinkedIn page"). The 0.8 bar is not close, which is the premise #19 was
  built on.
- **On the fill goal #19 is not exercised at all** (0 model requests, see below), so the fill path
  is neutral evidence for this decision rather than supporting or opposing it.

## Decision 2: does the skill earn its keep against raw ego-browser?

| Goal | Loop done | Loop cost | `loop-off` done | `loop-off` cost |
|---|---|---|---|---|
| YouTube positive | 12/15 | 14,785 input tokens, 3.4 steps, 63 requests | 2/15 | 5.6 page reads, 7,060 chars |
| YouTube negative | 0/15 (correct) | 14,150 tokens, 2.0 steps | 0/15 (correct) | 1.0 read, 915 chars |
| LinkedIn positive | 0/15 | 16,507 tokens, 2.0 steps | **13/15** | 1.9 reads, 2,822 chars |
| LinkedIn negative | 0/15 (correct) | 14,281 tokens, 1.9 steps | 0/15 (correct) | 1.0 read, 2,179 chars |
| Fill | 15/15 | **0 requests**, 2 steps | 15/15 | 3.0 reads, 1,201 chars |

- **The hand route wins the LinkedIn positive pole outright: 13/15 against 0/15, at about 1.9 page
  reads and a few thousand characters.** The hand route's first click opens the listing in the
  search page's detail pane (`currentJobId` appears in the URL); the loop never gets that far. On
  this goal the loop is not merely expensive, it is the arm that fails.
- **The loop wins the YouTube positive pole: 12/15 against 2/15.** The hand route's clicks often did
  not navigate at all (13 of 15 trials ended still on the results page after three attempts each),
  while the loop's retry and guard machinery converted the same flaky page into a terminal `done`.
  This is the clearest case for the loop in round 1.
- **Cost is not comparable as recorded, and the plan should say so.** The loop's cost is model input
  tokens (14k to 19k per round); the hand route's cost is page reads (1 to 6) and the characters the
  agent read (900 to 7,000). The loop is one to two orders of magnitude more expensive per goal on
  this comparison, and it wins only where the hand route's mechanics break down.
- **The fill goal is where the loop's cost collapses to zero.** All five values arrive under their
  own slugs, so the direct channel (`fill-form.js:200`) fills them with **no model ask at all**:
  `usage_total` is `{"requests": 0}` and the round is done in 2 steps. A fill whose values are
  known costs nothing; the loop's price is paid only where a judgment is actually needed.
- **Fairness caveat, stated because it bounds the claim.** The `loop-off` route is a fixed rule
  (pick the first eligible candidate, re-read before each click, up to 3 attempts) rather than a
  careful human. On YouTube that understates what an attentive agent would do, so the loop's win
  there is against *this* hand route, not against the best possible one. The LinkedIn result is not
  exposed to this caveat in the same way: a single click sufficed 13 times out of 15.

## The stop rule

Section 6's stop rule (a) is satisfied on the positive poles: the `action` minus `fieldless`
completion delta is 12 of 15 (band: 3 of 15) with 0 false terminals on the negative poles, and the
`loop-off` comparison has produced its cost and completion columns. Round 1 can stop here.

## Open, and not settled by this round

- The false-terminal bound is 0 in 30 declared trials; the upper bound is about 3 in 15, and a
  tighter bound needs more negative trials, not a different arm.
- The LinkedIn pick threshold is now the measured blocker on that site; the plan's round-2 knob
  (the bar, or the offer text) is the lever, and the re-aim that made the pole runnable at all is
  recorded in section 3.
- Every completion number here is read before #28's post-condition lands, so per section 3 it is
  provisional and the arm set is re-run, not reinterpreted, when #28 lands.
