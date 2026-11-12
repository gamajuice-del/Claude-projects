// Groups on the move: migrants, refugees, settlers and trade caravans/ships. They physically cross the map.
import { clamp, clamp01 } from './rng';
import { addEvent, remember } from './history';
import { ageOf, addFame, fullName, killPerson, leaveHome, rehome } from './people';
import { I_URBAN, M, PARTY, Party, Person, Settlement, Sim, Civ, W_LAND, TK_UNUSED, ADULT_AGE } from './types';
import { MOUNTAIN, SEA, forDisc, hasFreshWater, meanTemp } from './world';
import { findPath, findPortTile, landStepCost, landingNear } from './path';
import { foundSettlement, startPlague } from './settlement';
import { caravanArrived } from './trade';
import { createCiv, relationOf } from './civ';
import { TK } from './tech';

export function createParty(sim: Sim, kind: number, civ: number, path: number[], from: number, to: number): Party {
  const w = sim.world;
  const p0 = path[0];
  const last = path[path.length - 1];
  const p: Party = {
    id: sim.nextId++, kind, civ, x: p0 % w.w, y: (p0 / w.w) | 0, path, pi: 0, from, to,
    tx: last % w.w, ty: (last / w.w) | 0, people: [], good: -1, qty: 0, paid: 0, owner: -1, sea: false, returning: false,
    plague: false, route: -1, acc: 0,
  };
  sim.parties.set(p.id, p);
  return p;
}

/** land path, or land–sea–land if the travellers can sail */
export function travelPath(sim: Sim, from: number, to: number, seaCap: boolean, portTile: number): number[] | null {
  const w = sim.world;
  if (w.landmass[from] === w.landmass[to]) {
    const p = findPath(sim, from, to, false, 12000);
    if (p) return p;
  }
  if (!seaCap || portTile < 0) return null;
  const tx = to % w.w,
    ty = (to / w.w) | 0;
  const dest = findPortTile(sim, tx, ty, 6);
  if (dest < 0) return null;
  const seaPath = findPath(sim, portTile, dest, true, 40000);
  if (!seaPath) return null;
  const land = landingNear(sim, dest);
  let tail: number[] | null = [to];
  if (land >= 0 && land !== to) tail = findPath(sim, land, to, false, 4000);
  if (!tail) return null;
  return [from].concat(seaPath, tail);
}

export function sendMigrants(sim: Sim, s: Settlement, destId: number, group: Person[], fleeing: boolean): void {
  const dest = sim.settlements.get(destId);
  if (!dest) return;
  const key = s.id < destId ? `${s.id}-${destId}` : `${destId}-${s.id}`;
  const rid = sim.routeIndex.get(key);
  const r = rid !== undefined ? sim.routes.get(rid) : undefined;
  let path: number[] | null = null;
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

/** how good is this spot to live on, for these people? */
export function siteScore(sim: Sim, i: number, civ: Civ | undefined): number {
  const w = sim.world;
  if (w.water[i] !== W_LAND || w.owner[i] >= 0 || w.elev[i] - w.seaLevel + SEA > MOUNTAIN - 0.03) return -1;
  const x = i % w.w,
    y = (i / w.w) | 0;
  const farms = !civ || civ.tech[TK.agriculture] === 1;
  const fishes = !civ || civ.tech[TK.fishing] === 1;
  let sc = 0, crowded = false;
  forDisc(w, x, y, 5, (j, d) => {
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

export function findSite(sim: Sim, cx: number, cy: number, minD: number, maxD: number, civ: Civ | undefined, sameLand: boolean, tries = 45): { tile: number; score: number } {
  const w = sim.world;
  const rng = sim.rng;
  const lm = w.landmass[clamp(cy, 0, w.h - 1) * w.w + clamp(cx, 0, w.w - 1)];
  let best = -1, bs = 4.5;
  for (let t = 0; t < tries; t++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(minD, maxD);
    const x = Math.round(cx + Math.cos(a) * d),
      y = Math.round(cy + Math.sin(a) * d);
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

/** families who walk out to found their own village — loyal to the old realm only if it can still reach them */
export function sendPioneers(sim: Sim, s: Settlement, civ: Civ, group: Person[]): void {
  const site = findSite(sim, s.x, s.y, 6, 16, civ, true);
  if (site.tile < 0) return;
  const path = findPath(sim, s.tile, site.tile, false, 8000);
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
  party.owner = civ.id; // remember the mother realm
  for (const p of group) {
    leaveHome(sim, p);
    p.party = party.id;
    party.people.push(p.id);
  }
  // they carry provisions out of the stores
  const take = Math.min(s.stock[0] * 0.2, group.length * 4);
  s.stock[0] -= take;
  party.qty = take;
}

/** state-organised colony */
export function sendSettlers(sim: Sim, s: Settlement, civ: Civ, group: Person[], site: number): boolean {
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

export function updateParties(sim: Sim): void {
  const w = sim.world;
  const monthly = sim.tick % 4 === 0;
  for (const p of sim.parties.values()) {
    // --- move along the path ---
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
      p.y = (i / w.w) | 0;
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

function roadHardship(sim: Sim, p: Party): void {
  const rng = sim.rng;
  const hungry = p.qty <= 0;
  if (!hungry) p.qty = Math.max(0, p.qty - p.people.length * 0.9);
  for (const id of p.people.slice()) {
    const q = sim.people.get(id);
    if (!q) continue;
    if (hungry) q.fed = Math.max(0.3, q.fed - 0.05);
    if (rng.chance(hungry ? 0.012 : 0.003)) killPerson(sim, q, 'the hardships of the road');
  }
  if (p.people.length === 0) sim.parties.delete(p.id);
}

/** returns true if the caravan was destroyed */
function caravanHazards(sim: Sim, p: Party): boolean {
  const w = sim.world;
  const i = p.path[Math.min(p.pi, p.path.length - 1)];
  const o = w.owner[i];
  if (o < 0) return false;
  const s = sim.settlements.get(o);
  if (!s || s.civ === p.civ) return false;
  const civ = sim.civs.get(p.civ);
  const rel = civ?.rel.get(s.civ);
  if (rel && rel.war >= 0) {
    // seized by the enemy
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

function arrive(sim: Sim, p: Party): void {
  if (p.kind === PARTY.caravan) {
    caravanArrived(sim, p);
    return;
  }
  const w = sim.world;
  const people: Person[] = [];
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
  // migrants & refugees
  let dest = sim.settlements.get(p.to);
  if (!dest || !dest.alive) dest = nearestSettlement(sim, p.x, p.y, 25) || undefined;
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
    const a = sim.civs.get(p.civ),
      b = sim.civs.get(dest.civ);
    if (a && b) {
      relationOf(sim, a, b.id).contact = true;
      relationOf(sim, b, a.id).contact = true;
    }
  }
  if (people.length >= 12) {
    const kind = p.kind === PARTY.refugees ? 'refugees' : 'migrants';
    const fromName = from ? from.name : 'afar';
    addEvent(sim, 'migration', people.length >= 40 ? 3 : 2, `${people.length} ${kind} from ${fromName} arrived in ${dest.name}.`, foreign ? [p.civ, dest.civ] : [dest.civ], [], dest.id, dest.x, dest.y);
    // a sudden crowd of strangers strains the host
    if (people[0].culture !== dest.cultureMajor) dest.unrest = clamp01(dest.unrest + Math.min(0.2, (people.length / (dest.people.length + 1)) * 0.5));
  }
  if (p.plague && dest.plague === 0 && sim.tick - dest.lastPlague > 480 && sim.rng.chance(0.5)) startPlague(sim, dest);
}

function nearestSettlement(sim: Sim, x: number, y: number, maxD: number): Settlement | null {
  let best: Settlement | null = null,
    bd = maxD * maxD;
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

function settle(sim: Sim, p: Party, people: Person[]): void {
  const w = sim.world;
  let tile = clamp(p.ty, 0, w.h - 1) * w.w + clamp(p.tx, 0, w.w - 1);
  if (p.kind !== PARTY.settlers) tile = clamp(p.y, 0, w.h - 1) * w.w + clamp(p.x, 0, w.w - 1);
  let civ = p.civ >= 0 ? sim.civs.get(p.civ) : undefined;
  if (civ && !civ.alive) civ = undefined;
  // is the spot still free?
  if (siteScore(sim, tile, civ) < 0) {
    const alt = findSite(sim, tile % w.w, (tile / w.w) | 0, 1, 6, civ, true, 30);
    if (alt.tile >= 0) tile = alt.tile;
    else {
      const near = nearestSettlement(sim, p.x, p.y, 30);
      if (near) {
        for (const q of people) rehome(sim, q, near);
        return;
      }
      for (const q of people) killPerson(sim, q, 'exposure in the wilderness');
      return;
    }
  }
  const x = tile % w.w,
    y = (tile / w.w) | 0;
  // pick a leader: the boldest, most charismatic adult
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
    // an independent band: a new people begins here
    const mother = sim.civs.get(p.owner);
    civ = createCiv(sim, { culture: leader.culture, religion: leader.religion, parent: mother ? mother.id : -1, inherit: mother });
    const s = foundSettlement(sim, civ.id, x, y, people);
    s.stock[0] += p.qty;
    civ.capital = s.id;
    civ.ruler = leader.id;
    leader.title = 1;
    addFame(sim, leader, 5);
    remember(leader, sim.tick, M.founded, s.id);
    addEvent(sim, 'found', 3, `${fullName(sim, leader)} led ${people.length} followers out of ${from ? from.name : 'the old country'} and founded ${s.name}. They call themselves the ${civ.name}.`, mother ? [civ.id, mother.id] : [civ.id], [leader.id], s.id, x, y);
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
  addEvent(sim, 'found', 2, `Settlers from ${from ? from.name : 'the homeland'} founded ${s.name} for the ${civ.name}.`, [civ.id], [leader.id], s.id, x, y);
}
export { TK_UNUSED };
