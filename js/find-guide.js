// js/find-guide.js
// In-app finding guide — invoked from a find/navigate challenge

let _guidesCache   = null;
let _catalogCache  = null;
let _guideSteps    = null;
let _guideStepIdx    = -1;
let _guideAnimating  = false;
let _guideDiagVisible = true;
let _guideSaved = null;   // saved quiz state while guide is open

// ── Data ────────────────────────────────────────────────────────────────────
function _loadGuides() {
  if (_guidesCache) return Promise.resolve(_guidesCache);
  return Promise.all([
    fetch('js/finding-guides.json').then(r => r.json()),
    fetch('js/sky-objects.json').then(r => r.json()),
  ]).then(([guides, catalog]) => {
    _guidesCache  = guides;
    _catalogCache = catalog;
    return guides;
  });
}

// Pre-fetch in the background so the first tap is instant
_loadGuides().catch(() => {});

// ── Public: show/hide help button based on guide availability ────────────────
function updateFindHelpBtn(con) {
  const btn = document.getElementById('find-help-btn');
  btn.style.display = 'none';
  _loadGuides().then(guides => {
    btn.style.display = (guides[con.name]?.steps?.length) ? '' : 'none';
  }).catch(() => {});
}

// ── Public: open the guide ───────────────────────────────────────────────────
function startFindGuide(con) {
  _loadGuides().then(guides => {
    const guide = guides[con.name];
    if (!guide?.steps?.length) return;

    // Save quiz state
    _guideSaved = {
      quiz: explore.quiz,
      P:    explore.P.slice(),
      fov:  explore.fov,
      R:    explore.R,
    };

    explore.quiz = null;

    document.getElementById('explore-quiz-bar').style.display    = 'none';
    document.getElementById('find-nav-row').style.display        = 'none';
    document.getElementById('find-help-btn').style.display       = 'none';
    document.getElementById('find-guide-overlay').style.display  = '';

    _initGuide(guide, con);
  });
}

// ── Public: close the guide and return to quiz ───────────────────────────────
function exitFindGuide() {
  if (!_guideSaved) return;
  if (explore.animFrame) { cancelAnimationFrame(explore.animFrame); explore.animFrame = null; }

  // Clear annotation canvas
  const ann = document.getElementById('annotation-canvas');
  if (ann) { const c = ann.getContext('2d'); c.clearRect(0, 0, ann.width, ann.height); }

  // Restore quiz state
  explore.quiz = _guideSaved.quiz;
  explore.P    = _guideSaved.P;
  explore.fov  = _guideSaved.fov;
  explore.R    = _guideSaved.R;
  _guideSaved  = null;
  _guideSteps  = null;

  document.getElementById('find-guide-overlay').style.display  = 'none';
  document.getElementById('explore-quiz-bar').style.display    = '';
  document.getElementById('find-nav-row').style.display        = '';

  drawExplore();
}

// ── Drawing ──────────────────────────────────────────────────────────────────
function _fgDraw() {
  explore.quiz = null;
  drawExplore();
}

function _fgDrawAnnotation(step) {
  guideDrawAnnotation(step, _catalogCache);
}

function _fgAnimateTo(step, onDone) {
  guideAnimateTo(step, _fgDraw, _fgDrawAnnotation, onDone, () => !!_guideSaved);
}

// ── UI ───────────────────────────────────────────────────────────────────────
function _fgRenderUI() {
  const steps = _guideSteps;
  const i = _guideStepIdx;
  const n = steps.length;
  document.getElementById('fg-step-dots').innerHTML = steps.map((_, j) =>
    `<div class="fg-dot ${j < i ? 'done' : j === i ? 'active' : ''}"></div>`
  ).join('');
  document.getElementById('fg-step-count').textContent = `${i + 1} / ${n}`;
  document.getElementById('fg-caption-label').textContent = steps[i].title;
  document.getElementById('fg-caption-text').textContent  = steps[i].caption;
  document.getElementById('fg-btn-prev').disabled = i === 0 || _guideAnimating;
  const isLast = i === n - 1;
  const toggleBtn = document.getElementById('fg-btn-toggle-diag');
  toggleBtn.style.display = isLast ? '' : 'none';
  toggleBtn.textContent   = _guideDiagVisible ? 'Hide overlays' : 'Show overlays';
  const nextBtn = document.getElementById('fg-btn-next');
  nextBtn.textContent = isLast ? 'Done ✓' : 'Next →';
  nextBtn.disabled    = _guideAnimating;
}

function _fgApplySettings(step) {
  document.getElementById('chk-ex-photo'     ).checked = !!step.photo;
  document.getElementById('chk-ex-diagram'   ).checked = !!step.diagram;
  document.getElementById('chk-ex-bounds'    ).checked = !!step.bounds;
  document.getElementById('chk-ex-art'       ).checked = !!step.art;
  document.getElementById('chk-ex-starlabels').checked = false;
  document.getElementById('chk-ex-connames'  ).checked = !!step.names;
  document.getElementById('chk-ex-equator'   ).checked = !!step.equator;
}

function _fgGoTo(i, immediate) {
  _guideStepIdx   = i;
  _guideAnimating = !immediate;
  _guideDiagVisible = !!_guideSteps[i].diagram;
  const step = _guideSteps[i];
  _fgApplySettings(step);
  _fgRenderUI();

  if (immediate) {
    explore.P   = raDecToVec(step.ra, step.dec);
    explore.fov = step.fov;
    _fgDraw();
    _fgDrawAnnotation(step);
    _guideAnimating = false;
    _fgRenderUI();
  } else {
    _fgAnimateTo(step, () => {
      _guideAnimating = false;
      _fgRenderUI();
    });
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
let _guideListenersAdded = false;

function _addGuideListeners() {
  if (_guideListenersAdded) return;
  _guideListenersAdded = true;

  document.getElementById('fg-btn-next').addEventListener('click', () => {
    if (_guideAnimating || !_guideSteps) return;
    if (_guideStepIdx === _guideSteps.length - 1) { exitFindGuide(); return; }
    _fgGoTo(_guideStepIdx + 1);
  });

  document.getElementById('fg-btn-prev').addEventListener('click', () => {
    if (_guideAnimating || !_guideSteps || _guideStepIdx === 0) return;
    _fgGoTo(_guideStepIdx - 1);
  });

  document.getElementById('fg-back-btn').addEventListener('click', exitFindGuide);

  document.getElementById('fg-btn-toggle-diag').addEventListener('click', () => {
    if (!_guideSteps) return;
    _guideDiagVisible = !_guideDiagVisible;
    const step = _guideSteps[_guideStepIdx];
    document.getElementById('chk-ex-diagram' ).checked = _guideDiagVisible && !!step.diagram;
    document.getElementById('chk-ex-connames').checked = _guideDiagVisible && !!step.names;
    document.getElementById('chk-ex-bounds'  ).checked = _guideDiagVisible && !!step.bounds;
    document.getElementById('chk-ex-art'     ).checked = _guideDiagVisible && !!step.art;
    _fgDraw();
    _fgDrawAnnotation(_guideDiagVisible ? step : null);
    document.getElementById('fg-btn-toggle-diag').textContent =
      _guideDiagVisible ? 'Hide overlays' : 'Show overlays';
  });
}

function _initGuide(guide, con) {
  _addGuideListeners();

  const steps = guide.steps.map(s => Object.assign({}, s)); // shallow copy to avoid mutating cache
  _guideSteps = steps;

  // Patch "random" step to use the user's current camera position
  const { ra: curRa, dec: curDec } = vecToRaDec(explore.P);
  steps.forEach(s => { if (s.random) { s.ra = curRa; s.dec = curDec; } });

  explore.R = guide.rotation != null
    ? guide.rotation
    : guideNorthUpR(raDecToVec(con.ra, con.dec));

  _fgGoTo(0, true);
}
