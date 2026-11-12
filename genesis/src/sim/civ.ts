// Civilizations: government, factions, laws, succession, research, expansion, rebellion.
// A civ's behaviour is not scripted per type; it is derived from its culture's values, its ruler's
// personality, whichever faction currently dominates, and the pressures its people are under.
import { clamp, clamp01 } from './rng';
import { addEvent, remember } from './history';
import { civTitle, demonym, rootName, rulerTitle } from './names';
import { addFame, ageOf, fullName, killPerson, politicalWeight, rehome, setJob } from './people';
import {
  ADULT_AGE, B, Civ, F, G, GOOD_BASE, GOV, J, Laws, M, NF, NG, Person, Relation, Settlement, Sim, TICKS_PER_YEAR, TITLE,
} from './types';
import { NT, TECHS, TK, baseMods, canResearch, civEnv, knownCount, recomputeMods, techCost } from './tech';
import { dist } from './world';
import { abandonSettlement, pickCapital, transferSettlement } from './settlement';
import { findSite, sendSettlers } from './parties';
import { buildRoads } from './trade';
import { declareWar, diplomacySeasonal } from './diplomacy';
import { warSeasonal, disbandArmy } from './war';
import { cultureSeasonal } from './culture';

export function relationOf(sim: Sim, civ: Civ, otherId: number): Relation {
  let r = civ.rel.get(otherId);
  if (!r) {
    r = { score: 0, war: -1, truceUntil: 0, tradePact: false, alliance: false, contact: false, tradeVal: 0, friction: 0, lastWar: -99999, tribute: 0 };
    civ.rel.set(otherId, r);
  }
  return r;
}

export function civFullName(civ: Civ): string {
  return civTitle(civ.gov, civ.name, civ.settlements.length);
}

export interface NewCiv {
  culture: number;
  religion: number;
  parent: number;
  inherit?: Civ;
  name?: string;
}

export function createCiv(sim: Sim, o: NewCiv): Civ {
  const cul = sim.cultures.get(o.culture)!;
  const name = o.name || rootName(sim, cul.lang);
  // pick the colour least used by living civs
  const used = new Array(24).fill(0);
  for (const c of sim.civs.values()) if (c.alive) used[c.color]++;
  let color = 0;
  const start = sim.rng.int(24);
  for (let k = 0; k < 24; k++) {
    const idx = (start + k * 7) % 24;
    if (used[idx] < used[color] || k === 0) color = used[idx] <= used[color] || k === 0 ? idx : color;
  }
  const laws: Laws = { tax: 0.1, conscription: 1, trade: 1, dole: false, serfdom: false, tolerance: true, schooling: false, elective: true };
  const civ: Civ = {
    id: sim.nextId++, name, adj: demonym(name), color, hue: color * 15, alive: true, founded: sim.tick, ended: -1, parent: o.parent,
    capital: -1, settlements: [], ruler: -1, dynasty: -1, gov: GOV.band, laws, lawCooldown: 0,
    factions: new Array(NF).fill(1), rulingFaction: F.commons, culture: o.culture, religion: o.religion,
    tech: new Array(NT).fill(0), research: new Array(NT).fill(0), researching: -1,
    treasury: 20, income: 0, expense: 0, incomeLast: 0, expenseLast: 0, rel: new Map(), grievances: [], armies: [],
    stability: 0.8, legitimacy: 0.7, exhaustion: 0, identity: 0.5, era: 0, pop: 0, soldiers: 0, strength: 0, soldierTarget: 0,
    pExpand: 0.4, pMilitary: 0.3, pTrade: 0.3, pScience: 0.3, pPiety: 0.3, isolated: false, rebelOf: -1, rebelGoal: 0,
    needs: new Array(NG).fill(0), lastSettle: sim.tick, memory: [], peakPop: 0, golden: 0, federation: -1, mods: baseMods(),
  };
  for (const t of TECHS) if (t.tier === 0) civ.tech[t.id] = 1;
  if (o.inherit) {
    // knowledge and grudges travel with people
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

export function civPeople(sim: Sim, civ: Civ, fn: (p: Person, s: Settlement) => void): void {
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    for (const id of s.people) {
      const p = sim.people.get(id);
      if (p) fn(p, s);
    }
  }
}

export function removeCiv(sim: Sim, civ: Civ, how: string): void {
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
  addEvent(sim, 'fall', civ.peakPop > 150 ? 4 : 3, `The ${civFullName(civ)} ${how}. It lasted ${years} years.`, [civ.id], [], -1, -1, -1);
}

// ---------------------------------------------------------------- seasonal update

export function civSeasonal(sim: Sim, civ: Civ): void {
  if (!civ.alive) return;
  const rng = sim.rng;
  // --- housekeeping ---
  civ.settlements = civ.settlements.filter((id) => sim.settlements.get(id)?.alive);
  if (civ.settlements.length === 0) {
    // a civ whose people are all on the road is not dead yet
    let travelling = false;
    for (const p of sim.parties.values()) if (p.civ === civ.id && p.kind === 1) travelling = true;
    if (!travelling) removeCiv(sim, civ, civ.rebelOf >= 0 ? 'was crushed' : 'has vanished');
    return;
  }
  if (civ.capital < 0 || !sim.settlements.get(civ.capital)?.alive || sim.settlements.get(civ.capital)!.civ !== civ.id) civ.capital = pickCapital(sim, civ);
  const cap = sim.settlements.get(civ.capital)!;
  // --- census: population, arms, faction weights, notable people ---
  const fac = [0, 0, 0, 0, 0];
  let pop = 0, soldiers = 0, adults = 0, fight = 0;
  let richest: Person | null = null, general: Person | null = null;
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
    const s = sim.settlements.get(sid)!;
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
  // --- ruler ---
  let ruler = sim.people.get(civ.ruler);
  if (!ruler || ruler.civ !== civ.id) {
    succession(sim, civ, 'vacancy', civ.ruler);
    ruler = sim.people.get(civ.ruler);
  }
  // --- factions ---
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
      const who = ['the old nobility', 'the generals', 'the guilds and merchant houses', 'the priesthood', 'the common folk'];
      let text = `In ${civFullName(civ)}, ${who[top]} now hold sway over ${who[old]}.`;
      const rich: Person | null = richest;
      if (top === F.guilds && rich && (rich as Person).wealth > 300) {
        text = `In ${civFullName(civ)}, the merchant houses led by ${fullName(sim, rich)} now steer the state.`;
        addFame(sim, rich, 3);
      }
      addEvent(sim, 'politics', 2, text, [civ.id], richest && top === F.guilds ? [(richest as Person).id] : [], civ.capital, cap.x, cap.y);
    }
  }
  // --- policy: culture × ruler × faction × circumstance ---
  const cul = sim.cultures.get(civ.culture)!;
  const rf = civ.rulingFaction;
  const landNeed = clamp01((crowd - 0.75) * 2) + (fed < 0.85 ? 0.3 : 0);
  let threat = 0;
  for (const [, r] of civ.rel) if (r.war >= 0) threat = 1; else if (r.contact && r.score < -30) threat = Math.max(threat, 0.5);
  civ.pExpand = clamp01(0.2 + cul.martial * 0.2 + (ruler ? ruler.amb * 0.25 : 0.1) + (rf === F.military ? 0.15 : 0) + landNeed * 0.35 - cul.insular * 0.1);
  civ.pMilitary = clamp01(0.1 + cul.martial * 0.45 + (ruler ? ruler.bold * 0.2 : 0.1) + (rf === F.military ? 0.2 : 0) + threat * 0.25);
  civ.pTrade = clamp01(0.15 + cul.mercantile * 0.5 + (rf === F.guilds ? 0.2 : 0) + (ruler ? ruler.greed * 0.15 : 0) - cul.insular * 0.2);
  civ.pScience = clamp01(0.12 + cul.innovative * 0.5 + (ruler ? ruler.intl * 0.25 : 0.1) + (rf === F.guilds ? 0.08 : 0));
  civ.pPiety = clamp01(cul.pious * 0.6 + (ruler ? ruler.piety * 0.3 : 0.1) + (rf === F.clergy ? 0.2 : 0));
  // --- arms ---
  let target = civ.gov === GOV.band ? 0 : 0.025 + civ.pMilitary * 0.07;
  if (threat >= 1) target += civ.laws.conscription === 2 ? 0.16 : civ.laws.conscription === 1 ? 0.09 : 0.05;
  else if (threat > 0) target += 0.025;
  if (civ.gov === GOV.band && threat >= 1) target = 0.14;
  if (civ.treasury < 0) target *= threat >= 1 ? 0.85 : 0.6;
  civ.soldierTarget = target;
  // --- money ---
  civ.incomeLast = civ.income;
  civ.expenseLast = civ.expense;
  civ.income = 0;
  civ.expense = 0;
  const wantTax = [0.26, 0.3, 0.15, 0.2, 0.12][rf];
  if (civ.treasury < 0) civ.laws.tax = Math.min(0.45, civ.laws.tax + 0.02);
  else if (civ.laws.tax > wantTax && civ.treasury > pop * 0.5) civ.laws.tax = Math.max(wantTax, civ.laws.tax - 0.01);
  else if (civ.laws.tax < wantTax - 0.03 && civ.gov !== GOV.band) civ.laws.tax += 0.005;
  if (civ.treasury < -pop * 3) civ.treasury = -pop * 3; // debts are eventually defaulted on
  if (civ.treasury > pop * 12 + 200) civ.treasury -= (civ.treasury - pop * 12 - 200) * 0.03; // idle hoards leak away
  // --- legitimacy & exhaustion ---
  let lt = 0.55 + (ruler ? (ruler.cha - 0.5) * 0.3 : -0.2) + (civ.golden > 0 ? 0.15 : 0) + cap.bld[B.palace] * 0.05 - civ.exhaustion * 0.3 - (civ.treasury < 0 ? 0.1 : 0);
  if (ruler && ageOf(sim, ruler) < ADULT_AGE) lt -= 0.25;
  civ.legitimacy += (clamp01(lt) - civ.legitimacy) * 0.1;
  if (threat < 1) civ.exhaustion = Math.max(0, civ.exhaustion - 0.02);
  civ.lawCooldown = Math.max(0, civ.lawCooldown - 1);
  updateLaws(sim, civ);
  maybeReform(sim, civ, cap);
  research(sim, civ, cap);
  const season = Math.floor((sim.tick % TICKS_PER_YEAR) / 12);
  const year = Math.floor(sim.tick / TICKS_PER_YEAR);
  if (season === civ.id % 4) {
    knowledgeLoss(sim, civ);
    // elected governments hold elections
    if ((civ.gov === GOV.republic || civ.gov === GOV.democracy || civ.gov === GOV.oligarchy) && (year + civ.id) % 6 === 0) succession(sim, civ, 'election', civ.ruler);
    // age of plenty / long decline
    if (civ.golden > 0) {
      civ.golden--;
      if (civ.golden === 0) addEvent(sim, 'golden', 2, `The golden age of ${civFullName(civ)} has faded.`, [civ.id], [], civ.capital, cap.x, cap.y);
    } else if (pop > 200 && civ.stability > 0.78 && fed > 0.93 && civ.treasury > pop && threat < 1 && rng.chance(0.06)) {
      civ.golden = 18 + rng.int(14);
      addEvent(sim, 'golden', 3, `A golden age dawns in ${civFullName(civ)}: full granaries, full coffers, and peace.`, [civ.id], [], civ.capital, cap.x, cap.y);
      civ.memory.push(`the golden age that began in year ${year + 1}`);
    }
    if (pop < civ.peakPop * 0.45 && civ.peakPop > 150) {
      addEvent(sim, 'decline', 3, `${civFullName(civ)} is a shadow of itself: ${pop} souls remain where ${civ.peakPop} once lived.`, [civ.id], [], civ.capital, cap.x, cap.y);
      civ.memory.push(`the great decline of year ${year + 1}`);
      civ.peakPop = pop;
    }
    if (civ.memory.length > 14) civ.memory.splice(0, civ.memory.length - 14);
    // old grudges fade — slowly
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

function updateLaws(sim: Sim, civ: Civ): void {
  if (civ.lawCooldown > 0 || civ.gov === GOV.band || civ.pop < 80) return;
  const rf = civ.rulingFaction;
  const L = civ.laws;
  const hasAgri = civ.tech[TK.agriculture] === 1;
  const changes: [string, () => void][] = [];
  const name = civFullName(civ);
  switch (rf) {
    case F.crown:
      if (!L.serfdom && hasAgri && civ.gov >= GOV.monarchy && civ.era < 5) changes.push([`${name} bound its farmers to the land as serfs.`, () => { L.serfdom = true; }]);
      if (L.elective && civ.gov === GOV.monarchy) changes.push([`${name} made its crown hereditary.`, () => { L.elective = false; }]);
      break;
    case F.military:
      if (L.conscription < 2) changes.push([`${name} decreed that every able adult may be called to arms.`, () => { L.conscription = 2; }]);
      if (L.trade === 2) changes.push([`${name} reimposed tariffs to fund its armies.`, () => { L.trade = 1; }]);
      break;
    case F.guilds:
      if (L.trade < 2 && civ.tech[TK.currency] === 1) changes.push([`${name} opened its markets: free trade is now the law.`, () => { L.trade = 2; }]);
      if (L.serfdom) changes.push([`${name} abolished serfdom.`, () => { L.serfdom = false; }]);
      if (!L.schooling && civ.tech[TK.education] === 1) changes.push([`${name} founded public schools.`, () => { L.schooling = true; }]);
      if (L.conscription === 2) changes.push([`${name} ended universal conscription.`, () => { L.conscription = 1; }]);
      break;
    case F.clergy:
      if (L.tolerance && civ.religion >= 0) changes.push([`${name} outlawed all faiths but its own.`, () => { L.tolerance = false; }]);
      if (!L.dole) changes.push([`${name} ordered its temples to feed the hungry.`, () => { L.dole = true; }]);
      break;
    case F.commons:
      if (L.serfdom) changes.push([`${name} freed its serfs.`, () => { L.serfdom = false; }]);
      if (!L.dole && civ.tech[TK.currency] === 1) changes.push([`${name} began a grain dole for the poor.`, () => { L.dole = true; }]);
      if (!L.tolerance) changes.push([`${name} granted freedom of worship.`, () => { L.tolerance = true; }]);
      if (L.conscription === 2) changes.push([`${name} ended universal conscription.`, () => { L.conscription = 1; }]);
      break;
  }
  // insular cultures close their borders; open ones reopen them
  const cul = sim.cultures.get(civ.culture)!;
  if (cul.insular > 0.8 && L.trade !== 0 && rf !== F.guilds) changes.push([`${name} closed its borders to foreigners.`, () => { L.trade = 0; }]);
  else if (L.trade === 0 && cul.insular < 0.6) changes.push([`${name} reopened its borders.`, () => { L.trade = 1; }]);
  if (changes.length === 0) return;
  const [text, apply] = sim.rng.pick(changes);
  apply();
  civ.lawCooldown = 32 + sim.rng.int(24);
  const cap = sim.settlements.get(civ.capital)!;
  addEvent(sim, 'law', 2, text, [civ.id], [], civ.capital, cap.x, cap.y);
}

/** governments evolve when a society outgrows them or when a different faction takes charge */
function maybeReform(sim: Sim, civ: Civ, cap: Settlement): void {
  const rf = civ.rulingFaction;
  const ruler = sim.people.get(civ.ruler);
  const old = civ.gov;
  let next = old, why = '';
  const rng = sim.rng;
  const cul = sim.cultures.get(civ.culture)!;
  if (old === GOV.band && (civ.pop > 70 || civ.settlements.length >= 2)) {
    next = GOV.chiefdom;
    why = 'the people have grown too many for the council fire';
  } else if (old === GOV.chiefdom && civ.pop > 220 && (civ.settlements.length >= 3 || civ.tech[TK.masonry] === 1 || civ.tech[TK.writing] === 1)) {
    if (rf === F.clergy && civ.religion >= 0) { next = GOV.theocracy; why = 'the priests have taken the reins'; }
    else if (rf === F.guilds && civ.tech[TK.currency] === 1) { next = GOV.oligarchy; why = 'the great trading families now rule in council'; }
    else { next = GOV.monarchy; why = 'the chief has taken a crown'; }
  } else if (old === GOV.monarchy && civ.legitimacy < 0.42 && rng.chance(0.08)) {
    if (rf === F.guilds && civ.tech[TK.currency] === 1) { next = civ.tech[TK.philosophy] === 1 && cul.communal > 0.45 ? GOV.republic : GOV.oligarchy; why = 'the merchant houses forced the crown aside'; }
    else if (rf === F.clergy && civ.religion >= 0) { next = GOV.theocracy; why = 'the priesthood declared the throne forfeit'; }
    else if (rf === F.commons && civ.tech[TK.philosophy] === 1) { next = GOV.republic; why = 'the citizens demanded a voice and the weakened crown gave way'; }
  } else if (old === GOV.monarchy && rf === F.clergy && cul.pious > 0.72 && civ.religion >= 0 && rng.chance(0.03)) {
    next = GOV.theocracy;
    why = 'a devout people handed the realm to its priests';
  } else if (old === GOV.oligarchy && civ.tech[TK.philosophy] === 1 && rf === F.commons && rng.chance(0.05)) {
    next = GOV.republic;
    why = 'the citizens demanded a voice';
  } else if (old === GOV.republic && rf === F.guilds && civ.factions[F.guilds] > 0.5 && rng.chance(0.02)) {
    next = GOV.oligarchy;
    why = 'a handful of rich families hollowed out the assembly';
  } else if (old === GOV.republic && civ.tech[TK.printing] === 1 && civ.laws.schooling && rf !== F.military && rng.chance(0.04)) {
    next = GOV.democracy;
    why = 'the vote was extended to all';
  } else if (old === GOV.junta && ruler && civ.legitimacy > 0.5 && ruler.amb > 0.55 && rng.chance(0.04)) {
    next = GOV.monarchy;
    why = `${ruler.name} the strongman has declared the office hereditary`;
  } else if ((old === GOV.junta || old === GOV.theocracy) && civ.legitimacy > 0.6 && civ.stability > 0.7 && (rf === F.guilds || rf === F.commons) && rng.chance(0.02)) {
    next = civ.tech[TK.philosophy] === 1 ? GOV.republic : GOV.oligarchy;
    why = 'power passed back to civil hands';
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
  if (civ.pop > 60) addEvent(sim, 'government', next >= GOV.monarchy ? 3 : 2, `A new order in the ${before}: ${why}. It is now the ${civFullName(civ)}${ruler ? ` under ${rulerTitle(next, ruler.sex, civ.settlements.length)} ${fullName(sim, ruler)}` : ''}.`, [civ.id], ruler ? [ruler.id] : [], civ.capital, cap.x, cap.y);
}

// ---------------------------------------------------------------- knowledge

/** how strongly an idea reaches this civ from others who hold it: 0 none, 1 rumour, 2 trade, 3 close partners */
function knownByContact(sim: Sim, civ: Civ, tech: number): number {
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

function ruinTeaches(sim: Sim, civ: Civ, tech: number): boolean {
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

export function effectiveCost(sim: Sim, civ: Civ, tech: number): number {
  let c = techCost(tech);
  if (civ.tech[tech] === 2) c *= 0.4; // half-remembered
  const k = knownByContact(sim, civ, tech); // ideas travel along trade roads
  if (k > 0) c *= k === 3 ? 0.55 : k === 2 ? 0.7 : 0.9;
  else if (ruinTeaches(sim, civ, tech)) c *= 0.5; // the ancients left clues
  return c;
}

function research(sim: Sim, civ: Civ, cap: Settlement): void {
  const rng = sim.rng;
  if (civ.researching >= 0) {
    const r = civ.researching;
    if (civ.research[r] >= effectiveCost(sim, civ, r)) learnTech(sim, civ, r, 'research');
    else if (rng.chance(0.9)) return;
  }
  // choose what to pursue next: what the land allows, weighted by what the society wants
  const env = civEnv(sim, civ);
  let best = -1, bs = 0;
  for (let t = 0; t < NT; t++) {
    if (!canResearch(civ, t, env)) continue;
    const def = TECHS[t];
    let wgt = def.want ? def.want(env, civ) : 1;
    wgt *= 0.7 + rng.next() * 0.6;
    wgt /= Math.pow(effectiveCost(sim, civ, t), 0.35);
    wgt *= 1 + civ.research[t] / (techCost(t) + 1); // sunk effort
    if (wgt > bs) {
      bs = wgt;
      best = t;
    }
  }
  civ.researching = best;
}

export function learnTech(sim: Sim, civ: Civ, tech: number, how: string): void {
  const was = civ.tech[tech];
  if (was === 1) return;
  const eraBefore = civ.era;
  civ.tech[tech] = 1;
  civ.research[tech] = 0;
  if (civ.researching === tech) civ.researching = -1;
  recomputeMods(civ);
  const def = TECHS[tech];
  let first = true;
  for (const o of sim.civs.values()) if (o.id !== civ.id && (o.tech[tech] === 1 || (o.tech[tech] === 2 && !o.alive))) first = false;
  for (const o of sim.civs.values()) if (o.id !== civ.id && o.tech[tech] !== 0) first = false;
  const cap = sim.settlements.get(civ.capital);
  // credit a real person: the sharpest mind among the scholars and makers
  let inventor: Person | null = null;
  if (how === 'research' && cap) {
    let bs = 0;
    const pool = cap.people;
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
  let text: string;
  const diffused = how === 'research' && knownByContact(sim, civ, tech) >= 2;
  if (how === 'god') text = `A vision came to the ${civ.name}: they now understand ${def.name}.`;
  else if (was === 2) text = `The ${civ.name} have rediscovered the lost art of ${def.name}.`;
  else if (how === 'ruin') text = `Studying ancient ruins, the ${civ.name} recovered the secret of ${def.name}.`;
  else if (diffused) text = `The ${civ.name} learned ${def.name} from their neighbours.`;
  else if (inventor) text = `${fullName(sim, inventor)} of ${cap!.name} ${first ? 'was the first in the world to master' : 'worked out'} ${def.name} for the ${civ.name}.`;
  else text = `The ${civ.name} discovered ${def.name}.`;
  if (inventor && !diffused) {
    addFame(sim, inventor, def.tier >= 3 ? 7 : 4);
    remember(inventor, sim.tick, M.invented, tech);
  }
  addEvent(sim, 'tech', imp, text, [civ.id], inventor && !diffused ? [inventor.id] : [], civ.capital, cap ? cap.x : -1, cap ? cap.y : -1);
  if (civ.era > eraBefore) {
    const ERA = ['Stone Age', 'Bronze Age', 'Iron Age', 'Medieval era', 'Renaissance', 'Industrial era', 'Modern era', 'Atomic era'];
    addEvent(sim, 'era', 3, `The ${civ.name} have entered the ${ERA[civ.era]}.`, [civ.id], [], civ.capital, cap ? cap.x : -1, cap ? cap.y : -1);
    sim.rt.allDirty = true;
  }
}

/** a society can only hold as much knowledge as it has minds and records to carry it */
function knowledgeLoss(sim: Sim, civ: Civ): void {
  let scholars = 0, libs = 0, priests = 0;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid)!;
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
    // most fragile: highest tier that nothing else known depends on
    let needed = false;
    for (let u = 0; u < NT; u++) if (civ.tech[u] === 1 && TECHS[u].pre.indexOf(TECHS[t].key) >= 0) needed = true;
    if (!needed && TECHS[t].tier >= hiTier && TECHS[t].key !== 'agriculture') {
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
  const cap = sim.settlements.get(civ.capital)!;
  addEvent(sim, 'lost', 3, `With too few left who understood it, the ${civ.name} have lost the knowledge of ${TECHS[hi].name}.`, [civ.id], [], civ.capital, cap.x, cap.y);
  civ.memory.push(`the forgetting of ${TECHS[hi].name}`);
}

// ---------------------------------------------------------------- expansion

function planExpansion(sim: Sim, civ: Civ, landNeed: number): void {
  if (civ.tech[TK.agriculture] !== 1 && civ.pop < 60) return; // foragers split up on their own
  const cooldown = (10 - civ.pExpand * 7 - landNeed * 3) * TICKS_PER_YEAR;
  if (sim.tick - civ.lastSettle < cooldown) return;
  if (civ.settlements.length >= civ.mods.admin + 3) return;
  for (const [, r] of civ.rel) if (r.war >= 0) return;
  let src: Settlement | null = null, bs = 0;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid)!;
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
    civ.lastSettle = sim.tick - cooldown * 0.6; // look again later
    return;
  }
  const want = clamp(Math.round(src.people.length * 0.12), 8, 36);
  const group: Person[] = [];
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

// ---------------------------------------------------------------- succession

function adultsOf(sim: Sim, s: Settlement | undefined): Person[] {
  const out: Person[] = [];
  if (!s) return out;
  for (const id of s.people) {
    const p = sim.people.get(id);
    if (p && p.job !== J.child) out.push(p);
  }
  return out;
}

export function install(sim: Sim, civ: Civ, heir: Person, text: string, imp: number): void {
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
  const cap = sim.settlements.get(civ.capital);
  if (cap && heir.home !== cap.id && heir.army < 0 && heir.party < 0) rehome(sim, heir, cap);
  if (heir.job !== J.official && heir.job !== J.child && heir.army < 0) setJob(sim, heir, sim.settlements.get(heir.home), J.official);
  heir.loyalty = 1;
  // friends of the new ruler rise; rivals have reason to worry
  for (const fid of heir.friends) {
    const f = sim.people.get(fid);
    if (f) f.loyalty = Math.min(1, f.loyalty + 0.25);
  }
  for (const rid of heir.rivals) {
    const r = sim.people.get(rid);
    if (r) r.loyalty = Math.max(0, r.loyalty - 0.3);
  }
  if (text && civ.pop > 30) addEvent(sim, 'succession', imp, text, [civ.id], [heir.id], civ.capital, cap ? cap.x : -1, cap ? cap.y : -1);
}

export function succession(sim: Sim, civ: Civ, cause: string, prevId: number): void {
  if (!civ.alive || civ.settlements.length === 0) return;
  const rng = sim.rng;
  const cap = sim.settlements.get(civ.capital) || sim.settlements.get(civ.settlements[0])!;
  const prevGrave = sim.graves.get(prevId);
  const prevAlive = sim.people.get(prevId);
  const prevName = prevGrave ? fullName(sim, prevGrave) : prevAlive ? fullName(sim, prevAlive) : '';
  const died = cause !== 'election' && cause !== 'vacancy' && prevName;
  const lead = died ? `${rulerTitle(civ.gov, prevGrave ? prevGrave.sex : 1, civ.settlements.length)} ${prevName} of the ${civ.name} died of ${cause}. ` : '';
  const pool = adultsOf(sim, cap);
  let heir: Person | undefined;
  let text = '';
  const title = (p: Person) => rulerTitle(civ.gov, p.sex, civ.settlements.length);
  if (civ.gov === GOV.monarchy) {
    const kidIds = prevGrave ? prevGrave.kids : prevAlive ? prevAlive.kids : [];
    const kids: Person[] = [];
    for (const k of kidIds) {
      const c = sim.people.get(k);
      if (c && c.civ === civ.id) kids.push(c);
    }
    kids.sort((a, b) => a.born - b.born || a.id - b.id);
    heir = kids.find((k) => ageOf(sim, k) >= ADULT_AGE) || kids[0];
    let pretender: Person | undefined;
    if (heir) {
      const whose = (prevGrave ? prevGrave.sex : prevAlive ? prevAlive.sex : 1) === 0 ? 'Her' : 'His';
      text = `${lead}${lead ? whose : 'The late ruler’s'} ${ageOf(sim, heir) < ADULT_AGE ? 'young ' : ''}${heir.sex ? 'son' : 'daughter'} ${fullName(sim, heir)} inherits the throne.`;
      pretender = kids.find((k) => k !== heir && ageOf(sim, k) >= ADULT_AGE && k.amb > 0.68 && k.bold > 0.5);
    } else {
      // any living member of the royal house
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
        if (heir) text = `${lead}The house of ${oldHouse ? oldHouse.name : 'the old kings'} is extinct. ${fullName(sim, heir)} founds a new dynasty.`;
      }
    }
    if (heir) {
      install(sim, civ, heir, text, 3);
      civ.legitimacy = ageOf(sim, heir) < ADULT_AGE ? 0.35 : 0.6;
      if (pretender && pretender.home >= 0 && rng.chance(0.3 + (ageOf(sim, heir) < ADULT_AGE ? 0.3 : 0)) && civ.settlements.length >= 2) {
        const seat = sim.settlements.get(pretender.home);
        if (seat && seat.id !== civ.capital) startRebellion(sim, civ, seat, pretender, 2, `${fullName(sim, pretender)} disputes the succession and raises an army against ${heir.sex ? 'his' : 'her'} own kin.`);
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
    // an election: candidates campaign, factions vote
    const cands: Person[] = [];
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
    if (heir) text = heir.id === prevId && cause === 'election' ? '' : `${lead}${fullName(sim, heir)} was elected ${title(heir)} of the ${civFullName(civ)}.`;
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
    // bands and chiefdoms, and the fallback for everyone: the most respected adult
    let bs = -1;
    const all = pool.length ? pool : [];
    if (all.length === 0) civPeople(sim, civ, (p) => { if (p.job !== J.child) all.push(p); });
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
    install(sim, civ, heir, civ.pop > 60 || died ? text : '', civ.pop > 150 ? 2 : 1);
    civ.legitimacy = Math.max(civ.legitimacy, 0.55);
  }
}

export function processPending(sim: Sim): void {
  const list = sim.rt.pending;
  if (list.length === 0) return;
  sim.rt.pending = [];
  for (const it of list) {
    const civ = sim.civs.get(it.civ);
    if (civ && civ.alive && civ.ruler < 0) succession(sim, civ, it.cause, it.prev);
  }
}

// ---------------------------------------------------------------- unrest, coups, revolutions, secession

function unrestAndRevolt(sim: Sim, civ: Civ, general: Person | null): void {
  const rng = sim.rng;
  // --- an over-mighty general ---
  if (general && general.title === TITLE.general && general.amb > 0.68 && general.loyalty < 0.45 && civ.legitimacy < 0.5 && civ.gov !== GOV.junta && civ.pop > 150 && rng.chance(0.12)) {
    coup(sim, civ, general);
    return;
  }
  for (const sid of civ.settlements.slice()) {
    const s = sim.settlements.get(sid);
    if (!s || !s.alive || s.civ !== civ.id || s.rebelHeat < 8 || s.siege >= 0) continue;
    if (!rng.chance(0.12 + (s.unrest - 0.6) * 0.6)) continue;
    // someone has to lead it
    let leader: Person | null = null, ls = 0.62;
    let loyalArms = 0, angry = 0;
    for (const id of s.people) {
      const p = sim.people.get(id)!;
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
      // leaderless anger burns out as riots
      s.rebelHeat = 0;
      s.damage = clamp01(s.damage + 0.05);
      if (s.people.length > 120) addEvent(sim, 'riot', 1, `Bread riots shook ${s.name}, but no one stepped forward to lead them.`, [civ.id], [], s.id, s.x, s.y);
      continue;
    }
    s.rebelHeat = 0;
    const isCapital = s.id === civ.capital;
    if (isCapital || civ.settlements.length === 1) {
      revolution(sim, civ, s, leader, angry, loyalArms);
      return;
    }
    const foreign = s.cultureMajor !== civ.culture || s.originalCiv !== civ.id;
    startRebellion(sim, civ, s, leader, 1, foreign
      ? `${s.name} has risen against ${civFullName(civ)}. ${fullName(sim, leader)} leads the revolt of a people who never accepted foreign rule.`
      : `${fullName(sim, leader)} has raised ${s.name} in revolt against ${civFullName(civ)}.`);
    return;
  }
}

function govForLeader(sim: Sim, civ: Civ, leader: Person): number {
  if (leader.job === J.soldier) return GOV.junta;
  if (leader.job === J.priest) return GOV.theocracy;
  if (leader.job === J.merchant && civ.tech[TK.currency] === 1) return GOV.oligarchy;
  if (leader.title === TITLE.governor || leader.job === J.official || leader.fam === civ.dynasty) return civ.pop > 200 ? GOV.monarchy : GOV.chiefdom;
  if (civ.tech[TK.philosophy] === 1) return GOV.republic;
  return civ.pop > 250 ? GOV.monarchy : GOV.chiefdom;
}

function revolution(sim: Sim, civ: Civ, s: Settlement, leader: Person, angry: number, loyalArms: number): void {
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
    // the old order pays
    let fate = '';
    if (ruler && ruler.id !== leader.id) {
      if (rng.chance(0.55)) {
        fate = ` ${fullName(sim, ruler)} was put to death.`;
        ruler.title = TITLE.none;
        civ.ruler = -1;
        killPerson(sim, ruler, 'execution by revolutionaries');
        sim.rt.pending = sim.rt.pending.filter((x) => x.civ !== civ.id);
      } else fate = ` ${fullName(sim, ruler)} fled into obscurity.`;
    }
    install(sim, civ, leader, '', 0);
    addFame(sim, leader, 6);
    remember(leader, sim.tick, M.rebelled, civ.id);
    civ.legitimacy = 0.55;
    civ.rulingFaction = leader.faction;
    civ.exhaustion = Math.max(0, civ.exhaustion - 0.2);
    for (const sid of civ.settlements) {
      const t = sim.settlements.get(sid)!;
      t.unrest *= 0.5;
      t.rebelHeat = 0;
    }
    s.damage = clamp01(s.damage + 0.12);
    // some die in the streets
    let dead = 0;
    for (const id of s.people.slice()) {
      const p = sim.people.get(id);
      if (p && p.job !== J.child && p.id !== leader.id && rng.chance(0.03)) {
        killPerson(sim, p, 'street fighting in the revolution');
        dead++;
      }
    }
    addEvent(sim, 'revolution', 4, `Revolution in ${s.name}! ${fullName(sim, leader)}, ${describeRole(leader)}, overthrew the ${before}.${fate} ${oldGov !== civ.gov ? `The state is now the ${civFullName(civ)}.` : ''} ${dead} died in the fighting.`, [civ.id], [leader.id], s.id, s.x, s.y);
    civ.memory.push(`the revolution of ${fullName(sim, leader)} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
  } else {
    // crushed
    s.unrest = Math.max(0.2, s.unrest - 0.3);
    s.damage = clamp01(s.damage + 0.06);
    let dead = 0;
    for (const id of s.people.slice()) {
      const p = sim.people.get(id);
      if (p && p.loyalty < 0.35 && p.job !== J.child && p.id !== leader.id && rng.chance(0.06)) {
        killPerson(sim, p, 'the crushing of the uprising');
        dead++;
      }
    }
    addEvent(sim, 'uprising', 2, `An uprising in ${s.name} led by ${fullName(sim, leader)} was crushed by the garrison. ${dead + 1} were killed.`, [civ.id], [leader.id], s.id, s.x, s.y);
    killPerson(sim, leader, 'execution after a failed uprising');
    civ.legitimacy = Math.max(0, civ.legitimacy - 0.05);
  }
}

function describeRole(p: Person): string {
  if (p.title === TITLE.governor) return 'the governor';
  if (p.title === TITLE.general) return 'a general';
  switch (p.job) {
    case J.soldier: return 'a soldier';
    case J.priest: return 'a firebrand priest';
    case J.merchant: return 'a wealthy merchant';
    case J.scholar: return 'a scholar';
    case J.artisan: return 'an artisan';
    case J.farmer: return 'a farmer';
    case J.official: return 'a disaffected official';
  }
  return 'a commoner';
}

function coup(sim: Sim, civ: Civ, general: Person): void {
  const rng = sim.rng;
  const cap = sim.settlements.get(civ.capital)!;
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
      if (rng.chance(0.5)) killPerson(sim, ruler, 'assassination in a coup');
      sim.rt.pending = sim.rt.pending.filter((x) => x.civ !== civ.id);
    }
    install(sim, civ, general, '', 0);
    civ.legitimacy = 0.4;
    civ.rulingFaction = F.military;
    remember(general, sim.tick, M.rebelled, civ.id);
    addEvent(sim, 'coup', 4, `General ${fullName(sim, general)} marched on ${cap.name} and seized power. The ${before} is now the ${civFullName(civ)}.`, [civ.id], [general.id], cap.id, cap.x, cap.y);
    civ.memory.push(`the coup of General ${general.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
  } else {
    addEvent(sim, 'coup', 2, `A coup by General ${fullName(sim, general)} failed. The general was executed.`, [civ.id], [general.id], cap.id, cap.x, cap.y);
    killPerson(sim, general, 'execution for treason');
    civ.legitimacy = Math.max(0, civ.legitimacy - 0.05);
  }
}

/** a settlement (and like-minded neighbours) breaks away under a leader. goal 1 = independence, 2 = overthrow */
export function startRebellion(sim: Sim, civ: Civ, s: Settlement, leader: Person, goal: number, text: string): Civ | null {
  if (!s.alive || s.civ !== civ.id) return null;
  const rebel = createCiv(sim, { culture: goal === 1 && s.cultureMajor >= 0 && sim.cultures.has(s.cultureMajor) ? s.cultureMajor : civ.culture, religion: leader.religion, parent: civ.id, inherit: civ });
  rebel.rebelOf = civ.id;
  rebel.rebelGoal = goal;
  rebel.gov = govForLeader(sim, civ, leader);
  rebel.laws.elective = rebel.gov !== GOV.monarchy;
  rebel.rulingFaction = leader.faction;
  const join: Settlement[] = [s];
  for (const sid of civ.settlements) {
    const o = sim.settlements.get(sid)!;
    if (o.id === s.id || o.id === civ.capital || o.siege >= 0) continue;
    if (dist(o.x, o.y, s.x, s.y) > 26) continue;
    if (o.unrest > 0.5 || (goal === 1 && o.cultureMajor === s.cultureMajor && s.cultureMajor !== civ.culture && o.unrest > 0.3) || (goal === 2 && o.loyalAvg < 0.45)) join.push(o);
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
  install(sim, rebel, leader, '', 0);
  addFame(sim, leader, 5);
  remember(leader, sim.tick, M.rebelled, civ.id);
  rebel.legitimacy = 0.65;
  rebel.pop = moved;
  addEvent(sim, 'rebellion', 4, `${text} The rebels call themselves the ${civFullName(rebel)}.`, [civ.id, rebel.id], [leader.id], s.id, s.x, s.y);
  civ.memory.push(`the ${goal === 2 ? 'civil war' : 'revolt'} of ${s.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
  rebel.memory.push(`the rising at ${s.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
  const ra = relationOf(sim, rebel, civ.id),
    rb = relationOf(sim, civ, rebel.id);
  ra.contact = rb.contact = true;
  ra.score = rb.score = -60;
  declareWar(sim, rebel, civ, goal === 2 ? 'overthrow' : 'independence', civ.capital);
  return rebel;
}

/** merge `from` into `into` (union, annexation, or a victorious overthrow) */
export function absorbCiv(sim: Sim, into: Civ, from: Civ, resent: boolean): void {
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
  // people on the road follow the new flag
  for (const p of sim.parties.values()) if (p.civ === from.id) p.civ = into.id;
  const fr = sim.people.get(from.ruler);
  if (fr) fr.title = TITLE.none;
  from.ruler = -1;
}
export { abandonSettlement, knownCount };
