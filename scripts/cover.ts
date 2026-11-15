/**
 * `npm run cover` — the cover art, shot in headless Chrome through the cover studio (cover.html, src/cover/main.ts)
 * on the dev server:
 *   docs/cover-itch.png  630×500   itch.io's cover image
 *   docs/cover.png       1260×1000 the same picture twice the size, at the top of the README
 *   docs/cover-wide.png  1920×1080 a 16:9 layout of the same scene
 *   public/icon.png      512×512   the troll's face, left half underside, right half surface, on transparency: the
 *                                  game's and the editor's page icon
 * Every art pixel is a whole square of screen pixels (×1, ×2, ×3), so nothing is smoothed; the itch picture and the
 * wide one have the same art pixels per unit at the hero, so the hero is drawn the same in all three. Needs Chrome
 * (CHROME=/path/to/chrome if it is not in a usual place). `npm run cover -- itch` shoots only the named layouts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'vite';
import { launchChrome } from './lib/chrome';

const ROOT = resolve(import.meta.dirname, '..');
/** [file under the project, layout, scale] */
const SHOTS: [string, string, number][] = [
  ['docs/cover-itch.png', 'itch', 1],
  ['docs/cover.png', 'itch', 2],
  ['docs/cover-wide.png', 'wide', 3],
  ['public/icon.png', 'icon', 4],
];

const only = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0, hmr: false } });
await server.listen();
const site = server.resolvedUrls?.local[0];
let code = 0;
const chrome = await launchChrome().catch((e: Error) => {
  console.error(e.message);
  return null;
});
try {
  if (!chrome || !site) throw new Error(site ? 'no Chrome' : 'dev server has no address');
  chrome.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.error('page error:', m.params.args.map((a: any) => a.value ?? a.description).join(' '));
  });
  await chrome.send('Runtime.enable');
  await chrome.send('Page.enable');
  await chrome.send('Page.navigate', { url: new URL('cover.html', site).href });
  let layouts: string[] | null = null;
  for (let i = 0; i < 600 && !layouts; i++) {
    layouts = await chrome.evaluate<string[] | null>('window.cover ? window.cover.layouts : null').catch(() => null);
    if (!layouts) await sleep(200);
  }
  if (!layouts) throw new Error('cover studio did not come up');
  for (const [file, layout, scale] of SHOTS) {
    if (only.length && !only.includes(layout)) continue;
    if (!layouts.includes(layout)) {
      console.log(`- ${file}: no layout "${layout}" yet`);
      continue;
    }
    const url = await chrome.evaluate<string>(`window.cover.shoot(${JSON.stringify(layout)}, ${scale})`);
    const png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    mkdirSync(dirname(join(ROOT, file)), { recursive: true });
    writeFileSync(join(ROOT, file), png);
    console.log(`${file}  ${(png.length / 1024).toFixed(0)} KB`);
  }
} catch (e) {
  console.error((e as Error).message);
  code = 1;
} finally {
  await chrome?.close();
  await server.close();
}
process.exit(code);
