#!/usr/bin/env node
// Characterization capture for the guide source (issue #86, spec #82).
//
// Freezes what the two hosts produce TODAY when they prepare a finding guide, so the
// move onto js/guide-source.js (#89) can be proved byte-for-byte identical. Same role
// as test/capture-golden.js and test/capture-session-golden.js: capture before the
// refactor, replay after.
//
// WHAT IS TRANSCRIBED AND WHAT IS NOT
//
// The stanza below is a verbatim transcription of js/find-guide.js:54-58 — the prep
// that #89 moves behind the seam. That is the code under refactor, so importing it
// would make the golden agree with itself by construction.
//
// The PRIMITIVES it composes (raDecToVec, guideNorthUpR) are loaded from the real
// modules, not transcribed. They are shared vector math that #89 does not touch and
// the new module will call unchanged; hand-copying them would risk introducing a
// discrepancy rather than capturing one. The seam of this golden is the composition,
// not the arithmetic underneath it.
//
// DETERMINISM
//
// The one `random` step each guide carries (88 of 88) is filled from a PINNED origin
// rather than explore.P or Math.random(), and the origin is recorded in the file so
// #89 can feed the module the same one. Everything else in the prep is a pure
// function of the guide data and the constellation.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root  = path.join(__dirname, '..');
const jsDir = path.join(root, 'js');

// data.js and guide-renderer.js touch these at load; the values we read are pure.
global.window = global;
global.addEventListener = () => {};          // guide-renderer registers a resize listener
global.document = { getElementById: () => null, querySelector: () => null };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const origLog = console.log; console.log = () => {};
for (const f of ['data.js', 'projection.js', 'guide-renderer.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}
console.log = origLog;

const guides = JSON.parse(fs.readFileSync(path.join(jsDir, 'finding-guides.json'), 'utf8'));

// The pinned origin. explore's own opening view (js/explore.js:6 builds P from these),
// so the golden's `random` steps land somewhere the app actually starts from rather
// than an arbitrary point.
const ORIGIN = { ra: 80, dec: 5 };

// ── Verbatim transcription of js/find-guide.js:54-58 ─────────────────────────
// const steps = guide.steps.map(s => Object.assign({}, s));
// const { ra: curRa, dec: curDec } = vecToRaDec(explore.P);
// steps.forEach(s => { if (s.random) { s.ra = curRa; s.dec = curDec; } });
// const defaultR = guideNorthUpR(raDecToVec(con.ra, con.dec));
// explore.R = guide.rotation != null ? defaultR + guide.rotation : defaultR;
function prepAsHostsDoToday(guide, con, origin) {
  const steps = guide.steps.map(s => Object.assign({}, s));
  steps.forEach(s => { if (s.random) { s.ra = origin.ra; s.dec = origin.dec; } });
  const defaultR = guideNorthUpR(raDecToVec(con.ra, con.dec));
  const roll = guide.rotation != null ? defaultR + guide.rotation : defaultR;
  return { steps, roll };
}

const entries = [];
const missing = [];
for (const name of Object.keys(guides).sort()) {
  const con = C.find(c => c.name === name);
  if (!con) { missing.push(name); continue; }
  const { steps, roll } = prepAsHostsDoToday(guides[name], con, ORIGIN);
  entries.push({ name, abbr: con.abbr, roll, steps });
}

const golden = { origin: ORIGIN, guides: entries };
const out = path.join(__dirname, 'guide-source-golden.json');
fs.writeFileSync(out, JSON.stringify(golden, null, 2) + '\n');

const stepCount = entries.reduce((n, e) => n + e.steps.length, 0);
const randomCount = entries.reduce((n, e) => n + e.steps.filter(s => s.random).length, 0);
console.log(`Captured ${entries.length} guides / ${stepCount} steps ` +
            `(${randomCount} random) -> ${path.relative(process.cwd(), out)}`);
if (missing.length) {
  console.log(`\n${missing.length} guide key(s) with no catalog constellation:`);
  for (const m of missing) console.log(`  ${m}`);
  process.exit(1);
}
