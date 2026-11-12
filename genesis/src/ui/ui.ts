// Interface: time controls, god-power palette, inspector for anything in the world, and the windows
// (chronicle, nations, life, charts, technology, world settings). All numbers shown are read straight
// from simulation state.
import {
  BIOME_NAMES, BLD_NAMES, Civ, FACTION_NAMES, G, GOAL_NAMES, GOOD_BASE, GOOD_NAMES, GOV_NAMES, Grave, HistEvent, IMP_NAMES, J, JOB_NAMES, M,
  MONTH_NAMES, NG, PARTY, Person, RES_NAMES, SEASON_NAMES, Settlement, Sim, Species, TICKS_PER_YEAR, TITLE, TITLE_NAMES, W_LAND, monthOf, seasonOf,
} from '../sim/types';
import { ERA_NAMES, NT, TECHS, TECH_PRE, canResearch, civEnv, knownCount, techCost } from '../sim/tech';
import { civFullName, effectiveCost, relationOf } from '../sim/civ';
import { rulerTitle } from '../sim/names';
import { ageOf, fullName } from '../sim/people';
import { meanTemp, rainAnomaly, tempAt, SEA } from '../sim/world';
import { SimOpts, spawnTribe } from '../sim/sim';
import * as powers from '../sim/powers';
import { createSpecies } from '../sim/ecology';
import { updateSeaLevel } from '../sim/climate';
import { Pick, Renderer, MapMode } from '../render/renderer';
import { EVENT_COLORS, JOB_COLORS, STYLES, civCss } from '../render/palette';

export interface SlotInfo {
  slot: string;
  when: number;
  year: number;
  pop: number;
  size: string;
}

export interface Game {
  sim: Sim;
  renderer: Renderer;
  speed: number;
  tps: number;
  tool: string;
  brush: number;
  spawnSpecies: number;
  follow: boolean;
  autosave: boolean;
  setSpeed(n: number): void;
  setTool(id: string): void;
  newWorld(o: SimOpts): void;
  saveSlot(slot: string): Promise<string>;
  loadSlot(slot: string): Promise<string>;
  listSlots(): Promise<SlotInfo[]>;
  exportFile(): void;
  importFile(): void;
}

export interface Tool {
  id: string;
  cat: string;
  label: string;
  hint: string;
  color: string;
  drag: boolean;
  apply: (g: Game, x: number, y: number, r: number, ui: UI) => void;
}

const CATS: [string, string][] = [['look', 'Look'], ['land', 'Land'], ['nature', 'Biome'], ['ore', 'Ore'], ['life', 'Life'], ['sky', 'Sky'], ['doom', 'Doom'], ['divine', 'Divine']];

function nearestSettlement(sim: Sim, x: number, y: number, maxD: number): Settlement | null {
  let best: Settlement | null = null,
    bd = maxD * maxD;
  for (const s of sim.settlements.values()) {
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
    if (s.alive && d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

const paint = (kind: powers.BiomeBrush) => (g: Game, x: number, y: number, r: number) => powers.paintBiome(g.sim, x, y, r, kind);
const ore = (res: number) => (g: Game, x: number, y: number, r: number) => powers.placeResource(g.sim, x, y, r, res);

export const TOOLS: Tool[] = [
  { id: 'inspect', cat: 'look', label: 'Inspect', hint: 'Click a person, town, army, herd or tile to study it. Drag to move the map; scroll or pinch to zoom.', color: '#ece6d6', drag: false, apply: () => {} },
  { id: 'raise', cat: 'land', label: 'Raise', hint: 'Lift the land. Raise the seabed to make islands and land bridges.', color: '#c9a07a', drag: true, apply: (g, x, y, r) => powers.sculpt(g.sim, x, y, r, 0.012) },
  { id: 'lower', cat: 'land', label: 'Lower', hint: 'Sink the land. Below sea level it floods.', color: '#6fb4ea', drag: true, apply: (g, x, y, r) => powers.sculpt(g.sim, x, y, r, -0.012) },
  { id: 'mountain', cat: 'land', label: 'Mountain', hint: 'Thrust up peaks. Mountains block armies and cast rain shadows on new rainfall.', color: '#b8b0a8', drag: true, apply: (g, x, y, r) => powers.sculpt(g.sim, x, y, Math.max(1, r * 0.7), 0.035) },
  { id: 'smooth', cat: 'land', label: 'Smooth', hint: 'Level rough ground.', color: '#d8c8a0', drag: true, apply: (g, x, y, r) => powers.smooth(g.sim, x, y, r) },
  { id: 'water', cat: 'land', label: 'Sea', hint: 'Carve a channel or lake.', color: '#3f8fd0', drag: true, apply: (g, x, y, r) => powers.digWater(g.sim, x, y, Math.max(1, r * 0.6)) },
  { id: 'forest', cat: 'nature', label: 'Forest', hint: 'Make the land wet and wooded. The change persists: you are altering rainfall and soil.', color: '#3f9450', drag: true, apply: paint('forest') },
  { id: 'grass', cat: 'nature', label: 'Grassland', hint: 'Open, fertile grazing land.', color: '#8fc05a', drag: true, apply: paint('grass') },
  { id: 'desert', cat: 'nature', label: 'Desert', hint: 'Take the rain away. Crops fail, forests die back, people leave.', color: '#dcc68c', drag: true, apply: paint('desert') },
  { id: 'swamp', cat: 'nature', label: 'Swamp', hint: 'Drown the lowlands in rain.', color: '#4f7f6a', drag: true, apply: paint('swamp') },
  { id: 'fertile', cat: 'nature', label: 'Rich soil', hint: 'Bless the soil with fertility.', color: '#6a4a2c', drag: true, apply: paint('fertile') },
  { id: 'barren', cat: 'nature', label: 'Barren', hint: 'Strip plants and topsoil.', color: '#9a8c7c', drag: true, apply: paint('barren') },
  { id: 'hot', cat: 'nature', label: 'Warm', hint: 'Make this place permanently warmer.', color: '#f08a4a', drag: true, apply: paint('hot') },
  { id: 'cold', cat: 'nature', label: 'Chill', hint: 'Make this place permanently colder. Enough of it and the snow never melts.', color: '#bfe0f4', drag: true, apply: paint('cold') },
  { id: 'r1', cat: 'ore', label: 'Stone', hint: 'Lay down building stone.', color: '#bebec4', drag: true, apply: ore(1) },
  { id: 'r2', cat: 'ore', label: 'Copper', hint: 'Copper makes bronze possible.', color: '#e28a4e', drag: true, apply: ore(2) },
  { id: 'r3', cat: 'ore', label: 'Iron', hint: 'Iron: tools, weapons, later rails.', color: '#aa6a5a', drag: true, apply: ore(3) },
  { id: 'r4', cat: 'ore', label: 'Coal', hint: 'Coal powers the industrial age — and warms the sky.', color: '#555560', drag: true, apply: ore(4) },
  { id: 'r5', cat: 'ore', label: 'Gold', hint: 'Gold becomes coin in the treasury.', color: '#fad650', drag: true, apply: ore(5) },
  { id: 'r6', cat: 'ore', label: 'Salt', hint: 'Salt preserves food and is traded far.', color: '#f4f4f4', drag: true, apply: ore(6) },
  { id: 'r7', cat: 'ore', label: 'Oil', hint: 'Oil: engines and mechanised farms.', color: '#7a3ca0', drag: true, apply: ore(7) },
  { id: 'r0', cat: 'ore', label: 'Remove', hint: 'Erase deposits. Watch what the miners do next.', color: '#70707a', drag: true, apply: ore(0) },
  {
    id: 'tribe', cat: 'life', label: 'People', hint: 'Set down a new band of people with their own language and customs.', color: '#f2b33d', drag: false,
    apply: (g, x, y, _r, ui) => {
      const c = spawnTribe(g.sim, x, y, 30);
      ui.toast(c ? `The ${c.name} make camp.` : 'People need open, level land that nobody owns.');
    },
  },
  {
    id: 'herd', cat: 'life', label: 'Animals', hint: 'Release a herd of the chosen species (pick one in the Life window).', color: '#8fd0a0', drag: false,
    apply: (g, x, y, _r, ui) => {
      const sp = g.sim.species.get(g.spawnSpecies) || Array.from(g.sim.species.values()).find((s) => s.extinct < 0);
      if (sp) powers.placeHerd(g.sim, sp, x, y);
      else ui.toast('No species to release. Create one in the Life window.');
    },
  },
  { id: 'mutate', cat: 'life', label: 'Mutate', hint: 'Scramble the genes of herds here — new species may result — and change the people nearby.', color: '#96fa96', drag: false, apply: (g, x, y, r) => powers.mutateArea(g.sim, x, y, r + 2) },
  { id: 'cull', cat: 'life', label: 'Cull', hint: 'Remove the animals here.', color: '#c08a8a', drag: true, apply: (g, x, y, r) => powers.cullHerds(g.sim, x, y, r) },
  { id: 'rain', cat: 'sky', label: 'Rain', hint: 'Soak the land. Puts out fires, breaks droughts.', color: '#6fb4ea', drag: true, apply: (g, x, y, r) => powers.rain(g.sim, x, y, r) },
  { id: 'drought', cat: 'sky', label: 'Drought', hint: 'Parch the land. Hold it over farmland and watch the granaries.', color: '#e0c070', drag: true, apply: (g, x, y, r) => powers.drought(g.sim, x, y, r) },
  { id: 'bolt', cat: 'sky', label: 'Lightning', hint: 'Strike a single point. Dry forest will burn.', color: '#fff2c0', drag: false, apply: (g, x, y) => powers.lightning(g.sim, x, y) },
  { id: 'fire', cat: 'sky', label: 'Wildfire', hint: 'Set the land alight. It spreads through dry growth on its own.', color: '#f08a4a', drag: false, apply: (g, x, y, r) => powers.fire(g.sim, x, y, r) },
  { id: 'storm', cat: 'sky', label: 'Thunderstorm', hint: 'Call a thunderstorm. It drifts with the wind, raining and striking.', color: '#9aa7b5', drag: false, apply: (g, x, y) => powers.storm(g.sim, x, y, 1) },
  { id: 'hurricane', cat: 'sky', label: 'Hurricane', hint: 'A great spiral storm that batters towns and forests.', color: '#c8d4e0', drag: false, apply: (g, x, y) => powers.storm(g.sim, x, y, 3) },
  { id: 'blizzard', cat: 'sky', label: 'Blizzard', hint: 'A wall of snow.', color: '#f0f4fa', drag: false, apply: (g, x, y) => powers.storm(g.sim, x, y, 2) },
  { id: 'meteor', cat: 'doom', label: 'Meteor', hint: 'Drop a star. Craters the land, burns everything around, dims the sun for years.', color: '#f0603a', drag: false, apply: (g, x, y, r) => powers.meteor(g.sim, x, y, Math.max(2, Math.min(7, r))) },
  { id: 'volcano', cat: 'doom', label: 'Volcano', hint: 'Raise a volcano here and set it off. It will erupt again in ages to come.', color: '#e0401a', drag: false, apply: (g, x, y) => powers.erupt(g.sim, x, y) },
  { id: 'quake', cat: 'doom', label: 'Earthquake', hint: 'Shake the ground. Buildings fall.', color: '#c9a07a', drag: false, apply: (g, x, y, r) => powers.quake(g.sim, x, y, r + 5) },
  { id: 'tsunami', cat: 'doom', label: 'Great wave', hint: 'Drown the low coast.', color: '#78c8fa', drag: false, apply: (g, x, y, r) => powers.tsunami(g.sim, x, y, r + 4) },
  { id: 'flood', cat: 'doom', label: 'River flood', hint: 'Burst the riverbanks here.', color: '#4f9fe0', drag: false, apply: (g, x, y, r) => powers.riverFlood(g.sim, x, y, r + 2) },
  { id: 'locust', cat: 'doom', label: 'Locusts', hint: 'Strip the fields and granaries.', color: '#c0c060', drag: false, apply: (g, x, y, r) => powers.blight(g.sim, x, y, r + 2) },
  {
    id: 'plague', cat: 'doom', label: 'Plague', hint: 'Loose a plague in the nearest town. It travels with caravans and refugees.', color: '#b58cf5', drag: false,
    apply: (g, x, y, r, ui) => {
      const s = nearestSettlement(g.sim, x, y, r + 5);
      if (s) powers.plague(g.sim, s);
      else ui.toast('No town close enough.');
    },
  },
  {
    id: 'bless', cat: 'divine', label: 'Bless town', hint: 'Heal the sick, fill the granaries, calm tempers. They will remember it as a miracle.', color: '#f2b33d', drag: false,
    apply: (g, x, y, r, ui) => {
      const s = nearestSettlement(g.sim, x, y, r + 5);
      if (s) powers.blessSettlement(g.sim, s);
      else ui.toast('No town close enough.');
    },
  },
  {
    id: 'curse', cat: 'divine', label: 'Curse town', hint: 'Sour the grain and the mood. Unrest follows — perhaps revolt.', color: '#b58cf5', drag: false,
    apply: (g, x, y, r, ui) => {
      const s = nearestSettlement(g.sim, x, y, r + 5);
      if (s) powers.curseSettlement(g.sim, s);
      else ui.toast('No town close enough.');
    },
  },
  {
    id: 'revolt', cat: 'divine', label: 'Incite revolt', hint: 'Whisper rebellion into the nearest town.', color: '#ef6b5e', drag: false,
    apply: (g, x, y, r, ui) => {
      const s = nearestSettlement(g.sim, x, y, r + 5);
      if (s) powers.inciteRevolt(g.sim, s);
      else ui.toast('No town close enough.');
    },
  },
];

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const yr = (t: number) => Math.floor(t / TICKS_PER_YEAR) + 1;
const num = (v: number) => (Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v).toLocaleString('en-US'));
const bar = (label: string, v: number, cls = '') => `<div class="bar ${cls}"><span>${label}</span><div><i style="width:${(c01(v) * 100).toFixed(0)}%"></i></div><span>${Math.round(c01(v) * 100)}</span></div>`;
const lnk = (kind: string, id: number, text: string) => `<a class="lnk" data-sel="${kind}:${id}">${esc(text)}</a>`;
const kv = (rows: [string, string][]) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const moodCls = (v: number) => (v > 0.7 ? 'good' : v > 0.45 ? 'warn' : 'bad');

function tierName(pop: number): string {
  return pop < 30 ? 'Camp' : pop < 80 ? 'Hamlet' : pop < 200 ? 'Village' : pop < 500 ? 'Town' : pop < 1200 ? 'City' : 'Metropolis';
}

export class UI {
  g: Game;
  sel: Pick | null = null;
  win: string | null = null;
  private cat = 'look';
  private acc = 0;
  private tickerShown = 0;
  private chronFilter = { imp: 2, group: 'all', q: '', year: -1 };
  private techCiv = -1;
  private worldTab = 'new';
  private toastTimer = 0;
  private $: Record<string, HTMLElement> = {};

  constructor(g: Game) {
    this.g = g;
    for (const id of ['date', 'season', 'vitals', 'toolcats', 'toolgrid', 'toolhint', 'brush', 'brushval', 'inspector', 'insp-title', 'insp-body', 'ticker', 'window', 'win-title', 'win-body', 'toast', 'mapmode', 'minimap', 'top', 'speed', 'menus']) {
      this.$[id] = document.getElementById(id)!;
    }
    this.buildTools();
    this.wire();
    this.syncSpeed();
  }

  // ------------------------------------------------------------ wiring

  private wire(): void {
    const $ = this.$;
    $.speed.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b) this.g.setSpeed(Number(b.dataset.speed));
    });
    $.menus.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && b.dataset.win) this.toggleWindow(b.dataset.win);
    });
    ($.mapmode as HTMLSelectElement).addEventListener('change', (e) => {
      this.g.renderer.mode = (e.target as HTMLSelectElement).value as MapMode;
    });
    document.getElementById('insp-close')!.addEventListener('click', () => this.select(null));
    document.getElementById('win-close')!.addEventListener('click', () => this.toggleWindow(null));
    ($.brush as HTMLInputElement).addEventListener('input', (e) => {
      this.g.brush = Number((e.target as HTMLInputElement).value);
      $.brushval.textContent = String(this.g.brush);
    });
    // delegated clicks for links and actions inside panels
    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;
      const a = t.closest('[data-sel]') as HTMLElement | null;
      if (a) {
        const [kind, id] = a.dataset.sel!.split(':');
        this.select({ kind: kind as Pick['kind'], id: Number(id), tile: -1 }, true);
        return;
      }
      const ev = t.closest('[data-ev]') as HTMLElement | null;
      if (ev) {
        this.openEvent(Number(ev.dataset.ev));
        return;
      }
      const act = t.closest('[data-act]') as HTMLElement | null;
      if (act) this.action(act.dataset.act!, act.dataset.arg || '', act);
    };
    $['insp-body'].addEventListener('click', onClick);
    $['win-body'].addEventListener('click', onClick);
    $.ticker.addEventListener('click', onClick);
    const onInput = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset && t.dataset.inp) this.input(t.dataset.inp, t);
    };
    $['insp-body'].addEventListener('input', onInput);
    $['win-body'].addEventListener('input', onInput);
    $['win-body'].addEventListener('change', onInput);
    $['insp-body'].addEventListener('change', onInput);
    $.minimap.addEventListener('click', (e) => {
      const r = $.minimap.getBoundingClientRect();
      const w = this.g.sim.world;
      this.g.renderer.centerOn(((e.clientX - r.left) / r.width) * w.w, ((e.clientY - r.top) / r.height) * w.h);
    });
  }

  private buildTools(): void {
    const cats = this.$.toolcats;
    cats.innerHTML = CATS.map(([id, name]) => `<button data-cat="${id}" id="cat-${id}">${name}</button>`).join('');
    cats.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.cat = b.dataset.cat!;
      const first = TOOLS.find((t) => t.cat === this.cat)!;
      this.g.setTool(first.id);
      this.syncTools();
    });
    this.$.toolgrid.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.g.setTool(b.dataset.tool!);
      this.syncTools();
    });
    this.syncTools();
  }

  syncTools(): void {
    const cur = TOOLS.find((t) => t.id === this.g.tool) || TOOLS[0];
    this.cat = cur.cat;
    for (const [id] of CATS) document.getElementById('cat-' + id)!.classList.toggle('on', id === this.cat);
    this.$.toolgrid.innerHTML = TOOLS.filter((t) => t.cat === this.cat)
      .map((t) => `<button data-tool="${t.id}" id="tool-${t.id}" class="${t.id === cur.id ? 'on' : ''}" title="${esc(t.hint)}"><i style="background:${t.color}"></i><span>${t.label}</span></button>`)
      .join('');
    let hint = cur.hint;
    if (cur.id === 'herd') {
      const sp = this.g.sim.species.get(this.g.spawnSpecies);
      hint += sp ? ` Now releasing: ${sp.name}.` : '';
    }
    this.$.toolhint.textContent = hint;
  }

  syncSpeed(): void {
    for (let k = 0; k <= 4; k++) document.getElementById('sp' + k)!.classList.toggle('on', this.g.speed === k);
  }

  toast(text: string): void {
    const t = this.$.toast;
    t.textContent = text;
    t.hidden = false;
    this.toastTimer = 3.2;
  }

  // ------------------------------------------------------------ selection

  select(p: Pick | null, jump = false): void {
    this.sel = p;
    this.g.renderer.selection = p;
    this.g.follow = false;
    this.$.inspector.hidden = !p;
    if (p) {
      this.renderInspector();
      if (jump) this.jumpTo(p);
    }
  }

  private jumpTo(p: Pick): void {
    const sim = this.g.sim;
    const r = this.g.renderer;
    let x = -1, y = -1;
    if (p.kind === 'settlement') {
      const s = sim.settlements.get(p.id);
      if (s) { x = s.x; y = s.y; }
    } else if (p.kind === 'civ') {
      const c = sim.civs.get(p.id);
      const s = c ? sim.settlements.get(c.capital) : undefined;
      if (s) { x = s.x; y = s.y; }
    } else if (p.kind === 'person') {
      const q = sim.people.get(p.id);
      if (q) {
        const a = sim.armies.get(q.army);
        const pt = sim.parties.get(q.party);
        const s = sim.settlements.get(q.home);
        if (a) { x = a.x; y = a.y; }
        else if (pt) { x = pt.x; y = pt.y; }
        else if (s) { x = s.x; y = s.y; }
      }
    } else if (p.kind === 'army') {
      const a = sim.armies.get(p.id);
      if (a) { x = a.x; y = a.y; }
    } else if (p.kind === 'party') {
      const a = sim.parties.get(p.id);
      if (a) { x = a.x; y = a.y; }
    } else if (p.kind === 'herd') {
      const h = sim.herds.get(p.id);
      if (h) { x = h.x; y = h.y; }
    } else if (p.kind === 'species') {
      for (const h of sim.herds.values()) if (h.sp === p.id) { x = h.x; y = h.y; break; }
    }
    if (x >= 0) r.centerOn(x, y, r.cam.tz / Math.min(2, window.devicePixelRatio || 1) < 2.2 ? 2.6 : undefined);
  }

  private openEvent(id: number): void {
    const sim = this.g.sim;
    const e = sim.history.find((h) => h.id === id);
    if (!e) return;
    if (e.x >= 0) this.g.renderer.centerOn(e.x, e.y, 2.6);
    let pick: Pick | null = null;
    for (const pid of e.people) {
      if (sim.people.has(pid)) { pick = { kind: 'person', id: pid, tile: -1 }; break; }
      if (sim.graves.has(pid)) { pick = { kind: 'grave', id: pid, tile: -1 }; break; }
    }
    if (!pick && e.settlement >= 0 && sim.settlements.has(e.settlement)) pick = { kind: 'settlement', id: e.settlement, tile: -1 };
    if (!pick && e.civs.length && sim.civs.has(e.civs[0])) pick = { kind: 'civ', id: e.civs[0], tile: -1 };
    if (pick) this.select(pick, e.x < 0);
    if (window.innerWidth < 760) this.toggleWindow(null);
  }

  // ------------------------------------------------------------ per-frame

  update(dt: number): void {
    const sim = this.g.sim;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.$.toast.hidden = true;
    }
    this.acc += dt;
    if (this.acc < 0.33) return;
    this.acc = 0;
    // top bar
    this.$.date.textContent = `${MONTH_NAMES[monthOf(sim.tick)]}, Year ${yr(sim.tick)}`;
    this.$.season.textContent = SEASON_NAMES[seasonOf(sim.tick)];
    let civs = 0, wars = 0;
    for (const c of sim.civs.values()) if (c.alive) civs++;
    for (const w of sim.wars.values()) if (w.end < 0) wars++;
    const t = sim.climate.tempOffset;
    this.$.vitals.innerHTML = `<span>People <b>${num(sim.people.size)}</b></span><span>Nations <b>${civs}</b></span><span>Wars <b>${wars}</b></span><span title="Global temperature against the long-run norm">Climate <b>${t >= 0 ? '+' : ''}${t.toFixed(1)}°</b></span>`;
    this.syncSpeed();
    this.renderTicker();
    const ae = document.activeElement as HTMLElement | null;
    const busy = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT');
    const selecting = (window.getSelection()?.toString().length || 0) > 0;
    if (this.sel && !busy && !selecting) this.renderInspector();
    if (this.win && !busy && !selecting && this.win !== 'world' && this.win !== 'help' && this.win !== 'chronicle') this.renderWindow();
    else if (this.win === 'chronicle' && !busy && !selecting && this.g.speed > 0 && this.$['win-body'].scrollTop < 30) this.renderWindow();
  }

  private renderTicker(): void {
    const sim = this.g.sim;
    const minImp = this.g.speed >= 4 ? 4 : this.g.speed >= 3 ? 3 : 2;
    const recent: HistEvent[] = [];
    for (let k = sim.history.length - 1; k >= 0 && recent.length < 4; k--) {
      const e = sim.history[k];
      if (sim.tick - e.t > (this.g.speed >= 3 ? 40 : 14) * TICKS_PER_YEAR / (this.g.speed >= 3 ? 8 : 12)) break;
      if (e.imp >= minImp) recent.push(e);
    }
    const key = recent.length ? recent[0].id : 0;
    if (key === this.tickerShown) return;
    this.tickerShown = key;
    this.$.ticker.innerHTML = recent
      .reverse()
      .map((e) => `<div data-ev="${e.id}" style="border-left-color:${EVENT_COLORS[e.kind] || '#97a4b3'}"><span class="yr">${yr(e.t)}</span>${esc(e.text)}</div>`)
      .join('');
  }

  // ------------------------------------------------------------ inspector

  renderInspector(): void {
    const p = this.sel;
    if (!p) return;
    const sim = this.g.sim;
    let title = '', body = '';
    switch (p.kind) {
      case 'tile': [title, body] = this.tileHtml(p.tile); break;
      case 'settlement': {
        const s = sim.settlements.get(p.id);
        [title, body] = s ? this.settlementHtml(s) : ['Gone', '<p class="muted">Nothing is left of this place but ruins.</p>'];
        break;
      }
      case 'civ': {
        const c = sim.civs.get(p.id);
        [title, body] = c ? this.civHtml(c) : ['Unknown', ''];
        break;
      }
      case 'person': {
        const q = sim.people.get(p.id);
        if (q) [title, body] = this.personHtml(q);
        else {
          const gr = sim.graves.get(p.id);
          [title, body] = gr ? this.graveHtml(gr) : ['Forgotten', '<p class="muted">This person has died and no record of them was kept.</p>'];
        }
        break;
      }
      case 'grave': {
        const gr = sim.graves.get(p.id);
        const q = sim.people.get(p.id);
        [title, body] = q ? this.personHtml(q) : gr ? this.graveHtml(gr) : ['Forgotten', '<p class="muted">No record remains.</p>'];
        break;
      }
      case 'army': [title, body] = this.armyHtml(p.id); break;
      case 'party': [title, body] = this.partyHtml(p.id); break;
      case 'herd': [title, body] = this.herdHtml(p.id); break;
      case 'species': {
        const sp = sim.species.get(p.id);
        [title, body] = sp ? this.speciesHtml(sp) : ['Unknown', ''];
        break;
      }
    }
    this.$['insp-title'].textContent = title;
    const el = this.$['insp-body'];
    const scroll = el.scrollTop;
    el.innerHTML = body;
    el.scrollTop = scroll;
  }

  private tileHtml(i: number): [string, string] {
    const sim = this.g.sim;
    const w = sim.world;
    if (i < 0) return ['Beyond the map', ''];
    const x = i % w.w,
      y = (i / w.w) | 0;
    const land = w.water[i] === W_LAND;
    const s = w.owner[i] >= 0 ? sim.settlements.get(w.owner[i]) : undefined;
    const civ = s ? sim.civs.get(s.civ) : undefined;
    const elevM = Math.round((w.elev[i] - w.seaLevel) * 9000);
    const rows: [string, string][] = [
      ['Position', `${x}, ${y}`],
      ['Elevation', `${elevM >= 0 ? elevM + ' m' : -elevM + ' m deep'}`],
      ['Temperature', `${tempAt(w, sim.climate, i, sim.tick).toFixed(0)}° now · ${meanTemp(w, sim.climate, i).toFixed(0)}° mean`],
    ];
    if (land) {
      const an = rainAnomaly(w, sim.climate, x, y, sim.tick, sim.params.climateVolatility);
      rows.push(['Rain', `${Math.round(w.rain[i] * 100)}% · ${an < 0.62 ? 'drought' : an > 1.45 ? 'deluge' : an < 0.85 ? 'dry spell' : an > 1.2 ? 'wet spell' : 'normal year'}`]);
      if (w.river[i] > 0) rows.push(['River', w.river[i] > 110 ? 'great river' : w.river[i] > 45 ? 'river' : 'stream']);
      if (w.res[i]) rows.push(['Deposit', `${RES_NAMES[w.res[i]]} (${num(w.resAmt[i])} left)`]);
      if (w.imp[i]) rows.push(['Land use', IMP_NAMES[w.imp[i]]]);
      if (w.road[i]) rows.push(['Road', ['', 'track', 'road', 'railway', 'railway'][w.road[i]]]);
      if (w.fire[i]) rows.push(['Status', '<span class="up">burning</span>']);
      if (w.flood[i]) rows.push(['Status', 'flooded']);
    } else rows.push(['Fish', `${Math.round(w.veg[i] * 100)}% of capacity`]);
    if (s && civ) rows.push(['Belongs to', `${lnk('settlement', s.id, s.name)} · ${lnk('civ', civ.id, civ.name)}`]);
    let body = kv(rows);
    if (land) body += `<h4>Ground</h4>${bar('Moisture', w.moist[i])}${bar('Fertility', w.fert[i], 'good')}${bar('Grass', w.veg[i], 'good')}${bar('Forest', w.forest[i], 'good')}`;
    return [BIOME_NAMES[w.biome[i]], body];
  }

  private settlementHtml(s: Settlement): [string, string] {
    const sim = this.g.sim;
    const civ = sim.civs.get(s.civ)!;
    const pop = s.people.length;
    const cul = sim.cultures.get(s.cultureMajor);
    const rel = sim.religions.get(s.religionMajor);
    const gov = sim.people.get(s.governor);
    const tags: string[] = [];
    if (civ.capital === s.id) tags.push('<span class="tag good">capital</span>');
    if (s.siege >= 0) tags.push('<span class="tag bad">under siege</span>');
    if (s.blockaded) tags.push('<span class="tag bad">harbour blockaded</span>');
    if (s.hungerMonths > 2) tags.push('<span class="tag warn">famine</span>');
    if (s.plague > 0) tags.push('<span class="tag magic">plague</span>');
    if (s.drought >= 4) tags.push('<span class="tag warn">drought</span>');
    if (s.unrest > 0.6) tags.push('<span class="tag bad">unrest</span>');
    if (s.damage > 0.15) tags.push('<span class="tag warn">damaged</span>');
    if (s.originalCiv !== s.civ) {
      const oc = sim.civs.get(s.originalCiv);
      tags.push(`<span class="tag">once ${oc ? esc(oc.adj) : 'another people’s'}</span>`);
    }
    let h = `<div class="sub">${tierName(pop)} of the ${lnk('civ', civ.id, civFullName(civ))}</div>`;
    if (tags.length) h += `<div class="tags">${tags.join('')}</div>`;
    h += kv([
      ['People', `${pop} <span class="muted">/ room for ${Math.round(s.housing)}</span>`],
      ['Founded', `year ${yr(s.founded)}`],
      ['Governor', gov ? lnk('person', gov.id, fullName(sim, gov)) : civ.capital === s.id ? 'ruled directly' : '—'],
      ['Culture', cul ? esc(cul.name) : '—'],
      ['Faith', rel ? esc(rel.name) : 'none'],
      ['Territory', `${s.tiles.length} tiles · ${s.farms.length} farmed`],
      ['Trade', `${s.routes.length} routes · ${num(s.tradeVol)} value`],
    ]);
    h += `<h4>Mood</h4>${bar('Fed', s.fedAvg, moodCls(s.fedAvg))}${bar('Content', s.happyAvg, moodCls(s.happyAvg))}${bar('Loyal', s.loyalAvg, moodCls(s.loyalAvg))}${bar('Unrest', s.unrest, s.unrest > 0.5 ? 'bad' : 'warn')}${bar('Inequality', s.gini, 'magic')}`;
    // work
    const jc = s.jobCount;
    const total = pop || 1;
    let seg = '', leg = '';
    for (let j = 0; j < jc.length; j++) {
      if (!jc[j]) continue;
      const c = JOB_COLORS[j];
      seg += `<i style="width:${(jc[j] / total) * 100}%;background:rgb(${c[0]},${c[1]},${c[2]})" title="${JOB_NAMES[j]} ${jc[j]}"></i>`;
      leg += `<span><i style="background:rgb(${c[0]},${c[1]},${c[2]})"></i>${JOB_NAMES[j]} ${jc[j]}</span>`;
    }
    h += `<h4>Who does what</h4><div class="seg">${seg}</div><div class="legend">${leg}</div>`;
    // market
    let rows = '';
    for (let g = 0; g < NG; g++) {
      if (s.stock[g] < 0.5 && s.prod[g] < 0.05 && s.imports[g] < 0.5) continue;
      const ratio = s.price[g] / GOOD_BASE[g];
      const cls = ratio > 1.5 ? 'up' : ratio < 0.7 ? 'down' : '';
      rows += `<tr><td>${GOOD_NAMES[g]}</td><td class="n">${num(s.stock[g])}</td><td class="n">${s.prod[g] >= 0.05 ? '+' + s.prod[g].toFixed(s.prod[g] < 10 ? 1 : 0) : ''}</td><td class="n">${s.imports[g] > 0.5 ? num(s.imports[g]) : ''}</td><td class="n ${cls}">${s.price[g].toFixed(2)}${ratio > 1.5 ? ' ▲' : ratio < 0.7 ? ' ▼' : ''}</td></tr>`;
    }
    h += `<h4>Market</h4><table><tr><th>Good</th><th class="n">Stock</th><th class="n">Made/mo</th><th class="n">Imports</th><th class="n">Price</th></tr>${rows}</table>`;
    // buildings
    const blds: string[] = [];
    for (let b = 0; b < s.bld.length; b++) if (s.bld[b] > 0) blds.push(`${BLD_NAMES[b]}${s.bld[b] > 1 ? ' ' + 'I'.repeat(Math.min(3, s.bld[b])) : ''}`);
    h += `<h4>Works</h4><div>${blds.length ? blds.join(' · ') : '<span class="muted">Nothing but dwellings yet.</span>'}</div>`;
    if (s.build) h += `<div class="muted">Building: ${BLD_NAMES[s.build.type]} (${Math.round((s.build.progress / s.build.need) * 100)}%)</div>`;
    if (s.livestock > 1) h += `<div class="muted">Livestock: ${Math.round(s.livestock)} head</div>`;
    // notable people
    const notable: Person[] = [];
    for (const id of s.people) {
      const p = sim.people.get(id);
      if (p && (p.fame >= 2 || p.title)) notable.push(p);
    }
    notable.sort((a, b) => b.fame - a.fame);
    if (notable.length) h += `<h4>Notable residents</h4><ul class="plain">${notable.slice(0, 6).map((p) => `<li>${lnk('person', p.id, fullName(sim, p))} <span class="muted">${p.title ? TITLE_NAMES[p.title] : JOB_NAMES[p.job]}</span></li>`).join('')}</ul>`;
    const any = sim.people.get(s.people[(sim.tick >> 5) % Math.max(1, s.people.length)]);
    if (any) h += `<div class="muted" style="margin-top:6px">A resident: ${lnk('person', any.id, fullName(sim, any))}, ${JOB_NAMES[any.job].toLowerCase()}</div>`;
    h += `<h4>Intervene</h4><div class="acts"><button class="divine" id="act-bless" data-act="bless">Bless</button><button class="dark" id="act-curse" data-act="curse">Curse</button><button class="dark" id="act-plague" data-act="plague">Plague</button><button class="dark" id="act-revolt" data-act="revolt">Incite revolt</button><button id="act-feed" data-act="feed">Fill granary</button></div>`;
    const ev = sim.history.filter((e) => e.settlement === s.id).slice(-8).reverse();
    if (ev.length) h += `<h4>What happened here</h4>${this.eventList(ev)}`;
    return [s.name, h];
  }

  private eventList(ev: HistEvent[]): string {
    return `<ul class="plain">${ev.map((e) => `<li data-ev="${e.id}" style="cursor:pointer"><span class="yr">${yr(e.t)}</span>${esc(e.text)}</li>`).join('')}</ul>`;
  }

  private civHtml(c: Civ): [string, string] {
    const sim = this.g.sim;
    const ruler = sim.people.get(c.ruler);
    const cap = sim.settlements.get(c.capital);
    const cul = sim.cultures.get(c.culture);
    const rel = sim.religions.get(c.religion);
    const lang = cul ? sim.languages.get(cul.lang) : undefined;
    const fam = sim.families.get(c.dynasty);
    let h = `<div class="sub"><span class="swatch" style="background:${civCss(c.color)}"></span>${GOV_NAMES[c.gov]} · ${ERA_NAMES[c.era]}${c.alive ? '' : ' · <b>fallen in year ' + yr(c.ended) + '</b>'}</div>`;
    const tags: string[] = [];
    if (c.golden > 0) tags.push('<span class="tag good">golden age</span>');
    if (c.rebelOf >= 0) tags.push('<span class="tag bad">in rebellion</span>');
    if (c.isolated) tags.push('<span class="tag magic">sealed off by you</span>');
    if (c.treasury < 0) tags.push('<span class="tag warn">in debt</span>');
    if (tags.length) h += `<div class="tags">${tags.join('')}</div>`;
    const parent = sim.civs.get(c.parent);
    h += kv([
      ['Ruler', ruler ? `${rulerTitle(c.gov, ruler.sex, c.settlements.length)} ${lnk('person', ruler.id, fullName(sim, ruler))}` : '—'],
      ...(c.gov === 2 && fam ? ([['Dynasty', `House ${esc(fam.name)} (${fam.thrones} crowned)`]] as [string, string][]) : []),
      ['Capital', cap ? lnk('settlement', cap.id, cap.name) : '—'],
      ['Founded', `year ${yr(c.founded)}${parent ? ', out of the ' + lnk('civ', parent.id, parent.name) : ''}`],
      ['People', `${num(c.pop)} in ${c.settlements.length} settlements`],
      ['Soldiers', `${c.soldiers} · ${c.armies.length} in the field`],
      ['Treasury', `${num(c.treasury)} <span class="muted">(${c.incomeLast >= c.expenseLast ? '+' : ''}${num(c.incomeLast - c.expenseLast)}/season)</span>`],
      ['Tax', `${Math.round(c.laws.tax * 100)}%`],
      ['People’s tongue', lang ? esc(lang.name) : '—'],
      ['Faith', rel ? `${esc(rel.name)} <span class="muted">— ${esc(rel.deity)}</span>` : 'none yet'],
    ]);
    h += `<h4>State</h4>${bar('Stability', c.stability, moodCls(c.stability))}${bar('Legitimacy', c.legitimacy, moodCls(c.legitimacy))}${bar('War weariness', c.exhaustion, 'bad')}`;
    // factions
    const FC = ['#c9b48a', '#ef6b5e', '#f2b33d', '#d6b6ff', '#8fc05a'];
    h += `<h4>Who holds power</h4><div class="seg">${c.factions.map((f, k) => `<i style="width:${f * 100}%;background:${FC[k]}" title="${FACTION_NAMES[k]}"></i>`).join('')}</div><div class="legend">${c.factions.map((f, k) => `<span><i style="background:${FC[k]}"></i>${k === c.rulingFaction ? '<b>' : ''}${FACTION_NAMES[k]} ${Math.round(f * 100)}%${k === c.rulingFaction ? '</b>' : ''}</span>`).join('')}</div>`;
    h += `<h4>Character of the state</h4>${bar('Expansion', c.pExpand, 'warn')}${bar('Militarism', c.pMilitary, 'bad')}${bar('Commerce', c.pTrade, 'gold')}${bar('Learning', c.pScience)}${bar('Piety', c.pPiety, 'magic')}`;
    const L = c.laws;
    const laws = [
      L.serfdom ? 'serfdom' : 'free farmers', ['volunteer army', 'levy in wartime', 'universal conscription'][L.conscription], ['closed borders', 'tariffs', 'free trade'][L.trade],
      L.dole ? 'grain dole' : '', L.tolerance ? 'freedom of worship' : 'one faith only', L.schooling ? 'public schools' : '', c.gov === 2 ? (L.elective ? 'elective crown' : 'hereditary crown') : '',
    ].filter(Boolean);
    h += `<h4>Laws</h4><div>${laws.join(' · ')}</div>`;
    if (cul) {
      h += `<h4>Culture: ${esc(cul.name)}</h4>${bar('Martial', cul.martial, 'bad')}${bar('Mercantile', cul.mercantile, 'gold')}${bar('Pious', cul.pious, 'magic')}${bar('Communal', cul.communal, 'good')}${bar('Inventive', cul.innovative)}${bar('Insular', cul.insular, 'warn')}${bar('Seafaring', cul.seafaring)}`;
      if (cul.traditions.length) h += `<div class="muted">Traditions: ${cul.traditions.map(esc).join(', ')}</div>`;
      h += `<div class="muted">They build in ${STYLES[cul.style % STYLES.length].name}.</div>`;
    }
    // knowledge
    const rs = c.researching;
    h += `<h4>Knowledge</h4><div>${knownCount(c)} of ${NT} arts known${rs >= 0 ? ` · studying <b>${TECHS[rs].name}</b>` : ''}</div>`;
    if (rs >= 0) h += bar('Progress', c.research[rs] / effectiveCost(sim, c, rs), 'gold');
    h += `<div class="acts"><button id="act-tech" data-act="tech">Open technology tree</button></div>`;
    // relations
    let rows = '';
    const rels = Array.from(c.rel.entries()).filter(([oid, r]) => r.contact && sim.civs.get(oid)?.alive);
    rels.sort((a, b) => a[1].score - b[1].score);
    for (const [oid, r] of rels) {
      const o = sim.civs.get(oid)!;
      const st = r.war >= 0 ? '<span class="up">at war</span>' : r.alliance ? '<span class="down">allied</span>' : r.tribute > 0 ? 'pays us tribute' : r.tribute < 0 ? 'we pay tribute' : r.tradePact ? 'trade pact' : sim.tick < r.truceUntil ? 'truce' : '';
      rows += `<tr><td><span class="swatch" style="background:${civCss(o.color)}"></span>${lnk('civ', o.id, o.name)}</td><td class="n ${r.score < -20 ? 'up' : r.score > 20 ? 'down' : ''}">${Math.round(r.score)}</td><td class="n">${st}</td></tr>`;
    }
    if (rows) h += `<h4>Neighbours</h4><table><tr><th>Nation</th><th class="n">Regard</th><th class="n">Status</th></tr>${rows}</table>`;
    else h += `<h4>Neighbours</h4><div class="muted">They know of no other people.</div>`;
    if (c.grievances.length) {
      const gs = c.grievances.slice().sort((a, b) => b.mag - a.mag).slice(0, 5);
      h += `<h4>Old wrongs they remember</h4><ul class="plain">${gs.map((g) => { const o = sim.civs.get(g.civ); return `<li><span class="yr">${yr(g.tick)}</span>${esc(g.text)}${o ? ' <span class="muted">(' + esc(o.name) + ')</span>' : ''}</li>`; }).join('')}</ul>`;
    }
    if (c.memory.length) h += `<h4>What the people tell of</h4><ul class="plain">${c.memory.slice(-6).reverse().map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`;
    // towns
    const towns = c.settlements.map((id) => sim.settlements.get(id)!).filter(Boolean).sort((a, b) => b.people.length - a.people.length);
    h += `<h4>Settlements</h4><div>${towns.slice(0, 14).map((t) => `${lnk('settlement', t.id, t.name)} <span class="muted">${t.people.length}</span>`).join(' · ')}${towns.length > 14 ? ` <span class="muted">and ${towns.length - 14} more</span>` : ''}</div>`;
    if (c.alive) {
      // experiments
      const others = Array.from(sim.civs.values()).filter((o) => o.alive && o.id !== c.id);
      h += `<h4>Experiment on this society</h4>`;
      if (cul) {
        for (const [key, label] of [['martial', 'Martial'], ['mercantile', 'Mercantile'], ['pious', 'Pious'], ['communal', 'Communal'], ['innovative', 'Inventive'], ['insular', 'Insular']] as [string, string][]) {
          const v = (cul as unknown as Record<string, number>)[key];
          h += `<div class="slider"><label for="cv-${key}">${label}</label><input id="cv-${key}" type="range" min="0" max="100" value="${Math.round(v * 100)}" data-inp="cul:${key}"><span>${Math.round(v * 100)}</span></div>`;
        }
      }
      h += `<div class="acts"><button id="act-isolate" data-act="isolate">${c.isolated ? 'Lift isolation' : 'Seal off from the world'}</button><button class="divine" id="act-gold" data-act="gold">Gift 500 gold</button></div>`;
      h += `<div class="acts"><select id="gov-select" data-inp="gov" aria-label="Form of government">${GOV_NAMES.map((n, k) => `<option value="${k}" ${k === c.gov ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
      if (others.length) {
        h += `<div class="acts"><select id="other-civ" aria-label="Other nation">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button class="dark" id="act-war" data-act="war">Incite war</button><button class="divine" id="act-peace" data-act="peace">Impose peace</button></div>`;
      }
    }
    const ev = sim.history.filter((e) => e.civs.indexOf(c.id) >= 0 && e.imp >= 2).slice(-10).reverse();
    if (ev.length) h += `<h4>Recent history</h4>${this.eventList(ev)}<div class="acts"><button id="act-chron" data-act="chron">All of its history</button></div>`;
    return [civFullName(c), h];
  }

  private nameOf(id: number): string {
    const sim = this.g.sim;
    const p = sim.people.get(id);
    if (p) return lnk('person', id, fullName(sim, p));
    const g = sim.graves.get(id);
    if (g) return lnk('grave', id, fullName(sim, g)) + ' †';
    return '<span class="muted">someone now forgotten</span>';
  }

  private memText(code: number, ref: number): string {
    const sim = this.g.sim;
    const place = (id: number) => {
      const s = sim.settlements.get(id);
      return s ? lnk('settlement', id, s.name) : 'a place now gone';
    };
    const civ = (id: number) => {
      const c = sim.civs.get(id);
      return c ? lnk('civ', id, c.name) : 'a vanished people';
    };
    switch (code) {
      case M.born: return sim.settlements.has(ref) ? `Born in ${place(ref)}` : 'Born';
      case M.married: return `Married ${this.nameOf(ref)}`;
      case M.child: return `A child was born: ${this.nameOf(ref)}`;
      case M.job: return `Took up work as ${/^[aeiou]/i.test(JOB_NAMES[ref]) ? 'an' : 'a'} ${JOB_NAMES[ref].toLowerCase()}`;
      case M.migrated: return `Moved to ${place(ref)}`;
      case M.fled: return `Fled to ${place(ref)} as a refugee`;
      case M.battle: return `Fought the ${civ(ref)} in battle`;
      case M.widowed: return `Lost a spouse, ${this.nameOf(ref)}`;
      case M.lostChild: return `Buried a child, ${this.nameOf(ref)}`;
      case M.lostParent: return `Lost a parent, ${this.nameOf(ref)}`;
      case M.founded: return `Founded ${place(ref)}`;
      case M.settled: return `Helped settle ${place(ref)}`;
      case M.ruler: return `Came to rule the ${civ(ref)}`;
      case M.deposed: return `Lost the rule of the ${civ(ref)}`;
      case M.invented: return `Mastered ${TECHS[ref] ? TECHS[ref].name : 'a new art'}`;
      case M.rebelled: return `Rose against the ${civ(ref)}`;
      case M.enriched: return 'Made a fortune in trade';
      case M.ruined: return 'Lost a caravan to the enemy';
      case M.converted: { const r = sim.religions.get(ref); return `Converted to ${r ? esc(r.name) : 'a new faith'}`; }
      case M.general: return 'Given command of an army';
      case M.conquered: return sim.settlements.has(ref) ? `Took ${place(ref)}` : `Came under the rule of the ${civ(ref)}`;
      case M.plague: return 'Fell ill with the plague';
      case M.blessed: return 'Was touched by the divine';
      case M.cursed: return 'Was cursed';
      case M.governor: return `Appointed governor of ${place(ref)}`;
      case M.prophet: { const r = sim.religions.get(ref); return `Founded the faith ${r ? esc(r.name) : ''}`; }
      case M.friend: return `Befriended ${this.nameOf(ref)}`;
      case M.rival: return `Made an enemy of ${this.nameOf(ref)}`;
      case M.conscripted: return 'Was conscripted to fight';
    }
    return '';
  }

  private bio(mem: number[]): string {
    let out = '';
    for (let k = mem.length - 3; k >= 0; k -= 3) {
      const t = this.memText(mem[k + 1], mem[k + 2]);
      if (t) out += `<li><span class="yr">${yr(mem[k])}</span>${t}</li>`;
    }
    return `<ul class="plain">${out}</ul>`;
  }

  private personHtml(p: Person): [string, string] {
    const sim = this.g.sim;
    const age = Math.floor(ageOf(sim, p));
    const civ = sim.civs.get(p.civ);
    const home = sim.settlements.get(p.home);
    const cul = sim.cultures.get(p.culture);
    const rel = sim.religions.get(p.religion);
    const fam = sim.families.get(p.fam);
    const army = sim.armies.get(p.army);
    const party = sim.parties.get(p.party);
    let role = p.title ? TITLE_NAMES[p.title] : JOB_NAMES[p.job];
    if (p.title === TITLE.ruler && civ) role = rulerTitle(civ.gov, p.sex, civ.settlements.length);
    let where = home ? `of ${lnk('settlement', home.id, home.name)}` : 'on the road';
    if (army) where = `marching with the ${lnk('army', army.id, army.name)}`;
    else if (party) where = party.kind === PARTY.caravan ? `away with a ${lnk('party', party.id, 'caravan')}` : `travelling with ${lnk('party', party.id, 'a band of ' + ['migrants', 'settlers', 'traders', 'refugees'][party.kind])}`;
    let h = `<div class="sub">${role}, ${age}, ${where}${civ ? ' · ' + lnk('civ', civ.id, civ.name) : ''}</div>`;
    const tags: string[] = [];
    if (p.fame >= 4) tags.push('<span class="tag good">renowned</span>');
    if (p.sick > 0) tags.push('<span class="tag magic">plague-sick</span>');
    if (p.fed < 0.5) tags.push('<span class="tag warn">starving</span>');
    if (p.loyalty < 0.3) tags.push('<span class="tag bad">disloyal</span>');
    if (tags.length) h += `<div class="tags">${tags.join('')}</div>`;
    h += kv([
      ['Family', fam ? `${esc(fam.name)} <span class="muted">(${fam.living} living)</span>` : '—'],
      ['People', cul ? esc(cul.name) : '—'],
      ['Faith', rel ? esc(rel.name) : 'none'],
      ['Wants', GOAL_NAMES[p.goal]],
      ['Wealth', num(p.wealth)],
      ['Sides with', FACTION_NAMES[p.faction]],
    ]);
    h += `<h4>Condition</h4>${bar('Fed', p.fed, moodCls(p.fed))}${bar('Health', p.health, moodCls(p.health))}${bar('Content', p.happy, moodCls(p.happy))}${bar('Loyal', p.loyalty, moodCls(p.loyalty))}`;
    h += `<h4>Temperament</h4>${bar('Ambition', p.amb, 'gold')}${bar('Charisma', p.cha, 'gold')}${bar('Boldness', p.bold, 'bad')}${bar('Intellect', p.intl)}${bar('Compassion', p.comp, 'good')}${bar('Diligence', p.dil, 'good')}${bar('Piety', p.piety, 'magic')}${bar('Greed', p.greed, 'warn')}`;
    if (p.job !== J.child) h += `<h4>Skills</h4>${bar('Land & toil', p.sFarm, 'good')}${bar('Craft', p.sCraft, 'warn')}${bar('Arms', p.sFight, 'bad')}${bar('Trade', p.sTrade, 'gold')}${bar('Learning', p.sLore)}${bar('Command', p.sLead, 'magic')}`;
    // kin
    const kin: string[] = [];
    if (p.spouse >= 0) kin.push(`Spouse: ${this.nameOf(p.spouse)}`);
    if (p.mother >= 0 || p.father >= 0) kin.push(`Parents: ${p.mother >= 0 ? this.nameOf(p.mother) : '?'} and ${p.father >= 0 ? this.nameOf(p.father) : '?'}`);
    if (p.kids.length) kin.push(`Children: ${p.kids.slice(0, 8).map((k) => this.nameOf(k)).join(', ')}`);
    const fr = p.friends.filter((id) => sim.people.has(id));
    const rv = p.rivals.filter((id) => sim.people.has(id));
    if (fr.length) kin.push(`Friends: ${fr.map((k) => this.nameOf(k)).join(', ')}`);
    if (rv.length) kin.push(`Rivals: ${rv.map((k) => this.nameOf(k)).join(', ')}`);
    if (kin.length) h += `<h4>Kin and company</h4><ul class="plain">${kin.map((k) => `<li>${k}</li>`).join('')}</ul>`;
    h += `<h4>Life so far</h4>${this.bio(p.mem)}`;
    h += `<h4>Intervene</h4><div class="acts"><button class="divine" id="act-genius" data-act="gift" data-arg="genius">Gift genius</button><button class="divine" id="act-charisma" data-act="gift" data-arg="charisma">Gift charisma</button><button class="divine" id="act-valor" data-act="gift" data-arg="valor">Gift valour</button><button class="divine" id="act-vigor" data-act="gift" data-arg="vigor">Restore youth</button>${p.job !== J.child && p.title !== TITLE.ruler ? '<button class="divine" id="act-crown" data-act="crown">Make ruler</button>' : ''}<button class="dark" id="act-cursep" data-act="cursep">Curse</button><button class="dark" id="act-smite" data-act="smite">Smite</button><button id="act-follow" data-act="follow">${this.g.follow ? 'Stop following' : 'Follow'}</button></div>`;
    return [fullName(sim, p), h];
  }

  private graveHtml(g: Grave): [string, string] {
    const sim = this.g.sim;
    const civ = sim.civs.get(g.civ);
    let h = `<div class="sub">${g.title ? TITLE_NAMES[g.title] : JOB_NAMES[g.job]} of ${esc(g.home)}${civ ? ' · ' + lnk('civ', civ.id, civ.name) : ''}</div>`;
    h += kv([
      ['Lived', `year ${yr(g.born)} – ${yr(g.died)} <span class="muted">(${Math.floor((g.died - g.born) / TICKS_PER_YEAR)} years)</span>`],
      ['Died of', esc(g.cause)],
    ]);
    const kin: string[] = [];
    if (g.mother >= 0 || g.father >= 0) kin.push(`Parents: ${g.mother >= 0 ? this.nameOf(g.mother) : '?'} and ${g.father >= 0 ? this.nameOf(g.father) : '?'}`);
    if (g.kids.length) kin.push(`Children: ${g.kids.slice(0, 10).map((k) => this.nameOf(k)).join(', ')}`);
    if (kin.length) h += `<h4>Kin</h4><ul class="plain">${kin.map((k) => `<li>${k}</li>`).join('')}</ul>`;
    h += `<h4>The life they led</h4>${this.bio(g.mem)}`;
    return [fullName(sim, g) + ' †', h];
  }

  private armyHtml(id: number): [string, string] {
    const sim = this.g.sim;
    const a = sim.armies.get(id);
    if (!a) return ['Disbanded', '<p class="muted">This army has gone home, or is no more.</p>'];
    const civ = sim.civs.get(a.civ)!;
    const gen = sim.people.get(a.general);
    const war = sim.wars.get(a.war);
    const tgt = sim.settlements.get(a.target);
    const goal = a.foe >= 0 ? 'in battle' : a.goal === 1 ? (tgt ? `${tgt.siege === a.id ? 'besieging' : 'marching on'} ${lnk('settlement', tgt.id, tgt.name)}` : 'seeking a target') : a.goal === 2 ? (tgt ? `defending ${lnk('settlement', tgt.id, tgt.name)}` : 'on guard') : a.goal === 3 ? 'intercepting the enemy' : a.goal === 4 ? 'falling back to refit' : 'awaiting orders';
    let h = `<div class="sub">Army of the ${lnk('civ', civ.id, civ.name)}${a.atSea ? ' · at sea' : ''}</div>`;
    h += kv([
      ['General', gen ? lnk('person', gen.id, fullName(sim, gen)) : 'none'],
      ['Strength', `${a.soldiers.length} <span class="muted">of ${a.n0} mustered</span>`],
      ['Orders', goal],
      ['War', war ? esc(war.name) : '—'],
      ['Kills / losses', `${a.kills} / ${a.losses}`],
    ]);
    h += `<h4>Condition</h4>${bar('Morale', a.morale, moodCls(a.morale))}${bar('Supply', a.supply / 4, a.supply > 1 ? 'good' : 'bad')}${bar('Equipment', (a.equip - 0.7) / 1.3, 'gold')}`;
    const some = a.soldiers.slice(0, 8).map((sid) => this.nameOf(sid)).join(', ');
    h += `<h4>In the ranks</h4><div>${some}${a.soldiers.length > 8 ? ' …' : ''}</div>`;
    h += `<div class="acts"><button id="act-follow" data-act="follow">${this.g.follow ? 'Stop following' : 'Follow'}</button></div>`;
    return [a.name, h];
  }

  private partyHtml(id: number): [string, string] {
    const sim = this.g.sim;
    const p = sim.parties.get(id);
    if (!p) return ['Arrived', '<p class="muted">These travellers have reached the end of their road.</p>'];
    const from = sim.settlements.get(p.from),
      to = sim.settlements.get(p.to);
    const civ = sim.civs.get(p.civ);
    const kind = ['Migrants', 'Settlers', p.sea ? 'Trading ship' : 'Caravan', 'Refugees'][p.kind];
    let h = `<div class="sub">${civ ? lnk('civ', civ.id, civ.name) : 'A free band'}</div>`;
    const rows: [string, string][] = [['From', from ? lnk('settlement', from.id, from.name) : '—']];
    if (p.kind === PARTY.caravan) {
      const owner = sim.people.get(p.owner);
      rows.push(['Bound for', p.returning ? (from ? lnk('settlement', from.id, from.name) + ' (home)' : '—') : to ? lnk('settlement', to.id, to.name) : '—']);
      rows.push(['Cargo', p.good >= 0 ? `${num(p.qty)} ${GOOD_NAMES[p.good].toLowerCase()}` : 'empty']);
      rows.push(['Merchant', owner ? lnk('person', owner.id, fullName(sim, owner)) : 'dead']);
    } else {
      rows.push(['Bound for', to ? lnk('settlement', to.id, to.name) : 'unclaimed land']);
      rows.push(['People', String(p.people.length)]);
      rows.push(['Provisions', p.qty > 0 ? `${num(p.qty)} food` : '<span class="up">none</span>']);
    }
    h += kv(rows);
    if (p.people.length) h += `<h4>Among them</h4><div>${p.people.slice(0, 8).map((q) => this.nameOf(q)).join(', ')}</div>`;
    h += `<div class="acts"><button id="act-follow" data-act="follow">${this.g.follow ? 'Stop following' : 'Follow'}</button></div>`;
    return [kind, h];
  }

  private herdHtml(id: number): [string, string] {
    const sim = this.g.sim;
    const hd = sim.herds.get(id);
    if (!hd) return ['Gone', '<p class="muted">This herd is no more.</p>'];
    const sp = sim.species.get(hd.sp)!;
    let h = `<div class="sub">${hd.n} ${sp.diet === 1 ? 'hunters' : 'animals'} · ${lnk('species', sp.id, sp.name)}</div>`;
    h += `${bar('Well-fed', hd.energy, moodCls(hd.energy))}<h4>This herd’s traits</h4>${bar('Size', hd.size)}${bar('Speed', hd.speed)}${bar('Fertility', hd.fecund / 1.2, 'good')}${bar('Ferocity', hd.fierce, 'bad')}`;
    h += kv([['Likes it around', `${hd.cold.toFixed(0)}°`]]);
    h += `<div class="acts"><button id="act-follow" data-act="follow">${this.g.follow ? 'Stop following' : 'Follow'}</button></div>`;
    return [sp.name, h];
  }

  private speciesHtml(sp: Species): [string, string] {
    const sim = this.g.sim;
    const parent = sim.species.get(sp.parent);
    let herds = 0;
    for (const h of sim.herds.values()) if (h.sp === sp.id) herds++;
    let h = `<div class="sub">${['Grazer', 'Predator', 'Omnivore'][sp.diet]}${sp.extinct >= 0 ? ' · <b>extinct since year ' + yr(sp.extinct) + '</b>' : ''}${sp.made ? ' · made by you' : ''}</div>`;
    h += kv([
      ['Alive', `${num(sp.count)} in ${herds} herds`],
      ['Appeared', `year ${yr(sp.born)}${parent ? ', from the ' + lnk('species', parent.id, parent.name) : ''}`],
      ['Climate', `around ${sp.cold.toFixed(0)}°`],
      ['Can be herded', sp.domestic ? 'yes' : 'no'],
      ['Can be ridden', sp.ridable ? 'yes' : 'no'],
    ]);
    h += `<h4>Type traits</h4>${bar('Size', sp.size)}${bar('Speed', sp.speed)}${bar('Fertility', sp.fecund / 1.2, 'good')}${bar('Ferocity', sp.fierce, 'bad')}`;
    const kids = Array.from(sim.species.values()).filter((s) => s.parent === sp.id);
    if (kids.length) h += `<h4>Descendants</h4><div>${kids.map((k) => lnk('species', k.id, k.name)).join(', ')}</div>`;
    h += `<div class="acts"><button id="act-spawn" data-act="spawn" data-arg="${sp.id}">Release these with the Animals tool</button></div>`;
    return [sp.name, h];
  }

  // ------------------------------------------------------------ actions

  private action(act: string, arg: string, el: HTMLElement): void {
    const g = this.g;
    const sim = g.sim;
    const sel = this.sel;
    const s = sel && sel.kind === 'settlement' ? sim.settlements.get(sel.id) : undefined;
    const p = sel && (sel.kind === 'person' || sel.kind === 'grave') ? sim.people.get(sel.id) : undefined;
    const c = sel && sel.kind === 'civ' ? sim.civs.get(sel.id) : undefined;
    switch (act) {
      case 'bless': if (s) powers.blessSettlement(sim, s); break;
      case 'curse': if (s) powers.curseSettlement(sim, s); break;
      case 'plague': if (s) powers.plague(sim, s); break;
      case 'revolt': if (s) powers.inciteRevolt(sim, s); break;
      case 'feed': if (s) { s.stock[G.food] += s.people.length * 12; this.toast(`The granaries of ${s.name} are full.`); } break;
      case 'gift': if (p) powers.blessPerson(sim, p, arg as 'genius'); break;
      case 'cursep': if (p) { powers.cursePerson(sim, p); this.toast(`${p.name} sickens.`); } break;
      case 'smite': if (p) powers.smitePerson(sim, p); break;
      case 'crown': if (p && !powers.crown(sim, p)) this.toast('That cannot be done.'); break;
      case 'follow': g.follow = !g.follow; break;
      case 'tech': if (c) { this.techCiv = c.id; this.toggleWindow('tech', true); } break;
      case 'chron': if (c) { this.chronFilter = { imp: 1, group: 'all', q: c.name, year: -1 }; this.toggleWindow('chronicle', true); } break;
      case 'chron-year': this.chronFilter.year = -1; this.renderWindow(); break;
      case 'isolate': if (c) c.isolated = !c.isolated; break;
      case 'gold': if (c) { powers.giftGold(sim, c, 500); this.toast(`Gold appears in the vaults of the ${c.name}.`); } break;
      case 'war':
      case 'peace': {
        const selEl = document.getElementById('other-civ') as HTMLSelectElement | null;
        const o = selEl ? sim.civs.get(Number(selEl.value)) : undefined;
        if (c && o) {
          const ok = act === 'war' ? powers.inciteWar(sim, c, o) : powers.forcePeace(sim, c, o);
          if (!ok) this.toast(act === 'war' ? 'They are already at war.' : 'They are not at war.');
        }
        break;
      }
      case 'spawn': g.spawnSpecies = Number(arg); g.setTool('herd'); this.syncTools(); this.toast('Click the map to release a herd.'); break;
      case 'grant': { const cv = sim.civs.get(this.techCiv); if (cv) powers.grantTech(sim, cv, Number(arg)); this.renderWindow(); break; }
      case 'revoke': { const cv = sim.civs.get(this.techCiv); if (cv) powers.revokeTech(sim, cv, Number(arg)); this.renderWindow(); break; }
      case 'chron-imp': this.chronFilter.imp = Number(arg); this.renderWindow(); break;
      case 'chron-group': this.chronFilter.group = arg; this.renderWindow(); break;
      case 'world-tab': this.worldTab = arg; this.renderWindow(); break;
      case 'new-world': this.newWorldFromForm(); break;
      case 'save': g.saveSlot(arg).then((m) => { this.toast(m); this.renderWindow(); }); break;
      case 'load': g.loadSlot(arg).then((m) => this.toast(m)); break;
      case 'export': g.exportFile(); break;
      case 'import': g.importFile(); break;
      case 'autosave': g.autosave = !g.autosave; this.renderWindow(); break;
      case 'make-species': this.makeSpecies(); break;
      case 'labels': g.renderer.showLabels = !g.renderer.showLabels; this.renderWindow(); break;
      case 'borders': g.renderer.showBorders = !g.renderer.showBorders; this.renderWindow(); break;
    }
    void el;
    if (this.sel) this.renderInspector();
  }

  private input(key: string, el: HTMLInputElement): void {
    const sim = this.g.sim;
    const v = Number(el.value);
    const lab = el.parentElement?.querySelector('span:last-child');
    if (key.startsWith('cul:')) {
      const c = this.sel && this.sel.kind === 'civ' ? sim.civs.get(this.sel.id) : undefined;
      const cul = c ? sim.cultures.get(c.culture) : undefined;
      if (cul) (cul as unknown as Record<string, number>)[key.slice(4)] = v / 100;
      if (lab) lab.textContent = String(v);
    } else if (key === 'gov') {
      const c = this.sel && this.sel.kind === 'civ' ? sim.civs.get(this.sel.id) : undefined;
      if (c) powers.setGovernment(sim, c, v);
    } else if (key.startsWith('param:')) {
      const k = key.slice(6);
      (sim.params as unknown as Record<string, number>)[k] = k === 'popCap' ? v : v / 100;
      if (lab) lab.textContent = k === 'popCap' ? num(v) : (v / 100).toFixed(2) + '×';
    } else if (key === 'godTemp') {
      sim.climate.godTemp = v / 10;
      if (lab) lab.textContent = `${v >= 0 ? '+' : ''}${(v / 10).toFixed(1)}°`;
    } else if (key === 'godRain') {
      sim.climate.godRain = v / 100;
      if (lab) lab.textContent = (v / 100).toFixed(2) + '×';
    } else if (key === 'sea') {
      sim.climate.seaBase = SEA + v / 1000;
      if (lab) lab.textContent = `${v >= 0 ? '+' : ''}${Math.round(v * 9)} m`;
      if (el.matches(':active') === false || true) {
        // apply when the slider settles (change event), not on every pixel of drag
      }
    } else if (key === 'chron-q') {
      this.chronFilter.q = el.value;
      this.renderWindow(true);
    } else if (key === 'tech-civ') {
      this.techCiv = v;
      this.renderWindow();
    }
  }

  /** called on slider release for expensive world-wide changes */
  commitSea(): void {
    updateSeaLevel(this.g.sim, true);
    powers.commitTerrain(this.g.sim);
  }

  // ------------------------------------------------------------ windows

  toggleWindow(name: string | null, force = false): void {
    this.win = !force && this.win === name ? null : name;
    this.$.window.hidden = !this.win;
    for (const b of Array.from(this.$.menus.querySelectorAll('button'))) (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.win === this.win);
    if (this.win) {
      this.$['win-body'].scrollTop = 0;
      this.renderWindow();
    }
  }

  renderWindow(keepFocus = false): void {
    if (!this.win) return;
    const titles: Record<string, string> = { chronicle: 'Chronicle of the world', nations: 'Nations', life: 'Living things', stats: 'The long view', tech: 'Technology', world: 'World', help: 'How to play god' };
    this.$['win-title'].textContent = titles[this.win] || '';
    const el = this.$['win-body'];
    const scroll = el.scrollTop;
    let html = '';
    switch (this.win) {
      case 'chronicle': html = this.chronicleHtml(); break;
      case 'nations': html = this.nationsHtml(); break;
      case 'life': html = this.lifeHtml(); break;
      case 'stats': html = this.statsHtml(); break;
      case 'tech': html = this.techHtml(); break;
      case 'world': html = this.worldHtml(); break;
      case 'help': html = this.helpHtml(); break;
    }
    if (keepFocus) {
      // only replace the list part so the search box keeps focus
      const list = el.querySelector('#chron-list');
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const nl = tmp.querySelector('#chron-list');
      if (list && nl) {
        list.innerHTML = nl.innerHTML;
        return;
      }
    }
    if (this.win === 'chronicle' && el.querySelector('#chron-time') && !keepFocus) {
      // keep the timeline canvas and the search box alive; swap only the list and the filter buttons
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const oldF = el.querySelector('.filters'), newF = tmp.querySelector('.filters');
      const oldL = el.querySelector('#chron-list'), newL = tmp.querySelector('#chron-list');
      if (oldF && newF && oldL && newL && document.activeElement !== el.querySelector('#chron-q')) {
        oldF.innerHTML = newF.innerHTML;
        oldL.innerHTML = newL.innerHTML;
        this.drawTimeline();
        return;
      }
    }
    el.innerHTML = html;
    el.scrollTop = scroll;
    if (this.win === 'stats') this.drawCharts();
    if (this.win === 'chronicle') this.drawTimeline();
    if (this.win === 'world' && this.worldTab === 'save') this.fillSlots();
    const sea = document.getElementById('p-sea');
    if (sea) sea.addEventListener('change', () => this.commitSea());
  }

  private chronicleHtml(): string {
    const sim = this.g.sim;
    const f = this.chronFilter;
    const groups: Record<string, string[]> = {
      all: [],
      war: ['war', 'battle', 'siege', 'conquest', 'peace', 'blockade', 'rebellion', 'revolution', 'coup', 'uprising', 'riot'],
      state: ['succession', 'government', 'politics', 'law', 'treaty', 'union', 'diplomacy', 'contact', 'found', 'fall', 'decline', 'golden', 'ruin'],
      nature: ['famine', 'plague', 'drought', 'flood', 'fire', 'quake', 'volcano', 'meteor', 'blight', 'climate', 'species', 'extinct', 'depleted'],
      mind: ['tech', 'era', 'lost', 'religion', 'culture', 'tradition', 'miracle', 'curse', 'smite', 'build', 'patron', 'merchant'],
      people: ['migration', 'death', 'succession', 'merchant', 'patron', 'smite', 'miracle'],
    };
    const kinds = groups[f.group] || [];
    const q = f.q.trim().toLowerCase();
    const out: string[] = [];
    let shown = 0;
    for (let k = sim.history.length - 1; k >= 0 && shown < 260; k--) {
      const e = sim.history[k];
      if (e.imp < f.imp) continue;
      if (kinds.length && kinds.indexOf(e.kind) < 0) continue;
      if (q && e.text.toLowerCase().indexOf(q) < 0) continue;
      if (f.year >= 0 && Math.abs(yr(e.t) - f.year) > 6) continue;
      shown++;
      out.push(`<div class="event i${e.imp}" data-ev="${e.id}"><div class="when">Year ${yr(e.t)}</div><div class="what" style="border-left-color:${EVENT_COLORS[e.kind] || '#97a4b3'}">${esc(e.text)}</div></div>`);
    }
    const impBtn = (v: number, label: string) => `<button data-act="chron-imp" data-arg="${v}" id="chron-imp-${v}" class="${f.imp === v ? 'on' : ''}">${label}</button>`;
    const grpBtn = (v: string, label: string) => `<button data-act="chron-group" data-arg="${v}" id="chron-grp-${v}" class="${f.group === v ? 'on' : ''}">${label}</button>`;
    const around = f.year >= 0 ? `<button class="on" id="chron-year" data-act="chron-year">Around year ${f.year} ✕</button>` : '';
    return `<canvas id="chron-time" class="timeline" title="Nations through time. Click a year to read what happened around it."></canvas><div class="filters">${around}${impBtn(1, 'Everything')}${impBtn(2, 'Notable')}${impBtn(3, 'Major')}${impBtn(4, 'Epochal')}<span class="muted">·</span>${grpBtn('all', 'All')}${grpBtn('war', 'War')}${grpBtn('state', 'States')}${grpBtn('nature', 'Nature')}${grpBtn('mind', 'Ideas')}${grpBtn('people', 'People')}<input id="chron-q" type="search" placeholder="Search names, places…" value="${esc(f.q)}" data-inp="chron-q"></div><div id="chron-list">${out.join('') || '<p class="muted">Nothing recorded matches.</p>'}</div><p class="note">${sim.history.length} events on record. Click one to go there.</p>`;
  }

  /** nations as bars through time, wars as red spans, epochal events as ticks; click a year to filter */
  private drawTimeline(): void {
    const cv = document.getElementById('chron-time') as HTMLCanvasElement | null;
    if (!cv) return;
    const sim = this.g.sim;
    const now = yr(sim.tick);
    const civs = Array.from(sim.civs.values()).filter((c) => c.peakPop >= 60 || (c.alive && c.pop >= 30)).sort((a, b) => b.peakPop - a.peakPop).slice(0, 14).sort((a, b) => a.founded - b.founded || a.id - b.id);
    const rowH = 13, top = 12, L = 4, R = 4;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 600;
    const H = top + civs.length * rowH + 14;
    cv.style.height = H + 'px';
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    const X = (y: number) => L + ((y - 1) / Math.max(1, now - 1)) * (W - L - R);
    g.font = '10px "IBM Plex Sans", sans-serif';
    g.textBaseline = 'middle';
    const row = new Map<number, number>();
    civs.forEach((c, k) => {
      row.set(c.id, k);
      const x0 = X(yr(c.founded)), x1 = X(c.alive ? now : yr(c.ended));
      const y = top + k * rowH;
      g.fillStyle = civCss(c.color, c.alive ? 0.85 : 0.45);
      g.fillRect(x0, y + 1, Math.max(2, x1 - x0), rowH - 3);
      if (x1 - x0 > g.measureText(c.name).width + 8) {
        g.fillStyle = '#0f141b';
        g.fillText(c.name, x0 + 4, y + rowH / 2);
      }
    });
    // wars: a red span on both belligerents' rows
    g.fillStyle = 'rgba(239,107,94,0.95)';
    for (const w of sim.wars.values()) {
      const x0 = X(yr(w.start)), x1 = X(w.end >= 0 ? yr(w.end) : now);
      for (const id of [w.att, w.def]) {
        const k = row.get(id);
        if (k !== undefined) g.fillRect(x0, top + k * rowH + rowH - 4, Math.max(2, x1 - x0), 2);
      }
    }
    // epochal events along the top
    for (const e of sim.history) {
      if (e.imp < 4) continue;
      g.fillStyle = EVENT_COLORS[e.kind] || '#97a4b3';
      g.fillRect(X(yr(e.t)) - 1, 2, 2, 8);
    }
    // axis
    g.fillStyle = '#97a4b3';
    g.textBaseline = 'alphabetic';
    const step = now > 1200 ? 200 : now > 500 ? 100 : now > 200 ? 50 : now > 80 ? 20 : 10;
    for (let y = step; y < now; y += step) {
      g.fillRect(X(y), top, 1, civs.length * rowH);
      g.textAlign = 'center';
      g.fillText(String(y), X(y), H - 3);
    }
    if (this.chronFilter.year >= 0) {
      g.fillStyle = 'rgba(242,179,61,0.25)';
      g.fillRect(X(this.chronFilter.year - 6), 0, Math.max(3, X(this.chronFilter.year + 6) - X(this.chronFilter.year - 6)), H - 12);
    }
    cv.onclick = (ev) => {
      const b = cv.getBoundingClientRect();
      const year = Math.round(1 + ((ev.clientX - b.left - L) / (b.width - L - R)) * (now - 1));
      this.chronFilter.year = Math.max(1, Math.min(now, year));
      this.renderWindow();
    };
  }

  private nationsHtml(): string {
    const sim = this.g.sim;
    const live = Array.from(sim.civs.values()).filter((c) => c.alive).sort((a, b) => b.pop - a.pop);
    const dead = Array.from(sim.civs.values()).filter((c) => !c.alive && c.peakPop > 60).sort((a, b) => b.ended - a.ended);
    let h = `<table><tr><th>Nation</th><th>Rule</th><th>Age</th><th class="n">People</th><th class="n">Towns</th><th class="n">Arms</th><th class="n">Treasury</th><th class="n">Stability</th></tr>`;
    for (const c of live) {
      h += `<tr><td><span class="swatch" style="background:${civCss(c.color)}"></span>${lnk('civ', c.id, c.name)}</td><td>${GOV_NAMES[c.gov]}</td><td>${ERA_NAMES[c.era]}</td><td class="n">${num(c.pop)}</td><td class="n">${c.settlements.length}</td><td class="n">${c.soldiers}</td><td class="n">${num(c.treasury)}</td><td class="n">${Math.round(c.stability * 100)}</td></tr>`;
    }
    h += '</table>';
    const top = live.slice(0, 9);
    if (top.length > 1) {
      h += `<h4>How they regard one another</h4><div style="overflow-x:auto"><table class="matrix"><tr><th></th>${top.map((c) => `<th title="${esc(c.name)}"><span class="swatch" style="background:${civCss(c.color)}"></span></th>`).join('')}</tr>`;
      for (const a of top) {
        h += `<tr><th style="text-align:left"><span class="swatch" style="background:${civCss(a.color)}"></span>${esc(a.name)}</th>`;
        for (const b of top) {
          if (a.id === b.id) { h += '<td class="self"></td>'; continue; }
          const r = a.rel.get(b.id);
          if (!r || !r.contact) { h += '<td class="muted">·</td>'; continue; }
          const sc = Math.round(r.score);
          const bg = r.war >= 0 ? 'rgba(239,107,94,0.55)' : sc > 0 ? `rgba(127,211,107,${Math.min(0.5, sc / 150)})` : `rgba(239,107,94,${Math.min(0.4, -sc / 200)})`;
          h += `<td style="background:${bg}" title="${esc(a.name)} → ${esc(b.name)}">${r.war >= 0 ? 'war' : r.alliance ? 'ally' : sc}</td>`;
        }
        h += '</tr>';
      }
      h += '</table></div>';
    }
    const wars = Array.from(sim.wars.values()).filter((w) => w.end < 0);
    if (wars.length) {
      h += `<h4>Wars being fought</h4><ul class="plain">${wars.map((w) => { const a = sim.civs.get(w.att), d = sim.civs.get(w.def); return `<li><b>${esc(w.name)}</b> <span class="muted">since year ${yr(w.start)}</span> — ${a ? lnk('civ', a.id, a.name) : '?'} against ${d ? lnk('civ', d.id, d.name) : '?'} · ${w.attLoss + w.defLoss} dead · ${w.score > 15 ? 'attackers winning' : w.score < -15 ? 'defenders winning' : 'in the balance'}</li>`; }).join('')}</ul>`;
    }
    const rels = Array.from(sim.religions.values()).filter((r) => r.followers > 0).sort((a, b) => b.followers - a.followers).slice(0, 8);
    if (rels.length) h += `<h4>Faiths</h4><ul class="plain">${rels.map((r) => `<li><b>${esc(r.name)}</b> <span class="muted">${num(r.followers)} faithful · reveres ${esc(r.deity)} · began in ${esc(r.origin)}, year ${yr(r.born)}${r.militant > 0.6 ? ' · militant' : r.militant < 0.25 ? ' · peaceable' : ''}</span></li>`).join('')}</ul>`;
    if (dead.length) h += `<h4>Fallen</h4><ul class="plain">${dead.slice(0, 30).map((c) => `<li>${lnk('civ', c.id, civFullName(c))} <span class="muted">year ${yr(c.founded)}–${yr(c.ended)} · ${num(c.peakPop)} at its height</span></li>`).join('')}</ul>`;
    return h;
  }

  private lifeHtml(): string {
    const sim = this.g.sim;
    const sps = Array.from(sim.species.values()).sort((a, b) => (a.extinct >= 0 ? 1 : 0) - (b.extinct >= 0 ? 1 : 0) || b.count - a.count);
    let h = `<table><tr><th>Species</th><th>Diet</th><th class="n">Alive</th><th class="n">Size</th><th class="n">Speed</th><th class="n">Climate</th><th></th></tr>`;
    for (const sp of sps.slice(0, 40)) {
      const col = `rgb(${(sp.color >> 16) & 255},${(sp.color >> 8) & 255},${sp.color & 255})`;
      h += `<tr${sp.extinct >= 0 ? ' class="muted"' : ''}><td><span class="swatch" style="background:${col}"></span>${lnk('species', sp.id, sp.name)}</td><td>${['Grazer', 'Predator', 'Omnivore'][sp.diet]}</td><td class="n">${sp.extinct >= 0 ? 'extinct ' + yr(sp.extinct) : num(sp.count)}</td><td class="n">${Math.round(sp.size * 100)}</td><td class="n">${Math.round(sp.speed * 100)}</td><td class="n">${sp.cold.toFixed(0)}°</td><td class="n"><button data-act="spawn" data-arg="${sp.id}" id="spawn-${sp.id}">Release</button></td></tr>`;
    }
    h += `</table><h4>Create a species</h4><div class="form">
      <label for="ns-name">Name</label><input id="ns-name" type="text" placeholder="e.g. Glass Stag" maxlength="28">
      <label for="ns-diet">Diet</label><select id="ns-diet"><option value="0">Grazer</option><option value="1">Predator</option><option value="2">Omnivore</option></select>
      <label for="ns-size">Size</label><input id="ns-size" type="range" min="5" max="100" value="50">
      <label for="ns-speed">Speed</label><input id="ns-speed" type="range" min="10" max="100" value="60">
      <label for="ns-cold">Home climate</label><input id="ns-cold" type="range" min="-15" max="32" value="12">
      <label for="ns-fec">Fertility</label><input id="ns-fec" type="range" min="10" max="120" value="50">
      <label for="ns-fierce">Ferocity</label><input id="ns-fierce" type="range" min="0" max="100" value="30">
      <label for="ns-color">Colour</label><input id="ns-color" type="color" value="#c0a060">
      <span></span><button class="on" id="ns-make" data-act="make-species">Create and release</button>
    </div><p class="note">Created species obey the same rules as native ones: they must find food, survive the climate, and escape or catch each other. Medium-sized calm grazers can be domesticated by people who discover herding.</p>`;
    return h;
  }

  private makeSpecies(): void {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    const sim = this.g.sim;
    const diet = Number(v('ns-diet'));
    const size = Number(v('ns-size')) / 100;
    const hex = v('ns-color');
    const sp = createSpecies(sim, {
      name: v('ns-name').trim() || undefined, diet, size, speed: Number(v('ns-speed')) / 100, cold: Number(v('ns-cold')), fecund: Number(v('ns-fec')) / 100,
      fierce: Number(v('ns-fierce')) / 100, shape: diet === 1 ? 1 : size > 0.85 ? 3 : size < 0.25 ? 2 : 0, color: parseInt(hex.slice(1), 16), made: true, herd: diet === 1 ? 6 : 22,
    });
    this.g.spawnSpecies = sp.id;
    this.g.setTool('herd');
    this.syncTools();
    this.toggleWindow(null);
    this.toast(`The ${sp.name} exists. Click the map to release herds.`);
  }

  private statsHtml(): string {
    const ids = [['c-pop', 'People in the world'], ['c-civpop', 'People by nation'], ['c-temp', 'Climate (° against the norm)'], ['c-forest', 'Forest cover (%)'], ['c-animals', 'Wild animals'], ['c-wars', 'Wars being fought'], ['c-trade', 'Trade (value moved)'], ['c-tech', 'Arts known by the most advanced nation']];
    const sim = this.g.sim;
    return `<div class="grid2">${ids.map(([id, t]) => `<div class="chart"><h5>${t}</h5><canvas id="${id}"></canvas></div>`).join('')}</div><p class="note">Sampled once a year from the running simulation. ${num(sim.totalBorn)} people have been born in this world and ${num(sim.totalDied)} have died.</p>`;
  }

  private drawCharts(): void {
    const st = this.g.sim.stats;
    const line = (id: string, series: { data: number[]; xs?: number[]; color: string }[], opts: { min0?: boolean; pct?: boolean } = {}) => {
      const cv = document.getElementById(id) as HTMLCanvasElement | null;
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.clientWidth,
        H = cv.clientHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      const g = cv.getContext('2d')!;
      g.scale(dpr, dpr);
      let lo = Infinity, hi = -Infinity;
      for (const s of series) for (const v of s.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (!isFinite(lo)) return;
      if (opts.min0 !== false && lo > 0) lo = 0;
      if (hi - lo < 1e-6) hi = lo + 1;
      const x0 = st.year[0] || 0,
        x1 = st.year[st.year.length - 1] || 1;
      const L = 38, R = 6, T = 6, B = 16;
      const X = (yv: number) => L + ((yv - x0) / Math.max(1, x1 - x0)) * (W - L - R);
      const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      g.strokeStyle = 'rgba(151,164,179,0.18)';
      g.fillStyle = '#97a4b3';
      g.font = '10px "IBM Plex Sans", sans-serif';
      g.lineWidth = 1;
      for (let k = 0; k <= 3; k++) {
        const v = lo + ((hi - lo) * k) / 3;
        const y = Math.round(Y(v)) + 0.5;
        g.beginPath();
        g.moveTo(L, y);
        g.lineTo(W - R, y);
        g.stroke();
        g.textAlign = 'right';
        g.fillText(opts.pct ? (v * 100).toFixed(0) : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.abs(hi - lo) < 5 ? v.toFixed(1) : v.toFixed(0), L - 4, y + 3);
      }
      g.textAlign = 'left';
      g.fillText('yr ' + (x0 + 1), L, H - 3);
      g.textAlign = 'right';
      g.fillText('yr ' + (x1 + 1), W - R, H - 3);
      for (const s of series) {
        if (s.data.length < 2) continue;
        g.strokeStyle = s.color;
        g.lineWidth = 1.6;
        g.beginPath();
        for (let k = 0; k < s.data.length; k++) {
          const xv = s.xs ? s.xs[k] : st.year[k];
          if (k === 0) g.moveTo(X(xv), Y(s.data[k]));
          else g.lineTo(X(xv), Y(s.data[k]));
        }
        g.stroke();
        const lastX = s.xs ? s.xs[s.xs.length - 1] : st.year[s.data.length - 1];
        g.fillStyle = s.color;
        g.beginPath();
        g.arc(X(lastX), Y(s.data[s.data.length - 1]), 2.4, 0, Math.PI * 2);
        g.fill();
      }
    };
    line('c-pop', [{ data: st.pop, color: '#f2b33d' }]);
    const civSeries: { data: number[]; xs: number[]; color: string }[] = [];
    const sim = this.g.sim;
    const ranked = Array.from(st.civPop.entries()).map(([id, arr]) => {
      let peak = 0;
      for (let k = 1; k < arr.length; k += 2) if (arr[k] > peak) peak = arr[k];
      return { id, arr, peak };
    }).sort((a, b) => b.peak - a.peak).slice(0, 12);
    for (const r of ranked) {
      const c = sim.civs.get(r.id);
      const xs: number[] = [], data: number[] = [];
      for (let k = 0; k < r.arr.length; k += 2) { xs.push(r.arr[k]); data.push(r.arr[k + 1]); }
      civSeries.push({ data, xs, color: c ? civCss(c.color) : '#888' });
    }
    line('c-civpop', civSeries);
    line('c-temp', [{ data: st.temp, color: '#f0a35e' }], { min0: false });
    line('c-forest', [{ data: st.forest, color: '#7fd36b' }], { pct: true });
    line('c-animals', [{ data: st.animals, color: '#8fd0a0' }]);
    line('c-wars', [{ data: st.wars, color: '#ef6b5e' }]);
    line('c-trade', [{ data: st.trade, color: '#5fd0c5' }]);
    line('c-tech', [{ data: st.tech, color: '#b58cf5' }]);
  }

  private techHtml(): string {
    const sim = this.g.sim;
    const live = Array.from(sim.civs.values()).filter((c) => c.alive).sort((a, b) => b.pop - a.pop);
    let civ = sim.civs.get(this.techCiv);
    if (!civ || !civ.alive) civ = live[0];
    if (!civ) return '<p class="muted">No nation exists to know anything.</p>';
    this.techCiv = civ.id;
    const env = civEnv(sim, civ);
    let h = `<div class="filters"><label for="tech-civ">Nation</label><select id="tech-civ" data-inp="tech-civ">${live.map((c) => `<option value="${c.id}" ${c.id === civ!.id ? 'selected' : ''}>${esc(c.name)} — ${ERA_NAMES[c.era]}</option>`).join('')}</select><span class="muted">Click an art to grant it; click a known one to strike it from memory.</span></div><div class="tiers">`;
    const tierNames = ['Origins', 'Stone Age', 'Bronze Age', 'Iron Age', 'Medieval', 'Renaissance', 'Industrial', 'Modern', 'Atomic'];
    for (let tier = 0; tier <= 8; tier++) {
      h += `<div class="tier"><h5>${tierNames[tier]}</h5>`;
      for (const t of TECHS) {
        if (t.tier !== tier) continue;
        const st = civ.tech[t.id];
        let cls = '', note = '';
        const missing = TECH_PRE[t.id].filter((p) => civ!.tech[p] !== 1).map((p) => TECHS[p].name);
        if (st === 1) cls = 'known';
        else if (civ.researching === t.id) { cls = 'now'; note = `<small>${Math.round((civ.research[t.id] / effectiveCost(sim, civ, t.id)) * 100)}% understood</small>`; }
        else if (st === 2) { cls = 'lost'; note = '<small>lost — half remembered</small>'; }
        else if (missing.length) { cls = 'locked'; note = `<small>needs ${esc(missing.join(', '))}</small>`; }
        else if (!canResearch(civ, t.id, env)) { cls = 'blocked'; note = `<small class="need">their land lacks: ${esc(t.needText || '')}</small>`; }
        else note = `<small>within reach (${Math.round(techCost(t.id))})</small>`;
        h += `<div class="tech ${cls}" id="tech-${t.key}" data-act="${st === 1 ? 'revoke' : 'grant'}" data-arg="${t.id}" title="${esc(t.desc)}"><b>${esc(t.name)}</b>${note}</div>`;
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  private worldHtml(): string {
    const g = this.g;
    const sim = g.sim;
    const tab = this.worldTab;
    const tb = (id: string, label: string) => `<button data-act="world-tab" data-arg="${id}" id="wtab-${id}" class="${tab === id ? 'on' : ''}">${label}</button>`;
    let h = `<div class="tabs">${tb('new', 'New world')}${tb('save', 'Save & load')}${tb('params', 'Laws of nature')}${tb('view', 'View')}</div>`;
    if (tab === 'new') {
      h += `<div class="form">
        <label for="nw-seed">Seed</label><input id="nw-seed" type="number" value="${Math.floor(Math.random() * 99999) + 1}">
        <label for="nw-size">Size</label><select id="nw-size"><option value="160x100">Small (160 × 100)</option><option value="256x160" selected>Medium (256 × 160)</option><option value="352x220">Large (352 × 220)</option><option value="448x280">Huge (448 × 280)</option></select>
        <label for="nw-land">Land</label><select id="nw-land"><option value="0.22">Archipelago (22%)</option><option value="0.36" selected>Continents (36%)</option><option value="0.5">Great landmass (50%)</option></select>
        <label for="nw-tribes">First peoples</label><input id="nw-tribes" type="number" min="0" max="24" value="8">
        <label for="nw-cap">Population limit</label><select id="nw-cap"><option value="5000">5,000</option><option value="12000" selected>12,000</option><option value="25000">25,000</option><option value="50000">50,000</option></select>
        <span></span><button class="on" id="nw-make" data-act="new-world">Create world</button>
      </div><p class="note">The same seed and settings always produce the same planet and the same history, until you touch it. Every person is simulated individually, so the population limit is what your machine pays for. The current world is seed ${sim.world.seed}, ${sim.world.w} × ${sim.world.h}.</p>`;
    } else if (tab === 'save') {
      h += `<div id="slots"><p class="muted">Looking for saved worlds…</p></div><div class="acts"><button id="btn-export" data-act="export">Export to a file</button><button id="btn-import" data-act="import">Import a file</button><button id="btn-autosave" data-act="autosave" class="${g.autosave ? 'on' : ''}">Autosave every 5 minutes: ${g.autosave ? 'on' : 'off'}</button></div><p class="note">Saves hold the complete state — every person, herd, price and grudge — and a loaded world continues exactly as the original would have. Slots live in this browser. Exported files can be imported again on any device.</p>`;
    } else if (tab === 'params') {
      const P = sim.params as unknown as Record<string, number>;
      const sl = (key: string, label: string, min: number, max: number) => `<div class="slider"><label for="p-${key}">${label}</label><input id="p-${key}" type="range" min="${min}" max="${max}" value="${Math.round(P[key] * 100)}" data-inp="param:${key}"><span>${P[key].toFixed(2)}×</span></div>`;
      h += `<h4>Life</h4>${sl('birthRate', 'Birth rate', 20, 250)}${sl('mortality', 'Mortality', 20, 300)}${sl('wildlife', 'Wildlife vigour', 0, 250)}${sl('growth', 'Plant growth', 10, 250)}
        <h4>Society</h4>${sl('aggression', 'Aggression', 0, 300)}${sl('unrest', 'Restlessness', 0, 300)}${sl('research', 'Pace of discovery', 10, 500)}${sl('tradeZeal', 'Zeal for trade', 0, 250)}
        <div class="slider"><label for="p-popCap">Population limit</label><input id="p-popCap" type="range" min="1000" max="60000" step="1000" value="${P.popCap}" data-inp="param:popCap"><span>${num(P.popCap)}</span></div>
        <h4>Planet</h4>${sl('disasters', 'Disasters', 0, 500)}${sl('climateVolatility', 'Climate swings', 0, 300)}
        <div class="slider"><label for="p-godTemp">Global warmth</label><input id="p-godTemp" type="range" min="-80" max="80" value="${Math.round(sim.climate.godTemp * 10)}" data-inp="godTemp"><span>${sim.climate.godTemp >= 0 ? '+' : ''}${sim.climate.godTemp.toFixed(1)}°</span></div>
        <div class="slider"><label for="p-godRain">Global rainfall</label><input id="p-godRain" type="range" min="20" max="220" value="${Math.round(sim.climate.godRain * 100)}" data-inp="godRain"><span>${sim.climate.godRain.toFixed(2)}×</span></div>
        <div class="slider"><label for="p-sea">Sea level</label><input id="p-sea" type="range" min="-60" max="60" value="${Math.round((sim.climate.seaBase - SEA) * 1000)}" data-inp="sea"><span>${Math.round((sim.climate.seaBase - SEA) * 9000)} m</span></div>
        <p class="note">These change the rules for everyone at once; the world responds through its own systems. Warmth also moves the seas: an ice age bares the continental shelves, a hot age drowns the coasts. Greenhouse gas from the industrial ages adds ${(2.4 * Math.log2(1 + sim.climate.co2 / 300)).toFixed(2)}° at present.</p>`;
    } else {
      h += `<div class="acts"><button id="btn-labels" data-act="labels" class="${g.renderer.showLabels ? 'on' : ''}">Names on the map</button><button id="btn-borders" data-act="borders" class="${g.renderer.showBorders ? 'on' : ''}">Borders</button></div><p class="note">Running at ${Math.round(g.tps)} ticks per second. ${num(sim.people.size)} people, ${sim.herds.size} herds, ${sim.settlements.size} settlements, ${sim.routes.size} trade routes.</p>`;
    }
    return h;
  }

  private fillSlots(): void {
    const g = this.g;
    g.listSlots().then((list) => {
      const el = document.getElementById('slots');
      if (!el) return;
      const by = new Map(list.map((s) => [s.slot, s]));
      const row = (slot: string, label: string, canSave: boolean) => {
        const s = by.get(slot);
        return `<div class="slot"><b>${label}</b><span class="meta">${s ? `Year ${s.year} · ${num(s.pop)} people · ${s.size} · saved ${new Date(s.when).toLocaleString()}` : 'empty'}</span>${canSave ? `<button data-act="save" data-arg="${slot}" id="save-${slot}">Save here</button>` : ''}${s ? `<button data-act="load" data-arg="${slot}" id="load-${slot}">Load</button>` : ''}</div>`;
      };
      el.innerHTML = row('slot1', 'Slot 1', true) + row('slot2', 'Slot 2', true) + row('slot3', 'Slot 3', true) + row('auto', 'Autosave', false);
    }).catch(() => {
      const el = document.getElementById('slots');
      if (el) el.innerHTML = '<p class="muted">This browser is not letting the page store saves. Use file export instead.</p>';
    });
  }

  private newWorldFromForm(): void {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    const [w, h] = v('nw-size').split('x').map(Number);
    this.toggleWindow(null);
    this.g.newWorld({ seed: Number(v('nw-seed')) || 1, w, h, land: Number(v('nw-land')), tribes: Math.max(0, Math.min(24, Number(v('nw-tribes')) || 0)), popCap: Number(v('nw-cap')) });
  }

  private helpHtml(): string {
    return `<p class="note">You are watching a planet that runs by itself. Rain falls where winds carry it, forests spread and burn, herds follow the grass and are hunted. People are born, work, marry, move, and die; what they do adds up to villages, markets, kingdoms, wars and faiths. Nothing here is scripted. Leave it alone and read the chronicle, or reach in.</p>
    <h4>Getting around</h4>
    <ul class="plain"><li>Drag to move · scroll or pinch to zoom · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> also move</li><li><kbd>Space</kbd> pause · <kbd>1</kbd>–<kbd>4</kbd> speed · <kbd>M</kbd> cycle map modes · <kbd>Esc</kbd> back to Inspect</li><li>Zoom in close to see individual people going about their work. Click one to read their life.</li></ul>
    <h4>Things worth trying</h4>
    <ul class="plain">
      <li><b>Follow a famine.</b> Hold the Drought tool over a kingdom’s farmland for a few years. Watch prices in its market, then the roads, then its neighbours.</li>
      <li><b>Cut a city off.</b> Find a port that imports its food (Imports column in its market) and wait for a blockade or siege — or raise mountains across its roads.</li>
      <li><b>Give one person a gift.</b> Grant genius to a scholar, or charisma to an ambitious soldier in an unhappy town.</li>
      <li><b>Run an experiment.</b> Open a nation, set its culture to mercantile and open, its neighbour’s to martial and insular, and seal a third off from the world. Come back in two centuries.</li>
      <li><b>Take away the coal.</b> Use the Ore tools to remove a deposit an industrial power depends on.</li>
      <li><b>Start an ice age.</b> World → Laws of nature → Global warmth.</li>
    </ul>
    <h4>What is and is not simulated</h4>
    <p class="note">Every person is an individual with heritable temperament, skills, family, wealth, faith and loyalties, updated monthly inside their settlement; journeys, caravans, migrations and armies physically cross the map. Animals are simulated as herds whose traits drift and split into new species. Day-to-day movement of townsfolk on screen is illustrative: it shows real people at their real places of work, but the walking itself is not simulated.</p>`;
  }
}
export { relationOf };
