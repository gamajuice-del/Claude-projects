/* VibeCode — the Terminal tab: a tiny shell over the project. */
(function (VC) {
  'use strict';
  const U = VC.U;
  const T = { lines: [] };
  const $ = (s) => document.querySelector(s);

  T.init = function () { T.box = $('#term'); T.banner(); };
  T.banner = function () {
    T.log('vibe-engine 3.2.0 · dev server running · type `help`', 'dim');
  };
  T.log = function (text, cls) {
    if (!T.box) return;
    const d = document.createElement('div');
    d.className = 'ln' + (cls ? ' ' + cls : '');
    d.textContent = text;
    T.box.appendChild(d);
    while (T.box.childNodes.length > 600) T.box.removeChild(T.box.firstChild);
    T.box.scrollTop = T.box.scrollHeight;
  };
  T.html = function (html) { const d = document.createElement('div'); d.className = 'ln'; d.innerHTML = html; T.box.appendChild(d); T.box.scrollTop = T.box.scrollHeight; };
  T.clear = function () { if (T.box) T.box.innerHTML = ''; };

  const FORTUNES = ['It works on my machine.', 'There are two hard things: cache invalidation, naming things, and off-by-one errors.', 'Ship it Friday. What could go wrong?', 'The best code is the code you prompted.', 'A bug is just an unplanned feature.', 'Every game is a fork of an empty project.', 'Have you tried turning gravity off and on again?'];

  T.run = function (raw) {
    const App = VC.App, p = App.project;
    const cmd = String(raw || '').trim();
    T.html('<span class="p">$</span> ' + U.esc(cmd));
    if (!cmd) return;
    VC.UI.termHist = (VC.UI.termHist || []).concat(cmd); VC.UI.termHi = null;
    const [c0, ...args] = cmd.split(/\s+/);
    const files = p ? App.files() : {};
    const argStr = args.join(' ');
    switch (c0) {
      case 'help': [
        'ls [dir]            list files', 'cat <file>          print a file', 'tree                file tree', 'open <file>         open in the editor',
        'git log             checkpoints', 'git diff            last change', 'git checkout <hash> restore a checkpoint', 'git status',
        'npm test           run the test suite (also: vibe test)', 'npm run build       build the project', 'vibe <prompt>       ask Vibe from here',
        'spawn <type> [n]    spawn things in the running game', 'top                 what is alive right now', 'set <path> <json>   edit the spec directly (e.g. set world.gravity -800)',
        'god                 toggle invincibility (runtime only)', 'seed                level seed', 'clear               clear the terminal',
      ].forEach((l) => T.log(l)); break;
      case 'clear': case 'cls': T.clear(); break;
      case 'pwd': T.log('/home/you/games/' + (p ? App.slug() : '')); break;
      case 'whoami': T.log('a game designer, apparently'); break;
      case 'date': T.log(new Date().toString()); break;
      case 'echo': T.log(argStr); break;
      case 'exit': case 'logout': T.log('There is no escape. Only vibes.', 'wa'); break;
      case 'node': T.log('v22.11.0'); break;
      case 'npm':
        if (args[0] === '-v' || args[0] === '--version') { T.log('10.9.0'); break; }
        if (args[0] === 'test' || (args[0] === 'run' && args[1] === 'test')) { T.test(); break; }
        if (args[0] === 'run' && args[1] === 'build') { T.build(); break; }
        if (args[0] === 'run' && args[1] === 'dev') { T.log('dev server already running → see the Preview tab', 'ok'); break; }
        if (args[0] === 'install' || args[0] === 'i') { T.log('added 0 packages, and audited 1 package in 0.2s', 'dim'); T.log('found 0 vulnerabilities', 'ok'); break; }
        T.log('npm: unknown command ' + argStr, 'er'); break;
      case 'vibe':
        if (args[0] === 'test') { T.test(); break; }
        if (args[0] === 'build') { T.build(); break; }
        if (args[0] === 'dev') { T.log('already running', 'ok'); break; }
        if (!argStr) { T.log('usage: vibe "<prompt>"', 'dim'); break; }
        VC.App.sendPrompt(argStr.replace(/^["']|["']$/g, ''));
        T.log('→ sent to the chat', 'dim');
        break;
      case 'ls': {
        const dir = (args[0] || '').replace(/\/$/, '');
        const names = new Set();
        for (const f of Object.keys(files)) {
          if (dir && !f.startsWith(dir + '/')) continue;
          const rest = dir ? f.slice(dir.length + 1) : f;
          names.add(rest.includes('/') ? rest.split('/')[0] + '/' : rest);
        }
        T.log([...names].sort().join('   ') || '(empty)');
        break;
      }
      case 'tree': {
        const all = Object.keys(files).sort();
        T.log('.');
        all.forEach((f, i) => T.log((i === all.length - 1 ? '└── ' : '├── ') + f));
        T.log(all.length + ' files', 'dim');
        break;
      }
      case 'cat': case 'less': case 'more': case 'head': {
        const f = resolve(args[0], files);
        if (!f) { T.log('cat: ' + (args[0] || '') + ': No such file', 'er'); break; }
        files[f].split('\n').forEach((l) => T.log(l));
        break;
      }
      case 'open': case 'code': case 'vim': case 'nano': case 'emacs': {
        const f = resolve(args[0], files);
        if (!f) { T.log((c0 === 'vim' ? 'E212: ' : '') + 'no such file', 'er'); break; }
        if (c0 === 'vim') T.log('(you will never exit vim, so here is the editor instead)', 'dim');
        VC.App.openFile(f);
        break;
      }
      case 'git': T.git(args); break;
      case 'top': case 'ps': case 'htop': {
        const g = VC.App.game;
        const by = {};
        for (const e of g.entities) by[e.type] = (by[e.type] || 0) + 1;
        T.log('TYPE                 COUNT', 'dim');
        Object.entries(by).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => T.log(k.padEnd(20) + ' ' + v));
        T.log(g.entities.length + ' total · ' + Math.round(g.fps) + ' fps · ' + g.particles.length + ' particles', 'dim');
        break;
      }
      case 'spawn': {
        const g = VC.App.game, type = args[0], n = Math.min(500, parseInt(args[1] || '1', 10) || 1);
        if (!type || !g.spec.types[type]) { T.log('spawn: unknown type. Try: ' + Object.keys(g.spec.types).join(', '), 'er'); break; }
        for (let i = 0; i < n; i++) { const q = g.findSpot('random', g.spec.types[type]); g.spawnEntity(type, q.x, q.y); }
        T.log('spawned ' + n + ' × ' + type, 'ok');
        break;
      }
      case 'god': {
        const g = VC.App.game;
        if (!g.player) { T.log('no player', 'er'); break; }
        g.godmode = !g.godmode;
        if (g.godmode) g.player.powers.invincible = 1e9; else delete g.player.powers.invincible;
        T.log('god mode ' + (g.godmode ? 'ON' : 'off') + ' (runtime only)', g.godmode ? 'wa' : 'dim');
        VC.Ach.unlock('godmode');
        break;
      }
      case 'seed': T.log(String(p.spec.level.seed)); break;
      case 'fps': T.log(Math.round(VC.App.game.fps) + ' fps'); break;
      case 'set': {
        const path = args[0];
        let val = args.slice(1).join(' ');
        if (!path || !val) { T.log('usage: set <path> <json>   e.g. set world.gravity -800', 'dim'); break; }
        try { val = JSON.parse(val); } catch (e) { /* keep as string */ }
        VC.App.directSet(path, val);
        T.log('✓ ' + path + ' = ' + JSON.stringify(val), 'ok');
        break;
      }
      case 'sudo':
        VC.Ach.unlock('sudo');
        T.log('you is not in the sudoers file. This incident will be reported.', 'er');
        break;
      case 'rm': {
        if (/-rf?\s*(\/|\*|~|\.)/.test(argStr) || argStr === '-rf /' || /\s\/$/.test(' ' + argStr)) { VC.Ach.unlock('rm_rf'); T.log('nice try.', 'wa'); T.log('(the void is already empty enough)', 'dim'); break; }
        const f = resolve(args.filter((a) => !a.startsWith('-'))[0], files);
        if (!f) { T.log('rm: no such file', 'er'); break; }
        const m = /^src\/entities\/(\w+)\.js$/.exec(f);
        if (m) { VC.App.removeTypeDirect(m[1]); T.log('removed ' + f, 'ok'); }
        else T.log('rm: ' + f + ': refusing to remove a core file', 'er');
        break;
      }
      case 'cowsay': {
        const msg = argStr || 'moo';
        const line = '-'.repeat(msg.length + 2);
        [' ' + line, '< ' + msg + ' >', ' ' + line, '        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||'].forEach((l) => T.log(l));
        break;
      }
      case 'fortune': T.log(U.pick(FORTUNES)); break;
      case 'history': (VC.UI.termHist || []).forEach((h, i) => T.log(String(i + 1).padStart(4) + '  ' + h)); break;
      case 'make': T.log("make: *** No rule to make target. Try 'npm run build'.", 'er'); break;
      case 'curl': case 'wget': case 'ssh': T.log(c0 + ': the network is mostly vibes in here', 'dim'); break;
      case 'python': case 'python3': T.log('Python? In this economy? Try src/mods.js (JavaScript).', 'dim'); break;
      default: T.log(c0 + ': command not found. Type `help`.', 'er');
    }
  };

  function resolve(name, files) {
    if (!name) return null;
    if (files[name]) return name;
    const n = name.replace(/^\.\//, '');
    if (files[n]) return n;
    const c = Object.keys(files).find((f) => f.endsWith('/' + n) || f.split('/').pop() === n);
    return c || null;
  }

  T.test = function () {
    const App = VC.App;
    const r = VC.Tests.run(App.project.spec, App.files());
    T.log('> vibe test', 'dim');
    for (const x of r.results) T.log((x.pass ? '  ✓ ' : '  ✗ ') + x.name + '  ' + x.detail, x.pass ? 'ok' : 'er');
    T.log((r.failed.length ? r.failed.length + ' failed, ' : '') + (r.results.length - r.failed.length) + ' passed (' + r.ms + 'ms)', r.failed.length ? 'er' : 'ok');
  };
  T.build = function () {
    const App = VC.App, files = App.files();
    let bytes = 0; for (const v of Object.values(files)) bytes += v.length;
    T.log('vibe build v3.2.0', 'dim');
    T.log('✓ ' + Object.keys(files).length + ' modules transformed.', 'ok');
    T.log('dist/game.js  ' + (bytes / 1024).toFixed(2) + ' kB │ gzip: ' + (bytes / 3900).toFixed(2) + ' kB');
    T.log('✓ built in ' + (40 + Math.round(Math.random() * 90)) + 'ms', 'ok');
  };
  T.git = function (args) {
    const App = VC.App, p = App.project;
    const cps = p.checkpoints;
    const sub = args[0];
    if (sub === 'log') {
      if (!cps.length) { T.log('fatal: your current branch has no commits yet', 'er'); return; }
      for (let i = cps.length - 1; i >= 0; i--) { const c = cps[i]; T.html('<span class="wa">' + c.hash + '</span>' + (c.id === p.head ? ' <span class="in">(HEAD -> main)</span>' : '') + ' ' + U.esc(c.label) + ' <span class="dim">' + U.fmtAgo(c.time) + '</span>'); }
      return;
    }
    if (sub === 'status') { T.log('On branch main'); T.log(p.overrides && Object.keys(p.overrides).length ? 'Changes (hand-edited): ' + Object.keys(p.overrides).join(', ') : 'nothing to commit, working tree clean', 'dim'); return; }
    if (sub === 'diff') {
      const last = cps[cps.length - 1], prev = cps[cps.length - 2];
      if (!last || !prev) { T.log('(no previous commit)', 'dim'); return; }
      const a = VC.DSL.generateFiles(prev.spec, p), b = VC.DSL.generateFiles(last.spec, p);
      for (const f of new Set(Object.keys(a).concat(Object.keys(b)))) {
        if (a[f] === b[f] || f === 'package.json') continue;
        T.log('diff --git a/' + f + ' b/' + f, 'in');
        for (const l of VC.DSL.hunks(VC.DSL.diff(a[f] || '', b[f] || ''), 1)) {
          if (l.k === '…') T.log('@@', 'dim'); else T.log(l.k + ' ' + l.s, l.k === '+' ? 'ok' : l.k === '-' ? 'er' : 'dim');
        }
      }
      return;
    }
    if (sub === 'checkout' || sub === 'reset') {
      let target = args.filter((a) => !a.startsWith('-'))[sub === 'reset' ? 0 : 0];
      if (sub === 'reset' && /HEAD~(\d+)/.test(args.join(' '))) { const n = +/HEAD~(\d+)/.exec(args.join(' '))[1]; const idx = cps.findIndex((c) => c.id === p.head) - n; if (cps[idx]) target = cps[idx].hash; }
      const c = cps.find((x) => x.hash === target || x.hash.startsWith(target || '###'));
      if (!c) { T.log("error: pathspec '" + (target || '') + "' did not match any checkpoint", 'er'); return; }
      App.restoreCheckpoint(c.id);
      T.log('HEAD is now at ' + c.hash + ' ' + c.label, 'ok');
      return;
    }
    if (sub === 'push') { T.log('Everything up-to-date (it only lives in this browser)', 'dim'); return; }
    if (sub === 'blame') { T.log('it was Vibe. it is always Vibe.', 'dim'); return; }
    T.log('git: ' + (sub || '') + ' is not supported here', 'er');
  };

  VC.Term = T;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
