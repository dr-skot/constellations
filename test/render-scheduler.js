#!/usr/bin/env node
// Unit test for makeRenderScheduler (js/render-scheduler.js) — the single frame owner
// for the explorer (issues #53, #54).
//
// Before it, every input event drew the sky synchronously and two animation loops each
// owned a frame of their own, so a pinch during a north-arrow fade rendered the whole
// sky twice in one frame while touch events queued up behind it. The scheduler makes
// "one draw per frame" a property of the loop rather than of every caller remembering.
//
// The frame source is injected, so frames are advanced by hand here — no browser, no
// canvas, no real time. Only external behaviour is asserted: given a sequence of
// requests, ticks and frames, how many draws happened and in what order relative to
// the ticker state updates.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'render-scheduler.js'), 'utf8'),
  { filename: 'render-scheduler.js' });

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// A frame source the test drives by hand. Only one frame can be outstanding, which is
// what the real requestAnimationFrame gives you per handle too.
function harness(drawImpl) {
  const log = [];
  let pending = null, nextHandle = 1;
  let rafCalls = 0, cancelCalls = 0;

  const raf = cb => { rafCalls++; pending = cb; return nextHandle++; };
  const cancel = () => { cancelCalls++; pending = null; };
  const draw = () => { log.push('draw'); if (drawImpl) drawImpl(); };

  const s = makeRenderScheduler({ raf, cancel, draw });
  return {
    s, log,
    hasPending: () => pending !== null,
    rafCalls: () => rafCalls,
    cancelCalls: () => cancelCalls,
    // Run the scheduled frame, if there is one.
    frame(t) {
      const cb = pending;
      pending = null;
      if (cb) cb(t === undefined ? 0 : t);
    },
    draws: () => log.filter(e => e === 'draw').length,
  };
}

// ── 1. Many requests inside one frame collapse to a single draw ───────────────
// This is the whole point: a 120Hz touch stream must not produce 120 renders.
{
  const h = harness();
  h.s.request(); h.s.request(); h.s.request(); h.s.request();
  check('many requests schedule only one frame', h.rafCalls() === 1, `raf called ${h.rafCalls()}`);
  h.frame(0);
  check('many requests produce exactly one draw', h.draws() === 1, `drew ${h.draws()}`);
  check('quiescent after the draw', !h.hasPending());
}

// ── 2. No request, no work ────────────────────────────────────────────────────
{
  const h = harness();
  check('idle schedules no frame', h.rafCalls() === 0);
  h.frame(0);
  check('idle draws nothing', h.draws() === 0);
}

// ── 3. The last request is never dropped ──────────────────────────────────────
// The failure this guards against is subtle and specific: a dirty flag cleared at the
// wrong moment loses the final frame of a drag, so the sky comes to rest one frame
// behind the finger and stays there. Coalescing must never cost the last position.
{
  const h = harness();
  h.s.request();
  h.frame(0);
  check('a single request draws', h.draws() === 1);

  h.s.request();          // a second, separate gesture
  check('a later request schedules a fresh frame', h.hasPending());
  h.frame(16);
  check('the later request also draws', h.draws() === 2, `drew ${h.draws()}`);
}

// ── 4. A request made DURING a draw schedules exactly one more frame ──────────
// Draw handlers can legitimately request another draw (an image finishing loading
// mid-frame, say). That must produce one following frame, not a self-feeding loop.
{
  let drawsSeen = 0;
  const h = harness(() => {
    drawsSeen++;
    if (drawsSeen === 1) h.s.request();   // re-entrant request, once
  });
  h.s.request();
  h.frame(0);
  check('re-entrant request: one draw so far', h.draws() === 1);
  check('re-entrant request scheduled exactly one more frame', h.hasPending());
  check('re-entrant request did not double-schedule', h.rafCalls() === 2,
    `raf called ${h.rafCalls()}`);
  h.frame(16);
  check('re-entrant request drew once more', h.draws() === 2);
  check('re-entrant request then settles', !h.hasPending());
}

// ── 5. Tickers run before the draw, in the same frame ─────────────────────────
// If a ticker advanced state after the draw, every animation would render one frame
// stale — which is exactly the hazard of letting animation loops own their own frames.
{
  const order = [];
  const h = harness(() => order.push('draw'));
  h.s.addTicker(() => { order.push('tick'); return true; });
  h.frame(0);
  check('ticker runs before the draw', order.join(',') === 'tick,draw', order.join(','));
}

// ── 6. A live ticker keeps frames coming without anyone requesting ────────────
{
  const h = harness();
  h.s.addTicker(() => true);
  check('adding a ticker schedules a frame', h.hasPending());
  h.frame(0);
  check('a live ticker draws its frame', h.draws() === 1);
  check('a live ticker schedules the next frame', h.hasPending());
  h.frame(16);
  check('a live ticker keeps drawing', h.draws() === 2);
}

// ── 7. Two tickers plus input still yield ONE draw per frame ──────────────────
// The regression test for the bug this work exists to remove: a goto flight and a
// north-arrow fade overlapping a drag used to render the sky three times in a frame.
{
  const h = harness();
  let aTicks = 0, bTicks = 0;
  h.s.addTicker(() => { aTicks++; return true; });
  h.s.addTicker(() => { bTicks++; return true; });
  h.s.request(); h.s.request();
  h.frame(0);
  check('two tickers and two requests: exactly one draw', h.draws() === 1, `drew ${h.draws()}`);
  check('both tickers advanced', aTicks === 1 && bTicks === 1);
  h.frame(16);
  check('still one draw per frame on the next frame', h.draws() === 2);
}

// ── 8. A finished ticker is deregistered and its completion work runs once ────
{
  const h = harness();
  let ticks = 0, dones = 0;
  h.s.addTicker(() => { ticks++; return ticks < 2; }, () => { dones++; });
  h.frame(0);
  check('ticker still live after its first tick', ticks === 1 && dones === 0);
  h.frame(16);
  check('ticker finished on its second tick', ticks === 2);
  check('completion work ran exactly once', dones === 1, `ran ${dones}`);
  check('the finishing frame still drew', h.draws() === 2, `drew ${h.draws()}`);
  h.frame(32);
  check('a finished ticker does not tick again', ticks === 2);
  check('a finished ticker stops requesting frames', h.draws() === 2);
  check('completion work did not run twice', dones === 1);
}

// ── 8b. Completion work runs BEFORE the draw of the frame that finished ───────
// The goto flight leans on this: its completion snaps the camera to the exact target,
// and that snap has to be what gets rendered rather than the last eased approximation
// a frame earlier. If the order were reversed the flight would visibly stop one frame
// short of where it was told to go.
{
  const state = [];
  let value = 0;
  const h = harness(() => state.push('draw@' + value));
  let n = 0;
  h.s.addTicker(() => { n++; value = n; return n < 2; }, () => { value = 99; });
  h.frame(0);
  h.frame(16);
  check('completion work is visible to the draw it precedes',
    state.join(',') === 'draw@1,draw@99', state.join(','));
}

// ── 9. removeTicker stops it without running completion work ──────────────────
// Interrupting an animation (a new goto cancelling the one in flight) must not run the
// completion work of the animation it replaced — that would snap the camera to the
// abandoned target.
{
  const h = harness();
  let ticks = 0, dones = 0;
  const t = () => { ticks++; return true; };
  h.s.addTicker(t, () => { dones++; });
  h.frame(0);
  h.s.removeTicker(t);
  h.frame(16);
  check('removed ticker stops ticking', ticks === 1, `ticked ${ticks}`);
  check('removed ticker does not run completion work', dones === 0);
}

// ── 10. Removing a ticker mid-pass takes effect immediately ───────────────────
// The list is iterated as a snapshot so that adding or removing a ticker cannot make
// the pass skip its neighbour — but a ticker removed earlier in the same pass must not
// then be ticked. Otherwise an interrupted animation gets one extra tick after the
// thing that replaced it has already taken over.
{
  const h = harness();
  const seen = [];
  const b = () => { seen.push('b'); return true; };
  const a = () => { seen.push('a'); h.s.removeTicker(b); return true; };
  h.s.addTicker(a);
  h.s.addTicker(b);
  h.frame(0);
  check('a ticker removed mid-pass does not tick', seen.join(',') === 'a', seen.join(','));
  h.frame(16);
  check('the removed ticker stays gone', seen.join(',') === 'a,a', seen.join(','));
}

// ── 10b. Adding a ticker mid-pass does not disturb the pass ───────────────────
// A goto flight's completion work can legitimately start another animation.
{
  const h = harness();
  const seen = [];
  const late = () => { seen.push('late'); return true; };
  const first = () => { seen.push('first'); return true; };
  const starter = () => { seen.push('starter'); h.s.addTicker(late); return false; };
  h.s.addTicker(starter);
  h.s.addTicker(first);
  h.frame(0);
  check('a ticker added mid-pass waits for the next frame',
    seen.join(',') === 'starter,first', seen.join(','));
  h.frame(16);
  check('the added ticker runs from the next frame', seen.join(',') === 'starter,first,first,late',
    seen.join(','));
}

// ── 11. Tickers receive the frame timestamp ───────────────────────────────────
// The goto flight eases on elapsed time, so the timestamp has to arrive intact.
{
  const h = harness();
  const stamps = [];
  h.s.addTicker(t => { stamps.push(t); return true; });
  h.frame(100);
  h.frame(116);
  check('tickers receive the frame timestamp', stamps.join(',') === '100,116', stamps.join(','));
}

// ── 12. cancel clears everything ──────────────────────────────────────────────
{
  const h = harness();
  let ticks = 0;
  h.s.addTicker(() => { ticks++; return true; });
  h.s.request();
  h.s.cancel();
  check('cancel cancels the scheduled frame', h.cancelCalls() === 1);
  check('cancel leaves nothing pending', !h.hasPending());
  h.frame(0);
  check('cancel drops the outstanding request', h.draws() === 0, `drew ${h.draws()}`);
  check('cancel deregisters tickers', ticks === 0);
  h.s.request();
  h.frame(16);
  check('the scheduler is reusable after cancel', h.draws() === 1);
}

// ── 13. Requesting from inside a ticker is honoured by that same frame ────────
{
  const h = harness();
  h.s.addTicker(() => { h.s.request(); return true; });
  h.frame(0);
  check('a request from inside a ticker does not add a second draw', h.draws() === 1,
    `drew ${h.draws()}`);
}

// ── 14. Frame statistics (issue #56) ──────────────────────────────────────────
// The coalesce count is the number that answers the original complaint. Many requests
// collapsing into single frames means the input backlog is gone; roughly one request
// per draw means the input path was never the bottleneck and the per-phase numbers are
// the thing to act on. Both readings are useful, which is the point of taking them.
function statsHarness(drawMs) {
  let t = 0;
  const now = () => t;
  let pending = null, nextHandle = 1;
  const raf = cb => { pending = cb; return nextHandle++; };
  const cancel = () => { pending = null; };
  const draw = () => { t += (drawMs || 0); };
  const s = makeRenderScheduler({ raf, cancel, draw, now });
  return {
    s,
    at: v => { t = v; },
    advance: v => { t += v; },
    frame(ts) { const cb = pending; pending = null; if (cb) cb(ts === undefined ? 0 : ts); },
  };
}

{
  const h = statsHarness(0);
  h.s.request(); h.s.request(); h.s.request();
  h.frame(0);
  const st = h.s.stats();
  check('stats: one draw recorded', st.draws === 1, `got ${st.draws}`);
  check('stats: three requests counted', st.requests === 3, `got ${st.requests}`);
  check('stats: three requests coalesced into the draw', st.coalesced.max === 3,
    `got ${st.coalesced.max}`);
}

{
  const h = statsHarness(0);
  // One request per frame, three frames: no coalescing is happening at all.
  for (let i = 0; i < 3; i++) { h.s.request(); h.frame(i * 16); }
  const st = h.s.stats();
  check('stats: one request per draw means a mean of 1', st.coalesced.mean === 1,
    `got ${st.coalesced.mean}`);
  check('stats: three draws', st.draws === 3);
}

{
  // A ticker-driven frame coalesces no requests, and says so rather than reporting 1.
  const h = statsHarness(0);
  h.s.addTicker(() => true);
  h.frame(0);
  check('stats: an animation frame coalesces no requests', h.s.stats().coalesced.max === 0,
    `got ${h.s.stats().coalesced.max}`);
}

{
  // Draw duration comes from the injected clock, so it is exact here.
  const h = statsHarness(7);
  h.s.request(); h.frame(0);
  h.s.request(); h.frame(16);
  const st = h.s.stats();
  check('stats: draw duration is measured', st.drawMs.mean === 7, `got ${st.drawMs.mean}`);
  check('stats: draw duration max', st.drawMs.max === 7);
}

{
  const h = statsHarness(0);
  const s2 = h.s;
  check('stats: empty is safe to render',
    s2.stats().draws === 0 && s2.stats().coalesced.mean === 0 && s2.stats().drawMs.mean === 0);
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
