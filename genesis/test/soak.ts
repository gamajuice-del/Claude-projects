// Long headless run that prints how the world develops. Usage: node dist/soak.mjs [seed] [years] [w] [h]
import { createSim, tick } from '../src/sim/sim';
import { TICKS_PER_YEAR, G, J } from '../src/sim/types';
import { knownCount, ERA_NAMES } from '../src/sim/tech';
import { landFraction } from '../src/sim/worldgen';
import { civFullName } from '../src/sim/civ';

declare const process: { argv: string[] };
const seed = Number(process.argv[2] || 1234);
const years = Number(process.argv[3] || 300);
const W = Number(process.argv[4] || 256);
const H = Number(process.argv[5] || 160);
const quiet = process.argv.includes('--quiet');
const t0 = Date.now();
const sim = createSim({ seed, w: W, h: H, land: 0.36, tribes: 8, popCap: 12000 });
console.log(`world ${W}x${H} seed ${seed}: land ${(landFraction(sim.world) * 100).toFixed(0)}%, gen ${Date.now() - t0}ms, tribes ${sim.civs.size}, herds ${sim.herds.size}, people ${sim.people.size}`);
let last = Date.now();
for (let y = 1; y <= years; y++) {
  for (let k = 0; k < TICKS_PER_YEAR; k++) tick(sim);
  if (y % 25 === 0 || y === years) {
    let civs = 0, maxTech = 0, era = 0, soldiers = 0;
    for (const c of sim.civs.values()) if (c.alive) { civs++; maxTech = Math.max(maxTech, knownCount(c)); era = Math.max(era, c.era); soldiers += c.soldiers; }
    let fed = 0, n = 0, food = 0, farms = 0, urban = 0;
    const jobs = new Array(14).fill(0);
    for (const s of sim.settlements.values()) { fed += s.fedAvg * s.people.length; n += s.people.length; food += s.stock[G.food]; farms += s.farms.length; urban += s.urban.length; for (let j = 0; j < 14; j++) jobs[j] += s.jobCount[j]; }
    let wars = 0; for (const w of sim.wars.values()) if (w.end < 0) wars++;
    let animals = 0; for (const h of sim.herds.values()) animals += h.n;
    let sp = 0; for (const s of sim.species.values()) if (s.extinct < 0) sp++;
    const sizes = Array.from(sim.settlements.values()).map((s) => s.people.length).sort((a, b) => b - a).slice(0, 6).join('/');
    const now = Date.now();
    console.log(`y${y} pop ${sim.people.size} civs ${civs} towns ${sim.settlements.size} wars ${wars}/${sim.wars.size} fed ${(fed / (n || 1)).toFixed(2)} food ${food.toFixed(0)} farms ${farms} urban ${urban} tech ${maxTech} ${ERA_NAMES[era]} sold ${soldiers} big ${sizes} herds ${sim.herds.size}/${animals} spp ${sp} routes ${sim.routes.size} parties ${sim.parties.size} armies ${sim.armies.size} T${sim.climate.tempOffset.toFixed(2)} | farm ${jobs[J.farmer]} fish ${jobs[J.fisher]} hunt ${jobs[J.hunter]} herd ${jobs[J.herder]} wood ${jobs[J.woodcutter]} mine ${jobs[J.miner]} art ${jobs[J.artisan]} mer ${jobs[J.merchant]} sch ${jobs[J.scholar]} pri ${jobs[J.priest]} off ${jobs[J.official]} lab ${jobs[J.laborer]} kid ${jobs[J.child]} | ${((now - last) / (25 * TICKS_PER_YEAR)).toFixed(2)}ms/tick`);
    last = now;
  }
}
if (!quiet) {
  console.log('\n--- chronicle (importance >= 3) ---');
  const ev = sim.history.filter((e) => e.imp >= 3);
  for (const e of ev.slice(-70)) console.log(`Y${Math.floor(e.t / TICKS_PER_YEAR) + 1} [${e.kind}] ${e.text}`);
  console.log('\n--- civs ---');
  for (const c of sim.civs.values()) if (c.alive) console.log(`${civFullName(c)}: pop ${c.pop}, towns ${c.settlements.length}, era ${ERA_NAMES[c.era]}, tech ${knownCount(c)}, treasury ${c.treasury.toFixed(0)}, tax ${c.laws.tax.toFixed(2)}, stab ${c.stability.toFixed(2)}, legit ${c.legitimacy.toFixed(2)}`);
  const kinds = new Map<string, number>();
  for (const e of sim.history) kinds.set(e.kind, (kinds.get(e.kind) || 0) + 1);
  console.log('\nevent kinds:', Array.from(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
}
console.log(`total ${(Date.now() - t0) / 1000}s, born ${sim.totalBorn}, died ${sim.totalDied}`);
