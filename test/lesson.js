#!/usr/bin/env node
// Verify the Candidate-2 extraction of the lesson planner (js/lesson.js).
//
//   1. GOLDEN EQUIVALENCE — replay test/lesson-golden.json (captured from the
//      pre-refactor generateNextLesson) through the pure planLesson and assert
//      byte-for-byte equality. Proves the extraction changed nothing.
//   2. INVARIANTS — structural properties the scheduler must always hold, which
//      survive intentional future tweaks and document intent.
//
// Run:  node test/lesson.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Same LCG as js/projection.js makeRng.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Minimal stubs — planLesson is pure, but data.js/course.js touch these at load.
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
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'lesson.js'), 'utf8'), { filename: 'lesson.js' });

console.log = origLog; console.table = origTable;

// ── Harness ────────────────────────────────────────────────
const failures = [];
function check(name, ok, detail) {
  if (ok) origLog(`OK: ${name}`);
  else { const m = `FAIL: ${name}` + (detail ? ` — ${detail}` : ''); failures.push(m); origLog(m); }
}

function serializeLesson(lesson) {
  return {
    label: lesson.label,
    questions: lesson.questions.map(q => ({
      abbr: q.con.abbr,
      type: q.type,
      mode: q.mode,
      answerMode: q.answerMode ?? null,
      noBounds: q.noBounds ?? null,
      distanceLevel: q.distanceLevel ?? null,
    })),
  };
}

// ═══════════════════════════════════════════════════════════
// 1. GOLDEN EQUIVALENCE
// ═══════════════════════════════════════════════════════════
origLog('── Golden equivalence ──────────────────────────');
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'lesson-golden.json'), 'utf8'));
let mismatches = 0;
for (const g of golden.entries) {
  const got = serializeLesson(planLesson(g.exposureBefore, C, BOUNDS, makeRng(g.seed), g.now));
  const ok = JSON.stringify(got) === JSON.stringify(g.expected);
  if (!ok) {
    mismatches++;
    if (mismatches <= 3) {
      origLog(`  mismatch @ ${g.name}:`);
      origLog(`    expected: ${JSON.stringify(g.expected.questions.map(q => q.abbr + ':' + q.type + '/' + q.mode))}`);
      origLog(`    got:      ${JSON.stringify(got.questions.map(q => q.abbr + ':' + q.type + '/' + q.mode))}`);
    }
  }
}
check(`golden: all ${golden.entries.length} lessons reproduced byte-for-byte`,
  mismatches === 0, `${mismatches} mismatch(es)`);

// ═══════════════════════════════════════════════════════════
// 2. INVARIANTS  (survive intentional future tweaks)
// ═══════════════════════════════════════════════════════════
origLog('── Invariants ──────────────────────────────────');
const NOW = 1_000_000_000_000;

// Build a range of exposure states to test invariants against.
function freshExposure() { return { _v2: true }; }
function seedExposure(nCons, tierFill) {
  const exp = { _v2: true };
  const TIER_KEYS = TIER_SPECS.map(([k]) => k);
  for (const c of C.slice(0, nCons)) {
    const e = {};
    for (const k of TIER_KEYS.slice(0, tierFill)) e[k] = { seen: 6, correct: 5, lastSeen: NOW - 12 * 3_600_000 };
    exp[c.abbr] = e;
  }
  return exp;
}

const states = [
  ['fresh', freshExposure()],
  ['6 cons @ tier1', seedExposure(6, 1)],
  ['20 cons @ tier3', seedExposure(20, 3)],
  ['8 cons fully advanced', seedExposure(8, 7)],
];

for (const [name, exp] of states) {
  const { label, questions } = planLesson(exp, C, BOUNDS, makeRng(2024), NOW);

  check(`[${name}] always yields exactly 12 questions`,
    questions.length === 12, `got ${questions.length}`);

  check(`[${name}] every find question has BOUNDS`,
    questions.filter(q => q.type === 'find').every(q => BOUNDS[q.con.abbr]),
    `${questions.filter(q => q.type === 'find' && !BOUNDS[q.con.abbr]).length} bound-less finds`);

  check(`[${name}] label is one of the four known labels`,
    ['New Constellations', 'Sky Hunter', 'Mixed Practice', 'Review & Advance'].includes(label),
    `got "${label}"`);

  check(`[${name}] every question carries a real constellation`,
    questions.every(q => q.con && q.con.abbr && q.con.stars.length > 0));
}

// Anti-repeat invariants (issue #17): a constellation never appears on two
// consecutive questions, and no constellation is over-represented beyond an
// even spread of the pool. Small pools (few known constellations) are the
// stress case — they used to be padded with cloned questions and shuffled
// blind, producing runs like four Ursa Majors in a row.
{
  const antiStates = [
    ['fresh', freshExposure()],
    ['2 cons @ tier1', seedExposure(2, 1)],
    ['3 cons @ tier1', seedExposure(3, 1)],
    ['6 cons @ tier1', seedExposure(6, 1)],
    ['20 cons @ tier3', seedExposure(20, 3)],
  ];
  for (const [name, exp] of antiStates) {
    // Sweep several seeds so a single lucky ordering can't hide a repeat.
    let adjTotal = 0, capViolations = '';
    for (const seed of [1, 2, 7, 42, 99, 2024]) {
      const { questions } = planLesson(exp, C, BOUNDS, makeRng(seed), NOW);
      const distinct = new Set(questions.map(q => q.con.abbr)).size;

      for (let i = 1; i < questions.length; i++)
        if (questions[i].con.abbr === questions[i - 1].con.abbr && distinct > 1) adjTotal++;

      const counts = {};
      for (const q of questions) counts[q.con.abbr] = (counts[q.con.abbr] || 0) + 1;
      const cap = Math.max(1, Math.ceil(questions.length / distinct));
      for (const [a, n] of Object.entries(counts))
        if (n > cap) capViolations += ` seed${seed}:${a}=${n}>${cap}(D=${distinct})`;
    }
    check(`[${name}] no back-to-back same constellation (6 seeds)`,
      adjTotal === 0, `${adjTotal} adjacent repeat(s) across seeds`);
    check(`[${name}] no constellation exceeds even-spread cap (6 seeds)`,
      capViolations === '', capViolations.trim());
  }
}

// Near-duplicate avoidance (issue #17): when a constellation with several
// passed tiers is repeated within a lesson, the repeat should be a *different*
// tier/mode, not the same question at another rotation. Constellations here have
// tiers 0–2 passed (≥2 identify tiers that render without bounds), so a repeated
// review constellation must vary its questionKey at least once.
{
  const exp = seedExposure(4, 3);
  let sameKeyRepeats = 0, checked = 0;
  for (const seed of [1, 2, 7, 42, 99, 2024]) {
    const { questions } = planLesson(exp, C, BOUNDS, makeRng(seed), NOW);
    const byCon = {};
    for (const q of questions) (byCon[q.con.abbr] ||= []).push(q);
    for (const [abbr, qs] of Object.entries(byCon)) {
      if (qs.length < 2 || !exp[abbr]) continue;   // only repeated, known (multi-tier) cons
      checked++;
      const keys = new Set(qs.map(q => (q.type === 'find' && q.noBounds && q.mode === 'photo')
        ? 'find/photo-nb' : (q.type === 'find' ? 'find/' + q.mode : 'identify/' + q.mode)));
      if (keys.size < 2) sameKeyRepeats++;   // repeated but never varied the task
    }
  }
  check('repeated multi-tier constellation varies its tier/mode (6 seeds)',
    checked > 0 && sameKeyRepeats === 0,
    `${sameKeyRepeats}/${checked} repeated cons never varied tier`);
}

// Determinism: same (exposure, seed, now) → identical lesson.
{
  const exp = seedExposure(15, 4);
  const a = serializeLesson(planLesson(exp, C, BOUNDS, makeRng(99), NOW));
  const b = serializeLesson(planLesson(exp, C, BOUNDS, makeRng(99), NOW));
  check('determinism: same seed → identical lesson',
    JSON.stringify(a) === JSON.stringify(b));
  const c = serializeLesson(planLesson(exp, C, BOUNDS, makeRng(100), NOW));
  check('sensitivity: different seed → (usually) different lesson',
    JSON.stringify(a) !== JSON.stringify(c));
}

// Fresh user: intro cap ≤ 4 new constellations in the first lesson.
{
  const { questions } = planLesson(freshExposure(), C, BOUNDS, makeRng(7), NOW);
  const distinctNew = new Set(questions.map(q => q.con.abbr));
  check('fresh user introduces ≤ 4 distinct constellations',
    distinctNew.size <= 4, `got ${distinctNew.size}`);
}

// Purity: planLesson must not mutate the exposure it is handed.
{
  const exp = seedExposure(10, 3);
  const before = JSON.stringify(exp);
  planLesson(exp, C, BOUNDS, makeRng(3), NOW);
  check('planLesson does not mutate its exposure input',
    JSON.stringify(exp) === before);
}

// Silent by default: no throw when no log sink is passed.
{
  let threw = false;
  try { planLesson(freshExposure(), C, BOUNDS, makeRng(1), NOW); } catch { threw = true; }
  check('planLesson runs silently with default log sink', !threw);
}

// ── Summary ────────────────────────────────────────────────
origLog('');
if (failures.length === 0) {
  origLog(`✅ ALL PASSED (${golden.entries.length} golden + invariants)`);
  process.exit(0);
} else {
  origLog(`❌ ${failures.length} FAILURE(S)`);
  for (const f of failures) origLog('  ' + f);
  process.exit(1);
}
