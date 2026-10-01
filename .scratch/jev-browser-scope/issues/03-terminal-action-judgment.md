# Give done a terminal-action judgment

**Type:** task
**Status:** resolved
**Blocked by:** none

## Question

An action-shaped goal currently cannot reach `done`. Add a terminal-action judgment so the loop can say "the thing happened", which makes `done` a state an action-shaped round can actually reach.

## Evidence

The YouTube probe, run directory `~/.claude/jev-browser/runs/2026-09-21T14-20-32-910Z-play-a-clip-from-this-youtube-search-ope/`:

- `goal_met` climbed 0.2, 0.22, 0.2, 0.68 across the round. `GOAL_MET` is 0.8, so `done` was never reached.
- Navigation was never the problem: the play control was found and picked at 0.77 confidence.
- The round exited `stale_page` with `harvested_fingerprints: ["3d8e62cf"]` and `partial_findings: []`, and the ledger was empty.
- The harvest did run (`worth_reading` 0.61, above the 0.5 gate at `explore.js:907`) and appended nothing, because `has_answer` read 0.68 against the 0.7 bar. That half belongs to 04, not here.

**Second reading, folded from #30 (2026-09-22).** The other pole of the calibration: an
action-shaped goal whose action verifiably succeeded and whose `goal_met` stayed low anyway.
Goal `open the first job listing in this LinkedIn search results list so its details are shown`,
run `~/.claude/jev-browser/runs/2026-09-22T11-51-12-551Z-open-the-first-job-listing-in-this-linke/`.
Step 2 clicks the first listing (offer index 22 of 65) and navigates to `/jobs/view/4469156162/`,
so the panel the goal asked for is on screen; `goal_met` then reads 0.21, 0.28, 0.30, 0.34
against the 0.8 bar, and the round exits `step_budget`. Across all 23 #30 rounds on that page,
every round that reached a click landed the named entry and none reached `done`. With the probe,
that says `goal_met` is low in both directions on this page shape: while the action did nothing,
and while it did exactly what was asked. Argument for a terminal judgment rather than a better
`GOAL_MET` value.

## What to do

1. A noul question after a candidate terminal step, in the shape the loop already uses (`readNoul`): is the action now visible as done on this page? A pause control where there was a play control, a progress bar, a confirmation, a changed state.
2. A threshold for it. Calibrate against the probe run above, and against at least one action goal that genuinely failed.
3. Route a positive reading into `decision.kind === 'done'`, which is also what opens the harvest gate at `explore.js:907`.

## Decide inside this ticket

- **How the caller declares an action-shaped goal:** a new `job.json` field, or goal wording. My view: a field, because the caller already owns `job.json` and goal wording has not held as a signal across six rounds.
- **Whether the terminal judgment replaces or supplements `GOAL_MET`** for action-shaped goals. My view: supplements. Reusing a relevance score as a completion signal is what produced the 0.68.

## Notes

Pairs with 04. This ticket makes `done` reachable; 04 makes the ledger non-empty when it is.

## Answer

**Built 2026-09-22, as a `done` row in the `next_target` choice rather than a seventh Noul.**

The two decisions the ticket left open, and what settled them:

- **How the caller declares an action-shaped goal:** a new `job.json` field, `goal_shape:
  "action"`. The field carries a string rather than a boolean so the undeclared case (absent)
  and a future second shape are both unambiguous without another field. The design pass's
  `end_states: [...]` list is the larger version of this and was not built: the acceptance
  criteria need a declaration, not a list of verifiable end states with declared inputs.
- **Whether the terminal judgment replaces or supplements `goal_met`:** supplements. The Noul
  still runs first, unchanged; the row is read after it. A page that states the answer outright
  is still a `done` no terminal reading needs to reach, and the exit's `finished_by` names which
  of the two fired.

The third choice, made while the row was open and argued in the second comment above: the
terminal question is **a row in the existing choice, not a new Noul**. Reasons, in order: the
question count is a reliability product and the new Noul would have made it eight; the choice
head is the one the loop validates hardest and the model selects an id rather than writing an
action object (34.0% invalid, arXiv 2603.14248); and the mass `done` competes for is the mass
the candidates were already competing for, which makes it readable as a confidence.

**What was measured** (six live rounds, all under `~/.claude/jev-browser/runs/`, all on
`jev-1.13.0`; the full table is in `references/thresholds.md`, "The terminal action (#19)"):

| pole | site | action verified? | `done` reading | `goal_met` |
|---|---|---|---|---|
| probe | YouTube search | playing, 1492s of 3088s | 0.59 | 0.59 |
| probe | YouTube search | playing, 44s of 1350s | 0.40, then 0.46 | 0.41, 0.5 |
| probe | YouTube search | on the watch page | 0.46 | 0.5 |
| #30 goal | LinkedIn | the pinned listing's pane is open | 0.69 | 0.28 |
| impossible listing | LinkedIn | never acted (`none` twice) | row never picked | 0.04 |
| docs navigation | nodejs.org | on `child_process.html` | 0.74 | 0.71 |

`DONE_CONFIDENCE` is **0.40**, the measured floor of a true `done`: the 0.5 pick gate refused
two rounds whose clip was verified playing, which is precisely the failure this ticket exists to
remove. It is not lower because nothing measured puts a false `done` beneath it — the
false-positive floor is unmeasured, and 0.40 is where the evidence stops rather than where a
margin starts. #19's own notes put that measurement on #21's arm.

**The harvest gate:** it opens on a `done` (`harvestDue` fires on `decision.kind === 'done'`),
verified live in all four rounds that reached `done`. The ledger stayed empty on the video and
job-pane sites (the extraction ask returned `span_choice: none` at `has_answer` 0.22 to 0.55) and
took one tentative finding on the docs site — that half is 04's, and the last acceptance
criterion's "or say why" is answered above with the numbers.

**What this does not do:** `goal_shape` is one flag on one goal shape. A declared end state is
still not checked as a hard condition, which needs the design pass's list; and the row is only
offered after the round has acted, so a goal whose end state is already true on the start page
still needs one click to say so.

