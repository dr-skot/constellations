#!/usr/bin/env node
// How much does a frame cost as the field of view widens? The visible set is an
// angular-radius test against fov (exploreVisibleCons), so everything drawn per frame
// scales with the area of sky in view. This counts the inputs — visible constellations,
// boundary vertices, diagram stars — across many pointings of the real catalog.
//
//   node perf/fov-cost.js
//
// Static counts only: it predicts how work SCALES, not what it costs. Measuring the
// cost is perf/draw-probe.js, and the two disagreed sharply — this said boundaries and
// stars would dominate a wide-field frame; the device said label placement does, and
// that the whole frame is ~3ms. Read this for shape, never for milliseconds.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const base = path.join(__dirname, '..', 'js') + '/';
const ctx = { console, window: {}, document: { getElementById: () => null } };
vm.createContext(ctx);
// `const` at a vm script's top level stays lexical, so hand the values out explicitly.
vm.runInContext(fs.readFileSync(base + 'data.js', 'utf8') +
  ';globalThis.__C = C; globalThis.__BOUNDS = BOUNDS;', ctx);

const C = ctx.__C, BOUNDS = ctx.__BOUNDS;
const D = Math.PI / 180;
function angularDist(ra1, dec1, ra2, dec2) {
  const a = dec1 * D, b = dec2 * D, dr = (ra1 - ra2) * D;
  return Math.acos(Math.max(-1, Math.min(1,
    Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dr)))) / D;
}

let totalBoundVerts = 0;
for (const k in BOUNDS) for (const ring of BOUNDS[k]) totalBoundVerts += ring.length;

const starCount = {};
for (const con of C) starCount[con.abbr] = (con.stars || []).length;

console.log('constellations:', C.length,
            '| total boundary vertices:', totalBoundVerts,
            '| total diagram stars:', Object.values(starCount).reduce((a, b) => a + b, 0));
console.log('');
console.log('fov     median: vis  boundV  stars   projPts  |  worst: vis  boundV  stars   projPts');

const pointings = [];
for (let ra = 0; ra < 360; ra += 15)
  for (let dec = -75; dec <= 75; dec += 15) pointings.push([ra, dec]);

for (const fov of [5, 10, 20, 40, 60, 80, 100, 120]) {
  let worst = null;
  const rows = [];
  for (const [ra, dec] of pointings) {
    const vis = C.filter(con => angularDist(ra, dec, con.ra, con.dec) < fov / 2 + con.fov / 2 + 8);
    let bv = 0, sv = 0;
    for (const con of vis) {
      for (const ring of (BOUNDS[con.abbr] || [])) bv += ring.length;
      sv += starCount[con.abbr] || 0;
    }
    const row = { n: vis.length, bv, sv, proj: bv + 2 * sv };
    rows.push(row);
    if (!worst || row.proj > worst.proj) worst = row;
  }
  rows.sort((a, b) => a.proj - b.proj);
  const med = rows[Math.floor(rows.length / 2)];
  const p = (x, w) => String(x).padStart(w);
  console.log(p(fov, 3), '          ', p(med.n, 3), p(med.bv, 7), p(med.sv, 6), p(med.proj, 8),
              '  |        ', p(worst.n, 3), p(worst.bv, 7), p(worst.sv, 6), p(worst.proj, 8));
}

console.log('');
console.log('label placement upper bound (names x boundary edges):');
for (const fov of [20, 60, 100]) {
  let worst = 0, wn = 0, wbv = 0;
  for (const [ra, dec] of pointings) {
    const vis = C.filter(con => angularDist(ra, dec, con.ra, con.dec) < fov / 2 + con.fov / 2 + 8);
    let bv = 0;
    for (const con of vis) for (const ring of (BOUNDS[con.abbr] || [])) bv += ring.length;
    if (bv * vis.length > worst) { worst = bv * vis.length; wn = vis.length; wbv = bv; }
  }
  console.log(`  fov ${String(fov).padStart(3)}: ${wn} names x ${wbv} edges = ${worst.toLocaleString()} tests/frame`);
}
