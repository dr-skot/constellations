// ═══════════════════════════════════════════════════════════
// EXPLORE MODE
// ═══════════════════════════════════════════════════════════
const explorePhotoCache = {};
const FOV_MIN = 10, FOV_MAX = 110;
let explore = { P: raDecToVec(80, 5), R: 0, fov: 60, drag: null, quiz: null, animFrame: null };
let exploreDragMoved = false;

function copyViewToClipboard(btn) {
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
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy View'; }, 1500);
  });
}

// Alternate diagram sources, keyed by abbreviation
const _diagSources = {
  iau: null,  // default — use C directly
  rey: typeof REY !== 'undefined' ? Object.fromEntries(REY.map(c => [c.abbr, c])) : {},
  stellarium: typeof SC !== 'undefined' ? Object.fromEntries(SC.map(c => [c.abbr, c])) : {},
  ford: typeof FORD !== 'undefined' ? Object.fromEntries(FORD.map(c => [c.abbr, c])) : {},
};
let _diagSource = 'iau';

// ── Explore UI state (driven by toggle groups) ──
const exState = {
  photo: true, stars: true, diagram: true, art: true, bounds: true,
  starLabels: true, conNames: true,
  reference: 'always',  // 'always' | 'moving' | null
};
let _exToggleGroups = {};
let _exDial = null;

// ── Find quiz reveal controls state ──
const eqRevState = { photo: true, diagram: true, art: true, boundary: true };
let _eqRevToggleGroup = null;

function initEqRevealToggles() {
  _eqRevToggleGroup = createToggleGroup(document.getElementById('eq-reveal-controls'), {
    buttons: [
      { label: 'Photo', value: 'photo', on: true },
      { label: 'Diagram', value: 'diagram', on: true },
      { label: 'Art', value: 'art', on: true },
      { label: 'Bounds', value: 'boundary', on: true },
    ],
    onChange(value, on) { eqRevState[value] = on; drawExplore(); },
  });
}

function eqRevealReset(photoOn) {
  eqRevState.photo = !!photoOn;
  eqRevState.diagram = true;
  eqRevState.art = true;
  eqRevState.boundary = true;
  if (_eqRevToggleGroup) {
    _eqRevToggleGroup.setValue('photo', eqRevState.photo);
    _eqRevToggleGroup.setValue('diagram', true);
    _eqRevToggleGroup.setValue('art', true);
    _eqRevToggleGroup.setValue('boundary', true);
  }
}

function initExploreToggles() {
  // Restore saved states
  const saved = k => localStorage.getItem('ex-' + k);
  const toBool = (k, def) => { const v = saved(k); return v !== null ? v === '1' : def; };
  exState.photo = toBool('photo', true);
  exState.stars = toBool('stars', true);
  exState.diagram = toBool('diagram', true);
  exState.art = toBool('art', true);
  exState.bounds = toBool('bounds', true);
  exState.starLabels = toBool('starLabels', true);
  exState.conNames = toBool('conNames', true);
  const savedRef = saved('reference');
  if (savedRef !== null) exState.reference = savedRef === 'null' ? null : savedRef;

  function persist(k, v) { localStorage.setItem('ex-' + k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)); }
  function redraw() { drawExplore(); }

  _exToggleGroups.layers = createToggleGroup(document.getElementById('tg-layers'), {
    caption: 'Layers',
    buttons: [
      { label: 'Photo', value: 'photo', on: exState.photo },
      { label: 'Stars', value: 'stars', on: exState.stars },
      { label: 'Lines', value: 'diagram', on: exState.diagram },
      { label: 'Art', value: 'art', on: exState.art },
      { label: 'Bounds', value: 'bounds', on: exState.bounds },
    ],
    onChange(value, on) {
      exState[value] = on;
      persist(value, on);
      redraw();
    },
  });

  _exToggleGroups.labels = createToggleGroup(document.getElementById('tg-labels'), {
    caption: 'Labels',
    buttons: [
      { label: 'Stars', value: 'starLabels', on: exState.starLabels },
      { label: 'Cons', value: 'conNames', on: exState.conNames },
    ],
    onChange(value, on) {
      exState[value] = on;
      persist(value, on);
      redraw();
    },
  });

  _exToggleGroups.reference = createToggleGroup(document.getElementById('tg-reference'), {
    exclusive: true,
    allowNone: true,
    caption: 'Orientation Guides',
    buttons: [
      { label: 'Always', value: 'always', on: exState.reference === 'always' },
      { label: 'When Moving', value: 'moving', on: exState.reference === 'moving' },
    ],
    onChange(value, on, all) {
      exState.reference = all.length ? all[0] : null;
      persist('reference', exState.reference === null ? 'null' : exState.reference);
      redraw();
    },
  });

  // Rotate dial
  const dialReadout = document.getElementById('explore-dial-readout');
  _exDial = createRotateDial(document.getElementById('explore-dial'), {
    onAngle(deg) {
      explore.R = deg * Math.PI / 180;
      if (dialReadout) {
        const northR = guideNorthUpR(explore.P);
        const offsetDeg = (explore.R - northR) * 180 / Math.PI;
        let display = ((offsetDeg % 360) + 540) % 360 - 180;
        dialReadout.textContent = display.toFixed(1) + '\u00B0';
      }
      drawExplore();
    },
    onDragStart() { showNorthArrow(); },
    onDragEnd() {
      hideNorthArrow();
      if (dialReadout) dialReadout.textContent = 'Rotate';
      if (typeof saveExploreState === 'function') saveExploreState();
    },
  });
}
function _diagFor(con) {
  if (_diagSource === 'iau') return con;
  const alt = _diagSources[_diagSource]?.[con.abbr];
  return alt || con;
}

// Throttled constellation name placement — returns {ra, dec} for label position.
// Caches results and only recomputes after `interval` ms.
const _conNameCache = {};  // abbr -> {ra, dec, time}
const _conNameInterval = 500;  // ms between recomputations
let _conNameRefreshTimer = null;
function _clearConNameCache() {
  for (const k in _conNameCache) delete _conNameCache[k];
  if (_conNameRefreshTimer) { clearTimeout(_conNameRefreshTimer); _conNameRefreshTimer = null; }
}
function conNamePosition(con, ctx, fs, camP, camUp, fov, W, H, projBounds, allBoundEdges, showBounds) {
  const now = performance.now();
  const cached = _conNameCache[con.abbr];
  if (cached && now - cached.time < _conNameInterval) {
    // Schedule a redraw for when cache expires, in case nothing else triggers one
    if (!_conNameRefreshTimer) {
      const remaining = _conNameInterval - (now - cached.time);
      _conNameRefreshTimer = setTimeout(() => { _conNameRefreshTimer = null; drawExplore(); }, remaining);
    }
    return cached;
  }

  const cp = projectStarsCamera([[con.ra, con.dec, 99]], camP, camUp, fov, W, H)[0];
  if (!cp || cp.d <= 0) return null;

  const name = con.name;
  const tw = ctx.measureText(name).width;
  const hw = tw / 2 + 2, hh = fs * 0.65;
  const pRings = projBounds[con.abbr];
  const polyPts = pRings ? pRings.flatMap(pts => pts.filter(p => p.d > 0)) : null;
  const canPIP = polyPts && polyPts.length >= 3;
  const valid = (tx, ty) => {
    if (tx < hw || tx > W - hw || ty < hh || ty > H - hh) return false;
    const x1 = tx - hw, x2 = tx + hw, y1 = ty - hh, y2 = ty + hh;
    if (canPIP) {
      for (const [px, py] of [[tx,ty],[x1,y1],[x2,y1],[x1,y2],[x2,y2]])
        if (!pointInPoly2D(px, py, polyPts)) return false;
    }
    if (showBounds && allBoundEdges.length && edgesHitRect(allBoundEdges, x1, y1, x2, y2)) return false;
    return true;
  };
  let lx = cp.x, ly = cp.y;
  if (!valid(lx, ly)) {
    let found = false;
    const step = Math.max(hw, fs);
    for (let r = step; r < W * 0.7 && !found; r += step) {
      for (let ai = 0; ai < 16 && !found; ai++) {
        const tx = cp.x + Math.cos(ai * Math.PI / 8) * r;
        const ty = cp.y + Math.sin(ai * Math.PI / 8) * r;
        if (valid(tx, ty)) { lx = tx; ly = ty; found = true; }
      }
    }
    if (!found) return null;
  }
  const up = cameraReverse(camP, explore.R, [0, 1, 0]);
  const vec = pixelToVec(lx, ly, camP, up, fov, W, H);
  const rd = vecToRaDec(vec);
  const result = { ra: rd.ra, dec: rd.dec, time: now };
  _conNameCache[con.abbr] = result;
  return result;
}

function animateGoTo(targetRa, targetDec) {
  if (explore.animFrame) { cancelAnimationFrame(explore.animFrame); explore.animFrame = null; }
  const v1 = explore.P.slice();
  const v2 = raDecToVec(targetRa, targetDec);
  const dotP = Math.max(-1, Math.min(1, v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2]));
  const angle = Math.acos(dotP);
  if (angle < 0.001) return;
  const sinA = Math.sin(angle);
  // Duration proportional to arc length: 400ms–2000ms
  const duration = Math.max(400, Math.min(2000, angle / Math.PI * 2000));
  const startTime = performance.now();
  function step(now) {
    const raw = Math.min(1, (now - startTime) / duration);
    // Ease in-out cubic
    const t = raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw + 2, 3) / 2;
    const f1 = Math.sin((1 - t) * angle) / sinA;
    const f2 = Math.sin(t * angle) / sinA;
    explore.P = [f1*v1[0]+f2*v2[0], f1*v1[1]+f2*v2[1], f1*v1[2]+f2*v2[2]];
    drawExplore();
    if (raw < 1) {
      explore.animFrame = requestAnimationFrame(step);
    } else {
      explore.P = v2;
      explore.animFrame = null;
      _clearConNameCache();
      drawExplore();
      saveExploreState();
    }
  }
  explore.animFrame = requestAnimationFrame(step);
}

function saveExploreState() {
  _clearConNameCache();
  const pos = vecToRaDec(explore.P);
  sessionStorage.setItem('explore-state',
    JSON.stringify({ ra: pos.ra, dec: pos.dec, fov: explore.fov, R: explore.R }));
}

function restoreExploreState() {
  try {
    const d = JSON.parse(sessionStorage.getItem('explore-state'));
    if (d) { explore.P = raDecToVec(d.ra, d.dec); explore.fov = d.fov; explore.R = d.R || 0; }
  } catch {}
}

function exploreVisibleCons() {
  const { ra, dec } = vecToRaDec(explore.P);
  return C.filter(con =>
    angularDist(ra, dec, con.ra, con.dec) < explore.fov / 2 + con.fov / 2 + 8
  );
}


function loadExplorePhoto(con) {
  if (explorePhotoCache[con.abbr]) return;
  explorePhotoCache[con.abbr] = 'loading';
  const img = new Image();
  img.onload = () => {
    explorePhotoCache[con.abbr] = img;
    if (document.getElementById('screen-explore').classList.contains('active')) drawExplore();
  };
  img.onerror = () => { explorePhotoCache[con.abbr] = 'error'; };
  img.src = photoUrl(con);
}

function drawExplore() {
  const canvas = document.getElementById('explore-canvas');
  if (!canvas) return;
  const wrap = document.getElementById('explore-wrap');
  const glCanvas = document.getElementById('explore-gl-canvas');
  const dpr = window.devicePixelRatio || 1;
  const sz = wrap.offsetWidth;
  if (sz > 0 && (!wrap._sized || (glCanvas && !glCanvas._sized))) {
    const w = Math.round(sz * dpr);
    const h = Math.round(wrap.offsetHeight * dpr);
    const cssW = Math.round(sz) + 'px';
    const cssH = wrap.offsetHeight + 'px';
    canvas.width = w; canvas.height = h;
    canvas.style.width = cssW; canvas.style.height = cssH;
    wrap._sized = true;
    if (glCanvas) {
      glCanvas.width = w; glCanvas.height = h;
      glCanvas.style.width = cssW; glCanvas.style.height = cssH;
      glCanvas._sized = true;
    }

  }
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const { ra, dec } = vecToRaDec(explore.P);
  const camP = explore.P;
  const camUp = cameraReverse(explore.P, explore.R, [0, 1, 0]);
  const celDash = 6, celGap = 5;

  const _readout = document.getElementById('explore-readout');
  if (_readout) {
    const nr = guideNorthUpR(explore.P);
    const gr = explore.R - nr;
    _readout.textContent = `RA ${ra.toFixed(2)}  Dec ${dec.toFixed(2)}  FOV ${explore.fov.toFixed(2)}  Rot ${gr.toFixed(4)}`;
  }

  // Sync dial to current rotation when not being dragged by the user
  if (_exDial && !_exDial.isDragging()) {
    _exDial.setAngle(explore.R * 180 / Math.PI);
  }

  if (gl) {
    glClear(W, H);
    ctx.clearRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#010208';
    ctx.fillRect(0, 0, W, H);
  }

  const visible = exploreVisibleCons();
  const q = explore.quiz;
  const cm = q?.stageMode;  // course mode active?
  const isAnswered = !!(q?.answered);
  const showPhoto      = cm ? (isAnswered ? eqRevState.photo    : cm === 'photo')   : explore.photo !== undefined ? !!explore.photo : exState.photo;
  const showDiag       = cm ? (isAnswered ? eqRevState.diagram  : cm !== 'photo')   : true;
  const showStars      = cm ? showDiag : explore.diagram !== undefined ? !!explore.diagram : exState.stars;
  const showLines      = cm ? (isAnswered ? showDiag            : cm === 'diagram') : explore.diagram !== undefined ? !!explore.diagram : exState.diagram;
  const showBounds     = cm ? (isAnswered ? eqRevState.boundary : !!q.bounds)       : explore.bounds !== undefined ? !!explore.bounds : exState.bounds;
  const showArt        = cm ? (isAnswered ? eqRevState.art      : false)            : explore.art !== undefined ? !!explore.art : exState.art;
  const showStarLabels = cm ? false : exState.starLabels;
  const showConNames   = cm ? false : explore.names !== undefined ? !!explore.names : exState.conNames;
  const _refMode       = cm ? 'always' : explore.equator !== undefined ? (explore.equator ? 'always' : null) : exState.reference;
  const _refAlpha      = _refMode === 'always' ? 1 : _refMode === 'moving' ? (explore._northAlpha || 0) : 0;
  const showEquator    = _refAlpha > 0.01;

  // Photo layer (WebGL)
  if (showPhoto) {
    for (const con of visible) {
      drawExplorePhotoLayerGL(con, camP, camUp, explore.fov);
    }
    // Debug: red outline around each photo tile
    if (document.getElementById('chk-ex-phototiles')?.checked) {
      ctx.save();
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 1;
      for (const con of visible) {
        const IW = 640, IH = 640, N = 20;
        const edges = [];
        for (let i = 0; i <= N; i++) edges.push([i/N * IW, 0]);
        for (let i = 0; i <= N; i++) edges.push([IW, i/N * IH]);
        for (let i = N; i >= 0; i--) edges.push([i/N * IW, IH]);
        for (let i = N; i >= 0; i--) edges.push([0, i/N * IH]);
        const pts = edges.map(([px, py]) => {
          const rd = pixelToRADec(px, py, con.ra, con.dec, con.fov, IW, IH);
          return projectStarsCamera([[rd.ra, rd.dec, 0]], camP, camUp, explore.fov, W, H)[0];
        });
        ctx.beginPath();
        let started = false;
        for (const p of pts) {
          if (p.d <= 0) { started = false; continue; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Celestial equator
  if (showEquator) {
    const eqPts = [];
    for (let ra = 0; ra <= 360; ra += 0.5) eqPts.push([ra, 0, 0]);
    const pts = projectStarsCamera(eqPts, camP, camUp, explore.fov, W, H);
    ctx.save();
    ctx.strokeStyle = `rgba(220,180,80,${0.35 * _refAlpha})`;
    ctx.lineWidth = Math.max(1, W / 640);
    ctx.setLineDash([celDash, celGap]);
    ctx.beginPath();
    let penDown = false;
    for (const p of pts) {
      if (p.d <= 0) { penDown = false; continue; }
      if (!penDown) { ctx.moveTo(p.x, p.y); penDown = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Milky Way (galactic plane) — shown in diagram/stars quiz modes for orientation,
  // but not when the photo layer is visible (real photo has the real Milky Way).
  if (!showPhoto && (cm === 'diagram' || cm === 'stars')) {
    const mwPts = [];
    for (let l = 0; l <= 360; l += 0.5) {
      const { ra, dec } = galToRaDec(l, 0);
      mwPts.push([ra, dec, 0]);
    }
    const pts = projectStarsCamera(mwPts, camP, camUp, explore.fov, W, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(180,200,255,0.22)';
    ctx.lineWidth = Math.max(24, W / 13);
    ctx.shadowColor = 'rgba(180,200,255,0.16)';
    ctx.shadowBlur = W / 40;
    ctx.beginPath();
    let penDown = false;
    for (const p of pts) {
      if (p.d <= 0) { penDown = false; continue; }
      if (!penDown) { ctx.moveTo(p.x, p.y); penDown = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Pre-project boundaries for all visible constellations (reused for drawing, edge
  // collection, and label polygon PIP — avoids redundant projection passes).
  const projBounds = {};
  for (const con of visible) {
    const rings = BOUNDS[con.abbr];
    if (!rings) continue;
    projBounds[con.abbr] = rings.map(ring =>
      projectStarsCamera(ring.map(([ra, dec]) => [ra, dec, 0]), camP, camUp, explore.fov, W, H)
    );
  }
  // Collect all visible boundary edges for label collision detection.
  const allBoundEdges = [];
  for (const pRings of Object.values(projBounds)) {
    for (const pts of pRings) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (a.d > 0 && b.d > 0) allBoundEdges.push([a, b]);
      }
    }
  }

  // Boundaries
  if (showBounds) {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,200,120,0.45)';
    ctx.lineWidth = Math.max(1, W / 640);
    const boundsFilter = Array.isArray(explore.bounds) ? explore.bounds : null;
    for (const con of visible) {
      if (boundsFilter && !boundsFilter.includes(con.abbr)) continue;
      const pRings = projBounds[con.abbr];
      if (!pRings) continue;
      for (const pts of pRings) {
        ctx.beginPath();
        let penDown = false;
        for (const p of pts) {
          if (p.d <= 0) { penDown = false; continue; }
          if (!penDown) { ctx.moveTo(p.x, p.y); penDown = true; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Diagram: two-pass so guide lines can sit between diagram lines and stars
  if (showStars || showLines) {
    const diagFilter = Array.isArray(explore.diagram) ? explore.diagram : null;
    // Pass 1: diagram lines only
    for (const con of visible) {
      if (diagFilter && !diagFilter.includes(con.abbr)) continue;
      const dcon = _diagFor(con);
      if (dcon.lines && showLines) {
        const fullProj = projectStarsCamera(dcon.stars, camP, camUp, explore.fov, W, H)
          .map(p => p.d > 0 ? p : null);
        drawLines(ctx, fullProj, dcon);
      }
    }
  }

  // Guide custom lines (above diagram lines, below stars)
  if (explore.guideLinesDef?.length && explore.guideLinesCatalog) {
    const gc = explore.guideLinesColor || 'rgba(80,145,230,0.52)';
    const glw = (explore.guideLinesWidth || 1.5) * (40 / explore.fov);
    ctx.save();
    ctx.strokeStyle = gc;
    ctx.lineWidth = glw;
    ctx.shadowColor = gc;
    ctx.shadowBlur = glw * 6;
    for (const [nameA, nameB] of explore.guideLinesDef) {
      const a = explore.guideLinesCatalog[nameA];
      const b = explore.guideLinesCatalog[nameB];
      if (!a || !b) continue;
      const pts = projectStarsCamera(
        [[a.ra, a.dec, 0], [b.ra, b.dec, 0]],
        camP, camUp, explore.fov, W, H
      );
      if (pts[0].d > 0 && pts[1].d > 0) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Pass 2: stars + labels
  if (showStars || showLines) {
    const diagFilter = Array.isArray(explore.diagram) ? explore.diagram : null;
    for (const con of visible) {
      if (diagFilter && !diagFilter.includes(con.abbr)) continue;
      const dcon = _diagFor(con);
      const proj = projectStarsCamera(dcon.stars, camP, camUp, explore.fov, W, H)
        .map((p, i) => ({ ...p, _orig: dcon.stars[i] }))
        .filter(p => p.d > 0 && Math.abs(p.x - W / 2) < W * 1.5 && Math.abs(p.y - H / 2) < H * 1.5);
      if (showStars) drawStars(ctx, proj, explore.fov);
      if (showStarLabels) drawLabels(ctx, proj, W);
    }
  }

  // Constellation name labels — placement is throttled and cached in RA/dec.
  if (showConNames) {
    const fs = Math.max(9, Math.round(W * 0.02));
    ctx.save();
    ctx.font = `${fs}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(160,185,255,0.6)';
    const namesFilter = Array.isArray(explore.names) ? explore.names : null;
    for (const con of visible) {
      if (namesFilter && !namesFilter.includes(con.abbr)) continue;
      const pos = conNamePosition(con, ctx, fs, camP, camUp, explore.fov, W, H, projBounds, allBoundEdges, showBounds);
      if (!pos) continue;
      const p = projectStarsCamera([[pos.ra, pos.dec, 99]], camP, camUp, explore.fov, W, H)[0];
      if (p && p.d > 0) ctx.fillText(con.name, p.x, p.y);
    }
    ctx.restore();
  }

  // Artwork layer (WebGL)
  const exploreCredit = document.getElementById('explore-art-credit');
  if (showArt) {
    const artFilter = Array.isArray(explore.art) ? explore.art : null;
    let hasArt = false;
    for (const con of visible) {
      if (!ART[con.abbr]) continue;
      if (artFilter && !artFilter.includes(con.abbr)) continue;
      hasArt = true;
      drawExploreArtLayerGL(con, camP, camUp, explore.fov);
    }
    if (exploreCredit) exploreCredit.textContent = hasArt ? 'Art: Johan Meuris / Free Art Licence' : '';
  } else {
    if (exploreCredit) exploreCredit.textContent = '';
  }

  // Quiz: highlight boundaries after answering
  if (explore.quiz && explore.quiz.answered) {
    const { target, clicked } = explore.quiz;
    const lw = Math.max(2, W / 320);
    const drawBoundary = (con, color) => {
      if (!BOUNDS[con.abbr]) return;
      if (angularDist(ra, dec, con.ra, con.dec) > explore.fov / 2 + con.fov / 2 + 10) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      for (const ring of BOUNDS[con.abbr]) {
        const pts = projectStarsCamera(ring.map(([ra, dec]) => [ra, dec, 0]), camP, camUp, explore.fov, W, H);
        ctx.beginPath();
        let penDown = false;
        for (const p of pts) {
          if (p.d <= 0) { penDown = false; continue; }
          if (!penDown) { ctx.moveTo(p.x, p.y); penDown = true; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    };
    if (clicked && clicked.abbr !== target.abbr) drawBoundary(clicked, 'rgba(255,80,80,0.9)');
    drawBoundary(target, 'rgba(100,255,100,0.9)');
    // Diagram and art for the answered state are now checkbox-controlled via
    // showDiag / showArt in the main drawing loops above.
  }

  // Crosshairs at celestial poles
  if (_refAlpha > 0.01) {
    const arm = 0.5 * (3 * celDash + 2 * celGap);
    ctx.save();
    ctx.strokeStyle = `rgba(220,180,80,${0.35 * _refAlpha})`;
    ctx.lineWidth = Math.max(1, W / 640);
    ctx.setLineDash([celDash, celGap]);
    for (const pole of [[0, 0, 1], [0, 0, -1]]) {
      const p = vecToPixel(pole, camP, camUp, explore.fov, W, H);
      if (!p) continue;
      ctx.beginPath();
      ctx.moveTo(p.x - arm, p.y); ctx.lineTo(p.x + arm, p.y);
      ctx.moveTo(p.x, p.y - arm); ctx.lineTo(p.x, p.y + arm);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Compass arrow — N or S depending on hemisphere (fades in/out on interaction)
  const _compassAlpha = _refMode === 'always' ? 0.35 : _refMode === 'moving' ? (explore._northAlpha || 0) * 0.35 : 0;
  if (_compassAlpha > 0.005) {
    const cx = W / 2, cy = H / 2;
    const south = camP[2] < 0; // center point south of celestial equator
    const pole = south ? [0, 0, -1] : [0, 0, 1];
    const s = Math.max(1, W / 640);
    const na = _compassAlpha;
    const label = south ? 'S' : 'N';
    const fs = Math.round(20 * s);
    // Label — always shown upright at center
    ctx.save();
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(220,180,80,${na})`;
    ctx.fillText(label, cx, cy);
    ctx.restore();
    // Arrow — only when pole is far enough from center
    const pp = vecToPixel(pole, camP, camUp, explore.fov, W, H);
    if (pp) {
      const poleDistDeg = Math.acos(Math.max(-1, Math.min(1, south ? -camP[2] : camP[2]))) * 180 / Math.PI;
      if (poleDistDeg > explore.fov * 0.075) {
        const angle = Math.atan2(pp.x - cx, -(pp.y - cy));
        const headW = 6 * s, headL = 20 * s;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        const gap = fs * 0.9;
        ctx.fillStyle = `rgba(220,180,80,${na})`;
        ctx.beginPath();
        ctx.moveTo(0, -gap - headL);
        ctx.lineTo(-headW, -gap);
        ctx.lineTo(headW, -gap);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // Redraw guide annotations so highlights follow drag/zoom
  if (_gs && !_gs.animating) {
    guideDrawAnnotation(_gs.diagVisible ? _gs.steps[_gs.idx] : null, _gs.catalog);
  }
}

function startExploreQuiz() {
  const pool = C.filter(c => BOUNDS[c.abbr]).sort(() => Math.random() - 0.5);
  explore.quiz = { pool, idx: 0, score: 0, total: 0, target: null, answered: false };
  document.getElementById('explore-quiz-bar').style.display = '';
  exState.bounds = true;
  if (_exToggleGroups.layers) _exToggleGroups.layers.setValue('bounds', true);
  localStorage.setItem('ex-bounds', '1');
  nextExploreQuestion();
}

function stopExploreQuiz() {
  explore.quiz = null;
  document.getElementById('explore-quiz-bar').style.display = 'none';
  document.getElementById('find-quiz-hdr').style.display = 'none';
  document.getElementById('find-nav-row').style.display = 'none';
  document.getElementById('explore-free-hdr').style.display = '';
  document.querySelector('.explore-layers').style.display = '';
  drawExplore();
}

function nextExploreQuestion() {
  const q = explore.quiz;
  if (q.idx >= q.pool.length) {
    q.pool.sort(() => Math.random() - 0.5);
    q.idx = 0;
  }
  q.target = q.pool[q.idx++];
  q.answered = false;
  document.getElementById('eq-target-name').textContent = q.target.name;
  document.getElementById('eq-score').textContent = `${q.score} / ${q.total}`;
  document.getElementById('eq-feedback').textContent = '';
  document.getElementById('eq-feedback').className = '';
  document.getElementById('eq-label-area').classList.remove('answered');
  document.getElementById('eq-next').classList.remove('show');
  document.getElementById('eq-reveal-controls').style.display = 'none';
  drawExplore();
}

function handleExploreClick(px, py) {
  const q = explore.quiz;
  if (!q || q.answered) return;
  const canvas = document.getElementById('explore-canvas');
  const W = canvas.width, H = canvas.height;
  const { ra, dec } = vecToRaDec(explore.P);
  const camP = explore.P;
  const camUp = cameraReverse(explore.P, explore.R, [0, 1, 0]);
  // Hit-test in canvas pixel space — avoids RA/Dec wrapping artifacts and TAN
  // projection distortion that cause mismatches between what the user sees and
  // what a sky-coordinate PIP would identify.
  const clicked = C.find(c => {
    if (!BOUNDS[c.abbr]) return false;
    if (angularDist(ra, dec, c.ra, c.dec) > explore.fov / 2 + c.fov / 2 + 8) return false;
    return BOUNDS[c.abbr].some(ring => {
      const pts = projectStarsCamera(ring.map(([ra, dec]) => [ra, dec, 0]), camP, camUp, explore.fov, W, H)
        .filter(p => p.d > 0);
      return pts.length >= 3 && pointInPoly2D(px, py, pts);
    });
  }) || null;
  const correct = clicked && clicked.abbr === q.target.abbr;
  q.answered = true;
  q.clicked = clicked;
  q.total++;
  if (correct) q.score++;
  if (correct && q.lessonMode) {
    session.correct++;
    recordCorrect(q.target.abbr, questionKey({
      type: 'find', mode: q.stageMode, noBounds: q.noBounds
    }));
  }
  if (q.lessonMode) {
    document.getElementById('find-hud-score').textContent = `${session.correct} correct`;
  }
  const fb = document.getElementById('eq-feedback');
  fb.innerHTML = correct
    ? `✓ Correct! — ${conLabel(q.target)}`
    : `✗ That was ${conLabel(clicked || q.target)}`;
  fb.className = correct ? 'correct' : 'wrong';
  document.getElementById('eq-label-area').classList.add('answered');
  document.getElementById('eq-next').classList.add('show');
  document.getElementById('find-help-btn').style.display = 'none';
  // Set reveal defaults and show controls
  eqRevealReset(q.stageMode === 'photo');
  document.getElementById('eq-reveal-controls').style.display = '';
  drawExplore();
}

// ── North arrow fade (used by drag, dial, and zoom) ──────────────
let _northFading = 0, _northFrame = null;
function _northTick() {
  _northFrame = null;
  const target = _northFading > 0 ? 1 : 0;
  const speed = _northFading > 0 ? 0.15 : 0.08;
  explore._northAlpha += (target - explore._northAlpha) * speed;
  if (Math.abs(explore._northAlpha - target) < 0.01) explore._northAlpha = target;
  drawExplore();
  if (explore._northAlpha !== target) _northFrame = requestAnimationFrame(_northTick);
}
function showNorthArrow() {
  _northFading = 1;
  if (!_northFrame) _northFrame = requestAnimationFrame(_northTick);
}
function hideNorthArrow() {
  _northFading = -1;
  if (!_northFrame) _northFrame = requestAnimationFrame(_northTick);
}

// ── Drag & zoom setup (shared by main.js and find-help.html) ──────────────
function initExploreDrag() {
  const ew = document.getElementById('explore-wrap');
  const ec = document.getElementById('explore-canvas');
  let wheelTimer = null;

  function clientToCanvas(cx, cy) {
    const dpr = window.devicePixelRatio || 1;
    const rect = ec.getBoundingClientRect();
    return { px: (cx - rect.left) * dpr, py: (cy - rect.top) * dpr };
  }
  explore._northAlpha = 0;
  function dragStart(cx, cy) {
    if (explore.animFrame) { cancelAnimationFrame(explore.animFrame); explore.animFrame = null; }
    showNorthArrow();
    const { px, py } = clientToCanvas(cx, cy);
    const up0 = cameraReverse(explore.P, explore.R, [0, 1, 0]);
    const vStart = pixelToVec(px, py, explore.P, up0, explore.fov, ec.width, ec.height);
    explore.drag = {
      startPx: px, startPy: py, prevPx: px, prevPy: py, vStart,
      P0: explore.P.slice(), R0: explore.R, up0
    };
    exploreDragMoved = false;
    ew.classList.add('dragging');
  }
  function dragMove(cx, cy) {
    if (!explore.drag) return;
    const { px, py } = clientToCanvas(cx, cy);
    if (!exploreDragMoved) {
      const dx = px - explore.drag.startPx, dy = py - explore.drag.startPy;
      if (Math.sqrt(dx * dx + dy * dy) < 2) return;
      exploreDragMoved = true;
    }
    const { P0, R0, up0, vStart } = explore.drag;
    const S1 = vStart;
    const S2 = pixelToVec(px, py, P0, up0, explore.fov, ec.width, ec.height);
    const P1 = rotateByFromTo(P0, S2, S1);
    const ax = S1[1]*S2[2]-S1[2]*S2[1], ay = S1[2]*S2[0]-S1[0]*S2[2], az = S1[0]*S2[1]-S1[1]*S2[0];
    const crossLen = Math.sqrt(ax*ax + ay*ay + az*az);
    let R1;
    if (crossLen < 1e-10) {
      R1 = R0;
    } else {
      const A = [ax/crossLen, ay/crossLen, az/crossLen];
      const theta = Math.acos(Math.max(-1, Math.min(1, S1[0]*S2[0]+S1[1]*S2[1]+S1[2]*S2[2])));
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
  function dragEnd() {
    explore.drag = null;
    ew.classList.remove('dragging');
    hideNorthArrow();
    if (typeof saveExploreState === 'function') saveExploreState();
    drawExplore();
  }

  ec.addEventListener('contextmenu', e => e.preventDefault());
  ec.addEventListener('mousedown', e => dragStart(e.clientX, e.clientY));
  window.addEventListener('mousemove', e => dragMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', dragEnd);
  ec.addEventListener('click', e => {
    if (!explore.quiz || explore.quiz.answered || exploreDragMoved) return;
    const { px, py } = clientToCanvas(e.clientX, e.clientY);
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
      dragEnd();
      pinchStartDist = touchDist(e.touches);
      pinchStartFov = explore.fov;
    } else {
      pinchStartDist = null;
      dragStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });
  ec.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && pinchStartDist) {
      showNorthArrow();
      const dist = touchDist(e.touches);
      explore.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, pinchStartFov * pinchStartDist / dist));
      drawExplore();
    } else if (e.touches.length === 1) {
      dragMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });
  ec.addEventListener('touchend', e => {
    if (pinchStartDist && e.touches.length < 2) {
      pinchStartDist = null;
      hideNorthArrow();
      if (typeof saveExploreState === 'function') saveExploreState();
      return;
    }
    dragEnd();
    if (explore.quiz && !explore.quiz.answered && !exploreDragMoved && e.changedTouches.length) {
      const t = e.changedTouches[0];
      const { px, py } = clientToCanvas(t.clientX, t.clientY);
      handleExploreClick(px, py);
    }
  });
  ec.addEventListener('wheel', e => {
    e.preventDefault();
    showNorthArrow();
    const factor = e.ctrlKey ? Math.pow(1.03, e.deltaY) : Math.pow(1.003, e.deltaY);
    explore.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, explore.fov * factor));
    drawExplore();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { hideNorthArrow(); if (typeof saveExploreState === 'function') saveExploreState(); drawExplore(); }, 300);
  }, { passive: false });

  return { clientToCanvas };
}
