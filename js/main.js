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
  if (typeof redrawIdentifyFigure === 'function') redrawIdentifyFigure();
  if (typeof redrawViewer === 'function') redrawViewer();
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
  return fetch(stampedUrl('js/constellation-blurbs.json')).then(r => r.json()).then(b => (_blurbs = b));
}
_loadBlurbs().catch(() => {});  // warm the cache so the first tap is instant

// ═══════════════════════════════════════════════════════════
// HASH ROUTING
// ═══════════════════════════════════════════════════════════
// The router itself is js/screens.js; this is the impure half it is wired to —
// the real history, the real screen toggle, and one enter action per route. The
// router owns everything else: which screen a route shows, when a redirect
// replaces instead of pushes, and what leaving means (spec #44).

// Is a question on display right now? A quiz renders an identify question on the identify
// screen and a find question on the explorer, and BOTH are quiz questions — so this asks
// the flow, never the surface alone. Asking only the surface is what stranded a learner
// who opened a finding guide from an answered find question (#75): "not the identify
// screen" was read as "no question here".
// "On display" is deliberately strict, because abandoning a lesson by navigating away
// clears neither half of the evidence: `session.questions` keeps the spent lesson, and
// `explore.quiz` survives until something calls stopExploreQuiz(). So a current question
// is necessary but not sufficient, and each clause has to name the surface it is claiming
// — otherwise a lesson abandoned on a find question would still answer yes from the level
// check's offer panel, which has no question on display at all.
function questionOnDisplay() {
  if (!session.questions[session.idx]) return false;
  return currentScreen() === 'identify'    // an identify question
      || (currentScreen() === 'explore' && !!explore.quiz);   // a find question
}

// The resume a question comes back by. One thunk for both kinds: showLessonQuestion picks
// its own surface — the identify screen for an identify question, the explorer for a find
// question — so there is nothing to branch on here.
function backToQuestion() {
  return questionOnDisplay() ? () => showLessonQuestion() : null;
}

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
      // closeFindGuide BEFORE stopExploreQuiz, and for the same reason endLesson does it
      // (#94): arriving at the explorer ends any guide that was running, and a guide is
      // more than its overlay. stopExploreQuiz only puts free-explore chrome on, which
      // takes the overlay off the screen while leaving the guide's state live — and a
      // running guide still wins over exState in resolveDisplayFlags, so the layer
      // toggles would come back visible and dead. Reachable with the browser Back button
      // from a guide opened via "Finding guide →", which navigates before it opens.
      //
      // Called here rather than inside stopExploreQuiz because find-help.html loads
      // explore.js without find-guide.js, where that would be a ReferenceError.
      explore: () => {
        restoreExploreState();
        closeFindGuide(); stopExploreQuiz(); requestExploreDraw();
      },
      // An explicit destination, so the saved free-explore state is deliberately
      // NOT restored — an unknown abbr just leaves the view where it is.
      exploreCon: abbr => {
        const con = C.find(c => c.abbr === abbr);
        if (con) { explore.P = raDecToVec(con.ra, con.dec); explore.R = 0; }
        closeFindGuide(); stopExploreQuiz(); requestExploreDraw();
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
    // How a route comes back from a detour — a finding guide opened from it, today.
    // A route absent here does not come back: the explorer leaves the learner where
    // the guide put them. endDetour deliberately does not re-run enter actions, which
    // is why each of these says what re-rendering means for itself: re-entering a
    // lesson would try to resume from storage a level check never wrote.
    // Each entry is asked for a resume thunk, and may answer null for "not from here".
    // A lesson or level check answers with the question on display, of either kind; it
    // answers null only when no question is showing — the level check's offer and payoff
    // panels — and then the guide's own exit restores wherever it took over.
    detours: {
      lesson:      () => backToQuestion(),
      calibration: () => backToQuestion(),
      view:        abbr => {
        const con = C.find(c => c.abbr === abbr);
        return con ? (() => { showScreen('view'); showViewer(con); }) : null;
      },
    },
    exits: {
      // Leaving the level check leaves level-check mode, so a probe exit via a
      // breadcrumb or the gear (not just Quit) can't leak it into a later lesson,
      // which would skip exposure recording and re-seed from probe results. This
      // replaced a preamble that cleared the flag on EVERY route change, because
      // handleRoute could not tell a departure from an arrival.
      //
      // The guard is load-bearing and was free before #92: while the run lived in two
      // fields this cleared `calibration` and left `lessonIdx` alone, so it could not
      // end a lesson even in principle. With one field an unconditional clear would —
      // and the offer panel is reachable mid-lesson, from the course map's "Level check"
      // button and from Settings. So this says only what it has always meant: leaving
      // the level check ends the level check, and nothing else.
      calibration: () => { if (isLevelCheck(session)) session.run = RUN_NONE; },
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
  // The guide source needs its fetch before anything can ask it a question. Warming is
  // explicit now: find-guide.js used to fire a load at script-load time, which a module
  // with an injected fetch cannot do — and should not, since a file that opens a network
  // connection merely by being on the page cannot be quietly loaded by a test or a tool.
  initGuideSource({ fetch: (...a) => fetch(...a) });
  warmGuideSource();

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
    // Two verbs, two owners, no storage keys. Both lines used to name their key here —
    // 'con-exposure' until js/exposure.js took it, 'lesson-session' until #91 — which made
    // each module's guarantees a convention rather than a fact. Erasing progress erases
    // both: the record of what has been practised, and any lesson still resumable.
    resetExposure();
    clearLessonSession();
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
  document.getElementById('identify-autocomplete-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter' && !e.target.disabled) { e.stopPropagation(); handleAutocompleteAnswer(); } });
  document.getElementById('identify-autocomplete-submit')
    .addEventListener('click', handleAutocompleteAnswer);
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (isLevelCheck(session)) return;   // no going back within a level check
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
    if (isLevelCheck(session)) {       // quitting a level check → back to course, no seeding
      navigate('course');              // leaving the route ends the run (its exit action)
      return;
    }
    // Quit belongs to the quiz. It used to need a third meaning — "leave the viewer" —
    // because the viewer was showing on this screen (issue #73); the viewer leaves by
    // its own breadcrumb now.
    if (isLesson(session)) {
      endLesson();
    } else {
      navigate('course');
    }
  });

  // The identify screen's reveal panel builds its own picture and toggles, and mounts
  // itself on first use (identifyPanel in js/quiz.js) — nothing to initialise here.
  initCourseDetail();
  initCalibration();

  // Explore mode
  // Next belongs to whoever built the quiz, and only one thing does: a lesson's find
  // question, which supplies onNext. The `else` arm here advanced the explorer's own
  // practice quiz, deleted with it.
  document.getElementById('eq-next').addEventListener('click', () => {
    explore.quiz?.onNext?.();
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
  document.getElementById('identify-breadcrumb-course').addEventListener('click', e => {
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
    // A genuine rendering question, unlike the one questionOnDisplay() asks: these keys
    // mean "pick answer N" only while the identify screen is the surface showing.
    if (currentScreen() !== 'identify') return;
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

  // `actions: false` opens the blurb and nothing else — no "Finding guide →", no "View
  // in Explorer →". That is an identify question's reveal (#64): one step away, and
  // closing it is the only exit. Those two controls are exactly what turned one step
  // into an open-ended walk out of the middle of a lesson.
  function openConModal(con, { actions = true } = {}) {
    modalAbbrCurrent = con.abbr;
    modalTitle.textContent = con.name;
    modalBody.textContent = '';
    modalExploreBtn.style.display = actions ? '' : 'none';
    // Mini north-up figure, same glyph the course detail popover uses (issue #22).
    modalGlyph.replaceChildren(conGlyph(con, 64));
    conModal.style.display = 'flex';
    // Authored blurb (cached; near-instant after warm-up), guarded against a
    // stale modal if the user reopens on a different constellation mid-load.
    _loadBlurbs().then(blurbs => {
      if (modalAbbrCurrent !== con.abbr) return;
      modalBody.textContent = blurbs[con.abbr] || 'No description available.';
    }).catch(() => {});
    // Offer the finding guide only when one exists for this constellation — and only
    // when this modal offers actions at all. The async resolve re-checks both, or a
    // blurb-only modal would sprout the link a moment after opening.
    modalGuideLink.style.display = 'none';
    if (!actions) return;
    // Asked of the guide source, which owns the question. This used to reach across into
    // find-guide.js's _loadGuides — an underscore-private name in another file — and
    // re-derive the answer as `guides[con.name]?.steps?.length`, a second copy of a rule
    // that also encoded the fact that guides are keyed by display name.
    hasGuide(con).then(exists => {
      if (modalAbbrCurrent !== con.abbr) return;
      if (exists) modalGuideLink.style.display = '';
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

  // "Finding guide →" — jump into the explorer for this constellation and start its
  // guided walkthrough. Whether that trip means to come back, and what coming back
  // looks like, is a property of the route being left, declared in the router's
  // detours table: a lesson question or a level-check probe returns to that question
  // (#35), the constellation viewer returns to the viewer (#74), and the explorer
  // opens no detour at all. The departure is then not a departure, which is why the
  // level-check flag needs no saving and restoring across it.
  modalGuideLink.addEventListener('click', e => {
    e.preventDefault();
    const con = C.find(c => c.abbr === modalAbbrCurrent);
    closeConModal();
    if (!con) return;
    beginDetourFromRoute();
    navigate('explore/' + con.abbr);
    startFindGuide(con);
  });

  // Delegated handler for .con-info-link clicks (generated dynamically by conLabel).
  // How far the link may take the learner was decided when the caption was built, and
  // rides on the anchor as data-link (#64): a find question goes straight to the guide,
  // an identify question gets the blurb with no onward actions, and everywhere outside a
  // question keeps the modal it always had. A probe's caption has no anchor to click.
  document.addEventListener('click', e => {
    const link = e.target.closest('.con-info-link');
    if (!link) return;
    e.preventDefault();
    const con = C.find(c => c.abbr === link.dataset.abbr);
    if (!con) return;
    if (link.dataset.link === 'guide') {
      // The same departure the modal's "Finding guide →" makes, minus the modal.
      beginDetourFromRoute();
      navigate('explore/' + con.abbr);
      startFindGuide(con);
      return;
    }
    openConModal(con, { actions: link.dataset.link !== 'blurb' });
  });

  // Entry point — route based on current URL hash, but a first-run learner (empty
  // progress) arriving at the default landing is offered the level check (#34).
  // The resolved entry is written back, so hash and screen agree from the first
  // paint: the offer used to show while the address bar stayed empty.
  enterRoute(calibrationEntryTarget(location.hash.slice(1), calibrationIsFirstRun()),
             { write: 'replace' });
});
