#!/usr/bin/env node
// Unit test for strokePolyline (js/explore.js, Candidate 5 part A).
// A fake 2D context records the exact beginPath/moveTo/lineTo/closePath/stroke
// call sequence. strokePolyline must reproduce the pre-refactor pen-up behavior:
// lift the pen wherever a point has facing <= 0 (drop the crossing segment, do
// NOT clip to the horizon — see issue #1), owning beginPath + the final stroke.

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

function run(name, pts, close, expected) {
  const ctx = makeCtx();
  strokePolyline(ctx, pts, close);
  check(name, ctx.log.join('|') === expected.join('|'), `got ${ctx.log.join('|')}`);
}

// 1. All front-facing: one continuous stroke.
run('all facing>0 draws one polyline', [P(1,2,1), P(3,4,1), P(5,6,1)], false,
  ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', 'lineTo(5,6)', 'stroke']);

// 2. Interior behind-camera point breaks the path (segment dropped, pen re-downs).
run('interior facing<=0 lifts the pen', [P(1,2,1), P(3,4,-1), P(5,6,1), P(7,8,1)], false,
  ['beginPath', 'moveTo(1,2)', 'moveTo(5,6)', 'lineTo(7,8)', 'stroke']);

// 3. Leading behind-camera points are skipped until the first front point.
run('leading facing<=0 skipped', [P(0,0,-1), P(1,2,0), P(3,4,1), P(5,6,1)], false,
  ['beginPath', 'moveTo(3,4)', 'lineTo(5,6)', 'stroke']);

// 4. Trailing behind-camera point does not extend the line.
run('trailing facing<=0 ends the line', [P(1,2,1), P(3,4,1), P(5,6,-1)], false,
  ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', 'stroke']);

// 5. close=true closes the final sub-path (phototile debug outline).
run('close=true closes before stroke', [P(1,2,1), P(3,4,1), P(5,6,1)], true,
  ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', 'lineTo(5,6)', 'closePath', 'stroke']);

// 6. facing == 0 counts as behind (strict > 0 required to draw).
run('facing==0 is behind', [P(1,2,0), P(3,4,1)], false,
  ['beginPath', 'moveTo(3,4)', 'stroke']);

// 7. All behind-camera: empty path, still begins and strokes (no-op raster).
run('all facing<=0 strokes empty path', [P(1,2,-1), P(3,4,0)], false,
  ['beginPath', 'stroke']);

// 8. Default close arg is false.
{
  const ctx = makeCtx();
  strokePolyline(ctx, [P(1,2,1), P(3,4,1)]);
  check('close defaults to false', ctx.log.join('|') === ['beginPath', 'moveTo(1,2)', 'lineTo(3,4)', 'stroke'].join('|'));
}

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
