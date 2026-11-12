// Entry point: owns the game loop, input, tools, and world lifecycle. Simulation and rendering are
// separate modules; this file only schedules them and forwards the player's hand.
import { Sim, TICKS_PER_YEAR } from './sim/types';
import { SimOpts, createSim, tick } from './sim/sim';
import { deserialize, serialize } from './sim/save';
import { commitTerrain } from './sim/powers';
import { Renderer } from './render/renderer';
import { Game, SlotInfo, TOOLS, UI } from './ui/ui';
import { download, getSave, gunzip, gzip, listSaves, putSave } from './ui/storage';

const RATES = [0, 4, 16, 64, Infinity];

class GameImpl implements Game {
  sim!: Sim;
  renderer: Renderer;
  ui!: UI;
  speed = 2;
  tps = 0;
  tool = 'inspect';
  brush = 4;
  spawnSpecies = -1;
  follow = false;
  autosave = true;
  private acc = 0;
  private last = 0;
  private lastAuto = 0;
  private canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.getElementById('map') as HTMLCanvasElement;
    this.renderer = new Renderer(this.canvas);
    this.renderer.minimap = document.getElementById('minimap') as HTMLCanvasElement;
  }

  start(opts: SimOpts, restored: Sim | null = null): void {
    this.sim = restored || createSim(opts);
    this.renderer.setSim(this.sim);
    this.ui = new UI(this);
    this.bindInput();
    window.addEventListener('resize', () => this.renderer.resize());
    document.getElementById('loading')!.hidden = true;
    this.last = performance.now();
    this.lastAuto = this.last;
    requestAnimationFrame((t) => this.frame(t));
  }

  setSpeed(n: number): void {
    this.speed = Math.max(0, Math.min(4, n));
    this.acc = 0;
    this.ui.syncSpeed();
  }

  setTool(id: string): void {
    this.tool = id;
    if (id === 'inspect') this.renderer.brush = null;
    this.canvas.style.cursor = id === 'inspect' ? 'grab' : 'crosshair';
  }

  private swapSim(sim: Sim): void {
    this.sim = sim;
    this.renderer.setSim(sim);
    this.ui.select(null);
    this.spawnSpecies = -1;
    this.ui.syncTools();
    this.acc = 0;
  }

  newWorld(o: SimOpts): void {
    const el = document.getElementById('loading')!;
    el.hidden = false;
    setTimeout(() => {
      try {
        this.swapSim(createSim(o));
        this.ui.toast(`A new world: seed ${o.seed}.`);
      } finally {
        el.hidden = true;
      }
    }, 30);
  }

  private info(slot: string): SlotInfo {
    const s = this.sim;
    return { slot, when: Date.now(), year: Math.floor(s.tick / TICKS_PER_YEAR) + 1, pop: s.people.size, size: `${s.world.w}×${s.world.h}` };
  }

  async saveSlot(slot: string): Promise<string> {
    try {
      await putSave(this.info(slot), serialize(this.sim));
      return slot === 'auto' ? 'Autosaved.' : 'World saved.';
    } catch (e) {
      return 'Could not save here: this browser is blocking storage. Try exporting to a file.';
    }
  }

  async loadSlot(slot: string): Promise<string> {
    try {
      const json = await getSave(slot);
      if (!json) return 'That slot is empty.';
      this.swapSim(deserialize(json));
      this.ui.toggleWindow(null);
      return `World loaded: year ${Math.floor(this.sim.tick / TICKS_PER_YEAR) + 1}.`;
    } catch (e) {
      return 'Could not load: ' + (e instanceof Error ? e.message : 'the save is unreadable.');
    }
  }

  listSlots(): Promise<SlotInfo[]> {
    return listSaves();
  }

  exportFile(): void {
    const s = this.sim;
    const stem = `genesis-seed${s.world.seed}-year${Math.floor(s.tick / TICKS_PER_YEAR) + 1}`;
    const host = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
    if (host && typeof host.use === 'function') {
      // hosted page: files are handed over through the viewer, who confirms the save
      const json = serialize(s);
      host
        .use('downloads')
        .then((dl) => {
          const d = dl as { save?: (r: { filename: string; data: Blob }) => Promise<unknown> } | null;
          if (!d || !d.save) {
            this.ui.toast('This viewer cannot save files. Use a save slot instead.');
            return;
          }
          return d.save({ filename: stem + '.json', data: new Blob([json]) }).then(
            () => this.ui.toast('World exported.'),
            (e: { code?: string }) => this.ui.toast(e && e.code === 'declined' ? 'Export cancelled.' : e && e.code === 'rate_limited' ? 'A save prompt is already open.' : 'This viewer cannot save files. Use a save slot instead.'),
          );
        })
        .catch(() => this.ui.toast('This viewer cannot save files. Use a save slot instead.'));
      return;
    }
    gzip(serialize(s))
      .then((blob) => {
        download(stem + '.genesis', blob);
        this.ui.toast('World exported to your downloads.');
      })
      .catch(() => this.ui.toast('Could not export.'));
  }

  importFile(): void {
    const inp = document.getElementById('file') as HTMLInputElement;
    inp.value = '';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      gunzip(f)
        .then((json) => {
          this.swapSim(deserialize(json));
          this.ui.toggleWindow(null);
          this.ui.toast(`World loaded from ${f.name}.`);
        })
        .catch((e) => this.ui.toast('Could not open that file: ' + (e instanceof Error ? e.message : 'unreadable.')));
    };
    inp.click();
  }

  // ------------------------------------------------------------ loop

  private frame(now: number): void {
    const dt = Math.min(0.1, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    const rate = RATES[this.speed];
    let ran = 0;
    if (rate > 0) {
      this.acc += rate === Infinity ? 1e6 : dt * rate;
      const budget = this.speed === 4 ? 13 : 9;
      const t0 = performance.now();
      while (this.acc >= 1) {
        tick(this.sim);
        this.acc -= 1;
        ran++;
        if (performance.now() - t0 > budget) break;
      }
      if (this.acc > 3) this.acc = 3; // never build up a debt of ticks
    }
    this.tps = this.tps * 0.9 + (ran / dt) * 0.1;
    if (this.sim.rt.terrainPending && !this.pointerDown) commitTerrain(this.sim);
    if (this.follow) this.followSelection();
    this.renderer.frame(dt, this.speed === 0 ? 0 : this.tps);
    this.ui.update(dt);
    if (this.autosave && now - this.lastAuto > 5 * 60 * 1000) {
      this.lastAuto = now;
      this.saveSlot('auto').catch(() => {});
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private followSelection(): void {
    const sel = this.ui.sel;
    const sim = this.sim;
    if (!sel) return;
    let x = -1, y = -1;
    if (sel.kind === 'army') { const a = sim.armies.get(sel.id); if (a) { x = a.x; y = a.y; } }
    else if (sel.kind === 'party') { const a = sim.parties.get(sel.id); if (a) { x = a.x; y = a.y; } }
    else if (sel.kind === 'herd') { const a = sim.herds.get(sel.id); if (a) { x = a.x; y = a.y; } }
    else if (sel.kind === 'person') {
      const p = sim.people.get(sel.id);
      if (p) {
        const a = sim.armies.get(p.army), pt = sim.parties.get(p.party), s = sim.settlements.get(p.home);
        if (a) { x = a.x; y = a.y; } else if (pt) { x = pt.x; y = pt.y; } else if (s) {
          const wk = this.renderer.walkers.find((q) => q.id === p.id);
          if (wk) { x = wk.x / 8 - 0.5; y = wk.y / 8 - 0.5; } else { x = s.x; y = s.y; }
        }
      }
    }
    if (x >= 0) this.renderer.centerOn(x, y);
  }

  // ------------------------------------------------------------ input

  private pointerDown = false;

  private bindInput(): void {
    const cv = this.canvas;
    const r = this.renderer;
    const pts = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'pan' | 'tool' | 'pinch' = 'none';
    let moved = 0, lastX = 0, lastY = 0, lastApply = 0, pinchD = 0, pinchX = 0, pinchY = 0, holdTimer = 0, button = 0;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const b = cv.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const applyTool = (sx: number, sy: number, force: boolean) => {
      const tool = TOOLS.find((t) => t.id === this.tool);
      if (!tool || tool.id === 'inspect') return;
      const now = performance.now();
      if (!force && now - lastApply < 55) return;
      lastApply = now;
      const t = r.screenToTile(sx, sy);
      const w = this.sim.world;
      const tx = Math.floor(t.x), ty = Math.floor(t.y);
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return;
      tool.apply(this, tx, ty, this.brush, this.ui);
    };
    const setBrush = (sx: number, sy: number) => {
      const tool = TOOLS.find((t) => t.id === this.tool);
      if (!tool || tool.id === 'inspect') { r.brush = null; return; }
      const t = r.screenToTile(sx, sy);
      r.brush = { x: Math.floor(t.x), y: Math.floor(t.y), r: tool.drag || ['meteor', 'quake', 'tsunami', 'flood', 'locust', 'mutate', 'fire'].indexOf(tool.id) >= 0 ? this.brush : 0.6, color: tool.color };
    };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, p);
      this.pointerDown = true;
      this.follow = false;
      if (pts.size === 2) {
        clearInterval(holdTimer);
        mode = 'pinch';
        const [a, b] = Array.from(pts.values());
        pinchD = Math.hypot(a.x - b.x, a.y - b.y);
        pinchX = (a.x + b.x) / 2;
        pinchY = (a.y + b.y) / 2;
        return;
      }
      button = e.button;
      lastX = p.x;
      lastY = p.y;
      moved = 0;
      if (e.button !== 0 || this.tool === 'inspect' || spaceHeld) {
        mode = 'pan';
        cv.style.cursor = 'grabbing';
      } else {
        mode = 'tool';
        setBrush(p.x, p.y);
        applyTool(p.x, p.y, true);
        const tool = TOOLS.find((t) => t.id === this.tool);
        if (tool && tool.drag) {
          clearInterval(holdTimer);
          holdTimer = window.setInterval(() => applyTool(lastX, lastY, false), 70);
        }
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (mode === 'pinch' && pts.size >= 2) {
        const [a, b] = Array.from(pts.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (pinchD > 0) r.zoomAt(mx, my, d / pinchD);
        r.pan(mx - pinchX, my - pinchY);
        r.cam.zoom = r.cam.tz;
        pinchD = d;
        pinchX = mx;
        pinchY = my;
        return;
      }
      if (mode === 'pan') {
        const dx = p.x - lastX, dy = p.y - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        r.pan(dx, dy);
      } else if (mode === 'tool') {
        const tool = TOOLS.find((t) => t.id === this.tool);
        if (tool && tool.drag) applyTool(p.x, p.y, false);
      }
      lastX = p.x;
      lastY = p.y;
      if (e.pointerType === 'mouse' || mode === 'tool') setBrush(p.x, p.y);
    });
    const up = (e: PointerEvent) => {
      const p = local(e);
      pts.delete(e.pointerId);
      clearInterval(holdTimer);
      if (pts.size === 0) this.pointerDown = false;
      if (mode === 'pan' && moved < 7 && button === 0) this.ui.select(r.pick(p.x, p.y));
      if (mode === 'pinch' && pts.size === 1) {
        const q = Array.from(pts.values())[0];
        lastX = q.x;
        lastY = q.y;
        mode = 'pan';
        moved = 99;
        return;
      }
      if (e.pointerType !== 'mouse') r.brush = null;
      mode = 'none';
      cv.style.cursor = this.tool === 'inspect' ? 'grab' : 'crosshair';
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (mode === 'none') r.brush = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      r.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
    }, { passive: false });
    let spaceHeld = false;
    const keys = new Set<string>();
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        if (!e.repeat) this.setSpeed(this.speed === 0 ? this.prevSpeed : ((this.prevSpeed = this.speed), 0));
        return;
      }
      if (k >= '1' && k <= '4') this.setSpeed(Number(k));
      else if (k === '0') this.setSpeed(0);
      else if (k === 'escape') {
        if (this.ui.win) this.ui.toggleWindow(null);
        else if (this.tool !== 'inspect') { this.setTool('inspect'); this.ui.syncTools(); }
        else this.ui.select(null);
      } else if (k === 'm') {
        const sel = document.getElementById('mapmode') as HTMLSelectElement;
        sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
        r.mode = sel.value as typeof r.mode;
      } else if (k === '+' || k === '=') r.zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.3);
      else if (k === '-') r.zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.3);
      else if (k === 'shift') spaceHeld = true;
      else keys.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      keys.delete(k);
      if (k === 'shift') spaceHeld = false;
    });
    window.addEventListener('blur', () => keys.clear());
    // held movement keys glide the camera
    setInterval(() => {
      if (keys.size === 0) return;
      const sp = 16;
      let dx = 0, dy = 0;
      if (keys.has('a') || keys.has('arrowleft')) dx += sp;
      if (keys.has('d') || keys.has('arrowright')) dx -= sp;
      if (keys.has('w') || keys.has('arrowup')) dy += sp;
      if (keys.has('s') || keys.has('arrowdown')) dy -= sp;
      if (dx || dy) { this.follow = false; r.pan(dx, dy); }
    }, 16);
  }

  private prevSpeed = 2;
}

function boot(): void {
  const game = new GameImpl();
  (window as unknown as { genesis: GameImpl }).genesis = game; // handle for the browser tests and the curious
  // When the page is hosted somewhere that can hand state across a reload, keep the world.
  const hot = (window as unknown as { claude?: { hot?: { snapshot?: (f: () => unknown) => void; ready?: (f: (d: unknown) => void) => void; data?: unknown } } }).claude?.hot;
  try {
    hot?.snapshot?.(() => {
      try {
        const world = serialize(game.sim);
        return world.length < 14e6 ? { world } : { seed: game.sim.world.seed };
      } catch {
        return {};
      }
    });
  } catch {
    /* no host */
  }
  const begin = (data: unknown) => {
    const d = (data || {}) as { world?: string; seed?: number };
    // let the "shaping the world" message paint before the heavy work
    setTimeout(() => {
      let restored: Sim | null = null;
      if (d.world) {
        try {
          restored = deserialize(d.world);
        } catch {
          restored = null;
        }
      }
      const seed = d.seed || Math.floor(Math.random() * 99999) + 1;
      game.start({ seed, w: 256, h: 160, land: 0.36, tribes: 8, popCap: 12000 }, restored);
    }, 30);
  };
  if (hot?.ready) hot.ready(begin);
  else begin(hot?.data ?? {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
