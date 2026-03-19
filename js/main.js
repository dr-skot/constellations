// ═══════════════════════════════════════════════════════════
// HASH ROUTING
// ═══════════════════════════════════════════════════════════

function navigate(hash) {
  history.pushState(null, '', '#' + hash);
  handleRoute(hash);
}

function handleRoute(hash) {
  if (!hash || hash === 'course') {
    showScreen('start'); renderCourseMap();
  } else if (hash === 'explore') {
    restoreExploreState();
    stopExploreQuiz(); showScreen('explore'); drawExplore();
  } else if (hash.startsWith('explore/')) {
    const con = C.find(c => c.abbr === hash.slice(8));
    if (con) { explore.P = raDecToVec(con.ra, con.dec); explore.R = 0; }
    stopExploreQuiz(); showScreen('explore'); drawExplore();
  } else if (hash.startsWith('view/')) {
    const con = C.find(c => c.abbr === hash.slice(5));
    con ? viewConstellation(con) : navigate('course');
  } else if (hash === 'lesson') {
    if (!tryResumeLesson()) startLesson();
  } else {
    navigate('course');
  }
}

// Back button support
window.addEventListener('popstate', () => handleRoute(location.hash.slice(1) || 'course'));

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  loadBounds();
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
  function goToViewerInline() {
    const val = document.getElementById('con-select-viewer-input').value.trim();
    const con = C.find(c => c.name.toLowerCase() === val.toLowerCase());
    if (con) navigate('view/' + con.abbr);
  }
  document.getElementById('btn-viewer-go').addEventListener('click', goToViewerInline);
  document.getElementById('con-select-viewer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') goToViewerInline();
  });

  document.getElementById('btn-next').addEventListener('click', nextLessonQuestion);
  document.getElementById('quiz-autocomplete-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter' && !e.target.disabled) { e.stopPropagation(); handleAutocompleteAnswer(); } });
  document.getElementById('quiz-autocomplete-submit')
    .addEventListener('click', handleAutocompleteAnswer);
  document.getElementById('btn-prev').addEventListener('click', () => {
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
    if (session.viewMode) {
      session.viewMode = false;
      document.getElementById('screen-quiz').classList.remove('viewer-mode');
      navigate('course');
      return;
    }
    if (session.lessonIdx != null) {
      endLesson();
    } else {
      navigate('course');
    }
  });

  document.getElementById('chk-rev-photo').addEventListener('change', () => {
    const con = currentCon();
    if (!con || !session.answered) return;
    const img = document.getElementById('photo-img');
    if (!img.complete || img.naturalWidth === 0) {
      img.onload = () => redrawReveal(con);
    } else {
      redrawReveal(con);
    }
  });

  document.getElementById('chk-rev-boundary').addEventListener('change', () => {
    const con = currentCon();
    if (con && session.answered) redrawReveal(con);
  });
  document.getElementById('chk-rev-diagram').addEventListener('change', () => {
    const con = currentCon();
    if (con && session.answered) redrawReveal(con);
  });
  document.getElementById('chk-rev-artwork').addEventListener('change', () => {
    const con = currentCon();
    if (con && session.answered) redrawReveal(con);
  });

  // Explore mode
  document.getElementById('eq-next').addEventListener('click', () => {
    if (explore.quiz?.onNext) explore.quiz.onNext();
    else nextExploreQuestion();
  });
  document.addEventListener('keydown', e => {
    if (!document.getElementById('screen-explore').classList.contains('active')) return;
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
  ['chk-eq-photo', 'chk-eq-boundary', 'chk-eq-diagram', 'chk-eq-art'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => drawExplore());
  });

  const exploreCheckboxIds = ['chk-ex-photo', 'chk-ex-stars', 'chk-ex-lines', 'chk-ex-starlabels', 'chk-ex-connames', 'chk-ex-equator', 'chk-ex-bounds', 'chk-ex-art', 'chk-ex-phototiles'];
  // Restore saved checkbox states
  exploreCheckboxIds.forEach(id => {
    const saved = localStorage.getItem(id);
    if (saved !== null) {
      const el = document.getElementById(id);
      if (!el) console.error('Missing checkbox element:', id);
      else el.checked = saved === '1';
    }
  });
  // Save on change and redraw
  exploreCheckboxIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) { console.error('Missing checkbox element for listener:', id); return; }
    el.addEventListener('change', () => {
      localStorage.setItem(id, el.checked ? '1' : '0');
      drawExplore();
    });
  });

  // Infinite roll dial — drag left/right to rotate continuously
  const rollStrip = document.getElementById('explore-roll-strip');
  let rollDragX = null;
  rollStrip.addEventListener('mousedown', e => { rollDragX = e.clientX; e.preventDefault(); });
  window.addEventListener('mousemove', e => {
    if (rollDragX === null) return;
    const dx = e.clientX - rollDragX;
    explore.R += dx * (Math.PI / 180);
    rollDragX = e.clientX;
    drawExplore();
  });
  window.addEventListener('mouseup', () => { rollDragX = null; });
  rollStrip.addEventListener('touchstart', e => { rollDragX = e.touches[0].clientX; e.preventDefault(); }, { passive: false });
  rollStrip.addEventListener('touchmove', e => {
    if (rollDragX === null) return;
    const dx = e.touches[0].clientX - rollDragX;
    explore.R += dx * (Math.PI / 180);
    rollDragX = e.touches[0].clientX;
    drawExplore();
    e.preventDefault();
  }, { passive: false });
  rollStrip.addEventListener('touchend', () => { rollDragX = null; });

  // Explore drag (mouse + touch)
  const ew = document.getElementById('explore-wrap');
  const ec = document.getElementById('explore-canvas');

  let exploreWheelTimer = null;

  function expClientToCanvas(cx, cy) {
    const dpr = window.devicePixelRatio || 1;
    const rect = ec.getBoundingClientRect();
    return { px: (cx - rect.left) * dpr, py: (cy - rect.top) * dpr };
  }
  function expDragStart(cx, cy) {
    if (explore.animFrame) { cancelAnimationFrame(explore.animFrame); explore.animFrame = null; }
    const { px, py } = expClientToCanvas(cx, cy);
    const up0 = cameraReverse(explore.P, explore.R, [0, 1, 0]);
    const vStart = pixelToVec(px, py, explore.P, up0, explore.fov, ec.width, ec.height);
    explore.drag = {
      startPx: px, startPy: py, prevPx: px, prevPy: py, vStart,
      P0: explore.P.slice(), R0: explore.R, up0
    };
    exploreDragMoved = false;
    ew.classList.add('dragging');
  }
  function expDragMove(cx, cy) {
    if (!explore.drag) return;
    const { px, py } = expClientToCanvas(cx, cy);
    if (!exploreDragMoved) {
      const dx = px - explore.drag.startPx, dy = py - explore.drag.startPy;
      if (Math.sqrt(dx * dx + dy * dy) < 2) return;
      exploreDragMoved = true;
    }
    // Always apply from original P0/R0 — no incremental accumulation
    const { P0, R0, up0, vStart } = explore.drag;
    const S1 = vStart;
    const S2 = pixelToVec(px, py, P0, up0, explore.fov, ec.width, ec.height);

    const P1 = rotateByFromTo(P0, S2, S1);

    // Compute R1 via reference point method
    const ax = S1[1] * S2[2] - S1[2] * S2[1];
    const ay = S1[2] * S2[0] - S1[0] * S2[2];
    const az = S1[0] * S2[1] - S1[1] * S2[0];
    const crossLen = Math.sqrt(ax * ax + ay * ay + az * az);
    let R1;
    if (crossLen < 1e-10) {
      R1 = R0;
    } else {
      const A = [ax / crossLen, ay / crossLen, az / crossLen];
      const theta = Math.acos(Math.max(-1, Math.min(1, S1[0] * S2[0] + S1[1] * S2[1] + S1[2] * S2[2])));
      const Q_up = cameraReverse(P1, 0, [0, 1, 0]);
      const step1 = cameraForward(A, theta, Q_up);
      const step2 = cameraReverse(A, 0, step1);
      const step3 = cameraForward(P0, R0, step2);
      R1 = Math.atan2(-step3[0], step3[1]);
    }

    explore.P = P1;
    explore.R = R1;
    explore.drag.prevPx = px;
    explore.drag.prevPy = py;
    drawExplore();
  }
  function expDragEnd() {
    explore.drag = null;
    ew.classList.remove('dragging');
    saveExploreState();
  }

  ec.addEventListener('contextmenu', e => e.preventDefault());
  ec.addEventListener('mousedown', e => expDragStart(e.clientX, e.clientY));
  window.addEventListener('mousemove', e => expDragMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', expDragEnd);
  ec.addEventListener('click', e => {
    if (!explore.quiz || explore.quiz.answered || exploreDragMoved) return;
    const { px, py } = expClientToCanvas(e.clientX, e.clientY);
    handleExploreClick(px, py);
  });
  let pinchStartDist = null, pinchStartFov = null;

  function touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  ec.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
      expDragEnd();
      pinchStartDist = touchDist(e.touches);
      pinchStartFov = explore.fov;
    } else {
      pinchStartDist = null;
      expDragStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  ec.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && pinchStartDist) {
      const dist = touchDist(e.touches);
      explore.fov = Math.max(10, Math.min(110, pinchStartFov * pinchStartDist / dist));
      drawExplore();
    } else if (e.touches.length === 1) {
      expDragMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  ec.addEventListener('touchend', e => {
    if (pinchStartDist && e.touches.length < 2) {
      pinchStartDist = null;
      saveExploreState();
      return;
    }
    expDragEnd();
    if (explore.quiz && !explore.quiz.answered && !exploreDragMoved && e.changedTouches.length) {
      const t = e.changedTouches[0];
      const { px, py } = expClientToCanvas(t.clientX, t.clientY);
      handleExploreClick(px, py);
    }
  });

  // Scroll to zoom
  ec.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.ctrlKey ? Math.pow(1.03, e.deltaY) : Math.pow(1.003, e.deltaY);
    explore.fov = Math.max(10, Math.min(110, explore.fov * factor));
    drawExplore();
    clearTimeout(exploreWheelTimer);
    exploreWheelTimer = setTimeout(saveExploreState, 300);
  }, { passive: false });

  document.addEventListener('keydown', e => {
    if (document.getElementById('screen-result').classList.contains('active')) {
      if (e.key === 'Enter' || e.key === ' ') {
        const next = document.querySelector('#result-btns .btn-again');
        if (next) { e.preventDefault(); next.click(); }
      }
      return;
    }
    if (!document.getElementById('screen-quiz').classList.contains('active')) return;
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
  const modalWikiLink = document.getElementById('modal-wiki-link');
  const modalExploreBtn = document.getElementById('modal-explore-btn');
  let modalAbbrCurrent = null;

  function openConModal(con) {
    modalAbbrCurrent = con.abbr;
    modalTitle.textContent = con.name;
    modalBody.textContent = 'Loading…';
    const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(con.name)}_(constellation)`;
    modalWikiLink.href = wikiUrl;
    conModal.style.display = 'flex';
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(con.name)}_(constellation)`)
      .then(r => r.json())
      .then(d => {
        if (modalAbbrCurrent !== con.abbr) return;
        modalBody.textContent = d.extract || 'No summary available.';
      })
      .catch(() => {
        if (modalAbbrCurrent !== con.abbr) return;
        modalBody.textContent = 'Could not load description.';
      });
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

  // Delegated handler for .con-info-link clicks (generated dynamically by conLabel)
  document.addEventListener('click', e => {
    const link = e.target.closest('.con-info-link');
    if (!link) return;
    e.preventDefault();
    const con = C.find(c => c.abbr === link.dataset.abbr);
    if (con) openConModal(con);
  });

  // Entry point — route based on current URL hash
  handleRoute(location.hash.slice(1) || 'course');
});
