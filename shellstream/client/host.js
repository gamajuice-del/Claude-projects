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
  // pointer: 'look' (game hides the pointer: relative counts, predicted) or 'cursor' (menus: absolute positions,
  // pointer drawn locally at display rate).  force: null = follow the game, or a fixed mode (Alt+L cycles)
  started: false, force: null, curX: 0, curY: 0, lastLocalMove: 0, wasLook: true, vp: [0, 0, 1, 1], tD: [1, 1],
  audio: null, aStats: { packets: 0, decoded: 0, rms: 0, bufMs: 0, dropped: 0, state: 'off' },

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
    const cr = document.getElementById('cross'); if (cr) cr.style.display = 'none';
    const st = document.querySelector('#start h1'); if (st) st.textContent = 'ShellStream: game host';
    this.curX = this.info.w / 2; this.curY = this.info.h / 2;
    // the locally drawn pointer (cursor mode) and a small toolbar for when the mouse isn't captured
    this.curEl = Object.assign(document.createElement('div'), { id: 'hcur' });
    this.curEl.innerHTML = '<svg width="18" height="26" viewBox="0 0 18 26"><path d="M1 1 L1 20 L6 15.5 L9.5 24 L13 22.5 L9.6 14.3 L16 14.3 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    Object.assign(this.curEl.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: 20, display: 'none' });
    document.body.appendChild(this.curEl);
    this.tools = Object.assign(document.createElement('div'), { id: 'htools' });
    Object.assign(this.tools.style, { position: 'fixed', right: '12px', top: '12px', zIndex: 21, display: 'none', gap: '6px' });
    for (const [label, fn] of [['Esc', () => this.tapKey('Escape')], ['Fullscreen', () => this.fullscreen()]]) {
      const b = Object.assign(document.createElement('button'), { textContent: label });
      Object.assign(b.style, { font: '12px system-ui, sans-serif', padding: '6px 10px', borderRadius: '6px', border: '1px solid #355',
        background: '#0a1220', color: '#d8e2ee', cursor: 'pointer' });
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      this.tools.appendChild(b);
    }
    document.body.appendChild(this.tools);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  // ---------------------------------------------------------------- session start (user gesture)
  begin() {
    this.started = true;
    document.getElementById('start').style.display = 'none';
    this.startAudio();
    this.lockPointer();
  },
  lockPointer() { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* no lock here */ } },
  fullscreen() {
    // fullscreen + keyboard lock: Esc, Alt+Tab and the Windows key reach the game (hold Esc to leave)
    document.documentElement.requestFullscreen().then(() => {
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {});
      this.lockPointer();
    }).catch(() => {});
  },
  tapKey(code) { this.queue(['k', code, 1]); this.queue(['k', code, 0]); this.flush(); },
  look() {
    if (this.force) return this.force === 'look';
    return !this.frame || this.frame.look !== false;
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
    if (hdr.type === 'audio') { this.onAudio(data, hdr); return; }
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
    if (hdr.cur && hdr.look === false) {
      // the game shows its pointer: start the local one where the game's is, and follow it when the game
      // moves it by itself (not while the player is moving it)
      const far = Math.hypot(hdr.cur[0] - this.curX, hdr.cur[1] - this.curY) > 4;
      if (this.wasLook || (far && performance.now() - this.lastLocalMove > 400)) { this.curX = hdr.cur[0]; this.curY = hdr.cur[1]; }
    }
    this.wasLook = hdr.look !== false;
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
    if (!f || !this.ipr || !f.cal || f.cal.r2 < 0.5 || !this.look()) return [0, 0];   // menus: nothing to predict
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
    let tDy, tDx, vp;
    if (os <= 1.0001) {
      // no guard band (e.g. a whole desktop): show all of the frame, letterboxed, never cropped
      const fa = f.w / f.h;
      vp = aspect > fa ? [Math.round((canvas.width - canvas.height * fa) / 2), 0, Math.round(canvas.height * fa), canvas.height]
                       : [0, Math.round((canvas.height - canvas.width / fa) / 2), canvas.width, Math.round(canvas.width / fa)];
      tDx = tanFx; tDy = tanFy;
    } else {
      vp = [0, 0, canvas.width, canvas.height];
      tDy = tanFy / os; tDx = tDy * aspect;
      if (tDx > tanFx / os) { tDx = tanFx / os; tDy = tDx / aspect; }
    }
    this.vp = vp; this.tD = [tDx / tanFx, tDy / tanFy];
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
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

  // ---------------------------------------------------------------- display <-> frame coordinates
  toFrame(clientX, clientY) {
    const r = canvas.getBoundingClientRect(), f = this.frame || this.info, vp = this.vp;
    const px = (clientX - r.left) * canvas.width / r.width, gy = canvas.height - (clientY - r.top) * canvas.height / r.height;
    const u = 2 * (px - vp[0]) / vp[2] - 1, v = 2 * (gy - vp[1]) / vp[3] - 1;
    return [(u * this.tD[0] * 0.5 + 0.5) * f.w, (0.5 - v * this.tD[1] * 0.5) * f.h];
  },
  toCss(fx, fy) {
    const r = canvas.getBoundingClientRect(), f = this.frame || this.info, vp = this.vp;
    const u = (fx / f.w - 0.5) * 2 / this.tD[0], v = (0.5 - fy / f.h) * 2 / this.tD[1];
    const px = vp[0] + (u + 1) / 2 * vp[2], gy = vp[1] + (v + 1) / 2 * vp[3];
    return [r.left + px * r.width / canvas.width, r.top + (canvas.height - gy) * r.height / canvas.height];
  },
  // cursor mode with the mouse captured: move the local pointer by the mouse's motion, send its position
  moveCursor(mx, my) {
    const r = canvas.getBoundingClientRect(), f = this.frame || this.info;
    const k = (canvas.width / r.width) * f.w * this.tD[0] / this.vp[2];      // frame px per CSS px
    this.curX = Math.min(Math.max(this.curX + mx * k, 0), f.w - 1);
    this.curY = Math.min(Math.max(this.curY + my * k, 0), f.h - 1);
    this.lastLocalMove = performance.now();
    this.pointTo(this.curX, this.curY);
  },
  pointTo(fx, fy) {
    this.batch = this.batch.filter((e) => e[0] !== 'a');                    // only the newest position matters
    this.queue(['a', Math.round(fx), Math.round(fy)]);
  },
  drawCursor() {
    const locked = document.pointerLockElement === canvas;
    const show = this.started && locked && !this.look();
    this.curEl.style.display = show ? 'block' : 'none';
    if (show) { const [x, y] = this.toCss(this.curX, this.curY); this.curEl.style.transform = `translate(${x - 1}px, ${y - 1}px)`; }
    this.tools.style.display = this.started && !locked && !document.fullscreenElement ? 'flex' : 'none';
    canvas.style.cursor = this.started && !locked && this.look() ? 'crosshair' : 'default';
  },

  // ---------------------------------------------------------------- audio (Opus via WebCodecs)
  startAudio() {
    if (this.audio || typeof AudioDecoder === 'undefined') { if (!this.audio) this.aStats.state = 'no AudioDecoder in this browser'; return; }
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    const a = { ctx, next: 0, dec: null };
    a.dec = new AudioDecoder({
      output: (ad) => {
        const n = ad.numberOfFrames, ch = ad.numberOfChannels, buf = ctx.createBuffer(ch, n, ad.sampleRate);
        let e = 0;
        for (let c = 0; c < ch; c++) {
          const tmp = new Float32Array(n); ad.copyTo(tmp, { planeIndex: c, format: 'f32-planar' });
          buf.copyToChannel(tmp, c); for (let i = 0; i < n; i += 4) e += tmp[i] * tmp[i];
        }
        ad.close();
        this.aStats.decoded++; this.aStats.rms = Math.sqrt(e / (ch * n / 4));
        // jitter buffer: play 60 ms behind arrival; resynchronise if it runs dry or grows past 250 ms
        const now = ctx.currentTime;
        if (a.next < now + 0.01 || a.next > now + 0.25) { if (a.next > now + 0.25) this.aStats.dropped++; a.next = now + 0.06; }
        // the host's and the browser's audio clocks drift apart over long sessions: while more than 140 ms is
        // queued, play 1 % faster (inaudible) instead of letting the delay grow or dropping sound
        const rate = a.next - now > 0.14 ? 1.01 : 1.0;
        const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
        src.connect(ctx.destination); src.start(a.next);
        a.next += buf.duration / rate; this.aStats.bufMs = Math.round((a.next - now) * 1000);
      },
      error: (e) => { this.aStats.state = 'decoder error: ' + e.message; },
    });
    a.dec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
    this.audio = a; this.aStats.state = 'on';
  },
  onAudio(data, hdr) {
    this.aStats.packets++;
    const a = this.audio;
    if (!a || a.dec.state !== 'configured') return;
    if (a.ctx.state === 'suspended') a.ctx.resume();
    a.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(hdr.ts * 1e6 / 48000), data }));
  },

  // ---------------------------------------------------------------- per display refresh
  tick(now) {
    const t0 = performance.now();
    const rot = this.render();
    this.drawCursor();
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
    const a = this.aStats, mode = this.look() ? 'look (predicted)' : 'cursor (local pointer)';
    return `<b>GAME HOST</b> ${this.info.encoder}  [Alt+P: prediction ${this.ipr ? "ON" : "OFF"}]  [Alt+L: mode ${this.force || 'auto'}]\n` +
      `pointer: ${mode}   audio: ${a.state}${a.decoded ? `, ${a.bufMs} ms buffered` : ''}\n` +
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

// input routing: in host mode every event goes to the game.  Captured mouse: relative counts while the game
// looks around, the local pointer while it shows menus.  Uncaptured mouse: absolute positions and clicks, so
// launchers, menus and the desktop work without the pointer lock.
const startEl_ = document.getElementById('start');
startEl_.addEventListener('click', () => { if (HOST.active) HOST.begin(); });
const locked = () => document.pointerLockElement === canvas;
addEventListener('mousemove', (e) => {
  if (!HOST.active || !HOST.started) return;
  if (locked()) { if (HOST.look()) HOST.mouse(e.movementX, e.movementY); else HOST.moveCursor(e.movementX, e.movementY); }
  else if (e.target === canvas) { const [x, y] = HOST.toFrame(e.clientX, e.clientY); HOST.curX = x; HOST.curY = y; HOST.pointTo(x, y); }
});
addEventListener('mousedown', (e) => {
  if (!HOST.active || !HOST.started) return;
  if (!locked()) {
    if (e.target !== canvas) return;
    if (HOST.look()) { HOST.lockPointer(); return; }              // the game wants the mouse: capture it
    const [x, y] = HOST.toFrame(e.clientX, e.clientY); HOST.pointTo(x, y);
  }
  HOST.queue(['b', e.button, 1]); HOST.flush(); e.preventDefault();
});
addEventListener('mouseup', (e) => {
  if (!HOST.active || !HOST.started) return;
  if (!locked() && e.target !== canvas) return;
  HOST.queue(['b', e.button, 0]); HOST.flush();
});
addEventListener('wheel', (e) => {
  if (!HOST.active || !HOST.started) return;
  if (e.deltaY) HOST.queue(['w', Math.sign(e.deltaY)]);
  if (e.deltaX) HOST.queue(['wh', Math.sign(e.deltaX)]);
}, { passive: true });
addEventListener('keydown', (e) => {
  if (!HOST.active || !HOST.started || e.repeat) return;
  if (e.altKey && e.code === 'KeyP') { HOST.ipr = !HOST.ipr; return; }
  if (e.altKey && e.code === 'KeyL') { HOST.force = { null: 'look', look: 'cursor', cursor: null }[HOST.force]; return; }
  // Esc with the mouse captured releases it (the browser's rule) unless fullscreen keyboard lock is on;
  // uncaptured, Esc goes to the game like every other key
  if (e.code === 'Escape' && locked() && !(document.fullscreenElement && navigator.keyboard)) return;
  HOST.queue(['k', e.code, 1]); e.preventDefault();
});
addEventListener('keyup', (e) => {
  if (!HOST.active || !HOST.started) return;
  HOST.queue(['k', e.code, 0]); e.preventDefault();
});
addEventListener('blur', () => {
  // the browser lost focus with keys held: release everything so the game doesn't keep walking
  if (HOST.active && HOST.started) for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ControlLeft']) HOST.queue(['k', c, 0]);
});

Object.assign(window.SS, {
  host: HOST,
  hostMove(dx, dy) {                // test hook: a mouse movement of (dx, dy) counts right now
    if (HOST.probeEach) { HOST.refRow = HOST.row(); }
    HOST.mouse(dx, dy || 0); HOST.flush();
    HOST.tInj = performance.now(); return HOST.tInj;
  },
  hostKey(code, down) { HOST.queue(['k', code, down ? 1 : 0]); HOST.flush(); },
  hostBegin() { HOST.begin(); },     // test hook: what the start click does
});
