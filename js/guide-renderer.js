// js/guide-renderer.js
// Shared rendering logic used by find-help.html and find-guide.js

// Catalog lookup moved to js/step-display.js: highlights and guide-line endpoints
// resolve once, when the step display is built, instead of per frame — so an id
// the catalog lacks is reportable data rather than a silent skip.

// ── North-up roll ─────────────────────────────────────────────────────────────
function guideNorthUpR(P) {
  const pz = P[2], cos2 = 1 - pz * pz;
  if (cos2 < 1e-10) return 0;
  const s = Math.sqrt(cos2);
  const nd = [-pz*P[0]/s, -pz*P[1]/s, cos2/s];
  const q  = rotateByFromTo(nd, P, [0, 0, 1]);
  return Math.atan2(q[0], q[1]);
}

// "Does this step have overlays?" is hasOverlays(display) now — a query over the
// value rather than a hand-written list of field names, which had already fallen
// out of date by omitting the precession circle.

function _drawOutlinedLabel(ctx, text, x, y, color, scale) {
  const fs = Math.round(13 * scale);
  ctx.font = `bold ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#010208'; ctx.lineWidth = 3 * scale; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

// ── Annotation drawing ────────────────────────────────────────────────────────
// Paints the marks a step display carries. Catalog lookups already happened once,
// in makeStepDisplay, so this projects and paints and nothing else — and it
// switches on one `kind` tag instead of probing raw fields in a fixed order.
// Pass null to clear.
function guideDrawAnnotation(display) {
  const ann = document.getElementById('annotation-canvas');
  const src = document.getElementById('explore-canvas');
  const W = src.width, H = src.height;
  ann.width = W; ann.height = H;
  ann.style.width  = src.style.width;
  ann.style.height = src.style.height;
  const ctx = ann.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const camUp = cameraReverse(explore.P, explore.R, [0, 1, 0]);
  const cam = makeCamera(explore.P, camUp, explore.fov, W, H);

  const marks = display?.marks || [];
  if (!marks.length) return;

  const dpr   = window.devicePixelRatio || 1;
  const scale = W / (src.offsetWidth || W / dpr);
  const fovS  = 40 / explore.fov;   // FOV scale factor (same as drawStars)
  const margin = 10 * scale;        // fixed pixel margin around a star
  const objRadius = (o) => o.arcmin
    ? (o.arcmin / 60) / explore.fov * (W / 2)
    : magToR(o.mag ?? 6) * fovS * scale;

  ctx.save();
  for (const mark of marks) {

  // Precession circle — centered on ecliptic pole, radius = obliquity
  if (mark.kind === 'precession') {
    const south = mark.south;
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
      const p = cam.project(pt);
      projected.push(p.facing > 0 ? p : null);
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
    continue;
  }

    if (mark.kind === 'capsule') {
      // Project the already-resolved points. The camera cull stays here: whether a
      // point faces away depends on where the camera is pointing this frame.
      const pts = mark.points.map(e => {
        const p = cam.projectStars([[e.ra, e.dec, 0]])[0];
        if (!p || p.facing <= 0) return null;
        return { x: p.x, y: p.y, obj: e, label: e.label };
      }).filter(Boolean);
      if (pts.length < 2) continue;
      const maxObjR = Math.max(...pts.map(p => objRadius(p.obj)));
      const r     = maxObjR + (mark.margin != null ? mark.margin * scale : margin);
      const color = mark.color;
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
      if (!labels.length && mark.label) labels.push([pts[0], mark.label]);
      for (const [P, text] of labels) {
        const lx = P.x + r + 6 * scale, ly = P.y;
        _drawOutlinedLabel(ctx, text, lx, ly, color, scale);
      }
      continue;
    }
    const h = mark;
    if (h.kind === 'line') {
      const projected = h.points.map(({ ra, dec }) => {
        const p = cam.projectStars([[ra, dec, 0]])[0];
        return (p && p.facing > 0) ? p : null;
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
    } else if (h.kind === 'crosshair') {
      // Note: the painter uses its own colour here and ignores h.color. The value
      // carries whatever the data set so a validator can see the unread field.
      const pts = cam.projectStars([[h.ra, h.dec, 0]]);
      const p = pts[0];
      if (!p || p.facing <= 0) continue;
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
      const pts = cam.projectStars([[h.ra, h.dec, 0]]);
      const p = pts[0];
      if (!p || p.facing <= 0) continue;
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
// A scheduler ticker (issue #58), like the goto flight and the north-arrow fade.
// startCameraFlight interrupts whichever flight was in the air, so stepping through a
// guide and using Go To reliably replace each other.
//
// The sky is NOT drawn here. A ticker having run is itself enough to mark the frame
// dirty, so the camera move and the draw that shows it are the same frame. While this
// owned its own rAF it could only REQUEST a draw, and if the scheduler's frame happened
// to run first, that frame rendered a camera position the flight had already moved past.
//
// The annotation is different and stays per-frame here: it targets its own canvas, not
// the sky, so it is unaffected by the sky's draw being scheduled.
//
// shouldContinue: optional function returning false to abort mid-animation
// onAbort: optional, called when the flight is abandoned rather than flown to the end —
//   a hand on the sky, a pinch, a newer flight taking over. Passed straight through; the
//   camera's business is the camera, and what an abandoned flight means for the guide is
//   the guide's (issue #60).
function guideAnimateTo(step, prevStep, drawAnnotation, onDone, shouldContinue, onAbort) {
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
  startCameraFlight(function (now) {
    // An abort is not an arrival. Returning false is how a ticker says it finished, and
    // that runs the completion work below — which would snap the camera onto the
    // destination the guide has just been torn down away from. Standing down through
    // stopCameraAnimation is the exit that skips it.
    if (shouldContinue && !shouldContinue()) { stopCameraAnimation(); return; }
    const raw = Math.min(1, (now - start) / duration);
    const t   = raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw + 2, 3) / 2;
    if (angle > 0.001) {
      const fa = Math.sin((1 - t) * angle) / sinA, fb = Math.sin(t * angle) / sinA;
      explore.P = [fa*v1[0]+fb*v2[0], fa*v1[1]+fb*v2[1], fa*v1[2]+fb*v2[2]];
    }
    explore.fov = f1 + (f2 - f1) * t;
    explore.R = R1 + dR * t;
    drawAnnotation(raw < 1 ? prevStep : step);
    return raw < 1;
  }, function () {
    explore.P = v2; explore.fov = f2; explore.R = R2;
    if (onDone) onDone();
  }, onAbort);
}

// ── Guide session ─────────────────────────────────────────────────────────────
// _gs holds all state for the active guide session
let _gs = null;

// Identity for the flight in the air (issue #60). Module-scope on purpose: a guide torn
// down mid-flight leaves its flight registered until the next frame, and a counter that
// restarted at zero with each session would hand the new guide a number the dead one is
// still holding — letting the dead flight's abort speak for the live guide.
let _guideFlightSeq = 0;

// What the guide publishes when it settles on a step: the step's display, minus the
// overlays if the learner has hidden them. Both settle points — landing and being
// abandoned — go through here, because the toggle can be pressed mid-flight and its
// answer must survive whichever way the flight ends.
function _guideApplied() {
  return _gs.overlaysHidden ? displayWithoutOverlays(_gs.stepDisplay) : _gs.stepDisplay;
}

function _guideDraw() { explore.quiz = null; requestExploreDraw(); }

window.addEventListener('resize', () => {
  const wrap = document.getElementById('explore-wrap');
  const gl   = document.getElementById('explore-gl-canvas');
  if (wrap) wrap._sized = false;
  if (gl)   gl._sized   = false;
  _guideDraw();
  if (_gs) guideDrawAnnotation(explore.stepDisplay);
});

// Are the current step's overlays on screen? Two facts, deliberately separate: whether
// the step HAS overlays decides whether the toggle button appears, whether the learner
// HID them decides its label.
function _guideOverlaysShown() {
  // stepDisplay is null until the first step lands, so guideGoTo asks this before there
  // is anything to show.
  if (!_gs || !_gs.stepDisplay) return false;
  return !_gs.overlaysHidden && hasOverlays(_gs.stepDisplay);
}

// The only writer of explore.stepDisplay, and now the whole of it. Six layer
// properties, four guideLines* properties and a _gs truthiness probe used to say
// what this one slot says — and un-setting them meant six deletes, which were
// load-bearing: any exit path that missed them pinned the free explorer to the
// last step's layers. Setting one slot to null cannot half-restore.
function _guidePublish() {
  explore.stepDisplay = _gs ? _gs.applied : null;
}

// The step-transition intersection lives in js/step-display.js now, as
// intersectDisplays — one function over one value, covering both canvases, tested
// against a transcription of the pair it replaced (_guideIntersectSettings and
// _guideIntersectAnnotation, which had to be kept in lockstep by hand).

function _guideRenderUI() {
  const { steps, idx, animating } = _gs;
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
  const toggleBtn = document.getElementById('fg-btn-toggle-diag');
  // Two separate facts: does this step have overlays (show the button at all), and did
  // the learner hide them (what the button says).
  toggleBtn.style.display = hasOverlays(_gs.stepDisplay) ? '' : 'none';
  toggleBtn.textContent   = _gs.overlaysHidden ? 'Show overlays' : 'Hide overlays';
  const nextBtn = document.getElementById('fg-btn-next');
  nextBtn.textContent = isLast ? 'Done ✓' : 'Next →';
  nextBtn.style.visibility = animating ? 'hidden' : 'visible';
  // The exit's label belongs to the guide, not the step — the caller works out where
  // leaving goes (guideExitLabel, issue #66) and it holds for the whole session.
  // Guarded twice: find-help.html has no such button and names no destination.
  const backBtn = document.getElementById('fg-back-btn');
  if (backBtn && _gs.exitLabel) backBtn.textContent = _gs.exitLabel;
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
    _gs.overlaysHidden = !_gs.overlaysHidden;
    _gs.applied = _gs.overlaysHidden ? displayWithoutOverlays(_gs.stepDisplay) : _gs.stepDisplay;
    _guidePublish();
    _guideDraw();
    guideDrawAnnotation(explore.stepDisplay);
    document.getElementById('fg-btn-toggle-diag').textContent =
      _gs.overlaysHidden ? 'Show overlays' : 'Hide overlays';
  });

  const backBtn = document.getElementById('fg-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => { if (_gs?.onLastNext) _gs.onLastNext(); });
}

function guideGoTo(i, immediate) {
  if (!_gs) return;
  const prevShown    = _guideOverlaysShown();
  const prevDisplay  = (_gs.idx >= 0 && prevShown) ? _gs.stepDisplay : null;
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

  _gs.animating      = !immediate;
  _gs.stepDisplay    = makeStepDisplay(s, _gs.catalog);
  _gs.overlaysHidden = false;          // arriving at a step shows whatever it has
  if (_gs.stepKey) localStorage.setItem(_gs.stepKey, i);
  _guideRenderUI();

  if (immediate) {
    _gs.applied = _gs.stepDisplay;
    _guidePublish();
    explore.P   = raDecToVec(s.ra, s.dec);
    explore.fov = s.fov;
    explore.R   = _stepR(s);
    _guideDraw();
    guideDrawAnnotation(explore.stepDisplay);
    _gs.animating = false;
    _guideRenderUI();
  } else {
    // Before the flight: carry over only what both steps share, so departing elements
    // clear before the camera moves and arriving ones appear on landing. One
    // intersection now covers both canvases — the marks travel in the same value as
    // the layers, so there is no second annotation-only intersection to keep in step.
    _gs.applied = prevDisplay ? intersectDisplays(prevDisplay, _gs.stepDisplay) : _gs.stepDisplay;
    _guidePublish();
    _guideDraw();
    guideDrawAnnotation(explore.stepDisplay);

    // Each flight closes over its own number so its abort can tell whether it is still
    // the flight in the air. Starting a flight stops the one before it, and `animating`
    // is already true for THIS step by then — an unguarded abort from the outgoing
    // flight would clear the incoming one's flag and leave the nav up all through the
    // transition.
    const flight = _gs.flight = ++_guideFlightSeq;

    guideAnimateTo(s, null, () => guideDrawAnnotation(explore.stepDisplay), () => {
      if (!_gs) return;
      _gs.applied = _guideApplied();
      _guidePublish();
      _guideDraw();
      guideDrawAnnotation(explore.stepDisplay);
      _gs.animating = false;
      _guideRenderUI();
    }, () => !!_gs, () => {
      // Abandoned, not arrived: the learner grabbed the sky, or the guide was torn down
      // under the flight. The camera stays exactly where it was left — restoring it is
      // the one thing an interrupt must never do — and the guide settles onto the step
      // it was flying to: still on that step, just looking around. Which means the nav
      // comes back, and the transition intersection gives way to the step's own display
      // so Hide overlays toggles against what the caption describes (issue #60).
      if (!_gs || _gs.flight !== flight) return;
      _gs.animating = false;
      _gs.applied   = _guideApplied();
      _guidePublish();
      _guideDraw();
      guideDrawAnnotation(explore.stepDisplay);
      _guideRenderUI();
    });
  }
}

// `roll` is REQUIRED: the roll a step falls back to when it declares no rotation of its
// own, which is 270 of the 338 steps in the corpus. It used to be read off explore.R at
// exactly this moment, so every caller had to assign explore.R immediately beforehand —
// an ordering contract between two modules that was written down nowhere, and the reason
// both hosts carried an identical roll stanza above their guideStart call.
//
// No `?? explore.R` fallback on purpose. A fallback keeps the old timing-dependent
// behaviour alive for whoever forgets, and the whole point is that forgetting should be
// impossible rather than quiet. Throwing is how a signature is enforced in a language
// that does not enforce one: two call sites, both loud, both immediate.
function guideStart(steps, catalog, options = {}) {
  if (typeof options.roll !== 'number') {
    throw new Error('guideStart: options.roll is required (a number) — see issue #88');
  }
  _gs = { steps, catalog, idx: -1, animating: false,
          flight: 0,                // which flight is in the air (see _guideFlightSeq)
          stepDisplay: null,        // the full display of steps[idx]
          applied: null,            // what is actually published — full, intersection, or bare photo
          overlaysHidden: false,    // the learner's Hide overlays toggle
          onLastNext: options.onLastNext || null, stepKey: options.stepKey || null,
          exitLabel: options.exitLabel || null,   // what the exit says, if the caller says
          defaultR: options.roll };
  _guideAddListeners();
  const saved = _gs.stepKey ? parseInt(localStorage.getItem(_gs.stepKey), 10) : NaN;
  guideGoTo((!isNaN(saved) && saved >= 0 && saved < steps.length) ? saved : 0, true);
}

function guideStop() {
  if (_gs?.stepKey) localStorage.removeItem(_gs.stepKey);
  _gs = null;
  _guidePublish();                     // clears the slot and the legacy properties
  const ann = document.getElementById('annotation-canvas');
  if (ann) { const c = ann.getContext('2d'); c.clearRect(0, 0, ann.width, ann.height); }
}
