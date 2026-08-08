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

// distinctCons: the constellations practiced across a lesson's questions, deduped by
// abbr, in first-encounter order (drives which cards the result screen shows).
const uma = { abbr: 'UMa', name: 'Ursa Major' };
const ori = { abbr: 'Ori', name: 'Orion' };
const cas = { abbr: 'Cas', name: 'Cassiopeia' };
const qs = [
  { con: uma, type: 'identify' }, { con: ori, type: 'find' },
  { con: uma, type: 'find' },     { con: cas, type: 'identify' },
  { con: ori, type: 'identify' },
];
const practiced = distinctCons(qs);
check('distinctCons dedupes by abbr', practiced.length === 3);
check('distinctCons keeps first-encounter order',
  practiced.map(c => c.abbr).join(',') === 'UMa,Ori,Cas');
check('distinctCons returns the con objects themselves', practiced[0] === uma);
check('distinctCons on [] → []', distinctCons([]).length === 0);
check('distinctCons on null → [] (no throw)', distinctCons(null).length === 0);
check('distinctCons skips questions with no con',
  distinctCons([{ type: 'x' }, { con: uma }]).length === 1);

// consByDifficulty: groups constellations into difficulty bands for the course grid —
// sorted by diff then name, one group per distinct diff, ascending.
const cons = [
  { abbr: 'Ori', name: 'Orion',      diff: 2 },
  { abbr: 'UMa', name: 'Ursa Major', diff: 1 },
  { abbr: 'Leo', name: 'Leo',        diff: 2 },
  { abbr: 'Aql', name: 'Aquila',     diff: 2 },
  { abbr: 'Cas', name: 'Cassiopeia', diff: 1 },
];
const bands = consByDifficulty(cons);
check('consByDifficulty groups by distinct diff', bands.length === 2);
check('consByDifficulty bands ascend by diff', bands.map(b => b.diff).join(',') === '1,2');
check('consByDifficulty labels the bands',
  bands[0].label === 'Instant Recognition' && bands[1].label === 'Bright & Distinctive');
check('consByDifficulty sorts within a band by name',
  bands[1].cons.map(c => c.abbr).join(',') === 'Aql,Leo,Ori');
check('consByDifficulty puts each con in exactly one band',
  bands.reduce((n, b) => n + b.cons.length, 0) === cons.length);
check('consByDifficulty on [] → []', consByDifficulty([]).length === 0);
check('consByDifficulty on null → [] (no throw)', consByDifficulty(null).length === 0);
check('consByDifficulty labels an unknown diff by number',
  consByDifficulty([{ abbr: 'X', name: 'X', diff: 99 }])[0].label === 'Difficulty 99');
check('consByDifficulty does not mutate its input', cons[0].abbr === 'Ori');

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
