// ═══════════════════════════════════════════════════════════
// CALIBRATION SCREEN — the level-check flow (issue #33)
// ═══════════════════════════════════════════════════════════
//
// The offer and payoff are panels on #screen-calibration; the 8 probes run on the
// real quiz screen (#screen-quiz) as ordinary identify/diagram questions — see
// calBegin. Pure pieces live in js/calibration.js (calibrationProbes,
// dStarFromProbeResults, seedExposureFromCalibration); this is the impure DOM adapter.

// ── Entry points (ticket #34) ──────────────────────────────────────────────
// True when the learner has no recorded progress yet — the first-run trigger.
// exposureIsEmpty (course.js) owns knowledge of the stored shape.
function calibrationIsFirstRun() {
  return exposureIsEmpty(loadExposure());
}

// The screen to land on at launch. On a first run arriving at the default landing
// (empty hash or #course), offer the level check; otherwise honor the requested
// route (never hijack an explicit hash like #explore or #view/Ori), defaulting an
// empty hash to the course home. Pure — main.js supplies hash + first-run flag.
function calibrationEntryTarget(hash, firstRun) {
  const entry = hash || 'course';
  if (entry === 'course' && firstRun) return 'calibration';
  return entry;
}

function showCalPanel(name) {
  document.querySelectorAll('#screen-calibration .cal-panel')
    .forEach(p => p.classList.remove('active'));
  document.getElementById('cal-' + name).classList.add('active');
}

// Entry point (routed from #calibration): show the offer.
function startCalibration() {
  showScreen('calibration');
  showCalPanel('offer');
}

// Offer → run the 8 shuffled probes on the REAL quiz screen (#screen-quiz), so a probe
// is literally an identify/diagram question — same header, circle, choices, feedback.
// We build a calibration `session` and hand off to showLessonQuestion; the quiz's
// answer/next handlers branch on session.calibration (see js/quiz.js). lessonIdx:null
// keeps saveLessonSession a no-op (a level check never persists as a resumable lesson);
// rotation:0 keeps each probe north-up so it measures recognition fairly.
function calBegin() {
  const probes = shuffleInPlace(calibrationProbes(C));
  session.calibration = true;
  session.viewMode = false;
  session.lessonIdx = null;
  session.questions = probes.map(con =>
    ({ con, type: 'identify', mode: 'diagram', answerMode: 'choice', rotation: 0 }));
  session.idx = 0;
  session.correct = 0;
  session.answered = false;
  session.history = [];
  session.calResults = [];
  session.lessonLabel = 'Level check';
  document.getElementById('screen-quiz').classList.remove('viewer-mode');
  document.getElementById('quiz-breadcrumb-stage').textContent = 'Level check';
  document.getElementById('quiz-breadcrumb').style.display = '';
  showLessonQuestion();
}

// Called from nextLessonQuestion (js/quiz.js) after the last probe: score → seed → payoff.
function finishCalibrationProbes() {
  session.calibration = false;
  calFinish(dStarFromProbeResults(session.calResults));
}

// Skip → D* = 0 (no seeding, no-op) and straight to the payoff's "from the beginning".
function calSkip() { calFinish(0); }

// Score → seed → payoff. Snapshots exposure before seeding so newlyPassed() can
// light exactly the constellations this run unlocked on the payoff grid.
function calFinish(dStar) {
  const before = loadExposure();
  seedExposureFromCalibration(dStar);   // no-op when dStar <= 0
  const after = loadExposure();
  showCalPayoff(dStar, before, after);
}

// Pure: the payoff screen's copy. `dStar` is the score, `unlocked` the count it
// credits, `hadProgress` whether the learner already had progress before this run.
// A D* ≤ 0 with existing progress is a re-run skip — it must NOT read as "starting
// from the beginning" (nothing changed; the seed only ever raises). Returns
// { head, unlock (may contain HTML), band } — band '' de-emphasizes to nothing.
function calibrationPayoffCopy(dStar, unlocked, hadProgress) {
  if (dStar <= 0) {
    return hadProgress
      ? { head: 'No changes',
          unlock: 'Your progress is unchanged — the level check only ever raises it, never lowers it.',
          band: '' }
      : { head: 'Starting from the beginning',
          unlock: 'No worries — we’ll introduce constellations one at a time, from the easiest.',
          band: '' };
  }
  if (dStar >= 8) {
    return { head: 'You know the whole sky',
             unlock: `All <b>${unlocked}</b> constellations unlocked for review — you’ll skip every introduction and go straight to practice.`,
             band: `difficulty band ${dStar} of 8` };
  }
  return { head: 'We’ve placed you',
           unlock: `<b>${unlocked}</b> constellations unlocked for review — you’re skipping the intro grind and starting where you already are.`,
           band: `difficulty band ${dStar} of 8` };
}

function showCalPayoff(dStar, before, after) {
  // The probes run on #screen-quiz, so return to the calibration screen for the payoff
  // (a skip from the offer is already here — harmless to re-assert).
  showScreen('calibration');
  // Count derives from the same targets the seed wrote, so the two never drift.
  const unlocked = calibrationSeedTargets(C, dStar).length;
  const copy = calibrationPayoffCopy(dStar, unlocked, !exposureIsEmpty(before));
  document.getElementById('cal-res-head').textContent = copy.head;
  document.getElementById('cal-res-unlock').innerHTML = copy.unlock;
  document.getElementById('cal-res-band').textContent = copy.band;

  // The real progress grid (shared renderer), lighting the just-seeded cons via the
  // newlyPassed highlight. Reads the freshly-seeded exposure, so cells light for free.
  renderProgressGrid(document.getElementById('cal-grid'), C, after, {
    highlight: newlyPassed(before, after, C),
    onCardClick: (con, card) => showCourseDetail(con, card),
  });

  showCalPanel('payoff');
}

// Wire the buttons + manual trigger once, from main.js init.
function initCalibration() {
  document.getElementById('cal-begin').addEventListener('click', calBegin);
  document.getElementById('cal-skip').addEventListener('click', calSkip);
  document.getElementById('cal-start-lesson').addEventListener('click', () => {
    // Drop any stale in-flight lesson so this generates a fresh one on the seeded
    // exposure (navigate('lesson') would otherwise resume a leftover session).
    sessionStorage.removeItem('lesson-session');
    navigate('lesson');
  });
  document.getElementById('cal-retake').addEventListener('click', startCalibration);
  // Course-screen re-run entry (#34): re-launch the flow anytime. The offer screen
  // carries the upward-merge framing, so it reads as safe (never lowers progress).
  const trigger = document.getElementById('btn-level-check');
  if (trigger) trigger.addEventListener('click', () => navigate('calibration'));
}
