// =====================================================================================
//  ShellStream game-host mode: play ANY unmodified game streamed from the server.
//
//  The game only gives us pixels, so the shell technique (depth, layers) isn't available.  What we *do* know
//  exactly is which mouse counts we have sent that the newest frame doesn't show yet (every frame carries the
//  counts it reflects) and, from the server's online calibration, how far the image moves per count.  Before
//  every display refresh the newest frame is re-projected by that pending rotation, inside an overscanned
//  field of view, so mouse-look responds locally.  Movement and actions still take the round trip.
// =====================================================================================
'use strict';

const IPR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform sampler2D uHud; uniform int uHasHud;
uniform vec2 uTanF; uniform vec2 uTanD; uniform mat3 uR; uniform int uMark;
in vec2 vNdc; out vec4 o;
void main() {
  // where this display pixel lies in the frame when nothing moves (screen-fixed overlays stay here)
  vec2 t0 = vec2(vNdc.x * uTanD.x, vNdc.y * uTanD.y);
  vec2 uv0 = vec2(t0.x / uTanF.x * 0.5 + 0.5, 0.5 - t0.y / uTanF.y * 0.5);
  vec3 r = uR * vec3(t0, 1.0);
  if (r.z <= 1e-4) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 t = r.xy / r.z;
  vec2 uv = vec2(t.x / uTanF.x * 0.5 + 0.5, 0.5 - t.y / uTanF.y * 0.5);
  vec3 c = texture(uTex, clamp(uv, vec2(0.0005), vec2(0.9995))).rgb;
  bool outside = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
  if (outside && uMark == 1) c *= 0.85;
  if (uHasHud == 1) {
    // HUD-aware: the world is re-projected, the learned overlay (HUD, crosshair, hand) is not
    float hud = texture(uHud, uv0).r;
    c = mix(c, texture(uTex, uv0).rgb, smoothstep(0.3, 0.7, hud));
  }
  o = vec4(c, 1.0);
}`;
const IPR_VS = `#version 300 es
out vec2 vNdc;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0; vNdc = p; gl_Position = vec4(p, 0.0, 1.0); }`;

const HOST = {
  active: false, info: null, prog: null, tex: null, frame: null, haveTex: false,
  sentCx: 0, sentCy: 0, remX: 0, remY: 0, batch: [], timer: null, lastFlush: 0,
  ipr: QS.get('ipr') !== '0', decoder: null, meta: new Map(), frames: 0, arrivals: [], bytes: [],
  log: [], refRow: null, tInj: null, expectShift: 0,

  start(info) {
    this.active = true; this.info = info;
    this.sentCx = info.cx || 0; this.sentCy = info.cy || 0;
    this.prog = program(IPR_VS, IPR_FS);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    if (info.codec === 'h264') {
      // negotiate: H.264 through WebCodecs if this browser can decode it, otherwise ask the host for JPEG
      const cfg = { codec: 'avc1.640028', optimizeForLatency: true };
      const ok = typeof VideoDecoder !== 'undefined' ? VideoDecoder.isConfigSupported(cfg).then((r) => r.supported).catch(() => false) : Promise.resolve(false);
      ok.then((yes) => { if (yes) this.makeDecoder(); else { this.info.codec = 'jpeg'; send({ type: 'codec', codec: 'jpeg' }); } });
    }
    const sc = document.getElementById('score'); if (sc) sc.style.display = 'none';
    const st = document.querySelector('#start h1'); if (st) st.textContent = 'ShellStream: game host';
  },

  makeDecoder() {
    this.decoder = new VideoDecoder({
      output: (vf) => {
        const hdr = this.meta.get(vf.timestamp); this.meta.delete(vf.timestamp);
        this.upload(vf, vf.displayWidth, vf.displayHeight, hdr); vf.close();
      },
      error: (e) => { console.warn('decoder', e); send({ type: 'keyframe' }); this.makeDecoder(); },
    });
    this.decoder.configure({ codec: 'avc1.640028', optimizeForLatency: true });
    this.needKey = true;
  },

  onBinary(buf, tRecv) {
    const dv = new DataView(buf), hl = dv.getUint32(0, true);
    const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
    const data = new Uint8Array(buf, 4 + hl, hdr.dlen !== undefined ? hdr.dlen : buf.byteLength - 4 - hl);
    if (hdr.hud) this.loadHud(new Uint8Array(buf, 4 + hl + hdr.hud.off, hdr.hud.len), hdr.hud.w, hdr.hud.h);
    hdr.tRecv = tRecv; hdr.nbytes = buf.byteLength;
    this.arrivals.push(performance.now()); if (this.arrivals.length > 120) this.arrivals.shift();
    this.bytes.push([performance.now(), buf.byteLength]); if (this.bytes.length > 240) this.bytes.shift();
    if (hdr.codec === 'h264') {
      if (!this.decoder) { send({ type: 'ack', id: hdr.id }); return; }     // still negotiating
      if (this.needKey && !hdr.key) { send({ type: 'keyframe' }); send({ type: 'ack', id: hdr.id }); return; }
      this.needKey = false;
      this.meta.set(hdr.id, hdr);
      this.decoder.decode(new EncodedVideoChunk({ type: hdr.key ? 'key' : 'delta', timestamp: hdr.id, data }));
    } else {
      createImageBitmap(new Blob([data], { type: 'image/jpeg' })).then((bm) => { this.upload(bm, bm.width, bm.height, hdr); bm.close(); });
    }
  },

  loadHud(z, w, h) {
    const s = new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate'));
    new Response(s).arrayBuffer().then((ab) => {
      if (!this.hudTex) this.hudTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.hudTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(ab));
      for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
      this.haveHud = true;
    });
  },

  upload(src, w, h, hdr) {
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.frame = hdr; this.haveTex = true; this.frames++;
    stats.srv = hdr.stats || {};
    if (hdr) send({ type: 'ack', id: hdr.id });
  },

  // ---------------------------------------------------------------- input forwarding
  queue(ev) {
    this.batch.push(ev);
    const now = performance.now();
    if (now - this.lastFlush > 4) this.flush();                 // send at once, coalesce bursts (<= 250 msg/s)
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 4);
  },
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.batch.length) return;
    this.lastFlush = performance.now();
    send({ type: 'ev', ev: this.batch, cx: this.sentCx, cy: this.sentCy, t: this.lastFlush, rtt: stats.rtt });
    this.batch = [];
  },
  mouse(mx, my) {
    // integer counts for the game; keep the fractional remainder locally
    this.remX += mx; this.remY += my;
    const dx = Math.round(this.remX), dy = Math.round(this.remY);
    this.remX -= dx; this.remY -= dy;
    if (!dx && !dy) return;
    this.sentCx += dx; this.sentCy += dy;
    this.queue(['m', dx, dy]);
  },

  // ---------------------------------------------------------------- display
  pendingRotation() {
    const f = this.frame, info = this.info;
    if (!f || !this.ipr || !f.cal || f.cal.r2 < 0.5) return [0, 0];
    const px = this.sentCx - f.cx, py = this.sentCy - f.cy;   // counts the frame does not show yet
    const sx = f.cal.kx * px, sy = f.cal.ky * py;             // predicted image shift (frame pixels)
    const tanFy = Math.tan(((info.fov_v || 70) * Math.PI / 180) / 2), tanFx = tanFy * f.w / f.h;
    const fx = (f.w / 2) / tanFx, fy = (f.h / 2) / tanFy;
    return [Math.atan(-sx / fx), Math.atan(-sy / fy)];       // rotation that samples where the content will come from
  },
  render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.haveTex) return [0, 0];
    const f = this.frame, info = this.info;
    const tanFy = Math.tan(((info.fov_v || 70) * Math.PI / 180) / 2), tanFx = tanFy * f.w / f.h;
    const os = info.overscan || 1, aspect = canvas.width / canvas.height;
    let tDy = tanFy / os, tDx = tDy * aspect;
    if (tDx > tanFx / os) { tDx = tanFx / os; tDy = tDx / aspect; }
    const [yaw, pitch] = this.pendingRotation();
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Ryaw * Rpitch, column-major (display ray -> frame ray)
    const R = [cy, 0, -sy, sy * sp, cp, cy * sp, sy * cp, -sp, cy * cp];
    const P = this.prog;
    gl.useProgram(P.p); gl.bindVertexArray(emptyVAO);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(P.u.uTex, 0);
    gl.uniform2f(P.u.uTanF, tanFx, tanFy); gl.uniform2f(P.u.uTanD, tDx, tDy);
    gl.uniformMatrix3fv(P.u.uR, false, R); gl.uniform1i(P.u.uMark, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.haveHud ? this.hudTex : this.tex); gl.uniform1i(P.u.uHud, 1);
    gl.uniform1i(P.u.uHasHud, this.haveHud && this.hudAware !== false ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return [yaw, pitch];
  },

  // ---------------------------------------------------------------- per display refresh
  tick(now) {
    const t0 = performance.now();
    const rot = this.render();
    const t1 = performance.now();
    if (TEST && this.probeEach) {
      const row = this.row();
      const shift = this.refRow ? rowShift(this.refRow, row) : 0;
      this.log.push({ t: t0, tDone: performance.now(), shift, frame: this.frame ? this.frame.id : -1, yaw: rot[0] });
      if (this.log.length > 5000) this.log.shift();
    }
    stats.frames++; stats.frameTimes.push(t1 - t0 + 0.0001); if (stats.frameTimes.length > 240) stats.frameTimes.shift();
  },
  row() {
    const w = canvas.width, px = new Uint8Array(w * 4);
    gl.readPixels(0, (canvas.height * 0.62) | 0, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const g = new Float32Array(w);
    for (let i = 0; i < w; i++) g[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
    return g;
  },
  hud() {
    const f = this.frame || {}, now = performance.now();
    const fps = this.arrivals.filter((t) => now - t < 1000).length;
    const mbps = this.bytes.filter(([t]) => now - t < 1000).reduce((a, [, b]) => a + b, 0) * 8 / 1e6;
    const c = f.cal || {};
    const [yaw] = this.pendingRotation();
    return `<b>GAME HOST</b> ${this.info.encoder}  [Alt+P: prediction ${this.ipr ? "ON" : "OFF"}]\n` +
      `stream ${fps} fps  ${mbps.toFixed(1)} Mbit/s   rtt ${stats.rtt.toFixed(0)} ms\n` +
      `calibration  ${(c.kx || 0).toFixed(2)} / ${(c.ky || 0).toFixed(2)} px per count, lag ${c.lag_ms || 0} ms, fit ${(c.r2 || 0).toFixed(2)}\n` +
      `pending counts ${this.sentCx - (f.cx || 0)}, ${this.sentCy - (f.cy || 0)}  -> predicted turn ${(yaw * 180 / Math.PI).toFixed(1)} deg\n` +
      `server capture ${(f.stats || {}).capture_ms || 0} ms  encode ${(f.stats || {}).encode_ms || 0} ms`;
  },
};

function rowShift(a, b) {           // integer shift of b relative to a (content moved by +s)
  let best = 0, bestE = Infinity; const n = a.length, M = Math.min(160, n >> 2);
  for (let s = -M; s <= M; s++) {
    let e = 0, c = 0;
    for (let i = M; i < n - M; i += 2) { const d = b[i] - a[i - s]; e += d * d; c++; }
    e /= c; if (e < bestE) { bestE = e; best = s; }
  }
  return best;
}

// input routing: in host mode raw events go to the game; shell-mode handlers in client.js ignore them
addEventListener('mousemove', (e) => { if (HOST.active && (document.pointerLockElement === canvas)) HOST.mouse(e.movementX, e.movementY); });
addEventListener('keydown', (e) => {
  if (!HOST.active || e.repeat) return;
  if (e.code === 'KeyP' && e.altKey) { HOST.ipr = !HOST.ipr; return; }
  if (e.code === 'Escape') return;                       // the browser uses Escape to release the mouse
  HOST.queue(['k', e.code, 1]); e.preventDefault();
});
addEventListener('keyup', (e) => { if (HOST.active && e.code !== 'Escape') { HOST.queue(['k', e.code, 0]); e.preventDefault(); } });
addEventListener('mousedown', (e) => { if (HOST.active && document.pointerLockElement === canvas) HOST.queue(['b', e.button, 1]); });
addEventListener('mouseup', (e) => { if (HOST.active && document.pointerLockElement === canvas) HOST.queue(['b', e.button, 0]); });
addEventListener('wheel', (e) => { if (HOST.active) HOST.queue(['w', Math.sign(e.deltaY)]); }, { passive: true });

Object.assign(window.SS, {
  host: HOST,
  hostMove(dx, dy) {                // test hook: a mouse movement of (dx, dy) counts right now
    if (HOST.probeEach) { HOST.refRow = HOST.row(); }
    HOST.mouse(dx, dy || 0); HOST.flush();
    HOST.tInj = performance.now(); return HOST.tInj;
  },
  hostKey(code, down) { HOST.queue(['k', code, down ? 1 : 0]); HOST.flush(); },
});
