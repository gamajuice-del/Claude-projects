// God powers. Each one edits real simulation state (terrain, climate parameters, creatures, people,
// polities); consequences then play out through the ordinary rules. Natural disasters reuse the same code.
import { clamp, clamp01 } from './rng';
import { addEvent, remember } from './history';
import { addFame, fullName, killPerson } from './people';
import { Civ, G, GOV, I_NONE, I_URBAN, M, Person, R_NONE, Settlement, Sim, Species, TICKS_PER_YEAR, TITLE, W_LAKE, W_LAND } from './types';
import { MOUNTAIN, PEAK, SEA, dist, forDisc, markDirty } from './world';
import { applyWaterChange, ignite, spawnStorm } from './climate';
import { checkExtinction, createSpecies, floodAt, herdsNear, spawnHerd } from './ecology';
import { abandonSettlement, startPlague } from './settlement';
import { install, learnTech, relationOf, startRebellion } from './civ';
import { declareWar, endWar } from './diplomacy';
import { recomputeMods } from './tech';

function divineAwe(sim: Sim, x: number, y: number, r: number, wrath: boolean, what: string): void {
  // people who witness the hand of a god do not forget it
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

// ---------------------------------------------------------------- terrain

export function sculpt(sim: Sim, cx: number, cy: number, r: number, amount: number): void {
  const w = sim.world;
  forDisc(w, cx, cy, r, (i, d) => {
    const f = 1 - (d / (r + 0.5)) * (d / (r + 0.5));
    w.elev[i] = clamp(w.elev[i] + amount * f, 0.02, 0.99);
    if (amount > 0 && w.water[i] === W_LAKE && w.elev[i] >= w.seaLevel) w.water[i] = W_LAND;
    markDirty(sim, i);
  });
  sim.rt.terrainPending = true;
}

export function smooth(sim: Sim, cx: number, cy: number, r: number): void {
  const w = sim.world;
  let sum = 0, n = 0;
  forDisc(w, cx, cy, r, (i) => {
    sum += w.elev[i];
    n++;
  });
  const avg = sum / (n || 1);
  forDisc(w, cx, cy, r, (i) => {
    w.elev[i] += (avg - w.elev[i]) * 0.25;
    markDirty(sim, i);
  });
  sim.rt.terrainPending = true;
}

export function digWater(sim: Sim, cx: number, cy: number, r: number): void {
  const w = sim.world;
  forDisc(w, cx, cy, r, (i) => {
    w.elev[i] = Math.min(w.elev[i], w.seaLevel - 0.02);
    markDirty(sim, i);
  });
  sim.rt.terrainPending = true;
}

/** call after sculpting (the UI debounces this): oceans, lakes, rivers, coasts are recomputed */
export function commitTerrain(sim: Sim): void {
  if (!sim.rt.terrainPending) return;
  sim.rt.terrainPending = false;
  applyWaterChange(sim);
  // towns whose heart is now under water are lost
  for (const s of Array.from(sim.settlements.values())) {
    if (s.alive && sim.world.water[s.tile] !== W_LAND) {
      addEvent(sim, 'flood', 3, `${s.name} was swallowed by the waters.`, [s.civ], [], s.id, s.x, s.y);
      abandonSettlement(sim, s, 'drowned beneath the waves');
    }
  }
}

export type BiomeBrush = 'forest' | 'grass' | 'desert' | 'swamp' | 'fertile' | 'cold' | 'hot' | 'barren';

/** biome painting changes the tile's underlying climate and soil, so the biome persists */
export function paintBiome(sim: Sim, cx: number, cy: number, r: number, kind: BiomeBrush): void {
  const w = sim.world;
  forDisc(w, cx, cy, r, (i) => {
    if (w.water[i] !== W_LAND) return;
    switch (kind) {
      case 'forest':
        w.rain[i] = Math.max(w.rain[i], 0.6);
        w.moist[i] = Math.max(w.moist[i], 0.6);
        w.fert[i] = Math.max(w.fert[i], 0.55);
        if (w.imp[i] === I_NONE) w.forest[i] = Math.min(1, w.forest[i] + 0.5);
        w.flora[i] = Math.round(clamp(w.temp[i] + sim.climate.tempOffset + 5, 4, 30));
        break;
      case 'grass':
        w.rain[i] = clamp(w.rain[i], 0.35, 0.5);
        w.moist[i] = clamp(w.moist[i], 0.35, 0.5);
        w.forest[i] *= 0.2;
        w.veg[i] = Math.max(w.veg[i], 0.7);
        w.fert[i] = Math.max(w.fert[i], 0.5);
        w.flora[i] = Math.round(clamp(w.temp[i] + sim.climate.tempOffset + 5, 4, 30));
        break;
      case 'desert':
        w.rain[i] = Math.min(w.rain[i], 0.08);
        w.moist[i] = 0.04;
        w.forest[i] = 0;
        w.veg[i] = 0.02;
        w.fert[i] = Math.min(w.fert[i], 0.12);
        break;
      case 'swamp':
        w.rain[i] = Math.max(w.rain[i], 0.92);
        w.moist[i] = 1;
        w.elev[i] = Math.min(w.elev[i], w.seaLevel + 0.02);
        if (w.imp[i] === I_NONE) w.forest[i] = Math.max(w.forest[i], 0.6);
        w.fert[i] = Math.max(w.fert[i], 0.6);
        break;
      case 'fertile':
        w.fert[i] = 1;
        w.moist[i] = Math.max(w.moist[i], 0.5);
        w.rain[i] = Math.max(w.rain[i], 0.4);
        break;
      case 'cold':
        w.temp[i] -= 6;
        break;
      case 'hot':
        w.temp[i] += 6;
        break;
      case 'barren':
        w.forest[i] = 0;
        w.veg[i] = 0;
        w.fert[i] = 0.05;
        break;
    }
    markDirty(sim, i);
  });
  if (kind === 'swamp') sim.rt.terrainPending = true;
}

export function placeResource(sim: Sim, cx: number, cy: number, r: number, res: number): void {
  const w = sim.world;
  forDisc(w, cx, cy, Math.max(0.5, r * 0.6), (i) => {
    if (w.water[i] !== W_LAND || w.imp[i] === I_URBAN) return;
    w.res[i] = res;
    w.resAmt[i] = res === R_NONE ? 0 : 16000;
    markDirty(sim, i);
  });
}

// ---------------------------------------------------------------- weather

export function rain(sim: Sim, cx: number, cy: number, r: number): void {
  const w = sim.world;
  forDisc(w, cx, cy, r, (i) => {
    if (w.water[i] !== W_LAND) return;
    w.moist[i] = Math.min(1, w.moist[i] + 0.35);
    w.rain[i] = Math.min(1, w.rain[i] + 0.01);
    if (w.fire[i] > 0) w.fire[i] = 1;
  });
  sim.rt.fx.push({ kind: 'rain', x: cx, y: cy, r, t: sim.tick });
}

export function drought(sim: Sim, cx: number, cy: number, r: number): void {
  const w = sim.world;
  forDisc(w, cx, cy, r, (i) => {
    if (w.water[i] !== W_LAND) return;
    w.moist[i] *= 0.3;
    w.veg[i] *= 0.6;
    w.rain[i] = Math.max(0.02, w.rain[i] - 0.015);
    markDirty(sim, i);
  });
  sim.rt.fx.push({ kind: 'heat', x: cx, y: cy, r, t: sim.tick });
}

export function lightning(sim: Sim, x: number, y: number): void {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return;
  const i = y * w.w + x;
  sim.rt.fx.push({ kind: 'bolt', x, y, r: 2, t: sim.tick });
  if (w.water[i] === W_LAND && (w.forest[i] > 0.1 || w.veg[i] > 0.25 || w.imp[i] === I_URBAN)) ignite(sim, i);
  const s = w.owner[i] >= 0 ? sim.settlements.get(w.owner[i]) : undefined;
  if (s && w.imp[i] === I_URBAN) {
    s.damage = clamp01(s.damage + 0.05);
    divineAwe(sim, x, y, 3, true, 'the lightning from a clear sky');
  }
  // armies and herds beneath the bolt
  for (const a of sim.armies.values()) {
    if (dist(a.x, a.y, x, y) < 1.5 && a.soldiers.length) {
      const p = sim.people.get(a.soldiers[sim.rng.int(a.soldiers.length)]);
      if (p) killPerson(sim, p, 'a bolt of lightning');
      a.morale = clamp01(a.morale - 0.2);
    }
  }
}

export function fire(sim: Sim, cx: number, cy: number, r: number): void {
  forDisc(sim.world, cx, cy, Math.max(0.5, r * 0.5), (i) => ignite(sim, i));
}

export function storm(sim: Sim, x: number, y: number, kind: number): void {
  const s = spawnStorm(sim, kind, x, y, 1.4);
  s.life = 160;
}

// ---------------------------------------------------------------- catastrophes

function harmSettlements(sim: Sim, x: number, y: number, r: number, dmg: number, killFrac: number, cause: string): number {
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

function harmHerds(sim: Sim, x: number, y: number, r: number, frac: number): void {
  const out: import('./types').Herd[] = [];
  herdsNear(sim, x, y, r, out);
  for (const h of out) {
    const sp = sim.species.get(h.sp)!;
    const k = Math.ceil(h.n * frac);
    h.n -= k;
    sp.count -= k;
    if (h.n <= 0) {
      sim.herds.delete(h.id);
      checkExtinction(sim, sp);
    }
  }
}

export function meteor(sim: Sim, x: number, y: number, r: number, natural = false): void {
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
      w.elev[i] = clamp(w.elev[i] + 0.025, 0.05, 0.99); // rim
      if (w.water[i] === W_LAND && sim.rng.chance(0.6)) ignite(sim, i);
    }
    markDirty(sim, i);
  });
  const dead = harmSettlements(sim, x, y, r * 1.6, 0.8, 0.5, 'the falling star');
  harmHerds(sim, x, y, r * 2, 0.8);
  sim.climate.dust = Math.min(1, sim.climate.dust + 0.05 * r);
  sim.rt.fx.push({ kind: 'meteor', x, y, r, t: sim.tick });
  sim.rt.terrainPending = true;
  commitTerrain(sim);
  addEvent(sim, 'meteor', 4, `A star fell from the sky${dead > 0 ? `, killing ${dead}` : ''}. Dust dims the sun; the seasons that follow will be cold.`, [], [], -1, x, y);
  divineAwe(sim, x, y, r * 4, true, natural ? 'the falling star' : 'the sky-fire');
}

export function erupt(sim: Sim, x: number, y: number, natural = false): void {
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
    w.fert[i] = Math.min(1, w.fert[i] + 0.3); // volcanic soil, in time
    if (w.imp[i] !== I_URBAN) w.imp[i] = I_NONE;
    markDirty(sim, i);
  });
  forDisc(w, x, y, r + 4, (i, d) => {
    if (d > r && w.water[i] === W_LAND && sim.rng.chance(0.45)) ignite(sim, i);
  });
  if (w.volcanoes.indexOf(idx) < 0) w.volcanoes.push(idx);
  const dead = harmSettlements(sim, x, y, r + 5, 0.6, 0.3, 'the eruption');
  harmHerds(sim, x, y, r + 5, 0.6);
  sim.climate.dust = Math.min(1, sim.climate.dust + 0.22);
  sim.rt.fx.push({ kind: 'erupt', x, y, r: r + 4, t: sim.tick });
  sim.rt.terrainPending = true;
  commitTerrain(sim);
  addEvent(sim, 'volcano', 4, `A volcano erupted${dead > 0 ? `, burying ${dead} people in ash` : ''}. Ash veils the sun across the world.`, [], [], -1, x, y);
  divineAwe(sim, x, y, 22, true, natural ? 'the burning mountain' : 'the mountain of fire');
}

export function quake(sim: Sim, x: number, y: number, r: number, natural = false): void {
  const dead = harmSettlements(sim, x, y, r, 0.45, 0.06, 'the earthquake');
  sim.rt.fx.push({ kind: 'quake', x, y, r, t: sim.tick });
  let named = '';
  for (const s of sim.settlements.values()) if (s.alive && dist(s.x, s.y, x, y) < r) named = named || s.name;
  if (named || !natural) addEvent(sim, 'quake', dead > 20 ? 3 : 2, `The earth shook${named ? ' at ' + named : ''}${dead ? `; ${dead} died under falling roofs` : ''}.`, [], [], -1, x, y);
  if (named) divineAwe(sim, x, y, r, true, 'the great earthquake');
}

export function tsunami(sim: Sim, x: number, y: number, r: number): void {
  const w = sim.world;
  forDisc(w, x, y, r, (i) => {
    if (w.water[i] !== W_LAND || w.elev[i] > w.seaLevel + 0.035) return;
    w.flood[i] = 6;
    w.forest[i] *= 0.6;
    markDirty(sim, i);
  });
  const dead = harmSettlements(sim, x, y, r, 0.35, 0.12, 'the great wave');
  sim.rt.fx.push({ kind: 'wave', x, y, r, t: sim.tick });
  addEvent(sim, 'flood', 3, `A great wave struck the coast${dead ? `, drowning ${dead}` : ''}.`, [], [], -1, x, y);
  divineAwe(sim, x, y, r, true, 'the great wave');
}

export function riverFlood(sim: Sim, x: number, y: number, r: number): void {
  const w = sim.world;
  forDisc(w, x, y, r, (i) => {
    if (w.water[i] === W_LAND && (w.river[i] > 0 || sim.rng.chance(0.2))) floodAt(sim, i, 2);
  });
}

export function blight(sim: Sim, x: number, y: number, r: number): void {
  const w = sim.world;
  const hit = new Set<number>();
  forDisc(w, x, y, r, (i) => {
    if (w.water[i] !== W_LAND) return;
    w.veg[i] *= 0.15;
    if (w.owner[i] >= 0) hit.add(w.owner[i]);
    markDirty(sim, i);
  });
  for (const sid of hit) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    s.stock[G.food] *= 0.35;
    s.livestock *= 0.5;
    addEvent(sim, 'blight', 2, `Locusts stripped the fields of ${s.name} bare.`, [s.civ], [], s.id, s.x, s.y);
  }
  sim.rt.fx.push({ kind: 'swarm', x, y, r, t: sim.tick });
}

export function plague(sim: Sim, s: Settlement): void {
  s.lastPlague = -99999;
  startPlague(sim, s);
}

// ---------------------------------------------------------------- life

export function mutateArea(sim: Sim, x: number, y: number, r: number): void {
  const rng = sim.rng;
  const out: import('./types').Herd[] = [];
  herdsNear(sim, x, y, r, out);
  for (const h of out) {
    h.size = clamp(h.size + rng.gauss() * 0.15, 0.05, 1);
    h.speed = clamp(h.speed + rng.gauss() * 0.15, 0.1, 1);
    h.cold = clamp(h.cold + rng.gauss() * 6, -25, 34);
    h.fecund = clamp(h.fecund + rng.gauss() * 0.12, 0.1, 1.2);
    h.fierce = clamp(h.fierce + rng.gauss() * 0.15, 0, 1);
    // a strongly changed herd founds a new species at once
    const sp = sim.species.get(h.sp)!;
    const d = Math.abs(h.cold - sp.cold) / 7 + Math.abs(h.size - sp.size) / 0.22 + Math.abs(h.speed - sp.speed) / 0.25;
    if (d > 1.5) {
      const nsp = createSpecies(sim, { parent: sp.id, diet: rng.chance(0.15) ? (sp.diet + 1) % 3 : sp.diet, size: h.size, speed: h.speed, cold: h.cold, fecund: h.fecund, fierce: h.fierce, herd: sp.herd, shape: h.size > 0.85 ? 3 : sp.shape });
      sp.count -= h.n;
      nsp.count += h.n;
      h.sp = nsp.id;
      addEvent(sim, 'species', 2, `Touched by strange forces, a herd of ${sp.name} changed into something new: the ${nsp.name}.`, [], [], -1, Math.round(h.x), Math.round(h.y));
    }
  }
  // people nearby are changed too — for better or worse
  for (const s of sim.settlements.values()) {
    if (!s.alive || dist(s.x, s.y, x, y) > r) continue;
    for (const id of s.people) {
      const p = sim.people.get(id);
      if (!p || !rng.chance(0.3)) continue;
      p.intl = clamp01(p.intl + rng.gauss() * 0.15);
      p.health = clamp01(p.health + rng.gauss() * 0.15);
      p.bold = clamp01(p.bold + rng.gauss() * 0.15);
      p.cha = clamp01(p.cha + rng.gauss() * 0.15);
    }
  }
  sim.rt.fx.push({ kind: 'mutate', x, y, r, t: sim.tick });
}

export function placeHerd(sim: Sim, sp: Species, x: number, y: number): void {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h || w.water[y * w.w + x] !== W_LAND) return;
  if (sp.extinct >= 0) sp.extinct = -1;
  spawnHerd(sim, sp, x, y, Math.max(3, Math.round(sp.herd * 0.7)));
}

export function cullHerds(sim: Sim, x: number, y: number, r: number): void {
  harmHerds(sim, x, y, r, 1);
}

// ---------------------------------------------------------------- blessings & curses

export function blessSettlement(sim: Sim, s: Settlement): void {
  s.stock[G.food] += s.people.length * 8;
  s.damage = 0;
  s.plague = 0;
  s.unrest *= 0.5;
  for (const id of s.people) {
    const p = sim.people.get(id);
    if (!p) continue;
    p.health = Math.min(1, p.health + 0.3);
    p.happy = Math.min(1, p.happy + 0.2);
    p.fed = Math.max(p.fed, 0.9);
    p.sick = 0;
  }
  const w = sim.world;
  for (const i of s.farms) w.fert[i] = Math.min(1, w.fert[i] + 0.3);
  sim.rt.fx.push({ kind: 'bless', x: s.x, y: s.y, r: 4, t: sim.tick });
  addEvent(sim, 'miracle', 2, `A miracle at ${s.name}: the sick rose, and the granaries filled overnight.`, [s.civ], [], s.id, s.x, s.y);
  divineAwe(sim, s.x, s.y, 6, false, 'the miracle');
}

export function curseSettlement(sim: Sim, s: Settlement): void {
  s.unrest = clamp01(s.unrest + 0.45);
  s.rebelHeat += 6;
  s.stock[G.food] *= 0.5;
  for (const id of s.people) {
    const p = sim.people.get(id);
    if (!p) continue;
    p.happy = Math.max(0, p.happy - 0.3);
    p.loyalty = Math.max(0, p.loyalty - 0.25);
  }
  sim.rt.fx.push({ kind: 'curse', x: s.x, y: s.y, r: 4, t: sim.tick });
  addEvent(sim, 'curse', 2, `A curse fell on ${s.name}: grain rotted, tempers frayed, and neighbours turned on one another.`, [s.civ], [], s.id, s.x, s.y);
  divineAwe(sim, s.x, s.y, 6, true, 'the curse');
}

export function blessPerson(sim: Sim, p: Person, gift: 'genius' | 'charisma' | 'vigor' | 'valor'): void {
  if (gift === 'genius') {
    p.intl = 1;
    p.sLore = Math.max(p.sLore, 0.6);
    p.sCraft = Math.max(p.sCraft, 0.5);
  } else if (gift === 'charisma') {
    p.cha = 1;
    p.amb = Math.max(p.amb, 0.8);
    p.sLead = Math.max(p.sLead, 0.5);
  } else if (gift === 'vigor') {
    p.health = 1;
    p.sick = 0;
    p.born += 10 * TICKS_PER_YEAR; // years restored
    if (p.born > sim.tick - 15 * TICKS_PER_YEAR) p.born = Math.min(p.born, sim.tick - 15 * TICKS_PER_YEAR);
  } else {
    p.bold = 1;
    p.sFight = Math.max(p.sFight, 0.8);
    p.sLead = Math.max(p.sLead, 0.6);
  }
  addFame(sim, p, 3);
  remember(p, sim.tick, M.blessed, 0);
  const s = sim.settlements.get(p.home);
  if (s) sim.rt.fx.push({ kind: 'bless', x: s.x, y: s.y, r: 2, t: sim.tick });
  addEvent(sim, 'miracle', 2, `${fullName(sim, p)} was touched by the divine and granted ${gift === 'genius' ? 'a brilliant mind' : gift === 'charisma' ? 'a silver tongue' : gift === 'vigor' ? 'renewed youth' : 'a fearless heart'}.`, [p.civ], [p.id], p.home, s ? s.x : -1, s ? s.y : -1);
}

export function smitePerson(sim: Sim, p: Person): void {
  const s = sim.settlements.get(p.home);
  if (s) sim.rt.fx.push({ kind: 'bolt', x: s.x, y: s.y, r: 2, t: sim.tick });
  addEvent(sim, 'smite', p.title === TITLE.ruler ? 3 : 2, `${fullName(sim, p)} was struck dead by a bolt from a cloudless sky.`, [p.civ], [p.id], p.home, s ? s.x : -1, s ? s.y : -1);
  killPerson(sim, p, 'the wrath of the gods');
  if (s) divineAwe(sim, s.x, s.y, 4, true, 'the smiting');
}

export function cursePerson(sim: Sim, p: Person): void {
  p.health = Math.max(0.1, p.health - 0.5);
  p.sick = 6;
  p.happy = 0;
  remember(p, sim.tick, M.cursed, 0);
}

// ---------------------------------------------------------------- direct interventions in civilizations

export function grantTech(sim: Sim, civ: Civ, tech: number): void {
  learnTech(sim, civ, tech, 'god');
}

export function revokeTech(sim: Sim, civ: Civ, tech: number): void {
  if (civ.tech[tech] !== 1) return;
  civ.tech[tech] = 2;
  recomputeMods(civ);
  sim.rt.allDirty = true;
}

export function forcePeace(sim: Sim, a: Civ, b: Civ): boolean {
  const r = a.rel.get(b.id);
  if (!r || r.war < 0) return false;
  const w = sim.wars.get(r.war);
  if (!w) return false;
  endWar(sim, w, 'a peace imposed from above');
  addEvent(sim, 'peace', 3, `A strange calm ended the ${w.name}: both the ${a.name} and the ${b.name} laid down their arms as if commanded.`, [a.id, b.id], [], -1, -1, -1);
  return true;
}

export function inciteWar(sim: Sim, a: Civ, b: Civ): boolean {
  if (a.id === b.id || !a.alive || !b.alive) return false;
  const r = relationOf(sim, a, b.id);
  if (r.war >= 0) return false;
  r.truceUntil = 0;
  relationOf(sim, b, a.id).truceUntil = 0;
  declareWar(sim, a, b, 'conquest', b.capital);
  return true;
}

export function inciteRevolt(sim: Sim, s: Settlement): void {
  s.unrest = 0.95;
  s.rebelHeat = 14;
  for (const id of s.people) {
    const p = sim.people.get(id);
    if (p) p.loyalty = Math.max(0, p.loyalty - 0.35);
  }
  // if a leader exists among them, the rising begins at once
  const civ = sim.civs.get(s.civ);
  if (!civ) return;
  let leader: Person | null = null, ls = 0;
  for (const id of s.people) {
    const p = sim.people.get(id)!;
    if (p.job === 0 || p.title === TITLE.ruler) continue;
    const sc = p.amb + p.cha + p.bold;
    if (sc > ls) {
      ls = sc;
      leader = p;
    }
  }
  if (leader && civ.settlements.length > 1 && s.id !== civ.capital) startRebellion(sim, civ, s, leader, 1, `Whispers in the night stirred ${s.name} to revolt under ${fullName(sim, leader)}.`);
}

export function giftGold(sim: Sim, civ: Civ, amount: number): void {
  civ.treasury += amount;
}

export function crown(sim: Sim, p: Person): boolean {
  const civ = sim.civs.get(p.civ);
  if (!civ || !civ.alive || p.job === 0) return false;
  install(sim, civ, p, `By unmistakable omens, ${fullName(sim, p)} was raised to rule the ${civ.name}.`, 3);
  civ.legitimacy = 0.8;
  return true;
}

export function setGovernment(sim: Sim, civ: Civ, gov: number): void {
  civ.gov = gov;
  civ.laws.elective = gov !== GOV.monarchy;
  const ruler = sim.people.get(civ.ruler);
  if (gov === GOV.monarchy && ruler) civ.dynasty = ruler.fam;
}

/** yearly roll for the planet's own violence */
export function naturalDisasters(sim: Sim): void {
  const w = sim.world;
  const rng = sim.rng;
  const k = sim.params.disasters;
  if (k <= 0) return;
  for (const v of w.volcanoes) {
    if (rng.chance(0.004 * k)) erupt(sim, v % w.w, (v / w.w) | 0, true);
  }
  if (rng.chance(0.03 * k)) {
    // quakes strike the high country
    for (let t = 0; t < 30; t++) {
      const i = rng.int(w.n);
      if (w.water[i] === W_LAND && w.elev[i] - w.seaLevel + SEA > MOUNTAIN - 0.1) {
        quake(sim, i % w.w, (i / w.w) | 0, 7 + rng.int(6), true);
        break;
      }
    }
  }
  if (rng.chance(0.0006 * k)) {
    const i = rng.int(w.n);
    meteor(sim, i % w.w, (i / w.w) | 0, 3 + rng.int(3), true);
  }
}
export { PEAK };
