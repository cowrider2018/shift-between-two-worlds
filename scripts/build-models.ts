/**
 * `npm run models [names...]` — rebuild character models with Blender (background mode).
 * Blender is found via the BLENDER env var, else a `blender-*` folder next to the project.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['troll'];

function findBlender(): string | null {
  if (process.env.BLENDER && existsSync(process.env.BLENDER)) return process.env.BLENDER;
  const parent = resolve(root, '..');
  for (const d of readdirSync(parent).filter((n) => n.toLowerCase().startsWith('blender')).sort().reverse()) {
    const exe = join(parent, d, process.platform === 'win32' ? 'blender.exe' : 'blender');
    if (existsSync(exe)) return exe;
  }
  return null;
}

const blender = findBlender();
if (!blender) {
  console.error('找不到 Blender：設定環境變數 BLENDER=<blender 執行檔路徑>');
  process.exit(1);
}
const r = spawnSync(blender, ['-b', '--factory-startup', '-P', join(root, 'art', 'blender', 'build.py'), '--', ...names], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
