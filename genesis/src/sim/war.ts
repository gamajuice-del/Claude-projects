// Warfare: armies are organisations of real people under a general. They need supply, hold or lose
// morale, use terrain, besiege walls, sack or spare towns, and stop when their governments decide the
// price is too high.
import { clamp, clamp01 } from './rng';
import { addEvent, remember } from './history';
import { addFame, ageOf, fullName, killPerson, practice, setJob } from './people';
import { Army, B, Civ, G, GOV, J, M, Person, Settlement, Sim, TICKS_PER_YEAR, TITLE, W_LAND, War } from './types';
import { HILL, SEA, dist, markDirty } from './world';
import { findPath, landStepCost } from './path';
import { sendMigrants, travelPath } from './parties';
import { transferSettlement } from './settlement';
import { absorbCiv, civFullName, install, relationOf, removeCiv } from './civ';
import { addGrievance, endWar, sidesOf, warPotential } from './diplomacy';
import { TK } from './tech';
import { ignite } from './climate';

export function hostile(sim: Sim, a: number, b: number): boolean {
  if (a === b) return false;
  const r = sim.civs.get(a)?.rel.get(b);
  return !!r && r.war >= 0;
}

function armyTile(sim: Sim, a: Army): number {
  const w = sim.world;
  return clamp(Math.round(a.y), 0, w.h - 1) * w.w + clamp(Math.round(a.x), 0, w.w - 1);
}

export function raiseArmy(sim: Sim, civ: Civ, s: Settlement, warId: number): Army | null {
  const troops: Person[] = [];
  const near: Settlement[] = [s];
  for (const sid of civ.settlements) {
    const o = sim.settlements.get(sid);
    if (o && o.id !== s.id && o.siege < 0 && dist(o.x, o.y, s.x, s.y) < 26) near.push(o);
  }
  let adults = 0;
  for (const o of near) {
    let k = 0;
    for (const id of o.people) {
      const p = sim.people.get(id)!;
      if (p.job === J.child) continue;
      adults++;
      if (p.job === J.soldier && p.army < 0 && p.party < 0 && k++ % 4 !== 3) troops.push(p); // every fourth stays as garrison
    }
  }
  // the levy: farmers and craftsmen pulled from their work
  const want = Math.round(adults * civ.soldierTarget);
  if (troops.length < want && (civ.laws.conscription >= 1 || civ.gov <= GOV.chiefdom)) {
    for (const o of near) {
      for (const id of o.people) {
        if (troops.length >= want) break;
        const p = sim.people.get(id)!;
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
  // arm them from the armoury
  const arms = Math.min(troops.length, s.stock[G.weapons]);
  s.stock[G.weapons] -= arms * 0.5;
  const cover = arms / troops.length;
  const equip = 0.7 + 0.3 * cover * Math.max(1, s.weaponQ) + (civ.mods.weaponQ - 1) * 0.25 * cover;
  const rations = Math.min(s.stock[G.food] * 0.3, troops.length * 4);
  s.stock[G.food] -= rations;
  const a: Army = {
    id: sim.nextId++, civ: civ.id, name: '', general: general.id, soldiers: [], x: s.x, y: s.y, path: [], pi: 0, goal: 0, target: -1,
    home: s.id, supply: rations / troops.length, morale: clamp01(0.7 + civ.mods.morale + (sim.cultures.get(civ.culture)!.martial - 0.5) * 0.2),
    atSea: false, fighting: 0, war: warId, raised: sim.tick, kills: 0, losses: 0, wait: 0, foe: -1, bLoss: 0, bStart: 0, bTick: 0,
    moveAcc: 0, equip, n0: troops.length,
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
  a.name = `${['First', 'Second', 'Third', 'Fourth', 'Fifth'][Math.min(4, civ.armies.length)]} ${civ.adj} Host`;
  sim.armies.set(a.id, a);
  civ.armies.push(a.id);
  return a;
}

export function disbandArmy(sim: Sim, a: Army, silent: boolean): void {
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

function armyPower(sim: Sim, a: Army, civ: Civ, defending: boolean): number {
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

function placeName(sim: Sim, x: number, y: number): string {
  let best: Settlement | null = null,
    bd = 14 * 14;
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
  if (w.water[i] !== W_LAND) return 'the open sea';
  if (w.elev[i] - w.seaLevel + SEA > HILL) return 'the high passes';
  if (w.forest[i] > 0.4) return 'the deep woods';
  return 'the borderlands';
}

function killSoldiers(sim: Sim, a: Army, n: number, cause: string): number {
  let dead = 0;
  for (let k = 0; k < n && a.soldiers.length > 0; k++) {
    const idx = sim.rng.int(a.soldiers.length);
    const p = sim.people.get(a.soldiers[idx]);
    if (!p) {
      a.soldiers.splice(idx, 1);
      continue;
    }
    if (p.id === a.general && sim.rng.chance(0.7)) continue; // generals lead from behind, mostly
    killPerson(sim, p, cause);
    dead++;
  }
  a.losses += dead;
  return dead;
}

function warOf(sim: Sim, a: Army, b: Army): War | undefined {
  const r = sim.civs.get(a.civ)?.rel.get(b.civ);
  return r && r.war >= 0 ? sim.wars.get(r.war) : undefined;
}

function sideSign(war: War, civId: number): number {
  return civId === war.att || war.attAllies.indexOf(civId) >= 0 ? 1 : -1;
}

function battleRound(sim: Sim, a: Army, b: Army): void {
  const ca = sim.civs.get(a.civ)!,
    cb = sim.civs.get(b.civ)!;
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
  // whoever stands on their own ground, or stands still, defends
  const ta = armyTile(sim, a),
    tb = armyTile(sim, b);
  const oa = w.owner[ta] >= 0 ? sim.settlements.get(w.owner[ta])?.civ : -1;
  const ob = w.owner[tb] >= 0 ? sim.settlements.get(w.owner[tb])?.civ : -1;
  const aDef = oa === a.civ || (a.path.length === 0 && ob !== b.civ);
  const bDef = !aDef && (ob === b.civ || b.path.length === 0);
  const pa = armyPower(sim, a, ca, aDef),
    pb = armyPower(sim, b, cb, bDef);
  const na = a.soldiers.length,
    nb = b.soldiers.length;
  const scale = Math.min(na, nb) * 0.07 + 0.6;
  const rng = sim.rng;
  const la = scale * (pb / (pa + pb + 1e-6)) * rng.range(0.6, 1.4);
  const lb = scale * (pa / (pa + pb + 1e-6)) * rng.range(0.6, 1.4);
  const da = killSoldiers(sim, a, Math.floor(la) + (rng.chance(la % 1) ? 1 : 0), 'battle');
  const db = killSoldiers(sim, b, Math.floor(lb) + (rng.chance(lb % 1) ? 1 : 0), 'battle');
  a.bLoss += da;
  b.bLoss += db;
  a.kills += db;
  b.kills += da;
  a.morale = clamp01(a.morale - (da / (na + 1)) * 1.6 + (db / (nb + 1)) * 0.5 - 0.004);
  b.morale = clamp01(b.morale - (db / (nb + 1)) * 1.6 + (da / (na + 1)) * 0.5 - 0.004);
  sim.rt.fx.push({ kind: 'clash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: 1.5, t: sim.tick });
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
  // --- the battle is decided ---
  const win = aBreaks && bBreaks ? (pa >= pb ? a : b) : aBreaks ? b : a;
  const lose = win === a ? b : a;
  const wc = win === a ? ca : cb,
    lc = win === a ? cb : ca;
  // pursuit: cavalry cut down the fleeing
  if (lose.soldiers.length > 0) {
    const chase = wc.tech[TK.riding] === 1 ? 0.14 : 0.06;
    const pd = killSoldiers(sim, lose, Math.floor(lose.soldiers.length * chase), 'the rout after battle');
    lose.bLoss += pd;
    win.kills += pd;
    if (war) {
      if (sideSign(war, lose.civ) > 0) war.attLoss += pd;
      else war.defLoss += pd;
    }
  }
  const where = placeName(sim, (a.x + b.x) / 2, (a.y + b.y) / 2);
  const wg = sim.people.get(win.general),
    lg = sim.people.get(lose.general);
  const big = win.bStart + lose.bStart;
  if (big >= 30) {
    const destroyed = lose.soldiers.length === 0;
    addEvent(sim, 'battle', big > 150 ? 3 : 2, `Battle of ${where}: ${wg ? 'General ' + fullName(sim, wg) + ' and ' : ''}the ${wc.name} (${win.bStart} strong) ${destroyed ? 'annihilated' : 'routed'} ${lose.bStart} ${lc.adj} troops${lg && lg.army === lose.id ? ' under ' + fullName(sim, lg) : ''}. ${win.bLoss + lose.bLoss} fell.`, [wc.id, lc.id], wg ? [wg.id] : [], -1, Math.round(win.x), Math.round(win.y));
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
    wg.loyalty = Math.max(0, wg.loyalty - (wg.amb > 0.65 ? 0.05 : -0.03)); // victory feeds ambition
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
  wc.exhaustion = clamp01(wc.exhaustion + (win.bLoss / (wc.pop * 0.05 + 10)) * 0.25);
  lc.exhaustion = clamp01(lc.exhaustion + (lose.bLoss / (lc.pop * 0.05 + 10)) * 0.25 + 0.03);
  lc.legitimacy = Math.max(0, lc.legitimacy - 0.03);
  if (lose.soldiers.length === 0) disbandArmy(sim, lose, true);
  else retreat(sim, lose);
}

function retreat(sim: Sim, a: Army): void {
  const civ = sim.civs.get(a.civ);
  let home = sim.settlements.get(a.home);
  if (!home || !home.alive || home.civ !== a.civ) {
    home = civ ? sim.settlements.get(civ.capital) : undefined;
    if (home) a.home = home.id;
  }
  a.goal = 4;
  a.target = -1;
  a.path = [];
  a.pi = 0;
  for (const s of sim.settlements.values()) if (s.siege === a.id) { s.siege = -1; s.siegeMonths = 0; }
  if (home) setPath(sim, a, home.tile);
}

/** land route, or march to a harbour, sail, and land */
function setPath(sim: Sim, a: Army, toTile: number): boolean {
  const w = sim.world;
  const from = armyTile(sim, a);
  if (from === toTile) {
    a.path = [];
    return true;
  }
  const civ = sim.civs.get(a.civ)!;
  let path: number[] | null = null;
  if (w.water[from] === W_LAND && w.landmass[from] === w.landmass[toTile]) path = findPath(sim, from, toTile, false, w.n);
  if (!path && civ.mods.seaCap > 0) {
    if (w.water[from] !== W_LAND) path = travelPath(sim, from, toTile, true, from);
    else {
      // nearest friendly harbour on this landmass
      let port: Settlement | null = null,
        bd = 1e9;
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
        const leg1 = port.tile === from ? [from] : findPath(sim, from, port.tile, false, w.n);
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

function upkeep(sim: Sim, a: Army, civ: Civ): void {
  const n = a.soldiers.length;
  // supply line: the nearest friendly town within reach feeds the army out of its own granary
  let src: Settlement | null = null,
    bd = civ.mods.supplyRange * (a.atSea ? 0.5 : 1);
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
    // living off the land — badly
    a.morale = clamp01(a.morale - 0.07);
    const lost = killSoldiers(sim, a, Math.ceil(n * 0.035), 'hunger on campaign');
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

function garrisonOf(sim: Sim, s: Settlement): { n: number; power: number; list: Person[] } {
  let n = 0, power = 0;
  const list: Person[] = [];
  for (const id of s.people) {
    const p = sim.people.get(id)!;
    if (p.job === J.soldier && p.army < 0) {
      n++;
      power += 0.5 + p.sFight;
      list.push(p);
    }
  }
  return { n, power, list };
}

function siegeMonthly(sim: Sim, a: Army, civ: Civ, s: Settlement): void {
  const dc = sim.civs.get(s.civ)!;
  const rng = sim.rng;
  if (s.siege < 0) {
    s.siege = a.id;
    s.siegeMonths = 0;
    const gen = sim.people.get(a.general);
    addEvent(sim, 'siege', 2, `${gen ? 'General ' + fullName(sim, gen) : 'An army'} of the ${civ.name} laid siege to ${s.name} with ${a.soldiers.length} troops.`, [civ.id, dc.id], gen ? [gen.id] : [], s.id, s.x, s.y);
  } else if (s.siege !== a.id) {
    // another host already invests the town; join the lines
  }
  s.siegeMonths++;
  s.lastRaid = sim.tick;
  const g = garrisonOf(sim, s);
  let adults = 0;
  for (const id of s.people) if (sim.people.get(id)!.job !== J.child) adults++;
  const militia = adults * 0.22;
  const wallF = 1 + (s.bld[B.walls] * 0.9) / civ.mods.siege;
  const defPower = (g.power * (0.7 + 0.3 * Math.min(1, s.stock[G.weapons] / (g.n + 1)) * s.weaponQ) + militia * 0.45) * wallF * dc.mods.defense * (0.5 + s.fedAvg * 0.5);
  const attPower = armyPower(sim, a, civ, false);
  // raiding the countryside
  const taken = Math.min(s.stock[G.food] * 0.03, a.soldiers.length * 0.3);
  s.stock[G.food] -= taken;
  if (taken > a.soldiers.length * 0.2) a.supply = Math.min(3, a.supply + 0.25);
  if (rng.chance(0.25) && s.farms.length > 0) {
    const f = s.farms[rng.int(s.farms.length)];
    if (sim.world.forest[f] > 0.2 || rng.chance(0.3)) ignite(sim, f);
  }
  const war = sim.wars.get(a.war);
  // hunger opens gates
  if (s.siegeMonths >= 3 && (s.fedAvg < 0.5 || s.stock[G.food] < 1)) {
    capture(sim, a, civ, s, false, war);
    return;
  }
  const odds = attPower / (defPower + 0.5);
  const storm = (odds > 1.5 && s.siegeMonths >= 2) || odds > 4 || (odds > 0.9 && s.siegeMonths > 5 && rng.chance(0.25)) || (a.supply <= 0.5 && odds > 0.75);
  if (storm) {
    const na = a.soldiers.length;
    const la = Math.min(na * 0.4, (defPower / (attPower + defPower)) * na * 0.3 * rng.range(0.6, 1.4));
    const da = killSoldiers(sim, a, Math.round(la), 'storming the walls of ' + s.name);
    let dd = 0;
    const ld = Math.round((attPower / (attPower + defPower)) * g.n * 0.5 * rng.range(0.6, 1.4));
    for (let k = 0; k < ld && g.list.length > 0; k++) {
      const p = g.list.pop()!;
      killPerson(sim, p, 'defending ' + s.name);
      dd++;
    }
    if (war) {
      const sg = sideSign(war, a.civ);
      if (sg > 0) { war.attLoss += da; war.defLoss += dd; } else { war.attLoss += dd; war.defLoss += da; }
    }
    sim.rt.fx.push({ kind: 'clash', x: s.x, y: s.y, r: 2, t: sim.tick });
    a.fighting = 8;
    if (attPower * rng.range(0.7, 1.3) > defPower) {
      capture(sim, a, civ, s, true, war);
      return;
    }
    a.morale = clamp01(a.morale - 0.15);
    civ.exhaustion = clamp01(civ.exhaustion + 0.02);
    if (da + dd > 15) addEvent(sim, 'siege', 2, `The ${civ.name} stormed the walls of ${s.name} and were thrown back. ${da} attackers and ${dd} defenders died.`, [civ.id, dc.id], [], s.id, s.x, s.y);
  }
  if ((a.supply <= 0 && a.morale < 0.35) || a.soldiers.length < 4 || s.siegeMonths > 40) {
    addEvent(sim, 'siege', 2, `The siege of ${s.name} was lifted. The ${civ.name} withdrew${a.supply <= 0 ? ', starving' : ''}.`, [civ.id, dc.id], [], s.id, s.x, s.y);
    if (war) war.score = clamp(war.score - sideSign(war, a.civ) * 8, -100, 100);
    retreat(sim, a);
  }
}

function capture(sim: Sim, a: Army, civ: Civ, s: Settlement, sack: boolean, war: War | undefined): void {
  const dc = sim.civs.get(s.civ)!;
  const rng = sim.rng;
  const months = s.siegeMonths;
  const wasCapital = dc.capital === s.id;
  s.siege = -1;
  s.siegeMonths = 0;
  // plunder goes home with the baggage train
  const home = sim.settlements.get(a.home);
  const frac = sack ? 0.5 : 0.15;
  for (let g = 0; g < s.stock.length; g++) {
    const take = s.stock[g] * frac;
    s.stock[g] -= take;
    if (home && home.alive) home.stock[g] += take * 0.7;
  }
  let loot = 0, killed = 0;
  const flee: Person[] = [];
  for (const id of s.people.slice()) {
    const p = sim.people.get(id);
    if (!p || p.army >= 0) continue;
    if (sack) {
      const t = p.wealth * 0.4;
      p.wealth -= t;
      loot += t;
      if (p.job !== J.child && rng.chance(p.job === J.soldier ? 0.5 : 0.05)) {
        killPerson(sim, p, 'the sack of ' + s.name);
        killed++;
        continue;
      }
    }
    if (p.title === TITLE.ruler) continue;
    if (p.spouse >= 0 && p.sex === 0) continue; // families flee together via the head of household
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
  // refugees take the road to the nearest town still held by their own people
  if (flee.length > 0) {
    let dest: Settlement | null = null,
      bd = 1e9;
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
      const group: Person[] = [];
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
  addEvent(sim, 'conquest', wasCapital ? 4 : 3, `${s.name}${wasCapital ? ', capital of the ' + dc.name + ',' : ''} fell to the ${civ.name} after ${months} month${months === 1 ? '' : 's'} of siege${sack ? ` and was sacked. ${killed} townsfolk were killed` : '; its gates were opened by hunger'}.${flee.length > 5 ? ' Refugees streamed out along the roads.' : ''}`, [civ.id, dc.id], gen ? [gen.id] : [], s.id, s.x, s.y);
  addGrievance(sim, dc, civ.id, sack ? 'sack' : 'conquest', sack ? 30 : 14, sack ? `scarred by the sack of ${s.name}` : `robbed of ${s.name}`);
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
  a.wait = 8; // regroup
  if (dc.settlements.length === 0 && war) concludeTotalDefeat(sim, war, civ, dc);
}

function concludeTotalDefeat(sim: Sim, war: War, winner: Civ, loser: Civ): void {
  if (war.goal === 'overthrow' && war.att === winner.id) {
    resolveOverthrow(sim, war, winner, loser);
    return;
  }
  endWar(sim, war, `${winner.name} conquered ${loser.name} entirely`);
  addEvent(sim, 'peace', 4, `The ${war.name} is over. The ${civFullName(loser)} has been wiped from the map by the ${civFullName(winner)}.`, [winner.id, loser.id], [], -1, -1, -1);
  winner.memory.push(`the conquest of ${loser.name}`);
  removeCiv(sim, loser, 'was conquered');
}

/** victorious rebels become the government of the old state */
function resolveOverthrow(sim: Sim, war: War, rebels: Civ, state: Civ): void {
  const leader = sim.people.get(rebels.ruler);
  endWar(sim, war, `rebels under ${leader ? leader.name : 'their leaders'} took power`);
  const oldRuler = sim.people.get(state.ruler);
  const before = civFullName(state);
  absorbCiv(sim, state, rebels, false);
  state.gov = rebels.gov;
  state.laws.elective = state.gov !== GOV.monarchy;
  if (oldRuler && (!leader || oldRuler.id !== leader.id)) {
    oldRuler.title = TITLE.none;
    state.ruler = -1;
    if (sim.rng.chance(0.6)) killPerson(sim, oldRuler, 'execution after the civil war');
    sim.rt.pending = sim.rt.pending.filter((x) => x.civ !== state.id);
  }
  if (leader) {
    leader.civ = state.id;
    install(sim, state, leader, '', 0);
  }
  state.legitimacy = 0.5;
  state.exhaustion *= 0.5;
  state.rulingFaction = rebels.rulingFaction;
  addEvent(sim, 'peace', 4, `The ${war.name} is over: ${leader ? fullName(sim, leader) : 'the rebels'} won, and the ${before} is now the ${civFullName(state)}.`, [state.id, rebels.id], leader ? [leader.id] : [], state.capital, -1, -1);
  state.memory.push(`the civil war won by ${leader ? leader.name : 'the rebels'}`);
  removeCiv(sim, rebels, 'won its civil war and became the government');
}

function evaluatePeace(sim: Sim, war: War, att: Civ, def: Civ): void {
  const years = (sim.tick - war.start) / TICKS_PER_YEAR;
  if (years < 0.75) return;
  const existential = war.goal === 'overthrow' || war.goal === 'independence';
  const attWill = 1 - att.exhaustion * 1.3 - (att.treasury < 0 ? 0.2 : 0) + att.pMilitary * 0.3 + (war.score > 0 ? 0.15 : -0.2) - years * 0.03;
  const defWill = 1 - def.exhaustion * 1.3 - (def.treasury < 0 ? 0.2 : 0) + def.pMilitary * 0.2 + (war.score < 0 ? 0.15 : -0.2) - years * 0.03 + (existential ? 0.25 : 0);
  const year = Math.floor(sim.tick / TICKS_PER_YEAR) + 1;
  const ret = (toCivId: number, fromCivId: number) => {
    // settlements taken from `toCivId` by `fromCivId` during this war go back
    for (let k = 0; k < war.taken.length; k += 3) {
      const s = sim.settlements.get(war.taken[k]);
      const owner = sim.civs.get(toCivId);
      if (s && s.alive && owner && owner.alive && war.taken[k + 1] === toCivId && s.civ === fromCivId) transferSettlement(sim, s, owner, false);
    }
  };
  const gained = (civId: number) => {
    let n = 0;
    for (let k = 0; k < war.taken.length; k += 3) {
      const s = sim.settlements.get(war.taken[k]);
      if (s && s.alive && s.civ === civId && war.taken[k + 2] === civId) n++;
    }
    return n;
  };
  if (war.score > 55 || (war.score > 22 && defWill < 0.35)) {
    // ---- the attacker has won ----
    if (war.goal === 'overthrow') {
      resolveOverthrow(sim, war, att, def);
      return;
    }
    if (war.goal === 'independence') {
      endWar(sim, war, `${att.name} won independence`);
      att.rebelOf = -1;
      att.rebelGoal = 0;
      addEvent(sim, 'peace', 4, `The ${civFullName(def)} has recognised the independence of the ${civFullName(att)}. A new nation is born.`, [att.id, def.id], [], att.capital, -1, -1);
      addGrievance(sim, def, att.id, 'secession', 12, `humbled by the secession of the ${att.name}`);
      att.memory.push(`independence won from ${def.name} in year ${year}`);
      return;
    }
    const n = gained(att.id);
    let terms = n > 0 ? `${def.name} cedes ${n} settlement${n === 1 ? '' : 's'}` : '';
    const tgt = sim.settlements.get(war.target);
    if (tgt && tgt.alive && tgt.civ === def.id && war.score > 70 && def.settlements.length > 1) {
      transferSettlement(sim, tgt, att, true);
      terms += `${terms ? ' and ' : `${def.name} cedes `}${tgt.name}`;
      addGrievance(sim, def, att.id, 'lost_land', 14, `forced to surrender ${tgt.name}`);
    }
    if (def.alive && def.settlements.length > 0 && (war.goal === 'tribute' || n === 0 || war.score > 80)) {
      const amt = Math.max(2, def.incomeLast * 0.15);
      relationOf(sim, att, def.id).tribute = amt;
      relationOf(sim, def, att.id).tribute = -amt;
      terms += `${terms ? ', and ' : `${def.name} `}pays tribute`;
    }
    endWar(sim, war, `${att.name} victorious`);
    addEvent(sim, 'peace', 4, `Peace of ${year}: the ${war.name} ends in victory for the ${civFullName(att)}. ${terms || 'The defeated sue for terms'}. ${war.attLoss + war.defLoss} soldiers died.`, [att.id, def.id], [], -1, -1, -1);
    addGrievance(sim, def, att.id, 'defeat', 18 + n * 8, `defeated in the ${war.name}`);
    def.legitimacy = Math.max(0, def.legitimacy - 0.15);
    att.legitimacy = Math.min(1, att.legitimacy + 0.1);
    const cul = sim.cultures.get(att.culture);
    if (cul) cul.martial = clamp01(cul.martial + 0.03);
    if (def.settlements.length === 0) removeCiv(sim, def, 'was conquered');
    return;
  }
  if (war.score < -45 || (war.score < -18 && attWill < 0.35)) {
    // ---- the defender has won ----
    if (war.goal === 'overthrow' || war.goal === 'independence') {
      endWar(sim, war, `the rising of the ${att.name} was crushed`);
      const leader = sim.people.get(att.ruler);
      addEvent(sim, 'peace', 3, `The ${war.name} is over. The ${civFullName(def)} crushed the rebels${leader ? '; ' + fullName(sim, leader) + ' was executed' : ''}.`, [att.id, def.id], leader ? [leader.id] : [], def.capital, -1, -1);
      if (leader) {
        leader.title = TITLE.none;
        att.ruler = -1;
        killPerson(sim, leader, 'execution after a failed rebellion');
        sim.rt.pending = sim.rt.pending.filter((x) => x.civ !== att.id);
      }
      absorbCiv(sim, def, att, true);
      removeCiv(sim, att, 'was crushed');
      return;
    }
    ret(def.id, att.id);
    const n = gained(def.id);
    const pay = Math.max(0, att.treasury * 0.3);
    att.treasury -= pay;
    def.treasury += pay;
    endWar(sim, war, `${def.name} repelled the invasion`);
    addEvent(sim, 'peace', 4, `Peace of ${year}: the ${civFullName(att)} lost the ${war.name}. ${n > 0 ? `The ${def.name} keep ${n} captured settlement${n === 1 ? '' : 's'}; ` : ''}the invaders pay reparations. ${war.attLoss + war.defLoss} soldiers died.`, [att.id, def.id], [], -1, -1, -1);
    addGrievance(sim, att, def.id, 'defeat', 14 + n * 8, `humiliated in the ${war.name}`);
    att.legitimacy = Math.max(0, att.legitimacy - 0.2);
    def.legitimacy = Math.min(1, def.legitimacy + 0.1);
    if (att.settlements.length === 0) removeCiv(sim, att, 'was conquered');
    return;
  }
  if ((years > 3 && attWill < 0.45 && defWill < 0.45) || years > 14 || (years > 5 && sim.tick - war.lastAction > 4 * TICKS_PER_YEAR)) {
    if (war.goal === 'independence') {
      // a rebellion that survives this long has won in fact
      endWar(sim, war, `${att.name} held out and became independent`);
      att.rebelOf = -1;
      att.rebelGoal = 0;
      addEvent(sim, 'peace', 3, `Exhausted, the ${civFullName(def)} gave up trying to retake its rebel provinces. The ${civFullName(att)} endures.`, [att.id, def.id], [], att.capital, -1, -1);
      return;
    }
    if (war.goal === 'overthrow') {
      endWar(sim, war, 'the realm was split in two');
      att.rebelOf = -1;
      att.rebelGoal = 0;
      addEvent(sim, 'peace', 3, `Neither side could win the ${war.name}. The realm is split: the ${civFullName(att)} and the ${civFullName(def)} now stand apart.`, [att.id, def.id], [], att.capital, -1, -1);
      return;
    }
    endWar(sim, war, 'stalemate');
    addEvent(sim, 'peace', 3, `Peace of ${year}: the ${war.name} ended in exhaustion with no victor. ${war.attLoss + war.defLoss} soldiers died for little.`, [att.id, def.id], [], -1, -1, -1);
  }
}

function navyPower(sim: Sim, civ: Civ): number {
  let p = 0;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (s && s.coastal) p += (0.5 + s.bld[B.port]) * civ.mods.navy;
  }
  return p;
}

function assignObjectives(sim: Sim, civ: Civ, enemies: Civ[]): void {
  if (civ.armies.length === 0 || enemies.length === 0) return;
  let enemyPower = 0;
  for (const e of enemies) enemyPower += warPotential(e);
  const defensive = warPotential(civ) < enemyPower * 0.55;
  // enemy field armies
  const foes: Army[] = [];
  for (const a of sim.armies.values()) if (hostile(sim, civ.id, a.civ)) foes.push(a);
  for (const aid of civ.armies) {
    const a = sim.armies.get(aid);
    if (!a || a.foe >= 0) continue;
    if (a.wait > 0) continue;
    const n = a.soldiers.length;
    if (n < 4 || (a.supply <= 0 && a.morale < 0.3)) {
      if (a.goal !== 4) retreat(sim, a);
      continue;
    }
    if (a.goal === 4 && a.path.length > 0 && a.pi < a.path.length - 1) continue; // still falling back
    if (a.goal === 1 && a.target >= 0) {
      const t = sim.settlements.get(a.target);
      if (t && t.alive && hostile(sim, civ.id, t.civ) && (t.siege === a.id || (a.path.length > 0 && a.pi < a.path.length - 1))) continue; // committed
    }
    // intercept an invader that threatens our towns
    let threat: Army | null = null,
      td = 22;
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
      // hold the most exposed town
      let best: Settlement | null = null,
        bs = -1;
      for (const sid of civ.settlements) {
        const s = sim.settlements.get(sid);
        if (!s) continue;
        let sc = s.people.length / 100 + (s.id === civ.capital ? 2 : 0);
        for (const f of foes) sc += 20 / (10 + dist(s.x, s.y, f.x, f.y));
        if (sc > bs) {
          bs = sc;
          best = s;
        }
      }
      if (best && (a.goal !== 2 || a.target !== best.id)) {
        a.goal = 2;
        a.target = best.id;
        setPath(sim, a, best.tile);
      }
      continue;
    }
    // offensive: the most valuable target the army can actually get to
    const cands: { s: Settlement; val: number }[] = [];
    const war = sim.wars.get(a.war);
    for (const e of enemies) {
      for (const sid of e.settlements) {
        const s = sim.settlements.get(sid);
        if (!s || !s.alive) continue;
        const d = dist(a.x, a.y, s.x, s.y);
        let val = 1 + s.people.length / 150 + (s.id === e.capital ? 1.5 : 0) + (war && war.target === s.id ? 2 : 0);
        val /= 12 + d;
        val /= 1 + s.bld[B.walls] * 0.3;
        if (s.siege >= 0 && s.siege !== a.id) val *= 1.3; // reinforce a siege
        cands.push({ s, val });
      }
    }
    cands.sort((p, q) => q.val - p.val || p.s.id - q.s.id);
    let marched = false;
    for (let k = 0; k < cands.length && k < 3; k++) {
      if (setPath(sim, a, cands[k].s.tile)) {
        a.goal = 1;
        a.target = cands[k].s.id;
        marched = true;
        break;
      }
    }
    if (marched) continue;
    if (cands.length > 0) a.wait = 24; // no way through for now
    if (a.goal !== 2) {
      const home = sim.settlements.get(a.home);
      if (home) {
        a.goal = 2;
        a.target = home.id;
        setPath(sim, a, home.tile);
      }
    }
  }
}

/** called each season for every civ: raise hosts, pick objectives, blockade, and consider peace */
export function warSeasonal(sim: Sim, civ: Civ): void {
  const enemies: Civ[] = [];
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
    // peace: armies go home and stand down
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
  civ.exhaustion = clamp01(civ.exhaustion + 0.006);
  // --- muster ---
  const maxArmies = Math.min(4, 1 + Math.floor(civ.pop / 500));
  if (civ.armies.length < maxArmies) {
    let best: Settlement | null = null,
      bs = 4;
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
      const war = sim.wars.get(civ.rel.get(enemies[0].id)!.war);
      raiseArmy(sim, civ, best, war ? war.id : -1);
    }
  }
  assignObjectives(sim, civ, enemies);
  // --- naval blockade: a stronger fleet closes the enemy's harbours ---
  const myNavy = navyPower(sim, civ);
  for (const e of enemies) {
    const theirs = navyPower(sim, e);
    const closed = myNavy > 0.9 && myNavy > theirs * 1.4;
    for (const sid of e.settlements) {
      const s = sim.settlements.get(sid);
      if (!s || !s.coastal) continue;
      if (closed && !s.blockaded) {
        // only harbours within reach of one of ours
        let inReach = false;
        for (const ms of civ.settlements) {
          const m = sim.settlements.get(ms);
          if (m && m.coastal && dist(m.x, m.y, s.x, s.y) < civ.mods.seaRange) inReach = true;
        }
        if (inReach) {
          s.blockaded = true;
          if (s.people.length > 100) addEvent(sim, 'blockade', 2, `${civ.adj} warships have closed the harbour of ${s.name}. No fishing boat or grain ship may pass.`, [civ.id, e.id], [], s.id, s.x, s.y);
        }
      } else if (!closed && s.blockaded) {
        // lifted only if no other enemy still holds it shut (cheap approximation: reopen)
        s.blockaded = false;
      }
    }
  }
  // --- peace: the principal attacker weighs it once a season ---
  for (const e of enemies) {
    const r = civ.rel.get(e.id);
    if (!r || r.war < 0) continue;
    const w = sim.wars.get(r.war);
    if (!w || w.end >= 0) continue;
    if (w.att === civ.id) {
      const def = sim.civs.get(w.def);
      if (def && def.alive) evaluatePeace(sim, w, civ, def);
      else endWar(sim, w, 'the enemy ceased to exist');
      if (!civ.alive) return;
    } else if (w.def === civ.id) {
      const att = sim.civs.get(w.att);
      if (!att || !att.alive) endWar(sim, w, 'the enemy ceased to exist');
    } else {
      // an ally: leaves the war when the principals are done or it is worn out
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
        addEvent(sim, 'peace', 2, `Worn out, the ${civ.name} withdrew from the ${w.name}.`, [civ.id], [], -1, -1, -1);
      }
    }
  }
}

/** every tick: march, fight, besiege */
export function updateArmies(sim: Sim): void {
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
    // --- enemies in contact? ---
    let foe: Army | null = null,
      fd = 1.8 * 1.8;
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
    // --- march ---
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
      a.y = (i / w.w) | 0;
      a.atSea = w.water[i] !== W_LAND;
      // chasing a moving target: re-aim now and then
      if (a.goal === 3 && monthly) {
        const t = sim.armies.get(a.target);
        if (!t || !hostile(sim, a.civ, t.civ)) a.goal = 0;
        else setPath(sim, a, armyTile(sim, t));
      }
      continue;
    }
    // --- arrived ---
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
      // home: rest and refit
      const home = sim.settlements.get(a.home);
      if (home && home.alive && home.civ === a.civ && dist(a.x, a.y, home.x, home.y) < 2.5) {
        a.morale = Math.min(1, a.morale + 0.08);
        if (a.supply < 3 && home.stock[G.food] > a.soldiers.length * 3) {
          home.stock[G.food] -= a.soldiers.length;
          a.supply += 1;
        }
        if (a.morale > 0.6 && a.supply >= 1.5) a.goal = 0;
      } else if (a.path.length === 0 || a.pi >= a.path.length - 1) {
        // home is gone; find another
        const cap = sim.settlements.get(civ.capital);
        if (cap) {
          a.home = cap.id;
          if (!setPath(sim, a, cap.tile)) a.goal = 0;
        }
      }
    } else if (a.goal === 3) a.goal = 0;
  }
}
export { ignite };
