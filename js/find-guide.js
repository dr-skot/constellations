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
    btn.style.display = (guides[con.name]?.steps?.length) ? 'block' : 'none';
  }).catch(() => {});
}

// ── Public: open the guide ───────────────────────────────────────────────────
function startFindGuide(con) {
  _loadGuides().then(guides => {
    const guide = guides[con.name];
    if (!guide?.steps?.length) return;

    const quizBar = document.getElementById('explore-quiz-bar');
    const navRow  = document.getElementById('find-nav-row');
    // Capture the bars' prior visibility so exit restores exactly what was showing
    // — the guide can be launched from a find quiz (bars visible) or from the info
    // modal's "Finding guide" link in free explore (bars hidden). See issue #4.
    _guideSaved = { quiz: explore.quiz, quizBarDisplay: quizBar.style.display, navRowDisplay: navRow.style.display, ...snapshotView(explore) };
    explore.quiz = null;

    quizBar.style.display = 'none';
    navRow.style.display  = 'none';
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
  applyView(explore, _guideSaved);
  const { quizBarDisplay, navRowDisplay } = _guideSaved;
  _guideSaved  = null;

  document.getElementById('find-guide-overlay').style.display  = 'none';
  document.getElementById('explore-quiz-bar').style.display    = quizBarDisplay;
  document.getElementById('find-nav-row').style.display        = navRowDisplay;

  drawExplore();
}
