// Settlements: land use, production by real workers, a local market with prices, consumption,
// construction, public mood. This is where geography, weather and individual lives meet.
import { clamp, clamp01 } from './rng';
import { addEvent, remember } from './history';
import { placeName } from './names';
import { JobCtx, LifeCtx, addFame, ageOf, chooseJob, fullName, jobSkill, killPerson, practice, rehome, setJob, tryBirth, yearlyLife } from './people';
import {
  ADULT_AGE, B, Civ, G, GOOD_BASE, I_CAMP, I_FARM, I_MINE, I_NONE, I_PASTURE, I_PORT, I_RUIN, I_URBAN, J, M, NB, NG, NJ, Person,
  RES_GOOD, R_COAL, R_COPPER, R_GOLD, R_IRON, R_OIL, R_SALT, R_STONE, Settlement, Sim, TICKS_PER_YEAR, TITLE, W_LAND, monthOf,
} from './types';
import { DX8, DY8, MOUNTAIN, SEA, forDisc, hasFreshWater, markDirty, meanTemp, rainAnomaly, tempAt } from './world';
import { herdsNear } from './ecology';
import { TK } from './tech';
import { findPortTile } from './path';
import { dispatchTrade } from './trade';
import { sendMigrants, sendPioneers } from './parties';
import { relationOf } from './civ';

const Y0 = 12; // food per perfect farm tile per month
const skillSum = new Float64Array(NJ);
const prodVal = new Float64Array(NJ);
let desire = new Float32Array(2048);
let own = new Float32Array(2048);
const tmpHerds: import('./types').Herd[] = [];

export function civOfTile(sim: Sim, i: number): number {
  const o = sim.world.owner[i];
  if (o < 0) return -1;
  const s = sim.settlements.get(o);
  return s ? s.civ : -1;
}

export function foundSettlement(sim: Sim, civId: number, x: number, y: number, people: Person[], name?: string): Settlement {
  const w = sim.world;
  const civ = sim.civs.get(civId)!;
  const cul = sim.cultures.get(civ.culture)!;
  const tile = y * w.w + x;
  const s: Settlement = {
    id: sim.nextId++,
    name: name || placeName(sim, cul.lang),
    civ: civId, x, y, tile, founded: sim.tick, alive: true,
    people: [], radius: 3, tiles: [], farms: [], urban: [], mines: [],
    stock: new Array(NG).fill(0), price: GOOD_BASE.slice(), demand: new Array(NG).fill(0), prod: new Array(NG).fill(0),
    jobCount: new Array(NJ).fill(0), wage: new Array(NJ).fill(1), bld: new Array(NB).fill(0), build: null,
    unrest: 0.1, livestock: 0, toolQ: 1, weaponQ: 1, siege: -1, siegeMonths: 0, occupier: -1, originalCiv: civId, governor: -1,
    coastal: false, river: false, wildCap: 0, hungerMonths: 0, starved: 0, plague: 0, lastRaid: -9999, tradeVol: 0,
    imports: new Array(NG).fill(0), routes: [], fedAvg: 0.9, happyAvg: 0.6, wealthAvg: 3, gini: 0, housing: 40,
    cultureMajor: civ.culture, religionMajor: civ.religion, damage: 0, portTile: -1, growthNote: -9999, blockaded: false,
    lastPlague: -9999, peakPop: people.length, drought: 0, farmable: 0, waterTiles: 0, forestTiles: 0, pastureCap: 0, loyalAvg: 0.6, rebelHeat: 0,
  };
  sim.settlements.set(s.id, s);
  civ.settlements.push(s.id);
  // the founding site
  if (w.owner[tile] >= 0) releaseTile(sim, tile);
  w.owner[tile] = s.id;
  w.imp[tile] = I_URBAN;
  w.forest[tile] = 0;
  s.tiles.push(tile);
  s.urban.push(tile);
  markDirty(sim, tile);
  for (const p of people) {
    rehome(sim, p, s);
    p.party = -1;
  }
  s.stock[G.food] = people.length * 5;
  s.stock[G.wood] = 15;
  s.stock[G.tools] = Math.ceil(people.length * 0.2);
  claimTerritory(sim, s);
  refreshLand(sim, s);
  sim.rt.borderDirty = true;
  return s;
}

function releaseTile(sim: Sim, i: number): void {
  const w = sim.world;
  const o = sim.settlements.get(w.owner[i]);
  if (o) {
    const rm = (a: number[]) => {
      const k = a.indexOf(i);
      if (k >= 0) a.splice(k, 1);
    };
    rm(o.tiles);
    rm(o.farms);
    rm(o.mines);
    rm(o.urban);
  }
  w.owner[i] = -1;
  w.imp[i] = I_NONE;
}

/** grow the borders to match the settlement's size; contested ground breeds friction with neighbours */
export function claimTerritory(sim: Sim, s: Settlement): void {
  const w = sim.world;
  const civ = sim.civs.get(s.civ)!;
  const pop = s.people.length;
  const target = clamp(2.6 + Math.sqrt(pop) / 3.2, 3, Math.min(13, 4.5 + civ.mods.admin * 0.5));
  s.radius = target;
  let claimed = false;
  const lm = w.landmass[s.tile];
  forDisc(w, s.x, s.y, target, (i) => {
    if (w.water[i] !== W_LAND) return;
    const o = w.owner[i];
    if (o === s.id) return;
    if (o < 0) {
      if (w.landmass[i] !== lm && !s.coastal) return;
      w.owner[i] = s.id;
      s.tiles.push(i);
      claimed = true;
    } else {
      const os = sim.settlements.get(o);
      if (os && os.civ !== s.civ) {
        const r = relationOf(sim, civ, os.civ);
        r.friction = Math.min(1, r.friction + 0.004);
        r.contact = true;
        const oc = sim.civs.get(os.civ);
        if (oc) relationOf(sim, oc, civ.id).contact = true;
      }
    }
  });
  if (claimed) sim.rt.borderDirty = true;
}

/** survey the territory: water access, wild food, workable land, deposits */
export function refreshLand(sim: Sim, s: Settlement): void {
  const w = sim.world;
  const civ = sim.civs.get(s.civ)!;
  let coastal = false, wild = 0, water = 0;
  forDisc(w, s.x, s.y, 7, (i, d) => {
    if (w.water[i] !== W_LAND) {
      if (d <= civ.mods.fishRange + 1) {
        water++;
        if (d <= 3.5) coastal = true;
      }
      return;
    }
    if (w.imp[i] === I_NONE || w.imp[i] === I_PASTURE) wild += w.veg[i] + w.forest[i] * 0.4;
  });
  s.coastal = coastal;
  s.waterTiles = water;
  s.wildCap = wild;
  s.river = hasFreshWater(w, s.tile);
  s.portTile = coastal ? findPortTile(sim, s.x, s.y, 4) : -1;
  let farmable = 0, forest = 0, pasture = 0;
  const canMine = civ.mods.mineYield >= 1;
  s.mines.length = 0;
  for (const i of s.tiles) {
    if (!s.river && w.river[i] > 0) s.river = true;
    const imp = w.imp[i];
    if (w.forest[i] > 0.15) forest++;
    if (imp === I_NONE || imp === I_PASTURE || imp === I_CAMP) {
      if (suitableFarm(sim, i)) farmable++;
      pasture += w.veg[i] * 5;
    }
    const r = w.res[i];
    if (r && w.resAmt[i] > 0 && imp !== I_URBAN) {
      const usable = r === R_STONE || r === R_SALT ? true : r === R_COAL ? canMine : r === R_OIL ? civ.tech[TK.industry] === 1 : canMine;
      if (usable) s.mines.push(i);
    }
  }
  s.farmable = farmable;
  s.forestTiles = forest;
  s.pastureCap = pasture;
}

function suitableFarm(sim: Sim, i: number): boolean {
  const w = sim.world;
  return w.fert[i] > 0.22 && w.elev[i] - w.seaLevel + SEA < MOUNTAIN - 0.04 && meanTemp(w, sim.climate, i) > 2.5;
}

function addFarm(sim: Sim, s: Settlement): boolean {
  const w = sim.world;
  let best = -1, bs = -1;
  for (const i of s.tiles) {
    const imp = w.imp[i];
    if (imp !== I_NONE && imp !== I_PASTURE && imp !== I_CAMP) continue;
    if (!suitableFarm(sim, i) || w.flood[i] > 0) continue;
    const dx = (i % w.w) - s.x,
      dy = ((i / w.w) | 0) - s.y;
    const sc = w.fert[i] * (0.4 + Math.min(1, w.moist[i] * 2) + (w.river[i] > 0 ? 0.4 : 0)) - Math.sqrt(dx * dx + dy * dy) * 0.035 - w.forest[i] * 0.15;
    if (sc > bs) {
      bs = sc;
      best = i;
    }
  }
  if (best < 0) return false;
  if (w.forest[best] > 0.05) s.stock[G.wood] += w.forest[best] * 30; // clearing yields timber
  w.forest[best] = 0;
  w.imp[best] = I_FARM;
  s.farms.push(best);
  s.farmable = Math.max(0, s.farmable - 1);
  markDirty(sim, best);
  return true;
}

function dropFarm(sim: Sim, s: Settlement): void {
  const w = sim.world;
  let worst = -1, ws = 1e9;
  for (let k = 0; k < s.farms.length; k++) {
    const i = s.farms[k];
    const dx = (i % w.w) - s.x,
      dy = ((i / w.w) | 0) - s.y;
    const sc = w.fert[i] - Math.sqrt(dx * dx + dy * dy) * 0.04;
    if (sc < ws) {
      ws = sc;
      worst = k;
    }
  }
  if (worst < 0) return;
  const i = s.farms[worst];
  s.farms.splice(worst, 1);
  w.imp[i] = I_NONE;
  s.farmable++;
  markDirty(sim, i);
}

function growUrban(sim: Sim, s: Settlement): boolean {
  const w = sim.world;
  let best = -1, bs = 1e9;
  for (const u of s.urban) {
    const ux = u % w.w,
      uy = (u / w.w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = ux + DX8[d],
        ny = uy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const j = ny * w.w + nx;
      if (w.water[j] !== W_LAND || w.owner[j] !== s.id) continue;
      const imp = w.imp[j];
      if (imp === I_URBAN || imp === I_MINE || imp === I_PORT) continue;
      const dd = (nx - s.x) * (nx - s.x) + (ny - s.y) * (ny - s.y) + ((j * 2654435761) >>> 28) * 0.12 + (w.elev[j] - w.seaLevel + SEA > MOUNTAIN ? 20 : 0);
      if (dd < bs) {
        bs = dd;
        best = j;
      }
    }
  }
  if (best < 0) return false;
  if (w.imp[best] === I_FARM) {
    const k = s.farms.indexOf(best);
    if (k >= 0) s.farms.splice(k, 1);
  }
  w.imp[best] = I_URBAN;
  w.forest[best] = 0;
  s.urban.push(best);
  markDirty(sim, best);
  return true;
}

const BUILD_COST_WOOD = [20, 25, 25, 20, 25, 10, 25, 40, 30, 30, 50, 40, 30, 40];
const BUILD_COST_STONE = [5, 10, 5, 25, 20, 60, 15, 15, 15, 30, 40, 40, 25, 60];
const BUILD_NEEDS: (string | null)[] = ['pottery', null, null, 'mysticism', 'writing', 'masonry', null, 'sailing', 'mills', 'education', 'industry', 'electricity', 'medicine', null];

function planBuilding(sim: Sim, s: Settlement, civ: Civ, pop: number): void {
  if (pop < 25) return;
  let best = -1, bs = 0.5;
  const threatened = isThreatened(sim, civ);
  for (let b = 0; b < NB; b++) {
    const need = BUILD_NEEDS[b];
    if (need && civ.tech[TK[need]] !== 1) continue;
    const lvl = s.bld[b];
    let cap = 0, sc = 0;
    switch (b) {
      case B.granary: cap = 1 + pop / 300; sc = 1.4 + (s.hungerMonths > 0 ? 1 : 0); break;
      case B.market: cap = pop > 80 ? 1 + pop / 400 : 0; sc = 0.9 + civ.pTrade * 1.5 + s.routes.length * 0.15; break;
      case B.workshop: cap = pop > 50 ? 1 + pop / 250 : 0; sc = 1 + (s.jobCount[J.artisan] >= 3 + pop / 10 + lvl * 12 ? 1 : 0); break;
      case B.temple: cap = 1 + pop / 400; sc = 0.7 + civ.pPiety * 2 + s.unrest; break;
      case B.library: cap = 1 + pop / 450; sc = 0.6 + civ.pScience * 2.2; break;
      case B.walls: cap = pop > 70 ? Math.min(civ.mods.wallMax, 1 + pop / 500) : 0; sc = 0.4 + civ.pMilitary + (threatened ? 1.6 : 0) + (sim.tick - s.lastRaid < 30 * TICKS_PER_YEAR ? 1 : 0); break;
      case B.barracks: cap = pop > 150 ? 1 + pop / 800 : 0; sc = 0.3 + civ.pMilitary * 2 + (threatened ? 0.8 : 0); break;
      case B.port: cap = s.coastal ? 1 + pop / 500 : 0; sc = 1 + civ.pTrade * 1.5; break;
      case B.mill: cap = 1 + pop / 500; sc = 1.2; break;
      case B.school: cap = pop > 200 ? 1 + pop / 600 : 0; sc = 0.6 + civ.pScience * 2.5; break;
      case B.factory: cap = pop > 200 ? pop / 300 : 0; sc = 1.6; break;
      case B.power: cap = pop > 300 ? 1 + pop / 1500 : 0; sc = 1.5; break;
      case B.hospital: cap = pop > 200 ? 1 + pop / 700 : 0; sc = 1; break;
      case B.palace: cap = civ.capital === s.id && pop > 180 && civ.gov >= 2 ? 1 + pop / 1500 : 0; sc = 0.8 + (1 - civ.legitimacy); break;
    }
    if (lvl >= Math.floor(cap)) continue;
    sc *= 1 / (1 + lvl * 0.6);
    sc += sim.rng.next() * 0.3;
    if (sc > bs) {
      bs = sc;
      best = b;
    }
  }
  if (best < 0) return;
  const lvl = s.bld[best];
  const k = (lvl + 1) * (1 + pop / 600);
  const wood = BUILD_COST_WOOD[best] * k;
  const stone = civ.tech[TK.masonry] === 1 ? BUILD_COST_STONE[best] * k : 0;
  const coin = 30 * k;
  // raise demand signals even if we cannot afford it yet, so the market responds
  s.demand[G.wood] += wood * 0.15;
  s.demand[G.stone] += stone * 0.15;
  if (s.stock[G.wood] < wood || s.stock[G.stone] < stone) return;
  if (civ.treasury < coin) {
    // a rich citizen may fund public works — and win a name for it
    let patron: Person | null = null;
    for (let t = 0; t < 6; t++) {
      const p = sim.people.get(s.people[sim.rng.int(s.people.length)]);
      if (p && p.wealth > coin * 3 && (!patron || p.wealth > patron.wealth)) patron = p;
    }
    if (!patron) return;
    patron.wealth -= coin;
    addFame(sim, patron, 1.5);
    patron.loyalty = Math.min(1, patron.loyalty + 0.1);
    if (best === B.temple || best === B.library || best === B.school || best === B.hospital) {
      addEvent(sim, 'patron', 2, `${fullName(sim, patron)}, a wealthy ${patron.job === J.merchant ? 'merchant' : 'citizen'} of ${s.name}, paid for a new ${['granary', 'market', 'workshop', 'temple', 'library', 'wall', 'barracks', 'harbor', 'mill', 'academy', 'factory', 'power plant', 'hospital', 'palace'][best]}.`, [civ.id], [patron.id], s.id, s.x, s.y);
    }
  } else {
    civ.treasury -= coin;
    civ.expense += coin;
  }
  s.stock[G.wood] -= wood;
  s.stock[G.stone] -= stone;
  s.build = { type: best, progress: 0, need: 18 * k };
}

export function isThreatened(sim: Sim, civ: Civ): boolean {
  for (const [, r] of civ.rel) if (r.war >= 0 || (r.contact && r.score < -35)) return true;
  return false;
}

function finishBuilding(sim: Sim, s: Settlement, civ: Civ): void {
  const b = s.build!.type;
  s.bld[b]++;
  s.build = null;
  const lvl = s.bld[b];
  if (b === B.port && s.portTile >= 0) markDirty(sim, s.portTile);
  for (const u of s.urban) markDirty(sim, u);
  const big = b === B.walls || b === B.palace || b === B.school || b === B.factory || b === B.power;
  if (big && lvl === 1) {
    const what = ['', '', '', '', '', 'raised walls around the town', '', '', '', 'founded an academy', 'opened its first factory', 'lit its streets with electric power', '', 'built a palace'][b];
    addEvent(sim, 'build', b === B.factory || b === B.power ? 2 : 1, `${s.name} ${what}.`, [civ.id], [], s.id, s.x, s.y);
  }
}

export function settlementMonthly(sim: Sim, s: Settlement): void {
  const civ = sim.civs.get(s.civ);
  if (!civ || !s.alive) return;
  if (s.people.length === 0) {
    abandonSettlement(sim, s, 'abandoned');
    return;
  }
  const w = sim.world,
    m = civ.mods,
    rng = sim.rng,
    P = sim.params;
  const tick = sim.tick;
  const month = monthOf(tick);
  const market = civ.tech[TK.currency] === 1;
  const price = s.price,
    stock = s.stock,
    prod = s.prod;
  // ------------------------------------------------------------- census
  s.jobCount.fill(0);
  skillSum.fill(0);
  let adults = 0, away = 0;
  for (const id of s.people) {
    const p = sim.people.get(id)!;
    s.jobCount[p.job]++;
    skillSum[p.job] += jobSkill(p, p.job);
    if (p.job !== J.child) adults++;
    if (p.army >= 0) away++;
  }
  const jc = s.jobCount;
  const pop = s.people.length;
  const present = pop - away;
  if (pop > s.peakPop) s.peakPop = pop;
  const T = tempAt(w, sim.climate, s.tile, tick);
  const anomaly = rainAnomaly(w, sim.climate, s.x, s.y, tick, P.climateVolatility);
  if (anomaly < 0.62 && s.farms.length > 3) {
    s.drought++;
    if (s.drought === 5 && pop > 60 && tick - s.growthNote > 8 * TICKS_PER_YEAR) addEvent(sim, 'drought', 2, `Drought grips ${s.name}. The fields are cracking.`, [civ.id], [], s.id, s.x, s.y);
  } else s.drought = Math.max(0, s.drought - 2);
  const besieged = s.siege >= 0;
  const workers = Math.max(1, adults - away);
  const toolCover = clamp01(stock[G.tools] / (workers * 0.25 + 1));
  const toolF = 0.85 + 0.15 * toolCover + (s.toolQ - 1) * 0.5 * toolCover;
  const dmgF = 1 - s.damage * 0.45;
  const avgSk = (j: number) => (jc[j] > 0 ? skillSum[j] / jc[j] : 0.2);
  prod.fill(0);
  prodVal.fill(0);
  // fuel for engines (coal/oil). Without it the machines stand idle.
  let fuelOK = 1;
  if (m.co2 > 0.5) {
    const fuelNeed = (jc[J.artisan] + jc[J.miner]) * 0.06 + s.bld[B.factory] * 1.5 + s.bld[B.power] * 2;
    const have = stock[G.coal] + stock[G.oil];
    const burn = Math.min(have, fuelNeed);
    fuelOK = fuelNeed > 0 ? burn / fuelNeed : 1;
    const fromCoal = Math.min(stock[G.coal], burn);
    stock[G.coal] -= fromCoal;
    stock[G.oil] -= burn - fromCoal;
    sim.climate.co2 += burn * 0.004 * m.co2;
    s.demand[G.coal] = s.demand[G.coal] * 0.7 + fuelNeed * 0.3;
  }
  const machineF = m.co2 > 0.5 ? 0.5 + 0.5 * fuelOK : 1;
  // ------------------------------------------------------------- farming
  const hasAgri = civ.tech[TK.agriculture] === 1;
  let effLabor = m.farmLabor;
  if (effLabor <= 0.11) {
    // tractors need oil
    const need = s.farms.length * 0.02;
    if (stock[G.oil] >= need) stock[G.oil] -= need;
    else effLabor = 0.35;
    s.demand[G.oil] = s.demand[G.oil] * 0.7 + need * 0.3;
  }
  if (hasAgri) {
    const gT = clamp01((T - 3) / 11) * (T > 36 ? 0.5 : 1);
    let sumY = 0;
    const deplete = 0.00045 * (1 - m.soilCare);
    const irrig = m.irrigate && s.river;
    for (const i of s.farms) {
      if (w.flood[i] > 0 || w.fire[i] > 0) continue;
      let gM = clamp01(w.moist[i] / 0.42);
      if (irrig || (m.irrigate && w.river[i] > 0)) gM = Math.max(gM, 0.85);
      sumY += w.fert[i] * gM;
      if (gT > 0.2) w.fert[i] = Math.max(0.05, w.fert[i] - deplete);
    }
    const laborFrac = Math.min(1, jc[J.farmer] / (s.farms.length * effLabor + 1e-6));
    const millF = 1 + Math.min(2, s.bld[B.mill]) * 0.08;
    const food = sumY * gT * Y0 * laborFrac * m.farmYield * toolF * (0.75 + 0.5 * avgSk(J.farmer)) * (besieged ? 0.3 : 1) * dmgF * millF;
    prod[G.food] += food;
    prodVal[J.farmer] = food * price[G.food];
    // land use follows labour
    const capLabor = s.farms.length * effLabor;
    if (!besieged) {
      if (jc[J.farmer] > capLabor * 0.92 || s.farms.length === 0) {
        if (addFarm(sim, s) && jc[J.farmer] > capLabor + 2) addFarm(sim, s);
      } else if (jc[J.farmer] < capLabor * 0.55 && s.farms.length > 2 && rng.chance(0.3)) dropFarm(sim, s);
    }
  }
  // ------------------------------------------------------------- fishing
  if (s.coastal && jc[J.fisher] > 0 && !s.blockaded) {
    let total = 0;
    const range = m.fishRange + 1;
    forDisc(w, s.x, s.y, range, (i) => {
      if (w.water[i] !== W_LAND) total += w.veg[i] * 40;
    });
    const want = jc[J.fisher] * 2.7 * m.fishYield * toolF * (0.75 + 0.5 * avgSk(J.fisher)) * (1 + s.bld[B.port] * 0.12) * (T < -8 ? 0.4 : 1);
    const got = Math.min(want, total * 0.14);
    if (got > 0 && total > 0) {
      const f = 1 - got / total;
      forDisc(w, s.x, s.y, range, (i) => {
        if (w.water[i] !== W_LAND) w.veg[i] *= f;
      });
    }
    prod[G.food] += got;
    prodVal[J.fisher] = got * price[G.food];
  }
  // ------------------------------------------------------------- hunting & gathering
  if (jc[J.hunter] > 0) {
    const season = 0.35 + 0.65 * clamp01((T - 1) / 12);
    const potential = s.wildCap * 0.3 * season;
    const bow = civ.tech[TK.archery] === 1 ? 1.2 : 1;
    let got = Math.min(jc[J.hunter] * 2.1 * toolF, potential);
    // real animals are taken from real herds
    let power = jc[J.hunter] * 1.3 * bow;
    herdsNear(sim, s.x, s.y, 9, tmpHerds);
    for (const h of tmpHerds) {
      if (power <= 0) break;
      const sp = sim.species.get(h.sp)!;
      if (sp.diet === 1 && h.fierce > 0.6) continue;
      const per = 2 + h.size * 16;
      const kills = Math.min(Math.floor(h.n * 0.18), Math.ceil(power / per));
      if (kills <= 0) continue;
      h.n -= kills;
      sp.count -= kills;
      got += kills * per * 0.8;
      power -= kills * per;
    }
    if (besieged) got *= 0.2;
    prod[G.food] += got;
    prodVal[J.hunter] = got * price[G.food];
  }
  // ------------------------------------------------------------- herding
  if (civ.tech[TK.husbandry] === 1) {
    if (s.livestock < 4 && jc[J.herder] > 0) s.livestock = 6;
    const managed = Math.min(s.livestock, jc[J.herder] * 14);
    const cap = s.pastureCap * (0.4 + 0.6 * clamp01(anomaly));
    const got = managed * 0.21 * toolF * (besieged ? 0.3 : 1);
    prod[G.food] += got;
    prodVal[J.herder] = got * price[G.food];
    if (s.livestock < cap) s.livestock += Math.max(0.3, managed * 0.035);
    else s.livestock -= (s.livestock - cap) * 0.15; // overgrazed pasture can't carry them
    if (managed < s.livestock) s.livestock -= (s.livestock - managed) * 0.05; // untended animals stray
    // grazing pressure on a few pasture tiles
    if (s.tiles.length > 0 && s.livestock > 4) {
      for (let k = 0; k < 4; k++) {
        const i = s.tiles[(month * 7 + k * 13 + (tick >> 6)) % s.tiles.length];
        if (w.imp[i] === I_NONE || w.imp[i] === I_PASTURE) {
          w.veg[i] = Math.max(0, w.veg[i] - Math.min(0.25, s.livestock * 0.0025));
          if (w.imp[i] === I_NONE && jc[J.herder] > 0 && w.forest[i] < 0.3) {
            w.imp[i] = I_PASTURE;
            markDirty(sim, i);
          }
        }
      }
    }
  }
  // ------------------------------------------------------------- woodcutting
  if (jc[J.woodcutter] > 0 && s.tiles.length > 0) {
    let want = jc[J.woodcutter] * 2.6 * m.woodYield * toolF * (besieged ? 0.2 : 1);
    let got = 0;
    const nT = s.tiles.length;
    const start = (tick * 31 + s.id * 17) % nT;
    for (let k = 0; k < nT && want > 0.01; k += 3) {
      const i = s.tiles[(start + k) % nT];
      const f = w.forest[i];
      if (f < 0.12) continue;
      const take = Math.min(want, (f - 0.05) * 400, 12);
      w.forest[i] = f - take / 400;
      got += take;
      want -= take;
      if (w.imp[i] === I_NONE && rng.chance(0.2)) {
        w.imp[i] = I_CAMP;
        markDirty(sim, i);
      }
    }
    prod[G.wood] += got;
    prodVal[J.woodcutter] = got * price[G.wood];
  }
  // ------------------------------------------------------------- mining
  if (jc[J.miner] > 0 && s.mines.length > 0) {
    // miners go where the money is
    const wts = [0, 0, 0, 0, 0, 0, 0, 0];
    const cnt = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const i of s.mines) {
      if (w.resAmt[i] <= 0) continue;
      cnt[w.res[i]]++;
    }
    let tw = 0;
    for (let r = 1; r < 8; r++) {
      if (!cnt[r]) continue;
      const g = RES_GOOD[r];
      wts[r] = Math.pow(price[g] / GOOD_BASE[g], 1.5) * (r === R_STONE ? 0.6 : 1) + 0.05;
      tw += wts[r];
    }
    const rate = [0, 2.4, 0.8, 0.8, 2, 0.12, 1.4, 2];
    const mf = Math.max(0.35, m.mineYield) * toolF * machineF * (0.75 + 0.5 * avgSk(J.miner)) * (besieged ? 0.3 : 1);
    let val = 0;
    for (let r = 1; r < 8; r++) {
      if (!cnt[r] || tw <= 0) continue;
      const men = (jc[J.miner] * wts[r]) / tw;
      let out = men * rate[r] * mf * (r !== R_STONE && r !== R_SALT && m.mineYield < 1 ? 0 : 1);
      if (out <= 0) continue;
      // draw down actual deposits
      let left = out;
      for (const i of s.mines) {
        if (left <= 0) break;
        if (w.res[i] !== r) continue;
        const take = Math.min(left, w.resAmt[i]);
        w.resAmt[i] -= Math.ceil(take);
        if (w.imp[i] !== I_MINE) {
          w.imp[i] = I_MINE;
          markDirty(sim, i);
        }
        left -= take;
        if (w.resAmt[i] <= 0) {
          w.res[i] = 0;
          w.resAmt[i] = 0;
          w.imp[i] = I_NONE;
          markDirty(sim, i);
          if (r !== R_STONE) addEvent(sim, 'depleted', 1, `The ${['', 'stone', 'copper', 'iron', 'coal', 'gold', 'salt', 'oil'][r]} deposits near ${s.name} are exhausted.`, [civ.id], [], s.id, s.x, s.y);
        }
      }
      out -= left;
      const g = RES_GOOD[r];
      prod[g] += out;
      val += out * price[g];
    }
    prodVal[J.miner] = val;
    if (prod[G.gold] > 0) {
      // the crown mints coin
      const mint = prod[G.gold] * 10;
      civ.treasury += mint;
      civ.income += mint;
    }
  }
  // ------------------------------------------------------------- crafts
  if (jc[J.artisan] > 0) {
    const soldiers = jc[J.soldier];
    const wT = Math.pow(price[G.tools] / GOOD_BASE[G.tools], 2);
    const wW = soldiers > 0 || price[G.weapons] > GOOD_BASE[G.weapons] * 1.2 ? Math.pow(price[G.weapons] / GOOD_BASE[G.weapons], 2) : 0;
    const wL = Math.pow(price[G.wares] / GOOD_BASE[G.wares], 2);
    const tw = wT + wW + wL;
    const base = jc[J.artisan] * m.craftYield * toolF * (0.6 + 0.8 * avgSk(J.artisan)) * dmgF * (1 + Math.min(2, s.bld[B.mill]) * 0.08 + s.bld[B.power] * 0.15) * (m.co2 > 0.5 ? machineF : 1);
    // best metal the civ can work and the town actually has
    const metal = (): [number, number] => {
      if (civ.tech[TK.ironworking] === 1 && stock[G.iron] > 0.5) return [G.iron, m.toolQ];
      if (civ.tech[TK.bronze] === 1 && stock[G.copper] > 0.5) return [G.copper, Math.min(m.toolQ, 1.3)];
      return [-1, 1];
    };
    let val = 0;
    // tools
    let nTools = (base * wT) / tw * 1.2;
    nTools = Math.min(nTools, stock[G.wood] / 0.4);
    if (nTools > 0.01) {
      const [mg, q] = metal();
      let useQ = 1;
      if (mg >= 0) {
        const mm = Math.min(nTools * 0.3, stock[mg]);
        stock[mg] -= mm;
        useQ = 1 + (q - 1) * (mm / (nTools * 0.3));
      }
      stock[G.wood] -= nTools * 0.4;
      s.toolQ = (s.toolQ * stock[G.tools] + useQ * nTools) / (stock[G.tools] + nTools + 1e-6);
      prod[G.tools] += nTools;
      val += nTools * price[G.tools];
    }
    // weapons
    let nWeap = (base * wW) / tw * 0.8;
    nWeap = Math.min(nWeap, stock[G.wood] / 0.3);
    if (nWeap > 0.01) {
      const [mg, q] = metal();
      let useQ = 1;
      if (mg >= 0) {
        const mm = Math.min(nWeap * 0.5, stock[mg]);
        stock[mg] -= mm;
        useQ = 1 + (Math.max(q, m.weaponQ) - 1) * (mm / (nWeap * 0.5));
      }
      stock[G.wood] -= nWeap * 0.3;
      s.weaponQ = (s.weaponQ * stock[G.weapons] + useQ * nWeap) / (stock[G.weapons] + nWeap + 1e-6);
      prod[G.weapons] += nWeap;
      val += nWeap * price[G.weapons];
    }
    // wares
    let nWares = (base * wL) / tw * 1.5;
    nWares = Math.min(nWares, stock[G.wood] / 0.25 + 0.5);
    if (nWares > 0.01) {
      stock[G.wood] = Math.max(0, stock[G.wood] - nWares * 0.25);
      prod[G.wares] += nWares;
      val += nWares * price[G.wares];
    }
    prodVal[J.artisan] = val * 0.8; // inputs cost something
    s.demand[G.copper] = s.demand[G.copper] * 0.8 + (civ.tech[TK.bronze] === 1 && civ.tech[TK.ironworking] !== 1 ? (nTools * 0.3 + nWeap * 0.5) * 0.2 : 0);
    s.demand[G.iron] = s.demand[G.iron] * 0.8 + (civ.tech[TK.ironworking] === 1 ? (nTools * 0.3 + nWeap * 0.5) * 0.2 : 0);
  }
  for (let g = 0; g < NG; g++) stock[g] += prod[g];
  // ------------------------------------------------------------- research
  {
    let rp = 0;
    if (jc[J.scholar] > 0) rp = jc[J.scholar] * 0.075 * (0.6 + 1.2 * avgSk(J.scholar)) * (1 + s.bld[B.library] * 0.15 + s.bld[B.school] * 0.25) * m.research;
    if (civ.laws.schooling) rp *= 1.12;
    rp += 0.035 * Math.sqrt(adults); // craft lore and elders' wisdom
    rp *= P.research * dmgF * (civ.golden > 0 ? 1.15 : 1);
    if (civ.researching >= 0) civ.research[civ.researching] += rp;
  }
  // ------------------------------------------------------------- wages
  const subsistence = price[G.food] * 1.3 + 0.15;
  const wage = s.wage;
  const prim = [J.farmer, J.fisher, J.hunter, J.herder, J.woodcutter, J.miner, J.artisan];
  for (const j of prim) {
    if (jc[j] > 0) wage[j] += (prodVal[j] / jc[j] - wage[j]) * 0.5;
  }
  const paid = civ.treasury > 0 ? 1 : 0.35;
  wage[J.soldier] = subsistence * 1.6 * paid;
  wage[J.scholar] = subsistence * 2.2 * paid;
  wage[J.official] = subsistence * 3 * paid;
  wage[J.laborer] = subsistence * 0.7;
  const salaries = jc[J.soldier] * wage[J.soldier] + jc[J.scholar] * wage[J.scholar] + jc[J.official] * wage[J.official];
  civ.treasury -= salaries;
  civ.expense += salaries;
  // merchants: retail margin here, plus whatever their caravans earn
  wage[J.merchant] += ((jc[J.merchant] > 0 ? (present * subsistence * 0.07 * m.market) / jc[J.merchant] : subsistence * 2.5) - wage[J.merchant]) * 0.3;
  // --- open positions and expected incomes for people choosing work
  const slots = SLOTS;
  slots.fill(0);
  const hasFishing = civ.tech[TK.fishing] === 1;
  slots[J.farmer] = hasAgri ? Math.floor((s.farms.length + s.farmable) * effLabor + 0.5) - jc[J.farmer] : 0;
  slots[J.fisher] = s.coastal ? Math.floor(s.waterTiles * (hasFishing ? 0.3 : 0.1)) - jc[J.fisher] : 0;
  slots[J.hunter] = Math.floor((s.wildCap * 0.3) / 2.1) + 2 - jc[J.hunter];
  slots[J.herder] = civ.tech[TK.husbandry] === 1 ? Math.floor(s.pastureCap / 14) + 1 - jc[J.herder] : 0;
  slots[J.woodcutter] = s.forestTiles > 0 ? Math.max(1, Math.floor(s.forestTiles * 0.6)) - jc[J.woodcutter] : 0;
  slots[J.miner] = s.mines.length * 5 - jc[J.miner];
  slots[J.artisan] = Math.floor(3 + pop / 9 + s.bld[B.workshop] * 12 + s.bld[B.factory] * 50 + s.bld[B.market] * 8 + Math.min(40, s.tradeVol * 0.05)) - jc[J.artisan];
  slots[J.merchant] = (pop > 30 && s.routes.length > 0 ? 1 + Math.floor(pop / 70) + s.bld[B.market] * 3 : 0) - jc[J.merchant];
  const quota = pop > 40 || civ.soldierTarget > 0.08 ? Math.round(adults * civ.soldierTarget) : 0;
  slots[J.soldier] = quota - jc[J.soldier];
  slots[J.scholar] = (civ.tech[TK.writing] === 1 ? 1 + s.bld[B.library] * 5 + s.bld[B.school] * 10 : 0) - jc[J.scholar];
  slots[J.priest] = (civ.tech[TK.mysticism] === 1 ? 1 + s.bld[B.temple] * 3 + Math.floor(pop / 250) : pop > 25 ? 1 : 0) - jc[J.priest];
  slots[J.official] = (pop > 80 ? 1 + Math.floor(pop / 160) + s.bld[B.palace] * 3 : 0) - jc[J.official];
  slots[J.laborer] = 9999;
  const ew = EXPECT;
  for (let j = 0; j < NJ; j++) ew[j] = wage[j];
  if (jc[J.farmer] === 0) ew[J.farmer] = price[G.food] * 2.4 * m.farmYield;
  if (jc[J.fisher] === 0) ew[J.fisher] = price[G.food] * 2.2 * m.fishYield;
  if (jc[J.hunter] === 0) ew[J.hunter] = price[G.food] * 2.0;
  if (jc[J.herder] === 0) ew[J.herder] = price[G.food] * 2.3;
  if (jc[J.woodcutter] === 0) ew[J.woodcutter] = price[G.wood] * 2.4 * m.woodYield;
  if (jc[J.miner] === 0) ew[J.miner] = subsistence * 1.6;
  if (jc[J.artisan] === 0) ew[J.artisan] = price[G.wares] * 1.1 * m.craftYield;
  // priests live on tithes
  let wageSum = 0, wageN = 0;
  for (const j of prim) {
    wageSum += wage[j] * jc[j];
    wageN += jc[j];
  }
  const avgWage = wageN > 0 ? wageSum / wageN : subsistence;
  wage[J.priest] = jc[J.priest] > 0 ? Math.min(subsistence * 2.2, (wageSum * 0.04) / jc[J.priest] + subsistence * 0.6) : subsistence * 1.6;
  ew[J.priest] = wage[J.priest];
  // ------------------------------------------------------------- people: eat, earn, live
  const ids = s.people.slice();
  const nP = ids.length;
  if (desire.length < nP) {
    desire = new Float32Array(nP * 2);
    own = new Float32Array(nP * 2);
  }
  const cul = sim.cultures.get(civ.culture)!;
  const foodPrice = price[G.food];
  const dole = civ.laws.dole && civ.treasury > 0;
  const charity = market ? cul.communal * 0.45 : 1;
  let totalDesire = 0, totalNeed = 0, doleUnits = 0;
  for (let k = 0; k < nP; k++) {
    const p = sim.people.get(ids[k])!;
    if (p.army >= 0) {
      desire[k] = 0;
      own[k] = 0;
      continue;
    }
    const age = (tick - p.born) / TICKS_PER_YEAR;
    const need = age < 4 ? 0.4 : age < ADULT_AGE ? 0.7 : 1;
    let aff = 1;
    if (market) {
      let purse = p.wealth;
      if (age < ADULT_AGE) {
        const fa = sim.people.get(p.father),
          mo = sim.people.get(p.mother);
        purse = Math.max(fa ? fa.wealth : 0, mo ? mo.wealth : 0);
      }
      aff = Math.min(1, purse / (need * foodPrice + 1e-6));
    }
    own[k] = need * aff;
    if (aff < 1) {
      const lifted = dole ? 1 : Math.max(aff, charity);
      if (dole) doleUnits += need * (1 - aff);
      aff = lifted;
    }
    desire[k] = need * aff;
    totalDesire += desire[k];
    totalNeed += need;
  }
  const scale = totalDesire > 0 ? Math.min(1, stock[G.food] / totalDesire) : 1;
  stock[G.food] = Math.max(0, stock[G.food] - totalDesire * scale);
  if (dole && doleUnits > 0) {
    const cost = doleUnits * scale * foodPrice;
    civ.treasury -= cost;
    civ.expense += cost;
  }
  // warmth: firewood, more in the cold
  const fuelNeedPop = present * 0.1 * (1 + clamp01((9 - T) / 14) * 1.5);
  const fuelSat = Math.min(1, stock[G.wood] / (fuelNeedPop + 0.01));
  stock[G.wood] = Math.max(0, stock[G.wood] - fuelNeedPop);
  const saltNeed = present * 0.015;
  const saltSat = Math.min(1, stock[G.salt] / (saltNeed + 0.001));
  stock[G.salt] = Math.max(0, stock[G.salt] - saltNeed);
  const housing = s.urban.length * m.density + 8;
  s.housing = housing;
  const crowd = present / housing;
  const danger = (besieged ? 1 : 0) + (s.plague > 0 ? 0.6 : 0) + (s.occupier >= 0 ? 0.4 : 0);
  const worldPop = sim.people.size;
  const capF = Math.max(0, 1 - Math.pow(worldPop / P.popCap, 3));
  const birthBase = 0.029 * P.birthRate * m.fertility * capF * (1 - 0.5 * Math.min(1, m.health / 0.7)) * (civ.laws.schooling ? 0.9 : 1) * (crowd < 0.9 ? 1 : clamp(1.9 - crowd, 0.15, 1)) * (besieged ? 0.3 : 1);
  const taxRate = civ.laws.tax;
  const taxEff = m.taxEff * Math.min(1, 0.55 + (jc[J.official] * 140) / (pop + 60));
  const templeJoy = Math.min(0.1, s.bld[B.temple] * 0.03 + jc[J.priest] * 0.004);
  const hospital = s.bld[B.hospital] * 0.05;
  const lifeCtx: LifeCtx = {
    slots, wage: ew, subsistence, crowd, danger, avgWage,
    migrate: (p, push) => planMigration(sim, s, civ, p, push),
  };
  MIG.clear();
  let taxSum = 0, rents = 0, fedSum = 0, happySum = 0, loyalSum = 0, wealthSum = 0, nAd = 0, waresWant = 0;
  const overSoldiers = jc[J.soldier] - quota;
  let discharge = overSoldiers > 1 ? overSoldiers : 0;
  const plagueRate = s.plague > 0 ? 0.22 * (1 - Math.min(0.8, m.health)) * (crowd > 1 ? 1.3 : 1) : 0;
  let plagueDead = 0;
  MERCH.length = 0;
  for (let k = 0; k < nP; k++) {
    const p = sim.people.get(ids[k]);
    if (!p || p.home !== s.id) continue;
    if (p.army >= 0) continue;
    const age = (tick - p.born) / TICKS_PER_YEAR;
    const need = age < 4 ? 0.4 : age < ADULT_AGE ? 0.7 : 1;
    const eaten = desire[k] * scale;
    p.fed += (eaten / need - p.fed) * 0.4;
    if (market) {
      const pay = Math.min(eaten, own[k]) * foodPrice;
      if (age >= ADULT_AGE) p.wealth = Math.max(0, p.wealth - pay);
      else {
        const fa = sim.people.get(p.father),
          mo = sim.people.get(p.mother);
        const payer = fa && (!mo || fa.wealth >= mo.wealth) ? fa : mo;
        if (payer) payer.wealth = Math.max(0, payer.wealth - pay);
      }
    }
    // hunger kills the weak first
    if (p.fed < 0.45) {
      p.health -= 0.07;
      if (rng.chance((0.45 - p.fed) * 0.32 * (age < 6 || age > 55 ? 1.6 : 1))) {
        s.starved++;
        killPerson(sim, p, 'starvation');
        continue;
      }
    } else if (p.health < 1) p.health = Math.min(1, p.health + 0.012 + hospital * 0.2 + saltSat * 0.003);
    if (fuelSat < 0.5 && T < 4) p.health -= 0.02 * (1 - fuelSat);
    // epidemic
    if (plagueRate > 0) {
      if (p.sick > 0) {
        p.sick--;
        if (rng.chance(0.2 * (1.3 - p.health) * (1 - Math.min(0.8, m.health) * 0.7) * (1 - hospital))) {
          plagueDead++;
          killPerson(sim, p, 'the plague');
          continue;
        }
        if (p.sick === 0) p.sick = -24; // immune for a while
      } else if (p.sick === 0 && rng.chance(plagueRate)) {
        p.sick = 2;
        p.health -= 0.2;
        remember(p, tick, M.plague, s.id);
      } else if (p.sick < 0) p.sick++;
    } else if (p.sick !== 0) p.sick = p.sick > 0 ? p.sick - 1 : p.sick + 1;
    if (age >= ADULT_AGE) {
      const job = p.job;
      if (job === J.soldier && discharge > 0 && p.title === TITLE.none) {
        discharge--;
        setJob(sim, p, s, J.laborer, lifeCtx);
      }
      const inc = wage[p.job] * (0.7 + 0.6 * jobSkill(p, p.job)) * (age > 62 ? 0.7 : 1);
      const tax = inc * taxRate;
      taxSum += tax * taxEff;
      p.wealth += inc - tax;
      if (civ.laws.serfdom && job === J.farmer) {
        const rent = inc * 0.15;
        p.wealth -= rent;
        rents += rent;
      }
      practice(p, job, civ.laws.schooling ? 0.006 : 0.004);
      if (job === J.laborer && p.title === TITLE.none && rng.chance(0.5)) chooseJob(sim, p, s, civ, lifeCtx);
      if (job === J.merchant && p.party < 0) MERCH.push(p);
      // small comforts
      const want = market ? Math.min(0.6, p.wealth / (price[G.wares] * 25)) : 0.08;
      waresWant += want;
      let lux = 0;
      if (want > 0 && stock[G.wares] >= want) {
        stock[G.wares] -= want;
        if (market) p.wealth -= want * price[G.wares];
        lux = Math.min(1, want / 0.15);
      }
      let ht = 0.1 + p.fed * 0.4 + p.health * 0.12 + lux * 0.1 + (p.spouse >= 0 ? 0.05 : 0) + templeJoy * (0.5 + p.piety) + fuelSat * 0.05 + (civ.golden > 0 ? 0.05 : 0);
      ht -= Math.max(0, crowd - 1) * 0.3 + danger * 0.15 + s.damage * 0.1;
      if (market) ht += p.wealth > s.wealthAvg ? 0.05 : p.wealth < s.wealthAvg * 0.25 ? -0.06 * (1 + s.gini) : 0;
      p.happy += (clamp01(ht) - p.happy) * 0.25;
      if (p.sex === 0 && p.spouse >= 0 && age < 43 && p.party < 0) {
        const fedF = clamp01((p.fed - 0.55) * 3);
        if (fedF > 0) tryBirth(sim, p, s, civ, birthBase * fedF);
      }
      fedSum += p.fed;
      happySum += p.happy;
      loyalSum += p.loyalty;
      wealthSum += p.wealth;
      nAd++;
    } else {
      p.happy += (0.3 + p.fed * 0.5 - p.happy) * 0.25;
    }
    if ((tick - p.born) % TICKS_PER_YEAR < 4) yearlyLife(sim, p, s, civ, age, lifeCtx);
  }
  // serf rents flow to officials and nobles
  if (rents > 0 && jc[J.official] > 0) {
    const share = rents / jc[J.official];
    for (const id of s.people) {
      const p = sim.people.get(id)!;
      if (p.job === J.official) p.wealth += share;
    }
  }
  civ.treasury += taxSum;
  civ.income += taxSum;
  if (nAd > 0) {
    s.fedAvg = fedSum / nAd;
    s.happyAvg = happySum / nAd;
    s.loyalAvg = loyalSum / nAd;
    s.wealthAvg = wealthSum / nAd;
  }
  // ------------------------------------------------------------- famine bookkeeping
  if (s.fedAvg < 0.7) {
    s.hungerMonths++;
    if (s.hungerMonths === 4 && pop > 30) {
      const why = s.siege >= 0 ? 'the siege' : s.blockaded ? 'the blockade' : s.drought >= 4 ? 'drought' : s.damage > 0.3 ? 'the destruction' : T < 0 ? 'a hard winter' : 'failed harvests';
      addEvent(sim, 'famine', s.people.length > 150 ? 3 : 2, `Famine in ${s.name}: ${why} has emptied the granaries.`, [civ.id], [], s.id, s.x, s.y);
      const mem = `the famine of year ${Math.floor(tick / TICKS_PER_YEAR) + 1} at ${s.name}`;
      if (civ.memory.indexOf(mem) < 0 && s.people.length > 100) civ.memory.push(mem);
    }
  } else if (s.hungerMonths > 0) {
    s.hungerMonths = Math.max(0, s.hungerMonths - 2);
    if (s.hungerMonths === 0 && s.starved > 0) {
      if (s.starved >= 8) addEvent(sim, 'famine', 2, `The famine at ${s.name} has passed. ${s.starved} starved.`, [civ.id], [], s.id, s.x, s.y);
      s.starved = 0;
    }
  }
  // ------------------------------------------------------------- epidemic course
  if (s.plague > 0) {
    s.plague--;
    if (plagueDead > 0) s.starved += 0;
    if (s.plague === 0) s.lastPlague = tick;
  } else if (crowd > 1.05 && pop > 250 && tick - s.lastPlague > 25 * TICKS_PER_YEAR && rng.chance(0.0012 * P.disasters * (1 - Math.min(0.9, m.health)))) {
    startPlague(sim, s);
  }
  // ------------------------------------------------------------- stores: spoilage and limits
  const granary = s.bld[B.granary];
  stock[G.food] *= 1 - (0.04 / m.storage) * (saltSat > 0.5 ? 0.6 : 1) / (1 + granary * 0.6);
  const maxFood = pop * (9 + granary * 9) * m.storage + 40;
  if (stock[G.food] > maxFood) stock[G.food] = maxFood;
  stock[G.tools] = Math.max(0, stock[G.tools] - workers * 0.012);
  stock[G.weapons] = Math.max(0, stock[G.weapons] - jc[J.soldier] * 0.01);
  for (let g = 1; g < NG; g++) if (stock[g] > 4000 + pop * 6) stock[g] = 4000 + pop * 6;
  // ------------------------------------------------------------- prices follow scarcity
  const dem = s.demand;
  dem[G.food] = dem[G.food] * 0.6 + totalNeed * 0.4;
  dem[G.wood] = dem[G.wood] * 0.7 + (fuelNeedPop + prod[G.tools] * 0.4 + prod[G.wares] * 0.25 + (crowd > 0.85 ? 4 : 0)) * 0.3;
  dem[G.stone] = dem[G.stone] * 0.85 + (civ.tech[TK.masonry] === 1 ? pop * 0.004 : 0);
  dem[G.tools] = dem[G.tools] * 0.7 + (workers * 0.012 + Math.max(0, workers * 0.25 - stock[G.tools]) * 0.1) * 0.3;
  dem[G.weapons] = dem[G.weapons] * 0.7 + (jc[J.soldier] * 0.01 + Math.max(0, jc[J.soldier] - stock[G.weapons]) * 0.15) * 0.3;
  dem[G.wares] = dem[G.wares] * 0.7 + waresWant * 0.3;
  dem[G.salt] = dem[G.salt] * 0.7 + saltNeed * 0.3;
  for (let g = 0; g < NG; g++) {
    if (g === G.gold) {
      price[g] = GOOD_BASE[g];
      continue;
    }
    const months = g === G.food ? 7 : 5;
    const target = dem[g] * months + (g === G.food ? 2 : 0.4);
    const ratio = target / (stock[g] + dem[g] * 0.5 + 0.3);
    const tp = GOOD_BASE[g] * clamp(Math.pow(ratio, 0.7), 0.25, 6);
    price[g] += (tp - price[g]) * (0.3 + 0.1 * Math.min(2, s.bld[B.market]));
    s.imports[g] *= 0.9;
  }
  s.tradeVol *= 0.97;
  // ------------------------------------------------------------- building & repair
  const labor = jc[J.laborer] * 1 + adults * 0.04;
  if (s.damage > 0.01) {
    const woodUse = Math.min(stock[G.wood], 3 + pop * 0.01);
    stock[G.wood] -= woodUse;
    s.damage = Math.max(0, s.damage - (labor * 0.25 + woodUse) / (pop * 1.2 + 60));
    if (s.damage < 0.01) {
      s.damage = 0;
      for (const u of s.urban) markDirty(sim, u);
    }
  } else if (s.build) {
    s.build.progress += labor * (civ.tech[TK.banking] === 1 ? 1.25 : 1);
    if (s.build.progress >= s.build.need) finishBuilding(sim, s, civ);
  } else if (!besieged && (tick + s.id) % 12 < 4) planBuilding(sim, s, civ, pop);
  if (crowd > 0.88 && !besieged) {
    // stone houses where there is stone; otherwise more timber
    const stoneCost = civ.tech[TK.masonry] === 1 && stock[G.stone] >= 3 ? 3 : 0;
    const woodCost = stoneCost > 0 ? 4 : 7;
    if (stock[G.wood] >= woodCost) {
      if (growUrban(sim, s)) {
        stock[G.wood] -= woodCost;
        stock[G.stone] -= stoneCost;
      }
    }
  }
  // ------------------------------------------------------------- public mood
  {
    const foreign = s.cultureMajor !== civ.culture ? 0.15 : 0;
    const occupied = s.occupier >= 0 ? 0.3 : s.originalCiv !== s.civ ? 0.12 : 0;
    const garrison = Math.min(0.3, ((jc[J.soldier] - away) / (pop + 1)) * 2.5);
    const target = clamp01((0.56 - s.happyAvg) * 1.7 + (0.5 - s.loyalAvg) * 1.3 + foreign + occupied + s.gini * 0.2 + civ.exhaustion * 0.3 + (taxRate - 0.2) * 0.6 + Math.max(0, civ.settlements.length - m.admin - 1) * 0.025 - garrison - templeJoy - (civ.legitimacy - 0.5) * 0.2) * P.unrest;
    s.unrest += (target - s.unrest) * 0.15;
    s.rebelHeat = s.unrest > 0.62 ? s.rebelHeat + 1 : Math.max(0, s.rebelHeat - 1);
  }
  // ------------------------------------------------------------- yearly chores (staggered by id)
  if (month === s.id % 12) {
    claimTerritory(sim, s);
    refreshLand(sim, s);
    yearlySurvey(sim, s);
  }
  // ------------------------------------------------------------- trade and departures
  if (!besieged && MERCH.length > 0) dispatchTrade(sim, s, civ, MERCH);
  if (MIG.size > 0) flushMigration(sim, s, civ);
}

const SLOTS: number[] = new Array(NJ).fill(0);
const EXPECT: number[] = new Array(NJ).fill(0);
const MERCH: Person[] = [];
const MIG = new Map<number, Person[]>();

function yearlySurvey(sim: Sim, s: Settlement): void {
  // majority culture / faith and wealth inequality
  const cc = new Map<number, number>(),
    rc = new Map<number, number>();
  const ws: number[] = [];
  for (const id of s.people) {
    const p = sim.people.get(id)!;
    cc.set(p.culture, (cc.get(p.culture) || 0) + 1);
    rc.set(p.religion, (rc.get(p.religion) || 0) + 1);
    if (p.job !== J.child) ws.push(p.wealth);
  }
  let bm = -1, bc = 0;
  for (const [k, v] of cc) if (v > bc) { bc = v; bm = k; }
  s.cultureMajor = bm;
  bm = -1; bc = 0;
  for (const [k, v] of rc) if (v > bc) { bc = v; bm = k; }
  s.religionMajor = bm;
  if (ws.length > 3) {
    ws.sort((a, b) => a - b);
    let cum = 0, tot = 0;
    for (let i = 0; i < ws.length; i++) {
      cum += (i + 1) * ws[i];
      tot += ws[i];
    }
    s.gini = tot > 0 ? clamp01((2 * cum) / (ws.length * tot) - (ws.length + 1) / ws.length) : 0;
  }
  // governor
  const gov = sim.people.get(s.governor);
  if (!gov || gov.home !== s.id) {
    s.governor = -1;
    const civ = sim.civs.get(s.civ)!;
    if (s.people.length > 60 && civ.capital !== s.id) {
      let best: Person | null = null, bs = 0;
      const ruler = sim.people.get(civ.ruler);
      for (let t = 0; t < 14; t++) {
        const p = sim.people.get(s.people[sim.rng.int(s.people.length)]);
        if (!p || p.job === J.child || p.title !== TITLE.none) continue;
        let sc = p.sLead + p.cha * 0.5 + p.loyalty * 0.5 + (p.job === J.official ? 0.6 : 0) + Math.min(0.5, p.fame * 0.1);
        if (ruler && ruler.friends.indexOf(p.id) >= 0) sc += 0.6; // patronage
        if (ruler && ruler.rivals.indexOf(p.id) >= 0) sc -= 1;
        if (sc > bs) {
          bs = sc;
          best = p;
        }
      }
      if (best) {
        s.governor = best.id;
        best.title = TITLE.governor;
        if (best.job !== J.official && best.army < 0) setJob(sim, best, s, J.official);
        addFame(sim, best, 2);
        remember(best, sim.tick, M.governor, s.id);
      }
    }
  }
}

export function startPlague(sim: Sim, s: Settlement): void {
  if (s.plague > 0) return;
  s.plague = 7 + sim.rng.int(6);
  addEvent(sim, 'plague', s.people.length > 300 ? 3 : 2, `Plague has broken out in ${s.name}.`, [s.civ], [], s.id, s.x, s.y);
}

/** an individual has decided to leave: where to? (called from yearlyLife) */
function planMigration(sim: Sim, s: Settlement, civ: Civ, p: Person, push: number): void {
  const cul = sim.cultures.get(p.culture);
  let best = -1, bs = s.fedAvg * 2 + 0.7 - s.unrest * 0.8 - Math.max(0, s.people.length / s.housing - 0.9) * 1.5 - (s.siege >= 0 ? 2 : 0) + 0.25;
  for (const rid of s.routes) {
    const r = sim.routes.get(rid);
    if (!r) continue;
    const o = sim.settlements.get(r.a === s.id ? r.b : r.a);
    if (!o || !o.alive || o.siege >= 0) continue;
    if (r.sea && civ.mods.seaCap <= 0) continue;
    let sc = o.fedAvg * 2 + Math.min(0.6, (o.wealthAvg / (s.wealthAvg + 1)) * 0.3) - r.len / 55 - o.unrest * 0.8 - Math.max(0, o.people.length / o.housing - 0.9) * 1.5 - (o.plague > 0 ? 1 : 0);
    sc += o.cultureMajor === p.culture ? 0.4 : -0.3 * (cul ? cul.insular : 0.5);
    if (o.civ !== s.civ) {
      const oc = sim.civs.get(o.civ);
      if (!oc || oc.isolated || oc.laws.trade === 0) continue;
      const rel = civ.rel.get(o.civ);
      if (rel && rel.war >= 0) continue;
    } else sc += 0.25;
    for (const f of p.friends) if (sim.people.get(f)?.home === o.id) sc += 0.3;
    if (sc > bs) {
      bs = sc;
      best = o.id;
    }
  }
  if (best < 0) {
    if (push < 0.5 || p.bold < 0.4) return;
    best = -1; // strike out for empty land
  }
  let list = MIG.get(best);
  if (!list) MIG.set(best, (list = []));
  if (list.length > Math.max(6, s.people.length * 0.12)) return;
  list.push(p);
}

function flushMigration(sim: Sim, s: Settlement, civ: Civ): void {
  for (const [dest, heads] of MIG) {
    const group: Person[] = [];
    for (const h of heads) {
      if (!sim.people.has(h.id) || h.home !== s.id || h.party >= 0) continue;
      group.push(h);
      const sp = sim.people.get(h.spouse);
      if (sp && sp.home === s.id && sp.party < 0 && sp.army < 0 && group.indexOf(sp) < 0) group.push(sp);
      for (const kid of h.kids) {
        const c = sim.people.get(kid);
        if (c && c.home === s.id && c.party < 0 && ageOf(sim, c) < ADULT_AGE && group.indexOf(c) < 0) group.push(c);
      }
    }
    if (group.length === 0) continue;
    if (dest >= 0) sendMigrants(sim, s, dest, group, s.fedAvg < 0.7 || s.siege >= 0);
    else if (group.length >= 5) sendPioneers(sim, s, civ, group);
  }
  MIG.clear();
}

/** the last people are gone, or the town is razed: it becomes a ruin holding echoes of what its builders knew */
export function abandonSettlement(sim: Sim, s: Settlement, how: string): void {
  if (!s.alive) return;
  const w = sim.world;
  const civ = sim.civs.get(s.civ);
  s.alive = false;
  for (const i of s.tiles) {
    if (w.owner[i] !== s.id) continue;
    w.owner[i] = -1;
    if (w.imp[i] === I_URBAN) w.imp[i] = s.peakPop >= 40 ? I_RUIN : I_NONE;
    else if (w.imp[i] !== I_RUIN) w.imp[i] = I_NONE;
    markDirty(sim, i);
  }
  if (s.peakPop >= 40) {
    const techs: number[] = [];
    if (civ) for (let t = 0; t < civ.tech.length; t++) if (civ.tech[t] === 1) techs.push(t);
    sim.ruins.push({ id: sim.nextId++, name: s.name, x: s.x, y: s.y, tile: s.tile, fell: sim.tick, civName: civ ? civ.name : '?', techs, peak: s.peakPop });
    addEvent(sim, 'ruin', s.peakPop > 200 ? 3 : 2, `${s.name} lies ${how}. At its height ${s.peakPop} people lived there.`, civ ? [civ.id] : [], [], s.id, s.x, s.y);
  }
  // anyone still registered here becomes homeless (parties handle them) — normally none
  for (const id of s.people.slice()) {
    const p = sim.people.get(id);
    if (p) killPerson(sim, p, how === 'abandoned' ? 'exposure' : 'the destruction of ' + s.name);
  }
  s.people.length = 0;
  for (const rid of s.routes.slice()) removeRoute(sim, rid);
  if (civ) {
    const k = civ.settlements.indexOf(s.id);
    if (k >= 0) civ.settlements.splice(k, 1);
    if (civ.capital === s.id) civ.capital = civ.settlements.length ? pickCapital(sim, civ) : -1;
  }
  if (s.siege >= 0) {
    const a = sim.armies.get(s.siege);
    if (a) a.goal = 0;
  }
  s.tiles.length = 0;
  s.farms.length = 0;
  s.urban.length = 0;
  s.mines.length = 0;
  sim.settlements.delete(s.id);
  sim.rt.borderDirty = true;
}

export function removeRoute(sim: Sim, rid: number): void {
  const r = sim.routes.get(rid);
  if (!r) return;
  for (const sid of [r.a, r.b]) {
    const s = sim.settlements.get(sid);
    if (s) {
      const k = s.routes.indexOf(rid);
      if (k >= 0) s.routes.splice(k, 1);
    }
  }
  sim.routeIndex.delete(r.a < r.b ? `${r.a}-${r.b}` : `${r.b}-${r.a}`);
  sim.routes.delete(rid);
}

export function pickCapital(sim: Sim, civ: Civ): number {
  let best = -1, bp = -1;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (s && s.alive && s.people.length > bp) {
      bp = s.people.length;
      best = sid;
    }
  }
  return best;
}

/** hand a settlement to another civ (conquest, secession, treaty) */
export function transferSettlement(sim: Sim, s: Settlement, toCiv: Civ, resent: boolean): void {
  const from = sim.civs.get(s.civ);
  if (from && from.id === toCiv.id) return;
  if (from) {
    const k = from.settlements.indexOf(s.id);
    if (k >= 0) from.settlements.splice(k, 1);
    if (from.capital === s.id) from.capital = pickCapital(sim, from);
  }
  s.civ = toCiv.id;
  s.occupier = -1;
  toCiv.settlements.push(s.id);
  if (toCiv.capital < 0) toCiv.capital = s.id;
  for (const id of s.people) {
    const p = sim.people.get(id);
    if (!p) continue;
    if (p.army >= 0) continue; // soldiers in the field stay with their army's side
    p.civ = toCiv.id;
    if (resent) {
      p.loyalty = Math.min(p.loyalty, 0.3);
      if (p.job !== J.child) remember(p, sim.tick, M.conquered, toCiv.id);
    } else p.loyalty = Math.max(p.loyalty, 0.6);
    if (p.title === TITLE.governor || p.title === TITLE.noble || p.title === TITLE.heir) p.title = TITLE.none;
  }
  s.governor = -1;
  s.build = null;
  sim.rt.borderDirty = true;
}
export { I_PORT, R_COPPER, R_GOLD, R_IRON };
