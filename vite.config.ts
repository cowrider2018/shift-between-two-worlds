import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { LEVEL_ID_RE, fileStemFor, isSafeStem, sameStem } from './src/core/levelFile';
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

/** The generator's latest batch (`npm run gen` replaces it) and the picks taken from it (kept across batches). */
const GEN_DIR = resolve(import.meta.dirname, 'levels-gen');
const PICKS_DIR = resolve(import.meta.dirname, 'levels-picks');
/** Ids rejected from the current batch: it lives in the batch folder, so a new batch starts with none. */
const REJECTED_FILE = join(GEN_DIR, 'rejected.json');

function levelFiles(dir: string): { id: string; text: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'rejected.json')
    .sort()
    .map((f) => {
      const text = readFileSync(join(dir, f), 'utf8');
      return { id: idOf(text) ?? f.slice(0, -5), text };
    });
}

function readRejected(): string[] {
  try {
    const ids = JSON.parse(readFileSync(REJECTED_FILE, 'utf8')) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Dev-only endpoints used by the gallery (gallery.html):
 *   GET  /__gen/list                    → { info, batch: [{ id, text }], picks: [{ id, text }], rejected: [id] }
 *   POST /__gen/mark?id=<id>&as=<mark>  → pick (copy into levels-picks/), reject, or none (undo either)
 *   POST /__gen/promote?id=<id>         → copy a level into levels/ (refuses to overwrite); answers the file stem
 */
function genStore(): Plugin {
  const fail = (res: import('node:http').ServerResponse, code: number, msg: string) => {
    res.statusCode = code;
    res.end(msg);
  };
  return {
    name: 'shift-gen-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__gen/list', (_req, res) => {
        const index = join(GEN_DIR, 'index.txt');
        const info = existsSync(index) ? readFileSync(index, 'utf8').split('\n')[0].trim() : '';
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ info, batch: levelFiles(GEN_DIR), picks: levelFiles(PICKS_DIR), rejected: readRejected() }));
      });
      server.middlewares.use('/__gen/mark', (req, res) => {
        const q = new URL(req.url ?? '', 'http://x').searchParams;
        const id = q.get('id') ?? '';
        const as = q.get('as') ?? '';
        if (req.method !== 'POST' || !LEVEL_ID_RE.test(id) || !['pick', 'reject', 'none'].includes(as)) return fail(res, 400, 'bad request');
        const src = join(GEN_DIR, `${id}.json`);
        const pick = join(PICKS_DIR, `${id}.json`);
        const rejected = readRejected().filter((r) => r !== id);
        if (as === 'pick') {
          if (!existsSync(src)) return fail(res, 404, `批次裡沒有 ${id}`);
          const text = readFileSync(src, 'utf8');
          // ids carry the batch seed; a rerun with the same seed may reuse one for a different level
          if (existsSync(pick) && readFileSync(pick, 'utf8') !== text) return fail(res, 409, `已挑的 ${id} 是另一個關卡，換個 seed 重新產生`);
          mkdirSync(PICKS_DIR, { recursive: true });
          writeFileSync(pick, text, 'utf8');
        }
        if (as === 'none' && existsSync(pick)) unlinkSync(pick);
        if (as === 'reject') {
          if (existsSync(pick)) unlinkSync(pick);
          rejected.push(id);
        }
        if (existsSync(GEN_DIR)) writeFileSync(REJECTED_FILE, JSON.stringify(rejected, null, 2) + '\n', 'utf8');
        res.end('ok');
      });
      server.middlewares.use('/__gen/promote', (req, res) => {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        if (req.method !== 'POST' || !LEVEL_ID_RE.test(id)) return fail(res, 400, 'bad request');
        const src = [join(PICKS_DIR, `${id}.json`), join(GEN_DIR, `${id}.json`)].find((f) => existsSync(f));
        if (!src) return fail(res, 404, `找不到 ${id}`);
        const text = readFileSync(src, 'utf8');
        if (readdirSync(LEVELS_DIR).some((f) => f.endsWith('.json') && idOf(readFileSync(join(LEVELS_DIR, f), 'utf8')) === id))
          return fail(res, 409, `levels/ 已經有 id ${id}`);
        const name = (JSON.parse(text) as { name?: unknown }).name;
        const stem = fileStemFor(typeof name === 'string' ? name : id, id);
        if (readdirSync(LEVELS_DIR).some((f) => sameStem(f.slice(0, -5), stem))) return fail(res, 409, `levels/${stem}.json 已存在`);
        writeFileSync(join(LEVELS_DIR, `${stem}.json`), text, 'utf8');
        res.end(stem);
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
  plugins: [levelStore(), genStore(), itchPackage()],
  // the release build ships the game alone; the editor (editor.html) and gallery (gallery.html) run only under the dev server
  build: {
    outDir: ITCH_DIR,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { game: resolve(import.meta.dirname, 'index.html') } },
  },
});
