// Hand-drawn pixel-art sprites, written as text. '.' is transparent, 'o' is the outline; every other
// letter is a paint slot filled in when the sprite is stamped (so one drawing serves every culture,
// season, species and nation colour).

export interface Sprite {
  w: number;
  h: number;
  px: Uint8Array; // char codes, 0 = transparent
}

function S(rows: string[], autoOutline = false): Sprite {
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  let h = rows.length;
  let grid = rows.map((r) => r.padEnd(w, '.'));
  if (autoOutline) {
    // grow a one-pixel outline around the drawing
    const g2: string[] = [];
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? '.' : grid[y][x]);
    for (let y = -1; y <= h; y++) {
      let row = '';
      for (let x = -1; x <= w; x++) {
        const c = at(x, y);
        if (c !== '.') row += c;
        else if (at(x - 1, y) !== '.' || at(x + 1, y) !== '.' || at(x, y - 1) !== '.' || at(x, y + 1) !== '.') row += 'o';
        else row += '.';
      }
      g2.push(row);
    }
    grid = g2;
    w += 2;
    h += 2;
  }
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = grid[y][x] === '.' ? 0 : grid[y].charCodeAt(x);
  return { w, h, px };
}

// ---------------------------------------------------------------- nature

export const TREE_OAK = S([
  '..ooo..',
  '.oaabo.',
  'oaabbbo',
  'oabbbco',
  'obbbcco',
  '.occco.',
  '..oto..',
  '..oto..',
]);
export const TREE_OAK_B = S([
  '.oooo..',
  'oaabbo.',
  'oabbbbo',
  'obbbbco',
  '.obccco',
  '..ooto.',
  '...ot..',
]);
export const TREE_PINE = S([
  '...o...',
  '..oao..',
  '.oabbo.',
  '..obo..',
  '.oabbo.',
  'oabbbco',
  'oobcboo',
  '..oto..',
  '..oto..',
]);
export const TREE_PALM = S([
  '.oo.oo.',
  'oabobao',
  '.oabao.',
  'oaotoao',
  'oo.t.oo',
  '...t...',
  '...to..',
  '...to..',
]);
export const TREE_JUNGLE = S([
  '..oooo..',
  '.oaaabo.',
  'oaabbbbo',
  'oabbbbco',
  'oabbbcco',
  'obbbccco',
  '.oocccoo',
  '...ot...',
  '...ot...',
]);
export const TREE_BARE = S([
  '.t.t.',
  't.t.t',
  '.ttt.',
  '..t..',
  '..t..',
  '..t..',
]);
export const BUSH = S([
  '.ooo.',
  'oabbo',
  'obbco',
  '.ooo.',
]);
export const CACTUS = S([
  '..a..',
  'a.a..',
  'aaa.a',
  '..aaa',
  '..a..',
  '..a..',
], true);
export const ROCK = S([
  '.ooo.',
  'oaabo',
  'oabbo',
  'ooooo',
]);
export const MOUNTAIN = S([
  '.......o.......',
  '......oso......',
  '.....ossSo.....',
  '....ossSSbo....',
  '....oasSbbo....',
  '...oaaabbbbo...',
  '..oaaaabbbbbo..',
  '..oaaabbbbbbo..',
  '.oaaaabbbbbbbo.',
  '.oaaaaabbbbbbo.',
  'oaaaaaabbbbbbbo',
  'ooooooooooooooo',
]);
export const MOUNTAIN_S = S([
  '.....o.....',
  '....oso....',
  '...oasbo...',
  '..oaaabbo..',
  '.oaaabbbbo.',
  '.oaaabbbbo.',
  'oaaaabbbbbo',
  'ooooooooooo',
]);
export const VOLCANO = S([
  '......ooo......',
  '.....olllo.....',
  '....oalllbo....',
  '....oaalbbo....',
  '...oaaalbbbo...',
  '...oaaabbbbo...',
  '..oaaaabbbbbo..',
  '..oaaabbbbbbo..',
  '.oaaaabbbbbbbo.',
  '.oaaaaabbbbbbo.',
  'oaaaaaabbbbbbbo',
  'ooooooooooooooo',
]);
export const HILL = S([
  '...ooo...',
  '.ooaaboo.',
  'oaaaabbbo',
  'aaaaabbbb',
]);

// ---------------------------------------------------------------- works of people

export const HUT = S([
  '..ooo..',
  '.orrRo.',
  'orrrRRo',
  'orrdRRo',
  'orrdRRo',
  'ooooooo',
]);
export const HOUSE = S([
  '..oooo..',
  '.orrrRo.',
  'orrrrRRo',
  'oooooooo',
  'owwwwWWo',
  'owgwdWWo',
  'owwwdWWo',
  'oooooooo',
]);
export const HOUSE_TALL = S([
  '..oooo..',
  '.orrrRo.',
  'orrrrRRo',
  'oooooooo',
  'owgwgWWo',
  'owwwwWWo',
  'owgwdWWo',
  'owwwdWWo',
  'oooooooo',
]);
export const HOUSE_BRICK = S([
  '.....oo.',
  '..oooKo.',
  '.orrrKRo',
  'orrrrRRo',
  'oooooooo',
  'owgwgWWo',
  'owwwwWWo',
  'owgwdWWo',
  'oooooooo',
]);
export const BLOCK = S([
  'ooooooo',
  'owwwwWo',
  'ogwgwWo',
  'owwwwWo',
  'ogwgwWo',
  'owwwwWo',
  'ogwgwWo',
  'owwwwWo',
  'owdwwWo',
  'ooooooo',
]);
export const SPIRE = S([
  '..oo..',
  '.ohgo.',
  'ohggGo',
  'ohggGo',
  'ohggGo',
  'ohggGo',
  'ohggGo',
  'ohggGo',
  'ohggGo',
  'ohggGo',
  'ohggGo',
  'oooooo',
]);
export const TEMPLE = S([
  '......o......',
  '.....oyo.....',
  '...ooyyyoo...',
  '.ooyyyyyyyoo.',
  'oyyyyyYYYYYYo',
  'ooooooooooooo',
  '.owewewewewo.',
  '.owewewewewo.',
  '.owewewewewo.',
  'ooooooooooooo',
  'oWWWWWWWWWWWo',
  'ooooooooooooo',
]);
export const KEEP = S([
  '.o.o........o.o.',
  '.ooo...of...ooo.',
  '.owo...off..owo.',
  '.owo...o....owo.',
  'oowoooooooooowoo',
  'owwwwwwwwwwwWWWo',
  'owgwwgwwgwwgWWWo',
  'owwwwwwwwwwwWWWo',
  'owwwwwooowwwWWWo',
  'owgwwodddowgWWWo',
  'owwwwodddowwWWWo',
  'oooooooooooooooo',
]);
export const BIG_HUT = S([
  '....oooo....',
  '..oorrrroo..',
  '.orrrrrRRRo.',
  'orrrrrrRRRRo',
  'orrrrddRRRRo',
  'orrrrddRRRRo',
  'oooooooooooo',
]);
export const MARKET = S([
  '.oooooooo.',
  'orsrsrsrso',
  'osrsrsrsro',
  '.o......o.',
  '.oyy..ggo.',
  '.oooooooo.',
]);
export const FACTORY = S([
  '..oo....oo...',
  '..oKo..oKo...',
  '..oKo..oKo...',
  '.ooKooooKoooo',
  'orrrrrrrrrRRo',
  'ooooooooooooo',
  'owgwgwgwgWWWo',
  'owwwwwwwwWWWo',
  'owgwgwddwWWWo',
  'owwwwwddwWWWo',
  'ooooooooooooo',
]);
export const ACADEMY = S([
  '...oooo...',
  '..obbbBo..',
  '.obbbbBBo.',
  'oooooooooo',
  'owwgwwgwWo',
  'owwwwwwwWo',
  'owwgddgwWo',
  'owwwddwwWo',
  'oooooooooo',
]);
export const BARN = S([
  '..ooo..',
  '.orrRo.',
  'orrrRRo',
  'owwdWWo',
  'owwdWWo',
  'ooooooo',
]);
export const RUIN = S([
  'o.....o.',
  'ow...owo',
  'ow.o.owo',
  'owoWo.o.',
  'owoWo...',
  'ooooooo.',
]);
export const MINE = S([
  '..oooo..',
  '.oaaabo.',
  'oaadddbo',
  'oadddddo',
  'oadddddo',
  'oooooooo',
]);
export const LOGS = S([
  '.oooo.',
  'otTtTo',
  'oTtTto',
  '.oooo.',
]);
export const ORE = S([
  '.ooo.',
  'oaxbo',
  'oxbxo',
  'ooooo',
]);

// ---------------------------------------------------------------- creatures and vehicles (auto-outlined)

export const PERSON_A = S(['hh', 'ss', 'bb', 'bb', 'l.'], true);
export const PERSON_B = S(['hh', 'ss', 'bb', 'bb', '.l'], true);
export const CHILD_A = S(['ss', 'bb', 'l.'], true);
export const CHILD_B = S(['ss', 'bb', '.l'], true);
export const SOLDIER_A = S(['hhp', 'ssp', 'bbp', 'bb.', 'l..'], true);
export const SOLDIER_B = S(['hhp', 'ssp', 'bbp', 'bb.', '.l.'], true);
export const GRAZER = S(['....aa.', 'aaaaaae', 'aaaaaa.', 'b..b.b.'], true);
export const GRAZER_B = S(['....aa.', 'aaaaaae', 'aaaaaa.', '.b.bb..'], true);
export const PREDATOR = S(['b....aa', '.aaaaae', '.aaaaa.', '.b..b..'], true);
export const PREDATOR_B = S(['b....aa', '.aaaaae', '.aaaaa.', '..bb...'], true);
export const CRITTER = S(['..aa', 'aaae', 'b.b.'], true);
export const GIANT = S(['.aaaa..', 'aaaaaae', 'aaaaaaw', 'aaaaa.w', 'b..b...'], true);
export const BIRD = S(['..ae', '..a.', '.aa.', 'aaa.', '.b..', '.b..'], true);
export const CARAVAN = S(['......ccccc', 'aa....ccccc', 'aaaaa.wwwww', 'aaaaa.wwwww', 'b.b.b..k.k.'], true);
export const PACK = S(['aa.cc.', 'aaaaa.', 'aaaaa.', 'b.b.b.'], true);
export const WAGON = S(['.sssss.', 'sssssss', 'wwwwwww', '.k...k.'], true);
export const CANOE = S(['..s.s....', 'hhhhhhhhh', '.hhhhhhh.'], true);
export const SHIP = S([
  '.....m...f.',
  '....sms....',
  '...ssmss...',
  '..sssmsss..',
  '..sssmsss..',
  '.....m.....',
  'hhhhhhhhhhh',
  '.hhhhhhhhh.',
  '..hhhhhhh..',
], true);
export const STEAMER = S([
  '....kk.......',
  '....kk..kk...',
  '..wwwwwwwwwf.',
  'hhhhhhhhhhhhh',
  '.hhhhhhhhhhh.',
  '..hhhhhhhhh..',
], true);
export const CLOUD = S([
  '......wwww........',
  '....wwwwwwww..ww..',
  '..wwwwwwwwwwwwwww.',
  '.wwwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwwwww',
  '.ggggwwwwwwwggggg.',
  '...gggggggggggg...',
]);
export const TENT = S(['..s..', '.sss.', 'ssdss'], true);

/** paint a sprite into a small canvas; `colors` maps paint letters to CSS colours */
export function spriteCanvas(s: Sprite, colors: Record<string, string>, flip = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  const g = c.getContext('2d')!;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const ch = s.px[y * s.w + x];
      if (!ch) continue;
      const col = colors[String.fromCharCode(ch)];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(flip ? s.w - 1 - x : x, y, 1, 1);
    }
  }
  return c;
}
