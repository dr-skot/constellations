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
// The finding guide's controls, faked just far enough to render into and click (issue
// #60). Everything NOT in this map still answers null — the canvases especially, since
// drawExplore bailing at its missing canvas is what keeps this file affordable.
const elements = {};
function fakeElement(id) {
  const handlers = {};
  return {
    id, style: {}, textContent: '', innerHTML: '',
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    click() { for (const fn of handlers.click || []) fn(); },
  };
}
for (const id of ['fg-step-dots', 'fg-step-count', 'fg-caption-label', 'fg-caption-text',
                  'fg-btn-prev', 'fg-btn-next', 'fg-btn-toggle-diag', 'fg-back-btn']) {
  elements[id] = fakeElement(id);
}
global.document = { getElementById: id => elements[id] || null, querySelector: () => null };
global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = global;
// guide-renderer.js registers a resize listener at load. Everything else it touches
// is inside a function, so the module loads here without a canvas.
global.addEventListener = () => {};

const jsDir = path.join(__dirname, '..', 'js');
const origLog = console.log; console.log = () => {};
// Loaded in the order index.html and find-help.html load them: these are plain scripts
// sharing a global scope, so load order is part of what this file claims to cover.
for (const f of ['draw-phases.js', 'render-scheduler.js', 'projection.js', 'explore.js',
                 'step-display.js', 'guide-renderer.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}
console.log = origLog;

// The annotation painter is the one part of the guide that genuinely needs a canvas
// pair: it reads explore-canvas for its dimensions before it looks at anything else.
// Standing in for it here keeps the guide's step-to-step path drivable — the nav and
// the published display are what these tests are about, not what gets painted.
let annotationDraws = 0;
globalThis.guideDrawAnnotation = () => { annotationDraws++; };

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

// ══ An interrupted flight leaves the guide navigable (issue #60) ══════════════
// Sections 9–11 prove the CAMERA stands down correctly when a flight is abandoned.
// What they do not prove is that the GUIDE survives it: `animating` gates both the
// nav's visibility and its handlers, and until #60 nothing cleared it on an abort, so
// grabbing the sky mid-step hid Back and Next and disabled them at once — no second
// path out, reload only. These drive the real buttons through the fake elements above.

const CATALOG = {
  Betelgeuse: { ra: 88.79, dec: 7.41, mag: 0.5 },
  Rigel:      { ra: 78.63, dec: -8.2, mag: 0.1 },
};
// Both of the first two steps carry overlays, and they share none: the guide only
// intersects when the step it is LEAVING has something showing, so a bare first step
// would publish the arriving display in full and hide the difference section 17 turns on.
const GUIDE_STEPS = [
  { ra: 80, dec:  5, fov: 60, rotation: 0, title: 'The belt',   caption: 'Three stars in a row.',
    highlight: ['Rigel'] },
  { ra: 88, dec:  7, fov: 40, rotation: 0, title: 'The Hunter', caption: 'Betelgeuse and Rigel.',
    diagram: true, highlight: ['Betelgeuse'] },
  { ra: 95, dec: -8, fov: 25, rotation: 0, title: 'The sword',  caption: 'Below the belt.' },
];

const el       = id => elements[id];
const counter  = () => el('fg-step-count').textContent;
const caption  = () => el('fg-caption-label').textContent;
const navShown = () => ({ prev: el('fg-btn-prev').style.visibility,
                          next: el('fg-btn-next').style.visibility });
const offFrom  = v => Math.abs(explore.P[0] - v[0]) + Math.abs(explore.P[1] - v[1]) +
                      Math.abs(explore.P[2] - v[2]);
function land() { for (let i = 0; i < 400 && rafQueue.length; i++) { clock += 16; runFrames(clock); } }

// Put the guide on step 1 and set it flying to `to`, then run `frames` frames — the
// state a learner is in at the moment their hand lands on the sky.
function guideFlyingTo(to, frames) {
  stopCameraAnimation();
  guideStop();                                   // no leftover guide from the case before
  for (let i = 0; i < 10 && rafQueue.length; i++) { clock += 16; runFrames(clock); }
  clock += 1000;
  guideStart(GUIDE_STEPS.map(s => Object.assign({}, s)), CATALOG);
  guideGoTo(to);
  for (let i = 0; i < frames; i++) { clock += 16; runFrames(clock); }
}

// ── 13. The nav hides for an ordinary transition and returns on landing ───────
// The behaviour #60 must not disturb: mid-flight is still no time to offer a control.
{
  guideFlyingTo(1, 2);
  const flying = navShown();
  check('the nav hides during an ordinary flight',
    flying.prev === 'hidden' && flying.next === 'hidden', JSON.stringify(flying));
  land();
  const landed = navShown();
  check('the nav returns when the flight lands',
    landed.prev === 'visible' && landed.next === 'visible', JSON.stringify(landed));
}

// ── 14. Grabbing the sky mid-flight brings the nav back ──────────────────────
{
  guideFlyingTo(1, 2);
  const partway = explore.P.slice(), partwayFov = explore.fov;
  check('the flight is genuinely partway, not landed', partwayFov !== GUIDE_STEPS[1].fov,
    `fov ${partwayFov}`);

  stopCameraAnimation();                         // exactly what dragStart calls
  const nav = navShown();
  check('grabbing the sky mid-flight leaves Next visible', nav.next === 'visible', nav.next);
  check('grabbing the sky mid-flight leaves Back visible', nav.prev === 'visible', nav.prev);
  check('the interrupt leaves the counter on the step', counter() === '2 / 3', counter());
  check('the interrupt leaves the caption on the step', caption() === 'The Hunter', caption());

  land();
  check('the interrupt does not snap the camera to the step',
    offFrom(partway) === 0 && explore.fov === partwayFov,
    `moved ${offFrom(partway)}, fov ${explore.fov}`);
  check('the interrupt does not advance the guide on its own', counter() === '2 / 3', counter());
}

// ── 15. Next still advances after an interrupt, from where the learner is ────
{
  guideFlyingTo(1, 2);
  stopCameraAnimation();
  el('fg-btn-next').click();
  check('Next advances the guide after an interrupt', counter() === '3 / 3', counter());
  check('the last step offers the exit', el('fg-btn-next').textContent === 'Done ✓',
    el('fg-btn-next').textContent);

  land();
  const target = raDecToVec(GUIDE_STEPS[2].ra, GUIDE_STEPS[2].dec);
  check('the guide flies on to the next step', offFrom(target) < 1e-12, `off by ${offFrom(target)}`);
  check('and lands on its field of view', explore.fov === GUIDE_STEPS[2].fov, `fov ${explore.fov}`);
}

// ── 16. Back still retreats after an interrupt ───────────────────────────────
{
  guideFlyingTo(2, 2);
  stopCameraAnimation();
  el('fg-btn-prev').click();
  check('Back retreats after an interrupt', counter() === '2 / 3', counter());
  land();
  const target = raDecToVec(GUIDE_STEPS[1].ra, GUIDE_STEPS[1].dec);
  check('Back flies to the previous step', offFrom(target) < 1e-12, `off by ${offFrom(target)}`);
}

// ── 17. The interrupt settles the guide onto the step's own display ──────────
// Mid-flight the guide publishes the intersection of departing and arriving steps, so
// nothing pops in mid-motion. Left in place after an interrupt it would make Hide
// overlays toggle against a set belonging to neither step.
{
  guideFlyingTo(1, 2);
  check('mid-flight only what both steps share is published',
    explore.stepDisplay.marks.length === 0 && explore.stepDisplay.layers.diagram.on === false,
    JSON.stringify(explore.stepDisplay.layers.diagram));

  stopCameraAnimation();
  check('the interrupt publishes the step\'s own marks',
    explore.stepDisplay.marks.length === 1 && explore.stepDisplay.marks[0].label === 'Betelgeuse',
    JSON.stringify(explore.stepDisplay.marks));
  check('the interrupt publishes the step\'s own layers',
    explore.stepDisplay.layers.diagram.on === true,
    JSON.stringify(explore.stepDisplay.layers.diagram));
}

// ── 18. A replaced flight does not disturb the flight replacing it ───────────
// Starting a flight stops the one before it, so the abort of the OLD flight fires while
// the NEW step has already declared itself animating. Without a per-flight token that
// abort clears the new flight's flag and the nav stays up through the whole transition.
{
  guideFlyingTo(1, 2);
  guideGoTo(2);                                  // replaces the flight in the air
  const nav = navShown();
  check('a replaced flight does not un-hide the replacing flight\'s nav',
    nav.next === 'hidden' && nav.prev === 'hidden', JSON.stringify(nav));
  land();
  check('the replacing flight still returns the nav on landing',
    navShown().next === 'visible', navShown().next);
  check('the replacing flight is the one that lands', counter() === '3 / 3', counter());
}

// ── 19. A flight abandoned after the guide is gone is harmless ───────────────
// exitFindGuide's own path, and it never calls stopCameraAnimation itself: guideStop
// nulls the session, the view is restored, and the flight stands down on its NEXT frame
// when shouldContinue goes false. So the abort fires re-entrantly, from inside the
// scheduler's ticker pass — the ordering the app actually takes. Driving it with `land()`
// rather than an explicit stop is what puts the test on that path.
{
  guideFlyingTo(1, 2);
  const parked = explore.P.slice(), parkedFov = explore.fov;
  let threw = null;
  try {
    guideStop();
    land();
  } catch (e) { threw = e; }
  check('abandoning a flight after the guide is gone does not throw', threw === null,
    threw && (threw.message + ' @ ' + String(threw.stack).split('\n')[1]));
  check('and does not move the view the exit restored',
    offFrom(parked) === 0 && explore.fov === parkedFov,
    `moved ${offFrom(parked)}, fov ${explore.fov}`);
  check('and stops asking for frames', rafQueue.length === 0, `${rafQueue.length} queued`);
}

// ── 20. A dead session's flight cannot speak for the guide that follows ──────
// Tearing a guide down leaves its flight registered until the next frame. If flight
// numbers restarted with each session, the new guide's first flight would be handed the
// number the dead one is still holding, and starting it — which stops the dead flight —
// would fire an abort that passes the guard and un-hides the new guide's nav.
{
  guideFlyingTo(1, 2);                             // session A, flight in the air
  guideStop();                                     // torn down, no frame run
  clock += 16;
  guideStart(GUIDE_STEPS.map(s => Object.assign({}, s)), CATALOG);
  guideGoTo(1);                                    // session B: stops A, fires A's abort
  const nav = navShown();
  check('a dead session\'s abort does not un-hide the next guide\'s nav',
    nav.next === 'hidden' && nav.prev === 'hidden', JSON.stringify(nav));
  check('nor settle the new flight onto its destination early',
    explore.stepDisplay.marks.length === 0, JSON.stringify(explore.stepDisplay.marks));
  land();
  check('the new guide still lands normally', navShown().next === 'visible' && counter() === '2 / 3',
    `${navShown().next} ${counter()}`);
}

// ── 21. Hiding the overlays mid-flight survives the interrupt ────────────────
// The toggle is not hidden during a transition, so the learner can press it and then
// grab the sky. Settling onto the step must respect that answer, or the button says
// "Show overlays" over overlays that are already showing and clicking it does nothing.
{
  guideFlyingTo(1, 2);
  el('fg-btn-toggle-diag').click();                // hidden mid-transition
  stopCameraAnimation();
  check('the interrupt keeps the learner\'s Hide overlays answer',
    explore.stepDisplay.marks.length === 0 && explore.stepDisplay.layers.diagram.on === false,
    JSON.stringify(explore.stepDisplay.layers));
  check('and the button still offers to show them',
    el('fg-btn-toggle-diag').textContent === 'Show overlays', el('fg-btn-toggle-diag').textContent);

  el('fg-btn-toggle-diag').click();                // and showing them works
  check('showing them again brings the step\'s overlays back',
    explore.stepDisplay.marks.length === 1 && explore.stepDisplay.layers.diagram.on === true,
    JSON.stringify(explore.stepDisplay.marks));
}

// ── 22. Landing respects the same answer ─────────────────────────────────────
{
  guideFlyingTo(1, 2);
  el('fg-btn-toggle-diag').click();                // hidden mid-transition
  land();
  check('landing keeps the learner\'s Hide overlays answer',
    explore.stepDisplay.marks.length === 0, JSON.stringify(explore.stepDisplay.marks));
  check('and the button still offers to show them',
    el('fg-btn-toggle-diag').textContent === 'Show overlays', el('fg-btn-toggle-diag').textContent);
}

// ── 23. The exit says where it goes, for as long as the guide is open ────────
// The caller names the destination (guideExitLabel, issue #66); the renderer's job
// is to put it on the button and keep it there — the label belongs to the guide, not to
// the step, so stepping must not overwrite it. find-help.html has no #fg-back-btn and
// passes no label, which is why the write is guarded on both.
{
  guideStop();
  guideStart(GUIDE_STEPS.map(s => Object.assign({}, s)), CATALOG,
             { exitLabel: '← Back to lesson' });
  check('the exit carries the caller\'s label',
    el('fg-back-btn').textContent === '← Back to lesson', el('fg-back-btn').textContent);

  el('fg-btn-next').click();
  land();
  check('and keeps it across a step',
    el('fg-back-btn').textContent === '← Back to lesson', el('fg-back-btn').textContent);

  // A guide started without one leaves whatever the markup says — the find-help.html case.
  el('fg-back-btn').textContent = 'untouched';
  guideStop();
  guideStart(GUIDE_STEPS.map(s => Object.assign({}, s)), CATALOG);
  check('a guide with no label of its own leaves the button alone',
    el('fg-back-btn').textContent === 'untouched', el('fg-back-btn').textContent);
  land();
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
