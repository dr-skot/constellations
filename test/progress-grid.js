#!/usr/bin/env node
// Unit tests for the shared progress-grid renderer (js/progress-grid.js).
// Covers the pure tier-state logic: tierClass(exposure, abbr, key) must classify a
// constellation+tier as passed (correct>=1) / seen (seen>=1) / unseen, reading from an
// explicitly-passed exposure record (no closed-over global).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const origLog = console.log; console.log = () => {};
const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'progress-grid.js'), 'utf8'), { filename: 'progress-grid.js' });
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? origLog(`OK: ${name}`)
  : (failures.push(name), origLog(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// Tier ladder shape.
check('TIERS has the seven tiers in order',
  TIERS.map(t => t.key).join(',') ===
  'identify/diagram,find/diagram,identify/stars,find/stars,identify/photo,find/photo,find/photo-nb');
check('every tier has short + label', TIERS.every(t => t.short && t.label));

// tierClass against an explicit exposure record.
const exposure = {
  UMa: {
    'identify/diagram': { seen: 3, correct: 2 },   // passed
    'find/diagram':     { seen: 2, correct: 0 },   // seen, not passed
    // 'identify/stars' absent                      // unseen
  },
};

check('correct>=1 → passed', tierClass(exposure, 'UMa', 'identify/diagram') === 'passed');
check('seen>=1, correct=0 → seen', tierClass(exposure, 'UMa', 'find/diagram') === 'seen');
check('tier absent → unseen', tierClass(exposure, 'UMa', 'identify/stars') === 'unseen');
check('constellation absent → unseen', tierClass(exposure, 'Ori', 'identify/diagram') === 'unseen');
check('empty exposure → unseen', tierClass({}, 'UMa', 'identify/diagram') === 'unseen');
check('null exposure → unseen (no throw)', tierClass(null, 'UMa', 'identify/diagram') === 'unseen');
check('seen=0 correct=0 → unseen',
  tierClass({ UMa: { 'find/stars': { seen: 0, correct: 0 } } }, 'UMa', 'find/stars') === 'unseen');

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
