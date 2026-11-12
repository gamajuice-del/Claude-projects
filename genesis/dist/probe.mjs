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
function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + Math.imul(seed | 0, 1274126177) | 0;
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
function noise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const l = (ax, ay, az) => hash3(xi + ax, yi + ay, zi + az, seed);
  const x00 = l(0, 0, 0) + (l(1, 0, 0) - l(0, 0, 0)) * xf;
  const x10 = l(0, 1, 0) + (l(1, 1, 0) - l(0, 1, 0)) * xf;
  const x01 = l(0, 0, 1) + (l(1, 0, 1) - l(0, 0, 1)) * xf;
  const x11 = l(0, 1, 1) + (l(1, 1, 1) - l(0, 1, 1)) * xf;
  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;
  return y0 + (y1 - y0) * zf;
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
var TICKS_PER_MONTH = 4;
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
var R_STONE = 1;
var R_COPPER = 2;
var R_IRON = 3;
var R_COAL = 4;
var R_GOLD = 5;
var R_SALT = 6;
var R_OIL = 7;
var I_NONE = 0;
var I_FARM = 1;
var I_PASTURE = 2;
var I_MINE = 3;
var I_CAMP = 4;
var I_URBAN = 5;
var I_RUIN = 6;
var I_PORT = 7;
var G = { food: 0, wood: 1, stone: 2, copper: 3, iron: 4, coal: 5, gold: 6, salt: 7, oil: 8, tools: 9, weapons: 10, wares: 11 };
var NG = 12;
var GOOD_BASE = [1, 0.8, 1, 4, 5, 3, 20, 3, 6, 6, 10, 5];
var GOOD_BULK = [1, 1.5, 2, 1, 1, 1.5, 0.05, 0.5, 1, 0.5, 0.5, 0.3];
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
var B = {
  granary: 0,
  market: 1,
  workshop: 2,
  temple: 3,
  library: 4,
  walls: 5,
  barracks: 6,
  port: 7,
  mill: 8,
  school: 9,
  factory: 10,
  power: 11,
  hospital: 12,
  palace: 13
};
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
var PARTY = { migrants: 0, settlers: 1, caravan: 2, refugees: 3 };
function monthOf(tick2) {
  return Math.floor(tick2 % TICKS_PER_YEAR / TICKS_PER_MONTH);
}

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
function latOf(w, i) {
  return 1 - (i / w.w | 0) / (w.h - 1);
}
function yearFrac(tick2) {
  return tick2 % TICKS_PER_YEAR / TICKS_PER_YEAR;
}
function tempAt(w, c, i, tick2) {
  const lat = latOf(w, i);
  const amp = 1.5 + 15 * lat + (w.water[i] === W_LAND ? 2 : -1);
  return w.temp[i] + c.tempOffset + amp * Math.cos(2 * Math.PI * (yearFrac(tick2) - 0.375));
}
function meanTemp(w, c, i) {
  return w.temp[i] + c.tempOffset;
}
function rainAnomaly(w, c, x, y, tick2, volatility) {
  const yr = tick2 / TICKS_PER_YEAR;
  const a = noise3(x / 46, y / 46, yr / 7, w.seed + 911);
  const b = noise3(x / 19, y / 19, yr / 2.3, w.seed + 1777);
  const v = (a * 0.7 + b * 0.3 - 0.5) * 2;
  return clamp(1 + v * 1.25 * volatility, 0.15, 2.2) * c.rainMult;
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
  if (t < 6) return f > 0.3 ? Biome.Taiga : m < 0.2 ? Biome.Steppe : Biome.Tundra;
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
function growthPotential(w, c, i, tick2) {
  const t = tempAt(w, c, i, tick2);
  const opt = w.flora[i];
  let tf;
  if (t < 2) tf = 0;
  else {
    const d = Math.abs(t - opt);
    tf = clamp01(1.15 - d / 16) * clamp01((t - 2) / 7) * clamp01((44 - t) / 8);
  }
  const mf = clamp01((w.moist[i] - 0.06) / 0.5);
  return tf * mf;
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
  [0, 0.92],
  [0.12, 0.82],
  [0.27, 0.2],
  [0.36, 0.24],
  [0.5, 0.62],
  [0.63, 0.66],
  [0.8, 0.42],
  [1, 0.22]
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
      w.temp[i] = 29 - 44 * Math.pow(lat, 1.25) - alt * 46 + (noise2(x / 23, y / 23, seed + 901) - 0.5) * 4;
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
        w.rain[i] = clamp01(band * (0.28 + 0.9 * m) + oro * 1.6 + (noise2(x / 15, y / 15, seed + 1201) - 0.5) * 0.22);
        m = Math.max(0.05, m * 0.986 - oro * 0.75);
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
    let fo = clamp01((m - 0.36) * 2.4) * clamp01((t + 3) / 9) * (0.45 + fn * 0.9);
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
function remember(p, tick2, code, ref) {
  p.mem.push(tick2, code, ref);
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
function updateClimate(sim) {
  const c = sim.climate;
  const t = sim.tick;
  if (t % TICKS_PER_MONTH === 0) {
    const yr = t / TICKS_PER_YEAR;
    const vol = sim.params.climateVolatility;
    const cyc = (0.9 * Math.sin(2 * Math.PI * yr / 230 + c.phases[0]) + 0.55 * Math.sin(2 * Math.PI * yr / 71 + c.phases[1]) + 0.3 * Math.sin(2 * Math.PI * yr / 23 + c.phases[2])) * vol;
    const greenhouse = 2.4 * Math.log2(1 + c.co2 / 300);
    c.tempOffset = c.godTemp + c.drift + cyc + greenhouse - c.dust * 5;
    c.rainMult = c.godRain * (1 + 0.04 * (c.tempOffset - c.godTemp)) * (1 - c.dust * 0.3);
    c.dust *= 0.975;
    if (c.dust < 1e-3) c.dust = 0;
  }
  if (t % TICKS_PER_YEAR === 0) {
    c.drift = clamp(c.drift * 0.985 + sim.rng.gauss() * 0.07 * sim.params.climateVolatility, -3, 3);
    c.co2 *= 0.994;
    updateSeaLevel(sim);
  }
  updateStorms(sim);
}
function updateSeaLevel(sim, force = false) {
  const w = sim.world;
  const target = clamp(sim.climate.seaBase + 35e-4 * sim.climate.tempOffset, 0.3, 0.55);
  if (!force && Math.abs(target - w.seaLevel) < 25e-4) return;
  const rising = target > w.seaLevel;
  w.seaLevel = target;
  applyWaterChange(sim);
  if (sim.tick > 0) {
    addEvent(sim, "climate", 3, rising ? "The seas are rising. Low coasts slip beneath the waves." : "The seas are retreating, baring new shores.", [], [], -1, -1, -1);
  }
}
function applyWaterChange(sim) {
  const w = sim.world;
  const before = Uint8Array.from(w.water);
  recomputeWater(w);
  recomputeCoast(w);
  recomputeHydrology(w, false);
  for (let i = 0; i < w.n; i++) {
    if (before[i] === w.water[i]) continue;
    if (w.water[i] !== W_LAND) {
      w.forest[i] = 0;
      w.veg[i] = 0.3;
      w.fire[i] = 0;
      w.road[i] = 0;
      w.res[i] = 0;
      w.resAmt[i] = 0;
      if (w.imp[i] !== I_NONE) drownImprovement(sim, i);
    } else {
      w.veg[i] = 0;
      w.forest[i] = 0;
      w.fert[i] = 0.25;
      w.moist[i] = 0.6;
      w.flora[i] = Math.round(clamp(w.temp[i] + sim.climate.tempOffset + 5, 4, 30));
    }
  }
  sim.rt.allDirty = true;
  sim.rt.borderDirty = true;
}
function drownImprovement(sim, i) {
  const w = sim.world;
  const sid = w.owner[i];
  const s = sid >= 0 ? sim.settlements.get(sid) : void 0;
  if (s) {
    const rm = (arr) => {
      const k = arr.indexOf(i);
      if (k >= 0) arr.splice(k, 1);
    };
    rm(s.farms);
    rm(s.mines);
    if (w.imp[i] === I_URBAN) {
      rm(s.urban);
      s.damage = clamp01(s.damage + 0.08);
    }
    rm(s.tiles);
  }
  w.imp[i] = I_NONE;
  w.owner[i] = -1;
}
function updateStorms(sim) {
  const w = sim.world;
  const rng = sim.rng;
  const scale = w.w * w.h / (256 * 160);
  if (sim.storms.length < 7 * scale && rng.chance(0.03 * scale * clamp(sim.climate.rainMult, 0.2, 2.5))) {
    const x = rng.int(w.w), y = rng.int(w.h);
    const i = y * w.w + x;
    if (w.water[i] === W_OCEAN) {
      const T = tempAt(w, sim.climate, i, sim.tick);
      let kind = 0;
      if (T < -2) kind = 2;
      else if (T > 25 && rng.chance(0.12 * sim.params.disasters)) kind = 3;
      else if (T > 14 && rng.chance(0.35)) kind = 1;
      spawnStorm(sim, kind, x, y);
    }
  }
  for (let k = sim.storms.length - 1; k >= 0; k--) {
    const s = sim.storms[k];
    const lat = 1 - s.y / (w.h - 1);
    const westerly = lat > 0.3 && lat < 0.72;
    s.vx += ((westerly ? 0.5 : -0.5) - s.vx) * 0.04 + (rng.next() - 0.5) * 0.05;
    s.vy += (rng.next() - 0.5) * 0.04 - s.vy * 0.02 + (s.kind === 3 ? -0.01 : 0);
    s.x += s.vx;
    s.y += s.vy;
    s.life--;
    const xi = Math.round(s.x), yi = Math.round(s.y);
    if (s.life <= 0 || xi < -8 || yi < -8 || xi >= w.w + 8 || yi >= w.h + 8) {
      sim.storms.splice(k, 1);
      continue;
    }
    if ((sim.tick + s.id) % 2 !== 0) continue;
    const overLand = xi >= 0 && yi >= 0 && xi < w.w && yi < w.h && w.water[yi * w.w + xi] === W_LAND;
    if (overLand) s.power *= s.kind === 3 ? 0.985 : 0.996;
    const wet = (s.kind === 3 ? 0.07 : s.kind === 2 ? 0.02 : 0.045) * s.power;
    forDisc(w, s.x, s.y, s.r, (i, d) => {
      if (w.water[i] !== W_LAND) return;
      const f = 1 - d / (s.r + 0.01);
      w.moist[i] = Math.min(1, w.moist[i] + wet * f);
      if (w.fire[i] > 0 && rng.chance(0.5 * f)) {
        w.fire[i] = 1;
      }
      if (s.kind === 3 && f > 0.4) {
        if (w.forest[i] > 0.2 && rng.chance(0.04)) w.forest[i] *= 0.85;
        if (w.imp[i] === I_URBAN && rng.chance(0.03)) {
          const st = sim.settlements.get(w.owner[i]);
          if (st) st.damage = clamp01(st.damage + 0.02 * s.power);
        }
      }
    });
    if (s.kind === 1 && overLand && rng.chance(0.06)) {
      const lx = clamp(Math.round(s.x + (rng.next() - 0.5) * s.r * 1.6), 0, w.w - 1);
      const ly = clamp(Math.round(s.y + (rng.next() - 0.5) * s.r * 1.6), 0, w.h - 1);
      const li = ly * w.w + lx;
      sim.rt.fx.push({ kind: "bolt", x: lx, y: ly, r: 1, t: sim.tick });
      if (w.water[li] === W_LAND && w.moist[li] < 0.42 && (w.forest[li] > 0.25 || w.veg[li] > 0.5) && rng.chance(0.3)) ignite(sim, li);
    }
  }
}
function spawnStorm(sim, kind, x, y, power = 1) {
  const rng = sim.rng;
  const s = {
    id: sim.nextId++,
    kind,
    x,
    y,
    r: kind === 3 ? 9 + rng.int(4) : 4 + rng.int(5),
    vx: 0,
    vy: 0,
    power,
    life: kind === 3 ? 110 + rng.int(80) : 70 + rng.int(120)
  };
  sim.storms.push(s);
  return s;
}
function ignite(sim, i) {
  const w = sim.world;
  if (w.water[i] !== W_LAND || w.fire[i] > 0) return;
  w.fire[i] = 4 + sim.rng.int(4);
  sim.fires.push(i);
  markDirty(sim, i);
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
function civTitle(gov, name, nSettlements) {
  switch (gov) {
    case GOV.band:
      return `${name} Band`;
    case GOV.chiefdom:
      return `${name} Tribes`;
    case GOV.monarchy:
      return nSettlements >= 8 ? `${name} Empire` : `Kingdom of ${name}`;
    case GOV.oligarchy:
      return `${name} League`;
    case GOV.republic:
      return `Republic of ${name}`;
    case GOV.theocracy:
      return `Holy See of ${name}`;
    case GOV.junta:
      return `${name} Dominion`;
    case GOV.democracy:
      return `${name} Commonwealth`;
  }
  return name;
}
function rulerTitle(gov, sex, nSettlements) {
  switch (gov) {
    case GOV.band:
      return "Elder";
    case GOV.chiefdom:
      return sex ? "Chief" : "Chieftess";
    case GOV.monarchy:
      return nSettlements >= 8 ? sex ? "Emperor" : "Empress" : sex ? "King" : "Queen";
    case GOV.oligarchy:
      return "Doge";
    case GOV.republic:
      return "Consul";
    case GOV.theocracy:
      return sex ? "Hierophant" : "Hierophantess";
    case GOV.junta:
      return "Marshal";
    case GOV.democracy:
      return "Premier";
  }
  return "Leader";
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
var DEITIES_BY_ENV = {
  coast: ["the Tide Mother", "the Deep Father", "the Salt Serpent", "the Pearl Queen"],
  desert: ["the Unblinking Sun", "the Sand Walker", "the Noon King"],
  forest: ["the Green Antler", "the Root Mother", "the Thousand Leaves"],
  cold: ["the White Wolf", "the Winter Crone", "the Hearth Keeper"],
  mountain: ["the Stone Father", "the Thunder Peak", "the Sky Forge"],
  river: ["the River Bride", "the Flood Bringer", "the Reed King"],
  plains: ["the Sky Rider", "the Great Herd", "the Grain Mother", "the Endless Wind"],
  disaster: ["the Burning Eye", "the Devourer", "the Hand From Above", "the Wrathful Sky"],
  ancestors: ["the Honored Dead", "the First Mothers", "the Sleeping Kings"],
  star: ["the Seven Stars", "the Moon Weaver", "the Wandering Light"]
};
function deityFor(rng, env) {
  const pool = DEITIES_BY_ENV[env] || DEITIES_BY_ENV.star;
  return rng.pick(rng.chance(0.75) ? pool : rng.chance(0.5) ? DEITIES_BY_ENV.ancestors : DEITIES_BY_ENV.star);
}
function religionName(sim, langId, deity) {
  const l = sim.languages.get(langId);
  const rng = sim.rng;
  const root = cap(word(l, rng, 2, 2));
  const mk = () => rng.pick([`${root}ism`, `Faith of ${deity.replace(/^the /, "the ")}`, `The ${root} Way`, `Cult of ${deity}`, `${root}ite Creed`]);
  return unique(sim, mk(), mk);
}

// src/sim/ecology.ts
var SLICES = 16;
function updateEcology(sim) {
  updateTiles(sim);
  updateFires(sim);
  rebuildHerdGrid(sim);
  updateHerds(sim);
}
function updateTiles(sim) {
  const w = sim.world;
  const c = sim.climate;
  const P = sim.params;
  const rng = sim.rng;
  const W = w.w, H = w.h, n = w.n;
  const per = Math.ceil(n / SLICES);
  const start = sim.vegCursor;
  const end = Math.min(n, start + per);
  sim.vegCursor = end >= n ? 0 : end;
  const tick2 = sim.tick;
  const month = Math.floor(tick2 % TICKS_PER_YEAR / 4);
  for (let i = start; i < end; i++) {
    if (w.water[i] !== W_LAND) {
      const K2 = w.coast[i] || w.elev[i] > w.seaLevel - 0.06 ? 1 : 0.45;
      const f = w.veg[i];
      w.veg[i] = clamp(f + 0.25 * P.wildlife * (f + 0.02) * (1 - f / K2), 0.01, 1);
      if (w.flood[i]) w.flood[i] = 0;
      continue;
    }
    const x = i % W, y = i / W | 0;
    const anomaly = rainAnomaly(w, c, x, y, tick2, P.climateVolatility);
    const T = tempAt(w, c, i, tick2);
    let target = w.rain[i] * anomaly;
    if (w.river[i] > 0) target += 0.2 + w.river[i] / 600;
    if (T > 26) target -= (T - 26) * 0.012;
    if (w.flood[i] > 0) {
      target = 1;
      w.flood[i]--;
      if (w.flood[i] === 0) markDirty(sim, i);
    }
    let m = w.moist[i];
    m += (clamp01(target) - m) * 0.3;
    w.moist[i] = m;
    if (w.river[i] > 70 && anomaly > 1.5 && month >= 1 && month <= 5 && w.flood[i] === 0 && rng.chance(0.012 * P.disasters)) {
      floodAt(sim, i, 2 + Math.floor(w.river[i] / 90));
    }
    const g = growthPotential(w, c, i, tick2) * P.growth;
    const imp = w.imp[i];
    let v = w.veg[i];
    const K = Math.min(1, g * (0.35 + 0.65 * w.fert[i]));
    if (imp === I_URBAN) v *= 0.8;
    else if (K > v) v += 0.4 * (K - v);
    else v -= (T < 2 ? 0.05 : 0.22) * (v - K);
    w.veg[i] = clamp01(v);
    let fo = w.forest[i];
    if (imp !== I_FARM && imp !== I_URBAN && imp !== I_MINE) {
      const mt = meanTemp(w, c, i);
      let fp = clamp01((m - 0.3) * 2.3) * clamp01((mt + 4) / 8) * clamp01((40 - mt) / 6);
      if (w.elev[i] - w.seaLevel + SEA > MOUNTAIN) fp *= 0.2;
      if (fo < fp) {
        let nf = 0;
        if (x > 0) nf += w.forest[i - 1];
        if (x < W - 1) nf += w.forest[i + 1];
        if (y > 0) nf += w.forest[i - W];
        if (y < H - 1) nf += w.forest[i + W];
        fo += 0.03 * (0.3 + g) * (nf * 0.5 + fo + 0.04) * P.growth * (0.4 + 0.6 * w.fert[i]) * (imp === I_PASTURE ? 0.3 : 1);
        if (fo > fp) fo = fp;
      } else fo -= 0.03 * (fo - fp) + (m < 0.15 ? 0.01 : 0);
      w.forest[i] = clamp01(fo);
    } else if (fo > 0) w.forest[i] = fo * 0.7;
    let fe = w.fert[i];
    const cover = v + fo;
    if (cover > 0.5 && imp !== I_FARM) fe += 12e-4 * (1 - fe);
    if (cover < 0.12 && m < 0.2) fe -= 4e-3 * fe;
    if (cover < 0.3 && w.rain[i] * anomaly > 0.6) {
      const f = w.flow[i];
      if (f >= 0) {
        const slope = w.elev[i] - w.elev[f];
        if (slope > 0.012) {
          const lost = Math.min(fe * 0.02, slope * 0.05);
          fe -= lost;
          if (w.water[f] === W_LAND) w.fert[f] = Math.min(1, w.fert[f] + lost * 0.8);
          w.elev[i] -= lost * 4e-3;
        }
      }
    }
    w.fert[i] = clamp(fe, 0.01, 1);
    if (rng.chance(0.03)) {
      const want = clamp(meanTemp(w, c, i) + 5, 4, 30);
      const cur = w.flora[i];
      if (want > cur + 0.5) w.flora[i] = cur + 1;
      else if (want < cur - 0.5) w.flora[i] = cur - 1;
    }
    if (T > 25 && m < 0.16 && (fo > 0.35 || v > 0.55) && rng.chance(35e-5 * P.disasters)) ignite(sim, i);
    const b = classifyBiome(w, c, i);
    if (b !== w.biome[i]) w.biome[i] = b;
  }
}
function floodAt(sim, i, r) {
  const w = sim.world;
  const x0 = i % w.w, y0 = i / w.w | 0;
  const base = w.elev[i];
  let hitSettlement = -1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
      const j = y * w.w + x;
      if (w.water[j] !== W_LAND || w.elev[j] > base + 0.012) continue;
      if (w.flood[j] === 0) markDirty(sim, j);
      w.flood[j] = 3;
      w.fert[j] = Math.min(1, w.fert[j] + 0.03);
      if (w.owner[j] >= 0 && (w.imp[j] === I_FARM || w.imp[j] === I_URBAN)) hitSettlement = w.owner[j];
    }
  }
  if (hitSettlement >= 0) {
    const s = sim.settlements.get(hitSettlement);
    if (s && s.alive) {
      s.damage = clamp01(s.damage + 0.04);
      s.stock[0] *= 0.85;
      if (sim.tick - s.growthNote > 96) {
        s.growthNote = sim.tick;
        addEvent(sim, "flood", 2, `The river burst its banks at ${s.name}, drowning fields and stores.`, [s.civ], [], s.id, s.x, s.y);
      }
    }
  }
}
function updateFires(sim) {
  const w = sim.world;
  const rng = sim.rng;
  if (sim.fires.length === 0 || sim.tick % 2 !== 0) return;
  const next = [];
  const W = w.w, H = w.h;
  for (let k = 0; k < sim.fires.length; k++) {
    const i = sim.fires[k];
    if (w.fire[i] === 0) continue;
    const x = i % W, y = i / W | 0;
    w.forest[i] *= 0.72;
    w.veg[i] *= 0.5;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (w.water[j] !== W_LAND || w.fire[j] > 0) continue;
      const fuel = w.forest[j] * 0.9 + w.veg[j] * 0.45 + (w.imp[j] === I_URBAN ? 0.35 : 0);
      const dry = clamp01(1.1 - w.moist[j] * 1.9);
      if (fuel > 0.12 && rng.chance(0.24 * fuel * dry * (d < 4 ? 1 : 0.6))) {
        w.fire[j] = 3 + rng.int(4);
        next.push(j);
        markDirty(sim, j);
      }
    }
    if (w.imp[i] === I_URBAN) {
      const s = sim.settlements.get(w.owner[i]);
      if (s && s.alive) {
        s.damage = clamp01(s.damage + 0.03);
        if (sim.tick - s.growthNote > 96) {
          s.growthNote = sim.tick;
          addEvent(sim, "fire", 2, `Fire swept through ${s.name}.`, [s.civ], [], s.id, s.x, s.y);
        }
      }
    } else if (w.imp[i] === I_FARM) {
      const s = sim.settlements.get(w.owner[i]);
      if (s && s.alive) s.stock[0] *= 0.985;
    }
    w.fire[i]--;
    if (w.fire[i] > 0) next.push(i);
    else {
      w.fert[i] = Math.min(1, w.fert[i] + 0.02);
      markDirty(sim, i);
    }
  }
  sim.fires = next;
}
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
var CELL = 8;
function herdCell(sim, x, y) {
  return Math.floor(y / CELL) * 4096 + Math.floor(x / CELL);
}
function rebuildHerdGrid(sim) {
  const g = sim.rt.herdGrid;
  g.clear();
  for (const h of sim.herds.values()) {
    const k = herdCell(sim, h.x, h.y);
    const a = g.get(k);
    if (a) a.push(h.id);
    else g.set(k, [h.id]);
  }
}
function herdsNear(sim, x, y, radius, out) {
  out.length = 0;
  const g = sim.rt.herdGrid;
  const c0x = Math.floor((x - radius) / CELL), c1x = Math.floor((x + radius) / CELL);
  const c0y = Math.floor((y - radius) / CELL), c1y = Math.floor((y + radius) / CELL);
  const r2 = radius * radius;
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const a = g.get(cy * 4096 + cx);
      if (!a) continue;
      for (const id of a) {
        const h = sim.herds.get(id);
        if (!h || h.n <= 0) continue;
        const dx = h.x - x, dy = h.y - y;
        if (dx * dx + dy * dy <= r2) out.push(h);
      }
    }
  }
  return out;
}
var tmpHerds = [];
function updateHerds(sim) {
  const w = sim.world;
  const c = sim.climate;
  const rng = sim.rng;
  const phase = sim.tick % 4;
  const W = w.w, H = w.h;
  let landTiles = 0;
  landTiles = w.n * 0.35;
  const maxHerds = Math.floor(landTiles / 28 * sim.params.wildlife) + 20;
  const dead = [];
  let predHerds = 0;
  const perSpecies = /* @__PURE__ */ new Map();
  for (const h of sim.herds.values()) {
    perSpecies.set(h.sp, (perSpecies.get(h.sp) || 0) + 1);
    if (sim.species.get(h.sp).diet === 1) predHerds++;
  }
  for (const h of sim.herds.values()) {
    if (h.id % 4 !== phase) continue;
    const sp = sim.species.get(h.sp);
    if (h.n <= 0) {
      dead.push(h.id);
      continue;
    }
    let xi = clamp(Math.round(h.x), 0, W - 1), yi = clamp(Math.round(h.y), 0, H - 1);
    let i = yi * W + xi;
    const before = h.n;
    if (w.water[i] !== W_LAND) {
      h.n = Math.floor(h.n * 0.5);
      h.energy -= 0.2;
    }
    const T = tempAt(w, c, i, sim.tick);
    const tol = 13 + h.size * 4;
    const dT = T - h.cold;
    const stress = Math.max(0, Math.abs(dT + (dT < 0 ? h.size * 5 : -2)) - tol);
    h.energy -= stress * 0.012;
    const need = h.n * (0.25 + h.size) * (1 + h.speed * 0.3) * 28e-4;
    if (sp.diet !== 1) {
      let got = 0;
      const avail = w.veg[i] * (sp.diet === 2 ? 0.5 : 0.8);
      got = Math.min(need, avail);
      w.veg[i] -= got;
      if (w.fire[i] > 0) {
        h.n = Math.floor(h.n * 0.7);
        h.energy -= 0.2;
      }
      h.energy += (got / (need + 1e-6) - 0.55) * 0.3;
      if (sp.diet === 2) h.energy += 0.04;
    } else {
      if (h.energy > 0.85) h.energy -= 0.03;
      else {
        herdsNear(sim, h.x, h.y, 6, tmpHerds);
        let best = null, bestScore = 0.12;
        const pack = 1 - Math.min(1, h.n / 10) * 0.5;
        for (const o of tmpHerds) {
          if (o.id === h.id) continue;
          const osp = sim.species.get(o.sp);
          if (osp.diet === 1) continue;
          const sc = 0.55 + (h.speed - o.speed) * 0.5 + h.fierce * 0.2 - Math.max(0, o.size - h.size - 0.05) * 1.6 * pack - o.fierce * 0.3 - (o.n < 8 ? 0.25 : 0);
          if (sc > bestScore) {
            bestScore = sc;
            best = o;
          }
        }
        if (best && rng.chance(clamp01(bestScore))) {
          const osp = sim.species.get(best.sp);
          const want = Math.max(1, Math.ceil(h.n * (0.3 + h.size) * 0.2 / (0.2 + best.size)));
          const kills = Math.min(want, Math.ceil(best.n * 0.25));
          best.n -= kills;
          osp.count -= kills;
          h.energy += kills * (0.2 + best.size) / (h.n * (0.3 + h.size)) * 1.4;
          best.energy -= 0.03;
        } else h.energy -= 0.045;
      }
    }
    h.energy = clamp(h.energy, 0, 1);
    const month = Math.floor(sim.tick % TICKS_PER_YEAR / 4);
    const breeding = meanTemp(w, c, i) > 20 || month >= 1 && month <= 5;
    if (breeding && h.energy > 0.55) {
      const exp = h.n * h.fecund * 0.075 * (h.energy - 0.3) * sim.params.wildlife;
      h.n += Math.floor(exp) + (rng.chance(exp % 1) ? 1 : 0);
    }
    if (h.energy < 0.22) h.n -= Math.max(1, Math.ceil(h.n * 0.1));
    {
      const exp = h.n * (sp.diet === 1 ? 5e-3 : 8e-3) * (1.2 - h.size * 0.9) * (1 + stress * 0.1);
      h.n -= Math.floor(exp) + (rng.chance(exp % 1) ? 1 : 0);
    }
    if (h.n <= 0) {
      sp.count += -before;
      dead.push(h.id);
      continue;
    }
    if (h.n > sp.herd * 1.8) {
      const mine = perSpecies.get(sp.id) || 0;
      const room = sim.herds.size < maxHerds && mine < maxHerds * 0.22 && (sp.diet !== 1 || predHerds < maxHerds * 0.14);
      if (room) {
        perSpecies.set(sp.id, mine + 1);
        if (sp.diet === 1) predHerds++;
        const half = Math.floor(h.n / 2);
        h.n -= half;
        const nh = spawnHerd(sim, sp, h.x, h.y, half);
        const mut = 1;
        nh.size = clamp(h.size + rng.gauss() * 0.014 * mut, 0.05, 1);
        nh.speed = clamp(h.speed + rng.gauss() * 0.014 * mut, 0.1, 1);
        nh.cold = clamp(h.cold + rng.gauss() * 0.5 * mut, -25, 34);
        nh.fecund = clamp(h.fecund + rng.gauss() * 0.012 * mut, 0.1, 1.2);
        nh.fierce = clamp(h.fierce + rng.gauss() * 0.012 * mut, 0, 1);
        nh.energy = h.energy;
        const a = rng.range(0, Math.PI * 2);
        nh.tx = clamp(h.x + Math.cos(a) * 9, 1, W - 2);
        nh.ty = clamp(h.y + Math.sin(a) * 9, 1, H - 2);
        maybeSpeciate(sim, nh);
      } else h.n = Math.floor(sp.herd * 1.8);
    }
    sp.count += h.n - before;
    if (rng.chance(0.2) || Math.abs(h.x - h.tx) < 1 && Math.abs(h.y - h.ty) < 1) {
      let bx = h.x, by = h.y, bs = -1e9;
      for (let k = 0; k < 6; k++) {
        const a = rng.range(0, Math.PI * 2);
        const dd = 3 + rng.int(8);
        const tx = clamp(Math.round(h.x + Math.cos(a) * dd), 1, W - 2);
        const ty = clamp(Math.round(h.y + Math.sin(a) * dd), 1, H - 2);
        const j = ty * W + tx;
        if (w.water[j] !== W_LAND) continue;
        const Tj = tempAt(w, c, j, sim.tick);
        let s = -Math.abs(Tj - h.cold) * 0.09;
        if (sp.diet !== 1) s += w.veg[j] * 2.2;
        else s += rng.next() * 0.5;
        if (w.imp[j] === I_URBAN) s -= 3;
        else if (w.owner[j] >= 0) s -= 0.5;
        if (w.elev[j] - w.seaLevel + SEA > MOUNTAIN) s -= 1.5;
        if (s > bs) {
          bs = s;
          bx = tx;
          by = ty;
        }
      }
      if (sp.diet === 1 && h.energy < 0.85) {
        herdsNear(sim, h.x, h.y, 22, tmpHerds);
        let bd = 1e9;
        for (const o of tmpHerds) {
          if (sim.species.get(o.sp).diet === 1) continue;
          const d = (o.x - h.x) * (o.x - h.x) + (o.y - h.y) * (o.y - h.y);
          if (d < bd) {
            bd = d;
            bx = o.x;
            by = o.y;
          }
        }
      }
      h.tx = bx;
      h.ty = by;
    }
    const dx = h.tx - h.x, dy = h.ty - h.y;
    const dl = Math.hypot(dx, dy);
    if (dl > 0.01) {
      const step = Math.min(dl, 0.6 + h.speed * 1.6);
      const nx = h.x + dx / dl * step, ny = h.y + dy / dl * step;
      const j = clamp(Math.round(ny), 0, H - 1) * W + clamp(Math.round(nx), 0, W - 1);
      if (w.water[j] === W_LAND) {
        h.x = nx;
        h.y = ny;
      } else {
        h.tx = h.x;
        h.ty = h.y;
      }
    }
  }
  for (const id of dead) {
    const h = sim.herds.get(id);
    if (!h) continue;
    sim.herds.delete(id);
    const sp = sim.species.get(h.sp);
    checkExtinction(sim, sp);
  }
}
function recountSpecies(sim) {
  for (const sp of sim.species.values()) sp.count = 0;
  for (const h of sim.herds.values()) {
    const sp = sim.species.get(h.sp);
    if (sp) sp.count += Math.max(0, h.n);
  }
  for (const sp of sim.species.values()) if (sp.count === 0 && sp.extinct < 0 && sim.tick - sp.born > 48) sp.extinct = sim.tick;
}
function checkExtinction(sim, sp) {
  if (sp.extinct >= 0) return;
  for (const h of sim.herds.values()) if (h.sp === sp.id && h.n > 0) return;
  sp.extinct = sim.tick;
  sp.count = 0;
  addEvent(sim, "extinct", 3, `The last ${sp.name} has died. The species is extinct.`, [], [], -1, -1, -1);
}
function maybeSpeciate(sim, h) {
  const sp = sim.species.get(h.sp);
  const d = Math.abs(h.cold - sp.cold) / 7 + Math.abs(h.size - sp.size) / 0.22 + Math.abs(h.speed - sp.speed) / 0.25 + Math.abs(h.fierce - sp.fierce) / 0.3;
  if (d < 2) return;
  let live = 0;
  for (const s of sim.species.values()) if (s.extinct < 0) live++;
  if (live > 40) return;
  const shape = sp.shape === 3 && h.size < 0.7 ? 0 : sp.shape === 0 && h.size > 0.88 ? 3 : sp.shape;
  const nsp = createSpecies(sim, { parent: sp.id, diet: sp.diet, size: h.size, speed: h.speed, cold: h.cold, fecund: h.fecund, fierce: h.fierce, herd: sp.herd, shape });
  for (const o of sim.herds.values()) {
    if (o.sp !== sp.id) continue;
    const dn = Math.abs(o.cold - nsp.cold) / 7 + Math.abs(o.size - nsp.size) / 0.22 + Math.abs(o.speed - nsp.speed) / 0.25;
    const dp = Math.abs(o.cold - sp.cold) / 7 + Math.abs(o.size - sp.size) / 0.22 + Math.abs(o.speed - sp.speed) / 0.25;
    if (dn < dp && Math.hypot(o.x - h.x, o.y - h.y) < 40) {
      o.sp = nsp.id;
      sp.count -= o.n;
      nsp.count += o.n;
    }
  }
  const what = h.cold < sp.cold - 3 ? "cold-hardy" : h.cold > sp.cold + 3 ? "heat-loving" : h.size > sp.size + 0.08 ? "larger" : h.size < sp.size - 0.08 ? "smaller" : h.speed > sp.speed ? "swifter" : "distinct";
  addEvent(sim, "species", 2, `A ${what} lineage of ${sp.name} has become a new species: the ${nsp.name}.`, [], [], -1, Math.round(h.x), Math.round(h.y));
}

// src/sim/people.ts
function ageOf(sim, p) {
  return (sim.tick - p.born) / TICKS_PER_YEAR;
}
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
function jobSkill(p, job) {
  switch (job) {
    case J.farmer:
    case J.fisher:
    case J.hunter:
    case J.herder:
    case J.woodcutter:
    case J.miner:
      return p.sFarm;
    case J.artisan:
      return p.sCraft;
    case J.merchant:
      return p.sTrade;
    case J.soldier:
      return p.sFight;
    case J.scholar:
      return p.sLore;
    case J.priest:
      return (p.sLore + p.cha) / 2;
    case J.official:
      return p.sLead;
  }
  return 0.3;
}
function practice(p, job, rate) {
  const r = rate * (0.5 + p.intl * 0.6 + p.dil * 0.4);
  switch (job) {
    case J.farmer:
    case J.fisher:
    case J.hunter:
    case J.herder:
    case J.woodcutter:
    case J.miner:
      p.sFarm += r * (1 - p.sFarm);
      break;
    case J.artisan:
      p.sCraft += r * (1 - p.sCraft);
      break;
    case J.merchant:
      p.sTrade += r * (1 - p.sTrade);
      break;
    case J.soldier:
      p.sFight += r * 0.6 * (1 - p.sFight);
      p.sLead += r * 0.15 * (1 - p.sLead);
      break;
    case J.scholar:
      p.sLore += r * (1 - p.sLore);
      break;
    case J.priest:
      p.sLore += r * 0.5 * (1 - p.sLore);
      p.sLead += r * 0.3 * (1 - p.sLead);
      break;
    case J.official:
      p.sLead += r * (1 - p.sLead);
      break;
  }
}
function aptitude(p, job) {
  switch (job) {
    case J.farmer:
    case J.herder:
      return 0.75 + p.sFarm * 0.5 + p.dil * 0.2;
    case J.fisher:
    case J.hunter:
      return 0.7 + p.sFarm * 0.4 + p.bold * 0.25;
    case J.woodcutter:
    case J.miner:
      return 0.7 + p.sFarm * 0.4 + p.dil * 0.25;
    case J.artisan:
      return 0.55 + p.sCraft * 0.6 + p.intl * 0.3 + p.dil * 0.15;
    case J.merchant:
      return 0.4 + p.sTrade * 0.6 + p.greed * 0.35 + p.cha * 0.25;
    case J.soldier:
      return 0.45 + p.sFight * 0.6 + p.bold * 0.5;
    case J.scholar:
      return 0.2 + p.sLore * 0.6 + p.intl * 0.9;
    case J.priest:
      return 0.3 + p.piety * 0.8 + p.cha * 0.3;
    case J.official:
      return 0.3 + p.sLead * 0.6 + p.amb * 0.4 + p.cha * 0.2;
  }
  return 0.6;
}
var GOAL_JOB = [];
GOAL_JOB[GOAL.family] = [J.farmer, J.herder];
GOAL_JOB[GOAL.wealth] = [J.merchant, J.artisan];
GOAL_JOB[GOAL.power] = [J.official, J.soldier, J.priest];
GOAL_JOB[GOAL.knowledge] = [J.scholar];
GOAL_JOB[GOAL.glory] = [J.soldier, J.hunter];
GOAL_JOB[GOAL.faith] = [J.priest];
GOAL_JOB[GOAL.wander] = [J.merchant, J.hunter, J.fisher];
function chooseJob(sim, p, s, civ, ctx, force = false) {
  if (p.title === TITLE.ruler || p.army >= 0) return;
  const cur = p.job;
  if (!force && civ.laws.serfdom && cur === J.farmer && p.fed > 0.45) return;
  let best = cur === J.child ? J.laborer : cur, bestU = -1;
  const parentJob = sim.people.get(p.father)?.job ?? sim.people.get(p.mother)?.job ?? -1;
  const gj = GOAL_JOB[p.goal];
  for (let j = 1; j < NJ; j++) {
    if (j !== cur && ctx.slots[j] <= 0) continue;
    if (j === J.merchant && j !== cur && p.wealth < ctx.subsistence * 6) continue;
    if (j === J.scholar && j !== cur && p.intl < 0.5) continue;
    if (j === J.official && j !== cur && p.wealth < ctx.subsistence * 4 && p.sLead < 0.3 && !civ.laws.schooling) continue;
    let u = ctx.wage[j] * aptitude(p, j);
    if (gj.indexOf(j) >= 0) u *= 1.45;
    if (j === parentJob) u *= 1.12;
    if (j === cur) u *= 1.18;
    if (j === J.laborer) u *= 0.8;
    if (u > bestU) {
      bestU = u;
      best = j;
    }
  }
  if (best !== cur) setJob(sim, p, s, best, ctx);
}
function setJob(sim, p, s, job, ctx) {
  const cur = p.job;
  if (cur === job) return;
  if (s) {
    s.jobCount[cur] = Math.max(0, s.jobCount[cur] - 1);
    s.jobCount[job]++;
  }
  if (ctx) {
    ctx.slots[cur]++;
    ctx.slots[job]--;
  }
  p.job = job;
  if (cur !== J.child && job !== J.laborer) remember(p, sim.tick, M.job, job);
}
function deathChance(sim, p, age, civ) {
  const m = civ?.mods;
  const ht = m ? Math.min(0.85, m.health) : 0;
  let q;
  if (age < 1.5) q = 0.11;
  else if (age < 5) q = 0.022;
  else if (age < 15) q = 6e-3;
  else if (age < 40) q = 55e-4;
  else if (age < 60) q = 0.012 + (age - 40) * 12e-4;
  else q = 0.04 * Math.pow(1.095, age - 60 - (m ? m.lifespan : 0));
  q *= age < 15 ? 1 - ht * 0.9 : 1 - ht * 0.45;
  q *= 1 + (1 - p.health) * 2.5;
  return Math.min(0.95, q * sim.params.mortality);
}
function killPerson(sim, p, cause) {
  if (!sim.people.has(p.id)) return;
  sim.people.delete(p.id);
  sim.totalDied++;
  const s = sim.settlements.get(p.home);
  if (s) {
    const k = s.people.indexOf(p.id);
    if (k >= 0) {
      s.people[k] = s.people[s.people.length - 1];
      s.people.pop();
    }
    s.jobCount[p.job] = Math.max(0, s.jobCount[p.job] - 1);
  }
  if (p.army >= 0) {
    const a = sim.armies.get(p.army);
    if (a) {
      const k = a.soldiers.indexOf(p.id);
      if (k >= 0) a.soldiers.splice(k, 1);
    }
  }
  if (p.party >= 0) {
    const pt = sim.parties.get(p.party);
    if (pt) {
      const k = pt.people.indexOf(p.id);
      if (k >= 0) pt.people.splice(k, 1);
    }
  }
  const sp = sim.people.get(p.spouse);
  if (sp) {
    sp.spouse = -1;
    sp.happy = Math.max(0, sp.happy - 0.2);
    remember(sp, sim.tick, M.widowed, p.id);
    sp.wealth += p.wealth * 0.8;
    p.wealth = 0;
  }
  const age = ageOf(sim, p);
  let heirs = 0;
  for (const kid of p.kids) if (sim.people.has(kid)) heirs++;
  for (const kid of p.kids) {
    const c = sim.people.get(kid);
    if (!c) continue;
    if (p.wealth > 0) c.wealth += p.wealth * 0.9 / heirs;
    if (ageOf(sim, c) < 30) remember(c, sim.tick, M.lostParent, p.id);
  }
  if (age < 18) {
    for (const pid of [p.mother, p.father]) {
      const par = sim.people.get(pid);
      if (par) {
        par.happy = Math.max(0, par.happy - 0.15);
        remember(par, sim.tick, M.lostChild, p.id);
      }
    }
  }
  const fam = sim.families.get(p.fam);
  if (fam) fam.living = Math.max(0, fam.living - 1);
  const notable = p.fame >= 4 || p.title !== TITLE.none;
  if (notable || heirs > 0) {
    const g = {
      id: p.id,
      name: p.name,
      fam: p.fam,
      sex: p.sex,
      born: p.born,
      died: sim.tick,
      cause,
      mother: p.mother,
      father: p.father,
      kids: p.kids,
      civ: p.civ,
      home: s ? s.name : "the road",
      job: p.job,
      title: p.title,
      fame: p.fame,
      mem: p.mem,
      notable
    };
    sim.graves.set(p.id, g);
  }
  if (p.title === TITLE.ruler) {
    const civ = sim.civs.get(p.civ);
    if (civ && civ.ruler === p.id) {
      civ.ruler = -1;
      sim.rt.pending.push({ civ: civ.id, prev: p.id, cause });
    }
  }
}
function pruneGraves(sim) {
  const cutoff = sim.tick - 130 * TICKS_PER_YEAR;
  for (const [id, g] of sim.graves) {
    if (g.notable && g.fame >= 4) continue;
    if (g.died < cutoff) sim.graves.delete(id);
  }
  for (const [id, f] of sim.families) {
    if (f.living <= 0 && f.prestige < 3 && f.thrones === 0) sim.families.delete(id);
  }
}
function addFame(sim, p, amount) {
  p.fame += amount;
  const f = sim.families.get(p.fam);
  if (f) f.prestige += amount * 0.5;
}
function isKin(a, b) {
  if (a.mother >= 0 && a.mother === b.mother) return true;
  if (a.father >= 0 && a.father === b.father) return true;
  return a.mother === b.id || a.father === b.id || b.mother === a.id || b.father === a.id;
}
function tryMarry(sim, p, s, age) {
  const rng = sim.rng;
  if (s.people.length < 2) return;
  for (let t = 0; t < 7; t++) {
    const q = sim.people.get(s.people[rng.int(s.people.length)]);
    if (!q || q.id === p.id || q.sex === p.sex || q.spouse >= 0 || q.party >= 0) continue;
    const qa = ageOf(sim, q);
    if (qa < ADULT_AGE + 1 || Math.abs(qa - age) > 14 || isKin(p, q)) continue;
    const gap = Math.abs(Math.log((p.wealth + 5) / (q.wealth + 5)));
    let chance = 0.75 - gap * 0.25 + (p.cha + q.cha - 1) * 0.3;
    if (p.religion !== q.religion) chance -= 0.2;
    if (p.culture !== q.culture) chance -= 0.15;
    if (!rng.chance(chance)) continue;
    p.spouse = q.id;
    q.spouse = p.id;
    remember(p, sim.tick, M.married, q.id);
    remember(q, sim.tick, M.married, p.id);
    p.happy = Math.min(1, p.happy + 0.1);
    q.happy = Math.min(1, q.happy + 0.1);
    return;
  }
}
function socialize(sim, p, s) {
  const rng = sim.rng;
  if (p.friends.length) p.friends = p.friends.filter((id) => sim.people.has(id));
  if (p.rivals.length) p.rivals = p.rivals.filter((id) => sim.people.has(id));
  if (s.people.length < 3) return;
  if (p.friends.length < 3 && rng.chance(0.15 + p.cha * 0.3)) {
    const q = sim.people.get(s.people[rng.int(s.people.length)]);
    if (q && q.id !== p.id && q.job !== J.child && p.friends.indexOf(q.id) < 0 && p.rivals.indexOf(q.id) < 0) {
      const affinity = 1 - (Math.abs(p.piety - q.piety) + Math.abs(p.bold - q.bold) + Math.abs(p.greed - q.greed)) / 3 + (p.job === q.job ? 0.2 : 0);
      if (rng.chance(affinity * 0.8)) {
        p.friends.push(q.id);
        if (q.friends.length < 3 && q.friends.indexOf(p.id) < 0) q.friends.push(p.id);
        if (p.fame >= 4 || q.fame >= 4) remember(p, sim.tick, M.friend, q.id);
      }
    }
  }
  if (p.rivals.length < 2 && rng.chance(0.03 + p.amb * 0.12)) {
    const q = sim.people.get(s.people[rng.int(s.people.length)]);
    if (q && q.id !== p.id && q.job === p.job && q.job !== J.child && p.friends.indexOf(q.id) < 0 && p.rivals.indexOf(q.id) < 0) {
      if (q.wealth > p.wealth || q.title > 0 || q.faction !== p.faction) {
        p.rivals.push(q.id);
        if (q.rivals.length < 2) q.rivals.push(p.id);
        if (p.fame >= 4 || q.fame >= 4) remember(p, sim.tick, M.rival, q.id);
      }
    }
  }
}
function politicalWeight(p) {
  let w = 1 + Math.sqrt(Math.max(0, p.wealth)) * 0.25;
  if (p.job === J.soldier) w += 1.5;
  if (p.title === TITLE.noble) w += 6;
  else if (p.title === TITLE.governor) w += 10;
  else if (p.title === TITLE.general) w += 9;
  else if (p.title === TITLE.highPriest) w += 9;
  else if (p.title === TITLE.ruler) w += 25;
  w += p.fame * 0.5;
  return w;
}
function alignFaction(sim, p) {
  const sc = [0, 0, 0, 0, 0];
  sc[F.crown] = (p.title === TITLE.noble || p.title === TITLE.governor || p.job === J.official ? 1 : 0) + p.loyalty * 0.8 - 0.3;
  sc[F.military] = (p.job === J.soldier ? 1 : 0) + p.bold * 0.5 + p.sFight * 0.4 - 0.3;
  sc[F.guilds] = (p.job === J.merchant ? 1.1 : p.job === J.artisan ? 0.7 : p.job === J.scholar ? 0.6 : 0) + p.greed * 0.4 - 0.2;
  sc[F.clergy] = (p.job === J.priest ? 1.2 : 0) + p.piety * 0.9 - 0.45;
  sc[F.commons] = (p.job === J.farmer || p.job === J.laborer || p.job === J.fisher || p.job === J.herder || p.job === J.hunter || p.job === J.woodcutter || p.job === J.miner ? 0.75 : 0) + (0.6 - p.loyalty) * 0.5 + p.comp * 0.2;
  for (const fid of p.friends) {
    const f = sim.people.get(fid);
    if (f) sc[f.faction] += 0.2 + f.cha * 0.2;
  }
  let best = 0;
  for (let k = 1; k < 5; k++) if (sc[k] > sc[best]) best = k;
  p.faction = best;
}
function considerFaith(sim, p, s, civ) {
  const rng = sim.rng;
  for (const fid of p.friends) {
    const f = sim.people.get(fid);
    if (!f || f.religion === p.religion || f.religion < 0) continue;
    const rel = sim.religions.get(f.religion);
    if (!rel) continue;
    if (rng.chance(0.06 + f.cha * 0.2 + rel.proselytize * 0.15 - p.piety * 0.12)) {
      p.religion = f.religion;
      remember(p, sim.tick, M.converted, f.religion);
      return;
    }
  }
  const pressure = s.religionMajor >= 0 && s.religionMajor !== p.religion ? 0.03 : 0;
  const state = civ.religion >= 0 && civ.religion !== p.religion && !civ.laws.tolerance ? 0.04 : 0;
  if (pressure + state > 0 && rng.chance((pressure + state) * (1.3 - p.piety))) {
    p.religion = state > 0 && rng.chance(0.6) ? civ.religion : s.religionMajor;
    remember(p, sim.tick, M.converted, p.religion);
  }
}
function yearlyLife(sim, p, s, civ, age, ctx) {
  const rng = sim.rng;
  if (rng.chance(deathChance(sim, p, age, civ)) || age > 97) {
    killPerson(sim, p, age > 62 ? "old age" : age < 5 ? "a childhood fever" : p.health < 0.5 ? "illness" : rng.pick(["an accident", "a fever", "illness", "a wasting sickness"]));
    return false;
  }
  p.health = clamp01(p.health + (age > 55 ? -0.015 : 0.03));
  if (age < ADULT_AGE) return true;
  if (p.job === J.child) {
    p.job = J.laborer;
    s.jobCount[J.child] = Math.max(0, s.jobCount[J.child] - 1);
    s.jobCount[J.laborer]++;
    p.wealth = 1;
    p.sFarm = 0.08;
    p.goal = pickGoal(sim, p);
    chooseJob(sim, p, s, civ, ctx, true);
  }
  if (p.party >= 0 || p.army >= 0) return true;
  if (p.spouse < 0 && age < 50 && rng.chance(age < 30 ? 0.45 : 0.2)) tryMarry(sim, p, s, age);
  socialize(sim, p, s);
  alignFaction(sim, p);
  if (rng.chance(0.3)) considerFaith(sim, p, s, civ);
  let lt = 0.5 + (p.happy - 0.5) * 0.7 - civ.laws.tax * 0.35 + (civ.legitimacy - 0.5) * 0.3 - civ.exhaustion * 0.2;
  if (p.culture !== civ.culture) lt -= 0.12 + (civ.era >= 5 && civ.tech.length ? 0.06 : 0);
  if (civ.religion >= 0 && p.religion !== civ.religion && !civ.laws.tolerance) lt -= 0.12;
  if (p.faction === civ.rulingFaction) lt += 0.1;
  if (s.originalCiv !== s.civ && p.civ !== s.civ) lt -= 0.2;
  const ruler = sim.people.get(civ.ruler);
  if (ruler) {
    lt += (ruler.cha - 0.5) * 0.15;
    if (p.friends.indexOf(ruler.id) >= 0) lt += 0.25;
    if (p.rivals.indexOf(ruler.id) >= 0) lt -= 0.3;
  }
  p.loyalty = clamp01(p.loyalty + (clamp01(lt) - p.loyalty) * 0.35);
  const myWage = ctx.wage[p.job];
  if (p.job === J.laborer || myWage < ctx.avgWage * 0.6 || rng.chance(0.08 + p.amb * 0.1)) chooseJob(sim, p, s, civ, ctx);
  if (age > 68 && p.job !== J.laborer && p.title === TITLE.none && rng.chance(0.3)) setJob(sim, p, s, J.laborer, ctx);
  if (p.title !== TITLE.ruler && p.title !== TITLE.governor && !(p.spouse >= 0 && p.sex === 0)) {
    let push = (1 - p.fed) * 1.6 + (0.5 - p.happy) * 0.8 + (p.job === J.laborer ? 0.2 : 0) + s.unrest * 0.25 + ctx.danger * 0.5 + Math.max(0, ctx.crowd - 0.95) * 1.2;
    push -= 0.32 + Math.min(0.25, age * 4e-3) + p.kids.length * 0.02 + (p.title ? 0.4 : 0);
    if (p.goal === GOAL.wander) push += 0.15;
    if (civ.laws.serfdom && p.job === J.farmer && p.fed > 0.4) push -= 0.5;
    if (push > 0.3 - p.bold * 0.25 && rng.chance(clamp(push, 0.05, 0.9))) ctx.migrate(p, push);
  }
  return true;
}
function tryBirth(sim, mother, s, civ, chance) {
  const father = sim.people.get(mother.spouse);
  if (!father || father.home !== mother.home) return null;
  let live = 0;
  for (const k of mother.kids) if (sim.people.has(k)) live++;
  if (live >= 4) chance *= live >= 7 ? 0.1 : 0.55;
  if (!sim.rng.chance(chance)) return null;
  let culture = mother.culture;
  if (father.culture !== mother.culture) culture = sim.rng.chance(0.5) ? father.culture : mother.culture;
  else if (s.cultureMajor >= 0 && s.cultureMajor !== culture && sim.rng.chance(0.25)) culture = s.cultureMajor;
  const religion = sim.rng.chance(0.5) ? mother.religion : father.religion;
  const child = createPerson(sim, { home: s.id, civ: s.civ, culture, religion, mother, father });
  remember(mother, sim.tick, M.child, child.id);
  remember(father, sim.tick, M.child, child.id);
  mother.happy = Math.min(1, mother.happy + 0.08);
  return child;
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
function leaveHome(sim, p) {
  const from = sim.settlements.get(p.home);
  if (from) {
    const k = from.people.indexOf(p.id);
    if (k >= 0) {
      from.people[k] = from.people[from.people.length - 1];
      from.people.pop();
    }
    from.jobCount[p.job] = Math.max(0, from.jobCount[p.job] - 1);
  }
  p.home = -1;
}

// src/sim/tech.ts
var TIER_COST = [0, 40, 150, 600, 2e3, 6e3, 15e3, 32e3, 62e3];
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
function techCost(id) {
  return TIER_COST[TECHS[id].tier];
}
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
function civEnv(sim, c) {
  const w = sim.world;
  const e = {
    coastal: false,
    river: false,
    hills: false,
    farmland: false,
    forest: false,
    domestic: false,
    ridable: false,
    has: [false, false, false, false, false, false, false, false],
    pop: c.pop,
    cities: c.settlements.length,
    contacts: 0,
    tradeVal: 0,
    threatened: false,
    arid: false,
    metalTools: c.mods.toolQ >= 1.3
  };
  let farmable = 0, forest = 0, dry = 0, tiles = 0;
  const tmp = [];
  for (const sid of c.settlements) {
    const s = sim.settlements.get(sid);
    if (!s || !s.alive) continue;
    if (s.coastal) e.coastal = true;
    if (s.river) e.river = true;
    for (const i of s.tiles) {
      tiles++;
      if (w.elev[i] - w.seaLevel + SEA > HILL) e.hills = true;
      if (w.res[i] && w.resAmt[i] > 0) e.has[w.res[i]] = true;
      if (w.fert[i] > 0.3 && meanTemp(w, sim.climate, i) > 3 && w.moist[i] > 0.18) farmable++;
      if (w.forest[i] > 0.3) forest++;
      if (w.moist[i] < 0.25) dry++;
      if (!e.river && w.river[i] > 0) e.river = true;
    }
    if (s.stock[G.copper] > 1) e.has[R_COPPER] = true;
    if (s.stock[G.iron] > 1) e.has[R_IRON] = true;
    if (s.stock[G.coal] > 1) e.has[R_COAL] = true;
    if (s.stock[G.oil] > 1) e.has[R_OIL] = true;
    if (s.stock[G.salt] > 1) e.has[R_SALT] = true;
    if (s.stock[G.stone] > 5) e.has[R_STONE] = true;
    if (s.stock[G.wood] > 10) forest++;
    herdsNear(sim, s.x, s.y, 12, tmp);
    for (const h of tmp) {
      const sp = sim.species.get(h.sp);
      if (sp.domestic) e.domestic = true;
      if (sp.ridable) e.ridable = true;
    }
    if (s.livestock > 5) e.domestic = true;
    if (!e.river && hasFreshWater(w, s.tile)) e.river = true;
  }
  e.farmland = farmable >= 6;
  e.forest = forest >= 3;
  e.arid = tiles > 0 && dry / tiles > 0.5;
  for (const [, r] of c.rel) {
    if (r.contact) e.contacts++;
    e.tradeVal += r.tradeVal;
    if (r.war >= 0 || r.score < -40) e.threatened = true;
  }
  return e;
}
function canResearch(c, id, e) {
  if (c.tech[id] === 1) return false;
  for (const p of TECH_PRE[id]) if (c.tech[p] !== 1) return false;
  const t = TECHS[id];
  if (t.need && !t.need(e)) return false;
  return true;
}

// src/sim/path.ts
var heap = new MinHeap();
function landStepCost(sim, j) {
  const w = sim.world;
  if (w.water[j] !== W_LAND) return w.coast[j] ? 6 : Infinity;
  const rel = w.elev[j] - w.seaLevel + SEA;
  let c = 1;
  if (rel > PEAK) c = 9;
  else if (rel > MOUNTAIN) c = 4.5;
  else if (rel > HILL) c = 2;
  c += w.forest[j] * 0.8;
  if (w.river[j] > 20) c += 1.2;
  const r = w.road[j];
  if (r === 1) c = Math.min(c, 1) * 0.6;
  else if (r === 2) c = 0.4;
  else if (r >= 3) c = 0.15;
  return c;
}
function findPath(sim, from, to, sea, maxNodes = 3e4) {
  const w = sim.world;
  const rt = sim.rt;
  if (from === to) return [from];
  const W = w.w, H = w.h;
  const gen = ++rt.pathGen;
  const stamp = rt.pathStamp, gs = rt.pathG, prev = rt.pathFrom;
  heap.clear();
  const tx = to % W, ty = to / W | 0;
  stamp[from] = gen;
  gs[from] = 0;
  prev[from] = -1;
  heap.push(0, from);
  let nodes = 0;
  const hmin = sea ? 1 : 0.15;
  while (heap.size) {
    const i = heap.pop();
    if (i === to) break;
    if (++nodes > maxNodes) return null;
    const g = gs[i];
    const x = i % W, y = i / W | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      let c;
      if (sea) {
        if (w.water[j] === W_LAND && j !== to) continue;
        c = 1;
      } else {
        c = j === to ? 1 : landStepCost(sim, j);
        if (c === Infinity) continue;
      }
      if (d >= 4) c *= 1.414;
      const ng = g + c;
      if (stamp[j] === gen && gs[j] <= ng) continue;
      stamp[j] = gen;
      gs[j] = ng;
      prev[j] = i;
      const hx = Math.abs(nx - tx), hy = Math.abs(ny - ty);
      heap.push(ng + (Math.max(hx, hy) + 0.414 * Math.min(hx, hy)) * hmin, j);
    }
  }
  if (stamp[to] !== gen) return null;
  const path = [];
  let k = to;
  while (k !== -1) {
    path.push(k);
    k = prev[k];
  }
  path.reverse();
  return path;
}
function pathCost(sim, path, sea) {
  if (sea) return path.length * 0.22;
  let c = 0;
  for (let k = 1; k < path.length; k++) c += Math.min(6, landStepCost(sim, path[k]));
  return c;
}
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
function landingNear(sim, i) {
  const w = sim.world;
  const x = i % w.w, y = i / w.w | 0;
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
    const j = ny * w.w + nx;
    if (w.water[j] === W_LAND) return j;
  }
  return -1;
}

// src/sim/parties.ts
function createParty(sim, kind, civ, path, from, to) {
  const w = sim.world;
  const p0 = path[0];
  const last = path[path.length - 1];
  const p = {
    id: sim.nextId++,
    kind,
    civ,
    x: p0 % w.w,
    y: p0 / w.w | 0,
    path,
    pi: 0,
    from,
    to,
    tx: last % w.w,
    ty: last / w.w | 0,
    people: [],
    good: -1,
    qty: 0,
    paid: 0,
    owner: -1,
    sea: false,
    returning: false,
    plague: false,
    route: -1,
    acc: 0
  };
  sim.parties.set(p.id, p);
  return p;
}
function travelPath(sim, from, to, seaCap, portTile) {
  const w = sim.world;
  if (w.landmass[from] === w.landmass[to]) {
    const p = findPath(sim, from, to, false, 12e3);
    if (p) return p;
  }
  if (!seaCap || portTile < 0) return null;
  const tx = to % w.w, ty = to / w.w | 0;
  const dest = findPortTile(sim, tx, ty, 6);
  if (dest < 0) return null;
  const seaPath = findPath(sim, portTile, dest, true, 4e4);
  if (!seaPath) return null;
  const land = landingNear(sim, dest);
  let tail = [to];
  if (land >= 0 && land !== to) tail = findPath(sim, land, to, false, 4e3);
  if (!tail) return null;
  return [from].concat(seaPath, tail);
}
function sendMigrants(sim, s, destId, group, fleeing) {
  const dest = sim.settlements.get(destId);
  if (!dest) return;
  const key = s.id < destId ? `${s.id}-${destId}` : `${destId}-${s.id}`;
  const rid = sim.routeIndex.get(key);
  const r = rid !== void 0 ? sim.routes.get(rid) : void 0;
  let path = null;
  if (r) path = r.a === s.id ? r.path.slice() : r.path.slice().reverse();
  else {
    const civ = sim.civs.get(s.civ);
    path = travelPath(sim, s.tile, dest.tile, !!civ && civ.mods.seaCap > 0, s.portTile);
  }
  if (!path) return;
  const party = createParty(sim, fleeing ? PARTY.refugees : PARTY.migrants, s.civ, path, s.id, destId);
  party.plague = s.plague > 0;
  for (const p of group) {
    leaveHome(sim, p);
    p.party = party.id;
    party.people.push(p.id);
  }
}
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
function findSite(sim, cx, cy, minD, maxD, civ, sameLand, tries = 45) {
  const w = sim.world;
  const rng = sim.rng;
  const lm = w.landmass[clamp(cy, 0, w.h - 1) * w.w + clamp(cx, 0, w.w - 1)];
  let best = -1, bs = 4.5;
  for (let t = 0; t < tries; t++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(minD, maxD);
    const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
    if (x < 2 || y < 2 || x >= w.w - 2 || y >= w.h - 2) continue;
    const i = y * w.w + x;
    if (sameLand && w.landmass[i] !== lm) continue;
    let sc = siteScore(sim, i, civ);
    if (sc < 0) continue;
    sc -= d * 0.06;
    if (sc > bs) {
      bs = sc;
      best = i;
    }
  }
  return { tile: best, score: bs };
}
function sendPioneers(sim, s, civ, group) {
  const site = findSite(sim, s.x, s.y, 10, 20, civ, true);
  if (site.tile < 0) return;
  const path = findPath(sim, s.tile, site.tile, false, 8e3);
  if (!path) return;
  let loyal = 0, adults = 0;
  for (const p of group) {
    if (ageOf(sim, p) >= ADULT_AGE) {
      adults++;
      loyal += p.loyalty;
    }
  }
  const stay = civ.settlements.length < civ.mods.admin + 1 && adults > 0 && loyal / adults > 0.42;
  const party = createParty(sim, PARTY.settlers, stay ? civ.id : -1, path, s.id, -1);
  party.owner = civ.id;
  for (const p of group) {
    leaveHome(sim, p);
    p.party = party.id;
    party.people.push(p.id);
  }
  const take = Math.min(s.stock[0] * 0.2, group.length * 4);
  s.stock[0] -= take;
  party.qty = take;
}
function sendSettlers(sim, s, civ, group, site) {
  const path = travelPath(sim, s.tile, site, civ.mods.seaCap > 0, s.portTile);
  if (!path) return false;
  const party = createParty(sim, PARTY.settlers, civ.id, path, s.id, -1);
  party.owner = civ.id;
  for (const p of group) {
    leaveHome(sim, p);
    p.party = party.id;
    party.people.push(p.id);
  }
  const take = Math.min(s.stock[0] * 0.25, group.length * 5);
  s.stock[0] -= take;
  party.qty = take;
  const tools = Math.min(s.stock[9] * 0.2, group.length * 0.3);
  s.stock[9] -= tools;
  party.paid = tools;
  return true;
}
function updateParties(sim) {
  const w = sim.world;
  const monthly = sim.tick % 4 === 0;
  for (const p of sim.parties.values()) {
    const onWater = w.water[p.path[Math.min(p.pi, p.path.length - 1)]] !== W_LAND;
    p.sea = onWater;
    const civ = sim.civs.get(p.civ);
    let speed = p.kind === PARTY.caravan ? 1.25 : 0.9;
    if (civ && civ.tech[TK.riding] === 1 && !onWater) speed *= 1.2;
    p.acc += onWater ? 2.6 : speed;
    let moved = false;
    while (p.pi < p.path.length - 1) {
      const nxt = p.path[p.pi + 1];
      const c = w.water[nxt] !== W_LAND ? 1 : Math.min(6, landStepCost(sim, nxt));
      if (p.acc < c) break;
      p.acc -= c;
      p.pi++;
      moved = true;
    }
    if (moved) {
      const i = p.path[p.pi];
      p.x = i % w.w;
      p.y = i / w.w | 0;
    }
    if (p.kind !== PARTY.caravan && p.people.length === 0) {
      sim.parties.delete(p.id);
      continue;
    }
    if (monthly) {
      if (p.kind === PARTY.caravan) {
        if (caravanHazards(sim, p)) continue;
      } else roadHardship(sim, p);
      if (!sim.parties.has(p.id)) continue;
    }
    if (p.pi >= p.path.length - 1) arrive(sim, p);
  }
}
function roadHardship(sim, p) {
  const rng = sim.rng;
  const hungry = p.qty <= 0;
  if (!hungry) p.qty = Math.max(0, p.qty - p.people.length * 0.9);
  for (const id of p.people.slice()) {
    const q = sim.people.get(id);
    if (!q) continue;
    if (hungry) q.fed = Math.max(0.3, q.fed - 0.05);
    if (rng.chance(hungry ? 0.012 : 3e-3)) killPerson(sim, q, "the hardships of the road");
  }
  if (p.people.length === 0) sim.parties.delete(p.id);
}
function caravanHazards(sim, p) {
  const w = sim.world;
  const i = p.path[Math.min(p.pi, p.path.length - 1)];
  const o = w.owner[i];
  if (o < 0) return false;
  const s = sim.settlements.get(o);
  if (!s || s.civ === p.civ) return false;
  const civ = sim.civs.get(p.civ);
  const rel = civ?.rel.get(s.civ);
  if (rel && rel.war >= 0) {
    s.stock[p.good] += p.qty;
    const m = sim.people.get(p.owner);
    if (m) {
      m.party = -1;
      m.wealth = Math.max(0, m.wealth - p.paid * 0.2);
      remember(m, sim.tick, M.ruined, s.id);
    }
    sim.parties.delete(p.id);
    return true;
  }
  return false;
}
function arrive(sim, p) {
  if (p.kind === PARTY.caravan) {
    caravanArrived(sim, p);
    return;
  }
  const w = sim.world;
  const people = [];
  for (const id of p.people) {
    const q = sim.people.get(id);
    if (q) people.push(q);
  }
  sim.parties.delete(p.id);
  if (people.length === 0) return;
  for (const q of people) q.party = -1;
  if (p.kind === PARTY.settlers) {
    settle(sim, p, people);
    return;
  }
  let dest = sim.settlements.get(p.to);
  if (!dest || !dest.alive) dest = nearestSettlement(sim, p.x, p.y, 25) || void 0;
  if (!dest) {
    settle(sim, p, people);
    return;
  }
  const from = sim.settlements.get(p.from);
  const foreign = dest.civ !== p.civ;
  for (const q of people) {
    rehome(sim, q, dest);
    if (ageOf(sim, q) >= ADULT_AGE) remember(q, sim.tick, p.kind === PARTY.refugees ? M.fled : M.migrated, dest.id);
  }
  if (foreign) {
    const a = sim.civs.get(p.civ), b = sim.civs.get(dest.civ);
    if (a && b) {
      relationOf(sim, a, b.id).contact = true;
      relationOf(sim, b, a.id).contact = true;
    }
  }
  if (people.length >= 12) {
    const kind = p.kind === PARTY.refugees ? "refugees" : "migrants";
    const fromName = from ? from.name : "afar";
    addEvent(sim, "migration", people.length >= 40 ? 3 : 2, `${people.length} ${kind} from ${fromName} arrived in ${dest.name}.`, foreign ? [p.civ, dest.civ] : [dest.civ], [], dest.id, dest.x, dest.y);
    if (people[0].culture !== dest.cultureMajor) dest.unrest = clamp01(dest.unrest + Math.min(0.2, people.length / (dest.people.length + 1) * 0.5));
  }
  if (p.plague && dest.plague === 0 && sim.tick - dest.lastPlague > 480 && sim.rng.chance(0.5)) startPlague(sim, dest);
}
function nearestSettlement(sim, x, y, maxD) {
  let best = null, bd = maxD * maxD;
  for (const s of sim.settlements.values()) {
    if (!s.alive || s.siege >= 0) continue;
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}
function settle(sim, p, people) {
  const w = sim.world;
  let tile = clamp(p.ty, 0, w.h - 1) * w.w + clamp(p.tx, 0, w.w - 1);
  if (p.kind !== PARTY.settlers) tile = clamp(p.y, 0, w.h - 1) * w.w + clamp(p.x, 0, w.w - 1);
  let civ = p.civ >= 0 ? sim.civs.get(p.civ) : void 0;
  if (civ && !civ.alive) civ = void 0;
  if (siteScore(sim, tile, civ) < 0) {
    const alt = findSite(sim, tile % w.w, tile / w.w | 0, 1, 6, civ, true, 30);
    if (alt.tile >= 0) tile = alt.tile;
    else {
      const near = nearestSettlement(sim, p.x, p.y, 30);
      if (near) {
        for (const q of people) rehome(sim, q, near);
        return;
      }
      for (const q of people) killPerson(sim, q, "exposure in the wilderness");
      return;
    }
  }
  const x = tile % w.w, y = tile / w.w | 0;
  let leader = people[0], ls = -1;
  for (const q of people) {
    if (ageOf(sim, q) < ADULT_AGE) continue;
    const sc = q.cha + q.bold * 0.6 + q.amb * 0.4 + q.sLead;
    if (sc > ls) {
      ls = sc;
      leader = q;
    }
  }
  const from = sim.settlements.get(p.from);
  if (!civ) {
    const mother = sim.civs.get(p.owner);
    civ = createCiv(sim, { culture: leader.culture, religion: leader.religion, parent: mother ? mother.id : -1, inherit: mother });
    const s2 = foundSettlement(sim, civ.id, x, y, people);
    s2.stock[0] += p.qty;
    civ.capital = s2.id;
    civ.ruler = leader.id;
    leader.title = 1;
    addFame(sim, leader, 5);
    remember(leader, sim.tick, M.founded, s2.id);
    addEvent(sim, "found", 3, `${fullName(sim, leader)} led ${people.length} followers out of ${from ? from.name : "the old country"} and founded ${s2.name}. They call themselves the ${civ.name}.`, mother ? [civ.id, mother.id] : [civ.id], [leader.id], s2.id, x, y);
    if (mother) {
      relationOf(sim, civ, mother.id).contact = true;
      relationOf(sim, mother, civ.id).contact = true;
      relationOf(sim, civ, mother.id).score = 25;
      relationOf(sim, mother, civ.id).score = 15;
    }
    return;
  }
  const s = foundSettlement(sim, civ.id, x, y, people);
  s.stock[0] += p.qty;
  s.stock[9] += p.paid;
  addFame(sim, leader, 2);
  remember(leader, sim.tick, M.founded, s.id);
  for (const q of people) if (q !== leader && ageOf(sim, q) >= ADULT_AGE) remember(q, sim.tick, M.settled, s.id);
  civ.lastSettle = sim.tick;
  addEvent(sim, "found", 2, `Settlers from ${from ? from.name : "the homeland"} founded ${s.name} for the ${civ.name}.`, [civ.id], [leader.id], s.id, x, y);
}

// src/sim/trade.ts
var LAND_RATE = 0.045;
function routeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
function discoverRoutes(sim, s) {
  const civ = sim.civs.get(s.civ);
  if (!civ) return;
  for (const rid of s.routes) {
    const r = sim.routes.get(rid);
    if (r && r.a === s.id) r.cost = pathCost(sim, r.path, r.sea) * LAND_RATE;
  }
  const maxRoutes = 5 + Math.min(4, s.bld[1]);
  if (s.routes.length >= maxRoutes) return;
  const w = sim.world;
  const cands = [];
  const seaReach = civ.mods.seaRange;
  for (const o of sim.settlements.values()) {
    if (o.id === s.id || !o.alive) continue;
    const d = dist(s.x, s.y, o.x, o.y);
    if (d > Math.max(34, seaReach)) continue;
    const key = routeKey(s.id, o.id);
    const ex = sim.routeIndex.get(key);
    if (ex !== void 0 && (ex >= 0 || sim.tick + ex < 20 * TICKS_PER_YEAR)) continue;
    cands.push({ o, d });
  }
  if (cands.length === 0) return;
  cands.sort((a, b) => a.d - b.d || a.o.id - b.o.id);
  let calls = 0;
  for (const { o, d } of cands) {
    if (calls >= 2 || s.routes.length >= maxRoutes) break;
    if (o.routes.length >= 9) continue;
    const oc = sim.civs.get(o.civ);
    if (!oc) continue;
    calls++;
    let path = null;
    let sea = false;
    if (d <= 34 && w.landmass[s.tile] === w.landmass[o.tile]) path = findPath(sim, s.tile, o.tile, false, 9e3);
    if (!path && s.portTile >= 0 && o.portTile >= 0 && Math.max(seaReach, oc.mods.seaRange) >= d) {
      const sp = findPath(sim, s.portTile, o.portTile, true, 5e4);
      if (sp) {
        path = [s.tile].concat(sp, [o.tile]);
        sea = true;
      }
    }
    const key = routeKey(s.id, o.id);
    if (!path) {
      sim.routeIndex.set(key, -sim.tick - 1);
      continue;
    }
    const r = { id: sim.nextId++, a: s.id, b: o.id, path, sea, len: path.length, cost: pathCost(sim, path, sea) * LAND_RATE, usage: 0, built: 0 };
    sim.routes.set(r.id, r);
    sim.routeIndex.set(key, r.id);
    s.routes.push(r.id);
    o.routes.push(r.id);
    if (o.civ !== s.civ) {
      const ra = relationOf(sim, civ, oc.id), rb = relationOf(sim, oc, civ.id);
      if (!ra.contact) {
        ra.contact = true;
        rb.contact = true;
        addEvent(sim, "contact", 2, `The ${civ.name} and the ${oc.name} have made contact${sea ? " across the sea" : ""}.`, [civ.id, oc.id], [], s.id, s.x, s.y);
      }
    }
  }
}
function bestDeal(sim, s, civ, purse, only) {
  let best = null;
  const market = civ.tech[TK.currency] === 1;
  for (const rid of s.routes) {
    const r = sim.routes.get(rid);
    if (!r || only && r !== only) continue;
    const o = sim.settlements.get(r.a === s.id ? r.b : r.a);
    if (!o || !o.alive || o.siege >= 0) continue;
    let tariff = 0;
    if (o.civ !== s.civ) {
      const oc = sim.civs.get(o.civ);
      if (!oc || civ.isolated || oc.isolated || civ.laws.trade === 0 || oc.laws.trade === 0) continue;
      const rel = civ.rel.get(oc.id);
      if (rel && rel.war >= 0) continue;
      tariff = (oc.laws.trade === 1 ? 0.15 : 0.03) * (rel && rel.tradePact ? 0.3 : 1);
    }
    if (r.sea && (civ.mods.seaCap <= 0 || s.blockaded || o.blockaded)) continue;
    const cap2 = r.sea ? civ.mods.seaCap : civ.mods.caravanCap;
    const haul = r.cost * (r.sea ? 1 : civ.mods.landCost);
    for (let g = 0; g < NG; g++) {
      if (g === G.gold) continue;
      const have = s.stock[g];
      if (have < 3) continue;
      if (g === G.food && (s.fedAvg < 0.93 || have < s.people.length * 3.5)) continue;
      const pa = s.price[g];
      const margin = o.price[g] * (1 - tariff) - pa - haul * GOOD_BULK[g];
      if (margin < pa * 0.15) continue;
      let qty = Math.min(cap2 / GOOD_BULK[g], have * 0.35);
      if (market) qty = Math.min(qty, (purse + 2) / pa);
      if (g === G.food) qty = Math.min(qty, have - s.people.length * 3.5);
      qty = Math.min(qty, o.demand[g] * 8 + 4);
      if (qty < 1) continue;
      const profit = margin * qty;
      if (!best || profit > best.profit) best = { r, o, g, qty, profit };
    }
  }
  return best;
}
function dispatchTrade(sim, s, civ, merchants) {
  const zeal = sim.params.tradeZeal;
  if (zeal <= 0 || s.routes.length === 0) return;
  const n = Math.min(merchants.length, 3);
  const start = (sim.tick >> 2) % merchants.length;
  for (let k = 0; k < n; k++) {
    const m = merchants[(start + k) % merchants.length];
    if (m.party >= 0 || !sim.rng.chance(Math.min(1, 0.6 * zeal))) continue;
    const d = bestDeal(sim, s, civ, m.wealth, null);
    if (!d || d.profit < 0.5) continue;
    const path = d.r.a === s.id ? d.r.path.slice() : d.r.path.slice().reverse();
    const party = createParty(sim, PARTY.caravan, civ.id, path, s.id, d.o.id);
    party.good = d.g;
    party.qty = d.qty;
    party.paid = d.qty * s.price[d.g];
    party.owner = m.id;
    party.route = d.r.id;
    party.plague = s.plague > 0;
    party.sea = d.r.sea;
    s.stock[d.g] -= d.qty;
    m.wealth = Math.max(0, m.wealth - party.paid);
    m.party = party.id;
  }
}
function caravanArrived(sim, p) {
  const here = sim.settlements.get(p.returning ? p.from : p.to);
  const home = sim.settlements.get(p.from);
  const m = sim.people.get(p.owner);
  const finish = () => {
    if (m && m.party === p.id) m.party = -1;
    sim.parties.delete(p.id);
  };
  if (!here || !here.alive) {
    finish();
    return;
  }
  const civ = sim.civs.get(p.civ);
  const hc = sim.civs.get(here.civ);
  if (here.siege >= 0 || civ && hc && civ.rel.get(hc.id)?.war !== void 0 && civ.rel.get(hc.id).war >= 0) {
    if (!p.returning && home && home.alive) {
      p.path = p.path.slice().reverse();
      p.pi = 0;
      p.returning = true;
      return;
    }
    finish();
    return;
  }
  if (p.qty > 0 && p.good >= 0) {
    let tariff = 0;
    if (civ && hc && civ.id !== hc.id) {
      const rel = relationOf(sim, civ, hc.id);
      tariff = (hc.laws.trade === 1 ? 0.15 : 0.03) * (rel.tradePact ? 0.3 : 1);
    }
    const gross = p.qty * here.price[p.good];
    const duty = gross * tariff;
    const revenue = gross - duty;
    here.stock[p.good] += p.qty;
    here.imports[p.good] += p.qty;
    here.tradeVol += gross;
    if (home) home.tradeVol += gross * 0.5;
    if (hc && duty > 0) {
      hc.treasury += duty;
      hc.income += duty;
    }
    if (civ && hc && civ.id !== hc.id) {
      relationOf(sim, civ, hc.id).tradeVal += gross;
      relationOf(sim, hc, civ.id).tradeVal += gross;
    }
    const r2 = sim.routes.get(p.route);
    if (r2) r2.usage += p.qty * GOOD_BULK[p.good];
    if (m) {
      m.wealth += revenue;
      practice(m, J.merchant, 0.02);
      const profit = revenue - p.paid;
      if (profit > 0 && m.fame < 3 && m.wealth > Math.max(800, (home ? home.wealthAvg : 20) * 30)) {
        addFame(sim, m, 3);
        remember(m, sim.tick, M.enriched, here.id);
        if (civ) addEvent(sim, "merchant", 1, `${fullName(sim, m)} of ${home ? home.name : "parts unknown"} has grown rich on the ${["grain", "timber", "stone", "copper", "iron", "coal", "gold", "salt", "oil", "tool", "arms", "luxury"][p.good]} trade.`, [civ.id], [m.id], home ? home.id : -1, here.x, here.y);
      }
    }
    if (p.plague && here.plague === 0 && sim.tick - here.lastPlague > 480 && sim.rng.chance(0.35)) {
      here.plague = 7 + sim.rng.int(6);
      addEvent(sim, "plague", here.people.length > 300 ? 3 : 2, `Plague reached ${here.name}, carried along the trade road${home ? " from " + home.name : ""}.`, [here.civ], [], here.id, here.x, here.y);
    }
  }
  p.qty = 0;
  p.good = -1;
  if (p.returning || !home || !home.alive || !m) {
    finish();
    return;
  }
  p.plague = here.plague > 0;
  const r = sim.routes.get(p.route);
  if (r && hc) {
    const d = bestDeal(sim, here, hc, m.wealth, r);
    if (d && d.profit > 0.3) {
      p.good = d.g;
      p.qty = d.qty;
      p.paid = d.qty * here.price[d.g];
      here.stock[d.g] -= d.qty;
      m.wealth = Math.max(0, m.wealth - p.paid);
    }
  }
  p.path = p.path.slice().reverse();
  p.pi = 0;
  p.returning = true;
}
function buildRoads(sim, civ) {
  const lvl = civ.mods.roadLevel;
  if (lvl < 1 || civ.treasury < 30) return;
  const w = sim.world;
  let best = null, bu = 0.5;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    for (const rid of s.routes) {
      const r = sim.routes.get(rid);
      if (!r || r.sea) continue;
      const o = sim.settlements.get(r.a === s.id ? r.b : r.a);
      if (!o) continue;
      if (o.civ !== civ.id && !civ.rel.get(o.civ)?.tradePact) continue;
      if (r.built >= r.path.length) {
        if (w.road[r.path[Math.floor(r.path.length / 2)]] < lvl && w.water[r.path[Math.floor(r.path.length / 2)]] === W_LAND) r.built = 0;
        else continue;
      }
      const u = r.usage + (o.civ === civ.id ? 3 : 0) + (s.id === civ.capital || o.id === civ.capital ? 2 : 0);
      if (u > bu) {
        bu = u;
        best = r;
      }
    }
  }
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    for (const rid of s.routes) {
      const r = sim.routes.get(rid);
      if (r && r.a === s.id) r.usage *= 0.9;
    }
  }
  if (!best) return;
  let steps = Math.min(10, 2 + Math.floor(civ.treasury / 150));
  while (steps > 0 && best.built < best.path.length) {
    const i = best.path[best.built++];
    if (w.water[i] !== W_LAND) continue;
    if (w.road[i] >= lvl) continue;
    const cost = 2 * lvl;
    if (civ.treasury < cost) break;
    civ.treasury -= cost;
    civ.expense += cost;
    w.road[i] = lvl;
    markDirty(sim, i);
    steps--;
  }
}

// src/sim/settlement.ts
var Y0 = 12;
var skillSum = new Float64Array(NJ);
var prodVal = new Float64Array(NJ);
var desire = new Float32Array(2048);
var own = new Float32Array(2048);
var tmpHerds2 = [];
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
function addFarm(sim, s) {
  const w = sim.world;
  let best = -1, bs = -1;
  for (const i of s.tiles) {
    const imp = w.imp[i];
    if (imp !== I_NONE && imp !== I_PASTURE && imp !== I_CAMP) continue;
    if (!suitableFarm(sim, i) || w.flood[i] > 0) continue;
    const dx = i % w.w - s.x, dy = (i / w.w | 0) - s.y;
    const sc = w.fert[i] * (0.4 + Math.min(1, w.moist[i] * 2) + (w.river[i] > 0 ? 0.4 : 0)) - Math.sqrt(dx * dx + dy * dy) * 0.035 - w.forest[i] * 0.15;
    if (sc > bs) {
      bs = sc;
      best = i;
    }
  }
  if (best < 0) return false;
  if (w.forest[best] > 0.05) s.stock[G.wood] += w.forest[best] * 30;
  w.forest[best] = 0;
  w.imp[best] = I_FARM;
  s.farms.push(best);
  s.farmable = Math.max(0, s.farmable - 1);
  markDirty(sim, best);
  return true;
}
function dropFarm(sim, s) {
  const w = sim.world;
  let worst = -1, ws = 1e9;
  for (let k = 0; k < s.farms.length; k++) {
    const i2 = s.farms[k];
    const dx = i2 % w.w - s.x, dy = (i2 / w.w | 0) - s.y;
    const sc = w.fert[i2] - Math.sqrt(dx * dx + dy * dy) * 0.04;
    if (sc < ws) {
      ws = sc;
      worst = k;
    }
  }
  if (worst < 0) return;
  const i = s.farms[worst];
  s.farms.splice(worst, 1);
  w.imp[i] = I_NONE;
  s.farmable++;
  markDirty(sim, i);
}
function growUrban(sim, s) {
  const w = sim.world;
  let best = -1, bs = 1e9;
  for (const u of s.urban) {
    const ux = u % w.w, uy = u / w.w | 0;
    for (let d = 0; d < 8; d++) {
      const nx = ux + DX8[d], ny = uy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const j = ny * w.w + nx;
      if (w.water[j] !== W_LAND || w.owner[j] !== s.id) continue;
      const imp = w.imp[j];
      if (imp === I_URBAN || imp === I_MINE || imp === I_PORT) continue;
      const dd = (nx - s.x) * (nx - s.x) + (ny - s.y) * (ny - s.y) + (j * 2654435761 >>> 28) * 0.12 + (w.elev[j] - w.seaLevel + SEA > MOUNTAIN ? 20 : 0);
      if (dd < bs) {
        bs = dd;
        best = j;
      }
    }
  }
  if (best < 0) return false;
  if (w.imp[best] === I_FARM) {
    const k = s.farms.indexOf(best);
    if (k >= 0) s.farms.splice(k, 1);
  }
  w.imp[best] = I_URBAN;
  w.forest[best] = 0;
  s.urban.push(best);
  markDirty(sim, best);
  return true;
}
var BUILD_COST_WOOD = [20, 25, 25, 20, 25, 10, 25, 40, 30, 30, 50, 40, 30, 40];
var BUILD_COST_STONE = [5, 10, 5, 25, 20, 60, 15, 15, 15, 30, 40, 40, 25, 60];
var BUILD_NEEDS = ["pottery", null, null, "mysticism", "writing", "masonry", null, "sailing", "mills", "education", "industry", "electricity", "medicine", null];
function planBuilding(sim, s, civ, pop) {
  if (pop < 25) return;
  let best = -1, bs = 0.5;
  const threatened = isThreatened(sim, civ);
  for (let b = 0; b < NB; b++) {
    const need = BUILD_NEEDS[b];
    if (need && civ.tech[TK[need]] !== 1) continue;
    const lvl2 = s.bld[b];
    let cap2 = 0, sc = 0;
    switch (b) {
      case B.granary:
        cap2 = 1 + pop / 300;
        sc = 1.4 + (s.hungerMonths > 0 ? 1 : 0);
        break;
      case B.market:
        cap2 = pop > 80 ? 1 + pop / 400 : 0;
        sc = 0.9 + civ.pTrade * 1.5 + s.routes.length * 0.15;
        break;
      case B.workshop:
        cap2 = pop > 50 ? 1 + pop / 250 : 0;
        sc = 1 + (s.jobCount[J.artisan] >= 3 + pop / 10 + lvl2 * 12 ? 1 : 0);
        break;
      case B.temple:
        cap2 = 1 + pop / 400;
        sc = 0.7 + civ.pPiety * 2 + s.unrest;
        break;
      case B.library:
        cap2 = 1 + pop / 450;
        sc = 0.6 + civ.pScience * 2.2;
        break;
      case B.walls:
        cap2 = pop > 70 ? Math.min(civ.mods.wallMax, 1 + pop / 500) : 0;
        sc = 0.4 + civ.pMilitary + (threatened ? 1.6 : 0) + (sim.tick - s.lastRaid < 30 * TICKS_PER_YEAR ? 1 : 0);
        break;
      case B.barracks:
        cap2 = pop > 150 ? 1 + pop / 800 : 0;
        sc = 0.3 + civ.pMilitary * 2 + (threatened ? 0.8 : 0);
        break;
      case B.port:
        cap2 = s.coastal ? 1 + pop / 500 : 0;
        sc = 1 + civ.pTrade * 1.5;
        break;
      case B.mill:
        cap2 = 1 + pop / 500;
        sc = 1.2;
        break;
      case B.school:
        cap2 = pop > 200 ? 1 + pop / 600 : 0;
        sc = 0.6 + civ.pScience * 2.5;
        break;
      case B.factory:
        cap2 = pop > 200 ? pop / 300 : 0;
        sc = 1.6;
        break;
      case B.power:
        cap2 = pop > 300 ? 1 + pop / 1500 : 0;
        sc = 1.5;
        break;
      case B.hospital:
        cap2 = pop > 200 ? 1 + pop / 700 : 0;
        sc = 1;
        break;
      case B.palace:
        cap2 = civ.capital === s.id && pop > 180 && civ.gov >= 2 ? 1 + pop / 1500 : 0;
        sc = 0.8 + (1 - civ.legitimacy);
        break;
    }
    if (lvl2 >= Math.floor(cap2)) continue;
    sc *= 1 / (1 + lvl2 * 0.6);
    sc += sim.rng.next() * 0.3;
    if (sc > bs) {
      bs = sc;
      best = b;
    }
  }
  if (best < 0) return;
  const lvl = s.bld[best];
  const k = (lvl + 1) * (1 + pop / 600);
  const wood = BUILD_COST_WOOD[best] * k;
  const stone = civ.tech[TK.masonry] === 1 ? BUILD_COST_STONE[best] * k : 0;
  const coin = 30 * k;
  s.demand[G.wood] += wood * 0.15;
  s.demand[G.stone] += stone * 0.15;
  if (s.stock[G.wood] < wood || s.stock[G.stone] < stone) return;
  if (civ.treasury < coin) {
    let patron = null;
    for (let t = 0; t < 6; t++) {
      const p = sim.people.get(s.people[sim.rng.int(s.people.length)]);
      if (p && p.wealth > coin * 3 && (!patron || p.wealth > patron.wealth)) patron = p;
    }
    if (!patron) return;
    patron.wealth -= coin;
    addFame(sim, patron, 1.5);
    patron.loyalty = Math.min(1, patron.loyalty + 0.1);
    if (best === B.temple || best === B.library || best === B.school || best === B.hospital) {
      addEvent(sim, "patron", 2, `${fullName(sim, patron)}, a wealthy ${patron.job === J.merchant ? "merchant" : "citizen"} of ${s.name}, paid for a new ${["granary", "market", "workshop", "temple", "library", "wall", "barracks", "harbor", "mill", "academy", "factory", "power plant", "hospital", "palace"][best]}.`, [civ.id], [patron.id], s.id, s.x, s.y);
    }
  } else {
    civ.treasury -= coin;
    civ.expense += coin;
  }
  s.stock[G.wood] -= wood;
  s.stock[G.stone] -= stone;
  s.build = { type: best, progress: 0, need: 18 * k };
}
function isThreatened(sim, civ) {
  for (const [, r] of civ.rel) if (r.war >= 0 || r.contact && r.score < -35) return true;
  return false;
}
function finishBuilding(sim, s, civ) {
  const b = s.build.type;
  s.bld[b]++;
  s.build = null;
  const lvl = s.bld[b];
  if (b === B.port && s.portTile >= 0) markDirty(sim, s.portTile);
  for (const u of s.urban) markDirty(sim, u);
  const big = b === B.walls || b === B.palace || b === B.school || b === B.factory || b === B.power;
  if (big && lvl === 1) {
    const what = ["", "", "", "", "", "raised walls around the town", "", "", "", "founded an academy", "opened its first factory", "lit its streets with electric power", "", "built a palace"][b];
    addEvent(sim, "build", b === B.factory || b === B.power ? 2 : 1, `${s.name} ${what}.`, [civ.id], [], s.id, s.x, s.y);
  }
}
function settlementMonthly(sim, s) {
  const civ = sim.civs.get(s.civ);
  if (!civ || !s.alive) return;
  if (s.people.length === 0) {
    abandonSettlement(sim, s, "abandoned");
    return;
  }
  const w = sim.world, m = civ.mods, rng = sim.rng, P = sim.params;
  const tick2 = sim.tick;
  const month = monthOf(tick2);
  const market = civ.tech[TK.currency] === 1;
  const price = s.price, stock = s.stock, prod = s.prod;
  s.jobCount.fill(0);
  skillSum.fill(0);
  let adults = 0, away = 0;
  for (const id of s.people) {
    const p = sim.people.get(id);
    s.jobCount[p.job]++;
    skillSum[p.job] += jobSkill(p, p.job);
    if (p.job !== J.child) adults++;
    if (p.army >= 0) away++;
  }
  const jc = s.jobCount;
  const pop = s.people.length;
  const present = pop - away;
  if (pop > s.peakPop) s.peakPop = pop;
  const T = tempAt(w, sim.climate, s.tile, tick2);
  const anomaly = rainAnomaly(w, sim.climate, s.x, s.y, tick2, P.climateVolatility);
  if (anomaly < 0.62 && s.farms.length > 3) {
    s.drought++;
    if (s.drought === 5 && pop > 60 && tick2 - s.growthNote > 8 * TICKS_PER_YEAR) addEvent(sim, "drought", 2, `Drought grips ${s.name}. The fields are cracking.`, [civ.id], [], s.id, s.x, s.y);
  } else s.drought = Math.max(0, s.drought - 2);
  const besieged = s.siege >= 0;
  const workers = Math.max(1, adults - away);
  const toolCover = clamp01(stock[G.tools] / (workers * 0.25 + 1));
  const toolF = 0.85 + 0.15 * toolCover + (s.toolQ - 1) * 0.5 * toolCover;
  const dmgF = 1 - s.damage * 0.45;
  const avgSk = (j) => jc[j] > 0 ? skillSum[j] / jc[j] : 0.2;
  prod.fill(0);
  prodVal.fill(0);
  let fuelOK = 1;
  if (m.co2 > 0.5) {
    const fuelNeed = (jc[J.artisan] + jc[J.miner]) * 0.06 + s.bld[B.factory] * 1.5 + s.bld[B.power] * 2;
    const have = stock[G.coal] + stock[G.oil];
    const burn = Math.min(have, fuelNeed);
    fuelOK = fuelNeed > 0 ? burn / fuelNeed : 1;
    const fromCoal = Math.min(stock[G.coal], burn);
    stock[G.coal] -= fromCoal;
    stock[G.oil] -= burn - fromCoal;
    sim.climate.co2 += burn * 4e-3 * m.co2;
    s.demand[G.coal] = s.demand[G.coal] * 0.7 + fuelNeed * 0.3;
  }
  const machineF = m.co2 > 0.5 ? 0.5 + 0.5 * fuelOK : 1;
  const hasAgri = civ.tech[TK.agriculture] === 1;
  let effLabor = m.farmLabor;
  if (effLabor <= 0.11) {
    const need = s.farms.length * 0.02;
    if (stock[G.oil] >= need) stock[G.oil] -= need;
    else effLabor = 0.35;
    s.demand[G.oil] = s.demand[G.oil] * 0.7 + need * 0.3;
  }
  if (hasAgri) {
    const gT = clamp01((T - 3) / 11) * (T > 36 ? 0.5 : 1);
    let sumY = 0;
    const deplete = 45e-5 * (1 - m.soilCare);
    const irrig = m.irrigate && s.river;
    for (const i of s.farms) {
      if (w.flood[i] > 0 || w.fire[i] > 0) continue;
      let gM = clamp01(w.moist[i] / 0.42);
      if (irrig || m.irrigate && w.river[i] > 0) gM = Math.max(gM, 0.85);
      sumY += w.fert[i] * gM;
      if (gT > 0.2) w.fert[i] = Math.max(0.05, w.fert[i] - deplete);
    }
    const laborFrac = Math.min(1, jc[J.farmer] / (s.farms.length * effLabor + 1e-6));
    const millF = 1 + Math.min(2, s.bld[B.mill]) * 0.08;
    const food = sumY * gT * Y0 * laborFrac * m.farmYield * toolF * (0.75 + 0.5 * avgSk(J.farmer)) * (besieged ? 0.3 : 1) * dmgF * millF;
    prod[G.food] += food;
    prodVal[J.farmer] = food * price[G.food];
    const capLabor = s.farms.length * effLabor;
    if (!besieged) {
      if (jc[J.farmer] > capLabor * 0.92 || s.farms.length === 0) {
        if (addFarm(sim, s) && jc[J.farmer] > capLabor + 2) addFarm(sim, s);
      } else if (jc[J.farmer] < capLabor * 0.55 && s.farms.length > 2 && rng.chance(0.3)) dropFarm(sim, s);
    }
  }
  if (s.coastal && jc[J.fisher] > 0 && !s.blockaded) {
    let total = 0;
    const range = m.fishRange + 1;
    forDisc(w, s.x, s.y, range, (i) => {
      if (w.water[i] !== W_LAND) total += w.veg[i] * 40;
    });
    const want = jc[J.fisher] * 2.7 * m.fishYield * toolF * (0.75 + 0.5 * avgSk(J.fisher)) * (1 + s.bld[B.port] * 0.12) * (T < -8 ? 0.4 : 1);
    const got = Math.min(want, total * 0.14);
    if (got > 0 && total > 0) {
      const f = 1 - got / total;
      forDisc(w, s.x, s.y, range, (i) => {
        if (w.water[i] !== W_LAND) w.veg[i] *= f;
      });
    }
    prod[G.food] += got;
    prodVal[J.fisher] = got * price[G.food];
  }
  if (jc[J.hunter] > 0) {
    const season = 0.35 + 0.65 * clamp01((T - 1) / 12);
    const potential = s.wildCap * 0.3 * season;
    const bow = civ.tech[TK.archery] === 1 ? 1.2 : 1;
    let got = Math.min(jc[J.hunter] * 2.1 * toolF, potential);
    let power = jc[J.hunter] * 1.3 * bow;
    herdsNear(sim, s.x, s.y, 9, tmpHerds2);
    for (const h of tmpHerds2) {
      if (power <= 0) break;
      const sp = sim.species.get(h.sp);
      if (sp.diet === 1 && h.fierce > 0.6) continue;
      const per = 2 + h.size * 16;
      const kills = Math.min(Math.floor(h.n * 0.18), Math.ceil(power / per));
      if (kills <= 0) continue;
      h.n -= kills;
      sp.count -= kills;
      got += kills * per * 0.8;
      power -= kills * per;
    }
    if (besieged) got *= 0.2;
    prod[G.food] += got;
    prodVal[J.hunter] = got * price[G.food];
  }
  if (civ.tech[TK.husbandry] === 1) {
    if (s.livestock < 4 && jc[J.herder] > 0) s.livestock = 6;
    const managed = Math.min(s.livestock, jc[J.herder] * 14);
    const cap2 = s.pastureCap * (0.4 + 0.6 * clamp01(anomaly));
    const got = managed * 0.21 * toolF * (besieged ? 0.3 : 1);
    prod[G.food] += got;
    prodVal[J.herder] = got * price[G.food];
    if (s.livestock < cap2) s.livestock += Math.max(0.3, managed * 0.035);
    else s.livestock -= (s.livestock - cap2) * 0.15;
    if (managed < s.livestock) s.livestock -= (s.livestock - managed) * 0.05;
    if (s.tiles.length > 0 && s.livestock > 4) {
      for (let k = 0; k < 4; k++) {
        const i = s.tiles[(month * 7 + k * 13 + (tick2 >> 6)) % s.tiles.length];
        if (w.imp[i] === I_NONE || w.imp[i] === I_PASTURE) {
          w.veg[i] = Math.max(0, w.veg[i] - Math.min(0.25, s.livestock * 25e-4));
          if (w.imp[i] === I_NONE && jc[J.herder] > 0 && w.forest[i] < 0.3) {
            w.imp[i] = I_PASTURE;
            markDirty(sim, i);
          }
        }
      }
    }
  }
  if (jc[J.woodcutter] > 0 && s.tiles.length > 0) {
    let want = jc[J.woodcutter] * 2.6 * m.woodYield * toolF * (besieged ? 0.2 : 1);
    let got = 0;
    const nT = s.tiles.length;
    const start = (tick2 * 31 + s.id * 17) % nT;
    for (let k = 0; k < nT && want > 0.01; k += 3) {
      const i = s.tiles[(start + k) % nT];
      const f = w.forest[i];
      if (f < 0.12) continue;
      const take = Math.min(want, (f - 0.05) * 400, 12);
      w.forest[i] = f - take / 400;
      got += take;
      want -= take;
      if (w.imp[i] === I_NONE && rng.chance(0.2)) {
        w.imp[i] = I_CAMP;
        markDirty(sim, i);
      }
    }
    prod[G.wood] += got;
    prodVal[J.woodcutter] = got * price[G.wood];
  }
  if (jc[J.miner] > 0 && s.mines.length > 0) {
    const wts = [0, 0, 0, 0, 0, 0, 0, 0];
    const cnt = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const i of s.mines) {
      if (w.resAmt[i] <= 0) continue;
      cnt[w.res[i]]++;
    }
    let tw = 0;
    for (let r = 1; r < 8; r++) {
      if (!cnt[r]) continue;
      const g = RES_GOOD[r];
      wts[r] = Math.pow(price[g] / GOOD_BASE[g], 1.5) * (r === R_STONE ? 0.6 : 1) + 0.05;
      tw += wts[r];
    }
    const rate = [0, 2.4, 0.8, 0.8, 2, 0.12, 1.4, 2];
    const mf = Math.max(0.35, m.mineYield) * toolF * machineF * (0.75 + 0.5 * avgSk(J.miner)) * (besieged ? 0.3 : 1);
    let val = 0;
    for (let r = 1; r < 8; r++) {
      if (!cnt[r] || tw <= 0) continue;
      const men = jc[J.miner] * wts[r] / tw;
      let out = men * rate[r] * mf * (r !== R_STONE && r !== R_SALT && m.mineYield < 1 ? 0 : 1);
      if (out <= 0) continue;
      let left = out;
      for (const i of s.mines) {
        if (left <= 0) break;
        if (w.res[i] !== r) continue;
        const take = Math.min(left, w.resAmt[i]);
        w.resAmt[i] -= Math.ceil(take);
        if (w.imp[i] !== I_MINE) {
          w.imp[i] = I_MINE;
          markDirty(sim, i);
        }
        left -= take;
        if (w.resAmt[i] <= 0) {
          w.res[i] = 0;
          w.resAmt[i] = 0;
          w.imp[i] = I_NONE;
          markDirty(sim, i);
          if (r !== R_STONE) addEvent(sim, "depleted", 1, `The ${["", "stone", "copper", "iron", "coal", "gold", "salt", "oil"][r]} deposits near ${s.name} are exhausted.`, [civ.id], [], s.id, s.x, s.y);
        }
      }
      out -= left;
      const g = RES_GOOD[r];
      prod[g] += out;
      val += out * price[g];
    }
    prodVal[J.miner] = val;
    if (prod[G.gold] > 0) {
      const mint = prod[G.gold] * 10;
      civ.treasury += mint;
      civ.income += mint;
    }
  }
  if (jc[J.artisan] > 0) {
    const soldiers = jc[J.soldier];
    const wT = Math.pow(price[G.tools] / GOOD_BASE[G.tools], 2);
    const wW = soldiers > 0 || price[G.weapons] > GOOD_BASE[G.weapons] * 1.2 ? Math.pow(price[G.weapons] / GOOD_BASE[G.weapons], 2) : 0;
    const wL = Math.pow(price[G.wares] / GOOD_BASE[G.wares], 2);
    const tw = wT + wW + wL;
    const base = jc[J.artisan] * m.craftYield * toolF * (0.6 + 0.8 * avgSk(J.artisan)) * dmgF * (1 + Math.min(2, s.bld[B.mill]) * 0.08 + s.bld[B.power] * 0.15) * (m.co2 > 0.5 ? machineF : 1);
    const metal = () => {
      if (civ.tech[TK.ironworking] === 1 && stock[G.iron] > 0.5) return [G.iron, m.toolQ];
      if (civ.tech[TK.bronze] === 1 && stock[G.copper] > 0.5) return [G.copper, Math.min(m.toolQ, 1.3)];
      return [-1, 1];
    };
    let val = 0;
    let nTools = base * wT / tw * 1.2;
    nTools = Math.min(nTools, stock[G.wood] / 0.4);
    if (nTools > 0.01) {
      const [mg, q] = metal();
      let useQ = 1;
      if (mg >= 0) {
        const mm = Math.min(nTools * 0.3, stock[mg]);
        stock[mg] -= mm;
        useQ = 1 + (q - 1) * (mm / (nTools * 0.3));
      }
      stock[G.wood] -= nTools * 0.4;
      s.toolQ = (s.toolQ * stock[G.tools] + useQ * nTools) / (stock[G.tools] + nTools + 1e-6);
      prod[G.tools] += nTools;
      val += nTools * price[G.tools];
    }
    let nWeap = base * wW / tw * 0.8;
    nWeap = Math.min(nWeap, stock[G.wood] / 0.3);
    if (nWeap > 0.01) {
      const [mg, q] = metal();
      let useQ = 1;
      if (mg >= 0) {
        const mm = Math.min(nWeap * 0.5, stock[mg]);
        stock[mg] -= mm;
        useQ = 1 + (Math.max(q, m.weaponQ) - 1) * (mm / (nWeap * 0.5));
      }
      stock[G.wood] -= nWeap * 0.3;
      s.weaponQ = (s.weaponQ * stock[G.weapons] + useQ * nWeap) / (stock[G.weapons] + nWeap + 1e-6);
      prod[G.weapons] += nWeap;
      val += nWeap * price[G.weapons];
    }
    let nWares = base * wL / tw * 1.5;
    nWares = Math.min(nWares, stock[G.wood] / 0.25 + 0.5);
    if (nWares > 0.01) {
      stock[G.wood] = Math.max(0, stock[G.wood] - nWares * 0.25);
      prod[G.wares] += nWares;
      val += nWares * price[G.wares];
    }
    prodVal[J.artisan] = val * 0.8;
    s.demand[G.copper] = s.demand[G.copper] * 0.8 + (civ.tech[TK.bronze] === 1 && civ.tech[TK.ironworking] !== 1 ? (nTools * 0.3 + nWeap * 0.5) * 0.2 : 0);
    s.demand[G.iron] = s.demand[G.iron] * 0.8 + (civ.tech[TK.ironworking] === 1 ? (nTools * 0.3 + nWeap * 0.5) * 0.2 : 0);
  }
  for (let g = 0; g < NG; g++) stock[g] += prod[g];
  {
    let rp = 0;
    if (jc[J.scholar] > 0) rp = jc[J.scholar] * 0.075 * (0.6 + 1.2 * avgSk(J.scholar)) * (1 + s.bld[B.library] * 0.15 + s.bld[B.school] * 0.25) * m.research;
    if (civ.laws.schooling) rp *= 1.12;
    rp += 0.035 * Math.sqrt(adults);
    rp *= P.research * dmgF * (civ.golden > 0 ? 1.15 : 1);
    if (civ.researching >= 0) civ.research[civ.researching] += rp;
  }
  const subsistence = price[G.food] * 1.3 + 0.15;
  const wage = s.wage;
  const prim = [J.farmer, J.fisher, J.hunter, J.herder, J.woodcutter, J.miner, J.artisan];
  for (const j of prim) {
    if (jc[j] > 0) wage[j] += (prodVal[j] / jc[j] - wage[j]) * 0.5;
  }
  const paid = civ.treasury > 0 ? 1 : 0.35;
  wage[J.soldier] = subsistence * 1.6 * paid;
  wage[J.scholar] = subsistence * 2.2 * paid;
  wage[J.official] = subsistence * 3 * paid;
  wage[J.laborer] = subsistence * 0.7;
  const salaries = jc[J.soldier] * wage[J.soldier] + jc[J.scholar] * wage[J.scholar] + jc[J.official] * wage[J.official];
  civ.treasury -= salaries;
  civ.expense += salaries;
  wage[J.merchant] += ((jc[J.merchant] > 0 ? present * subsistence * 0.07 * m.market / jc[J.merchant] : subsistence * 2.5) - wage[J.merchant]) * 0.3;
  const slots = SLOTS;
  slots.fill(0);
  const hasFishing = civ.tech[TK.fishing] === 1;
  slots[J.farmer] = hasAgri ? Math.floor((s.farms.length + s.farmable) * effLabor + 0.5) - jc[J.farmer] : 0;
  slots[J.fisher] = s.coastal ? Math.floor(s.waterTiles * (hasFishing ? 0.3 : 0.1)) - jc[J.fisher] : 0;
  slots[J.hunter] = Math.floor(s.wildCap * 0.3 / 2.1) + 2 - jc[J.hunter];
  slots[J.herder] = civ.tech[TK.husbandry] === 1 ? Math.floor(s.pastureCap / 14) + 1 - jc[J.herder] : 0;
  slots[J.woodcutter] = s.forestTiles > 0 ? Math.max(1, Math.floor(s.forestTiles * 0.6)) - jc[J.woodcutter] : 0;
  slots[J.miner] = s.mines.length * 5 - jc[J.miner];
  slots[J.artisan] = Math.floor(3 + pop / 9 + s.bld[B.workshop] * 12 + s.bld[B.factory] * 50 + s.bld[B.market] * 8 + Math.min(40, s.tradeVol * 0.05)) - jc[J.artisan];
  slots[J.merchant] = (pop > 30 && s.routes.length > 0 ? 1 + Math.floor(pop / 70) + s.bld[B.market] * 3 : 0) - jc[J.merchant];
  const quota = pop > 40 || civ.soldierTarget > 0.08 ? Math.round(adults * civ.soldierTarget) : 0;
  slots[J.soldier] = quota - jc[J.soldier];
  slots[J.scholar] = (civ.tech[TK.writing] === 1 ? 1 + s.bld[B.library] * 5 + s.bld[B.school] * 10 : 0) - jc[J.scholar];
  slots[J.priest] = (civ.tech[TK.mysticism] === 1 ? 1 + s.bld[B.temple] * 3 + Math.floor(pop / 250) : pop > 25 ? 1 : 0) - jc[J.priest];
  slots[J.official] = (pop > 80 ? 1 + Math.floor(pop / 160) + s.bld[B.palace] * 3 : 0) - jc[J.official];
  slots[J.laborer] = 9999;
  const ew = EXPECT;
  for (let j = 0; j < NJ; j++) ew[j] = wage[j];
  if (jc[J.farmer] === 0) ew[J.farmer] = price[G.food] * 2.4 * m.farmYield;
  if (jc[J.fisher] === 0) ew[J.fisher] = price[G.food] * 2.2 * m.fishYield;
  if (jc[J.hunter] === 0) ew[J.hunter] = price[G.food] * 2;
  if (jc[J.herder] === 0) ew[J.herder] = price[G.food] * 2.3;
  if (jc[J.woodcutter] === 0) ew[J.woodcutter] = price[G.wood] * 2.4 * m.woodYield;
  if (jc[J.miner] === 0) ew[J.miner] = subsistence * 1.6;
  if (jc[J.artisan] === 0) ew[J.artisan] = price[G.wares] * 1.1 * m.craftYield;
  let wageSum = 0, wageN = 0;
  for (const j of prim) {
    wageSum += wage[j] * jc[j];
    wageN += jc[j];
  }
  const avgWage = wageN > 0 ? wageSum / wageN : subsistence;
  wage[J.priest] = jc[J.priest] > 0 ? Math.min(subsistence * 2.2, wageSum * 0.04 / jc[J.priest] + subsistence * 0.6) : subsistence * 1.6;
  ew[J.priest] = wage[J.priest];
  const ids = s.people.slice();
  const nP = ids.length;
  if (desire.length < nP) {
    desire = new Float32Array(nP * 2);
    own = new Float32Array(nP * 2);
  }
  const cul = sim.cultures.get(civ.culture);
  const foodPrice = price[G.food];
  const dole = civ.laws.dole && civ.treasury > 0;
  const charity = market ? cul.communal * 0.45 : 1;
  let totalDesire = 0, totalNeed = 0, doleUnits = 0;
  for (let k = 0; k < nP; k++) {
    const p = sim.people.get(ids[k]);
    if (p.army >= 0) {
      desire[k] = 0;
      own[k] = 0;
      continue;
    }
    const age = (tick2 - p.born) / TICKS_PER_YEAR;
    const need = age < 4 ? 0.4 : age < ADULT_AGE ? 0.7 : 1;
    let aff = 1;
    if (market) {
      let purse = p.wealth;
      if (age < ADULT_AGE) {
        const fa = sim.people.get(p.father), mo = sim.people.get(p.mother);
        purse = Math.max(fa ? fa.wealth : 0, mo ? mo.wealth : 0);
      }
      aff = Math.min(1, purse / (need * foodPrice + 1e-6));
    }
    own[k] = need * aff;
    if (aff < 1) {
      const lifted = dole ? 1 : Math.max(aff, charity);
      if (dole) doleUnits += need * (1 - aff);
      aff = lifted;
    }
    desire[k] = need * aff;
    totalDesire += desire[k];
    totalNeed += need;
  }
  const scale = totalDesire > 0 ? Math.min(1, stock[G.food] / totalDesire) : 1;
  stock[G.food] = Math.max(0, stock[G.food] - totalDesire * scale);
  if (dole && doleUnits > 0) {
    const cost = doleUnits * scale * foodPrice;
    civ.treasury -= cost;
    civ.expense += cost;
  }
  const fuelNeedPop = present * 0.1 * (1 + clamp01((9 - T) / 14) * 1.5);
  const fuelSat = Math.min(1, stock[G.wood] / (fuelNeedPop + 0.01));
  stock[G.wood] = Math.max(0, stock[G.wood] - fuelNeedPop);
  const saltNeed = present * 0.015;
  const saltSat = Math.min(1, stock[G.salt] / (saltNeed + 1e-3));
  stock[G.salt] = Math.max(0, stock[G.salt] - saltNeed);
  const housing = s.urban.length * m.density + 8;
  s.housing = housing;
  const crowd = present / housing;
  const danger = (besieged ? 1 : 0) + (s.plague > 0 ? 0.6 : 0) + (s.occupier >= 0 ? 0.4 : 0);
  const worldPop = sim.people.size;
  const capF = Math.max(0, 1 - Math.pow(worldPop / P.popCap, 3));
  const birthBase = 0.029 * P.birthRate * m.fertility * capF * (1 - 0.5 * Math.min(1, m.health / 0.7)) * (civ.laws.schooling ? 0.9 : 1) * (crowd < 0.9 ? 1 : clamp(1.9 - crowd, 0.15, 1)) * (besieged ? 0.3 : 1);
  const taxRate = civ.laws.tax;
  const taxEff = m.taxEff * Math.min(1, 0.55 + jc[J.official] * 140 / (pop + 60));
  const templeJoy = Math.min(0.1, s.bld[B.temple] * 0.03 + jc[J.priest] * 4e-3);
  const hospital = s.bld[B.hospital] * 0.05;
  const lifeCtx = {
    slots,
    wage: ew,
    subsistence,
    crowd,
    danger,
    avgWage,
    migrate: (p, push) => planMigration(sim, s, civ, p, push)
  };
  MIG.clear();
  let taxSum = 0, rents = 0, fedSum = 0, happySum = 0, loyalSum = 0, wealthSum = 0, nAd = 0, waresWant = 0;
  const overSoldiers = jc[J.soldier] - quota;
  let discharge = overSoldiers > 1 ? overSoldiers : 0;
  const plagueRate = s.plague > 0 ? 0.22 * (1 - Math.min(0.8, m.health)) * (crowd > 1 ? 1.3 : 1) : 0;
  let plagueDead = 0;
  MERCH.length = 0;
  for (let k = 0; k < nP; k++) {
    const p = sim.people.get(ids[k]);
    if (!p || p.home !== s.id) continue;
    if (p.army >= 0) continue;
    const age = (tick2 - p.born) / TICKS_PER_YEAR;
    const need = age < 4 ? 0.4 : age < ADULT_AGE ? 0.7 : 1;
    const eaten = desire[k] * scale;
    p.fed += (eaten / need - p.fed) * 0.4;
    if (market) {
      const pay = Math.min(eaten, own[k]) * foodPrice;
      if (age >= ADULT_AGE) p.wealth = Math.max(0, p.wealth - pay);
      else {
        const fa = sim.people.get(p.father), mo = sim.people.get(p.mother);
        const payer = fa && (!mo || fa.wealth >= mo.wealth) ? fa : mo;
        if (payer) payer.wealth = Math.max(0, payer.wealth - pay);
      }
    }
    if (p.fed < 0.45) {
      p.health -= 0.07;
      if (rng.chance((0.45 - p.fed) * 0.32 * (age < 6 || age > 55 ? 1.6 : 1))) {
        s.starved++;
        killPerson(sim, p, "starvation");
        continue;
      }
    } else if (p.health < 1) p.health = Math.min(1, p.health + 0.012 + hospital * 0.2 + saltSat * 3e-3);
    if (fuelSat < 0.5 && T < 4) p.health -= 0.02 * (1 - fuelSat);
    if (plagueRate > 0) {
      if (p.sick > 0) {
        p.sick--;
        if (rng.chance(0.2 * (1.3 - p.health) * (1 - Math.min(0.8, m.health) * 0.7) * (1 - hospital))) {
          plagueDead++;
          killPerson(sim, p, "the plague");
          continue;
        }
        if (p.sick === 0) p.sick = -24;
      } else if (p.sick === 0 && rng.chance(plagueRate)) {
        p.sick = 2;
        p.health -= 0.2;
        remember(p, tick2, M.plague, s.id);
      } else if (p.sick < 0) p.sick++;
    } else if (p.sick !== 0) p.sick = p.sick > 0 ? p.sick - 1 : p.sick + 1;
    if (age >= ADULT_AGE) {
      const job = p.job;
      if (job === J.soldier && discharge > 0 && p.title === TITLE.none) {
        discharge--;
        setJob(sim, p, s, J.laborer, lifeCtx);
      }
      const inc = wage[p.job] * (0.7 + 0.6 * jobSkill(p, p.job)) * (age > 62 ? 0.7 : 1);
      const tax = inc * taxRate;
      taxSum += tax * taxEff;
      p.wealth += inc - tax;
      if (civ.laws.serfdom && job === J.farmer) {
        const rent = inc * 0.15;
        p.wealth -= rent;
        rents += rent;
      }
      practice(p, job, civ.laws.schooling ? 6e-3 : 4e-3);
      if (job === J.laborer && p.title === TITLE.none && rng.chance(0.5)) chooseJob(sim, p, s, civ, lifeCtx);
      if (job === J.merchant && p.party < 0) MERCH.push(p);
      const want = market ? Math.min(0.6, p.wealth / (price[G.wares] * 25)) : 0.08;
      waresWant += want;
      let lux = 0;
      if (want > 0 && stock[G.wares] >= want) {
        stock[G.wares] -= want;
        if (market) p.wealth -= want * price[G.wares];
        lux = Math.min(1, want / 0.15);
      }
      let ht = 0.1 + p.fed * 0.4 + p.health * 0.12 + lux * 0.1 + (p.spouse >= 0 ? 0.05 : 0) + templeJoy * (0.5 + p.piety) + fuelSat * 0.05 + (civ.golden > 0 ? 0.05 : 0);
      ht -= Math.max(0, crowd - 1) * 0.3 + danger * 0.15 + s.damage * 0.1;
      if (market) ht += p.wealth > s.wealthAvg ? 0.05 : p.wealth < s.wealthAvg * 0.25 ? -0.06 * (1 + s.gini) : 0;
      p.happy += (clamp01(ht) - p.happy) * 0.25;
      if (p.sex === 0 && p.spouse >= 0 && age < 43 && p.party < 0) {
        const fedF = clamp01((p.fed - 0.55) * 3);
        if (fedF > 0) tryBirth(sim, p, s, civ, birthBase * fedF);
      }
      fedSum += p.fed;
      happySum += p.happy;
      loyalSum += p.loyalty;
      wealthSum += p.wealth;
      nAd++;
    } else {
      p.happy += (0.3 + p.fed * 0.5 - p.happy) * 0.25;
    }
    if ((tick2 - p.born) % TICKS_PER_YEAR < 4) yearlyLife(sim, p, s, civ, age, lifeCtx);
  }
  if (rents > 0 && jc[J.official] > 0) {
    const share = rents / jc[J.official];
    for (const id of s.people) {
      const p = sim.people.get(id);
      if (p.job === J.official) p.wealth += share;
    }
  }
  civ.treasury += taxSum;
  civ.income += taxSum;
  if (nAd > 0) {
    s.fedAvg = fedSum / nAd;
    s.happyAvg = happySum / nAd;
    s.loyalAvg = loyalSum / nAd;
    s.wealthAvg = wealthSum / nAd;
  }
  if (s.fedAvg < 0.7) {
    s.hungerMonths++;
    if (s.hungerMonths === 4 && pop > 30) {
      const why = s.siege >= 0 ? "the siege" : s.blockaded ? "the blockade" : s.drought >= 4 ? "drought" : s.damage > 0.3 ? "the destruction" : T < 0 ? "a hard winter" : "failed harvests";
      addEvent(sim, "famine", s.people.length > 150 ? 3 : 2, `Famine in ${s.name}: ${why} has emptied the granaries.`, [civ.id], [], s.id, s.x, s.y);
      const mem = `the famine of year ${Math.floor(tick2 / TICKS_PER_YEAR) + 1} at ${s.name}`;
      if (civ.memory.indexOf(mem) < 0 && s.people.length > 100) civ.memory.push(mem);
    }
  } else if (s.hungerMonths > 0) {
    s.hungerMonths = Math.max(0, s.hungerMonths - 2);
    if (s.hungerMonths === 0 && s.starved > 0) {
      if (s.starved >= 8) addEvent(sim, "famine", 2, `The famine at ${s.name} has passed. ${s.starved} starved.`, [civ.id], [], s.id, s.x, s.y);
      s.starved = 0;
    }
  }
  if (s.plague > 0) {
    s.plague--;
    if (plagueDead > 0) s.starved += 0;
    if (s.plague === 0) s.lastPlague = tick2;
  } else if (crowd > 1.05 && pop > 250 && tick2 - s.lastPlague > 25 * TICKS_PER_YEAR && rng.chance(12e-4 * P.disasters * (1 - Math.min(0.9, m.health)))) {
    startPlague(sim, s);
  }
  const granary = s.bld[B.granary];
  stock[G.food] *= 1 - 0.04 / m.storage * (saltSat > 0.5 ? 0.6 : 1) / (1 + granary * 0.6);
  const maxFood = pop * (9 + granary * 9) * m.storage + 40;
  if (stock[G.food] > maxFood) stock[G.food] = maxFood;
  stock[G.tools] = Math.max(0, stock[G.tools] - workers * 0.012);
  stock[G.weapons] = Math.max(0, stock[G.weapons] - jc[J.soldier] * 0.01);
  for (let g = 1; g < NG; g++) if (stock[g] > 4e3 + pop * 6) stock[g] = 4e3 + pop * 6;
  const dem = s.demand;
  dem[G.food] = dem[G.food] * 0.6 + totalNeed * 0.4;
  dem[G.wood] = dem[G.wood] * 0.7 + (fuelNeedPop + prod[G.tools] * 0.4 + prod[G.wares] * 0.25 + (crowd > 0.85 ? 4 : 0)) * 0.3;
  dem[G.stone] = dem[G.stone] * 0.85 + (civ.tech[TK.masonry] === 1 ? pop * 4e-3 : 0);
  dem[G.tools] = dem[G.tools] * 0.7 + (workers * 0.012 + Math.max(0, workers * 0.25 - stock[G.tools]) * 0.1) * 0.3;
  dem[G.weapons] = dem[G.weapons] * 0.7 + (jc[J.soldier] * 0.01 + Math.max(0, jc[J.soldier] - stock[G.weapons]) * 0.15) * 0.3;
  dem[G.wares] = dem[G.wares] * 0.7 + waresWant * 0.3;
  dem[G.salt] = dem[G.salt] * 0.7 + saltNeed * 0.3;
  for (let g = 0; g < NG; g++) {
    if (g === G.gold) {
      price[g] = GOOD_BASE[g];
      continue;
    }
    const months = g === G.food ? 7 : 5;
    const target = dem[g] * months + (g === G.food ? 2 : 0.4);
    const ratio = target / (stock[g] + dem[g] * 0.5 + 0.3);
    const tp = GOOD_BASE[g] * clamp(Math.pow(ratio, 0.7), 0.25, 6);
    price[g] += (tp - price[g]) * (0.3 + 0.1 * Math.min(2, s.bld[B.market]));
    s.imports[g] *= 0.9;
  }
  s.tradeVol *= 0.97;
  const labor = jc[J.laborer] * 1 + adults * 0.04;
  if (s.damage > 0.01) {
    const woodUse = Math.min(stock[G.wood], 3 + pop * 0.01);
    stock[G.wood] -= woodUse;
    s.damage = Math.max(0, s.damage - (labor * 0.25 + woodUse) / (pop * 1.2 + 60));
    if (s.damage < 0.01) {
      s.damage = 0;
      for (const u of s.urban) markDirty(sim, u);
    }
  } else if (s.build) {
    s.build.progress += labor * (civ.tech[TK.banking] === 1 ? 1.25 : 1);
    if (s.build.progress >= s.build.need) finishBuilding(sim, s, civ);
  } else if (!besieged && (tick2 + s.id) % 12 < 4) planBuilding(sim, s, civ, pop);
  if (crowd > 0.88 && !besieged) {
    const stoneCost = civ.tech[TK.masonry] === 1 && stock[G.stone] >= 3 ? 3 : 0;
    const woodCost = stoneCost > 0 ? 4 : 7;
    if (stock[G.wood] >= woodCost) {
      if (growUrban(sim, s)) {
        stock[G.wood] -= woodCost;
        stock[G.stone] -= stoneCost;
      }
    }
  }
  {
    const foreign = s.cultureMajor !== civ.culture ? 0.15 : 0;
    const occupied = s.occupier >= 0 ? 0.3 : s.originalCiv !== s.civ ? 0.12 : 0;
    const garrison = Math.min(0.3, (jc[J.soldier] - away) / (pop + 1) * 2.5);
    const target = clamp01((0.56 - s.happyAvg) * 1.7 + (0.5 - s.loyalAvg) * 1.3 + foreign + occupied + s.gini * 0.2 + civ.exhaustion * 0.3 + (taxRate - 0.2) * 0.6 + Math.max(0, civ.settlements.length - m.admin - 1) * 0.025 - garrison - templeJoy - (civ.legitimacy - 0.5) * 0.2) * P.unrest;
    s.unrest += (target - s.unrest) * 0.15;
    s.rebelHeat = s.unrest > 0.62 ? s.rebelHeat + 1 : Math.max(0, s.rebelHeat - 1);
  }
  if (month === s.id % 12) {
    claimTerritory(sim, s);
    refreshLand(sim, s);
    yearlySurvey(sim, s);
  }
  if (!besieged && MERCH.length > 0) dispatchTrade(sim, s, civ, MERCH);
  if (MIG.size > 0) flushMigration(sim, s, civ);
}
var SLOTS = new Array(NJ).fill(0);
var EXPECT = new Array(NJ).fill(0);
var MERCH = [];
var MIG = /* @__PURE__ */ new Map();
function yearlySurvey(sim, s) {
  const cc = /* @__PURE__ */ new Map(), rc = /* @__PURE__ */ new Map();
  const ws = [];
  for (const id of s.people) {
    const p = sim.people.get(id);
    cc.set(p.culture, (cc.get(p.culture) || 0) + 1);
    rc.set(p.religion, (rc.get(p.religion) || 0) + 1);
    if (p.job !== J.child) ws.push(p.wealth);
  }
  let bm = -1, bc = 0;
  for (const [k, v] of cc) if (v > bc) {
    bc = v;
    bm = k;
  }
  s.cultureMajor = bm;
  bm = -1;
  bc = 0;
  for (const [k, v] of rc) if (v > bc) {
    bc = v;
    bm = k;
  }
  s.religionMajor = bm;
  if (ws.length > 3) {
    ws.sort((a, b) => a - b);
    let cum = 0, tot = 0;
    for (let i = 0; i < ws.length; i++) {
      cum += (i + 1) * ws[i];
      tot += ws[i];
    }
    s.gini = tot > 0 ? clamp01(2 * cum / (ws.length * tot) - (ws.length + 1) / ws.length) : 0;
  }
  const gov = sim.people.get(s.governor);
  if (!gov || gov.home !== s.id) {
    s.governor = -1;
    const civ = sim.civs.get(s.civ);
    if (s.people.length > 60 && civ.capital !== s.id) {
      let best = null, bs = 0;
      const ruler = sim.people.get(civ.ruler);
      for (let t = 0; t < 14; t++) {
        const p = sim.people.get(s.people[sim.rng.int(s.people.length)]);
        if (!p || p.job === J.child || p.title !== TITLE.none) continue;
        let sc = p.sLead + p.cha * 0.5 + p.loyalty * 0.5 + (p.job === J.official ? 0.6 : 0) + Math.min(0.5, p.fame * 0.1);
        if (ruler && ruler.friends.indexOf(p.id) >= 0) sc += 0.6;
        if (ruler && ruler.rivals.indexOf(p.id) >= 0) sc -= 1;
        if (sc > bs) {
          bs = sc;
          best = p;
        }
      }
      if (best) {
        s.governor = best.id;
        best.title = TITLE.governor;
        if (best.job !== J.official && best.army < 0) setJob(sim, best, s, J.official);
        addFame(sim, best, 2);
        remember(best, sim.tick, M.governor, s.id);
      }
    }
  }
}
function startPlague(sim, s) {
  if (s.plague > 0) return;
  s.plague = 7 + sim.rng.int(6);
  addEvent(sim, "plague", s.people.length > 300 ? 3 : 2, `Plague has broken out in ${s.name}.`, [s.civ], [], s.id, s.x, s.y);
}
function planMigration(sim, s, civ, p, push) {
  const cul = sim.cultures.get(p.culture);
  let best = -1, bs = s.fedAvg * 2 + 0.7 - s.unrest * 0.8 - Math.max(0, s.people.length / s.housing - 0.9) * 1.5 - (s.siege >= 0 ? 2 : 0) + 0.25;
  for (const rid of s.routes) {
    const r = sim.routes.get(rid);
    if (!r) continue;
    const o = sim.settlements.get(r.a === s.id ? r.b : r.a);
    if (!o || !o.alive || o.siege >= 0) continue;
    if (r.sea && civ.mods.seaCap <= 0) continue;
    let sc = o.fedAvg * 2 + Math.min(0.6, o.wealthAvg / (s.wealthAvg + 1) * 0.3) - r.len / 55 - o.unrest * 0.8 - Math.max(0, o.people.length / o.housing - 0.9) * 1.5 - (o.plague > 0 ? 1 : 0);
    sc += o.cultureMajor === p.culture ? 0.4 : -0.3 * (cul ? cul.insular : 0.5);
    if (o.civ !== s.civ) {
      const oc = sim.civs.get(o.civ);
      if (!oc || oc.isolated || oc.laws.trade === 0) continue;
      const rel = civ.rel.get(o.civ);
      if (rel && rel.war >= 0) continue;
    } else sc += 0.25;
    for (const f of p.friends) if (sim.people.get(f)?.home === o.id) sc += 0.3;
    if (sc > bs) {
      bs = sc;
      best = o.id;
    }
  }
  if (best < 0) {
    if (push < 0.5 || p.bold < 0.4) return;
    best = -1;
  }
  let list = MIG.get(best);
  if (!list) MIG.set(best, list = []);
  if (list.length > Math.max(6, s.people.length * 0.12)) return;
  list.push(p);
}
function flushMigration(sim, s, civ) {
  for (const [dest, heads] of MIG) {
    const group = [];
    for (const h of heads) {
      if (!sim.people.has(h.id) || h.home !== s.id || h.party >= 0) continue;
      group.push(h);
      const sp = sim.people.get(h.spouse);
      if (sp && sp.home === s.id && sp.party < 0 && sp.army < 0 && group.indexOf(sp) < 0) group.push(sp);
      for (const kid of h.kids) {
        const c = sim.people.get(kid);
        if (c && c.home === s.id && c.party < 0 && ageOf(sim, c) < ADULT_AGE && group.indexOf(c) < 0) group.push(c);
      }
    }
    if (group.length === 0) continue;
    if (dest >= 0) sendMigrants(sim, s, dest, group, s.fedAvg < 0.7 || s.siege >= 0);
    else if (group.length >= 5) sendPioneers(sim, s, civ, group);
  }
  MIG.clear();
}
function abandonSettlement(sim, s, how) {
  if (!s.alive) return;
  const w = sim.world;
  const civ = sim.civs.get(s.civ);
  s.alive = false;
  for (const i of s.tiles) {
    if (w.owner[i] !== s.id) continue;
    w.owner[i] = -1;
    if (w.imp[i] === I_URBAN) w.imp[i] = s.peakPop >= 40 ? I_RUIN : I_NONE;
    else if (w.imp[i] !== I_RUIN) w.imp[i] = I_NONE;
    markDirty(sim, i);
  }
  if (s.peakPop >= 40) {
    const techs = [];
    if (civ) {
      for (let t = 0; t < civ.tech.length; t++) if (civ.tech[t] === 1) techs.push(t);
    }
    sim.ruins.push({ id: sim.nextId++, name: s.name, x: s.x, y: s.y, tile: s.tile, fell: sim.tick, civName: civ ? civ.name : "?", techs, peak: s.peakPop });
    addEvent(sim, "ruin", s.peakPop > 200 ? 3 : 2, `${s.name} lies ${how}. At its height ${s.peakPop} people lived there.`, civ ? [civ.id] : [], [], s.id, s.x, s.y);
  }
  for (const id of s.people.slice()) {
    const p = sim.people.get(id);
    if (p) killPerson(sim, p, how === "abandoned" ? "exposure" : "the destruction of " + s.name);
  }
  s.people.length = 0;
  for (const rid of s.routes.slice()) removeRoute(sim, rid);
  if (civ) {
    const k = civ.settlements.indexOf(s.id);
    if (k >= 0) civ.settlements.splice(k, 1);
    if (civ.capital === s.id) civ.capital = civ.settlements.length ? pickCapital(sim, civ) : -1;
  }
  if (s.siege >= 0) {
    const a = sim.armies.get(s.siege);
    if (a) a.goal = 0;
  }
  s.tiles.length = 0;
  s.farms.length = 0;
  s.urban.length = 0;
  s.mines.length = 0;
  sim.settlements.delete(s.id);
  sim.rt.borderDirty = true;
}
function removeRoute(sim, rid) {
  const r = sim.routes.get(rid);
  if (!r) return;
  for (const sid of [r.a, r.b]) {
    const s = sim.settlements.get(sid);
    if (s) {
      const k = s.routes.indexOf(rid);
      if (k >= 0) s.routes.splice(k, 1);
    }
  }
  sim.routeIndex.delete(r.a < r.b ? `${r.a}-${r.b}` : `${r.b}-${r.a}`);
  sim.routes.delete(rid);
}
function pickCapital(sim, civ) {
  let best = -1, bp = -1;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (s && s.alive && s.people.length > bp) {
      bp = s.people.length;
      best = sid;
    }
  }
  return best;
}
function transferSettlement(sim, s, toCiv, resent) {
  const from = sim.civs.get(s.civ);
  if (from && from.id === toCiv.id) return;
  if (from) {
    const k = from.settlements.indexOf(s.id);
    if (k >= 0) from.settlements.splice(k, 1);
    if (from.capital === s.id) from.capital = pickCapital(sim, from);
  }
  s.civ = toCiv.id;
  s.occupier = -1;
  toCiv.settlements.push(s.id);
  if (toCiv.capital < 0) toCiv.capital = s.id;
  for (const id of s.people) {
    const p = sim.people.get(id);
    if (!p) continue;
    if (p.army >= 0) continue;
    p.civ = toCiv.id;
    if (resent) {
      p.loyalty = Math.min(p.loyalty, 0.3);
      if (p.job !== J.child) remember(p, sim.tick, M.conquered, toCiv.id);
    } else p.loyalty = Math.max(p.loyalty, 0.6);
    if (p.title === TITLE.governor || p.title === TITLE.noble || p.title === TITLE.heir) p.title = TITLE.none;
  }
  s.governor = -1;
  s.build = null;
  sim.rt.borderDirty = true;
}

// src/sim/diplomacy.ts
function addGrievance(sim, civ, against, kind, mag, text) {
  civ.grievances.push({ civ: against, kind, mag, tick: sim.tick, text });
  if (civ.grievances.length > 24) {
    civ.grievances.sort((a, b) => b.mag - a.mag);
    civ.grievances.length = 24;
  }
}
function grievanceHeat(civ, against) {
  let h = 0;
  for (const g of civ.grievances) if (g.civ === against) h += g.mag;
  return h;
}
function nearestPair(sim, a, b) {
  let d = 1e9, mine = null, theirs = null;
  for (const sa of a.settlements) {
    const s = sim.settlements.get(sa);
    if (!s) continue;
    for (const sb of b.settlements) {
      const o = sim.settlements.get(sb);
      if (!o) continue;
      const dd = dist(s.x, s.y, o.x, o.y);
      if (dd < d) {
        d = dd;
        mine = s;
        theirs = o;
      }
    }
  }
  return { d, mine, theirs };
}
function warPotential(civ) {
  const levy = civ.pop * (civ.laws.conscription === 2 ? 0.1 : civ.laws.conscription === 1 ? 0.06 : 0.03);
  return civ.strength + levy * 0.8 * civ.mods.attack * civ.mods.weaponQ * 0.6;
}
function alliesPower(sim, civ, against) {
  let p = 0;
  for (const [oid, r] of civ.rel) {
    if (!r.alliance || oid === against) continue;
    const o = sim.civs.get(oid);
    if (o && o.alive) p += warPotential(o) * 0.5;
  }
  return p;
}
function diplomacySeasonal(sim, civ) {
  const rng = sim.rng;
  const cul = sim.cultures.get(civ.culture);
  const rel = civ.religion >= 0 ? sim.religions.get(civ.religion) : void 0;
  const ruler = sim.people.get(civ.ruler);
  let atWar = false;
  for (const [, r] of civ.rel) if (r.war >= 0) atWar = true;
  const myPower = warPotential(civ);
  for (const [oid, r] of civ.rel) {
    const o = sim.civs.get(oid);
    if (!o || !o.alive) {
      if (r.war >= 0) r.war = -1;
      continue;
    }
    if (!r.contact) continue;
    r.tradeVal *= 0.93;
    r.friction *= 0.96;
    if (r.war >= 0) continue;
    const ro = relationOf(sim, o, civ.id);
    const ocul = sim.cultures.get(o.culture);
    const heat = grievanceHeat(civ, oid);
    let t = Math.min(28, r.tradeVal / 25);
    if (o.culture === civ.culture) t += 15;
    else if (ocul.parent === civ.culture || cul.parent === o.culture || cul.parent >= 0 && cul.parent === ocul.parent) t += 6;
    else t -= cul.insular * 12;
    if (civ.religion >= 0 && o.religion >= 0) {
      if (civ.religion === o.religion) t += 14;
      else {
        const orel = sim.religions.get(o.religion);
        t -= 22 * Math.max(rel ? rel.militant : 0, orel ? orel.militant : 0);
      }
    }
    t -= r.friction * 45;
    t -= Math.min(60, heat);
    if (r.alliance) t += 20;
    if (r.tradePact) t += 10;
    if (r.tribute > 0) t += 5;
    if (r.tribute < 0) t -= 15;
    for (const [tid, tr] of civ.rel) {
      if (tid === oid || tr.war < 0) continue;
      if (o.rel.get(tid)?.war !== void 0 && o.rel.get(tid).war >= 0) t += 18;
    }
    if (ruler) t += (ruler.comp - 0.5) * 10;
    r.score += (clamp(t, -100, 100) - r.score) * 0.1;
    if (r.tribute < 0) {
      const pay = Math.min(Math.max(0, civ.treasury), -r.tribute);
      civ.treasury -= pay;
      civ.expense += pay;
      o.treasury += pay;
      o.income += pay;
      if (warPotential(civ) > warPotential(o) * 1.3 && rng.chance(0.05)) {
        r.tribute = 0;
        ro.tribute = 0;
        addEvent(sim, "diplomacy", 2, `The ${civ.name} stopped paying tribute to the ${o.name}.`, [civ.id, oid], [], civ.capital, -1, -1);
        ro.score -= 25;
      }
    }
    if (civ.isolated || o.isolated) continue;
    if (!r.tradePact && r.score > 28 && ro.score > 20 && civ.laws.trade > 0 && o.laws.trade > 0 && r.tradeVal > 5 && rng.chance(0.15)) {
      r.tradePact = ro.tradePact = true;
      addEvent(sim, "treaty", 2, `The ${civ.name} and the ${o.name} signed a trade agreement.`, [civ.id, oid], [], civ.capital, -1, -1);
    } else if (r.tradePact && (r.score < -5 || civ.laws.trade === 0)) {
      r.tradePact = ro.tradePact = false;
      addEvent(sim, "treaty", 1, `The trade agreement between the ${civ.name} and the ${o.name} has lapsed.`, [civ.id, oid], [], civ.capital, -1, -1);
    }
    if (!r.alliance && r.score > 50 && ro.score > 42 && rng.chance(0.1)) {
      let threat = false;
      for (const [tid, tr] of civ.rel) {
        if (tid === oid || !tr.contact) continue;
        const otr = o.rel.get(tid);
        if ((tr.score < -25 || tr.war >= 0) && otr && (otr.score < -10 || otr.war >= 0)) threat = true;
      }
      if (threat) {
        r.alliance = ro.alliance = true;
        addEvent(sim, "treaty", 3, `The ${civFullName(civ)} and the ${civFullName(o)} have sworn a defensive alliance.`, [civ.id, oid], [], civ.capital, -1, -1);
      }
    } else if (r.alliance && r.score < 10) {
      r.alliance = ro.alliance = false;
      addEvent(sim, "treaty", 2, `The alliance between the ${civ.name} and the ${o.name} is broken.`, [civ.id, oid], [], civ.capital, -1, -1);
    }
    if (r.alliance && r.score > 70 && ro.score > 60 && o.culture === civ.culture && civ.pop >= o.pop && civ.rebelOf < 0 && o.rebelOf < 0 && o.gov !== GOV.band && !atWar && rng.chance(0.012)) {
      addEvent(sim, "union", 4, `By an act of union, the ${civFullName(o)} has joined the ${civFullName(civ)}. Two realms of one people are now one.`, [civ.id, oid], [], civ.capital, -1, -1);
      absorbCiv(sim, civ, o, false);
      removeCiv(sim, o, "was united with its ally");
      civ.memory.push(`the union with ${o.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
      continue;
    }
    if (atWar || r.alliance || sim.tick < r.truceUntil || civ.rebelOf >= 0 || civ.pop < 40) continue;
    if (!rng.chance(0.3)) continue;
    let scarcity = 0, wantGood = -1;
    for (let g = 0; g < civ.needs.length; g++) {
      if (civ.needs[g] < 0.25) continue;
      let theyHave = false;
      for (const sid of o.settlements) {
        const s = sim.settlements.get(sid);
        if (!s) continue;
        if (s.stock[g] > 40 || s.prod[g] > 3) theyHave = true;
        if (!theyHave) {
          for (const m of s.mines) if (RES_GOOD[sim.world.res[m]] === g) theyHave = true;
        }
        if (theyHave) break;
      }
      if (theyHave && civ.needs[g] > scarcity) {
        scarcity = civ.needs[g];
        wantGood = g;
      }
    }
    const zeal = civ.religion >= 0 && o.religion >= 0 && civ.religion !== o.religion && rel ? rel.militant * 0.35 : 0;
    const opportunism = (1 - o.stability) * 0.3 + (o.exhaustion > 0.3 ? 0.2 : 0);
    const income = civ.incomeLast + 1;
    const tradeDep = clamp01(r.tradeVal * 0.15 / income) * (0.6 + civ.pTrade);
    let desire2 = civ.pExpand * 0.45 + civ.pMilitary * 0.3 + scarcity * 0.5 + Math.min(0.6, heat * 0.012) + zeal + opportunism + r.friction * 0.4;
    desire2 -= r.score / 90 + tradeDep * 0.9 + civ.exhaustion * 1.5 + (r.tradePact ? 0.15 : 0);
    desire2 *= sim.params.aggression;
    if (desire2 < 0.8) continue;
    const theirPower = warPotential(o) * o.mods.defense + alliesPower(sim, o, civ.id);
    const ratio = (myPower + alliesPower(sim, civ, oid) * 0.6) / (theirPower + 1);
    const nerve = 1.2 - (ruler ? (ruler.bold - 0.5) * 0.5 : 0);
    if (ratio < nerve) {
      continue;
    }
    if (civ.treasury < civ.soldiers * 2 && civ.gov !== GOV.band && civ.gov !== GOV.chiefdom) continue;
    const np = nearestPair(sim, civ, o);
    if (!np.theirs || np.d > 45 && civ.mods.seaCap <= 0) continue;
    if (ratio > 2.2 && r.tribute === 0 && civ.pTrade > civ.pMilitary && rng.chance(0.6)) {
      const amt = Math.max(2, o.incomeLast * 0.15);
      r.tribute = amt;
      ro.tribute = -amt;
      ro.score -= 20;
      addGrievance(sim, o, civ.id, "tribute", 10, `forced to pay tribute to the ${civ.name}`);
      addEvent(sim, "diplomacy", 3, `Under threat of invasion, the ${o.name} agreed to pay tribute to the ${civFullName(civ)}.`, [civ.id, oid], [], o.capital, -1, -1);
      continue;
    }
    if (!np.mine || !travelPath(sim, np.mine.tile, np.theirs.tile, civ.mods.seaCap > 0, np.mine.portTile)) {
      r.truceUntil = sim.tick + 15 * TICKS_PER_YEAR;
      continue;
    }
    let goal = "conquest";
    let target = np.theirs.id;
    if (heat > 25 && heat * 0.012 > scarcity * 0.5) goal = "revenge";
    else if (scarcity > 0.3 && wantGood >= 0) {
      goal = "resources";
      let bd = 1e9;
      for (const sid of o.settlements) {
        const s = sim.settlements.get(sid);
        if (!s) continue;
        let hasIt = s.stock[wantGood] > 40 || s.prod[wantGood] > 3;
        for (const m of s.mines) if (RES_GOOD[sim.world.res[m]] === wantGood) hasIt = true;
        if (!hasIt || !np.mine) continue;
        const d = dist(s.x, s.y, np.mine.x, np.mine.y);
        if (d < bd) {
          bd = d;
          target = s.id;
        }
      }
    } else if (zeal > 0.2) goal = "holy";
    declareWar(sim, civ, o, goal, target, wantGood);
    atWar = true;
  }
}
var GOOD_WORD = ["grain", "timber", "stone", "copper", "iron", "coal", "gold", "salt", "oil", "tools", "arms", "luxuries"];
function declareWar(sim, att, def, goal, target, good = -1) {
  let prior = 0;
  for (const w of sim.wars.values()) if (w.att === att.id && w.def === def.id || w.att === def.id && w.def === att.id) prior++;
  const ord = ["", "Second ", "Third ", "Fourth ", "Fifth ", "Sixth "][Math.min(5, prior)];
  let name;
  const ts = sim.settlements.get(target);
  if (goal === "independence") name = `${att.adj} War of Independence`;
  else if (goal === "overthrow") name = `${def.adj} Civil War`;
  else if (goal === "holy") name = `${ord}${att.adj} Holy War`;
  else if (goal === "resources" && good >= 0) name = `${ord}${cap1(GOOD_WORD[good])} War`;
  else name = `${ord}${att.adj}\u2013${def.adj} War`;
  const war = {
    id: sim.nextId++,
    name,
    att: att.id,
    def: def.id,
    attAllies: [],
    defAllies: [],
    start: sim.tick,
    end: -1,
    goal,
    target,
    score: 0,
    attLoss: 0,
    defLoss: 0,
    battles: 0,
    outcome: "",
    lastAction: sim.tick,
    taken: []
  };
  sim.wars.set(war.id, war);
  const ra = relationOf(sim, att, def.id), rb = relationOf(sim, def, att.id);
  ra.war = rb.war = war.id;
  ra.contact = rb.contact = true;
  ra.tradePact = rb.tradePact = false;
  ra.alliance = rb.alliance = false;
  ra.score = Math.min(ra.score, -50);
  rb.score = Math.min(rb.score, -60);
  ra.tribute = rb.tribute = 0;
  if (goal !== "independence" && goal !== "overthrow") {
    for (const [oid, r] of def.rel) {
      if (!r.alliance || oid === att.id) continue;
      const al = sim.civs.get(oid);
      if (!al || !al.alive || r.score < 15) continue;
      war.defAllies.push(oid);
      relationOf(sim, al, att.id).war = war.id;
      relationOf(sim, att, al.id).war = war.id;
      relationOf(sim, al, att.id).contact = relationOf(sim, att, al.id).contact = true;
    }
    for (const [oid, r] of att.rel) {
      if (!r.alliance || oid === def.id || war.defAllies.indexOf(oid) >= 0) continue;
      const al = sim.civs.get(oid);
      if (!al || !al.alive || r.score < 40) continue;
      war.attAllies.push(oid);
      relationOf(sim, al, def.id).war = war.id;
      relationOf(sim, def, al.id).war = war.id;
      relationOf(sim, al, def.id).contact = relationOf(sim, def, al.id).contact = true;
    }
  }
  if (goal !== "independence" && goal !== "overthrow") {
    let why = "";
    if (goal === "resources" && good >= 0) why = ` Its people are short of ${GOOD_WORD[good]}, and ${ts ? ts.name : "the enemy"} has it.`;
    else if (goal === "revenge") {
      const g = att.grievances.filter((x) => x.civ === def.id).sort((a, b) => b.mag - a.mag)[0];
      why = g ? ` They have not forgotten being ${g.text}.` : "";
    } else if (goal === "holy") why = " Its priests call it a holy war.";
    else why = ts ? ` Its armies march on ${ts.name}.` : "";
    const allies = war.defAllies.length ? ` ${war.defAllies.map((id) => "The " + sim.civs.get(id).name).join(" and ")} stand${war.defAllies.length === 1 ? "s" : ""} with the defenders.` : "";
    const ruler = sim.people.get(att.ruler);
    addEvent(sim, "war", 4, `${civFullName(att)}${ruler ? " under " + fullName(sim, ruler) : ""} declared war on ${civFullName(def)}.${why}${allies}`, [att.id, def.id].concat(war.defAllies, war.attAllies), ruler ? [ruler.id] : [], target, ts ? ts.x : -1, ts ? ts.y : -1);
    addGrievance(sim, def, att.id, "invasion", 22, `invaded by the ${att.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
    att.memory.push(`the ${name} (begun year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1})`);
    def.memory.push(`the ${name} (begun year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1})`);
  }
  return war;
}
function cap1(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function sidesOf(war) {
  return { a: [war.att].concat(war.attAllies), d: [war.def].concat(war.defAllies) };
}
function endWar(sim, war, outcome) {
  if (war.end >= 0) return;
  war.end = sim.tick;
  war.outcome = outcome;
  const { a, d } = sidesOf(war);
  const truce = sim.tick + (8 + sim.rng.int(8)) * TICKS_PER_YEAR;
  for (const x of a) {
    for (const y of d) {
      const cx = sim.civs.get(x), cy = sim.civs.get(y);
      if (cx) {
        const r = relationOf(sim, cx, y);
        r.war = -1;
        r.truceUntil = truce;
        r.lastWar = sim.tick;
      }
      if (cy) {
        const r = relationOf(sim, cy, x);
        r.war = -1;
        r.truceUntil = truce;
        r.lastWar = sim.tick;
      }
    }
  }
  for (const army of sim.armies.values()) {
    if (army.war === war.id) {
      army.goal = 4;
      army.path = [];
      army.foe = -1;
    }
  }
  for (const s of sim.settlements.values()) {
    if (s.siege >= 0) {
      const army = sim.armies.get(s.siege);
      if (!army || army.war === war.id) {
        s.siege = -1;
        s.siegeMonths = 0;
      }
    }
    if (s.blockaded && (a.indexOf(s.civ) >= 0 || d.indexOf(s.civ) >= 0)) s.blockaded = false;
  }
}

// src/sim/war.ts
function hostile(sim, a, b) {
  if (a === b) return false;
  const r = sim.civs.get(a)?.rel.get(b);
  return !!r && r.war >= 0;
}
function armyTile(sim, a) {
  const w = sim.world;
  return clamp(Math.round(a.y), 0, w.h - 1) * w.w + clamp(Math.round(a.x), 0, w.w - 1);
}
function raiseArmy(sim, civ, s, warId) {
  const troops = [];
  const near = [s];
  for (const sid of civ.settlements) {
    const o = sim.settlements.get(sid);
    if (o && o.id !== s.id && o.siege < 0 && dist(o.x, o.y, s.x, s.y) < 26) near.push(o);
  }
  let adults = 0;
  for (const o of near) {
    let k = 0;
    for (const id of o.people) {
      const p = sim.people.get(id);
      if (p.job === J.child) continue;
      adults++;
      if (p.job === J.soldier && p.army < 0 && p.party < 0 && k++ % 4 !== 3) troops.push(p);
    }
  }
  const want = Math.round(adults * civ.soldierTarget);
  if (troops.length < want && (civ.laws.conscription >= 1 || civ.gov <= GOV.chiefdom)) {
    for (const o of near) {
      for (const id of o.people) {
        if (troops.length >= want) break;
        const p = sim.people.get(id);
        if (p.job === J.child || p.job === J.soldier || p.title !== TITLE.none || p.party >= 0 || p.army >= 0) continue;
        const age = ageOf(sim, p);
        if (age < 16 || age > 45) continue;
        if (p.sex === 0 && civ.laws.conscription < 2) continue;
        if (p.job === J.scholar || p.job === J.priest || p.job === J.official) continue;
        if (!sim.rng.chance(0.5)) continue;
        setJob(sim, p, o, J.soldier);
        remember(p, sim.tick, M.conscripted, warId);
        p.happy = Math.max(0, p.happy - 0.1);
        troops.push(p);
      }
    }
  }
  if (troops.length < 5) return null;
  let general = troops[0];
  for (const p of troops) if (p.sLead + p.fame * 0.03 > general.sLead + general.fame * 0.03) general = p;
  const arms = Math.min(troops.length, s.stock[G.weapons]);
  s.stock[G.weapons] -= arms * 0.5;
  const cover = arms / troops.length;
  const equip = 0.7 + 0.3 * cover * Math.max(1, s.weaponQ) + (civ.mods.weaponQ - 1) * 0.25 * cover;
  const rations = Math.min(s.stock[G.food] * 0.3, troops.length * 4);
  s.stock[G.food] -= rations;
  const a = {
    id: sim.nextId++,
    civ: civ.id,
    name: "",
    general: general.id,
    soldiers: [],
    x: s.x,
    y: s.y,
    path: [],
    pi: 0,
    goal: 0,
    target: -1,
    home: s.id,
    supply: rations / troops.length,
    morale: clamp01(0.7 + civ.mods.morale + (sim.cultures.get(civ.culture).martial - 0.5) * 0.2),
    atSea: false,
    fighting: 0,
    war: warId,
    raised: sim.tick,
    kills: 0,
    losses: 0,
    wait: 0,
    foe: -1,
    bLoss: 0,
    bStart: 0,
    bTick: 0,
    moveAcc: 0,
    equip,
    n0: troops.length
  };
  for (const p of troops) {
    p.army = a.id;
    a.soldiers.push(p.id);
  }
  if (general.title === TITLE.none) {
    general.title = TITLE.general;
    remember(general, sim.tick, M.general, civ.id);
    addFame(sim, general, 2);
  }
  a.name = `${["First", "Second", "Third", "Fourth", "Fifth"][Math.min(4, civ.armies.length)]} ${civ.adj} Host`;
  sim.armies.set(a.id, a);
  civ.armies.push(a.id);
  return a;
}
function disbandArmy(sim, a, silent) {
  for (const id of a.soldiers) {
    const p = sim.people.get(id);
    if (p) p.army = -1;
  }
  a.soldiers.length = 0;
  for (const s of sim.settlements.values()) {
    if (s.siege === a.id) {
      s.siege = -1;
      s.siegeMonths = 0;
    }
  }
  const civ = sim.civs.get(a.civ);
  if (civ) {
    const k = civ.armies.indexOf(a.id);
    if (k >= 0) civ.armies.splice(k, 1);
  }
  for (const o of sim.armies.values()) if (o.foe === a.id) o.foe = -1;
  sim.armies.delete(a.id);
}
function armyPower(sim, a, civ, defending) {
  let sum = 0;
  for (const id of a.soldiers) {
    const p = sim.people.get(id);
    if (p) sum += 0.5 + p.sFight;
  }
  const gen = sim.people.get(a.general);
  const lead = gen && gen.army === a.id ? 1 + gen.sLead * 0.5 : 0.9;
  let terr = 1;
  if (defending) {
    const w = sim.world;
    const i = armyTile(sim, a);
    if (w.elev[i] - w.seaLevel + SEA > HILL) terr += 0.25;
    if (w.forest[i] > 0.4) terr += 0.15;
    if (w.river[i] > 20) terr += 0.15;
    terr *= civ.mods.defense;
  }
  return sum * a.equip * (0.4 + a.morale * 0.8) * lead * terr * civ.mods.attack * (a.supply <= 0 ? 0.8 : 1) * (a.atSea ? 0.6 : 1);
}
function placeName2(sim, x, y) {
  let best = null, bd = 14 * 14;
  for (const s of sim.settlements.values()) {
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  if (best) return bd < 9 ? best.name : `the fields near ${best.name}`;
  const w = sim.world;
  const i = clamp(Math.round(y), 0, w.h - 1) * w.w + clamp(Math.round(x), 0, w.w - 1);
  if (w.water[i] !== W_LAND) return "the open sea";
  if (w.elev[i] - w.seaLevel + SEA > HILL) return "the high passes";
  if (w.forest[i] > 0.4) return "the deep woods";
  return "the borderlands";
}
function killSoldiers(sim, a, n, cause) {
  let dead = 0;
  for (let k = 0; k < n && a.soldiers.length > 0; k++) {
    const idx = sim.rng.int(a.soldiers.length);
    const p = sim.people.get(a.soldiers[idx]);
    if (!p) {
      a.soldiers.splice(idx, 1);
      continue;
    }
    if (p.id === a.general && sim.rng.chance(0.7)) continue;
    killPerson(sim, p, cause);
    dead++;
  }
  a.losses += dead;
  return dead;
}
function warOf(sim, a, b) {
  const r = sim.civs.get(a.civ)?.rel.get(b.civ);
  return r && r.war >= 0 ? sim.wars.get(r.war) : void 0;
}
function sideSign(war, civId) {
  return civId === war.att || war.attAllies.indexOf(civId) >= 0 ? 1 : -1;
}
function battleRound(sim, a, b) {
  const ca = sim.civs.get(a.civ), cb = sim.civs.get(b.civ);
  const w = sim.world;
  if (a.foe !== b.id) {
    a.foe = b.id;
    a.bLoss = 0;
    a.bStart = a.soldiers.length;
    a.bTick = sim.tick;
  }
  if (b.foe !== a.id) {
    b.foe = a.id;
    b.bLoss = 0;
    b.bStart = b.soldiers.length;
    b.bTick = sim.tick;
  }
  a.fighting = b.fighting = 6;
  const ta = armyTile(sim, a), tb = armyTile(sim, b);
  const oa = w.owner[ta] >= 0 ? sim.settlements.get(w.owner[ta])?.civ : -1;
  const ob = w.owner[tb] >= 0 ? sim.settlements.get(w.owner[tb])?.civ : -1;
  const aDef = oa === a.civ || a.path.length === 0 && ob !== b.civ;
  const bDef = !aDef && (ob === b.civ || b.path.length === 0);
  const pa = armyPower(sim, a, ca, aDef), pb = armyPower(sim, b, cb, bDef);
  const na = a.soldiers.length, nb = b.soldiers.length;
  const scale = Math.min(na, nb) * 0.07 + 0.6;
  const rng = sim.rng;
  const la = scale * (pb / (pa + pb + 1e-6)) * rng.range(0.6, 1.4);
  const lb = scale * (pa / (pa + pb + 1e-6)) * rng.range(0.6, 1.4);
  const da = killSoldiers(sim, a, Math.floor(la) + (rng.chance(la % 1) ? 1 : 0), "battle");
  const db = killSoldiers(sim, b, Math.floor(lb) + (rng.chance(lb % 1) ? 1 : 0), "battle");
  a.bLoss += da;
  b.bLoss += db;
  a.kills += db;
  b.kills += da;
  a.morale = clamp01(a.morale - da / (na + 1) * 1.6 + db / (nb + 1) * 0.5 - 4e-3);
  b.morale = clamp01(b.morale - db / (nb + 1) * 1.6 + da / (na + 1) * 0.5 - 4e-3);
  sim.rt.fx.push({ kind: "clash", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: 1.5, t: sim.tick });
  const war = warOf(sim, a, b);
  if (war) {
    if (sideSign(war, a.civ) > 0) {
      war.attLoss += da;
      war.defLoss += db;
    } else {
      war.attLoss += db;
      war.defLoss += da;
    }
  }
  const aBreaks = a.soldiers.length === 0 || a.morale < 0.2 || a.soldiers.length < a.bStart * 0.4;
  const bBreaks = b.soldiers.length === 0 || b.morale < 0.2 || b.soldiers.length < b.bStart * 0.4;
  if (!aBreaks && !bBreaks) return;
  const win = aBreaks && bBreaks ? pa >= pb ? a : b : aBreaks ? b : a;
  const lose = win === a ? b : a;
  const wc = win === a ? ca : cb, lc = win === a ? cb : ca;
  if (lose.soldiers.length > 0) {
    const chase = wc.tech[TK.riding] === 1 ? 0.14 : 0.06;
    const pd = killSoldiers(sim, lose, Math.floor(lose.soldiers.length * chase), "the rout after battle");
    lose.bLoss += pd;
    win.kills += pd;
    if (war) {
      if (sideSign(war, lose.civ) > 0) war.attLoss += pd;
      else war.defLoss += pd;
    }
  }
  const where = placeName2(sim, (a.x + b.x) / 2, (a.y + b.y) / 2);
  const wg = sim.people.get(win.general), lg = sim.people.get(lose.general);
  const big = win.bStart + lose.bStart;
  if (big >= 16) {
    const destroyed = lose.soldiers.length === 0;
    addEvent(sim, "battle", big > 120 ? 3 : 2, `Battle of ${where}: ${wg ? "General " + fullName(sim, wg) + " and " : ""}the ${wc.name} (${win.bStart} strong) ${destroyed ? "annihilated" : "routed"} ${lose.bStart} ${lc.adj} troops${lg && lg.army === lose.id ? " under " + fullName(sim, lg) : ""}. ${win.bLoss + lose.bLoss} fell.`, [wc.id, lc.id], wg ? [wg.id] : [], -1, Math.round(win.x), Math.round(win.y));
  }
  if (war) {
    war.battles++;
    war.score = clamp(war.score + sideSign(war, win.civ) * (5 + 14 * (lose.bLoss / (lose.bStart + 1))), -100, 100);
    war.lastAction = sim.tick;
  }
  if (wg && wg.army === win.id) {
    addFame(sim, wg, big > 80 ? 4 : 2);
    remember(wg, sim.tick, M.battle, lc.id);
    practice(wg, J.soldier, 0.2);
    wg.loyalty = Math.max(0, wg.loyalty - (wg.amb > 0.65 ? 0.05 : -0.03));
  }
  for (const id of win.soldiers) {
    const p = sim.people.get(id);
    if (p) {
      practice(p, J.soldier, 0.12);
      if (sim.rng.chance(0.2)) remember(p, sim.tick, M.battle, lc.id);
    }
  }
  win.morale = clamp01(win.morale + 0.2);
  win.foe = -1;
  lose.foe = -1;
  wc.exhaustion = clamp01(wc.exhaustion + win.bLoss / (wc.pop * 0.05 + 10) * 0.25);
  lc.exhaustion = clamp01(lc.exhaustion + lose.bLoss / (lc.pop * 0.05 + 10) * 0.25 + 0.03);
  lc.legitimacy = Math.max(0, lc.legitimacy - 0.03);
  if (lose.soldiers.length === 0) disbandArmy(sim, lose, true);
  else retreat(sim, lose);
}
function retreat(sim, a) {
  const civ = sim.civs.get(a.civ);
  let home = sim.settlements.get(a.home);
  if (!home || !home.alive || home.civ !== a.civ) {
    home = civ ? sim.settlements.get(civ.capital) : void 0;
    if (home) a.home = home.id;
  }
  a.goal = 4;
  a.target = -1;
  a.path = [];
  a.pi = 0;
  for (const s of sim.settlements.values()) if (s.siege === a.id) {
    s.siege = -1;
    s.siegeMonths = 0;
  }
  if (home) setPath(sim, a, home.tile);
}
function setPath(sim, a, toTile) {
  const w = sim.world;
  const from = armyTile(sim, a);
  if (from === toTile) {
    a.path = [];
    return true;
  }
  const civ = sim.civs.get(a.civ);
  let path = null;
  if (w.water[from] === W_LAND && w.landmass[from] === w.landmass[toTile]) path = findPath(sim, from, toTile, false, 14e3);
  if (!path && civ.mods.seaCap > 0) {
    if (w.water[from] !== W_LAND) path = travelPath(sim, from, toTile, true, from);
    else {
      let port = null, bd = 1e9;
      for (const sid of civ.settlements) {
        const s = sim.settlements.get(sid);
        if (!s || s.portTile < 0 || w.landmass[s.tile] !== w.landmass[from]) continue;
        const d = dist(s.x, s.y, a.x, a.y);
        if (d < bd) {
          bd = d;
          port = s;
        }
      }
      if (port) {
        const leg1 = port.tile === from ? [from] : findPath(sim, from, port.tile, false, 9e3);
        const leg2 = travelPath(sim, port.tile, toTile, true, port.portTile);
        if (leg1 && leg2) path = leg1.concat(leg2.slice(1));
      }
    }
  }
  if (!path) return false;
  a.path = path;
  a.pi = 0;
  return true;
}
function upkeep(sim, a, civ) {
  const n = a.soldiers.length;
  let src = null, bd = civ.mods.supplyRange * (a.atSea ? 0.5 : 1);
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s || s.siege >= 0) continue;
    const d = dist(s.x, s.y, a.x, a.y);
    if (d < bd) {
      bd = d;
      src = s;
    }
  }
  if (src && src.stock[G.food] > n * 1.5) {
    src.stock[G.food] -= n;
    if (a.supply < 3 && src.stock[G.food] > n * 4) {
      src.stock[G.food] -= n * 0.5;
      a.supply += 0.5;
    }
  } else a.supply -= 1;
  if (a.supply <= 0) {
    a.supply = 0;
    a.morale = clamp01(a.morale - 0.07);
    const lost = killSoldiers(sim, a, Math.ceil(n * 0.035), "hunger on campaign");
    const war = sim.wars.get(a.war);
    if (war && lost) {
      if (sideSign(war, a.civ) > 0) war.attLoss += lost;
      else war.defLoss += lost;
    }
  } else if (a.foe < 0 && a.morale < 0.7 + civ.mods.morale) a.morale = Math.min(1, a.morale + 0.02);
  for (const id of a.soldiers) {
    const p = sim.people.get(id);
    if (p) p.fed += ((a.supply > 0 ? 0.95 : 0.5) - p.fed) * 0.4;
  }
}
function garrisonOf(sim, s) {
  let n = 0, power = 0;
  const list = [];
  for (const id of s.people) {
    const p = sim.people.get(id);
    if (p.job === J.soldier && p.army < 0) {
      n++;
      power += 0.5 + p.sFight;
      list.push(p);
    }
  }
  return { n, power, list };
}
function siegeMonthly(sim, a, civ, s) {
  const dc = sim.civs.get(s.civ);
  const rng = sim.rng;
  if (s.siege < 0) {
    s.siege = a.id;
    s.siegeMonths = 0;
    const gen = sim.people.get(a.general);
    addEvent(sim, "siege", 2, `${gen ? "General " + fullName(sim, gen) : "An army"} of the ${civ.name} laid siege to ${s.name} with ${a.soldiers.length} troops.`, [civ.id, dc.id], gen ? [gen.id] : [], s.id, s.x, s.y);
  } else if (s.siege !== a.id) {
  }
  s.siegeMonths++;
  s.lastRaid = sim.tick;
  const g = garrisonOf(sim, s);
  let adults = 0;
  for (const id of s.people) if (sim.people.get(id).job !== J.child) adults++;
  const militia = adults * 0.22;
  const wallF = 1 + s.bld[B.walls] * 0.9 / civ.mods.siege;
  const defPower = (g.power * (0.7 + 0.3 * Math.min(1, s.stock[G.weapons] / (g.n + 1)) * s.weaponQ) + militia * 0.45) * wallF * dc.mods.defense * (0.5 + s.fedAvg * 0.5);
  const attPower = armyPower(sim, a, civ, false);
  const taken = Math.min(s.stock[G.food] * 0.03, a.soldiers.length * 0.3);
  s.stock[G.food] -= taken;
  if (taken > a.soldiers.length * 0.2) a.supply = Math.min(3, a.supply + 0.25);
  if (rng.chance(0.25) && s.farms.length > 0) {
    const f = s.farms[rng.int(s.farms.length)];
    if (sim.world.forest[f] > 0.2 || rng.chance(0.3)) ignite(sim, f);
  }
  const war = sim.wars.get(a.war);
  if (s.siegeMonths >= 3 && (s.fedAvg < 0.5 || s.stock[G.food] < 1)) {
    capture(sim, a, civ, s, false, war);
    return;
  }
  const odds = attPower / (defPower + 0.5);
  const storm = odds > 1.5 && s.siegeMonths >= 2 || odds > 4 || odds > 0.9 && s.siegeMonths > 5 && rng.chance(0.25) || a.supply <= 0.5 && odds > 0.75;
  if (storm) {
    const na = a.soldiers.length;
    const la = Math.min(na * 0.4, defPower / (attPower + defPower) * na * 0.3 * rng.range(0.6, 1.4));
    const da = killSoldiers(sim, a, Math.round(la), "storming the walls of " + s.name);
    let dd = 0;
    const ld = Math.round(attPower / (attPower + defPower) * g.n * 0.5 * rng.range(0.6, 1.4));
    for (let k = 0; k < ld && g.list.length > 0; k++) {
      const p = g.list.pop();
      killPerson(sim, p, "defending " + s.name);
      dd++;
    }
    if (war) {
      const sg = sideSign(war, a.civ);
      if (sg > 0) {
        war.attLoss += da;
        war.defLoss += dd;
      } else {
        war.attLoss += dd;
        war.defLoss += da;
      }
    }
    sim.rt.fx.push({ kind: "clash", x: s.x, y: s.y, r: 2, t: sim.tick });
    a.fighting = 8;
    if (attPower * rng.range(0.7, 1.3) > defPower) {
      capture(sim, a, civ, s, true, war);
      return;
    }
    a.morale = clamp01(a.morale - 0.15);
    civ.exhaustion = clamp01(civ.exhaustion + 0.02);
    if (da + dd > 15) addEvent(sim, "siege", 2, `The ${civ.name} stormed the walls of ${s.name} and were thrown back. ${da} attackers and ${dd} defenders died.`, [civ.id, dc.id], [], s.id, s.x, s.y);
  }
  if (a.supply <= 0 && a.morale < 0.35 || a.soldiers.length < 4 || s.siegeMonths > 40) {
    addEvent(sim, "siege", 2, `The siege of ${s.name} was lifted. The ${civ.name} withdrew${a.supply <= 0 ? ", starving" : ""}.`, [civ.id, dc.id], [], s.id, s.x, s.y);
    if (war) war.score = clamp(war.score - sideSign(war, a.civ) * 8, -100, 100);
    retreat(sim, a);
  }
}
function capture(sim, a, civ, s, sack, war) {
  const dc = sim.civs.get(s.civ);
  const rng = sim.rng;
  const months = s.siegeMonths;
  const wasCapital = dc.capital === s.id;
  s.siege = -1;
  s.siegeMonths = 0;
  const home = sim.settlements.get(a.home);
  const frac = sack ? 0.5 : 0.15;
  for (let g = 0; g < s.stock.length; g++) {
    const take = s.stock[g] * frac;
    s.stock[g] -= take;
    if (home && home.alive) home.stock[g] += take * 0.7;
  }
  let loot = 0, killed = 0;
  const flee = [];
  for (const id of s.people.slice()) {
    const p = sim.people.get(id);
    if (!p || p.army >= 0) continue;
    if (sack) {
      const t = p.wealth * 0.4;
      p.wealth -= t;
      loot += t;
      if (p.job !== J.child && rng.chance(p.job === J.soldier ? 0.5 : 0.05)) {
        killPerson(sim, p, "the sack of " + s.name);
        killed++;
        continue;
      }
    }
    if (p.title === TITLE.ruler) continue;
    if (p.spouse >= 0 && p.sex === 0) continue;
    if (rng.chance(sack ? 0.22 : 0.07) && p.job !== J.child) flee.push(p);
  }
  civ.treasury += loot;
  civ.income += loot;
  if (sack) {
    s.damage = clamp01(s.damage + 0.4);
    for (const u of s.urban) {
      if (rng.chance(0.3)) ignite(sim, u);
      markDirty(sim, u);
    }
    for (let b = 0; b < s.bld.length; b++) if (s.bld[b] > 0 && rng.chance(0.25)) s.bld[b]--;
  } else s.damage = clamp01(s.damage + 0.08);
  if (flee.length > 0) {
    let dest = null, bd = 1e9;
    for (const sid of dc.settlements) {
      const o = sim.settlements.get(sid);
      if (!o || o.id === s.id || o.siege >= 0) continue;
      const d = dist(o.x, o.y, s.x, s.y);
      if (d < bd) {
        bd = d;
        dest = o;
      }
    }
    if (dest) {
      const group = [];
      for (const h of flee) {
        if (group.indexOf(h) < 0) group.push(h);
        const sp = sim.people.get(h.spouse);
        if (sp && sp.home === s.id && sp.army < 0 && group.indexOf(sp) < 0) group.push(sp);
        for (const k of h.kids) {
          const c = sim.people.get(k);
          if (c && c.home === s.id && c.job === J.child && group.indexOf(c) < 0) group.push(c);
        }
      }
      sendMigrants(sim, s, dest.id, group, true);
    }
  }
  const gen = sim.people.get(a.general);
  addEvent(sim, "conquest", wasCapital ? 4 : 3, `${s.name}${wasCapital ? ", capital of the " + dc.name + "," : ""} fell to the ${civ.name} after ${months} month${months === 1 ? "" : "s"} of siege${sack ? ` and was sacked. ${killed} townsfolk were killed` : "; its gates were opened by hunger"}.${flee.length > 5 ? " Refugees streamed out along the roads." : ""}`, [civ.id, dc.id], gen ? [gen.id] : [], s.id, s.x, s.y);
  addGrievance(sim, dc, civ.id, sack ? "sack" : "conquest", sack ? 30 : 14, sack ? `scarred by the sack of ${s.name}` : `robbed of ${s.name}`);
  dc.memory.push(`the fall of ${s.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
  if (war) {
    war.score = clamp(war.score + sideSign(war, civ.id) * (wasCapital ? 40 : 22), -100, 100);
    war.taken.push(s.id, dc.id, civ.id);
    war.lastAction = sim.tick;
  }
  transferSettlement(sim, s, civ, true);
  s.unrest = clamp01(s.unrest + 0.3);
  s.lastRaid = sim.tick;
  dc.legitimacy = Math.max(0, dc.legitimacy - (wasCapital ? 0.2 : 0.08));
  dc.exhaustion = clamp01(dc.exhaustion + 0.08);
  a.morale = clamp01(a.morale + 0.15);
  a.supply = Math.min(4, a.supply + 1.5);
  if (gen) {
    addFame(sim, gen, wasCapital ? 5 : 3);
    remember(gen, sim.tick, M.conquered, s.id);
  }
  a.goal = 0;
  a.target = -1;
  a.wait = 8;
  if (dc.settlements.length === 0 && war) concludeTotalDefeat(sim, war, civ, dc);
}
function concludeTotalDefeat(sim, war, winner, loser) {
  if (war.goal === "overthrow" && war.att === winner.id) {
    resolveOverthrow(sim, war, winner, loser);
    return;
  }
  endWar(sim, war, `${winner.name} conquered ${loser.name} entirely`);
  addEvent(sim, "peace", 4, `The ${war.name} is over. The ${civFullName(loser)} has been wiped from the map by the ${civFullName(winner)}.`, [winner.id, loser.id], [], -1, -1, -1);
  winner.memory.push(`the conquest of ${loser.name}`);
  removeCiv(sim, loser, "was conquered");
}
function resolveOverthrow(sim, war, rebels, state) {
  const leader = sim.people.get(rebels.ruler);
  endWar(sim, war, `rebels under ${leader ? leader.name : "their leaders"} took power`);
  const oldRuler = sim.people.get(state.ruler);
  const before = civFullName(state);
  absorbCiv(sim, state, rebels, false);
  state.gov = rebels.gov;
  state.laws.elective = state.gov !== GOV.monarchy;
  if (oldRuler && (!leader || oldRuler.id !== leader.id)) {
    oldRuler.title = TITLE.none;
    state.ruler = -1;
    if (sim.rng.chance(0.6)) killPerson(sim, oldRuler, "execution after the civil war");
    sim.rt.pending = sim.rt.pending.filter((x) => x.civ !== state.id);
  }
  if (leader) {
    leader.civ = state.id;
    install(sim, state, leader, "", 0);
  }
  state.legitimacy = 0.5;
  state.exhaustion *= 0.5;
  state.rulingFaction = rebels.rulingFaction;
  addEvent(sim, "peace", 4, `The ${war.name} is over: ${leader ? fullName(sim, leader) : "the rebels"} won, and the ${before} is now the ${civFullName(state)}.`, [state.id, rebels.id], leader ? [leader.id] : [], state.capital, -1, -1);
  state.memory.push(`the civil war won by ${leader ? leader.name : "the rebels"}`);
  removeCiv(sim, rebels, "won its civil war and became the government");
}
function evaluatePeace(sim, war, att, def) {
  const years = (sim.tick - war.start) / TICKS_PER_YEAR;
  if (years < 0.75) return;
  const existential = war.goal === "overthrow" || war.goal === "independence";
  const attWill = 1 - att.exhaustion * 1.3 - (att.treasury < 0 ? 0.2 : 0) + att.pMilitary * 0.3 + (war.score > 0 ? 0.15 : -0.2) - years * 0.03;
  const defWill = 1 - def.exhaustion * 1.3 - (def.treasury < 0 ? 0.2 : 0) + def.pMilitary * 0.2 + (war.score < 0 ? 0.15 : -0.2) - years * 0.03 + (existential ? 0.25 : 0);
  const year = Math.floor(sim.tick / TICKS_PER_YEAR) + 1;
  const ret = (toCivId, fromCivId) => {
    for (let k = 0; k < war.taken.length; k += 3) {
      const s = sim.settlements.get(war.taken[k]);
      const owner = sim.civs.get(toCivId);
      if (s && s.alive && owner && owner.alive && war.taken[k + 1] === toCivId && s.civ === fromCivId) transferSettlement(sim, s, owner, false);
    }
  };
  const gained = (civId) => {
    let n = 0;
    for (let k = 0; k < war.taken.length; k += 3) {
      const s = sim.settlements.get(war.taken[k]);
      if (s && s.alive && s.civ === civId && war.taken[k + 2] === civId) n++;
    }
    return n;
  };
  if (war.score > 55 || war.score > 22 && defWill < 0.35) {
    if (war.goal === "overthrow") {
      resolveOverthrow(sim, war, att, def);
      return;
    }
    if (war.goal === "independence") {
      endWar(sim, war, `${att.name} won independence`);
      att.rebelOf = -1;
      att.rebelGoal = 0;
      addEvent(sim, "peace", 4, `The ${civFullName(def)} has recognised the independence of the ${civFullName(att)}. A new nation is born.`, [att.id, def.id], [], att.capital, -1, -1);
      addGrievance(sim, def, att.id, "secession", 12, `humbled by the secession of the ${att.name}`);
      att.memory.push(`independence won from ${def.name} in year ${year}`);
      return;
    }
    const n = gained(att.id);
    let terms = n > 0 ? `${def.name} cedes ${n} settlement${n === 1 ? "" : "s"}` : "";
    const tgt = sim.settlements.get(war.target);
    if (tgt && tgt.alive && tgt.civ === def.id && war.score > 70 && def.settlements.length > 1) {
      transferSettlement(sim, tgt, att, true);
      terms += `${terms ? " and " : `${def.name} cedes `}${tgt.name}`;
      addGrievance(sim, def, att.id, "lost_land", 14, `forced to surrender ${tgt.name}`);
    }
    if (def.alive && def.settlements.length > 0 && (war.goal === "tribute" || n === 0 || war.score > 80)) {
      const amt = Math.max(2, def.incomeLast * 0.15);
      relationOf(sim, att, def.id).tribute = amt;
      relationOf(sim, def, att.id).tribute = -amt;
      terms += `${terms ? ", and " : `${def.name} `}pays tribute`;
    }
    endWar(sim, war, `${att.name} victorious`);
    addEvent(sim, "peace", 4, `Peace of ${year}: the ${war.name} ends in victory for the ${civFullName(att)}. ${terms || "The defeated sue for terms"}. ${war.attLoss + war.defLoss} soldiers died.`, [att.id, def.id], [], -1, -1, -1);
    addGrievance(sim, def, att.id, "defeat", 18 + n * 8, `defeated in the ${war.name}`);
    def.legitimacy = Math.max(0, def.legitimacy - 0.15);
    att.legitimacy = Math.min(1, att.legitimacy + 0.1);
    const cul = sim.cultures.get(att.culture);
    if (cul) cul.martial = clamp01(cul.martial + 0.03);
    if (def.settlements.length === 0) removeCiv(sim, def, "was conquered");
    return;
  }
  if (war.score < -45 || war.score < -18 && attWill < 0.35) {
    if (war.goal === "overthrow" || war.goal === "independence") {
      endWar(sim, war, `the rising of the ${att.name} was crushed`);
      const leader = sim.people.get(att.ruler);
      addEvent(sim, "peace", 3, `The ${war.name} is over. The ${civFullName(def)} crushed the rebels${leader ? "; " + fullName(sim, leader) + " was executed" : ""}.`, [att.id, def.id], leader ? [leader.id] : [], def.capital, -1, -1);
      if (leader) {
        leader.title = TITLE.none;
        att.ruler = -1;
        killPerson(sim, leader, "execution after a failed rebellion");
        sim.rt.pending = sim.rt.pending.filter((x) => x.civ !== att.id);
      }
      absorbCiv(sim, def, att, true);
      removeCiv(sim, att, "was crushed");
      return;
    }
    ret(def.id, att.id);
    const n = gained(def.id);
    const pay = Math.max(0, att.treasury * 0.3);
    att.treasury -= pay;
    def.treasury += pay;
    endWar(sim, war, `${def.name} repelled the invasion`);
    addEvent(sim, "peace", 4, `Peace of ${year}: the ${civFullName(att)} lost the ${war.name}. ${n > 0 ? `The ${def.name} keep ${n} captured settlement${n === 1 ? "" : "s"}; ` : ""}the invaders pay reparations. ${war.attLoss + war.defLoss} soldiers died.`, [att.id, def.id], [], -1, -1, -1);
    addGrievance(sim, att, def.id, "defeat", 14 + n * 8, `humiliated in the ${war.name}`);
    att.legitimacy = Math.max(0, att.legitimacy - 0.2);
    def.legitimacy = Math.min(1, def.legitimacy + 0.1);
    if (att.settlements.length === 0) removeCiv(sim, att, "was conquered");
    return;
  }
  if (years > 3 && attWill < 0.45 && defWill < 0.45 || years > 14 || years > 5 && sim.tick - war.lastAction > 4 * TICKS_PER_YEAR) {
    if (war.goal === "independence") {
      endWar(sim, war, `${att.name} held out and became independent`);
      att.rebelOf = -1;
      att.rebelGoal = 0;
      addEvent(sim, "peace", 3, `Exhausted, the ${civFullName(def)} gave up trying to retake its rebel provinces. The ${civFullName(att)} endures.`, [att.id, def.id], [], att.capital, -1, -1);
      return;
    }
    if (war.goal === "overthrow") {
      endWar(sim, war, "the realm was split in two");
      att.rebelOf = -1;
      att.rebelGoal = 0;
      addEvent(sim, "peace", 3, `Neither side could win the ${war.name}. The realm is split: the ${civFullName(att)} and the ${civFullName(def)} now stand apart.`, [att.id, def.id], [], att.capital, -1, -1);
      return;
    }
    endWar(sim, war, "stalemate");
    addEvent(sim, "peace", 3, `Peace of ${year}: the ${war.name} ended in exhaustion with no victor. ${war.attLoss + war.defLoss} soldiers died for little.`, [att.id, def.id], [], -1, -1, -1);
  }
}
function navyPower(sim, civ) {
  let p = 0;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (s && s.coastal) p += (0.5 + s.bld[B.port]) * civ.mods.navy;
  }
  return p;
}
function assignObjectives(sim, civ, enemies) {
  if (civ.armies.length === 0 || enemies.length === 0) return;
  let enemyPower = 0;
  for (const e of enemies) enemyPower += warPotential(e);
  const defensive = warPotential(civ) < enemyPower * 0.55;
  const foes = [];
  for (const a of sim.armies.values()) if (hostile(sim, civ.id, a.civ)) foes.push(a);
  for (const aid of civ.armies) {
    const a = sim.armies.get(aid);
    if (!a || a.foe >= 0) continue;
    if (a.wait > 0) continue;
    const n = a.soldiers.length;
    if (n < 4 || a.supply <= 0 && a.morale < 0.3) {
      if (a.goal !== 4) retreat(sim, a);
      continue;
    }
    if (a.goal === 4 && a.path.length > 0 && a.pi < a.path.length - 1) continue;
    if (a.goal === 1 && a.target >= 0) {
      const t = sim.settlements.get(a.target);
      if (t && t.alive && hostile(sim, civ.id, t.civ) && (t.siege === a.id || a.path.length > 0 && a.pi < a.path.length - 1)) continue;
    }
    let threat = null, td = 22;
    for (const f of foes) {
      const fi = armyTile(sim, f);
      const o = sim.world.owner[fi];
      const onOurLand = o >= 0 && sim.settlements.get(o)?.civ === civ.id;
      const d = dist(a.x, a.y, f.x, f.y);
      if ((onOurLand || d < 8) && d < td && !f.atSea) {
        td = d;
        threat = f;
      }
    }
    if (threat && n * a.morale >= threat.soldiers.length * threat.morale * 0.7) {
      a.goal = 3;
      a.target = threat.id;
      setPath(sim, a, armyTile(sim, threat));
      continue;
    }
    if (defensive) {
      let best2 = null, bs2 = -1;
      for (const sid of civ.settlements) {
        const s = sim.settlements.get(sid);
        if (!s) continue;
        let sc = s.people.length / 100 + (s.id === civ.capital ? 2 : 0);
        for (const f of foes) sc += 20 / (10 + dist(s.x, s.y, f.x, f.y));
        if (sc > bs2) {
          bs2 = sc;
          best2 = s;
        }
      }
      if (best2 && (a.goal !== 2 || a.target !== best2.id)) {
        a.goal = 2;
        a.target = best2.id;
        setPath(sim, a, best2.tile);
      }
      continue;
    }
    let best = null, bs = 0;
    const war = sim.wars.get(a.war);
    for (const e of enemies) {
      for (const sid of e.settlements) {
        const s = sim.settlements.get(sid);
        if (!s || !s.alive) continue;
        const d = dist(a.x, a.y, s.x, s.y);
        if (d > 70 && civ.mods.seaCap <= 0) continue;
        let val = 1 + s.people.length / 150 + (s.id === e.capital ? 1.5 : 0) + (war && war.target === s.id ? 2 : 0);
        val /= 12 + d;
        val /= 1 + s.bld[B.walls] * 0.3;
        if (s.siege >= 0 && s.siege !== a.id) val *= 1.3;
        if (val > bs) {
          bs = val;
          best = s;
        }
      }
    }
    if (best) {
      if (setPath(sim, a, best.tile)) {
        a.goal = 1;
        a.target = best.id;
      } else a.wait = 12;
    } else if (a.goal !== 2) {
      const home = sim.settlements.get(a.home);
      if (home) {
        a.goal = 2;
        a.target = home.id;
        setPath(sim, a, home.tile);
      }
    }
  }
}
function warSeasonal(sim, civ) {
  const enemies = [];
  for (const [oid, r] of civ.rel) {
    if (r.war < 0) continue;
    const o = sim.civs.get(oid);
    const w = sim.wars.get(r.war);
    if (!o || !o.alive || !w || w.end >= 0) {
      r.war = -1;
      continue;
    }
    enemies.push(o);
  }
  if (enemies.length === 0) {
    for (const aid of civ.armies.slice()) {
      const a = sim.armies.get(aid);
      if (!a) continue;
      const home = sim.settlements.get(a.home);
      if (!home || !home.alive || home.civ !== civ.id || dist(a.x, a.y, home.x, home.y) < 2.5) disbandArmy(sim, a, true);
      else if (a.goal !== 4 || a.path.length === 0) retreat(sim, a);
    }
    for (const sid of civ.settlements) {
      const s = sim.settlements.get(sid);
      if (s && s.blockaded) s.blockaded = false;
    }
    return;
  }
  civ.exhaustion = clamp01(civ.exhaustion + 6e-3);
  const maxArmies = Math.min(4, 1 + Math.floor(civ.pop / 500));
  if (civ.armies.length < maxArmies) {
    let best = null, bs = 4;
    for (const sid of civ.settlements) {
      const s = sim.settlements.get(sid);
      if (!s || s.siege >= 0) continue;
      let busy = false;
      for (const aid of civ.armies) {
        const a = sim.armies.get(aid);
        if (a && a.home === s.id) busy = true;
      }
      if (busy) continue;
      const avail = s.jobCount[J.soldier] + s.people.length * civ.soldierTarget * 0.5 + (s.id === civ.capital ? 3 : 0);
      if (avail > bs) {
        bs = avail;
        best = s;
      }
    }
    if (best) {
      const war = sim.wars.get(civ.rel.get(enemies[0].id).war);
      raiseArmy(sim, civ, best, war ? war.id : -1);
    }
  }
  assignObjectives(sim, civ, enemies);
  const myNavy = navyPower(sim, civ);
  for (const e of enemies) {
    const theirs = navyPower(sim, e);
    const closed = myNavy > 0.9 && myNavy > theirs * 1.4;
    for (const sid of e.settlements) {
      const s = sim.settlements.get(sid);
      if (!s || !s.coastal) continue;
      if (closed && !s.blockaded) {
        let inReach = false;
        for (const ms of civ.settlements) {
          const m = sim.settlements.get(ms);
          if (m && m.coastal && dist(m.x, m.y, s.x, s.y) < civ.mods.seaRange) inReach = true;
        }
        if (inReach) {
          s.blockaded = true;
          if (s.people.length > 100) addEvent(sim, "blockade", 2, `${civ.adj} warships have closed the harbour of ${s.name}. No fishing boat or grain ship may pass.`, [civ.id, e.id], [], s.id, s.x, s.y);
        }
      } else if (!closed && s.blockaded) {
        s.blockaded = false;
      }
    }
  }
  for (const e of enemies) {
    const r = civ.rel.get(e.id);
    if (!r || r.war < 0) continue;
    const w = sim.wars.get(r.war);
    if (!w || w.end >= 0) continue;
    if (w.att === civ.id) {
      const def = sim.civs.get(w.def);
      if (def && def.alive) evaluatePeace(sim, w, civ, def);
      else endWar(sim, w, "the enemy ceased to exist");
      if (!civ.alive) return;
    } else if (w.def === civ.id) {
      const att = sim.civs.get(w.att);
      if (!att || !att.alive) endWar(sim, w, "the enemy ceased to exist");
    } else {
      if (civ.exhaustion > 0.6) {
        const side = sidesOf(w);
        const foes = side.a.indexOf(civ.id) >= 0 ? side.d : side.a;
        for (const f of foes) {
          const fc = sim.civs.get(f);
          relationOf(sim, civ, f).war = -1;
          if (fc) relationOf(sim, fc, civ.id).war = -1;
        }
        w.attAllies = w.attAllies.filter((x) => x !== civ.id);
        w.defAllies = w.defAllies.filter((x) => x !== civ.id);
        addEvent(sim, "peace", 2, `Worn out, the ${civ.name} withdrew from the ${w.name}.`, [civ.id], [], -1, -1, -1);
      }
    }
  }
}
function updateArmies(sim) {
  if (sim.armies.size === 0) return;
  const w = sim.world;
  const list = Array.from(sim.armies.values());
  for (const a of list) {
    if (!sim.armies.has(a.id)) continue;
    const civ = sim.civs.get(a.civ);
    if (!civ || !civ.alive || a.soldiers.length === 0) {
      disbandArmy(sim, a, true);
      continue;
    }
    if (a.fighting > 0) a.fighting--;
    if (a.wait > 0) a.wait--;
    const monthly = (sim.tick + a.id) % 4 === 0;
    if (monthly) {
      upkeep(sim, a, civ);
      if (a.soldiers.length === 0) {
        disbandArmy(sim, a, true);
        continue;
      }
    }
    let foe = null, fd = 1.8 * 1.8;
    for (const b of list) {
      if (b.id === a.id || b.soldiers.length === 0 || !sim.armies.has(b.id)) continue;
      if (!hostile(sim, a.civ, b.civ)) continue;
      const d = (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
      if (d < fd) {
        fd = d;
        foe = b;
      }
    }
    if (foe) {
      if (a.id < foe.id || foe.foe !== a.id) battleRound(sim, a, foe);
      continue;
    }
    if (a.foe >= 0) a.foe = -1;
    if (a.path.length > 0 && a.pi < a.path.length - 1) {
      const cur = a.path[a.pi];
      const onWater = w.water[cur] !== W_LAND;
      a.atSea = onWater;
      a.moveAcc += onWater ? 2.2 : 0.8 * civ.mods.armySpeed;
      while (a.pi < a.path.length - 1) {
        const nxt = a.path[a.pi + 1];
        const c = w.water[nxt] !== W_LAND ? 1 : Math.min(6, landStepCost(sim, nxt));
        if (a.moveAcc < c) break;
        a.moveAcc -= c;
        a.pi++;
      }
      const i = a.path[a.pi];
      a.x = i % w.w;
      a.y = i / w.w | 0;
      a.atSea = w.water[i] !== W_LAND;
      if (a.goal === 3 && monthly) {
        const t = sim.armies.get(a.target);
        if (!t || !hostile(sim, a.civ, t.civ)) a.goal = 0;
        else setPath(sim, a, armyTile(sim, t));
      }
      continue;
    }
    if (a.goal === 1) {
      const s = sim.settlements.get(a.target);
      if (!s || !s.alive || !hostile(sim, a.civ, s.civ)) {
        a.goal = 0;
        a.target = -1;
        continue;
      }
      if (dist(a.x, a.y, s.x, s.y) > 2.2) {
        if (monthly && !setPath(sim, a, s.tile)) a.goal = 0;
        continue;
      }
      if (monthly) siegeMonthly(sim, a, civ, s);
    } else if (a.goal === 4 && monthly) {
      const home = sim.settlements.get(a.home);
      if (home && home.alive && home.civ === a.civ && dist(a.x, a.y, home.x, home.y) < 2.5) {
        a.morale = Math.min(1, a.morale + 0.08);
        if (a.supply < 3 && home.stock[G.food] > a.soldiers.length * 3) {
          home.stock[G.food] -= a.soldiers.length;
          a.supply += 1;
        }
        if (a.morale > 0.6 && a.supply >= 1.5) a.goal = 0;
      } else if (a.path.length === 0 || a.pi >= a.path.length - 1) {
        const cap2 = sim.settlements.get(civ.capital);
        if (cap2) {
          a.home = cap2.id;
          if (!setPath(sim, a, cap2.tile)) a.goal = 0;
        }
      }
    } else if (a.goal === 3) a.goal = 0;
  }
}

// src/sim/civ.ts
function relationOf(sim, civ, otherId) {
  let r = civ.rel.get(otherId);
  if (!r) {
    r = { score: 0, war: -1, truceUntil: 0, tradePact: false, alliance: false, contact: false, tradeVal: 0, friction: 0, lastWar: -99999, tribute: 0 };
    civ.rel.set(otherId, r);
  }
  return r;
}
function civFullName(civ) {
  return civTitle(civ.gov, civ.name, civ.settlements.length);
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
function civPeople(sim, civ, fn) {
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    for (const id of s.people) {
      const p = sim.people.get(id);
      if (p) fn(p, s);
    }
  }
}
function removeCiv(sim, civ, how) {
  if (!civ.alive) return;
  civ.alive = false;
  civ.ended = sim.tick;
  for (const aid of civ.armies.slice()) {
    const a = sim.armies.get(aid);
    if (a) disbandArmy(sim, a, true);
  }
  for (const w of sim.wars.values()) {
    if (w.end >= 0) continue;
    if (w.att === civ.id || w.def === civ.id) {
      w.end = sim.tick;
      w.outcome = w.outcome || `${civ.name} ceased to exist`;
      const other = sim.civs.get(w.att === civ.id ? w.def : w.att);
      if (other) relationOf(sim, other, civ.id).war = -1;
      for (const al of w.attAllies.concat(w.defAllies)) {
        const ac = sim.civs.get(al);
        if (ac) relationOf(sim, ac, civ.id).war = -1;
      }
    }
  }
  for (const c of sim.civs.values()) {
    const r = c.rel.get(civ.id);
    if (r) {
      r.war = -1;
      r.alliance = false;
      r.tradePact = false;
      r.tribute = 0;
    }
  }
  const years = Math.floor((sim.tick - civ.founded) / TICKS_PER_YEAR);
  addEvent(sim, "fall", civ.peakPop > 150 ? 4 : 3, `The ${civFullName(civ)} ${how}. It lasted ${years} years.`, [civ.id], [], -1, -1, -1);
}
function civSeasonal(sim, civ) {
  if (!civ.alive) return;
  const rng = sim.rng;
  civ.settlements = civ.settlements.filter((id) => sim.settlements.get(id)?.alive);
  if (civ.settlements.length === 0) {
    let travelling = false;
    for (const p of sim.parties.values()) if (p.civ === civ.id && p.kind === 1) travelling = true;
    if (!travelling) removeCiv(sim, civ, civ.rebelOf >= 0 ? "was crushed" : "has vanished");
    return;
  }
  if (civ.capital < 0 || !sim.settlements.get(civ.capital)?.alive || sim.settlements.get(civ.capital).civ !== civ.id) civ.capital = pickCapital(sim, civ);
  const cap2 = sim.settlements.get(civ.capital);
  const fac = [0, 0, 0, 0, 0];
  let pop = 0, soldiers = 0, adults = 0, fight = 0;
  let richest = null, general = null;
  civPeople(sim, civ, (p) => {
    pop++;
    if (p.job === J.child) return;
    adults++;
    fac[p.faction] += politicalWeight(p);
    if (p.job === J.soldier) {
      soldiers++;
      fight += 0.5 + p.sFight;
      if (!general || p.sLead + p.fame * 0.05 > general.sLead + general.fame * 0.05) general = p;
    }
    if (p.job === J.merchant && (!richest || p.wealth > richest.wealth)) richest = p;
  });
  civ.pop = pop;
  civ.soldiers = soldiers;
  if (pop > civ.peakPop) civ.peakPop = pop;
  let unrest = 0, crowd = 0, weapons = 0, wq = 0, walls = 0, fed = 0;
  civ.needs.fill(0);
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    const wgt = s.people.length / (pop + 1);
    unrest += s.unrest * wgt;
    fed += s.fedAvg * wgt;
    crowd += Math.min(1.5, s.people.length / s.housing) * wgt;
    weapons += s.stock[G.weapons];
    wq += s.weaponQ * wgt;
    walls += s.bld[B.walls] * wgt;
    for (let g = 0; g < NG; g++) civ.needs[g] += clamp01((s.price[g] / GOOD_BASE[g] - 1.2) / 3) * wgt;
  }
  civ.stability = clamp01(1 - unrest * 1.2);
  const equip = 0.7 + 0.3 * Math.min(1, weapons / (soldiers + 1)) * wq;
  civ.strength = fight * equip * civ.mods.attack * (1 + civ.mods.morale);
  let ruler = sim.people.get(civ.ruler);
  if (!ruler || ruler.civ !== civ.id) {
    succession(sim, civ, "vacancy", civ.ruler);
    ruler = sim.people.get(civ.ruler);
  }
  fac[F.commons] *= civ.gov === GOV.democracy ? 1 : civ.gov === GOV.republic || civ.gov <= GOV.chiefdom ? 0.6 : 0.25 + unrest * 1.2;
  if (civ.gov === GOV.monarchy) fac[F.crown] *= 1.5;
  if (civ.gov === GOV.junta) fac[F.military] *= 1.6;
  if (civ.gov === GOV.theocracy) fac[F.clergy] *= 1.6;
  if (civ.gov === GOV.oligarchy) fac[F.guilds] *= 1.4;
  const total = fac[0] + fac[1] + fac[2] + fac[3] + fac[4] + 1e-6;
  for (let k = 0; k < NF; k++) civ.factions[k] += (fac[k] / total - civ.factions[k]) * 0.5;
  let top = 0;
  for (let k = 1; k < NF; k++) if (civ.factions[k] > civ.factions[top]) top = k;
  if (top !== civ.rulingFaction && civ.factions[top] > civ.factions[civ.rulingFaction] * 1.3) {
    const old = civ.rulingFaction;
    civ.rulingFaction = top;
    if (pop > 120) {
      const who = ["the old nobility", "the generals", "the guilds and merchant houses", "the priesthood", "the common folk"];
      let text = `In ${civFullName(civ)}, ${who[top]} now hold sway over ${who[old]}.`;
      const rich = richest;
      if (top === F.guilds && rich && rich.wealth > 300) {
        text = `In ${civFullName(civ)}, the merchant houses led by ${fullName(sim, rich)} now steer the state.`;
        addFame(sim, rich, 3);
      }
      addEvent(sim, "politics", 2, text, [civ.id], richest && top === F.guilds ? [richest.id] : [], civ.capital, cap2.x, cap2.y);
    }
  }
  const cul = sim.cultures.get(civ.culture);
  const rf = civ.rulingFaction;
  const landNeed = clamp01((crowd - 0.75) * 2) + (fed < 0.85 ? 0.3 : 0);
  let threat = 0;
  for (const [, r] of civ.rel) if (r.war >= 0) threat = 1;
  else if (r.contact && r.score < -30) threat = Math.max(threat, 0.5);
  civ.pExpand = clamp01(0.2 + cul.martial * 0.2 + (ruler ? ruler.amb * 0.25 : 0.1) + (rf === F.military ? 0.15 : 0) + landNeed * 0.35 - cul.insular * 0.1);
  civ.pMilitary = clamp01(0.1 + cul.martial * 0.45 + (ruler ? ruler.bold * 0.2 : 0.1) + (rf === F.military ? 0.2 : 0) + threat * 0.25);
  civ.pTrade = clamp01(0.15 + cul.mercantile * 0.5 + (rf === F.guilds ? 0.2 : 0) + (ruler ? ruler.greed * 0.15 : 0) - cul.insular * 0.2);
  civ.pScience = clamp01(0.12 + cul.innovative * 0.5 + (ruler ? ruler.intl * 0.25 : 0.1) + (rf === F.guilds ? 0.08 : 0));
  civ.pPiety = clamp01(cul.pious * 0.6 + (ruler ? ruler.piety * 0.3 : 0.1) + (rf === F.clergy ? 0.2 : 0));
  let target = civ.gov === GOV.band ? 0 : 0.025 + civ.pMilitary * 0.07;
  if (threat >= 1) target += civ.laws.conscription === 2 ? 0.16 : civ.laws.conscription === 1 ? 0.09 : 0.05;
  else if (threat > 0) target += 0.025;
  if (civ.gov === GOV.band && threat >= 1) target = 0.14;
  if (civ.treasury < 0) target *= threat >= 1 ? 0.85 : 0.6;
  civ.soldierTarget = target;
  civ.incomeLast = civ.income;
  civ.expenseLast = civ.expense;
  civ.income = 0;
  civ.expense = 0;
  const wantTax = [0.26, 0.3, 0.15, 0.2, 0.12][rf];
  if (civ.treasury < 0) civ.laws.tax = Math.min(0.45, civ.laws.tax + 0.02);
  else if (civ.laws.tax > wantTax && civ.treasury > pop * 0.5) civ.laws.tax = Math.max(wantTax, civ.laws.tax - 0.01);
  else if (civ.laws.tax < wantTax - 0.03 && civ.gov !== GOV.band) civ.laws.tax += 5e-3;
  if (civ.treasury < -pop * 3) civ.treasury = -pop * 3;
  if (civ.treasury > pop * 12 + 200) civ.treasury -= (civ.treasury - pop * 12 - 200) * 0.03;
  let lt = 0.55 + (ruler ? (ruler.cha - 0.5) * 0.3 : -0.2) + (civ.golden > 0 ? 0.15 : 0) + cap2.bld[B.palace] * 0.05 - civ.exhaustion * 0.3 - (civ.treasury < 0 ? 0.1 : 0);
  if (ruler && ageOf(sim, ruler) < ADULT_AGE) lt -= 0.25;
  civ.legitimacy += (clamp01(lt) - civ.legitimacy) * 0.1;
  if (threat < 1) civ.exhaustion = Math.max(0, civ.exhaustion - 0.02);
  civ.lawCooldown = Math.max(0, civ.lawCooldown - 1);
  updateLaws(sim, civ);
  maybeReform(sim, civ, cap2);
  research(sim, civ, cap2);
  const season = Math.floor(sim.tick % TICKS_PER_YEAR / 12);
  const year = Math.floor(sim.tick / TICKS_PER_YEAR);
  if (season === civ.id % 4) {
    knowledgeLoss(sim, civ);
    if ((civ.gov === GOV.republic || civ.gov === GOV.democracy || civ.gov === GOV.oligarchy) && (year + civ.id) % 6 === 0) succession(sim, civ, "election", civ.ruler);
    if (civ.golden > 0) {
      civ.golden--;
      if (civ.golden === 0) addEvent(sim, "golden", 2, `The golden age of ${civFullName(civ)} has faded.`, [civ.id], [], civ.capital, cap2.x, cap2.y);
    } else if (pop > 200 && civ.stability > 0.78 && fed > 0.93 && civ.treasury > pop && threat < 1 && rng.chance(0.06)) {
      civ.golden = 18 + rng.int(14);
      addEvent(sim, "golden", 3, `A golden age dawns in ${civFullName(civ)}: full granaries, full coffers, and peace.`, [civ.id], [], civ.capital, cap2.x, cap2.y);
      civ.memory.push(`the golden age that began in year ${year + 1}`);
    }
    if (pop < civ.peakPop * 0.45 && civ.peakPop > 150) {
      addEvent(sim, "decline", 3, `${civFullName(civ)} is a shadow of itself: ${pop} souls remain where ${civ.peakPop} once lived.`, [civ.id], [], civ.capital, cap2.x, cap2.y);
      civ.memory.push(`the great decline of year ${year + 1}`);
      civ.peakPop = pop;
    }
    if (civ.memory.length > 14) civ.memory.splice(0, civ.memory.length - 14);
    for (let k = civ.grievances.length - 1; k >= 0; k--) {
      const g = civ.grievances[k];
      g.mag *= 0.985;
      if (g.mag < 1.5) civ.grievances.splice(k, 1);
    }
  }
  planExpansion(sim, civ, landNeed);
  buildRoads(sim, civ);
  cultureSeasonal(sim, civ);
  if (!civ.alive) return;
  diplomacySeasonal(sim, civ);
  if (!civ.alive) return;
  warSeasonal(sim, civ);
  if (!civ.alive) return;
  unrestAndRevolt(sim, civ, general);
}
function updateLaws(sim, civ) {
  if (civ.lawCooldown > 0 || civ.gov === GOV.band || civ.pop < 80) return;
  const rf = civ.rulingFaction;
  const L = civ.laws;
  const hasAgri = civ.tech[TK.agriculture] === 1;
  const changes = [];
  const name = civFullName(civ);
  switch (rf) {
    case F.crown:
      if (!L.serfdom && hasAgri && civ.gov >= GOV.monarchy && civ.era < 5) changes.push([`${name} bound its farmers to the land as serfs.`, () => {
        L.serfdom = true;
      }]);
      if (L.elective && civ.gov === GOV.monarchy) changes.push([`${name} made its crown hereditary.`, () => {
        L.elective = false;
      }]);
      break;
    case F.military:
      if (L.conscription < 2) changes.push([`${name} decreed that every able adult may be called to arms.`, () => {
        L.conscription = 2;
      }]);
      if (L.trade === 2) changes.push([`${name} reimposed tariffs to fund its armies.`, () => {
        L.trade = 1;
      }]);
      break;
    case F.guilds:
      if (L.trade < 2 && civ.tech[TK.currency] === 1) changes.push([`${name} opened its markets: free trade is now the law.`, () => {
        L.trade = 2;
      }]);
      if (L.serfdom) changes.push([`${name} abolished serfdom.`, () => {
        L.serfdom = false;
      }]);
      if (!L.schooling && civ.tech[TK.education] === 1) changes.push([`${name} founded public schools.`, () => {
        L.schooling = true;
      }]);
      if (L.conscription === 2) changes.push([`${name} ended universal conscription.`, () => {
        L.conscription = 1;
      }]);
      break;
    case F.clergy:
      if (L.tolerance && civ.religion >= 0) changes.push([`${name} outlawed all faiths but its own.`, () => {
        L.tolerance = false;
      }]);
      if (!L.dole) changes.push([`${name} ordered its temples to feed the hungry.`, () => {
        L.dole = true;
      }]);
      break;
    case F.commons:
      if (L.serfdom) changes.push([`${name} freed its serfs.`, () => {
        L.serfdom = false;
      }]);
      if (!L.dole && civ.tech[TK.currency] === 1) changes.push([`${name} began a grain dole for the poor.`, () => {
        L.dole = true;
      }]);
      if (!L.tolerance) changes.push([`${name} granted freedom of worship.`, () => {
        L.tolerance = true;
      }]);
      if (L.conscription === 2) changes.push([`${name} ended universal conscription.`, () => {
        L.conscription = 1;
      }]);
      break;
  }
  const cul = sim.cultures.get(civ.culture);
  if (cul.insular > 0.8 && L.trade !== 0 && rf !== F.guilds) changes.push([`${name} closed its borders to foreigners.`, () => {
    L.trade = 0;
  }]);
  else if (L.trade === 0 && cul.insular < 0.6) changes.push([`${name} reopened its borders.`, () => {
    L.trade = 1;
  }]);
  if (changes.length === 0) return;
  const [text, apply] = sim.rng.pick(changes);
  apply();
  civ.lawCooldown = 32 + sim.rng.int(24);
  const cap2 = sim.settlements.get(civ.capital);
  addEvent(sim, "law", 2, text, [civ.id], [], civ.capital, cap2.x, cap2.y);
}
function maybeReform(sim, civ, cap2) {
  const rf = civ.rulingFaction;
  const ruler = sim.people.get(civ.ruler);
  const old = civ.gov;
  let next = old, why = "";
  const rng = sim.rng;
  const cul = sim.cultures.get(civ.culture);
  if (old === GOV.band && (civ.pop > 70 || civ.settlements.length >= 2)) {
    next = GOV.chiefdom;
    why = "the people have grown too many for the council fire";
  } else if (old === GOV.chiefdom && civ.pop > 220 && (civ.settlements.length >= 3 || civ.tech[TK.masonry] === 1 || civ.tech[TK.writing] === 1)) {
    if (rf === F.clergy && civ.religion >= 0) {
      next = GOV.theocracy;
      why = "the priests have taken the reins";
    } else if (rf === F.guilds && civ.tech[TK.currency] === 1) {
      next = GOV.oligarchy;
      why = "the great trading families now rule in council";
    } else {
      next = GOV.monarchy;
      why = "the chief has taken a crown";
    }
  } else if (old === GOV.monarchy && civ.legitimacy < 0.42 && rng.chance(0.08)) {
    if (rf === F.guilds && civ.tech[TK.currency] === 1) {
      next = civ.tech[TK.philosophy] === 1 && cul.communal > 0.45 ? GOV.republic : GOV.oligarchy;
      why = "the merchant houses forced the crown aside";
    } else if (rf === F.clergy && civ.religion >= 0) {
      next = GOV.theocracy;
      why = "the priesthood declared the throne forfeit";
    } else if (rf === F.commons && civ.tech[TK.philosophy] === 1) {
      next = GOV.republic;
      why = "the citizens demanded a voice and the weakened crown gave way";
    }
  } else if (old === GOV.monarchy && rf === F.clergy && cul.pious > 0.72 && civ.religion >= 0 && rng.chance(0.03)) {
    next = GOV.theocracy;
    why = "a devout people handed the realm to its priests";
  } else if (old === GOV.oligarchy && civ.tech[TK.philosophy] === 1 && rf === F.commons && rng.chance(0.05)) {
    next = GOV.republic;
    why = "the citizens demanded a voice";
  } else if (old === GOV.republic && rf === F.guilds && civ.factions[F.guilds] > 0.5 && rng.chance(0.02)) {
    next = GOV.oligarchy;
    why = "a handful of rich families hollowed out the assembly";
  } else if (old === GOV.republic && civ.tech[TK.printing] === 1 && civ.laws.schooling && rf !== F.military && rng.chance(0.04)) {
    next = GOV.democracy;
    why = "the vote was extended to all";
  } else if (old === GOV.junta && ruler && civ.legitimacy > 0.5 && ruler.amb > 0.55 && rng.chance(0.04)) {
    next = GOV.monarchy;
    why = `${ruler.name} the strongman has declared the office hereditary`;
  } else if ((old === GOV.junta || old === GOV.theocracy) && civ.legitimacy > 0.6 && civ.stability > 0.7 && (rf === F.guilds || rf === F.commons) && rng.chance(0.02)) {
    next = civ.tech[TK.philosophy] === 1 ? GOV.republic : GOV.oligarchy;
    why = "power passed back to civil hands";
  }
  if (next === old) return;
  const before = civFullName(civ);
  civ.gov = next;
  civ.laws.elective = next !== GOV.monarchy;
  if (next === GOV.monarchy && ruler) {
    civ.dynasty = ruler.fam;
    const f = sim.families.get(ruler.fam);
    if (f) f.thrones++;
  }
  if (civ.pop > 60) addEvent(sim, "government", next >= GOV.monarchy ? 3 : 2, `A new order in the ${before}: ${why}. It is now the ${civFullName(civ)}${ruler ? ` under ${rulerTitle(next, ruler.sex, civ.settlements.length)} ${fullName(sim, ruler)}` : ""}.`, [civ.id], ruler ? [ruler.id] : [], civ.capital, cap2.x, cap2.y);
}
function knownByContact(sim, civ, tech) {
  if (civ.isolated) return 0;
  let best = 0;
  for (const [oid, r] of civ.rel) {
    if (!r.contact || r.war >= 0) continue;
    const o = sim.civs.get(oid);
    if (!o || !o.alive || o.isolated || o.tech[tech] !== 1) continue;
    const lvl = r.tradePact || r.alliance ? 3 : r.tradeVal > 8 ? 2 : 1;
    if (lvl > best) best = lvl;
  }
  return best;
}
function ruinTeaches(sim, civ, tech) {
  if (sim.ruins.length === 0) return false;
  for (const r of sim.ruins) {
    if (r.techs.indexOf(tech) < 0) continue;
    for (const sid of civ.settlements) {
      const s = sim.settlements.get(sid);
      if (s && dist(s.x, s.y, r.x, r.y) < s.radius + 3) return true;
    }
  }
  return false;
}
function effectiveCost(sim, civ, tech) {
  let c = techCost(tech);
  if (civ.tech[tech] === 2) c *= 0.4;
  const k = knownByContact(sim, civ, tech);
  if (k > 0) c *= k === 3 ? 0.55 : k === 2 ? 0.7 : 0.9;
  else if (ruinTeaches(sim, civ, tech)) c *= 0.5;
  return c;
}
function research(sim, civ, cap2) {
  const rng = sim.rng;
  if (civ.researching >= 0) {
    const r = civ.researching;
    if (civ.research[r] >= effectiveCost(sim, civ, r)) learnTech(sim, civ, r, "research");
    else if (rng.chance(0.9)) return;
  }
  const env = civEnv(sim, civ);
  let best = -1, bs = 0;
  for (let t = 0; t < NT; t++) {
    if (!canResearch(civ, t, env)) continue;
    const def = TECHS[t];
    let wgt = def.want ? def.want(env, civ) : 1;
    wgt *= 0.7 + rng.next() * 0.6;
    wgt /= Math.pow(effectiveCost(sim, civ, t), 0.35);
    wgt *= 1 + civ.research[t] / (techCost(t) + 1);
    if (wgt > bs) {
      bs = wgt;
      best = t;
    }
  }
  civ.researching = best;
}
function learnTech(sim, civ, tech, how) {
  const was = civ.tech[tech];
  if (was === 1) return;
  const eraBefore = civ.era;
  civ.tech[tech] = 1;
  civ.research[tech] = 0;
  if (civ.researching === tech) civ.researching = -1;
  recomputeMods(civ);
  const def = TECHS[tech];
  let first = true;
  for (const o of sim.civs.values()) if (o.id !== civ.id && (o.tech[tech] === 1 || o.tech[tech] === 2 && !o.alive)) first = false;
  for (const o of sim.civs.values()) if (o.id !== civ.id && o.tech[tech] !== 0) first = false;
  const cap2 = sim.settlements.get(civ.capital);
  let inventor = null;
  if (how === "research" && cap2) {
    let bs = 0;
    const pool = cap2.people;
    for (let k = 0; k < Math.min(40, pool.length); k++) {
      const p = sim.people.get(pool[sim.rng.int(pool.length)]);
      if (!p || p.job === J.child) continue;
      const sc = p.intl * (0.3 + p.sLore + p.sCraft * 0.6) * (p.job === J.scholar ? 2.5 : p.job === J.artisan ? 1.5 : p.job === J.priest ? 1.2 : 1);
      if (sc > bs) {
        bs = sc;
        inventor = p;
      }
    }
  }
  const imp = def.tier <= 1 ? 1 : def.tier <= 3 ? 2 : first ? 4 : 3;
  let text;
  const diffused = how === "research" && knownByContact(sim, civ, tech) >= 2;
  if (how === "god") text = `A vision came to the ${civ.name}: they now understand ${def.name}.`;
  else if (was === 2) text = `The ${civ.name} have rediscovered the lost art of ${def.name}.`;
  else if (how === "ruin") text = `Studying ancient ruins, the ${civ.name} recovered the secret of ${def.name}.`;
  else if (diffused) text = `The ${civ.name} learned ${def.name} from their neighbours.`;
  else if (inventor) text = `${fullName(sim, inventor)} of ${cap2.name} ${first ? "was the first in the world to master" : "worked out"} ${def.name} for the ${civ.name}.`;
  else text = `The ${civ.name} discovered ${def.name}.`;
  if (inventor && !diffused) {
    addFame(sim, inventor, def.tier >= 3 ? 7 : 4);
    remember(inventor, sim.tick, M.invented, tech);
  }
  addEvent(sim, "tech", imp, text, [civ.id], inventor && !diffused ? [inventor.id] : [], civ.capital, cap2 ? cap2.x : -1, cap2 ? cap2.y : -1);
  if (civ.era > eraBefore) {
    const ERA = ["Stone Age", "Bronze Age", "Iron Age", "Medieval era", "Renaissance", "Industrial era", "Modern era", "Atomic era"];
    addEvent(sim, "era", 3, `The ${civ.name} have entered the ${ERA[civ.era]}.`, [civ.id], [], civ.capital, cap2 ? cap2.x : -1, cap2 ? cap2.y : -1);
    sim.rt.allDirty = true;
  }
}
function knowledgeLoss(sim, civ) {
  let scholars = 0, libs = 0, priests = 0;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    scholars += s.jobCount[J.scholar];
    priests += s.jobCount[J.priest];
    libs += s.bld[B.library] + s.bld[B.school] * 2;
  }
  const writing = civ.tech[TK.writing] === 1;
  let capacity = 7 + Math.sqrt(civ.pop) * 0.55 + priests * 0.3;
  if (writing) capacity += scholars * 0.7 + libs * 3;
  capacity *= 1 + civ.mods.retention * 0.5;
  let known = 0, hi = -1, hiTier = 0;
  for (let t = 0; t < NT; t++) {
    if (civ.tech[t] !== 1 || TECHS[t].tier === 0) continue;
    known++;
    let needed = false;
    for (let u = 0; u < NT; u++) if (civ.tech[u] === 1 && TECHS[u].pre.indexOf(TECHS[t].key) >= 0) needed = true;
    if (!needed && TECHS[t].tier >= hiTier && TECHS[t].key !== "agriculture") {
      hiTier = TECHS[t].tier;
      hi = t;
    }
  }
  if (hi < 0 || known <= capacity * 1.25) return;
  if (!sim.rng.chance(clamp01((known / capacity - 1.25) * 0.5))) return;
  civ.tech[hi] = 2;
  civ.research[hi] = 0;
  if (civ.researching === hi) civ.researching = -1;
  recomputeMods(civ);
  const cap2 = sim.settlements.get(civ.capital);
  addEvent(sim, "lost", 3, `With too few left who understood it, the ${civ.name} have lost the knowledge of ${TECHS[hi].name}.`, [civ.id], [], civ.capital, cap2.x, cap2.y);
  civ.memory.push(`the forgetting of ${TECHS[hi].name}`);
}
function planExpansion(sim, civ, landNeed) {
  if (civ.tech[TK.agriculture] !== 1 && civ.pop < 60) return;
  const cooldown = (10 - civ.pExpand * 7 - landNeed * 3) * TICKS_PER_YEAR;
  if (sim.tick - civ.lastSettle < cooldown) return;
  if (civ.settlements.length >= civ.mods.admin + 3) return;
  for (const [, r] of civ.rel) if (r.war >= 0) return;
  let src = null, bs = 0;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (s.people.length < 55 || s.siege >= 0) continue;
    const sc = s.people.length / s.housing + (1 - s.fedAvg) + s.people.length / 400;
    if (sc > bs) {
      bs = sc;
      src = s;
    }
  }
  if (!src) return;
  let site = findSite(sim, src.x, src.y, 11, 21 + civ.mods.admin, civ, true, 50);
  if (site.tile < 0 && civ.mods.seaRange > 0 && src.coastal) site = findSite(sim, src.x, src.y, 9, Math.min(civ.mods.seaRange * 0.8, 70), civ, false, 70);
  if (site.tile < 0) {
    civ.lastSettle = sim.tick - cooldown * 0.6;
    return;
  }
  const want = clamp(Math.round(src.people.length * 0.12), 8, 36);
  const group = [];
  const rng = sim.rng;
  for (let t = 0; t < 200 && group.length < want; t++) {
    const p = sim.people.get(src.people[rng.int(src.people.length)]);
    if (!p || p.job === J.child || p.title !== TITLE.none || p.party >= 0 || p.army >= 0 || group.indexOf(p) >= 0) continue;
    if (ageOf(sim, p) > 42) continue;
    group.push(p);
    const sp = sim.people.get(p.spouse);
    if (sp && sp.home === src.id && sp.party < 0 && sp.army < 0 && sp.title === TITLE.none && group.indexOf(sp) < 0) group.push(sp);
    for (const k of p.kids) {
      const c = sim.people.get(k);
      if (c && c.home === src.id && c.job === J.child && group.indexOf(c) < 0) group.push(c);
    }
  }
  if (group.length < 6) return;
  if (sendSettlers(sim, src, civ, group, site.tile)) civ.lastSettle = sim.tick;
}
function adultsOf(sim, s) {
  const out = [];
  if (!s) return out;
  for (const id of s.people) {
    const p = sim.people.get(id);
    if (p && p.job !== J.child) out.push(p);
  }
  return out;
}
function install(sim, civ, heir, text, imp) {
  const old = sim.people.get(civ.ruler);
  if (old && old.id !== heir.id) {
    old.title = TITLE.none;
    remember(old, sim.tick, M.deposed, civ.id);
  }
  heir.title = TITLE.ruler;
  civ.ruler = heir.id;
  addFame(sim, heir, 8);
  remember(heir, sim.tick, M.ruler, civ.id);
  if (civ.gov === GOV.monarchy) {
    if (civ.dynasty !== heir.fam) civ.dynasty = heir.fam;
    const f = sim.families.get(heir.fam);
    if (f) f.thrones++;
  }
  const cap2 = sim.settlements.get(civ.capital);
  if (cap2 && heir.home !== cap2.id && heir.army < 0 && heir.party < 0) rehome(sim, heir, cap2);
  if (heir.job !== J.official && heir.job !== J.child && heir.army < 0) setJob(sim, heir, sim.settlements.get(heir.home), J.official);
  heir.loyalty = 1;
  for (const fid of heir.friends) {
    const f = sim.people.get(fid);
    if (f) f.loyalty = Math.min(1, f.loyalty + 0.25);
  }
  for (const rid of heir.rivals) {
    const r = sim.people.get(rid);
    if (r) r.loyalty = Math.max(0, r.loyalty - 0.3);
  }
  if (text && civ.pop > 30) addEvent(sim, "succession", imp, text, [civ.id], [heir.id], civ.capital, cap2 ? cap2.x : -1, cap2 ? cap2.y : -1);
}
function succession(sim, civ, cause, prevId) {
  if (!civ.alive || civ.settlements.length === 0) return;
  const rng = sim.rng;
  const cap2 = sim.settlements.get(civ.capital) || sim.settlements.get(civ.settlements[0]);
  const prevGrave = sim.graves.get(prevId);
  const prevAlive = sim.people.get(prevId);
  const prevName = prevGrave ? fullName(sim, prevGrave) : prevAlive ? fullName(sim, prevAlive) : "";
  const died = cause !== "election" && cause !== "vacancy" && prevName;
  const lead = died ? `${rulerTitle(civ.gov, prevGrave ? prevGrave.sex : 1, civ.settlements.length)} ${prevName} of the ${civ.name} died of ${cause}. ` : "";
  const pool = adultsOf(sim, cap2);
  let heir;
  let text = "";
  const title = (p) => rulerTitle(civ.gov, p.sex, civ.settlements.length);
  if (civ.gov === GOV.monarchy) {
    const kidIds = prevGrave ? prevGrave.kids : prevAlive ? prevAlive.kids : [];
    const kids = [];
    for (const k of kidIds) {
      const c = sim.people.get(k);
      if (c && c.civ === civ.id) kids.push(c);
    }
    kids.sort((a, b) => a.born - b.born || a.id - b.id);
    heir = kids.find((k) => ageOf(sim, k) >= ADULT_AGE) || kids[0];
    let pretender;
    if (heir) {
      text = `${lead}${heir.sex ? "His" : "Her"} ${ageOf(sim, heir) < ADULT_AGE ? "young " : ""}${heir.sex ? "son" : "daughter"} ${fullName(sim, heir)} inherits the throne.`.replace(/^His|^Her/, prevGrave && prevGrave.sex === 0 ? "Her" : "His");
      pretender = kids.find((k) => k !== heir && ageOf(sim, k) >= ADULT_AGE && k.amb > 0.68 && k.bold > 0.5);
    } else {
      let bs = -1;
      civPeople(sim, civ, (p) => {
        if (p.fam !== civ.dynasty || p.job === J.child) return;
        const sc = p.sLead + p.cha + p.fame * 0.1 + ageOf(sim, p) * 0.01;
        if (sc > bs) {
          bs = sc;
          heir = p;
        }
      });
      if (heir) text = `${lead}With no child to follow, the crown passes to ${fullName(sim, heir)} of the same house.`;
      else {
        let bw = -1;
        for (const p of pool) {
          const wgt = politicalWeight(p) * (0.5 + p.amb);
          if (wgt > bw) {
            bw = wgt;
            heir = p;
          }
        }
        const oldHouse = sim.families.get(civ.dynasty);
        if (heir) text = `${lead}The house of ${oldHouse ? oldHouse.name : "the old kings"} is extinct. ${fullName(sim, heir)} founds a new dynasty.`;
      }
    }
    if (heir) {
      install(sim, civ, heir, text, 3);
      civ.legitimacy = ageOf(sim, heir) < ADULT_AGE ? 0.35 : 0.6;
      if (pretender && pretender.home >= 0 && rng.chance(0.3 + (ageOf(sim, heir) < ADULT_AGE ? 0.3 : 0)) && civ.settlements.length >= 2) {
        const seat = sim.settlements.get(pretender.home);
        if (seat && seat.id !== civ.capital) startRebellion(sim, civ, seat, pretender, 2, `${fullName(sim, pretender)} disputes the succession and raises an army against ${heir.sex ? "his" : "her"} own kin.`);
      }
      return;
    }
  } else if (civ.gov === GOV.oligarchy) {
    let bw = -1;
    civPeople(sim, civ, (p) => {
      if (p.job === J.child || p.id === prevId) return;
      const wgt = p.wealth * (p.job === J.merchant ? 2 : 1);
      if (wgt > bw) {
        bw = wgt;
        heir = p;
      }
    });
    if (heir) text = `${lead}The great houses of the ${civ.name} chose their richest, ${fullName(sim, heir)}, as ${title(heir)}.`;
  } else if (civ.gov === GOV.republic || civ.gov === GOV.democracy) {
    const cands = [];
    civPeople(sim, civ, (p) => {
      if (p.job === J.child || ageOf(sim, p) < 25) return;
      if (p.fame < 1 && p.job !== J.official && p.job !== J.scholar && p.job !== J.merchant && p.job !== J.priest) return;
      cands.push(p);
    });
    cands.sort((a, b) => b.cha + b.fame * 0.08 + b.sLead * 0.5 - (a.cha + a.fame * 0.08 + a.sLead * 0.5) || a.id - b.id);
    const top = cands.slice(0, 4);
    let bv = -1;
    for (const c of top) {
      const votes = civ.factions[c.faction] * (civ.gov === GOV.democracy ? 1 : 1.5) + c.cha * 0.3 + c.fame * 0.02 + rng.next() * 0.25 + (c.id === prevId ? 0.1 : 0);
      if (votes > bv) {
        bv = votes;
        heir = c;
      }
    }
    if (heir) text = heir.id === prevId && cause === "election" ? "" : `${lead}${fullName(sim, heir)} was elected ${title(heir)} of the ${civFullName(civ)}.`;
    if (heir && heir.id === prevId) return;
  } else if (civ.gov === GOV.theocracy) {
    let bs = -1;
    civPeople(sim, civ, (p) => {
      if (p.job !== J.priest || p.id === prevId) return;
      const sc = p.piety + p.cha + p.sLore;
      if (sc > bs) {
        bs = sc;
        heir = p;
      }
    });
    if (heir) text = `${lead}The conclave raised ${fullName(sim, heir)} as ${title(heir)}.`;
  } else if (civ.gov === GOV.junta) {
    let bs = -1;
    civPeople(sim, civ, (p) => {
      if (p.job !== J.soldier || p.id === prevId) return;
      const sc = p.sLead + p.fame * 0.1 + p.amb * 0.5;
      if (sc > bs) {
        bs = sc;
        heir = p;
      }
    });
    if (heir) text = `${lead}${fullName(sim, heir)} took command as ${title(heir)}.`;
  }
  if (!heir) {
    let bs = -1;
    const all = pool.length ? pool : [];
    if (all.length === 0) civPeople(sim, civ, (p) => {
      if (p.job !== J.child) all.push(p);
    });
    for (const p of all) {
      if (p.id === prevId) continue;
      const sc = p.sLead + p.cha + p.fame * 0.1 + p.bold * 0.3 + Math.min(0.5, ageOf(sim, p) * 0.01);
      if (sc > bs) {
        bs = sc;
        heir = p;
      }
    }
    if (heir) text = `${lead}The ${civ.name} now follow ${title(heir)} ${fullName(sim, heir)}.`;
  }
  if (heir) {
    install(sim, civ, heir, civ.pop > 60 || died ? text : "", civ.pop > 150 ? 2 : 1);
    civ.legitimacy = Math.max(civ.legitimacy, 0.55);
  }
}
function processPending(sim) {
  const list = sim.rt.pending;
  if (list.length === 0) return;
  sim.rt.pending = [];
  for (const it of list) {
    const civ = sim.civs.get(it.civ);
    if (civ && civ.alive && civ.ruler < 0) succession(sim, civ, it.cause, it.prev);
  }
}
function unrestAndRevolt(sim, civ, general) {
  const rng = sim.rng;
  if (general && general.title === TITLE.general && general.amb > 0.68 && general.loyalty < 0.45 && civ.legitimacy < 0.5 && civ.gov !== GOV.junta && civ.pop > 150 && rng.chance(0.12)) {
    coup(sim, civ, general);
    return;
  }
  for (const sid of civ.settlements.slice()) {
    const s = sim.settlements.get(sid);
    if (!s || !s.alive || s.civ !== civ.id || s.rebelHeat < 8 || s.siege >= 0) continue;
    if (!rng.chance(0.12 + (s.unrest - 0.6) * 0.6)) continue;
    let leader = null, ls = 0.62;
    let loyalArms = 0, angry = 0;
    for (const id of s.people) {
      const p = sim.people.get(id);
      if (p.job === J.child || p.army >= 0) continue;
      if (p.job === J.soldier && p.loyalty > 0.45) loyalArms += 1 + p.sFight;
      if (p.loyalty < 0.4) angry++;
      if (p.title === TITLE.ruler) continue;
      const sc = p.amb * 0.35 + p.cha * 0.4 + p.bold * 0.25 + Math.min(0.25, p.fame * 0.03) + (p.title === TITLE.governor ? 0.2 : 0) - p.loyalty * 0.45;
      if (sc > ls) {
        ls = sc;
        leader = p;
      }
    }
    if (!leader) {
      s.rebelHeat = 0;
      s.damage = clamp01(s.damage + 0.05);
      if (s.people.length > 120) addEvent(sim, "riot", 1, `Bread riots shook ${s.name}, but no one stepped forward to lead them.`, [civ.id], [], s.id, s.x, s.y);
      continue;
    }
    s.rebelHeat = 0;
    const isCapital = s.id === civ.capital;
    if (isCapital || civ.settlements.length === 1) {
      revolution(sim, civ, s, leader, angry, loyalArms);
      return;
    }
    const foreign = s.cultureMajor !== civ.culture || s.originalCiv !== civ.id;
    startRebellion(sim, civ, s, leader, 1, foreign ? `${s.name} has risen against ${civFullName(civ)}. ${fullName(sim, leader)} leads the revolt of a people who never accepted foreign rule.` : `${fullName(sim, leader)} has raised ${s.name} in revolt against ${civFullName(civ)}.`);
    return;
  }
}
function govForLeader(sim, civ, leader) {
  if (leader.job === J.soldier) return GOV.junta;
  if (leader.job === J.priest) return GOV.theocracy;
  if (leader.job === J.merchant && civ.tech[TK.currency] === 1) return GOV.oligarchy;
  if (leader.title === TITLE.governor || leader.job === J.official || leader.fam === civ.dynasty) return civ.pop > 200 ? GOV.monarchy : GOV.chiefdom;
  if (civ.tech[TK.philosophy] === 1) return GOV.republic;
  return civ.pop > 250 ? GOV.monarchy : GOV.chiefdom;
}
function revolution(sim, civ, s, leader, angry, loyalArms) {
  const rng = sim.rng;
  const walls = s.bld[B.walls];
  const force = angry * (0.25 + leader.cha * 0.3);
  const guard = loyalArms * (1.6 + walls * 0.2) + 4;
  const ruler = sim.people.get(civ.ruler);
  if (force > guard * (0.8 + rng.next() * 0.5)) {
    const before = civFullName(civ);
    const oldGov = civ.gov;
    civ.gov = govForLeader(sim, civ, leader);
    civ.laws.elective = civ.gov !== GOV.monarchy;
    let fate = "";
    if (ruler && ruler.id !== leader.id) {
      if (rng.chance(0.55)) {
        fate = ` ${fullName(sim, ruler)} was put to death.`;
        ruler.title = TITLE.none;
        civ.ruler = -1;
        killPerson(sim, ruler, "execution by revolutionaries");
        sim.rt.pending = sim.rt.pending.filter((x) => x.civ !== civ.id);
      } else fate = ` ${fullName(sim, ruler)} fled into obscurity.`;
    }
    install(sim, civ, leader, "", 0);
    addFame(sim, leader, 6);
    remember(leader, sim.tick, M.rebelled, civ.id);
    civ.legitimacy = 0.55;
    civ.rulingFaction = leader.faction;
    civ.exhaustion = Math.max(0, civ.exhaustion - 0.2);
    for (const sid of civ.settlements) {
      const t = sim.settlements.get(sid);
      t.unrest *= 0.5;
      t.rebelHeat = 0;
    }
    s.damage = clamp01(s.damage + 0.12);
    let dead = 0;
    for (const id of s.people.slice()) {
      const p = sim.people.get(id);
      if (p && p.job !== J.child && p.id !== leader.id && rng.chance(0.03)) {
        killPerson(sim, p, "street fighting in the revolution");
        dead++;
      }
    }
    addEvent(sim, "revolution", 4, `Revolution in ${s.name}! ${fullName(sim, leader)}, ${describeRole(leader)}, overthrew the ${before}.${fate} ${oldGov !== civ.gov ? `The state is now the ${civFullName(civ)}.` : ""} ${dead} died in the fighting.`, [civ.id], [leader.id], s.id, s.x, s.y);
    civ.memory.push(`the revolution of ${fullName(sim, leader)} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
  } else {
    s.unrest = Math.max(0.2, s.unrest - 0.3);
    s.damage = clamp01(s.damage + 0.06);
    let dead = 0;
    for (const id of s.people.slice()) {
      const p = sim.people.get(id);
      if (p && p.loyalty < 0.35 && p.job !== J.child && p.id !== leader.id && rng.chance(0.06)) {
        killPerson(sim, p, "the crushing of the uprising");
        dead++;
      }
    }
    addEvent(sim, "uprising", 2, `An uprising in ${s.name} led by ${fullName(sim, leader)} was crushed by the garrison. ${dead + 1} were killed.`, [civ.id], [leader.id], s.id, s.x, s.y);
    killPerson(sim, leader, "execution after a failed uprising");
    civ.legitimacy = Math.max(0, civ.legitimacy - 0.05);
  }
}
function describeRole(p) {
  if (p.title === TITLE.governor) return "the governor";
  if (p.title === TITLE.general) return "a general";
  switch (p.job) {
    case J.soldier:
      return "a soldier";
    case J.priest:
      return "a firebrand priest";
    case J.merchant:
      return "a wealthy merchant";
    case J.scholar:
      return "a scholar";
    case J.artisan:
      return "an artisan";
    case J.farmer:
      return "a farmer";
    case J.official:
      return "a disaffected official";
  }
  return "a commoner";
}
function coup(sim, civ, general) {
  const rng = sim.rng;
  const cap2 = sim.settlements.get(civ.capital);
  const army = sim.armies.get(general.army);
  const share = army ? army.soldiers.length / (civ.soldiers + 1) : 0.3;
  const ruler = sim.people.get(civ.ruler);
  if (rng.chance(0.35 + share * 0.6)) {
    const before = civFullName(civ);
    civ.gov = GOV.junta;
    civ.laws.elective = true;
    if (ruler && ruler.id !== general.id) {
      ruler.title = TITLE.none;
      civ.ruler = -1;
      if (rng.chance(0.5)) killPerson(sim, ruler, "assassination in a coup");
      sim.rt.pending = sim.rt.pending.filter((x) => x.civ !== civ.id);
    }
    install(sim, civ, general, "", 0);
    civ.legitimacy = 0.4;
    civ.rulingFaction = F.military;
    remember(general, sim.tick, M.rebelled, civ.id);
    addEvent(sim, "coup", 4, `General ${fullName(sim, general)} marched on ${cap2.name} and seized power. The ${before} is now the ${civFullName(civ)}.`, [civ.id], [general.id], cap2.id, cap2.x, cap2.y);
    civ.memory.push(`the coup of General ${general.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
  } else {
    addEvent(sim, "coup", 2, `A coup by General ${fullName(sim, general)} failed. The general was executed.`, [civ.id], [general.id], cap2.id, cap2.x, cap2.y);
    killPerson(sim, general, "execution for treason");
    civ.legitimacy = Math.max(0, civ.legitimacy - 0.05);
  }
}
function startRebellion(sim, civ, s, leader, goal, text) {
  if (!s.alive || s.civ !== civ.id) return null;
  const rebel = createCiv(sim, { culture: goal === 1 && s.cultureMajor >= 0 && sim.cultures.has(s.cultureMajor) ? s.cultureMajor : civ.culture, religion: leader.religion, parent: civ.id, inherit: civ });
  rebel.rebelOf = civ.id;
  rebel.rebelGoal = goal;
  rebel.gov = govForLeader(sim, civ, leader);
  rebel.laws.elective = rebel.gov !== GOV.monarchy;
  rebel.rulingFaction = leader.faction;
  const join = [s];
  for (const sid of civ.settlements) {
    const o = sim.settlements.get(sid);
    if (o.id === s.id || o.id === civ.capital || o.siege >= 0) continue;
    if (dist(o.x, o.y, s.x, s.y) > 26) continue;
    if (o.unrest > 0.5 || goal === 1 && o.cultureMajor === s.cultureMajor && s.cultureMajor !== civ.culture && o.unrest > 0.3 || goal === 2 && o.loyalAvg < 0.45) join.push(o);
  }
  let moved = 0;
  for (const o of join) {
    moved += o.people.length;
    transferSettlement(sim, o, rebel, false);
    o.unrest = 0.2;
    o.rebelHeat = 0;
  }
  rebel.capital = s.id;
  const share = moved / (civ.pop + 1);
  const purse = Math.max(0, civ.treasury) * share;
  rebel.treasury = purse + 20;
  civ.treasury -= purse;
  leader.civ = rebel.id;
  install(sim, rebel, leader, "", 0);
  addFame(sim, leader, 5);
  remember(leader, sim.tick, M.rebelled, civ.id);
  rebel.legitimacy = 0.65;
  rebel.pop = moved;
  addEvent(sim, "rebellion", 4, `${text} The rebels call themselves the ${civFullName(rebel)}.`, [civ.id, rebel.id], [leader.id], s.id, s.x, s.y);
  civ.memory.push(`the ${goal === 2 ? "civil war" : "revolt"} of ${s.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
  rebel.memory.push(`the rising at ${s.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
  const ra = relationOf(sim, rebel, civ.id), rb = relationOf(sim, civ, rebel.id);
  ra.contact = rb.contact = true;
  ra.score = rb.score = -60;
  declareWar(sim, rebel, civ, goal === 2 ? "overthrow" : "independence", civ.capital);
  return rebel;
}
function absorbCiv(sim, into, from, resent) {
  for (const sid of from.settlements.slice()) {
    const s = sim.settlements.get(sid);
    if (s) transferSettlement(sim, s, into, resent);
  }
  into.treasury += Math.max(0, from.treasury);
  for (let t = 0; t < NT; t++) if (from.tech[t] === 1 && into.tech[t] !== 1) into.tech[t] = 1;
  recomputeMods(into);
  for (const aid of from.armies.slice()) {
    const a = sim.armies.get(aid);
    if (a) disbandArmy(sim, a, true);
  }
  for (const p of sim.parties.values()) if (p.civ === from.id) p.civ = into.id;
  const fr = sim.people.get(from.ruler);
  if (fr) fr.title = TITLE.none;
  from.ruler = -1;
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
function envOf(sim, s, civ) {
  const w = sim.world;
  const t = meanTemp(w, sim.climate, s.tile);
  if (civ.memory.length > 0 && sim.rng.chance(0.3)) {
    const last = civ.memory[civ.memory.length - 1];
    if (/famine|plague|fall|decline|fire|flood|sky/.test(last)) return "disaster";
  }
  if (s.coastal) return "coast";
  if (w.moist[s.tile] < 0.2 && t > 16) return "desert";
  if (t < 3) return "cold";
  if (w.elev[s.tile] - w.seaLevel + SEA > HILL - 0.05) return "mountain";
  if (s.forestTiles > s.tiles.length * 0.45) return "forest";
  if (s.river) return "river";
  return "plains";
}
function createReligion(sim, founder, civ, s, parent, envOverride) {
  const rng = sim.rng;
  const cul = sim.cultures.get(civ.culture);
  const deity = parent && rng.chance(0.6) ? parent.deity : deityFor(rng, envOverride || envOf(sim, s, civ));
  const r = {
    id: sim.nextId++,
    name: religionName(sim, cul.lang, deity),
    deity,
    parent: parent ? parent.id : -1,
    born: sim.tick,
    founder: founder ? founder.id : -1,
    origin: s.name,
    militant: clamp01((parent ? parent.militant : 0.25 + cul.martial * 0.4) + rng.gauss() * 0.2),
    proselytize: clamp01((parent ? parent.proselytize : 0.4) + rng.gauss() * 0.2),
    ascetic: clamp01(0.5 + rng.gauss() * 0.2),
    followers: 0,
    color: rng.int(200) + 40 << 16 | rng.int(200) + 40 << 8 | rng.int(200) + 40
  };
  sim.religions.set(r.id, r);
  return r;
}
function findProphet(sim, s) {
  let best = null, bs = 1.05;
  for (let t = 0; t < 30; t++) {
    const p = sim.people.get(s.people[sim.rng.int(s.people.length)]);
    if (!p || p.job === J.child) continue;
    const sc = p.piety + p.cha * 0.8 + (p.job === J.priest ? 0.25 : 0);
    if (sc > bs) {
      bs = sc;
      best = p;
    }
  }
  return best;
}
var TRADITIONS = [
  ["martial", 0.8, "The Warrior Code", "Generations of war have made valour their highest virtue."],
  ["mercantile", 0.8, "The Counting Houses", "Trade is honoured above birth; a deal is sacred."],
  ["pious", 0.85, "The Great Pilgrimage", "Every soul is expected to walk to the holy places once in life."],
  ["communal", 0.82, "The Shared Harvest", "After hard years, no household may feast while another starves."],
  ["innovative", 0.8, "The Open Lyceum", "Questioning the elders is not insolence but duty."],
  ["insular", 0.86, "The Closed Gates", "Strangers are met at the border, and no further."],
  ["seafaring", 0.78, "The Sea Road", "A child learns the tiller before the plough."]
];
function cultureSeasonal(sim, civ) {
  const rng = sim.rng;
  const cul = sim.cultures.get(civ.culture);
  if (!cul) return;
  const cap2 = sim.settlements.get(civ.capital);
  if (!cap2) return;
  let atWar = false, contacts = 0, heat = 0;
  for (const [, r] of civ.rel) {
    if (r.war >= 0) atWar = true;
    if (r.contact && r.war < 0) contacts++;
  }
  for (const g of civ.grievances) heat += g.mag;
  let trade = 0, hungry = false, sick = false, gini = 0, fishers = 0, scholars = 0, n = 0;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    n++;
    trade += s.tradeVol;
    if (s.hungerMonths > 2) hungry = true;
    if (s.plague > 0) sick = true;
    gini += s.gini;
    fishers += s.jobCount[J.fisher];
    scholars += s.jobCount[J.scholar];
  }
  gini /= n || 1;
  const pop = civ.pop + 1;
  const k = 1;
  cul.martial = clamp01(cul.martial + (atWar ? 4e-3 : -15e-4) * k);
  cul.mercantile = clamp01(cul.mercantile + (Math.min(1, trade / (pop * 0.6)) * 7e-3 - 18e-4) * k);
  cul.pious = clamp01(cul.pious + ((hungry || sick ? 4e-3 : 0) - (civ.tech[TK.science] === 1 ? 25e-4 : 0) + (civ.rulingFaction === 3 ? 2e-3 : -3e-4)) * k);
  cul.communal = clamp01(cul.communal + ((hungry ? 4e-3 : 0) - (gini > 0.45 ? 2e-3 : 0) - (civ.era >= 5 ? 1e-3 : 0)) * k);
  cul.innovative = clamp01(cul.innovative + (Math.min(3, contacts) * 12e-4 + Math.min(1, scholars / pop * 30) * 3e-3 - 2e-3 - (contacts === 0 ? 1e-3 : 0)) * k);
  cul.insular = clamp01(cul.insular + (Math.min(1, heat / 80) * 4e-3 - Math.min(3, contacts) * 8e-4 - Math.min(1, trade / (pop * 0.8)) * 3e-3 + (contacts === 0 ? 15e-4 : 0)) * k);
  cul.seafaring = clamp01(cul.seafaring + (Math.min(1, fishers / pop * 8) * 4e-3 - 1e-3) * k);
  if (civ.pop > 80) {
    for (const [key, thr, name, desc] of TRADITIONS) {
      if (cul[key] > thr && cul.traditions.indexOf(name) < 0) {
        cul.traditions.push(name);
        addEvent(sim, "tradition", 2, `A tradition has taken root among the ${cul.name} people: ${name}. ${desc}`, [civ.id], [], civ.capital, cap2.x, cap2.y);
        break;
      }
    }
  }
  if (civ.pop > 60 && sim.tick - Math.max(civ.founded, cul.born) > 90 * TICKS_PER_YEAR && rng.chance(0.012)) {
    let shared = false;
    for (const o of sim.civs.values()) if (o.alive && o.id !== civ.id && o.culture === civ.culture) shared = true;
    if (shared) {
      const nc = createCulture(sim, cul);
      civPeople(sim, civ, (p) => {
        if (p.culture === cul.id) p.culture = nc.id;
      });
      for (const sid of civ.settlements) {
        const s = sim.settlements.get(sid);
        if (s && s.cultureMajor === cul.id) s.cultureMajor = nc.id;
      }
      civ.culture = nc.id;
      const lang = sim.languages.get(nc.lang);
      addEvent(sim, "culture", 3, `After generations apart from their ${cul.name} kin, the people of the ${civ.name} have become a people of their own: the ${nc.name}, speaking ${lang.name}.`, [civ.id], [], civ.capital, cap2.x, cap2.y);
    }
  }
  if (civ.religion < 0) {
    if ((civ.tech[TK.mysticism] === 1 || civ.pop > 90) && rng.chance(0.2)) {
      const prophet = findProphet(sim, cap2);
      const rel2 = createReligion(sim, prophet, civ, cap2);
      civ.religion = rel2.id;
      civPeople(sim, civ, (p) => {
        if (p.religion < 0) p.religion = rel2.id;
      });
      for (const sid of civ.settlements) {
        const s = sim.settlements.get(sid);
        if (s && s.religionMajor < 0) s.religionMajor = rel2.id;
      }
      if (prophet) {
        addFame(sim, prophet, 6);
        remember(prophet, sim.tick, M.prophet, rel2.id);
        addEvent(sim, "religion", 3, `${fullName(sim, prophet)} of ${cap2.name} taught the ${civ.name} to revere ${rel2.deity}. The faith is called ${rel2.name}.`, [civ.id], [prophet.id], cap2.id, cap2.x, cap2.y);
      } else addEvent(sim, "religion", 2, `The ${civ.name} have come to revere ${rel2.deity}. Their faith is called ${rel2.name}.`, [civ.id], [], cap2.id, cap2.x, cap2.y);
    }
    return;
  }
  const rel = sim.religions.get(civ.religion);
  if (!rel) {
    civ.religion = -1;
    return;
  }
  const ruler = sim.people.get(civ.ruler);
  if (ruler && ruler.religion >= 0 && ruler.religion !== civ.religion && cap2.religionMajor === ruler.religion && rng.chance(0.03)) {
    const nr = sim.religions.get(ruler.religion);
    if (nr) {
      civ.religion = nr.id;
      addEvent(sim, "religion", 3, `${fullName(sim, ruler)} has made ${nr.name} the faith of the ${civ.name}, setting aside ${rel.name}.`, [civ.id], [ruler.id], cap2.id, cap2.x, cap2.y);
      return;
    }
  }
  if (civ.pop > 250 && civ.settlements.length >= 2 && rng.chance(4e-3 + (hungry || sick ? 0.01 : 0) + (1 - civ.stability) * 0.01)) {
    let far = null, bd = 0;
    for (const sid of civ.settlements) {
      const s = sim.settlements.get(sid);
      if (!s || s.id === cap2.id || s.people.length < 40 || s.religionMajor !== civ.religion) continue;
      const d = dist(s.x, s.y, cap2.x, cap2.y) + s.unrest * 30;
      if (d > bd) {
        bd = d;
        far = s;
      }
    }
    const prophet = far ? findProphet(sim, far) : null;
    if (far && prophet) {
      const sect = createReligion(sim, prophet, civ, far, rel, hungry || sick ? "disaster" : void 0);
      let conv = 0;
      for (const id of far.people) {
        const p = sim.people.get(id);
        if (p.religion === rel.id && rng.chance(0.35 + prophet.cha * 0.3 - p.piety * 0.1 + (p.happy < 0.45 ? 0.2 : 0))) {
          p.religion = sect.id;
          conv++;
        }
      }
      prophet.religion = sect.id;
      addFame(sim, prophet, 6);
      remember(prophet, sim.tick, M.prophet, sect.id);
      addEvent(sim, "religion", conv > 80 ? 3 : 2, `Schism! In ${far.name}, ${fullName(sim, prophet)} broke with ${rel.name} and founded ${sect.name}. ${conv} followed.`, [civ.id], [prophet.id], far.id, far.x, far.y);
      if (!civ.laws.tolerance) far.unrest = clamp01(far.unrest + 0.25);
    }
  }
}
function countFollowers(sim) {
  for (const r of sim.religions.values()) r.followers = 0;
  for (const p of sim.people.values()) {
    const r = sim.religions.get(p.religion);
    if (r) r.followers++;
  }
}

// src/sim/powers.ts
function divineAwe(sim, x, y, r, wrath, what) {
  for (const s of sim.settlements.values()) {
    if (!s.alive || dist(s.x, s.y, x, y) > r + 10) continue;
    const civ = sim.civs.get(s.civ);
    if (!civ) continue;
    const cul = sim.cultures.get(civ.culture);
    if (cul) cul.pious = clamp01(cul.pious + 0.03);
    const mem = `${what} of year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`;
    if (civ.memory.indexOf(mem) < 0) civ.memory.push(mem);
    for (const id of s.people) {
      const p = sim.people.get(id);
      if (p && sim.rng.chance(0.25)) p.piety = clamp01(p.piety + 0.08);
    }
    if (wrath) s.unrest = clamp01(s.unrest + 0.05);
  }
}
function commitTerrain(sim) {
  if (!sim.rt.terrainPending) return;
  sim.rt.terrainPending = false;
  applyWaterChange(sim);
  for (const s of Array.from(sim.settlements.values())) {
    if (s.alive && sim.world.water[s.tile] !== W_LAND) {
      addEvent(sim, "flood", 3, `${s.name} was swallowed by the waters.`, [s.civ], [], s.id, s.x, s.y);
      abandonSettlement(sim, s, "drowned beneath the waves");
    }
  }
}
function harmSettlements(sim, x, y, r, dmg, killFrac, cause) {
  let dead = 0;
  for (const s of Array.from(sim.settlements.values())) {
    if (!s.alive) continue;
    const d = dist(s.x, s.y, x, y);
    if (d > r + s.radius * 0.4) continue;
    const f = clamp01(1.15 - d / (r + 1));
    s.damage = clamp01(s.damage + dmg * f);
    for (let b = 0; b < s.bld.length; b++) if (s.bld[b] > 0 && sim.rng.chance(dmg * f * 0.6)) s.bld[b]--;
    for (const id of s.people.slice()) {
      const p = sim.people.get(id);
      if (p && sim.rng.chance(killFrac * f)) {
        killPerson(sim, p, cause);
        dead++;
      }
    }
    for (const u of s.urban) markDirty(sim, u);
  }
  for (const a of sim.armies.values()) {
    if (dist(a.x, a.y, x, y) < r) {
      for (const id of a.soldiers.slice()) {
        const p = sim.people.get(id);
        if (p && sim.rng.chance(killFrac)) {
          killPerson(sim, p, cause);
          dead++;
        }
      }
    }
  }
  return dead;
}
function harmHerds(sim, x, y, r, frac) {
  const out = [];
  herdsNear(sim, x, y, r, out);
  for (const h of out) {
    const sp = sim.species.get(h.sp);
    const k = Math.ceil(h.n * frac);
    h.n -= k;
    sp.count -= k;
    if (h.n <= 0) {
      sim.herds.delete(h.id);
      checkExtinction(sim, sp);
    }
  }
}
function meteor(sim, x, y, r, natural = false) {
  const w = sim.world;
  forDisc(w, x, y, r * 1.5, (i, d) => {
    if (d < r) {
      const f = 1 - d / r;
      w.elev[i] = clamp(w.elev[i] - 0.1 * f - 0.03, 0.05, 0.99);
      w.forest[i] = 0;
      w.veg[i] = 0;
      w.fert[i] *= 0.4;
      if (w.imp[i] !== I_NONE && w.imp[i] !== I_URBAN) w.imp[i] = I_NONE;
      w.road[i] = 0;
    } else {
      w.elev[i] = clamp(w.elev[i] + 0.025, 0.05, 0.99);
      if (w.water[i] === W_LAND && sim.rng.chance(0.6)) ignite(sim, i);
    }
    markDirty(sim, i);
  });
  const dead = harmSettlements(sim, x, y, r * 1.6, 0.8, 0.5, "the falling star");
  harmHerds(sim, x, y, r * 2, 0.8);
  sim.climate.dust = Math.min(1, sim.climate.dust + 0.05 * r);
  sim.rt.fx.push({ kind: "meteor", x, y, r, t: sim.tick });
  sim.rt.terrainPending = true;
  commitTerrain(sim);
  addEvent(sim, "meteor", 4, `A star fell from the sky${dead > 0 ? `, killing ${dead}` : ""}. Dust dims the sun; the seasons that follow will be cold.`, [], [], -1, x, y);
  divineAwe(sim, x, y, r * 4, true, natural ? "the falling star" : "the sky-fire");
}
function erupt(sim, x, y, natural = false) {
  const w = sim.world;
  if (x < 1 || y < 1 || x >= w.w - 1 || y >= w.h - 1) return;
  const idx = y * w.w + x;
  const r = 4;
  forDisc(w, x, y, r, (i, d) => {
    const f = 1 - d / (r + 0.5);
    w.elev[i] = clamp(Math.max(w.elev[i], w.seaLevel + 0.05) + 0.2 * f * f, 0.05, 0.99);
    if (w.water[i] === W_LAKE) w.water[i] = W_LAND;
    w.forest[i] = 0;
    w.veg[i] = 0;
    w.fert[i] = Math.min(1, w.fert[i] + 0.3);
    if (w.imp[i] !== I_URBAN) w.imp[i] = I_NONE;
    markDirty(sim, i);
  });
  forDisc(w, x, y, r + 4, (i, d) => {
    if (d > r && w.water[i] === W_LAND && sim.rng.chance(0.45)) ignite(sim, i);
  });
  if (w.volcanoes.indexOf(idx) < 0) w.volcanoes.push(idx);
  const dead = harmSettlements(sim, x, y, r + 5, 0.6, 0.3, "the eruption");
  harmHerds(sim, x, y, r + 5, 0.6);
  sim.climate.dust = Math.min(1, sim.climate.dust + 0.22);
  sim.rt.fx.push({ kind: "erupt", x, y, r: r + 4, t: sim.tick });
  sim.rt.terrainPending = true;
  commitTerrain(sim);
  addEvent(sim, "volcano", 4, `A volcano erupted${dead > 0 ? `, burying ${dead} people in ash` : ""}. Ash veils the sun across the world.`, [], [], -1, x, y);
  divineAwe(sim, x, y, 22, true, natural ? "the burning mountain" : "the mountain of fire");
}
function quake(sim, x, y, r, natural = false) {
  const dead = harmSettlements(sim, x, y, r, 0.45, 0.06, "the earthquake");
  sim.rt.fx.push({ kind: "quake", x, y, r, t: sim.tick });
  let named = "";
  for (const s of sim.settlements.values()) if (s.alive && dist(s.x, s.y, x, y) < r) named = named || s.name;
  if (named || !natural) addEvent(sim, "quake", dead > 20 ? 3 : 2, `The earth shook${named ? " at " + named : ""}${dead ? `; ${dead} died under falling roofs` : ""}.`, [], [], -1, x, y);
  if (named) divineAwe(sim, x, y, r, true, "the great earthquake");
}
function naturalDisasters(sim) {
  const w = sim.world;
  const rng = sim.rng;
  const k = sim.params.disasters;
  if (k <= 0) return;
  for (const v of w.volcanoes) {
    if (rng.chance(4e-3 * k)) erupt(sim, v % w.w, v / w.w | 0, true);
  }
  if (rng.chance(0.03 * k)) {
    for (let t = 0; t < 30; t++) {
      const i = rng.int(w.n);
      if (w.water[i] === W_LAND && w.elev[i] - w.seaLevel + SEA > MOUNTAIN - 0.1) {
        quake(sim, i % w.w, i / w.w | 0, 7 + rng.int(6), true);
        break;
      }
    }
  }
  if (rng.chance(6e-4 * k)) {
    const i = rng.int(w.n);
    meteor(sim, i % w.w, i / w.w | 0, 3 + rng.int(3), true);
  }
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
function studyRuins(sim) {
  if (sim.ruins.length === 0) return;
  for (const civ of sim.civs.values()) {
    if (!civ.alive || !sim.rng.chance(0.04)) continue;
    for (const r of sim.ruins) {
      let near = false;
      for (const sid of civ.settlements) {
        const s = sim.settlements.get(sid);
        if (s && dist(s.x, s.y, r.x, r.y) < s.radius + 2) near = true;
      }
      if (!near) continue;
      for (const t of r.techs) {
        if (civ.tech[t] === 1 || TECHS[t].tier === 0) continue;
        let ok = true;
        for (const p of TECH_PRE[t]) if (civ.tech[p] !== 1) ok = false;
        if (!ok) continue;
        learnTech(sim, civ, t, "ruin");
        return;
      }
    }
  }
}
function tick(sim) {
  sim.tick++;
  const t = sim.tick;
  updateClimate(sim);
  updateEcology(sim);
  updateParties(sim);
  updateArmies(sim);
  const phase = t % 4;
  for (const s of sim.settlements.values()) {
    if (!s.alive) continue;
    if (s.id % 4 === phase) settlementMonthly(sim, s);
    if (s.alive && (t + s.id * 7) % TICKS_PER_YEAR === 0) discoverRoutes(sim, s);
  }
  for (const civ of sim.civs.values()) {
    if (civ.alive && (t + civ.id * 5) % 12 === 0) civSeasonal(sim, civ);
  }
  processPending(sim);
  if (t % TICKS_PER_YEAR === 0) {
    sampleStats(sim);
    pruneGraves(sim);
    countFollowers(sim);
    recountSpecies(sim);
    naturalDisasters(sim);
    studyRuins(sim);
  }
}

// src/sim/save.ts
var TYPES = { F32: Float32Array, U8: Uint8Array, I8: Int8Array, U16: Uint16Array, I16: Int16Array, I32: Int32Array };
function b64encode(bytes) {
  let s = "";
  const CH = 32768;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function enc(v) {
  if (v === null || v === void 0) return null;
  if (typeof v !== "object") return v;
  if (v instanceof RNG) return { __t: "RNG", s: v.s };
  if (ArrayBuffer.isView(v)) {
    for (const k in TYPES) {
      if (v instanceof TYPES[k]) {
        const ta = v;
        return { __t: k, b: b64encode(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)) };
      }
    }
    throw new Error("unsupported typed array");
  }
  if (v instanceof Map) {
    const e = [];
    for (const [k, val] of v) e.push([k, enc(val)]);
    return { __t: "M", e };
  }
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = enc(v[i]);
    return out;
  }
  const o = {};
  for (const k in v) o[k] = enc(v[k]);
  return o;
}
function dec(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = dec(v[i]);
    return v;
  }
  const t = v.__t;
  if (t) {
    if (t === "RNG") {
      const r = new RNG(0);
      r.s = v.s;
      return r;
    }
    if (t === "M") {
      const m = /* @__PURE__ */ new Map();
      for (const [k, val] of v.e) m.set(k, dec(val));
      return m;
    }
    const C = TYPES[t];
    const bytes = b64decode(v.b);
    return new C(bytes.buffer, 0, bytes.byteLength / C.BYTES_PER_ELEMENT);
  }
  for (const k in v) v[k] = dec(v[k]);
  return v;
}
function serialize(sim) {
  const { rt, ...rest } = sim;
  void rt;
  return JSON.stringify({ format: "genesis-save", version: SIM_VERSION, data: enc(rest) });
}
function deserialize(json) {
  const raw = JSON.parse(json);
  if (!raw || raw.format !== "genesis-save") throw new Error("This file is not a Genesis world.");
  if (raw.version !== SIM_VERSION) throw new Error(`This world was saved by a different version (${raw.version}).`);
  const sim = dec(raw.data);
  sim.rt = newRuntime(sim.world);
  for (const c of sim.civs.values()) recomputeMods(c);
  return sim;
}

// test/probe.ts
var mode = process.argv[2];
if (mode === "eco") {
  const sim = createSim({ seed: 81, w: 128, h: 80, land: 0.4, tribes: 0, popCap: 1e3 });
  for (let y = 0; y <= 200; y++) {
    if (y % 25 === 0) console.log(`y${y} herds ${sim.herds.size}: ` + Array.from(sim.species.values()).map((s) => `${s.name.split(" ")[1]}${s.diet === 1 ? "*" : ""}:${s.extinct >= 0 ? "X" : s.count}`).join(" "));
    for (let k = 0; k < TICKS_PER_YEAR; k++) tick(sim);
  }
} else {
  const a = createSim({ seed: 7, w: 128, h: 80, land: 0.4, tribes: 5, popCap: 6e3 });
  for (let k = 0; k < 60 * TICKS_PER_YEAR; k++) tick(a);
  const bad = [];
  const walk = (v, path, depth) => {
    if (bad.length > 20 || depth > 7) return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) bad.push(path + "=" + v);
      return;
    }
    if (v === void 0) {
      bad.push(path + "=undefined");
      return;
    }
    if (v === null || typeof v !== "object") return;
    if (ArrayBuffer.isView(v)) {
      const arr = v;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) {
        bad.push(path + "[" + i + "]=" + arr[i]);
        break;
      }
      return;
    }
    if (v instanceof Map) {
      let n = 0;
      for (const [k, x] of v) {
        if (n++ > 400) break;
        walk(x, path + "<" + k + ">", depth + 1);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < Math.min(v.length, 400); i++) walk(v[i], path + "[" + i + "]", depth + 1);
      return;
    }
    for (const k in v) {
      if (k === "rt") continue;
      walk(v[k], path + "." + k, depth + 1);
    }
  };
  walk(a, "sim", 0);
  console.log("non-finite/undefined:", bad.length ? bad.join("\n  ") : "none");
  const b = deserialize(serialize(a));
  const snap = (s) => JSON.stringify({ t: s.tick, rng: s.rng.s, id: s.nextId, pop: s.people.size, herds: s.herds.size, hn: Array.from(s.herds.values()).reduce((x, h) => x + h.n, 0), parties: s.parties.size, food: Array.from(s.settlements.values()).reduce((x, t) => x + t.stock[0], 0), fires: s.fires.length, storms: s.storms.length, hist: s.history.length });
  for (let k = 0; k < 2e3; k++) {
    tick(a);
    tick(b);
    const sa = snap(a), sb = snap(b);
    if (sa !== sb) {
      console.log("diverged at +" + (k + 1) + " ticks\n A " + sa + "\n B " + sb);
      break;
    }
    if (k === 1999) console.log("no divergence in 2000 ticks");
  }
}
