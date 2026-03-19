// js/guide-renderer.js
// Shared rendering logic used by find-help.html and find-guide.js

// ── Catalog lookup ────────────────────────────────────────────────────────────
function guideResolveHighlight(h, catalog) {
  if (!h.id) return h;
  const obj = catalog && catalog[h.id];
  if (!obj) return null;
  return Object.assign({}, obj, { label: h.label || h.id }, h);
}

// ── North-up roll ─────────────────────────────────────────────────────────────
function guideNorthUpR(P) {
  const pz = P[2], cos2 = 1 - pz * pz;
  if (cos2 < 1e-10) return 0;
  const s = Math.sqrt(cos2);
  const nd = [-pz*P[0]/s, -pz*P[1]/s, cos2/s];
  const q  = rotateByFromTo(nd, P, [0, 0, 1]);
  return Math.atan2(q[0], q[1]);
}

// ── Annotation drawing ────────────────────────────────────────────────────────
function guideDrawAnnotation(step, catalog) {
  const ann = document.getElementById('annotation-canvas');
  const src = document.getElementById('explore-canvas');
  const W = src.width, H = src.height;
  ann.width = W; ann.height = H;
  ann.style.width  = src.style.width;
  ann.style.height = src.style.height;
  const ctx = ann.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  if (!step?.highlight?.length) return;

  const camUp = cameraReverse(explore.P, explore.R, [0, 1, 0]);
  const dpr   = window.devicePixelRatio || 1;
  const scale = W / (src.offsetWidth || W / dpr);

  ctx.save();
  for (const raw of step.highlight) {
    if (raw.capsule) {
      const ends = raw.capsule.map(e => {
        const obj = e.id ? (catalog && catalog[e.id]) : e;
        return obj || null;
      }).filter(Boolean);
      if (ends.length < 2) continue;
      const pts = ends.map(e => {
        const p = projectStarsCamera([[e.ra, e.dec, 0]], explore.P, camUp, explore.fov, W, H)[0];
        return (p && p.d > 0) ? p : null;
      });
      if (pts.some(p => !p)) continue;
      const r     = (raw.r || 10) * scale;
      const color = raw.color || '#fff';
      const lw    = Math.max(1.5, 1.5 * scale);
      const drawPath = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = color; ctx.shadowBlur = r * 0.3;
      ctx.strokeStyle = color; ctx.lineWidth = r * 2;
      drawPath(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.lineWidth = Math.max(0, r * 2 - lw * 2);
      drawPath(); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      if (raw.label) {
        const P1 = pts[0];
        const fs = Math.round(13 * scale);
        ctx.font = `bold ${fs}px system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        const lx = P1.x + r + 6 * scale, ly = P1.y;
        ctx.strokeStyle = '#010208'; ctx.lineWidth = 3 * scale; ctx.lineJoin = 'round';
        ctx.strokeText(raw.label, lx, ly);
        ctx.fillStyle = color; ctx.fillText(raw.label, lx, ly);
      }
      continue;
    }
    const h = guideResolveHighlight(raw, catalog);
    if (!h) continue;
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

// ── Animation ─────────────────────────────────────────────────────────────────
// shouldContinue: optional function returning false to abort mid-animation
function guideAnimateTo(step, prevStep, draw, drawAnnotation, onDone, shouldContinue) {
  if (explore.animFrame) { cancelAnimationFrame(explore.animFrame); explore.animFrame = null; }
  const v1 = explore.P.slice(), f1 = explore.fov;
  const v2 = raDecToVec(step.ra, step.dec), f2 = step.fov;
  const dot = Math.max(-1, Math.min(1, v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2]));
  const angle = Math.acos(dot), sinA = Math.sin(angle);
  const duration = Math.max(700, Math.min(2600, (angle / Math.PI) * 2600 + Math.abs(f2 - f1) * 10));
  const start = performance.now();
  function tick(now) {
    if (shouldContinue && !shouldContinue()) return;
    const raw = Math.min(1, (now - start) / duration);
    const t   = raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw + 2, 3) / 2;
    if (angle > 0.001) {
      const fa = Math.sin((1 - t) * angle) / sinA, fb = Math.sin(t * angle) / sinA;
      explore.P = [fa*v1[0]+fb*v2[0], fa*v1[1]+fb*v2[1], fa*v1[2]+fb*v2[2]];
    }
    explore.fov = f1 + (f2 - f1) * t;
    draw();
    drawAnnotation(raw < 1 ? prevStep : step);
    if (raw < 1) {
      explore.animFrame = requestAnimationFrame(tick);
    } else {
      explore.P = v2; explore.fov = f2; explore.animFrame = null;
      if (onDone) onDone();
    }
  }
  requestAnimationFrame(tick);
}

// ── Guide session ─────────────────────────────────────────────────────────────
// _gs holds all state for the active guide session
let _gs = null;

function _guideDraw() { explore.quiz = null; drawExplore(); }

window.addEventListener('resize', () => {
  const wrap = document.getElementById('explore-wrap');
  const gl   = document.getElementById('explore-gl-canvas');
  if (wrap) wrap._sized = false;
  if (gl)   gl._sized   = false;
  _guideDraw();
  if (_gs) guideDrawAnnotation(_gs.diagVisible ? _gs.steps[_gs.idx] : null, _gs.catalog);
});

function _guideApplySettings(step) {
  document.getElementById('chk-ex-photo'     ).checked = !!step.photo;
  document.getElementById('chk-ex-diagram'   ).checked = !!step.diagram;
  document.getElementById('chk-ex-bounds'    ).checked = !!step.bounds;
  document.getElementById('chk-ex-art'       ).checked = !!step.art;
  document.getElementById('chk-ex-starlabels').checked = false;
  document.getElementById('chk-ex-connames'  ).checked = !!step.names;
  document.getElementById('chk-ex-equator'   ).checked = !!step.equator;
}

function _guideRenderUI() {
  const { steps, idx, animating, diagVisible } = _gs;
  const n = steps.length;
  document.getElementById('fg-step-dots').innerHTML = steps.map((_, j) =>
    `<div class="fg-dot ${j < idx ? 'done' : j === idx ? 'active' : ''}"></div>`
  ).join('');
  document.getElementById('fg-step-count').textContent = `${idx + 1} / ${n}`;
  document.getElementById('fg-caption-label').textContent = steps[idx].title;
  document.getElementById('fg-caption-text').textContent  = steps[idx].caption;
  document.getElementById('fg-btn-prev').disabled = idx === 0 || animating;
  const isLast = idx === n - 1;
  const toggleBtn = document.getElementById('fg-btn-toggle-diag');
  toggleBtn.style.display = '';
  toggleBtn.textContent   = diagVisible ? 'Hide overlays' : 'Show overlays';
  const nextBtn = document.getElementById('fg-btn-next');
  nextBtn.textContent = isLast ? 'Done ✓' : 'Next →';
  nextBtn.disabled    = animating;
}

let _guideListenersAdded = false;

function _guideAddListeners() {
  if (_guideListenersAdded) return;
  _guideListenersAdded = true;

  document.getElementById('fg-btn-next').addEventListener('click', () => {
    if (!_gs || _gs.animating) return;
    if (_gs.idx === _gs.steps.length - 1) { if (_gs.onLastNext) _gs.onLastNext(); return; }
    guideGoTo(_gs.idx + 1);
  });

  document.getElementById('fg-btn-prev').addEventListener('click', () => {
    if (!_gs || _gs.animating || _gs.idx === 0) return;
    guideGoTo(_gs.idx - 1);
  });

  document.getElementById('fg-btn-toggle-diag').addEventListener('click', () => {
    if (!_gs) return;
    _gs.diagVisible = !_gs.diagVisible;
    const step = _gs.steps[_gs.idx];
    document.getElementById('chk-ex-diagram' ).checked = _gs.diagVisible && !!step.diagram;
    document.getElementById('chk-ex-connames').checked = _gs.diagVisible && !!step.names;
    document.getElementById('chk-ex-bounds'  ).checked = _gs.diagVisible && !!step.bounds;
    document.getElementById('chk-ex-art'     ).checked = _gs.diagVisible && !!step.art;
    _guideDraw();
    guideDrawAnnotation(_gs.diagVisible ? step : null, _gs.catalog);
    document.getElementById('fg-btn-toggle-diag').textContent =
      _gs.diagVisible ? 'Hide overlays' : 'Show overlays';
  });

  const backBtn = document.getElementById('fg-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => { if (_gs?.onLastNext) _gs.onLastNext(); });
}

function guideGoTo(i, immediate) {
  if (!_gs) return;
  const prevStep = (_gs.idx >= 0 && _gs.diagVisible) ? _gs.steps[_gs.idx] : null;
  _gs.idx = i;
  _gs.animating = !immediate;
  _gs.diagVisible = !!_gs.steps[i].diagram;
  if (_gs.stepKey) localStorage.setItem(_gs.stepKey, i);
  const step = _gs.steps[i];
  _guideRenderUI();

  if (immediate) {
    _guideApplySettings(step);
    explore.P   = raDecToVec(step.ra, step.dec);
    explore.fov = step.fov;
    _guideDraw();
    guideDrawAnnotation(step, _gs.catalog);
    _gs.animating = false;
    _guideRenderUI();
  } else {
    guideAnimateTo(step, prevStep, _guideDraw, s => guideDrawAnnotation(s, _gs.catalog), () => {
      if (!_gs) return;
      _guideApplySettings(step);
      _guideDraw();
      _gs.animating = false;
      _guideRenderUI();
    }, () => !!_gs);
  }
}

function guideStart(steps, catalog, options = {}) {
  _gs = { steps, catalog, idx: -1, animating: false, diagVisible: false,
          onLastNext: options.onLastNext || null, stepKey: options.stepKey || null };
  _guideAddListeners();
  const saved = _gs.stepKey ? parseInt(localStorage.getItem(_gs.stepKey), 10) : NaN;
  guideGoTo((!isNaN(saved) && saved >= 0 && saved < steps.length) ? saved : 0, true);
}

function guideStop() {
  if (_gs?.stepKey) localStorage.removeItem(_gs.stepKey);
  _gs = null;
  const ann = document.getElementById('annotation-canvas');
  if (ann) { const c = ann.getContext('2d'); c.clearRect(0, 0, ann.width, ann.height); }
}
