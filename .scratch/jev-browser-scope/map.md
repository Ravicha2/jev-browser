# jev-browser scope

## Destination

A locked scope statement for jev-browser: the job it keeps, the job it hands off, and the evidence for the line between them. It lands as corrected contract sections in `SKILL.md`, and every clause is testable against running code on the day this map closes.

## Notes

- **This effort carries execution.** The statement must be true in code, not aspirational. Two of the decisions behind it describe behavior the loop does not have yet, so the map owns building it. This overrides wayfinder's plan-don't-do default on purpose.
- **One skill, two declared modes.** Action-shaped goals (a terminal action, plus a commit the caller authorizes) and gated collection (`explore.js`, harvest-only). One contract, one seam, no new files.
- **Where the safety claim rests.** Not on the commit-label denylist. Measured blind spot: `Subscribe`, `Add to cart`, `Like this video`, `Save`, `Next`, `Continue`, and `Sign in` all pass `isCommitLike` (`prune.js:204`), and `Continue` is the button that advances a checkout from cart to payment. That blind spot is an accepted risk; the claim moves to the caller's authorization step.
- **Domain.** Code owns control flow; the Jev model (TypeSafe System One, pinned `jev-1.13.0`) makes two or three narrow judgments per step over text; ego-browser performs every action. It never touches credentials and never transacts.
- **Shape to reuse.** The `needs_input` round trip (name the field, direct-fill the answer on the next round, guard the repeat with `<page_fingerprint>:<field>` in `visited_fingerprints`) is the precedent the commit authorization reuses.
- **Consult.** `references/platform-facts.md`, `references/thresholds.md`, `learnings/<site>/`, `doc/research/`.
- The charting session's decisions are carried in the ticket bodies that own them (02, 03, 04) plus the standing notes above. The capability-boundary brief is an asset of 01.

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [Where is the capability boundary between a real-browser agent and a search-plus-fetch agent?](issues/01-capability-boundary-versus-search-fetch.md) ([#14](https://github.com/Ravicha2/jev-browser/issues/14)) — search plus fetch owns discovery and reading, and holds a policy advantage too (Cloudflare blocks the Agent category by default, permits Search). The durable browser advantage is authenticated, stateful, canvas, and mutating work. Determinism is the industry's converged answer, which validates the core thesis and defines the competition. Detail and citations: `doc/research/01-capability-boundary.md`.

*The remaining tickets now live on GitHub as #15 through #22; the files here are the charting record.*

## Not yet specified

- How the loop confirms an action with no visible state change (a silent form POST, a request that returns and shows nothing). Depends on what 03 lands.
- Whether the gated-collection mode needs its own goal-shape guidance once action-shaped goals are first-class.
- Whether the statement should claim anything about cost, and what that claim would be measured against.

## Out of scope

- **Ungated discovery and broad web search.** A parallel search-plus-fetch agent does it faster and wider. This effort does not try to compete there.
- **Single-page, one-off, and open-ended interactive browsing.** ego-browser drives it directly.
- **Canvas and virtualized editors.** `layout_unfamiliar` hands off today; nothing here changes that.
- **Credential entry and login.** The space is handed off; the loop never touches credentials. Not revisited.
- **A planner or LLM-owned control flow inside the loop.** It would break the core trade: code owns control flow, the model makes two or three narrow judgments. Ruled out before this map was drawn.
