// js/guide-renderer.js
// Shared rendering logic used by find-help.html and find-guide.js

// ── Catalog lookup ────────────────────────────────────────────────────────────
function guideResolveHighlight(h, catalog) {
  if (typeof h === 'string') h = { id: h };
  if (!h.id) return h;
  const obj = catalog && catalog[h.id];
  if (!obj) return null;
  return Object.assign({}, obj, { label: h.label != null ? h.label : h.id }, h);
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

function _stepHasOverlays(step) {
  return !!(step.diagram || step.art || step.names || step.bounds || step.highlight?.length || step.lines?.length);
}

function _drawOutlinedLabel(ctx, text, x, y, color, scale) {
  const fs = Math.round(13 * scale);
  ctx.font = `bold ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#010208'; ctx.lineWidth = 3 * scale; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
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

  const camUp = cameraReverse(explore.P, explore.R, [0, 1, 0]);

  // Precession circle — centered on ecliptic pole, radius = obliquity
  if (step?.precessionCircle) {
    const south = step.precessionCircle === 'south';
    const obliquity = 23.44 * Math.PI / 180;
    const epRA = (south ? 90 : 270) * Math.PI / 180;
    const epDec = (south ? -(90 - 23.44) : (90 - 23.44)) * Math.PI / 180;
    // Ecliptic pole unit vector
    const epole = [
      Math.cos(epDec) * Math.cos(epRA),
      Math.cos(epDec) * Math.sin(epRA),
      Math.sin(epDec)
    ];
    const npts = 120;
    // Build two orthonormal vectors in the plane perpendicular to epole
    const up = [0, 0, 1];
    let u = [up[1]*epole[2] - up[2]*epole[1], up[2]*epole[0] - up[0]*epole[2], up[0]*epole[1] - up[1]*epole[0]];
    const uLen = Math.sqrt(u[0]*u[0] + u[1]*u[1] + u[2]*u[2]);
    u = [u[0]/uLen, u[1]/uLen, u[2]/uLen];
    const v = [epole[1]*u[2] - epole[2]*u[1], epole[2]*u[0] - epole[0]*u[2], epole[0]*u[1] - epole[1]*u[0]];
    const sinO = Math.sin(obliquity), cosO = Math.cos(obliquity);
    const projected = [];
    for (let i = 0; i <= npts; i++) {
      const t = (i / npts) * 2 * Math.PI;
      const pt = [
        cosO * epole[0] + sinO * (Math.cos(t) * u[0] + Math.sin(t) * v[0]),
        cosO * epole[1] + sinO * (Math.cos(t) * u[1] + Math.sin(t) * v[1]),
        cosO * epole[2] + sinO * (Math.cos(t) * u[2] + Math.sin(t) * v[2])
      ];
      const p = vecToPixel(pt, explore.P, camUp, explore.fov, W, H);
      projected.push(p);
    }
    const dpr = window.devicePixelRatio || 1;
    const s = W / (ann.offsetWidth || W / dpr);
    ctx.strokeStyle = 'rgba(220,180,80,0.4)';
    ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.setLineDash([6 * s, 5 * s]);
    ctx.beginPath();
    let started = false;
    for (const p of projected) {
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (!step?.highlight?.length) return;
  const dpr   = window.devicePixelRatio || 1;
  const scale = W / (src.offsetWidth || W / dpr);
  const fovS = 40 / explore.fov;  // FOV scale factor (same as drawStars)
  const margin = 10 * scale;     // fixed pixel margin around star
  const objRadius = (obj) => obj.arcmin
    ? (obj.arcmin / 60) / explore.fov * (W / 2)
    : magToR(obj.mag ?? 6) * fovS * scale;

  ctx.save();
  for (const raw of (step.highlight || [])) {
    if (raw.capsule) {
      // Resolve each capsule point: catalog lookup, project, carry label
      const pts = raw.capsule.map(e => {
        if (typeof e === 'string') e = { id: e };
        const obj = e.id ? (catalog && catalog[e.id]) : e;
        if (!obj) return null;
        const p = projectStarsCamera([[obj.ra, obj.dec, 0]], explore.P, camUp, explore.fov, W, H)[0];
        if (!p || p.d <= 0) return null;
        return { x: p.x, y: p.y, obj, label: e.label };
      }).filter(Boolean);
      if (pts.length < 2) continue;
      const maxObjR = Math.max(...pts.map(p => objRadius(p.obj)));
      const r     = maxObjR + (raw.margin != null ? raw.margin * scale : margin);
      const color = raw.color || '#fff';
      const lw    = Math.max(1.5, 1.5 * scale);
      const drawPath = (c) => {
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
      };
      // Draw capsule to offscreen canvas, then composite with glow
      const tmp = document.createElement('canvas');
      tmp.width = W; tmp.height = H;
      const tc = tmp.getContext('2d');
      tc.lineCap = 'round'; tc.lineJoin = 'round';
      tc.strokeStyle = color; tc.lineWidth = (r + lw / 2) * 2;
      drawPath(tc); tc.stroke();
      tc.globalCompositeOperation = 'destination-out';
      tc.strokeStyle = 'rgba(0,0,0,1)'; tc.lineWidth = Math.max(0, (r - lw / 2) * 2);
      drawPath(tc); tc.stroke();
      // Blit with glow
      ctx.shadowColor = color; ctx.shadowBlur = r * 0.7;
      ctx.drawImage(tmp, 0, 0);
      ctx.shadowBlur = 0;
      // Per-point labels, then fallback to capsule-level label at first point
      const labels = [];
      for (const p of pts) { if (p.label) labels.push([p, p.label]); }
      if (!labels.length && raw.label) labels.push([pts[0], raw.label]);
      for (const [P, text] of labels) {
        const lx = P.x + r + 6 * scale, ly = P.y;
        _drawOutlinedLabel(ctx, text, lx, ly, color, scale);
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
        _drawOutlinedLabel(ctx, h.label, first.x + 6 * scale, first.y - 10 * scale, h.color, scale);
      }
    } else if (h.crosshair) {
      const pts = projectStarsCamera([[h.ra, h.dec, 0]], explore.P, camUp, explore.fov, W, H);
      const p = pts[0];
      if (!p || p.d <= 0) continue;
      const celDash = 6, celGap = 5;
      const arm = 0.5 * (3 * celDash + 2 * celGap);
      ctx.strokeStyle = 'rgba(220,180,80,0.55)';
      ctx.lineWidth = Math.max(1, W / 640);
      ctx.setLineDash([celDash, celGap]);
      ctx.beginPath();
      ctx.moveTo(p.x - arm, p.y); ctx.lineTo(p.x + arm, p.y);
      ctx.moveTo(p.x, p.y - arm); ctx.lineTo(p.x, p.y + arm);
      ctx.stroke();
      ctx.setLineDash([]);
      if (h.label) {
        _drawOutlinedLabel(ctx, h.label, p.x + arm + 6 * scale, p.y, 'rgba(220,180,80,0.55)', scale);
      }
    } else {
      const pts = projectStarsCamera([[h.ra, h.dec, 0]], explore.P, camUp, explore.fov, W, H);
      const p = pts[0];
      if (!p || p.d <= 0) continue;
      const r  = objRadius(h) + margin;
      ctx.strokeStyle = h.color;
      ctx.lineWidth   = Math.max(1.5, 1.5 * scale);
      ctx.shadowColor = h.color; ctx.shadowBlur = r * 0.7;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      _drawOutlinedLabel(ctx, h.label, p.x + r + 6 * scale, p.y, h.color, scale);
    }
  }
  ctx.restore();
}

function _stepR(step) {
  const base = guideNorthUpR(raDecToVec(step.ra, step.dec));
  return step.rotation != null ? base + step.rotation : _gs ? _gs.defaultR : explore.R;
}

// ── Animation ─────────────────────────────────────────────────────────────────
// shouldContinue: optional function returning false to abort mid-animation
function guideAnimateTo(step, prevStep, draw, drawAnnotation, onDone, shouldContinue) {
  if (explore.animFrame) { cancelAnimationFrame(explore.animFrame); explore.animFrame = null; }
  const v1 = explore.P.slice(), f1 = explore.fov, R1 = explore.R;
  const v2 = raDecToVec(step.ra, step.dec), f2 = step.fov;
  const R2 = _stepR(step);
  let dR = R2 - R1;
  if (dR > Math.PI) dR -= 2 * Math.PI;
  if (dR < -Math.PI) dR += 2 * Math.PI;
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
    explore.R = R1 + dR * t;
    draw();
    drawAnnotation(raw < 1 ? prevStep : step);
    if (raw < 1) {
      explore.animFrame = requestAnimationFrame(tick);
    } else {
      explore.P = v2; explore.fov = f2; explore.R = R2;
      explore.animFrame = null;
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
  explore.photo   = step.photo || false;
  explore.diagram = step.diagram || false;
  explore.art     = step.art || false;
  explore.names   = step.names || false;
  explore.bounds  = step.bounds || false;
  explore.equator = step.equator || false;
  if (step.lines?.length && _gs?.catalog) {
    explore.guideLinesDef     = step.lines;
    explore.guideLinesCatalog = _gs.catalog;
    explore.guideLinesColor   = step.lineColor || 'rgba(140,200,255,0.9)';
    explore.guideLinesWidth   = step.lineWidth || 5;
  } else {
    explore.guideLinesDef = null;
  }
}

function _guideIntersectSettings(a, b) {
  const result = {
    photo:   a.photo   && b.photo,
    diagram: _intersectFilter(a.diagram, b.diagram),
    bounds:  _intersectFilter(a.bounds, b.bounds),
    art:     _intersectFilter(a.art, b.art),
    names:   _intersectFilter(a.names, b.names),
    equator: a.equator && b.equator
  };
  if (a.lines?.length && b.lines?.length) {
    const aSet = new Set(a.lines.map(l => l.join('|')));
    const shared = b.lines.filter(l => aSet.has(l.join('|')));
    if (shared.length) {
      result.lines = shared;
      result.lineColor = b.lineColor;
      result.lineWidth = b.lineWidth;
    }
  }
  return result;
}

function _guideIntersectAnnotation(a, b) {
  if (!a || !b) return null;
  const aIds = new Set((a.highlight || []).map(h => h.id || JSON.stringify(h)));
  const shared = (b.highlight || []).filter(h => aIds.has(h.id || JSON.stringify(h)));
  if (!shared.length) return null;
  return { highlight: shared };
}

function _intersectFilter(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const s = new Set(a);
    const shared = b.filter(x => s.has(x));
    return shared.length ? shared : undefined;
  }
  return a && b;
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
  const prevBtn = document.getElementById('fg-btn-prev');
  prevBtn.style.visibility = (idx === 0 || animating) ? 'hidden' : 'visible';
  const isLast = idx === n - 1;
  const step = steps[idx];
  const hasOverlays = _stepHasOverlays(step);
  const toggleBtn = document.getElementById('fg-btn-toggle-diag');
  toggleBtn.style.display = hasOverlays ? '' : 'none';
  toggleBtn.textContent   = diagVisible ? 'Hide overlays' : 'Show overlays';
  const nextBtn = document.getElementById('fg-btn-next');
  nextBtn.textContent = isLast ? 'Done ✓' : 'Next →';
  nextBtn.style.visibility = animating ? 'hidden' : 'visible';
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
    if (_gs.diagVisible) {
      _guideApplySettings(step);
    } else {
      _guideApplySettings({ photo: step.photo, equator: step.equator });
    }
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
  const s = _gs.steps[i];

  // Skip animation only if current view already matches the target step
  if (!immediate) {
    const { ra: curRa, dec: curDec } = vecToRaDec(explore.P);
    const targetR = _stepR(s);
    const atTarget = Math.abs(curRa - s.ra) < 0.01 && Math.abs(curDec - s.dec) < 0.01
                  && Math.abs(explore.fov - s.fov) < 0.01 && Math.abs(explore.R - targetR) < 0.001;
    if (atTarget) immediate = true;
  }

  _gs.animating = !immediate;
  _gs.diagVisible = _stepHasOverlays(s);
  if (_gs.stepKey) localStorage.setItem(_gs.stepKey, i);
  _guideRenderUI();

  if (immediate) {
    _guideApplySettings(s);
    explore.P   = raDecToVec(s.ra, s.dec);
    explore.fov = s.fov;
    explore.R   = _stepR(s);
    _guideDraw();
    guideDrawAnnotation(s, _gs.catalog);
    _gs.animating = false;
    _guideRenderUI();
  } else {
    // Before animation: apply intersection settings, clear departing elements
    const midSettings = prevStep ? _guideIntersectSettings(prevStep, s) : s;
    const midAnnotation = _guideIntersectAnnotation(prevStep, s);
    _guideApplySettings(midSettings);
    _guideDraw();
    guideDrawAnnotation(midAnnotation, _gs.catalog);

    guideAnimateTo(s, null, _guideDraw, () => guideDrawAnnotation(midAnnotation, _gs.catalog), () => {
      if (!_gs) return;
      _guideApplySettings(s);
      _guideDraw();
      guideDrawAnnotation(s, _gs.catalog);
      _gs.animating = false;
      _guideRenderUI();
    }, () => !!_gs);
  }
}

function guideStart(steps, catalog, options = {}) {
  _gs = { steps, catalog, idx: -1, animating: false, diagVisible: false,
          onLastNext: options.onLastNext || null, stepKey: options.stepKey || null,
          defaultR: explore.R };
  _guideAddListeners();
  const saved = _gs.stepKey ? parseInt(localStorage.getItem(_gs.stepKey), 10) : NaN;
  guideGoTo((!isNaN(saved) && saved >= 0 && saved < steps.length) ? saved : 0, true);
}

function guideStop() {
  if (_gs?.stepKey) localStorage.removeItem(_gs.stepKey);
  _gs = null;
  delete explore.photo;
  delete explore.diagram;
  delete explore.art;
  delete explore.names;
  delete explore.bounds;
  delete explore.equator;
  explore.guideLinesDef = null;
  const ann = document.getElementById('annotation-canvas');
  if (ann) { const c = ann.getContext('2d'); c.clearRect(0, 0, ann.width, ann.height); }
}
