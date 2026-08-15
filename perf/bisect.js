// ═══════════════════════════════════════════════════════════
// FEATURE BISECT
// ═══════════════════════════════════════════════════════════
//
// The ladder in harness.js walks the search space one item at a time, which is
// why sixteen rungs named nothing: it subtracted one subsystem per run, every
// run still stalled, and a linear scan of a space that big costs an afternoon.
//
// This halves the space instead. Every run is THE REAL APP — index.html, the
// real lesson, the real driver answering real questions — with a SET of
// features switched off. Nothing here is a synthetic replica; a "half app" is
// the real app with half its features dead.
//
//   test(K) = run the real app with the kills in K applied.
//
// We are looking for the smallest K that makes the stall go away. Split the
// candidates in half, apply one half:
//
//   clean  -> whatever fixes it is in the half we applied  -> recurse there
//   stalls -> it is in the half we did not                 -> recurse there
//
// Sixteen features, four rounds, ~30s each. The last round's test IS the
// confirmation: it applies exactly one kill and shows it runs clean.
//
// Deliberately NOT tested: the all-kills "zero app". It only tells us something
// if it stalls, and an app with every feature dead is not going to stall. If
// the search hits a contradiction it gets tested then, when it would mean
// something.

(function () {
  'use strict';

  var STATE_KEY = 'perf-bisect-search';

  // Where the app and the results page live, resolved from THIS script's own
  // URL rather than from location. bisect.js is loaded by two different pages —
  // /perf/index.html (the button) and /index.html (each run) — so anything
  // derived from location.pathname points somewhere different depending on who
  // is asking. Building the URL from location sent the button to
  // /perf/index.html?bisect=1 instead of the app, which just reloaded the
  // results page and looked exactly like the button doing nothing.
  var ROOT = (function () {
    var s = document.currentScript;
    if (!s) { var all = document.getElementsByTagName('script'); s = all[all.length - 1]; }
    var src = (s && s.src) || '';
    var root = src ? src.replace(/perf\/bisect\.js.*$/, '') : '';
    // Belt and braces. If the script tag could not be found at all we fall back
    // to the page's own directory — and from /perf/index.html that would point
    // the app URL back into /perf/, which is the failure this whole block
    // exists to prevent. Strip a trailing perf/ so the wrong answer is not
    // reachable by any path.
    if (!root) root = location.pathname.replace(/[^/]*$/, '');
    return root.replace(/perf\/$/, '');
  })();
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  function noop() {}
  function stub(name) {
    if (typeof window[name] === 'function') window[name] = noop;
  }

  // ── The features that can be switched off ──────────────────────────────────
  // Order matters: halving cuts this list down the middle, so related work sits
  // together and a half is a meaningful chunk of the app rather than a scatter.
  // Every kill must leave the app USABLE — the driver still has to answer
  // questions and advance the lesson, or the run measures a dead page.
  var KILLS = [
    // -- the sky: the explorer and everything it paints ----------------------
    // A REAL no-WebGL run. The 'gl' kill below does not do this: it sets
    // window.gl = null, but explore-gl.js declares `let gl` at the top level of
    // a classic script, which is a global LEXICAL binding and not a window
    // property — so the app kept its context object, and after loseContext()
    // spent every frame drawing into a dead one. That measured 4/4 stalls and I
    // wrongly read it as "stalls without WebGL".
    //
    // Refusing the context at getContext() time means initExploreGL returns
    // false, gl stays null, and the app takes its genuine 2D fallback path.
    { id: 'nogl2', what: 'WebGL refused entirely (real 2D fallback)', apply: function () {
      var proto = HTMLCanvasElement.prototype;
      var real = proto.getContext;
      proto.getContext = function (type) {
        if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') return null;
        return real.apply(this, arguments);
      };
    } },
    { id: 'gl', what: 'WebGL context lost mid-flight (NOT a no-WebGL test)', apply: function () {
      var gc = document.getElementById('explore-gl-canvas');
      if (gc) {
        var c = gc.getContext('webgl');
        var ext = c && c.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        if (gc.parentNode) gc.parentNode.removeChild(gc);
      }
      window.gl = null;
    } },
    { id: 'explore', what: 'drawExplore (the explorer never paints)', apply: function () {
      stub('drawExplore');
    } },
    { id: 'explorephoto', what: 'explorer photo tiles', apply: function () {
      stub('loadExplorePhoto');
    } },
    // Canvas shadow blur, everywhere. drawExplore is bimodal — about forty calls
    // near-instant and three at ~3.5 SECONDS each — and the only thing in it
    // that is both conditional and enormously expensive is the Milky Way band:
    // a W/13-wide stroke (about 90px on this phone) under a W/40 shadow blur
    // (about 29px) along a 721-point polyline, drawn only when the photo layer
    // is off and the mode is diagram or stars. Neutralising the property tests
    // that without touching the drawing code.
    { id: 'shadow', what: 'canvas shadowBlur (the Milky Way glow and star glows)', apply: function () {
      var proto = CanvasRenderingContext2D.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'shadowBlur');
      if (!d || !d.set) return;
      Object.defineProperty(proto, 'shadowBlur', {
        configurable: true,
        get: function () { return 0; },
        set: function () { /* ignore */ }
      });
    } },
    // The Milky Way band, surgically. galToRaDec is called from exactly one
    // place in the codebase — the band's 721-point loop at explore.js:492 — so
    // returning a constant collapses the band to a single point and erases it
    // while every other part of drawExplore runs untouched. Unlike the shadow
    // kill (which measured 4/4 stalls, so the blur is innocent) this removes the
    // whole thing: the points, the path, and the ~90px stroke.
    { id: 'milkyway', what: 'the Milky Way band (galToRaDec collapsed)', apply: function () {
      window.galToRaDec = function () { return { ra: 0, dec: -89.9 }; };
    } },
    // Wide strokes, not blurred ones. If the band turns out to be the cause,
    // this says whether the width is the mechanism: the band asks for
    // lineWidth = W/13, about 90px on this phone.
    { id: 'fatline', what: 'wide canvas strokes (lineWidth clamped to 4px)', apply: function () {
      var proto = CanvasRenderingContext2D.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'lineWidth');
      if (!d || !d.set || !d.get) return;
      Object.defineProperty(proto, 'lineWidth', {
        configurable: true,
        get: function () { return d.get.call(this); },
        set: function (v) { d.set.call(this, Math.min(v, 4)); }
      });
    } },
    // Nine times fewer pixels. drawExplore sizes both canvases to
    // wrap.offsetWidth * devicePixelRatio — 1107x1146 on this phone at dpr 3 —
    // and does it for the 2D canvas AND the WebGL one. Redefining the ratio to
    // 1 shrinks both to 369x382 without touching a line of drawing code.
    //
    // This is the last standing explanation. Destroying the WebGL context
    // entirely still stalled 4/4, so whatever kills the GPU process is not a
    // WebGL object — which leaves the pixel volume of a large accelerated
    // canvas being cleared and redrawn.
    { id: 'lowres', what: 'canvas resolution (devicePixelRatio forced to 1)', apply: function () {
      try {
        Object.defineProperty(window, 'devicePixelRatio', {
          configurable: true,
          get: function () { return 1; }
        });
      } catch (e) {}
    } },
    { id: 'guide', what: 'finding-guide overlay and its animation', apply: function () {
      stub('guideStart'); stub('guideGoTo'); stub('guideDrawAnnotation'); stub('guideAnimateTo');
    } },

    // -- the quiz canvas -----------------------------------------------------
    { id: 'quizdraw', what: 'renderCanvas (the quiz diagram)', apply: function () {
      stub('renderCanvas');
    } },
    { id: 'bg', what: 'drawBackground (gradient + 180 background stars)', apply: function () {
      stub('drawBackground');
    } },
    { id: 'stars', what: 'drawStars (shadowBlur star glows)', apply: function () {
      stub('drawStars');
    } },
    { id: 'labels', what: 'drawLabels (label placement search)', apply: function () {
      stub('drawLabels');
    } },

    // -- media ---------------------------------------------------------------
    { id: 'photo', what: 'quiz photographs', apply: function () {
      window.photoUrl = function () { return BLANK; };
      stub('showPhotoMode');
      var pi = document.getElementById('photo-img');
      if (pi) pi.src = BLANK;
    } },
    { id: 'art', what: 'constellation artwork', apply: function () {
      if (typeof ART === 'object' && ART) { for (var k in ART) delete ART[k]; }
      stub('ensureArtLoaded'); stub('drawArtwork'); stub('showArtworkMode');
    } },
    { id: 'reveal', what: 'the answer reveal redraw', apply: function () {
      stub('redrawReveal'); stub('startReveal');
    } },
    { id: 'progress', what: 'progress grid and chart (a canvas per constellation)', apply: function () {
      stub('renderProgressGrid'); stub('progressCard');
    } },

    // -- structure: DOM, state, question mix ---------------------------------
    { id: 'datalist', what: 'the two 88-option datalists', apply: function () {
      var lists = document.querySelectorAll('datalist');
      for (var i = 0; i < lists.length; i++) lists[i].innerHTML = '';
    } },
    // Only the screens a run never visits. Emptying by "not currently active"
    // destroyed #screen-quiz whenever the app happened to be elsewhere at kill
    // time, which took btn-next with it: the driver could no longer advance,
    // the page went idle, and an idle page measures CLEAN. That would have
    // convicted this half of the app on a run where nothing was happening.
    { id: 'screens', what: 'the DOM of the screens a lesson never uses', apply: function () {
      ['screen-start', 'screen-settings', 'screen-calibration'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && !el.classList.contains('active')) el.innerHTML = '';
      });
    } },
    { id: 'toggles', what: 'toggle groups and reveal controls', apply: function () {
      ['reveal-controls', 'eq-reveal-controls', 'explore-toggles'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = '';
      });
      stub('initRevealToggles'); stub('initEqRevealToggles'); stub('initExploreToggles');
    } },
    { id: 'find', what: 'find-in-the-sky questions (choice-only lesson)', apply: function () {
      // Applied by app-probe's seedChoiceLesson, which needs the lesson to exist
      // first; the flag is read there. Nothing to do at apply time.
    } }
  ];

  var ALL = KILLS.map(function (k) { return k.id; });

  // ── Search state ───────────────────────────────────────────────────────────
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; } catch (e) { return null; }
  }
  function saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function clearState() {
    try { localStorage.removeItem(STATE_KEY); } catch (e) {}
  }

  function firstHalf(list) { return list.slice(0, Math.ceil(list.length / 2)); }
  function rest(list) { return list.slice(Math.ceil(list.length / 2)); }

  // ── Delta debugging ────────────────────────────────────────────────────────
  // Halving assumes ONE feature is responsible. On 2026-08-14 that assumption
  // broke in the open: switching off all eight rendering features ran clean at
  // 60fps, and switching off ANY ONE of them still stalled. No single culprit
  // exists — the cost is cumulative — and a search that must name one either
  // lies or gives up.
  //
  // So instead of hunting a culprit, shrink a CURE. Start from a set of kills
  // known to fix it and try to remove pieces: if it still runs clean with a
  // piece put back, that piece was not needed. What survives is a minimal set
  // that must be switched off — which is the honest shape of an interaction.
  //
  //   F = kills known to fix it, n = how many chunks to cut F into
  //   test F minus chunk i:
  //     clean  -> that chunk was not needed; F shrinks; start over
  //     stalls -> that chunk is load-bearing; try the next chunk
  //   when no single chunk can be removed, cut finer (n doubles) until n = |F|
  //
  // Chunks are contiguous slices, so related work stays together and a run
  // means something to read.
  function chunk(list, n, i) {
    var size = list.length / n;
    return list.slice(Math.round(i * size), Math.round((i + 1) * size));
  }
  function without(list, sub) {
    return list.filter(function (x) { return sub.indexOf(x) === -1; });
  }

  // The set to test next, given where the search stands. Returns null when done.
  function nextTest(state) {
    if (state.mode === 'ddmin') {
      if (state.F.length === 0) return null;
      if (state.chunkIdx >= state.n) return null;    // caller re-splits or finishes
      return without(state.F, chunk(state.F, state.n, state.chunkIdx));
    }
    var c = state.candidates;
    if (c.length === 0) return null;                 // contradiction; caller handles
    if (c.length === 1) {
      // Converged. If the last test WAS this single kill, we already have our
      // confirmation and there is nothing left to run.
      var last = state.history[state.history.length - 1];
      if (last && last.kills.length === 1 && last.kills[0] === c[0]) return null;
      return c;
    }
    return firstHalf(c);
  }

  // One step of delta debugging. `kills` is what was just tested (F minus a
  // chunk); `clean` says whether the app behaved with it applied.
  function ddminStep(state, clean) {
    if (clean) {
      // That chunk was not needed to fix it — drop it and start cutting again.
      // Coarser granularity after a shrink, because a smaller F usually needs
      // fewer, bigger cuts.
      state.F = state.lastTested.slice();
      state.n = Math.max(state.n - 1, 2);
      state.chunkIdx = 0;
      if (state.F.length <= 1) { state.done = true; state.minimal = state.F.slice(); }
      return;
    }
    // That chunk is load-bearing. Try the next one.
    state.chunkIdx++;
    if (state.chunkIdx >= state.n) {
      if (state.n >= state.F.length) {
        // No single piece can be removed at the finest granularity: F is minimal.
        state.done = true;
        state.minimal = state.F.slice();
      } else {
        state.n = Math.min(state.n * 2, state.F.length);
        state.chunkIdx = 0;
      }
    }
  }

  // Begin shrinking a set already known to fix the stall.
  function startDdmin(fixingSet) {
    var state = {
      mode: 'ddmin',
      F: fixingSet.slice(),
      n: 2,
      chunkIdx: 0,
      history: [],
      startedAt: Date.now()
    };
    saveState(state);
    var first = nextTest(state);
    state.lastTested = first;
    saveState(state);
    return killUrl(first);
  }

  function describe(ids) {
    if (!ids.length) return 'nothing (the app as it is)';
    return ids.join(', ');
  }

  function killUrl(ids) {
    return ROOT + 'index.html?perf=1&bisect=1&auto=1&kill=' +
           encodeURIComponent(ids.join(',')) + '#lesson';
  }
  function resultsUrl() {
    return ROOT + 'perf/index.html?bisect=done';
  }

  // ── Public: apply the kills named in the URL ───────────────────────────────
  function applyFromUrl() {
    var m = /[?&]kill=([^&#]*)/.exec(location.search);
    var ids = m ? decodeURIComponent(m[1]).split(',').filter(Boolean) : [];
    var applied = [];
    ids.forEach(function (id) {
      var k = KILLS.filter(function (x) { return x.id === id; })[0];
      if (!k) return;
      try { k.apply(); applied.push(id); } catch (e) { /* a kill must never stop the run */ }
    });
    return applied;
  }

  // ── Public: record this run's verdict and move to the next test ────────────
  function recordAndAdvance(kills, result) {
    var state = loadState() || { candidates: ALL.slice(), history: [], startedAt: Date.now() };

    state.history.push({
      kills: kills,
      stalled: !!result.stalled,
      noData: !!result.noData,
      fps: result.fps,
      worstPaintMs: result.worstPaintMs,
      worstTimerMs: result.worstTimerMs,
      threadBlocked: !!result.threadBlocked
    });

    // A rung that recorded nothing decides nothing — re-run it rather than
    // letting a sleeping screen pick which half of the app to blame.
    if (result.noData) {
      // But not forever: a page that is never visible re-runs the same set on
      // every pass, and an unattended phone would spin until someone noticed.
      state.noDataRetries = (state.noDataRetries || 0) + 1;
      if (state.noDataRetries > 2) {
        state.done = true;
        state.answer = null;
        state.aborted = true;
        state.note = 'Stopped: three runs in a row recorded no data, which means the ' +
          'page was in the background or the screen slept. Keep the phone awake and ' +
          'this page in front, then start the bisect again.';
        saveState(state);
        return resultsUrl();
      }
      saveState(state);
      return killUrl(kills);
    }
    state.noDataRetries = 0;

    // The app made no progress and still measured clean: one of these kills
    // broke the app rather than merely disabling a feature. Stop. Continuing
    // would follow a dead half of the search and name a feature with total
    // confidence and no evidence behind it.
    if (result.invalid) {
      state.done = true;
      state.answer = null;
      state.aborted = true;
      state.note = 'Stopped: with [' + describe(kills) + '] switched off the app ' +
        'answered no questions, so its clean reading means "nothing happened", not ' +
        '"nothing is wrong". One of those kills breaks the app and needs fixing ' +
        'before the search can continue.';
      saveState(state);
      return resultsUrl();
    }

    if (state.mode === 'ddmin') {
      ddminStep(state, !result.stalled);
      if (state.done) {
        state.answer = null;
        state.note = 'Minimal set that must be switched off: [' + describe(state.minimal) +
          ']. Removing any one of these brings the stall back, so no single feature ' +
          'is the cause — their combined cost is.';
        saveState(state);
        return resultsUrl();
      }
      var nextSet = nextTest(state);
      state.lastTested = nextSet;
      saveState(state);
      return killUrl(nextSet);
    }

    if (state.candidates.length > 1) {
      var tested = firstHalf(state.candidates);
      var other = rest(state.candidates);
      // Clean with this half applied -> what fixes it is IN this half.
      // Still stalling -> it is in the half we left alone.
      state.candidates = result.stalled ? other : tested;
    }

    var next = nextTest(state);
    if (!next) {
      state.done = true;
      // Converging on one feature is not the same as that feature being the
      // cause. The last run applied exactly that kill: if the app STILL stalled
      // with it off, then switching it off does not fix anything and naming it
      // would be a confident wrong answer — the worst kind. That is the
      // signature of two features that only stall together, or of a cause no
      // flag reaches.
      var last = state.history[state.history.length - 1];
      var confirmed = last && !last.stalled && last.kills.length === 1;
      state.answer = confirmed ? last.kills[0] : null;
      if (!state.answer) {
        state.note = last && last.stalled
          ? 'The search converged on ' + describe(state.candidates) +
            ', but the app still stalled with it switched off — so it is not the cause on its own.'
          : 'The search ran out of candidates.';
      }
      saveState(state);
      return resultsUrl();
    }
    saveState(state);
    return killUrl(next);
  }

  function start() {
    clearState();
    var state = { candidates: ALL.slice(), history: [], startedAt: Date.now() };
    saveState(state);
    return killUrl(firstHalf(ALL));
  }

  window.PerfBisect = {
    KILLS: KILLS,
    ALL: ALL,
    startDdmin: startDdmin,
    applyFromUrl: applyFromUrl,
    recordAndAdvance: recordAndAdvance,
    start: start,
    loadState: loadState,
    clearState: clearState,
    describe: describe,
    killUrl: killUrl
  };
})();
