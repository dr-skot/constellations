#!/usr/bin/env node
// The learner's EXPOSURE record (js/exposure.js).
//
// The record is the only thing this app stores that it cannot regenerate: a lesson, a
// reveal, a guide position can all be rebuilt from the catalog, but what the learner has
// practised exists nowhere else. Until now it had no test of its own — its behaviour was
// asserted incidentally by test/calibration.js and test/sim-lessons.js, so a change to its
// shape surfaced as a failure in files named for the level check and the lesson simulator,
// pointing the next reader at the wrong module.
//
// The store is injected, so a scenario can run against its own record rather than a global.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const jsDir = path.join(root, 'js');

vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'exposure.js'), 'utf8'), { filename: 'exposure.js' });

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// An in-memory stand-in for localStorage. Counts writes, so a test can tell "read it back"
// from "wrote it again".
function makeStore(seed) {
  const data = Object.assign({}, seed);
  let writes = 0;
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { writes++; data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    _raw: () => data,
    _writes: () => writes,
  };
}
const stored = store => JSON.parse(store.getItem('con-exposure'));

// ── The v1 → v2 migration ────────────────────────────────────────────────────
// The fold that turns the old 16-tier keys into the 7-tier ones. It runs on READ and
// persists as it goes — a write inside a getter, kept deliberately: the alternative is
// re-folding on every load until the learner happens to answer something, leaving the old
// keys in their browser indefinitely. Until the store was injectable this could only be
// exercised through test/sim-lessons.js.
{
  const store = makeStore({
    'con-exposure': JSON.stringify({
      Ori: {
        'identify/diagram':    { seen: 3, correct: 2 },
        'identify/diagram-ac': { seen: 4, correct: 1 },   // folds into identify/diagram
        'navigate/photo-nb':   { seen: 2, correct: 2 },   // folds into find/photo-nb
      },
    }),
  });
  initExposure({ store });
  const got = loadExposure();

  check('the v1 fold sums counts into the v2 key',
        got.Ori['identify/diagram'].seen === 7 && got.Ori['identify/diagram'].correct === 3,
        JSON.stringify(got.Ori['identify/diagram']));
  check('the folded-away v1 key is gone', got.Ori['identify/diagram-ac'] === undefined);
  check('a rename with no existing target still lands',
        got.Ori['find/photo-nb'].seen === 2 && got.Ori['find/photo-nb'].correct === 2,
        JSON.stringify(got.Ori['find/photo-nb']));
  check('the record is stamped _v2', got._v2 === true);
  check('the fold persisted, so it happens once', stored(store)._v2 === true &&
        stored(store).Ori['identify/diagram-ac'] === undefined);
}

// A record already at v2 must not be re-folded, and must not be rewritten for nothing.
{
  const store = makeStore({
    'con-exposure': JSON.stringify({ _v2: true, Ori: { 'identify/diagram': { seen: 1, correct: 1 } } }),
  });
  initExposure({ store });
  loadExposure();
  check('a v2 record is not rewritten on read', store._writes() === 0, `${store._writes()} writes`);
}

// ── Recording ────────────────────────────────────────────────────────────────
{
  const store = makeStore({});
  initExposure({ store });
  const quiet = console.log; console.log = () => {};

  recordSeen('Ori', 'identify/diagram');
  recordSeen('Ori', 'identify/diagram');
  recordCorrect('Ori', 'identify/diagram');
  const e = loadExposure().Ori['identify/diagram'];
  console.log = quiet;

  check('seen counts each ask', e.seen === 2, JSON.stringify(e));
  check('correct counts separately from seen', e.correct === 1, JSON.stringify(e));
  check('recording an unseen constellation creates its entry',
        typeof e.seen === 'number' && typeof e.correct === 'number');
}

// recordSeen stamps lastSeen; recordCorrect must NOT. Heat decays from lastSeen, and the
// level check credits `correct` with no lastSeen on purpose so seeded constellations stay
// hot in the review queue. A recordCorrect that stamped it would quietly cool them — the
// asymmetry is load-bearing, not an oversight, so it is pinned here.
{
  const store = makeStore({});
  initExposure({ store });
  const quiet = console.log; console.log = () => {};

  recordCorrect('Lyr', 'identify/diagram');
  const afterCorrectOnly = loadExposure().Lyr['identify/diagram'];
  recordSeen('Lyr', 'identify/diagram');
  const afterSeen = loadExposure().Lyr['identify/diagram'];
  console.log = quiet;

  check('recordCorrect does not stamp lastSeen',
        afterCorrectOnly.lastSeen === undefined, JSON.stringify(afterCorrectOnly));
  check('recordSeen does stamp lastSeen',
        typeof afterSeen.lastSeen === 'number', JSON.stringify(afterSeen));
}

// Stateless on purpose: a write to the key from outside must be visible on the next read.
// test/sim-lessons.js seeds the key directly in nine places and depends on this.
{
  const store = makeStore({});
  initExposure({ store });
  store.setItem('con-exposure', JSON.stringify({ _v2: true, Cyg: { 'find/stars': { seen: 9, correct: 4 } } }));
  check('an external write to the key is visible on the next read',
        loadExposure().Cyg['find/stars'].seen === 9);
}

// ── Emptiness ────────────────────────────────────────────────────────────────
// Pure predicate over a record, not a read — the level-check payoff asks it of a snapshot
// taken before seeding as well as of the live record.
{
  check('exposureIsEmpty: {} → true', exposureIsEmpty({}) === true);
  check('exposureIsEmpty: only the version marker → true', exposureIsEmpty({ _v2: true }) === true);
  check('exposureIsEmpty: with a constellation → false',
        exposureIsEmpty({ _v2: true, Ori: {} }) === false);
}

// ── Erasing ──────────────────────────────────────────────────────────────────
{
  const store = makeStore({});
  initExposure({ store });
  const quiet = console.log; console.log = () => {};
  recordSeen('Ori', 'identify/diagram');
  console.log = quiet;

  check('there is something to erase', !exposureIsEmpty(loadExposure()));
  resetExposure();
  // Order matters here, and finding that out is what this case is for: the key is gone
  // immediately after reset, but the next READ puts it back. loadExposure on an absent
  // record migrates `{}`, and migrating stamps `_v2` and saves. So the key reappears
  // holding an empty record. Long-standing behaviour, inherited verbatim from course.js,
  // and surprising enough that asserting it in the wrong order is how it was noticed.
  check('reset removes the key', store.getItem('con-exposure') === null,
        store.getItem('con-exposure'));
  check('the record reads empty afterwards', exposureIsEmpty(loadExposure()));
  check('and that read re-creates the key, stamped and empty',
        JSON.parse(store.getItem('con-exposure'))._v2 === true &&
        exposureIsEmpty(JSON.parse(store.getItem('con-exposure'))),
        store.getItem('con-exposure'));
}

// ── The store is a port ──────────────────────────────────────────────────────
// Two records side by side, which is the thing a global localStorage could never give a
// test — and the reason the port is worth having beyond tidiness.
{
  const a = makeStore({}), b = makeStore({});
  const quiet = console.log; console.log = () => {};
  initExposure({ store: a });
  recordSeen('Ori', 'identify/diagram');
  initExposure({ store: b });
  recordSeen('Lyr', 'identify/diagram');
  const inB = loadExposure();
  initExposure({ store: a });
  const inA = loadExposure();
  console.log = quiet;

  check('each store holds its own record',
        !!inA.Ori && !inA.Lyr && !!inB.Lyr && !inB.Ori,
        `A=${Object.keys(inA)} B=${Object.keys(inB)}`);
}

console.log('');
if (failures.length) {
  console.log(`❌ ${failures.length} FAILURE(S): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('✅ ALL PASSED');
