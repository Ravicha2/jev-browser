# Close the three defects that keep the ledger empty

**Type:** task
**Status:** open
**Blocked by:** none

## Question

Three defects stand between a round that acted correctly and a round that produced a finding. Fix all three. Each is small, and each is independently verifiable.

## a. The extraction band discards the model's answer

`explore.js:399` returns `has_answer_low` before `validateChoice` runs at `explore.js:403`, so the model's span Choice is thrown away across the whole 0.35 to 0.70 band. `HAS_ANSWER_ABSENT` (`explore.js:76`, value 0.35) and `verdict.absent` are therefore unreachable, and the self-check at `explore.js:1448-1450` asserts only `reason === 'has_answer_low'`, never `.absent`, so the dead code is invisible to the suite.

Evidence: the probe read `has_answer` 0.68 with `appended: false` and an empty ledger. The HN round read 0.6, 0.64, and 0.37, all below the bar, and appended nothing.

Fix: validate the Choice first, append with `tentative: true` in the band, make `.absent` reachable from the `HAS_ANSWER_ABSENT` threshold, and add the two asserts the self-check is missing.

## b. The harvest latch fires before the outcome is known

`explore.js:907-909` adds the fingerprint to `harvested` before the extraction outcome is known, so a run that appends nothing still marks the page harvested, and the page is never asked about again.

Evidence: HN round 3, run `2026-09-21T12-01-19-158Z`. Steps 2 through 6 carry no extraction line at all, because the fingerprint was already in `harvested` from a step that appended nothing.

Fix: latch only on `appended`.

## c. The progress baseline is taken from the pre-reveal observation

`explore.js:1040-1045` calls `reveal(target)` before every click, and that scrolls the page. `explore.js:1074-1075` then captures `progress.lastFingerprint` and `progress.lastSy` from the pre-reveal observation (`fresh`), so the baseline is already stale when the next step compares against it.

This is the mechanism behind the HN click loop: eight clicks on the same `root` anchor, at steps 4, 5, 8, 9, 11, and 12 of run `2026-09-21T11-59-15-863Z`, with the no-progress pattern reset each time, ending in `step_budget`.

Fix: take the baseline after `reveal()`.

## Answer

<!-- append on resolution -->
