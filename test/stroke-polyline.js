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
const clip = (a, b) => clipToNear(a, b);

function run(name, pts, close, expected) {
  const ctx = makeCtx();
  strokePolyline(ctx, pts, close);
  check(name, ctx.log.join('|') === expected.join('|'), `got ${ctx.log.join('|')}`);
}

// 1. All front-facing: one continuous stroke (unchanged).
run('all facing>0 draws one polyline', [P(1,2,1), P(3,4,1), P(5,6,1)], false,
  ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', 'lineTo(5,6)', 'stroke']);

// 2. Interior behind-camera point: clip OUT to the horizon on the way behind, then
//    clip back IN when the line re-emerges — no gap across the horizon.
{
  const pts = [P(1,2,1), P(3,4,-1), P(5,6,1), P(7,8,1)];
  run('interior facing<=0 clips out then back in', pts, false,
    ['beginPath', 'moveTo(1,2)', ln(clip(pts[0], pts[1])),
     mv(clip(pts[1], pts[2])), 'lineTo(5,6)', 'lineTo(7,8)', 'stroke']);
}

// 3. Leading behind-camera points: the line enters from the near-plane crossing of
//    the last behind point and the first front point.
{
  const pts = [P(0,0,-1), P(1,2,0), P(3,4,1), P(5,6,1)];
  run('leading facing<=0 enters from the crossing', pts, false,
    ['beginPath', mv(clip(pts[1], pts[2])), 'lineTo(3,4)', 'lineTo(5,6)', 'stroke']);
}

// 4. Trailing behind-camera point: the line runs out to the crossing instead of
//    stopping at the last front point.
{
  const pts = [P(1,2,1), P(3,4,1), P(5,6,-1)];
  run('trailing facing<=0 clips out to the edge', pts, false,
    ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', ln(clip(pts[1], pts[2])), 'stroke']);
}

// 5. close=true closes the final sub-path (phototile debug outline).
run('close=true closes before stroke', [P(1,2,1), P(3,4,1), P(5,6,1)], true,
  ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', 'lineTo(5,6)', 'closePath', 'stroke']);

// 6. facing == 0 counts as behind (strict > 0 required to be in front); the line
//    still enters from the crossing of the facing==0 point and the front point.
{
  const pts = [P(1,2,0), P(3,4,1)];
  run('facing==0 is behind, enters from crossing', pts, false,
    ['beginPath', mv(clip(pts[0], pts[1])), 'lineTo(3,4)', 'stroke']);
}

// 7. All behind-camera: no front point ever, so nothing is drawn (still begins/strokes).
run('all facing<=0 strokes empty path', [P(1,2,-1), P(3,4,0)], false,
  ['beginPath', 'stroke']);

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

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
