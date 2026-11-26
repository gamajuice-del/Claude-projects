/* VibeCode — canvas renderer for the engine. */
(function (VC) {
  'use strict';
  const U = VC.U, T = VC.Levels.T;
  const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const SERIF = '"Instrument Serif", "Iowan Old Style", Georgia, serif';
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

  function detectEmoji() {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const x = c.getContext('2d');
      x.textBaseline = 'middle'; x.textAlign = 'center'; x.font = '26px ' + EMOJI_FONT;
      x.fillText('🧟', 16, 17);
      const d = x.getImageData(0, 0, 32, 32).data;
      let colored = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 80 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) colored++;
      return colored > 20;
    } catch (e) { return false; }
  }

  class Renderer {
    constructor(g) {
      this.g = g;
      this.sprites = new Map();
      this.emojiOK = detectEmoji();
      this.weather = {};
      this.lastT = 0;
      this.levelChanged = true;
    }

    sprite(glyph, px, tint, tintA) {
      px = U.clamp(Math.ceil(px / 4) * 4, 8, 320);
      const key = glyph + '|' + px + '|' + (tint || '') + '|' + (tintA || 0);
      let c = this.sprites.get(key);
      if (c) return c;
      if (this.sprites.size > 900) this.sprites.clear();
      c = document.createElement('canvas');
      const s = Math.ceil(px * 1.3);
      c.width = c.height = s;
      const x = c.getContext('2d');
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = px + 'px ' + EMOJI_FONT;
      x.fillText(glyph, s / 2, s / 2 + px * 0.06);
      if (tint) { x.globalCompositeOperation = 'source-atop'; x.globalAlpha = tintA || 0.45; x.fillStyle = tint; x.fillRect(0, 0, s, s); }
      this.sprites.set(key, c);
      return c;
    }

    draw() {
      const g = this.g, c = g.canvas;
      if (!c || !g.spec) return;
      const now = performance.now() / 1000;
      const dt = Math.min(0.05, now - (this.lastT || now));
      this.lastT = now;
      const fx = g.rt.effects || new Set();
      const W = c.width, H = c.height;
      const pixel = fx.has('pixelate');
      let ctx = g.ctx;
      let k = 1;
      if (pixel) {
        k = 1 / 3;
        if (!this.pix) { this.pix = document.createElement('canvas'); this.pctx = this.pix.getContext('2d'); }
        const pw = Math.ceil(W * k), ph = Math.ceil(H * k);
        if (this.pix.width !== pw || this.pix.height !== ph) { this.pix.width = pw; this.pix.height = ph; }
        ctx = this.pctx;
      }
      this.ctx = ctx; this.k = k;
      g.computeView();
      const v = g.view, S = v.scale;
      const pal = g.rt.pal || VC.Lex.palette('ember');
      this.pal = pal;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = !pixel;

      if (g.state === 'empty') { this.drawVoid(ctx, W, H, now, pal); this.finish(ctx, W, H, pixel); return; }

      const bg = g.spec.look.background || 'void';
      this.drawBackground(ctx, bg, pal, W, H, now);

      // world transform
      const cam = g.cam;
      const wob = fx.has('wobble') || fx.has('psychedelic') ? Math.sin(now * 1.7) * 0.025 : 0;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.translate(W / 2, H / 2);
      if (wob) { ctx.rotate(wob); ctx.scale(1 + Math.sin(now * 2.3) * 0.02, 1 + Math.cos(now * 2.1) * 0.02); }
      ctx.scale(S, S);
      ctx.translate(-cam.x + cam.ox, -cam.y + cam.oy);
      this.S = S;
      const vx0 = cam.x - W / 2 / S - 80, vx1 = cam.x + W / 2 / S + 80, vy0 = cam.y - H / 2 / S - 80, vy1 = cam.y + H / 2 / S + 80;
      this.vb = { x0: vx0, x1: vx1, y0: vy0, y1: vy1 };

      if (bg === 'grid' || bg === 'dots') this.drawWorldGrid(ctx, bg, pal);
      // world floor tint
      ctx.fillStyle = U.rgba(pal.bg2, 0.25);
      ctx.fillRect(0, 0, g.W, g.H);
      this.drawTiles(ctx, pal, now);
      if (g.lvl && g.lvl.type === 'track') this.drawTrackLine(ctx);

      // entities
      const ents = g.entities.filter((e) => !e.dead && e.x > vx0 - e.r && e.x < vx1 + e.r && e.y > vy0 - e.r && e.y < vy1 + e.r);
      const side = g.spec.world.physics === 'platformer' || g.spec.world.physics === 'runner';
      if (!side) ents.sort((a, b) => (a.def.static ? -1 : 0) - (b.def.static ? -1 : 0) || a.y - b.y);
      else ents.sort((a, b) => layer(a) - layer(b));
      // auras / cones
      for (const e of ents) this.drawUnder(ctx, e, now);
      // shadows
      if (!side) for (const e of ents) if (!e.def.projectile) this.drawShadow(ctx, e, pal);
      for (const e of ents) { if (e.isPlayer) this.drawPlayer(ctx, e, now, pal); else this.drawEntity(ctx, e, now, pal); }
      this.drawBombs(ctx, now);
      this.drawParticles(ctx, false, dt);
      this.drawFloaters(ctx, now);
      if (g.modsFns && g.modsFns.onDraw) { ctx.save(); g.callMod('onDraw', ctx); ctx.restore(); }

      // screen space
      ctx.setTransform(k, 0, 0, k, 0, 0);
      this.drawWeather(ctx, fx, W, H, dt, now, pal);
      this.drawLighting(ctx, fx, W, H, now, pal);
      if (fx.has('vignette')) this.vignette(ctx, W, H, 0.5);
      if (g.rt.tint) { ctx.globalAlpha = 0.28 * Math.min(1, g.rt.tint.t / 0.4); ctx.fillStyle = g.rt.tint.color; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      if (g.rt.flash > 0) { ctx.globalAlpha = Math.min(0.55, g.rt.flash * 2.2); ctx.fillStyle = g.rt.flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      ctx.setTransform(k * v.dpr, 0, 0, k * v.dpr, 0, 0);
      this.drawParticles(ctx, true, dt);
      this.drawHud(ctx, W / v.dpr, H / v.dpr, now, pal);
      this.finish(ctx, W, H, pixel);
    }

    finish(ctx, W, H, pixel) {
      if (!pixel) return;
      const m = this.g.ctx;
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.imageSmoothingEnabled = false;
      m.drawImage(this.pix, 0, 0, W, H);
    }

    // ---------------------------------------------------------------- void
    drawVoid(ctx, W, H, t, pal) {
      const dpr = this.g.view.dpr;
      ctx.fillStyle = '#120f0d'; ctx.fillRect(0, 0, W, H);
      const gr = ctx.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.45, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(217,119,87,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(236,228,216,0.035)'; ctx.lineWidth = 1;
      const step = 40 * dpr;
      ctx.beginPath();
      for (let x = (W / 2) % step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = (H / 2) % step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      // motes
      for (let i = 0; i < 40; i++) {
        const h = U.hash('m' + i);
        const x = ((h % 1000) / 1000 * W + Math.sin(t * 0.2 + i) * 20 * dpr) % W;
        const y = (((h >> 10) % 1000) / 1000 * H - t * (6 + i % 5) * dpr + H * 10) % H;
        ctx.fillStyle = 'rgba(236,228,216,' + (0.04 + (i % 4) * 0.02) + ')';
        ctx.fillRect(x, y, 2 * dpr, 2 * dpr);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = (13 * dpr) + 'px ' + MONO;
      ctx.fillStyle = 'rgba(236,228,216,0.32)';
      const line = '// nothing exists yet';
      ctx.fillText(line, W / 2, H / 2 - 12 * dpr);
      ctx.fillStyle = 'rgba(236,228,216,0.18)';
      ctx.fillText('describe something and it will appear here', W / 2, H / 2 + 12 * dpr);
      if (Math.floor(t * 1.8) % 2 === 0) { const w = ctx.measureText(line).width; ctx.fillStyle = 'rgba(217,119,87,0.8)'; ctx.fillRect(W / 2 + w / 2 + 4 * dpr, H / 2 - 20 * dpr, 7 * dpr, 15 * dpr); }
    }

    // ---------------------------------------------------------------- backgrounds
    drawBackground(ctx, type, pal, W, H, t) {
      const g = this.g, cam = g.cam, S = g.view.scale;
      const top = pal.bg2, bot = pal.bg;
      const grad = (a, b, y0, y1) => { const gr = ctx.createLinearGradient(0, y0 == null ? 0 : y0, 0, y1 == null ? H : y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
      const px = (p) => cam.x * S * p, py = (p) => cam.y * S * p;
      const sil = (amt) => U.mix(pal.bg, pal.wall, amt);
      ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
      switch (type) {
        case 'gradient': ctx.fillStyle = grad(top, bot); ctx.fillRect(0, 0, W, H); break;
        case 'stars': {
          ctx.fillStyle = grad(U.mix(pal.bg, pal.bg2, 0.6), pal.bg); ctx.fillRect(0, 0, W, H);
          this.stars(ctx, W, H, t, 0.08, 90, 1.2, 0.5); this.stars(ctx, W, H, t, 0.2, 60, 1.8, 0.75); this.stars(ctx, W, H, t, 0.45, 26, 2.6, 1);
          if (g.spec.world.physics === 'shmup') this.stars(ctx, W, H, t, 0, 40, 2, 0.6, t * 120);
          break;
        }
        case 'sky': case 'clouds': {
          ctx.fillStyle = grad(U.shade(pal.bg2, 0.1), pal.bg); ctx.fillRect(0, 0, W, H);
          const sr = Math.min(W, H) * 0.08;
          ctx.fillStyle = U.rgba('#fff4cc', 0.85); ctx.beginPath(); ctx.arc(W * 0.78 - px(0.02), H * 0.2, sr, 0, 7); ctx.fill();
          ctx.fillStyle = U.rgba('#fff4cc', 0.15); ctx.beginPath(); ctx.arc(W * 0.78 - px(0.02), H * 0.2, sr * 2, 0, 7); ctx.fill();
          this.clouds(ctx, W, H, t, 0.1, type === 'clouds' ? 9 : 5, 0.5);
          this.clouds(ctx, W, H, t, 0.25, type === 'clouds' ? 7 : 3, 0.8);
          break;
        }
        case 'mountains': case 'hills': case 'snow': {
          ctx.fillStyle = grad(type === 'snow' ? U.shade(pal.bg2, 0.15) : top, bot); ctx.fillRect(0, 0, W, H);
          if (type !== 'hills') this.stars(ctx, W, H, t, 0.05, 30, 1.4, 0.35);
          const layers = type === 'hills' ? [[0.1, 0.55, 0.25, 0.012, 60], [0.25, 0.68, 0.45, 0.009, 80], [0.45, 0.8, 0.7, 0.006, 70]] : [[0.08, 0.5, 0.25, 0.004, 160], [0.2, 0.62, 0.5, 0.006, 120], [0.4, 0.75, 0.75, 0.009, 90]];
          for (const [p, base, a, f, amp] of layers) {
            const col = type === 'snow' ? U.mix('#ffffff', pal.wall, 0.3 + a * 0.4) : type === 'hills' ? U.mix(pal.bg, pal.wallTop, a * 0.7) : sil(a);
            this.ridge(ctx, W, H, col, base, amp * g.view.dpr, f / g.view.dpr, px(p), type === 'hills' ? 0 : 1, py(p * 0.3));
          }
          break;
        }
        case 'forest': {
          ctx.fillStyle = grad(top, bot); ctx.fillRect(0, 0, W, H);
          for (const [p, base, a, size] of [[0.1, 0.55, 0.3, 60], [0.25, 0.68, 0.55, 85], [0.5, 0.82, 0.8, 120]]) this.pines(ctx, W, H, sil(a), base, size * g.view.dpr, px(p), py(p * 0.3));
          break;
        }
        case 'ocean': {
          ctx.fillStyle = grad(U.shade(pal.bg2, 0.1), U.shade(pal.bg, -0.3)); ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 6; i++) {
            const x = ((i * 0.19 + 0.05) * W - px(0.05) + Math.sin(t * 0.3 + i) * 30) % (W * 1.2);
            ctx.fillStyle = 'rgba(160,220,255,0.035)';
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + W * 0.08, 0); ctx.lineTo(x + W * 0.25, H); ctx.lineTo(x + W * 0.12, H); ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
          for (let i = 0; i < 26; i++) {
            const h = U.hash('b' + i), x = ((h % 997) / 997 * W - px(0.1) % W + W) % W, y = H - ((t * (20 + (h % 30)) * g.view.dpr + (h % 600)) % (H + 40));
            ctx.strokeStyle = 'rgba(200,240,255,0.18)'; ctx.lineWidth = g.view.dpr; ctx.beginPath(); ctx.arc(x + Math.sin(t + i) * 8, y, (2 + (h % 4)) * g.view.dpr, 0, 7); ctx.stroke();
          }
          break;
        }
        case 'dunes': {
          ctx.fillStyle = grad(U.shade(pal.bg2, 0.2), pal.bg); ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = U.rgba('#fff0c8', 0.6); ctx.beginPath(); ctx.arc(W * 0.25, H * 0.22, Math.min(W, H) * 0.07, 0, 7); ctx.fill();
          for (const [p, base, a] of [[0.1, 0.6, 0.35], [0.25, 0.72, 0.6], [0.45, 0.84, 0.85]]) this.ridge(ctx, W, H, U.mix(pal.bg, pal.wallTop, a * 0.6), base, 40 * g.view.dpr, 0.004 / g.view.dpr, px(p), 0, py(p * 0.3));
          break;
        }
        case 'hell': {
          ctx.fillStyle = grad(pal.bg, U.shade(pal.wallTop, -0.35)); ctx.fillRect(0, 0, W, H);
          this.ridge(ctx, W, H, sil(0.5), 0.7, 120 * g.view.dpr, 0.006 / g.view.dpr, px(0.2), 1, py(0.05));
          for (let i = 0; i < 40; i++) { const h = U.hash('e' + i); const x = ((h % 997) / 997 * W + Math.sin(t + i) * 20) % W, y = H - ((t * (30 + (h % 50)) * g.view.dpr + (h % 900)) % (H + 20)); ctx.fillStyle = 'rgba(255,140,60,' + (0.25 + (h % 5) / 10) + ')'; ctx.fillRect(x, y, 2 * g.view.dpr, 2 * g.view.dpr); }
          break;
        }
        case 'city': {
          ctx.fillStyle = grad(top, bot); ctx.fillRect(0, 0, W, H);
          this.stars(ctx, W, H, t, 0.04, 30, 1.2, 0.3);
          this.skyline(ctx, W, H, sil(0.35), 0.5, 0.08, pal, 1);
          this.skyline(ctx, W, H, sil(0.65), 0.62, 0.2, pal, 2);
          break;
        }
        case 'synthwave': {
          const hz = H * 0.58;
          ctx.fillStyle = grad(U.shade(pal.bg, -0.2), U.mix(pal.wallTop, pal.bg, 0.45), 0, hz); ctx.fillRect(0, 0, W, hz);
          this.stars(ctx, W, H * 0.6, t, 0.03, 40, 1.3, 0.5);
          const sr = Math.min(W, H) * 0.18, sx = W / 2, sy = hz - sr * 0.3;
          const sg = ctx.createLinearGradient(0, sy - sr, 0, sy + sr); sg.addColorStop(0, '#ffe66d'); sg.addColorStop(1, pal.wallTop);
          ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.clip(); ctx.fillStyle = sg; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
          ctx.fillStyle = U.shade(pal.bg, -0.2);
          for (let i = 0; i < 7; i++) { const yy = sy + sr * (0.05 + i * 0.14); ctx.fillRect(sx - sr, yy, sr * 2, 2 + i * 1.6 * g.view.dpr); }
          ctx.restore();
          ctx.fillStyle = U.shade(pal.bg, -0.35); ctx.fillRect(0, hz, W, H - hz);
          ctx.strokeStyle = U.rgba(pal.wallTop, 0.55); ctx.lineWidth = 1.2 * g.view.dpr;
          ctx.beginPath();
          const off = ((t * 0.6 + cam.y * 0.002) % 1);
          for (let i = 0; i < 14; i++) { const f = (i + off) / 14; const yy = hz + (H - hz) * f * f; ctx.moveTo(0, yy); ctx.lineTo(W, yy); }
          const shift = (cam.x * S * 0.3) % (W / 10);
          for (let i = -12; i <= 12; i++) { const x0 = W / 2 + i * W / 10 - shift; ctx.moveTo(W / 2 + (x0 - W / 2) * 0.1, hz); ctx.lineTo(x0 + (x0 - W / 2) * 1.6, H); }
          ctx.stroke();
          break;
        }
        case 'graveyard': {
          ctx.fillStyle = grad(top, bot); ctx.fillRect(0, 0, W, H);
          this.stars(ctx, W, H, t, 0.04, 40, 1.2, 0.4);
          ctx.fillStyle = 'rgba(240,235,210,0.85)'; ctx.beginPath(); ctx.arc(W * 0.72 - px(0.02), H * 0.2, Math.min(W, H) * 0.06, 0, 7); ctx.fill();
          ctx.fillStyle = U.rgba(pal.bg, 0.9); ctx.beginPath(); ctx.arc(W * 0.72 - px(0.02) + Math.min(W, H) * 0.025, H * 0.19, Math.min(W, H) * 0.055, 0, 7); ctx.fill();
          this.ridge(ctx, W, H, sil(0.35), 0.72, 40 * g.view.dpr, 0.004 / g.view.dpr, px(0.15), 0, py(0.05));
          ctx.fillStyle = sil(0.35);
          for (let i = 0; i < 14; i++) { const h = U.hash('g' + i); const x = ((h % 1000) / 1000 * W * 1.5 - px(0.15)) % (W * 1.5); const y = H * 0.72 - 10 * g.view.dpr; const w = (10 + h % 8) * g.view.dpr; ctx.fillRect(x, y - w * 1.2, w, w * 1.6); ctx.beginPath(); ctx.arc(x + w / 2, y - w * 1.2, w / 2, Math.PI, 0); ctx.fill(); }
          break;
        }
        case 'void': default: {
          const gr = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
          gr.addColorStop(0, pal.bg2); gr.addColorStop(1, pal.bg);
          ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
        }
      }
    }
    stars(ctx, W, H, t, p, n, size, alpha, scroll) {
      const g = this.g, S = g.view.scale, dpr = g.view.dpr;
      const ox = g.cam.x * S * p, oy = g.cam.y * S * p - (scroll || 0) * dpr;
      for (let i = 0; i < n; i++) {
        const h = U.hash('s' + p + i);
        const x = (((h % 10007) / 10007 * W * 1.5 - ox) % W + W) % W;
        const y = ((((h >> 8) % 10007) / 10007 * H * 1.5 - oy) % H + H) % H;
        const tw = 0.6 + 0.4 * Math.sin(t * (1 + (h % 7) * 0.3) + i);
        ctx.globalAlpha = alpha * tw;
        ctx.fillStyle = i % 9 === 0 ? '#ffe9c4' : i % 11 === 0 ? '#c4dcff' : '#ffffff';
        ctx.fillRect(x, y, size * dpr, size * dpr);
      }
      ctx.globalAlpha = 1;
    }
    clouds(ctx, W, H, t, p, n, alpha) {
      const g = this.g, S = g.view.scale, dpr = g.view.dpr;
      for (let i = 0; i < n; i++) {
        const h = U.hash('c' + p + i);
        const w = (80 + (h % 120)) * dpr * (1 + p);
        const x = ((((h % 1000) / 1000) * (W + w * 2) - g.cam.x * S * p + t * 8 * dpr * (1 + p)) % (W + w * 2) + W + w * 2) % (W + w * 2) - w;
        const y = ((h >> 10) % 1000) / 1000 * H * 0.5 + 20 * dpr;
        ctx.fillStyle = 'rgba(255,255,255,' + alpha * 0.55 + ')';
        ctx.beginPath();
        ctx.ellipse(x, y, w * 0.5, w * 0.16, 0, 0, 7);
        ctx.ellipse(x - w * 0.2, y + w * 0.02, w * 0.28, w * 0.14, 0, 0, 7);
        ctx.ellipse(x + w * 0.15, y - w * 0.06, w * 0.24, w * 0.15, 0, 0, 7);
        ctx.fill();
      }
    }
    ridge(ctx, W, H, color, base, amp, freq, off, sharp, oy) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) {
        const X = x + off;
        let y = Math.sin(X * freq) * 0.5 + Math.sin(X * freq * 2.3 + 1.3) * 0.3 + Math.sin(X * freq * 5.1 + 2) * 0.12;
        if (sharp) y = Math.abs(y) * 1.4 - 0.3;
        ctx.lineTo(x, H * base - y * amp - (oy || 0) * 0.15);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
    pines(ctx, W, H, color, base, size, off, oy) {
      ctx.fillStyle = color;
      ctx.fillRect(0, H * base - (oy || 0) * 0.15, W, H);
      const step = size * 0.55;
      const start = -((off % step) + step) % step - step;
      for (let x = start; x < W + step; x += step) {
        const i = Math.floor((x + off) / step);
        const h = size * (0.7 + (U.hash('p' + i + color) % 60) / 100);
        const y = H * base - (oy || 0) * 0.15;
        ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.32, y + 2); ctx.lineTo(x - h * 0.32, y + 2); ctx.fill();
      }
    }
    skyline(ctx, W, H, color, base, p, pal, seed) {
      const g = this.g, dpr = g.view.dpr, S = g.view.scale;
      const off = g.cam.x * S * p;
      const bw = 46 * dpr;
      const start = -((off % bw) + bw) % bw - bw;
      for (let x = start; x < W + bw; x += bw) {
        const i = Math.floor((x + off) / bw);
        const h = (60 + (U.hash('k' + seed + i) % 160)) * dpr * (seed === 2 ? 1.25 : 1);
        const y = H * base + (seed === 2 ? 40 : 0) * dpr;
        ctx.fillStyle = color; ctx.fillRect(x, y - h, bw - 4 * dpr, H);
        ctx.fillStyle = U.rgba(pal.accent, 0.35);
        for (let wy = y - h + 8 * dpr; wy < y; wy += 12 * dpr) for (let wx = x + 6 * dpr; wx < x + bw - 10 * dpr; wx += 10 * dpr) if (U.hash(i + ':' + wx + ':' + wy) % 5 === 0) ctx.fillRect(wx, wy, 4 * dpr, 5 * dpr);
      }
    }
    drawWorldGrid(ctx, kind, pal) {
      const vb = this.vb, step = 64;
      ctx.strokeStyle = U.rgba(pal.text, 0.05); ctx.fillStyle = U.rgba(pal.text, 0.12);
      ctx.lineWidth = 1 / this.S;
      if (kind === 'grid') {
        ctx.beginPath();
        for (let x = Math.floor(vb.x0 / step) * step; x < vb.x1; x += step) { ctx.moveTo(x, vb.y0); ctx.lineTo(x, vb.y1); }
        for (let y = Math.floor(vb.y0 / step) * step; y < vb.y1; y += step) { ctx.moveTo(vb.x0, y); ctx.lineTo(vb.x1, y); }
        ctx.stroke();
      } else {
        for (let x = Math.floor(vb.x0 / 32) * 32; x < vb.x1; x += 32) for (let y = Math.floor(vb.y0 / 32) * 32; y < vb.y1; y += 32) ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    // ---------------------------------------------------------------- tiles
    drawTiles(ctx, pal, t) {
      const g = this.g, grid = g.grid, ts = grid.ts, vb = this.vb;
      const c0 = Math.max(0, Math.floor(vb.x0 / ts)), c1 = Math.min(grid.cols - 1, Math.floor(vb.x1 / ts));
      const r0 = Math.max(0, Math.floor(vb.y0 / ts)), r1 = Math.min(grid.rows - 1, Math.floor(vb.y1 / ts));
      const lip = ts * 0.2;
      const wallDark = U.shade(pal.wall, -0.18);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const v = grid.tiles[r * grid.cols + c];
        if (!v) continue;
        const x = c * ts, y = r * ts;
        switch (v) {
          case T.WALL: {
            const h = U.hash(c * 7 + ':' + r);
            ctx.fillStyle = (h % 5) === 0 ? U.shade(pal.wall, -0.06) : (h % 7) === 0 ? U.shade(pal.wall, 0.04) : pal.wall;
            ctx.fillRect(x, y, ts + 0.5, ts + 0.5);
            const up = grid.get(c, r - 1);
            if (up !== T.WALL && up !== -1) { ctx.fillStyle = pal.wallTop; ctx.fillRect(x, y, ts + 0.5, lip); ctx.fillStyle = U.rgba('#ffffff', 0.08); ctx.fillRect(x, y, ts, lip * 0.35); }
            const dn = grid.get(c, r + 1);
            if (dn !== T.WALL && dn !== -1) { ctx.fillStyle = wallDark; ctx.fillRect(x, y + ts - ts * 0.12, ts + 0.5, ts * 0.12); }
            break;
          }
          case T.PLATFORM: {
            ctx.fillStyle = pal.wallTop; ctx.fillRect(x, y, ts + 0.5, ts * 0.28);
            ctx.fillStyle = U.shade(pal.wall, -0.1); ctx.fillRect(x, y + ts * 0.28, ts + 0.5, ts * 0.12);
            ctx.fillStyle = U.rgba('#ffffff', 0.1); ctx.fillRect(x, y, ts, ts * 0.07);
            break;
          }
          case T.TREE: {
            const h = U.hash(c + ':' + r + 't');
            const cg = U.mix(['#3f8f4f', '#4f9a45', '#367a4a', '#5a9a3a'][h % 4], pal.wallTop, 0.3);
            const sw = Math.sin(t * 1.3 + (h % 10)) * ts * 0.02;
            ctx.fillStyle = pal.shadow; ctx.beginPath(); ctx.ellipse(x + ts * 0.55, y + ts * 0.86, ts * 0.42, ts * 0.13, 0, 0, 7); ctx.fill();
            ctx.fillStyle = '#5a3d2a'; ctx.fillRect(x + ts * 0.44, y + ts * 0.5, ts * 0.13, ts * 0.38);
            ctx.fillStyle = U.shade(cg, -0.3);
            ctx.beginPath(); ctx.arc(x + ts * 0.32 + sw, y + ts * 0.5, ts * 0.26, 0, 7); ctx.arc(x + ts * 0.68 + sw, y + ts * 0.5, ts * 0.26, 0, 7); ctx.arc(x + ts * 0.5 + sw, y + ts * 0.3, ts * 0.3, 0, 7); ctx.fill();
            ctx.fillStyle = cg;
            ctx.beginPath(); ctx.arc(x + ts * 0.3 + sw, y + ts * 0.44, ts * 0.2, 0, 7); ctx.arc(x + ts * 0.62 + sw, y + ts * 0.42, ts * 0.21, 0, 7); ctx.arc(x + ts * 0.46 + sw, y + ts * 0.24, ts * 0.22, 0, 7); ctx.fill();
            ctx.fillStyle = U.rgba('#ffffff', 0.14); ctx.beginPath(); ctx.arc(x + ts * 0.4 + sw, y + ts * 0.18, ts * 0.08, 0, 7); ctx.fill();
            break;
          }
          case T.LAVA: {
            const gr = ctx.createLinearGradient(0, y, 0, y + ts); gr.addColorStop(0, '#ffb347'); gr.addColorStop(1, '#d9381e');
            ctx.fillStyle = gr; ctx.fillRect(x, y, ts + 0.5, ts + 0.5);
            const h = U.hash(c + ',' + r), ph = (t * 1.3 + (h % 100) / 30) % 1;
            ctx.fillStyle = 'rgba(255,240,180,' + (0.6 * (1 - ph)) + ')';
            ctx.beginPath(); ctx.arc(x + (h % ts), y + ts * (0.8 - ph * 0.6), 2 + ph * 3, 0, 7); ctx.fill();
            if (grid.get(c, r - 1) !== T.LAVA) { ctx.fillStyle = 'rgba(255,220,120,0.9)'; ctx.fillRect(x, y + Math.sin(t * 3 + c) * 1.5, ts + 0.5, 3); }
            break;
          }
          case T.WATER: {
            ctx.fillStyle = 'rgba(64,150,220,0.72)'; ctx.fillRect(x, y, ts + 0.5, ts + 0.5);
            ctx.strokeStyle = 'rgba(200,235,255,0.35)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); const wy = y + ts * 0.35 + Math.sin(t * 2 + c * 0.8 + r) * 3; ctx.moveTo(x + 4, wy); ctx.quadraticCurveTo(x + ts / 2, wy - 4, x + ts - 4, wy); ctx.stroke();
            break;
          }
          case T.ICE: {
            ctx.fillStyle = '#bfe6f7'; ctx.fillRect(x, y, ts + 0.5, ts + 0.5);
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(x + ts * 0.15, y + ts * 0.8); ctx.lineTo(x + ts * 0.35, y + ts * 0.8); ctx.lineTo(x + ts * 0.8, y + ts * 0.2); ctx.lineTo(x + ts * 0.6, y + ts * 0.2); ctx.fill();
            break;
          }
          case T.SPIKES: {
            ctx.fillStyle = '#d6dbe0';
            const n = 3, w = ts / n;
            for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.moveTo(x + i * w, y + ts); ctx.lineTo(x + i * w + w / 2, y + ts * 0.3); ctx.lineTo(x + (i + 1) * w, y + ts); ctx.fill(); }
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.moveTo(x + i * w + w / 2, y + ts * 0.3); ctx.lineTo(x + (i + 1) * w, y + ts); ctx.lineTo(x + i * w + w / 2, y + ts); ctx.fill(); }
            break;
          }
          case T.BOUNCE: {
            ctx.fillStyle = '#3a4a5a'; ctx.fillRect(x + 2, y + ts * 0.55, ts - 4, ts * 0.45);
            ctx.fillStyle = '#5dd0ff'; ctx.fillRect(x, y + ts * 0.4 + Math.sin(t * 6 + c) * 1.5, ts, ts * 0.2);
            break;
          }
          default: break;
        }
      }
      // goal flag marker for levels with goals but no goal entity
    }
    drawTrackLine(ctx) {
      const L = this.g.lvl;
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([18, 18]); ctx.lineWidth = 4;
      ctx.beginPath(); L.checkpoints.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke(); ctx.restore();
      const gl = L.goal; ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2 === 0) ctx.fillRect(gl.x - 6 + j * 6, gl.y - 140 + i * 47, 6, 47);
    }

    // ---------------------------------------------------------------- entities
    drawUnder(ctx, e, t) {
      const d = e.def;
      for (const b of d.behaviors || []) {
        if (b.type === 'chase' && b.sight) {
          const a = e.st.look || 0, cone = (b.cone || 55) * Math.PI / 180;
          ctx.fillStyle = e.st.alertT > 0 ? 'rgba(255,80,80,0.16)' : 'rgba(255,240,180,0.09)';
          ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, b.sight, a - cone, a + cone); ctx.closePath(); ctx.fill();
        }
        if (b.type === 'aura') { ctx.fillStyle = U.rgba(d.color || '#8f8', 0.08 + Math.sin(t * 4) * 0.03); ctx.beginPath(); ctx.arc(e.x, e.y, b.radius || 90, 0, 7); ctx.fill(); }
        if (b.type === 'magnet') { ctx.strokeStyle = U.rgba(d.color || '#aaa', 0.12); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, (b.range || 260) * (0.4 + ((t * 0.6) % 1) * 0.6), 0, 7); ctx.stroke(); }
      }
      if (e.trail && e.trail.length > 1) {
        const col = e.tint || d.color || '#fff';
        for (let i = 1; i < e.trail.length; i++) {
          const p = e.trail[i];
          ctx.globalAlpha = (1 - i / e.trail.length) * 0.35;
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, e.r * (1 - i / e.trail.length) * (d.projectile ? 0.6 : 0.8)), 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
    drawShadow(ctx, e, pal) {
      if (e.def.flying && !e.isPlayer) { ctx.fillStyle = pal.shadow; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 1.4, e.r * 0.6, e.r * 0.22, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1; return; }
      if (e.hw) return;
      const z = e.z || 0;
      ctx.fillStyle = pal.shadow;
      ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 0.72, e.r * (0.8 - z / 300), e.r * (0.3 - z / 900), 0, 0, 7); ctx.fill();
    }

    bodyColor(e, t) {
      const fx = e.def.effects || [];
      if (fx.includes('rainbow')) return U.hsl(t * 140 + e.id * 40, 75, 62);
      return e.tint || e.def.color || '#c9a3e6';
    }

    drawEntity(ctx, e, t, pal) {
      const d = e.def, fx = d.effects || [];
      let alpha = d.alpha == null ? 1 : d.alpha;
      if (fx.includes('flicker')) alpha *= 0.55 + 0.45 * Math.abs(Math.sin(t * 9 + e.id));
      if (fx.includes('blink') && Math.floor(t * 4 + e.id) % 2) alpha *= 0.35;
      if (e.frozen > 0) alpha *= 0.9;
      if (alpha <= 0.01) return;
      const pop = e.pop > 0 ? 1 - e.pop / 0.25 : 1;
      let sx = 1, sy = 1, rot = 0, oy = -(e.z || 0) + (e.st.wy || 0) * 0;
      if (fx.includes('wobble')) { sx = 1 + Math.sin(t * 9 + e.id) * 0.1; sy = 2 - sx; }
      if (fx.includes('pulse')) { const p = 1 + Math.sin(t * 4 + e.id) * 0.12; sx *= p; sy *= p; }
      if (fx.includes('dance')) { rot = Math.sin(t * 8 + e.id) * 0.35; oy -= Math.abs(Math.sin(t * 8 + e.id)) * 6; }
      if (e.squash) { sy *= 1 + e.squash; sx *= 1 - e.squash * 0.6; e.squash *= 0.85; if (Math.abs(e.squash) < 0.01) e.squash = 0; }
      const size = e.size * Math.max(0.05, easeOutBack(pop));
      const col = this.bodyColor(e, t);
      ctx.save();
      ctx.translate(e.x, e.y + oy);
      ctx.globalAlpha = alpha;
      if (fx.includes('glow') || d.boss) this.glow(ctx, col, e.r * (d.projectile ? 2.6 : 1.9));
      if (d.projectile) {
        this.drawProjectile(ctx, e, size, col);
        ctx.restore(); return;
      }
      if (e.angle && (fx.includes('spin') || d.roll)) rot += e.angle;
      if (d.roll) rot = e.x / (e.r || 1);
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      const useGlyph = d.glyph && this.emojiOK && this.g.spec.look.style !== 'shapes';
      if (useGlyph) {
        const px = size * this.S * this.k * 1.05;
        const tint = fx.includes('rainbow') ? U.hsl(Math.round((t * 140 + e.id * 40) / 30) * 30, 80, 60) : e.tint || d.tint || null;
        const spr = this.sprite(d.glyph, px, tint, tint ? 0.4 : 0);
        const s = size * 1.3 * 1.05;
        if (e.face > 0 && !d.static && !fx.includes('spin') && d.role !== 'vehicle') ctx.scale(-1, 1);
        ctx.drawImage(spr, -s / 2, -s / 2, s, s);
        if (e.flash > 0) { ctx.globalAlpha = Math.min(1, e.flash * 7) * alpha; ctx.drawImage(this.sprite(d.glyph, px, '#ffffff', 1), -s / 2, -s / 2, s, s); }
        if (e.frozen > 0) { ctx.globalAlpha = 0.55; ctx.drawImage(this.sprite(d.glyph, px, '#9fdcff', 0.8), -s / 2, -s / 2, s, s); }
      } else {
        this.shape(ctx, d.shape || (d.role === 'obstacle' ? 'square' : 'blob'), size, col, t, e);
        if (e.flash > 0) { ctx.globalAlpha = Math.min(1, e.flash * 7) * alpha; this.shape(ctx, d.shape || 'blob', size, '#ffffff', t, e, true); }
        if (e.frozen > 0) { ctx.globalAlpha = 0.5; this.shape(ctx, d.shape || 'blob', size, '#9fdcff', t, e, true); }
        ctx.globalAlpha = alpha;
        const creature = ['enemy', 'boss', 'npc', 'pet', 'critter'].includes(d.role) && !['line', 'ring', 'trampoline', 'square'].includes(d.shape);
        if (creature && !d.static) this.eyes(ctx, e, size / 2, t, e.team === 'enemy');
        else if (creature && d.role !== 'obstacle') this.eyes(ctx, e, size / 2, t, e.team === 'enemy');
      }
      ctx.restore();
      // overlays not affected by rotation
      if (d.label || (!useGlyph && d.unknown)) this.label(ctx, e.x, e.y + e.r + 12, d.label || U.human(e.type), pal);
      if (!d.boss && e.maxHp >= 3 && e.hp < e.maxHp && e.maxHp < 99 && e.hp > 0) this.hpBar(ctx, e.x, e.y - e.r - 9, Math.max(22, e.r * 1.6), e.hp / e.maxHp, e.team === 'enemy' ? '#ff5d6c' : '#7ee08a');
      if (d.boss && e.hp > 0) this.hpBar(ctx, e.x, e.y - e.r - 12, e.r * 2, e.hp / e.maxHp, '#ff5d6c');
    }

    drawProjectile(ctx, e, size, col) {
      const d = e.def;
      ctx.rotate(e.angle || 0);
      if (d.glyph && this.emojiOK && this.g.spec.look.style !== 'shapes') {
        const px = size * this.S * this.k * 1.1;
        const s = size * 1.3;
        ctx.drawImage(this.sprite(d.glyph, px), -s / 2, -s / 2, s, s);
        return;
      }
      const sh = d.shape || 'circle';
      if (sh === 'line') {
        ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2, size * 0.35);
        ctx.beginPath(); ctx.moveTo(-size * 1.2, 0); ctx.lineTo(size * 0.6, 0); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, size * 0.12); ctx.globalAlpha *= 0.8;
        ctx.beginPath(); ctx.moveTo(-size * 0.8, 0); ctx.lineTo(size * 0.5, 0); ctx.stroke();
        return;
      }
      this.shape(ctx, sh, size, col, 0, e);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(0, 0, size * 0.18, 0, 7); ctx.fill();
    }

    glow(ctx, col, r) {
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      gr.addColorStop(0, U.rgba(col, 0.45)); gr.addColorStop(1, U.rgba(col, 0));
      const op = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = op;
    }

    shape(ctx, sh, size, col, t, e, flat) {
      const r = size / 2;
      const dark = flat ? col : U.shade(col, -0.28);
      ctx.fillStyle = col;
      ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.beginPath();
      switch (sh) {
        case 'square': { const w = e && e.hw ? e.hw * 2 : size, h = e && e.hh ? e.hh * 2 : size; roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.2); break; }
        case 'triangle': ctx.moveTo(0, -r); ctx.lineTo(r * 0.92, r * 0.75); ctx.lineTo(-r * 0.92, r * 0.75); ctx.closePath(); break;
        case 'diamond': ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.8, 0); ctx.closePath(); break;
        case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); break;
        case 'hex': for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); break;
        case 'ring': ctx.arc(0, 0, r * 0.8, 0, 7); ctx.strokeStyle = col; ctx.lineWidth = r * 0.3; ctx.stroke(); return;
        case 'capsule': roundRect(ctx, -r * 1.4, -r * 0.7, r * 2.8, r * 1.4, r * 0.7); break;
        case 'trampoline': {
          ctx.fillStyle = '#39424d'; ctx.fillRect(-r, r * 0.2, r * 2, r * 0.5);
          const sq = e && e.squash ? e.squash : 0;
          ctx.fillStyle = col; roundRect(ctx, -r * 1.05, -r * (0.25 - sq), r * 2.1, r * 0.32, r * 0.16); ctx.fill();
          if (e && e.squash) e.squash *= 0.85;
          return;
        }
        case 'blob': {
          const n = 10, tt = t * 3 + (e ? e.id : 0);
          for (let i = 0; i <= n; i++) {
            const a = i / n * Math.PI * 2;
            const rr = r * (1 + Math.sin(a * 3 + tt) * 0.05 + Math.cos(a * 2 - tt * 0.7) * 0.04);
            const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.94 + r * 0.04;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath(); break;
        }
        case 'circle': default: ctx.arc(0, 0, r, 0, 7); break;
      }
      ctx.fill();
      if (!flat) {
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.38, r * 0.32, r * 0.18, -0.5, 0, 7); ctx.fill();
      }
    }

    eyes(ctx, e, r, t, angry) {
      const P = this.g.player;
      let lx = e.vx, ly = e.vy;
      if (angry && P) { lx = P.x - e.x; ly = P.y - e.y; }
      const l = Math.hypot(lx, ly) || 1;
      lx /= l; ly /= l;
      const blink = (Math.floor(t * 0.7 + e.id * 0.37) % 5 === 0) && ((t * 0.7 + e.id * 0.37) % 1) < 0.12;
      const ex = r * 0.34, ey = -r * 0.12, er = r * 0.24;
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(s * ex + lx * r * 0.08, ey + ly * r * 0.06, er, blink ? er * 0.12 : er * 1.12, 0, 0, 7); ctx.fill();
        if (!blink) { ctx.fillStyle = '#1b1820'; ctx.beginPath(); ctx.arc(s * ex + lx * er * 0.55 + lx * r * 0.08, ey + ly * er * 0.55, er * 0.52, 0, 7); ctx.fill(); }
        if (angry) { ctx.strokeStyle = '#1b1820'; ctx.lineWidth = Math.max(1.5, r * 0.09); ctx.beginPath(); ctx.moveTo(s * (ex + er * 1.1), ey - er * 1.5); ctx.lineTo(s * (ex - er * 0.9), ey - er * 0.95); ctx.stroke(); }
      }
    }

    label(ctx, x, y, text, pal) {
      const s = 1 / this.S;
      ctx.save();
      ctx.font = Math.round(11 * this.g.view.dpr) * s + 'px ' + MONO;
      ctx.font = (11 / this.S * this.g.view.dpr) + 'px ' + MONO;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 10 * s * this.g.view.dpr;
      ctx.fillStyle = 'rgba(15,12,10,0.6)'; roundRect(ctx, x - w / 2, y - 8 * s * this.g.view.dpr, w, 16 * s * this.g.view.dpr, 4 * s); ctx.fill();
      ctx.fillStyle = U.rgba(pal.text, 0.9); ctx.fillText(text, x, y + 0.5 * s);
      ctx.restore();
    }
    hpBar(ctx, x, y, w, f, col) {
      const h = Math.max(3, 4 / this.S * this.g.view.dpr);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * U.clamp(f, 0, 1), h);
    }

    drawPlayer(ctx, p, t, pal) {
      const g = this.g, d = p.def, ph = g.spec.world.physics;
      const col = p.powers && p.powers.invincible ? U.hsl(t * 400, 85, 62) : p.tint || d.color || pal.player || '#f2c46d';
      // tail
      if (p.tail && p.tail.length) {
        for (let i = p.tail.length - 1; i >= 0; i--) {
          const s = p.tail[i];
          const f = 1 - i / (p.tail.length + 2);
          if (ph === 'snake') {
            const ts = g.TS * 0.86;
            ctx.fillStyle = U.mix(col, pal.bg, 0.15 + (1 - f) * 0.35);
            roundRect(ctx, s.x - ts / 2, s.y - ts / 2, ts, ts, ts * 0.3); ctx.fill();
          } else {
            ctx.fillStyle = U.mix(col, pal.bg, 0.2 + (1 - f) * 0.3);
            ctx.beginPath(); ctx.arc(s.x, s.y, p.r * (0.5 + f * 0.4), 0, 7); ctx.fill();
          }
        }
      }
      const blink = p.inv > 0 && g.mode === 'play' && Math.floor(t * 18) % 2 === 0;
      ctx.save();
      let x = p.x, y = p.y;
      if (ph === 'snake' && p.st.px != null && p.renderLerp != null) { /* snap to grid; feels crisp */ }
      ctx.translate(x, y - (p.z || 0));
      ctx.globalAlpha = blink ? 0.35 : (p.powers && p.powers.ghost ? 0.45 : 1);
      if (p.st.shielded) { ctx.strokeStyle = 'rgba(143,211,255,0.85)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, p.r * 1.55, 0, 7); ctx.stroke(); ctx.fillStyle = 'rgba(143,211,255,0.12)'; ctx.fill(); }
      if ((d.effects || []).includes('glow') || (p.powers && p.powers.invincible)) this.glow(ctx, col, p.r * 2.3);
      let sx = 1, sy = 1;
      if (p.squash) { sy = 1 + p.squash; sx = 1 - p.squash * 0.6; p.squash *= 0.85; if (Math.abs(p.squash) < 0.01) p.squash = 0; }
      if (ph === 'paddle') {
        const w = (d.size || 28) * 4 * p.scale, h = (d.size || 28) * 0.64;
        const gr = ctx.createLinearGradient(0, -h / 2, 0, h / 2); gr.addColorStop(0, U.shade(col, 0.25)); gr.addColorStop(1, U.shade(col, -0.2));
        ctx.fillStyle = gr; roundRect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill();
        ctx.restore(); return;
      }
      const size = p.size * (p.pop > 0 ? easeOutBack(1 - p.pop / 0.3) : 1);
      const useGlyph = d.glyph && this.renderOK(d);
      const rotating = ph === 'ship' || ph === 'tank';
      const off = useGlyph ? glyphHeading(d.glyph) : null;
      if (rotating) ctx.rotate(p.angle + (off != null ? off : 0));
      else if (off != null && ph === 'shmup') ctx.rotate(-Math.PI / 2 + off);
      ctx.scale(sx, sy);
      if (useGlyph) {
        const px = size * this.S * this.k * 1.05, s = size * 1.36;
        if (!rotating && p.face > 0 && !(off != null && ph === 'shmup') && !/🚀|✈️|🛸/.test(d.glyph)) ctx.scale(-1, 1);
        ctx.drawImage(this.sprite(d.glyph, px, p.tint || null, p.tint ? 0.4 : 0), -s / 2, -s / 2, s, s);
        if (p.flash > 0) { ctx.globalAlpha = Math.min(1, p.flash * 6); ctx.drawImage(this.sprite(d.glyph, px, '#ff4d4d', 0.7), -s / 2, -s / 2, s, s); }
      } else {
        this.shape(ctx, d.shape || 'blob', size, col, t, p);
        if (rotating) { ctx.fillStyle = U.shade(col, -0.35); ctx.beginPath(); ctx.moveTo(size * 0.62, 0); ctx.lineTo(size * 0.25, -size * 0.18); ctx.lineTo(size * 0.25, size * 0.18); ctx.fill(); }
        else this.eyes(ctx, Object.assign({}, p, { vx: Math.cos(p.aim || 0) * 10 + p.vx, vy: Math.sin(p.aim || 0) * 10 + p.vy }), size / 2, t, false);
        if (p.flash > 0) { ctx.globalAlpha = Math.min(1, p.flash * 5) * 0.8; this.shape(ctx, d.shape || 'blob', size, '#ff4d4d', t, p, true); }
      }
      ctx.restore();
      // melee swing
      if (p.st.swing) {
        const sw = p.st.swing, f = 1 - sw.t / 0.18;
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * (1 - f)) + ')'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, 0, sw.reach * 0.85, sw.a - 1.1 + f * 0.6, sw.a + 0.1 + f * 1.1); ctx.stroke();
        const wpn = g.abilities.melee && g.abilities.melee.weapon;
        const gl = wpn && VC.Lex.glyphFor(wpn) ? VC.Lex.glyphFor(wpn) : '🗡️';
        if (this.emojiOK) { const a = sw.a - 1 + f * 2; ctx.translate(Math.cos(a) * sw.reach * 0.7, Math.sin(a) * sw.reach * 0.7); ctx.rotate(a + Math.PI / 4); const s = 30; ctx.drawImage(this.sprite(gl, s * this.S * this.k), -s / 2, -s / 2, s, s); }
        ctx.restore();
      }
      // aim reticle
      if (g.mode === 'play' && g.abilities.shoot && g.abilities.shoot.aim === 'mouse' && g.input.mouse.inside) {
        const m = g.input.mouse;
        ctx.strokeStyle = U.rgba(pal.text, 0.5); ctx.lineWidth = 1.5 / this.S * g.view.dpr;
        ctx.beginPath(); ctx.arc(m.wx, m.wy, 7 / this.S * g.view.dpr, 0, 7); ctx.stroke();
      }
    }
    renderOK(d) { return this.emojiOK && this.g.spec.look.style !== 'shapes' && !!d.glyph; }

    drawBombs(ctx, t) {
      for (const b of this.g.bombs) {
        ctx.save(); ctx.translate(b.x, b.y);
        ctx.strokeStyle = 'rgba(255,90,90,' + (0.25 + 0.2 * Math.sin(t * 20)) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, b.r, 0, 7); ctx.stroke();
        if (this.emojiOK) { const s = 26; ctx.drawImage(this.sprite('💣', s * this.S * this.k), -s / 2, -s / 2, s * 1.3, s * 1.3); }
        else { ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill(); }
        ctx.restore();
      }
    }

    drawParticles(ctx, screen, dt) {
      const ps = this.g.particles;
      for (const p of ps) {
        if (!!p.screen !== screen) continue;
        const f = U.clamp(p.life / p.max, 0, 1);
        ctx.globalAlpha = Math.min(1, f * 1.4);
        switch (p.kind) {
          case 'spark': ctx.strokeStyle = p.color; ctx.lineWidth = p.size * 0.6; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke(); break;
          case 'ring': { const r = p.size * (0.3 + (1 - f) * 0.9); ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, 4 * f); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke(); break; }
          case 'smoke': ctx.globalAlpha = f * 0.45; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - f), 0, 7); ctx.fill(); break;
          case 'star': { ctx.fillStyle = p.color; const s = p.size * (0.5 + f); ctx.beginPath(); ctx.moveTo(p.x, p.y - s * 2); ctx.lineTo(p.x + s * 0.5, p.y); ctx.lineTo(p.x, p.y + s * 2); ctx.lineTo(p.x - s * 0.5, p.y); ctx.closePath(); ctx.moveTo(p.x - s * 2, p.y); ctx.lineTo(p.x, p.y + s * 0.5); ctx.lineTo(p.x + s * 2, p.y); ctx.lineTo(p.x, p.y - s * 0.5); ctx.fill(); break; }
          case 'confetti': ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); break;
          case 'text': ctx.fillStyle = p.color; ctx.font = p.size + 'px ' + MONO; ctx.textAlign = 'center'; ctx.fillText(p.text, p.x, p.y); break;
          case 'ghost': {
            ctx.globalAlpha = f * 0.4;
            if (p.glyph && this.emojiOK) { const s = p.size * 2.7; ctx.save(); ctx.translate(p.x, p.y); if (p.face > 0) ctx.scale(-1, 1); ctx.drawImage(this.sprite(p.glyph, p.size * 2 * this.S * this.k), -s / 2, -s / 2, s, s); ctx.restore(); }
            else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill(); }
            break;
          }
          case 'dot': default: ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.size * (0.4 + f * 0.6)), 0, 7); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      void dt;
    }

    drawFloaters(ctx, t) {
      const dpr = this.g.view.dpr, s = dpr / this.S;
      for (const f of this.g.floaters) {
        const k = f.t / f.max;
        if (f.kind === 'bubble') {
          const e = f.ent; const x = e ? e.x : f.x, y = (e ? e.y - e.r : f.y) - 14 * s;
          ctx.save();
          ctx.globalAlpha = Math.min(1, k * 4, (1 - k) * 12 + 0.2);
          ctx.font = (12 * s) + 'px ' + MONO;
          const lines = wrap(ctx, f.text, 190 * s);
          const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16 * s, h = lines.length * 16 * s + 10 * s;
          ctx.fillStyle = 'rgba(250,246,238,0.96)'; roundRect(ctx, x - w / 2, y - h, w, h, 8 * s); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x - 6 * s, y - 1); ctx.lineTo(x, y + 7 * s); ctx.lineTo(x + 6 * s, y - 1); ctx.fill();
          ctx.fillStyle = '#2a2420'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          lines.forEach((l, i) => ctx.fillText(l, x, y - h + 6 * s + i * 16 * s));
          ctx.restore();
          continue;
        }
        const rise = (1 - k) * 34 * s;
        ctx.globalAlpha = Math.min(1, k * 2.5);
        const fs = (f.kind === 'z' ? 12 : f.kind === 'dmg' ? 12 : 15) * s;
        ctx.font = '600 ' + fs + 'px ' + MONO;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeText(f.text, f.x, f.y - rise);
        ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - rise);
      }
      ctx.globalAlpha = 1;
      void t;
    }

    // ---------------------------------------------------------------- weather & light
    drawWeather(ctx, fx, W, H, dt, t, pal) {
      const g = this.g, dpr = g.view.dpr;
      const kinds = ['rain', 'storm', 'snow', 'embers', 'leaves', 'dust', 'bubbles', 'fireflies', 'sparkles', 'fog', 'stars'].filter((k) => fx.has(k));
      const camDx = this.lastCam ? (g.cam.x - this.lastCam.x) * g.view.scale : 0, camDy = this.lastCam ? (g.cam.y - this.lastCam.y) * g.view.scale : 0;
      this.lastCam = { x: g.cam.x, y: g.cam.y };
      for (const kind of kinds) {
        let arr = this.weather[kind];
        const N = { rain: 170, storm: 260, snow: 150, embers: 70, leaves: 30, dust: 60, bubbles: 40, fireflies: 34, sparkles: 50, fog: 7, stars: 60 }[kind];
        if (!arr || arr.W !== W || arr.H !== H) {
          arr = this.weather[kind] = [];
          arr.W = W; arr.H = H;
          for (let i = 0; i < N; i++) arr.push({ x: U.random() * W, y: U.random() * H, s: U.random(), p: U.random() * 6.28 });
        }
        for (const q of arr) {
          const par = 0.3 + q.s * 0.7;
          q.x -= camDx * par; q.y -= camDy * par;
          switch (kind) {
            case 'rain': case 'storm': q.x += (-120 - 60 * q.s) * dt * dpr; q.y += (900 + 500 * q.s) * dt * dpr; break;
            case 'snow': q.x += Math.sin(t + q.p) * 20 * dt * dpr; q.y += (30 + 50 * q.s) * dt * dpr; break;
            case 'embers': q.x += Math.sin(t * 2 + q.p) * 25 * dt * dpr; q.y -= (40 + 60 * q.s) * dt * dpr; break;
            case 'leaves': q.x += (40 + Math.sin(t + q.p) * 40) * dt * dpr; q.y += (40 + 30 * q.s) * dt * dpr; q.p += dt * 2; break;
            case 'dust': q.x += (260 + 200 * q.s) * dt * dpr; q.y += Math.sin(t * 3 + q.p) * 10 * dt * dpr; break;
            case 'bubbles': q.x += Math.sin(t * 2 + q.p) * 18 * dt * dpr; q.y -= (40 + 50 * q.s) * dt * dpr; break;
            case 'fireflies': q.x += Math.cos(t * 0.7 + q.p * 3) * 22 * dt * dpr; q.y += Math.sin(t * 0.9 + q.p * 2) * 22 * dt * dpr; break;
            case 'fog': q.x += (12 + 10 * q.s) * dt * dpr; break;
            default: break;
          }
          if (q.x < -60) q.x += W + 120; if (q.x > W + 60) q.x -= W + 120;
          if (q.y < -60) q.y += H + 120; if (q.y > H + 60) q.y -= H + 120;
          switch (kind) {
            case 'rain': case 'storm':
              ctx.strokeStyle = 'rgba(180,210,240,' + (0.25 + q.s * 0.3) + ')'; ctx.lineWidth = dpr * (0.8 + q.s);
              ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + 2.5 * dpr, q.y - (12 + 10 * q.s) * dpr); ctx.stroke(); break;
            case 'snow': ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + q.s * 0.5) + ')'; ctx.beginPath(); ctx.arc(q.x, q.y, (1 + q.s * 2.4) * dpr, 0, 7); ctx.fill(); break;
            case 'embers': ctx.fillStyle = 'rgba(255,' + Math.round(120 + q.s * 80) + ',60,' + (0.4 + 0.4 * Math.sin(t * 5 + q.p)) + ')'; ctx.fillRect(q.x, q.y, 2 * dpr, 2 * dpr); break;
            case 'leaves': ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.p); ctx.fillStyle = q.s > 0.5 ? 'rgba(220,140,60,0.8)' : 'rgba(170,190,80,0.8)'; ctx.beginPath(); ctx.ellipse(0, 0, 5 * dpr, 2.4 * dpr, 0, 0, 7); ctx.fill(); ctx.restore(); break;
            case 'dust': ctx.strokeStyle = 'rgba(230,200,150,' + (0.12 + q.s * 0.15) + ')'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - 30 * dpr, q.y); ctx.stroke(); break;
            case 'bubbles': ctx.strokeStyle = 'rgba(200,240,255,0.35)'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(q.x, q.y, (2 + q.s * 4) * dpr, 0, 7); ctx.stroke(); break;
            case 'fireflies': { const a = 0.4 + 0.6 * Math.max(0, Math.sin(t * 2 + q.p * 5)); ctx.fillStyle = 'rgba(220,255,140,' + a + ')'; ctx.beginPath(); ctx.arc(q.x, q.y, 2 * dpr, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(220,255,140,' + a * 0.15 + ')'; ctx.beginPath(); ctx.arc(q.x, q.y, 9 * dpr, 0, 7); ctx.fill(); break; }
            case 'sparkles': case 'stars': { const a = Math.max(0, Math.sin(t * 2.5 + q.p * 4)); ctx.fillStyle = 'rgba(255,250,220,' + a * 0.7 + ')'; const s = (1 + q.s * 2) * dpr * a; ctx.fillRect(q.x - s, q.y - 0.5 * dpr, s * 2, dpr); ctx.fillRect(q.x - 0.5 * dpr, q.y - s, dpr, s * 2); break; }
            case 'fog': { const r = (180 + q.s * 220) * dpr; const gr = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r); gr.addColorStop(0, U.rgba(U.mix(pal.text, pal.bg, 0.5), 0.16)); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(q.x - r, q.y - r, r * 2, r * 2); break; }
            default: break;
          }
        }
        if (kind === 'storm') {
          this.boltT = (this.boltT || 4) - dt;
          if (this.boltT <= 0) { this.boltT = 3 + U.random() * 6; this.bolt = 0.25; if (g.mode === 'play' && VC.Sound) VC.Sound.sfx('thunder'); }
          if (this.bolt > 0) { this.bolt -= dt; ctx.fillStyle = 'rgba(230,240,255,' + this.bolt * 1.6 + ')'; ctx.fillRect(0, 0, W, H); }
        }
      }
    }

    drawLighting(ctx, fx, W, H, t, pal) {
      const g = this.g;
      let amt = 0;
      if (fx.has('darkness')) amt = 0.86;
      else if (fx.has('night')) amt = 0.6;
      if (fx.has('daynight')) amt = Math.max(amt, (Math.sin(g.time / 20) * 0.5 + 0.5) * 0.75);
      if (amt <= 0) return;
      if (!this.dark) { this.dark = document.createElement('canvas'); this.dctx = this.dark.getContext('2d'); }
      const dw = Math.ceil(W / 2), dh = Math.ceil(H / 2);
      if (this.dark.width !== dw || this.dark.height !== dh) { this.dark.width = dw; this.dark.height = dh; }
      const d = this.dctx;
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, dw, dh);
      d.fillStyle = 'rgba(4,4,12,' + amt + ')';
      d.fillRect(0, 0, dw, dh);
      d.globalCompositeOperation = 'destination-out';
      const S = g.view.scale / 2;
      const toS = (x, y) => [(x - g.cam.x + g.cam.ox) * S + dw / 2, (y - g.cam.y + g.cam.oy) * S + dh / 2];
      const light = (x, y, r, a) => {
        const [sx, sy] = toS(x, y);
        if (sx < -r * S || sy < -r * S || sx > dw + r * S || sy > dh + r * S) return;
        const gr = d.createRadialGradient(sx, sy, 0, sx, sy, r * S);
        gr.addColorStop(0, 'rgba(0,0,0,' + a + ')'); gr.addColorStop(0.6, 'rgba(0,0,0,' + a * 0.6 + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        d.fillStyle = gr; d.beginPath(); d.arc(sx, sy, r * S, 0, 7); d.fill();
      };
      if (g.player) light(g.player.x, g.player.y, 240 + Math.sin(t * 7) * 4, 1);
      let n = 0;
      for (const e of g.entities) {
        if (n > 80) break;
        const f = e.def.effects || [];
        if (e.def.projectile && (f.includes('glow') || e.def.glyph === '🔥')) { light(e.x, e.y, 50, 0.7); n++; }
        else if (f.includes('glow') || e.def.light || e.def.boss) { light(e.x, e.y, e.r * 3 + 40, 0.75); n++; }
      }
      for (const p of g.particles) { if (n > 140) break; if (p.kind === 'ring' && p.color === '#ffb86b') { light(p.x, p.y, p.size * 1.5, 0.9); n++; } }
      ctx.drawImage(this.dark, 0, 0, W, H);
      void pal;
    }

    vignette(ctx, W, H, a) {
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,' + a + ')');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }

    // ---------------------------------------------------------------- HUD
    drawHud(ctx, W, H, t, pal) {
      const g = this.g, s = g.spec, P = g.player;
      const txt = '#f7f1e8';
      ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
      const pad = 16;
      let y = pad + 10;
      if (s.hud.score !== false && (g.score || Object.keys(s.types).length)) {
        ctx.textAlign = 'left';
        ctx.font = '500 10px ' + MONO; ctx.fillStyle = U.rgba(txt, 0.6);
        ctx.fillText('SCORE', pad, y);
        ctx.font = '600 22px ' + MONO; ctx.fillStyle = txt;
        ctx.fillText(String(g.score).padStart(4, '0'), pad, y + 23);
        y += 36;
      }
      if (P && s.hud.health !== false) {
        const n = P.maxHp;
        if (n <= 12) {
          for (let i = 0; i < n; i++) heart(ctx, pad + 8 + i * 19, y + 6, 7, i < P.hp ? '#ff5d6c' : 'rgba(255,255,255,0.18)');
        } else {
          ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(pad, y, 140, 8);
          ctx.fillStyle = '#ff5d6c'; ctx.fillRect(pad, y, 140 * U.clamp(P.hp / n, 0, 1), 8);
          ctx.font = '500 10px ' + MONO; ctx.fillStyle = txt; ctx.fillText(P.hp + '/' + n, pad + 148, y + 8);
        }
        if (P.lives > 1) { ctx.font = '500 11px ' + MONO; ctx.fillStyle = U.rgba(txt, 0.8); ctx.fillText('×' + P.lives, pad + Math.min(n, 12) * 19 + 8, y + 10); }
        y += 22;
      }
      // powers
      if (P) {
        let px = pad;
        for (const [k, v] of Object.entries(P.powers || {})) {
          ctx.font = '600 10px ' + MONO; const label = k.toUpperCase() + ' ' + Math.ceil(v) + 's';
          const w = ctx.measureText(label).width + 14;
          ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,209,102,0.18)'; roundRect(ctx, px, y, w, 18, 9); ctx.fill();
          ctx.fillStyle = '#ffd166'; ctx.fillText(label, px + 7, y + 13); px += w + 6; ctx.shadowBlur = 6;
        }
      }
      // timer
      if (s.hud.timer) {
        ctx.textAlign = 'center';
        ctx.font = '600 20px ' + MONO;
        ctx.fillStyle = g.timeLeft < 10 && Math.floor(t * 4) % 2 ? '#ff5d6c' : txt;
        ctx.fillText(U.fmtClock(g.timeLeft), W / 2, pad + 22);
      }
      // right side: level and goals
      ctx.textAlign = 'right';
      let ry = pad + 10;
      if (g.level > 1 || (g.rules || []).some((R) => R.r.then.some((a) => a.type === 'nextLevel'))) {
        ctx.font = '500 10px ' + MONO; ctx.fillStyle = U.rgba(txt, 0.6); ctx.fillText('LEVEL', W - pad, ry);
        ctx.font = '600 18px ' + MONO; ctx.fillStyle = txt; ctx.fillText(String(g.level), W - pad, ry + 20); ry += 34;
      }
      for (const R of g.rules || []) {
        const w = R.r.when;
        if (w.type !== 'onCollected' && w.type !== 'onKilled') continue;
        const have = w.type === 'onCollected' ? g.stats.collected[w.of] || 0 : g.stats.killed[w.of] || 0;
        const def = s.types[w.of];
        ctx.font = '500 13px ' + MONO; ctx.fillStyle = have >= (w.count || 1) ? '#7ee08a' : txt;
        const label = (def && def.glyph && this.emojiOK ? def.glyph + ' ' : U.human(w.of) + ' ') + Math.min(have, w.count || 1) + '/' + (w.count || 1);
        ctx.fillText(label, W - pad, ry + 4); ry += 20;
      }
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      // boss bar
      const boss = g.entities.find((e) => !e.dead && (e.def.boss || e.def.role === 'boss') && e.hp > 0 && e.maxHp < 999);
      if (boss) {
        const bw = Math.min(420, W * 0.5), bx = W / 2 - bw / 2, by = s.hud.timer ? 52 : 26;
        ctx.textAlign = 'center'; ctx.font = '600 10px ' + MONO; ctx.fillStyle = U.rgba(txt, 0.8);
        ctx.fillText(U.human(boss.type).toUpperCase(), W / 2, by);
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, bx, by + 6, bw, 8, 4); ctx.fill();
        ctx.fillStyle = '#ff5d6c'; roundRect(ctx, bx, by + 6, bw * U.clamp(boss.hp / boss.maxHp, 0, 1), 8, 4); ctx.fill();
      }
      // controls hint
      if (g.mode === 'play' && g.hintT > 0 && P && g.state === 'running') {
        const ctl = VC.DSL.controls(s).filter((c) => c[0] !== 'R').map((c) => c[0] + ' ' + c[1]).join('   ·   ');
        ctx.globalAlpha = Math.min(1, g.hintT / 1.2);
        ctx.font = '500 11px ' + MONO; ctx.textAlign = 'center';
        const w = Math.min(W - 40, ctx.measureText(ctl).width + 28);
        ctx.fillStyle = 'rgba(10,8,7,0.6)'; roundRect(ctx, W / 2 - w / 2, H - 82, w, 26, 13); ctx.fill();
        ctx.fillStyle = U.rgba(txt, 0.85); ctx.fillText(ctl, W / 2, H - 65);
        ctx.globalAlpha = 1;
      }
      // banners
      g.messages.forEach((m, i) => {
        const k = m.t / m.max, intro = Math.min(1, (1 - k) * 8);
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.textAlign = 'center';
        const fs = Math.min(44, W / 14);
        ctx.font = '700 ' + fs + 'px ' + MONO;
        ctx.save(); ctx.translate(W / 2, H * 0.38 + i * (fs + 14)); ctx.scale(0.8 + intro * 0.2, 0.8 + intro * 0.2);
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.strokeText(m.text, 0, 0);
        ctx.fillStyle = '#fff7e8'; ctx.fillText(m.text, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      });
      // title card
      if (g.titleT > 0 && s.meta.title) {
        const k = g.titleT / 3.2, a = Math.min(1, (1 - k) * 5, k * 3);
        ctx.globalAlpha = a * 0.6; ctx.fillStyle = 'rgba(10,8,7,1)'; ctx.fillRect(0, H * 0.32, W, H * 0.26); ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        ctx.font = 'italic ' + Math.min(64, W / 10) + 'px ' + SERIF; ctx.fillStyle = '#fff7e8';
        ctx.fillText(s.meta.title, W / 2, H * 0.46 + (1 - Math.min(1, (1 - k) * 4)) * 10);
        if (s.meta.tagline) { ctx.font = '500 12px ' + MONO; ctx.fillStyle = U.rgba('#fff7e8', 0.7); ctx.fillText(s.meta.tagline, W / 2, H * 0.46 + 30); }
        ctx.globalAlpha = 1;
      }
      // end screens
      if (g.state === 'won' || g.state === 'lost') {
        const a = Math.min(1, (g.endT || 0) * 2.5);
        ctx.globalAlpha = a * 0.62; ctx.fillStyle = '#0c0a09'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        ctx.font = 'italic ' + Math.min(72, W / 9) + 'px ' + SERIF;
        ctx.fillStyle = g.state === 'won' ? '#ffe7a8' : '#ff8c8c';
        ctx.fillText(g.endText || (g.state === 'won' ? 'You win' : 'Game over'), W / 2, H * 0.44);
        ctx.font = '500 13px ' + MONO; ctx.fillStyle = U.rgba('#fff7e8', 0.8);
        ctx.fillText('score ' + g.score + '   ·   ' + U.fmtClock(g.time), W / 2, H * 0.44 + 34);
        if (g.mode === 'play') { ctx.fillStyle = U.rgba('#fff7e8', 0.55 + 0.25 * Math.sin(t * 3)); ctx.fillText('press R to play again', W / 2, H * 0.44 + 62); }
        ctx.globalAlpha = 1;
      }
      // touch controls
      const tc = g.input.touch;
      if (tc && tc.active !== undefined && g.mode === 'play') {
        ctx.globalAlpha = 0.35;
        if (tc.active) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tc.ox, tc.oy, 46, 0, 7); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tc.ox + tc.jx * 36, tc.oy + tc.jy * 36, 18, 0, 7); ctx.fill(); }
        const bx = W - 70, by = H - 80;
        ctx.fillStyle = tc.a ? '#ffd166' : '#fff'; ctx.beginPath(); ctx.arc(bx, by, 28, 0, 7); ctx.fill();
        ctx.fillStyle = tc.b ? '#ff8c8c' : '#fff'; ctx.beginPath(); ctx.arc(bx - 70, by + 20, 24, 0, 7); ctx.fill();
        ctx.globalAlpha = 0.8; ctx.fillStyle = '#111'; ctx.font = '600 13px ' + MONO; ctx.textAlign = 'center'; ctx.fillText('A', bx, by + 5); ctx.fillText('B', bx - 70, by + 25);
        ctx.globalAlpha = 1;
      }
      void pal;
    }
  }

  // rotation that makes a glyph point along +x (null: not a vehicle)
  function glyphHeading(g) {
    if (/🚀|✈️/.test(g)) return Math.PI / 4;
    if (/🏎️|🚗|🚕|🚓|🚙|🚌|🚚|🚜|🚁|🚲|🛹|🚂|🦈|🐟|🐋|🐬/.test(g)) return Math.PI;
    if (/🛸|⛵|🚢/.test(g)) return 0;
    return null;
  }
  function layer(e) { if (e.isPlayer) return 5; if (e.def.projectile) return 6; if (e.def.static) return 0; if (e.def.role === 'collectible') return 1; return 3; }
  function easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function heart(ctx, x, y, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.8, y - s * 1.2, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.8, y - s * 1.2, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
    ctx.fill();
  }
  function wrap(ctx, text, max) {
    const words = String(text).split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines.slice(0, 4);
  }

  VC.Render = {
    init(game) { game.render = new Renderer(game); },
    roundRect,
  };
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
