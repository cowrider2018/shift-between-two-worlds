/** `npm run validate [files...]` — validates every level in levels/ (or the given files). Exit 1 on errors. */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseLevel } from '../src/core/level';
import { ORDER_FILE } from '../src/core/order';
import { validateLevel } from '../src/core/validate';

const dir = resolve(import.meta.dirname, '..', 'levels');
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith('.json') && f !== ORDER_FILE).sort().map((f) => join(dir, f));

let failed = 0;
for (const file of files) {
  const name = file.split(/[\\/]/).pop()!;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`✗ ${name}: JSON 解析失敗 — ${(e as Error).message}`);
    failed++;
    continue;
  }
  const { level, errors } = parseLevel(raw);
  if (!level) {
    console.log(`✗ ${name}`);
    for (const e of errors) console.log(`    error   ${e}`);
    failed++;
    continue;
  }
  if (`${level.id}.json` !== name) errors.push(`檔名應為 ${level.id}.json`);
  const report = validateLevel(level);
  const ok = report.ok && errors.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}  「${level.name}」`);
  for (const e of errors) console.log(`    error   ${e}`);
  for (const i of report.issues) console.log(`    ${i.severity.padEnd(7)} ${i.message}`);
}
console.log(failed ? `\n${failed} 個關卡未通過` : `\n全部 ${files.length} 個關卡通過`);
process.exit(failed ? 1 : 0);
