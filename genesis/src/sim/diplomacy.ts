// Diplomacy: relations grow out of trade, kinship, faith, border friction and remembered wrongs.
// Wars are chosen (or avoided) by weighing motive against cost.
import { clamp, clamp01 } from './rng';
import { addEvent } from './history';
import { Civ, G, GOV, J, RES_GOOD, Relation, Settlement, Sim, TICKS_PER_YEAR, War } from './types';
import { dist } from './world';
import { absorbCiv, civFullName, relationOf, removeCiv } from './civ';
import { fullName } from './people';
import { travelPath } from './parties';

export function addGrievance(sim: Sim, civ: Civ, against: number, kind: string, mag: number, text: string): void {
  civ.grievances.push({ civ: against, kind, mag, tick: sim.tick, text });
  if (civ.grievances.length > 24) {
    civ.grievances.sort((a, b) => b.mag - a.mag);
    civ.grievances.length = 24;
  }
}

export function grievanceHeat(civ: Civ, against: number): number {
  let h = 0;
  for (const g of civ.grievances) if (g.civ === against) h += g.mag;
  return h;
}

export function nearestPair(sim: Sim, a: Civ, b: Civ): { d: number; mine: Settlement | null; theirs: Settlement | null } {
  let d = 1e9, mine: Settlement | null = null, theirs: Settlement | null = null;
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

/** how much force a civ could bring to bear: standing arms plus what it could levy */
export function warPotential(civ: Civ): number {
  const levy = civ.pop * (civ.laws.conscription === 2 ? 0.1 : civ.laws.conscription === 1 ? 0.06 : 0.03);
  return civ.strength + levy * 0.8 * civ.mods.attack * civ.mods.weaponQ * 0.6;
}

function alliesPower(sim: Sim, civ: Civ, against: number): number {
  let p = 0;
  for (const [oid, r] of civ.rel) {
    if (!r.alliance || oid === against) continue;
    const o = sim.civs.get(oid);
    if (o && o.alive) p += warPotential(o) * 0.5;
  }
  return p;
}

export function diplomacySeasonal(sim: Sim, civ: Civ): void {
  const rng = sim.rng;
  const cul = sim.cultures.get(civ.culture)!;
  const rel = civ.religion >= 0 ? sim.religions.get(civ.religion) : undefined;
  const ruler = sim.people.get(civ.ruler);
  let atWar = false;
  for (const [, r] of civ.rel) if (r.war >= 0) atWar = true;
  const myPower = warPotential(civ);
  // land hunger: grown men and women with no land to work and no trade to ply
  let idle = 0, grown = 0;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    idle += s.jobCount[J.laborer];
    grown += s.people.length - s.jobCount[J.child];
  }
  const landHunger = grown > 0 ? clamp01((idle / grown - 0.08) * 3) : 0;
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
    // --- where the relationship is heading ---
    const ocul = sim.cultures.get(o.culture)!;
    const heat = grievanceHeat(civ, oid);
    let t = Math.min(22, r.tradeVal / 40);
    if (o.culture === civ.culture) t += 15;
    else if (ocul.parent === civ.culture || cul.parent === o.culture || (cul.parent >= 0 && cul.parent === ocul.parent)) t += 6;
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
    // a common enemy is the oldest glue
    for (const [tid, tr] of civ.rel) {
      if (tid === oid || tr.war < 0) continue;
      if (o.rel.get(tid)?.war !== undefined && o.rel.get(tid)!.war >= 0) t += 18;
    }
    if (ruler) t += (ruler.comp - 0.5) * 10;
    r.score += (clamp(t, -100, 100) - r.score) * 0.1;
    // --- tribute falls due ---
    if (r.tribute < 0) {
      const pay = Math.min(Math.max(0, civ.treasury), -r.tribute);
      civ.treasury -= pay;
      civ.expense += pay;
      o.treasury += pay;
      o.income += pay;
      if (warPotential(civ) > warPotential(o) * 1.3 && rng.chance(0.05)) {
        r.tribute = 0;
        ro.tribute = 0;
        addEvent(sim, 'diplomacy', 2, `The ${civ.name} stopped paying tribute to the ${o.name}.`, [civ.id, oid], [], civ.capital, -1, -1);
        ro.score -= 25;
      }
    }
    if (civ.isolated || o.isolated) continue;
    // --- pacts ---
    if (!r.tradePact && r.score > 28 && ro.score > 20 && civ.laws.trade > 0 && o.laws.trade > 0 && r.tradeVal > 5 && rng.chance(0.15)) {
      r.tradePact = ro.tradePact = true;
      addEvent(sim, 'treaty', 2, `The ${civ.name} and the ${o.name} signed a trade agreement.`, [civ.id, oid], [], civ.capital, -1, -1);
    } else if (r.tradePact && (r.score < -5 || civ.laws.trade === 0)) {
      r.tradePact = ro.tradePact = false;
      addEvent(sim, 'treaty', 1, `The trade agreement between the ${civ.name} and the ${o.name} has lapsed.`, [civ.id, oid], [], civ.capital, -1, -1);
    }
    if (!r.alliance && r.score > 50 && ro.score > 42 && rng.chance(0.1)) {
      // alliances need a reason: a shared threat
      let threat = false;
      for (const [tid, tr] of civ.rel) {
        if (tid === oid || !tr.contact) continue;
        const otr = o.rel.get(tid);
        if ((tr.score < -25 || tr.war >= 0) && otr && (otr.score < -10 || otr.war >= 0)) threat = true;
      }
      if (threat) {
        r.alliance = ro.alliance = true;
        addEvent(sim, 'treaty', 3, `The ${civFullName(civ)} and the ${civFullName(o)} have sworn a defensive alliance.`, [civ.id, oid], [], civ.capital, -1, -1);
      }
    } else if (r.alliance && r.score < 10) {
      r.alliance = ro.alliance = false;
      addEvent(sim, 'treaty', 2, `The alliance between the ${civ.name} and the ${o.name} is broken.`, [civ.id, oid], [], civ.capital, -1, -1);
    }
    // --- union: old allies of one culture may become one state ---
    if (r.alliance && r.score > 70 && ro.score > 60 && o.culture === civ.culture && civ.pop >= o.pop && civ.rebelOf < 0 && o.rebelOf < 0 && o.gov !== GOV.band && !atWar && rng.chance(0.012)) {
      addEvent(sim, 'union', 4, `By an act of union, the ${civFullName(o)} has joined the ${civFullName(civ)}. Two realms of one people are now one.`, [civ.id, oid], [], civ.capital, -1, -1);
      absorbCiv(sim, civ, o, false);
      removeCiv(sim, o, 'was united with its ally');
      civ.memory.push(`the union with ${o.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
      continue;
    }
    // --- war? ---
    if (atWar || r.alliance || r.tribute > 0 || sim.tick < r.truceUntil || civ.rebelOf >= 0 || civ.pop < 40) continue;
    if (!rng.chance(0.3)) continue;
    // motive
    let scarcity = 0, wantGood = -1;
    for (let g = 0; g < civ.needs.length; g++) {
      if (civ.needs[g] < 0.25) continue;
      // do they have what we lack?
      let theyHave = false;
      for (const sid of o.settlements) {
        const s = sim.settlements.get(sid);
        if (!s) continue;
        if (s.stock[g] > 40 || s.prod[g] > 3) theyHave = true;
        if (!theyHave) for (const m of s.mines) if (RES_GOOD[sim.world.res[m]] === g) theyHave = true;
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
    const tradeDep = clamp01((r.tradeVal * 0.15) / income) * (0.6 + civ.pTrade);
    // what the ruler is like matters: a bold, ambitious one sees openings a cautious one lets pass
    const temper = ruler ? (ruler.amb - 0.5) * 0.5 + (ruler.bold - 0.5) * 0.3 - (ruler.comp - 0.5) * 0.2 : 0;
    let desire = civ.pExpand * 0.45 + civ.pMilitary * 0.3 + scarcity * 0.5 + landHunger * 0.35 + Math.min(0.6, heat * 0.012) + zeal + opportunism + r.friction * 0.4 + temper;
    desire -= r.score / 90 + tradeDep * 0.65 + civ.exhaustion * 1.5 + (r.tradePact ? 0.15 : 0);
    desire *= sim.params.aggression;
    if (desire < 0.7) continue;
    // means: can we win, and can we pay for it?
    const theirPower = warPotential(o) * o.mods.defense + alliesPower(sim, o, civ.id);
    const ratio = (myPower + alliesPower(sim, civ, oid) * 0.6) / (theirPower + 1);
    const nerve = 1.2 - (ruler ? (ruler.bold - 0.5) * 0.5 : 0);
    if (ratio < nerve) {
      // too strong to attack: resentment simmers instead
      continue;
    }
    if (civ.treasury < civ.soldiers * 2 && civ.gov !== GOV.band && civ.gov !== GOV.chiefdom) continue; // cannot afford a campaign
    const np = nearestPair(sim, civ, o);
    if (!np.theirs || (np.d > 45 && civ.mods.seaCap <= 0)) continue;
    // a weak neighbour may be bullied into tribute instead of invaded
    if (ratio > 2.2 && r.tribute === 0 && civ.pTrade > civ.pMilitary && rng.chance(0.6)) {
      const amt = Math.max(2, o.incomeLast * 0.15);
      r.tribute = amt;
      ro.tribute = -amt;
      ro.score -= 20;
      r.truceUntil = ro.truceUntil = sim.tick + 20 * TICKS_PER_YEAR; // protection is what the tribute buys
      addGrievance(sim, o, civ.id, 'tribute', 10, `forced to pay tribute to the ${civ.name}`);
      addEvent(sim, 'diplomacy', 3, `Under threat of invasion, the ${o.name} agreed to pay tribute to the ${civFullName(civ)}.`, [civ.id, oid], [], o.capital, -1, -1);
      continue;
    }
    // is there any way for an army to get there?
    if (!np.mine || !travelPath(sim, np.mine.tile, np.theirs.tile, civ.mods.seaCap > 0, np.mine.portTile)) {
      r.truceUntil = sim.tick + 15 * TICKS_PER_YEAR; // out of reach: stop brooding on it for a while
      continue;
    }
    let goal = 'conquest';
    let target = np.theirs.id;
    if (heat > 25 && heat * 0.012 > scarcity * 0.5 && heat * 0.012 > landHunger * 0.35) goal = 'revenge';
    else if (scarcity > 0.3 && wantGood >= 0) {
      goal = 'resources';
      // aim for the town that has it
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
    } else if (zeal > 0.2) goal = 'holy';
    declareWar(sim, civ, o, goal, target, wantGood, landHunger);
    atWar = true;
  }
}

const GOOD_WORD = ['grain', 'timber', 'stone', 'copper', 'iron', 'coal', 'gold', 'salt', 'oil', 'tools', 'arms', 'luxuries'];

export function declareWar(sim: Sim, att: Civ, def: Civ, goal: string, target: number, good = -1, landFor = 0): War {
  let prior = 0;
  for (const w of sim.wars.values()) if ((w.att === att.id && w.def === def.id) || (w.att === def.id && w.def === att.id)) prior++;
  const ord = ['', 'Second ', 'Third ', 'Fourth ', 'Fifth ', 'Sixth '][Math.min(5, prior)];
  let name: string;
  const ts = sim.settlements.get(target);
  if (goal === 'independence') name = `${att.adj} War of Independence`;
  else if (goal === 'overthrow') name = `${def.adj} Civil War`;
  else if (goal === 'holy') name = `${ord}${att.adj} Holy War`;
  else if (goal === 'resources' && good >= 0) name = `${ord}${cap1(GOOD_WORD[good])} War`;
  else name = `${ord}${att.adj}–${def.adj} War`;
  const war: War = {
    id: sim.nextId++, name, att: att.id, def: def.id, attAllies: [], defAllies: [], start: sim.tick, end: -1, goal, target,
    score: 0, attLoss: 0, defLoss: 0, battles: 0, outcome: '', lastAction: sim.tick, taken: [],
  };
  sim.wars.set(war.id, war);
  const ra = relationOf(sim, att, def.id),
    rb = relationOf(sim, def, att.id);
  ra.war = rb.war = war.id;
  ra.contact = rb.contact = true;
  ra.tradePact = rb.tradePact = false;
  ra.alliance = rb.alliance = false;
  ra.score = Math.min(ra.score, -50);
  rb.score = Math.min(rb.score, -60);
  ra.tribute = rb.tribute = 0;
  // allies honour their word — if they still like you
  if (goal !== 'independence' && goal !== 'overthrow') {
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
  if (goal !== 'independence' && goal !== 'overthrow') {
    let why = '';
    if (goal === 'resources' && good >= 0) why = ` Its people are short of ${GOOD_WORD[good]}, and ${ts ? ts.name : 'the enemy'} has it.`;
    else if (goal === 'revenge') {
      const g = att.grievances.filter((x) => x.civ === def.id).sort((a, b) => b.mag - a.mag)[0];
      why = g ? ` They have not forgotten being ${g.text}.` : '';
    } else if (goal === 'holy') why = ' Its priests call it a holy war.';
    else why = ts ? ` ${landFor > 0.4 ? 'Its landless poor need fields, and its' : 'Its'} armies march on ${ts.name}.` : '';
    const allies = war.defAllies.length ? ` ${war.defAllies.map((id) => 'The ' + sim.civs.get(id)!.name).join(' and ')} stand${war.defAllies.length === 1 ? 's' : ''} with the defenders.` : '';
    const ruler = sim.people.get(att.ruler);
    addEvent(sim, 'war', 4, `${civFullName(att)}${ruler ? ' under ' + fullName(sim, ruler) : ''} declared war on ${civFullName(def)}.${why}${allies}`, [att.id, def.id].concat(war.defAllies, war.attAllies), ruler ? [ruler.id] : [], target, ts ? ts.x : -1, ts ? ts.y : -1);
    addGrievance(sim, def, att.id, 'invasion', 22, `invaded by the ${att.name} in year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1}`);
    att.memory.push(`the ${name} (begun year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1})`);
    def.memory.push(`the ${name} (begun year ${Math.floor(sim.tick / TICKS_PER_YEAR) + 1})`);
  }
  return war;
}

function cap1(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function sidesOf(war: War): { a: number[]; d: number[] } {
  return { a: [war.att].concat(war.attAllies), d: [war.def].concat(war.defAllies) };
}

export function endWar(sim: Sim, war: War, outcome: string): void {
  if (war.end >= 0) return;
  war.end = sim.tick;
  war.outcome = outcome;
  const { a, d } = sidesOf(war);
  const truce = sim.tick + (8 + sim.rng.int(8)) * TICKS_PER_YEAR;
  for (const x of a) {
    for (const y of d) {
      const cx = sim.civs.get(x),
        cy = sim.civs.get(y);
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
export { G, clamp01 };
