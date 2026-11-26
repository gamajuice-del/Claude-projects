/* VibeCode — shared utilities. Plain script; attaches to window.VC (or globalThis.VC in Node). */
(function (VC) {
  'use strict';
  const U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  U.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Seeded RNG (mulberry32)
  U.rng = function (seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    const f = function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + f() * (hi - lo);
    f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    return f;
  };
  U.random = U.rng((Date.now() ^ 0x5bd1e995) >>> 0);

  U.hash = function (str) {
    let h = 0x811c9dc5;
    str = String(str);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };
  U.shortHash = (str) => U.hash(str + ':' + U.random()).toString(16).padStart(8, '0').slice(0, 7);
  U.uid = (p = 'id') => p + '_' + Math.floor(U.random() * 1e9).toString(36) + Date.now().toString(36).slice(-4);

  U.pick = (arr, r = U.random) => arr[Math.floor(r() * arr.length)];
  U.shuffle = (arr, r = U.random) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  U.clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  U.same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  U.getPath = function (obj, path) {
    const parts = Array.isArray(path) ? path : String(path).split('.');
    let o = obj;
    for (const p of parts) { if (o == null) return undefined; o = o[p]; }
    return o;
  };
  U.setPath = function (obj, path, value) {
    const parts = Array.isArray(path) ? path : String(path).split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (o[p] == null || typeof o[p] !== 'object') o[p] = {};
      o = o[p];
    }
    o[parts[parts.length - 1]] = value;
  };
  U.delPath = function (obj, path) {
    const parts = Array.isArray(path) ? path : String(path).split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) { if (o == null) return; o = o[parts[i]]; }
    if (o) delete o[parts[parts.length - 1]];
  };

  U.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  U.cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  U.titleCase = (s) => String(s).replace(/\b([a-z])/g, (m) => m.toUpperCase());
  U.plural = function (word, n) {
    if (n === 1) return word;
    const irr = { mouse: 'mice', goose: 'geese', person: 'people', man: 'men', woman: 'women', child: 'children', tooth: 'teeth', foot: 'feet', cactus: 'cacti', fish: 'fish', sheep: 'sheep', deer: 'deer', moose: 'moose', ox: 'oxen', fireball: 'fireballs' };
    const last = String(word).split(' ').pop();
    if (irr[last]) return String(word).slice(0, String(word).length - last.length) + irr[last];
    if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
    if (/(s|x|z|ch|sh)$/.test(word)) return word + 'es';
    if (/fe$/.test(word)) return word.slice(0, -2) + 'ves';
    if (/(wol|el|lea|loa|hal|shel|thie|cal)f$/.test(word)) return word.slice(0, -1) + 'ves';
    if (/(potat|tomat|her)o$/.test(word)) return word + 'es';
    const irregular = { mouse: 'mice', goose: 'geese', person: 'people', man: 'men', woman: 'women', child: 'children', tooth: 'teeth', foot: 'feet', cactus: 'cacti', fish: 'fish', sheep: 'sheep', deer: 'deer', moose: 'moose', ox: 'oxen' };
    return irregular[word] || word + 's';
  };
  U.count = (n, word) => n + ' ' + U.plural(word, n);
  U.listJoin = function (items, conj = 'and') {
    items = items.filter(Boolean);
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return items[0] + ' ' + conj + ' ' + items[1];
    return items.slice(0, -1).join(', ') + ', ' + conj + ' ' + items[items.length - 1];
  };
  U.ident = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1') || 'thing';
  U.human = (ident) => String(ident).replace(/_/g, ' ');

  U.levenshtein = function (a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  };

  // Colors
  U.hexToRgb = function (hex) {
    hex = String(hex || '#888').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    if (isNaN(n)) return { r: 136, g: 136, b: 136 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  U.rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  U.mix = function (a, b, t) {
    const A = U.hexToRgb(a), B = U.hexToRgb(b);
    return U.rgbToHex(U.lerp(A.r, B.r, t), U.lerp(A.g, B.g, t), U.lerp(A.b, B.b, t));
  };
  U.shade = (hex, amt) => (amt >= 0 ? U.mix(hex, '#ffffff', amt) : U.mix(hex, '#000000', -amt));
  U.rgba = function (hex, a) { const c = U.hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; };
  U.hsl = function (h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return U.rgbToHex(255 * f(0), 255 * f(8), 255 * f(4));
  };
  U.hueOf = function (hex) {
    const { r, g, b } = U.hexToRgb(hex);
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    if (max === min) return 0;
    const d = max - min;
    let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return h * 60;
  };
  U.colorFromString = (s) => U.hsl(U.hash(s) % 360, 55 + (U.hash(s + 'x') % 25), 58);

  U.fmtAgo = function (t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  };
  U.fmtClock = function (sec) {
    sec = Math.max(0, Math.ceil(sec));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  };

  // Storage with in-memory fallback (private windows, blocked storage, previews)
  const mem = {};
  U.store = {
    get(key, fallback) {
      try {
        const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : mem[key];
        if (v == null) return fallback;
        return JSON.parse(v);
      } catch (e) {
        return mem[key] != null ? JSON.parse(mem[key]) : fallback;
      }
    },
    set(key, value) {
      const s = JSON.stringify(value);
      mem[key] = s;
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, s); return true; } catch (e) { return false; }
    },
    remove(key) {
      delete mem[key];
      try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
    keys(prefix) {
      const out = new Set(Object.keys(mem).filter((k) => k.startsWith(prefix)));
      try {
        if (typeof localStorage !== 'undefined') {
          for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) out.add(k); }
        }
      } catch (e) { /* ignore */ }
      return [...out];
    },
  };

  // Tiny event emitter
  U.emitter = function () {
    const map = {};
    return {
      on(ev, fn) { (map[ev] = map[ev] || []).push(fn); return () => this.off(ev, fn); },
      off(ev, fn) { if (map[ev]) map[ev] = map[ev].filter((f) => f !== fn); },
      emit(ev, ...args) { (map[ev] || []).slice().forEach((f) => { try { f(...args); } catch (e) { console.error(e); } }); },
    };
  };

  // Base64 for share codes (unicode-safe)
  U.toB64 = function (str) {
    if (typeof btoa === 'undefined') return Buffer.from(str, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(str)));
  };
  U.fromB64 = function (b64) {
    if (typeof atob === 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(b64)));
  };

  VC.U = U;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
