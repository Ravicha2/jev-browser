# Make the commit guardrail an authorization step

**Type:** task
**Status:** open
**Blocked by:** none

## Question

Today the guardrail removes commit-like controls before the model sees them, so submitting is unreachable. Replace removal with authorization: commit-like controls stay visible, the model may pick one, and a commit-like pick comes back to the caller for authorization instead of being clicked.

## What is there now

- `prune.js:56` the vocabulary: `submit | send | post | publish | pay | buy | checkout | confirm | delete | remove | cancel order | unsubscribe`.
- `prune.js:204` `isCommitLike(candidate)`: the label regex, plus `input[type=submit]` in the locator.
- `prune.js:184` `const allowed = capped.filter((candidate) => !isCommitLike(candidate))`, which is the removal.
- `prune.js:193` `commitCount: capped.length - allowed.length`.
- `explore.js:494-505` `pruneDetail(...)`, and `commitOnly: candidates.length === 0 && commitCount > 0`.
- `explore.js:133` the preflight exit: `commitOnly ? 'only_commit_remains' : 'cannot_choose'`.
- `explore.js:258-259` a noul question, `only_commit_remains` above 0.5, which also escalates.
- `fill-form.js:27-29` it never clicks at all, so its behavior is unaffected; only its self-checks name the filter.

## What to do

1. **Tag instead of remove.** Keep the candidate, mark it commit-like.
2. **Do not execute a commit-like pick.** `explore.js` returns the pick (label, ref, confidence) as an authorization exit.
3. **The caller authorizes** by supplying the pick on the next round, reusing the `needs_input` round trip: the field slug names the pick, and the `<page_fingerprint>:<field>` entry in `visited_fingerprints` guards the repeat.
4. **Rewrite the self-checks that assert the old property**, since they currently assert the wrong thing: `explore.js:1308` ("no commit-like label can reach the questions"), `explore.js:1267`, `explore.js:1100-1101`, `prune.js:248-254`, `prune.js:313`, `fill-form.js:892-907`.

## Decide inside this ticket

What happens to `only_commit_remains`. With controls tagged rather than removed, `candidates.length === 0` stops being its trigger. My view: the escalate-on-pick replaces it, so the exit either goes or narrows to a real "nothing to click but a commit" page.

## Known limit, record it and do not try to fix it here

The denylist reads labels only. Measured against real labels: `Subscribe`, `Add to cart`, `Like this video`, `Save`, `Next`, `Continue`, and `Sign in` all pass it. An unlabelled commit control stays clickable with no authorization. Accepted risk: the safety claim rests on the caller's authorization step, not on the filter.

## Answer

<!-- append on resolution -->
