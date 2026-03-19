// ═══════════════════════════════════════════════════════════
// EXPLORE MODE
// ═══════════════════════════════════════════════════════════
const explorePhotoCache = {};
let explore = { P: raDecToVec(80, 5), R: 0, fov: 60, drag: null, quiz: null, animFrame: null };
let exploreDragMoved = false;

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
      drawExplore();
      saveExploreState();
    }
  }
  explore.animFrame = requestAnimationFrame(step);
}

function saveExploreState() {
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

function drawForeground(ctx, abbrs, camP, camUp, fov, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,10,0.75)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  for (const abbr of abbrs) {
    if (!BOUNDS[abbr]) continue;
    for (const ring of BOUNDS[abbr]) {
      const pts = projectStarsCamera(ring.map(([ra, dec]) => [ra, dec, 0]), camP, camUp, fov, W, H);
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        if (p.d <= 0) { started = false; continue; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
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

// Draw one triangle of a source image at a destination triangle, using affine + clip.
function drawImageTriangle(ctx, img, src, dst) {
  const cross = (dst[1][0] - dst[0][0]) * (dst[2][1] - dst[0][1])
              - (dst[1][1] - dst[0][1]) * (dst[2][0] - dst[0][0]);
  if (Math.abs(cross) < 0.5) return; // degenerate
  const xform = solveAffine(src, dst);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dst[0][0], dst[0][1]);
  ctx.lineTo(dst[1][0], dst[1][1]);
  ctx.lineTo(dst[2][0], dst[2][1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(...xform);
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
  ctx.restore();
}

function drawExplorePhotoLayer(ctx, con, camP, camUp, fov, W, H) {
  const img = explorePhotoCache[con.abbr];
  if (!(img instanceof HTMLImageElement)) { loadExplorePhoto(con); return; }

  // Subdivide the photo into a GRID×GRID mesh. For each vertex compute the
  // exact sky position (via TAN inverse of the photo projection) then re-project
  // into the explore canvas. Each cell is drawn as 2 affine-warped triangles.
  const GRID = 8, IW = 640, IH = 640;
  const gw = GRID + 1;
  const verts = new Array(gw * gw);
  for (let gy = 0; gy <= GRID; gy++) {
    for (let gx = 0; gx <= GRID; gx++) {
      const px = gx / GRID * IW, py = gy / GRID * IH;
      const rd = pixelToRADec(px, py, con.ra, con.dec, con.fov, IW, IH);
      const ep = projectStarsCamera([[rd.ra, rd.dec, 0]], camP, camUp, fov, W, H)[0];
      verts[gy * gw + gx] = ep.d > 0 ? [px, py, ep.x, ep.y] : null;
    }
  }
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const p00 = verts[gy * gw + gx];
      const p10 = verts[gy * gw + gx + 1];
      const p01 = verts[(gy + 1) * gw + gx];
      const p11 = verts[(gy + 1) * gw + gx + 1];
      if (p00 && p10 && p01)
        drawImageTriangle(ctx, img,
          [[p00[0], p00[1]], [p10[0], p10[1]], [p01[0], p01[1]]],
          [[p00[2], p00[3]], [p10[2], p10[3]], [p01[2], p01[3]]]);
      if (p10 && p11 && p01)
        drawImageTriangle(ctx, img,
          [[p10[0], p10[1]], [p11[0], p11[1]], [p01[0], p01[1]]],
          [[p10[2], p10[3]], [p11[2], p11[3]], [p01[2], p01[3]]]);
    }
  }
}

function drawExploreArtLayer(ctx, con, camP, camUp, fov, W, H) {
  const art = ART[con.abbr];
  if (!art || art.anchors.length < 3) return;
  if (!artCache[con.abbr]) {
    artCache[con.abbr] = 'loading';
    const img = new Image();
    img.onload = () => {
      artCache[con.abbr] = img;
      if (document.getElementById('screen-explore').classList.contains('active')) drawExplore();
    };
    img.onerror = () => { artCache[con.abbr] = 'error'; };
    img.src = art.url;
  }
  const img = artCache[con.abbr];
  if (!(img instanceof HTMLImageElement)) return;
  const iw = img.naturalWidth, ih = img.naturalHeight;

  // Map art pixels through the constellation's own fixed TAN projection
  // (ref canvas) as a stable intermediate, then invert to RA/Dec and
  // re-project into the explore view. This matches each pixel to the same
  // sky position regardless of where the explore view is pointing.
  const REF = 1000;
  const refPts = projectStarsTAN(art.anchors.map(a => [a.ra, a.dec, 0]), con, REF, REF);
  const artToRef = solveAffine(
    art.anchors.map(a => [a.px * iw, a.py * ih]),
    refPts.map(p => [p.x, p.y])
  );

  const GRID = 8, gw = GRID + 1;
  const verts = new Array(gw * gw);
  for (let gy = 0; gy <= GRID; gy++) {
    for (let gx = 0; gx <= GRID; gx++) {
      const px = gx / GRID * iw, py = gy / GRID * ih;
      const qx = artToRef[0] * px + artToRef[2] * py + artToRef[4];
      const qy = artToRef[1] * px + artToRef[3] * py + artToRef[5];
      const rd = pixelToRADec(qx, qy, con.ra, con.dec, con.fov, REF, REF);
      const ep = projectStarsCamera([[rd.ra, rd.dec, 0]], camP, camUp, fov, W, H)[0];
      verts[gy * gw + gx] = ep.d > 0 ? [px, py, ep.x, ep.y] : null;
    }
  }

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.globalCompositeOperation = 'screen';
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const p00 = verts[gy * gw + gx];
      const p10 = verts[gy * gw + gx + 1];
      const p01 = verts[(gy + 1) * gw + gx];
      const p11 = verts[(gy + 1) * gw + gx + 1];
      if (p00 && p10 && p01)
        drawImageTriangle(ctx, img,
          [[p00[0], p00[1]], [p10[0], p10[1]], [p01[0], p01[1]]],
          [[p00[2], p00[3]], [p10[2], p10[3]], [p01[2], p01[3]]]);
      if (p10 && p11 && p01)
        drawImageTriangle(ctx, img,
          [[p10[0], p10[1]], [p11[0], p11[1]], [p01[0], p01[1]]],
          [[p10[2], p10[3]], [p11[2], p11[3]], [p01[2], p01[3]]]);
    }
  }
  ctx.restore();
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
    console.log('canvas sized:', w, h, 'from wrap:', sz, wrap.offsetHeight, 'dpr:', dpr);
  }
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const { ra, dec } = vecToRaDec(explore.P);
  const camP = explore.P;
  const camUp = cameraReverse(explore.P, explore.R, [0, 1, 0]);
  const celDash = 6, celGap = 5;

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
  const showPhoto      = cm ? (isAnswered ? document.getElementById('chk-eq-photo').checked    : cm === 'photo')   : document.getElementById('chk-ex-photo').checked;
  const showDiag       = cm ? (isAnswered ? document.getElementById('chk-eq-diagram').checked  : cm !== 'photo')   : document.getElementById('chk-ex-diagram').checked;
  const showLines      = cm ? (isAnswered ? showDiag                                            : cm === 'diagram') : true;
  const showBounds     = cm ? (isAnswered ? document.getElementById('chk-eq-boundary').checked : !!q.bounds)       : document.getElementById('chk-ex-bounds').checked;
  const showArt        = cm ? (isAnswered ? document.getElementById('chk-eq-art').checked      : false)            : document.getElementById('chk-ex-art').checked;
  const showStarLabels = cm ? false : document.getElementById('chk-ex-starlabels').checked;
  const showConNames   = cm ? false : document.getElementById('chk-ex-connames').checked;
  const showEquator    = cm ? true  : document.getElementById('chk-ex-equator').checked;

  // Photo layer (WebGL)
  if (showPhoto) {
    for (const con of visible) {
      drawExplorePhotoLayerGL(con, camP, camUp, explore.fov);
    }
  }

  // Celestial equator
  if (showEquator) {
    const eqPts = [];
    for (let ra = 0; ra <= 360; ra += 0.5) eqPts.push([ra, 0, 0]);
    const pts = projectStarsCamera(eqPts, camP, camUp, explore.fov, W, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(220,180,80,0.55)';
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
    for (const con of visible) {
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

  // Diagram: stars + lines + star labels
  if (showDiag) {
    for (const con of visible) {
      const proj = projectStarsCamera(con.stars, camP, camUp, explore.fov, W, H)
        .map((p, i) => ({ ...p, _orig: con.stars[i] }))
        .filter(p => p.d > 0 && Math.abs(p.x - W / 2) < W * 1.5 && Math.abs(p.y - H / 2) < H * 1.5);
      if (con.lines && showLines) {
        const fullProj = projectStarsCamera(con.stars, camP, camUp, explore.fov, W, H)
          .map(p => p.d > 0 ? p : null);
        drawLines(ctx, fullProj, con);
      }
      drawStars(ctx, proj);
      if (showStarLabels) drawLabels(ctx, proj, W);
    }
  }

  // Constellation name labels — placed inside boundary polygon, avoiding boundary edges.
  if (showConNames) {
    const fs = Math.max(9, Math.round(W * 0.02));
    ctx.save();
    ctx.font = `${fs}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(160,185,255,0.6)';
    for (const con of visible) {
      const cp = projectStarsCamera([[con.ra, con.dec, 99]], camP, camUp, explore.fov, W, H)[0];
      if (!cp || cp.d <= 0) continue;
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
        if (!found) continue;
      }
      ctx.fillText(name, lx, ly);
    }
    ctx.restore();
  }

  // Artwork layer (WebGL)
  const exploreCredit = document.getElementById('explore-art-credit');
  if (showArt) {
    let hasArt = false;
    for (const con of visible) {
      if (ART[con.abbr]) { hasArt = true; drawExploreArtLayerGL(con, camP, camUp, explore.fov); }
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
  const arm = 0.5 * (3 * celDash + 2 * celGap);
  ctx.save();
  ctx.strokeStyle = 'rgba(220,180,80,0.55)';
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

function startExploreQuiz() {
  const pool = C.filter(c => BOUNDS[c.abbr]).sort(() => Math.random() - 0.5);
  explore.quiz = { pool, idx: 0, score: 0, total: 0, target: null, answered: false };
  document.getElementById('explore-quiz-bar').style.display = '';
  document.getElementById('chk-ex-bounds').checked = true;
  localStorage.setItem('chk-ex-bounds', '1');
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
      type: 'find', mode: q.stageMode,
      navigate: q.navigate, noBounds: q.noBounds
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
  // Set reveal checkbox defaults and show controls
  document.getElementById('chk-eq-photo').checked    = q.stageMode === 'photo';
  document.getElementById('chk-eq-boundary').checked = true;
  document.getElementById('chk-eq-diagram').checked  = true;
  document.getElementById('chk-eq-art').checked      = true;
  document.getElementById('eq-reveal-controls').style.display = '';
  drawExplore();
}
