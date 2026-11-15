# Release notes

How the release build, the itch.io page, the cover and the models are produced. For playing and level editing, see the [README](../README.md).

## Asset commands

```bash
npm run models     # rebuild the character models with Blender (BLENDER=<blender.exe>, or a blender-* folder next to the project)
npm run cover      # re-shoot the cover → docs/ and the icon → public/ (needs Chrome; see step 4 of "Uploading to itch.io" below)
```

## Release build

`npm run build` packages the game alone: the keyboard only answers to the WASD, Space and Shift taught on the tutorial pages (mouse camera turning and wheel zoom stay), and there is no editor, playtest, level jumping or R to restart.

| Output | Purpose |
|---|---|
| `dist/itch/` | The release files; serve them over HTTP (e.g. `npx vite preview`) — double-clicking index.html cannot load the models |
| `dist/shift-itch.zip` | `dist/itch/` zipped with `index.html` at the top level — this is what gets uploaded to itch.io |

The bundled JS carries no license comments; the three.js MIT license text is in `licenses.txt` and the font's OFL license is in `fonts/`, and both travel with the zip.

## Uploading to itch.io

1. **Kind of project**: **HTML**.
2. **Uploads**: upload `dist/shift-itch.zip` and tick **This file will be played in the browser**.
3. **Embed options**: **Embed in page**, viewport 1280 × 720, tick **Fullscreen button**.
4. **Cover image**: upload `docs/cover-itch.png` (630 × 500, itch's recommended size). `docs/cover.png` is the same image at twice the size (in the itch one, one art pixel is one screen pixel, so the hero's pixels are as large as in the 16:9 version) and heads the README; `docs/cover-wide.png` (1920 × 1080) is the 16:9 version; `public/icon.png` (512 × 512, transparent background) is the icon, also used as the favicon of the game and the editor: one camera shoots the troll's face head-on, the left half the underside's ghost and the right half the surface troll.
   All of these are shot by `npm run cover` (`scripts/cover.ts`): the studio page `cover.html` (`src/cover/main.ts`) on the dev server uses the game's own GameView to shoot a small cover-only level with a level camera (the ground perfectly horizontal), shooting the surface and the underside half each and stacking them (the underside flipped upside down), with each art pixel scaled up to a whole number of screen pixels. The icon is shot the way the tutorial pages are: a very narrow field of view, flat on the troll's face (at the moment in its idle animation when it has just turned back to face forward), once in each dimension, taking half of each side by side, with the background cut out to transparency (the ghost is filled with its colour against the underside's background, so the background never shows through). Re-running overwrites these files with byte-identical results. If Chrome is not in its default location, set `CHROME=<chrome.exe>`.
5. Players must click the game once before the keyboard reaches it (the iframe takes focus); the same click locks the mouse for camera turning. Esc releases the mouse; click again to lock it.
