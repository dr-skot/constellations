// js/find-guide.js
// The in-app finding-guide SESSION: how a guide is entered, what it interrupts, and where
// leaving it goes.
//
// Loading, preparing and validating a guide is not here any more — that is the GUIDE
// SOURCE (js/guide-source.js, spec #82). This file used to open-code the pipeline, and
// find-help.html open-coded it a second time with its fetches outside the ?v= fence (#83).
// What is left is the part that is genuinely about this app rather than about the data:
// the chrome the guide takes over, the quiz it suspends, and the detour it may be riding.

let _guideSaved = null;   // saved quiz + view while a guide is open

// Which open-request is current. A guide's data is fetched, so between the tap and the
// guide existing there is a window in which _guideSaved is still null and closeFindGuide
// has nothing to close — while the controls that would close it are still on screen,
// because the takeover chrome is not applied until the data lands. Quit during that
// window ended the lesson and then let the guide open over the wreckage, publishing a
// step display and flying the camera on a hidden screen, exit labelled "← Back to
// lesson" for a lesson that had finished (#94).
//
// Ordering two lifetimes has no hold on one that does not exist yet, so cancellation is
// a generation token: every open takes the next number, every close burns it, and a load
// that lands on a stale number stands down.
let _guideGen = 0;

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

  const gen = ++_guideGen;

  Promise.all([prepareGuide(con, { origin }), skyCatalog()]).then(([guide, catalog]) => {
    if (gen !== _guideGen) return;            // superseded or cancelled while loading
    if (!guide) return;                       // no guide written for this constellation

    // The suspended quiz is the whole of what has to be remembered. It used to be saved
    // alongside two elements' display strings, which is how four of the six went
    // unrestored — and the quiz already answers the same question those strings did:
    // a guide opened over a find question has one, a guide opened from free explore
    // does not. See issue #4 for the two entry paths, #94 for why naming the mode on
    // the way out beats restoring what was showing on the way in.
    _guideSaved = { quiz: explore.quiz, ...snapshotView(explore) };
    explore.quiz = null;

    // A guide is a takeover: its overlay and nothing else, whichever way it was opened.
    applyExploreChrome(EXPLORE_CHROME_GUIDE);

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
        lessonFindQuestion: !!_guideSaved.quiz,
      }),
    });
  },
  // Rejection handler as the SECOND argument to .then, not a .catch chained after it.
  // A trailing .catch also swallows anything thrown by the callback above — and by then
  // explore.quiz is nulled, both bars are hidden and the overlay is up, so a throw from
  // guideStart would strand the learner on a half-transitioned screen with nothing
  // logged. This way only a failed LOAD is absorbed, which is the case that genuinely
  // means "leave the explorer exactly as it was"; a bug still surfaces, as it did before
  // this file had any handler at all.
  () => {});
}

// ── Public: tear the guide down, going nowhere ────────────────────────────────
// Stops the guide and takes its chrome off, and that is all — no resume, no detour.
// Split out from exitFindGuide because a lesson ending has to end a guide living inside
// it WITHOUT returning to the question it would otherwise resume: that question is the
// one being ended (#94). Returns what was suspended, or null if no guide was open.
//
// Free explore is the chrome it leaves behind because it is the only mode that is always
// safe: whoever called this decides what comes next and names its own mode, and a detour
// may be heading for the constellation viewer, a different screen entirely.
function closeFindGuide() {
  // Burn the token first and unconditionally: a guide still loading has no _guideSaved to
  // find, and cancelling it is the entire point of being called during that window.
  _guideGen++;
  if (!_guideSaved) return null;
  guideStop();
  const saved = _guideSaved;
  _guideSaved = null;
  applyExploreChrome(EXPLORE_CHROME_FREE);
  return saved;
}

// ── Public: close the guide and go back where it came from ────────────────────
function exitFindGuide() {
  const saved = closeFindGuide();
  if (!saved) return;

  // A detour in flight owns where to go next — back to the question we left, whose own
  // re-render names its chrome.
  if (inDetour()) { endDetour(); return; }

  // Otherwise the guide restores what it suspended. The saved quiz IS the mode: a guide
  // opened over a find question has one, a guide opened from free explore does not.
  explore.quiz = saved.quiz;
  applyView(explore, saved);
  if (saved.quiz) applyExploreChrome(EXPLORE_CHROME_FIND);
  requestExploreDraw();
}
