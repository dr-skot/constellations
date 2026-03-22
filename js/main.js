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

  // Diagram source button group
  const savedSrc = localStorage.getItem('diag-source');
  if (savedSrc && _diagSources[savedSrc]) {
    _diagSource = savedSrc;
    document.querySelectorAll('.diag-src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === savedSrc));
  }
  document.querySelectorAll('.diag-src-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _diagSource = btn.dataset.src;
      localStorage.setItem('diag-source', _diagSource);
      document.querySelectorAll('.diag-src-btn').forEach(b => b.classList.toggle('active', b === btn));
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

  // Copy View button — copies RA/Dec/FOV/rotation to clipboard
  document.getElementById('btn-copy-view').addEventListener('click', () => {
    const { ra, dec } = vecToRaDec(explore.P);
    const northUpR = guideNorthUpR(explore.P);
    const obj = {
      ra: Math.round(ra * 100) / 100,
      dec: Math.round(dec * 100) / 100,
      fov: Math.round(explore.fov * 100) / 100
    };
    const guideR = explore.R - northUpR;
    if (Math.abs(guideR) > 0.001) obj.rotation = Math.round(guideR * 10000) / 10000;
    const lines = Object.entries(obj).map(([k, v]) => `        "${k}": ${JSON.stringify(v)},`);
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btn-copy-view');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy View'; }, 1500);
    });
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
        drawExplore();
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
