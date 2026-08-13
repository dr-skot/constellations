#!/usr/bin/env node
// Unit tests for the calibration engine (js/calibration.js) — the pure scoring +
// exposure-seeding core of the optional up-front level check (issue #32, spec #26).
//
//   1. computeDStar        — the best-separator (step-fit) D* truth table.
//   2. applyCalibrationSeed — the pure seeding core over an exposure map.
//   3. seedExposureFromCalibration — the impure load→seed→save adapter.
//
// Run:  node test/calibration.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// localStorage stub so course.js's loadExposure/saveExposure round-trip in-process.
const lsStore = {};
global.localStorage = {
  getItem: k => lsStore[k] ?? null,
  setItem: (k, v) => { lsStore[k] = v; },
  removeItem: k => { delete lsStore[k]; },
  clear: () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
};
global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({}) };
global.window = { devicePixelRatio: 1 };

const origLog = console.log, origTable = console.table;
console.log = () => {}; console.table = () => {};

const jsDir = path.join(__dirname, '..', 'js');
for (const f of ['data.js', 'lesson.js', 'calibration.js', 'course.js', 'calibration-ui.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}

console.log = origLog; console.table = origTable;

// ── Harness ────────────────────────────────────────────────
const failures = [];
function check(name, ok, detail) {
  if (ok) origLog(`OK: ${name}`);
  else { const m = `FAIL: ${name}` + (detail ? ` — ${detail}` : ''); failures.push(m); origLog(m); }
}

// ═══════════════════════════════════════════════════════════
// 1. computeDStar — best-separator truth table
// `correct` is a length-8 boolean array; index k ↦ band (k+1).
// ═══════════════════════════════════════════════════════════
origLog('── computeDStar truth table ────────────────────');
const T = true, F = false;
const cases = [
  ['all-right → 8',                  [T,T,T,T,T,T,T,T], 8],
  ['all-wrong → 0',                  [F,F,F,F,F,F,F,F], 0],
  ['clean falloff at 3 → 3',         [T,T,T,F,F,F,F,F], 3],
  ['clean falloff at 6 → 6',         [T,T,T,T,T,T,F,F], 6],
  ['one low slip forgiven → 6',      [T,F,T,T,T,T,F,F], 6],
  ['one lucky high ignored → 3',     [T,T,T,F,F,F,T,F], 3],
  ['tie keeps lower band (0 vs 2)→0',[F,T,F,F,F,F,F,F], 0],
  ['tie keeps lower band (3 vs 5)→3',[T,T,T,F,T,F,F,F], 3],
];
for (const [name, correct, want] of cases) {
  const got = computeDStar(correct);
  check(`computeDStar: ${name}`, got === want, `got ${got}`);
}

// ═══════════════════════════════════════════════════════════
// 2. applyCalibrationSeed — pure seeding core
// ═══════════════════════════════════════════════════════════
origLog('── applyCalibrationSeed ────────────────────────');

// A minimal catalog exercising: renderable below/at/above D*, and a non-renderable.
const CATALOG = [
  { abbr: 'AAA', diff: 1, stars: [[0,0,1]] },
  { abbr: 'BBB', diff: 3, stars: [[0,0,1]] },
  { abbr: 'CCC', diff: 5, stars: [[0,0,1]] },   // above a D*=3 threshold
  { abbr: 'DDD', diff: 2, stars: [] },          // non-renderable (no stars)
];

// diff ≤ D* renderable cons get identify/diagram seeded; above/non-renderable skipped.
{
  const exp = { _v2: true };
  applyCalibrationSeed(exp, CATALOG, 3);
  check('seed: renderable diff≤D* gets identify/diagram seen/correct = 1',
    exp.AAA?.['identify/diagram']?.seen === 1 && exp.AAA?.['identify/diagram']?.correct === 1 &&
    exp.BBB?.['identify/diagram']?.seen === 1 && exp.BBB?.['identify/diagram']?.correct === 1);
  check('seed: diff > D* is skipped', !exp.CCC);
  check('seed: non-renderable (stars.length===0) is skipped', !exp.DDD);
  check('seed: only identify/diagram touched (no higher tiers)',
    Object.keys(exp.AAA).length === 1 && exp.AAA['identify/diagram']);
  check('seed: lastSeen never written',
    !('lastSeen' in exp.AAA['identify/diagram']) && !('lastSeen' in exp.BBB['identify/diagram']));
}

// Upward merge: never lowers an existing seen/correct; higher tiers left intact;
// a real lastSeen on the seeded tier is preserved.
{
  const REAL_LAST = 1_700_000_000_000;
  const exp = {
    _v2: true,
    AAA: {
      'identify/diagram': { seen: 6, correct: 5, lastSeen: REAL_LAST },
      'find/diagram':     { seen: 2, correct: 1 },
    },
  };
  applyCalibrationSeed(exp, CATALOG, 3);
  check('merge: existing seen/correct not lowered',
    exp.AAA['identify/diagram'].seen === 6 && exp.AAA['identify/diagram'].correct === 5);
  check('merge: existing lastSeen preserved (seeding never writes it)',
    exp.AAA['identify/diagram'].lastSeen === REAL_LAST);
  check('merge: higher tier (find/diagram) untouched',
    exp.AAA['find/diagram'].seen === 2 && exp.AAA['find/diagram'].correct === 1);
  // BBB had no prior record → seeded fresh, still no lastSeen.
  check('merge: freshly-seeded con has no lastSeen',
    !('lastSeen' in exp.BBB['identify/diagram']));
}

// A con that was seen once but with correct:0 (introduced, not yet passed) → correct lifts to 1.
{
  const exp = { _v2: true, AAA: { 'identify/diagram': { seen: 1, correct: 0 } } };
  applyCalibrationSeed(exp, CATALOG, 1);
  check('merge: correct=0 lifts to 1 (marks tier passed)',
    exp.AAA['identify/diagram'].seen === 1 && exp.AAA['identify/diagram'].correct === 1);
}

// D* ≤ 0 is a no-op.
{
  const exp0 = { _v2: true };
  applyCalibrationSeed(exp0, CATALOG, 0);
  check('seed: D*=0 is a no-op', Object.keys(exp0).length === 1 && exp0._v2);
  const expNeg = { _v2: true };
  applyCalibrationSeed(expNeg, CATALOG, -1);
  check('seed: D*<0 is a no-op', Object.keys(expNeg).length === 1 && expNeg._v2);
}

// calibrationSeedTargets: the single source of truth both the seed and the payoff
// count read, so they can never disagree.
{
  const targets = calibrationSeedTargets(CATALOG, 3);
  check('seedTargets: renderable diff≤D* only',
    targets.map(c => c.abbr).sort().join(',') === 'AAA,BBB');
  check('seedTargets: D*≤0 → empty', calibrationSeedTargets(CATALOG, 0).length === 0);
  // The count matches exactly what applyCalibrationSeed writes.
  const exp = { _v2: true };
  applyCalibrationSeed(exp, CATALOG, 3);
  const seededCount = Object.keys(exp).filter(k => k !== '_v2' && exp[k]['identify/diagram']).length;
  check('seedTargets: count equals what the seed actually wrote',
    calibrationSeedTargets(CATALOG, 3).length === seededCount);
}

// applyCalibrationSeed returns the same (mutated) exposure object.
{
  const exp = { _v2: true };
  check('seed: returns the exposure it was handed', applyCalibrationSeed(exp, CATALOG, 3) === exp);
}

// ═══════════════════════════════════════════════════════════
// 3. seedExposureFromCalibration — impure adapter over the real catalog C
// ═══════════════════════════════════════════════════════════
origLog('── seedExposureFromCalibration (adapter) ───────');
{
  localStorage.clear();
  const dStar = 3;
  const data = seedExposureFromCalibration(dStar);

  // Persisted round-trip: what we return equals what loadExposure reads back.
  check('adapter: persists to localStorage', JSON.stringify(loadExposure()) === JSON.stringify(data));

  const renderableAtOrBelow = C.filter(c => c.stars.length > 0 && c.diff <= dStar);
  const renderableAbove     = C.filter(c => c.stars.length > 0 && c.diff >  dStar);

  check('adapter: every renderable diff≤D* reads identify/diagram passed',
    renderableAtOrBelow.every(c =>
      (data[c.abbr]?.['identify/diagram']?.correct || 0) >= 1 &&
      (data[c.abbr]?.['identify/diagram']?.seen    || 0) >= 1),
    `${renderableAtOrBelow.length} expected`);

  check('adapter: no renderable diff>D* was seeded',
    renderableAbove.every(c => !(data[c.abbr]?.['identify/diagram']?.seen)));

  check('adapter: seeding never wrote lastSeen',
    renderableAtOrBelow.every(c => !('lastSeen' in (data[c.abbr]['identify/diagram']))));

  // Downstream integration: planLesson now draws from the seeded pool (they are no
  // longer "unseen"), so the introduction gate no longer bottlenecks them.
  function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const { questions } = planLesson(loadExposure(), C, BOUNDS, makeRng(2024), 1_000_000_000_000);
  const seededAbbrs = new Set(renderableAtOrBelow.map(c => c.abbr));
  const drawsFromSeeded = questions.some(q => seededAbbrs.has(q.con.abbr));
  check('adapter: generateNextLesson/planLesson draws from the seeded pool', drawsFromSeeded);

  // Seeding demonstrably changed the plan: the same rng over a fresh (empty)
  // exposure produces a different question sequence.
  const freshQs = planLesson({ _v2: true }, C, BOUNDS, makeRng(2024), 1_000_000_000_000).questions;
  check('adapter: seeded plan differs from the fresh-exposure plan',
    JSON.stringify(questions.map(q => q.con.abbr)) !== JSON.stringify(freshQs.map(q => q.con.abbr)));
}

// Re-run merges upward only through the adapter (destructive reset is out of scope).
{
  localStorage.clear();
  seedExposureFromCalibration(5);           // seed a high threshold first
  const before = loadExposure();
  const sample = C.find(c => c.stars.length > 0 && c.diff <= 3);
  before[sample.abbr]['identify/diagram'].correct = 9;   // simulate real practice
  saveExposure(before);
  seedExposureFromCalibration(3);           // lower re-run must not demote
  const after = loadExposure();
  check('adapter: re-run merges upward only (never demotes)',
    after[sample.abbr]['identify/diagram'].correct === 9);
}

// ═══════════════════════════════════════════════════════════
// 4. Flow helpers — probe roster, distractors, band-scored D*
// ═══════════════════════════════════════════════════════════
origLog('── flow helpers ────────────────────────────────');

// The 8-probe ladder resolves to real, renderable catalog cons, one per diff band.
{
  const probes = calibrationProbes(C);
  check('probes: exactly 8', probes.length === 8);
  check('probes: match the ratified ladder order (#27)',
    probes.map(c => c.abbr).join(',') === 'Ori,Leo,Peg,Her,Cnc,Cet,CVn,Dor');
  check('probes: every probe is renderable (stars.length > 0)',
    probes.every(c => c.stars.length > 0));
  check('probes: diffs cover bands 1..8 exactly',
    probes.map(c => c.diff).join(',') === '1,2,3,4,5,6,7,8');
}

// Distractors are supplied by the quiz's getDistractors (js/quiz.js), reused by the
// probe UI; not re-tested here. shuffleInPlace shuffles probe + choice order.
{
  function seqRng(seq) { let i = 0; return () => seq[i++ % seq.length]; }
  const a = shuffleInPlace([1, 2, 3, 4, 5], seqRng([0, 0, 0, 0]));
  check('shuffleInPlace: preserves the multiset', a.slice().sort().join(',') === '1,2,3,4,5');
}

// D* is scored by band (diff), so the presentation shuffle can never change it.
{
  const R = (abbr, correct) => ({ diff: C.find(c => c.abbr === abbr).diff, correct });
  // Bands 1..3 right, 4..8 wrong → D* = 3, in ladder order …
  const ordered = [R('Ori',T),R('Leo',T),R('Peg',T),R('Her',F),R('Cnc',F),R('Cet',F),R('CVn',F),R('Dor',F)];
  check('dStarFromProbeResults: bands 1..3 right → 3', dStarFromProbeResults(ordered) === 3);
  // … and the same results shuffled give the identical D*.
  const shuffled = [R('Dor',F),R('Peg',T),R('CVn',F),R('Ori',T),R('Cet',F),R('Leo',T),R('Her',F),R('Cnc',F)];
  check('dStarFromProbeResults: shuffle-independent', dStarFromProbeResults(shuffled) === 3);
  // Endpoints.
  check('dStarFromProbeResults: all right → 8',
    dStarFromProbeResults(['Ori','Leo','Peg','Her','Cnc','Cet','CVn','Dor'].map(a => R(a, T))) === 8);
  check('dStarFromProbeResults: all wrong → 0',
    dStarFromProbeResults(['Ori','Leo','Peg','Her','Cnc','Cet','CVn','Dor'].map(a => R(a, F))) === 0);
  // A lone low slip is forgiven: bands {1,3,4,5,6} right, 2 wrong, 7,8 wrong → 6.
  const slip = [R('Ori',T),R('Leo',F),R('Peg',T),R('Her',T),R('Cnc',T),R('Cet',T),R('CVn',F),R('Dor',F)];
  check('dStarFromProbeResults: lone low slip forgiven → 6', dStarFromProbeResults(slip) === 6);
}

// ═══════════════════════════════════════════════════════════
// 5. Entry logic (ticket #34) — first-run detection + route target
// ═══════════════════════════════════════════════════════════
origLog('── entry logic ─────────────────────────────────');

// exposureIsEmpty (course.js) — the shape-aware emptiness predicate first-run reads.
{
  check('exposureIsEmpty: {} → true', exposureIsEmpty({}) === true);
  check('exposureIsEmpty: {_v2:true} → true', exposureIsEmpty({ _v2: true }) === true);
  check('exposureIsEmpty: with a con → false', exposureIsEmpty({ _v2: true, Ori: {} }) === false);
}

// calibrationIsFirstRun: true only when there is no recorded progress.
{
  localStorage.clear();
  check('firstRun: empty exposure → true', calibrationIsFirstRun() === true);
  seedExposureFromCalibration(3);   // now there is progress
  check('firstRun: seeded exposure → false', calibrationIsFirstRun() === false);
  localStorage.clear();
  saveExposure({ _v2: true });      // the empty-but-migrated shape
  check('firstRun: {_v2:true} only → true', calibrationIsFirstRun() === true);
}

// calibrationEntryTarget: offer the check on a first-run default landing; never
// hijack an explicit route, and never offer once there is progress.
{
  check('entry: first-run + no hash → calibration', calibrationEntryTarget('', true) === 'calibration');
  check('entry: first-run + course → calibration', calibrationEntryTarget('course', true) === 'calibration');
  check('entry: returning + no hash → course', calibrationEntryTarget('', false) === 'course');
  check('entry: first-run + explicit route not hijacked', calibrationEntryTarget('explore', true) === 'explore');
  check('entry: first-run + view/Ori not hijacked', calibrationEntryTarget('view/Ori', true) === 'view/Ori');
  check('entry: returning + lesson passes through', calibrationEntryTarget('lesson', false) === 'lesson');
}

// calibrationPayoffCopy: the payoff headline/body/band, incl. the re-run-skip case.
{
  const beginner = calibrationPayoffCopy(0, 0, false);
  check('payoffCopy: D*=0 first-timer → "Starting from the beginning"',
    beginner.head === 'Starting from the beginning' && beginner.band === '');
  const rerunSkip = calibrationPayoffCopy(0, 36, true);
  check('payoffCopy: D*=0 with progress → "No changes" (not "beginning")',
    rerunSkip.head === 'No changes' && !/beginning/i.test(rerunSkip.unlock) && rerunSkip.band === '');
  const mid = calibrationPayoffCopy(4, 36, false);
  check('payoffCopy: mid D* → placed + band + count',
    mid.head === 'We’ve placed you' && mid.band === 'difficulty band 4 of 8' && mid.unlock.includes('36'));
  const whole = calibrationPayoffCopy(8, 88, true);
  check('payoffCopy: D*≥8 → whole-sky + band',
    whole.head === 'You know the whole sky' && whole.band === 'difficulty band 8 of 8');
}

// ── Summary ────────────────────────────────────────────────
origLog('');
if (failures.length === 0) {
  origLog('✅ ALL PASSED');
  process.exit(0);
} else {
  origLog(`❌ ${failures.length} FAILURE(S)`);
  for (const f of failures) origLog('  ' + f);
  process.exit(1);
}
