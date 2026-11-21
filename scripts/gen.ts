/**
 * `npm run gen -- [options]` — generate candidate levels into levels-gen/ for playtesting.
 * `npm run gen -- --check levels/a.json ...` — run the uniqueness model on existing levels instead.
 *
 * Options: --rooms 3 | 3x4 (rows x cols), --tries 20000, --evolve <tries>, --keep 40, --seed 1, --levers 3, --trolls 2, --ghosts 1,
 *          --patrol 0.5 (chance a new monster patrols), --min-kills 0 (keep and evolve only levels whose route has at least this many takedowns), --min-patrols 0 (likewise for patrolling monsters), --out levels-gen
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getChar, parseLevel, serializeLevel, type DimIndex, type Level } from '../src/core/level';
import { DEFAULT_OPTIONS, evolve, generateOne, rng, type Candidate } from '../src/gen/generate';
import { analyze, describeRoute, type Action, type Analysis } from '../src/gen/model';
import { replay } from '../src/gen/replay';

const args = process.argv.slice(2);
const FLAGS = ['rooms', 'tries', 'evolve', 'keep', 'seed', 'levers', 'trolls', 'ghosts', 'patrol', 'min-kills', 'min-patrols', 'out'];
/** --name value or --name=value. An unknown option stops the run: a typo must not silently fall back to a default. */
const given = new Map<string, string>();
if (args[0] !== '--check') {
  for (let i = 0; i < args.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!m || !FLAGS.includes(m[1])) {
      console.error(`不認得的參數「${args[i]}」。可用：${FLAGS.map((f) => `--${f}`).join(' ')}`);
      process.exit(1);
    }
    const v = m[2] ?? args[++i];
    if (v === undefined || v.startsWith('--')) {
      console.error(`--${m[1]} 缺少值`);
      process.exit(1);
    }
    given.set(m[1], v);
  }
}
const flag = (name: string, d: string) => given.get(name) ?? d;

/** Both dimensions side by side. Doors: channel digit, inverted as a letter (a = 1), chained '='; levers 'L'; monsters as arrows. */
function ascii(level: Level): string {
  const { w, h } = level.size;
  const ARROW: Record<number, string> = { 0: '>', 90: 'v', 180: '<', 270: '^' };
  const dim = (d: DimIndex) => {
    const rows: string[] = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        let ch = getChar(level, d, x, y);
        const p = level.dimensions[d].props[`${x},${y}`];
        if (ch === 'D' && p) {
          const c = Number(p.channel);
          const hasLever = level.dimensions.some((dd, di) => Object.entries(dd.props).some(([k, q]) => {
            const [lx, ly] = k.split(',').map(Number);
            return getChar(level, di as DimIndex, lx, ly) === 'L' && q.channel === c;
          }));
          ch = !hasLever && !p.inverted ? '=' : p.inverted ? String.fromCharCode(96 + c) : String(c);
        }
        const m = level.dimensions[d].monsters.find((mm) => mm.path[0][0] === x && mm.path[0][1] === y);
        if (m) ch = ARROW[m.facing] ?? 'M';
        row += ch;
      }
      rows.push(row);
    }
    return rows;
  };
  const a = dim(0);
  const b = dim(1);
  const leverList = level.dimensions.flatMap((dd, di) => Object.entries(dd.props)
    .filter(([k]) => { const [x, y] = k.split(',').map(Number); return getChar(level, di as DimIndex, x, y) === 'L'; })
    .map(([k, p]) => `${'AB'[di]}(${k})=${p.channel}`));
  return ['A' + ' '.repeat(w + 2) + 'B', ...a.map((r, i) => `${r}   ${b[i]}`), `拉桿 ${leverList.join(' ') || '—'}`].join('\n');
}

function report(a: Analysis): string {
  if (!a.metrics) return `${a.status}${a.reason ? `：${a.reason}` : ''}`;
  const m = a.metrics;
  return `步 ${m.moves}  轉移 ${m.shifts}  拉桿 ${m.pulls}（${m.leverStates} 種狀態）  擊殺 ${m.kills}  回頭 ${m.revisits}  陷阱狀態 ${m.traps}/${m.states}  鐵鍊門 ${m.chained}  門/拉桿 ${m.doorsPerLever.toFixed(1)}  怪 ${m.standing} 站 ${m.patrolling} 巡${m.throughDoors ? `（${m.throughDoors} 穿門）` : ''}`;
}

if (args[0] === '--check') {
  const files = args.slice(1).length ? args.slice(1) : readdirSync('levels').filter((f) => f.endsWith('.json') && f !== 'order.json').map((f) => join('levels', f));
  for (const f of files) {
    const { level } = parseLevel(JSON.parse(readFileSync(f, 'utf8')));
    if (!level) continue;
    const a = analyze(level);
    console.log(`${f}  ${a.status}${a.reason ? `：${a.reason}` : ''}`);
    if (a.metrics) console.log(`    ${report(a)}`);
    if (a.route) console.log(`    引擎重播：${replay(level, a.route).ok ? '通關' : replay(level, a.route).reason}`);
  }
  process.exit(0);
}

const [rows, cols] = flag('rooms', '3').split('x').map(Number);
const minKills = Number(flag('min-kills', '0'));
const minPatrols = Number(flag('min-patrols', '0'));
const opts = {
  ...DEFAULT_OPTIONS,
  rows, cols: cols ?? rows,
  maxLevers: Number(flag('levers', String(DEFAULT_OPTIONS.maxLevers))),
  // n takedowns need at least n trolls
  maxTrolls: Math.max(minKills, Number(flag('trolls', String(DEFAULT_OPTIONS.maxTrolls)))),
  maxGhosts: Number(flag('ghosts', String(DEFAULT_OPTIONS.maxGhosts))),
  // chasing patrols: almost every new monster walks
  patrol: minPatrols > 0 ? 0.9 : Number(flag('patrol', String(DEFAULT_OPTIONS.patrol))),
  // chasing takedowns or patrols: a third of mutations add an aimed (and maybe walking) troll
  addTroll: minKills > 0 || minPatrols > 0 ? 0.3 : 0,
  // chasing patrols: a third of mutations lay one across the route
  routePatrol: minPatrols > 0 ? 0.35 : DEFAULT_OPTIONS.routePatrol,
};
const tries = Number(flag('tries', '20000'));
const keep = Number(flag('keep', '40'));
const seed = Number(flag('seed', String(Date.now() % 1e9)));
const out = resolve(flag('out', 'levels-gen'));

const evolveIters = Number(flag('evolve', String(tries)));
/** Takedowns and patrols counted up to their targets: more is better until then, after that the score decides. */
const progress = (c: Candidate) => Math.min(minKills, c.analysis.metrics!.kills) + Math.min(minPatrols, c.analysis.metrics!.patrolling);
const meets = (c: Candidate) => c.analysis.metrics!.kills >= minKills && c.analysis.metrics!.patrolling >= minPatrols;
const rank = (a: Candidate, b: Candidate) => progress(b) - progress(a) || b.score - a.score;

const r = rng(seed);
const found = new Map<string, Candidate>();
const t0 = Date.now();
let made = 0;
const add = (c: Candidate) => {
  made++;
  const old = found.get(c.key);
  if (!old || c.score > old.score) found.set(c.key, c);
};
for (let i = 0; i < tries; i++) {
  const c = generateOne(r, opts);
  if (c) add(c);
  if ((i + 1) % 1000 === 0) process.stdout.write(`\r抽樣 ${i + 1}/${tries}  成功 ${made}  不重複 ${found.size}   `);
}
// hill-climb from the best distinct seeds, a few rounds so improvements build on each other
const rounds = 4;
for (let k = 0; k < rounds; k++) {
  const seeds = [...found.values()].sort(rank).slice(0, Math.max(keep, 20));
  // a child climbs one takedown or patrol at a time toward the targets, never giving one up
  evolve(seeds, r, opts, Math.ceil(evolveIters / rounds), add, rank);
  process.stdout.write(`\r演化 ${k + 1}/${rounds}  成功 ${made}  不重複 ${found.size}   `);
}
// near-duplicates (one evolved family) share their shifts, pulls and kills: keep the best of each
const family = (route: Action[]) => route.filter((a) => a.type !== 'move' && a.type !== 'wait').map((a) => `${a.type}${a.dim}${a.x},${a.y}`).join(' ');
const families = new Set<string>();
const best = [...found.values()].sort(rank).filter((c) => {
  if (!meets(c)) return false;
  const f = family(c.analysis.route!);
  if (families.has(f)) return false;
  families.add(f);
  return true;
}).slice(0, keep);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const options = [...given].map(([k, v]) => `--${k} ${v}`).join(' ') || '（預設）';
const index: string[] = [`seed ${seed}  ${options}  成功 ${made}  不重複 ${found.size}  不同解法 ${families.size}  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  '圖例：數字 = 門的頻道，字母 = 反相門（a=1），= 鐵鍊門，L 拉桿，> v < ^ 怪物朝向，S 出生，E 出口', ''];
best.forEach((c, i) => {
  const id = `gen_${seed}_${String(i + 1).padStart(2, '0')}`;
  c.level.id = id;
  c.level.name = id;
  writeFileSync(join(out, `${id}.json`), serializeLevel(c.level), 'utf8');
  index.push(`## ${id}  分數 ${c.score.toFixed(1)}`, report(c.analysis), ascii(c.level), describeRoute(c.analysis.route!), '');
});
writeFileSync(join(out, 'index.txt'), index.join('\n'), 'utf8');
console.log(`\n${index[0]}\n→ ${out}（${best.length} 關）`);
if (best.length < keep && (minKills > 0 || minPatrols > 0)) {
  const spread = (what: (c: Candidate) => number, unit: string) => {
    const by = new Map<number, number>();
    for (const c of found.values()) by.set(what(c), (by.get(what(c)) ?? 0) + 1);
    return [...by].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k} ${unit} ${n} 關`).join('、');
  };
  const goal = [minKills > 0 ? `${minKills} 次擊殺` : '', minPatrols > 0 ? `${minPatrols} 隻巡邏怪` : ''].filter(Boolean).join('、');
  console.log(`⚠ 只有 ${best.length} 關達到 ${goal}（要 ${keep} 關）。找到的不重複關卡：${spread((c) => c.analysis.metrics!.kills, '殺')}；${spread((c) => c.analysis.metrics!.patrolling, '巡')}。加大 --tries / --evolve，或放大 --rooms`);
}
