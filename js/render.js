// ═══════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════

const artCache = {};  // abbr -> HTMLImageElement | 'loading' | 'error'

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

function drawStars(ctx, proj) {
  for (const p of proj) {
    const r = magToR(p.mag), col = starCol(p.hint);
    if (p.mag < 2.5) {
      const gs = p.mag < 0 ? 26 : p.mag < 1 ? 18 : p.mag < 2 ? 13 : 8;
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gs);
      const hx = col.replace('#', '');
      const ri = parseInt(hx.slice(0, 2), 16), gi = parseInt(hx.slice(2, 4), 16), bi = parseInt(hx.slice(4, 6), 16);
      grd.addColorStop(0, `rgba(${ri},${gi},${bi},0.28)`);
      grd.addColorStop(1, `rgba(${ri},${gi},${bi},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x, p.y, gs, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = p.mag < 2 ? 8 : p.mag < 3 ? 4 : 2;
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

  let order = 0;
  for (const p of named) {
    order++;
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

    let best = candidates[0], bestIdx = 0, testedCount = 1;
    for (let i = 0; i < candidates.length; i++) {
      const [cx, cy] = candidates[i];
      if (!overlaps(cx, cy, lw, lh)) { best = candidates[i]; bestIdx = i; break; }
      testedCount = i + 1; // this one was rejected; keep counting
    }

    if (debugLabels) {
      // Draw only tested candidates: green=chosen, red=rejected
      candidates.slice(0, testedCount).forEach(([cx, cy], i) => {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = (i === bestIdx) ? '#00ff44' : '#ff3333';
        ctx.beginPath(); ctx.arc(cx + lw / 2, cy + lh / 2, 5, 0, Math.PI * 2); ctx.fill();
      });
      // Draw label bounding box
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(best[0], best[1], lw, lh);
      // Draw placement order
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffff00';
      ctx.font = `bold ${Math.round(fs * 0.7)}px system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(order), p.x, p.y - r - 6);
      ctx.font = `${fs}px system-ui,-apple-system,sans-serif`;
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
  const proj = projectStarsTAN(con.stars, con, W, H);
  if (mode === 'diagram' || mode === 'reveal') drawLines(ctx, proj, con);
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
    if (session.pool[session.idx] === con && session.answered)
      drawArtwork(canvas, con, img, showLabels);
  };
  img.onerror = () => { artCache[src] = 'error'; };
  img.src = art.url;
}

// drawArtwork: composites the artwork image over the existing canvas content.
// angle (radians): if set, rotate anchor points around canvas centre so the
// artwork follows the same rotation as the rest of the scene.
function drawArtwork(canvas, con, img, showLabels = false, angle = 0) {
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

  const creditEl = document.getElementById('art-credit');
  if (creditEl) creditEl.innerHTML = 'Art: Johan Meuris<br>Free Art Licence';

  if (debugAnchors) {
    const r = Math.max(6, W * 0.012);
    const fs = Math.max(10, Math.round(W * 0.03));
    // Use identity transform — dstPts are already in screen pixel coords
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    dstPts.forEach(([x, y], i) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff0';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ff0';
      ctx.font = `bold ${fs}px system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y);
    });
    ctx.restore();
  }
}

function showPhotoMode(con, angle = 0) {
  const canvas = document.getElementById('quiz-canvas');
  const box = document.getElementById('photo-box');
  const img = document.getElementById('photo-img');
  const msg = document.getElementById('photo-msg');

  canvas.style.display = 'none';
  box.classList.add('show');
  msg.style.display = 'none';
  img.classList.add('show');
  img.src = photoUrl(con);
  img.style.transform = angle ? `rotate(${angle}rad)` : '';
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

function redrawReveal(con) {
  const origAbbr = con.abbr;
  if (session.viewMode) con = tweakedCon(con);
  const showBound = document.getElementById('chk-rev-boundary').checked;
  const showDiag = document.getElementById('chk-rev-diagram').checked;
  const showArt = document.getElementById('chk-rev-artwork').checked;
  const creditEl = document.getElementById('art-credit');
  if (creditEl) creditEl.textContent = '';
  const canvas = document.getElementById('quiz-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const artImg = artCache[artSrc(origAbbr)] instanceof HTMLImageElement ? artCache[artSrc(origAbbr)] : null;

  const angle = session.rotation || 0;
  if (angle) {
    ctx.save();
    ctx.translate(W/2, H/2);
    ctx.rotate(angle);
    ctx.translate(-W/2, -H/2);
  }

  let revealProj = null;
  // Background
  if (settings.mode === 'photo') {
    ctx.drawImage(document.getElementById('photo-img'), 0, 0, W, H);
  } else {
    drawBackground(ctx, W, H, con, settings.mode === 'stars');
  }

  // Artwork overlay — same for all modes
  if (showArt && artImg) drawArtwork(canvas, con, artImg, false, angle);

  // Lines and stars
  revealProj = projectStarsTAN(con.stars, con, W, H);
  if (showDiag) drawLines(ctx, revealProj, con);
  if (settings.mode !== 'photo' || showDiag) drawStars(ctx, revealProj);

  // Boundary overlay — draw all visible constellation boundaries
  // Also collect label positions for visible neighbors.
  // A neighbor is "visible" only if its area actually intersects the circle:
  // we gather boundary points inside the circle plus circle-edge intersections.
  const R = W / 2, cirCx = W / 2, cirCy = H / 2;
  const neighborLabelPts = [];
  if (showBound) {
    ctx.save();
    for (const [abbr, rings] of Object.entries(BOUNDS)) {
      const isCurrent = abbr === origAbbr;
      ctx.strokeStyle = isCurrent ? 'rgba(120,200,120,0.65)' : 'rgba(120,200,120,0.28)';
      ctx.lineWidth = isCurrent ? 1.5 : 1;

      // Project all rings once; also collect per-ring visible-point arrays for PIP fallback.
      const projRings = rings.map(ring =>
        projectStarsTAN(ring.map(([ra, dec]) => [ra, dec, 0]), con, W, H));

      // Draw boundary segments (only where d>0).
      let anySegVisible = false;
      for (const pts of projRings) {
        const visCount = pts.reduce((n, p) => n + (p.d > 0 ? 1 : 0), 0);
        if (visCount < 2) continue;
        anySegVisible = true;
        ctx.beginPath();
        let prevVis = false;
        for (const p of pts) {
          if (p.d > 0) {
            if (!prevVis) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            prevVis = true;
          } else {
            prevVis = false;
          }
        }
        if (pts[0].d > 0 && pts[pts.length - 1].d > 0) ctx.closePath();
        ctx.stroke();
      }

      if (isCurrent) continue;

      // Collect points that define the visible intersection with the circle:
      // boundary points inside the circle + where edges cross the circle edge.
      const intPts = [];
      for (const pts of projRings) {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const q = pts[(i + 1) % pts.length];
          if (p.d > 0) {
            const dx = p.x - cirCx, dy = p.y - cirCy;
            if (dx * dx + dy * dy <= R * R) intPts.push({ x: p.x, y: p.y });
          }
          if (p.d > 0 && q.d > 0) {
            for (const ip of segCircleIntersections(p.x, p.y, q.x, q.y, cirCx, cirCy, R))
              intPts.push(ip);
          }
        }
      }

      // Fallback: constellation surrounds the view — circle center is inside its boundary.
      if (intPts.length === 0) {
        for (const pts of projRings) {
          const visPts = pts.filter(p => p.d > 0);
          if (visPts.length >= 3 && pointInPoly2D(cirCx, cirCy, visPts)) {
            // Push several points spread around the circle interior to get a
            // centroid near the ring's visible centroid (not the canvas center).
            let sx = 0, sy = 0;
            for (const p of visPts) { sx += p.x; sy += p.y; }
            intPts.push({ x: sx / visPts.length, y: sy / visPts.length });
            break;
          }
        }
      }

      if (intPts.length === 0) continue;

      const neighbor = C.find(c => c.abbr === abbr);
      if (!neighbor) continue;

      // Label position: centroid of intersection points, clamped inside the circle.
      let lx = intPts.reduce((s, p) => s + p.x, 0) / intPts.length;
      let ly = intPts.reduce((s, p) => s + p.y, 0) / intPts.length;
      const ddx = lx - cirCx, ddy = ly - cirCy;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      const margin = Math.max(10, W * 0.04); // keep label inside circle by this much
      if (dist + margin > R) {
        const scale = (R - margin) / Math.max(dist, 1);
        lx = cirCx + ddx * scale;
        ly = cirCy + ddy * scale;
      }
      neighborLabelPts.push({ name: neighbor.name, x: lx, y: ly });
    }
    ctx.restore();
  }

  if (angle) ctx.restore();

  // Star labels after rotation restore so text stays upright
  if (showDiag && revealProj) drawLabels(ctx, rotateProj(revealProj, angle, W, H), W);

  // Neighbor constellation labels (after rotation restore, text stays upright).
  // Convert canvas-space label positions to screen space via rotation.
  if (neighborLabelPts.length > 0) {
    const fs = Math.max(9, Math.round(W * 0.026));
    ctx.save();
    ctx.font = `${fs}px system-ui,-apple-system,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(140,210,140,0.75)';
    for (const lbl of neighborLabelPts) {
      const sp = rotateProj([lbl], angle, W, H)[0];
      ctx.fillText(lbl.name, sp.x, sp.y);
    }
    ctx.restore();
  }
}

function ensureArtLoaded(con) {
  const src = artSrc(con.abbr);
  const art = ART[src];
  if (!art || artCache[src]) return;
  artCache[src] = 'loading';
  const img = new Image();
  img.onload = () => {
    artCache[src] = img;
    if (session.pool[session.idx] === con && session.answered) redrawReveal(con);
  };
  img.onerror = () => { artCache[src] = 'error'; };
  img.src = art.url;
}

function startReveal(con) {
  // For photo mode, swap photo-box → canvas
  if (settings.mode === 'photo') {
    document.getElementById('photo-box').classList.remove('show');
    const img = document.getElementById('photo-img');
    img.classList.remove('show');
    img.style.transform = '';
    document.getElementById('quiz-canvas').style.display = 'block';
  }
  // Show/hide checkboxes
  const artChk = document.getElementById('chk-rev-artwork').closest('label');
  artChk.style.display = ART[artSrc(con.abbr)] ? '' : 'none';
  const boundChk = document.getElementById('chk-rev-boundary').closest('label');
  boundChk.style.display = BOUNDS[con.abbr] ? '' : 'none';
  document.getElementById('reveal-controls').classList.add('show');
  redrawReveal(con);
  ensureArtLoaded(con);
}

function conLabel(con) {
  const hem = con.hem === 'N' ? 'northern' : con.hem === 'S' ? 'southern' : 'equatorial';
  const meaning = con.meaning ? `, ${con.meaning}` : '';
  const link = `<a href="#" class="con-info-link" data-abbr="${con.abbr}">${con.name}</a>`;
  return `${link}${meaning} (${hem})`;
}
