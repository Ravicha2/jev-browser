# Decomposition evidence: many small loops versus one big loop

Researched 2026-09-22 for the design question: should the caller (main agent, orchestrator)
decide the steps with the loop doing navigation inside each small step, instead of one loop
with a large `step_budget` chaining its own steps?

**Provenance, read this before citing.** Three research subagents worked in parallel (academic
papers, shipping products, practitioner discussion), plus a fourth pass on constrained
decoding that completed after the first three. Their full reports are the sibling files:
`02a-academic-decomposition.md`, `02b-industry-designs.md`, `02c-practitioner-discussion.md`.
Everything below is drawn from those, with each claim tagged `[P]` peer-reviewed or
first-party, `[V]` vendor, `[S]` secondary.

**Verification performed in the main session, not delegated.** The Anthropic orchestrator
sentence was fetched and matched verbatim. Skyvern's 45 / 68.7 / 85.85 progression was read
on their own benchmark page. Two HN quotes were read on HN's own API (items 46799479 and
48937517) and matched word for word. Numbers the subagents flagged as figure-read, repo-read,
or secondary are marked as such where they appear, and are not restated here as clean facts.

## The verdict

The instinct is supported, but not for the reason it was proposed. Smaller rounds with an
orchestrator choosing the next end state are the right shape, and the measured reason is not
that smaller goals are easier to plan: **perfect human-authored plans beat self-generated ones
by only +4.3pp** (ACL 2026, arXiv 2603.14248: 36.4% versus 32.1% success, Mind2Web-Live). The
three real levers are:

1. **Per-action selection is where success is lost**, not decomposition quality.
2. **The orchestrator call is the largest latency term in a real agent** (53.5% to 74.6% of
   task latency, OSWorld-Human arXiv 2506.16042), so it must fire at subtask boundaries, not
   every action.
3. **A round boundary is a context reset**, which is the mechanism that produced the largest
   single improvement found (SCoR, EMNLP 2026: frozen executor plus context reset at subtask
   boundaries, UI-TARS-1.5-7B 24.98% to 41.34%, +65.5% at a matched 50-step budget).

Point 3 matters most for this repo, because a jev-browser round already resets context: one
fresh heredoc scope per round, with only `job.json` and the task space carried. The mechanism
SCoR had to add is already the loop's boundary. Making rounds smaller and more numerous is the
same lever, not a new architecture.

## 1. Measured deltas from splitting

| Study | Setup | Result |
|---|---|---|
| Plan-and-Act, arXiv 2503.09572, ICML 2025 [P] | WebArena-Lite 165 tasks, base executor | 9.85% to 29.63% with a **trained** planner (+19.78pp) |
| Plan-and-Act, finetuned executor arm | same setup | 36.36% to 43.63% with planner (+7.27pp); **untrained planner hurt: 36.36% to 17.16%** ("suboptimal plans can confuse the Executor") |
| SCoR, EMNLP 2026, numbers from the authors' repo README (first-party, not read in the paper) | frozen executor, context reset at subtask boundaries, 50-step OSWorld budget | UI-TARS-1.5-7B 24.98% to 41.34% (+65.5%); EvoCUA-8B 42.39% to 53.16%; recovery on 54 failed tasks, 27 to 42 states |
| Mobile-Agent-v2, arXiv 2406.01014 [P] | with versus without Planning Agent | 61.4% versus 29.5% Advanced SR |
| PC-Agent, arXiv 2502.14282 [P] | with versus without Manager | 56.0% versus 12.0% PC-Eval SR |
| Agent S, arXiv 2410.08164; Agent S2, 2504.00906 [P] | hierarchical planning ablation | +6.15pp; +4.62pp at 15 steps to +6.15pp at 50 |
| Magentic-One, arXiv 2411.04468 [P] | orchestrator/ledger removed | "drops by 31%" |
| CoAct-1, arXiv 2508.03923 [P] | GUI-only versus hybrid | 50.68% versus 60.76% |
| DEPS, arXiv 2302.01560 [P] | ALFWorld, no replanning versus replanning | 10.0% versus 52.0% |
| ARC-Bench, arXiv 2609.05461 [P] | replan interval k=1 versus k=6 | 89.6% versus 61.8% (McNemar p=1.51e-9) |

The load-bearing caveat: an **untrained** orchestrator actively hurts (36.36% to 17.16%). The
orchestrator must be the strong component, which is exactly the proposed split (Claude Code
orchestrating, Jev executing inside a round), and exactly the reason not to put a second model
inside the loop as an orchestrator.

## 2. The mechanism is per-action selection, not plan quality

- **IBM, "From Grounding to Planning", arXiv 2409.01927, ECAI 2025 [P]**, on Mind2Web.
  Grounding (identify the element given the step instruction): DOM-based 90.4%. Planning
  (choose the next element given the task, at each step): best in-context 49.08%. With ground
  truth injected among **2 candidates the planner still scores only 86.05%**, and 5 candidates
  drops it to 75.25%. Conclusion: "grounding is not a significant bottleneck", and LVLMs
  "cannot act as web agents, even if perfectly grounded."
- **Aghzal et al., ACL 2026, arXiv 2603.14248 [P]**, Mind2Web-Live 104 tasks. With human
  plans: subgoal completion 69.7%, plan completion 38.5%, success 36.4%. Own plans: 32.1% (NL),
  35.6% (PDDL). Conclusion: "low-level execution remains the dominant bottleneck."
- **The apparent contradiction between these two is not one.** IBM's "planning" (choose the
  right action given the state) is Aghzal's "low-level execution" (turn a subgoal into the
  right action). Their actual measurements agree: IBM's upfront task-level pre-plan moved
  49.08% to 51.7% (+2.6pp), and Aghzal's perfect plan caps success at 36.4% versus 32.1%
  (+4.3pp). **Improving decomposition granularity is not the lever.**
- **The narrowing result, which is the strongest single effect found:** hallucinated invalid
  actions at 34.0% when the model emits a full action object, versus **2.0%** when it selects
  an action ID, and 3.0% for an expanded action space [P] (same ACL 2026 paper).

## 3. The cost of the orchestrator round trip

- OSWorld-Human, arXiv 2506.16042 [P]: planning is 53.47% (+/- 3.18) of task latency in Agent
  S2 and 74.59% in GTA1; grounding is 1.82% to 3.91%. Per-step median latency, read from
  Figure 3 rather than stated in text: about 7.5s at steps 5 to 10, about 22 to 23s at steps
  45 to 50, attributed to prefilling every prior screenshot.
- Two corrections to widely quoted numbers from that paper: the headline `$2.43 per task` is
  output-tokens only (all-in is $306.83 / 39 = **$7.87**), and the abstract's "2.7 to 4.3x
  more steps than necessary" is a mis-description of accuracy ratios (41.4/15.6 and 41.4/9.6),
  not a step count. The real step figure is 1.4 to 2.7x.
- OSWorld 2.0, arXiv 2606.29537 [P]: Claude Opus 4.8 at max thinking, 20.6% binary completion
  at 500 steps, **$72.4 per task, 481.8 tool calls**, 103 turns. The same agents score 79% to
  83% on OSWorld 1.0. Their framing: "cutting the number of environment turns an agent needs
  matters as much as cutting its token bill."
- Optimum granularity, no paper states a hard number: SPACE reports about 3 to 4 actions per
  LLM round; PANDO's optimal reflect interval is k_R=3; human trajectories group about 1.9
  actions per step (2.93x for Calc).
- Compounding, primary source: Sinha et al., arXiv 2509.09677, Prop. 1, s = p^N. The widely
  circulated "0.95 per step, 0.6% over 100 steps" is not in the paper; it is a blog plugging
  numbers into that formula. Cite the formula.
- Anthropic multi-agent [V]: about 15x the tokens of plain chat.

## 4. Shipping products, and where the industry actually sits

Full mechanism notes: `02b-industry-designs.md`.

- **Anthropic first-party endorses the proposed split**, verbatim and verified in the main
  session: "Advanced workflows may still benefit from an orchestrator + sub-agent pattern where
  a reasoning model handles planning and decision-making while Sonnet or Haiku executes the
  mechanical clicking steps." Same doc lists "Break complex interactions into smaller steps".
- **Stagehand v4 deleted its autonomous `agent()`**: "v4 exposes discrete tools and leaves the
  control flow to you", because "every step it ran was an inference call". `observe()` returns
  candidate actions without performing them, and passing an observed Action back to `act()`
  "replays it deterministically with no inference at all".
- **Skyvern** is the closest analogue to a route file, and orders its blocks by determinism:
  "Action blocks are the most deterministic... There's no interpretation; it either finds the
  element and clicks it, or fails", and "Start with the most deterministic block that can
  accomplish your goal." Its benchmark page (verified) gives 45% single loop, 68.7% with a
  planner, **85.85%** once the validation gap closed, mechanism named "planner-actor-validator
  agent loop", with the failure being a planner that "would assume it worked and moved on".
  Carry the caveat: vendor self-report, and WebVoyager is the benchmark audited down from 87%
  to 68.6% for Operator. The direction is the signal, not the number.
- **Browser Use argues the opposite** (Bitter Lesson, 2026-09-15): fewer, larger, model-chosen
  steps, one `browser_exec` tool replacing 12, mean token use down 60% (Opus 4.8) and 66%
  (Kimi K3) at 18 of 18 runs (n=6 tasks x 3 runs, thin).
- **Cost of an unbounded loop, from inside the camp**: Browser Use's hard-task benchmark,
  $580.87 per 100-task run ($5.81 per task) at 80.0% accuracy.
- **Where the industry converged**: nearly every vendor now scopes the model to locating,
  planning, and verifying, and hands execution to deterministic code through caching,
  compilation, or script-first-with-fallback. Browser Use's answer is model-written code
  rather than model-per-step decisions, which is determinism-adjacent.

## 5. Practitioner evidence

Full report with thread links: `02c-practitioner-discussion.md`.

- **For, shipped:** a verification layer where "each step is gated by explicit
  post-conditions... If the condition isn't met, the run stops with artifacts instead of
  drifting forward", and "The verifier just checks outcomes, it doesn't invent actions" (HN
  46799479, verified). Coasty's checkpoints: "the deterministic workflow defines the state it
  expects before resuming, and the agent's recovery job is to get the UI back into one of those
  known states... If it can't, the run pauses rather than pretending it knows where it is"
  (HN 48937517, verified).
- **Against:** the coordination tax ("you burn a surprising amount of tokens just summarizing
  state and passing it between the supervisor and workers"), over-specified handoffs breaking
  the navigator (the "foreman protocol" anecdote: an orchestrator inserting what it thinks
  should happen into the prompt, "which often screws up the subagent"), and the sharpest one
  for this project: Nous Research's measured finding that a narrow decider's job collapsed into
  "a programmatic rule, that you dont need any Jev or other model for".
- **Failure arithmetic:** a snowballing pattern rather than a step-count curse. A measured
  run on three environments: "Step count barely matters by itself... The thing that actually
  kills you is one bad step early that quietly snowballs", plus context pollution from piling
  retries into the same context. This is the mechanism that sparse context reset (SCoR) fixes.
- **Circularity warning, and it is load-bearing here:** the loudest pro-decomposition posts sit
  inside this project's own ecosystem (Browser Use + Jev, Stagehand + Jev). Treat those as
  advocacy with plausible numbers. The strongest independent for-evidence is the shipped
  verifier and Coasty's checkpoint design above.
- **One datum that cuts at the small-step thesis specifically:** Browser Use's co-founder
  posted "Browser Use + Jev = Ultrafast, 7s and $0.0039", then walked it back the next day:
  "Jev can't write text... can only choose a set of predefined actions. The problem with long
  running state action models is that the reasoning and state understanding becomes extremely
  important." If the navigator cannot write and cannot hold long state, the orchestrator
  inherits both.

## 6. Shape: what ego-browser hands Jev, and what Jev may do

This is the part that bears on the code rather than the plan. Per step the loop sends `goal`,
the pruned candidate list as `[ref, label]` pairs, a short `trail`, and **seven questions**: one
`choice` over all candidates plus six Nouls, almost all of them escalation predicates. The
action space is one verb: click. Four mismatches with the evidence:

1. **One action verb means everything else became a question.** Done, blocked, scroll, read,
   and canvas-unfamiliar exist as six Nouls asked every step because the model has no action to
   choose. Every enumerated-action-space result found is about a *set* of actions: AgentOccam
   +26.6 points (+161%) from observation and action space alignment alone, GRASP 40.6% to
   88.8%, FLAP 100% parsable, SPACE +7.0% to 31.3% with up to 78.9% fewer decision rounds.
   `spec.md` already cites the wider space as the deferred design (CLICK / TYPE_TEXT / SELECT /
   SCROLL_UP / SCROLL_DOWN / WAIT / DONE / BLOCKED, one `choice` head per operation in a single
   request). The measured instance of the cost: on LinkedIn, Jev picked the right job card and
   the click was a no-op because that card was already open, and the loop's only response was
   to ask again, three times, then exit `no_progress`.
2. **Seven questions per step is a 7-way AND.** The repo's own doctrine is "read the least
   certain judgment", and a product "falls as questions are added". Six of the seven buy no
   navigation. The LinkedIn trace: `next_target` 0.46 to 0.48 (the real uncertainty) with
   `needs_credential` 0.18, `cannot_choose` 0.28, `layout_unfamiliar` 0.14 riding along.
3. **The pick question is too wide, and list size is not the cure.** IBM's 86.05% at 2
   candidates with the answer among them says the difficulty is state reasoning, not reading
   the list. Measured here: 66 candidates on LinkedIn with a flat spread (0.5, then 0.13, 0.09,
   0.08, 0.05, "none" 0.12), and 120-candidate lists in M1 where the cap binds.
4. **What Jev reads best is what the loop uses least.** The clean reads in this repo's own data
   are Nouls over page text (0.98 present, 0.14 absent). The completion signal that fails is
   `goal_met` against a prose goal over a whole page (YouTube 0.2 / 0.22 / 0.2 / 0.68; LinkedIn
   0.35 and 0.40, and 0.81 only once the goal nearly quoted the page).

Two further findings that bear on shape rather than granularity: a choice head cannot recover
from an early mistake ("remains stable, with minimal incorrect flips but limited ability to
recover from an early mistake", arXiv 2511.09381), and the enumerated-action-space mechanism
has a stated boundary that is exactly this project's intended scope: it "helps in
non-clinical environments where tasks recur with verifiable structure and is flat where the
action space is open-ended" (GRASP, arXiv 2605.29668).

Also relevant from the constrained-decoding pass (`02a`, section on structured output): the
grammar and JSON-schema literature mostly does not apply here, because Jev never generates free
text and its answers are already fixed-shape. The transferable rule is one line: constrain the
output shape, never the reasoning tokens. One named gap: no study isolates the reliability gain
from replacing free-text output with a classification head, which is Jev's shape.

## 7. What this changes in the plan

- **Validated, unchanged:** #19 declared end states, #22's narrowed scope (recurring,
  verifiable structure), #21's measurement, #23's guards. The scope narrowing now has
  independent support from a fifth direction (GRASP's boundary, AgentOccam's action-space
  alignment, `02a` section C).
- **Added, and not filed:** widen the action space per `spec.md`'s own deferred design, and
  move verification to a post-condition after each action. The validator leg is where Skyvern's
  last 17 points came from, and OSWorld 2.0 finds agents spend under 7% of budget detecting and
  repairing their own errors.
- **Added:** collapse the six escalation Nouls into actions where possible (DONE, BLOCKED), so
  the per-step question count drops from seven to two or three. One narrow decision per step is
  the 2% invalid-action regime; seven questions is a 7-way AND.
- **Lowered:** `step_budget` 2 to 4 for the small-round mode, against the only measured band
  (3 to 4 actions per round).
- **Confirmed do-not:** no orchestrator inside the loop. ADK 2.0 [V] reports every multi-agent
  variant degrading 39% to 70% on strictly sequential tasks, and AgentOccam reaches 43.1% on
  WebArena with one plain loop.
- **Uncomfortable, and worth recording:** the small-loop change fixes none of the shape
  problems in section 6. Smaller rounds make those fail faster, not succeed more. Measured
  instance: five small LinkedIn rounds produced one finding, and the round that worked did so
  because the caller hand-aimed the goal at text the page states.

## 8. Conflicts, thin spots, and what nobody has measured

- **Unreconciled by any source:** Anthropic endorses orchestrator plus cheap clicker; Browser
  Use's Bitter Lesson argues fewer and larger model-chosen steps cut tokens 60% at equal
  success. Nobody tests step count against step size.
- **No controlled head-to-head exists** of one big loop versus orchestrator plus narrow
  per-step agent at matched inputs and budget, in peer-reviewed form. That is the thinnest
  question of the five, and it is precisely the proposal under evaluation. Closest proxies:
  SCoR, Plan-and-Act Table 1, Agentless versus SWE-agent.
- **No optimal granularity number** exists for agents; SPACE's 3 to 4 actions per round and
  PANDO's k_R=3 are the only proxies.
- **No data on the orchestrator choosing the wrong subgoal**, which is the failure mode the
  proposal most needs measured. The only concrete anecdote is the foreman protocol.
- **Nobody models the orchestrator's own context growth** as steps accumulate, which is where
  the "cheap" advantage would erode.
- **Counter-evidence that must not be dropped:** AgentOccam's plain single loop at 43.1% on
  WebArena (and a hard-coded strategy library hurting it, 43.1% to 41.1%); in-context prompting
  beating LangGraph orchestration 15 of 15 (arXiv 2604.27891); constrained decoding not being a
  clean win (3.6x to 8.2x latency, sometimes degrading task performance, arXiv 2605.02363);
  self-correction lowering accuracy (arXiv 2310.01798).
- **Circularity:** section 5. Pro-decomposition posts from Browser Use plus Jev and Stagehand
  plus Jev are advocacy, not independent confirmation.
- **Numbers not to repeat as stated:** "0.95^100 = 0.6%" (blog, not the paper); OSWorld-Human's
  "2.7 to 4.3x more steps" (accuracy ratios); Skyvern's 85.85% without the WebVoyager caveat;
  Browser Use's "98% OnlineMind2Web" (unverified vendor marketing inside a docs file).

## 9. Sources in this folder

| File | What it holds |
|---|---|
| `01-capability-boundary.md` | The earlier capability boundary research (browser versus search plus fetch), charted 2026-09-22 as an asset for #14 |
| `02a-academic-decomposition.md` | The academic angle: decomposition ablations, the planning-versus-execution contradiction resolved, orchestrator cost, deterministic control flow, and the constrained-decoding supplement |
| `02b-industry-designs.md` | The industry angle: first-party granularity guidance and per-product mechanisms (Anthropic, OpenAI, Google, Stagehand, Skyvern, Browser Use, Playwright MCP, Chrome DevTools MCP, Browserbase, Hyperbrowser, Notte, Steel) |
| `02c-practitioner-discussion.md` | The practitioner angle: HN, Reddit, and X threads with links, scores, and dates, plus the circularity warning |
