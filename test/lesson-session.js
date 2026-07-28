#!/usr/bin/env node
// Verify the Candidate-3 extraction of lesson-session persistence (js/lesson-session.js).
//
//   1. GOLDEN EQUIVALENCE — replay test/session-golden.json (captured from the
//      pre-refactor saveLessonSession/tryResumeLesson) through the pure
//      sessionToJSON/sessionFromJSON and assert identical output. Proves the
//      extraction changed nothing.
//   2. INVARIANTS — round-trip stability, con↔abbr fidelity, validation rules.
//
// Run:  node test/lesson-session.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const buildScenarios = require('./session-scenarios');

// Minimal stubs (data.js touches these at load; the module itself is pure).
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
global.window = { devicePixelRatio: 1 };
const origLog = console.log;
console.log = () => {};
const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'lesson-session.js'), 'utf8'), { filename: 'lesson-session.js' });
console.log = origLog;

const failures = [];
function check(name, ok, detail) {
  if (ok) origLog(`OK: ${name}`);
  else { failures.push(name); origLog(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')); }
}

// Normalize through JSON so undefined-valued keys drop exactly as sessionStorage would.
const norm = o => JSON.parse(JSON.stringify(o));

// Snapshot restored fields with con→abbr, matching the capture harness shape.
function snapshotRestored(r) {
  return {
    lessonLabel: r.lessonLabel,
    idx: r.idx,
    correct: r.correct,
    lessonIdx: 0,          // adapter always sets this; capture snapshot has it too
    answered: false,
    viewMode: false,
    questions: r.questions.map(q => ({
      abbr: q.con.abbr, type: q.type, mode: q.mode, answerMode: q.answerMode ?? null,
      distanceLevel: q.distanceLevel ?? null, noBounds: q.noBounds ?? null,
      rotation: q.rotation ?? null,
      startP: q.startP ?? null, startFov: q.startFov ?? null,
      choices: q.choices ? q.choices.map(c => c?.abbr ?? c) : null,
    })),
    history: (r.history || []).map(h => h ? {
      ...h,
      chosen: h.chosen?.abbr ?? (h.chosen ?? null),
      choices: (h.choices || []).map(c => c?.abbr ?? c),
    } : null),
    revState: r.revState ? { ...r.revState } : null,
    eqRevState: r.eqRevState ? { ...r.eqRevState } : null,
  };
}

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'session-golden.json'), 'utf8'));
const { serializeCases, resumeCases } = buildScenarios(C);

// ═══════════════════════════════════════════════════════════
// 1. GOLDEN EQUIVALENCE
// ═══════════════════════════════════════════════════════════
origLog('── Serialize golden ────────────────────────────');
for (let i = 0; i < serializeCases.length; i++) {
  const c = serializeCases[i], g = golden.serialize[i];
  // Adapter policy: only an active lesson (lessonIdx != null) persists.
  const produced = c.session.lessonIdx == null
    ? null
    : norm(sessionToJSON(c.session, c.revState, c.eqRevState));
  check(`serialize[${c.name}] matches golden`,
    JSON.stringify(produced) === JSON.stringify(g.expected),
    `\n    golden:   ${JSON.stringify(g.expected)}\n    produced: ${JSON.stringify(produced)}`);
}

origLog('── Resume golden ───────────────────────────────');
for (let i = 0; i < resumeCases.length; i++) {
  const c = resumeCases[i], g = golden.resume[i];
  const restored = sessionFromJSON(c.payload, C);
  const ret = !!restored;
  check(`resume[${c.name}] return value matches golden`, ret === g.ret,
    `got ${ret}, golden ${g.ret}`);
  if (g.ret) {
    const snap = norm(snapshotRestored(restored));
    // Reveal defaults: capture starts reveal globals at all-true, then applies the
    // payload's reveal keys over them. Mirror that so the snapshot is comparable.
    const base = { photo: true, diagram: true, art: true, boundary: true };
    snap.revState = { ...base, ...(restored.revState || {}) };
    snap.eqRevState = { ...base, ...(restored.eqRevState || {}) };
    check(`resume[${c.name}] restored state matches golden`,
      JSON.stringify(snap) === JSON.stringify(g.snapshot),
      `\n    golden:   ${JSON.stringify(g.snapshot)}\n    restored: ${JSON.stringify(snap)}`);
  }
}

// ═══════════════════════════════════════════════════════════
// 2. INVARIANTS
// ═══════════════════════════════════════════════════════════
origLog('── Invariants ──────────────────────────────────');

// Round-trip: serialize → deserialize → serialize is stable, and cons resolve back.
for (const c of serializeCases) {
  if (c.session.lessonIdx == null) continue;
  const json1 = norm(sessionToJSON(c.session, c.revState, c.eqRevState));
  const restored = sessionFromJSON(json1, C);
  check(`[${c.name}] round-trips back to a valid session`, !!restored);
  const json2 = norm(sessionToJSON(
    { ...c.session, questions: restored.questions, history: restored.history },
    restored.revState, restored.eqRevState));
  check(`[${c.name}] serialize is a fixed point after round-trip`,
    JSON.stringify(json1) === JSON.stringify(json2));
  check(`[${c.name}] every restored question carries a real con`,
    restored.questions.every(q => q.con && q.con.abbr));
}

// Validation rules.
check('sessionFromJSON(null) → null', sessionFromJSON(null, C) === null);
check('wrong version → null',
  sessionFromJSON({ _v: 1, lessonLabel: 'x', questions: [] }, C) === null);
check('missing lessonLabel → null',
  sessionFromJSON({ _v: 2, lessonLabel: '', questions: [] }, C) === null);
check('any unresolvable abbr → whole-session null',
  sessionFromJSON({ _v: 2, lessonLabel: 'x',
    questions: [{ abbr: 'Ori', type: 'identify', mode: 'diagram' },
                { abbr: 'NOPE', type: 'identify', mode: 'diagram' }] }, C) === null);

// Purity: sessionToJSON must not mutate its inputs.
{
  const c = serializeCases[1];
  const before = JSON.stringify(c.session.questions.map(q => q.con.abbr));
  sessionToJSON(c.session, c.revState, c.eqRevState);
  check('sessionToJSON does not mutate the session',
    JSON.stringify(c.session.questions.map(q => q.con.abbr)) === before);
}

origLog('');
if (failures.length === 0) { origLog(`✅ ALL PASSED (${golden.serialize.length} serialize + ${golden.resume.length} resume goldens + invariants)`); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
