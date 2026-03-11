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
// MASTERY STORAGE
// ═══════════════════════════════════════════════════════════

function loadMastered() {
  try { return JSON.parse(localStorage.getItem('course-mastered')) || []; } catch { return []; }
}
function saveMastered(a) { localStorage.setItem('course-mastered', JSON.stringify(a)); }

function loadLastPracticed() {
  try { return JSON.parse(localStorage.getItem('last-practiced')) || {}; } catch { return {}; }
}
function saveLastPracticed(idx) {
  const lp = loadLastPracticed(); lp[idx] = Date.now();
  localStorage.setItem('last-practiced', JSON.stringify(lp));
}

// ═══════════════════════════════════════════════════════════
// PER-CONSTELLATION EXPOSURE TRACKING
// ═══════════════════════════════════════════════════════════

// Storage: { abbr: { "identify/diagram": { seen, correct }, ... } }
function loadExposure() {
  try { return JSON.parse(localStorage.getItem('con-exposure')) || {}; } catch { return {}; }
}
function saveExposure(data) { localStorage.setItem('con-exposure', JSON.stringify(data)); }

const UNLOCK_THRESH = 1; // correct answers needed to unlock next mode

function recordSeen(abbr, type, mode) {
  const data = loadExposure();
  const key = type + '/' + mode;
  if (!data[abbr]) data[abbr] = {};
  if (!data[abbr][key]) data[abbr][key] = { seen: 0, correct: 0 };
  data[abbr][key].seen++;
  saveExposure(data);
}

function recordCorrect(abbr, type, mode) {
  const data = loadExposure();
  const key = type + '/' + mode;
  if (!data[abbr]) data[abbr] = {};
  if (!data[abbr][key]) data[abbr][key] = { seen: 0, correct: 0 };
  data[abbr][key].correct++;
  saveExposure(data);
}

// Returns the highest mode/type the user has earned for this constellation,
// downgrading from wantType/wantMode if prerequisites aren't met.
// Prerequisites:
//   identify/stars   ← identify/diagram correct ≥ UNLOCK_THRESH
//   identify/photo   ← identify/stars   correct ≥ UNLOCK_THRESH
//   find/diagram     ← identify/diagram correct ≥ UNLOCK_THRESH
//   find/stars       ← identify/stars   correct ≥ UNLOCK_THRESH
//   find/photo       ← identify/photo   correct ≥ UNLOCK_THRESH
function effectiveQuestion(expData, abbr, wantType, wantMode) {
  const con = expData[abbr] || {};
  const ok = key => (con[key]?.correct ?? 0) >= UNLOCK_THRESH;
  const diagOk  = ok('identify/diagram');
  const starsOk = ok('identify/stars');
  const photoOk = ok('identify/photo');

  if (wantType === 'identify') {
    if (wantMode === 'diagram') return { type: 'identify', mode: 'diagram' };
    if (wantMode === 'stars')   return { type: 'identify', mode: diagOk  ? 'stars'  : 'diagram' };
    if (wantMode === 'photo')   return { type: 'identify', mode: starsOk ? 'photo'  : diagOk ? 'stars' : 'diagram' };
  }
  if (wantType === 'find') {
    if (wantMode === 'diagram') return diagOk  ? { type: 'find',     mode: 'diagram' }
                                               : { type: 'identify', mode: 'diagram' };
    if (wantMode === 'stars')   return starsOk ? { type: 'find',     mode: 'stars'   }
                                : diagOk       ? { type: 'find',     mode: 'diagram' }
                                               : { type: 'identify', mode: 'diagram' };
    if (wantMode === 'photo')   return photoOk ? { type: 'find',     mode: 'photo'   }
                                : starsOk      ? { type: 'find',     mode: 'stars'   }
                                : diagOk       ? { type: 'find',     mode: 'diagram' }
                                               : { type: 'identify', mode: 'diagram' };
  }
  return { type: 'identify', mode: 'diagram' };
}

// ═══════════════════════════════════════════════════════════
// LESSON BUILDER
// ═══════════════════════════════════════════════════════════

function buildLessonQuestions(lessonIdx) {
  const lesson = LESSONS[lessonIdx];
  const totalW = lesson.mix.reduce((s, e) => s + e.w, 0);
  const expData = loadExposure(); // load once for all effectiveQuestion calls
  const questions = [];
  lesson.mix.forEach(spec => {
    const count = Math.round(12 * spec.w / totalW);
    const pool = C.filter(c =>
      c.stars.length > 0 &&
      c.diff <= spec.diff &&
      (spec.type !== 'find' || BOUNDS[c.abbr])
    ).sort(() => Math.random() - 0.5).slice(0, count);
    pool.forEach(con => {
      const eff = effectiveQuestion(expData, con.abbr, spec.type, spec.mode);
      questions.push({
        con, type: eff.type, mode: eff.mode,
        ...(eff.type === 'find' && spec.r ? { searchRadius: spec.r } : {})
      });
    });
  });
  // pad/trim to exactly 12
  while (questions.length < 12 && questions.length > 0)
    questions.push({ ...questions[Math.floor(Math.random() * questions.length)] });
  questions.splice(12);

  // Shuffle randomly
  questions.sort(() => Math.random() - 0.5);

  // For any constellation appearing more than once, ensure easier modes come first
  // (diagram < stars < photo; identify before find)
  const modeRank = { diagram: 0, stars: 1, photo: 2 };
  const rank = q => (q.type === 'find' ? 10 : 0) + (modeRank[q.mode] ?? 0);
  const byAbbr = new Map();
  questions.forEach((q, i) => {
    if (!byAbbr.has(q.con.abbr)) byAbbr.set(q.con.abbr, []);
    byAbbr.get(q.con.abbr).push(i);
  });
  byAbbr.forEach(indices => {
    if (indices.length < 2) return;
    indices.sort((a, b) => a - b); // earliest positions first
    const sorted = indices.map(i => questions[i]).sort((a, b) => rank(a) - rank(b));
    indices.forEach((pos, j) => { questions[pos] = sorted[j]; });
  });

  return questions;
}

// ═══════════════════════════════════════════════════════════
// LESSON PROGRESSION
// ═══════════════════════════════════════════════════════════

function isLessonUnlocked(idx) {
  if (idx === 0) return true;
  return !!loadMastered()[idx - 1];
}

function suggestNextLesson() {
  const m = loadMastered();
  for (let i = 0; i < LESSONS.length; i++)
    if (!m[i] && isLessonUnlocked(i)) return i;
  // all mastered → least recently practiced
  const lp = loadLastPracticed();
  let best = 0, oldest = Infinity;
  LESSONS.forEach((_, i) => { if ((lp[i] || 0) < oldest) { oldest = lp[i] || 0; best = i; } });
  return best;
}

// ═══════════════════════════════════════════════════════════
// LESSON FLOW
// ═══════════════════════════════════════════════════════════

function startLesson(idx) {
  session.questions = buildLessonQuestions(idx);
  session.idx = 0; session.correct = 0; session.answered = false;
  session.history = []; session.lessonIdx = idx;
  session.viewMode = false;
  document.getElementById('screen-quiz').classList.remove('viewer-mode');
  document.getElementById('quiz-breadcrumb-stage').textContent = `${idx + 1}: ${LESSONS[idx].label}`;
  document.getElementById('quiz-breadcrumb').style.display = '';
  showLessonQuestion();
}

function endLesson() {
  saveLastPracticed(session.lessonIdx);
  stopExploreQuiz();
  sessionStorage.removeItem('lesson-session');
  document.getElementById('quiz-breadcrumb').style.display = 'none';
  const n = session.questions.length, c = session.correct;
  const mastered = n > 0 && c / n >= 0.8;
  if (mastered) { const a = loadMastered(); a[session.lessonIdx] = true; saveMastered(a); }
  const pct = n > 0 ? c / n : 0;
  document.getElementById('screen-result').querySelector('.result-wrap')
    .classList.toggle('mastered', mastered);
  document.getElementById('res-score').textContent = `${c} / ${n}`;
  document.getElementById('res-grade').textContent =
    mastered ? `${LESSONS[session.lessonIdx].label} — Complete!` :
    pct >= 0.5 ? 'Almost there!' : 'Keep going!';
  document.getElementById('res-stars').textContent =
    mastered ? '★★★' : pct >= 0.5 ? '★★' : '★';
  session.lastMastered = mastered;
  showScreen('result');
  renderResultButtons();
}

function renderResultButtons() {
  const div = document.getElementById('result-btns'); div.innerHTML = '';
  const next = document.createElement('button');
  next.className = 'btn-again';
  next.textContent = session.lastMastered ? 'Next Lesson ›' : 'Try Again';
  next.addEventListener('click', () =>
    session.lastMastered
      ? navigate('lesson/' + suggestNextLesson())
      : navigate('lesson/' + session.lessonIdx));
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
  const radius = q.searchRadius || 60;
  const jitter = radius * 0.4;
  explore.P = raDecToVec(
    q.con.ra  + (Math.random() - 0.5) * jitter * 2,
    q.con.dec + (Math.random() - 0.5) * jitter * 2
  );
  explore.fov = Math.min(radius * 1.5, 120);
  explore.R = 0;
  explore.quiz = {
    target: q.con,
    answered: false,
    clicked: null,
    stageMode: q.mode,
    bounds: true,
    lessonMode: true,
    score: 0, total: 0,
    onNext: () => nextLessonQuestion()
  };
  document.getElementById('explore-free-hdr').style.display = 'none';
  document.querySelector('.explore-layers').style.display = 'none';
  document.getElementById('breadcrumb-stage').textContent = `${session.lessonIdx + 1}: ${LESSONS[session.lessonIdx].label}`;
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
  showScreen('explore');
  drawExplore();
}

// ═══════════════════════════════════════════════════════════
// COURSE MAP
// ═══════════════════════════════════════════════════════════

function renderCourseMap() {
  const mastered = loadMastered();
  const masteredCount = mastered.filter(Boolean).length;
  const total = LESSONS.length;
  document.getElementById('btn-continue').textContent =
    masteredCount > 0 ? 'Continue ›' : 'Start Learning ›';
  document.getElementById('course-progress-bar').style.width =
    `${(masteredCount / total) * 100}%`;
  document.getElementById('course-progress-label').textContent =
    `${masteredCount} / ${total} lessons mastered`;
  const map = document.getElementById('course-map');
  map.innerHTML = '';
  LESSONS.forEach((lesson, i) => {
    const unlocked = isLessonUnlocked(i);
    const btn = document.createElement('button');
    btn.className = 'stage-btn' + (mastered[i] ? ' mastered' : '') + (!unlocked ? ' locked' : '');
    btn.textContent = `${i + 1}. ${lesson.label}` + (mastered[i] ? ' ✓' : '');
    if (unlocked) btn.addEventListener('click', () => navigate('lesson/' + i));
    map.appendChild(btn);
  });
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
