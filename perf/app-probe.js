// Rungs 11+: the real app, measured by the same harness as every other rung.
// Loaded by index.html only when ?perf=1 is present, so normal runs pay nothing.
//
// Rung 11 measures the real app as-is. Rungs 12+ remove ONE subsystem each
// (?noexplore=1, ?nogl=1, ?nodatalist=1, ?nophoto=1) so that when 11 stalls and
// rungs 1-10 are clean, the first removal that comes back clean names the culprit.

(function () {
  'use strict';

  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  function flag(name) { return new RegExp('[?&]' + name + '=1').test(location.search); }

  function ready(fn) {
    if (document.readyState === 'complete') setTimeout(fn, 400);
    else window.addEventListener('load', function () { setTimeout(fn, 400); });
  }

  // ── Subtractions, applied before measuring ─────────────────────────────────
  function applyRemovals() {
    var done = [];
    if (flag('nophoto')) {
      try {
        window.photoUrl = function () { return BLANK; };
        var pi = document.getElementById('photo-img');
        if (pi) pi.src = BLANK;
        done.push('photos');
      } catch (e) {}
    }
    if (flag('nogl')) {
      try {
        var gc = document.getElementById('explore-gl-canvas');
        if (gc) {
          var c = gc.getContext('webgl');
          var ext = c && c.getExtension('WEBGL_lose_context');
          if (ext) ext.loseContext();
          gc.parentNode.removeChild(gc);
        }
        window.gl = null;
        done.push('webgl');
      } catch (e) {}
    }
    if (flag('nodatalist')) {
      try {
        var lists = document.querySelectorAll('datalist');
        for (var i = 0; i < lists.length; i++) lists[i].innerHTML = '';
        done.push('datalists');
      } catch (e) {}
    }
    if (flag('noexplore')) {
      try {
        var se = document.getElementById('screen-explore');
        if (se) se.parentNode.removeChild(se);
        done.push('explore screen');
      } catch (e) {}
    }
    return done;
  }

  // ── A lesson of multiple-choice questions only ─────────────────────────────
  // The planner mixes in find-in-the-sky questions, which the auto-answerer
  // cannot click — it would sit there recording nothing. The complaint is about
  // the quiz buttons, so build a deterministic identify/diagram lesson instead.
  function seedChoiceLesson() {
    if (typeof C === 'undefined' || typeof session === 'undefined') return false;
    var picks = C.slice(0, 24);
    session.questions = picks.map(function (con) {
      return { con: con, type: 'identify', mode: 'diagram', answerMode: 'choice' };
    });
    session.idx = 0;
    session.correct = 0;
    session.answered = false;
    session.history = [];
    session.lessonIdx = 0;
    session.lessonLabel = 'Perf run';
    session.viewMode = false;
    session.calibration = false;
    try { showLessonQuestion(); } catch (e) { return false; }
    return true;
  }

  function tick() {
    // Answered already? Advance.
    var next = document.getElementById('btn-next');
    if (next && next.classList.contains('show')) { next.click(); return; }

    var answers = [].slice.call(document.querySelectorAll('.ans-btn')).filter(function (b) {
      return !b.disabled;
    });
    if (answers.length) { answers[Math.floor(Math.random() * answers.length)].click(); return; }

    // Ran off the end of the lesson (result screen) — start another.
    seedChoiceLesson();
  }

  ready(function () {
    var removed = applyRemovals();
    var rung = parseInt((/[?&]rung=(\d+)/.exec(location.search) || [])[1] || '11', 10);

    // Get onto a quiz question before the clocks start.
    try { if (typeof navigate === 'function') navigate('lesson'); } catch (e) {}

    setTimeout(function () {
      var ok = seedChoiceLesson();
      var note = (removed.length ? 'minus ' + removed.join(', ') + '\n' : '') +
                 (ok ? '' : 'could not seed lesson\n');

      setTimeout(function () {
        if (Perf.param('auto') === '1') {
          Perf.hud('rung ' + rung + '\n' + note + 'measuring...');
          Perf.autoRun(rung, tick);
        } else {
          Perf.hud('rung ' + rung + ' — manual\n' + note + 'tap through questions\n20s...');
          Perf.measure({ seconds: 20, tick: tick, onDone: function (r) {
            Perf.record(rung, r);
            Perf.hud('rung ' + rung + ': ' + r.verdict + '\nfps ' + r.fps +
                     '\nworst paint ' + (r.worstPaintMs / 1000).toFixed(1) + 's');
          } });
        }
      }, 500);
    }, 500);
  });
})();
