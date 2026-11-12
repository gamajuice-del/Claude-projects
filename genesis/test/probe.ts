import { createSim, tick } from '../src/sim/sim';
import { TICKS_PER_YEAR } from '../src/sim/types';
import { serialize, deserialize } from '../src/sim/save';
declare const process: { argv: string[] };
const mode = process.argv[2];
if (mode === 'eco') {
  const sim = createSim({ seed: 81, w: 128, h: 80, land: 0.4, tribes: 0, popCap: 1000 });
  for (let y = 0; y <= 200; y++) {
    if (y % 25 === 0) console.log(`y${y} herds ${sim.herds.size}: ` + Array.from(sim.species.values()).map((s) => `${s.name.split(' ')[1]}${s.diet === 1 ? '*' : ''}:${s.extinct >= 0 ? 'X' : s.count}`).join(' '));
    for (let k = 0; k < TICKS_PER_YEAR; k++) tick(sim);
  }
} else {
  // find non-finite numbers or undefined in the state, and the first tick at which a loaded copy diverges
  const a = createSim({ seed: 7, w: 128, h: 80, land: 0.4, tribes: 5, popCap: 6000 });
  for (let k = 0; k < 60 * TICKS_PER_YEAR; k++) tick(a);
  const bad: string[] = [];
  const walk = (v: any, path: string, depth: number) => {
    if (bad.length > 20 || depth > 7) return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(path + '=' + v); return; }
    if (v === undefined) { bad.push(path + '=undefined'); return; }
    if (v === null || typeof v !== 'object') return;
    if (ArrayBuffer.isView(v)) { const arr = v as any; for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { bad.push(path + '[' + i + ']=' + arr[i]); break; } return; }
    if (v instanceof Map) { let n = 0; for (const [k, x] of v) { if (n++ > 400) break; walk(x, path + '<' + k + '>', depth + 1); } return; }
    if (Array.isArray(v)) { for (let i = 0; i < Math.min(v.length, 400); i++) walk(v[i], path + '[' + i + ']', depth + 1); return; }
    for (const k in v) { if (k === 'rt') continue; walk(v[k], path + '.' + k, depth + 1); }
  };
  walk(a, 'sim', 0);
  console.log('non-finite/undefined:', bad.length ? bad.join('\n  ') : 'none');
  const b = deserialize(serialize(a));
  const snap = (s: any) => JSON.stringify({ t: s.tick, rng: s.rng.s, id: s.nextId, pop: s.people.size, herds: s.herds.size, hn: Array.from(s.herds.values()).reduce((x: number, h: any) => x + h.n, 0), parties: s.parties.size, food: Array.from(s.settlements.values()).reduce((x: number, t: any) => x + t.stock[0], 0), fires: s.fires.length, storms: s.storms.length, hist: s.history.length });
  for (let k = 0; k < 2000; k++) {
    tick(a); tick(b);
    const sa = snap(a), sb = snap(b);
    if (sa !== sb) { console.log('diverged at +' + (k + 1) + ' ticks\n A ' + sa + '\n B ' + sb); break; }
    if (k === 1999) console.log('no divergence in 2000 ticks');
  }
}
