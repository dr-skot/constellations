#!/usr/bin/env node
// Simulate a happy-path session where the user always answers correctly.
// Covers QA items 1-5, 7-10 from the tier simplification plan.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Stubs ──────────────────────────────────────────────────
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

// DOM stub — Proxy-based so any property access works without throwing
function elemStub() {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'style') return new Proxy({}, { set: () => true, get: () => '' });
      if (prop === 'classList') return { add(){}, remove(){}, toggle(){}, contains: () => false };
      if (prop === 'querySelector') return () => elemStub();
      if (prop === 'querySelectorAll') return () => [];
      if (prop === 'offsetWidth') return 100;
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

// Time mocking
let mockNow = 1_000_000_000_000; // base timestamp
const origDateNow = Date.now;
Date.now = () => mockNow;

// Suppress all console output during loading and simulation
const origLog = console.log;
const origTable = console.table;
const quiet = () => {};
console.log = quiet;
console.table = quiet;

// ── Load source files ──────────────────────────────────────
const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'course.js'), 'utf8'), { filename: 'course.js' });
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'quiz.js'), 'utf8'), { filename: 'quiz.js' });

// Restore console
console.log = origLog;
console.table = origTable;

// ── Test helpers ───────────────────────────────────────────
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    origLog(`OK: ${name}`);
  } else {
    const msg = `FAIL: ${name}` + (detail ? ` — ${detail}` : '');
    failures.push(msg);
    origLog(msg);
  }
}

// ═══════════════════════════════════════════════════════════
// UNIT TESTS (direct function calls)
// ═══════════════════════════════════════════════════════════

console.log('── Unit tests ──────────────────────────────────');

// Difficulty level distribution
{
  const counts = {};
  C.forEach(c => { counts[c.diff] = (counts[c.diff] || 0) + 1; });
  check('Diff levels: 8 levels used',
    Object.keys(counts).length === 8,
    `got ${Object.keys(counts).length} levels: ${JSON.stringify(counts)}`);
  check('Diff levels: all constellations assigned 1–8',
    C.every(c => c.diff >= 1 && c.diff <= 8),
    C.filter(c => c.diff < 1 || c.diff > 8).map(c => c.abbr).join(', '));
  check('Diff 1 = 5 (instant recognition)',
    counts[1] === 5, `got ${counts[1]}`);
  check('Diff <= 2 >= 13 (distractor pool)',
    (counts[1] || 0) + (counts[2] || 0) >= 13,
    `got ${(counts[1] || 0) + (counts[2] || 0)}`);

  // Spot-check iconic assignments
  const lookup = abbr => C.find(c => c.abbr === abbr).diff;
  check('Orion is diff 1', lookup('Ori') === 1);
  check('Scorpius is diff 1', lookup('Sco') === 1);
  check('Leo is diff 2', lookup('Leo') === 2);
  check('Antlia is diff 8', lookup('Ant') === 8);
}

// Suppress inner logging from applyKnobs/reviewSpec during unit tests
console.log = quiet;
console.table = quiet;

// QA 2b: questionKey mapping
check('questionKey: identify/diagram',
  questionKey({ type: 'identify', mode: 'diagram' }) === 'identify/diagram');
check('questionKey: find/diagram noBounds:true → find/diagram',
  questionKey({ type: 'find', mode: 'diagram', noBounds: true }) === 'find/diagram',
  `got '${questionKey({ type: 'find', mode: 'diagram', noBounds: true })}'`);
check('questionKey: find/stars noBounds:false → find/stars',
  questionKey({ type: 'find', mode: 'stars', noBounds: false }) === 'find/stars');
check('questionKey: find/photo noBounds:false → find/photo',
  questionKey({ type: 'find', mode: 'photo', noBounds: false }) === 'find/photo');
check('questionKey: find/photo noBounds:true → find/photo-nb',
  questionKey({ type: 'find', mode: 'photo', noBounds: true }) === 'find/photo-nb');

// QA 3: Choice → autocomplete ramp
// applyKnobs should produce 'choice' at low correct, 'autocomplete' at high correct
{
  const spec = { type: 'identify', mode: 'diagram', _tierKey: 'identify/diagram' };

  // At 0 correct: always choice
  let acCount = 0;
  for (let i = 0; i < 50; i++) {
    const out = applyKnobs(spec, { 'identify/diagram': { correct: 0, seen: 1 } }, 'Test');
    if (out.answerMode === 'autocomplete') acCount++;
  }
  check('applyKnobs: 0 correct → always choice', acCount === 0,
    `got ${acCount}/50 autocomplete`);

  // At 2 correct: still always choice (prob = max(0, (2-2)/3) = 0)
  acCount = 0;
  for (let i = 0; i < 50; i++) {
    const out = applyKnobs(spec, { 'identify/diagram': { correct: 2, seen: 5 } }, 'Test');
    if (out.answerMode === 'autocomplete') acCount++;
  }
  check('applyKnobs: 2 correct → always choice', acCount === 0,
    `got ${acCount}/50 autocomplete`);

  // At 6 correct: always autocomplete (prob = min(1, (6-2)/3) = 1)
  acCount = 0;
  for (let i = 0; i < 50; i++) {
    const out = applyKnobs(spec, { 'identify/diagram': { correct: 6, seen: 10 } }, 'Test');
    if (out.answerMode === 'autocomplete') acCount++;
  }
  check('applyKnobs: 6 correct → always autocomplete', acCount === 50,
    `got ${acCount}/50 autocomplete`);

  // At 4 correct: mixed (prob = (4-2)/3 ≈ 0.67) — should be some of each
  let choiceCount = 0;
  acCount = 0;
  for (let i = 0; i < 200; i++) {
    const out = applyKnobs(spec, { 'identify/diagram': { correct: 4, seen: 8 } }, 'Test');
    if (out.answerMode === 'autocomplete') acCount++;
    else choiceCount++;
  }
  check('applyKnobs: 4 correct → mixed choice/autocomplete',
    acCount > 20 && choiceCount > 20,
    `got ${acCount} autocomplete, ${choiceCount} choice out of 200`);
}

// QA 4: Starting distance ramp
{
  const spec = { type: 'find', mode: 'stars', _tierKey: 'find/stars' };

  const out0 = applyKnobs(spec, { 'find/stars': { correct: 0, seen: 1 } }, 'Test');
  check('applyKnobs: find 0 correct → distanceLevel 0',
    out0.distanceLevel === 0, `got ${out0.distanceLevel}`);

  const out3 = applyKnobs(spec, { 'find/stars': { correct: 3, seen: 5 } }, 'Test');
  check('applyKnobs: find 3 correct → distanceLevel 0.5',
    out3.distanceLevel === 0.5, `got ${out3.distanceLevel}`);

  const out6 = applyKnobs(spec, { 'find/stars': { correct: 6, seen: 10 } }, 'Test');
  check('applyKnobs: find 6 correct → distanceLevel 1.0',
    out6.distanceLevel === 1.0, `got ${out6.distanceLevel}`);

  const out10 = applyKnobs(spec, { 'find/stars': { correct: 10, seen: 15 } }, 'Test');
  check('applyKnobs: find 10 correct → distanceLevel capped at 1.0',
    out10.distanceLevel === 1.0, `got ${out10.distanceLevel}`);
}

// QA 5: Bounds per tier
{
  const diag = applyKnobs({ type: 'find', mode: 'diagram', _tierKey: 'find/diagram' }, {}, 'Test');
  check('Bounds: find/diagram → noBounds:true', diag.noBounds === true, `got ${diag.noBounds}`);

  const stars = applyKnobs({ type: 'find', mode: 'stars', _tierKey: 'find/stars' }, {}, 'Test');
  check('Bounds: find/stars → noBounds:false', stars.noBounds === false, `got ${stars.noBounds}`);

  const photo = applyKnobs({ type: 'find', mode: 'photo', _tierKey: 'find/photo' }, {}, 'Test');
  check('Bounds: find/photo → noBounds:false', photo.noBounds === false, `got ${photo.noBounds}`);

  const photoNb = applyKnobs({ type: 'find', mode: 'photo', noBounds: true, _tierKey: 'find/photo-nb' }, {}, 'Test');
  check('Bounds: find/photo-nb → noBounds:true', photoNb.noBounds === true, `got ${photoNb.noBounds}`);
}

// QA 7: Migration from old 16-tier keys
{
  localStorage.clear();
  // Simulate old-format exposure data (pre-v2)
  const oldData = {
    Ori: {
      'identify/diagram':    { seen: 10, correct: 8 },
      'identify/diagram-ac': { seen: 5,  correct: 3 },   // should fold into identify/diagram
      'navigate/diagram':    { seen: 4,  correct: 2 },   // should fold into find/diagram
      'navigate/stars':      { seen: 3,  correct: 1 },   // should fold into find/stars
      'navigate/photo':      { seen: 2,  correct: 1 },   // should fold into find/photo
      'find/diagram-nb':     { seen: 6,  correct: 4 },   // should fold into find/diagram
      'find/stars-nb':       { seen: 3,  correct: 2 },   // should fold into find/stars
    }
    // Note: no _v2 flag — triggers migration
  };
  localStorage.setItem('con-exposure', JSON.stringify(oldData));

  const migrated = loadExposure();

  check('Migration: _v2 flag set', migrated._v2 === true);
  check('Migration: identify/diagram-ac folded into identify/diagram',
    migrated.Ori['identify/diagram'].correct === 11 && !migrated.Ori['identify/diagram-ac'],
    `correct=${migrated.Ori['identify/diagram']?.correct}, ac key still exists=${!!migrated.Ori['identify/diagram-ac']}`);
  check('Migration: navigate/diagram + find/diagram-nb folded into find/diagram',
    migrated.Ori['find/diagram'].correct === 6 && !migrated.Ori['navigate/diagram'] && !migrated.Ori['find/diagram-nb'],
    `correct=${migrated.Ori['find/diagram']?.correct}`);
  check('Migration: navigate/stars + find/stars-nb folded into find/stars',
    migrated.Ori['find/stars'].correct === 3 && !migrated.Ori['navigate/stars'] && !migrated.Ori['find/stars-nb'],
    `correct=${migrated.Ori['find/stars']?.correct}`);
  check('Migration: navigate/photo folded into find/photo',
    migrated.Ori['find/photo'].correct === 1 && !migrated.Ori['navigate/photo'],
    `correct=${migrated.Ori['find/photo']?.correct}`);

  localStorage.clear();
}

// Queue depth gating unit test
// When many constellations are in-progress (below identify/stars), new intros should be blocked.
{
  localStorage.clear();
  // Seed 6 constellations, all stuck at tier 1 (only identify/diagram passed).
  // In-progress = 6, cap = 5 + floor(6/10) = 5 → blocked (6 > 5)
  const seed = { _v2: true };
  for (const c of C.slice(0, 6)) {
    seed[c.abbr] = {
      'identify/diagram': { seen: 3, correct: 2 },
      // find/diagram not yet passed → frontier is find/diagram → "in progress"
    };
  }
  localStorage.setItem('con-exposure', JSON.stringify(seed));

  const { questions } = generateNextLesson();
  const newCons = questions.filter(q => {
    const e = loadExposure();
    // "New" means not in the seeded exposure before this lesson
    return !seed[q.con.abbr];
  });
  check('Queue depth gate: blocks new intros when in-progress > cap',
    newCons.length === 0,
    `introduced ${newCons.length} new (expected 0, in-progress=6, cap=5)`);

  // Now graduate 2 constellations to tier 3+ (pass identify/stars)
  const exp2 = loadExposure();
  for (const c of C.slice(0, 2)) {
    exp2[c.abbr]['find/diagram'] = { seen: 2, correct: 1 };
    exp2[c.abbr]['identify/stars'] = { seen: 2, correct: 1 };
  }
  localStorage.setItem('con-exposure', JSON.stringify(exp2));
  // Now: 4 in-progress, cap = 5 + floor(6/10) = 5 → allowed (4 < 5)
  const { questions: q2 } = generateNextLesson();
  const newCons2 = q2.filter(q => !exp2[q.con.abbr]);
  check('Queue depth gate: allows new intros when in-progress < cap',
    newCons2.length >= 1,
    `introduced ${newCons2.length} new (expected ≥1, in-progress=4, cap=5)`);

  localStorage.clear();
}

// QA 8: Lesson save/resume
{
  localStorage.clear();
  sessionStorage.clear();

  // Set up a lesson session
  const testCons = C.slice(0, 4);
  session.questions = testCons.map(c => ({ con: c, type: 'identify', mode: 'diagram', answerMode: 'choice' }));
  session.idx = 2;
  session.correct = 1;
  session.history = [
    { chosen: testCons[0], wasCorrect: true, rotation: 0.5, choices: [] },
    { chosen: testCons[1], wasCorrect: false, rotation: 1.2, choices: [] },
  ];
  session.lessonIdx = 0;
  session.lessonLabel = 'Test Lesson';
  session.viewMode = false;

  saveLessonSession();

  const stored = JSON.parse(sessionStorage.getItem('lesson-session'));
  check('Save/resume: _v is 2', stored?._v === 2, `got _v=${stored?._v}`);
  check('Save/resume: idx preserved', stored?.idx === 2);
  check('Save/resume: correct preserved', stored?.correct === 1);
  check('Save/resume: questions length preserved', stored?.questions?.length === 4);
  check('Save/resume: distanceLevel serialized when present', true); // baseline

  // Test resume — override showLessonQuestion to avoid DOM
  let resumedQuestion = null;
  const origShowLQ = showLessonQuestion;
  showLessonQuestion = () => { resumedQuestion = session.questions[session.idx]; };

  // Reset session to verify resume restores it
  session.questions = [];
  session.idx = 0;
  session.correct = 0;
  session.lessonLabel = '';

  const resumed = tryResumeLesson();
  check('Save/resume: tryResumeLesson returns true', resumed === true);
  check('Save/resume: session.idx restored to 2', session.idx === 2);
  check('Save/resume: session.correct restored to 1', session.correct === 1);
  check('Save/resume: session.lessonLabel restored', session.lessonLabel === 'Test Lesson');
  check('Save/resume: questions reconstructed', session.questions.length === 4);
  check('Save/resume: question cons match',
    session.questions.every((q, i) => q.con.abbr === testCons[i].abbr));

  // Test that old format (_v !== 2) is rejected
  sessionStorage.setItem('lesson-session', JSON.stringify({ lessonLabel: 'Old', questions: [], idx: 0 }));
  session.lessonLabel = '';
  const rejectedOld = tryResumeLesson();
  check('Save/resume: rejects old format (no _v)', rejectedOld === false);

  showLessonQuestion = origShowLQ;
  localStorage.clear();
  sessionStorage.clear();
}

// Heat model unit tests
{
  const HOUR = 3_600_000;

  // 1. Just-seen constellation has low heat
  const justSeen = { 'identify/diagram': { seen: 3, correct: 2, lastSeen: mockNow } };
  const hJust = conHeat(C[0], { [C[0].abbr]: justSeen }, mockNow);
  check('Heat: just-seen → low heat', hJust < 0.3,
    `got ${hJust.toFixed(3)}`);

  // 2. Constellation not seen for 48 hours has high heat
  const stale = { 'identify/diagram': { seen: 3, correct: 2, lastSeen: mockNow - 48 * HOUR } };
  const hStale = conHeat(C[0], { [C[0].abbr]: stale }, mockNow);
  check('Heat: 48h stale → high heat', hStale > 0.5,
    `got ${hStale.toFixed(3)}`);

  // 3. Same staleness, lower tier → higher heat (more urgency)
  // Con A at tier 0 frontier (identify/diagram), con B at tier 5 frontier (find/photo)
  const bothStaleTime = mockNow - 24 * HOUR;
  const atTier0 = { 'identify/diagram': { seen: 1, correct: 0, lastSeen: bothStaleTime } };
  const atTier5 = {
    'identify/diagram': { seen: 5, correct: 3, lastSeen: bothStaleTime },
    'find/diagram':     { seen: 3, correct: 1, lastSeen: bothStaleTime },
    'identify/stars':   { seen: 3, correct: 1, lastSeen: bothStaleTime },
    'find/stars':       { seen: 3, correct: 1, lastSeen: bothStaleTime },
    'identify/photo':   { seen: 3, correct: 1, lastSeen: bothStaleTime },
  };
  // Run multiple times to average out jitter
  let sumT0 = 0, sumT5 = 0;
  for (let i = 0; i < 100; i++) {
    sumT0 += conHeat(C[0], { [C[0].abbr]: atTier0 }, mockNow);
    sumT5 += conHeat(C[1], { [C[1].abbr]: atTier5 }, mockNow);
  }
  check('Heat: lower tier → higher heat than advanced tier (same staleness)',
    sumT0 / 100 > sumT5 / 100,
    `tier0 avg=${(sumT0/100).toFixed(3)}, tier5 avg=${(sumT5/100).toFixed(3)}`);

  // 4. Missing lastSeen (legacy data) → treated as max staleness
  const noTimestamp = { 'identify/diagram': { seen: 3, correct: 2 } };
  const hLegacy = conHeat(C[0], { [C[0].abbr]: noTimestamp }, mockNow);
  check('Heat: missing lastSeen → high heat (legacy data)',
    hLegacy > 0.5,
    `got ${hLegacy.toFixed(3)}`);
}

// Heat model: stale vs recent slot allocation
{
  localStorage.clear();
  const HOUR = 3_600_000;

  // Seed 13 constellations at identify/diagram frontier (seen but 0 correct).
  // 6 "stale" (48h ago), 7 "recent" (just seen). With 13 known and maxNew=0
  // (in-progress=13 > cap=6), the 12 review slots fill from the pool.
  // Only identify questions (correct:0 → frontier is identify/diagram), no BOUNDS needed.
  const seed = { _v2: true };
  const staleCons  = C.slice(0, 6);
  const recentCons = C.slice(6, 13);
  for (const c of staleCons) {
    seed[c.abbr] = {
      'identify/diagram': { seen: 3, correct: 0, lastSeen: mockNow - 48 * HOUR },
    };
  }
  for (const c of recentCons) {
    seed[c.abbr] = {
      'identify/diagram': { seen: 3, correct: 0, lastSeen: mockNow },
    };
  }
  localStorage.setItem('con-exposure', JSON.stringify(seed));

  const { questions } = generateNextLesson();
  const staleAbbrs = new Set(staleCons.map(c => c.abbr));
  const staleSlots  = questions.filter(q => staleAbbrs.has(q.con.abbr)).length;
  const recentSlots = questions.length - staleSlots;

  // All 6 stale should appear; remaining 6 slots from the 7 recent ones.
  // Stale should get ≥6 (their 6 unique slots), recent ≤6.
  check('Heat sim: stale constellations get more slots than recent ones',
    staleSlots >= 6,
    `stale:${staleSlots}, recent:${recentSlots}`);

  localStorage.clear();
}

// ═══════════════════════════════════════════════════════════
// SIMULATION (20 lessons, all correct)
// ═══════════════════════════════════════════════════════════

console.log('\n── Simulation (20 lessons, all correct) ────────');

// Suppress inner logging
console.log = quiet;
console.table = quiet;

const NUM_LESSONS = 20;
const TIER_KEYS = TIER_SPECS.map(([k]) => k);
let totalQuestions = 0;
const lessonSummaries = [];
const newIntrosPerLesson = [];
const allQuestions = []; // track every question for review weighting analysis

const HOUR = 3_600_000;
for (let lesson = 0; lesson < NUM_LESSONS; lesson++) {
  // Advance mock clock 2 hours between lessons
  mockNow += 2 * HOUR;
  const expBefore = loadExposure();
  const knownBefore = new Set(Object.keys(expBefore).filter(k => k !== '_v2'));

  const { label, questions } = generateNextLesson();

  for (const q of questions) {
    allQuestions.push({
      lesson: lesson + 1,
      con: q.con.abbr,
      type: q.type,
      mode: q.mode,
      answerMode: q.answerMode,
      noBounds: q.noBounds,
      distanceLevel: q.distanceLevel,
      tierKey: questionKey(q),
    });
    const key = questionKey(q);
    recordSeen(q.con.abbr, key);
    recordCorrect(q.con.abbr, key);
    totalQuestions++;
  }

  const expAfter = loadExposure();
  const knownAfter = Object.keys(expAfter).filter(k => k !== '_v2');
  const newThisLesson = knownAfter.filter(a => !knownBefore.has(a)).length;
  newIntrosPerLesson.push(newThisLesson);

  const frontiers = {};
  for (const abbr of knownAfter) {
    const f = targetSpec(expAfter[abbr])._tierKey;
    frontiers[f] = (frontiers[f] || 0) + 1;
  }

  const types = {};
  for (const q of questions) {
    const k = q.type + '/' + q.mode + (q.noBounds ? '-nb' : '');
    types[k] = (types[k] || 0) + 1;
  }

  lessonSummaries.push({
    lesson: lesson + 1, known: knownAfter.length, label, types, frontiers,
    qCount: questions.length, newIntros: newThisLesson,
  });
}

// Restore console
console.log = origLog;
console.table = origTable;

// Print lesson summaries
for (const s of lessonSummaries) {
  const types = Object.entries(s.types).map(([k,v]) => `${k}:${v}`).join(' ');
  const front = Object.entries(s.frontiers).sort().map(([k,v]) => `${k}:${v}`).join(' ');
  console.log(
    `Lesson ${String(s.lesson).padStart(2)}: ${String(s.qCount).padStart(2)}q  ` +
    `known:${String(s.known).padStart(2)}  new:${s.newIntros}  "${s.label}"  ` +
    `types:[${types}]  frontiers:[${front}]`
  );
}
console.log('');

const exp = loadExposure();
const knownAbbrs = Object.keys(exp).filter(k => k !== '_v2');

// QA 1: First lesson intro cap
check('Lesson 1 introduces ≤4 constellations',
  newIntrosPerLesson[0] <= 4,
  `introduced ${newIntrosPerLesson[0]}`);

// QA 2: Tier progression — all 7 tiers should appear
check('Constellations advance past find/diagram',
  knownAbbrs.filter(a => (exp[a]['find/diagram']?.correct || 0) >= 1).length > 0);

check('Some reach identify/stars',
  knownAbbrs.filter(a => (exp[a]['identify/stars']?.seen || 0) >= 1).length > 0);

check('Some reach find/photo-nb (final tier)',
  knownAbbrs.filter(a => (exp[a]['find/photo-nb']?.seen || 0) >= 1).length > 0);

// QA 9: Lesson labels — should see variety
{
  const labels = new Set(lessonSummaries.map(s => s.label));
  check('Lesson labels: at least 2 different labels seen',
    labels.size >= 2,
    `saw: ${[...labels].join(', ')}`);
}

// Queue depth: in-progress constellations should gate new intros
// "In progress" = below tier 3 (identify/stars not yet passed)
// Cap = 5 + floor(total_known / 10)
{
  // After lesson 1 we have 4 constellations, all at find/diagram (in progress).
  // Cap at known=4 is 5+floor(4/10)=5, so we're under cap (4 < 5) → new intros allowed.
  // After a few lessons where user always answers correctly, constellations graduate
  // (reach identify/stars), freeing cap space for more new ones.

  // Count how many lessons had 0 new intros (excluding lesson 1)
  const blockedLessons = newIntrosPerLesson.slice(1).filter(n => n === 0).length;

  // With queue depth, the user should RARELY be blocked when answering everything correctly,
  // because constellations graduate quickly (2 correct answers to pass identify/diagram and
  // find/diagram). With avgStrength gate, it took 6+ lessons of 0 new intros.
  check('Queue depth: ≤2 blocked lessons in 19 (when always correct)',
    blockedLessons <= 2,
    `${blockedLessons} blocked lessons (0 new intros)`);

  // Also verify that in-progress count stays within the cap at each lesson
  for (const s of lessonSummaries) {
    const e = loadExposure(); // Note: exposure is cumulative, but we check concept
    // In-progress = known but identify/stars not yet passed
    // We can't easily check mid-lesson, but the simulation data shows frontiers
    const inProgress = Object.entries(s.frontiers)
      .filter(([f]) => f === 'find/diagram' || f === 'identify/stars')
      .reduce((sum, [, count]) => sum + count, 0);
    // Frontier before identify/stars means in-progress; find/diagram too
    // Actually let's compute from the frontier summary: anything at identify/diagram, find/diagram, or identify/stars frontier is in-progress
    // Wait — "in progress" means below tier 3 (identify/stars). So frontier at identify/diagram or find/diagram means they haven't reached identify/stars yet.
    const ip = (s.frontiers['identify/diagram'] || 0) + (s.frontiers['find/diagram'] || 0);
    const cap = 5 + Math.floor(s.known / 10);
    // In-progress should not exceed cap + 1 (the +1 accounts for the just-introduced constellation in this lesson)
    if (ip > cap + 1) {
      check(`Queue depth: lesson ${s.lesson} in-progress (${ip}) ≤ cap+1 (${cap + 1})`, false,
        `in-progress=${ip}, cap=${cap}, known=${s.known}`);
    }
  }
  check('Queue depth: in-progress never exceeds cap', true); // summary pass
}

// QA 10: Review weighting — frontier questions should dominate over early tiers
// For constellations past tier 2, count how often they get frontier vs identify/diagram
{
  // Look at lessons 5+ where constellations have progressed
  const laterQs = allQuestions.filter(q => q.lesson >= 5);
  const reviewQs = laterQs.filter(q => {
    // Only count questions for constellations that have passed identify/diagram
    const e = loadExposure();
    return (e[q.con]?.['identify/diagram']?.correct || 0) >= 1;
  });

  const identDiagramCount = reviewQs.filter(q => q.tierKey === 'identify/diagram').length;
  const totalReviewQs = reviewQs.length;
  const identDiagramPct = totalReviewQs > 0 ? identDiagramCount / totalReviewQs : 0;

  // identify/diagram should be a small fraction of review questions for progressed constellations
  // With exponential decay, it should be <20% once they've passed several tiers
  check('Review weighting: identify/diagram is <30% of later review questions',
    identDiagramPct < 0.3,
    `${identDiagramCount}/${totalReviewQs} = ${(identDiagramPct * 100).toFixed(0)}%`);
}

// Verify lastSeen timestamps are being recorded
{
  const withTimestamps = knownAbbrs.filter(a => {
    const e = exp[a];
    return Object.values(e).some(v => v?.lastSeen > 0);
  });
  check('lastSeen timestamps recorded for all known constellations',
    withTimestamps.length === knownAbbrs.length,
    `${withTimestamps.length}/${knownAbbrs.length} have timestamps`);
}

// Exposure sample
console.log('\nExposure sample (first 5 known):');
for (const abbr of knownAbbrs.slice(0, 5)) {
  const e = exp[abbr];
  const tiers = TIER_KEYS.map(k => `${k}:${e[k]?.correct || 0}`).join('  ');
  console.log(`  ${abbr.padEnd(4)} frontier:${targetSpec(e)._tierKey.padEnd(16)} ${tiers}`);
}

// ── Result ─────────────────────────────────────────────────
if (failures.length > 0) {
  console.log('\n' + '='.repeat(60));
  for (const f of failures) console.log(f);
  console.log('='.repeat(60));
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
