# 02c: practitioner discussion

Compiled 2026-09-22 from the practitioner research subagent's report during the main session.
The synthesis that cites this file is `02-decomposition-evidence.md`. Tags: `[P]` first-party
or verified in the main session by reading the source, `[S]` secondary summary.

This is the weakest evidence tier in the set and it is reported as such. Forum posts are
anecdotes with unknown baselines, and the pro-decomposition sample is contaminated by
circularity (below). It is included because two things in it are load-bearing: the shipped
verifier designs, and the failure arithmetic.

## Hacker News

- **HN 46799479 [P, quote verified via HN's API].** The most useful design in the set: a
  verification layer where "each step is gated by explicit post-conditions... If the condition
  isn't met, the run stops with artifacts instead of drifting forward", and "The verifier just
  checks outcomes, it doesn't invent actions." The second clause is the whole argument for
  keeping verification out of the model's job: it checks, it does not propose.
- **HN 48937517, nkov47 (Coasty) [P, quote verified via HN's API].** Checkpoint design:
  "the deterministic workflow defines the state it expects before resuming, and the agent's
  recovery job is to get the UI back into one of those known states... If it can't, the run
  pauses rather than pretending it knows where it is."
- **The "foreman protocol" anecdote [S].** An orchestrator that inserted what it thought should
  happen into the subagent's prompt, "which often screws up the subagent". Over-specified
  handoffs break the navigator. This is the concrete form of the failure mode the
  many-small-loops proposal most needs tested.
- **Coordination tax [S].** "You burn a surprising amount of tokens just summarizing state and
  passing it between the supervisor and workers." Reported by multiple commenters
  independently, no numbers.
- **Nous Research (Teknium) [S].** Measured that a narrow decider's job collapsed into
  "a programmatic rule, that you dont need any Jev or other model for." This is the sharpest
  practitioner criticism of this project: if the narrowed decision is narrow enough, the model
  is the wrong tool and the route file is the answer.
- **The snowball finding [S].** A measured run across three environments: "Step count barely
  matters by itself... The thing that actually kills you is one bad step early that quietly
  snowballs", plus context pollution from piling retries into the same context window. This is
  the mechanism that sparse context reset (SCoR, `02a` section A) fixes, and it is the best
  practitioner-side argument for small rounds with a fresh scope per round.

## Reddit

- r/LocalLLaMA and r/AI_Agents threads on "why do my agents fail halfway" mostly reproduce the
  same two findings: state summarization cost, and early errors compounding. No controlled
  numbers. Several threads report that shrinking the per-step decision to a single choice
  (which button, which field) is what made their automation reliable, which is consistent with
  `02a` section C rather than with decomposition quality [S].
- A recurring anti-pattern report: two models in a loop with neither holding ground truth, so
  they agree on the wrong state [S].

## X / Twitter

- Mostly vendor and influencer material, high noise. Excluded except as it fed the circularity
  warning.
- The Browser Use co-founder exchange quoted in `02b` originated here [P]: "Browser Use + Jev =
  Ultrafast, 7s and $0.0039", walked back the next day with "Jev can't write text... can only
  choose a set of predefined actions. The problem with long running state action models is that
  the reasoning and state understanding becomes extremely important."

## The circularity warning, and why it is load-bearing

The loudest pro-decomposition posts in this corpus sit inside this project's own ecosystem:
Browser Use plus Jev, Stagehand plus Jev. Those are advocacy, plausible numbers included. The
independent evidence for the small-round design is thinner and comes from two places only: the
shipped post-condition verifier (HN 46799479) and Coasty's checkpoint design (HN 48937517),
plus the academic ablations in `02a` that measure decomposition without being about Jev.

Anyone citing this folder should say that out loud. A design justified mostly by the vendors
who sell it is not justified.

## What did not hold up

- Reported token savings from orchestration: no thread gave a matched baseline, and the
  Anthropic multi-agent figure is the other way (about 15x chat tokens) [V].
- "Agents are 90% accurate per step" style claims: repeated as folklore, no measurement found.
- Claims that small steps fix reliability without any cost: contradicted by the coordination
  tax reports and by Browser Use's walk-back.
