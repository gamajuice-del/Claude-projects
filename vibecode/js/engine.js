/* VibeCode — game engine: simulation, physics, behaviors, combat, rules, actions, autopilot, mods. */
(function (VC) {
  'use strict';
  const U = VC.U, Lv = VC.Levels, T = Lv.T, SOLID = Lv.SOLID;
  const MAX_ENT = 1600, MAX_PROJ = 900, CELL = 96;
  const SIDE = { platformer: 1, runner: 1 };

  const FALLBACK_PROJ = { projectile: true, shape: 'circle', color: '#f7dc6f', size: 8, speed: 600, damage: 1, lifetime: 1.6 };

  function teamOf(def) {
    if (def.team === 'enemy' || def.team === 'friend' || def.team === 'neutral') return def.team;
    if (def.role === 'enemy' || def.role === 'boss' || def.role === 'hazard') return 'enemy';
    if (def.role === 'pet') return 'friend';
    return 'neutral';
  }
  function hostile(a, b) { return (a === 'enemy' && b === 'friend') || (a === 'friend' && b === 'enemy'); }

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.canvas = opts.canvas || null;
      this.headless = !this.canvas;
      this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
      this.ev = U.emitter();
      this.mode = 'demo';
      this.state = 'empty';
      this.spec = null;
      this.entities = [];
      this.particles = [];
      this.floaters = [];
      this.bombs = [];
      this.nextId = 1;
      this.time = 0; this.realTime = 0; this.frame = 0;
      this.cam = { x: 0, y: 0, shake: 0, ox: 0, oy: 0 };
      this.view = { cw: 960, ch: 600, dpr: 1, scale: 1 };
      this.input = { keys: {}, pressed: {}, released: {}, mouse: { sx: 0, sy: 0, wx: 0, wy: 0, down: false, right: false, clicked: false, rclicked: false, inside: false, t: -99 }, touch: null };
      this.rt = {};
      this.score = 0; this.level = 1;
      this.stats = this.freshStats();
      this.messages = [];
      this.err = null;
      this.modsFns = {};
      this.fps = 60; this._fpsAcc = 0; this._fpsN = 0;
      this.contacts = new Set();
      this.nearPairs = new Set();
      this.tileContacts = new Set();
      this.hitstop = 0;
      this.depth = 0;
      this.budget = 0;
      this.onEffects = null;
      this.lifetime = { deaths: 0, wins: 0, maxEnt: 0, maxProj: 0, chain: 0 };
      if (this.canvas && VC.Render) VC.Render.init(this);
    }
    on(ev, fn) { return this.ev.on(ev, fn); }
    emit(ev, d) { this.ev.emit(ev, d); }
    freshStats() { return { collected: {}, killed: {}, spawned: {}, kills: 0, collectedTotal: 0, deathsRecent: [], hurt: 0, shots: 0, startedAt: 0 }; }

    // ------------------------------------------------------------------ loading
    load(spec, opts) {
      opts = opts || {};
      const prev = this.spec;
      this.spec = VC.Spec.normalize(U.clone(spec));
      this.err = null;
      this.compileMods();
      if (!prev || opts.fresh || this.state === 'empty' || !this.level0) { this.reset(); return; }
      const levelChanged = !U.same(prev.level, this.spec.level) || prev.world.physics !== this.spec.world.physics || prev.world.width !== this.spec.world.width || prev.world.height !== this.spec.world.height;
      this.applyRuntimeConfig(prev);
      if (levelChanged) {
        this.buildLevel();
        if (this.player) this.placePlayer();
        for (const e of this.entities) if (this.insideSolid(e) || e.x > this.W || e.y > this.H) this.relocate(e);
      }
      // entities: refresh defs, remove deleted types
      const types = this.spec.types;
      for (const e of this.entities) {
        if (e.isPlayer) continue;
        const def = types[e.type];
        if (!def) { if (!e.def.projectile) this.poof(e); e.dead = true; continue; }
        const oldMax = e.maxHp;
        e.def = def;
        e.team = e.owner ? e.team : teamOf(def);
        const mh = def.hp != null ? def.hp : defaultHp(def);
        if (mh !== oldMax) { e.hp = Math.max(1, Math.round(e.hp / oldMax * mh)); e.maxHp = mh; }
      }
      // spawn counts
      for (const [name, def] of Object.entries(types)) {
        if (def.projectile || !def.spawn) continue;
        const want = def.spawn.count || 0;
        const had = prev.types[name] && prev.types[name].spawn ? prev.types[name].spawn.count || 0 : 0;
        const alive = this.entities.filter((e) => e.type === name && !e.dead).length;
        if (!prev.types[name] || want > had) {
          const n = Math.min(want - (prev.types[name] ? had : 0), want - alive + (prev.types[name] ? 0 : alive));
          this.spawnGroup(name, Math.max(0, Math.min(n, 400)), def.spawn.at);
        } else if (want < had) {
          const extra = alive - want;
          let k = 0;
          for (const e of this.entities) { if (k >= extra) break; if (e.type === name && !e.dead) { this.poof(e); e.dead = true; k++; } }
        }
      }
      // player
      if (this.spec.player && !this.player) this.spawnPlayer();
      else if (!this.spec.player && this.player) { this.poof(this.player); this.player = null; }
      else if (this.player) this.refreshPlayer();
      this.compileRules(true);
      this.entities = this.entities.filter((e) => !e.dead);
      if (this.state === 'empty' && !VC.Spec.isEmpty(this.spec)) this.state = 'running';
      if (VC.Spec.isEmpty(this.spec)) this.state = 'empty';
      this.emit('reload');
    }

    applyRuntimeConfig(prev) {
      const s = this.spec;
      const rt = this.rt;
      rt.gravity = s.world.gravity == null ? 1500 : s.world.gravity;
      if (prev && prev.world.gravity === s.world.gravity && this.rtGravityFlipped) rt.gravity = -rt.gravity;
      rt.timeScale = s.world.timeScale || 1;
      rt.zoom = s.camera.zoom || 1;
      rt.effects = new Set(s.look.effects || []);
      rt.pal = VC.Lex.palette(s.look.palette);
      rt.juice = s.look.juice == null ? 1 : s.look.juice;
      if (this.onEffects) this.onEffects(rt.effects, s);
      if (!this.headless && VC.Sound) VC.Sound.setMusic(this.mode === 'play' ? s.audio.music : null, s.audio.tempo);
    }

    reset() {
      const s = this.spec || VC.Spec.empty();
      this.entities = []; this.particles = []; this.floaters = []; this.bombs = []; this.messages = [];
      this.player = null;
      this.time = 0; this.score = 0; this.level = 1; this.stats = this.freshStats();
      this.vars = {};
      this.rt = { slowmo: 0, slowF: 1, tint: null, flash: 0, flashColor: '#fff', zoomPulse: 0 };
      this.rtGravityFlipped = false;
      this.applyRuntimeConfig(null);
      this.contacts = new Set(); this.nearPairs = new Set(); this.tileContacts = new Set();
      this.timeLeft = s.hud.timer || 0;
      this.state = VC.Spec.isEmpty(s) ? 'empty' : 'running';
      this.titleT = s.meta.title ? 3.2 : 0;
      this.hintT = 7;
      this.demoReset = 0;
      this.buildLevel();
      this.level0 = true;
      if (s.player) this.spawnPlayer();
      this.spawnAll();
      this.compileRules(false);
      this.fire('onStart', {});
      this.fire('onLevel', { level: 1 });
      this.callMod('onStart');
      this.emit('reset');
    }

    buildLevel() {
      try { this.lvl = Lv.generate(this.spec); } catch (e) { console.error(e); this.lvl = Lv.generate(Object.assign({}, this.spec, { level: { type: 'empty', tile: 40 } })); }
      this.grid = this.lvl.tiles;
      this.W = this.lvl.w; this.H = this.lvl.h; this.TS = this.grid.ts;
      this.cam.x = this.lvl.start.x; this.cam.y = this.lvl.start.y;
      const ph = this.spec.world.physics;
      const floorTypes = { platforms: 1, runner: 1, pipes: 1, tower: 0, bricks: 1 };
      this.openBottom = !!SIDE[ph] ? !!floorTypes[this.lvl.type] || this.lvl.floorOpen : ph === 'paddle' || this.lvl.type === 'bricks';
      if (this.render) this.render.levelChanged = true;
    }

    // ------------------------------------------------------------------ spawning
    spawnAll() {
      for (const [name, def] of Object.entries(this.spec.types)) {
        if (def.projectile || !def.spawn) continue;
        this.spawnGroup(name, Math.min(def.spawn.count || 0, 600), def.spawn.at);
      }
    }
    spawnGroup(name, n, at) {
      const def = this.spec.types[name];
      if (!def || n <= 0) return;
      if (at === 'grid') {
        const pts = this.lvl.grid2 && this.lvl.grid2.length ? this.lvl.grid2 : this.formation(n);
        pts.slice(0, n).forEach((p) => this.spawnEntity(name, p.x, p.y, { row: p.row }));
        return;
      }
      if (at === 'checkpoints' && this.lvl.checkpoints.length) {
        this.lvl.checkpoints.slice(0, n).forEach((p, i) => this.spawnEntity(name, p.x, p.y, { order: i }));
        return;
      }
      for (let i = 0; i < n; i++) {
        const p = this.findSpot(at || 'random', def);
        this.spawnEntity(name, p.x, p.y);
      }
    }
    formation(n) {
      const cols = Math.min(12, Math.max(4, Math.ceil(Math.sqrt(n * 2)))), out = [];
      const w = Math.min(this.W - 120, cols * 64);
      for (let i = 0; i < n; i++) out.push({ x: (this.W - w) / 2 + 32 + (i % cols) * (w / cols), y: 90 + Math.floor(i / cols) * 34, row: Math.floor(i / cols) });
      return out;
    }
    findSpot(at, def, ctx) {
      const L = this.lvl, P = this.player, side = !!SIDE[this.spec.world.physics];
      const rnd = (arr) => arr[Math.floor(U.random() * arr.length)];
      const far = (arr, d) => {
        if (!arr.length) return null;
        for (let i = 0; i < 12; i++) { const p = rnd(arr); if (!P || U.dist(p.x, p.y, P.x, P.y) > d) return p; }
        return rnd(arr);
      };
      let p = null;
      const walker = side && def && !def.flying && !def.projectile;
      switch (at) {
        case 'here': p = ctx && ctx.x != null ? { x: ctx.x, y: ctx.y } : null; break;
        case 'player': case 'near-player': case 'around': {
          if (P) { const a = U.random() * Math.PI * 2, r = 120 + U.random() * 110; p = { x: P.x + Math.cos(a) * r, y: P.y + Math.sin(a) * r }; if (walker) p.y = P.y - 20; }
          break;
        }
        case 'edges': p = far(L.edges, 300); break;
        case 'top': case 'sky': p = side || at === 'sky' ? far(L.sky, 200) : { x: def && def.boss ? this.W / 2 : 60 + U.random() * (this.W - 120), y: def && def.boss ? 110 : 60 }; break;
        case 'ground': p = far(L.ground, 200); break;
        case 'center': p = { x: this.W / 2, y: this.H / 2 }; break;
        case 'goal': p = L.goal ? { x: L.goal.x, y: L.goal.y } : null; break;
        case 'start': p = { x: L.start.x, y: L.start.y }; break;
        case 'bottom': p = { x: 40 + U.random() * (this.W - 80), y: this.H - 60 }; break;
        default: break;
      }
      if (!p) p = walker ? far(L.ground, 240) || far(L.open, 240) : def && def.flying && side ? far(L.sky.length ? L.sky : L.open, 240) : far(L.open, 260);
      if (!p) p = { x: U.random() * this.W, y: U.random() * this.H };
      if (this.spec.world.physics === 'snake') { const ts = this.TS; p = { x: Math.floor(p.x / ts) * ts + ts / 2, y: Math.floor(p.y / ts) * ts + ts / 2 }; }
      if (this.spec.world.physics === 'shmup' && def && !def.static && (at === 'random' || at === 'top' || !at)) p = { x: 40 + U.random() * (this.W - 80), y: -30 - U.random() * (this.state === 'running' && this.time > 0.5 ? 40 : 360) };
      else if ((at === 'top' || at === 'sky') && def && (def.behaviors || []).some((b) => b.type === 'fall') && !(ctx && ctx.x != null)) p.y = -30 - U.random() * 320;
      return { x: p.x, y: p.y };
    }

    spawnEntity(type, x, y, over) {
      let def = this.spec.types[type];
      if (!def) { if (over && over.fallbackProj) def = FALLBACK_PROJ; else return null; }
      if (this.entities.length >= MAX_ENT) return null;
      const e = {
        id: this.nextId++, type, def, x, y, vx: 0, vy: 0, scale: 1, sizeMul: 1, speedMul: 1, angle: 0, face: 1,
        hp: def.hp != null ? def.hp : defaultHp(def), maxHp: 0, team: teamOf(def), age: 0, st: {}, cd: {}, inv: 0, flash: 0,
        dead: false, ground: false, wallX: 0, z: 0, vz: 0, tint: null, frozen: 0, pop: 0.22, trail: null, hitSet: null,
      };
      e.maxHp = e.hp;
      if (over) Object.assign(e, over);
      if (def.projectile) e.life = def.lifetime || 1.8;
      if (def.w && def.h) { e.hw = def.w / 2; e.hh = def.h / 2; }
      this.setRadius(e);
      // initial motion for drifters / bouncers
      for (const b of def.behaviors || []) {
        if (b.type === 'drift' || b.type === 'bounce') { const a = U.random() * Math.PI * 2, sp = b.speed || def.speed || 120; e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; if (b.type === 'bounce' && this.spec.world.physics === 'paddle') { e.vx = (U.random() < 0.5 ? -1 : 1) * sp * 0.55; e.vy = -sp * 0.85; } }
        if (b.type === 'patrol') e.st.dir = U.random() < 0.5 ? -1 : 1;
      }
      this.entities.push(e);
      this.stats.spawned[type] = (this.stats.spawned[type] || 0) + 1;
      if (!def.projectile) { this.fire('onSpawn', { self: e, x, y }, e); this.callMod('onEvent', 'spawn', e); }
      return e;
    }
    setRadius(e) {
      const sz = (e.isPlayer ? e.def.size || 28 : e.def.size || 28) * e.scale * e.sizeMul;
      e.size = U.clamp(sz, 2, 900);
      e.r = e.size / 2;
      if (e.def.w && e.def.h) { e.hw = e.def.w / 2 * e.scale; e.hh = e.def.h / 2 * e.scale; }
    }

    spawnPlayer() {
      const def = this.spec.player;
      const e = {
        id: this.nextId++, type: 'player', def, isPlayer: true, x: this.lvl.start.x, y: this.lvl.start.y, vx: 0, vy: 0, scale: 1, sizeMul: 1, speedMul: 1,
        angle: -Math.PI / 2, face: 1, hp: def.hp || 5, maxHp: def.hp || 5, team: 'friend', age: 0, st: {}, cd: {}, inv: 1.2, flash: 0, dead: false,
        ground: false, z: 0, vz: 0, pop: 0.3, powers: {}, lives: def.lives || 1, jumps: 0, tail: [], tailLen: (def.abilities && def.abilities.tail && def.abilities.tail.length) || 0,
        coyote: 0, aim: 0, frozen: 0, trail: null,
      };
      if (this.spec.world.physics === 'snake' && !e.tailLen) e.tailLen = 3;
      this.player = e;
      this.abilities = U.clone(def.abilities || {});
      this.setRadius(e);
      this.placePlayer();
      this.entities.push(e);
    }
    refreshPlayer() {
      const p = this.player, def = this.spec.player;
      const oldMax = p.maxHp;
      p.def = def;
      p.maxHp = def.hp || 5;
      if (p.maxHp !== oldMax) p.hp = U.clamp(Math.round(p.hp + (p.maxHp - oldMax)), 1, p.maxHp);
      this.abilities = U.clone(def.abilities || {});
      if (def.abilities && def.abilities.tail && def.abilities.tail.length > p.tailLen) p.tailLen = def.abilities.tail.length;
      this.setRadius(p);
    }
    placePlayer() {
      const p = this.player;
      p.x = this.lvl.start.x; p.y = this.lvl.start.y; p.vx = 0; p.vy = 0;
      if (SIDE[this.spec.world.physics]) p.y = this.lvl.start.y - 2;
      if (this.spec.world.physics === 'snake') { const ts = this.TS; p.x = Math.floor(p.x / ts) * ts + ts / 2; p.y = Math.floor(p.y / ts) * ts + ts / 2; p.st.dir = [1, 0]; p.st.t = 0; p.tail = []; }
      if (this.spec.world.physics === 'paddle') { p.y = this.H - 46; }
      if (this.spec.world.physics === 'shmup') { p.x = this.W / 2; p.y = this.H - 70; }
      this.cam.x = p.x; this.cam.y = p.y;
      // keep the spawn safe: shove hostile things away
      for (const e of this.entities) {
        if (e === p || e.team !== 'enemy' || e.def.static) continue;
        if (U.dist(e.x, e.y, p.x, p.y) < 200 && !(e.def.boss && e.def.spawn && e.def.spawn.at === 'top')) this.relocate(e, 260);
      }
    }
    relocate(e, minD) {
      const p = this.findSpot(e.def.spawn ? e.def.spawn.at : 'random', e.def);
      e.x = p.x; e.y = p.y;
      if (minD && this.player && U.dist(e.x, e.y, this.player.x, this.player.y) < minD) { const q = this.findSpot('edges', e.def); e.x = q.x; e.y = q.y; }
    }

    // ------------------------------------------------------------------ rules
    compileRules(keepState) {
      const old = this.rules || [];
      this.rules = (this.spec.rules || []).map((r) => {
        const prev = keepState ? old.find((o) => o.r.id === r.id && U.same(o.r.when, r.when)) : null;
        return { r, t: prev ? prev.t : 0, fired: prev ? prev.fired : 0, armed: prev ? prev.armed : true, bucket: prev ? prev.bucket : 0, seen: prev ? prev.seen : false };
      });
      this.byTrig = {};
      for (const R of this.rules) (this.byTrig[R.r.when.type] = this.byTrig[R.r.when.type] || []).push(R);
    }
    condOk(r) {
      const c = r.cond;
      if (!c) return true;
      if (c.collected) return (this.stats.collected[c.collected] || 0) >= (c.atLeast || c.count || 1);
      if (c.var) return (this.vars[c.var] || 0) >= (c.atLeast == null ? 1 : c.atLeast);
      if (c.score != null) return this.score >= c.score;
      if (c.killed) return (this.stats.killed[c.killed] || 0) >= (c.atLeast || 1);
      return true;
    }
    runRule(R, ctx) {
      if (R.r.once && R.fired) return;
      if (!this.condOk(R.r)) return;
      if (this.depth > 6) return;
      R.fired++;
      this.curRule = R.r;
      this.depth++;
      try { for (const a of R.r.then || []) { if (this.budget-- < 0) break; this.act(a, ctx); } } finally { this.depth--; }
    }
    fire(trig, ctx, ent) {
      const list = this.byTrig && this.byTrig[trig];
      if (!list) return;
      for (const R of list) {
        const w = R.r.when;
        if (trig === 'onDeath' || trig === 'onHurt' || trig === 'onSpawn' || trig === 'onHitWall' || trig === 'onClick') { if (!this.matches(ent, w.of || 'any')) continue; }
        if (trig === 'onKey' && String(w.key).toLowerCase() !== ctx.key) continue;
        if (trig === 'onLevel' && w.level != null && w.level !== ctx.level) continue;
        this.runRule(R, ctx);
      }
    }
    matches(e, sel) {
      if (!e || sel == null) return false;
      if (sel === 'any' || sel === '*') return true;
      if (sel === 'player') return !!e.isPlayer;
      if (e.isPlayer) return sel === 'friend';
      if (sel === e.type) return true;
      const d = e.def;
      if (sel === 'enemy' || sel === 'enemies') return e.team === 'enemy' && !d.projectile && d.role !== 'hazard';
      if (sel === 'hostile') return e.team === 'enemy';
      if (sel === 'projectile' || sel === 'bullet') return !!d.projectile;
      if (sel === 'boss') return !!d.boss || d.role === 'boss';
      if (sel === 'friend') return e.team === 'friend';
      if (sel === d.role) return true;
      return false;
    }
    targets(sel, ctx) {
      if (sel == null || sel === 'self') return ctx.self ? [ctx.self] : [];
      if (sel === 'other') return ctx.other ? [ctx.other] : [];
      if (sel === 'it') return [ctx.self && ctx.self.isPlayer ? ctx.other : ctx.self].filter(Boolean);
      if (sel === 'player') return this.player ? [this.player] : [];
      if (typeof sel === 'string' && sel.startsWith('all:')) { const s = sel.slice(4); return this.entities.filter((e) => !e.dead && this.matches(e, s)); }
      if (ctx.self && this.matches(ctx.self, sel)) return [ctx.self];
      if (ctx.other && this.matches(ctx.other, sel)) return [ctx.other];
      return this.entities.filter((e) => !e.dead && this.matches(e, sel));
    }

    // ------------------------------------------------------------------ actions
    act(a, ctx) {
      const pos = ctx.x != null ? ctx : ctx.self || this.player || { x: this.W / 2, y: this.H / 2 };
      const x = pos.x, y = pos.y;
      switch (a.type) {
        case 'addScore': this.addScore(a.amount == null ? 1 : a.amount, x, y); break;
        case 'stealScore': this.addScore(-(a.amount || 1), x, y); break;
        case 'damage': for (const e of this.targets(a.target || 'player', ctx)) this.hurt(e, a.amount || 1, ctx.self); break;
        case 'heal': for (const e of this.targets(a.target || 'player', ctx)) { e.hp = Math.min(e.maxHp, e.hp + (a.amount || 1)); this.floater(e.x, e.y - e.r, '+' + (a.amount || 1) + ' ♥', '#7ee08a'); } this.sfx('powerup'); break;
        case 'destroy': for (const e of this.targets(a.target || 'other', ctx)) this.destroy(e, ctx); break;
        case 'spawn': {
          const n = U.clamp(a.count || 1, 1, 200);
          if (!this.spec.types[a.what]) break;
          for (let i = 0; i < n; i++) { const p = this.findSpot(a.at || 'random', this.spec.types[a.what], ctx); const e = this.spawnEntity(a.what, p.x + (a.at === 'here' ? (U.random() - 0.5) * 30 : 0), p.y); if (e && a.at === 'here') { e.vx = (U.random() - 0.5) * 200; e.vy = (U.random() - 0.5) * 200; } }
          break;
        }
        case 'shake': this.shake(a.power || 8); break;
        case 'flash': this.rt.flash = 0.25; this.rt.flashColor = a.color || '#ffffff'; break;
        case 'tint': this.rt.tint = { color: a.color || '#ff0000', t: a.seconds || 2, max: a.seconds || 2 }; break;
        case 'sound': this.sfx(a.name || 'blip'); break;
        case 'burst': this.burst(x, y, a.color || (ctx.self && ctx.self.def && ctx.self.def.color) || '#ffd166', a.count || 14); break;
        case 'confetti': this.confetti(); break;
        case 'grow': for (const e of this.targets(a.target || 'player', ctx)) { e.scale = U.clamp(e.scale * (a.factor || 1.2), 0.15, 10); this.setRadius(e); } break;
        case 'speedUp': for (const e of this.targets(a.target || 'player', ctx)) e.speedMul = U.clamp(e.speedMul * (a.factor || 1.2), 0.08, 8); break;
        case 'say': for (const e of this.targets(a.target || 'self', ctx).slice(0, 4)) this.say(e, a.text || '...'); break;
        case 'banner': this.banner(a.text || '!'); break;
        case 'win': this.win(a.text); break;
        case 'lose': this.lose(a.text); break;
        case 'nextLevel': this.nextLevel(); break;
        case 'restart': this.pendingRestart = 0.6; break;
        case 'teleport': for (const e of this.targets(a.target || 'player', ctx)) { const p = this.findSpot(a.to || 'random', e.def); this.ring(e.x, e.y, '#bb8fce', 40); e.x = p.x; e.y = p.y; e.vx = e.vy = 0; this.ring(e.x, e.y, '#bb8fce', 40); } this.sfx('magic'); break;
        case 'transform': {
          if (!this.spec.types[a.into]) break;
          for (const e of this.targets(a.target || 'other', ctx)) { if (e.isPlayer) continue; e.type = a.into; e.def = this.spec.types[a.into]; e.team = teamOf(e.def); e.hp = e.maxHp = e.def.hp != null ? e.def.hp : defaultHp(e.def); this.setRadius(e); this.burst(e.x, e.y, e.def.color || '#fff', 12); }
          this.sfx('magic'); break;
        }
        case 'setVar': this.vars[a.name] = a.value; this.checkVars(); break;
        case 'addVar': this.vars[a.name] = (this.vars[a.name] || 0) + (a.amount == null ? 1 : a.amount); this.checkVars(); break;
        case 'setWorld': if (a.key === 'gravity') this.rt.gravity = Number(a.value) || 0; else if (a.key === 'timeScale') this.rt.timeScale = U.clamp(Number(a.value) || 1, 0.1, 4); break;
        case 'flipGravity': this.rt.gravity = -this.rt.gravity; this.rtGravityFlipped = !this.rtGravityFlipped; this.shake(6); this.banner('GRAVITY FLIPPED'); break;
        case 'slowmo': this.rt.slowmo = a.seconds || 2; this.rt.slowF = a.factor || 0.35; break;
        case 'explode': this.explode(x, y, a.radius || 90, a.damage == null ? 2 : a.damage, ctx.self); break;
        case 'knockback': for (const e of this.targets(a.target || 'player', ctx)) this.knock(e, x, y, a.power || 520); break;
        case 'launch': for (const e of this.targets(a.target || 'player', ctx)) { const g = U.sign(this.rt.gravity) || 1; e.vy = -(a.power || 900) * g; e.ground = false; if (!SIDE[this.spec.world.physics]) { e.vz = 420; } } this.sfx('bounce'); break;
        case 'paint': for (const e of this.targets(a.target || 'self', ctx)) e.tint = a.color || '#e5484d'; break;
        case 'growTail': if (this.player) this.player.tailLen += a.amount || 1; break;
        case 'addTime': this.timeLeft += a.seconds || 10; this.floater(x, y, '+' + (a.seconds || 10) + 's', '#8fd3ff'); break;
        case 'toggleEffect': { const fx = this.rt.effects; if (fx.has(a.effect)) fx.delete(a.effect); else fx.add(a.effect); if (this.onEffects) this.onEffects(fx, this.spec); break; }
        case 'split': {
          const src = ctx.self;
          if (!src || src.scale < 0.32) break;
          const into = a.into && this.spec.types[a.into] ? a.into : src.type;
          for (let i = 0; i < (a.count || 2); i++) {
            const e = this.spawnEntity(into, src.x + (U.random() - 0.5) * 10, src.y + (U.random() - 0.5) * 10, { scale: src.scale * 0.62, pop: 0.1 });
            if (e) { e.hp = e.maxHp = Math.max(1, Math.ceil(e.maxHp * 0.5)); this.setRadius(e); const ang = U.random() * Math.PI * 2; e.vx = Math.cos(ang) * 260; e.vy = Math.sin(ang) * 260; e.inv = 0.25; }
          }
          break;
        }
        case 'drop': if (this.spec.types[a.what] && U.random() < (a.chance == null ? 1 : a.chance)) { const e = this.spawnEntity(a.what, x, y); if (e) { e.vy = SIDE[this.spec.world.physics] ? -260 : 0; e.pop = 0.3; } } break;
        case 'powerup': if (this.player) { this.player.powers[a.kind || 'invincible'] = a.seconds || 6; this.applyPowers(); this.banner((a.kind || 'invincible').toUpperCase() + '!', 1.2); this.sfx('powerup'); } break;
        case 'music': if (!this.headless && VC.Sound && this.mode === 'play') VC.Sound.setMusic(a.mood === 'off' ? null : a.mood, this.spec.audio.tempo); break;
        case 'giveAbility': if (a.ability && !this.abilities[a.ability]) { this.abilities[a.ability] = VC.Engine.defaultAbility(a.ability, this.spec); this.banner('NEW ABILITY: ' + a.ability.toUpperCase(), 1.6); this.sfx('powerup'); } break;
        case 'freeze': for (const e of this.targets(a.target || 'other', ctx)) e.frozen = a.seconds || 2; this.sfx('magic'); break;
        case 'zoom': this.rt.zoom = U.clamp(a.amount || 1.4, 0.3, 3); break;
        default: break;
      }
    }
    checkVars() {
      const list = this.byTrig && this.byTrig.onVar;
      if (!list) return;
      for (const R of list) if (!R.fired && (this.vars[R.r.when.name] || 0) >= (R.r.when.atLeast == null ? 1 : R.r.when.atLeast)) this.runRule(R, {});
    }

    addScore(n, x, y) {
      if (this.player && this.player.powers.double) n *= 2;
      this.score += n;
      if (x != null && n) this.floater(x, y - 10, (n > 0 ? '+' : '') + n, n > 0 ? '#ffd166' : '#ff6b6b');
      this.emit('score', this.score);
      const list = this.byTrig && this.byTrig.onScore;
      if (list) for (const R of list) {
        const w = R.r.when;
        if (w.every) { const b = Math.floor(this.score / Math.max(1, w.atLeast)); if (b > R.bucket) { R.bucket = b; this.runRule(R, { x, y }); } }
        else if (this.score >= w.atLeast && !R.fired) this.runRule(R, { x, y });
      }
    }

    destroy(e, ctx) {
      if (!e || e.dead) return;
      if (e.isPlayer) { this.killPlayer(); return; }
      const d = e.def;
      if (d.role === 'collectible') {
        e.dead = true;
        const byPlayer = ctx && ((ctx.self && ctx.self.isPlayer) || (ctx.other && ctx.other.isPlayer));
        if (byPlayer) { this.stats.collected[e.type] = (this.stats.collected[e.type] || 0) + 1; this.stats.collectedTotal++; this.emit('collect', e); this.callMod('onEvent', 'collect', e); this.checkCollected(); }
        this.sparkle(e.x, e.y, d.color || '#ffd166');
        return;
      }
      this.kill(e, ctx && ctx.self);
    }
    checkCollected() {
      const list = this.byTrig && this.byTrig.onCollected;
      if (!list) return;
      for (const R of list) if (!R.fired && (this.stats.collected[R.r.when.of] || 0) >= (R.r.when.count || 1)) this.runRule(R, {});
    }

    hurt(e, n, src) {
      if (!e || e.dead || n <= 0) return;
      if (e.isPlayer) {
        if (this.mode === 'demo' || e.inv > 0 || e.powers.invincible || e.def.invulnerable || e.st.shielded || this.state !== 'running') { if (e.st.shielded) this.ring(e.x, e.y, '#8fd3ff', e.r * 1.6); return; }
        e.hp -= n; e.inv = 1.0; e.flash = 0.2;
        this.stats.hurt++;
        this.shake(10 * (this.rt.juice + 0.5) / 1.5); this.rt.flash = 0.18; this.rt.flashColor = '#ff3b3b';
        this.sfx('hurt');
        this.burst(e.x, e.y, '#ff6b6b', 10);
        if (src) this.knock(e, src.x, src.y, 420);
        this.fire('onHurt', { self: e, other: src, x: e.x, y: e.y }, e);
        this.callMod('onEvent', 'hurt', e);
        const hl = this.byTrig && this.byTrig.onHealth;
        if (hl) for (const R of hl) { if (R.armed && e.hp <= R.r.when.atMost) { R.armed = false; this.runRule(R, { self: e }); } }
        if (e.hp <= 0) this.killPlayer();
        return;
      }
      if (e.def.invulnerable || e.maxHp >= 99 || e.inv > 0) return;
      e.hp -= n; e.flash = 0.12;
      if (!e.def.projectile) this.floater(e.x, e.y - e.r, String(n), '#ffffff', 'dmg');
      this.fire('onHurt', { self: e, other: src, x: e.x, y: e.y }, e);
      if (e.hp <= 0) this.kill(e, src);
      else this.sfx('hit');
    }

    kill(e, src) {
      if (e.dead) return;
      if (e.isPlayer) return this.killPlayer();
      e.dead = true;
      const d = e.def;
      this.stats.killed[e.type] = (this.stats.killed[e.type] || 0) + 1;
      if (!d.projectile) {
        this.stats.kills++;
        const now = this.time;
        this.stats.deathsRecent.push(now);
        while (this.stats.deathsRecent.length && now - this.stats.deathsRecent[0] > 1) this.stats.deathsRecent.shift();
        if (this.stats.deathsRecent.length > this.lifetime.chain) { this.lifetime.chain = this.stats.deathsRecent.length; this.emit('chain', this.lifetime.chain); }
        const big = e.size > 60 || d.boss;
        this.burst(e.x, e.y, e.tint || d.color || '#ddd', big ? 50 : 16, { speed: big ? 420 : 240 });
        if (big) { this.ring(e.x, e.y, d.color || '#fff', e.r * 2.5); this.shake(16); if (d.boss) { this.rt.slowmo = 0.8; this.rt.slowF = 0.3; this.banner(U.human(e.type).toUpperCase() + ' DEFEATED'); this.emit('boss', e); } }
        if (this.rt.juice >= 2) this.hitstop = 0.035;
        this.sfx(big ? 'explode' : 'pop');
        for (const a of d.onDeath || []) this.act(a, { self: e, other: src, x: e.x, y: e.y });
        if (d.explosive || d.explode) this.explode(e.x, e.y, d.explode || 80, 2, e);
        this.fire('onDeath', { self: e, other: src, x: e.x, y: e.y }, e);
        this.callMod('onEvent', 'death', e);
        const kl = this.byTrig && this.byTrig.onKilled;
        if (kl) for (const R of kl) if (!R.fired && (this.stats.killed[R.r.when.of] || 0) >= (R.r.when.count || 1)) this.runRule(R, { x: e.x, y: e.y });
        this.emit('kill', e);
      } else if (d.explode) this.explode(e.x, e.y, d.explode, d.damage || 2, e);
    }

    killPlayer() {
      const p = this.player;
      if (!p || this.state !== 'running') return;
      if (this.mode === 'demo') { p.hp = p.maxHp; return; }
      this.fire('onDeath', { self: p, x: p.x, y: p.y }, p);
      this.burst(p.x, p.y, p.def.color || '#ffd166', 40, { speed: 380 });
      this.shake(18);
      if (p.lives > 1) {
        p.lives--; p.hp = p.maxHp; p.inv = 2;
        this.banner(p.lives + (p.lives === 1 ? ' LIFE LEFT' : ' LIVES LEFT'), 1.4);
        this.placePlayer();
        this.sfx('hurt');
        return;
      }
      this.lose();
    }

    win(text) {
      if (this.state !== 'running') return;
      this.state = 'won'; this.endText = text || 'YOU WIN';
      this.wonBy = this.depth > 0 && this.curRule ? this.curRule : null;
      this.endT = 0; this.confetti(); this.sfx('win');
      this.lifetime.wins++;
      this.emit('win', { time: this.time, score: this.score });
      this.callMod('onEvent', 'win', null);
    }
    lose(text) {
      if (this.state !== 'running') return;
      if (this.mode === 'demo') return;
      this.state = 'lost'; this.endText = text || 'GAME OVER';
      this.endT = 0; this.sfx('lose');
      this.lifetime.deaths++;
      this.emit('lose', { time: this.time, score: this.score });
      this.callMod('onEvent', 'lose', null);
    }
    nextLevel() {
      if (this.state !== 'running' || this.levelCooldown > 0) return;
      this.levelCooldown = 1;
      this.level++;
      this.spec.level = Object.assign({}, this.spec.level, { seed: (this.spec.level.seed || 1) + this.level * 31 });
      const keep = this.player;
      this.entities = []; this.bombs = [];
      this.buildLevel();
      if (keep) { this.player = keep; this.entities.push(keep); this.placePlayer(); keep.inv = 1.5; }
      this.spawnAll();
      this.contacts = new Set();
      this.banner('LEVEL ' + this.level, 1.8);
      this.sfx('powerup');
      this.fire('onLevel', { level: this.level });
      this.emit('level', this.level);
    }

    explode(x, y, radius, dmg, src) {
      this.ring(x, y, '#ffb86b', radius);
      this.burst(x, y, '#ff9a3c', 26, { speed: 360 });
      this.burst(x, y, '#555', 10, { speed: 160, kind: 'smoke' });
      this.shake(Math.min(24, 6 + radius / 10));
      this.sfx('explode');
      const srcTeam = src ? (src.isPlayer ? 'friend' : src.team) : null;
      for (const e of this.entities) {
        if (e.dead || e === src || e.def.projectile) continue;
        if (srcTeam === 'friend' && (e.isPlayer || e.team === 'friend')) continue;
        if (e.def.role === 'collectible') continue;
        const d = U.dist(x, y, e.x, e.y);
        if (d < radius + e.r) { this.hurt(e, dmg, src || { x, y }); if (!e.def.static) this.knock(e, x, y, 500 * (1 - d / (radius + e.r)) + 150); }
      }
    }
    knock(e, x, y, power) {
      if (e.def.static) return;
      const a = Math.atan2(e.y - y, e.x - x);
      e.vx += Math.cos(a) * power; e.vy += Math.sin(a) * power * (SIDE[this.spec.world.physics] ? 0.6 : 1);
      if (SIDE[this.spec.world.physics] && e.isPlayer) e.vy = Math.min(e.vy, -260 * (U.sign(this.rt.gravity) || 1));
      e.st.knockT = 0.18;
    }
    poof(e) { this.burst(e.x, e.y, (e.def && e.def.color) || '#bbb', 8, { speed: 120, kind: 'smoke' }); }

    applyPowers() {
      const p = this.player; if (!p) return;
      p.sizeMul = p.powers.giant ? 2 : p.powers.tiny ? 0.5 : 1;
      this.setRadius(p);
    }

    // ------------------------------------------------------------------ main step
    step(dt) {
      if (this.err) return;
      try { this._step(dt); } catch (e) { this.crash(e, 'engine'); }
    }
    crash(e, where) {
      console.error(e);
      this.err = { message: String(e && e.message || e), file: where === 'mods' ? 'src/mods.js' : null, where };
      this.emit('error', this.err);
    }
    _step(rawDt) {
      this.realTime += rawDt;
      this.frame++;
      this.budget = 4000;
      if (this.hitstop > 0) { this.hitstop -= rawDt; this.updateParticles(rawDt); return; }
      if (this.rt.slowmo > 0) this.rt.slowmo -= rawDt;
      const dt = rawDt * (this.rt.timeScale || 1) * (this.rt.slowmo > 0 ? this.rt.slowF : 1) * (this.slowtimeT > 0 ? 0.35 : 1);
      if (this.slowtimeT > 0) this.slowtimeT -= rawDt;
      if (this.rt.flash > 0) this.rt.flash -= rawDt;
      if (this.rt.tint) { this.rt.tint.t -= rawDt; if (this.rt.tint.t <= 0) this.rt.tint = null; }
      if (this.titleT > 0) this.titleT -= rawDt;
      if (this.hintT > 0 && this.mode === 'play') this.hintT -= rawDt;
      if (this.levelCooldown > 0) this.levelCooldown -= rawDt;
      this.messages = this.messages.filter((m) => (m.t -= rawDt) > 0);
      if (this.pendingRestart > 0) { this.pendingRestart -= rawDt; if (this.pendingRestart <= 0) { this.reset(); return; } }

      if (this.state === 'won' || this.state === 'lost') {
        this.endT = (this.endT || 0) + rawDt;
        if (this.mode === 'demo' && this.endT > 2.2) this.reset();
        this.updateParticles(rawDt);
        this.updateCamera(rawDt);
        this.consumeInput();
        return;
      }
      if (this.state !== 'running') { this.updateParticles(rawDt); this.consumeInput(); return; }

      this.time += dt;
      if (this.timeLeft > 0) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          const tl = this.byTrig && this.byTrig.onTimeUp;
          if (tl && tl.length) for (const R of tl) { if (!R.fired) this.runRule(R, {}); }
          else if (this.mode === 'play') this.lose('TIME UP');
          else this.reset();
        }
      }
      const ctrl = this.mode === 'play' ? (this.inputOverride ? this.inputOverride(this, dt) : this.readInput()) : this.autopilot(dt);
      if (this.player && !this.player.dead) this.updatePlayer(this.player, dt, ctrl);
      const ents = this.entities;
      for (let i = 0; i < ents.length; i++) { const e = ents[i]; if (!e.dead && !e.isPlayer) this.updateEntity(e, dt); }
      this.updateBombs(dt);
      this.collide(dt);
      this.updateRules(dt);
      this.updateSpawns(dt);
      if (this.modsFns.onUpdate) this.callMod('onUpdate', dt);
      // cleanup
      let w = 0;
      for (let i = 0; i < ents.length; i++) if (!ents[i].dead) ents[w++] = ents[i];
      ents.length = w;
      if (this.player && this.player.dead) this.player = null;
      this.updateParticles(rawDt);
      this.updateCamera(rawDt);
      this.consumeInput();
      // telemetry
      if (this.frame % 30 === 0) {
        let proj = 0; for (const e of ents) if (e.def.projectile) proj++;
        this.projCount = proj;
        if (ents.length > this.lifetime.maxEnt) this.lifetime.maxEnt = ents.length;
        if (proj > this.lifetime.maxProj) this.lifetime.maxProj = proj;
        this.emit('tick', { ents: ents.length, proj, time: this.time, score: this.score });
      }
    }

    consumeInput() { this.input.pressed = {}; this.input.released = {}; this.input.mouse.clicked = false; this.input.mouse.rclicked = false; }

    updateSpawns(dt) {
      for (const [name, def] of Object.entries(this.spec.types)) {
        const s = def.spawn;
        if (!s || !s.every || def.projectile) continue;
        this.spawnTimers = this.spawnTimers || {};
        this.spawnTimers[name] = (this.spawnTimers[name] || 0) + dt;
        if (this.spawnTimers[name] >= s.every) {
          this.spawnTimers[name] = 0;
          let alive = 0; for (const e of this.entities) if (e.type === name) alive++;
          const max = s.max || Math.max(12, (s.count || 4) * 3);
          if (alive < max) this.spawnGroup(name, Math.min(s.per || 1, max - alive), s.at);
        }
      }
    }

    updateRules(dt) {
      const bt = this.byTrig || {};
      for (const R of bt.onTimer || []) {
        const w = R.r.when;
        if (this.time < (w.start || 0)) continue;
        R.t += dt;
        const ev = Math.max(0.1, w.every || 1);
        if (R.t >= ev) { R.t -= ev; this.runRule(R, {}); }
      }
      for (const R of bt.onAfter || []) if (!R.fired && this.time >= (R.r.when.seconds || 0)) this.runRule(R, {});
      if (bt.onCleared) {
        for (const R of bt.onCleared) {
          let n = 0; for (const e of this.entities) if (!e.dead && this.matches(e, R.r.when.of)) n++;
          if (n > 0) { R.seen = true; if (R.r.once !== true) R.fired = 0; }
          else if (R.seen && !R.fired) {
            R.seen = false;
            // only count it as cleared if the player actually collected or defeated them
            const of = R.r.when.of;
            const done = (this.stats.collected[of] || 0) + (this.stats.killed[of] || 0) + (this.spec.types[of] ? 0 : this.stats.kills + this.stats.collectedTotal);
            if (done > 0) this.runRule(R, {});
          }
        }
      }
      if (bt.onHealth && this.player) for (const R of bt.onHealth) if (this.player.hp > R.r.when.atMost) R.armed = true;
      if (bt.onNear) {
        const now = new Set();
        for (const R of bt.onNear) {
          const w = R.r.when, d = w.distance || 90;
          for (const a of this.entities) {
            if (a.dead || !this.matches(a, w.a)) continue;
            for (const b of this.entities) {
              if (b === a || b.dead || !this.matches(b, w.b)) continue;
              if (Math.abs(a.x - b.x) > d + b.r || Math.abs(a.y - b.y) > d + b.r) continue;
              if (U.dist(a.x, a.y, b.x, b.y) < d + b.r) {
                const k = R.r.id + ':' + a.id + ':' + b.id; now.add(k);
                if (!this.nearPairs.has(k)) this.runRule(R, { self: a, other: b, x: b.x, y: b.y });
              }
            }
          }
        }
        this.nearPairs = now;
      }
      // falling out of the world
      const g = this.rt.gravity;
      for (const e of this.entities) {
        if (e.dead) continue;
        const out = e.y > this.H + 160 || (g < 0 && SIDE[this.spec.world.physics] && e.y < -160) || (this.openBottom && e.y > this.H + 30);
        if (!out) continue;
        if (e.def.projectile) { e.dead = true; continue; }
        if (e.def.behaviors && e.def.behaviors.some((b) => b.type === 'fall')) continue;
        const fl = (bt.onFall || []).filter((R) => this.matches(e, R.r.when.of || 'player'));
        if (fl.length) { fl.forEach((R) => this.runRule(R, { self: e, x: e.x, y: Math.min(e.y, this.H) })); if (!e.isPlayer) e.dead = true; else if (e.y > this.H + 160 || e.y < -160) { this.placePlayer(); } }
        else if (e.isPlayer) { if (this.mode === 'demo') this.placePlayer(); else { this.player.hp = 0; this.killPlayer(); if (this.player && this.state === 'running') this.placePlayer(); } }
        else e.dead = true;
      }
    }

    // ------------------------------------------------------------------ input
    readInput() {
      const k = this.input.keys, pr = this.input.pressed, m = this.input.mouse;
      let x = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
      let y = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0);
      const t = this.input.touch;
      if (t && t.active) { x = t.jx; y = t.jy; }
      const side = SIDE[this.spec.world.physics];
      const out = {
        x, y,
        jump: !!(k[' '] || (side && (k.w || k.arrowup)) || (t && t.a)),
        jumpPressed: !!(pr[' '] || (side && (pr.w || pr.arrowup)) || (t && t.aPressed)),
        shoot: !!(m.down || k.j || (t && t.b)),
        melee: !!(pr.k || m.rclicked || (t && t.bPressed && this.abilities.melee && !this.abilities.shoot)),
        dash: !!(pr.shift || (t && t.cPressed)),
        shield: !!k.f, bomb: !!pr.q, blink: !!pr.e, slow: !!pr.t,
        aim: null,
      };
      if (t) { t.aPressed = false; t.bPressed = false; t.cPressed = false; }
      if (m.inside && this.realTime - m.t < 4 && this.player) out.aim = Math.atan2(m.wy - this.player.y, m.wx - this.player.x);
      else if (t && t.active && (t.jx || t.jy)) out.aim = Math.atan2(t.jy, t.jx);
      if (pr.r && this.state !== 'running') this.reset();
      for (const key of Object.keys(pr)) if (key.length === 1 && this.byTrig && this.byTrig.onKey) this.fire('onKey', { key, self: this.player, x: this.player && this.player.x, y: this.player && this.player.y });
      if (m.clicked && this.byTrig && this.byTrig.onClick) {
        for (const e of this.entities) if (!e.dead && U.dist(e.x, e.y, m.wx, m.wy) < e.r + 8) { this.fire('onClick', { self: e, x: e.x, y: e.y }, e); break; }
      }
      return out;
    }

    autopilot(dt) {
      const p = this.player;
      const out = { x: 0, y: 0, jump: false, jumpPressed: false, shoot: false, melee: false, dash: false, aim: null };
      if (!p) return out;
      const st = p.st;
      st.apT = (st.apT || 0) - dt;
      const ph = this.spec.world.physics, side = SIDE[ph];
      if (st.apT <= 0 || !st.goal) {
        st.apT = 0.5 + U.random() * 0.6;
        let best = null, bd = 700;
        for (const e of this.entities) {
          if (e.dead || e.def.role !== 'collectible') continue;
          const d = U.dist(e.x, e.y, p.x, p.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) st.goal = { x: best.x, y: best.y };
        else if (this.lvl.goal && U.random() < 0.4 && side) st.goal = { x: this.lvl.goal.x, y: this.lvl.goal.y };
        else { const o = this.lvl.open; const q = o.length ? o[Math.floor(U.random() * o.length)] : { x: this.W / 2, y: this.H / 2 }; st.goal = side ? { x: q.x, y: p.y } : { x: q.x, y: q.y }; }
      }
      let gx = st.goal.x - p.x, gy = st.goal.y - p.y;
      const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
      let fx = 0, fy = 0, nearest = null, nd = 520;
      for (const e of this.entities) {
        if (e.dead || e.team !== 'enemy') continue;
        const d = U.dist(e.x, e.y, p.x, p.y);
        if (!e.def.projectile && d < nd) { nd = d; nearest = e; }
        const danger = e.def.projectile ? 110 : 170;
        if (d < danger) { fx -= (e.x - p.x) / (d + 1) * (danger - d) / danger; fy -= (e.y - p.y) / (d + 1) * (danger - d) / danger; }
      }
      out.x = gx + fx * 1.8; out.y = gy + fy * 1.8;
      const l = Math.hypot(out.x, out.y);
      if (l > 1) { out.x /= l; out.y /= l; }
      if (nearest) { out.aim = Math.atan2(nearest.y - p.y, nearest.x - p.x); out.shoot = true; if (nd < 90) out.melee = U.random() < 0.08; }
      if (side) {
        out.x = Math.abs(gx) > 0.15 ? U.sign(gx) : U.sign(out.x);
        if (ph === 'runner') out.x = 1;
        const ahead = p.x + U.sign(out.x || 1) * (p.r + 14);
        const g = U.sign(this.rt.gravity) || 1;
        const wallAhead = this.solidAt(ahead, p.y);
        const gapAhead = p.ground && !this.solidAt(ahead + U.sign(out.x || 1) * 10, p.y + g * (p.r + 12)) && !this.platformAt(ahead + U.sign(out.x || 1) * 10, p.y + g * (p.r + 12));
        const hazardAhead = [T.SPIKES, T.LAVA].includes(this.tileAt(ahead + U.sign(out.x || 1) * 20, p.y + g * (p.r + 4))) || [T.SPIKES, T.LAVA].includes(this.tileAt(ahead + U.sign(out.x || 1) * 20, p.y));
        const wantUp = st.goal.y < p.y - 80 && Math.abs(st.goal.x - p.x) < 160;
        out.jump = wallAhead || gapAhead || hazardAhead || wantUp || (nearest && nd < 120) || U.random() < 0.012;
        out.jumpPressed = out.jump && (p.ground || (p.st.apJ = (p.st.apJ || 0) + 1) % 12 === 0);
        if (this.abilities.flap) { out.jumpPressed = p.vy * g > 60 && (U.random() < 0.25 || p.y > this.H * 0.6); out.jump = out.jumpPressed; }
      }
      if (ph === 'snake') {
        const ts = this.TS, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const cur = p.st.dir || [1, 0];
        let bestD = null, bestScore = -1e9;
        for (const d of dirs) {
          if (d[0] === -cur[0] && d[1] === -cur[1]) continue;
          const nx = p.x + d[0] * ts, ny = p.y + d[1] * ts;
          let sc = -U.dist(nx, ny, st.goal.x, st.goal.y);
          if (this.solidAt(nx, ny) || nx < 0 || ny < 0 || nx > this.W || ny > this.H) sc -= 1e6;
          for (const s of p.tail) if (Math.abs(s.x - nx) < 2 && Math.abs(s.y - ny) < 2) sc -= 1e6;
          if (sc > bestScore) { bestScore = sc; bestD = d; }
        }
        if (bestD) { out.x = bestD[0]; out.y = bestD[1]; }
      }
      if (ph === 'paddle') {
        let ball = null;
        for (const e of this.entities) if (!e.dead && e.def.bouncy && !e.def.static && (!ball || e.y > ball.y)) ball = e;
        out.x = ball ? U.clamp((ball.x - p.x) / 40, -1, 1) : 0; out.y = 0;
      }
      if (ph === 'ship') {
        const want = Math.atan2(out.y, out.x);
        let da = want - p.angle; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        out.x = U.clamp(da * 2, -1, 1); out.y = Math.abs(da) < 0.8 ? -1 : 0;
        if (nearest) out.aim = p.angle;
      }
      if (ph === 'tank') {
        const want = Math.atan2(out.y, out.x);
        let da = want - p.angle; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        out.x = U.clamp(da * 2, -1, 1); out.y = Math.abs(da) < 1 ? -1 : 0;
      }
      if (this.abilities.dash && nearest && nd < 130 && U.random() < 0.05) out.dash = true;
      return out;
    }

    // ------------------------------------------------------------------ player
    updatePlayer(p, dt, c) {
      const ph = this.spec.world.physics, def = p.def, ab = this.abilities;
      p.age += dt;
      if (p.inv > 0) p.inv -= dt;
      if (p.flash > 0) p.flash -= dt;
      if (p.pop > 0) p.pop -= dt;
      for (const k of Object.keys(p.powers)) { p.powers[k] -= dt; if (p.powers[k] <= 0) { delete p.powers[k]; this.applyPowers(); } }
      if (p.frozen > 0) { p.frozen -= dt; c = { x: 0, y: 0 }; }
      const pw = p.powers;
      let sp = (def.speed || 230) * p.speedMul * (pw.speed ? 1.6 : 1);
      const tile = this.tileAt(p.x, p.y);
      const inWater = tile === T.WATER;
      if (inWater) sp *= 0.55;
      if (p.st.slowT > 0) { p.st.slowT -= dt; sp *= 0.5; }
      const onIce = tile === T.ICE || this.tileAt(p.x, p.y + p.r + 4) === T.ICE || p.st.slipT > 0;
      if (p.st.slipT > 0) p.st.slipT -= dt;
      if (p.st.knockT > 0) p.st.knockT -= dt;
      const grav = this.rt.gravity, gs = U.sign(grav) || 1;

      if (ph === 'snake') { this.snakeStep(p, dt, c, sp); }
      else if (SIDE[ph]) {
        const target = ph === 'runner' ? sp * (1 + U.clamp(c.x, -0.4, 0.4)) : c.x * sp;
        const accel = p.ground ? (onIce ? 2.5 : 16) : 7;
        if (p.st.knockT <= 0 || p.ground) p.vx += (target - p.vx) * Math.min(1, accel * dt);
        if (c.x) p.face = U.sign(c.x);
        const flying = ab.fly && c.jump;
        if (!pw.fly && !flying) p.vy += grav * dt * (inWater ? 0.35 : 1);
        if (inWater) p.vy *= 0.96;
        if (flying) { p.vy -= gs * (ab.fly.power || 2400) * dt; p.vy = U.clamp(p.vy, -420, 420); if (this.frame % 3 === 0) this.burst(p.x, p.y + gs * p.r, '#ffb86b', 1, { speed: 60, kind: 'smoke' }); }
        if (pw.fly) { p.vy += (c.y * sp - p.vy) * Math.min(1, 8 * dt); }
        p.vy = U.clamp(p.vy, -1600, 1600);
        if (p.ground) { p.coyote = 0.1; p.jumps = ab.jump && ab.jump.double ? (ab.jump.extra || 1) : 0; } else p.coyote -= dt;
        const jumpAb = ab.jump || (!ab.flap && !ab.fly ? { power: 600 } : null);
        if (c.jumpPressed) {
          const power = jumpAb ? (jumpAb.power || 620) : 0;
          if (ab.flap) { p.vy = -gs * (ab.flap.power || 460); this.sfx('jump'); this.fire('onJump', { self: p }); this.burst(p.x, p.y, '#ffffff', 4, { speed: 80 }); }
          else if (jumpAb && (p.ground || p.coyote > 0 || inWater)) { p.vy = -gs * power; p.ground = false; p.coyote = 0; p.st.jumpHeld = true; this.sfx('jump'); this.fire('onJump', { self: p, x: p.x, y: p.y }); this.callMod('onEvent', 'jump', p); p.squash = 0.18; this.burst(p.x, p.y + gs * p.r, '#ffffff', 5, { speed: 90, kind: 'smoke' }); }
          else if (jumpAb && ab.jump && ab.jump.wall && p.wallX) { p.vy = -gs * power * 0.95; p.vx = -p.wallX * sp * 1.3; p.face = -p.wallX; p.st.knockT = 0.15; this.sfx('jump'); this.fire('onJump', { self: p }); }
          else if (jumpAb && p.jumps > 0) { p.jumps--; p.vy = -gs * power * 0.92; this.sfx('jump'); this.ring(p.x, p.y + gs * p.r, '#ffffff', 22); this.fire('onJump', { self: p }); }
        }
        if (!c.jump && p.st.jumpHeld && p.vy * gs < 0) { p.vy *= 0.55; p.st.jumpHeld = false; }
        if (p.vy * gs > 0) p.st.jumpHeld = false;
      } else if (ph === 'ship') {
        p.angle += c.x * 4.2 * dt;
        if (c.y < 0) { p.vx += Math.cos(p.angle) * sp * 2.6 * dt; p.vy += Math.sin(p.angle) * sp * 2.6 * dt; if (this.frame % 2 === 0) this.burst(p.x - Math.cos(p.angle) * p.r, p.y - Math.sin(p.angle) * p.r, '#ffb86b', 1, { speed: 80, kind: 'spark', angle: p.angle + Math.PI }); }
        if (c.y > 0) { p.vx *= 0.94; p.vy *= 0.94; }
        p.vx *= 0.995; p.vy *= 0.995;
        const v = Math.hypot(p.vx, p.vy), max = sp * 1.7;
        if (v > max) { p.vx *= max / v; p.vy *= max / v; }
      } else if (ph === 'tank') {
        p.angle += c.x * 3.2 * dt;
        const v = -c.y * sp;
        p.vx += (Math.cos(p.angle) * v - p.vx) * Math.min(1, (onIce ? 2 : 10) * dt);
        p.vy += (Math.sin(p.angle) * v - p.vy) * Math.min(1, (onIce ? 2 : 10) * dt);
      } else if (ph === 'paddle') {
        p.vx += (c.x * sp * 1.4 - p.vx) * Math.min(1, 18 * dt); p.vy = 0;
      } else {
        // topdown / shmup
        let ix = c.x, iy = c.y;
        const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
        const accel = onIce ? 2.2 : 13;
        if (p.st.knockT <= 0) { p.vx += (ix * sp - p.vx) * Math.min(1, accel * dt); p.vy += (iy * sp - p.vy) * Math.min(1, accel * dt); }
        else { p.vx *= 0.9; p.vy *= 0.9; }
        if (ix || iy) { p.face = ix ? U.sign(ix) : p.face; p.moveAngle = Math.atan2(iy, ix); }
        if (ab.jump && c.jumpPressed && p.z <= 0) { p.vz = (ab.jump.power || 620) * 0.6; p.inv = Math.max(p.inv, 0.45); this.sfx('jump'); this.fire('onJump', { self: p }); }
      }
      // topdown hop arc
      if (!SIDE[ph] && (p.z > 0 || p.vz > 0)) { p.vz -= 1700 * dt; p.z = Math.max(0, p.z + p.vz * dt); if (p.z === 0) p.vz = 0; }

      // aim
      if (c.aim != null) p.aim = c.aim;
      else if (ph === 'ship' || ph === 'tank') p.aim = p.angle;
      else if (SIDE[ph]) p.aim = p.face > 0 ? 0 : Math.PI;
      else if (ph === 'shmup') p.aim = -Math.PI / 2;
      else if (p.moveAngle != null) p.aim = p.moveAngle;

      // dash
      p.cd.dash = (p.cd.dash || 0) - dt;
      if (ab.dash && c.dash && p.cd.dash <= 0) {
        const a = (c.x || c.y) && !SIDE[ph] ? Math.atan2(c.y, c.x) : SIDE[ph] ? (p.face > 0 ? 0 : Math.PI) : p.aim;
        const pow = ab.dash.power || 820;
        p.vx = Math.cos(a) * pow; p.vy = SIDE[ph] ? Math.min(p.vy, 0) * 0.3 : Math.sin(a) * pow;
        p.st.knockT = 0.16; p.inv = Math.max(p.inv, 0.25); p.cd.dash = ab.dash.cooldown || 0.8; p.st.dashT = 0.2;
        this.sfx('dash'); this.fire('onDash', { self: p }); this.callMod('onEvent', 'dash', p);
      }
      if (p.st.dashT > 0) { p.st.dashT -= dt; if (this.frame % 2 === 0) this.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.25, max: 0.25, size: p.r, color: def.color || '#ffd166', kind: 'ghost', glyph: def.glyph, face: p.face }); }

      // shield
      if (ab.shield) {
        p.cd.shield = (p.cd.shield || 0) - dt;
        if (c.shield && p.cd.shield <= 0) { p.st.shieldT = (p.st.shieldT || 0) + dt; p.st.shielded = p.st.shieldT < (ab.shield.duration || 2); if (!p.st.shielded) { p.cd.shield = ab.shield.cooldown || 2; p.st.shieldT = 0; } }
        else { if (p.st.shielded) p.cd.shield = (ab.shield.cooldown || 2) * Math.min(1, (p.st.shieldT || 0) / (ab.shield.duration || 2)); p.st.shielded = false; p.st.shieldT = 0; }
      }

      // shoot
      p.cd.shoot = (p.cd.shoot || 0) - dt;
      if (ab.shoot && (c.shoot || ab.shoot.auto) && p.cd.shoot <= 0 && p.frozen <= 0) {
        const s = ab.shoot;
        let aim = p.aim;
        if (s.aim === 'up' || (ph === 'shmup' && s.aim !== 'mouse')) aim = -Math.PI / 2 * gs;
        else if (s.aim === 'auto') { const t = this.nearest(p, (e) => e.team === 'enemy' && !e.def.projectile && e.def.role !== 'hazard', 650); if (t) aim = Math.atan2(t.y - p.y, t.x - p.x); else if (s.auto) aim = null; }
        else if (s.aim === 'facing' && SIDE[ph]) aim = p.face > 0 ? 0 : Math.PI;
        if (aim != null) {
          const n = U.clamp(s.count || 1, 1, 24), spread = (s.spread || (n > 1 ? 30 : 0)) * Math.PI / 180;
          for (let i = 0; i < n; i++) {
            const a = aim + (n > 1 ? -spread / 2 + spread * i / (n - 1) : 0) + (U.random() - 0.5) * (s.jitter || 0.04);
            this.shoot(p, s.projectile || 'bullet', a);
          }
          p.cd.shoot = 1 / U.clamp((s.rate || 4) * (pw.rapidfire ? 3 : 1), 0.2, 40);
          this.stats.shots++;
          this.sfx(projSound(s.projectile));
          this.fire('onShoot', { self: p, x: p.x, y: p.y });
          if (this.rt.juice >= 1 && !s.auto) this.shake(1.5);
        }
      }
      // melee
      p.cd.melee = (p.cd.melee || 0) - dt;
      if (ab.melee && (c.melee || (c.shoot && !ab.shoot)) && p.cd.melee <= 0) {
        const m = ab.melee, reach = (m.reach || 60) + p.r, dmg = m.damage || 2;
        p.cd.melee = 1 / (m.rate || 3);
        p.st.swing = { t: 0.18, a: p.aim, reach };
        this.sfx('swing');
        for (const e of this.entities) {
          if (e.dead || e === p || e.def.role === 'collectible') continue;
          if (e.team !== 'enemy' && !(e.def.role === 'obstacle' && e.maxHp < 99)) continue;
          const d = U.dist(p.x, p.y, e.x, e.y);
          if (d > reach + e.r) continue;
          let da = Math.atan2(e.y - p.y, e.x - p.x) - p.aim; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
          if (Math.abs(da) < 1.2 || d < p.r + e.r) { if (e.def.projectile && e.team === 'enemy') { e.dead = true; this.sparkle(e.x, e.y, '#fff'); continue; } this.hurt(e, dmg, p); this.knock(e, p.x, p.y, 420); }
        }
      }
      if (p.st.swing) { p.st.swing.t -= dt; if (p.st.swing.t <= 0) p.st.swing = null; }
      // bomb
      p.cd.bomb = (p.cd.bomb || 0) - dt;
      if (ab.bomb && c.bomb && p.cd.bomb <= 0) { this.bombs.push({ x: p.x, y: p.y, t: ab.bomb.fuse || 1.4, r: ab.bomb.radius || 110 }); p.cd.bomb = ab.bomb.cooldown || 1.2; this.sfx('blip'); }
      // blink
      p.cd.blink = (p.cd.blink || 0) - dt;
      if (ab.blink && c.blink && p.cd.blink <= 0) {
        const dist = ab.blink.distance || 220, a = p.aim;
        let tx = p.x, ty = p.y;
        for (let s = dist; s > 20; s -= 20) { const nx = p.x + Math.cos(a) * s, ny = p.y + Math.sin(a) * s; if (!this.solidAt(nx, ny)) { tx = nx; ty = ny; break; } }
        this.ring(p.x, p.y, '#bb8fce', 30); p.x = tx; p.y = ty; this.ring(p.x, p.y, '#bb8fce', 30); p.cd.blink = ab.blink.cooldown || 1; p.inv = Math.max(p.inv, 0.2); this.sfx('magic');
      }
      // bullet time
      p.cd.slow = (p.cd.slow || 0) - dt;
      if (ab.slowtime && c.slow && p.cd.slow <= 0) { this.slowtimeT = ab.slowtime.duration || 2.5; p.cd.slow = ab.slowtime.cooldown || 6; this.sfx('magic'); }
      // regen
      if (ab.regen) { p.st.regen = (p.st.regen || 0) + dt; if (p.st.regen >= (ab.regen.every || 4)) { p.st.regen = 0; if (p.hp < p.maxHp) { p.hp++; this.floater(p.x, p.y - p.r, '+1 ♥', '#7ee08a'); } } }
      // magnet
      const mr = ab.magnet ? ab.magnet.range || 200 : pw.magnet ? 300 : 0;
      if (mr) for (const e of this.entities) { if (e.dead || e.def.role !== 'collectible') continue; const d = U.dist(e.x, e.y, p.x, p.y); if (d < mr && d > 1) { const f = 900 * dt * (1 - d / mr) + 80 * dt; e.x += (p.x - e.x) / d * f * 3; e.y += (p.y - e.y) / d * f * 3; } }

      if (ph !== 'snake') this.integrate(p, dt, true);
      if (ph === 'paddle') { p.y = this.H - 46; p.x = U.clamp(p.x, (p.def.size || 28) * 2, this.W - (p.def.size || 28) * 2); }
      if (ph === 'shmup') { p.x = U.clamp(p.x, p.r, this.W - p.r); p.y = U.clamp(p.y, p.r, this.H - p.r); }
      // tail
      if (p.tailLen > 0 && ph !== 'snake') {
        const last = p.tail[0];
        if (!last || U.dist(last.x, last.y, p.x, p.y) > p.r * 0.9) { p.tail.unshift({ x: p.x, y: p.y }); if (p.tail.length > p.tailLen) p.tail.length = p.tailLen; }
      }
      if (p.st.shielded && this.frame % 4 === 0) this.ring(p.x, p.y, '#8fd3ff', p.r * 1.5, 0.15);
      this.tileEffects(p, dt);
    }

    snakeStep(p, dt, c, sp) {
      const ts = this.TS;
      const cur = p.st.dir || [1, 0];
      let want = p.st.want || cur;
      if (c.x && !c.y) want = [U.sign(c.x), 0]; else if (c.y && !c.x) want = [0, U.sign(c.y)];
      if (!(want[0] === -cur[0] && want[1] === -cur[1])) p.st.want = want;
      p.st.t = (p.st.t || 0) + dt;
      const stepT = ts / Math.max(60, sp);
      if (p.st.t < stepT) { p.renderLerp = p.st.t / stepT; return; }
      p.st.t = 0; p.renderLerp = 0;
      p.st.dir = p.st.want || cur;
      p.st.px = p.x; p.st.py = p.y;
      p.tail.unshift({ x: p.x, y: p.y });
      while (p.tail.length > p.tailLen) p.tail.pop();
      p.x += p.st.dir[0] * ts; p.y += p.st.dir[1] * ts;
      p.face = p.st.dir[0] || p.face;
      p.aim = Math.atan2(p.st.dir[1], p.st.dir[0]);
      if (this.spec.world.bounds === 'wrap') { p.x = (p.x + this.W) % this.W; p.y = (p.y + this.H) % this.H; }
      const out = p.x < 0 || p.y < 0 || p.x > this.W || p.y > this.H;
      let dead = out || this.solidAt(p.x, p.y);
      if (!dead) for (let i = 1; i < p.tail.length; i++) if (Math.abs(p.tail[i].x - p.x) < 2 && Math.abs(p.tail[i].y - p.y) < 2) { dead = true; break; }
      if (dead) {
        if (this.mode === 'demo' || p.inv > 0) { p.x = U.clamp(p.st.px, ts / 2, this.W - ts / 2); p.y = U.clamp(p.st.py, ts / 2, this.H - ts / 2); p.st.dir = [-p.st.dir[1], p.st.dir[0]]; p.st.want = p.st.dir; if (this.mode === 'demo' && p.tail.length > 30) p.tail.length = 6; }
        else { this.shake(12); p.hp = 0; this.killPlayer(); }
      }
    }

    shoot(owner, projType, angle, opts) {
      let def = this.spec.types[projType];
      let nProj = 0; for (const e of this.entities) if (e.def.projectile) nProj++;
      if (nProj > MAX_PROJ) return null;
      const r0 = owner.r + 4;
      const e = this.spawnEntity(def ? projType : '__proj', owner.x + Math.cos(angle) * r0, owner.y + Math.sin(angle) * r0, { fallbackProj: true });
      if (!e) return null;
      e.team = owner.isPlayer || owner.team === 'friend' ? 'friend' : owner.team === 'neutral' ? 'neutral' : 'enemy';
      e.owner = owner.id; e.ownerRef = owner;
      def = e.def;
      const sp = (opts && opts.speed) || def.speed || 560;
      e.vx = Math.cos(angle) * sp + (owner.isPlayer ? owner.vx * 0.2 : 0);
      e.vy = Math.sin(angle) * sp + (owner.isPlayer ? owner.vy * 0.2 : 0);
      e.angle = angle;
      e.pop = 0;
      if (def.pierce) e.hitSet = new Set();
      return e;
    }

    // ------------------------------------------------------------------ entities
    updateEntity(e, dt) {
      const d = e.def;
      e.age += dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.inv > 0) e.inv -= dt;
      if (e.pop > 0) e.pop -= dt;
      if (d.projectile) return this.updateProjectile(e, dt);
      if (e.frozen > 0) { e.frozen -= dt; e.vx *= 0.8; e.vy *= 0.8; return; }
      const fx = d.effects || [];
      if (fx.length && !this.headless) this.ambientFx(e, fx, dt);
      if (d.static) { this.runStaticBehaviors(e, dt); return; }
      const ph = this.spec.world.physics, side = SIDE[ph] && !d.flying;
      const sp = (d.speed == null ? 80 : d.speed) * e.speedMul;
      let wx = 0, wy = 0, steering = false, sleeping = false;
      if (e.st.knockT > 0) e.st.knockT -= dt;
      const P = this.player;
      for (let bi = 0; bi < (d.behaviors || []).length; bi++) {
        const b = d.behaviors[bi];
        const bsp = b.speed != null ? b.speed * e.speedMul : sp;
        switch (b.type) {
          case 'sleep': {
            if (!e.st.awake) {
              if (P && U.dist(P.x, P.y, e.x, e.y) < (b.wake || 170)) { e.st.awake = true; this.floater(e.x, e.y - e.r - 6, '!', '#ffd166'); this.sfx('blip'); }
              else { sleeping = true; if (this.frame % 50 === (e.id % 50)) this.floater(e.x + 8, e.y - e.r, 'z', '#a0a8c0', 'z'); }
            }
            break;
          }
          case 'wander': {
            if (sleeping) break;
            e.st.wa = (e.st.wa == null ? U.random() * 6.28 : e.st.wa) + (U.random() - 0.5) * (b.turn || 3) * dt;
            if (e.st.hitT > 0) { e.st.wa += Math.PI * 0.6; e.st.hitT = 0; }
            wx += Math.cos(e.st.wa) * bsp * 0.6; wy += Math.sin(e.st.wa) * bsp * 0.6; steering = true;
            break;
          }
          case 'chase': case 'swarm': case 'eat': {
            if (sleeping) break;
            let t;
            if (b.type === 'eat') t = this.cachedTarget(e, bi, b.target || 'collectible', 900);
            else t = this.cachedTarget(e, bi, b.target || 'player', b.range || 0);
            if (t && b.sight) {
              const dd = U.dist(t.x, t.y, e.x, e.y);
              let da = Math.atan2(t.y - e.y, t.x - e.x) - (e.st.look || 0); while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
              const sees = (dd < b.sight && Math.abs(da) < (b.cone || 55) * Math.PI / 180) || dd < 60 || (e.st.alertT > 0 && dd < b.sight * 1.6);
              if (sees) { if (!(e.st.alertT > 0)) { this.floater(e.x, e.y - e.r - 8, '!', '#ff5a5a'); this.sfx('blip'); } e.st.alertT = 2; } else t = null;
              if (e.st.alertT > 0) e.st.alertT -= dt;
            }
            if (t) {
              let tx = t.x, ty = t.y;
              if (b.lead && t.vx != null) { tx += t.vx * 0.4; ty += t.vy * 0.4; }
              const dx = tx - e.x, dy = ty - e.y, l = Math.hypot(dx, dy) || 1;
              wx += dx / l * bsp; wy += dy / l * bsp; steering = true;
              if (b.type === 'swarm') {
                const nb = this.neighbors(e, 70);
                for (const o of nb) { if (o.type !== e.type) continue; const ox = e.x - o.x, oy = e.y - o.y, ol = Math.hypot(ox, oy) || 1; wx += ox / ol * bsp * 0.6; wy += oy / ol * bsp * 0.6; }
              }
              if (side && e.ground && ty < e.y - 60 && Math.abs(dx) < 140 && U.random() < 0.03) { e.vy = -(560) * (U.sign(this.rt.gravity) || 1); e.ground = false; }
            }
            break;
          }
          case 'flee': {
            const t = this.cachedTarget(e, bi, b.from || 'player', 0);
            if (t) { const dx = e.x - t.x, dy = e.y - t.y, l = Math.hypot(dx, dy) || 1; const range = b.range || 260; if (l < range) { wx += dx / l * bsp * 1.1; wy += dy / l * bsp * 1.1; steering = true; } }
            break;
          }
          case 'kite': {
            const t = this.cachedTarget(e, bi, b.target || 'player', 0);
            if (t) {
              const dx = e.x - t.x, dy = e.y - t.y, l = Math.hypot(dx, dy) || 1, want = b.distance || 240;
              const k = l < want ? 1 : l > want + 120 ? -1 : 0;
              wx += dx / l * bsp * k + (-dy / l) * bsp * 0.5; wy += dy / l * bsp * k + (dx / l) * bsp * 0.5; steering = true;
            }
            break;
          }
          case 'patrol': {
            if (sleeping) break;
            e.st.dir = e.st.dir || 1;
            const axis = b.axis || (side ? 'x' : (e.id % 2 ? 'x' : 'y'));
            if (e.st.hitT > 0) { e.st.dir *= -1; e.st.hitT = 0; }
            if (b.distance) { e.st.pd = (e.st.pd || 0) + bsp * dt; if (e.st.pd > b.distance) { e.st.pd = 0; e.st.dir *= -1; } }
            if (side && e.ground) {
              const g = U.sign(this.rt.gravity) || 1;
              const ax = e.x + e.st.dir * (e.r + 6), ay = e.y + g * (e.r + 10);
              if (!this.solidAt(ax, ay) && !this.platformAt(ax, ay)) e.st.dir *= -1;
            }
            if (axis === 'x') wx += e.st.dir * bsp; else wy += e.st.dir * bsp;
            steering = true;
            break;
          }
          case 'orbit': {
            const t = this.cachedTarget(e, bi, b.target || 'player', 0);
            if (t) {
              const R = b.radius || 140;
              e.st.oa = (e.st.oa == null ? Math.atan2(e.y - t.y, e.x - t.x) : e.st.oa) + (b.speed || bsp) / R * dt;
              const tx = t.x + Math.cos(e.st.oa) * R, ty = t.y + Math.sin(e.st.oa) * R;
              wx += (tx - e.x) * 6; wy += (ty - e.y) * 6; steering = true;
            }
            break;
          }
          case 'follow': {
            const t = this.cachedTarget(e, bi, b.target || 'player', 0);
            if (t) {
              const dd = U.dist(t.x, t.y, e.x, e.y), want = b.distance || 70;
              if (dd > 900) { e.x = t.x - 30; e.y = t.y - 30; }
              if (dd > want) { wx += (t.x - e.x) / dd * bsp * Math.min(1.5, dd / want / 2); wy += (t.y - e.y) / dd * bsp * Math.min(1.5, dd / want / 2); steering = true; }
            }
            break;
          }
          case 'guard': {
            const foe = this.cachedTarget(e, bi, e.team === 'enemy' ? 'player' : 'enemy', b.range || 320);
            if (foe) { const dx = foe.x - e.x, dy = foe.y - e.y, l = Math.hypot(dx, dy) || 1; wx = dx / l * bsp * 1.2; wy = dy / l * bsp * 1.2; steering = true; e.st.foe = foe; }
            else e.st.foe = null;
            break;
          }
          case 'mimic': { const pl = this.player; if (pl) { wx += pl.vx * 0.9; wy += pl.vy * 0.9; steering = true; } break; }
          case 'charge': {
            e.st.ch = (e.st.ch || 0) + dt;
            if (e.st.chT > 0) { e.st.chT -= dt; wx = e.st.cvx; wy = e.st.cvy; steering = true; if (this.frame % 2 === 0) this.burst(e.x, e.y, d.color || '#fff', 1, { speed: 40, kind: 'smoke' }); }
            else if (e.st.ch > (b.every || 3)) {
              const t = this.cachedTarget(e, bi, b.target || 'player', 520);
              if (t) {
                if (!e.st.tele) { e.st.tele = 0.45; e.flash = 0.45; }
                e.st.tele -= dt;
                if (e.st.tele <= 0) { const a = Math.atan2(t.y - e.y, t.x - e.x), cs = b.speed || bsp * 4.5; e.st.cvx = Math.cos(a) * cs; e.st.cvy = Math.sin(a) * cs; e.st.chT = 0.5; e.st.ch = 0; e.st.tele = 0; this.sfx('dash'); }
                else { wx = 0; wy = 0; steering = true; }
              }
            }
            break;
          }
          case 'zigzag': { const a = e.age * (b.freq || 7); wx += Math.cos(a + e.id) * (b.amount || 0.9) * bsp; wy += Math.sin(a * 1.3 + e.id) * (b.amount || 0.9) * bsp; steering = true; break; }
          case 'wave': { e.st.wy = Math.sin(e.age * (b.freq || 3) + e.id) * (b.amount || 60); wy += Math.cos(e.age * (b.freq || 3) + e.id) * (b.amount || 60) * (b.freq || 3) * 0.5; break; }
          case 'hop': {
            e.st.hop = (e.st.hop || U.random() * 2) - dt;
            if (e.st.hop <= 0) {
              e.st.hop = b.every || (1 + U.random());
              if (side) { if (e.ground) { e.vy = -(b.power || 480) * (U.sign(this.rt.gravity) || 1); e.ground = false; e.squash = 0.15; } }
              else { e.vz = b.power ? b.power * 0.6 : 300; }
            }
            break;
          }
          case 'drift': { steering = false; if (!e.vx && !e.vy) { const a = U.random() * 6.28; e.vx = Math.cos(a) * bsp; e.vy = Math.sin(a) * bsp; } e.st.drift = true; break; }
          case 'bounce': { e.st.bouncer = b.speed || bsp || 300; break; }
          case 'fall': { e.st.fall = b.speed || bsp || 200; break; }
          case 'spin': e.angle += (b.speed || 4) * dt; break;
          case 'warp': {
            e.st.warp = (e.st.warp || U.random() * (b.every || 3)) + dt;
            if (e.st.warp > (b.every || 3)) { e.st.warp = 0; this.ring(e.x, e.y, '#bb8fce', 26); const p = this.findSpot(P && U.random() < 0.5 ? 'near-player' : 'random', d); e.x = p.x; e.y = p.y; this.ring(e.x, e.y, '#bb8fce', 26); }
            break;
          }
          case 'swell': e.scale = Math.min(b.max || 4, e.scale + (b.rate || 0.05) * dt); this.setRadius(e); break;
          case 'magnet': {
            const R = b.range || 260, sel = b.target || 'player';
            for (const o of this.neighbors(e, R)) { if (!this.matches(o, sel) || o.def.static) continue; const dd = U.dist(o.x, o.y, e.x, e.y) || 1; const f = (b.strength || 300) * (1 - dd / R) * dt; o.vx += (e.x - o.x) / dd * f * 4; o.vy += (e.y - o.y) / dd * f * 4; }
            break;
          }
          case 'aura': {
            e.st.aura = (e.st.aura || 0) + dt;
            if (e.st.aura > (b.every || 0.6)) { e.st.aura = 0; for (const o of this.neighbors(e, b.radius || 90)) if (hostile(e.team, o.isPlayer ? 'friend' : o.team) && !o.def.projectile) this.hurt(o, b.damage || 1, e); }
            break;
          }
          case 'shoot': case 'spawner': break;
          default: break;
        }
      }
      // ranged attacks & spawners
      this.runStaticBehaviors(e, dt, sleeping);
      // integrate
      if (e.st.bouncer) {
        const v = Math.hypot(e.vx, e.vy) || 1;
        e.vx = e.vx / v * e.st.bouncer; e.vy = e.vy / v * e.st.bouncer;
        if (Math.abs(e.vy) < e.st.bouncer * 0.18) e.vy = U.sign(e.vy || 1) * e.st.bouncer * 0.18;
      } else if (e.st.fall) {
        e.vy = e.st.fall; e.vx *= 0.98;
        if (e.y > this.H + 60) { e.y = -40; e.x = 30 + U.random() * (this.W - 60); }
      } else if (e.st.drift) {
        // keep velocity
      } else if (steering) {
        const l = Math.hypot(wx, wy), max = sp * 1.6;
        if (l > max && !e.st.chT) { wx *= max / l; wy *= max / l; }
        const k = Math.min(1, (e.st.knockT > 0 ? 1.5 : 7) * dt);
        e.vx += (wx - e.vx) * k;
        if (!side) e.vy += (wy - e.vy) * k;
      } else if (!side) { e.vx *= 0.9; e.vy *= 0.9; }
      else { e.vx *= e.ground ? 0.85 : 0.99; }
      if (side && !e.st.fall && !e.st.bouncer) { e.vy += this.rt.gravity * dt * (d.gravity == null ? 1 : d.gravity); e.vy = U.clamp(e.vy, -1600, 1600); }
      if (Math.abs(e.vx) > 4) e.face = U.sign(e.vx);
      if (b_lookAngle(e)) e.st.look = Math.atan2(e.vy, e.vx);
      if (!SIDE[ph] && (e.z > 0 || e.vz > 0)) { e.vz -= 1500 * dt; e.z = Math.max(0, e.z + e.vz * dt); if (e.z === 0) e.vz = 0; }
      this.integrate(e, dt, false);
      if (d.trail || (this.rt.effects.has('trails') && !d.static)) this.pushTrail(e);
      if (e.team === 'enemy' || d.role === 'critter') this.tileEffects(e, dt);
    }

    runStaticBehaviors(e, dt, sleeping) {
      const d = e.def;
      for (let bi = 0; bi < (d.behaviors || []).length; bi++) {
        const b = d.behaviors[bi];
        if (b.type === 'shoot' && !sleeping) {
          e.cd['s' + bi] = (e.cd['s' + bi] == null ? U.random() * 1.5 : e.cd['s' + bi]) - dt;
          if (e.cd['s' + bi] > 0) continue;
          const rate = b.rate || (d.boss ? 1.2 : 0.55);
          e.cd['s' + bi] = 1 / Math.max(0.05, rate);
          const at = b.at || (e.team === 'friend' ? 'enemy' : 'player');
          const proj = b.what || b.projectile || 'bullet';
          const range = b.range || (d.boss ? 900 : 560);
          let base = null;
          if (at === 'player' || at === 'enemy') {
            const t = at === 'player' ? (this.player && U.dist(this.player.x, this.player.y, e.x, e.y) < range ? this.player : null) : this.nearest(e, (o) => o.team === (e.team === 'friend' ? 'enemy' : 'friend') && !o.def.projectile, range);
            if (!t) continue;
            base = Math.atan2(t.y - e.y, t.x - e.x);
          } else if (at === 'down') base = Math.PI / 2;
          else if (at === 'up') base = -Math.PI / 2;
          else if (at === 'forward') base = Math.atan2(e.vy, e.vx || e.face);
          else if (at === 'random') base = U.random() * Math.PI * 2;
          else if (at === 'spiral') { e.st.spiral = (e.st.spiral || 0) + 0.45; base = e.st.spiral; }
          if (at === 'radial' || at === 'spiral') {
            const n = b.count || (at === 'spiral' ? 4 : 12);
            for (let i = 0; i < n; i++) this.shoot(e, proj, (base || 0) + i * Math.PI * 2 / n);
          } else {
            const n = b.count || 1, spread = (b.spread || (n > 1 ? 40 : 0)) * Math.PI / 180;
            for (let i = 0; i < n; i++) this.shoot(e, proj, base + (n > 1 ? -spread / 2 + spread * i / (n - 1) : 0));
          }
          if (this.player && U.dist(this.player.x, this.player.y, e.x, e.y) < 600) this.sfx(projSound(proj), 0.5);
        } else if (b.type === 'spawner') {
          e.cd['p' + bi] = (e.cd['p' + bi] == null ? (b.every || 4) * U.random() : e.cd['p' + bi]) - dt;
          if (e.cd['p' + bi] > 0) continue;
          e.cd['p' + bi] = b.every || 4;
          const what = b.what && this.spec.types[b.what] ? b.what : null;
          if (!what) continue;
          let n = 0; for (const o of this.entities) if (o.type === what) n++;
          if (n >= (b.max || 30)) continue;
          for (let i = 0; i < (b.count || 1); i++) { const o = this.spawnEntity(what, e.x + (U.random() - 0.5) * e.r, e.y - e.r * 0.5); if (o) { o.vy = -150; o.vx = (U.random() - 0.5) * 200; } }
          this.ring(e.x, e.y, d.color || '#bb8fce', e.r * 1.4);
        } else if (b.type === 'spin' && d.static) e.angle += (b.speed || 3) * dt;
        else if (b.type === 'aura' && d.static) {
          e.st.aura = (e.st.aura || 0) + dt;
          if (e.st.aura > (b.every || 0.6)) { e.st.aura = 0; for (const o of this.neighbors(e, b.radius || 90)) if (hostile(e.team, o.isPlayer ? 'friend' : o.team) && !o.def.projectile) this.hurt(o, b.damage || 1, e); }
        }
      }
    }

    updateProjectile(e, dt) {
      const d = e.def;
      e.life -= dt;
      if (e.life <= 0) { e.dead = true; if (d.explode) this.explode(e.x, e.y, d.explode, d.damage || 2, e.ownerRef); return; }
      if (d.homing || (d.behaviors || []).some((b) => b.type === 'homing')) {
        const sel = e.team === 'friend' ? (o) => o.team === 'enemy' && !o.def.projectile && o.def.role !== 'hazard' : (o) => o.isPlayer;
        const t = e.st.ht && !e.st.ht.dead && e.age % 0.3 > 0.05 ? e.st.ht : (e.st.ht = this.nearest(e, sel, 600));
        if (t) {
          const want = Math.atan2(t.y - e.y, t.x - e.x), cur = Math.atan2(e.vy, e.vx), sp = Math.hypot(e.vx, e.vy);
          let da = want - cur; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
          const na = cur + U.clamp(da, -5 * dt, 5 * dt);
          e.vx = Math.cos(na) * sp; e.vy = Math.sin(na) * sp;
        }
      }
      if (d.boomerang && e.ownerRef && e.age > (d.lifetime || 1.8) * 0.35) {
        const o = e.ownerRef, dx = o.x - e.x, dy = o.y - e.y, l = Math.hypot(dx, dy) || 1, sp = Math.hypot(e.vx, e.vy);
        e.vx += (dx / l * sp - e.vx) * Math.min(1, 4 * dt); e.vy += (dy / l * sp - e.vy) * Math.min(1, 4 * dt);
        if (l < o.r + 10) { e.dead = true; return; }
        e.life = Math.max(e.life, 0.2);
      }
      if (d.gravity && SIDE[this.spec.world.physics]) e.vy += this.rt.gravity * d.gravity * dt;
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (!(d.effects || []).includes('spin')) e.angle = Math.atan2(e.vy, e.vx); else e.angle += 12 * dt;
      if (d.trail || d.shape === 'line' || (d.effects || []).includes('trail') || this.rt.effects.has('trails')) this.pushTrail(e, 5);
      if (!d.ghost && this.solidAt(e.x, e.y)) {
        if (d.bouncy && (e.st.b = (e.st.b || 0) + 1) < 4) { this.reflectTile(e); this.sfx('bounce', 0.3); }
        else { e.dead = true; this.burst(e.x, e.y, d.color || '#fff', 4, { speed: 120 }); if (d.explode) this.explode(e.x, e.y, d.explode, d.damage || 2, e.ownerRef); }
      }
      if (this.spec.world.bounds === 'wrap') { if (e.x < 0) e.x += this.W; if (e.x > this.W) e.x -= this.W; if (e.y < 0) e.y += this.H; if (e.y > this.H) e.y -= this.H; }
      else if (e.x < -60 || e.y < -60 || e.x > this.W + 60 || e.y > this.H + 60) e.dead = true;
    }
    reflectTile(e) {
      const ts = this.TS;
      const px = e.x - e.vx / 60, py = e.y - e.vy / 60;
      const hx = this.solidAt(e.x, py), hy = this.solidAt(px, e.y);
      if (hx || (!hx && !hy)) e.vx = -e.vx;
      if (hy || (!hx && !hy)) e.vy = -e.vy;
      e.x = px; e.y = py;
      void ts;
    }

    pushTrail(e, n) {
      if (this.headless) return;
      e.trail = e.trail || [];
      e.trail.unshift({ x: e.x, y: e.y });
      if (e.trail.length > (n || 9)) e.trail.length = n || 9;
    }
    ambientFx(e, fx, dt) {
      if (this.particles.length > 1200) return;
      if (fx.includes('sparkle') && U.random() < dt * 3) this.particles.push({ x: e.x + (U.random() - 0.5) * e.r * 2, y: e.y + (U.random() - 0.5) * e.r * 2, vx: 0, vy: -20, life: 0.6, max: 0.6, size: 3, color: '#fff7c2', kind: 'star' });
      if (fx.includes('embers') && U.random() < dt * 8) this.particles.push({ x: e.x + (U.random() - 0.5) * e.r, y: e.y, vx: (U.random() - 0.5) * 30, vy: -60 - U.random() * 60, life: 0.8, max: 0.8, size: 2.5, color: '#ff8a3c', kind: 'dot' });
      if (fx.includes('music') && U.random() < dt * 1.2) this.particles.push({ x: e.x, y: e.y - e.r, vx: (U.random() - 0.5) * 30, vy: -40, life: 1.2, max: 1.2, size: 14, color: '#c9a7ff', kind: 'text', text: U.random() < 0.5 ? '♪' : '♫' });
    }

    // ------------------------------------------------------------------ physics
    tileAt(x, y) { const ts = this.TS; return this.grid.get(Math.floor(x / ts), Math.floor(y / ts)); }
    solidAt(x, y) { const v = this.tileAt(x, y); return v === T.WALL || v === T.TREE; }
    platformAt(x, y) { return this.tileAt(x, y) === T.PLATFORM; }
    insideSolid(e) { return this.solidAt(e.x, e.y); }

    integrate(e, dt, isPlayer) {
      const d = e.def;
      const ph = this.spec.world.physics;
      const side = SIDE[ph] && !d.flying;
      const ghost = d.ghost || (isPlayer && e.powers && e.powers.ghost);
      const bx = e.hw || e.r * 0.82, by = e.hh || e.r * 0.82;
      const wasGround = e.ground;
      e.ground = false; e.wallX = 0;
      let hit = false;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(e.vx), Math.abs(e.vy)) * dt / (this.TS * 0.45)));
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        // X
        e.x += e.vx * sdt;
        if (!ghost) {
          const c = this.collideBox(e.x, e.y, bx, by, e.vx, 0, side, e);
          if (c) { e.x = c.x; if (e.st.bouncer) e.vx = -e.vx; else { e.wallX = U.sign(e.vx); e.vx = 0; } hit = true; }
        }
        // Y
        const oy = e.y;
        e.y += (e.vy + (e.st.wy != null && !side ? 0 : 0)) * sdt;
        if (!ghost) {
          const c = this.collideBox(e.x, e.y, bx, by, 0, e.vy, side, e, oy);
          if (c) {
            e.y = c.y;
            const g = U.sign(this.rt.gravity) || 1;
            if (e.st.bouncer) e.vy = -e.vy;
            else {
              if (side && U.sign(e.vy) === g) { e.ground = true; if (d.bouncy && Math.abs(e.vy) > 200) e.vy = -e.vy * d.bouncy; else e.vy = 0; }
              else if (side && c.bounce) { e.vy = -1000 * g; }
              else e.vy = d.bouncy && !side ? -e.vy * d.bouncy : 0;
              if (c.bounce && side && e.ground) { e.vy = -1050 * g; e.ground = false; this.sfx('bounce'); this.burst(e.x, e.y + e.r, '#8fd3ff', 6); }
            }
            hit = true;
          }
        }
      }
      if (side && !e.ground && !ghost) {
        // stick to ground check
        const g = U.sign(this.rt.gravity) || 1;
        const fy = e.y + g * (by + 1.5);
        if ((this.solidAt(e.x - bx * 0.8, fy) || this.solidAt(e.x + bx * 0.8, fy) || ((this.platformAt(e.x, fy)) && g > 0 && e.vy >= 0)) && Math.abs(e.vy) < 1) e.ground = true;
      }
      if (isPlayer && side && e.ground && !wasGround) { this.fire('onLand', { self: e }); e.squash = -0.14; if (this.rt.juice >= 1) this.burst(e.x, e.y + e.r, '#ffffff', 3, { speed: 60, kind: 'smoke' }); }
      if (hit && !isPlayer) { e.st.hitT = 0.1; if (this.byTrig && this.byTrig.onHitWall) this.fire('onHitWall', { self: e, x: e.x, y: e.y }, e); }
      // world bounds
      const wrap = this.spec.world.bounds === 'wrap' || ph === 'ship' && this.spec.world.bounds !== 'walls';
      if (wrap) {
        if (e.x < -e.r) e.x += this.W + e.r * 2; else if (e.x > this.W + e.r) e.x -= this.W + e.r * 2;
        if (!SIDE[ph]) { if (e.y < -e.r) e.y += this.H + e.r * 2; else if (e.y > this.H + e.r) e.y -= this.H + e.r * 2; }
      } else if (this.spec.world.bounds !== 'open' || isPlayer) {
        const r = e.hw || e.r;
        if (e.x < r) { e.x = r; if (e.st.bouncer) e.vx = Math.abs(e.vx); else e.vx = Math.max(0, e.vx); e.st.hitT = 0.1; }
        if (e.x > this.W - r) { e.x = this.W - r; if (e.st.bouncer) e.vx = -Math.abs(e.vx); else e.vx = Math.min(0, e.vx); e.st.hitT = 0.1; }
        if (!SIDE[ph] || this.rt.gravity < 0) {
          const rh = e.hh || e.r;
          if (e.y < rh && !(e.st.fall) && !(ph === 'shmup' && !isPlayer)) { e.y = rh; if (e.st.bouncer) e.vy = Math.abs(e.vy); else e.vy = Math.max(0, e.vy); e.st.hitT = 0.1; }
          if (!this.openBottom && e.y > this.H - rh && !(ph === 'shmup' && !isPlayer)) { e.y = this.H - rh; if (e.st.bouncer) e.vy = -Math.abs(e.vy); else e.vy = Math.min(0, e.vy); e.st.hitT = 0.1; if (SIDE[ph]) e.ground = true; }
        } else if (!this.openBottom && e.y > this.H - (e.hh || e.r)) { e.y = this.H - (e.hh || e.r); e.vy = 0; e.ground = true; }
        if (ph === 'shmup' && !isPlayer && e.y > this.H + 80) e.dead = true;
      }
    }

    // returns corrected position if overlapping solid tiles, else null
    collideBox(x, y, hx, hy, vx, vy, side, e, oldY) {
      const ts = this.TS, g = this.grid;
      const c0 = Math.floor((x - hx) / ts), c1 = Math.floor((x + hx - 0.01) / ts);
      const r0 = Math.floor((y - hy) / ts), r1 = Math.floor((y + hy - 0.01) / ts);
      let res = null;
      const grav = this.rt.gravity >= 0 ? 1 : -1;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const v = g.get(c, r);
        let solid = v === T.WALL || v === T.TREE;
        let bounce = false;
        if (v === T.BOUNCE) { solid = side; bounce = true; }
        if (v === T.PLATFORM && side && vy !== 0 && oldY != null) {
          // one-way: only from above (relative to gravity)
          if (grav > 0 && vy > 0 && oldY + hy <= r * ts + 1) solid = true;
          if (grav < 0 && vy < 0 && oldY - hy >= (r + 1) * ts - 1) solid = true;
        } else if (v === T.PLATFORM && !side) solid = false;
        if (!solid) continue;
        if (vx > 0) res = { x: c * ts - hx, y };
        else if (vx < 0) res = { x: (c + 1) * ts + hx, y };
        else if (vy > 0) res = { x, y: r * ts - hy, bounce };
        else if (vy < 0) res = { x, y: (r + 1) * ts + hy, bounce };
        if (res) return res;
      }
      void e;
      return res;
    }

    tileEffects(e, dt) {
      const ph = this.spec.world.physics, side = SIDE[ph];
      const probe = side ? [[e.x, e.y], [e.x, e.y + (U.sign(this.rt.gravity) || 1) * (e.r * 0.9)]] : [[e.x, e.y]];
      const kinds = new Set();
      for (const [x, y] of probe) { const v = this.tileAt(x, y); if (v > 0) kinds.add(v); }
      if (e.z > 8 || e.def.flying) { kinds.delete(T.LAVA); kinds.delete(T.SPIKES); kinds.delete(T.WATER); }
      const fireproof = (e.def.effects || []).includes('embers') || (e.def.color && e.def.element === 'fire');
      e.st.tileCd = (e.st.tileCd || 0) - dt;
      if (kinds.has(T.LAVA) && !fireproof && e.st.tileCd <= 0) { e.st.tileCd = 0.6; this.burst(e.x, e.y, '#ff7a2a', 8, { speed: 160 }); if (e.isPlayer) { this.hurt(e, 1, null); if (side) e.vy = -700 * (U.sign(this.rt.gravity) || 1); } else this.hurt(e, 1, null); }
      if (kinds.has(T.SPIKES) && e.st.tileCd <= 0) { e.st.tileCd = 0.5; if (e.isPlayer) { this.hurt(e, 1, null); if (side) e.vy = -520 * (U.sign(this.rt.gravity) || 1); } else if (e.team !== 'neutral') this.hurt(e, 1, null); }
      if (!side && kinds.has(T.BOUNCE) && e.isPlayer && e.z <= 0) { e.vz = 520; this.sfx('bounce'); }
      if (kinds.has(T.WATER) && e.isPlayer && !e.st.wet) { e.st.wet = true; this.burst(e.x, e.y, '#8fd3ff', 8, { speed: 120 }); this.sfx('splash'); }
      if (!kinds.has(T.WATER)) e.st.wet = false;
      if (e.isPlayer && this.byTrig && this.byTrig.onCollide) {
        const now = new Set([...kinds].map((k) => Lv.KIND[k]));
        if (e.wallX || e.st.hitWall) now.add('wall');
        for (const k of now) if (!this.tileContacts.has(k)) {
          for (const R of this.byTrig.onCollide) {
            const w = R.r.when;
            if ((this.matches(e, w.a) && w.b === k) || (this.matches(e, w.b) && w.a === k)) this.runRule(R, { self: e, x: e.x, y: e.y });
          }
        }
        this.tileContacts = now;
      }
    }

    // ------------------------------------------------------------------ collisions
    buildHash() {
      const h = this.hash = new Map();
      let maxR = 0;
      for (const e of this.entities) {
        if (e.dead) continue;
        const k = Math.floor(e.x / CELL) * 100003 + Math.floor(e.y / CELL);
        let arr = h.get(k); if (!arr) { arr = []; h.set(k, arr); }
        arr.push(e);
        const er = Math.max(e.r, e.hw || 0, e.hh || 0);
        if (er > maxR) maxR = er;
      }
      this.maxR = maxR;
    }
    neighbors(e, range) {
      const out = [];
      if (!this.hash) return out;
      const R = range + (this.maxR || 0);
      const c0 = Math.floor((e.x - R) / CELL), c1 = Math.floor((e.x + R) / CELL), r0 = Math.floor((e.y - R) / CELL), r1 = Math.floor((e.y + R) / CELL);
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
        const arr = this.hash.get(c * 100003 + r);
        if (!arr) continue;
        for (const o of arr) if (o !== e && !o.dead && Math.abs(o.x - e.x) < range + o.r && Math.abs(o.y - e.y) < range + o.r) out.push(o);
      }
      return out;
    }
    nearest(e, pred, range) {
      let best = null, bd = range || 1e9;
      for (const o of this.entities) {
        if (o === e || o.dead || !pred(o)) continue;
        const d = Math.abs(o.x - e.x) + Math.abs(o.y - e.y);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }
    cachedTarget(e, bi, sel, range) {
      const key = 't' + bi;
      const c = e.st[key];
      if (c && c.t > 0 && c.e && !c.e.dead) { c.t -= 1 / 60; return c.e; }
      let t = null;
      if (sel === 'player') t = this.player && (!range || U.dist(this.player.x, this.player.y, e.x, e.y) < range) ? this.player : null;
      else if (sel === 'enemy') t = this.nearest(e, (o) => (e.team === 'enemy' ? o.isPlayer || o.team === 'friend' : o.team === 'enemy') && !o.def.projectile && o.def.role !== 'hazard', range || 2000);
      else t = this.nearest(e, (o) => this.matches(o, sel) && !o.def.projectile, range || 2000);
      if (!t && sel !== 'player' && e.team === 'enemy' && sel !== 'collectible') t = this.player;
      e.st[key] = { e: t, t: 0.25 + U.random() * 0.15 };
      return t;
    }

    overlap(a, b) {
      const ar = a.hw ? null : a.r, br = b.hw ? null : b.r;
      const paddle = this.spec.world.physics === 'paddle';
      const aRect = a.hw || (a.isPlayer && paddle), bRect = b.hw || (b.isPlayer && paddle);
      if (!aRect && !bRect) {
        const dx = b.x - a.x, dy = b.y - a.y, rr = ar + br;
        if (dx * dx + dy * dy >= rr * rr) return null;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        return { nx: dx / d, ny: dy / d, depth: rr - d };
      }
      const rect = (e) => e.hw ? { hw: e.hw, hh: e.hh } : { hw: (e.def.size || 28) * 2 * e.scale, hh: (e.def.size || 28) * 0.32 };
      if (aRect && bRect) {
        const A = rect(a), B = rect(b);
        const ox = A.hw + B.hw - Math.abs(b.x - a.x), oy = A.hh + B.hh - Math.abs(b.y - a.y);
        if (ox <= 0 || oy <= 0) return null;
        return ox < oy ? { nx: U.sign(b.x - a.x) || 1, ny: 0, depth: ox } : { nx: 0, ny: U.sign(b.y - a.y) || 1, depth: oy };
      }
      // circle vs rect
      const C = aRect ? b : a, R = aRect ? a : b, rr = rect(R);
      const cx = U.clamp(C.x, R.x - rr.hw, R.x + rr.hw), cy = U.clamp(C.y, R.y - rr.hh, R.y + rr.hh);
      let dx = C.x - cx, dy = C.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= C.r * C.r) return null;
      let d = Math.sqrt(d2), nx, ny, depth;
      if (d < 0.001) { // center inside rect
        const px = rr.hw - Math.abs(C.x - R.x), py = rr.hh - Math.abs(C.y - R.y);
        if (px < py) { nx = U.sign(C.x - R.x) || 1; ny = 0; depth = px + C.r; } else { nx = 0; ny = U.sign(C.y - R.y) || 1; depth = py + C.r; }
      } else { nx = dx / d; ny = dy / d; depth = C.r - d; }
      // normal points from a to b
      if (C === a) { nx = -nx; ny = -ny; }
      return { nx, ny, depth };
    }

    collide(dt) {
      this.buildHash();
      const ents = this.entities;
      const now = new Set();
      const collideRules = (this.byTrig && this.byTrig.onCollide) || [];
      for (let i = 0; i < ents.length; i++) {
        const a = ents[i];
        if (a.dead) continue;
        const nb = this.neighbors(a, Math.max(a.r, a.hw || 0, a.hh || 0) + 2);
        for (const b of nb) {
          if (b.id <= a.id || b.dead || a.dead) continue;
          const o = this.overlap(a, b);
          if (!o) continue;
          this.pairContact(a, b, o, dt);
          if (collideRules.length) {
            const key = a.id * 1000003 + b.id;
            now.add(key);
            if (!this.contacts.has(key)) {
              for (const R of collideRules) {
                const w = R.r.when;
                if (this.matches(a, w.a) && this.matches(b, w.b)) this.runRule(R, { self: a, other: b, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                else if (this.matches(b, w.a) && this.matches(a, w.b)) this.runRule(R, { self: b, other: a, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
              }
            }
          }
        }
      }
      this.contacts = now;
    }

    pairContact(a, b, o, dt) {
      const da = a.def, db = b.def;
      // projectiles
      if (da.projectile || db.projectile) {
        if (da.projectile && db.projectile) return;
        const p = da.projectile ? a : b, t = da.projectile ? b : a;
        if (p.owner === t.id) return;
        const tt = t.isPlayer ? 'friend' : t.team;
        const canHit = hostile(p.team, tt) || (p.team === 'friend' && t.def.role === 'obstacle' && t.maxHp < 99) || (p.team === 'neutral' && (t.isPlayer || tt === 'enemy'));
        if (!canHit) {
          if (t.def.static && t.def.role !== 'collectible' && t.def.role !== 'structure' && !t.def.projectile && t.def.solid !== false && t.def.role === 'obstacle') { p.dead = true; this.burst(p.x, p.y, p.def.color || '#fff', 3, { speed: 90 }); }
          return;
        }
        if (p.hitSet) { if (p.hitSet.has(t.id)) return; p.hitSet.add(t.id); }
        this.hurt(t, p.def.damage == null ? 1 : p.def.damage, p.ownerRef || p);
        if (!t.isPlayer && !t.def.static) { const sp = Math.hypot(p.vx, p.vy) || 1; t.vx += p.vx / sp * 120; t.vy += p.vy / sp * 120; }
        if (p.def.web || p.def.slow) { t.frozen = Math.max(t.frozen || 0, 0.8); }
        if (!p.def.pierce) { p.dead = true; this.burst(p.x, p.y, p.def.color || '#fff', 5, { speed: 140 }); if (p.def.explode) this.explode(p.x, p.y, p.def.explode, p.def.damage || 2, p.ownerRef); }
        return;
      }
      const ta = a.isPlayer ? 'friend' : a.team, tb = b.isPlayer ? 'friend' : b.team;
      // contact damage
      if (hostile(ta, tb)) {
        const [en, fr] = ta === 'enemy' ? [a, b] : [b, a];
        const pl = fr.isPlayer ? fr : null;
        if (pl && pl.powers && (pl.powers.invincible || pl.powers.giant)) { this.hurt(en, 99, pl); }
        else {
          const dmg = en.def.damage == null ? (en.def.role === 'collectible' ? 0 : 1) : en.def.damage;
          if (dmg > 0) this.hurt(fr, dmg, en);
          if (en.def.kamikaze || (en.def.behaviors || []).some((b) => b.type === 'kamikaze')) { this.kill(en, fr); }
          const fdmg = fr.isPlayer ? 0 : (fr.def.damage == null ? 1 : fr.def.damage);
          if (fdmg > 0) { fr.cd.contact = (fr.cd.contact || 0) - dt; if (fr.cd.contact <= 0) { fr.cd.contact = 0.5; this.hurt(en, fdmg, fr); } }
          if (pl) {
            if ((en.def.behaviors || []).some((b) => b.type === 'steal')) { en.cd.steal = (en.cd.steal || 0) - dt; if (en.cd.steal <= 0) { en.cd.steal = 1; this.addScore(-1, en.x, en.y); this.sfx('blip'); this.knock(en, pl.x, pl.y, 500); } }
            if (en.def.sticky) pl.st.slowT = 1.2;
            if (en.def.freeze) pl.frozen = Math.max(pl.frozen, 0.6);
            // platformer stomp
            if (SIDE[this.spec.world.physics] && !en.def.boss && pl.vy * (U.sign(this.rt.gravity) || 1) > 120 && (pl.y - en.y) * (U.sign(this.rt.gravity) || 1) < -en.r * 0.3 && !en.def.spiky) {
              this.hurt(en, 2, pl); pl.vy = -520 * (U.sign(this.rt.gravity) || 1); pl.inv = Math.max(pl.inv, 0.2); this.sfx('bounce');
            }
          }
        }
      }
      // eating
      for (const [x, y] of [[a, b], [b, a]]) {
        if (x.def.behaviors && y.def.role === 'collectible' && x.def.behaviors.some((bh) => bh.type === 'eat') && !x.isPlayer) { y.dead = true; this.sparkle(y.x, y.y, y.def.color || '#ffd166'); x.scale = Math.min(3, x.scale * 1.04); this.setRadius(x); this.floater(x.x, x.y - x.r, 'nom', '#ffd166'); }
      }
      // hazards that slip
      if ((da.slip && b.isPlayer) || (db.slip && a.isPlayer)) { const p = a.isPlayer ? a : b; p.st.slipT = 1.2; }
      // pushing & solidity
      const solidB = this.isSolidBody(b), solidA = this.isSolidBody(a);
      const bounceA = a.st.bouncer || (da.bouncy && !da.static), bounceB = b.st.bouncer || (db.bouncy && !db.static);
      if ((bounceA && (solidB || b.isPlayer)) || (bounceB && (solidA || a.isPlayer))) {
        const ball = bounceA ? a : b, other = ball === a ? b : a;
        const nx = ball === a ? -o.nx : o.nx, ny = ball === a ? -o.ny : o.ny; // normal pointing toward ball
        ball.x += nx * o.depth; ball.y += ny * o.depth;
        if (other.isPlayer && this.spec.world.physics === 'paddle') {
          const half = (other.def.size || 28) * 2;
          const off = U.clamp((ball.x - other.x) / half, -1, 1);
          const sp = Math.max(Math.hypot(ball.vx, ball.vy), ball.st.bouncer || 320) * 1.02;
          const ang = -Math.PI / 2 + off * 1.1;
          ball.vx = Math.cos(ang) * sp; ball.vy = Math.sin(ang) * sp;
          if (ball.st.bouncer) ball.st.bouncer = Math.min(900, sp);
        } else {
          const dot = ball.vx * nx + ball.vy * ny;
          if (dot < 0) { ball.vx -= 2 * dot * nx; ball.vy -= 2 * dot * ny; }
          if (!ball.st.bouncer && other.isPlayer) { const sp = Math.hypot(other.vx, other.vy); ball.vx += other.vx * 0.9 + nx * 120; ball.vy += other.vy * 0.9 + ny * 120 - (SIDE[this.spec.world.physics] ? 200 : 0); void sp; }
        }
        this.sfx('bounce', 0.4);
        return;
      }
      if (solidB && !a.def.ghost && !(a.isPlayer && a.powers && a.powers.ghost) && !da.static) this.push(a, b, o, -1);
      else if (solidA && !b.def.ghost && !(b.isPlayer && b.powers && b.powers.ghost) && !db.static) this.push(b, a, o, 1);
      else if (!da.static && !db.static && !a.isPlayer && !b.isPlayer && ta === tb && !da.flying && !db.flying && !da.ghost && a.def.role !== 'collectible' && b.def.role !== 'collectible') {
        // soft separation for crowds
        const s = Math.min(o.depth, 4) * 0.5;
        a.x -= o.nx * s; a.y -= o.ny * s; b.x += o.nx * s; b.y += o.ny * s;
      }
    }
    isSolidBody(e) {
      const d = e.def;
      if (d.projectile || d.role === 'collectible') return false;
      if (d.pushable) return true;
      if (!d.static) return false;
      if (d.solid === false) return false;
      if (d.solid === true) return true;
      return d.role === 'obstacle';
    }
    // move `m` out of `s`. sign: o normal is a->b; if m is a, sign -1
    push(m, s, o, sign) {
      const nx = o.nx * sign, ny = o.ny * sign;
      if (s.def.pushable && !s.def.static) {
        const share = m.isPlayer ? 0.65 : 0.5;
        s.x -= nx * o.depth * share; s.y -= ny * o.depth * share;
        m.x += nx * o.depth * (1 - share); m.y += ny * o.depth * (1 - share);
        if (this.solidAt(s.x, s.y)) { s.x += nx * o.depth * share; s.y += ny * o.depth * share; m.x += nx * o.depth * share; m.y += ny * o.depth * share; }
        s.vx = -nx * 60; s.vy = -ny * 60;
        if (s.def.bouncy) { s.vx = -nx * 380 + m.vx * 0.8; s.vy = -ny * 380 + m.vy * 0.8; }
        return;
      }
      m.x += nx * o.depth; m.y += ny * o.depth;
      const dot = m.vx * nx + m.vy * ny;
      if (dot < 0) { m.vx -= dot * nx; m.vy -= dot * ny; }
      if (SIDE[this.spec.world.physics] && ny * (U.sign(this.rt.gravity) || 1) < -0.6) { m.ground = true; if (m.vy * (U.sign(this.rt.gravity) || 1) > 0) m.vy = 0; }
      if (s.def.launch && m.isPlayer) { m.vy = -1000 * (U.sign(this.rt.gravity) || 1); m.vz = 600; this.sfx('bounce'); s.squash = 0.3; }
      m.st.hitT = 0.1;
    }

    updateBombs(dt) {
      for (const b of this.bombs) {
        b.t -= dt;
        if (b.t <= 0) { b.done = true; this.explode(b.x, b.y, b.r, 3, this.player || null); }
      }
      this.bombs = this.bombs.filter((b) => !b.done);
    }

    // ------------------------------------------------------------------ camera
    updateCamera(dt) {
      const p = this.player;
      const ph = this.spec.world.physics;
      this.computeView();
      const v = this.view;
      if (v.fit) { this.cam.x = this.W / 2; this.cam.y = this.H / 2; }
      else if (p) {
        const lead = ph === 'runner' ? 220 : 0;
        const tx = p.x + lead + p.vx * 0.12, ty = p.y + p.vy * 0.06;
        const k = 1 - Math.exp(-7 * dt);
        this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
      }
      if (!v.fit) {
        const hw = v.vw / 2, hh = v.vh / 2;
        this.cam.x = this.W > v.vw ? U.clamp(this.cam.x, hw, this.W - hw) : this.W / 2;
        this.cam.y = this.H > v.vh ? U.clamp(this.cam.y, hh, this.H - hh) : this.H / 2;
      }
      const shakeMul = this.spec.camera.shake == null ? 1 : this.spec.camera.shake;
      if (this.cam.shake > 0) {
        this.cam.shake = Math.max(0, this.cam.shake - dt * 40);
        const s = this.cam.shake * shakeMul;
        this.cam.ox = (U.random() - 0.5) * s * 2; this.cam.oy = (U.random() - 0.5) * s * 2;
      } else { this.cam.ox = 0; this.cam.oy = 0; }
    }
    computeView() {
      const v = this.view, ph = this.spec.world.physics;
      const base = 620 / (this.rt.zoom || 1);
      let scale = v.ch / base;
      const fitWanted = ph === 'shmup' || ph === 'paddle' || ph === 'snake' || this.spec.camera.follow === false || this.lvl.type === 'bricks';
      const fitScale = Math.min(v.cw / this.W, v.ch / this.H);
      const fits = this.W * scale <= v.cw && this.H * scale <= v.ch;
      v.fit = fitWanted || fits;
      if (v.fit) scale = fitWanted ? fitScale : Math.min(fitScale, scale * 1.15);
      v.scale = scale;
      v.vw = v.cw / scale; v.vh = v.ch / scale;
    }
    shake(n) { this.cam.shake = Math.min(30, Math.max(this.cam.shake, n * (0.6 + this.rt.juice * 0.4))); }

    // ------------------------------------------------------------------ fx
    burst(x, y, color, n, o) {
      if (this.headless) return;
      o = o || {};
      n = Math.round(n * (0.5 + (this.rt.juice || 1) * 0.5));
      if (this.particles.length > 1500) n = Math.min(n, 3);
      const sp = o.speed || 200;
      for (let i = 0; i < n; i++) {
        const a = o.angle != null ? o.angle + (U.random() - 0.5) * 0.8 : U.random() * Math.PI * 2, s = sp * (0.3 + U.random() * 0.7);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + U.random() * 0.45, max: 0.8, size: (o.kind === 'smoke' ? 6 : 2.2) + U.random() * 3, color, kind: o.kind || (U.random() < 0.5 ? 'spark' : 'dot'), drag: o.kind === 'smoke' ? 0.92 : 0.9 });
      }
    }
    ring(x, y, color, r, life) { if (this.headless) return; this.particles.push({ x, y, vx: 0, vy: 0, life: life || 0.35, max: life || 0.35, size: r, color, kind: 'ring' }); }
    sparkle(x, y, color) { if (this.headless) return; for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; this.particles.push({ x, y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, life: 0.4, max: 0.4, size: 3, color, kind: 'star', drag: 0.86 }); } this.ring(x, y, color, 22, 0.25); }
    confetti() {
      if (this.headless) return;
      const cols = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#f8f9fa'];
      const v = this.view;
      for (let i = 0; i < 140; i++) this.particles.push({ screen: true, x: U.random() * v.cw / v.dpr, y: -10 - U.random() * 200, vx: (U.random() - 0.5) * 120, vy: 120 + U.random() * 200, life: 3, max: 3, size: 5 + U.random() * 4, color: cols[i % cols.length], kind: 'confetti', rot: U.random() * 6, vr: (U.random() - 0.5) * 10, drag: 0.995 });
    }
    floater(x, y, text, color, kind) { if (this.headless) return; if (this.floaters.length > 80) this.floaters.shift(); this.floaters.push({ x, y, text: String(text), color: color || '#fff', t: kind === 'bubble' ? 2.6 : 0.9, max: kind === 'bubble' ? 2.6 : 0.9, kind: kind || 'num' }); }
    say(e, text) { if (this.headless) return; this.floaters = this.floaters.filter((f) => !(f.kind === 'bubble' && f.ent === e)); this.floaters.push({ x: e.x, y: e.y, ent: e, text: String(text), color: '#fff', t: 3, max: 3, kind: 'bubble' }); this.sfx('blip', 0.5); }
    banner(text, t) { this.messages = this.messages.filter((m) => m.text !== text); this.messages.push({ text: String(text), t: t || 2, max: t || 2 }); }
    updateParticles(dt) {
      const ps = this.particles;
      let w = 0;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const dr = p.drag || 0.96;
        p.vx *= Math.pow(dr, dt * 60); p.vy *= Math.pow(dr, dt * 60);
        if (p.kind === 'confetti') { p.rot += p.vr * dt; p.vx += Math.sin(p.life * 4) * 20 * dt; }
        if (p.grav) p.vy += p.grav * dt;
        ps[w++] = p;
      }
      ps.length = w;
      const fl = this.floaters;
      w = 0;
      for (let i = 0; i < fl.length; i++) { const f = fl[i]; f.t -= dt; if (f.t > 0 && !(f.ent && f.ent.dead)) fl[w++] = f; }
      fl.length = w;
    }

    sfx(name, vol) {
      if (this.headless || this.mode !== 'play' || !VC.Sound || (this.spec && this.spec.audio.sfx === false)) return;
      VC.Sound.sfx(name, vol);
    }

    // ------------------------------------------------------------------ mods
    compileMods() {
      this.modsFns = {};
      const code = this.spec.mods;
      if (!code || !code.trim()) return;
      try { this.modsFns = VC.DSL.compileMods(code) || {}; } catch (e) { this.err = { message: e.message, file: 'src/mods.js', line: e.line, where: 'mods' }; this.emit('error', this.err); }
    }
    callMod(name, a, b) {
      const fn = this.modsFns && this.modsFns[name];
      if (typeof fn !== 'function') return;
      try {
        if (name === 'onEvent') fn(this.api(), a, b);
        else if (name === 'onDraw') fn(this.api(), a);
        else fn(this.api(), a);
      } catch (e) {
        this.modsFns = {};
        this.crash(e, 'mods');
      }
    }
    api() {
      if (this._api) return this._api;
      const g = this;
      this._api = {
        get player() { return g.player; },
        get score() { return g.score; }, set score(v) { g.score = Number(v) || 0; },
        get time() { return g.time; }, get level() { return g.level; },
        get vars() { return g.vars; },
        get mouse() { return { x: g.input.mouse.wx, y: g.input.mouse.wy, down: g.input.mouse.down }; },
        get world() { return { width: g.W, height: g.H, gravity: g.rt.gravity, physics: g.spec.world.physics }; },
        entities: (sel) => g.entities.filter((e) => !e.dead && !e.isPlayer && (sel == null || g.matches(e, sel))),
        spawn: (type, x, y, over) => { if (!g.spec.types[type]) throw new Error('No entity type "' + type + '"'); return g.spawnEntity(type, x == null ? g.W / 2 : x, y == null ? g.H / 2 : y, over); },
        destroy: (e) => g.destroy(e, {}), damage: (e, n) => g.hurt(e, n || 1, null),
        say: (e, t) => (e ? g.say(e, t) : g.banner(t)), banner: (t) => g.banner(t), shake: (n) => g.shake(n || 8), sound: (n) => g.sfx(n),
        burst: (x, y, c, n) => g.burst(x, y, c || '#fff', n || 12), addScore: (n) => g.addScore(n == null ? 1 : n),
        key: (k) => !!g.input.keys[String(k).toLowerCase()], pressed: (k) => !!g.input.pressed[String(k).toLowerCase()],
        tileAt: (x, y) => Lv.KIND[g.tileAt(x, y)] || 'empty', setTile: (x, y, kind) => { g.grid.set(Math.floor(x / g.TS), Math.floor(y / g.TS), Lv.NAMES[kind] || 0); },
        win: (m) => g.win(m), lose: (m) => g.lose(m), nextLevel: () => g.nextLevel(), random: () => U.random(),
        log: (...a) => g.emit('log', a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')),
      };
      return this._api;
    }

    // ------------------------------------------------------------------ headless helpers
    simulate(seconds, opts) {
      opts = opts || {};
      const dt = 1 / 60;
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) { this.step(dt); if (this.err) break; if (opts.until && opts.until(this)) break; }
      return this;
    }
    status() {
      return { ents: this.entities.length, proj: this.projCount || 0, fps: Math.round(this.fps), state: this.state, score: this.score, time: this.time, physics: this.spec ? this.spec.world.physics : '-', level: this.level };
    }
  }

  function b_lookAngle(e) { return Math.abs(e.vx) + Math.abs(e.vy) > 8; }
  function defaultHp(def) { if (def.role === 'collectible') return 1; if (def.role === 'boss' || def.boss) return 20; if (def.static && def.role !== 'obstacle') return 99; return 2; }
  function projSound(p) { p = String(p || ''); if (/laser|beam|plasma|lightning/.test(p)) return 'laser'; if (/magic|note|heart/.test(p)) return 'magic'; if (/fire|flame/.test(p)) return 'fire'; return 'shoot'; }

  Game.defaultAbility = function (name, spec) {
    const ph = spec.world.physics;
    switch (name) {
      case 'jump': return { power: 640 };
      case 'shoot': return { projectile: Object.keys(spec.types).find((k) => spec.types[k].projectile) || 'bullet', rate: 4, aim: ph === 'shmup' ? 'up' : SIDE[ph] ? 'facing' : 'mouse' };
      case 'melee': return { weapon: 'sword', damage: 2, reach: 60, rate: 3 };
      case 'dash': return { power: 820, cooldown: 0.8 };
      case 'shield': return { duration: 2, cooldown: 2 };
      case 'fly': return { power: 2400 };
      case 'bomb': return { radius: 110, cooldown: 1.2, fuse: 1.4 };
      case 'blink': return { distance: 220, cooldown: 1 };
      case 'magnet': return { range: 220 };
      case 'regen': return { every: 4 };
      case 'slowtime': return { factor: 0.35, duration: 2.5, cooldown: 6 };
      case 'flap': return { power: 460 };
      case 'tail': return { length: 4 };
      default: return {};
    }
  };

  VC.Engine = Game;
  VC.Engine.teamOf = teamOf;
  VC.Engine.defaultHp = defaultHp;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
