# SHIFT: Between Two Worlds

![SHIFT: Between Two Worlds — the top half is the surface dimension, with the hero hiding in front of a pillar and a troll sitting to its right; the bottom half is the underside's reflection, with a ghost troll standing to the pillar's left](docs/cover.png)

*Two worlds lie on top of each other. Only you can step between them.*

Trolls with lanterns patrol the surface. Below lies its reflection, where the dead keep watch as ghosts. The two worlds are bound together, and every troll you kill on the surface rises below as a ghost that cannot die.

A short stealth puzzle game about sneaking past the light, striking from behind, and crossing between worlds. Each level has one way out. Find it.

**[Play it in your browser on itch.io](https://cowrider2018.itch.io/shift)**

Made for [GitHub Game Off 2026](https://itch.io/jam/game-off-2026) (theme: SHIFT), with TypeScript and three.js.

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
npm run build        # the game → dist/itch/
npx vite preview     # serve it at http://localhost:4173/
```

Serve the build over HTTP; opening `dist/itch/index.html` straight from disk cannot load the models.
