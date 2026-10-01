# Platform facts

The values the loops depend on, checked against the live docs and the local
environment when they were built, and kept in step with the script constants.
When one of these contradicts `scripts/explore.js` or `scripts/fill-form.js`,
the script is wrong or the platform moved: re-verify before trusting either.

## TypeSafe / System One (Jev)

| Fact | Value |
|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` |
| Auth | `Authorization: Bearer $TYPESAFE_API_KEY`, read from `.env` at the skill root, never from the shell environment |
| Model | `jev-1.13.0`, pinned in both loops (the `jev-latest` alias resolved to it in every step of every M1 run; the pin keeps the gate readable, and the response `model` field is logged so a silent bump is visible) |
| Price | $42 per Btok input ($0.042 per Mtok). Output tokens are free. |
| Rate limits | 250,000 tokens/second, 1,200 requests/minute |
| Context | 64k per request; 32k for `state` plus the longest question |
| Input | Text only. No images, audio, or video. |
| Question types | `noul` (probability of yes), `choice` (one of a set), `score` (ordered levels) |
| Choice limit | 255 options max (the loops cap candidates at 120 long before this) |
| Score limit | 2 to 10 levels |
| Answer shape | Noul: `{noul}`. Choice: `{choice, probabilities, confidence}`. Score: `{score, legend, probabilities, confidence}`. |
| Transient statuses | 429, 503, 529 get up to three attempts with backoff (`ask()` in explore.js) |

A 2k-token step is about $0.00008; a 20-step browse is about $0.002. Cost is
not a design constraint here; build time and pick accuracy are.

## ego-browser

Installed at `~/.local/bin/ego-browser`.

| Fact | Value |
|---|---|
| Runtime | Node v24.18.0 in the heredoc, global `fetch` available |
| Invocation | `ego-browser nodejs <<'EOF' ... EOF`, helpers preloaded |
| Observation | `snapshotText()` returns an accessibility tree annotated with `[ref=N, loc=...]`; the full page is the default scope, `only_within_viewport` is the second |
| Acting | `click(target)`, `fillInput(target, text)`, `typeText`, `pressKey`, `js(...)`. The loops click and never fill blindly; there is no `select`. |
| Scrolling | `js('window.scrollTo(0, y)')` is precise and `scrollToBottomUntil()` is bulk. `scroll(n)` advances about 300px whatever `n` says, and `scrollBy` does nothing. `pageInfo().sy` matches `window.scrollY`. |
| Lifecycle | `useOrCreateTaskSpace(name)`, `handOffTaskSpace()`, `takeOverTaskSpace()`, `completeTaskSpace(name, {keep})` |
| Output | `cliLog(value)` is the only output channel and writes to stderr, not stdout. The last call is the script's return value. |
| Refs | `@N` refs are valid only for the most recent `snapshotText()` call; the loop re-reads every ref from a fresh snapshot at act time |
| State across rounds | One long-lived process, one fresh script scope per heredoc. Nothing declared carries over; the task space is the handle to what does. |
| dialogs | `pageInfo()` resolves to `{dialog: ...}` while a native dialog is open; the loop escalates rather than touching it |

## The heredoc runtime, and why packaging looks like this

Verified by running it, not assumed:

| Probe | Result |
|---|---|
| `process.cwd()` | `/`, not the caller's directory |
| `process.argv` | electron's own; nothing the caller passed |
| Environment | env vars set on the invoking command line are stripped; only `HOME` and `TMPDIR` survive |
| `import.meta.dirname` | `/`; `__filename` is undefined |
| `await import('node:fs')` | works |
| `readFileSync(absolutePath)` | works |
| Imports of project files | do not work, hence the `cat` concatenation that inlines `prune.js` and `ledger.js` ahead of the loop |

Consequences the whole layout rests on:

- The skill root is derived from `HOME`, tried in this order: `~/.claude/skills/jev-browser`,
  then `~/AgentOS/jev-browser` as the pre-packaging fallback. Proven by finding `.env`.
- `.env` holds `TYPESAFE_API_KEY` and lives at the root. It is never committed and its
  value is never echoed.
- `job.json` lives at `~/.claude/jev-browser/job.json` and run artifacts under
  `~/.claude/jev-browser/runs/`: not `TMPDIR`, which the OS reaps, and a login handoff
  must be resumable after sitting overnight.
- The goal and the resume answer travel in `job.json` and JSON bodies only, never
  through the shell, so a goal string containing quotes, backticks, or newlines cannot
  break the invocation.

## Thresholds

Every tunable number, its value, and the evidence behind it:
`references/thresholds.md`. The constants live in `scripts/explore.js` and
`scripts/fill-form.js`; `MODEL` is pinned to `jev-1.13.0` in both.
