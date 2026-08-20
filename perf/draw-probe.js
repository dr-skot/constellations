// Per-phase draw probe (issue #52). Loaded by index.html only when ?perf=1 is
// present, and active only when ?draw=1 is ALSO present.
//
// Why a second flag: ?perf=1 alone puts app-probe.js into its manual 30-second
// measurement, which owns the shared #perf-hud and rewrites it every second. Two
// writers would flicker over each other, so this probe takes its own panel in the
// opposite corner and its own switch. Both can be on at once and both stay readable.
//
// HOW TO TAKE A READING
//   1. open  index.html?perf=1&draw=1  on the device
//   2. go to the explorer and zoom out to a wide field of view
//   3. drag continuously with a real finger for ~10 seconds
//   4. read the panel bottom-left; the phases are ranked most expensive first
//
// A real finger matters. A synthetic drag driver cannot reproduce the touch sampling
// rate, which is half the problem being measured — app-probe.js says the same thing
// about its synthetic clicks, for the same reason.
//
// GPU HEADROOM (issue #63). The phase table is main-thread CPU only, so a frame can
// read 3ms of work and still miss its deadline waiting on fill rate. Two additions
// close that blind spot:
//
//   ?load=N   scales the canvas backing store by N, multiplying shaded pixels
//             without multiplying geometry. Walk it up (1, 1.5, 2, 3…) until p95
//             interval crosses the display period; the last value that held is the
//             GPU headroom, and it converts directly to "an N-times-slower phone".
//
//   interval  p50 / p95 / worst of the gap BETWEEN rAF callbacks, against a display
//             period derived from the observed floor rather than assumed. Flat phases
//             with stretched intervals is the GPU-bound signature.
//
// This probe is MORE sensitive than the phase table to the hidden-tab mistake: a
// backgrounded tab stops rAF entirely, so every interval would read as one enormous
// gap or none at all. It says so on screen rather than reporting a perfect result.

(function () {
  'use strict';

  if (!/[?&]draw=1/.test(location.search)) return;
  if (typeof makePhaseCollector !== 'function') {
    console.warn('[draw-probe] js/draw-phases.js not loaded — is the ?v= stale?');
    return;
  }

  // 90 frames ≈ 1.5s of continuous dragging: long enough to average out a single
  // unlucky frame, short enough that the panel still reflects what the finger is
  // doing right now rather than what it did ten seconds ago.
  var collector = makePhaseCollector({
    now: function () { return performance.now(); },
    frames: 90
  });

  // ── Load multiplier (issue #63) ────────────────────────────────────────────
  // Read once at startup and parked on window, where exploreBackingScale() picks it
  // up. Scaling the backing store multiplies pixels shaded while leaving the geometry
  // count alone, which is what isolates fill rate from main-thread cost — drawing N
  // times per frame would move both together and measure nothing in particular.
  var loadMatch = /[?&]load=([0-9.]+)/.exec(location.search);
  var LOAD = loadMatch ? parseFloat(loadMatch[1]) : 1;
  if (!(LOAD > 0)) LOAD = 1;
  window._perfLoadScale = LOAD;

  // ── Frame interval (issue #63) ─────────────────────────────────────────────
  // Its own rAF loop rather than a hook into the scheduler's: what is being measured
  // is when the browser can deliver a frame at all, which is a property of the
  // display and the GPU queue, not of whether the app happened to ask for a draw.
  var interval = makeIntervalCollector({
    now: function () { return performance.now(); },
    frames: 90
  });
  var rafOn = false;
  function pump() {
    interval.tick();
    requestAnimationFrame(pump);
  }
  // A hidden tab does not merely slow rAF, it stops it. The gap that produces is not
  // a measurement, so the collector is told to break the series rather than record a
  // multi-second interval that would poison p95 and worst for the rest of the run.
  document.addEventListener('visibilitychange', function () {
    interval.gap();
    if (!document.hidden && !rafOn) { rafOn = true; requestAnimationFrame(pump); }
  });

  // Draws-per-second is counted here rather than taken from the collector, whose
  // window is capped and so cannot answer "how many draws have happened at all".
  var drawn = 0;
  setDrawPhaseSink({
    begin: function (m) { collector.begin(m); },
    mark: function (n) { collector.mark(n); },
    end: function () { collector.end(); drawn++; }
  });

  // ── Its own panel, bottom-left ─────────────────────────────────────────────
  function panel(text) {
    var el = document.getElementById('perf-draw-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'perf-draw-hud';
      el.style.cssText = 'position:fixed;bottom:6px;left:6px;z-index:2147483646;' +
        'background:rgba(0,0,0,.85);color:#9cf;font:10px/1.35 ui-monospace,Menlo,monospace;' +
        'padding:6px 8px;border-radius:6px;white-space:pre;pointer-events:none;max-width:70vw';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  var NAME_W = 17;
  function pad(s, n) {
    s = String(s);
    while (s.length < n) s += ' ';
    return s;
  }
  function ms(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  // Peak draws/s, not just the current rate. A reading is taken AFTER the finger
  // lifts, and by then the instantaneous rate is zero whether the run was healthy or
  // catastrophic — which is exactly how a collapsed x2.9 run and a perfect x1 run both
  // printed "draws/s 0" on 2026-08-20 and looked alike. The peak survives the lift and
  // is the number that says whether frames were being produced during the drag.
  var lastAt = performance.now(), lastDrawn = 0, dps = 0, peakDps = 0;

  function render() {
    var nowT = performance.now();
    var dt = nowT - lastAt;
    if (dt >= 500) {
      dps = Math.round((drawn - lastDrawn) * 1000 / dt);
      if (dps > peakDps) peakDps = dps;
      lastAt = nowT;
      lastDrawn = drawn;
    }

    var iv = interval.stats();

    // Said loudly and first, because every number below it is wrong when it is true
    // and wrong in the reassuring direction — a stopped rAF reports no late frames.
    if (document.hidden) {
      panel('DRAW PROBE — TAB HIDDEN\nrAF is stopped; every reading below is stale.\n' +
            'Foreground this tab and take the reading again.');
      return;
    }

    var s = collector.stats();
    if (!s.frames) { panel('draw probe\nwaiting for a frame…'); return; }

    // The visible-constellation count and field of view are read here rather than
    // passed through the hook, so drawExplore's instrumentation stays a list of phase
    // names and knows nothing about what the readout wants to show.
    var vis = '?';
    try { if (typeof exploreVisibleCons === 'function') vis = exploreVisibleCons().length; } catch (e) {}
    var fov = '?';
    try { fov = Math.round(explore.fov); } catch (e) {}

    // Read before the verdict, which needs draws-vs-requests. Absent (the scheduler
    // has not been built because nothing has asked for a frame) it stays a zeroed
    // stand-in so the verdict can say "deriving" rather than throw.
    var sched = { draws: 0, requests: 0, coalesced: { mean: 0, max: 0 },
                  drawMs: { mean: 0, max: 0 } };
    var haveSched = false;
    try { sched = exploreScheduler().stats(); haveSched = true; } catch (e) {}

    var out = [
      'DRAW PROBE   fov ' + fov + '  vis ' + vis + '   load x' + LOAD,
      'frame  ' + ms(s.frame.mean) + ' avg   ' + ms(s.frame.max) + ' max',
      'draws/s ' + dps + '   over ' + s.frames + ' frames'
    ];

    var budget = iv.period;
    var expected = budget ? Math.round(1000 / budget) : 0;

    // WHAT BROKE THE FIRST VERSION OF THIS PANEL (2026-08-20): the interval block
    // below measures when the BROWSER delivers a rAF callback, which it keeps doing
    // at display rate whether or not the app manages to draw anything. At load x2.9
    // the app completed 3 draws against 61 requests — a total collapse — and the
    // interval line still read 17.0/17.0/17.0 with 0 of 90 late and a verdict of
    // WITHIN. The metric was blind to the exact failure it existed to catch.
    //
    // So the verdict is now taken from frames PRODUCED, and the interval block is
    // labelled as what it is. Keep both: stretched intervals still distinguish "the
    // browser could not deliver" from "the app could not fill", and that distinction
    // is the CPU/GPU split the ticket wants.
    out.push('render peak ' + peakDps + '/s of ' + (expected || '?') + '   ' +
             sched.draws + '/' + sched.requests + ' served');

    var verdict;
    if (!budget || !sched.requests) {
      verdict = 'deriving…';
    } else if (s.frame.mean > budget) {
      verdict = 'OVER BUDGET (draw ' + ms(s.frame.mean) + ' > ' + ms(budget) + ')';
    } else if (peakDps < expected * 0.7) {
      verdict = 'DROPPING FRAMES (peak ' + peakDps + '/s of ' + expected + ')';
    } else {
      verdict = 'WITHIN';
    }
    out.push('verdict: ' + verdict);

    if (iv.frames) {
      out.push('rAF gap ' + ms(iv.p50) + ' p50  ' + ms(iv.p95) + ' p95  ' +
               ms(iv.worst) + ' worst');
      out.push('period  ' + ms(budget) + ' floor   ' + iv.late + '/' + iv.frames +
               ' late  (delivery, not draws)');
    }

    // Scheduler statistics (issue #56). `coalesced` is the number that says whether
    // the input backlog is gone: well above 1 means requests are collapsing into
    // frames as intended; steady at 1 means input was never the bottleneck and the
    // phase table below is where the answer is.
    if (haveSched) {
      out.push('coalesced ' + (Math.round(sched.coalesced.mean * 100) / 100) +
               ' avg  ' + sched.coalesced.max + ' max');
      out.push('draw   ' + ms(sched.drawMs.mean) + ' avg   ' + ms(sched.drawMs.max) + ' max');
      out.push('total  ' + sched.draws + ' draws / ' + sched.requests + ' requests');
    }

    // 17 wide: the longest phase name is 'guide-annotation' at 16. Too narrow and the
    // name runs into its own number, which is how this first shipped.
    out.push(pad('', NAME_W) + pad('avg', 8) + 'max');
    // Everything, not a top-N: a phase reading 0.0 is a real result (it says that
    // layer is not what to optimise) and silently dropping it would read as an
    // omission rather than as evidence.
    for (var i = 0; i < s.phases.length; i++) {
      var p = s.phases[i];
      out.push(pad(p.name, NAME_W) + pad(ms(p.mean), 8) + ms(p.max));
    }
    panel(out.join('\n'));
  }

  function start() {
    if (!rafOn) { rafOn = true; requestAnimationFrame(pump); }
    setInterval(render, 500);
    render();
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
