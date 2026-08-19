// ═══════════════════════════════════════════════════════════
// EXPLORE MODE
// ═══════════════════════════════════════════════════════════
const explorePhotoCache = {};
const FOV_MIN = 10, FOV_MAX = 110;
let explore = { P: raDecToVec(80, 5), R: 0, fov: 60, drag: null, quiz: null };
let exploreDragMoved = false;

// ── The one frame loop (js/render-scheduler.js, issue #53) ──
// Nothing draws the sky directly any more: callers ask for a frame and the scheduler
// renders at most one per display refresh, so a 120Hz touch stream cannot outrun the
// renderer and build the backlog that made dragging lag behind the finger.
//
// Built on first use rather than at load: the node tests (test/stroke-polyline.js,
// test/display-flags.js) load this file for its pure functions in an environment with
// no requestAnimationFrame and no scheduler module, and must keep doing so.
let _exploreScheduler = null;
function exploreScheduler() {
  if (!_exploreScheduler) {
    _exploreScheduler = makeRenderScheduler({
      raf: cb => requestAnimationFrame(cb),
      cancel: h => cancelAnimationFrame(h),
      draw: () => drawExplore(),
    });
  }
  return _exploreScheduler;
}

// Ask for the sky to be redrawn on the next frame. Repeated calls within one frame
// collapse into a single render; the most recent state is what gets drawn.
function requestExploreDraw() { exploreScheduler().request(); }

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

// Diagram source (which star-figure set to draw) lives in js/diagram-sources.js
// as the app-global `diagramSource`; the drawing below routes through diagramFor().

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

// Resolve the current explore / quiz / course state into the discrete display
// flags that drive drawExplore's layer passes, plus the per-layer filters. Pure:
// reads no globals. Three sources, in order — course mode, then the step display
// a running finding guide published, then the free-explore defaults.
//
// The step display is COMPLETE: while a guide runs it fully determines the layers
// and exState is not consulted; `null` means no guide. That one value replaced six
// tri-state properties whose presence all encoded the same bit, and it carries the
// abbr allowlists that drawExplore used to re-derive from the bus itself.
//
// The per-frame alpha ramps (_refAlpha, _compassAlpha) stay in drawExplore next to
// their draw calls, since they depend on the animation value explore._northAlpha.
// Characterized by test/display-flags.js against test/display-flags-golden.json.
function resolveDisplayFlags(explore, exState, eqRevState) {
  const q = explore.quiz;
  const cm = q?.stageMode;                 // course mode active?
  const isAnswered = !!(q?.answered);
  const sd = explore.stepDisplay || null;  // the running guide's step display, or null
  const showDiag = cm ? (isAnswered ? eqRevState.diagram : cm !== 'photo') : true;
  return {
    cm,
    isAnswered,
    showPhoto:      cm ? (isAnswered ? eqRevState.photo    : cm === 'photo')   : sd ? sd.layers.photo.on   : exState.photo,
    showDiag,
    showStars:      cm ? showDiag : sd ? sd.layers.diagram.on : exState.stars,
    showLines:      cm ? (isAnswered ? showDiag           : cm === 'diagram') : sd ? sd.layers.diagram.on : exState.diagram,
    showBounds:     cm ? (isAnswered ? eqRevState.boundary : !!q.bounds)       : sd ? sd.layers.bounds.on  : exState.bounds,
    showArt:        cm ? (isAnswered ? eqRevState.art      : false)            : sd ? sd.layers.art.on     : exState.art,
    showStarLabels: (cm || sd) ? false : exState.starLabels,
    showConNames:   cm ? false : sd ? sd.layers.names.on : exState.conNames,
    // A guide suppresses the reference guides for its whole run. This used to be a
    // per-step `equator` field that no step ever set, so it was written false on
    // every step; it is a rule of the step display now, not data.
    refMode:        cm ? 'always' : sd ? null : exState.reference,
    // Per-layer allowlists — null means "every visible constellation". Returned
    // beside the flags so the draw passes stop decoding the bus a second time.
    diagramOnly:    sd ? sd.layers.diagram.only : null,
    boundsOnly:     sd ? sd.layers.bounds.only  : null,
    artOnly:        sd ? sd.layers.art.only     : null,
    namesOnly:      sd ? sd.layers.names.only   : null,
  };
}

function initEqRevealToggles() {
  _eqRevToggleGroup = createToggleGroup(document.getElementById('eq-reveal-controls'), {
    buttons: [
      { label: 'Photo', value: 'photo', on: true },
      { label: 'Diagram', value: 'diagram', on: true },
      { label: 'Art', value: 'art', on: true },
      { label: 'Bounds', value: 'boundary', on: true },
    ],
    onChange(value, on) { eqRevState[value] = on; saveLessonSession(); requestExploreDraw(); },
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
  function redraw() { requestExploreDraw(); }

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
      requestExploreDraw();
    },
    onDragStart() { showNorthArrow(); },
    onDragEnd() {
      hideNorthArrow();
      if (dialReadout) dialReadout.textContent = 'Rotate';
      if (typeof saveExploreState === 'function') saveExploreState();
    },
  });
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
      _conNameRefreshTimer = setTimeout(() => { _conNameRefreshTimer = null; requestExploreDraw(); }, remaining);
    }
    return cached;
  }

  const cam = makeCamera(camP, camUp, fov, W, H);
  const cp = cam.projectStars([[con.ra, con.dec, 99]])[0];
  if (!cp || cp.facing <= 0) return null;

  const name = con.name;
  const tw = ctx.measureText(name).width;
  const hw = tw / 2 + 2, hh = fs * 0.65;
  const pRings = projBounds[con.abbr];
  const polyPts = pRings ? pRings.flatMap(pts => pts.filter(p => p.facing > 0)) : null;
  const canPIP = polyPts && polyPts.length >= 3;
  // Label must stay within the canvas rect (bounds test), and — via the shared
  // fitLabelBox — inside its own boundary polygon and clear of other boundaries.
  const valid = (tx, ty) => {
    if (tx < hw || tx > W - hw || ty < hh || ty > H - hh) return false;
    return fitLabelBox(tx, ty, hw, hh, {
      inside: canPIP ? polyPts : null,
      edges: showBounds ? allBoundEdges : null,
    });
  };
  // Try the anchor (projected centroid), then spiral outward in step-sized rings.
  const step = Math.max(hw, fs);
  const radii = [];
  for (let r = step; r < W * 0.7; r += step) radii.push(r);
  const anchor = { x: cp.x, y: cp.y };
  const spot = searchLabelSpot([anchor], anchor, radii, valid);
  if (!spot) return null;
  const lx = spot.x, ly = spot.y;
  const vec = cam.unproject(lx, ly);
  const rd = vecToRaDec(vec);
  const result = { ra: rd.ra, dec: rd.dec, time: now };
  _conNameCache[con.abbr] = result;
  return result;
}

// ── Camera flights ────────────────────────────────────────────────────────────
// Both flights — the goto here and the finding-guide flight in guide-renderer.js —
// are scheduler tickers (issues #54, #58). A ticker advances the camera and says
// whether it wants another frame; the scheduler owns the frame and draws once, after
// every ticker has run. Nothing here asks for a frame of its own.
//
// ONE handle, because the camera has one flight: starting either kind stops the other,
// so a second variable could only ever hold null. That is also what makes
// stopCameraAnimation a single line, and what stops a flight from being uncancellable
// during the window before its first frame — registration IS the handle, so there is no
// moment when a flight is running but unreachable (the bug #58 removed).
let _cameraTicker = null;
let _cameraAbort  = null;

// Start a flight, replacing whatever was in the air. `tick` returns false when it has
// arrived; `done` then runs on deregistration — and, crucially, BEFORE the draw of the
// frame that finished the flight (see test/render-scheduler.js), so snapping to the
// exact destination is what gets rendered rather than the last eased approximation.
//
// `abort` is the flight's third exit (issue #60), for callers that keep state alongside
// it. A flight ends in exactly one of three ways — it lands (`done`), it is abandoned
// (`abort`), or the page goes away — and a caller that only hears about the first is
// left holding state no event will ever clear.
function startCameraFlight(tick, done, abort) {
  stopCameraAnimation();                 // fires the previous flight's abort, if it had one
  _cameraTicker = tick;
  _cameraAbort  = abort || null;
  exploreScheduler().addTicker(tick, function () {
    _cameraTicker = null;
    _cameraAbort  = null;
    done();
  });
}

// Stop the camera flight in progress, if any. Deliberately does NOT run its completion
// work: this is the abandon path — a new flight replacing the old one, a hand grabbing
// the sky, a guide torn down mid-step — and running completion would snap the camera to
// the destination it was just told to give up on. `removeTicker` skips `done` for
// exactly this reason.
//
// The abort callback is the opposite case: it exists to say the flight is over WITHOUT
// moving the camera, so whoever started it can put its own affairs in order. The handle
// is cleared before the callback runs, so an abort that lands back here finds no stale
// ticker to remove twice. An abort must NOT start a flight of its own, though: it runs
// from inside startCameraFlight, before that call has registered its own ticker, and the
// registration that follows would orphan it — still ticking, with nothing left to cancel
// it by. Put state in order here and let the caller start what comes next.
function stopCameraAnimation() {
  if (!_cameraTicker) return;
  const abort = _cameraAbort;
  exploreScheduler().removeTicker(_cameraTicker);
  _cameraTicker = null;
  _cameraAbort  = null;
  if (abort) abort();
}

function animateGoTo(targetRa, targetDec) {
  stopCameraAnimation();
  const v1 = explore.P.slice();
  const v2 = raDecToVec(targetRa, targetDec);
  const dotP = Math.max(-1, Math.min(1, v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2]));
  const angle = Math.acos(dotP);
  if (angle < 0.001) return;
  const sinA = Math.sin(angle);
  // Duration proportional to arc length: 400ms–2000ms
  const duration = Math.max(400, Math.min(2000, angle / Math.PI * 2000));
  const startTime = performance.now();
  startCameraFlight(function (now) {
    const raw = Math.min(1, (now - startTime) / duration);
    // Ease in-out cubic
    const t = raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw + 2, 3) / 2;
    const f1 = Math.sin((1 - t) * angle) / sinA;
    const f2 = Math.sin(t * angle) / sinA;
    explore.P = [f1*v1[0]+f2*v2[0], f1*v1[1]+f2*v2[1], f1*v1[2]+f2*v2[2]];
    return raw < 1;
  }, function () {
    explore.P = v2;
    _clearConNameCache();
    saveExploreState();
  });
}

// Copy-safe snapshot of the core view state (camera position, rotation, fov).
// `P` is an array, so it MUST be copied on both the capture and the apply side —
// otherwise a saved snapshot shares its array with live `explore.P` and any future
// in-place mutation of one silently corrupts the other. snapshotView + applyView
// are the single home for that copy discipline; every in-memory save/restore of the
// view (lesson history, find-guide, q.startP) routes through them so no restore can
// alias `P`. (R and fov are primitives — copied by value.) Characterized by
// test/view-snapshot.js.
function snapshotView(explore) {
  return { P: explore.P.slice(), R: explore.R, fov: explore.fov };
}
function applyView(explore, snap) {
  explore.P = snap.P.slice();
  explore.R = snap.R;
  explore.fov = snap.fov;
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
    if (document.getElementById('screen-explore').classList.contains('active')) requestExploreDraw();
  };
  img.onerror = () => { explorePhotoCache[con.abbr] = 'error'; };
  img.src = photoUrl(con);
}

// Near-plane epsilon for horizon clipping. A segment crossing facing = 0 is clipped
// at this small positive facing instead of exactly 0 (which projects to infinity),
// so the clipped vertex lands far off-screen and the visible line runs to the edge.
const NEAR_EPS = 1e-6;

// ...but "far off-screen" has to mean a few screen widths, not astronomically far.
// Dividing by NEAR_EPS multiplies the coordinate by a million: measured on an
// iPhone 15 Pro, the farthest clipped vertex sat 655,967,956 px from the visible
// end of its line — half a million times the canvas width — and there were twelve
// of them per frame. Every full-sky path (the celestial equator, the Milky Way)
// crosses the horizon on every frame, so every frame handed the rasterizer paths
// spanning that distance. That is what killed the GPU process: measured stalls of
// 15-62 SECONDS with the main thread blocked, and a webglcontextlost event 59ms
// after one of them. Clamping removed the thread blocks entirely (worst timer
// 15,009ms -> 68ms).
//
// It was a rendering bug too. Dash patterns are laid out along path length, so
// the equator's dashes were distributed across those millions of pixels and
// almost none landed on screen — the equator simply did not appear.
const CLIP_MAX_SCREENS = 4;

// Pull a clipped vertex back to CLIP_MAX_SCREENS canvas-widths from the visible
// end of the segment, along the same direction. Anything past the canvas edge is
// invisible, so the line still runs off-screen exactly as intended.
function clampClipped(p, anchor, ctx) {
  if (!anchor || !isFinite(anchor.x) || !isFinite(anchor.y)) return p;
  const canvas = ctx && ctx.canvas;
  const lim = CLIP_MAX_SCREENS * Math.max((canvas && canvas.width) || 1200,
                                          (canvas && canvas.height) || 1200);
  const dx = p.x - anchor.x, dy = p.y - anchor.y;
  const d = Math.hypot(dx, dy);
  if (!isFinite(d) || d === 0) return { x: anchor.x, y: anchor.y };
  if (d <= lim) return p;
  const k = lim / d;
  return { x: anchor.x + dx * k, y: anchor.y + dy * k };
}

// Perspective-correct screen point where the segment a→b crosses the near plane,
// evaluated at facing = NEAR_EPS. Both (x·facing) and facing are linear along the
// view-space chord (gnomonic projection maps that chord to a straight screen line),
// so x = (x·facing)(t) / facing(t) reproduces the projected crossing from the two
// endpoints alone — no camera or view vectors needed here. See issue #1.
function clipToNear(a, b) {
  const fa = a.facing, fb = b.facing;
  const t = (NEAR_EPS - fa) / (fb - fa);
  const x = (a.x * fa + t * (b.x * fb - a.x * fa)) / NEAR_EPS;
  const y = (a.y * fa + t * (b.y * fb - a.y * fa)) / NEAR_EPS;
  return { x, y };
}

// Stroke a polyline through projected points. A segment that straddles the near
// plane (one endpoint facing the camera, one facing away) is CLIPPED to the horizon
// via clipToNear so the line runs to the screen edge instead of dropping the crossing
// segment (issue #1); points fully behind the camera (facing <= 0) still lift the pen.
// Owns beginPath + the final stroke; callers set the stroke style beforehand and, for
// multi-ring shapes, call once per ring. `close` closes the final sub-path (the
// phototile debug outline). Tested by test/stroke-polyline.js.
function strokePolyline(ctx, pts, close = false) {
  ctx.beginPath();
  let penDown = false;
  let prev = null;
  for (const p of pts) {
    if (p.facing > 0) {
      if (penDown) {
        ctx.lineTo(p.x, p.y);
      } else {
        // Entering the front hemisphere: if the previous point was behind, start at
        // the near-plane crossing so the line runs in from the edge.
        // Anchor the clamp on p: entering the view, `prev` is behind the camera
        // and its projected coordinates are meaningless.
        if (prev && prev.facing <= 0) {
          const c = clampClipped(clipToNear(prev, p), p, ctx);
          ctx.moveTo(c.x, c.y); ctx.lineTo(p.x, p.y);
        }
        else ctx.moveTo(p.x, p.y);
        penDown = true;
      }
    } else {
      // Behind the camera: run the line out to the crossing before lifting the pen.
      // Leaving the view: `prev` is the visible end, so anchor the clamp there.
      if (penDown) { const c = clampClipped(clipToNear(prev, p), prev, ctx); ctx.lineTo(c.x, c.y); }
      penDown = false;
    }
    prev = p;
  }
  if (close) ctx.closePath();
  ctx.stroke();
}

function drawExplore() {
  const canvas = document.getElementById('explore-canvas');
  if (!canvas) return;
  // Per-phase timing (js/draw-phases.js). Inert unless the perf probe has installed a
  // sink, so a normal run pays a null check per boundary. The marks below sit exactly
  // on the section comments this function was already divided into — a phase runs from
  // its mark to the next one, and `end` closes the last.
  beginDrawPhases();
  markDrawPhase('setup');
  const wrap = document.getElementById('explore-wrap');
  const glCanvas = document.getElementById('explore-gl-canvas');
  const dpr = window.devicePixelRatio || 1;
  const sz = wrap.offsetWidth;
  const wrapH = wrap.offsetHeight;
  if (sz > 0 && wrapH > 0) {
    const w = Math.round(sz * dpr);
    const h = Math.round(wrapH * dpr);
    // Resize whenever the wrap's actual size no longer matches the canvas backing
    // store. Relying on a one-shot _sized flag left the canvas locked to a stale
    // height when the first draw happened before layout settled (screen transition,
    // toggle-group build, font metrics) — a black margin until a window resize.
    if (canvas.width !== w || canvas.height !== h ||
        (glCanvas && (glCanvas.width !== w || glCanvas.height !== h))) {
      const cssW = Math.round(sz) + 'px';
      const cssH = wrapH + 'px';
      canvas.width = w; canvas.height = h;
      canvas.style.width = cssW; canvas.style.height = cssH;
      wrap._sized = true;
      if (glCanvas) {
        glCanvas.width = w; glCanvas.height = h;
        glCanvas.style.width = cssW; glCanvas.style.height = cssH;
        glCanvas._sized = true;
      }
    }
  }
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const { ra, dec } = vecToRaDec(explore.P);
  const camP = explore.P;
  const camUp = cameraReverse(explore.P, explore.R, [0, 1, 0]);
  const cam = makeCamera(camP, camUp, explore.fov, W, H);
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
  const {
    cm, showPhoto, showDiag, showStars, showLines, showBounds, showArt,
    showStarLabels, showConNames, refMode,
    diagramOnly, boundsOnly, artOnly, namesOnly,
  } = resolveDisplayFlags(explore, exState, eqRevState);
  const _refAlpha      = refMode === 'always' ? 1 : refMode === 'moving' ? (explore._northAlpha || 0) : 0;
  const showEquator    = _refAlpha > 0.01;

  // Photo layer (WebGL)
  markDrawPhase('photo');
  if (showPhoto) {
    for (const con of visible) {
      drawExplorePhotoLayerGL(con, cam);
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
          return cam.projectStars([[rd.ra, rd.dec, 0]])[0];
        });
        strokePolyline(ctx, pts, true);
      }
      ctx.restore();
    }
  }

  // Celestial equator
  markDrawPhase('equator');
  if (showEquator) {
    const eqPts = [];
    for (let ra = 0; ra <= 360; ra += 0.5) eqPts.push([ra, 0, 0]);
    const pts = cam.projectStars(eqPts);
    ctx.save();
    ctx.strokeStyle = `rgba(220,180,80,${0.35 * _refAlpha})`;
    ctx.lineWidth = Math.max(1, W / 640);
    ctx.setLineDash([celDash, celGap]);
    strokePolyline(ctx, pts);
    ctx.restore();
  }

  // Milky Way (galactic plane) — shown in diagram/stars question modes for orientation,
  // but not when the photo layer is visible (real photo has the real Milky Way).
  markDrawPhase('milky-way');
  if (!showPhoto && (cm === 'diagram' || cm === 'stars')) {
    const mwPts = [];
    for (let l = 0; l <= 360; l += 0.5) {
      const { ra, dec } = galToRaDec(l, 0);
      mwPts.push([ra, dec, 0]);
    }
    const pts = cam.projectStars(mwPts);
    ctx.save();
    ctx.strokeStyle = 'rgba(180,200,255,0.22)';
    ctx.lineWidth = Math.max(24, W / 13);
    ctx.shadowColor = 'rgba(180,200,255,0.16)';
    ctx.shadowBlur = W / 40;
    strokePolyline(ctx, pts);
    ctx.restore();
  }

  // Pre-project boundaries for all visible constellations (reused for drawing, edge
  // collection, and label polygon PIP — avoids redundant projection passes).
  markDrawPhase('bounds-project');
  const projBounds = {};
  for (const con of visible) {
    const rings = BOUNDS[con.abbr];
    if (!rings) continue;
    projBounds[con.abbr] = rings.map(ring =>
      cam.projectStars(ring.map(([ra, dec]) => [ra, dec, 0]))
    );
  }
  // Collect all visible boundary edges for label collision detection.
  const allBoundEdges = [];
  for (const pRings of Object.values(projBounds)) {
    for (const pts of pRings) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (a.facing > 0 && b.facing > 0) allBoundEdges.push([a, b]);
      }
    }
  }

  // Boundaries
  markDrawPhase('bounds-draw');
  if (showBounds) {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,200,120,0.45)';
    ctx.lineWidth = Math.max(1, W / 640);
    for (const con of visible) {
      if (boundsOnly && !boundsOnly.includes(con.abbr)) continue;
      const pRings = projBounds[con.abbr];
      if (!pRings) continue;
      for (const pts of pRings) {
        strokePolyline(ctx, pts);
      }
    }
    ctx.restore();
  }

  // Diagram: two-pass so guide lines can sit between diagram lines and stars
  markDrawPhase('diagram-lines');
  if (showStars || showLines) {
    // Pass 1: diagram lines only
    for (const con of visible) {
      if (diagramOnly && !diagramOnly.includes(con.abbr)) continue;
      const dcon = diagramFor(con, diagramSource);
      if (dcon.lines && showLines) {
        const fullProj = cam.projectStars(dcon.stars)
          .map(p => p.facing > 0 ? p : null);
        drawLines(ctx, fullProj, dcon);
      }
    }
  }

  // Guide custom lines (above diagram lines, below stars)
  // Endpoints are already resolved to ra/dec by makeStepDisplay, so this pass no
  // longer carries a catalog on the bus or looks names up per frame.
  markDrawPhase('guide-lines');
  const guideLines = explore.stepDisplay?.lines;
  if (guideLines) {
    const gc = guideLines.color;
    const glw = guideLines.width * (40 / explore.fov);
    ctx.save();
    ctx.strokeStyle = gc;
    ctx.lineWidth = glw;
    ctx.shadowColor = gc;
    ctx.shadowBlur = glw * 6;
    for (const seg of guideLines.segments) {
      const pts = cam.projectStars([[seg.a.ra, seg.a.dec, 0], [seg.b.ra, seg.b.dec, 0]]);
      if (pts[0].facing > 0 && pts[1].facing > 0) {
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
    for (const con of visible) {
      if (diagramOnly && !diagramOnly.includes(con.abbr)) continue;
      const dcon = diagramFor(con, diagramSource);
      // Three marks inside the loop rather than one around it: projection, star
      // drawing and label placement are the three things a future optimisation would
      // treat separately, so they are worth separating in the measurement. A phase
      // marked repeatedly sums across the loop (see test/draw-phases.js).
      markDrawPhase('stars-project');
      const proj = cam.projectStars(dcon.stars)
        .map((p, i) => ({ ...p, _orig: dcon.stars[i] }))
        .filter(p => p.facing > 0 && Math.abs(p.x - W / 2) < W * 1.5 && Math.abs(p.y - H / 2) < H * 1.5);
      if (showStars) { markDrawPhase('stars-draw'); drawStars(ctx, proj, explore.fov); }
      if (showStarLabels) { markDrawPhase('star-labels'); drawLabels(ctx, proj, W); }
    }
  }

  // Constellation name labels — placement is throttled and cached in RA/dec.
  markDrawPhase('con-names');
  if (showConNames) {
    const fs = Math.max(9, Math.round(W * 0.02));
    ctx.save();
    ctx.font = `${fs}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(160,185,255,0.6)';
    for (const con of visible) {
      if (namesOnly && !namesOnly.includes(con.abbr)) continue;
      const pos = conNamePosition(con, ctx, fs, camP, camUp, explore.fov, W, H, projBounds, allBoundEdges, showBounds);
      if (!pos) continue;
      const p = cam.projectStars([[pos.ra, pos.dec, 99]])[0];
      if (p && p.facing > 0) ctx.fillText(con.name, p.x, p.y);
    }
    ctx.restore();
  }

  // Artwork layer (WebGL)
  markDrawPhase('art');
  const exploreCredit = document.getElementById('explore-art-credit');
  if (showArt) {
    let hasArt = false;
    for (const con of visible) {
      if (!ART[con.abbr]) continue;
      if (artOnly && !artOnly.includes(con.abbr)) continue;
      hasArt = true;
      drawExploreArtLayerGL(con, cam);
    }
    if (exploreCredit) exploreCredit.textContent = hasArt ? 'Art: Johan Meuris / Free Art Licence' : '';
  } else {
    if (exploreCredit) exploreCredit.textContent = '';
  }

  // Quiz: highlight boundaries after answering
  markDrawPhase('quiz-highlight');
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
        const pts = cam.projectStars(ring.map(([ra, dec]) => [ra, dec, 0]));
        strokePolyline(ctx, pts);
      }
      ctx.restore();
    };
    if (clicked && clicked.abbr !== target.abbr) drawBoundary(clicked, 'rgba(255,80,80,0.9)');
    drawBoundary(target, 'rgba(100,255,100,0.9)');
    // Diagram and art for the answered state are now checkbox-controlled via
    // showDiag / showArt in the main drawing loops above.
  }

  // Crosshairs at celestial poles
  markDrawPhase('poles');
  if (_refAlpha > 0.01) {
    const arm = 0.5 * (3 * celDash + 2 * celGap);
    ctx.save();
    ctx.strokeStyle = `rgba(220,180,80,${0.35 * _refAlpha})`;
    ctx.lineWidth = Math.max(1, W / 640);
    ctx.setLineDash([celDash, celGap]);
    for (const pole of [[0, 0, 1], [0, 0, -1]]) {
      const p = cam.project(pole);
      if (p.facing <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(p.x - arm, p.y); ctx.lineTo(p.x + arm, p.y);
      ctx.moveTo(p.x, p.y - arm); ctx.lineTo(p.x, p.y + arm);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Compass arrow — N or S depending on hemisphere (fades in/out on interaction)
  markDrawPhase('compass');
  const _compassAlpha = refMode === 'always' ? 0.35 : refMode === 'moving' ? (explore._northAlpha || 0) * 0.35 : 0;
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
    const pp = cam.project(pole);
    if (pp.facing > 0) {
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
  markDrawPhase('guide-annotation');
  if (_gs && !_gs.animating) {
    guideDrawAnnotation(explore.stepDisplay);
  }

  endDrawPhases();
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
  requestExploreDraw();
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
  requestExploreDraw();
}

function handleExploreClick(px, py) {
  const q = explore.quiz;
  if (!q || q.answered) return;
  const canvas = document.getElementById('explore-canvas');
  const W = canvas.width, H = canvas.height;
  const { ra, dec } = vecToRaDec(explore.P);
  const camP = explore.P;
  const camUp = cameraReverse(explore.P, explore.R, [0, 1, 0]);
  const cam = makeCamera(camP, camUp, explore.fov, W, H);
  // Hit-test in canvas pixel space — avoids RA/Dec wrapping artifacts and TAN
  // projection distortion that cause mismatches between what the user sees and
  // what a sky-coordinate PIP would identify.
  const clicked = C.find(c => {
    if (!BOUNDS[c.abbr]) return false;
    if (angularDist(ra, dec, c.ra, c.dec) > explore.fov / 2 + c.fov / 2 + 8) return false;
    return BOUNDS[c.abbr].some(ring => {
      const pts = cam.projectStars(ring.map(([ra, dec]) => [ra, dec, 0]))
        .filter(p => p.facing > 0);
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
  // Set reveal defaults and show controls
  eqRevealReset(q.stageMode === 'photo');
  document.getElementById('eq-reveal-controls').style.display = '';
  // Save answer to lesson history for reload persistence
  if (q.lessonMode) {
    session.history[session.idx] = {
      chosen: clicked, wasCorrect: correct,
      exploreState: snapshotView(explore)
    };
    saveLessonSession();
  }
  requestExploreDraw();
}

// ── North arrow fade (used by drag, dial, and zoom) ──────────────
// A scheduler ticker (issue #54) rather than a frame loop of its own. This is the fade
// that pinch and wheel both start, so while it owned frames a zoom rendered the sky
// twice per frame: once for the zoom, once for the fade. Now it only moves the alpha
// and the scheduler decides what that costs.
let _northFading = 0, _northTickerLive = false;
function _northTick() {
  const target = _northFading > 0 ? 1 : 0;
  const speed = _northFading > 0 ? 0.15 : 0.08;
  explore._northAlpha += (target - explore._northAlpha) * speed;
  if (Math.abs(explore._northAlpha - target) < 0.01) explore._northAlpha = target;
  return explore._northAlpha !== target;
}
// Registration is idempotent: reversing direction mid-fade re-points the same ticker at
// a new target rather than stacking a second one.
function _runNorthTicker() {
  if (_northTickerLive) return;
  _northTickerLive = true;
  exploreScheduler().addTicker(_northTick, function () { _northTickerLive = false; });
}
function showNorthArrow() {
  _northFading = 1;
  _runNorthTicker();
}
function hideNorthArrow() {
  _northFading = -1;
  _runNorthTicker();
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
    stopCameraAnimation();
    showNorthArrow();
    const { px, py } = clientToCanvas(cx, cy);
    const up0 = cameraReverse(explore.P, explore.R, [0, 1, 0]);
    const vStart = makeCamera(explore.P, up0, explore.fov, ec.width, ec.height).unproject(px, py);
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
    const S2 = makeCamera(P0, up0, explore.fov, ec.width, ec.height).unproject(px, py);
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
    requestExploreDraw();
  }
  function dragEnd() {
    explore.drag = null;
    ew.classList.remove('dragging');
    hideNorthArrow();
    if (typeof saveExploreState === 'function') saveExploreState();
    requestExploreDraw();
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
      requestExploreDraw();
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
    requestExploreDraw();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { hideNorthArrow(); if (typeof saveExploreState === 'function') saveExploreState(); requestExploreDraw(); }, 300);
  }, { passive: false });

  return { clientToCanvas };
}
