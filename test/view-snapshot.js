#!/usr/bin/env node
// Unit test for the copy-safe view-snapshot pair (js/explore.js, Candidate 7):
// snapshotView(explore) and applyView(explore, snap). The whole point is that the
// `P` array is copied on BOTH sides, so a saved snapshot never shares its array
// with live explore.P — the latent aliasing bug (course.js restored explore.P
// without .slice()). R and fov are primitives (value copies).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// explore.js calls raDecToVec(80,5) at load; projection.js provides it.
const origLog = console.log; console.log = () => {};
const jsDir = path.join(__dirname, '..', 'js');
for (const f of ['projection.js', 'explore.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? origLog(`OK: ${name}`)
  : (failures.push(name), origLog(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

const mkExplore = () => ({ P: [0.1, 0.2, 0.3], R: 1.5, fov: 42, quiz: null, drag: null });

// ---- snapshotView ----------------------------------------------------------
{
  const e = mkExplore();
  const snap = snapshotView(e);
  check('snapshotView copies R and fov by value', snap.R === 1.5 && snap.fov === 42);
  check('snapshotView copies P values', snap.P.length === 3 && snap.P[0] === 0.1 && snap.P[1] === 0.2 && snap.P[2] === 0.3);
  check('snapshotView returns only P/R/fov', Object.keys(snap).sort().join(',') === 'P,R,fov');
  check('snapshotView P is a NEW array (not the same reference)', snap.P !== e.P);
  // Mutating the snapshot must not touch explore.
  snap.P[0] = 999;
  check('mutating snapshot.P does not affect explore.P', e.P[0] === 0.1);
  // Mutating explore after snapshot must not touch the snapshot.
  const snap2 = snapshotView(e);
  e.P[1] = -7;
  check('mutating explore.P after snapshot does not affect snapshot', snap2.P[1] === 0.2);
}

// ---- applyView -------------------------------------------------------------
{
  const e = mkExplore();
  const snap = { P: [9, 8, 7], R: 0.25, fov: 60 };
  applyView(e, snap);
  check('applyView sets R and fov', e.R === 0.25 && e.fov === 60);
  check('applyView sets P values', e.P[0] === 9 && e.P[1] === 8 && e.P[2] === 7);
  check('applyView installs a COPY of snap.P (no alias)', e.P !== snap.P);
  // The core guarantee: after a restore, mutating either side is independent.
  e.P[0] = 111;
  check('mutating restored explore.P does not affect the snapshot', snap.P[0] === 9);
  snap.P[2] = 222;
  check('mutating the snapshot after restore does not affect explore.P', e.P[2] === 7);
}

// ---- round-trip (the lesson-history B / find-guide C shape) ----------------
{
  const live = mkExplore();
  const saved = snapshotView(live);          // save side (.slice())
  const other = { P: [0, 0, 0], R: 0, fov: 0 };
  applyView(other, saved);                    // restore side (.slice())
  check('round-trip copies values', other.R === live.R && other.fov === live.fov && other.P.join() === live.P.join());
  // Neither live nor the restored target may share saved.P.
  check('round-trip: saved.P aliases neither end', saved.P !== live.P && saved.P !== other.P && live.P !== other.P);
  // The bug scenario: whole chain independent under in-place mutation.
  saved.P[0] = 5;
  check('round-trip: mutating the stored snapshot corrupts nothing', live.P[0] === 0.1 && other.P[0] === 0.1);
}

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
