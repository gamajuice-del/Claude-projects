// Terrain rasterizer: the world is drawn as pixel art into cached 256×256 chunk canvases (8 px per tile).
// Colours come from the continuous simulation fields (moisture, vegetation, temperature, elevation),
// so the map changes as the world does: seasons, snow lines, deforestation, farms, growing cities.
import { hash2 } from '../sim/rng';
import {
  B, I_CAMP, I_FARM, I_MINE, I_PASTURE, I_RUIN, I_SCORCHED, I_URBAN, Sim, Settlement, TICKS_PER_YEAR, W_LAKE, W_LAND, W_OCEAN, Civ,
} from '../sim/types';
import { HILL, MOUNTAIN, PEAK, SEA, meanTemp, tempAt } from '../sim/world';
import { CIV_COLORS, STYLES } from './palette';

export const TILE = 8;
export const CHUNK = 32;
export const CPX = CHUNK * TILE;
const M = TILE; // margin in px around the chunk buffer (one tile) so sprites can overlap chunk edges
const S = CPX + M * 2;

function pack(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}
function shade(c: number, f: number): number {
  const r = Math.min(255, (c & 255) * f) | 0,
    g = Math.min(255, ((c >> 8) & 255) * f) | 0,
    b = Math.min(255, ((c >> 16) & 255) * f) | 0;
  return ((c & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
}
function ih(x: number, y: number): number {
  // fast integer hash 0..255
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) & 255;
}

const ROAD_COL = [0, pack(146, 122, 88), pack(172, 156, 128), pack(96, 90, 92), pack(96, 90, 92)];
const ORE_COL = [0, pack(170, 170, 176), pack(214, 128, 72), pack(150, 96, 84), pack(40, 40, 46), pack(250, 214, 80), pack(240, 240, 240), pack(30, 26, 34)];

export class TerrainLayer {
  sim: Sim;
  cols: number;
  rows: number;
  canvases: HTMLCanvasElement[] = [];
  ctxs: CanvasRenderingContext2D[] = [];
  dirty: Uint8Array;
  cursor = 0;
  private buf: Uint32Array;
  private img: ImageData;
  // per-chunk scratch of tile colours for smooth blending (34×34)
  private tr = new Float32Array(34 * 34);
  private tg = new Float32Array(34 * 34);
  private tb = new Float32Array(34 * 34);
  private tw = new Uint8Array(34 * 34); // 0 land, 1 water, 2 off-map

  constructor(sim: Sim) {
    this.sim = sim;
    const w = sim.world;
    this.cols = Math.ceil(w.w / CHUNK);
    this.rows = Math.ceil(w.h / CHUNK);
    for (let k = 0; k < this.cols * this.rows; k++) {
      const c = document.createElement('canvas');
      c.width = CPX;
      c.height = CPX;
      this.canvases.push(c);
      this.ctxs.push(c.getContext('2d')!);
    }
    this.dirty = new Uint8Array(this.cols * this.rows).fill(1);
    this.img = new ImageData(S, S);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  markAll(): void {
    this.dirty.fill(1);
    if (this.sweeping) this.pendingBack.fill(1);
  }

  markTile(i: number): void {
    const w = this.sim.world;
    const x = i % w.w,
      y = (i / w.w) | 0;
    const cx = (x / CHUNK) | 0,
      cy = (y / CHUNK) | 0;
    this.dirty[cy * this.cols + cx] = 1;
    if (this.sweeping) {
      // the off-screen set must hear about it too; neighbours are caught by the next sweep
      this.pendingBack[cy * this.cols + cx] = 1;
    }
    const lx = x % CHUNK,
      ly = y % CHUNK;
    if (lx === 0 && cx > 0) this.dirty[cy * this.cols + cx - 1] = 1;
    if (lx === CHUNK - 1 && cx < this.cols - 1) this.dirty[cy * this.cols + cx + 1] = 1;
    if (ly === 0 && cy > 0) this.dirty[(cy - 1) * this.cols + cx] = 1;
    if (ly >= CHUNK - 2 && cy < this.rows - 1) this.dirty[(cy + 1) * this.cols + cx] = 1;
  }

  /** the moment in the year the visible map is drawn at */
  seasonTick = 0;
  /** at very high simulation speeds seasons would strobe, so the map shows the year's average instead */
  useMean = false;
  // Seasonal redraws are double-buffered: a whole new set of chunks is painted off-screen over several
  // frames and swapped in at once, so neighbouring chunks never disagree about what month it is.
  private back: HTMLCanvasElement[] = [];
  private backCtx: CanvasRenderingContext2D[] = [];
  private pendingBack: Uint8Array = new Uint8Array(0);
  private sweeping = false;
  private sweepTick = 0;
  private sweepMean = false;
  private lastSweep = 0;
  private drawTick = 0;
  private drawMean = false;

  refresh(budgetMs: number, visible: (c: number) => boolean, fast: boolean, paused: boolean): void {
    const t0 = performance.now();
    const n = this.dirty.length;
    if (this.back.length !== n) {
      for (let k = 0; k < n; k++) {
        const c = document.createElement('canvas');
        c.width = CPX;
        c.height = CPX;
        this.back.push(c);
        this.backCtx.push(c.getContext('2d')!);
      }
      this.pendingBack = new Uint8Array(n);
    }
    // 1. things that changed on the ground: straight to the visible set
    for (let c = 0; c < n; c++) {
      if (this.dirty[c] && visible(c)) {
        this.renderChunk(c);
        if (performance.now() - t0 > budgetMs) return;
      }
    }
    let off = 0;
    for (let c = 0; c < n && off < 3; c++) {
      if (this.dirty[c]) {
        this.renderChunk(c);
        off++;
        if (performance.now() - t0 > budgetMs) return;
      }
    }
    // 2. the turning of the seasons: an off-screen sweep, swapped in whole
    if (!this.sweeping && !paused) {
      const tick = this.sim.tick;
      const monthNow = Math.floor((tick % TICKS_PER_YEAR) / 4),
        monthThen = Math.floor((this.seasonTick % TICKS_PER_YEAR) / 4);
      const due = fast !== this.useMean || (fast ? t0 - this.lastSweep > 3000 : monthNow !== monthThen && t0 - this.lastSweep > 700);
      if (due) {
        this.sweeping = true;
        this.sweepTick = tick;
        this.sweepMean = fast;
        this.pendingBack.fill(1);
      }
    }
    if (!this.sweeping) return;
    let left = 0;
    for (let c = 0; c < n; c++) {
      if (!this.pendingBack[c]) continue;
      if (performance.now() - t0 > budgetMs) {
        left++;
        continue;
      }
      this.renderChunk(c, true);
    }
    if (left === 0) {
      const f = this.canvases, fc = this.ctxs;
      this.canvases = this.back;
      this.ctxs = this.backCtx;
      this.back = f;
      this.backCtx = fc;
      this.seasonTick = this.sweepTick;
      this.useMean = this.sweepMean;
      this.sweeping = false;
      this.lastSweep = performance.now();
    }
  }

  private tileBase(i: number, out: Float32Array, k: number): void {
    // (unused placeholder to keep hidden-class shape stable)
    void i; void out; void k;
  }

  renderChunk(c: number, toBack = false): void {
    if (toBack) {
      this.pendingBack[c] = 0;
      this.drawTick = this.sweepTick;
      this.drawMean = this.sweepMean;
    } else {
      this.dirty[c] = 0;
      this.drawTick = this.seasonTick;
      this.drawMean = this.useMean;
    }
    const sim = this.sim;
    const w = sim.world;
    const clim = sim.climate;
    const tick = this.drawTick;
    const mean = this.drawMean;
    const TT = (i: number) => (mean ? meanTemp(w, clim, i) + 2 : tempAt(w, clim, i, tick));
    const W = w.w,
      H = w.h;
    const cx0 = (c % this.cols) * CHUNK,
      cy0 = ((c / this.cols) | 0) * CHUNK;
    const buf = this.buf;
    const { tr, tg, tb, tw } = this;
    const month = mean ? 4 : Math.floor((tick % TICKS_PER_YEAR) / 4);
    const sea = w.seaLevel;
    // ---------- pass 1: one colour per tile ----------
    for (let ty = 0; ty < 34; ty++) {
      const y = cy0 + ty - 1;
      for (let tx = 0; tx < 34; tx++) {
        const x = cx0 + tx - 1;
        const k = ty * 34 + tx;
        if (x < 0 || y < 0 || x >= W || y >= H) {
          tw[k] = 2;
          tr[k] = 18; tg[k] = 52; tb[k] = 104;
          continue;
        }
        const i = y * W + x;
        if (w.water[i] !== W_LAND) {
          tw[k] = 1;
          const T = TT(i);
          const iced = T < -7;
          if (iced) {
            tr[k] = 214; tg[k] = 230; tb[k] = 240;
          } else if (w.water[i] === W_LAKE) {
            tr[k] = 62; tg[k] = 150; tb[k] = 186;
          } else {
            const d = Math.min(1, (sea - w.elev[i]) / 0.3);
            const s = 1 - d;
            tr[k] = 20 + s * s * 56; tg[k] = 62 + s * 108; tb[k] = 122 + s * 72;
          }
          continue;
        }
        tw[k] = 0;
        const rel = w.elev[i] - sea + SEA;
        const T = TT(i);
        const mt = meanTemp(w, clim, i);
        const m = w.moist[i];
        const v = w.veg[i];
        const f = w.forest[i];
        // bare ground: sand → earth by moisture; rock with height; grey-tan in the cold
        const wet = Math.min(1, m * 2.2);
        let r = 212 - wet * 78, g = 192 - wet * 80, b = 140 - wet * 60;
        if (mt < 3) {
          const cold = Math.min(1, (3 - mt) / 8);
          r += (150 - r) * cold; g += (148 - g) * cold; b += (128 - b) * cold;
        }
        if (rel > HILL) {
          const rk = Math.min(1, (rel - HILL) / (MOUNTAIN - HILL));
          r += (126 - r) * rk * 0.8; g += (118 - g) * rk * 0.8; b += (112 - b) * rk * 0.8;
        }
        // living cover
        const lush = Math.min(1, m * 1.7);
        let gr = 178 - lush * 96, gg = 172 - lush * 20, gb = 86 - lush * 28;
        if (mt > 21 && m > 0.5) { gr -= 22; gg -= 12; gb += 4; }
        if (T < 5) {
          const dorm = Math.min(1, (5 - T) / 6);
          gr += (156 - gr) * dorm * 0.7; gg += (144 - gg) * dorm * 0.7; gb += (98 - gb) * dorm * 0.7;
        }
        const cover = Math.min(1, v * 1.7);
        r += (gr - r) * cover; g += (gg - g) * cover; b += (gb - b) * cover;
        if (f > 0.25) {
          const ff = Math.min(1, (f - 0.25) * 1.2);
          r += (46 - r) * ff * 0.7; g += (96 - g) * ff * 0.7; b += (52 - b) * ff * 0.7;
        }
        const imp = w.imp[i];
        if (imp === I_SCORCHED || w.fire[i] > 0) { r = 52; g = 44; b = 40; }
        // snow
        if (T < -1 && (m > 0.1 || rel > MOUNTAIN)) {
          const sn = Math.min(1, (-1 - T) / 5) * (rel > MOUNTAIN ? 1 : 0.92);
          r += (238 - r) * sn; g += (242 - g) * sn; b += (248 - b) * sn;
        }
        if (w.flood[i] > 0) { r = r * 0.4 + 50; g = g * 0.4 + 96; b = b * 0.4 + 130; }
        // hillshade from the north-west
        const e = w.elev[i];
        const wv = x > 0 ? w.elev[i - 1] : e,
          ev = x < W - 1 ? w.elev[i + 1] : e,
          nv = y > 0 ? w.elev[i - W] : e,
          sv = y < H - 1 ? w.elev[i + W] : e;
        let sh = (Math.max(wv, sea) - Math.max(ev, sea) + (Math.max(nv, sea) - Math.max(sv, sea))) * 7;
        sh = sh > 0.28 ? 0.28 : sh < -0.3 ? -0.3 : sh;
        const sf = 1 - sh; // higher to the west/north of us → we are in shadow
        tr[k] = r * sf; tg[k] = g * sf; tb[k] = b * sf;
      }
    }
    // ---------- pass 2: pixels, blended between like tiles ----------
    for (let py = 0; py < S; py++) {
      const fy = (py + 0.5) / TILE - 0.5;
      let y0 = Math.floor(fy);
      let wy = fy - y0;
      if (y0 < 0) { y0 = 0; wy = 0; }
      const y1 = y0 >= 33 ? 33 : y0 + 1;
      const tyOwn = (py / TILE) | 0;
      for (let px = 0; px < S; px++) {
        const fx = (px + 0.5) / TILE - 0.5;
        let x0 = Math.floor(fx);
        let wx = fx - x0;
        if (x0 < 0) { x0 = 0; wx = 0; }
        const x1 = x0 >= 33 ? 33 : x0 + 1;
        const own = tyOwn * 34 + ((px / TILE) | 0);
        const kind = tw[own];
        const k00 = y0 * 34 + x0, k10 = y0 * 34 + x1, k01 = y1 * 34 + x0, k11 = y1 * 34 + x1;
        let a = (1 - wx) * (1 - wy), b2 = wx * (1 - wy), c2 = (1 - wx) * wy, d = wx * wy;
        if (tw[k00] !== kind) a = 0;
        if (tw[k10] !== kind) b2 = 0;
        if (tw[k01] !== kind) c2 = 0;
        if (tw[k11] !== kind) d = 0;
        const sum = a + b2 + c2 + d;
        let r: number, g: number, b: number;
        if (sum < 0.001) { r = tr[own]; g = tg[own]; b = tb[own]; }
        else {
          r = (tr[k00] * a + tr[k10] * b2 + tr[k01] * c2 + tr[k11] * d) / sum;
          g = (tg[k00] * a + tg[k10] * b2 + tg[k01] * c2 + tg[k11] * d) / sum;
          b = (tb[k00] * a + tb[k10] * b2 + tb[k01] * c2 + tb[k11] * d) / sum;
        }
        const gx = cx0 * TILE + px - M,
          gy = cy0 * TILE + py - M;
        const n = ih(gx, gy);
        let alpha = 255;
        if (kind === 0) {
          const dn = (n - 128) * 0.06;
          r += dn; g += dn; b += dn * 0.8;
          // shoreline: sand where land meets water
          if (sum < 0.985) { r = r * 0.55 + 222 * 0.45; g = g * 0.55 + 206 * 0.45; b = b * 0.55 + 160 * 0.45; }
        } else {
          // water lets the animated sea show through; foam at the shore
          alpha = kind === 2 ? 150 : 168;
          if (sum < 0.985 && kind === 1) {
            if (sum < 0.8 || (n & 3) === 0) { r = 226; g = 240; b = 244; alpha = 210; }
            else { r += 26; g += 30; b += 22; alpha = 190; }
          }
        }
        // slight posterisation for a pixel-art feel
        const ri = r < 0 ? 0 : r > 253 ? 252 : (r + 2) & 0xfc,
          gi = g < 0 ? 0 : g > 253 ? 252 : (g + 2) & 0xfc,
          bi = b < 0 ? 0 : b > 253 ? 252 : (b + 2) & 0xfc;
        buf[py * S + px] = ((alpha << 24) | (bi << 16) | (gi << 8) | ri) >>> 0;
      }
    }
    // ---------- pass 3: features, painted north to south so tall things overlap what is behind ----------
    const set = (x: number, y: number, col: number) => {
      if (x >= 0 && y >= 0 && x < S && y < S) buf[y * S + x] = col;
    };
    const line = (x0: number, y0: number, x1: number, y1: number, col: number, thick: number) => {
      let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      for (let guard = 0; guard < 64; guard++) {
        set(x0, y0, col);
        if (thick > 1) { set(x0 + 1, y0, col); set(x0, y0 + 1, col); }
        if (thick > 2) { set(x0 - 1, y0, col); set(x0, y0 - 1, col); set(x0 + 1, y0 + 1, col); }
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
      void dx; void dy;
    };
    const RIVER = pack(64, 150, 204), RIVER_HI = pack(120, 196, 232);
    const snowCol = pack(240, 244, 250);
    for (let phase = 0; phase < 3; phase++)
    for (let ty = 0; ty < 34; ty++) {
      const y = cy0 + ty - 1;
      if (y < 0 || y >= H) continue;
      for (let tx = 0; tx < 34; tx++) {
        const x = cx0 + tx - 1;
        if (x < 0 || x >= W) continue;
        const i = y * W + x;
        const bx = tx * TILE,
          by = ty * TILE;
        const h1 = ih(x * 7 + 3, y * 13 + 5),
          h2 = ih(x * 11 + 1, y * 5 + 9);
        if (w.water[i] !== W_LAND) {
          continue;
        }
        const rel = w.elev[i] - sea + SEA;
        const imp = w.imp[i];
        const T = TT(i);
        const snowy = T < -1;
        // --- rivers ---
        if (phase === 1 && w.river[i] > 0) {
          const f = w.flow[i];
          if (f >= 0) {
            const fx = (f % W) - x,
              fy = ((f / W) | 0) - y;
            const th = w.river[i] > 110 ? 3 : w.river[i] > 45 ? 2 : 1;
            const col = T < -6 ? pack(206, 226, 238) : RIVER;
            line(bx + 4, by + 4, bx + 4 + fx * TILE, by + 4 + fy * TILE, col, th);
            if (th > 1 && (h1 & 3) === 0) set(bx + 3 + (h2 & 1), by + 3, RIVER_HI);
          }
        }
        // --- farmland ---
        if (phase === 0) {
        if (imp === I_FARM) {
          const gT = Math.max(0, Math.min(1, (T - 3) / 11));
          const owner = w.owner[i];
          const horiz = ((owner * 7 + ((x >> 2) + (y >> 2)) * 3) & 1) === 0;
          let c1: number, c2: number;
          if (snowy) { c1 = pack(228, 232, 238); c2 = pack(206, 210, 216); }
          else if (gT < 0.12) { c1 = pack(134, 112, 82); c2 = pack(120, 100, 74); }
          else if (month >= 6 && month <= 8 && meanTemp(w, clim, i) < 20) { c1 = pack(214, 184, 92); c2 = pack(190, 158, 70); }
          else if (gT < 0.45) { c1 = pack(142, 124, 84); c2 = pack(120, 158, 76); }
          else { c1 = pack(112, 164, 72); c2 = pack(86, 138, 58); }
          const dry = w.moist[i] < 0.16 && !snowy;
          if (dry) { c1 = pack(176, 150, 96); c2 = pack(160, 132, 84); }
          for (let py = 0; py < TILE; py++) {
            for (let px = 0; px < TILE; px++) {
              const stripe = ((horiz ? py : px) & 1) === 0;
              set(bx + px, by + py, stripe ? c1 : c2);
            }
          }
          // field boundaries
          const edge = pack(96, 84, 60);
          if (x > 0 && w.imp[i - 1] !== I_FARM) for (let py = 0; py < TILE; py++) set(bx, by + py, edge);
          if (y > 0 && w.imp[i - W] !== I_FARM) for (let px = 0; px < TILE; px++) set(bx + px, by, edge);
          if ((h1 & 15) === 0 && !snowy) { set(bx + 3, by + 3, pack(120, 84, 52)); set(bx + 3, by + 2, pack(170, 60, 50)); } // a barn
        } else if (imp === I_PASTURE && !snowy) {
          const fence = pack(140, 110, 76);
          if ((h1 & 1) === 0) { set(bx + 1, by + 6, fence); set(bx + 3, by + 6, fence); set(bx + 5, by + 6, fence); }
          if ((h2 & 3) === 0) { set(bx + 2 + (h1 & 3), by + 2 + (h2 >> 6), pack(238, 234, 220)); }
        } else if (imp === I_MINE) {
          const dark = pack(58, 52, 50);
          for (let py = 2; py < 6; py++) for (let px = 1; px < 7; px++) set(bx + px, by + py, (px + py) & 1 ? dark : pack(84, 76, 70));
          set(bx + 3, by + 3, ORE_COL[w.res[i]] || dark);
          set(bx + 4, by + 4, ORE_COL[w.res[i]] || dark);
          set(bx + 2, by + 1, pack(120, 92, 60)); set(bx + 5, by + 1, pack(120, 92, 60)); set(bx + 3, by + 1, pack(120, 92, 60)); set(bx + 4, by + 1, pack(120, 92, 60));
        } else if (imp === I_RUIN) {
          const st = pack(134, 130, 126), dk = pack(92, 90, 90);
          set(bx + 1, by + 5, st); set(bx + 1, by + 4, st); set(bx + 2, by + 5, dk); set(bx + 5, by + 3, st); set(bx + 5, by + 4, st); set(bx + 6, by + 4, dk);
          set(bx + 3, by + 6, st); set(bx + 4, by + 6, dk); if (h1 & 1) set(bx + 3, by + 2, st);
        } else if (w.res[i] && imp !== I_URBAN && (h1 & 3) === 0) {
          set(bx + 2 + (h2 & 3), by + 2 + ((h2 >> 2) & 3), ORE_COL[w.res[i]]);
        }
        }
        // --- roads ---
        const rd = w.road[i];
        if (phase === 1 && rd > 0 && imp !== I_URBAN) {
          const col = ROAD_COL[rd];
          let linked = false;
          const isRoad = (nx: number, ny: number) => {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
            const j = ny * W + nx;
            return w.road[j] > 0 || w.imp[j] === I_URBAN;
          };
          for (let d = 0; d < 8; d++) {
            const dx = [1, -1, 0, 0, 1, 1, -1, -1][d],
              dy = [0, 0, 1, -1, 1, -1, 1, -1][d];
            if (!isRoad(x + dx, y + dy)) continue;
            // a diagonal link is only drawn when there is no squared-off way round, to avoid lattices
            if (d >= 4 && (isRoad(x + dx, y) || isRoad(x, y + dy))) continue;
            line(bx + 4, by + 4, bx + 4 + dx * 4, by + 4 + dy * 4, col, rd >= 2 ? 2 : 1);
            linked = true;
          }
          if (!linked) set(bx + 4, by + 4, col);
          if (rd >= 3) { set(bx + 4, by + 4, pack(168, 150, 120)); if (h1 & 1) set(bx + 3, by + 4, pack(168, 150, 120)); } // sleepers
          if (w.river[i] > 20) { set(bx + 2, by + 3, pack(120, 96, 70)); set(bx + 6, by + 3, pack(120, 96, 70)); set(bx + 2, by + 5, pack(120, 96, 70)); set(bx + 6, by + 5, pack(120, 96, 70)); } // bridge rails
        }
        if (phase !== 2) continue;
        // --- towns ---
        if (imp === I_URBAN) {
          const s = sim.settlements.get(w.owner[i]);
          const civ = s ? sim.civs.get(s.civ) : undefined;
          if (s && civ) this.drawUrban(set, sim, s, civ, i, x, y, bx, by, h1, h2, snowy);
          continue;
        }
        // --- mountains & hills ---
        if (rel > MOUNTAIN) {
          const hh = Math.min(13, 5 + ((rel - MOUNTAIN) * 46) | 0);
          const ax = bx + 2 + (h1 & 3),
            base = by + 7;
          const volcano = w.volcanoes.indexOf(i) >= 0;
          const light = snowy ? pack(232, 236, 244) : pack(150, 142, 134),
            dark = snowy ? pack(168, 176, 196) : pack(96, 90, 92),
            cap = meanTemp(w, clim, i) < 6 || rel > PEAK ? snowCol : light;
          for (let r = 0; r < hh; r++) {
            const half = ((r * 0.72) | 0) + (r > 0 ? 1 : 0);
            const yy = base - hh + r;
            for (let dx = -half; dx <= half; dx++) {
              let col = dx < 0 || (dx === 0 && r < 2) ? light : dark;
              if (r < hh * 0.35 && cap === snowCol) col = dx <= 0 ? snowCol : pack(196, 204, 222);
              if (volcano && r < 2) col = pack(226, 84, 40);
              if (dx === -half && r > 2 && ((h2 >> (r & 3)) & 1)) col = shade(col, 0.9);
              set(ax + dx, yy, col);
            }
          }
        } else if (rel > HILL && w.forest[i] < 0.35) {
          const c = snowy ? pack(214, 220, 232) : shade(buf[(by + 4) * S + bx + 4], 0.82);
          const hx = bx + 1 + (h1 & 3),
            hy = by + 3 + (h2 & 1);
          set(hx, hy + 1, c); set(hx + 1, hy, c); set(hx + 2, hy, c); set(hx + 3, hy + 1, c);
          if (h2 & 2) { set(hx + 3, hy + 3, c); set(hx + 4, hy + 2, c); set(hx + 5, hy + 3, c); }
        }
        // --- trees ---
        const f = w.forest[i];
        if (f > 0.14 && imp !== I_FARM && imp !== I_MINE && rel < PEAK) {
          const nTrees = f > 0.72 ? 4 : f > 0.48 ? 3 : f > 0.28 ? 2 : 1;
          const fl = w.flora[i];
          const burnt = w.fire[i] > 0 || imp === I_SCORCHED;
          for (let t = 0; t < nTrees; t++) {
            const hh = ih(x * 31 + t * 17, y * 29 + t * 7);
            const ox = bx + ((hh & 3) + (t & 1) * 4) - (t === 3 ? 1 : 0),
              oy = by + ((hh >> 2) & 3) + (t >> 1) * 3 + 1;
            this.drawTree(set, ox, oy, fl, hh, snowy, T, month, burnt);
          }
          if (imp === I_CAMP && !snowy) { set(bx + 6, by + 6, pack(150, 112, 70)); set(bx + 5, by + 6, pack(170, 130, 84)); set(bx + 1, by + 6, pack(120, 90, 60)); }
        } else if (!snowy && imp === 0 && w.veg[i] > 0.45 && rel < HILL) {
          // meadow details: tufts, and flowers in spring
          if ((h1 & 7) === 0) set(bx + (h2 & 7), by + ((h2 >> 3) & 7), shade(buf[(by + 4) * S + bx + 4], 0.84));
          if (month >= 1 && month <= 3 && (h1 & 31) === 3) set(bx + ((h2 >> 2) & 7), by + (h2 & 7), (h2 & 64) ? pack(244, 226, 110) : pack(236, 160, 190));
        } else if (!snowy && w.moist[i] < 0.14 && (h1 & 31) === 5 && imp === 0) {
          // desert: a stone or a cactus
          if (meanTemp(w, clim, i) > 17 && (h2 & 1)) { set(bx + 3, by + 3, pack(84, 130, 70)); set(bx + 3, by + 4, pack(84, 130, 70)); set(bx + 4, by + 3, pack(84, 130, 70)); set(bx + 3, by + 2, pack(96, 146, 80)); }
          else set(bx + 2 + (h2 & 3), by + 4, pack(164, 150, 124));
        }
        if (w.fire[i] > 0) {
          set(bx + 2 + (h1 & 3), by + 3 + (h2 & 1), pack(250, 150, 40));
          set(bx + 3 + (h2 & 3), by + 5, pack(236, 80, 30));
        }
      }
    }
    // harbour piers on the water beside ports
    for (const s of sim.settlements.values()) {
      if (s.portTile < 0 || !s.alive) continue;
      const px = s.portTile % W,
        py = (s.portTile / W) | 0;
      if (px < cx0 - 1 || py < cy0 - 1 || px > cx0 + CHUNK || py > cy0 + CHUNK) continue;
      const civ = sim.civs.get(s.civ);
      if (!civ || (civ.mods.seaCap <= 0 && s.bld[B.port] === 0)) continue;
      const bx = (px - cx0 + 1) * TILE,
        by = (py - cy0 + 1) * TILE;
      const plank = pack(150, 114, 74), post = pack(92, 70, 50);
      const dx = Math.sign(s.x - px),
        dy = Math.sign(s.y - py);
      for (let k = 0; k < 7; k++) {
        const qx = bx + 4 + (dx === 0 ? 0 : dx * (3 - k)),
          qy = by + 4 + (dy === 0 ? 0 : dy * (3 - k));
        set(qx, qy, plank);
        if (dx === 0) set(qx + 1, qy, plank); else set(qx, qy + 1, plank);
        if (k % 3 === 0) set(qx + (dx === 0 ? -1 : 0), qy + (dy === 0 ? -1 : 0), post);
      }
      if (s.bld[B.port] > 0) { set(bx + 1, by + 1, plank); set(bx + 2, by + 1, plank); set(bx + 1, by + 2, post); set(bx + 6, by + 6, plank); set(bx + 5, by + 6, post); }
    }
    (toBack ? this.backCtx[c] : this.ctxs[c]).putImageData(this.img, -M, -M, M, M, CPX, CPX);
  }

  private drawTree(set: (x: number, y: number, c: number) => void, x: number, y: number, flora: number, hh: number, snowy: boolean, T: number, month: number, burnt: boolean): void {
    const trunk = pack(92, 68, 46);
    if (burnt) {
      set(x + 1, y + 3, pack(40, 36, 34)); set(x + 1, y + 2, pack(40, 36, 34)); set(x + 1, y + 1, pack(60, 50, 46)); set(x, y + 1, pack(40, 36, 34));
      return;
    }
    const v = (hh >> 4) & 3;
    if (flora < 11) {
      // conifer
      const g1 = snowy ? pack(214, 226, 232) : pack(38 + v * 4, 92 + v * 5, 62),
        g2 = pack(26 + v * 3, 70 + v * 4, 50);
      set(x + 1, y, g1);
      set(x, y + 1, g1); set(x + 1, y + 1, g2); set(x + 2, y + 1, g2);
      set(x + 1, y + 2, snowy ? g1 : g2);
      set(x, y + 3, g1); set(x + 1, y + 3, g2); set(x + 2, y + 3, g2);
      set(x + 1, y + 4, trunk);
    } else if (flora < 22) {
      // broadleaf, with autumn colour and bare winter crowns
      if (T < 1.5) {
        const br = pack(110, 92, 80);
        set(x + 1, y + 3, trunk); set(x + 1, y + 2, br); set(x, y + 1, br); set(x + 2, y + 1, br); set(x + 1, y, snowy ? pack(232, 236, 242) : br);
        return;
      }
      let g1 = pack(74 + v * 8, 146 + v * 6, 64),
        g2 = pack(52 + v * 5, 118 + v * 5, 52);
      if (month >= 7 && month <= 9 && T < 14) {
        const a = [pack(222, 142, 50), pack(206, 86, 46), pack(228, 190, 70), pack(170, 120, 50)][v];
        g1 = a;
        g2 = shade(a, 0.8);
      }
      set(x, y, g1); set(x + 1, y, g1); set(x + 2, y, g2);
      set(x, y + 1, g1); set(x + 1, y + 1, g2); set(x + 2, y + 1, g2);
      set(x + 1, y + 2, g2); set(x, y + 2, g2);
      set(x + 1, y + 3, trunk);
    } else {
      // tropical: palms and broad crowns
      const g1 = pack(44 + v * 6, 150 + v * 6, 78),
        g2 = pack(28 + v * 4, 116 + v * 5, 60);
      if (hh & 1) {
        set(x + 1, y + 1, g2); set(x, y, g1); set(x + 2, y, g1); set(x, y + 2, g2); set(x + 2, y + 2, g2); set(x + 1, y, g1);
        set(x + 1, y + 2, trunk); set(x + 1, y + 3, trunk); set(x + 1, y + 4, trunk);
      } else {
        set(x, y, g1); set(x + 1, y, g1); set(x + 2, y, g2); set(x + 3, y + 1, g2);
        set(x, y + 1, g1); set(x + 1, y + 1, g2); set(x + 2, y + 1, g2);
        set(x + 1, y + 2, g2); set(x + 2, y + 2, g2);
        set(x + 1, y + 3, trunk);
      }
    }
  }

  private drawUrban(set: (x: number, y: number, c: number) => void, sim: Sim, s: Settlement, civ: Civ, i: number, x: number, y: number, bx: number, by: number, h1: number, h2: number, snowy: boolean): void {
    const w = sim.world;
    const W = w.w;
    const era = civ.era;
    const cul = sim.cultures.get(civ.culture);
    const st = STYLES[cul ? cul.style % STYLES.length : 0];
    const center = i === s.tile;
    const dist2 = (x - s.x) * (x - s.x) + (y - s.y) * (y - s.y);
    // ground
    const ground = snowy ? pack(222, 226, 232) : era < 2 ? pack(152, 130, 98) : era < 5 ? pack(146, 140, 130) : pack(96, 98, 104);
    const ground2 = shade(ground, 0.92);
    for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++) set(bx + px, by + py, ih(x * 8 + px, y * 8 + py) & 3 ? ground : ground2);
    const ruined = s.damage > 0.25 && ((h1 + h2) & 7) < s.damage * 8;
    const rubble = pack(84, 80, 78);
    const civCol = CIV_COLORS[civ.color % CIV_COLORS.length];
    const banner = pack(civCol[0], civCol[1], civCol[2]);
    const house = (ox: number, oy: number, wdt: number, hgt: number, k: number) => {
      // a building whose foot is at (ox..ox+wdt-1, oy); rises upward `hgt` px
      if (ruined && (k & 1) === 0) { set(ox, oy, rubble); set(ox + 1, oy, shade(rubble, 1.2)); set(ox + 1, oy - 1, rubble); return; }
      let wall = pack(st.wall[0], st.wall[1], st.wall[2]),
        roof = pack(st.roof[0], st.roof[1], st.roof[2]);
      if (era === 0) { wall = pack(170, 140, 96); roof = pack(196, 168, 104); }
      else if (era === 5) { wall = pack(150, 86, 70); roof = pack(72, 66, 70); }
      else if (era === 6) { wall = (k & 1) ? pack(188, 190, 196) : pack(160, 164, 172); roof = pack(110, 114, 122); }
      else if (era >= 7) { wall = (k & 1) ? pack(120, 196, 220) : pack(92, 160, 200); roof = pack(210, 240, 250); }
      if (snowy) roof = pack(236, 240, 246);
      const dark = shade(wall, 0.72);
      for (let r = 0; r < hgt; r++) {
        for (let cx = 0; cx < wdt; cx++) {
          let col = cx === wdt - 1 ? dark : wall;
          if (r === hgt - 1) col = roof;
          else if (r === hgt - 2 && era > 0 && era < 6) col = cx === wdt - 1 ? shade(roof, 0.8) : roof;
          set(ox + cx, oy - r, col);
        }
      }
      if (era === 0) set(ox + 1, oy, pack(70, 50, 36));
      else if (era >= 6 && hgt > 2) {
        // lit windows
        for (let r = 1; r < hgt - 1; r += 2) if ((k >> r) & 1) set(ox, oy - r, pack(250, 226, 130));
      } else if (hgt > 2 && (k & 2)) set(ox, oy, pack(64, 48, 40));
      if (era === 5 && (k & 4)) { set(ox + wdt - 1, oy - hgt, pack(60, 56, 58)); }
    };
    const tall = dist2 < 3 ? 2 : dist2 < 9 ? 1 : 0;
    if (center) {
      // the heart of the settlement: its grandest building and its banner
      if (era === 0 && s.bld[B.temple] === 0) {
        house(bx + 1, by + 6, 3, 2, h1);
        house(bx + 5, by + 4, 3, 2, h2);
        set(bx + 4, by + 6, pack(250, 170, 50)); set(bx + 4, by + 5, pack(250, 220, 110)); // the fire
      } else if (s.bld[B.palace] > 0 || civ.capital === s.id) {
        const wall = era >= 6 ? pack(206, 208, 214) : pack(st.wall[0], st.wall[1], st.wall[2]);
        const roof = era >= 7 ? pack(200, 236, 250) : pack(st.roof[0], st.roof[1], st.roof[2]);
        for (let r = 0; r < 5; r++) for (let cx = 0; cx < 6; cx++) set(bx + 1 + cx, by + 7 - r, r === 4 ? roof : cx === 5 ? shade(wall, 0.72) : wall);
        set(bx + 1, by + 2, roof); set(bx + 6, by + 2, roof); set(bx + 1, by + 1, roof); set(bx + 6, by + 1, roof);
        set(bx + 3, by + 7, pack(60, 44, 36)); set(bx + 4, by + 7, pack(60, 44, 36));
        if (era >= 6) { set(bx + 2, by + 5, pack(250, 226, 130)); set(bx + 5, by + 5, pack(250, 226, 130)); }
      } else if (s.bld[B.temple] > 0) {
        const wh = pack(236, 230, 214), gold = pack(236, 196, 84);
        for (let cx = 0; cx < 5; cx++) { set(bx + 1 + cx, by + 3, gold); set(bx + 1 + cx, by + 7, shade(wh, 0.8)); }
        set(bx + 3, by + 2, gold);
        for (let r = 4; r < 7; r++) { set(bx + 1, by + r, wh); set(bx + 3, by + r, wh); set(bx + 5, by + r, wh); }
      } else {
        house(bx + 1, by + 7, 4, 4 + tall, h1);
        house(bx + 5, by + 5, 3, 3, h2);
      }
      // banner
      set(bx + 7, by + 3, pack(80, 70, 66)); set(bx + 7, by + 2, pack(80, 70, 66)); set(bx + 7, by + 1, pack(80, 70, 66)); set(bx + 7, by, pack(80, 70, 66));
      set(bx + 6, by, banner); set(bx + 5, by, banner); set(bx + 6, by + 1, banner); set(bx + 5, by + 1, banner);
    } else {
      // special quarters on fixed slots around the centre
      const slot = (x - s.x + 2) + (y - s.y + 2) * 5;
      if (slot === 7 && s.bld[B.market] > 0) {
        // market stalls with striped awnings
        for (let cx = 0; cx < 7; cx++) { set(bx + cx, by + 3, cx & 1 ? pack(214, 70, 60) : pack(240, 232, 214)); set(bx + cx, by + 6, cx & 1 ? pack(70, 130, 200) : pack(240, 232, 214)); }
        set(bx + 1, by + 4, pack(96, 76, 56)); set(bx + 5, by + 4, pack(96, 76, 56)); set(bx + 1, by + 7, pack(96, 76, 56)); set(bx + 5, by + 7, pack(96, 76, 56));
      } else if (slot === 17 && s.bld[B.temple] > 0) {
        const wh = pack(236, 230, 214), gold = pack(236, 196, 84);
        for (let cx = 0; cx < 5; cx++) set(bx + 1 + cx, by + 3, gold);
        set(bx + 3, by + 2, gold);
        for (let r = 4; r < 8; r++) { set(bx + 1, by + r, wh); set(bx + 3, by + r, wh); set(bx + 5, by + r, wh); }
      } else if (slot === 11 && (s.bld[B.library] > 0 || s.bld[B.school] > 0)) {
        const wl = pack(204, 196, 176), rf = pack(64, 96, 150);
        for (let r = 0; r < 4; r++) for (let cx = 0; cx < 6; cx++) set(bx + 1 + cx, by + 7 - r, r === 3 ? rf : cx === 5 ? shade(wl, 0.75) : wl);
        set(bx + 3, by + 3, rf); set(bx + 4, by + 3, rf); set(bx + 3, by + 7, pack(60, 44, 36));
      } else if (slot === 13 && s.bld[B.factory] > 0) {
        const br = pack(132, 74, 62), dk = pack(70, 62, 64);
        for (let r = 0; r < 4; r++) for (let cx = 0; cx < 7; cx++) set(bx + cx, by + 7 - r, r === 3 ? dk : cx === 6 ? shade(br, 0.7) : br);
        set(bx + 5, by + 3, dk); set(bx + 5, by + 2, dk); set(bx + 5, by + 1, dk); set(bx + 5, by, dk);
        set(bx + 1, by + 6, pack(250, 200, 110)); set(bx + 3, by + 6, pack(250, 200, 110));
      } else if (slot === 9 && s.bld[B.barracks] > 0) {
        const wl = pack(120, 112, 104);
        for (let r = 0; r < 3; r++) for (let cx = 0; cx < 6; cx++) set(bx + 1 + cx, by + 7 - r, r === 2 ? pack(84, 78, 76) : wl);
        set(bx + 1, by + 4, banner); set(bx + 6, by + 4, banner);
      } else {
        // ordinary houses: denser and taller toward the middle and in later ages
        const n = era === 0 ? 2 : 3 + (tall > 0 ? 1 : 0);
        const baseH = era === 0 ? 2 : era < 3 ? 3 : era < 5 ? 3 + (tall > 1 ? 1 : 0) : 3 + tall + (era >= 6 ? 1 + (h2 & 1) : 0);
        const wdt = era >= 6 ? 3 : era === 0 ? 3 : 2 + (h1 & 1);
        if (n >= 1) house(bx + (h1 & 1), by + 3 + ((h1 >> 1) & 1), wdt, Math.min(baseH, 4), h1);
        if (n >= 2) house(bx + 4 + ((h2 >> 2) & 1), by + 4 + ((h1 >> 3) & 1), wdt, Math.min(baseH, 5), h2);
        if (n >= 3) house(bx + 1 + ((h2 >> 4) & 1), by + 7, wdt, baseH, h1 >> 2);
        if (n >= 4) house(bx + 5, by + 7, 3, baseH + 1, h2 >> 3);
      }
    }
    // town walls along the outer edge
    const wl = s.bld[B.walls];
    if (wl > 0) {
      const stone = wl >= 3 ? pack(120, 120, 128) : wl === 2 ? pack(150, 150, 156) : pack(150, 124, 92);
      const top = shade(stone, 1.2);
      const out = (dx: number, dy: number) => {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= w.h) return true;
        const j = ny * W + nx;
        return !(w.imp[j] === I_URBAN && w.owner[j] === s.id);
      };
      if (out(0, -1)) for (let px = 0; px < TILE; px++) { set(bx + px, by, px & 1 ? top : stone); set(bx + px, by + 1, stone); }
      if (out(0, 1)) for (let px = 0; px < TILE; px++) { set(bx + px, by + 7, stone); set(bx + px, by + 6, px & 1 ? top : stone); }
      if (out(-1, 0)) for (let py = 0; py < TILE; py++) { set(bx, by + py, py & 1 ? top : stone); if (wl > 1) set(bx + 1, by + py, stone); }
      if (out(1, 0)) for (let py = 0; py < TILE; py++) { set(bx + 7, by + py, py & 1 ? top : stone); if (wl > 1) set(bx + 6, by + py, stone); }
    }
    if (w.fire[i] > 0) {
      set(bx + 2 + (h1 & 3), by + 2, pack(250, 170, 50));
      set(bx + 4, by + 4 + (h2 & 1), pack(236, 80, 30));
    }
  }
}
export { W_OCEAN };
