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

// True when an exposure record holds no real progress — only the `_v2` version
// marker (or nothing). Lives here, beside loadExposure, so the storage shape's one
// private key stays owned by one module. Drives the calibration first-run offer (#34).
function exposureIsEmpty(exposure) {
  return Object.keys(exposure).filter(k => k !== '_v2').length === 0;
}

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

// Thin impure adapter over the pure planLesson (js/lesson.js): supplies the live
// exposure, the constellation catalog, the boundary table, real randomness, the
// wall clock, and the console sink for the scheduler's debug dumps.
function generateNextLesson() {
  return planLesson(loadExposure(), C, BOUNDS, Math.random, Date.now(), console);
}

// Exposure snapshot taken at lesson start, diffed on the result screen to emphasize the
// tiers this lesson newly passed. A module var, so a page reload clears it — the result
// screen then falls back to plain current state (no emphasis).
let _exposureAtLessonStart = null;

function startLesson() {
  _exposureAtLessonStart = loadExposure();
  const { label, questions } = generateNextLesson();
  session.questions = questions;
  session.idx = 0; session.correct = 0; session.answered = false;
  session.history = []; session.lessonIdx = 0;
  session.lessonLabel = label;
  session.calibration = false;
  document.getElementById('identify-breadcrumb-stage').textContent = label;
  document.getElementById('identify-breadcrumb').style.display = '';
  saveLessonSession();
  showLessonQuestion();
}

function endLesson() {
  stopExploreQuiz();
  sessionStorage.removeItem('lesson-session');
  document.getElementById('identify-breadcrumb').style.display = 'none';
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
  renderResultProgress();
  // The result screen has its own hash, so the address bar stops describing the
  // lesson that just ended. It is a transient route: a reload lands on the course
  // home rather than resolving #lesson, failing to resume, and silently starting a
  // fresh lesson over the score. It REPLACES that spent #lesson entry for the same
  // reason — otherwise the bug is still one Back away.
  navigate('result', { replace: true });
  renderResultButtons();
}

// The constellations practiced this lesson, drawn as shared progress cards. Tiers this
// lesson newly passed (diffing the lesson-start snapshot against now) get the .just-passed
// emphasis; with no snapshot (e.g. resumed after a reload) nothing is emphasized. The full
// grid lives on the course screen, one "Back to Course" away, so no link is needed here.
function renderResultProgress() {
  const host = document.getElementById('result-progress');
  host.innerHTML = '';
  const practiced = distinctCons(session.questions);
  if (!practiced.length) { host.style.display = 'none'; return; }
  host.style.display = '';

  const label = document.createElement('div');
  label.className = 'result-progress-label';
  label.textContent = 'Practiced this lesson';
  host.appendChild(label);

  const exp = loadExposure();
  const highlight = newlyPassed(_exposureAtLessonStart, exp, practiced);
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const con of practiced) {
    const card = progressCard(con, exp, { highlight });
    card.addEventListener('click', e => { e.stopPropagation(); showCourseDetail(con, card); });
    grid.appendChild(card);
  }
  host.appendChild(grid);
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
      applyView(explore, { P: q.startP, R: 0, fov: q.startFov });
    }
  } else if (hist.exploreState) {
    applyView(explore, hist.exploreState);
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
  requestExploreDraw();
}

// ═══════════════════════════════════════════════════════════
// COURSE MAP
// ═══════════════════════════════════════════════════════════

function renderCourseMap() {
  const exp = loadExposure(), total = C.length;
  const seen = C.filter(c => (exp[c.abbr]?.['identify/diagram']?.seen||0) > 0).length;
  document.getElementById('btn-continue').textContent = seen > 0 ? 'Continue ›' : 'Start Learning ›';
  document.getElementById('course-progress-bar').style.width = `${(seen/total)*100}%`;
  document.getElementById('course-progress-label').textContent = `${seen} / ${total} constellations introduced`;

  // The full progress grid: every constellation as a shared progress card, grouped into
  // difficulty bands. Tapping a card opens the detail panel with its per-tier counts.
  // Shared renderer (progress-grid.js) — the calibration payoff draws the same grid.
  renderProgressGrid(document.getElementById('course-map'), C, exp, {
    onCardClick: (con, card) => showCourseDetail(con, card),
  });
}

// Card detail: a popover anchored at the tapped card showing per-tier seen/correct
// counts for one constellation, led by a tiny figure + its name (issue #22). It
// opens below the card and flips above near the viewport bottom (placement geometry
// is popoverPosition in render.js). Re-tapping the active card, the ✕, Escape, a
// click away, or scrolling/resizing closes it (all wired once in initCourseDetail).
let _activeCourseCard = null;
let _coursePopover = null;

// A tiny north-up stick figure of `con`, bounding-box-fit into `size` px. Reuses the
// app's projectStarsTAN, so the glyph is oriented (north up) like the identify diagram.
// Draws the default catalog figure (con.stars/con.lines); honoring the selected
// diagram source (Rey/Stellarium/Ford) for the glyph is out of scope here (issue #22).
// Shared widget: used by the course detail popover and the constellation info modal.
function conGlyph(con, size) {
  const dpr = window.devicePixelRatio || 1;
  const cv = document.createElement('canvas');
  cv.className = 'con-glyph';
  cv.width = size * dpr; cv.height = size * dpr;
  cv.style.width = size + 'px'; cv.style.height = size + 'px';
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const pts = projectStarsTAN(con.stars, con, 100, 100);
  const vis = pts.filter(p => p.facing > 0);
  if (!vis.length) return cv;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of vis) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                         minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const pad = 5, w = Math.max(maxX - minX, 1e-3), h = Math.max(maxY - minY, 1e-3);
  const s = Math.min((size - 2 * pad) / w, (size - 2 * pad) / h);
  const ox = (size - w * s) / 2 - minX * s, oy = (size - h * s) / 2 - minY * s;
  const X = p => p.x * s + ox, Y = p => p.y * s + oy;
  ctx.strokeStyle = 'rgba(180,200,255,.45)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [a, b] of con.lines) {
    const pa = pts[a], pb = pts[b];
    if (!pa || !pb || pa.facing <= 0 || pb.facing <= 0) continue;
    ctx.moveTo(X(pa), Y(pa)); ctx.lineTo(X(pb), Y(pb));
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(232,240,255,.9)';
  for (const p of vis) {
    const r = Math.max(.6, 1.6 - (p.mag || 3) * 0.18);
    ctx.beginPath(); ctx.arc(X(p), Y(p), r, 0, Math.PI * 2); ctx.fill();
  }
  return cv;
}

function positionCoursePopover(pop, card) {
  const r = card.getBoundingClientRect();
  const pos = popoverPosition(
    { left: r.left, top: r.top, width: r.width, height: r.height, vBottom: r.bottom },
    { width: pop.offsetWidth, height: pop.offsetHeight },
    { containerWidth: window.innerWidth, viewportHeight: window.innerHeight });
  pop.style.left = pos.left + 'px';
  pop.style.top = pos.top + 'px';
  pop.style.setProperty('--arrow', pos.arrow + 'px');
  pop.classList.toggle('above', pos.above);
}

function showCourseDetail(con, card) {
  const reopen = _activeCourseCard === card;
  closeCourseDetail();
  if (reopen) return;                       // re-tap toggles closed
  _activeCourseCard = card;
  card.classList.add('active');
  const exp = loadExposure();
  const rows = TIERS.map(t => {
    const cls = tierClass(exp, con.abbr, t.key);
    const d = exp[con.abbr]?.[t.key];
    return `<div class="cdp-row ${cls}"><span class="cdp-dot"></span>` +
      `<span class="cdp-name">${t.label}</span>` +
      `<span class="cdp-counts">${d?.seen || 0} seen · ${d?.correct || 0} correct</span></div>`;
  }).join('');
  const pop = document.createElement('div');
  pop.className = 'course-popover';
  pop.innerHTML = `<div class="cdp-head"><span class="cdp-title">${con.name}</span>` +
    `<button class="cdp-close" aria-label="Close">✕</button></div>` +
    `<div class="cdp-tiers">${rows}</div>`;
  pop.querySelector('.cdp-head').insertBefore(conGlyph(con, 34), pop.querySelector('.cdp-title'));
  pop.querySelector('.cdp-close').addEventListener('click', e => { e.stopPropagation(); closeCourseDetail(); });
  pop.addEventListener('click', e => e.stopPropagation());   // clicks inside don't dismiss
  document.body.appendChild(pop);
  positionCoursePopover(pop, card);         // measure after append, then place
  _coursePopover = pop;
}

function closeCourseDetail() {
  if (_activeCourseCard) _activeCourseCard.classList.remove('active');
  _activeCourseCard = null;
  if (_coursePopover) { _coursePopover.remove(); _coursePopover = null; }
}

function initCourseDetail() {
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCourseDetail(); });
  document.addEventListener('click', closeCourseDetail);     // click away
  // Capture-phase catches scrolls from any scroll container (the course map or the
  // result-screen grid), so the anchored popover dismisses wherever it was opened.
  document.addEventListener('scroll', closeCourseDetail, true);
  window.addEventListener('resize', closeCourseDetail);
}

// The constellation viewer lives in js/viewer.js now, on a screen of its own. What
// used to be here wrote a pre-answered one-question lesson session so that it could
// borrow the identify screen and its reveal (issue #73).
