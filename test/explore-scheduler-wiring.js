#!/usr/bin/env node
// Integration test for the explorer's side of the render scheduler (issues #53–#55).
//
// test/render-scheduler.js proves the scheduler coalesces correctly in isolation. This
// proves explore.js is actually WIRED to it: that requestExploreDraw reaches a real
// frame, that the goto flight and north-arrow fade are registered as tickers rather
// than owning frames, and that the whole path runs without a missing global. That last
// point is the one a pure unit test cannot cover and a syntax check cannot see — the
// modules are plain scripts sharing a global scope, so a renamed function fails only
// when the line executes.
//
// drawExplore itself bails at its first line here (no canvas in node), which is what
// makes this affordable: everything up to and including the call is exercised, and
// nothing that needs a rendering context is.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Minimum browser the modules need to load and schedule ─────────────────────
let rafQueue = [];
let rafCalls = 0, cancelCalls = 0;
let clock = 0;

global.requestAnimationFrame = cb => { rafCalls++; rafQueue.push(cb); return rafQueue.length; };
global.cancelAnimationFrame = () => { cancelCalls++; rafQueue = []; };
global.performance = { now: () => clock };
global.document = { getElementById: () => null, querySelector: () => null };
global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = global;

const jsDir = path.join(__dirname, '..', 'js');
const origLog = console.log; console.log = () => {};
for (const f of ['draw-phases.js', 'render-scheduler.js', 'projection.js', 'explore.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// Run every frame the scheduler has queued, once each.
function runFrames(t) {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(t === undefined ? clock : t);
}

// ── 1. requestExploreDraw reaches a real frame without throwing ───────────────
{
  let threw = null;
  try {
    requestExploreDraw();
    check('a request schedules exactly one frame', rafCalls === 1, `raf called ${rafCalls}`);
    runFrames(0);
  } catch (e) { threw = e; }
  // Names the scope honestly: this covers request → schedule → frame → the call into
  // drawExplore, which then returns at its canvas guard. The body of drawExplore, and
  // therefore the phase marks inside it, are NOT exercised here.
  check('the request-to-frame path runs with no missing global', threw === null,
    threw && (threw.message + ' @ ' + String(threw.stack).split('\n')[1]));
}

// ── 2. A burst of requests collapses to one frame, end to end ─────────────────
{
  const before = rafCalls;
  for (let i = 0; i < 20; i++) requestExploreDraw();
  check('twenty requests schedule one frame', rafCalls === before + 1,
    `raf called ${rafCalls - before} times`);
  runFrames(16);
}

// ── 3. The north-arrow fade is a ticker, not a frame owner ────────────────────
// It must advance its alpha on the scheduler's frames. If it still owned frames, this
// would be where a pinch during a fade started rendering the sky twice.
{
  explore._northAlpha = 0;
  const before = rafCalls;
  showNorthArrow();
  check('showing the arrow schedules a frame', rafCalls === before + 1);
  runFrames(0);
  check('the fade advances on a scheduler frame', explore._northAlpha > 0,
    `alpha ${explore._northAlpha}`);
  const mid = explore._northAlpha;
  runFrames(16);
  check('the fade keeps advancing', explore._northAlpha > mid);

  // Re-registering mid-fade must not stack a second ticker.
  const before2 = rafCalls;
  showNorthArrow(); showNorthArrow(); showNorthArrow();
  check('re-showing the arrow does not stack tickers', rafCalls === before2,
    `raf called ${rafCalls - before2} extra times`);
}

// ── 4. The fade completes and deregisters ─────────────────────────────────────
{
  explore._northAlpha = 0;
  showNorthArrow();
  for (let i = 0; i < 200 && rafQueue.length; i++) runFrames(i * 16);
  check('the fade reaches its target', explore._northAlpha === 1, `alpha ${explore._northAlpha}`);
  check('a completed fade stops asking for frames', rafQueue.length === 0);
}

// ── 5. The goto flight is a ticker, and lands exactly on target ───────────────
// Completion work runs on deregistration, before that frame's draw, so the camera
// snaps to the exact destination rather than stopping at the last eased step.
{
  explore.P = raDecToVec(0, 0);
  clock = 1000;
  animateGoTo(90, 30);
  check('a goto flight schedules a frame', rafQueue.length > 0);

  const target = raDecToVec(90, 30);
  for (let i = 0; i < 300 && rafQueue.length; i++) {
    clock += 16;
    runFrames(clock);
  }
  const off = Math.abs(explore.P[0] - target[0]) + Math.abs(explore.P[1] - target[1]) +
              Math.abs(explore.P[2] - target[2]);
  check('the flight lands exactly on target', off < 1e-12, `off by ${off}`);
  check('a finished flight stops asking for frames', rafQueue.length === 0);
}

// ── 6. Interrupting a flight does not run its completion work ─────────────────
// stopCameraAnimation is what a drag start calls. If it ran the abandoned flight's
// completion, grabbing the sky mid-flight would snap it to the place you interrupted.
{
  explore.P = raDecToVec(0, 0);
  clock = 5000;
  animateGoTo(90, 30);
  clock += 16;
  runFrames(clock);
  const partway = explore.P.slice();
  stopCameraAnimation();
  clock += 16;
  runFrames(clock);
  const moved = Math.abs(explore.P[0] - partway[0]) + Math.abs(explore.P[1] - partway[1]) +
                Math.abs(explore.P[2] - partway[2]);
  check('an interrupted flight stops where it was', moved === 0, `moved ${moved}`);
}

// ── 7. The scheduler is reporting statistics for the readout ──────────────────
{
  const st = exploreScheduler().stats();
  check('statistics are available to the probe', st && typeof st.draws === 'number');
  check('statistics counted the requests made here', st.requests > 20, `got ${st.requests}`);
  check('statistics counted draws', st.draws > 0, `got ${st.draws}`);
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
