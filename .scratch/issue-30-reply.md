Both decisions from the 12:08 design pass are recorded, with one premise checked in code.

**Gate decision, recorded and widened** (`spec.md`, threshold table row + the block under it;
`references/thresholds.md`, "The next arm this points at: click-and-observe below the bar").
Margin re-expression stays rejected for the reason stated: a margin would not have saved a
correct pick at 0.5. The click-and-observe arm is recorded as pending, not built.

- **The reversibility premise holds, and only as far as its filter.** Checked:
  `scripts/prune.js:184` is `capped.filter((candidate) => !isCommitLike(candidate))`, upstream of
  the offer, so every offered candidate is non-commit by construction. `isCommitLike`
  (`prune.js:204`) is a pattern match on `COMMIT_TEXT`, `BARE_RIGHT_ARROW` and `SUBMIT_INPUT`,
  which is a heuristic rather than a proof, and that is recorded as the boundary of the premise.
  Tagging instead of removing (#18) keeps it true; removing the filter outright does not.
- **One control the arm needs, off these runs.** The retry is not dead weight: in
  `.../runs/2026-09-22T11-51-12-551Z-...` step 4 retried at 0.45 and the re-ask came back at 0.50,
  which cleared the bar and clicked. So the arm has to beat retry-then-click, not just beat retry.
- **Also recorded for honesty:** the `NEXT_TARGET_CONFIDENCE` table row in
  `references/thresholds.md` said "Leave it" off M1, where almost every firing was on a list
  missing its destination. The #30 flat rounds are the other regime, destination present and
  pick correct, and the row now says so rather than reading as settled.

**Commit filter decision, recorded** (`spec.md`, same block). It is #18's to change, and the
interaction is now stated where the gate decision lives: commits staying unauthorized is what
keeps the premise true.

Committed on `30-offer-shape` as `62256ba`.

Nothing here is built. The arm wants its own issue, since it is a live measurement on the same
page and the m1 goals rather than an offer-shape change: say the word and I will file it.
