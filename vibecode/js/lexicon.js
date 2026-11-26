/* VibeCode — lexicon: the vocabulary of the local interpreter. */
(function (VC) {
  'use strict';
  const U = VC.U;
  const L = {};

  // ---------------------------------------------------------------------------
  // Nouns. [glyph, role, props]
  // roles: enemy, boss, collectible, hazard, obstacle, npc, pet, structure, vehicle, critter
  // props: s size, v speed, hp, b behaviors, fly, proj, pts, fx, c color, shape, ghost, static, t themes
  // ---------------------------------------------------------------------------
  const N = {
    // --- hostile creatures
    zombie: ['🧟', 'enemy', { v: 70, hp: 3, b: ['chase'], c: '#86b064', t: ['spooky', 'city'] }],
    skeleton: ['💀', 'enemy', { v: 90, hp: 2, b: ['chase'], c: '#e8e2d0', t: ['dungeon', 'spooky'] }],
    ghost: ['👻', 'enemy', { v: 80, hp: 2, b: ['chase', 'wave'], fly: true, ghost: true, c: '#e9ecf5', t: ['spooky'] }],
    slime: [null, 'enemy', { v: 60, hp: 2, b: ['hop'], shape: 'blob', c: '#7ccf6b', t: ['dungeon', 'fantasy'] }],
    goblin: ['👺', 'enemy', { v: 120, hp: 2, b: ['chase'], c: '#d4573f', t: ['fantasy', 'dungeon'] }],
    orc: ['👹', 'enemy', { v: 85, hp: 5, s: 36, b: ['chase'], c: '#b9493b', t: ['fantasy'] }],
    troll: ['🧌', 'enemy', { v: 55, hp: 9, s: 44, b: ['chase'], c: '#8a9a5b', t: ['fantasy'] }],
    demon: ['😈', 'enemy', { v: 100, hp: 4, b: ['chase', 'shoot'], proj: 'fireball', c: '#b33a6b', t: ['hell'] }],
    devil: ['😈', 'enemy', { v: 100, hp: 4, b: ['chase', 'shoot'], proj: 'fireball', c: '#c43b3b', t: ['hell'] }],
    imp: ['👿', 'enemy', { v: 140, hp: 1, s: 22, fly: true, b: ['chase', 'zigzag'], c: '#a24bd1', t: ['hell'] }],
    alien: ['👾', 'enemy', { v: 90, hp: 2, b: ['wander', 'shoot'], proj: 'laser', c: '#b06cf0', t: ['space'] }],
    ufo: ['🛸', 'enemy', { v: 110, hp: 3, fly: true, b: ['wander', 'shoot'], proj: 'laser', c: '#9ad1c9', t: ['space'] }],
    robot: ['🤖', 'enemy', { v: 70, hp: 4, b: ['patrol', 'shoot'], proj: 'laser', c: '#9aa7b4', t: ['city', 'space'] }],
    drone: [null, 'enemy', { v: 130, hp: 1, s: 22, fly: true, shape: 'diamond', b: ['chase', 'zigzag'], c: '#7fd0e6', t: ['city', 'space'] }],
    spider: ['🕷️', 'enemy', { v: 140, hp: 1, s: 24, b: ['chase'], c: '#4a4040', t: ['spooky', 'dungeon'] }],
    bat: ['🦇', 'enemy', { v: 120, hp: 1, s: 24, fly: true, b: ['chase', 'zigzag'], c: '#4b3d5a', t: ['spooky', 'dungeon'] }],
    snake: ['🐍', 'enemy', { v: 90, hp: 2, b: ['chase', 'zigzag'], c: '#6fae4f', t: ['jungle', 'desert'] }],
    shark: ['🦈', 'enemy', { v: 150, hp: 4, s: 40, b: ['chase'], c: '#7d93a8', t: ['ocean'] }],
    wolf: ['🐺', 'enemy', { v: 150, hp: 2, b: ['chase'], c: '#8c8f99', t: ['forest', 'snow'] }],
    bear: ['🐻', 'enemy', { v: 85, hp: 6, s: 40, b: ['chase'], c: '#8a5a3b', t: ['forest'] }],
    bee: ['🐝', 'enemy', { v: 140, hp: 1, s: 20, fly: true, b: ['chase', 'zigzag'], c: '#f2c94c', t: ['forest', 'farm'] }],
    wasp: ['🐝', 'enemy', { v: 170, hp: 1, s: 20, fly: true, b: ['chase', 'zigzag'], c: '#e8a33d' }],
    hornet: ['🐝', 'enemy', { v: 170, hp: 1, s: 22, fly: true, b: ['chase', 'zigzag'], c: '#e8a33d' }],
    scorpion: ['🦂', 'enemy', { v: 100, hp: 2, b: ['chase'], c: '#c48a3a', t: ['desert'] }],
    crab: ['🦀', 'enemy', { v: 80, hp: 2, b: ['patrol'], c: '#e06c4f', t: ['ocean', 'beach'] }],
    octopus: ['🐙', 'enemy', { v: 70, hp: 3, b: ['wander', 'shoot'], proj: 'ink', c: '#d4708a', t: ['ocean'] }],
    squid: ['🦑', 'enemy', { v: 90, hp: 2, b: ['wave', 'shoot'], proj: 'ink', c: '#e48a9a', t: ['ocean'] }],
    jellyfish: [null, 'enemy', { v: 40, hp: 1, shape: 'blob', fly: true, b: ['wave'], c: '#d9a5f0', t: ['ocean'] }],
    piranha: ['🐟', 'enemy', { v: 160, hp: 1, s: 22, b: ['chase'], c: '#d9534f', t: ['ocean', 'jungle'] }],
    dragon: ['🐉', 'boss', { v: 90, hp: 30, s: 86, fly: true, b: ['wander', 'shoot'], proj: 'fireball', c: '#d9553f', t: ['fantasy'] }],
    dinosaur: ['🦖', 'enemy', { v: 110, hp: 10, s: 56, b: ['chase'], c: '#6f9c4a', t: ['jungle'] }],
    trex: ['🦖', 'boss', { v: 120, hp: 25, s: 80, b: ['chase', 'charge'], c: '#6f9c4a', t: ['jungle'] }],
    raptor: ['🦖', 'enemy', { v: 170, hp: 2, s: 32, b: ['chase'], c: '#9cae4a' }],
    vampire: ['🧛', 'enemy', { v: 110, hp: 4, b: ['chase', 'warp'], c: '#7a2b3a', t: ['spooky'] }],
    witch: ['🧙‍♀️', 'enemy', { v: 90, hp: 3, fly: true, b: ['kite', 'shoot'], proj: 'magic', c: '#7a5bc4', t: ['spooky', 'fantasy'] }],
    ninja: ['🥷', 'enemy', { v: 170, hp: 2, b: ['chase', 'charge'], proj: 'shuriken', c: '#3d3d4a' }],
    pirate: ['🏴‍☠️', 'enemy', { v: 100, hp: 3, b: ['chase', 'shoot'], proj: 'cannonball', c: '#3c3c3c', t: ['pirate', 'ocean'] }],
    soldier: ['💂', 'enemy', { v: 90, hp: 3, b: ['patrol', 'shoot'], proj: 'bullet', c: '#c0392b' }],
    guard: ['💂', 'enemy', { v: 80, hp: 3, b: ['patrol'], sight: true, c: '#c0392b' }],
    cop: ['👮', 'enemy', { v: 120, hp: 3, b: ['chase'], c: '#3a6ea5', t: ['city'] }],
    police: ['👮', 'enemy', { v: 120, hp: 3, b: ['chase'], c: '#3a6ea5', t: ['city'] }],
    thief: ['🦹', 'enemy', { v: 160, hp: 2, b: ['steal'], c: '#5b4b8a', t: ['city'] }],
    bandit: ['🦹', 'enemy', { v: 140, hp: 2, b: ['chase'], c: '#6b4b3a', t: ['western'] }],
    villain: ['🦹', 'enemy', { v: 120, hp: 5, b: ['chase', 'shoot'], proj: 'bullet', c: '#6a3d9a' }],
    clown: ['🤡', 'enemy', { v: 120, hp: 3, b: ['chase', 'zigzag'], c: '#e74c3c', t: ['spooky'] }],
    mummy: [null, 'enemy', { v: 55, hp: 5, shape: 'blob', b: ['chase'], c: '#d8cfa8', t: ['desert', 'spooky'] }],
    yeti: [null, 'enemy', { v: 80, hp: 8, s: 46, shape: 'blob', b: ['chase'], c: '#eef3f7', t: ['snow'] }],
    monster: ['👹', 'enemy', { v: 90, hp: 3, b: ['chase'], c: '#b54a4a' }],
    beast: ['👹', 'enemy', { v: 110, hp: 5, s: 40, b: ['chase'], c: '#7a4a3a' }],
    virus: ['🦠', 'enemy', { v: 70, hp: 1, s: 22, b: ['swarm'], c: '#7bc96f', t: ['lab'] }],
    germ: ['🦠', 'enemy', { v: 70, hp: 1, s: 20, b: ['swarm'], c: '#7bc96f' }],
    bacteria: ['🦠', 'enemy', { v: 60, hp: 1, s: 20, b: ['swarm'], c: '#9bd96f' }],
    bug: ['🐛', 'enemy', { v: 60, hp: 1, s: 22, b: ['wander'], c: '#9bc53d' }],
    ant: ['🐜', 'enemy', { v: 90, hp: 1, s: 16, b: ['swarm'], c: '#7a3b2e' }],
    mosquito: ['🦟', 'enemy', { v: 150, hp: 1, s: 16, fly: true, b: ['chase', 'zigzag'], c: '#6b5b4b' }],
    rat: ['🐀', 'enemy', { v: 150, hp: 1, s: 22, b: ['wander', 'chase'], c: '#8a7f78', t: ['dungeon', 'city'] }],
    cockroach: ['🪳', 'enemy', { v: 170, hp: 1, s: 18, b: ['flee', 'zigzag'], c: '#7a4a2a' }],
    eyeball: ['👁️', 'enemy', { v: 60, hp: 3, fly: true, b: ['kite', 'shoot'], proj: 'laser', c: '#f4f4f4', t: ['spooky'] }],
    golem: ['🗿', 'enemy', { v: 45, hp: 12, s: 48, b: ['chase'], c: '#8f8a80' }],
    minotaur: ['🐂', 'boss', { v: 100, hp: 20, s: 64, b: ['chase', 'charge'], c: '#7a4a2a' }],
    kraken: ['🐙', 'boss', { v: 60, hp: 35, s: 96, b: ['wander', 'shoot'], proj: 'ink', c: '#a34a6a', t: ['ocean'] }],
    kaiju: ['🦖', 'boss', { v: 70, hp: 40, s: 110, b: ['chase', 'shoot'], proj: 'fireball', c: '#4a7a5a' }],
    godzilla: ['🦖', 'boss', { v: 70, hp: 40, s: 110, b: ['chase', 'shoot'], proj: 'fireball', c: '#4a7a5a' }],
    mothership: ['🛸', 'boss', { v: 50, hp: 40, s: 110, fly: true, b: ['wander', 'shoot'], proj: 'laser', c: '#9ad1c9', t: ['space'] }],
    lion: ['🦁', 'enemy', { v: 140, hp: 4, s: 38, b: ['chase'], c: '#d9a441' }],
    tiger: ['🐅', 'enemy', { v: 160, hp: 4, s: 38, b: ['chase'], c: '#e08a2e', t: ['jungle'] }],
    crocodile: ['🐊', 'enemy', { v: 90, hp: 5, s: 40, b: ['patrol', 'chase'], c: '#5a8a4a', t: ['jungle'] }],
    alligator: ['🐊', 'enemy', { v: 90, hp: 5, s: 40, b: ['patrol', 'chase'], c: '#5a8a4a' }],
    goose: ['🪿', 'enemy', { v: 150, hp: 2, b: ['chase'], c: '#eeeeee', t: ['farm'] }],
    scarecrow: [null, 'enemy', { v: 40, hp: 4, shape: 'triangle', b: ['sleep', 'chase'], c: '#c9a35b', t: ['farm', 'spooky'] }],
    pumpkin: ['🎃', 'enemy', { v: 70, hp: 2, b: ['hop', 'chase'], c: '#e67e22', t: ['spooky'] }],
    mimic: ['📦', 'enemy', { v: 120, hp: 4, b: ['sleep', 'chase'], c: '#a0703a', t: ['dungeon'] }],
    tank: [null, 'enemy', { v: 50, hp: 10, s: 46, shape: 'square', b: ['patrol', 'shoot'], proj: 'cannonball', c: '#5f6f4f' }],
    turret: [null, 'enemy', { v: 0, hp: 6, s: 34, shape: 'hex', static: true, b: ['shoot'], proj: 'bullet', c: '#8a8f99' }],
    cannon: [null, 'enemy', { v: 0, hp: 8, s: 36, shape: 'square', static: true, b: ['shoot'], proj: 'cannonball', c: '#3f3f46' }],
    boss: ['👹', 'boss', { v: 80, hp: 30, s: 90, b: ['chase', 'shoot'], proj: 'fireball', c: '#c0392b' }],
    enemy: [null, 'enemy', { generic: 'enemy' }],

    // --- neutral & friendly animals
    chicken: ['🐔', 'critter', { v: 90, hp: 1, b: ['wander'], c: '#f2efe6', proj: 'egg', t: ['farm'] }],
    cow: ['🐄', 'critter', { v: 40, hp: 3, s: 40, b: ['wander'], c: '#f0ece4', t: ['farm'] }],
    pig: ['🐖', 'critter', { v: 60, hp: 2, s: 34, b: ['wander'], c: '#f2a7b5', t: ['farm'] }],
    sheep: ['🐑', 'critter', { v: 50, hp: 2, s: 34, b: ['wander'], c: '#f4f1ea', t: ['farm'] }],
    duck: ['🦆', 'pet', { v: 120, hp: 2, b: ['follow'], c: '#f2d14b', t: ['farm'] }],
    rubber_duck: ['🦆', 'pet', { v: 140, hp: 99, s: 26, b: ['follow'], c: '#f5d03b' }],
    rabbit: ['🐇', 'critter', { v: 150, hp: 1, s: 24, b: ['hop', 'flee'], c: '#e8e1d9' }],
    bunny: ['🐇', 'critter', { v: 150, hp: 1, s: 24, b: ['hop', 'flee'], c: '#e8e1d9' }],
    cat: ['🐈', 'pet', { v: 170, hp: 3, b: ['follow'], proj: 'yarn', c: '#f0a35e' }],
    kitten: ['🐈', 'pet', { v: 170, hp: 2, s: 22, b: ['follow'], proj: 'yarn', c: '#f0a35e' }],
    dog: ['🐕', 'pet', { v: 190, hp: 4, b: ['follow', 'guard'], proj: 'bone', c: '#c98b4f' }],
    puppy: ['🐕', 'pet', { v: 190, hp: 3, s: 24, b: ['follow', 'guard'], proj: 'bone', c: '#c98b4f' }],
    horse: ['🐎', 'critter', { v: 180, hp: 4, s: 40, b: ['wander'], c: '#8a5a3b' }],
    frog: ['🐸', 'critter', { v: 100, hp: 1, s: 24, b: ['hop'], c: '#6fbf4f' }],
    toad: ['🐸', 'critter', { v: 80, hp: 2, s: 26, b: ['hop'], c: '#8f9f4f' }],
    penguin: ['🐧', 'critter', { v: 90, hp: 2, b: ['wander'], proj: 'fish', c: '#2f3640', t: ['snow'] }],
    turtle: ['🐢', 'critter', { v: 30, hp: 6, b: ['wander'], c: '#6f9f5f' }],
    fish: ['🐟', 'critter', { v: 100, hp: 1, s: 22, b: ['wander'], c: '#6fa8dc', t: ['ocean'] }],
    bird: ['🐦', 'critter', { v: 140, hp: 1, s: 22, fly: true, b: ['wander'], c: '#5dade2' }],
    owl: ['🦉', 'critter', { v: 100, hp: 2, fly: true, b: ['wander'], c: '#a0785a', t: ['forest'] }],
    fox: ['🦊', 'critter', { v: 160, hp: 2, b: ['wander'], c: '#e67e22', t: ['forest'] }],
    unicorn: ['🦄', 'critter', { v: 170, hp: 5, s: 38, b: ['wander'], fx2: ['rainbow'], c: '#f5b7e1' }],
    panda: ['🐼', 'critter', { v: 50, hp: 5, s: 38, b: ['wander'], c: '#f4f4f4' }],
    monkey: ['🐒', 'critter', { v: 150, hp: 2, b: ['hop', 'wander'], proj: 'banana', c: '#a0703a', t: ['jungle'] }],
    elephant: ['🐘', 'critter', { v: 40, hp: 10, s: 56, b: ['wander'], c: '#9aa0a6' }],
    giraffe: ['🦒', 'critter', { v: 60, hp: 5, s: 48, b: ['wander'], c: '#e3b04b' }],
    whale: ['🐋', 'critter', { v: 40, hp: 20, s: 90, b: ['wave'], c: '#4a6fa5', t: ['ocean'] }],
    dolphin: ['🐬', 'critter', { v: 160, hp: 3, s: 36, b: ['wave'], c: '#6fa8dc', t: ['ocean'] }],
    butterfly: ['🦋', 'critter', { v: 70, hp: 1, s: 20, fly: true, b: ['wander', 'wave'], c: '#5dade2', t: ['forest'] }],
    snail: ['🐌', 'critter', { v: 14, hp: 2, s: 22, b: ['wander'], c: '#c9a35b' }],
    hedgehog: ['🦔', 'critter', { v: 80, hp: 3, s: 24, b: ['wander'], c: '#8a6a4a' }],
    sloth: ['🦥', 'critter', { v: 8, hp: 4, b: ['wander'], c: '#9a8a6a' }],
    llama: ['🦙', 'critter', { v: 80, hp: 3, s: 38, b: ['wander'], proj: 'spit', c: '#e8dcc4' }],
    parrot: ['🦜', 'pet', { v: 150, hp: 2, fly: true, b: ['follow'], c: '#2ecc71' }],
    flamingo: ['🦩', 'critter', { v: 60, hp: 2, b: ['wander'], c: '#f48fb1' }],
    hamster: ['🐹', 'pet', { v: 120, hp: 1, s: 20, b: ['follow'], c: '#e6b37a' }],
    squirrel: ['🐿️', 'critter', { v: 170, hp: 1, s: 22, b: ['wander', 'hop'], c: '#b5651d', t: ['forest'] }],
    mouse: ['🐁', 'critter', { v: 150, hp: 1, s: 18, b: ['flee'], c: '#b8b0a8' }],
    deer: ['🦌', 'critter', { v: 140, hp: 3, s: 38, b: ['wander', 'flee'], c: '#a0703a', t: ['forest'] }],
    seal: ['🦭', 'critter', { v: 70, hp: 3, s: 36, b: ['wander'], c: '#8a8f99', t: ['snow', 'ocean'] }],
    pet: ['🐕', 'pet', { v: 190, hp: 4, b: ['follow', 'guard'], c: '#c98b4f' }],
    companion: ['🐕', 'pet', { v: 190, hp: 4, b: ['follow', 'guard'], c: '#c98b4f' }],
    sidekick: ['🦝', 'pet', { v: 180, hp: 4, b: ['follow', 'guard'], c: '#8a8f99' }],
    animal: [null, 'critter', { generic: 'animal' }],
    critter: [null, 'critter', { v: 90, hp: 1, shape: 'blob', b: ['wander'], c: '#c9a3e6' }],
    creature: [null, 'critter', { v: 90, hp: 2, shape: 'blob', b: ['wander'], c: '#9ad1c9' }],

    // --- people / NPCs
    wizard: ['🧙', 'npc', { v: 60, hp: 5, b: ['wander'], proj: 'magic', c: '#7a5bc4', t: ['fantasy'] }],
    mage: ['🧙', 'npc', { v: 60, hp: 5, b: ['wander'], proj: 'magic', c: '#7a5bc4', t: ['fantasy'] }],
    sorcerer: ['🧙', 'npc', { v: 60, hp: 5, b: ['wander'], proj: 'magic', c: '#7a5bc4' }],
    villager: ['🧑‍🌾', 'npc', { v: 50, hp: 3, b: ['wander'], c: '#c9a35b' }],
    farmer: ['🧑‍🌾', 'npc', { v: 50, hp: 3, b: ['wander'], c: '#c9a35b', t: ['farm'] }],
    merchant: ['🧑‍💼', 'npc', { v: 0, hp: 5, b: [], static: true, c: '#d4a373' }],
    shopkeeper: ['🧑‍💼', 'npc', { v: 0, hp: 5, b: [], static: true, c: '#d4a373' }],
    king: ['🤴', 'npc', { v: 40, hp: 5, b: ['wander'], c: '#f1c40f' }],
    queen: ['👸', 'npc', { v: 40, hp: 5, b: ['wander'], c: '#f1c40f' }],
    princess: ['👸', 'npc', { v: 50, hp: 3, b: ['wander'], c: '#f5b7e1' }],
    prince: ['🤴', 'npc', { v: 50, hp: 3, b: ['wander'], c: '#5dade2' }],
    knight: ['🤺', 'npc', { v: 90, hp: 6, b: ['wander'], c: '#aab7b8', t: ['fantasy'] }],
    fairy: ['🧚', 'npc', { v: 90, hp: 2, fly: true, b: ['wander', 'wave'], c: '#f5b7e1', t: ['forest', 'fantasy'] }],
    elf: ['🧝', 'npc', { v: 120, hp: 3, b: ['wander'], proj: 'arrow', c: '#58d68d', t: ['forest', 'fantasy'] }],
    archer: ['🏹', 'npc', { v: 90, hp: 3, b: ['wander'], proj: 'arrow', c: '#a0703a' }],
    mermaid: ['🧜', 'npc', { v: 90, hp: 3, b: ['wave'], proj: 'bubble', c: '#48c9b0', t: ['ocean'] }],
    angel: ['👼', 'npc', { v: 80, hp: 5, fly: true, b: ['wander'], c: '#fdf2c5' }],
    santa: ['🎅', 'npc', { v: 70, hp: 5, b: ['wander'], proj: 'present', c: '#e74c3c', t: ['snow'] }],
    snowman: ['☃️', 'npc', { v: 30, hp: 3, b: ['wander'], proj: 'snowball', c: '#f4f6f7', t: ['snow'] }],
    chef: ['🧑‍🍳', 'npc', { v: 60, hp: 3, b: ['wander'], proj: 'pizza', c: '#f4f6f7' }],
    doctor: ['🧑‍⚕️', 'npc', { v: 60, hp: 3, b: ['wander'], c: '#d6eaf8' }],
    scientist: ['🧑‍🔬', 'npc', { v: 60, hp: 3, b: ['wander'], c: '#d6eaf8', t: ['lab'] }],
    astronaut: ['🧑‍🚀', 'npc', { v: 80, hp: 4, b: ['wander'], proj: 'laser', c: '#ecf0f1', t: ['space'] }],
    cowboy: ['🤠', 'npc', { v: 100, hp: 4, b: ['wander'], proj: 'bullet', c: '#a0703a', t: ['western'] }],
    detective: ['🕵️', 'npc', { v: 80, hp: 3, b: ['wander'], c: '#6b5b4b' }],
    programmer: ['🧑‍💻', 'npc', { v: 60, hp: 3, b: ['wander'], proj: 'bug', c: '#7fb3d5' }],
    developer: ['🧑‍💻', 'npc', { v: 60, hp: 3, b: ['wander'], proj: 'bug', c: '#7fb3d5' }],
    coder: ['🧑‍💻', 'npc', { v: 60, hp: 3, b: ['wander'], proj: 'bug', c: '#7fb3d5' }],
    hacker: ['🧑‍💻', 'npc', { v: 80, hp: 3, b: ['wander'], proj: 'bug', c: '#58d68d' }],
    artist: ['🧑‍🎨', 'npc', { v: 60, hp: 3, b: ['wander'], c: '#f5b041' }],
    teacher: ['🧑‍🏫', 'npc', { v: 50, hp: 3, b: ['wander'], c: '#a9cce3' }],
    dj: ['🎧', 'npc', { v: 0, hp: 3, static: true, b: ['spin'], c: '#bb8fce' }],
    old_man: ['👴', 'npc', { v: 30, hp: 2, b: ['wander'], c: '#d5d8dc' }],
    grandma: ['👵', 'npc', { v: 30, hp: 2, b: ['wander'], c: '#d5d8dc' }],
    baby: ['👶', 'npc', { v: 40, hp: 1, s: 22, b: ['wander'], c: '#fadbd8' }],
    friend: ['🧑', 'pet', { v: 160, hp: 4, b: ['follow', 'guard'], c: '#85c1e9' }],
    person: ['🧑', 'npc', { v: 60, hp: 3, b: ['wander'], c: '#85c1e9' }],
    npc: ['🧑', 'npc', { v: 50, hp: 3, b: ['wander'], c: '#85c1e9' }],
    hero: ['🦸', 'npc', { v: 150, hp: 6, b: ['wander'], c: '#3498db' }],
    superhero: ['🦸', 'npc', { v: 170, hp: 6, b: ['wander'], c: '#3498db' }],
    zombie_hunter: ['🤠', 'npc', { v: 120, hp: 5, b: ['wander'], proj: 'bullet' }],

    // --- collectibles (pts = points; fx = special effect)
    coin: ['🪙', 'collectible', { pts: 1, s: 22, c: '#f2c94c' }],
    gold: ['🪙', 'collectible', { pts: 2, s: 22, c: '#f2c94c' }],
    money: ['💰', 'collectible', { pts: 5, s: 26, c: '#f2c94c' }],
    cash: ['💵', 'collectible', { pts: 5, s: 26, c: '#7dcea0' }],
    gem: ['💎', 'collectible', { pts: 5, s: 24, c: '#5dade2' }],
    jewel: ['💎', 'collectible', { pts: 5, s: 24, c: '#e74c3c' }],
    diamond: ['💎', 'collectible', { pts: 10, s: 24, c: '#aed6f1' }],
    crystal: ['🔮', 'collectible', { pts: 5, s: 24, c: '#bb8fce' }],
    ruby: ['💎', 'collectible', { pts: 8, s: 24, c: '#e74c3c', tint: '#e74c3c' }],
    star: ['⭐', 'collectible', { pts: 3, s: 24, c: '#f7dc6f', fx2: ['sparkle'] }],
    heart: ['❤️', 'collectible', { pts: 0, fx: 'heal', s: 24, c: '#e74c3c' }],
    potion: ['🧪', 'collectible', { pts: 0, fx: 'heal', s: 24, c: '#e74c3c' }],
    health: ['❤️', 'collectible', { pts: 0, fx: 'heal', s: 24, c: '#e74c3c' }],
    medkit: ['🩹', 'collectible', { pts: 0, fx: 'heal', s: 24, c: '#f5b7b1' }],
    key: ['🔑', 'collectible', { pts: 0, fx: 'key', s: 24, c: '#f4d03f' }],
    apple: ['🍎', 'collectible', { pts: 1, s: 24, c: '#e74c3c' }],
    banana: ['🍌', 'collectible', { pts: 1, s: 24, c: '#f7dc6f' }],
    cherry: ['🍒', 'collectible', { pts: 2, s: 22, c: '#c0392b' }],
    strawberry: ['🍓', 'collectible', { pts: 2, s: 22, c: '#e74c3c' }],
    grape: ['🍇', 'collectible', { pts: 2, s: 22, c: '#8e44ad' }],
    orange: ['🍊', 'collectible', { pts: 1, s: 22, c: '#e67e22' }],
    watermelon: ['🍉', 'collectible', { pts: 3, s: 28, c: '#58d68d' }],
    pear: ['🍐', 'collectible', { pts: 1, s: 22, c: '#c5e17a' }],
    peach: ['🍑', 'collectible', { pts: 1, s: 22, c: '#f5b041' }],
    lemon: ['🍋', 'collectible', { pts: 1, s: 22, c: '#f7dc6f' }],
    fruit: ['🍎', 'collectible', { generic: 'fruit', pts: 1 }],
    mushroom: ['🍄', 'collectible', { pts: 2, fx: 'grow', s: 24, c: '#e74c3c' }],
    carrot: ['🥕', 'collectible', { pts: 1, s: 22, c: '#e67e22' }],
    pizza: ['🍕', 'collectible', { pts: 2, s: 26, c: '#f5b041' }],
    burger: ['🍔', 'collectible', { pts: 2, s: 26, c: '#d68910' }],
    taco: ['🌮', 'collectible', { pts: 2, s: 26, c: '#f5b041' }],
    donut: ['🍩', 'collectible', { pts: 2, s: 24, c: '#f1948a' }],
    cookie: ['🍪', 'collectible', { pts: 1, s: 22, c: '#c9a35b' }],
    cake: ['🍰', 'collectible', { pts: 3, s: 26, c: '#fadbd8' }],
    candy: ['🍬', 'collectible', { pts: 1, s: 20, c: '#f1948a', t: ['candy'] }],
    lollipop: ['🍭', 'collectible', { pts: 2, s: 22, c: '#f1948a', t: ['candy'] }],
    ice_cream: ['🍦', 'collectible', { pts: 2, s: 24, c: '#fdebd0' }],
    chocolate: ['🍫', 'collectible', { pts: 2, s: 22, c: '#784212' }],
    cheese: ['🧀', 'collectible', { pts: 1, s: 22, c: '#f7dc6f' }],
    egg: ['🥚', 'collectible', { pts: 1, s: 20, c: '#fdfefe' }],
    bone: ['🦴', 'collectible', { pts: 1, s: 22, c: '#f4f1ea' }],
    treasure: ['💰', 'collectible', { pts: 25, s: 30, c: '#f2c94c', fx2: ['sparkle'] }],
    chest: ['🧰', 'collectible', { pts: 20, s: 30, c: '#a0703a' }],
    treasure_chest: ['🧰', 'collectible', { pts: 25, s: 32, c: '#a0703a', fx2: ['sparkle'] }],
    present: ['🎁', 'collectible', { pts: 5, s: 26, c: '#e74c3c' }],
    gift: ['🎁', 'collectible', { pts: 5, s: 26, c: '#e74c3c' }],
    trophy: ['🏆', 'collectible', { pts: 50, s: 30, c: '#f2c94c', fx: 'win' }],
    crown: ['👑', 'collectible', { pts: 20, s: 28, c: '#f2c94c' }],
    ring: ['💍', 'collectible', { pts: 10, s: 22, c: '#f7dc6f' }],
    flower: ['🌸', 'collectible', { pts: 1, s: 22, c: '#f5b7b1' }],
    rose: ['🌹', 'collectible', { pts: 2, s: 22, c: '#c0392b' }],
    sunflower: ['🌻', 'collectible', { pts: 2, s: 24, c: '#f4d03f' }],
    battery: ['🔋', 'collectible', { pts: 1, fx: 'speed', s: 22, c: '#58d68d' }],
    fuel: ['⛽', 'collectible', { pts: 1, fx: 'speed', s: 24, c: '#e74c3c' }],
    lightning: ['⚡', 'collectible', { pts: 1, fx: 'speed', s: 24, c: '#f7dc6f' }],
    coffee: ['☕', 'collectible', { pts: 1, fx: 'speed', s: 24, c: '#a0703a' }],
    clock: ['⏰', 'collectible', { pts: 0, fx: 'time', s: 24, c: '#e74c3c' }],
    hourglass: ['⏳', 'collectible', { pts: 0, fx: 'time', s: 24, c: '#f5cba7' }],
    shield: ['🛡️', 'collectible', { pts: 0, fx: 'invincible', s: 26, c: '#85c1e9' }],
    magnet: ['🧲', 'collectible', { pts: 0, fx: 'magnet', s: 24, c: '#e74c3c' }],
    sword: ['🗡️', 'collectible', { pts: 0, fx: 'ability:melee', s: 26, c: '#d5d8dc' }],
    gun: ['🔫', 'collectible', { pts: 0, fx: 'ability:shoot', s: 26, c: '#58d68d' }],
    bow: ['🏹', 'collectible', { pts: 0, fx: 'ability:shoot', s: 26, c: '#a0703a' }],
    wand: ['🪄', 'collectible', { pts: 0, fx: 'ability:shoot', s: 26, c: '#bb8fce' }],
    wings: ['🪽', 'collectible', { pts: 0, fx: 'fly', s: 26, c: '#fdfefe' }],
    feather: ['🪶', 'collectible', { pts: 1, fx: 'fly', s: 22, c: '#d6eaf8' }],
    book: ['📖', 'collectible', { pts: 3, s: 24, c: '#a04000' }],
    scroll: ['📜', 'collectible', { pts: 3, s: 24, c: '#f5deb3' }],
    letter: ['✉️', 'collectible', { pts: 2, s: 22, c: '#fdfefe' }],
    package: ['📦', 'collectible', { pts: 5, s: 26, c: '#c9a35b' }],
    parcel: ['📦', 'collectible', { pts: 5, s: 26, c: '#c9a35b' }],
    shell: ['🐚', 'collectible', { pts: 2, s: 22, c: '#fadbd8', t: ['ocean', 'beach'] }],
    pearl: [null, 'collectible', { pts: 5, s: 16, shape: 'circle', c: '#f8f9f9', fx2: ['glow'] }],
    leaf: ['🍃', 'collectible', { pts: 1, s: 22, c: '#58d68d' }],
    snowflake: ['❄️', 'collectible', { pts: 1, s: 22, c: '#d6eaf8', t: ['snow'] }],
    moon: ['🌙', 'collectible', { pts: 5, s: 26, c: '#f7dc6f' }],
    sun: ['☀️', 'collectible', { pts: 5, s: 30, c: '#f4d03f' }],
    orb: [null, 'collectible', { pts: 3, s: 18, shape: 'circle', c: '#bb8fce', fx2: ['glow'] }],
    sock: ['🧦', 'collectible', { pts: 1, s: 22, c: '#f1948a' }],
    battery_pack: ['🔋', 'collectible', { pts: 1, fx: 'speed', s: 22, c: '#58d68d' }],
    powerup: ['✨', 'collectible', { generic: 'powerup' }],
    item: ['✨', 'collectible', { generic: 'item' }],
    collectible: ['✨', 'collectible', { generic: 'item' }],
    pickup: ['✨', 'collectible', { generic: 'item' }],
    loot: ['💰', 'collectible', { pts: 5, s: 26, c: '#f2c94c' }],
    point: ['✨', 'collectible', { pts: 1, s: 18, c: '#f7dc6f' }],
    dot: [null, 'collectible', { pts: 1, s: 10, shape: 'circle', c: '#f7dc6f' }],
    pellet: [null, 'collectible', { pts: 1, s: 10, shape: 'circle', c: '#f7dc6f' }],
    food: ['🍎', 'collectible', { generic: 'fruit', pts: 1 }],
    yarn: ['🧶', 'collectible', { pts: 1, s: 22, c: '#e74c3c' }],
    bread: ['🍞', 'collectible', { pts: 1, s: 22, c: '#d4a373' }],

    // --- hazards & obstacles
    rock: ['🪨', 'obstacle', { static: true, s: 40, c: '#8a8580' }],
    stone: ['🪨', 'obstacle', { static: true, s: 40, c: '#8a8580' }],
    boulder: ['🪨', 'hazard', { v: 120, hp: 99, s: 56, b: ['patrol'], roll: true, c: '#8a8580' }],
    tree: ['🌳', 'obstacle', { static: true, s: 52, c: '#58a55c', t: ['forest'] }],
    pine: ['🌲', 'obstacle', { static: true, s: 52, c: '#3e7d4a', t: ['forest', 'snow'] }],
    palm: ['🌴', 'obstacle', { static: true, s: 52, c: '#58a55c', t: ['beach', 'jungle'] }],
    bush: ['🌿', 'obstacle', { static: true, s: 34, c: '#58a55c' }],
    cactus: ['🌵', 'hazard', { static: true, s: 40, dmg: 1, c: '#58a55c', t: ['desert'] }],
    crate: ['📦', 'obstacle', { pushable: true, s: 38, hp: 3, c: '#c9a35b' }],
    box: ['📦', 'obstacle', { pushable: true, s: 38, hp: 3, c: '#c9a35b' }],
    barrel: ['🛢️', 'obstacle', { pushable: true, s: 36, hp: 1, explosive: true, c: '#c0392b' }],
    wall: ['🧱', 'obstacle', { static: true, s: 40, c: '#b0563f' }],
    brick: ['🧱', 'obstacle', { static: true, s: 40, hp: 1, c: '#c0563f' }],
    block: [null, 'obstacle', { static: true, s: 40, shape: 'square', c: '#8a8f99' }],
    pillar: [null, 'obstacle', { static: true, s: 40, shape: 'square', c: '#a6a091' }],
    mine: [null, 'hazard', { static: true, s: 22, shape: 'circle', explosive: true, dmg: 2, c: '#3f3f46', fx2: ['blink'] }],
    landmine: [null, 'hazard', { static: true, s: 22, shape: 'circle', explosive: true, dmg: 2, c: '#3f3f46', fx2: ['blink'] }],
    bomb: ['💣', 'hazard', { static: true, s: 28, explosive: true, dmg: 2, c: '#2c3e50' }],
    dynamite: ['🧨', 'hazard', { static: true, s: 26, explosive: true, dmg: 2, c: '#c0392b' }],
    spike: [null, 'hazard', { static: true, s: 28, shape: 'triangle', dmg: 1, c: '#d5d8dc' }],
    spikes: [null, 'hazard', { static: true, s: 28, shape: 'triangle', dmg: 1, c: '#d5d8dc' }],
    fire: ['🔥', 'hazard', { static: true, s: 30, dmg: 1, c: '#e67e22', fx2: ['flicker', 'glow'] }],
    flame: ['🔥', 'hazard', { static: true, s: 30, dmg: 1, c: '#e67e22', fx2: ['flicker', 'glow'] }],
    campfire: ['🔥', 'structure', { static: true, s: 34, c: '#e67e22', fx2: ['glow'], light: true }],
    meteor: ['☄️', 'hazard', { v: 220, hp: 1, s: 34, b: ['fall'], dmg: 1, c: '#e67e22', t: ['space'] }],
    comet: ['☄️', 'hazard', { v: 260, hp: 1, s: 30, b: ['fall'], dmg: 1, c: '#85c1e9', t: ['space'] }],
    asteroid: ['🪨', 'hazard', { v: 80, hp: 3, s: 48, b: ['drift', 'spin'], dmg: 1, c: '#8a8580', t: ['space'] }],
    tornado: ['🌪️', 'hazard', { v: 90, hp: 99, s: 48, b: ['wander', 'magnet'], dmg: 1, c: '#aab7b8' }],
    saw: ['⚙️', 'hazard', { v: 120, hp: 99, s: 36, b: ['patrol', 'spin'], dmg: 2, c: '#aab7b8' }],
    sawblade: ['⚙️', 'hazard', { v: 120, hp: 99, s: 36, b: ['patrol', 'spin'], dmg: 2, c: '#aab7b8' }],
    trap: ['🪤', 'hazard', { static: true, s: 26, dmg: 1, c: '#a0703a' }],
    volcano: ['🌋', 'structure', { static: true, s: 70, b: ['spawner'], spawns: 'fireball', c: '#c0392b' }],
    cloud: ['☁️', 'critter', { v: 30, hp: 99, s: 50, fly: true, b: ['drift'], c: '#fdfefe' }],
    storm_cloud: ['⛈️', 'hazard', { v: 50, hp: 99, s: 54, fly: true, b: ['wander', 'shoot'], proj: 'lightning_bolt', c: '#85929e' }],
    iceberg: ['🧊', 'obstacle', { static: true, s: 46, c: '#d6eaf8', t: ['snow'] }],
    poop: ['💩', 'hazard', { static: true, s: 26, dmg: 1, c: '#8a5a3b' }],
    banana_peel: ['🍌', 'hazard', { static: true, s: 24, dmg: 0, slip: true, c: '#f7dc6f' }],
    puddle: [null, 'hazard', { static: true, s: 40, shape: 'blob', dmg: 0, slow: true, c: '#5dade2' }],
    lava: [null, 'tile', { tile: 'lava' }],
    water: [null, 'tile', { tile: 'water' }],
    ice: [null, 'tile', { tile: 'ice' }],
    platform: [null, 'tile', { tile: 'platform' }],
    obstacle: ['🪨', 'obstacle', { generic: 'obstacle' }],
    hazard: [null, 'hazard', { generic: 'hazard' }],
    laser_grid: [null, 'hazard', { static: true, s: 30, shape: 'square', dmg: 1, c: '#e74c3c', fx2: ['blink', 'glow'] }],

    // --- structures
    portal: ['🌀', 'structure', { static: true, s: 44, c: '#8e44ad', fx2: ['spin', 'glow'] }],
    door: ['🚪', 'structure', { static: true, s: 44, c: '#a0703a', exit: true }],
    exit: ['🚪', 'structure', { static: true, s: 44, c: '#a0703a', exit: true }],
    flag: ['🚩', 'structure', { static: true, s: 44, c: '#e74c3c', exit: true }],
    goal: ['🚩', 'structure', { static: true, s: 44, c: '#e74c3c', exit: true }],
    finish: ['🏁', 'structure', { static: true, s: 44, c: '#fdfefe', exit: true }],
    finish_line: ['🏁', 'structure', { static: true, s: 44, c: '#fdfefe', exit: true }],
    checkpoint: ['🚩', 'structure', { static: true, s: 36, c: '#58d68d' }],
    house: ['🏠', 'structure', { static: true, s: 64, solid: true, c: '#c0563f' }],
    castle: ['🏰', 'structure', { static: true, s: 90, hp: 40, solid: true, c: '#aab7b8' }],
    tower: ['🗼', 'structure', { static: true, s: 60, solid: true, c: '#e67e22' }],
    statue: ['🗿', 'obstacle', { static: true, s: 46, c: '#8f8a80' }],
    fountain: ['⛲', 'structure', { static: true, s: 54, c: '#5dade2' }],
    shrine: ['⛩️', 'structure', { static: true, s: 54, c: '#e74c3c' }],
    trampoline: [null, 'structure', { static: true, s: 44, shape: 'trampoline', c: '#5dade2', launch: true }],
    spring: [null, 'structure', { static: true, s: 30, shape: 'trampoline', c: '#e67e22', launch: true }],
    nest: ['🪹', 'structure', { static: true, s: 40, b: ['spawner'], c: '#a0703a' }],
    hive: ['🍯', 'structure', { static: true, s: 40, b: ['spawner'], spawns: 'bee', c: '#f5b041' }],
    spawner: [null, 'structure', { static: true, s: 40, shape: 'hex', b: ['spawner'], c: '#8e44ad' }],
    grave: ['🪦', 'structure', { static: true, s: 36, b: ['spawner'], spawns: 'zombie', c: '#8a8f99', t: ['spooky'] }],
    tombstone: ['🪦', 'structure', { static: true, s: 36, b: ['spawner'], spawns: 'zombie', c: '#8a8f99', t: ['spooky'] }],
    computer: ['💻', 'structure', { static: true, s: 40, c: '#aab7b8', recursion: true }],
    laptop: ['💻', 'structure', { static: true, s: 40, c: '#aab7b8', recursion: true }],
    tv: ['📺', 'structure', { static: true, s: 40, c: '#aab7b8' }],
    sign: ['🪧', 'structure', { static: true, s: 36, c: '#c9a35b', talk: true }],
    bed: ['🛏️', 'structure', { static: true, s: 44, c: '#85c1e9' }],
    core: ['💠', 'structure', { static: true, s: 56, hp: 20, c: '#5dade2', fx2: ['glow', 'pulse'] }],
    base: ['🏰', 'structure', { static: true, s: 80, hp: 30, c: '#aab7b8' }],
    ball: ['⚽', 'critter', { v: 0, hp: 99, s: 28, pushable: true, bouncy: true, c: '#fdfefe' }],
    soccer_ball: ['⚽', 'critter', { v: 0, hp: 99, s: 28, pushable: true, bouncy: true, c: '#fdfefe' }],
    basketball: ['🏀', 'critter', { v: 0, hp: 99, s: 30, pushable: true, bouncy: true, c: '#e67e22' }],
    beach_ball: [null, 'critter', { v: 0, hp: 99, s: 34, shape: 'circle', pushable: true, bouncy: true, c: '#e74c3c' }],

    // --- vehicles (mostly used as player skins)
    ship: ['🚀', 'vehicle', { v: 240, hp: 4, c: '#d5d8dc', t: ['space'] }],
    spaceship: ['🚀', 'vehicle', { v: 240, hp: 4, c: '#d5d8dc', t: ['space'] }],
    rocket: ['🚀', 'vehicle', { v: 260, hp: 4, c: '#d5d8dc', t: ['space'] }],
    car: ['🚗', 'vehicle', { v: 260, hp: 4, c: '#e74c3c', t: ['city'] }],
    race_car: ['🏎️', 'vehicle', { v: 300, hp: 4, c: '#e74c3c' }],
    truck: ['🚚', 'vehicle', { v: 200, hp: 6, s: 40, c: '#5dade2' }],
    bus: ['🚌', 'vehicle', { v: 180, hp: 8, s: 44, c: '#f4d03f' }],
    taxi: ['🚕', 'vehicle', { v: 240, hp: 4, c: '#f4d03f' }],
    plane: ['✈️', 'vehicle', { v: 280, hp: 4, fly: true, c: '#d5d8dc' }],
    airplane: ['✈️', 'vehicle', { v: 280, hp: 4, fly: true, c: '#d5d8dc' }],
    helicopter: ['🚁', 'vehicle', { v: 220, hp: 4, fly: true, c: '#58d68d' }],
    boat: ['⛵', 'vehicle', { v: 200, hp: 4, c: '#fdfefe', t: ['ocean'] }],
    submarine: [null, 'vehicle', { v: 180, hp: 5, shape: 'capsule', c: '#f4d03f', t: ['ocean'] }],
    bike: ['🚲', 'vehicle', { v: 230, hp: 3, c: '#e74c3c' }],
    bicycle: ['🚲', 'vehicle', { v: 230, hp: 3, c: '#e74c3c' }],
    skateboard: ['🛹', 'vehicle', { v: 250, hp: 3, c: '#e67e22' }],
    train: ['🚂', 'vehicle', { v: 200, hp: 10, s: 44, c: '#c0392b' }],
    balloon: ['🎈', 'vehicle', { v: 120, hp: 1, fly: true, c: '#e74c3c' }],
    mech: ['🤖', 'vehicle', { v: 160, hp: 8, s: 40, c: '#9aa7b4' }],
  };

  // Multi-word nouns -> canonical keys (checked before single words)
  L.compounds = {
    'rubber duck': 'rubber_duck', 'rubber ducky': 'rubber_duck', 'treasure chest': 'treasure_chest',
    'power up': 'powerup', 'power-up': 'powerup', 'power ups': 'powerup', 'power-ups': 'powerup',
    'health pack': 'medkit', 'health potion': 'potion', 'med kit': 'medkit', 'first aid kit': 'medkit',
    'speed boost': 'lightning', 'ice cream': 'ice_cream', 't rex': 'trex', 't-rex': 'trex', 'tyrannosaurus': 'trex',
    'space ship': 'spaceship', 'race car': 'race_car', 'racecar': 'race_car', 'storm cloud': 'storm_cloud',
    'thunder cloud': 'storm_cloud', 'rain cloud': 'storm_cloud', 'old man': 'old_man', 'old lady': 'grandma',
    'banana peel': 'banana_peel', 'saw blade': 'sawblade', 'finish line': 'finish_line', 'soccer ball': 'soccer_ball',
    'beach ball': 'beach_ball', 'land mine': 'landmine', 'laser grid': 'laser_grid', 'bad guy': 'monster',
    'bad guys': 'monster', 'evil robot': 'robot', 'flying saucer': 'ufo', 'battery pack': 'battery_pack',
    'zombie hunter': 'zombie_hunter', 'easter egg': 'egg', 'gold coin': 'coin', 'gold coins': 'coin',
    'magic wand': 'wand', 'jet pack': 'jetpack', 'killer robot': 'robot', 'giant spider': 'spider',
  };

  // Synonyms -> canonical key
  L.synonyms = {
    zombi: 'zombie', undead: 'zombie', walker: 'zombie', skelly: 'skeleton', spook: 'ghost', specter: 'ghost', spectre: 'ghost',
    phantom: 'ghost', spirit: 'ghost', blob: 'slime', ooze: 'slime', jelly: 'slime', gremlin: 'goblin', ogre: 'troll',
    fiend: 'demon', extraterrestrial: 'alien', invader: 'alien', martian: 'alien', saucer: 'ufo', bot: 'robot', android: 'robot',
    cyborg: 'robot', droid: 'robot', arachnid: 'spider', serpent: 'snake', cobra: 'snake', python: 'snake', viper: 'snake',
    wyvern: 'dragon', drake: 'dragon', dino: 'dinosaur', rex: 'trex', vamp: 'vampire', hag: 'witch', samurai: 'ninja',
    buccaneer: 'pirate', officer: 'cop', robber: 'thief', burglar: 'thief', crook: 'thief', outlaw: 'bandit', baddie: 'monster',
    foe: 'enemy', villain: 'villain', mob: 'monster', minion: 'goblin', grunt: 'enemy', creep: 'monster', critter: 'critter',
    hen: 'chicken', rooster: 'chicken', chick: 'chicken', cattle: 'cow', piggy: 'pig', lamb: 'sheep', ducky: 'duck',
    duckling: 'duck', hare: 'rabbit', kitty: 'cat', kitteh: 'cat', doggo: 'dog', pupper: 'dog', doggy: 'dog', hound: 'dog',
    pony: 'horse', stallion: 'horse', fishy: 'fish', salmon: 'fish', tuna: 'fish', goldfish: 'fish', birdie: 'bird',
    pigeon: 'bird', crow: 'bird', raven: 'bird', eagle: 'bird', seagull: 'bird', gull: 'bird', ape: 'monkey', gorilla: 'monkey',
    chimp: 'monkey', doe: 'deer', stag: 'deer', reindeer: 'deer', hamster: 'hamster', gerbil: 'hamster', rodent: 'mouse',
    mage: 'mage', warlock: 'sorcerer', magician: 'wizard', peasant: 'villager', citizen: 'villager', vendor: 'merchant',
    trader: 'merchant', paladin: 'knight', warrior: 'knight', pixie: 'fairy', sprite: 'fairy', ranger: 'archer', hunter: 'archer',
    cherub: 'angel', claus: 'santa', cook: 'chef', nurse: 'doctor', medic: 'doctor', cosmonaut: 'astronaut', sheriff: 'cowboy',
    cowgirl: 'cowboy', programmer: 'programmer', engineer: 'programmer', nerd: 'programmer', granny: 'grandma', grandpa: 'old_man',
    buddy: 'friend', pal: 'friend', ally: 'friend', human: 'person', guy: 'person', dude: 'person', man: 'person', woman: 'person',
    girl: 'person', boy: 'person', kid: 'person', child: 'person', coins: 'coin', moneybag: 'money', dollar: 'cash', dollars: 'cash',
    gemstone: 'gem', jewels: 'jewel', emerald: 'gem', sapphire: 'gem', amethyst: 'crystal', starfish: 'star', hearts: 'heart',
    life: 'heart', lives: 'heart', elixir: 'potion', flask: 'potion', berry: 'strawberry', berries: 'strawberry', grapes: 'grape',
    melon: 'watermelon', shroom: 'mushroom', fungus: 'mushroom', toadstool: 'mushroom', hamburger: 'burger', cheeseburger: 'burger',
    sweets: 'candy', sweet: 'candy', candies: 'candy', biscuit: 'cookie', cupcake: 'cake', pie: 'cake', icecream: 'ice_cream',
    eggs: 'egg', present: 'present', gifts: 'gift', cup: 'trophy', medal: 'trophy', tiara: 'crown', blossom: 'flower',
    tulip: 'flower', daisy: 'flower', energy: 'battery', boost: 'lightning', bolt: 'lightning', timer: 'clock', watch: 'clock',
    armor: 'shield', blade: 'sword', katana: 'sword', axe: 'sword', dagger: 'sword', pistol: 'gun', blaster: 'gun', rifle: 'gun',
    shotgun: 'gun', crossbow: 'bow', staff: 'wand', tome: 'book', parcel: 'parcel', seashell: 'shell', pebble: 'rock',
    rocks: 'rock', boulders: 'boulder', oak: 'tree', trees: 'tree', forest: 'tree', shrub: 'bush', hedge: 'bush', crates: 'crate',
    keg: 'barrel', bricks: 'brick', column: 'pillar', explosive: 'bomb', tnt: 'dynamite', thorn: 'spike', thorns: 'spike',
    blaze: 'fire', bonfire: 'campfire', meteorite: 'meteor', twister: 'tornado', cyclone: 'tornado', whirlwind: 'tornado',
    gear: 'saw', cog: 'saw', snare: 'trap', poo: 'poop', turd: 'poop', wormhole: 'portal', teleporter: 'portal', gate: 'door',
    gateway: 'portal', banner: 'flag', checkpoint: 'checkpoint', home: 'house', hut: 'house', cabin: 'house', fortress: 'castle',
    fort: 'castle', lighthouse: 'tower', idol: 'statue', monument: 'statue', bouncepad: 'trampoline', jumppad: 'trampoline',
    'jump pad': 'trampoline', spawnpoint: 'spawner', beehive: 'hive', gravestone: 'grave', headstone: 'grave', pc: 'computer',
    monitor: 'computer', television: 'tv', crystal_core: 'core', reactor: 'core', heart_core: 'core', football: 'soccer_ball',
    starship: 'spaceship', spacecraft: 'spaceship', jet: 'plane', chopper: 'helicopter', yacht: 'boat', canoe: 'boat',
    sub: 'submarine', locomotive: 'train', motorbike: 'bike', motorcycle: 'bike', scooter: 'bike', robot_suit: 'mech',
    wraith: 'ghost', poltergeist: 'ghost', ghoul: 'zombie', lich: 'skeleton', beholder: 'eyeball', eye: 'eyeball',
    squirrels: 'squirrel', bees: 'bee', mice: 'mouse', geese: 'goose', wolves: 'wolf', cacti: 'cactus', fishes: 'fish',
    sheeps: 'sheep', octopi: 'octopus', people: 'person', guards: 'guard', knives: 'knife', leaves: 'leaf', loaves: 'bread',
    elves: 'elf', dwarves: 'knight', dwarf: 'knight', thieves: 'thief', ufos: 'ufo', bugs: 'bug', insect: 'bug', beetle: 'bug',
    worm: 'bug', caterpillar: 'bug', ladybug: 'bug', mantis: 'bug', termite: 'ant', cockroaches: 'cockroach', roach: 'cockroach',
    sentry: 'turret', gun_turret: 'turret', artillery: 'cannon', baddies: 'monster', enemies: 'enemy', monsters: 'monster',
    microbe: 'virus', pathogen: 'virus', corona: 'virus', covid: 'virus', snowmen: 'snowman', jellyfishes: 'jellyfish',
  };

  // Projectile archetypes: what things shoot / throw
  L.projectiles = {
    bullet: { shape: 'circle', c: '#f7dc6f', s: 8, v: 620, dmg: 1 },
    laser: { shape: 'line', c: '#ff5a5f', s: 8, v: 900, dmg: 1, fx: ['glow'] },
    plasma: { shape: 'circle', c: '#8be9fd', s: 12, v: 560, dmg: 2, fx: ['glow'] },
    beam: { shape: 'line', c: '#8be9fd', s: 8, v: 1100, dmg: 1, pierce: true, fx: ['glow'] },
    fireball: { glyph: '🔥', c: '#e67e22', s: 20, v: 420, dmg: 1, fx: ['glow'] },
    flame: { glyph: '🔥', c: '#e67e22', s: 16, v: 380, dmg: 1, life: 0.5 },
    arrow: { shape: 'line', c: '#d4b483', s: 10, v: 700, dmg: 1 },
    rocket: { glyph: '🚀', c: '#d5d8dc', s: 20, v: 420, dmg: 2, explode: 70 },
    missile: { glyph: '🚀', c: '#d5d8dc', s: 18, v: 380, dmg: 2, explode: 60, homing: true },
    snowball: { shape: 'circle', c: '#f4f6f7', s: 14, v: 520, dmg: 1 },
    bubble: { shape: 'ring', c: '#aed6f1', s: 16, v: 300, dmg: 1 },
    shuriken: { shape: 'star', c: '#bfc9ca', s: 14, v: 640, dmg: 1, fx: ['spin'] },
    star: { glyph: '⭐', c: '#f7dc6f', s: 16, v: 560, dmg: 1, fx: ['spin'] },
    bomb: { glyph: '💣', c: '#2c3e50', s: 20, v: 320, dmg: 2, explode: 90 },
    cannonball: { shape: 'circle', c: '#2c2c2c', s: 16, v: 480, dmg: 2 },
    rock: { glyph: '🪨', c: '#8a8580', s: 18, v: 460, dmg: 1 },
    banana: { glyph: '🍌', c: '#f7dc6f', s: 18, v: 480, dmg: 1, fx: ['spin'] },
    fish: { glyph: '🐟', c: '#6fa8dc', s: 18, v: 480, dmg: 1 },
    water: { shape: 'circle', c: '#5dade2', s: 10, v: 560, dmg: 1 },
    ink: { shape: 'blob', c: '#2c2c3c', s: 14, v: 360, dmg: 1 },
    magic: { glyph: '✨', c: '#bb8fce', s: 18, v: 520, dmg: 1, fx: ['glow'] },
    lightning_bolt: { glyph: '⚡', c: '#f7dc6f', s: 22, v: 700, dmg: 1, fx: ['glow'] },
    heart: { glyph: '❤️', c: '#e74c3c', s: 16, v: 480, dmg: 1 },
    note: { glyph: '🎵', c: '#bb8fce', s: 18, v: 420, dmg: 1 },
    poop: { glyph: '💩', c: '#8a5a3b', s: 18, v: 420, dmg: 1 },
    pizza: { glyph: '🍕', c: '#f5b041', s: 18, v: 460, dmg: 1, fx: ['spin'] },
    boomerang: { glyph: '🪃', c: '#c9a35b', s: 20, v: 520, dmg: 1, boomerang: true, pierce: true, fx: ['spin'] },
    spear: { shape: 'line', c: '#c9a35b', s: 12, v: 620, dmg: 2 },
    knife: { glyph: '🔪', c: '#d5d8dc', s: 16, v: 680, dmg: 1, fx: ['spin'] },
    egg: { glyph: '🥚', c: '#fdfefe', s: 16, v: 420, dmg: 1 },
    seed: { shape: 'circle', c: '#a0703a', s: 7, v: 600, dmg: 1 },
    acid: { shape: 'blob', c: '#7bc96f', s: 14, v: 400, dmg: 1, fx: ['glow'] },
    web: { shape: 'ring', c: '#f4f6f7', s: 18, v: 380, dmg: 0, slow: true },
    spit: { shape: 'blob', c: '#d6eaf8', s: 10, v: 420, dmg: 1 },
    ice: { shape: 'diamond', c: '#aed6f1', s: 14, v: 560, dmg: 1 },
    yarn: { glyph: '🧶', c: '#e74c3c', s: 18, v: 460, dmg: 1, fx: ['spin'] },
    bone: { glyph: '🦴', c: '#f4f1ea', s: 18, v: 480, dmg: 1, fx: ['spin'] },
    bread: { glyph: '🍞', c: '#d4a373', s: 18, v: 440, dmg: 1 },
    coin: { glyph: '🪙', c: '#f2c94c', s: 14, v: 560, dmg: 1, fx: ['spin'] },
    carrot: { glyph: '🥕', c: '#e67e22', s: 18, v: 520, dmg: 1 },
    bug: { glyph: '🐛', c: '#9bc53d', s: 18, v: 380, dmg: 1 },
    present: { glyph: '🎁', c: '#e74c3c', s: 18, v: 420, dmg: 1 },
    kiss: { glyph: '💋', c: '#e74c3c', s: 16, v: 460, dmg: 1 },
    cheese: { glyph: '🧀', c: '#f7dc6f', s: 16, v: 460, dmg: 1 },
    sword_beam: { shape: 'line', c: '#aed6f1', s: 12, v: 720, dmg: 2, fx: ['glow'] },
    paint: { shape: 'blob', c: '#e74c3c', s: 12, v: 520, dmg: 1 },
  };
  L.projectileSynonyms = {
    bullets: 'bullet', ammo: 'bullet', pellets: 'bullet', lasers: 'laser', lazer: 'laser', lazers: 'laser', laserbeam: 'beam',
    fireballs: 'fireball', fire: 'fireball', flames: 'flame', arrows: 'arrow', rockets: 'rocket', missiles: 'missile',
    snowballs: 'snowball', snow: 'snowball', bubbles: 'bubble', shurikens: 'shuriken', 'ninja stars': 'shuriken',
    'throwing stars': 'shuriken', stars: 'star', bombs: 'bomb', grenades: 'bomb', grenade: 'bomb', cannonballs: 'cannonball',
    rocks: 'rock', stones: 'rock', bananas: 'banana', fishes: 'fish', ink: 'ink', spells: 'magic', spell: 'magic', sparkles: 'magic',
    'magic missiles': 'missile', lightning: 'lightning_bolt', thunder: 'lightning_bolt', bolts: 'lightning_bolt', hearts: 'heart',
    love: 'heart', notes: 'note', music: 'note', 'music notes': 'note', poops: 'poop', poo: 'poop', pizzas: 'pizza',
    boomerangs: 'boomerang', spears: 'spear', knives: 'knife', daggers: 'knife', eggs: 'egg', seeds: 'seed', acid: 'acid',
    webs: 'web', 'spider webs': 'web', spit: 'spit', icicles: 'ice', 'ice shards': 'ice', shards: 'ice', yarn: 'yarn',
    bones: 'bone', bread: 'bread', coins: 'coin', money: 'coin', carrots: 'carrot', bugs: 'bug', presents: 'present',
    gifts: 'present', kisses: 'kiss', cheese: 'cheese', plasma: 'plasma', energy: 'plasma', beams: 'beam', paintballs: 'paint',
    water: 'water', 'water balloons': 'water', darts: 'arrow', dart: 'arrow', fireworks: 'rocket', cannon: 'cannonball',
  };

  // ---------------------------------------------------------------------------
  // Colors
  // ---------------------------------------------------------------------------
  L.colors = {
    red: '#e5484d', crimson: '#c0283d', scarlet: '#e0352b', maroon: '#7a1f2b', orange: '#f08c3a', amber: '#f2a93b',
    gold: '#f2c94c', golden: '#f2c94c', yellow: '#f5d547', lime: '#a3e048', green: '#55b96a', emerald: '#2fae74',
    mint: '#8fe3c0', teal: '#2a9d8f', cyan: '#4fd1e0', turquoise: '#3fc9c0', aqua: '#5fe0d8', blue: '#4f8ef0',
    navy: '#28407a', cobalt: '#2f5fd0', azure: '#4fa8f0', indigo: '#5a4fcf', purple: '#9b5de5', violet: '#8f6af0',
    lavender: '#c4a7f0', magenta: '#e040b0', pink: '#f283b6', rose: '#f07a9a', salmon: '#f59b86', peach: '#f7b98a',
    coral: '#f47c6a', brown: '#8a5a3b', tan: '#d2b48c', beige: '#e8dcc4', cream: '#f5efdc', white: '#f6f4ef',
    black: '#1c1b1f', gray: '#8f949a', grey: '#8f949a', silver: '#c5cad1', charcoal: '#3a3d42', olive: '#8a9a3b',
    khaki: '#c3b37a', bronze: '#b0793a', copper: '#c26b3a', rust: '#b5502a', plum: '#8e4585', lilac: '#c8a2c8',
    ivory: '#f8f4e3', chartreuse: '#b5e61d', fuchsia: '#e040fb', cerulean: '#2a7bd4', sky: '#87c5f0', ruby: '#d1284f',
    sapphire: '#2f5fd0', jade: '#3fae7a', obsidian: '#1b1a22', blood: '#9b111e', neon: '#39ff88', pastel: '#f5c6d6',
  };

  // ---------------------------------------------------------------------------
  // Adjectives -> modifiers. Each: {size, speed, hp, dmg, color, team, role, fx, b, flags...}
  // size/speed/hp are multipliers.
  // ---------------------------------------------------------------------------
  L.adjectives = {
    tiny: { size: 0.45, hp: 0.5 }, teeny: { size: 0.4 }, mini: { size: 0.55, hp: 0.6 }, small: { size: 0.7 },
    little: { size: 0.72 }, baby: { size: 0.6, hp: 0.5, speed: 0.9 }, big: { size: 1.5, hp: 1.6 }, large: { size: 1.5, hp: 1.6 },
    huge: { size: 2.2, hp: 2.5 }, giant: { size: 2.6, hp: 3, speed: 0.85 }, gigantic: { size: 3.2, hp: 4, speed: 0.8 },
    enormous: { size: 3, hp: 4, speed: 0.8 }, massive: { size: 3, hp: 4, speed: 0.75 }, colossal: { size: 4, hp: 6, speed: 0.7 },
    mega: { size: 2.4, hp: 5, boss: true }, ultra: { size: 2.2, hp: 4 }, titanic: { size: 4, hp: 8, speed: 0.6 },
    fat: { size: 1.4, speed: 0.75 }, chubby: { size: 1.3, speed: 0.8 }, chonky: { size: 1.5, speed: 0.7 }, skinny: { size: 0.8, speed: 1.1 },
    fast: { speed: 1.7 }, quick: { speed: 1.6 }, speedy: { speed: 1.8 }, rapid: { speed: 1.8 }, swift: { speed: 1.7 },
    turbo: { speed: 2.4 }, hyper: { speed: 2.2, b: ['zigzag'] }, zoomy: { speed: 2 }, nimble: { speed: 1.4 },
    slow: { speed: 0.5 }, sluggish: { speed: 0.4 }, lazy: { speed: 0.4, b: ['wander'] }, sleepy: { speed: 0.5, b: ['sleep'] },
    angry: { team: 'enemy', b: ['chase'], tint: '#e5484d', speed: 1.2 }, aggressive: { team: 'enemy', b: ['chase'], speed: 1.2 },
    evil: { team: 'enemy', b: ['chase'], tint: '#9b2d5b' }, hostile: { team: 'enemy', b: ['chase'] }, mean: { team: 'enemy', b: ['chase'] },
    killer: { team: 'enemy', b: ['chase'], dmg: 2 }, deadly: { team: 'enemy', dmg: 2 }, dangerous: { team: 'enemy', dmg: 1 },
    murderous: { team: 'enemy', b: ['chase'], dmg: 2 }, vicious: { team: 'enemy', b: ['chase'], speed: 1.3 },
    rabid: { team: 'enemy', b: ['chase', 'zigzag'], speed: 1.4 }, hungry: { b: ['eat'] }, greedy: { b: ['eat'] },
    friendly: { team: 'friend' }, nice: { team: 'friend' }, kind: { team: 'friend' }, peaceful: { team: 'neutral', b: ['wander'] },
    helpful: { team: 'friend', b: ['follow', 'guard'] }, loyal: { team: 'friend', b: ['follow', 'guard'] },
    good: { team: 'friend' }, cute: { size: 0.8, pastel: true }, adorable: { size: 0.75, pastel: true }, kawaii: { size: 0.75, pastel: true },
    shy: { b: ['flee'] }, scared: { b: ['flee'] }, cowardly: { b: ['flee'] }, timid: { b: ['flee'] }, frightened: { b: ['flee'] },
    brave: { b: ['chase'] }, crazy: { b: ['zigzag'], speed: 1.4 }, chaotic: { b: ['zigzag', 'warp'], speed: 1.3 },
    wild: { b: ['zigzag'], speed: 1.3 }, mad: { b: ['zigzag', 'chase'], speed: 1.3 }, drunk: { b: ['zigzag'], fx: ['wobble'] },
    dizzy: { b: ['zigzag'], fx: ['spin'] }, confused: { b: ['wander', 'zigzag'] }, smart: { smart: true }, clever: { smart: true },
    genius: { smart: true, speed: 1.2 }, dumb: { b: ['wander'] }, stupid: { b: ['wander'] }, sneaky: { fx: ['flicker'], alpha: 0.5 },
    stealthy: { alpha: 0.35 }, invisible: { alpha: 0.06 }, transparent: { alpha: 0.4 }, ghostly: { ghost: true, alpha: 0.5, fly: true },
    spectral: { ghost: true, alpha: 0.5, fly: true }, flying: { fly: true }, winged: { fly: true }, floating: { fly: true, b: ['wave'] },
    hovering: { fly: true }, swimming: { b: ['wave'] }, jumping: { b: ['hop'] }, hopping: { b: ['hop'] }, bouncy: { bouncy: true, b: ['hop'] },
    bouncing: { bouncy: true }, rubber: { bouncy: true }, glowing: { fx: ['glow'] }, shiny: { fx: ['sparkle', 'glow'] },
    sparkly: { fx: ['sparkle'] }, glittery: { fx: ['sparkle'] }, luminous: { fx: ['glow'] }, radiant: { fx: ['glow', 'pulse'] },
    explosive: { explosive: true }, volatile: { explosive: true }, exploding: { explosive: true }, kamikaze: { b: ['chase'], kamikaze: true, explosive: true },
    sticky: { sticky: true }, slimy: { sticky: true, tint: '#7ccf6b' }, slippery: { slip: true }, magnetic: { b: ['magnet'] },
    spiky: { dmg: 1, spiky: true }, thorny: { dmg: 1 }, armored: { hp: 3, tint: '#9aa7b4' }, armoured: { hp: 3, tint: '#9aa7b4' },
    tough: { hp: 2.5 }, strong: { hp: 2, dmg: 1 }, tanky: { hp: 4, speed: 0.8 }, sturdy: { hp: 2.5 }, durable: { hp: 3 },
    fragile: { hpSet: 1 }, weak: { hpSet: 1, speed: 0.8 }, frail: { hpSet: 1 }, immortal: { invulnerable: true },
    invincible: { invulnerable: true }, indestructible: { invulnerable: true }, unkillable: { invulnerable: true },
    teleporting: { b: ['warp'] }, blinking: { b: ['warp'] }, multiplying: { multiply: true }, replicating: { multiply: true },
    splitting: { split: true }, dancing: { fx: ['dance', 'rainbow'] }, disco: { fx: ['dance', 'rainbow'] }, singing: { fx: ['music'] },
    musical: { fx: ['music'] }, spinning: { fx: ['spin'] }, rotating: { fx: ['spin'] }, wobbly: { fx: ['wobble'] },
    jiggly: { fx: ['wobble'] }, rainbow: { fx: ['rainbow'] }, neon: { fx: ['glow'], neon: true }, pixel: { shape: 'square' },
    pixelated: { shape: 'square' }, square: { shape: 'square' }, round: { shape: 'circle' }, triangular: { shape: 'triangle' },
    blocky: { shape: 'square' }, homing: { homing: true }, ancient: { speed: 0.7, hp: 2 }, elder: { size: 1.6, hp: 3 },
    old: { speed: 0.7 }, young: { size: 0.8, speed: 1.1 }, mutant: { size: 1.3, hp: 2, tint: '#7ccf6b' }, alpha: { size: 1.5, hp: 3, boss: true },
    royal: { tint: '#f2c94c' }, legendary: { size: 1.8, hp: 5, fx: ['glow'], boss: true }, epic: { size: 1.5, hp: 3, fx: ['glow'] },
    boss: { size: 2.6, hp: 8, boss: true }, king: { size: 2, hp: 6, boss: true }, queen: { size: 2, hp: 6, boss: true }, lord: { size: 1.8, hp: 5, boss: true },
    rare: { fx: ['sparkle'], pts: 3 }, valuable: { pts: 3 }, precious: { pts: 4, fx: ['sparkle'] },
    // elements
    fire: { element: 'fire' }, fiery: { element: 'fire' }, flaming: { element: 'fire' }, burning: { element: 'fire' }, lava: { element: 'fire' },
    magma: { element: 'fire' }, molten: { element: 'fire' }, hot: { element: 'fire' }, ice: { element: 'ice' }, icy: { element: 'ice' },
    frozen: { element: 'ice' }, frost: { element: 'ice' }, snow: { element: 'ice' }, cold: { element: 'ice' }, poison: { element: 'poison' },
    poisonous: { element: 'poison' }, toxic: { element: 'poison' }, venomous: { element: 'poison' }, radioactive: { element: 'poison', fx: ['glow'] },
    acid: { element: 'poison' }, acidic: { element: 'poison' }, electric: { element: 'electric' }, shock: { element: 'electric' },
    thunder: { element: 'electric' }, lightning: { element: 'electric' }, shadow: { element: 'shadow' }, dark: { element: 'shadow' },
    void: { element: 'shadow' }, holy: { element: 'holy' }, light: { element: 'holy' }, divine: { element: 'holy' }, metal: { element: 'metal' },
    metallic: { element: 'metal' }, steel: { element: 'metal' }, iron: { element: 'metal' }, robotic: { element: 'metal' },
    mechanical: { element: 'metal' }, cyber: { element: 'metal', fx: ['glow'] }, mecha: { element: 'metal', size: 1.6 }, crystal: { element: 'crystal' },
    zombie: { tint: '#86b064', b: ['chase'], speed: 0.7, team: 'enemy' }, undead: { tint: '#86b064', b: ['chase'], team: 'enemy' },
    space: { fly: true }, pirate: { tint: '#5a4a3a' }, ninja: { speed: 1.5, alpha: 0.8 }, water: { element: 'water' }, aquatic: { element: 'water' },
  };

  L.elements = {
    fire: { tint: '#f0672d', fx: ['glow', 'embers'], proj: 'fireball', dmg: 1 },
    ice: { tint: '#9fd4f5', fx: ['glow'], proj: 'snowball', freeze: true },
    poison: { tint: '#82d14a', fx: ['glow'], proj: 'acid', aura: true },
    electric: { tint: '#f5d547', fx: ['glow', 'flicker'], proj: 'lightning_bolt', speed: 1.3 },
    shadow: { tint: '#5a3d7a', fx: ['flicker'], alpha: 0.75, proj: 'magic' },
    holy: { tint: '#fff3c4', fx: ['glow'], proj: 'magic' },
    metal: { tint: '#a6b0bb', hp: 2, proj: 'bullet' },
    crystal: { tint: '#8fe3f0', fx: ['sparkle'], hp: 1.5, proj: 'ice' },
    water: { tint: '#5dade2', proj: 'water' },
  };

  // ---------------------------------------------------------------------------
  // Palettes
  // ---------------------------------------------------------------------------
  L.palettes = {
    ember: { bg: '#16120f', bg2: '#221a15', wall: '#3a2e26', wallTop: '#5b4637', deco: '#2a211b', accent: '#e07b53', text: '#f1e6d6', player: '#f2c46d', shadow: 'rgba(0,0,0,0.35)', tint: '#e07b53' },
    neon: { bg: '#0b0618', bg2: '#170c2e', wall: '#2a1550', wallTop: '#ff3fb4', deco: '#1d1040', accent: '#29f0ff', text: '#f5ecff', player: '#29f0ff', shadow: 'rgba(0,0,0,0.5)', tint: '#ff3fb4' },
    pastel: { bg: '#f6efe9', bg2: '#efe2f2', wall: '#c9b8e6', wallTop: '#e4d8f7', deco: '#e8dcef', accent: '#ff9fb2', text: '#4a3f55', player: '#ff9fb2', shadow: 'rgba(90,60,110,0.18)', tint: '#b8a1e3' },
    forest: { bg: '#121a12', bg2: '#1b2a1b', wall: '#2f4a2c', wallTop: '#4f7a45', deco: '#1f301e', accent: '#a7d36b', text: '#e8f0dc', player: '#f2c46d', shadow: 'rgba(0,0,0,0.35)', tint: '#a7d36b' },
    ocean: { bg: '#071a2b', bg2: '#0c2d47', wall: '#1d4e6b', wallTop: '#3f8fb5', deco: '#0f3550', accent: '#5fe0d8', text: '#e2f6fb', player: '#ffd166', shadow: 'rgba(0,0,0,0.35)', tint: '#5fe0d8' },
    space: { bg: '#05060f', bg2: '#0d1030', wall: '#242a55', wallTop: '#4d58a8', deco: '#12163a', accent: '#8f9bff', text: '#e6e9ff', player: '#e6e9ff', shadow: 'rgba(0,0,0,0.5)', tint: '#8f9bff' },
    desert: { bg: '#2b1d12', bg2: '#4a321d', wall: '#9a6b3d', wallTop: '#d49a5b', deco: '#5c3f24', accent: '#f2c46d', text: '#fbf0dc', player: '#7ec4cf', shadow: 'rgba(60,30,10,0.35)', tint: '#e8a35b' },
    snow: { bg: '#dfe9f2', bg2: '#c8d9e8', wall: '#8aa6bf', wallTop: '#f4f8fb', deco: '#cfdeea', accent: '#4f8ef0', text: '#1f3346', player: '#e5484d', shadow: 'rgba(30,60,90,0.18)', tint: '#4f8ef0' },
    hell: { bg: '#170605', bg2: '#2e0b07', wall: '#4a1410', wallTop: '#a8321f', deco: '#2a0d0a', accent: '#ff6a2a', text: '#ffe6d6', player: '#ffd166', shadow: 'rgba(0,0,0,0.5)', tint: '#ff6a2a' },
    candy: { bg: '#ffe3f1', bg2: '#ffd1e8', wall: '#ff8fc7', wallTop: '#fff0a8', deco: '#ffc4e0', accent: '#7ad7f0', text: '#5a2448', player: '#7ad7f0', shadow: 'rgba(150,40,100,0.18)', tint: '#ff8fc7' },
    gameboy: { bg: '#0f380f', bg2: '#306230', wall: '#306230', wallTop: '#8bac0f', deco: '#1d4a1d', accent: '#9bbc0f', text: '#9bbc0f', player: '#9bbc0f', shadow: 'rgba(0,0,0,0.3)', tint: '#8bac0f', mono: true },
    noir: { bg: '#0c0c0c', bg2: '#1a1a1a', wall: '#2e2e2e', wallTop: '#5a5a5a', deco: '#1e1e1e', accent: '#e8e8e8', text: '#f0f0f0', player: '#f0f0f0', shadow: 'rgba(0,0,0,0.55)', tint: '#bbbbbb', gray: true },
    sunset: { bg: '#2a1230', bg2: '#5a2140', wall: '#7a2f4a', wallTop: '#f2846b', deco: '#3f1838', accent: '#ffb86b', text: '#fff0e0', player: '#ffd166', shadow: 'rgba(30,0,20,0.4)', tint: '#f2846b' },
    cyber: { bg: '#05080d', bg2: '#0a1622', wall: '#0f2a3a', wallTop: '#00e0ff', deco: '#0b1b28', accent: '#ff2e88', text: '#d8f7ff', player: '#ff2e88', shadow: 'rgba(0,0,0,0.5)', tint: '#00e0ff' },
    vapor: { bg: '#1a0b2e', bg2: '#2d1458', wall: '#5b2a86', wallTop: '#ff71ce', deco: '#24104a', accent: '#01cdfe', text: '#fff6fb', player: '#05ffa1', shadow: 'rgba(0,0,0,0.4)', tint: '#ff71ce' },
    sky: { bg: '#8fc7ea', bg2: '#cfe9f7', wall: '#5a8a4a', wallTop: '#8fcf6b', deco: '#b7dcf2', accent: '#ffd166', text: '#1d3a52', player: '#ff8a5b', shadow: 'rgba(20,50,80,0.2)', tint: '#ffd166' },
    dungeon: { bg: '#121014', bg2: '#1d1a20', wall: '#3a3540', wallTop: '#6a6272', deco: '#24202a', accent: '#e0b85a', text: '#ece6f2', player: '#f2c46d', shadow: 'rgba(0,0,0,0.45)', tint: '#e0b85a' },
    retro: { bg: '#1d2b53', bg2: '#29366f', wall: '#7e2553', wallTop: '#ff004d', deco: '#232f5f', accent: '#ffec27', text: '#fff1e8', player: '#ffa300', shadow: 'rgba(0,0,0,0.4)', tint: '#00e436' },
    mono: { bg: '#f4f1ea', bg2: '#e6e1d6', wall: '#1c1b1f', wallTop: '#3a383e', deco: '#dcd6c8', accent: '#1c1b1f', text: '#1c1b1f', player: '#1c1b1f', shadow: 'rgba(0,0,0,0.12)', tint: '#1c1b1f', gray: true },
    blood: { bg: '#100406', bg2: '#22080c', wall: '#3d0d14', wallTop: '#8a1622', deco: '#1d0609', accent: '#ff3b4a', text: '#ffe1e1', player: '#ffd166', shadow: 'rgba(0,0,0,0.5)', tint: '#ff3b4a' },
    jungle: { bg: '#0d1a0f', bg2: '#16301a', wall: '#2c5a2a', wallTop: '#6fae4f', deco: '#173a1b', accent: '#ffcf4a', text: '#e8f6dc', player: '#ff8a5b', shadow: 'rgba(0,0,0,0.38)', tint: '#6fae4f' },
    spooky: { bg: '#0e0b14', bg2: '#1c1526', wall: '#2e2440', wallTop: '#6b4f8a', deco: '#1a1424', accent: '#ff9a3c', text: '#efe6ff', player: '#ff9a3c', shadow: 'rgba(0,0,0,0.5)', tint: '#9b6bd1' },
  };
  L.paletteSynonyms = {
    warm: 'ember', default: 'ember', cozy: 'ember', synthwave: 'vapor', vaporwave: 'vapor', outrun: 'vapor', retrowave: 'vapor',
    cyberpunk: 'cyber', tron: 'cyber', matrix: 'gameboy', 'game boy': 'gameboy', '8bit': 'retro', '8-bit': 'retro', pico: 'retro',
    'black and white': 'noir', grayscale: 'noir', greyscale: 'noir', monochrome: 'mono', minimal: 'mono', minimalist: 'mono',
    paper: 'mono', ink: 'mono', bubblegum: 'candy', sweet: 'candy', cute: 'pastel', soft: 'pastel', kawaii: 'pastel',
    underwater: 'ocean', sea: 'ocean', aqua: 'ocean', woods: 'forest', nature: 'forest', green: 'forest', arctic: 'snow',
    winter: 'snow', icy: 'snow', infernal: 'hell', lava: 'hell', volcanic: 'hell', fire: 'hell', dusk: 'sunset', evening: 'sunset',
    cosmic: 'space', galaxy: 'space', night: 'space', sand: 'desert', western: 'desert', daytime: 'sky', bright: 'sky',
    gothic: 'spooky', halloween: 'spooky', haunted: 'spooky', horror: 'blood', gore: 'blood', crypt: 'dungeon', cave: 'dungeon',
    tropical: 'jungle', rainforest: 'jungle',
  };

  // ---------------------------------------------------------------------------
  // Themes: setting packages
  // ---------------------------------------------------------------------------
  L.themes = {
    space: { palette: 'space', bg: 'stars', fx: [], enemy: 'alien', item: 'star', boss: 'mothership', obstacle: 'asteroid', npc: 'astronaut', music: 'dreamy', gravity: 0.35, words: ['space', 'outer space', 'galaxy', 'cosmos', 'cosmic', 'the stars', 'the moon', 'mars', 'orbit', 'sci-fi', 'scifi', 'starship'] },
    ocean: { palette: 'ocean', bg: 'ocean', fx: ['bubbles'], enemy: 'shark', item: 'pearl', boss: 'kraken', obstacle: 'rock', npc: 'mermaid', music: 'dreamy', gravity: 0.45, words: ['ocean', 'underwater', 'under water', 'the sea', 'sea', 'deep sea', 'aquatic', 'reef', 'coral reef', 'atlantis', 'beach'] },
    forest: { palette: 'forest', bg: 'forest', fx: ['fireflies'], enemy: 'wolf', item: 'mushroom', boss: 'bear', obstacle: 'tree', npc: 'elf', music: 'chill', words: ['forest', 'woods', 'the woods', 'woodland', 'grove', 'nature', 'enchanted forest'] },
    jungle: { palette: 'jungle', bg: 'forest', fx: ['leaves'], enemy: 'snake', item: 'banana', boss: 'trex', obstacle: 'palm', npc: 'monkey', music: 'happy', words: ['jungle', 'rainforest', 'tropical', 'tropics', 'safari', 'prehistoric', 'dinosaur world'] },
    desert: { palette: 'desert', bg: 'dunes', fx: ['dust'], enemy: 'scorpion', item: 'gem', boss: 'minotaur', obstacle: 'cactus', npc: 'merchant', music: 'chill', words: ['desert', 'sahara', 'egypt', 'pyramid', 'pyramids', 'dunes', 'wild west', 'western', 'wasteland'] },
    snow: { palette: 'snow', bg: 'snow', fx: ['snow'], enemy: 'yeti', item: 'snowflake', boss: 'yeti', obstacle: 'pine', npc: 'snowman', music: 'dreamy', words: ['snow', 'winter', 'arctic', 'antarctica', 'tundra', 'ice world', 'frozen', 'north pole', 'christmas', 'xmas', 'holiday', 'mountain'] },
    hell: { palette: 'hell', bg: 'hell', fx: ['embers'], enemy: 'demon', item: 'crystal', boss: 'dragon', obstacle: 'fire', npc: 'imp', music: 'intense', words: ['hell', 'underworld', 'inferno', 'volcano', 'lava world', 'fire world', 'the abyss', 'nether'] },
    city: { palette: 'cyber', bg: 'city', fx: ['rain'], enemy: 'robot', item: 'battery', boss: 'mech', obstacle: 'car', npc: 'person', music: 'intense', words: ['city', 'cyberpunk', 'neon city', 'downtown', 'metropolis', 'streets', 'the future', 'futuristic', 'tokyo', 'new york'] },
    spooky: { palette: 'spooky', bg: 'graveyard', fx: ['fog', 'darkness'], enemy: 'ghost', item: 'candy', boss: 'vampire', obstacle: 'grave', npc: 'witch', music: 'spooky', words: ['haunted', 'spooky', 'halloween', 'graveyard', 'cemetery', 'haunted house', 'horror', 'creepy', 'scary', 'nightmare', 'mansion'] },
    dungeon: { palette: 'dungeon', bg: 'void', fx: ['darkness'], enemy: 'skeleton', item: 'treasure_chest', boss: 'minotaur', obstacle: 'pillar', npc: 'knight', music: 'spooky', words: ['dungeon', 'crypt', 'catacombs', 'cave', 'caves', 'cavern', 'mine', 'labyrinth', 'underground', 'tomb'] },
    fantasy: { palette: 'forest', bg: 'mountains', fx: ['fireflies'], enemy: 'goblin', item: 'gem', boss: 'dragon', obstacle: 'tree', npc: 'wizard', music: 'epic', words: ['fantasy', 'medieval', 'kingdom', 'castle', 'magic', 'magical', 'fairy tale', 'fairytale', 'middle earth'] },
    candy: { palette: 'candy', bg: 'clouds', fx: ['sparkles'], enemy: 'slime', item: 'candy', boss: 'pumpkin', obstacle: 'cake', npc: 'fairy', music: 'happy', words: ['candy', 'candyland', 'candy land', 'sweets', 'dessert', 'sugar', 'bubblegum', 'cake world'] },
    retro: { palette: 'retro', bg: 'grid', fx: ['scanlines'], enemy: 'alien', item: 'coin', boss: 'ufo', obstacle: 'block', npc: 'robot', music: 'retro', words: ['retro', 'arcade', '8-bit', '8 bit', '8bit', 'pixel art', 'old school', 'oldschool', 'classic arcade', '80s', 'eighties'] },
    synthwave: { palette: 'vapor', bg: 'synthwave', fx: ['glow'], enemy: 'drone', item: 'gem', boss: 'mothership', obstacle: 'pillar', npc: 'dj', music: 'retro', words: ['synthwave', 'vaporwave', 'outrun', 'retrowave', 'neon', 'miami'] },
    sky: { palette: 'sky', bg: 'clouds', fx: [], enemy: 'bird', item: 'star', boss: 'dragon', obstacle: 'cloud', npc: 'angel', music: 'happy', words: ['sky', 'the sky', 'clouds', 'heaven', 'sky islands', 'floating islands', 'above the clouds'] },
    farm: { palette: 'sky', bg: 'hills', fx: [], enemy: 'goose', item: 'carrot', boss: 'scarecrow', obstacle: 'bush', npc: 'farmer', music: 'happy', words: ['farm', 'farmland', 'countryside', 'barn', 'village', 'ranch'] },
    lab: { palette: 'cyber', bg: 'grid', fx: [], enemy: 'virus', item: 'battery', boss: 'robot', obstacle: 'block', npc: 'scientist', music: 'intense', words: ['lab', 'laboratory', 'science', 'inside a computer', 'computer', 'cyberspace', 'the internet', 'matrix', 'microscopic', 'inside the body'] },
    pirate: { palette: 'ocean', bg: 'ocean', fx: [], enemy: 'pirate', item: 'treasure', boss: 'kraken', obstacle: 'barrel', npc: 'parrot', music: 'epic', words: ['pirate', 'pirates', 'pirate ship', 'high seas', 'caribbean', 'treasure island', 'island'] },
  };

  // Genres -> keywords (matched as phrases)
  L.genres = {
    platformer: ['platformer', 'platform game', 'platforming', 'side scroller', 'sidescroller', 'side-scroller', 'side scrolling', 'metroidvania', 'jump and run', 'jump n run', 'mario'],
    shooter: ['shooter', 'twin stick', 'twin-stick', 'arena shooter', 'top down shooter', 'top-down shooter', 'shoot em up', 'shoot \'em up', 'gun game', 'fps'],
    shmup: ['space shooter', 'shmup', 'vertical shooter', 'scrolling shooter', 'space invaders', 'galaga', 'galaxian'],
    bullethell: ['bullet hell', 'bullet-hell', 'danmaku', 'touhou'],
    asteroids: ['asteroids', 'asteroid game', 'space rocks'],
    snake: ['snake game', 'like snake', 'snake clone', 'game of snake', 'classic snake', 'nokia snake', 'slither'],
    runner: ['runner', 'endless runner', 'infinite runner', 'auto runner', 'autorunner', 'auto-runner', 'endless run', 'temple run', 'subway surfers', 'dino game', 'chrome dino'],
    flappy: ['flappy', 'flappy bird', 'flapping game', 'flap game'],
    maze: ['maze', 'labyrinth', 'maze game', 'pac-man', 'pacman', 'pac man'],
    dungeon: ['dungeon crawler', 'roguelike', 'rogue-like', 'roguelite', 'rogue-lite', 'dungeon game', 'hack and slash', 'zelda', 'diablo'],
    survival: ['survival', 'survival game', 'zombie survival', 'horde mode', 'wave survival', 'survive the night', 'survivors', 'vampire survivors', 'survivor game', 'tower defense'],
    breakout: ['breakout', 'brick breaker', 'arkanoid', 'block breaker', 'brick game'],
    racing: ['racing', 'racing game', 'race game', 'racer', 'kart', 'driving game', 'race car game', 'time trial'],
    stealth: ['stealth', 'stealth game', 'sneaking game', 'heist', 'metal gear', 'sneak past'],
    defense: ['defend the', 'defense game', 'base defense', 'protect the core', 'defend my', 'tower defence'],
    rpg: ['rpg', 'role playing', 'role-playing', 'adventure game', 'quest game', 'open world', 'jrpg'],
    soccer: ['soccer', 'football game', 'sports game', 'play football', 'play soccer', 'hockey', 'ball game'],
    topdown: ['top down', 'top-down', 'topdown', 'overhead view', 'birds eye', 'bird\'s eye'],
    pong: ['pong', 'paddle game', 'ping pong', 'table tennis', 'air hockey'],
  };

  L.numberWords = {
    zero: 0, none: 0, one: 1, a: 1, an: 1, single: 1, two: 2, couple: 2, 'a couple of': 2, 'a couple': 2, pair: 2, 'a pair of': 2,
    three: 3, few: 3, 'a few': 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    dozen: 12, 'a dozen': 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, 'a hundred': 100,
    'one hundred': 100, hundreds: 150, thousand: 1000, 'a thousand': 1000, thousands: 1500, million: 100000, 'a million': 100000,
    some: 4, several: 5, many: 10, lots: 12, 'lots of': 12, 'a lot of': 12, 'a bunch of': 8, bunch: 8, tons: 25, 'tons of': 25,
    loads: 20, 'loads of': 20, plenty: 12, 'plenty of': 12, dozens: 30, 'dozens of': 30, horde: 18, 'a horde of': 18,
    hordes: 30, swarm: 16, 'a swarm of': 16, army: 24, 'an army of': 24, flock: 10, 'a flock of': 10, pack: 6, 'a pack of': 6,
    herd: 8, 'a herd of': 8, gang: 5, 'a gang of': 5, crowd: 15, 'a crowd of': 15, family: 4, 'a family of': 4,
    infinite: 300, endless: 300, countless: 200, 'way too many': 400, 'too many': 200,
  };

  // Emoji glyphs for unknown-but-common nouns (no special behavior)
  L.extraGlyphs = {
    taco: '🌮', sushi: '🍣', ramen: '🍜', noodle: '🍜', hotdog: '🌭', 'hot dog': '🌭', fries: '🍟', popcorn: '🍿', avocado: '🥑',
    broccoli: '🥦', potato: '🥔', tomato: '🍅', corn: '🌽', pepper: '🌶️', onion: '🧅', garlic: '🧄', bacon: '🥓', steak: '🥩',
    sandwich: '🥪', burrito: '🌯', pancake: '🥞', waffle: '🧇', croissant: '🥐', pretzel: '🥨', milk: '🥛', juice: '🧃', tea: '🍵',
    soda: '🥤', wine: '🍷', beer: '🍺', bottle: '🍾', guitar: '🎸', drum: '🥁', piano: '🎹', trumpet: '🎺', violin: '🎻', microphone: '🎤',
    phone: '📱', camera: '📷', lamp: '💡', bulb: '💡', candle: '🕯️', umbrella: '☂️', hat: '🎩', glasses: '👓', shoe: '👟', boot: '👢',
    shirt: '👕', dress: '👗', bag: '👜', backpack: '🎒', anchor: '⚓', compass: '🧭', map: '🗺️', globe: '🌍', planet: '🪐', earth: '🌍',
    rainbow: '🌈', volcano: '🌋', mountain: '⛰️', island: '🏝️', tent: '⛺', church: '⛪', factory: '🏭', hospital: '🏥', school: '🏫',
    bank: '🏦', hotel: '🏨', stadium: '🏟️', bridge: '🌉', robot_arm: '🦾', brain: '🧠', tooth: '🦷', skull: '💀', eye: '👁️', hand: '✋',
    lips: '👄', nose: '👃', ear: '👂', toilet: '🚽', bathtub: '🛁', chair: '🪑', couch: '🛋️', door: '🚪', window: '🪟', mirror: '🪞',
    broom: '🧹', bucket: '🪣', sponge: '🧽', soap: '🧼', toothbrush: '🪥', scissors: '✂️', pencil: '✏️', pen: '🖊️', crayon: '🖍️',
    paintbrush: '🖌️', hammer: '🔨', wrench: '🔧', screwdriver: '🪛', nail: '📌', pin: '📌', paperclip: '📎', lock: '🔒', bell: '🔔',
    trophy: '🏆', medal: '🏅', ticket: '🎫', dice: '🎲', die: '🎲', puzzle: '🧩', teddy: '🧸', 'teddy bear': '🧸', doll: '🪆', kite: '🪁',
    yoyo: '🪀', joystick: '🕹️', controller: '🎮', gamepad: '🎮', cd: '💿', floppy: '💾', battery: '🔋', plug: '🔌', satellite: '🛰️',
    telescope: '🔭', microscope: '🔬', dna: '🧬', pill: '💊', syringe: '💉', bandage: '🩹', thermometer: '🌡️', tornado: '🌪️',
    snowman: '⛄', comet: '☄️', wave: '🌊', droplet: '💧', ninja: '🥷', mermaid: '🧜', genie: '🧞', troll: '🧌', zombie: '🧟',
    lobster: '🦞', shrimp: '🦐', oyster: '🦪', swan: '🦢', peacock: '🦚', dodo: '🦤', bison: '🦬', mammoth: '🦣', beaver: '🦫',
    otter: '🦦', skunk: '🦨', kangaroo: '🦘', badger: '🦡', camel: '🐫', zebra: '🦓', rhino: '🦏', hippo: '🦛', gorilla: '🦍',
    orangutan: '🦧', boar: '🐗', goat: '🐐', ram: '🐏', turkey: '🦃', peanut: '🥜', chestnut: '🌰', coconut: '🥥', kiwi: '🥝',
    pineapple: '🍍', mango: '🥭', blueberry: '🫐', olive: '🫒', bell_pepper: '🫑', cucumber: '🥒', eggplant: '🍆', lettuce: '🥬',
    toast: '🍞', bagel: '🥯', dumpling: '🥟', fortune_cookie: '🥠', lobster_roll: '🦞', sock: '🧦', glove: '🧤', scarf: '🧣',
    crown: '👑', lipstick: '💄', ring: '💍', gem: '💎', moai: '🗿', robot: '🤖', alien: '👽', clown: '🤡', ogre: '👹', goblin: '👺',
    poop: '💩', ghost: '👻', skull_and_bones: '☠️', cyclops: '👁️', lawyer: '🧑‍⚖️', judge: '🧑‍⚖️', pilot: '🧑‍✈️', firefighter: '🧑‍🚒',
    mechanic: '🧑‍🔧', singer: '🧑‍🎤', student: '🧑‍🎓', worker: '👷', builder: '👷', construction_worker: '👷', prince: '🤴',
    mage: '🧙', vampire: '🧛', zombie_dog: '🐕', unicorn: '🦄', bat: '🦇', owl: '🦉', eagle: '🦅', dove: '🕊️', rooster: '🐓',
    banana: '🍌', cookie: '🍪', sloth: '🦥', dragon: '🐉', sauropod: '🦕', brontosaurus: '🦕', dinosaur: '🦖', shark: '🦈',
    taxi: '🚕', ambulance: '🚑', firetruck: '🚒', 'fire truck': '🚒', tractor: '🚜', police_car: '🚓', tram: '🚋', ship: '🚢',
    canoe: '🛶', parachute: '🪂', skis: '🎿', sled: '🛷', trophy_cup: '🏆', dumbbell: '🏋️', basketball: '🏀', football: '🏈',
    baseball: '⚾', tennis: '🎾', volleyball: '🏐', bowling: '🎳', golf: '⛳', boxing: '🥊', target: '🎯', bullseye: '🎯',
    money_bag: '💰', credit_card: '💳', receipt: '🧾', envelope: '✉️', mailbox: '📫', newspaper: '📰', calendar: '📅',
    clipboard: '📋', trash: '🗑️', 'trash can': '🗑️', garbage: '🗑️', recycle: '♻️', stopwatch: '⏱️', hourglass: '⌛', sun: '☀️',
    star: '⭐', cloud: '☁️', fog: '🌫️', snowflake: '❄️', fire: '🔥', water: '💧', leaf: '🍂', seedling: '🌱', herb: '🌿',
    clover: '🍀', cactus: '🌵', mushroom: '🍄', cherry_blossom: '🌸', bouquet: '💐', lotus: '🪷', coral: '🪸', rock: '🪨',
    wood: '🪵', log: '🪵', feather: '🪶', nest: '🪹', web: '🕸️', cobweb: '🕸️', bone: '🦴', tooth_fairy: '🧚', angel: '👼',
    elf: '🧝', santa: '🎅', mrs_claus: '🤶', superhero: '🦸', supervillain: '🦹', mummy: '🧟', yeti: '❄️', bigfoot: '🦍',
    sasquatch: '🦍', kraken: '🐙', godzilla: '🦖', toaster: '🍞', fridge: '🧊', microwave: '📦', vending_machine: '🏧',
    atm: '🏧', robot_vacuum: '🤖', drone: '🛸', rocketship: '🚀', bomb: '💣', firework: '🎆', fireworks: '🎆', sparkler: '🎇',
    balloon: '🎈', confetti: '🎊', party: '🎉', pinata: '🪅', mask: '🎭', theater: '🎭', palette: '🎨', crystal_ball: '🔮',
    magic_wand: '🪄', potion: '🧪', amulet: '🧿', nazar: '🧿', hamsa: '🪬', scroll: '📜', candle_light: '🕯️', lantern: '🏮',
    flashlight: '🔦', torch: '🔥', axe: '🪓', pickaxe: '⛏️', shovel: '🪏', bow_and_arrow: '🏹', shield: '🛡️', boomerang: '🪃',
    slingshot: '🪃', crossbow: '🏹', cannon: '💥', explosion: '💥', boom: '💥', zap: '⚡', sparkle: '✨', heart: '❤️',
    broken_heart: '💔', love: '💕', kiss: '💋', hug: '🫂', baby_bottle: '🍼', lollipop: '🍭', donut: '🍩', mochi: '🍡',
    dango: '🍡', bubble_tea: '🧋', boba: '🧋', mate: '🧉', ice: '🧊', salt: '🧂', butter: '🧈', waffles: '🧇', falafel: '🧆',
    tamale: '🫔', fondue: '🫕', jar: '🫙', beans: '🫘', ginger: '🫚', pea: '🫛', hyacinth: '🪻', jellyfish: '🪼', moose: '🫎',
    donkey: '🫏', wing: '🪽', goose: '🪿', hair_pick: '🪮', maracas: '🪇', flute: '🪈', wireless: '🛜', khanda: '🪯',
  };

  L.stopwords = new Set(('the a an some any of to in on at for with by from into onto and or but so as is are be been being was were ' +
    'that which who whom whose this these those it its they them their there here my me i you your we our us he she him her ' +
    'his hers do does did can could would should will shall may might must just really very quite also too more most less ' +
    'please pls plz now then than like such kind sort type lot lots bunch new random extra additional another other little ' +
    'game level world screen thing things stuff around about way all every each').split(' '));

  // Lookup helpers ------------------------------------------------------------
  const ENTRY_CACHE = {};
  function expand(key) {
    if (ENTRY_CACHE[key]) return ENTRY_CACHE[key];
    const raw = N[key];
    if (!raw) return null;
    const [glyph, role, p] = raw;
    const e = Object.assign({ key, glyph, role }, p || {});
    ENTRY_CACHE[key] = e;
    return e;
  }
  L.noun = expand;
  L.nounKeys = () => Object.keys(N);

  L.singular = function (w) {
    if (N[w] || L.synonyms[w]) return w;
    const irregular = { mice: 'mouse', geese: 'goose', people: 'person', men: 'man', women: 'woman', children: 'child', teeth: 'tooth', feet: 'foot', cacti: 'cactus', wolves: 'wolf', leaves: 'leaf', knives: 'knife', elves: 'elf', thieves: 'thief', loaves: 'bread', dwarves: 'dwarf', octopi: 'octopus', fungi: 'fungus', cherries: 'cherry', ponies: 'pony', ladies: 'lady', puppies: 'puppy', bunnies: 'bunny', kitties: 'kitty', berries: 'berry', candies: 'candy', enemies: 'enemy', zombies: 'zombie', ghosties: 'ghost', butterflies: 'butterfly', fairies: 'fairy', flies: 'fly', spies: 'spy', guppies: 'guppy' };
    if (irregular[w]) return irregular[w];
    if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
    if (/(ches|shes|xes|sses|zzes)$/.test(w)) return w.slice(0, -2);
    if (/oes$/.test(w) && w.length > 4) return w.slice(0, -2);
    if (/ves$/.test(w)) { const f = w.slice(0, -3) + 'f'; if (N[f]) return f; const fe = w.slice(0, -3) + 'fe'; if (N[fe]) return fe; }
    if (/[^s]s$/.test(w) && w.length > 3) return w.slice(0, -1);
    return w;
  };

  // Resolve a word (or compound) to a noun key. Returns {key, entry, fuzzy}
  L.findNoun = function (word) {
    if (!word) return null;
    word = word.toLowerCase().trim();
    if (L.compounds[word]) return { key: L.compounds[word], entry: expand(L.compounds[word]) };
    const w1 = word.replace(/\s+/g, '_');
    if (N[w1]) return { key: w1, entry: expand(w1) };
    if (L.synonyms[word]) return { key: L.synonyms[word], entry: expand(L.synonyms[word]) };
    const s = L.singular(word);
    if (N[s]) return { key: s, entry: expand(s) };
    if (L.synonyms[s]) return { key: L.synonyms[s], entry: expand(L.synonyms[s]) };
    if (word.length >= 5) {
      // typo tolerance
      let best = null, bestD = 2;
      for (const k of Object.keys(N)) {
        if (Math.abs(k.length - s.length) > 1) continue;
        const d = U.levenshtein(s, k);
        if (d < bestD) { best = k; bestD = d; }
      }
      if (best && bestD <= 1) return { key: best, entry: expand(best), fuzzy: true };
    }
    return null;
  };

  L.findProjectile = function (phrase) {
    if (!phrase) return null;
    phrase = phrase.toLowerCase().trim().replace(/^(a|an|the|some|giant|big|tiny|little|small|huge)\s+/, '');
    if (L.projectiles[phrase]) return phrase;
    if (L.projectileSynonyms[phrase]) return L.projectileSynonyms[phrase];
    const s = L.singular(phrase);
    if (L.projectiles[s]) return s;
    if (L.projectileSynonyms[s]) return L.projectileSynonyms[s];
    const last = phrase.split(/\s+/).pop();
    if (L.projectiles[last]) return last;
    if (L.projectileSynonyms[last]) return L.projectileSynonyms[last];
    const ls = L.singular(last);
    if (L.projectiles[ls]) return ls;
    return null;
  };

  L.glyphFor = function (word) {
    if (!word) return null;
    const w = word.toLowerCase();
    const n = L.findNoun(w);
    if (n && n.entry && n.entry.glyph) return n.entry.glyph;
    const s = L.singular(w);
    return L.extraGlyphs[w] || L.extraGlyphs[s] || L.extraGlyphs[w.replace(/\s+/g, '_')] || null;
  };

  L.color = function (word) {
    if (!word) return null;
    word = word.toLowerCase();
    if (L.colors[word]) return L.colors[word];
    if (/^#[0-9a-f]{3,8}$/i.test(word)) return word;
    return null;
  };

  L.palette = function (name) {
    if (!name) return L.palettes.ember;
    if (typeof name === 'object') return Object.assign({}, L.palettes.ember, name);
    return L.palettes[name] || L.palettes[L.paletteSynonyms[name]] || L.palettes.ember;
  };

  L.findTheme = function (text) {
    let best = null, bestLen = 0;
    for (const [key, th] of Object.entries(L.themes)) {
      for (const w of th.words) {
        const re = new RegExp('\\b' + w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b');
        if (re.test(text) && w.length > bestLen) { best = key; bestLen = w.length; }
      }
    }
    return best;
  };

  L.findGenre = function (text) {
    let best = null, bestLen = 0;
    for (const [key, words] of Object.entries(L.genres)) {
      for (const w of words) {
        const re = new RegExp('\\b' + w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b');
        if (re.test(text) && w.length > bestLen) { best = key; bestLen = w.length; }
      }
    }
    return best;
  };

  // Fun NPC dialogue pools
  L.lines = {
    wizard: ['The coins... they whisper to me.', 'I once cast fireball indoors. Never again.', 'You look like someone who reads patch notes.', 'Magic is just code nobody documented.', 'Beware the semicolons of the east.'],
    villager: ['Nice weather for an apocalypse.', 'Have you tried turning the world off and on again?', 'I live here. Allegedly.', 'My crops keep despawning.'],
    merchant: ['Wares! I have wares!', 'Everything must go. Including me, eventually.', 'No refunds on cursed items.'],
    knight: ['For glory! Or a snack.', 'My armor is mostly vibes.', 'I swore an oath to stand right here.'],
    king: ['Bow before me. Or don\'t. I\'m not your dad.', 'The kingdom is in your hands. Please wash them.'],
    princess: ['I rescued myself, thanks.', 'The dragon was actually pretty chill.'],
    robot: ['BEEP. FRIENDSHIP PROTOCOL ENGAGED.', 'I AM 87% SURE I AM ALIVE.', 'ERROR 418: I AM A TEAPOT.'],
    ghost: ['Boo. Sorry, force of habit.', 'I haunt this level. It\'s a living.'],
    duck: ['Quack.', 'Have you tried explaining your bug to me?', 'Quack quack. (It\'s probably an off-by-one.)'],
    rubber_duck: ['Quack.', 'Explain the bug to me, slowly.', 'Have you checked the semicolons?', 'Quack. (Did you try restarting?)'],
    cat: ['Meow. (Feed me.)', '*knocks your score off the table*', 'Purr.'],
    dog: ['Woof! You\'re my favorite person!', 'Ball? BALL? BALL!'],
    computer: ['> make the game', 'It\'s VibeCode all the way down.', 'I am prompting a game inside a game. Send help.'],
    programmer: ['It works on my machine.', 'Just one more feature.', 'Who wrote this? Oh. Me.'],
    sign: ['Welcome! Population: you.', 'Caution: may contain bugs.', 'Turn back. Or don\'t. I\'m a sign.'],
    generic: ['Hello, traveler!', 'Nice day for coding, huh?', 'I\'m just an NPC. I have no backstory. Yet.', 'Did you hear? They added gravity.', 'Be careful out there.', 'I\'ve been waiting for you. Not long. Like two frames.', 'Psst. Try typing "surprise me".'],
  };

  VC.Lex = L;
})(typeof window !== 'undefined' ? (window.VC = window.VC || {}) : (globalThis.VC = globalThis.VC || {}));
