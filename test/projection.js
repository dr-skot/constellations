#!/usr/bin/env node
// Characterization + interface tests for the projection module (js/projection.js).
// Pure math, no DOM — loads the source directly and exercises it.
//
//   node test/projection.js
//
// Two layers:
//   1. CHARACTERIZATION — golden values frozen from the pre-refactor functions
//      (projectStarsCamera / vecToPixel / pixelToVec). makeCamera must reproduce
//      them exactly, proving the Camera refactor is behavior-preserving.
//   2. INTERFACE — the contract going forward: project↔unproject round-trip,
//      the `facing` sign, and a golden TAN value.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

vm.runInThisContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'projection.js'), 'utf8'),
  { filename: 'projection.js' }
);

// ── Assertion helpers ──────────────────────────────────────
let passed = 0, failed = 0;
const EPS = 1e-6;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ ' + msg); } }
function near(a, b, msg) { ok(Math.abs(a - b) <= EPS, `${msg} (got ${a}, want ${b})`); }
function nearVec(a, b, msg) { for (let i = 0; i < b.length; i++) near(a[i], b[i], `${msg}[${i}]`); }

// ── Fixed scene (frozen; matches the capture) ──────────────
const W = 1000, H = 800, fov = 40;
const P  = [0.12140559376013016, 0.9887692138764507, -0.08715574274765817];
const up = [0.16511857826274534, -0.10669954732455475, -0.9804851154980501];

const stars = [
  [83, -5, 0.4, 'r', 'Betelgeuse'],
  [78, -8, 1.6, 'b', 'Rigel'],
  [90, 20, 2.0, null, 'OffCenter'],
  [0, 90, 3.0, null, 'NCP'],
  [263, 5, 1.0, null, 'Behind'],
];
const vecs = [
  raDecToVec(83, -5),
  raDecToVec(80, 0),
  raDecToVec(263, 5),   // behind
  [0, 0, 1],            // NCP — behind for this camera
  [0, 0, -1],           // SCP — in front
];
const pixels = [[500, 400], [0, 0], [999, 799], [250, 600], [820, 130]];

// ── Golden values (frozen from pre-refactor projection.js) ──
const GOLD_STARS = [
  { x: 500,           y: 400,            facing: 1,            mag: 0.4, hint: 'r',  name: 'Betelgeuse' },
  { x: 395.568101173, y: 307.346054341,  facing: 0.994875605, mag: 1.6, hint: 'b',  name: 'Rigel' },
  { x: 558.143759302, y: 1065.400735653, facing: 0.899330114, mag: 2,   hint: null, name: 'OffCenter' },
  { x: 3277.529078407,y: -15054.292683511,facing: -0.087155743,mag: 3,  hint: null, name: 'NCP' },
  { x: 500,           y: 400,            facing: -1,           mag: 1,   hint: null, name: 'Behind' },
];
// vecToPixel returned null for d<=0; here we store {x,y,facing} always, with
// facing<=0 flagged. x,y for the behind cases are the raw (phantom) coords.
const GOLD_VEC = [
  { x: 500,            y: 400,             facing: 1 },
  { x: 407.610112231,  y: 505.507413129,   facing: 0.994829448 },
  { behind: true },                                        // ra263 — was null
  { behind: true },                                        // NCP   — was null
  { x: 3277.529078407, y: -15054.292683511, facing: 0.087155743 }, // SCP in front
];
const GOLD_UNPROJ = [
  [0.121405594, 0.988769214, -0.087155743],
  [0.476507954, 0.833515781, -0.279627633],
  [-0.25577496, 0.959114815, 0.121152553],
  [0.268298501, 0.959545443, 0.08537246],
  [-0.070917015, 0.949072801, -0.306971652],
];

// ═══════════════════════════════════════════════════════════
// 1 · CHARACTERIZATION
// ═══════════════════════════════════════════════════════════
const cam = makeCamera(P, up, fov, W, H);

// projectStars must reproduce projectStarsCamera exactly (d renamed facing)
const ps = cam.projectStars(stars);
ok(ps.length === GOLD_STARS.length, 'projectStars length');
GOLD_STARS.forEach((g, i) => {
  near(ps[i].facing, g.facing, `projectStars[${i}].facing`);
  ok(ps[i].mag === g.mag && ps[i].hint === g.hint && ps[i].name === g.name,
     `projectStars[${i}] decoration echoed`);
  // Pixels are only meaningful (and drawn) for in-front points; behind points are
  // off-screen phantoms whose exact coords aren't part of the contract.
  if (g.facing > 0) {
    near(ps[i].x, g.x, `projectStars[${i}].x`);
    near(ps[i].y, g.y, `projectStars[${i}].y`);
  }
});

// project(vec) always returns {x,y,facing}; matches vecToPixel where it was non-null
vecs.forEach((v, i) => {
  const p = cam.project(v);
  ok(p != null && typeof p.facing === 'number', `project[${i}] returns a value (never null)`);
  const g = GOLD_VEC[i];
  if (g.behind) {
    ok(p.facing <= 0, `project[${i}] facing<=0 for behind point`);
  } else {
    near(p.x, g.x, `project[${i}].x`);
    near(p.y, g.y, `project[${i}].y`);
    near(p.facing, g.facing, `project[${i}].facing`);
  }
});

// unproject must reproduce pixelToVec exactly
pixels.forEach(([px, py], i) => {
  nearVec(cam.unproject(px, py), GOLD_UNPROJ[i], `unproject[${i}]`);
});

// ═══════════════════════════════════════════════════════════
// 2 · INTERFACE CONTRACT
// ═══════════════════════════════════════════════════════════

// tanHalfFov is the single sensitive atom
near(tanHalfFov(40), Math.tan(40 * Math.PI / 360), 'tanHalfFov(40)');

// project↔unproject round-trip for in-front points recovers the original vector
[[83, -5], [80, 0], [110, 30], [40, -50]].forEach(([ra, dec], i) => {
  const v = raDecToVec(ra, dec);
  const p = cam.project(v);
  ok(p.facing > 0, `roundtrip[${i}] in front`);
  nearVec(cam.unproject(p.x, p.y), v, `roundtrip[${i}] unproject∘project`);
});

// facing sign: dead-center ≈ 1, behind < 0
near(cam.project(P).facing, 1, 'facing at center = 1');
ok(cam.project(vecs[2]).facing < 0, 'facing behind < 0');
ok(cam.project(P).x === 500 && cam.project(P).y === 400, 'center projects to (W/2,H/2)');

// golden TAN: a point 5° off-center along the up axis, north-up camera at the pole-free
// equator, lands at H/2 - tan(5°)/tan(fov/2) * (W/2)  (pure analytic check)
{
  const W2 = 640, H2 = 640, fov2 = 20;
  const c = raDecToVec(0, 0);                 // center on equator, RA=0
  const upN = [0, 0, 1];                      // north up
  const cam2 = makeCamera(c, upN, fov2, W2, H2);
  const p = cam2.project(raDecToVec(0, 5));   // 5° north of center
  const expectedY = H2 / 2 - Math.tan(5 * Math.PI / 180) / tanHalfFov(fov2) * (W2 / 2);
  near(p.x, W2 / 2, 'golden TAN x (on meridian)');
  near(p.y, expectedY, 'golden TAN y = analytic tan');
}

// ── Report ─────────────────────────────────────────────────
console.log(`\nprojection.js — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
