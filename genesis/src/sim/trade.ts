// Trade: routes are discovered between settlements, merchants risk their own capital moving real goods
// from where they are cheap to where they are dear, and well-used routes become roads.
import { clamp01 } from './rng';
import { addEvent, remember } from './history';
import { addFame, fullName, practice } from './people';
import { Civ, G, GOOD_BULK, J, M, NG, PARTY, Party, Person, Route, Settlement, Sim, TICKS_PER_YEAR, W_LAND } from './types';
import { dist, markDirty } from './world';
import { findPath, pathCost } from './path';
import { createParty } from './parties';
import { relationOf } from './civ';
import { TK } from './tech';

const LAND_RATE = 0.045;

export function routeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** once a year a settlement looks for neighbours it can reach and keeps its route costs current */
export function discoverRoutes(sim: Sim, s: Settlement): void {
  const civ = sim.civs.get(s.civ);
  if (!civ) return;
  // refresh costs (roads improve them)
  for (const rid of s.routes) {
    const r = sim.routes.get(rid);
    if (r && r.a === s.id) r.cost = pathCost(sim, r.path, r.sea) * LAND_RATE;
  }
  const maxRoutes = 5 + Math.min(4, s.bld[1]);
  if (s.routes.length >= maxRoutes) return;
  const w = sim.world;
  const cands: { o: Settlement; d: number }[] = [];
  const seaReach = civ.mods.seaRange;
  for (const o of sim.settlements.values()) {
    if (o.id === s.id || !o.alive) continue;
    const d = dist(s.x, s.y, o.x, o.y);
    if (d > Math.max(34, seaReach)) continue;
    const key = routeKey(s.id, o.id);
    const ex = sim.routeIndex.get(key);
    if (ex !== undefined && (ex >= 0 || sim.tick + ex < 20 * TICKS_PER_YEAR)) continue; // have it, or failed recently
    cands.push({ o, d });
  }
  if (cands.length === 0) return;
  cands.sort((a, b) => a.d - b.d || a.o.id - b.o.id);
  let calls = 0;
  for (const { o, d } of cands) {
    if (calls >= 2 || s.routes.length >= maxRoutes) break;
    if (o.routes.length >= 9) continue;
    const oc = sim.civs.get(o.civ);
    if (!oc) continue;
    calls++;
    let path: number[] | null = null;
    let sea = false;
    if (d <= 34 && w.landmass[s.tile] === w.landmass[o.tile]) path = findPath(sim, s.tile, o.tile, false, 9000);
    if (!path && s.portTile >= 0 && o.portTile >= 0 && Math.max(seaReach, oc.mods.seaRange) >= d) {
      const sp = findPath(sim, s.portTile, o.portTile, true, 50000);
      if (sp) {
        path = [s.tile].concat(sp, [o.tile]);
        sea = true;
      }
    }
    const key = routeKey(s.id, o.id);
    if (!path) {
      sim.routeIndex.set(key, -sim.tick - 1);
      continue;
    }
    const r: Route = { id: sim.nextId++, a: s.id, b: o.id, path, sea, len: path.length, cost: pathCost(sim, path, sea) * LAND_RATE, usage: 0, built: 0 };
    sim.routes.set(r.id, r);
    sim.routeIndex.set(key, r.id);
    s.routes.push(r.id);
    o.routes.push(r.id);
    if (o.civ !== s.civ) {
      const ra = relationOf(sim, civ, oc.id),
        rb = relationOf(sim, oc, civ.id);
      if (!ra.contact) {
        ra.contact = true;
        rb.contact = true;
        addEvent(sim, 'contact', 2, `The ${civ.name} and the ${oc.name} have made contact${sea ? ' across the sea' : ''}.`, [civ.id, oc.id], [], s.id, s.x, s.y);
      }
    }
  }
}

interface Deal {
  r: Route;
  o: Settlement;
  g: number;
  qty: number;
  profit: number;
}

function bestDeal(sim: Sim, s: Settlement, civ: Civ, purse: number, only: Route | null): Deal | null {
  let best: Deal | null = null;
  const market = civ.tech[TK.currency] === 1;
  for (const rid of s.routes) {
    const r = sim.routes.get(rid);
    if (!r || (only && r !== only)) continue;
    const o = sim.settlements.get(r.a === s.id ? r.b : r.a);
    if (!o || !o.alive || o.siege >= 0) continue;
    let tariff = 0;
    if (o.civ !== s.civ) {
      const oc = sim.civs.get(o.civ);
      if (!oc || civ.isolated || oc.isolated || civ.laws.trade === 0 || oc.laws.trade === 0) continue;
      const rel = civ.rel.get(oc.id);
      if (rel && rel.war >= 0) continue;
      tariff = (oc.laws.trade === 1 ? 0.15 : 0.03) * (rel && rel.tradePact ? 0.3 : 1);
    }
    if (r.sea && (civ.mods.seaCap <= 0 || s.blockaded || o.blockaded)) continue;
    const cap = r.sea ? civ.mods.seaCap : civ.mods.caravanCap;
    const haul = r.cost * (r.sea ? 1 : civ.mods.landCost);
    for (let g = 0; g < NG; g++) {
      if (g === G.gold) continue;
      const have = s.stock[g];
      if (have < 3) continue;
      if (g === G.food && (s.fedAvg < 0.93 || have < s.people.length * 3.5)) continue;
      const pa = s.price[g];
      const margin = o.price[g] * (1 - tariff) - pa - haul * GOOD_BULK[g];
      if (margin < pa * 0.15) continue;
      let qty = Math.min(cap / GOOD_BULK[g], have * 0.35);
      if (market) qty = Math.min(qty, (purse + 2) / pa);
      if (g === G.food) qty = Math.min(qty, have - s.people.length * 3.5);
      // don't flood the destination: its need is finite
      qty = Math.min(qty, o.demand[g] * 8 + 4);
      if (qty < 1) continue;
      const profit = margin * qty;
      if (!best || profit > best.profit) best = { r, o, g, qty, profit };
    }
  }
  return best;
}

export function dispatchTrade(sim: Sim, s: Settlement, civ: Civ, merchants: Person[]): void {
  const zeal = sim.params.tradeZeal;
  if (zeal <= 0 || s.routes.length === 0) return;
  const n = Math.min(merchants.length, 3);
  const start = (sim.tick >> 2) % merchants.length;
  for (let k = 0; k < n; k++) {
    const m = merchants[(start + k) % merchants.length];
    if (m.party >= 0 || !sim.rng.chance(Math.min(1, 0.6 * zeal))) continue;
    const d = bestDeal(sim, s, civ, m.wealth, null);
    if (!d || d.profit < 0.5) continue;
    const path = d.r.a === s.id ? d.r.path.slice() : d.r.path.slice().reverse();
    const party = createParty(sim, PARTY.caravan, civ.id, path, s.id, d.o.id);
    party.good = d.g;
    party.qty = d.qty;
    party.paid = d.qty * s.price[d.g];
    party.owner = m.id;
    party.route = d.r.id;
    party.plague = s.plague > 0;
    party.sea = d.r.sea;
    s.stock[d.g] -= d.qty;
    m.wealth = Math.max(0, m.wealth - party.paid);
    m.party = party.id;
  }
}

export function caravanArrived(sim: Sim, p: Party): void {
  const here = sim.settlements.get(p.returning ? p.from : p.to);
  const home = sim.settlements.get(p.from);
  const m = sim.people.get(p.owner);
  const finish = () => {
    if (m && m.party === p.id) m.party = -1;
    sim.parties.delete(p.id);
  };
  if (!here || !here.alive) {
    finish();
    return;
  }
  const civ = sim.civs.get(p.civ);
  const hc = sim.civs.get(here.civ);
  if (here.siege >= 0 || (civ && hc && civ.rel.get(hc.id)?.war !== undefined && civ.rel.get(hc.id)!.war >= 0)) {
    // gates are shut. Turn around with the goods, or lose them at the end of the road.
    if (!p.returning && home && home.alive) {
      p.path = p.path.slice().reverse();
      p.pi = 0;
      p.returning = true;
      return;
    }
    finish();
    return;
  }
  // --- sell ---
  if (p.qty > 0 && p.good >= 0) {
    let tariff = 0;
    if (civ && hc && civ.id !== hc.id) {
      const rel = relationOf(sim, civ, hc.id);
      tariff = (hc.laws.trade === 1 ? 0.15 : 0.03) * (rel.tradePact ? 0.3 : 1);
    }
    const gross = p.qty * here.price[p.good];
    const duty = gross * tariff;
    const revenue = gross - duty;
    here.stock[p.good] += p.qty;
    here.imports[p.good] += p.qty;
    here.tradeVol += gross;
    if (home) home.tradeVol += gross * 0.5;
    if (hc && duty > 0) {
      hc.treasury += duty;
      hc.income += duty;
    }
    if (civ && hc && civ.id !== hc.id) {
      relationOf(sim, civ, hc.id).tradeVal += gross;
      relationOf(sim, hc, civ.id).tradeVal += gross;
    }
    const r = sim.routes.get(p.route);
    if (r) r.usage += p.qty * GOOD_BULK[p.good];
    if (m) {
      m.wealth += revenue;
      practice(m, J.merchant, 0.02);
      const profit = revenue - p.paid;
      if (profit > 0 && m.fame < 3 && m.wealth > Math.max(800, (home ? home.wealthAvg : 20) * 30)) {
        addFame(sim, m, 3);
        remember(m, sim.tick, M.enriched, here.id);
        if (civ) addEvent(sim, 'merchant', 1, `${fullName(sim, m)} of ${home ? home.name : 'parts unknown'} has grown rich on the ${['grain', 'timber', 'stone', 'copper', 'iron', 'coal', 'gold', 'salt', 'oil', 'tool', 'arms', 'luxury'][p.good]} trade.`, [civ.id], [m.id], home ? home.id : -1, here.x, here.y);
      }
    }
    if (p.plague && here.plague === 0 && sim.tick - here.lastPlague > 480 && sim.rng.chance(0.35)) {
      here.plague = 7 + sim.rng.int(6);
      addEvent(sim, 'plague', here.people.length > 300 ? 3 : 2, `Plague reached ${here.name}, carried along the trade road${home ? ' from ' + home.name : ''}.`, [here.civ], [], here.id, here.x, here.y);
    }
  }
  p.qty = 0;
  p.good = -1;
  if (p.returning || !home || !home.alive || !m) {
    finish();
    return;
  }
  // --- load a return cargo if there's money in it ---
  p.plague = here.plague > 0;
  const r = sim.routes.get(p.route);
  if (r && hc) {
    const d = bestDeal(sim, here, hc, m.wealth, r);
    if (d && d.profit > 0.3) {
      p.good = d.g;
      p.qty = d.qty;
      p.paid = d.qty * here.price[d.g];
      here.stock[d.g] -= d.qty;
      m.wealth = Math.max(0, m.wealth - p.paid);
    }
  }
  p.path = p.path.slice().reverse();
  p.pi = 0;
  p.returning = true;
}

/** the state paves its busiest routes, a few tiles each season */
export function buildRoads(sim: Sim, civ: Civ): void {
  const lvl = civ.mods.roadLevel;
  if (lvl < 1 || civ.treasury < 30) return;
  const w = sim.world;
  let best: Route | null = null,
    bu = 0.5;
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    for (const rid of s.routes) {
      const r = sim.routes.get(rid);
      if (!r || r.sea) continue;
      const o = sim.settlements.get(r.a === s.id ? r.b : r.a);
      if (!o) continue;
      if (o.civ !== civ.id && !(civ.rel.get(o.civ)?.tradePact)) continue;
      if (r.built >= r.path.length) {
        // finished at an older standard? start over at the new one
        if (w.road[r.path[Math.floor(r.path.length / 2)]] < lvl && w.water[r.path[Math.floor(r.path.length / 2)]] === W_LAND) r.built = 0;
        else continue;
      }
      const u = r.usage + (o.civ === civ.id ? 3 : 0) + (s.id === civ.capital || o.id === civ.capital ? 2 : 0);
      if (u > bu) {
        bu = u;
        best = r;
      }
    }
  }
  for (const sid of civ.settlements) {
    const s = sim.settlements.get(sid);
    if (!s) continue;
    for (const rid of s.routes) {
      const r = sim.routes.get(rid);
      if (r && r.a === s.id) r.usage *= 0.9;
    }
  }
  if (!best) return;
  let steps = Math.min(10, 2 + Math.floor(civ.treasury / 150));
  while (steps > 0 && best.built < best.path.length) {
    const i = best.path[best.built++];
    if (w.water[i] !== W_LAND) continue;
    if (w.road[i] >= lvl) continue;
    const cost = 2 * lvl;
    if (civ.treasury < cost) break;
    civ.treasury -= cost;
    civ.expense += cost;
    w.road[i] = lvl;
    markDirty(sim, i);
    steps--;
  }
}
export { clamp01 };
