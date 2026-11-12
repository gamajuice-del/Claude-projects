// Dev harness: simulate a world, then expose the renderer so a headless browser can photograph it.
import { createSim, tick } from '../src/sim/sim';
import { Renderer } from '../src/render/renderer';
import { TICKS_PER_YEAR } from '../src/sim/types';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') || 99);
const years = Number(q.get('years') || 200);
const sim = createSim({ seed, w: 256, h: 160, land: 0.36, tribes: 8, popCap: 12000 });
for (let k = 0; k < years * TICKS_PER_YEAR; k++) tick(sim);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new Renderer(canvas);
r.setSim(sim);
const W = window as any;
W.sim = sim;
W.r = r;
W.view = (x: number, y: number, zoom: number) => {
  r.resize();
  if (zoom > 0) { r.centerOn(x, y, zoom); r.cam.x = r.cam.tx; r.cam.y = r.cam.ty; r.cam.zoom = r.cam.tz; } else r.fit();
  r.terrain.seasonTick = sim.tick;
  for (let c = 0; c < r.terrain.canvases.length; c++) r.terrain.renderChunk(c);
  for (let k = 0; k < 30; k++) { if (k < 8) tick(sim); r.frame(0.05, 4); }
};
W.biggest = () => {
  let b: any = null;
  for (const s of sim.settlements.values()) if (!b || s.people.length > b.people.length) b = s;
  return b ? { x: b.x, y: b.y, name: b.name, pop: b.people.length } : null;
};
W.ready = true;
