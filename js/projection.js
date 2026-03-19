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

function angularDist(ra1, dec1, ra2, dec2) {
  const toR = Math.PI / 180;
  const d1 = dec1 * toR, d2 = dec2 * toR;
  const cos_c = Math.sin(d1) * Math.sin(d2) +
    Math.cos(d1) * Math.cos(d2) * Math.cos((ra2 - ra1) * toR);
  return Math.acos(Math.max(-1, Math.min(1, cos_c))) * 180 / Math.PI;
}

// Project stars onto a TAN (gnomonic) image — same projection as photoUrl.
// East is left, north is up, center = (con.ra, con.dec), full width = con.fov degrees.
function projectStarsTAN(stars, con, W, H) {
  const ra0 = con.ra * Math.PI / 180, dec0 = con.dec * Math.PI / 180;
  const scale = (W / 2) / Math.tan(con.fov * Math.PI / 360);
  return stars.map(s => {
    const ra = s[0] * Math.PI / 180, dec = s[1] * Math.PI / 180;
    const d = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
    const xi = Math.cos(dec) * Math.sin(ra - ra0) / d;
    const eta = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / d;
    // d > 0: point is in front of projection plane; d ≤ 0: behind (>90° away),
    // coords are invalid — dividing by negative d flips signs and can produce
    // coordinates that accidentally land on screen, causing phantom draws.
    return { x: W / 2 - xi * scale, y: H / 2 - eta * scale, d, mag: s[2], hint: s[3], name: s[4] };
  });
}

// Sky unit vector → canvas pixel, given camera centre c, up vector, fov, and canvas size.
// Exact inverse of pixelToVec. Returns {x, y, d} or null if behind camera (d <= 0).
function vecToPixel(v, c, up, fov, W, H) {
  const scale = (W/2) / Math.tan(fov * Math.PI / 360);
  const [cx, cy, cz] = c, [ux, uy, uz] = up;
  let rx = cy*uz - cz*uy, ry = cz*ux - cx*uz, rz = cx*uy - cy*ux;
  const rlen = Math.sqrt(rx*rx + ry*ry + rz*rz);
  rx /= rlen; ry /= rlen; rz /= rlen;
  const upx = ry*cz - rz*cy, upy = rz*cx - rx*cz, upz = rx*cy - ry*cx;
  const d = v[0]*cx + v[1]*cy + v[2]*cz;
  if (d <= 0) return null;
  const xi  = -(v[0]*rx + v[1]*ry + v[2]*rz) / d;
  const eta =  (v[0]*upx + v[1]*upy + v[2]*upz) / d;
  return { x: W/2 - xi*scale, y: H/2 - eta*scale, d };
}

// Project an array of [ra, dec, mag, hint, name] stars using an explicit camera frame
// (centre P, up vector, fov) rather than assuming north-up. Replaces projectStarsTAN
// in the explorer so roll works correctly.
function projectStarsCamera(stars, P, up, fov, W, H) {
  const scale = (W/2) / Math.tan(fov * Math.PI / 360);
  const [cx, cy, cz] = P, [ux, uy, uz] = up;
  let rx = cy*uz - cz*uy, ry = cz*ux - cx*uz, rz = cx*uy - cy*ux;
  const rlen = Math.sqrt(rx*rx + ry*ry + rz*rz);
  rx /= rlen; ry /= rlen; rz /= rlen;
  const upx = ry*cz - rz*cy, upy = rz*cx - rx*cz, upz = rx*cy - ry*cx;
  return stars.map(s => {
    const v = raDecToVec(s[0], s[1]);
    const d = v[0]*cx + v[1]*cy + v[2]*cz;
    const xi  = -(v[0]*rx + v[1]*ry + v[2]*rz) / d;
    const eta =  (v[0]*upx + v[1]*upy + v[2]*upz) / d;
    return { x: W/2 - xi*scale, y: H/2 - eta*scale, d, mag: s[2], hint: s[3], name: s[4] };
  });
}

// Inverse TAN (gnomonic) projection: canvas pixel → RA/Dec
// Convert pixel to 3D unit direction vector given view-centre c and camera up vector.
// No RA/Dec coordinate system involved — poles are not special.
function pixelToVec(px, py, c, up, fov, W, H) {
  const scale = (W/2) / Math.tan(fov * Math.PI / 360);
  const xi  = (W/2 - px) / scale;  // positive = left on screen
  const eta = (H/2 - py) / scale;  // positive = up on screen
  // right = c × up (screen-right direction), then re-derive up perp to c
  const [cx, cy, cz] = c, [ux, uy, uz] = up;
  let rx = cy*uz - cz*uy, ry = cz*ux - cx*uz, rz = cx*uy - cy*ux;
  const rlen = Math.sqrt(rx*rx + ry*ry + rz*rz);
  rx /= rlen; ry /= rlen; rz /= rlen;
  // up_perp = right × c (ensures orthogonality)
  const upx = ry*cz - rz*cy, upy = rz*cx - rx*cz, upz = rx*cy - ry*cx;
  // d = normalize(c - xi*right + eta*up_perp)
  // (xi positive = left = east = opposite of screen-right)
  const dx = cx - xi*rx + eta*upx;
  const dy = cy - xi*ry + eta*upy;
  const dz = cz - xi*rz + eta*upz;
  const dlen = Math.sqrt(dx*dx + dy*dy + dz*dz);
  return [dx/dlen, dy/dlen, dz/dlen];
}

function pixelToRADec(px, py, ra0, dec0, fov, W, H) {
  const scale = (W / 2) / Math.tan(fov * Math.PI / 360);
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

// ═══════════════════════════════════════════════════════════
// PROJECTION  (RA/Dec → canvas x/y)
// ═══════════════════════════════════════════════════════════

// Compute projection parameters from a constellation's star array.
// Returns {cRA, cDec, cosD, scale, wrapped} — reusable for any RA/Dec point.
function getProjection(stars, W, H) {
  const PAD = 0.12;
  let ras = stars.map(s => s[0]);
  const wrapped = Math.max(...ras) - Math.min(...ras) > 180;
  if (wrapped) ras = ras.map(r => r < 180 ? r + 360 : r);
  const decs = stars.map(s => s[1]);
  const cRA = (Math.min(...ras) + Math.max(...ras)) / 2;
  const cDec = (Math.min(...decs) + Math.max(...decs)) / 2;
  const cosD = Math.cos(cDec * Math.PI / 180);
  const raSky = (Math.max(...ras) - Math.min(...ras)) * cosD;
  const decSp = Math.max(...decs) - Math.min(...decs);
  const scale = Math.max(raSky, decSp) / (1 - 2 * PAD) || 1;
  return { cRA, cDec, cosD, scale, wrapped, W, H };
}

// Project a single RA/Dec point using pre-computed projection params.
function projectPoint(ra, dec, p) {
  let r = ra;
  if (p.wrapped && r < 180) r += 360;
  return {
    x: p.W / 2 + (p.cRA - r) * p.cosD / p.scale * p.W,
    y: p.H / 2 - (dec - p.cDec) / p.scale * p.H
  };
}

// Project all stars in a constellation to canvas coords.
function projectStars(stars, W, H) {
  const p = getProjection(stars, W, H);
  return stars.map(s => ({ ...projectPoint(s[0], s[1], p), mag: s[2], hint: s[3], name: s[4] }));
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

function pointInPolygon(ra, dec, poly) {
  // Ray-casting in RA/Dec space. RA is circular (0–360), so we normalize all
  // polygon vertices to within ±180° of the test point before testing. Without
  // this, a polygon near RA=0 (vertices spanning e.g. 350°–10°) would be split
  // across the 0/360 seam and the ray would miss it.
  //
  // NOTE: always pre-filter by angular distance before calling this. The RA
  // normalization maps far-away polygon vertices to large-but-finite RA values,
  // and the rightward ray from the test point can cross those phantom vertices,
  // producing false positives for constellations on the opposite side of the sky.
  const norm = poly.map(([r, d]) => {
    let dr = r - ra;
    if (dr > 180) dr -= 360;
    if (dr < -180) dr += 360;
    return [ra + dr, d];
  });
  let inside = false;
  for (let i = 0, j = norm.length - 1; i < norm.length; j = i++) {
    const [xi, yi] = norm[i], [xj, yj] = norm[j];
    if (((yi > dec) !== (yj > dec)) && ra < (xj - xi) * (dec - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
