// World helpers: tile math, water/hydrology recomputation, seasonal climate sampling, biome classification.
import { clamp, clamp01, noise3 } from './rng';
import { Biome, Climate, Sim, TICKS_PER_YEAR, W_LAKE, W_LAND, W_OCEAN, World } from './types';

export const SEA = 0.4;
export const HILL = 0.6;
export const MOUNTAIN = 0.72;
export const PEAK = 0.84;

export const DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
export const DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

export class MinHeap {
  keys: number[] = [];
  vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  clear(): void {
    this.keys.length = 0;
    this.vals.length = 0;
  }
  push(key: number, val: number): void {
    const k = this.keys,
      v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  /** pops the smallest; returns its value (key available via lastKey) */
  lastKey = 0;
  pop(): number {
    const k = this.keys,
      v = this.vals;
    const topV = v[0];
    this.lastKey = k[0];
    const lk = k.pop()!,
      lv = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return topV;
  }
}

export function allocWorld(seed: number, w: number, h: number): World {
  const n = w * h;
  return {
    seed, w, h, n,
    seaLevel: SEA,
    elev: new Float32Array(n),
    water: new Uint8Array(n),
    river: new Uint8Array(n),
    flow: new Int32Array(n).fill(-1),
    temp: new Float32Array(n),
    rain: new Float32Array(n),
    moist: new Float32Array(n),
    fert: new Float32Array(n),
    veg: new Float32Array(n),
    forest: new Float32Array(n),
    flora: new Int8Array(n),
    biome: new Uint8Array(n),
    res: new Uint8Array(n),
    resAmt: new Uint16Array(n),
    owner: new Int16Array(n).fill(-1),
    imp: new Uint8Array(n),
    road: new Uint8Array(n),
    fire: new Uint8Array(n),
    flood: new Uint8Array(n),
    coast: new Uint8Array(n),
    landmass: new Int16Array(n).fill(-1),
    volcanoes: [],
  };
}

/** Ocean = below sea level and connected to the map edge. Enclosed basins become lakes. Existing high lakes persist. */
export function recomputeWater(w: World): void {
  const { n, elev, water } = w;
  const W = w.w,
    H = w.h;
  const sea = w.seaLevel;
  const mark = new Uint8Array(n);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) {
    stack.push(x, (H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    stack.push(y * W, y * W + W - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    if (mark[i] || elev[i] >= sea) continue;
    mark[i] = 1;
    const x = i % W,
      y = (i / W) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - W);
    if (y < H - 1) stack.push(i + W);
  }
  for (let i = 0; i < n; i++) {
    if (mark[i]) water[i] = W_OCEAN;
    else if (elev[i] < sea) water[i] = W_LAKE;
    else if (water[i] === W_OCEAN) water[i] = W_LAND;
    // lakes above sea level (from hydrology or the player's brush) persist
  }
}

/** coast flags and connected-landmass ids */
export function recomputeCoast(w: World): void {
  const { n, water, coast, landmass } = w;
  const W = w.w,
    H = w.h;
  for (let i = 0; i < n; i++) {
    const x = i % W,
      y = (i / W) | 0;
    const me = water[i] !== W_LAND;
    let c = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX8[d],
        ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const other = water[ny * W + nx] !== W_LAND;
      if (other !== me) {
        c = 1;
        break;
      }
    }
    coast[i] = c;
  }
  landmass.fill(-1);
  let id = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (water[s] !== W_LAND || landmass[s] !== -1) continue;
    stack.push(s);
    landmass[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W,
        y = (i / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX8[d],
          ny = y + DY8[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (water[j] === W_LAND && landmass[j] === -1) {
          landmass[j] = id;
          stack.push(j);
        }
      }
    }
    id = (id + 1) & 0x7fff;
  }
}

/**
 * Priority-flood depression filling, then flow directions, accumulation and rivers.
 * `makeLakes` converts deep filled depressions to lake tiles (world generation only).
 */
export function recomputeHydrology(w: World, makeLakes: boolean): void {
  const { n, elev, water, rain, flow, river } = w;
  const W = w.w,
    H = w.h;
  const filled = new Float32Array(n);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) {
    filled[i] = elev[i];
    flow[i] = -1;
    river[i] = 0;
    if (water[i] === W_OCEAN) {
      done[i] = 1;
      if (w.coast[i]) heap.push(elev[i], i);
    }
  }
  // map-edge land also drains off-map
  for (let x = 0; x < W; x++) {
    for (const i of [x, (H - 1) * W + x]) if (!done[i]) { done[i] = 1; heap.push(elev[i], i); }
  }
  for (let y = 0; y < H; y++) {
    for (const i of [y * W, y * W + W - 1]) if (!done[i]) { done[i] = 1; heap.push(elev[i], i); }
  }
  const order: number[] = [];
  while (heap.size) {
    const i = heap.pop();
    const e = filled[i];
    order.push(i);
    const x = i % W,
      y = (i / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d],
        ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (done[j]) continue;
      done[j] = 1;
      if (filled[j] <= e) filled[j] = e + 0.00002;
      flow[j] = i;
      heap.push(filled[j], j);
    }
  }
  if (makeLakes) {
    for (let i = 0; i < n; i++) {
      if (water[i] === W_LAND && filled[i] - elev[i] > 0.012) water[i] = W_LAKE;
    }
  }
  // accumulate in reverse flood order (highest first)
  const acc = new Float32Array(n);
  for (let i = 0; i < n; i++) acc[i] = water[i] === W_OCEAN ? 0 : 0.15 + rain[i];
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    const f = flow[i];
    if (f >= 0) acc[f] += acc[i];
  }
  const thr = 14;
  for (let i = 0; i < n; i++) {
    if (water[i] !== W_LAND) continue;
    if (acc[i] > thr) river[i] = Math.min(255, 1 + Math.floor(34 * Math.log2(acc[i] / thr)));
  }
}

/** latitude 0 (equator, bottom of map) .. 1 (pole, top of map) */
export function latOf(w: World, i: number): number {
  return 1 - ((i / w.w) | 0) / (w.h - 1);
}

export function yearFrac(tick: number): number {
  return (tick % TICKS_PER_YEAR) / TICKS_PER_YEAR;
}

/** current air temperature at a tile (°C) including season and global climate */
export function tempAt(w: World, c: Climate, i: number, tick: number): number {
  const lat = latOf(w, i);
  const amp = 1.5 + 15 * lat + (w.water[i] === W_LAND ? 2 : -1);
  return w.temp[i] + c.tempOffset + amp * Math.cos(2 * Math.PI * (yearFrac(tick) - 0.375));
}

/** annual mean temperature at a tile including global climate */
export function meanTemp(w: World, c: Climate, i: number): number {
  return w.temp[i] + c.tempOffset;
}

/** multi-year regional rainfall anomaly, ~0.25 (severe drought) .. ~1.8 (deluge) */
export function rainAnomaly(w: World, c: Climate, x: number, y: number, tick: number, volatility: number): number {
  const yr = tick / TICKS_PER_YEAR;
  const a = noise3(x / 46, y / 46, yr / 7, w.seed + 911);
  const b = noise3(x / 19, y / 19, yr / 2.3, w.seed + 1777);
  const v = (a * 0.7 + b * 0.3 - 0.5) * 2; // -1..1
  return clamp(1 + v * 1.25 * volatility, 0.15, 2.2) * c.rainMult;
}

export function isSnowy(w: World, c: Climate, i: number, tick: number): boolean {
  return w.water[i] === W_LAND && tempAt(w, c, i, tick) < -1.5 && w.moist[i] > 0.12;
}

export function classifyBiome(w: World, c: Climate, i: number): number {
  const e = w.elev[i];
  const t = meanTemp(w, c, i);
  if (w.water[i] === W_OCEAN) {
    if (t < -9) return Biome.SeaIce;
    return e > w.seaLevel - 0.06 ? Biome.Shallows : Biome.Ocean;
  }
  if (w.water[i] === W_LAKE) return t < -12 ? Biome.SeaIce : Biome.Lake;
  const rel = e - w.seaLevel + SEA; // elevation relative to nominal sea level
  if (rel > PEAK) return t < 4 ? Biome.SnowPeak : Biome.Mountain;
  if (rel > MOUNTAIN) return t < -6 ? Biome.SnowPeak : Biome.Mountain;
  if (t < -10) return Biome.Ice;
  const m = w.moist[i];
  const f = w.forest[i];
  const v = w.veg[i];
  if (w.coast[i] && rel < SEA + 0.012 && f < 0.3 && t > 2) return Biome.Beach;
  if (t < -1) return Biome.Tundra;
  if (rel > HILL && f < 0.35) return Biome.Hills;
  if (t < 6) return f > 0.3 ? Biome.Taiga : t < 2.5 ? Biome.Tundra : m < 0.2 ? Biome.Steppe : Biome.Grassland;
  if (t < 19) {
    if (f > 0.4) return m > 0.8 && rel < SEA + 0.05 ? Biome.Swamp : Biome.Forest;
    if (m < 0.16 && v < 0.2) return Biome.Desert;
    if (m < 0.3) return Biome.Steppe;
    return Biome.Grassland;
  }
  if (f > 0.45) return m > 0.62 ? (m > 0.85 && rel < SEA + 0.04 ? Biome.Swamp : Biome.Rainforest) : Biome.DryForest;
  if (m < 0.17 && v < 0.22) return Biome.Desert;
  if (m < 0.42) return Biome.Savanna;
  return Biome.Grassland;
}

export function reclassifyAll(sim: Sim): void {
  const w = sim.world;
  for (let i = 0; i < w.n; i++) w.biome[i] = classifyBiome(w, sim.climate, i);
}

/** plant growth potential 0..1 for the tile right now (temperature vs. adapted flora, and water) */
export function growthPotential(w: World, c: Climate, i: number, tick: number): number {
  const t = tempAt(w, c, i, tick);
  const opt = w.flora[i];
  let tf: number;
  if (t < 2) tf = 0;
  else {
    // adapted flora tolerates a band around its optimum; all plants like 8..32
    const d = Math.abs(t - opt);
    tf = clamp01(1.15 - d / 16) * clamp01((t - 2) / 7) * clamp01((44 - t) / 8);
  }
  const mf = clamp01((w.moist[i] - 0.06) / 0.5);
  return tf * mf;
}

export function markDirty(sim: Sim, i: number): void {
  const rt = sim.rt;
  if (rt.allDirty) return;
  if (rt.dirty.length > 60000) {
    rt.allDirty = true;
    rt.dirty.length = 0;
    return;
  }
  rt.dirty.push(i);
}

export function inB(w: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w.w && y < w.h;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx,
    dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** visits tile indices within radius r of (cx,cy) */
export function forDisc(w: World, cx: number, cy: number, r: number, fn: (i: number, d: number) => void): void {
  const x0 = Math.max(0, Math.floor(cx - r)),
    x1 = Math.min(w.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)),
    y1 = Math.min(w.h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 <= r2) fn(y * w.w + x, Math.sqrt(d2));
    }
  }
}

export function hasFreshWater(w: World, i: number): boolean {
  if (w.river[i] > 0) return true;
  const x = i % w.w,
    y = (i / w.w) | 0;
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d],
      ny = y + DY8[d];
    if (!inB(w, nx, ny)) continue;
    const j = ny * w.w + nx;
    if (w.river[j] > 0 || w.water[j] === W_LAKE) return true;
  }
  return false;
}

export { clamp, clamp01 };
