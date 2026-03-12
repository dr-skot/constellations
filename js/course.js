// ═══════════════════════════════════════════════════════════
// BOUNDS — IAU constellation boundary polygons
// Loaded from d3-celestial GeoJSON; keyed by IAU abbr.
// Each entry is an ARRAY OF RINGS (arrays of [ra_deg, dec_deg] pairs).
// Most constellations have one ring, but split constellations like Serpens
// (Serpens Caput + Serpens Cauda) appear as two separate GeoJSON features
// with the same id — so we accumulate into an array rather than overwriting.
// All boundary draw and hit-test code must iterate over all rings.
// ═══════════════════════════════════════════════════════════
function loadBounds() {} // BOUNDS is now inlined in data.js

// ═══════════════════════════════════════════════════════════
// PER-CONSTELLATION EXPOSURE TRACKING
// ═══════════════════════════════════════════════════════════

// Storage: { abbr: { "identify/diagram": { seen, correct }, ... } }
function loadExposure() {
  try { return JSON.parse(localStorage.getItem('con-exposure')) || {}; } catch { return {}; }
}
function saveExposure(data) { localStorage.setItem('con-exposure', JSON.stringify(data)); }

function recordSeen(abbr, key) {
  const data = loadExposure();
  if (!data[abbr]) data[abbr] = {};
  if (!data[abbr][key]) data[abbr][key] = { seen: 0, correct: 0 };
  data[abbr][key].seen++;
  saveExposure(data);
}

function recordCorrect(abbr, key) {
  const data = loadExposure();
  if (!data[abbr]) data[abbr] = {};
  if (!data[abbr][key]) data[abbr][key] = { seen: 0, correct: 0 };
  data[abbr][key].correct++;
  saveExposure(data);
}

// ═══════════════════════════════════════════════════════════
// LESSON FLOW
// ═══════════════════════════════════════════════════════════

function startLesson() {
  const { label, questions } = generateNextLesson();
  session.questions = questions;
  session.idx = 0; session.correct = 0; session.answered = false;
  session.history = []; session.lessonIdx = 0;
  session.lessonLabel = label;
  session.viewMode = false;
  document.getElementById('screen-quiz').classList.remove('viewer-mode');
  document.getElementById('quiz-breadcrumb-stage').textContent = label;
  document.getElementById('quiz-breadcrumb').style.display = '';
  showLessonQuestion();
}

function endLesson() {
  stopExploreQuiz();
  sessionStorage.removeItem('lesson-session');
  document.getElementById('quiz-breadcrumb').style.display = 'none';
  const n = session.questions.length, c = session.correct;
  const pct = n > 0 ? c / n : 0;
  const good = pct >= 0.8;
  document.getElementById('screen-result').querySelector('.result-wrap')
    .classList.toggle('mastered', good);
  document.getElementById('res-score').textContent = `${c} / ${n}`;
  document.getElementById('res-grade').textContent =
    good ? `${session.lessonLabel} — Well done!` :
    pct >= 0.5 ? 'Almost there!' : 'Keep going!';
  document.getElementById('res-stars').textContent =
    good ? '★★★' : pct >= 0.5 ? '★★' : '★';
  const cnt = parseInt(localStorage.getItem('lesson-count') || '0') + 1;
  localStorage.setItem('lesson-count', cnt);
  showScreen('result');
  renderResultButtons();
}

function renderResultButtons() {
  const div = document.getElementById('result-btns'); div.innerHTML = '';
  const next = document.createElement('button');
  next.className = 'btn-again';
  next.textContent = 'Next Lesson ›';
  next.addEventListener('click', () => navigate('lesson'));
  div.appendChild(next);
  const back = document.createElement('button');
  back.className = 'btn-settings';
  back.textContent = 'Back to Course';
  back.addEventListener('click', () => navigate('course'));
  div.appendChild(back);
}

// ═══════════════════════════════════════════════════════════
// FIND QUESTION (lesson mode)
// ═══════════════════════════════════════════════════════════

function startLessonFindQuestion(q) {
  if (q.navigate) {
    const angle = Math.random() * 2 * Math.PI;
    const dist  = 60 + Math.random() * 40;
    explore.P = raDecToVec(q.con.ra + Math.cos(angle) * dist,
                           q.con.dec + Math.sin(angle) * dist);
    explore.fov = 90;
  } else {
    const angle  = Math.random() * 2 * Math.PI;
    const dist   = (q.searchRadius || 60) * (0.3 + Math.random() * 0.5);
    const fovMul = 1.0 + Math.random() * 1.0;
    explore.P = raDecToVec(q.con.ra  + Math.cos(angle) * dist,
                           q.con.dec + Math.sin(angle) * dist);
    explore.fov = Math.min((q.searchRadius || 60) * fovMul, 120);
  }
  explore.R = 0;
  explore.quiz = {
    target: q.con,
    answered: false,
    clicked: null,
    stageMode: q.mode,
    bounds: !q.noBounds,
    navigate: !!q.navigate,
    noBounds: !!q.noBounds,
    lessonMode: true,
    score: 0, total: 0,
    onNext: () => nextLessonQuestion()
  };
  document.getElementById('explore-free-hdr').style.display = 'none';
  document.querySelector('.explore-layers').style.display = 'none';
  document.getElementById('breadcrumb-stage').textContent = session.lessonLabel;
  document.getElementById('find-quiz-hdr').style.display = '';
  document.getElementById('find-nav-row').style.display = '';
  const total = session.questions.length;
  document.getElementById('find-hud-progress').textContent = `${session.idx + 1} / ${total}`;
  document.getElementById('find-hud-score').textContent = `${session.correct} correct`;
  document.getElementById('find-prog-fill').style.width = `${(session.idx / total) * 100}%`;
  document.getElementById('eq-target-name').textContent = q.con.name;
  document.getElementById('eq-feedback').textContent = '';
  document.getElementById('eq-feedback').className = '';
  document.getElementById('eq-label-area').classList.remove('answered');
  document.getElementById('eq-next').classList.remove('show');
  document.getElementById('find-btn-prev').classList.toggle('show', session.idx > 0);
  document.getElementById('explore-quiz-bar').style.display = '';
  document.getElementById('eq-reveal-controls').style.display = 'none';
  showScreen('explore');
  drawExplore();
}

// ═══════════════════════════════════════════════════════════
// COURSE MAP
// ═══════════════════════════════════════════════════════════

function renderCourseMap() {
  const exp = loadExposure(), total = C.length;
  const count = key => C.filter(c => (exp[c.abbr]?.[key]?.correct||0) >= 1).length;
  const seen = C.filter(c => (exp[c.abbr]?.['identify/diagram']?.seen||0) > 0).length;
  document.getElementById('btn-continue').textContent = seen > 0 ? 'Continue ›' : 'Start Learning ›';
  document.getElementById('course-progress-bar').style.width = `${(seen/total)*100}%`;
  document.getElementById('course-progress-label').textContent = `${seen} / ${total} constellations introduced`;
  document.getElementById('course-map').innerHTML = [
    ['Diagram identified',  'identify/diagram'],
    ['Photo identified',    'identify/photo'],
    ['Located in sky',      'find/diagram'],
    ['Name recalled',       'identify/photo-ac'],
    ['Ultimate challenge',  'navigate/photo-nb'],
  ].map(([label, key]) =>
    `<div class="stat-row"><span class="stat-label">${label}</span>` +
    `<span class="stat-val">${count(key)} / ${total}</span></div>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════
// CONSTELLATION VIEWER
// ═══════════════════════════════════════════════════════════

function viewConstellation(con) {
  settings.mode = 'diagram';
  document.getElementById('chk-rev-photo').checked = false;
  session.questions = [{ con, type: 'identify', mode: 'diagram' }];
  session.idx = 0;
  session.answered = true;
  session.rotation = 0;
  session.lessonIdx = null;
  session.viewMode = true;
  document.getElementById('quiz-breadcrumb-stage').textContent = con.name;
  document.getElementById('quiz-breadcrumb').style.display = '';
  const quizScreen = document.getElementById('screen-quiz');
  quizScreen.classList.add('viewer-mode');
  document.getElementById('canvas-wrap').classList.add('quiz-circle');
  document.getElementById('con-select-viewer-input').value = con.name;
  document.getElementById('feedback').innerHTML = conLabel(con);
  showScreen('quiz');
  const canvas = document.getElementById('quiz-canvas');
  const sz = document.getElementById('canvas-wrap').offsetWidth;
  canvas.width = canvas.height = sz * (window.devicePixelRatio || 1);
  canvas.style.display = 'block';
  document.getElementById('photo-box').classList.remove('show');
  document.getElementById('photo-img').classList.remove('show');
  startReveal(con);
}
