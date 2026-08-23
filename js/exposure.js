// js/exposure.js
// The learner's EXPOSURE record: what they have been shown and what they got right, per
// constellation, per tier.
//
// It is the only thing this app stores that it cannot regenerate. A lesson, a reveal, a
// guide position can all be rebuilt from the catalog; what somebody has practised exists
// nowhere else. It used to live in js/course.js — the file named for the course SCREEN —
// read from four other files, with "Reset all progress" reaching past all of it to
// localStorage.removeItem.
//
// Shape:  { _v2: true, <abbr>: { <tierKey>: { seen, correct, lastSeen } } }
//
// The store is a PORT. It defaults to localStorage, which is the real one and the right
// one — unlike guideStart's roll or prepareGuide's origin, where any default would have
// been wrong, a caller that never injects here gets correct production behaviour. Tests
// inject an in-memory stand-in so a scenario can own its own record.

const EXPOSURE_KEY = 'con-exposure';

let _store = null;

function initExposure({ store } = {}) {
  _store = store || null;
}

// localStorage is read lazily rather than captured at load, so a test that stubs the global
// before loading this file still works, and so does a page that never calls initExposure.
function _exposureStore() {
  return _store || (typeof localStorage !== 'undefined' ? localStorage : null);
}

// ── Reading ──────────────────────────────────────────────────────────────────
// Migrates on read, and PERSISTS the migration as it goes. A write inside a getter is
// surprising, and it is the right trade here: migrating in memory only would re-run the
// fold on every load until the learner happened to answer something, and leave the old
// keys in their browser indefinitely.
function loadExposure() {
  const store = _exposureStore();
  try {
    const raw = JSON.parse(store.getItem(EXPOSURE_KEY)) || {};
    if (!raw._v2) return _migrateExposure(raw);
    return raw;
  } catch { return { _v2: true }; }
}

// Private. With the calibration seed adapter now inside this module, nothing outside needs
// to write the record — and a public save is an invitation to do load-mutate-save at the
// call site, which is the pattern this module exists to hold. Private, it is true by
// construction that resetExposure() and the two recorders are the only ways in.
function _saveExposure(data) {
  _exposureStore().setItem(EXPOSURE_KEY, JSON.stringify(data));
}

// True when a record holds no real progress — only the `_v2` marker, or nothing. Pure, and
// takes a record rather than reading one, because callers ask it of snapshots as well as of
// the live record (the level-check payoff compares before and after).
function exposureIsEmpty(exposure) {
  return Object.keys(exposure).filter(k => k !== '_v2').length === 0;
}

// One-time migration: fold old 16-tier keys into the new 7-tier keys.
function _migrateExposure(old) {
  const foldMap = {
    'identify/diagram-ac': 'identify/diagram',
    'identify/stars-ac':   'identify/stars',
    'identify/photo-ac':   'identify/photo',
    'find/diagram-nb':     'find/diagram',
    'find/stars-nb':       'find/stars',
    'navigate/diagram':    'find/diagram',
    'navigate/stars':      'find/stars',
    'navigate/photo':      'find/photo',
    'navigate/photo-nb':   'find/photo-nb',
  };
  for (const abbr of Object.keys(old)) {
    const e = old[abbr];
    if (!e || typeof e !== 'object') continue;
    for (const [src, dst] of Object.entries(foldMap)) {
      if (!e[src]) continue;
      if (!e[dst]) e[dst] = { seen: 0, correct: 0 };
      e[dst].seen    += e[src].seen    || 0;
      e[dst].correct += e[src].correct || 0;
      delete e[src];
    }
  }
  old._v2 = true;
  _saveExposure(old);
  return old;
}

// ── Recording ────────────────────────────────────────────────────────────────
// Load, mutate, save — per call, deliberately. Stateless means no cache to invalidate, no
// divergence from what a second tab sees, and an external write to the key stays visible,
// which test/sim-lessons.js depends on in nine places.

function _entry(data, abbr, key) {
  if (!data[abbr]) data[abbr] = {};
  if (!data[abbr][key]) data[abbr][key] = { seen: 0, correct: 0 };
  return data[abbr][key];
}

// Fires on the transition into `asked` — the question was PUT TO the learner (#77).
// Stamps `lastSeen`, which is what heat decays from.
function recordSeen(abbr, key) {
  const data = loadExposure();
  const e = _entry(data, abbr, key);
  e.seen++;
  e.lastSeen = Date.now();
  console.log(`[expo] seen ${abbr} ${key} → ${e.seen}`);
  _saveExposure(data);
}

// Deliberately does NOT stamp lastSeen. Every correct answer is preceded by recordSeen on
// the same question, which already set it; and the calibration seed credits `correct`
// without a lastSeen on purpose, so seeded constellations stay hot in the review queue.
// Stamping it here would quietly cool them.
function recordCorrect(abbr, key) {
  const data = loadExposure();
  const e = _entry(data, abbr, key);
  e.correct++;
  console.log(`[expo] correct ${abbr} ${key} → ${e.correct}`);
  _saveExposure(data);
}

// Apply an arbitrary edit as one load-modify-save. The caller supplies WHAT to change;
// this owns the storage around it.
//
// The level check's seeding is the one user: it credits every constellation at or below
// D*, which is level-check knowledge this module deliberately does not have. Moving that
// adapter in here would have meant exposure.js calling applyCalibrationSeed — the record
// importing from the level check, which is backwards. This inverts it: the level check
// keeps its own rule and hands the edit in.
//
// It is not a public save in disguise. saveExposure took a record the caller had loaded
// earlier and might have let go stale; this brackets the edit between a fresh read and the
// write, so there is no window to hold a record across.
function updateExposure(mutate) {
  const data = loadExposure();
  mutate(data);
  _saveExposure(data);
  return data;
}

// ── Erasing ──────────────────────────────────────────────────────────────────
// A verb rather than a key. "Reset all progress" used to name 'con-exposure' itself, in a
// file that owns nothing about the record.
function resetExposure() {
  _exposureStore().removeItem(EXPOSURE_KEY);
}
