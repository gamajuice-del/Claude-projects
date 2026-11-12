// A* over the tile grid for land travel (terrain + roads + fords) and sea travel.
import { Sim, W_LAND } from './types';
import { DX8, DY8, HILL, MOUNTAIN, MinHeap, PEAK, SEA } from './world';

const heap = new MinHeap();

/** cost to step onto land tile j. Water next to shore can be ferried at a steep price. */
export function landStepCost(sim: Sim, j: number): number {
  const w = sim.world;
  if (w.water[j] !== W_LAND) return w.coast[j] ? 6 : Infinity;
  const rel = w.elev[j] - w.seaLevel + SEA;
  let c = 1;
  if (rel > PEAK) c = 9;
  else if (rel > MOUNTAIN) c = 4.5;
  else if (rel > HILL) c = 2;
  c += w.forest[j] * 0.8;
  if (w.river[j] > 20) c += 1.2;
  const r = w.road[j];
  if (r === 1) c = Math.min(c, 1) * 0.6;
  else if (r === 2) c = 0.4;
  else if (r >= 3) c = 0.15;
  return c;
}

export function findPath(sim: Sim, from: number, to: number, sea: boolean, maxNodes = 30000): number[] | null {
  const w = sim.world;
  const rt = sim.rt;
  if (from === to) return [from];
  const W = w.w,
    H = w.h;
  const gen = ++rt.pathGen;
  const stamp = rt.pathStamp,
    gs = rt.pathG,
    prev = rt.pathFrom;
  heap.clear();
  const tx = to % W,
    ty = (to / W) | 0;
  stamp[from] = gen;
  gs[from] = 0;
  prev[from] = -1;
  heap.push(0, from);
  let nodes = 0;
  const hmin = sea ? 1 : 0.5; // optimistic land cost per tile; keeps long searches focused
  while (heap.size) {
    const i = heap.pop();
    if (i === to) break;
    if (++nodes > maxNodes) return null;
    const g = gs[i];
    const x = i % W,
      y = (i / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d],
        ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      let c: number;
      if (sea) {
        if (w.water[j] === W_LAND && j !== to) continue;
        c = 1;
      } else {
        c = j === to ? 1 : landStepCost(sim, j);
        if (c === Infinity) continue;
      }
      if (d >= 4) c *= 1.414;
      const ng = g + c;
      if (stamp[j] === gen && gs[j] <= ng) continue;
      stamp[j] = gen;
      gs[j] = ng;
      prev[j] = i;
      const hx = Math.abs(nx - tx),
        hy = Math.abs(ny - ty);
      heap.push(ng + (Math.max(hx, hy) + 0.414 * Math.min(hx, hy)) * hmin, j);
    }
  }
  if (stamp[to] !== gen) return null;
  const path: number[] = [];
  let k = to;
  while (k !== -1) {
    path.push(k);
    k = prev[k];
  }
  path.reverse();
  return path;
}

export function pathCost(sim: Sim, path: number[], sea: boolean): number {
  if (sea) return path.length * 0.22;
  let c = 0;
  for (let k = 1; k < path.length; k++) c += Math.min(6, landStepCost(sim, path[k]));
  return c;
}

/** nearest water tile to (x,y) within r that touches the open coast, or -1 */
export function findPortTile(sim: Sim, x: number, y: number, r: number): number {
  const w = sim.world;
  let best = -1,
    bd = 1e9;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const j = ny * w.w + nx;
      if (w.water[j] === W_LAND || !w.coast[j]) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
  }
  return best;
}

/** nearest land tile adjacent to water tile i */
export function landingNear(sim: Sim, i: number): number {
  const w = sim.world;
  const x = i % w.w,
    y = (i / w.w) | 0;
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d],
      ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
    const j = ny * w.w + nx;
    if (w.water[j] === W_LAND) return j;
  }
  return -1;
}
