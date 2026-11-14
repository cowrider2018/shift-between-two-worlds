import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { LEVEL_ID_RE, isSafeStem, sameStem } from './src/core/levelFile';
import { ORDER_FILE, applyOrder, parseOrder, renameInOrder } from './src/core/order';
import { zip } from './scripts/zip';

const LEVELS_DIR = resolve(import.meta.dirname, 'levels');

/**
 * Dev-only endpoints used by the editor:
 *   GET  /__editor/levels                    → [{ file, id, text }] in play order (file = stem without .json)
 *   POST /__editor/save?file=<stem>&from=<old> → writes levels/<stem>.json and removes levels/<old>.json (a rename)
 *   POST /__editor/order         → writes levels/order.json (body = JSON array of ids)
 */
function readOrder(): string[] {
  try {
    return parseOrder(JSON.parse(readFileSync(resolve(LEVELS_DIR, ORDER_FILE), 'utf8')));
  } catch {
    return [];
  }
}

function writeOrder(ids: string[]): void {
  writeFileSync(resolve(LEVELS_DIR, ORDER_FILE), JSON.stringify(ids, null, 2) + '\n', 'utf8');
}

/** The id stored in a level file, or null when it is missing or unreadable. */
function idOf(text: string): string | null {
  try {
    const id = (JSON.parse(text) as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

function levelStore(): Plugin {
  return {
    name: 'shift-level-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editor/levels', (_req, res) => {
        const list = applyOrder(
          readdirSync(LEVELS_DIR)
            .filter((f) => f.endsWith('.json') && f !== ORDER_FILE)
            .map((f) => {
              const text = readFileSync(resolve(LEVELS_DIR, f), 'utf8');
              let id = f.slice(0, -5);
              try {
                const raw = (JSON.parse(text) as { id?: unknown }).id;
                if (typeof raw === 'string') id = raw;
              } catch {
                /* broken file: listed under its stem so it can still be opened */
              }
              return { file: f.slice(0, -5), id, text };
            }),
          readOrder(),
        );
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(list));
      });
      server.middlewares.use('/__editor/order', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const ids = JSON.parse(body) as unknown;
            if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && LEVEL_ID_RE.test(id))) throw new Error('expected an array of ids');
            writeOrder(ids);
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
      server.middlewares.use('/__editor/save', (req, res) => {
        const q = new URL(req.url ?? '', 'http://x').searchParams;
        const file = q.get('file') ?? '';
        const from = q.get('from') ?? '';
        if (req.method !== 'POST' || !isSafeStem(file) || (from && !isSafeStem(from))) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            JSON.parse(body);
            const newId = idOf(body);
            const source = resolve(LEVELS_DIR, `${from || file}.json`);
            const oldId = existsSync(source) ? idOf(readFileSync(source, 'utf8')) : null;
            const target = resolve(LEVELS_DIR, `${file}.json`);
            const old = from && from !== file ? resolve(LEVELS_DIR, `${from}.json`) : null;
            // a case-only rename must move the file first: on Windows, writing Fan.json would overwrite fan.json in place
            if (old && sameStem(from, file) && existsSync(old)) renameSync(old, target);
            writeFileSync(target, body, 'utf8');
            if (old && !sameStem(from, file) && existsSync(old)) unlinkSync(old);
            // an id change keeps the level's place in the play order
            const order = oldId && newId ? renameInOrder(readOrder(), oldId, newId) : null;
            if (order) writeOrder(order);
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

const DIST = resolve(import.meta.dirname, 'dist');
/** The game as itch.io serves it (from a sub-path, inside an iframe), and that folder zipped with index.html at the top:
 *  the zip is what gets uploaded. */
const ITCH_DIR = join(DIST, 'itch');
const ITCH_ZIP = join(DIST, 'shift-itch.zip');

/** Every file under `dir` (forward-slash paths), index.html first. */
function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((f) => String(f).split(sep).join('/'))
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

/**
 * npm run build → dist/itch/ and dist/shift-itch.zip. The bundle carries no licence comments, so three.js's MIT notice
 * (which must travel with it) goes into licenses.txt; the font's OFL text already ships in fonts/.
 */
function itchPackage(): Plugin {
  return {
    name: 'shift-itch-package',
    apply: 'build',
    buildStart() {
      // dist/ holds only this build's output: no leftovers from an older layout
      rmSync(DIST, { recursive: true, force: true });
    },
    generateBundle() {
      const three = readFileSync(resolve(import.meta.dirname, 'node_modules/three/LICENSE'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: `three.js (https://threejs.org)

${three.trim()}
` });
    },
    closeBundle() {
      const files = walk(ITCH_DIR);
      if (files[0] !== 'index.html') throw new Error('dist/itch has no index.html');
      writeFileSync(ITCH_ZIP, zip(files.map((name) => ({ name, data: readFileSync(join(ITCH_DIR, name)) }))));
      const mb = (n: number) => `${(n / (1 << 20)).toFixed(2)} MB`;
      const total = files.reduce((s, f) => s + statSync(join(ITCH_DIR, f)).size, 0);
      console.log(`dist/itch/          ${mb(total)}  ${files.length} files`);
      console.log(`${relative(import.meta.dirname, ITCH_ZIP).split(sep).join('/')}  ${mb(statSync(ITCH_ZIP).size)}`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [levelStore(), itchPackage()],
  // the release build ships the game alone; the editor (editor.html) runs only under the dev server
  build: {
    outDir: ITCH_DIR,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { game: resolve(import.meta.dirname, 'index.html') } },
  },
});
