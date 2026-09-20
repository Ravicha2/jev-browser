# jev-browser

A deterministic browser loop where **Jev supplies the judgments** and **code owns the
control flow**. Claude Code hands it a goal; it explores, reads, and reports back
structured findings. It can fill forms. It never submits.

## Why this shape

System One is not an agent. The docs are explicit: it "does not generate code or choose its
own next action", and the API returns exactly three answer types with no function-call
output. There is no tool loop, no conversation, no second turn.

So the division is fixed:

| Actor | Owns |
|---|---|
| Claude Code | Decides *what* to do. Supplies the goal, answers escalations, judges nothing about the page. |
| The loop (this repo) | Owns control flow, thresholds, safety policy, and the exit contract. |
| Jev | Two or three narrow judgments per step, over text. |
| ego-browser | Every action: navigate, click, type, extract. |

Jev never clicks. Code clicks. This is not a limitation to work around; it is what makes the
loop auditable, because a misclick is a code bug rather than a model whim.

## Scope

**In scope**

- Exploratory *collection*: go find X, across pages, and report it. Destination unknown,
  page shape standard.
- Form filling: put known values into the right fields, and identify fields whose values are
  unknown.

**Non-goals**

- Submitting, sending, publishing, paying, deleting. Enforced in code, see Safety.
- Genuine open-ended exploration (following a hunch, changing strategy mid-task). Jev cannot
  change approach; that stays with Claude Code.
- Canvas and virtualized editors (Google Docs, Figma, maps, spreadsheets). Text input only,
  see Limits.
- Anything needing login or a credential. That hands off to the user.

## Verified platform facts

Everything below was checked against the live docs and the local environment, not assumed.

**TypeSafe**

| Fact | Value |
|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` |
| Auth | `Authorization: Bearer $TYPESAFE_API_KEY` |
| Model | `jev-latest`, currently resolving to `jev-1.13.0` |
| Price | $42 per Btok input ($0.042 per Mtok). **Output tokens are free.** |
| Rate limits | 250,000 tokens/second, 1,200 requests/minute |
| Context | 64k per request; **32k for `state` plus the longest question** |
| Input | Text only. No images, audio, or video. |
| Question types | `noul` (probability of yes), `choice` (one of a set), `score` (ordered levels) |
| Choice limit | 255 options max |
| Score limit | 2 to 10 levels |
| Answer shape | Noul: `{noul}`. Choice: `{choice, probabilities, confidence}`. Score: `{score, legend, probabilities, confidence}`. |

**ego-browser** (installed at `~/.local/bin/ego-browser`, verified)

| Fact | Value |
|---|---|
| Runtime | Node v24.18.0 in the heredoc, global `fetch` available |
| Invocation | `ego-browser nodejs <<'EOF' ... EOF`, helpers preloaded |
| Observation | `snapshotText()` returns an accessibility tree annotated with `[ref=N, loc=...]` |
| Acting | `click(target)`, `fillInput(target, text)`, `typeText`, `pressKey`, `scroll`, `js(...)` |
| Lifecycle | `useOrCreateTaskSpace(name)`, `handOffTaskSpace()`, `takeOverTaskSpace()`, `completeTaskSpace(name, {keep})` |
| Output | `cliLog(value)` is the only output channel and it writes to **stderr**, not stdout, so a caller that redirects stdout captures nothing. The last call is the script's return value. |
| Refs | `@N` refs are valid only for the most recent `snapshotText()` call |

**Cost consequence.** A 2k-token step is about $0.00008. A 20-step browse is about $0.002.
A thousand such tasks is under two dollars. Cost is not a design constraint here; build time
and pick accuracy are.

## Configuration

Two different things, in two different places.

**Installed config** lives beside the script as `jev-browser/.env`:

```
TYPESAFE_API_KEY=...
```

**Run state and findings** live under one root, derived from `HOME`:

| Path | Holds | Lifetime |
|---|---|---|
| `~/.claude/jev-browser/job.json` | Control state for the current run | Rewritten by the caller between rounds |
| `~/.claude/jev-browser/runs/<timestamp>-<slug>/ledger.jsonl` | The findings, one per line | Append-only, kept |
| `~/.claude/jev-browser/runs/<timestamp>-<slug>/trace.jsonl` | One line per step | Append-only, kept |

The caller cannot *choose* these paths, because nothing it passes reaches the heredoc (see
below), so they are derived from `HOME`. One loop runs at a time, so one `job.json` is
enough. That file records `run_dir`, which is how round N+1 finds the same run directory.
Nothing accumulates inside the skill directory.

Not `TMPDIR`, and this is worth stating plainly: the OS reaps it. Two things must outlive a
round. A login handoff (safety rule 3) can sit overnight before the user confirms, so a
reaped `job.json` means the task cannot be resumed at all. And the findings are the
deliverable, not scratch: a 100-job collection is the answer to the goal.

Rules:

- **`.env` is never committed.** `.gitignore` in this directory already lists `.env`,
  `job.json`, and `node_modules/`. `AgentOS` is not a git repo today, which is the only reason
  nothing is exposed yet.
- **Every path is absolute, and none of them can be passed in.** Verified: `process.cwd()`
  inside the heredoc is `/`, not the caller's directory, so `readFileSync('.env')` fails with
  `ENOENT` while the absolute path succeeds. Also verified, by running it: nothing from the
  caller reaches the heredoc at all. `process.argv` is electron's own, env vars set on the
  invoking command line are stripped before the script runs, `import.meta.dirname` is `/`, and
  `__filename` is undefined. Only `HOME` and `TMPDIR` survive, so the skill root and the job
  path are *derived* from those, never supplied.
- The key is read from the file, not from the shell environment. The user's key is exported in
  `~/.zshrc`, which is only read by *interactive* shells, so it is not visible to
  non-interactive processes such as the ego-browser heredoc.
- Never echo the key or include it in a `cliLog` line. It goes into the `Authorization` header
  and nowhere else.
- The goal and the resume answer travel in `job.json`, not in environment variables. That is
  injection-free (a goal string may contain arbitrary characters and must not be interpolated
  into a shell command) and makes every round reproducible and debuggable.

Verified capabilities of the heredoc runtime (Node v24.18.0):

```js
await import('node:fs')                        // works
import('node:fs').readFileSync(absolutePath)   // works
fetch(absoluteUrl)                             // works
process.cwd()                                  // is '/', do not rely on it
```

## Core decisions

**1. For exploratory work, Jev is the relevance and termination judge, not the click
dispatcher.** Asking Jev to choose among 120 near-identical DOM refs is a large-set ranking
task, and the docs show ranking is where it is weakest (the reranking cookbook moved top-1
from 5% to 18%). Instead, ask it which *content* matters and whether the goal is met, then
let code click the link it chose. This is also the shape the docs validate with real numbers:
the line-by-line search cookbook gets 0.98 and 0.97 for answers that are present and 0.14
when absent, with 0.7 and 0.35 thresholds.

**2. For form filling, Jev picks the field and picks which supplied value goes in it.** It
never generates the value. Jev is not trained to generate text, and forcing it is slow and
unreliable. Values come from code, either from the goal Claude Code supplied or from a
closed set of candidates.

**3. Policy lives in code, questions are about the world.** Never ask Jev "should I escalate
to Claude Code." That is a question about our system, it is exactly the kind of indirection
the model handles poorly, and it puts a threshold inside the model where it cannot be tuned.
Ask about the page, then branch on the number ourselves.

**4. Submitting is unreachable, not discouraged.** Not enforced by instruction. Enforced by
removing commit-like controls from the candidate list before Jev sees it.

**5. One request per step, several speculative questions in it.** Output tokens are free and
questions run in parallel, so ask for branches we may not take and read only the one we need.

## The step loop

One heredoc per round. Loop inside it, print one JSON object, exit.

```
1. snapshotText()                                  observe
2. prune to candidates                             code, plus the no-commit filter
3. fetch(/v1/systemone) with 4 to 6 questions       Jev judges, ~100ms
4. branch on the answers                            code
     - credential needed        -> handOffTaskSpace, exit escalate
     - only commit remains      -> exit escalate
     - goal met                 -> exit done
     - no candidate advances    -> retry once, then exit escalate
     - otherwise                -> click the chosen target, continue
5. guard: step budget, repeat page, ping-pong       code
```

Suggested limits: 12 steps for exploratory collection, 20 for form filling. Page load is
usually the real bottleneck, so do not be stingy with `wait` values.

## Candidate pruning

This runs in code before every Jev call. It is both the main accuracy lever and the safety
control.

1. Keep interactive nodes only: buttons, links, inputs, selects, textareas, and anything with
   a click handler or an interactive ARIA role.
2. Drop nodes with no visible text or label, unless they are inputs with a nearby label.
3. Drop off-viewport nodes. Ref churn and noise both come from these.
4. Deduplicate repeated labels; when several share a label, keep the first and note the count.
5. Truncate each label to roughly 120 characters.
6. Cap the list at 120 entries. The hard API ceiling is 255 Choice options; we stay well under
   because accuracy degrades as unrelated state grows.
7. **Remove commit-like controls.** Any node whose text or `aria-label` matches
   submit, send, post, publish, pay, buy, checkout, confirm, delete, remove, cancel order,
   unsubscribe, or a bare right-arrow, and any `input[type=submit]`.

Step 7 is a trust boundary, so it is a code rule and not a question. A denylist will miss
things (icon buttons, JS-driven buttons with a friendly `aria-label`). That is why the policy
degrades safely: when the pruned list is empty or *only* commit-like candidates remain, the
loop stops and escalates rather than guessing.

## Questions per step

Exploratory collection. `state` carries `goal`, the pruned `candidates`, and a short `trail`
of what has been visited already.

```js
questions = {
  // Content relevance: which result is worth opening. Jev's strength.
  next_target: {
    type: 'choice',
    instructions: 'Which candidate is most likely to lead toward `goal`? Choose `none` if none does.',
    criteria: { ...candidates.map(c => [c.ref, c.label]), none: 'None of these leads toward the goal' },
  },

  // Termination.
  goal_met: {
    type: 'noul',
    instructions: 'Does `current_page` already contain what `goal` asks for?',
    criteria: { true: 'The page states or directly contains the answer', false: 'It does not' },
  },

  // Page-level relevance, for deciding whether to extract here.
  worth_reading: {
    type: 'noul',
    instructions: 'Is `current_page` one of the pages `goal` asks us to read?',
    criteria: { true: 'This page is a target of the goal', false: 'It is navigation, a listing, or unrelated' },
  },

  // Escalation conditions, one per reason. Independent Nouls, composed in code.
  needs_credential:    { type: 'noul', instructions: 'Does `current_page` require a login or credential to proceed?' },
  cannot_choose:       { type: 'noul', instructions: 'Is there no candidate that clearly advances `goal`?' },
  only_commit_remains:{ type: 'noul', instructions: 'Are the only remaining actions ones that submit, send, publish, pay, or delete?' },
  layout_unfamiliar:   { type: 'noul', instructions: 'Is this an interface that `candidates` represents poorly, such as a canvas or virtualized editor?' },
}
```

Form filling adds per-field questions in the same request, following the function-calling
cookbook shape:

```js
// One Choice per field: which supplied value belongs here.
// One companion Noul per field: does the instruction say anything about this field at all?
'field_vat_number':        { type: 'choice', instructions: 'Which supplied value belongs in the VAT number field?',
                             criteria: { ...allowedValues, none: 'No supplied value belongs here' } },
'field_vat_number_stated': { type: 'noul',   instructions: 'Does `goal` mention a VAT number?' },
```

The companion Noul is what keeps the request small and prevents forced guesses: when it reads
low, code omits the field and moves on instead of filling something wrong.

## Confidence

**Read the least certain judgment, not the product.** One wrong answer spoils the result, and
a product falls as questions are added whether or not any single judgment is shaky. The
function-calling cookbook computes exactly this and also names the offending argument, which
tells us which single thing to re-ask.

Thresholds start here and get tuned on our own pages, not treated as rules:

| Signal | Threshold | Action |
|---|---|---|
| `goal_met.noul` | >= 0.8 | exit done |
| `next_target.confidence` | < 0.5 | retry once with a tighter candidate list, then escalate |
| `needs_credential.noul` | > 0.7 | `handOffTaskSpace`, exit escalate |
| `cannot_choose.noul` | > 0.6 | retry once, then escalate |
| `only_commit_remains.noul` | > 0.5 | exit escalate |
| any field `choice` confidence | < 0.6 | leave the field, report it in `needs_input` |

## Exit contract

The script prints exactly one JSON object via `cliLog`. That object is the whole interface
back to Claude Code. No other channel is needed, because the heredoc exits between rounds
anyway.

```json
{ "status": "done",        "goal": "...", "findings": [ ... ], "steps": 7, "url": "..." }
{ "status": "needs_input", "field": "vat_number", "wants": "a VAT registration number", "page_fingerprint": "..." }
{ "status": "escalate",    "reason": "credentials_required", "step": 9, "page_fingerprint": "...", "partial_findings": [ ... ] }
```

`needs_input` and `escalate` are deliberately separate. Escalate means "I cannot proceed."
Needs_input means "I can proceed, but I need a value I do not have," and it names the value so
Claude Code's reply is cheap.

## Where findings live

Three artifacts, because the audiences differ.

**The ledger is the payload.** One JSON line per finding, appended as it is collected, read
at exit by Claude Code, and named in the exit object. It is the answer to "go find X": for a
100-job collection, those 100 jobs are the ledger.

A finding is a *selected span*, never generated text:

```json
{ "id": "f1", "step": 4, "url": "https://...", "aspect": "price of item 3",
  "value": "$12.00", "evidence": "the exact line it was read from", "confidence": 0.94 }
```

`value` and `evidence` are copied from the page by code. Jev chooses which span; code copies
it. Making Jev write the value would break its "cannot generate text" limit, so extraction has
to be selection, which is also the pattern the docs validate.

**The digest is what Jev sees.** A bounded projection of the ledger into `state`: aspect,
value, and step, capped at roughly the last 20 entries. Jev needs it, or `goal_met` fires
early on a multi-item goal and it re-opens results already collected. It does not need the
rest, for the same reason it gets 120 candidates and not 400.

**The trace is for us.** One line per step: decision, probabilities, `page_changed`, url,
token usage, and latency. Never sent to Jev. M1 needs exactly these numbers and nothing else.

`visited_fingerprints` stays control-only and never enters `state`.

### The extraction question

`goal_met` returns a probability, not a value, so it cannot produce a finding on its own.
Extraction adds a selection question beside it, in the same request:

```js
answer_span: { type: 'choice', instructions: 'Which line contains the answer to `goal`?',
               criteria: { ...spans, none: 'No line contains the answer' } },
has_answer:  { type: 'noul', instructions: 'Does `current_page` contain an answer to `goal`?' },
```

Code copies the chosen span into the ledger. This is the line-by-line search cookbook the
thresholds came from, so `has_answer` has real numbers behind it instead of a guess.

## Resume protocol

Round N prints `needs_input` and exits. Claude Code answers. Round N+1 re-invokes with the
same task space id and the answer merged in. ego-browser supports resuming a space across
rounds, so page state survives. Nothing is held open.

Both rounds read the same `job.json`, which Claude Code rewrites between them. It lives in a
scratch directory, and its path is absolute because the heredoc's working directory is not the
caller's:

```json
{
  "task_space_id": 3,
  "goal": "find the VAT registration number on the account page",
  "supplied_values": { "vat_number": "IE1234567X" },
  "step_budget": 12,
  "visited_fingerprints": ["a1b2c3"]
}
```

```js
const job = JSON.parse(readFileSync(process.env.TMPDIR + 'jev-browser/job.json', 'utf8'))
const task = await useOrCreateTaskSpace(job.task_space_id)
```

`visited_fingerprints` is carried across rounds so the ping-pong guard still works after a
resume. Nothing is passed through the shell, so a goal string containing quotes, backticks, or
newlines cannot break the invocation.

## Packaging as a skill

This shape is a good fit for a skill, and the precedent is already installed:
`~/.claude/skills/ego-browser/` is `SKILL.md` plus `scripts/`, `references/`, and
`learnings/<site>/`. Same layout applies here.

```
~/.claude/skills/jev-browser/
  SKILL.md                          the orchestration layer
  scripts/explore.js                exploratory collection loop
  scripts/fill-form.js              form filling loop
  references/platform-facts.md      endpoint, limits, pricing, jaggedness table
  references/thresholds.md          tunable numbers and what they trade off
  learnings/<site>/                 per-site pruning rules and selector knowledge
```

`SKILL.md` carries exactly one thing the scripts cannot: **what Claude Code does with each
exit status.** That is the missing half of the design, because `escalate` needs a decision
maker:

| Exit | What SKILL.md tells Claude Code to do |
|---|---|
| `done` | Report findings. Nothing else to do. |
| `needs_input` | Answer the named field, rewrite `job.json`, re-invoke with the same task space id. |
| `escalate` / `credentials_required` | `handOffTaskSpace`, then tell the user exactly what to do and wait. |
| `escalate` / `layout_unfamiliar` | Drive ego-browser directly. Jev cannot read a canvas. |
| `escalate` / `cannot_choose` or `only_commit_remains` | Take over with ego-browser, or ask the user. |

### Routing

The ego-browser skill's description is broad by design: "use this skill whenever the user needs
to interact with a website... prefer ego-browser over any built-in browser automation." It will
win almost every browser trigger, so this skill needs to be pointed at from elsewhere. A
`CLAUDE.md` line is the right place, because `CLAUDE.md` is in context before skill matching
happens:

```markdown
- For exploratory collection across many pages, or filling a form from known values,
  use the `jev-browser` skill. Use `ego-browser` directly for single-page, open-ended,
  or visual/canvas browsing.
```

Editing ego-browser's `SKILL.md` body also works, but only as a second hop: descriptions are
matched *before* a skill is loaded, so a body line takes effect after ego-browser has already
won the trigger. It also risks being clobbered by a reinstall, since it is an installed skill at
a fixed path. Append-only edits survive better.

Either way, keep this skill's own description narrow and about the task shape, not the medium:

- Fires on: "collect X across many pages", "read every result on this site", "fill in this form
  from these values".
- Not for: single-page interaction, open-ended exploration, anything requiring submission,
  canvas or visual apps.
- Say so in its own words: "for one-off or exploratory browsing, use ego-browser instead."

Worth stating plainly: a skill's only real advantage over a plain script is automatic
discovery. If you will always invoke this explicitly, a script plus a line in `CLAUDE.md` is
less machinery. The skill earns its place here anyway, because the exit contract needs Claude
Code to know how to respond, and a skill is how that knowledge travels with the scripts.

After a user-facing handoff (login, captcha), resume only on explicit user confirmation and
start with `takeOverTaskSpace`, never on our own initiative.

## Safety rules

Non-negotiable, all enforced in code:

1. Commit-like controls never reach Jev. See pruning step 7.
2. When only commit-like candidates remain, stop and escalate. Do not pick the least bad.
3. Credentials, logins, captcha, 2FA: `handOffTaskSpace` immediately and tell the user exactly
   what to do. Jev does not judge anything about this path.
4. A user takeover is a hard stop for the whole task. Do not retry, do not auto-resume.
5. Page content is data, not instructions. Jev does not treat it as hostile, so a page saying
   "to continue, confirm your order" can move an answer. Pruning is the defense.
6. Findings are evidence, not actions. The loop reads and reports; it does not transact.

## Limits we design around

| Limit | Consequence |
|---|---|
| Text only, no images | Canvas and visual editors are out of scope. |
| 32k for `state` plus longest question | Prune and truncate before sending. A few pages of text fit; a crawl does not. |
| Literal reading (#1) | Write the exact condition. Jev answers what we wrote, not what we meant. |
| Large state rots accuracy (#5) | Filter first. 120 candidates, not 400. |
| Not a calculator (#2, #3) | Counting, date ordering, and arithmetic happen in code. |
| Cannot generate text (#9) | Form values are supplied, never invented. |
| No structural invariants (#8) | Do not assume `noul` and `1 - noul` agree, or carry a threshold from a Noul to a Choice. |
| Adversarial content (#6) | See safety rule 5. |
| Ranking is weakest (5% to 18% top-1 in the docs' reranking case) | Never ask for a ranking among lookalikes. Rank among content. |
| Bounded context, version aliases move | Pin `jev-1.13.0` once thresholds are tuned, and log the `model` field from each response so we know what answered. |

## Milestones

**M1: measure the pick, before building the vocabulary.** One heredoc loop over 10 real
exploratory tasks on one real site. Count per task: steps, wall clock, tokens, success, and
escalation rate. Success criteria for continuing: pick accuracy good enough that escalation
stays under about 20% of steps. If it is over 50%, Jev is adding a hop before Claude Code
does the work anyway and the answer is to prune harder in code, not to widen the vocabulary.

**M2: exploratory collection.** `explore.js`. Goal in, findings out, all three exits, the
ping-pong guard, handoff path.

**M3: form filling.** `fill-form.js`. Field picking, supplied values, companion Nouls, the
`needs_input` round trip. Never submits.

**M4: per-site learnings.** The stable pruning rules and selector knowledge that emerge from
real use, in the same spirit as ego-browser's own `learnings/<site>/` convention.

## Ping-pong guard

A real failure mode: Jev escalates, Claude Code answers, the loop resumes, and Jev escalates
again on the same page, burning rounds with no progress. Every escalation carries a step index
and a `page_fingerprint` (a hash of the pruned candidate list plus the URL), and a resumed run
refuses to escalate twice on the same fingerprint. On the second attempt it goes straight to
`needs_input`, or gives up. A few lines, and it is the difference between a loop that
converges and one that spins.

## Open questions to verify before M2

1. ~~File access in the heredoc runtime.~~ **Resolved.** `await import('node:fs')` works, and
   `readFileSync` reads `.env` by absolute path with the key line present. `process.cwd()` is
   `/`, so absolute paths are mandatory. See Configuration.
2. What does the goal string from Claude Code look like in practice, and how structured should
   it be? A free sentence versus `{task, target, fields}` changes the questions.
3. ~~Real page fingerprint cost.~~ **Resolved.** Hashing the pruned candidate list is cheap and
   stable, but only if the hash is *ref-free*: `@N` refs are CDP backend node ids, so a
   re-render can renumber them and the guard would never fire. The fingerprint is
   `sha256(url + label|count pairs)`, and `scripts/prune.js` checks that a re-render with every
   ref renumbered hashes identically.
4. `serverFetch`'s exact return shape is not documented clearly enough to rely on. Use global
   `fetch` for the TypeSafe call, which is confirmed present.
5. ~~When packaged as a skill, does Claude Code reliably pass the absolute skill root into the
   heredoc?~~ **Resolved, and the answer is no.** Nothing from the caller arrives: `argv` is
   electron's, env vars are stripped, `import.meta.dirname` is `/`, `__filename` is undefined.
   See Configuration. The root is derived from `HOME` and proven by finding `.env`.

## Out of scope for now

- Any multi-agent or parallel-tab fan-out. One loop, one task space.
- Fine-tuning or per-account adaptation. Jev is not trained on customer data; domain behavior
  comes from `state` and `criteria`.
- Submitting anything, ever, including "safe" submissions.
