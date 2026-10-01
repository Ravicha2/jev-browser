The guardrail is an authorization step now: commit-like controls stay in the offer, marked; naming one
clicks nothing and comes back to the caller with the pick; the caller's answer on the next round is the
only thing that clicks it. Branch `18-commit-guardrail-authorization` off `30-offer-shape`, commits
`b84cc87` (prune + fill-form), `1059edd` (explore), `517d6b3` (the record).

## Acceptance criteria

- [x] **Commit-like controls appear in the candidate list, marked.** Step 8 tags instead of filtering:
  `prune.js:195` sets `commitLike` on each capped candidate, `pruneDetail` reports `commitCount`
  (`prune.js:205`), and the offer row carries the mark next to its number and state — `3. Buy now
  (commit)`, `4. Next (current, commit)` (`explore.js:147-156`). The cap counts them in: 150 entries →
  120 candidates, commit-like included (`prune.js:325`).
- [x] **A commit-like pick performs no action.** `readDecision` returns `{kind: 'authorize', index, ref,
  label, confidence}` (`explore.js:437-445`); no click path reads `authorize`, so the answer reaches
  nothing that acts. Checked: `explore.js:1914-1919` asserts the decision is `authorize` and
  `assert.notEqual(namingIt.kind, 'click')`.
- [x] **The exit carries the pick's label, ref and confidence.** `explore.js:1359-1372`:
  `needs_input`, `field` (the label folded to a slug), `wants`, and `pick: {ref, label, confidence}`.
- [x] **Supplying the pick on the next round direct-clicks it, and the repeat guard holds.** The
  authorization channel sits before the ask (`explore.js:1113-1186`): `authorizedPick` finds the marked
  candidate whose slug the caller supplied, the click goes through the same two guarantees as every
  other click (resolved by label off a snapshot taken immediately before acting, `stale_page` when the
  control is gone), and it clicks that control and nothing else. The repeat guard is #7's own: the exit
  records `<page_fingerprint>:<slug>` (`explore.js:1339-1358`), so a second ask for the same control on
  the same page escalates `ping_pong`. The composite key shares `visited_fingerprints` with bare
  fingerprints and never collides with one (`explore.js:1593-1600`). One authorization is one click:
  the spent slug is consumed before the click (`explore.js:1129`, checked at `explore.js:1932-1936`).
- [x] **The six self-checks rewritten from "no commit-like label can reach the questions" to "no
  commit-like pick is clicked."** `explore.js:1896-1958` (the offer-row check, the authorize decision,
  `authorizedPick`'s refusals, and the round trip resolving by label off the fresh snapshot),
  `explore.js:1585-1592` (`reason` no longer stops on a commit-only offer), `explore.js:1974-1975`
  (`buildQuestions` carries the whole offered row and filters nothing out),
  `prune.js:259-267` (four tagged, seats
  kept), `prune.js:319-326` (the cap keeps them), `fill-form.js:907-917` (four tagged upstream, `@21`
  offered marked, no tagged control is a field). The structural check stays: the fill loop contains no
  click at all (`fill-form.js:910`), so its half of the guarantee is not "a tagged pick is refused",
  it is "nothing in this loop clicks".
- [x] **`only_commit_remains` removed, decision below.**
- [x] **The denylist blind spot recorded as an accepted risk, below.**

## The two decisions this issue asked to be recorded here

**1. `only_commit_remains` is gone, with the Noul and the trigger behind it.** It was read *before* the
pick, so on exactly the page the issue's new behaviour exists for, a page whose whole offer is
commit-like, it would have escalated instead of offering the pick for authorization. The tag made it
actively wrong, not merely redundant: what used to be an empty list after step 8's filter is now a
non-empty list, and the exit it produced (`cannot_choose`) is a decision the loop would be making about
a list the model can rank. Removed in code (`explore.js:1584-1592`: `preflight` returns `cannot_choose`
only on a genuinely empty list), removed from the threshold table (`references/thresholds.md`, the
`ONLY_COMMIT_NOUL` row now "—", *Removed in #18*), removed from `spec.md`'s question block, and the
commit case now has its own exit on the pick. There is no number left to tune here.

**2. The denylist's blind spot is accepted, and the safety claim is moved off the filter.** Recorded in
`spec.md` (safety rule 2), `references/thresholds.md` (the click-and-observe arm's premise) and
`SKILL.md` (Safety), with the issue's own measurement: `isCommitLike` (`prune.js:216`) reads labels
only, and measured against real labels `Subscribe`, `Add to cart`, `Like this video`, `Save`, `Next`,
`Continue` and `Sign in` all pass it. `Continue` is the button that advances a checkout from cart to
payment. An unlabelled commit control stays unmarked and, picked, *would* be clicked with no
authorization. So the claim is not "commit-like controls cannot be clicked" and was never a proof: it
is that the caller authorizes the one control it names, and that the route is enumerated in advance. Not
fixed here, as the issue says.

## One protocol gap this closed out of necessity

The authorization resume has to set `start_url` to the exit's `url`. The control lives on the page the
exit stopped on, and `openOrReuseTab(job.start_url)` plus the start-url guard would otherwise re-aim the
tab away from it. Documented in `spec.md` (the resume protocol) and `SKILL.md` (the exit table row).

## Verified

- `node scripts/explore.js` → `explore.js self-check ok (6 questions per step, guards and exits checked)`
- `node scripts/prune.js` → `prune.js self-check ok (120 candidates survive)`
- `node scripts/fill-form.js` → ok
- `quality_delta` vs HEAD: 0 regressions. `doc_drift`: no tracked doc anchor went stale.
- `grep -rn "commitOnly|only_commit_remains|ONLY_COMMIT" scripts/` → nothing left.

**Not measured:** no live round has run against a real page with a commit control. The wiring is
checkable from the fixture (the control functions are pure), and the authorized click uses the same
`resolveTarget` path the Jev-driven click already uses, but the first live round on a real checkout is
what would confirm the round trip end to end, and one is owed. The issue's own limit stands until then:
the filter is a heuristic, and the authorization step is what the safety rests on.
