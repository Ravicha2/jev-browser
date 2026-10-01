Shape 1 (numbered rows, state-carrying rows) is built end to end and measured on the guest
LinkedIn job-search page. Branch `30-offer-shape`, commits `490d8ab` (trace prerequisite),
`b15937f` (the shape), `55336d3` (the record).

## Acceptance criteria

- [x] **The trace records the offer order and the picked index, and a self-check asserts both.**
  `offerTrace()` writes `offered` (the refs, in order) and `picked_index`; three self-check
  asserts cover the write, the preserved index 0, and the empty case for a stop line.
- [x] **The window question, answered.** On the flat offer: **0 of 19 picks inside the first 10,
  5 of 19 inside the first 15, 15 of 19 inside the first 25.** The destination a positional goal
  names (the first job listing) is **row 23 of 65**, behind 21 chrome rows. A first-N window
  deletes it, which is what #30's caution predicted.
- [x] **One shape built end to end, cost in `references/thresholds.md`** ("The offer's shape
  (#30)"). One in-page `js()` per observation, no extra request, about 5 characters per row
  (under 5% of request size).
- [x] **Before/after, with run dirs.** Table below.
- [x] **Positional goals answerable.** Every flat round that got a click away landed the named
  entry, offer index 22. `.../runs/2026-09-22T11-51-12-551Z-open-the-first-job-listing-in-this-linke`
  step 2 lands `/jobs/view/4469156162/`, the first listing's details. No round reached `done`
  anyway: `goal_met` read 0.21 to 0.36 against its 0.8 bar with the panel visibly open. Reason
  recorded in `spec.md`; the finish is a separate problem from the offer.
- [x] **Row state does not retire #27's spend** (recorded in `spec.md` under the #27 block).
  It removes the cause for the already-open case, and is still not redundant: the tracking twin
  is a different href, so the state query cannot mark it and it still takes the pick; a
  re-rendering page still resets the fingerprint. **Nothing in the guard set becomes dead code.**
- [x] **Recorded in `spec.md`** as core decision 6, plus "The offer's shape (#30)" under
  Candidate pruning, plus the `next_target` block in "Questions per step".

## The measurement

Guest LinkedIn job search, same URL, `step_budget` 6, `jev-1.13.0` every step, 2026-09-22,
runs under `~/.claude/jev-browser/runs/`. Two windows so each arm has its own control (the
guest page drifts between renders: 22 to 112 candidates on one URL in one afternoon).

| Arm | runs | steps | `next_target` answers | median | < 0.5 | picks, offer index |
|---|---|---|---|---|---|---|
| flat, 11:50 window | 5 | 30 | 28 | 0.60 | 8/28 | 14, 22, 46 |
| flat, 11:56 window | 3 | 11 | 11 | 0.44 | 7/11 | 14, 22 |
| flat, already-open scenario | 3 | 10 | 10 | 0.49 | 6/10 | 14, 18, 22, 46 |
| numbered + state, 11:55 | 5 | 12 | 12 | 0.44 | 10/12 | 14, 22 |
| numbered + state, already-open | 2 | 5 | 5 | 0.52 | 2/5 | 47 (the tracking twin) |
| numbered, no state (control) | 2 | 4 | 4 | 0.38 | 4/4 | none reached a click |
| numbered + state, unambiguous goal | 3 | 10 | 10 | 0.53 | 5/10 | 18, 32, 50 |

Cost: 585,007 input and 55,304 output tokens across the 23 rounds.

## What the two halves each bought

- **State earns its keep.** With the selected card marked `(current)`, the already-open job fell
  from the argmax in all three flat rounds (0.47, 0.51, 0.51, and clicked) to a non-contender in
  both marked rounds (0.19, 0.18, 0.11, pick moved to another row). That is the step #27's spend
  used to pay *after* the fact, now paid before the ask.
- **Position did not move the pick or the confidence.** The model landed on the named entry from
  the labels alone, in both shapes. It has one measured side effect: a chrome control sharing the
  goal's words ("Try AI job search", row 21 of 65) rose from about 0.10 to 0.27 and 0.40 in seven
  numbered rounds against at most 0.14 in eleven flat ones. One decoy row on one page, recorded
  as a risk, not a reason to drop the numbering.

## The finding that outranks the shape

On the same 65-row offer, a goal with an unambiguous destination (`open the job listing titled
'Computational Biologist - AI Trainer'`) scored **0.95** on its first ask and landed it, while
the positional goal scored 0.44 to 0.65. The argmax is thin because the rows are near-identical
job titles, not because the list is long: the pick is right and the confidence is honest.

## Decisions

1. **Position and state in the row's text, not as separate fields.** `criteria` is a flat
   `{ref: text}` map; prefixing the string is a smaller change than widening the protocol, and
   the candidate object keeps its bare label so the trail, the spend key and `resolveTarget`
   still compare against it.
2. **Not cut by page region.** Shape 2 is not built: the measurement above says region heads
   would not move a ranking whose mass is thin because the rows are alike. The `done` question
   shape 2 would have raised is therefore not reached.
3. **`NEXT_TARGET_CONFIDENCE` stays a plain gate, not a margin over the runner-up.** Reading
   above: the gate fires on a *correct* pick, so a margin would not have saved it. The gate
   question stays open where #30 parked it.

## Follow-ons this measured, not fixed

- `goal_met` on a job-detail panel reads 0.21 to 0.36: the round lands the goal and cannot see it.
- The tracking twin (`?eBP=` vs `?alternateChannel=search`) is still only covered reactively.
- A row that names the goal's own words is a decoy; check the next page measured.
