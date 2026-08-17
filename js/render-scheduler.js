// ═══════════════════════════════════════════════════════════
// RENDER SCHEDULER — the explorer's single frame owner (issue #53)
// ═══════════════════════════════════════════════════════════
// Rendering is a property of the frame, not of the input event.
//
// Before this, drag, pinch and wheel each redrew the sky synchronously on every event.
// iOS samples touches at 60–120Hz whether or not a frame is wanted, so once a redraw
// cost more than the gap between events they queued instead of dropping: every frame
// showed a finger position several events old, and the sky kept moving after release.
// Two animation loops (the goto flight and the north-arrow fade) each owned a frame of
// their own on top of that, so a pinch during a fade rendered the whole sky twice.
//
// Callers now REQUEST a draw and animations register as TICKERS. A frame runs every
// ticker, then draws at most once. That makes one-draw-per-frame a property of this
// loop rather than of sixteen callers each remembering to coalesce.
//
// Pure: the frame source, its canceller, and the draw itself are all injected, so
// test/render-scheduler.js advances frames by hand with no browser and no canvas.
//
// FOUR INVARIANTS, all pinned by that test:
//   1. At most one draw per frame, however many requests or tickers are live.
//   2. Never ZERO draws for an outstanding request. A dirty flag cleared at the wrong
//      moment loses the last frame of a drag, leaving the sky at rest one frame behind
//      the finger — trading the reported lag for a subtler version of itself.
//   3. Tickers run BEFORE the draw in the same frame, so no tick renders stale state.
//   4. cancel() leaves no scheduled frame and no registered tickers.
//
// opts.raf    (cb) -> handle    normally requestAnimationFrame
// opts.cancel (handle) -> void  normally cancelAnimationFrame
// opts.draw   () -> void        normally drawExplore
// opts.now    () -> ms          injected so the statistics are exact under test
// opts.window  how many recent draws the statistics average over (default 60)
function makeRenderScheduler(opts) {
  const raf = opts.raf;
  const cancelFrame = opts.cancel;
  const draw = opts.draw;
  const now = opts.now || (() => performance.now());
  const statsWindow = opts.window || 60;

  let handle = null;
  let dirty = false;
  const tickers = [];   // [{ tick, done }]

  // Statistics come free — the scheduler already knows everything worth reporting
  // (issue #56). `coalesced` is the one that answers the original complaint: requests
  // collapsing into single frames is the input backlog being absorbed rather than
  // queueing. A ticker-driven frame coalesces nothing and reports 0, which is a real
  // reading and not the same as 1.
  let totalDraws = 0, totalRequests = 0, sinceDraw = 0;
  const drawLog = [];   // [{ requests, ms }], newest last

  // Idempotent by design — this is what collapses a burst of requests into one frame.
  function schedule() {
    if (handle === null) handle = raf(frame);
  }

  function frame(t) {
    // Cleared FIRST, so a request arriving during the ticker pass or the draw below
    // schedules the next frame rather than being swallowed by an already-spent handle.
    handle = null;

    const ran = tickers.length > 0;
    if (ran) {
      // Iterate a snapshot: a ticker's completion work may add or remove tickers, and
      // mutating the live array mid-pass would skip its neighbour. Membership is
      // re-checked per entry so a ticker removed earlier in THIS pass does not tick.
      const snapshot = tickers.slice();
      for (const entry of snapshot) {
        if (tickers.indexOf(entry) === -1) continue;
        // A ticker returns false to say it has finished. Anything else keeps it live,
        // so a ticker that forgets to return a value stays running rather than
        // silently vanishing mid-animation.
        if (entry.tick(t) === false) {
          const i = tickers.indexOf(entry);
          if (i !== -1) tickers.splice(i, 1);
          // Completion work runs on deregistration, exactly once — for the goto flight
          // that is snapping to the target, clearing the name cache and saving state.
          if (entry.done) entry.done();
        }
      }
      // A ticker advanced state, so the frame must be rendered even if nothing else
      // asked for it. This is what lets animations stop calling for frames themselves.
      dirty = true;
    }

    if (dirty) {
      dirty = false;
      const t0 = now();
      draw();
      drawLog.push({ requests: sinceDraw, ms: now() - t0 });
      while (drawLog.length > statsWindow) drawLog.shift();
      sinceDraw = 0;
      totalDraws++;
    }

    // Keep the loop alive while animations run, or if the draw itself asked for
    // another frame. schedule() is idempotent, so this cannot double-book.
    if (tickers.length || dirty) schedule();
  }

  function request() {
    dirty = true;
    sinceDraw++;
    totalRequests++;
    schedule();
  }

  function stats() {
    const n = drawLog.length;
    let rSum = 0, rMax = 0, mSum = 0, mMax = 0;
    for (const d of drawLog) {
      rSum += d.requests;
      if (d.requests > rMax) rMax = d.requests;
      mSum += d.ms;
      if (d.ms > mMax) mMax = d.ms;
    }
    return {
      draws: totalDraws,
      requests: totalRequests,
      window: n,
      coalesced: { mean: n ? rSum / n : 0, max: rMax },
      drawMs: { mean: n ? mSum / n : 0, max: mMax },
    };
  }

  // `done` is optional and runs only when the ticker finishes of its own accord.
  function addTicker(tick, done) {
    tickers.push({ tick, done });
    schedule();
  }

  // Deliberately does NOT run completion work: removing a ticker means the animation
  // was interrupted (a new flight replacing the one in progress), and running the
  // abandoned flight's completion would snap the camera to the target it was told to
  // give up on.
  function removeTicker(tick) {
    for (let i = tickers.length - 1; i >= 0; i--) {
      if (tickers[i].tick === tick) tickers.splice(i, 1);
    }
  }

  function cancel() {
    if (handle !== null) { cancelFrame(handle); handle = null; }
    tickers.length = 0;
    dirty = false;
  }

  return { request, addTicker, removeTicker, cancel, stats };
}
