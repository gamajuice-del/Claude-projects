// The simulation root: creation, the deterministic tick, and seeding of the first peoples.
import { RNG, clamp } from './rng';
import { Civ, Params, Person, Runtime, Sim, TICKS_PER_YEAR, TITLE, W_LAND, World } from './types';
import { WorldOpts, generateWorld } from './worldgen';
import { MOUNTAIN, SEA, dist, reclassifyAll } from './world';
import { initClimate, updateClimate } from './climate';
import { recountSpecies, seedWildlife, updateEcology } from './ecology';
import { addEvent, newStats, sampleStats } from './history';
import { createCulture, countFollowers } from './culture';
import { createCiv, civSeasonal, learnTech, processPending } from './civ';
import { addFame, createPerson, pruneGraves, fullName } from './people';
import { foundSettlement, settlementMonthly } from './settlement';
import { siteScore, updateParties } from './parties';
import { discoverRoutes } from './trade';
import { updateArmies } from './war';
import { naturalDisasters } from './powers';
import { TECHS, TECH_PRE } from './tech';

export const SIM_VERSION = 1;

export interface SimOpts extends WorldOpts {
  tribes: number;
  popCap: number;
}

export function defaultParams(popCap: number): Params {
  return { birthRate: 1, mortality: 1, aggression: 1, research: 1, disasters: 1, climateVolatility: 1, wildlife: 1, growth: 1, popCap, tradeZeal: 1, unrest: 1 };
}

export function newRuntime(w: World): Runtime {
  return {
    dirty: [], allDirty: true, borderDirty: true, herdGrid: new Map(), fx: [],
    pathStamp: new Int32Array(w.n), pathG: new Float32Array(w.n), pathFrom: new Int32Array(w.n), pathGen: 0,
    tileCivCache: null, pending: [], terrainPending: false,
  };
}

export function createSim(opts: SimOpts): Sim {
  const world = generateWorld(opts);
  const sim: Sim = {
    version: SIM_VERSION, tick: 0, rng: new RNG(opts.seed * 7919 + 17), world, climate: initClimate(opts.seed), params: defaultParams(opts.popCap),
    nextId: 1, people: new Map(), graves: new Map(), families: new Map(), settlements: new Map(), civs: new Map(), wars: new Map(),
    armies: new Map(), parties: new Map(), routes: new Map(), routeIndex: new Map(), species: new Map(), herds: new Map(), storms: [],
    fires: [], cultures: new Map(), religions: new Map(), languages: new Map(), ruins: [], history: [], stats: newStats(), vegCursor: 0,
    usedNames: new Map(), totalBorn: 0, totalDied: 0, rt: newRuntime(world),
  };
  reclassifyAll(sim);
  seedWildlife(sim);
  seedTribes(sim, opts.tribes);
  addEvent(sim, 'genesis', 5, `In the beginning there was the land and the sea. ${sim.civs.size} small bands of people wander it.`, [], [], -1, -1, -1);
  sampleStats(sim);
  return sim;
}

/** place the founding bands on the best ground, well apart */
export function seedTribes(sim: Sim, n: number): void {
  const w = sim.world;
  const rng = sim.rng;
  const cands: { i: number; sc: number }[] = [];
  for (let t = 0; t < 2500; t++) {
    const i = rng.int(w.n);
    if (w.water[i] !== W_LAND) continue;
    const sc = siteScore(sim, i, undefined);
    if (sc > 5) cands.push({ i, sc: sc + rng.next() * 3 });
  }
  cands.sort((a, b) => b.sc - a.sc || a.i - b.i);
  const chosen: number[] = [];
  let minD = Math.max(14, Math.sqrt((w.w * w.h) / (n + 1)) * 0.55);
  for (let pass = 0; pass < 4 && chosen.length < n; pass++) {
    for (const c of cands) {
      if (chosen.length >= n) break;
      const x = c.i % w.w,
        y = (c.i / w.w) | 0;
      let ok = true;
      for (const o of chosen) if (dist(x, y, o % w.w, (o / w.w) | 0) < minD) ok = false;
      if (ok) chosen.push(c.i);
    }
    minD *= 0.7;
  }
  for (const i of chosen) spawnTribe(sim, i % w.w, (i / w.w) | 0, 26 + rng.int(10));
}

/** a new band of people with its own tongue and customs */
export function spawnTribe(sim: Sim, x: number, y: number, count: number, cultureId?: number): Civ | null {
  const w = sim.world;
  if (x < 1 || y < 1 || x >= w.w - 1 || y >= w.h - 1) return null;
  const tile = y * w.w + x;
  if (w.water[tile] !== W_LAND || w.owner[tile] >= 0 || w.elev[tile] - w.seaLevel + SEA > MOUNTAIN) return null;
  const rng = sim.rng;
  const cul = cultureId !== undefined && sim.cultures.has(cultureId) ? sim.cultures.get(cultureId)! : createCulture(sim);
  const civ = createCiv(sim, { culture: cul.id, religion: -1, parent: -1 });
  const people: Person[] = [];
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
  addEvent(sim, 'found', 2, `The ${civ.name}, a band of ${people.length} led by ${fullName(sim, leader)}, made camp at ${s.name}.`, [civ.id], [leader.id], s.id, x, y);
  return civ;
}

/** ruins inside a civ's borders may teach what their builders knew */
function studyRuins(sim: Sim): void {
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
        learnTech(sim, civ, t, 'ruin');
        return;
      }
    }
  }
}

/** advance the world by one tick (a quarter of a month). Fully deterministic given seed and inputs. */
export function tick(sim: Sim): void {
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
