// src/sim/rng.ts
var RNG = class {
  s;
  constructor(seed) {
    this.s = seed | 0;
  }
  /** uniform in [0,1) — mulberry32 */
  next() {
    this.s = this.s + 1831565813 | 0;
    let t = this.s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  range(a, b) {
    return a + this.next() * (b - a);
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** approx normal(0,1) */
  gauss() {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }
  /** index chosen proportionally to weights (all >= 0). Returns -1 if total is 0. */
  weighted(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
};
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function fbm(x, y, seed, octaves, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
function ridged(x, y, seed, octaves) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise2(x * freq, y * freq, seed + o * 733) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// src/sim/types.ts
var TICKS_PER_YEAR = 48;
var ADULT_AGE = 15;
var W_LAND = 0;
var W_OCEAN = 1;
var W_LAKE = 2;
var Biome = {
  Ocean: 0,
  Shallows: 1,
  Lake: 2,
  SeaIce: 3,
  Beach: 4,
  Ice: 5,
  Tundra: 6,
  Taiga: 7,
  Steppe: 8,
  Grassland: 9,
  Forest: 10,
  Swamp: 11,
  Desert: 12,
  Savanna: 13,
  DryForest: 14,
  Rainforest: 15,
  Hills: 16,
  Mountain: 17,
  SnowPeak: 18,
  Volcano: 19
};
var BIOME_NAMES = [
  "Ocean",
  "Shallows",
  "Lake",
  "Sea ice",
  "Beach",
  "Ice sheet",
  "Tundra",
  "Taiga",
  "Steppe",
  "Grassland",
  "Temperate forest",
  "Swamp",
  "Desert",
  "Savanna",
  "Dry forest",
  "Rainforest",
  "Hills",
  "Mountains",
  "Snow peaks",
  "Volcano"
];
var R_STONE = 1;
var R_COPPER = 2;
var R_IRON = 3;
var R_COAL = 4;
var R_GOLD = 5;
var R_SALT = 6;
var R_OIL = 7;
var I_NONE = 0;
var I_PASTURE = 2;
var I_CAMP = 4;
var I_URBAN = 5;
var G = { food: 0, wood: 1, stone: 2, copper: 3, iron: 4, coal: 5, gold: 6, salt: 7, oil: 8, tools: 9, weapons: 10, wares: 11 };
var NG = 12;
var GOOD_BASE = [1, 0.8, 1, 4, 5, 3, 20, 3, 6, 6, 10, 5];
var RES_GOOD = [-1, G.stone, G.copper, G.iron, G.coal, G.gold, G.salt, G.oil];
var J = {
  child: 0,
  farmer: 1,
  fisher: 2,
  hunter: 3,
  herder: 4,
  woodcutter: 5,
  miner: 6,
  artisan: 7,
  merchant: 8,
  soldier: 9,
  scholar: 10,
  priest: 11,
  official: 12,
  laborer: 13
};
var NJ = 14;
var NB = 14;
var F = { crown: 0, military: 1, guilds: 2, clergy: 3, commons: 4 };
var NF = 5;
var GOV = { band: 0, chiefdom: 1, monarchy: 2, oligarchy: 3, republic: 4, theocracy: 5, junta: 6, democracy: 7 };
var TITLE = { none: 0, ruler: 1, governor: 2, general: 3, highPriest: 4, noble: 5, heir: 6 };
var GOAL = { family: 0, wealth: 1, power: 2, knowledge: 3, glory: 4, faith: 5, wander: 6 };
var M = {
  born: 0,
  married: 1,
  child: 2,
  job: 3,
  migrated: 4,
  fled: 5,
  battle: 6,
  widowed: 7,
  lostChild: 8,
  founded: 9,
  ruler: 10,
  invented: 11,
  rebelled: 12,
  enriched: 13,
  ruined: 14,
  starved: 15,
  converted: 16,
  general: 17,
  conquered: 18,
  plague: 19,
  blessed: 20,
  cursed: 21,
  governor: 22,
  prophet: 23,
  friend: 24,
  rival: 25,
  wounded: 26,
  conscripted: 27,
  lostParent: 28,
  deposed: 29,
  heir: 30,
  settled: 31,
  priest: 32
};

// src/sim/world.ts
var SEA = 0.4;
var HILL = 0.6;
var MOUNTAIN = 0.72;
var PEAK = 0.84;
var DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
var DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
var MinHeap = class {
  keys = [];
  vals = [];
  get size() {
    return this.keys.length;
  }
  clear() {
    this.keys.length = 0;
    this.vals.length = 0;
  }
  push(key, val) {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = i - 1 >> 1;
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
  pop() {
    const k = this.keys, v = this.vals;
    const topV = v[0];
    this.lastKey = k[0];
    const lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (; ; ) {
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
};
function allocWorld(seed, w, h) {
  const n = w * h;
  return {
    seed,
    w,
    h,
    n,
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
    volcanoes: []
  };
}
function recomputeWater(w) {
  const { n, elev, water } = w;
  const W = w.w, H = w.h;
  const sea = w.seaLevel;
  const mark = new Uint8Array(n);
  const stack = [];
  for (let x = 0; x < W; x++) {
    stack.push(x, (H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    stack.push(y * W, y * W + W - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    if (mark[i] || elev[i] >= sea) continue;
    mark[i] = 1;
    const x = i % W, y = i / W | 0;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - W);
    if (y < H - 1) stack.push(i + W);
  }
  for (let i = 0; i < n; i++) {
    if (mark[i]) water[i] = W_OCEAN;
    else if (elev[i] < sea) water[i] = W_LAKE;
    else if (water[i] === W_OCEAN) water[i] = W_LAND;
  }
}
function recomputeCoast(w) {
  const { n, water, coast, landmass } = w;
  const W = w.w, H = w.h;
  for (let i = 0; i < n; i++) {
    const x = i % W, y = i / W | 0;
    const me = water[i] !== W_LAND;
    let c = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
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
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (water[s] !== W_LAND || landmass[s] !== -1) continue;
    stack.push(s);
    landmass[s] = id;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = i / W | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX8[d], ny = y + DY8[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (water[j] === W_LAND && landmass[j] === -1) {
          landmass[j] = id;
          stack.push(j);
        }
      }
    }
    id = id + 1 & 32767;
  }
}
function recomputeHydrology(w, makeLakes) {
  const { n, elev, water, rain, flow, river } = w;
  const W = w.w, H = w.h;
  const filled = new Float32Array(n);
  const done = new Uint8Array(n);
  const heap2 = new MinHeap();
  for (let i = 0; i < n; i++) {
    filled[i] = elev[i];
    flow[i] = -1;
    river[i] = 0;
    if (water[i] === W_OCEAN) {
      done[i] = 1;
      if (w.coast[i]) heap2.push(elev[i], i);
    }
  }
  for (let x = 0; x < W; x++) {
    for (const i of [x, (H - 1) * W + x]) if (!done[i]) {
      done[i] = 1;
      heap2.push(elev[i], i);
    }
  }
  for (let y = 0; y < H; y++) {
    for (const i of [y * W, y * W + W - 1]) if (!done[i]) {
      done[i] = 1;
      heap2.push(elev[i], i);
    }
  }
  const order = [];
  while (heap2.size) {
    const i = heap2.pop();
    const e = filled[i];
    order.push(i);
    const x = i % W, y = i / W | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (done[j]) continue;
      done[j] = 1;
      if (filled[j] <= e) filled[j] = e + 2e-5;
      flow[j] = i;
      heap2.push(filled[j], j);
    }
  }
  if (makeLakes) {
    for (let i = 0; i < n; i++) {
      if (water[i] === W_LAND && filled[i] - elev[i] > 0.012) water[i] = W_LAKE;
    }
  }
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
function meanTemp(w, c, i) {
  return w.temp[i] + c.tempOffset;
}
function classifyBiome(w, c, i) {
  const e = w.elev[i];
  const t = meanTemp(w, c, i);
  if (w.water[i] === W_OCEAN) {
    if (t < -9) return Biome.SeaIce;
    return e > w.seaLevel - 0.06 ? Biome.Shallows : Biome.Ocean;
  }
  if (w.water[i] === W_LAKE) return t < -12 ? Biome.SeaIce : Biome.Lake;
  const rel = e - w.seaLevel + SEA;
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
  if (f > 0.45) return m > 0.62 ? m > 0.85 && rel < SEA + 0.04 ? Biome.Swamp : Biome.Rainforest : Biome.DryForest;
  if (m < 0.17 && v < 0.22) return Biome.Desert;
  if (m < 0.42) return Biome.Savanna;
  return Biome.Grassland;
}
function reclassifyAll(sim) {
  const w = sim.world;
  for (let i = 0; i < w.n; i++) w.biome[i] = classifyBiome(w, sim.climate, i);
}
function markDirty(sim, i) {
  const rt = sim.rt;
  if (rt.allDirty) return;
  if (rt.dirty.length > 6e4) {
    rt.allDirty = true;
    rt.dirty.length = 0;
    return;
  }
  rt.dirty.push(i);
}
function inB(w, x, y) {
  return x >= 0 && y >= 0 && x < w.w && y < w.h;
}
function dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
function forDisc(w, cx, cy, r, fn) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(w.h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 <= r2) fn(y * w.w + x, Math.sqrt(d2));
    }
  }
}
function hasFreshWater(w, i) {
  if (w.river[i] > 0) return true;
  const x = i % w.w, y = i / w.w | 0;
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (!inB(w, nx, ny)) continue;
    const j = ny * w.w + nx;
    if (w.river[j] > 0 || w.water[j] === W_LAKE) return true;
  }
  return false;
}

// src/sim/worldgen.ts
var RAIN_BAND = [
  [0, 0.95],
  [0.12, 0.86],
  [0.26, 0.2],
  [0.34, 0.25],
  [0.48, 0.7],
  [0.63, 0.74],
  [0.8, 0.52],
  [1, 0.3]
];
function rainBand(lat) {
  for (let k = 1; k < RAIN_BAND.length; k++) {
    if (lat <= RAIN_BAND[k][0]) {
      const a = RAIN_BAND[k - 1], b = RAIN_BAND[k];
      return lerp(a[1], b[1], (lat - a[0]) / (b[0] - a[0]));
    }
  }
  return 0.22;
}
function generateWorld(opts) {
  const { seed } = opts;
  const W = opts.w, H = opts.h;
  const w = allocWorld(seed, W, H);
  const n = w.n;
  const rng = new RNG(seed ^ 2654435769);
  const scale = Math.sqrt(W * H / (256 * 160));
  const np = Math.max(7, Math.round(13 * scale + rng.int(4)));
  const px = [], py = [], pvx = [], pvy = [], pcont = [];
  for (let p = 0; p < np; p++) {
    px.push(rng.range(0.04, 0.96) * W);
    py.push(rng.range(0.06, 0.94) * H);
    const a = rng.range(0, Math.PI * 2);
    pvx.push(Math.cos(a));
    pvy.push(Math.sin(a));
    pcont.push(rng.chance(0.5) ? 1 : 0);
  }
  const raw = new Float32Array(n);
  const orogeny = new Float32Array(n);
  const fs = 1 / (64 * scale);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const wx = x + (fbm(x * fs * 1.7, y * fs * 1.7, seed + 11, 3) - 0.5) * 60 * scale;
      const wy = y + (fbm(x * fs * 1.7, y * fs * 1.7, seed + 23, 3) - 0.5) * 60 * scale;
      let d1 = 1e9, d2 = 1e9, p1 = 0, p2 = 0;
      for (let p = 0; p < np; p++) {
        const dx = wx - px[p], dy = (wy - py[p]) * 1.25;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          p2 = p1;
          d1 = d;
          p1 = p;
        } else if (d < d2) {
          d2 = d;
          p2 = p;
        }
      }
      d1 = Math.sqrt(d1);
      d2 = Math.sqrt(d2);
      const edge = (d2 - d1) / (26 * scale);
      let nx = px[p2] - px[p1], ny = py[p2] - py[p1];
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const conv = (pvx[p1] - pvx[p2]) * nx + (pvy[p1] - pvy[p2]) * ny;
      const cont = pcont[p1];
      const contBlend = lerp(cont, (pcont[p1] + pcont[p2]) / 2, clamp01(1 - edge));
      let e = 0.18 + contBlend * 0.34;
      e += (fbm(x * fs, y * fs, seed + 101, 5) - 0.5) * 0.62;
      const near = Math.exp(-edge * edge * 2.2);
      const rd = ridged(x * fs * 2.3, y * fs * 2.3, seed + 303, 4);
      let mt = 0;
      if (conv > 0) mt = near * conv * (0.25 + 0.75 * rd) * (pcont[p1] + pcont[p2] > 0 ? 0.52 : 0.3);
      else mt = near * conv * 0.1;
      e += mt;
      orogeny[i] = clamp01(near * Math.max(0, conv) * rd * 1.3 + Math.max(0, mt) * 1.5);
      e += Math.pow(ridged(x * fs * 1.1 + 40, y * fs * 1.1 - 17, seed + 517, 4), 2.2) * 0.16 * contBlend;
      e += (fbm(x * fs * 6, y * fs * 6, seed + 707, 3) - 0.5) * 0.1;
      const bx = Math.min(x, W - 1 - x) / (W * 0.13);
      const by = Math.min(y, H - 1 - y) / (H * 0.13);
      const border = clamp01(Math.min(bx, by));
      e -= (1 - border) * (1 - border) * 0.6;
      raw[i] = e;
    }
  }
  const tmp = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const wgt = dx === 0 && dy === 0 ? 4 : 1;
          s += raw[yy * W + xx] * wgt;
          c += wgt;
        }
      }
      tmp[y * W + x] = s / c;
    }
  }
  const sorted = Float32Array.from(tmp).sort();
  const q = sorted[Math.floor(n * (1 - clamp(opts.land, 0.12, 0.65)))];
  const lo = sorted[0], hi = sorted[n - 1];
  for (let i = 0; i < n; i++) {
    const e = tmp[i];
    if (e >= q) {
      const t = (e - q) / (hi - q + 1e-6);
      w.elev[i] = SEA + 2e-3 + Math.pow(t, 1.45) * 0.58;
    } else {
      const t = (q - e) / (q - lo + 1e-6);
      w.elev[i] = SEA - 2e-3 - Math.pow(t, 0.8) * 0.38;
    }
  }
  w.seaLevel = SEA;
  recomputeWater(w);
  recomputeCoast(w);
  for (let y = 0; y < H; y++) {
    const lat = 1 - y / (H - 1);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const alt = Math.max(0, w.elev[i] - SEA);
      w.temp[i] = 30 - 41 * Math.pow(lat, 1.5) - alt * 30 + (noise2(x / 23, y / 23, seed + 901) - 0.5) * 4;
    }
  }
  for (let y = 0; y < H; y++) {
    const lat = 1 - y / (H - 1);
    const band = rainBand(lat);
    const westerly = lat > 0.3 && lat < 0.72;
    let m = 1;
    let prev = -1;
    for (let k = 0; k < W; k++) {
      const x = westerly ? k : W - 1 - k;
      const i = y * W + x;
      if (w.water[i] !== W_LAND) {
        m = Math.min(1, m + 0.07);
        w.rain[i] = band;
      } else {
        const up = prev >= 0 ? Math.max(0, w.elev[i] - w.elev[prev]) : 0;
        const oro = Math.min(m, up * 5 * m);
        w.rain[i] = clamp01(band * (0.42 + 0.78 * m) + oro * 1.6 + (noise2(x / 15, y / 15, seed + 1201) - 0.5) * 0.24);
        m = Math.max(0.05, m * 0.99 - oro * 0.75);
      }
      prev = i;
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const a = w.rain[i];
        const up = y > 0 ? w.rain[i - W] : a;
        const dn = y < H - 1 ? w.rain[i + W] : a;
        const lf = x > 0 ? w.rain[i - 1] : a;
        const rt = x < W - 1 ? w.rain[i + 1] : a;
        tmp[i] = (a * 2 + up + dn + lf + rt) / 6;
      }
    }
    w.rain.set(tmp);
  }
  recomputeHydrology(w, true);
  recomputeCoast(w);
  recomputeHydrology(w, false);
  for (let i = 0; i < n; i++) {
    const x = i % W, y = i / W | 0;
    if (w.water[i] !== W_LAND) {
      w.veg[i] = 0.4 + 0.5 * noise2(x / 9, y / 9, seed + 1501);
      w.moist[i] = 1;
      continue;
    }
    const alt = w.elev[i] - SEA;
    let m = w.rain[i];
    if (w.river[i] > 0) m = Math.min(1, m + 0.25 + w.river[i] / 500);
    w.moist[i] = m;
    let f = 0.32 + 0.4 * fbm(x / 14, y / 14, seed + 1601, 3) + 0.25 * m - alt * 1.1;
    if (w.river[i] > 0) f += 0.22;
    f += orogeny[i] * 0.1;
    w.fert[i] = clamp(f, 0.03, 1);
    const t = w.temp[i];
    w.flora[i] = Math.round(clamp(t + 5, 4, 30));
    const warm = clamp01((t + 2) / 12);
    const grow = warm * clamp01((m - 0.06) / 0.5);
    w.veg[i] = clamp01(grow * (0.5 + 0.5 * w.fert[i]) * 1.1);
    const fn = fbm(x / 11, y / 11, seed + 1701, 3);
    let fo = clamp01((m - 0.36) * 2.4) * clamp01((t + 4) / 7) * (0.45 + fn * 0.9);
    if (w.elev[i] > MOUNTAIN) fo *= 0.15;
    w.forest[i] = clamp01(fo);
  }
  for (let i = 0; i < n; i++) {
    if (w.water[i] !== W_LAND) continue;
    const x = i % W, y = i / W | 0;
    const e = w.elev[i];
    const h = hash2(x, y, seed + 2001);
    const oro = orogeny[i];
    const blob = (s, sc) => fbm(x / sc, y / sc, seed + s, 2);
    let r = 0, amt = 0;
    if (e > HILL - 0.04 && blob(2101, 8) + oro * 0.35 > 0.66 && h < 0.3) {
      r = R_IRON;
      amt = 500 + h * 3e3;
    } else if (e > HILL - 0.07 && blob(2201, 7) + oro * 0.3 > 0.68 && h < 0.3) {
      r = R_COPPER;
      amt = 400 + h * 2500;
    } else if (e > HILL && blob(2301, 6) + oro * 0.4 > 0.8 && h < 0.2) {
      r = R_GOLD;
      amt = 150 + h * 1500;
    } else if (e < HILL && e > SEA + 0.015 && w.rain[i] > 0.38 && blob(2401, 9) > 0.64 && h < 0.2) {
      r = R_COAL;
      amt = 800 + h * 4e3;
    } else if (w.rain[i] < 0.3 && e < HILL - 0.05 && blob(2501, 7) > 0.6 && h < 0.16) {
      r = R_SALT;
      amt = 500 + h * 3e3;
    } else if (w.coast[i] && w.temp[i] > 14 && w.rain[i] < 0.42 && h < 0.07) {
      r = R_SALT;
      amt = 400 + h * 4e3;
    } else if (e < HILL - 0.06 && blob(2601, 10) > 0.7 && h < 0.14) {
      r = R_OIL;
      amt = 1e3 + h * 6e3;
    } else if (blob(2701, 5) > 0.7 && e < HILL && w.rain[i] > 0.6 && h < 0.05) {
      r = R_IRON;
      amt = 300 + h * 2e3;
    } else if (e > HILL - 0.02 && h > 0.72) {
      r = R_STONE;
      amt = 2e3 + h * 4e3;
    } else if (h > 0.985) {
      r = R_STONE;
      amt = 1500;
    }
    w.res[i] = r;
    w.resAmt[i] = Math.min(65535, Math.round(amt * 4));
  }
  const cand = [];
  for (let i = 0; i < n; i++) if (w.water[i] === W_LAND && orogeny[i] > 0.55 && w.elev[i] > MOUNTAIN) cand.push(i);
  rng.shuffle(cand);
  const nv = Math.min(cand.length, Math.max(2, Math.round(5 * scale)));
  for (let k = 0; k < cand.length && w.volcanoes.length < nv; k++) {
    const i = cand[k];
    const x = i % W, y = i / W | 0;
    let ok = true;
    for (const v of w.volcanoes) if (Math.hypot(v % W - x, (v / W | 0) - y) < 18 * scale) ok = false;
    if (ok) w.volcanoes.push(i);
  }
  return w;
}

// src/sim/history.ts
function addEvent(sim, kind, imp, text, civs, people, settlement, x, y) {
  const e = { id: sim.nextId++, t: sim.tick, kind, imp, text, civs, people, settlement, x, y };
  sim.history.push(e);
  if (sim.history.length > 9e3) pruneHistory(sim);
  return e;
}
function pruneHistory(sim) {
  const cutoff = sim.tick - 40 * TICKS_PER_YEAR;
  sim.history = sim.history.filter((e) => e.imp >= 3 || e.imp === 2 && e.t > cutoff - 200 * TICKS_PER_YEAR || e.t > cutoff);
  if (sim.history.length > 8e3) sim.history = sim.history.filter((e) => e.imp >= 3 || e.t > cutoff);
  if (sim.history.length > 8e3) sim.history.splice(0, sim.history.length - 7e3);
}
function remember(p, tick, code, ref) {
  p.mem.push(tick, code, ref);
  if (p.mem.length > 60) p.mem.splice(3, 3);
}
function newStats() {
  return { year: [], pop: [], civs: [], settlements: [], wars: [], temp: [], forest: [], animals: [], food: [], wealth: [], tech: [], trade: [], civPop: /* @__PURE__ */ new Map() };
}
function sampleStats(sim) {
  const st = sim.stats;
  const w = sim.world;
  const year = Math.floor(sim.tick / TICKS_PER_YEAR);
  let forest = 0, land = 0;
  for (let i = 0; i < w.n; i += 3) {
    if (w.water[i] === W_LAND) {
      land++;
      forest += w.forest[i];
    }
  }
  let animals = 0;
  for (const h of sim.herds.values()) animals += h.n;
  let food = 0, wealth = 0, trade = 0, nset = 0;
  for (const s of sim.settlements.values()) {
    if (!s.alive) continue;
    nset++;
    food += s.stock[G.food];
    trade += s.tradeVol;
  }
  for (const p of sim.people.values()) wealth += p.wealth;
  let civs = 0, tech = 0;
  for (const c of sim.civs.values()) {
    if (!c.alive) continue;
    civs++;
    let k = 0;
    for (let i = 0; i < c.tech.length; i++) if (c.tech[i] === 1) k++;
    if (k > tech) tech = k;
    let arr = st.civPop.get(c.id);
    if (!arr) st.civPop.set(c.id, arr = []);
    arr.push(year, c.pop);
  }
  let wars = 0;
  for (const wr of sim.wars.values()) if (wr.end < 0) wars++;
  st.year.push(year);
  st.pop.push(sim.people.size);
  st.civs.push(civs);
  st.settlements.push(nset);
  st.wars.push(wars);
  st.temp.push(Math.round(sim.climate.tempOffset * 100) / 100);
  st.forest.push(land ? Math.round(forest / land * 1e3) / 1e3 : 0);
  st.animals.push(animals);
  st.food.push(Math.round(food));
  st.wealth.push(Math.round(wealth));
  st.tech.push(tech);
  st.trade.push(Math.round(trade));
  if (st.year.length > 1600) {
    const keys = ["year", "pop", "civs", "settlements", "wars", "temp", "forest", "animals", "food", "wealth", "tech", "trade"];
    for (const k of keys) {
      const a = st[k];
      const half = a.length >> 1;
      const thin = [];
      for (let i = 0; i < half; i += 2) thin.push(a[i]);
      st[k] = thin.concat(a.slice(half));
    }
  }
}

// src/sim/climate.ts
function initClimate(seed) {
  const f = (k) => (Math.imul(seed + k * 7919, 2654435761) >>> 0) % 1e3 / 1e3 * Math.PI * 2;
  return { tempOffset: 0, drift: 0, rainMult: 1, co2: 0, dust: 0, godTemp: 0, godRain: 1, seaBase: SEA, phases: [f(1), f(2), f(3)] };
}

// src/sim/names.ts
var CONS = ["p", "t", "k", "b", "d", "g", "m", "n", "s", "z", "sh", "th", "f", "v", "h", "l", "r", "y", "w", "ch", "j", "kh", "ts", "q", "x", "br", "dr", "kr", "tr", "st", "sk", "gl", "vr"];
var VOWS = ["a", "e", "i", "o", "u"];
var DIPH = ["ae", "ai", "ou", "ia", "ei", "au", "ee", "y", "oa"];
var CODAS = ["n", "r", "l", "s", "m", "th", "k", "sh", "d", "x", "rn", "nd", "ng", "st", "t", "rk", "ld", "ss"];
var PLACE_SUF = ["a", "ar", "en", "os", "ia", "um", "eth", "ora", "gard", "ton", "holm", "ak", "ur", "esh", "ana", "mar", "dun", "heim", "pol", "abad", "wick", "ford", "is", "ost", "ika", "var", "tal", "kesh", "mouth", "zan"];
var MALE_SUF = ["", "o", "us", "an", "ar", "ik", "or", "en", "ek", "im", "ul", "as", "ir", "und", "ric"];
var FEM_SUF = ["a", "e", "i", "ia", "ys", "ra", "el", "ina", "eth", "wen", "ane", "isa", "iel", "ue", "ali"];
var SHIFTS = [["p", "b"], ["k", "g"], ["t", "d"], ["s", "sh"], ["t", "th"], ["k", "kh"], ["b", "v"], ["g", "h"], ["s", "z"], ["d", "j"], ["f", "h"], ["l", "r"], ["r", "l"], ["ch", "ts"], ["v", "w"], ["q", "k"], ["x", "kh"]];
function sample(rng, pool, k) {
  const a = pool.slice();
  rng.shuffle(a);
  return a.slice(0, k);
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function genLanguage(sim, parent = -1) {
  const rng = sim.rng;
  const id = sim.nextId++;
  let lang;
  const p = parent >= 0 ? sim.languages.get(parent) : void 0;
  if (p) {
    let cons = p.cons.slice();
    const nshift = 1 + rng.int(3);
    for (let k = 0; k < nshift; k++) {
      const [a, b] = rng.pick(SHIFTS);
      cons = cons.map((c) => c === a ? b : c);
    }
    cons = Array.from(new Set(cons));
    if (rng.chance(0.6)) cons.push(rng.pick(CONS));
    const vowels = p.vowels.slice();
    if (rng.chance(0.5)) vowels[rng.int(vowels.length)] = rng.pick(rng.chance(0.3) ? DIPH : VOWS);
    const placeSuf = p.placeSuf.slice();
    placeSuf[rng.int(placeSuf.length)] = rng.pick(PLACE_SUF);
    const maleSuf = p.maleSuf.slice();
    maleSuf[rng.int(maleSuf.length)] = rng.pick(MALE_SUF);
    const femSuf = p.femSuf.slice();
    femSuf[rng.int(femSuf.length)] = rng.pick(FEM_SUF);
    lang = { id, name: "", parent, cons: Array.from(new Set(cons)), vowels: Array.from(new Set(vowels)), codas: p.codas.slice(), pat: p.pat.slice(), placeSuf, maleSuf, femSuf };
  } else {
    lang = {
      id,
      name: "",
      parent: -1,
      cons: sample(rng, CONS, 7 + rng.int(6)),
      vowels: sample(rng, VOWS, 3 + rng.int(3)).concat(rng.chance(0.6) ? [rng.pick(DIPH)] : []),
      codas: sample(rng, CODAS, 3 + rng.int(4)),
      pat: [String(Math.round(15 + rng.next() * 45))],
      // chance (in %) that a syllable is closed by a coda
      placeSuf: sample(rng, PLACE_SUF, 4 + rng.int(3)),
      maleSuf: sample(rng, MALE_SUF, 4),
      femSuf: sample(rng, FEM_SUF, 4)
    };
  }
  sim.languages.set(id, lang);
  lang.name = cap(word(lang, rng, 2, 2)) + rng.pick(["ic", "ish", "i", "ese", "an", "ar"]);
  return lang;
}
function syllable(l, rng, first, last) {
  const coda = Number(l.pat[0]) / 100;
  let s = first && rng.chance(0.18) ? "" : rng.pick(l.cons);
  s += rng.pick(l.vowels);
  if (rng.chance(last ? coda : coda * 0.35)) s += rng.pick(l.codas);
  return s;
}
function word(l, rng, minSyl, maxSyl) {
  const ns = minSyl + rng.int(maxSyl - minSyl + 1);
  let s = "";
  for (let k = 0; k < ns; k++) s += syllable(l, rng, k === 0, k === ns - 1);
  s = s.replace(/(.)\1\1+/g, "$1$1").replace(/([aeiouy]{2})[aeiouy]+/g, "$1");
  if (s.length > 9) s = s.slice(0, 9).replace(/[^aeiouy]{2,}$/, (m) => m[0]);
  return s;
}
function unique(sim, base, make) {
  let name = base;
  for (let tries = 0; tries < 6 && sim.usedNames.has(name); tries++) name = make();
  const c = sim.usedNames.get(name) || 0;
  sim.usedNames.set(name, c + 1);
  return c > 0 ? `${name} ${["II", "III", "IV", "V", "VI", "VII", "VIII"][Math.min(6, c - 1)]}` : name;
}
function givenName(sim, langId, sex) {
  const l = sim.languages.get(langId);
  const rng = sim.rng;
  let s = word(l, rng, 1, 2);
  if (s.length < 3) s += syllable(l, rng, false, true);
  const suf = rng.pick(sex === 1 ? l.maleSuf : l.femSuf);
  if (suf && /[aeiouy]$/.test(s) && /^[aeiouy]/.test(suf)) s = s.replace(/[aeiouy]+$/, "");
  s += suf;
  return cap(s);
}
function familyName(sim, langId) {
  const l = sim.languages.get(langId);
  const rng = sim.rng;
  const mk = () => cap(word(l, rng, 2, 2));
  return unique(sim, mk(), mk);
}
function placeName(sim, langId) {
  const l = sim.languages.get(langId);
  const rng = sim.rng;
  const mk = () => {
    let b = word(l, rng, 1, 2);
    const suf = rng.pick(l.placeSuf);
    if (/[aeiouy]$/.test(b) && /^[aeiouy]/.test(suf)) b = b.replace(/[aeiouy]+$/, "") || b;
    return cap(b + suf);
  };
  return unique(sim, mk(), mk);
}
function rootName(sim, langId) {
  const l = sim.languages.get(langId);
  const rng = sim.rng;
  const mk = () => cap(word(l, rng, 2, 3));
  return unique(sim, mk(), mk);
}
function demonym(root) {
  const last = root[root.length - 1];
  if ("aeiou".includes(last)) return root + "n";
  if (last === "n" || last === "r") return root + "i";
  if (last === "s" || last === "h") return root + "ite";
  return root + "ian";
}
var SP_ADJ_COLD = ["Frost", "Snow", "Ice", "Boreal", "Pale", "Winter", "Woolly"];
var SP_ADJ_TEMP = ["Meadow", "Hill", "Wood", "River", "Grey", "Red", "Dusk", "Moss"];
var SP_ADJ_HOT = ["Dune", "Sun", "Sand", "Jungle", "Ember", "Golden", "Mist", "Thorn"];
var SP_NOUN = [
  ["Elk", "Aurochs", "Antelope", "Bison", "Tarpan", "Ibex", "Mouflon", "Gaur", "Oryx", "Saiga"],
  ["Wolf", "Lion", "Bear", "Lynx", "Hyena", "Panther", "Dhole", "Sabrecat"],
  ["Hare", "Fox", "Boar", "Marmot", "Badger", "Tapir"],
  ["Mammoth", "Rhino", "Groundsloth", "Titanox", "Behemoth"],
  ["Moa", "Crane", "Ostrich", "Terrorbird"]
];
function speciesName(sim, shape, temp) {
  const rng = sim.rng;
  const adj = temp < 5 ? SP_ADJ_COLD : temp < 19 ? SP_ADJ_TEMP : SP_ADJ_HOT;
  const mk = () => `${rng.pick(adj)} ${rng.pick(SP_NOUN[shape] || SP_NOUN[0])}`;
  return unique(sim, mk(), mk);
}

// src/sim/ecology.ts
function createSpecies(sim, init) {
  const sp = {
    id: sim.nextId++,
    name: init.name || speciesName(sim, init.shape, init.cold),
    parent: init.parent ?? -1,
    born: sim.tick,
    extinct: -1,
    diet: init.diet,
    size: init.size,
    speed: init.speed,
    cold: init.cold,
    fecund: init.fecund ?? 0.5,
    fierce: init.fierce ?? (init.diet === 1 ? 0.7 : 0.2),
    herd: init.herd ?? (init.diet === 1 ? 6 : 24),
    color: init.color ?? speciesColor(sim, init.diet, init.cold, init.size),
    shape: init.shape,
    domestic: init.domestic ?? (init.diet === 0 && init.size > 0.25 && init.size < 0.75 && (init.fierce ?? 0.2) < 0.45),
    ridable: init.ridable ?? (init.diet === 0 && init.speed > 0.6 && init.size > 0.4 && init.size < 0.75),
    count: 0,
    made: init.made ?? false
  };
  sim.species.set(sp.id, sp);
  return sp;
}
function speciesColor(sim, diet, cold, size) {
  const r = sim.rng;
  const pale = clamp01((12 - cold) / 22);
  let cr = diet === 1 ? 120 : 150, cg = diet === 1 ? 90 : 115, cb = diet === 1 ? 80 : 75;
  cr += r.int(50) - 25 + pale * 70;
  cg += r.int(40) - 20 + pale * 80;
  cb += r.int(40) - 20 + pale * 100 - size * 20;
  return clamp(cr, 30, 250) << 16 | clamp(cg, 30, 250) << 8 | clamp(cb, 30, 250);
}
function spawnHerd(sim, sp, x, y, n) {
  const h = { id: sim.nextId++, sp: sp.id, x, y, n, energy: 0.7, size: sp.size, speed: sp.speed, cold: sp.cold, fecund: sp.fecund, fierce: sp.fierce, tx: x, ty: y };
  sim.herds.set(h.id, h);
  sp.count += n;
  return h;
}
function seedWildlife(sim) {
  const w = sim.world;
  const rng = sim.rng;
  const defs2 = [
    { diet: 0, size: 0.55, speed: 0.6, cold: -4, shape: 0, herd: 30, fecund: 0.45 },
    { diet: 0, size: 0.6, speed: 0.8, cold: 9, shape: 0, herd: 22, fecund: 0.5, ridable: true, domestic: true },
    { diet: 0, size: 0.65, speed: 0.45, cold: 13, shape: 0, herd: 26, fecund: 0.5, domestic: true, ridable: false },
    { diet: 0, size: 0.4, speed: 0.75, cold: 25, shape: 0, herd: 34, fecund: 0.6 },
    { diet: 0, size: 0.95, speed: 0.35, cold: -2, shape: 3, herd: 9, fecund: 0.22, domestic: false, fierce: 0.5 },
    { diet: 0, size: 0.9, speed: 0.4, cold: 26, shape: 3, herd: 8, fecund: 0.24, domestic: false, fierce: 0.6 },
    { diet: 2, size: 0.3, speed: 0.5, cold: 14, shape: 2, herd: 14, fecund: 0.8, domestic: true },
    { diet: 0, size: 0.15, speed: 0.7, cold: 8, shape: 2, herd: 40, fecund: 1, domestic: false },
    { diet: 1, size: 0.45, speed: 0.75, cold: 0, shape: 1, herd: 7 },
    { diet: 1, size: 0.6, speed: 0.7, cold: 24, shape: 1, herd: 5 },
    { diet: 1, size: 0.75, speed: 0.5, cold: 8, shape: 1, herd: 3, fierce: 0.9 },
    { diet: 0, size: 0.35, speed: 0.65, cold: 22, shape: 4, herd: 12, fecund: 0.6 }
  ];
  const land = [];
  for (let i = 0; i < w.n; i++) if (w.water[i] === W_LAND && w.elev[i] < MOUNTAIN) land.push(i);
  if (land.length === 0) return;
  const target = Math.floor(land.length / 55 * sim.params.wildlife);
  for (const d of defs2) {
    const sp = createSpecies(sim, d);
    const share = Math.max(2, Math.floor(target / defs2.length * (d.diet === 1 ? 0.45 : 1.2)));
    let placed = 0;
    for (let tries = 0; tries < share * 30 && placed < share; tries++) {
      const i = rng.pick(land);
      const mt = meanTemp(w, sim.climate, i);
      if (Math.abs(mt - sp.cold) > 8) continue;
      if (sp.diet !== 1 && w.veg[i] < 0.2) continue;
      spawnHerd(sim, sp, i % w.w, i / w.w | 0, Math.max(2, Math.floor(sp.herd * rng.range(0.5, 1))));
      placed++;
    }
  }
}

// src/sim/people.ts
function fullName(sim, p) {
  const f = sim.families.get(p.fam);
  return f ? `${p.name} ${f.name}` : p.name;
}
function newFamily(sim, cultureId, founder, origin) {
  const cul = sim.cultures.get(cultureId);
  const f = { id: sim.nextId++, name: familyName(sim, cul.lang), founder, origin, living: 0, prestige: 0, thrones: 0 };
  sim.families.set(f.id, f);
  return f;
}
function createPerson(sim, o) {
  const rng = sim.rng;
  const id = sim.nextId++;
  const sex = o.sex ?? (rng.chance(0.5) ? 1 : 0);
  const cul = sim.cultures.get(o.culture);
  const mo = o.mother, fa = o.father;
  const tr = (a, b) => a !== void 0 && b !== void 0 ? clamp01((a + b) / 2 + rng.gauss() * 0.14) : clamp01(0.5 + rng.gauss() * 0.2);
  const age = o.age ?? 0;
  let fam = o.fam;
  const homeName = sim.settlements.get(o.home)?.name ?? "the wilds";
  if (fam === void 0) fam = fa ? fa.fam : mo ? mo.fam : newFamily(sim, o.culture, id, homeName).id;
  const p = {
    id,
    name: givenName(sim, cul.lang, sex),
    fam,
    sex,
    born: sim.tick - Math.floor(age * TICKS_PER_YEAR) - (o.age !== void 0 ? rng.int(TICKS_PER_YEAR) : 0),
    home: o.home,
    party: -1,
    army: -1,
    civ: o.civ,
    culture: o.culture,
    religion: o.religion,
    mother: mo ? mo.id : -1,
    father: fa ? fa.id : -1,
    spouse: -1,
    kids: [],
    amb: tr(mo?.amb, fa?.amb),
    cha: tr(mo?.cha, fa?.cha),
    bold: tr(mo?.bold, fa?.bold),
    intl: tr(mo?.intl, fa?.intl),
    comp: tr(mo?.comp, fa?.comp),
    dil: tr(mo?.dil, fa?.dil),
    piety: tr(mo?.piety, fa?.piety),
    greed: tr(mo?.greed, fa?.greed),
    sFarm: 0,
    sCraft: 0,
    sFight: 0,
    sTrade: 0,
    sLore: 0,
    sLead: 0,
    job: age >= ADULT_AGE ? J.laborer : J.child,
    wealth: 0,
    fed: 0.9,
    health: clamp01(0.85 + rng.gauss() * 0.08),
    happy: 0.6,
    loyalty: 0.6,
    faction: F.commons,
    friends: [],
    rivals: [],
    goal: GOAL.family,
    fame: 0,
    title: TITLE.none,
    sick: 0,
    mem: []
  };
  p.bold = clamp01(p.bold + (cul.martial - 0.5) * 0.1);
  p.piety = clamp01(p.piety + (cul.pious - 0.5) * 0.15);
  p.greed = clamp01(p.greed + (cul.mercantile - 0.5) * 0.1);
  p.comp = clamp01(p.comp + (cul.communal - 0.5) * 0.1);
  if (age >= ADULT_AGE) {
    const yrs = Math.min(25, age - ADULT_AGE);
    const sk = () => clamp01(yrs * 0.012 + rng.next() * 0.2);
    p.sFarm = sk();
    p.sCraft = sk() * 0.6;
    p.sFight = sk() * 0.5;
    p.sTrade = sk() * 0.4;
    p.sLore = sk() * 0.4 * p.intl * 2;
    p.sLead = sk() * 0.5;
    p.wealth = 2 + rng.next() * 6;
  }
  p.goal = pickGoal(sim, p);
  sim.people.set(id, p);
  sim.totalBorn++;
  const f = sim.families.get(fam);
  if (f) f.living++;
  const s = sim.settlements.get(o.home);
  if (s) s.people.push(id);
  remember(p, p.born, M.born, o.home);
  if (mo) mo.kids.push(id);
  if (fa) fa.kids.push(id);
  return p;
}
function pickGoal(sim, p) {
  const w = [
    0.5 + p.comp * 0.8,
    // family
    p.greed * 1.3,
    // wealth
    p.amb * 1.1 + p.cha * 0.2,
    // power
    p.intl * 1.2 - 0.25,
    // knowledge
    p.bold * 0.9 + p.amb * 0.2 - 0.2,
    // glory
    p.piety * 1.3 - 0.3,
    // faith
    p.bold * 0.5 - p.comp * 0.3
    // wander
  ].map((v) => Math.max(0.02, v) ** 2);
  return sim.rng.weighted(w);
}
var GOAL_JOB = [];
GOAL_JOB[GOAL.family] = [J.farmer, J.herder];
GOAL_JOB[GOAL.wealth] = [J.merchant, J.artisan];
GOAL_JOB[GOAL.power] = [J.official, J.soldier, J.priest];
GOAL_JOB[GOAL.knowledge] = [J.scholar];
GOAL_JOB[GOAL.glory] = [J.soldier, J.hunter];
GOAL_JOB[GOAL.faith] = [J.priest];
GOAL_JOB[GOAL.wander] = [J.merchant, J.hunter, J.fisher];
function addFame(sim, p, amount) {
  p.fame += amount;
  const f = sim.families.get(p.fam);
  if (f) f.prestige += amount * 0.5;
}
function rehome(sim, p, to) {
  const from = sim.settlements.get(p.home);
  if (from && from.id !== to.id) {
    const k = from.people.indexOf(p.id);
    if (k >= 0) {
      from.people[k] = from.people[from.people.length - 1];
      from.people.pop();
    }
    from.jobCount[p.job] = Math.max(0, from.jobCount[p.job] - 1);
  }
  if (!from || from.id !== to.id) {
    to.people.push(p.id);
    to.jobCount[p.job]++;
  }
  p.home = to.id;
  if (p.civ !== to.civ) {
    p.civ = to.civ;
    p.loyalty = 0.45;
  }
}

// src/sim/tech.ts
var defs = [
  // tier 0 — everyone starts here
  { key: "foraging", name: "Foraging", tier: 0, pre: [], desc: "Gathering wild plants and small game.", apply: () => {
  } },
  { key: "fire", name: "Fire", tier: 0, pre: [], desc: "Warmth, cooking, and light.", apply: () => {
  } },
  { key: "stonetools", name: "Stone Tools", tier: 0, pre: [], desc: "Knapped flint and hafted axes.", apply: () => {
  } },
  // tier 1
  { key: "agriculture", name: "Agriculture", tier: 1, pre: [], need: (e) => e.farmland, needText: "fertile land with a growing season", desc: "Sown fields replace wandering. Settlements can farm.", apply: () => {
  }, want: () => 6 },
  { key: "husbandry", name: "Animal Husbandry", tier: 1, pre: [], need: (e) => e.domestic, needText: "tameable herd animals nearby", desc: "Herds are kept, not chased. Pastures and pack animals.", apply: (m) => {
    m.caravanCap += 30;
  }, want: (e) => e.arid ? 5 : 3 },
  { key: "fishing", name: "Fishing", tier: 1, pre: [], need: (e) => e.coastal, needText: "a coast or lakeshore", desc: "Nets, hooks and boats for the shallows.", apply: (m) => {
    m.fishYield = 1;
    m.fishRange = 3;
  }, want: () => 4 },
  { key: "pottery", name: "Pottery", tier: 1, pre: ["fire"], desc: "Fired clay keeps grain dry. Food spoils more slowly.", apply: (m) => {
    m.storage *= 1.5;
  } },
  { key: "weaving", name: "Weaving", tier: 1, pre: [], desc: "Cloth, baskets and trade wares.", apply: (m) => {
    m.craftYield *= 1.15;
  } },
  { key: "woodworking", name: "Woodworking", tier: 1, pre: ["stonetools"], need: (e) => e.forest, needText: "woodland", desc: "Timber houses, better axes, denser villages.", apply: (m) => {
    m.woodYield *= 1.35;
    m.density = Math.max(m.density, 14);
  } },
  { key: "mysticism", name: "Mysticism", tier: 1, pre: [], desc: "Shrines and shared rites bind a people together.", apply: (m) => {
    m.morale += 0.05;
  } },
  { key: "archery", name: "Archery", tier: 1, pre: ["woodworking"], desc: "The bow: better hunting and deadlier war bands.", apply: (m) => {
    m.attack *= 1.15;
  }, want: (e) => e.threatened ? 3 : 1 },
  // tier 2
  { key: "mining", name: "Mining", tier: 2, pre: ["stonetools"], need: (e) => e.hills || e.has[R_COPPER] || e.has[R_IRON], needText: "hills or ore in the territory", desc: "Shafts and quarries. Ores and stone can be extracted.", apply: (m) => {
    m.mineYield = 1;
  }, want: () => 2.5 },
  { key: "masonry", name: "Masonry", tier: 2, pre: ["stonetools"], need: (e) => e.has[R_STONE], needText: "stone", desc: "Dressed stone: walls, and sturdier, denser towns.", apply: (m) => {
    m.wallMax = Math.max(m.wallMax, 1);
    m.density = Math.max(m.density, 17);
  }, want: (e) => e.threatened ? 3 : 1.2 },
  { key: "wheel", name: "The Wheel", tier: 2, pre: ["woodworking"], desc: "Carts and tracks. Caravans carry more, roads appear.", apply: (m) => {
    m.caravanCap += 50;
    m.landCost *= 0.8;
    m.roadLevel = Math.max(m.roadLevel, 1);
  } },
  { key: "writing", name: "Writing", tier: 2, pre: ["pottery", "mysticism"], need: (e) => e.pop >= 120, needText: "a society of at least 120 souls", desc: "Records outlive memory. Research quickens; knowledge is retained.", apply: (m) => {
    m.research *= 1.25;
    m.retention += 1;
    m.admin += 2;
  }, want: () => 2.5 },
  { key: "bronze", name: "Bronze Working", tier: 2, pre: ["mining"], need: (e) => e.has[R_COPPER], needText: "copper (mined or imported)", desc: "Metal tools and blades.", apply: (m) => {
    m.toolQ = Math.max(m.toolQ, 1.3);
    m.weaponQ = Math.max(m.weaponQ, 1.35);
  }, want: () => 2.5 },
  { key: "irrigation", name: "Irrigation", tier: 2, pre: ["agriculture"], need: (e) => e.river, needText: "a river or lake beside the fields", desc: "Canals water the fields. River farms shrug off drought.", apply: (m) => {
    m.irrigate = true;
    m.farmYield *= 1.1;
  }, want: (e) => e.arid ? 5 : 2 },
  { key: "sailing", name: "Sailing", tier: 2, pre: ["woodworking"], need: (e) => e.coastal, needText: "a coastline", desc: "Sea trade, deep-water fishing, colonies across the water.", apply: (m) => {
    m.seaRange = Math.max(m.seaRange, 34);
    m.seaCap = Math.max(m.seaCap, 150);
    m.fishRange = 5;
    m.fishYield *= 1.3;
  }, want: () => 3 },
  { key: "riding", name: "Riding", tier: 2, pre: ["husbandry"], need: (e) => e.ridable, needText: "a swift, strong herd animal to tame", desc: "Mounted warriors and couriers. Armies and news travel fast.", apply: (m) => {
    m.armySpeed *= 1.3;
    m.attack *= 1.15;
    m.landCost *= 0.85;
    m.admin += 1;
  }, want: (e, c) => 1.5 + c.pMilitary * 3 },
  { key: "calendar", name: "Calendar", tier: 2, pre: ["agriculture", "mysticism"], desc: "Knowing when to sow and reap.", apply: (m) => {
    m.farmYield *= 1.1;
  } },
  // tier 3
  { key: "ironworking", name: "Iron Working", tier: 3, pre: ["mining"], need: (e) => e.has[R_IRON] && e.forest, needText: "iron ore and wood for charcoal", desc: "Hard, cheap metal for ploughshares and swords.", apply: (m) => {
    m.toolQ = Math.max(m.toolQ, 1.55);
    m.weaponQ = Math.max(m.weaponQ, 1.65);
  }, want: () => 3 },
  { key: "currency", name: "Currency", tier: 3, pre: ["writing"], need: (e) => e.cities >= 2 || e.contacts >= 1, needText: "someone to trade with", desc: "Coin replaces barter. Markets and tax collection improve.", apply: (m) => {
    m.taxEff = Math.max(m.taxEff, 0.7);
    m.market *= 1.3;
  }, want: (e, c) => 1 + c.pTrade * 4 },
  { key: "mathematics", name: "Mathematics", tier: 3, pre: ["writing"], desc: "Number, measure and proof.", apply: (m) => {
    m.research *= 1.15;
  } },
  { key: "philosophy", name: "Philosophy", tier: 3, pre: ["writing", "mysticism"], desc: "Argument about how to live and rule. Opens the way to republics.", apply: (m) => {
    m.research *= 1.1;
  } },
  { key: "law", name: "Code of Laws", tier: 3, pre: ["writing"], desc: "Written law steadies large realms.", apply: (m) => {
    m.admin += 3;
  } },
  { key: "engineering", name: "Engineering", tier: 3, pre: ["masonry", "mathematics"], desc: "Paved roads, bridges, aqueducts and siege engines.", apply: (m) => {
    m.roadLevel = Math.max(m.roadLevel, 2);
    m.bridge = true;
    m.wallMax = Math.max(m.wallMax, 2);
    m.siege *= 1.4;
    m.density = Math.max(m.density, 21);
  } },
  { key: "shipbuilding", name: "Shipbuilding", tier: 3, pre: ["sailing"], need: (e) => e.coastal && e.forest, needText: "a coast and timber", desc: "Galleys: war fleets and long-haul cargo.", apply: (m) => {
    m.seaRange = Math.max(m.seaRange, 75);
    m.seaCap = Math.max(m.seaCap, 350);
    m.navy = Math.max(m.navy, 1);
  }, want: (e, c) => 1 + c.pTrade * 2 },
  { key: "medicine", name: "Medicine", tier: 3, pre: ["writing"], desc: "Herbals and surgeons. Fewer die young.", apply: (m) => {
    m.health += 0.15;
  } },
  { key: "tactics", name: "Tactics", tier: 3, pre: ["law"], desc: "Drilled formations and supply trains.", apply: (m) => {
    m.attack *= 1.15;
    m.morale += 0.1;
    m.supplyRange += 6;
  }, want: (e, c) => 0.6 + c.pMilitary * 4 },
  { key: "plow", name: "The Plough", tier: 3, pre: ["agriculture", "husbandry"], need: (e) => e.metalTools, needText: "metal tools", desc: "Draft animals turn heavy soil. Each farmer feeds more.", apply: (m) => {
    m.farmLabor = Math.min(m.farmLabor, 0.75);
    m.farmYield *= 1.15;
  }, want: () => 3 },
  // tier 4
  { key: "bureaucracy", name: "Bureaucracy", tier: 4, pre: ["law", "currency"], desc: "Clerks and ledgers hold an empire together.", apply: (m) => {
    m.admin += 5;
    m.taxEff = Math.max(m.taxEff, 0.85);
  } },
  { key: "steel", name: "Steel", tier: 4, pre: ["ironworking", "engineering"], desc: "Tempered blades and durable tools.", apply: (m) => {
    m.toolQ = Math.max(m.toolQ, 1.8);
    m.weaponQ = Math.max(m.weaponQ, 2.05);
  } },
  { key: "mills", name: "Wind & Water Mills", tier: 4, pre: ["engineering"], desc: "The first engines: wind and water do the work of many.", apply: (m) => {
    m.craftYield *= 1.25;
    m.farmYield *= 1.08;
    m.energy = Math.max(m.energy, 1.3);
  } },
  { key: "guilds", name: "Guilds", tier: 4, pre: ["currency", "weaving"], desc: "Organized crafts and standards.", apply: (m) => {
    m.craftYield *= 1.25;
    m.market *= 1.15;
  } },
  { key: "navigation", name: "Navigation", tier: 4, pre: ["shipbuilding", "mathematics"], desc: "Compass and chart. Open-sea voyages.", apply: (m) => {
    m.seaRange = Math.max(m.seaRange, 170);
    m.seaCap = Math.max(m.seaCap, 600);
  } },
  { key: "education", name: "Universities", tier: 4, pre: ["philosophy", "mathematics"], desc: "Institutions of learning that survive their founders.", apply: (m) => {
    m.research *= 1.3;
    m.retention += 1;
  }, want: (e, c) => 1 + c.pScience * 3 },
  { key: "fortification", name: "Fortification", tier: 4, pre: ["masonry", "engineering"], desc: "Castles and curtain walls.", apply: (m) => {
    m.wallMax = Math.max(m.wallMax, 3);
    m.defense *= 1.25;
  }, want: (e) => e.threatened ? 4 : 1 },
  { key: "banking", name: "Banking", tier: 4, pre: ["currency", "mathematics"], desc: "Credit funds ventures and public works.", apply: (m) => {
    m.market *= 1.2;
    m.taxEff = Math.max(m.taxEff, 0.9);
  }, want: (e, c) => 0.8 + c.pTrade * 3 },
  { key: "croprotation", name: "Crop Rotation", tier: 4, pre: ["plow", "calendar"], desc: "Fields rest and recover. Soil no longer wears out.", apply: (m) => {
    m.soilCare = 1;
    m.farmYield *= 1.15;
    m.farmLabor = Math.min(m.farmLabor, 0.6);
  } },
  { key: "theology", name: "Theology", tier: 4, pre: ["philosophy", "mysticism"], desc: "Doctrine and church hierarchy.", apply: (m) => {
    m.morale += 0.05;
  }, want: (e, c) => 0.5 + c.pPiety * 3 },
  // tier 5
  { key: "printing", name: "Printing Press", tier: 5, pre: ["education", "guilds"], desc: "Ideas multiply. Knowledge becomes very hard to lose.", apply: (m) => {
    m.research *= 1.3;
    m.retention += 2;
  } },
  { key: "gunpowder", name: "Gunpowder", tier: 5, pre: ["steel", "education"], need: (e) => e.has[R_SALT] || e.has[R_COAL], needText: "salt or coal for powder", desc: "Muskets and cannon. Old walls crumble.", apply: (m) => {
    m.attack *= 1.4;
    m.siege *= 1.8;
  }, want: (e, c) => 1 + c.pMilitary * 4 },
  { key: "science", name: "Scientific Method", tier: 5, pre: ["printing", "mathematics"], desc: "Experiment replaces authority.", apply: (m) => {
    m.research *= 1.4;
  } },
  { key: "galleons", name: "Ocean Ships", tier: 5, pre: ["navigation", "steel"], desc: "Vessels that cross any sea.", apply: (m) => {
    m.seaRange = Math.max(m.seaRange, 420);
    m.seaCap = Math.max(m.seaCap, 1e3);
    m.navy = Math.max(m.navy, 2);
  } },
  { key: "agronomy", name: "Agronomy", tier: 5, pre: ["croprotation", "science"], desc: "Selective breeding and soil science.", apply: (m) => {
    m.farmYield *= 1.3;
    m.farmLabor = Math.min(m.farmLabor, 0.35);
  } },
  { key: "economics", name: "Economics", tier: 5, pre: ["banking", "printing"], desc: "Joint-stock ventures and national accounts.", apply: (m) => {
    m.market *= 1.4;
    m.taxEff = 1;
  } },
  // tier 6
  { key: "steam", name: "Steam Power", tier: 6, pre: ["science", "steel"], need: (e) => e.has[R_COAL], needText: "coal", desc: "Coal becomes motion. Mines and workshops surge; the sky darkens.", apply: (m) => {
    m.energy = Math.max(m.energy, 2);
    m.craftYield *= 1.5;
    m.mineYield *= 1.5;
    m.co2 = 1;
  }, want: () => 4 },
  { key: "industry", name: "Factories", tier: 6, pre: ["steam", "economics"], desc: "Mass production and crowded cities.", apply: (m) => {
    m.craftYield *= 1.8;
    m.density = Math.max(m.density, 28);
  } },
  { key: "railways", name: "Railways", tier: 6, pre: ["steam", "engineering"], need: (e) => e.has[R_IRON], needText: "iron for rails", desc: "Iron roads shrink the land.", apply: (m) => {
    m.caravanCap += 400;
    m.roadLevel = Math.max(m.roadLevel, 3);
    m.landCost *= 0.35;
    m.supplyRange += 24;
    m.armySpeed *= 1.3;
  } },
  { key: "rifles", name: "Rifled Arms", tier: 6, pre: ["gunpowder", "industry"], desc: "Accurate, rapid fire.", apply: (m) => {
    m.attack *= 1.5;
    m.weaponQ = Math.max(m.weaponQ, 2.6);
  }, want: (e, c) => 1 + c.pMilitary * 4 },
  { key: "sanitation", name: "Sanitation", tier: 6, pre: ["medicine", "science"], desc: "Sewers and clean water. Cities stop being death traps.", apply: (m) => {
    m.health += 0.25;
    m.density = Math.max(m.density, 34);
  } },
  { key: "steamships", name: "Steamships", tier: 6, pre: ["steam", "galleons"], desc: "Iron hulls ignore the wind.", apply: (m) => {
    m.seaCap = Math.max(m.seaCap, 2e3);
    m.navy = Math.max(m.navy, 3);
  } },
  { key: "nationalism", name: "Nationalism", tier: 6, pre: ["printing", "law"], desc: "The people become a nation \u2014 and minorities grow restless.", apply: (m) => {
    m.morale += 0.15;
  } },
  // tier 7
  { key: "electricity", name: "Electricity", tier: 7, pre: ["steam", "science"], desc: "Light without flame; power at a distance.", apply: (m) => {
    m.energy = Math.max(m.energy, 3);
    m.craftYield *= 1.3;
    m.research *= 1.2;
  } },
  { key: "combustion", name: "Combustion Engine", tier: 7, pre: ["industry"], need: (e) => e.has[R_OIL], needText: "oil", desc: "Engines on wheels: trucks, tractors, tanks.", apply: (m) => {
    m.armySpeed *= 1.5;
    m.attack *= 1.5;
    m.landCost *= 0.7;
    m.co2 += 1;
  }, want: () => 3 },
  { key: "mechfarm", name: "Mechanized Farming", tier: 7, pre: ["combustion", "agronomy"], desc: "One farmer feeds a hundred.", apply: (m) => {
    m.farmLabor = Math.min(m.farmLabor, 0.1);
    m.farmYield *= 1.3;
  } },
  { key: "radio", name: "Telecommunication", tier: 7, pre: ["electricity"], desc: "Instant messages bind distant provinces.", apply: (m) => {
    m.admin += 10;
    m.research *= 1.15;
  } },
  { key: "modmed", name: "Modern Medicine", tier: 7, pre: ["sanitation", "electricity"], desc: "Vaccines and antibiotics.", apply: (m) => {
    m.health += 0.3;
    m.lifespan += 10;
  } },
  // tier 8
  { key: "computing", name: "Computing", tier: 8, pre: ["radio", "science"], desc: "Thinking machines accelerate everything.", apply: (m) => {
    m.research *= 1.5;
    m.market *= 1.3;
  } },
  { key: "renewables", name: "Clean Energy", tier: 8, pre: ["electricity", "computing"], desc: "Sun and wind replace smoke.", apply: (m) => {
    m.co2 *= 0.15;
    m.energy = Math.max(m.energy, 4);
  } },
  { key: "fusion", name: "Fusion Power", tier: 8, pre: ["computing", "renewables"], desc: "A star in a bottle.", apply: (m) => {
    m.energy = Math.max(m.energy, 6);
    m.co2 = 0;
    m.craftYield *= 1.5;
  } },
  { key: "genetics", name: "Genetic Engineering", tier: 8, pre: ["modmed", "computing"], desc: "Life itself becomes a craft.", apply: (m) => {
    m.farmYield *= 1.4;
    m.lifespan += 15;
    m.health += 0.1;
  } }
];
var TECHS = defs.map((d, id) => ({ ...d, id }));
var NT = TECHS.length;
var TK = {};
for (const t of TECHS) TK[t.key] = t.id;
var TECH_PRE = TECHS.map((t) => t.pre.map((k) => TK[k]));
function baseMods() {
  return {
    farmYield: 1,
    farmLabor: 1,
    irrigate: false,
    soilCare: 0,
    fishYield: 0.35,
    fishRange: 2,
    woodYield: 1,
    mineYield: 0.35,
    craftYield: 1,
    storage: 1,
    health: 0,
    research: 1,
    caravanCap: 40,
    landCost: 1,
    seaRange: 0,
    seaCap: 0,
    attack: 1,
    defense: 1,
    morale: 0,
    wallMax: 0,
    navy: 0,
    admin: 3,
    density: 12,
    roadLevel: 0,
    bridge: false,
    retention: 0,
    lifespan: 0,
    toolQ: 1,
    weaponQ: 1,
    supplyRange: 10,
    armySpeed: 1,
    fertility: 1,
    co2: 0,
    energy: 1,
    taxEff: 0.5,
    market: 1,
    siege: 1
  };
}
function recomputeMods(c) {
  const m = baseMods();
  for (const t of TECHS) if (c.tech[t.id] === 1) t.apply(m);
  c.mods = m;
  const cnt = new Array(9).fill(0);
  for (const t of TECHS) if (c.tech[t.id] === 1) cnt[t.tier]++;
  let era = 0;
  for (let tier = 2; tier <= 8; tier++) if (cnt[tier] >= 2) era = tier - 1;
  c.era = era;
}

// src/sim/path.ts
var heap = new MinHeap();
function findPortTile(sim, x, y, r) {
  const w = sim.world;
  let best = -1, bd = 1e9;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const j = ny * w.w + nx;
      if (w.water[j] === W_LAND || !w.coast[j]) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
  }
  return best;
}

// src/sim/parties.ts
function siteScore(sim, i, civ) {
  const w = sim.world;
  if (w.water[i] !== W_LAND || w.owner[i] >= 0 || w.elev[i] - w.seaLevel + SEA > MOUNTAIN - 0.03) return -1;
  const x = i % w.w, y = i / w.w | 0;
  const farms = !civ || civ.tech[TK.agriculture] === 1;
  const fishes = !civ || civ.tech[TK.fishing] === 1;
  let sc = 0, crowded = false;
  forDisc(w, x, y, 9, (j, d) => {
    if (w.imp[j] === I_URBAN) crowded = true;
    if (d > 3.2) return;
    if (w.water[j] !== W_LAND) {
      sc += fishes ? 0.22 : 0.06;
      return;
    }
    if (w.owner[j] >= 0) {
      sc -= 0.25;
      return;
    }
    const t = meanTemp(w, sim.climate, j);
    const warm = clamp01((t - 1) / 7);
    if (farms) sc += w.fert[j] * clamp01(w.moist[j] * 2.2) * warm;
    else sc += (w.veg[j] + w.forest[j] * 0.4) * 0.8;
    if (civ && w.res[j] && civ.needs[[0, 2, 3, 4, 5, 6, 7, 8][w.res[j]]] > 0.3) sc += 1.2;
  });
  if (crowded) return -1;
  if (hasFreshWater(w, i)) sc += 3;
  if (w.coast[i] && fishes) sc += 1;
  return sc;
}

// src/sim/settlement.ts
var skillSum = new Float64Array(NJ);
var prodVal = new Float64Array(NJ);
var desire = new Float32Array(2048);
var own = new Float32Array(2048);
function foundSettlement(sim, civId, x, y, people, name) {
  const w = sim.world;
  const civ = sim.civs.get(civId);
  const cul = sim.cultures.get(civ.culture);
  const tile = y * w.w + x;
  const s = {
    id: sim.nextId++,
    name: name || placeName(sim, cul.lang),
    civ: civId,
    x,
    y,
    tile,
    founded: sim.tick,
    alive: true,
    people: [],
    radius: 3,
    tiles: [],
    farms: [],
    urban: [],
    mines: [],
    stock: new Array(NG).fill(0),
    price: GOOD_BASE.slice(),
    demand: new Array(NG).fill(0),
    prod: new Array(NG).fill(0),
    jobCount: new Array(NJ).fill(0),
    wage: new Array(NJ).fill(1),
    bld: new Array(NB).fill(0),
    build: null,
    unrest: 0.1,
    livestock: 0,
    toolQ: 1,
    weaponQ: 1,
    siege: -1,
    siegeMonths: 0,
    occupier: -1,
    originalCiv: civId,
    governor: -1,
    coastal: false,
    river: false,
    wildCap: 0,
    hungerMonths: 0,
    starved: 0,
    plague: 0,
    lastRaid: -9999,
    tradeVol: 0,
    imports: new Array(NG).fill(0),
    routes: [],
    fedAvg: 0.9,
    happyAvg: 0.6,
    wealthAvg: 3,
    gini: 0,
    housing: 40,
    cultureMajor: civ.culture,
    religionMajor: civ.religion,
    damage: 0,
    portTile: -1,
    growthNote: -9999,
    blockaded: false,
    lastPlague: -9999,
    peakPop: people.length,
    drought: 0,
    farmable: 0,
    waterTiles: 0,
    forestTiles: 0,
    pastureCap: 0,
    loyalAvg: 0.6,
    rebelHeat: 0
  };
  sim.settlements.set(s.id, s);
  civ.settlements.push(s.id);
  if (w.owner[tile] >= 0) releaseTile(sim, tile);
  w.owner[tile] = s.id;
  w.imp[tile] = I_URBAN;
  w.forest[tile] = 0;
  s.tiles.push(tile);
  s.urban.push(tile);
  markDirty(sim, tile);
  for (const p of people) {
    rehome(sim, p, s);
    p.party = -1;
  }
  s.stock[G.food] = people.length * 5;
  s.stock[G.wood] = 15;
  s.stock[G.tools] = Math.ceil(people.length * 0.2);
  claimTerritory(sim, s);
  refreshLand(sim, s);
  sim.rt.borderDirty = true;
  return s;
}
function releaseTile(sim, i) {
  const w = sim.world;
  const o = sim.settlements.get(w.owner[i]);
  if (o) {
    const rm = (a) => {
      const k = a.indexOf(i);
      if (k >= 0) a.splice(k, 1);
    };
    rm(o.tiles);
    rm(o.farms);
    rm(o.mines);
    rm(o.urban);
  }
  w.owner[i] = -1;
  w.imp[i] = I_NONE;
}
function claimTerritory(sim, s) {
  const w = sim.world;
  const civ = sim.civs.get(s.civ);
  const pop = s.people.length;
  const target = clamp(2.6 + Math.sqrt(pop) / 3.2, 3, Math.min(13, 4.5 + civ.mods.admin * 0.5));
  s.radius = target;
  let claimed = false;
  const lm = w.landmass[s.tile];
  forDisc(w, s.x, s.y, target, (i) => {
    if (w.water[i] !== W_LAND) return;
    const o = w.owner[i];
    if (o === s.id) return;
    if (o < 0) {
      if (w.landmass[i] !== lm && !s.coastal) return;
      w.owner[i] = s.id;
      s.tiles.push(i);
      claimed = true;
    } else {
      const os = sim.settlements.get(o);
      if (os && os.civ !== s.civ) {
        const r = relationOf(sim, civ, os.civ);
        r.friction = Math.min(1, r.friction + 4e-3);
        r.contact = true;
        const oc = sim.civs.get(os.civ);
        if (oc) relationOf(sim, oc, civ.id).contact = true;
      }
    }
  });
  if (claimed) sim.rt.borderDirty = true;
}
function refreshLand(sim, s) {
  const w = sim.world;
  const civ = sim.civs.get(s.civ);
  let coastal = false, wild = 0, water = 0;
  forDisc(w, s.x, s.y, 7, (i, d) => {
    if (w.water[i] !== W_LAND) {
      if (d <= civ.mods.fishRange + 1) {
        water++;
        if (d <= 3.5) coastal = true;
      }
      return;
    }
    if (w.imp[i] === I_NONE || w.imp[i] === I_PASTURE) wild += w.veg[i] + w.forest[i] * 0.4;
  });
  s.coastal = coastal;
  s.waterTiles = water;
  s.wildCap = wild;
  s.river = hasFreshWater(w, s.tile);
  s.portTile = coastal ? findPortTile(sim, s.x, s.y, 4) : -1;
  let farmable = 0, forest = 0, pasture = 0;
  const canMine = civ.mods.mineYield >= 1;
  s.mines.length = 0;
  for (const i of s.tiles) {
    if (!s.river && w.river[i] > 0) s.river = true;
    const imp = w.imp[i];
    if (w.forest[i] > 0.15) forest++;
    if (imp === I_NONE || imp === I_PASTURE || imp === I_CAMP) {
      if (suitableFarm(sim, i)) farmable++;
      pasture += w.veg[i] * 5;
    }
    const r = w.res[i];
    if (r && w.resAmt[i] > 0 && imp !== I_URBAN) {
      const usable = r === R_STONE || r === R_SALT ? true : r === R_COAL ? canMine : r === R_OIL ? civ.tech[TK.industry] === 1 : canMine;
      if (usable) s.mines.push(i);
    }
  }
  s.farmable = farmable;
  s.forestTiles = forest;
  s.pastureCap = pasture;
}
function suitableFarm(sim, i) {
  const w = sim.world;
  return w.fert[i] > 0.22 && w.elev[i] - w.seaLevel + SEA < MOUNTAIN - 0.04 && meanTemp(w, sim.climate, i) > 2.5;
}
var SLOTS = new Array(NJ).fill(0);
var EXPECT = new Array(NJ).fill(0);

// src/sim/civ.ts
function relationOf(sim, civ, otherId) {
  let r = civ.rel.get(otherId);
  if (!r) {
    r = { score: 0, war: -1, truceUntil: 0, tradePact: false, alliance: false, contact: false, tradeVal: 0, friction: 0, lastWar: -99999, tribute: 0 };
    civ.rel.set(otherId, r);
  }
  return r;
}
function createCiv(sim, o) {
  const cul = sim.cultures.get(o.culture);
  const name = o.name || rootName(sim, cul.lang);
  const used = new Array(24).fill(0);
  for (const c of sim.civs.values()) if (c.alive) used[c.color]++;
  let color = 0;
  const start = sim.rng.int(24);
  for (let k = 0; k < 24; k++) {
    const idx = (start + k * 7) % 24;
    if (used[idx] < used[color] || k === 0) color = used[idx] <= used[color] || k === 0 ? idx : color;
  }
  const laws = { tax: 0.1, conscription: 1, trade: 1, dole: false, serfdom: false, tolerance: true, schooling: false, elective: true };
  const civ = {
    id: sim.nextId++,
    name,
    adj: demonym(name),
    color,
    hue: color * 15,
    alive: true,
    founded: sim.tick,
    ended: -1,
    parent: o.parent,
    capital: -1,
    settlements: [],
    ruler: -1,
    dynasty: -1,
    gov: GOV.band,
    laws,
    lawCooldown: 0,
    factions: new Array(NF).fill(1),
    rulingFaction: F.commons,
    culture: o.culture,
    religion: o.religion,
    tech: new Array(NT).fill(0),
    research: new Array(NT).fill(0),
    researching: -1,
    treasury: 20,
    income: 0,
    expense: 0,
    incomeLast: 0,
    expenseLast: 0,
    rel: /* @__PURE__ */ new Map(),
    grievances: [],
    armies: [],
    stability: 0.8,
    legitimacy: 0.7,
    exhaustion: 0,
    identity: 0.5,
    era: 0,
    pop: 0,
    soldiers: 0,
    strength: 0,
    soldierTarget: 0,
    pExpand: 0.4,
    pMilitary: 0.3,
    pTrade: 0.3,
    pScience: 0.3,
    pPiety: 0.3,
    isolated: false,
    rebelOf: -1,
    rebelGoal: 0,
    needs: new Array(NG).fill(0),
    lastSettle: sim.tick,
    memory: [],
    peakPop: 0,
    golden: 0,
    federation: -1,
    mods: baseMods()
  };
  for (const t of TECHS) if (t.tier === 0) civ.tech[t.id] = 1;
  if (o.inherit) {
    for (let t = 0; t < NT; t++) if (o.inherit.tech[t] === 1) civ.tech[t] = 1;
    civ.laws = { ...o.inherit.laws };
    civ.memory = o.inherit.memory.slice(-6);
    civ.grievances = o.inherit.grievances.map((g) => ({ ...g, mag: g.mag * 0.6 }));
    for (const [oid, r] of o.inherit.rel) {
      if (r.contact) {
        const nr = relationOf(sim, civ, oid);
        nr.contact = true;
        nr.score = r.score * 0.5;
        const oc = sim.civs.get(oid);
        if (oc) relationOf(sim, oc, civ.id).contact = true;
      }
    }
  }
  recomputeMods(civ);
  sim.civs.set(civ.id, civ);
  return civ;
}

// src/sim/culture.ts
function createCulture(sim, parent) {
  const rng = sim.rng;
  const lang = genLanguage(sim, parent ? parent.lang : -1);
  const v = (base) => clamp01(base !== void 0 ? base + rng.gauss() * 0.08 : 0.5 + rng.gauss() * 0.17);
  const c = {
    id: sim.nextId++,
    name: "",
    lang: lang.id,
    parent: parent ? parent.id : -1,
    born: sim.tick,
    martial: v(parent?.martial),
    mercantile: v(parent?.mercantile),
    pious: v(parent?.pious),
    communal: v(parent?.communal),
    innovative: v(parent?.innovative),
    insular: v(parent?.insular),
    seafaring: v(parent?.seafaring),
    traditions: parent ? parent.traditions.slice(0, 2) : [],
    style: parent && rng.chance(0.6) ? parent.style : rng.int(5)
  };
  const root = cap(word(lang, rng, 2, 2));
  c.name = root + rng.pick(["i", "ar", "an", "ese", "ic", "ish"]);
  sim.cultures.set(c.id, c);
  return c;
}

// src/sim/sim.ts
var SIM_VERSION = 1;
function defaultParams(popCap) {
  return { birthRate: 1, mortality: 1, aggression: 1, research: 1, disasters: 1, climateVolatility: 1, wildlife: 1, growth: 1, popCap, tradeZeal: 1, unrest: 1 };
}
function newRuntime(w) {
  return {
    dirty: [],
    allDirty: true,
    borderDirty: true,
    herdGrid: /* @__PURE__ */ new Map(),
    fx: [],
    pathStamp: new Int32Array(w.n),
    pathG: new Float32Array(w.n),
    pathFrom: new Int32Array(w.n),
    pathGen: 0,
    tileCivCache: null,
    pending: [],
    terrainPending: false
  };
}
function createSim(opts) {
  const world = generateWorld(opts);
  const sim = {
    version: SIM_VERSION,
    tick: 0,
    rng: new RNG(opts.seed * 7919 + 17),
    world,
    climate: initClimate(opts.seed),
    params: defaultParams(opts.popCap),
    nextId: 1,
    people: /* @__PURE__ */ new Map(),
    graves: /* @__PURE__ */ new Map(),
    families: /* @__PURE__ */ new Map(),
    settlements: /* @__PURE__ */ new Map(),
    civs: /* @__PURE__ */ new Map(),
    wars: /* @__PURE__ */ new Map(),
    armies: /* @__PURE__ */ new Map(),
    parties: /* @__PURE__ */ new Map(),
    routes: /* @__PURE__ */ new Map(),
    routeIndex: /* @__PURE__ */ new Map(),
    species: /* @__PURE__ */ new Map(),
    herds: /* @__PURE__ */ new Map(),
    storms: [],
    fires: [],
    cultures: /* @__PURE__ */ new Map(),
    religions: /* @__PURE__ */ new Map(),
    languages: /* @__PURE__ */ new Map(),
    ruins: [],
    history: [],
    stats: newStats(),
    vegCursor: 0,
    usedNames: /* @__PURE__ */ new Map(),
    totalBorn: 0,
    totalDied: 0,
    rt: newRuntime(world)
  };
  reclassifyAll(sim);
  seedWildlife(sim);
  seedTribes(sim, opts.tribes);
  addEvent(sim, "genesis", 5, `In the beginning there was the land and the sea. ${sim.civs.size} small bands of people wander it.`, [], [], -1, -1, -1);
  sampleStats(sim);
  return sim;
}
function seedTribes(sim, n) {
  const w = sim.world;
  const rng = sim.rng;
  const cands = [];
  for (let t = 0; t < 2500; t++) {
    const i = rng.int(w.n);
    if (w.water[i] !== W_LAND) continue;
    const sc = siteScore(sim, i, void 0);
    if (sc > 5) cands.push({ i, sc: sc + rng.next() * 3 });
  }
  cands.sort((a, b) => b.sc - a.sc || a.i - b.i);
  const chosen = [];
  let minD = Math.max(14, Math.sqrt(w.w * w.h / (n + 1)) * 0.55);
  for (let pass = 0; pass < 4 && chosen.length < n; pass++) {
    for (const c of cands) {
      if (chosen.length >= n) break;
      const x = c.i % w.w, y = c.i / w.w | 0;
      let ok = true;
      for (const o of chosen) if (dist(x, y, o % w.w, o / w.w | 0) < minD) ok = false;
      if (ok) chosen.push(c.i);
    }
    minD *= 0.7;
  }
  for (const i of chosen) spawnTribe(sim, i % w.w, i / w.w | 0, 26 + rng.int(10));
}
function spawnTribe(sim, x, y, count, cultureId) {
  const w = sim.world;
  if (x < 1 || y < 1 || x >= w.w - 1 || y >= w.h - 1) return null;
  const tile = y * w.w + x;
  if (w.water[tile] !== W_LAND || w.owner[tile] >= 0 || w.elev[tile] - w.seaLevel + SEA > MOUNTAIN) return null;
  const rng = sim.rng;
  const cul = cultureId !== void 0 && sim.cultures.has(cultureId) ? sim.cultures.get(cultureId) : createCulture(sim);
  const civ = createCiv(sim, { culture: cul.id, religion: -1, parent: -1 });
  const people = [];
  const couples = Math.max(2, Math.round(count / 3.6));
  for (let k = 0; k < couples; k++) {
    const ha = 18 + rng.int(22);
    const husband = createPerson(sim, { sex: 1, age: ha, home: -1, civ: civ.id, culture: cul.id, religion: -1 });
    const wife = createPerson(sim, { sex: 0, age: clamp(ha - 2 + rng.int(5) - 2, 16, 40), home: -1, civ: civ.id, culture: cul.id, religion: -1 });
    husband.spouse = wife.id;
    wife.spouse = husband.id;
    people.push(husband, wife);
    const wa = (sim.tick - wife.born) / TICKS_PER_YEAR;
    const kids = Math.min(4, rng.int(4) + (wa > 28 ? 1 : 0));
    for (let c = 0; c < kids && people.length < count; c++) {
      const age = rng.int(Math.max(1, Math.min(14, Math.floor(wa - 16))));
      people.push(createPerson(sim, { age, home: -1, civ: civ.id, culture: cul.id, religion: -1, mother: wife, father: husband }));
    }
  }
  while (people.length < count) people.push(createPerson(sim, { age: 16 + rng.int(40), home: -1, civ: civ.id, culture: cul.id, religion: -1 }));
  const s = foundSettlement(sim, civ.id, x, y, people);
  civ.capital = s.id;
  let leader = people[0], ls = -1;
  for (const p of people) {
    if (p.job === 0) continue;
    const sc = p.cha + p.sLead + p.bold * 0.4;
    if (sc > ls) {
      ls = sc;
      leader = p;
    }
  }
  leader.title = TITLE.ruler;
  civ.ruler = leader.id;
  addFame(sim, leader, 4);
  civ.pop = people.length;
  addEvent(sim, "found", 2, `The ${civ.name}, a band of ${people.length} led by ${fullName(sim, leader)}, made camp at ${s.name}.`, [civ.id], [leader.id], s.id, x, y);
  return civ;
}

// test/probe.ts
for (const seed of [99, 1234, 7, 2024]) {
  const sim = createSim({ seed, w: 256, h: 160, land: 0.36, tribes: 0, popCap: 1e3 });
  const w = sim.world;
  const cnt = new Array(20).fill(0);
  let land = 0, m = 0, v = 0, f = 0, dry = 0;
  for (let i = 0; i < w.n; i++) {
    if (w.water[i] !== W_LAND) continue;
    land++;
    cnt[w.biome[i]]++;
    m += w.moist[i];
    v += w.veg[i];
    f += w.forest[i];
    if (w.moist[i] < 0.2) dry++;
  }
  console.log(`seed ${seed}: land ${land} moist ${(m / land).toFixed(2)} veg ${(v / land).toFixed(2)} forest ${(f / land).toFixed(2)} dry<0.2 ${(dry / land * 100).toFixed(0)}% | ` + cnt.map((c, k) => c ? `${BIOME_NAMES[k]} ${(c / land * 100).toFixed(0)}%` : "").filter(Boolean).slice(0).join(", "));
}
