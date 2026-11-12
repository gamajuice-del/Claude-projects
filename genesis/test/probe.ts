import { createSim } from '../src/sim/sim';
import { BIOME_NAMES, W_LAND } from '../src/sim/types';
declare const process: { argv: string[] };
for (const seed of [99, 1234, 7, 2024]) {
  const sim = createSim({ seed, w: 256, h: 160, land: 0.36, tribes: 0, popCap: 1000 });
  const w = sim.world;
  const cnt = new Array(20).fill(0);
  let land = 0, m = 0, v = 0, f = 0, dry = 0;
  for (let i = 0; i < w.n; i++) {
    if (w.water[i] !== W_LAND) continue;
    land++; cnt[w.biome[i]]++; m += w.moist[i]; v += w.veg[i]; f += w.forest[i]; if (w.moist[i] < 0.2) dry++;
  }
  console.log(`seed ${seed}: land ${land} moist ${(m / land).toFixed(2)} veg ${(v / land).toFixed(2)} forest ${(f / land).toFixed(2)} dry<0.2 ${(dry / land * 100).toFixed(0)}% | ` + cnt.map((c, k) => (c ? `${BIOME_NAMES[k]} ${(c / land * 100).toFixed(0)}%` : '')).filter(Boolean).slice(0).join(', '));
}
