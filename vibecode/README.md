# VibeCode

**Don't play the game. Prompt it into existence.**

VibeCode is a game played inside a coding-agent terminal. There is no main menu: you start a new chat, and from then on you build the game you're playing by talking to Vibe, the in-game coding agent. Vibe thinks, plans, reads and writes real source files, shows diffs, runs a test suite, fixes its own mistakes (and occasionally makes some), while a live preview hot-reloads beside the conversation.

Two people starting from the same empty project end up with completely different games.

## Run it

- **Single file:** open `dist/vibecode.html` in any modern browser. Everything is inlined; it works offline (fonts fall back gracefully).
- **From source:** serve this folder (`python3 -m http.server`) and open `index.html`, or open `index.html` directly from disk.
- **Rebuild the single file:** `node build.js` → `dist/vibecode.html` (standalone) and `dist/artifact.html` (no document skeleton, for hosts that add their own).

Progress (chats, checkpoints, achievements) is saved in your browser's local storage.

## Things to try

```
a platformer where I'm a cat collecting fish
zombies chase me through a dark forest
let me shoot bananas and give me a dash
when I touch a coin, the screen shakes and I get bigger
every 5 seconds spawn 3 meteors from the sky
when the score reaches 50 spawn a dragon boss
turn the zombies into chickens
add 5 giant red flurbles        (then: "flurbles are dangerous")
the floor is lava
reverse gravity
make it juicier
surprise me
why do the zombies run away?
fix it
```

Then click the preview to play. **Esc** returns to the chat.

## How it works

The game is data plus real code. Every prompt becomes edits to a small project that the engine evaluates:

| File | What it holds |
| --- | --- |
| `game.config.js` | physics (8 control schemes), level generator (15 layouts), palette, background, effects, music, HUD |
| `src/player.js` | you, and abilities like `jump()`, `shoot("laser")`, `dash()`, `melee("sword")` |
| `src/entities/*.js` | one file per kind of thing: look, stats, `behaviors: [...]`, `onDeath: [...]`, `spawn` |
| `src/rules.js` | `rule(trigger, [actions])` — e.g. `rule(onCollide("player", "coin"), [addScore(1), destroy("coin")])` |
| `src/mods.js` | free-form JavaScript hooks (`onUpdate`, `onEvent`, `onDraw`) for anything the helpers can't express |

You can edit any of these in the **Files** tab and save; the file is evaluated and the preview hot-reloads. A syntax error shows a Vite-style overlay with the exact line, the last working version keeps running, and "fix it" asks Vibe to repair it.

### The local agent (no network needed)

`js/interpret.js` → `js/planner.js` → `js/agent.js`

1. **Interpreter:** a lexicon-driven parser (350 archetype nouns plus ~700 synonyms and emoji-mapped words, 200 adjectives, 60 colors, 18 settings, 19 genres, number words) that splits prompts into clauses and produces intents: noun phrases with modifiers and relative clauses ("a dragon that breathes fire and drops treasure when it dies"), conditional rules ("when X, Y and Z"), abilities, modifications ("the zombies are too slow" → faster), genres, settings ("through a dark forest"), questions, undo/fix.
2. **Planner:** turns intents into spec operations with context: the current theme picks fitting enemies, chasers are capped below the player's speed, collectibles get pickup rules, keys get doors, bosses get a win condition if there isn't one, unknown nouns get an improvised creature you can define later.
3. **Agent:** streams a coding session from the plan: reasoning grounded in real numbers, a todo list, `Read`/`Write`/`Update` tool calls with real line diffs, per-file permission prompts (or auto-accept / plan mode via Shift+Tab), progressive hot reload, and a real test run (`js/tests.js` boots the world headlessly and soaks it for 4 seconds). Failing tests trigger an in-turn fix.
4. **Bugs:** depending on the model (`/model`), Vibe sometimes introduces a plausible bug (enemies that flee instead of chase, a stray zero). Tests catch some; you'll notice others. Say "fix it" and Vibe finds its own mistake, or say "it's a feature" and keep it.

### The live model (optional)

When the page runs inside a Claude viewer that grants the `sample` capability, `/model` offers **claude · live**. The real model gets the engine reference and the current files, and edits the project through page-side tools (`read_file`, `write_file`, `edit_file`, `delete_file`, `run_tests`). Evaluator errors are returned to it so it can fix its own code, and it can write custom JavaScript mods. Everywhere else, the local agent runs.

## Features

- Claude Code-style terminal: streaming text, thinking, tool calls with diffs, todo lists, permission prompts, plan mode, slash commands with autocomplete, ghost-text suggestions, prompt queueing, Esc to interrupt, Esc Esc to rewind
- Live preview with autopilot while you build, click-to-play, pause, restart, fullscreen
- Engine: 8 physics modes (top-down, platformer, runner, ship, tank, snake, vertical shooter, paddle), 29 behaviors, 41 actions, 24 triggers, 13 player abilities, 15 level generators, 17 backgrounds, 30 effects, projectiles, bosses, power-ups, lighting, weather, parallax backgrounds, particles, synthesized SFX and generative music
- Files tab with a syntax-highlighted editor, Terminal tab (`ls`, `cat`, `git log`, `git diff`, `npm test`, `spawn`, `set`, `top`…), History tab with checkpoints you can restore or fork
- `/share` and `/import` share codes, `/export` to JSON
- 38 achievements (most hidden) and 12 optional challenges

## Layout

```
index.html, styles.css     the app shell
js/util.js                 helpers, seeded RNG, storage
js/lexicon.js              vocabulary: nouns, adjectives, colors, palettes, themes, genres
js/dsl.js                  helper registries, spec ↔ source files, evaluator, diff, highlighting
js/spec.js                 the game spec and its operations
js/levels.js               procedural level generators
js/engine.js, runtime.js   simulation, physics, behaviors, combat, rules, actions, autopilot, input loop
js/render.js, sound.js     canvas renderer, WebAudio synth
js/tests.js                the project's headless test suite
js/interpret.js            natural language → intents
js/planner.js              intents → operations
js/narrator.js             the agent's voice
js/agent.js, live.js       the local agent and the live-model bridge
js/ui.js, terminal.js      DOM layer
js/achievements.js         achievements and challenges
js/app.js                  projects, checkpoints, wiring
build.js                   single-file bundler
```
