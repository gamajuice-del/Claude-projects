/* VibeCode — narrator: turns plans into the agent's voice (reasoning, summaries, answers). */
(function (VC) {
  'use strict';
  const U = VC.U, L = VC.Lex, DSL = VC.DSL, Spec = VC.Spec;
  const N = {};
  const H = (s) => U.human(String(s));
  const PL = (s, n) => U.plural(H(s), n == null ? 2 : n);
  const code = (s) => '`' + s + '`';
  const AN = (w) => (/^[aeiou]/i.test(String(w)) ? 'an ' : 'a ') + w;

  N.SPINNER = ['Vibing', 'Conjuring', 'Noodling', 'Tinkering', 'Brewing', 'Pixel-pushing', 'Reticulating', 'Wrangling', 'Summoning', 'Bending physics', 'Herding sprites', 'Simmering', 'Dreaming', 'Composing', 'Scheming', 'Sculpting', 'Untangling', 'Calibrating', 'Hatching', 'Riffing', 'Percolating', 'Spelunking', 'Puzzling', 'Imagining', 'Juggling', 'Cooking', 'Fermenting', 'Polishing', 'Wiring', 'Forging'];
  N.verb = (r) => U.pick(N.SPINNER, r || U.random) + '…';

  const PHYS = { topdown: 'top-down', platformer: 'platformer', runner: 'endless-runner', ship: 'zero-g ship', tank: 'tank-style', snake: 'snake', shmup: 'vertical shooter', paddle: 'paddle' };
  const GENRE = { platformer: 'a platformer', shooter: 'a top-down shooter', shmup: 'a space shooter', bullethell: 'a bullet hell', asteroids: 'an asteroids-style game', snake: 'a snake game', runner: 'an endless runner', flappy: 'a flappy-style game', maze: 'a maze game', dungeon: 'a dungeon crawler', survival: 'a survival game', breakout: 'a brick breaker', racing: 'a racing game', stealth: 'a stealth game', defense: 'a defense game', rpg: 'a little RPG', soccer: 'a soccer game', topdown: 'a top-down game', pong: 'a paddle game' };

  N.abilityPhrase = function (name, p, spec) {
    p = p || {};
    switch (name) {
      case 'jump': return p.wall ? 'a wall jump' : p.extra ? 'a triple jump' : p.double ? 'a double jump (Space again in mid-air)' : 'jumping (Space)';
      case 'shoot': return 'shooting ' + PL(p.projectile || 'bullet') + (p.auto ? ' (automatic)' : p.aim === 'mouse' ? ' (click to fire at the cursor)' : ' (J or click)') + (p.count > 1 ? ', ' + p.count + ' at a time' : '') + (p.rate >= 10 ? ', rapid fire' : '');
      case 'melee': return 'a ' + H(p.weapon || 'sword') + ' swing (K or right-click)';
      case 'dash': return 'a dash (Shift)';
      case 'fly': return spec && (spec.world.physics === 'platformer' || spec.world.physics === 'runner') ? 'a jetpack (hold Space)' : 'flight over hazards';
      case 'shield': return 'a shield (hold F)';
      case 'bomb': return 'bombs (Q)';
      case 'blink': return 'a blink teleport toward the cursor (E)';
      case 'slowtime': return 'bullet time (T)';
      case 'regen': return 'slow health regeneration';
      case 'magnet': return 'an item magnet';
      case 'tail': return 'a tail';
      case 'flap': return 'flapping (Space)';
      default: return name;
    }
  };

  N.entityLine = function (name, d, spec) {
    const bits = [];
    const beh = (d.behaviors || []).map((b) => DSL.describeBehavior(b));
    if (d.projectile) return code(name) + (d.glyph ? ' (' + d.glyph + ')' : '') + ' — a projectile, speed ' + (d.speed || 560) + ', ' + (d.damage || 1) + ' damage' + (d.explode ? ', explodes on impact' : '');
    if (beh.length) bits.push(beh.join(', '));
    if (d.speed && (d.behaviors || []).length) bits.push('speed ' + d.speed);
    if (d.hp && d.role !== 'collectible' && d.hp < 99) bits.push(d.hp + ' HP');
    if (d.damage) bits.push(d.damage + ' contact damage');
    if (d.points) bits.push('worth ' + d.points);
    if (d.flying) bits.push('flies');
    if (d.ghost) bits.push('ghosts through walls');
    if (d.explosive) bits.push('explodes on death');
    if (d.invulnerable) bits.push('invulnerable');
    const sp = d.spawn || {};
    const where = { edges: 'at the edges', ground: 'on the ground', sky: 'in the sky', top: 'from the top', random: 'around the level', 'near-player': 'next to you', goal: 'at the goal', center: 'in the middle', grid: 'in a grid', checkpoints: 'along the track' }[sp.at] || '';
    if (sp.count) bits.push(sp.count + ' ' + where);
    else if (sp.count === 0) bits.push('only appears when spawned');
    if (sp.every) bits.push('more every ' + sp.every + 's');
    void spec;
    return code(name) + (d.glyph ? ' (' + d.glyph + ')' : d.label ? ' (a ' + (d.shape || 'blob') + ')' : '') + ' — ' + bits.join(', ');
  };

  function pv(phrase) {
    // "chases you" -> "chase you" (for plural subjects)
    return String(phrase).replace(/^(\w+)/, (w) => {
      const irr = { is: 'are', has: 'have', does: 'do', goes: 'go' };
      if (irr[w]) return irr[w];
      if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
      if (/(?:sh|ch|ss|x|z)es$/.test(w)) return w.slice(0, -2);
      if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
      return w;
    }).replace(/ and (\w+)/g, (m, w) => ' and ' + pv(w));
  }
  N.pv = pv;

  // ------------------------------------------------------------------ headline / parts
  N.parts = function (plan) {
    const parts = [];
    const notes = plan.notes.filter((n) => !n.implicit);
    const all = plan.notes;
    const take = (k) => notes.filter((n) => n.k === k);
    const add = (fut, past) => parts.push({ fut, past });
    const cpt = all.find((n) => n.k === 'concept');
    if (cpt) { const d = AN(H(cpt.theme) + ' ' + (GENRE[cpt.genre] || cpt.genre).replace(/^an? /, '')) + (['breakout', 'snake', 'asteroids', 'shmup'].includes(cpt.genre) ? '' : ' where you play ' + AN(H(cpt.hero))); add('invent a whole game: ' + d, 'invented a whole game: ' + d + (cpt.title ? ', called “' + cpt.title + '”' : '')); }
    const g = cpt ? null : all.find((n) => n.k === 'genre');
    if (g) add('turn this into ' + (GENRE[g.genre] || 'a new genre'), 'turned this into ' + (GENRE[g.genre] || 'a new genre'));
    const sk = take('player-skin')[0];
    if (sk) add('make you ' + AN(H(sk.word || sk.key)), 'made you ' + AN(H(sk.word || sk.key)) + (sk.glyph ? ' ' + sk.glyph : ''));
    const tn = take('type-new');
    if (tn.length) {
      const t = tn[0];
      const cnt = t.def.spawn && t.def.spawn.count;
      const beh = (t.def.behaviors || []).filter((b) => b.type !== 'guard').map((b) => DSL.describeBehavior(b)).slice(0, 2);
      const plural = cnt !== 1;
      const what = (cnt > 1 ? cnt + ' ' + PL(t.name, cnt) : cnt === 1 || cnt === 0 ? 'a ' + H(t.name) : PL(t.name));
      const that = beh.length ? ' that ' + (plural && cnt !== 0 ? pv(beh.join(' and ')) : beh.join(' and ')) : '';
      const more = tn.length > 1 ? ' (plus ' + U.count(tn.length - 1, 'other new thing') + ')' : '';
      add('add ' + what + that + more, 'added ' + what + that + more);
    }
    const tm = take('type-more')[0];
    if (tm) add('bring in more ' + PL(tm.name) + ' (' + tm.from + ' → ' + tm.to + ')', 'brought in more ' + PL(tm.name) + ' (' + tm.from + ' → ' + tm.to + ')');
    const ab = take('ability');
    if (ab.length) { const l = U.listJoin(ab.map((a) => N.abilityPhrase(a.name, a.params).replace(/ \(.*\)$/, ''))); add('give you ' + l, 'gave you ' + l); }
    const ru = notes.filter((n) => (n.k === 'rule-new' || n.k === 'rule-merge') && n.why === 'user');
    if (ru.length) add('wire up ' + (ru.length > 1 ? U.count(ru.length, 'new rule') : 'that rule'), 'wired it up: ' + ru.map((x) => DSL.describeRule(x.rule).replace(/^When/, 'when')).join('; '));
    const th = take('theme')[0];
    if (th) add('move everything to a ' + H(th.to) + ' setting', 'moved everything to a ' + H(th.to) + ' setting');
    const env = take('env')[0];
    if (env && env.add.length) { const l = U.listJoin(env.add.filter((e) => e !== 'stars').map(fxName)); add('add ' + l, 'added ' + l); }
    if (env && env.remove.length && !env.add.length) { const l = U.listJoin(env.remove.map(fxName)); add('remove the ' + l, 'removed the ' + l); }
    const tmod = take('type-mod')[0];
    if (tmod && tmod.changes && tmod.changes.length) { const names = [...new Set(tmod.changes.map((c) => c.name))]; const l = tmod.global ? 'everything' : U.listJoin(names.slice(0, 3).map((n) => 'the ' + PL(n))); add('tweak ' + l, 'tweaked ' + l + ' (' + U.listJoin([...new Set(tmod.changes.map((c) => c.prop))].slice(0, 3)) + ')'); }
    const pm = take('player-mod')[0];
    if (pm && pm.changes.length) { const l = U.listJoin([...new Set(pm.changes.map((c) => c.prop))]); add('adjust your ' + l, 'adjusted your ' + l); }
    const rn = take('rename')[0];
    if (rn) add('turn every ' + H(rn.from) + ' into a ' + H(rn.to), 'turned every ' + H(rn.from) + ' into a ' + H(rn.to) + (rn.glyph ? ' ' + rn.glyph : ''));
    if (take('twist')[0]) add('add a twist', 'added a twist');
    const mu = take('music')[0];
    if (mu) add(mu.off ? 'cut the music' : 'add some ' + mu.to + ' music', mu.off ? 'cut the music' : 'added ' + mu.to + ' music');
    const ti = take('title')[0];
    if (ti) add('title it “' + ti.to + '”', 'titled it “' + ti.to + '”');
    const gr = take('gravity')[0];
    if (gr) add(gr.flip ? 'flip gravity' : gr.to === 0 ? 'switch gravity off' : 'set gravity to ' + gr.to, gr.flip ? 'flipped gravity' : gr.to === 0 ? 'switched gravity off' : 'set gravity to ' + gr.to);
    const lv = take('level')[0];
    if (lv && !g) add('rebuild the level as ' + levelName(lv.to), 'rebuilt the level as ' + levelName(lv.to));
    const hz = take('hazard')[0];
    if (hz) add((hz.remove ? 'remove the ' : 'add ') + hz.name, (hz.remove ? 'removed the ' : 'added ') + hz.name);
    const df = take('difficulty')[0];
    if (df) add(df.dir > 0 ? 'turn up the difficulty' : 'make it more forgiving', df.dir > 0 ? 'turned up the difficulty' : 'made it more forgiving');
    if (take('juice')[0]) add('add juice', 'added juice');
    if (take('polish')[0]) add('do a visual polish pass', 'did a visual polish pass');
    if (take('palette')[0]) add('recolor the world', 'recolored the world');
    if (take('background')[0]) add('change the background', 'changed the background');
    const tr = take('type-remove')[0];
    if (tr) { const l = U.listJoin(tr.names.filter((n) => !plan.before.types[n] || !plan.before.types[n].projectile).map((n) => 'the ' + PL(n))); add('remove ' + l, 'removed ' + l); }
    if (take('goal')[0]) add('add a win condition', 'added a win condition');
    const kb = take('keybind')[0];
    if (kb) add('bind that to the ' + kb.key.toUpperCase() + ' key', 'bound that to the ' + kb.key.toUpperCase() + ' key');
    const hud = take('hud')[0];
    if (hud && hud.timer) add('add a ' + hud.timer + 's countdown', 'added a ' + hud.timer + 's countdown');
    if (take('world')[0]) { const w = take('world')[0]; add('change the ' + w.prop, 'changed the ' + w.prop + ' (' + w.from + ' → ' + w.to + ')'); }
    if (take('style')[0]) add('change the art style', 'changed the art style');
    if (take('physics')[0] && !g) { const p = take('physics')[0]; add('switch physics to ' + p.to, 'switched physics to ' + p.to); }
    if (!parts.length) add('make that change', 'made that change');
    return parts;
  };

  N.headline = function (plan, r) {
    const parts = N.parts(plan).slice(0, 3).map((p) => p.fut);
    const lead = U.pick(["I'll ", 'Okay — I\'ll ', 'On it. I\'ll ', 'Got it: I\'ll ', "Sure. I'll "], r);
    return (lead + U.listJoin(parts) + '.').replace(/\s+/g, ' ');
  };

  N.headlineOld = function (plan, r) {
    const parts = [];
    const notes = plan.notes;
    const take = (k) => notes.filter((n) => n.k === k);
    const g = take('genre')[0];
    if (g) parts.push('turn this into ' + (GENRE[g.genre] || 'a new genre'));
    const sk = take('player-skin')[0];
    if (sk) parts.push('make you a ' + H(sk.word || sk.key));
    const tn = take('type-new').filter((n) => !g || n.np.count != null || plan.parsed && plan.parsed.intents.some((i) => i.kind === 'add'));
    if (tn.length && !g) {
      const t = tn[0];
      const beh = (t.def.behaviors || []).filter((b) => b.type !== 'guard').map((b) => DSL.describeBehavior(b)).slice(0, 2);
      const cnt = t.def.spawn && t.def.spawn.count;
      parts.push('add ' + (cnt > 1 ? cnt + ' ' + PL(t.name, cnt) : cnt === 1 ? 'a ' + H(t.name) : PL(t.name)) + (beh.length ? ' that ' + beh.join(' and ').replace(/\byou\b/g, 'you') : '') + (tn.length > 1 ? ' (plus ' + U.count(tn.length - 1, 'other thing') + ')' : ''));
    }
    const ab = take('ability');
    if (ab.length) parts.push('give you ' + U.listJoin(ab.map((a) => N.abilityPhrase(a.name, a.params).replace(/ \(.*\)$/, ''))));
    const ru = notes.filter((n) => (n.k === 'rule-new' || n.k === 'rule-merge') && n.why === 'user');
    if (ru.length) parts.push('wire up ' + (ru.length > 1 ? U.count(ru.length, 'new rule') : 'that rule'));
    const th = take('theme')[0];
    if (th) parts.push('move everything to a ' + H(th.to) + ' setting');
    const env = take('env')[0];
    if (env && env.add.length) parts.push('add ' + U.listJoin(env.add.filter((e) => e !== 'stars').map(fxName)));
    if (env && env.remove.length && !env.add.length) parts.push('remove the ' + U.listJoin(env.remove.map(fxName)));
    const tm = take('type-mod')[0];
    if (tm && tm.changes && tm.changes.length) { const names = U.uniqBy ? [] : [...new Set(tm.changes.map((c) => c.name))]; parts.push('tweak the ' + U.listJoin(names.map((n) => PL(n)))); }
    const pm = take('player-mod')[0];
    if (pm && pm.changes.length) parts.push('adjust your ' + U.listJoin([...new Set(pm.changes.map((c) => c.prop))]));
    if (take('rename')[0]) { const rn = take('rename')[0]; parts.push('turn every ' + H(rn.from) + ' into a ' + H(rn.to)); }
    if (take('twist')[0]) parts.push('add a twist');
    if (take('music')[0]) { const m = take('music')[0]; parts.push(m.off ? 'cut the music' : 'add some ' + m.to + ' music'); }
    if (take('title')[0]) parts.push('title it “' + take('title')[0].to + '”');
    if (take('gravity')[0]) { const gr = take('gravity')[0]; parts.push(gr.flip ? 'flip gravity' : gr.to === 0 ? 'switch gravity off' : 'change gravity to ' + gr.to); }
    if (take('level')[0] && !g) parts.push('rebuild the level as ' + levelName(take('level')[0].to));
    if (take('hazard')[0]) parts.push((take('hazard')[0].remove ? 'remove the ' : 'add ') + take('hazard')[0].name);
    if (take('difficulty')[0]) parts.push(take('difficulty')[0].dir > 0 ? 'turn up the difficulty' : 'make it more forgiving');
    if (take('juice')[0]) parts.push('add juice');
    if (take('polish')[0]) parts.push('do a visual polish pass');
    if (take('palette')[0]) parts.push('recolor the world');
    if (take('type-remove')[0]) parts.push('remove the ' + U.listJoin(take('type-remove')[0].names.filter((n) => !plan.before.types[n] || !plan.before.types[n].projectile).map((n) => PL(n))));
    if (take('goal')[0]) parts.push('add a win condition');
    if (take('keybind')[0]) parts.push('bind that to the ' + take('keybind')[0].key.toUpperCase() + ' key');
    if (!parts.length) {
      if (plan.notes.some((n) => n.k === 'world')) parts.push('adjust the world settings');
      else parts.push('make that change');
    }
    const lead = U.pick(["I'll ", "Let's ", 'Okay — I\'ll ', 'On it. I\'ll ', 'Nice. I\'ll ', 'Got it: I\'ll '], r);
    let s = lead + U.listJoin(parts.slice(0, 3)) + '.';
    if (lead.startsWith("Let's")) s = "Let's " + U.listJoin(parts.slice(0, 3)) + '.';
    return s.replace(/\s+/g, ' ');
  };
  function fxName(e) { return ({ darkness: 'darkness with a light around you', night: 'night', rain: 'rain', storm: 'a thunderstorm', snow: 'snow', fog: 'fog', embers: 'drifting embers', leaves: 'falling leaves', dust: 'a dust storm', bubbles: 'bubbles', fireflies: 'fireflies', sparkles: 'sparkles', crt: 'a CRT filter', scanlines: 'scanlines', pixelate: 'chunky pixels', grayscale: 'black & white', invert: 'inverted colors', sepia: 'sepia', psychedelic: 'psychedelic color cycling', wobble: 'a woozy wobble', flip: 'an upside-down screen', mirror: 'a mirrored screen', blur: 'blur', chroma: 'chromatic aberration', glow: 'bloom', vignette: 'a vignette', trails: 'motion trails', daynight: 'a day/night cycle', stars: 'stars' })[e] || e; }
  function levelName(t) { return ({ empty: 'open space', arena: 'a walled arena', obstacles: 'a cluttered arena', maze: 'a maze', caves: 'caves', dungeon: 'a dungeon', platforms: 'platforms', tower: 'a tower climb', islands: 'islands', runner: 'a long runner course', pipes: 'a corridor of pipes', track: 'a race track', city: 'city blocks', forest: 'a forest', bricks: 'a brick wall' })[t] || t; }
  N.levelName = levelName; N.fxName = fxName;

  // ------------------------------------------------------------------ thinking
  N.thinking = function (plan, before, ctx, r) {
    const out = [];
    const S = plan.spec;
    const sumB = Spec.summary(before);
    const ask = (plan.parsed && plan.parsed.raw) || '';
    // 1. what they want
    const want = describeRequest(plan);
    out.push(U.pick(['The user wants ', 'Request: ', 'They\'re asking for ', 'Goal: '], r) + want + '.');
    // 2. context
    if (Spec.isEmpty(before)) out.push('The project is empty — no player, no level, nothing. Whatever I write now becomes the foundation.');
    else {
      const bits = [];
      bits.push('a ' + PHYS[before.world.physics] + ' game');
      if (before.player) bits.push('a ' + (before.player.glyph || before.player.label || 'blob') + ' player');
      const ty = Object.keys(before.types).filter((n) => !before.types[n].projectile);
      if (ty.length) bits.push(U.listJoin(ty.slice(0, 4).map((n) => PL(n))) + (ty.length > 4 ? ' and ' + (ty.length - 4) + ' more types' : ''));
      bits.push(U.count(before.rules.length, 'rule'));
      out.push('Current state: ' + U.listJoin(bits) + '.');
    }
    // 3. reasoning per note
    const lines = [];
    for (const n of plan.notes) {
      const s = noteReason(n, plan, before, S, r);
      if (s) lines.push(s);
    }
    if (lines.length) out.push(lines.join('\n'));
    // 4. considerations
    const cons = [];
    const sum = Spec.summary(S);
    if (sum.enemies.length && !sum.weapon && !sumB.enemies.length && S.world.physics !== 'platformer' && S.world.physics !== 'snake') cons.push('There\'s no way to fight back yet. I\'ll leave that to the user and suggest it instead of adding it unasked.');
    if (S.world.physics === 'platformer' && sum.enemies.length && !sum.weapon && !sumB.enemies.length) cons.push('No weapon, but in a platformer you can stomp enemies by landing on them, so this is still playable.');
    if (!sum.hasWin && plan.notes.some((n) => n.k === 'type-new') && Object.keys(S.types).length >= 3 && U.random() < 0.6) cons.push('Still no win condition. Worth mentioning.');
    for (const w of plan.warnings || []) if (w.k === 'cap') cons.push(w.asked + ' ' + PL(w.name) + ' is a lot. I\'ll cap it at 300 per type so the browser survives (they can still multiply later).');
    if (plan.flags && plan.flags.godmode) cons.push('Invincibility makes the game trivially easy, but it\'s their game.');
    if (/\bplease\b|\bthanks?\b/.test(ask)) cons.push('(They said please. Noted.)');
    if (cons.length) out.push(cons.join(' '));
    out.push(U.pick(['Then I\'ll run the tests to make sure nothing spawns inside a wall.', 'After the edits I\'ll run the test suite: boot, spawn safety, a 4-second soak.', 'I\'ll finish by running the tests.', 'Then build and test.'], r));
    return out.join('\n\n');
  };

  function describeRequest(plan) {
    const its = plan.intents || [];
    const bits = [];
    for (const it of its) {
      switch (it.kind) {
        case 'genre': bits.push(GENRE[it.genre] || 'a new genre'); break;
        case 'player': bits.push('to play as a ' + H(it.np.word || it.np.key)); break;
        case 'add': {
          const phr = it.nps.map((np) => {
            const mods = (np.mods || []).filter((m) => !/^(word|noun):/.test(m)).join(' ');
            const beh = np.vp && np.vp.b && np.vp.b.length ? ' that ' + (np.count === 1 ? np.vp.b.map((b) => DSL.describeBehavior(b)).join(' and ') : pv(np.vp.b.map((b) => DSL.describeBehavior(b)).join(' and '))) : '';
            return ((np.count ? np.count + ' ' : '') + mods + ' ' + PL(np.word || np.key || 'thing', np.count || 2) + beh).trim().replace(/\s+/g, ' ');
          });
          bits.push(U.listJoin(phr));
          break;
        }
        case 'ability': bits.push(U.listJoin((it.list || []).map((a) => N.abilityPhrase(a.name, a.params).replace(/ \(.*\)$/, '')))); break;
        case 'rule': bits.push('a rule: ' + DSL.describeTrigger(it.trigger).toLowerCase() + ', ' + it.actions.map((a) => DSL.describeAction(Object.assign({}, a, { what: a.what || (a.__np && (a.__np.key || a.__np.word)) }))).join(', ')); break;
        case 'modify': bits.push('changes to ' + (it.target.kind === 'player' ? 'the player' : it.target.names ? U.listJoin(it.target.names.map((n) => 'the ' + PL(n))) : 'the game')); break;
        case 'theme': bits.push('a ' + H(it.theme) + ' setting'); break;
        case 'env': bits.push(it.add.length ? U.listJoin(it.add.filter((e) => e !== 'stars').map(fxName)) : 'less ' + U.listJoin(it.remove.map(fxName))); break;
        case 'music': bits.push(it.off ? 'no music' : (it.mood || 'some') + ' music'); break;
        case 'world': bits.push(it.prop === 'gravity' ? 'different gravity' : 'a ' + it.prop + ' change'); break;
        case 'level': bits.push(it.type ? 'a ' + levelName(it.type) + ' level' : it.hazards ? H(it.hazards.join(' and ')) : 'a new layout'); break;
        case 'title': bits.push('a title'); break;
        case 'surprise': bits.push('a surprise'); break;
        case 'improve': bits.push('the game to be better (open-ended)'); break;
        case 'difficulty': bits.push(it.dir > 0 ? 'more difficulty' : 'less difficulty'); break;
        case 'juice': bits.push('more game feel'); break;
        case 'polish': bits.push('better visuals'); break;
        case 'rename': bits.push('the ' + U.listJoin(it.names.map((n) => PL(n))) + ' turned into ' + PL(it.np.word || it.np.key)); break;
        case 'remove': bits.push('to remove ' + U.listJoin((it.target.names || []).map((n) => 'the ' + PL(n)))); break;
        case 'learn': bits.push('to define what a ' + H(it.np.word) + ' is'); break;
        case 'say': bits.push('dialogue'); break;
        case 'goal': bits.push('a way to win'); break;
        case 'keybind': bits.push('a new action on a key'); break;
        case 'hud': bits.push(it.timer ? 'a ' + it.timer + '-second timer' : 'HUD changes'); break;
        default: bits.push(it.kind);
      }
    }
    return U.listJoin(bits.filter(Boolean).slice(0, 5)) || 'a change';
  }
  N.describeRequest = describeRequest;

  function noteReason(n, plan, before, S, r) {
    const ps = (S.player && S.player.speed) || 230;
    switch (n.k) {
      case 'genre': return '• ' + U.cap(GENRE[n.genre] || n.genre) + ' needs a few pieces: physics, a level that suits it, and something to do. I\'ll lay those down but keep anything they specified.';
      case 'physics': return '• Physics: ' + code(n.from) + ' → ' + code(n.to) + '.' + (n.to === 'platformer' ? ' Gravity is on, so existing walkers will snap to the ground and patrol instead of wandering.' : n.to === 'shmup' ? ' Fixed camera, enemies pour in from the top.' : n.to === 'ship' ? ' Rotate and thrust, with inertia.' : n.to === 'snake' ? ' Grid movement, and the tail is lethal.' : n.to === 'paddle' ? ' You become a paddle at the bottom of the screen.' : '');
      case 'level': return n.auto ? '• An empty level looks unfinished, so I\'ll give it ' + levelName(n.to) + '.' : '• Level: ' + levelName(n.from) + ' → ' + levelName(n.to) + '. The generator places the start and goal so the player never spawns inside a wall.';
      case 'player-new': return '• There\'s no player yet' + (n.why && n.why !== 'genre' && n.why !== 'skin' && n.why !== 'ability' && n.why !== 'modify' ? ', and ' + PL(n.why) + ' need someone to interact with' : '') + '. Adding one: ' + (n.glyph || 'a round blob with eyes') + ', ' + (n.physics === 'platformer' ? 'run and jump' : 'WASD to move') + ', 5 HP.';
      case 'player-skin': return '• Player look: ' + (n.from || 'blob') + ' → ' + (n.glyph || n.to) + '.' + (n.proj && !n.hasShoot ? ' A ' + H(n.key) + ' would throw ' + PL(n.proj) + ' — I\'ll suggest that rather than add combat unasked.' : n.proj && n.hasShoot ? ' Swapping their projectile to ' + PL(n.proj) + ' to match.' : '') + (n.vehicle && S.world.physics === 'topdown' ? ' A vehicle would feel better with ship or tank physics — I\'ll mention it.' : '');
      case 'type-new': {
        const d = n.def;
        let s = '• New type ' + N.entityLine(n.name, d, S) + '.';
        if (n.unknown) s += ' I don\'t know what a ' + H(n.name) + ' is, so I\'m improvising a look and making it harmless until told otherwise.';
        if (d.role === 'collectible') s += ' Plus a pickup rule in rules.js so touching one actually does something.';
        if ((d.role === 'enemy' || d.role === 'boss') && d.behaviors && d.behaviors.some((b) => b.type === 'chase')) s += ' Speed ' + d.speed + ' vs the player\'s ' + ps + (d.speed < ps * 0.8 ? ': escapable, but relentless.' : ': fast. They asked for it.');
        if (d.boss) s += ' Bosses get a health bar and a big death.';
        return s;
      }
      case 'type-hidden': return '• Helper type ' + code(n.name) + ' — only appears when something spawns or drops it.';
      case 'type-more': return '• ' + U.cap(PL(n.name)) + ' already exist, so instead of a duplicate type I\'ll raise the spawn count ' + n.from + ' → ' + n.to + '.';
      case 'proj-new': return '• Projectile type ' + code(n.name) + (n.custom ? ' — not one I know, so I\'ll make up a sensible one (speed 480, 1 damage).' : ' (' + (n.def.glyph || n.def.shape) + ', speed ' + n.def.speed + ', ' + n.def.damage + ' damage' + (n.def.explode ? ', explodes' : '') + (n.def.homing ? ', homing' : '') + ').');
      case 'rule-new': return n.why === 'user' ? '• Rule: ' + DSL.describeRule(n.rule) + '.' : n.why === 'collect' || n.why === 'score' || n.why === 'exit' || n.why === 'talk' ? null : '• Rule: ' + DSL.describeRule(n.rule) + '.';
      case 'rule-merge': return '• There\'s already a rule for ' + DSL.describeTrigger(n.rule.when).toLowerCase() + '. Merging instead of adding a second one that would double-fire.';
      case 'rule-fail': return '• I couldn\'t parse what should happen in "' + n.raw + '". I\'ll say so.';
      case 'ability': return '• ' + U.cap(N.abilityPhrase(n.name, n.params, S)) + '.' + (n.name === 'shoot' ? ' ' + (n.params.rate || 4) + ' shots/sec feels right; any faster and it trivializes the enemies.' : '') + (n.name === 'jump' && n.params.double ? ' Second jump at ~92% power so it feels like a boost, not a reset.' : '');
      case 'ability-remove': return '• Removing ' + n.name + ' from the player\'s abilities.';
      case 'theme': return '• Setting: ' + H(n.to) + '. Palette ' + code(n.palette) + ', ' + code(n.bg) + ' background' + (n.fx.length ? ', ' + U.listJoin(n.fx.map(fxName)) : '') + '.' + (n.gravity ? ' Lower gravity (' + n.gravity + ') fits the setting.' : '') + ' Natural inhabitants would be ' + PL(n.enemy) + ' and ' + PL(n.item) + '; I\'ll suggest them.';
      case 'env': return n.add.length ? '• Effects: + ' + n.add.map(fxName).join(', ') + (n.add.includes('darkness') ? '. Darkness is a light mask; glowing things and projectiles punch holes in it.' : '.') : '• Effects: − ' + n.remove.map(fxName).join(', ') + '.';
      case 'type-mod': {
        if (!n.changes || !n.changes.length) return '• Nothing to change there, apparently. I\'ll double-check the request.';
        const by = {};
        for (const c of n.changes) (by[c.name] = by[c.name] || []).push(c);
        return Object.entries(by).map(([name, cs]) => '• ' + code(name) + ': ' + cs.map((c) => c.prop + (c.from !== '' && c.from != null ? ' ' + c.from + ' → ' + c.to : ' ' + c.to)).join(', ') + '.').join('\n') + (n.complaint ? ' (They said "too", so I\'m going the other way.)' : '');
      }
      case 'player-mod': return '• Player: ' + n.changes.map((c) => c.prop + (c.from != null && c.from !== '' ? ' ' + c.from + ' → ' + c.to : ' ' + c.to)).join(', ') + '.';
      case 'rename': return '• Renaming ' + code(n.from) + ' → ' + code(n.to) + ' (' + (n.glyph || 'new look') + '). Same behaviors, so the new ' + PL(n.to) + ' will act exactly like the old ' + PL(n.from) + '. Every rule that mentions them gets updated too.';
      case 'twist': return n.list.map((t) => '• Twist: ' + t.desc + '.').join('\n');
      case 'concept': return '• The project is empty, so "surprise me" means inventing the whole thing. Rolling dice: genre ' + code(n.genre) + ', setting ' + code(n.theme) + (['breakout', 'snake', 'asteroids', 'shmup'].includes(n.genre) ? '' : ', hero ' + code(n.hero)) + '. Then a title, so it feels like a real game.';
      case 'music': return n.off ? '• Music off.' : '• Music: ' + n.to + (n.inferred ? ' (fits the current vibe)' : '') + (n.jazz ? ' (I don\'t have a jazz band. Chill is the closest thing.)' : '') + '. It\'s generated live from a chord progression, so it never loops exactly.';
      case 'title': return '• Title: “' + n.to + '”' + (n.auto ? ' — something punchy from what\'s in the game.' : '.') + ' It shows as a title card when a round starts.';
      case 'gravity': return '• Gravity ' + n.from + ' → ' + n.to + (n.flip ? ' (negative, so everything falls up, including enemies)' : n.to === 0 ? ' (things will float in place once they stop)' : n.word ? ' (' + n.word + ' gravity)' : '') + '.' + (n.topdown ? ' Top-down games ignore gravity, so I switched physics to platformer.' : '');
      case 'world': return '• ' + U.cap(n.prop) + ': ' + n.from + ' → ' + n.to + '.';
      case 'hazard': return '• ' + (n.remove ? 'Removing' : 'Adding') + ' ' + n.name + (n.remove ? '.' : ' to the level generator. ' + ({ lava: 'Lava hurts anything that isn\'t fireproof, including enemies.', spikes: 'Spikes hurt and bounce you.', water: 'Water slows you down.', ice: 'Ice is slippery.', bounce: 'Bounce pads launch you.' }[n.name] || ''));
      case 'difficulty': return '• Difficulty ' + (n.dir > 0 ? 'up' : 'down') + (n.extreme ? ' (a lot)' : '') + ': ' + (n.enemies.length ? 'enemy speed, HP and numbers ×' + (n.dir > 0 ? (n.extreme ? '1.8' : '1.3') : (n.extreme ? '0.5' : '0.75')) : 'no enemies to tune') + (n.hp != null ? '; player HP → ' + n.hp : '') + '.';
      case 'juice': return '• Juice: level ' + n.level + '/3 — more particles, screen shake, hit-stop on kills' + (n.added.length ? ', plus ' + U.listJoin(n.added.slice(0, 4)) : '') + '.';
      case 'polish': return '• Polish pass: a better background, ambient particles, a vignette, sparkles on pickups' + (plan.notes.some((x) => x.k === 'music') ? ', music' : '') + (plan.notes.some((x) => x.k === 'title') ? ', and a title' : '') + '.';
      case 'palette': return '• Palette → ' + (n.to || 'custom') + (n.color ? ' (generated from ' + n.color + ': darker background, lighter edges, a complementary player color)' : '') + '.';
      case 'background': return n.color ? '• Background tinted ' + n.color + '.' : '• Background: ' + (n.from || 'void') + ' → ' + n.to + '.';
      case 'type-remove': return '• Removing ' + U.listJoin(n.names.map(code)) + ' and any rules that only existed for them.';
      case 'goal': return n.kind === 'exists' ? '• There\'s already a win condition.' : '• Win condition: ' + ({ collect: 'collect every ' + H(n.name), exit: 'reach the ' + H(n.name || 'exit'), survive: 'survive 60 seconds', levels: 'an exit that leads to the next level' }[n.kind] || n.kind) + '.';
      case 'keybind': return '• "Let me…" maps to a key. ' + n.key.toUpperCase() + ' is free, so pressing it will ' + n.acts.map((a) => DSL.describeAction(a)).join(', ') + '.';
      case 'hud': return n.timer ? '• Countdown: ' + n.timer + 's' + (n.survive ? ', and surviving it wins.' : ', and running out loses.') : n.timer === 0 ? '• Timer removed.' : '• HUD tweak.';
      case 'reseed': return '• Rolling a new level seed (' + n.seed + ') for a fresh layout.';
      case 'density': return '• Level density ' + n.from + ' → ' + n.to + '.';
      case 'balance': return '• ' + U.cap(PL(n.name)) + ' would move at ' + n.from + ', faster than the player (' + n.player + '), which makes them impossible to escape. Capping at ' + n.to + '.';
      case 'generic': return '• They said "' + n.asked + '" without a specific kind' + (n.theme ? '; in a ' + H(n.theme) + ' setting ' + PL(n.chose) + ' fit best.' : '. ' + U.cap(PL(n.chose)) + ' it is.');
      case 'consider': return considerText(n, S);
      case 'explosions': return '• Explosion radius ×' + n.mul + ' on everything that explodes.';
      case 'style': return '• Art style → ' + n.style + (n.style === 'shapes' ? ': every emoji becomes a geometric shape with eyes.' : '.');
      case 'noop': return '• I looked for "' + n.what + '" but there\'s nothing like that to change.';
      case 'unknown': return '• I don\'t understand "' + n.text + '".';
      case 'partial': return '• I couldn\'t parse: "' + n.unparsed.join('", "') + '". The rest still works.';
      default: return null;
    }
  }
  function considerText(n, S) {
    switch (n.text) {
      case 'bosswin': return '• No win condition exists yet, so beating the ' + H(n.name) + ' will win the game.';
      case 'keydoor': return '• Keys need a lock: the ' + H(n.door) + ' only works once you\'re holding the ' + H(n.key) + '.';
      case 'defend': return '• Enemies now go for the ' + H(n.name) + ' instead of you. If it dies, you lose.';
      case 'jumpTopdown': return '• Top-down jumping is a short hop: you\'re briefly airborne and immune to ground hazards.';
      case 'flyTopdown': return '• In top-down, flying just means hovering over lava and water.';
      case 'flipTopdown': return '• Gravity flips only matter with gravity. In top-down they\'ll just shake the screen.';
      case 'stealth': return '• Guards have vision cones; get spotted and they chase you at full speed.';
      case 'quest': return '• A tiny quest loop: gems → wizard → win.';
      case 'flap': return '• Flapping replaces jumping, any time, even mid-air.';
      case 'swim': return '• Water already slows you down and lets you paddle upward. I\'ll leave it as is.';
      case 'rescue': return '• Rescuing works like collecting, but they say thank you.';
      default: return null;
    }
    void S;
  }

  N.todos = function (plan) {
    const t = [];
    const notes = plan.notes;
    if (notes.some((n) => n.k === 'genre' || n.k === 'physics')) t.push('Set up physics & level');
    if (notes.some((n) => n.k === 'player-new' || n.k === 'player-skin' || n.k === 'player-mod' || n.k === 'ability')) t.push('Update the player');
    const tn = notes.filter((n) => n.k === 'type-new' || n.k === 'type-mod' || n.k === 'rename' || n.k === 'proj-new');
    if (tn.length) t.push(tn.length > 2 ? 'Create ' + tn.length + ' entity types' : tn.map((n) => (n.k === 'type-new' || n.k === 'proj-new' ? 'Create ' : 'Modify ') + code(n.name || (n.changes && n.changes[0] && n.changes[0].name) || n.to)).join(', '));
    if (notes.some((n) => n.k === 'rule-new' || n.k === 'rule-merge')) t.push('Wire up rules');
    if (notes.some((n) => ['env', 'theme', 'palette', 'background', 'music', 'title', 'polish', 'juice'].includes(n.k))) t.push('Look & feel');
    t.push('Run tests');
    return t.length >= 3 ? t : null;
  };

  // ------------------------------------------------------------------ summary
  N.summary = function (plan, S, files, r, extra) {
    extra = extra || {};
    const out = [];
    const opener = U.pick(['Done.', 'Done!', 'All set.', 'There you go.', 'Shipped.', 'Live in the preview.'], r);
    const past = U.listJoin(N.parts(plan).slice(0, 4).map((p) => p.past)) + '.';
    const hlUnused = ''
      .replace(/^turn this into/, 'Turned this into').replace(/^make you a/, 'You\'re now a').replace(/^add /, 'Added ').replace(/^give you/, 'You now have').replace(/^wire up/, 'Wired up')
      .replace(/^move everything/, 'Moved everything').replace(/^tweak the/, 'Tweaked the').replace(/^adjust your/, 'Adjusted your').replace(/^turn every/, 'Every').replace(/^cut the music/, 'Music is off')
      .replace(/^title it/, 'Titled it').replace(/^flip gravity/, 'Gravity is flipped').replace(/^switch gravity off/, 'Gravity is off').replace(/^change gravity/, 'Changed gravity').replace(/^rebuild the level/, 'Rebuilt the level')
      .replace(/^remove the/, 'Removed the').replace(/^turn up the difficulty/, 'Difficulty is up').replace(/^make it more forgiving/, 'It\'s more forgiving now').replace(/^do a visual polish pass/, 'Did a visual polish pass')
      .replace(/^recolor the world/, 'Recolored the world').replace(/^add a win condition/, 'Added a win condition').replace(/^bind that/, 'Bound that').replace(/^make that change/, 'Made that change').replace(/^adjust the world/, 'Adjusted the world')
      .replace(/, and (give|add|wire|move|tweak|make|title|flip|turn) /, ', and $1 ').replace(/ into a (\w+)\.$/, ' is now a $1.');
    out.push(opener + ' ' + U.cap(past));
    // file bullets
    if (files && files.length) {
      out.push('');
      for (const f of files.slice(0, 7)) out.push('- ' + code(f.path) + ' — ' + f.what);
      if (files.length > 7) out.push('- …and ' + (files.length - 7) + ' more');
    }
    // twists
    const tw = plan.notes.find((n) => n.k === 'twist');
    if (tw) { out.push(''); out.push(tw.list.map((t) => '✦ **Twist:** ' + t.desc + '.').join('\n')); }
    // creative improvisation
    const unk = plan.notes.filter((n) => n.k === 'type-new' && n.unknown);
    if (unk.length) { out.push(''); out.push('I don\'t know what ' + U.listJoin(unk.map((n) => 'a **' + H(n.name) + '**')) + ' is, so I improvised. Tell me more, for example "' + PL(unk[0].name) + ' are dangerous" or "' + PL(unk[0].name) + ' give 5 points", and I\'ll make it so.'); }
    const partial = plan.notes.find((n) => n.k === 'partial' || n.k === 'rule-fail');
    if (partial) { out.push(''); out.push('One part I couldn\'t turn into code: "' + (partial.unparsed || [partial.raw]).join('", "') + '". Try rephrasing that bit.'); }
    const noop = plan.notes.filter((n) => n.k === 'noop');
    if (noop.length && plan.ops.length === 0) out.push('\nI couldn\'t find ' + U.listJoin(noop.map((n) => '"' + n.what + '"')) + ' in the project, so nothing changed.');
    // controls / hints
    const ab = plan.notes.filter((n) => n.k === 'ability');
    if (ab.length) { out.push(''); out.push('Controls: ' + ab.map((a) => N.abilityPhrase(a.name, a.params, S)).join('; ') + '.'); }
    const kb = plan.notes.find((n) => n.k === 'keybind');
    if (kb) { out.push(''); out.push('Press **' + kb.key.toUpperCase() + '** in game to try it.'); }
    if (extra.firstBuild) { out.push(''); out.push('Click the preview to play. Press **Esc** to come back here.'); }
    if (extra.fixedDuringTurn) { out.push(''); out.push('(A test caught a problem mid-way; I fixed it before finishing.)'); }
    return out.join('\n');
  };

  // ------------------------------------------------------------------ suggestions
  N.suggestions = function (S, memory, r) {
    const sum = Spec.summary(S);
    const th = L.themes[S.meta.theme];
    const side = S.world.physics === 'platformer' || S.world.physics === 'runner';
    const enemy = sum.enemies[0], item = sum.collectibles[0];
    const c = [];
    const add = (pri, text) => c.push({ pri, text });
    if (!sum.player && !Object.keys(S.types).length) {
      ['a platformer where I\'m a cat collecting fish', 'zombies chase me through a dark forest', 'a space shooter with asteroids and aliens', 'a snake game, but the apples run away', 'surprise me'].forEach((t, i) => add(10 - i, t));
    }
    if (!sum.enemies.length && sum.player) add(9, 'add ' + (th ? PL(th.enemy) : U.pick(['zombies', 'slimes', 'ghosts', 'goblins'], r)) + ' that chase me');
    if (sum.enemies.length && !sum.weapon && S.world.physics !== 'snake' && S.world.physics !== 'paddle') add(9, 'let me shoot ' + U.pick(th && /space|city|lab/.test(S.meta.theme) ? ['lasers'] : ['fireballs', 'bananas', 'lasers', 'magic'], r));
    if (!sum.collectibles.length && sum.player) add(7, 'add ' + (th ? PL(th.item) : 'coins') + ' to collect');
    if (!sum.hasWin && item) add(8, 'I win when I collect all the ' + PL(item));
    if (!sum.hasWin && !item && enemy) add(6, 'I win if I survive 60 seconds');
    if (side && sum.player && !(S.player.abilities.jump || {}).double) add(6, 'give me a double jump');
    if (!side && sum.player && !S.player.abilities.dash && S.world.physics === 'topdown') add(4, 'let me dash with shift');
    if (!S.audio.music && sum.player) add(5, 'add ' + U.pick(['chill', 'epic', 'spooky', 'happy', 'retro'], r) + ' music');
    if (!S.meta.title && Object.keys(S.types).length >= 2) add(4, 'give it a title');
    if (enemy && !Object.values(S.types).some((d) => d.boss)) add(5, 'when the score reaches 50, spawn a boss');
    if (enemy && !(S.types[enemy].onDeath || []).length) add(4, 'make the ' + PL(enemy) + ' explode when they die');
    if (item && !(S.types[item].behaviors || []).length) add(3, 'make the ' + PL(item) + ' run away from me');
    if (!(S.look.effects || []).some((e) => ['rain', 'snow', 'darkness', 'night', 'fog'].includes(e)) && sum.player) add(4, U.pick(['make it rain at night', 'make it dark with a flashlight', 'add snow and fog'], r));
    if (sum.player && !S.player.glyph) add(5, 'make me a ' + U.pick(['cat', 'wizard', 'robot', 'penguin', 'dragon', 'ghost', 'frog'], r));
    if (!S.meta.theme && sum.player) add(3, 'set it in ' + U.pick(['space', 'a haunted house', 'the ocean', 'a candy land', 'a neon city'], r));
    if ((S.look.juice || 1) < 2 && Object.keys(S.types).length >= 2) add(3, 'make it juicier');
    if (S.level.type === 'arena' || S.level.type === 'empty') add(3, U.pick(['make the level a maze', 'add lava pits', 'turn the level into caves'], r));
    if (sum.player) add(2, 'surprise me');
    if (enemy) add(2, 'turn the ' + PL(enemy) + ' into ' + U.pick(['chickens', 'rubber ducks', 'pizza slices', 'tiny dragons'], r));
    if (sum.player) add(1, 'make gravity flip every 10 seconds');
    const recent = new Set((memory && memory.suggested) || []);
    const list = c.filter((x) => !recent.has(x.text)).sort((a, b) => b.pri - a.pri + (r() - 0.5) * 2.2);
    const out = [];
    for (const x of list) { if (out.length >= 3) break; if (!out.includes(x.text)) out.push(x.text); }
    return out;
  };

  // ------------------------------------------------------------------ Q&A
  N.answer = function (q, S, ctx) {
    const t = q.toLowerCase();
    const sum = Spec.summary(S);
    const game = ctx && ctx.game;
    const I = VC.Interp;
    if (/^(?:help|what can (?:you|i) do|what can i (?:say|ask|type|make)|how does this work|how do i (?:use|start)|what do i do|what (?:is|are) (?:this|vibecode))/.test(t)) {
      return ['**You build this game by describing it.** Everything you say becomes real code in the project, and the preview hot-reloads as I edit.', '', 'Things I understand:', '- **Things:** "add 5 zombies that chase me", "a wizard who says \"hello\"", "a dragon boss that breathes fire"', '- **You:** "make me a cat", "give me a double jump", "let me shoot bananas"', '- **Rules:** "when I touch a coin, the screen shakes", "every 5 seconds spawn meteors", "I win when I collect all the gems"', '- **World:** "make it a platformer", "set it in space", "the floor is lava", "reverse gravity", "make it rain at night"', '- **Tweaks:** "make the zombies faster", "the coins should run away", "turn the slimes into chickens"', '- **Vibes:** "make it juicier", "surprise me", "make it harder", "add spooky music"', '', 'Commands: `/undo`, `/rewind`, `/files`, `/model`, `/achievements`, `/share`. Press **Esc** twice to rewind. You can also edit any file directly in the Files tab.'].join('\n');
    }
    if (/^(?:what is in|what's in|describe|summari[sz]e|tell me about|what have we|what did we|what is my game|what is the game|status|show me what)/.test(t) || /\bmy game\b/.test(t) && /\bwhat\b/.test(t)) return N.describeGame(S);
    if (/\b(?:controls|how do i (?:play|move|shoot|jump|attack|fight|control)|what (?:are|is) the (?:controls|keys|buttons)|which keys|what keys)\b/.test(t)) {
      const c = DSL.controls(S);
      if (!c.length) return 'There\'s no player yet, so there\'s nothing to control. Try "make me a cat".';
      return 'Controls:\n\n' + c.map((x) => '- **' + x[0] + '** — ' + x[1]).join('\n') + '\n\nClick the preview first so it captures the keyboard. **Esc** gives focus back to the chat.';
    }
    if (/\bhow do (?:i|you) win\b|\bwhat is the goal\b|\bwhat should i do in the game\b|\bobjective\b/.test(t)) {
      const wins = S.rules.filter((r) => r.then.some((a) => a.type === 'win' || a.type === 'nextLevel'));
      if (!wins.length) return 'Right now you can\'t win; there\'s no win condition. Try "I win when I collect all the coins" or "add a goal".';
      return 'Ways to win:\n\n' + wins.map((r) => '- ' + DSL.describeRule(r)).join('\n');
    }
    let m;
    if ((m = /how many ([\w ]+?)(?: are there| do i have| exist| is there|\?|$)/.exec(t))) {
      const tgt = I.resolveTarget(m[1], { spec: S, focus: [] });
      if (tgt && tgt.names && tgt.names.length) {
        const live = game ? game.entities.filter((e) => !e.dead && tgt.names.includes(e.type)).length : null;
        const start = tgt.names.reduce((a, n) => a + ((S.types[n].spawn || {}).count || 0), 0);
        return live != null ? 'Right now there are **' + live + '** ' + PL(tgt.names[0], live) + ' alive in the preview (' + start + ' at the start of a round).' : start + ' at the start of a round.';
      }
    }
    if ((m = /^why (?:do|does|are|is|did|can't|cannot|won't|isn't|aren't|don't|doesn't)? ?(?:the |my |all the )?([\w ]+?)\s+(.+)$/.exec(t))) {
      const words = m[1].split(' ');
      for (let i = words.length; i >= 1; i--) {
        const tgt = I.resolveTarget(words.slice(0, i).join(' '), { spec: S, focus: [] });
        if (tgt && tgt.names && tgt.names.length) return N.explainType(tgt.names[0], S, ctx, m[2]);
        if (tgt && tgt.kind === 'player') return N.explainPlayer(S, m[2]);
      }
    }
    if ((m = /(?:what (?:does|do|is|are)|explain|tell me about|how does|how do) (?:the |a |an |my )?([\w ./]+?)(?: do| work| mean| for)?\??$/.exec(t))) {
      const w = m[1].trim();
      if (/(?:\.js|\.md|\.json)$/.test(w) || /^(?:rules|config|player|mods|main|readme)/.test(w)) return N.explainFile(w, S);
      if (/^(?:the )?code$|^this code$|^the project$|^the files$|^everything$/.test(w)) return N.explainCode(S);
      const tgt = I.resolveTarget(w, { spec: S, focus: [] });
      if (tgt && tgt.names && tgt.names.length) return N.explainType(tgt.names[0], S, ctx);
      if (tgt && tgt.kind === 'player') return N.explainPlayer(S);
      const beh = DSL.BEHAVIORS[w] || DSL.ACTIONS[w] || DSL.TRIGGERS[w] || DSL.ABILITIES[w];
      if (beh) return code(w + '(' + beh.p.join(', ') + ')') + ' — ' + beh.d + (beh.o ? '. Options: ' + beh.o + '.' : '.');
    }
    if (/\bwhat should i (?:add|do|try|make)|ideas?\b|\bsuggest/.test(t)) return 'A few ideas based on where the game is:\n\n' + N.suggestions(S, null, U.random).map((s) => '- "' + s + '"').join('\n');
    if (/\bscore\b/.test(t) && game) return 'Score: **' + game.score + '**' + (game.time ? ' after ' + Math.round(game.time) + 's' : '') + '.';
    if (/\b(?:who|what) are you\b/.test(t)) return N.chat('who', S);
    if (/\b(?:can|could) (?:i|you)\b/.test(t)) return 'Probably! Phrase it as an instruction, like "add…", "make…" or "when… then…", and I\'ll try. If it\'s outside what my local rules cover, the live model (`/model`) can write custom code for it.';
    return N.describeGame(S) + '\n\n(If you meant something else, try rephrasing it as an instruction.)';
  };

  N.describeGame = function (S) {
    if (Spec.isEmpty(S)) return 'Nothing yet. The project is empty, the preview is a void, and anything you describe will appear there.';
    const out = [];
    out.push('**' + (S.meta.title || 'Untitled') + '** — a ' + PHYS[S.world.physics] + ' game' + (S.meta.theme ? ' set in ' + H(S.meta.theme) : '') + ' on ' + levelName(S.level.type) + '.');
    if (S.player) out.push('You are ' + (S.player.glyph || 'a little blob') + ' with ' + S.player.hp + ' HP' + (Object.keys(S.player.abilities || {}).length ? ' and ' + U.listJoin(Object.entries(S.player.abilities).map(([k, v]) => N.abilityPhrase(k, v, S).replace(/ \(.*\)$/, ''))) : '') + '.');
    const types = Object.entries(S.types).filter(([, d]) => !d.projectile);
    if (types.length) { out.push(''); for (const [n, d] of types) out.push('- ' + N.entityLine(n, d, S)); }
    if (S.rules.length) { out.push(''); out.push(U.count(S.rules.length, 'rule') + ':'); for (const r of S.rules.slice(0, 8)) out.push('- ' + DSL.describeRule(r)); if (S.rules.length > 8) out.push('- …'); }
    if ((S.look.effects || []).length > 1 || S.audio.music) out.push('\nLook: ' + U.listJoin((S.look.effects || []).map(fxName).concat(S.audio.music ? [S.audio.music + ' music'] : [])) + '.');
    return out.join('\n');
  };
  N.explainType = function (name, S, ctx, why) {
    const d = S.types[name];
    const out = [];
    out.push(N.entityLine(name, d, S) + '.');
    const rules = S.rules.filter((r) => JSON.stringify(r).includes('"' + name + '"'));
    if (rules.length) { out.push(''); out.push('Rules involving ' + PL(name) + ':'); rules.forEach((r) => out.push('- ' + DSL.describeRule(r))); }
    out.push('');
    out.push('It\'s defined in ' + code('src/entities/' + name + '.js') + ', so you can change any of it there directly.');
    const bug = ctx && ctx.bugs && ctx.bugs.find((b) => !b.resolved && b.type === name);
    if (bug) { out.push(''); out.push('Hold on. Looking closer, that\'s **my bug**: ' + bug.desc + '. Say "fix it" and I\'ll correct it.'); }
    else if (why) {
      const hint = /run away|flee/.test(why) && (d.behaviors || []).some((b) => b.type === 'flee') ? 'They run away because their behaviors include `flee("player")`.' : /chase|follow/.test(why) && (d.behaviors || []).some((b) => b.type === 'chase') ? 'They come after you because of `chase("player")`.' : /invisible|see/.test(why) && d.alpha != null && d.alpha < 0.2 ? 'They\'re nearly invisible: `alpha: ' + d.alpha + '`.' : /big|huge|small|tiny/.test(why) ? 'Their size is ' + d.size + 'px.' : /fast|slow/.test(why) ? 'Their speed is ' + (d.speed || 0) + ' (you move at ' + ((S.player && S.player.speed) || 230) + ').' : null;
      if (hint) { out.push(''); out.push(hint + ' Want me to change it?'); }
    }
    return out.join('\n');
  };
  N.explainPlayer = function (S, why) {
    if (!S.player) return 'There\'s no player yet.';
    const p = S.player;
    let s = 'You: ' + (p.glyph || 'a blob') + ', speed ' + p.speed + ', ' + p.hp + ' HP' + (p.lives > 1 ? ', ' + p.lives + ' lives' : '') + '. Abilities: ' + (Object.keys(p.abilities || {}).length ? Object.entries(p.abilities).map(([k, v]) => N.abilityPhrase(k, v, S)).join('; ') : 'none yet') + '. Defined in `src/player.js`.';
    if (why && /jump/.test(why) && !(p.abilities || {}).jump) s += '\n\nYou can\'t jump because there\'s no `jump()` ability. Say "let me jump".';
    if (why && /shoot/.test(why) && !(p.abilities || {}).shoot) s += '\n\nYou can\'t shoot: no `shoot()` ability. Say "let me shoot lasers".';
    return s;
  };
  N.explainFile = function (w, S) {
    const map = { rules: 'src/rules.js', config: 'game.config.js', player: 'src/player.js', mods: 'src/mods.js', main: 'src/main.js', readme: 'README.md' };
    const key = Object.keys(map).find((k) => w.startsWith(k));
    const path = key ? map[key] : w;
    const desc = {
      'src/rules.js': 'The game\'s logic, as a list of `rule(trigger, [actions])`. Triggers like `onCollide("player", "coin")` or `onTimer(5)` fire actions like `addScore(1)` or `spawn("bat", 2)`. Right now: ' + U.count(S.rules.length, 'rule') + '.',
      'game.config.js': 'World-level settings: physics (' + code(S.world.physics) + '), gravity, camera, the level generator (' + code(S.level.type) + '), palette, background, effects, music and HUD.',
      'src/player.js': 'You: look, speed, HP and `abilities: [...]` like `jump()` or `shoot("laser")`.',
      'src/mods.js': 'Plain JavaScript that runs every frame. Export `onUpdate(game, dt)`, `onEvent(game, name, e)` or `onDraw(game, ctx)` to do anything the rules can\'t. I don\'t touch it unless you ask.',
      'src/main.js': 'Boot code. It loads the config, the player, every file in `src/entities/` and the rules, then starts the engine.',
      'README.md': 'An up-to-date description of the game, which I rewrite as it changes.',
    }[path];
    if (desc) return code(path) + ' — ' + desc;
    return 'Each file in `src/entities/` is one kind of thing: its look, stats, `behaviors: [...]` and `spawn` settings.';
  };
  N.explainCode = function (S) {
    return ['The project is a small data-driven game. Every file is real code that the engine evaluates on save:', '', '- `game.config.js` — physics, level generator, look, audio', '- `src/player.js` — you and your abilities', '- `src/entities/*.js` — ' + U.count(Object.keys(S.types).length, 'entity type') + ', one per file', '- `src/rules.js` — ' + U.count(S.rules.length, 'rule') + ' ("when X, do Y")', '- `src/mods.js` — free-form JavaScript hooks', '', 'Edit any of them in the Files tab and press ⌘S/Ctrl+S; the preview hot-reloads. Break something and I can fix it.'].join('\n');
  };

  N.chat = function (topic, S, r) {
    r = r || U.random;
    switch (topic) {
      case 'hello': return U.pick(['Hey! What are we building?', 'Hi. Describe a game, a character, a world, anything, and I\'ll start writing it.', 'Hello! The preview is waiting. What should exist first?'], r);
      case 'thanks': return U.pick(['Anytime.', 'Happy to. What next?', 'Thanks! This one\'s coming together.', 'Glad you like it. Want to keep going?'], r);
      case 'lol': return U.pick(['Emergent gameplay is my favorite kind.', 'I promise that was (mostly) intentional.', 'Ship it.'], r);
      case 'sad': return U.pick(['Fair. Tell me what feels off and I\'ll fix it, or type /undo.', 'Noted. Want me to undo the last change?', 'Let\'s make it better. What\'s bothering you most?'], r);
      case 'who': return 'I\'m Vibe, the coding agent that lives in this terminal. I turn what you describe into code for the game in the preview: entities, rules, physics, all of it. I run locally with a rule-based interpreter, and if your setup has a live model available, `/model` switches me to it for open-ended requests.';
      default: return 'Hi!';
    }
  };

  N.clarify = function (plan, S, r, live) {
    const u = plan.notes.find((n) => n.k === 'unknown');
    const text = u ? u.text : '';
    const out = [];
    out.push(U.pick(['I\'m not sure how to turn that into code yet', 'That one\'s beyond what I can parse right now', 'I couldn\'t map that to the game'], r) + (text ? ': "' + text + '".' : '.'));
    out.push('');
    out.push('Some things I can do from here:');
    N.suggestions(S, null, r).forEach((s) => out.push('- "' + s + '"'));
    if (live) out.push('\nOr switch to the live model with `/model`, which can write custom code for open-ended requests.');
    return out.join('\n');
  };

  VC.Narrator = N;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
