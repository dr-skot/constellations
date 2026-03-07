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
    if (con) { explore.ra = con.ra; explore.dec = con.dec; }
    stopExploreQuiz(); showScreen('explore'); drawExplore();
  } else if (hash.startsWith('view/')) {
    const con = C.find(c => c.abbr === hash.slice(5));
    con ? viewConstellation(con) : navigate('course');
  } else if (hash.startsWith('stage/')) {
    const idx = parseInt(hash.slice(6));
    const stage = STAGES[idx];
    if (!stage || !isPhaseUnlocked(stage.phase)) { navigate('course'); return; }
    if (stage.type === 'find') { if (!tryResumeFindStage(idx)) startFindCourseStage(idx); }
    else if (!tryResumeStage(idx)) startCourseStage(idx);
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

  // Viewer tweak sliders
  function onTweakChange() {
    viewerTweak.scale = document.getElementById('tweak-scale').value / 100;
    viewerTweak.dx    = parseFloat(document.getElementById('tweak-dx').value);
    viewerTweak.dy    = parseFloat(document.getElementById('tweak-dy').value);
    document.getElementById('tweak-scale-val').textContent = viewerTweak.scale.toFixed(2) + '×';
    document.getElementById('tweak-dx-val').textContent    = viewerTweak.dx.toFixed(1) + '°';
    document.getElementById('tweak-dy-val').textContent    = viewerTweak.dy.toFixed(1) + '°';
    const con = session.pool[session.idx];
    if (con && session.viewMode) redrawReveal(con);
  }
  ['tweak-scale','tweak-dx','tweak-dy'].forEach(id =>
    document.getElementById(id).addEventListener('input', onTweakChange));

  document.getElementById('btn-copy-framing').addEventListener('click', () => {
    const con = session.pool[session.idx];
    if (!con) return;
    const tc = tweakedCon(con);
    const text = `ra: ${tc.ra.toFixed(1)}, dec: ${tc.dec.toFixed(1)}, fov: ${tc.fov.toFixed(1)}`;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btn-copy-framing');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy ra/dec/fov'; }, 1500);
    });
  });

  document.getElementById('btn-next').addEventListener('click', nextQuestion);
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (session.idx > 0 && session.history[session.idx - 1]) {
      session.idx--;
      showQuestion();
    }
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    if (session.viewMode) {
      session.viewMode = false;
      document.getElementById('screen-quiz').classList.remove('viewer-mode');
      navigate('course');
      return;
    }
    const answered = session.idx + (session.answered ? 1 : 0);
    showResults(answered);
  });

  document.getElementById('chk-rev-photo').addEventListener('change', () => {
    const con = session.pool[session.idx];
    if (!con || !session.answered) return;
    const checked = document.getElementById('chk-rev-photo').checked;
    settings.mode = checked ? 'photo' : 'diagram';
    if (checked) {
      const img = document.getElementById('photo-img');
      img.src = photoUrl(con);
      if (img.complete) { redrawReveal(con); }
      else { img.onload = () => redrawReveal(con); }
    } else {
      redrawReveal(con);
    }
  });

  document.getElementById('chk-rev-boundary').addEventListener('change', () => {
    const con = session.pool[session.idx];
    if (con && session.answered) redrawReveal(con);
  });
  document.getElementById('chk-rev-diagram').addEventListener('change', () => {
    const con = session.pool[session.idx];
    if (con && session.answered) redrawReveal(con);
  });
  document.getElementById('chk-rev-artwork').addEventListener('change', () => {
    const con = session.pool[session.idx];
    if (con && session.answered) redrawReveal(con);
  });

  // Explore mode
  document.getElementById('eq-next').addEventListener('click', nextExploreQuestion);
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
  const exploreCheckboxIds = ['chk-ex-photo', 'chk-ex-diagram', 'chk-ex-starlabels', 'chk-ex-connames', 'chk-ex-equator', 'chk-ex-bounds', 'chk-ex-art'];
  // Restore saved checkbox states
  exploreCheckboxIds.forEach(id => {
    const saved = localStorage.getItem(id);
    if (saved !== null) document.getElementById(id).checked = saved === '1';
  });
  // Save on change and redraw
  exploreCheckboxIds.forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      localStorage.setItem(id, document.getElementById(id).checked ? '1' : '0');
      drawExplore();
    });
  });

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
    const anchor = pixelToRADec(px, py, explore.ra, explore.dec, explore.fov, ec.width, ec.height);
    explore.drag = { anchor, startRa: explore.ra, startDec: explore.dec, startPx: px, startPy: py };
    exploreDragMoved = false;
    ew.classList.add('dragging');
  }
  function expDragMove(cx, cy) {
    if (!explore.drag) return;
    const { px, py } = expClientToCanvas(cx, cy);
    const dx = px - explore.drag.startPx, dy = py - explore.drag.startPy;
    if (!exploreDragMoved && Math.sqrt(dx * dx + dy * dy) < 5) return;
    exploreDragMoved = true;
    const W = ec.width, H = ec.height;
    const { anchor, startRa, startDec } = explore.drag;
    const v_anchor = raDecToVec(anchor.ra, anchor.dec);
    const v_start = raDecToVec(startRa, startDec);
    const cur = pixelToRADec(px, py, startRa, startDec, explore.fov, W, H);
    const v_cur = raDecToVec(cur.ra, cur.dec);
    const v_new = rotateByFromTo(v_start, v_cur, v_anchor);
    const newPos = vecToRaDec(v_new);
    explore.ra = newPos.ra;
    explore.dec = newPos.dec;
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
  ec.addEventListener('touchstart', e => { e.preventDefault(); expDragStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  ec.addEventListener('touchmove', e => { e.preventDefault(); expDragMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  ec.addEventListener('touchend', e => {
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
    const factor = e.ctrlKey ? Math.pow(1.03, e.deltaY) : (e.deltaY > 0 ? 1.1 : 0.9);
    explore.fov = Math.max(10, Math.min(110, explore.fov * factor));
    drawExplore();
    clearTimeout(exploreWheelTimer);
    exploreWheelTimer = setTimeout(saveExploreState, 300);
  }, { passive: false });

  document.addEventListener('keydown', e => {
    if (!document.getElementById('screen-quiz').classList.contains('active')) return;
    const btns = [...document.querySelectorAll('.ans-btn')];
    const idx = { '1': 0, '2': 1, '3': 2, '4': 3 }[e.key];
    if (idx !== undefined && btns[idx] && !btns[idx].disabled) btns[idx].click();
    if ((e.key === 'Enter' || e.key === ' ') && document.getElementById('btn-next').classList.contains('show'))
      document.getElementById('btn-next').click();
    if (e.key === 'd' || e.key === 'D') {
      debugLabels = !debugLabels;
      const con = session.pool[session.idx];
      if (con && session.answered) redrawReveal(con);
    }
    if (e.key === 'a' || e.key === 'A') {
      debugAnchors = !debugAnchors;
      const con = session.pool[session.idx];
      if (con && session.answered) redrawReveal(con);
    }
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
