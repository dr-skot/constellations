#!/usr/bin/env node
// Capture a behavior golden for the lesson planner BEFORE the Candidate-2 extraction.
//
// The current generateNextLesson() is impure: it reads loadExposure()/C/BOUNDS,
// calls Date.now() and Math.random(). To freeze a replayable golden we pin the two
// nondeterministic sources — Math.random := makeRng(seed) reset per lesson, Date.now
// := a fixed advancing clock — and record, for each lesson, the exact inputs
// (exposure snapshot, seed, now) alongside the exact output ({label, questions}).
//
// After the extraction, test/lesson.js replays each entry through the pure
//   planLesson(exposureBefore, C, BOUNDS, makeRng(seed), now)
// and asserts byte-for-byte equality. Because only generateNextLesson consumes rng
// (recordSeen/recordCorrect do not) and we reset the seed at the top of each lesson,
// the rng stream a lesson sees is fully determined by its recorded seed — so a
// faithful extraction reproduces every lesson exactly.
//
// Run ONCE against unmodified code:  node test/capture-golden.js
// Commit the emitted test/lesson-golden.json.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Same LCG as js/projection.js makeRng — inlined because projection.js is not loaded here.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ── Stubs (mirrors test/sim-lessons.js) ────────────────────
const lsStore = {};
global.localStorage = {
  getItem: k => lsStore[k] ?? null,
  setItem: (k, v) => { lsStore[k] = v; },
  removeItem: k => { delete lsStore[k]; },
  clear: () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
};
const ssStore = {};
global.sessionStorage = {
  getItem: k => ssStore[k] ?? null,
  setItem: (k, v) => { ssStore[k] = v; },
  removeItem: k => { delete ssStore[k]; },
  clear: () => { for (const k of Object.keys(ssStore)) delete ssStore[k]; },
};
function elemStub() {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'style') return new Proxy({}, { set: () => true, get: () => '' });
      if (prop === 'classList') return { add(){}, remove(){}, toggle(){}, contains: () => false };
      if (prop === 'querySelector') return () => elemStub();
      if (prop === 'querySelectorAll') return () => [];
      if (prop === 'appendChild') return () => {};
      if (prop === 'addEventListener') return () => {};
      return '';
    },
    set: () => true
  });
}
global.document = {
  getElementById: () => elemStub(),
  querySelectorAll: () => [],
  querySelector: () => elemStub(),
  createElement: () => elemStub(),
};
global.window = { devicePixelRatio: 1 };

// Fixed advancing clock.
let mockNow = 1_000_000_000_000;
Date.now = () => mockNow;

// Mute the scheduler's console instrumentation during capture.
const origLog = console.log, origTable = console.table;
console.log = () => {}; console.table = () => {};

// ── Load unmodified source ─────────────────────────────────
const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'course.js'), 'utf8'), { filename: 'course.js' });

// Keep console muted through capture — the scheduler logs on every call; the pure
// core will later route these through the `log` sink. origLog is used for the summary.

// ── Serialization: strip the heavy `con` object to a stable, order-explicit shape ──
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
const cloneExposure = () => JSON.parse(JSON.stringify(loadExposure()));

const entries = [];

// Capture one lesson at the CURRENT exposure/clock, pinning rng to a fresh seed.
// Records inputs + output; does NOT advance exposure (caller decides).
function capture(name, seed) {
  mockNow += 2 * 3_600_000; // advance 2h, matching sim-lessons cadence
  Math.random = makeRng(seed);
  const exposureBefore = cloneExposure();
  const now = mockNow;
  const lesson = generateNextLesson();
  entries.push({ name, seed, now, exposureBefore, expected: serializeLesson(lesson) });
  return lesson;
}

const HOUR = 3_600_000;
const TIER_KEYS = TIER_SPECS.map(([k]) => k);

// ── Sequence 1: fresh user, 25 all-correct lessons ─────────
// Exercises the known.length===0 branch, the intro cap, in-progress gating,
// the heat-sorted review pool, review-tier decay, the knob ramp, and padding.
localStorage.clear();
for (let i = 0; i < 25; i++) {
  const lesson = capture(`seq/lesson-${i + 1}`, 100 + i);
  for (const q of lesson.questions) {
    const key = questionKey(q);
    recordSeen(q.con.abbr, key);
    recordCorrect(q.con.abbr, key);
  }
}

// ── Edge cases: hand-seeded exposures pinning specific branches ──

// Empty user → maxNew = 4 path (a duplicate of lesson 1's branch, pinned explicitly).
localStorage.clear();
capture('edge/empty', 777);

// Over-cap → maxNew = 0 (consolidation, no new intros). 13 cons stuck below identify/stars.
localStorage.clear();
{
  const seed = { _v2: true };
  for (const c of C.slice(0, 13)) {
    seed[c.abbr] = { 'identify/diagram': { seen: 3, correct: 2, lastSeen: mockNow - 48 * HOUR } };
  }
  localStorage.setItem('con-exposure', JSON.stringify(seed));
  capture('edge/over-cap', 888);
}

// Deep progression → knob ramp (autocomplete prob, distanceLevel) and find/photo tiers.
localStorage.clear();
{
  const seed = { _v2: true };
  for (const c of C.slice(0, 8)) {
    const e = {};
    for (const k of TIER_KEYS) e[k] = { seen: 6, correct: 5, lastSeen: mockNow - 12 * HOUR };
    seed[c.abbr] = e;
  }
  localStorage.setItem('con-exposure', JSON.stringify(seed));
  capture('edge/deep', 999);
}

// ── Emit ───────────────────────────────────────────────────
const outPath = path.join(__dirname, 'lesson-golden.json');
fs.writeFileSync(outPath, JSON.stringify({ _format: 1, entries }, null, 2));
origLog(`Captured ${entries.length} golden lessons → ${path.relative(path.join(__dirname, '..'), outPath)}`);
origLog(`  sequence: 25 lessons, edges: empty, over-cap, deep`);
