/* VibeCode — natural language interpreter: text -> intents. */
(function (VC) {
  'use strict';
  const U = VC.U, L = VC.Lex;
  const I = {};

  // ---------------------------------------------------------------------------
  // normalization
  // ---------------------------------------------------------------------------
  const CONTRACTIONS = [
    [/\bi'm\b/g, 'i am'], [/\bim\b/g, 'i am'], [/\bi've\b/g, 'i have'], [/\bi'd\b/g, 'i would'], [/\bi'll\b/g, 'i will'],
    [/\bit's\b/g, 'it is'], [/\bits (a|an|too|so|very|really|way|kinda|now)\b/g, 'it is $1'], [/\bthat's\b/g, 'that is'], [/\bthere's\b/g, 'there is'], [/\bthey're\b/g, 'they are'],
    [/\bwe're\b/g, 'we are'], [/\byou're\b/g, 'you are'], [/\bdon't\b|\bdont\b/g, 'do not'], [/\bdoesn't\b|\bdoesnt\b/g, 'does not'],
    [/\bcan't\b|\bcant\b/g, 'cannot'], [/\bwon't\b|\bwont\b/g, 'will not'], [/\bisn't\b|\bisnt\b/g, 'is not'], [/\baren't\b/g, 'are not'],
    [/\bshouldn't\b/g, 'should not'], [/\bwouldn't\b/g, 'would not'], [/\bcouldn't\b/g, 'could not'], [/\blet's\b|\blets\b/g, 'let us'],
    [/\bwanna\b/g, 'want to'], [/\bgonna\b/g, 'going to'], [/\bgotta\b/g, 'got to'], [/'em\b/g, 'them'], [/\bu\b/g, 'you'], [/\bur\b/g, 'your'],
    [/\bplz\b|\bpls\b/g, 'please'], [/\bthx\b|\bty\b/g, 'thanks'], [/\b(\w+)n't\b/g, '$1 not'], [/\bwhats\b|\bwhat's\b/g, 'what is'], [/\bhows\b|\bhow's\b/g, 'how is'],
    [/\bgimme\b/g, 'give me'], [/\blemme\b/g, 'let me'], [/\bkinda\b/g, 'kind of'], [/\bsorta\b/g, 'sort of'], [/\bcuz\b|\bcause\b/g, 'because'],
    [/\bthru\b/g, 'through'], [/\b2x\b/g, 'twice'], [/\bx2\b/g, 'twice'], [/\b3x\b/g, '3 times'], [/\b10x\b/g, '10 times'], [/\b(\d+)x\b/g, '$1 times'],
  ];
  const NUMS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };
  function wordsToNumbers(s) {
    s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -](one|two|three|four|five|six|seven|eight|nine)\b/g, (m, a, b) => String(NUMS[a] + NUMS[b]));
    s = s.replace(/\b(a|one) hundred\b/g, '100').replace(/\b(a|one) thousand\b/g, '1000').replace(/\b(\d+) hundred\b/g, (m, a) => String(+a * 100)).replace(/\b(\d+) thousand\b/g, (m, a) => String(+a * 1000));
    s = s.replace(/\b(\w+) hundred\b/g, (m, a) => (NUMS[a] != null ? String(NUMS[a] * 100) : m));
    s = s.replace(/\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, (m) => String(NUMS[m]));
    s = s.replace(/\bone\b(?! of| more| by| at a| hit| shot)/g, '1');
    return s;
  }

  I.normalize = function (raw) {
    const quotes = [];
    let s = String(raw || '').trim();
    s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    s = s.replace(/"([^"]{1,140})"/g, (m, q) => { quotes.push(q); return ' qq' + (quotes.length - 1) + ' '; });
    s = s.replace(/(^|\s)'([^']{2,140})'(?=$|[\s.,!?;:])/g, (m, pre, q) => { quotes.push(q); return pre + ' qq' + (quotes.length - 1) + ' '; });
    s = s.toLowerCase();
    for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
    s = wordsToNumbers(s);
    s = s.replace(/(\d),(\d{3})/g, '$1$2');
    s = s.replace(/[*_~`#>]+/g, ' ');
    s = s.replace(/\s*&\s*/g, ' and ').replace(/\s*\+\s*/g, ' and ');
    s = s.replace(/\b(the |a )?(players?|users?)'?s\b/g, 'my');
    s = s.replace(/\s+/g, ' ').trim();
    return { text: s, quotes };
  };

  // ---------------------------------------------------------------------------
  // small helpers
  // ---------------------------------------------------------------------------
  const PLAYER_WORDS = /^(?:i|me|myself|we|us|you|the player|player|my character|my guy|the hero|the main character|my ship|my car|my hero|the character|our hero|my player|my avatar|my dude)$/;
  const PRONOUNS = /^(?:it|they|them|those|these|that|this|the new ones|the new one|each one|each|every one|all of them|both|its|their)$/;
  const isPlayerWord = (w) => PLAYER_WORDS.test(String(w).trim());
  const stripDet = (s) => String(s || '').replace(/^(?:all of the|all the|all|every|each|the|a|an|some|any|my|our|your|his|her|their|its|those|these|this|that|more|new|other|another)\s+/g, '').replace(/^(?:the|a|an)\s+/, '').trim();
  function quoteOf(s, quotes) { const m = /qq(\d+)/.exec(s); return m ? quotes[+m[1]] : null; }
  function numberIn(s) {
    const m = /(-?\d+(?:\.\d+)?)/.exec(s);
    if (m) return parseFloat(m[1]);
    for (const [k, v] of Object.entries(L.numberWords)) if (new RegExp('\\b' + k + '\\b').test(s) && !/^(a|an)$/.test(k)) return v;
    return null;
  }
  I.numberIn = numberIn;

  const VERB_START = /^(?:add|make|give|let|set|change|remove|delete|put|spawn|create|turn|have|i |the player|it should|there|also|when|whenever|if|every|after|play|use|switch|call|name|place|include|enable|disable|increase|decrease|double|halve|reduce|lower|raise|boost|move|replace|swap|kill|destroy|get rid|throw|drop|show|hide|zoom|slow|speed|flip|reverse|rename|title|surprise|fix|undo|revert|paint|color|colour|scatter|fill)\b/;

  // ---------------------------------------------------------------------------
  // clause segmentation
  // ---------------------------------------------------------------------------
  function sentences(s) {
    return s.split(/(?<!\d)[.!?;]+(?!\d)|\n+/).map((x) => x.trim()).filter(Boolean);
  }
  const COND_MID = /(?:,\s*|\s+and\s+)(?=(?:when|whenever|if|every time|each time|once|as soon as|after \d)\b)/;
  function clauses(sent) {
    let parts = [sent];
    // split off mid-sentence conditionals
    parts = parts.flatMap((p) => p.split(COND_MID));
    const out = [];
    for (const p of parts) {
      if (/^(?:when|whenever|if|every time|each time|anytime|any time|once|as soon as|after \d|every \d|every (?:second|minute|few seconds))\b/.test(p) || /\b(?:when|whenever|every time|each time|as soon as)\b/.test(p) && !/^(?:add|create|spawn|put|place|make)\b.*\b(?:that|which|who)\b/.test(p)) { out.push(p); continue; }
      // split on strong separators
      let segs = p.split(/\s*,?\s+(?:and then|then|and also|also|plus|but also|but|as well as)\s+|\s*,\s*(?:and\s+)?(?=(?:add|make|give|let|set|change|remove|delete|put|spawn|create|turn|have|i |the player|it |there|play|use|switch|call|name|enable|disable|increase|decrease|double|halve|reduce|lower|raise|boost|replace|swap|kill|destroy|get rid|show|hide|zoom|slow|speed|flip|reverse|rename)\b)/);
      for (const sg of segs) {
        // ' and <verb>' splits; ' where ' splits
        const sub = sg.split(/\s+and\s+(?=(?:add|make|give|let|set|change|remove|delete|put|spawn|create|turn|have|i (?!am)|the player|it should|there (?:is|are|should)|play|use|switch|call|name|enable|disable|increase|decrease|double|halve|reduce|lower|raise|boost|replace|swap|get rid|show|hide|zoom|flip|reverse|rename)\b)|\s+(?:where|in which|in which i|wherein)\s+/);
        out.push(...sub);
      }
    }
    return out.map((x) => x.trim()).filter((x) => x && x.length > 0);
  }

  const FILLER = /^(?:(?:can|could|would|will) you(?: please)?|please|i want you to|i would like you to|i need you to|go ahead and|let us|now|ok(?:ay)?|alright|also|and|then|so|hey vibe|hey|vibe|yo|maybe|perhaps|try to|try and|try|just|actually|i think|i guess|i feel like|we should|you should|lets|i would love|i would love it if|it would be (?:cool|nice|fun|great|awesome|sick|neat|funny|hilarious)(?: if| to)?|wouldn't it be cool if|why not|how about|what about|can we|could we|we need to|you need to|kindly|honestly|basically|literally|real quick|quickly|first|second|finally|lastly|next|after that|oh and|oh|um|uh|hmm|wait|right|nice|cool|great|awesome|perfect|good|ok so|now let us)\b[,\s]*/;
  function stripFiller(c) {
    let prev;
    do {
      prev = c;
      c = c.replace(/^i (?:want|would like|wish|need) to be able to\s+/, 'let me ').replace(/^i (?:want|wanna|would like|wish) to be\s+/, 'make me ').replace(/^i (?:want|would like|wish|need) to\s+(?!have\b|see\b|add\b|make\b|create\b|build\b|get\b)/, 'let me ');
      c = c.replace(FILLER, '');
    } while (c !== prev && c.length);
    return c.trim();
  }

  // ---------------------------------------------------------------------------
  // meta / whole-message intents
  // ---------------------------------------------------------------------------
  I.meta = function (t) {
    if (/^\/\w+/.test(t)) return null;
    if (/^(?:undo|revert|go back|roll ?back|ctrl[ +-]?z|take (?:that|it) back|never ?mind|nevermind|cancel that|undo that|revert that|put it back|change it back|bring it back|i preferred it before|that was better before|go back to how it was)\b/.test(t) || /^(?:undo|revert) (?:the )?(?:last|previous) (?:change|edit|thing|prompt)/.test(t)) return { kind: 'undo', steps: /\btwo|2 changes|twice\b/.test(t) ? 2 : 1 };
    if (/\b(?:it is|that is|its) a feature\b|^(?:keep it|leave it|i like (?:it|that|the bug)|do not fix|don't fix|that bug is (?:great|funny|amazing)|it is not a bug)\b/.test(t)) return { kind: 'keepbug' };
    if (/^(?:fix (?:it|that|this|the bugs?|everything|the game|what you broke|your mess)|it is broken|it broke|that broke|something broke|you broke|this is broken|that is broken|debug|it does not work|it is not working|nothing works|bug|there is a bug|i found a bug|the game is broken|help it is broken|broken)\b/.test(t) || /^(?:remove|squash|kill) (?:the |all |those )?bugs?$/.test(t)) return { kind: 'fix', text: t };
    if (/^(?:start over|reset|reset (?:the|my|everything|it all|the project|the game)|clear (?:everything|the game|the project|it all)|delete everything|remove everything|wipe (?:it|everything)|new game from scratch|start from scratch|nuke it|burn it (?:all )?down|scrap (?:it|everything|this))\b/.test(t)) return { kind: 'reset' };
    if (/^(?:hi|hello|hey|yo|sup|hiya|howdy|greetings|good (?:morning|evening|afternoon))(?: there| vibe)?[!. ]*$/.test(t)) return { kind: 'chat', topic: 'hello' };
    if (/^(?:thanks|thank you|thank u|thx|ty|cheers|appreciate it|much appreciated|great job|good job|nice work|well done|you are (?:great|awesome|amazing|the best)|love it|i love it|amazing|awesome|perfect|nice|cool|sick|wow|neat|great)[!. ]*$/.test(t) || /^thank/.test(t)) return { kind: 'chat', topic: 'thanks' };
    if (/^(?:lol|lmao|haha+|hehe+|rofl|xd|😂|💀)[!. ]*$/.test(t)) return { kind: 'chat', topic: 'lol' };
    if (/^(?:you suck|this sucks|bad|terrible|awful|worst|ugh|boo)[!. ]*$/.test(t)) return { kind: 'chat', topic: 'sad' };
    if (/^(?:who are you|what are you|are you (?:real|alive|sentient|conscious|an ai|human)|what is your name|do you have feelings)/.test(t)) return { kind: 'chat', topic: 'who' };
    return null;
  };

  I.question = function (t) {
    if (/^(?:what|how|why|where|which|who|when did|is there|are there|do i|does|did|can i|could i|tell me|explain|describe|show me what|list|what's|whats|status|help\b|what should|how come|how many|how much)/.test(t) && !/^(?:how about|what about|what if)\b/.test(t)) {
      if (/^(?:can i|could i)\s+(?!see|know)/.test(t) && !/\?$/.test(t)) return null;
      return { kind: 'question', text: t };
    }
    if (/\?\s*$/.test(t) && !/^(?:can|could|would|will) you\b/.test(t)) return { kind: 'question', text: t };
    return null;
  };

  // ---------------------------------------------------------------------------
  // noun phrases
  // ---------------------------------------------------------------------------
  const NP_STOP = /\s+(?:that|which|who|whom|with|to|from|in|on|at|near|around|everywhere|inside|across|along|across|all over|when|whenever|if|every|made of|shaped like|called|named|for|by|but|so|because|while|holding|wearing|riding|carrying|than|who can|that can|which can)\b/;
  const QUANT = [
    'a couple of', 'a pair of', 'a bunch of', 'a lot of', 'lots of', 'tons of', 'loads of', 'plenty of', 'dozens of', 'hundreds of', 'thousands of', 'millions of',
    'a horde of', 'a swarm of', 'an army of', 'a pack of', 'a flock of', 'a herd of', 'a family of', 'a gang of', 'a crowd of', 'a few', 'a dozen', 'way too many', 'too many',
    'several', 'many', 'some', 'few', 'a', 'an', 'one', 'couple', 'pair', 'bunch', 'horde', 'swarm', 'army', 'infinite', 'endless', 'countless', 'hordes of', 'swarms of', 'armies of',
  ];
  const IGNORE = new Set(['the', 'more', 'new', 'extra', 'additional', 'another', 'other', 'random', 'of', 'kind', 'type', 'sort', 'type', 'cool', 'awesome', 'cute', 'nice', 'very', 'really', 'super', 'some', 'little', 'bit', 'few', 'lots', 'lot', 'bunch', 'like', 'just', 'my', 'own', 'own', 'own', 'whole', 'different', 'various', 'all', 'any', 'kinds', 'types', 'sorts', 'and', 'or', 'mini']);
  I.IGNORE = IGNORE;
  const BODY_ATTR = {
    gun: { b: 'shoot', proj: 'bullet' }, guns: { b: 'shoot', proj: 'bullet' }, blaster: { b: 'shoot', proj: 'laser' }, blasters: { b: 'shoot', proj: 'laser' },
    laser: { b: 'shoot', proj: 'laser' }, lasers: { b: 'shoot', proj: 'laser' }, 'laser eyes': { b: 'shoot', proj: 'laser' }, bow: { b: 'shoot', proj: 'arrow' }, bows: { b: 'shoot', proj: 'arrow' },
    'bows and arrows': { b: 'shoot', proj: 'arrow' }, rockets: { b: 'shoot', proj: 'rocket' }, 'rocket launchers': { b: 'shoot', proj: 'rocket' }, 'rocket launcher': { b: 'shoot', proj: 'rocket' },
    cannons: { b: 'shoot', proj: 'cannonball' }, cannon: { b: 'shoot', proj: 'cannonball' }, wands: { b: 'shoot', proj: 'magic' }, wand: { b: 'shoot', proj: 'magic' }, staffs: { b: 'shoot', proj: 'magic' },
    wings: { fly: true }, jetpacks: { fly: true }, jetpack: { fly: true }, propellers: { fly: true }, balloons: { fly: true },
    swords: { dmg: 1, b: 'chase' }, sword: { dmg: 1, b: 'chase' }, axes: { dmg: 1, b: 'chase' }, knives: { dmg: 1, b: 'chase' }, claws: { dmg: 1 }, fangs: { dmg: 1 }, teeth: { dmg: 1 },
    shields: { hp: 3 }, shield: { hp: 3 }, armor: { hp: 3 }, armour: { hp: 3 }, helmets: { hp: 2 }, helmet: { hp: 2 },
    spikes: { spiky: true, dmg: 1 }, horns: { dmg: 1 }, hats: { cosmetic: 'hat' }, hat: { cosmetic: 'hat' }, 'top hats': { cosmetic: 'hat' }, crowns: { cosmetic: 'crown', boss: true },
    sunglasses: { cosmetic: 'shades' }, mustaches: { cosmetic: 'mustache' }, capes: { cosmetic: 'cape' }, 'big eyes': { cosmetic: 'eyes' },
    magnets: { b: 'magnet' }, bombs: { b: 'shoot', proj: 'bomb' }, 'fire breath': { b: 'shoot', proj: 'fireball' }, flamethrowers: { b: 'shoot', proj: 'flame' },
  };

  I.parseNPList = function (s, quotes, ctx) {
    s = s.trim().replace(/^(?:with|of)\s+/, '');
    // split items on commas / "and" before a new noun phrase
    const items = [];
    let rest = s;
    const splitRe = /\s*(?:,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+|\s+as well as\s+|\s+along with\s+|\s+together with\s+)/g;
    const parts = rest.split(splitRe).filter(Boolean);
    let cur = '';
    for (const p of parts) {
      if (!cur) { cur = p; continue; }
      // does p start a new NP?
      const w = p.split(/\s+/);
      const firstNoun = w.slice(0, 4).some((x) => L.findNoun(x) && !VERBISH.test(x));
      const startsCount = /^(?:\d+|a|an|some|lots|tons|many|several|few|the|more|giant|tiny|big|small|huge|red|blue|green)\b/.test(p);
      const isVerb = VERBISH.test(w[0]) || /^(?:me|you|the player|them|it)\b/.test(p);
      if ((firstNoun || startsCount) && !isVerb) { items.push(cur); cur = p; }
      else cur = cur + ' and ' + p;
    }
    if (cur) items.push(cur);
    return items.map((x) => I.parseNP(x, quotes, ctx)).filter((np) => np && (np.key || np.word));
  };
  const VERBISH = /^(?:chase|chases|follow|follows|hunt|hunts|attack|attacks|shoot|shoots|fire|fires|throw|throws|fly|flies|jump|jumps|hop|hops|run|runs|flee|flees|explode|explodes|teleport|teleports|multiply|multiplies|split|splits|spin|spins|dance|dances|sing|sings|patrol|patrols|wander|wanders|orbit|orbits|circle|circles|guard|guards|protect|protects|eat|eats|steal|steals|drop|drops|spawn|spawns|heal|heals|bounce|bounces|bite|bites|hurt|hurts|kill|kills|give|gives|glow|glows|float|floats|swim|swims|walk|walks|move|moves|talk|talks|say|says|sleep|sleeps|grow|grows|charge|charges|zigzag|roam|roams|breathe|breathes|spit|spits|lay|lays|summon|summons|are|is|can|will|always|never|help|helps|fight|fights|avoid|avoids|hide|hides|copy|copies|mimic|mimics|push|pushes|freeze|freezes|burn|burns|zap|zaps|sting|stings|try|tries|come|comes|go|goes|cast|casts|launch|launches|swarm|swarms|rain|rains|fall|falls|drift|drifts|roll|rolls|look|looks|have|has|die|dies|shrink|shrinks|turn|turns|become|becomes|make|makes)$/;
  I.VERBISH = VERBISH;

  I.parseNP = function (raw, quotes, ctx) {
    let s = raw.trim().replace(/[!?.,]+$/, '');
    const np = { raw: s, count: null, key: null, word: null, entry: null, mods: [], colors: [], vp: null, where: null, label: null, quote: null, more: false, all: false, attrs: [], unknown: false };
    const q = quoteOf(s, quotes || []);
    if (q) { np.quote = q; s = s.replace(/\s*qq\d+\s*/g, ' ').trim(); }
    // participle tail ("a cat collecting fish")
    const pm = /\s+(?:collecting|gathering|eating|grabbing|picking up|hunting for|looking for|searching for|finding|fighting|shooting|killing|battling|slaying|defeating|blasting|smashing|dodging|avoiding|escaping|running from|fleeing|surviving|evading|outrunning|rescuing|saving|protecting|defending|exploring|racing|riding|delivering|chasing)\b/.exec(' ' + s);
    if (pm) { np.partTail = (' ' + s).slice(pm.index).trim(); s = (' ' + s).slice(0, pm.index).trim(); }
    // relative / prepositional tail
    let tail = '';
    const m = NP_STOP.exec(' ' + s);
    if (m) { tail = (' ' + s).slice(m.index).trim(); s = (' ' + s).slice(0, m.index).trim(); }
    // quantity
    if (/^(?:all|every|each)\b/.test(s)) { np.all = true; s = s.replace(/^(?:all of the|all the|all|every|each)\s*/, ''); }
    if (/^(?:more|extra|additional|another)\b/.test(s)) { np.more = true; }
    const num = /^(\d+(?:\.\d+)?)\s*(?:more\s+|extra\s+)?/.exec(s);
    if (num) { np.count = Math.round(parseFloat(num[1])); s = s.slice(num[0].length); }
    else {
      for (const qw of QUANT) {
        if (s === qw || s.startsWith(qw + ' ')) {
          const v = L.numberWords[qw];
          np.count = v != null ? v : qw === 'a' || qw === 'an' || qw === 'one' ? 1 : 4;
          if (qw === 'some') np.count = null, np.some = true;
          s = s.slice(qw.length).trim();
          break;
        }
      }
    }
    s = s.replace(/^(?:more|extra|additional|another|new|other|of|the)\s+/, '').replace(/^(?:more|extra|new)\s+/, '');
    let words = s.split(/\s+/).filter(Boolean);
    // compounds
    let headIdx = -1;
    for (let i = words.length - 1; i >= 0 && headIdx < 0; i--) {
      for (let len = 3; len >= 1; len--) {
        if (i - len + 1 < 0) continue;
        const phrase = words.slice(i - len + 1, i + 1).join(' ');
        if (len > 1 && (L.compounds[phrase] || L.noun(phrase.replace(/ /g, '_')) || L.noun(L.singular(phrase).replace(/ /g, '_')))) {
          const key = L.compounds[phrase] || (L.noun(phrase.replace(/ /g, '_')) ? phrase.replace(/ /g, '_') : L.singular(phrase).replace(/ /g, '_'));
          words.splice(i - len + 1, len, '__' + key);
          headIdx = i - len + 1;
          break;
        }
      }
    }
    // find head: last known noun that is not used as an adjective
    let head = null;
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i];
      if (w.startsWith('__')) { head = { i, key: w.slice(2) }; break; }
      if (IGNORE.has(w)) continue;
      const f = L.findNoun(w);
      if (f && f.entry && !(i < words.length - 1 && L.adjectives[w] && i !== words.length - 1)) { head = { i, key: f.key, fuzzy: f.fuzzy }; break; }
    }
    if (!head) {
      // unknown noun: last non-adjective, non-ignored token
      for (let i = words.length - 1; i >= 0; i--) {
        const w = words[i];
        if (IGNORE.has(w) || L.stopwords.has(w) || L.colors[w] || L.adjectives[w] || /^\d+$/.test(w) || VERBISH.test(w)) continue;
        head = { i, unknown: true, word: L.singular(w) };
        break;
      }
    }
    if (!head) {
      // only adjectives (e.g. "red ones") -> no noun
      words.forEach((w) => { if (L.colors[w]) np.colors.push(L.colors[w]); else if (L.adjectives[w]) np.mods.push(w); });
      np.word = null;
      if (tail) np.vp = I.parseVP(tail, quotes, ctx, np);
      return np;
    }
    if (head.unknown) { np.word = head.word; np.unknown = true; np.glyph = L.glyphFor(head.word); }
    else { np.key = head.key; np.word = head.key; np.entry = L.noun(head.key); np.fuzzy = head.fuzzy; }
    // modifiers before head
    for (let i = 0; i < head.i; i++) {
      const w = words[i].replace(/^__/, '');
      if (IGNORE.has(w)) continue;
      if (L.colors[w]) { np.colors.push(L.colors[w]); if (w === 'neon') np.mods.push('neon'); continue; }
      if (/^(light|dark|bright|pale|deep|hot|neon)$/.test(w) && words[i + 1] && L.colors[words[i + 1]]) { np.shadeWord = w; continue; }
      if (L.adjectives[w]) { np.mods.push(w); continue; }
      const nn = L.findNoun(w);
      if (nn) { np.mods.push('noun:' + nn.key); continue; }
      if (/^(\w+)-(\w+)$/.test(w)) { w.split('-').forEach((x) => { if (L.adjectives[x]) np.mods.push(x); else if (L.colors[x]) np.colors.push(L.colors[x]); }); continue; }
      if (!L.stopwords.has(w)) np.mods.push('word:' + w);
    }
    // trailing words after head (e.g. "zombies everywhere")
    for (let i = head.i + 1; i < words.length; i++) { const w = words[i]; if (L.adjectives[w]) np.mods.push(w); }
    if (tail) {
      const nm = /^(?:called|named)\s+(\w[\w ]{0,20})/.exec(tail);
      if (nm) { np.label = U.titleCase(nm[1].replace(/\s+(that|who|which|and|with).*$/, '')); tail = tail.replace(nm[0], '').trim(); }
      if (tail) np.vp = I.parseVP(tail, quotes, ctx, np);
    }
    return np;
  };

  // ---------------------------------------------------------------------------
  // verb phrases (behaviors)
  // ---------------------------------------------------------------------------
  function targetOf(rest, ctx) {
    rest = (rest || '').trim().replace(/^(?:at|after|toward|towards|to|the|from|around|near|with|on|into|for)\s+/, '').replace(/^(?:the|a|an)\s+/, '');
    if (!rest) return null;
    const first = rest.split(/\s+(?:and|but|when|if|while|until|then)\b/)[0];
    if (isPlayerWord(first) || /^(?:me|you|the player|player|us)\b/.test(first)) return 'player';
    if (/^(?:enemies|enemy|monsters|bad guys|baddies|foes|hostiles|anything hostile)\b/.test(first)) return 'enemy';
    if (/^(?:coins?|collectibles?|items?|pickups?|loot|food|treasure)\b/.test(first)) {
      const f = L.findNoun(first.split(' ')[0]);
      if (f && ctx && ctx.spec && ctx.spec.types[f.key]) return f.key;
      if (/^(?:collectibles?|items?|pickups?|loot)\b/.test(first)) return 'collectible';
      return f ? f.key : 'collectible';
    }
    const np = I.parseNP(first, [], ctx);
    if (np && np.key) return np.key;
    if (np && np.word) return U.ident(np.word);
    return null;
  }
  function projOf(rest) {
    rest = (rest || '').replace(/^(?:out\s+)?(?:at\s+\w+\s+)?/, '').trim();
    rest = rest.replace(/\s+(?:at|toward|towards|in|everywhere|all|around|when|if|every|down|up|from)\b.*$/, '').trim();
    const p = L.findProjectile(rest);
    if (p) return { key: p };
    const w = stripDet(rest).split(/\s+/).filter((x) => !IGNORE.has(x) && !/^\d+$/.test(x));
    if (!w.length) return null;
    const word = L.singular(w[w.length - 1]);
    if (!word || L.stopwords.has(word)) return null;
    return { key: U.ident(word), custom: true, word, glyph: L.glyphFor(word) };
  }

  const VERBS = [
    [/^(?:chase|chases|chasing|hunt|hunts|hunting|stalk|stalks|stalking|pursue|pursues|attack|attacks|attacking|come after|comes after|go after|goes after|run at|runs at|run towards?|runs towards?|charge at|charges at|swarm|swarms|try to (?:catch|kill|get|eat|bite) |tries to (?:catch|kill|get|eat|bite) )\s*(.*)/, (m, r, c) => {
      const t = targetOf(m[1], c) || 'player';
      if (/swarm/.test(m[0])) r.b.push({ type: 'swarm', target: t }); else r.b.push({ type: 'chase', target: t });
      if (t === 'player') r.hostile = true;
    }],
    [/^(?:follow|follows|following|tag along|tags along)\s*(.*)/, (m, r, c, np) => {
      const t = targetOf(m[1], c) || 'player';
      const role = np && np.entry ? np.entry.role : null;
      if (t === 'player' && (role === 'enemy' || role === 'boss' || r.hostile)) r.b.push({ type: 'chase', target: 'player' });
      else { r.b.push({ type: 'follow', target: t }); if (t === 'player') r.friend = true; }
    }],
    [/^(?:run away|runs away|running away|flee|flees|fleeing|avoid|avoids|avoiding|escape|escapes|hide from|hides from|are (?:scared|afraid) of|is (?:scared|afraid) of|fear|fears|run from|runs from|keep away from)\s*(.*)/, (m, r, c) => { r.b.push({ type: 'flee', from: targetOf(m[1], c) || 'player' }); }],
    [/^(?:shoot|shoots|shooting|fire|fires|firing|throw|throws|throwing|spit|spits|spitting|breathe|breathes|breathing|launch|launches|cast|casts|blast|blasts|toss|tosses|hurl|hurls|lob|lobs|spray|sprays|pelt|pelts)\s*(.*)/, (m, r) => {
      let rest = m[1] || '';
      const b = { type: 'shoot' };
      if (/^fire\b|^flames?\b/.test(rest) || /breathe/.test(m[0]) && !rest) b.projectile = 'fireball';
      const p = projOf(rest.replace(/^(?:at\s+)?(?:me|you|the player|us)\s*/, ''));
      if (p) { b.projectile = p.key; if (p.custom) r.customProj = p; }
      if (/\b(?:everywhere|in all directions|all around|in every direction|in a circle|around them|around it|360)\b/.test(rest)) b.at = 'radial';
      else if (/\bspiral\b/.test(rest)) b.at = 'spiral';
      else if (/\bdown(?:wards?)?\b/.test(rest)) b.at = 'down';
      else if (/\bup(?:wards?)?\b/.test(rest)) b.at = 'up';
      else if (/\b(?:randomly|at random|wildly)\b/.test(rest)) b.at = 'random';
      else if (/\b(?:enemies|monsters|bad guys)\b/.test(rest)) b.at = 'enemy';
      const n = /(\d+)\s*(?:\w+\s+)?(?:at (?:a time|once)|bullets|shots|projectiles|fireballs|lasers)/.exec(rest);
      if (n) b.count = Math.min(24, +n[1]);
      if (/\b(?:fast|rapidly|quickly|constantly|nonstop|a lot)\b/.test(rest)) b.rate = 2;
      if (/\b(?:slowly|occasionally|sometimes|rarely)\b/.test(rest)) b.rate = 0.3;
      r.b.push(b);
      if (!/enem/.test(rest)) r.hostileShooter = true;
    }],
    [/^(?:fly|flies|flying|float|floats|floating|hover|hovers|hovering|soar|soars|glide|glides|levitate|levitates)\s*(.*)/, (m, r, c) => { r.fly = true; if (/around (?:me|you|the player)/.test(m[1])) r.b.push({ type: 'orbit', target: 'player' }); else if (!r.b.length) r.b.push({ type: 'wander' }); void c; }],
    [/^(?:swim|swims|swimming)\b/, (m, r) => { r.b.push({ type: 'wave' }); if (!r.b.some((b) => b.type === 'wander')) r.b.push({ type: 'wander' }); }],
    [/^(?:jump|jumps|jumping|hop|hops|hopping|leap|leaps|leaping)\b/, (m, r) => { r.b.push({ type: 'hop' }); }],
    [/^(?:bounce|bounces|bouncing)\b(.*)/, (m, r) => { r.bouncy = true; if (/around|off/.test(m[1]) || !r.b.length) r.b.push({ type: 'bounce' }); }],
    [/^(?:wander|wanders|wandering|roam|roams|roaming|walk around|walks around|stroll|strolls|meander|meanders|wander around|move around|moves around|mill about|walk|walks|explore|explores)\b/, (m, r) => { r.b.push({ type: 'wander' }); }],
    [/^(?:patrol|patrols|patrolling|pace|paces|march|marches|walk back and forth|walks back and forth|go back and forth|goes back and forth)\b/, (m, r) => { r.b.push({ type: 'patrol' }); }],
    [/^(?:orbit|orbits|orbiting|circle|circles|circling|revolve|revolves|spin around|spins around|go around|goes around)\s*(.*)/, (m, r, c) => { r.b.push({ type: 'orbit', target: targetOf(m[1].replace(/^around\s+/, ''), c) || 'player' }); }],
    [/^(?:spin|spins|spinning|rotate|rotates|twirl|twirls)\b/, (m, r) => { r.fx.push('spin'); }],
    [/^(?:dance|dances|dancing|party|parties|boogie|boogies|vibe|vibes)\b/, (m, r) => { r.fx.push('dance', 'rainbow'); }],
    [/^(?:sing|sings|singing|hum|hums|whistle|whistles|make music)\b/, (m, r) => { r.fx.push('music'); }],
    [/^(?:explode|explodes|exploding|blow up|blows up|detonate|detonates|go boom|goes boom|self destruct|self-destruct)\s*(.*)/, (m, r) => {
      if (/\b(?:when (?:they|it|he|she) (?:die|dies|is killed|are killed|get killed)|on death|after (?:dying|death))\b/.test(m[1])) r.explosive = true;
      else if (/\b(?:touch|near|close|contact|reach|hit)\b/.test(m[1]) || r.hostile) { r.kamikaze = true; r.explosive = true; if (!r.b.length) r.b.push({ type: 'chase', target: 'player' }); r.hostile = true; }
      else r.explosive = true;
    }],
    [/^(?:teleport|teleports|teleporting|blink|blinks|warp|warps|phase|phases)\b/, (m, r) => { r.b.push({ type: 'warp' }); }],
    [/^(?:multiply|multiplies|multiplying|reproduce|reproduces|clone themselves|clone|clones|duplicate|duplicates|breed|breeds|replicate|replicates)\b/, (m, r) => { r.multiply = true; }],
    [/^(?:split|splits|splitting|break apart|breaks apart|divide|divides)\s*(.*)/, (m, r) => { r.split = true; }],
    [/^(?:grow|grows|growing|get bigger|gets bigger|swell|swells)\b/, (m, r) => { r.b.push({ type: 'swell' }); }],
    [/^(?:steal|steals|stealing|rob|robs|pickpocket|pickpockets|take|takes)\s*(.*)/, (m, r) => { r.b.push({ type: 'steal' }); r.hostile = true; if (!r.b.some((b) => b.type === 'chase')) r.b.push({ type: 'chase', target: 'player' }); }],
    [/^(?:eat|eats|eating|devour|devours|consume|consumes|munch|munches|gobble|gobbles|collect|collects|hoard|hoards|grab|grabs)\s*(.*)/, (m, r, c) => {
      const t = targetOf(m[1], c);
      if (t === 'player') { r.hostile = true; r.b.push({ type: 'chase', target: 'player' }); }
      else r.b.push({ type: 'eat', target: t || 'collectible' });
    }],
    [/^(?:heal|heals|healing|restore|restores|cure|cures|fix|fixes)\s*(.*)/, (m, r) => { r.heal = true; }],
    [/^(?:hurt|hurts|damage|damages|kill|kills|bite|bites|biting|sting|stings|burn|burns|zap|zaps|poison|poisons|punch|punches|hit|hits|scratch|scratches|harm|harms|stab|stabs|slap|slaps|smack|smacks)\s*(.*)/, (m, r) => { r.hostile = true; r.dmg = /\bkill|instantly|one hit|insta\b/.test(m[0] + m[1]) ? 3 : 1; }],
    [/^(?:give|gives|grant|grants|award|awards|are worth|is worth|worth|reward|rewards)\s*(?:you|me|the player)?\s*(.*)/, (m, r) => {
      const rest = m[1] || '';
      const n = numberIn(rest);
      if (/\b(?:points?|score|pts)\b/.test(rest) || /^\d+$/.test(rest.trim())) { r.collect = true; r.pts = n == null ? 1 : n; }
      else if (/\b(?:health|hp|hearts?|lives?|life)\b/.test(rest)) { r.collect = true; r.fx2 = 'heal'; r.amount = n || 1; }
      else if (/\b(?:speed|boost|energy)\b/.test(rest)) { r.collect = true; r.fx2 = 'speed'; }
      else if (/\b(?:time|seconds)\b/.test(rest)) { r.collect = true; r.fx2 = 'time'; }
      else if (/\b(?:invincib|power|super)\w*/.test(rest)) { r.collect = true; r.fx2 = 'invincible'; }
      else if (/\b(?:coins?|money|gold)\b/.test(rest)) { r.collect = true; r.pts = n || 3; }
      else if (/\b(?:a hug|hugs|love|advice|hints?|tips?|quests?)\b/.test(rest)) { r.talk = true; }
      else { r.collect = true; r.pts = n || 1; }
    }],
    [/^(?:drop|drops|dropping|leave behind|leaves behind|leave|leaves)\s+(.*)/, (m, r, c) => { const np = I.parseNP(m[1].replace(/\s+when.*$/, ''), [], c); if (np && (np.key || np.word)) r.drops = np; }],
    [/^(?:spawn|spawns|spawning|lay|lays|laying|summon|summons|summoning|produce|produces|create|creates|birth|births|release|releases|poop|poops|shit|shits)\s+(.*)/, (m, r, c) => { const np = I.parseNP(m[1].replace(/\s+(?:every|when).*$/, ''), [], c); if (np && (np.key || np.word)) { r.spawns = np; const e = /every (\d+(?:\.\d+)?)/.exec(m[1]); if (e) r.spawnEvery = +e[1]; } }],
    [/^(?:protect|protects|protecting|guard|guards|guarding|defend|defends|defending|help|helps|helping|fight for|fights for|fight with|fight alongside|fights alongside|fight enemies|fights enemies|fight monsters|attack enemies|attacks enemies|kill enemies|kills enemies|back me up|have my back|has my back|assist|assists)\s*(.*)/, (m, r, c) => {
      const t = targetOf(m[1], c);
      if (!t || t === 'player' || t === 'enemy') { r.friend = true; r.b.push({ type: 'follow', target: 'player' }, { type: 'guard' }); }
      else r.b.push({ type: 'orbit', target: t, radius: 120 });
    }],
    [/^(?:fight|fights|fighting|battle|battles)\s*(.*)/, (m, r, c) => { const t = targetOf(m[1], c); if (t && t !== 'player') { r.b.push({ type: 'chase', target: t }); r.friend = t === 'enemy'; } else { r.hostile = true; r.b.push({ type: 'chase', target: 'player' }); } }],
    [/^(?:talk|talks|talking|say|says|saying|speak|speaks|tell|tells|greet|greets|chat|chats|whisper|whispers|yell|yells|shout|shouts)\s*(.*)/, (m, r) => { r.talk = true; r.sayText = m[1] || null; }],
    [/^(?:sleep|sleeps|sleeping|nap|naps|rest|rests|wait|waits|lurk|lurks|hide|hides)\b/, (m, r) => { r.b.push({ type: 'sleep' }); }],
    [/^(?:copy|copies|mimic|mimics|imitate|imitates|mirror|mirrors|copy my moves)\b/, (m, r) => { r.b.push({ type: 'mimic' }); }],
    [/^(?:freeze|freezes|slow|slows)\s+(?:me|you|the player|down the player)/, (m, r) => { r.freeze = true; r.hostile = true; }],
    [/^(?:glow|glows|glowing|shine|shines|shining|light up|lights up|illuminate)\b/, (m, r) => { r.fx.push('glow'); }],
    [/^(?:sparkle|sparkles|sparkling|glitter|glitters|shimmer|shimmers|twinkle|twinkles)\b/, (m, r) => { r.fx.push('sparkle'); }],
    [/^(?:zigzag|zig zag|zig-zag|zigzags|stumble|stumbles|wobble|wobbles|stagger|staggers|jitter|jitters)\b/, (m, r) => { if (/wobble/.test(m[0])) r.fx.push('wobble'); else r.b.push({ type: 'zigzag' }); }],
    [/^(?:charge|charges|dash|dashes|rush|rushes|ram|rams|lunge|lunges|pounce|pounces)\s*(.*)/, (m, r, c) => { r.b.push({ type: 'charge', target: targetOf(m[1], c) || 'player' }); r.hostile = true; }],
    [/^(?:fall|falls|falling|rain down|rains down|drop from the sky|drops from the sky|come from the sky|comes from the sky|fall from the sky|falls from the sky)\b/, (m, r) => { r.b.push({ type: 'fall' }); r.where = 'top'; }],
    [/^(?:drift|drifts|drifting|float around|floats around|wander through space)\b/, (m, r) => { r.b.push({ type: 'drift' }); }],
    [/^(?:keep (?:their|its|a) distance|keep away|keeps away|stay away|stays away|snipe|snipes)\b/, (m, r) => { r.b.push({ type: 'kite', target: 'player' }); }],
    [/^(?:roll|rolls|rolling|tumble|tumbles)\b/, (m, r) => { r.roll = true; r.b.push({ type: 'patrol' }); }],
    [/^(?:cannot be killed|can not be killed|are invincible|is invincible|never die|never dies|are immortal|is immortal|cannot die)\b/, (m, r) => { r.invulnerable = true; }],
    [/^(?:die|dies) (?:in|after|from) (?:1|one|a single|\d+) (?:hit|shot)s?/, (m, r) => { const n = numberIn(m[0]); r.hpSet = n || 1; }],
    [/^(?:move|moves|go|goes|run|runs) (fast|quickly|really fast|super fast|slow|slowly|really slow|super slow)\b/, (m, r) => { r.speedMul = /fast|quick/.test(m[1]) ? 1.8 : 0.5; }],
    [/^(?:look|looks) like (?:a |an |the )?(.+)/, (m, r) => { const g = L.glyphFor(stripDet(m[1]).split(/\s+/).pop()); if (g) r.glyph = g; }],
    [/^(?:sit|sits|stand|stands|stay|stays|do nothing|does nothing|stand still|stands still|stay still|stays still|do not move|does not move)\b/, (m, r) => { r.static = true; }],
    [/^(?:push|pushes|knock|knocks|shove|shoves)\s*(?:me|you|the player)?\s*(?:back|away|around)?/, (m, r) => { r.hostile = true; r.dmg = 0; r.knock = true; }],
    [/^(?:can be pushed|are pushable|is pushable|can be moved|are movable)\b/, (m, r) => { r.pushable = true; }],
    [/^(?:swallow|swallows|absorb|absorbs)\s*(.*)/, (m, r, c) => { r.b.push({ type: 'eat', target: targetOf(m[1], c) || 'collectible' }); }],
    [/^(?:pull|pulls|attract|attracts|suck|sucks)\s*(.*)/, (m, r, c) => { r.b.push({ type: 'magnet', target: targetOf(m[1].replace(/\s*(?:in|toward \w+)\s*$/, ''), c) || 'player' }); }],
    [/^(?:are|is|be|become|becomes|get|gets|look|looks|seem|seems)\s+(.*)/, (m, r, c, np) => { const adj = I.parseProps(m[1], c, np); r.props.push(...adj); }],
    [/^(?:have|has|with|carry|carries|carrying|wear|wears|wearing|hold|holds|holding|wield|wields|wielding|equipped with)\s+(.*)/, (m, r) => {
      const a = stripDet(m[1]);
      for (const [k, v] of Object.entries(BODY_ATTR)) if (new RegExp('\\b' + k + '\\b').test(a)) { r.attrs.push(Object.assign({ key: k }, v)); return; }
      const n = /(\d+)\s*(?:hp|health|hit points|hearts|lives)/.exec(a);
      if (n) { r.hpSet = +n[1]; return; }
      const g = L.glyphFor(a.split(/\s+/).pop());
      r.attrs.push({ key: a, cosmetic: a, glyph: g });
    }],
    [/^(?:always|sometimes|occasionally|constantly|randomly|slowly|quickly|really|just|also|only|can|will|should|try to|tries to|like to|likes to|love to|loves to|want to|wants to|keep|keeps|start to|starts to|begin to|begins to)\s+(.*)/, (m, r, c, np) => { r.recurse = m[1]; }],
  ];

  I.parseVP = function (text, quotes, ctx, np) {
    const r = { b: [], fx: [], props: [], attrs: [], hostile: false, friend: false };
    let t = String(text || '').trim();
    // where-clauses
    const where = [
      [/\b(?:from the sky|from above|from the top|falling from the sky|raining from the sky|out of the sky)\b/, 'top'],
      [/\b(?:everywhere|all over the (?:place|map|level|world|screen)|all over|around the map)\b/, 'random'],
      [/\b(?:in the corners?|at the edges?|from the edges?|from the sides?|around the edges|on the edges)\b/, 'edges'],
      [/\b(?:around me|near me|next to me|close to me|by me|beside me|around the player|near the player)\b/, 'near-player'],
      [/\b(?:in the (?:center|centre|middle)|at the (?:center|centre|middle))\b/, 'center'],
      [/\b(?:on the ground|on the floor|on platforms|on the platforms)\b/, 'ground'],
      [/\b(?:in the sky|in the air|up high|in the clouds)\b/, 'sky'],
      [/\b(?:at the end|at the exit|at the goal|at the finish)\b/, 'goal'],
      [/\b(?:at the start|at the beginning|at the spawn)\b/, 'start'],
      [/\b(?:in a grid|in rows|at the top in rows)\b/, 'grid'],
    ];
    for (const [re, w] of where) if (re.test(t)) { r.where = w; t = t.replace(re, ' ').trim(); }
    const q = quoteOf(t, quotes || []);
    if (q) { r.quote = q; t = t.replace(/\s*qq\d+\s*/g, ' ').trim(); }
    const ev = /\bevery (\d+(?:\.\d+)?) ?(?:seconds?|secs?|s)\b/.exec(t);
    if (ev) { r.every = +ev[1]; }
    t = t.replace(/^(?:that|which|who|whom|to)\s+/, '').trim();
    if (/^with\s+/.test(t)) t = 'have ' + t.slice(5);
    if (/^(?:from|in|on|at|near|around)\b/.test(t)) return r;
    if (/\bwhen (?:they|it|he|she) (?:die|dies|are killed|is killed|get killed|gets killed)\b/.test(t)) r.onDeathClause = true;
    const parts = t.split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+(?:then\s+)?|\s+but\s+|\s+then\s+|\s+while\s+)\s*/).filter(Boolean);
    for (let p of parts) {
      p = p.replace(/^(?:that|which|who|they|it|he|she|can|will|should|always|also|also can|then|to|that can|who can|which can)\s+/, '').replace(/^(?:can|will|should|always|also)\s+/, '').trim();
      if (!p) continue;
      let depth = 0, cur = p;
      while (cur && depth < 3) {
        let hit = false;
        for (const [re, fn] of VERBS) {
          const m = re.exec(cur);
          if (m) {
            r.recurse = null;
            fn(m, r, ctx, np);
            hit = true;
            if (r.recurse) { cur = r.recurse; depth++; } else cur = null;
            break;
          }
        }
        if (!hit) {
          // maybe an adjective list ("fast and red")
          const props = I.parseProps(cur, ctx, np);
          if (props.length) r.props.push(...props);
          else r.unparsed = (r.unparsed || []).concat(cur);
          cur = null;
        }
      }
      if (r.onDeathClause && r.drops) { /* drop on death */ }
    }
    return r;
  };

  // ---------------------------------------------------------------------------
  // property phrases ("faster", "twice as big", "red", "worth 5 points")
  // ---------------------------------------------------------------------------
  function intensity(s) {
    const n = /(\d+(?:\.\d+)?)\s*times\b/.exec(s);
    if (n) return Math.max(0.05, +n[1]);
    if (/\btwice\b|\bdouble\b|\b2 times\b/.test(s)) return 2;
    if (/\btriple\b|\bthrice\b/.test(s)) return 3;
    if (/\bhalf\b/.test(s)) return 2;
    if (/\b(?:insanely|ridiculously|absurdly|extremely|incredibly|massively|hyper|ultra|stupidly|crazy|mega|way way|so so|super duper|10 times)\b/.test(s)) return 3;
    if (/\b(?:much|a lot|way|super|really|very|even|lots|so much|tons|significantly|considerably|heaps)\b/.test(s)) return 2;
    if (/\b(?:a bit|slightly|a little|somewhat|a tad|a touch|kind of|sort of|a smidge|marginally|little)\b/.test(s)) return 1.2;
    return 1.5;
  }
  I.intensity = intensity;

  I.parseProps = function (s, ctx, np) {
    s = String(s || '').trim().replace(/^(?:be|become|get|look|seem|feel)\s+/, '');
    const out = [];
    const too = /^(?:too|way too|far too|a bit too|kind of too|so|really|very)?\s*/.exec(s);
    const isToo = /\btoo\b/.test(s);
    const k = intensity(s);
    const inv = (x) => (isToo ? 1 / x : x);
    const push = (o) => out.push(o);
    if (/\b(?:fast|faster|quicker|quick|speedier|speedy|zoomier|rapid|swifter|more speed|speed up|sped up|hurry)\b/.test(s)) push({ prop: 'speed', mul: inv(k) });
    if (/\b(?:slow|slower|sluggish|less speed|slow down|slowed down|lazier)\b/.test(s)) push({ prop: 'speed', mul: inv(1 / k) });
    const spd = /\bspeed (?:of |to |at )?(\d+)|(\d+) speed\b/.exec(s); if (spd) push({ prop: 'speed', set: +(spd[1] || spd[2]) });
    if (/\b(?:bigger|larger|huger|taller|fatter|chonkier|thicker|wider|grow|enlarge)\b/.test(s)) push({ prop: 'size', mul: inv(k) });
    else if (/\b(?:huge|giant|gigantic|enormous|massive|colossal|big|large|tall|fat)\b/.test(s) && !/\b(?:too)\b/.test(s)) push({ prop: 'size', mul: /huge|giant|gigantic|enormous|massive|colossal/.test(s) ? 2.4 : 1.6 });
    else if (/\b(?:huge|giant|big|large|tall|fat)\b/.test(s) && isToo) push({ prop: 'size', mul: 0.6 });
    if (/\b(?:smaller|tinier|shorter|thinner|littler|shrink|shrunk|less big)\b/.test(s)) push({ prop: 'size', mul: inv(1 / k) });
    else if (/\b(?:tiny|small|little|mini|teeny|itty bitty|microscopic)\b/.test(s) && !isToo) push({ prop: 'size', mul: /tiny|teeny|microscopic|itty/.test(s) ? 0.45 : 0.7 });
    else if (/\b(?:tiny|small|little)\b/.test(s) && isToo) push({ prop: 'size', mul: 1.6 });
    const sz = /\bsize (?:of |to )?(\d+)/.exec(s); if (sz) push({ prop: 'size', set: +sz[1] });
    if (/\b(?:stronger|tougher|tankier|beefier|sturdier|harder to kill|more health|more hp|more hit points|durable|thicc)\b/.test(s)) push({ prop: 'hp', mul: inv(k) });
    if (/\b(?:weaker|easier to kill|less health|less hp|fragile|frail|squishier|squishy)\b/.test(s)) push({ prop: 'hp', mul: inv(1 / k) });
    if (/\b(?:one hit|1 hit|die in one hit|die instantly|one shot|1 shot|glass cannon)\b/.test(s)) push({ prop: 'hp', set: 1 });
    const hp = /(\d+)\s*(?:hp|health|hit points|hearts|lives|life)\b|\b(?:hp|health) (?:of |to )?(\d+)/.exec(s); if (hp) push({ prop: /lives|life/.test(s) && !/hp|health|heart/.test(s) ? 'lives' : 'hp', set: +(hp[1] || hp[2]) });
    if (/\b(?:invincible|immortal|indestructible|unkillable|god ?mode|unstoppable|invulnerable|cannot die|can not die|never die)\b/.test(s)) push({ prop: 'invulnerable', set: true });
    if (/\b(?:deadlier|more dangerous|hurt more|hit harder|more damage|stronger attacks|lethal|deadly|dangerous|harmful|hurt|evil|hostile|aggressive|angry|mean|mad|enemies|an enemy|enemy|bad guys|villains)\b/.test(s) && !/\bnot\b/.test(s)) push({ prop: 'hostile', set: true, dmgMul: /deadl|more damage|hit harder|lethal|hurt more/.test(s) ? 2 : 1 });
    if (/\b(?:harmless|friendly|safe|nice|kind|peaceful|good guys|not dangerous|not hurt|allies|an ally|on my side|friends|my friends|good|helpful|loyal)\b/.test(s)) push({ prop: 'friendly', set: true });
    if (/\bworth (\d+)|(\d+)\s*points?\b|give (\d+)/.test(s)) { const m = /worth (\d+)|(\d+)\s*points?\b|give (\d+)/.exec(s); push({ prop: 'points', set: +(m[1] || m[2] || m[3]) }); }
    else if (/\bworth more\b|\bmore valuable\b|\bmore points\b/.test(s)) push({ prop: 'points', mul: 2 });
    else if (/\b(?:collectible|collectable|pickups?|collect them|collected|items)\b/.test(s)) push({ prop: 'collectible', set: true });
    if (/\b(?:invisible|hidden|unseen)\b/.test(s)) push({ prop: 'alpha', set: 0.06 });
    else if (/\b(?:transparent|see[- ]through|translucent|ghostly|faded)\b/.test(s)) push({ prop: 'alpha', set: 0.4 });
    else if (/\b(?:visible|opaque|solid|seen)\b/.test(s) && !/\bnot\b/.test(s)) push({ prop: 'alpha', set: 1 });
    // colors
    const words = s.split(/[\s,]+/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (L.colors[w] && !/^(?:neon|pastel)$/.test(w)) {
        let c = L.colors[w];
        if (/^(?:light|pale|bright)$/.test(words[i - 1])) c = U.shade(c, 0.3);
        if (/^(?:dark|deep)$/.test(words[i - 1])) c = U.shade(c, -0.35);
        if (words[i - 1] === 'neon') c = U.hsl(U.hueOf(c), 100, 60);
        push({ prop: 'color', set: c, name: w });
        break;
      }
    }
    if (/\brainbow\b|\brainbows\b|\ball the colors\b|\bcolorful\b|\bcolourful\b/.test(s)) push({ prop: 'fx', add: 'rainbow' });
    for (const [w, fx] of [['glow', 'glow'], ['glowing', 'glow'], ['shiny', 'sparkle'], ['sparkly', 'sparkle'], ['sparkle', 'sparkle'], ['spin', 'spin'], ['spinning', 'spin'], ['wobbly', 'wobble'], ['jiggly', 'wobble'], ['pulse', 'pulse'], ['pulsing', 'pulse'], ['flicker', 'flicker'], ['flickering', 'flicker'], ['dance', 'dance'], ['dancing', 'dance'], ['trail', 'trail'], ['trails', 'trail'], ['blinking', 'blink']]) if (new RegExp('\\b' + w + '\\b').test(s)) push({ prop: 'fx', add: fx });
    if (/\b(?:fly|flying|flies|float|floating|hover|airborne|in the air)\b/.test(s)) push({ prop: 'flying', set: !/\bnot|stop|no longer|ground\b/.test(s) });
    if (/\b(?:ghost|ghostly|phase through walls|go through walls|through walls|pass through walls|noclip|ethereal)\b/.test(s)) push({ prop: 'ghost', set: true });
    if (/\b(?:bouncy|bounce|bouncier|rubbery|springy)\b/.test(s)) push({ prop: 'bouncy', set: 0.85 });
    if (/\b(?:explode|explosive|exploding|explosions?|blow up)\b/.test(s)) push({ prop: 'explosive', set: true });
    if (/\b(?:smarter|smart|clever|intelligent|cunning|genius|wiser|tactical)\b/.test(s)) push({ prop: 'smart', set: true });
    if (/\b(?:dumber|dumb|stupid|confused|clueless|derpy|silly|aimless|lost)\b/.test(s)) push({ prop: 'dumb', set: true });
    if (/\b(?:still|static|stationary|frozen in place|stop moving|not move|immobile|statues?)\b/.test(s)) push({ prop: 'static', set: true });
    if (/\b(?:move|moving|mobile|alive|walk around)\b/.test(s) && /\b(?:start|make|let)\b/.test(s)) push({ prop: 'static', set: false });
    if (/\b(?:pushable|movable|push them|push it|can be pushed)\b/.test(s)) push({ prop: 'pushable', set: true });
    if (/\b(?:heavier|heavy)\b/.test(s)) push({ prop: 'gravity', mul: isToo ? 0.6 : 1.6 });
    if (/\b(?:lighter|floatier|floaty|light as a feather)\b/.test(s)) push({ prop: 'gravity', mul: 0.5 });
    if (/\b(?:jump higher|higher jumps?|jump further|jump more|jump farther|bigger jumps?|super jump|jump really high|jump like crazy|jump high)\b/.test(s)) push({ prop: 'jump', mul: Math.min(2, k > 1.4 ? 1.35 : 1.2) * (isToo ? 0.6 : 1) });
    if (/\b(?:jump lower|lower jumps?|smaller jumps?|jump less|jumps? (?:is|are) too high)\b/.test(s)) push({ prop: 'jump', mul: 0.78 });
    if (/\b(?:shoot faster|fire faster|faster fire|rapid ?fire|faster shooting|machine gun|more bullets)\b/.test(s)) push({ prop: 'fireRate', mul: 2 });
    if (/\b(?:more|lots more|many more|extra|additional|plenty more)\b/.test(s) && !/\bmore (?:health|hp|speed|damage|points|dangerous|valuable)\b/.test(s)) push({ prop: 'count', mul: isToo ? 0.5 : k > 1.5 ? 2.5 : 1.8 });
    if (/\b(?:fewer|less of them|not as many|less many|reduce)\b/.test(s)) push({ prop: 'count', mul: 0.5 });
    if (/\bmany\b/.test(s) && isToo) push({ prop: 'count', mul: 0.5 });
    if (/\b(?:respawn|keep coming|come back|endless|infinite|never stop coming|keep spawning)\b/.test(s)) push({ prop: 'respawn', set: true });
    if (/\b(?:harder|more difficult|more challenging|tougher to beat)\b/.test(s)) push({ prop: 'difficulty', set: isToo ? -1 : 1 });
    if (/\b(?:easier|less difficult|simpler|easy)\b/.test(s) && !/\beasier to kill\b/.test(s)) push({ prop: 'difficulty', set: isToo ? 1 : -1 });
    if (/\b(?:dark|darker|gloomy|dim)\b/.test(s) && /\b(?:too)\b/.test(s)) push({ prop: 'lights', set: true });
    if (/\b(?:brighter|bright|lit)\b/.test(s)) push({ prop: 'lights', set: true });
    if (/\b(?:darker|dark|gloomy|dim|moody|ominous)\b/.test(s) && !isToo) push({ prop: 'dark', set: true });
    if (/\b(?:loud|louder|annoying)\b/.test(s)) push({ prop: 'loud', set: isToo || /annoying/.test(s) });
    if (/\b(?:quieter|softer|less loud)\b/.test(s)) push({ prop: 'loud', set: true });
    // shapes
    for (const sh of ['square', 'circle', 'triangle', 'diamond', 'star', 'hex', 'blob']) if (new RegExp('\\b' + sh + 's?\\b').test(s) && /\b(?:shape|shaped|look like|square|round|circular|triangular)\b|^(?:\w+\s+)?\w+s?$/.test(s)) push({ prop: 'shape', set: sh });
    if (/\bround\b|\bcircular\b/.test(s)) push({ prop: 'shape', set: 'circle' });
    // adjective lexicon
    for (const w of words) if (L.adjectives[w] && !/^(fast|quick|slow|big|small|huge|giant|tiny|little|large)$/.test(w) && !out.some((o) => o.adj === w)) push({ prop: 'adj', adj: w });
    // "into X" / "look like X"
    const into = /\b(?:into|like|look like|looks like|resemble)\s+(?:a |an |the )?(\w[\w ]*)$/.exec(s);
    if (into) { const n = I.parseNP(into[1], [], ctx); if (n && (n.key || n.word)) push({ prop: 'transform', np: n }); }
    void too; void np;
    return out;
  };

  // ---------------------------------------------------------------------------
  // targets
  // ---------------------------------------------------------------------------
  const ROLE_WORDS = [
    [/^(?:enemies|enemy|monsters?|bad guys?|baddies|foes?|hostiles?|bad things|mobs?|evil things|the bad ones|creeps)$/, 'enemy'],
    [/^(?:collectibles?|collectables?|items?|pickups?|loot|power ?ups?|powerups?|treasures?|goodies|stuff to collect)$/, 'collectible'],
    [/^(?:npcs?|characters?|people|villagers?|townsfolk|humans?)$/, 'npc'],
    [/^(?:projectiles?|bullets?|shots?|my bullets?|my shots?|ammo|missiles?|lasers?|fireballs?)$/, 'projectile'],
    [/^(?:bosse?s?|the boss|boss monsters?|big bad)$/, 'boss'],
    [/^(?:pets?|companions?|friends?|allies|sidekicks?|buddies)$/, 'pet'],
    [/^(?:obstacles?|walls?|rocks?|blocks?)$/, 'obstacle'],
    [/^(?:hazards?|traps?|dangers?|dangerous things)$/, 'hazard'],
    [/^(?:animals?|critters?|wildlife|creatures?)$/, 'critter'],
    [/^(?:structures?|buildings?)$/, 'structure'],
  ];
  const GLOBAL_WORDS = /^(?:everything|everyone|everybody|all|all of it|the whole thing|the whole game|the game|game|this game|the world|world|it all|things|stuff|all the things|all entities|the entire game|this)$/;
  const FEATURE_WORDS = {
    gravity: /^(?:gravity|the gravity)$/,
    background: /^(?:background|the background|bg|backdrop|sky|the sky)$/,
    music: /^(?:music|the music|soundtrack|the soundtrack|song|the song|sound|sounds|the sound|audio|sfx|sound effects)$/,
    camera: /^(?:camera|the camera|view|the view|zoom|screen shake|shake)$/,
    level: /^(?:level|the level|map|the map|world size|the world|arena|the arena|maze|the maze|layout|terrain)$/,
    walls: /^(?:walls|the walls|wall|borders|edges|the edges)$/,
    lighting: /^(?:lights|lighting|the lights|darkness|the dark|light)$/,
    colors: /^(?:colors|colours|the colors|the colours|palette|color scheme|colour scheme|theme)$/,
    timer: /^(?:timer|the timer|time limit|clock|countdown)$/,
    hud: /^(?:hud|ui|the hud|the ui|score|the score|health bar|interface)$/,
    jump: /^(?:jump|the jump|jumping|jumps|my jump)$/,
    title: /^(?:title|the title|name|the name|game name)$/,
    weather: /^(?:weather|rain|snow|fog|the rain|the snow|the fog|storm|the weather)$/,
    screen: /^(?:screen|the screen|graphics|visuals|the graphics|the visuals|everything visually|the look)$/,
  };

  I.resolveTarget = function (raw, ctx) {
    let s = String(raw || '').trim().replace(/[!?.]+$/, '');
    s = s.replace(/^(?:all of (?:the|my)|all the|all|every|each|the|my|our|those|these|that|this)\s+/, '').replace(/^(?:the|my)\s+/, '');
    if (!s) return null;
    if (isPlayerWord(s) || isPlayerWord('the ' + s) || /^(?:me|myself|i|player|character|hero|avatar|guy|ship|car)$/.test(s) && (s !== 'ship' || (ctx.spec.player && /🚀|🛸/.test(ctx.spec.player.glyph || ''))) ) return { kind: 'player' };
    if (ctx.spec.player && ctx.spec.player.label && s === ctx.spec.player.label.toLowerCase()) return { kind: 'player' };
    if (PRONOUNS.test(s) || /^(?:it|them|they)$/.test(s)) {
      if (ctx.focus && ctx.focus.length) return { kind: 'types', names: ctx.focus.slice(), pronoun: true };
      return { kind: 'pronoun' };
    }
    for (const [f, re] of Object.entries(FEATURE_WORDS)) if (re.test(s)) return { kind: 'feature', name: f };
    if (GLOBAL_WORDS.test(s)) return { kind: 'global' };
    // exact type names
    const types = Object.keys(ctx.spec.types);
    const tryName = (w) => {
      const id = U.ident(w);
      if (ctx.spec.types[id]) return id;
      const sing = U.ident(L.singular(w.split(' ').pop()));
      if (ctx.spec.types[sing]) return sing;
      const sw = U.ident(w.split(' ').map((x) => L.singular(x)).join(' '));
      if (ctx.spec.types[sw]) return sw;
      const f = L.findNoun(w);
      if (f && ctx.spec.types[f.key]) return f.key;
      // labels
      for (const [n, d] of Object.entries(ctx.spec.types)) if (d.label && d.label.toLowerCase() === w) return n;
      // partial match: "red zombies" -> red_zombie, "zombies" -> red_zombie if unique
      const hits = types.filter((n) => n === sing || n.endsWith('_' + sing) || n.startsWith(sing + '_'));
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return hits;
      // fuzzy
      for (const n of types) if (n.length > 3 && U.levenshtein(sing, n) <= 1) return n;
      return null;
    };
    const hit = tryName(s);
    if (hit) return { kind: 'types', names: Array.isArray(hit) ? hit : [hit] };
    for (const [re, role] of ROLE_WORDS) if (re.test(s)) {
      const names = role === 'projectile' ? types.filter((n) => ctx.spec.types[n].projectile) : VC.Spec.typesByRole(ctx.spec, role);
      return { kind: 'role', role, names };
    }
    // "zombies and ghosts"
    if (/\s+and\s+/.test(s)) {
      const names = [];
      for (const part of s.split(/\s+and\s+/)) { const r = I.resolveTarget(part, ctx); if (r && r.names) names.push(...r.names); }
      if (names.length) return { kind: 'types', names };
    }
    // a known noun not yet in the game
    const np = I.parseNP(s, [], ctx);
    if (np && (np.key || np.word)) return { kind: 'missing', np };
    return null;
  };

  // ---------------------------------------------------------------------------
  // rules (conditionals)
  // ---------------------------------------------------------------------------
  const SUBJ_PLAYER = '(?:i|we|you|the player|player|my character|my ship|my car|my guy|the hero)';
  const TOUCH = '(?:touch|touches|hit|hits|collide with|collides with|run into|runs into|bump into|bumps into|crash into|crashes into|bump|bumps|meet|meets|reach|reaches|step on|steps on|land on|lands on|walk into|walks into|walk over|walks over|go into|goes into|enter|enters|get to|gets to|go to|goes to|overlap|overlaps|stand on|stands on|jump on|jumps on|jump onto|stomp on|stomps on|stomp|fall in|fall into|falls into|go through|goes through|pass through|passes through|swim in|swims in|run over|runs over|catch|catches|get hit by|gets hit by|am hit by|is hit by|get touched by|am touched by|bump against|come in contact with|make contact with)';
  const COLLECT = '(?:collect|collects|pick up|picks up|grab|grabs|get|gets|eat|eats|take|takes|find|finds|obtain|obtains|gather|gathers|consume|consumes|loot|loots|open|opens|pick|picks|nab|nabs|snag|snags|acquire|acquires|drink|drinks|munch|munches)';
  const KILL = '(?:kill|kills|defeat|defeats|destroy|destroys|shoot|shoots|slay|slays|beat|beats|pop|pops|squash|squashes|smash|smashes|murder|murders|eliminate|eliminates|take down|takes down|knock out|knocks out|stomp|stomps|squish|squishes|break|breaks|blast|blasts|zap|zaps|vanquish|vanquishes)';

  function npTarget(s, ctx) {
    s = (s || '').trim().replace(/^(?:a|an|the|any|some|one|all the|all|every|each|my|those|these)\s+/, '');
    if (!s) return null;
    if (/^(?:lava|the lava|molten lava)$/.test(s)) return { sel: 'lava', tile: true };
    if (/^(?:water|the water|a lake|lakes?|the ocean|ponds?|rivers?)$/.test(s)) return { sel: 'water', tile: true };
    if (/^(?:spikes?|the spikes)$/.test(s) && !(ctx.spec.types.spike || ctx.spec.types.spikes)) return { sel: 'spikes', tile: true };
    if (/^(?:a wall|the wall|walls?|the walls|the ground|ground|the floor|floor)$/.test(s)) return { sel: 'wall', tile: true };
    if (/^(?:ice|the ice)$/.test(s) && !ctx.spec.types.ice) return { sel: 'ice', tile: true };
    if (/^(?:the end|the goal|the exit|the finish(?: line)?|the flag|end of the level|the end of the level|the top)$/.test(s)) return { sel: '__goal' };
    if (isPlayerWord(s)) return { sel: 'player' };
    const r = I.resolveTarget(s, ctx);
    if (!r) return null;
    if (r.kind === 'player') return { sel: 'player' };
    if (r.kind === 'types' && r.names.length === 1) return { sel: r.names[0] };
    if (r.kind === 'types' && r.names.length > 1) return { sel: r.names[0], also: r.names.slice(1) };
    if (r.kind === 'role') return { sel: r.role === 'projectile' ? 'projectile' : r.role, role: true };
    if (r.kind === 'missing') return { sel: U.ident(r.np.key || r.np.word), np: r.np, missing: true };
    if (r.kind === 'pronoun' && ctx.focus && ctx.focus.length) return { sel: ctx.focus[0] };
    return null;
  }

  function parseTrigger(c, ctx) {
    let m;
    const P = SUBJ_PLAYER;
    const re = (s) => new RegExp('^' + s);
    // timers
    if ((m = /^every (\d+(?:\.\d+)?)?\s*(seconds?|secs?|s|minutes?|mins?|frames?)\b/.exec(c)) || (m = /^every (few|couple of) (seconds|minutes)\b/.exec(c))) {
      let n = m[1] === 'few' ? 4 : m[1] === 'couple of' ? 2 : m[1] ? +m[1] : 1;
      if (/^min/.test(m[2])) n *= 60;
      return { trig: { type: 'onTimer', every: U.clamp(n, 0.2, 600) }, rest: c.slice(m[0].length) };
    }
    if ((m = /^every (\d+) (?:points?|score)\b/.exec(c))) return { trig: { type: 'onScore', atLeast: +m[1], every: true }, rest: c.slice(m[0].length) };
    if ((m = /^(?:after|in) (\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?)\b/.exec(c))) { let n = +m[1]; if (/^min/.test(m[2])) n *= 60; return { trig: { type: 'onAfter', seconds: n }, rest: c.slice(m[0].length) }; }
    if ((m = /^at (\d+) (?:points?|score)\b/.exec(c))) return { trig: { type: 'onScore', atLeast: +m[1] }, rest: c.slice(m[0].length) };
    if ((m = /^(?:at the (?:start|beginning)|the game starts|the level starts|it starts|the round starts|i start|we start|the game begins|the level begins|i spawn)\b/.exec(c))) return { trig: { type: 'onStart' }, rest: c.slice(m[0].length) };
    if ((m = /^(?:level (\d+) (?:starts|begins)|i (?:reach|get to) level (\d+))\b/.exec(c))) return { trig: { type: 'onLevel', level: +(m[1] || m[2]) }, rest: c.slice(m[0].length) };
    if ((m = /^(?:time runs out|the timer (?:ends|runs out|hits zero|reaches zero|is up)|time is up|the time is up|the clock runs out|the countdown ends|we run out of time|i run out of time)\b/.exec(c))) return { trig: { type: 'onTimeUp' }, rest: c.slice(m[0].length) };
    // score
    if ((m = /^(?:the |my )?score (?:reaches|hits|is|gets to|goes above|goes over|passes|exceeds|is over|is above|is at least|reaches at least|equals|gets above|gets over|becomes)\s*(\d+)/.exec(c)) || (m = re(P + ' (?:have|get|reach|score|earn|hit|get to|make) (\\d+) (?:points?|score|pts)').exec(c))) return { trig: { type: 'onScore', atLeast: +m[1] }, rest: c.slice(m[0].length) };
    // health
    if ((m = re(P + ' (?:am|are|is|get|gets) (?:low on health|almost dead|nearly dead|hurt badly|low hp|on low health|dying)').exec(c)) || (m = /^(?:my )?(?:health|hp) (?:is low|gets low|drops|is below \d+|is under \d+)/.exec(c)) || (m = re(P + ' (?:have|has) (?:1|one|only one|a single) (?:heart|hp|health|life) left').exec(c))) {
      const n = numberIn(m[0]);
      return { trig: { type: 'onHealth', atMost: n && n < 50 ? n : 1 }, rest: c.slice(m[0].length) };
    }
    // cleared
    if ((m = re(P + ' (?:collect|kill|defeat|destroy|get|grab|eat|clear|beat|find|pick up|shoot|pop) (?:all|every|each)(?: of)?(?: the)? (\\w[\\w ]*?)(?=$|,| then | i | we | the | you | everything| spawn| a | an | it | they |\\s+(?:win|lose|die|get|gain|go|level|teleport|explode|show|play))').exec(c))) {
      const t = npTarget(m[1], ctx); if (t) return { trig: { type: 'onCleared', of: t.sel }, rest: c.slice(m[0].length), need: t.missing ? t.np : null };
    }
    if ((m = /^(?:all (?:the |of the )?(\w[\w ]*?) (?:are|have been|get|got|is) (?:dead|gone|collected|destroyed|killed|cleared|eaten|defeated|popped|picked up)|there are no (?:more )?(\w[\w ]*?)(?: left)?(?=$|,| then )|(?:the )?(\w[\w ]*?) are all (?:gone|dead|collected|destroyed))/.exec(c))) {
      const t = npTarget(m[1] || m[2] || m[3], ctx); if (t) return { trig: { type: 'onCleared', of: t.sel }, rest: c.slice(m[0].length) };
    }
    // counted collect / kill
    if ((m = re(P + ' (?:' + COLLECT.slice(3, -1) + '|have|has) (\\d+) (\\w[\\w ]*?)(?=$|,| then | i | we | you | the | it | they |\\s+(?:win|lose|die|get|gain|go|level|teleport|explode|spawn|show|play))').exec(c))) {
      const t = npTarget(m[2], ctx);
      if (t && /^(?:points?|score|pts)$/.test(m[2])) return { trig: { type: 'onScore', atLeast: +m[1] }, rest: c.slice(m[0].length) };
      if (t) return { trig: { type: 'onCollected', of: t.sel, count: +m[1] }, rest: c.slice(m[0].length), need: t.missing ? t.np : null };
    }
    if ((m = re(P + ' ' + KILL + ' (\\d+) (\\w[\\w ]*?)(?=$|,| then | i | we | you | the | it | they |\\s+(?:win|lose|die|get|gain|go|level|teleport|explode|spawn|show|play))').exec(c))) {
      const t = npTarget(m[2], ctx); if (t) return { trig: { type: 'onKilled', of: t.sel, count: +m[1] }, rest: c.slice(m[0].length), need: t.missing ? t.np : null };
    }
    // player verbs
    if ((m = re(P + ' (?:die|dies|lose all (?:my|their) health|run out of (?:health|lives|hp)|get killed|am killed|are killed|lose the game)').exec(c))) return { trig: { type: 'onDeath', of: 'player' }, rest: c.slice(m[0].length) };
    if ((m = re(P + ' (?:get hit|gets hit|take damage|takes damage|get hurt|gets hurt|am hit|am hurt|are hurt|lose (?:a |one )?(?:life|heart|hp|health))(?! by)').exec(c))) return { trig: { type: 'onHurt', of: 'player' }, rest: c.slice(m[0].length) };
    if ((m = re(P + ' (?:double )?(?:jump|jumps|hop|hops)\\b').exec(c))) return { trig: { type: 'onJump' }, rest: c.slice(m[0].length) };
    if ((m = re(P + ' (?:land|lands|touch the ground|hit the ground)\\b').exec(c))) return { trig: { type: 'onLand' }, rest: c.slice(m[0].length) };
    if ((m = re(P + ' (?:dash|dashes)\\b').exec(c))) return { trig: { type: 'onDash' }, rest: c.slice(m[0].length) };
    if ((m = re(P + ' (?:shoot|shoots|fire|fires|attack|attacks)(?=$|,| then | i | the | it | a | everything| all )').exec(c))) return { trig: { type: 'onShoot' }, rest: c.slice(m[0].length) };
    if ((m = re(P + ' (?:press|presses|hit|hits|tap|taps|push|pushes|hold|holds) (?:the )?(space ?bar|space|enter|shift|tab|[a-z0-9])(?: key| button)?\\b').exec(c))) {
      let key = m[1]; if (/space/.test(key)) key = ' '; else if (key === 'enter') key = 'enter';
      return { trig: { type: 'onKey', key }, rest: c.slice(m[0].length) };
    }
    if ((m = re(P + ' (?:click|clicks|tap|taps|click on|clicks on|tap on|taps on) (?:a |an |the |on )?(\\w[\\w ]*?)(?=$|,| then | it | they | i | the )').exec(c))) {
      const t = npTarget(m[1], ctx); if (t) return { trig: { type: 'onClick', of: t.sel }, rest: c.slice(m[0].length), need: t.missing ? t.np : null };
    }
    if ((m = re(P + ' (?:fall|falls|fall off|fall out|fall down|fall into the void|fall off the map|fall off the edge|fall into a pit|fall in a pit|fall off the level)(?: the (?:map|level|world|edge|platform))?').exec(c))) return { trig: { type: 'onFall', of: 'player' }, rest: c.slice(m[0].length) };
    if ((m = re(P + ' (?:am|are|is|get|gets|go|goes|come|comes|walk|walks) (?:near|close to|next to|up to|nearby|by)\\s+(?:a |an |the )?(\\w[\\w ]*?)(?=$|,| then | it | they | he | she | i | the )').exec(c)) || (m = re(P + ' (?:approach|approaches|talk to|talks to|speak to|speaks to|stand next to|visit|visits) (?:a |an |the )?(\\w[\\w ]*?)(?=$|,| then | it | they | he | she | i | the )').exec(c))) {
      const t = npTarget(m[1], ctx); if (t) return { trig: { type: 'onNear', a: 'player', b: t.sel, distance: 100 }, rest: c.slice(m[0].length), need: t.missing ? t.np : null };
    }
    if ((m = re(P + ' (?:reach|reaches|get to|gets to|touch|touches|find|finds) (?:the )?(?:end|goal|exit|finish(?: line)?|flag|top|end of the level|portal to the next level)\\b').exec(c))) return { trig: { type: 'onCollide', a: 'player', b: '__goal' }, rest: c.slice(m[0].length) };
    if ((m = re(P + ' (?:finish|finishes|complete|completes|beat|beats) (?:the |a )?level').exec(c))) return { trig: { type: 'onCollide', a: 'player', b: '__goal' }, rest: c.slice(m[0].length) };
    if ((m = re(P + ' ' + KILL + ' (?:a |an |the |any |some |one )?(\\w[\\w ]*?)(?=$|,| then | it | they | he | she | i | we | you | the | a | an | everything | all |\\s+(?:explode|explodes|spawn|drop|win|get|gain|level|play|show|split|turn))').exec(c))) {
      const t = npTarget(m[1], ctx); if (t) return { trig: { type: 'onDeath', of: t.sel }, rest: c.slice(m[0].length), need: t.missing ? t.np : null };
    }
    if ((m = re(P + ' (?:' + COLLECT.slice(3, -1) + '|' + TOUCH.slice(3, -1) + ') (?:a |an |the |any |some |one )?(\\w[\\w ]*?)(?=$|,| then | it | they | he | she | i | we | you | the | a | an | my | everything | all |\\s+(?:explode|explodes|spawn|drop|win|get|gain|level|play|show|split|turn|lose|die|go|grow|become|teleport|bounce|heal|restart))').exec(c))) {
      const t = npTarget(m[1], ctx); if (t) return { trig: { type: 'onCollide', a: 'player', b: t.sel }, rest: c.slice(m[0].length), need: t.missing ? t.np : null, verb: 'collect' };
    }
    // other subjects
    const SUBJ = '(?:a |an |the |any |one of the |one |some )?(\\w[\\w ]*?)';
    if ((m = new RegExp('^' + SUBJ + ' (?:touches|touch|hits|hit|catches|catch|bites|bite|reaches|reach|gets|get|eats|eat|attacks|attack|grabs|grab|bumps into|bump into|runs into|run into|collides with|collide with|stings|sting|finds|find) (me|you|the player|us|a |an |the |any )?(\\w[\\w ]*?)?(?=$|,| then | it | they | i | we | you | the | everything |\\s+(?:explode|explodes|spawn|drop|win|get|gain|level|play|show|split|turn|lose|die))').exec(c))) {
      const a = npTarget(m[1], ctx);
      const bRaw = m[2] && /me|you|the player|us/.test(m[2]) ? 'player' : (m[3] || '').trim();
      const b = bRaw === 'player' ? { sel: 'player' } : npTarget(bRaw, ctx);
      if (a && b) return { trig: { type: 'onCollide', a: a.sel, b: b.sel }, rest: c.slice(m[0].length), need: a.missing ? a.np : b.missing ? b.np : null };
    }
    if ((m = new RegExp('^' + SUBJ + ' (?:dies|die|is killed|are killed|gets killed|get killed|is destroyed|are destroyed|gets destroyed|get destroyed|explodes|explode|pops|pop|is defeated|are defeated|gets shot|get shot|is shot|are shot|breaks|break|is popped|gets popped|bursts|burst)\\b').exec(c))) {
      const a = npTarget(m[1], ctx); if (a) return { trig: { type: 'onDeath', of: a.sel }, rest: c.slice(m[0].length), need: a.missing ? a.np : null };
    }
    if ((m = new RegExp('^' + SUBJ + ' (?:gets hit|get hit|is hit|are hit|gets hurt|get hurt|takes damage|take damage|is damaged)\\b').exec(c))) {
      const a = npTarget(m[1], ctx); if (a) return { trig: { type: 'onHurt', of: a.sel }, rest: c.slice(m[0].length) };
    }
    if ((m = new RegExp('^' + SUBJ + ' (?:hits|hit|touches|touch|bumps into|reaches|reach) (?:a |the )?(?:wall|walls|ground|floor|edge|edges|ceiling)\\b').exec(c))) {
      const a = npTarget(m[1], ctx); if (a) return { trig: { type: 'onHitWall', of: a.sel }, rest: c.slice(m[0].length) };
    }
    if ((m = new RegExp('^' + SUBJ + ' (?:spawns|spawn|appears|appear|shows up|show up|is born|are born|arrives|arrive)\\b').exec(c))) {
      const a = npTarget(m[1], ctx); if (a) return { trig: { type: 'onSpawn', of: a.sel }, rest: c.slice(m[0].length) };
    }
    if ((m = new RegExp('^' + SUBJ + ' (?:falls|fall|falls off|fall off|falls out|fall out|falls down|fall down)\\b').exec(c))) {
      const a = npTarget(m[1], ctx); if (a && a.sel !== 'player') return { trig: { type: 'onFall', of: a.sel }, rest: c.slice(m[0].length) };
    }
    if ((m = new RegExp('^' + SUBJ + ' (?:is|are|gets|get|comes|come) (?:near|close to|close) (?:me|you|the player)\\b').exec(c)) || (m = new RegExp('^' + SUBJ + ' (?:approaches|approach|sees|see|spots|spot|notices|notice) (?:me|you|the player)\\b').exec(c))) {
      const a = npTarget(m[1], ctx); if (a) return { trig: { type: 'onNear', a: a.sel, b: 'player', distance: 150 }, rest: c.slice(m[0].length) };
    }
    return null;
  }

  // action phrases
  function parseActions(text, ctx, trig, quotes) {
    const acts = [], needs = [], unparsed = [];
    let t = text.trim().replace(/^(?:,|then|and|so|it should|it will|it|you should|make it so|make it so that|have it)\s+/, '');
    const itSel = trig ? (trig.type === 'onCollide' ? (trig.a === 'player' ? 'other' : 'self') : 'self') : 'self';
    const subjSel = (w) => {
      w = (w || '').trim();
      if (!w) return itSel;
      if (/^(?:it|they|them|that|this|those|these|he|she|its)$/.test(w)) return itSel;
      if (isPlayerWord(w)) return 'player';
      if (/^(?:everything|all enemies|every enemy|all the enemies|enemies)$/.test(w)) return 'all:enemy';
      if (/^(?:all|every|each)\s+/.test(w)) { const t2 = npTarget(w.replace(/^(?:all(?: the| of the)?|every|each)\s+/, ''), ctx); return t2 ? 'all:' + t2.sel : 'all:enemy'; }
      const tt = npTarget(w, ctx);
      if (tt) { if (tt.missing) needs.push(tt.np); return tt.sel; }
      return itSel;
    };
    const parts = t.split(/\s*(?:,\s*(?:and\s+)?(?:then\s+)?|\s+and then\s+|\s+then\s+|\s+and\s+(?=(?:i|we|you|it|they|the|a|an|spawn|play|shake|flash|show|say|make|everything|all|my|gain|lose|get|add|teleport|explode|win|go|turn|destroy|kill|freeze|give|heal|confetti|slow|flip|zoom|start|stop|restart)\b)|\s+also\s+|\s+plus\s+)\s*/).filter(Boolean);
    for (let p of parts) {
      p = p.trim().replace(/^(?:should|will|would|then|also|and|it should|it will)\s+/, '').trim();
      if (!p) continue;
      const q = quoteOf(p, quotes);
      let m;
      const P = SUBJ_PLAYER;
      const R = (s) => new RegExp('^' + s);
      if ((m = R(P + '? ?(?:get|gets|become|becomes|grow|grows|turn|turns|go|goes) ?(bigger|larger|huge|giant|taller|fatter|massive|enormous|big)\\b').exec(p))) { acts.push({ type: 'grow', target: 'player', factor: /huge|giant|massive|enormous/.test(m[1]) ? 1.6 : 1.25 }); continue; }
      if ((m = R(P + '? ?(?:get|gets|become|becomes|turn|turns|go|goes)? ?(?:smaller|tiny|little|shorter|shrink|shrinks)\\b').exec(p))) { acts.push({ type: 'grow', target: 'player', factor: 0.8 }); continue; }
      if ((m = R(P + ' (?:get|gets|become|becomes|go|goes|move|moves|run|runs)? ?(?:faster|quicker|speed up|speeds up|a speed boost|speedier)').exec(p)) || /^(?:speed boost|a speed boost)$/.test(p)) { acts.push({ type: 'speedUp', target: 'player', factor: 1.2 }); continue; }
      if ((m = R(P + ' (?:get|gets|become|becomes|go|goes|move|moves)? ?(?:slower|slow down|slows down)').exec(p))) { acts.push({ type: 'speedUp', target: 'player', factor: 0.8 }); continue; }
      if ((m = R(P + ' (?:become|becomes|am|is|are|get|gets|turn|turns|go|goes) (invincible|invulnerable|immortal|invisible|a ghost|ghostly|giant|huge|tiny|super fast|super speed|magnetic|powered up|super|on fire|unstoppable)(?: for (\\d+) ?(?:seconds?|secs?|s))?').exec(p))) {
        const kind = /invinc|invul|immort|powered|super$|unstop|fire/.test(m[1]) ? 'invincible' : /invis|ghost/.test(m[1]) ? 'ghost' : /giant|huge/.test(m[1]) ? 'giant' : /tiny/.test(m[1]) ? 'tiny' : /fast|speed/.test(m[1]) ? 'speed' : 'magnet';
        acts.push({ type: 'powerup', kind, seconds: m[2] ? +m[2] : 6 }); continue;
      }
      if ((m = R(P + ' (?:can|get to) (fly|shoot|double jump|dash|teleport)(?: for (\\d+) ?(?:seconds?|secs?|s))?').exec(p))) {
        if (m[1] === 'fly') acts.push({ type: 'powerup', kind: 'fly', seconds: m[2] ? +m[2] : 6 });
        else acts.push({ type: 'giveAbility', ability: m[1] === 'double jump' ? 'jump' : m[1] === 'teleport' ? 'blink' : m[1] });
        continue;
      }
      if ((m = R(P + '? ?(?:get|gets|unlock|unlocks|gain|gains|receive|receives|earn|earns|find|finds) (?:a |an |the )?(gun|sword|shield|jetpack|double jump|dash|bombs?|wings|blaster|bow|magnet|laser)\\b').exec(p))) {
        const map = { gun: 'shoot', blaster: 'shoot', bow: 'shoot', laser: 'shoot', sword: 'melee', shield: 'shield', jetpack: 'fly', wings: 'fly', 'double jump': 'jump', dash: 'dash', bomb: 'bomb', bombs: 'bomb', magnet: 'magnet' };
        acts.push({ type: 'giveAbility', ability: map[m[1]] || 'shoot' }); continue;
      }
      if ((m = /(?:(?:i|we|you|the player) )?(?:get|gets|gain|gains|earn|earns|receive|receives|win|wins|score|scores|add|adds|plus|\+)\s*(\d+|a|an|one|some|ten|extra|more|bonus)?\s*(?:extra |bonus |more )?(?:points?|score|pts|coins?)\b/.exec(p)) || (m = /^(\d+)\s+(?:points?|pts)\b/.exec(p))) {
        const n = /^\d+$/.test(m[1] || '') ? +m[1] : m[1] === 'some' ? 5 : 1;
        acts.push({ type: 'addScore', amount: n }); continue;
      }
      if ((m = /(?:(?:i|we|you|the player) )?(?:lose|loses)\s*(\d+|a|an|one|some|all|all my|half)?\s*(?:of (?:my|the) )?(?:points?|score|coins?)\b/.exec(p))) { const n = /^\d+$/.test(m[1] || '') ? +m[1] : m[1] === 'all' || m[1] === 'all my' ? 9999 : m[1] === 'half' ? 10 : m[1] === 'some' ? 5 : 1; acts.push({ type: 'stealScore', amount: n }); continue; }
      if ((m = R(P + '? ?(?:lose|loses|take|takes|get|gets|suffer|suffers)\\s*(\\d+|a|an|one|some)?\\s*(?:life|lives|heart|hearts|health|hp|damage|hit|hits|hit points)\\b').exec(p))) { const n = /^\d+$/.test(m[1] || '') ? +m[1] : 1; acts.push({ type: 'damage', target: 'player', amount: n }); continue; }
      if ((m = R(P + '? ?(?:heal|heals|gain|gains|get|gets|regain|regains|restore|restores|recover|recovers|refill|refills)\\s*(\\d+|a|an|one|some|full|all my|my)?\\s*(?:extra )?(?:health|hp|life|lives|heart|hearts|hit points)\\b').exec(p)) || /^(?:heal|heals) (?:me|the player)/.test(p)) { const n = m && /^\d+$/.test(m[1] || '') ? +m[1] : m && /full|all/.test(m[1] || '') ? 99 : 1; acts.push({ type: 'heal', target: 'player', amount: n }); continue; }
      if (/^(?:it|that|this|they|he|she)?\s*(?:hurts|damages|harms|kills|bites|stings|burns) (?:me|you|the player)\b/.test(p)) { acts.push({ type: 'damage', target: 'player', amount: /kills/.test(p) ? 99 : 1 }); continue; }
      if (R(P + ' (?:lose a life|lose)$').test(p)) { acts.push({ type: 'damage', target: 'player', amount: 1 }); continue; }
      if (R(P + ' (?:die|dies|lose|lose the game|am dead|are dead|get killed|explode|explodes|perish|perishes)\\b').test(p) || /^(?:game over|the game ends|you die|death|it is game over|i lose)\b/.test(p)) { acts.push({ type: 'lose', text: q || 'GAME OVER' }); continue; }
      if (R(P + ' (?:win|wins|beat the game|beat the level|complete the game|am victorious|are victorious)\\b').test(p) || /^(?:victory|you win|win|win the game|the game is won|it is a win|i win|game won|the end)\b/.test(p)) { acts.push({ type: 'win', text: q || 'YOU WIN' }); continue; }
      if (/\b(?:next level|level up|new level|another level|the next stage|next stage|level 2|levels? advances?|advance (?:a|the) level)\b/.test(p)) { acts.push({ type: 'nextLevel' }); continue; }
      if (/^(?:restart|reset|start over|the game restarts|the level restarts|everything resets|respawn)\b/.test(p)) { acts.push({ type: 'restart' }); continue; }
      if ((m = /^(?:(it|they|them|that|this|he|she|the [\w ]+?|[\w ]+?) )?(?:explode|explodes|blow up|blows up|go boom|goes boom|detonate|detonates|burst|bursts|kaboom)\b/.exec(p))) {
        const s = subjSel(m[1]);
        if (/^everything$/.test((m[1] || '').trim())) acts.push({ type: 'explode', radius: 3000, damage: 99 });
        else { acts.push({ type: 'explode', radius: 100, damage: 2 }); if (s !== 'player' && s !== itSel) acts.push({ type: 'destroy', target: s }); else if (s === 'other' || (s === 'self' && trig && trig.type !== 'onDeath')) acts.push({ type: 'destroy', target: s }); }
        continue;
      }
      if ((m = /^(?:it |they |the sky |the clouds? )?(?:rains?|raining|starts raining|start raining) (.+)/.exec(p))) {
        const np = I.parseNP(m[1], quotes, ctx); if (np && (np.key || np.word)) { needs.push(np); acts.push({ type: 'spawn', what: U.ident(np.key || np.word), count: np.count || 12, at: 'top', __np: np }); continue; }
      }
      if ((m = /^(?:spawn|spawns|summon|summons|create|creates|release|releases|add|adds|drop|drops|make|makes|bring|brings|send|sends|send in|unleash|unleashes|produce|produces|generate|generates|place|places|put|puts|throw in|give me|leave|leaves)\s+(.+)/.exec(p))) {
        let rest = m[1];
        if (/^(?:the )?(?:next level|a new level)/.test(rest)) { acts.push({ type: 'nextLevel' }); continue; }
        const np = I.parseNP(rest, quotes, ctx);
        if (np && (np.key || np.word)) {
          const where = (np.vp && np.vp.where) || (/\bhere\b|\bthere\b|in its place|where it (?:was|died)|at (?:that|the same) (?:spot|place)/.test(rest) ? 'here' : null) || (trig && (trig.type === 'onDeath' || trig.type === 'onCollide') && /^(?:drop|drops|leave|leaves)/.test(p) ? 'here' : null);
          if (/^(?:drop|drops|leave|leaves)/.test(p) && trig && trig.type === 'onDeath') acts.push({ type: 'drop', what: U.ident(np.key || np.word), chance: 1, __np: np });
          else acts.push({ type: 'spawn', what: U.ident(np.key || np.word), count: Math.min(np.count || 1, 200), at: where || (np.key && L.noun(np.key) && L.noun(np.key).role === 'boss' ? 'random' : 'random'), __np: np });
          needs.push(np);
          continue;
        }
      }
      if ((m = /^(?:(?:a|an|the|some|\d+|more)\s+)?([\w ]+?)\s+(?:appear|appears|spawn|spawns|show up|shows up|pop up|pops up|come out|comes out|emerge|emerges|arrive|arrives|attack|attacks)\b/.exec(p))) {
        const np = I.parseNP(p.slice(0, p.indexOf(m[1]) + m[1].length), quotes, ctx);
        if (np && (np.key || np.word)) { needs.push(np); acts.push({ type: 'spawn', what: U.ident(np.key || np.word), count: Math.min(np.count || 1, 200), at: (np.vp && np.vp.where) || 'random', __np: np }); continue; }
      }
      if (/\b(?:screen ?shake|shake the screen|shakes|shake|earthquake|rumble|rumbles|camera shakes?|the screen shakes)\b/.test(p)) { acts.push({ type: 'shake', power: /\b(?:big|huge|massive|violent|hard|earthquake)\b/.test(p) ? 18 : 10 }); continue; }
      if ((m = /\b(?:flash|flashes|blinks?)\b(?:\s+(\w+))?/.exec(p))) { acts.push({ type: 'flash', color: L.color(m[1]) || '#ffffff' }); continue; }
      if ((m = /^(?:play|plays|make|makes)\s+(?:a |an |the )?([\w ]*?)\s*(?:sound|noise|sfx|sound effect)\b/.exec(p)) || (m = /^(?:a |an )?([\w]+) (?:sound|noise) (?:plays|is played)/.exec(p)) || (m = /^(beep|boop|quack|honk|ding|boom|bang|meow|woof|moo|bark|ring|chime|buzz|zap|pew|splat|squeak|oink|ribbit|baa)s?(?:\s|$)/.exec(p))) {
        acts.push({ type: 'sound', name: soundName(m[1]) }); continue;
      }
      if (/\b(?:confetti|fireworks|celebrate|celebration|party time|a party)\b/.test(p)) { acts.push({ type: 'confetti' }); acts.push({ type: 'sound', name: 'win' }); continue; }
      if ((m = /^(?:(it|they|he|she|the [\w ]+?|[\w ]+?) )?(?:says?|said|saying|yells?|shouts?|screams?|whispers?|tells? (?:me|you)|speaks?)\s*(?:that\s+)?(.*)$/.exec(p))) {
        const who = (m[1] || '').trim();
        const text2 = q || (m[2] ? m[2].replace(/\s*qq\d+\s*/g, '') : '') || '!';
        if (!who || /^(?:it|the game|a message|a sign|the screen)$/.test(who)) acts.push({ type: 'banner', text: text2 });
        else acts.push({ type: 'say', target: subjSel(who), text: text2 });
        continue;
      }
      if ((m = /^(?:show|shows|display|displays|print|prints|write|writes|pop up|announce|announces)\s+(?:a message\s+)?(?:saying\s+|that says\s+)?(.*)$/.exec(p)) || (m = /^(?:a |the )?(?:message|text|sign|popup|banner) (?:appears|pops up|shows up|that says|saying|says)\s*(.*)$/.exec(p))) {
        acts.push({ type: 'banner', text: q || m[1].replace(/\s*qq\d+\s*/g, '') || '!' }); continue;
      }
      if (/\b(?:slow motion|slow-mo|slowmo|bullet time|time slows(?: down)?|everything slows down|the game slows down|slows? down time|matrix mode)\b/.test(p)) { acts.push({ type: 'slowmo', seconds: 2, factor: 0.3 }); continue; }
      if (/\b(?:gravity (?:flips|reverses|inverts|switches|changes|turns upside down|goes upside down)|flip (?:the )?gravity|reverse (?:the )?gravity|(?:everything|i|the world) (?:falls up|goes upside down|turn upside down))\b/.test(p)) { acts.push({ type: 'flipGravity' }); continue; }
      if ((m = /^(?:(it|they|he|she|the [\w ]+?|[\w ]+?|everything|all enemies|enemies) )?(?:turn|turns|become|becomes|transform|transforms|morph|morphs|change|changes|evolve|evolves|mutate|mutates) (?:in)?to (?:a |an |the )?(.+)$/.exec(p))) {
        const who = (m[1] || '').trim();
        if (isPlayerWord(who)) {
          if (/\b(?:giant|huge|big)\b/.test(m[2])) acts.push({ type: 'powerup', kind: 'giant', seconds: 6 });
          else if (/\b(?:ghost|invisible)\b/.test(m[2])) acts.push({ type: 'powerup', kind: 'ghost', seconds: 6 });
          else acts.push({ type: 'powerup', kind: 'invincible', seconds: 5 });
          continue;
        }
        const np = I.parseNP(m[2], quotes, ctx);
        if (np && (np.key || np.word)) { needs.push(np); acts.push({ type: 'transform', target: subjSel(who), into: U.ident(np.key || np.word), __np: np }); continue; }
      }
      if ((m = /^(?:(it|they|he|she|the [\w ]+?|[\w ]+?) )?(?:multiply|multiplies|split|splits|duplicate|duplicates|clone|clones|divide|divides|break apart|breaks apart)(?: into (\d+))?/.exec(p))) { acts.push({ type: 'split', count: m[2] ? Math.min(6, +m[2]) : 2 }); continue; }
      if ((m = /^(?:(it|they|he|she|the [\w ]+?|[\w ]+?) )?(?:disappear|disappears|vanish|vanishes|die|dies|is destroyed|are destroyed|gets destroyed|go away|goes away|pop|pops|break|breaks|despawn|despawns|get eaten|gets eaten|is eaten|evaporate|evaporates|is collected|gets collected|are collected|get collected)\b/.exec(p))) { acts.push({ type: 'destroy', target: subjSel(m[1]) }); continue; }
      if ((m = /^(?:destroy|kill|remove|delete|clear|eliminate|wipe out|nuke|vaporize)\s+(?:all\s+)?(?:of\s+)?(?:the\s+)?(.+)$/.exec(p))) {
        const w = m[1].trim();
        if (/^(?:it|them|that|this)$/.test(w)) acts.push({ type: 'destroy', target: itSel });
        else if (/^(?:everything|all enemies|enemies|every enemy|the screen|all monsters|monsters|everyone)$/.test(w)) acts.push({ type: 'destroy', target: 'all:enemy' });
        else { const tt = npTarget(w, ctx); acts.push({ type: 'destroy', target: tt ? 'all:' + tt.sel : 'all:enemy' }); }
        continue;
      }
      if ((m = R('(?:teleport|teleports|warp|warps|send|sends|move|moves) (me|the player|it|them|him|her|everything)?\\s*(?:back )?(?:to )?(?:a |the )?(random (?:spot|place|location)|start|beginning|spawn|somewhere(?: else| random)?|center|middle|random)?').exec(p)) || (m = R(P + ' (?:teleport|teleports|warp|warps|get teleported|gets teleported|am teleported|is teleported|go back|goes back|respawn|respawns|return|returns)(?: to)?(?: the)?\\s*(start|beginning|spawn|random|center|somewhere)?').exec(p))) {
        const who = m[1] && !/^(start|beginning|spawn|random|center|somewhere)/.test(m[1]) ? subjSel(m[1]) : 'player';
        const w = m[2] || (m[1] && /^(start|beginning|spawn|random|center|somewhere)/.test(m[1]) ? m[1] : '');
        acts.push({ type: 'teleport', target: who, to: /start|beginning|spawn|back/.test(w + p) ? 'start' : /center|middle/.test(w) ? 'center' : 'random' }); continue;
      }
      if ((m = /^(?:the )?(?:screen|everything|the world|the background|the sky|the level|it all) (?:turns?|goes?|becomes?|flashes|glows) (\w+)/.exec(p))) {
        if (/^(?:dark|black|darker)$/.test(m[1])) acts.push({ type: 'toggleEffect', effect: 'darkness' });
        else if (/^(?:upside|flipped)$/.test(m[1])) acts.push({ type: 'toggleEffect', effect: 'flip' });
        else if (/^(?:rainbow|crazy|trippy|psychedelic)$/.test(m[1])) acts.push({ type: 'toggleEffect', effect: 'psychedelic' });
        else acts.push({ type: 'tint', color: L.color(m[1]) || '#ff4040', seconds: 2 });
        continue;
      }
      if (/\b(?:it gets dark|lights go out|the lights (?:turn|go) off|darkness falls|everything goes dark|the lights go out|night falls|turn off the lights)\b/.test(p)) { acts.push({ type: 'toggleEffect', effect: 'darkness' }); continue; }
      if (/\b(?:it starts raining|it starts to rain|it rains|rain starts|start raining)\b/.test(p)) { acts.push({ type: 'toggleEffect', effect: 'rain' }); continue; }
      if ((m = /\b(?:the )?music (?:changes|gets|becomes|turns|switches|goes)\s*(?:to\s+)?(?:more\s+)?(\w+)?/.exec(p)) || (m = /^(?:play|change to|switch to|start)\s+(\w+)\s+music/.exec(p))) { acts.push({ type: 'music', mood: moodOf(m[1] || 'intense') }); continue; }
      if ((m = /(?:add|adds|get|gets|gain|gains|plus|earn|earns|give me)\s+(\d+)\s+(?:more |extra |bonus )?(?:seconds?|secs?|s)\b/.exec(p)) || /\b(?:more time|extra time|time bonus|bonus time|add time)\b/.test(p)) { acts.push({ type: 'addTime', seconds: m && m[1] ? +m[1] : 10 }); continue; }
      if (R(P + '? ?(?:grow|grows|get|gets) (?:a )?(?:longer|tail|bigger tail|longer tail|another segment|a segment|longer snake)').test(p)) { acts.push({ type: 'growTail', amount: 1 }); continue; }
      if (R(P + ' (?:bounce|bounces|get launched|gets launched|am launched|fly up|flies up|jump high|get boosted|bounce off|bounce up|get flung|am flung|go flying|launch)').test(p) || /^(?:launch|fling|catapult|boost) (?:me|the player)/.test(p)) { acts.push({ type: 'launch', target: 'player', power: 1000 }); continue; }
      if (R(P + '? ?(?:get|gets|am|is)? ?(?:knocked back|pushed back|pushed away|knocked away|shoved)').test(p) || /^(?:knock|push|shove)s? (?:me|the player) (?:back|away)/.test(p)) { acts.push({ type: 'knockback', target: 'player', power: 600 }); continue; }
      if ((m = /^(?:freeze|freezes)\s+(.+)$/.exec(p)) || (m = /^(.+?) (?:freeze|freezes|gets frozen|get frozen|is frozen|are frozen)\b/.exec(p))) { const w = m[1].trim(); acts.push({ type: 'freeze', target: /^(?:everything|all enemies|enemies|everyone)$/.test(w) ? 'all:enemy' : subjSel(w), seconds: 3 }); continue; }
      if ((m = /\b(?:zoom|zooms|camera zooms|the camera zooms)\s*(in|out)?/.exec(p))) { acts.push({ type: 'zoom', amount: m[1] === 'out' ? 0.7 : 1.5 }); continue; }
      if ((m = /^(?:(it|they|everything|enemies|all enemies|the [\w ]+?|[\w ]+?) )?(?:speed up|speeds up|get faster|gets faster|go faster|goes faster|become faster|becomes faster|move faster|moves faster)\b/.exec(p))) { const w = (m[1] || '').trim(); acts.push({ type: 'speedUp', target: /^(?:everything|enemies|all enemies)$/.test(w) ? 'all:enemy' : subjSel(w), factor: 1.25 }); continue; }
      if ((m = /^(?:(it|they|everything|enemies|all enemies|the [\w ]+?|[\w ]+?) )?(?:get|gets|grow|grows|become|becomes) (bigger|larger|huge|smaller|tiny)\b/.exec(p))) { const w = (m[1] || '').trim(); acts.push({ type: 'grow', target: /^(?:everything|enemies|all enemies)$/.test(w) ? 'all:enemy' : subjSel(w), factor: /smaller|tiny/.test(m[2]) ? 0.75 : 1.3 }); continue; }
      if ((m = /^(?:(it|they|the [\w ]+?|[\w ]+?) )?(?:turn|turns|become|becomes|go|goes|change|changes)\s+(?:color\s+)?(?:to\s+)?(\w+)$/.exec(p)) && L.color(m[2])) { acts.push({ type: 'paint', target: subjSel(m[1]), color: L.color(m[2]) }); continue; }
      if ((m = /^(?:paint|color|colour)\s+(?:me|the player)\s+(\w+)/.exec(p))) { acts.push({ type: 'paint', target: 'player', color: L.color(m[1]) || '#e5484d' }); continue; }
      if (/^(?:everything|the whole screen|all enemies|enemies) (?:dies|die|explodes|explode|is destroyed|disappears)/.test(p)) { acts.push({ type: 'destroy', target: 'all:enemy' }); continue; }
      if ((m = /^(?:a |an |the )?(\w[\w ]*?)$/.exec(p)) && !/^(?:it|they|i|we|you)$/.test(p)) {
        // bare noun -> spawn it
        const np = I.parseNP(p, quotes, ctx);
        if (np && np.key && L.noun(np.key) && !np.unknown) { needs.push(np); acts.push({ type: 'spawn', what: np.key, count: np.count || 1, at: (np.vp && np.vp.where) || 'random', __np: np }); continue; }
      }
      unparsed.push(p);
    }
    return { acts, needs, unparsed };
  }
  function soundName(w) {
    w = (w || '').trim().split(/\s+/).pop() || 'blip';
    const map = { quack: 'quack', honk: 'quack', duck: 'quack', goose: 'quack', ding: 'coin', coin: 'coin', chime: 'coin', ring: 'coin', boom: 'explode', bang: 'explode', explosion: 'explode', kaboom: 'explode', beep: 'blip', boop: 'blip', blip: 'blip', meow: 'magic', woof: 'bounce', bark: 'bounce', moo: 'hurt', zap: 'laser', laser: 'laser', pew: 'laser', buzz: 'laser', splat: 'hit', squeak: 'pop', oink: 'hurt', ribbit: 'bounce', baa: 'hurt', win: 'win', victory: 'win', sad: 'lose', fail: 'lose', jump: 'jump', magic: 'magic', powerup: 'powerup', power: 'powerup', happy: 'powerup', scary: 'thunder', thunder: 'thunder', spooky: 'thunder', splash: 'splash', whoosh: 'dash', swoosh: 'swing', pop: 'pop', cute: 'pop', funny: 'quack', fart: 'hurt' };
    return map[w] || 'blip';
  }
  function moodOf(w) {
    w = w || '';
    if (/chill|calm|relax|lofi|lo-fi|ambient|jazz|soft|mellow|peace/.test(w)) return 'chill';
    if (/epic|hero|battle|boss|orchestr|dramatic|grand/.test(w)) return 'epic';
    if (/spook|scar|creep|eer|horror|dark|ominous|sinister|evil/.test(w)) return 'spooky';
    if (/happy|upbeat|cheer|fun|bounc|silly|joy|cute|party/.test(w)) return 'happy';
    if (/dream|ether|space|float|cosmic|sad|melanch|wistful|lonely/.test(w)) return 'dreamy';
    if (/intens|fast|action|techno|edm|metal|rock|hype|aggress|faster|crazy/.test(w)) return 'intense';
    if (/retro|chip|8-?bit|arcade|nostalg|pixel|old/.test(w)) return 'retro';
    return null;
  }
  I.moodOf = moodOf;

  I.parseRule = function (c, ctx, quotes) {
    let cond = null, actText = null;
    let m;
    // leading conditional
    if ((m = /^(?:when|whenever|if|each time|every time|anytime|any time|once|as soon as|after|upon)\s+(.*)$/.exec(c)) || (m = /^((?:every|at) \d+.*|every (?:second|minute|few seconds|couple of seconds).*|at the (?:start|beginning).*)$/.exec(c))) {
      let body = m[1];
      if (/^(?:every|at)\b/.test(c) && !/^(?:every time)\b/.test(c)) body = c;
      // timer form "every 5 seconds spawn X"
      const tr = parseTrigger(body.replace(/^(?:i |we )?(?:have|get) (?=\d)/, (x) => x), ctx);
      if (tr) {
        actText = tr.rest.replace(/^\s*(?:,|then|and then|:)?\s*/, '');
        cond = tr;
      } else {
        const sp = body.split(/\s*,\s*|\s+then\s+/);
        if (sp.length > 1) {
          const t2 = parseTrigger(sp[0], ctx);
          if (t2) { cond = t2; actText = sp.slice(1).join(', '); }
        }
      }
    }
    // trailing conditional: "X when Y" / "X every 5 seconds"
    if (!cond) {
      const idx = c.search(/\s+(?:when|whenever|if|each time|every time|once|as soon as|after (?=\d)|every (?=\d|second|minute|few)|at (?=\d+ points))\s+/);
      if (idx > 0) {
        const head = c.slice(0, idx), tail = c.slice(idx).trim().replace(/^(?:when|whenever|if|each time|every time|once|as soon as)\s+/, '');
        let saved = null;
        if (/^(?:it|they|them|he|she)\b/.test(tail)) {
          const subj = head.replace(/^(?:make|let|have|the|all the|all|my)\s+/g, '').split(/\s+/).slice(0, 3);
          for (let n = subj.length; n >= 1; n--) {
            const st = I.resolveTarget(subj.slice(0, n).join(' '), Object.assign({}, ctx, { focus: [] }));
            if (st && st.names && st.names.length) { saved = ctx.focus; ctx.focus = st.names; break; }
            if (st && st.kind === 'missing') { saved = ctx.focus; ctx.focus = [U.ident(st.np.key || st.np.word)]; ctx.__needSubject = st.np; break; }
          }
        }
        const tr = parseTrigger(tail, ctx) || parseTrigger(c.slice(idx).trim(), ctx);
        if (saved !== null) { ctx.focus = saved; if (tr && ctx.__needSubject) tr.need = tr.need || ctx.__needSubject; }
        delete ctx.__needSubject;
        if (tr && !tr.rest.trim()) { cond = tr; actText = head; }
        else if (tr) { cond = tr; actText = head + (tr.rest.trim() ? ', ' + tr.rest.trim() : ''); }
      }
    }
    if (!cond) return null;
    const pa = parseActions(actText || '', ctx, cond.trig, quotes);
    const needs = pa.needs.slice();
    if (cond.need) needs.unshift(cond.need);
    // detect "if i have the key" conditions
    let ruleCond = null;
    const hk = /\bif (?:i|we|you) (?:have|hold|carry|got) (?:a |an |the |(\d+) )?(\w+)/.exec(c);
    if (hk) { const t = npTarget(hk[2], ctx); if (t) ruleCond = { collected: t.sel, atLeast: hk[1] ? +hk[1] : 1 }; }
    return { kind: 'rule', trigger: cond.trig, actions: pa.acts, needs, unparsed: pa.unparsed, cond: ruleCond, raw: c, verb: cond.verb };
  };
  I.parseActions = parseActions;
  I.parseTrigger = parseTrigger;

  // ---------------------------------------------------------------------------
  // clause classification
  // ---------------------------------------------------------------------------
  const ENV = {
    rain: /\b(?:rain|raining|rainy|drizzle|downpour)\b/, storm: /\b(?:storm|stormy|thunderstorm|thunder|lightning storm)\b/, snow: /\b(?:snow|snowing|snowy|snowfall|blizzard|snowflakes)\b/,
    fog: /\b(?:fog|foggy|mist|misty|haze|hazy)\b/, embers: /\b(?:embers|ash|ashes|sparks flying)\b/, leaves: /\b(?:falling leaves|leaves falling|autumn leaves|autumn|fall leaves)\b/,
    dust: /\b(?:sandstorm|dust storm|dusty|dust)\b/, bubbles: /\b(?:bubbles|bubbly)\b/, fireflies: /\b(?:fireflies|firefly)\b/, sparkles: /\b(?:sparkles|glitter|sparkly air)\b/,
    darkness: /\b(?:dark|darkness|pitch black|lights off|flashlight|torch ?light|limited vision|fog of war|can only see around me|vision radius|lighting)\b/, night: /\b(?:night|nighttime|night time|at night|midnight|evening)\b/,
    daynight: /\b(?:day ?(?:and|\/|-)? ?night cycle|day night|day and night|day-night)\b/,
    crt: /\b(?:crt|old tv|retro tv|vhs|tube tv|arcade screen|arcade cabinet)\b/, scanlines: /\b(?:scanlines|scan lines)\b/, pixelate: /\b(?:pixelated|pixelate|pixel art|8-bit graphics|8 bit graphics|low res|low-res|lo-fi graphics|chunky pixels|pixely|pixels|retro graphics)\b/,
    grayscale: /\b(?:black and white|grayscale|greyscale|noir|monochrome|colorless|no color|no colour|desaturated)\b/, invert: /\b(?:inverted colou?rs|invert(?:ed)?|negative colou?rs|negative)\b/, sepia: /\b(?:sepia|old timey|old-timey|vintage|old photo|antique)\b/,
    psychedelic: /\b(?:trippy|psychedelic|acid trip|lsd|rainbow mode|disco mode|disco)\b/, wobble: /\b(?:wobbly|wobble|drunk|dizzy|wavy|nauseous|seasick|tipsy)\b/, flip: /\b(?:upside down|upside-down|flip the screen|flipped|turn the world upside down)\b/,
    mirror: /\b(?:mirror|mirrored|mirror mode|backwards screen|reversed screen)\b/, blur: /\b(?:blurry|blur|blurred|out of focus)\b/, chroma: /\b(?:glitch|glitchy|chromatic aberration|chromatic|rgb split|distorted)\b/,
    glow: /\b(?:bloom|glowy|glowing world|neon glow|everything glows)\b/, vignette: /\b(?:vignette)\b/, trails: /\b(?:motion trails|trails|motion blur|afterimages)\b/,
  };
  const BG = [
    [/\b(?:stars|starry|space|outer space|galaxy|cosmos|starfield|night sky)\b/, 'stars'], [/\b(?:ocean|sea|underwater|water|deep blue)\b/, 'ocean'], [/\b(?:clouds|cloudy|fluffy)\b/, 'clouds'],
    [/\b(?:sky|blue sky|daytime sky|sunny)\b/, 'sky'], [/\b(?:mountains?|peaks|alps)\b/, 'mountains'], [/\b(?:hills|rolling hills|meadow|grassland|fields)\b/, 'hills'], [/\b(?:forest|trees|woods|jungle)\b/, 'forest'],
    [/\b(?:desert|dunes|sand)\b/, 'dunes'], [/\b(?:snow|snowy|winter|arctic|ice)\b/, 'snow'], [/\b(?:hell|lava|fire|inferno|volcano)\b/, 'hell'], [/\b(?:city|skyline|buildings|downtown|cityscape)\b/, 'city'],
    [/\b(?:synthwave|vaporwave|retro sunset|outrun|80s|neon sunset)\b/, 'synthwave'], [/\b(?:graveyard|cemetery|tombstones|spooky)\b/, 'graveyard'], [/\b(?:grid|graph paper|blueprint)\b/, 'grid'], [/\b(?:dots|dotted|polka)\b/, 'dots'],
    [/\b(?:gradient|fade)\b/, 'gradient'], [/\b(?:void|plain|nothing|empty|black|blank|simple|solid)\b/, 'void'],
  ];
  I.ENV = ENV; I.BG = BG;

  function envIntent(c, ctx) {
    const remove = /^(?:remove|turn off|stop|disable|no more|get rid of|without|no|lose the|kill the|end the|hide)\b/.test(c) || /\b(?:stop (?:raining|snowing)|turn off|no more)\b/.test(c);
    const found = [];
    for (const [k, re] of Object.entries(ENV)) if (re.test(c)) found.push(k);
    if (/\b(?:day|daytime|daylight|morning|bright|lights on|turn on the lights)\b/.test(c) && !/day ?(?:and|\/|-)? ?night/.test(c)) return { kind: 'env', add: [], remove: ['darkness', 'night'], raw: c };
    if (!found.length) return null;
    // weather words used as nouns in other contexts ("ice slimes") are caught earlier
    if (found.includes('darkness') && /\b(?:dark (?:souls|matter|mode|elf|elves|knight|lord|magic|wizard|forest|cave|dungeon))\b/.test(c)) found.splice(found.indexOf('darkness'), 1);
    if (found.includes('storm')) found.push('rain');
    if (found.includes('crt')) found.push('scanlines');
    if (found.includes('night') && !remove) found.push('stars');
    if (!found.length) return null;
    return remove ? { kind: 'env', add: [], remove: found, raw: c } : { kind: 'env', add: found, remove: [], raw: c };
  }

  function paletteIntent(c) {
    let m = /\b(?:make |turn |paint |change |set )?(?:everything|it all|the whole game|the game|the world|the colou?rs?|the palette|the colou?r scheme|the theme|it)\s+(?:to\s+|into\s+)?(?:be\s+)?(?:look\s+)?(?:all\s+)?(?:more\s+)?(\w+(?:\s\w+)?)(?:\s+colou?r(?:s|ed)?)?$/.exec(c);
    if (!m) m = /^(?:use\s+)?(?:a\s+)?(\w+(?:\s\w+)?)\s+(?:colou?r ?scheme|palette|colou?rs|colou?r palette|aesthetic|vibes?|tones|look)$/.exec(c);
    if (!m) m = /^(?:change|switch|set) (?:the )?(?:colou?rs?|palette|colou?r scheme) (?:to )?(\w+(?:\s\w+)?)$/.exec(c);
    if (!m) return null;
    const w = m[1].replace(/^(?:a|an|the)\s+/, '').trim();
    const pal = L.palettes[w] ? w : L.paletteSynonyms[w] || L.paletteSynonyms[w.replace(/\s/g, '')];
    if (pal) return { kind: 'palette', palette: pal, word: w };
    const col = L.color(w.split(' ').pop());
    if (col) return { kind: 'palette', color: col, word: w, shade: w.split(' ')[0] };
    if (/^(?:warm|warmer)$/.test(w)) return { kind: 'palette', palette: 'ember', word: w };
    if (/^(?:cool|cooler|cold|colder)$/.test(w)) return { kind: 'palette', palette: 'ocean', word: w };
    if (/^(?:dark|darker|gloomy)$/.test(w)) return { kind: 'palette', palette: 'noir', word: w };
    if (/^(?:bright|brighter|colou?rful|vibrant|happy)$/.test(w)) return { kind: 'palette', palette: 'candy', word: w };
    return null;
  }

  function bgIntent(c) {
    const m = /\b(?:background|backdrop|bg|scenery|the sky)\b/.exec(c);
    if (!m) return null;
    const rest = c.replace(/.*\b(?:background|backdrop|bg|scenery|the sky)\b/, '') + ' ' + c.slice(0, m.index);
    const col = (rest.split(/\s+/).map((w) => L.color(w)).find(Boolean));
    for (const [re, bg] of BG) if (re.test(rest)) return { kind: 'background', bg, color: col || null, raw: c };
    if (col) return { kind: 'background', bg: 'gradient', color: col, raw: c };
    if (/^(?:remove|delete|no|clear|hide)\b/.test(c)) return { kind: 'background', bg: 'void', raw: c };
    return { kind: 'background', bg: null, raw: c };
  }

  function musicIntent(c) {
    if (!/\b(?:music|soundtrack|song|songs|tune|tunes|beats?|bgm|melody|melodies|bangers?|bops?|jams?|ost|score music|sound ?track)\b/.test(c)) {
      if (/^(?:mute|unmute|sound off|sound on|no sound|turn (?:off|on) (?:the )?sound|silence)\b/.test(c)) return { kind: 'music', off: /mute|off|no sound|silence/.test(c) && !/unmute/.test(c), sfx: true };
      if (/\b(?:sound effects|sfx)\b/.test(c)) return { kind: 'music', sfxOnly: true, off: /\b(?:no|remove|disable|turn off|mute|without|stop)\b/.test(c) };
      return null;
    }
    const off = /^(?:no|remove|stop|disable|turn off|mute|kill|without|delete|get rid of|lose the)\b/.test(c) || /\b(?:turn (?:the )?music off|music off|stop the music|no more music|silence the music)\b/.test(c);
    if (off) return { kind: 'music', off: true };
    const mood = moodOf(c);
    const faster = /\b(?:faster|speed up|quicker|more tempo|higher tempo)\b/.test(c) ? 1.25 : /\b(?:slower|slow down|lower tempo)\b/.test(c) ? 0.8 : null;
    return { kind: 'music', mood, tempoMul: faster, jazz: /jazz/.test(c), raw: c };
  }

  function worldIntent(c, ctx) {
    const out = [];
    if (/\bgravity\b/.test(c) || /\b(?:everything floats|zero g|zero-g|weightless|anti-?gravity|moon jump|low g)\b/.test(c)) {
      let g = null;
      if (/\b(?:reverse|reversed|flip|flipped|upside down|inverted|invert|negative|backwards|opposite|up instead of down|fall up|falls up)\b/.test(c)) g = { flip: true };
      else if (/\b(?:no|zero|off|remove|disable|without|turn off|get rid of|anti|weightless|everything floats|zero g|zero-g|0)\b/.test(c)) g = { set: 0 };
      else if (/\b(?:moon|lunar)\b/.test(c)) g = { mul: 0.25, word: 'moon' };
      else if (/\b(?:jupiter|neutron star|black hole|crushing|extreme|insane|massive)\b/.test(c)) g = { mul: 2.6, word: 'jupiter' };
      else if (/\b(?:low|lower|less|weaker|weak|floaty|floatier|light|lighter|reduce|decrease|half)\b/.test(c)) g = { mul: /\bhalf\b/.test(c) ? 0.5 : 0.45 };
      else if (/\b(?:high|higher|more|stronger|strong|heavy|heavier|increase|double|add|enable|turn on|realistic)\b/.test(c)) g = /\b(?:add|enable|turn on|realistic)\b/.test(c) ? { add: true } : { mul: /double/.test(c) ? 2 : 1.7 };
      else if (/\b(?:normal|default|regular|earth|reset)\b/.test(c)) g = { set: 1500 };
      const n = /gravity (?:to |of |at |= ?)?(-?\d+)/.exec(c); if (n) g = { set: +n[1] };
      if (g) out.push({ kind: 'world', prop: 'gravity', g, raw: c });
    }
    if (/\b(?:slow motion|slow-mo|slowmo|slow (?:down )?(?:the )?(?:game|everything|time)|everything (?:in )?slow motion|matrix)\b/.test(c) && !/\b(?:when|if|let me|ability)\b/.test(c)) out.push({ kind: 'world', prop: 'timeScale', mul: 0.6, raw: c });
    else if (/\b(?:speed up (?:the )?(?:game|everything|time)|(?:make )?(?:the )?game (?:go )?faster|double speed|fast forward|turbo mode|hyper speed|2x speed|faster game|everything faster|make everything faster)\b/.test(c)) out.push({ kind: 'world', prop: 'timeScale', mul: /double|2x/.test(c) ? 2 : 1.35, raw: c });
    else if (/\b(?:normal speed|regular speed|real ?time)\b/.test(c)) out.push({ kind: 'world', prop: 'timeScale', set: 1, raw: c });
    if (/\bzoom (?:in|closer)\b|\bcloser camera\b|\bcamera closer\b/.test(c)) out.push({ kind: 'world', prop: 'zoom', mul: 1.35, raw: c });
    if (/\bzoom (?:out|back)\b|\bwider (?:view|camera)\b|\bsee more\b|\bpull (?:the camera )?back\b/.test(c)) out.push({ kind: 'world', prop: 'zoom', mul: 0.75, raw: c });
    if (/\b(?:fixed|static|still|stationary|locked) camera\b|\bshow the whole (?:map|level|world)\b|\bcamera (?:should not|does not|doesnt) (?:move|follow)\b/.test(c)) out.push({ kind: 'world', prop: 'follow', set: false, raw: c });
    if (/\bcamera (?:should )?follows? (?:me|the player)\b|\bfollow(?:ing)? camera\b/.test(c)) out.push({ kind: 'world', prop: 'follow', set: true, raw: c });
    if (/\b(?:more|bigger|stronger|extra|lots of|add|add more) (?:screen ?shake|camera shake|shake)\b|\bshake more\b/.test(c)) out.push({ kind: 'world', prop: 'shake', mul: 2, raw: c });
    if (/\b(?:no|less|remove|disable|without|turn off) (?:screen ?shake|camera shake|shake)\b|\bstop shaking\b/.test(c)) out.push({ kind: 'world', prop: 'shake', set: /less/.test(c) ? 0.4 : 0, raw: c });
    if (/\b(?:wrap around|screen ?wrap|edges wrap|wraparound|wrap the edges|pac-?man (?:style )?edges|loop around|go off one side)\b/.test(c)) out.push({ kind: 'world', prop: 'bounds', set: 'wrap', raw: c });
    if (/\b(?:bigger|larger|huge|giant|massive|expand|grow) (?:level|world|map|arena)\b|\b(?:level|world|map|arena) (?:bigger|larger)\b|\bmake (?:the )?(?:level|world|map|arena) (?:bigger|larger|huge)\b/.test(c)) out.push({ kind: 'world', prop: 'size', mul: /huge|giant|massive/.test(c) ? 2 : 1.5, raw: c });
    if (/\b(?:smaller|tiny|little|shrink) (?:level|world|map|arena)\b|\bmake (?:the )?(?:level|world|map|arena) (?:smaller|tiny)\b/.test(c)) out.push({ kind: 'world', prop: 'size', mul: 0.7, raw: c });
    void ctx;
    return out;
  }

  const LEVEL_WORDS = [
    [/\b(?:maze|labyrinth|corridors)\b/, 'maze'], [/\b(?:caves?|cavern|caverns|underground tunnels|tunnels)\b/, 'caves'], [/\b(?:dungeon|rooms and corridors|rooms|catacombs|crypt)\b/, 'dungeon'],
    [/\b(?:platforms?|ledges)\b/, 'platforms'], [/\b(?:islands?|archipelago)\b/, 'islands'], [/\b(?:race ?track|track|circuit|loop track)\b/, 'track'], [/\b(?:tower|climb up|vertical level|climbing)\b/, 'tower'],
    [/\b(?:city|streets|city blocks|town|buildings)\b/, 'city'], [/\b(?:forest|lots of trees|woods)\b/, 'forest'], [/\b(?:obstacles|rocks everywhere|random walls|clutter|debris|boulders everywhere)\b/, 'obstacles'],
    [/\b(?:arena|colosseum|open field|open area|walled arena)\b/, 'arena'], [/\b(?:empty|open|flat|nothing|blank)\b/, 'empty'], [/\b(?:pipes|pipe gaps|gaps to fly through)\b/, 'pipes'],
  ];
  function levelIntent(c, ctx) {
    const remove = /^(?:remove|delete|get rid of|no|clear|without|destroy|take away|lose the|stop)\b/.test(c);
    let m;
    if (/\b(?:new|another|different|random|fresh) (?:level|map|layout|arena|maze|world)\b|\b(?:regenerate|reroll|re-roll|randomi[sz]e|shuffle)(?: the)? (?:level|map|layout|world|maze)?\b|\bgenerate a new (?:level|map)\b/.test(c)) return { kind: 'level', reseed: true, raw: c };
    if (/\bthe floor is lava\b/.test(c)) return { kind: 'level', type: 'islands', hazards: ['lava'], raw: c, floorLava: true };
    const hz = [];
    if (/\blava\b/.test(c)) hz.push('lava');
    if (/\bspikes?\b/.test(c) && !ctx.spec.types.spike) hz.push('spikes');
    if (/\b(?:water|lakes?|ponds?|rivers?|puddles of water)\b/.test(c) && !/\bunderwater\b/.test(c)) hz.push('water');
    if (/\b(?:ice|icy floors?|ice patches|slippery floors?)\b/.test(c)) hz.push('ice');
    if (/\b(?:bounce pads?|jump pads?|springs?|boost pads?)\b/.test(c)) hz.push('bounce');
    if (hz.length && (/^(?:add|put|place|scatter|include|make|there should be|with|i want|give|have)\b/.test(c) || remove || /^(?:lava|spikes|water|ice)/.test(c) || /\b(?:pits|pools|floors?|patches|everywhere)\b/.test(c))) return { kind: 'level', hazards: hz, removeHazards: remove, raw: c };
    if (/\b(?:more|denser|lots more|add more) (?:walls|obstacles|clutter|rocks|trees)\b/.test(c)) return { kind: 'level', density: 0.25, raw: c };
    if (/\b(?:fewer|less|sparser|less dense|remove some) (?:walls|obstacles|clutter|rocks|trees)\b/.test(c)) return { kind: 'level', density: -0.25, raw: c };
    if (remove && /\b(?:walls|the walls|obstacles|the level|the maze|platforms|terrain|all walls|the map)\b/.test(c)) return { kind: 'level', type: 'empty', raw: c, removed: true };
    if ((m = /^(?:add|put|place|build|make|create|generate|i want|give me|there should be|turn it into|make it|make the level|make the map|change the level to|switch to|use)\s+(?:a |an |some |the )?(?:level |map )?(?:with |of |into |in |be |a |an )*(.+)$/.exec(c)) || /\b(?:level|map|layout|stage|world)\b/.test(c)) {
      const text = m ? m[1] : c;
      for (const [re, type] of LEVEL_WORDS) if (re.test(text)) {
        if (type === 'empty' && !/\b(?:level|map|arena|world)\b/.test(c)) continue;
        if (type === 'forest' && !/\b(?:level|map|layout|lots of trees|woods)\b/.test(c) && /\btrees?\b/.test(c)) continue;
        if (type === 'city' && !/\b(?:level|map|layout|streets|city blocks)\b/.test(c)) continue;
        return { kind: 'level', type, raw: c };
      }
    }
    if (/^(?:add )?(?:walls|some walls)\b/.test(c)) return { kind: 'level', type: 'arena', raw: c };
    return null;
  }

  function hudIntent(c, ctx) {
    let m;
    if ((m = /\b(\d+)\s*(?:-\s*)?(second|sec|minute|min)s?\b.*\b(?:timer|time limit|countdown|limit|to (?:win|survive|collect|escape|finish|beat|get|kill|reach))\b/.exec(c)) || (m = /\b(?:timer|time limit|countdown|clock)\b(?:.*?(\d+)\s*(second|sec|minute|min)s?)?/.exec(c)) || (m = /\bsurvive (?:for )?(\d+)\s*(second|sec|minute|min)s?\b/.exec(c))) {
      if (/^(?:remove|no|disable|turn off|without|stop|delete|get rid of)\b/.test(c)) return { kind: 'hud', timer: 0, raw: c };
      let n = m[1] ? +m[1] : 60;
      if (/^min/.test(m[2] || '')) n *= 60;
      const survive = /\bsurviv/.test(c);
      const g = /\bto (collect|kill|defeat|destroy|get|grab|find|eat|reach|pop|clear|shoot)\s+(.+)$/.exec(c);
      return { kind: 'hud', timer: n, survive, goal: g ? 'i ' + g[1] + ' ' + g[2] : null, raw: c };
    }
    if ((m = /\b(?:give (?:me|the player)|i (?:have|get|should have)|set (?:my )?(?:lives|health|hp) to|with)\s+(\d+)\s+(lives|life|hearts|heart|hp|health|hit points)\b/.exec(c)) || (m = /\b(\d+)\s+(lives|hearts|hp)\b/.exec(c))) {
      const n = +m[1];
      return { kind: 'hud', [/lives|life/.test(m[2]) ? 'lives' : 'hp']: U.clamp(n, 1, 99), raw: c };
    }
    if (/\b(?:hide|remove|no|disable|without|turn off|get rid of) (?:the )?(?:hud|ui|score|health bar|hearts|health)\b/.test(c)) return { kind: 'hud', hide: /score/.test(c) ? 'score' : /health|hearts/.test(c) ? 'health' : 'all', raw: c };
    if (/\b(?:show|add|display|enable) (?:the |a )?(?:hud|ui|score|score counter|scoreboard|points counter|health bar|hearts)\b/.test(c)) return { kind: 'hud', show: true, raw: c };
    void ctx;
    return null;
  }

  function abilityIntent(c, ctx, quotes) {
    let m;
    let rest = null;
    if ((m = /^(?:let me|let the player|let us|i can|i could|the player can|the player could|allow me to|allow the player to|i should be able to|the player should be able to|make me able to|make it so (?:that )?i can|teach me (?:how )?to|give me the ability to|give the player the ability to|add the ability to|i get to|i will be able to|make it possible to|enable me to|i want the ability to|i want to be able to|we can|you can)\s+(.+)$/.exec(c))) rest = m[1];
    else if ((m = /^(?:add|enable|turn on|unlock|implement|code|give (?:me|the player|us) (?:a |an |the )?(?:ability to )?)\s*((?:a |an |the )?(?:double[ -]?jump|triple[ -]?jump|wall[ -]?jump|jumping|jump(?:ing)? ability|shooting|dash(?:ing)?|a dash|dodge roll|dodging|rolling|a shield|shields|shielding|blocking|a jetpack|jet ?packs?|flying|flight|bombs?|melee(?: attacks?)?|sword (?:fighting|attacks?|combat)|sword|combat|attacks?|teleport(?:ing|ation)?|blink(?:ing)?|bullet time|time slow(?:ing)?|slow ?mo(?:tion)? ability|regen(?:eration)?|health regen|a magnet|magnet|item magnet|coin magnet|flapping|a tail|tail|guns?|a gun|weapons?|a weapon|a blaster|a bow|a shotgun|a machine ?gun|rapid ?fire|auto[ -]?aim|auto[ -]?fire|a laser|lasers|homing missiles|missiles|a rocket launcher|rockets|fireballs|magic|spells|a boomerang|boomerangs|throwing (?:knives|stars)|grenades|a flamethrower)\b.*)$/.exec(c))) rest = m[1];
    else if ((m = /^(?:give|equip|arm)\s+(?:me|the player|us|my character|my guy)\s+(?:with\s+)?(?:a |an |the |some )?(.+)$/.exec(c))) rest = m[1];
    if (!rest) return null;
    rest = rest.replace(/^(?:a|an|the|some)\s+/, '').trim();
    const out = { kind: 'ability', raw: c, list: [] };
    const add = (name, params) => out.list.push({ name, params: params || {} });
    const r = rest;
    if (/\b(?:double[ -]?jump|jump twice|jump again in (?:the )?(?:air|mid-?air)|air jump)\b/.test(r)) add('jump', { double: true });
    else if (/\b(?:triple[ -]?jump|jump three times)\b/.test(r)) add('jump', { double: true, extra: 2 });
    else if (/\b(?:wall[ -]?jump|climb walls|jump off walls)\b/.test(r)) add('jump', { wall: true });
    else if (/^(?:jump|hop|leap|jumping)\b/.test(r)) add('jump', /\bhigh(?:er)?\b/.test(r) ? { power: 820 } : {});
    if (/^(?:shoot|fire|throw|cast|blast|launch|spit|toss|hurl|lob|pew)\b|\b(?:guns?|weapons?|blaster|shooting|shotgun|machine ?gun|rapid ?fire|auto[ -]?aim|auto[ -]?fire|laser|lasers|missiles|rocket launcher|rockets|fireballs|magic|spells|bow|boomerangs?|throwing knives|throwing stars|grenades|flamethrower)\b/.test(r) && !/^(?:double|wall|triple)/.test(r)) {
      const params = {};
      let projText = r.replace(/^(?:shoot|fire|throw|cast|blast|launch|spit|toss|hurl|lob|pew)\s*/, '');
      if (/\bshotgun\b/.test(r)) { params.count = 5; params.spread = 40; params.rate = 1.6; projText = 'pellets'; }
      if (/\b(?:machine ?gun|rapid ?fire|minigun|gatling)\b/.test(r)) { params.rate = 12; projText = projText.replace(/machine ?gun|rapid ?fire|minigun|gatling/, ''); }
      if (/\b(?:auto[ -]?aim|automatically|auto[ -]?fire|by itself|on its own|homing)\b/.test(r)) { params.aim = 'auto'; if (/\b(?:auto[ -]?fire|automatically|by itself|on its own)\b/.test(r)) params.auto = true; }
      if (/\b(?:in all directions|everywhere|all around|in a circle|360)\b/.test(r)) { params.count = 8; params.spread = 315; }
      const n = /(\d+)\s*(?:\w+\s+)?at (?:a time|once)|(\d+) (?:bullets|shots|projectiles|fireballs|lasers|arrows) at once/.exec(r); if (n) { params.count = Math.min(24, +(n[1] || n[2])); params.spread = params.spread || 30; }
      if (/\bflamethrower\b/.test(r)) { projText = 'flame'; params.rate = 14; params.spread = 18; params.count = 2; }
      if (/\bgrenades\b/.test(r)) projText = 'bomb';
      if (/\bthrowing stars\b/.test(r)) projText = 'shuriken';
      if (/\bbow\b/.test(r)) projText = 'arrow';
      if (/\brocket launcher\b/.test(r)) projText = 'rocket';
      if (/\b(?:magic|spells)\b/.test(r) && !projText) projText = 'magic';
      const p = projOf(projText.replace(/\b(?:at (?:enemies|monsters|them|things)|with (?:my |the )?(?:mouse|cursor)|when i (?:click|press)\b.*|by clicking|using \w+|guns?|weapons?|a weapon|blaster)\b/g, '').trim());
      if (p) { params.projectile = p.key; if (p.custom) out.customProj = p; }
      else if (/\bguns?|weapons?|blaster\b/.test(r)) params.projectile = /blaster/.test(r) ? 'laser' : 'bullet';
      add('shoot', params);
    }
    if (/^(?:dash|roll|dodge|sprint|zoom|blink dash)\b|\b(?:dash(?:ing)?|dodge roll|dodging|rolling)\b/.test(r)) add('dash');
    if (/^(?:fly|hover|levitate|soar|glide)\b|\b(?:jet ?packs?|flying|flight|wings)\b/.test(r)) add('fly');
    if (/^(?:flap)\b|\bflapping\b/.test(r)) add('flap');
    if (/^(?:swing|slash|attack|punch|kick|stab|hit|fight|melee|smack|bonk|whack|chop|cut)\b|\b(?:melee|sword|combat|katana|axe|hammer|bat|club|dagger|attacks?)\b/.test(r) && !out.list.some((x) => x.name === 'shoot')) {
      const w = /\b(sword|katana|axe|hammer|bat|club|dagger|spear|fists?|lightsaber|scythe|frying pan|baguette|fish|stick|whip)\b/.exec(r);
      add('melee', { weapon: w ? w[1] : /punch|kick|fight/.test(r) ? 'fist' : 'sword' });
    }
    if (/^(?:block|shield|defend|parry|protect myself)\b|\b(?:shields?|shielding|blocking)\b/.test(r)) add('shield');
    if (/^(?:teleport|blink|warp|phase)\b|\b(?:teleport(?:ing|ation)?|blink(?:ing)?)\b/.test(r)) add('blink');
    if (/^(?:drop|place|plant|lay|set) (?:a |down )?bombs?\b|\bbombs?\b/.test(r) && !out.list.some((x) => x.name === 'shoot')) add('bomb');
    if (/\b(?:slow (?:down )?time|stop time|bullet time|time slow(?:ing)?|freeze time|slow ?mo(?:tion)?)\b/.test(r)) add('slowtime');
    if (/^(?:heal|regenerate|regen)\b|\bregen(?:eration)?\b|\bhealth regen\b/.test(r)) add('regen');
    if (/\b(?:magnet|attract (?:coins|items|stuff|collectibles)|pull (?:in )?(?:coins|items)|suck (?:up|in) (?:coins|items))\b/.test(r)) add('magnet');
    if (/\b(?:tail|grow longer)\b/.test(r)) add('tail', { length: 4 });
    if (/^(?:run faster|move faster|go faster|sprint)\b/.test(r)) out.props = [{ prop: 'speed', mul: 1.4 }];
    if (/^(?:jump higher|jump further|super jump|jump really high|jump high)\b/.test(r)) { out.list = out.list.filter((x) => x.name !== 'jump'); add('jump', { mul: 1.3 }); }
    if (/^(?:swim|breathe underwater)\b/.test(r)) out.note = 'swim';
    if (!out.list.length && !out.props) {
      // "let me <action>" -> bind an action to a key
      const pa = parseActions(r, ctx, null, quotes || []);
      if (pa.acts.length) return { kind: 'keybind', actions: pa.acts, needs: pa.needs, raw: c };
      // "give me a pet dog" etc -> treat as add near player
      if (/^(?:give|equip|arm)/.test(c)) return null;
      return null;
    }
    return out;
  }

  function playerIntent(c, ctx, quotes) {
    const m = /^(?:i am|i'm|make me|turn me into|i want to be|let me be|play as|i play as|i will play as|i get to play as|i get to be|the player is|the player should be|player is|i should be|i become|transform me into|change me (?:in)?to|change the player (?:in)?to|replace the player with|swap the player (?:for|with)|make the player|my character is|my character should be|i control|you control|you play as|we play as|we are|make my character|my character|i want to play as|let me play as|the main character is|the hero is)\s+(.+)$/.exec(c);
    if (!m) return null;
    let rest = m[1].replace(/^(?:(?:in)?to|be|a|an|the|now|actually)\s+/g, '').replace(/^(?:a|an|the)\s+/, '');
    // pure modifications -> modify player
    const props = I.parseProps(rest, ctx);
    const np = I.parseNP(rest, quotes, ctx);
    const hasNoun = np && (np.key || (np.word && !L.adjectives[np.word] && !/^(?:faster|slower|bigger|smaller|stronger|weaker|invincible|invisible|immortal|tougher|taller|shorter|able|gone|dead|alive|happy|sad|cute)$/.test(np.word)));
    if (!hasNoun && props.length) return { kind: 'modify', target: { kind: 'player' }, changes: props, raw: c };
    if (!hasNoun) return null;
    if (np.entry && np.entry.role === 'tile') return null;
    return { kind: 'player', np, raw: c };
  }

  function removeIntent(c, ctx) {
    let m;
    if ((m = /^(?:stop|prevent|keep)\s+(?:the\s+)?(.+?)\s+from\s+(\w+)/.exec(c))) return { kind: 'unbehave', target: m[1], verb: m[2], raw: c };
    if ((m = /^(?:the\s+)?(.+?)\s+(?:should not|shouldn't|should no longer|do not|does not|cannot|can not|will not|must not|never|no longer)\s+(\w+(?: \w+)?)/.exec(c)) && !/^(?:i|we|you)$/.test(m[1])) return { kind: 'unbehave', target: m[1], verb: m[2], raw: c };
    if ((m = /^(?:i|we|you|the player)\s+(?:should not|shouldn't|do not|cannot|can not|should no longer|no longer)\s+(?:be able to\s+)?(\w+(?: \w+)?)/.exec(c))) return { kind: 'removeAbility', verb: m[1], raw: c };
    if (!(m = /^(?:remove|delete|get rid of|eliminate|erase|take out|take away|ditch|nuke|lose|disable|turn off|switch off|deactivate|no more|without|do not want|i do not want|i hate|kill off|banish|axe|drop|scrap|cut|clear out|clear)\s+(.+)$/.exec(c)) && !(m = /^no\s+(.+)$/.exec(c))) return null;
    let t = m[1].replace(/\s+(?:please|anymore|any more|from the game|from the level|from the map|completely|entirely|for now|altogether)$/g, '').trim();
    t = t.replace(/^(?:all (?:of )?(?:the |my )?|the |my |every |those |these |that |this |any |some )+/, '');
    if (/^(?:everything|it all|all of it|all|the whole thing|the whole game|every single thing)$/.test(t)) return { kind: 'reset', raw: c };
    if (/^(?:bugs?|the bugs?)$/.test(t)) return { kind: 'fix', text: c };
    if (/^(?:rules|all rules|the rules|game rules)$/.test(t)) return { kind: 'clearRules', raw: c };
    if (/^(?:mods?|my mod|the mod|custom code)$/.test(t)) return { kind: 'clearMods', raw: c };
    if (/^(?:double ?jump|the double ?jump|wall ?jump)$/.test(t)) return { kind: 'removeAbility', verb: t.replace(/\s/g, ''), raw: c };
    if (/^(?:shooting|guns?|weapons?|the gun|my gun|ability to shoot|dash|dashing|the dash|shield|the shield|jetpack|flying|bombs|the sword|sword|melee|teleport|blink|bullet time|magnet|regen|the tail|tail|jumping|jump)$/.test(t)) return { kind: 'removeAbility', verb: t, raw: c };
    if (/^(?:the )?(?:title|name)$/.test(t)) return { kind: 'title', title: '', raw: c };
    if (/^(?:me|the player|player|myself)$/.test(t)) return { kind: 'removePlayer', raw: c };
    if (/^(?:time limit|timer|the timer|countdown|clock)$/.test(t)) return { kind: 'hud', timer: 0, raw: c };
    if (/^(?:the )?(?:win condition|goal|objective|way to win|ending|winning)$/.test(t)) return { kind: 'removeGoal', raw: c };
    const tgt = I.resolveTarget(t, ctx);
    if (tgt && (tgt.kind === 'types' || tgt.kind === 'role')) return { kind: 'remove', target: tgt, raw: c };
    return { kind: 'removeFeature', what: t, raw: c };
  }

  function titleIntent(c, quotes) {
    let m;
    if ((m = /^(?:call|name|title|rename|retitle)\s+(?:it|the game|this game|this|my game|the project|our game|the thing)?\s*(?:to\s+|as\s+)?(.+)$/.exec(c)) || (m = /^(?:the (?:game|title|name) (?:is|should be)(?: called)?|(?:it|the game|this) (?:is|should be) called|the title (?:is|should be)|title:?|name:?)\s+(.+)$/.exec(c))) {
      const q = quoteOf(m[1], quotes);
      let title = q || m[1].replace(/\s*qq\d+\s*/g, '').trim();
      if (!title) return null;
      if (!q) title = U.titleCase(title);
      return { kind: 'title', title: title.slice(0, 48) };
    }
    if (/^(?:give it|add|make up|come up with|generate|think of|pick) (?:a |an )?(?:cool |good |fun |better |new )?(?:title|name)\b/.test(c)) return { kind: 'title', auto: true };
    if (/^(?:add )?(?:a )?title (?:screen|card)\b/.test(c)) return { kind: 'title', auto: true };
    return null;
  }

  function metaIntent(c) {
    if (/\b(?:surprise me|something (?:cool|fun|random|weird|crazy|interesting|unexpected|creative|wild|new|neat|silly|funny|awesome)|do (?:your|whatever you) (?:thing|want|like)|you decide|your choice|anything you want|random feature|go crazy|go wild|chaos|be creative|add (?:something|a twist|a surprise)|i am bored|this is boring|it is boring|plot twist|twist|shake (?:it|things) up|spice (?:it|things) up|mix it up|make it weird|make it weirder|make it crazier|make it crazy|make it wild|make it wilder|make it chaotic|make it funny|make it funnier|make it silly|dealer's choice|wildcard|wild card|random)\b/.test(c)) return { kind: 'surprise' };
    if (/^(?:make it|make the game|make this)?\s*(?:better|good|great|more fun|fun|funner|more interesting|interesting|more exciting|exciting|cooler|cool|epic|more epic|awesome|amazing|even better)$/.test(c) || /\b(?:improve (?:it|the game|this|things)|what (?:else )?should (?:i|we) add|what is missing|make it more fun|level it up|next step|keep going|continue|go on|more|do more|add more stuff|add more|add more things|more stuff|more features|add features|add content|more content|finish (?:it|the game)|make it a real game|make it playable|make it complete)\b/.test(c)) return { kind: 'improve' };
    if (/\b(?:juic(?:e|y|ier)|game ?feel|more satisfying|satisfying|feel better|more impact|impactful|punchy|punchier|crunchy|crunchier|polish the feel|more feedback|feel good|feels good|more particles|particles)\b/.test(c)) return { kind: 'juice' };
    if (/\b(?:prettier|beautiful|look better|looks better|better looking|nicer looking|look nicer|more polished|polish|gorgeous|stunning|aesthetic|make it pretty|graphics better|better graphics|improve the (?:visuals|graphics|look)|look good|looks good|look amazing|eye candy|visual polish|more vibrant|make it pop)\b/.test(c)) return { kind: 'polish' };
    if (/\b(?:harder|more difficult|more challenging|too easy|brutal|impossible|insane|nightmare mode|hard mode|hardcore|souls ?like|dark souls|very hard|super hard|extreme mode|challenge me)\b/.test(c) && !/\bharder to kill\b/.test(c)) return { kind: 'difficulty', dir: 1, extreme: /\b(?:impossible|insane|nightmare|brutal|souls|extreme|super hard|very hard|hardcore)\b/.test(c) };
    if (/\b(?:easier|less difficult|simpler|easy mode|too hard|too difficult|baby mode|casual|forgiving|more forgiving|i keep dying|i keep losing|i cannot win|it is impossible|too tough)\b/.test(c) && !/\beasier to kill\b/.test(c)) return { kind: 'difficulty', dir: -1, extreme: /\b(?:baby|too hard|impossible)\b/.test(c) };
    if (/\b(?:add|make|give it|need|want|create|implement)\s+(?:a |an |some )?(?:goal|win condition|way to win|objective|ending|reason to play|purpose|point to the game|victory condition|finish line|end goal|quest|mission|level goal)\b/.test(c)) return { kind: 'goal' };
    if (/\b(?:add|make|create|give it|i want|need)\s+(?:more |multiple |new |extra )?levels\b|\bmultiple levels\b|\blevel progression\b/.test(c)) return { kind: 'goal', levels: true };
    if (/\b(?:recursion|vibecode in (?:the|my) game|game inside (?:the|a) game|meta|the game makes itself|prompt inside the game|ai inside the game|a computer that makes games|yourself in the game|put you in the game|add vibe|add yourself|add claude|add an ai)\b/.test(c)) return { kind: 'recursion' };
    if (/\b(?:emoji|emojis)\b/.test(c) && /\b(?:no|without|remove|stop|disable|abstract|shapes)\b/.test(c) || /\b(?:abstract|geometric|minimalist|minimal|shapes only|simple shapes|flat shapes)\b/.test(c) && /\b(?:style|look|graphics|art|make it|everything)\b/.test(c)) return { kind: 'style', style: 'shapes' };
    if (/\b(?:use|bring back|add|with) emojis?\b|\bemoji style\b/.test(c)) return { kind: 'style', style: 'emoji' };
    return null;
  }

  function genreIntent(c, ctx, quotes) {
    const g = L.findGenre(c);
    if (!g) return null;
    if (g === 'topdown' && !/\b(?:make it|turn it into|switch to|change to|top ?down (?:game|view|camera|perspective|shooter|adventure|rpg|mode)|go top ?down|make it top ?down|from above|overhead)\b/.test(c)) return null;
    if (g === 'maze' && /\b(?:add|put|make)\s+(?:a\s+)?maze\b/.test(c) && !/\b(?:game|like)\b/.test(c)) return null;
    if (g === 'survival' && /\bsurvive (?:for )?\d+/.test(c)) return null;
    const out = { kind: 'genre', genre: g, raw: c, extras: [] };
    // trailing clauses: "a platformer with coins and slimes", "in space", "set in a haunted house"
    const w = / (?:with|featuring|that has|that have|containing|including|full of|filled with) (.+)$/.exec(c);
    if (w) out.extras.push(...I.parseNPList(w[1], quotes, ctx).map((np) => ({ kind: 'add', nps: [np], raw: w[1] })));
    const th = L.findTheme(c);
    if (th && !(g === 'defense' && /\b(?:castle|base|tower|house|village|kingdom)\b/.test(c) && th === 'fantasy')) out.extras.push({ kind: 'theme', theme: th, raw: c });
    if (g === 'defense') {
      const d = /\b(?:defend|protect|guard|save)\s+(?:the |my |a |our )?([a-z]+)/.exec(c);
      if (d && L.findNoun(d[1])) { const np = I.parseNP(d[1], quotes, ctx); np.defend = true; np.count = 1; out.defendNP = np; }
      const f = /\bfrom\s+(.+)$/.exec(c);
      if (f) out.extras.push({ kind: 'add', nps: I.parseNPList(f[1], quotes, ctx).map((np) => Object.assign(np, { forceRole: 'enemy' })), raw: f[1] });
    }
    return out;
  }

  function themeIntent(c) {
    const th = L.findTheme(c);
    if (!th) return null;
    if (!/\b(?:set in|takes? place|theme|themed|setting|in (?:the |a |an )?|make it|turn it into|move (?:it|the game) to|go to|change (?:the )?(?:setting|world|location|scene) to|world|world to|look like|feel like|vibe|vibes|style|aesthetic|-y\b)\b/.test(c) && !/^(?:a |an |the )?(?:\w+ )?(?:\w+ )?$/.test(c)) return null;
    return { kind: 'theme', theme: th, raw: c };
  }

  function sayIntent(c, ctx, quotes) {
    const m = /^(?:make |have |let )?(?:the |a |an )?([\w ]+?)\s+(?:says?|say|saying|tell me|tells me|tells|talks?|speaks?|greets? me(?: with)?|yells?|shouts?|whispers?|asks?)\s*(?:that\s+)?(.*)$/.exec(c);
    if (!m) return null;
    if (isPlayerWord(m[1])) return null;
    const t = I.resolveTarget(m[1], ctx);
    const text = quoteOf(m[2], quotes) || (m[2] ? m[2].replace(/\s*qq\d+\s*/g, '').trim() : '');
    if (t && (t.kind === 'types' || t.kind === 'role')) return { kind: 'say', names: t.names, text: text || null, raw: c };
    if (t && t.kind === 'missing') return { kind: 'say', np: t.np, text: text || null, raw: c };
    return null;
  }

  function modifyIntent(c, ctx, quotes) {
    let m;
    // "double/triple/halve the X"
    if ((m = /^(?:double|triple|quadruple|halve|half)\s+(?:the\s+)?(?:number of\s+|amount of\s+|count of\s+)?(.+)$/.exec(c))) {
      const t = I.resolveTarget(m[1], ctx);
      const mul = /^double/.test(c) ? 2 : /^triple/.test(c) ? 3 : /^quadruple/.test(c) ? 4 : 0.5;
      if (t && t.kind !== 'missing') return { kind: 'modify', target: t, changes: [/size|speed|health|hp|damage|points|gravity/.test(m[1]) ? { prop: /size/.test(m[1]) ? 'size' : /speed/.test(m[1]) ? 'speed' : /points/.test(m[1]) ? 'points' : /damage/.test(m[1]) ? 'damage' : 'hp', mul } : { prop: 'count', mul }], raw: c };
    }
    // "increase/decrease X"
    if ((m = /^(?:increase|raise|boost|up|bump up|crank up|turn up|max out|decrease|reduce|lower|cut|turn down|nerf|buff)\s+(?:the\s+)?(.+?)(?:\s+(?:of|for)\s+(?:the\s+)?(.+?))?(?:\s+(?:by|to)\s+(.+))?$/.exec(c))) {
      const up = /^(?:increase|raise|boost|up|bump up|crank up|turn up|max out|buff)/.test(c);
      const what = m[1], of = m[2];
      const by = m[3] ? numberIn(m[3]) : null;
      const propMap = [[/speed|pace|velocity/, 'speed'], [/size|scale/, 'size'], [/health|hp|hit points|toughness/, 'hp'], [/damage|attack|power/, 'damage'], [/count|number|amount|spawn|population/, 'count'], [/points|score|value/, 'points'], [/fire rate|rate of fire|shooting speed|firing speed/, 'fireRate'], [/jump/, 'jump'], [/gravity/, 'gravity']];
      let prop = null;
      for (const [re, p] of propMap) if (re.test(what)) { prop = p; break; }
      if (/^(?:nerf|buff)/.test(c) && !prop) { const t = I.resolveTarget(what, ctx); if (t) return { kind: 'modify', target: t, changes: [{ prop: 'hp', mul: up ? 1.6 : 0.6 }, { prop: 'speed', mul: up ? 1.2 : 0.8 }], raw: c }; }
      const tgtText = of || what.replace(/\b(?:speed|size|health|hp|damage|count|number|amount|points|score|fire rate|jump(?: height| power)?|gravity)\b/, '').replace(/'s?\b/, '').trim();
      if (prop === 'gravity') return { kind: 'world', prop: 'gravity', g: by != null ? { set: by } : { mul: up ? 1.6 : 0.5 }, raw: c };
      const t = tgtText ? I.resolveTarget(tgtText, ctx) : prop === 'jump' || prop === 'fireRate' ? { kind: 'player' } : ctx.focus && ctx.focus.length ? { kind: 'types', names: ctx.focus } : { kind: 'player' };
      if (prop && t) return { kind: 'modify', target: t, changes: [by != null && m[3] && /^to\b/.test(m[3].trim()) || (m[3] && !/%/.test(m[3]) && /\bto\b/.test(c)) ? { prop, set: by } : { prop, mul: by != null ? (/%/.test(m[3] || '') ? 1 + (up ? by : -by) / 100 : (up ? (by > 10 ? 1 : by) : 1 / (by > 10 ? 1 : by))) : up ? 1.5 : 0.65 }], raw: c };
    }
    // "set X to Y"
    if ((m = /^set\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/.exec(c))) {
      const lhs = m[1], rhs = m[2];
      const n = numberIn(rhs);
      if (/gravity/.test(lhs)) return { kind: 'world', prop: 'gravity', g: n != null ? { set: n } : { set: 1500 }, raw: c };
      const pm = /(speed|size|health|hp|damage|count|number|points|lives)\b/.exec(lhs);
      const tt = lhs.replace(/'s?\b/g, '').replace(/\b(?:speed|size|health|hp|damage|count|number of|number|points|lives|of|the)\b/g, '').trim();
      const t = tt ? I.resolveTarget(tt, ctx) : { kind: 'player' };
      if (pm && n != null && t) { const p = { health: 'hp', number: 'count' }[pm[1]] || pm[1]; return { kind: 'modify', target: t, changes: [{ prop: p, set: n }], raw: c }; }
      if (t) { const props = I.parseProps(rhs, ctx); if (props.length) return { kind: 'modify', target: t, changes: props, raw: c }; }
    }
    // "turn the zombies into chickens" / "replace X with Y" / "change X to Y"
    if ((m = /^(?:turn|transform|change|morph|convert|make)\s+(?:all\s+)?(?:the\s+|my\s+)?(.+?)\s+(?:in)?to\s+(?:a |an |the )?(.+)$/.exec(c)) || (m = /^(?:replace|swap)\s+(?:all\s+)?(?:the\s+)?(.+?)\s+(?:with|for)\s+(?:a |an |the )?(.+)$/.exec(c))) {
      const t = I.resolveTarget(m[1], ctx);
      if (t && t.kind === 'player') {
        const np = I.parseNP(m[2], quotes, ctx);
        if (np && (np.key || np.word)) return { kind: 'player', np, raw: c };
      }
      if (t && (t.kind === 'types' || t.kind === 'role') && t.names && t.names.length) {
        const props = I.parseProps(m[2], ctx);
        const np = I.parseNP(m[2], quotes, ctx);
        const nounish = np && (np.key || (np.word && !props.length));
        if (nounish) return { kind: 'rename', names: t.names, np, raw: c };
        if (props.length) return { kind: 'modify', target: t, changes: props, raw: c };
      }
      if (t && (t.kind === 'global')) { const pi = paletteIntent('make everything ' + m[2]); if (pi) return pi; }
    }
    // "make X Y"
    if ((m = /^(?:make|let|have|set|turn|get|keep|render|paint|colou?r)\s+(.+)$/.exec(c))) {
      const body = m[1];
      const words = body.split(/\s+/);
      for (let i = Math.min(words.length - 1, 5); i >= 1; i--) {
        const tText = words.slice(0, i).join(' ');
        const pText = words.slice(i).join(' ');
        const t = I.resolveTarget(tText, ctx);
        if (!t || t.kind === 'missing') continue;
        const props = I.parseProps(pText, ctx);
        const vp = I.parseVP(pText, quotes, ctx);
        const hasVP = vp.b.length || vp.fx.length || vp.explosive || vp.multiply || vp.split || vp.hostile || vp.friend || vp.talk || vp.collect || vp.fly || vp.drops || vp.spawns;
        if (props.length || hasVP) return { kind: 'modify', target: t, changes: props, vp: hasVP ? vp : null, raw: c };
      }
    }
    // "X should/must/needs to be Y" / "X should chase me"
    if ((m = /^(?:the\s+|all\s+(?:the\s+)?|my\s+)?(.+?)\s+(?:should|must|need to|needs to|has to|have to|ought to|could|will|would|can|shall)\s+(?:all\s+)?(?:be\s+|become\s+|get\s+|look\s+)?(.+)$/.exec(c))) {
      const t = I.resolveTarget(m[1], ctx);
      if (t && t.kind !== 'missing') {
        const props = I.parseProps(m[2], ctx);
        const vp = I.parseVP(m[2], quotes, ctx);
        const hasVP = vp.b.length || vp.fx.length || vp.explosive || vp.multiply || vp.split || vp.hostile || vp.friend || vp.talk || vp.collect || vp.fly || vp.drops || vp.spawns;
        if (props.length || hasVP) return { kind: 'modify', target: t, changes: props, vp: hasVP ? vp : null, raw: c };
      }
      if (t && t.kind === 'missing') return { kind: 'add', nps: [Object.assign(t.np, { vp: I.parseVP(m[2], quotes, ctx) })], raw: c };
    }
    // "X are/is too Y"
    if ((m = /^(?:the\s+|my\s+|all\s+(?:the\s+)?)?(.+?)\s+(?:are|is|look|looks|seem|seems|feel|feels|move|moves|go|goes|run|runs|get|gets|keep|keeps)\s+(.+)$/.exec(c)) && !/^(?:there|it|this|that)$/.test(m[1])) {
      const t = I.resolveTarget(m[1], ctx);
      if (t && t.kind !== 'missing') {
        const props = I.parseProps(m[2], ctx);
        const vp = I.parseVP(m[2], quotes, ctx);
        const hasVP = vp.b.length || vp.fx.length || vp.explosive || vp.multiply || vp.split || vp.hostile || vp.friend || vp.collect || vp.fly;
        if (props.length || hasVP) return { kind: 'modify', target: t, changes: props, vp: hasVP ? vp : null, raw: c, complaint: /\btoo\b/.test(m[2]) };
      }
      if (t && t.kind === 'missing' && /\b(?:dangerous|evil|bad|enemies|hostile|deadly|friendly|nice|good|collectible|worth|points|valuable)\b/.test(m[2])) {
        return { kind: 'learn', np: t.np, changes: I.parseProps(m[2], ctx), raw: c };
      }
    }
    // "it is too dark/hard/slow" handled with pronoun 'it' / game
    if ((m = /^(?:it|this|that|the game|everything)\s+(?:is|feels|looks|seems)\s+(.+)$/.exec(c))) {
      const props = I.parseProps(m[1], ctx);
      if (props.length) return { kind: 'modify', target: ctx.focus && ctx.focus.length && !/\bhard|easy|dark|bright|loud|boring|slow|fast\b/.test(m[1]) ? { kind: 'types', names: ctx.focus } : { kind: 'global' }, changes: props, raw: c, complaint: /\btoo\b/.test(m[1]) };
    }
    // "faster zombies", "more coins", "bigger explosions"
    if ((m = /^(?:much |way |even |a bit |slightly |a lot )?(faster|slower|bigger|larger|smaller|stronger|weaker|tougher|more|fewer|less|deadlier|smarter|dumber|angrier|cuter|scarier|louder|quieter|brighter|darker|higher|lower)\s+(.+)$/.exec(c))) {
      const t = I.resolveTarget(m[2], ctx);
      if (/explosions?/.test(m[2])) return { kind: 'explosions', mul: /bigger|larger|more|stronger/.test(m[1]) ? 1.6 : 0.6, raw: c };
      if (/^(?:jumps?|jumping)$/.test(m[2])) return { kind: 'modify', target: { kind: 'player' }, changes: [{ prop: 'jump', mul: /higher|bigger|more/.test(m[1]) ? 1.3 : 0.78 }], raw: c };
      if (t && t.kind !== 'missing') {
        const props = I.parseProps(m[1] === 'more' || m[1] === 'fewer' || m[1] === 'less' ? m[1] + ' of them' : m[0], ctx);
        if (props.length) return { kind: 'modify', target: t, changes: props, raw: c };
      }
      if (t && t.kind === 'missing' && /^(?:more|lots more)$/.test(m[1])) return null; // let 'add' handle
    }
    return null;
  }

  function addIntent(c, ctx, quotes) {
    let m;
    if ((m = /^(?:add|create|spawn|put|place|insert|include|generate|build|summon|bring in|bring|introduce|throw in|drop in|drop|make|give me|i want|i need|i would like|there should be|there are|there is|there will be|we need|have|get|implement|write|code|design|draw|plant|scatter|sprinkle|fill (?:the (?:level|world|map|screen|game) )?with|populate (?:the |it )?(?:level |world |map )?with|let there be|release|unleash|send in|send|i wish there (?:were|was)|can we have|can i have|could we have|could i have|we want|i would love|make some|add some|lots of|tons of|give us|install|deploy|introduce|import|insert)\s+(.+)$/.exec(c))) {
      let rest = m[1].replace(/\s+(?:to|into|in) (?:the|my) (?:game|level|world|map|scene)$/, '').replace(/^(?:a game|game) (?:with|about|where)\s+/, '');
      if (/^(?:a |an |the )?(?:game|thing|something)$/.test(rest)) return null;
      const nps = I.parseNPList(rest, quotes, ctx);
      if (nps.length) return { kind: 'add', nps, raw: c };
    }
    // bare NP ("5 zombies", "a dragon that breathes fire")
    if (/^(?:\d+|a|an|some|lots|tons|many|several|few|more|giant|tiny|big|small|huge|an army|a horde|a swarm|hordes|swarms)\b/.test(c) || L.findNoun(c.split(/\s+/)[0]) || (c.split(/\s+/).length <= 4 && c.split(/\s+/).some((w) => L.findNoun(w)))) {
      const nps = I.parseNPList(c, quotes, ctx);
      if (nps.length && nps.every((np) => np.key || (np.word && np.word.length > 2))) return { kind: 'add', nps, raw: c, bare: true };
    }
    return null;
  }

  // "through a dark forest", "in a haunted house", "set in space" -> theme (+ mood effects), stripped from the clause
  function settingPhrase(c) {
    const m = /\s*,?\s*\b(?:in|through|inside|across|within|around|set in|on|at|under|beneath|deep in|lost in|trapped in|stuck in)\s+(?:a |an |the |outer |deep )?((?:(?:dark|spooky|haunted|creepy|abandoned|neon|frozen|burning|enchanted|sunny|misty|foggy|rainy|snowy|stormy|ancient|cursed|mysterious|lonely|eerie|gloomy|magical|underground|sunken|alien|post-apocalyptic|futuristic)\s+){0,2})([a-z][a-z' -]{2,40}?)(?=$|,|\s+(?:and|while|where|with|that|who|when|but)\b)/.exec(c);
    if (!m) return null;
    const place = (m[2] || '').trim();
    const theme = L.findTheme(place) || L.findTheme((m[1] || '') + place);
    if (!theme) return null;
    const mood = m[1] || '';
    const fx = [];
    if (/dark|spooky|haunted|creepy|gloomy|eerie|cursed/.test(mood)) fx.push('darkness');
    if (/misty|foggy/.test(mood)) fx.push('fog');
    if (/rainy|stormy/.test(mood)) fx.push(/stormy/.test(mood) ? 'storm' : 'rain');
    if (/snowy|frozen/.test(mood)) fx.push('snow');
    return { theme, fx, rest: (c.slice(0, m.index) + c.slice(m.index + m[0].length)).trim() };
  }
  I.settingPhrase = settingPhrase;

  I.parseClause = function (raw, ctx, quotes) {
    let c = stripFiller(raw);
    if (!c) return [];
    c = c.replace(/[,.!?]+$/, '').trim();
    const out = [];
    const push = (x) => { if (Array.isArray(x)) out.push(...x); else if (x) out.push(x); return out; };
    const sp = /^(?:make|turn|set|change|move|put)\b/.test(c) && /\b(?:theme|themed|setting)\b/.test(c) ? null : settingPhrase(c);
    if (sp && sp.rest && sp.rest.split(/\s+/).length >= 1 && !/^(?:it|the game|everything)$/.test(sp.rest)) {
      out.push({ kind: 'theme', theme: sp.theme, raw: c });
      if (sp.fx.length) out.push({ kind: 'env', add: sp.fx, remove: [], raw: c });
      c = sp.rest;
      if (!c) return out;
    }
    const ADD_RE = /^(?:add|create|spawn|put|place|insert|include|summon|bring in|bring|introduce|throw in|drop in|scatter|sprinkle|there should be|there are|there is|i want|i need|let there be|release|unleash|send in|populate|fill)\b/;
    const relWhen = ADD_RE.test(c) && /\b(?:that|which|who)\b.*\bwhen (?:it|they|he|she) (?:die|dies|is killed|are killed|gets? killed|explodes?|gets? hit)\b/.test(c);
    // conditional rules
    if (!relWhen && /\b(?:when|whenever|if|every time|each time|once|as soon as|anytime|upon)\b|^(?:every|after|at)\s+(?:\d|second|minute|few|couple|the (?:start|beginning))|\s(?:every|after) \d|\bevery (?:second|minute|few seconds)\b|\bat \d+ points\b/.test(c)) {
      const r = I.parseRule(c, ctx, quotes);
      if (r && (r.actions.length || r.unparsed.length)) return push(r);
      // "explode when they die" style is behavior modification -> handled below
    }
    let x;
    if ((x = titleIntent(c, quotes))) return push(x);
    if ((x = metaIntent(c))) return push(x);
    if ((x = hudIntent(c, ctx))) return push(x);
    if ((x = removeIntent(c, ctx))) {
      if (x.kind === 'removeFeature') {
        const env = envIntent(c, ctx); if (env) return push(env);
        const mu = musicIntent(c); if (mu) return push(mu);
        const lv = levelIntent(c, ctx); if (lv) return push(lv);
        const wd = worldIntent(c, ctx); if (wd.length) return push(wd);
        const bg = bgIntent(c); if (bg) return push(bg);
      }
      return push(x);
    }
    if ((x = playerIntent(c, ctx, quotes))) {
      push(x);
      if (x.np && x.np.vp) {
        // "I'm a cat collecting fish"
      }
      return out;
    }
    if ((x = abilityIntent(c, ctx, quotes))) return push(x);
    if (/\b(?:level|map|layout|stage|terrain|arena)\b/.test(c) && !/\b(?:game|genre)\b/.test(c) && (x = levelIntent(c, ctx))) return push(x);
    if ((x = genreIntent(c, ctx, quotes))) return push(x);
    if ((x = musicIntent(c))) return push(x);
    const wd = worldIntent(c, ctx);
    if (wd.length && !/\b(?:zombies?|enemies|coins?)\b/.test(c)) return push(wd);
    if ((x = bgIntent(c))) return push(x);
    if ((x = envIntent(c, ctx)) && !/^(?:add|spawn|create|put|place)\s+(?:\d+|a|an|some)\s+(?!rain|snow|fog)/.test(c)) return push(x);
    if ((x = levelIntent(c, ctx))) return push(x);
    if ((x = paletteIntent(c))) return push(x);
    if ((x = themeIntent(c))) return push(x);
    if (ADD_RE.test(c) && (x = addIntent(c, ctx, quotes))) return push(x);
    if ((x = sayIntent(c, ctx, quotes))) return push(x);
    if ((x = modifyIntent(c, ctx, quotes))) return push(x);
    if (wd.length) return push(wd);
    // behavior statement: "zombies chase me"
    const bm = /^(?:the\s+|all\s+(?:the\s+)?|my\s+)?([\w ]+?)\s+((?:chase|chases|follow|follows|hunt|hunts|attack|attacks|shoot|shoots|fire|fires|throw|throws|fly|flies|jump|jumps|hop|hops|run away|runs away|flee|flee|explode|explodes|teleport|teleports|multiply|multiplies|split|splits|spin|spins|dance|dances|sing|sings|patrol|patrols|wander|wanders|orbit|orbits|circle|circles|guard|guards|protect|protects|eat|eats|steal|steals|drop|drops|spawn|spawns|heal|heals|bounce|bounces|bite|bites|hurt|hurts|give|gives|glow|glows|float|floats|swim|swims|breathe|breathes|spit|spits|lay|lays|summon|summons|help|helps|fight|fights|avoid|avoids|hide|hides|copy|copies|mimic|mimics|charge|charges|swarm|swarms|fall|falls|roll|rolls|sleep|sleeps|grow|grows|zigzag|zigzags|roam|roams|freeze|freezes|push|pushes|burn|burns|zap|zaps|kill|kills)\b.*)$/.exec(c);
    if (bm) {
      const t = I.resolveTarget(bm[1], ctx);
      if (t && t.kind !== 'missing' && t.kind !== 'feature') return push({ kind: 'modify', target: t, changes: [], vp: I.parseVP(bm[2], quotes, ctx), raw: c });
      if (t && t.kind === 'missing') { const np = t.np; np.vp = I.parseVP(bm[2], quotes, ctx); return push({ kind: 'add', nps: [np], raw: c }); }
    }
    if ((x = addIntent(c, ctx, quotes))) return push(x);
    // last chance: creative nouns
    const words = c.split(/\s+/).filter((w) => !L.stopwords.has(w) && !IGNORE.has(w) && w.length > 2 && !VERBISH.test(w) && !/^\d+$/.test(w));
    const nouns = words.filter((w) => L.findNoun(w) || L.glyphFor(w));
    if (nouns.length) {
      const nps = I.parseNPList(nouns.join(' and '), quotes, ctx);
      if (nps.length) return push({ kind: 'add', nps, raw: c, guessed: true });
    }
    return push({ kind: 'unknown', text: c, words });
  };

  // ---------------------------------------------------------------------------
  // top level
  // ---------------------------------------------------------------------------
  I.parse = function (raw, ctx) {
    const { text, quotes } = I.normalize(raw);
    const res = { raw, text, quotes, intents: [], polite: /\b(?:please|thanks|thank you|thank|cheers)\b/.test(text), length: raw.length };
    if (!text) return res;
    const meta = I.meta(text);
    if (meta) { res.intents.push(meta); return res; }
    const q = I.question(text);
    if (q) { res.intents.push(q); return res; }
    for (const s of sentences(text)) {
      const m2 = I.meta(s);
      if (m2 && (m2.kind === 'undo' || m2.kind === 'fix' || m2.kind === 'reset')) { res.intents.push(m2); continue; }
      if (m2 && m2.kind === 'chat' && sentences(text).length > 1) continue;
      for (const c of clauses(s)) {
        const its = I.parseClause(c, ctx, quotes);
        // follow-ups inside NPs (e.g. "a cat collecting fish")
        for (const it of its) {
          res.intents.push(it);
          const nps = it.nps || (it.np ? [it.np] : []);
          for (const np of nps) for (const f of participles(np, ctx, quotes)) res.intents.push(f);
          // update focus for pronouns in later clauses
          if (it.kind === 'add' && it.nps) ctx.focus = it.nps.map((np) => U.ident(np.key || np.word || 'thing'));
          if (it.kind === 'modify' && it.target && it.target.names) ctx.focus = it.target.names;
        }
      }
    }
    return res;
  };

  // gerund follow-ups: "a cat collecting fish and dodging dogs"
  function participles(np, ctx, quotes) {
    const out = [];
    const raw = np.partTail || '';
    if (!raw) return out;
    const re = /\b(collecting|gathering|eating|grabbing|picking up|hunting for|looking for|searching for|finding|fighting|shooting|killing|battling|slaying|defeating|blasting|smashing|dodging|avoiding|escaping|running from|fleeing|surviving|evading|outrunning|rescuing|saving|protecting|defending|exploring|racing|riding|delivering|chasing)\s+(.+?)(?=\s+(?:and|while|but|then|,)\s+(?:collecting|gathering|eating|grabbing|picking|hunting|looking|searching|finding|fighting|shooting|killing|battling|slaying|defeating|blasting|smashing|dodging|avoiding|escaping|running|fleeing|surviving|evading|outrunning|rescuing|saving|protecting|defending|exploring|racing|riding|delivering|chasing)|$)/g;
    let m;
    while ((m = re.exec(raw))) {
      const verb = m[1], obj = m[2].replace(/^(?:all the|the|some|lots of|a lot of)\s+/, '');
      const nps = I.parseNPList(obj, quotes, ctx);
      if (!nps.length) continue;
      if (/collect|gather|eat|grab|pick|hunting for|looking for|searching|finding|deliver/.test(verb)) nps.forEach((n) => { n.forceRole = 'collectible'; });
      else if (/fight|kill|battl|slay|defeat|blast|smash|shooting/.test(verb)) { nps.forEach((n) => { n.forceRole = 'enemy'; }); out.push({ kind: 'ability', list: [{ name: /shoot|blast/.test(verb) ? 'shoot' : 'melee', params: {} }], raw: verb, implied: true }); }
      else if (/dodg|avoid|escap|running from|flee|surviv|evad|outrun|chasing/.test(verb)) nps.forEach((n) => { n.forceRole = /chasing/.test(verb) ? 'critter' : 'enemy'; if (/chasing/.test(verb)) n.forceFlee = true; });
      else if (/rescu|sav/.test(verb)) nps.forEach((n) => { n.forceRole = 'collectible'; n.rescue = true; });
      else if (/protect|defend/.test(verb)) nps.forEach((n) => { n.forceRole = 'structure'; n.defend = true; });
      else if (/explor/.test(verb)) { const lv = levelIntent('make it a ' + obj, ctx); if (lv) { out.push(lv); continue; } const th = themeIntent('set in ' + obj); if (th) { out.push(th); continue; } }
      else if (/racing|riding/.test(verb)) { /* skip */ }
      out.push({ kind: 'add', nps, raw: m[0], implied: true });
    }
    return out;
  }

  VC.Interp = I;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
