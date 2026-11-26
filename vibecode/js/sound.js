/* VibeCode — WebAudio synth: game SFX, UI sounds and generative music. */
(function (VC) {
  'use strict';
  const S = { ctx: null, muted: false, musicMood: null, uiOn: true, volume: 0.7 };

  S.init = function () {
    if (S.ctx) { if (S.ctx.state === 'suspended') S.ctx.resume().catch(() => {}); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const c = S.ctx = new AC();
      S.master = c.createGain(); S.master.gain.value = S.muted ? 0 : S.volume; S.master.connect(c.destination);
      S.comp = c.createDynamicsCompressor(); S.comp.threshold.value = -14; S.comp.ratio.value = 4; S.comp.connect(S.master);
      S.sfxBus = c.createGain(); S.sfxBus.gain.value = 0.55; S.sfxBus.connect(S.comp);
      S.uiBus = c.createGain(); S.uiBus.gain.value = 0.32; S.uiBus.connect(S.comp);
      S.musicBus = c.createGain(); S.musicBus.gain.value = 0.0; S.musicBus.connect(S.comp);
      // simple delay for music space
      S.delay = c.createDelay(1); S.delay.delayTime.value = 0.33;
      S.fb = c.createGain(); S.fb.gain.value = 0.28;
      S.wet = c.createGain(); S.wet.gain.value = 0.25;
      S.delay.connect(S.fb); S.fb.connect(S.delay); S.delay.connect(S.wet); S.wet.connect(S.musicBus);
      const len = c.sampleRate * 1.5;
      S.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = S.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { return false; }
  };
  S.ready = () => !!S.ctx && S.ctx.state === 'running';

  S.setMuted = function (m) {
    S.muted = !!m;
    if (S.master) S.master.gain.setTargetAtTime(S.muted ? 0 : S.volume, S.ctx.currentTime, 0.05);
  };

  function tone(o) {
    const c = S.ctx; if (!c) return;
    const t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.dur || 0.1));
    if (o.detune) osc.detune.value = o.detune;
    const v = (o.vol == null ? 0.3 : o.vol);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur || 0.1));
    osc.connect(g); g.connect(o.bus || S.sfxBus);
    if (o.send) g.connect(S.delay);
    osc.start(t); osc.stop(t + (o.dur || 0.1) + 0.05);
  }
  function noise(o) {
    const c = S.ctx; if (!c) return;
    const t = c.currentTime + (o.delay || 0);
    const src = c.createBufferSource(); src.buffer = S.noiseBuf;
    const f = c.createBiquadFilter(); f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 2000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + (o.dur || 0.2));
    f.Q.value = o.q || 1;
    const g = c.createGain();
    g.gain.setValueAtTime(o.vol == null ? 0.3 : o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur || 0.2));
    src.connect(f); f.connect(g); g.connect(o.bus || S.sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + (o.dur || 0.2) + 0.05);
  }
  S.tone = tone; S.noise = noise;

  const last = {};
  S.sfx = function (name, vol) {
    if (!S.ctx || S.muted) return;
    const now = S.ctx.currentTime;
    if (last[name] && now - last[name] < 0.035) return; // rate limit
    last[name] = now;
    const v = vol == null ? 1 : vol;
    switch (name) {
      case 'jump': tone({ type: 'square', f0: 280, f1: 620, dur: 0.13, vol: 0.16 * v }); break;
      case 'shoot': tone({ type: 'square', f0: 880, f1: 180, dur: 0.08, vol: 0.1 * v }); noise({ f0: 4000, f1: 800, dur: 0.05, vol: 0.06 * v }); break;
      case 'laser': tone({ type: 'sawtooth', f0: 1500, f1: 260, dur: 0.12, vol: 0.09 * v }); break;
      case 'fire': noise({ f0: 1800, f1: 300, dur: 0.18, vol: 0.12 * v }); tone({ type: 'sine', f0: 200, f1: 90, dur: 0.15, vol: 0.08 * v }); break;
      case 'magic': [988, 1319, 1760].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 0.12, vol: 0.07 * v, delay: i * 0.035 })); break;
      case 'hit': noise({ f0: 2500, f1: 400, dur: 0.06, vol: 0.12 * v }); tone({ type: 'triangle', f0: 220, f1: 90, dur: 0.08, vol: 0.12 * v }); break;
      case 'hurt': tone({ type: 'sawtooth', f0: 320, f1: 80, dur: 0.28, vol: 0.16 * v }); noise({ f0: 1200, dur: 0.12, vol: 0.08 * v }); break;
      case 'pop': tone({ type: 'sine', f0: 420, f1: 1100, dur: 0.07, vol: 0.14 * v }); noise({ f0: 3000, f1: 600, dur: 0.05, vol: 0.05 * v }); break;
      case 'coin': tone({ type: 'square', f0: 988, dur: 0.07, vol: 0.09 * v }); tone({ type: 'square', f0: 1319, dur: 0.16, vol: 0.09 * v, delay: 0.06 }); break;
      case 'powerup': [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.09, vol: 0.07 * v, delay: i * 0.05 })); break;
      case 'explode': noise({ f0: 1400, f1: 60, dur: 0.6, vol: 0.32 * v }); tone({ type: 'sine', f0: 90, f1: 28, dur: 0.5, vol: 0.28 * v }); break;
      case 'win': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.16, vol: 0.09, delay: i * 0.11, send: true })); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.14, delay: i * 0.18 })); break;
      case 'blip': tone({ type: 'sine', f0: 1200, dur: 0.05, vol: 0.06 * v }); break;
      case 'bounce': tone({ type: 'sine', f0: 180, f1: 520, dur: 0.11, vol: 0.14 * v }); break;
      case 'dash': noise({ filter: 'highpass', f0: 600, f1: 4000, dur: 0.16, vol: 0.12 * v }); break;
      case 'swing': noise({ filter: 'bandpass', f0: 400, f1: 3000, dur: 0.12, vol: 0.14 * v, q: 3 }); break;
      case 'splash': noise({ filter: 'bandpass', f0: 1500, f1: 300, dur: 0.3, vol: 0.12 * v }); break;
      case 'thunder': noise({ f0: 500, f1: 40, dur: 1.6, vol: 0.3 }); break;
      case 'quack': tone({ type: 'sawtooth', f0: 640, f1: 420, dur: 0.1, vol: 0.12 * v }); tone({ type: 'sawtooth', f0: 600, f1: 380, dur: 0.12, vol: 0.1 * v, delay: 0.13 }); break;
      default: tone({ type: 'sine', f0: 660, dur: 0.06, vol: 0.06 * v });
    }
  };

  S.ui = function (name) {
    if (!S.ctx || S.muted || !S.uiOn) return;
    switch (name) {
      case 'send': tone({ type: 'sine', f0: 520, f1: 780, dur: 0.07, vol: 0.12, bus: S.uiBus }); break;
      case 'tick': tone({ type: 'sine', f0: 1800, dur: 0.02, vol: 0.04, bus: S.uiBus }); break;
      case 'write': tone({ type: 'triangle', f0: 880, dur: 0.05, vol: 0.06, bus: S.uiBus }); tone({ type: 'triangle', f0: 1320, dur: 0.06, vol: 0.05, bus: S.uiBus, delay: 0.04 }); break;
      case 'done': tone({ type: 'sine', f0: 660, dur: 0.12, vol: 0.1, bus: S.uiBus }); tone({ type: 'sine', f0: 990, dur: 0.2, vol: 0.1, bus: S.uiBus, delay: 0.09 }); break;
      case 'pass': tone({ type: 'triangle', f0: 784, dur: 0.08, vol: 0.07, bus: S.uiBus }); tone({ type: 'triangle', f0: 1175, dur: 0.12, vol: 0.07, bus: S.uiBus, delay: 0.07 }); break;
      case 'fail': tone({ type: 'square', f0: 220, f1: 160, dur: 0.16, vol: 0.06, bus: S.uiBus }); tone({ type: 'square', f0: 180, f1: 120, dur: 0.2, vol: 0.06, bus: S.uiBus, delay: 0.15 }); break;
      case 'achievement': [523, 659, 784, 1047, 1568].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.5 - i * 0.05, vol: 0.09, bus: S.uiBus, delay: i * 0.07 })); break;
      case 'open': tone({ type: 'sine', f0: 440, f1: 660, dur: 0.1, vol: 0.06, bus: S.uiBus }); break;
      case 'error': tone({ type: 'square', f0: 140, dur: 0.1, vol: 0.06, bus: S.uiBus }); tone({ type: 'square', f0: 140, dur: 0.12, vol: 0.06, bus: S.uiBus, delay: 0.13 }); break;
      case 'toggle': tone({ type: 'sine', f0: 900, dur: 0.035, vol: 0.06, bus: S.uiBus }); break;
      case 'boot': [220, 330, 440, 660].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 0.35, vol: 0.05, bus: S.uiBus, delay: i * 0.09 })); break;
      default: break;
    }
  };

  // ------------------------------------------------------------- music
  const N = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const MOODS = {
    chill: { tempo: 86, root: 57, scale: [0, 2, 3, 5, 7, 9, 10], prog: [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [7, 10, 14, 17]], lead: 'triangle', pad: 'sine', bass: 'sine', drums: 'soft', density: 0.32 },
    epic: { tempo: 118, root: 50, scale: [0, 2, 3, 5, 7, 8, 10], prog: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], lead: 'sawtooth', pad: 'sawtooth', bass: 'triangle', drums: 'big', density: 0.45 },
    spooky: { tempo: 72, root: 52, scale: [0, 1, 3, 5, 6, 8, 10], prog: [[0, 3, 6], [1, 5, 8], [0, 3, 6], [11, 14, 17]], lead: 'sine', pad: 'triangle', bass: 'sine', drums: 'none', density: 0.22 },
    happy: { tempo: 126, root: 60, scale: [0, 2, 4, 5, 7, 9, 11], prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], lead: 'square', pad: 'triangle', bass: 'triangle', drums: 'pop', density: 0.5 },
    dreamy: { tempo: 80, root: 62, scale: [0, 2, 4, 6, 7, 9, 11], prog: [[0, 4, 7, 11], [2, 6, 9, 14], [7, 11, 14, 18], [4, 7, 11, 14]], lead: 'sine', pad: 'sine', bass: 'sine', drums: 'soft', density: 0.4 },
    intense: { tempo: 142, root: 52, scale: [0, 2, 3, 5, 7, 8, 11], prog: [[0, 3, 7], [0, 3, 7], [8, 12, 15], [7, 11, 14]], lead: 'sawtooth', pad: 'square', bass: 'sawtooth', drums: 'big', density: 0.55 },
    retro: { tempo: 132, root: 60, scale: [0, 2, 4, 5, 7, 9, 11], prog: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], lead: 'square', pad: 'square', bass: 'triangle', drums: 'chip', density: 0.6 },
  };
  S.MOODS = Object.keys(MOODS);
  let timer = null, step = 0, nextT = 0, mood = null, tempoMul = 1, rngS = 1;
  const rnd = () => { rngS = (rngS * 16807) % 2147483647; return rngS / 2147483647; };

  S.setMusic = function (m, tempo) {
    if (m && !MOODS[m]) m = 'chill';
    if (m === mood && timer) { tempoMul = tempo ? tempo / MOODS[m].tempo : 1; return; }
    mood = m;
    S.musicMood = m;
    if (!S.ctx) return;
    if (!m) { S.musicBus.gain.setTargetAtTime(0, S.ctx.currentTime, 0.3); if (timer) { clearInterval(timer); timer = null; } return; }
    tempoMul = tempo ? U.clamp(tempo / MOODS[m].tempo, 0.5, 2) : 1;
    S.musicBus.gain.setTargetAtTime(0.42, S.ctx.currentTime, 0.6);
    if (!timer) { step = 0; nextT = S.ctx.currentTime + 0.1; rngS = 12345; timer = setInterval(schedule, 30); }
  };
  const U = VC.U || { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) };

  function schedule() {
    if (!S.ctx || !mood) return;
    const M = MOODS[mood];
    const spb = 60 / (M.tempo * tempoMul) / 4;
    while (nextT < S.ctx.currentTime + 0.12) {
      playStep(M, step, nextT, spb);
      nextT += spb; step++;
    }
  }
  function note(type, midi, t, dur, vol, send) {
    const c = S.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = N(midi);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (type === 'sawtooth' || type === 'square') {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = type === 'square' ? 2600 : 1800;
      o.connect(f); f.connect(g);
    } else o.connect(g);
    g.connect(S.musicBus);
    if (send) g.connect(S.delay);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function drum(kind, t, v) {
    const c = S.ctx;
    if (kind === 'kick') { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); g.gain.setValueAtTime(0.5 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g); g.connect(S.musicBus); o.start(t); o.stop(t + 0.25); }
    else {
      const src = c.createBufferSource(); src.buffer = S.noiseBuf;
      const f = c.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const g = c.createGain(); g.gain.setValueAtTime((kind === 'hat' ? 0.08 : 0.22) * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'hat' ? 0.04 : 0.14));
      src.connect(f); f.connect(g); g.connect(S.musicBus); src.start(t, Math.random()); src.stop(t + 0.2);
    }
  }
  function playStep(M, s, t, spb) {
    const bar = Math.floor(s / 16) % M.prog.length, pos = s % 16;
    const ch = M.prog[bar];
    if (pos === 0) ch.forEach((iv) => note(M.pad, M.root + iv, t, spb * 15, M.pad === 'sine' ? 0.05 : 0.025, true));
    if (pos % 4 === 0 || (M.drums === 'big' && pos % 2 === 0)) note(M.bass, M.root - 12 + ch[0] + (pos === 8 && rnd() < 0.3 ? 7 : 0), t, spb * (M.drums === 'big' ? 1.6 : 3.2), 0.12);
    if (rnd() < M.density && pos % 2 === 0) {
      const iv = rnd() < 0.6 ? ch[Math.floor(rnd() * ch.length)] : M.scale[Math.floor(rnd() * M.scale.length)];
      note(M.lead, M.root + 12 + iv, t, spb * (rnd() < 0.3 ? 4 : 2), M.lead === 'sine' ? 0.06 : 0.035, true);
    }
    switch (M.drums) {
      case 'big': if (pos % 4 === 0) drum('kick', t, 1); if (pos === 4 || pos === 12) drum('snare', t, 1); if (pos % 2 === 1) drum('hat', t, 0.8); break;
      case 'pop': if (pos === 0 || pos === 8 || pos === 10) drum('kick', t, 0.8); if (pos === 4 || pos === 12) drum('snare', t, 0.8); if (pos % 2 === 0) drum('hat', t, 0.7); break;
      case 'chip': if (pos % 4 === 0) drum('kick', t, 0.7); if (pos === 4 || pos === 12) drum('snare', t, 0.6); if (pos % 2 === 1) drum('hat', t, 0.6); break;
      case 'soft': if (pos === 0) drum('kick', t, 0.4); if (pos % 4 === 2) drum('hat', t, 0.5); break;
      default: break;
    }
  }

  VC.Sound = S;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
