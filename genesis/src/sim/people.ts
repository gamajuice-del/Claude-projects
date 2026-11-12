// Individuals: persistent people with heritable personalities, skills, families, ambitions and loyalties.
// Their yearly decisions (work, marriage, migration, faith, politics) are driven by their own circumstances.
import { clamp, clamp01 } from './rng';
import { addEvent, remember } from './history';
import { familyName, givenName } from './names';
import {
  ADULT_AGE, Civ, F, Family, GOAL, Grave, J, M, NJ, Person, Settlement, Sim, TICKS_PER_YEAR, TITLE,
} from './types';

export function ageOf(sim: Sim, p: Person): number {
  return (sim.tick - p.born) / TICKS_PER_YEAR;
}

export function fullName(sim: Sim, p: { name: string; fam: number }): string {
  const f = sim.families.get(p.fam);
  return f ? `${p.name} ${f.name}` : p.name;
}

export function newFamily(sim: Sim, cultureId: number, founder: number, origin: string): Family {
  const cul = sim.cultures.get(cultureId)!;
  const f: Family = { id: sim.nextId++, name: familyName(sim, cul.lang), founder, origin, living: 0, prestige: 0, thrones: 0 };
  sim.families.set(f.id, f);
  return f;
}

export interface NewPerson {
  sex?: number;
  age?: number; // years
  home: number;
  civ: number;
  culture: number;
  religion: number;
  fam?: number;
  mother?: Person;
  father?: Person;
}

export function createPerson(sim: Sim, o: NewPerson): Person {
  const rng = sim.rng;
  const id = sim.nextId++;
  const sex = o.sex ?? (rng.chance(0.5) ? 1 : 0);
  const cul = sim.cultures.get(o.culture)!;
  const mo = o.mother,
    fa = o.father;
  const tr = (a?: number, b?: number) => (a !== undefined && b !== undefined ? clamp01((a + b) / 2 + rng.gauss() * 0.14) : clamp01(0.5 + rng.gauss() * 0.2));
  const age = o.age ?? 0;
  let fam = o.fam;
  const homeName = sim.settlements.get(o.home)?.name ?? 'the wilds';
  if (fam === undefined) fam = fa ? fa.fam : mo ? mo.fam : newFamily(sim, o.culture, id, homeName).id;
  const p: Person = {
    id,
    name: givenName(sim, cul.lang, sex),
    fam, sex,
    born: sim.tick - Math.floor(age * TICKS_PER_YEAR) - (o.age !== undefined ? rng.int(TICKS_PER_YEAR) : 0),
    home: o.home, party: -1, army: -1,
    civ: o.civ, culture: o.culture, religion: o.religion,
    mother: mo ? mo.id : -1, father: fa ? fa.id : -1, spouse: -1, kids: [],
    amb: tr(mo?.amb, fa?.amb), cha: tr(mo?.cha, fa?.cha), bold: tr(mo?.bold, fa?.bold), intl: tr(mo?.intl, fa?.intl),
    comp: tr(mo?.comp, fa?.comp), dil: tr(mo?.dil, fa?.dil), piety: tr(mo?.piety, fa?.piety), greed: tr(mo?.greed, fa?.greed),
    sFarm: 0, sCraft: 0, sFight: 0, sTrade: 0, sLore: 0, sLead: 0,
    job: age >= ADULT_AGE ? J.laborer : J.child,
    wealth: 0, fed: 0.9, health: clamp01(0.85 + rng.gauss() * 0.08), happy: 0.6, loyalty: 0.6, faction: F.commons,
    friends: [], rivals: [], goal: GOAL.family, fame: 0, title: TITLE.none, sick: 0, mem: [],
  };
  // culture leaves its mark on temperament
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

export function pickGoal(sim: Sim, p: Person): number {
  const w = [
    0.5 + p.comp * 0.8, // family
    p.greed * 1.3, // wealth
    p.amb * 1.1 + p.cha * 0.2, // power
    p.intl * 1.2 - 0.25, // knowledge
    p.bold * 0.9 + p.amb * 0.2 - 0.2, // glory
    p.piety * 1.3 - 0.3, // faith
    p.bold * 0.5 - p.comp * 0.3, // wander
  ].map((v) => Math.max(0.02, v) ** 2);
  return sim.rng.weighted(w);
}

export function jobSkill(p: Person, job: number): number {
  switch (job) {
    case J.farmer: case J.fisher: case J.hunter: case J.herder: case J.woodcutter: case J.miner: return p.sFarm;
    case J.artisan: return p.sCraft;
    case J.merchant: return p.sTrade;
    case J.soldier: return p.sFight;
    case J.scholar: return p.sLore;
    case J.priest: return (p.sLore + p.cha) / 2;
    case J.official: return p.sLead;
  }
  return 0.3;
}

export function practice(p: Person, job: number, rate: number): void {
  const r = rate * (0.5 + p.intl * 0.6 + p.dil * 0.4);
  switch (job) {
    case J.farmer: case J.fisher: case J.hunter: case J.herder: case J.woodcutter: case J.miner: p.sFarm += r * (1 - p.sFarm); break;
    case J.artisan: p.sCraft += r * (1 - p.sCraft); break;
    case J.merchant: p.sTrade += r * (1 - p.sTrade); break;
    case J.soldier: p.sFight += r * 0.6 * (1 - p.sFight); p.sLead += r * 0.15 * (1 - p.sLead); break;
    case J.scholar: p.sLore += r * (1 - p.sLore); break;
    case J.priest: p.sLore += r * 0.5 * (1 - p.sLore); p.sLead += r * 0.3 * (1 - p.sLead); break;
    case J.official: p.sLead += r * (1 - p.sLead); break;
  }
}

function aptitude(p: Person, job: number): number {
  switch (job) {
    case J.farmer: case J.herder: return 0.75 + p.sFarm * 0.5 + p.dil * 0.2;
    case J.fisher: case J.hunter: return 0.7 + p.sFarm * 0.4 + p.bold * 0.25;
    case J.woodcutter: case J.miner: return 0.7 + p.sFarm * 0.4 + p.dil * 0.25;
    case J.artisan: return 0.55 + p.sCraft * 0.6 + p.intl * 0.3 + p.dil * 0.15;
    case J.merchant: return 0.4 + p.sTrade * 0.6 + p.greed * 0.35 + p.cha * 0.25;
    case J.soldier: return 0.45 + p.sFight * 0.6 + p.bold * 0.5;
    case J.scholar: return 0.2 + p.sLore * 0.6 + p.intl * 0.9;
    case J.priest: return 0.3 + p.piety * 0.8 + p.cha * 0.3;
    case J.official: return 0.3 + p.sLead * 0.6 + p.amb * 0.4 + p.cha * 0.2;
  }
  return 0.6;
}

const GOAL_JOB: number[][] = [];
GOAL_JOB[GOAL.family] = [J.farmer, J.herder];
GOAL_JOB[GOAL.wealth] = [J.merchant, J.artisan];
GOAL_JOB[GOAL.power] = [J.official, J.soldier, J.priest];
GOAL_JOB[GOAL.knowledge] = [J.scholar];
GOAL_JOB[GOAL.glory] = [J.soldier, J.hunter];
GOAL_JOB[GOAL.faith] = [J.priest];
GOAL_JOB[GOAL.wander] = [J.merchant, J.hunter, J.fisher];

/** context the settlement prepares each month for its people's decisions */
export interface JobCtx {
  slots: number[]; // open positions per job
  wage: number[]; // expected monthly income per job
  subsistence: number;
}

/** pick the occupation with the best expected life for THIS person given open positions */
export function chooseJob(sim: Sim, p: Person, s: Settlement, civ: Civ, ctx: JobCtx, force = false): void {
  if (p.title === TITLE.ruler || p.army >= 0) return;
  const cur = p.job;
  if (!force && civ.laws.serfdom && cur === J.farmer && p.fed > 0.45) return; // bound to the land
  let best = cur === J.child ? J.laborer : cur,
    bestU = -1;
  const parentJob = sim.people.get(p.father)?.job ?? sim.people.get(p.mother)?.job ?? -1;
  const gj = GOAL_JOB[p.goal];
  for (let j = 1; j < NJ; j++) {
    if (j !== cur && ctx.slots[j] <= 0) continue;
    if (j === J.merchant && j !== cur && p.wealth < ctx.subsistence * 6) continue; // needs capital
    if (j === J.scholar && j !== cur && p.intl < 0.5) continue;
    if (j === J.official && j !== cur && p.wealth < ctx.subsistence * 4 && p.sLead < 0.3 && !civ.laws.schooling) continue;
    let u = ctx.wage[j] * aptitude(p, j);
    if (gj.indexOf(j) >= 0) u *= 1.45;
    if (j === parentJob) u *= 1.12;
    if (j === cur) u *= 1.18; // inertia
    if (j === J.laborer) u *= 0.8;
    if (u > bestU) {
      bestU = u;
      best = j;
    }
  }
  if (best !== cur) setJob(sim, p, s, best, ctx);
}

export function setJob(sim: Sim, p: Person, s: Settlement | undefined, job: number, ctx?: JobCtx): void {
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

export function deathChance(sim: Sim, p: Person, age: number, civ: Civ | undefined): number {
  const m = civ?.mods;
  const ht = m ? Math.min(0.85, m.health) : 0;
  let q: number;
  if (age < 1.5) q = 0.11;
  else if (age < 5) q = 0.022;
  else if (age < 15) q = 0.006;
  else if (age < 40) q = 0.0055;
  else if (age < 60) q = 0.012 + (age - 40) * 0.0012;
  else q = 0.04 * Math.pow(1.095, age - 60 - (m ? m.lifespan : 0));
  q *= age < 15 ? 1 - ht * 0.9 : 1 - ht * 0.45;
  q *= 1 + (1 - p.health) * 2.5;
  return Math.min(0.95, q * sim.params.mortality);
}

/** remove a person from the world. Graves are kept for parents of the living and for the notable. */
export function killPerson(sim: Sim, p: Person, cause: string): void {
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
    // inheritance
    sp.wealth += p.wealth * 0.8;
    p.wealth = 0;
  }
  const age = ageOf(sim, p);
  let heirs = 0;
  for (const kid of p.kids) if (sim.people.has(kid)) heirs++;
  for (const kid of p.kids) {
    const c = sim.people.get(kid);
    if (!c) continue;
    if (p.wealth > 0) c.wealth += (p.wealth * 0.9) / heirs;
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
    const g: Grave = {
      id: p.id, name: p.name, fam: p.fam, sex: p.sex, born: p.born, died: sim.tick, cause, mother: p.mother, father: p.father,
      kids: p.kids, civ: p.civ, home: s ? s.name : 'the road', job: p.job, title: p.title, fame: p.fame, mem: p.mem, notable,
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

export function pruneGraves(sim: Sim): void {
  const cutoff = sim.tick - 130 * TICKS_PER_YEAR;
  for (const [id, g] of sim.graves) {
    if (g.notable && g.fame >= 4) continue;
    if (g.died < cutoff) sim.graves.delete(id);
  }
  for (const [id, f] of sim.families) {
    if (f.living <= 0 && f.prestige < 3 && f.thrones === 0) sim.families.delete(id);
  }
}

export function addFame(sim: Sim, p: Person, amount: number): void {
  p.fame += amount;
  const f = sim.families.get(p.fam);
  if (f) f.prestige += amount * 0.5;
}

function isKin(a: Person, b: Person): boolean {
  if (a.mother >= 0 && a.mother === b.mother) return true;
  if (a.father >= 0 && a.father === b.father) return true;
  return a.mother === b.id || a.father === b.id || b.mother === a.id || b.father === a.id;
}

function tryMarry(sim: Sim, p: Person, s: Settlement, age: number): void {
  const rng = sim.rng;
  if (s.people.length < 2) return;
  for (let t = 0; t < 7; t++) {
    const q = sim.people.get(s.people[rng.int(s.people.length)]);
    if (!q || q.id === p.id || q.sex === p.sex || q.spouse >= 0 || q.party >= 0) continue;
    const qa = ageOf(sim, q);
    if (qa < ADULT_AGE + 1 || Math.abs(qa - age) > 14 || isKin(p, q)) continue;
    // like marries like: wealth and faith matter
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

function socialize(sim: Sim, p: Person, s: Settlement): void {
  const rng = sim.rng;
  // drop the dead from lists
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

export function politicalWeight(p: Person): number {
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

function alignFaction(sim: Sim, p: Person): void {
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

/** friends and priests pull people toward their faiths */
function considerFaith(sim: Sim, p: Person, s: Settlement, civ: Civ): void {
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
  // the settlement's majority faith and the state church exert steady pressure
  const pressure = s.religionMajor >= 0 && s.religionMajor !== p.religion ? 0.03 : 0;
  const state = civ.religion >= 0 && civ.religion !== p.religion && !civ.laws.tolerance ? 0.04 : 0;
  if (pressure + state > 0 && rng.chance((pressure + state) * (1.3 - p.piety))) {
    p.religion = state > 0 && rng.chance(0.6) ? civ.religion : s.religionMajor;
    remember(p, sim.tick, M.converted, p.religion);
  }
}

export interface LifeCtx extends JobCtx {
  crowd: number; // pop / housing
  danger: number; // siege, war, plague
  avgWage: number;
  migrate: (p: Person, push: number) => void; // settlement decides destination & batching
}

/** once a year, on their birthday month, each person takes stock of their life */
export function yearlyLife(sim: Sim, p: Person, s: Settlement, civ: Civ, age: number, ctx: LifeCtx): boolean {
  const rng = sim.rng;
  // --- mortality ---
  if (rng.chance(deathChance(sim, p, age, civ)) || age > 97) {
    killPerson(sim, p, age > 62 ? 'old age' : age < 5 ? 'a childhood fever' : p.health < 0.5 ? 'illness' : rng.pick(['an accident', 'a fever', 'illness', 'a wasting sickness']));
    return false;
  }
  p.health = clamp01(p.health + (age > 55 ? -0.015 : 0.03));
  if (age < ADULT_AGE) return true;
  if (p.job === J.child) {
    // coming of age
    p.job = J.laborer;
    s.jobCount[J.child] = Math.max(0, s.jobCount[J.child] - 1);
    s.jobCount[J.laborer]++;
    p.wealth = 1;
    p.sFarm = 0.08;
    p.goal = pickGoal(sim, p);
    chooseJob(sim, p, s, civ, ctx, true);
  }
  if (p.party >= 0 || p.army >= 0) return true;
  // --- family ---
  if (p.spouse < 0 && age < 50 && rng.chance(age < 30 ? 0.45 : 0.2)) tryMarry(sim, p, s, age);
  socialize(sim, p, s);
  alignFaction(sim, p);
  if (rng.chance(0.3)) considerFaith(sim, p, s, civ);
  // --- loyalty follows lived experience ---
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
  // --- work: reconsider when things are going badly, or when ambition beckons ---
  const myWage = ctx.wage[p.job];
  if (p.job === J.laborer || myWage < ctx.avgWage * 0.6 || rng.chance(0.08 + p.amb * 0.1)) chooseJob(sim, p, s, civ, ctx);
  // people who retire from hard labour
  if (age > 68 && p.job !== J.laborer && p.title === TITLE.none && rng.chance(0.3)) setJob(sim, p, s, J.laborer, ctx);
  // --- stay or go? ---
  if (p.title !== TITLE.ruler && p.title !== TITLE.governor && !(p.spouse >= 0 && p.sex === 0)) {
    let push = (1 - p.fed) * 1.6 + (0.5 - p.happy) * 0.8 + (p.job === J.laborer ? 0.2 : 0) + s.unrest * 0.25 + ctx.danger * 0.5 + Math.max(0, ctx.crowd - 0.95) * 1.2;
    push -= 0.32 + Math.min(0.25, age * 0.004) + p.kids.length * 0.02 + (p.title ? 0.4 : 0);
    if (p.goal === GOAL.wander) push += 0.15;
    if (civ.laws.serfdom && p.job === J.farmer && p.fed > 0.4) push -= 0.5;
    if (push > 0.3 - p.bold * 0.25 && rng.chance(clamp(push, 0.05, 0.9))) ctx.migrate(p, push);
  }
  return true;
}

/** a birth to a married couple. Returns the child or null. */
export function tryBirth(sim: Sim, mother: Person, s: Settlement, civ: Civ, chance: number): Person | null {
  const father = sim.people.get(mother.spouse);
  if (!father || father.home !== mother.home) return null;
  let live = 0;
  for (const k of mother.kids) if (sim.people.has(k)) live++;
  if (live >= 4) chance *= live >= 7 ? 0.1 : 0.55;
  if (!sim.rng.chance(chance)) return null;
  // children take the culture of the place they are raised in if both parents are outsiders' children — slow assimilation
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

/** move a person's home (no travel; used on arrival) */
export function rehome(sim: Sim, p: Person, to: Settlement): void {
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

/** detach from home while travelling */
export function leaveHome(sim: Sim, p: Person): void {
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

export function describeDeath(sim: Sim, p: Person, cause: string, imp: number): void {
  const civ = sim.civs.get(p.civ);
  addEvent(sim, 'death', imp, `${fullName(sim, p)} died of ${cause}.`, civ ? [civ.id] : [], [p.id], p.home, -1, -1);
}
