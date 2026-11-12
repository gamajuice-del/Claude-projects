// Procedural planet: tectonic plates -> elevation -> oceans -> climate -> rivers & lakes -> soils -> flora -> geology.
import { RNG, clamp, clamp01, fbm, hash2, lerp, noise2, ridged } from './rng';
import { R_COAL, R_COPPER, R_GOLD, R_IRON, R_OIL, R_SALT, R_STONE, W_LAND, W_OCEAN, World } from './types';
import { HILL, MOUNTAIN, SEA, allocWorld, recomputeCoast, recomputeHydrology, recomputeWater } from './world';

export interface WorldOpts {
  seed: number;
  w: number;
  h: number;
  land: number; // target land fraction 0.15..0.6
}

const RAIN_BAND: [number, number][] = [
  [0, 0.92], [0.12, 0.82], [0.27, 0.2], [0.36, 0.24], [0.5, 0.62], [0.63, 0.66], [0.8, 0.42], [1, 0.22],
];
function rainBand(lat: number): number {
  for (let k = 1; k < RAIN_BAND.length; k++) {
    if (lat <= RAIN_BAND[k][0]) {
      const a = RAIN_BAND[k - 1],
        b = RAIN_BAND[k];
      return lerp(a[1], b[1], (lat - a[0]) / (b[0] - a[0]));
    }
  }
  return 0.22;
}

export function generateWorld(opts: WorldOpts): World {
  const { seed } = opts;
  const W = opts.w,
    H = opts.h;
  const w = allocWorld(seed, W, H);
  const n = w.n;
  const rng = new RNG(seed ^ 0x9e3779b9);
  const scale = Math.sqrt((W * H) / (256 * 160)); // feature scale relative to the medium map

  // --- tectonic plates ---
  const np = Math.max(7, Math.round(13 * scale + rng.int(4)));
  const px: number[] = [], py: number[] = [], pvx: number[] = [], pvy: number[] = [], pcont: number[] = [];
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
      // domain warp so plate edges wander
      const wx = x + (fbm(x * fs * 1.7, y * fs * 1.7, seed + 11, 3) - 0.5) * 60 * scale;
      const wy = y + (fbm(x * fs * 1.7, y * fs * 1.7, seed + 23, 3) - 0.5) * 60 * scale;
      let d1 = 1e9, d2 = 1e9, p1 = 0, p2 = 0;
      for (let p = 0; p < np; p++) {
        const dx = wx - px[p], dy = (wy - py[p]) * 1.25;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; p2 = p1; d1 = d; p1 = p; }
        else if (d < d2) { d2 = d; p2 = p; }
      }
      d1 = Math.sqrt(d1);
      d2 = Math.sqrt(d2);
      const edge = (d2 - d1) / (26 * scale); // 0 at boundary
      // convergence along the boundary normal
      let nx = px[p2] - px[p1], ny = py[p2] - py[p1];
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const conv = (pvx[p1] - pvx[p2]) * nx + (pvy[p1] - pvy[p2]) * ny; // >0 colliding
      const cont = pcont[p1];
      const contBlend = lerp(cont, (pcont[p1] + pcont[p2]) / 2, clamp01(1 - edge));
      let e = 0.18 + contBlend * 0.34;
      e += (fbm(x * fs, y * fs, seed + 101, 5) - 0.5) * 0.62;
      const near = Math.exp(-edge * edge * 2.2);
      const rd = ridged(x * fs * 2.3, y * fs * 2.3, seed + 303, 4);
      let mt = 0;
      if (conv > 0) mt = near * conv * (0.25 + 0.75 * rd) * (pcont[p1] + pcont[p2] > 0 ? 0.52 : 0.3);
      else mt = near * conv * 0.1; // rifts sink
      e += mt;
      orogeny[i] = clamp01(near * Math.max(0, conv) * rd * 1.3 + Math.max(0, mt) * 1.5);
      // interior ranges and detail
      e += Math.pow(ridged(x * fs * 1.1 + 40, y * fs * 1.1 - 17, seed + 517, 4), 2.2) * 0.16 * contBlend;
      e += (fbm(x * fs * 6, y * fs * 6, seed + 707, 3) - 0.5) * 0.1;
      // sink the borders so the world is ringed by ocean
      const bx = Math.min(x, W - 1 - x) / (W * 0.13);
      const by = Math.min(y, H - 1 - y) / (H * 0.13);
      const border = clamp01(Math.min(bx, by));
      e -= (1 - border) * (1 - border) * 0.6;
      raw[i] = e;
    }
  }
  // light blur to soften plate seams
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
  // normalize: pick sea level by quantile so land fraction is as requested
  const sorted = Float32Array.from(tmp).sort();
  const q = sorted[Math.floor(n * (1 - clamp(opts.land, 0.12, 0.65)))];
  const lo = sorted[0],
    hi = sorted[n - 1];
  for (let i = 0; i < n; i++) {
    const e = tmp[i];
    if (e >= q) {
      const t = (e - q) / (hi - q + 1e-6);
      w.elev[i] = SEA + 0.002 + Math.pow(t, 1.45) * 0.58;
    } else {
      const t = (q - e) / (q - lo + 1e-6);
      w.elev[i] = SEA - 0.002 - Math.pow(t, 0.8) * 0.38;
    }
  }
  w.seaLevel = SEA;
  recomputeWater(w);
  recomputeCoast(w);

  // --- temperature ---
  for (let y = 0; y < H; y++) {
    const lat = 1 - y / (H - 1);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const alt = Math.max(0, w.elev[i] - SEA);
      w.temp[i] = 29 - 44 * Math.pow(lat, 1.25) - alt * 46 + (noise2(x / 23, y / 23, seed + 901) - 0.5) * 4;
    }
  }

  // --- rainfall: latitude bands + moisture carried by prevailing winds + rain shadows ---
  for (let y = 0; y < H; y++) {
    const lat = 1 - y / (H - 1);
    const band = rainBand(lat);
    const westerly = lat > 0.3 && lat < 0.72; // wind blows toward +x
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
  // blur rain across rows so wind streaks blend
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

  // --- rivers and lakes ---
  recomputeHydrology(w, true);
  recomputeCoast(w);
  recomputeHydrology(w, false);

  // --- soil, moisture, flora ---
  for (let i = 0; i < n; i++) {
    const x = i % W,
      y = (i / W) | 0;
    if (w.water[i] !== W_LAND) {
      w.veg[i] = 0.4 + 0.5 * noise2(x / 9, y / 9, seed + 1501); // fish stock
      w.moist[i] = 1;
      continue;
    }
    const alt = w.elev[i] - SEA;
    let m = w.rain[i];
    if (w.river[i] > 0) m = Math.min(1, m + 0.25 + w.river[i] / 500);
    w.moist[i] = m;
    let f = 0.32 + 0.4 * fbm(x / 14, y / 14, seed + 1601, 3) + 0.25 * m - alt * 1.1;
    if (w.river[i] > 0) f += 0.22; // alluvium
    f += orogeny[i] * 0.1; // volcanic soils
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

  // --- geology: deposits follow how the land was formed ---
  for (let i = 0; i < n; i++) {
    if (w.water[i] !== W_LAND) continue;
    const x = i % W,
      y = (i / W) | 0;
    const e = w.elev[i];
    const h = hash2(x, y, seed + 2001);
    const oro = orogeny[i];
    const blob = (s: number, sc: number) => fbm(x / sc, y / sc, seed + s, 2);
    let r = 0, amt = 0;
    if (e > HILL - 0.04 && blob(2101, 8) + oro * 0.35 > 0.66 && h < 0.3) { r = R_IRON; amt = 500 + h * 3000; }
    else if (e > HILL - 0.07 && blob(2201, 7) + oro * 0.3 > 0.68 && h < 0.3) { r = R_COPPER; amt = 400 + h * 2500; }
    else if (e > HILL && blob(2301, 6) + oro * 0.4 > 0.8 && h < 0.2) { r = R_GOLD; amt = 150 + h * 1500; }
    else if (e < HILL && e > SEA + 0.015 && w.rain[i] > 0.38 && blob(2401, 9) > 0.64 && h < 0.2) { r = R_COAL; amt = 800 + h * 4000; }
    else if (w.rain[i] < 0.3 && e < HILL - 0.05 && blob(2501, 7) > 0.6 && h < 0.16) { r = R_SALT; amt = 500 + h * 3000; }
    else if (w.coast[i] && w.temp[i] > 14 && w.rain[i] < 0.42 && h < 0.07) { r = R_SALT; amt = 400 + h * 4000; }
    else if (e < HILL - 0.06 && blob(2601, 10) > 0.7 && h < 0.14) { r = R_OIL; amt = 1000 + h * 6000; }
    else if (blob(2701, 5) > 0.7 && e < HILL && w.rain[i] > 0.6 && h < 0.05) { r = R_IRON; amt = 300 + h * 2000; } // bog iron
    else if (e > HILL - 0.02 && h > 0.72) { r = R_STONE; amt = 2000 + h * 4000; }
    else if (h > 0.985) { r = R_STONE; amt = 1500; }
    w.res[i] = r;
    w.resAmt[i] = Math.min(65535, Math.round(amt * 4));
  }

  // --- volcanoes sit on the most violent convergent boundaries ---
  const cand: number[] = [];
  for (let i = 0; i < n; i++) if (w.water[i] === W_LAND && orogeny[i] > 0.55 && w.elev[i] > MOUNTAIN) cand.push(i);
  rng.shuffle(cand);
  const nv = Math.min(cand.length, Math.max(2, Math.round(5 * scale)));
  for (let k = 0; k < cand.length && w.volcanoes.length < nv; k++) {
    const i = cand[k];
    const x = i % W,
      y = (i / W) | 0;
    let ok = true;
    for (const v of w.volcanoes) if (Math.hypot((v % W) - x, ((v / W) | 0) - y) < 18 * scale) ok = false;
    if (ok) w.volcanoes.push(i);
  }
  return w;
}

export function landFraction(w: World): number {
  let l = 0;
  for (let i = 0; i < w.n; i++) if (w.water[i] === W_LAND) l++;
  return l / w.n;
}
export { W_OCEAN };
