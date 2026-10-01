Type: HITL
Charting record: `.scratch/jev-browser-scope/issues/03-terminal-action-judgment.md`

## Second reading, folded from #30 (2026-09-22)

The #30 measurement contributes the other pole of this calibration: an action-shaped goal whose
action **verifiably succeeded** and whose `goal_met` still stayed far below the bar.

Goal `open the first job listing in this LinkedIn search results list so its details are shown`,
guest LinkedIn job search, `step_budget` 6, `jev-1.13.0`. Run directory
`~/.claude/jev-browser/runs/2026-09-22T11-51-12-551Z-open-the-first-job-listing-in-this-linke/`:

- Step 2 clicks the first listing (offer index 22 of 65) and the click **navigates** to
  `/jobs/view/4469156162/`, so the details panel the goal asked for is on screen.
- `goal_met` then reads 0.21, 0.28, 0.30, 0.34 across steps 2 to 6, against `GOAL_MET` 0.8. It
  never approaches the bar while the goal is visibly met.
- The round exits `step_budget` at step 7, having spent steps 3 to 6 re-clicking the now-open
  card and its tracking twin. Same shape as the probe: navigation was never the problem.
- Across all 23 #30 rounds on that page, every round that reached a click landed the named entry
  and no round reached `done`. The positional rounds are recorded as landing the goal, not
  finishing it, in `spec.md` under "The offer's shape (#30)".

Read together with the probe, the two readings say `goal_met` is low on this page shape in both
directions: low while the action did nothing, and low while the action did exactly what was
asked. That is the case for a terminal judgment rather than a better `GOAL_MET` value, and it is
a second site and a second goal shape for the calibration the acceptance criteria ask for.

## What to build

Give an action-shaped goal a way to reach `done`, end to end.

Today the only completion signal is `goal_met` against `GOAL_MET` 0.8, which is a relevance score. On the YouTube probe it climbed 0.2, 0.22, 0.2, 0.68 and never reached the bar, so the round exited `stale_page` with an empty ledger even though navigation worked (the play control was found at 0.77 confidence).

After this change: the caller declares an action-shaped goal, and after a candidate terminal step the loop asks a terminal-action question in the `readNoul` shape ("is the action now visible as done on this page?"). A positive reading routes into `decision.kind === 'done'`, which is also what opens the harvest gate at `explore.js:907`.

## Acceptance criteria

- [ ] `job.json` carries a field that declares an action-shaped goal, and the field is named in this issue
- [ ] After the terminal action, the loop asks the terminal-action question
- [ ] A positive reading reaches `decision.kind === 'done'`
- [ ] The threshold is calibrated against the probe run directory `~/.claude/jev-browser/runs/2026-09-21T14-20-32-910Z-play-a-clip-from-this-youtube-search-ope/`, the #30 run above (action succeeded, `goal_met` still low), and at least one action goal that genuinely failed, with the numbers recorded here
- [ ] The harvest gate at `explore.js:907` opens on a done decision
- [ ] A live round on the probe's YouTube URL reaches `done` with a non-empty ledger, or this issue records precisely why it cannot

## Decisions to record here

- How the caller declares an action-shaped goal. Working view: a new `job.json` field, because the caller already owns that file and goal wording has not held as a signal across six rounds.
- Whether the terminal judgment replaces or supplements `GOAL_MET`. Working view: supplements, since reusing a relevance score as a completion signal is what produced the 0.68.

## Blocked by

None, can start immediately. HITL because it changes the loop's exit path and carries two design decisions.

