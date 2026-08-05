#!/usr/bin/env node
// Unit tests for the settings registry + figure copy (js/settings.js).
// The screen build and canvas draw are DOM/canvas (not covered here); these
// guard the data: the registry shape and — the key invariant — that every
// diagram source has an explanatory blurb, so adding a source without copy fails.

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
for (const f of ['data.js', 'stellarium-data.js', 'ford-data.js', 'rey-data.js', 'diagram-sources.js', 'settings.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? origLog(`OK: ${name}`)
  : (failures.push(name), origLog(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// Registry shape.
const figures = SETTINGS.find(s => s.id === 'figures');
check('SETTINGS has a figures entry', !!figures);
check('figures title is "Figures"', figures && figures.title === 'Figures');
check('figures has a non-empty intro description', figures && typeof figures.description === 'string' && figures.description.trim().length > 0);
check('figures render is a function', figures && typeof figures.render === 'function');

// Copy coverage — the invariant that matters: every source has a blurb, and no
// blurb points at a source that doesn't exist.
const missing = DIAGRAM_SOURCES.filter(s => !FIGURE_BLURB[s.key]);
check('every diagram source has a blurb', missing.length === 0, 'missing: ' + missing.map(s => s.key).join(','));
const orphan = Object.keys(FIGURE_BLURB).filter(k => !DIAGRAM_SOURCES.some(s => s.key === k));
check('no blurb for a nonexistent source', orphan.length === 0, 'orphans: ' + orphan.join(','));

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
