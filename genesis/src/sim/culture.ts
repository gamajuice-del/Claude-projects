// Culture and faith. Values drift with what a people actually lives through; long separation makes
// new peoples and tongues; prophets arise from crisis; churches split.
import { clamp01 } from './rng';
import { addEvent, remember } from './history';
import { cap, deityFor, genLanguage, religionName, word } from './names';
import { addFame, fullName } from './people';
import { civPeople } from './civ';
import { Civ, Culture, J, M, Person, Religion, Settlement, Sim, TICKS_PER_YEAR } from './types';
import { TK } from './tech';
import { HILL, SEA, dist, meanTemp } from './world';

export function createCulture(sim: Sim, parent?: Culture): Culture {
  const rng = sim.rng;
  const lang = genLanguage(sim, parent ? parent.lang : -1);
  const v = (base?: number) => clamp01(base !== undefined ? base + rng.gauss() * 0.08 : 0.5 + rng.gauss() * 0.17);
  const c: Culture = {
    id: sim.nextId++, name: '', lang: lang.id, parent: parent ? parent.id : -1, born: sim.tick,
    martial: v(parent?.martial), mercantile: v(parent?.mercantile), pious: v(parent?.pious), communal: v(parent?.communal),
    innovative: v(parent?.innovative), insular: v(parent?.insular), seafaring: v(parent?.seafaring),
    traditions: parent ? parent.traditions.slice(0, 2) : [], style: parent && rng.chance(0.6) ? parent.style : rng.int(5),
  };
  const root = cap(word(lang, rng, 2, 2));
  c.name = root + rng.pick(['i', 'ar', 'an', 'ese', 'ic', 'ish']);
  sim.cultures.set(c.id, c);
  return c;
}

function envOf(sim: Sim, s: Settlement, civ: Civ): string {
  const w = sim.world;
  const t = meanTemp(w, sim.climate, s.tile);
  if (civ.memory.length > 0 && sim.rng.chance(0.3)) {
    const last = civ.memory[civ.memory.length - 1];
    if (/famine|plague|fall|decline|fire|flood|sky/.test(last)) return 'disaster';
  }
  if (s.coastal) return 'coast';
  if (w.moist[s.tile] < 0.2 && t > 16) return 'desert';
  if (t < 3) return 'cold';
  if (w.elev[s.tile] - w.seaLevel + SEA > HILL - 0.05) return 'mountain';
  if (s.forestTiles > s.tiles.length * 0.45) return 'forest';
  if (s.river) return 'river';
  return 'plains';
}

export function createReligion(sim: Sim, founder: Person | null, civ: Civ, s: Settlement, parent?: Religion, envOverride?: string): Religion {
  const rng = sim.rng;
  const cul = sim.cultures.get(civ.culture)!;
  const deity = parent && rng.chance(0.6) ? parent.deity : deityFor(rng, envOverride || envOf(sim, s, civ));
  const r: Religion = {
    id: sim.nextId++, name: religionName(sim, cul.lang, deity), deity, parent: parent ? parent.id : -1, born: sim.tick,
    founder: founder ? founder.id : -1, origin: s.name,
    militant: clamp01((parent ? parent.militant : 0.25 + cul.martial * 0.4) + rng.gauss() * 0.2),
    proselytize: clamp01((parent ? parent.proselytize : 0.4) + rng.gauss() * 0.2),
    ascetic: clamp01(0.5 + rng.gauss() * 0.2), followers: 0,
    color: (rng.int(200) + 40) << 16 | (rng.int(200) + 40) << 8 | (rng.int(200) + 40),
  };
  sim.religions.set(r.id, r);
  return r;
}

function findProphet(sim: Sim, s: Settlement): Person | null {
  let best: Person | null = null,
    bs = 1.05;
  for (let t = 0; t < 30; t++) {
    const p = sim.people.get(s.people[sim.rng.int(s.people.length)]);
    if (!p || p.job === J.child) continue;
    const sc = p.piety + p.cha * 0.8 + (p.job === J.priest ? 0.25 : 0);
    if (sc > bs) {
      bs = sc;
      best = p;
    }
  }
  return best;
}

const TRADITIONS: [keyof Culture, number, string, string][] = [
  ['martial', 0.8, 'The Warrior Code', 'Generations of war have made valour their highest virtue.'],
  ['mercantile', 0.8, 'The Counting Houses', 'Trade is honoured above birth; a deal is sacred.'],
  ['pious', 0.85, 'The Great Pilgrimage', 'Every soul is expected to walk to the holy places once in life.'],
  ['communal', 0.82, 'The Shared Harvest', 'After hard years, no household may feast while another starves.'],
  ['innovative', 0.8, 'The Open Lyceum', 'Questioning the elders is not insolence but duty.'],
  ['insular', 0.86, 'The Closed Gates', 'Strangers are met at the border, and no further.'],
  ['seafaring', 0.78, 'The Sea Road', 'A child learns the tiller before the plough.'],
];

export function cultureSeasonal(sim: Sim, civ: Civ): void {
  const rng = sim.rng;
  const cul = sim.cultures.get(civ.culture);
  if (!cul) return;
  const cap = sim.settlements.get(civ.capital);
  if (!cap) return;
  // --- lived experience bends values ---
  let atWar = false, contacts = 0, heat = 0;
  for (const [, r] of civ.rel) {
    if (r.war >= 0) atWar = true;
    if (r.contact && r.war < 0) contacts++;
  }
  for (const g of civ.grievances) heat += g.mag;
  let trade = 0, hungry = false, sick = false, gini = 0, fishers = 0, scholars = 0, n = 0;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    n++;
    trade += s.tradeVol;
    if (s.hungerMonths > 2) hungry = true;
    if (s.plague > 0) sick = true;
    gini += s.gini;
    fishers += s.jobCount[J.fisher];
    scholars += s.jobCount[J.scholar];
  }
  gini /= n || 1;
  const pop = civ.pop + 1;
  const k = 1;
  cul.martial = clamp01(cul.martial + (atWar ? 0.004 : -0.0015) * k);
  cul.mercantile = clamp01(cul.mercantile + (Math.min(1, trade / (pop * 0.6)) * 0.007 - 0.0018) * k);
  cul.pious = clamp01(cul.pious + ((hungry || sick ? 0.004 : 0) - (civ.tech[TK.science] === 1 ? 0.0025 : 0) + (civ.rulingFaction === 3 ? 0.002 : -0.0003)) * k);
  cul.communal = clamp01(cul.communal + ((hungry ? 0.004 : 0) - (gini > 0.45 ? 0.002 : 0) - (civ.era >= 5 ? 0.001 : 0)) * k);
  cul.innovative = clamp01(cul.innovative + (Math.min(3, contacts) * 0.0012 + Math.min(1, (scholars / pop) * 30) * 0.003 - 0.002 - (contacts === 0 ? 0.001 : 0)) * k);
  cul.insular = clamp01(cul.insular + (Math.min(1, heat / 80) * 0.004 - Math.min(3, contacts) * 0.0008 - Math.min(1, trade / (pop * 0.8)) * 0.003 + (contacts === 0 ? 0.0015 : 0)) * k);
  cul.seafaring = clamp01(cul.seafaring + (Math.min(1, (fishers / pop) * 8) * 0.004 - 0.001) * k);
  // --- traditions crystallise when a value becomes central ---
  if (civ.pop > 80) {
    for (const [key, thr, name, desc] of TRADITIONS) {
      if ((cul[key] as number) > thr && cul.traditions.indexOf(name) < 0) {
        cul.traditions.push(name);
        addEvent(sim, 'tradition', 2, `A tradition has taken root among the ${cul.name} people: ${name}. ${desc}`, [civ.id], [], civ.capital, cap.x, cap.y);
        break;
      }
    }
  }
  // --- a new people: long separation from kin makes a daughter culture with its own tongue ---
  if (civ.pop > 60 && sim.tick - Math.max(civ.founded, cul.born) > 90 * TICKS_PER_YEAR && rng.chance(0.012)) {
    let shared = false;
    for (const o of sim.civs.values()) if (o.alive && o.id !== civ.id && o.culture === civ.culture) shared = true;
    if (shared) {
      const nc = createCulture(sim, cul);
      civPeople(sim, civ, (p) => {
        if (p.culture === cul.id) p.culture = nc.id;
      });
      for (const sid of civ.settlements) {
        const s = sim.settlements.get(sid);
        if (s && s.cultureMajor === cul.id) s.cultureMajor = nc.id;
      }
      civ.culture = nc.id;
      const lang = sim.languages.get(nc.lang)!;
      addEvent(sim, 'culture', 3, `After generations apart from their ${cul.name} kin, the people of the ${civ.name} have become a people of their own: the ${nc.name}, speaking ${lang.name}.`, [civ.id], [], civ.capital, cap.x, cap.y);
    }
  }
  // --- faith ---
  if (civ.religion < 0) {
    if ((civ.tech[TK.mysticism] === 1 || civ.pop > 90) && rng.chance(0.2)) {
      const prophet = findProphet(sim, cap);
      const rel = createReligion(sim, prophet, civ, cap);
      civ.religion = rel.id;
      civPeople(sim, civ, (p) => {
        if (p.religion < 0) p.religion = rel.id;
      });
      for (const sid of civ.settlements) {
        const s = sim.settlements.get(sid);
        if (s && s.religionMajor < 0) s.religionMajor = rel.id;
      }
      if (prophet) {
        addFame(sim, prophet, 6);
        remember(prophet, sim.tick, M.prophet, rel.id);
        addEvent(sim, 'religion', 3, `${fullName(sim, prophet)} of ${cap.name} taught the ${civ.name} to revere ${rel.deity}. The faith is called ${rel.name}.`, [civ.id], [prophet.id], cap.id, cap.x, cap.y);
      } else addEvent(sim, 'religion', 2, `The ${civ.name} have come to revere ${rel.deity}. Their faith is called ${rel.name}.`, [civ.id], [], cap.id, cap.x, cap.y);
    }
    return;
  }
  const rel = sim.religions.get(civ.religion);
  if (!rel) {
    civ.religion = -1;
    return;
  }
  // the ruler's own conversion can carry the state
  const ruler = sim.people.get(civ.ruler);
  if (ruler && ruler.religion >= 0 && ruler.religion !== civ.religion && cap.religionMajor === ruler.religion && rng.chance(0.03)) {
    const nr = sim.religions.get(ruler.religion);
    if (nr) {
      civ.religion = nr.id;
      addEvent(sim, 'religion', 3, `${fullName(sim, ruler)} has made ${nr.name} the faith of the ${civ.name}, setting aside ${rel.name}.`, [civ.id], [ruler.id], cap.id, cap.x, cap.y);
      return;
    }
  }
  // schism: crisis and distance breed prophets with their own reading of the faith
  if (civ.pop > 250 && civ.settlements.length >= 2 && rng.chance(0.004 + (hungry || sick ? 0.01 : 0) + (1 - civ.stability) * 0.01)) {
    let far: Settlement | null = null,
      bd = 0;
    for (const sid of civ.settlements) {
      const s = sim.settlements.get(sid);
      if (!s || s.id === cap.id || s.people.length < 40 || s.religionMajor !== civ.religion) continue;
      const d = dist(s.x, s.y, cap.x, cap.y) + s.unrest * 30;
      if (d > bd) {
        bd = d;
        far = s;
      }
    }
    const prophet = far ? findProphet(sim, far) : null;
    if (far && prophet) {
      const sect = createReligion(sim, prophet, civ, far, rel, hungry || sick ? 'disaster' : undefined);
      let conv = 0;
      for (const id of far.people) {
        const p = sim.people.get(id)!;
        if (p.religion === rel.id && rng.chance(0.35 + prophet.cha * 0.3 - p.piety * 0.1 + (p.happy < 0.45 ? 0.2 : 0))) {
          p.religion = sect.id;
          conv++;
        }
      }
      prophet.religion = sect.id;
      addFame(sim, prophet, 6);
      remember(prophet, sim.tick, M.prophet, sect.id);
      addEvent(sim, 'religion', conv > 80 ? 3 : 2, `Schism! In ${far.name}, ${fullName(sim, prophet)} broke with ${rel.name} and founded ${sect.name}. ${conv} followed.`, [civ.id], [prophet.id], far.id, far.x, far.y);
      if (!civ.laws.tolerance) far.unrest = clamp01(far.unrest + 0.25);
    }
  }
}

export function countFollowers(sim: Sim): void {
  for (const r of sim.religions.values()) r.followers = 0;
  for (const p of sim.people.values()) {
    const r = sim.religions.get(p.religion);
    if (r) r.followers++;
  }
}
