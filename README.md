# SHIFT: Between Two Worlds

![SHIFT: Between Two Worlds — the top half is the surface dimension, with the hero hiding in front of a pillar and a troll sitting to its right; the bottom half is the underside's reflection, with a ghost troll standing to the pillar's left](docs/cover.png)

*Two worlds lie on top of each other. Only you can step between them.*

Trolls with lanterns patrol the surface. Below lies its reflection, where the dead keep watch as ghosts. The two worlds are bound together, and every troll you kill on the surface rises below as a ghost that cannot die.

A short stealth puzzle game about sneaking past the light, striking from behind, and crossing between worlds. Each level has one way out. Find it.

Made for [GitHub Game Off 2026](https://itch.io/jam/game-off-2026) (theme: SHIFT). The game runs in the browser, built with TypeScript and three.js, and comes with its own level editor.

## Controls

| Key | Action |
|---|---|
| WASD | Move (relative to the camera) |
| Mouse / wheel | Turn the camera / zoom |
| **Hold Shift** | Sneak: every monster's sight radius is halved |
| **Tap Shift** | Shift to the other dimension |
| Space | Pull a lever, or take down a surface troll from behind (a lever in range comes first; the ghosts of the underside cannot be killed) |

Click the game once to give it focus; the same click locks the mouse. Esc releases it.

## Running from source

```bash
npm install
npm run dev        # http://localhost:5173/ for the game, /editor.html for the editor
npm run check      # type check + unit tests + level validation
npm run build      # release build → dist/itch/
```

The dev build also has R to restart, ←→ to turn the camera, +/− to zoom, `?level=<id>` to jump to a level and an editor link in the top-right corner. The design rules live in [DESIGN.md](DESIGN.md) (in Chinese), the single source of truth for the game and the engine; release and asset notes are in [docs/release.md](docs/release.md).

## Making levels

1. `npm run dev` and open `/editor.html`.
2. Use **New** at the top, or open an existing level from the dropdown. The two panels (side by side or stacked) are dimensions A and B, fully independent.
3. Tools: **Brush B** (right-click erases) · **Select V** (edit parameters) · **Monster M** (switches to Path after placing) · **Path P** (add patrol points; right-click removes the last). Number keys 1–8 switch block.
4. View options: the other side's monster paths (invisible in game, for design reference only) and a sight preview.
5. Validation on the right updates live: structure, channel links, monster paths and a **solvability solver** (ignoring monsters). Click an issue to jump to its cell.
6. **Ctrl+Enter to playtest**, **Ctrl+S to save** to `levels/<name>.json`; renaming a level and saving renames the file too (the file name is cosmetic). A level's identity is the `id` inside its JSON; the game loads levels in the order of `levels/order.json` (recorded by id — drag levels in the editor's left-hand list to reorder; unlisted levels go last, by id).
7. Run `npm run check` before committing.

Level JSON keeps one row per line for readable diffs; the format is in DESIGN.md §5.

## Architecture

```
src/core/     pure logic (no three.js / DOM, testable in Node)
  blocks.ts     block registry — the single source of truth
  level.ts      level data model, parsing, normalised serialisation
  grid.ts       query layer: solid/opaque, shift points, rays, collision
  sim.ts        deterministic game simulation
  solver.ts     solvability BFS
  validate.ts   validator (shared by the CLI, the tests and the editor)
src/render/   three.js view: pixel pipeline, characters, block model registry, GameView
src/game/     input, main loop, HUD, level list
src/editor/   level editor
levels/       level files
tests/        unit tests (including a full clear of level01 along its designed route, with monsters active)
```

### Adding a block

1. Add an entry in `src/core/blocks.ts` (character, name, colour, parameter schema, solid/opaque, behaviour).
2. Add a model factory with the same id in `src/render/blockModels.ts`.
3. If it needs new behaviour, handle that behaviour in `sim.ts` (the game) and `solver.ts` (solvability).
4. `npm run check` — the tests check that characters are unique and every block has a model.

The editor's palette, parameter panel and validator follow automatically.
