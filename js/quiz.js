// ═══════════════════════════════════════════════════════════
// QUIZ STATE
// ═══════════════════════════════════════════════════════════
let settings = { mode: 'diagram', diff: '1', hem: 'B' };
let session = {
  questions: [], idx: 0, correct: 0,
  history: [], choices: [],
  lessonIdx: null, lessonLabel: '', lastMastered: false,
  calibration: false, calResults: []   // level-check mode (see js/calibration-ui.js)
};

// ═══════════════════════════════════════════════════════════
// QUESTION STATE  (issue #77)
// ═══════════════════════════════════════════════════════════
// A question has three states and the code used to model two, across three flags that
// already disagreed: session.answered (identify path only, and stale while a find
// question is up, because it is assigned below the find early-return), history[idx]
// (which cannot tell "never shown" from "shown, not answered"), and
// explore.quiz.answered (find path only).
//
//   unasked ──ask──▶ asked ──answer──▶ answered
//
// `asked` is the state that was missing, and recordSeen is the side effect that belongs
// on the transition into it: it records that the question was PUT TO the learner. With
// no transition to hang it on it was a guard on a state — "no answer yet" — which is
// true on EVERY re-render of an unanswered question, so a reload mid-question or a step
// back with Previous recorded the exposure again. That inflated `seen` without touching
// `correct`, which cools a constellation early in the review queue.
//
// askQuestion returns whether it actually transitioned, and that return value is what
// the caller gates recordSeen on. A second ask is not a transition, so it cannot record.
const QUESTION_UNASKED  = 'unasked';
const QUESTION_ASKED    = 'asked';
const QUESTION_ANSWERED = 'answered';

function questionState(q) { return q?.state || QUESTION_UNASKED; }
function questionIsAnswered(q) { return questionState(q) === QUESTION_ANSWERED; }

// unasked → asked. Returns true only for the transition itself; an already-asked or
// already-answered question stays where it is and answers false.
// Compares the state rather than testing q.state for truthiness: a question restored
// from storage carries the string 'unasked' where a freshly-planned one carries nothing,
// and both mean the same thing. Truthiness got this wrong and silently stopped every
// resumed lesson from recording exposures at all.
function askQuestion(q) {
  if (!q || questionState(q) !== QUESTION_UNASKED) return false;
  q.state = QUESTION_ASKED;
  return true;
}

// → answered, from wherever. A find question can be answered without a separate ask
// (its ask and its first render are the same moment), so this does not require `asked`.
function answerQuestion(q) { if (q) q.state = QUESTION_ANSWERED; }

// The two session-level halves, so no caller has to reach through to the current
// question itself — the reading side is what replaced session.answered: one value, asked
// of the question, with no second copy to go stale.
function sessionAnswered(session) {
  return questionIsAnswered(session.questions[session.idx]);
}
function answerCurrentQuestion(session) {
  answerQuestion(session.questions[session.idx]);
}
function currentCon() {
  const q = session.questions[session.idx];
  return q ? q.con : null;
}

// What the header's score slot says. A lesson counts; a level check does not (#67).
//
// A level check works by climbing PAST the point where the learner stops being right —
// computeDStar looks for the band where misses start outnumbering hits — so wrong later
// probes are the measurement working, not failure. Reporting "0 correct" through that
// contradicts the offer screen one step earlier, which promised placement in about 90
// seconds, and invites the one expensive error path here: quitting partway, which scores
// D* = 0 and drops the learner into the introduction grind the feature exists to spare
// them.
//
// A parameter rather than a fork, in the same spirit as #64: both flows ask this, so the
// wording cannot later change for only one of them. The x / 8 counter and the progress
// bar are untouched — position is honest, score is not.
function quizScoreReadout({ correct, calibration }) {
  return calibration ? 'Finding your level…' : `${correct} correct`;
}

// ── The identify screen's panel ──────────────────────────────────────────────
// One panel, mounted on first use into the two hosts that screen provides: the
// picture above, the toggles sharing the question label's slot below. The viewer
// mounts its own (issue #73), which is the whole reason this is a component.
let _identifyPanel = null;
function identifyPanel() {
  if (!_identifyPanel) {
    _identifyPanel = createRevealPanel({
      picture: document.getElementById('identify-picture'),
      controls: document.getElementById('identify-label-area'),
      layers: revState,
      onLayerChange(value, on) {
        revState[value] = on;
        saveLessonSession();
        // Only a reveal already on screen redraws — the panel knows whether there is
        // one, which is what the lesson session used to be asked.
        if (!_identifyPanel.shownIntent()) return;
        const redraw = () => _identifyPanel.redraw(identifyRevealIntent());
        const img = _identifyPanel.photoImg;
        if (value === 'photo' && (!img.complete || img.naturalWidth === 0)) img.onload = redraw;
        else redraw();
      },
    });
  }
  return _identifyPanel;
}

// The reveal the IDENTIFY SCREEN is asking for: its own toggles, the question's mode,
// rotation, and the learner's chosen star-figure set. The painter adds what only it
// knows — whether the photograph and artwork have loaded — and resolves the two into
// draw flags (js/reveal.js). The constellation viewer will build its own intent from
// its own state rather than borrowing this one (issue #73).
function identifyRevealIntent() {
  return {
    layers: {
      photo: revState.photo, diagram: revState.diagram,
      art: revState.art, boundary: revState.boundary,
    },
    mode: settings.mode,
    rotation: session.rotation,
    source: diagramSource,
  };
}

// Redraw the identify screen's canvas in place (e.g. after switching the diagram
// source) without the full showLessonQuestion side effects.
function redrawIdentifyFigure() {
  const q = session.questions[session.idx];
  if (!q) return;
  const con = q.con;
  if (sessionAnswered(session)) { identifyPanel().redraw(identifyRevealIntent(), con); return; }
  identifyPanel().showFigure(con, { mode: settings.mode, rotation: session.rotation });
}

// Thin adapters over the pure round-trip in js/lesson-session.js. This layer owns
// sessionStorage, the "only persist an active lesson" policy, and the DOM/toggle-
// group application; sessionToJSON/sessionFromJSON own the payload shape.
function saveLessonSession() {
  if (session.lessonIdx == null) return;
  sessionStorage.setItem('lesson-session', JSON.stringify(sessionToJSON(
    session,
    typeof revState !== 'undefined' ? revState : undefined,
    typeof eqRevState !== 'undefined' ? eqRevState : undefined
  )));
}

function tryResumeLesson() {
  try {
    const restored = sessionFromJSON(JSON.parse(sessionStorage.getItem('lesson-session')), C);
    if (!restored) return false;
    session.questions = restored.questions;
    session.idx = restored.idx;
    session.correct = restored.correct;
    session.history = restored.history;
    session.lessonIdx = 0;
    session.lessonLabel = restored.lessonLabel;
    // No session.answered to reset — each question carries its own state, restored from
    // the payload (#77). Resetting it here is exactly how a reload used to land on an
    // already-asked question looking untouched, and record its exposure a second time.
    // Restore reveal toggle states (globals + toggle-group DOM)
    if (restored.revState) {
      for (const k of Object.keys(restored.revState)) {
        revState[k] = restored.revState[k];
        identifyPanel().setLayer(k, restored.revState[k]);
      }
    }
    if (restored.eqRevState) {
      for (const k of Object.keys(restored.eqRevState)) {
        eqRevState[k] = restored.eqRevState[k];
        if (_eqRevToggleGroup) _eqRevToggleGroup.setValue(k, restored.eqRevState[k]);
      }
    }
    document.getElementById('identify-breadcrumb-stage').textContent = restored.lessonLabel;
    document.getElementById('identify-breadcrumb').style.display = '';
    showLessonQuestion();
    return true;
  } catch { return false; }
}

function getDistractors(correct, pool) {
  const others = pool.filter(c => c !== correct).sort(() => Math.random() - .5);
  const same = others.filter(c => c.diff === correct.diff);
  const rest = others.filter(c => c.diff !== correct.diff);
  return [...same, ...rest].slice(0, 3);
}

function updatePrevBtn() {
  // Calibration has no "previous" (going back would let a probe be re-answered and
  // re-scored); the quiz keeps its normal Previous affordance.
  if (session.calibration) { document.getElementById('btn-prev').classList.remove('show'); return; }
  document.getElementById('btn-prev').classList.toggle('show', session.idx > 0);
}

function showLessonQuestion() {
  const q = session.questions[session.idx];
  if (!q) return;
  const hist = session.history[session.idx];
  console.log('[quiz] question', session.idx, q.con.name, q.type, q.mode, 'answerMode:', q.answerMode, 'noBounds:', q.noBounds, 'distLevel:', q.distanceLevel);

  const total = session.questions.length;
  document.getElementById('hud-progress').textContent = `${session.idx + 1} / ${total}`;
  document.getElementById('hud-score').textContent = quizScoreReadout(session);
  document.getElementById('prog-fill').style.width = `${(session.idx / total) * 100}%`;

  // The one call site, deliberately above the fork so the two kinds of question cannot
  // drift apart again: the find branch used to record unconditionally while the identify
  // branch guarded, so re-rendering an ANSWERED find question — exactly what returning
  // from a finding guide does — counted the exposure twice (#75, #76).
  //
  // And it is a TRANSITION now, not a guard on a state (#77). askQuestion answers true
  // only for unasked → asked, so re-showing a question the learner has already been
  // shown — a reload mid-question, a step back with Previous — records nothing. The old
  // guard asked "no answer yet", which is true every one of those times.
  //
  // The level check measures before it seeds (D*), so a probe records nothing: a lucky
  // right answer must not credit the constellation. It still transitions, because the
  // state describes the question, not the bookkeeping.
  const firstAsk = askQuestion(q);
  if (firstAsk && !session.calibration) recordSeen(q.con.abbr, questionKey(q));
  // Persist the transition itself. Both branches below happen to save when they set
  // their own first-ask field (q.rotation, q.startP) — which is exactly the accidental
  // encoding #77 removes, so the state must not depend on it still being true.
  if (firstAsk) saveLessonSession();

  if (q.type === 'find') { startLessonFindQuestion(q); return; }

  showScreen('identify');
  settings.mode = q.mode;

  const con = q.con;
  const isAuto = q.answerMode === 'autocomplete';

  document.getElementById('feedback').textContent = '';
  identifyPanel().clear();
  // Reset reveal toggles to all-on only for unanswered questions
  if (!hist) {
    for (const k of ['photo', 'diagram', 'art', 'boundary']) {
      revState[k] = true;
      identifyPanel().setLayer(k, true);
    }
  }
  document.getElementById('btn-next').classList.remove('show');

  const panel = identifyPanel();
  panel.photoBox.classList.remove('show');
  panel.photoImg.classList.remove('show');
  panel.canvas.style.display = 'block';
  panel.circular(true);

  if (hist) {
    session.rotation = hist.rotation;
  } else {
    if (q.rotation == null) {
      q.rotation = Math.random() * Math.PI * 2;
      saveLessonSession();
    }
    session.rotation = q.rotation;
  }

  panel.resize();   // only when it changed — see sizeCanvas (projection.js)

  // The question is drawn first; a reveal may follow. showFigure also clears the
  // panel's record of what it is showing, so a late image cannot paint a reveal over
  // a question the learner has not answered.
  panel.showFigure(con, { mode: settings.mode, rotation: session.rotation });

  const grid = document.getElementById('ans-grid');
  const autoArea = document.getElementById('autocomplete-area');
  grid.style.display = isAuto ? 'none' : '';
  autoArea.style.display = isAuto ? '' : 'none';
  if (isAuto) {
    const acInput = document.getElementById('identify-autocomplete-input');
    acInput.value = hist ? (hist.chosen?.name || '') : '';
    document.getElementById('autocomplete-msg').textContent = '';
    acInput.disabled = !!hist;
    document.getElementById('identify-autocomplete-submit').style.display = hist ? 'none' : '';
    if (!hist) acInput.focus();
  }

  // Distractor pool: diff 1–2 (13 well-known constellations) are always included;
  // others must have been introduced already or appear in this lesson.
  const exp = loadExposure();
  const lessonAbbrs = new Set(session.questions.map(q => q.con.abbr));
  const distractorPool = C.filter(c =>
    c.stars.length > 0 &&
    (c.diff <= 2 || lessonAbbrs.has(c.abbr) || (exp[c.abbr]?.['identify/diagram']?.seen || 0) > 0)
  );

  if (hist) {
    if (!isAuto) {
      grid.innerHTML = '';
      hist.choices.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'ans-btn';
        btn.textContent = c.name;
        btn.disabled = true;
        if (c === con) btn.classList.add('ok');
        else if (c === hist.chosen && hist.chosen !== con) btn.classList.add('err');
        grid.appendChild(btn);
      });
    }
    document.getElementById('feedback').innerHTML = hist.wasCorrect
      ? `✓ Correct! — ${conLabel(con, { link: 'blurb' })}`
      : `✗ That was ${conLabel(con, { link: 'blurb' })}`;
    identifyPanel().showReveal(con, identifyRevealIntent());
    document.getElementById('btn-next').classList.add('show');
  } else if (!isAuto) {
    grid.innerHTML = '';
    if (!q.choices) {
      const wrongs = getDistractors(con, distractorPool);
      q.choices = [con, ...wrongs].sort(() => Math.random() - .5).map(c => c.abbr);
      saveLessonSession();
    }
    session.choices = q.choices.map(abbr => C.find(c => c.abbr === abbr)).filter(Boolean);
    session.choices.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'ans-btn';
      btn.textContent = c.name;
      btn.addEventListener('click', () => handleAnswer(c, con));
      grid.appendChild(btn);
    });
  }

  updatePrevBtn();
}

function handleAnswer(chosen, correct) {
  // The double-answer guard asks the question, not a session-level flag (#77).
  if (sessionAnswered(session)) return;
  answerCurrentQuestion(session);

  session.history[session.idx] = {
    chosen, wasCorrect: chosen === correct,
    rotation: session.rotation, choices: session.choices,
  };

  document.querySelectorAll('.ans-btn').forEach(b => {
    b.disabled = true;
    if (b.textContent === correct.name) b.classList.add('ok');
    else if (b.textContent === chosen.name && chosen !== correct) b.classList.add('err');
  });

  // Calibration level check: record the probe result (by diff band) for D* scoring —
  // no exposure write, no reveal. Everything else (screen, choices, feedback) is the
  // quiz's own, so the probe looks identical to an identify question.
  if (session.calibration) {
    const right = chosen === correct;
    session.calResults[session.idx] = { diff: correct.diff, correct: right };
    // session.correct still counts — the payoff panel reports it once at the end. It is
    // the RUNNING readout that misleads, so the header keeps saying what it is doing.
    if (right) {
      session.correct++;
      document.getElementById('hud-score').textContent = quizScoreReadout(session);
    }
    // A level check offers no way out of itself: no link, no blurb, no guide, no
    // explorer (#64). It is a test of what you already know, not a place to learn.
    document.getElementById('feedback').innerHTML = right
      ? `✓ Correct! — ${conLabel(correct, { link: false })}`
      : `✗ That was ${conLabel(correct, { link: false })}`;
    document.getElementById('btn-next').classList.add('show');
    updatePrevBtn();
    return;
  }

  if (chosen === correct) {
    session.correct++;
    document.getElementById('hud-score').textContent = quizScoreReadout(session);
    document.getElementById('feedback').innerHTML = `✓ Correct! — ${conLabel(correct, { link: 'blurb' })}`;
    const q = session.questions[session.idx];
    if (q) recordCorrect(q.con.abbr, questionKey(q));
  } else {
    document.getElementById('feedback').innerHTML = `✗ That was ${conLabel(correct, { link: 'blurb' })}`;
  }

  identifyPanel().showReveal(correct, identifyRevealIntent());

  document.getElementById('btn-next').classList.add('show');
  updatePrevBtn();
  saveLessonSession();
}

function handleAutocompleteAnswer() {
  if (sessionAnswered(session)) return;
  const val    = document.getElementById('identify-autocomplete-input').value.trim();
  const chosen = C.find(c => c.name.toLowerCase() === val.toLowerCase());
  if (!chosen) {
    document.getElementById('autocomplete-msg').textContent = 'Unknown constellation';
    return;
  }
  document.getElementById('autocomplete-msg').textContent = '';
  document.getElementById('identify-autocomplete-input').disabled = true;
  document.getElementById('identify-autocomplete-submit').style.display = 'none';
  const q = session.questions[session.idx];
  answerCurrentQuestion(session);
  const correct = q.con;
  const wasCorrect = chosen === correct;
  session.history[session.idx] = { chosen, wasCorrect, rotation: session.rotation, choices: [] };
  if (wasCorrect) {
    session.correct++;
    document.getElementById('hud-score').textContent = quizScoreReadout(session);
    document.getElementById('feedback').innerHTML = `✓ Correct! — ${conLabel(correct, { link: 'blurb' })}`;
    if (q) recordCorrect(q.con.abbr, questionKey(q));
  } else {
    document.getElementById('feedback').innerHTML = `✗ That was ${conLabel(correct, { link: 'blurb' })}`;
  }
  identifyPanel().showReveal(correct, identifyRevealIntent());
  document.getElementById('btn-next').classList.add('show');
  updatePrevBtn();
  saveLessonSession();
}

function nextLessonQuestion() {
  if (session.calibration) {
    session.idx++;
    if (session.idx >= session.questions.length) finishCalibrationProbes();
    else showLessonQuestion();
    return;
  }
  session.idx++;
  saveLessonSession();
  if (session.idx >= session.questions.length) endLesson();
  else showLessonQuestion();
}

// showScreen moved to js/screens.js, which is now the only writer of the active
// screen — that is what makes currentScreen() trustworthy. The DOM body of it is
// the setScreen sink main.js injects at boot.
