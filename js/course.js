// ═══════════════════════════════════════════════════════════
// BOUNDS — IAU constellation boundary polygons
// Loaded from d3-celestial GeoJSON; keyed by IAU abbr.
// Each entry is an ARRAY OF RINGS (arrays of [ra_deg, dec_deg] pairs).
// Most constellations have one ring, but split constellations like Serpens
// (Serpens Caput + Serpens Cauda) appear as two separate GeoJSON features
// with the same id — so we accumulate into an array rather than overwriting.
// All boundary draw and hit-test code must iterate over all rings.
// ═══════════════════════════════════════════════════════════
let BOUNDS = {};

async function loadBounds() {
  try {
    const resp = await fetch('https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/constellations.bounds.json');
    const data = await resp.json();
    for (const feat of data.features) {
      const abbr = feat.id;
      const coords = feat.geometry.coordinates[0];
      // GeoJSON lon = RA stored in [-180, 180]; convert back to [0, 360]
      const ring = coords.map(([lon, lat]) => [lon >= 0 ? lon : lon + 360, lat]);
      // Use push (not assign) so split constellations accumulate both rings
      if (!BOUNDS[abbr]) BOUNDS[abbr] = [];
      BOUNDS[abbr].push(ring);
    }
  } catch (e) {
    console.warn('Could not load constellation boundaries:', e);
  }
}

// ═══════════════════════════════════════════════════════════
// COURSE — 21-stage mastery curriculum
// ═══════════════════════════════════════════════════════════

function stagePool(stage) {
  if (stage.type === 'find') {
    return C.filter(c => BOUNDS[c.abbr] && c.diff <= stage.diff);
  }
  return C.filter(c => c.stars.length > 0 && c.diff <= stage.diff);
}

function loadMastered() {
  try { return JSON.parse(localStorage.getItem('course-mastered')) || []; } catch { return []; }
}
function saveMastered(a) { localStorage.setItem('course-mastered', JSON.stringify(a)); }

function viewConstellation(con) {
  settings.mode = 'diagram';
  document.getElementById('chk-rev-photo').checked = false;
  resetViewerTweak();
  session.pool = [con];
  session.idx = 0;
  session.answered = true;
  session.rotation = 0;
  session.courseStageIdx = null;
  session.viewMode = true;
  const quizScreen = document.getElementById('screen-quiz');
  quizScreen.classList.add('viewer-mode');
  document.getElementById('canvas-wrap').classList.add('quiz-circle');
  document.getElementById('con-select-viewer').value = con.abbr;
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

function isPhaseUnlocked(ph) {
  if (ph === 0) return true;
  const m = loadMastered();
  return STAGES.every((s, i) => s.phase !== ph - 1 || m[i]);
}

function stageModeLabel(stage) {
  if (stage.type === 'find') {
    if (stage.mode === 'photo') return stage.bounds ? 'Photo + Bounds' : 'Photo';
    return stage.mode === 'diagram' ? 'Diagram' : 'Stars Only';
  }
  return { diagram: 'Diagram', stars: 'Stars Only', photo: 'Photo' }[stage.mode] || stage.mode;
}

function renderCourseMap() {
  const map = document.getElementById('course-map');
  map.innerHTML = '';
  const mastered = loadMastered();
  // Group stages by phase
  const phases = [];
  STAGES.forEach((s, i) => {
    if (!phases[s.phase]) phases[s.phase] = [];
    phases[s.phase].push({ s, i });
  });
  phases.forEach((stagesInPhase, ph) => {
    const unlocked = isPhaseUnlocked(ph);
    const allMastered = stagesInPhase.every(({ i }) => mastered[i]);
    const div = document.createElement('div');
    div.className = 'course-phase' + (unlocked ? '' : ' locked');

    const hdr = document.createElement('div');
    hdr.className = 'phase-hdr';
    hdr.innerHTML = `<span>${PHASE_LABELS[ph]}</span><span>${allMastered ? '✓' : unlocked ? '' : '🔒'}</span>`;
    div.appendChild(hdr);

    const row = document.createElement('div');
    row.className = 'phase-stages';
    stagesInPhase.forEach(({ s, i }) => {
      const btn = document.createElement('button');
      btn.className = 'stage-btn' + (mastered[i] ? ' mastered' : '') + (!unlocked ? ' locked' : '');
      btn.textContent = stageModeLabel(s);
      if (mastered[i]) btn.innerHTML += '<span class="stage-check">✓</span>';
      if (unlocked) {
        btn.addEventListener('click', () => navigate('stage/' + i));
      }
      row.appendChild(btn);
    });
    div.appendChild(row);
    map.appendChild(div);
  });
}

function startCourseStage(idx) {
  const stage = STAGES[idx];
  if (stage.type === 'find') { startFindCourseStage(idx); return; }
  session.viewMode = false;
  document.getElementById('screen-quiz').classList.remove('viewer-mode');
  settings.mode = stage.mode;
  session.pool = stagePool(stage).sort(() => Math.random() - 0.5);
  session.idx = 0;
  session.correct = 0;
  session.answered = false;
  session.history = [];
  session.choices = [];
  session.courseStageIdx = idx;
  showScreen('quiz');
  showQuestion();
}

function endCourseStage() {
  const n = session.pool.length, c = session.correct;
  const mastered = (n > 0 && c / n >= 0.8);
  if (mastered) { const a = loadMastered(); a[session.courseStageIdx] = true; saveMastered(a); }
  document.getElementById('res-score').textContent = `${c} / ${n}`;
  document.getElementById('res-grade').textContent = mastered ? '⭐ Mastered!' : 'Not quite — try again';
  document.getElementById('res-stars').textContent = '';
  session.lastMastered = mastered;
  showScreen('result');
  renderResultButtons();
}

function renderResultButtons() {
  const div = document.getElementById('result-btns');
  div.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'btn-again';
  back.textContent = 'Back to Course';
  back.addEventListener('click', () => navigate('course'));
  div.appendChild(back);
  if (!session.lastMastered && session.courseStageIdx != null) {
    const retry = document.createElement('button');
    retry.className = 'btn-settings';
    retry.textContent = 'Try Again';
    retry.addEventListener('click', () => navigate('stage/' + session.courseStageIdx));
    div.appendChild(retry);
  }
}

function startFindCourseStage(idx) {
  const stage = STAGES[idx];
  explore.quiz = {
    pool: stagePool(stage).sort(() => Math.random() - 0.5),
    idx: 0, score: 0, total: 0, target: null, answered: false,
    courseStageIdx: idx,
    stageMode: stage.mode,
    bounds: stage.bounds,
  };
  explore.ra = 180; explore.dec = 30; explore.fov = 90;
  document.getElementById('explore-quiz-bar').style.display = 'flex';
  document.querySelector('.explore-layers').style.display = 'none';
  showScreen('explore');
  nextExploreQuestion();
  drawExplore();
}

function endFindCourseStage() {
  const q = explore.quiz;
  const n = q.total, c = q.score;
  const mastered = (n > 0 && c / n >= 0.8);
  if (mastered) { const a = loadMastered(); a[q.courseStageIdx] = true; saveMastered(a); }
  document.getElementById('res-score').textContent = `${c} / ${n}`;
  document.getElementById('res-grade').textContent = mastered ? '⭐ Mastered!' : 'Not quite — try again';
  document.getElementById('res-stars').textContent = '';
  session.lastMastered = mastered;
  session.courseStageIdx = q.courseStageIdx;
  stopExploreQuiz();
  showScreen('result');
  renderResultButtons();
}
