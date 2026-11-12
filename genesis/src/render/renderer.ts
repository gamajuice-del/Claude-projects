// Frame renderer. Reads simulation state, never writes it. Everything animated here (waves, walkers,
// particles, clouds) is cosmetic and computed only for what is on screen.
import { hash2 } from '../sim/rng';
import { B, I_URBAN, J, PARTY, Person, Settlement, Sim, TICKS_PER_YEAR, W_LAND } from '../sim/types';
import { meanTemp, tempAt } from '../sim/world';
import { BIOME_COLORS, CIV_COLORS, JOB_COLORS, civCss } from './palette';
import { CHUNK, CPX, TILE, TerrainLayer } from './terrain';
import * as SP from './sprites';

export type MapMode = 'normal' | 'political' | 'temperature' | 'rainfall' | 'fertility' | 'resources' | 'culture' | 'religion' | 'biome';
export interface Pick {
  kind: 'tile' | 'settlement' | 'person' | 'army' | 'party' | 'herd' | 'civ' | 'species' | 'grave';
  id: number;
  tile: number;
}
interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; g: number; b: number; size: number; grav: number;
}
interface Fx {
  kind: string; x: number; y: number; r: number; age: number; dur: number;
}

const ORE_RGB: [number, number, number][] = [[0, 0, 0], [190, 190, 196], [226, 138, 78], [170, 106, 90], [70, 70, 80], [250, 214, 80], [244, 244, 244], [120, 60, 160]];

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  sim!: Sim;
  terrain!: TerrainLayer;
  cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1 };
  mode: MapMode = 'normal';
  time = 0; // animation clock in seconds (advances with wall time; faster when the sim runs)
  selection: Pick | null = null;
  brush: { x: number; y: number; r: number; color: string } | null = null;
  showLabels = true;
  showBorders = true;
  shake = 0;
  walkers: { id: number; x: number; y: number }[] = [];
  private dpr = 1;
  private cw = 0;
  private ch = 0;
  private waves: HTMLCanvasElement[] = [];
  private borderCanvases: HTMLCanvasElement[] = [];
  private borderCtx: CanvasRenderingContext2D[] = [];
  private tileCiv: Int16Array = new Int16Array(0);
  private tileSet: Int16Array = new Int16Array(0);
  private borderTimer = 0;
  private overlay: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private overlayTimer = 0;
  private overlayMode: MapMode = 'normal';
  private particles: Particle[] = [];
  private fx: Fx[] = [];
  private frameNo = 0;
  private personSprites: HTMLCanvasElement[] = [];
  private childSprites: HTMLCanvasElement[] = [];
  private cache = new Map<string, HTMLCanvasElement>();
  minimap: HTMLCanvasElement | null = null;
  private miniTimer = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.overlay = document.createElement('canvas');
    this.overlayCtx = this.overlay.getContext('2d')!;
    this.makeWaves();
    this.makePeople();
  }

  setSim(sim: Sim): void {
    this.sim = sim;
    this.terrain = new TerrainLayer(sim);
    const w = sim.world;
    this.overlay.width = w.w;
    this.overlay.height = w.h;
    this.tileCiv = new Int16Array(w.n).fill(-2);
    this.tileSet = new Int16Array(w.n).fill(-2);
    this.borderCanvases = [];
    this.borderCtx = [];
    for (let k = 0; k < this.terrain.cols * this.terrain.rows; k++) {
      const c = document.createElement('canvas');
      c.width = CPX;
      c.height = CPX;
      this.borderCanvases.push(c);
      this.borderCtx.push(c.getContext('2d')!);
    }
    this.particles = [];
    this.fx = [];
    this.selection = null;
    sim.rt.allDirty = true;
    sim.rt.borderDirty = true;
    this.borderTimer = 0;
    this.overlayTimer = 0;
    this.miniTimer = 0;
    this.fit();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = Math.max(1, Math.round(r.width * this.dpr));
    this.ch = Math.max(1, Math.round(r.height * this.dpr));
    if (this.canvas.width !== this.cw || this.canvas.height !== this.ch) {
      this.canvas.width = this.cw;
      this.canvas.height = this.ch;
    }
  }

  minZoom(): number {
    const w = this.sim.world;
    return Math.min(this.cw / (w.w * TILE), this.ch / (w.h * TILE)) * 0.9;
  }

  fit(): void {
    this.resize();
    const w = this.sim.world;
    const z = Math.max(this.minZoom(), Math.min(this.cw / (w.w * TILE), this.ch / (w.h * TILE)) * 1.02);
    this.cam.x = this.cam.tx = (w.w * TILE) / 2;
    this.cam.y = this.cam.ty = (w.h * TILE) / 2;
    this.cam.zoom = this.cam.tz = z;
  }

  centerOn(tx: number, ty: number, zoom?: number): void {
    this.cam.tx = (tx + 0.5) * TILE;
    this.cam.ty = (ty + 0.5) * TILE;
    if (zoom) this.cam.tz = zoom * this.dpr;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const c = this.cam;
    const px = sx * this.dpr,
      py = sy * this.dpr;
    const wx = c.tx + (px - this.cw / 2) / c.tz,
      wy = c.ty + (py - this.ch / 2) / c.tz;
    const nz = Math.max(this.minZoom(), Math.min(7 * this.dpr, c.tz * factor));
    c.tx = wx - (px - this.cw / 2) / nz;
    c.ty = wy - (py - this.ch / 2) / nz;
    c.tz = nz;
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.cam.tx -= (dxScreen * this.dpr) / this.cam.zoom;
    this.cam.ty -= (dyScreen * this.dpr) / this.cam.zoom;
    this.cam.x = this.cam.tx;
    this.cam.y = this.cam.ty;
  }

  /** screen (CSS px) → world tile coordinates (float) */
  screenToTile(sx: number, sy: number): { x: number; y: number } {
    const c = this.cam;
    return { x: (c.x + (sx * this.dpr - this.cw / 2) / c.zoom) / TILE, y: (c.y + (sy * this.dpr - this.ch / 2) / c.zoom) / TILE };
  }

  tileToScreen(tx: number, ty: number): { x: number; y: number } {
    const c = this.cam;
    return { x: ((tx * TILE - c.x) * c.zoom + this.cw / 2) / this.dpr, y: ((ty * TILE - c.y) * c.zoom + this.ch / 2) / this.dpr };
  }

  pick(sx: number, sy: number): Pick {
    const sim = this.sim;
    const w = sim.world;
    const t = this.screenToTile(sx, sy);
    const wx = t.x * TILE,
      wy = t.y * TILE;
    const tol = 9 / (this.cam.zoom / this.dpr); // ~9 CSS px in world px
    const tx = Math.floor(t.x),
      ty = Math.floor(t.y);
    const inMap = tx >= 0 && ty >= 0 && tx < w.w && ty < w.h;
    const tile = inMap ? ty * w.w + tx : -1;
    let best: Pick | null = null,
      bd = tol * tol;
    for (const wk of this.walkers) {
      const d = (wk.x - wx) * (wk.x - wx) + (wk.y - wy) * (wk.y - wy);
      if (d < bd) { bd = d; best = { kind: 'person', id: wk.id, tile }; }
    }
    if (best) return best;
    bd = Math.max(tol * tol, 10 * 10);
    for (const a of sim.armies.values()) {
      const d = ((a.x + 0.5) * TILE - wx) ** 2 + ((a.y + 0.5) * TILE - wy) ** 2;
      if (d < bd) { bd = d; best = { kind: 'army', id: a.id, tile }; }
    }
    if (best) return best;
    bd = Math.max(tol * tol, 7 * 7);
    for (const p of sim.parties.values()) {
      const d = ((p.x + 0.5) * TILE - wx) ** 2 + ((p.y + 0.5) * TILE - wy) ** 2;
      if (d < bd) { bd = d; best = { kind: 'party', id: p.id, tile }; }
    }
    if (best) return best;
    if (inMap && w.imp[tile] === I_URBAN && w.owner[tile] >= 0) return { kind: 'settlement', id: w.owner[tile], tile };
    bd = Math.max(tol * tol, 8 * 8);
    for (const h of sim.herds.values()) {
      const d = ((h.x + 0.5) * TILE - wx) ** 2 + ((h.y + 0.5) * TILE - wy) ** 2;
      if (d < bd) { bd = d; best = { kind: 'herd', id: h.id, tile }; }
    }
    if (best) return best;
    // a click near a small settlement's centre still selects it
    for (const s of sim.settlements.values()) {
      const d = ((s.x + 0.5) * TILE - wx) ** 2 + ((s.y + 0.5) * TILE - wy) ** 2;
      if (d < Math.max(tol * tol, 36)) return { kind: 'settlement', id: s.id, tile };
    }
    return { kind: 'tile', id: tile, tile };
  }

  private makeWaves(): void {
    for (let k = 0; k < 2; k++) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, 64, 64);
      for (let i = 0; i < 26; i++) {
        const x = Math.floor(hash2(i, k * 7 + 1, 91) * 64),
          y = Math.floor(hash2(i, k * 7 + 2, 92) * 64),
          len = 3 + Math.floor(hash2(i, k, 93) * 5);
        g.fillStyle = k === 0 ? 'rgba(150,210,236,0.5)' : 'rgba(96,170,216,0.45)';
        g.fillRect(x, y, len, 1);
        g.fillRect(x + 1, y + 1, Math.max(1, len - 2), 1);
        g.fillRect(x - 64, y, len, 1);
        g.fillRect(x - 63, y + 1, Math.max(1, len - 2), 1);
      }
      this.waves.push(c);
    }
  }

  /** cached sprite canvases, keyed by drawing + colours */
  private spr(s: SP.Sprite, key: string, colors: Record<string, string>, flip = false): HTMLCanvasElement {
    const k = key + (flip ? '<' : '>');
    let c = this.cache.get(k);
    if (!c) {
      if (!colors.o) colors.o = '#28243a';
      c = SP.spriteCanvas(s, colors, flip);
      this.cache.set(k, c);
    }
    return c;
  }

  private makePeople(): void {
    // one little figure per occupation, two walking frames each
    for (let j = 0; j < JOB_COLORS.length; j++) {
      const col = JOB_COLORS[j];
      const colors = { h: j === J.soldier ? '#c8ccd6' : j === J.priest ? '#f2d36a' : j === J.scholar ? '#e8e4f0' : '#4a3426', s: '#f0c8a0', b: `rgb(${col[0]},${col[1]},${col[2]})`, l: '#3a2f2a', o: '#28243a' };
      this.personSprites.push(SP.spriteCanvas(SP.PERSON_A, colors), SP.spriteCanvas(SP.PERSON_B, colors));
    }
    const kid = { s: '#f0c8a0', b: '#f0e0c0', l: '#3a2f2a', o: '#28243a' };
    this.childSprites.push(SP.spriteCanvas(SP.CHILD_A, kid), SP.spriteCanvas(SP.CHILD_B, kid));
  }

  addFx(kind: string, x: number, y: number, r: number): void {
    if (this.fx.length > 70) return;
    const dur = kind === 'bolt' ? 0.35 : kind === 'meteor' ? 2.2 : kind === 'erupt' ? 4 : kind === 'quake' ? 1.2 : kind === 'clash' ? 0.5 : 1.6;
    if (kind === 'clash' && this.fx.length > 24) return;
    this.fx.push({ kind, x, y, r, age: 0, dur });
    if (kind === 'meteor') this.shake = 1;
    if (kind === 'quake' || kind === 'erupt') this.shake = Math.max(this.shake, 0.7);
  }

  private spawn(x: number, y: number, vx: number, vy: number, life: number, r: number, g: number, b: number, size: number, grav = 0): void {
    if (this.particles.length > 1400) return;
    this.particles.push({ x, y, vx, vy, life, max: life, r, g, b, size, grav });
  }

  private visibleRect(): { x0: number; y0: number; x1: number; y1: number } {
    const c = this.cam;
    const hw = this.cw / 2 / c.zoom,
      hh = this.ch / 2 / c.zoom;
    return { x0: (c.x - hw) / TILE, y0: (c.y - hh) / TILE, x1: (c.x + hw) / TILE, y1: (c.y + hh) / TILE };
  }

  // ------------------------------------------------------------------ frame

  /** dt: seconds since last frame. simRate: simulation ticks per second right now (0 when paused). */
  frame(dt: number, simRate: number): void {
    const sim = this.sim;
    if (!sim) return;
    const ctx = this.ctx;
    const w = sim.world;
    this.frameNo++;
    this.time += dt * (simRate <= 0 ? 0.25 : 0.6 + Math.min(1.6, simRate / 12));
    // camera easing
    const c = this.cam;
    const k = Math.min(1, dt * 12);
    c.x += (c.tx - c.x) * k;
    c.y += (c.ty - c.y) * k;
    c.zoom += (c.tz - c.zoom) * k;
    const ww = w.w * TILE,
      wh = w.h * TILE;
    c.tx = Math.max(0, Math.min(ww, c.tx));
    c.ty = Math.max(0, Math.min(wh, c.ty));
    // consume simulation notifications
    const rt = sim.rt;
    if (rt.allDirty) {
      this.terrain.markAll();
      rt.allDirty = false;
      rt.dirty.length = 0;
    } else if (rt.dirty.length) {
      for (const i of rt.dirty) this.terrain.markTile(i);
      rt.dirty.length = 0;
    }
    for (const f of rt.fx) this.addFx(f.kind, f.x, f.y, f.r);
    rt.fx.length = 0;
    const vr = this.visibleRect();
    const cols = this.terrain.cols;
    const cx0 = Math.max(0, Math.floor(vr.x0 / CHUNK)),
      cx1 = Math.min(cols - 1, Math.floor(vr.x1 / CHUNK));
    const cy0 = Math.max(0, Math.floor(vr.y0 / CHUNK)),
      cy1 = Math.min(this.terrain.rows - 1, Math.floor(vr.y1 / CHUNK));
    this.terrain.refresh(6, (ci) => {
      const x = ci % cols,
        y = (ci / cols) | 0;
      return x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1;
    }, simRate > 30, simRate <= 0);
    this.borderTimer -= dt;
    if (rt.borderDirty && this.borderTimer <= 0) {
      this.updateBorders();
      rt.borderDirty = false;
      this.borderTimer = 0.35;
    }
    // ---------- sea ----------
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1a4486'; // the open ocean, so the edge of the charted world is seamless
    ctx.fillRect(0, 0, this.cw, this.ch);
    let shx = 0, shy = 0;
    if (this.shake > 0.01) {
      shx = (Math.random() - 0.5) * this.shake * 14 * this.dpr;
      shy = (Math.random() - 0.5) * this.shake * 14 * this.dpr;
      this.shake *= Math.pow(0.02, dt);
    }
    const ox = this.cw / 2 - c.x * c.zoom + shx,
      oy = this.ch / 2 - c.y * c.zoom + shy;
    ctx.imageSmoothingEnabled = false;
    if (c.zoom > 0.5 * this.dpr) {
      for (let k2 = 0; k2 < 2; k2++) {
        const pat = ctx.createPattern(this.waves[k2], 'repeat')!;
        const dx = (this.time * (k2 ? -5 : 7)) % 64,
          dy = (this.time * (k2 ? 3 : 2)) % 64;
        ctx.setTransform(c.zoom, 0, 0, c.zoom, ox + dx * c.zoom, oy + dy * c.zoom);
        ctx.fillStyle = pat;
        ctx.globalAlpha = 0.5 + 0.2 * Math.sin(this.time * 0.7 + k2 * 2);
        ctx.fillRect(-64 - dx, -64 - dy, ww + 128, wh + 128);
      }
      ctx.globalAlpha = 1;
    }
    // ---------- land (cached chunks) ----------
    ctx.setTransform(c.zoom, 0, 0, c.zoom, ox, oy);
    ctx.imageSmoothingEnabled = c.zoom < 0.8 * this.dpr;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        ctx.drawImage(this.terrain.canvases[cy * cols + cx], cx * CPX, cy * CPX);
      }
    }
    // ---------- data overlays ----------
    if (this.mode !== 'normal') {
      this.overlayTimer -= dt;
      if (this.overlayTimer <= 0 || this.overlayMode !== this.mode) {
        this.updateOverlay();
        this.overlayTimer = 0.6;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = this.mode === 'political' ? 0.5 : 0.82;
      ctx.drawImage(this.overlay, 0, 0, w.w, w.h, 0, 0, ww, wh);
      ctx.globalAlpha = 1;
    }
    if (this.showBorders) {
      ctx.imageSmoothingEnabled = c.zoom < 0.8 * this.dpr;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) ctx.drawImage(this.borderCanvases[cy * cols + cx], cx * CPX, cy * CPX);
      }
    }
    ctx.imageSmoothingEnabled = false;
    const zCss = c.zoom / this.dpr; // CSS px per world px
    this.drawFires(vr, dt);
    this.drawRoutesAndSelection(vr, zCss);
    this.drawHerds(vr, zCss);
    this.drawSettlementLife(vr, zCss, dt);
    this.drawParties(vr, zCss);
    this.drawArmies(vr, zCss);
    this.drawParticles(dt);
    this.drawStorms(vr, dt);
    this.drawFx(dt);
    // brush
    if (this.brush) {
      const b = this.brush;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1.5 / zCss;
      ctx.setLineDash([4 / zCss, 3 / zCss]);
      ctx.beginPath();
      ctx.arc((b.x + 0.5) * TILE, (b.y + 0.5) * TILE, Math.max(0.5, b.r) * TILE, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // ---------- labels in screen space ----------
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.showLabels) this.drawLabels(vr, zCss);
    // minimap
    this.miniTimer -= dt;
    if (this.minimap && this.miniTimer <= 0) {
      this.drawMinimap();
      this.miniTimer = 1.2;
    }
  }

  // ------------------------------------------------------------------ borders

  private updateBorders(): void {
    const sim = this.sim;
    const w = sim.world;
    const n = w.n;
    const civOf = new Map<number, number>();
    for (const s of sim.settlements.values()) civOf.set(s.id, s.civ);
    const tc = this.tileCiv,
      ts = this.tileSet;
    const cols = this.terrain.cols;
    const changed = new Uint8Array(this.borderCanvases.length);
    for (let i = 0; i < n; i++) {
      const o = w.owner[i];
      const cv = o >= 0 ? civOf.get(o) ?? -1 : -1;
      if (cv !== tc[i] || o !== ts[i]) {
        tc[i] = cv;
        ts[i] = o;
        const x = i % w.w,
          y = (i / w.w) | 0;
        const cx = (x / CHUNK) | 0,
          cy = (y / CHUNK) | 0;
        changed[cy * cols + cx] = 1;
        const lx = x % CHUNK,
          ly = y % CHUNK;
        if (lx === 0 && cx > 0) changed[cy * cols + cx - 1] = 1;
        if (lx === CHUNK - 1 && cx < cols - 1) changed[cy * cols + cx + 1] = 1;
        if (ly === 0 && cy > 0) changed[(cy - 1) * cols + cx] = 1;
        if (ly === CHUNK - 1 && cy < this.terrain.rows - 1) changed[(cy + 1) * cols + cx] = 1;
      }
    }
    const colorOf = new Map<number, [number, number, number]>();
    for (const cv of sim.civs.values()) colorOf.set(cv.id, CIV_COLORS[cv.color % CIV_COLORS.length]);
    for (let ci = 0; ci < changed.length; ci++) {
      if (!changed[ci]) continue;
      const g = this.borderCtx[ci];
      g.clearRect(0, 0, CPX, CPX);
      const bx0 = (ci % cols) * CHUNK,
        by0 = ((ci / cols) | 0) * CHUNK;
      for (let ty = 0; ty < CHUNK; ty++) {
        const y = by0 + ty;
        if (y >= w.h) break;
        for (let tx = 0; tx < CHUNK; tx++) {
          const x = bx0 + tx;
          if (x >= w.w) break;
          const i = y * w.w + x;
          const cv = tc[i];
          if (cv < 0) continue;
          const col = colorOf.get(cv);
          if (!col) continue;
          const px = tx * TILE,
            py = ty * TILE;
          g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.1)`;
          g.fillRect(px, py, TILE, TILE);
          const edge = (j: number, inB: boolean, ex: number, ey: number, ew: number, eh: number, sx: number, sy: number, sw: number, sh: number) => {
            const oc = inB ? tc[j] : -1;
            if (inB && oc < 0 && w.water[j] !== W_LAND) return; // the shore is border enough
            if (oc !== cv) {
              g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.4)`;
              g.fillRect(px + sx, py + sy, sw, sh);
              g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
              g.fillRect(px + ex, py + ey, ew === 1 ? 2 : ew, eh === 1 ? 2 : eh);
            } else if (inB && ts[j] !== ts[i] && ((x + y) & 1) === 0) {
              g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.3)`;
              g.fillRect(px + ex, py + ey, ew, eh);
            }
          };
          edge(i - 1, x > 0, 0, 0, 1, TILE, 2, 0, 2, TILE);
          edge(i + 1, x < w.w - 1, TILE - 2, 0, 1, TILE, TILE - 4, 0, 2, TILE);
          edge(i - w.w, y > 0, 0, 0, TILE, 1, 0, 2, TILE, 2);
          edge(i + w.w, y < w.h - 1, 0, TILE - 2, TILE, 1, 0, TILE - 4, TILE, 2);
        }
      }
    }
  }

  // ------------------------------------------------------------------ overlays

  private updateOverlay(): void {
    const sim = this.sim;
    const w = sim.world;
    const img = this.overlayCtx.createImageData(w.w, w.h);
    const d = new Uint32Array(img.data.buffer);
    const mode = this.mode;
    this.overlayMode = mode;
    const pk = (r: number, g: number, b: number, a: number) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    const setOf = sim.settlements;
    const hueCol = (id: number): [number, number, number] => {
      const h = hash2(id, 3, 77) * 6,
        s2 = 0.55 + hash2(id, 5, 78) * 0.3,
        v = 0.75 + hash2(id, 9, 79) * 0.25;
      const f = (n: number) => {
        const kk = (n + h) % 6;
        return Math.round(255 * (v - v * s2 * Math.max(0, Math.min(kk, 4 - kk, 1))));
      };
      return [f(5), f(3), f(1)];
    };
    const civCol = new Map<number, [number, number, number]>();
    for (const cv of sim.civs.values()) civCol.set(cv.id, CIV_COLORS[cv.color % CIV_COLORS.length]);
    for (let i = 0; i < w.n; i++) {
      const land = w.water[i] === W_LAND;
      switch (mode) {
        case 'political': {
          const o = w.owner[i];
          const s = o >= 0 ? setOf.get(o) : undefined;
          const col = s ? civCol.get(s.civ) : undefined;
          d[i] = col ? pk(col[0], col[1], col[2], 235) : land ? pk(40, 44, 50, 120) : 0;
          break;
        }
        case 'temperature': {
          const t = tempAt(w, sim.climate, i, sim.tick);
          const u = Math.max(0, Math.min(1, (t + 20) / 55));
          const r = u < 0.5 ? 60 + u * 2 * 180 : 240,
            g = u < 0.5 ? 110 + u * 2 * 130 : 240 - (u - 0.5) * 2 * 190,
            b = u < 0.5 ? 230 - u * 2 * 60 : 170 - (u - 0.5) * 2 * 150;
          d[i] = pk(r | 0, g | 0, b | 0, land ? 255 : 150);
          break;
        }
        case 'rainfall': {
          if (!land) { d[i] = 0; break; }
          const m = w.moist[i];
          d[i] = pk((200 - m * 170) | 0, (170 - m * 40) | 0, (90 + m * 150) | 0, 255);
          break;
        }
        case 'fertility': {
          if (!land) { d[i] = 0; break; }
          const f = w.fert[i];
          d[i] = pk((190 - f * 150) | 0, (150 + f * 40) | 0, (110 - f * 70) | 0, 255);
          break;
        }
        case 'resources': {
          if (!land) { d[i] = 0; break; }
          const r = w.res[i];
          if (r && w.resAmt[i] > 0) d[i] = pk(ORE_RGB[r][0], ORE_RGB[r][1], ORE_RGB[r][2], 255);
          else d[i] = pk(24, 28, 34, 200);
          break;
        }
        case 'culture':
        case 'religion': {
          const o = w.owner[i];
          const s = o >= 0 ? setOf.get(o) : undefined;
          if (!s) { d[i] = land ? pk(40, 44, 50, 150) : 0; break; }
          const id = mode === 'culture' ? s.cultureMajor : s.religionMajor;
          if (id < 0) { d[i] = pk(90, 90, 90, 200); break; }
          const col = hueCol(id);
          d[i] = pk(col[0], col[1], col[2], 240);
          break;
        }
        case 'biome': {
          const col = BIOME_COLORS[w.biome[i]] || [0, 0, 0];
          d[i] = pk(col[0], col[1], col[2], 255);
          break;
        }
      }
    }
    this.overlayCtx.putImageData(img, 0, 0);
  }

  private drawMinimap(): void {
    const mm = this.minimap!;
    const sim = this.sim;
    const w = sim.world;
    if (mm.width !== w.w || mm.height !== w.h) {
      mm.width = w.w;
      mm.height = w.h;
    }
    const g = mm.getContext('2d')!;
    const img = g.createImageData(w.w, w.h);
    const d = new Uint32Array(img.data.buffer);
    const civCol = new Map<number, [number, number, number]>();
    for (const cv of sim.civs.values()) civCol.set(cv.id, CIV_COLORS[cv.color % CIV_COLORS.length]);
    for (let i = 0; i < w.n; i++) {
      let col = BIOME_COLORS[w.biome[i]] || [0, 0, 0];
      const o = w.owner[i];
      if (o >= 0) {
        const s = sim.settlements.get(o);
        const cc = s ? civCol.get(s.civ) : undefined;
        if (cc) col = w.imp[i] === I_URBAN ? [255, 255, 255] : [(col[0] + cc[0] * 2) / 3, (col[1] + cc[1] * 2) / 3, (col[2] + cc[2] * 2) / 3];
      }
      d[i] = ((255 << 24) | ((col[2] & 255) << 16) | ((col[1] & 255) << 8) | (col[0] & 255)) >>> 0;
    }
    g.putImageData(img, 0, 0);
    const vr = this.visibleRect();
    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(1, w.w / 160);
    g.strokeRect(vr.x0, vr.y0, vr.x1 - vr.x0, vr.y1 - vr.y0);
  }

  // ------------------------------------------------------------------ dynamic things

  private drawFires(vr: { x0: number; y0: number; x1: number; y1: number }, dt: number): void {
    const sim = this.sim;
    const w = sim.world;
    const ctx = this.ctx;
    const fires = sim.fires;
    const step = Math.max(1, Math.ceil(fires.length / 260));
    const fl = Math.floor(this.time * 9);
    for (let k = 0; k < fires.length; k += step) {
      const i = fires[k];
      const x = i % w.w,
        y = (i / w.w) | 0;
      if (x < vr.x0 - 1 || x > vr.x1 + 1 || y < vr.y0 - 1 || y > vr.y1 + 1) continue;
      const h = (hash2(i, fl, 5) * 4) | 0,
        h2 = (hash2(i, fl, 6) * 4) | 0;
      const bx = x * TILE,
        by = y * TILE;
      ctx.fillStyle = '#f04c22';
      ctx.fillRect(bx + 1 + h, by + 3, 3, 3);
      ctx.fillStyle = '#fa9a2c';
      ctx.fillRect(bx + 2 + h2, by + 2, 2, 3);
      ctx.fillStyle = '#ffe37a';
      ctx.fillRect(bx + 2 + h, by + 3 + (h2 & 1), 1, 1);
      if (Math.random() < dt * 3) this.spawn(bx + 4, by + 2, (Math.random() - 0.5) * 3 + 2, -5 - Math.random() * 4, 2.2, 70, 66, 64, 2 + Math.random() * 2);
    }
  }

  private drawRoutesAndSelection(vr: { x0: number; y0: number; x1: number; y1: number }, zCss: number): void {
    const sim = this.sim;
    const ctx = this.ctx;
    const sel = this.selection;
    if (!sel) return;
    const w = sim.world;
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 5);
    const ring = (x: number, y: number, r: number, col: string) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6 / zCss;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    let s: Settlement | undefined;
    if (sel.kind === 'settlement') s = sim.settlements.get(sel.id);
    else if (sel.kind === 'person') {
      const p = sim.people.get(sel.id);
      if (p) {
        const wk = this.walkers.find((q) => q.id === p.id);
        if (wk) ring(wk.x, wk.y, 6, '#ffe37a');
        else if (p.army >= 0) {
          const a = sim.armies.get(p.army);
          if (a) ring((a.x + 0.5) * TILE, (a.y + 0.5) * TILE, 10, '#ffe37a');
        } else {
          const hs = sim.settlements.get(p.home);
          if (hs) ring((hs.x + 0.5) * TILE, (hs.y + 0.5) * TILE, 10, '#ffe37a');
        }
      }
    } else if (sel.kind === 'army') {
      const a = sim.armies.get(sel.id);
      if (a) {
        ring((a.x + 0.5) * TILE, (a.y + 0.5) * TILE, 12, '#ffe37a');
        // show the planned march
        if (a.path.length > 1) {
          ctx.strokeStyle = 'rgba(255,227,122,0.7)';
          ctx.lineWidth = 1.2 / zCss;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          for (let k = a.pi; k < a.path.length; k += 2) {
            const i = a.path[k];
            const px = ((i % w.w) + 0.5) * TILE,
              py = (((i / w.w) | 0) + 0.5) * TILE;
            if (k === a.pi) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    } else if (sel.kind === 'party') {
      const p = sim.parties.get(sel.id);
      if (p) ring((p.x + 0.5) * TILE, (p.y + 0.5) * TILE, 9, '#ffe37a');
    } else if (sel.kind === 'herd') {
      const h = sim.herds.get(sel.id);
      if (h) ring((h.x + 0.5) * TILE, (h.y + 0.5) * TILE, 10, '#b8f08a');
    } else if (sel.kind === 'tile' && sel.tile >= 0) {
      const x = sel.tile % w.w,
        y = (sel.tile / w.w) | 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / zCss;
      ctx.globalAlpha = pulse;
      ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
      ctx.globalAlpha = 1;
    } else if (sel.kind === 'civ') {
      const cv = sim.civs.get(sel.id);
      if (cv) s = sim.settlements.get(cv.capital);
    }
    if (s) {
      ring((s.x + 0.5) * TILE, (s.y + 0.5) * TILE, (s.radius + 0.5) * TILE, 'rgba(255,255,255,0.8)');
      // its trade routes
      ctx.lineWidth = 1.4 / zCss;
      for (const rid of s.routes) {
        const r = sim.routes.get(rid);
        if (!r) continue;
        ctx.strokeStyle = r.sea ? 'rgba(140,220,255,0.75)' : 'rgba(255,214,120,0.75)';
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        for (let k = 0; k < r.path.length; k += 2) {
          const i = r.path[k];
          const px = ((i % w.w) + 0.5) * TILE,
            py = (((i / w.w) | 0) + 0.5) * TILE;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        const li = r.path[r.path.length - 1];
        ctx.lineTo(((li % w.w) + 0.5) * TILE, (((li / w.w) | 0) + 0.5) * TILE);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    void vr;
  }

  private drawHerds(vr: { x0: number; y0: number; x1: number; y1: number }, zCss: number): void {
    const sim = this.sim;
    const ctx = this.ctx;
    if (zCss < 0.55) return; // from far above, herds are too small to see
    const t = this.time;
    for (const h of sim.herds.values()) {
      if (h.x < vr.x0 - 2 || h.x > vr.x1 + 2 || h.y < vr.y0 - 2 || h.y > vr.y1 + 2) continue;
      const sp = sim.species.get(h.sp);
      if (!sp) continue;
      const col = sp.color;
      const r = (col >> 16) & 255,
        g = (col >> 8) & 255,
        b = col & 255;
      const colors = { a: `rgb(${r},${g},${b})`, b: `rgb(${(r * 0.62) | 0},${(g * 0.62) | 0},${(b * 0.62) | 0})`, e: '#1c1820', w: '#f4eedc', o: `rgb(${(r * 0.3) | 0},${(g * 0.3) | 0},${(b * 0.34) | 0})` };
      const big = h.size > 0.8,
        small = h.size < 0.25;
      const A = sp.shape === 4 ? SP.BIRD : big ? SP.GIANT : small ? SP.CRITTER : sp.diet === 1 ? SP.PREDATOR : SP.GRAZER;
      const Bf = sp.shape === 4 ? SP.BIRD : big ? SP.GIANT : small ? SP.CRITTER : sp.diet === 1 ? SP.PREDATOR_B : SP.GRAZER_B;
      const key = 'sp' + sp.id + (A === SP.BIRD ? 'b' : big ? 'g' : small ? 'c' : sp.diet === 1 ? 'p' : 'z');
      const bx = (h.x + 0.5) * TILE,
        by = (h.y + 0.5) * TILE;
      const show = zCss < 1.3 ? 1 : Math.min(3, Math.max(1, Math.round(Math.sqrt(h.n) / 3)));
      for (let k = 0; k < show; k++) {
        const hx = hash2(h.id, k, 11) - 0.5,
          hy = hash2(h.id, k, 12) - 0.5;
        const wob = Math.sin(t * (0.5 + hx) + k * 2.1) * 2;
        const ax = Math.round(bx + hx * 14 + wob),
          ay = Math.round(by + hy * 9 + Math.cos(t * 0.4 + k) * 1.2);
        const flip = Math.sin(t * 0.25 + k + h.id) < 0;
        const walking = Math.sin(t * 3 + k * 1.7 + h.id) > 0;
        const cv = this.spr(walking ? A : Bf, key + (walking ? 'a' : 'b'), colors, flip);
        ctx.drawImage(cv, ax - (cv.width >> 1), ay - cv.height + 2);
      }
    }
  }

  private drawSettlementLife(vr: { x0: number; y0: number; x1: number; y1: number }, zCss: number, dt: number): void {
    const sim = this.sim;
    const w = sim.world;
    const ctx = this.ctx;
    this.walkers.length = 0;
    const t = this.time;
    for (const s of sim.settlements.values()) {
      if (!s.alive) continue;
      const pad = s.radius + 2;
      if (s.x < vr.x0 - pad || s.x > vr.x1 + pad || s.y < vr.y0 - pad || s.y > vr.y1 + pad) continue;
      const civ = sim.civs.get(s.civ);
      const cxp = (s.x + 0.5) * TILE,
        cyp = (s.y + 0.5) * TILE;
      // smoke: hearths in the cold, chimneys in the age of coal
      if (zCss > 0.7 && civ) {
        const industrial = civ.mods.co2 > 0.5 || s.bld[B.factory] > 0;
        const cold = tempAt(w, sim.climate, s.tile, sim.tick) < 6;
        const rate = (industrial ? 2.5 + s.bld[B.factory] * 2 : cold ? 1.2 : 0.35) * Math.min(3, 0.6 + s.urban.length / 12);
        if (Math.random() < dt * rate) {
          const u = s.urban[(Math.random() * s.urban.length) | 0];
          const g = industrial ? 58 : 190;
          this.spawn((u % w.w) * TILE + 4, ((u / w.w) | 0) * TILE + 1, 1.5 + Math.random() * 2, -4 - Math.random() * 3, industrial ? 3.5 : 2.4, g, g, g + 6, industrial ? 3 : 2);
        }
        if (s.plague > 0 && Math.random() < dt * 2) this.spawn(cxp + (Math.random() - 0.5) * 20, cyp + (Math.random() - 0.5) * 16, 0, -2, 1.6, 170, 110, 220, 1.6);
        if (s.siege >= 0 && Math.random() < dt * 4) this.spawn(cxp + (Math.random() - 0.5) * 30, cyp + (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 6, -6, 0.9, 250, 150, 60, 1.4, 14);
      }
      // status rings
      if (s.siege >= 0 || s.blockaded) {
        ctx.strokeStyle = s.siege >= 0 ? 'rgba(240,80,60,0.9)' : 'rgba(90,170,240,0.9)';
        ctx.lineWidth = 1.5 / zCss;
        ctx.setLineDash([3, 3]);
        ctx.lineDashOffset = -t * 6;
        ctx.beginPath();
        ctx.arc(cxp, cyp, (Math.sqrt(s.urban.length) * 0.7 + 1.6) * TILE, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // the people themselves, when close enough to see them
      if (zCss < 1.7) continue;
      const cap = Math.min(s.people.length, zCss > 3 ? 12 + Math.round(s.urban.length * 0.9) : 8 + Math.round(s.urban.length * 0.45));
      const stepP = Math.max(1, Math.floor(s.people.length / cap));
      const T = tempAt(w, sim.climate, s.tile, sim.tick);
      for (let k = 0; k < s.people.length; k += stepP) {
        const p = sim.people.get(s.people[k]);
        if (!p || p.army >= 0 || p.party >= 0) continue;
        const pos = this.personPos(s, p, t, T);
        if (!pos) continue;
        const frame = pos.moving && ((t * 6 + p.id) & 1) ? 1 : 0;
        const px = Math.round(pos.x),
          py = Math.round(pos.y);
        if (p.job === J.child) ctx.drawImage(this.childSprites[frame], px, py + 2);
        else ctx.drawImage(this.personSprites[p.job * 2 + frame], px, py);
        this.walkers.push({ id: p.id, x: px + 2, y: py + 3 });
      }
    }
  }

  /** where a resident is right now: a cosmetic daily round between home and their actual place of work */
  private personPos(s: Settlement, p: Person, t: number, T: number): { x: number; y: number; moving: boolean } | null {
    const w = this.sim.world;
    const h = p.id * 2654435761;
    const u1 = ((h >>> 8) & 1023) / 1023,
      u2 = ((h >>> 18) & 1023) / 1023;
    if (s.urban.length === 0) return null;
    const home = s.urban[(h >>> 4) % s.urban.length];
    let work = home;
    switch (p.job) {
      case J.farmer: if (s.farms.length) work = s.farms[(h >>> 6) % s.farms.length]; break;
      case J.miner: if (s.mines.length) work = s.mines[(h >>> 6) % s.mines.length]; break;
      case J.fisher: if (s.portTile >= 0) work = s.portTile; break;
      case J.woodcutter: case J.hunter: case J.herder: if (s.tiles.length) work = s.tiles[(h >>> 6) % s.tiles.length]; break;
      case J.child: work = s.urban[(h >>> 9) % s.urban.length]; break;
      default: work = s.urban[(h >>> 11) % s.urban.length];
    }
    if (p.job === J.fisher && w.water[work] !== W_LAND) {
      // stand on the shore beside the water
      work = s.tile;
    }
    const period = 16 + u1 * 14;
    const ph = (t / period + u2) % 1;
    // indoors at night and in bad cold: most stay out of sight
    if (ph > 0.8 || (T < -4 && u1 > 0.4) || (p.job === J.child && u2 > 0.5)) return null;
    const hx = (home % w.w) * TILE + 1 + u1 * 5,
      hy = ((home / w.w) | 0) * TILE + 2 + u2 * 4;
    const wx = (work % w.w) * TILE + 1 + u2 * 5,
      wy = ((work / w.w) | 0) * TILE + 1 + u1 * 5;
    let f: number, moving = false;
    if (ph < 0.14) { f = ph / 0.14; moving = true; }
    else if (ph < 0.6) { f = 1; }
    else if (ph < 0.74) { f = 1 - (ph - 0.6) / 0.14; moving = true; }
    else f = 0;
    let x = hx + (wx - hx) * f,
      y = hy + (wy - hy) * f;
    if (!moving) {
      // pottering about at work or at home
      x += Math.sin(t * 0.9 + u1 * 9) * 1.6;
      y += Math.cos(t * 0.7 + u2 * 9) * 1.1;
      moving = Math.sin(t * 0.9 + u1 * 9 + 1.2) > 0.5;
    }
    return { x, y, moving };
  }

  private drawParties(vr: { x0: number; y0: number; x1: number; y1: number }, zCss: number): void {
    const sim = this.sim;
    const ctx = this.ctx;
    const w = sim.world;
    const t = this.time;
    for (const p of sim.parties.values()) {
      if (p.x < vr.x0 - 2 || p.x > vr.x1 + 2 || p.y < vr.y0 - 2 || p.y > vr.y1 + 2) continue;
      // glide between path nodes
      let fx = p.x, fy = p.y, dirX = 1;
      if (p.pi < p.path.length - 1) {
        const nxt = p.path[p.pi + 1];
        const f = Math.min(1, p.acc / 1.5);
        dirX = (nxt % w.w) - p.x;
        fx += dirX * f * 0.6;
        fy += (((nxt / w.w) | 0) - p.y) * f * 0.6;
      }
      const bx = Math.round((fx + 0.5) * TILE),
        by = Math.round((fy + 0.5) * TILE);
      const civ = sim.civs.get(p.civ);
      const col = civ ? civCss(civ.color) : '#d8d0c0';
      const era = civ ? civ.era : 0;
      const flip = dirX < 0;
      if (p.sea) {
        this.drawShip(bx, by + Math.round(Math.sin(t * 2 + p.id)), era, col, p.kind === PARTY.caravan, flip, civ ? civ.color : -1);
        continue;
      }
      if (p.kind === PARTY.caravan) {
        const wheeled = era >= 1;
        const cv = this.spr(wheeled ? SP.CARAVAN : SP.PACK, (wheeled ? 'car' : 'pack') + (civ ? civ.color : 'x'), { a: '#a07c56', b: '#5e4634', c: col, w: '#b88c5a', k: '#33291f' }, flip);
        ctx.drawImage(cv, bx - (cv.width >> 1), by - cv.height + 3 + (Math.sin(t * 8 + p.id) > 0 ? 0 : 1));
      } else {
        // people on the road
        const n = Math.min(8, Math.max(2, Math.ceil(p.people.length / 4)));
        if (p.kind === PARTY.settlers) {
          const cv = this.spr(SP.WAGON, 'wagon', { s: '#f2ead6', w: '#9a7248', k: '#33291f' }, flip);
          ctx.drawImage(cv, bx - 4, by - 7);
          ctx.fillStyle = col;
          ctx.fillRect(bx + 4, by - 10, 3, 2);
          ctx.fillStyle = '#3a2f2a';
          ctx.fillRect(bx + 3, by - 10, 1, 4);
        }
        for (let k = 0; k < n; k++) {
          const ox = Math.round((hash2(p.id, k, 21) - 0.5) * 12),
            oy = Math.round((hash2(p.id, k, 22) - 0.5) * 7);
          const fr = ((t * 6 + k) & 1) === 0 ? 0 : 1;
          ctx.drawImage(this.personSprites[(p.kind === PARTY.refugees ? J.laborer : J.farmer) * 2 + fr], bx + ox - 2, by + oy - 2);
        }
      }
    }
  }

  private drawShip(bx: number, by: number, era: number, col: string, merchant: boolean, flip: boolean, civColor: number): void {
    const ctx = this.ctx;
    const key = (era >= 5 ? 'steam' : era >= 1 ? 'ship' : 'canoe') + (merchant ? 'm' : 'w') + civColor;
    const colors = { h: era >= 5 ? '#565a68' : '#8a5e3a', s: merchant ? '#f4ecd8' : col, m: '#4a3628', f: col, w: '#e2e4ea', k: '#2e2c34', o: '#28243a' };
    const cv = this.spr(era >= 5 ? SP.STEAMER : era >= 1 ? SP.SHIP : SP.CANOE, key, colors, flip);
    ctx.drawImage(cv, bx - (cv.width >> 1), by - cv.height + 4);
    // wake
    ctx.fillStyle = 'rgba(236,248,252,0.7)';
    ctx.fillRect(bx - (cv.width >> 1) - 2, by + 4, 3, 1);
    ctx.fillRect(bx + (cv.width >> 1) - 1, by + 4, 3, 1);
    if (era >= 5 && Math.random() < 0.08) this.spawn(bx, by - cv.height + 2, 1.5, -3, 1.8, 90, 90, 98, 2);
  }

  private drawArmies(vr: { x0: number; y0: number; x1: number; y1: number }, zCss: number): void {
    const sim = this.sim;
    const ctx = this.ctx;
    const w = sim.world;
    const t = this.time;
    for (const a of sim.armies.values()) {
      if (a.x < vr.x0 - 3 || a.x > vr.x1 + 3 || a.y < vr.y0 - 3 || a.y > vr.y1 + 3) continue;
      const civ = sim.civs.get(a.civ);
      if (!civ) continue;
      let fx = a.x, fy = a.y, dirX = 1;
      if (a.path.length > 0 && a.pi < a.path.length - 1 && a.foe < 0) {
        const nxt = a.path[a.pi + 1];
        const f = Math.min(1, a.moveAcc / 1.5);
        dirX = (nxt % w.w) - a.x;
        fx += dirX * f * 0.6;
        fy += (((nxt / w.w) | 0) - a.y) * f * 0.6;
      }
      const bx = Math.round((fx + 0.5) * TILE),
        by = Math.round((fy + 0.5) * TILE);
      const col = civCss(civ.color);
      const flip = dirX < 0;
      if (a.atSea) {
        this.drawShip(bx - 6, by + Math.round(Math.sin(t * 2 + a.id)), civ.era, col, false, flip, civ.color);
        this.drawShip(bx + 7, by + 3, civ.era, col, false, flip, civ.color);
        continue;
      }
      const n = Math.max(3, Math.min(18, Math.round(a.soldiers.length / 5)));
      const colsN = Math.ceil(Math.sqrt(n * 1.8));
      const fighting = a.fighting > 0;
      const moving = a.path.length > 0 && a.pi < a.path.length - 1;
      const colors = { h: civ.era >= 2 ? '#c8ccd6' : '#6e5a44', s: '#f0c8a0', b: col, l: '#3a2f2a', p: civ.era >= 4 ? '#3c3c48' : '#d0d2da', o: '#28243a' };
      const s0 = this.spr(SP.SOLDIER_A, 'sol' + civ.color + (civ.era >= 2 ? 'h' : 'n') + (civ.era >= 4 ? 'g' : 's') + 'a', colors, flip);
      const s1 = this.spr(SP.SOLDIER_B, 'sol' + civ.color + (civ.era >= 2 ? 'h' : 'n') + (civ.era >= 4 ? 'g' : 's') + 'b', colors, flip);
      for (let k = 0; k < n; k++) {
        const gx = k % colsN,
          gy = (k / colsN) | 0;
        const jx = fighting ? Math.round((Math.random() - 0.5) * 2) : 0,
          jy = fighting ? Math.round((Math.random() - 0.5) * 2) : 0;
        const x = bx + Math.round((gx - colsN / 2) * 5) + jx,
          y = by + (gy - 1) * 6 + jy;
        ctx.drawImage(moving && ((t * 6 + k) & 1) ? s1 : s0, x, y - 5);
      }
      // the banner
      const px = bx - Math.round((colsN / 2) * 5) - 3;
      const wave = Math.sin(t * 5 + a.id) > 0 ? 0 : 1;
      ctx.fillStyle = '#28243a';
      ctx.fillRect(px - 1, by - 15, 3, 16);
      ctx.fillRect(px + 1, by - 16 + wave, 8, 7);
      ctx.fillStyle = '#6a5a4a';
      ctx.fillRect(px, by - 14, 1, 14);
      ctx.fillStyle = col;
      ctx.fillRect(px + 2, by - 15 + wave, 6, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(px + 4, by - 13 + wave, 2, 1);
      if (fighting && Math.random() < 0.5) {
        this.spawn(bx + (Math.random() - 0.5) * 16, by - 2 + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 18, -9 - Math.random() * 6, 0.45, 255, 236, 150, 2, 30);
      }
      // siege camp
      if (a.goal === 1 && !moving && a.foe < 0) {
        const tent = this.spr(SP.TENT, 'tent', { s: '#e8dcc0', d: '#5a4a3a' });
        ctx.drawImage(tent, bx + 10, by);
        ctx.drawImage(tent, bx + 16, by + 3);
        if (Math.random() < 0.03) this.spawn(bx + 12, by + 2, 0.5, -3, 1.6, 200, 190, 180, 2);
      }
    }
    void zCss;
  }

  private drawParticles(dt: number): void {
    const ctx = this.ctx;
    const ps = this.particles;
    let n = 0;
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      const a = p.life / p.max;
      ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${(a * 0.75).toFixed(2)})`;
      const sz = p.size * (p.grav ? 1 : 1.6 - a * 0.6);
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
      ps[n++] = p;
    }
    ps.length = n;
  }

  private drawStorms(vr: { x0: number; y0: number; x1: number; y1: number }, dt: number): void {
    const sim = this.sim;
    const ctx = this.ctx;
    const t = this.time;
    const white = this.spr(SP.CLOUD, 'cloudw', { w: '#fbfdff', g: '#cfdcea' });
    const grey = this.spr(SP.CLOUD, 'cloudg', { w: '#aab4c4', g: '#77829a' });
    const snow = this.spr(SP.CLOUD, 'clouds', { w: '#ffffff', g: '#dfe8f4' });
    const dark = this.spr(SP.CLOUD, 'cloudd', { w: '#1a2238', g: '#1a2238' });
    for (const s of sim.storms) {
      if (s.x < vr.x0 - s.r - 6 || s.x > vr.x1 + s.r + 6 || s.y < vr.y0 - s.r - 6 || s.y > vr.y1 + s.r + 6) continue;
      const cx = (s.x + 0.5) * TILE,
        cy = (s.y + 0.5) * TILE;
      const R = s.r * TILE;
      const fade = Math.min(1, s.life / 30) * Math.min(1, s.power);
      const cv = s.kind === 1 || s.kind === 3 ? grey : s.kind === 2 ? snow : white;
      const puffs = s.kind === 3 ? 12 : 6;
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = pass === 0 ? 0.2 * fade : 0.92 * fade;
        for (let k = 0; k < puffs; k++) {
          let ax: number, ay: number;
          if (s.kind === 3) {
            const ang = k * 1.1 + t * 0.8,
              rr = (0.25 + (k / puffs) * 0.75) * R;
            ax = cx + Math.cos(ang) * rr;
            ay = cy + Math.sin(ang) * rr * 0.75;
          } else {
            ax = cx + (hash2(s.id, k, 31) - 0.5) * R * 1.5 + Math.sin(t * 0.3 + k) * 3;
            ay = cy + (hash2(s.id, k, 32) - 0.5) * R * 0.9;
          }
          const sc = 2 + Math.floor(hash2(s.id, k, 33) * 2);
          const dw = cv.width * sc,
            dh = cv.height * sc;
          if (pass === 0) ctx.drawImage(dark, Math.round(ax - dw / 2 + 8), Math.round(ay - dh / 2 + 14), dw, dh); // shadow on the ground
          else ctx.drawImage(cv, Math.round(ax - dw / 2), Math.round(ay - dh / 2), dw, dh);
        }
      }
      ctx.globalAlpha = 1;
      const drops = Math.min(14, Math.ceil(s.r * 1.2));
      for (let k = 0; k < drops; k++) {
        if (Math.random() > 0.5) continue;
        const ax = cx + (Math.random() - 0.5) * R * 1.6,
          ay = cy + (Math.random() - 0.5) * R * 1.1;
        if (s.kind === 2) this.spawn(ax, ay, 4 + Math.random() * 3, 7, 1.1, 250, 250, 255, 2);
        else this.spawn(ax, ay, 3, 34, 0.35, 150, 196, 240, 1.4, 0);
      }
    }
    void dt;
  }

  private drawFx(dt: number): void {
    const ctx = this.ctx;
    const out: Fx[] = [];
    for (const f of this.fx) {
      f.age += dt;
      if (f.age > f.dur) continue;
      out.push(f);
      const u = f.age / f.dur;
      const cx = (f.x + 0.5) * TILE,
        cy = (f.y + 0.5) * TILE;
      const R = f.r * TILE;
      switch (f.kind) {
        case 'bolt': {
          ctx.strokeStyle = `rgba(255,250,210,${(1 - u).toFixed(2)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          let x = cx + 14,
            y = cy - 90;
          ctx.moveTo(x, y);
          for (let k = 0; k < 7; k++) {
            x += (cx - x) * 0.3 + (hash2(k, (f.x * 7 + f.y) | 0, 41) - 0.5) * 12;
            y += (cy - y) * 0.3;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(cx, cy);
          ctx.stroke();
          ctx.fillStyle = `rgba(255,255,230,${((1 - u) * 0.5).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(cx, cy, 8, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'meteor': {
          if (u < 0.25) {
            const v = u / 0.25;
            const x = cx - 160 * (1 - v),
              y = cy - 220 * (1 - v);
            ctx.strokeStyle = 'rgba(255,200,120,0.9)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x - 26, y - 36);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.fillStyle = '#fff2c0';
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const v = (u - 0.25) / 0.75;
            ctx.strokeStyle = `rgba(255,220,160,${(1 - v).toFixed(2)})`;
            ctx.lineWidth = 3 * (1 - v) + 0.5;
            ctx.beginPath();
            ctx.arc(cx, cy, R * (0.4 + v * 3), 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = `rgba(255,240,200,${((1 - v) * 0.6).toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(cx, cy, R * (1 - v * 0.5), 0, Math.PI * 2);
            ctx.fill();
            if (v < 0.4) for (let k = 0; k < 6; k++) this.spawn(cx, cy, (Math.random() - 0.5) * 90, -Math.random() * 80, 1.2, 255, 150 + Math.random() * 80, 60, 2.4, 90);
          }
          break;
        }
        case 'erupt': {
          for (let k = 0; k < 4; k++) this.spawn(cx + (Math.random() - 0.5) * 6, cy - 8, (Math.random() - 0.5) * 40, -40 - Math.random() * 50, 1.6, 255, 110 + Math.random() * 90, 30, 2.4, 70);
          if (Math.random() < 0.6) this.spawn(cx, cy - 12, (Math.random() - 0.5) * 8 + 4, -14 - Math.random() * 8, 4, 60, 56, 60, 5);
          ctx.fillStyle = `rgba(255,120,40,${(0.35 * (1 - u)).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(cx, cy, 14, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'quake':
        case 'wave':
        case 'mutate': {
          const col = f.kind === 'quake' ? '200,170,130' : f.kind === 'wave' ? '120,200,250' : '150,250,150';
          for (let k = 0; k < 3; k++) {
            const v = (u + k * 0.25) % 1;
            ctx.strokeStyle = `rgba(${col},${(1 - v).toFixed(2)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, R * v, 0, Math.PI * 2);
            ctx.stroke();
          }
          break;
        }
        case 'clash': {
          if (Math.random() < 0.6) this.spawn(cx + (Math.random() - 0.5) * 10, cy - 3, (Math.random() - 0.5) * 24, -12, 0.4, 255, 240, 170, 1.3, 40);
          break;
        }
        case 'bless':
        case 'curse': {
          const good = f.kind === 'bless';
          ctx.fillStyle = good ? `rgba(255,226,130,${(0.4 * (1 - u)).toFixed(2)})` : `rgba(170,110,230,${(0.4 * (1 - u)).toFixed(2)})`;
          ctx.beginPath();
          ctx.moveTo(cx - R * 0.3, cy - 200);
          ctx.lineTo(cx + R * 0.3, cy - 200);
          ctx.lineTo(cx + R, cy);
          ctx.lineTo(cx - R, cy);
          ctx.fill();
          if (Math.random() < 0.7) this.spawn(cx + (Math.random() - 0.5) * R * 2, cy + (Math.random() - 0.5) * R, 0, good ? -10 : 6, 1, good ? 255 : 180, good ? 230 : 120, good ? 140 : 240, 1.6);
          break;
        }
        case 'rain': {
          for (let k = 0; k < 5; k++) this.spawn(cx + (Math.random() - 0.5) * R * 2, cy + (Math.random() - 0.5) * R * 2 - 10, 3, 36, 0.35, 150, 190, 240, 1);
          break;
        }
        case 'heat': {
          ctx.fillStyle = `rgba(255,170,70,${(0.16 * (1 - u)).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(cx, cy, R, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'swarm': {
          for (let k = 0; k < 4; k++) this.spawn(cx + (Math.random() - 0.5) * R * 2, cy + (Math.random() - 0.5) * R * 2, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, 0.5, 60, 70, 30, 1.2);
          break;
        }
      }
    }
    this.fx = out;
  }

  /** a name on a dark plate, so it reads over any ground */
  private plate(text: string, x: number, y: number, size: number, color: string, bold: boolean, edge?: string): number {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.font = `${bold ? 600 : 400} ${Math.round(size * dpr)}px "Pixelify Sans", "IBM Plex Sans", sans-serif`;
    const tw = Math.ceil(ctx.measureText(text).width);
    const padX = Math.round(4 * dpr),
      h = Math.round((size + 5) * dpr);
    const left = Math.round(x - tw / 2 - padX),
      top = Math.round(y);
    ctx.fillStyle = 'rgba(18,22,32,0.82)';
    ctx.fillRect(left, top, tw + padX * 2, h);
    if (edge) {
      ctx.fillStyle = edge;
      ctx.fillRect(left, top + h - Math.max(1, Math.round(2 * dpr)), tw + padX * 2, Math.max(1, Math.round(2 * dpr)));
    }
    ctx.fillStyle = color;
    ctx.fillText(text, Math.round(x), top + Math.round(2 * dpr));
    return tw + padX * 2;
  }

  private drawLabels(vr: { x0: number; y0: number; x1: number; y1: number }, zCss: number): void {
    const sim = this.sim;
    const ctx = this.ctx;
    const dpr = this.dpr;
    const minPop = zCss > 1.1 ? 0 : zCss > 0.7 ? 60 : zCss > 0.45 ? 200 : 100000;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const s of sim.settlements.values()) {
      if (!s.alive) continue;
      if (s.x < vr.x0 - 4 || s.x > vr.x1 + 4 || s.y < vr.y0 - 4 || s.y > vr.y1 + 4) continue;
      const civ = sim.civs.get(s.civ);
      if (!civ) continue;
      const capital = civ.capital === s.id;
      const pop = s.people.length;
      if (!capital && pop < minPop) continue;
      const p = this.tileToScreen(s.x + 0.5, s.y + 1.1);
      const x = p.x * dpr,
        y = (p.y + Math.max(3, Math.sqrt(s.urban.length) * 0.35 * TILE * zCss)) * dpr;
      const text = zCss > 0.9 ? `${s.name} ${pop}` : s.name;
      const wPlate = this.plate(text, x, y, capital ? 13 : pop > 250 ? 12 : 11, '#f4efe0', capital, civCss(civ.color));
      // status pips: famine, plague, unrest
      let px = x + wPlate / 2 + 3 * dpr;
      const pip = (col: string) => {
        ctx.fillStyle = 'rgba(18,22,32,0.9)';
        ctx.fillRect(px - 1 * dpr, y + 3 * dpr, 9 * dpr, 9 * dpr);
        ctx.fillStyle = col;
        ctx.fillRect(px + 1 * dpr, y + 5 * dpr, 5 * dpr, 5 * dpr);
        px += 10 * dpr;
      };
      if (s.hungerMonths > 2) pip('#f0a35e');
      if (s.plague > 0) pip('#b58cf5');
      if (s.unrest > 0.6) pip('#ef6b5e');
    }
    // nation names when zoomed far out
    if (zCss <= 0.75) {
      for (const civ of sim.civs.values()) {
        if (!civ.alive || civ.pop < 40) continue;
        const cap = sim.settlements.get(civ.capital);
        if (!cap) continue;
        const p = this.tileToScreen(cap.x + 0.5, cap.y - 3);
        this.plate(civ.name.toUpperCase(), p.x * dpr, p.y * dpr, civ.pop > 600 ? 15 : 12, civCss(civ.color), true);
      }
    }
    // armies: strength at a glance
    if (zCss > 0.8) {
      for (const a of sim.armies.values()) {
        if (a.x < vr.x0 || a.x > vr.x1 || a.y < vr.y0 || a.y > vr.y1) continue;
        const civ = sim.civs.get(a.civ);
        if (!civ) continue;
        const p = this.tileToScreen(a.x + 0.5, a.y - 2.6);
        this.plate(String(a.soldiers.length), p.x * dpr, p.y * dpr, 10, civCss(civ.color), true);
      }
    }
  }
}
export { meanTemp, TICKS_PER_YEAR };
