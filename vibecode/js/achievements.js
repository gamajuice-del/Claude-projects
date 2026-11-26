/* VibeCode — hidden achievements and optional development challenges. */
(function (VC) {
  'use strict';
  const U = VC.U;
  const A = {};
  const KEY = 'vibecode.ach.v1';

  A.list = [
    { id: 'hello', n: 'Hello, World', d: 'Send your first prompt.' },
    { id: 'first_light', n: 'First Light', d: 'Make something appear in the void.' },
    { id: 'polite', n: 'Please and Thank You', d: 'Be polite to your coding agent.', hidden: true },
    { id: 'undo3', n: 'Ctrl+Z Connoisseur', d: 'Undo three times in one project.', hidden: true },
    { id: 'feature', n: 'It’s Not a Bug', d: 'Keep one of Vibe’s bugs on purpose.', hidden: true },
    { id: 'bugfix', n: 'Rubber Duck Debugging', d: 'Get Vibe to fix its own bug.', hidden: true },
    { id: 'hand_edit', n: 'Real Programmer', d: 'Edit a source file by hand and save it.' },
    { id: 'crash', n: 'Segfault', d: 'Break the game with a bad edit.', hidden: true },
    { id: 'gravity', n: 'Gravity Is a Suggestion', d: 'Reverse gravity.', hidden: true },
    { id: 'perf', n: 'Performance Is a Feature', d: 'Have 500 things alive at once.', hidden: true },
    { id: 'bullets', n: 'Bullet Hell', d: '300 projectiles on screen at once.', hidden: true },
    { id: 'cat', n: 'Cat Person', d: 'Become a cat.', hidden: true },
    { id: 'duck', n: 'Quack', d: 'Adopt a rubber duck.', hidden: true },
    { id: 'godmode', n: 'Cheat Codes', d: 'Make yourself invincible.', hidden: true },
    { id: 'minimalist', n: 'Marie Kondo', d: 'Delete everything.', hidden: true },
    { id: 'genre4', n: 'Genre Fluid', d: 'Try four genres in one project.' },
    { id: 'recursion', n: 'Recursion', d: 'Put VibeCode inside your game.', hidden: true },
    { id: 'die10', n: 'Skill Issue', d: 'Die ten times in your own game.', hidden: true },
    { id: 'win', n: 'Shipped It', d: 'Win a game you built.' },
    { id: 'speedrun', n: 'Any%', d: 'Win within 10 seconds of starting.', hidden: true },
    { id: 'pm', n: 'Product Manager', d: 'Ask for five or more things in one prompt.', hidden: true },
    { id: 'lucky', n: 'Feeling Lucky', d: 'Ask for a surprise three times.', hidden: true },
    { id: 'night_owl', n: 'Night Owl', d: 'Vibe code between midnight and 5am.', hidden: true },
    { id: 'chaos', n: 'Unhinged', d: 'Switch to the chaos model.', hidden: true },
    { id: 'plan', n: 'Measure Twice', d: 'Approve a plan in plan mode.' },
    { id: 'rm_rf', n: 'rm -rf /', d: 'Try it. In the terminal.', hidden: true },
    { id: 'sudo', n: 'Not in the Sudoers File', d: 'Use sudo.', hidden: true },
    { id: 'live', n: 'Big Brain', d: 'Build with the live model.', hidden: true },
    { id: 'rename', n: 'Two Hard Things', d: 'Rename an entity type.', hidden: true },
    { id: 'masochist', n: 'Masochist', d: 'Ask for an impossible game.', hidden: true },
    { id: 'pacifist', n: 'Pacifist', d: 'Score 25 points with no weapon while enemies exist.', hidden: true },
    { id: 'creep', n: 'Feature Creep', d: 'Send 25 prompts in one project.' },
    { id: 'konami', n: '↑↑↓↓←→←→BA', d: 'You know the one.', hidden: true },
    { id: 'chain', n: 'Chain Reaction', d: '15 things die within one second.', hidden: true },
    { id: 'time', n: 'Time Traveler', d: 'Restore an old checkpoint.' },
    { id: 'modder', n: 'Hacker', d: 'Run a working mod from src/mods.js.' },
    { id: 'boss', n: 'Boss Fight', d: 'Defeat a boss.' },
    { id: 'share', n: 'Open Source', d: 'Share or fork a game.', hidden: true },
  ];

  A.challenges = [
    { id: 'c_playable', n: 'Playable', d: 'A player, something to collect, and something dangerous.', check: (s) => s.player && VC.Spec.typesByRole(s, 'collectible').length && VC.Spec.typesByRole(s, 'enemy').length },
    { id: 'c_win', n: 'Winnable', d: 'Give your game a win condition, then win it.', flag: 'won' },
    { id: 'c_plat', n: 'Platformer 101', d: 'Build a platformer and reach the flag.', flag: 'platExit' },
    { id: 'c_boss', n: 'Boss Fight', d: 'Add a boss and defeat it.', flag: 'bossKill' },
    { id: 'c_survive', n: 'Survivor', d: 'Survive 60 seconds with five or more enemies around.', flag: 'survive60' },
    { id: 'c_score', n: 'Score Attack', d: 'Score 100 points in one round.', flag: 'score100' },
    { id: 'c_levels', n: 'World Builder', d: 'Use three different level layouts.', check: (s, p) => (p.memory.levels || []).length >= 3 },
    { id: 'c_mash', n: 'Genre Mashup', d: 'Combine physics from one genre with a twist from another (3+ genres).', check: (s) => (s.meta.genres || []).length >= 3 },
    { id: 'c_rules', n: 'Rulebook', d: 'Write five custom rules.', check: (s) => s.rules.length >= 8 },
    { id: 'c_mod', n: 'Hacker', d: 'Write a mod in src/mods.js that runs without errors.', flag: 'mod' },
    { id: 'c_chain', n: 'Chain Reaction', d: '15 deaths within one second.', flag: 'chain' },
    { id: 'c_ship', n: 'Ship It', d: 'Give your game a title and win it in under a minute.', flag: 'ship' },
  ];

  let state = U.store.get(KEY, null) || { unlocked: {}, counters: {}, chal: {} };
  const save = () => U.store.set(KEY, state);
  A.state = () => state;
  A.has = (id) => !!state.unlocked[id];
  A.ev = U.emitter();

  A.unlock = function (id) {
    if (state.unlocked[id]) return false;
    const def = A.list.find((a) => a.id === id);
    if (!def) return false;
    state.unlocked[id] = Date.now();
    save();
    A.ev.emit('unlock', def);
    return true;
  };
  A.completeChallenge = function (id) {
    if (state.chal[id]) return;
    const def = A.challenges.find((c) => c.id === id);
    if (!def) return;
    state.chal[id] = Date.now();
    save();
    A.ev.emit('challenge', def);
  };
  A.bump = function (k, n) { state.counters[k] = (state.counters[k] || 0) + (n || 1); save(); return state.counters[k]; };

  // called after every prompt
  A.onPrompt = function (text, parsed, project) {
    A.unlock('hello');
    const h = new Date().getHours();
    if (h >= 0 && h < 5) A.unlock('night_owl');
    if (parsed && parsed.polite) A.unlock('polite');
    if (parsed && parsed.intents.length >= 5) A.unlock('pm');
    if (project && project.turns >= 25) A.unlock('creep');
    if (parsed && parsed.intents.some((i) => i.kind === 'surprise')) { if (A.bump('surprise') >= 3) A.unlock('lucky'); }
    if (parsed && parsed.intents.some((i) => i.kind === 'difficulty' && i.extreme && i.dir > 0)) A.unlock('masochist');
  };
  A.onPlan = function (plan, project) {
    const f = plan.flags || {};
    if (f.gravityNeg) A.unlock('gravity');
    if (f.cat) A.unlock('cat');
    if (f.duck) A.unlock('duck');
    if (f.godmode) A.unlock('godmode');
    if (f.recursion) A.unlock('recursion');
    if (f.rename) A.unlock('rename');
    if (f.impossible) A.unlock('masochist');
    const s = plan.spec;
    if ((s.meta.genres || []).length >= 4) A.unlock('genre4');
    if (VC.Spec.isEmpty(plan.before) && !VC.Spec.isEmpty(s)) A.unlock('first_light');
    if (s.level && project) { project.memory.levels = [...new Set((project.memory.levels || []).concat(s.level.type))].filter((x) => x !== 'empty'); }
    A.checkChallenges(s, project);
  };
  A.checkChallenges = function (spec, project) {
    for (const c of A.challenges) if (c.check && !state.chal[c.id]) { try { if (c.check(spec, project)) A.completeChallenge(c.id); } catch (e) { /* ignore */ } }
  };
  A.flag = function (flag) { for (const c of A.challenges) if (c.flag === flag) A.completeChallenge(c.id); };

  // hook a live game
  A.watch = function (game, getProject) {
    game.on('win', (d) => {
      if (game.mode !== 'play') return;
      A.unlock('win'); A.flag('won');
      if (d.time < 10) A.unlock('speedrun');
      const p = getProject();
      if (p && p.spec.meta.title && d.time < 60) A.flag('ship');
    });
    game.on('lose', () => { if (game.mode !== 'play') return; const p = getProject(); if (p) { p.stats.deaths = (p.stats.deaths || 0) + 1; if (p.stats.deaths >= 10) A.unlock('die10'); } });
    game.on('boss', () => { if (game.mode === 'play') { A.unlock('boss'); A.flag('bossKill'); } });
    game.on('chain', (n) => { if (n >= 15 && game.mode === 'play') { A.unlock('chain'); A.flag('chain'); } });
    game.on('level', () => { if (game.mode === 'play' && (game.spec.world.physics === 'platformer' || game.spec.world.physics === 'runner')) A.flag('platExit'); });
    game.on('konami', () => { A.unlock('konami'); game.rt.effects.add('psychedelic'); game.banner('RAINBOW MODE', 2); if (game.onEffects) game.onEffects(game.rt.effects, game.spec); });
    game.on('tick', (t) => {
      if (t.ents >= 500) A.unlock('perf');
      if (t.proj >= 300) A.unlock('bullets');
      if (game.mode !== 'play') return;
      if (t.score >= 100) A.flag('score100');
      const enemies = game.entities.filter((e) => e.team === 'enemy' && !e.def.projectile).length;
      if (t.time >= 60 && enemies >= 5 && game.state === 'running') A.flag('survive60');
      const ab = game.abilities || {};
      if (t.score >= 25 && !ab.shoot && !ab.melee && !ab.bomb && enemies > 0) A.unlock('pacifist');
      if (game.modsFns && game.modsFns.onUpdate && t.time > 3 && !game.err) { A.unlock('modder'); A.flag('mod'); }
    });
  };

  A.counts = () => ({ ach: Object.keys(state.unlocked).length, achTotal: A.list.length, chal: Object.keys(state.chal).length, chalTotal: A.challenges.length });

  VC.Ach = A;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
