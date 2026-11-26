/* VibeCode — the agent: turns plans into a streamed coding session that edits the live project. */
(function (VC) {
  'use strict';
  const U = VC.U, DSL = VC.DSL, Spec = VC.Spec, N = VC.Narrator;
  const A = { busy: false, queue: [], abort: false };

  A.MODELS = {
    'vibe-1': { label: 'vibe-1', desc: 'balanced · local, instant', bug: 0.07, speed: 1, think: 1 },
    'vibe-1-turbo': { label: 'vibe-1-turbo', desc: 'fast and a little sloppy', bug: 0.22, speed: 0.4, think: 0.5 },
    'vibe-1-max': { label: 'vibe-1-max', desc: 'thorough · plans, tests twice, never sloppy', bug: 0, speed: 1.25, think: 1.4 },
    'vibe-chaos': { label: 'vibe-chaos', desc: 'unhinged · adds twists you did not ask for', bug: 0.3, speed: 0.9, think: 1 },
    claude: { label: 'claude · live', desc: 'a real model via the artifact runtime: slower, open-ended, writes custom code', live: true },
  };

  // ------------------------------------------------------------------ timing
  const speedMul = () => {
    const s = VC.App.settings.speed;
    const m = A.MODELS[VC.App.settings.model] || A.MODELS['vibe-1'];
    return (s === 'instant' ? 0 : s === 'fast' ? 0.35 : 1) * (m.speed || 1);
  };
  A.wait = async function (ms) {
    const k = speedMul();
    if (!k) return;
    const end = performance.now() + ms * k;
    while (performance.now() < end) {
      if (A.abort) throw new Interrupt();
      await U.sleep(Math.min(40, end - performance.now()));
    }
    if (A.abort) throw new Interrupt();
  };
  function Interrupt() { this.interrupt = true; }
  A.check = () => { if (A.abort) throw new Interrupt(); };

  // ------------------------------------------------------------------ transcript helpers
  const App = () => VC.App;
  A.msg = (m) => App().pushMsg(Object.assign({ id: U.uid('m') }, m));
  A.upd = (m) => App().updMsg(m);
  A.say = async function (text, opts) {
    opts = opts || {};
    const m = A.msg({ t: 'assistant', text: '', streaming: true });
    await A.stream(m, 'text', text, opts.cps || 900);
    m.streaming = false; A.upd(m);
    return m;
  };
  A.stream = async function (m, key, text, cps) {
    const k = speedMul();
    if (!k) { m[key] = text; A.upd(m); VC.UI.spinner.tok(text.length / 4); return; }
    let i = 0;
    const step = Math.max(2, Math.round(cps / 60));
    while (i < text.length) {
      A.check();
      const n = step + Math.floor(Math.random() * step);
      i = Math.min(text.length, i + n);
      m[key] = text.slice(0, i);
      A.upd(m);
      VC.UI.spinner.tok(n / 4);
      App().project.stats.tokensOut = (App().project.stats.tokensOut || 0) + n / 4;
      await U.sleep(16 / Math.max(0.2, k));
    }
  };
  A.think = async function (text) {
    const m = A.msg({ t: 'think', text: '', collapsed: false, done: false });
    const t0 = performance.now();
    VC.UI.spinner.set(N.verb());
    await A.stream(m, 'text', text, 1700 * (1 / ((A.MODELS[App().settings.model] || {}).think || 1)));
    await A.wait(250);
    m.done = true; m.secs = Math.max(1, (performance.now() - t0) / 1000 + text.length / 900); m.collapsed = true;
    A.upd(m);
    return m;
  };
  A.sys = (text, kind) => A.msg({ t: 'sys', text, kind });

  // ------------------------------------------------------------------ entry
  A.submit = function (text) {
    if (!text) return;
    if (A.busy) {
      const m = A.msg({ t: 'user', text, queued: true });
      A.queue.push({ text, m });
      return;
    }
    A.run(text);
  };
  A.interrupt = function () { if (A.busy) A.abort = true; };

  A.run = async function (text, opts) {
    opts = opts || {};
    const app = App(), p = app.project;
    A.busy = true; A.abort = false;
    app.onBusy(true);
    let userMsg = opts.userMsg;
    if (userMsg) { userMsg.queued = false; A.upd(userMsg); }
    else if (!opts.silentUser) userMsg = A.msg({ t: 'user', text });
    const msgIndex = p.messages.indexOf(userMsg);
    p.turns++;
    p.stats.tokensIn = (p.stats.tokensIn || 0) + text.length / 3.5;
    VC.Sound.ui('send');
    VC.UI.spinner.start(N.verb());
    try {
      const model = A.MODELS[app.settings.model] || A.MODELS['vibe-1'];
      if (model.live && app.live) await VC.Live.run(text, { msgIndex });
      else await A.local(text, { msgIndex });
    } catch (e) {
      if (e && e.interrupt) { A.sys('Interrupted by user · what should Vibe do instead?', 'err'); VC.Sound.ui('error'); }
      else { console.error(e); A.sys('Something went wrong inside Vibe: ' + (e && e.message ? e.message : e), 'err'); }
    } finally {
      VC.UI.spinner.stop();
      A.busy = false; A.abort = false;
      app.onBusy(false);
      app.save();
      const next = A.queue.shift();
      if (next) setTimeout(() => A.run(next.text, { userMsg: next.m }), 60);
    }
  };

  // ------------------------------------------------------------------ local brain
  A.local = async function (text, meta) {
    const app = App(), p = app.project;
    const r = U.rng(U.hash(text + p.turns));
    const ctx = { spec: p.spec, focus: p.memory.focus || [] };
    const parsed = VC.Interp.parse(text, ctx);
    VC.Ach.onPrompt(text, parsed, p);
    const plan = VC.Planner.plan(parsed, p.spec, { memory: p.memory, focus: p.memory.focus, model: app.settings.model === 'vibe-chaos' ? 'chaos' : 'balanced', seed: U.hash(text) ^ p.turns });
    await A.wait(450 + r() * 500);
    switch (plan.kind) {
      case 'question': return A.answer(plan.intent.text, r);
      case 'chat': { await A.wait(200); if (plan.intent.topic === 'thanks') VC.Ach.unlock('polite'); await A.say(N.chat(plan.intent.topic, p.spec, r)); return A.suggest(r); }
      case 'undo': return A.undo(plan.intent.steps || 1);
      case 'fix': return A.fix(text, r);
      case 'reset': return A.reset();
      case 'keepbug': return A.keepBug(r);
      case 'clarify': case 'noop': {
        if (plan.kind === 'noop' && plan.notes.some((n) => n.k === 'noop')) { await A.say(N.summary(plan, p.spec, [], r)); return A.suggest(r); }
        await A.say(N.clarify(plan, p.spec, r, !!app.live));
        return A.suggest(r);
      }
      default: break;
    }
    // chaos model adds a bonus twist sometimes
    if (app.settings.model === 'vibe-chaos' && r() < 0.4 && !plan.notes.some((n) => n.k === 'twist')) {
      const extra = VC.Planner.plan({ intents: [{ kind: 'surprise' }] }, plan.spec, { memory: p.memory, seed: p.turns * 7 });
      if (extra.kind === 'build') { plan.ops = plan.ops.concat(extra.ops); plan.notes = plan.notes.concat(extra.notes); plan.spec = extra.spec; plan.twists = (plan.twists || []).concat(extra.twists); plan.chaosBonus = true; }
    }
    await A.build(plan, text, meta, r);
  };

  // ------------------------------------------------------------------ build turn
  const FILE_ORDER = (p, spec) => {
    const k = DSL.fileKind(p);
    if (k === 'config') return 0;
    if (k === 'entity') { const n = p.slice(13, -3); const d = spec.types[n]; return d && d.projectile ? 1 : 2; }
    return { player: 3, rules: 4, mods: 5, readme: 6, json: 7, main: 8 }[k] || 9;
  };

  A.computeFiles = function (beforeSpec, afterSpec, p) {
    const genBefore = DSL.generateFiles(beforeSpec, p);
    const genAfter = DSL.generateFiles(afterSpec, Object.assign({}, p, { turns: p.turns }));
    const overrides = Object.assign({}, p.overrides || {});
    const cur = Object.assign({}, genBefore, overrides);
    const next = {};
    const newOverrides = {};
    for (const [f, txt] of Object.entries(genAfter)) {
      if (overrides[f] != null && genBefore[f] === genAfter[f]) { next[f] = overrides[f]; newOverrides[f] = overrides[f]; }
      else next[f] = txt;
    }
    const changes = [];
    for (const f of new Set(Object.keys(cur).concat(Object.keys(next)))) {
      if (f === 'package.json') continue;
      if (cur[f] === next[f]) continue;
      changes.push({ path: f, before: cur[f], after: next[f], kind: cur[f] == null ? 'new' : next[f] == null ? 'delete' : 'edit' });
    }
    changes.sort((a, b) => FILE_ORDER(a.path, afterSpec) - FILE_ORDER(b.path, afterSpec) || a.path.localeCompare(b.path));
    return { changes, overrides: newOverrides, files: next };
  };

  // spec that has file `path` from `final` merged into `cur`
  A.mergeSlice = function (cur, final, path) {
    const s = U.clone(cur);
    const k = DSL.fileKind(path);
    if (k === 'config') { s.meta = U.clone(final.meta); for (const key of ['world', 'camera', 'level', 'look', 'audio', 'hud']) s[key] = U.clone(final[key]); }
    else if (k === 'entity') { const n = path.slice(13, -3); if (final.types[n]) s.types[n] = U.clone(final.types[n]); else delete s.types[n]; }
    else if (k === 'player') s.player = U.clone(final.player);
    else if (k === 'rules') s.rules = U.clone(final.rules);
    else if (k === 'mods') s.mods = final.mods;
    return s;
  };

  A.fileSummary = function (ch, plan, spec) {
    const k = DSL.fileKind(ch.path);
    const st = DSL.diffStats(DSL.diff(ch.before || '', ch.after || ''));
    if (ch.kind === 'delete') return 'removed';
    if (k === 'entity') {
      const n = ch.path.slice(13, -3), d = spec.types[n];
      if (!d) return 'removed';
      if (ch.kind === 'new') return d.projectile ? 'new projectile: speed ' + (d.speed || 560) + ', ' + (d.damage || 1) + ' damage' + (d.explode ? ', explodes' : '') : 'new: ' + (N.entityLine(n, d, spec).split(' — ')[1] || '').split(', ').slice(0, 3).join(', ');
      const tm = plan.notes.find((x) => x.k === 'type-mod' && x.changes && x.changes.some((c) => c.name === n));
      if (tm) return tm.changes.filter((c) => c.name === n).slice(0, 3).map((c) => c.prop + (c.from !== '' && c.from != null ? ' ' + c.from + ' → ' + c.to : ' ' + c.to)).join(', ');
      return '+' + st.add + ' −' + st.del;
    }
    if (k === 'rules') { const n = plan.notes.filter((x) => x.k === 'rule-new').length, m = plan.notes.filter((x) => x.k === 'rule-merge').length; return [n ? U.count(n, 'rule') + ' added' : '', m ? U.count(m, 'rule') + ' updated' : ''].filter(Boolean).join(', ') || '+' + st.add + ' −' + st.del; }
    if (k === 'player') return ch.kind === 'new' ? 'new: that\'s you' : (plan.notes.filter((x) => x.k === 'ability').map((x) => x.name).join(', ') || 'updated') ;
    if (k === 'config') { const bits = []; for (const n of plan.notes) { if (n.k === 'physics') bits.push('physics → ' + n.to); if (n.k === 'level' && !n.implicit) bits.push('level → ' + n.to); if (n.k === 'env') bits.push(n.add.length ? '+' + n.add.join(', ') : '−' + n.remove.join(', ')); if (n.k === 'theme') bits.push('theme → ' + n.to); if (n.k === 'music') bits.push(n.off ? 'music off' : 'music → ' + n.to); if (n.k === 'title') bits.push('title'); if (n.k === 'gravity') bits.push('gravity ' + n.to); if (n.k === 'palette') bits.push('palette'); } return bits.slice(0, 3).join(', ') || '+' + st.add + ' −' + st.del; }
    if (k === 'readme') return 'docs updated';
    return '+' + st.add + ' −' + st.del;
  };

  A.build = async function (plan, text, meta, r) {
    const app = App(), p = app.project, UI = VC.UI;
    const before = U.clone(p.spec);
    const model = A.MODELS[app.settings.model] || A.MODELS['vibe-1'];
    // amusing bugs
    const bug = A.maybeBug(plan, p, model, r);
    // reasoning
    if (app.game.mode === 'paused') app.setMode('demo');
    await A.think(N.thinking(plan, before, {}, r));
    await A.say(N.headline(plan, r));
    const { changes, overrides } = A.computeFiles(before, plan.spec, p);
    if (!changes.length) { await A.say('Turns out the project already works that way, so there was nothing to change.'); return A.suggest(r); }
    // plan mode
    if (app.settings.mode === 'plan') {
      const items = N.parts(plan).map((x) => '- ' + U.cap(x.fut)).join('\n') + '\n\nFiles: ' + changes.filter((c) => c.path !== 'README.md').map((c) => '`' + c.path + '`').join(', ');
      const pm = A.msg({ t: 'plan', title: 'Here is Vibe’s plan:', text: items });
      UI.spinner.stop();
      const ans = await UI.choose('Ready to code?', 'Would you like to proceed?', [{ label: 'Yes, and auto-accept edits', value: 'auto' }, { label: 'Yes, and manually approve edits', value: 'manual' }, { label: 'No, keep planning', value: 'no', esc: true }]);
      pm.answer = ans === 'no' ? 'Kept planning' : 'Approved'; A.upd(pm);
      if (ans === 'no') { await A.say('Okay, nothing changed. Tell me what to adjust in the plan.'); return; }
      VC.Ach.unlock('plan');
      app.setPermMode(ans === 'auto' ? 'acceptEdits' : 'default');
      UI.spinner.start(N.verb());
    }
    // todos
    const todoLabels = N.todos(plan) || (model.think > 1.2 ? ['Apply changes', 'Run tests'] : null);
    let todo = null;
    if (todoLabels) todo = A.msg({ t: 'todo', items: todoLabels.map((l, i) => ({ label: l, s: i === 0 ? 'doing' : 'todo' })) });
    const tick = (label) => { if (!todo) return; const i = todo.items.findIndex((x) => x.s !== 'done'); if (i >= 0) { todo.items[i].s = 'done'; if (todo.items[i + 1]) todo.items[i + 1].s = 'doing'; A.upd(todo); } void label; };
    // reads
    const reads = changes.filter((c) => c.kind === 'edit' && c.path !== 'README.md').slice(0, 3);
    for (const c of reads) {
      const m = A.msg({ t: 'tool', name: 'Read', arg: c.path, status: 'run' });
      await A.wait(180 + r() * 220);
      m.status = 'ok'; m.res = 'Read <b>' + c.before.split('\n').length + '</b> lines'; A.upd(m);
      VC.Sound.ui('tick');
    }
    if (plan.notes.some((n) => n.k === 'type-mod' && n.global) || plan.notes.some((n) => n.k === 'difficulty')) {
      const m = A.msg({ t: 'tool', name: 'Search', arg: 'pattern: "speed|hp|spawn", path: "src/entities"', status: 'run' });
      await A.wait(300);
      m.status = 'ok'; m.res = 'Found <b>' + Object.keys(p.spec.types).length + '</b> files'; A.upd(m);
    }
    // edits
    let cur = before;
    const applied = [];
    let lastGroup = null;
    for (const ch of changes) {
      A.check();
      const group = DSL.fileKind(ch.path);
      if (group !== lastGroup && lastGroup && todo) tick();
      lastGroup = group;
      const diff = DSL.diff(ch.before || '', ch.after || '');
      const st = DSL.diffStats(diff);
      const tool = ch.kind === 'new' ? 'Write' : ch.kind === 'delete' ? 'Bash' : 'Update';
      const arg = ch.kind === 'delete' ? 'rm ' + ch.path : ch.path;
      const lines = ch.kind === 'new' ? ch.after.replace(/\n$/, '').split('\n').map((s, i) => ({ k: ' ', s, n: i + 1 })) : ch.kind === 'delete' ? null : DSL.hunks(diff, 2);
      const m = A.msg({ t: 'tool', name: tool, arg, status: 'run', body: lines ? { kind: 'code', path: ch.path, lines, limit: ch.kind === 'new' ? 12 : 16, live: true } : null });
      await A.wait(260 + r() * 300);
      if (app.settings.mode === 'default' && ch.path !== 'README.md') {
        UI.spinner.stop();
        const fname = ch.path.split('/').pop();
        const ans = await UI.choose(ch.kind === 'new' ? 'Do you want to create ' + fname + '?' : ch.kind === 'delete' ? 'Do you want to delete ' + fname + '?' : 'Do you want to make this edit to ' + fname + '?', U.esc(ch.path), [
          { label: 'Yes', value: 'yes' },
          { label: 'Yes, allow all edits during this session', hint: 'shift+tab', value: 'all' },
          { label: 'No, and tell Vibe what to do differently', hint: 'esc', value: 'no', esc: true },
        ], { shiftTab: 1 });
        if (ans === 'all') app.setPermMode('acceptEdits');
        if (ans === 'no') {
          m.status = 'deny'; m.res = 'User rejected ' + (ch.kind === 'new' ? 'write to' : 'update to') + ' <b>' + U.esc(ch.path) + '</b>'; A.upd(m);
          if (applied.length) A.finishPartial(p, cur, applied, text, meta);
          await A.say('Okay, I left `' + ch.path + '` alone' + (applied.length ? ' (the ' + U.count(applied.length, 'earlier edit') + ' stay)' : '') + '. What should I do instead?');
          return;
        }
        UI.spinner.start(N.verb());
      }
      // apply
      cur = A.mergeSlice(cur, plan.spec, ch.path);
      app.applySpec(cur, { overrides, path: ch.path, hmr: ch.path !== 'README.md' });
      applied.push(ch);
      m.status = 'ok';
      m.body && (m.body.live = false);
      if (ch.kind === 'new') m.res = 'Wrote <b>' + ch.after.split('\n').length + '</b> lines to <b>' + U.esc(ch.path) + '</b>';
      else if (ch.kind === 'delete') { m.res = 'Removed <b>' + U.esc(ch.path) + '</b>'; }
      else m.res = 'Updated <b>' + U.esc(ch.path) + '</b> with <span class="add">' + st.add + ' addition' + (st.add === 1 ? '' : 's') + '</span> and <span class="del">' + st.del + ' removal' + (st.del === 1 ? '' : 's') + '</span>';
      if (ch.path === 'README.md') m.body = null;
      A.upd(m);
      VC.Sound.ui('write');
      p.lastChanged[ch.path] = diff.filter((l) => l.k === '+').map((l) => l.n);
      p.fileMarks[ch.path] = ch.kind === 'new' ? 'new' : 'edit';
    }
    // final spec (meta etc.)
    app.applySpec(plan.spec, { overrides, quiet: true });
    if (todo) tick();
    // tests
    let fixedDuring = false;
    const res = await A.runTests('vibe test');
    if (res.failed.length) {
      const fx = await A.autoFix(res.failed, plan, bug);
      fixedDuring = fx;
    }
    if (model.think > 1.2 && !res.failed.length) { await A.wait(200); await A.runTests('vibe test --soak', true); }
    if (todo) { todo.items.forEach((x) => (x.s = 'done')); A.upd(todo); }
    // memory
    p.memory.focus = plan.focus && plan.focus.length ? plan.focus.slice(-4) : p.memory.focus;
    p.memory.twists = (p.memory.twists || []).concat(plan.twists || []);
    // summary
    const files = changes.filter((c) => c.path !== 'README.md').map((c) => ({ path: c.path, what: A.fileSummary(c, plan, plan.spec) }));
    const firstBuild = Spec.isEmpty(before) && !Spec.isEmpty(plan.spec) && !p.memory.playedHint;
    if (firstBuild) p.memory.playedHint = true;
    await A.say(N.summary(plan, plan.spec, files, r, { firstBuild, fixedDuringTurn: fixedDuring }) + (plan.chaosBonus ? '\n\n(vibe-chaos added that twist. You didn\'t ask. You\'re welcome.)' : ''));
    VC.Ach.onPlan(plan, p);
    if (bug && !bug.resolved) { p.bugs.push(bug); }
    const label = text.length > 64 ? text.slice(0, 61) + '…' : text;
    let add = 0, del = 0; for (const c of changes) { const s = DSL.diffStats(DSL.diff(c.before || '', c.after || '')); add += s.add; del += s.del; }
    app.commit(label, { msgIndex: meta.msgIndex, add, del });
    VC.Sound.ui('done');
    A.suggest(r);
  };

  A.finishPartial = function (p, cur, applied, text, meta) {
    const app = App();
    app.commit((text.length > 50 ? text.slice(0, 47) + '…' : text) + ' (partial)', { msgIndex: meta.msgIndex, add: 0, del: 0 });
    void cur; void applied; void p;
  };

  A.suggest = function (r) {
    const p = App().project;
    const items = N.suggestions(p.spec, p.memory, r || U.random);
    p.memory.suggested = ((p.memory.suggested || []).concat(items)).slice(-9);
    A.msg({ t: 'suggest', items });
    VC.UI.setGhost(items[0] || '');
  };

  // ------------------------------------------------------------------ tests & fixing
  A.runTests = async function (cmd, quiet) {
    const app = App(), p = app.project;
    const m = A.msg({ t: 'tool', name: 'Bash', arg: cmd, status: 'run', body: { kind: 'bash', lines: [] } });
    await A.wait(250);
    const res = VC.Tests.run(p.spec, app.files());
    const lines = [{ s: '> ' + VC.DSL.packageJson(p.spec, p).match(/"name": "([^"]+)"/)[1] + '@0.' + p.turns + '.0 test', cls: 'dim' }, { s: '' }];
    for (const t of res.results) {
      A.check();
      lines.push({ s: (t.pass ? '  ✓ ' : '  ✗ ') + t.name + (t.detail ? '  ' + t.detail : ''), cls: t.pass ? 'pass' : 'fail' });
      m.body.lines = lines.slice(); A.upd(m);
      await A.wait(quiet ? 25 : 55);
    }
    lines.push({ s: '' });
    lines.push({ s: (res.failed.length ? 'Tests: ' + res.failed.length + ' failed, ' : 'Tests: ') + (res.results.length - res.failed.length) + ' passed, ' + res.results.length + ' total (' + res.ms + 'ms)', cls: res.failed.length ? 'fail' : 'pass' });
    m.body.lines = lines; m.status = res.failed.length ? 'err' : 'ok';
    m.res = res.failed.length ? '<span class="del">' + res.failed.length + ' failing</span>' : '<span class="add">all ' + res.results.length + ' tests pass</span>';
    A.upd(m);
    VC.Sound.ui(res.failed.length ? 'fail' : 'pass');
    VC.Term && VC.Term.log('[test] ' + (res.failed.length ? res.failed.length + ' failed' : 'all passed') + ' (' + res.ms + 'ms)', res.failed.length ? 'er' : 'ok');
    return res;
  };

  // returns true if it fixed something
  A.autoFix = async function (failed, plan, bug) {
    const app = App(), p = app.project;
    for (let round = 0; round < 2 && failed.length; round++) {
      const fix = A.diagnose(failed, p.spec, bug, app);
      if (!fix.ops.length && !fix.revertOverride) {
        await A.say('The **' + failed[0].name + '** test is failing (' + failed[0].detail + ') and I don\'t have a confident fix. The game still runs. Want me to undo this change?');
        return false;
      }
      await A.say(fix.explain);
      const before = U.clone(p.spec);
      let next = fix.ops.length ? Spec.apply(p.spec, fix.ops) : p.spec;
      const overrides = Object.assign({}, p.overrides);
      if (fix.revertOverride) delete overrides[fix.revertOverride];
      p.overrides = overrides;
      const { changes } = A.computeFiles(before, next, p);
      for (const ch of changes.filter((c) => c.path !== 'README.md')) {
        const diff = DSL.diff(ch.before || '', ch.after || '');
        const st = DSL.diffStats(diff);
        const m = A.msg({ t: 'tool', name: 'Update', arg: ch.path, status: 'run', body: { kind: 'code', path: ch.path, lines: DSL.hunks(diff, 2), limit: 12, live: true } });
        await A.wait(350);
        m.status = 'ok'; m.body.live = false; m.res = 'Updated <b>' + U.esc(ch.path) + '</b> with <span class="add">' + st.add + '</span> and <span class="del">' + st.del + '</span>'; A.upd(m);
      }
      app.applySpec(next, { overrides, hmr: true, path: (changes[0] || {}).path || 'project' });
      plan.spec = next;
      if (bug && fix.fixedBug) { bug.resolved = true; VC.Ach.unlock('bugfix'); }
      const res = await A.runTests('vibe test');
      failed = res.failed;
    }
    return !failed.length;
  };

  A.diagnose = function (failed, spec, bug, app) {
    const ops = [];
    const why = [];
    let fixedBug = false;
    for (const f of failed) {
      switch (f.fix) {
        case 'budget': case 'perf': {
          if (bug && bug.kind === 'count' && !bug.resolved) { ops.push(...bug.fixOps); why.push('That\'s on me: I multiplied the `' + bug.type + '` spawn count by 40 by accident (' + f.detail + '). Setting it back.'); fixedBug = true; break; }
          const big = Object.entries(spec.types).filter(([, d]) => d.spawn && d.spawn.count > 60).sort((a, b) => b[1].spawn.count - a[1].spawn.count);
          for (const [n, d] of big) ops.push({ op: 'set', path: 'types.' + n + '.spawn', value: Object.assign({}, d.spawn, { count: Math.max(40, Math.round(d.spawn.count / 3)) }) });
          for (const [n, d] of Object.entries(spec.types)) if ((d.behaviors || []).some((b) => b.type === 'spawner' && b.what === n)) ops.push({ op: 'set', path: 'types.' + n + '.behaviors', value: d.behaviors.map((b) => (b.type === 'spawner' ? Object.assign({}, b, { max: Math.min(b.max || 60, 40), every: Math.max(b.every || 4, 5) }) : b)) });
          why.push('**' + f.name + '** failed: ' + f.detail + '. That will tank the frame rate, so I\'m reining in the spawn counts.');
          break;
        }
        case 'spawn': {
          ops.push({ op: 'set', path: 'level.seed', value: (spec.level.seed || 1) + 17 });
          why.push('The player spawned inside a wall (' + f.detail + '). The level generator got unlucky with this seed; rerolling it.');
          break;
        }
        case 'spawnkill': {
          const hz = (spec.level.hazards || []).length;
          if (hz) ops.push({ op: 'set', path: 'level.seed', value: (spec.level.seed || 1) + 31 });
          for (const [n, d] of Object.entries(spec.types)) if ((d.team === 'enemy' || d.role === 'enemy' || d.role === 'hazard') && d.spawn && d.spawn.at && !['edges', 'top', 'sky'].includes(d.spawn.at) && !d.static) ops.push({ op: 'set', path: 'types.' + n + '.spawn', value: Object.assign({}, d.spawn, { at: 'edges' }) });
          if (spec.player && (spec.player.hp || 5) < 3) ops.push({ op: 'set', path: 'player.hp', value: 3 });
          why.push('The player died ' + f.detail.replace('player died at t=', 'just ') + ' into the round without moving. Moving hostile spawns to the edges' + (hz ? ' and rerolling hazards' : '') + ' so nobody gets ambushed at spawn.');
          break;
        }
        case 'instawin': {
          for (const r of spec.rules) {
            if (!r.then.some((a) => a.type === 'win')) continue;
            if (r.when.type === 'onCleared' && spec.types[r.when.of] && !(spec.types[r.when.of].spawn || {}).count) ops.push({ op: 'set', path: 'types.' + r.when.of + '.spawn', value: Object.assign({}, spec.types[r.when.of].spawn || { at: 'random' }, { count: 10 }) });
            if (r.when.type === 'onScore') ops.push({ op: 'setRule', id: r.id, rule: Object.assign({}, r, { when: Object.assign({}, r.when, { atLeast: Math.max(50, (r.when.atLeast || 0) * 4) }) }) });
            if (r.when.type === 'onStart' || r.when.type === 'onAfter' && r.when.seconds < 2) ops.push({ op: 'setRule', id: r.id, rule: Object.assign({}, r, { when: { type: 'onAfter', seconds: 30 } }) });
          }
          why.push('The game was won before the player did anything (the win condition was already true at the start). Fixing the condition.');
          break;
        }
        case 'refs': {
          const missing = /unknown: (.*)$/.exec(f.detail);
          if (missing) for (const name of missing[1].split(', ')) {
            const e = VC.Lex.noun(name);
            ops.push({ op: 'set', path: 'types.' + name, value: { glyph: e && e.glyph ? e.glyph : undefined, shape: e && e.glyph ? undefined : 'blob', label: e ? undefined : U.human(name), role: e ? e.role : 'critter', color: (e && e.c) || U.colorFromString(name), size: (e && e.s) || 26, spawn: { count: 0, at: 'random' }, behaviors: [{ type: 'wander' }] } });
          }
          why.push('A rule references something that doesn\'t exist (' + f.detail + '). Defining it so the reference resolves.');
          break;
        }
        case 'ranges': {
          if (bug && !bug.resolved && ['giant', 'speed', 'invisible'].includes(bug.kind)) { ops.push(...bug.fixOps); fixedBug = true; why.push('Out-of-range value: ' + f.detail + '. That one\'s my typo. Fixing.'); break; }
          for (const [n, d] of Object.entries(spec.types)) {
            if (d.size > 420) ops.push({ op: 'set', path: 'types.' + n + '.size', value: 300 });
            if (d.speed > 2400) ops.push({ op: 'set', path: 'types.' + n + '.speed', value: 900 });
            if (d.alpha != null && d.alpha < 0.03) ops.push({ op: 'set', path: 'types.' + n + '.alpha', value: 0.15 });
            if (d.spawn && d.spawn.count > 300) ops.push({ op: 'set', path: 'types.' + n + '.spawn.count', value: 200 });
          }
          why.push('Some values are out of range (' + f.detail + '). Clamping them.');
          break;
        }
        case 'syntax': {
          const file = (/^([^:]+)/.exec(f.detail) || [])[1];
          if (file && app.project.overrides && app.project.overrides[file]) { why.push('`' + file + '` doesn\'t compile (' + f.detail + '). Restoring the last working version of that file.'); return { ops: [], explain: why.join(' '), revertOverride: file }; }
          break;
        }
        case 'crash': case 'nan': {
          why.push('The simulation crashed (' + f.detail + '). Rolling this change back to be safe.');
          const prev = app.project.checkpoints.find((c) => c.id === app.project.head);
          if (prev) ops.push({ op: 'set', path: 'types', value: prev.spec.types }, { op: 'set', path: 'rules', value: prev.spec.rules }, { op: 'set', path: 'player', value: prev.spec.player });
          break;
        }
        default: break;
      }
    }
    return { ops, explain: why.join(' ') || 'Something\'s off. Adjusting.', fixedBug };
  };

  // ------------------------------------------------------------------ bugs
  A.maybeBug = function (plan, p, model, r) {
    if (p.turns < 3 || !model.bug || r() > model.bug) return null;
    const S = plan.spec;
    const fresh = plan.notes.filter((n) => n.k === 'type-new' && S.types[n.name] && !S.types[n.name].projectile).map((n) => n.name);
    const cands = [];
    for (const n of fresh) {
      const d = S.types[n];
      if ((d.behaviors || []).some((b) => b.type === 'chase' && b.target === 'player')) cands.push({ kind: 'flee', type: n, desc: 'I wrote `flee("player")` instead of `chase("player")` in `src/entities/' + n + '.js`, so the ' + U.plural(U.human(n), 2) + ' run away from you' });
      if (d.size) cands.push({ kind: 'giant', type: n, desc: 'I typed `size: ' + d.size * 8 + '` instead of `' + d.size + '` for the ' + U.human(n) });
      if (d.speed && d.speed > 30) cands.push({ kind: 'speed', type: n, desc: 'a stray zero made the ' + U.plural(U.human(n), 2) + ' ten times too fast' });
      if (d.role !== 'collectible') cands.push({ kind: 'invisible', type: n, desc: 'I set `alpha: 0.02` on the ' + U.human(n) + ', which makes it nearly invisible' });
      if (d.spawn && d.spawn.count >= 3 && d.spawn.count <= 20) cands.push({ kind: 'count', type: n, desc: 'the ' + U.human(n) + ' spawn count came out 40× too high' });
      const cr = S.rules.find((x) => x.when.type === 'onCollide' && x.when.b === n && x.then.some((a) => a.type === 'addScore' && a.amount > 0));
      if (cr) cands.push({ kind: 'negscore', type: n, rule: cr.id, desc: 'I flipped a sign: collecting a ' + U.human(n) + ' subtracts points instead of adding them' });
    }
    if (!cands.length) return null;
    const c = U.pick(cands, r);
    const d = S.types[c.type];
    const fixOps = [];
    switch (c.kind) {
      case 'flee': fixOps.push({ op: 'set', path: 'types.' + c.type + '.behaviors', value: U.clone(d.behaviors) }); d.behaviors = d.behaviors.map((b) => (b.type === 'chase' && b.target === 'player' ? { type: 'flee', from: 'player' } : b)); break;
      case 'giant': fixOps.push({ op: 'set', path: 'types.' + c.type + '.size', value: d.size }); d.size = Math.min(400, d.size * 8); break;
      case 'speed': fixOps.push({ op: 'set', path: 'types.' + c.type + '.speed', value: d.speed }); d.speed = Math.min(2000, d.speed * 10); break;
      case 'invisible': fixOps.push(d.alpha == null ? { op: 'del', path: 'types.' + c.type + '.alpha' } : { op: 'set', path: 'types.' + c.type + '.alpha', value: d.alpha }); d.alpha = 0.02; break;
      case 'count': fixOps.push({ op: 'set', path: 'types.' + c.type + '.spawn', value: U.clone(d.spawn) }); d.spawn = Object.assign({}, d.spawn, { count: d.spawn.count * 40 }); break;
      case 'negscore': { const rule = S.rules.find((x) => x.id === c.rule); fixOps.push({ op: 'setRule', id: rule.id, rule: U.clone(rule) }); rule.then = rule.then.map((a) => (a.type === 'addScore' ? Object.assign({}, a, { amount: -a.amount }) : a)); break; }
      default: break;
    }
    return { id: U.uid('bug'), kind: c.kind, type: c.type, desc: c.desc, fixOps, resolved: false, turn: p.turns };
  };

  A.keepBug = async function (r) {
    const p = App().project;
    const b = [...p.bugs].reverse().find((x) => !x.resolved);
    if (b) { b.resolved = true; b.kept = true; VC.Ach.unlock('feature'); await A.say(U.pick(['Officially a feature now. I\'ve documented it in the README as "intended behavior."', 'Keeping it. Some of the best mechanics started as typos.', 'Noted: not a bug, a design decision.'], r)); }
    else await A.say('Happy to leave things as they are.');
    A.suggest(r);
  };

  A.fix = async function (text, r) {
    const app = App(), p = app.project;
    // 1. a pending error from a bad hand edit or a crashing mod
    if (p.pendingError) {
      const err = p.pendingError;
      await A.think('There\'s an error in `' + (err.file || 'the project') + '`' + (err.line ? ' at line ' + err.line : '') + ': "' + err.message + '". ' + (err.file === 'src/mods.js' ? 'That\'s custom code. The safest fix is to disable the hook that throws and leave the rest of the file intact.' : 'That file was edited by hand. I\'ll look at the line, and if I can\'t repair it confidently I\'ll restore the last version that compiled.'));
      const m = A.msg({ t: 'tool', name: 'Read', arg: err.file || 'src', status: 'run' });
      await A.wait(250); m.status = 'ok'; m.res = 'Read <b>' + ((app.files()[err.file] || '').split('\n').length) + '</b> lines'; A.upd(m);
      if (err.file === 'src/mods.js' && err.runtime) {
        const before = app.files()['src/mods.js'];
        const fixed = '// Vibe disabled this mod after it threw: ' + err.message.replace(/\n/g, ' ') + '\n/*\n' + before.replace(/\*\//g, '* /') + '\n*/\n';
        const next = Object.assign(U.clone(p.spec), { mods: fixed });
        const diff = DSL.diff(before, fixed);
        const tm = A.msg({ t: 'tool', name: 'Update', arg: 'src/mods.js', status: 'ok', res: 'Commented out the mod', body: { kind: 'code', path: 'src/mods.js', lines: DSL.hunks(diff, 1), limit: 10 } });
        void tm;
        const ov = Object.assign({}, p.overrides); delete ov['src/mods.js'];
        app.applySpec(next, { overrides: ov, hmr: true, path: 'src/mods.js' });
      } else if (err.file) {
        const ov = Object.assign({}, p.overrides);
        const broken = err.draft || ov[err.file] || '';
        delete ov[err.file];
        const good = DSL.generateFiles(p.spec, p)[err.file] || '';
        const diff = DSL.diff(broken, good);
        A.msg({ t: 'tool', name: 'Update', arg: err.file, status: 'ok', res: 'Restored the last working version', body: { kind: 'code', path: err.file, lines: DSL.hunks(diff, 1), limit: 12 } });
        app.applySpec(p.spec, { overrides: ov, hmr: true, path: err.file });
      }
      p.pendingError = null;
      VC.UI.showError(null);
      app.game.err = null;
      await A.runTests('vibe test');
      VC.Ach.unlock('bugfix');
      await A.say('Fixed. ' + (err.line ? 'Line ' + err.line + ' was the problem: ' : '') + err.message + (err.file === 'src/mods.js' ? '\n\nI commented the mod out instead of deleting it, so your code is still there.' : '\n\nYour edit to `' + err.file + '` is reverted. The bracket/typo is shown in the diff above if you want to try again.'));
      app.commit('fix: ' + (err.file || 'error'), { msgIndex: p.messages.length - 1 });
      return A.suggest(r);
    }
    // 2. a known bug of mine
    const bug = [...p.bugs].reverse().find((b) => !b.resolved);
    if (bug) {
      await A.think('Re-reading my last few changes. ' + (bug.kind === 'flee' ? 'In `src/entities/' + bug.type + '.js` the behavior says `flee`, not `chase`. That\'s backwards.' : 'In `src/entities/' + bug.type + '.js` there\'s a value that doesn\'t match what I meant to write.') + ' Found it.');
      const before = U.clone(p.spec);
      const next = Spec.apply(p.spec, bug.fixOps);
      const { changes } = A.computeFiles(before, next, p);
      await A.say('Found it: ' + bug.desc + '. Sorry about that.');
      for (const ch of changes.filter((c) => c.path !== 'README.md')) {
        const diff = DSL.diff(ch.before || '', ch.after || '');
        const st = DSL.diffStats(diff);
        const m = A.msg({ t: 'tool', name: 'Update', arg: ch.path, status: 'run', body: { kind: 'code', path: ch.path, lines: DSL.hunks(diff, 2), limit: 12, live: true } });
        await A.wait(350);
        m.status = 'ok'; m.body.live = false; m.res = 'Updated <b>' + U.esc(ch.path) + '</b> with <span class="add">' + st.add + '</span> and <span class="del">' + st.del + '</span>'; A.upd(m);
      }
      app.applySpec(next, { hmr: true, path: 'src/entities/' + bug.type + '.js' });
      bug.resolved = true;
      VC.Ach.unlock('bugfix');
      await A.runTests('vibe test');
      app.commit('fix: ' + bug.kind + ' bug in ' + bug.type, { msgIndex: p.messages.length - 1 });
      await A.say(U.pick(['Fixed. That one\'s on me.', 'Fixed, and added it to my list of things to double-check.', 'Fixed. Good catch.'], r));
      return A.suggest(r);
    }
    // 3. tests
    await A.think('No known bugs on my side. Running the test suite to see if anything is actually broken, then I\'ll look at what they described.');
    const res = await A.runTests('vibe test');
    if (res.failed.length) { await A.autoFix(res.failed, { spec: p.spec, notes: [] }, null); app.commit('fix: failing tests', { msgIndex: p.messages.length - 1 }); return A.suggest(r); }
    // 4. treat the complaint as a change request
    const stripped = text.replace(/\b(?:fix (?:it|this|that)|please|it is broken|broken|bug|debug)\b/g, '').replace(/^[\s,:-]+|[\s,:-]+$/g, '');
    if (stripped.length > 6) {
      const parsed = VC.Interp.parse(stripped, { spec: p.spec, focus: p.memory.focus });
      const plan = VC.Planner.plan(parsed, p.spec, { memory: p.memory, focus: p.memory.focus });
      if (plan.kind === 'build') { await A.say('Tests pass, so it\'s not a crash. Going by your description, here\'s the change I think you want:'); return A.build(plan, stripped, { msgIndex: p.messages.length - 1 }, r); }
    }
    await A.say('All ' + res.results.length + ' tests pass and I don\'t see anything broken. What\'s going wrong? Describe what you expected vs what happens, for example "the zombies should chase me but they run away".');
  };

  // ------------------------------------------------------------------ undo / reset / answers
  A.undo = async function (steps) {
    const app = App(), p = app.project;
    const i = p.checkpoints.findIndex((c) => c.id === p.head);
    const target = p.checkpoints[Math.max(0, i - steps)];
    if (i <= 0 || !target) { await A.say('Nothing to undo. This is the first version.'); return; }
    const m = A.msg({ t: 'tool', name: 'Bash', arg: 'git checkout ' + target.hash + ' -- .', status: 'run' });
    await A.wait(400);
    app.restoreCheckpoint(target.id, { silent: true });
    m.status = 'ok'; m.res = 'Restored <b>' + U.esc(target.hash) + '</b> · ' + U.esc(target.label); A.upd(m);
    if (VC.Ach.bump('undo:' + p.id) >= 3) VC.Ach.unlock('undo3');
    await A.say(U.pick(['Reverted. ', 'Rolled back. ', 'Undone. '], U.random) + 'We\'re back at “' + target.label + '”.' + (i - steps > 0 ? ' Say "undo" again to go further back, or use /rewind to jump anywhere.' : ''));
  };
  A.reset = async function () {
    const app = App();
    VC.UI.spinner.stop();
    const ans = await VC.UI.choose('Delete everything in this project?', 'You can still restore it from the History tab.', [{ label: 'Yes, start from nothing', value: 'yes' }, { label: 'No, keep it', value: 'no', esc: true }]);
    if (ans !== 'yes') { await A.say('Kept everything.'); return; }
    VC.UI.spinner.start(N.verb());
    const m = A.msg({ t: 'tool', name: 'Bash', arg: 'rm -rf src/entities && git commit -am "start over"', status: 'run' });
    await A.wait(500);
    const empty = Spec.empty();
    app.applySpec(empty, { overrides: {}, hmr: true, path: 'project' });
    m.status = 'ok'; m.res = 'Project reset'; A.upd(m);
    VC.Ach.unlock('minimalist');
    app.commit('start over', { msgIndex: app.project.messages.length - 1 });
    await A.say('Clean slate. The void is back. What should exist first?');
    A.suggest();
  };
  A.answer = async function (q, r) {
    const app = App(), p = app.project;
    const t = q.toLowerCase();
    const fileQ = /\b(rules\.js|game\.config\.js|player\.js|mods\.js|main\.js|readme|src\/entities\/\w+\.js|\w+\.js)\b/.exec(t);
    if (fileQ || /\b(?:explain|how does|what does)\b.*\b(?:code|file|rules|config)\b/.test(t)) {
      const f = fileQ ? Object.keys(app.files()).find((x) => x.endsWith(fileQ[1]) || x.toLowerCase().includes(fileQ[1])) : 'src/rules.js';
      if (f) { const m = A.msg({ t: 'tool', name: 'Read', arg: f, status: 'run' }); await A.wait(250); m.status = 'ok'; m.res = 'Read <b>' + app.files()[f].split('\n').length + '</b> lines'; A.upd(m); }
    }
    await A.say(N.answer(q, p.spec, { game: app.game, bugs: p.bugs }));
    A.suggest(r);
  };

  VC.Agent = A;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
