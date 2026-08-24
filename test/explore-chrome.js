#!/usr/bin/env node
// What the explorer is wearing, as one value (issue #94).
//
// The explorer shows one of three sets of chrome: free explore, a lesson's find question,
// or a finding guide. Six elements switch between them, and three writers used to set them,
// disagreeing about which they owned: starting a find question set FIVE and tearing one
// down set FIVE — every element but the guide overlay, which neither had heard of — while
// the guide wrote THREE, saving and restoring two of them as display strings.
//
// Nothing stated the rule and nothing noticed when a path missed it. Two reachable defects
// came out of that, both reproduced in Chrome before this was written:
//
//   1. A guide opened from free explore left the whole layers row on screen. A running
//      guide owns the layers (the step display is complete-or-null and exState is not
//      consulted), so tapping Art moved the button, wrote ex-art=0 to localStorage, and
//      changed nothing on screen — a dead control that silently rewrote a stored setting.
//        exStateChanged: true, persistedToLocalStorage: "0", skyChanged: false
//
//   2. "? Help" opened a guide but left the lesson header above it, including a live Quit.
//      Quitting ran endLesson(), which never tore the guide down: overlay still displayed,
//      _guideSaved and explore.stepDisplay still set, app on #result. Returning to the
//      explorer showed free-explore chrome and a running guide at once, the guide still
//      offering "← Back to lesson" for a lesson that had ended.
//
// The fix is a mode, and the property that makes the old bug unwritable is TOTALITY: every
// mode declares every element. A writer that sets a subset cannot be expressed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const origLog = console.log; console.log = () => {};
const jsDir = path.join(__dirname, '..', 'js');
for (const f of ['projection.js', 'step-display.js', 'explore.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

const MODES = [EXPLORE_CHROME_FREE, EXPLORE_CHROME_FIND, EXPLORE_CHROME_GUIDE];
const PARTS = ['freeHeader', 'layers', 'quizHeader', 'navRow', 'quizBar', 'guideOverlay'];

// ── 1. The three modes are distinct ──────────────────────────────────────────
{
  check('the three chrome modes are distinct', new Set(MODES).size === 3, MODES.join(','));
}

// ── 2. Every mode declares every element ─────────────────────────────────────
// THE invariant. The bug was a writer that set two of six and left four wherever the
// previous mode had put them; a total map is what makes that impossible rather than
// merely discouraged.
{
  for (const mode of MODES) {
    const c = exploreChrome(mode);
    const missing = PARTS.filter(p => typeof c[p] !== 'boolean');
    check(`'${mode}' declares all ${PARTS.length} elements`, missing.length === 0,
      missing.length ? `missing/non-boolean: ${missing.join(', ')}` : '');
    const extra = Object.keys(c).filter(k => !PARTS.includes(k));
    check(`'${mode}' declares nothing else`, extra.length === 0, extra.join(', '));
  }
}

// ── 3. A guide is a takeover ─────────────────────────────────────────────────
// The whole of defect 2, and half of defect 1: the guide shows its overlay and NOTHING
// else. Not "the overlay plus whatever was underneath".
{
  const g = exploreChrome(EXPLORE_CHROME_GUIDE);
  check('a guide shows the overlay', g.guideOverlay === true);
  const others = PARTS.filter(p => p !== 'guideOverlay');
  check('and hides every other element', others.every(p => g[p] === false),
    others.filter(p => g[p]).join(', '));
}

// ── 4. Only a guide shows the overlay ────────────────────────────────────────
{
  for (const mode of [EXPLORE_CHROME_FREE, EXPLORE_CHROME_FIND]) {
    check(`'${mode}' does not show the guide overlay`,
      exploreChrome(mode).guideOverlay === false);
  }
}

// ── 5. Free explore and a find question are exact opposites ──────────────────
// They disagree about all five non-overlay elements: free explore offers the header and
// the layer toggles, a find question offers the lesson header, nav row and question bar.
// Neither ever shows both halves, which is what "the explorer wears ONE set" means.
{
  const free = exploreChrome(EXPLORE_CHROME_FREE);
  const find = exploreChrome(EXPLORE_CHROME_FIND);
  check('free explore shows its header and the layer toggles',
    free.freeHeader === true && free.layers === true);
  check('and none of the question chrome',
    free.quizHeader === false && free.navRow === false && free.quizBar === false);
  check('a find question shows the lesson header, nav row and question bar',
    find.quizHeader === true && find.navRow === true && find.quizBar === true);
  check('and none of the free-explore chrome',
    find.freeHeader === false && find.layers === false);
  const disputed = PARTS.filter(p => p !== 'guideOverlay');
  check('the two modes are complements on every disputed element',
    disputed.every(p => free[p] === !find[p]),
    disputed.filter(p => free[p] === find[p]).join(', '));
}

// ── 6. The layer toggles are offered only where they work ────────────────────
// Defect 1 stated as a property. A running guide owns the layers, so offering the toggles
// during one is offering a control that cannot act — and worse, one whose click still
// persists to storage. Free explore is the only mode where exState drives the sky.
{
  check('the layer toggles show in free explore only',
    MODES.filter(m => exploreChrome(m).layers) .join(',') === EXPLORE_CHROME_FREE,
    MODES.filter(m => exploreChrome(m).layers).join(','));
}

// ── 7. Naming a mode that does not exist is an error ─────────────────────────
// Not a silent fallback. A typo'd mode is a programming mistake, and defaulting to some
// chrome would hide it behind a screen that merely looks slightly wrong — the same
// reasoning that makes prepareGuide throw on a missing origin rather than reject.
{
  for (const bad of ['quiz', '', null, undefined, 'FREE']) {
    let threw = false;
    try { exploreChrome(bad); } catch { threw = true; }
    check(`exploreChrome(${JSON.stringify(bad)}) throws`, threw);
  }
}

// ── 8. Nothing outside explore.js switches these elements ────────────────────
// The three-writer split, asserted so it cannot re-form. Matches a LOOKUP rather than the
// bare id, because the ids legitimately appear in index.html's markup — it is reaching for
// the element in script that is the violation.
//
// Scope derived from what this claims to cover: every script the app loads, plus the pages
// themselves (inline <script> is script). Proven on both axes in tmp/prove-chrome-guard.js
// — this repo has shipped five guards that fired while looking in the wrong place.
{
  const root = path.join(__dirname, '..');
  const OWNED = ['explore-free-hdr', 'find-quiz-hdr', 'find-nav-row', 'explore-quiz-bar',
                 'find-guide-overlay', 'explore-layers'];
  const LOOKUP = new RegExp(
    `(getElementById|querySelector(All)?)\\s*\\(\\s*["'\`]\\.?(${OWNED.join('|')})["'\`]`);
  const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const withExt = (dir, ext) => fs.readdirSync(path.join(root, dir))
    .filter(f => f.endsWith(ext))
    .map(f => path.join(root, dir, f));
  const files = [
    ...withExt('js', '.js'), ...withExt('perf', '.js'),
    ...withExt('.', '.html'), ...withExt('perf', '.html'),
  ];

  const reachers = files
    .filter(f => LOOKUP.test(stripComments(fs.readFileSync(f, 'utf8'))))
    .map(f => path.relative(root, f));

  check(`only js/explore.js reaches for the chrome (${files.length} files scanned)`,
    reachers.length === 1 && reachers[0] === path.join('js', 'explore.js'),
    reachers.join(', ') || 'nobody reaches for it — is the applier still there?');
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
