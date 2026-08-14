// Rung 11: the real app, measured by the same harness as every other rung.
// Loaded by index.html only when ?perf=1 is present, so it costs nothing normally.
//
// The "tick" here is a real question change: answer the current question, then
// advance. That drives exactly the path the learner complains about.

(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') setTimeout(fn, 400);
    else window.addEventListener('load', function () { setTimeout(fn, 400); });
  }

  function tick() {
    // On a quiz question: answer it, or if already answered, go to the next one.
    var next = document.getElementById('btn-next');
    if (next && next.classList.contains('show')) { next.click(); return; }

    var answers = [].slice.call(document.querySelectorAll('.ans-btn')).filter(function (b) {
      return !b.disabled;
    });
    if (answers.length) { answers[Math.floor(Math.random() * answers.length)].click(); return; }

    // On a find question the explorer is showing; its Next is a different button.
    var eq = document.getElementById('eq-next');
    if (eq && eq.classList.contains('show')) { eq.click(); return; }

    // Nothing actionable (find question awaiting a sky tap) — skip to a fresh lesson.
    if (typeof navigate === 'function') navigate('lesson');
  }

  ready(function () {
    // Make sure we are actually on a question before measuring.
    try {
      if (typeof navigate === 'function' && !document.querySelector('.ans-btn')) navigate('lesson');
    } catch (e) {}

    setTimeout(function () {
      if (Perf.param('auto') === '1') {
        Perf.autoRun(11, tick);
      } else {
        Perf.hud('real app — manual\ntap through questions\nmeasuring 20s...');
        Perf.measure({ seconds: 20, tick: tick, onDone: function (r) {
          Perf.record(11, r);
          Perf.hud('real app: ' + r.verdict + '\nfps ' + r.fps +
                   '\nworst paint ' + (r.worstPaintMs / 1000).toFixed(1) + 's');
        } });
      }
    }, 600);
  });
})();
