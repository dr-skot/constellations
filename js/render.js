// ═══════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════

const artCache = {};  // abbr -> HTMLImageElement | 'loading' | 'error'

// ── Reveal controls state ──
// The quiz's layer choices, persisted with its lesson session. The buttons that
// drive them belong to the panel showing the reveal (js/reveal-panel.js); the
// constellation viewer will keep its own state rather than share this one (#73).
const revState = { photo: true, diagram: true, art: true, boundary: true };

function drawBackground(ctx, W, H, con, starField) {
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
  bg.addColorStop(0, '#0b0e1e'); bg.addColorStop(1, '#020408');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (!starField) return;
  const rng = makeRng(hashStr(con.name + '-bg'));
  ctx.save();
  for (let i = 0; i < 180; i++) {
    const bx = rng() * W, by = rng() * H, m = 3.8 + rng() * 3;
    const r = Math.max(.2, 1.2 - m * .15);
    ctx.globalAlpha = .12 + rng() * .45;
    ctx.fillStyle = rng() > .8 ? 'rgba(160,190,255,1)' : 'rgba(210,218,255,1)';
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.restore();
}

function drawLines(ctx, proj, con) {
  ctx.save();
  ctx.strokeStyle = 'rgba(80,145,230,0.52)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(100,160,255,0.4)';
  ctx.shadowBlur = 5;
  for (const [i, j] of con.lines) {
    const a = proj[i], b = proj[j];
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawStars(ctx, proj, fov) {
  const REF_FOV = 40;
  const s = fov ? REF_FOV / fov : 1;
  for (const p of proj) {
    const r = magToR(p.mag) * s, col = starCol(p.hint);
    if (p.mag < 2.5) {
      const gs = (p.mag < 0 ? 26 : p.mag < 1 ? 18 : p.mag < 2 ? 13 : 8) * s;
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gs);
      const hx = col.replace('#', '');
      const ri = parseInt(hx.slice(0, 2), 16), gi = parseInt(hx.slice(2, 4), 16), bi = parseInt(hx.slice(4, 6), 16);
      grd.addColorStop(0, `rgba(${ri},${gi},${bi},0.28)`);
      grd.addColorStop(1, `rgba(${ri},${gi},${bi},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x, p.y, gs, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = (p.mag < 2 ? 8 : p.mag < 3 ? 4 : 2) * s;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawLabels(ctx, proj, W) {
  const fs = Math.max(10, Math.round(W * 0.036));
  ctx.save();
  ctx.font = `${fs}px system-ui,-apple-system,sans-serif`;
  ctx.textBaseline = 'middle';

  // Candidate offsets: [dx-fraction-of-label-width, dy-fraction-of-label-height]
  // relative to star edge; order = preference
  const H = W; // canvas is square
  const placed = []; // {x,y,w,h} of already-placed labels

  function overlaps(ax, ay, aw, ah) {
    for (const b of placed) {
      if (ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y) return true;
    }
    return false;
  }

  // Sort: brightest stars first so their labels get priority placement
  const named = [...proj].filter(p => p.name).sort((a, b) => a.mag - b.mag);

  for (const p of named) {
    const col = starCol(p.hint), r = magToR(p.mag), pad = 3;
    const tw = ctx.measureText(p.name).width, th = fs;
    const lw = tw + pad * 2, lh = th + pad * 2;
    const gap = r + 5;

    // 8 candidate positions around the star (anchor = top-left of label box)
    const candidates = [
      [p.x + gap, p.y - lh / 2],  // right
      [p.x + gap, p.y - lh - gap / 2],  // upper-right
      [p.x + gap, p.y + gap / 2],  // lower-right
      [p.x - gap - lw, p.y - lh / 2],  // left
      [p.x - gap - lw, p.y - lh - gap / 2],  // upper-left
      [p.x - gap - lw, p.y + gap / 2],  // lower-left
      [p.x - lw / 2, p.y - gap - lh],  // above
      [p.x - lw / 2, p.y + gap],  // below
    ];

    let best = candidates[0];
    for (let i = 0; i < candidates.length; i++) {
      const [cx, cy] = candidates[i];
      if (!overlaps(cx, cy, lw, lh)) { best = candidates[i]; break; }
    }


    const [lx, ly] = best;
    placed.push({ x: lx, y: ly, w: lw, h: lh });
    ctx.fillStyle = col; ctx.globalAlpha = 0.92; ctx.textAlign = 'left';
    ctx.fillText(p.name, lx + pad, ly + pad + th / 2);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// Return a copy of proj with positions rotated by angle around canvas centre.
function rotateProj(proj, angle, W, H) {
  if (!angle) return proj;
  const cx = W / 2, cy = H / 2;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  return proj.map(p => ({
    ...p,
    x: cx + (p.x - cx) * cosA - (p.y - cy) * sinA,
    y: cy + (p.x - cx) * sinA + (p.y - cy) * cosA,
  }));
}

function renderCanvas(canvas, con, mode, showLabels = false, angle = 0) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const starField = mode === 'stars' || mode === 'reveal';
  if (angle) {
    ctx.save();
    ctx.translate(W/2, H/2);
    ctx.rotate(angle);
    ctx.translate(-W/2, -H/2);
  }
  drawBackground(ctx, W, H, con, starField);
  // Draw the selected star-figure (dcon); frame it with con (the master catalog).
  const dcon = diagramFor(con, diagramSource);
  const proj = projectStarsTAN(dcon.stars, con, W, H);
  if (mode === 'diagram' || mode === 'reveal') drawLines(ctx, proj, dcon);
  drawStars(ctx, proj);
  if (angle) ctx.restore();
  // Draw labels after restoring rotation so text stays upright
  if (mode === 'reveal' || showLabels) drawLabels(ctx, rotateProj(proj, angle, W, H), W);
}

// showArtworkMode: overlay artwork on top of whatever is already on the canvas.
// showLabels=true draws star name labels after the artwork is composited.
function showArtworkMode(canvas, con, showLabels = false) {
  const src = artSrc(con.abbr);
  const art = ART[src];
  if (!art) return;

  if (artCache[src] instanceof HTMLImageElement) {
    drawArtwork(canvas, con, artCache[src], showLabels);
    return;
  }
  if (artCache[src] === 'loading' || artCache[src] === 'error') return;

  artCache[src] = 'loading';
  const img = new Image();
  img.onload = () => {
    artCache[src] = img;
    if (currentCon() === con && session.answered)
      drawArtwork(canvas, con, img, showLabels);
  };
  img.onerror = () => { artCache[src] = 'error'; };
  img.src = art.url;
}

// drawArtwork: composites the artwork image over the existing canvas content.
// angle (radians): if set, rotate anchor points around canvas centre so the
// artwork follows the same rotation as the rest of the scene.
// creditEl belongs to the panel that owns the canvas (js/reveal-panel.js) — the credit
// has to land next to the artwork it credits, and a panel is what knows where that is.
function drawArtwork(canvas, con, img, showLabels = false, angle = 0, creditEl = null) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const art = ART[artSrc(con.abbr)];

  const canvasPts = projectStarsTAN(art.anchors.map(a => [a.ra, a.dec, 0]), con, W, H).map(p => ({ x: p.x, y: p.y }));
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const imgPts = art.anchors.map(a => [a.px * iw, a.py * ih]);
  let dstPts = canvasPts.map(p => [p.x, p.y]);

  if (angle) {
    const cx = W / 2, cy = H / 2;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    dstPts = dstPts.map(([x, y]) => [
      cx + (x - cx) * cosA - (y - cy) * sinA,
      cy + (x - cx) * sinA + (y - cy) * cosA,
    ]);
  }

  const xform = solveAffine(imgPts, dstPts);

  ctx.save();
  ctx.setTransform(...xform);
  ctx.globalAlpha = 0.60;
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(img, 0, 0, iw, ih);
  ctx.restore();

  if (showLabels) {
    const starProj = projectStarsTAN(con.stars, con, W, H);
    drawLabels(ctx, starProj, W);
  }

  if (creditEl) creditEl.innerHTML = 'Art: Johan Meuris<br>Free Art Licence';
}

// A photo-mode question: the photograph itself, shown in front of the canvas rather
// than painted into it, so it can be rotated by CSS. The elements come from the panel
// that owns them (js/reveal-panel.js).
function showPhotoMode(con, angle = 0, panel) {
  const canvas = panel.canvas;
  const box = panel.photoBox;
  const img = panel.photoImg;
  const msg = panel.photoMsg;

  canvas.style.display = 'none';
  box.classList.add('show');
  msg.style.display = 'none';
  img.classList.add('show');
  img.src = photoUrl(con);
  img.style.transform = angle ? `rotate(${angle}rad)` : '';
}

// Returns true if segments (ax,ay)-(bx,by) and (cx,cy)-(dx,dy) intersect.
function segSegIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx-ax, d1y = by-ay, d2x = dx-cx, d2y = dy-cy;
  const denom = d1x*d2y - d1y*d2x;
  if (Math.abs(denom) < 1e-10) return false;
  const t = ((cx-ax)*d2y - (cy-ay)*d2x) / denom;
  const u = ((cx-ax)*d1y - (cy-ay)*d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// Returns true if any edge in `edges` (array of [{x,y},{x,y}] pairs) intersects
// the axis-aligned rectangle [x1,x2]×[y1,y2].
function edgesHitRect(edges, x1, y1, x2, y2) {
  for (const [a, b] of edges) {
    const ax = a.x, ay = a.y, bx = b.x, by = b.y;
    if (ax>=x1&&ax<=x2&&ay>=y1&&ay<=y2) return true;
    if (bx>=x1&&bx<=x2&&by>=y1&&by<=y2) return true;
    if (segSegIntersect(ax,ay,bx,by, x1,y1,x2,y1)) return true;
    if (segSegIntersect(ax,ay,bx,by, x2,y1,x2,y2)) return true;
    if (segSegIntersect(ax,ay,bx,by, x2,y2,x1,y2)) return true;
    if (segSegIntersect(ax,ay,bx,by, x1,y2,x1,y1)) return true;
  }
  return false;
}

// Returns intersection points of segment (x1,y1)→(x2,y2) with circle (cx,cy,R).
function segCircleIntersections(x1, y1, x2, y2, cx, cy, R) {
  const dx = x2 - x1, dy = y2 - y1;
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-10) return [];
  const sq = Math.sqrt(disc);
  return [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]
    .filter(t => t >= 0 && t <= 1)
    .map(t => ({ x: x1 + t * dx, y: y1 + t * dy }));
}

// 2-D ray-cast point-in-polygon using projected canvas points.
function pointInPoly2D(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// ── Label placement ──────────────────────────────────────────────────────────
// Shared machinery for dropping a text label where it clears constellation
// boundaries. Two callers: conNamePosition (explore.js — a constellation's own
// name, canvas space) and findNeighborLabelSpot (below — neighbor names in the
// rotated quiz reveal). See CONTEXT.md "label placement".

// Does an hw×hh label box centred at (cx,cy) satisfy the polygon/edge
// constraints? Samples the centre + 4 corners; every sample must lie inside
// `inside` (when given) and outside `outside` (when given), and the box rect must
// not be crossed by any of `edges`. Pure — the caller owns any bounds-shape test
// and coordinate transform (it passes already-transformed cx,cy).
function fitLabelBox(cx, cy, hw, hh, { inside, outside, edges } = {}) {
  const x1 = cx - hw, x2 = cx + hw, y1 = cy - hh, y2 = cy + hh;
  for (const [px, py] of [[cx,cy],[x1,y1],[x2,y1],[x1,y2],[x2,y2]]) {
    if (inside && !pointInPoly2D(px, py, inside)) return false;
    if (outside && pointInPoly2D(px, py, outside)) return false;
  }
  if (edges && edges.length && edgesHitRect(edges, x1, y1, x2, y2)) return false;
  return true;
}

// Search for a label spot: try each `preScan` point in order, then walk rings of
// 16 evenly-spaced angles at each radius in `radii` (in the given order) around
// `center`. Returns the first {x,y} for which valid(x,y) holds, else null.
function searchLabelSpot(preScan, center, radii, valid) {
  for (const p of preScan) if (valid(p.x, p.y)) return { x: p.x, y: p.y };
  for (const r of radii) {
    for (let ai = 0; ai < 16; ai++) {
      const x = center.x + Math.cos(ai * Math.PI / 8) * r;
      const y = center.y + Math.sin(ai * Math.PI / 8) * r;
      if (valid(x, y)) return { x, y };
    }
  }
  return null;
}

// Place a neighbor constellation's name in the circular, rotated quiz-reveal
// view. All points are screen-space 2D (already projected). `view` carries the
// per-reveal geometry: circle centre (cx,cy) + radius R, rotation (cosA,sinA),
// the current constellation's polygon (currentPts), and every visible boundary
// edge (edges). The label must sit inside the neighbor's polygon, outside the
// current one, clear of all edges, and within the circle. Pre-scans along the
// hint direction, then spirals inward. Returns {x,y} in canvas space, or null.
function findNeighborLabelSpot(view, neighborPts, hint, box) {
  const { cx, cy, R, cosA, sinA, currentPts, edges } = view;
  const { hw, hh } = box;
  const inside = neighborPts.length >= 3 ? neighborPts : null;
  const outside = currentPts.length >= 3 ? currentPts : null;

  const valid = (tx, ty) => {
    const dx = tx - cx, dy = ty - cy;
    if (dx * dx + dy * dy > (R - hw) * (R - hw)) return false;
    const sx = cx + dx * cosA - dy * sinA;
    const sy = cy + dx * sinA + dy * cosA;
    return fitLabelBox(sx, sy, hw, hh, { inside, outside, edges });
  };

  const preScan = [];
  const hl = Math.sqrt(hint.dx * hint.dx + hint.dy * hint.dy);
  if (hl > 1) {
    for (let t = 0.08; t <= 0.93; t += 0.03) {
      preScan.push({ x: cx + (hint.dx / hl) * R * t, y: cy + (hint.dy / hl) * R * t });
    }
  }
  const radii = [];
  for (let ri = 5; ri >= 1; ri--) radii.push(R * 0.88 * ri / 5);

  return searchLabelSpot(preScan, { x: cx, y: cy }, radii, valid);
}

// Place the course-screen card-anchored detail popover (issue #22). Pure geometry:
//   card: { left, top, width, height, vBottom } — the tapped card's box in the same
//         coordinate space the popover is positioned in (viewport space for a
//         position:fixed popover); vBottom is the card's bottom edge, and with
//         viewportHeight it decides the flip.
//   pop:  { width, height } — the measured popover box.
//   vp:   { containerWidth, viewportHeight } — the bounds the popover must stay within.
//   opts: gap between card and popover, pad (inner arrow margin), minArrow,
//         arrowHalf (half the arrow width), minTop (top clamp when flipped above).
// Returns { left, top, above, arrow }: the popover opens below the card by default
// and flips above when opening below would spill past the viewport bottom; left is
// clamped so the popover stays within the container; arrow is the caret's offset
// from the popover's left, kept pointing at the card's centre after clamping.
function popoverPosition(card, pop, vp, opts = {}) {
  const gap = opts.gap ?? 8, pad = opts.pad ?? 24,
        minArrow = opts.minArrow ?? 12, arrowHalf = opts.arrowHalf ?? 6,
        minTop = opts.minTop ?? 4;
  const left = Math.max(0, Math.min(card.left, vp.containerWidth - pop.width));
  const arrow = Math.min(Math.max(card.left - left + card.width / 2 - arrowHalf, minArrow), pop.width - pad);
  const below = card.vBottom + gap + pop.height <= vp.viewportHeight;
  const top = below ? card.top + card.height + gap
                    : Math.max(minTop, card.top - pop.height - gap);
  return { left, top, above: !below, arrow };
}

// Paint a reveal into a panel's elements. `intent` is the caller's half of the
// decision — which layers, which quiz mode, what rotation, which star-figure set —
// and this adds the half only the painter knows: whether the photograph and the
// artwork have actually loaded. resolveReveal (js/reveal.js) merges them into the
// flags below. Which reveal is on screen, and what to do when a late image lands,
// belong to the panel (js/reveal-panel.js), not here.
function paintReveal({ canvas, photoImg, creditEl }, con, intent) {
  const origAbbr = con.abbr;
  if (creditEl) creditEl.textContent = '';
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const artImg = artCache[artSrc(origAbbr)] instanceof HTMLImageElement ? artCache[artSrc(origAbbr)] : null;

  const reveal = resolveReveal({
    layers: intent.layers,
    mode: intent.mode,
    rotation: intent.rotation,
    source: intent.source,
    photoReady: !!(photoImg && photoImg.complete && photoImg.naturalWidth > 0),
    artReady: !!artImg,
  });

  const showBound = reveal.showBounds;
  const showDiag = reveal.showLines;

  const angle = reveal.rotation;
  if (angle) {
    ctx.save();
    ctx.translate(W/2, H/2);
    ctx.rotate(angle);
    ctx.translate(-W/2, -H/2);
  }

  let revealProj = null;
  // Background
  if (reveal.background === 'photo') {
    ctx.drawImage(photoImg, 0, 0, W, H);
  } else {
    drawBackground(ctx, W, H, con, reveal.background === 'stars');
  }

  // Artwork overlay — same for all modes
  if (reveal.showArt) drawArtwork(canvas, con, artImg, false, angle, creditEl);

  // Lines and stars — selected star-figure (dcon), framed by con.
  const dcon = diagramFor(con, reveal.source);
  revealProj = projectStarsTAN(dcon.stars, con, W, H);
  if (showDiag) drawLines(ctx, revealProj, dcon);
  if (reveal.showStars) drawStars(ctx, revealProj);

  // Boundary overlay — draw all visible constellation boundaries and label neighbors.
  const R = W / 2, cirCx = W / 2, cirCy = H / 2;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);

  // Canvas → screen conversion (rotation around canvas centre).
  function ptToScr(p) {
    const dx = p.x - cirCx, dy = p.y - cirCy;
    return { x: cirCx + dx * cosA - dy * sinA, y: cirCy + dx * sinA + dy * cosA };
  }

  // Pre-project the current constellation's boundary for PIP + edge checks.
  const curProjRings = (BOUNDS[origAbbr] || []).map(ring =>
    projectStarsTAN(ring.map(([ra, dec]) => [ra, dec, 0]), con, W, H));
  const curVisPts  = curProjRings.flat().filter(p => p.facing > 0);
  const curScrPts  = curVisPts.map(ptToScr);

  // Per-reveal geometry shared by every neighbor label placement (see
  // findNeighborLabelSpot). allScrEdges is filled during Pass 1 below; the
  // labels are placed in Pass 2 once it is complete.
  const labelView = { cx: cirCx, cy: cirCy, R, cosA, sinA, currentPts: curScrPts, edges: null };

  // ── Pass 1: draw boundaries, collect all screen-space edges + label candidates ──
  const allScrEdges = [];     // every visible boundary edge in screen coords
  const labelCandidates = []; // deferred label placement data

  const neighborLabelPts = [];
  if (showBound) {
    ctx.save();
    for (const [abbr, rings] of Object.entries(BOUNDS)) {
      const isCurrent = abbr === origAbbr;
      ctx.strokeStyle = isCurrent ? 'rgba(120,200,120,0.65)' : 'rgba(120,200,120,0.28)';
      ctx.lineWidth = isCurrent ? 1.5 : 1;

      const projRings = rings.map(ring =>
        projectStarsTAN(ring.map(([ra, dec]) => [ra, dec, 0]), con, W, H));

      for (const pts of projRings) {
        const visCount = pts.reduce((n, p) => n + (p.facing > 0 ? 1 : 0), 0);
        if (visCount < 2) continue;

        // Draw.
        ctx.beginPath();
        let prevVis = false;
        for (const p of pts) {
          if (p.facing > 0) {
            if (!prevVis) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            prevVis = true;
          } else { prevVis = false; }
        }
        if (pts[0].facing > 0 && pts[pts.length - 1].facing > 0) ctx.closePath();
        ctx.stroke();

        // Collect screen-space edges for label collision checking.
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if (a.facing > 0 && b.facing > 0) allScrEdges.push([ptToScr(a), ptToScr(b)]);
        }
      }

      if (isCurrent) continue;

      // Determine hint direction: centroid of boundary points inside the circle
      // + circle-edge crossings (i.e. where this neighbor is visible).
      const intPts = [];
      for (const pts of projRings) {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          if (p.facing > 0) {
            const dx = p.x - cirCx, dy = p.y - cirCy;
            if (dx * dx + dy * dy <= R * R) intPts.push({ x: p.x, y: p.y });
          }
          if (p.facing > 0 && q.facing > 0)
            for (const ip of segCircleIntersections(p.x, p.y, q.x, q.y, cirCx, cirCy, R))
              intPts.push(ip);
        }
      }

      const surrounds = intPts.length === 0 && projRings.some(pts => {
        const vp = pts.filter(p => p.facing > 0);
        return vp.length >= 3 && pointInPoly2D(cirCx, cirCy, vp);
      });
      if (intPts.length === 0 && !surrounds) continue;

      const neighbor = C.find(c => c.abbr === abbr);
      if (!neighbor) continue;

      const hintX = intPts.length > 0 ? intPts.reduce((s, p) => s + p.x, 0) / intPts.length : cirCx;
      const hintY = intPts.length > 0 ? intPts.reduce((s, p) => s + p.y, 0) / intPts.length : cirCy;

      const fs = Math.max(9, Math.round(W * 0.026));
      const nScrPts = projRings.flat().filter(p => p.facing > 0).map(ptToScr);
      labelCandidates.push({
        name: neighbor.name, nScrPts,
        hintDx: hintX - cirCx, hintDy: hintY - cirCy,
        hw: neighbor.name.length * fs * 0.32, hh: fs * 0.65,
      });
    }
    ctx.restore();

    // ── Pass 2: place labels now that allScrEdges is complete ──
    labelView.edges = allScrEdges;
    for (const cand of labelCandidates) {
      const pt = findNeighborLabelSpot(labelView, cand.nScrPts, { dx: cand.hintDx, dy: cand.hintDy }, { hw: cand.hw, hh: cand.hh });
      if (pt) neighborLabelPts.push({ name: cand.name, x: pt.x, y: pt.y });
    }
  }

  if (angle) ctx.restore();

  // Star labels after rotation restore so text stays upright.
  if (reveal.showStarLabels && revealProj) drawLabels(ctx, rotateProj(revealProj, angle, W, H), W);

  // Neighbor labels — already in canvas space; convert to screen for drawing.
  if (neighborLabelPts.length > 0) {
    const fs = Math.max(9, Math.round(W * 0.026));
    ctx.save();
    ctx.font = `${fs}px system-ui,-apple-system,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(140,210,140,0.5)';
    for (const lbl of neighborLabelPts) {
      const sp = rotateProj([lbl], angle, W, H)[0];
      ctx.fillText(lbl.name, sp.x, sp.y);
    }
    ctx.restore();
  }
}

// Load a constellation's artwork once, and tell the caller when it lands — the
// caller being the panel, which knows whether the reveal it belongs to is still on
// screen. Artwork that arrives after the learner has moved on must not paint over
// what replaced it.
function ensureArtLoaded(con, onLoaded) {
  const src = artSrc(con.abbr);
  const art = ART[src];
  if (!art || artCache[src]) return;
  artCache[src] = 'loading';
  const img = new Image();
  img.onload = () => {
    artCache[src] = img;
    if (onLoaded) onLoaded();
  };
  img.onerror = () => { artCache[src] = 'error'; };
  img.src = art.url;
}

function conLabel(con) {
  const hem = con.hem === 'N' ? 'northern' : con.hem === 'S' ? 'southern' : 'equatorial';
  const meaning = con.meaning ? `, ${con.meaning}` : '';
  const link = `<a href="#" class="con-info-link" data-abbr="${con.abbr}">${con.name}</a>`;
  return `${link}${meaning} (${hem})`;
}
