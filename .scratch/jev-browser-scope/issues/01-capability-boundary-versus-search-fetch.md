# Where is the capability boundary between a real-browser agent and a search-plus-fetch agent?

**Type:** research
**Status:** resolved
**Blocked by:** none
**Live ticket:** [#14](https://github.com/Ravicha2/jev-browser/issues/14) (GitHub became the tracker after this map was charted; the files here are the charting record)

## Question

Where can a real browser session do work that an agent holding only web search and HTTP page fetch cannot, and what does each approach cost? This produces the cited evidence the scope statement rests on, so the statement's competitive claims are measured rather than asserted.

Specifically:

1. **The capability boundary.** Which categories of web work are structurally out of reach for search plus fetch: authenticated sessions, multi-step UI state, client-rendered applications, anything where the page's own state rather than its HTML source is the content.
2. **Published failure evidence for browser agents**, and any published comparison of cost or wall clock against search-plus-fetch patterns.
3. **Published positioning of deterministic or scripted browser control flow** against LLM-planned browser loops. Who should own the control flow, and on what argument.
4. **The economics**, per task, for each approach, where numbers exist.
5. **Anything that contradicts the premise.** If there is good evidence that a browser agent beats search plus fetch on ordinary discovery tasks, the statement needs to say so plainly rather than omit it.

## Constraints on the work

- Cite a URL for every factual claim. Mark anything unverified as unverified.
- 2025 and 2026 sources first.

## State

Already in flight: a research agent was launched on this before the map was drawn. Its brief is this ticket's asset; link it here when it lands, and do not start a second pass before reading it.

## Answer

Resolved 2026-09-22. The brief is `doc/research/01-capability-boundary.md`, and it closes all the acceptance criteria here.

Three findings that change the effort:

1. **The premise holds, with a fourth structural reason.** The controlled ablation is the strongest single piece: the same WebArena tasks score 29.2% for an API-only agent against 14.8% for a browsing agent (`[P]` arXiv 2410.16464), and OpenAI's own BrowseComp table has o1 with no browsing at 9.9% against GPT-4o with browsing at 1.9% (`[P]`). The new reason is permission: from 15 September 2026 Cloudflare permits the Search category and blocks the Agent category by default on ad-monetized pages, so a browser agent is in the category blocked first. That is policy rather than capability, and nothing here fixes it.
2. **The convergence validates the core thesis and is also the competition.** Nearly every vendor selling LLM browser control now hands execution back to deterministic code (Stagehand caching, Skyvern code generation, Notte, Anchor, and Browserbase's rule "a wrong click that costs money or fails an audit wants a script"). jev-browser's design is not eccentric; it is the direction the market settled on. The claim that survives for the scope statement is determinism and auditability on authenticated or stateful work, backed by the measured cost (about $0.0012 per round here against published browser-agent figures of 1.9¢ per simple task and $5.81 per hard task).
3. **The browser is necessary but not sufficient.** The accessibility tree is a DOM subset, `aria-hidden` elements are excluded, closed shadow roots are unreachable even for Playwright, and virtualized rows exist only while in the viewport. Structured endpoints beat the browser wherever they exist, which is a caution against widening this skill's scope.

Carried caveats: no head-to-head browser-versus-search result on fresh-fact benchmarks exists (the crux question is open), all vendor deltas are self-reported, and the cost figure the effort cites for itself is a single probe round rather than a measured action-goal round.

**Verification pass, 2026-09-22.** The brief's citations were independently re-verified by five verifier subagents, each fetching the primary source for its group rather than trusting a secondary write-up. No citation was fabricated and no quote was a paraphrase presented as verbatim; the corrections that came back were framing, attribution, and citation hygiene. Three were applied to the brief: Cloudflare's Training default is "Disallow AI Training" rather than a flat block (the Agent block that matters here is unchanged), the Stagehand "AI where it matters" negative finding is confirmed and the phrase is struck, and the $0.0012 self-measurement is labelled a single probe round. The remaining items, plus the method and its negative controls, are in the brief's appendix.
