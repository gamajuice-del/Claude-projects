/* VibeCode — app shell: projects, persistence, checkpoints, wiring between UI, agent and engine. */
(function (VC) {
  'use strict';
  const U = VC.U, DSL = VC.DSL, Spec = VC.Spec, UI = VC.UI, A = VC.Agent;
  const KEY_IDX = 'vibecode.index.v1', KEY_P = 'vibecode.p.', KEY_SET = 'vibecode.settings.v1';
  const COLORS = ['#d97757', '#9dc47c', '#8eb5d9', '#c4a3dc', '#e3bf72', '#80c4b9', '#e48f7b', '#b9a7f0'];
  const App = { project: null, live: null, lastEsc: 0 };

  App.settings = Object.assign({ mode: 'default', model: 'vibe-1', speed: 'normal', sound: true, split: '40%' }, U.store.get(KEY_SET, {}));
  App.saveSettings = () => U.store.set(KEY_SET, App.settings);
  App.index = () => U.store.get(KEY_IDX, []);

  // ------------------------------------------------------------------ boot
  App.init = function () {
    UI.init();
    VC.Term.init();
    UI.ev._msgs = () => (App.project ? App.project.messages : []);
    document.documentElement.style.setProperty('--split', App.settings.split || '40%');
    // engine
    const canvas = document.getElementById('game');
    const g = App.game = new VC.Engine({ canvas });
    g.mount(document.getElementById('stage'));
    g.onEffects = (fx) => UI.setStageFx(fx);
    g.load(Spec.empty(), { fresh: true });
    g.start();
    g.on('error', (err) => App.onGameError(err));
    g.on('log', (s) => VC.Term.log('[mod] ' + s, 'in'));
    g.on('win', () => { if (g.mode === 'play') VC.Term.log('[game] won in ' + g.time.toFixed(1) + 's · score ' + g.score, 'ok'); });
    g.on('lose', () => { if (g.mode === 'play') VC.Term.log('[game] game over · score ' + g.score, 'wa'); });
    VC.Ach.watch(g, () => App.project);
    VC.Ach.ev.on('unlock', (d) => { UI.toast({ title: 'Achievement unlocked', name: d.n, desc: d.d, icon: '✦' }); VC.Sound.ui('achievement'); UI.setCounts(VC.Ach.counts()); if (App.project && UI.ws && !UI.ws.hidden) App.pushMsg({ id: U.uid('m'), t: 'sys', kind: 'ach', text: '✦ Achievement unlocked: **' + d.n + '**' }); });
    VC.Ach.ev.on('challenge', (d) => { UI.toast({ title: 'Challenge complete', name: d.n, desc: d.d, icon: '◆', kind: 'info' }); VC.Sound.ui('achievement'); UI.setCounts(VC.Ach.counts()); });
    UI.setCounts(VC.Ach.counts());
    UI.setSound(App.settings.sound);
    VC.Sound.setMuted(!App.settings.sound);
    UI.setMode(App.settings.mode);
    App.refreshModel();
    // first gesture unlocks audio
    const unlock = () => { VC.Sound.init(); VC.Sound.setMuted(!App.settings.sound); };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    // resize
    const stage = document.getElementById('stage');
    const ro = new ResizeObserver(() => { const r = stage.getBoundingClientRect(); if (r.width > 2 && r.height > 2) g.resize(r.width, r.height); });
    ro.observe(stage);
    // status
    setInterval(() => { if (App.project && !UI.ws.hidden) { const s = g.status(); s.err = !!g.err; UI.setStatus(Object.assign(s, { state: g.state === 'empty' ? 'empty project' : g.mode === 'play' ? 'playing' : g.mode === 'paused' ? 'paused' : 'autopilot' })); } }, 400);
    App.wire();
    App.renderChats();
    const list = App.index();
    UI.setHero(true, list[0]);
    // live model?
    VC.Live.detect().then((s) => { App.live = s; App.refreshModel(); if (s && App.project) { const w = App.project.messages.find((m) => m.t === 'welcome'); if (w && !w.live) { w.live = true; UI.updateMsg(w); } } });
  };

  App.wire = function () {
    const ev = UI.ev;
    ev.on('newChat', () => App.newChat());
    ev.on('openChat', (id) => App.openChat(id));
    ev.on('deleteChat', (id) => App.deleteChat(id));
    ev.on('send', (t) => App.sendPrompt(t));
    ev.on('chip', (t) => App.sendPrompt(t));
    ev.on('slash', (c) => App.slash(c));
    ev.on('cycleMode', () => { const order = ['default', 'acceptEdits', 'plan']; App.setPermMode(order[(order.indexOf(App.settings.mode) + 1) % order.length]); VC.Sound.ui('toggle'); });
    ev.on('escape', (e) => App.onEscape(e));
    ev.on('stageClick', () => App.stageClick());
    ev.on('play', () => App.stageClick());
    ev.on('restart', () => { App.game.reset(); if (App.game.mode === 'paused') App.setMode('play'); });
    ev.on('pauseToggle', () => App.setMode(App.game.mode === 'paused' ? 'play' : 'paused'));
    ev.on('chatFocus', () => { if (App.game.mode === 'play') App.setMode('paused'); });
    ev.on('resize', () => { const r = document.getElementById('stage').getBoundingClientRect(); if (r.width > 2) App.game.resize(r.width, r.height); });
    ev.on('splitDone', (v) => { App.settings.split = String(v).trim(); App.saveSettings(); });
    ev.on('openFile', (p) => App.openFile(p));
    ev.on('saveFile', (p, t) => App.saveFile(p, t));
    ev.on('filesOpen', () => App.refreshFiles(true));
    ev.on('historyOpen', () => App.refreshHistory());
    ev.on('restoreCheckpoint', (id) => App.restoreCheckpoint(id));
    ev.on('forkCheckpoint', (id) => App.forkCheckpoint(id));
    ev.on('term', (c) => VC.Term.run(c));
    ev.on('toggleSound', () => { App.settings.sound = !App.settings.sound; App.saveSettings(); VC.Sound.init(); VC.Sound.setMuted(!App.settings.sound); UI.setSound(App.settings.sound); });
    ev.on('dirty', () => App.save());
  };

  // ------------------------------------------------------------------ projects
  App.newProject = function (spec, name, extraMsgs) {
    const n = App.index().length + 1;
    const p = {
      id: U.uid('p'), name: name || 'untitled-' + n, created: Date.now(), updated: Date.now(), color: COLORS[n % COLORS.length],
      spec: Spec.normalize(spec || Spec.empty()), overrides: {}, messages: [], checkpoints: [], head: null,
      memory: { focus: [], twists: [], suggested: [], levels: [] }, bugs: [], turns: 0, stats: { deaths: 0, tokensIn: 0, tokensOut: 0 }, lastChanged: {}, fileMarks: {}, pendingError: null,
    };
    p.messages.push({ id: U.uid('m'), t: 'welcome', cwd: '~/games/' + slugOf(p.name), live: !!App.live });
    if (extraMsgs) p.messages.push(...extraMsgs);
    const cp = { id: U.uid('c'), hash: U.shortHash('init' + p.id), label: spec ? 'fork of ' + name : 'initial commit (empty project)', time: Date.now(), spec: U.clone(p.spec), overrides: {}, msgIndex: p.messages.length, add: 0, del: 0, by: 'vibe' };
    p.checkpoints.push(cp); p.head = cp.id;
    return p;
  };
  App.newChat = function () {
    if (A.busy) A.interrupt();
    const p = App.newProject();
    App.project = p;
    App.saveNow();
    App.openChat(p.id, true);
    VC.Sound.ui('boot');
  };
  App.openChat = function (id, fresh) {
    if (A.busy && App.project && App.project.id !== id) A.interrupt();
    let p = App.project && App.project.id === id ? App.project : U.store.get(KEY_P + id, null);
    if (!p) { App.renderChats(); return; }
    p.memory = p.memory || {}; p.bugs = p.bugs || []; p.lastChanged = p.lastChanged || {}; p.fileMarks = p.fileMarks || {}; p.overrides = p.overrides || {}; p.stats = p.stats || {};
    p.spec = Spec.normalize(p.spec);
    App.project = p;
    UI.setHero(false);
    UI.renderAll(p.messages);
    UI.setCwd(slugOf(p.name));
    App.game.load(p.spec, { fresh: true });
    App.setMode('demo');
    UI.showError(null);
    App.refreshFiles(); App.refreshHistory(); App.renderChats();
    const lastSug = [...p.messages].reverse().find((m) => m.t === 'suggest');
    UI.placeholder = Spec.isEmpty(p.spec) ? 'Try "a platformer where I’m a cat collecting fish"' : 'Describe a change…';
    UI.setGhost(lastSug && lastSug.items ? lastSug.items[0] : Spec.isEmpty(p.spec) ? 'a platformer where I’m a cat collecting fish' : '');
    App.updateCtx();
    setTimeout(() => { UI.input.focus(); UI.ev.emit('resize'); }, fresh ? 60 : 10);
  };
  App.deleteChat = async function (id) {
    const list = App.index();
    const it = list.find((x) => x.id === id);
    if (!it) return;
    if (!App.confirmDelete || App.confirmDelete !== id) { App.confirmDelete = id; UI.toast({ title: 'Delete chat?', name: 'Click ✕ again to delete “' + it.name + '”', icon: '✕', kind: 'info', ms: 2600 }); setTimeout(() => { if (App.confirmDelete === id) App.confirmDelete = null; }, 2600); return; }
    App.confirmDelete = null;
    U.store.set(KEY_IDX, list.filter((x) => x.id !== id));
    U.store.remove(KEY_P + id);
    if (App.project && App.project.id === id) { App.project = null; App.game.load(Spec.empty(), { fresh: true }); UI.setHero(true, App.index()[0]); }
    App.renderChats();
  };
  App.renderChats = function () { UI.renderChats(App.index().sort((a, b) => b.updated - a.updated), App.project && App.project.id); };
  App.slug = () => slugOf(App.project ? App.project.name : 'untitled');
  function slugOf(n) { return U.ident(n || 'untitled').replace(/_/g, '-').slice(0, 32) || 'untitled'; }

  let saveT = null;
  App.save = function () { clearTimeout(saveT); saveT = setTimeout(App.saveNow, 450); };
  App.saveNow = function () {
    const p = App.project;
    if (!p) return;
    p.updated = Date.now();
    const title = p.spec.meta.title;
    const firstUser = p.messages.find((m) => m.t === 'user');
    p.name = title || (firstUser ? firstUser.text.slice(0, 40) : p.name);
    let ok = U.store.set(KEY_P + p.id, p);
    if (!ok) {
      // storage pressure: drop old checkpoints, then old messages
      if (p.checkpoints.length > 12) { p.checkpoints = p.checkpoints.slice(0, 1).concat(p.checkpoints.slice(-11)); ok = U.store.set(KEY_P + p.id, p); }
      if (!ok && p.messages.length > 80) { p.messages = p.messages.slice(0, 1).concat(p.messages.slice(-60)); ok = U.store.set(KEY_P + p.id, p); }
      if (!ok && !App.warnedStorage) { App.warnedStorage = true; UI.toast({ title: 'Storage is full', name: 'Older checkpoints were trimmed', icon: '!', kind: 'info' }); }
    }
    const list = App.index().filter((x) => x.id !== p.id);
    list.unshift({ id: p.id, name: p.name, updated: p.updated, color: p.color });
    U.store.set(KEY_IDX, list);
    App.renderChats();
    UI.setCwd(slugOf(p.name));
  };

  // ------------------------------------------------------------------ transcript
  App.pushMsg = function (m) {
    const p = App.project; if (!p) return m;
    p.messages.push(m);
    UI.addMsg(m);
    App.updateCtx();
    App.save();
    return m;
  };
  App.updMsg = function (m) { UI.updateMsg(m); };
  App.updateCtx = function () {
    const p = App.project; if (!p) return;
    let chars = 0; for (const m of p.messages) chars += (m.text || '').length + (m.body && m.body.lines ? m.body.lines.length * 30 : 0);
    UI.setCtx(100 - chars / 2200);
  };
  App.onBusy = function (b) {
    UI.placeholder = b ? 'Vibe is working… (Enter queues another prompt, Esc interrupts)' : 'Describe a change…';
    if (b) UI.ghostText = '';
    UI.updateGhost();
    if (!b) UI.scroll(true);
  };
  App.sendPrompt = function (t) {
    if (!App.project) App.newChat();
    UI.setGhost('');
    if (App.game.mode === 'play' && window.matchMedia('(max-width: 860px)').matches) App.setMode('paused');
    A.submit(t);
  };

  // ------------------------------------------------------------------ spec & files
  App.files = function () {
    const p = App.project; if (!p) return {};
    const f = DSL.generateFiles(p.spec, p);
    for (const [k, v] of Object.entries(p.overrides || {})) f[k] = v;
    return f;
  };
  App.applySpec = function (spec, opts) {
    opts = opts || {};
    const p = App.project;
    p.spec = Spec.normalize(spec);
    if (opts.overrides) p.overrides = opts.overrides;
    for (const k of Object.keys(p.overrides || {})) if (DSL.fileKind(k) === 'entity' && !p.spec.types[k.slice(13, -3)]) delete p.overrides[k];
    App.game.load(p.spec);
    if (App.game.err && App.game.err.file === 'src/mods.js') App.onGameError(App.game.err);
    else if (!p.pendingError) UI.showError(null);
    if (opts.hmr && !opts.quiet) { UI.hmr(opts.path || 'project'); VC.Term.log('[hmr] updated ' + (opts.path || 'project'), 'dim'); }
    if (!opts.quiet) { UI.badge('files', Object.keys(p.fileMarks || {}).length || ''); App.refreshFiles(); }
    UI.setPlayState(App.game.mode, App.game.state === 'empty');
    UI.placeholder = 'Describe a change…';
    App.save();
  };
  App.directSet = function (path, value) {
    const p = App.project;
    const next = Spec.apply(p.spec, [{ op: 'set', path, value }]);
    App.applySpec(next, { hmr: true, path: 'game.config.js' });
    App.commit('set ' + path, { by: 'you' });
  };
  App.removeTypeDirect = function (name) {
    const p = App.project;
    const next = Spec.apply(p.spec, [{ op: 'removeType', name }]);
    App.applySpec(next, { hmr: true, path: 'src/entities/' + name + '.js' });
    App.commit('rm src/entities/' + name + '.js', { by: 'you' });
  };

  App.commit = function (label, opts) {
    opts = opts || {};
    const p = App.project;
    const i = p.checkpoints.findIndex((c) => c.id === p.head);
    if (i >= 0 && i < p.checkpoints.length - 1) p.checkpoints = p.checkpoints.slice(0, i + 1);
    const cp = { id: U.uid('c'), hash: U.shortHash(label + Date.now()), label, time: Date.now(), spec: U.clone(p.spec), overrides: U.clone(p.overrides || {}), msgIndex: opts.msgIndex != null ? opts.msgIndex : p.messages.length, add: opts.add || 0, del: opts.del || 0, by: opts.by || (A.MODELS[App.settings.model] || {}).label || 'vibe' };
    p.checkpoints.push(cp);
    p.head = cp.id;
    if (p.checkpoints.length > 60) p.checkpoints = p.checkpoints.slice(0, 1).concat(p.checkpoints.slice(-59));
    UI.badge('history', '+1');
    App.refreshHistory();
    App.save();
    VC.Term.log('[git] ' + cp.hash + ' ' + label, 'dim');
    return cp;
  };
  App.restoreCheckpoint = function (id, opts) {
    opts = opts || {};
    const p = App.project;
    const c = p.checkpoints.find((x) => x.id === id);
    if (!c) return;
    p.spec = Spec.normalize(U.clone(c.spec));
    p.overrides = U.clone(c.overrides || {});
    p.head = c.id;
    p.pendingError = null;
    App.game.load(p.spec, { fresh: true });
    App.setMode('demo');
    UI.showError(null);
    if (!opts.silent) App.pushMsg({ id: U.uid('m'), t: 'sys', kind: 'ok', text: 'Restored checkpoint `' + c.hash + '` · ' + c.label });
    VC.Ach.unlock('time');
    App.refreshHistory(); App.refreshFiles();
    App.save();
  };
  App.forkCheckpoint = function (id) {
    const src = App.project;
    const c = src.checkpoints.find((x) => x.id === id);
    if (!c) return;
    const p = App.newProject(U.clone(c.spec), (src.name || 'game') + ' (fork)', [{ id: U.uid('m'), t: 'sys', kind: 'ok', text: 'Forked from **' + src.name + '** at `' + c.hash + '`' }]);
    App.project = p; App.saveNow(); App.openChat(p.id, true);
    VC.Ach.unlock('share');
  };
  App.rewind = async function () {
    const p = App.project;
    if (!p) return;
    const items = p.checkpoints.map((c, i) => ({ c, i })).filter((x) => x.i > 0).map((x) => ({ label: x.c.label, time: x.c.time, i: x.i }));
    if (!items.length) { UI.toast({ title: 'Rewind', name: 'Nothing to rewind yet', icon: '↺', kind: 'info', ms: 1800 }); return; }
    const pick = await UI.rewindMenu(items);
    if (!pick) return;
    const cp = p.checkpoints[pick.i], prev = p.checkpoints[pick.i - 1];
    p.spec = Spec.normalize(U.clone(prev.spec)); p.overrides = U.clone(prev.overrides || {});
    p.checkpoints = p.checkpoints.slice(0, pick.i);
    p.head = prev.id;
    p.messages = p.messages.slice(0, Math.max(1, cp.msgIndex));
    p.bugs = p.bugs.filter((b) => b.turn < p.turns);
    UI.renderAll(p.messages);
    App.game.load(p.spec, { fresh: true }); App.setMode('demo');
    UI.input.value = cp.label.replace(/…$/, ''); UI.autosize(); UI.input.focus();
    App.refreshHistory(); App.refreshFiles(); App.save();
    VC.Ach.unlock('time');
    UI.toast({ title: 'Rewound', name: 'Back to before “' + cp.label + '”', icon: '↺', kind: 'info', ms: 2200 });
  };

  App.refreshHistory = function () { if (App.project) UI.renderHistory(App.project.checkpoints, App.project.head); };
  App.refreshFiles = function (open) {
    if (!App.project) return;
    const files = App.files();
    UI.renderTree(files, UI.edPath, App.project.fileMarks || {});
    if (open && (!UI.edPath || !files[UI.edPath])) UI.edPath = files['src/rules.js'] ? 'src/rules.js' : 'game.config.js';
    if (UI.curTab === 'files' && UI.edPath) {
      const dirty = document.getElementById('code').value !== UI.edOrig;
      if (!dirty || open) UI.openEditor(UI.edPath, files[UI.edPath] || '', new Set(App.project.lastChanged[UI.edPath] || []), /^(?:src\/main\.js|package\.json)$/.test(UI.edPath));
      UI.renderTree(files, UI.edPath, App.project.fileMarks || {});
    }
  };
  App.openFile = function (path) {
    UI.tab('files');
    UI.edPath = path;
    App.project.fileMarks[path] && delete App.project.fileMarks[path];
    const files = App.files();
    UI.openEditor(path, files[path] || '', new Set(App.project.lastChanged[path] || []), /^(?:src\/main\.js|package\.json)$/.test(path));
    UI.renderTree(files, path, App.project.fileMarks || {});
  };
  App.saveFile = function (path, text) {
    const p = App.project;
    const kind = DSL.fileKind(path);
    if (kind === 'main' || kind === 'json') { UI.editorError('This file is generated and read-only.'); return; }
    const before = App.files()[path] || '';
    if (kind === 'readme') { p.overrides[path] = text; UI.editorSaved(text); App.save(); return; }
    let next;
    try {
      next = DSL.evaluate(path, text, p.spec);
    } catch (e) {
      const msg = (e.kind || 'Error') + (e.line ? ' (line ' + e.line + ')' : '') + ': ' + e.message;
      UI.editorError(msg);
      p.pendingError = { file: path, line: e.line, message: e.message, kind: e.kind || 'Error', draft: text };
      UI.showError({ kind: e.kind || 'Error', file: path, line: e.line, message: e.message, stale: true, snippet: snippet(text, e.line) }, () => App.sendPrompt('fix it'));
      VC.Term.log('[vibe] ' + msg + ' in ' + path, 'er');
      App.pushMsg({ id: U.uid('m'), t: 'sys', kind: 'err', text: '✗ `' + path + (e.line ? ':' + e.line : '') + '` ' + msg + ' · the previous version is still running. Say "fix it" if you want help.' });
      VC.Ach.unlock('crash');
      VC.Sound.ui('error');
      return;
    }
    let p2 = path;
    const ov = Object.assign({}, p.overrides);
    if (next.__renamed) { delete ov[path]; p2 = 'src/entities/' + next.__renamed.to + '.js'; delete next.__renamed; }
    ov[p2] = text;
    p.pendingError = null;
    App.applySpec(next, { overrides: ov, hmr: true, path: p2 });
    UI.edPath = p2;
    UI.editorSaved(text);
    const st = DSL.diffStats(DSL.diff(before, text));
    App.commit('edit ' + p2 + ' by hand', { by: 'you', add: st.add, del: st.del });
    App.pushMsg({ id: U.uid('m'), t: 'sys', kind: 'ok', text: 'You edited `' + p2 + '` (+' + st.add + ' −' + st.del + ') · hot-reloaded' });
    VC.Ach.unlock('hand_edit');
    if (kind === 'mods') VC.Term.log('[mods] compiled · hooks: ' + Object.keys(App.game.modsFns || {}).filter((k) => typeof App.game.modsFns[k] === 'function').join(', '), 'ok');
    App.refreshFiles();
  };
  function snippet(text, line) {
    if (!line) return '';
    const ls = text.split('\n');
    const out = [];
    for (let i = Math.max(1, line - 2); i <= Math.min(ls.length, line + 2); i++) out.push((i === line ? '> ' : '  ') + String(i).padStart(3) + ' | ' + ls[i - 1]);
    return out.join('\n');
  }
  App.onGameError = function (err) {
    const p = App.project; if (!p) return;
    p.pendingError = { file: err.file || null, message: err.message, kind: 'Runtime error', runtime: true, line: err.line };
    UI.showError({ kind: 'Runtime error', file: err.file, line: err.line, message: err.message, stale: !!err.file }, () => App.sendPrompt('fix it'), () => { if (err.file === 'src/mods.js') { App.game.err = null; } });
    VC.Term.log('[runtime] ' + err.message + (err.file ? ' (' + err.file + ')' : ''), 'er');
    VC.Ach.unlock('crash');
    if (err.file === 'src/mods.js') App.game.err = null; // keep simulating without the mod
  };

  // ------------------------------------------------------------------ modes & focus
  App.setPermMode = function (m) { App.settings.mode = m; App.saveSettings(); UI.setMode(m); };
  App.setModel = function (m) { App.settings.model = m; App.saveSettings(); App.refreshModel(); };
  App.refreshModel = function () {
    const m = A.MODELS[App.settings.model] || A.MODELS['vibe-1'];
    if (m.live && !App.live) { UI.setModel('vibe-1', false); return; }
    UI.setModel(m.label, !!m.live);
  };
  App.setMode = function (m) {
    const g = App.game;
    g.setMode(m);
    UI.setPlayState(m, g.state === 'empty');
    if (m === 'play') { UI.input.blur(); document.getElementById('game').focus({ preventScroll: true }); }
  };
  App.stageClick = function () {
    const g = App.game;
    if (!App.project || g.state === 'empty') return;
    VC.Sound.init();
    if (g.mode === 'demo') App.setMode('play');
    else if (g.mode === 'paused') App.setMode('play');
  };
  App.onEscape = function (e) {
    if (A.busy) { A.interrupt(); e.preventDefault(); return; }
    if (App.game.mode === 'play') { App.setMode('paused'); UI.input.focus(); e.preventDefault(); return; }
    if (!UI.input.value) {
      const now = performance.now();
      if (now - App.lastEsc < 650) { App.lastEsc = 0; App.rewind(); }
      else App.lastEsc = now;
    }
  };

  // ------------------------------------------------------------------ slash commands
  App.slash = async function (raw) {
    const [cmd, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(' ');
    if (!App.project && cmd !== '/new') App.newChat();
    const echo = () => App.pushMsg({ id: U.uid('m'), t: 'user', text: raw });
    const out = (text) => App.pushMsg({ id: U.uid('m'), t: 'assistant', text });
    const sys = (text, kind) => App.pushMsg({ id: U.uid('m'), t: 'sys', text, kind });
    const p = App.project;
    switch (cmd) {
      case '/help': echo(); out(VC.Narrator.answer('help', p.spec, {})); break;
      case '/shortcuts': sys('**Enter** send · **Shift+Enter** newline · **Shift+Tab** permission mode · **Tab** accept suggestion · **↑** previous prompt · **Esc** interrupt / leave game · **Esc Esc** rewind · **Ctrl+O** expand details · **Alt+N** new chat · in game: **R** restart'); break;
      case '/new': App.newChat(); break;
      case '/undo': App.sendPrompt('undo'); break;
      case '/rewind': App.rewind(); break;
      case '/plan': App.setPermMode(App.settings.mode === 'plan' ? 'default' : 'plan'); sys('Plan mode ' + (App.settings.mode === 'plan' ? 'on: Vibe will propose a plan before editing' : 'off')); break;
      case '/files': UI.tab('files'); break;
      case '/terminal': UI.tab('terminal'); break;
      case '/history': UI.tab('history'); break;
      case '/preview': UI.tab('preview'); break;
      case '/achievements': UI.showAchievements(); break;
      case '/challenges': UI.showAchievements(true); break;
      case '/model': {
        echo();
        const opts = Object.entries(A.MODELS).filter(([k, m]) => !m.live || App.live).map(([k, m]) => ({ label: m.label + (k === App.settings.model ? ' ✓' : ''), hint: m.desc, value: k }));
        if (!App.live) sys('The live model appears here when this page runs inside a Claude viewer that allows it.');
        const v = await UI.choose('Select model', 'Switch between local Vibe variants' + (App.live ? ' and the live model' : ''), opts.concat([{ label: 'Cancel', value: null, esc: true }]), { defaultIndex: Math.max(0, opts.findIndex((o) => o.value === App.settings.model)) });
        if (v) { App.setModel(v); sys('Set model to **' + A.MODELS[v].label + '**'); if (v === 'vibe-chaos') VC.Ach.unlock('chaos'); }
        break;
      }
      case '/status': {
        echo();
        const s = p.spec, f = App.files();
        out(['**' + (s.meta.title || p.name) + '**', '', '- model: `' + (A.MODELS[App.settings.model] || {}).label + '`' + (App.live ? ' (live available)' : ''), '- mode: `' + App.settings.mode + '`', '- physics: `' + s.world.physics + '`, level: `' + s.level.type + '`', '- ' + Object.keys(s.types).length + ' entity types, ' + s.rules.length + ' rules, ' + Object.keys(f).length + ' files', '- ' + p.checkpoints.length + ' checkpoints, ' + p.turns + ' prompts', '- emoji sprites: ' + (App.game.render && App.game.render.emojiOK ? 'yes' : 'no (falling back to shapes)')].join('\n'));
        break;
      }
      case '/doctor': {
        echo();
        const r = VC.Tests.run(p.spec, App.files());
        const lines = [{ s: 'vibe doctor', cls: 'dim' }, { s: '' }];
        let storageOk = U.store.set('vibecode.probe', 1); U.store.remove('vibecode.probe');
        lines.push({ s: '  ' + (storageOk ? '✓' : '✗') + ' storage ' + (storageOk ? 'writable' : 'blocked (progress lives in memory only)'), cls: storageOk ? 'pass' : 'fail' });
        lines.push({ s: '  ' + (App.game.render && App.game.render.emojiOK ? '✓ emoji rendering' : '✗ emoji rendering unavailable, using shapes'), cls: App.game.render && App.game.render.emojiOK ? 'pass' : 'fail' });
        lines.push({ s: '  ' + (VC.Sound.ctx ? '✓ audio ready' : '· audio starts after your first click'), cls: VC.Sound.ctx ? 'pass' : 'dim' });
        lines.push({ s: '  ' + (App.live ? '✓ live model available' : '· live model not available here (local vibe models work)'), cls: App.live ? 'pass' : 'dim' });
        for (const x of r.results) lines.push({ s: '  ' + (x.pass ? '✓ ' : '✗ ') + x.name + '  ' + x.detail, cls: x.pass ? 'pass' : 'fail' });
        App.pushMsg({ id: U.uid('m'), t: 'tool', name: 'Bash', arg: 'vibe doctor', status: r.failed.length ? 'err' : 'ok', res: r.failed.length ? r.failed.length + ' problems' : 'everything looks healthy', body: { kind: 'bash', lines } });
        break;
      }
      case '/share': {
        echo();
        const code = 'VIBE1:' + U.toB64(JSON.stringify({ v: 1, name: p.name, spec: p.spec, overrides: p.overrides }));
        let copied = false;
        try { await navigator.clipboard.writeText(code); copied = true; } catch (e) { copied = false; }
        out((copied ? 'Copied a share code to your clipboard (' + Math.round(code.length / 1024) + ' kB).' : 'Here\'s your share code. Select and copy it:') + ' Anyone can paste it after `/import` to get their own fork of this game.\n\n```\n' + (copied ? code.slice(0, 160) + '…' : code) + '\n```');
        VC.Ach.unlock('share');
        break;
      }
      case '/import': {
        echo();
        const code = arg.trim();
        if (!code) { out('Paste a share code after `/import`, like `/import VIBE1:eyJ2Ijox…`'); break; }
        try {
          const data = JSON.parse(U.fromB64(code.replace(/^VIBE1:/, '')));
          const np = App.newProject(Spec.normalize(data.spec), (data.name || 'shared game') + ' (fork)', [{ id: U.uid('m'), t: 'sys', kind: 'ok', text: 'Imported **' + (data.name || 'a shared game') + '**. It\'s your fork now.' }]);
          np.overrides = data.overrides || {};
          App.project = np; App.saveNow(); App.openChat(np.id, true);
          VC.Ach.unlock('share');
        } catch (e) { out('That share code didn\'t decode. Make sure you copied all of it.'); }
        break;
      }
      case '/export': {
        echo();
        const data = JSON.stringify({ v: 1, name: p.name, spec: p.spec, overrides: p.overrides, files: App.files() }, null, 2);
        const name = slugOf(p.name) + '.vibe.json';
        let done = false;
        try { if (window.claude && window.claude.use) { const d = await window.claude.use('downloads'); if (d) { await d.save({ filename: name, data }); done = true; } } } catch (e) { done = false; }
        if (!done) { try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); done = true; } catch (e) { done = false; } }
        out(done ? 'Exported `' + name + '`.' : 'Downloads are blocked here. Use `/share` to copy a share code instead.');
        break;
      }
      case '/title': if (arg) App.sendPrompt('call it "' + arg + '"'); else App.sendPrompt('give it a title'); break;
      case '/docs': echo(); out('The whole engine API, as the agent sees it:\n\n```\n' + DSL.reference() + '\n```'); break;
      case '/speed': {
        const order = ['normal', 'fast', 'instant'];
        App.settings.speed = order.includes(arg) ? arg : order[(order.indexOf(App.settings.speed) + 1) % 3];
        App.saveSettings(); sys('Streaming speed: **' + App.settings.speed + '**');
        break;
      }
      case '/sound': UI.ev.emit('toggleSound'); sys('Sound ' + (App.settings.sound ? 'on' : 'off')); break;
      case '/clear': p.messages = p.messages.filter((m) => m.t === 'welcome').slice(0, 1); UI.renderAll(p.messages); App.save(); break;
      case '/compact': {
        const keep = p.messages.slice(-4);
        p.messages = p.messages.filter((m) => m.t === 'welcome').slice(0, 1).concat([{ id: U.uid('m'), t: 'sys', text: 'Conversation compacted. Summary of the game so far:' }, { id: U.uid('m'), t: 'assistant', text: VC.Narrator.describeGame(p.spec) }], keep);
        UI.renderAll(p.messages); App.updateCtx(); App.save();
        break;
      }
      case '/cost': {
        echo();
        const s = p.stats;
        out('Total cost: **$0.00** (runs on vibes)\nTotal duration (API): ' + (p.turns * 4.2).toFixed(1) + 's\nTokens: ↑ ' + Math.round((s.tokensIn || 0) / 100) / 10 + 'k in, ↓ ' + Math.round((s.tokensOut || 0) / 100) / 10 + 'k out');
        break;
      }
      case '/init': {
        echo();
        const f = App.files()['README.md'];
        App.pushMsg({ id: U.uid('m'), t: 'tool', name: 'Write', arg: 'README.md', status: 'ok', res: 'Wrote <b>' + f.split('\n').length + '</b> lines to <b>README.md</b>', body: { kind: 'code', path: 'README.md', lines: f.replace(/\n$/, '').split('\n').map((s2, i) => ({ k: ' ', s: s2, n: i + 1 })), limit: 18 } });
        delete p.overrides['README.md']; App.save();
        break;
      }
      case '/reset': App.sendPrompt('start over'); break;
      case '/live': {
        if (!App.live) { echo(); out('The live model isn\'t available in this view.'); break; }
        const last = [...p.messages].reverse().find((m) => m.t === 'user' && !m.text.startsWith('/'));
        const prev = App.settings.model; App.settings.model = 'claude';
        A.submit(last ? last.text : 'surprise me');
        const t = setInterval(() => { if (!A.busy) { clearInterval(t); App.settings.model = prev; App.refreshModel(); } }, 500);
        break;
      }
      default: echo(); sys('Unknown command ' + cmd + '. Type / to see them all.', 'err');
    }
  };

  window.addEventListener('DOMContentLoaded', App.init);
  VC.App = App;
})(window.VC = window.VC || {});
