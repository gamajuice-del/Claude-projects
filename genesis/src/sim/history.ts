// The world's memory: an event log written only by real simulation events, plus yearly statistics.
import { G, HistEvent, Person, Sim, StatSeries, TICKS_PER_YEAR, W_LAND } from './types';

export function addEvent(sim: Sim, kind: string, imp: number, text: string, civs: number[], people: number[], settlement: number, x: number, y: number): HistEvent {
  const e: HistEvent = { id: sim.nextId++, t: sim.tick, kind, imp, text, civs, people, settlement, x, y };
  sim.history.push(e);
  if (sim.history.length > 9000) pruneHistory(sim);
  return e;
}

function pruneHistory(sim: Sim): void {
  const cutoff = sim.tick - 40 * TICKS_PER_YEAR;
  sim.history = sim.history.filter((e) => e.imp >= 3 || (e.imp === 2 && e.t > cutoff - 200 * TICKS_PER_YEAR) || e.t > cutoff);
  if (sim.history.length > 8000) sim.history = sim.history.filter((e) => e.imp >= 3 || e.t > cutoff);
  if (sim.history.length > 8000) sim.history.splice(0, sim.history.length - 7000);
}

export function remember(p: Person, tick: number, code: number, ref: number): void {
  p.mem.push(tick, code, ref);
  if (p.mem.length > 60) p.mem.splice(3, 3); // keep birth, drop oldest other memory
}

export function newStats(): StatSeries {
  return { year: [], pop: [], civs: [], settlements: [], wars: [], temp: [], forest: [], animals: [], food: [], wealth: [], tech: [], trade: [], civPop: new Map() };
}

export function sampleStats(sim: Sim): void {
  const st = sim.stats;
  const w = sim.world;
  const year = Math.floor(sim.tick / TICKS_PER_YEAR);
  let forest = 0, land = 0;
  for (let i = 0; i < w.n; i += 3) {
    if (w.water[i] === W_LAND) {
      land++;
      forest += w.forest[i];
    }
  }
  let animals = 0;
  for (const h of sim.herds.values()) animals += h.n;
  let food = 0, wealth = 0, trade = 0, nset = 0;
  for (const s of sim.settlements.values()) {
    if (!s.alive) continue;
    nset++;
    food += s.stock[G.food];
    trade += s.tradeVol;
  }
  for (const p of sim.people.values()) wealth += p.wealth;
  let civs = 0, tech = 0;
  for (const c of sim.civs.values()) {
    if (!c.alive) continue;
    civs++;
    let k = 0;
    for (let i = 0; i < c.tech.length; i++) if (c.tech[i] === 1) k++;
    if (k > tech) tech = k;
    let arr = st.civPop.get(c.id);
    if (!arr) st.civPop.set(c.id, (arr = []));
    arr.push(year, c.pop);
  }
  let wars = 0;
  for (const wr of sim.wars.values()) if (wr.end < 0) wars++;
  st.year.push(year);
  st.pop.push(sim.people.size);
  st.civs.push(civs);
  st.settlements.push(nset);
  st.wars.push(wars);
  st.temp.push(Math.round(sim.climate.tempOffset * 100) / 100);
  st.forest.push(land ? Math.round((forest / land) * 1000) / 1000 : 0);
  st.animals.push(animals);
  st.food.push(Math.round(food));
  st.wealth.push(Math.round(wealth));
  st.tech.push(tech);
  st.trade.push(Math.round(trade));
  // thin very long series: keep every other sample of the oldest half
  if (st.year.length > 1600) {
    const keys: (keyof StatSeries)[] = ['year', 'pop', 'civs', 'settlements', 'wars', 'temp', 'forest', 'animals', 'food', 'wealth', 'tech', 'trade'];
    for (const k of keys) {
      const a = st[k] as number[];
      const half = a.length >> 1;
      const thin: number[] = [];
      for (let i = 0; i < half; i += 2) thin.push(a[i]);
      (st[k] as number[]) = thin.concat(a.slice(half));
    }
  }
}
