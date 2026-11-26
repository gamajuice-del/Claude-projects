/* VibeCode — procedural level generators. Produce a tile grid plus spawn points. */
(function (VC) {
  'use strict';
  const U = VC.U;
  const T = { EMPTY: 0, WALL: 1, PLATFORM: 2, LAVA: 3, WATER: 4, ICE: 5, SPIKES: 6, BOUNCE: 7, TREE: 8 };
  const SOLID = new Set([T.WALL, T.TREE]);
  const Levels = { T, SOLID };
  Levels.NAMES = { lava: T.LAVA, water: T.WATER, ice: T.ICE, spikes: T.SPIKES, bounce: T.BOUNCE, wall: T.WALL, tree: T.TREE, platform: T.PLATFORM };
  Levels.KIND = ['empty', 'wall', 'platform', 'lava', 'water', 'ice', 'spikes', 'bounce', 'tree'];

  function Grid(cols, rows, ts) {
    this.cols = cols; this.rows = rows; this.ts = ts;
    this.tiles = new Uint8Array(cols * rows);
  }
  Grid.prototype.get = function (c, r) { if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1; return this.tiles[r * this.cols + c]; };
  Grid.prototype.set = function (c, r, v) { if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return; this.tiles[r * this.cols + c] = v; };
  Grid.prototype.fill = function (c0, r0, c1, r1, v) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.set(c, r, v); };
  Grid.prototype.border = function (v) { this.fill(0, 0, this.cols - 1, 0, v); this.fill(0, this.rows - 1, this.cols - 1, this.rows - 1, v); this.fill(0, 0, 0, this.rows - 1, v); this.fill(this.cols - 1, 0, this.cols - 1, this.rows - 1, v); };
  Grid.prototype.isSolid = function (c, r) { return SOLID.has(this.get(c, r)); };
  Levels.Grid = Grid;

  const SIDE = { platformer: true, runner: true };

  Levels.generate = function (spec) {
    const lv = spec.level || {};
    const ph = spec.world.physics;
    const ts = U.clamp(lv.tile || 40, 16, 96);
    const rng = U.rng((lv.seed || 1) * 7919 + 17);
    let W = U.clamp(spec.world.width || 1600, 480, 24000);
    let H = U.clamp(spec.world.height || 1000, 360, 12000);
    let type = lv.type || 'empty';
    if (ph === 'shmup' || ph === 'paddle') { W = Math.min(W, 1200); H = Math.min(H, 760); }
    const gen = GEN[type] || GEN.empty;
    const out = gen({ W, H, ts, rng, side: !!SIDE[ph], ph, density: U.clamp(lv.density == null ? 0.5 : lv.density, 0, 1), spec });
    out.type = type;
    // hazards sprinkled on top
    (lv.hazards || []).forEach((h) => sprinkle(out, h, rng, !!SIDE[ph], U.clamp(lv.density == null ? 0.5 : lv.density, 0, 1)));
    finalize(out, rng, !!SIDE[ph]);
    return out;
  };

  function mk(W, H, ts) {
    const g = new Grid(Math.ceil(W / ts), Math.ceil(H / ts), ts);
    return { grid: g, w: g.cols * ts, h: g.rows * ts, ts, start: null, goal: null, grid2: [], checkpoints: [], floorOpen: false };
  }
  const center = (c, r, ts) => ({ x: c * ts + ts / 2, y: r * ts + ts / 2 });

  function clearAround(g, c, r, rad) {
    for (let y = r - rad; y <= r + rad; y++) for (let x = c - rad; x <= c + rad; x++) {
      if (x <= 0 || y <= 0 || x >= g.cols - 1 || y >= g.rows - 1) continue;
      if (g.get(x, y) !== T.PLATFORM) g.set(x, y, T.EMPTY);
    }
  }

  const GEN = {};
  GEN.empty = function (o) {
    const L = mk(o.W, o.H, o.ts); const g = L.grid;
    if (o.side) { g.fill(0, g.rows - 2, g.cols - 1, g.rows - 1, T.WALL); L.start = { x: o.ts * 3, y: (g.rows - 3) * o.ts }; }
    else L.start = { x: L.w / 2, y: L.h / 2 };
    return L;
  };
  GEN.arena = function (o) {
    const L = mk(o.W, o.H, o.ts); const g = L.grid;
    g.border(T.WALL);
    if (o.side) {
      g.fill(0, g.rows - 2, g.cols - 1, g.rows - 1, T.WALL);
      const n = 4 + Math.floor(o.density * 6);
      for (let i = 0; i < n; i++) {
        const len = o.rng.int(3, 7), c = o.rng.int(2, g.cols - len - 2), r = o.rng.int(Math.floor(g.rows * 0.35), g.rows - 5);
        g.fill(c, r, c + len - 1, r, T.PLATFORM);
      }
      L.start = { x: o.ts * 3, y: (g.rows - 3) * o.ts };
    } else {
      const cx = Math.floor(g.cols / 2), cy = Math.floor(g.rows / 2);
      const dx = Math.floor(g.cols / 4), dy = Math.floor(g.rows / 4);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => g.fill(cx + sx * dx - 1, cy + sy * dy - 1, cx + sx * dx, cy + sy * dy, T.WALL));
      L.start = center(cx, cy, o.ts);
    }
    return L;
  };
  GEN.obstacles = function (o) {
    const L = GEN.arena(o); const g = L.grid;
    const n = Math.floor((g.cols * g.rows) / 60 * (0.4 + o.density));
    for (let i = 0; i < n; i++) {
      const c = o.rng.int(2, g.cols - 3), r = o.rng.int(2, g.rows - (o.side ? 4 : 3));
      if (o.side) { if (o.rng.chance(0.5)) g.fill(c, r, c + o.rng.int(1, 4), r, T.PLATFORM); else g.set(c, g.rows - 3, T.WALL); }
      else { const k = o.rng.chance(0.3) ? T.TREE : T.WALL; g.set(c, r, k); if (o.rng.chance(0.5)) g.set(c + 1, r, k); if (o.rng.chance(0.4)) g.set(c, r + 1, k); }
    }
    const sc = Math.floor(L.start.x / o.ts), sr = Math.floor(L.start.y / o.ts);
    clearAround(g, sc, sr, 2);
    return L;
  };
  GEN.forest = function (o) {
    const L = mk(o.W, o.H, o.ts); const g = L.grid;
    g.border(T.TREE);
    if (o.side) { g.fill(0, g.rows - 2, g.cols - 1, g.rows - 1, T.WALL); L.start = { x: o.ts * 3, y: (g.rows - 3) * o.ts }; return L; }
    const n = Math.floor(g.cols * g.rows * (0.05 + o.density * 0.08));
    for (let i = 0; i < n; i++) g.set(o.rng.int(1, g.cols - 2), o.rng.int(1, g.rows - 2), T.TREE);
    L.start = center(Math.floor(g.cols / 2), Math.floor(g.rows / 2), o.ts);
    clearAround(g, Math.floor(g.cols / 2), Math.floor(g.rows / 2), 2);
    return L;
  };
  GEN.city = function (o) {
    const L = mk(o.W, o.H, o.ts); const g = L.grid;
    g.border(T.WALL);
    const block = 5, street = 3;
    for (let r = street; r < g.rows - 2; r += block + street) for (let c = street; c < g.cols - 2; c += block + street) {
      const park = o.rng.chance(0.18);
      for (let y = r; y < Math.min(r + block, g.rows - 1); y++) for (let x = c; x < Math.min(c + block, g.cols - 1); x++) {
        if (park) { if (o.rng.chance(0.25)) g.set(x, y, T.TREE); } else g.set(x, y, T.WALL);
      }
    }
    L.start = center(1 + Math.floor(street / 2), 1 + Math.floor(street / 2), o.ts);
    L.goal = center(g.cols - 2 - Math.floor(street / 2), g.rows - 2 - Math.floor(street / 2), o.ts);
    if (o.side) { g.fill(0, g.rows - 2, g.cols - 1, g.rows - 1, T.WALL); }
    return L;
  };
  GEN.maze = function (o) {
    const ts = o.ts;
    const cw = Math.max(4, Math.floor((o.W / ts - 1) / 3)), ch = Math.max(3, Math.floor((o.H / ts - 1) / 3));
    const L = mk((cw * 3 + 1) * ts, (ch * 3 + 1) * ts, ts); const g = L.grid;
    g.fill(0, 0, g.cols - 1, g.rows - 1, T.WALL);
    const seen = new Uint8Array(cw * ch);
    const carve = (cx, cy) => g.fill(cx * 3 + 1, cy * 3 + 1, cx * 3 + 2, cy * 3 + 2, T.EMPTY);
    const stack = [[0, 0]]; seen[0] = 1; carve(0, 0);
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy, dx, dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen[ny * cw + nx]);
      if (!nb.length) { stack.pop(); continue; }
      const [nx, ny, dx, dy] = o.rng.pick(nb);
      seen[ny * cw + nx] = 1; carve(nx, ny);
      // knock down the wall between
      if (dx) g.fill(Math.max(x, nx) * 3, y * 3 + 1, Math.max(x, nx) * 3, y * 3 + 2, T.EMPTY);
      else g.fill(x * 3 + 1, Math.max(y, ny) * 3, x * 3 + 2, Math.max(y, ny) * 3, T.EMPTY);
      stack.push([nx, ny]);
    }
    // extra loops for less frustration
    const loops = Math.floor(cw * ch * (0.06 + (1 - o.density) * 0.1));
    for (let i = 0; i < loops; i++) {
      const c = o.rng.int(1, g.cols - 2), r = o.rng.int(1, g.rows - 2);
      if (g.get(c, r) === T.WALL && ((c % 3 === 0) !== (r % 3 === 0))) {
        if (c % 3 === 0) g.fill(c, Math.floor(r / 3) * 3 + 1, c, Math.floor(r / 3) * 3 + 2, T.EMPTY);
        else g.fill(Math.floor(c / 3) * 3 + 1, r, Math.floor(c / 3) * 3 + 2, r, T.EMPTY);
      }
    }
    L.start = { x: 2 * ts, y: 2 * ts };
    L.goal = { x: ((cw - 1) * 3 + 2) * ts, y: ((ch - 1) * 3 + 2) * ts };
    return L;
  };
  GEN.caves = function (o) {
    const L = mk(o.W, o.H, o.ts); const g = L.grid;
    const fill = 0.38 + o.density * 0.14;
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) g.set(c, r, o.rng.chance(fill) ? T.WALL : T.EMPTY);
    for (let it = 0; it < 5; it++) {
      const copy = g.tiles.slice();
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        let n = 0;
        for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) { if (!x && !y) continue; const v = g.get(c + x, r + y); if (v === -1 || v === T.WALL) n++; }
        copy[r * g.cols + c] = n >= 5 ? T.WALL : n <= 3 ? T.EMPTY : copy[r * g.cols + c];
      }
      g.tiles = copy;
    }
    g.border(T.WALL);
    const sc = Math.floor(g.cols / 2), sr = Math.floor(g.rows / 2);
    clearAround(g, sc, sr, 2);
    const dist = flood(g, sc, sr);
    let far = 0, fc = sc, fr = sr;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < 0 && g.tiles[i] === T.EMPTY) g.tiles[i] = T.WALL;
      if (dist[i] > far) { far = dist[i]; fc = i % g.cols; fr = Math.floor(i / g.cols); }
    }
    L.start = center(sc, sr, o.ts);
    L.goal = center(fc, fr, o.ts);
    if (o.side) {
      // drop the start onto a floor
      let r = sr; while (r < g.rows - 1 && !g.isSolid(sc, r + 1)) r++;
      L.start = center(sc, r, o.ts);
    }
    return L;
  };
  GEN.dungeon = function (o) {
    const L = mk(o.W, o.H, o.ts); const g = L.grid;
    g.fill(0, 0, g.cols - 1, g.rows - 1, T.WALL);
    const rooms = [];
    const want = 6 + Math.floor(o.density * 6);
    for (let tries = 0; tries < 300 && rooms.length < want; tries++) {
      const w = o.rng.int(5, 10), h = o.rng.int(4, 8);
      const x = o.rng.int(1, g.cols - w - 2), y = o.rng.int(1, g.rows - h - 2);
      if (rooms.some((q) => x < q.x + q.w + 2 && x + w + 2 > q.x && y < q.y + q.h + 2 && y + h + 2 > q.y)) continue;
      rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
    }
    if (!rooms.length) return GEN.arena(o);
    rooms.sort((a, b) => a.cx - b.cx);
    rooms.forEach((q) => g.fill(q.x, q.y, q.x + q.w - 1, q.y + q.h - 1, T.EMPTY));
    for (let i = 1; i < rooms.length; i++) {
      const a = rooms[i - 1], b = rooms[i];
      if (o.rng.chance(0.5)) { g.fill(Math.min(a.cx, b.cx), a.cy, Math.max(a.cx, b.cx), a.cy + 1, T.EMPTY); g.fill(b.cx, Math.min(a.cy, b.cy), b.cx + 1, Math.max(a.cy, b.cy), T.EMPTY); }
      else { g.fill(a.cx, Math.min(a.cy, b.cy), a.cx + 1, Math.max(a.cy, b.cy), T.EMPTY); g.fill(Math.min(a.cx, b.cx), b.cy, Math.max(a.cx, b.cx), b.cy + 1, T.EMPTY); }
    }
    L.rooms = rooms.map((q) => ({ x: q.x * o.ts, y: q.y * o.ts, w: q.w * o.ts, h: q.h * o.ts }));
    L.start = center(rooms[0].cx, rooms[0].cy, o.ts);
    L.goal = center(rooms[rooms.length - 1].cx, rooms[rooms.length - 1].cy, o.ts);
    if (o.side) { let r = rooms[0].cy; while (!g.isSolid(rooms[0].cx, r + 1) && r < g.rows - 2) r++; L.start = center(rooms[0].cx, r, o.ts); }
    return L;
  };
  GEN.platforms = function (o) {
    const W = Math.max(o.W, 2400), H = Math.min(Math.max(o.H, 720), 1400);
    const L = mk(W, H, o.ts); const g = L.grid; const rng = o.rng;
    const groundR = g.rows - 2;
    g.fill(0, groundR, g.cols - 1, g.rows - 1, T.WALL);
    // pits
    let c = 10;
    while (c < g.cols - 12) {
      if (rng.chance(0.35)) { const w = rng.int(2, 3 + Math.floor(o.density * 2)); g.fill(c, groundR, c + w - 1, g.rows - 1, T.EMPTY); L.floorOpen = true; c += w + rng.int(6, 12); }
      else c += rng.int(4, 9);
    }
    // floating platforms by random walk
    c = 5; let r = groundR - 3;
    while (c < g.cols - 8) {
      const len = rng.int(3, 7);
      r = U.clamp(r + rng.int(-3, 3), 3, groundR - 3);
      g.fill(c, r, c + len - 1, r, T.PLATFORM);
      if (rng.chance(0.25)) g.fill(c + 1, r - rng.int(3, 4), c + len - 2, r - rng.int(3, 4), T.PLATFORM);
      c += len + rng.int(2, 4);
    }
    // walls at the ends
    g.fill(0, 0, 0, g.rows - 1, T.WALL); g.fill(g.cols - 1, 0, g.cols - 1, g.rows - 1, T.WALL);
    // a few solid steps
    for (let i = 0; i < Math.floor(g.cols / 25); i++) { const x = rng.int(12, g.cols - 14); if (g.get(x, groundR) === T.WALL) g.fill(x, groundR - rng.int(1, 2), x + 1, groundR - 1, T.WALL); }
    g.fill(1, groundR, 8, g.rows - 1, T.WALL); g.fill(g.cols - 9, groundR, g.cols - 2, g.rows - 1, T.WALL);
    g.fill(1, 1, 6, groundR - 1, T.EMPTY);
    L.start = { x: 3 * o.ts, y: (groundR - 1) * o.ts };
    L.goal = { x: (g.cols - 4) * o.ts, y: (groundR - 1) * o.ts + o.ts / 2 };
    return L;
  };
  GEN.tower = function (o) {
    const W = Math.min(Math.max(o.W, 800), 1280), H = Math.max(o.H, 2800);
    const L = mk(W, H, o.ts); const g = L.grid; const rng = o.rng;
    g.fill(0, 0, 0, g.rows - 1, T.WALL); g.fill(g.cols - 1, 0, g.cols - 1, g.rows - 1, T.WALL);
    g.fill(0, g.rows - 2, g.cols - 1, g.rows - 1, T.WALL);
    let r = g.rows - 5, side = 0;
    while (r > 4) {
      const len = rng.int(3, 6);
      const c = side ? rng.int(Math.floor(g.cols / 2), g.cols - len - 2) : rng.int(2, Math.floor(g.cols / 2) - 2);
      g.fill(c, r, c + len - 1, r, T.PLATFORM);
      if (rng.chance(0.3)) { const c2 = rng.int(2, g.cols - 5); g.fill(c2, r - 1, c2 + 2, r - 1, T.PLATFORM); }
      side = 1 - side; r -= rng.int(2, 3);
    }
    g.fill(2, 2, g.cols - 3, 2, T.PLATFORM);
    L.start = { x: g.cols / 2 * o.ts, y: (g.rows - 3) * o.ts };
    L.goal = { x: g.cols / 2 * o.ts, y: 1 * o.ts + o.ts / 2 };
    return L;
  };
  GEN.islands = function (o) {
    const L = mk(o.W, o.H, o.ts); const g = L.grid; const rng = o.rng;
    const sea = (o.spec.level.hazards || []).includes('lava') ? T.LAVA : T.WATER;
    g.fill(0, 0, g.cols - 1, g.rows - 1, sea);
    const isles = [];
    const n = 5 + Math.floor(o.density * 5);
    for (let i = 0; i < n; i++) {
      const cx = rng.int(3, g.cols - 4), cy = rng.int(3, g.rows - 4), rad = rng.int(2, 5);
      isles.push({ cx, cy });
      for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rng.int(-1, 1)) g.set(cx + x, cy + y, T.EMPTY);
      if (rng.chance(0.5)) g.set(cx + rng.int(-1, 1), cy + rng.int(-1, 1), T.TREE);
    }
    for (let i = 1; i < isles.length; i++) {
      const a = isles[i - 1], b = isles[i];
      g.fill(Math.min(a.cx, b.cx), a.cy, Math.max(a.cx, b.cx), a.cy, T.EMPTY);
      g.fill(b.cx, Math.min(a.cy, b.cy), b.cx, Math.max(a.cy, b.cy), T.EMPTY);
    }
    g.border(T.WALL);
    clearAround(g, isles[0].cx, isles[0].cy, 1);
    L.start = center(isles[0].cx, isles[0].cy, o.ts);
    L.goal = center(isles[isles.length - 1].cx, isles[isles.length - 1].cy, o.ts);
    return L;
  };
  GEN.runner = function (o) {
    const L = mk(Math.max(o.W, 9000), Math.min(Math.max(o.H, 640), 800), o.ts); const g = L.grid; const rng = o.rng;
    const gr = g.rows - 2;
    g.fill(0, gr, g.cols - 1, g.rows - 1, T.WALL);
    g.fill(0, 0, 0, g.rows - 1, T.WALL);
    let c = 18;
    while (c < g.cols - 15) {
      const roll = rng();
      const hard = c / g.cols;
      if (roll < 0.3) { const w = rng.int(2, 3 + Math.floor(hard * 2)); g.fill(c, gr, c + w - 1, g.rows - 1, T.EMPTY); L.floorOpen = true; c += w + rng.int(5, 9); }
      else if (roll < 0.55) { g.fill(c, gr - 1, c, gr - 1, T.SPIKES); if (hard > 0.4 && rng.chance(0.5)) g.set(c + 1, gr - 1, T.SPIKES); c += rng.int(6, 10); }
      else if (roll < 0.75) { const h = rng.int(1, 2); g.fill(c, gr - h, c + 1, gr - 1, T.WALL); c += rng.int(6, 10); }
      else { const len = rng.int(3, 6); g.fill(c, gr - 3, c + len, gr - 3, T.PLATFORM); c += len + rng.int(3, 6); }
    }
    g.fill(g.cols - 1, 0, g.cols - 1, g.rows - 1, T.WALL);
    L.start = { x: 4 * o.ts, y: (gr - 1) * o.ts };
    L.goal = { x: (g.cols - 6) * o.ts, y: (gr - 1) * o.ts + o.ts / 2 };
    return L;
  };
  GEN.pipes = function (o) {
    const L = mk(Math.max(o.W, 8000), Math.min(Math.max(o.H, 640), 760), o.ts); const g = L.grid; const rng = o.rng;
    g.fill(0, g.rows - 1, g.cols - 1, g.rows - 1, T.SPIKES);
    g.fill(0, 0, g.cols - 1, 0, T.WALL);
    const gap = Math.max(4, 6 - Math.round(o.density * 2));
    for (let c = 16; c < g.cols - 10; c += rng.int(7, 10)) {
      const top = rng.int(2, g.rows - gap - 3);
      g.fill(c, 1, c + 1, top, T.WALL);
      g.fill(c, top + gap + 1, c + 1, g.rows - 2, T.WALL);
    }
    L.start = { x: 5 * o.ts, y: g.rows / 2 * o.ts };
    L.goal = { x: (g.cols - 5) * o.ts, y: g.rows / 2 * o.ts };
    L.floorOpen = true;
    return L;
  };
  GEN.track = function (o) {
    const L = mk(Math.max(o.W, 1800), Math.max(o.H, 1200), o.ts); const g = L.grid;
    g.border(T.WALL);
    const m = 7; // track width
    g.fill(m, m, g.cols - 1 - m, g.rows - 1 - m, T.WALL);
    // round inner corners with trees
    [[m, m], [g.cols - 1 - m, m], [m, g.rows - 1 - m], [g.cols - 1 - m, g.rows - 1 - m]].forEach(([c, r]) => g.set(c, r, T.TREE));
    // a chicane
    g.fill(Math.floor(g.cols / 2), 1, Math.floor(g.cols / 2), Math.floor(m / 2), T.WALL);
    const ts = o.ts, cxm = (m / 2) * ts;
    L.checkpoints = [
      { x: L.w / 2, y: L.h - cxm }, { x: L.w - cxm, y: L.h - cxm }, { x: L.w - cxm, y: L.h / 2 }, { x: L.w - cxm, y: cxm },
      { x: L.w * 0.7, y: cxm + ts }, { x: L.w * 0.3, y: cxm + ts }, { x: cxm, y: cxm }, { x: cxm, y: L.h / 2 }, { x: cxm, y: L.h - cxm },
    ];
    L.start = { x: L.w / 2 - ts * 3, y: L.h - cxm };
    L.goal = { x: L.w / 2, y: L.h - cxm };
    return L;
  };
  GEN.bricks = function (o) {
    const L = mk(Math.min(o.W, 1100), Math.min(o.H, 720), o.ts); const g = L.grid;
    g.fill(0, 0, g.cols - 1, 0, T.WALL); g.fill(0, 0, 0, g.rows - 1, T.WALL); g.fill(g.cols - 1, 0, g.cols - 1, g.rows - 1, T.WALL);
    L.floorOpen = true;
    const cols = Math.floor((L.w - o.ts * 3) / 64), rows = 5;
    const x0 = (L.w - cols * 64) / 2 + 32;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) L.grid2.push({ x: x0 + c * 64, y: o.ts * 2.5 + r * 30, row: r });
    L.start = { x: L.w / 2, y: L.h - o.ts * 1.5 };
    return L;
  };

  function flood(g, sc, sr) {
    const dist = new Int32Array(g.cols * g.rows).fill(-1);
    const q = [[sc, sr]]; dist[sr * g.cols + sc] = 0;
    let h = 0;
    while (h < q.length) {
      const [c, r] = q[h++];
      const d = dist[r * g.cols + c];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dx, nr = r + dy;
        const v = g.get(nc, nr);
        if (v === -1 || SOLID.has(v) || dist[nr * g.cols + nc] >= 0) continue;
        dist[nr * g.cols + nc] = d + 1; q.push([nc, nr]);
      }
    }
    return dist;
  }
  Levels.flood = flood;

  function sprinkle(L, hazard, rng, side, density) {
    const g = L.grid; const k = Levels.NAMES[hazard];
    if (k == null) return;
    const n = Math.floor((g.cols * g.rows) / 140 * (0.5 + density));
    const sc = Math.floor((L.start ? L.start.x : 0) / g.ts), sr = Math.floor((L.start ? L.start.y : 0) / g.ts);
    for (let i = 0; i < n; i++) {
      const c = rng.int(1, g.cols - 2);
      if (Math.abs(c - sc) < 5 && side) continue;
      if (side) {
        // find a ground cell in this column
        for (let r = 1; r < g.rows - 1; r++) {
          const below = g.get(c, r + 1);
          if (g.get(c, r) === T.EMPTY && (below === T.WALL)) {
            if (k === T.LAVA || k === T.WATER) { if (below === T.WALL) g.set(c, r + 1, k); }
            else g.set(c, r, k === T.TREE ? T.TREE : k);
            break;
          }
        }
      } else {
        const r = rng.int(1, g.rows - 2);
        if (Math.abs(c - sc) < 3 && Math.abs(r - sr) < 3) continue;
        const sz = k === T.LAVA || k === T.WATER || k === T.ICE ? rng.int(1, 2) : 0;
        for (let y = -sz; y <= sz; y++) for (let x = -sz; x <= sz; x++) if (g.get(c + x, r + y) === T.EMPTY && rng.chance(0.85)) g.set(c + x, r + y, k);
      }
    }
  }

  function finalize(L, rng, side) {
    const g = L.grid, ts = g.ts;
    L.open = []; L.ground = []; L.sky = []; L.edges = [];
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const v = g.get(c, r);
      if (v !== T.EMPTY) continue;
      const p = { x: c * ts + ts / 2, y: r * ts + ts / 2 };
      L.open.push(p);
      const below = g.get(c, r + 1);
      if (below === T.WALL || below === T.PLATFORM || below === T.ICE || below === T.TREE) L.ground.push(p);
      if (r < g.rows * 0.35) L.sky.push(p);
      if (c <= 2 || r <= 2 || c >= g.cols - 3 || r >= g.rows - 3) L.edges.push(p);
    }
    if (!L.start) L.start = { x: L.w / 2, y: L.h / 2 };
    // make sure the start is not inside a wall
    const sc = Math.floor(L.start.x / ts), sr = Math.floor(L.start.y / ts);
    if (g.isSolid(sc, sr) || g.get(sc, sr) === T.LAVA || g.get(sc, sr) === T.SPIKES) {
      const near = L.open.slice().sort((a, b) => U.dist(a.x, a.y, L.start.x, L.start.y) - U.dist(b.x, b.y, L.start.x, L.start.y))[0];
      if (near) L.start = { x: near.x, y: near.y };
    }
    if (!L.goal && L.open.length) {
      L.goal = L.open.reduce((best, p) => (U.dist(p.x, p.y, L.start.x, L.start.y) > U.dist(best.x, best.y, L.start.x, L.start.y) ? p : best), L.open[0]);
    }
    L.tiles = g;
  }

  VC.Levels = Levels;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
