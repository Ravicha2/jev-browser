# 02a: academic angle on decomposition

Compiled 2026-09-22 from the academic research subagent's report during the main session,
with the constrained-decoding supplement folded in as section F. The synthesis that cites
this file is `02-decomposition-evidence.md`. Tags: `[P]` peer-reviewed or first-party,
`[V]` vendor, `[S]` secondary. Numbers marked "figure-read" or "repo-read" were not in the
paper text the subagent could quote, and are flagged where they appear.

**Read the caveats, they are the difference between a citation and a mis-citation.** This
field is dense with numbers that travel from paper to blog to slide deck with their
conditions stripped. Section H names the ones worth distrusting.

## A. Decomposition ablations, with numbers

| Study | Setup | Result | Tags |
|---|---|---|---|
| Plan-and-Act, arXiv 2503.09572, ICML 2025 | WebArena-Lite, 165 tasks | 9.85% to 29.63% with a trained planner (+19.78pp) | [P] |
| Plan-and-Act, finetuned executor arm | same | 36.36% to 43.63% (+7.27pp); **untrained planner: 36.36% to 17.16%** ("suboptimal plans can confuse the Executor") | [P] |
| SCoR, EMNLP 2026 | frozen executor, context reset at subtask boundaries, matched 50-step OSWorld budget | UI-TARS-1.5-7B 24.98% to 41.34% (+65.5%); EvoCUA-8B 42.39% to 53.16%; recovery on 54 failed tasks, 27 to 42 states | [P] numbers repo-read |
| Mobile-Agent-v2, arXiv 2406.01014 | with versus without Planning Agent | 61.4% versus 29.5% Advanced SR | [P] |
| PC-Agent, arXiv 2502.14282 | with versus without Manager | 56.0% versus 12.0% PC-Eval SR | [P] |
| Agent S, arXiv 2410.08164; Agent S2, 2504.00906 | hierarchical planning ablation | +6.15pp; +4.62pp at 15 steps rising to +6.15pp at 50 | [P] |
| Magentic-One, arXiv 2411.04468 | orchestrator plus ledger removed | "drops by 31%" | [P] |
| CoAct-1, arXiv 2508.03923 | GUI-only versus hybrid | 50.68% versus 60.76% | [P] |
| DEPS, arXiv 2302.01560 | ALFWorld, no replanning versus replanning | 10.0% versus 52.0% | [P] |
| ARC-Bench, arXiv 2609.05461 | replan interval k=1 versus k=6 | 89.6% versus 61.8% (McNemar p=1.51e-9) | [P] |

Reading of the table: the gains are real and large, and the largest ones come from
mechanisms that are not "more decomposition". SCoR's +65.5% is a frozen executor plus a
context reset; DEPS and ARC-Bench measure replanning frequency, not planner quality.

The single most important row for this project is the second one. An untrained planner
nearly halved success. If an orchestrator is added, it must be the strong model, and it must
not be a second small model sitting inside the loop.

## B. The planning-versus-execution contradiction, and its resolution

Two 2025-2026 papers appear to disagree about where browser agents lose. They do not.

- IBM, "From Grounding to Planning", arXiv 2409.01927, ECAI 2025 [P], Mind2Web.
  Grounding (find the element named by the step instruction), DOM-based: 90.4%. Planning
  (choose the next element at each step given the task), best in-context: 49.08%. Injection
  test: with ground truth supplied among **2 candidates the planner still scores only
  86.05%**; at 5 candidates, 75.25%. Verdict: "grounding is not a significant bottleneck",
  and LVLMs "cannot act as web agents, even if perfectly grounded." Upfront task-level
  pre-planning moved 49.08% to 51.7% (+2.6pp).
- Aghzal et al., ACL 2026, arXiv 2603.14248 [P], Mind2Web-Live, 104 tasks. Human-authored
  plans: subgoal completion 69.7%, plan completion 38.5%, success 36.4%. Model's own plans:
  32.1% success (NL), 35.6% (PDDL). Verdict: "low-level execution remains the dominant
  bottleneck."

The reconciliation: IBM's "planning" is Aghzal's "low-level execution". Both name the same
step, choosing the right action from the current state. Both measured that improving the
decomposition above it buys between +2.6pp and +4.3pp. Aghzal's human plans are the ceiling
test: a perfect plan lifts success only to 36.4%, so the loss is not in the plan.

**Consequence for this project:** the reason to split into many small rounds is not that
better decomposition is the win. It is (a) the per-round context reset, (b) putting each
decision in a state where the correct action is easier to name, and (c) letting the strong
model do the step selection the round is bad at.

## C. Action space and observation alignment, the strongest effect found

- **Aghzal et al., ACL 2026, arXiv 2603.14248 [P].** Hallucinated invalid actions: 34.0%
  when the model emits a full action object, **2.0%** when it selects an action ID, 3.0% for
  an expanded action space. This is the highest-leverage ratio in the corpus: a 17-fold
  reduction in invalid actions purely from the shape of the answer.
- **AgentOccam, arXiv 2410.13825 [P].** WebArena 43.1% with one plain loop. Observation and
  action space alignment alone accounted for **+26.6pp (+161%)**. A hard-coded strategy
  library **hurt**: 43.1% to 41.1%. This is the cleanest statement of both the pro-shape and
  anti-hard-coding positions in one paper.
- **GRASP, arXiv 2605.29668 [P].** 40.6% to 88.8%. Its boundary sentence is the most useful
  scope statement found for this project verbatim: it "helps in non-clinical environments
  where tasks recur with verifiable structure and is flat where the action space is
  open-ended."
- **SPACE, arXiv 2609.02042 [P].** About 3 to 4 actions per LLM round; +7.0% to 31.3% success
  with up to 78.9% fewer decision rounds.
- **FLAP, arXiv 2403.11322 [P].** 100% parsable actions with a fixed action schema, versus
  82% with free-form JSON.
- **2511.09381 [P].** A multiple-choice head "remains stable, with minimal incorrect flips but
  limited ability to recover from an early mistake." A choice-shaped interface does not
  self-correct; the loop must catch a wrong pick, because the model will not.

StateFlow, arXiv 2403.11322 [P]: +13% and +28% on two tasks, 3 to 5x lower cost, with an
explicit state machine over the flow.

## D. Orchestrator cost and granularity

- **OSWorld-Human, arXiv 2506.16042 [P].** Planning is 53.47% (+/- 3.18) of task latency in
  Agent S2 and 74.59% in GTA1. Grounding is 1.82% to 3.91%. Per-step latency median, figure-read
  from Figure 3: about 7.5s at steps 5 to 10, rising to about 22 to 23s at steps 45 to 50,
  attributed to prefilling every prior screenshot. If the orchestrator fires every action, it
  owns more than half the wall clock. It must fire at subtask boundaries.
- Two widely quoted numbers from that paper are wrong as they travel. The headline
  `$2.43 per task` is output tokens only; all-in is $306.83 / 39 = **$7.87 per task**. The
  abstract's "2.7 to 4.3x more steps than necessary" describes accuracy ratios (41.4/15.6 and
  41.4/9.6), not a step count; the real step figure is 1.4 to 2.7x.
- **OSWorld 2.0, arXiv 2606.29537 [P].** Claude Opus 4.8, max thinking: 20.6% binary
  completion at 500 steps, **$72.4 per task, 481.8 tool calls, 103 turns**, while the same
  agents score 79% to 83% on the 1.0 suite. Their framing: "cutting the number of environment
  turns an agent needs matters as much as cutting its token bill." Also: agents spend **under
  7%** of their budget detecting and repairing their own errors, which is the measured case
  for doing verification in code rather than asking the model to notice.
- Granularity proxies, no paper states an optimum: SPACE about 3 to 4 actions per round;
  PANDO's optimal reflect interval k_R=3; human trajectories group about 1.9 actions per step
  (2.93 for Calc).
- Compounding, primary source: Sinha et al., arXiv 2509.09677, Prop. 1, `s = p^N`. The
  circulating "0.95 per step gives 0.6% over 100 steps" is a blog's arithmetic, not the
  paper's; cite the formula, not the example.
- Cost comparisons at matched-ish tasks: Agentless, arXiv 2407.01489 [P], $0.70 versus $1.62;
  Agentic Compilation, arXiv 2604.09718 [P], roughly $150 to under $0.10 per workflow.

## E. Deterministic control flow

- **Agentless, arXiv 2407.01489 [P].** A fixed three-phase pipeline with no autonomous loop
  beat agentic scaffolds on SWE-bench-lite at half the cost. The strongest single argument
  that control flow belongs in code.
- **Agentic Compilation, arXiv 2604.09718 [P].** Compiles a repeated workflow into a
  deterministic program: about $150 to under $0.10 per run.
- **StateFlow, arXiv 2403.11322 [P].** Explicit state machine over the flow: +13% and +28%,
  3 to 5x cheaper.
- **AgentOccam, arXiv 2410.13825 [P].** See section C, including that a hand-written strategy
  library hurt.

## F. Structured output and constrained decoding (supplement)

The transferable finding: **constrain the output shape, never the reasoning tokens.**

- "Let Me Speak Freely", EMNLP 2024 Industry, arXiv 2408.02442 [P]. `claude-3-haiku` fell
  from 86.51% to **23.44%** under a strict JSON schema. And 100% of GPT-3.5-Turbo JSON-mode
  replies placed the `answer` field before the `reason` field, a structural artifact of
  schema order, not a reasoning decision.
- DOMINO, arXiv 2403.06988 [P]. Naive constraining moved 41.5% to 30.8%; minimally invasive
  constraining held 41.8%. The damage comes from aggressive lookahead, not from the format.
- CRANE, ICML 2025, arXiv 2502.09061 [P]. Grammar augmentation recovers up to 10pp; the fix
  is to preserve the reasoning channel while constraining the final answer.
- arXiv 2605.02363 [P]: constrained decoding is not a clean win, 3.6x to 8.2x latency and
  occasionally worse task performance.
- **Why most of this does not apply to Jev.** Jev never generates free text; its answers are
  already fixed-shape (a choice and Nouls). The grammar and JSON-schema literature is about
  keeping a generative model inside a format. The one open question it leaves is real and
  named as a gap: **no study isolates the reliability gain from replacing free-text output
  with a classification head**, which is exactly Jev's shape. That is an argument for the
  design, not evidence for it.

## G. Counter-evidence, do not drop

- AgentOccam, arXiv 2410.13825 [P]: one plain loop at 43.1% on WebArena, and a hard-coded
  strategy library made it worse.
- arXiv 2604.27891 [P]: in-context prompting beat LangGraph orchestration 15 of 15.
- arXiv 2310.01798 [P]: self-correction lowered accuracy, the model flips correct answers to
  wrong ones when asked to reconsider.
- Google ADK 2.0 [V]: every multi-agent variant degraded 39% to 70% on sequential PlanCraft.
- arXiv 2605.02363 [P]: constrained decoding can hurt, section F.

## H. Gaps and numbers not to repeat

- **No controlled head-to-head** of one big loop versus orchestrator plus narrow per-step
  agent at matched inputs and budget. Closest proxies: SCoR, Plan-and-Act Table 1, Agentless
  versus SWE-agent. This is the question the project actually asks, and it is unmeasured.
- **No optimal granularity number** for agents. 3 to 4 actions per round (SPACE) and k_R=3
  (PANDO) are the only proxies.
- **No data on an orchestrator choosing a wrong subgoal**, the failure mode the many-small-
  loops proposal most needs measured.
- **No study of the orchestrator's own context growth** as rounds accumulate.
- **Do not repeat as stated:** "0.95^100 = 0.6%" (blog, not the paper); OSWorld-Human's "2.7
  to 4.3x more steps" (accuracy ratios); OSWorld-Human's "$2.43" without saying output-tokens
  only; SCoR's numbers as paper-read when they are repo-read; Skyvern's 85.85% without its
  vendor and benchmark caveats.
