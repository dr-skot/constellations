// ═══════════════════════════════════════════════════════════
// PERF BISECT HARNESS
// ═══════════════════════════════════════════════════════════
//
// One measurement engine, shared by every rung of the ladder (perf/step.html) and
// by the real app (index.html?perf=1). It answers one question per page:
//
//   does THIS page freeze, and is the main thread blocked or is the screen simply
//   not being presented?
//
// Three clocks run in parallel:
//   raf    — advances only when a frame is actually presented
//   timer  — advances whenever the main thread is free, painted or not
//   paint  — time from a real DOM change to the pixels appearing
//
// timer healthy + raf stalled  => rendering suspended, thread idle  (the iOS bug)
// timer stalled                => the main thread is genuinely blocked (our code)
//
// Written for iOS Safari: no modules, no build, no dependencies.

(function (global) {
  'use strict';

  var KEY = 'perf-bisect-results';

  // Every URL is resolved against the harness's own location, because rung 11 runs
  // from the app root (/index.html?perf=1) while rungs 1-10 run from /perf/. Using
  // relative paths sent the final navigation to the app instead of the results.
  var BASE = (function () {
    var s = document.currentScript;
    if (!s) { var all = document.getElementsByTagName('script'); s = all[all.length - 1]; }
    var src = (s && s.src) || '';
    return src ? src.replace(/harness\.js.*$/, '') : 'perf/';
  })();

  // The ladder. Each rung adds exactly ONE thing to the rung before it, so the
  // first rung that stalls names the culprit.
  var STEPS = [
    { id: 1,  name: 'Buttons only',      adds: 'Four buttons that light up on each tick. No canvas anywhere.' },
    { id: 2,  name: '+ progress bar',    adds: 'A progress bar and header text updated every tick.' },
    { id: 3,  name: '+ canvas present',  adds: 'A canvas at full device resolution, drawn once and never touched again.' },
    { id: 4,  name: '+ canvas redraw',   adds: 'Redraws simple shapes into that canvas every tick.' },
    { id: 5,  name: '+ canvas realloc',  adds: 'Reassigns canvas.width every tick, reallocating the bitmap.' },
    { id: 6,  name: '+ heavy draw',      adds: 'Gradients, 180 background stars, shadowBlur stars and lines, text labels.' },
    { id: 7,  name: '+ photo <img>',     adds: 'Swaps a real 640x640 photo into an <img> every tick.' },
    { id: 8,  name: '+ art overlay',     adds: 'drawImage of a real .webp art file onto the canvas every tick.' },
    { id: 9,  name: '+ WebGL context',   adds: 'Creates a WebGL canvas, uploads a texture and draws every tick.' },
    { id: 10, name: '+ all app scripts', adds: 'Loads every js/ file the real app loads: parse cost, globals, startup fetches.' },
    // ── THE REPRODUCER ──────────────────────────────────────────────────────
    // Rung 11 must be the exact case that stalls, unmodified. In the first ladder
    // run it stalled while sitting on a find-in-the-sky question with the explorer
    // rendering — so it runs a NORMAL planner lesson, find questions and all, and
    // sits on them exactly as it did then. Nothing here may be "fixed" to make the
    // run smoother: a top rung that does not reproduce makes every rung below it
    // meaningless.
    { id: 11, name: 'Real app — untouched', kind: 'add',
      adds: 'THE REPRODUCER. index.html with your existing progress and session, nothing ' +
            'cleared or seeded, whatever question comes up. Measured for 30s, because the ' +
            'observed freezes arrive roughly every 7 seconds and a short window can miss them.' },

    // Each rung below is the reproducer MINUS exactly one thing. The first that
    // comes back clean names the culprit.
    { id: 12, name: 'Reproducer minus find questions', remove: 'choiceonly', kind: 'remove',
      adds: 'Same, but a multiple-choice-only lesson, so the explorer never opens.' },
    { id: 13, name: 'Reproducer minus WebGL', remove: 'nogl', kind: 'remove',
      adds: 'Same lesson, but the WebGL context is destroyed — the sky falls back to 2D.' },
    { id: 14, name: 'Reproducer minus photos', remove: 'nophoto', kind: 'remove',
      adds: 'Same lesson, but photo loading is replaced by an inline blank image.' },
    { id: 15, name: 'Reproducer minus art', remove: 'noart', kind: 'remove',
      adds: 'Same lesson, but the constellation artwork is never loaded or drawn.' },
    { id: 16, name: 'Reproducer minus datalists', remove: 'nodatalist', kind: 'remove',
      adds: 'Same lesson, but both 88-option <datalist> elements are emptied.' }
  ];

  function stepUrl(id, auto) {
    var q = auto ? '&auto=1' : '';
    var step = STEPS[id - 1];
    if (id >= 11) {
      var extra = (step && step.remove) ? '&' + step.remove + '=1' : '';
      return BASE + '../index.html?perf=1&rung=' + id + extra +
             (auto ? '&auto=1' : '') + '#lesson';
    }
    return BASE + 'step.html?step=' + id + q;
  }
  function resultsUrl() { return BASE + 'index.html?done=1'; }

  // ── Results storage ────────────────────────────────────────────────────────
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  }
  function record(id, result) {
    var all = load();
    var act = loadActive();
    result.at = Date.now();
    result.run = act ? act.runId : 0;
    all[id] = result;
    save(all);
  }
  function clearAll() { save({}); endRun(); }

  // ── Which run is in flight ─────────────────────────────────────────────────
  // A run used to leave no trace of itself, so a run that died mid-rung was
  // indistinguishable from one that was never started — and since the start
  // button cleared results first, it also took the previous run's data with it.
  // Now every result is stamped with the run that produced it, and an
  // interrupted run can say where it stopped.
  var ACTIVE_KEY = 'perf-run-active';
  function loadActive() {
    try { return JSON.parse(localStorage.getItem(ACTIVE_KEY)) || null; } catch (e) { return null; }
  }
  function saveActive(a) {
    try {
      if (a) localStorage.setItem(ACTIVE_KEY, JSON.stringify(a));
      else localStorage.removeItem(ACTIVE_KEY);
    } catch (e) {}
  }
  function startRun(first) { saveActive({ runId: Date.now(), rung: first, at: Date.now() }); }
  function markRung(id) {
    var a = loadActive() || { runId: Date.now() };
    a.rung = id;
    a.at = Date.now();
    saveActive(a);
  }
  function endRun() { saveActive(null); }

  // Clear only the rungs from `id` up, so a re-run of the real-app rungs keeps the
  // known-clean 1-10 baseline instead of spending two minutes re-proving it.
  function clearFrom(id) {
    var all = load(), kept = {};
    Object.keys(all).forEach(function (k) { if (+k < id) kept[k] = all[k]; });
    save(kept);
  }

  // The first rung that runs the real app rather than a synthetic page.
  var FIRST_APP_STEP = 11;

  // ── The measurement ────────────────────────────────────────────────────────
  // opts.seconds  how long to measure
  // opts.tick     called every opts.tickMs to simulate a question change
  // opts.onDone   receives the result object
  function measure(opts) {
    var seconds = opts.seconds || 10;
    var tickMs = opts.tickMs || 700;
    var rafGaps = [], timerGaps = [], paints = [];
    var stopped = false;
    var t0 = performance.now();
    var lastR = t0, lastT = t0;
    var ticks = 0;

    // A hidden page gets no animation frames at all, which would otherwise be
    // recorded as a flawless zero-stall pass. Track it and refuse to report.
    var wasHidden = document.hidden;
    var onVis = function () { if (document.hidden) wasHidden = true; };
    document.addEventListener('visibilitychange', onVis);

    var rafTick = function (t) {
      rafGaps.push(t - lastR); lastR = t;
      if (!stopped) requestAnimationFrame(rafTick);
    };
    requestAnimationFrame(rafTick);

    var timerTick = function () {
      var n = performance.now();
      timerGaps.push(n - lastT); lastT = n;
      if (!stopped) setTimeout(timerTick, 16);
    };
    setTimeout(timerTick, 16);

    // A real DOM change, timed to the frame that shows it.
    var probe = document.createElement('div');
    probe.setAttribute('data-perf-probe', '');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:6px;height:6px;z-index:2147483647;background:#f0f';
    document.body.appendChild(probe);
    var paintTimer = setInterval(function () {
      var p0 = performance.now();     // not t0: that names the start of the window
      probe.style.background = probe.style.background === 'rgb(255, 0, 255)' ? '#0ff' : '#f0f';
      requestAnimationFrame(function () { paints.push(performance.now() - p0); });
    }, 250);

    // Drive the page the way a user would — unless the user is driving it. With
    // no tick, only real finger taps advance the page, which is the one thing a
    // synthetic .click() cannot reproduce: gesture recognition and the touch
    // handling that runs before our handlers ever see the event.
    var workTimer = opts.tick ? setInterval(function () {
      ticks++;
      try { opts.tick(ticks); } catch (e) { /* keep measuring */ }
    }, tickMs) : null;

    // Count real touches so a manual run can be told apart from an idle one.
    var taps = 0;
    var onTap = function () { taps++; };
    document.addEventListener('touchend', onTap, { capture: true, passive: true });
    document.addEventListener('click', onTap, { capture: true, passive: true });

    // Write what we have, once a second, so a rung that never finishes still
    // reports what it saw. The result used to be written only when the window
    // closed, so a lock screen or a discarded tab erased the whole rung — and
    // the worst stalls are exactly the ones most likely to disrupt the run that
    // is measuring them. A run was lost this way on 2026-08-14 after the user
    // watched rungs visibly choking.
    var ckTimer = opts.checkpoint ? setInterval(function () {
      // Once the page has been hidden the clocks are meaningless, and writing
      // that over a good snapshot would destroy the very thing checkpointing
      // exists to save: what the rung saw while it was still on screen. Stop
      // writing instead, and let the last visible snapshot stand.
      if (wasHidden) return;
      var elapsed = (performance.now() - t0) / 1000;
      var snap = summarize(rafGaps, timerGaps, paints, elapsed, ticks);
      snap.partial = true;
      snap.elapsedSec = Math.round(elapsed);
      snap.taps = taps;
      try { opts.checkpoint(snap); } catch (e) { /* never let storage kill the run */ }
    }, 1000) : null;

    // Live readout, so a stall is visible as it happens rather than only at the end.
    var liveTimer = opts.live === false ? null : setInterval(function () {
      var wp = 0, wf = 0;
      for (var i = 0; i < paints.length; i++) if (paints[i] > wp) wp = paints[i];
      for (var j = 0; j < rafGaps.length; j++) if (rafGaps[j] > wf) wf = rafGaps[j];
      hud((opts.label || 'measuring') + '\ntaps ' + taps +
          '\nworst paint ' + (wp / 1000).toFixed(1) + 's' +
          '\nworst frame ' + (wf / 1000).toFixed(1) + 's');
    }, 500);

    setTimeout(function () {
      stopped = true;
      clearInterval(paintTimer);
      if (workTimer) clearInterval(workTimer);
      if (liveTimer) clearInterval(liveTimer);
      if (ckTimer) clearInterval(ckTimer);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('touchend', onTap, true);
      document.removeEventListener('click', onTap, true);
      if (probe.parentNode) probe.parentNode.removeChild(probe);

      var result = summarize(rafGaps, timerGaps, paints, seconds, ticks);
      result.taps = taps;

      // A page starved of frames looks identical to a hidden one, so only the
      // visibility API may call it hidden. Starved-but-visible is the WORST
      // possible result, not missing data — an earlier version filed it as noise.
      if (wasHidden) {
        result.noData = true;
        result.stalled = false;
        result.verdict = 'NO DATA — page was hidden';
      } else if (rafGaps.length < seconds * 5) {
        result.stalled = true;
        result.starved = true;
        result.verdict = result.threadBlocked ? 'BLOCKED THREAD (severe)' : 'FRAMES STARVED';
      }
      if (opts.onDone) opts.onDone(result);
    }, seconds * 1000);
  }

  function pct(sorted, p) { return sorted.length ? sorted[Math.floor(sorted.length * p)] : 0; }
  function r0(n) { return Math.round(n); }

  function summarize(rafGaps, timerGaps, paints, seconds, ticks) {
    var r = rafGaps.slice().sort(function (a, b) { return a - b; });
    var t = timerGaps.slice().sort(function (a, b) { return a - b; });
    var p = paints.slice().sort(function (a, b) { return a - b; });

    var worstPaint = p.length ? p[p.length - 1] : 0;
    var worstFrame = r.length ? r[r.length - 1] : 0;
    var worstTimer = t.length ? t[t.length - 1] : 0;
    var expectedFrames = seconds * 60;

    // A stall is the screen not updating for over half a second.
    var stalled = worstPaint > 500 || worstFrame > 500;
    var threadBlocked = worstTimer > 500;

    return {
      frames: rafGaps.length,
      framesExpected: expectedFrames,
      fps: r0(rafGaps.length / seconds),
      frameMedian: r0(pct(r, 0.5)),
      worstFrameMs: r0(worstFrame),
      worstTimerMs: r0(worstTimer),
      paintMedianMs: r0(pct(p, 0.5)),
      worstPaintMs: r0(worstPaint),
      stallsOver500ms: paints.filter(function (x) { return x > 500; }).length,
      ticks: ticks,
      stalled: stalled,
      threadBlocked: threadBlocked,
      verdict: !stalled ? 'OK' : (threadBlocked ? 'BLOCKED THREAD' : 'SUSPENDED RENDERING')
    };
  }

  // ── On-screen readout ──────────────────────────────────────────────────────
  function hud(text) {
    var el = document.getElementById('perf-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'perf-hud';
      el.style.cssText = 'position:fixed;top:6px;right:6px;z-index:2147483646;background:rgba(0,0,0,.85);' +
        'color:#0f0;font:11px/1.4 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:6px;' +
        'white-space:pre;text-align:right;pointer-events:none;max-width:60vw';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  // ── Auto-run: measure this rung, store it, move to the next ────────────────
  function autoRun(id, tick) {
    var step = STEPS[id - 1];
    markRung(id);
    hud('step ' + id + '/' + STEPS.length + '\n' + (step ? step.name : '') + '\nmeasuring...');
    measure({
      // The observed freezes arrive roughly every 7 seconds, so a 10s window can
      // miss one and report a clean pass — very likely what happened when rung 11
      // stalled on one run and not the next. The real-app rungs, where that risk
      // matters, get 30s; the synthetic rungs below them get 12s.
      seconds: id >= 11 ? 30 : 12,
      label: 'step ' + id + '/' + STEPS.length,
      tick: tick,
      checkpoint: function (snap) { record(id, snap); },
      onDone: function (result) {
        record(id, result);
        hud('step ' + id + ' -> ' + result.verdict + '\nfps ' + result.fps +
            '  worst paint ' + (result.worstPaintMs / 1000).toFixed(1) + 's\nnext...');
        setTimeout(function () {
          if (id >= STEPS.length) { endRun(); location.href = resultsUrl(); }
          else location.href = stepUrl(id + 1, true);
        }, 900);
      }
    });
  }

  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  global.Perf = {
    STEPS: STEPS,
    FIRST_APP_STEP: FIRST_APP_STEP,
    stepUrl: stepUrl,
    resultsUrl: resultsUrl,
    load: load,
    record: record,
    clearAll: clearAll,
    clearFrom: clearFrom,
    startRun: startRun,
    endRun: endRun,
    loadActive: loadActive,
    measure: measure,
    autoRun: autoRun,
    hud: hud,
    param: param
  };
})(window);
