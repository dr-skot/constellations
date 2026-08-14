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
    if (flag('noart')) {
      try {
        if (typeof ART === 'object') for (var k in ART) delete ART[k];
        done.push('art');
      } catch (e) {}
    }
    return done;
  }

  // ── A lesson of multiple-choice questions only ─────────────────────────────
  // ONLY for the "minus find questions" rung. The reproducer must NOT use this:
  // the stall was first seen while the app sat on a find question with the sky
  // rendering, so removing find questions removes the bug being measured.
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

  function active(id) {
    var el = document.getElementById(id);
    return !!(el && el.classList.contains('active'));
  }

  function tick() {
    // The result screen FIRST. endLesson never clears .show from btn-next
    // (quiz.js only clears it in showLessonQuestion), so a naive "click btn-next
    // if it is showing" clicks a hidden button, re-enters nextLessonQuestion, runs
    // off the end of the lesson and calls endLesson again — rebuilding the whole
    // practiced-constellation grid, canvases and all, every tick. The run then
    // measures the driver thrashing endLesson instead of the app being used.
    if (active('screen-result')) {
      var again = document.querySelector('#result-btns .btn-again');   // "Next Lesson >"
      if (again) { again.click(); return; }
    }

    // Answered already? Advance — but only while the quiz screen is genuinely up.
    var next = document.getElementById('btn-next');
    if (active('screen-quiz') && next && next.classList.contains('show')) { next.click(); return; }

    var answers = [].slice.call(document.querySelectorAll('.ans-btn')).filter(function (b) {
      return !b.disabled;
    });
    if (answers.length) { answers[Math.floor(Math.random() * answers.length)].click(); return; }

    // A find-in-the-sky question: the explorer is on screen. Sit on it, exactly
    // as the first run did when it stalled — do NOT skip past it. Its Next button
    // appears once answered, so honour that if it shows.
    var eq = document.getElementById('eq-next');
    if (active('screen-explore') && eq && eq.classList.contains('show')) { eq.click(); return; }
    if (active('screen-explore')) return;

    // Result screen or nowhere useful — start another lesson.
    if (flag('choiceonly')) seedChoiceLesson();
    else if (typeof navigate === 'function') navigate('lesson');
  }

  ready(function () {
    var removed = applyRemovals();
    var rung = parseInt((/[?&]rung=(\d+)/.exec(location.search) || [])[1] || '11', 10);

    // The reproducer is the app EXACTLY as it is used: existing progress, a
    // resumed lesson if there is one, whatever question the planner serves,
    // whatever screens have already been visited. Nothing is cleared, seeded or
    // steered — every previous attempt to "prepare" it removed a condition that
    // might be the bug and then reported clean.
    //
    // The observed freeze happens on ordinary four-button identify questions, so
    // question type is a variable to TEST (rung 12), never an assumption to build in.
    try {
      var onQuestion = document.querySelector('.ans-btn') ||
                       (document.getElementById('screen-explore') || {}).classList &&
                       document.getElementById('screen-explore').classList.contains('active');
      if (!onQuestion && typeof navigate === 'function') navigate('lesson');
    } catch (e) {}

    setTimeout(function () {
      if (flag('choiceonly')) seedChoiceLesson();
      var note = (removed.length ? 'minus ' + removed.join(', ') + '\n' : '') +
                 (flag('choiceonly') ? 'choice-only\n' : 'real lesson\n');

      setTimeout(function () {
        if (Perf.param('auto') === '1') {
          Perf.hud('rung ' + rung + '\n' + note + 'measuring...');
          Perf.autoRun(rung, tick);
        } else {
          // MANUAL: no auto-ticker. Real taps are the only thing driving the page,
          // which is the one input a synthetic click cannot reproduce.
          Perf.measure({ seconds: 30, tick: null, label: 'rung ' + rung + ' — TAP IT',
            onDone: function (r) {
              Perf.record(rung, r);
              Perf.hud('rung ' + rung + ': ' + r.verdict + '\ntaps ' + r.taps +
                       '  fps ' + r.fps +
                       '\nworst paint ' + (r.worstPaintMs / 1000).toFixed(1) + 's' +
                       '\nthread ' + (r.threadBlocked ? 'BLOCKED' : 'free'));
            } });
        }
      }, 500);
    }, 500);
  });
})();
