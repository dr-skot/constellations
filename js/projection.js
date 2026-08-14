// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++)h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h >>> 0 }
function makeRng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function magToR(m) { return m <= -1 ? 8.5 : m < 0 ? 7.5 : m < 1 ? 6.2 : m < 2 ? 4.8 : m < 3 ? 3.5 : m < 4 ? 2.5 : m < 5 ? 1.8 : 1.2 }
function starCol(h) { return h === 'r' ? '#ff7060' : h === 'o' ? '#ffb860' : h === 'b' ? '#90c8ff' : '#f5eedc' }

function photoUrl(con) {
  return `img/${con.abbr}.jpg`;
}

// Resize a canvas's backing store ONLY when it actually changes.
//
// Assigning canvas.width/height reallocates the bitmap and drops its GPU texture
// even when the value assigned is identical. On a 3x display the quiz canvas is
// 1107x1107, so a redundant assignment throws away and rebuilds ~4.9MB — and doing
// that once per question stalls frame presentation on iOS for SECONDS at a time
// (measured on an iPhone 15 Pro: 3 frames delivered in 20s, an 18s freeze, with the
// main thread idle the whole time). Guarding it restored a steady 60fps at the same
// resolution. drawExplore has always done this correctly; everywhere else did not.
//
// Returns true when a resize happened — in which case the bitmap is now cleared,
// per the canvas spec. Callers that fully repaint (renderCanvas/redrawReveal draw an
// opaque background first) can ignore the result.
// The backing-store scale to draw at. Capped at 2 because the cost is quadratic:
// on a 3x phone the quiz canvas is 1107x1107 (~4.9MB), at 2x it is 738x738 (~2.2MB,
// 44% of the pixels), and the difference is not visible on a phone screen. Measured
// on an iPhone 15 Pro, lowering the scale roughly doubled delivered frames while
// tapping through questions (631 -> 1092 frames per 20s).
function displayScale() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function sizeCanvas(canvas, w, h) {
  const W = Math.round(w), H = Math.round(h);
  if (canvas.width === W && canvas.height === H) return false;
  canvas.width = W;
  canvas.height = H;
  return true;
}

function angularDist(ra1, dec1, ra2, dec2) {
  const toR = Math.PI / 180;
  const d1 = dec1 * toR, d2 = dec2 * toR;
  const cos_c = Math.sin(d1) * Math.sin(d2) +
    Math.cos(d1) * Math.cos(d2) * Math.cos((ra2 - ra1) * toR);
  return Math.acos(Math.max(-1, Math.min(1, cos_c))) * 180 / Math.PI;
}

// Half-angle tangent of the TAN (gnomonic) projection — the single sensitive scale
// atom. Pixel scale is (W/2)/tanHalfFov(fov); the WebGL shader consumes it directly.
// (The wrong small-angle form W/(fov·π/180) once shipped here; keep the one home.)
function tanHalfFov(fov) { return Math.tan(fov * Math.PI / 360); }

// Project stars onto a north-up TAN (gnomonic) image — same projection as photoUrl.
// East is left, north is up, center = (con.ra, con.dec), full width = con.fov degrees.
// Roll is applied downstream by the quiz canvas (ctx.rotate), so this stays north-up;
// the explorer's rolled camera path uses makeCamera instead.
function projectStarsTAN(stars, con, W, H) {
  const ra0 = con.ra * Math.PI / 180, dec0 = con.dec * Math.PI / 180;
  const scale = (W / 2) / tanHalfFov(con.fov);
  return stars.map(s => {
    const ra = s[0] * Math.PI / 180, dec = s[1] * Math.PI / 180;
    // facing = cosine of angle to view centre. facing > 0: in front of projection
    // plane; facing ≤ 0: behind (>90° away), coords invalid — dividing by a negative
    // facing flips signs and can land off-screen points on screen (phantom draws).
    const facing = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
    const xi = Math.cos(dec) * Math.sin(ra - ra0) / facing;
    const eta = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / facing;
    return { x: W / 2 - xi * scale, y: H / 2 - eta * scale, facing, mag: s[2], hint: s[3], name: s[4] };
  });
}

// A camera fixed at centre P (unit vector), up vector `up` (re-orthogonalized to P),
// field of view `fov` (degrees, full width), for a W×H canvas. One small deep interface
// over the rolled TAN (gnomonic) projection — forward project(), batch projectStars(),
// inverse unproject() — plus the derived frame the WebGL shader is fed from. The frame
// (right, up_perp) and the scale are computed once here, not re-derived per call.
//
// Replaces the old projectStarsCamera / vecToPixel / pixelToVec trio: same math, one home.
function makeCamera(P, up, fov, W, H) {
  const scale = (W / 2) / tanHalfFov(fov);
  const [cx, cy, cz] = P, [ux, uy, uz] = up;
  // right = P × up (screen-right), normalized; up_perp = right × P (true screen-up)
  let rx = cy*uz - cz*uy, ry = cz*ux - cx*uz, rz = cx*uy - cy*ux;
  const rlen = Math.sqrt(rx*rx + ry*ry + rz*rz);
  rx /= rlen; ry /= rlen; rz /= rlen;
  const upx = ry*cz - rz*cy, upy = rz*cx - rx*cz, upz = rx*cy - ry*cx;

  // Sky unit vector → canvas pixel. `facing` = cosine of angle to view centre; > 0
  // means in front of the camera. ALWAYS returned (never null) — callers guard on
  // `facing > 0`; a point behind (facing ≤ 0) yields phantom coords, so don't draw it.
  function project(v) {
    const facing = v[0]*cx + v[1]*cy + v[2]*cz;
    const xi  = -(v[0]*rx + v[1]*ry + v[2]*rz) / facing;
    const eta =  (v[0]*upx + v[1]*upy + v[2]*upz) / facing;
    return { x: W/2 - xi*scale, y: H/2 - eta*scale, facing };
  }

  // Project an array of [ra, dec, mag?, hint?, name?] stars, echoing the non-geometry
  // fields through for the draw loops (bare [ra, dec, 0] points just carry undefined).
  function projectStars(stars) {
    return stars.map(s => {
      const p = project(raDecToVec(s[0], s[1]));
      p.mag = s[2]; p.hint = s[3]; p.name = s[4];
      return p;
    });
  }

  // Inverse: canvas pixel → sky unit vector. No RA/Dec involved — poles aren't special.
  function unproject(px, py) {
    const xi  = (W/2 - px) / scale;  // positive = left on screen
    const eta = (H/2 - py) / scale;  // positive = up on screen
    const dx = cx - xi*rx + eta*upx;
    const dy = cy - xi*ry + eta*upy;
    const dz = cz - xi*rz + eta*upz;
    const dlen = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return [dx/dlen, dy/dlen, dz/dlen];
  }

  return {
    project, projectStars, unproject,
    right: [rx, ry, rz], up: [upx, upy, upz], center: [cx, cy, cz],
    tanHalfFov: tanHalfFov(fov),
  };
}

function pixelToRADec(px, py, ra0, dec0, fov, W, H) {
  const scale = (W / 2) / tanHalfFov(fov);
  const xi = (W / 2 - px) / scale;
  const eta = (H / 2 - py) / scale;
  const ra0r = ra0 * Math.PI / 180, dec0r = dec0 * Math.PI / 180;
  const rho = Math.sqrt(xi * xi + eta * eta);
  if (rho < 1e-10) return { ra: ra0, dec: dec0 };
  const c = Math.atan(rho);
  const sinC = Math.sin(c), cosC = Math.cos(c);
  const sinD0 = Math.sin(dec0r), cosD0 = Math.cos(dec0r);
  const dec_r = Math.asin(Math.max(-1, Math.min(1, cosC * sinD0 + eta * sinC * cosD0 / rho)));
  const ra_r = ra0r + Math.atan2(xi * sinC, rho * cosD0 * cosC - eta * sinD0 * sinC);
  return { ra: ((ra_r * 180 / Math.PI) + 360) % 360, dec: dec_r * 180 / Math.PI };
}

// Convert galactic coordinates (l, b) in degrees to equatorial (RA, Dec) J2000.
function galToRaDec(l, b) {
  const NGP_RA  = 192.859508 * Math.PI / 180;
  const NGP_DEC = 27.128336  * Math.PI / 180;
  const L_NCP   = 122.931918 * Math.PI / 180;
  const lr = l * Math.PI / 180, br = b * Math.PI / 180;
  const sinDec = Math.sin(br) * Math.sin(NGP_DEC) +
                 Math.cos(br) * Math.cos(NGP_DEC) * Math.cos(lr - L_NCP);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const ra  = Math.atan2(
    Math.cos(br) * Math.sin(lr - L_NCP),
    Math.sin(br) * Math.cos(NGP_DEC) - Math.cos(br) * Math.sin(NGP_DEC) * Math.cos(lr - L_NCP)
  ) + NGP_RA;
  return { ra: ((ra * 180 / Math.PI) + 360) % 360, dec: dec * 180 / Math.PI };
}

function raDecToVec(ra, dec) {
  const r = ra * Math.PI / 180, d = dec * Math.PI / 180;
  return [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
}
function vecToRaDec(v) {
  return {
    ra: ((Math.atan2(v[1], v[0]) * 180 / Math.PI) + 360) % 360,
    dec: Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI
  };
}
function rotZ(v, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [v[0]*c - v[1]*s, v[0]*s + v[1]*c, v[2]];
}
function cameraForward(P, R, v) {
  return rotZ(rotateByFromTo(v, P, [0,0,1]), R);
}
function cameraReverse(P, R, v) {
  return rotateByFromTo(rotZ(v, -R), [0,0,1], P);
}

function rotateByFromTo(c, from, to) {
  const dot = from[0]*to[0] + from[1]*to[1] + from[2]*to[2];
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (angle < 1e-10) return c;
  const ax = from[1]*to[2] - from[2]*to[1];
  const ay = from[2]*to[0] - from[0]*to[2];
  const az = from[0]*to[1] - from[1]*to[0];
  const len = Math.sqrt(ax*ax + ay*ay + az*az);
  if (len < 1e-10) return c;
  const [nx, ny, nz] = [ax/len, ay/len, az/len];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const d = nx*c[0] + ny*c[1] + nz*c[2];
  return [
    c[0]*cos + (ny*c[2] - nz*c[1])*sin + nx*d*(1-cos),
    c[1]*cos + (nz*c[0] - nx*c[2])*sin + ny*d*(1-cos),
    c[2]*cos + (nx*c[1] - ny*c[0])*sin + nz*d*(1-cos)
  ];
}

function solveAffine(src, dst) {
  const [[x1, y1], [x2, y2], [x3, y3]] = src;
  const [[u1, v1], [u2, v2], [u3, v3]] = dst;
  const det = x1 * (y2 - y3) - y1 * (x2 - x3) + (x2 * y3 - x3 * y2);
  const a = (u1 * (y2 - y3) - y1 * (u2 - u3) + (u2 * y3 - u3 * y2)) / det;
  const c = (x1 * (u2 - u3) - u1 * (x2 - x3) + (x2 * u3 - x3 * u2)) / det;
  const e = (x1 * (y2 * u3 - y3 * u2) - y1 * (x2 * u3 - x3 * u2) + u1 * (x2 * y3 - x3 * y2)) / det;
  const b = (v1 * (y2 - y3) - y1 * (v2 - v3) + (v2 * y3 - v3 * y2)) / det;
  const d = (x1 * (v2 - v3) - v1 * (x2 - x3) + (x2 * v3 - x3 * v2)) / det;
  const f = (x1 * (y2 * v3 - y3 * v2) - y1 * (x2 * v3 - x3 * v2) + v1 * (x2 * y3 - x3 * y2)) / det;
  return [a, b, c, d, e, f];
}

