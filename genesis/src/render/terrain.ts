// Terrain rasterizer. The world is painted as chunky pixel art into cached 256×256 chunk canvases:
// every tile is a flat, crisp block of palette colour (8 px), with stepped terraces and shorelines,
// and everything that stands on the land — trees, peaks, houses, walls — is an outlined sprite that
// overlaps its neighbours. Colours follow the simulation: droughts yellow the grass, snow lines move
// with the seasons, forests are felled and regrow, fields ripen, towns change with their age.
import {
  B, Biome, Civ, I_CAMP, I_FARM, I_MINE, I_PASTURE, I_RUIN, I_SCORCHED, I_URBAN, Settlement, Sim, TICKS_PER_YEAR, W_LAKE, W_LAND,
} from '../sim/types';
import { HILL, MOUNTAIN, SEA, meanTemp, tempAt } from '../sim/world';
import { CIV_COLORS, STYLES } from './palette';
import * as SP from './sprites';

export const TILE = 8;
export const CHUNK = 32;
export const CPX = CHUNK * TILE;
const MT = 2; // margin in tiles, so sprites can overlap chunk edges
const M = MT * TILE;
const S = CPX + M * 2;
const R = CHUNK + MT * 2;

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
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) & 255;
}

// ---- the palette ----
const WATER_A = 214; // water is slightly see-through so the animated sea shimmers beneath
const C = {
  deep: pack(26, 68, 134, WATER_A), ocean: pack(34, 92, 164, WATER_A), mid: pack(46, 120, 190, WATER_A), shallow: pack(70, 154, 210, WATER_A),
  shore: pack(108, 192, 226, WATER_A), foam: pack(232, 246, 252), lake: pack(62, 142, 206, WATER_A), ice: pack(210, 232, 246),
  sand: pack(238, 222, 166), sandD: pack(214, 194, 136),
  lush: pack(96, 170, 70), grass: pack(124, 188, 82), dry: pack(172, 188, 100), parched: pack(216, 202, 138),
  savanna: pack(196, 190, 112), steppe: pack(186, 188, 124), dirt: pack(176, 144, 100),
  forest: pack(80, 150, 66), rain: pack(60, 138, 74), taiga: pack(96, 150, 104), swamp: pack(88, 138, 98),
  desert: pack(238, 208, 132), tundra: pack(180, 188, 154), snow: pack(242, 246, 252), snowD: pack(218, 228, 244),
  hill: pack(156, 166, 108), rock: pack(150, 148, 158), rockD: pack(112, 110, 126), mesa: pack(196, 166, 126), scorched: pack(74, 64, 58),
  bank: pack(128, 100, 74), soil: pack(152, 114, 74), soilD: pack(132, 98, 62),
  ink: pack(40, 36, 52), trunk: pack(104, 74, 50),
  river: pack(92, 176, 226), riverBank: pack(40, 104, 168), riverIce: pack(214, 234, 246),
};
const ORE_COL = [0, pack(206, 206, 214), pack(238, 142, 78), pack(190, 110, 94), pack(46, 44, 54), pack(255, 222, 84), pack(250, 250, 250), pack(134, 64, 180)];
const ROAD = [0, pack(210, 182, 132), pack(222, 210, 184), pack(78, 72, 82), pack(78, 72, 82)];
const ROAD_EDGE = [0, pack(140, 112, 76), pack(132, 120, 104), pack(48, 44, 54), pack(48, 44, 54)];

export class TerrainLayer {
  sim: Sim;
  cols: number;
  rows: number;
  canvases: HTMLCanvasElement[] = [];
  ctxs: CanvasRenderingContext2D[] = [];
  dirty: Uint8Array;
  private buf: Uint32Array;
  private img: ImageData;
  private pal = new Uint32Array(128);
  private base = new Uint32Array(R * R);
  private lvl = new Int8Array(R * R);
  private wat = new Uint8Array(R * R);

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
    if (this.sweeping) this.touched.fill(1);
  }

  markTile(i: number): void {
    const w = this.sim.world;
    const x = i % w.w,
      y = (i / w.w) | 0;
    const cx = (x / CHUNK) | 0,
      cy = (y / CHUNK) | 0;
    const mark = (c: number) => {
      this.dirty[c] = 1;
      if (this.sweeping) this.touched[c] = 1;
    };
    mark(cy * this.cols + cx);
    const lx = x % CHUNK,
      ly = y % CHUNK;
    // sprites and shore shading reach into neighbouring chunks
    if (lx <= 1 && cx > 0) mark(cy * this.cols + cx - 1);
    if (lx >= CHUNK - 2 && cx < this.cols - 1) mark(cy * this.cols + cx + 1);
    if (ly <= 2 && cy > 0) mark((cy - 1) * this.cols + cx);
    if (ly >= CHUNK - 2 && cy < this.rows - 1) mark((cy + 1) * this.cols + cx);
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
  private touched: Uint8Array = new Uint8Array(0);
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
      this.touched = new Uint8Array(n);
    }
    // 1. things that changed on the ground go straight to the visible set — but may use only part of
    //    the frame's budget, so a busy world can never starve the seasonal sweep below
    const share = this.sweeping ? budgetMs * 0.4 : budgetMs * 0.7;
    let over = false;
    for (let c = 0; c < n && !over; c++) {
      if (this.dirty[c] && visible(c)) {
        this.renderChunk(c);
        over = performance.now() - t0 > share;
      }
    }
    for (let c = 0, off = 0; c < n && off < 2 && !over; c++) {
      if (this.dirty[c]) {
        this.renderChunk(c);
        off++;
        over = performance.now() - t0 > share;
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
        this.touched.fill(0);
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
      const f = this.canvases,
        fc = this.ctxs;
      this.canvases = this.back;
      this.ctxs = this.backCtx;
      this.back = f;
      this.backCtx = fc;
      this.seasonTick = this.sweepTick;
      this.useMean = this.sweepMean;
      this.sweeping = false;
      this.lastSweep = performance.now();
      // chunks that changed while the sweep was under way were painted before the change: redo them
      for (let c = 0; c < n; c++) this.dirty[c] = this.touched[c];
    }
  }

  /** stamp a sprite into the pixel buffer; paint slots come from this.pal (set by the caller) */
  private stamp(s: SP.Sprite, x: number, y: number): void {
    const buf = this.buf,
      pal = this.pal;
    for (let sy = 0; sy < s.h; sy++) {
      const py = y + sy;
      if (py < 0 || py >= S) continue;
      for (let sx = 0; sx < s.w; sx++) {
        const ch = s.px[sy * s.w + sx];
        if (!ch) continue;
        const px = x + sx;
        if (px < 0 || px >= S) continue;
        const col = pal[ch];
        if (col) buf[py * S + px] = col;
      }
    }
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
    const cx0 = (c % this.cols) * CHUNK - MT,
      cy0 = ((c / this.cols) | 0) * CHUNK - MT;
    const buf = this.buf;
    const { base, lvl, wat, pal } = this;
    const month = mean ? 4 : Math.floor((tick % TICKS_PER_YEAR) / 4);
    const sea = w.seaLevel;
    const O = 111; // 'o'
    const ch = (s: string) => s.charCodeAt(0);
    // ---------- 1. one flat colour per tile ----------
    for (let ty = 0; ty < R; ty++) {
      const y = cy0 + ty;
      for (let tx = 0; tx < R; tx++) {
        const x = cx0 + tx;
        const k = ty * R + tx;
        lvl[k] = 0;
        if (x < 0 || y < 0 || x >= W || y >= H) {
          wat[k] = 1;
          base[k] = C.deep;
          continue;
        }
        const i = y * W + x;
        if (w.water[i] !== W_LAND) {
          wat[k] = 1;
          const T = TT(i);
          if (T < -7) base[k] = C.ice;
          else if (w.water[i] === W_LAKE) base[k] = C.lake;
          else {
            const d = sea - w.elev[i];
            base[k] = d < 0.025 ? C.shore : d < 0.06 ? C.shallow : d < 0.12 ? C.mid : d < 0.21 ? C.ocean : C.deep;
          }
          continue;
        }
        wat[k] = 0;
        const rel = w.elev[i] - sea + SEA;
        lvl[k] = Math.max(0, Math.floor((rel - SEA) / 0.045));
        const T = TT(i);
        const bio = w.biome[i];
        const v = w.veg[i],
          m = w.moist[i];
        let col: number;
        if (w.imp[i] === I_SCORCHED || w.fire[i] > 0) col = C.scorched;
        else if (T < -1 && (m > 0.1 || rel > MOUNTAIN)) col = (ih(x, y) & 3) === 0 ? C.snowD : C.snow;
        else {
          switch (bio) {
            case Biome.Beach: col = C.sand; break;
            case Biome.Ice: col = C.snow; break;
            case Biome.SnowPeak: case Biome.Mountain: case Biome.Volcano: col = C.rock; break;
            case Biome.Hills: col = v > 0.3 ? C.hill : m < 0.28 && meanTemp(w, clim, i) > 15 ? C.mesa : C.rock; break;
            case Biome.Tundra: col = C.tundra; break;
            case Biome.Taiga: col = C.taiga; break;
            case Biome.Forest: col = C.forest; break;
            case Biome.Rainforest: col = C.rain; break;
            case Biome.DryForest: col = C.forest; break;
            case Biome.Swamp: col = C.swamp; break;
            case Biome.Desert: col = C.desert; break;
            case Biome.Savanna: col = v > 0.5 ? C.dry : v > 0.22 ? C.savanna : C.parched; break;
            case Biome.Steppe: col = v > 0.3 ? C.steppe : C.parched; break;
            default: col = v > 0.62 && m > 0.45 ? C.lush : v > 0.36 ? C.grass : v > 0.18 ? C.dry : C.dirt;
          }
          // dormant grass in the cold months
          if (T < 4 && (col === C.grass || col === C.lush)) col = C.dry;
        }
        if (w.flood[i] > 0) col = C.shallow;
        base[k] = col;
      }
    }
    // ---------- 2. paint the tiles: flat blocks, a little texture, crisp edges ----------
    for (let ty = 0; ty < R; ty++) {
      for (let tx = 0; tx < R; tx++) {
        const k = ty * R + tx;
        const x = cx0 + tx,
          y = cy0 + ty;
        const bx = tx * TILE,
          by = ty * TILE;
        const h1 = ih(x * 7 + 3, y * 13 + 5),
          h2 = ih(x * 11 + 1, y * 5 + 9);
        let col = base[k];
        const isWater = wat[k] === 1;
        if (!isWater) {
          // terraces: higher ground is a touch lighter; one tile in four a touch darker for grain
          const f = 1 + Math.min(5, lvl[k]) * 0.014 - ((h1 & 3) === 0 ? 0.035 : 0);
          col = shade(col, f);
        }
        const row0 = by * S + bx;
        for (let py = 0; py < TILE; py++) {
          const o = row0 + py * S;
          buf[o] = col; buf[o + 1] = col; buf[o + 2] = col; buf[o + 3] = col;
          buf[o + 4] = col; buf[o + 5] = col; buf[o + 6] = col; buf[o + 7] = col;
        }
        const n = ty > 0 ? k - R : -1,
          s = ty < R - 1 ? k + R : -1,
          e = tx < R - 1 ? k + 1 : -1,
          wv = tx > 0 ? k - 1 : -1;
        if (isWater) {
          // foam where the sea meets the land
          if (base[k] !== C.ice) {
            if (n >= 0 && !wat[n]) for (let px = 0; px < TILE; px++) if (((px + h1) & 3) < 2) buf[row0 + S + px] = C.foam;
            if (s >= 0 && !wat[s]) for (let px = 0; px < TILE; px++) if (((px + h2) & 3) < 2) buf[row0 + 7 * S + px] = C.foam;
            if (wv >= 0 && !wat[wv]) for (let py = 0; py < TILE; py++) if (((py + h1) & 3) < 2) buf[row0 + py * S] = C.foam;
            if (e >= 0 && !wat[e]) for (let py = 0; py < TILE; py++) if (((py + h2) & 3) < 2) buf[row0 + py * S + 7] = C.foam;
            if (n >= 0 && !wat[n]) for (let px = 0; px < TILE; px++) buf[row0 + px] = shade(col, 0.72); // shadow under the bank
          }
          continue;
        }
        const b0 = base[k];
        // texture
        if (b0 === C.snow || b0 === C.snowD) {
          if ((h1 & 7) === 0) buf[row0 + ((h2 >> 3) & 7) * S + (h2 & 7)] = C.snowD;
        } else if (b0 === C.desert || b0 === C.parched) {
          if ((h1 & 3) === 0) {
            const ry = 1 + ((h2 >> 2) & 3),
              rx = h2 & 3;
            const hi = shade(col, 1.07);
            buf[row0 + ry * S + rx] = hi; buf[row0 + ry * S + rx + 1] = hi; buf[row0 + ry * S + rx + 2] = hi; buf[row0 + (ry + 1) * S + rx + 3] = hi;
          }
        } else if (b0 === C.rock || b0 === C.mesa) {
          const dk = shade(col, 0.84);
          buf[row0 + ((h1 >> 3) & 7) * S + (h1 & 7)] = dk;
          if (h2 & 1) buf[row0 + ((h2 >> 3) & 7) * S + (h2 & 7)] = shade(col, 1.1);
        } else if (b0 === C.swamp) {
          if ((h1 & 1) === 0) { const p = row0 + (2 + ((h2 >> 2) & 3)) * S + (1 + (h2 & 3)); buf[p] = pack(70, 122, 132); buf[p + 1] = pack(70, 122, 132); }
        } else if (b0 !== C.sand && b0 !== C.scorched && b0 !== C.dirt) {
          // grass tufts, and flowers in spring
          const dk = shade(col, 0.86);
          buf[row0 + ((h1 >> 3) & 7) * S + (h1 & 7)] = dk;
          if (h2 & 1) buf[row0 + ((h2 >> 3) & 7) * S + (h2 & 7)] = dk;
          if (month >= 1 && month <= 3 && (b0 === C.lush || b0 === C.grass) && (h1 & 15) === 3) buf[row0 + (1 + (h2 & 3)) * S + 2 + ((h2 >> 2) & 3)] = h2 & 64 ? pack(252, 232, 120) : pack(244, 168, 196);
        }
        // shoreline: a raised bank where the land drops into water
        const bank = b0 === C.sand ? C.sandD : b0 === C.snow || b0 === C.snowD ? pack(170, 186, 210) : C.bank;
        if (s >= 0 && wat[s]) {
          for (let px = 0; px < TILE; px++) { buf[row0 + 6 * S + px] = bank; buf[row0 + 7 * S + px] = shade(bank, 0.74); }
        }
        if (e >= 0 && wat[e]) for (let py = 0; py < TILE; py++) buf[row0 + py * S + 7] = shade(bank, 0.9);
        if (wv >= 0 && wat[wv]) for (let py = 0; py < TILE; py++) buf[row0 + py * S] = shade(col, 1.08);
        if (n >= 0 && wat[n]) for (let px = 0; px < TILE; px++) buf[row0 + px] = shade(col, 1.1);
        // terraces between land of different heights
        const L = lvl[k];
        if (s >= 0 && !wat[s] && lvl[s] < L) { const dk = shade(col, 0.74); for (let px = 0; px < TILE; px++) buf[row0 + 7 * S + px] = dk; }
        if (n >= 0 && !wat[n] && lvl[n] < L) { const lt = shade(col, 1.09); for (let px = 0; px < TILE; px++) buf[row0 + px] = lt; }
        if (e >= 0 && !wat[e] && lvl[e] < L) { const dk = shade(col, 0.86); for (let py = 0; py < TILE; py++) buf[row0 + py * S + 7] = dk; }
        if (wv >= 0 && !wat[wv] && lvl[wv] < L) { const lt = shade(col, 1.05); for (let py = 0; py < TILE; py++) buf[row0 + py * S] = lt; }
      }
    }
    const set = (x: number, y: number, col: number) => {
      if (x >= 0 && y >= 0 && x < S && y < S) buf[y * S + x] = col;
    };
    const blob = (x: number, y: number, col: number, r: number) => {
      for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) set(x + dx, y + dy, col);
    };
    const line = (x0: number, y0: number, x1: number, y1: number, col: number, r: number) => {
      const dx = Math.abs(x1 - x0),
        dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1,
        sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      const off = r >> 1;
      for (let guard = 0; guard < 64; guard++) {
        blob(x0 - off, y0 - off, col, r);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    };
    const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
    // ---------- 3. fields and pastures ----------
    for (let ty = 0; ty < R; ty++) {
      const y = cy0 + ty;
      if (y < 0 || y >= H) continue;
      for (let tx = 0; tx < R; tx++) {
        const x = cx0 + tx;
        if (x < 0 || x >= W) continue;
        const i = y * W + x;
        const imp = w.imp[i];
        if (imp !== I_FARM && imp !== I_PASTURE) continue;
        const bx = tx * TILE,
          by = ty * TILE;
        const T = TT(i);
        const snowy = T < -1;
        if (imp === I_FARM) {
          const gT = Math.max(0, Math.min(1, (T - 3) / 11));
          const owner = w.owner[i];
          const horiz = ((owner * 7 + ((x >> 2) + (y >> 2)) * 3) & 1) === 0;
          let c1 = C.soil, c2 = C.soilD, crop = 0;
          if (snowy) { c1 = C.snow; c2 = C.snowD; crop = pack(196, 184, 150); }
          else if (w.moist[i] < 0.14) { c1 = pack(198, 172, 116); c2 = pack(176, 150, 98); crop = pack(210, 196, 130); }
          else if (gT < 0.12) crop = pack(190, 166, 110); // stubble
          else if (month >= 6 && month <= 8 && meanTemp(w, clim, i) < 20) { c1 = pack(238, 202, 92); c2 = pack(214, 172, 66); crop = pack(252, 228, 130); }
          else if (gT < 0.45) crop = pack(120, 190, 84);
          else { c1 = pack(116, 186, 78); c2 = pack(88, 156, 62); crop = pack(160, 214, 104); }
          for (let py = 0; py < TILE; py++) {
            for (let px = 0; px < TILE; px++) {
              const a = horiz ? py : px,
                b = horiz ? px : py;
              let col = (a & 1) === 0 ? c1 : c2;
              if ((a & 1) === 0 && (b & 1) === ((a >> 1) & 1)) col = crop;
              set(bx + px, by + py, col);
            }
          }
          // hedges around the edge of each field block
          const hedge = snowy ? pack(150, 160, 170) : pack(92, 110, 60);
          if (!inMap(x, y - 1) || w.imp[i - W] !== I_FARM) for (let px = 0; px < TILE; px++) set(bx + px, by, hedge);
          if (!inMap(x - 1, y) || w.imp[i - 1] !== I_FARM) for (let py = 0; py < TILE; py++) set(bx, by + py, hedge);
          if (!inMap(x, y + 1) || w.imp[i + W] !== I_FARM) for (let px = 0; px < TILE; px++) set(bx + px, by + 7, shade(hedge, 0.8));
          if (!inMap(x + 1, y) || w.imp[i + 1] !== I_FARM) for (let py = 0; py < TILE; py++) set(bx + 7, by + py, shade(hedge, 0.8));
        } else if (!snowy) {
          // pasture: fence posts and a few animals
          const post = pack(132, 100, 66);
          const h = ih(x * 3 + 1, y * 7 + 2);
          for (let px = 1; px < TILE; px += 3) set(bx + px, by + 7, post);
          if ((h & 3) === 0) { set(bx + 2 + (h >> 5), by + 3, pack(246, 242, 232)); set(bx + 3 + (h >> 5), by + 3, pack(246, 242, 232)); set(bx + 2 + (h >> 5), by + 4, pack(60, 56, 60)); }
        }
      }
    }
    // ---------- 4. rivers, then roads: outlines first, then the fill, so joints stay clean ----------
    for (let pass = 0; pass < 4; pass++) {
      for (let ty = 0; ty < R; ty++) {
        const y = cy0 + ty;
        if (y < 0 || y >= H) continue;
        for (let tx = 0; tx < R; tx++) {
          const x = cx0 + tx;
          if (x < 0 || x >= W) continue;
          const i = y * W + x;
          if (w.water[i] !== W_LAND) continue;
          const bx = tx * TILE,
            by = ty * TILE;
          if (pass < 2) {
            if (w.river[i] === 0) continue;
            const f = w.flow[i];
            if (f < 0) continue;
            const fx = (f % W) - x,
              fy = ((f / W) | 0) - y;
            const th = w.river[i] > 110 ? 4 : w.river[i] > 45 ? 3 : 2;
            const toWater = w.water[f] !== W_LAND;
            const jx = (ih(x * 5 + 1, y * 3 + 2) % 3) - 1,
              jy = (ih(x * 3 + 7, y * 5 + 1) % 3) - 1;
            const kx = toWater ? 0 : (ih((x + fx) * 5 + 1, (y + fy) * 3 + 2) % 3) - 1,
              ky = toWater ? 0 : (ih((x + fx) * 3 + 7, (y + fy) * 5 + 1) % 3) - 1;
            const frozen = TT(i) < -6;
            if (pass === 0) line(bx + 4 + jx, by + 4 + jy, bx + 4 + fx * TILE + kx, by + 4 + fy * TILE + ky, frozen ? pack(160, 190, 216) : C.riverBank, th + 2);
            else line(bx + 4 + jx, by + 4 + jy, bx + 4 + fx * TILE + kx, by + 4 + fy * TILE + ky, frozen ? C.riverIce : C.river, th);
          } else {
            const rd = w.road[i];
            if (rd === 0 || w.imp[i] === I_URBAN) continue;
            const isRoad = (nx: number, ny: number) => {
              if (!inMap(nx, ny)) return false;
              const j = ny * W + nx;
              return w.road[j] > 0 || w.imp[j] === I_URBAN;
            };
            const wd = rd === 1 ? 2 : 3;
            for (let d = 0; d < 8; d++) {
              const dx = [1, -1, 0, 0, 1, 1, -1, -1][d],
                dy = [0, 0, 1, -1, 1, -1, 1, -1][d];
              if (!isRoad(x + dx, y + dy)) continue;
              if (d >= 4 && (isRoad(x + dx, y) || isRoad(x, y + dy))) continue;
              if (pass === 2) line(bx + 4, by + 4, bx + 4 + dx * 4, by + 4 + dy * 4, ROAD_EDGE[rd], wd + 2);
              else line(bx + 4, by + 4, bx + 4 + dx * 4, by + 4 + dy * 4, ROAD[rd], wd);
            }
            if (pass === 3) {
              if (rd >= 3) { set(bx + 3, by + 4, pack(176, 160, 130)); set(bx + 5, by + 4, pack(176, 160, 130)); set(bx + 4, by + 2, pack(176, 160, 130)); set(bx + 4, by + 6, pack(176, 160, 130)); }
              if (w.river[i] > 20) { // a bridge
                const rail = pack(120, 92, 62);
                for (let p = 1; p < 7; p++) { set(bx + p, by + 2, rail); set(bx + p, by + 6, rail); }
              }
            }
          }
        }
      }
    }
    // ---------- 5. everything that stands up, painted north to south ----------
    for (let ty = 0; ty < R; ty++) {
      const y = cy0 + ty;
      if (y < 0 || y >= H) continue;
      for (let tx = 0; tx < R; tx++) {
        const x = cx0 + tx;
        if (x < 0 || x >= W) continue;
        const i = y * W + x;
        if (w.water[i] !== W_LAND) continue;
        const bx = tx * TILE,
          by = ty * TILE;
        const k = ty * R + tx;
        const h1 = ih(x * 7 + 3, y * 13 + 5),
          h2 = ih(x * 11 + 1, y * 5 + 9);
        const imp = w.imp[i];
        if (imp === I_URBAN) {
          const st = sim.settlements.get(w.owner[i]);
          const civ = st ? sim.civs.get(st.civ) : undefined;
          if (st && civ) this.drawUrban(sim, st, civ, i, x, y, bx, by, h1, h2, TT(i) < -1);
          continue;
        }
        const rel = w.elev[i] - sea + SEA;
        const T = TT(i);
        const snowy = T < -1;
        const ground = base[k];
        pal[O] = C.ink;
        // --- mountains ---
        if (rel > MOUNTAIN) {
          const volcano = w.volcanoes.indexOf(i) >= 0;
          // peaks stand on a staggered lattice; between them the bare rock shows
          const slot = (x + (y & 1) * 2) % 3 === 0 && (y % 2 === 0 || rel > MOUNTAIN + 0.07);
          if (!volcano && !slot) {
            if ((h1 & 7) === 0) { pal[ch('a')] = shade(ground, 1.1); pal[ch('b')] = shade(ground, 0.8); pal[O] = shade(ground, 0.55); this.stamp(SP.ROCK, bx + 1 + (h2 & 1), by + 3); }
            continue;
          }
          const big = volcano || rel > MOUNTAIN + 0.04;
          const capped = snowy || meanTemp(w, clim, i) < 5 || rel > MOUNTAIN + 0.1;
          pal[ch('a')] = snowy ? pack(228, 234, 244) : pack(176, 170, 180);
          pal[ch('b')] = snowy ? pack(170, 182, 208) : pack(118, 112, 134);
          pal[ch('s')] = capped ? pack(248, 250, 254) : pack(196, 190, 198);
          pal[ch('S')] = capped ? pack(204, 214, 236) : pack(138, 132, 152);
          pal[ch('l')] = pack(250, 120, 40);
          pal[O] = pack(56, 52, 72);
          const sp = volcano ? SP.VOLCANO : big ? SP.MOUNTAIN : SP.MOUNTAIN_S;
          this.stamp(sp, bx + 4 - (sp.w >> 1) + ((h2 & 3) - 1), by + TILE - sp.h);
          continue;
        }
        if (imp === I_RUIN) {
          pal[ch('w')] = pack(176, 172, 168);
          pal[ch('W')] = pack(120, 116, 118);
          pal[O] = pack(70, 66, 72);
          this.stamp(SP.RUIN, bx, by + TILE - SP.RUIN.h);
          continue;
        }
        if (imp === I_MINE) {
          pal[ch('a')] = pack(160, 156, 166);
          pal[ch('b')] = pack(112, 108, 124);
          pal[ch('d')] = pack(30, 26, 36);
          this.stamp(SP.MINE, bx, by + TILE - SP.MINE.h);
          set(bx + 6, by + 7, ORE_COL[w.res[i]] || C.rock);
          set(bx + 7, by + 6, ORE_COL[w.res[i]] || C.rock);
          continue;
        }
        if (imp === I_FARM) {
          if ((h1 & 31) === 0 && !snowy) {
            pal[ch('r')] = pack(196, 72, 60); pal[ch('R')] = pack(150, 52, 46); pal[ch('w')] = pack(232, 222, 200); pal[ch('W')] = pack(190, 178, 156); pal[ch('d')] = pack(70, 50, 40);
            this.stamp(SP.BARN, bx, by + TILE - SP.BARN.h);
          }
          continue;
        }
        // --- trees ---
        const f = w.forest[i];
        const hasTree = f > 0.3 || (f > 0.13 && (h1 & 1) === 0);
        if (hasTree) {
          const burnt = w.fire[i] > 0 || imp === I_SCORCHED;
          const fl = w.flora[i];
          const ox = bx + ((y & 1) ? 2 : -1) + (h2 & 1),
            oyb = by + TILE - (h1 & 1);
          pal[ch('t')] = C.trunk;
          if (burnt) {
            pal[ch('t')] = pack(44, 38, 40);
            this.stamp(SP.TREE_BARE, ox + 1, oyb - SP.TREE_BARE.h);
          } else if (fl < 11) {
            pal[ch('a')] = snowy ? pack(240, 246, 252) : pack(78, 148, 104);
            pal[ch('b')] = snowy ? pack(140, 180, 176) : pack(50, 116, 84);
            pal[ch('c')] = pack(34, 86, 68);
            pal[O] = pack(22, 54, 50);
            this.stamp(SP.TREE_PINE, ox, oyb - SP.TREE_PINE.h);
          } else if (fl < 22) {
            if (T < 1.5) {
              pal[ch('t')] = snowy && (h2 & 2) ? pack(226, 232, 240) : pack(124, 104, 92);
              this.stamp(SP.TREE_BARE, ox + 1, oyb - SP.TREE_BARE.h);
            } else {
              let a = pack(132, 198, 88), b2 = pack(92, 164, 66), c2 = pack(64, 128, 56);
              pal[O] = pack(36, 78, 44);
              if (month >= 7 && month <= 9 && T < 14) {
                const v = (h2 >> 4) & 3;
                if (v === 0) { a = pack(250, 184, 70); b2 = pack(232, 138, 50); c2 = pack(190, 96, 42); }
                else if (v === 1) { a = pack(238, 118, 76); b2 = pack(210, 82, 58); c2 = pack(164, 58, 50); }
                else if (v === 2) { a = pack(252, 226, 102); b2 = pack(236, 194, 72); c2 = pack(198, 152, 58); }
                pal[O] = pack(98, 54, 40);
              }
              pal[ch('a')] = a; pal[ch('b')] = b2; pal[ch('c')] = c2;
              const sp = h2 & 4 ? SP.TREE_OAK : SP.TREE_OAK_B;
              this.stamp(sp, ox, oyb - sp.h);
            }
          } else {
            pal[O] = pack(24, 70, 52);
            if (w.coast[i] || (h2 & 12) === 0) {
              pal[ch('a')] = pack(134, 208, 96); pal[ch('b')] = pack(76, 166, 78); pal[ch('t')] = pack(156, 118, 74);
              this.stamp(SP.TREE_PALM, ox, oyb - SP.TREE_PALM.h);
            } else {
              pal[ch('a')] = pack(92, 192, 102); pal[ch('b')] = pack(54, 154, 84); pal[ch('c')] = pack(34, 114, 70);
              this.stamp(SP.TREE_JUNGLE, ox - 1, oyb - SP.TREE_JUNGLE.h);
            }
          }
          if (imp === I_CAMP && !snowy) { pal[ch('t')] = pack(176, 132, 84); pal[ch('T')] = pack(132, 96, 60); pal[O] = pack(70, 50, 36); this.stamp(SP.LOGS, bx + 2, by + 4); }
          continue;
        }
        // --- hills, and the small things on open ground ---
        if (rel > HILL && (h1 & 1) === 0) {
          pal[ch('a')] = shade(ground, 1.12); pal[ch('b')] = shade(ground, 0.82); pal[O] = shade(ground, 0.55);
          this.stamp(SP.HILL, bx - 1 + (h2 & 1), by + 3);
        } else if (w.res[i] && (h1 & 3) === 1) {
          pal[ch('a')] = pack(170, 166, 176); pal[ch('b')] = pack(120, 116, 132); pal[ch('x')] = ORE_COL[w.res[i]]; pal[O] = pack(60, 56, 72);
          this.stamp(SP.ORE, bx + 1, by + 3);
        } else if (!snowy && imp === 0) {
          if (ground === C.desert || ground === C.parched) {
            if ((h1 & 15) === 5 && meanTemp(w, clim, i) > 16) { pal[ch('a')] = pack(92, 156, 84); pal[O] = pack(40, 84, 50); this.stamp(SP.CACTUS, bx + 1, by); }
            else if ((h1 & 15) === 9) { pal[ch('a')] = pack(196, 176, 140); pal[ch('b')] = pack(160, 140, 110); pal[O] = pack(110, 92, 70); this.stamp(SP.ROCK, bx + 2, by + 3); }
          } else if ((ground === C.savanna || ground === C.dry || ground === C.steppe) && (h1 & 7) === 7) {
            pal[ch('a')] = pack(150, 176, 84); pal[ch('b')] = pack(118, 148, 68); pal[ch('c')] = pack(92, 120, 56); pal[O] = pack(62, 86, 44);
            this.stamp(SP.BUSH, bx + 1 + (h2 & 1), by + 3);
          } else if (ground === C.tundra && (h1 & 15) === 2) {
            pal[ch('a')] = pack(176, 172, 176); pal[ch('b')] = pack(132, 128, 140); pal[O] = pack(84, 80, 96); this.stamp(SP.ROCK, bx + 2, by + 3);
          }
        }
      }
    }
    // harbours: a pier on the water beside each port town
    for (const st of sim.settlements.values()) {
      if (st.portTile < 0 || !st.alive) continue;
      const px = st.portTile % W,
        py = (st.portTile / W) | 0;
      if (px < cx0 || py < cy0 || px >= cx0 + R || py >= cy0 + R) continue;
      const civ = sim.civs.get(st.civ);
      if (!civ || (civ.mods.seaCap <= 0 && st.bld[B.port] === 0)) continue;
      const bx = (px - cx0) * TILE,
        by = (py - cy0) * TILE;
      const plank = pack(176, 136, 88), post = pack(96, 70, 48);
      const dx = Math.sign(st.x - px),
        dy = Math.sign(st.y - py);
      for (let q = -1; q < 8; q++) {
        const qx = bx + 4 + (dx === 0 ? 0 : dx * (3 - q)),
          qy = by + 4 + (dy === 0 ? 0 : dy * (3 - q));
        blob(qx - 1, qy - 1, post, 3);
      }
      for (let q = -1; q < 8; q++) {
        const qx = bx + 4 + (dx === 0 ? 0 : dx * (3 - q)),
          qy = by + 4 + (dy === 0 ? 0 : dy * (3 - q));
        set(qx, qy, plank);
        if (dx === 0) set(qx + (q & 1 ? 0 : -1), qy, plank); else set(qx, qy + (q & 1 ? 0 : -1), plank);
      }
    }
    (toBack ? this.backCtx[c] : this.ctxs[c]).putImageData(this.img, -M, -M, M, M, CPX, CPX);
  }

  private drawUrban(sim: Sim, s: Settlement, civ: Civ, i: number, x: number, y: number, bx: number, by: number, h1: number, h2: number, snowy: boolean): void {
    const w = sim.world;
    const W = w.w;
    const buf = this.buf;
    const pal = this.pal;
    const ch = (c: string) => c.charCodeAt(0);
    const set = (px: number, py: number, col: number) => {
      if (px >= 0 && py >= 0 && px < S && py < S) buf[py * S + px] = col;
    };
    const era = civ.era;
    const cul = sim.cultures.get(civ.culture);
    const st = STYLES[cul ? cul.style % STYLES.length : 0];
    // ground: trodden earth, then cobbles, then asphalt
    const ground = snowy ? pack(232, 238, 246) : era < 2 ? pack(196, 168, 122) : era < 5 ? pack(190, 182, 166) : pack(126, 128, 138);
    const g2 = shade(ground, 0.9);
    for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++) set(bx + px, by + py, ((px * 3 + py * 5 + h1) & 7) === 0 ? g2 : ground);
    const isTown = (dx: number, dy: number) => {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= w.h) return false;
      const j = ny * W + nx;
      return w.imp[j] === I_URBAN && w.owner[j] === s.id;
    };
    // town walls: behind the houses on the north, west and east sides
    const wl = s.bld[B.walls];
    const stone = wl >= 3 ? pack(142, 142, 156) : wl === 2 ? pack(176, 174, 178) : pack(170, 136, 96);
    const stoneD = shade(stone, 0.68);
    if (wl > 0) {
      if (!isTown(0, -1)) for (let px = 0; px < TILE; px++) { set(bx + px, by, (px & 1) ? stone : stoneD); set(bx + px, by + 1, stone); set(bx + px, by + 2, stoneD); }
      if (!isTown(-1, 0)) for (let py = 0; py < TILE; py++) { set(bx, by + py, stoneD); set(bx + 1, by + py, stone); if (wl > 1) set(bx + 2, by + py, stoneD); }
      if (!isTown(1, 0)) for (let py = 0; py < TILE; py++) { set(bx + 7, by + py, stoneD); set(bx + 6, by + py, stone); if (wl > 1) set(bx + 5, by + py, stoneD); }
    }
    const civCol = CIV_COLORS[civ.color % CIV_COLORS.length];
    const flag = pack(civCol[0], civCol[1], civCol[2]);
    const dx = x - s.x,
      dy = y - s.y;
    const d2 = dx * dx + dy * dy;
    const wall = pack(st.wall[0], st.wall[1], st.wall[2]),
      roof = pack(st.roof[0], st.roof[1], st.roof[2]);
    pal[111] = pack(44, 38, 50);
    pal[ch('d')] = pack(74, 52, 40);
    pal[ch('f')] = flag;
    const ruined = s.damage > 0.25 && ((h1 + h2) & 7) < s.damage * 8;
    let sprite: SP.Sprite | null = null;
    if (i === s.tile) {
      // the heart of the settlement
      if (era === 0 && s.bld[B.temple] === 0) {
        pal[ch('r')] = pack(214, 180, 108); pal[ch('R')] = pack(176, 140, 80);
        sprite = SP.BIG_HUT;
      } else if ((civ.capital === s.id && civ.gov >= 2) || s.bld[B.palace] > 0) {
        pal[ch('w')] = era >= 6 ? pack(226, 228, 236) : shade(wall, 1.05); pal[ch('W')] = era >= 6 ? pack(176, 180, 196) : shade(wall, 0.74);
        pal[ch('g')] = era >= 5 ? pack(255, 228, 130) : pack(70, 84, 120);
        sprite = SP.KEEP;
      } else if (s.bld[B.temple] > 0) {
        pal[ch('y')] = pack(250, 212, 96); pal[ch('Y')] = pack(214, 168, 66); pal[ch('w')] = pack(246, 242, 230); pal[ch('W')] = pack(196, 190, 178); pal[ch('e')] = pack(90, 84, 100);
        sprite = SP.TEMPLE;
      } else {
        pal[ch('r')] = roof; pal[ch('R')] = shade(roof, 0.76); pal[ch('w')] = wall; pal[ch('W')] = shade(wall, 0.74); pal[ch('g')] = pack(84, 104, 140);
        sprite = SP.HOUSE_TALL;
      }
      this.stamp(sprite, bx + 4 - (sprite.w >> 1), by + TILE - sprite.h);
      if (sprite !== SP.KEEP) {
        // the banner of the realm
        for (let q = 0; q < 6; q++) set(bx + 8, by - 3 + q, pack(60, 52, 56));
        set(bx + 9, by - 3, flag); set(bx + 10, by - 3, flag); set(bx + 9, by - 2, flag); set(bx + 10, by - 2, flag); set(bx + 11, by - 2, flag);
      }
    } else if (dy === 0 && (dx === 1 || dx === -1)) {
      // the square beside the great building: a market if there is one, else a well
      if (dx === 1 && s.bld[B.market] > 0) {
        pal[ch('r')] = pack(226, 78, 66); pal[ch('s')] = pack(248, 240, 222); pal[ch('y')] = pack(250, 206, 90); pal[ch('g')] = pack(120, 190, 96);
        this.stamp(SP.MARKET, bx - 1, by + 1);
      } else {
        set(bx + 3, by + 4, pack(96, 110, 140)); set(bx + 4, by + 4, pack(96, 110, 140)); set(bx + 3, by + 3, pack(120, 100, 80)); set(bx + 4, by + 3, pack(120, 100, 80)); set(bx + 2, by + 4, pack(86, 70, 60)); set(bx + 5, by + 4, pack(86, 70, 60));
      }
    } else if (ruined) {
      pal[ch('w')] = pack(150, 146, 144); pal[ch('W')] = pack(100, 96, 100);
      this.stamp(SP.RUIN, bx, by + TILE - SP.RUIN.h);
    } else if (dx === 0 && dy === -2 && s.bld[B.temple] > 0 && isTown(0, 1)) {
      pal[ch('y')] = pack(250, 212, 96); pal[ch('Y')] = pack(214, 168, 66); pal[ch('w')] = pack(246, 242, 230); pal[ch('W')] = pack(196, 190, 178); pal[ch('e')] = pack(90, 84, 100);
      this.stamp(SP.TEMPLE, bx + 4 - (SP.TEMPLE.w >> 1), by + TILE - SP.TEMPLE.h);
    } else if (dx === 2 && dy === 0 && (s.bld[B.library] > 0 || s.bld[B.school] > 0)) {
      pal[ch('b')] = pack(84, 132, 200); pal[ch('B')] = pack(58, 96, 160); pal[ch('w')] = pack(236, 228, 208); pal[ch('W')] = pack(188, 178, 158); pal[ch('g')] = pack(84, 104, 140);
      this.stamp(SP.ACADEMY, bx - 1, by + TILE - SP.ACADEMY.h);
    } else if (dx === -2 && dy === 1 && s.bld[B.factory] > 0) {
      pal[ch('r')] = pack(92, 86, 96); pal[ch('R')] = pack(66, 62, 74); pal[ch('w')] = pack(170, 92, 76); pal[ch('W')] = pack(124, 64, 58); pal[ch('K')] = pack(74, 68, 78); pal[ch('g')] = pack(255, 214, 120);
      this.stamp(SP.FACTORY, bx + 4 - (SP.FACTORY.w >> 1), by + TILE - SP.FACTORY.h);
    } else if ((h1 & 15) === 0 && d2 > 2 && era < 6) {
      // a garden plot between the houses
      if (!snowy) { set(bx + 2, by + 3, pack(96, 160, 72)); set(bx + 3, by + 3, pack(120, 184, 84)); set(bx + 5, by + 5, pack(96, 160, 72)); set(bx + 4, by + 5, pack(236, 196, 90)); }
    } else {
      // an ordinary house, in the style of its people and its age
      const alt = (h2 & 3) === 0;
      let r = alt ? shade(roof, 1.14) : (h2 & 3) === 1 ? shade(roof, 0.88) : roof;
      let wc = wall;
      const tall = d2 < 5 ? 2 : d2 < 14 ? 1 : 0;
      if (era === 0) { sprite = SP.HUT; r = pack(210, 176, 104); }
      else if (era <= 2) sprite = tall > 1 && era === 2 ? SP.HOUSE_TALL : SP.HOUSE;
      else if (era <= 4) sprite = tall > 0 || (h1 & 3) === 0 ? SP.HOUSE_TALL : SP.HOUSE;
      else if (era === 5) { sprite = (h1 & 1) || tall > 0 ? SP.HOUSE_BRICK : SP.HOUSE_TALL; wc = (h2 & 1) ? pack(178, 98, 80) : pack(160, 84, 72); r = pack(96, 90, 100); }
      else if (era === 6) { sprite = tall > 0 || (h1 & 1) ? SP.BLOCK : SP.HOUSE_TALL; wc = (h2 & 1) ? pack(214, 216, 224) : pack(190, 194, 206); r = pack(120, 124, 136); }
      else { sprite = tall > 0 || (h1 & 1) ? SP.SPIRE : SP.BLOCK; wc = pack(206, 214, 226); r = pack(150, 160, 176); }
      if (snowy && era < 6) r = pack(238, 244, 250);
      pal[ch('r')] = r; pal[ch('R')] = shade(r, 0.76);
      pal[ch('w')] = wc; pal[ch('W')] = shade(wc, 0.74);
      pal[ch('K')] = pack(74, 68, 78);
      pal[ch('g')] = era >= 5 ? pack(255, 226, 130) : pack(84, 104, 140);
      pal[ch('h')] = pack(214, 246, 255); pal[ch('G')] = pack(70, 140, 200);
      if (era >= 7 && sprite === SP.SPIRE) pal[ch('g')] = pack(120, 204, 236);
      this.stamp(sprite, bx + 4 - (sprite.w >> 1) + ((y & 1) ? 0 : (h2 >> 6) & 1), by + TILE - sprite.h);
    }
    // the south wall stands in front of the houses
    if (wl > 0 && !isTown(0, 1)) {
      for (let px = 0; px < TILE; px++) { set(bx + px, by + 5, (px & 1) ? stone : stoneD); set(bx + px, by + 6, stone); set(bx + px, by + 7, stoneD); }
      if (dx === 0) { set(bx + 3, by + 6, pack(60, 44, 36)); set(bx + 4, by + 6, pack(60, 44, 36)); set(bx + 3, by + 7, pack(60, 44, 36)); set(bx + 4, by + 7, pack(60, 44, 36)); } // a gate
    }
  }
}
