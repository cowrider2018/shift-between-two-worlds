# Development notes

The dev build, the level editor and the code layout. Release and asset notes are in [release.md](release.md); the design rules are in [DESIGN.md](../DESIGN.md).

## Dev build

```bash
npm run dev        # http://localhost:5173/ for the game, /editor.html for the editor
npm run check      # type check + unit tests + level validation
npm run validate   # validate levels/*.json only (optionally pass file names)
```

The dev build also has R to restart, ←→ to turn the camera, +/− to zoom, `?level=<id>` to jump to a level and an editor link in the top-right corner.

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
