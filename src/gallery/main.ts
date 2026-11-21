/**
 * Gallery of generated levels (dev only): browse the latest `npm run gen` batch, step through each level's route on
 * both maps, sort, pick or reject, playtest, and promote picks into levels/.
 *
 * Sections: the batch (levels-gen/, minus rejects), picks (levels-picks/, kept across batches) and rejects.
 * Routing: `gallery.html#<section>/<id>` opens a section at a level.
 */
import { isDoorOpen } from '../core/blocks';
import { LevelGrid } from '../core/grid';
import { parseLevel, type DimIndex, type Level } from '../core/level';
import { Pane, type Overlays } from '../editor/pane';
import { storePlaytest } from '../game/playtest';
import { score } from '../gen/generate';
import { Model, analyze, type Action, type Analysis } from '../gen/model';

type Section = 'batch' | 'picks' | 'rejected';
const SECTIONS: { id: Section; label: string; key: string }[] = [
  { id: 'batch', label: '全部生成', key: '1' },
  { id: 'picks', label: '我挑的', key: '2' },
  { id: 'rejected', label: '淘汰', key: '3' },
];

interface Entry {
  id: string;
  text: string;
  level: Level;
  analysis: Analysis;
  score: number;
}

type SortKey = 'score' | 'moves' | 'pulls' | 'shifts' | 'kills' | 'traps' | 'cells' | 'id';
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'score', label: '分數' },
  { id: 'pulls', label: '拉桿次數' },
  { id: 'shifts', label: '轉移次數' },
  { id: 'kills', label: '擊殺' },
  { id: 'moves', label: '步數' },
  { id: 'traps', label: '陷阱狀態' },
  { id: 'cells', label: '格數（小的在前）' },
  { id: 'id', label: 'id' },
];

/** The route as states: before step 0 and after every action. */
interface Frame {
  dim: DimIndex;
  x: number;
  y: number;
  /** Lever switches and killed trolls, as the model numbers them. */
  lm: number;
  km: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...kids);
  return el;
}

function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout((toast as unknown as { t: number }).t);
  (toast as unknown as { t: number }).t = window.setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------------------
// state

let info = '';
let batch: Entry[] = [];
let picks: Entry[] = [];
let rejected = new Set<string>();
let section: Section = 'batch';
let sortKey: SortKey = 'score';
let currentId: string | null = null;
let step = 0;
let frames: Frame[] = [];
let model: Model | null = null;
const overlays: Overlays = { souls: true, cones: true, grid: true };
const panes = [new Pane(0, $('panes')), new Pane(1, $('panes'))] as const;
const entryCache = new Map<string, Entry>();

function toEntry(id: string, text: string): Entry | null {
  const key = `${id}\n${text}`;
  const hit = entryCache.get(key);
  if (hit) return hit;
  try {
    const level = parseLevel(JSON.parse(text)).level;
    if (!level) return null;
    const analysis = analyze(level);
    const e = { id, text, level, analysis, score: analysis.metrics ? score(analysis.metrics) : -Infinity };
    entryCache.set(key, e);
    return e;
  } catch {
    return null;
  }
}

function listed(s: Section): Entry[] {
  const raw = s === 'picks' ? picks : s === 'rejected' ? batch.filter((e) => rejected.has(e.id)) : batch.filter((e) => !rejected.has(e.id));
  const val = (e: Entry): number => {
    const m = e.analysis.metrics;
    if (sortKey === 'score') return -e.score;
    if (!m) return Infinity;
    return sortKey === 'cells' ? m.cells : -Number(m[sortKey as keyof typeof m]);
  };
  return [...raw].sort((a, b) => (sortKey === 'id' ? a.id.localeCompare(b.id) : val(a) - val(b) || a.id.localeCompare(b.id)));
}

const isPicked = (id: string) => picks.some((p) => p.id === id);
const current = (): Entry | undefined => listed(section).find((e) => e.id === currentId) ?? (section === 'picks' ? undefined : picks.find((e) => e.id === currentId));

// ---------------------------------------------------------------------------
// data

async function load(): Promise<void> {
  try {
    const res = await fetch('./__gen/list');
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { info: string; batch: { id: string; text: string }[]; picks: { id: string; text: string }[]; rejected: string[] };
    info = data.info;
    batch = data.batch.map((e) => toEntry(e.id, e.text)).filter((e): e is Entry => !!e);
    picks = data.picks.map((e) => toEntry(e.id, e.text)).filter((e): e is Entry => !!e);
    rejected = new Set(data.rejected);
    $('status').textContent = '';
  } catch {
    $('status').textContent = '讀不到 /__gen/list：請用 npm run dev 開這個頁面';
  }
}

async function mark(as: 'pick' | 'reject' | 'none'): Promise<void> {
  const e = current();
  if (!e) return;
  const res = await fetch(`./__gen/mark?${new URLSearchParams({ id: e.id, as })}`, { method: 'POST' });
  if (!res.ok) {
    toast(`失敗：${await res.text()}`);
    return;
  }
  // stay in the section, moving on to the next level when this one leaves it
  const before = listed(section).map((x) => x.id);
  const at = before.indexOf(e.id);
  await load();
  const after = listed(section).map((x) => x.id);
  if (!after.includes(e.id)) currentId = after[Math.min(at, after.length - 1)] ?? null;
  toast(as === 'pick' ? `已挑選 ${e.id}` : as === 'reject' ? `已淘汰 ${e.id}` : `已取消標記 ${e.id}`);
  select(currentId, false);
}

async function promote(): Promise<void> {
  const e = current();
  if (!e) return;
  const res = await fetch(`./__gen/promote?${new URLSearchParams({ id: e.id })}`, { method: 'POST' });
  const body = await res.text();
  if (!res.ok) {
    toast(`失敗：${body}`);
    return;
  }
  toast(`已加入 levels/${body}.json，開啟編輯器`);
  window.open(`./editor.html?${new URLSearchParams({ file: body })}`, 'shift-editor');
}

function playtest(): void {
  const e = current();
  if (!e) return;
  storePlaytest(e.text);
  window.open('./index.html?playtest=1', 'shift-playtest');
}

// ---------------------------------------------------------------------------
// route frames

function buildFrames(e: Entry): void {
  model = new Model(e.level);
  const spawn = model.spawn;
  frames = [];
  if (!spawn) return;
  let f: Frame = { dim: spawn.dim, x: spawn.x, y: spawn.y, lm: 0, km: 0 };
  frames.push(f);
  for (const a of e.analysis.route ?? []) {
    f = { ...f };
    if (a.type === 'move' || a.type === 'shift') Object.assign(f, { dim: a.dim, x: a.x, y: a.y });
    else if (a.type === 'lever') f.lm ^= 1 << model.switchOf.get(model.grid.cell(a.dim, a.x, a.y))!;
    else f.km |= 1 << model.trolls.findIndex((t) => t.id === a.monster);
    frames.push(f);
  }
}

function actionText(a: Action): string {
  const at = `${'AB'[a.dim]}(${a.x},${a.y})`;
  if (a.type === 'move') return `走 ${at}`;
  if (a.type === 'shift') return `轉移 → ${at}`;
  if (a.type === 'lever') return `拉 ${at} ${a.on ? '開' : '關'}`;
  return `在 ${at} 殺 ${a.monster}`;
}

// ---------------------------------------------------------------------------
// drawing

function layoutPanes(level: Level): number {
  const host = $('panes');
  const { w, h } = level.size;
  const avail = Math.min((host.clientWidth - 24 - 40) / (2 * w), (host.clientHeight - 40 - 30) / h);
  const cell = Math.max(10, Math.min(56, Math.floor(avail)));
  for (const p of panes) p.layout(cell, w, h);
  return cell;
}

/** The route over a pane: the walked part solid, the rest faint, numbered actions, door states and the player. */
function drawRoute(pane: Pane, e: Entry, c: number): void {
  const ctx = pane.canvas.getContext('2d')!;
  const dim = pane.dim;
  const grid = model!.grid;
  const route = e.analysis.route ?? [];
  const now = frames[step];
  if (!now) return;
  const center = (x: number, y: number) => [(x + 0.5) * c, (y + 0.5) * c] as const;

  // doors as they stand at this step
  const ch = model!.channelFn(now.lm);
  for (const cell of grid.all(dim)) {
    if (cell.def.behavior !== 'door' || grid.chained(cell)) continue;
    const open = isDoorOpen(cell.props, ch);
    ctx.fillStyle = open ? '#6be08a55' : '#ff5d5d55';
    ctx.fillRect(cell.x * c + 3, cell.y * c + 3, c - 6, c - 6);
  }

  // path segments within this dimension
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a.dim !== dim || b.dim !== dim || (a.x === b.x && a.y === b.y)) continue;
    const done = i <= step;
    ctx.strokeStyle = done ? '#7ff0ff' : '#7ff0ff44';
    ctx.lineWidth = done ? Math.max(2, c * 0.1) : Math.max(1, c * 0.05);
    ctx.setLineDash(done ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(...center(a.x, a.y));
    ctx.lineTo(...center(b.x, b.y));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // numbered actions, one tag per cell and kind: shifts landing here (violet, bottom left), pulls (amber, bottom
  // right), kills (red, top left); the step numbers are joined, e.g. "6·12"
  const tags = new Map<string, { x: number; y: number; type: Action['type']; steps: number[] }>();
  route.forEach((a, i) => {
    if (a.type === 'move' || a.dim !== dim) return;
    const k = `${a.x},${a.y},${a.type}`;
    const t = tags.get(k) ?? { x: a.x, y: a.y, type: a.type, steps: [] };
    t.steps.push(i + 1);
    tags.set(k, t);
  });
  const fs = Math.max(9, Math.round(c * 0.24));
  ctx.font = `bold ${fs}px ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
  for (const t of tags.values()) {
    const text = t.steps.join('·');
    const tw = ctx.measureText(text).width + 6;
    const left = t.type !== 'lever';
    const tx = left ? t.x * c + 2 : (t.x + 1) * c - 2 - tw;
    const ty = t.type === 'kill' ? t.y * c + 2 : (t.y + 1) * c - 2 - fs;
    ctx.globalAlpha = t.steps[0] <= step ? 1 : 0.6;
    ctx.fillStyle = t.type === 'shift' ? '#c9a7ff' : t.type === 'lever' ? '#ffb020' : '#ff6b6b';
    ctx.fillRect(tx, ty, tw, fs);
    ctx.fillStyle = '#1a1620';
    ctx.textAlign = 'left';
    ctx.fillText(text, tx + 3, ty + fs / 2 + 1);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';

  // trolls killed by now: a cross over the body in A, the ghost watching in B
  model!.trolls.forEach((t, i) => {
    if (!((now.km >> i) & 1)) return;
    const [x, y] = [t.x * c, t.y * c];
    ctx.strokeStyle = dim === 0 ? '#ff6b6b' : '#bff6ff';
    ctx.lineWidth = Math.max(2, c * 0.08);
    ctx.beginPath();
    if (dim === 0) {
      ctx.moveTo(x - c * 0.3, y - c * 0.3); ctx.lineTo(x + c * 0.3, y + c * 0.3);
      ctx.moveTo(x + c * 0.3, y - c * 0.3); ctx.lineTo(x - c * 0.3, y + c * 0.3);
    } else ctx.arc(x, y, c * 0.34, 0, Math.PI * 2);
    ctx.stroke();
  });

  // the player: solid where they are, an outline at the same cell on the other side
  const [px, py] = center(now.x, now.y);
  ctx.beginPath();
  ctx.arc(px, py, c * 0.26, 0, Math.PI * 2);
  if (now.dim === dim) {
    ctx.fillStyle = '#7ff0ff';
    ctx.fill();
    ctx.strokeStyle = '#1a1620';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#7ff0ff88';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function thumbnail(level: Level): HTMLCanvasElement {
  const grid = new LevelGrid(level);
  const px = Math.max(2, Math.min(5, Math.floor(44 / Math.max(level.size.w, level.size.h))));
  const { w, h } = level.size;
  const cv = h_canvas(w * 2 * px + px, h * px);
  const ctx = cv.getContext('2d')!;
  for (const d of [0, 1] as DimIndex[])
    for (const cell of grid.all(d)) {
      if (cell.def.behavior === 'void') continue;
      ctx.fillStyle = cell.def.color;
      ctx.fillRect((d * (w + 1) + cell.x) * px, cell.y * px, px, px);
    }
  for (const d of [0, 1] as DimIndex[])
    for (const m of level.dimensions[d].monsters) {
      ctx.fillStyle = d === 0 ? '#ff8a3d' : '#9fe8ff';
      ctx.fillRect((d * (w + 1) + m.path[0][0]) * px, m.path[0][1] * px, px, px);
    }
  return cv;
}

function h_canvas(w: number, ht: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = ht;
  return cv;
}

// ---------------------------------------------------------------------------
// rendering

function renderTabs(): void {
  const counts: Record<Section, number> = { batch: listed('batch').length, picks: picks.length, rejected: listed('rejected').length };
  $('tabs').replaceChildren(...SECTIONS.map((s) => h('button', {
    className: s.id === section ? 'active' : '',
    onclick: () => setSection(s.id),
    title: `按 ${s.key}`,
  }, `${s.label} ${counts[s.id]}`)));
}

function renderList(): void {
  const items = listed(section);
  const list = $('list');
  if (!items.length) {
    list.replaceChildren(h('div', { id: 'empty', textContent: section === 'batch' ? '這批沒有關卡：先跑 npm run gen' : '（空）' }));
    return;
  }
  list.replaceChildren(...items.map((e) => {
    const m = e.analysis.metrics;
    const badges: Node[] = [];
    if (section !== 'picks' && isPicked(e.id)) badges.push(h('span', { className: 'badge pick' }, '★ 已挑'));
    const li = h('li', { className: e.id === currentId ? 'current' : '', onclick: () => select(e.id) },
      thumbnail(e.level),
      h('div', {},
        h('div', { className: 'id' }, e.id, ...badges),
        h('div', { className: 'meta' }, m
          ? `${e.score.toFixed(1)} 分・拉 ${m.pulls}・轉 ${m.shifts}・殺 ${m.kills}・${m.moves} 步`
          : `${e.analysis.status}${e.analysis.reason ? `：${e.analysis.reason}` : ''}`)));
    li.dataset.id = e.id;
    return li;
  }));
  list.querySelector('li.current')?.scrollIntoView({ block: 'nearest' });
}

function renderDetail(): void {
  const e = current();
  if (!e) {
    $('title').textContent = '';
    $('status-line').textContent = '';
    $('actions').replaceChildren();
    $('metrics').replaceChildren();
    $('route').replaceChildren();
    for (const p of panes) p.canvas.width = 0;
    $('step-label').textContent = '';
    return;
  }
  const picked = isPicked(e.id);
  const isRejected = rejected.has(e.id);
  $('title').textContent = e.id;
  $('status-line').textContent = `${e.level.size.w}×${e.level.size.h}・${picked ? '★ 已挑選' : isRejected ? '✕ 已淘汰' : '未標記'}${e.analysis.status === 'unique' ? '' : `・模型：${e.analysis.status}`}`;
  const btn = (label: string, key: string, cls: string, fn: () => void, title = '') => h('button', { className: cls, onclick: fn, title }, label, h('kbd', {}, key));
  $('actions').replaceChildren(
    btn('▶ 試玩', 'Enter', 'primary', playtest),
    btn('★ 挑選', 'P', `pick${picked ? ' on' : ''}`, () => void mark('pick')),
    btn('✕ 淘汰', 'X', `reject${isRejected ? ' on' : ''}`, () => void mark('reject')),
    btn('取消標記', 'U', '', () => void mark('none')),
    btn('加入正式關卡', '', '', () => void promote(), '複製到 levels/ 並在編輯器開啟'),
  );
  const m = e.analysis.metrics;
  $('metrics').replaceChildren(...(m ? [
    ['分數', e.score.toFixed(1)], ['步數', m.moves], ['轉移', m.shifts], ['拉桿', `${m.pulls}（${m.leverStates} 種狀態）`], ['擊殺', m.kills],
    ['回頭', m.revisits], ['陷阱狀態', `${m.traps} / ${m.states}`], ['鐵鍊門', m.chained], ['每根拉桿控制門數', m.doorsPerLever.toFixed(1)],
    ['怪物', `站樁 ${m.standing}・巡邏 ${m.patrolling}`], ['可走格', m.cells],
  ] : [['狀態', e.analysis.status], ['原因', e.analysis.reason ?? '']]).flatMap(([k, v]) => [h('span', {}, String(k)), h('span', {}, String(v))]));
  const route = e.analysis.route ?? [];
  $('route').replaceChildren(...route.map((a, i) => h('li', {
    className: i + 1 === step ? 'now' : i + 1 < step ? 'done' : '',
    onclick: () => setStep(i + 1),
  }, `${String(i + 1).padStart(2, ' ')}. ${actionText(a)}`)));
  $('route').querySelector('li.now')?.scrollIntoView({ block: 'nearest' });
  drawPanes(e);
}

function drawPanes(e: Entry): void {
  const c = layoutPanes(e.level);
  const grid = model!.grid;
  for (const p of panes) {
    p.draw({ grid, selection: null, hover: null, aim: null, overlays, issues: [] });
    drawRoute(p, e, c);
    p.canvas.parentElement!.classList.toggle('here', frames[step]?.dim === p.dim);
  }
  const route = e.analysis.route ?? [];
  const slider = $<HTMLInputElement>('step');
  slider.max = String(route.length);
  slider.value = String(step);
  $('step-label').textContent = step === 0 ? `0 / ${route.length}  起點` : `${step} / ${route.length}  ${actionText(route[step - 1])}`;
}

function render(): void {
  renderTabs();
  renderList();
  renderDetail();
  $('info').textContent = info;
  document.title = `${currentId ?? '生成關卡'} — SHIFT 生成關卡`;
}

// ---------------------------------------------------------------------------
// navigation

function writeHash(): void {
  history.replaceState(null, '', `#${section}${currentId ? `/${currentId}` : ''}`);
}

function select(id: string | null, resetStep = true): void {
  currentId = id;
  const e = current();
  if (e) {
    buildFrames(e);
    if (resetStep) step = 0;
    step = Math.min(step, frames.length - 1);
  }
  writeHash();
  render();
}

function setSection(s: Section): void {
  section = s;
  const items = listed(s);
  select(items.find((e) => e.id === currentId)?.id ?? items[0]?.id ?? null);
}

function move(delta: number): void {
  const items = listed(section);
  if (!items.length) return;
  const i = items.findIndex((e) => e.id === currentId);
  select(items[Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i) + delta))].id);
}

function setStep(n: number): void {
  if (!current()) return;
  step = Math.max(0, Math.min(frames.length - 1, n));
  renderDetail();
}

function readHash(): void {
  const [s, id] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (SECTIONS.some((x) => x.id === s)) section = s as Section;
  const items = listed(section);
  select(items.some((e) => e.id === id) || (id && picks.some((e) => e.id === id)) ? id : items[0]?.id ?? null);
}

$('sort').replaceChildren(...SORTS.map((s) => h('option', { value: s.id, textContent: s.label })));
$<HTMLSelectElement>('sort').onchange = (ev) => {
  sortKey = (ev.target as HTMLSelectElement).value as SortKey;
  render();
};
$<HTMLInputElement>('step').oninput = (ev) => setStep(Number((ev.target as HTMLInputElement).value));
$('btn-prev').onclick = () => setStep(step - 1);
$('btn-next').onclick = () => setStep(step + 1);
$('btn-reload').onclick = async () => {
  await load();
  readHash();
  toast('已重新讀取');
};

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).tagName === 'SELECT') return;
  const s = SECTIONS.find((x) => x.key === e.key);
  if (s) setSection(s.id);
  else if (e.key === 'ArrowDown' || e.key === 'j') move(1);
  else if (e.key === 'ArrowUp' || e.key === 'k') move(-1);
  else if (e.key === 'ArrowRight') setStep(step + 1);
  else if (e.key === 'ArrowLeft') setStep(step - 1);
  else if (e.key === 'Home') setStep(0);
  else if (e.key === 'End') setStep(frames.length - 1);
  else if (e.key === 'p') void mark('pick');
  else if (e.key === 'x') void mark('reject');
  else if (e.key === 'u') void mark('none');
  else if (e.key === 'Enter') playtest();
  else return;
  e.preventDefault();
});
window.addEventListener('hashchange', readHash);
window.addEventListener('resize', () => {
  const e = current();
  if (e) drawPanes(e);
});

void (async () => {
  await load();
  readHash();
})();
