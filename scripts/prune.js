// Candidate pruning (issue #2 as reopened, fixed in #10; spec.md "Candidate
// pruning").
//
// Runs in code before every Jev call. It is both the main accuracy lever and the
// safety control: step 8 tags commit-like controls instead of removing them
// (#18), so Jev sees the whole page and may name one, and the loop returns that
// name for the caller's authorization rather than clicking it. Removing them
// made submitting unreachable; the tag makes it authorized.
//
// M1 (#4) measured the old rule — drop off-viewport nodes — deleting the
// destination on nearly every task: a collection agent is sent to find facts
// that live below the fold of a long page (1,208 of 1,251 refs dropped on
// nodejs.org's cli.html, leaving 37 sidebar links). So the viewport is now a
// hint, never a filter: candidates come from the full page tree, and which of
// them are off-screen is reported (the loop scrolls a target into view before
// clicking it) but never removes one from the list. The 120 cap still binds
// (#11: when it does, the page's own anchors take the seats first — a monster
// page's TOC is the destination list, its sidebar is navigation), which is
// what keeps the list scroll-invariant: urls do not move with the viewport.
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

// Step 8's denylist. A denylist misses things (icon buttons, friendly
// aria-labels); that is why the policy does not rest on it — the click waits for
// the caller's authorization (#18), and the filter only decides what gets marked.
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

// Steps 1 through 8 of spec order (step 8 is the commit tag, not a filter).
//
// visibleRefs is the hint: the refs the loop measured inside the viewport. It
// changes nothing about membership — a candidate below the fold is still
// offered, because that is where a collection agent's destination lives — it
// only counts how many offered candidates a click would have to scroll into
// view first. The fixture supplies the set by hand; empty is a valid answer
// (nothing revealed yet), and so is the full set (everything on screen).
export function pruneCandidates(snapshotText, options) {
  return pruneDetail(snapshotText, options).candidates
}

// The same pipeline, plus two numbers the loop branches on. commitCount: how
// much of the offer is commit-like — the tag, not a removal (#18), so an empty
// list is simply "nothing to click" whatever the count says and the count is
// what tells a reader (and the fixture check) how many controls wait on the
// caller's authorization.
// offscreenCount: how many offered candidates sit below the fold right now.
//
// currentUrl drops self-referential anchors: a candidate whose url is exactly
// the current page's url cannot change anything by being clicked — not the
// page, not the scroll position — so offering it only invites the no-progress
// guard to clean up afterwards. Dropped before the dedupe; a same-labelled
// twin with a different target keeps its own seat under the url-aware key
// either way (#11).
export function pruneDetail(snapshotText, { visibleRefs = [], currentUrl = null } = {}) {
  const lines = parseSnapshot(snapshotText)
  const visible = new Set(visibleRefs.map(String))
  const kept = []

  // 1. interactive nodes only, 2. drop unlabelled, 3. drop self-referential
  // anchors. No viewport filter: the full tree is the offer, DOM order is the
  // order, and the cap below is the only truncation.
  for (let index = 0; index < lines.length; index += 1) {
    const node = lines[index]
    if (node.kind !== 'node' || !node.ref) continue
    if (!INTERACTIVE_ROLES.has(node.role)) continue
    if (currentUrl && node.url && node.url === currentUrl) continue

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
    kept.push({ ref: `@${node.ref}`, label, texts: texts.join(' '), loc: node.loc || '', url: node.url ?? null })
  }

  // 4. dedupe repeated labels, keeping the first and its count. A label is not
  // a destination (#11): the same text pointing at two urls is a pair of twins
  // — a docs page's cross-reference and its real section anchor share a label —
  // so the key is label AND target url, and each twin keeps its own seat and
  // count. Url-less controls (buttons, inputs) fall back to the label alone,
  // which is the old behaviour for them.
  const unique = new Map()
  for (const candidate of kept) {
    const key = `${candidate.label}\u0000${candidate.url ?? ''}`
    const seen = unique.get(key)
    if (seen) seen.count += 1
    else unique.set(key, { ...candidate, count: 1 })
  }

  // 5. truncate, 6. cap with same-page seats first, then 7. the commit tag. Only
  // ref, label, count and the tag go to Jev; loc, the raw texts and the url were
  // for matching and spending, not for sending.
  //
  // The cap's order (#11, task 3 of the M1 re-run): measured on nodejs.org's
  // cli.html the full tree yields more uniques than the cap keeps, and a blind
  // DOM-order slice keeps the sidebar and deletes the page's own TOC — the
  // exact place a "which flag" goal's destination lives. Candidates targeting
  // the current page (url equal to it up to the fragment, or a fragment-only
  // url) take the seats first, DOM order within each group, cross-page
  // navigation after. Without a currentUrl there is no promotion: pure DOM
  // order, as before.
  const here = currentUrl ? currentUrl.replace(/#.*$/, '') : null
  const ownPage = []
  const crossPage = []
  for (const candidate of unique.values()) {
    const same = here && candidate.url
      && (candidate.url.startsWith('#') || candidate.url.replace(/#.*$/, '') === here)
    ;(same ? ownPage : crossPage).push(candidate)
  }
  const capped = [...ownPage, ...crossPage].slice(0, MAX_CANDIDATES)
  // 8. Tag, do not remove (#18). A commit-like control keeps its seat and rides
  // out marked, so the model may name it — and naming it is not clicking it: the
  // loop returns the pick as an authorization exit and clicks it only when the
  // caller supplies it on the next round. Removing it made the end of a route
  // unreachable; the tag makes it authorized. The mark is a fact about the
  // control, read by code here and rendered into the offer row.
  for (const candidate of capped) if (isCommitLike(candidate)) candidate.commitLike = true
  const candidates = capped.map((candidate) => ({
    ref: candidate.ref,
    label: truncate(candidate.label),
    count: candidate.count,
    ...(candidate.url ? { url: candidate.url } : {}),
    ...(candidate.commitLike ? { commitLike: true } : {}),
  }))
  return {
    candidates,
    commitCount: candidates.filter((candidate) => candidate.commitLike).length,
    offscreenCount: candidates.filter((candidate) => !visible.has(candidate.ref.slice(1))).length,
  }
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

// A hash of the pruned candidate list plus the URL, for the ping-pong and
// repeat-page guards (spec.md open question 3). Two invariants, both load-bearing:
//
// - Ref-free. Refs are CDP backend node ids that a harmless re-render can
//   renumber, so only `label|count` pairs are hashed.
// - Scroll-stable (#10). The loop scrolls on purpose now, so anything that
//   moves with the scroll position would make the guards misfire on every
//   scroll. The URL is hashed without its fragment (an in-page anchor jump is
//   a position change, not a page change), and the pairs are hashed in sorted
//   order so no caller can accidentally make the hash order-sensitive.
export async function pageFingerprint(url, candidates) {
  const crypto = await import('node:crypto')
  const body = candidates.map((candidate) => `${candidate.label}|${candidate.count}`)
  const canonical = [url.replace(/#.*$/, ''), ...body.sort()].join('\n')
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 8)
}

const CHECK_URL = 'https://shop.example.com/'

async function selfCheck() {
  const assert = (await import('node:assert/strict')).default
  const fs = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const snapshot = fs.readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/snapshot.txt'),
    'utf8',
  )
  // Every ref is on screen except 30, the "Far away button" below the fold.
  const allRefs = [...snapshot.matchAll(/\bref=(\d+)/g)].map((match) => match[1])
  const fixtureVisible = allRefs.filter((ref) => ref !== '30')
  const detail = pruneDetail(snapshot, { visibleRefs: fixtureVisible })
  const candidates = detail.candidates
  const labels = candidates.map((candidate) => candidate.label)

  // The commit tag (#18): 4 controls are commit-like, they keep their seats, and
  // they ride out marked. Naming one is not clicking one — the loop turns a
  // marked pick into an authorization exit (explore.js checks that half).
  assert.equal(detail.commitCount, 4, 'the four commit-like controls are counted')
  for (const marked of ['Submit', 'Buy now', 'Send', 'Unsubscribe from all emails']) {
    const candidate = candidates.find((entry) => entry.label.includes(marked))
    assert.ok(candidate, `${marked} left the offer`)
    assert.equal(candidate.commitLike, true, `${marked} is offered unmarked`)
  }

  // The reachability fix itself: a below-the-fold node is offered, counted as
  // off-screen, and no longer dropped. M1 measured the old rule deleting the
  // destination on 8 of 9 failures.
  assert.ok(labels.includes('Far away button'), 'off-screen node was dropped')
  assert.equal(detail.offscreenCount, 1, 'exactly the one below-the-fold candidate is off-screen')

  // Visibility is a hint, never a filter: the offer is byte-identical whatever
  // the loop says is on screen, and the counts move with it.
  assert.deepEqual(pruneCandidates(snapshot, {}), candidates, 'an empty visible set filtered')
  assert.deepEqual(
    pruneCandidates(snapshot, { visibleRefs: allRefs }),
    candidates,
    'a full visible set filtered',
  )
  assert.equal(pruneDetail(snapshot, {}).offscreenCount, candidates.length, 'nothing revealed')
  assert.equal(pruneDetail(snapshot, { visibleRefs: allRefs }).offscreenCount, 0, 'everything revealed')

  // Label-less nodes.
  assert.ok(!candidates.some((candidate) => candidate.ref === '@26'), 'label-less button survived')
  assert.ok(!candidates.some((candidate) => candidate.ref === '@31'), 'label-less textbox survived')
  assert.ok(candidates.every((candidate) => candidate.label.trim()), 'an empty label survived')

  // A bare input keeps the label of the text line above it.
  assert.equal(candidates[0].label, 'VAT number')

  // Duplicates collapse onto the first, with a count — but a label is not a
  // destination (#11): the two "Read more" anchors point at r/1 and r/2, so
  // both keep a seat, each with its own count.
  assert.deepEqual(
    candidates.find((candidate) => candidate.ref === '@27'),
    { ref: '@27', label: 'Read more', count: 1, url: 'https://shop.example.com/r/1' },
  )
  assert.deepEqual(
    candidates.find((candidate) => candidate.ref === '@28'),
    { ref: '@28', label: 'Read more', count: 1, url: 'https://shop.example.com/r/2' },
    'a same-labelled twin with a different target keeps its own seat',
  )

  // A self-referential anchor is a guaranteed no-op click, so it never reaches
  // Jev. Its twin keeps the seat it already had.
  const elsewhere = pruneCandidates(snapshot, { currentUrl: 'https://shop.example.com/r/1' })
  assert.deepEqual(
    elsewhere.find((candidate) => candidate.label === 'Read more'),
    { ref: '@28', label: 'Read more', count: 1, url: 'https://shop.example.com/r/2' },
    'the anchor we are sitting on is dropped, its twin stays',
  )
  assert.equal(elsewhere.length, candidates.length, 'the dropped seat is refilled from below the cutoff')
  assert.ok(elsewhere.some((candidate) => candidate.label === 'Result 111'), 'the refill is the next DOM entry')
  assert.ok(!elsewhere.some((candidate) => candidate.ref === '@27'), 'the no-op ref is gone')

  // Truncation, and the cap. 150 unique label|url pairs -> 120 kept in DOM
  // order (the second "Read more" takes a seat, so the cutoff moves back one).
  // Nothing is removed after the cap any more; the 4 commit-like entries keep
  // the seats they always had and are marked in place (#18).
  const long = candidates.find((candidate) => candidate.label.endsWith('…'))
  assert.ok(long && long.label.length === MAX_LABEL_CHARS, 'long label not truncated to 120')
  assert.equal(candidates.length, 120, 'cap: 150 entries -> 120, commit-like included')
  assert.ok(labels.includes('Result 110') && !labels.includes('Result 111'), 'cap kept the wrong entries')
  assert.ok(candidates.length <= MAX_CANDIDATES)

  // Same-page seats under the cap (#11, task 3's shape): a monster page whose
  // own TOC anchors come late in the DOM. With the current url known, the
  // page's own entry survives the cap and a cross-page nav entry pays for the
  // seat; on any other page the same entry is capped out in DOM order.
  const monster = [
    'root',
    ...Array.from({ length: 125 }, (_, index) => `  anchor "Nav ${index + 1}" [ref=${1000 + index}, loc=href:/nav/${index + 1}, url=https://shop.example.com/nav/${index + 1}]`),
    '  anchor "Own late section" [ref=2001, loc=href:/page#own, url=https://shop.example.com/page#own]',
  ].join('\n')
  const onPage = pruneCandidates(monster, { currentUrl: 'https://shop.example.com/page' })
  assert.ok(onPage.some((candidate) => candidate.label === 'Own late section'), 'the page own TOC entry survives the cap')
  assert.ok(!onPage.some((candidate) => candidate.label === 'Nav 125'), 'a cross-page nav entry paid for the seat')
  assert.equal(onPage.length, 120, 'the cap itself is untouched')
  const offPage = pruneCandidates(monster, { currentUrl: 'https://shop.example.com/other' })
  assert.ok(!offPage.some((candidate) => candidate.label === 'Own late section'), 'without the promotion the late entry is capped out')
  assert.ok(offPage.some((candidate) => candidate.label === 'Nav 120'), 'DOM order holds when the page does not match')

  // Fingerprint stability: the same page re-rendered with every ref renumbered
  // is the same page, and so is the same page scrolled (a fragment-only URL
  // change) or handed to the hash in a different order.
  const renumbered = snapshot.replace(/ref=(\d+)/g, (_, ref) => `ref=${Number(ref) + 1000}`)
  assert.equal(
    await pageFingerprint(CHECK_URL, candidates),
    await pageFingerprint(CHECK_URL, pruneCandidates(renumbered, { visibleRefs: fixtureVisible.map((ref) => String(Number(ref) + 1000)) })),
    'a re-render renumbers refs',
  )
  assert.equal(
    await pageFingerprint(`${CHECK_URL}#section`, candidates),
    await pageFingerprint(CHECK_URL, candidates),
    'an in-page anchor jump is not a page change',
  )
  assert.equal(
    await pageFingerprint(CHECK_URL, [...candidates].reverse()),
    await pageFingerprint(CHECK_URL, candidates),
    'hash order is canonical',
  )
  assert.notEqual(
    await pageFingerprint(CHECK_URL, candidates),
    await pageFingerprint('https://shop.example.com/other', candidates),
    'a different page hashes differently',
  )

  return candidates.length
}

if (process.argv[1] && process.argv[1].endsWith('prune.js')) {
  const count = await selfCheck()
  console.log(`prune.js self-check ok (${count} candidates survive)`)
}
