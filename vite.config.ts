import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const LEVELS_DIR = resolve(import.meta.dirname, 'levels');
const ID_RE = /^[a-z0-9_-]+$/i;

/**
 * Dev-only endpoints used by the editor:
 *   GET  /__editor/levels        → [{ id, text }]
 *   POST /__editor/save?id=<id>  → writes levels/<id>.json (body = serialised level)
 */
function levelStore(): Plugin {
  return {
    name: 'shift-level-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editor/levels', (_req, res) => {
        const list = readdirSync(LEVELS_DIR)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => ({ id: f.slice(0, -5), text: readFileSync(resolve(LEVELS_DIR, f), 'utf8') }));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(list));
      });
      server.middlewares.use('/__editor/save', (req, res) => {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        if (req.method !== 'POST' || !ID_RE.test(id)) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            JSON.parse(body);
            writeFileSync(resolve(LEVELS_DIR, `${id}.json`), body, 'utf8');
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

export default defineConfig({
  base: './',
  plugins: [levelStore()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { game: resolve(import.meta.dirname, 'index.html'), editor: resolve(import.meta.dirname, 'editor.html') },
    },
  },
});
