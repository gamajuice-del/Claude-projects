// Global climate (cycles, drift, greenhouse, dust), sea level, and moving weather systems.
import { clamp, clamp01 } from './rng';
import { addEvent } from './history';
import { Climate, I_NONE, I_URBAN, Sim, Storm, TICKS_PER_MONTH, TICKS_PER_YEAR, W_LAND, W_OCEAN } from './types';
import { SEA, forDisc, latOf, markDirty, recomputeCoast, recomputeHydrology, recomputeWater, tempAt } from './world';

export function initClimate(seed: number): Climate {
  const f = (k: number) => (((Math.imul(seed + k * 7919, 2654435761) >>> 0) % 1000) / 1000) * Math.PI * 2;
  return { tempOffset: 0, drift: 0, rainMult: 1, co2: 0, dust: 0, godTemp: 0, godRain: 1, seaBase: SEA, phases: [f(1), f(2), f(3)] };
}

export function updateClimate(sim: Sim): void {
  const c = sim.climate;
  const t = sim.tick;
  if (t % TICKS_PER_MONTH === 0) {
    const yr = t / TICKS_PER_YEAR;
    const vol = sim.params.climateVolatility;
    const cyc = (0.9 * Math.sin((2 * Math.PI * yr) / 230 + c.phases[0]) + 0.55 * Math.sin((2 * Math.PI * yr) / 71 + c.phases[1]) + 0.3 * Math.sin((2 * Math.PI * yr) / 23 + c.phases[2])) * vol;
    const greenhouse = 2.4 * Math.log2(1 + c.co2 / 300);
    c.tempOffset = c.godTemp + c.drift + cyc + greenhouse - c.dust * 5;
    c.rainMult = c.godRain * (1 + 0.04 * (c.tempOffset - c.godTemp)) * (1 - c.dust * 0.3);
    c.dust *= 0.975;
    if (c.dust < 0.001) c.dust = 0;
  }
  if (t % TICKS_PER_YEAR === 0) {
    c.drift = clamp(c.drift * 0.985 + sim.rng.gauss() * 0.07 * sim.params.climateVolatility, -3, 3);
    c.co2 *= 0.994; // slow natural drawdown
    updateSeaLevel(sim);
  }
  updateStorms(sim);
}

/** ice ages lock water in glaciers; warm ages drown the coasts */
export function updateSeaLevel(sim: Sim, force = false): void {
  const w = sim.world;
  const target = clamp(sim.climate.seaBase + 0.0035 * sim.climate.tempOffset, 0.3, 0.55);
  if (!force && Math.abs(target - w.seaLevel) < 0.0025) return;
  const rising = target > w.seaLevel;
  w.seaLevel = target;
  applyWaterChange(sim);
  if (sim.tick > 0) {
    addEvent(sim, 'climate', 3, rising ? 'The seas are rising. Low coasts slip beneath the waves.' : 'The seas are retreating, baring new shores.', [], [], -1, -1, -1);
  }
}

/** recompute water after elevation / sea level changes and clean up drowned tiles */
export function applyWaterChange(sim: Sim): void {
  const w = sim.world;
  const before = Uint8Array.from(w.water);
  recomputeWater(w);
  recomputeCoast(w);
  recomputeHydrology(w, false);
  for (let i = 0; i < w.n; i++) {
    if (before[i] === w.water[i]) continue;
    if (w.water[i] !== W_LAND) {
      // drowned
      w.forest[i] = 0;
      w.veg[i] = 0.3;
      w.fire[i] = 0;
      w.road[i] = 0;
      w.res[i] = 0;
      w.resAmt[i] = 0;
      if (w.imp[i] !== I_NONE) drownImprovement(sim, i);
    } else {
      // newly exposed seabed
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

function drownImprovement(sim: Sim, i: number): void {
  const w = sim.world;
  const sid = w.owner[i];
  const s = sid >= 0 ? sim.settlements.get(sid) : undefined;
  if (s) {
    const rm = (arr: number[]) => {
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

function updateStorms(sim: Sim): void {
  const w = sim.world;
  const rng = sim.rng;
  const scale = (w.w * w.h) / (256 * 160);
  // spawn
  if (sim.storms.length < 7 * scale && rng.chance(0.03 * scale * clamp(sim.climate.rainMult, 0.2, 2.5))) {
    const x = rng.int(w.w),
      y = rng.int(w.h);
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
    const xi = Math.round(s.x),
      yi = Math.round(s.y);
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
        // hurricanes shred canopy and batter towns
        if (w.forest[i] > 0.2 && rng.chance(0.04)) w.forest[i] *= 0.85;
        if (w.imp[i] === I_URBAN && rng.chance(0.03)) {
          const st = sim.settlements.get(w.owner[i]);
          if (st) st.damage = clamp01(st.damage + 0.02 * s.power);
        }
      }
    });
    if (s.kind === 1 && overLand && rng.chance(0.06)) {
      // lightning
      const lx = clamp(Math.round(s.x + (rng.next() - 0.5) * s.r * 1.6), 0, w.w - 1);
      const ly = clamp(Math.round(s.y + (rng.next() - 0.5) * s.r * 1.6), 0, w.h - 1);
      const li = ly * w.w + lx;
      sim.rt.fx.push({ kind: 'bolt', x: lx, y: ly, r: 1, t: sim.tick });
      if (w.water[li] === W_LAND && w.moist[li] < 0.42 && (w.forest[li] > 0.25 || w.veg[li] > 0.5) && rng.chance(0.3)) ignite(sim, li);
    }
  }
}

export function spawnStorm(sim: Sim, kind: number, x: number, y: number, power = 1): Storm {
  const rng = sim.rng;
  const s: Storm = {
    id: sim.nextId++, kind, x, y,
    r: kind === 3 ? 9 + rng.int(4) : 4 + rng.int(5),
    vx: 0, vy: 0, power,
    life: kind === 3 ? 110 + rng.int(80) : 70 + rng.int(120),
  };
  sim.storms.push(s);
  return s;
}

export function ignite(sim: Sim, i: number): void {
  const w = sim.world;
  if (w.water[i] !== W_LAND || w.fire[i] > 0) return;
  w.fire[i] = 4 + sim.rng.int(4);
  sim.fires.push(i);
  markDirty(sim, i);
}

export function latitudeLabel(sim: Sim, y: number): string {
  const lat = latOf(sim.world, y * sim.world.w);
  return lat > 0.78 ? 'polar' : lat > 0.55 ? 'boreal' : lat > 0.33 ? 'temperate' : lat > 0.18 ? 'subtropical' : 'tropical';
}
export { clamp01 };
