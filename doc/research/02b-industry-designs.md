# 02b: how shipping products decompose browser agents

Compiled 2026-09-22 from the industry research subagent's report during the main session.
The synthesis that cites this file is `02-decomposition-evidence.md`. Tags: `[V]` vendor
marketing or first-party docs, `[S]` secondary report, `[P]` independently verified.

**The one-line finding:** nearly every vendor now scopes the model to locating, planning, and
verifying, and hands execution to deterministic code, by caching, compilation, or
script-first-with-fallback. The two camps disagree about step *size* (Anthropic and Stagehand
favour small; Browser Use favours few and large); nobody ships a per-step model call as the
primary design any more.

## Anthropic [P, verified verbatim in the main session]

From the computer-use and browser-use best-practices docs:

> "Advanced workflows may still benefit from an orchestrator + sub-agent pattern where a
> reasoning model handles planning and decision-making while Sonnet or Haiku executes the
> mechanical clicking steps."

The same doc's granularity guidance includes "Break complex interactions into smaller steps",
and its taxonomy separates **workflows** ("predefined code paths") from **agents** ("dynamically
direct their own processes"), with the orchestrator-workers pattern named as a workflow.

Multi-agent cost note [V]: about 15x the tokens of plain chat. Same doc recommends a hard step
cap and "pause and ask" over autonomous guessing.

## OpenAI [V]

The Computer Use guide frames it the same way and warns explicitly against chaining steps:
do not ask the model to both reason about state and emit a long action script; keep steps small
and check the result between them. Operator's own caveats page describes its tendency to drift
and its refusal rate, and treats human handoff as a designed part of the loop rather than a
failure.

## Google [V]

Agent Development Kit (ADK) 1.x/2.0 documents planner, executor, and critic as separate
components. ADK 2.0's own benchmark note reports **every multi-agent variant degrading 39% to
70%** on a strictly sequential task (PlanCraft), which cuts against multi-agent orchestration
for exactly the sequential case this project is in. Google's browser-use guidance and Mariner
materials favour observe-decide-act with human confirmation for commits.

## Stagehand [P, vendor docs]

Version 4 **deleted the autonomous `agent()`**. Their own words: "v4 exposes discrete tools and
leaves the control flow to you", and the reason given is that "every step it ran was an
inference call" (the inference-per-step cost and its unreliability).

The mechanism worth copying: `observe()` returns candidate actions *without performing them*;
passing an observed Action back to `act()` "replays it deterministically with no inference at
all." That is a route file that the library itself can generate and then replay, which is the
closest shipping analogue to `learnings/<site>/` plus a pinned selector.

## Skyvern [V, benchmark page verified in the main session]

The closest analogue to a deterministic route with narrow model judgments. Its workflow editor
orders blocks by determinism, and its docs say so directly:

> "Action blocks are the most deterministic... There's no interpretation; it either finds the
> element and clicks it, or fails."
> "Start with the most deterministic block that can accomplish your goal."

Their benchmark page, read directly: **45% single loop, 68.7% with a planner, 85.85%** after
closing the validation gap, with the mechanism named "planner-actor-validator agent loop" and
the failure being a planner that "would assume it worked and moved on." So the last 17 points
came from the *validator*, not the planner.

Caveats, both real: vendor self-report, and WebVoyager is the benchmark audited from a claimed
87% down to 68.6% for Operator. The direction of the three numbers is the signal; the absolute
value is not.

## Browser Use [V, argues the opposite]

"Bitter Lesson" post, 2026-09-15: argue for **fewer, larger, model-chosen steps**. They replaced
12 tools with one `browser_exec`, reporting mean token use down 60% (Opus 4.8) and 66% (Kimi K3)
at 18 of 18 runs. Thin sample: n=6 tasks x 3 runs. Their hard-task benchmark is
$580.87 per 100-task run ($5.81 per task) at 80.0% accuracy, which is the cost of an unbounded
loop from inside its own camp.

The walk-back matters more than the pitch. The co-founder posted "Browser Use + Jev =
Ultrafast, 7s and $0.0039", then the next day:

> "Jev can't write text... can only choose a set of predefined actions. The problem with long
> running state action models is that the reasoning and state understanding becomes extremely
> important."

If the navigator cannot write and cannot hold long state, the orchestrator inherits both
problems. This is the sharpest published criticism of this project's own premise, and it comes
from a partner.

## Microsoft Playwright MCP [V]

Its determinism thesis: accessibility-tree-based, no vision, no coordinate guessing. It also
concedes that loading a large tool schema has a real cost and that a CLI-plus-skills approach
sidesteps it, which is an argument in favour of this repo's heredoc shape rather than against
it.

## Chrome DevTools MCP [V]

Thinner and newer; the notable point is that it exposes browser primitives rather than a task
loop, consistent with the tool-not-agent direction.

## Browserbase, Hyperbrowser, Notte, Steel [V, mixed]

Infrastructure vendors. Their shared design is session-plus-observability: the platform stays
out of the decision loop and sells the browser, the recordings, and the replay. Notte is the
most agent-forward of the four. Steel pushes "no-code API endpoints" for repeat runs, which is
the compile-to-deterministic-program pattern again. None of this is independent evidence about
loop shape; it is evidence about what people pay for.

## Convergence, stated plainly

- **Where they agree:** the model should locate, plan, and verify; execution should be
  deterministic wherever it can be.
- **Where they disagree:** step size. Anthropic and Stagehand: small and checked. Browser Use:
  few and large, with the model writing code rather than choosing per step.
- **What nobody ships:** a per-step model call as the primary design. Even Browser Use's answer
  is model-written code, which is determinism-adjacent.
- **The circularity warning:** the loudest pro-decomposition material sits inside this project's
  own ecosystem (Browser Use plus Jev, Stagehand plus Jev). Treat those as advocacy with
  plausible numbers. See `02c` section on circularity.
