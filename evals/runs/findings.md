# Findings from the #31 runs

Defects and blockers surfaced by running the plan, with the evidence that establishes each. None is
fixed here; this file is what the runs produced that the plan did not predict. Evidence lives in
`round-record.jsonl` and in the run directories under `~/.claude/jev-browser/runs/`.

## F1. LinkedIn's search URL rewrite blocks a fixed `start_url` (blocks the LinkedIn pole)

**Severity:** blocks a goal of the fixed set.

`matchesStartUrl` (`scripts/explore.js:271`) is exact-match after stripping only the fragment and a
trailing slash. LinkedIn rewrites the search URL on every navigation in a logged-in profile,
injecting a `currentJobId` that differs each time:

| navigation | landed url |
|---|---|
| `/jobs/search?keywords=AI` | `/jobs/search/?currentJobId=4468532332&keywords=AI` |
| `/jobs/search/?keywords=AI` | `/jobs/search/?currentJobId=4469852464&keywords=AI` |
| `/jobs/search?keywords=AI&f_TPR=r604800` | `/jobs/search/?currentJobId=4469852464&f_TPR=r604800&keywords=AI` |

So no fixed `start_url` can hold for this goal. Six rounds (trials 1 to 3, both arms) refused at
step 0 with `start_url_mismatch`, zero requests, and measure nothing about the terminal judgment;
they are recorded as invalid for C2, C3 and T9 rather than as arm failures.

Workaround, verified: pin `start_url` to the tab's current URL before each round (the SKILL.md
remedy for `start_url_mismatch`, "close or re-aim, re-run"). The seventh attempt cleared the guard
and ran. This makes `start_url` a per-round measured variable, constant in method across arms but
not in value.

Related: `learnings/linkedin` Rule 1 records the same rewrite as a candidate-thinness problem. In a
logged-in profile it is a hard blocker instead.

## F2. A filled field's value is read as its label, breaking the fill resume chain

**Severity:** blocks fill completion and the #7 resume path (a006, a032 and every multi-round fill).

Reproduction, from a reloaded and reset form, same `job.json` twice:

| round | form state at start | exit | `settled_refs` | `unfilled` labels |
|---|---|---|---|---|
| A | clean | `needs_input`, field `preferred_delivery_time` | `["@1","customer_name","@2","telephone","@3","e_mail_address","@16","delivery_instructions"]` | `["Preferred delivery time:"]` |
| B | filled by round A | `needs_input`, field `ravi_c` | `[]` | `["Ravi C","0400 000 000","ravi@example.com","Preferred delivery time:","please leave at the front desk"]` |

Round A is correct: it fills the four text fields from `supplied_values` keyed by the label-derived
slug (`fill-form.js:174`), settles them, and asks for the one field with no supplied value. Round B
is wrong on two counts. It reports the four fields it just filled as unfilled, and the labels it
reports for them are the **values** it wrote into them, so `fieldSlug` folds `"Ravi C"` into
`ravi_c` and the exit asks for a value for the `ravi_c` field. A caller cannot key an answer to
that: the slug names no page field, and answering it writes a value into nothing.

Impact: a fill that needs more than one round cannot converge, because the second round forgets
every settlement the first round made. The exit table's `needs_input` path ("one field per round,
so a form with several unknown values converges over rounds", SKILL.md) does not hold.

Not yet localized. The label is derived in `fill-form.js` from the field's snapshot, not from the
DOM's own `<label>`, and the snapshot's text for a filled input is its value. The fix belongs with
whoever owns the field-identity layer, not with the eval.

## F3. The cost band in `references/thresholds.md` has no stated scope

**Severity:** low; a threshold row, not a blocker.

The recorded band is $0.0005 to $0.0018 per round. The pilot's loop-only cost is $0.00034 to
$0.00038 (8947 and 8045 input tokens at $42 per billion, output free), under the band's floor. Either
the band counts loop usage plus the caller's own turns, in which case E3 must say so and the caller's
tokens need a capture point, or it is loop-only and the floor is wrong. Recorded in E3 as the open
question.
