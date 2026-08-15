#!/usr/bin/env node
// Unit test for strokePolyline + clipToNear (js/explore.js).
// A fake 2D context records the exact beginPath/moveTo/lineTo/closePath/stroke
// call sequence. Where a segment straddles the near plane (one endpoint facing
// the camera, the other facing away), strokePolyline must CLIP the crossing to
// the horizon and keep drawing to/from that point, so lines run to the screen
// edge instead of dropping the crossing segment (issue #1). clipToNear does the
// perspective-correct interpolation and is checked here on its own too.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const origLog = console.log; console.log = () => {};
const jsDir = path.join(__dirname, '..', 'js');
for (const f of ['projection.js', 'explore.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? origLog(`OK: ${name}`)
  : (failures.push(name), origLog(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

function makeCtx() {
  const log = [];
  return {
    log,
    canvas: { width: 1200, height: 1200 },
    beginPath() { log.push('beginPath'); },
    moveTo(x, y) { log.push(`moveTo(${x},${y})`); },
    lineTo(x, y) { log.push(`lineTo(${x},${y})`); },
    closePath() { log.push('closePath'); },
    stroke() { log.push('stroke'); },
  };
}
const P = (x, y, facing) => ({ x, y, facing });
// Expected-op builders. For a clipped vertex we call the production clipToNear so
// the test pins strokePolyline's OP STRUCTURE (which pairs clip vs move vs drop);
// clipToNear's own geometry is verified independently below.
const mv = p => `moveTo(${p.x},${p.y})`;
const ln = p => `lineTo(${p.x},${p.y})`;
// The clipped vertex is CLAMPED to a few screen widths from the visible end of
// the segment (clampClipped). Raw clipToNear divides by NEAR_EPS = 1e-6, which
// put vertices up to 656 MILLION pixels away on a real device and killed the GPU
// process. `anchor` is whichever endpoint faces the camera — the other one is
// behind it and its projected coordinates mean nothing.
const clip = (a, b, anchor, ctx) => clampClipped(clipToNear(a, b), anchor, ctx);

// The context now matters: clampClipped reads ctx.canvas to size its limit. The
// fake one carries a canvas so the test exercises the same bound as production.
function run(name, pts, close, expected) {
  const ctx = makeCtx();
  strokePolyline(ctx, pts, close);
  check(name, ctx.log.join('|') === expected(ctx).join('|'), `got ${ctx.log.join('|')}`);
}

// 1. All front-facing: one continuous stroke (unchanged).
run('all facing>0 draws one polyline', [P(1,2,1), P(3,4,1), P(5,6,1)], false,
  () => ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', 'lineTo(5,6)', 'stroke']);

// 2. Interior behind-camera point: clip OUT to the horizon on the way behind, then
//    clip back IN when the line re-emerges — no gap across the horizon.
{
  const pts = [P(1,2,1), P(3,4,-1), P(5,6,1), P(7,8,1)];
  // Leaving the view, the anchor is pts[0]; re-entering, it is pts[2].
  run('interior facing<=0 clips out then back in', pts, false,
    ctx => ['beginPath', 'moveTo(1,2)', ln(clip(pts[0], pts[1], pts[0], ctx)),
     mv(clip(pts[1], pts[2], pts[2], ctx)), 'lineTo(5,6)', 'lineTo(7,8)', 'stroke']);
}

// 3. Leading behind-camera points: the line enters from the near-plane crossing of
//    the last behind point and the first front point.
{
  const pts = [P(0,0,-1), P(1,2,0), P(3,4,1), P(5,6,1)];
  run('leading facing<=0 enters from the crossing', pts, false,
    ctx => ['beginPath', mv(clip(pts[1], pts[2], pts[2], ctx)), 'lineTo(3,4)', 'lineTo(5,6)', 'stroke']);
}

// 4. Trailing behind-camera point: the line runs out to the crossing instead of
//    stopping at the last front point.
{
  const pts = [P(1,2,1), P(3,4,1), P(5,6,-1)];
  run('trailing facing<=0 clips out to the edge', pts, false,
    ctx => ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', ln(clip(pts[1], pts[2], pts[1], ctx)), 'stroke']);
}

// 5. close=true closes the final sub-path (phototile debug outline).
run('close=true closes before stroke', [P(1,2,1), P(3,4,1), P(5,6,1)], true,
  () => ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', 'lineTo(5,6)', 'closePath', 'stroke']);

// 6. facing == 0 counts as behind (strict > 0 required to be in front); the line
//    still enters from the crossing of the facing==0 point and the front point.
{
  const pts = [P(1,2,0), P(3,4,1)];
  run('facing==0 is behind, enters from crossing', pts, false,
    ctx => ['beginPath', mv(clip(pts[0], pts[1], pts[1], ctx)), 'lineTo(3,4)', 'stroke']);
}

// 7. All behind-camera: no front point ever, so nothing is drawn (still begins/strokes).
run('all facing<=0 strokes empty path', [P(1,2,-1), P(3,4,0)], false,
  () => ['beginPath', 'stroke']);

// 8. Default close arg is false.
{
  const ctx = makeCtx();
  strokePolyline(ctx, [P(1,2,1), P(3,4,1)]);
  check('close defaults to false', ctx.log.join('|') === ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', 'stroke'].join('|'));
}

// ── clipToNear geometry (independent of strokePolyline) ───────────────────────

// 9. The clipped vertex is collinear with the straddling endpoints. Perspective
//    projection maps the view-space chord to a straight screen line, so a, b and the
//    crossing share one line — cross product of (b-a) and (c-a) is ~0.
{
  const a = P(120, 90, 0.7), b = P(340, 260, -0.5);
  const c = clipToNear(a, b);
  const crossZ = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const scale = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - a.x, c.y - a.y);
  check('clipToNear vertex is collinear with the endpoints', Math.abs(crossZ) / scale < 1e-6,
    `normalized cross = ${crossZ / scale}`);
}

// 10. As facing -> 0 the crossing projects far off any real canvas — that is what
//     lets the visible line run all the way to the edge.
{
  const c = clipToNear(P(120, 90, 0.7), P(340, 260, -0.5));
  check('clipToNear vertex lands far off-screen', Math.hypot(c.x, c.y) > 1e4,
    `|c| = ${Math.hypot(c.x, c.y)}`);
}

// 11. Real camera: a coarse two-point line straddling the horizon (issue #1's case).
//     Before the fix the behind endpoint was dropped and the line vanished; now the
//     path runs from the on-screen front point out past the canvas edge.
{
  const W = 1000, H = 1000;
  const cam = makeCamera(raDecToVec(0, 0), [0, 0, 1], 90, W, H);
  const front = cam.projectStars([[30, 0, 0]])[0];   // facing = cos30 > 0, on-screen
  const behind = cam.projectStars([[120, 0, 0]])[0];  // facing = cos120 < 0
  const ctx = makeCtx();
  strokePolyline(ctx, [front, behind]);
  const ops = ctx.log;
  const moves = ops.filter(o => o.startsWith('moveTo')).length;
  const lines = ops.filter(o => o.startsWith('lineTo')).length;
  // exactly one moveTo (front) and one lineTo (to the clipped edge) — no drop.
  check('real straddle draws a clipped segment (not dropped)', moves === 1 && lines === 1,
    `ops = ${ops.join('|')}`);
  const lineOp = ops.find(o => o.startsWith('lineTo'));
  const m = lineOp && lineOp.match(/lineTo\(([^,]+),([^)]+)\)/);
  const lx = m && parseFloat(m[1]), ly = m && parseFloat(m[2]);
  const offscreen = m && (lx < 0 || lx > W || ly < 0 || ly > H);
  check('real straddle clip vertex is off the canvas', !!offscreen, `clip = ${lineOp}`);
}

// 12. REGRESSION (the iPhone freeze, 2026-08-15). The clipped vertex must stay
//     within a few canvas widths. Raw clipToNear divides by NEAR_EPS = 1e-6, and
//     in the running app that put vertices 655,967,956 px from the visible end of
//     their line, twelve per frame. Stroking paths that span half a million canvas
//     widths killed the GPU process: 15-62 SECOND freezes with the main thread
//     blocked, and webglcontextlost 59ms after one of them. It also broke
//     rendering — the equator's dashes were spread across those millions of
//     pixels, so the equator never appeared at all.
{
  const W = 1000, H = 1000;
  const cam = makeCamera(raDecToVec(0, 0), [0, 0, 1], 90, W, H);
  const front = cam.projectStars([[30, 0, 0]])[0];
  const behind = cam.projectStars([[120, 0, 0]])[0];

  const raw = clipToNear(front, behind);
  const rawDist = Math.hypot(raw.x - front.x, raw.y - front.y);
  check('unclamped clipToNear really does fly off to absurdity', rawDist > 1e5,
    `raw distance = ${rawDist}`);

  const ctx = makeCtx();
  strokePolyline(ctx, [front, behind]);
  const lineOp = ctx.log.find(o => o.startsWith('lineTo'));
  const m = lineOp && lineOp.match(/lineTo\(([^,]+),([^)]+)\)/);
  const dist = m && Math.hypot(parseFloat(m[1]) - front.x, parseFloat(m[2]) - front.y);
  const limit = 4 * Math.max(ctx.canvas.width, ctx.canvas.height);
  check('clipped vertex is clamped to a few screen widths',
    dist !== null && dist <= limit + 1,
    `distance = ${dist}, limit = ${limit}`);

  // Still off-canvas, so the line runs to the edge — issue #1 stays fixed.
  const stillOff = m && (parseFloat(m[1]) < 0 || parseFloat(m[1]) > W ||
                         parseFloat(m[2]) < 0 || parseFloat(m[2]) > H);
  check('clamped vertex is still off the canvas (issue #1 stays fixed)', !!stillOff,
    `clip = ${lineOp}`);
}

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
