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
    lessonLabel: session.lessonLabel,
    questions: session.questions.map(q => ({
      abbr: q.con.abbr, type: q.type, mode: q.mode,
      answerMode: q.answerMode,
      ...(q.searchRadius ? { searchRadius: q.searchRadius } : {}),
      ...(q.navigate    ? { navigate: true } : {}),
      ...(q.noBounds    ? { noBounds: true } : {})
    })),
    idx: session.idx,
    correct: session.correct,
    history: session.history
  }));
}

function tryResumeLesson() {
  try {
    const d = JSON.parse(sessionStorage.getItem('lesson-session'));
    if (!d || !d.lessonLabel) return false;
    const questions = d.questions.map(q => {
      const con = C.find(c => c.abbr === q.abbr);
      if (!con) return null;
      return { con, type: q.type, mode: q.mode,
               answerMode: q.answerMode,
               ...(q.searchRadius ? { searchRadius: q.searchRadius } : {}),
               ...(q.navigate    ? { navigate: true } : {}),
               ...(q.noBounds    ? { noBounds: true } : {}) };
    }).filter(Boolean);
    if (questions.length !== d.questions.length) return false;
    session.questions = questions;
    session.idx = d.idx;
    session.correct = d.correct;
    session.history = d.history || [];
    session.lessonIdx = 0;
    session.lessonLabel = d.lessonLabel;
    session.answered = false;
    session.viewMode = false;
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
  document.getElementById('lbl-rev-photo').style.display = 'none';
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

  // Use full constellation list as distractor pool for better variety
  const distractorPool = C.filter(c => c.stars.length > 0);

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
