// ═══════════════════════════════════════════════════════════
// DIAGRAM-SOURCE (FIGURES)
// ═══════════════════════════════════════════════════════════
// The Figures picker lives on the Settings screen (js/settings.js). This is the
// one place that switches the shared, persisted diagramSource and redraws every
// surface that draws a figure.
function applyDiagramSource(key) {
  setDiagramSource(key);
  if (_settingsGroup) _settingsGroup.setValue(key, true);
  if (typeof requestExploreDraw === 'function') requestExploreDraw();
  if (typeof redrawQuizFigure === 'function') redrawQuizFigure();
  if (typeof redrawSettingsFigure === 'function') redrawSettingsFigure();
}

// ═══════════════════════════════════════════════════════════
// CONSTELLATION BLURBS
// ═══════════════════════════════════════════════════════════
// Original, authored flavor text (myth + a fun fact + a look-for) for the info
// modal — replaces the old live Wikipedia fetch (see issue #4). Keyed by abbr.
let _blurbs = null;
function _loadBlurbs() {
  if (_blurbs) return Promise.resolve(_blurbs);
  return fetch('js/constellation-blurbs.json').then(r => r.json()).then(b => (_blurbs = b));
}
_loadBlurbs().catch(() => {});  // warm the cache so the first tap is instant

// ═══════════════════════════════════════════════════════════
// HASH ROUTING
// ═══════════════════════════════════════════════════════════
// The router itself is js/screens.js; this is the impure half it is wired to —
// the real history, the real screen toggle, and one enter action per route. The
// router owns everything else: which screen a route shows, when a redirect
// replaces instead of pushes, and what leaving means (spec #44).

function _initRouting() {
  initRouter({
    history: {
      push:    hash => history.pushState(null, '', '#' + hash),
      replace: hash => history.replaceState(null, '', '#' + hash),
    },
    setScreen: name => {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('screen-' + name).classList.add('active');
    },
    actions: {
      course: () => renderCourseMap(),
      explore: () => {
        restoreExploreState();
        stopExploreQuiz(); requestExploreDraw();
      },
      // An explicit destination, so the saved free-explore state is deliberately
      // NOT restored — an unknown abbr just leaves the view where it is.
      exploreCon: abbr => {
        const con = C.find(c => c.abbr === abbr);
        if (con) { explore.P = raDecToVec(con.ra, con.dec); explore.R = 0; }
        stopExploreQuiz(); requestExploreDraw();
      },
      view: abbr => {
        const con = C.find(c => c.abbr === abbr);
        // An unknown abbr is a dead URL, so it replaces rather than pushes — the
        // same rule the router applies to a hash that names no route at all.
        con ? showViewer(con) : navigate('course', { replace: true });
      },
      lesson: () => { if (!tryResumeLesson()) startLesson(); },
      settings: () => { if (typeof refreshSettings === 'function') refreshSettings(); },
      calibration: () => startCalibration(),
    },
    exits: {
      // Leaving the level check leaves calibration mode, so a probe exit via a
      // breadcrumb or the gear (not just Quit) can't leak the flag into a later
      // lesson, which would skip exposure recording and re-seed from probe
      // results. This replaces a preamble that cleared the flag on EVERY route
      // change, because handleRoute could not tell a departure from an arrival.
      calibration: () => { session.calibration = false; },
    },
  });

  // Back button support. A popstate is an entry the app did not initiate, so it
  // writes no history of its own.
  window.addEventListener('popstate', () => enterRoute(location.hash.slice(1)));
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  _initRouting();
  try { initExploreGL(document.getElementById('explore-gl-canvas')); } catch(e) { console.error('GL init failed:', e); }

  // Populate constellation viewer search datalist and viewer select
  const sorted = [...C].sort((a, b) => a.name.localeCompare(b.name));
  const viewerList = document.getElementById('con-search-list');
  sorted.forEach(con => {
    const opt = document.createElement('option');
    opt.value = con.name;
    viewerList.appendChild(opt);
  });

  function goToViewer() {
    const val = document.getElementById('con-search-input').value.trim();
    const con = C.find(c => c.name.toLowerCase() === val.toLowerCase());
    if (con) navigate('view/' + con.abbr);
  }
  document.getElementById('btn-view').addEventListener('click', goToViewer);
  document.getElementById('con-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') goToViewer();
  });
  document.getElementById('btn-reset-progress').addEventListener('click', () => {
    if (!confirm('Erase all progress?')) return;
    ['con-exposure', 'lesson-count'].forEach(k => localStorage.removeItem(k));
    sessionStorage.removeItem('lesson-session');
    renderCourseMap();
  });
  document.getElementById('btn-continue').addEventListener('click', () => {
    navigate('lesson');
  });
  document.getElementById('btn-explore-free').addEventListener('click', () => {
    navigate('explore');
  });
  initViewer();      // the viewer's own picker, on the viewer's own screen

  document.getElementById('btn-next').addEventListener('click', nextLessonQuestion);
  document.getElementById('quiz-autocomplete-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter' && !e.target.disabled) { e.stopPropagation(); handleAutocompleteAnswer(); } });
  document.getElementById('quiz-autocomplete-submit')
    .addEventListener('click', handleAutocompleteAnswer);
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (session.calibration) return;   // no going back within a level check
    if (session.idx > 0 && session.history[session.idx - 1]) {
      session.idx--;
      showLessonQuestion();
    }
  });
  document.getElementById('find-btn-quit').addEventListener('click', () => { endLesson(); });
  document.getElementById('find-help-btn').addEventListener('click', () => {
    const q = explore.quiz;
    if (q?.target) startFindGuide(q.target);
  });
  document.getElementById('find-btn-prev').addEventListener('click', () => {
    if (session.idx > 0 && session.history[session.idx - 1]) {
      session.idx--;
      showLessonQuestion();
    }
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    if (session.calibration) {         // quitting a level check → back to course, no seeding
      navigate('course');              // leaving the route clears the flag (its exit action)
      return;
    }
    // Quit belongs to the quiz. It used to need a third meaning — "leave the viewer" —
    // because the viewer was showing on this screen (issue #73); the viewer leaves by
    // its own breadcrumb now.
    if (session.lessonIdx != null) {
      endLesson();
    } else {
      navigate('course');
    }
  });

  // The quiz's reveal panel builds its own picture and toggles, and mounts itself on
  // first use (quizPanel in js/quiz.js) — there is nothing to initialise here.
  initCourseDetail();
  initCalibration();

  // Explore mode
  document.getElementById('eq-next').addEventListener('click', () => {
    if (explore.quiz?.onNext) explore.quiz.onNext();
    else nextExploreQuestion();
  });
  document.addEventListener('keydown', e => {
    if (currentScreen() !== 'explore') return;
    if ((e.key === 'Enter' || e.key === ' ') && document.getElementById('eq-next').classList.contains('show'))
      document.getElementById('eq-next').click();
  });
  document.getElementById('breadcrumb-course').addEventListener('click', e => {
    e.preventDefault(); navigate('course');
  });
  document.getElementById('explore-breadcrumb-course').addEventListener('click', e => {
    e.preventDefault(); navigate('course');
  });
  document.getElementById('quiz-breadcrumb-course').addEventListener('click', e => {
    e.preventDefault(); navigate('course');
  });
  document.getElementById('view-breadcrumb-course').addEventListener('click', e => {
    e.preventDefault(); navigate('course');
  });

  // Settings: global gear opens the settings screen; breadcrumb returns to course
  // Navigating to the hash already showing replaces rather than pushes, so a second
  // tap no longer needs guarding against a duplicate history entry.
  document.getElementById('btn-settings').addEventListener('click', () => navigate('settings'));
  document.getElementById('settings-breadcrumb-course').addEventListener('click', e => {
    e.preventDefault(); navigate('course');
  });

  // Populate explore search datalist
  const exploreList = document.getElementById('explore-con-list');
  [...C].sort((a, b) => a.name.localeCompare(b.name)).forEach(con => {
    const opt = document.createElement('option');
    opt.value = con.name;
    exploreList.appendChild(opt);
  });

  function goToConstellation() {
    const val = document.getElementById('explore-search-input').value.trim();
    const con = C.find(c => c.name.toLowerCase() === val.toLowerCase());
    if (!con) return;
    animateGoTo(con.ra, con.dec);
    document.getElementById('explore-search-input').blur();
  }
  document.getElementById('explore-search-go').addEventListener('click', goToConstellation);
  document.getElementById('explore-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') goToConstellation();
  });
  // Initialize toggle groups and rotate dial for explore mode
  initExploreToggles();
  initEqRevealToggles();
  initSettings();

  // Copy View button — copies RA/Dec/FOV/rotation to clipboard
  document.getElementById('btn-copy-view').addEventListener('click', () => {
    copyViewToClipboard(document.getElementById('btn-copy-view'));
  });

  // Paste View button — reads RA/Dec/FOV/rotation JSON from clipboard and applies it
  document.getElementById('btn-paste-view').addEventListener('click', () => {
    navigator.clipboard.readText().then(text => {
      // Accept either a JSON object or bare key:value lines from Copy View
      let clean = text.trim();
      if (!clean.startsWith('{')) clean = '{' + clean + '}';
      // Strip trailing commas before closing brace
      clean = clean.replace(/,\s*}/g, '}');
      const obj = JSON.parse(clean);
      if (typeof obj.ra === 'number' && typeof obj.dec === 'number') {
        explore.P = raDecToVec(obj.ra, obj.dec);
        if (typeof obj.fov === 'number') explore.fov = obj.fov;
        const northUpR = guideNorthUpR(explore.P);
        explore.R = northUpR + (typeof obj.rotation === 'number' ? obj.rotation : 0);
        requestExploreDraw();
        const btn = document.getElementById('btn-paste-view');
        btn.textContent = 'Pasted!';
        setTimeout(() => { btn.textContent = 'Paste View'; }, 1500);
      }
    }).catch(() => {
      const btn = document.getElementById('btn-paste-view');
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = 'Paste View'; }, 1500);
    });
  });

  // Explore drag (mouse + touch + wheel zoom)
  initExploreDrag();

  // Keyboard shortcuts are scoped by screen; the router is asked which one is
  // showing, rather than reading it back off a CSS class.
  document.addEventListener('keydown', e => {
    if (currentScreen() === 'result') {
      if (e.key === 'Enter' || e.key === ' ') {
        const next = document.querySelector('#result-btns .btn-again');
        if (next) { e.preventDefault(); next.click(); }
      }
      return;
    }
    if (currentScreen() !== 'quiz') return;
    const btns = [...document.querySelectorAll('.ans-btn')];
    const idx = { '1': 0, '2': 1, '3': 2, '4': 3 }[e.key];
    if (idx !== undefined && btns[idx] && !btns[idx].disabled) btns[idx].click();
    if ((e.key === 'Enter' || e.key === ' ') && document.getElementById('btn-next').classList.contains('show'))
      document.getElementById('btn-next').click();
  });

  // ── Constellation info modal ──
  const conModal = document.getElementById('con-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalGuideLink = document.getElementById('modal-guide-link');
  const modalExploreBtn = document.getElementById('modal-explore-btn');
  const modalGlyph = document.getElementById('modal-glyph');
  let modalAbbrCurrent = null;

  function openConModal(con) {
    modalAbbrCurrent = con.abbr;
    modalTitle.textContent = con.name;
    modalBody.textContent = '';
    // Mini north-up figure, same glyph the course detail popover uses (issue #22).
    modalGlyph.replaceChildren(conGlyph(con, 64));
    conModal.style.display = 'flex';
    // Authored blurb (cached; near-instant after warm-up), guarded against a
    // stale modal if the user reopens on a different constellation mid-load.
    _loadBlurbs().then(blurbs => {
      if (modalAbbrCurrent !== con.abbr) return;
      modalBody.textContent = blurbs[con.abbr] || 'No description available.';
    }).catch(() => {});
    // Offer the finding guide only when one exists for this constellation.
    modalGuideLink.style.display = 'none';
    _loadGuides().then(guides => {
      if (modalAbbrCurrent !== con.abbr) return;
      if (guides[con.name]?.steps?.length) modalGuideLink.style.display = '';
    }).catch(() => {});
  }

  function closeConModal() {
    conModal.style.display = 'none';
    modalAbbrCurrent = null;
  }

  document.getElementById('modal-close').addEventListener('click', closeConModal);
  conModal.addEventListener('click', e => { if (e.target === conModal) closeConModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeConModal(); });

  modalExploreBtn.addEventListener('click', () => {
    const abbr = modalAbbrCurrent;
    closeConModal();
    navigate('explore/' + abbr);
  });

  // "Finding guide →" — jump into the explorer for this constellation and start
  // its guided walkthrough. When opened from the quiz (the info link on an answered
  // question or a level-check probe), the guide is a detour: on finish, return to
  // the quiz at the same question rather than leaving the learner in explore (#35).
  modalGuideLink.addEventListener('click', e => {
    e.preventDefault();
    const con = C.find(c => c.abbr === modalAbbrCurrent);
    const fromQuiz = currentScreen() === 'quiz';
    closeConModal();
    if (!con) return;
    // From the quiz the guide is a DETOUR: record the route being left and how to
    // re-render it, so finishing the guide returns to the same question. The
    // departure below is then not a departure, which is why the level-check flag
    // needs no saving and restoring across it.
    if (fromQuiz) beginDetour(() => { showScreen('quiz'); showLessonQuestion(); });
    navigate('explore/' + con.abbr);
    startFindGuide(con);
  });

  // Delegated handler for .con-info-link clicks (generated dynamically by conLabel)
  document.addEventListener('click', e => {
    const link = e.target.closest('.con-info-link');
    if (!link) return;
    e.preventDefault();
    const con = C.find(c => c.abbr === link.dataset.abbr);
    if (con) openConModal(con);
  });

  // Entry point — route based on current URL hash, but a first-run learner (empty
  // progress) arriving at the default landing is offered the level check (#34).
  // The resolved entry is written back, so hash and screen agree from the first
  // paint: the offer used to show while the address bar stayed empty.
  enterRoute(calibrationEntryTarget(location.hash.slice(1), calibrationIsFirstRun()),
             { write: 'replace' });
});
