// ═══════════════════════════════════════════════════════════
// BOUNDS — IAU constellation boundary polygons
// Loaded from d3-celestial GeoJSON; keyed by IAU abbr.
// Each entry is an ARRAY OF RINGS (arrays of [ra_deg, dec_deg] pairs).
// Most constellations have one ring, but split constellations like Serpens
// (Serpens Caput + Serpens Cauda) appear as two separate GeoJSON features
// with the same id — so we accumulate into an array rather than overwriting.
// All boundary draw and hit-test code must iterate over all rings.
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// PER-CONSTELLATION EXPOSURE TRACKING
// ═══════════════════════════════════════════════════════════

// Storage: { abbr: { "identify/diagram": { seen, correct }, ... } }
function loadExposure() {
  try {
    const raw = JSON.parse(localStorage.getItem('con-exposure')) || {};
    if (!raw._v2) return migrateExposure(raw);
    return raw;
  } catch { return { _v2: true }; }
}
function saveExposure(data) { localStorage.setItem('con-exposure', JSON.stringify(data)); }

// One-time migration: fold old 16-tier keys into new 7-tier keys.
function migrateExposure(old) {
  const foldMap = {
    'identify/diagram-ac': 'identify/diagram',
    'identify/stars-ac':   'identify/stars',
    'identify/photo-ac':   'identify/photo',
    'find/diagram-nb':     'find/diagram',
    'find/stars-nb':       'find/stars',
    'navigate/diagram':    'find/diagram',
    'navigate/stars':      'find/stars',
    'navigate/photo':      'find/photo',
    'navigate/photo-nb':   'find/photo-nb',
  };
  for (const abbr of Object.keys(old)) {
    const e = old[abbr];
    if (!e || typeof e !== 'object') continue;
    for (const [src, dst] of Object.entries(foldMap)) {
      if (!e[src]) continue;
      if (!e[dst]) e[dst] = { seen: 0, correct: 0 };
      e[dst].seen    += e[src].seen    || 0;
      e[dst].correct += e[src].correct || 0;
      delete e[src];
    }
  }
  old._v2 = true;
  saveExposure(old);
  return old;
}

function recordSeen(abbr, key) {
  const data = loadExposure();
  if (!data[abbr]) data[abbr] = {};
  if (!data[abbr][key]) data[abbr][key] = { seen: 0, correct: 0 };
  data[abbr][key].seen++;
  data[abbr][key].lastSeen = Date.now();
  console.log(`[expo] seen ${abbr} ${key} → ${data[abbr][key].seen}`);
  saveExposure(data);
}

function recordCorrect(abbr, key) {
  const data = loadExposure();
  if (!data[abbr]) data[abbr] = {};
  if (!data[abbr][key]) data[abbr][key] = { seen: 0, correct: 0 };
  data[abbr][key].correct++;
  console.log(`[expo] correct ${abbr} ${key} → ${data[abbr][key].correct}`);
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
  saveLessonSession();
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
  const hist = session.history[session.idx];

  if (!hist) {
    if (!q.startP) {
      const t = q.distanceLevel ?? 0; // 0 = nearby, 1 = full navigate-style
      const angle = Math.random() * 2 * Math.PI;

      // Interpolate between nearby and far start
      const nearDist = 60 * (0.3 + Math.random() * 0.5);  // ~18–48°
      const farDist  = 60 + Math.random() * 40;             // 60–100°
      const dist = nearDist + t * (farDist - nearDist);

      const nearFov = Math.min(60 * (1 + Math.random()), FOV_MAX);
      const farFov  = 90;
      const fov = nearFov + t * (farFov - nearFov);

      explore.P = raDecToVec(q.con.ra + Math.cos(angle) * dist,
                             q.con.dec + Math.sin(angle) * dist);
      explore.fov = Math.min(fov, FOV_MAX);
      explore.R = 0;
      q.startP = explore.P.slice();
      q.startFov = explore.fov;
      saveLessonSession();
      console.log(`[find] ${q.con.name} distLevel:${t.toFixed(2)} dist:${dist.toFixed(1)}° fov:${explore.fov.toFixed(1)}° bounds:${!q.noBounds}`);
    } else {
      explore.P = q.startP.slice();
      explore.fov = q.startFov;
      explore.R = 0;
    }
  } else if (hist.exploreState) {
    explore.P = hist.exploreState.P;
    explore.R = hist.exploreState.R;
    explore.fov = hist.exploreState.fov;
  }

  explore.quiz = {
    target: q.con,
    answered: !!hist,
    clicked: hist?.chosen || null,
    stageMode: q.mode,
    bounds: !q.noBounds,
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
  document.getElementById('find-btn-prev').classList.toggle('show', session.idx > 0);
  document.getElementById('explore-quiz-bar').style.display = '';

  if (hist) {
    // Restore answered state
    const fb = document.getElementById('eq-feedback');
    fb.innerHTML = hist.wasCorrect
      ? `✓ Correct! — ${conLabel(q.con)}`
      : `✗ That was ${conLabel(hist.chosen || q.con)}`;
    fb.className = hist.wasCorrect ? 'correct' : 'wrong';
    document.getElementById('eq-label-area').classList.add('answered');
    document.getElementById('eq-next').classList.add('show');
    document.getElementById('eq-reveal-controls').style.display = '';
  } else {
    document.getElementById('eq-feedback').textContent = '';
    document.getElementById('eq-feedback').className = '';
    document.getElementById('eq-label-area').classList.remove('answered');
    document.getElementById('eq-next').classList.remove('show');
    document.getElementById('eq-reveal-controls').style.display = 'none';
    updateFindHelpBtn(q.con);
  }

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
    ['Located by diagram',  'find/diagram'],
    ['Stars identified',    'identify/stars'],
    ['Located by stars',    'find/stars'],
    ['Photo identified',    'identify/photo'],
    ['Located by photo',    'find/photo'],
    ['Master navigator',    'find/photo-nb'],
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
  revState.photo = false;
  if (_revToggleGroup) _revToggleGroup.setValue('photo', false);
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
