// Candidate pruning (issue #2, spec.md "Candidate pruning").
//
// Runs in code before every Jev call. It is both the main accuracy lever and the
// safety control: step 7 removes commit-like controls before Jev ever sees the
// list, so submitting is unreachable rather than discouraged.
//
// Pure text in, JSON out. No browser, no network, which is what makes the trust
// boundary checkable from a fixture:
//
//   node scripts/prune.js
//
// Input is the snapshotText() accessibility tree, verbatim:
//
//   form
//     text "VAT number"
//     textbox [ref=20, loc=css:input[name="vat"]]
//     button [ref=21, loc=css:input[type="submit"]]
//       text "Submit"
//
// Indentation is two spaces per level. A node carries its accessible name either
// inline (`button "x" [ref=26, ...]`) or as a child `text "..."` line.
//
// The heredoc runtime cannot import this file (nothing from the caller reaches
// it), so the loop script inlines it: `cat scripts/prune.js scripts/explore.js`.

const INTERACTIVE_ROLES = new Set([
  'anchor', 'button', 'checkbox', 'combobox', 'input', 'link', 'listbox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio',
  'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem',
])

// Step 2's exception: a bare input is still a target when the text line just
// above it names it (that is how the VAT field above keeps its label).
const LABEL_FROM_SIBLING_ROLES = new Set([
  'checkbox', 'combobox', 'input', 'listbox', 'radio', 'searchbox', 'slider',
  'spinbutton', 'switch', 'textbox',
])

const MAX_LABEL_CHARS = 120
const MAX_CANDIDATES = 120

// Step 7's denylist. A denylist misses things (icon buttons, friendly
// aria-labels); that is why the policy degrades safely instead of trusting it.
const COMMIT_WORDS = [
  'submit', 'send', 'post', 'publish', 'pay', 'buy', 'checkout', 'confirm',
  'delete', 'remove', 'cancel order', 'unsubscribe',
]
const COMMIT_TEXT = new RegExp(`\\b(?:${COMMIT_WORDS.join('|')})\\b`, 'i')
const BARE_RIGHT_ARROW = /^(?:->|→|›|»|➔|➜|▶|▸)$/
const SUBMIT_INPUT = /type\s*=\s*["']?submit/i

export function parseSnapshot(snapshotText) {
  const lines = []
  for (const raw of snapshotText.split('\n')) {
    if (!raw.trim()) continue
    const depth = (raw.length - raw.trimStart().length) / 2
    const body = raw.trim()

    const isText = body.match(/^text "(.*)"$/)
    if (isText) {
      lines.push({ depth, kind: 'text', value: isText[1] })
      continue
    }
    const isNode = body.match(/^([a-z][a-z-]*)(?: "(.*)")?(?:\s*\[(.*)\])?$/)
    if (!isNode) continue
    const attributes = isNode[3] || ''
    lines.push({
      depth,
      kind: 'node',
      role: isNode[1],
      name: isNode[2] ?? null,
      ref: (attributes.match(/\bref=(\d+)/) || [])[1] ?? null,
      loc: (attributes.match(/\bloc=([^,\]]+)/) || [])[1] ?? null,
      url: (attributes.match(/\burl=(\S+)/) || [])[1] ?? null,
    })
  }
  return lines
}

// Steps 2 through 7, in spec order.
//
// offscreenRefs is the one thing the text tree cannot answer: snapshotText()
// defaults to full_page and marks nothing for being below the fold. The loop
// supplies the refs it measured outside the viewport, the fixture supplies them
// by hand. Empty is a valid answer, not a silent failure.
export function pruneCandidates(snapshotText, { offscreenRefs = [] } = {}) {
  const lines = parseSnapshot(snapshotText)
  const offscreen = new Set(offscreenRefs.map(String))
  const kept = []

  // 1. interactive nodes only, 2. drop unlabelled, 3. drop off-viewport.
  for (let index = 0; index < lines.length; index += 1) {
    const node = lines[index]
    if (node.kind !== 'node' || !node.ref) continue
    if (!INTERACTIVE_ROLES.has(node.role)) continue
    if (offscreen.has(node.ref)) continue

    const texts = [node.name].filter(Boolean)
    const child = lines[index + 1]
    if (child && child.depth > node.depth && child.kind === 'text') texts.push(child.value)
    // Only an input may borrow its label from the sibling text line above it.
    // ponytail: same-depth text only, no label-position heuristics; widen if a
    // real site puts labels elsewhere.
    if (texts.length === 0 && LABEL_FROM_SIBLING_ROLES.has(node.role)) {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        if (lines[previous].depth < node.depth) break
        if (lines[previous].depth > node.depth) continue
        if (lines[previous].kind === 'text') texts.push(lines[previous].value)
        break
      }
    }

    const label = texts.find((value) => value.trim())
    if (!label) continue
    kept.push({ ref: `@${node.ref}`, label, texts: texts.join(' '), loc: node.loc || '' })
  }

  // 4. dedupe repeated labels, keeping the first and its count.
  const unique = new Map()
  for (const candidate of kept) {
    const seen = unique.get(candidate.label)
    if (seen) seen.count += 1
    else unique.set(candidate.label, { ...candidate, count: 1 })
  }

  // 5. truncate, 6. cap, 7. remove commit-like controls. Only ref, label and
  // count go to Jev; loc and the raw texts were for matching, not for sending.
  return [...unique.values()]
    .slice(0, MAX_CANDIDATES)
    .filter((candidate) => !isCommitLike(candidate))
    .map((candidate) => ({ ref: candidate.ref, label: truncate(candidate.label), count: candidate.count }))
}

function truncate(label) {
  return label.length <= MAX_LABEL_CHARS
    ? label
    : `${label.slice(0, MAX_LABEL_CHARS - 1)}…`
}

function isCommitLike(candidate) {
  const text = `${candidate.label} ${candidate.texts ?? ''}`
  return COMMIT_TEXT.test(text)
    || BARE_RIGHT_ARROW.test(candidate.label.trim())
    || SUBMIT_INPUT.test(candidate.loc ?? '')
}

// A hash of the pruned candidate list plus the URL, for the ping-pong guard
// (spec.md open question 3). Deliberately ref-free: refs are backend node ids
// that a harmless re-render can renumber, and a fingerprint that moves would
// mean the guard never fires.
export async function pageFingerprint(url, candidates) {
  const crypto = await import('node:crypto')
  const body = candidates.map((candidate) => `${candidate.label}|${candidate.count}`).join('\n')
  return crypto.createHash('sha256').update(`${url}\n${body}`).digest('hex').slice(0, 8)
}

const CHECK_URL = 'https://shop.example.com/'
const FIXTURE_OFFSCREEN = [30] // "Far away button", below the fold.

async function selfCheck() {
  const assert = (await import('node:assert/strict')).default
  const fs = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const snapshot = fs.readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/snapshot.txt'),
    'utf8',
  )
  const candidates = pruneCandidates(snapshot, { offscreenRefs: FIXTURE_OFFSCREEN })
  const labels = candidates.map((candidate) => candidate.label)

  // Trust boundary: the submit button (an input[type=submit] wearing its text),
  // the "Send" link, the "Buy now" button, the unsubscribe link.
  for (const gone of ['Submit', 'Buy now', 'Send', 'Unsubscribe from all emails']) {
    assert.ok(!labels.some((label) => label.includes(gone)), `${gone} reached Jev`)
  }
  assert.ok(!candidates.some((candidate) => SUBMIT_INPUT.test(candidate.loc)))

  // Off-viewport and label-less nodes.
  assert.ok(!labels.includes('Far away button'), 'off-viewport node survived')
  assert.ok(!candidates.some((candidate) => candidate.ref === '@26'), 'label-less button survived')
  assert.ok(!candidates.some((candidate) => candidate.ref === '@31'), 'label-less textbox survived')
  assert.ok(candidates.every((candidate) => candidate.label.trim()), 'an empty label survived')

  // A bare input keeps the label of the text line above it.
  assert.equal(candidates[0].label, 'VAT number')

  // Duplicates collapse onto the first, with a count.
  assert.deepEqual(
    candidates.find((candidate) => candidate.label === 'Read more'),
    { ref: '@27', label: 'Read more', count: 2 },
  )

  // Truncation, and the cap.
  const long = candidates.find((candidate) => candidate.label.endsWith('…'))
  assert.ok(long && long.label.length === MAX_LABEL_CHARS, 'long label not truncated to 120')
  assert.equal(candidates.length, 116, 'cap: 148 entries -> 120 -> 4 commit controls removed')
  assert.ok(labels.includes('Result 112') && !labels.includes('Result 113'), 'cap kept the wrong entries')
  assert.ok(candidates.length <= MAX_CANDIDATES)

  // Fingerprint stability: the same page re-rendered with every ref renumbered
  // is the same page.
  const renumbered = snapshot.replace(/ref=(\d+)/g, (_, ref) => `ref=${Number(ref) + 1000}`)
  assert.equal(
    await pageFingerprint(CHECK_URL, candidates),
    await pageFingerprint(CHECK_URL, pruneCandidates(renumbered, { offscreenRefs: [1030] })),
  )
  assert.notEqual(
    await pageFingerprint(CHECK_URL, candidates),
    await pageFingerprint('https://shop.example.com/other', candidates),
  )

  return candidates.length
}

if (process.argv[1] && process.argv[1].endsWith('prune.js')) {
  const count = await selfCheck()
  console.log(`prune.js self-check ok (${count} candidates survive)`)
}
