// js/find-guide.js
// In-app finding guide — invoked from a find/navigate challenge

let _guidesCache  = null;
let _catalogCache = null;
let _guideSaved   = null;   // saved quiz state while guide is open

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

    _guideSaved = { quiz: explore.quiz, P: explore.P.slice(), fov: explore.fov, R: explore.R };
    explore.quiz = null;

    document.getElementById('explore-quiz-bar').style.display    = 'none';
    document.getElementById('find-nav-row').style.display        = 'none';
    document.getElementById('find-help-btn').style.display       = 'none';
    document.getElementById('find-guide-overlay').style.display  = '';

    const steps = guide.steps.map(s => Object.assign({}, s));
    const { ra: curRa, dec: curDec } = vecToRaDec(explore.P);
    steps.forEach(s => { if (s.random) { s.ra = curRa; s.dec = curDec; } });
    const defaultR = guideNorthUpR(raDecToVec(con.ra, con.dec));
    explore.R = guide.rotation != null ? defaultR + guide.rotation : defaultR;

    guideStart(steps, _catalogCache, { onLastNext: exitFindGuide });
  });
}

// ── Public: close the guide and return to quiz ───────────────────────────────
function exitFindGuide() {
  if (!_guideSaved) return;
  guideStop();

  explore.quiz = _guideSaved.quiz;
  explore.P    = _guideSaved.P;
  explore.fov  = _guideSaved.fov;
  explore.R    = _guideSaved.R;
  _guideSaved  = null;

  document.getElementById('find-guide-overlay').style.display  = 'none';
  document.getElementById('explore-quiz-bar').style.display    = '';
  document.getElementById('find-nav-row').style.display        = '';

  drawExplore();
}
