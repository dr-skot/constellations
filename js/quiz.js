// ═══════════════════════════════════════════════════════════
// QUIZ STATE
// ═══════════════════════════════════════════════════════════
let settings = { mode: 'diagram', diff: '1', hem: 'B' };
let session = {
  questions: [], idx: 0, correct: 0, answered: false,
  history: [], choices: [], viewMode: false,
  lessonIdx: null, lessonLabel: '', lastMastered: false
};
function currentCon() {
  const q = session.questions[session.idx];
  return q ? q.con : null;
}

function saveLessonSession() {
  if (session.lessonIdx == null) return;

  sessionStorage.setItem('lesson-session', JSON.stringify({
    _v: 2,
    lessonLabel: session.lessonLabel,
    questions: session.questions.map(q => ({
      abbr: q.con.abbr, type: q.type, mode: q.mode,
      answerMode: q.answerMode,
      ...(q.distanceLevel != null ? { distanceLevel: q.distanceLevel } : {}),
      ...(q.noBounds ? { noBounds: true } : {})
    })),
    idx: session.idx,
    correct: session.correct,
    revState: { ...revState },
    eqRevState: typeof eqRevState !== 'undefined' ? { ...eqRevState } : undefined,
    history: session.history.map(h => h ? {
      ...h,
      chosen: h.chosen?.abbr || null,
      choices: (h.choices || []).map(c => c?.abbr || c)
    } : null)
  }));
}

function tryResumeLesson() {
  try {
    const d = JSON.parse(sessionStorage.getItem('lesson-session'));
    if (!d || !d.lessonLabel || d._v !== 2) return false;
    const questions = d.questions.map(q => {
      const con = C.find(c => c.abbr === q.abbr);
      if (!con) return null;
      return { con, type: q.type, mode: q.mode,
               answerMode: q.answerMode,
               ...(q.distanceLevel != null ? { distanceLevel: q.distanceLevel } : {}),
               ...(q.noBounds ? { noBounds: true } : {}) };
    }).filter(Boolean);
    if (questions.length !== d.questions.length) return false;
    session.questions = questions;
    session.idx = d.idx;
    session.correct = d.correct;
    session.history = (d.history || []).map(h => {
      if (!h) return null;
      return {
        ...h,
        chosen: typeof h.chosen === 'string' ? C.find(c => c.abbr === h.chosen) || null : h.chosen,
        choices: (h.choices || []).map(c => typeof c === 'string' ? C.find(con => con.abbr === c) || c : c)
      };
    });
    session.lessonIdx = 0;
    session.lessonLabel = d.lessonLabel;
    session.answered = false;
    session.viewMode = false;
    // Restore reveal toggle states
    if (d.revState) {
      for (const k of Object.keys(d.revState)) {
        revState[k] = d.revState[k];
        if (_revToggleGroup) _revToggleGroup.setValue(k, d.revState[k]);
      }
    }
    if (d.eqRevState) {
      for (const k of Object.keys(d.eqRevState)) {
        eqRevState[k] = d.eqRevState[k];
        if (_eqRevToggleGroup) _eqRevToggleGroup.setValue(k, d.eqRevState[k]);
      }
    }
    document.getElementById('screen-quiz').classList.remove('viewer-mode');
    document.getElementById('quiz-breadcrumb-stage').textContent = d.lessonLabel;
    document.getElementById('quiz-breadcrumb').style.display = '';
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
  document.getElementById('btn-prev').classList.toggle('show', session.idx > 0);
}

function showLessonQuestion() {
  const q = session.questions[session.idx];
  if (!q) return;
  console.log('[quiz] question', session.idx, q.con.name, q.type, q.mode, 'answerMode:', q.answerMode, 'noBounds:', q.noBounds, 'distLevel:', q.distanceLevel);

  const total = session.questions.length;
  document.getElementById('hud-progress').textContent = `${session.idx + 1} / ${total}`;
  document.getElementById('hud-score').textContent = `${session.correct} correct`;
  document.getElementById('prog-fill').style.width = `${(session.idx / total) * 100}%`;

  if (q.type === 'find') {
    recordSeen(q.con.abbr, questionKey(q));
    startLessonFindQuestion(q);
    return;
  }

  showScreen('quiz');
  settings.mode = q.mode;

  const con = q.con;
  const hist = session.history[session.idx];
  const isAuto = q.answerMode === 'autocomplete';

  document.getElementById('feedback').textContent = '';
  document.getElementById('art-credit').innerHTML = '';
  document.getElementById('reveal-controls').classList.remove('show');
  // Reset reveal toggles to all-on only for unanswered questions
  if (!hist && _revToggleGroup) {
    for (const k of ['photo', 'diagram', 'art', 'boundary']) {
      revState[k] = true;
      _revToggleGroup.setValue(k, true);
    }
  }
  document.getElementById('btn-next').classList.remove('show');

  const canvas = document.getElementById('quiz-canvas');
  const box = document.getElementById('photo-box');
  box.classList.remove('show');
  document.getElementById('photo-img').classList.remove('show');
  canvas.style.display = 'block';
  document.getElementById('canvas-wrap').classList.add('quiz-circle');

  if (hist) {
    session.answered = true;
    session.rotation = hist.rotation;
  } else {
    session.answered = false;
    session.rotation = Math.random() * Math.PI * 2;
    recordSeen(q.con.abbr, questionKey(q));
  }

  const sz = document.getElementById('canvas-wrap').offsetWidth;
  canvas.width = canvas.height = sz * (window.devicePixelRatio || 1);

  if (settings.mode === 'photo') {
    showPhotoMode(con, session.rotation);
  } else {
    renderCanvas(canvas, con, settings.mode, false, session.rotation);
  }

  const grid = document.getElementById('ans-grid');
  const autoArea = document.getElementById('autocomplete-area');
  grid.style.display = isAuto ? 'none' : '';
  autoArea.style.display = isAuto ? '' : 'none';
  if (isAuto) {
    const acInput = document.getElementById('quiz-autocomplete-input');
    acInput.value = hist ? (hist.chosen?.name || '') : '';
    document.getElementById('autocomplete-msg').textContent = '';
    acInput.disabled = !!hist;
    document.getElementById('quiz-autocomplete-submit').style.display = hist ? 'none' : '';
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
      ? `✓ Correct! — ${conLabel(con)}`
      : `✗ That was ${conLabel(con)}`;
    startReveal(con);
    document.getElementById('btn-next').classList.add('show');
  } else if (!isAuto) {
    grid.innerHTML = '';
    const wrongs = getDistractors(con, distractorPool);
    session.choices = [con, ...wrongs].sort(() => Math.random() - .5);
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
  if (session.answered) return;
  session.answered = true;

  session.history[session.idx] = {
    chosen, wasCorrect: chosen === correct,
    rotation: session.rotation, choices: session.choices,
  };

  document.querySelectorAll('.ans-btn').forEach(b => {
    b.disabled = true;
    if (b.textContent === correct.name) b.classList.add('ok');
    else if (b.textContent === chosen.name && chosen !== correct) b.classList.add('err');
  });

  if (chosen === correct) {
    session.correct++;
    document.getElementById('hud-score').textContent = `${session.correct} correct`;
    document.getElementById('feedback').innerHTML = `✓ Correct! — ${conLabel(correct)}`;
    const q = session.questions[session.idx];
    if (q) recordCorrect(q.con.abbr, questionKey(q));
  } else {
    document.getElementById('feedback').innerHTML = `✗ That was ${conLabel(correct)}`;
  }

  startReveal(correct);

  document.getElementById('btn-next').classList.add('show');
  updatePrevBtn();
  saveLessonSession();
}

function handleAutocompleteAnswer() {
  if (session.answered) return;
  const val    = document.getElementById('quiz-autocomplete-input').value.trim();
  const chosen = C.find(c => c.name.toLowerCase() === val.toLowerCase());
  if (!chosen) {
    document.getElementById('autocomplete-msg').textContent = 'Unknown constellation';
    return;
  }
  document.getElementById('autocomplete-msg').textContent = '';
  document.getElementById('quiz-autocomplete-input').disabled = true;
  document.getElementById('quiz-autocomplete-submit').style.display = 'none';
  session.answered = true;
  const q = session.questions[session.idx];
  const correct = q.con;
  const wasCorrect = chosen === correct;
  session.history[session.idx] = { chosen, wasCorrect, rotation: session.rotation, choices: [] };
  if (wasCorrect) {
    session.correct++;
    document.getElementById('hud-score').textContent = `${session.correct} correct`;
    document.getElementById('feedback').innerHTML = `✓ Correct! — ${conLabel(correct)}`;
    if (q) recordCorrect(q.con.abbr, questionKey(q));
  } else {
    document.getElementById('feedback').innerHTML = `✗ That was ${conLabel(correct)}`;
  }
  startReveal(correct);
  document.getElementById('btn-next').classList.add('show');
  updatePrevBtn();
  saveLessonSession();
}

function nextLessonQuestion() {
  session.idx++;
  saveLessonSession();
  if (session.idx >= session.questions.length) endLesson();
  else showLessonQuestion();
}

// ═══════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════
function showScreen(n) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + n).classList.add('active');
}
