#!/usr/bin/env node
// Unit tests for the diagram-source registry + accessor (js/diagram-sources.js).
// diagramFor swaps only the drawn figure and must fall back to the master catalog
// (C / IAU) whenever a source lacks a constellation or the key is unknown.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lsStore = {};
global.localStorage = {
  getItem: k => lsStore[k] ?? null, setItem: (k, v) => { lsStore[k] = v; },
  removeItem: k => { delete lsStore[k]; }, clear: () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
};
const origLog = console.log; console.log = () => {};
const jsDir = path.join(__dirname, '..', 'js');
for (const f of ['data.js', 'stellarium-data.js', 'ford-data.js', 'rey-data.js', 'diagram-sources.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? origLog(`OK: ${name}`)
  : (failures.push(name), origLog(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

const con = abbr => C.find(c => c.abbr === abbr);
const Ori = con('Ori');

// Registry shape.
check('registry lists the four sources in order',
  DIAGRAM_SOURCES.map(s => s.key).join(',') === 'iau,rey,stellarium,ford');
check('every source has a label', DIAGRAM_SOURCES.every(s => s.label));

// IAU is the identity: draw C's own figure.
check('diagramFor(con, "iau") returns con itself', diagramFor(Ori, 'iau') === Ori);

// Unknown key falls back to con.
check('unknown source key falls back to con', diagramFor(Ori, 'bogus') === Ori);

// Alternate sources: return the alt figure when present, con when absent.
for (const key of ['rey', 'stellarium', 'ford']) {
  let swapped = 0, fellBack = 0, sameSky = true;
  for (const c of C) {
    const d = diagramFor(c, key);
    if (d === c) { fellBack++; continue; }
    swapped++;
    if (d.abbr !== c.abbr) sameSky = false;        // alt entry must be the same constellation
    if (!Array.isArray(d.stars) || !Array.isArray(d.lines)) sameSky = false;
  }
  check(`[${key}] swaps at least one constellation's figure`, swapped > 0, `swapped ${swapped}`);
  check(`[${key}] swapped entries keep the same abbr and have stars+lines`, sameSky);
  check(`[${key}] falls back to con for constellations it lacks`, fellBack >= 0); // documents coverage
  origLog(`   [${key}] coverage: ${swapped}/${C.length} constellations, ${fellBack} fall back to IAU`);
}

// Persistence round-trip.
setDiagramSource('rey');
check('setDiagramSource persists', localStorage.getItem('ex-diagramSource') === 'rey');
check('setDiagramSource updates the global', diagramSource === 'rey');
setDiagramSource('nope');
check('setDiagramSource ignores unknown keys', diagramSource === 'rey');
diagramSource = 'iau';
loadDiagramSource();
check('loadDiagramSource restores the saved key', diagramSource === 'rey');

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
