// js/find-guide.js
// The in-app finding-guide SESSION: how a guide is entered, what it interrupts, and where
// leaving it goes.
//
// Loading, preparing and validating a guide is not here any more — that is the GUIDE
// SOURCE (js/guide-source.js, spec #82). This file used to open-code the pipeline, and
// find-help.html open-coded it a second time with its fetches outside the ?v= fence (#83).
// What is left is the part that is genuinely about this app rather than about the data:
// the chrome the guide takes over, the quiz it suspends, and the detour it may be riding.

let _guideSaved = null;   // saved quiz + chrome + view while a guide is open

// ── Public: show/hide help button based on guide availability ────────────────
function updateFindHelpBtn(con) {
  const btn = document.getElementById('find-help-btn');
  btn.style.display = 'none';
  hasGuide(con).then(exists => { btn.style.display = exists ? 'block' : 'none'; })
               .catch(() => {});
}

// ── Public: open the guide ───────────────────────────────────────────────────
// Where the learner goes on exit is not this module's business: if a detour is in
// flight (the guide was launched from a quiz question or a level-check probe, see
// issue #35), ending it returns them. Otherwise the explorer is restored.
function startFindGuide(con) {
  // Where the learner is looking, read at the moment they asked rather than whenever the
  // data lands. Every guide opens on a `random` step, which means "start from here"; the
  // sky they were looking at when they tapped is the one they meant. The old code read
  // explore.P after the load resolved, which is the same thing whenever the guides are
  // already warm — which is always, in practice — and the wrong thing if they are not.
  const origin = vecToRaDec(explore.P);

  Promise.all([prepareGuide(con, { origin }), skyCatalog()]).then(([guide, catalog]) => {
    if (!guide) return;                       // no guide written for this constellation

    const quizBar = document.getElementById('explore-quiz-bar');
    const navRow  = document.getElementById('find-nav-row');
    // Capture the bars' prior visibility so exit restores exactly what was showing
    // — the guide can be launched from a find quiz (bars visible) or from the info
    // modal's "Finding guide" link in free explore (bars hidden). See issue #4.
    _guideSaved = { quiz: explore.quiz, quizBarDisplay: quizBar.style.display, navRowDisplay: navRow.style.display, ...snapshotView(explore) };
    explore.quiz = null;

    quizBar.style.display = 'none';
    navRow.style.display  = 'none';
    document.getElementById('find-guide-overlay').style.display  = '';

    // Two places the exit can return to, and they are asked in the order exitFindGuide
    // takes them: a detour in flight wins, otherwise it is whatever the saved state puts
    // back — a lesson's find question if "? Help" opened the guide over one, free
    // explore if nothing did. The wording itself is a pure decision and lives in
    // js/guide-exit-label.js; this only gathers the facts it needs.
    const detour = detourOrigin();
    const detourCon = detour?.name === 'view' ? C.find(c => c.abbr === detour.param) : null;
    guideStart(guide.steps, catalog, {
      roll: guide.roll,
      onLastNext: exitFindGuide,
      exitLabel: guideExitLabel({
        route: detour?.name || null,
        conName: detourCon?.name || null,
        lessonFindQuestion: !!_guideSaved.quiz?.lessonMode,
      }),
    });
  }).catch(() => {});      // a failed load leaves the explorer exactly as it was
}

// ── Public: close the guide ───────────────────────────────────────────────────
function exitFindGuide() {
  if (!_guideSaved) return;
  guideStop();
  document.getElementById('find-guide-overlay').style.display = 'none';

  const saved = _guideSaved;
  _guideSaved = null;

  // A detour in flight owns where to go next — back to the question we left.
  if (inDetour()) { endDetour(); return; }

  // Default: restore the explore view and the find-quiz bars we came from.
  explore.quiz = saved.quiz;
  applyView(explore, saved);
  document.getElementById('explore-quiz-bar').style.display = saved.quizBarDisplay;
  document.getElementById('find-nav-row').style.display     = saved.navRowDisplay;
  requestExploreDraw();
}
