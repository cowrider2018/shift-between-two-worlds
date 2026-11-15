# SHIFT: Between Two Worlds

![SHIFT: Between Two Worlds — the top half is the surface dimension, with the hero hiding in front of a pillar and a troll sitting to its right; the bottom half is the underside's reflection, with a ghost troll standing to the pillar's left](docs/cover.png)

A stealth exploration game across two overlapping dimensions, plus a level editor. The design rules live in [DESIGN.md](DESIGN.md) (the single source of truth for the game and the engine).

## Running

```bash
npm install
npm run dev        # http://localhost:5173/ for the game, /editor.html for the editor
npm run check      # type check + unit tests + level validation
npm run validate   # validate levels/*.json only (optionally pass file names)
npm run build      # release build → dist/itch/ and dist/shift-itch.zip (see "Release build" below)
npm run models     # rebuild the character models with Blender (BLENDER=<blender.exe>, or a blender-* folder next to the project)
npm run cover      # re-shoot the cover → docs/ and the icon → public/ (needs Chrome; see "Uploading to itch.io" below)
```

## Controls

WASD to move (relative to the camera) · mouse / ←→ to turn the camera · **hold Shift to sneak** (monsters' sight radius is halved) · **tap Shift to shift dimension** · Space to pull a lever or take down a monster (a lever in range takes priority; a takedown means reaching a surface monster from behind — the ghosts of the underside cannot be killed)

The dev build (`npm run dev`) also has: R to restart · ←→ to turn the camera · +/− to zoom · `?level=<id>` to jump to a level · an editor link in the top-right corner.

## Release build

`npm run build` packages the game alone: the keyboard only answers to the WASD, Space and Shift taught on the tutorial pages (mouse camera turning and wheel zoom stay), and there is no editor, playtest, level jumping or R to restart.

| Output | Purpose |
|---|---|
| `dist/itch/` | The release files; serve them over HTTP (e.g. `npx vite preview`) — double-clicking index.html cannot load the models |
| `dist/shift-itch.zip` | `dist/itch/` zipped with `index.html` at the top level — this is what gets uploaded to itch.io |

The bundled JS carries no license comments; the three.js MIT license text is in `licenses.txt` and the font's OFL license is in `fonts/`, and both travel with the zip.

### Uploading to itch.io

1. **Kind of project**: **HTML**.
2. **Uploads**: upload `dist/shift-itch.zip` and tick **This file will be played in the browser**.
3. **Embed options**: **Embed in page**, viewport 1280 × 720, tick **Fullscreen button**.
4. **Cover image**: upload `docs/cover-itch.png` (630 × 500, itch's recommended size). `docs/cover.png` is the same image at twice the size (in the itch one, one art pixel is one screen pixel, so the hero's pixels are as large as in the 16:9 version) and heads this README; `docs/cover-wide.png` (1920 × 1080) is the 16:9 version; `public/icon.png` (512 × 512, transparent background) is the icon, also used as the favicon of the game and the editor: one camera shoots the troll's face head-on, the left half the underside's ghost and the right half the surface troll.
   All of these are shot by `npm run cover` (`scripts/cover.ts`): the studio page `cover.html` (`src/cover/main.ts`) on the dev server uses the game's own GameView to shoot a small cover-only level with a level camera (the ground perfectly horizontal), shooting the surface and the underside half each and stacking them (the underside flipped upside down), with each art pixel scaled up to a whole number of screen pixels. The icon is shot the way the tutorial pages are: a very narrow field of view, flat on the troll's face (at the moment in its idle animation when it has just turned back to face forward), once in each dimension, taking half of each side by side, with the background cut out to transparency (the ghost is filled with its colour against the underside's background, so the background never shows through). Re-running overwrites these files with byte-identical results. If Chrome is not in its default location, set `CHROME=<chrome.exe>`.
5. Players must click the game once before the keyboard reaches it (the iframe takes focus); the same click locks the mouse for camera turning. Esc releases the mouse; click again to lock it.

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
