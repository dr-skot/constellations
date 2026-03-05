// ═══════════════════════════════════════════════════════════
// QUIZ STATE
// ═══════════════════════════════════════════════════════════
let settings = { mode: 'diagram', diff: '1', hem: 'B' };
let session = { pool: [], idx: 0, correct: 0, answered: false, history: [], choices: [], viewMode: false };
let viewerTweak = { scale: 1, dx: 0, dy: 0 };

function tweakedCon(con) {
  const { scale, dx, dy } = viewerTweak;
  const newFov = 2 * Math.atan(Math.tan(con.fov * Math.PI / 360) / scale) * 180 / Math.PI;
  return { ...con, ra: ((con.ra + dx) % 360 + 360) % 360, dec: con.dec + dy, fov: newFov };
}

function resetViewerTweak() {
  viewerTweak = { scale: 1, dx: 0, dy: 0 };
  document.getElementById('tweak-scale').value = 100;
  document.getElementById('tweak-dx').value = 0;
  document.getElementById('tweak-dy').value = 0;
  document.getElementById('tweak-scale-val').textContent = '1.00×';
  document.getElementById('tweak-dx-val').textContent = '0.0°';
  document.getElementById('tweak-dy-val').textContent = '0.0°';
}
let debugLabels = false;
let debugAnchors = false;

function saveQuizSession() {
  if (session.courseStageIdx == null) return;
  sessionStorage.setItem('quiz-session', JSON.stringify({
    stageIdx: session.courseStageIdx,
    pool: session.pool.map(c => c.abbr),
    idx: session.idx,
    correct: session.correct,
    history: session.history
  }));
}

function tryResumeStage(idx) {
  try {
    const d = JSON.parse(sessionStorage.getItem('quiz-session'));
    if (!d || d.stageIdx !== idx) return false;
    const pool = d.pool.map(abbr => C.find(c => c.abbr === abbr)).filter(Boolean);
    if (pool.length !== d.pool.length) return false;
    session.pool = pool; session.idx = d.idx; session.correct = d.correct;
    session.history = d.history || []; session.courseStageIdx = idx;
    session.answered = false;
    session.viewMode = false;
    document.getElementById('screen-quiz').classList.remove('viewer-mode');
    showScreen('quiz'); showQuestion(); return true;
  } catch { return false; }
}

function getDistractors(correct, pool) {
  const others = pool.filter(c => c !== correct).sort(() => Math.random() - .5);
  const same = others.filter(c => c.diff === correct.diff);
  const rest = others.filter(c => c.diff !== correct.diff);
  return [...same, ...rest].slice(0, 3);
}

function updatePrevBtn() {
  const canGoPrev = session.idx > 0 && session.history[session.idx - 1];
  document.getElementById('btn-prev').classList.toggle('show', !!canGoPrev);
}

function showQuestion() {
  const con = session.pool[session.idx];
  const hist = session.history[session.idx];

  const total = session.pool.length;
  document.getElementById('hud-progress').textContent = `${session.idx + 1} / ${total}`;
  document.getElementById('hud-score').textContent = `${session.correct} correct`;
  document.getElementById('prog-fill').style.width = `${(session.idx / total) * 100}%`;

  document.getElementById('feedback').textContent = '';
  document.getElementById('reveal-controls').classList.remove('show');
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
  }

  const sz = document.getElementById('canvas-wrap').offsetWidth;
  canvas.width = canvas.height = sz * (window.devicePixelRatio || 1);

  if (settings.mode === 'photo') {
    showPhotoMode(con, session.rotation);
  } else {
    renderCanvas(canvas, con, settings.mode, false, session.rotation);
  }

  const grid = document.getElementById('ans-grid');
  grid.innerHTML = '';
  if (hist) {
    // Replay previously answered state
    hist.choices.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'ans-btn';
      btn.textContent = c.name;
      btn.disabled = true;
      if (c === con) btn.classList.add('ok');
      else if (c === hist.chosen && hist.chosen !== con) btn.classList.add('err');
      grid.appendChild(btn);
    });
    document.getElementById('feedback').innerHTML = hist.wasCorrect
      ? `✓ Correct! — ${conLabel(con)}`
      : `✗ That was ${conLabel(con)}`;
    startReveal(con);
    document.getElementById('btn-next').classList.add('show');
  } else {
    const wrongs = getDistractors(con, session.pool);
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
  } else {
    document.getElementById('feedback').innerHTML = `✗ That was ${conLabel(correct)}`;
  }

  startReveal(correct);

  document.getElementById('btn-next').classList.add('show');
  updatePrevBtn();
}

function nextQuestion() {
  session.idx++;
  saveQuizSession();
  if (session.idx >= session.pool.length) {
    if (session.courseStageIdx != null) endCourseStage();
    else showResults();
  } else {
    showQuestion();
  }
}

function showResults(total = session.pool.length) {
  const pct = total > 0 ? session.correct / total : 0;
  document.getElementById('res-score').textContent = `${session.correct} / ${total}`;
  let grade, stars;
  if (pct >= .9) { grade = 'Astronomer'; stars = '★★★'; }
  else if (pct >= .7) { grade = 'Sky Watcher'; stars = '★★☆'; }
  else if (pct >= .5) { grade = 'Stargazer'; stars = '★☆☆'; }
  else { grade = 'Keep Practicing'; stars = '☆☆☆'; }
  document.getElementById('res-grade').textContent = grade;
  document.getElementById('res-stars').textContent = stars;
  session.lastMastered = false;
  showScreen('result');
  renderResultButtons();
}

// ═══════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════
function showScreen(n) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + n).classList.add('active');
}
