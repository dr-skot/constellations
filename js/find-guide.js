// js/find-guide.js
// In-app finding guide — invoked from a find/navigate challenge

let _guidesCache = null;
let _guideSteps  = null;
let _guideStepIdx    = -1;
let _guideAnimating  = false;
let _guideDiagVisible = true;
let _guideSaved = null;   // saved quiz state while guide is open

// ── Data ────────────────────────────────────────────────────────────────────
function _loadGuides() {
  if (_guidesCache) return Promise.resolve(_guidesCache);
  return fetch('js/finding-guides.json')
    .then(r => r.json())
    .then(d => { _guidesCache = d; return d; });
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

// ── North-up roll ────────────────────────────────────────────────────────────
function _northUpR(P) {
  const pz = P[2], cos2 = 1 - pz * pz;
  if (cos2 < 1e-10) return 0;
  const s = Math.sqrt(cos2);
  const nd = [-pz*P[0]/s, -pz*P[1]/s, cos2/s];
  const q  = rotateByFromTo(nd, P, [0, 0, 1]);
  return Math.atan2(q[0], q[1]);
}

// ── Drawing ──────────────────────────────────────────────────────────────────
function _fgDraw() {
  explore.quiz = null;
  drawExplore();
}

function _fgDrawAnnotation(step) {
  const ann = document.getElementById('annotation-canvas');
  const src = document.getElementById('explore-canvas');
  const W = src.width, H = src.height;
  ann.width = W; ann.height = H;
  const ctx = ann.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  if (!step?.highlight?.length) return;

  const camUp = cameraReverse(explore.P, explore.R, [0, 1, 0]);
  const dpr   = window.devicePixelRatio || 1;
  const scale = W / (src.offsetWidth || W / dpr);

  ctx.save();
  for (const h of step.highlight) {
    if (h.line) {
      const projected = h.line.map(([ra, dec]) => {
        const p = projectStarsCamera([[ra, dec, 0]], explore.P, camUp, explore.fov, W, H)[0];
        return (p && p.d > 0) ? p : null;
      });
      const valid = projected.filter(p => p);
      ctx.strokeStyle = h.color;
      ctx.lineWidth   = Math.max(1.5, 1.5 * scale);
      ctx.shadowColor = h.color;
      ctx.shadowBlur  = 4 * scale;
      ctx.setLineDash([4 * scale, 5 * scale]);
      ctx.beginPath();
      let started = false;
      for (const p of projected) {
        if (!p) { started = false; continue; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      function drawArrowHead(tipX, tipY, dirX, dirY) {
        const size = 5 * scale, a = Math.PI / 6;
        for (const sign of [-1, 1]) {
          const ang = Math.PI + a * sign;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX + size * (dirX * Math.cos(ang) - dirY * Math.sin(ang)),
                     tipY + size * (dirX * Math.sin(ang) + dirY * Math.cos(ang)));
          ctx.stroke();
        }
      }
      if (valid.length >= 2) {
        const lw = 5 * scale;
        const p0 = valid[0], p1 = valid[1];
        const d0 = Math.hypot(p0.x - p1.x, p0.y - p1.y);
        if (d0 > 0) {
          const nx = (p0.x - p1.x) / d0, ny = (p0.y - p1.y) / d0;
          drawArrowHead(p0.x + nx * lw, p0.y + ny * lw, nx, ny);
        }
        const pn = valid[valid.length - 1], pm = valid[valid.length - 2];
        const dn = Math.hypot(pn.x - pm.x, pn.y - pm.y);
        if (dn > 0) {
          const nx = (pn.x - pm.x) / dn, ny = (pn.y - pm.y) / dn;
          drawArrowHead(pn.x + nx * lw, pn.y + ny * lw, nx, ny);
        }
      }
      ctx.shadowBlur = 0;
      if (h.label && valid.length) {
        const first = valid[0];
        const fs = Math.round(13 * scale);
        ctx.font = `bold ${fs}px system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        const lx = first.x + 6 * scale, ly = first.y - 10 * scale;
        ctx.strokeStyle = '#010208'; ctx.lineWidth = 3 * scale; ctx.lineJoin = 'round';
        ctx.strokeText(h.label, lx, ly);
        ctx.fillStyle = h.color; ctx.fillText(h.label, lx, ly);
      }
    } else {
      const pts = projectStarsCamera([[h.ra, h.dec, 0]], explore.P, camUp, explore.fov, W, H);
      const p = pts[0];
      if (!p || p.d <= 0) continue;
      const r  = h.r * scale;
      const fs = Math.round(13 * scale);
      ctx.strokeStyle = h.color;
      ctx.lineWidth   = Math.max(1.5, 1.5 * scale);
      ctx.shadowColor = h.color;
      ctx.shadowBlur  = r * 0.7;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = `bold ${fs}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      const lx = p.x + r + 6 * scale, ly = p.y;
      ctx.strokeStyle = '#010208'; ctx.lineWidth = 3 * scale; ctx.lineJoin = 'round';
      ctx.strokeText(h.label, lx, ly);
      ctx.fillStyle = h.color; ctx.fillText(h.label, lx, ly);
    }
  }
  ctx.restore();
}

function _fgAnimateTo(step, onDone) {
  if (explore.animFrame) { cancelAnimationFrame(explore.animFrame); explore.animFrame = null; }
  const v1 = explore.P.slice(), f1 = explore.fov;
  const v2 = raDecToVec(step.ra, step.dec), f2 = step.fov;
  const dot = Math.max(-1, Math.min(1, v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2]));
  const angle = Math.acos(dot), sinA = Math.sin(angle);
  const duration = Math.max(700, Math.min(2600, (angle / Math.PI) * 2600 + Math.abs(f2 - f1) * 10));
  const start = performance.now();
  function tick(now) {
    if (!_guideSaved) return; // guide was exited during animation
    const raw = Math.min(1, (now - start) / duration);
    const t   = raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw + 2, 3) / 2;
    if (angle > 0.001) {
      const fa = Math.sin((1 - t) * angle) / sinA, fb = Math.sin(t * angle) / sinA;
      explore.P = [fa*v1[0]+fb*v2[0], fa*v1[1]+fb*v2[1], fa*v1[2]+fb*v2[2]];
    }
    explore.fov = f1 + (f2 - f1) * t;
    _fgDraw();
    _fgDrawAnnotation(raw < 1 ? null : step);
    if (raw < 1) {
      explore.animFrame = requestAnimationFrame(tick);
    } else {
      explore.P = v2; explore.fov = f2; explore.animFrame = null;
      if (onDone) onDone();
    }
  }
  requestAnimationFrame(tick);
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
    : _northUpR(raDecToVec(con.ra, con.dec));

  _fgGoTo(0, true);
}
