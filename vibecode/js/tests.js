/* VibeCode — the project's "test suite": real headless simulations of the spec. */
(function (VC) {
  'use strict';
  const U = VC.U;
  const Tests = {};
  const ROLES = new Set(['player', 'enemy', 'enemies', 'collectible', 'projectile', 'any', 'boss', 'friend', 'hazard', 'obstacle', 'npc', 'pet', 'structure', 'critter', 'vehicle', 'hostile', 'lava', 'water', 'spikes', 'wall', 'ice', 'bounce', 'tree', 'platform', 'self', 'other', 'it']);

  Tests.run = function (spec, files) {
    const t0 = U.now();
    const res = [];
    const add = (name, pass, detail, fix) => res.push({ name, pass: !!pass, detail: detail || '', fix: fix || null });

    // 1. sources compile
    if (files) {
      let bad = null;
      for (const [p, code] of Object.entries(files)) {
        const k = VC.DSL.fileKind(p);
        if (!['config', 'player', 'entity', 'rules', 'mods'].includes(k)) continue;
        try { VC.DSL.evaluate(p, code, spec); } catch (e) { bad = p + (e.line ? ':' + e.line : '') + ' — ' + e.message; break; }
      }
      add('sources compile', !bad, bad || Object.keys(files).length + ' files', bad ? 'syntax' : null);
    }
    // 2. references
    const known = new Set(Object.keys(spec.types));
    const missing = new Set();
    const ref = (v) => { if (typeof v !== 'string') return; const s = v.startsWith('all:') ? v.slice(4) : v; if (!known.has(s) && !ROLES.has(s)) missing.add(s); };
    for (const r of spec.rules) {
      const w = r.when;
      ['a', 'b', 'of'].forEach((k) => ref(w[k]));
      for (const a of r.then) { ref(a.what); ref(a.into); if (a.target) ref(a.target); }
    }
    for (const d of Object.values(spec.types)) for (const b of d.behaviors || []) { if (b.type === 'shoot') ref(b.projectile || b.what || 'bullet'); if (b.type === 'spawner' && b.what) ref(b.what); }
    if (spec.player && spec.player.abilities && spec.player.abilities.shoot) ref(spec.player.abilities.shoot.projectile || 'bullet');
    missing.delete('bullet');
    add('references resolve', !missing.size, missing.size ? 'unknown: ' + [...missing].join(', ') : 'all types found', missing.size ? 'refs' : null);
    // 3. sane numbers
    const weird = [];
    for (const [n, d] of Object.entries(spec.types)) {
      if (d.size != null && (d.size < 3 || d.size > 420)) weird.push(n + '.size=' + d.size);
      if (d.speed != null && (d.speed < 0 || d.speed > 2400)) weird.push(n + '.speed=' + d.speed);
      if (d.alpha != null && d.alpha < 0.03) weird.push(n + '.alpha=' + d.alpha);
      if (d.spawn && d.spawn.count > 300) weird.push(n + '.spawn.count=' + d.spawn.count);
    }
    if (spec.player && (spec.player.size < 6 || spec.player.size > 300)) weird.push('player.size=' + spec.player.size);
    if (spec.player && spec.player.speed > 2000) weird.push('player.speed=' + spec.player.speed);
    add('values in range', !weird.length, weird.length ? weird.slice(0, 3).join(', ') : 'sizes, speeds, counts ok', weird.length ? 'ranges' : null);

    // 4. boot + simulate
    let g = null;
    try {
      g = new VC.Engine({});
      g.load(spec);
      add('world boots', !g.err, g.err ? g.err.message : g.W + '×' + g.H + ' ' + spec.level.type + ' level');
    } catch (e) {
      add('world boots', false, e.message, 'crash');
    }
    if (g && !g.err) {
      const P = g.player;
      if (spec.player) {
        const stuck = P && (g.solidAt(P.x, P.y) || g.solidAt(P.x - P.r * 0.7, P.y) || g.solidAt(P.x + P.r * 0.7, P.y) || g.solidAt(P.x, P.y - P.r * 0.7));
        add('player spawns in open space', P && !stuck, P ? Math.round(P.x) + ',' + Math.round(P.y) : 'no player', stuck ? 'spawn' : null);
      }
      const startCount = g.entities.length;
      add('spawn budget', startCount < 450, startCount + ' entities at start', startCount >= 450 ? 'budget' : null);
      // idle survival
      if (spec.player) {
        g.mode = 'play';
        const needsInput = spec.player.abilities && (spec.player.abilities.flap || spec.world.physics === 'runner');
        g.inputOverride = needsInput ? (gg, dt) => gg.autopilot(dt) : () => ({ x: 0, y: 0 });
        let ok = true;
        try { g.simulate(1.2); } catch (e) { ok = false; }
        const alive = (g.state === 'running' || g.state === 'won') && g.player && g.player.hp > 0;
        add('no instant death', ok && alive && !g.err, alive ? 'player alive after 1.2s ' + (needsInput ? 'on autopilot' : 'idle') : 'player died at t=' + g.time.toFixed(2) + 's', alive ? null : 'spawnkill');
        add('not instantly won', g.state !== 'won', g.state === 'won' ? 'won within 1.2s' + (g.wonBy ? ' via ' + VC.DSL.describeTrigger(g.wonBy.when).toLowerCase() : '') : 'win condition not met yet', g.state === 'won' ? 'instawin' : null);
      }
      // autopilot soak
      try {
        const g2 = new VC.Engine({});
        g2.load(spec);
        const t1 = U.now();
        g2.simulate(4);
        const ms = (U.now() - t1) / 240;
        let nan = 0;
        for (const e of g2.entities) if (!isFinite(e.x) || !isFinite(e.y)) nan++;
        add('4s soak: no NaN', !nan && !g2.err, g2.err ? g2.err.message : nan ? nan + ' entities at NaN' : 'stable', nan ? 'nan' : g2.err ? 'crash' : null);
        add('entity budget', g2.entities.length < 1300, g2.entities.length + ' alive after 4s', g2.entities.length >= 1300 ? 'budget' : null);
        add('frame budget', ms < 9, ms.toFixed(2) + 'ms / tick', ms >= 9 ? 'perf' : null);
      } catch (e) {
        add('4s soak', false, e.message, 'crash');
      }
    }
    return { results: res, ms: Math.round(U.now() - t0), failed: res.filter((r) => !r.pass) };
  };

  VC.Tests = Tests;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
