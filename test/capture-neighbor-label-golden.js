#!/usr/bin/env node
// Characterization capture for findNeighborLabelSpot (Candidate 6).
//
// `oracle` below is a VERBATIM transcription of the findInNeighbor closure that
// lived inside redrawReveal (js/render.js, pre-refactor lines 370-408), with the
// variables it used to capture from scope (cirCx/cirCy/R/cosA/sinA/curScrPts/
// allScrEdges) turned into explicit parameters. It is the ORACLE: run over a
// spread of constructed polygon scenarios, its output is frozen as
// test/neighbor-label-golden.json. After findNeighborLabelSpot is lifted out and
// re-expressed on searchLabelSpot + fitLabelBox, test/neighbor-label.js replays
// this golden through the real function and asserts byte-for-byte equality.
// The real pointInPoly2D / edgesHitRect (and segSegIntersect) are loaded from
// render.js so only the closure body is transcribed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const origLog = console.log; console.log = () => {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8'), { filename: 'render.js' });
console.log = origLog;

// ---- ORACLE: verbatim findInNeighbor with captured vars as params -----------
function oracle(view, nScrPts, hint, box) {
  const cirCx = view.cx, cirCy = view.cy, R = view.R, cosA = view.cosA, sinA = view.sinA;
  const curScrPts = view.currentPts, allScrEdges = view.edges;
  const hintDx = hint.dx, hintDy = hint.dy, hw = box.hw, hh = box.hh;

  const canNPIP = nScrPts.length >= 3;
  const canCPIP = curScrPts.length >= 3;

  function valid(tx, ty) {
    const dx = tx - cirCx, dy = ty - cirCy;
    if (dx * dx + dy * dy > (R - hw) * (R - hw)) return false;
    const sx = cirCx + dx * cosA - dy * sinA;
    const sy = cirCy + dx * sinA + dy * cosA;
    const x1 = sx - hw, x2 = sx + hw, y1 = sy - hh, y2 = sy + hh;
    for (const [px, py] of [[sx,sy],[x1,y1],[x2,y1],[x1,y2],[x2,y2]]) {
      if (canNPIP && !pointInPoly2D(px, py, nScrPts)) return false;
      if (canCPIP &&  pointInPoly2D(px, py, curScrPts)) return false;
    }
    if (edgesHitRect(allScrEdges, x1, y1, x2, y2)) return false;
    return true;
  }

  const hl = Math.sqrt(hintDx * hintDx + hintDy * hintDy);
  if (hl > 1) {
    for (let t = 0.08; t <= 0.93; t += 0.03) {
      const tx = cirCx + (hintDx / hl) * R * t;
      const ty = cirCy + (hintDy / hl) * R * t;
      if (valid(tx, ty)) return { x: tx, y: ty };
    }
  }
  for (let ri = 5; ri >= 1; ri--) {
    const r = R * 0.88 * ri / 5;
    for (let ai = 0; ai < 16; ai++) {
      const tx = cirCx + Math.cos(ai * Math.PI / 8) * r;
      const ty = cirCy + Math.sin(ai * Math.PI / 8) * r;
      if (valid(tx, ty)) return { x: tx, y: ty };
    }
  }
  return null;
}

// ---- Scenario construction --------------------------------------------------
const R = 300, CX = 300, CY = 300;
const square = (cx, cy, half) => [
  { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
  { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
];
const edgesOf = poly => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
const centroid = poly => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
});

// Neighbor polygon placements around the circle (offset direction, size).
const placements = [
  { label: 'right',       n: square(470, 300, 110) },
  { label: 'left',        n: square(150, 300, 100) },
  { label: 'up',          n: square(300, 140, 120) },
  { label: 'down-narrow', n: square(300, 470, 60) },
  { label: 'overlap-cur', n: square(320, 320, 150) },   // overlaps current -> outside constraint bites
  { label: 'degenerate',  n: [{ x: 400, y: 300 }, { x: 420, y: 300 }] }, // <3 -> canNPIP false
];
const currents = [
  { label: 'cur80',  c: square(300, 300, 80) },
  { label: 'noCur',  c: [] },                    // canCPIP false
];
const edgeSets = [
  { label: 'curEdges', useCur: true },           // block with current's own edges
  { label: 'noEdges',  useCur: false },
];
const rotations = [
  { label: 'rot0',   a: 0 },
  { label: 'rot+.3', a: 0.3 },
  { label: 'rot-.6', a: -0.6 },
];
const boxes = [
  { label: 'box40',  hw: 40, hh: 12 },
  { label: 'box90',  hw: 90, hh: 12 },
  { label: 'boxHuge', hw: 320, hh: 12 },         // hw > R -> bounds always false -> null
];

const scenarios = [];
for (const pl of placements) {
  for (const cu of currents) {
    for (const es of edgeSets) {
      for (const ro of rotations) {
        for (const bx of boxes) {
          const cen = centroid(pl.n);
          const hint = { dx: cen.x - CX, dy: cen.y - CY };
          const edges = es.useCur ? edgesOf(cu.c) : [];
          const view = { cx: CX, cy: CY, R, cosA: Math.cos(ro.a), sinA: Math.sin(ro.a), currentPts: cu.c, edges };
          scenarios.push({
            label: `${pl.label}/${cu.label}/${es.label}/${ro.label}/${bx.label}`,
            view, nScrPts: pl.n, hint, box: { hw: bx.hw, hh: bx.hh },
          });
        }
      }
    }
  }
}
// Zero-hint cases (hl <= 1 -> skip hint-line, go straight to rings).
for (const ro of rotations) {
  scenarios.push({
    label: `zerohint/cur80/noEdges/${ro.label}/box40`,
    view: { cx: CX, cy: CY, R, cosA: Math.cos(ro.a), sinA: Math.sin(ro.a), currentPts: square(300,300,80), edges: [] },
    nScrPts: square(470, 300, 110), hint: { dx: 0, dy: 0 }, box: { hw: 40, hh: 12 },
  });
}

const golden = scenarios.map(s => ({
  label: s.label,
  input: { view: s.view, nScrPts: s.nScrPts, hint: s.hint, box: s.box },
  spot: oracle(s.view, s.nScrPts, s.hint, s.box),
}));

const out = path.join(__dirname, 'neighbor-label-golden.json');
fs.writeFileSync(out, JSON.stringify(golden, null, 2) + '\n');
const nulls = golden.filter(g => g.spot === null).length;
const hits = golden.length - nulls;
console.log(`Captured ${golden.length} scenarios (${hits} placed, ${nulls} null) -> ${path.relative(process.cwd(), out)}`);
