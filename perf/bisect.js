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
    { id: 'gl', what: 'WebGL context (sky falls back to 2D)', apply: function () {
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

  // The set to test next, given where the search stands. Returns null when done.
  function nextTest(state) {
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
    applyFromUrl: applyFromUrl,
    recordAndAdvance: recordAndAdvance,
    start: start,
    loadState: loadState,
    clearState: clearState,
    describe: describe,
    killUrl: killUrl
  };
})();
