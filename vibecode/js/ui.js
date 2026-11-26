/* VibeCode — DOM layer: transcript, composer, tabs, editor, history, overlays, modals. */
(function (VC) {
  'use strict';
  const U = VC.U, DSL = VC.DSL;
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = U.esc;
  const UI = { ev: U.emitter(), nodes: new Map() };
  UI.$ = $; UI.el = el;

  UI.SLASH = [
    ['/help', 'what can I say?'], ['/new', 'start a new chat'], ['/undo', 'revert the last change'], ['/rewind', 'restore code & conversation to an earlier prompt'],
    ['/model', 'switch model'], ['/plan', 'toggle plan mode'], ['/files', 'show source files'], ['/terminal', 'open the terminal'], ['/history', 'show checkpoints'],
    ['/status', 'project status'], ['/doctor', 'run diagnostics'], ['/achievements', 'hidden and unlocked achievements'], ['/challenges', 'optional dev challenges'],
    ['/share', 'copy a share code for this game'], ['/import', 'fork a game from a share code'], ['/export', 'download the project as JSON'], ['/title', 'rename the game'],
    ['/docs', 'engine reference (every helper)'], ['/speed', 'streaming speed: normal | fast | instant'], ['/sound', 'toggle sound'], ['/clear', 'clear the conversation'],
    ['/compact', 'summarize the conversation'], ['/cost', 'token usage'], ['/init', 'regenerate README.md'], ['/reset', 'delete everything in this project'], ['/live', 'retry the last prompt with the live model'],
  ];

  UI.init = function () {
    UI.app = $('#app');
    UI.tr = $('#transcript');
    UI.input = $('#input');
    UI.ghost = $('#ghost');
    UI.slash = $('#slashMenu');
    UI.inputBox = $('#inputBox');
    UI.ws = $('#workspace');
    UI.hero = $('#hero');
    // sidebar
    $('#newChat').onclick = () => UI.ev.emit('newChat');
    $('#heroNew').onclick = () => UI.ev.emit('newChat');
    $('#btnAchievements').onclick = () => UI.showAchievements();
    $('#btnChallenges').onclick = () => UI.showAchievements(true);
    $('#btnSound').onclick = () => UI.ev.emit('toggleSound');
    $('#menuBtn').onclick = () => UI.app.classList.toggle('sb-open');
    document.addEventListener('click', (e) => { if (UI.app.classList.contains('sb-open') && !e.target.closest('.sidebar') && !e.target.closest('#menuBtn')) UI.app.classList.remove('sb-open'); });
    // mobile segmented control
    $('#seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) UI.showPane(b.dataset.v); });
    // tabs
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => UI.tab(t.dataset.tab)));
    // composer
    UI.input.addEventListener('input', () => { UI.autosize(); UI.updateSlash(); UI.updateGhost(); });
    UI.input.addEventListener('keydown', UI.onKey);
    UI.input.addEventListener('focus', () => UI.ev.emit('chatFocus'));
    UI.tr.addEventListener('mousedown', () => UI.ev.emit('chatFocus'));
    UI.tr.addEventListener('scroll', () => { if (UI.autoScrolling) return; const t = UI.tr; UI.stick = t.scrollHeight - t.scrollTop - t.clientHeight < 60; });
    $('#modeLine').onclick = () => UI.ev.emit('cycleMode');
    $('#modelLine').onclick = () => UI.ev.emit('slash', '/model');
    // splitter
    const sp = $('#splitter');
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault(); sp.classList.add('drag');
      const mv = (ev) => { const r = UI.ws.getBoundingClientRect(); const pct = U.clamp((ev.clientX - r.left) / r.width * 100, 26, 72); document.documentElement.style.setProperty('--split', pct + '%'); UI.ev.emit('resize'); };
      const up = () => { sp.classList.remove('drag'); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); UI.ev.emit('splitDone', getComputedStyle(document.documentElement).getPropertyValue('--split')); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
    // preview controls
    $('#btnRestart').onclick = () => UI.ev.emit('restart');
    $('#btnPause').onclick = () => UI.ev.emit('pauseToggle');
    $('#btnFull').onclick = () => { const s = $('#stage'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (s.requestFullscreen) s.requestFullscreen().catch(() => {}); };
    $('#playCta').onclick = (e) => { e.stopPropagation(); UI.ev.emit('play'); };
    $('#stage').addEventListener('mousedown', (e) => { if (e.target.closest('.err-overlay') || e.target.closest('.play-cta')) return; UI.ev.emit('stageClick'); });
    $('#stage').addEventListener('touchstart', (e) => { if (e.target.closest('.err-overlay')) return; UI.ev.emit('stageClick'); }, { passive: true });
    // editor
    UI.initEditor();
    // terminal input
    const ti = $('#termIn');
    ti.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = ti.value; ti.value = ''; UI.ev.emit('term', v); }
      if (e.key === 'ArrowUp') { UI.termHist = UI.termHist || []; if (UI.termHist.length) { UI.termHi = Math.max(0, (UI.termHi == null ? UI.termHist.length : UI.termHi) - 1); ti.value = UI.termHist[UI.termHi]; e.preventDefault(); } }
      if (e.key === 'ArrowDown') { if (UI.termHist && UI.termHi != null) { UI.termHi = Math.min(UI.termHist.length, UI.termHi + 1); ti.value = UI.termHist[UI.termHi] || ''; } }
    });
    // global keys
    window.addEventListener('keydown', UI.onGlobalKey, true);
    window.addEventListener('resize', () => UI.ev.emit('resize'));
    // modal
    $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') UI.closeModal(); });
  };

  UI.showPane = function (v) {
    UI.ws.classList.toggle('show-game', v === 'game');
    document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    UI.ev.emit('resize');
  };

  UI.tab = function (name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    for (const n of ['preview', 'files', 'terminal', 'history']) $('#tab-' + n).hidden = n !== name;
    UI.curTab = name;
    if (name === 'files') { $('#filesBadge').hidden = true; UI.ev.emit('filesOpen'); }
    if (name === 'history') { $('#histBadge').hidden = true; UI.ev.emit('historyOpen'); }
    if (name === 'terminal') { const t = $('#term'); t.scrollTop = t.scrollHeight; setTimeout(() => $('#termIn').focus(), 30); }
    if (name === 'preview') UI.ev.emit('resize');
    if (window.matchMedia('(max-width: 860px)').matches) UI.showPane('game');
  };

  UI.autosize = function () {
    const t = UI.input;
    t.style.height = 'auto';
    t.style.height = Math.min(200, t.scrollHeight) + 'px';
  };

  // ------------------------------------------------------------------ keys
  UI.onKey = function (e) {
    const t = UI.input;
    if (!UI.slash.hidden) {
      const items = [...UI.slash.querySelectorAll('.si')];
      let i = items.findIndex((x) => x.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((x, j) => x.classList.toggle('sel', j === i)); items[i].scrollIntoView({ block: 'nearest' }); return; }
      if ((e.key === 'Tab' || e.key === 'Enter') && items[i]) {
        e.preventDefault();
        const cmd = items[i].dataset.c;
        UI.slash.hidden = true;
        if (e.key === 'Enter' && !/^\/(?:import|title|speed)$/.test(cmd)) { t.value = ''; UI.autosize(); UI.ev.emit('slash', cmd); }
        else { t.value = cmd + ' '; UI.autosize(); }
        return;
      }
      if (e.key === 'Escape') { UI.slash.hidden = true; e.stopPropagation(); return; }
    }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); UI.ev.emit('cycleMode'); return; }
    if (e.key === 'Tab' && UI.ghostText && !t.value.trim()) { e.preventDefault(); t.value = UI.ghostText; UI.autosize(); UI.updateGhost(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const v = t.value.trim();
      if (!v) return;
      UI.hist = UI.hist || [];
      UI.hist.push(v); UI.hi = null;
      t.value = ''; UI.autosize(); UI.updateGhost(); UI.slash.hidden = true;
      if (v.startsWith('/')) UI.ev.emit('slash', v);
      else UI.ev.emit('send', v);
      return;
    }
    if (e.key === 'ArrowUp' && !t.value.includes('\n') && (t.selectionStart === 0 || !t.value)) {
      UI.hist = UI.hist || [];
      if (UI.hist.length) { e.preventDefault(); UI.hi = Math.max(0, (UI.hi == null ? UI.hist.length : UI.hi) - 1); t.value = UI.hist[UI.hi]; UI.autosize(); UI.updateGhost(); }
      return;
    }
    if (e.key === 'ArrowDown' && UI.hi != null && !t.value.includes('\n')) {
      e.preventDefault(); UI.hi = Math.min(UI.hist.length, UI.hi + 1); t.value = UI.hist[UI.hi] || ''; if (UI.hi >= UI.hist.length) UI.hi = null; UI.autosize(); UI.updateGhost(); return;
    }
    if (e.key === '?' && !t.value) { e.preventDefault(); UI.ev.emit('slash', '/shortcuts'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); UI.ev.emit('slash', '/clear'); }
  };

  UI.onGlobalKey = function (e) {
    if (UI.choice) { UI.choiceKey(e); return; }
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) { UI.closeModal(); e.preventDefault(); return; }
      UI.ev.emit('escape', e);
      return;
    }
    if (e.altKey && (e.key === 'n' || e.key === 'N' || e.code === 'KeyN')) { e.preventDefault(); UI.ev.emit('newChat'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); UI.toggleExpandAll(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && UI.curTab === 'files') { e.preventDefault(); UI.saveEditor(); }
  };

  // ------------------------------------------------------------------ slash menu & ghost
  UI.updateSlash = function () {
    const v = UI.input.value;
    if (!v.startsWith('/') || v.includes(' ') || v.includes('\n')) { UI.slash.hidden = true; return; }
    const items = UI.SLASH.filter(([c]) => c.startsWith(v.toLowerCase()) || (v.length > 2 && c.includes(v.slice(1).toLowerCase())));
    if (!items.length) { UI.slash.hidden = true; return; }
    UI.slash.innerHTML = items.map(([c, d], i) => '<div class="si' + (i === 0 ? ' sel' : '') + '" data-c="' + c + '"><span class="c">' + c + '</span><span class="d">' + esc(d) + '</span></div>').join('');
    UI.slash.hidden = false;
    UI.slash.querySelectorAll('.si').forEach((x) => x.addEventListener('mousedown', (ev) => { ev.preventDefault(); UI.slash.hidden = true; UI.input.value = ''; UI.ev.emit('slash', x.dataset.c); }));
  };
  UI.setGhost = function (text) { UI.ghostText = text || ''; UI.updateGhost(); };
  UI.updateGhost = function () {
    const show = UI.ghostText && !UI.input.value;
    UI.ghost.innerHTML = show ? esc(UI.ghostText) + ' <span style="color:var(--fg-4);opacity:.7">⇥ tab</span>' : '';
    UI.input.placeholder = show ? '' : UI.placeholder || '';
  };

  // ------------------------------------------------------------------ markdown
  UI.md = function (src) {
    const lines = String(src || '').split('\n');
    let html = '', inList = false, inPre = false, pre = [];
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>');
    for (const raw of lines) {
      if (/^```/.test(raw)) { if (inPre) { html += '<pre>' + pre.map(esc).join('\n') + '</pre>'; pre = []; inPre = false; } else { if (inList) { html += '</ul>'; inList = false; } inPre = true; } continue; }
      if (inPre) { pre.push(raw); continue; }
      const li = /^\s*[-*]\s+(.*)$/.exec(raw);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(li[1]) + '</li>'; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (!raw.trim()) { html += '<p></p>'; continue; }
      const cls = /^✦/.test(raw) ? ' class="twist"' : '';
      html += '<p' + cls + '>' + inline(raw) + '</p>';
    }
    if (inList) html += '</ul>';
    if (inPre) html += '<pre>' + pre.map(esc).join('\n') + '</pre>';
    return html.replace(/(<p><\/p>)+/g, '<p></p>').replace(/^<p><\/p>|<p><\/p>$/g, '');
  };

  // ------------------------------------------------------------------ transcript
  UI.clearTranscript = function () { UI.tr.innerHTML = ''; UI.nodes.clear(); UI.spinEl = null; };
  UI.renderAll = function (msgs) {
    UI.clearTranscript();
    for (const m of msgs) UI.addMsg(m, true);
    UI.scroll(true);
  };
  UI.addMsg = function (m, noScroll) {
    const n = UI.renderMsg(m);
    if (!n) return null;
    if (UI.spinEl && UI.spinEl.parentNode === UI.tr) UI.tr.insertBefore(n, UI.spinEl);
    else UI.tr.appendChild(n);
    UI.nodes.set(m.id, n);
    if (!noScroll) UI.scroll();
    return n;
  };
  UI.updateMsg = function (m) {
    const old = UI.nodes.get(m.id);
    const n = UI.renderMsg(m);
    if (!n) return;
    n.style.animation = 'none';
    if (old && old.parentNode) old.parentNode.replaceChild(n, old); else UI.tr.appendChild(n);
    UI.nodes.set(m.id, n);
    UI.scroll();
  };
  UI.removeMsg = function (m) { const n = UI.nodes.get(m.id); if (n) n.remove(); UI.nodes.delete(m.id); };
  UI.stick = true;
  UI.scroll = function (force) {
    const t = UI.tr;
    if (force) UI.stick = true;
    if (!UI.stick) return;
    UI.autoScrolling = true;
    t.scrollTop = t.scrollHeight;
    requestAnimationFrame(() => { UI.autoScrolling = false; });
  };

  UI.renderMsg = function (m) {
    switch (m.t) {
      case 'welcome': {
        const n = el('div', 'msg');
        n.innerHTML = '<div class="welcome"><div class="w1"><span class="s">✻</span>Welcome to <b>VibeCode</b>!</div>' +
          '<div class="w2"><b>/help</b> for help, <b>/model</b> to switch models' + (m.live ? ' · <span class="live">● live model available</span>' : '') + '</div>' +
          '<div class="w3">cwd: ' + esc(m.cwd) + '</div></div>' +
          '<div class="tips"><div class="h">Tips for getting started:</div><ol>' +
          '<li>Describe a game, a character, a world. Anything.</li><li>Click the preview to play what you’ve built.</li><li>Press Esc twice (or /rewind) to undo disasters.</li><li>Shift+Tab cycles permission modes.</li></ol></div>';
        return n;
      }
      case 'user': {
        const n = el('div', 'msg user' + (m.queued ? ' queued' : ''));
        n.innerHTML = '<span class="g">&gt;</span><span class="t">' + esc(m.text) + '</span>';
        return n;
      }
      case 'assistant': {
        const n = el('div', 'msg assistant');
        n.innerHTML = '<span class="bullet">⏺</span><div class="md">' + UI.md(m.text) + (m.streaming ? '<span class="cursor" style="color:var(--accent)">▍</span>' : '') + '</div>';
        return n;
      }
      case 'think': {
        const n = el('div', 'msg think' + (m.collapsed ? ' collapsed' : ''));
        const head = m.done ? '∴ Thought for ' + Math.max(1, Math.round(m.secs || 1)) + 's' : '✻ Thinking…';
        n.innerHTML = '<div class="th-head"><span class="g">' + (m.done ? '∴' : '✻') + '</span><span>' + head.replace(/^[∴✻] /, '') + '</span><span class="hint">' + (m.collapsed ? '(ctrl+o to expand)' : m.done ? '(click to collapse)' : '') + '</span></div><div class="th-body">' + UI.mdInline(m.text) + '</div>';
        n.querySelector('.th-head').onclick = () => { m.collapsed = !m.collapsed; UI.updateMsg(m); UI.ev.emit('dirty'); };
        return n;
      }
      case 'tool': return UI.renderTool(m);
      case 'todo': {
        const n = el('div', 'msg tool ok');
        n.innerHTML = '<div class="tl-head"><span class="dot">⏺</span><span><span class="name">Update Todos</span></span></div><div class="todo">' +
          m.items.map((it) => '<div class="it ' + it.s + '"><span class="b">' + (it.s === 'done' ? '☒' : '☐') + '</span><span>' + UI.mdInline(it.label) + '</span></div>').join('') + '</div>';
        return n;
      }
      case 'sys': {
        const n = el('div', 'msg sys' + (m.kind ? ' k-' + m.kind : ''));
        n.innerHTML = '<span style="color:var(--fg-4)">⎿</span>  ' + UI.mdInline(m.text);
        return n;
      }
      case 'suggest': {
        if (!m.items || !m.items.length) return null;
        const n = el('div', 'suggest');
        for (const s of m.items) { const b = el('button', 'chip'); b.textContent = s; b.onclick = () => UI.ev.emit('chip', s); n.appendChild(b); }
        return n;
      }
      case 'plan': {
        const n = el('div', 'planbox');
        n.innerHTML = '<div class="ttl">' + esc(m.title || 'Here is Vibe’s plan:') + '</div><div class="md">' + UI.md(m.text) + '</div>' + (m.answer ? '<div style="color:var(--fg-3);font-size:12.5px">⎿ ' + esc(m.answer) + '</div>' : '');
        return n;
      }
      default: return null;
    }
  };
  UI.mdInline = function (s) {
    return esc(s).replace(/`([^`]+)`/g, '<code style="color:var(--accent-2)">$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  };

  UI.renderTool = function (m) {
    const n = el('div', 'msg tool ' + (m.status || 'run'));
    let html = '<div class="tl-head"><span class="dot">⏺</span><span><span class="name">' + esc(m.name) + '</span>(<span class="arg">' + esc(m.arg || '') + '</span>)</span></div>';
    if (m.res) html += '<div class="res"><span class="elbow">⎿</span><span>' + m.res + '</span></div>';
    n.innerHTML = html;
    if (m.body && (m.status === 'ok' || m.status === 'err' || m.body.live)) n.appendChild(UI.codeBox(m));
    return n;
  };

  UI.codeBox = function (m) {
    const b = m.body;
    if (b.kind === 'bash') {
      const box = el('div', 'codebox bash');
      box.innerHTML = b.lines.map((l) => (l.cls ? '<span class="' + l.cls + '">' + esc(l.s) + '</span>' : esc(l.s))).join('\n');
      return box;
    }
    const box = el('div', 'codebox');
    const rows = el('div', 'rows');
    const lang = DSL.langOf(b.path || '');
    const limit = m.expanded ? 1e9 : b.limit || 14;
    const lines = b.lines || [];
    const shown = lines.slice(0, limit);
    rows.innerHTML = shown.map((l) => {
      if (l.k === '…') return '<div class="row gap">⋯</div>';
      const cls = l.k === '+' ? ' add' : l.k === '-' ? ' del' : '';
      const ln = l.k === '-' ? l.o : l.n;
      return '<div class="row' + cls + '"><span class="ln">' + (ln || '') + '</span><span class="sg">' + (l.k === ' ' ? ' ' : l.k) + '</span><span class="tx">' + DSL.highlightLine(l.s, lang) + '</span></div>';
    }).join('');
    box.appendChild(rows);
    if (lines.length > limit) {
      const more = el('div', 'more', '… +' + (lines.length - limit) + ' lines (click or ctrl+o to expand)');
      more.onclick = () => { m.expanded = true; UI.updateMsg(m); };
      box.appendChild(more);
    }
    return box;
  };

  UI.toggleExpandAll = function () {
    const msgs = UI.ev._msgs ? UI.ev._msgs() : [];
    const anyCollapsed = msgs.some((m) => (m.t === 'think' && m.collapsed) || (m.t === 'tool' && m.body && !m.expanded));
    for (const m of msgs) {
      if (m.t === 'think') { m.collapsed = !anyCollapsed; UI.updateMsg(m); }
      if (m.t === 'tool' && m.body && m.body.kind !== 'bash') { m.expanded = anyCollapsed; UI.updateMsg(m); }
    }
  };

  // spinner
  UI.spinner = {
    start(verb) {
      UI.spinner.stop();
      const n = el('div', 'spinner');
      n.innerHTML = '<span class="g">✻</span><span class="v"></span><span class="meta"></span>';
      UI.tr.appendChild(n);
      UI.spinEl = n;
      UI.spinner.t0 = performance.now();
      UI.spinner.verb = verb;
      UI.spinner.tokens = 0;
      const frames = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
      let i = 0;
      UI.spinner.timer = setInterval(() => {
        if (!UI.spinEl) return;
        i = (i + 1) % frames.length;
        n.querySelector('.g').textContent = frames[i];
        const s = Math.floor((performance.now() - UI.spinner.t0) / 1000);
        n.querySelector('.v').textContent = UI.spinner.verb;
        n.querySelector('.meta').textContent = '(' + s + 's · ↓ ' + fmtTok(UI.spinner.tokens) + ' tokens · esc to interrupt)';
      }, 110);
      n.querySelector('.v').textContent = verb;
      n.querySelector('.meta').textContent = '(0s · esc to interrupt)';
      UI.inputBox.classList.add('busy');
      UI.scroll();
    },
    set(verb) { UI.spinner.verb = verb; },
    tok(n) { UI.spinner.tokens += n; },
    stop() { if (UI.spinner.timer) clearInterval(UI.spinner.timer); if (UI.spinEl) UI.spinEl.remove(); UI.spinEl = null; UI.inputBox.classList.remove('busy'); },
  };
  function fmtTok(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)); }

  // ------------------------------------------------------------------ choice prompts (permission, plan, model)
  UI.choose = function (title, sub, options, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const box = el('div', 'permbox');
      box.innerHTML = '<div class="ttl">' + esc(title) + '</div>' + (sub ? '<div class="file">' + sub + '</div>' : '') + '<div class="opts"></div>';
      const list = box.querySelector('.opts');
      let sel = opts.defaultIndex || 0;
      const render = () => { list.innerHTML = ''; options.forEach((o, i) => { const b = el('button', 'opt' + (i === sel ? ' sel' : '')); b.innerHTML = '<span class="k">' + (i + 1) + '.</span><span>' + esc(o.label) + (o.hint ? ' <span style="color:var(--fg-4)">(' + esc(o.hint) + ')</span>' : '') + '</span>'; b.onclick = () => done(i); b.onmouseenter = () => { sel = i; render(); }; list.appendChild(b); }); };
      const done = (i) => { UI.choice = null; box.remove(); resolve(options[i].value); };
      render();
      if (UI.spinEl && UI.spinEl.parentNode) UI.tr.insertBefore(box, UI.spinEl); else UI.tr.appendChild(box);
      UI.scroll(true);
      UI.choice = {
        key(e) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; render(); }
          else if (e.key === 'Enter') { e.preventDefault(); done(sel); }
          else if (/^[1-9]$/.test(e.key) && +e.key <= options.length) { e.preventDefault(); done(+e.key - 1); }
          else if (e.key === 'Escape') { e.preventDefault(); const i = options.findIndex((o) => o.esc); done(i >= 0 ? i : options.length - 1); }
          else if (e.key === 'Tab' && e.shiftKey && opts.shiftTab != null) { e.preventDefault(); done(opts.shiftTab); }
        },
      };
      if (document.activeElement === UI.input) UI.input.blur();
    });
  };
  UI.choiceKey = function (e) { if (UI.choice) UI.choice.key(e); };

  // ------------------------------------------------------------------ sidebar
  UI.renderChats = function (list, curId) {
    const box = $('#chatList');
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="chat-empty">No chats yet. Every game starts as a conversation.</div>'; return; }
    for (const p of list) {
      const b = el('button', 'chat-item' + (p.id === curId ? ' active' : ''));
      b.innerHTML = '<span class="dot" style="background:' + esc(p.color || '#d97757') + '"></span><span class="t">' + esc(p.name || 'Untitled') + '</span><span class="ago">' + esc(U.fmtAgo(p.updated)) + '</span><span class="x" title="Delete" role="button" aria-label="Delete chat">✕</span>';
      b.onclick = (e) => { if (e.target.classList.contains('x')) { e.stopPropagation(); UI.ev.emit('deleteChat', p.id); return; } UI.ev.emit('openChat', p.id); UI.app.classList.remove('sb-open'); };
      box.appendChild(b);
    }
  };
  UI.setCounts = function (c) { $('#achCount').textContent = c.ach + '/' + c.achTotal; $('#chalCount').textContent = c.chal + '/' + c.chalTotal; };
  UI.setSound = function (on) { $('#soundLbl').textContent = on ? 'Sound on' : 'Sound off'; $('#soundIco').textContent = on ? '♪' : '–'; };
  UI.setHero = function (show, resume) {
    UI.hero.hidden = !show; UI.ws.hidden = show;
    const r = $('#heroResume');
    if (show && resume) { r.hidden = false; r.innerHTML = 'or continue: '; const b = el('button'); b.textContent = resume.name; b.onclick = () => UI.ev.emit('openChat', resume.id); r.appendChild(b); }
    else r.hidden = true;
  };
  UI.setCwd = function (name) { $('#cwd').innerHTML = '~/games/<b>' + esc(name) + '</b>'; };

  // status line
  UI.setMode = function (mode) {
    const m = $('#modeLine');
    m.className = 'mode ' + (mode === 'acceptEdits' ? 'accept' : mode === 'plan' ? 'plan' : '');
    m.textContent = mode === 'acceptEdits' ? '⏵⏵ accept edits on (shift+tab to cycle)' : mode === 'plan' ? '⏸ plan mode on (shift+tab to cycle)' : '? for shortcuts';
  };
  UI.setModel = function (name, live) { const m = $('#modelLine'); m.textContent = name; m.classList.toggle('live', !!live); };
  UI.setCtx = function (pct) { $('#ctxLine').textContent = 'ctx ' + Math.max(0, Math.round(pct)) + '%'; $('#ctxLine').style.color = pct < 15 ? 'var(--warn)' : ''; };

  // ------------------------------------------------------------------ preview overlays
  UI.setPlayState = function (mode, empty) {
    const badge = $('#playBadge'), cta = $('#playCta'), veil = $('#pausedVeil');
    badge.style.opacity = empty ? 0 : 1;
    if (mode === 'play') { badge.textContent = '● PLAYING · ESC TO RETURN'; badge.classList.add('live'); cta.hidden = true; veil.hidden = true; }
    else if (mode === 'paused') { badge.textContent = 'PAUSED'; badge.classList.remove('live'); cta.hidden = true; veil.hidden = empty; }
    else { badge.textContent = 'AUTOPILOT'; badge.classList.remove('live'); cta.hidden = !!empty; veil.hidden = true; }
    $('#btnPause').classList.toggle('on', mode === 'paused');
  };
  UI.hmr = function (path) {
    const h = $('#hmr');
    h.textContent = '⚡ hmr update ' + path.replace(/^src\//, '');
    h.classList.add('on');
    clearTimeout(UI.hmrT);
    UI.hmrT = setTimeout(() => h.classList.remove('on'), 1300);
  };
  UI.setStatus = function (s) {
    const p = $('#pstatus');
    if (!s) { p.innerHTML = ''; return; }
    p.innerHTML = (s.err ? '<span class="st-err">● error</span>' : '<span class="live">●</span> ' + esc(s.state)) + '<span>' + s.fps + ' fps</span><span>' + s.ents + ' entities</span>' + (s.proj ? '<span>' + s.proj + ' projectiles</span>' : '') + '<span>' + esc(s.physics) + '</span>' + (s.level > 1 ? '<span>level ' + s.level + '</span>' : '') + '<span>score ' + s.score + '</span>';
  };
  UI.showError = function (err, onFix, onDismiss) {
    const o = $('#errOverlay');
    if (!err) { o.hidden = true; return; }
    o.hidden = false;
    o.innerHTML = '<div class="eh">[vibe] ' + esc(err.kind || 'Error') + (err.file ? ' in ' + esc(err.file) + (err.line ? ':' + err.line : '') : '') + '</div>' +
      '<div class="ef">' + (err.stale ? 'The last working version is still loaded.' : 'The game stopped.') + '</div>' +
      '<pre>' + esc(err.message) + (err.snippet ? '\n\n' + esc(err.snippet) : '') + '</pre>' +
      '<div class="acts"><button class="pri" id="errFix">Ask Vibe to fix it</button>' + (err.file ? '<button id="errOpen">Open ' + esc(err.file) + '</button>' : '') + '<button id="errDismiss">Dismiss</button></div>';
    o.querySelector('#errFix').onclick = (e) => { e.stopPropagation(); onFix && onFix(); };
    const op = o.querySelector('#errOpen'); if (op) op.onclick = (e) => { e.stopPropagation(); UI.ev.emit('openFile', err.file); };
    o.querySelector('#errDismiss').onclick = (e) => { e.stopPropagation(); o.hidden = true; onDismiss && onDismiss(); };
  };
  UI.setStageFx = function (fx) {
    const s = $('#stage'), c = $('#game');
    s.classList.toggle('fx-crt', fx.has('crt'));
    s.classList.toggle('fx-scanlines', fx.has('scanlines') && !fx.has('crt'));
    const f = [];
    if (fx.has('grayscale')) f.push('grayscale(1) contrast(1.1)');
    if (fx.has('sepia')) f.push('sepia(0.85) contrast(1.05)');
    if (fx.has('invert')) f.push('invert(1) hue-rotate(180deg)');
    if (fx.has('blur')) f.push('blur(1.6px)');
    if (fx.has('chroma')) f.push('drop-shadow(2px 0 0 rgba(255,0,80,.55)) drop-shadow(-2px 0 0 rgba(0,220,255,.55))');
    if (fx.has('glow')) f.push('saturate(1.25) brightness(1.06)');
    c.style.filter = f.join(' ');
    c.style.animation = fx.has('psychedelic') || fx.has('hueshift') ? 'vc-hue 6s linear infinite' : '';
    c.style.transform = (fx.has('flip') ? 'scaleY(-1) ' : '') + (fx.has('mirror') ? 'scaleX(-1)' : '');
    if (!document.getElementById('vc-hue-style')) { const st = el('style'); st.id = 'vc-hue-style'; st.textContent = '@keyframes vc-hue { from { filter: hue-rotate(0deg) saturate(1.4); } to { filter: hue-rotate(360deg) saturate(1.4); } }'; document.head.appendChild(st); }
  };

  // ------------------------------------------------------------------ files & editor
  UI.renderTree = function (files, cur, marks) {
    const t = $('#tree');
    const paths = Object.keys(files);
    const root = paths.filter((p) => !p.includes('/')).sort((a, b) => (a === 'game.config.js' ? -1 : b === 'game.config.js' ? 1 : a.localeCompare(b)));
    const src = paths.filter((p) => /^src\/[^/]+$/.test(p)).sort((a, b) => order(a) - order(b));
    const ents = paths.filter((p) => p.startsWith('src/entities/')).sort();
    const item = (p, depth) => '<button class="f' + (depth ? ' d1' : '') + (p === cur ? ' on' : '') + '" data-p="' + esc(p) + '">' + esc(p.split('/').pop()) + (marks[p] ? '<span class="m ' + marks[p] + '">' + (marks[p] === 'new' ? 'U' : 'M') + '</span>' : '') + '</button>';
    let h = root.map((p) => item(p, 0)).join('');
    h += '<div class="dir">src/</div>' + src.map((p) => item(p, 0)).join('');
    if (ents.length) h += '<div class="dir" style="padding-left:14px">entities/</div>' + ents.map((p) => item(p, 1)).join('');
    t.innerHTML = h;
    t.querySelectorAll('.f').forEach((b) => (b.onclick = () => UI.ev.emit('openFile', b.dataset.p)));
    function order(p) { return { 'src/main.js': 0, 'src/player.js': 1, 'src/rules.js': 2, 'src/mods.js': 3 }[p] || 9; }
  };
  UI.initEditor = function () {
    const ta = $('#code'), hl = $('#hl'), gut = $('#gut');
    const sync = () => {
      const v = ta.value;
      const lang = DSL.langOf(UI.edPath || '');
      const lines = v.split('\n');
      hl.innerHTML = lines.map((l) => DSL.highlightLine(l, lang)).join('\n') + '\n';
      gut.innerHTML = lines.map((_, i) => (UI.edChanged && UI.edChanged.has(i + 1) ? '<span class="chg">' + (i + 1) + ' ▎</span>' : (i + 1) + '  ')).join('\n');
      ta.style.height = Math.max(hl.scrollHeight, $('#editor').clientHeight) + 'px';
      ta.style.width = Math.max(hl.scrollWidth + 30, $('#editor').clientWidth - 46) + 'px';
      const dirty = v !== UI.edOrig;
      $('#edDirty').hidden = !dirty; $('#edSave').disabled = !dirty; $('#edRevert').disabled = !dirty;
    };
    UI.syncEditor = sync;
    ta.addEventListener('input', sync);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart, en = ta.selectionEnd; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + 2; sync(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); UI.saveEditor(); }
      e.stopPropagation();
    });
    $('#edSave').onclick = () => UI.saveEditor();
    $('#edRevert').onclick = () => { ta.value = UI.edOrig; sync(); $('#edErr').hidden = true; };
  };
  UI.openEditor = function (path, text, changedLines, readonly) {
    UI.edPath = path; UI.edOrig = text; UI.edChanged = changedLines || null;
    $('#edPath').textContent = path;
    const ta = $('#code');
    ta.value = text; ta.readOnly = !!readonly;
    $('#edErr').hidden = true;
    UI.syncEditor();
    $('#editor').scrollTop = 0;
  };
  UI.saveEditor = function () { if (!UI.edPath) return; const v = $('#code').value; if (v === UI.edOrig) return; UI.ev.emit('saveFile', UI.edPath, v); };
  UI.editorSaved = function (text) { UI.edOrig = text; UI.syncEditor(); $('#edErr').hidden = true; };
  UI.editorError = function (msg) { const e = $('#edErr'); e.hidden = false; e.textContent = msg; };
  UI.badge = function (which, text) { const b = $(which === 'files' ? '#filesBadge' : '#histBadge'); if (UI.curTab === which) return; b.hidden = !text; b.textContent = text || ''; };

  // ------------------------------------------------------------------ history
  UI.renderHistory = function (cps, headId) {
    const h = $('#hist');
    if (!cps.length) { h.innerHTML = '<div class="hist-empty">No checkpoints yet. Every prompt that changes code creates one.</div>'; return; }
    h.innerHTML = '';
    for (let i = cps.length - 1; i >= 0; i--) {
      const c = cps[i];
      const d = el('div', 'commit' + (c.id === headId ? ' head' : ''));
      d.innerHTML = '<span class="node">' + (c.id === headId ? '●' : '○') + '</span><span class="msg2">' + esc(c.label) + (c.id === headId ? '<span class="tag">HEAD</span>' : '') + '</span><div class="act">' + (c.id !== headId ? '<button data-a="restore">Restore</button>' : '') + '<button data-a="fork">Fork</button></div>' +
        '<span class="meta"><span class="h">' + esc(c.hash) + '</span><span>' + esc(U.fmtAgo(c.time)) + '</span>' + (c.add != null ? '<span class="add">+' + c.add + '</span><span class="del">−' + c.del + '</span>' : '') + (c.by ? '<span>' + esc(c.by) + '</span>' : '') + '</span>';
      d.querySelectorAll('button').forEach((b) => (b.onclick = () => UI.ev.emit(b.dataset.a === 'restore' ? 'restoreCheckpoint' : 'forkCheckpoint', c.id)));
      h.appendChild(d);
    }
  };

  // ------------------------------------------------------------------ modal & toasts
  UI.openModal = function (title, sub, body) {
    const m = $('#modal');
    m.innerHTML = '';
    const s = el('div', 'sheet');
    s.innerHTML = '<div class="sheet-head"><h2>' + esc(title) + '</h2><span class="sub">' + (sub || '') + '</span><button class="x" aria-label="Close">✕</button></div>';
    const b = el('div', 'sheet-body');
    if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
    s.appendChild(b);
    m.appendChild(s);
    m.hidden = false;
    s.querySelector('.x').onclick = UI.closeModal;
    return b;
  };
  UI.closeModal = function () { $('#modal').hidden = true; $('#modal').innerHTML = ''; if (UI.modalClose) { const f = UI.modalClose; UI.modalClose = null; f(); } };
  UI.showAchievements = function (chal) {
    const A = VC.Ach, st = A.state(), c = A.counts();
    let h = '';
    h += '<div class="sec-title"><span>Challenges · optional</span><span>' + c.chal + '/' + c.chalTotal + '</span></div><div class="ach-grid">';
    for (const x of A.challenges) { const done = st.chal[x.id]; h += '<div class="ach ' + (done ? 'done' : '') + '"><div class="n"><span class="s">' + (done ? '◆' : '◇') + '</span>' + esc(x.n) + '</div><div class="d">' + esc(x.d) + '</div><div class="w">' + (done ? 'completed ' + U.fmtAgo(done) : 'not yet') + '</div></div>'; }
    h += '</div><div class="sec-title"><span>Achievements</span><span>' + c.ach + '/' + c.achTotal + '</span></div><div class="ach-grid">';
    for (const x of A.list) {
      const done = st.unlocked[x.id];
      if (!done && x.hidden) h += '<div class="ach locked"><div class="n"><span class="s">✦</span>???</div><div class="d">Hidden. Keep experimenting.</div><div class="w">locked</div></div>';
      else h += '<div class="ach ' + (done ? 'done' : 'locked') + '"><div class="n"><span class="s">✦</span>' + esc(x.n) + '</div><div class="d">' + esc(x.d) + '</div><div class="w">' + (done ? 'unlocked ' + U.fmtAgo(done) : 'locked') + '</div></div>';
    }
    h += '</div>';
    const b = UI.openModal(chal ? 'Challenges' : 'Achievements', 'nothing here is required · play however you like', h);
    if (chal) b.scrollTop = 0; else b.querySelectorAll('.sec-title')[1].scrollIntoView();
  };
  UI.toastQ = [];
  UI.toast = function (o) {
    if (UI.toastQ.some((x) => x.name === o.name)) return;
    UI.toastQ.push(o);
    if (UI.toastQ.length === 1) UI.showToast();
  };
  UI.showToast = function () {
    const o = UI.toastQ[0];
    if (!o) return;
    const t = el('div', 'toast ' + (o.kind || ''));
    t.innerHTML = '<div class="ic">' + esc(o.icon || '✦') + '</div><div><div class="tt">' + esc(o.title) + '</div><div class="tn">' + esc(o.name) + '</div>' + (o.desc ? '<div class="td">' + esc(o.desc) + '</div>' : '') + '</div>';
    $('#toasts').appendChild(t);
    const ms = Math.min(o.ms || 3000, UI.toastQ.length > 1 ? 1700 : 3000);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.remove(); UI.toastQ.shift(); UI.showToast(); }, 300); }, ms);
  };
  UI.rewindMenu = function (items) {
    return new Promise((resolve) => {
      const list = el('div', 'rw-list');
      let sel = items.length - 1;
      const render = () => {
        list.innerHTML = '';
        items.forEach((it, i) => { const b = el('button', 'rw-item' + (i === sel ? ' sel' : '')); b.innerHTML = '<span class="i">' + (i + 1) + '</span><span>' + esc(it.label) + '</span><span class="when">' + esc(U.fmtAgo(it.time)) + '</span>'; b.onclick = () => { done(i); }; list.appendChild(b); });
      };
      const done = (i) => { UI.modalClose = null; window.removeEventListener('keydown', key, true); UI.closeModal(); resolve(i == null ? null : items[i]); };
      const key = (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); sel = U.clamp(sel + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1); render(); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(sel); } };
      render();
      const b = UI.openModal('Rewind', 'restore the code and conversation to before a prompt', list);
      void b;
      UI.modalClose = () => { window.removeEventListener('keydown', key, true); resolve(null); };
      window.addEventListener('keydown', key, true);
      setTimeout(() => { const s = list.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' }); }, 20);
    });
  };

  VC.UI = UI;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
