# Development notes

The dev build, the level editor and the code layout. Release and asset notes are in [release.md](release.md); the design rules are in [DESIGN.md](../DESIGN.md).

## Dev build

```bash
npm run dev        # http://localhost:5173/ for the game, /editor.html for the editor
npm run check      # type check + unit tests + level validation
npm run validate   # validate levels/*.json only (optionally pass file names)
npm run gen        # generate candidate levels into levels-gen/ (see "Generating levels")
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

## Generating levels

`npm run gen -- [--rooms 3|3x4] [--tries 20000] [--evolve N] [--keep 40] [--seed N] [--levers 3] [--trolls 2] [--ghosts 1] [--patrol 0.5] [--min-kills 1] [--min-patrols 1] [--jobs 4]`
writes the best candidates to `levels-gen/` (one JSON per level plus `index.txt` with both maps, metrics and the route).
`npm run gen -- --check [files]` runs the same checks on existing levels. The work runs on worker threads (`--jobs`, by
default half the logical cores); a seed gives the same levels at any thread count.

Sort through a batch in `/gallery.html` (dev server): both maps with the route drawn on, a step slider showing where
the player is and which doors stand open, and three sections — the batch, **picks** (copied to `levels-picks/`, kept
when the next batch replaces `levels-gen/`) and **rejects** (for this batch only). P pick, X reject, U unmark, Enter
playtest, ←→ step, ↑↓ next level, 1/2/3 sections; `gallery.html#picks/<id>` links straight to a level. **加入正式關卡**
copies a level into `levels/` and opens it in the editor (`editor.html?file=<stem>`).

1. Sample a room lattice (rooms on odd cells, connectors between them, pillars on even cells): per dimension each
   connector is floor, a door or a chained door; one lever per channel; standing or patrolling monsters (always at the
   default stats); an exit on the border. A patrol walks a straight line and may run through doors a lever drives:
   while such a door is shut it turns back at the cell before it.
2. Model it as a graph of states (dimension, cell, levers, monster states, tick) and read it twice: *strict* (the
   intended route: every action unseen, everywhere in the cells it uses, for its whole tick, off monster bodies,
   takedowns from a neighbouring cell) and *loose* (what the engine lets a player get away with: sight only at the
   tick, running, bodies walkable). A tick is the time a monster at the default speed takes to walk a cell (0.625 s;
   a sneaking step fits in it), and a turn at the default pause takes one tick too, so a patrol is modelled in whole
   cells: one cell or one turn a tick, its sight sampled four times a tick. This is the engine's walk to within a frame
   per turn, not to the frame; the replay in step 5 is the final word. A patrol through a lever door depends on when
   the levers were pulled, so its own state (cell, direction, turning) is part of the model's state. The shortest
   strict route (in ticks, with waits) is the solution.
3. Unique: banning any cell of the route leaves the loose reading without a win, and every winning kill is the
   route's own.
4. Minimize: drop any monster, door, lever or cell whose removal leaves the level unique with the same route.
5. Crop, dig out rock that touches nothing, validate, and replay the route in the real simulation on the model's
   clock. A patrol only counts when the waiting is real: if the route also wins with its waits taken out, the
   patrols that cross no lever door stand still and the level is made again.
6. Hill-climb from the best levels with random edits, then keep the top-scoring one per family (same shifts, pulls
   and kills). One edit lays a patrol across a cell of the current route: patrols never block a way for good (they
   always turn away at some point), so they are load-bearing only where the route has to time itself around them.

`--min-kills N` / `--min-patrols N` climb toward and keep only levels with that many takedowns / patrols.
`--check` reports a level as unsupported when a patrol's speed or pause is not the default, when its path is not
made of horizontal and vertical legs, or when a search passes three million states.

## Architecture

```
src/core/     pure logic (no three.js / DOM, testable in Node)
  blocks.ts     block registry — the single source of truth
  level.ts      level data model, parsing, normalised serialisation
  grid.ts       query layer: solid/opaque, shift points, rays, collision
  sim.ts        deterministic game simulation
  solver.ts     solvability BFS
  validate.ts   validator (shared by the CLI, the tests and the editor)
src/gen/      level generator: discrete model + uniqueness check, sampling/minimizing/evolving, engine replay
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
