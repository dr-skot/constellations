#!/usr/bin/env node
// Capture a behavior golden for lesson-session persistence BEFORE the Candidate-3
// extraction. Runs the current (pre-refactor) saveLessonSession/tryResumeLesson and
// records exactly what they produce, so test/lesson-session.js can prove the
// extracted sessionToJSON/sessionFromJSON reproduce it byte-for-byte.
//
// Run ONCE against unmodified quiz.js:  node test/capture-session-golden.js
// Commit the emitted test/session-golden.json.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const buildScenarios = require('./session-scenarios');

// ── Stubs ──────────────────────────────────────────────────
const ssStore = {};
global.sessionStorage = {
  getItem: k => ssStore[k] ?? null,
  setItem: (k, v) => { ssStore[k] = v; },
  removeItem: k => { delete ssStore[k]; },
  clear: () => { for (const k of Object.keys(ssStore)) delete ssStore[k]; },
};
const lsStore = {};
global.localStorage = {
  getItem: k => lsStore[k] ?? null, setItem: (k, v) => { lsStore[k] = v; },
  removeItem: k => { delete lsStore[k]; }, clear: () => {},
};
function elemStub() {
  return new Proxy({}, { get(_, p) {
    if (p === 'style') return new Proxy({}, { set: () => true, get: () => '' });
    if (p === 'classList') return { add(){}, remove(){}, toggle(){}, contains: () => false };
    if (p === 'focus' || p === 'appendChild' || p === 'addEventListener') return () => {};
    return '';
  }, set: () => true });
}
global.document = { getElementById: () => elemStub(), querySelector: () => elemStub(),
  querySelectorAll: () => [], createElement: () => elemStub() };
global.window = { devicePixelRatio: 1 };

const origLog = console.log;
console.log = () => {};

// ── Load unmodified source ─────────────────────────────────
const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'lesson.js'), 'utf8'), { filename: 'lesson.js' });
// Declare the reveal-state globals that render.js/explore.js would own, plus the
// toggle-group handles (null → tryResumeLesson skips the DOM application).
vm.runInThisContext('var revState, eqRevState, _revToggleGroup = null, _eqRevToggleGroup = null;');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'quiz.js'), 'utf8'), { filename: 'quiz.js' });
// Neutralize the DOM-heavy render call at the tail of tryResumeLesson.
vm.runInThisContext('showLessonQuestion = () => {};');

console.log = origLog;

const { serializeCases, resumeCases } = buildScenarios(C);

// Reset the live `session` object (a quiz.js `let`) to a scenario's shape.
function loadSession(s) {
  session.questions = s.questions;
  session.idx = s.idx;
  session.correct = s.correct;
  session.history = s.history;
  session.lessonIdx = s.lessonIdx;
  session.lessonLabel = s.lessonLabel;
  // session.answered is gone (#77) — the question carries its own state now. Nothing to
  // reset here; the vestigial snapshot field below is explained where it is emitted.
}

// Snapshot restored state with con→abbr so it is JSON-comparable.
function snapshotSession() {
  return {
    lessonLabel: session.lessonLabel,
    idx: session.idx,
    correct: session.correct,
    lessonIdx: session.lessonIdx,
    // Vestigial: session.answered was retired by #77, but the frozen snapshots in
    // session-golden.json carry the key. Emitting the constant it always held at this
    // point keeps a re-capture byte-comparable with the goldens captured before it.
    answered: false,
    questions: session.questions.map(q => ({
      abbr: q.con.abbr, type: q.type, mode: q.mode, answerMode: q.answerMode ?? null,
      distanceLevel: q.distanceLevel ?? null, noBounds: q.noBounds ?? null,
      rotation: q.rotation ?? null,
      startP: q.startP ?? null, startFov: q.startFov ?? null,
      choices: q.choices ? q.choices.map(c => c?.abbr ?? c) : null,
    })),
    history: (session.history || []).map(h => h ? {
      ...h,
      chosen: h.chosen?.abbr ?? (h.chosen ?? null),
      choices: (h.choices || []).map(c => c?.abbr ?? c),
    } : null),
    revState: typeof revState !== 'undefined' && revState ? { ...revState } : null,
    eqRevState: typeof eqRevState !== 'undefined' && eqRevState ? { ...eqRevState } : null,
  };
}

// ── Serialize golden ───────────────────────────────────────
const serialize = [];
for (const c of serializeCases) {
  sessionStorage.clear();
  loadSession(c.session);
  revState = c.revState;
  eqRevState = c.eqRevState;
  saveLessonSession();
  const stored = sessionStorage.getItem('lesson-session');
  serialize.push({ name: c.name, expected: stored ? JSON.parse(stored) : null });
}

// ── Resume golden ──────────────────────────────────────────
const resume = [];
for (const c of resumeCases) {
  sessionStorage.clear();
  if (c.payload !== null) sessionStorage.setItem('lesson-session', JSON.stringify(c.payload));
  // Reset reveal globals to defaults so restore effects are observable.
  revState = { photo: true, diagram: true, art: true, boundary: true };
  eqRevState = { photo: true, diagram: true, art: true, boundary: true };
  // Wipe session so a false return leaves stale state we can detect.
  loadSession({ questions: [], idx: -1, correct: -1, history: [], lessonIdx: null, lessonLabel: '' });
  const ret = tryResumeLesson();
  resume.push({ name: c.name, ret, snapshot: ret ? snapshotSession() : null });
}

const outPath = path.join(__dirname, 'session-golden.json');
fs.writeFileSync(outPath, JSON.stringify({ _format: 1, serialize, resume }, null, 2));
origLog(`Captured ${serialize.length} serialize + ${resume.length} resume goldens → ${path.relative(path.join(__dirname, '..'), outPath)}`);
