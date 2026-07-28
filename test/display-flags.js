#!/usr/bin/env node
// Golden + invariant test for resolveDisplayFlags (js/explore.js, Candidate 5 part B).
// Replays test/display-flags-golden.json (captured from the pre-refactor inline
// cascade) through the extracted pure function and asserts byte-for-byte equality,
// then checks invariants that must survive future edits.

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

const KEYS = ['cm', 'isAnswered', 'showPhoto', 'showDiag', 'showStars', 'showLines',
  'showBounds', 'showArt', 'showStarLabels', 'showConNames', 'refMode'];

// ---- Golden replay ----------------------------------------------------------
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'display-flags-golden.json'), 'utf8'));
let mismatches = 0;
for (const g of golden) {
  const { explore, exState, eqRevState, guideActive } = g.input;
  const got = resolveDisplayFlags(explore, exState, eqRevState, guideActive);
  for (const k of KEYS) {
    // golden JSON drops undefined-valued keys; treat missing as undefined.
    const exp = k in g.flags ? g.flags[k] : undefined;
    if (got[k] !== exp) {
      mismatches++;
      if (mismatches <= 8) origLog(`   mismatch [${g.label}] ${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(exp)}`);
    }
  }
}
check(`golden replay byte-for-byte (${golden.length} scenarios, ${KEYS.length} keys)`, mismatches === 0, `${mismatches} field mismatches`);

// ---- Invariants -------------------------------------------------------------
const freeES = { photo: true, stars: true, diagram: true, art: true, bounds: true, starLabels: true, conNames: true, reference: 'always' };
const eqRev  = { photo: true, diagram: true, art: true, boundary: true };

// 1. Always returns all 11 keys.
{
  const f = resolveDisplayFlags({ quiz: null }, freeES, eqRev, false);
  check('returns all 11 keys', KEYS.every(k => k in f), KEYS.filter(k => !(k in f)).join(','));
}

// 2. No input mutation.
{
  const explore = { quiz: { stageMode: 'diagram', answered: true, bounds: true } };
  const es = { ...freeES }, eq = { ...eqRev };
  const snap = JSON.stringify([explore, es, eq]);
  resolveDisplayFlags(explore, es, eq, false);
  check('does not mutate inputs', JSON.stringify([explore, es, eq]) === snap);
}

// 3. Course mode (cm truthy) forces con-name labels off.
{
  let ok = true;
  for (const sm of ['photo', 'diagram', 'stars']) {
    const f = resolveDisplayFlags({ quiz: { stageMode: sm, answered: false } }, freeES, eqRev, false);
    if (f.showConNames !== false) ok = false;
    if (f.showStarLabels !== false) ok = false; // cm also forces star labels off
    if (f.refMode !== 'always') ok = false;      // cm pins reference guides on
  }
  check('course mode forces conNames/starLabels off and refMode=always', ok);
}

// 4. guideActive forces star labels off even in free mode.
{
  const on  = resolveDisplayFlags({ quiz: null }, freeES, eqRev, false);
  const off = resolveDisplayFlags({ quiz: null }, freeES, eqRev, true);
  check('guideActive suppresses star labels', on.showStarLabels === true && off.showStarLabels === false);
}

// 5. Free mode: showDiag is unconditionally true (stars always drawable).
{
  const f = resolveDisplayFlags({ quiz: null, diagram: false }, freeES, eqRev, false);
  check('free mode showDiag always true', f.showDiag === true);
}

// 6. Determinism.
{
  const a = resolveDisplayFlags({ quiz: { stageMode: 'stars', answered: true } }, freeES, eqRev, false);
  const b = resolveDisplayFlags({ quiz: { stageMode: 'stars', answered: true } }, freeES, eqRev, false);
  check('deterministic', JSON.stringify(a) === JSON.stringify(b));
}

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
