/* VibeCode — DSL: helper registries, spec -> source files, source -> spec, diff, highlight, English. */
(function (VC) {
  'use strict';
  const U = VC.U;
  const DSL = {};

  // ---------------------------------------------------------------------------
  // Registries. p = positional params, d = description, o = documented options
  // ---------------------------------------------------------------------------
  const BEHAVIORS = {
    wander: { p: [], d: 'roams around randomly', o: 'speed, turn' },
    chase: { p: ['target'], d: 'moves toward a target ("player", a type name, or "enemy")', o: 'speed, range (0 = any distance), sight (vision cone range), lead (predict movement)' },
    flee: { p: ['from'], d: 'runs away from a target', o: 'range' },
    patrol: { p: [], d: 'walks back and forth, turning at walls and ledges', o: 'axis ("x" | "y"), distance' },
    orbit: { p: ['target'], d: 'circles around a target', o: 'radius, speed' },
    shoot: { p: ['projectile'], d: 'fires a projectile type', o: 'at ("player" | "forward" | "down" | "up" | "radial" | "spiral" | "random" | "enemy"), rate (shots/sec), count, spread (degrees), range' },
    hop: { p: [], d: 'jumps periodically', o: 'power, every' },
    zigzag: { p: [], d: 'jitters side to side while moving', o: 'amount, freq' },
    wave: { p: [], d: 'bobs in a sine wave', o: 'amount, freq' },
    spin: { p: [], d: 'rotates continuously', o: 'speed' },
    pulse: { p: [], d: 'grows and shrinks rhythmically', o: 'amount, freq' },
    follow: { p: ['target'], d: 'follows a target at a distance (companions)', o: 'distance' },
    guard: { p: [], d: 'attacks the nearest hostile thing nearby', o: 'range' },
    warp: { p: [], d: 'teleports to a random spot periodically', o: 'every' },
    spawner: { p: ['what'], d: 'periodically spawns another type', o: 'every, max, count' },
    swell: { p: [], d: 'slowly grows over time', o: 'rate, max' },
    magnet: { p: ['target'], d: 'pulls targets toward itself', o: 'range, strength' },
    homing: { p: ['target'], d: 'steers toward the nearest target (projectiles)', o: 'turn' },
    swarm: { p: ['target'], d: 'flocks with its own kind while chasing', o: 'speed' },
    fall: { p: [], d: 'falls from the top of the world and respawns', o: 'speed' },
    drift: { p: [], d: 'floats in a straight line, wrapping around', o: 'speed' },
    charge: { p: ['target'], d: 'periodically dashes at a target', o: 'every, speed' },
    kite: { p: ['target'], d: 'keeps its distance from a target', o: 'distance' },
    bounce: { p: [], d: 'moves at constant speed, bouncing off walls', o: 'speed' },
    sleep: { p: [], d: 'stays idle until the player comes near', o: 'wake (distance)' },
    mimic: { p: [], d: 'copies the player\'s movement', o: '' },
    aura: { p: [], d: 'damages nearby hostile things', o: 'radius, damage, every' },
    eat: { p: ['target'], d: 'hunts and eats a target type (e.g. "collectible")', o: '' },
    steal: { p: [], d: 'steals points when it touches the player', o: 'amount' },
  };

  const ABILITIES = {
    jump: { p: [], d: 'jump with Space / W / Up', o: 'power, double (bool), wall (bool)' },
    flap: { p: [], d: 'flap upward with Space, any time', o: 'power' },
    shoot: { p: ['projectile'], d: 'shoot with Click / J', o: 'rate, aim ("mouse" | "facing" | "up" | "auto"), count, spread, auto (bool: fire continuously)' },
    melee: { p: ['weapon'], d: 'swing a weapon with K / right-click', o: 'damage, reach, rate' },
    dash: { p: [], d: 'dash with Shift', o: 'power, cooldown' },
    shield: { p: [], d: 'hold F to block damage', o: 'duration, cooldown' },
    fly: { p: [], d: 'hold Space to fly (jetpack)', o: 'power' },
    bomb: { p: [], d: 'drop a bomb with Q', o: 'radius, cooldown, fuse' },
    blink: { p: [], d: 'teleport toward the cursor with E', o: 'distance, cooldown' },
    magnet: { p: [], d: 'pull in collectibles from afar', o: 'range' },
    regen: { p: [], d: 'slowly regenerate health', o: 'every' },
    slowtime: { p: [], d: 'press T for bullet time', o: 'factor, duration, cooldown' },
    tail: { p: [], d: 'grow a trailing tail (snake)', o: 'length, deadly (bool)' },
  };

  const TRIGGERS = {
    onCollide: { p: ['a', 'b'], d: 'when a touches b (types, roles, "player", or tiles: "lava" | "water" | "spikes" | "wall")' },
    onTimer: { p: ['every'], d: 'every N seconds', o: 'start' },
    onAfter: { p: ['seconds'], d: 'once, N seconds into the round' },
    onStart: { p: [], d: 'when a round starts' },
    onDeath: { p: ['of'], d: 'when something dies' },
    onHurt: { p: ['of'], d: 'when something takes damage' },
    onScore: { p: ['atLeast'], d: 'when the score reaches N', o: 'every (bool: repeat every N points)' },
    onCleared: { p: ['of'], d: 'when none of a type/role are left' },
    onCollected: { p: ['of', 'count'], d: 'when the player has collected N of a type' },
    onKilled: { p: ['of', 'count'], d: 'when N of a type have died' },
    onKey: { p: ['key'], d: 'when a key is pressed' },
    onClick: { p: ['of'], d: 'when the player clicks something' },
    onNear: { p: ['a', 'b', 'distance'], d: 'when a comes within distance of b' },
    onHealth: { p: ['atMost'], d: 'when player HP drops to N or below' },
    onTimeUp: { p: [], d: 'when the HUD countdown hits zero' },
    onFall: { p: ['of'], d: 'when something falls out of the world' },
    onJump: { p: [], d: 'when the player jumps' },
    onLand: { p: [], d: 'when the player lands' },
    onShoot: { p: [], d: 'when the player shoots' },
    onDash: { p: [], d: 'when the player dashes' },
    onSpawn: { p: ['of'], d: 'when something spawns' },
    onHitWall: { p: ['of'], d: 'when something bumps into a wall' },
    onLevel: { p: ['level'], d: 'when level N starts' },
    onVar: { p: ['name', 'atLeast'], d: 'when a variable reaches N' },
  };

  const ACTIONS = {
    addScore: { p: ['amount'], d: 'add points' },
    damage: { p: ['target', 'amount'], d: 'hurt a target' },
    heal: { p: ['target', 'amount'], d: 'restore HP' },
    destroy: { p: ['target'], d: 'remove a target' },
    spawn: { p: ['what', 'count', 'at'], d: 'spawn entities (at: "random" | "edges" | "top" | "here" | "player" | "center" | "ground" | "sky")' },
    shake: { p: ['power'], d: 'shake the camera' },
    flash: { p: ['color'], d: 'flash the screen' },
    sound: { p: ['name'], d: 'play a sound (coin, jump, hit, hurt, explode, powerup, laser, quack, win, lose, blip, bounce, magic, splash)' },
    burst: { p: ['color', 'count'], d: 'particle burst at the event position' },
    grow: { p: ['target', 'factor'], d: 'scale a target\'s size' },
    speedUp: { p: ['target', 'factor'], d: 'multiply a target\'s speed' },
    say: { p: ['target', 'text'], d: 'speech bubble above a target' },
    banner: { p: ['text'], d: 'big message across the screen' },
    win: { p: ['text'], d: 'win the game' },
    lose: { p: ['text'], d: 'lose the game' },
    nextLevel: { p: [], d: 'advance to the next level' },
    restart: { p: [], d: 'restart the round' },
    teleport: { p: ['target', 'to'], d: 'move a target (to: "random" | "start" | "player" | "center")' },
    transform: { p: ['target', 'into'], d: 'turn a target into another type' },
    setVar: { p: ['name', 'value'], d: 'set a variable' },
    addVar: { p: ['name', 'amount'], d: 'add to a variable' },
    setWorld: { p: ['key', 'value'], d: 'change a world setting at runtime (gravity, timeScale)' },
    slowmo: { p: ['seconds', 'factor'], d: 'slow motion' },
    explode: { p: ['radius', 'damage'], d: 'explosion at the event position' },
    knockback: { p: ['target', 'power'], d: 'push a target away' },
    launch: { p: ['target', 'power'], d: 'launch a target upward' },
    paint: { p: ['target', 'color'], d: 'recolor a target' },
    growTail: { p: ['amount'], d: 'grow the player\'s tail' },
    addTime: { p: ['seconds'], d: 'add time to the countdown' },
    toggleEffect: { p: ['effect'], d: 'toggle a visual effect' },
    confetti: { p: [], d: 'celebrate' },
    split: { p: ['into', 'count'], d: 'split into smaller copies' },
    drop: { p: ['what', 'chance'], d: 'drop an item (chance 0..1)' },
    powerup: { p: ['kind', 'seconds'], d: 'temporary player power (invincible, speed, giant, tiny, rapidfire, magnet, ghost, double, fly)' },
    flipGravity: { p: [], d: 'reverse gravity' },
    tint: { p: ['color', 'seconds'], d: 'tint the screen for a while' },
    music: { p: ['mood'], d: 'change the music (chill, epic, spooky, happy, dreamy, intense, retro, off)' },
    giveAbility: { p: ['ability'], d: 'grant the player an ability' },
    freeze: { p: ['target', 'seconds'], d: 'freeze a target in place' },
    zoom: { p: ['amount'], d: 'zoom the camera' },
    stealScore: { p: ['amount'], d: 'subtract points' },
  };

  DSL.BEHAVIORS = BEHAVIORS; DSL.ABILITIES = ABILITIES; DSL.TRIGGERS = TRIGGERS; DSL.ACTIONS = ACTIONS;

  DSL.PHYSICS = ['topdown', 'platformer', 'runner', 'ship', 'tank', 'snake', 'shmup', 'paddle'];
  DSL.LEVELS = ['empty', 'arena', 'obstacles', 'maze', 'caves', 'dungeon', 'platforms', 'tower', 'islands', 'runner', 'pipes', 'track', 'city', 'forest', 'bricks'];
  DSL.EFFECTS = ['vignette', 'crt', 'scanlines', 'pixelate', 'glow', 'darkness', 'rain', 'snow', 'storm', 'fog', 'embers', 'leaves', 'dust', 'bubbles', 'fireflies', 'sparkles', 'stars', 'trails', 'chroma', 'grayscale', 'invert', 'sepia', 'psychedelic', 'flip', 'mirror', 'wobble', 'daynight', 'night', 'blur', 'hueshift'];
  DSL.BACKGROUNDS = ['void', 'grid', 'stars', 'gradient', 'sky', 'clouds', 'mountains', 'hills', 'forest', 'ocean', 'dunes', 'snow', 'hell', 'city', 'synthwave', 'graveyard', 'dots'];
  DSL.SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'hex', 'blob', 'ring', 'line', 'capsule', 'trampoline'];

  // ---------------------------------------------------------------------------
  // Serialization helpers
  // ---------------------------------------------------------------------------
  const IDENT = /^[A-Za-z_$][\w$]*$/;
  function isPlain(o) { return o && typeof o === 'object' && !Array.isArray(o); }

  function lit(v, indent) {
    indent = indent || '';
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    if (typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      const items = v.map((x) => lit(x, indent + '  '));
      const one = '[' + items.join(', ') + ']';
      if (one.length < 64 && !one.includes('\n')) return one;
      return '[\n' + items.map((s) => indent + '  ' + s + ',').join('\n') + '\n' + indent + ']';
    }
    if (isPlain(v)) {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined);
      if (!keys.length) return '{}';
      const parts = keys.map((k) => (IDENT.test(k) ? k : JSON.stringify(k)) + ': ' + lit(v[k], indent + '  '));
      const one = '{ ' + parts.join(', ') + ' }';
      if (one.length < 64 && !one.includes('\n')) return one;
      return '{\n' + parts.map((s) => indent + '  ' + s + ',').join('\n') + '\n' + indent + '}';
    }
    return JSON.stringify(v);
  }
  DSL.lit = lit;

  function call(reg, obj, indent) {
    const def = reg[obj.type];
    if (!def) return lit(obj, indent);
    const args = [];
    const used = new Set(['type']);
    for (const p of def.p) {
      if (obj[p] === undefined) break;
      args.push(lit(obj[p], indent));
      used.add(p);
    }
    const rest = {};
    for (const k of Object.keys(obj)) if (!used.has(k) && obj[k] !== undefined) rest[k] = obj[k];
    if (Object.keys(rest).length) args.push(lit(rest, indent));
    return obj.type + '(' + args.join(', ') + ')';
  }
  DSL.call = call;

  function callList(reg, list, indent, used) {
    if (!list || !list.length) return '[]';
    const items = list.map((o) => { used && used.add(o.type); return call(reg, o, indent + '  '); });
    const one = '[' + items.join(', ') + ']';
    if (one.length < 60 && !one.includes('\n')) return one;
    return '[\n' + items.map((s) => indent + '  ' + s + ',').join('\n') + '\n' + indent + ']';
  }

  function importLine(names) {
    const list = [...names];
    const line = 'import { ' + list.join(', ') + ' } from "vibe";';
    if (line.length <= 90) return line;
    return 'import {\n' + list.map((n) => '  ' + n + ',').join('\n') + '\n} from "vibe";';
  }

  // ---------------------------------------------------------------------------
  // spec -> files
  // ---------------------------------------------------------------------------
  const ENTITY_ORDER = ['glyph', 'shape', 'label', 'role', 'team', 'color', 'size', 'speed', 'hp', 'damage', 'points', 'projectile', 'lifetime', 'pierce', 'explode', 'flying', 'ghost', 'static', 'solid', 'pushable', 'bouncy', 'boss', 'invulnerable', 'alpha', 'effects', 'behaviors', 'onDeath', 'spawn'];
  const ENTITY_COMMENTS = { damage: 'contact damage', points: 'score when collected', ghost: 'passes through walls', pushable: 'can be shoved around', bouncy: 'restitution 0..1', alpha: 'opacity', lifetime: 'seconds before vanishing', pierce: 'passes through targets', explode: 'explosion radius on impact' };

  DSL.entityFile = function (name, def) {
    const used = new Set(['defineEntity']);
    const lines = [];
    const keys = ENTITY_ORDER.filter((k) => def[k] !== undefined).concat(Object.keys(def).filter((k) => !ENTITY_ORDER.includes(k) && def[k] !== undefined));
    for (const k of keys) {
      if (k === 'name') continue;
      let v;
      if (k === 'behaviors') v = callList(BEHAVIORS, def[k], '  ', used);
      else if (k === 'onDeath') v = callList(ACTIONS, def[k], '  ', used);
      else v = lit(def[k], '  ');
      const c = ENTITY_COMMENTS[k] ? ' // ' + ENTITY_COMMENTS[k] : '';
      lines.push('  ' + (IDENT.test(k) ? k : JSON.stringify(k)) + ': ' + v + ',' + c);
    }
    const head = '// src/entities/' + name + '.js' + (def.role ? ' — ' + roleBlurb(def) : '');
    return head + '\n' + importLine(used) + '\n\nexport default defineEntity(' + JSON.stringify(name) + ', {\n' + lines.join('\n') + '\n});\n';
  };

  function roleBlurb(def) {
    if (def.projectile) return 'a projectile';
    return ({ enemy: 'hostile', boss: 'a boss', collectible: 'a pickup', hazard: 'a hazard', obstacle: 'an obstacle', npc: 'a character', pet: 'a companion', structure: 'a structure', critter: 'ambient life', vehicle: 'a vehicle' })[def.role] || def.role;
  }

  const PLAYER_ORDER = ['glyph', 'shape', 'label', 'color', 'size', 'speed', 'hp', 'lives', 'effects', 'abilities'];
  DSL.playerFile = function (p) {
    const used = new Set(['definePlayer']);
    const lines = [];
    const keys = PLAYER_ORDER.filter((k) => p[k] !== undefined).concat(Object.keys(p).filter((k) => !PLAYER_ORDER.includes(k) && p[k] !== undefined));
    for (const k of keys) {
      let v;
      if (k === 'abilities') {
        const list = Object.entries(p.abilities || {}).map(([type, o]) => Object.assign({ type }, o));
        v = callList(ABILITIES, list, '  ', used);
      } else v = lit(p[k], '  ');
      lines.push('  ' + k + ': ' + v + ',');
    }
    return '// src/player.js — that\'s you\n' + importLine(used) + '\n\nexport default definePlayer({\n' + lines.join('\n') + '\n});\n';
  };

  DSL.rulesFile = function (rules) {
    const used = new Set(['defineRules', 'rule']);
    const body = [];
    for (const r of rules || []) {
      used.add(r.when.type);
      const acts = (r.then || []).map((a) => { used.add(a.type); return call(ACTIONS, a, '    '); });
      const opts = {};
      if (r.once) opts.once = true;
      if (r.cond) opts.if = r.cond;
      const optStr = Object.keys(opts).length ? ', ' + lit(opts, '  ') : '';
      if (r.note) body.push('  // ' + r.note);
      const trig = call(TRIGGERS, r.when, '  ');
      const oneLine = '  rule(' + trig + ', [' + acts.join(', ') + ']' + optStr + '),';
      if (oneLine.length <= 92) body.push(oneLine);
      else body.push('  rule(' + trig + ', [\n' + acts.map((a) => '    ' + a + ',').join('\n') + '\n  ]' + optStr + '),');
    }
    const content = body.length ? '\n' + body.join('\n') + '\n' : '';
    return '// src/rules.js — when this happens, do that\n' + importLine(used) + '\n\nexport default defineRules([' + content + ']);\n';
  };

  DSL.configFile = function (spec) {
    const cfg = {
      title: spec.meta.title || undefined,
      tagline: spec.meta.tagline || undefined,
      world: spec.world,
      camera: spec.camera,
      level: spec.level,
      look: spec.look,
      audio: spec.audio,
      hud: spec.hud,
    };
    let s = lit(cfg, '');
    s = s.replace(/(\n  world: \{\n    physics: "[a-z]+",)/, '$1 // ' + DSL.PHYSICS.join(' | '));
    return '// game.config.js — world, camera, level and look\nimport { defineGame } from "vibe";\n\nexport default defineGame(' + s + ');\n';
  };

  DSL.MAIN_JS = '// src/main.js — boots the game. You rarely need to touch this.\nimport { createGame } from "vibe";\nimport config from "../game.config.js";\nimport player from "./player.js";\nimport rules from "./rules.js";\nimport * as mods from "./mods.js";\n\nconst entities = import.meta.glob("./entities/*.js", { eager: true });\n\ncreateGame({ config, player, entities, rules, mods }).start();\n';

  DSL.MODS_TEMPLATE = [
    '// src/mods.js — your playground. Real JavaScript, hot-reloaded on save.',
    '// Vibe leaves this file alone unless you ask it to write a mod.',
    '//',
    '// Hooks you can export:',
    '//   onStart(game)            — a round begins',
    '//   onUpdate(game, dt)       — every frame (dt in seconds)',
    '//   onEvent(game, name, e)   — "death" | "collect" | "hurt" | "spawn" | "jump" | "shoot" | "win" | "lose"',
    '//   onDraw(game, ctx)        — draw on top of the world (world coordinates)',
    '//',
    '// game API: game.player, game.entities(sel), game.spawn(type, x, y), game.destroy(e),',
    '//   game.damage(e, n), game.say(e, text), game.banner(text), game.shake(n), game.sound(name),',
    '//   game.burst(x, y, color), game.score, game.addScore(n), game.vars, game.key("w"),',
    '//   game.mouse, game.time, game.win(msg), game.lose(msg), game.log(...)',
    '//',
    '// Example — every enemy slowly orbits the player:',
    '// export function onUpdate(game, dt) {',
    '//   for (const e of game.entities("enemy")) {',
    '//     const a = Math.atan2(e.y - game.player.y, e.x - game.player.x) + dt;',
    '//     const r = Math.hypot(e.x - game.player.x, e.y - game.player.y);',
    '//     e.x = game.player.x + Math.cos(a) * r;',
    '//     e.y = game.player.y + Math.sin(a) * r;',
    '//   }',
    '// }',
    '',
  ].join('\n');

  DSL.readme = function (spec, project) {
    const t = spec.meta.title || (project && project.name) || 'Untitled game';
    const out = ['# ' + t, ''];
    if (spec.meta.tagline) out.push('_' + spec.meta.tagline + '_', '');
    const types = Object.entries(spec.types || {});
    if (!spec.player && !types.length) {
      out.push('An empty project. Nothing exists yet.', '', 'Describe something to Vibe and it will appear.');
      return out.join('\n') + '\n';
    }
    out.push('## How to play', '');
    DSL.controls(spec).forEach((c) => out.push('- **' + c[0] + '** — ' + c[1]));
    out.push('');
    if (types.length) {
      out.push('## What\'s in the world', '');
      for (const [name, d] of types) out.push('- **' + U.human(name) + '** ' + (d.glyph || '') + ' — ' + DSL.describeEntity(name, d));
      out.push('');
    }
    if ((spec.rules || []).length) {
      out.push('## Rules', '');
      for (const r of spec.rules) out.push('- ' + DSL.describeRule(r));
      out.push('');
    }
    out.push('## Under the hood', '', '- physics: `' + spec.world.physics + '`, level: `' + spec.level.type + '`, palette: `' + (typeof spec.look.palette === 'string' ? spec.look.palette : 'custom') + '`');
    if ((spec.look.effects || []).length) out.push('- effects: ' + spec.look.effects.map((e) => '`' + e + '`').join(', '));
    if (spec.audio.music) out.push('- music: `' + spec.audio.music + '`');
    out.push('', '---', '', 'Built entirely by prompting, in VibeCode.');
    return out.join('\n') + '\n';
  };

  DSL.controls = function (spec) {
    const ph = spec.world.physics;
    const ab = (spec.player && spec.player.abilities) || {};
    const c = [];
    const mv = { topdown: 'move', platformer: 'run', runner: 'you run automatically', ship: 'rotate (A/D) and thrust (W)', tank: 'rotate (A/D), drive (W/S)', snake: 'steer', shmup: 'move', paddle: 'slide left and right' }[ph] || 'move';
    if (spec.player) c.push([ph === 'runner' ? '—' : 'WASD / arrows', mv]);
    if (ab.jump) c.push(['Space', ab.jump.double ? 'jump (double jump in mid-air)' : 'jump']);
    if (ab.flap) c.push(['Space', 'flap']);
    if (ab.fly) c.push(['hold Space', 'fly']);
    if (ab.shoot) c.push([ab.shoot.auto ? 'automatic' : (ab.shoot.aim === 'mouse' ? 'Click / J' : 'J / Click'), 'shoot ' + U.plural(U.human(ab.shoot.projectile || 'bullet'), 2)]);
    if (ab.melee) c.push(['K / right-click', 'swing your ' + U.human(ab.melee.weapon || 'sword')]);
    if (ab.dash) c.push(['Shift', 'dash']);
    if (ab.shield) c.push(['hold F', 'shield']);
    if (ab.bomb) c.push(['Q', 'drop a bomb']);
    if (ab.blink) c.push(['E', 'blink toward the cursor']);
    if (ab.slowtime) c.push(['T', 'bullet time']);
    if (spec.player) c.push(['R', 'restart']);
    return c;
  };

  DSL.packageJson = function (spec, project) {
    const name = U.ident(spec.meta.title || (project && project.name) || 'untitled-game').replace(/_/g, '-');
    return JSON.stringify({ name, version: '0.' + Math.max(1, (project && project.turns) || 0) + '.0', private: true, type: 'module', scripts: { dev: 'vibe dev', build: 'vibe build', test: 'vibe test' }, dependencies: { 'vibe-engine': '^3.2.0' } }, null, 2) + '\n';
  };

  // Generates the full file map for a spec
  DSL.generateFiles = function (spec, project) {
    const f = {};
    f['package.json'] = DSL.packageJson(spec, project);
    f['README.md'] = DSL.readme(spec, project);
    f['game.config.js'] = DSL.configFile(spec);
    f['src/main.js'] = DSL.MAIN_JS;
    if (spec.player) f['src/player.js'] = DSL.playerFile(spec.player);
    for (const [name, def] of Object.entries(spec.types || {})) f['src/entities/' + name + '.js'] = DSL.entityFile(name, def);
    if ((spec.rules || []).length || spec.player) f['src/rules.js'] = DSL.rulesFile(spec.rules || []);
    f['src/mods.js'] = spec.mods && spec.mods.trim() ? spec.mods : DSL.MODS_TEMPLATE;
    return f;
  };

  DSL.fileKind = function (path) {
    if (path === 'game.config.js') return 'config';
    if (path === 'src/player.js') return 'player';
    if (path === 'src/rules.js') return 'rules';
    if (path === 'src/mods.js') return 'mods';
    if (/^src\/entities\/[\w-]+\.js$/.test(path)) return 'entity';
    if (path === 'README.md') return 'readme';
    if (path === 'package.json') return 'json';
    if (path === 'src/main.js') return 'main';
    return 'other';
  };

  // Which file a spec slice lives in (for change detection)
  DSL.sliceFor = function (spec, path) {
    const k = DSL.fileKind(path);
    if (k === 'config') return [spec.meta.title, spec.meta.tagline, spec.world, spec.camera, spec.level, spec.look, spec.audio, spec.hud];
    if (k === 'player') return spec.player;
    if (k === 'rules') return spec.rules;
    if (k === 'mods') return spec.mods;
    if (k === 'entity') return spec.types[path.slice(13, -3)];
    return null;
  };

  // ---------------------------------------------------------------------------
  // files -> spec (evaluation)
  // ---------------------------------------------------------------------------
  function helperFns(reg) {
    const out = {};
    for (const [name, def] of Object.entries(reg)) {
      out[name] = function () {
        const args = Array.prototype.slice.call(arguments);
        const obj = { type: name };
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (isPlain(a) && i === args.length - 1) { Object.assign(obj, a); obj.type = name; break; }
          if (i < def.p.length) obj[def.p[i]] = a;
        }
        return obj;
      };
    }
    return out;
  }

  function preprocess(code) {
    let body = code.replace(/^\s*import\s[\s\S]*?from\s*["'][^"']*["'];?/gm, (m) => m.replace(/[^\n]/g, ' '));
    body = body.replace(/\bexport\s+default\s+/, 'return ');
    return body;
  }

  function suggestName(name, regs) {
    let best = null, bestD = 3;
    for (const reg of regs) for (const k of Object.keys(reg)) {
      const d = U.levenshtein(name.toLowerCase(), k.toLowerCase());
      if (d < bestD) { best = k; bestD = d; }
    }
    return best;
  }

  function locate(err, offset) {
    const m = String(err && err.stack || '').match(/<anonymous>:(\d+):(\d+)/);
    if (m) return { line: Math.max(1, parseInt(m[1], 10) - offset), col: parseInt(m[2], 10) };
    return null;
  }

  // naive bracket/string scanner for syntax error locations
  DSL.findSyntaxIssue = function (code) {
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    let line = 1, col = 0, str = null, strLine = 0;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      col++;
      if (ch === '\n') { if (str && str !== '`') return { line: strLine, msg: 'Unterminated string' }; line++; col = 0; continue; }
      if (str) { if (ch === '\\') { i++; continue; } if (ch === str) str = null; continue; }
      if (ch === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; i--; continue; }
      if (ch === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); if (e < 0) return { line, msg: 'Unterminated comment' }; for (let j = i; j < e; j++) if (code[j] === '\n') line++; i = e + 1; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { str = ch; strLine = line; continue; }
      if ('([{'.includes(ch)) stack.push({ ch, line });
      else if (')]}'.includes(ch)) {
        const top = stack.pop();
        if (!top) return { line, msg: 'Unexpected "' + ch + '"' };
        if (top.ch !== pairs[ch]) return { line, msg: 'Expected closing for "' + top.ch + '" (opened on line ' + top.line + ') but found "' + ch + '"' };
      }
    }
    if (str) return { line: strLine, msg: 'Unterminated string' };
    if (stack.length) { const t = stack[stack.length - 1]; return { line: t.line, msg: 'Unclosed "' + t.ch + '"' }; }
    return null;
  };

  function run(path, code, scope, regsForHint) {
    const body = preprocess(code);
    const names = Object.keys(scope);
    let fn;
    try {
      fn = new Function(...names, '"use strict";\n' + body);
    } catch (e) {
      const issue = DSL.findSyntaxIssue(code);
      const err = new Error((issue ? issue.msg : e.message) + (issue ? '' : ''));
      err.file = path; err.line = issue ? issue.line : null; err.kind = 'SyntaxError'; err.raw = e.message;
      throw err;
    }
    try {
      return fn(...names.map((n) => scope[n]));
    } catch (e) {
      const loc = locate(e, 3);
      let msg = e.message;
      const ref = /^(\w+) is not defined$/.exec(e.message);
      if (ref) {
        const s = suggestName(ref[1], regsForHint || []);
        msg = 'Unknown helper `' + ref[1] + '`' + (s ? ' — did you mean `' + s + '`?' : '');
      }
      const err = new Error(msg);
      err.file = path; err.line = loc ? loc.line : null; err.kind = e.name || 'Error';
      throw err;
    }
  }

  function check(cond, path, msg) { if (!cond) { const e = new Error(msg); e.file = path; e.kind = 'TypeError'; throw e; } }

  function validateList(list, reg, path, what) {
    check(Array.isArray(list), path, what + ' must be an array');
    for (const o of list) check(o && reg[o.type], path, 'Unknown ' + what.replace(/s$/, '') + ' in ' + what + ': ' + JSON.stringify(o && o.type));
  }

  // Evaluates a file and returns a NEW spec with the change applied.
  DSL.evaluate = function (path, code, spec) {
    const kind = DSL.fileKind(path);
    const next = U.clone(spec);
    if (kind === 'config') {
      const cfg = run(path, code, { defineGame: (o) => o }, []);
      check(isPlain(cfg), path, 'defineGame() must receive an object');
      if ('title' in cfg) next.meta.title = String(cfg.title || '');
      else next.meta.title = '';
      next.meta.tagline = cfg.tagline ? String(cfg.tagline) : '';
      for (const k of ['world', 'camera', 'level', 'look', 'audio', 'hud']) if (isPlain(cfg[k])) next[k] = cfg[k];
      check(DSL.PHYSICS.includes(next.world.physics), path, 'world.physics must be one of: ' + DSL.PHYSICS.join(', '));
      check(DSL.LEVELS.includes(next.level.type), path, 'level.type must be one of: ' + DSL.LEVELS.join(', '));
      return next;
    }
    if (kind === 'player') {
      const p = run(path, code, Object.assign({ definePlayer: (o) => o }, helperFns(ABILITIES)), [ABILITIES]);
      check(isPlain(p), path, 'definePlayer() must receive an object');
      const ab = {};
      if (p.abilities) {
        validateList(p.abilities, ABILITIES, path, 'abilities');
        for (const a of p.abilities) { const o = Object.assign({}, a); delete o.type; ab[a.type] = o; }
      }
      p.abilities = ab;
      next.player = p;
      return next;
    }
    if (kind === 'entity') {
      const scope = Object.assign({ defineEntity: (name, o) => Object.assign({ __name: name }, o) }, helperFns(BEHAVIORS), helperFns(ACTIONS));
      const d = run(path, code, scope, [BEHAVIORS, ACTIONS]);
      check(isPlain(d), path, 'defineEntity(name, {...}) must be exported');
      const name = U.ident(d.__name || path.slice(13, -3));
      delete d.__name;
      if (d.behaviors) validateList(d.behaviors, BEHAVIORS, path, 'behaviors');
      if (d.onDeath) validateList(d.onDeath, ACTIONS, path, 'onDeath actions');
      const old = path.slice(13, -3);
      if (old !== name && next.types[old]) {
        delete next.types[old];
        renameRefs(next, old, name);
      }
      next.types[name] = d;
      next.__renamed = old !== name ? { from: old, to: name } : null;
      return next;
    }
    if (kind === 'rules') {
      const notes = [];
      let last = null;
      for (const line of code.split('\n')) {
        const t = line.trim();
        if (t.startsWith('//')) last = t.replace(/^\/\/\s*/, '');
        else if (t.startsWith('rule(')) { notes.push(last); last = null; }
        else if (t) last = null;
      }
      const scope = Object.assign({ defineRules: (a) => a, rule: (when, then, opts) => ({ when, then, opts }) }, helperFns(TRIGGERS), helperFns(ACTIONS));
      const list = run(path, code, scope, [TRIGGERS, ACTIONS]);
      check(Array.isArray(list), path, 'defineRules([...]) must receive an array');
      next.rules = list.map((r, i) => {
        check(r && r.when && TRIGGERS[r.when.type], path, 'Rule #' + (i + 1) + ' needs a trigger like onCollide(...)');
        validateList(r.then || [], ACTIONS, path, 'actions');
        const out = { id: 'r' + (i + 1), when: r.when, then: r.then || [] };
        if (r.opts && r.opts.once) out.once = true;
        if (r.opts && r.opts.if) out.cond = r.opts.if;
        if (notes[i]) out.note = notes[i];
        return out;
      });
      return next;
    }
    if (kind === 'mods') {
      DSL.compileMods(code); // throws on syntax errors
      next.mods = code;
      return next;
    }
    return next; // readme/json/main: not evaluated
  };

  function renameRefs(spec, from, to) {
    const fix = (o) => {
      if (Array.isArray(o)) return o.forEach(fix);
      if (!isPlain(o)) return;
      for (const k of Object.keys(o)) {
        if (o[k] === from && k !== 'type') o[k] = to;
        else if (typeof o[k] === 'object') fix(o[k]);
      }
    };
    fix(spec.rules); fix(spec.types); fix(spec.player);
  }
  DSL.renameRefs = renameRefs;

  DSL.compileMods = function (code) {
    if (!code || !code.trim()) return {};
    let body = code.replace(/^\s*import\s[\s\S]*?from\s*["'][^"']*["'];?/gm, (m) => m.replace(/[^\n]/g, ' '));
    const exported = [];
    body = body.replace(/\bexport\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/g, (m, a, n) => { exported.push(n); return (a || '') + 'function ' + n; });
    body = body.replace(/\bexport\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/g, (m, kw, n) => { exported.push(n); return kw + ' ' + n; });
    body += '\nreturn {' + exported.map((n) => n + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined').join(', ') + '};';
    let fn;
    try { fn = new Function(body); } catch (e) {
      const issue = DSL.findSyntaxIssue(code);
      const err = new Error(issue ? issue.msg : e.message);
      err.file = 'src/mods.js'; err.line = issue ? issue.line : null; err.kind = 'SyntaxError';
      throw err;
    }
    try { return fn() || {}; } catch (e) {
      const loc = locate(e, 2);
      const err = new Error(e.message);
      err.file = 'src/mods.js'; err.line = loc ? loc.line : null; err.kind = e.name;
      throw err;
    }
  };

  // ---------------------------------------------------------------------------
  // English descriptions
  // ---------------------------------------------------------------------------
  const H = (s) => U.human(String(s));
  function sel(s) {
    if (s === 'player') return 'the player';
    if (s === 'enemy') return 'an enemy';
    if (s === 'collectible') return 'a pickup';
    if (s === 'any') return 'anything';
    return 'a ' + H(s);
  }
  function tgt(s) {
    if (!s || s === 'self') return 'it';
    if (s === 'player') return 'the player';
    if (s === 'other') return 'the other thing';
    if (String(s).startsWith('all:')) return 'every ' + H(s.slice(4));
    return 'the ' + H(s);
  }
  DSL.describeTrigger = function (t) {
    switch (t.type) {
      case 'onCollide': return 'When ' + sel(t.a) + ' touches ' + sel(t.b);
      case 'onTimer': return 'Every ' + t.every + 's';
      case 'onAfter': return 'After ' + t.seconds + 's';
      case 'onStart': return 'At the start';
      case 'onDeath': return 'When ' + sel(t.of) + ' dies';
      case 'onHurt': return 'When ' + sel(t.of) + ' gets hurt';
      case 'onScore': return t.every ? 'Every ' + t.atLeast + ' points' : 'When the score reaches ' + t.atLeast;
      case 'onCleared': return 'When every ' + H(t.of) + ' is gone';
      case 'onCollected': return 'After collecting ' + (t.count || 1) + ' ' + U.plural(H(t.of), t.count || 1);
      case 'onKilled': return 'After ' + (t.count || 1) + ' ' + U.plural(H(t.of), t.count || 1) + ' die';
      case 'onKey': return 'When you press ' + String(t.key).toUpperCase();
      case 'onClick': return 'When you click ' + sel(t.of);
      case 'onNear': return 'When ' + sel(t.a) + ' gets near ' + sel(t.b);
      case 'onHealth': return 'When HP drops to ' + t.atMost;
      case 'onTimeUp': return 'When time runs out';
      case 'onFall': return 'When ' + sel(t.of || 'player') + ' falls out of the world';
      case 'onJump': return 'When you jump';
      case 'onLand': return 'When you land';
      case 'onShoot': return 'When you shoot';
      case 'onDash': return 'When you dash';
      case 'onSpawn': return 'When ' + sel(t.of) + ' spawns';
      case 'onHitWall': return 'When ' + sel(t.of) + ' hits a wall';
      case 'onLevel': return 'When level ' + t.level + ' starts';
      case 'onVar': return 'When ' + t.name + ' reaches ' + t.atLeast;
      default: return t.type;
    }
  };
  DSL.describeAction = function (a) {
    switch (a.type) {
      case 'addScore': return (a.amount >= 0 ? '+' : '') + (a.amount == null ? 1 : a.amount) + ' points';
      case 'damage': return tgt(a.target) + ' takes ' + (a.amount || 1) + ' damage';
      case 'heal': return tgt(a.target) + ' heals ' + (a.amount || 1);
      case 'destroy': return tgt(a.target) + ' disappears';
      case 'shake': return 'screen shake';
      case 'flash': return 'flash';
      case 'sound': return 'play "' + a.name + '"';
      case 'burst': return 'particles';
      case 'grow': return tgt(a.target) + ' ' + ((a.factor || 1.2) >= 1 ? 'grows' : 'shrinks');
      case 'speedUp': return tgt(a.target) + ' gets ' + ((a.factor || 1.2) >= 1 ? 'faster' : 'slower');
      case 'say': return tgt(a.target) + ' says "' + a.text + '"';
      case 'banner': return 'show "' + a.text + '"';
      case 'win': return 'you win';
      case 'lose': return 'game over';
      case 'nextLevel': return 'next level';
      case 'restart': return 'restart';
      case 'teleport': return 'teleport ' + tgt(a.target);
      case 'transform': return tgt(a.target) + ' turns into a ' + H(a.into);
      case 'setVar': return a.name + ' = ' + a.value;
      case 'addVar': return a.name + ' += ' + (a.amount || 1);
      case 'setWorld': return a.key + ' → ' + a.value;
      case 'slowmo': return 'slow motion';
      case 'explode': return 'explosion';
      case 'knockback': return 'knock back ' + tgt(a.target);
      case 'launch': return 'launch ' + tgt(a.target);
      case 'paint': return 'paint ' + tgt(a.target);
      case 'growTail': return 'tail grows';
      case 'addTime': return '+' + a.seconds + 's';
      case 'toggleEffect': return 'toggle ' + a.effect;
      case 'confetti': return 'confetti';
      case 'split': return 'splits in ' + (a.count || 2);
      case 'powerup': return a.kind + ' for ' + (a.seconds || 5) + 's';
      case 'flipGravity': return 'gravity flips';
      case 'tint': return 'screen tint';
      case 'music': return 'music: ' + a.mood;
      case 'giveAbility': return 'gain ' + a.ability;
      case 'freeze': return 'freeze ' + tgt(a.target);
      case 'zoom': return 'zoom';
      case 'stealScore': return '-' + (a.amount || 1) + ' points';
      default: return a.type;
    }
  };
  const _da = DSL.describeAction;
  DSL.describeAction = function (a) {
    if (a.type === 'spawn') return 'spawn ' + (a.count || 1) + ' ' + U.plural(H(a.what), a.count || 1) + (a.at && a.at !== 'random' ? ' (' + a.at + ')' : '');
    if (a.type === 'drop') return 'drops a ' + H(a.what) + (a.chance != null && a.chance < 1 ? ' (' + Math.round(a.chance * 100) + '%)' : '');
    return _da(a);
  };
  DSL.describeRule = function (r) {
    return DSL.describeTrigger(r.when) + ' → ' + (r.then || []).map(DSL.describeAction).join(', ') + (r.once ? ' (once)' : '');
  };
  DSL.describeBehavior = function (b) {
    switch (b.type) {
      case 'chase': return 'chases ' + (b.target === 'player' || !b.target ? 'you' : 'the ' + H(b.target)) + (b.sight ? ' when it can see you' : '');
      case 'flee': return 'runs away from ' + (b.from === 'player' || !b.from ? 'you' : 'the ' + H(b.from));
      case 'wander': return 'wanders around';
      case 'patrol': return 'patrols back and forth';
      case 'orbit': return 'circles ' + (b.target === 'player' || !b.target ? 'you' : 'the ' + H(b.target));
      case 'shoot': return 'shoots ' + U.plural(H(b.what || b.projectile || 'bullet'), 2) + (b.at === 'radial' ? ' in every direction' : b.at === 'player' || !b.at ? ' at you' : '');
      case 'hop': return 'hops';
      case 'zigzag': return 'zigzags';
      case 'wave': return 'bobs';
      case 'spin': return 'spins';
      case 'pulse': return 'pulses';
      case 'follow': return 'follows ' + (b.target && b.target !== 'player' ? 'the ' + H(b.target) : 'you');
      case 'guard': return 'fights off enemies';
      case 'warp': return 'teleports around';
      case 'spawner': return 'spawns ' + U.plural(H(b.what || 'thing'), 2);
      case 'swell': return 'grows over time';
      case 'magnet': return 'pulls things in';
      case 'homing': return 'homes in';
      case 'swarm': return 'swarms';
      case 'fall': return 'falls from the sky';
      case 'drift': return 'drifts';
      case 'charge': return 'charges at you';
      case 'kite': return 'keeps its distance';
      case 'bounce': return 'bounces around';
      case 'sleep': return 'sleeps until you get close';
      case 'mimic': return 'copies your moves';
      case 'aura': return 'damages anything nearby';
      case 'eat': return 'eats ' + U.plural(H(b.target || 'collectible'), 2);
      case 'steal': return 'steals your points';
      default: return b.type;
    }
  };
  DSL.describeEntity = function (name, d) {
    const bits = [];
    if (d.projectile) bits.push('projectile, ' + (d.damage || 1) + ' damage');
    else if (d.role === 'collectible') bits.push(d.points ? 'worth ' + d.points + ' point' + (d.points === 1 ? '' : 's') : 'a pickup');
    else if (d.role) bits.push(d.boss ? 'boss' : d.role === 'pet' ? 'companion' : d.role);
    (d.behaviors || []).forEach((b) => bits.push(DSL.describeBehavior(b)));
    if (d.hp && !d.projectile && d.role !== 'collectible' && d.hp < 90) bits.push(d.hp + ' HP');
    if (d.flying) bits.push('flies');
    if (d.ghost) bits.push('passes through walls');
    if (d.spawn && d.spawn.count) bits.push(d.spawn.count + ' at start');
    return bits.join(', ');
  };

  // ---------------------------------------------------------------------------
  // Diff (LCS on lines)
  // ---------------------------------------------------------------------------
  DSL.diff = function (a, b) {
    const A = a ? a.replace(/\n$/, '').split('\n') : [];
    const B = b ? b.replace(/\n$/, '').split('\n') : [];
    const n = A.length, m = B.length;
    if (n * m > 400000) {
      return A.map((s, i) => ({ k: '-', s, o: i + 1 })).concat(B.map((s, i) => ({ k: '+', s, n: i + 1 })));
    }
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ k: ' ', s: A[i], o: i + 1, n: j + 1 }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ k: '-', s: A[i], o: i + 1 }); i++; }
      else { out.push({ k: '+', s: B[j], n: j + 1 }); j++; }
    }
    while (i < n) { out.push({ k: '-', s: A[i], o: i + 1 }); i++; }
    while (j < m) { out.push({ k: '+', s: B[j], n: j + 1 }); j++; }
    return out;
  };
  DSL.diffStats = function (d) {
    let add = 0, del = 0;
    for (const l of d) { if (l.k === '+') add++; else if (l.k === '-') del++; }
    return { add, del };
  };
  // keep only hunks with context
  DSL.hunks = function (d, ctx) {
    ctx = ctx == null ? 2 : ctx;
    const keep = new Array(d.length).fill(false);
    d.forEach((l, i) => { if (l.k !== ' ') for (let j = Math.max(0, i - ctx); j <= Math.min(d.length - 1, i + ctx); j++) keep[j] = true; });
    const out = [];
    let gap = false;
    d.forEach((l, i) => {
      if (keep[i]) { if (gap && out.length) out.push({ k: '…' }); out.push(l); gap = false; } else gap = true;
    });
    return out;
  };

  // ---------------------------------------------------------------------------
  // Syntax highlighting (line-based)
  // ---------------------------------------------------------------------------
  const KW = new Set(['import', 'export', 'default', 'from', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'of', 'in', 'new', 'while', 'async', 'await', 'typeof', 'this', 'break', 'continue', 'class', 'extends', 'try', 'catch', 'throw', 'switch', 'case']);
  const LIT = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
  const esc = U.esc;
  DSL.highlightLine = function (line, lang) {
    if (lang === 'md') {
      if (/^#{1,6}\s/.test(line)) return '<span class="t-h">' + esc(line) + '</span>';
      let s = esc(line);
      s = s.replace(/`([^`]+)`/g, '<span class="t-str">`$1`</span>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<span class="t-b">**$1**</span>');
      s = s.replace(/^(\s*[-*]\s)/, '<span class="t-kw">$1</span>');
      s = s.replace(/^(_.*_)$/, '<span class="t-com">$1</span>');
      return s;
    }
    if (lang === 'sh') return esc(line);
    let out = '';
    let i = 0;
    const n = line.length;
    while (i < n) {
      const ch = line[i];
      if (ch === '/' && line[i + 1] === '/') { out += '<span class="t-com">' + esc(line.slice(i)) + '</span>'; break; }
      if (ch === '"' || ch === "'" || ch === '`') {
        let j = i + 1;
        while (j < n && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
        const s = line.slice(i, j + 1);
        const isKey = lang === 'json' && /^\s*:/.test(line.slice(j + 1));
        out += '<span class="' + (isKey ? 't-prop' : 't-str') + '">' + esc(s) + '</span>';
        i = j + 1; continue;
      }
      if (/[0-9]/.test(ch) && !/[\w$]/.test(line[i - 1] || '')) {
        const m = /^[0-9]*\.?[0-9]+(e[+-]?\d+)?/i.exec(line.slice(i));
        out += '<span class="t-num">' + esc(m[0]) + '</span>'; i += m[0].length; continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        const m = /^[A-Za-z_$][\w$]*/.exec(line.slice(i));
        const w = m[0];
        const after = line.slice(i + w.length);
        let cls = '';
        if (KW.has(w)) cls = 't-kw';
        else if (LIT.has(w)) cls = 't-lit';
        else if (/^\s*\(/.test(after)) cls = 't-fn';
        else if (/^\s*:/.test(after) && !/\?\s*$/.test(line.slice(0, i))) cls = 't-prop';
        out += cls ? '<span class="' + cls + '">' + esc(w) + '</span>' : esc(w);
        i += w.length; continue;
      }
      if ('{}[]()'.includes(ch)) { out += '<span class="t-p">' + esc(ch) + '</span>'; i++; continue; }
      if ('=+-*/<>!&|?:'.includes(ch)) { out += '<span class="t-op">' + esc(ch) + '</span>'; i++; continue; }
      out += esc(ch); i++;
    }
    return out;
  };
  DSL.langOf = (path) => (/\.md$/.test(path) ? 'md' : /\.json$/.test(path) ? 'json' : 'js');

  // ---------------------------------------------------------------------------
  // Reference docs (used by the live model + /docs)
  // ---------------------------------------------------------------------------
  DSL.reference = function () {
    const fmt = (reg) => Object.entries(reg).map(([k, v]) => '  ' + k + '(' + v.p.join(', ') + (v.o ? (v.p.length ? ', ' : '') + '{ ' + v.o + ' }' : '') + ') — ' + v.d).join('\n');
    return [
      'FILES',
      '  game.config.js        export default defineGame({ title, tagline, world, camera, level, look, audio, hud })',
      '  src/player.js         export default definePlayer({ glyph, shape, color, size, speed, hp, lives, effects, abilities: [...] })',
      '  src/entities/<n>.js   export default defineEntity("<n>", { ...fields })  (one file per entity type; <n> is a lowercase identifier)',
      '  src/rules.js          export default defineRules([ rule(trigger, [actions], { once, if: { collected: "<type>", atLeast: n } | { var: "<name>", atLeast: n } | { score: n } }) ])',
      '  src/mods.js           real JavaScript: export function onStart(game) / onUpdate(game, dt) / onEvent(game, name, e) / onDraw(game, ctx)',
      '',
      'CONFIG',
      '  world: { physics: ' + DSL.PHYSICS.map((p) => '"' + p + '"').join(' | ') + ', width, height, gravity, bounds: "walls" | "wrap" | "open", timeScale }',
      '  camera: { follow: bool, zoom, shake }',
      '  level: { type: ' + DSL.LEVELS.map((p) => '"' + p + '"').join(' | ') + ', tile: 40, seed, density: 0..1, hazards: ["lava","spikes","water","ice","bounce"], goal: bool }',
      '  look: { palette: name, background: ' + DSL.BACKGROUNDS.map((p) => '"' + p + '"').join(' | ') + ', effects: [' + DSL.EFFECTS.map((p) => '"' + p + '"').join(', ') + '], juice: 0..3, style: "emoji" | "shapes" }',
      '  palettes: ' + Object.keys(VC.Lex.palettes).join(', '),
      '  audio: { music: null | "chill" | "epic" | "spooky" | "happy" | "dreamy" | "intense" | "retro", tempo, sfx: bool }',
      '  hud: { score: bool, health: bool, timer: seconds (0 = off; countdown), goal: "text" }',
      '',
      'ENTITY FIELDS',
      '  glyph (emoji) | shape (' + DSL.SHAPES.join(', ') + '), color, size (px), label, role (enemy | boss | collectible | hazard | obstacle | npc | pet | structure | critter),',
      '  team ("enemy" hurts the player, "friend" fights for the player, "neutral"), speed, hp, damage (contact damage), points,',
      '  flying, ghost, static, pushable, bouncy (0..1), boss, invulnerable, alpha, effects: ["glow","rainbow","trail","sparkle","flicker","wobble","spin","pulse","dance","music","embers","blink"],',
      '  behaviors: [...], onDeath: [actions], spawn: { count, at: "random" | "edges" | "top" | "ground" | "sky" | "center" | "goal" | "grid" | "near-player", every, max }',
      '  projectiles are entities with projectile: true, speed, damage, lifetime, pierce, explode (radius), homing, boomerang, bouncy',
      '',
      'BEHAVIORS (entity files)', fmt(BEHAVIORS), '',
      'PLAYER ABILITIES (src/player.js)', fmt(ABILITIES), '',
      'TRIGGERS (src/rules.js)', fmt(TRIGGERS), '',
      'ACTIONS (rules + onDeath)', fmt(ACTIONS), '',
      'TARGETS in actions: "player", "self" (first party of the trigger), "other" (second party), a type name (prefers the party that matches, else all of that type), "all:<type>", "enemy", "collectible".',
      'MODS API: game.player, game.entities(sel), game.spawn(type, x, y, overrides), game.destroy(e), game.damage(e, n), game.say(e, text), game.banner(text), game.shake(n), game.sound(name), game.burst(x, y, color, n), game.score, game.addScore(n), game.vars, game.key(k), game.pressed(k), game.mouse {x, y, down}, game.time, game.world {width, height}, game.tileAt(x, y), game.setTile(x, y, kind), game.win(msg), game.lose(msg), game.log(...). Entities expose x, y, vx, vy, r, hp, type, angle, scale, tint.',
    ].join('\n');
  };

  VC.DSL = DSL;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
