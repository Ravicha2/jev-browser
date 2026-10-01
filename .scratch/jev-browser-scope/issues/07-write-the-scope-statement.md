# Write the jev-browser scope statement

**Type:** grilling
**Status:** open
**Blocked by:** 01, 06

## Question

Write the statement this map exists to produce: the job jev-browser keeps, the job it hands off, the seam between its two modes, where its safety claim rests, and the evidence behind each of those. It lands as corrected contract sections in `SKILL.md`, not as a new document beside it, so there is one description of this skill and not two.

## What it must contain

- The two modes, and the goal shape that selects between them.
- Where the safety claim rests, plus the accepted risk that the commit-label denylist does not catch what it does not name.
- Each competitive claim, with the measurement or citation that backs it, drawn from 01 and 06.
- Caller duties that follow from 02's authorization round trip and 03's terminal-action judgment.

## Corrections it owns

- `SKILL.md:36`, "`task_space_id` may be null on the first round; every exit names it for the next one." Both clauses are false. `useOrCreateTaskSpace` passes the value into a call that needs a string, and `references/platform-facts.md:39` records the signature; round 1's `error` exit came from exactly this. Every exit that omits `task_space_id` (all but the `done` path at `explore.js:951` and the decision-driven escalate at `explore.js:964`) makes the second clause false as well.
- The exit table at `SKILL.md:59-76` and the safety section at `SKILL.md:92-100`, which currently state the guardrail as unreachable.

## Done when

Every clause is testable against the code as it stands that day. A clause describing intended behavior is either marked as a target or deleted, because a forward-looking contract is exactly how the `task_space_id` drift started.

## Answer

<!-- append on resolution -->
