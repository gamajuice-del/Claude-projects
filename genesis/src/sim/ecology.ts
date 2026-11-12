// Living land: soil moisture, plant growth and succession, adaptation of flora, desertification,
// erosion, floods, wildfire, fish stocks — and animal herds that eat, breed, migrate, hunt and evolve.
import { clamp, clamp01, hash2 } from './rng';
import { addEvent } from './history';
import { speciesName } from './names';
import { Herd, I_FARM, I_MINE, I_NONE, I_PASTURE, I_URBAN, Sim, Species, TICKS_PER_YEAR, W_LAND, W_OCEAN } from './types';
import { DX8, DY8, MOUNTAIN, SEA, classifyBiome, growthPotential, markDirty, meanTemp, rainAnomaly, tempAt } from './world';
import { ignite } from './climate';

const SLICES = 16;

export function updateEcology(sim: Sim): void {
  updateTiles(sim);
  updateFires(sim);
  rebuildHerdGrid(sim); // every tick, so a freshly loaded world sees exactly what the original would
  updateHerds(sim);
}

function updateTiles(sim: Sim): void {
  const w = sim.world;
  const c = sim.climate;
  const P = sim.params;
  const rng = sim.rng;
  const W = w.w,
    H = w.h,
    n = w.n;
  const per = Math.ceil(n / SLICES);
  const start = sim.vegCursor;
  const end = Math.min(n, start + per);
  sim.vegCursor = end >= n ? 0 : end;
  const tick = sim.tick;
  const month = Math.floor((tick % TICKS_PER_YEAR) / 4);
  for (let i = start; i < end; i++) {
    if (w.water[i] !== W_LAND) {
      // fish: logistic regrowth, richer on shelves
      const K = w.coast[i] || w.elev[i] > w.seaLevel - 0.06 ? 1 : 0.45;
      const f = w.veg[i];
      w.veg[i] = clamp(f + 0.25 * P.wildlife * (f + 0.02) * (1 - f / K), 0.01, 1);
      if (w.flood[i]) w.flood[i] = 0;
      continue;
    }
    const x = i % W,
      y = (i / W) | 0;
    const anomaly = rainAnomaly(w, c, x, y, tick, P.climateVolatility);
    const T = tempAt(w, c, i, tick);
    // --- soil moisture follows rain, rivers, heat ---
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
    // --- river floods in very wet years ---
    if (w.river[i] > 70 && anomaly > 1.5 && month >= 1 && month <= 5 && w.flood[i] === 0 && rng.chance(0.012 * P.disasters)) {
      floodAt(sim, i, 2 + Math.floor(w.river[i] / 90));
    }
    // --- grasses & shrubs ---
    const g = growthPotential(w, c, i, tick) * P.growth;
    const imp = w.imp[i];
    let v = w.veg[i];
    const K = Math.min(1, g * (0.35 + 0.65 * w.fert[i]));
    if (imp === I_URBAN) v *= 0.8;
    else if (K > v) v += 0.4 * (K - v);
    else v -= (T < 2 ? 0.05 : 0.22) * (v - K);
    w.veg[i] = clamp01(v);
    // --- forest succession: spreads from neighbours where climate allows ---
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
    // --- soil: humus builds under plants; bare dry ground blows away; rain strips steep bare slopes ---
    let fe = w.fert[i];
    const cover = v + fo;
    if (cover > 0.5 && imp !== I_FARM) fe += 0.0012 * (1 - fe);
    if (cover < 0.12 && m < 0.2) fe -= 0.004 * fe; // desertification
    if (cover < 0.3 && w.rain[i] * anomaly > 0.6) {
      const f = w.flow[i];
      if (f >= 0) {
        const slope = w.elev[i] - w.elev[f];
        if (slope > 0.012) {
          const lost = Math.min(fe * 0.02, slope * 0.05);
          fe -= lost;
          if (w.water[f] === W_LAND) w.fert[f] = Math.min(1, w.fert[f] + lost * 0.8); // sediment settles downstream
          // real erosion: the slope itself wears down, very slowly
          w.elev[i] -= lost * 0.004;
        }
      }
    }
    w.fert[i] = clamp(fe, 0.01, 1);
    // --- flora adapts to the climate it lives in (slowly) ---
    if (rng.chance(0.03)) {
      const want = clamp(meanTemp(w, c, i) + 5, 4, 30);
      const cur = w.flora[i];
      if (want > cur + 0.5) w.flora[i] = cur + 1;
      else if (want < cur - 0.5) w.flora[i] = cur - 1;
    }
    // --- spontaneous fire in hot, tinder-dry growth ---
    if (T > 25 && m < 0.16 && (fo > 0.35 || v > 0.55) && rng.chance(0.00035 * P.disasters)) ignite(sim, i);
    const b = classifyBiome(w, c, i);
    if (b !== w.biome[i]) w.biome[i] = b;
  }
}

export function floodAt(sim: Sim, i: number, r: number): void {
  const w = sim.world;
  const x0 = i % w.w,
    y0 = (i / w.w) | 0;
  const base = w.elev[i];
  let hitSettlement = -1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx,
        y = y0 + dy;
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
      const j = y * w.w + x;
      if (w.water[j] !== W_LAND || w.elev[j] > base + 0.012) continue;
      if (w.flood[j] === 0) markDirty(sim, j);
      w.flood[j] = 3;
      w.fert[j] = Math.min(1, w.fert[j] + 0.03); // silt
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
        addEvent(sim, 'flood', 2, `The river burst its banks at ${s.name}, drowning fields and stores.`, [s.civ], [], s.id, s.x, s.y);
      }
    }
  }
}

function updateFires(sim: Sim): void {
  const w = sim.world;
  const rng = sim.rng;
  if (sim.fires.length === 0 || sim.tick % 2 !== 0) return;
  const next: number[] = [];
  const W = w.w,
    H = w.h;
  for (let k = 0; k < sim.fires.length; k++) {
    const i = sim.fires[k];
    if (w.fire[i] === 0) continue;
    const x = i % W,
      y = (i / W) | 0;
    w.forest[i] *= 0.72;
    w.veg[i] *= 0.5;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d],
        ny = y + DY8[d];
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
          addEvent(sim, 'fire', 2, `Fire swept through ${s.name}.`, [s.civ], [], s.id, s.x, s.y);
        }
      }
    } else if (w.imp[i] === I_FARM) {
      const s = sim.settlements.get(w.owner[i]);
      if (s && s.alive) s.stock[0] *= 0.985;
    }
    w.fire[i]--;
    if (w.fire[i] > 0) next.push(i);
    else {
      w.fert[i] = Math.min(1, w.fert[i] + 0.02); // ash
      markDirty(sim, i);
    }
  }
  sim.fires = next;
}

// ---------------------------------------------------------------- animals

export function createSpecies(sim: Sim, init: Partial<Species> & { diet: number; size: number; speed: number; cold: number; shape: number }): Species {
  const sp: Species = {
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
    made: init.made ?? false,
  };
  sim.species.set(sp.id, sp);
  return sp;
}

function speciesColor(sim: Sim, diet: number, cold: number, size: number): number {
  const r = sim.rng;
  const pale = clamp01((12 - cold) / 22); // cold-adapted animals are paler
  let cr = diet === 1 ? 120 : 150, cg = diet === 1 ? 90 : 115, cb = diet === 1 ? 80 : 75;
  cr += r.int(50) - 25 + pale * 70;
  cg += r.int(40) - 20 + pale * 80;
  cb += r.int(40) - 20 + pale * 100 - size * 20;
  return (clamp(cr, 30, 250) << 16) | (clamp(cg, 30, 250) << 8) | clamp(cb, 30, 250);
}

export function spawnHerd(sim: Sim, sp: Species, x: number, y: number, n: number): Herd {
  const h: Herd = { id: sim.nextId++, sp: sp.id, x, y, n, energy: 0.7, size: sp.size, speed: sp.speed, cold: sp.cold, fecund: sp.fecund, fierce: sp.fierce, tx: x, ty: y };
  sim.herds.set(h.id, h);
  sp.count += n;
  return h;
}

export function seedWildlife(sim: Sim): void {
  const w = sim.world;
  const rng = sim.rng;
  const defs: (Partial<Species> & { diet: number; size: number; speed: number; cold: number; shape: number })[] = [
    { diet: 0, size: 0.55, speed: 0.6, cold: -4, shape: 0, herd: 30, fecund: 0.45 },
    { diet: 0, size: 0.6, speed: 0.8, cold: 9, shape: 0, herd: 22, fecund: 0.5, ridable: true, domestic: true },
    { diet: 0, size: 0.65, speed: 0.45, cold: 13, shape: 0, herd: 26, fecund: 0.5, domestic: true, ridable: false },
    { diet: 0, size: 0.4, speed: 0.75, cold: 25, shape: 0, herd: 34, fecund: 0.6 },
    { diet: 0, size: 0.95, speed: 0.35, cold: -2, shape: 3, herd: 9, fecund: 0.22, domestic: false, fierce: 0.5 },
    { diet: 0, size: 0.9, speed: 0.4, cold: 26, shape: 3, herd: 8, fecund: 0.24, domestic: false, fierce: 0.6 },
    { diet: 2, size: 0.3, speed: 0.5, cold: 14, shape: 2, herd: 14, fecund: 0.8, domestic: true },
    { diet: 0, size: 0.15, speed: 0.7, cold: 8, shape: 2, herd: 40, fecund: 1.0, domestic: false },
    { diet: 1, size: 0.45, speed: 0.75, cold: 0, shape: 1, herd: 7 },
    { diet: 1, size: 0.6, speed: 0.7, cold: 24, shape: 1, herd: 5 },
    { diet: 1, size: 0.75, speed: 0.5, cold: 8, shape: 1, herd: 3, fierce: 0.9 },
    { diet: 0, size: 0.35, speed: 0.65, cold: 22, shape: 4, herd: 12, fecund: 0.6 },
  ];
  const land: number[] = [];
  for (let i = 0; i < w.n; i++) if (w.water[i] === W_LAND && w.elev[i] < MOUNTAIN) land.push(i);
  if (land.length === 0) return;
  const target = Math.floor((land.length / 55) * sim.params.wildlife);
  for (const d of defs) {
    const sp = createSpecies(sim, d);
    const share = Math.max(2, Math.floor((target / defs.length) * (d.diet === 1 ? 0.45 : 1.2)));
    let placed = 0;
    for (let tries = 0; tries < share * 30 && placed < share; tries++) {
      const i = rng.pick(land);
      const mt = meanTemp(w, sim.climate, i);
      if (Math.abs(mt - sp.cold) > 8) continue;
      if (sp.diet !== 1 && w.veg[i] < 0.2) continue;
      spawnHerd(sim, sp, i % w.w, (i / w.w) | 0, Math.max(2, Math.floor(sp.herd * rng.range(0.5, 1))));
      placed++;
    }
  }
}

const CELL = 8;
export function herdCell(sim: Sim, x: number, y: number): number {
  return Math.floor(y / CELL) * 4096 + Math.floor(x / CELL);
}
function rebuildHerdGrid(sim: Sim): void {
  const g = sim.rt.herdGrid;
  g.clear();
  for (const h of sim.herds.values()) {
    const k = herdCell(sim, h.x, h.y);
    const a = g.get(k);
    if (a) a.push(h.id);
    else g.set(k, [h.id]);
  }
}

/** herds within ~radius tiles of a point (grid query) */
export function herdsNear(sim: Sim, x: number, y: number, radius: number, out: Herd[]): Herd[] {
  out.length = 0;
  const g = sim.rt.herdGrid;
  const c0x = Math.floor((x - radius) / CELL),
    c1x = Math.floor((x + radius) / CELL);
  const c0y = Math.floor((y - radius) / CELL),
    c1y = Math.floor((y + radius) / CELL);
  const r2 = radius * radius;
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const a = g.get(cy * 4096 + cx);
      if (!a) continue;
      for (const id of a) {
        const h = sim.herds.get(id);
        if (!h || h.n <= 0) continue;
        const dx = h.x - x,
          dy = h.y - y;
        if (dx * dx + dy * dy <= r2) out.push(h);
      }
    }
  }
  return out;
}

const tmpHerds: Herd[] = [];

function updateHerds(sim: Sim): void {
  const w = sim.world;
  const c = sim.climate;
  const rng = sim.rng;
  const phase = sim.tick % 4;
  const W = w.w,
    H = w.h;
  let landTiles = 0;
  // cheap herd budget from map size (species compete for the same slots)
  landTiles = w.n * 0.35;
  const maxHerds = Math.floor((landTiles / 28) * sim.params.wildlife) + 20;
  const dead: number[] = [];
  // packs are territorial and no grazer monopolises the range: per-kind herd budgets
  let predHerds = 0;
  const perSpecies = new Map<number, number>();
  for (const h of sim.herds.values()) {
    perSpecies.set(h.sp, (perSpecies.get(h.sp) || 0) + 1);
    if (sim.species.get(h.sp)!.diet === 1) predHerds++;
  }
  for (const h of sim.herds.values()) {
    if (h.id % 4 !== phase) continue;
    const sp = sim.species.get(h.sp)!;
    if (h.n <= 0) {
      dead.push(h.id);
      continue;
    }
    let xi = clamp(Math.round(h.x), 0, W - 1),
      yi = clamp(Math.round(h.y), 0, H - 1);
    let i = yi * W + xi;
    const before = h.n;
    if (w.water[i] !== W_LAND) {
      // swept into water by a changing world
      h.n = Math.floor(h.n * 0.5);
      h.energy -= 0.2;
    }
    const T = tempAt(w, c, i, sim.tick);
    // thermal stress: big animals hold heat (good in cold, bad in heat)
    const tol = 13 + h.size * 4;
    const dT = T - h.cold;
    const stress = Math.max(0, Math.abs(dT + (dT < 0 ? h.size * 5 : -2)) - tol);
    h.energy -= stress * 0.012;
    // --- feeding ---
    const need = h.n * (0.25 + h.size) * (1 + h.speed * 0.3) * 0.0028;
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
      if (sp.diet === 2) h.energy += 0.04; // omnivores scrape by
    } else {
      // predators hunt the most catchable herd in range — unless they are already full
      if (h.energy > 0.85) h.energy -= 0.03;
      else {
        herdsNear(sim, h.x, h.y, 6, tmpHerds);
        let best: Herd | null = null,
          bestScore = 0.12;
        const pack = 1 - Math.min(1, h.n / 10) * 0.5;
        for (const o of tmpHerds) {
          if (o.id === h.id) continue;
          const osp = sim.species.get(o.sp)!;
          if (osp.diet === 1) continue;
          const sc = 0.55 + (h.speed - o.speed) * 0.5 + h.fierce * 0.2 - Math.max(0, o.size - h.size - 0.05) * 1.6 * pack - o.fierce * 0.3 - (o.n < 8 ? 0.25 : 0);
          if (sc > bestScore) {
            bestScore = sc;
            best = o;
          }
        }
        if (best && rng.chance(clamp01(bestScore))) {
          const osp = sim.species.get(best.sp)!;
          const want = Math.max(1, Math.ceil((h.n * (0.3 + h.size) * 0.2) / (0.2 + best.size)));
          const kills = Math.min(want, Math.ceil(best.n * 0.25));
          best.n -= kills;
          osp.count -= kills;
          h.energy += ((kills * (0.2 + best.size)) / (h.n * (0.3 + h.size))) * 1.4;
          best.energy -= 0.03;
        } else h.energy -= 0.045;
      }
    }
    h.energy = clamp(h.energy, 0, 1);
    // --- births and deaths ---
    const month = Math.floor((sim.tick % TICKS_PER_YEAR) / 4);
    const breeding = meanTemp(w, c, i) > 20 || (month >= 1 && month <= 5);
    if (breeding && h.energy > 0.55) {
      const exp = h.n * h.fecund * 0.075 * (h.energy - 0.3) * sim.params.wildlife;
      h.n += Math.floor(exp) + (rng.chance(exp % 1) ? 1 : 0);
    }
    if (h.energy < 0.22) h.n -= Math.max(1, Math.ceil(h.n * 0.1));
    {
      const exp = h.n * (sp.diet === 1 ? 0.005 : 0.008) * (1.2 - h.size * 0.9) * (1 + stress * 0.1);
      h.n -= Math.floor(exp) + (rng.chance(exp % 1) ? 1 : 0);
    }
    if (h.n <= 0) {
      sp.count += -before;
      dead.push(h.id);
      continue;
    }
    // --- split big herds; offspring herds carry mutated genes ---
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
        nh.size = clamp(h.size + rng.gauss() * 0.02 * mut, 0.05, 1);
        nh.speed = clamp(h.speed + rng.gauss() * 0.02 * mut, 0.1, 1);
        nh.cold = clamp(h.cold + rng.gauss() * 0.75 * mut, -25, 34);
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
    // --- movement: seek food and comfortable temperature; flee towns ---
    if (rng.chance(0.2) || (Math.abs(h.x - h.tx) < 1 && Math.abs(h.y - h.ty) < 1)) {
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
          if (sim.species.get(o.sp)!.diet === 1) continue;
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
    const dx = h.tx - h.x,
      dy = h.ty - h.y;
    const dl = Math.hypot(dx, dy);
    if (dl > 0.01) {
      const step = Math.min(dl, 0.6 + h.speed * 1.6);
      const nx = h.x + (dx / dl) * step,
        ny = h.y + (dy / dl) * step;
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
    const sp = sim.species.get(h.sp)!;
    checkExtinction(sim, sp);
  }
}

/** authoritative recount of animals per species (fixes any drift from incremental bookkeeping) */
export function recountSpecies(sim: Sim): void {
  for (const sp of sim.species.values()) sp.count = 0;
  for (const h of sim.herds.values()) {
    const sp = sim.species.get(h.sp);
    if (sp) sp.count += Math.max(0, h.n);
  }
  // a species wholly replaced by its descendants is gone too, without a last death to mark it
  for (const sp of sim.species.values()) if (sp.count === 0 && sp.extinct < 0 && sim.tick - sp.born > 48) sp.extinct = sim.tick;
}

export function checkExtinction(sim: Sim, sp: Species): void {
  if (sp.extinct >= 0) return;
  for (const h of sim.herds.values()) if (h.sp === sp.id && h.n > 0) return;
  sp.extinct = sim.tick;
  sp.count = 0;
  addEvent(sim, 'extinct', 3, `The last ${sp.name} has died. The species is extinct.`, [], [], -1, -1, -1);
}

/** when a lineage drifts far enough from its species' type, it is a new species */
function maybeSpeciate(sim: Sim, h: Herd): void {
  const sp = sim.species.get(h.sp)!;
  const d = Math.abs(h.cold - sp.cold) / 7 + Math.abs(h.size - sp.size) / 0.22 + Math.abs(h.speed - sp.speed) / 0.25 + Math.abs(h.fierce - sp.fierce) / 0.3;
  if (d < 2) return;
  let live = 0;
  for (const s of sim.species.values()) if (s.extinct < 0) live++;
  if (live > 40) return;
  const shape = sp.shape === 3 && h.size < 0.7 ? 0 : sp.shape === 0 && h.size > 0.88 ? 3 : sp.shape;
  const nsp = createSpecies(sim, { parent: sp.id, diet: sp.diet, size: h.size, speed: h.speed, cold: h.cold, fecund: h.fecund, fierce: h.fierce, herd: sp.herd, shape });
  // nearby kin that are closer to the new type join the new species
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
  const what = h.cold < sp.cold - 3 ? 'cold-hardy' : h.cold > sp.cold + 3 ? 'heat-loving' : h.size > sp.size + 0.08 ? 'larger' : h.size < sp.size - 0.08 ? 'smaller' : h.speed > sp.speed ? 'swifter' : 'distinct';
  addEvent(sim, 'species', 2, `A ${what} lineage of ${sp.name} has become a new species: the ${nsp.name}.`, [], [], -1, Math.round(h.x), Math.round(h.y));
}

/** deterministic pseudo-random per tile, handy for scattering */
export function tileRand(sim: Sim, i: number, salt: number): number {
  return hash2(i % sim.world.w, (i / sim.world.w) | 0, sim.world.seed + salt);
}
export { W_OCEAN };
