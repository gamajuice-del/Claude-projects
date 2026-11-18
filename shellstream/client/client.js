// =====================================================================================
//  ShellStream client
//    - receives "shells": layered, depth-carrying, topology-annotated views of the world
//    - re-projects them every display refresh with the *current* local camera (0 network latency)
//    - runs the game (movement, collision, pickups) locally and authoritatively
// =====================================================================================
'use strict';

const QS = new URLSearchParams(location.search);
const TEST = QS.has('test');
const CFG = {
  fov: parseFloat(QS.get('fov') || '90'),
  sens: parseFloat(QS.get('sens') || '0.0022'),
  maxInputHz: 120,
  orbs: QS.get('orbs') !== '0',
  cubic: QS.get('cubic') !== '0',      // bicubic reconstruction of re-projected layers (default on)
};
let MODE = QS.get('mode') || 'shell';          // shell | classic | rot | noback | stale

// ------------------------------------------------------------------ GL setup
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: true,
  desynchronized: true, powerPreference: 'high-performance', preserveDrawingBuffer: TEST });
if (!gl) document.body.innerHTML = '<p style="padding:20px">WebGL2 is required.</p>';

function resize() {
  let w, h;
  if (QS.get('w')) { w = +QS.get('w'); h = +QS.get('h'); canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
  else {
    const dpr = Math.min(window.devicePixelRatio || 1, parseFloat(QS.get('dpr') || '2'));
    w = Math.round(canvas.clientWidth * dpr); h = Math.round(canvas.clientHeight * dpr);
    const cap = 2560; if (w > cap) { h = Math.round(h * cap / w); w = cap; }
  }
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
resize(); addEventListener('resize', resize);

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

// Attribute-less, topology-aware mesh warp.  Every triangle of the view's texel grid is
// re-projected with the current camera.  A triangle is "torn" iff one of its three edges is not
// connected in the server's topology map (computed from exact hit normals); torn triangles are
// dropped (front/back layers) or pushed to the background (omni layer, the fallback).
const WARP_VS = `#version 300 es
precision highp float; precision highp int;
uniform highp usampler2D uDepth;
uniform highp usampler2D uConn;
uniform ivec4 uRect;      // view rect in geometry texels
uniform vec2 uSheetPx;    // colour sheet size (px)
uniform float uDs;        // colour px per geometry texel
uniform vec3 uO, uR, uU, uF;
uniform vec4 uTan;        // l r b t
uniform float uZn;
uniform mat4 uVP;         // camera-relative view-projection
uniform vec3 uCam;
uniform int uRole;        // 0 drop torn, 1 push torn to background, 2 everything at infinity, 3 ignore topology (naive)
uniform float uBias;
uniform vec2 uViewport;
uniform int uGuard;       // 1 for the background band: drop any triangle stretched far beyond its rotation-only size
// Texture coordinates must be affine in the *source* image, not perspective-correct in the target view:
// we interpolate (uv * z_src, z_src) perspective-correctly and divide per fragment (exact for any motion).
out vec3 vUVz;
vec3 rayDir(ivec2 t) {
  vec2 s = (vec2(t) + 0.5) / vec2(uRect.zw);
  return uF + uR * mix(uTan.x, uTan.y, s.x) + uU * mix(uTan.w, uTan.z, s.y);
}
float zOf(uint c) { return uZn / max(float(c - 2u) / 65533.0, 1e-7); }
vec4 clipOf(ivec2 t, uint c) {
  vec3 d = rayDir(t);
  if (c == 0u) return uVP * vec4(d, 0.0);
  return uVP * vec4(uO + d * (zOf(c) * uBias) - uCam, 1.0);
}
vec2 scr(ivec2 t, uint c) {               // screen position in pixels (or -1e9 if behind the camera)
  vec4 q = clipOf(t, c);
  return q.w > 1e-6 ? q.xy / q.w * 0.5 * uViewport : vec2(-1e9);
}
vec2 scrRot(ivec2 t) {
  vec4 q = uVP * vec4(rayDir(t), 0.0);
  return q.w > 1e-6 ? q.xy / q.w * 0.5 * uViewport : vec2(1e9);
}
void emit(ivec2 tUV, uint c, ivec2 tPos, bool atInfinity) {
  vec2 uv = (vec2(uRect.xy + tUV) + 0.5) * uDs / uSheetPx;
  vec3 d = rayDir(tPos);
  if (atInfinity || c == 0u) { gl_Position = uVP * vec4(d, 0.0); vUVz = vec3(uv, 1.0); return; }
  float z = zOf(c);
  gl_Position = uVP * vec4(uO + d * (z * uBias) - uCam, 1.0);
  vUVz = vec3(uv * z, z);
}
void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUVz = vec3(0.0, 0.0, 1.0); }
void main() {
  int tri = gl_VertexID / 3, corner = gl_VertexID - tri * 3;
  int quad = tri >> 1, hi = tri & 1;
  int qw = uRect.z - 1;
  int qx = quad % qw, qy = quad / qw;
  ivec2 a = ivec2(qx, qy), b = ivec2(qx + 1, qy), c = ivec2(qx, qy + 1), d = ivec2(qx + 1, qy + 1);
  uint ca = texelFetch(uConn, uRect.xy + a, 0).r;
  ivec2 p0, p1, p2; bool conn;
  if (hi == 0) { p0 = a; p1 = b; p2 = c; conn = (ca & 7u) == 7u; }
  else {
    p0 = b; p1 = d; p2 = c;
    uint cb = texelFetch(uConn, uRect.xy + b, 0).r, cc = texelFetch(uConn, uRect.xy + c, 0).r;
    conn = ((cb & 2u) != 0u) && ((cc & 1u) != 0u) && ((ca & 4u) != 0u);
  }
  if (uRole == 3) conn = true;
  ivec2 me = corner == 0 ? p0 : (corner == 1 ? p1 : p2);
  uint code = texelFetch(uDepth, uRect.xy + me, 0).r;
  if (code == 1u) { cull(); return; }
  if (uGuard == 1) {
    // The band only fills small disocclusions. A band triangle that crossed behind the camera or grew far
    // beyond its rotation-only footprint (grazing geometry right next to the camera) is never right.
    uint g0 = texelFetch(uDepth, uRect.xy + p0, 0).r, g1 = texelFetch(uDepth, uRect.xy + p1, 0).r,
         g2 = texelFetch(uDepth, uRect.xy + p2, 0).r;
    if (g0 == 1u || g1 == 1u || g2 == 1u) { cull(); return; }
    vec2 s0 = scr(p0, g0), s1 = scr(p1, g1), s2 = scr(p2, g2);
    vec2 r0 = scrRot(p0), r1 = scrRot(p1), r2 = scrRot(p2);
    float lf = max(max(distance(s0, s1), distance(s1, s2)), distance(s2, s0));
    float lr = max(max(distance(r0, r1), distance(r1, r2)), distance(r2, r0));
    if (s0.x < -1e8 || s1.x < -1e8 || s2.x < -1e8 || lf > 3.0 * lr + 4.0) { cull(); return; }
  }
  if (uRole == 2) { emit(me, code, me, true); return; }
  if (!conn) {
    uint c0 = texelFetch(uDepth, uRect.xy + p0, 0).r, c1 = texelFetch(uDepth, uRect.xy + p1, 0).r,
         c2 = texelFetch(uDepth, uRect.xy + p2, 0).r;
    if (c0 == 1u || c1 == 1u || c2 == 1u) { cull(); return; }
    // Motion-adaptive tearing: a torn triangle is still drawn as a rubber sheet while its on-screen size is
    // within ~1.5 px of its rotation-only footprint (no visible gap has opened yet: exact edges when still).
    vec2 s0 = scr(p0, c0), s1 = scr(p1, c1), s2 = scr(p2, c2);
    vec2 r0 = scrRot(p0), r1 = scrRot(p1), r2 = scrRot(p2);
    float lf = max(max(distance(s0, s1), distance(s1, s2)), distance(s2, s0));
    float lr = max(max(distance(r0, r1), distance(r1, r2)), distance(r2, r0));
    bool small = lf <= lr + 1.5 && s0.x > -1e8 && s1.x > -1e8 && s2.x > -1e8;
    if (!small && uRole == 0) { cull(); return; }
    if (uRole == 1) {
      // fallback layer: torn triangles always sit at the *background* depth (never in front of a sharper
      // layer); once a gap has opened they also take the background colour (flat), not the occluder's
      ivec2 far = p0; uint cm = c0;
      if (c1 < cm) { cm = c1; far = p1; }
      if (c2 < cm) { cm = c2; far = p2; }
      emit(small ? me : far, cm, me, false);
      return;
    }
  }
  emit(me, code, me, false);
}`;
// Catmull-Rom (bicubic) reconstruction with 9 bilinear taps: noticeably sharper than plain bilinear when a
// shell texel lands between display pixels, which is always the case after re-projection.
const WARP_FS = `#version 300 es
precision highp float;
uniform sampler2D uColor; uniform int uCubic; in vec3 vUVz; out vec4 o;
vec3 catmullRom(vec2 uv) {
  vec2 ts = vec2(textureSize(uColor, 0));
  vec2 sp = uv * ts, tp1 = floor(sp - 0.5) + 0.5, f = sp - tp1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, o12 = w2 / w12;
  vec2 t0 = (tp1 - 1.0) / ts, t3 = (tp1 + 2.0) / ts, t12 = (tp1 + o12) / ts;
  vec3 r = texture(uColor, vec2(t0.x, t0.y)).rgb * w0.x * w0.y + texture(uColor, vec2(t12.x, t0.y)).rgb * w12.x * w0.y
         + texture(uColor, vec2(t3.x, t0.y)).rgb * w3.x * w0.y + texture(uColor, vec2(t0.x, t12.y)).rgb * w0.x * w12.y
         + texture(uColor, vec2(t12.x, t12.y)).rgb * w12.x * w12.y + texture(uColor, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
         + texture(uColor, vec2(t0.x, t3.y)).rgb * w0.x * w3.y + texture(uColor, vec2(t12.x, t3.y)).rgb * w12.x * w3.y
         + texture(uColor, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
  return max(r, vec3(0.0));
}
void main() { vec2 uv = vUVz.xy / vUVz.z; o = vec4(uCubic == 1 ? catmullRom(uv) : texture(uColor, uv).rgb, 1.0); }`;

const ORB_VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aInst;   // xyz, radius
layout(location=2) in vec3 aCol;
uniform mat4 uVP; uniform vec3 uCam; uniform int uGlow;
out vec3 vN; out vec3 vCol; out vec2 vQ; out vec3 vV;
void main() {
  vCol = aCol;
  if (uGlow == 1) {                       // camera-facing glow quad
    vec3 c = aInst.xyz - uCam;
    vec3 fw = normalize(c); vec3 rt = normalize(cross(fw, vec3(0,1,0))); vec3 up = cross(rt, fw);
    float s = aInst.w * 4.0; vQ = aPos.xy;
    gl_Position = uVP * vec4(c + (rt * aPos.x + up * aPos.y) * s, 1.0);
  } else {
    vN = aPos; vec3 w = aInst.xyz + aPos * aInst.w;
    vV = normalize(uCam - w);
    gl_Position = uVP * vec4(w - uCam, 1.0);
  }
}`;
const ORB_FS = `#version 300 es
precision highp float; precision highp int;
uniform int uGlow; in vec3 vN; in vec3 vCol; in vec2 vQ; in vec3 vV; out vec4 o;
void main() {
  if (uGlow == 1) { float r = length(vQ); float g = exp(-r * r * 9.0) * 0.55; o = vec4(vCol * g, 1.0); }
  else { float rim = 1.0 - max(dot(normalize(vN), vV), 0.0); o = vec4(mix(vec3(1.0), vCol, 0.35 + 0.65 * rim) * (1.0 + rim), 1.0); }
}`;

const warpProg = program(WARP_VS, WARP_FS);
const orbProg = program(ORB_VS, ORB_FS);
const emptyVAO = gl.createVertexArray();

// ------------------------------------------------------------------ math
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
function basis(yaw, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy];
  const u = V.cross(r, f); const l = V.len(u);
  return { r, u: V.mul(u, 1 / l), f };
}
// camera-relative view-projection, infinite far plane (points at infinity have w = 0)
// eps > 0 keeps points at infinity inside the far plane; layers drawn *behind* others at infinity (the omni
// fallback) use a smaller eps so depth ties at infinity are resolved deterministically, not per pixel.
function viewProj(b, fovx, aspect, eps = 4e-6) {
  const fx = 1 / Math.tan(fovx / 2), fy = fx * aspect, n = 0.05;
  const { r, u, f } = b;
  const Vm = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, 0, 0, 0, 1];
  const Pm = [fx, 0, 0, 0, 0, fy, 0, 0, 0, 0, -(1 - eps), -1, 0, 0, -2 * n, 0];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
    let s = 0; for (let k = 0; k < 4; k++) s += Pm[k * 4 + rr] * Vm[c * 4 + k];
    out[c * 4 + rr] = s;
  }
  return out;
}

// ------------------------------------------------------------------ decode worker
const WORKER_SRC = `
async function inflate(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function undepth(u8, w, h) {           // JPEG-LS MED prediction + zig-zag residuals, byte planes
  const n = w * h, out = new Uint16Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x, zz = u8[i] | (u8[n + i] << 8), r = (zz >>> 1) ^ -(zz & 1);
      const L = x > 0 ? out[i - 1] : 0, U = y > 0 ? out[i - w] : 0, UL = x > 0 && y > 0 ? out[i - w - 1] : 0;
      const mx = L > U ? L : U, mn = L > U ? U : L;
      const p = UL >= mx ? mn : (UL <= mn ? mx : L + U - UL);
      out[i] = (r + p) & 0xFFFF;
    }
  }
  return out;
}
self.onmessage = async (e) => {
  const buf = e.data.buf, tRecv = e.data.tRecv;
  const t0 = performance.timeOrigin + performance.now();
  const dv = new DataView(buf), hlen = dv.getUint32(0, true);
  const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen)));
  const base = 4 + hlen, sl = (d) => new Uint8Array(buf, base + d[0], d[1]);
  const tr = [], jobs = [];
  for (const sh of hdr.sheets) {
    for (const t of sh.tiles)
      jobs.push(createImageBitmap(new Blob([sl(t.data)], { type: 'image/jpeg' }),
        { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' })
        .then((b) => { t.bitmap = b; tr.push(b); }));
    jobs.push(inflate(sl(sh.depth.data)).then((u8) => { sh.depthArr = undepth(u8, sh.depth.w, sh.depth.h); tr.push(sh.depthArr.buffer); }));
    jobs.push(inflate(sl(sh.conn.data)).then((u8) => { sh.connArr = u8; tr.push(u8.buffer); }));
  }
  if (hdr.brick) jobs.push(inflate(sl(hdr.brick.data)).then((u8) => { hdr.brick.arr = new Int8Array(u8.buffer); tr.push(u8.buffer); }));
  await Promise.all(jobs);
  hdr.tRecv = tRecv; hdr.tDecStart = t0; hdr.tDecoded = performance.timeOrigin + performance.now(); hdr.nbytes = buf.byteLength;
  self.postMessage(hdr, tr);
};`;
const worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
const absNow = () => performance.timeOrigin + performance.now();

// ------------------------------------------------------------------ shell textures (double buffered)
const texPool = {};   // "slot:sheet" -> { sets: [set0, set1], flip }
function mkTex() { return gl.createTexture(); }
function texSet(key) {
  if (!texPool[key]) texPool[key] = { sets: [0, 1].map(() => ({ color: mkTex(), depth: mkTex(), conn: mkTex() })), flip: 0 };
  const p = texPool[key]; const ts = p.sets[p.flip]; p.flip ^= 1;     // double-buffered per slot
  return ts;
}
// Every shell the server sends belongs to a *slot* (A = predicted centre; BL/BR/BC = hedge centres rendered by the
// second GPU). The client keeps the newest shell of every slot and composites all of them (section 2.10).
const slots = {};
let shell = null;          // newest message (its A group is "the" shell for the single-shell modes)
let shellFrozen = false;   // test hook: stop accepting new shells
const stats = { frames: 0, bytes: 0, shells: 0, lastShells: [], frameTimes: [], inputAges: [], rtt: 50, srv: {} };

function uploadShell(h) {
  const t0 = absNow();
  const gm = h.groups || [{ slot: 'A', center: h.center }];
  for (const sh of h.sheets) {
    const ts = texSet(gm[sh.group || 0].slot + ':' + sh.name);
    gl.bindTexture(gl.TEXTURE_2D, ts.color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sh.W, sh.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const t of sh.tiles) { gl.texSubImage2D(gl.TEXTURE_2D, 0, t.x, t.y, gl.RGBA, gl.UNSIGNED_BYTE, t.bitmap); t.bitmap.close(); delete t.bitmap; }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, ts.depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, sh.depth.w, sh.depth.h, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, sh.depthArr);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, ts.conn);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, sh.depth.w, sh.depth.h, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, sh.connArr);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    sh.tex = ts; delete sh.depthArr; delete sh.connArr;
  }
  // register the groups of this message by slot (omni is global: newest wins)
  gm.forEach((g, gi) => {
    const shs = h.sheets.filter((x) => (x.group || 0) === gi);
    const grp = { slot: g.slot, center: g.center, t: absNow(), upd: stats.shells, sheets: Object.fromEntries(shs.map((x) => [x.name, x])) };
    if (grp.sheets.omni) { slots.__omni = grp.sheets.omni; delete grp.sheets.omni; }
    slots[g.slot] = grp;
  });
  if (h.brick) game.brick = h.brick;
  h.tReady = absNow(); h.uploadMs = h.tReady - t0;
  shell = h;
  stats.shells++; stats.bytes += h.nbytes; stats.srv = h.stats;
  stats.lastShells.push({ id: h.id, t: h.tReady, bytes: h.nbytes, inSeq: h.in_seq, inT: h.in_t,
    decodeMs: h.tDecoded - h.tDecStart, uploadMs: h.uploadMs, netMs: 0 });
  if (stats.lastShells.length > 600) stats.lastShells.shift();
  send({ type: 'ack', id: h.id });
}
worker.onmessage = (e) => { if (!shellFrozen) uploadShell(e.data); };

// ------------------------------------------------------------------ network
let ws = null, wsOpen = false;
const pending = [];
function send(o) { if (wsOpen) ws.send(JSON.stringify(o)); }
function connect() {
  const url = QS.get('ws') || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws = new WebSocket(url); ws.binaryType = 'arraybuffer';
  ws.onopen = () => { wsOpen = true; };
  ws.onclose = () => { wsOpen = false; setTimeout(connect, 1000); };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const m = JSON.parse(e.data);
      if (m.type === 'pong') { stats.rtt = 0.8 * stats.rtt + 0.2 * (performance.now() - m.t); stats.rttLast = performance.now() - m.t; }
      else if (m.type === 'world') game.onWorld(m);
      else if (m.type === 'error') console.warn('server:', m.msg);
      return;
    }
    if (typeof HOST !== 'undefined' && HOST.active) { HOST.onBinary(e.data, absNow()); return; }
    if (shellFrozen) return;
    worker.postMessage({ buf: e.data, tRecv: absNow() }, [e.data]);
  };
}
setInterval(() => send({ type: 'ping', t: performance.now() }), 500);

// ------------------------------------------------------------------ game (client-authoritative)
const game = {
  pos: [0, 1.7, 24], vel: [0, 0, 0], yaw: 0, pitch: 0, onGround: false, brick: null,
  yawRate: 0, pitchRate: 0, score: 0, orbs: [], spawns: [], frozen: TEST, t0: performance.now(),
  onWorld(m) {
    if (m.mode === 'host') { HOST.start(m); return; }      // game-host mode (client/host.js)
    this.spawns = m.spawns || [];
    if (!this.started && m.start) { this.pos = m.start.slice(0, 3); this.yaw = m.start[3] || 0; this.started = true; }
    if (CFG.orbs && this.orbs.length === 0) for (let i = 0; i < 18; i++) this.orbs.push(this.newOrb(i));
  },
  newOrb(i) {
    const s = this.spawns[(Math.random() * this.spawns.length) | 0] || [0, 1.2, 0];
    const c = [[0.2, 1, 1], [1, 0.3, 0.8], [1, 0.7, 0.2], [0.5, 1, 0.3], [0.7, 0.4, 1]][i % 5];
    return { p: [s[0], 1.3, s[2]], c, ph: Math.random() * 6.28 };
  },
  sdf(p) {
    const b = this.brick; if (!b) return null;
    const gx = (p[0] - b.o[0]) / b.cell, gy = (p[1] - b.o[1]) / b.cell, gz = (p[2] - b.o[2]) / b.cell;
    const [nx, ny, nz] = b.n;
    if (gx < 0 || gy < 0 || gz < 0 || gx > nx - 1.001 || gy > ny - 1.001 || gz > nz - 1.001) return null;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz), fx = gx - x0, fy = gy - y0, fz = gz - z0;
    const A = b.arr, I = (x, y, z) => A[x + nx * (y + ny * z)];
    const l = (a, c, t) => a + (c - a) * t;
    const c00 = l(I(x0, y0, z0), I(x0 + 1, y0, z0), fx), c10 = l(I(x0, y0 + 1, z0), I(x0 + 1, y0 + 1, z0), fx);
    const c01 = l(I(x0, y0, z0 + 1), I(x0 + 1, y0, z0 + 1), fx), c11 = l(I(x0, y0 + 1, z0 + 1), I(x0 + 1, y0 + 1, z0 + 1), fx);
    return l(l(c00, c10, fy), l(c01, c11, fy), fz) / 100;
  },
  grad(p) {
    const h = 0.1, g = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a = p.slice(), b = p.slice(); a[k] += h; b[k] -= h;
      const da = this.sdf(a), db = this.sdf(b); if (da === null || db === null) return [0, 1, 0];
      g[k] = da - db;
    }
    const l = V.len(g) || 1; return V.mul(g, 1 / l);
  },
  step(dt, keys) {
    if (!this.brick || this.frozen) { this.vel = [0, 0, 0]; return; }
    const f = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)], r = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    let wx = 0, wz = 0;
    if (keys.KeyW || keys.ArrowUp) { wx += f[0]; wz += f[2]; }
    if (keys.KeyS || keys.ArrowDown) { wx -= f[0]; wz -= f[2]; }
    if (keys.KeyD) { wx += r[0]; wz += r[2]; }
    if (keys.KeyA) { wx -= r[0]; wz -= r[2]; }
    const wl = Math.hypot(wx, wz), sp = keys.ShiftLeft || keys.ShiftRight ? 9 : 5.5;
    const tx = wl ? wx / wl * sp : 0, tz = wl ? wz / wl * sp : 0, k = Math.min(1, dt * 14);
    this.vel[0] += (tx - this.vel[0]) * k; this.vel[2] += (tz - this.vel[2]) * k;
    this.vel[1] -= 18 * dt;
    if (keys.Space && this.onGround) { this.vel[1] = 6.5; this.onGround = false; }
    const prev = this.pos.slice();
    this.pos = V.add(this.pos, V.mul(this.vel, dt));
    this.onGround = false;
    for (let it = 0; it < 3; it++) {
      for (const off of [-1.35, -0.4]) {           // foot sphere touches the floor exactly at eye height 1.70 m
        const c = [this.pos[0], this.pos[1] + off, this.pos[2]], rad = 0.35;
        const d = this.sdf(c);
        if (d === null) { this.pos = prev; this.vel = [0, 0, 0]; return; }   // left the collision brick: wait for the next
        if (d < rad + (off < -1 ? 0.03 : 0)) {
          const n = this.grad(c);
          if (d < rad) this.pos = V.add(this.pos, V.mul(n, rad - d));
          if (n[1] > 0.55 && off < -1) { this.onGround = true; if (this.vel[1] < 0) this.vel[1] = 0; }
          else { const vn = V.dot(this.vel, n); if (vn < 0) this.vel = V.sub(this.vel, V.mul(n, vn)); }
        }
      }
    }
  },
  updateOrbs(t) {
    const chest = [this.pos[0], this.pos[1] - 0.6, this.pos[2]];
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i]; o.y = o.p[1] + 0.25 * Math.sin(t * 2 + o.ph);
      if (Math.hypot(o.p[0] - chest[0], o.y - chest[1], o.p[2] - chest[2]) < 1.3) { this.score++; this.orbs[i] = this.newOrb(i); }
    }
  },
  lights() {   // nearest orbs become cloud-rendered point lights (latency-tolerant channel)
    const p = this.pos;
    return this.orbs.map((o) => [o, (o.p[0] - p[0]) ** 2 + (o.p[2] - p[2]) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, 12)
      .map(([o]) => [o.p[0], o.y ?? o.p[1], o.p[2], o.c[0] * 2.2, o.c[1] * 2.2, o.c[2] * 2.2, 9]);
  },
};

// ------------------------------------------------------------------ input (late-latched)
const keys = {};
let pendYaw = 0, pendPitch = 0, oldestInputT = null;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Digit1') setMode('shell'); if (e.code === 'Digit2') setMode('classic');
  if (e.code === 'Digit3') setMode('rot'); if (e.code === 'Digit4') setMode('noback');
  if (e.code === 'KeyH') hud.style.display = hud.style.display === 'none' ? '' : 'none';
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  pendYaw -= e.movementX * CFG.sens; pendPitch -= e.movementY * CFG.sens;
  if (oldestInputT === null) oldestInputT = e.timeStamp;
});
const startEl = document.getElementById('start');
startEl.addEventListener('click', () => { canvas.requestPointerLock(); game.frozen = false; });
document.addEventListener('pointerlockchange', () => { startEl.style.display = document.pointerLockElement === canvas || TEST ? 'none' : 'flex'; });
if (TEST) startEl.style.display = 'none';
function setMode(m) { MODE = m; }

// ------------------------------------------------------------------ drawing
function drawSheet(sh, vp, cam, roleOverride, bias) {
  const P = warpProg, u = P.u;
  gl.useProgram(P.p); gl.bindVertexArray(emptyVAO);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sh.tex.depth); gl.uniform1i(u.uDepth, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sh.tex.conn); gl.uniform1i(u.uConn, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sh.tex.color); gl.uniform1i(u.uColor, 2);
  gl.uniform2f(u.uSheetPx, sh.W, sh.H); gl.uniform1f(u.uDs, sh.ds); gl.uniform1f(u.uZn, shell.zn);
  gl.uniformMatrix4fv(u.uVP, false, vp); gl.uniform3fv(u.uCam, cam); gl.uniform2f(u.uViewport, canvas.width, canvas.height);
  const role = roleOverride !== undefined ? roleOverride : (sh.role === 'omni' || sh.role === 'classic' ? 1 : 0);
  gl.uniform1i(u.uRole, role); gl.uniform1f(u.uBias, bias || 1.0);
  gl.uniform1i(u.uCubic, CFG.cubic && sh.role !== 'omni' ? 1 : 0);
  gl.uniform1i(u.uGuard, sh.role === 'back' ? 1 : 0);
  for (const v of sh.views) {
    gl.uniform4i(u.uRect, v.rect[0], v.rect[1], v.rect[2], v.rect[3]);
    gl.uniform3fv(u.uO, v.o); gl.uniform3fv(u.uR, v.r); gl.uniform3fv(u.uU, v.u); gl.uniform3fv(u.uF, v.f);
    gl.uniform4f(u.uTan, v.tan[0], v.tan[1], v.tan[2], v.tan[3]);
    gl.drawArrays(gl.TRIANGLES, 0, (v.rect[2] - 1) * (v.rect[3] - 1) * 6);
  }
}

// orb geometry
const orbVAO = gl.createVertexArray(), orbInst = gl.createBuffer();
let orbSphereCount = 0;
(function buildOrbs() {
  const pts = [], NU = 14, NV = 9;
  const P = (i, j) => { const th = i / NU * Math.PI * 2, ph = j / NV * Math.PI; return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; };
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1); pts.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  orbSphereCount = pts.length / 3;
  pts.push(-1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0);  // glow quad
  gl.bindVertexArray(orbVAO);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, orbInst);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 28, 16); gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);
})();
function drawOrbs(vp, cam) {
  if (!game.orbs.length) return;
  const d = new Float32Array(game.orbs.length * 7);
  game.orbs.forEach((o, i) => d.set([o.p[0], o.y ?? o.p[1], o.p[2], 0.28, o.c[0], o.c[1], o.c[2]], i * 7));
  gl.bindBuffer(gl.ARRAY_BUFFER, orbInst); gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW);
  gl.useProgram(orbProg.p); gl.bindVertexArray(orbVAO);
  gl.uniformMatrix4fv(orbProg.u.uVP, false, vp); gl.uniform3fv(orbProg.u.uCam, cam);
  gl.uniform1i(orbProg.u.uGlow, 0);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, orbSphereCount, game.orbs.length);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
  gl.uniform1i(orbProg.u.uGlow, 1);
  gl.drawArraysInstanced(gl.TRIANGLES, orbSphereCount, 6, game.orbs.length);
  gl.disable(gl.BLEND); gl.depthMask(true);
  gl.bindVertexArray(null);
}

// Render one frame for camera (pos, yaw, pitch) with the current shell.
function render(pos, yaw, pitch, mode) {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.09, 0.05, 0.1, 1); gl.clearDepth(1); gl.clearStencil(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  gl.disable(gl.STENCIL_TEST);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
  const aspect = canvas.width / canvas.height, fov = CFG.fov * Math.PI / 180;
  let vp = viewProj(basis(yaw, pitch), fov, aspect), cam = pos, shown = { yaw, pitch, pos };
  if (!shell || !slots.A) return shown;
  const sheets = Object.assign({}, slots.A.sheets, slots.__omni ? { omni: slots.__omni } : {});
  if (shell.mode === 'classic' || mode === 'classic' || mode === 'stale') {
    // classic cloud gaming: the image is whatever pose the server rendered -> no local reprojection
    const fv = sheets.front.views[0];
    const b = { r: fv.r, u: fv.u, f: fv.f };
    const yawS = Math.atan2(-fv.f[0], -fv.f[2]), pitchS = Math.asin(Math.max(-1, Math.min(1, fv.f[1])));
    vp = viewProj(b, fov, aspect); cam = shell.center;
    shown = { yaw: yawS, pitch: pitchS, pos: shell.center };
    drawSheet(sheets.front, vp, cam, 1, 1.0);
  } else {
    if (mode && mode.startsWith('dbg_')) {          // per-layer debugging views
      const which = mode.slice(4);
      if (which === 'omni' && sheets.omni) drawSheet(sheets.omni, viewProj(basis(yaw, pitch), fov, aspect, 2e-6), cam, 1, 1.03);
      if (which === 'back' && sheets.back) drawSheet(sheets.back, vp, cam, 0, 1.0);
      if (which === 'front') drawSheet(sheets.front, vp, cam, 0, 1.0);
      return shown;
    }
    const rot = mode === 'rot', naive = mode === 'naive';
    const vpOmni = viewProj(basis(yaw, pitch), fov, aspect, 2e-6);
    // Layer priority: the sharp focus layer marks the stencil and can't be overridden by the coarse layers
    // (depth alone would let the omni cube's coarse silhouettes leak over it). Inside the focus layer's holes,
    // the background band and the omni fallback compete by *depth*: the band knows what's behind an edge, but
    // the omni may legitimately hold a nearer surface (e.g. a wall right next to the camera).
    // Multi-shell composite ("shell" mode): every slot's focus layer, nearest centre first. Shell i writes stencil
    // value K-i and passes where stored <= K-i, so it fills only pixels no nearer-centred shell covered, yet still
    // depth-tests against its own triangles. Then bands and the omni fallback fill what is left, by depth.
    // keep shells from the last 3 updates (counted in updates, not seconds: independent of render speed and
    // of network stalls); older hedges are superseded as soon as the player moves on
    const all = Object.keys(slots).filter((k) => k !== '__omni').map((k) => slots[k]);
    const newest = Math.max(...all.map((g) => g.upd));
    let groups = (mode === 'shell' ? all.filter((g) => newest - g.upd <= 3) : [slots.A]);
    // A secondary viewpoint only helps when it is about as good as the primary one: otherwise (camera still
    // next to the primary centre, or moving away from every hedge) its view-dependent errors would replace
    // pixels the primary shell or its omni fallback get right.
    const dist = (g) => V.len(V.sub(g.center, cam));
    const dA = dist(slots.A);
    groups = groups.filter((g) => g === slots.A || (dA > 0.15 && dist(g) < dA + 0.15));
    groups.sort((a, b) => dist(a) - dist(b));
    const K = groups.length;
    gl.enable(gl.STENCIL_TEST); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    groups.forEach((g, i) => { gl.stencilFunc(gl.GEQUAL, K - i, 0xFF); drawSheet(g.sheets.front, vp, cam, rot ? 2 : (naive ? 3 : 0), 1.0); });
    gl.stencilFunc(gl.EQUAL, 0, 0xFF); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    if (mode !== 'noback' && !rot && !naive) groups.forEach((g) => { if (g.sheets.back) drawSheet(g.sheets.back, vp, cam, 0, 1.0); });
    if (sheets.omni) drawSheet(sheets.omni, vpOmni, cam, rot ? 2 : (naive ? 3 : 1), 1.03);
    gl.disable(gl.STENCIL_TEST);
  }
  if (CFG.orbs) drawOrbs(vp, cam);
  return shown;
}

// ------------------------------------------------------------------ main loop
const hud = document.getElementById('hud'), scoreEl = document.getElementById('score');
let lastT = performance.now(), seq = 0, lastSend = 0, prevYaw = 0, prevPitch = 0;
const frameLog = [];
function loop(now) {
  requestAnimationFrame(loop);
  if (typeof HOST !== 'undefined' && HOST.active) { HOST.tick(now); return; }
  if (game.paused) return;
  const t0 = performance.now();
  let dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (game.spin) { pendYaw += game.spin * dt; if (oldestInputT === null) oldestInputT = t0; }   // test driver
  // late-latch input right before rendering
  let inputAge = null;
  if (pendYaw || pendPitch) {
    game.yaw += pendYaw; game.pitch = Math.max(-1.45, Math.min(1.45, game.pitch + pendPitch));
    pendYaw = pendPitch = 0;
    if (oldestInputT !== null) { inputAge = t0 - oldestInputT; oldestInputT = null; }
  }
  if (keys.KeyQ) game.yaw += 1.8 * dt; if (keys.KeyE) game.yaw -= 1.8 * dt;
  const sub = Math.max(1, Math.ceil(dt * 240));
  for (let i = 0; i < sub; i++) game.step(dt / sub, keys);
  if (dt > 0) {
    let dy = game.yaw - prevYaw;
    const a = Math.min(1, dt / 0.06);
    game.yawRate += (dy / dt - game.yawRate) * a; game.pitchRate += ((game.pitch - prevPitch) / dt - game.pitchRate) * a;
  }
  prevYaw = game.yaw; prevPitch = game.pitch;
  game.updateOrbs(now / 1000);
  const shown = render(game.pos, game.yaw, game.pitch, MODE);
  const t1 = performance.now();
  stats.frames++; stats.frameTimes.push(dt * 1000); if (stats.frameTimes.length > 240) stats.frameTimes.shift();
  if (inputAge !== null) { stats.inputAges.push(inputAge + (t1 - t0)); if (stats.inputAges.length > 120) stats.inputAges.shift(); }
  if (TEST) {
    const probe = SS.probeEach ? SS.probe() : 0;      // readPixels: also waits for the GPU to finish the frame
    frameLog.push({ t: t0, tEnd: t1, tDone: performance.now(), yaw: game.yaw, shownYaw: shown.yaw, shell: shell ? shell.id : -1,
      inSeq: shell ? shell.in_seq : -1, probe });
    if (frameLog.length > 5000) frameLog.shift();
  }
  // send state (throttled)
  if (now - lastSend >= 1000 / CFG.maxInputHz - 1) { lastSend = now; sendInput(now); }
}
function sendInput(now) {
  send({ type: 'input', seq: ++seq, t: now, pos: game.pos, vel: game.vel, yaw: game.yaw, pitch: game.pitch,
    yawRate: game.yawRate, pitchRate: game.pitchRate, fov: CFG.fov, aspect: canvas.width / canvas.height,
    vw: canvas.width, vh: canvas.height, mode: MODE === 'classic' || MODE === 'stale' ? 'classic' : 'shell',
    lights: CFG.orbs ? game.lights() : [], rtt: stats.rtt });
  return seq;
}
requestAnimationFrame(loop);

// ------------------------------------------------------------------ HUD
function pct(a, q) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
setInterval(() => {
  if (typeof HOST !== 'undefined' && HOST.active) { hud.innerHTML = HOST.hud(); return; }
  const ft = stats.frameTimes, fps = ft.length ? 1000 / (ft.reduce((a, b) => a + b, 0) / ft.length) : 0;
  const ls = stats.lastShells, nowA = absNow();
  const recent = ls.filter((s) => nowA - s.t < 1000);
  const mbps = recent.reduce((a, s) => a + s.bytes, 0) * 8 / 1e6;
  const age = shell ? (performance.now() - shell.in_t) : 0;
  const s = stats.srv || {};
  const label = { shell: 'SHELL (ours)', classic: 'CLASSIC streaming', rot: 'ROTATION-ONLY warp', noback: 'SHELL w/o background layer', stale: 'STALE', naive: 'NAIVE depth warp', shell1: 'SHELL, newest centre only' }[MODE];
  hud.innerHTML = `<b>${label}</b>   [1-4 switch, H hide]\n` +
    `display  ${fps.toFixed(0)} fps   frame p99 ${pct(ft, 0.99).toFixed(1)} ms\n` +
    `look latency (input->frame)  ${pct(stats.inputAges, 0.5).toFixed(1)} ms` + (MODE === 'classic' ? ' + network + server' : '') + `\n` +
    `shell  ${recent.length}/s  age ${age.toFixed(0)} ms   ${mbps.toFixed(1)} Mbit/s\n` +
    `rtt ${stats.rtt.toFixed(0)} ms   server ${(s.build_ms || 0).toFixed(1)} ms  gpu ${JSON.stringify(s.gpu_ms || [])}\n` +
    `focus ${s.W || 0}x${s.H || 0}  margin ${JSON.stringify(s.margins_deg || [])}  band ${s.band || 0} m`;
  scoreEl.textContent = game.orbs.length ? `orbs ${game.score}` : '';
}, 250);

// ------------------------------------------------------------------ test hooks
window.SS = {
  game, stats, frameLog, get shell() { return shell; }, get mode() { return MODE; }, get seq() { return seq; }, setMode,
  setPose(pos, yaw, pitch) { game.pos = pos.slice(); game.yaw = yaw; game.pitch = pitch || 0; game.vel = [0, 0, 0]; game.yawRate = 0; game.pitchRate = 0; prevYaw = game.yaw; prevPitch = game.pitch; return seq; },
  sendNow() { return sendInput(performance.now()); },   // returns the seq of the state just sent
  inject(dyaw, dpitch) { pendYaw += dyaw; pendPitch += dpitch || 0; oldestInputT = performance.now(); return oldestInputT; },
  freezeShell(b) { shellFrozen = b; },
  pause(b) { game.paused = b; },
  netemu(o) { send(Object.assign({ type: 'netemu' }, o)); },
  cfg(o) { send(Object.assign({ type: 'cfg' }, o)); },
  // render immediately at an arbitrary pose with the current shell and return RGBA pixels (base64)
  capture(pos, yaw, pitch, mode) {
    render(pos, yaw, pitch || 0, mode || 'shell');
    const w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH));
    return { w, h, b64: btoa(s) };
  },
  probe() {                         // cheap 'photon' probe: hash of one row of the frame buffer
    const w = canvas.width, px = new Uint8Array(w * 4);
    gl.readPixels(0, (canvas.height / 2) | 0, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let hsh = 0; for (let i = 0; i < px.length; i += 4) hsh = (hsh * 31 + px[i] + px[i + 1] * 7 + px[i + 2] * 13) | 0;
    return hsh;
  },
};
connect();
