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
// guide-renderer.js registers a resize listener at load. Everything else it touches
// is inside a function, so the module loads here without a canvas.
global.addEventListener = () => {};

const jsDir = path.join(__dirname, '..', 'js');
const origLog = console.log; console.log = () => {};
for (const f of ['draw-phases.js', 'render-scheduler.js', 'projection.js', 'explore.js',
                 'guide-renderer.js']) {
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

// ══ The finding-guide camera flight (issue #58) ═══════════════════════════════
// The guide flight was the explorer's last frame owner: it ran its own
// requestAnimationFrame loop and only REQUESTED the sky draw, which meant the camera
// could be moved after the frame that drew it had already run. As a ticker the move
// always precedes the draw of the same frame — that ordering is invariant 3 of
// test/render-scheduler.js, so what is worth proving HERE is that the flight is
// actually registered as a ticker and interruptible through the same door as the goto.

// A step is the shape guideAnimateTo reads: a camera destination.
const STEP_A = { ra: 90, dec: 30, fov: 40, rotation: 0 };
const STEP_B = { ra: 200, dec: -20, fov: 25, rotation: 0 };
const noAnnotation = () => {};

// Fly to `step` and hand back the bookkeeping the assertions need.
function startGuideFlight(step, opts = {}) {
  const seen = { done: 0, annotations: 0 };
  guideAnimateTo(
    step,
    null,
    d => { seen.annotations++; },
    () => { seen.done++; },
    opts.shouldContinue,
  );
  return seen;
}

// ── 8. The guide flight is a ticker, and lands exactly on the step's view ─────
{
  explore.P = raDecToVec(0, 0); explore.fov = 60; explore.R = 0;
  clock = 20000;
  const seen = startGuideFlight(STEP_A);
  check('a guide flight schedules a frame', rafQueue.length > 0);

  for (let i = 0; i < 400 && rafQueue.length; i++) { clock += 16; runFrames(clock); }

  const target = raDecToVec(STEP_A.ra, STEP_A.dec);
  const off = Math.abs(explore.P[0] - target[0]) + Math.abs(explore.P[1] - target[1]) +
              Math.abs(explore.P[2] - target[2]);
  check('the guide flight lands exactly on the step position', off < 1e-12, `off by ${off}`);
  check('the guide flight lands exactly on the step fov', explore.fov === STEP_A.fov,
    `fov ${explore.fov}`);
  check('the guide flight lands exactly on the step roll',
    explore.R === guideNorthUpR(target) + STEP_A.rotation, `R ${explore.R}`);
  check('completion work ran exactly once', seen.done === 1, `ran ${seen.done} times`);
  check('the annotation was redrawn per frame', seen.annotations > 1,
    `drawn ${seen.annotations} times`);
  check('a finished guide flight stops asking for frames', rafQueue.length === 0);
}

// ── 9. A flight interrupted before its FIRST frame really stops ───────────────
// This is the latent bug the ticker conversion removes. The old flight recorded its
// frame handle on every frame except the first, so a flight that had only been
// scheduled — the exact state a learner is in when they grab the sky the instant a
// step begins — had nothing for stopCameraAnimation to cancel, and flew on regardless.
{
  explore.P = raDecToVec(0, 0); explore.fov = 60; explore.R = 0;
  clock = 30000;
  const seen = startGuideFlight(STEP_A);
  const before = explore.P.slice();

  stopCameraAnimation();                       // interrupt with no frame yet run
  for (let i = 0; i < 5; i++) { clock += 16; runFrames(clock); }

  const moved = Math.abs(explore.P[0] - before[0]) + Math.abs(explore.P[1] - before[1]) +
                Math.abs(explore.P[2] - before[2]);
  check('a flight stopped before its first frame does not move the camera', moved === 0,
    `moved ${moved}`);
  check('a flight stopped before its first frame does not run completion work',
    seen.done === 0, `ran ${seen.done} times`);
}

// ── 10. Aborting mid-flight leaves the camera where it was interrupted ────────
// shouldContinue going false is the guide being torn down under a flight. It is an
// abort, not a finish: running completion would snap the camera onto the destination
// the guide had just been told to abandon.
{
  explore.P = raDecToVec(0, 0); explore.fov = 60; explore.R = 0;
  clock = 40000;
  let alive = true;
  const seen = startGuideFlight(STEP_A, { shouldContinue: () => alive });

  clock += 16; runFrames(clock);
  clock += 16; runFrames(clock);
  const partway = explore.P.slice(), partwayFov = explore.fov;
  check('the flight is genuinely partway, not landed', partwayFov !== STEP_A.fov,
    `fov ${partwayFov}`);

  alive = false;
  for (let i = 0; i < 5; i++) { clock += 16; runFrames(clock); }

  const moved = Math.abs(explore.P[0] - partway[0]) + Math.abs(explore.P[1] - partway[1]) +
                Math.abs(explore.P[2] - partway[2]);
  check('an aborted flight stops where it was', moved === 0, `moved ${moved}`);
  check('an aborted flight does not snap to the abandoned destination',
    explore.fov === partwayFov, `fov ${explore.fov}`);
  check('an aborted flight does not run completion work', seen.done === 0,
    `ran ${seen.done} times`);
  check('an aborted flight stops asking for frames', rafQueue.length === 0);
}

// ── 11. The two kinds of flight interrupt each other, from the first frame ────
{
  // A guide flight replaces a goto that has only just started.
  explore.P = raDecToVec(0, 0); explore.fov = 60; explore.R = 0;
  clock = 50000;
  animateGoTo(90, 30);
  const gotoTarget = raDecToVec(90, 30);
  startGuideFlight(STEP_B);                    // no frames run in between
  for (let i = 0; i < 400 && rafQueue.length; i++) { clock += 16; runFrames(clock); }

  const stepTarget = raDecToVec(STEP_B.ra, STEP_B.dec);
  const offStep = Math.abs(explore.P[0] - stepTarget[0]) + Math.abs(explore.P[1] - stepTarget[1]) +
                  Math.abs(explore.P[2] - stepTarget[2]);
  const offGoto = Math.abs(explore.P[0] - gotoTarget[0]) + Math.abs(explore.P[1] - gotoTarget[1]) +
                  Math.abs(explore.P[2] - gotoTarget[2]);
  check('a guide flight replaces a just-started goto', offStep < 1e-12, `off by ${offStep}`);
  check('the replaced goto did not land its own target', offGoto > 1e-6);

  // And a goto replaces a guide flight that has only just started.
  explore.P = raDecToVec(0, 0); explore.fov = 60; explore.R = 0;
  clock = 60000;
  const seen = startGuideFlight(STEP_A);
  animateGoTo(200, -20);                       // no frames run in between
  for (let i = 0; i < 400 && rafQueue.length; i++) { clock += 16; runFrames(clock); }

  const t2 = raDecToVec(200, -20);
  const off2 = Math.abs(explore.P[0] - t2[0]) + Math.abs(explore.P[1] - t2[1]) +
               Math.abs(explore.P[2] - t2[2]);
  check('a goto replaces a just-started guide flight', off2 < 1e-12, `off by ${off2}`);
  check('the replaced guide flight did not run its completion work', seen.done === 0,
    `ran ${seen.done} times`);
}

// ── 12. The last shared frame handle is gone ─────────────────────────────────
{
  check('explore.animFrame no longer exists', !('animFrame' in explore),
    `still ${JSON.stringify(explore.animFrame)}`);
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
