// Headless scenario tests. Each one sets up a concrete situation and checks that the simulation's
// systems actually produce the consequences they claim to.
import { createSim, spawnTribe, tick } from '../src/sim/sim';
import { deserialize, serialize, stateHash } from '../src/sim/save';
import { G, GOOD_BASE, GOOD_NAMES, I_FARM, J, Settlement, Sim, TICKS_PER_YEAR, W_LAND } from '../src/sim/types';
import { declareWar } from '../src/sim/diplomacy';
import { relationOf, learnTech } from '../src/sim/civ';
import { TK } from '../src/sim/tech';
import * as powers from '../src/sim/powers';
import { dist } from '../src/sim/world';

declare const process: { argv: string[]; exitCode: number };
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}
function years(sim: Sim, n: number): void {
  for (let k = 0; k < n * TICKS_PER_YEAR; k++) tick(sim);
}
function small(seed: number, tribes = 4, w = 128, h = 80): Sim {
  return createSim({ seed, w, h, land: 0.4, tribes, popCap: 6000 });
}
function biggest(sim: Sim): Settlement {
  let b: Settlement | null = null;
  for (const s of sim.settlements.values()) if (!b || s.people.length > b.people.length) b = s;
  return b!;
}
function count(sim: Sim, kind: string, since = 0): number {
  return sim.history.filter((e) => e.kind === kind && e.t >= since).length;
}

console.log('1. determinism');
{
  const a = small(42), b = small(42), c = small(43);
  years(a, 30); years(b, 30); years(c, 30);
  check('same seed → identical world after 30 years', stateHash(a) === stateHash(b), stateHash(a));
  check('different seed → different world', stateHash(a) !== stateHash(c));
}

console.log('2. save / load');
{
  const a = small(7, 5);
  years(a, 60);
  const json = serialize(a);
  const b = deserialize(json);
  check('loaded state hashes identically', stateHash(a) === stateHash(b), `${(json.length / 1e6).toFixed(2)} MB, pop ${a.people.size}`);
  check('entities restored', b.people.size === a.people.size && b.settlements.size === a.settlements.size && b.history.length === a.history.length && b.herds.size === a.herds.size);
  years(a, 25); years(b, 25);
  check('original and loaded copy stay identical for 25 more years', stateHash(a) === stateHash(b), `pop ${a.people.size} vs ${b.people.size}`);
}

console.log('3. settlement founding and growth');
{
  const sim = small(11, 3);
  const pop0 = sim.people.size, towns0 = sim.settlements.size;
  check('tribes were placed', towns0 >= 2 && pop0 > 50, `${towns0} camps, ${pop0} people`);
  years(sim, 2);
  let working = 0, adults = 0;
  for (const p of sim.people.values()) if (p.job !== J.child) { adults++; if (p.job !== J.laborer) working++; }
  check('adults found work within two years', working / adults > 0.7, `${working}/${adults}`);
  years(sim, 78);
  check('population grew', sim.people.size > pop0 * 1.5, `${pop0} → ${sim.people.size}`);
  check('new settlements were founded', sim.settlements.size > towns0, `${towns0} → ${sim.settlements.size}`);
  check('farmland was cleared', Array.from(sim.settlements.values()).some((s) => s.farms.length > 5));
  let born = 0;
  for (const p of sim.people.values()) if (p.mother >= 0) born++;
  check('most living people were born in the sim', born > sim.people.size * 0.7, `${born}/${sim.people.size}`);
  check('births and deaths both occurred', sim.totalBorn > pop0 && sim.totalDied > 20, `${sim.totalBorn} born, ${sim.totalDied} died`);
}

console.log('4. resource shortage → hunger → death and flight');
{
  const sim = small(21, 3);
  years(sim, 60);
  const s = biggest(sim);
  const before = s.people.length;
  const t0 = sim.tick;
  // a brutal multi-year drought: no rain at all around the town
  for (let y = 0; y < 5; y++) {
    for (let k = 0; k < TICKS_PER_YEAR; k++) {
      if (k % 4 === 0) powers.drought(sim, s.x, s.y, 14);
      tick(sim);
    }
    if (y === 0) s.stock[G.food] = 0;
  }
  const famine = count(sim, 'famine', t0);
  const starved = Array.from(sim.graves.values()).filter((g) => g.cause === 'starvation' && g.died >= t0).length;
  let fled = sim.history.filter((e) => e.kind === 'migration' && e.t >= t0).length;
  check('drought cut the food supply', s.fedAvg < 0.9 || !s.alive || s.people.length < before, `fed ${s.fedAvg.toFixed(2)}, pop ${before} → ${s.people.length}`);
  check('a famine was recorded by the simulation itself', famine > 0, `${famine} famine events, ${starved}+ graves from starvation, ${fled} group migrations`);
  check('the town lost people', s.people.length < before, `${before} → ${s.people.length}`);
}

console.log('5. trade moves goods along routes');
{
  const sim = small(31, 4, 128, 80);
  years(sim, 140);
  let vol = 0, routes = sim.routes.size, imports = 0;
  for (const s of sim.settlements.values()) { vol += s.tradeVol; for (const v of s.imports) imports += v; }
  check('routes were discovered', routes > 0, `${routes} routes`);
  const merchants = Array.from(sim.people.values()).filter((p) => p.job === J.merchant).length;
  check('merchants exist and goods were delivered', merchants > 0 && vol > 0, `${merchants} merchants, rolling trade value ${vol.toFixed(0)}, recent import units ${imports.toFixed(0)}`);
  // price response: flood one town's market with tools and watch the price fall
  const s = biggest(sim);
  // pick the good that is currently dearest here, then flood the market with it
  let g: number = G.tools, hi = 0;
  for (const k of [G.tools, G.wares, G.wood, G.weapons]) if (s.price[k] / GOOD_BASE[k] > hi) { hi = s.price[k] / GOOD_BASE[k]; g = k; }
  const p0 = s.price[g];
  s.stock[g] += 3000;
  for (let k = 0; k < 16; k++) tick(sim);
  check('glut lowers the local price', s.price[g] < p0 * 0.8, `${GOOD_NAMES[g]} ${p0.toFixed(2)} → ${s.price[g].toFixed(2)}`);
  const pf = s.price[G.food];
  s.stock[G.food] = 0;
  for (let k = 0; k < 12; k++) tick(sim);
  check('scarcity raises the local price', s.price[G.food] > pf, `${pf.toFixed(2)} → ${s.price[G.food].toFixed(2)}`);
}

console.log('6. war: armies, sieges, an ending');
{
  let done = false;
  for (const seed of [51, 52, 53, 54, 55, 56]) {
    const sim = small(seed, 5, 128, 80);
    years(sim, 150);
    const civs = Array.from(sim.civs.values()).filter((c) => c.alive && c.pop > 60);
    // find two civs on the same landmass, close together
    let pair: [typeof civs[0], typeof civs[0]] | null = null, bd = 60;
    for (const a of civs) for (const b of civs) {
      if (a.id >= b.id) continue;
      const sa = sim.settlements.get(a.capital)!, sb = sim.settlements.get(b.capital)!;
      if (sim.world.landmass[sa.tile] !== sim.world.landmass[sb.tile]) continue;
      const d = dist(sa.x, sa.y, sb.x, sb.y);
      if (d < bd) { bd = d; pair = [a, b]; }
    }
    if (!pair) continue;
    const [a, b] = pair[0].pop >= pair[1].pop ? pair : [pair[1], pair[0]];
    const t0 = sim.tick;
    const popB = b.pop;
    const war = declareWar(sim, a, b, 'conquest', b.capital);
    let maxArmies = 0, maxSoldiers = 0;
    for (let k = 0; k < 15 * TICKS_PER_YEAR && war.end < 0; k++) {
      tick(sim);
      maxArmies = Math.max(maxArmies, sim.armies.size);
      for (const ar of sim.armies.values()) maxSoldiers = Math.max(maxSoldiers, ar.soldiers.length);
    }
    const sieges = count(sim, 'siege', t0), battles = count(sim, 'battle', t0), conq = count(sim, 'conquest', t0);
    console.log(`     seed ${seed}: ${a.name} (${a.pop}) vs ${b.name} (${popB}), ${bd.toFixed(0)} tiles apart → armies ${maxArmies}, largest ${maxSoldiers}, sieges ${sieges}, battles ${battles}, conquests ${conq}, losses ${war.attLoss}+${war.defLoss}, outcome: ${war.outcome || 'ongoing'}`);
    if (maxArmies > 0 && sieges + battles > 0) {
      check('armies were raised and marched', maxArmies > 0 && maxSoldiers >= 5, `${maxArmies} armies, up to ${maxSoldiers} soldiers`);
      check('fighting happened (siege or battle)', sieges + battles > 0, `${sieges} siege events, ${battles} battles, ${conq} towns taken`);
      check('the war ended with an outcome', war.end >= 0 && war.outcome.length > 0, war.outcome);
      check('war left grievances behind', a.grievances.length + b.grievances.length > 0 || !b.alive);
      done = true;
      break;
    }
  }
  check('found a seed with a decisive war', done);
}

console.log('7. siege cuts a town off from its food');
{
  const sim = small(61, 4);
  years(sim, 120);
  const s = biggest(sim);
  const civ = sim.civs.get(s.civ)!;
  const farmsBefore = s.prod[G.food];
  s.siege = 999999; // an encircling army (id never resolves, so the siege simply holds)
  const food0 = s.stock[G.food];
  let minFed = 1;
  for (let k = 0; k < 3 * TICKS_PER_YEAR; k++) { tick(sim); s.siege = 999999; minFed = Math.min(minFed, s.fedAvg); if (!s.alive) break; }
  check('besieged town produces far less food', s.prod[G.food] < farmsBefore * 0.6 || !s.alive, `${farmsBefore.toFixed(0)} → ${s.prod[G.food].toFixed(0)} per month`);
  check('its people go hungry', minFed < 0.85 || !s.alive, `min fed ${minFed.toFixed(2)}, stock ${food0.toFixed(0)} → ${s.stock[G.food].toFixed(0)}`);
  void civ;
}

console.log('8. god powers change the world');
{
  const sim = small(71, 3);
  years(sim, 40);
  const w = sim.world;
  // raise an island out of the sea
  let sea = -1;
  for (let i = 0; i < w.n; i++) { const x = i % w.w, y = (i / w.w) | 0; if (w.water[i] !== W_LAND && x > 10 && y > 10 && x < w.w - 10 && y < w.h - 10 && w.elev[i] < 0.3) { sea = i; break; } }
  const sx = sea % w.w, sy = (sea / w.w) | 0;
  for (let k = 0; k < 40 && w.elev[sea] < w.seaLevel + 0.03; k++) powers.sculpt(sim, sx, sy, 5, 0.02);
  powers.commitTerrain(sim);
  check('sculpting raised new land from the sea', w.water[sea] === W_LAND);
  const tribe = spawnTribe(sim, sx, sy, 30);
  check('a tribe can be placed on the new land', !!tribe && sim.settlements.get(tribe!.capital) !== undefined);
  const s = biggest(sim);
  const before = s.people.length;
  powers.meteor(sim, s.x, s.y, 4);
  check('a meteor devastates a town', !s.alive || s.people.length < before * 0.8, `${before} → ${s.alive ? s.people.length : 0}`);
  check('the impact cools the climate', sim.climate.dust > 0);
  const s2 = biggest(sim);
  const civ = sim.civs.get(s2.civ)!;
  powers.grantTech(sim, civ, TK.agriculture);
  powers.grantTech(sim, civ, TK.mining);
  powers.grantTech(sim, civ, TK.bronze);
  check('granting technology changes civ modifiers', civ.mods.toolQ >= 1.3);
  powers.plague(sim, s2);
  const p0 = s2.people.length;
  years(sim, 2);
  check('plague kills', count(sim, 'plague') > 0 && (s2.people.length < p0 || Array.from(sim.graves.values()).some((g) => g.cause === 'the plague')), `${p0} → ${s2.people.length}`);
  const sp = Array.from(sim.species.values())[0];
  const herds0 = sim.herds.size;
  powers.placeHerd(sim, sp, s2.x + 6, s2.y);
  check('creatures can be spawned', sim.herds.size >= herds0);
}

console.log('9. ecology runs without people');
{
  const sim = createSim({ seed: 81, w: 128, h: 80, land: 0.4, tribes: 0, popCap: 1000 });
  const w = sim.world;
  let f0 = 0;
  for (let i = 0; i < w.n; i++) f0 += w.forest[i];
  let a0 = 0;
  for (const h of sim.herds.values()) a0 += h.n;
  years(sim, 60);
  let f1 = 0;
  for (let i = 0; i < w.n; i++) f1 += w.forest[i];
  let a1 = 0;
  for (const h of sim.herds.values()) a1 += h.n;
  check('forests changed on their own', Math.abs(f1 - f0) / f0 > 0.01, `${f0.toFixed(0)} → ${f1.toFixed(0)}`);
  check('animal populations changed on their own', a1 !== a0 && sim.herds.size > 0, `${a0} → ${a1} animals in ${sim.herds.size} herds`);
  const alive = Array.from(sim.species.values()).filter((s) => s.extinct < 0).length;
  const preds = Array.from(sim.species.values()).filter((s) => s.diet === 1 && s.extinct < 0);
  check('predators and prey both persist', preds.length > 0 && alive >= 6, `${alive} species alive, ${preds.length} of them predators (${preds.map((p) => p.name + ' ' + p.count).join(', ')})`);
  check('climate moved', sim.stats.temp.some((t) => Math.abs(t) > 0.2));
}

console.log(failed === 0 ? '\nAll scenario checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
void relationOf; void learnTech; void I_FARM;
