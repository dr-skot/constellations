// ═══════════════════════════════════════════════════════════
// EXPLORE MODE — WebGL renderer (photo + art layers)
// ═══════════════════════════════════════════════════════════

const MESH_GRID = 16; // subdivision resolution for photo/art meshes

const GL_VS = `
  attribute vec3 aSkyVec;
  attribute vec2 aTexCoord;
  uniform vec3 uRight, uUp, uCenter;
  uniform float uTanHalfFov;
  varying vec2 vTexCoord;
  void main() {
    float d = dot(aSkyVec, uCenter);
    float x = dot(aSkyVec, uRight) / (d * uTanHalfFov);
    float y = dot(aSkyVec, uUp)   / (d * uTanHalfFov);
    gl_Position = vec4(d > 0.0 ? x : 2.0, d > 0.0 ? y : 2.0, 0.0, 1.0);
    vTexCoord = aTexCoord;
  }
`;

const GL_FS = `
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D uTex;
  uniform float uAlpha;
  void main() {
    vec4 c = texture2D(uTex, vTexCoord);
    gl_FragColor = vec4(c.rgb, c.a * uAlpha);
  }
`;

let gl = null;
let glProg = null;
let glLoc = {};  // attrib/uniform locations

// CPU-side mesh cache (Float32Arrays, keyed by abbr)
const glPhotoMesh = {};
const glArtMesh   = {};

// GPU texture cache (WebGLTexture, keyed by abbr)
const glPhotoTex = {};
const glArtTex   = {};

// ── Init ──────────────────────────────────────────────────
function initExploreGL(canvas) {
  gl = canvas.getContext('webgl', { alpha: false }) ||
       canvas.getContext('experimental-webgl', { alpha: false });
  if (!gl) { console.warn('WebGL not available'); return false; }

  const vs = glCompile(gl.VERTEX_SHADER,   GL_VS);
  const fs = glCompile(gl.FRAGMENT_SHADER, GL_FS);
  if (!vs || !fs) return false;

  glProg = gl.createProgram();
  gl.attachShader(glProg, vs); gl.attachShader(glProg, fs);
  gl.linkProgram(glProg);
  if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) {
    console.error('GL link:', gl.getProgramInfoLog(glProg)); return false;
  }
  gl.useProgram(glProg);

  glLoc.skyVec    = gl.getAttribLocation (glProg, 'aSkyVec');
  glLoc.texCoord  = gl.getAttribLocation (glProg, 'aTexCoord');
  glLoc.right     = gl.getUniformLocation(glProg, 'uRight');
  glLoc.up        = gl.getUniformLocation(glProg, 'uUp');
  glLoc.center    = gl.getUniformLocation(glProg, 'uCenter');
  glLoc.tanHFov   = gl.getUniformLocation(glProg, 'uTanHalfFov');
  glLoc.tex       = gl.getUniformLocation(glProg, 'uTex');
  glLoc.alpha     = gl.getUniformLocation(glProg, 'uAlpha');

  gl.enable(gl.BLEND);
  return true;
}

function glCompile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader:', gl.getShaderInfoLog(s)); return null;
  }
  return s;
}

// ── Per-frame: clear + set camera ─────────────────────────
function glClear(W, H) {
  if (!gl) return;
  gl.viewport(0, 0, W, H);
  gl.clearColor(0.004, 0.008, 0.032, 1.0); // #010208
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function glSetCamera(camP, camUp, fov) {
  const [cx, cy, cz] = camP, [ux, uy, uz] = camUp;
  let rx = cy*uz - cz*uy, ry = cz*ux - cx*uz, rz = cx*uy - cy*ux;
  const rl = Math.sqrt(rx*rx + ry*ry + rz*rz);
  rx /= rl; ry /= rl; rz /= rl;
  const upx = ry*cz - rz*cy, upy = rz*cx - rx*cz, upz = rx*cy - ry*cx;
  gl.uniform3f(glLoc.right,  rx, ry, rz);
  gl.uniform3f(glLoc.up,     upx, upy, upz);
  gl.uniform3f(glLoc.center, cx, cy, cz);
  gl.uniform1f(glLoc.tanHFov, Math.tan(fov * Math.PI / 360));
}

// ── Mesh builders ─────────────────────────────────────────
function glBuildPhotoMesh(con) {
  const G = MESH_GRID, IW = 640, IH = 640, gw = G + 1;
  const sv = new Float32Array(gw * gw * 3);
  const tc = new Float32Array(gw * gw * 2);
  const ix = new Uint16Array(G * G * 6);
  for (let gy = 0; gy <= G; gy++) {
    for (let gx = 0; gx <= G; gx++) {
      const rd = pixelToRADec(gx/G * IW, gy/G * IH, con.ra, con.dec, con.fov, IW, IH);
      const v = raDecToVec(rd.ra, rd.dec);
      const i = gy * gw + gx;
      sv[i*3]=v[0]; sv[i*3+1]=v[1]; sv[i*3+2]=v[2];
      tc[i*2]=gx/G; tc[i*2+1]=1-gy/G;
    }
  }
  let k = 0;
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    const tl=gy*gw+gx, tr=tl+1, bl=(gy+1)*gw+gx, br=bl+1;
    ix[k++]=tl; ix[k++]=tr; ix[k++]=bl;
    ix[k++]=tr; ix[k++]=br; ix[k++]=bl;
  }
  return { sv, tc, ix };
}

function glBuildArtMesh(con) {
  const art = ART[con.abbr];
  if (!art || art.anchors.length < 3) return null;
  const img = artCache[con.abbr];
  if (!(img instanceof HTMLImageElement)) return null;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const REF = 1000, G = MESH_GRID, gw = G + 1;
  const refPts = projectStarsTAN(art.anchors.map(a => [a.ra, a.dec, 0]), con, REF, REF);
  const a2r = solveAffine(
    art.anchors.map(a => [a.px * iw, a.py * ih]),
    refPts.map(p => [p.x, p.y])
  );
  const sv = new Float32Array(gw * gw * 3);
  const tc = new Float32Array(gw * gw * 2);
  const ix = new Uint16Array(G * G * 6);
  for (let gy = 0; gy <= G; gy++) {
    for (let gx = 0; gx <= G; gx++) {
      const px = gx/G * iw, py = gy/G * ih;
      const qx = a2r[0]*px + a2r[2]*py + a2r[4];
      const qy = a2r[1]*px + a2r[3]*py + a2r[5];
      const rd = pixelToRADec(qx, qy, con.ra, con.dec, con.fov, REF, REF);
      const v = raDecToVec(rd.ra, rd.dec);
      const i = gy * gw + gx;
      sv[i*3]=v[0]; sv[i*3+1]=v[1]; sv[i*3+2]=v[2];
      tc[i*2]=gx/G; tc[i*2+1]=1-gy/G;
    }
  }
  let k = 0;
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    const tl=gy*gw+gx, tr=tl+1, bl=(gy+1)*gw+gx, br=bl+1;
    ix[k++]=tl; ix[k++]=tr; ix[k++]=bl;
    ix[k++]=tr; ix[k++]=br; ix[k++]=bl;
  }
  return { sv, tc, ix };
}

// ── Texture upload ─────────────────────────────────────────
function glUploadTex(img) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// ── Draw one mesh ─────────────────────────────────────────
function glDrawMesh(mesh, tex, alpha, additive) {
  if (!mesh || !tex) return;
  const { sv, tc, ix } = mesh;

  const svBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, svBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sv, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(glLoc.skyVec);
  gl.vertexAttribPointer(glLoc.skyVec, 3, gl.FLOAT, false, 0, 0);

  const tcBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tcBuf);
  gl.bufferData(gl.ARRAY_BUFFER, tc, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(glLoc.texCoord);
  gl.vertexAttribPointer(glLoc.texCoord, 2, gl.FLOAT, false, 0, 0);

  const ixBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ixBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.STATIC_DRAW);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(glLoc.tex, 0);
  gl.uniform1f(glLoc.alpha, alpha);
  gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  gl.drawElements(gl.TRIANGLES, ix.length, gl.UNSIGNED_SHORT, 0);

  gl.deleteBuffer(svBuf);
  gl.deleteBuffer(tcBuf);
  gl.deleteBuffer(ixBuf);
}

// ── Public: draw photo layer ───────────────────────────────
function drawExplorePhotoLayerGL(con, camP, camUp, fov) {
  if (!gl) return;
  const img = explorePhotoCache[con.abbr];
  if (!(img instanceof HTMLImageElement)) { loadExplorePhoto(con); return; }
  if (!glPhotoTex[con.abbr]) glPhotoTex[con.abbr] = glUploadTex(img);
  if (!glPhotoMesh[con.abbr]) glPhotoMesh[con.abbr] = glBuildPhotoMesh(con);
  glSetCamera(camP, camUp, fov);
  glDrawMesh(glPhotoMesh[con.abbr], glPhotoTex[con.abbr], 1.0, false);
}

// ── Public: draw art layer ─────────────────────────────────
function drawExploreArtLayerGL(con, camP, camUp, fov) {
  if (!gl) return;
  const art = ART[con.abbr];
  if (!art || art.anchors.length < 3) return;

  // Ensure art image loaded (artCache shared with render.js)
  if (!artCache[con.abbr]) {
    artCache[con.abbr] = 'loading';
    const img = new Image();
    img.onload = () => {
      artCache[con.abbr] = img;
      glArtTex[con.abbr] = glUploadTex(img);
      if (document.getElementById('screen-explore').classList.contains('active')) drawExplore();
    };
    img.onerror = () => { artCache[con.abbr] = 'error'; };
    img.src = art.url;
    return;
  }
  if (!(artCache[con.abbr] instanceof HTMLImageElement)) return;
  if (!glArtTex[con.abbr]) glArtTex[con.abbr] = glUploadTex(artCache[con.abbr]);
  if (!glArtMesh[con.abbr]) glArtMesh[con.abbr] = glBuildArtMesh(con);

  glSetCamera(camP, camUp, fov);
  // Additive blend ≈ screen blend on near-black background
  glDrawMesh(glArtMesh[con.abbr], glArtTex[con.abbr], 0.5, true);
}
