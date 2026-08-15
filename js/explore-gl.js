// ═══════════════════════════════════════════════════════════
// EXPLORE MODE — WebGL renderer (photo + art layers)
// ═══════════════════════════════════════════════════════════

const MESH_GRID = 16; // subdivision resolution for photo/art meshes

const GL_VS = `
  attribute vec3 aSkyVec;
  attribute vec2 aTexCoord;
  uniform vec3 uRight, uUp, uCenter;
  uniform float uTanHalfFov, uAspect;
  varying vec2 vTexCoord;
  void main() {
    float d = dot(aSkyVec, uCenter);
    float x = dot(aSkyVec, uRight) / (d * uTanHalfFov);
    float y = dot(aSkyVec, uUp)   / (d * uTanHalfFov) * uAspect;
    gl_Position = vec4(d > 0.0 ? x : 2.0, d > 0.0 ? y : 2.0, 0.0, 1.0);
    vTexCoord = aTexCoord;
  }
`;

const GL_FS = `
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D uTex;
  uniform float uAlpha;
  uniform float uFloor;   // black-point crush: lift this floor, rescale (see issue #23)
  void main() {
    vec4 c = texture2D(uTex, vTexCoord);
    vec3 rgb = max(c.rgb - uFloor, 0.0) / max(1.0 - uFloor, 1e-4);
    gl_FragColor = vec4(rgb, c.a * uAlpha);
  }
`;

// Black-point crush for the photo layer. Each per-constellation JPG crop carries
// JPEG shadow-noise in its near-black background (values ~6–15) that reads as a
// blue-grey quilt once shadow gamma amplifies it. Subtracting this floor and
// rescaling crushes that noise to black while keeping real stars/nebulae. 12/255
// is the tuned compromise: it clears the quilt yet still keeps the faintest
// naked-eye stars as dim points (e.g. most of Orion's bow) rather than erasing
// them — measured against the π Orionis chain. See issue #23.
const PHOTO_BLACK_FLOOR = 12 / 255;

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

  // A lost context is not hypothetical here: instrumenting the phone caught a
  // 15087ms freeze followed 59ms later by webglcontextlost — the GPU process
  // dying and being recovered while the whole web process waited. Without these
  // handlers WebKit never restores the context, so every later frame drew into
  // a dead one, and every cached texture, mesh buffer and program handle became
  // a stale reference to an object that no longer exists.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();          // required, or the context is never restored
    glLostContext();
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    if (initExploreGL(canvas) && typeof drawExplore === 'function') drawExplore();
  }, false);

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
  glLoc.aspect    = gl.getUniformLocation(glProg, 'uAspect');
  glLoc.tex       = gl.getUniformLocation(glProg, 'uTex');
  glLoc.alpha     = gl.getUniformLocation(glProg, 'uAlpha');
  glLoc.floor     = gl.getUniformLocation(glProg, 'uFloor');

  gl.enable(gl.BLEND);
  return true;
}

// Everything GPU-side is gone once the context is lost, so every handle we hold
// is stale. Drop them all: the meshes keep their CPU-side Float32Arrays and
// rebuild their buffers on the next draw, and the textures re-upload from the
// images still in explorePhotoCache / artCache.
function glLostContext() {
  gl = null;
  glProg = null;
  glLoc = {};
  for (const k in glPhotoTex) delete glPhotoTex[k];
  for (const k in glArtTex) delete glArtTex[k];
  for (const cache of [glPhotoMesh, glArtMesh]) {
    for (const k in cache) {
      const m = cache[k];
      if (!m) continue;
      m._svBuf = m._tcBuf = m._ixBuf = null;   // handles from the dead context
    }
  }
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

// Feed the shader from a Camera (projection.js). The frame and half-angle are the
// Camera's single source of truth — the shader only uploads them, plus the GL aspect.
function glSetCamera(cam) {
  const W = gl.canvas.width, H = gl.canvas.height;
  gl.uniform3f(glLoc.right,  cam.right[0],  cam.right[1],  cam.right[2]);
  gl.uniform3f(glLoc.up,     cam.up[0],     cam.up[1],     cam.up[2]);
  gl.uniform3f(glLoc.center, cam.center[0], cam.center[1], cam.center[2]);
  gl.uniform1f(glLoc.tanHFov, cam.tanHalfFov);
  gl.uniform1f(glLoc.aspect, (W && H) ? W / H : 1.0);
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
  const src = artSrc(con.abbr);
  const art = ART[src];
  if (!art || art.anchors.length < 3) return null;
  const img = artCache[src];
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
// The buffers live on the mesh and are created once. This used to create three
// GPU buffers, upload ~9KB into them, draw, and delete all three — on EVERY
// call. Measured on an iPhone 15 Pro: 710 calls in 28 seconds, so about 2,130
// buffer allocations and frees and 6MB of uploads in half a minute, of which
// two thirds was re-uploading data that never changes.
//
// That churn is the leading suspect for what kills the GPU process. The stall
// being chased is not slow JavaScript: a heartbeat on the device caught a
// 15087ms pause followed 59ms later by a webglcontextlost event, which is the
// GPU process being recovered while the whole web process waits.
//
// sv and tc are static — glBuildPhotoMesh/glBuildArtMesh compute them once per
// constellation and the mesh is cached. Only the index list changes, because
// triangles behind the camera are culled per frame, so its buffer is allocated
// once at full size and rewritten with bufferSubData.
function glDrawMesh(mesh, tex, alpha, additive, camP, floor = 0) {
  if (!mesh || !tex) return;
  const { sv, tc, ix } = mesh;

  // One-time GPU allocation per mesh. glLostContext() clears these, because a
  // buffer from a dead context is a stale handle that must never be reused.
  if (!mesh._svBuf) {
    mesh._svBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh._svBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sv, gl.STATIC_DRAW);

    mesh._tcBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh._tcBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tc, gl.STATIC_DRAW);

    mesh._ixBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh._ixBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix.byteLength, gl.DYNAMIC_DRAW);

    // Scratch arrays were also re-allocated per call; they belong to the mesh.
    mesh._dots = new Float32Array(sv.length / 3);
    mesh._filtered = new Uint16Array(ix.length);
  }

  // Filter triangles where any vertex is behind the camera (d <= 0)
  const [cx, cy, cz] = camP;
  const n = sv.length / 3;
  const d = mesh._dots;
  for (let i = 0; i < n; i++)
    d[i] = sv[i*3]*cx + sv[i*3+1]*cy + sv[i*3+2]*cz;

  const filteredIx = mesh._filtered;
  let k = 0;
  for (let i = 0; i < ix.length; i += 3) {
    if (d[ix[i]] > 0 && d[ix[i+1]] > 0 && d[ix[i+2]] > 0) {
      filteredIx[k++] = ix[i]; filteredIx[k++] = ix[i+1]; filteredIx[k++] = ix[i+2];
    }
  }
  if (!k) return;

  gl.bindBuffer(gl.ARRAY_BUFFER, mesh._svBuf);
  gl.enableVertexAttribArray(glLoc.skyVec);
  gl.vertexAttribPointer(glLoc.skyVec, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, mesh._tcBuf);
  gl.enableVertexAttribArray(glLoc.texCoord);
  gl.vertexAttribPointer(glLoc.texCoord, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh._ixBuf);
  gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, filteredIx.subarray(0, k));

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(glLoc.tex, 0);
  gl.uniform1f(glLoc.alpha, alpha);
  gl.uniform1f(glLoc.floor, floor);
  gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  gl.drawElements(gl.TRIANGLES, k, gl.UNSIGNED_SHORT, 0);
}

// ── Public: draw photo layer ───────────────────────────────
function drawExplorePhotoLayerGL(con, cam) {
  if (!gl) return;
  const img = explorePhotoCache[con.abbr];
  if (!(img instanceof HTMLImageElement)) { loadExplorePhoto(con); return; }
  if (!glPhotoTex[con.abbr]) glPhotoTex[con.abbr] = glUploadTex(img);
  if (!glPhotoMesh[con.abbr]) glPhotoMesh[con.abbr] = glBuildPhotoMesh(con);
  glSetCamera(cam);
  glDrawMesh(glPhotoMesh[con.abbr], glPhotoTex[con.abbr], 1.0, false, cam.center, PHOTO_BLACK_FLOOR);
}

// ── Public: draw art layer ─────────────────────────────────
function drawExploreArtLayerGL(con, cam) {
  if (!gl) return;
  const src = artSrc(con.abbr);
  const art = ART[src];
  if (!art || art.anchors.length < 3) return;

  // Ensure art image loaded (artCache shared with render.js)
  if (!artCache[src]) {
    artCache[src] = 'loading';
    const img = new Image();
    img.onload = () => {
      artCache[src] = img;
      glArtTex[src] = glUploadTex(img);
      if (document.getElementById('screen-explore').classList.contains('active')) drawExplore();
    };
    img.onerror = () => { artCache[src] = 'error'; };
    img.src = art.url;
    return;
  }
  if (!(artCache[src] instanceof HTMLImageElement)) return;
  if (!glArtTex[src]) glArtTex[src] = glUploadTex(artCache[src]);
  if (!glArtMesh[con.abbr]) glArtMesh[con.abbr] = glBuildArtMesh(con);

  glSetCamera(cam);
  // Additive blend ≈ screen blend on near-black background
  glDrawMesh(glArtMesh[con.abbr], glArtTex[con.abbr], 0.5, true, cam.center);
}
