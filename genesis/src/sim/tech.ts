// Technology: a web of discoveries gated by prerequisites AND by what a people's land actually offers.
// Every tech changes concrete simulation modifiers; nothing here is cosmetic.
import { Civ, CivMods, G, R_COAL, R_COPPER, R_IRON, R_OIL, R_SALT, R_STONE, Sim, W_LAND } from './types';
import { HILL, SEA, hasFreshWater, meanTemp } from './world';
import { herdsNear } from './ecology';

export interface CivEnv {
  coastal: boolean;
  river: boolean;
  hills: boolean;
  farmland: boolean;
  forest: boolean;
  domestic: boolean;
  ridable: boolean;
  has: boolean[]; // per resource type: deposit in territory or the good in stock
  pop: number;
  cities: number;
  contacts: number;
  tradeVal: number;
  threatened: boolean;
  arid: boolean;
  metalTools: boolean;
}

export interface TechDef {
  id: number;
  key: string;
  name: string;
  tier: number;
  pre: string[];
  need?: (e: CivEnv) => boolean;
  needText?: string;
  desc: string;
  apply: (m: CivMods) => void;
  want?: (e: CivEnv, c: Civ) => number;
}

export const ERA_NAMES = ['Stone Age', 'Bronze Age', 'Iron Age', 'Medieval', 'Renaissance', 'Industrial', 'Modern', 'Atomic'];
const TIER_COST = [0, 40, 120, 320, 800, 1900, 4200, 8500, 15000];

const defs: Omit<TechDef, 'id'>[] = [
  // tier 0 — everyone starts here
  { key: 'foraging', name: 'Foraging', tier: 0, pre: [], desc: 'Gathering wild plants and small game.', apply: () => {} },
  { key: 'fire', name: 'Fire', tier: 0, pre: [], desc: 'Warmth, cooking, and light.', apply: () => {} },
  { key: 'stonetools', name: 'Stone Tools', tier: 0, pre: [], desc: 'Knapped flint and hafted axes.', apply: () => {} },
  // tier 1
  { key: 'agriculture', name: 'Agriculture', tier: 1, pre: [], need: (e) => e.farmland, needText: 'fertile land with a growing season', desc: 'Sown fields replace wandering. Settlements can farm.', apply: () => {}, want: () => 6 },
  { key: 'husbandry', name: 'Animal Husbandry', tier: 1, pre: [], need: (e) => e.domestic, needText: 'tameable herd animals nearby', desc: 'Herds are kept, not chased. Pastures and pack animals.', apply: (m) => { m.caravanCap += 8; }, want: (e) => (e.arid ? 5 : 3) },
  { key: 'fishing', name: 'Fishing', tier: 1, pre: [], need: (e) => e.coastal, needText: 'a coast or lakeshore', desc: 'Nets, hooks and boats for the shallows.', apply: (m) => { m.fishYield = 1; m.fishRange = 3; }, want: () => 4 },
  { key: 'pottery', name: 'Pottery', tier: 1, pre: ['fire'], desc: 'Fired clay keeps grain dry. Food spoils more slowly.', apply: (m) => { m.storage *= 1.5; } },
  { key: 'weaving', name: 'Weaving', tier: 1, pre: [], desc: 'Cloth, baskets and trade wares.', apply: (m) => { m.craftYield *= 1.15; } },
  { key: 'woodworking', name: 'Woodworking', tier: 1, pre: ['stonetools'], need: (e) => e.forest, needText: 'woodland', desc: 'Timber houses, better axes, denser villages.', apply: (m) => { m.woodYield *= 1.35; m.density = Math.max(m.density, 50); } },
  { key: 'mysticism', name: 'Mysticism', tier: 1, pre: [], desc: 'Shrines and shared rites bind a people together.', apply: (m) => { m.morale += 0.05; } },
  { key: 'archery', name: 'Archery', tier: 1, pre: ['woodworking'], desc: 'The bow: better hunting and deadlier war bands.', apply: (m) => { m.attack *= 1.15; }, want: (e) => (e.threatened ? 3 : 1) },
  // tier 2
  { key: 'mining', name: 'Mining', tier: 2, pre: ['stonetools'], need: (e) => e.hills || e.has[R_COPPER] || e.has[R_IRON], needText: 'hills or ore in the territory', desc: 'Shafts and quarries. Ores and stone can be extracted.', apply: (m) => { m.mineYield = 1; }, want: () => 2.5 },
  { key: 'masonry', name: 'Masonry', tier: 2, pre: ['stonetools'], need: (e) => e.has[R_STONE], needText: 'stone', desc: 'Dressed stone: walls, and sturdier, denser towns.', apply: (m) => { m.wallMax = Math.max(m.wallMax, 1); m.density = Math.max(m.density, 62); }, want: (e) => (e.threatened ? 3 : 1.2) },
  { key: 'wheel', name: 'The Wheel', tier: 2, pre: ['woodworking'], desc: 'Carts and tracks. Caravans carry more, roads appear.', apply: (m) => { m.caravanCap += 14; m.landCost *= 0.8; m.roadLevel = Math.max(m.roadLevel, 1); } },
  { key: 'writing', name: 'Writing', tier: 2, pre: ['pottery', 'mysticism'], need: (e) => e.pop >= 120, needText: 'a society of at least 120 souls', desc: 'Records outlive memory. Research quickens; knowledge is retained.', apply: (m) => { m.research *= 1.25; m.retention += 1; m.admin += 2; }, want: () => 2.5 },
  { key: 'bronze', name: 'Bronze Working', tier: 2, pre: ['mining'], need: (e) => e.has[R_COPPER], needText: 'copper (mined or imported)', desc: 'Metal tools and blades.', apply: (m) => { m.toolQ = Math.max(m.toolQ, 1.3); m.weaponQ = Math.max(m.weaponQ, 1.35); }, want: () => 2.5 },
  { key: 'irrigation', name: 'Irrigation', tier: 2, pre: ['agriculture'], need: (e) => e.river, needText: 'a river or lake beside the fields', desc: 'Canals water the fields. River farms shrug off drought.', apply: (m) => { m.irrigate = true; m.farmYield *= 1.1; }, want: (e) => (e.arid ? 5 : 2) },
  { key: 'sailing', name: 'Sailing', tier: 2, pre: ['woodworking'], need: (e) => e.coastal, needText: 'a coastline', desc: 'Sea trade, deep-water fishing, colonies across the water.', apply: (m) => { m.seaRange = Math.max(m.seaRange, 34); m.seaCap = Math.max(m.seaCap, 40); m.fishRange = 5; m.fishYield *= 1.3; }, want: () => 3 },
  { key: 'riding', name: 'Riding', tier: 2, pre: ['husbandry'], need: (e) => e.ridable, needText: 'a swift, strong herd animal to tame', desc: 'Mounted warriors and couriers. Armies and news travel fast.', apply: (m) => { m.armySpeed *= 1.3; m.attack *= 1.15; m.landCost *= 0.85; m.admin += 1; }, want: (e, c) => 1.5 + c.pMilitary * 3 },
  { key: 'calendar', name: 'Calendar', tier: 2, pre: ['agriculture', 'mysticism'], desc: 'Knowing when to sow and reap.', apply: (m) => { m.farmYield *= 1.1; } },
  // tier 3
  { key: 'ironworking', name: 'Iron Working', tier: 3, pre: ['mining'], need: (e) => e.has[R_IRON] && e.forest, needText: 'iron ore and wood for charcoal', desc: 'Hard, cheap metal for ploughshares and swords.', apply: (m) => { m.toolQ = Math.max(m.toolQ, 1.55); m.weaponQ = Math.max(m.weaponQ, 1.65); }, want: () => 3 },
  { key: 'currency', name: 'Currency', tier: 3, pre: ['writing'], need: (e) => e.cities >= 2 || e.contacts >= 1, needText: 'someone to trade with', desc: 'Coin replaces barter. Markets and tax collection improve.', apply: (m) => { m.taxEff = Math.max(m.taxEff, 0.7); m.market *= 1.3; }, want: (e, c) => 1 + c.pTrade * 4 },
  { key: 'mathematics', name: 'Mathematics', tier: 3, pre: ['writing'], desc: 'Number, measure and proof.', apply: (m) => { m.research *= 1.15; } },
  { key: 'philosophy', name: 'Philosophy', tier: 3, pre: ['writing', 'mysticism'], desc: 'Argument about how to live and rule. Opens the way to republics.', apply: (m) => { m.research *= 1.1; } },
  { key: 'law', name: 'Code of Laws', tier: 3, pre: ['writing'], desc: 'Written law steadies large realms.', apply: (m) => { m.admin += 3; } },
  { key: 'engineering', name: 'Engineering', tier: 3, pre: ['masonry', 'mathematics'], desc: 'Paved roads, bridges, aqueducts and siege engines.', apply: (m) => { m.roadLevel = Math.max(m.roadLevel, 2); m.bridge = true; m.wallMax = Math.max(m.wallMax, 2); m.siege *= 1.4; m.density = Math.max(m.density, 80); } },
  { key: 'shipbuilding', name: 'Shipbuilding', tier: 3, pre: ['sailing'], need: (e) => e.coastal && e.forest, needText: 'a coast and timber', desc: 'Galleys: war fleets and long-haul cargo.', apply: (m) => { m.seaRange = Math.max(m.seaRange, 75); m.seaCap = Math.max(m.seaCap, 100); m.navy = Math.max(m.navy, 1); }, want: (e, c) => 1 + c.pTrade * 2 },
  { key: 'medicine', name: 'Medicine', tier: 3, pre: ['writing'], desc: 'Herbals and surgeons. Fewer die young.', apply: (m) => { m.health += 0.15; } },
  { key: 'tactics', name: 'Tactics', tier: 3, pre: ['law'], desc: 'Drilled formations and supply trains.', apply: (m) => { m.attack *= 1.15; m.morale += 0.1; m.supplyRange += 6; }, want: (e, c) => 0.6 + c.pMilitary * 4 },
  { key: 'plow', name: 'The Plough', tier: 3, pre: ['agriculture', 'husbandry'], need: (e) => e.metalTools, needText: 'metal tools', desc: 'Draft animals turn heavy soil. Each farmer feeds more.', apply: (m) => { m.farmLabor = Math.min(m.farmLabor, 0.75); m.farmYield *= 1.15; }, want: () => 3 },
  // tier 4
  { key: 'bureaucracy', name: 'Bureaucracy', tier: 4, pre: ['law', 'currency'], desc: 'Clerks and ledgers hold an empire together.', apply: (m) => { m.admin += 5; m.taxEff = Math.max(m.taxEff, 0.85); } },
  { key: 'steel', name: 'Steel', tier: 4, pre: ['ironworking', 'engineering'], desc: 'Tempered blades and durable tools.', apply: (m) => { m.toolQ = Math.max(m.toolQ, 1.8); m.weaponQ = Math.max(m.weaponQ, 2.05); } },
  { key: 'mills', name: 'Wind & Water Mills', tier: 4, pre: ['engineering'], desc: 'The first engines: wind and water do the work of many.', apply: (m) => { m.craftYield *= 1.25; m.farmYield *= 1.08; m.energy = Math.max(m.energy, 1.3); } },
  { key: 'guilds', name: 'Guilds', tier: 4, pre: ['currency', 'weaving'], desc: 'Organized crafts and standards.', apply: (m) => { m.craftYield *= 1.25; m.market *= 1.15; } },
  { key: 'navigation', name: 'Navigation', tier: 4, pre: ['shipbuilding', 'mathematics'], desc: 'Compass and chart. Open-sea voyages.', apply: (m) => { m.seaRange = Math.max(m.seaRange, 170); m.seaCap = Math.max(m.seaCap, 180); } },
  { key: 'education', name: 'Universities', tier: 4, pre: ['philosophy', 'mathematics'], desc: 'Institutions of learning that survive their founders.', apply: (m) => { m.research *= 1.3; m.retention += 1; }, want: (e, c) => 1 + c.pScience * 3 },
  { key: 'fortification', name: 'Fortification', tier: 4, pre: ['masonry', 'engineering'], desc: 'Castles and curtain walls.', apply: (m) => { m.wallMax = Math.max(m.wallMax, 3); m.defense *= 1.25; }, want: (e) => (e.threatened ? 4 : 1) },
  { key: 'banking', name: 'Banking', tier: 4, pre: ['currency', 'mathematics'], desc: 'Credit funds ventures and public works.', apply: (m) => { m.market *= 1.2; m.taxEff = Math.max(m.taxEff, 0.9); }, want: (e, c) => 0.8 + c.pTrade * 3 },
  { key: 'croprotation', name: 'Crop Rotation', tier: 4, pre: ['plow', 'calendar'], desc: 'Fields rest and recover. Soil no longer wears out.', apply: (m) => { m.soilCare = 1; m.farmYield *= 1.15; m.farmLabor = Math.min(m.farmLabor, 0.6); } },
  { key: 'theology', name: 'Theology', tier: 4, pre: ['philosophy', 'mysticism'], desc: 'Doctrine and church hierarchy.', apply: (m) => { m.morale += 0.05; }, want: (e, c) => 0.5 + c.pPiety * 3 },
  // tier 5
  { key: 'printing', name: 'Printing Press', tier: 5, pre: ['education', 'guilds'], desc: 'Ideas multiply. Knowledge becomes very hard to lose.', apply: (m) => { m.research *= 1.3; m.retention += 2; } },
  { key: 'gunpowder', name: 'Gunpowder', tier: 5, pre: ['steel', 'education'], need: (e) => e.has[R_SALT] || e.has[R_COAL], needText: 'salt or coal for powder', desc: 'Muskets and cannon. Old walls crumble.', apply: (m) => { m.attack *= 1.4; m.siege *= 1.8; }, want: (e, c) => 1 + c.pMilitary * 4 },
  { key: 'science', name: 'Scientific Method', tier: 5, pre: ['printing', 'mathematics'], desc: 'Experiment replaces authority.', apply: (m) => { m.research *= 1.4; } },
  { key: 'galleons', name: 'Ocean Ships', tier: 5, pre: ['navigation', 'steel'], desc: 'Vessels that cross any sea.', apply: (m) => { m.seaRange = Math.max(m.seaRange, 420); m.seaCap = Math.max(m.seaCap, 300); m.navy = Math.max(m.navy, 2); } },
  { key: 'agronomy', name: 'Agronomy', tier: 5, pre: ['croprotation', 'science'], desc: 'Selective breeding and soil science.', apply: (m) => { m.farmYield *= 1.3; m.farmLabor = Math.min(m.farmLabor, 0.35); } },
  { key: 'economics', name: 'Economics', tier: 5, pre: ['banking', 'printing'], desc: 'Joint-stock ventures and national accounts.', apply: (m) => { m.market *= 1.4; m.taxEff = 1; } },
  // tier 6
  { key: 'steam', name: 'Steam Power', tier: 6, pre: ['science', 'steel'], need: (e) => e.has[R_COAL], needText: 'coal', desc: 'Coal becomes motion. Mines and workshops surge; the sky darkens.', apply: (m) => { m.energy = Math.max(m.energy, 2); m.craftYield *= 1.5; m.mineYield *= 1.5; m.co2 = 1; }, want: () => 4 },
  { key: 'industry', name: 'Factories', tier: 6, pre: ['steam', 'economics'], desc: 'Mass production and crowded cities.', apply: (m) => { m.craftYield *= 1.8; m.density = Math.max(m.density, 120); } },
  { key: 'railways', name: 'Railways', tier: 6, pre: ['steam', 'engineering'], need: (e) => e.has[R_IRON], needText: 'iron for rails', desc: 'Iron roads shrink the land.', apply: (m) => { m.roadLevel = Math.max(m.roadLevel, 3); m.landCost *= 0.35; m.supplyRange += 24; m.armySpeed *= 1.3; } },
  { key: 'rifles', name: 'Rifled Arms', tier: 6, pre: ['gunpowder', 'industry'], desc: 'Accurate, rapid fire.', apply: (m) => { m.attack *= 1.5; m.weaponQ = Math.max(m.weaponQ, 2.6); }, want: (e, c) => 1 + c.pMilitary * 4 },
  { key: 'sanitation', name: 'Sanitation', tier: 6, pre: ['medicine', 'science'], desc: 'Sewers and clean water. Cities stop being death traps.', apply: (m) => { m.health += 0.25; m.density = Math.max(m.density, 150); } },
  { key: 'steamships', name: 'Steamships', tier: 6, pre: ['steam', 'galleons'], desc: 'Iron hulls ignore the wind.', apply: (m) => { m.seaCap = Math.max(m.seaCap, 600); m.navy = Math.max(m.navy, 3); } },
  { key: 'nationalism', name: 'Nationalism', tier: 6, pre: ['printing', 'law'], desc: 'The people become a nation — and minorities grow restless.', apply: (m) => { m.morale += 0.15; } },
  // tier 7
  { key: 'electricity', name: 'Electricity', tier: 7, pre: ['steam', 'science'], desc: 'Light without flame; power at a distance.', apply: (m) => { m.energy = Math.max(m.energy, 3); m.craftYield *= 1.3; m.research *= 1.2; } },
  { key: 'combustion', name: 'Combustion Engine', tier: 7, pre: ['industry'], need: (e) => e.has[R_OIL], needText: 'oil', desc: 'Engines on wheels: trucks, tractors, tanks.', apply: (m) => { m.armySpeed *= 1.5; m.attack *= 1.5; m.landCost *= 0.7; m.co2 += 1; }, want: () => 3 },
  { key: 'mechfarm', name: 'Mechanized Farming', tier: 7, pre: ['combustion', 'agronomy'], desc: 'One farmer feeds a hundred.', apply: (m) => { m.farmLabor = Math.min(m.farmLabor, 0.1); m.farmYield *= 1.3; } },
  { key: 'radio', name: 'Telecommunication', tier: 7, pre: ['electricity'], desc: 'Instant messages bind distant provinces.', apply: (m) => { m.admin += 10; m.research *= 1.15; } },
  { key: 'modmed', name: 'Modern Medicine', tier: 7, pre: ['sanitation', 'electricity'], desc: 'Vaccines and antibiotics.', apply: (m) => { m.health += 0.3; m.lifespan += 10; } },
  // tier 8
  { key: 'computing', name: 'Computing', tier: 8, pre: ['radio', 'science'], desc: 'Thinking machines accelerate everything.', apply: (m) => { m.research *= 1.5; m.market *= 1.3; } },
  { key: 'renewables', name: 'Clean Energy', tier: 8, pre: ['electricity', 'computing'], desc: 'Sun and wind replace smoke.', apply: (m) => { m.co2 *= 0.15; m.energy = Math.max(m.energy, 4); } },
  { key: 'fusion', name: 'Fusion Power', tier: 8, pre: ['computing', 'renewables'], desc: 'A star in a bottle.', apply: (m) => { m.energy = Math.max(m.energy, 6); m.co2 = 0; m.craftYield *= 1.5; } },
  { key: 'genetics', name: 'Genetic Engineering', tier: 8, pre: ['modmed', 'computing'], desc: 'Life itself becomes a craft.', apply: (m) => { m.farmYield *= 1.4; m.lifespan += 15; m.health += 0.1; } },
];

export const TECHS: TechDef[] = defs.map((d, id) => ({ ...d, id }));
export const NT = TECHS.length;
export const TK: Record<string, number> = {};
for (const t of TECHS) TK[t.key] = t.id;
export const TECH_PRE: number[][] = TECHS.map((t) => t.pre.map((k) => TK[k]));

export function techCost(id: number): number {
  return TIER_COST[TECHS[id].tier];
}

export function has(c: Civ, key: string): boolean {
  return c.tech[TK[key]] === 1;
}

export function baseMods(): CivMods {
  return {
    farmYield: 1, farmLabor: 1, irrigate: false, soilCare: 0, fishYield: 0.35, fishRange: 2, woodYield: 1, mineYield: 0.35,
    craftYield: 1, storage: 1, health: 0, research: 1, caravanCap: 12, landCost: 1, seaRange: 0, seaCap: 0, attack: 1, defense: 1,
    morale: 0, wallMax: 0, navy: 0, admin: 3, density: 40, roadLevel: 0, bridge: false, retention: 0, lifespan: 0, toolQ: 1,
    weaponQ: 1, supplyRange: 10, armySpeed: 1, fertility: 1, co2: 0, energy: 1, taxEff: 0.5, market: 1, siege: 1,
  };
}

export function recomputeMods(c: Civ): void {
  const m = baseMods();
  for (const t of TECHS) if (c.tech[t.id] === 1) t.apply(m);
  c.mods = m;
  // era: highest tier in which the civ holds at least two techs
  const cnt = new Array(9).fill(0);
  for (const t of TECHS) if (c.tech[t.id] === 1) cnt[t.tier]++;
  let era = 0;
  for (let tier = 2; tier <= 8; tier++) if (cnt[tier] >= 2) era = tier - 1;
  c.era = era;
}

export function knownCount(c: Civ): number {
  let k = 0;
  for (let i = 0; i < NT; i++) if (c.tech[i] === 1) k++;
  return k;
}

/** what the civ's actual land and circumstances offer — drives which discoveries are even possible */
export function civEnv(sim: Sim, c: Civ): CivEnv {
  const w = sim.world;
  const e: CivEnv = {
    coastal: false, river: false, hills: false, farmland: false, forest: false, domestic: false, ridable: false,
    has: [false, false, false, false, false, false, false, false], pop: c.pop, cities: c.settlements.length, contacts: 0,
    tradeVal: 0, threatened: false, arid: false, metalTools: c.mods.toolQ >= 1.3,
  };
  let farmable = 0, forest = 0, dry = 0, tiles = 0;
  const tmp: import('./types').Herd[] = [];
  for (const sid of c.settlements) {
    const s = sim.settlements.get(sid);
    if (!s || !s.alive) continue;
    if (s.coastal) e.coastal = true;
    if (s.river) e.river = true;
    for (const i of s.tiles) {
      tiles++;
      if (w.elev[i] - w.seaLevel + SEA > HILL) e.hills = true;
      if (w.res[i] && w.resAmt[i] > 0) e.has[w.res[i]] = true;
      if (w.fert[i] > 0.3 && meanTemp(w, sim.climate, i) > 3 && w.moist[i] > 0.18) farmable++;
      if (w.forest[i] > 0.3) forest++;
      if (w.moist[i] < 0.25) dry++;
      if (!e.river && w.river[i] > 0) e.river = true;
    }
    if (s.stock[G.copper] > 1) e.has[R_COPPER] = true;
    if (s.stock[G.iron] > 1) e.has[R_IRON] = true;
    if (s.stock[G.coal] > 1) e.has[R_COAL] = true;
    if (s.stock[G.oil] > 1) e.has[R_OIL] = true;
    if (s.stock[G.salt] > 1) e.has[R_SALT] = true;
    if (s.stock[G.stone] > 5) e.has[R_STONE] = true;
    if (s.stock[G.wood] > 10) forest++;
    herdsNear(sim, s.x, s.y, 12, tmp);
    for (const h of tmp) {
      const sp = sim.species.get(h.sp)!;
      if (sp.domestic) e.domestic = true;
      if (sp.ridable) e.ridable = true;
    }
    if (s.livestock > 5) e.domestic = true;
    if (!e.river && hasFreshWater(w, s.tile)) e.river = true;
  }
  e.farmland = farmable >= 6;
  e.forest = forest >= 3;
  e.arid = tiles > 0 && dry / tiles > 0.5;
  for (const [, r] of c.rel) {
    if (r.contact) e.contacts++;
    e.tradeVal += r.tradeVal;
    if (r.war >= 0 || r.score < -40) e.threatened = true;
  }
  return e;
}

export function canResearch(c: Civ, id: number, e: CivEnv): boolean {
  if (c.tech[id] === 1) return false;
  for (const p of TECH_PRE[id]) if (c.tech[p] !== 1) return false;
  const t = TECHS[id];
  if (t.need && !t.need(e)) return false;
  return true;
}
export { W_LAND };
