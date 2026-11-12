// Procedural languages. Every culture speaks a language with its own phonology; daughter languages
// inherit and shift sounds, so related peoples have related-sounding names.
import { RNG } from './rng';
import { GOV, Language, Sim } from './types';

const CONS = ['p', 't', 'k', 'b', 'd', 'g', 'm', 'n', 's', 'z', 'sh', 'th', 'f', 'v', 'h', 'l', 'r', 'y', 'w', 'ch', 'j', 'kh', 'ts', 'q', 'x', 'zh', 'br', 'dr', 'kr', 'tr', 'st', 'sk', 'gl', 'vr', 'ny', 'mb'];
const VOWS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ai', 'ou', 'ia', 'ei', 'oa', 'au', 'ee', 'uu', 'y'];
const CODAS = ['n', 'r', 'l', 's', 'm', 'th', 'k', 'sh', 'd', 'x', 'rn', 'nd', 'ng', 'st', 't', 'rk', 'ld', 'ss'];
const PATS = ['CV', 'CVC', 'V', 'VC', 'CVV', 'CV', 'CVC'];
const PLACE_SUF = ['a', 'ar', 'en', 'os', 'ia', 'um', 'eth', 'ora', 'gard', 'ton', 'holm', 'ak', 'ur', 'esh', 'ana', 'mar', 'dun', 'heim', 'pol', 'abad', 'wick', 'ford', 'is', 'ost', 'ika', 'var', 'tal', 'kesh', 'mouth', 'zan'];
const MALE_SUF = ['', 'o', 'us', 'an', 'ar', 'ik', 'or', 'en', 'ek', 'im', 'ul', 'as', 'ir', 'und', 'ric'];
const FEM_SUF = ['a', 'e', 'i', 'ia', 'ys', 'ra', 'el', 'ina', 'eth', 'wen', 'ane', 'isa', 'iel', 'ue', 'ali'];
const SHIFTS: [string, string][] = [['p', 'b'], ['k', 'g'], ['t', 'd'], ['s', 'sh'], ['t', 'th'], ['k', 'kh'], ['b', 'v'], ['g', 'h'], ['s', 'z'], ['d', 'j'], ['f', 'h'], ['l', 'r'], ['r', 'l'], ['ch', 'ts'], ['sh', 'zh'], ['v', 'w'], ['q', 'k'], ['x', 'kh']];

function sample<T>(rng: RNG, pool: readonly T[], k: number): T[] {
  const a = pool.slice();
  rng.shuffle(a);
  return a.slice(0, k);
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function genLanguage(sim: Sim, parent = -1): Language {
  const rng = sim.rng;
  const id = sim.nextId++;
  let lang: Language;
  const p = parent >= 0 ? sim.languages.get(parent) : undefined;
  if (p) {
    // daughter language: a few regular sound shifts and some new endings
    let cons = p.cons.slice();
    const nshift = 1 + rng.int(3);
    for (let k = 0; k < nshift; k++) {
      const [a, b] = rng.pick(SHIFTS);
      cons = cons.map((c) => (c === a ? b : c));
    }
    cons = Array.from(new Set(cons));
    if (rng.chance(0.6)) cons.push(rng.pick(CONS));
    const vowels = p.vowels.slice();
    if (rng.chance(0.7)) vowels[rng.int(vowels.length)] = rng.pick(VOWS);
    const placeSuf = p.placeSuf.slice();
    placeSuf[rng.int(placeSuf.length)] = rng.pick(PLACE_SUF);
    const maleSuf = p.maleSuf.slice();
    maleSuf[rng.int(maleSuf.length)] = rng.pick(MALE_SUF);
    const femSuf = p.femSuf.slice();
    femSuf[rng.int(femSuf.length)] = rng.pick(FEM_SUF);
    lang = { id, name: '', parent, cons: Array.from(new Set(cons)), vowels: Array.from(new Set(vowels)), codas: p.codas.slice(), pat: p.pat.slice(), placeSuf, maleSuf, femSuf };
  } else {
    lang = {
      id, name: '', parent: -1,
      cons: sample(rng, CONS, 7 + rng.int(6)),
      vowels: sample(rng, VOWS, 3 + rng.int(3)),
      codas: sample(rng, CODAS, 3 + rng.int(4)),
      pat: sample(rng, PATS, 2 + rng.int(3)),
      placeSuf: sample(rng, PLACE_SUF, 4 + rng.int(3)),
      maleSuf: sample(rng, MALE_SUF, 4),
      femSuf: sample(rng, FEM_SUF, 4),
    };
  }
  sim.languages.set(id, lang);
  lang.name = cap(word(lang, rng, 2, 2)) + rng.pick(['ic', 'ish', 'i', 'ese', 'an', 'ar']);
  return lang;
}

function syllable(l: Language, rng: RNG): string {
  const pat = rng.pick(l.pat);
  let s = '';
  for (let k = 0; k < pat.length; k++) {
    const ch = pat[k];
    if (ch === 'C') s += k === pat.length - 1 && pat.length > 1 ? rng.pick(l.codas) : rng.pick(l.cons);
    else s += rng.pick(l.vowels);
  }
  return s;
}

export function word(l: Language, rng: RNG, minSyl: number, maxSyl: number): string {
  const ns = minSyl + rng.int(maxSyl - minSyl + 1);
  let s = '';
  for (let k = 0; k < ns; k++) s += syllable(l, rng);
  // tidy: collapse triple letters and awkward doubles
  s = s.replace(/(.)\1\1+/g, '$1$1').replace(/([aeiouy])\1([aeiouy])/g, '$1$2');
  if (s.length > 11) s = s.slice(0, 10);
  return s;
}

function unique(sim: Sim, base: string, make: () => string): string {
  let name = base;
  for (let tries = 0; tries < 6 && sim.usedNames.has(name); tries++) name = make();
  const c = sim.usedNames.get(name) || 0;
  sim.usedNames.set(name, c + 1);
  return c > 0 ? `${name} ${['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][Math.min(6, c - 1)]}` : name;
}

export function givenName(sim: Sim, langId: number, sex: number): string {
  const l = sim.languages.get(langId)!;
  const rng = sim.rng;
  let s = word(l, rng, 1, 2);
  if (s.length < 3) s += syllable(l, rng);
  s += rng.pick(sex === 1 ? l.maleSuf : l.femSuf);
  return cap(s);
}

export function familyName(sim: Sim, langId: number): string {
  const l = sim.languages.get(langId)!;
  const rng = sim.rng;
  const mk = () => cap(word(l, rng, 2, 3));
  return unique(sim, mk(), mk);
}

export function placeName(sim: Sim, langId: number): string {
  const l = sim.languages.get(langId)!;
  const rng = sim.rng;
  const mk = () => cap(word(l, rng, 1, 2) + rng.pick(l.placeSuf));
  return unique(sim, mk(), mk);
}

export function rootName(sim: Sim, langId: number): string {
  const l = sim.languages.get(langId)!;
  const rng = sim.rng;
  const mk = () => cap(word(l, rng, 2, 3));
  return unique(sim, mk(), mk);
}

export function demonym(root: string): string {
  const last = root[root.length - 1];
  if ('aeiou'.includes(last)) return root + 'n';
  if (last === 'n' || last === 'r') return root + 'i';
  if (last === 's' || last === 'h') return root + 'ite';
  return root + 'ian';
}

export function civTitle(gov: number, name: string, nSettlements: number): string {
  switch (gov) {
    case GOV.band: return `${name} Band`;
    case GOV.chiefdom: return `${name} Tribes`;
    case GOV.monarchy: return nSettlements >= 8 ? `${name} Empire` : `Kingdom of ${name}`;
    case GOV.oligarchy: return `${name} League`;
    case GOV.republic: return `Republic of ${name}`;
    case GOV.theocracy: return `Holy See of ${name}`;
    case GOV.junta: return `${name} Dominion`;
    case GOV.democracy: return `${name} Commonwealth`;
  }
  return name;
}

export function rulerTitle(gov: number, sex: number, nSettlements: number): string {
  switch (gov) {
    case GOV.band: return 'Elder';
    case GOV.chiefdom: return sex ? 'Chief' : 'Chieftess';
    case GOV.monarchy: return nSettlements >= 8 ? (sex ? 'Emperor' : 'Empress') : sex ? 'King' : 'Queen';
    case GOV.oligarchy: return 'Doge';
    case GOV.republic: return 'Consul';
    case GOV.theocracy: return sex ? 'Hierophant' : 'Hierophantess';
    case GOV.junta: return 'Marshal';
    case GOV.democracy: return 'Premier';
  }
  return 'Leader';
}

const SP_ADJ_COLD = ['Frost', 'Snow', 'Ice', 'Boreal', 'Pale', 'Winter', 'Woolly'];
const SP_ADJ_TEMP = ['Meadow', 'Hill', 'Wood', 'River', 'Grey', 'Red', 'Dusk', 'Moss'];
const SP_ADJ_HOT = ['Dune', 'Sun', 'Sand', 'Jungle', 'Ember', 'Golden', 'Mist', 'Thorn'];
const SP_NOUN = [
  ['Elk', 'Aurochs', 'Antelope', 'Bison', 'Tarpan', 'Ibex', 'Mouflon', 'Gaur', 'Oryx', 'Saiga'],
  ['Wolf', 'Lion', 'Bear', 'Lynx', 'Hyena', 'Panther', 'Dhole', 'Sabrecat'],
  ['Hare', 'Fox', 'Boar', 'Marmot', 'Badger', 'Tapir'],
  ['Mammoth', 'Rhino', 'Groundsloth', 'Titanox', 'Behemoth'],
  ['Moa', 'Crane', 'Ostrich', 'Terrorbird'],
];
export function speciesName(sim: Sim, shape: number, temp: number): string {
  const rng = sim.rng;
  const adj = temp < 5 ? SP_ADJ_COLD : temp < 19 ? SP_ADJ_TEMP : SP_ADJ_HOT;
  const mk = () => `${rng.pick(adj)} ${rng.pick(SP_NOUN[shape] || SP_NOUN[0])}`;
  return unique(sim, mk(), mk);
}

const DEITIES_BY_ENV: Record<string, string[]> = {
  coast: ['the Tide Mother', 'the Deep Father', 'the Salt Serpent', 'the Pearl Queen'],
  desert: ['the Unblinking Sun', 'the Sand Walker', 'the Noon King'],
  forest: ['the Green Antler', 'the Root Mother', 'the Thousand Leaves'],
  cold: ['the White Wolf', 'the Winter Crone', 'the Hearth Keeper'],
  mountain: ['the Stone Father', 'the Thunder Peak', 'the Sky Forge'],
  river: ['the River Bride', 'the Flood Bringer', 'the Reed King'],
  plains: ['the Sky Rider', 'the Great Herd', 'the Grain Mother', 'the Endless Wind'],
  disaster: ['the Burning Eye', 'the Devourer', 'the Hand From Above', 'the Wrathful Sky'],
  ancestors: ['the Honored Dead', 'the First Mothers', 'the Sleeping Kings'],
  star: ['the Seven Stars', 'the Moon Weaver', 'the Wandering Light'],
};
export function deityFor(rng: RNG, env: string): string {
  const pool = DEITIES_BY_ENV[env] || DEITIES_BY_ENV.star;
  return rng.pick(rng.chance(0.75) ? pool : rng.chance(0.5) ? DEITIES_BY_ENV.ancestors : DEITIES_BY_ENV.star);
}
export function religionName(sim: Sim, langId: number, deity: string): string {
  const l = sim.languages.get(langId)!;
  const rng = sim.rng;
  const root = cap(word(l, rng, 2, 2));
  const mk = () => rng.pick([`${root}ism`, `Faith of ${deity.replace(/^the /, 'the ')}`, `The ${root} Way`, `Cult of ${deity}`, `${root}ite Creed`]);
  return unique(sim, mk(), mk);
}
