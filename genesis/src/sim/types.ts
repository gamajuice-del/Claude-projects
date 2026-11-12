// Shared data model for the whole simulation. Everything in `Sim` is plain data
// (objects, arrays, typed arrays, Maps) so it can be serialized and restored exactly.
import type { RNG } from './rng';

export const TICKS_PER_MONTH = 4;
export const TICKS_PER_YEAR = 48;
export const ADULT_AGE = 15;

// ---------- tiles ----------
export const W_LAND = 0,
  W_OCEAN = 1,
  W_LAKE = 2;

export const Biome = {
  Ocean: 0,
  Shallows: 1,
  Lake: 2,
  SeaIce: 3,
  Beach: 4,
  Ice: 5,
  Tundra: 6,
  Taiga: 7,
  Steppe: 8,
  Grassland: 9,
  Forest: 10,
  Swamp: 11,
  Desert: 12,
  Savanna: 13,
  DryForest: 14,
  Rainforest: 15,
  Hills: 16,
  Mountain: 17,
  SnowPeak: 18,
  Volcano: 19,
} as const;
export const BIOME_NAMES = [
  'Ocean', 'Shallows', 'Lake', 'Sea ice', 'Beach', 'Ice sheet', 'Tundra', 'Taiga', 'Steppe', 'Grassland', 'Temperate forest',
  'Swamp', 'Desert', 'Savanna', 'Dry forest', 'Rainforest', 'Hills', 'Mountains', 'Snow peaks', 'Volcano',
];

// resources (tile deposits)
export const R_NONE = 0, R_STONE = 1, R_COPPER = 2, R_IRON = 3, R_COAL = 4, R_GOLD = 5, R_SALT = 6, R_OIL = 7;
export const RES_NAMES = ['None', 'Stone', 'Copper', 'Iron', 'Coal', 'Gold', 'Salt', 'Oil'];

// improvements
export const I_NONE = 0, I_FARM = 1, I_PASTURE = 2, I_MINE = 3, I_CAMP = 4, I_URBAN = 5, I_RUIN = 6, I_PORT = 7, I_FORT = 8, I_SCORCHED = 9;
export const IMP_NAMES = ['None', 'Farmland', 'Pasture', 'Mine', 'Lumber camp', 'Town', 'Ruins', 'Harbor', 'Fort', 'Scorched earth'];

// ---------- goods ----------
export const G = { food: 0, wood: 1, stone: 2, copper: 3, iron: 4, coal: 5, gold: 6, salt: 7, oil: 8, tools: 9, weapons: 10, wares: 11 } as const;
export const NG = 12;
export const GOOD_NAMES = ['Food', 'Wood', 'Stone', 'Copper', 'Iron', 'Coal', 'Gold', 'Salt', 'Oil', 'Tools', 'Weapons', 'Wares'];
export const GOOD_BASE = [1, 0.8, 1, 4, 5, 3, 20, 3, 6, 6, 10, 5];
export const GOOD_BULK = [1, 1.5, 2, 1, 1, 1.5, 0.05, 0.5, 1, 0.5, 0.5, 0.3];
// which good a deposit yields
export const RES_GOOD = [-1, G.stone, G.copper, G.iron, G.coal, G.gold, G.salt, G.oil];

// ---------- jobs ----------
export const J = {
  child: 0, farmer: 1, fisher: 2, hunter: 3, herder: 4, woodcutter: 5, miner: 6, artisan: 7,
  merchant: 8, soldier: 9, scholar: 10, priest: 11, official: 12, laborer: 13,
} as const;
export const NJ = 14;
export const JOB_NAMES = ['Child', 'Farmer', 'Fisher', 'Hunter', 'Herder', 'Woodcutter', 'Miner', 'Artisan', 'Merchant', 'Soldier', 'Scholar', 'Priest', 'Official', 'Laborer'];

// ---------- buildings ----------
export const B = {
  granary: 0, market: 1, workshop: 2, temple: 3, library: 4, walls: 5, barracks: 6, port: 7, mill: 8,
  school: 9, factory: 10, power: 11, hospital: 12, palace: 13,
} as const;
export const NB = 14;
export const BLD_NAMES = ['Granary', 'Market', 'Workshop', 'Temple', 'Library', 'Walls', 'Barracks', 'Harbor', 'Mill', 'Academy', 'Factory', 'Power plant', 'Hospital', 'Palace'];

// ---------- factions / government ----------
export const F = { crown: 0, military: 1, guilds: 2, clergy: 3, commons: 4 } as const;
export const NF = 5;
export const FACTION_NAMES = ['Crown loyalists', 'War party', 'Guilds & merchants', 'Clergy', 'Commoners'];

export const GOV = { band: 0, chiefdom: 1, monarchy: 2, oligarchy: 3, republic: 4, theocracy: 5, junta: 6, democracy: 7 } as const;
export const GOV_NAMES = ['Tribal band', 'Chiefdom', 'Monarchy', 'Merchant oligarchy', 'Republic', 'Theocracy', 'Military junta', 'Democracy'];

export const TITLE = { none: 0, ruler: 1, governor: 2, general: 3, highPriest: 4, noble: 5, heir: 6 } as const;
export const TITLE_NAMES = ['', 'Ruler', 'Governor', 'General', 'High Priest', 'Noble', 'Heir'];

export const GOAL = { family: 0, wealth: 1, power: 2, knowledge: 3, glory: 4, faith: 5, wander: 6 } as const;
export const GOAL_NAMES = ['a thriving family', 'great wealth', 'power over others', 'knowledge', 'glory in battle', 'devotion to the divine', 'seeing the world'];

// memory codes (person life events). stored as flat triples [tick, code, ref]
export const M = {
  born: 0, married: 1, child: 2, job: 3, migrated: 4, fled: 5, battle: 6, widowed: 7, lostChild: 8, founded: 9,
  ruler: 10, invented: 11, rebelled: 12, enriched: 13, ruined: 14, starved: 15, converted: 16, general: 17,
  conquered: 18, plague: 19, blessed: 20, cursed: 21, governor: 22, prophet: 23, friend: 24, rival: 25, wounded: 26,
  conscripted: 27, lostParent: 28, deposed: 29, heir: 30, settled: 31, priest: 32,
} as const;

// ---------- entities ----------
export interface Person {
  id: number;
  name: string;
  fam: number;
  sex: number; // 0 female, 1 male
  born: number; // tick
  home: number; // settlement id (or -1 while homeless in a party)
  party: number; // travelling party id or -1
  army: number; // army id or -1
  civ: number;
  culture: number;
  religion: number;
  mother: number;
  father: number;
  spouse: number;
  kids: number[];
  // personality, 0..1
  amb: number;
  cha: number;
  bold: number;
  intl: number;
  comp: number;
  dil: number;
  piety: number;
  greed: number;
  // skills, 0..1
  sFarm: number;
  sCraft: number;
  sFight: number;
  sTrade: number;
  sLore: number;
  sLead: number;
  job: number;
  wealth: number;
  fed: number; // 0..1 food security (moving average)
  health: number;
  happy: number;
  loyalty: number;
  faction: number;
  friends: number[];
  rivals: number[];
  goal: number;
  fame: number;
  title: number;
  sick: number; // months of illness remaining
  mem: number[];
}

/** kept for the dead who matter to the living or to history */
export interface Grave {
  id: number;
  name: string;
  fam: number;
  sex: number;
  born: number;
  died: number;
  cause: string;
  mother: number;
  father: number;
  kids: number[];
  civ: number;
  home: string;
  job: number;
  title: number;
  fame: number;
  mem: number[];
  notable: boolean;
}

export interface Family {
  id: number;
  name: string;
  founder: number;
  origin: string;
  living: number;
  prestige: number;
  thrones: number; // rulers produced
}

export interface Construction {
  type: number;
  progress: number;
  need: number;
}

export interface Settlement {
  id: number;
  name: string;
  civ: number;
  x: number;
  y: number;
  tile: number;
  founded: number;
  alive: boolean;
  people: number[];
  radius: number;
  tiles: number[];
  farms: number[];
  urban: number[];
  mines: number[];
  stock: number[];
  price: number[];
  demand: number[];
  prod: number[]; // last month production per good
  jobCount: number[];
  wage: number[];
  bld: number[];
  build: Construction | null;
  unrest: number;
  livestock: number;
  toolQ: number;
  weaponQ: number;
  siege: number; // besieging army id or -1
  siegeMonths: number;
  occupier: number; // civ id occupying or -1
  originalCiv: number;
  governor: number;
  coastal: boolean;
  river: boolean;
  wildCap: number;
  hungerMonths: number;
  starved: number; // deaths from starvation in the current episode
  plague: number; // infected count estimate (0 = none)
  lastRaid: number;
  tradeVol: number; // rolling trade value
  imports: number[]; // rolling monthly imports per good
  routes: number[];
  fedAvg: number;
  happyAvg: number;
  wealthAvg: number;
  gini: number;
  housing: number;
  cultureMajor: number;
  religionMajor: number;
  damage: number; // 0..1 structural damage awaiting reconstruction
  portTile: number;
  growthNote: number;
  blockaded: boolean;
  lastPlague: number;
  peakPop: number;
  drought: number;
  farmable: number;
  waterTiles: number;
  forestTiles: number;
  pastureCap: number;
  loyalAvg: number;
  rebelHeat: number;
}

export interface Relation {
  score: number; // -100..100
  war: number; // war id or -1
  truceUntil: number;
  tradePact: boolean;
  alliance: boolean;
  contact: boolean;
  tradeVal: number; // rolling trade value
  friction: number;
  lastWar: number;
  tribute: number; // + they pay us per month
}

export interface Grievance {
  civ: number;
  kind: string;
  mag: number;
  tick: number;
  text: string;
}

export interface Laws {
  tax: number; // 0.05..0.5
  conscription: number; // 0 volunteers, 1 levy, 2 total
  trade: number; // 0 closed, 1 tariffs, 2 free
  dole: boolean;
  serfdom: boolean;
  tolerance: boolean;
  schooling: boolean;
  elective: boolean;
}

export interface CivMods {
  farmYield: number;
  farmLabor: number;
  irrigate: boolean;
  soilCare: number;
  fishYield: number;
  fishRange: number;
  woodYield: number;
  mineYield: number;
  craftYield: number;
  storage: number;
  health: number;
  research: number;
  caravanCap: number;
  landCost: number;
  seaRange: number;
  seaCap: number;
  attack: number;
  defense: number;
  morale: number;
  wallMax: number;
  navy: number;
  admin: number;
  density: number;
  roadLevel: number;
  bridge: boolean;
  retention: number;
  lifespan: number;
  toolQ: number;
  weaponQ: number;
  supplyRange: number;
  armySpeed: number;
  fertility: number;
  co2: number;
  energy: number;
  taxEff: number;
  market: number;
  siege: number;
}

export interface Civ {
  id: number;
  name: string;
  adj: string;
  color: number; // palette index
  hue: number;
  alive: boolean;
  founded: number;
  ended: number;
  parent: number;
  capital: number;
  settlements: number[];
  ruler: number;
  dynasty: number;
  gov: number;
  laws: Laws;
  lawCooldown: number;
  factions: number[];
  rulingFaction: number;
  culture: number;
  religion: number;
  tech: number[]; // 0 unknown, 1 known, 2 lost
  research: number[]; // progress per tech
  researching: number;
  treasury: number;
  income: number;
  expense: number;
  incomeLast: number;
  expenseLast: number;
  rel: Map<number, Relation>;
  grievances: Grievance[];
  armies: number[];
  stability: number;
  legitimacy: number;
  exhaustion: number;
  identity: number;
  era: number;
  pop: number;
  soldiers: number;
  strength: number;
  soldierTarget: number;
  // policy weights derived from culture/ruler/faction (0..1)
  pExpand: number;
  pMilitary: number;
  pTrade: number;
  pScience: number;
  pPiety: number;
  isolated: boolean; // experiment flag
  rebelOf: number; // parent civ if this began as a rebellion
  rebelGoal: number; // 0 none, 1 independence, 2 overthrow
  needs: number[]; // per-good scarcity signal 0..1
  lastSettle: number;
  memory: string[]; // collective memory lines
  peakPop: number;
  golden: number;
  federation: number;
  mods: CivMods;
}

export interface War {
  id: number;
  name: string;
  att: number;
  def: number;
  attAllies: number[];
  defAllies: number[];
  start: number;
  end: number;
  goal: string; // conquest, resources, independence, overthrow, holy, revenge, tribute
  target: number; // settlement id or -1
  score: number; // + attacker winning
  attLoss: number;
  defLoss: number;
  battles: number;
  outcome: string;
  lastAction: number;
}

export interface Army {
  id: number;
  civ: number;
  name: string;
  general: number;
  soldiers: number[];
  x: number;
  y: number;
  path: number[];
  pi: number;
  goal: number; // 0 idle, 1 siege settlement, 2 defend settlement, 3 intercept army, 4 retreat home, 5 disband
  target: number;
  home: number;
  supply: number; // months of food carried
  morale: number;
  atSea: boolean;
  fighting: number; // ticks of ongoing battle flash (for rendering + lockout)
  war: number;
  raised: number;
  kills: number;
  losses: number;
  wait: number;
  foe: number; // army id currently fought, or -1
  bLoss: number; // losses in the current battle
  bStart: number; // strength when the battle began
  bTick: number;
  moveAcc: number;
}

export const PARTY = { migrants: 0, settlers: 1, caravan: 2, refugees: 3 } as const;

export interface Party {
  id: number;
  kind: number;
  civ: number;
  x: number;
  y: number;
  path: number[];
  pi: number;
  from: number;
  to: number; // settlement id, or -1 when heading to a site
  tx: number;
  ty: number;
  people: number[];
  good: number;
  qty: number;
  paid: number;
  owner: number; // merchant person id
  sea: boolean;
  returning: boolean;
  plague: boolean;
  route: number;
  acc: number;
}

export interface Route {
  id: number;
  a: number;
  b: number;
  path: number[];
  sea: boolean;
  len: number;
  cost: number; // per bulk unit
  usage: number;
  built: number; // index along path up to which road is built at current level
}

export interface Species {
  id: number;
  name: string;
  parent: number;
  born: number;
  extinct: number;
  diet: number; // 0 herbivore, 1 carnivore, 2 omnivore
  size: number; // 0..1
  speed: number;
  cold: number; // preferred temp °C
  fecund: number;
  fierce: number;
  herd: number; // typical group size
  color: number; // rgb packed
  shape: number; // sprite family 0 grazer 1 predator 2 small 3 giant 4 bird
  domestic: boolean;
  ridable: boolean;
  count: number;
  made: boolean; // created by the player
}

export interface Herd {
  id: number;
  sp: number;
  x: number;
  y: number;
  n: number;
  energy: number;
  // genes drift per herd; selection acts on them
  size: number;
  speed: number;
  cold: number;
  fecund: number;
  fierce: number;
  tx: number;
  ty: number;
}

export interface Storm {
  id: number;
  kind: number; // 0 rain, 1 thunder, 2 blizzard, 3 hurricane
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  power: number;
  life: number;
}

export interface Culture {
  id: number;
  name: string;
  lang: number;
  parent: number;
  born: number;
  // values 0..1
  martial: number;
  mercantile: number;
  pious: number;
  communal: number;
  innovative: number;
  insular: number;
  seafaring: number;
  traditions: string[];
  style: number; // architecture palette
}

export interface Religion {
  id: number;
  name: string;
  deity: string;
  parent: number;
  born: number;
  founder: number;
  origin: string;
  militant: number; // 0..1
  proselytize: number;
  ascetic: number;
  followers: number;
  color: number;
}

export interface Language {
  id: number;
  name: string;
  parent: number;
  cons: string[];
  vowels: string[];
  codas: string[];
  pat: string[];
  placeSuf: string[];
  maleSuf: string[];
  femSuf: string[];
}

export interface HistEvent {
  id: number;
  t: number;
  kind: string;
  imp: number; // 1..5
  text: string;
  civs: number[];
  people: number[];
  settlement: number;
  x: number;
  y: number;
}

export interface Ruin {
  id: number;
  name: string;
  x: number;
  y: number;
  tile: number;
  fell: number;
  civName: string;
  techs: number[];
  peak: number;
}

export interface Climate {
  tempOffset: number; // global °C deviation
  drift: number; // slow random walk component
  rainMult: number;
  co2: number;
  dust: number; // volcanic / impact winter
  godTemp: number; // player slider
  godRain: number; // player slider
  seaBase: number;
  phases: number[];
}

export interface Params {
  birthRate: number;
  mortality: number;
  aggression: number;
  research: number;
  disasters: number;
  climateVolatility: number;
  wildlife: number;
  growth: number; // plant growth
  popCap: number;
  tradeZeal: number;
  unrest: number;
}

export interface StatSeries {
  year: number[];
  pop: number[];
  civs: number[];
  settlements: number[];
  wars: number[];
  temp: number[];
  forest: number[];
  animals: number[];
  food: number[];
  wealth: number[];
  tech: number[];
  trade: number[];
  civPop: Map<number, number[]>; // sparse: [year, pop, year, pop...]
}

export interface World {
  seed: number;
  w: number;
  h: number;
  n: number;
  seaLevel: number;
  elev: Float32Array;
  water: Uint8Array;
  river: Uint8Array;
  flow: Int32Array;
  temp: Float32Array; // base annual mean at tile (°C) without global offset
  rain: Float32Array; // base rainfall 0..1
  moist: Float32Array; // current soil moisture
  fert: Float32Array;
  veg: Float32Array; // grass/shrub biomass on land, fish stock on water
  forest: Float32Array;
  flora: Int8Array; // temperature the local flora is adapted to
  biome: Uint8Array;
  res: Uint8Array;
  resAmt: Uint16Array;
  owner: Int16Array; // settlement id or -1
  imp: Uint8Array;
  road: Uint8Array;
  fire: Uint8Array;
  flood: Uint8Array;
  coast: Uint8Array; // land tile adjacent to water / water tile adjacent to land
  landmass: Int16Array; // connected land region id (-1 water)
  volcanoes: number[];
}

/** runtime-only (not saved); rebuilt after load */
export interface Runtime {
  dirty: number[];
  allDirty: boolean;
  borderDirty: boolean;
  herdGrid: Map<number, number[]>;
  fx: FxEvent[];
  pathStamp: Int32Array;
  pathG: Float32Array;
  pathFrom: Int32Array;
  pathGen: number;
  tileCivCache: Int16Array | null;
  pending: { civ: number; prev: number; cause: string }[];
}

/** transient visual effect requests from the sim to the renderer (never read back by the sim) */
export interface FxEvent {
  kind: string;
  x: number;
  y: number;
  r: number;
  t: number;
}

export interface Sim {
  version: number;
  tick: number;
  rng: RNG;
  world: World;
  climate: Climate;
  params: Params;
  nextId: number;
  people: Map<number, Person>;
  graves: Map<number, Grave>;
  families: Map<number, Family>;
  settlements: Map<number, Settlement>;
  civs: Map<number, Civ>;
  wars: Map<number, War>;
  armies: Map<number, Army>;
  parties: Map<number, Party>;
  routes: Map<number, Route>;
  routeIndex: Map<string, number>;
  species: Map<number, Species>;
  herds: Map<number, Herd>;
  storms: Storm[];
  fires: number[];
  cultures: Map<number, Culture>;
  religions: Map<number, Religion>;
  languages: Map<number, Language>;
  ruins: Ruin[];
  history: HistEvent[];
  stats: StatSeries;
  vegCursor: number;
  usedNames: Map<string, number>;
  totalBorn: number;
  totalDied: number;
  rt: Runtime;
}

export function tileX(w: World, i: number): number {
  return i % w.w;
}
export function tileY(w: World, i: number): number {
  return (i / w.w) | 0;
}
export function yearOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_YEAR);
}
export function monthOf(tick: number): number {
  return Math.floor((tick % TICKS_PER_YEAR) / TICKS_PER_MONTH);
}
export const MONTH_NAMES = ['Thawmoon', 'Seedmoon', 'Bloommoon', 'Sunmoon', 'Highsun', 'Goldmoon', 'Reapmoon', 'Leaffall', 'Mistmoon', 'Frostmoon', 'Darkmoon', 'Deepsnow'];
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
export function seasonOf(tick: number): number {
  return Math.floor(monthOf(tick) / 3);
}
export function dateStr(tick: number): string {
  return `${MONTH_NAMES[monthOf(tick)]}, Year ${yearOf(tick) + 1}`;
}
