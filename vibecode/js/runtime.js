/* VibeCode — browser runtime for the engine: loop, input, resize. */
(function (VC) {
  'use strict';
  const U = VC.U, P = VC.Engine.prototype;
  const GAME_KEYS = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'j', 'k', 'q', 'e', 'f', 't', 'r', 'shift']);

  P.mount = function (container) {
    this.container = container;
    const c = this.canvas;
    const keyName = (e) => (e.key === ' ' || e.code === 'Space' ? ' ' : String(e.key || '').toLowerCase());
    this._kd = (e) => {
      if (this.mode !== 'play') return;
      const k = keyName(e);
      if (e.metaKey || e.ctrlKey) return;
      if (k === 'escape') return;
      if (!this.input.keys[k]) this.input.pressed[k] = true;
      this.input.keys[k] = true;
      this.konami(k);
      if (GAME_KEYS.has(k) || k.length === 1) e.preventDefault();
    };
    this._ku = (e) => { const k = keyName(e); this.input.keys[k] = false; this.input.released[k] = true; };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', () => { this.input.keys = {}; });
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      let sx = e.clientX - r.left, sy = e.clientY - r.top;
      const fx = this.rt.effects || new Set();
      if (fx.has('flip')) sy = r.height - sy;
      if (fx.has('mirror')) sx = r.width - sx;
      const m = this.input.mouse;
      m.sx = sx; m.sy = sy; m.t = this.realTime;
      const w = this.screenToWorld(sx, sy);
      m.wx = w.x; m.wy = w.y;
    };
    c.addEventListener('mousemove', (e) => { pos(e); this.input.mouse.inside = true; });
    c.addEventListener('mouseenter', () => { this.input.mouse.inside = true; });
    c.addEventListener('mouseleave', () => { this.input.mouse.inside = false; this.input.mouse.down = false; });
    c.addEventListener('mousedown', (e) => {
      pos(e);
      if (this.mode !== 'play') return;
      if (e.button === 2) { this.input.mouse.right = true; this.input.mouse.rclicked = true; }
      else { this.input.mouse.down = true; this.input.mouse.clicked = true; }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.input.mouse.right = false; else this.input.mouse.down = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // touch
    const tp = (t) => { const r = c.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top, w: r.width, h: r.height }; };
    c.addEventListener('touchstart', (e) => {
      if (this.mode !== 'play') return;
      e.preventDefault();
      const tc = this.input.touch = this.input.touch || { active: false, jx: 0, jy: 0 };
      for (const t of e.changedTouches) {
        const p = tp(t);
        if (p.x < p.w * 0.5) { tc.active = true; tc.id = t.identifier; tc.ox = p.x; tc.oy = p.y; tc.jx = 0; tc.jy = 0; }
        else if (p.x > p.w - 110 && p.y > p.h - 130) { tc.a = true; tc.aPressed = true; tc.aid = t.identifier; }
        else { tc.b = true; tc.bPressed = true; tc.bid = t.identifier; const w = this.screenToWorld(p.x, p.y); this.input.mouse.wx = w.x; this.input.mouse.wy = w.y; this.input.mouse.t = this.realTime; this.input.mouse.inside = true; }
      }
    }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      const tc = this.input.touch; if (!tc) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== tc.id) continue;
        const p = tp(t);
        let dx = (p.x - tc.ox) / 40, dy = (p.y - tc.oy) / 40;
        const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        tc.jx = Math.abs(dx) > 0.2 ? dx : 0; tc.jy = Math.abs(dy) > 0.2 ? dy : 0;
      }
    }, { passive: false });
    c.addEventListener('touchend', (e) => {
      const tc = this.input.touch; if (!tc) return;
      for (const t of e.changedTouches) {
        if (t.identifier === tc.id) { tc.active = false; tc.jx = 0; tc.jy = 0; }
        if (t.identifier === tc.aid) tc.a = false;
        if (t.identifier === tc.bid) tc.b = false;
      }
    });
  };

  P.konami = function (k) {
    const seq = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
    this._kon = (this._kon || []).concat(k).slice(-10);
    if (this._kon.join() === seq.join()) { this._kon = []; this.emit('konami'); }
  };

  P.screenToWorld = function (sx, sy) {
    const v = this.view;
    const S = v.scale / v.dpr;
    return { x: (sx - v.cw / v.dpr / 2) / S + this.cam.x - this.cam.ox, y: (sy - v.ch / v.dpr / 2) / S + this.cam.y - this.cam.oy };
  };

  P.resize = function (w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = this.canvas;
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    c.style.width = w + 'px'; c.style.height = h + 'px';
    this.view.cw = W; this.view.ch = H; this.view.dpr = dpr;
    if (this.render) this.render.weather = {};
  };

  P.start = function () {
    if (this.running) return;
    this.running = true;
    let last = performance.now(), acc = 0;
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this._fpsAcc += dt; this._fpsN++;
      if (this._fpsAcc > 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
      if (this.spec && this.mode !== 'paused' && !this.err) {
        acc += dt;
        let n = 0;
        while (acc >= 1 / 60 && n < 4) { this.step(1 / 60); acc -= 1 / 60; n++; }
        if (n === 4) acc = 0;
      }
      try { if (this.render && this.spec) this.render.draw(); } catch (e) { if (!this.err) this.crash(e, 'render'); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  P.stop = function () { this.running = false; };

  P.setMode = function (m) {
    if (m === this.mode) return;
    const prev = this.mode;
    this.mode = m;
    this.input.keys = {}; this.input.mouse.down = false;
    if (m === 'play' && prev === 'demo') this.reset();
    if (!this.headless && VC.Sound) VC.Sound.setMusic(m === 'play' && this.spec ? this.spec.audio.music : null, this.spec && this.spec.audio.tempo);
    this.emit('mode', m);
  };
  void U;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
