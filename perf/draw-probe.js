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

  var lastAt = performance.now(), lastDrawn = 0, dps = 0;

  function render() {
    var nowT = performance.now();
    var dt = nowT - lastAt;
    if (dt >= 500) {
      dps = Math.round((drawn - lastDrawn) * 1000 / dt);
      lastAt = nowT;
      lastDrawn = drawn;
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

    var out = [
      'DRAW PROBE   fov ' + fov + '  vis ' + vis,
      'frame  ' + ms(s.frame.mean) + ' avg   ' + ms(s.frame.max) + ' max',
      'draws/s ' + dps + '   over ' + s.frames + ' frames'
    ];

    // Scheduler statistics (issue #56). `coalesced` is the number that says whether
    // the input backlog is gone: well above 1 means requests are collapsing into
    // frames as intended; steady at 1 means input was never the bottleneck and the
    // phase table below is where the answer is.
    try {
      var sch = exploreScheduler().stats();
      out.push('coalesced ' + (Math.round(sch.coalesced.mean * 100) / 100) +
               ' avg  ' + sch.coalesced.max + ' max');
      out.push('draw   ' + ms(sch.drawMs.mean) + ' avg   ' + ms(sch.drawMs.max) + ' max');
      out.push('total  ' + sch.draws + ' draws / ' + sch.requests + ' requests');
    } catch (e) { /* scheduler not built yet — nothing has asked for a frame */ }

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
    setInterval(render, 500);
    render();
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
