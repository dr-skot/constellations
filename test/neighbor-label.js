#!/usr/bin/env node
// Golden + unit test for the label-placement module (js/render.js, Candidate 6):
// fitLabelBox, searchLabelSpot, and the lifted findNeighborLabelSpot. Replays
// test/neighbor-label-golden.json (captured from the pre-refactor findInNeighbor
// closure) through the real findNeighborLabelSpot and asserts byte-for-byte
// equality, then unit-tests the two shared primitives directly.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const origLog = console.log; console.log = () => {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8'), { filename: 'render.js' });
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? origLog(`OK: ${name}`)
  : (failures.push(name), origLog(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));
const sameSpot = (a, b) => (a === null && b === null) || (a && b && a.x === b.x && a.y === b.y);

// ---- Golden replay: findNeighborLabelSpot ----------------------------------
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'neighbor-label-golden.json'), 'utf8'));
let mismatches = 0;
for (const g of golden) {
  const { view, nScrPts, hint, box } = g.input;
  const got = findNeighborLabelSpot(view, nScrPts, hint, box);
  const want = g.spot;
  if (!sameSpot(got, want)) {
    mismatches++;
    if (mismatches <= 8) origLog(`   mismatch [${g.label}]: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
check(`golden replay byte-for-byte (${golden.length} scenarios)`, mismatches === 0, `${mismatches} mismatches`);

// ---- fitLabelBox unit tests -------------------------------------------------
const sq = (x0, y0, x1, y1) => [ { x:x0, y:y0 }, { x:x1, y:y0 }, { x:x1, y:y1 }, { x:x0, y:y1 } ];
const box100 = sq(0, 0, 100, 100);

check('fitLabelBox: box fully inside passes',
  fitLabelBox(50, 50, 10, 10, { inside: box100 }) === true);
check('fitLabelBox: a corner outside the inside-polygon fails',
  fitLabelBox(95, 50, 10, 10, { inside: box100 }) === false);   // x2=105 > 100
check('fitLabelBox: centre inside an outside-polygon fails',
  fitLabelBox(50, 50, 10, 10, { outside: box100 }) === false);
check('fitLabelBox: fully clear of an outside-polygon passes',
  fitLabelBox(200, 200, 10, 10, { outside: box100 }) === true);
check('fitLabelBox: edge crossing the box rect fails',
  fitLabelBox(50, 50, 10, 10, { edges: [[{x:50,y:-100},{x:50,y:200}]] }) === false);
check('fitLabelBox: edge far from the box passes',
  fitLabelBox(50, 50, 10, 10, { edges: [[{x:500,y:-100},{x:500,y:200}]] }) === true);
check('fitLabelBox: no constraints passes',
  fitLabelBox(50, 50, 10, 10, {}) === true);
check('fitLabelBox: inside=null skips the inside test',
  fitLabelBox(9999, 9999, 10, 10, { inside: null, outside: null }) === true);

// ---- searchLabelSpot unit tests ---------------------------------------------
const only = (tx, ty) => (x, y) => x === tx && y === ty;

check('searchLabelSpot: returns first valid preScan point',
  sameSpot(searchLabelSpot([{x:1,y:1},{x:2,y:2}], {x:0,y:0}, [10], only(2,2)), {x:2,y:2}));
check('searchLabelSpot: preScan wins over rings',
  sameSpot(searchLabelSpot([{x:10,y:0}], {x:0,y:0}, [10], () => true), {x:10,y:0}));
check('searchLabelSpot: falls through to first ring point (ai=0 -> (r,0))',
  sameSpot(searchLabelSpot([], {x:0,y:0}, [10], only(10,0)), {x:10,y:0}));
check('searchLabelSpot: earlier radius wins when both are valid',
  sameSpot(searchLabelSpot([], {x:0,y:0}, [10,20], (x,y)=> (x===10&&y===0)||(x===20&&y===0)), {x:10,y:0}));
{
  // angular order within a ring: ai=0 invalid, ai=1 valid.
  const px = 10 * Math.cos(Math.PI/8), py = 10 * Math.sin(Math.PI/8);
  check('searchLabelSpot: walks angles in order (ai=1 point)',
    sameSpot(searchLabelSpot([], {x:0,y:0}, [10], only(px, py)), {x:px, y:py}));
}
check('searchLabelSpot: returns null when nothing is valid',
  searchLabelSpot([{x:1,y:1}], {x:0,y:0}, [10,20], () => false) === null);
check('searchLabelSpot: rings centred on center',
  sameSpot(searchLabelSpot([], {x:100,y:100}, [5], only(105,100)), {x:105,y:100}));

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
