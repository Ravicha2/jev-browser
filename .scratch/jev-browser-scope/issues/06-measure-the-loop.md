# Measure the loop on a fixed action-goal set

**Type:** task
**Status:** open
**Blocked by:** 02, 03, 04

## Question

Produce the numbers the scope statement cites. Run a fixed set of action-shaped goals against the changed loop and record, for each: whether it reached `done`, whether the ledger came back non-empty, the cost of the round, and how often a commit-like control was picked without being clicked.

## Baseline in hand

- Six rounds to date, zero non-empty ledgers. Round 2 died on `step_budget` after a click loop. Round 3 exited `cannot_choose`. The probe exited `stale_page` with `partial_findings: []`.
- Cost of a whole round, measured: the probe spent 5 requests, 27,731 input tokens, and 3,946 output tokens, which is about $0.0012 at $42 per Btok with output tokens free.

## Method

- Pick three action-shaped goals with a visibly verifiable terminal state, at increasing difficulty. Include at least one gated site, so the collection mode is measured too and not only the action mode.
- Take the before numbers from the existing run artifacts under `~/.claude/jev-browser/runs/`; take the after numbers from fresh runs.
- **Second arm, folded from 30 (2026-09-22): the sub-bar pick policy.** Run the goal set twice,
  once on the retry/escalate path (control) and once on click-and-observe below
  `NEXT_TARGET_CONFIDENCE`, where a sub-bar pick is clicked and the posterior judges the landing.
  Report the same columns per goal in both arms, plus the count of picks that did not advance.
  The policy is selected by a `job.json` field, default retry, so an undeclared round behaves as
  today and the before numbers stay comparable. Reversibility rests on prune step 8
  (`prune.js:184`), which 02 replaces with tagging; the posterior the arm leans on is today's, so
  re-run it against 03/04 if those land first. The control is live: in
  `~/.claude/jev-browser/runs/2026-09-22T11-51-12-551Z-...` step 4 retried at 0.45 and the re-ask
  cleared the bar at 0.50, so the arm has to beat retry-then-click.
- The commit-pick frequency falls out of 02's tagging for free: a commit-like pick is logged, not clicked, so the frequency is measurable at zero blast radius. That is the safer instrument than dropping the guardrail on a live site, and it also measures what the label filter misses.

## Answer

<!-- append on resolution -->
