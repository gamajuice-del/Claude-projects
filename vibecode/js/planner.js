/* VibeCode — planner: intents -> spec operations + notes for narration. */
(function (VC) {
  'use strict';
  const U = VC.U, L = VC.Lex, Spec = VC.Spec, I = VC.Interp;
  const P = {};

  const RD = {
    enemy: { size: 30, speed: 80, hp: 2, damage: 1, count: 6 },
    boss: { size: 84, speed: 70, hp: 30, damage: 2, count: 1 },
    collectible: { size: 22, count: 10 },
    hazard: { size: 30, damage: 1, count: 6 },
    obstacle: { size: 40, count: 8 },
    npc: { size: 30, speed: 50, hp: 5, count: 1 },
    pet: { size: 26, speed: 190, hp: 5, count: 1 },
    structure: { size: 44, count: 1 },
    critter: { size: 28, speed: 80, hp: 1, count: 5 },
    vehicle: { size: 32, speed: 180, hp: 4, count: 3 },
  };
  const MOVEMENT = new Set(['chase', 'wander', 'patrol', 'hop', 'flee', 'follow', 'orbit', 'zigzag', 'wave', 'kite', 'drift', 'fall', 'swarm', 'bounce', 'eat', 'mimic', 'charge', 'guard']);
  const SIDE = (S) => S.world.physics === 'platformer' || S.world.physics === 'runner';
  const FRUITS = ['apple', 'banana', 'cherry', 'strawberry', 'grape', 'orange', 'watermelon', 'peach', 'lemon'];
  const ANIMALS = ['chicken', 'cow', 'pig', 'sheep', 'rabbit', 'frog', 'fox', 'penguin', 'turtle', 'owl', 'deer', 'squirrel'];
  const POWERUPS = ['mushroom', 'lightning', 'shield', 'magnet', 'heart'];

  // ---------------------------------------------------------------------------
  // plan context
  // ---------------------------------------------------------------------------
  function Planner(spec, ctx) {
    this.S = Spec.normalize(U.clone(spec));
    this.before = spec;
    this.ctx = ctx || {};
    this.rng = U.rng(ctx.seed || (Date.now() & 0xffff));
    this.ops = [];
    this.notes = [];
    this.focus = [];
    this.warnings = [];
    this.headlines = [];
    this.wasEmpty = Spec.isEmpty(spec);
    this.created = new Set();
    this.flags = {};
  }
  Planner.prototype.op = function (o) {
    Spec.applyOne(this.S, o);
    const S = this.S;
    if (!S.types) S.types = {};
    if (!Array.isArray(S.rules)) S.rules = [];
    this.ops.push(o);
    return o;
  };
  Planner.prototype.note = function (k, d) { const n = Object.assign({ k }, d || {}); if ((this.inGenre && k !== 'genre') || (this.inConcept && k !== 'concept')) n.implicit = true; this.notes.push(n); return n; };
  Planner.prototype.set = function (path, value) { const cur = U.getPath(this.S, path); if (U.same(cur, value)) return null; return this.op({ op: 'set', path, value }); };
  Planner.prototype.head = function (s) { this.headlines.push(s); };
  Planner.prototype.theme = function () { return L.themes[this.S.meta.theme] || null; };
  Planner.prototype.pal = function () { return L.palette(this.S.look.palette); };

  // ---------------------------------------------------------------------------
  // player
  // ---------------------------------------------------------------------------
  Planner.prototype.defaultPlayer = function () {
    const ph = this.S.world.physics;
    const p = { glyph: null, shape: 'blob', color: this.pal().player || '#f2c46d', size: 28, speed: 230, hp: 5, abilities: {} };
    if (ph === 'platformer' || ph === 'runner') p.abilities.jump = { power: 640 };
    if (ph === 'runner') p.speed = 300;
    if (ph === 'shmup') { p.abilities.shoot = { projectile: this.ensureProjectile('laser'), rate: 7, aim: 'up', auto: true }; p.speed = 320; p.hp = 3; }
    if (ph === 'ship') { p.glyph = '🚀'; p.abilities.shoot = { projectile: this.ensureProjectile('laser'), rate: 5, aim: 'facing' }; p.speed = 260; p.hp = 3; }
    if (ph === 'snake') { p.abilities.tail = { length: 3 }; p.speed = 260; p.hp = 1; }
    if (ph === 'paddle') { p.speed = 560; p.hp = 3; p.size = 30; }
    if (ph === 'tank') { p.glyph = '🚜'; p.abilities.shoot = { projectile: this.ensureProjectile('cannonball'), rate: 2, aim: 'facing' }; }
    return p;
  };
  Planner.prototype.ensurePlayer = function (why) {
    if (this.S.player) return false;
    const p = this.defaultPlayer();
    this.op({ op: 'set', path: 'player', value: p });
    this.note('player-new', { why, physics: this.S.world.physics, glyph: p.glyph });
    if (this.S.level.type === 'empty' && !this.levelTouched) {
      const lv = SIDE(this.S) ? 'platforms' : this.S.world.physics === 'snake' ? 'arena' : this.S.world.physics === 'shmup' || this.S.world.physics === 'paddle' ? 'empty' : 'arena';
      if (lv !== 'empty') { this.set('level.type', lv); this.note('level', { to: lv, auto: true }); }
    }
    if (this.S.look.background === 'void' && this.wasEmpty && !this.bgTouched) { const th = this.theme(); this.set('look.background', th ? th.bg : 'gradient'); }
    return true;
  };

  // ---------------------------------------------------------------------------
  // entity building
  // ---------------------------------------------------------------------------
  Planner.prototype.ensureProjectile = function (key, custom) {
    const S = this.S;
    key = key || 'bullet';
    let name = U.ident(key);
    if (S.types[name] && S.types[name].projectile) return name;
    if (S.types[name] && !S.types[name].projectile) name = name + '_shot';
    if (S.types[name]) return name;
    const a = L.projectiles[key] || null;
    const def = { projectile: true };
    if (a) {
      if (a.glyph) def.glyph = a.glyph; else def.shape = a.shape || 'circle';
      def.color = a.c; def.size = a.s; def.speed = a.v; def.damage = a.dmg == null ? 1 : a.dmg; def.lifetime = a.life || 1.8;
      if (a.pierce) def.pierce = true; if (a.explode) def.explode = a.explode; if (a.homing) def.homing = true; if (a.boomerang) def.boomerang = true;
      if (a.fx) def.effects = a.fx.slice();
      if (a.slow) def.slow = true;
    } else {
      const g = (custom && custom.glyph) || L.glyphFor(key);
      if (g) def.glyph = g; else { def.shape = 'circle'; def.label = U.human(key); }
      def.color = U.colorFromString(key); def.size = 16; def.speed = 480; def.damage = 1; def.lifetime = 1.8;
      def.effects = ['spin'];
    }
    this.op({ op: 'set', path: 'types.' + name, value: def });
    this.created.add(name);
    this.note('proj-new', { name, def, custom: !a });
    return name;
  };

  function expandBehaviors(list, entry, S, P2) {
    const out = [];
    const theme = L.themes[S.meta.theme];
    for (const b of list || []) {
      switch (b) {
        case 'chase': out.push({ type: 'chase', target: 'player' }); break;
        case 'flee': out.push({ type: 'flee', from: 'player' }); break;
        case 'follow': out.push({ type: 'follow', target: 'player' }); break;
        case 'swarm': out.push({ type: 'swarm', target: 'player' }); break;
        case 'charge': out.push({ type: 'charge', target: 'player' }); break;
        case 'kite': out.push({ type: 'kite', target: 'player' }); break;
        case 'shoot': out.push({ type: 'shoot', projectile: P2.ensureProjectile(entry.proj || 'bullet') }); break;
        case 'spawner': { const what = entry.spawns || (theme && theme.enemy) || 'bat'; out.push({ type: 'spawner', what: P2.ensureHidden(what), every: 5, max: 14 }); break; }
        case 'magnet': out.push({ type: 'magnet', target: 'player', range: 220, strength: 260 }); break;
        case 'steal': out.push({ type: 'steal' }, { type: 'chase', target: 'player' }); break;
        default: out.push({ type: b });
      }
    }
    return out;
  }

  // create a type that only appears through spawns (count 0)
  Planner.prototype.ensureHidden = function (key) {
    if (this.S.types[key]) return key;
    const np = { key, word: key, entry: L.noun(key), mods: [], colors: [], count: 0 };
    return this.addFromNP(np, { count: 0, silent: true });
  };

  Planner.prototype.typeNameFor = function (np, key) {
    const S = this.S;
    const base = U.ident(key || np.word || 'thing');
    const distinct = (np.colors && np.colors.length) || (np.mods || []).some((m) => !/^(?:noun:|word:)/.test(m) && !/^(?:more|new|some)$/.test(m)) || (np.mods || []).some((m) => /^noun:/.test(m));
    if (!S.types[base] || S.types[base].projectile) return S.types[base] && S.types[base].projectile ? base + '_2' : base;
    if (!distinct) return base;
    const colorName = np.colors && np.colors.length ? Object.keys(L.colors).find((k) => L.colors[k] === np.colors[0]) : null;
    const modName = (np.mods || []).map((m) => m.replace(/^(?:noun:|word:)/, '')).filter((m) => !/^(?:more|new|some|pet)$/.test(m))[0];
    const pre = U.ident(colorName || modName || 'new');
    let name = pre + '_' + base;
    let i = 2;
    while (S.types[name] && !this.created.has(name)) { name = pre + '_' + base + '_' + i++; if (i > 9) break; }
    return name;
  };

  Planner.prototype.resolveGeneric = function (np) {
    const S = this.S, th = this.theme(), g = np.entry && np.entry.generic;
    if (!g && np.key !== 'boss') return null;
    let key;
    if (np.key === 'boss') {
      key = th ? th.boss : S.world.physics === 'shmup' || S.world.physics === 'ship' ? 'mothership' : 'dragon';
      if (key === 'boss') key = 'dragon';
    } else if (g === 'enemy') {
      const ph = S.world.physics;
      key = th ? th.enemy : ph === 'shmup' || ph === 'ship' ? 'alien' : SIDE(S) ? 'slime' : this.rng.pick(['slime', 'goblin', 'skeleton', 'zombie']);
    } else if (g === 'item') key = th ? th.item : 'coin';
    else if (g === 'obstacle') key = th ? th.obstacle : SIDE(S) ? 'crate' : 'rock';
    else if (g === 'hazard') key = SIDE(S) ? 'spikes' : this.rng.pick(['fire', 'mine', 'spikes']);
    else if (g === 'animal') key = this.rng.pick(ANIMALS);
    else if (g === 'fruit') key = this.rng.pick(FRUITS);
    else if (g === 'powerup') key = this.rng.pick(POWERUPS);
    if (!key) return null;
    this.note('generic', { asked: np.word, chose: key, theme: S.meta.theme });
    return key;
  };

  // np -> {name, def}
  Planner.prototype.buildEntity = function (np, opts) {
    opts = opts || {};
    const S = this.S, ph = S.world.physics;
    let key = np.key;
    let entry = np.entry || (key ? L.noun(key) : null);
    let isBoss = false;
    const bossBase = np.key === 'boss' && (np.mods || []).find((m) => /^noun:/.test(m) && L.noun(m.slice(5)) && L.noun(m.slice(5)).role !== 'tile');
    if (bossBase) { np = Object.assign({}, np, { key: bossBase.slice(5), entry: L.noun(bossBase.slice(5)), mods: np.mods.filter((m) => m !== bossBase) }); key = np.key; entry = np.entry; isBoss = true; }
    const gen = this.resolveGeneric(np);
    if (gen) { if (np.key === 'boss') isBoss = true; key = gen; entry = L.noun(key); }
    const vp = np.vp || { b: [], fx: [], props: [], attrs: [] };
    const unknown = !entry;
    // role
    let role = np.forceRole || opts.role || (entry ? entry.role : null);
    if (role === 'vehicle') role = 'critter';
    if (vp.collect || vp.pts != null) role = 'collectible';
    else if (vp.friend) role = 'pet';
    else if (vp.talk && !role) role = 'npc';
    else if (vp.hostile && (!role || ['critter', 'npc', 'pet', 'vehicle'].includes(role))) role = 'enemy';
    if ((np.mods || []).includes('noun:pet') || (np.mods || []).includes('noun:companion') || (np.mods || []).includes('noun:friend')) role = 'pet';
    if (np.defend) role = 'structure';
    if (isBoss || (entry && entry.role === 'boss')) role = 'boss';
    if (!role) role = unknown ? this.inferRole(np) : 'critter';
    const rd = RD[role] || RD.critter;
    const def = {};
    // look
    if (entry && entry.glyph) def.glyph = entry.glyph;
    else if (unknown && np.glyph) def.glyph = np.glyph;
    if (!def.glyph) def.shape = (entry && entry.shape) || (unknown ? pickShape(np.word || 'x') : role === 'obstacle' ? 'square' : 'blob');
    def.role = role;
    def.color = (entry && entry.c) || U.colorFromString(np.word || key || 'x');
    if (unknown && !np.glyph) def.label = U.human(np.word);
    if (np.label) def.label = np.label;
    def.size = (entry && entry.s) || rd.size;
    if (rd.speed != null || (entry && entry.v != null)) def.speed = entry && entry.v != null ? entry.v : rd.speed;
    if (role !== 'collectible' && role !== 'structure' && role !== 'obstacle' || (entry && entry.hp != null)) def.hp = entry && entry.hp != null ? entry.hp : rd.hp != null ? rd.hp : undefined;
    if (role === 'enemy' || role === 'boss') def.damage = entry && entry.dmg != null ? entry.dmg : rd.damage;
    if (role === 'hazard') def.damage = entry && entry.dmg != null ? entry.dmg : 1;
    if (entry && entry.fly) def.flying = true;
    if (entry && entry.ghost) def.ghost = true;
    if (entry && entry.static) def.static = true;
    if (entry && entry.solid) def.solid = true;
    if (entry && entry.pushable) def.pushable = true;
    if (entry && entry.bouncy) def.bouncy = 0.85;
    if (entry && entry.explosive) def.explosive = true;
    if (entry && entry.roll) def.roll = true;
    if (entry && entry.launch) def.launch = true;
    if (entry && entry.slip) def.slip = true;
    if (entry && entry.light) def.light = true;
    if (entry && entry.fx2) def.effects = entry.fx2.slice();
    if (entry && entry.tint) def.tint = entry.tint;
    if (role === 'boss' || (entry && entry.role === 'boss')) { def.boss = true; def.size = Math.max(def.size, 70); def.hp = Math.max(def.hp || 0, 25); }
    if (role === 'collectible') { def.points = entry && entry.pts != null ? entry.pts : 1; def.static = true; }
    if (role === 'obstacle' && !def.pushable) def.static = true;
    if (role === 'structure') def.static = true;
    if (unknown) def.unknown = true;
    // behaviors
    let beh = entry && entry.b ? expandBehaviors(entry.b, entry, S, this) : [];
    if (unknown && !beh.length && ['critter', 'enemy', 'npc', 'pet'].includes(role)) beh = role === 'enemy' ? [{ type: 'chase', target: 'player' }] : role === 'pet' ? [{ type: 'follow', target: 'player' }, { type: 'guard' }] : [{ type: 'wander' }];
    if (role === 'pet' && !beh.some((b) => b.type === 'follow')) beh = [{ type: 'follow', target: 'player' }, { type: 'guard' }].concat(beh.filter((b) => !MOVEMENT.has(b.type)));
    if (role === 'enemy' && entry && entry.role !== 'enemy' && entry.role !== 'boss' && !beh.some((b) => b.type === 'chase')) beh = [{ type: 'chase', target: 'player' }].concat(beh.filter((b) => !MOVEMENT.has(b.type)));
    if (np.forceFlee) beh = [{ type: 'flee', from: 'player' }];
    // adjectives & colors
    const mods = (np.mods || []).filter((m) => !/^word:/.test(m));
    for (const m of mods) this.applyAdjective(def, beh, m.replace(/^noun:/, ''), /^noun:/.test(m));
    if (np.colors && np.colors.length) { if (def.glyph) def.tint = np.colors[0]; else def.color = np.colors[0]; def.colorName = true; }
    if (def.pastel) { def.color = U.mix(def.color, '#ffffff', 0.45); if (def.tint) def.tint = U.mix(def.tint, '#ffffff', 0.45); delete def.pastel; }
    delete def.colorName;
    // verb phrase
    if (vp.b && vp.b.length) {
      const moveNew = vp.b.some((b) => MOVEMENT.has(b.type));
      if (moveNew) beh = beh.filter((b) => !MOVEMENT.has(b.type) || b.type === 'guard' && vp.friend);
      for (const b of vp.b) {
        const nb = Object.assign({}, b);
        if (nb.type === 'shoot') { nb.projectile = this.ensureProjectile(nb.projectile || (entry && entry.proj) || elementProj(def) || 'bullet', vp.customProj); if (vp.friend || role === 'pet') nb.at = nb.at || 'enemy'; beh = beh.filter((x) => x.type !== 'shoot'); }
        if (nb.type === 'chase' && nb.target && nb.target !== 'player' && nb.target !== 'enemy' && nb.target !== 'collectible' && !this.S.types[nb.target]) nb.target = this.ensureHidden(nb.target) || 'player';
        if (nb.type === 'eat' && nb.target && nb.target !== 'collectible' && !this.S.types[nb.target]) nb.target = 'collectible';
        if (!beh.some((x) => x.type === nb.type)) beh.push(nb);
      }
    }
    if (vp.fx && vp.fx.length) def.effects = uniq((def.effects || []).concat(vp.fx));
    if (vp.fly) def.flying = true;
    if (vp.bouncy) def.bouncy = 0.85;
    if (vp.explosive) def.explosive = true;
    if (vp.kamikaze) { def.kamikaze = true; def.explosive = true; }
    if (vp.invulnerable) def.invulnerable = true;
    if (vp.hpSet) def.hp = vp.hpSet;
    if (vp.speedMul && def.speed) def.speed = Math.round(def.speed * vp.speedMul);
    if (vp.glyph) { def.glyph = vp.glyph; delete def.shape; }
    if (vp.static) { def.static = true; beh = beh.filter((b) => !MOVEMENT.has(b.type)); }
    if (vp.pushable) { def.pushable = true; def.static = false; }
    if (vp.freeze) def.freeze = true;
    if (vp.hostile && role === 'enemy' && def.damage == null) def.damage = vp.dmg == null ? 1 : vp.dmg;
    if (vp.dmg != null && (role === 'enemy' || role === 'boss' || role === 'hazard')) def.damage = vp.dmg;
    if (vp.multiply) beh.push({ type: 'spawner', what: '__self__', every: 4, max: 60 });
    if (vp.split) def.onDeath = (def.onDeath || []).concat([{ type: 'split', count: 2 }]);
    if (vp.drops) { const dn = this.ensureHidden(this.addFromNP(Object.assign({}, vp.drops, { count: 0 }), { count: 0, silent: true })); def.onDeath = (def.onDeath || []).concat([{ type: 'drop', what: dn, chance: 1 }]); }
    if (vp.spawns) { const sn = this.addFromNP(Object.assign({}, vp.spawns, { count: 0 }), { count: 0, silent: true }); beh.push({ type: 'spawner', what: sn, every: vp.spawnEvery || 4, max: 20 }); }
    for (const a of vp.attrs || []) {
      if (a.b === 'shoot') { beh = beh.filter((x) => x.type !== 'shoot'); beh.push({ type: 'shoot', projectile: this.ensureProjectile(a.proj) }); if (role !== 'pet') { def.team = def.team || undefined; } }
      if (a.fly) def.flying = true;
      if (a.dmg) { def.damage = (def.damage || 0) + a.dmg; if (!beh.some((x) => x.type === 'chase') && role === 'enemy') beh.push({ type: 'chase', target: 'player' }); }
      if (a.hp) def.hp = Math.round((def.hp || 2) * a.hp);
      if (a.spiky) def.spiky = true;
      if (a.boss) { def.boss = true; def.size = Math.round(def.size * 1.6); }
      if (a.cosmetic && !a.b) def.label = def.label || (U.human(np.word || key) + ' with ' + a.key);
      if (a.b === 'magnet') beh.push({ type: 'magnet', target: 'player' });
    }
    for (const pr of vp.props || []) this.applyChange(def, beh, pr, null, true);
    if (role === 'collectible' && !(vp.b && vp.b.length)) { beh = beh.filter((b) => !MOVEMENT.has(b.type)); def.static = true; delete def.speed; delete def.hp; delete def.damage; delete def.flying; }
    // physics adaptations
    if ((ph === 'platformer' || ph === 'runner') && !def.flying && !def.static) beh = beh.map((b) => (b.type === 'wander' ? { type: 'patrol' } : b));
    if (ph === 'shmup' && (role === 'enemy' || role === 'hazard' || role === 'collectible') && !def.static && !def.boss) {
      const sh = beh.find((b) => b.type === 'shoot');
      beh = [{ type: 'fall', speed: role === 'collectible' ? 90 : Math.min(220, Math.max(70, def.speed || 100)) }];
      if (role === 'enemy') beh.push({ type: 'wave', amount: 40 });
      if (sh) beh.push(Object.assign({}, sh, { at: 'player', rate: 0.5 }));
      def.static = false;
    }
    if (beh.some((b) => b.type === 'fall') && !def.flying) def.flying = true;
    if (beh.length) def.behaviors = beh; else delete def.behaviors;
    // spawn config
    let count = opts.count != null ? opts.count : np.count != null ? np.count : rd.count;
    if (np.some && opts.count == null) count = Math.max(3, Math.round(rd.count * 0.7));
    if (entry && /^(?:portal)$/.test(key) && np.count == null) count = 2;
    if (np.vp && np.vp.where === 'random' && np.count == null && opts.count == null) count = Math.round(count * 2);
    if (count > 300) { this.warnings.push({ k: 'cap', asked: count, name: key }); count = 300; }
    let at = (np.vp && np.vp.where) || defaultSpawnAt(role, def, ph, entry);
    if (def.exit) at = 'goal';
    const spawn = { count, at };
    if (np.vp && np.vp.every) spawn.every = np.vp.every;
    if (ph === 'shmup' && (role === 'enemy' || role === 'hazard') && !def.boss) { spawn.at = 'top'; spawn.every = spawn.every || (role === 'hazard' ? 2 : 1.3); spawn.max = Math.max(12, count * 3); spawn.count = Math.min(count, 4); }
    if (beh.some((b) => b.type === 'fall')) { spawn.at = 'top'; }
    def.spawn = spawn;
    if (entry && entry.exit) def.exit = true;
    // the default player's speed bounds chasers
    const ps = this.S.player ? this.S.player.speed || 230 : 230;
    const asksFast = (np.mods || []).some((m) => /^(?:fast|quick|speedy|rapid|swift|turbo|hyper|zoomy|nimble)$/.test(m)) || (vp.speedMul || 1) > 1;
    if ((role === 'enemy' || role === 'hazard') && beh.some((b) => b.type === 'chase' || b.type === 'swarm') && def.speed > ps * 0.78 && !asksFast) {
      const was = def.speed;
      def.speed = Math.round(ps * 0.62);
      this.note('balance', { name: key, from: was, to: def.speed, player: ps });
    }
    if (def.size > 420) def.size = 420;
    def.size = Math.round(def.size);
    return { key: key || U.ident(np.word || 'thing'), def, role, unknown };
  };

  Planner.prototype.inferRole = function (np) {
    const r = (np.raw || '') + ' ' + (np.mods || []).join(' ');
    if (/\b(?:evil|angry|deadly|dangerous|killer|hostile|mean|attack|hurt|bite|enemy|monster)\b/.test(r)) return 'enemy';
    if (/\b(?:collect|pick up|gold|shiny|valuable|treasure|worth|points)\b/.test(r)) return 'collectible';
    if (/\b(?:friend|pet|helper|buddy|companion|loyal)\b/.test(r)) return 'pet';
    if (/\b(?:talk|says|speak|wise|old)\b/.test(r)) return 'npc';
    return 'critter';
  };

  function pickShape(word) { const shapes = ['blob', 'blob', 'blob', 'circle', 'diamond', 'hex', 'star', 'triangle']; return shapes[U.hash(word) % shapes.length]; }
  function uniq(a) { return [...new Set(a)]; }
  function elementProj(def) { return def.__proj || null; }
  function defaultSpawnAt(role, def, ph, entry) {
    const side = ph === 'platformer' || ph === 'runner';
    if (role === 'boss') return side ? 'sky' : 'random';
    if (role === 'enemy') return side ? (def.flying ? 'sky' : 'ground') : ph === 'shmup' ? 'top' : 'edges';
    if (role === 'collectible') return side ? 'ground' : 'random';
    if (role === 'pet') return 'near-player';
    if (role === 'structure' && entry && entry.exit) return 'goal';
    if (role === 'hazard' && def.behaviors && def.behaviors.some && def.behaviors.some((b) => b.type === 'fall')) return 'top';
    if (side && !def.flying) return 'ground';
    return 'random';
  }

  Planner.prototype.applyAdjective = function (def, beh, word, asNoun) {
    const a = L.adjectives[word];
    if (!a) {
      if (asNoun) {
        // noun used as a modifier ("zombie chicken", "robot dog", "pet rock")
        const e = L.noun(word);
        if (e) {
          if (e.role === 'enemy' || e.role === 'boss') { def.team = 'enemy'; if (def.role === 'critter' || def.role === 'npc') def.role = 'enemy'; def.damage = def.damage || 1; if (!beh.some((b) => b.type === 'chase')) { for (let i = beh.length - 1; i >= 0; i--) if (MOVEMENT.has(beh[i].type)) beh.splice(i, 1); beh.push({ type: 'chase', target: 'player' }); } if (e.c) def.tint = U.mix(e.c, def.tint || e.c, 0.5); }
          if (e.proj && !def.__proj) def.__proj = e.proj;
          if (e.fly) def.flying = true;
          if (word === 'pet' || word === 'companion') { def.role = 'pet'; }
        }
      }
      return;
    }
    if (a.size) def.size = Math.round(def.size * a.size);
    if (a.speed && def.speed != null) def.speed = Math.round(def.speed * a.speed);
    if (a.hp) def.hp = Math.max(1, Math.round((def.hp || 2) * a.hp));
    if (a.hpSet) def.hp = a.hpSet;
    if (a.dmg) def.damage = (def.damage || 0) + a.dmg;
    if (a.team === 'enemy') { def.team = 'enemy'; if (['critter', 'npc', 'pet', 'vehicle'].includes(def.role)) def.role = 'enemy'; if (def.damage == null) def.damage = 1; }
    if (a.team === 'friend') { def.team = 'friend'; if (def.role === 'enemy' || def.role === 'critter') def.role = 'pet'; for (let i = beh.length - 1; i >= 0; i--) if (beh[i].type === 'chase' && beh[i].target === 'player') beh.splice(i, 1, { type: 'follow', target: 'player' }, { type: 'guard' }); delete def.damage; }
    if (a.team === 'neutral') { def.team = 'neutral'; delete def.damage; }
    if (a.b) {
      const moving = a.b.filter((x) => MOVEMENT.has(x));
      if (moving.length) for (let i = beh.length - 1; i >= 0; i--) if (MOVEMENT.has(beh[i].type) && !(a.b.includes('zigzag') && beh[i].type !== 'zigzag')) { if (!a.b.includes('zigzag')) beh.splice(i, 1); }
      for (const b of a.b) if (!beh.some((x) => x.type === b)) beh.push(...expandBehaviors([b], {}, this.S, this));
    }
    if (a.fx) def.effects = uniq((def.effects || []).concat(a.fx));
    if (a.alpha != null) def.alpha = a.alpha;
    if (a.ghost) def.ghost = true;
    if (a.fly) def.flying = true;
    if (a.bouncy) def.bouncy = 0.85;
    if (a.explosive) def.explosive = true;
    if (a.kamikaze) def.kamikaze = true;
    if (a.sticky) def.sticky = true;
    if (a.slip) def.slip = true;
    if (a.spiky) def.spiky = true;
    if (a.invulnerable) def.invulnerable = true;
    if (a.boss) { def.boss = true; def.role = def.role === 'collectible' ? def.role : 'boss'; def.hp = Math.max(def.hp || 0, 20); }
    if (a.shape) { def.shape = a.shape; if (a.shape) delete def.glyph; }
    if (a.pastel) def.pastel = true;
    if (a.tint) { if (def.glyph) def.tint = a.tint; else def.color = U.mix(def.color, a.tint, 0.6); }
    if (a.neon) { def.color = U.hsl(U.hueOf(def.color), 100, 60); }
    if (a.smart) { for (const b of beh) if (b.type === 'chase') { b.lead = true; b.range = 0; } }
    if (a.multiply) beh.push({ type: 'spawner', what: '__self__', every: 4, max: 60 });
    if (a.split) def.onDeath = (def.onDeath || []).concat([{ type: 'split', count: 2 }]);
    if (a.pts && def.points) def.points *= a.pts;
    if (a.homing) def.homing = true;
    if (a.element) {
      const el = L.elements[a.element];
      if (def.glyph) def.tint = el.tint; else def.color = el.tint;
      if (el.fx) def.effects = uniq((def.effects || []).concat(el.fx));
      if (el.alpha) def.alpha = el.alpha;
      if (el.hp) def.hp = Math.round((def.hp || 2) * el.hp);
      if (el.speed && def.speed) def.speed = Math.round(def.speed * el.speed);
      if (el.freeze) def.freeze = true;
      if (el.aura && (def.role === 'enemy' || def.role === 'boss')) beh.push({ type: 'aura', radius: 70, damage: 1, every: 1 });
      def.__proj = el.proj;
      def.element = a.element;
      for (const b of beh) if (b.type === 'shoot' && (!b.projectile || b.projectile === 'bullet')) b.projectile = this.ensureProjectile(el.proj);
    }
  };

  // add a type from a noun phrase (+ default rules). returns final type name
  Planner.prototype.addFromNP = function (np, opts) {
    opts = opts || {};
    const S = this.S;
    if (!np) return null;
    this.npNames = this.npNames || new Map();
    if (this.npNames.has(np) && S.types[this.npNames.get(np)]) return this.npNames.get(np);
    const res = this.addFromNPInner(np, opts);
    if (res) this.npNames.set(np, res);
    return res;
  };
  Planner.prototype.addFromNPInner = function (np, opts) {
    const S = this.S;
    if (np.entry && np.entry.role === 'tile') { this.levelHazard(np.entry.tile); return null; }
    // existing type & no distinguishing modifiers -> more of it
    const baseKey = (np.entry && np.entry.generic) || np.key === 'boss' ? null : U.ident(np.key || np.word || '');
    const nameGuess = baseKey ? this.typeNameFor(np, baseKey) : null;
    if (nameGuess && S.types[nameGuess] && this.created.has(nameGuess)) { if (opts.count == null && np.count && S.types[nameGuess].spawn && !S.types[nameGuess].spawn.count) this.set('types.' + nameGuess + '.spawn.count', Math.min(600, np.count)); return nameGuess; }
    if (baseKey && S.types[baseKey] && this.created.has(baseKey) && !((np.colors || []).length)) return baseKey;
    if (nameGuess && S.types[nameGuess] && !S.types[nameGuess].projectile && !this.created.has(nameGuess)) {
      if (opts.count === 0) return nameGuess;
      const cur = S.types[nameGuess].spawn || { count: 0, at: 'random' };
      const add = np.count != null ? np.count : Math.max(3, Math.round((cur.count || 4) * 0.8));
      const to = Math.min(300, (cur.count || 0) + add);
      this.set('types.' + nameGuess + '.spawn', Object.assign({}, cur, { count: to }));
      if (np.vp) this.modifyTypes([nameGuess], [], np.vp);
      this.note('type-more', { name: nameGuess, from: cur.count || 0, to });
      this.focus.push(nameGuess);
      return nameGuess;
    }
    const built = this.buildEntity(np, opts);
    let name = baseKey ? this.typeNameFor(np, built.key) : this.typeNameFor(np, built.key);
    if (S.types[name] && !this.created.has(name)) name = name + '_2';
    // multiply placeholder
    if (built.def.behaviors) for (const b of built.def.behaviors) if (b.what === '__self__') b.what = name;
    if (built.def.onDeath) for (const a of built.def.onDeath) if (a.type === 'split' && !a.into) { /* split into self */ }
    delete built.def.__proj;
    if (opts.count === 0) built.def.spawn = Object.assign({}, built.def.spawn, { count: 0 });
    this.op({ op: 'set', path: 'types.' + name, value: built.def });
    this.created.add(name);
    this.focus.push(name);
    if (!opts.silent) this.note('type-new', { name, def: built.def, role: built.role, unknown: built.unknown, np: { word: np.word, mods: np.mods, colors: np.colors, count: np.count } });
    else this.note('type-hidden', { name, def: built.def });
    this.defaultRules(name, built.def, np, opts);
    if (!opts.noPlayer && !S.player) this.ensurePlayer(name);
    return name;
  };

  Planner.prototype.findRule = function (pred) { return this.S.rules.find(pred); };
  Planner.prototype.addRule = function (rule, why) {
    const S = this.S;
    const same = S.rules.find((r) => U.same(r.when, rule.when) && !r.cond && !rule.cond);
    if (same) {
      // merge new actions into the existing rule
      const merged = same.then.slice();
      let changed = false;
      for (const a of rule.then) {
        const i = merged.findIndex((b) => b.type === a.type && (b.target || '') === (a.target || '') && !['spawn', 'say', 'banner'].includes(a.type));
        if (i >= 0) { if (!U.same(merged[i], a)) { merged[i] = a; changed = true; } }
        else { merged.push(a); changed = true; }
      }
      // keep destroy last
      merged.sort((a, b) => (a.type === 'destroy') - (b.type === 'destroy'));
      if (!changed) return same;
      const nr = Object.assign({}, same, { then: merged });
      if (rule.note && !same.note) nr.note = rule.note;
      this.op({ op: 'setRule', id: same.id, rule: nr });
      this.note('rule-merge', { rule: nr, why });
      return nr;
    }
    const r = Object.assign({ id: Spec.nextRuleId(S) }, rule);
    this.op({ op: 'addRule', rule: r });
    this.note('rule-new', { rule: r, why });
    return r;
  };

  Planner.prototype.defaultRules = function (name, def, np, opts) {
    const S = this.S, ph = S.world.physics, role = def.role;
    const H = U.human(name);
    if (def.projectile) return;
    if (role === 'collectible') {
      const acts = [];
      if (def.points) acts.push({ type: 'addScore', amount: def.points });
      const fx = np && np.entry && np.entry.fx;
      const vp = (np && np.vp) || {};
      const fx2 = vp.fx2 || fx;
      if (fx2 === 'heal' || vp.heal) acts.push({ type: 'heal', target: 'player', amount: vp.amount || 1 });
      if (fx2 === 'grow') acts.push({ type: 'powerup', kind: 'giant', seconds: 6 });
      if (fx2 === 'speed') acts.push({ type: 'powerup', kind: 'speed', seconds: 5 });
      if (fx2 === 'time') acts.push({ type: 'addTime', seconds: 10 });
      if (fx2 === 'invincible') acts.push({ type: 'powerup', kind: 'invincible', seconds: 6 });
      if (fx2 === 'magnet') acts.push({ type: 'powerup', kind: 'magnet', seconds: 8 });
      if (fx2 === 'fly') acts.push(SIDE(S) ? { type: 'powerup', kind: 'fly', seconds: 6 } : { type: 'powerup', kind: 'speed', seconds: 4 });
      if (fx2 === 'ability:shoot') acts.push({ type: 'giveAbility', ability: 'shoot' });
      if (fx2 === 'ability:melee') acts.push({ type: 'giveAbility', ability: 'melee' });
      if (fx2 === 'key') acts.push({ type: 'banner', text: 'GOT THE ' + H.toUpperCase() });
      if (fx2 === 'win') acts.push({ type: 'win', text: 'YOU FOUND THE ' + H.toUpperCase() });
      if (np && np.rescue) acts.push({ type: 'say', target: 'self', text: 'Thank you!' });
      if (ph === 'snake') acts.push({ type: 'growTail', amount: 1 }, { type: 'spawn', what: name, count: 1, at: 'random' });
      acts.push({ type: 'destroy', target: name });
      acts.push({ type: 'sound', name: acts.some((a) => a.type === 'powerup' || a.type === 'heal' || a.type === 'giveAbility') ? 'powerup' : 'coin' });
      this.addRule({ when: { type: 'onCollide', a: 'player', b: name }, then: acts, note: (np && np.rescue ? 'rescue ' : 'collect ') + U.plural(H, 2) }, 'collect');
      if (fx2 === 'key') this.ensureDoorForKey(name);
      if (np && np.rescue) this.note('consider', { text: 'rescue' });
    } else if (role === 'enemy' || role === 'boss') {
      if (opts && opts.count === 0 && !def.boss) { /* spawned-only type still gives points */ }
      const acts = [{ type: 'addScore', amount: def.boss ? 100 : def.hp >= 5 ? 25 : 10 }];
      if (def.boss) {
        acts.push({ type: 'confetti' });
        const hasWin = S.rules.some((r) => r.then.some((a) => a.type === 'win'));
        if (!hasWin) { acts.push({ type: 'win', text: H.toUpperCase() + ' DEFEATED' }); this.note('consider', { text: 'bosswin', name }); }
      }
      this.addRule({ when: { type: 'onDeath', of: name }, then: acts, note: 'reward for defeating ' + U.plural(H, def.boss ? 1 : 2) }, 'score');
    } else if (role === 'npc' || (np && np.vp && np.vp.talk)) {
      const line = (np && (np.quote || (np.vp && (np.vp.quote || (np.vp.sayText && np.vp.sayText.length > 2 ? np.vp.sayText : null))))) || this.lineFor(name, np);
      this.addRule({ when: { type: 'onNear', a: 'player', b: name, distance: 100 }, then: [{ type: 'say', target: name, text: line }], note: H + ' talks to you' }, 'talk');
      if (np && np.entry && np.entry.recursion) this.flags.recursion = true;
    } else if (role === 'structure') {
      const key = np && np.key;
      if (def.exit) {
        this.addRule({ when: { type: 'onCollide', a: 'player', b: name }, then: [{ type: 'confetti' }, { type: 'nextLevel' }], note: 'reach the ' + H + ' to advance' }, 'exit');
      } else if (key === 'portal') {
        this.addRule({ when: { type: 'onCollide', a: 'player', b: name }, then: [{ type: 'teleport', target: 'player', to: 'random' }, { type: 'sound', name: 'magic' }], note: 'portals teleport you' }, 'portal');
      } else if (key === 'campfire' || key === 'fountain' || key === 'shrine' || key === 'bed') {
        this.addRule({ when: { type: 'onNear', a: 'player', b: name, distance: 90 }, then: [{ type: 'heal', target: 'player', amount: 1 }, { type: 'say', target: name, text: key === 'bed' ? 'Zzz… HP restored.' : 'You feel rested.' }], note: H + ' heals you' }, 'heal');
      } else if (key === 'computer' || key === 'laptop') {
        this.addRule({ when: { type: 'onNear', a: 'player', b: name, distance: 90 }, then: [{ type: 'say', target: name, text: U.pick(L.lines.computer, this.rng) }], note: 'a computer, running VibeCode' }, 'talk');
        this.flags.recursion = true;
      } else if (key === 'sign') {
        this.addRule({ when: { type: 'onNear', a: 'player', b: name, distance: 90 }, then: [{ type: 'say', target: name, text: (np && np.quote) || U.pick(L.lines.sign, this.rng) }], note: 'read the sign' }, 'talk');
      } else if (np && np.defend || ['castle', 'core', 'base', 'tower', 'house'].includes(key) && /defend|protect/.test((np && np.raw) || '')) {
        this.defendTarget(name);
      }
    } else if (role === 'pet') {
      if (np && np.key === 'rubber_duck') { this.addRule({ when: { type: 'onNear', a: 'player', b: name, distance: 70 }, then: [{ type: 'say', target: name, text: U.pick(L.lines.rubber_duck, this.rng) }, { type: 'sound', name: 'quack' }], note: 'rubber duck debugging' }, 'talk'); this.flags.duck = true; }
      else if (np && L.lines[np.key]) this.addRule({ when: { type: 'onNear', a: 'player', b: name, distance: 60 }, then: [{ type: 'say', target: name, text: U.pick(L.lines[np.key], this.rng) }], note: H + ' says hi' }, 'talk');
    }
    // talkers that aren't npcs
    if (role !== 'npc' && np && np.vp && np.vp.talk && !this.S.rules.some((r) => r.when.type === 'onNear' && r.when.b === name)) {
      const line = np.quote || np.vp.quote || this.lineFor(name, np);
      this.addRule({ when: { type: 'onNear', a: 'player', b: name, distance: 100 }, then: [{ type: 'say', target: name, text: line }], note: H + ' talks' }, 'talk');
    }
  };

  Planner.prototype.lineFor = function (name, np) {
    const key = np && np.key;
    const pool = L.lines[key] || L.lines[name] || L.lines.generic;
    return U.pick(pool, this.rng);
  };

  Planner.prototype.ensureDoorForKey = function (keyName) {
    const S = this.S;
    let door = Object.keys(S.types).find((n) => S.types[n].exit);
    if (!door) door = this.addFromNP({ key: 'door', word: 'door', entry: L.noun('door'), mods: [], colors: [], count: 1 }, { silent: false });
    const r = S.rules.find((x) => x.when.type === 'onCollide' && x.when.b === door);
    if (r && !r.cond) this.op({ op: 'setRule', id: r.id, rule: Object.assign({}, r, { cond: { collected: keyName, atLeast: 1 }, note: 'the ' + U.human(door) + ' needs the ' + U.human(keyName) }) });
    this.note('consider', { text: 'keydoor', key: keyName, door });
  };

  Planner.prototype.defendTarget = function (name) {
    const S = this.S;
    const d = S.types[name];
    if (!d.hp || d.hp >= 99) this.set('types.' + name + '.hp', 30);
    this.set('types.' + name + '.spawn', { count: 1, at: 'center' });
    this.set('types.' + name + '.static', true);
    this.addRule({ when: { type: 'onDeath', of: name }, then: [{ type: 'lose', text: 'THE ' + U.human(name).toUpperCase() + ' FELL' }], note: 'protect the ' + U.human(name) }, 'defend');
    for (const e of Spec.typesByRole(S, 'enemy')) {
      const beh = (S.types[e].behaviors || []).map((b) => (b.type === 'chase' && b.target === 'player' ? Object.assign({}, b, { target: name }) : b));
      this.set('types.' + e + '.behaviors', beh);
    }
    this.flags.defend = name;
    this.note('consider', { text: 'defend', name });
  };

  // ---------------------------------------------------------------------------
  // modifications
  // ---------------------------------------------------------------------------
  Planner.prototype.applyChange = function (def, beh, ch, name, building) {
    const fmt = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
    const rec = (prop, from, to) => { if (!building && !U.same(from, to)) this.changes.push({ name, prop, from: fmt(from), to: fmt(to) }); };
    switch (ch.prop) {
      case 'speed': { const f = def.speed == null ? 80 : def.speed; const t = ch.set != null ? ch.set : Math.round(f * ch.mul); def.speed = U.clamp(t, 0, 3000); for (const b of beh) if (b.speed != null) b.speed = Math.round(b.speed * (ch.mul || 1)); rec('speed', f, def.speed); break; }
      case 'size': { const f = def.size || 28; def.size = U.clamp(Math.round(ch.set != null ? ch.set : f * ch.mul), 4, 420); rec('size', f, def.size); break; }
      case 'hp': { const f = def.hp == null ? 2 : def.hp; def.hp = Math.max(1, Math.round(ch.set != null ? ch.set : f * ch.mul)); if (ch.mul && ch.mul > 1 && def.hp === f) def.hp = f + 1; rec('hp', f, def.hp); break; }
      case 'damage': { const f = def.damage || 0; def.damage = Math.max(0, Math.round(ch.set != null ? ch.set : Math.max(1, f) * ch.mul)); rec('damage', f, def.damage); break; }
      case 'invulnerable': def.invulnerable = ch.set; rec('invulnerable', false, ch.set); break;
      case 'hostile': {
        const was = def.role;
        def.team = 'enemy'; if (['critter', 'npc', 'pet', 'vehicle', 'collectible'].includes(def.role) && def.role !== 'collectible') def.role = 'enemy';
        if (def.role === 'collectible') def.role = 'hazard';
        def.damage = Math.max(1, (def.damage || 1) * (ch.dmgMul || 1));
        if (!def.static && !beh.some((b) => b.type === 'chase' || b.type === 'shoot' || b.type === 'charge')) { for (let i = beh.length - 1; i >= 0; i--) if (MOVEMENT.has(beh[i].type)) beh.splice(i, 1); beh.push({ type: 'chase', target: 'player' }); }
        for (let i = 0; i < beh.length; i++) if (beh[i].type === 'follow' || beh[i].type === 'guard') beh.splice(i--, 1);
        if (!beh.some((b) => MOVEMENT.has(b.type)) && !def.static) beh.push({ type: 'chase', target: 'player' });
        rec('team', was, 'enemy');
        break;
      }
      case 'friendly': {
        const was = def.team || def.role;
        def.team = 'friend'; if (def.role === 'enemy' || def.role === 'boss' || def.role === 'critter') def.role = 'pet';
        for (let i = beh.length - 1; i >= 0; i--) if ((beh[i].type === 'chase' || beh[i].type === 'charge' || beh[i].type === 'swarm') && (beh[i].target === 'player' || !beh[i].target)) beh.splice(i, 1);
        if (!beh.some((b) => b.type === 'follow')) beh.unshift({ type: 'follow', target: 'player' }, { type: 'guard' });
        for (const b of beh) if (b.type === 'shoot') b.at = 'enemy';
        def.damage = def.damage || 1;
        rec('team', was, 'friend');
        break;
      }
      case 'points': { const f = def.points || 0; def.points = Math.max(0, Math.round(ch.set != null ? ch.set : Math.max(1, f) * ch.mul)); rec('points', f, def.points); break; }
      case 'collectible': if (def.role !== 'collectible') { rec('role', def.role, 'collectible'); def.role = 'collectible'; def.points = def.points || 1; delete def.damage; def.team = 'neutral'; this.pendingCollect = (this.pendingCollect || []).concat(name || []); } break;
      case 'alpha': rec('alpha', def.alpha == null ? 1 : def.alpha, ch.set); def.alpha = ch.set; if (ch.set >= 1) delete def.alpha; break;
      case 'color': rec('color', def.tint || def.color, ch.set); if (def.glyph) def.tint = ch.set; else def.color = ch.set; break;
      case 'fx': if (!(def.effects || []).includes(ch.add)) { def.effects = (def.effects || []).concat(ch.add); rec('effects', '', ch.add); } break;
      case 'flying': rec('flying', !!def.flying, ch.set); def.flying = ch.set; if (!ch.set) delete def.flying; break;
      case 'ghost': def.ghost = true; def.alpha = def.alpha == null ? 0.6 : def.alpha; rec('ghost', false, true); break;
      case 'bouncy': def.bouncy = ch.set; rec('bouncy', 0, ch.set); if (!beh.some((b) => b.type === 'hop')) beh.push({ type: 'hop' }); break;
      case 'explosive': def.explosive = true; rec('explosive', false, true); break;
      case 'smart': for (const b of beh) if (b.type === 'chase') { b.lead = true; b.range = 0; } if (!beh.some((b) => b.type === 'chase') && def.role === 'enemy') beh.push({ type: 'chase', target: 'player', lead: true }); rec('chase', 'basic', 'predictive'); break;
      case 'dumb': for (let i = beh.length - 1; i >= 0; i--) if (beh[i].type === 'chase') beh.splice(i, 1, { type: 'wander' }); rec('ai', 'chase', 'wander'); break;
      case 'static': if (ch.set) { def.static = true; for (let i = beh.length - 1; i >= 0; i--) if (MOVEMENT.has(beh[i].type)) beh.splice(i, 1); } else { delete def.static; if (!beh.some((b) => MOVEMENT.has(b.type))) beh.push({ type: 'wander' }); } rec('static', !ch.set, ch.set); break;
      case 'pushable': def.pushable = true; delete def.static; rec('pushable', false, true); break;
      case 'gravity': def.gravity = Math.round((def.gravity == null ? 1 : def.gravity) * ch.mul * 100) / 100; rec('gravity', 1, def.gravity); break;
      case 'count': { const s = def.spawn || { count: 0, at: 'random' }; const f = s.count || 0; const t = Math.min(300, Math.max(0, Math.round(ch.set != null ? ch.set : Math.max(f, 1) * ch.mul))); def.spawn = Object.assign({}, s, { count: t }); rec('count', f, t); break; }
      case 'respawn': def.spawn = Object.assign({}, def.spawn || { count: 4, at: 'random' }, { every: 4 }); rec('respawn', 'no', 'every 4s'); break;
      case 'shape': rec('shape', def.shape || def.glyph, ch.set); def.shape = ch.set; delete def.glyph; break;
      case 'adj': this.applyAdjective(def, beh, ch.adj, false); if (!building) this.changes.push({ name, prop: 'trait', from: '', to: ch.adj }); break;
      case 'fireRate': for (const b of beh) if (b.type === 'shoot') { const f = b.rate || 0.55; b.rate = Math.round(f * ch.mul * 100) / 100; rec('fire rate', f, b.rate); } break;
      case 'transform': break;
      default: break;
    }
  };

  Planner.prototype.modifyTypes = function (names, changes, vp) {
    const S = this.S;
    this.changes = this.changes || [];
    for (const name of names) {
      const cur = S.types[name];
      if (!cur) continue;
      const def = U.clone(cur);
      const beh = (def.behaviors || []).slice();
      for (const ch of changes || []) {
        if (ch.prop === 'transform' && ch.np) { this.renameType(name, ch.np); continue; }
        this.applyChange(def, beh, ch, name, false);
      }
      if (vp) this.applyVP(def, beh, vp, name);
      if (beh.length) def.behaviors = beh; else delete def.behaviors;
      if (!U.same(def, S.types[name]) && S.types[name]) {
        this.op({ op: 'set', path: 'types.' + name, value: def });
        this.focus.push(name);
      }
      if (this.pendingCollect && this.pendingCollect.includes(name)) this.defaultRules(name, def, { key: name }, {});
    }
    this.pendingCollect = null;
  };

  Planner.prototype.applyVP = function (def, beh, vp, name) {
    const rec = (prop, to) => this.changes.push({ name, prop, from: '', to });
    if (vp.b && vp.b.length) {
      const moveNew = vp.b.some((b) => MOVEMENT.has(b.type));
      if (moveNew) for (let i = beh.length - 1; i >= 0; i--) if (MOVEMENT.has(beh[i].type)) beh.splice(i, 1);
      for (const b of vp.b) {
        const nb = Object.assign({}, b);
        if (nb.type === 'shoot') { nb.projectile = this.ensureProjectile(nb.projectile || (L.noun(name) && L.noun(name).proj) || def.element && L.elements[def.element].proj || 'bullet', vp.customProj); for (let i = beh.length - 1; i >= 0; i--) if (beh[i].type === 'shoot') beh.splice(i, 1); if (def.team === 'friend' || def.role === 'pet') nb.at = nb.at || 'enemy'; }
        if (nb.type === 'chase' && nb.target && !['player', 'enemy', 'collectible'].includes(nb.target) && !this.S.types[nb.target]) nb.target = this.ensureHidden(nb.target) || 'player';
        beh.push(nb);
        rec('behavior', VC.DSL.describeBehavior(nb));
        if ((nb.type === 'chase' || nb.type === 'charge') && nb.target === 'player' && def.role !== 'enemy' && def.role !== 'boss') { def.team = 'enemy'; if (def.role !== 'collectible') def.role = 'enemy'; def.damage = def.damage || 1; }
        if (nb.type === 'shoot' && def.role === 'critter') { def.team = 'enemy'; def.role = 'enemy'; }
        if (def.static && MOVEMENT.has(nb.type)) delete def.static;
      }
    }
    if (vp.fx && vp.fx.length) { def.effects = uniq((def.effects || []).concat(vp.fx)); rec('effects', vp.fx.join(', ')); }
    if (vp.fly) { def.flying = true; rec('flying', true); }
    if (vp.explosive) { def.explosive = true; rec('explodes', 'on death'); }
    if (vp.kamikaze) { def.kamikaze = true; def.explosive = true; rec('kamikaze', true); }
    if (vp.multiply) { beh.push({ type: 'spawner', what: name, every: 4, max: 60 }); rec('multiplies', true); }
    if (vp.split) { def.onDeath = (def.onDeath || []).filter((a) => a.type !== 'split').concat([{ type: 'split', count: 2 }]); rec('splits', 'on death'); }
    if (vp.drops) { const dn = this.addFromNP(Object.assign({}, vp.drops, { count: 0 }), { count: 0, silent: true }); def.onDeath = (def.onDeath || []).concat([{ type: 'drop', what: dn, chance: 1 }]); rec('drops', dn); }
    if (vp.spawns) { const sn = this.addFromNP(Object.assign({}, vp.spawns, { count: 0 }), { count: 0, silent: true }); beh.push({ type: 'spawner', what: sn, every: vp.spawnEvery || 4, max: 20 }); rec('spawns', sn); }
    if (vp.hostile && def.role !== 'enemy' && def.role !== 'boss') this.applyChange(def, beh, { prop: 'hostile', set: true }, name);
    if (vp.friend) this.applyChange(def, beh, { prop: 'friendly', set: true }, name);
    if (vp.collect) { this.applyChange(def, beh, { prop: 'collectible', set: true }, name); if (vp.pts != null) def.points = vp.pts; }
    if (vp.invulnerable) def.invulnerable = true;
    if (vp.hpSet) def.hp = vp.hpSet;
    if (vp.speedMul && def.speed) def.speed = Math.round(def.speed * vp.speedMul);
    if (vp.static) { def.static = true; for (let i = beh.length - 1; i >= 0; i--) if (MOVEMENT.has(beh[i].type)) beh.splice(i, 1); }
    if (vp.freeze) def.freeze = true;
    if (vp.bouncy) def.bouncy = 0.85;
    if (vp.talk) {
      const line = vp.quote || (vp.sayText && vp.sayText.length > 2 ? vp.sayText : null) || this.lineFor(name, { key: name });
      this.addRule({ when: { type: 'onNear', a: 'player', b: name, distance: 100 }, then: [{ type: 'say', target: name, text: line }], note: U.human(name) + ' talks' }, 'talk');
    }
    for (const pr of vp.props || []) this.applyChange(def, beh, pr, name, false);
    for (const a of vp.attrs || []) if (a.b === 'shoot') { for (let i = beh.length - 1; i >= 0; i--) if (beh[i].type === 'shoot') beh.splice(i, 1); beh.push({ type: 'shoot', projectile: this.ensureProjectile(a.proj) }); rec('behavior', 'shoots'); } else if (a.fly) def.flying = true;
  };

  Planner.prototype.renameType = function (name, np) {
    const S = this.S;
    const entry = np.entry || (np.key ? L.noun(np.key) : null);
    let to = U.ident(np.key || np.word);
    if (to === name) return;
    if (S.types[to]) to = to + '_2';
    this.op({ op: 'rename', from: name, to });
    const def = U.clone(S.types[to]);
    if (entry && entry.glyph) { def.glyph = entry.glyph; delete def.shape; delete def.label; }
    else if (np.glyph) { def.glyph = np.glyph; delete def.shape; delete def.label; }
    else { delete def.glyph; def.shape = pickShape(to); def.label = U.human(to); }
    delete def.tint;
    if (entry && entry.c) def.color = entry.c;
    if (np.colors && np.colors.length) { if (def.glyph) def.tint = np.colors[0]; else def.color = np.colors[0]; }
    this.op({ op: 'set', path: 'types.' + to, value: def });
    this.note('rename', { from: name, to, glyph: def.glyph });
    this.flags.rename = true;
    this.focus.push(to);
  };

  Planner.prototype.modifyPlayer = function (changes, vp) {
    this.ensurePlayer('modify');
    const S = this.S;
    const p = U.clone(S.player);
    const ab = p.abilities = p.abilities || {};
    const ch2 = [];
    const rec = (prop, from, to) => ch2.push({ name: 'player', prop, from, to });
    for (const ch of changes || []) {
      switch (ch.prop) {
        case 'speed': { const f = p.speed || 230; p.speed = U.clamp(Math.round(ch.set != null ? ch.set : f * ch.mul), 10, 2400); rec('speed', f, p.speed); break; }
        case 'size': { const f = p.size || 28; p.size = U.clamp(Math.round(ch.set != null ? ch.set : f * ch.mul), 6, 300); rec('size', f, p.size); break; }
        case 'hp': { const f = p.hp || 5; p.hp = U.clamp(Math.round(ch.set != null ? ch.set : Math.max(f + 1, f * ch.mul)), 1, 999); rec('hp', f, p.hp); break; }
        case 'lives': { const f = p.lives || 1; p.lives = U.clamp(ch.set || f + 1, 1, 99); rec('lives', f, p.lives); break; }
        case 'invulnerable': p.invulnerable = true; rec('invulnerable', false, true); this.flags.godmode = true; break;
        case 'color': rec('color', p.tint || p.color, ch.set); if (p.glyph) p.tint = ch.set; else p.color = ch.set; break;
        case 'fx': p.effects = uniq((p.effects || []).concat(ch.add)); rec('effects', '', ch.add); break;
        case 'alpha': p.alpha = ch.set; rec('alpha', 1, ch.set); break;
        case 'ghost': p.ghost = true; rec('ghost', false, true); break;
        case 'flying': if (SIDE(S)) { ab.fly = ab.fly || { power: 2400 }; rec('ability', '', 'fly'); } else { p.flying = true; rec('flying', false, true); } break;
        case 'jump': { ab.jump = ab.jump || { power: 640 }; const f = ab.jump.power || 640; ab.jump.power = U.clamp(Math.round(f * (ch.mul || 1.25)), 200, 2400); rec('jump power', f, ab.jump.power); if (!SIDE(S)) this.note('consider', { text: 'jumpTopdown' }); break; }
        case 'fireRate': if (ab.shoot) { const f = ab.shoot.rate || 4; ab.shoot.rate = Math.round(f * ch.mul * 10) / 10; rec('fire rate', f, ab.shoot.rate); } break;
        case 'shape': p.shape = ch.set; delete p.glyph; rec('shape', '', ch.set); break;
        case 'adj': {
          const a = L.adjectives[ch.adj] || {};
          if (a.size) { const f = p.size; p.size = U.clamp(Math.round(p.size * a.size), 6, 300); rec('size', f, p.size); }
          if (a.speed) { const f = p.speed; p.speed = Math.round(p.speed * a.speed); rec('speed', f, p.speed); }
          if (a.hp) { const f = p.hp; p.hp = Math.max(1, Math.round(p.hp * a.hp)); rec('hp', f, p.hp); }
          if (a.fx) p.effects = uniq((p.effects || []).concat(a.fx));
          if (a.alpha != null) p.alpha = a.alpha;
          if (a.invulnerable) { p.invulnerable = true; this.flags.godmode = true; }
          if (a.ghost) p.ghost = true;
          if (a.element) { const el = L.elements[a.element]; if (p.glyph) p.tint = el.tint; else p.color = el.tint; p.effects = uniq((p.effects || []).concat(el.fx || [])); if (ab.shoot) ab.shoot.projectile = this.ensureProjectile(el.proj); }
          if (a.tint) { if (p.glyph) p.tint = a.tint; else p.color = a.tint; }
          break;
        }
        case 'hostile': case 'friendly': case 'count': break;
        case 'difficulty': this.difficulty(ch.set); break;
        default: break;
      }
    }
    if (vp) {
      if (vp.fly) { if (SIDE(S)) ab.fly = { power: 2400 }; else p.flying = true; rec('flying', false, true); }
      if (vp.fx && vp.fx.length) p.effects = uniq((p.effects || []).concat(vp.fx));
      for (const b of vp.b || []) if (b.type === 'shoot') { ab.shoot = Object.assign({}, ab.shoot || {}, { projectile: this.ensureProjectile(b.projectile || 'bullet', vp.customProj), rate: (ab.shoot && ab.shoot.rate) || 4, aim: (ab.shoot && ab.shoot.aim) || this.defaultAim() }); rec('ability', '', 'shoot'); }
    }
    if (!U.same(p, S.player)) {
      this.op({ op: 'set', path: 'player', value: p });
      this.note('player-mod', { changes: ch2 });
    }
  };

  Planner.prototype.defaultAim = function () { const ph = this.S.world.physics; return ph === 'shmup' ? 'up' : ph === 'ship' || ph === 'tank' ? 'facing' : SIDE(this.S) ? 'facing' : 'mouse'; };

  Planner.prototype.playerSkin = function (np) {
    const created = this.ensurePlayer('skin');
    const S = this.S;
    const p = U.clone(S.player);
    const before = p.glyph || p.shape;
    let entry = np.entry;
    if (entry && entry.generic) { const k = this.resolveGeneric(np); entry = L.noun(k); np.key = k; }
    if (entry && entry.glyph) { p.glyph = entry.glyph; delete p.shape; delete p.label; }
    else if (np.glyph) { p.glyph = np.glyph; delete p.shape; delete p.label; }
    else { delete p.glyph; p.shape = pickShape(np.word || 'x'); p.label = U.titleCase(U.human(np.word || 'you')); }
    if (entry && entry.c) p.color = entry.c;
    delete p.tint;
    if (np.colors && np.colors.length) { if (p.glyph) p.tint = np.colors[0]; else p.color = np.colors[0]; }
    if (np.label) p.label = np.label;
    for (const m of np.mods || []) {
      const a = L.adjectives[m.replace(/^noun:/, '')];
      if (!a) continue;
      if (a.size) p.size = U.clamp(Math.round((p.size || 28) * a.size), 6, 300);
      if (a.speed) p.speed = Math.round((p.speed || 230) * a.speed);
      if (a.hp) p.hp = Math.max(1, Math.round((p.hp || 5) * a.hp));
      if (a.fx) p.effects = uniq((p.effects || []).concat(a.fx));
      if (a.element) { const el = L.elements[a.element]; if (p.glyph) p.tint = el.tint; else p.color = el.tint; p.effects = uniq((p.effects || []).concat(el.fx || [])); }
      if (a.fly) p.flying = true;
      if (a.ghost) p.ghost = true;
    }
    if (entry && entry.v && entry.role === 'vehicle') p.speed = Math.max(p.speed || 230, entry.v);
    if (entry && entry.role === 'boss') { p.size = Math.max(p.size, 44); p.hp = Math.max(p.hp || 5, 8); }
    if (entry && entry.fly && !SIDE(S)) p.flying = true;
    // projectile flavor
    const proj = entry && entry.proj;
    if (proj && p.abilities && p.abilities.shoot) p.abilities.shoot = Object.assign({}, p.abilities.shoot, { projectile: this.ensureProjectile(proj) });
    this.op({ op: 'set', path: 'player', value: p });
    this.note('player-skin', { from: before, to: p.glyph || p.shape, word: np.word, key: np.key, glyph: p.glyph, proj: proj || null, hasShoot: !!(p.abilities && p.abilities.shoot), created, vehicle: entry && entry.role === 'vehicle' });
    if (np.key === 'cat' || np.key === 'kitten') this.flags.cat = true;
    if (np.vp) this.modifyPlayer(np.vp.props || [], np.vp);
  };

  Planner.prototype.giveAbility = function (name, params, extra) {
    this.ensurePlayer('ability');
    const S = this.S, ph = S.world.physics;
    const p = U.clone(S.player);
    const ab = p.abilities = p.abilities || {};
    const cur = ab[name];
    let next;
    switch (name) {
      case 'jump': {
        next = Object.assign({}, cur || { power: 640 });
        if (params.double) next.double = true;
        if (params.extra) next.extra = params.extra;
        if (params.wall) next.wall = true;
        if (params.power) next.power = params.power;
        if (params.mul) next.power = Math.round((next.power || 640) * params.mul);
        if (!SIDE(S)) this.note('consider', { text: 'jumpTopdown' });
        break;
      }
      case 'shoot': {
        const proj = this.ensureProjectile(params.projectile || (cur && cur.projectile) || playerProj(S, this), extra && extra.customProj);
        next = Object.assign({}, cur || {}, { projectile: proj, rate: params.rate || (cur && cur.rate) || 4, aim: params.aim || (cur && cur.aim) || this.defaultAim() });
        if (params.count) next.count = params.count; if (params.spread) next.spread = params.spread; if (params.auto) next.auto = true;
        if (L.projectiles[proj] && L.projectiles[proj].v < 400 && !params.rate) next.rate = 3;
        break;
      }
      default: next = Object.assign(VC.Engine.defaultAbility(name, S), cur || {}, params || {});
    }
    if (name === 'fly' && !SIDE(S)) { p.flying = true; this.note('consider', { text: 'flyTopdown' }); }
    ab[name] = next;
    this.op({ op: 'set', path: 'player', value: p });
    this.note('ability', { name, params: next, had: !!cur, physics: ph });
  };
  function playerProj(S, P2) {
    const p = S.player;
    const e = p && p.glyph ? Object.values(L.nounKeys ? {} : {}) : null; void e; void P2;
    // find a projectile flavor from the player's glyph
    if (p && p.glyph) for (const k of L.nounKeys()) { const en = L.noun(k); if (en.glyph === p.glyph && en.proj) return en.proj; }
    const th = L.themes[S.meta.theme];
    if (th && /space|city|lab|synthwave/.test(S.meta.theme)) return 'laser';
    if (th && /fantasy|spooky/.test(S.meta.theme)) return 'magic';
    return 'bullet';
  }

  Planner.prototype.removeAbility = function (verb) {
    const S = this.S;
    if (!S.player) return;
    const p = U.clone(S.player);
    const ab = p.abilities || {};
    const v = String(verb || '').toLowerCase();
    const map = [[/shoot|gun|weapon|fire|bullet/, 'shoot'], [/double ?jump/, 'jump.double'], [/wall ?jump/, 'jump.wall'], [/^jump|jumping/, 'jump'], [/dash|roll/, 'dash'], [/fly|jetpack|flight/, 'fly'], [/sword|melee|attack|swing/, 'melee'], [/shield|block/, 'shield'], [/bomb/, 'bomb'], [/teleport|blink/, 'blink'], [/bullet time|slow/, 'slowtime'], [/magnet/, 'magnet'], [/regen|heal/, 'regen'], [/tail/, 'tail']];
    let removed = null;
    for (const [re, k] of map) if (re.test(v)) {
      if (k.includes('.')) { const [a, b] = k.split('.'); if (ab[a]) { delete ab[a][b]; removed = k; } }
      else if (ab[k]) { delete ab[k]; removed = k; }
      break;
    }
    if (!removed) { this.note('noop', { what: verb }); return; }
    this.op({ op: 'set', path: 'player', value: p });
    this.note('ability-remove', { name: removed });
  };

  // ---------------------------------------------------------------------------
  // world / environment
  // ---------------------------------------------------------------------------
  Planner.prototype.setPhysics = function (ph, why) {
    const S = this.S;
    if (S.world.physics === ph) return false;
    const from = S.world.physics;
    this.set('world.physics', ph);
    this.note('physics', { from, to: ph, why });
    // adapt the player
    if (S.player) {
      const p = U.clone(S.player);
      p.abilities = p.abilities || {};
      if ((ph === 'platformer' || ph === 'runner') && !p.abilities.jump && !p.abilities.flap && !p.abilities.fly) p.abilities.jump = { power: 640 };
      if (ph === 'snake') p.abilities.tail = p.abilities.tail || { length: 3 };
      if (ph === 'shmup' && p.abilities.shoot) p.abilities.shoot.aim = 'up';
      if ((ph === 'ship' || ph === 'tank') && p.abilities.shoot) p.abilities.shoot.aim = 'facing';
      if (ph === 'topdown' && p.abilities.shoot && p.abilities.shoot.aim === 'up') p.abilities.shoot.aim = 'mouse';
      this.op({ op: 'set', path: 'player', value: p });
    }
    // adapt entities
    for (const [n, d] of Object.entries(S.types)) {
      if (d.projectile || !d.spawn) continue;
      const side = ph === 'platformer' || ph === 'runner';
      const sp = Object.assign({}, d.spawn);
      if (side && !d.flying && (sp.at === 'random' || sp.at === 'edges')) sp.at = 'ground';
      if (!side && sp.at === 'ground') sp.at = d.role === 'enemy' ? 'edges' : 'random';
      if (!U.same(sp, d.spawn)) this.set('types.' + n + '.spawn', sp);
      if (side && d.behaviors && d.behaviors.some((b) => b.type === 'wander') && !d.flying) this.set('types.' + n + '.behaviors', d.behaviors.map((b) => (b.type === 'wander' ? { type: 'patrol' } : b)));
    }
    return true;
  };

  Planner.prototype.levelType = function (type, why) {
    const S = this.S;
    this.levelTouched = true;
    if (type === 'platforms' || type === 'tower' || type === 'pipes' || type === 'runner') {
      if (!SIDE(S) && type !== 'pipes') this.setPhysics(type === 'runner' ? 'runner' : 'platformer', 'level');
      if (type === 'pipes') { this.setPhysics('platformer', 'level'); }
    }
    if (type === 'track' && S.world.physics === 'topdown') this.setPhysics('tank', 'track');
    if (S.level.type === type) { this.reseed(); return; }
    const from = S.level.type;
    this.set('level.type', type);
    if (type === 'maze' || type === 'dungeon' || type === 'caves') { if (S.world.width < 1600) this.set('world.width', 1600); }
    if (type === 'tower') this.set('world.height', 2800);
    if (type === 'runner' || type === 'pipes') this.set('world.width', 9000);
    this.note('level', { from, to: type, why });
  };
  Planner.prototype.reseed = function () { const s = 1 + Math.floor(this.rng() * 99999); this.set('level.seed', s); this.note('reseed', { seed: s }); };
  Planner.prototype.levelHazard = function (h, remove) {
    const S = this.S;
    this.levelTouched = true;
    const cur = (S.level.hazards || []).slice();
    const next = remove ? cur.filter((x) => x !== h) : uniq(cur.concat(h));
    if (U.same(cur, next)) return;
    this.set('level.hazards', next);
    if (!remove && S.level.type === 'empty') this.set('level.type', SIDE(S) ? 'platforms' : 'arena');
    this.note('hazard', { name: h, remove: !!remove });
  };

  Planner.prototype.addEffects = function (add, remove) {
    const S = this.S;
    const cur = (S.look.effects || []).slice();
    const WEATHER = ['rain', 'storm', 'snow', 'fog', 'embers', 'leaves', 'dust', 'bubbles', 'fireflies', 'sparkles'];
    let next = cur.filter((e) => !(remove || []).includes(e));
    for (const a of add || []) {
      if (WEATHER.includes(a) && (a === 'rain' || a === 'snow' || a === 'dust')) next = next.filter((e) => !['rain', 'snow', 'dust', 'storm'].includes(e) || e === a || (a === 'rain' && e === 'storm'));
      if (a === 'grayscale') next = next.filter((e) => e !== 'sepia' && e !== 'invert');
      if (a === 'sepia') next = next.filter((e) => e !== 'grayscale');
      if (a === 'night' || a === 'darkness') next = next.filter((e) => e !== 'daynight');
      if (!next.includes(a)) next.push(a);
    }
    if (add && (add.includes('storm'))) { if (!next.includes('rain')) next.push('rain'); }
    if (U.same(cur, next)) return;
    this.set('look.effects', next);
    this.note('env', { add: next.filter((e) => !cur.includes(e)), remove: cur.filter((e) => !next.includes(e)) });
    if (next.includes('night') && S.look.background === 'void') this.set('look.background', 'stars');
  };

  Planner.prototype.applyTheme = function (theme, quiet) {
    const S = this.S, th = L.themes[theme];
    if (!th) return;
    const from = S.meta.theme;
    this.set('meta.theme', theme);
    this.set('look.palette', th.palette);
    this.set('look.background', th.bg);
    this.bgTouched = true;
    // weather from the old theme goes away
    const old = from && L.themes[from] ? L.themes[from].fx : [];
    const eff = (S.look.effects || []).filter((e) => !old.includes(e));
    for (const e of th.fx) if (!eff.includes(e)) eff.push(e);
    if (!eff.includes('vignette')) eff.push('vignette');
    this.set('look.effects', eff);
    if (S.audio.music) this.set('audio.music', th.music);
    if (th.gravity && SIDE(S)) { this.set('world.gravity', Math.round(1500 * th.gravity)); }
    if (S.player && !S.player.glyph) this.set('player.color', L.palette(th.palette).player);
    const lvHint = { forest: 'forest', jungle: 'forest', dungeon: 'dungeon', city: 'city', spooky: 'obstacles', desert: 'obstacles', snow: 'forest', hell: 'caves', lab: 'arena' }[theme];
    if (lvHint && S.world.physics === 'topdown' && (S.level.type === 'empty' || S.level.type === 'arena') && !this.levelTouched) { this.set('level.type', lvHint); this.levelTouched = true; this.note('level', { from: S.level.type, to: lvHint, why: 'theme', implicit: true }); }
    this.note('theme', { from, to: theme, palette: th.palette, bg: th.bg, fx: th.fx, enemy: th.enemy, item: th.item, music: th.music, gravity: th.gravity && SIDE(S) ? Math.round(1500 * th.gravity) : null, quiet });
  };

  Planner.prototype.paletteFromColor = function (hex, shade) {
    const h = U.hueOf(hex);
    const light = /light|pastel|pale|bright/.test(shade || '');
    if (light) return { bg: U.hsl(h, 45, 92), bg2: U.hsl(h, 50, 86), wall: U.hsl(h, 35, 62), wallTop: U.hsl(h, 50, 78), deco: U.hsl(h, 35, 84), accent: hex, text: U.hsl(h, 35, 22), player: U.hsl(h + 180, 70, 55), shadow: 'rgba(40,30,60,0.18)', tint: hex };
    return { bg: U.hsl(h, 32, 8), bg2: U.hsl(h, 40, 15), wall: U.hsl(h, 32, 24), wallTop: U.hsl(h, 60, 48), deco: U.hsl(h, 32, 16), accent: hex, text: U.hsl(h, 30, 92), player: U.hsl(h + 170, 75, 66), shadow: 'rgba(0,0,0,0.38)', tint: hex };
  };

  Planner.prototype.music = function (it) {
    const S = this.S;
    if (it.sfxOnly) { this.set('audio.sfx', !it.off); this.note('sfx', { on: !it.off }); return; }
    if (it.off) { if (S.audio.music) { this.set('audio.music', null); this.note('music', { off: true }); } else this.note('noop', { what: 'music' }); if (it.sfx) this.set('audio.sfx', false); return; }
    const th = this.theme();
    const mood = it.mood || (th ? th.music : S.meta.genre === 'platformer' ? 'happy' : S.meta.genre === 'shmup' || S.meta.genre === 'survival' ? 'intense' : 'chill');
    const from = S.audio.music;
    this.set('audio.music', mood);
    if (it.tempoMul) this.set('audio.tempo', Math.round((S.audio.tempo || 110) * it.tempoMul));
    this.note('music', { from, to: mood, jazz: it.jazz, tempo: it.tempoMul ? S.audio.tempo : null, inferred: !it.mood });
  };

  Planner.prototype.world = function (it) {
    const S = this.S;
    switch (it.prop) {
      case 'gravity': {
        const g = it.g, from = S.world.gravity;
        if (!SIDE(S) && (g.add || g.mul > 1 || g.flip || g.set > 0)) this.setPhysics('platformer', 'gravity');
        let to = from;
        if (g.flip) to = -from;
        else if (g.set != null) to = g.set;
        else if (g.mul) to = Math.round(from * g.mul);
        else if (g.add) to = Math.abs(from) || 1500;
        this.set('world.gravity', to);
        this.note('gravity', { from, to, word: g.word, flip: !!g.flip, topdown: !SIDE(S) });
        if (to < 0) this.flags.gravityNeg = true;
        break;
      }
      case 'timeScale': { const f = S.world.timeScale || 1; const t = it.set != null ? it.set : Math.round(f * it.mul * 100) / 100; this.set('world.timeScale', U.clamp(t, 0.2, 3)); this.note('world', { prop: 'game speed', from: f, to: S.world.timeScale }); break; }
      case 'zoom': { const f = S.camera.zoom || 1; this.set('camera.zoom', U.clamp(Math.round(f * it.mul * 100) / 100, 0.4, 3)); this.note('world', { prop: 'zoom', from: f, to: S.camera.zoom }); break; }
      case 'follow': this.set('camera.follow', it.set); this.note('world', { prop: 'camera follow', from: !it.set, to: it.set }); break;
      case 'shake': { const f = S.camera.shake == null ? 1 : S.camera.shake; this.set('camera.shake', it.set != null ? it.set : Math.min(4, f * it.mul)); this.note('world', { prop: 'screen shake', from: f, to: S.camera.shake }); break; }
      case 'bounds': this.set('world.bounds', it.set); this.note('world', { prop: 'edges', from: 'walls', to: it.set }); break;
      case 'size': { const w = S.world.width, h = S.world.height; this.set('world.width', U.clamp(Math.round(w * it.mul), 640, 20000)); this.set('world.height', U.clamp(Math.round(h * it.mul), 480, 10000)); this.note('world', { prop: 'world size', from: w + '×' + h, to: S.world.width + '×' + S.world.height }); break; }
      default: break;
    }
  };

  // ---------------------------------------------------------------------------
  // genres
  // ---------------------------------------------------------------------------
  Planner.prototype.genre = function (g, extras) {
    const S = this.S;
    const userAdds = (extras || []).filter((x) => x.kind === 'add').flatMap((x) => x.nps).concat(this.userAdds || []);
    const hasRole = (role) => userAdds.some((np) => (np.forceRole || (np.entry && np.entry.role)) === role) || Spec.typesByRole(S, role).length > 0;
    const themeX = (extras || []).find((x) => x.kind === 'theme');
    if (themeX) this.applyTheme(themeX.theme, true);
    const th = this.theme();
    const add = (key, o) => this.addFromNP(Object.assign({ key, word: key, entry: L.noun(key), mods: [], colors: [] }, o || {}), o && o.opts);
    const metaG = (S.meta.genres || []).concat(g);
    this.set('meta.genre', g);
    this.set('meta.genres', uniq(metaG));
    this.note('genre', { genre: g, from: this.before.meta.genre });
    this.inGenre = true;
    try { this.genreBody(g, extras, userAdds, hasRole, th, add); } finally { this.inGenre = false; }
    for (const x of extras || []) if (x.kind === 'add') for (const np of x.nps) this.addFromNP(np);
  };
  Planner.prototype.genreBody = function (g, extras, userAdds, hasRole, th, add) {
    const S = this.S;
    switch (g) {
      case 'platformer': {
        this.setPhysics('platformer', 'genre');
        this.levelType(S.level.type === 'tower' || S.level.type === 'caves' ? S.level.type : 'platforms', 'genre');
        this.set('world.gravity', Math.abs(S.world.gravity) || 1500);
        this.ensurePlayer('genre');
        this.giveAbility('jump', {});
        if (!hasRole('collectible')) add(th ? th.item : 'coin', { count: 14 });
        if (!hasRole('enemy')) add(th ? th.enemy : 'slime', { count: 5 });
        if (!Object.values(S.types).some((d) => d.exit)) add('flag');
        if (S.look.background === 'void' || S.look.background === 'gradient') { this.set('look.background', th ? th.bg : 'mountains'); if (!th) this.set('look.palette', 'sky'); }
        break;
      }
      case 'shooter': case 'survival': {
        this.setPhysics('topdown', 'genre');
        if (S.level.type === 'empty') this.levelType(g === 'survival' ? 'city' : 'arena', 'genre');
        this.ensurePlayer('genre');
        this.giveAbility('shoot', { projectile: th && /space|lab|city/.test(S.meta.theme) ? 'laser' : 'bullet', aim: 'mouse' });
        let foe = Spec.typesByRole(S, 'enemy')[0];
        if (!hasRole('enemy')) foe = add(g === 'survival' ? 'zombie' : th ? th.enemy : 'drone', { count: 6 });
        foe = foe || Spec.typesByRole(S, 'enemy')[0];
        if (foe && !S.rules.some((r) => r.when.type === 'onTimer')) this.addRule({ when: { type: 'onTimer', every: g === 'survival' ? 4 : 5 }, then: [{ type: 'spawn', what: foe, count: g === 'survival' ? 3 : 2, at: 'edges' }], note: 'waves keep coming' }, 'waves');
        if (g === 'survival') { this.set('hud.timer', 90); this.addRule({ when: { type: 'onTimeUp' }, then: [{ type: 'win', text: 'YOU SURVIVED' }], note: 'survive until the timer runs out' }, 'survive'); if (!(S.look.effects || []).includes('darkness')) this.addEffects(['night']); }
        if (!hasRole('collectible')) add('heart', { count: 3 });
        break;
      }
      case 'shmup': {
        this.setPhysics('shmup', 'genre');
        this.levelType('empty', 'genre');
        this.set('look.background', 'stars'); this.set('look.palette', S.meta.theme ? S.look.palette : 'space');
        this.ensurePlayer('genre');
        if (!S.player.glyph) this.set('player.glyph', '🚀');
        this.giveAbility('shoot', { projectile: 'laser', aim: 'up', auto: true, rate: 7 });
        if (!hasRole('enemy')) add(th ? th.enemy : 'alien', { count: 4 });
        if (!userAdds.some((np) => np.key === 'meteor' || np.key === 'asteroid')) add('meteor', { count: 2 });
        break;
      }
      case 'bullethell': {
        this.setPhysics('topdown', 'genre');
        this.levelType('arena', 'genre');
        this.set('world.width', 1000); this.set('world.height', 720);
        this.ensurePlayer('genre');
        this.set('player.size', 16); this.set('player.hp', 3);
        this.giveAbility('shoot', { projectile: 'laser', aim: 'auto', auto: true, rate: 6 });
        this.giveAbility('dash', {});
        const boss = userAdds.find((np) => np.key === 'boss') ? null : add(th ? th.boss : 'eyeball', { mods: ['king'], opts: {} });
        if (boss) { const d = U.clone(S.types[boss]); d.boss = true; d.hp = 60; d.size = 90; d.static = false; d.spawn = { count: 1, at: 'top' }; d.behaviors = [{ type: 'wave', amount: 80, freq: 1 }, { type: 'shoot', projectile: this.ensureProjectile('plasma'), at: 'spiral', count: 5, rate: 6 }, { type: 'shoot', projectile: this.ensureProjectile('plasma'), at: 'radial', count: 16, rate: 0.5 }]; this.op({ op: 'set', path: 'types.' + boss, value: d }); }
        this.addEffects(['glow', 'vignette']);
        this.set('look.palette', 'neon');
        break;
      }
      case 'asteroids': {
        this.setPhysics('ship', 'genre');
        this.set('world.bounds', 'wrap');
        this.levelType('empty', 'genre');
        this.set('look.background', 'stars'); this.set('look.palette', 'space');
        this.ensurePlayer('genre');
        this.set('player.glyph', '🚀');
        this.giveAbility('shoot', { projectile: 'laser', aim: 'facing', rate: 5 });
        const a = add('asteroid', { count: 7 });
        if (a) this.set('types.' + a + '.onDeath', [{ type: 'split', count: 2 }]);
        break;
      }
      case 'snake': {
        this.setPhysics('snake', 'genre');
        this.levelType('arena', 'genre');
        this.set('world.width', 1200); this.set('world.height', 800);
        this.ensurePlayer('genre');
        const p = U.clone(S.player); p.abilities = { tail: { length: 3 } }; p.speed = 260; p.hp = 1; if (!p.glyph) { p.shape = 'square'; } this.op({ op: 'set', path: 'player', value: p });
        if (!hasRole('collectible')) add('apple', { count: 3 });
        for (const n of Spec.typesByRole(S, 'collectible')) { const r = S.rules.find((x) => x.when.type === 'onCollide' && x.when.b === n); if (r && !r.then.some((a) => a.type === 'growTail')) this.op({ op: 'setRule', id: r.id, rule: Object.assign({}, r, { then: [{ type: 'growTail', amount: 1 }, { type: 'spawn', what: n, count: 1, at: 'random' }].concat(r.then) }) }); }
        this.set('look.background', 'grid');
        break;
      }
      case 'runner': case 'flappy': {
        this.setPhysics(g === 'flappy' ? 'platformer' : 'runner', 'genre');
        this.levelType(g === 'flappy' ? 'pipes' : 'runner', 'genre');
        this.ensurePlayer('genre');
        if (g === 'flappy') { const p = U.clone(S.player); p.abilities = { flap: { power: 440 } }; if (!p.glyph) p.glyph = '🐦'; this.op({ op: 'set', path: 'player', value: p }); this.setPhysics('runner', 'flappy'); this.set('world.gravity', 1300); this.note('consider', { text: 'flap' }); }
        else this.giveAbility('jump', {});
        if (!hasRole('collectible')) add(th ? th.item : 'coin', { count: 30 });
        if (!Object.values(S.types).some((d) => d.exit)) add(g === 'flappy' ? 'finish' : 'flag');
        this.set('look.background', th ? th.bg : g === 'flappy' ? 'clouds' : 'hills');
        if (!th) this.set('look.palette', 'sky');
        break;
      }
      case 'maze': {
        this.setPhysics('topdown', 'genre');
        this.levelType('maze', 'genre');
        this.ensurePlayer('genre');
        if (!hasRole('collectible')) add('key', { count: 1 });
        if (!Object.values(S.types).some((d) => d.exit)) add('door');
        const k = Spec.typesByRole(S, 'collectible').find((n) => n === 'key') || Spec.typesByRole(S, 'collectible')[0];
        if (k && k === 'key') this.ensureDoorForKey(k);
        if (!hasRole('enemy')) add(th ? th.enemy : 'ghost', { count: 4 });
        this.addEffects(['darkness']);
        break;
      }
      case 'dungeon': {
        this.setPhysics('topdown', 'genre');
        this.levelType('dungeon', 'genre');
        this.ensurePlayer('genre');
        this.giveAbility('melee', { weapon: 'sword' });
        if (!hasRole('enemy')) { add('skeleton', { count: 6 }); add('bat', { count: 4 }); }
        if (!hasRole('collectible')) { add('treasure_chest', { count: 4 }); add('potion', { count: 3 }); }
        if (!Object.values(S.types).some((d) => d.exit)) add('door');
        this.addEffects(['darkness']);
        if (!S.meta.theme) this.applyTheme('dungeon', true);
        break;
      }
      case 'breakout': case 'pong': {
        this.setPhysics('paddle', 'genre');
        this.levelType('bricks', 'genre');
        this.ensurePlayer('genre');
        const p = U.clone(S.player); p.glyph = null; p.shape = 'capsule'; p.abilities = {}; p.speed = 560; p.hp = 3; this.op({ op: 'set', path: 'player', value: p });
        const ball = this.addFromNP({ key: 'ball', word: 'ball', entry: L.noun('beach_ball'), mods: [], colors: [], count: 1 }, { role: 'critter' });
        if (ball) { const d = U.clone(S.types[ball]); d.shape = 'circle'; delete d.glyph; d.color = '#fff7e8'; d.size = 18; d.bouncy = 1; d.behaviors = [{ type: 'bounce', speed: 380 }]; d.static = false; d.pushable = false; d.team = 'neutral'; d.spawn = { count: 1, at: 'center' }; d.effects = ['glow', 'trail']; this.op({ op: 'set', path: 'types.' + ball, value: d }); }
        const brick = this.addFromNP({ key: 'brick', word: 'brick', entry: L.noun('brick'), mods: [], colors: [], count: 60 }, {});
        if (brick) { const d = U.clone(S.types[brick]); delete d.glyph; d.shape = 'square'; d.w = 58; d.h = 24; d.size = 24; d.hp = 1; d.color = '#e0735f'; d.static = true; d.spawn = { count: 60, at: 'grid' }; d.effects = ['rainbow']; this.op({ op: 'set', path: 'types.' + brick, value: d }); }
        if (ball && brick) {
          this.addRule({ when: { type: 'onCollide', a: ball, b: brick }, then: [{ type: 'destroy', target: brick }, { type: 'addScore', amount: 10 }, { type: 'sound', name: 'pop' }], note: 'the ball breaks bricks' }, 'bricks');
          this.addRule({ when: { type: 'onCleared', of: brick }, then: [{ type: 'win', text: 'ALL BRICKS CLEARED' }], note: 'clear every brick to win' }, 'win');
          this.addRule({ when: { type: 'onFall', of: ball }, then: [{ type: 'damage', target: 'player', amount: 1 }, { type: 'spawn', what: ball, count: 1, at: 'center' }], note: 'dropping the ball costs a heart' }, 'lose');
        }
        this.set('look.background', 'grid');
        break;
      }
      case 'racing': {
        this.setPhysics('tank', 'genre');
        this.levelType('track', 'genre');
        this.ensurePlayer('genre');
        const p = U.clone(S.player); p.glyph = '🏎️'; delete p.shape; p.speed = 340; p.abilities = Object.assign({}, p.abilities, { dash: { power: 700, cooldown: 2 } }); delete p.abilities.shoot; this.op({ op: 'set', path: 'player', value: p });
        const cp = this.addFromNP({ key: 'checkpoint', word: 'checkpoint', entry: L.noun('checkpoint'), mods: [], colors: [], count: 9 }, {});
        if (cp) { this.set('types.' + cp + '.spawn', { count: 9, at: 'checkpoints' }); this.set('types.' + cp + '.glyph', '🏁'); this.addRule({ when: { type: 'onCollide', a: 'player', b: cp }, then: [{ type: 'destroy', target: cp }, { type: 'addScore', amount: 10 }, { type: 'addTime', seconds: 4 }, { type: 'sound', name: 'coin' }], note: 'hit every checkpoint' }, 'race'); this.addRule({ when: { type: 'onCleared', of: cp }, then: [{ type: 'win', text: 'LAP COMPLETE' }], note: 'finish the lap' }, 'win'); }
        this.set('hud.timer', 40);
        this.addRule({ when: { type: 'onTimeUp' }, then: [{ type: 'lose', text: 'TOO SLOW' }], note: 'beat the clock' }, 'timer');
        break;
      }
      case 'stealth': {
        this.setPhysics('topdown', 'genre');
        this.levelType('dungeon', 'genre');
        this.ensurePlayer('genre');
        const gd = add('guard', { count: 6 });
        if (gd) this.set('types.' + gd + '.behaviors', [{ type: 'patrol' }, { type: 'chase', target: 'player', sight: 230, cone: 40, speed: 150 }]);
        const tr = S.types.treasure ? 'treasure' : add('treasure', { count: 1, opts: {} });
        if (tr) {
          this.set('types.' + tr + '.spawn', { count: 1, at: 'goal' });
          const r = S.rules.find((x) => x.when.type === 'onCollide' && x.when.b === tr);
          if (r && !r.then.some((a) => a.type === 'win')) this.op({ op: 'setRule', id: r.id, rule: Object.assign({}, r, { then: r.then.concat([{ type: 'win', text: 'HEIST COMPLETE' }]) }) });
        }
        this.addEffects(['darkness']);
        this.note('consider', { text: 'stealth' });
        break;
      }
      case 'defense': {
        this.setPhysics('topdown', 'genre');
        if (S.level.type === 'empty') this.levelType('arena', 'genre');
        this.ensurePlayer('genre');
        this.giveAbility('shoot', { aim: 'mouse' });
        if (!hasRole('enemy')) add(th ? th.enemy : 'goblin', { count: 4 });
        const core = this.addFromNP(this.defendNP || { key: 'core', word: 'core', entry: L.noun('core'), mods: [], colors: [], count: 1, defend: true }, { role: 'structure' });
        if (core) { const d = U.clone(S.types[core]); d.role = 'structure'; d.static = true; d.team = 'friend'; delete d.behaviors; delete d.damage; d.size = Math.max(d.size || 40, 64); this.op({ op: 'set', path: 'types.' + core, value: d }); this.defendTarget(core); }
        const foe = Spec.typesByRole(S, 'enemy')[0];
        if (foe) this.addRule({ when: { type: 'onTimer', every: 3 }, then: [{ type: 'spawn', what: foe, count: 2, at: 'edges' }], note: 'enemies march on the core' }, 'waves');
        break;
      }
      case 'rpg': {
        this.setPhysics('topdown', 'genre');
        this.levelType('forest', 'genre');
        this.ensurePlayer('genre');
        this.giveAbility('melee', { weapon: 'sword' });
        const wiz = add('wizard', { count: 1, quote: 'Bring me 5 gems and I will grant you victory.' });
        const gem = hasRole('collectible') ? Spec.typesByRole(S, 'collectible')[0] : add('gem', { count: 8 });
        if (!hasRole('enemy')) add('goblin', { count: 5 });
        if (wiz && gem) this.addRule({ when: { type: 'onNear', a: 'player', b: wiz, distance: 100 }, then: [{ type: 'say', target: wiz, text: 'You did it, hero!' }, { type: 'win', text: 'QUEST COMPLETE' }], cond: { collected: gem, atLeast: 5 }, note: 'return 5 ' + U.plural(U.human(gem), 2) + ' to the wizard' }, 'quest');
        this.note('consider', { text: 'quest' });
        break;
      }
      case 'soccer': {
        this.setPhysics('topdown', 'genre');
        this.levelType('arena', 'genre');
        this.ensurePlayer('genre');
        const ball = this.addFromNP({ key: 'soccer_ball', word: 'ball', entry: L.noun('soccer_ball'), mods: [], colors: [], count: 1 }, {});
        if (ball) { this.set('types.' + ball + '.spawn', { count: 1, at: 'center' }); this.set('types.' + ball + '.bouncy', 0.9); }
        const goal = this.addFromNP({ key: 'goal', word: 'goal', entry: Object.assign({}, L.noun('goal'), { glyph: '🥅', exit: false }), mods: [], colors: [], count: 1 }, { role: 'structure' });
        if (goal) { const d = U.clone(S.types[goal]); d.glyph = '🥅'; delete d.exit; d.size = 70; d.spawn = { count: 1, at: 'goal' }; this.op({ op: 'set', path: 'types.' + goal, value: d }); this.op({ op: 'removeRule', id: (S.rules.find((r) => r.when.b === goal) || {}).id }); }
        const bot = add('robot', { count: 1 });
        if (bot && ball) this.set('types.' + bot, Object.assign({}, S.types[bot], { team: 'neutral', role: 'critter', behaviors: [{ type: 'chase', target: ball, speed: 140 }], damage: 0 }));
        if (ball && goal) this.addRule({ when: { type: 'onCollide', a: ball, b: goal }, then: [{ type: 'addScore', amount: 1 }, { type: 'addVar', name: 'goals', amount: 1 }, { type: 'banner', text: 'GOAL!' }, { type: 'confetti' }, { type: 'teleport', target: ball, to: 'center' }], note: 'score goals' }, 'goal');
        this.addRule({ when: { type: 'onVar', name: 'goals', atLeast: 5 }, then: [{ type: 'win', text: 'CHAMPIONS' }], note: 'first to 5 goals' }, 'win');
        break;
      }
      case 'topdown': {
        this.setPhysics('topdown', 'genre');
        if (S.level.type === 'platforms' || S.level.type === 'tower' || S.level.type === 'runner' || S.level.type === 'pipes') this.levelType('arena', 'genre');
        this.ensurePlayer('genre');
        break;
      }
      default: break;
    }
  };

  // ---------------------------------------------------------------------------
  // meta planners
  // ---------------------------------------------------------------------------
  Planner.prototype.difficulty = function (dir, extreme) {
    const S = this.S;
    const k = dir > 0 ? (extreme ? 1.8 : 1.3) : (extreme ? 0.5 : 0.75);
    const changed = [];
    for (const n of Spec.typesByRole(S, 'enemy')) {
      const d = U.clone(S.types[n]);
      if (d.speed) d.speed = Math.round(d.speed * (dir > 0 ? Math.min(k, 1.4) : k));
      if (d.hp) d.hp = Math.max(1, Math.round(d.hp * k));
      if (d.spawn && d.spawn.count) d.spawn = Object.assign({}, d.spawn, { count: U.clamp(Math.round(d.spawn.count * k), 1, 300) });
      if (extreme && dir > 0 && d.damage) d.damage += 1;
      this.op({ op: 'set', path: 'types.' + n, value: d });
      changed.push(n);
    }
    if (S.player) {
      const f = S.player.hp || 5;
      const t = dir > 0 ? Math.max(1, f - (extreme ? 3 : 1)) : f + (extreme ? 5 : 2);
      this.set('player.hp', t);
      if (dir < 0 && extreme) this.set('player.lives', 3);
    }
    if (dir > 0 && !S.rules.some((r) => r.when.type === 'onTimer' && r.then.some((a) => a.type === 'spawn')) && changed.length) {
      this.addRule({ when: { type: 'onTimer', every: extreme ? 3 : 6 }, then: [{ type: 'spawn', what: changed[0], count: extreme ? 3 : 2, at: 'edges' }], note: 'reinforcements' }, 'waves');
    }
    if (!changed.length && dir > 0) { const foe = this.addFromNP({ key: 'enemy', word: 'enemy', entry: L.noun('enemy'), mods: [], colors: [], count: extreme ? 10 : 5 }); changed.push(foe); }
    if (extreme && dir > 0) this.flags.impossible = true;
    this.note('difficulty', { dir, extreme, enemies: changed, hp: S.player ? S.player.hp : null });
  };

  Planner.prototype.juice = function () {
    const S = this.S;
    this.set('look.juice', U.clamp((S.look.juice == null ? 1 : S.look.juice) + 1, 0, 3));
    this.set('camera.shake', Math.max(1.2, S.camera.shake || 1));
    const added = [];
    for (const r of S.rules) {
      const then = r.then.slice();
      if (r.when.type === 'onCollide' && r.when.a === 'player' && then.some((a) => a.type === 'destroy') && !then.some((a) => a.type === 'burst')) { then.splice(then.length - 1, 0, { type: 'burst', count: 14 }); added.push('pickup sparks'); }
      if (r.when.type === 'onDeath' && r.when.of !== 'player' && !then.some((a) => a.type === 'shake')) { then.push({ type: 'shake', power: 5 }); added.push('death shake'); }
      if (!U.same(then, r.then)) this.op({ op: 'setRule', id: r.id, rule: Object.assign({}, r, { then }) });
    }
    if (!S.rules.some((r) => r.when.type === 'onHurt' && r.when.of === 'player') && S.player) { this.addRule({ when: { type: 'onHurt', of: 'player' }, then: [{ type: 'flash', color: '#ff3b3b' }, { type: 'slowmo', seconds: 0.25, factor: 0.4 }], note: 'getting hit should feel like it' }, 'juice'); added.push('hit slow-mo'); }
    for (const [n, d] of Object.entries(S.types)) if (d.projectile && !(d.effects || []).includes('trail')) { this.set('types.' + n + '.effects', uniq((d.effects || []).concat(['trail', 'glow']))); added.push(n + ' trails'); }
    if (!(S.look.effects || []).includes('vignette')) this.addEffects(['vignette']);
    this.note('juice', { level: S.look.juice, added: uniq(added) });
  };

  Planner.prototype.polish = function () {
    const S = this.S;
    const th = this.theme();
    if (S.look.background === 'void' || S.look.background === 'gradient') { this.set('look.background', th ? th.bg : SIDE(S) ? 'mountains' : 'stars'); }
    const fx = (S.look.effects || []).slice();
    if (!fx.includes('vignette')) fx.push('vignette');
    if (!fx.some((e) => ['fireflies', 'sparkles', 'snow', 'rain', 'embers', 'leaves', 'bubbles', 'dust', 'fog'].includes(e))) fx.push(th && th.fx.length ? th.fx[0] : 'fireflies');
    this.addEffects(fx);
    for (const n of Spec.typesByRole(S, 'collectible')) if (!(S.types[n].effects || []).includes('sparkle')) this.set('types.' + n + '.effects', uniq((S.types[n].effects || []).concat(['sparkle'])));
    if (!S.audio.music) this.music({ mood: null });
    if (!S.meta.title) this.title({ auto: true });
    this.set('look.juice', Math.max(2, S.look.juice || 1));
    this.note('polish', {});
  };

  Planner.prototype.title = function (it) {
    const S = this.S;
    let t = it.title;
    if (it.auto || !t) t = this.makeTitle();
    const from = S.meta.title;
    this.set('meta.title', t);
    if (it.auto && !S.meta.tagline) this.set('meta.tagline', this.makeTagline());
    this.note('title', { from, to: t, auto: !!it.auto });
  };
  Planner.prototype.makeTitle = function () {
    const S = this.S, r = this.rng;
    const pName = S.player && S.player.glyph ? (L.nounKeys().find((k) => L.noun(k).glyph === S.player.glyph) || 'hero') : S.player && S.player.label ? S.player.label : 'Vib';
    const foes = Spec.typesByRole(S, 'enemy');
    const items = Spec.typesByRole(S, 'collectible');
    const th = S.meta.theme;
    const adj = { space: ['Cosmic', 'Orbital', 'Stellar', 'Void'], ocean: ['Deep', 'Sunken', 'Tidal'], spooky: ['Haunted', 'Midnight', 'Cursed'], hell: ['Infernal', 'Molten', 'Burning'], city: ['Neon', 'Chrome', 'Electric'], forest: ['Wild', 'Mossy', 'Hidden'], snow: ['Frozen', 'Frostbite', 'Arctic'], candy: ['Sugar', 'Sweet', 'Sticky'], dungeon: ['Forgotten', 'Endless', 'Lost'], retro: ['Super', 'Turbo', 'Ultra'], synthwave: ['Neon', 'Laser', 'Midnight'] }[th] || ['Super', 'Tiny', 'Endless', 'Mighty', 'Little', 'Turbo', 'Strange'];
    const noun = { platformer: ['Adventure', 'Leap', 'Climb', 'Quest'], shooter: ['Arena', 'Blitz', 'Panic'], shmup: ['Strike', 'Squadron', 'Assault'], survival: ['Night', 'Siege', 'Outbreak'], snake: ['Snake', 'Slither'], runner: ['Dash', 'Run', 'Rush'], maze: ['Labyrinth', 'Maze'], dungeon: ['Depths', 'Crypt', 'Descent'], breakout: ['Breaker', 'Smash'], racing: ['Rally', 'Grand Prix', 'Drift'] }[S.meta.genre] || ['Quest', 'Rampage', 'Odyssey', 'Panic', 'Party', 'Fiasco', 'Legends'];
    const H = (s) => U.titleCase(U.human(s));
    const forms = [];
    if (foes.length) forms.push(H(pName) + ' vs. the ' + H(U.plural(foes[0], 2)));
    if (items.length) forms.push(H(pName) + "'s " + H(items[0]) + ' ' + r.pick(noun));
    forms.push(r.pick(adj) + ' ' + H(pName) + ' ' + r.pick(noun));
    if (foes.length) forms.push(r.pick(['Attack of the ', 'Revenge of the ', 'Night of the ', 'Return of the ']) + H(U.plural(foes[0], 2)));
    return r.pick(forms).slice(0, 40);
  };
  Planner.prototype.makeTagline = function () {
    const S = this.S;
    const foes = Spec.typesByRole(S, 'enemy'), items = Spec.typesByRole(S, 'collectible');
    const bits = [];
    if (items.length) bits.push('collect the ' + U.plural(U.human(items[0]), 2));
    if (foes.length) bits.push(Object.values(S.player && S.player.abilities || {}).length ? 'outlast the ' + U.plural(U.human(foes[0]), 2) : 'avoid the ' + U.plural(U.human(foes[0]), 2));
    if (!bits.length) bits.push('a game made of prompts');
    return U.cap(U.listJoin(bits)) + '.';
  };

  Planner.prototype.goal = function (levels) {
    const S = this.S;
    if (levels) { if (!Object.values(S.types).some((d) => d.exit)) this.addFromNP({ key: SIDE(S) ? 'flag' : 'portal', word: 'exit', entry: Object.assign({}, L.noun(SIDE(S) ? 'flag' : 'door')), mods: [], colors: [], count: 1 }); this.note('goal', { kind: 'levels' }); return; }
    const items = Spec.typesByRole(S, 'collectible').filter((n) => (S.types[n].spawn || {}).count > 1);
    const foes = Spec.typesByRole(S, 'enemy');
    if (S.rules.some((r) => r.then.some((a) => a.type === 'win'))) { this.note('goal', { kind: 'exists' }); return; }
    if (items.length) { this.addRule({ when: { type: 'onCleared', of: items[0] }, then: [{ type: 'win', text: 'ALL ' + U.plural(U.human(items[0]), 2).toUpperCase() + ' COLLECTED' }], note: 'collect everything to win' }, 'win'); this.note('goal', { kind: 'collect', name: items[0] }); return; }
    if (SIDE(S) || ['maze', 'dungeon', 'caves'].includes(S.level.type)) { this.addFromNP({ key: SIDE(S) ? 'flag' : 'door', word: 'exit', entry: L.noun(SIDE(S) ? 'flag' : 'door'), mods: [], colors: [], count: 1 }); const ex = Object.keys(S.types).find((n) => S.types[n].exit); const r = ex && S.rules.find((x) => x.when.type === 'onCollide' && x.when.b === ex); if (r) this.op({ op: 'setRule', id: r.id, rule: Object.assign({}, r, { then: [{ type: 'confetti' }, { type: 'win', text: 'YOU MADE IT' }] }) }); this.note('goal', { kind: 'exit', name: ex }); return; }
    if (foes.length) { this.set('hud.timer', 60); this.addRule({ when: { type: 'onTimeUp' }, then: [{ type: 'win', text: 'YOU SURVIVED' }], note: 'survive for a minute' }, 'win'); this.note('goal', { kind: 'survive' }); return; }
    const c = this.addFromNP({ key: 'star', word: 'star', entry: L.noun('star'), mods: [], colors: [], count: 12 });
    this.addRule({ when: { type: 'onCleared', of: c }, then: [{ type: 'win', text: 'ALL STARS COLLECTED' }], note: 'collect every star' }, 'win');
    this.note('goal', { kind: 'collect', name: c, created: true });
  };

  // a whole game idea, for an empty project
  Planner.prototype.concept = function () {
    const r = this.rng;
    const genres = ['platformer', 'shooter', 'survival', 'snake', 'asteroids', 'runner', 'maze', 'dungeon', 'breakout', 'bullethell', 'rpg', 'stealth', 'defense', 'shmup'];
    const themeFor = { platformer: ['forest', 'candy', 'snow', 'jungle', 'sky', 'hell'], shooter: ['space', 'city', 'lab', 'synthwave'], survival: ['spooky', 'city', 'snow'], snake: ['space', 'retro', 'candy', 'jungle'], asteroids: ['space', 'synthwave'], runner: ['desert', 'city', 'jungle', 'snow'], maze: ['spooky', 'dungeon', 'candy', 'lab'], dungeon: ['dungeon', 'hell', 'spooky'], breakout: ['retro', 'synthwave', 'candy'], bullethell: ['space', 'synthwave', 'hell'], rpg: ['fantasy', 'forest', 'farm'], stealth: ['city', 'dungeon', 'spooky'], defense: ['fantasy', 'space', 'farm'], shmup: ['space', 'synthwave', 'ocean'] };
    const heroes = ['cat', 'frog', 'robot', 'penguin', 'wizard', 'ghost', 'duck', 'fox', 'alien', 'ninja', 'astronaut', 'hamster', 'dinosaur', 'unicorn', 'snail'];
    const g = r.pick(genres);
    const th = r.pick(themeFor[g]);
    const hero = r.pick(heroes);
    this.inConcept = true;
    this.applyTheme(th, true);
    this.genre(g, []);
    if (!['breakout', 'snake', 'asteroids', 'shmup', 'racing'].includes(g)) this.playerSkin({ key: hero, word: hero, entry: L.noun(hero) || L.noun('cat'), mods: [], colors: [] });
    this.title({ auto: true });
    this.inConcept = false;
    this.note('concept', { genre: g, theme: th, hero, title: this.S.meta.title });
  };

  // creative twists
  Planner.prototype.surprise = function (count) {
    const S = this.S, r = this.rng;
    if (Spec.isEmpty(S)) { this.concept(); return; }
    const foes = Spec.typesByRole(S, 'enemy'), items = Spec.typesByRole(S, 'collectible'), critters = Spec.typesByRole(S, 'critter').concat(Spec.typesByRole(S, 'npc'));
    const used = new Set((this.ctx.memory && this.ctx.memory.twists) || []);
    const T = [
      { id: 'coins-flee', ok: items.length, run: () => { this.modifyTypes([items[0]], [{ prop: 'static', set: false }], { b: [{ type: 'flee', from: 'player', range: 200 }], fx: [], props: [], attrs: [] }); return 'the ' + U.plural(U.human(items[0]), 2) + ' are now alive and they run from you'; } },
      { id: 'split', ok: foes.length && !S.types[foes[0]].onDeath, run: () => { this.set('types.' + foes[0] + '.onDeath', [{ type: 'split', count: 2 }]); return U.plural(U.human(foes[0]), 2) + ' split in two when they die (until they get too small)'; } },
      { id: 'gravity-flip', ok: SIDE(S), run: () => { this.addRule({ when: { type: 'onTimer', every: 12 }, then: [{ type: 'flipGravity' }, { type: 'sound', name: 'magic' }], note: 'every 12 seconds, gravity flips' }, 'twist'); return 'gravity flips every 12 seconds'; } },
      { id: 'duck', ok: !S.types.rubber_duck, run: () => { this.addFromNP({ key: 'rubber_duck', word: 'rubber duck', entry: L.noun('rubber_duck'), mods: [], colors: [], count: 1 }); return 'a rubber duck companion that follows you around offering debugging advice'; } },
      { id: 'disco', ok: !(S.look.effects || []).includes('psychedelic'), run: () => { this.addEffects(['psychedelic']); this.music({ mood: 'happy' }); for (const n of foes) this.set('types.' + n + '.effects', uniq((S.types[n].effects || []).concat(['dance']))); return 'disco mode: the world shifts hue and every enemy dances'; } },
      { id: 'boss-at-score', ok: foes.length && !Object.values(S.types).some((d) => d.boss), run: () => { const b = this.addFromNP({ key: 'boss', word: 'boss', entry: L.noun('boss'), mods: [], colors: [], count: 0 }, { count: 0 }); this.addRule({ when: { type: 'onScore', atLeast: 50 }, then: [{ type: 'banner', text: 'SOMETHING APPROACHES' }, { type: 'spawn', what: b, count: 1, at: 'random' }, { type: 'shake', power: 14 }, { type: 'music', mood: 'epic' }], once: true, note: 'a boss arrives at 50 points' }, 'twist'); return 'a ' + U.human(b) + ' boss crashes the party when you reach 50 points'; } },
      { id: 'floor-lava', ok: S.world.physics === 'topdown' && S.level.type !== 'islands', run: () => { this.levelType('islands', 'twist'); this.levelHazard('lava'); return 'the floor is lava, literally: the level is now islands in a lava sea'; } },
      { id: 'meteors', ok: !S.types.meteor, run: () => { const m = this.addFromNP({ key: 'meteor', word: 'meteor', entry: L.noun('meteor'), mods: [], colors: [], count: 3 }); this.set('types.' + m + '.spawn', { count: 3, at: 'top', every: 1.5, max: 14 }); return 'a meteor shower: rocks rain from the sky'; } },
      { id: 'infection', ok: foes.length && (critters.length || items.length), run: () => { const prey = critters[0] || items[0]; this.addRule({ when: { type: 'onCollide', a: foes[0], b: prey }, then: [{ type: 'transform', target: 'other', into: foes[0] }, { type: 'sound', name: 'hurt' }], note: U.plural(U.human(foes[0]), 2) + ' infect ' + U.plural(U.human(prey), 2) }, 'twist'); return U.plural(U.human(foes[0]), 2) + ' now infect any ' + U.human(prey) + ' they touch, turning it into one of them'; } },
      { id: 'mimic', ok: !S.types.doppelganger, run: () => { const d = this.addFromNP({ key: null, word: 'doppelganger', unknown: true, mods: [], colors: [], count: 1, vp: { b: [{ type: 'mimic' }], fx: ['flicker'], props: [], attrs: [], hostile: true } }); if (S.player) { const pl = S.player; const def = U.clone(S.types[d]); if (pl.glyph) { def.glyph = pl.glyph; def.tint = '#5a3d7a'; delete def.shape; } else { def.shape = pl.shape || 'blob'; def.color = '#5a3d7a'; } def.label = 'you?'; this.op({ op: 'set', path: 'types.' + d, value: def }); } return 'a shadowy doppelgänger that copies every move you make (and hurts to touch)'; } },
      { id: 'portals', ok: !S.types.portal, run: () => { this.addFromNP({ key: 'portal', word: 'portal', entry: L.noun('portal'), mods: [], colors: [], count: 3 }); return 'three portals that fling you somewhere random'; } },
      { id: 'hungry-ghosts', ok: items.length && !S.types.hungry_ghost, run: () => { this.addFromNP({ key: 'ghost', word: 'ghost', entry: L.noun('ghost'), mods: ['hungry'], colors: [], count: 3, vp: { b: [{ type: 'eat', target: items[0] }], fx: [], props: [], attrs: [] } }); return 'hungry ghosts that race you for the ' + U.plural(U.human(items[0]), 2) + ' and grow every time they eat one'; } },
      { id: 'night', ok: !(S.look.effects || []).includes('darkness'), run: () => { this.addEffects(['darkness', 'fireflies']); return 'the lights go out: you can only see a small circle around you (fireflies help)'; } },
      { id: 'tail', ok: S.player && S.world.physics !== 'snake' && items.length, run: () => { this.giveAbility('tail', { length: 2 }); const rr = S.rules.find((x) => x.when.type === 'onCollide' && x.when.b === items[0]); if (rr) this.op({ op: 'setRule', id: rr.id, rule: Object.assign({}, rr, { then: [{ type: 'growTail', amount: 1 }].concat(rr.then) }) }); return 'you grow a little tail with every ' + U.human(items[0]) + ' you collect'; } },
      { id: 'barrels', ok: !S.types.barrel, run: () => { this.addFromNP({ key: 'barrel', word: 'barrel', entry: L.noun('barrel'), mods: [], colors: [], count: 8 }); return 'explosive barrels; shoot one near a crowd and watch the chain reaction'; } },
      { id: 'friendly-enemy', ok: foes.length > 0 && !S.types.traitor, run: () => { const d = this.addFromNP({ key: S.types[foes[0]] && L.noun(foes[0]) ? foes[0] : 'zombie', word: 'traitor', mods: ['friendly'], colors: ['#7ee08a'], count: 2 }); return 'two traitor ' + U.plural(U.human(foes[0]), 2) + ' who switched sides and fight for you'; } },
      { id: 'giant-mushrooms', ok: !S.types.mushroom, run: () => { this.addFromNP({ key: 'mushroom', word: 'mushroom', entry: L.noun('mushroom'), mods: [], colors: [], count: 3 }); return 'mushrooms that make you giant for six seconds (you crush whatever you touch)'; } },
    ];
    let pool = T.filter((t) => t.ok && !used.has(t.id));
    if (!pool.length) pool = T.filter((t) => t.ok);
    if (!pool.length) pool = [T[3]];
    const picks = U.shuffle(pool, r).slice(0, count || 1);
    const done = [];
    for (const t of picks) { const d = t.run(); done.push({ id: t.id, desc: d }); }
    this.note('twist', { list: done });
    this.twists = done.map((d) => d.id);
  };

  Planner.prototype.improve = function () {
    const S = this.S;
    if (Spec.isEmpty(S)) { this.concept(); return; }
    const sum = Spec.summary(S);
    const todo = [];
    if (!sum.player) todo.push(() => this.ensurePlayer('improve'));
    if (!sum.collectibles.length) todo.push(() => this.addFromNP({ key: 'item', word: 'item', entry: L.noun('item'), mods: [], colors: [], count: 10 }));
    if (!sum.enemies.length) todo.push(() => this.addFromNP({ key: 'enemy', word: 'enemy', entry: L.noun('enemy'), mods: [], colors: [], count: 5 }));
    if (sum.enemies.length && !sum.weapon && S.world.physics !== 'snake' && S.world.physics !== 'paddle') todo.push(() => this.giveAbility(SIDE(S) ? 'shoot' : 'shoot', {}));
    if (!sum.hasWin) todo.push(() => this.goal());
    if (!S.audio.music) todo.push(() => this.music({}));
    if ((S.look.juice || 1) < 2) todo.push(() => this.juice());
    if (!S.meta.title) todo.push(() => this.title({ auto: true }));
    if (!todo.length) { this.surprise(1); return; }
    todo.slice(0, 3).forEach((f) => f());
    this.note('improve', { count: Math.min(3, todo.length) });
  };

  Planner.prototype.modifyGlobal = function (changes, vp, it) {
    const S = this.S;
    const all = Object.keys(S.types).filter((n) => !S.types[n].projectile);
    const perType = [];
    for (const ch of changes) {
      switch (ch.prop) {
        case 'speed': this.world({ prop: 'timeScale', mul: ch.mul || 1.3, set: ch.set != null ? U.clamp(ch.set / 100, 0.2, 3) : undefined }); break;
        case 'color': this.set('look.palette', this.paletteFromColor(ch.set)); this.note('palette', { to: ch.name || ch.set, color: ch.set }); break;
        case 'dark': this.addEffects(['darkness']); break;
        case 'lights': this.addEffects([], ['darkness', 'night']); break;
        case 'difficulty': this.difficulty(ch.set); break;
        case 'loud': this.music({ off: true }); break;
        case 'fx': if (ch.add === 'rainbow') this.addEffects(['psychedelic']); else if (ch.add === 'glow') this.addEffects(['glow']); perType.push(ch); break;
        case 'size': perType.push(ch); if (S.player) this.modifyPlayer([ch]); break;
        default: perType.push(ch);
      }
    }
    if (perType.length || vp) { this.modifyTypes(all, perType, vp); this.note('type-mod', { changes: this.changes.slice(), global: true }); }
    void it;
  };

  Planner.prototype.modifyFeature = function (name, changes, it) {
    const S = this.S;
    const up = changes.some((c) => (c.mul && c.mul > 1) || c.prop === 'hostile');
    const down = changes.some((c) => c.mul && c.mul < 1);
    const col = changes.find((c) => c.prop === 'color');
    switch (name) {
      case 'gravity': if (up || down) this.world({ prop: 'gravity', g: { mul: up ? 1.6 : 0.5 } }); else this.world({ prop: 'gravity', g: { add: true } }); break;
      case 'background': if (col) { const pal = Object.assign({}, this.pal(), { bg: U.shade(col.set, -0.55), bg2: U.shade(col.set, -0.25) }); this.set('look.palette', pal); this.note('background', { color: col.set }); } else if (changes.some((c) => c.prop === 'dark')) { const pal = Object.assign({}, this.pal(), { bg: U.shade(this.pal().bg, -0.5), bg2: U.shade(this.pal().bg2, -0.4) }); this.set('look.palette', pal); this.note('background', { darker: true }); } else this.note('noop', { what: 'background' }); break;
      case 'music': { const m = I.moodOf(it.raw); if (changes.some((c) => c.prop === 'loud')) this.music({ off: true }); else if (m) this.music({ mood: m }); else if (changes.some((c) => c.prop === 'speed')) this.music({ mood: S.audio.music, tempoMul: up ? 1.25 : 0.8 }); else this.music({}); break; }
      case 'camera': this.world({ prop: 'zoom', mul: up ? 1.3 : 0.75 }); break;
      case 'level': if (changes.some((c) => c.prop === 'size')) this.world({ prop: 'size', mul: up ? 1.5 : 0.7 }); else if (changes.some((c) => c.prop === 'count')) { const f = S.level.density == null ? 0.5 : S.level.density; this.set('level.density', U.clamp(f + (up ? 0.25 : -0.25), 0, 1)); this.note('density', { from: f, to: S.level.density }); } else this.reseed(); break;
      case 'walls': if (col) { this.set('look.palette', Object.assign({}, this.pal(), { wall: U.shade(col.set, -0.25), wallTop: col.set })); this.note('palette', { to: 'walls ' + (col.name || col.set), color: col.set }); } else if (changes.some((c) => c.prop === 'count')) this.modifyFeature('level', changes, it); else this.note('noop', { what: 'walls' }); break;
      case 'lighting': if (changes.some((c) => c.prop === 'lights')) this.addEffects([], ['darkness', 'night']); else this.addEffects(['darkness']); break;
      case 'colors': if (col) { this.set('look.palette', this.paletteFromColor(col.set)); this.note('palette', { to: col.name || col.set, color: col.set }); } else this.polish(); break;
      case 'timer': { const n = I.numberIn(it.raw); this.hud({ timer: n || (up ? (S.hud.timer || 60) * 1.5 : Math.max(10, (S.hud.timer || 60) * 0.6)) }); break; }
      case 'jump': this.modifyPlayer([{ prop: 'jump', mul: down ? 0.78 : 1.3 }]); break;
      case 'weather': if (up) this.addEffects(['storm']); else this.addEffects([], ['storm']); break;
      case 'screen': if (col) { this.set('look.palette', this.paletteFromColor(col.set)); this.note('palette', { to: col.name, color: col.set }); } else this.polish(); break;
      default: this.note('noop', { what: name });
    }
  };

  // ---------------------------------------------------------------------------
  // removals
  // ---------------------------------------------------------------------------
  Planner.prototype.removeTypes = function (names) {
    const S = this.S;
    const removed = [];
    for (const n of names || []) {
      if (!S.types[n]) continue;
      this.op({ op: 'removeType', name: n });
      removed.push(n);
      // projectiles only used by removed types
      for (const [pn, pd] of Object.entries(S.types)) {
        if (!pd.projectile) continue;
        const used = Object.values(S.types).some((d) => (d.behaviors || []).some((b) => b.projectile === pn)) || (S.player && S.player.abilities && S.player.abilities.shoot && S.player.abilities.shoot.projectile === pn);
        if (!used) { this.op({ op: 'removeType', name: pn }); removed.push(pn); }
      }
    }
    if (removed.length) this.note('type-remove', { names: removed });
    else this.note('noop', { what: names && names.join(', ') });
  };

  Planner.prototype.removeFeature = function (what) {
    const S = this.S;
    const w = String(what);
    if (/gravity/.test(w)) return this.world({ prop: 'gravity', g: { set: 0 } });
    if (/music|soundtrack|song/.test(w)) return this.music({ off: true });
    if (/sound effects|sfx|sounds?\b/.test(w)) return this.music({ sfxOnly: true, off: true });
    if (/background/.test(w)) { this.set('look.background', 'void'); this.note('background', { to: 'void' }); return; }
    if (/shake/.test(w)) return this.world({ prop: 'shake', set: 0 });
    for (const [k, re] of Object.entries(I.ENV)) if (re.test(w)) return this.addEffects([], [k].concat(k === 'storm' ? ['rain'] : k === 'night' ? ['darkness', 'stars'] : k === 'darkness' ? ['night'] : []));
    if (/lava|spikes|water|ice|hazards|traps/.test(w)) { ['lava', 'spikes', 'water', 'ice', 'bounce'].forEach((h) => { if (new RegExp(h).test(w) || /hazards|traps/.test(w)) this.levelHazard(h, true); }); if (/lava/.test(w) && S.level.type === 'islands') this.levelType('arena'); return; }
    if (/walls|level|maze|obstacles|platforms|terrain|map/.test(w)) return this.levelType('empty', 'remove');
    if (/effects|filters/.test(w)) { this.set('look.effects', ['vignette']); this.note('env', { add: [], remove: S.look.effects }); return; }
    if (/hud|score|health/.test(w)) { this.set('hud.score', false); this.note('hud', { hide: w }); return; }
    if (/boss/.test(w)) return this.removeTypes(Object.keys(S.types).filter((n) => S.types[n].boss));
    this.note('noop', { what: w });
  };

  Planner.prototype.unbehave = function (targetText, verb) {
    const S = this.S;
    const t = I.resolveTarget(targetText, { spec: S, focus: this.ctx.focus });
    if (!t || !t.names || !t.names.length) { this.note('noop', { what: targetText }); return; }
    const v = String(verb);
    const map = [[/shoot|fir|throw|spit|breath/, ['shoot']], [/chas|follow|hunt|attack|run after|come after/, ['chase', 'swarm', 'charge', 'follow']], [/jump|hop/, ['hop']], [/teleport|warp|blink/, ['warp']], [/multipl|reproduc|clone|spawn/, ['spawner']], [/move|walk|wander/, ['wander', 'patrol', 'chase', 'flee', 'zigzag', 'hop']], [/run away|flee/, ['flee']], [/orbit|circle/, ['orbit']], [/eat|steal/, ['eat', 'steal']]];
    this.changes = [];
    for (const n of t.names) {
      const d = U.clone(S.types[n]);
      if (!d) continue;
      let beh = d.behaviors || [];
      let hit = false;
      for (const [re, types] of map) if (re.test(v)) { const before = beh.length; beh = beh.filter((b) => !types.includes(b.type)); hit = hit || beh.length !== before; }
      if (/fly|float/.test(v)) { delete d.flying; hit = true; }
      if (/explod|blow/.test(v)) { delete d.explosive; delete d.kamikaze; hit = true; }
      if (/split/.test(v)) { d.onDeath = (d.onDeath || []).filter((a) => a.type !== 'split'); hit = true; }
      if (/hurt|damage|kill|bite/.test(v)) { d.damage = 0; hit = true; }
      if (/glow|spin|dance|flicker/.test(v)) { d.effects = (d.effects || []).filter((e) => !v.includes(e.slice(0, 4))); hit = true; }
      if (/move|walk/.test(v)) d.static = true;
      d.behaviors = beh; if (!beh.length) delete d.behaviors;
      if (hit || !U.same(d, S.types[n])) { this.op({ op: 'set', path: 'types.' + n, value: d }); this.changes.push({ name: n, prop: 'no longer', from: '', to: v }); }
    }
    this.note('type-mod', { changes: this.changes });
  };

  // ---------------------------------------------------------------------------
  // rules from parsed conditionals
  // ---------------------------------------------------------------------------
  Planner.prototype.rule = function (it) {
    const S = this.S;
    // ensure needed types
    for (const np of it.needs || []) {
      const id = U.ident(np.key || np.word || '');
      if (!id) continue;
      if (S.types[id]) continue;
      const usedInTrigger = JSON.stringify(it.trigger).includes('"' + id + '"');
      this.addFromNP(np, usedInTrigger ? {} : { count: 0 });
    }
    const trig = U.clone(it.trigger);
    // goal selector
    for (const k of ['a', 'b', 'of']) if (trig[k] === '__goal') {
      let ex = Object.keys(S.types).find((n) => S.types[n].exit);
      if (!ex) ex = this.addFromNP({ key: SIDE(S) ? 'flag' : 'door', word: 'exit', entry: L.noun(SIDE(S) ? 'flag' : 'door'), mods: [], colors: [], count: 1 });
      trig[k] = ex;
      // the user-specified rule replaces the default exit rule
      const def = S.rules.find((r) => r.when.type === 'onCollide' && r.when.b === ex && r.then.some((a) => a.type === 'nextLevel'));
      if (def) this.op({ op: 'removeRule', id: def.id });
    }
    // trigger subjects that don't exist yet
    for (const k of ['a', 'b', 'of']) {
      const v = trig[k];
      if (!v || ['player', 'enemy', 'collectible', 'any', 'boss', 'npc', 'pet', 'hazard', 'obstacle', 'projectile', 'lava', 'water', 'spikes', 'wall', 'ice', 'critter', 'structure'].includes(v) || S.types[v]) continue;
      const e = L.noun(v);
      this.addFromNP({ key: e ? v : null, word: v, entry: e, mods: [], colors: [], unknown: !e });
    }
    const acts = [];
    for (const a0 of it.actions) {
      const a = Object.assign({}, a0);
      if (a.__np) {
        const np = a.__np; delete a.__np;
        const name = this.addFromNP(np, { count: 0 });
        if (a.type === 'spawn' || a.type === 'drop') a.what = name;
        if (a.type === 'transform') a.into = name;
        if (!name) continue;
      }
      if (a.type === 'destroy' && trig.type === 'onDeath' && (a.target === 'self' || a.target === trig.of)) continue;
      if (a.target && a.target !== 'player' && a.target !== 'self' && a.target !== 'other' && a.target !== 'it' && !String(a.target).startsWith('all:') && !S.types[a.target] && !['enemy', 'collectible', 'boss'].includes(a.target)) a.target = 'self';
      acts.push(a);
    }
    if (!acts.length) { this.note('rule-fail', { raw: it.raw, unparsed: it.unparsed }); return; }
    if (trig.type === 'onCollide' && trig.a === 'player' && S.types[trig.b] && S.types[trig.b].role === 'collectible' && !acts.some((a) => a.type === 'destroy') && it.verb === 'collect') acts.push({ type: 'destroy', target: trig.b });
    const rule = { when: trig, then: acts, note: shortNote(it.raw) };
    if (it.cond) rule.cond = it.cond;
    if (trig.type === 'onScore' && !trig.every) rule.once = true;
    this.addRule(rule, 'user');
    if (it.unparsed && it.unparsed.length) this.note('partial', { unparsed: it.unparsed });
    if (acts.some((a) => a.type === 'flipGravity') && !SIDE(S)) this.note('consider', { text: 'flipTopdown' });
    for (const a of acts) if (a.what) this.focus.push(a.what);
  };
  function shortNote(raw) { return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 70); }

  Planner.prototype.keybind = function (it) {
    const S = this.S;
    const used = new Set(['r', 'w', 'a', 's', 'd', 'j', 'k', ' ']);
    const ab = (S.player && S.player.abilities) || {};
    if (ab.bomb) used.add('q'); if (ab.blink) used.add('e'); if (ab.shield) used.add('f'); if (ab.slowtime) used.add('t');
    for (const r of S.rules) if (r.when.type === 'onKey') used.add(r.when.key);
    const key = ['e', 'q', 'f', 'g', 'c', 'v', 'x', 'z', 't', 'b'].find((k) => !used.has(k)) || 'e';
    const acts = [];
    for (const a0 of it.actions) {
      const a = Object.assign({}, a0);
      if (a.__np) { const name = this.addFromNP(a.__np, { count: 0 }); delete a.__np; if (a.type === 'spawn') { a.what = name; a.at = a.at === 'random' ? 'near-player' : a.at; } if (a.type === 'transform') a.into = name; }
      if (a.type === 'explode') a.damage = a.damage || 2;
      if (a.target === 'self' || a.target === 'other') a.target = 'player';
      acts.push(a);
    }
    this.ensurePlayer('keybind');
    if (acts.some((a) => a.type === 'explode')) acts.unshift({ type: 'shake', power: 12 });
    this.addRule({ when: { type: 'onKey', key }, then: acts, note: 'press ' + key.toUpperCase() + ': ' + shortNote(it.raw.replace(/^let me\s+/, '')) }, 'keybind');
    this.note('keybind', { key, acts });
  };

  Planner.prototype.hud = function (it) {
    const S = this.S;
    if (it.timer != null) {
      this.set('hud.timer', it.timer);
      if (it.timer === 0) { for (const r of S.rules.filter((x) => x.when.type === 'onTimeUp')) this.op({ op: 'removeRule', id: r.id }); this.note('hud', { timer: 0 }); return; }
      if (it.survive) this.addRule({ when: { type: 'onTimeUp' }, then: [{ type: 'win', text: 'YOU SURVIVED' }], note: 'survive ' + it.timer + ' seconds' }, 'timer');
      else {
        if (it.goal) {
          const tr = I.parseTrigger(it.goal, { spec: S, focus: [] });
          if (tr) {
            const trig = tr.trig.type === 'onCollide' && tr.trig.b && S.types[tr.trig.b] ? { type: 'onCleared', of: tr.trig.b } : tr.trig;
            if (trig.of && !S.types[trig.of] && tr.need) this.addFromNP(tr.need);
            this.addRule({ when: trig, then: [{ type: 'win', text: 'IN TIME!' }], note: 'beat the clock' }, 'timer');
          }
        }
        this.addRule({ when: { type: 'onTimeUp' }, then: [{ type: 'lose', text: "TIME'S UP" }], note: 'when time runs out, you lose' }, 'timer');
      }
      this.note('hud', { timer: it.timer, survive: it.survive });
      return;
    }
    if (it.lives || it.hp) { this.modifyPlayer([it.lives ? { prop: 'lives', set: it.lives } : { prop: 'hp', set: it.hp }]); return; }
    if (it.hide) { if (it.hide === 'score' || it.hide === 'all') this.set('hud.score', false); if (it.hide === 'health' || it.hide === 'all') this.set('hud.health', false); this.note('hud', { hide: it.hide }); return; }
    if (it.show) { this.set('hud.score', true); this.set('hud.health', true); this.note('hud', { show: true }); }
  };

  // ---------------------------------------------------------------------------
  // main entry
  // ---------------------------------------------------------------------------
  P.plan = function (parsed, spec, ctx) {
    const p = new Planner(spec, ctx);
    const intents = parsed.intents || [];
    const kinds = intents.map((i) => i.kind);
    const special = intents.find((i) => ['undo', 'fix', 'reset', 'chat', 'question', 'keepbug'].includes(i.kind));
    if (special && intents.length === 1) return { kind: special.kind, intent: special, ops: [], notes: [], parsed };
    let unknown = 0;
    p.userAdds = intents.filter((i) => i.kind === 'add').flatMap((i) => i.nps || []);
    // themes & genres first so later entities pick up context
    const order = (it) => ({ theme: 0, genre: 1, palette: 2, level: 3, world: 3 })[it.kind] != null ? ({ theme: 0, genre: 1, palette: 2, level: 3, world: 3 })[it.kind] : 5;
    const sorted = intents.map((it, i) => ({ it, i })).sort((a, b) => order(a.it) - order(b.it) || a.i - b.i).map((x) => x.it);
    for (const it of sorted) {
      p.changes = [];
      try {
        switch (it.kind) {
          case 'add': for (const np of it.nps) { if (np.entry && np.entry.role === 'tile') p.levelHazard(np.entry.tile); else p.addFromNP(np); } break;
          case 'player': p.playerSkin(it.np); break;
          case 'ability': if (it.props) p.modifyPlayer(it.props); for (const a of it.list || []) p.giveAbility(a.name, a.params, it); if (it.note === 'swim') p.note('consider', { text: 'swim' }); break;
          case 'keybind': p.keybind(it); break;
          case 'genre': p.defendNP = it.defendNP || null; p.genre(it.genre, it.extras); break;
          case 'theme': p.applyTheme(it.theme); break;
          case 'env': p.addEffects(it.add, it.remove); break;
          case 'background': {
            p.bgTouched = true;
            if (it.bg) { const from = p.S.look.background; p.set('look.background', it.bg); p.note('background', { from, to: it.bg }); }
            if (it.color) { const pal = Object.assign({}, p.pal(), { bg: U.shade(it.color, -0.55), bg2: U.shade(it.color, -0.25) }); p.set('look.palette', pal); p.note('background', { color: it.color }); }
            if (!it.bg && !it.color) p.note('noop', { what: 'background' });
            break;
          }
          case 'palette': {
            if (it.palette) { const from = p.S.look.palette; p.set('look.palette', it.palette); p.note('palette', { from: typeof from === 'string' ? from : 'custom', to: it.palette }); }
            else if (it.color) { p.set('look.palette', p.paletteFromColor(it.color, it.shade)); p.note('palette', { to: it.word, color: it.color }); if (p.S.player && !p.S.player.glyph) p.set('player.color', p.paletteFromColor(it.color, it.shade).player); }
            break;
          }
          case 'music': p.music(it); break;
          case 'world': p.world(it); break;
          case 'level': {
            if (it.reseed) p.reseed();
            if (it.type) p.levelType(it.type, it.floorLava ? 'lava' : 'user');
            if (it.hazards) for (const h of it.hazards) p.levelHazard(h, it.removeHazards);
            if (it.density) { const f = p.S.level.density == null ? 0.5 : p.S.level.density; p.set('level.density', U.clamp(Math.round((f + it.density) * 100) / 100, 0, 1)); p.note('density', { from: f, to: p.S.level.density }); }
            if (it.floorLava) p.flags.floorLava = true;
            break;
          }
          case 'hud': p.hud(it); break;
          case 'title': p.title(it); break;
          case 'rule': p.rule(it); break;
          case 'modify': {
            const t = it.target;
            const changes = it.changes || [];
            if (changes.some((c) => c.prop === 'difficulty')) { p.difficulty(changes.find((c) => c.prop === 'difficulty').set); break; }
            if (t.kind === 'player') p.modifyPlayer(changes, it.vp);
            else if (t.kind === 'types' || t.kind === 'role') { if (!t.names || !t.names.length) { if (t.kind === 'role') { p.note('noop', { what: t.role }); break; } } p.modifyTypes(t.names, changes, it.vp); p.note('type-mod', { changes: p.changes.slice(), complaint: it.complaint }); }
            else if (t.kind === 'pronoun') p.modifyPlayer(changes, it.vp);
            else if (t.kind === 'global') p.modifyGlobal(changes, it.vp, it);
            else if (t.kind === 'feature') p.modifyFeature(t.name, changes, it);
            break;
          }
          case 'rename': for (const n of it.names) p.renameType(n, it.np); break;
          case 'learn': p.addFromNP(Object.assign({}, it.np, { vp: { b: [], fx: [], props: it.changes, attrs: [], hostile: it.changes.some((c) => c.prop === 'hostile'), collect: it.changes.some((c) => c.prop === 'points' || c.prop === 'collectible'), friend: it.changes.some((c) => c.prop === 'friendly') } })); break;
          case 'say': {
            let names = it.names;
            if (!names && it.np) names = [p.addFromNP(it.np)];
            for (const n of names || []) { if (!n) continue; const txt = it.text || p.lineFor(n, { key: n }); p.addRule({ when: { type: 'onNear', a: 'player', b: n, distance: 100 }, then: [{ type: 'say', target: n, text: txt }], note: U.human(n) + ' talks' }, 'talk'); }
            break;
          }
          case 'remove': p.removeTypes(it.target.names); break;
          case 'removeFeature': p.removeFeature(it.what); break;
          case 'removeAbility': p.removeAbility(it.verb); break;
          case 'removePlayer': if (p.S.player) { p.op({ op: 'set', path: 'player', value: null }); p.note('player-remove', {}); } break;
          case 'removeGoal': { const ids = p.S.rules.filter((r) => r.then.some((a) => a.type === 'win')).map((r) => r.id); ids.forEach((id) => p.op({ op: 'removeRule', id })); p.note('goal-remove', { count: ids.length }); break; }
          case 'clearRules': { const n = p.S.rules.length; p.S.rules.map((r) => r.id).forEach((id) => p.op({ op: 'removeRule', id })); p.note('rules-clear', { count: n }); break; }
          case 'clearMods': p.set('mods', ''); p.note('mods-clear', {}); break;
          case 'unbehave': p.unbehave(it.target, it.verb); break;
          case 'difficulty': p.difficulty(it.dir, it.extreme); break;
          case 'juice': p.juice(); break;
          case 'polish': p.polish(); break;
          case 'surprise': p.surprise(ctx.model === 'chaos' ? 2 : 1); break;
          case 'improve': p.improve(); break;
          case 'goal': p.goal(it.levels); break;
          case 'explosions': { for (const [n, d] of Object.entries(p.S.types)) { if (d.explode) p.set('types.' + n + '.explode', Math.round(d.explode * it.mul)); if (d.explosive && !d.explode) p.set('types.' + n + '.explode', Math.round(80 * it.mul)); } p.S.rules.forEach((r) => { if (r.then.some((a) => a.type === 'explode')) p.op({ op: 'setRule', id: r.id, rule: Object.assign({}, r, { then: r.then.map((a) => (a.type === 'explode' ? Object.assign({}, a, { radius: Math.round((a.radius || 90) * it.mul) }) : a)) }) }); }); p.note('explosions', { mul: it.mul }); break; }
          case 'style': p.set('look.style', it.style); p.note('style', { style: it.style }); break;
          case 'recursion': { p.addFromNP({ key: 'computer', word: 'computer', entry: L.noun('computer'), mods: [], colors: [], count: 1 }); p.flags.recursion = true; break; }
          case 'undo': case 'fix': case 'reset': case 'chat': case 'question': case 'keepbug': p.note('special', { kind: it.kind }); break;
          case 'unknown': unknown++; p.note('unknown', { text: it.text, words: it.words }); break;
          default: unknown++; break;
        }
      } catch (e) {
        console.error('planner', it, e);
        p.note('error', { kind: it.kind, message: e.message });
      }
    }
    // a world with things but nobody to play it
    if (!p.S.player && Object.keys(p.S.types).length && !kinds.includes('removePlayer')) p.ensurePlayer('things');
    // if theme picked but empty world, give the player a stage
    if (p.wasEmpty && p.S.player && p.S.level.type === 'empty' && !p.levelTouched && !['shmup', 'paddle'].includes(p.S.world.physics)) p.set('level.type', SIDE(p.S) ? 'platforms' : 'arena');
    const kind = p.ops.length ? 'build' : unknown ? 'clarify' : special ? special.kind : 'noop';
    return {
      kind, ops: p.ops, notes: p.notes, focus: uniq(p.focus), warnings: p.warnings, flags: p.flags, spec: Spec.normalize(p.S), before: spec, parsed,
      twists: p.twists || [], intents, special,
    };
  };

  P.Planner = Planner;
  VC.Planner = P;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
