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
| State across rounds | One long-lived process, one **fresh script scope** per heredoc. Verified: two invocations report the same `process.pid`, and `globalThis` resets (a counter set to 1 is still 1 on the next call), while the page keeps its URL, its scroll position, and its own globals. So nothing you declare carries over, and the task space is the handle to what does. |
| Scrolling | `js('window.scrollTo(0, y)')` is precise and `scrollToBottomUntil()` is bulk, both verified. `scroll(n)` advances about 300px whatever `n` says, and `scrollBy` does nothing. `pageInfo().sy` matches `window.scrollY`. |
| Also available | `snapshot()`, `snapshotRaw()`, `elementCenter(ref)` returning `{x, y}` with a negative y above the viewport, `hover`, `captureScreenshot` (a path, not image data), `waitForElement`, `waitForLoad`, `waitForNetworkIdle`, `currentTab`, `listTabs`. `dispatchKey` takes a target then a key. There is no `select`. |

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

**6. The offer is what Jev is actually shown, so its shape is a design surface (#30).** A row
carries its position in the offer and, when the page has one, its state — `(current)`,
`(selected)`, `(expanded)`. Decision 1 says Jev is the relevance judge rather than the click
dispatcher; this is the part of that judgment the offer itself can make easier or harder. Both
facts ride in the row's text rather than as a second field per candidate: `criteria` is a flat
`{ref: text}` map, and prefixing a string is a smaller change than widening the protocol. See
"The offer's shape" under Candidate pruning for what was measured and what it cost.

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
     - no candidate advances    -> scroll one viewport if the page is worth
                                   reading and unread below; otherwise retry
                                   once, then exit escalate
     - otherwise                -> reveal the target if off-screen, click it, continue
5. guard: step budget, repeat page, ping-pong       code
```

Suggested limits: 12 steps for exploratory collection, 20 for form filling. Page load is
usually the real bottleneck, so do not be stingy with `wait` values.

### Freshness, and consuming the decision

Observed in practice, not designed in the abstract: on a hydrated page, the candidate list
moves between the snapshot the decision was made from and the moment of the click. So the
step observes again immediately before acting, and:

- **A moved page is not acted on.** If the fingerprint at act time differs from the one at
  decision time, the decision is discarded, nothing is clicked, and the loop re-observes and
  re-asks. A stale ref is a misclick, so this is a safety property, not only an accuracy one.
  Two discards in a row escalates as `stale_page`.
- **The ref is read from the act-time snapshot**, at the position Jev chose from, and never
  carried across steps. `@N` refs belong to the most recent `snapshotText()` and nothing else.
- **The decision is consumed before any mutation.** The ref is used exactly once, so a click
  that throws cannot be retried into a double-click.
- **The action is recorded before the next observation**, so a stale post-action snapshot
  cannot erase the record of something that did happen.

### Blocked means no progress, not no navigation

Three consecutive actions with no observable change ends the round as `no_progress`. That
counts what matters: a page that changed but did not advance is progress, and an action that
changed nothing is not. It is tighter than the repeat-page guard, which catches leaving a page
and coming back to it, and separate from ping-pong, which is about escalating twice on one
fingerprint across rounds.

Observable change is the fingerprint **or** the scroll position. The fingerprint is
deliberately scroll-stable (fragment-free URL, sorted `label|count` pairs), because the loop
scrolls on purpose and the repeat-page guard must not fire on every scroll — so a scroll the
loop did not cause counts on `pageInfo().sy` instead, above a small drift epsilon so a sticky
header cannot fake progress forever.

The baseline is read **after** the action, never before it (#17). Three things move the page
and all three are the loop's own doing: `reveal()` scrolls an off-screen target into view before
every click, the click then follows the anchor's own href, and a read-scroll jumps a whole
viewport. A baseline taken from the pre-action observation therefore describes a page the next
step will never see, and every one of those jumps reads as the page having moved and resets the
count. That is how the HN round clicked one `root` anchor at steps 4, 5, 8, 9, 11 and 12 and
ended on `step_budget` with the count already at 3.

The baseline costs a real signal, and this is the trade: a click that only scrolls an
already-loaded page to an anchor — a docs site's table of contents — moves the viewport without
changing the fingerprint, so it no longer counts as progress either. Three of those in a row end
the round as `no_progress`; the per-page read-scroll limit bounds the same shape for scrolling.
What the counter now measures is content the loop had not seen, not viewport position the loop
produced itself.

A dead action spends its own target before the next decision (#27). A click that changed
nothing is the one signal the loop has that the pick was right about the **content** and
wrong about the **state**: LinkedIn's guest jobs search pre-renders the `currentJobId` card
in the detail panel beside the list, so the card for the job already shown is a no-op click,
and Jev, stateless between steps, names that same card again because nothing on the page
said otherwise. Nothing the loop already had breaks the tie: the page is never left, so it
never enters `visited`, so `repeat_page` never fires, so nothing is ever spent, and the round
ends `no_progress` after three identical clicks that each had a live alternative beside them.

So the target is spent by the same key a revisit spends by (the target url, with the label
only as the url-less fallback), and the next ask excludes it. The spend is one action deep:
the next click clears the spent sets, and a dead action there spends its own target in turn,
so each dead action retires exactly what it proved dead. Spending is **unchanged fingerprint
only**: a page that changed but did not advance is the progress signal the loop already has,
and blaming the pick for it would spend a target that may still be the way forward.

When the offerable set empties, the round ends `no_progress`, not `cannot_choose`: the loop
acted and nothing moved, which is what that reason already means, and the alternative sends
Jev a list holding one `none`. `NO_PROGRESS_LIMIT` still bounds a page with many dead
candidates, so a 66-card listing does not pay 66 asks to prove the same thing.

**Row state does not retire that spend (#30).** The state mark (below) removes the *cause* in
the case #27 was written for: the already-open card is now labelled `(current)` before the ask,
so the pick stops landing on it (0.47/0.51/0.51 flat against 0.19/0.18/0.11 marked, measured
2026-09-22) instead of spending a step to find that out. It is still not redundant, on the two
shapes #27 already covers and the state mark cannot see: the **tracking twin** is the same job
under a different href (`?eBP=` against `?alternateChannel=search`), so it is not the element
the state query marks and it still takes the pick in the marked arm; and a page that
**re-renders while it loads** resets the fingerprint every step, so nothing accumulates and
only the spend bounds the repetition. Both are `no_progress`-shape failures, so `no_progress`,
`NO_PROGRESS_LIMIT`, `repeat_page`/`REVISIT_LIMIT`, `ping_pong`, `step_budget`,
`only_commit_remains`, `start_url_mismatch` and `stale_page` all keep their live triggers.
Nothing in the guard set becomes dead code; the state mark makes one guard fire earlier, not
less often.

A return to a decided page is a **revisit**, not a stall (#10, refined in #11). The repeat-page
guard grants one re-decision per fingerprint, spends the outbound and inbound paths **by target
url, not label** — twins share a label, and label-keyed spending deleted the real section anchor
in task 5 — and a granted revisit reads one viewport deeper before it re-decides when the page
is worth reading, under the same per-page scroll limit. A second return is a real
`repeat_page` escalate.

## Candidate pruning

This runs in code before every Jev call. It is both the main accuracy lever and the safety
control.

1. Keep interactive nodes only: buttons, links, inputs, selects, textareas, and anything with
   a click handler or an interactive ARIA role.
2. Drop nodes with no visible text or label, unless they are inputs with a nearby label.
3. **Keep off-screen nodes.** The list is pruned from the full page tree, never the viewport:
   a collection agent's destination is usually below the fold of a long page (M1 measured the
   old viewport filter deleting it in 8 of 9 failures, 1,208 of 1,251 refs on one page). Which
   candidates are currently visible is a *hint* for acting — the loop scrolls a target into
   view before clicking it — never a filter on the offer.
4. **Drop self-referential anchors.** A candidate whose url equals the current page's url
   cannot change anything by being clicked — not the page, not the scroll position — so
   offering it only invites the no-progress guard to clean up afterwards.
5. Deduplicate repeated label **and target url** pairs (#11): a label is not a destination,
   and the same text pointing at two urls is a pair of twins — a docs page's cross-reference
   and its real section anchor share a label — so each twin keeps its own seat and count.
   Identical label *and* identical target collapse onto the first; url-less controls still
   dedupe on the label alone.
6. Truncate each label to roughly 120 characters.
7. Cap the list at 120 entries, **with the page's own anchors taking the seats first** (#11):
   when the cap binds on a monster page, candidates targeting the current page (url equal to
   it up to the fragment, or fragment-only) come ahead of cross-page navigation, DOM order
   within each group. A blind DOM-order slice keeps a monster page's sidebar and deletes its
   own TOC — the measured way task 3 lost its destination. The hard API ceiling is 255 Choice
   options; we stay well under because accuracy degrades as unrelated state grows. The
   reordering is scroll-stable (urls do not move with the viewport) and fingerprint-invisible
   (the fingerprint hashes sorted label|count pairs, not order).
8. **Remove commit-like controls.** Any node whose text or `aria-label` matches
   submit, send, post, publish, pay, buy, checkout, confirm, delete, remove, cancel order,
   unsubscribe, or a bare right-arrow, and any `input[type=submit]`.

Step 7 is a trust boundary, so it is a code rule and not a question. A denylist will miss
things (icon buttons, JS-driven buttons with a friendly `aria-label`). That is why the policy
degrades safely: when the pruned list is empty or *only* commit-like candidates remain, the
loop stops and escalates rather than guessing.

### The offer's shape (#30)

The pruning above decides *which* candidates are offered. This decides how the offer reads,
because on a page like a job search the list is 64 to 73 entries and the ranking ask is the
step's most expensive judgment. Two facts were missing from a row, and both now ride in the
row's text (decision 6):

- **Position.** `offerRow()` numbers each row by its index in the offer. Before this, nothing
  in the offer said which entry came first, so a goal naming a position could only be answered
  by plausibility. Measured on the guest LinkedIn search page: the entry a positional goal
  names — the first job listing — is row 23 of 65, behind 21 chrome rows (skip links, the
  search form, five filter buttons, an alert CTA, two jump buttons). A "first N window" is
  therefore the wrong fix, and this is the measurement that says so: 0 of 19 picks in the
  rounds on record fell inside the first 10, and the destination is at 23.
- **State.** The accessibility tree annotates a node with `ref`, `loc` and `url` and nothing
  else — measured, zero state lines in a 658-line tree — so a control that is already open or
  already selected looked exactly like one that was not. `stateMarks()` reads `aria-current`,
  `aria-selected` and `aria-expanded` off the element each candidate's `loc` names, walking up
  to four ancestors because LinkedIn marks the card's wrapper rather than the anchor. Marked
  rows read `23. Engineer | AI Assurance (current)`.

The cost is one DOM query per observation and no extra request: state travels inside text that
was already being sent, so token cost is a few characters per candidate, and the query is
in-page with no latency budget of its own. The candidate object keeps its bare label —
the trail, the spend key and `resolveTarget` all outlive the step and compare against it — so
the numbered text exists only in the request.

**What it did and did not buy** (runs in `~/.claude/jev-browser/runs/`, 2026-09-22):
the state half did what it was for. In the already-open-card scenario the marked row fell from
the argmax in all three flat rounds (0.47, 0.51, 0.51) to a non-contender in both numbered
rounds (0.19, 0.18, 0.11), and the pick moved to a different row. The position half did not
move the pick or the confidence: the model already landed on the named entry from the labels
alone, in both shapes. It did have one measured side effect — a chrome control whose text
shares the goal's words ("Try AI job search", row 21 of 65) rose from ~0.10 to ~0.35 in seven
numbered rounds against eleven flat ones where it stayed at or below 0.14. That is one decoy
row on one page, so it is recorded as a risk rather than a reason to drop the numbering, but
the next page measured should check it.

**A positional goal lands the named entry, and still does not finish.** In every flat round
that got a click away, the pick was the same row: offer index 22, which is the first job
listing, at row 23 of 65. In
`.../runs/2026-09-22T11-51-12-551Z-open-the-first-job-listing-in-this-linke` the step 2 click
navigates to `/jobs/view/4469156162/` — the first listing's details, which is what the goal
asked for — and the round then spends its remaining steps on the card that is now already open
and on the tracking twin, exiting `step_budget` at step 7. `goal_met` reads 0.21, 0.28, 0.30,
0.34 across those steps and never approaches 0.8, so the goal is met on the page and unmet in
the reading. That is not a position defect and not an offer-shape defect; it is the next thing
to measure on this page, and it is why the positional rounds are recorded as landing the entry
rather than as finishing it.

What the offer shape is *not* is the binding constraint on that page, and the measurement says
why. On the same 65-row offer, a goal with an unambiguous destination ("open the job listing
titled 'Computational Biologist - AI Trainer'") scored 0.95 on its first ask, while the
positional goal scored 0.44 to 0.65. The argmax is thin because the rows are near-identical
job titles, not because the list is long: the model's choice was right and its confidence was
honest. Region heads (shape 2 of #30) would not change that, and the gate question that
`NEXT_TARGET_CONFIDENCE` really is stays open where #30 parked it.

The two decisions #30 left contingent on shape 2 stay unmade for the same reason: shape 2 was
not built, so there is no `done` question for it to answer, and cutting the offer by page
region is not attempted. What was built is the smaller change the measurement supported.

## Questions per step

Exploratory collection. `state` carries `goal`, the pruned `candidates`, and a short `trail`
of what has been visited already.

```js
questions = {
  // Content relevance: which result is worth opening. Jev's strength.
  // Each row is numbered by its position in the offer and carries its state
  // (#30), so "the first job listing" and "the panel that is already open" are
  // answerable from the offer itself.
  next_target: {
    type: 'choice',
    instructions: 'Which candidate is most likely to lead toward `goal`? Each row is numbered by its position in the list, and a row marked (current), (selected) or (expanded) is already open. Choose `none` if none does.',
    criteria: { ...offered.map(row => [row.ref, row.label]), none: 'None of these leads toward the goal' },
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

The companion Noul is what keeps the request small and prevents forced guesses: when it
reads low, code omits the field and reports it in `needs_input` instead of filling
something wrong (#7).

## Confidence

**Read the least certain judgment, not the product.** One wrong answer spoils the result, and
a product falls as questions are added whether or not any single judgment is shaky. The
function-calling cookbook computes exactly this and also names the offending argument, which
tells us which single thing to re-ask.

Thresholds start here and get tuned on our own pages, not treated as rules:

| Signal | Threshold | Action |
|---|---|---|
| `goal_met.noul` | >= 0.8 | exit done |
| `has_answer.noul` | >= 0.7 | the extraction ask's chosen span is copied into the ledger as a finding |
| `has_answer.noul` | >= 0.35, < 0.7 | the chosen span is copied with `tentative: true`: the model named a line its own `has_answer` did not back, and the round would otherwise end with an empty ledger |
| `has_answer.noul` | < 0.35 | the cookbook's absent band: no entry. A firing `goal_met` on a page this low is a disagreement the trace records. |
| `next_target.confidence` | < 0.5 | retry once over the same list, then escalate. Open: a measured click-and-observe arm, below |
| `needs_credential.noul` | > 0.7 | `handOffTaskSpace`, exit escalate |
| `cannot_choose.noul` | > 0.6 | scroll if worth reading and unread below, retry once, then escalate |
| `worth_reading.noul` | > 0.5 | with a retry pending, or a granted revisit (#11): scroll one viewport before spending it, max 3 per page |
| `only_commit_remains.noul` | > 0.5 | exit escalate |
| any field `choice` confidence | < 0.5 | leave the field, report it in `needs_input` |

A malformed `choice` answer gets the same one retry before escalating as `invalid_response`,
so a self-disagreeing answer costs a re-ask rather than a round.

**The confidence gate is a checkpoint against a reversible action (#30, widened).** The #30
measurement rejected the margin re-expression (a margin would not have saved a correct pick at
0.5), and the design pass over it adds the option that follows from the same evidence: a sub-bar
pick on a **reversible** target becomes click-and-observe — click it, let the posterior guards
judge the landing — as a measured arm against the retry/escalate path. The asymmetry is the
argument: an escalate ends the round (session 2: 326,070 input tokens over nine LinkedIn rounds,
about 36k each, four dead before a guard mattered), while a wrong non-commit click costs one or
two steps of a 6 to 12 step budget and is already policed by the dead-action spend, revisit
continue and `no_progress`. The premise is that every offered click is reversible, which holds
because step 8 removes commit-like controls upstream of the offer — and holds only as strongly
as that filter's pattern set (`COMMIT_TEXT`, `BARE_RIGHT_ARROW`, `SUBMIT_INPUT`), which is a
heuristic, not a proof. That is why removing the filter outright rather than **tagging** it
(the design in #18: a commit-like pick returns as an authorization exit, never a click) would
revisit this decision. Not built here: the arm is folded into #21 as a second run of its fixed
goal set, control against arm, because #21 is already the instrument (per-goal `done`, ledger,
tokens, run directories) and #30's own runs are its before reading for the gate half. If the
arm wins, this gate stops being the navigation checkpoint and stays what it measurably is, the
trigger for the one retry before the posterior takes over.

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

In a `needs_input`, `field` is the page field's label folded to a slug — `VAT number`
becomes `vat_number` — and that slug is the key the caller answers under in
`supplied_values`. `wants` is assembled in code from the same label, because Jev cannot
generate text: the label is page content code copied, exactly like a finding's evidence
span (#7). One field is named per round; a form with several unknown values converges
over rounds.

The `reason` is the vocabulary Claude Code branches on, and it is closed:

| Reason | Means |
|---|---|
| `credentials_required` | Login, captcha, or 2FA. The task space was handed off; tell the user what to do. |
| `layout_unfamiliar` | A canvas or virtualized editor. Drive ego-browser directly. |
| `only_commit_remains` | Every candidate was commit-like. Take over, or ask the user. |
| `cannot_choose`, `low_confidence` | No candidate advances the goal, or the pick stayed shaky after the retry. |
| `stale_page`, `no_progress`, `repeat_page`, `ping_pong` | The page kept moving under us, or the loop stopped converging. Nothing was collected. |
| `start_url_mismatch` (#11) | The loop could not verify it is on `start_url` — a leftover tab from an earlier run is the measured cause. Read `detail`; re-run. |
| `step_budget` | The budget ran out first. |
| `invalid_response` | An answer failed validation, so nothing executed. |
| `no_values` (#7) | `supplied_values` in job.json is present but not an object of strings — a caller bug, not a page problem. An *empty or missing* `supplied_values` is not this: the loop asks for the fields by name. |
| `error`, `skill_root_not_found` | Our fault, not the page's: read `detail`. |

Every escalate carries `step` and `page_fingerprint`, and the loop adds `goal`, `model`,
`task_space_id`, and `trail` (the last ten steps with their decisions, latency, and token
usage) so a round can be read back without a trace file.

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

`tentative: true` rides on the finding the model chose between the absent and present
thresholds (#15): a span its own `has_answer` did not back, kept rather than discarded.
Above the present threshold the field is absent.

**The digest is what Jev sees.** A bounded projection of the ledger into `state`: aspect,
value, and step, capped at roughly the last 20 entries. Jev needs it, or `goal_met` fires
early on a multi-item goal and it re-opens results already collected. It does not need the
rest, for the same reason it gets 120 candidates and not 400.

**The trace is for us.** One line per step: decision, probabilities, `page_changed`, url,
token usage, and latency. Never sent to Jev. M1 needs exactly these numbers and nothing else.

`visited_fingerprints` stays control-only and never enters `state`.

The loop writes all three (#9). The exit object names the run directory, the
ledger, and the trace; the caller copies `run_dir` into `job.json`, which is how
round N+1 appends to the same ledger instead of starting a new one. Extraction
fires when `goal_met` crosses its threshold or `worth_reading` clears 0.5 —
once per page fingerprint that yielded a finding (#16: the fingerprint is
latched on the append, not on the ask, so a page that collected nothing is
asked about again), carried across rounds in `harvested_fingerprints`,
which the caller records exactly like `visited_fingerprints`. Spans come from
the **visible** tree only: a span cut from the full tree would be off-screen
text Jev was never shown.

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

Both rounds read the same `job.json`, which Claude Code rewrites between them. It lives under
`~/.claude/jev-browser/`, not in a scratch directory the OS reaps, and its path is absolute
because the heredoc's working directory is not the caller's:

```json
{
  "task_space_id": 3,
  "goal": "fill the company registration form from the user's details",
  "start_url": "https://example.com/register",
  "run_dir": "~/.claude/jev-browser/runs/2026-09-21T14-03-29-812Z-fill-the-company-registration-form",
  "supplied_values": { "vat_number": "IE1234567X", "search_query": "" },
  "step_budget": 20,
  "settled_refs": ["@20", "vat_number"],
  "visited_fingerprints": ["a1b2c3:vat_number"],
  "harvested_fingerprints": [],
  "escalated_fingerprints": []
}
```

```js
const job = JSON.parse(readFileSync(`${process.env.HOME}/.claude/jev-browser/job.json`, 'utf8'))
const task = await useOrCreateTaskSpace(job.task_space_id)
```

**The needs_input round trip (#7).** A field the loop cannot value — its companion Noul
read low, the choice answered `none`, the pick was shaky, or `supplied_values` is empty —
exits `needs_input` naming one field: `field` (the slug), `wants` (what to supply), and
`page_fingerprint`. The caller answers by adding `"field": "value"` to `supplied_values`,
appending `<page_fingerprint>:<field>` to `visited_fingerprints`, and re-invoking with the
same `task_space_id`; ego-browser resumes the space, so the page and everything already
typed into it survive. An empty string as the value settles the field as intentionally
empty — how an optional field the goal does not need leaves the loop instead of deadlocking
it. On the resumed round the answer is a **direct fill**: a supplied value keyed to the
field's own slug is Claude Code's judgment, not Jev's, so code fills it without an ask —
the companion Noul that caused the ask is not consulted on its own answer, which is what
makes round 2 converge instead of re-asking. One field per round; `settled_refs` carries
the refs the loop filled plus the slugs settled empty, so a resumed run neither refills nor
re-asks.

`visited_fingerprints` is carried across rounds so the ping-pong guard still works after a
resume, and `escalated_fingerprints` is what the ping-pong guard reads for escalations. A
round reports the fingerprint it stopped on in its exit object; the caller records it when
it rewrites `job.json`, because the loop never writes the job file it was handed. The same
contract carries the run artifacts (#9): every exit names `run_dir`, `ledger`, and `trace`,
and the caller copies `run_dir` — and `harvested_fingerprints`, so a resumed round does not
re-collect a harvested page — back into `job.json`. Nothing is passed through the shell —
the goal and the answer travel only inside `job.json` and JSON bodies — so a goal string
containing quotes, backticks, or newlines cannot break the invocation.

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

The form loop (#7) runs the same guard across its own round boundary, with one refinement:
a `needs_input` ask is recorded as `<page_fingerprint>:<field>`, not as a bare fingerprint.
A bare fingerprint cannot tell "the caller's answer did not unblock this field" — a
ping-pong, and the resumed round escalates `ping_pong` instead of asking forever — from
"this page has a second unknown field" — the next legitimate question, which still asks.
Escalations record the bare fingerprint in `escalated_fingerprints`; a repeat escalation
exits `ping_pong` with the original trigger named in `detail`. Both lists live in
`job.json`, written only by the caller: a caller that has genuinely changed the situation
clears the entry it addressed, because the file is its side of the contract.

## Open questions to verify before M2

1. ~~File access in the heredoc runtime.~~ **Resolved.** `await import('node:fs')` works, and
   `readFileSync` reads `.env` by absolute path with the key line present. `process.cwd()` is
   `/`, so absolute paths are mandatory. See Configuration.
2. What does the goal string from Claude Code look like in practice, and how structured should
   it be? A free sentence versus `{task, target, fields}` changes the questions.
3. ~~Real page fingerprint cost.~~ **Resolved.** Hashing the pruned candidate list is cheap and
   stable, but only if the hash is *ref-free*: `@N` refs are CDP backend node ids, so a
   re-render can renumber them and the guard would never fire. It also has to be
   *scroll-stable* once the loop scrolls on purpose, so the URL is hashed without its fragment
   and the pairs in sorted order — a pure scroll at a fixed URL cannot move the hash. (An
   in-page anchor jump still can, through the offer set: the self-anchor the prune drops
   differs by position, and a different offer is a new decision context.) The fingerprint is
   `sha256(fragment-free url + sorted label|count pairs)`, and `scripts/prune.js` checks that a
   re-render with every ref renumbered, an anchor jump, and a reordering all hash identically.
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
