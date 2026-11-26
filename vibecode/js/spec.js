/* VibeCode — the game spec (single source of truth) and atomic operations on it. */
(function (VC) {
  'use strict';
  const U = VC.U;
  const Spec = {};

  Spec.empty = function () {
    return {
      v: 1,
      meta: { title: '', tagline: '', genre: null, theme: null, genres: [] },
      world: { physics: 'topdown', width: 1600, height: 1000, gravity: 1500, bounds: 'walls', timeScale: 1 },
      camera: { follow: true, zoom: 1, shake: 1 },
      level: { type: 'empty', tile: 40, seed: 1 + Math.floor(U.random() * 9999), density: 0.5, hazards: [], goal: false },
      look: { palette: 'ember', background: 'void', effects: ['vignette'], juice: 1, style: 'emoji' },
      audio: { music: null, tempo: 110, sfx: true },
      hud: { score: true, health: true, timer: 0 },
      player: null,
      types: {},
      rules: [],
      mods: '',
    };
  };

  Spec.normalize = function (s) {
    const base = Spec.empty();
    s = s || {};
    const out = Object.assign({}, base, s);
    for (const k of ['meta', 'world', 'camera', 'level', 'look', 'audio', 'hud']) out[k] = Object.assign({}, base[k], s[k] || {});
    out.types = s.types || {};
    out.rules = (s.rules || []).map((r, i) => Object.assign({ id: r.id || 'r' + (i + 1) }, r));
    out.player = s.player || null;
    out.mods = s.mods || '';
    if (!Array.isArray(out.look.effects)) out.look.effects = [];
    if (!Array.isArray(out.level.hazards)) out.level.hazards = [];
    if (!Array.isArray(out.meta.genres)) out.meta.genres = [];
    return out;
  };

  Spec.isEmpty = (s) => !s.player && !Object.keys(s.types).length && !s.rules.length;

  Spec.nextRuleId = function (spec) {
    let n = 1;
    const ids = new Set(spec.rules.map((r) => r.id));
    while (ids.has('r' + n)) n++;
    return 'r' + n;
  };

  // ops: set | del | push | pull | merge | rename | addRule | removeRule
  Spec.apply = function (spec, ops) {
    const s = U.clone(spec);
    for (const op of ops) Spec.applyOne(s, op);
    return Spec.normalize(s);
  };

  Spec.applyOne = function (s, op) {
    switch (op.op) {
      case 'set': U.setPath(s, op.path, U.clone(op.value)); break;
      case 'del': U.delPath(s, op.path); break;
      case 'merge': {
        const cur = U.getPath(s, op.path) || {};
        U.setPath(s, op.path, Object.assign({}, cur, U.clone(op.value)));
        break;
      }
      case 'push': {
        const arr = U.getPath(s, op.path) || [];
        arr.push(U.clone(op.value));
        U.setPath(s, op.path, arr);
        break;
      }
      case 'pull': {
        const arr = U.getPath(s, op.path) || [];
        U.setPath(s, op.path, arr.filter((x, i) => !(op.index === i || (op.match && Object.keys(op.match).every((k) => U.same(x[k], op.match[k]))))));
        break;
      }
      case 'addRule': {
        const r = U.clone(op.rule);
        r.id = r.id && !s.rules.find((x) => x.id === r.id) ? r.id : Spec.nextRuleId(s);
        s.rules.push(r);
        break;
      }
      case 'removeRule': s.rules = s.rules.filter((r) => r.id !== op.id); break;
      case 'setRule': s.rules = s.rules.map((r) => (r.id === op.id ? U.clone(op.rule) : r)); break;
      case 'rename': {
        if (!s.types[op.from] || op.from === op.to) break;
        const def = s.types[op.from];
        delete s.types[op.from];
        s.types[op.to] = def;
        VC.DSL.renameRefs(s, op.from, op.to);
        break;
      }
      case 'removeType': {
        delete s.types[op.name];
        // drop rules that reference the type directly
        s.rules = s.rules.filter((r) => !JSON.stringify(r).includes('"' + op.name + '"'));
        for (const d of Object.values(s.types)) {
          if (d.behaviors) d.behaviors = d.behaviors.filter((b) => b.what !== op.name && b.projectile !== op.name);
          if (d.onDeath) d.onDeath = d.onDeath.filter((a) => a.what !== op.name && a.into !== op.name);
        }
        if (s.player && s.player.abilities && s.player.abilities.shoot && s.player.abilities.shoot.projectile === op.name) delete s.player.abilities.shoot;
        break;
      }
      default: throw new Error('Unknown op ' + op.op);
    }
  };

  // Which files an op touches
  Spec.filesForOp = function (op) {
    const p = op.path || '';
    if (op.op === 'addRule' || op.op === 'removeRule' || op.op === 'setRule') return ['src/rules.js'];
    if (op.op === 'rename') return ['src/entities/' + op.from + '.js', 'src/entities/' + op.to + '.js', 'src/rules.js'];
    if (op.op === 'removeType') return ['src/entities/' + op.name + '.js', 'src/rules.js'];
    if (p.startsWith('types.')) return ['src/entities/' + p.split('.')[1] + '.js'];
    if (p.startsWith('player')) return ['src/player.js'];
    if (p.startsWith('rules')) return ['src/rules.js'];
    if (p === 'mods') return ['src/mods.js'];
    return ['game.config.js'];
  };

  Spec.typesByRole = function (spec, role) {
    return Object.entries(spec.types).filter(([, d]) => (role === 'enemy' ? (d.role === 'enemy' || d.role === 'boss' || d.team === 'enemy') && !d.projectile : d.role === role)).map(([k]) => k);
  };

  Spec.summary = function (spec) {
    const t = Object.entries(spec.types).filter(([, d]) => !d.projectile);
    return {
      player: !!spec.player,
      physics: spec.world.physics,
      level: spec.level.type,
      types: t.map(([k]) => k),
      enemies: Spec.typesByRole(spec, 'enemy'),
      collectibles: Spec.typesByRole(spec, 'collectible'),
      rules: spec.rules.length,
      weapon: !!(spec.player && spec.player.abilities && (spec.player.abilities.shoot || spec.player.abilities.melee || spec.player.abilities.bomb)),
      hasWin: spec.rules.some((r) => r.then.some((a) => a.type === 'win' || a.type === 'nextLevel')),
      music: spec.audio.music,
    };
  };

  VC.Spec = Spec;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
