# learnings/linkedin

Measured 2026-09-22, guest (logged-out) LinkedIn job search. Two sessions, one before
#27 and one after it. Session 1: `~/.claude/jev-browser/runs/2026-09-22T06-16-40-809Z-...`
(one run dir, four rounds appended), install copy for rounds 1-3, repo copy for round 4.
Session 2: nine rounds, one run dir each, `~/.claude/jev-browser/runs/2026-09-22T07-3*`,
install copy for the baseline and repo copy for the rest.

Guest search renders differently from load to load: 23, 28, 39, 51, 65, 66 and 68
candidates have all been observed on the first observation of the same URL, and the
list settles upward as cards hydrate. A round that observes at 23 candidates and acts
three steps later is comparing fingerprints across a page that was still assembling.

## Site shape

- `https://www.linkedin.com/jobs/search?keywords=AI` renders fully logged out:
  36,169 chars of accessible tree, **66 candidates** after pruning. No auth wall in
  the tree and `needs_credential` read 0.18 (bar 0.7), so the loop never hands off.
  LinkedIn's guest jobs search is a normal page for this loop.
- **LinkedIn rewrites the URL on load**: trailing slash plus `currentJobId=<id>`, and
  it pre-renders that job's detail panel beside the result list. The search page is
  also a detail page for the auto-selected job.
- The location field arrives pre-filled (`Australia`) from the guest session; the
  query string alone does not control location.

## Rule 1: pin `start_url` to the URL LinkedIn normalizes to

`matchesStartUrl` compares exactly (hash and trailing slashes stripped). The added
`currentJobId` trips `start_url_mismatch` on the first observation, and the one
deliberate re-aim lands on the same rewritten URL, so the round dies before step 1.

Measured: `the start tab is at "https://www.linkedin.com/jobs/search/?currentJobId=4463321659&keywords=AI",
not https://www.linkedin.com/jobs/search?keywords=AI`.

Rule: set `start_url` to the normalized URL including `currentJobId`. The id was
stable across four rounds for this query, so pinning works, but it is a workaround
with a ceiling: the real fix is in code (compare origin+path and accept the observed
query as a superset of the start query).

## Rule 2: the auto-selected job card is a no-op click (narrowed by #27)

The card for `currentJobId` is already open in the detail panel, so clicking it does
not navigate. Measured twice: three consecutive `click @40`
("Forward Deployed Designer" -> `/jobs/view/4463321659/`) with url unchanged,
fingerprint unchanged, `sy` 0 -> `no_progress` at step 4 (install) and step 5 (repo).

Not a guard artifact: the repo copy's `actedBaseline` fix does not save it, because
the click genuinely did nothing. The old rule was "do not aim a LinkedIn round at the
job card that is already selected". #27 replaces that stopgap in code: a click that
changed nothing spends its own target before the next decision, so the dead card is
not offered again and Jev must name something else.

Measured 2026-09-22, two rounds on the same page minutes apart:

- Pre-#27 (install copy), `.../runs/2026-09-22T07-34-53-058Z-...`: steps 3, 4, 5 all
  `click @40` at `/jobs/view/4466655275`, fingerprint `7ddc4db8` unchanged, 64
  candidates offered every step, exit `no_progress` at step 6. The bug, live.
- With #27 (repo copy), `.../runs/2026-09-22T07-35-46-119Z-...`: step 3 `click @40`,
  then step 4 offers **67** where the page holds 68 and `@40` is absent from the
  probabilities Jev answers over, same fingerprint. Jev names `@69` (confidence 0.79)
  instead of repeating. A second, different pick on a page that did not move.

Two ceilings survive, both about the card's identity rather than the spend:

- **The same card keeps a second seat under a different query string.** A LinkedIn card
  url carries per-render tracking (`?eBP=...` at one ref, `?alternateChannel=search` at
  another), and the spend key is the url exactly, as #11 keys a revisit path. So the
  dead job returns under the other query. Measured in
  `.../runs/2026-09-22T07-33-11-310Z-...`: steps 4, 5, 6 clicked job `4465752349`
  three times, twice as `@40` and once as `@69`, exit `step_budget`.
- **A page that re-renders while it loads resets the no-progress count**, so nothing is
  spent at all. Measured in `.../runs/2026-09-22T07-35-26-070Z-...`: steps 4, 5, 6 all
  `click @40` at job `4457017807`, each step a different fingerprint (66, 67, 65
  candidates), exit `step_budget`. This is #27's Part 2: `page_changed` is not
  `progress`.

Rule: opening the card that is already selected still wastes a step or three on this
site. It is no longer a hard stop, but a goal that asks for the selected job's details
is better served by extraction (the panel's text is already on the page) than by a
click.

## Rule 3: `task_space_id` must be the name string

SKILL.md says it may be null on the first round. Measured, null exits `error` with
`newTaskSpace: ego.createTaskSpace(name, profileId?) expects a string task name`.
Pass a name string. Note the exit then reports `task_space_id` as a number (4) while
job.json's field takes the name string.

## Rule 4: the extraction band copies one span, so one field per round

The goal `record the job title, company, and location of the job whose details are
shown on this page` landed `done` (`goal_met` 0.81) with value
`Forward Deployed Designer` and confidence 0.36: the title only. A multi-field goal
converges one field per round. A goal the page cannot answer reads ~0.59
`has_answer` and appends nothing (`has_answer_low`, bar 0.7).

## Round log

| Round | goal | exit | steps | what it measured |
|---|---|---|---|---|
| 1 | harvest every listing | `error` | 0 | `task_space_id: null` rejected (Rule 3) |
| 2 | harvest every listing | `start_url_mismatch` | 0 | the query rewrite (Rule 1) |
| 3 | open the first listing | `no_progress` | 4 | install; the no-op card (Rule 2) |
| 4 | open the first listing | `no_progress` | 5 | repo copy; same, not a guard artifact |
| 5 | record title/company/location | **`done`** | 2 | finding appended: `Forward Deployed Designer` (Rule 4) |

Session 2, all with the goal `open the first job listing in this LinkedIn search
results list so its details are shown` and `step_budget: 6`:

| Round | run dir (`2026-09-22T...`) | exit | steps | what it measured |
|---|---|---|---|---|
| 6 | `07-34-53-058Z` install | `no_progress` | 6 | **the bug, live**: steps 3, 4, 5 identical `click @40`, job `4466655275`, fingerprint `7ddc4db8`, 64 offered each time |
| 7 | `07-35-46-119Z` repo, #27 | `low_confidence` | 6 | **the fix**: step 3 `click @40`, step 4 offers 67 of 68 with `@40` absent, Jev names `@69` at 0.79 |
| 8 | `07-33-11-310Z` repo, #27 | `step_budget` | 7 | the tracking-query twin: job `4465752349` clicked three times, `@40`, `@69`, `@40` |
| 9 | `07-35-26-070Z` repo, #27 | `step_budget` | 7 | a re-rendering page: `@40` three times, fingerprint moving every step, count never accumulates (Part 2) |

The rest of session 2 exited early on `low_confidence` or `invalid_response`: with 66
to 73 candidates Jev's `next_target` distribution is thin, and its argmax does not
always clear `NEXT_TARGET_CONFIDENCE` 0.5. Four of the nine rounds never reached a
second step of value. That is a ranking-cost problem, not a guard one.

Cost: session 1 107,366 input tokens and 12,428 output across five rounds; session 2
326,070 input and 31,670 output across nine. `jev-1.13.0` every step.

## Rule 5: number the rows and mark the open one (#30)

The 65-row offer is not ranked badly, it is ranked *thinly*: job titles on this page are
near-identical, so a correct pick still lands at 0.44 to 0.65 mass. Numbering every row
(`1. `, `2. `, ...) and suffixing the row that is already open (`(current)`,
`(selected)`, `(expanded)`) is what #30 built, and the two halves do not pull their
weight equally.

- **The position half is cosmetic here.** A positional goal ("the first listing") is
  a bad goal on this page: the first listing is row 23 of 65, behind 21 chrome rows,
  and no pick in 19 flat steps ever fell in the first 10. Numbering did not move the
  pick on the plain goal. What did move the reading was making the goal name a string
  the page actually contains: the same 65-row offer scored **0.95** on the first ask
  for `open the job listing titled 'Computational Biologist - AI Trainer'`, against
  0.44 to 0.65 for the positional one.
- **The state half earns its keep.** With the selected card marked `(current)`, the
  already-open job fell from argmax (0.47, 0.51, 0.51 flat) to a non-contender (0.19,
  0.18, 0.11), which is the step #27's spend used to recover after the fact. It is
  proactive where #27 is corrective, and the two are complementary, not redundant: the
  tracking twin (`?eBP=` vs `?alternateChannel=search`, Rule 2's last bullet) is a
  different href, so the state mark cannot see it and the spend still catches it.
- **Side effect worth watching.** With rows named, the chrome control `Try AI job
  search` (row 21 of 65) rose from ~0.10 to 0.27-0.40 in seven numbered rounds against
  ≤ 0.14 in eleven flat ones. Nothing picked it, but a row that names the goal's own
  words is a candidate, and the `(current)` suffix does not help there.
- **The state mark lands on a wrapper, not the card.** `aria-selected` sits on an
  ancestor up to two levels above the anchor, which is why `stateMarks` walks
  ancestors rather than reading the node. A future row that reads its own attributes
  only would find nothing on this site.

Session 3, 23 rounds on the same URL, all with `step_budget: 6` and `jev-1.13.0`:

| Arm | runs | goal | median `next_target` | < 0.5 | outcome |
|---|---|---|---|---|---|
| flat offer | 11 | open the first listing | 0.44-0.60 | 21/49 | picks land right, gate fires |
| numbered + state | 7 | open the first listing | 0.44-0.52 | 12/17 | same content, 5 rounds exit `low_confidence` at step 2-3 |
| numbered, no state | 2 | open the first listing | 0.38 | 4/4 | no click reached |
| numbered + state | 3 | open the titled listing | 0.53 | 5/10 | **0.95** on the first ask, lands it |

Cost: 585,007 input and 55,304 output tokens across the 23 rounds (82 steps). The
numbered suffixes add under 5% of request size; they cost no extra request and no
extra browser work beyond one in-page `js()` per observation.
