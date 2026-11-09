/**
 * Level editor (DESIGN §6.5). Two independent dimension panes, registry-driven palette and inspector,
 * monster patrol drawing, live validation, undo/redo, playtest and dev-server save.
 */
import { BLOCKS, BLOCK_BY_CHAR, FLOOR, neverSolid, resolveProps, type ParamSchema } from '../core/blocks';
import { LevelGrid } from '../core/grid';
import {
  DIM_IDS, MONSTER_DEFAULTS, MONSTER_FIELDS, createEmptyLevel, getChar, nextMonsterId, parseLevel, resizeLevel,
  serializeLevel, setCell, setProp, type DimIndex, type Level, type MonsterDef,
} from '../core/level';
import { validateLevel, type Issue, type ValidationReport } from '../core/validate';
import { storePlaytest } from '../game/playtest';
import { LevelDoc } from './doc';
import { Pane, type Overlays, type Selection } from './pane';

type Tool = 'paint' | 'select' | 'monster' | 'path';
const TOOLS: { id: Tool; label: string; key: string; tip: string }[] = [
  { id: 'paint', label: '畫筆', key: 'B', tip: '左鍵畫、右鍵擦成空塊' },
  { id: 'select', label: '選取', key: 'V', tip: '點格子編參數、點怪物編屬性' },
  { id: 'monster', label: '怪物', key: 'M', tip: '左鍵放置、右鍵刪除' },
  { id: 'path', label: '路徑', key: 'P', tip: '左鍵替選中怪物加路徑點、右鍵刪最後一點' },
];
const DRAFT_KEY = 'shift.editor.draft';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...kids);
  return el;
}

// ---------------------------------------------------------------------------
// state

const doc = new LevelDoc(createEmptyLevel());
let grid = new LevelGrid(doc.level);
let report: ValidationReport = validateLevel(doc.level);
let tool: Tool = 'paint';
let brush = '#';
let selection: Selection = null;
let hover: { dim: DimIndex; x: number; y: number } | null = null;
let stroke: { erase: boolean } | null = null;
let serverLevels: { id: string; text: string }[] | null = null;
let loadedFrom: string | null = null;
const overlays: Overlays = { anchors: true, souls: true, cones: true, grid: true };

const panes = [new Pane(0, $('panes')), new Pane(1, $('panes'))] as const;

// ---------------------------------------------------------------------------
// helpers

function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout((toast as unknown as { t: number }).t);
  (toast as unknown as { t: number }).t = window.setTimeout(() => el.classList.remove('show'), 2200);
}

function monsterById(level: Level, dim: DimIndex, id: string): MonsterDef | undefined {
  return level.dimensions[dim].monsters.find((m) => m.id === id);
}

function selectedMonster(): MonsterDef | undefined {
  return selection?.kind === 'monster' ? monsterById(doc.level, selection.dim, selection.id) : undefined;
}

function monsterAt(dim: DimIndex, x: number, y: number): MonsterDef | undefined {
  const ms = doc.level.dimensions[dim].monsters;
  return ms.find((m) => m.path[0]?.[0] === x && m.path[0]?.[1] === y) ?? ms.find((m) => m.path.some(([px, py]) => px === x && py === y));
}

// ---------------------------------------------------------------------------
// edit operations

function paintAt(dim: DimIndex, x: number, y: number, erase: boolean): void {
  const ch = erase ? FLOOR.char : brush;
  if (getChar(doc.level, dim, x, y) === ch) return;
  const def = BLOCK_BY_CHAR.get(ch)!;
  if (def.params.length) selection = { kind: 'cell', dim, x, y };
  doc.edit((l) => {
    if (def.count?.max === 1) {
      ([0, 1] as DimIndex[]).forEach((d) =>
        l.dimensions[d].rows.forEach((row, ry) => [...row].forEach((c, rx) => c === ch && setCell(l, d, rx, ry, FLOOR.char))),
      );
    }
    setCell(l, dim, x, y, ch);
    for (const p of def.params) setProp(l, dim, x, y, p.key, p.default);
  });
}

function placeMonster(dim: DimIndex, x: number, y: number): void {
  const existing = monsterAt(dim, x, y);
  if (existing) {
    selection = { kind: 'monster', dim, id: existing.id };
    return render();
  }
  if (!neverSolid(grid.cell(dim, x, y).def)) return toast('怪物只能放在可走格上');
  const id = nextMonsterId(doc.level);
  doc.edit((l) => l.dimensions[dim].monsters.push({ id, path: [[x, y]], ...MONSTER_DEFAULTS }));
  selection = { kind: 'monster', dim, id };
  setTool('path');
  toast('已放置怪物 — 左鍵加入巡邏點，右鍵刪最後一點');
}

function addWaypoint(dim: DimIndex, x: number, y: number): void {
  const m = selectedMonster();
  if (!m || selection?.kind !== 'monster') return toast('先用「怪物」或「選取」工具選一隻怪物');
  if (selection.dim !== dim) return toast('路徑點必須在怪物所在的次元');
  const last = m.path[m.path.length - 1];
  if (last[0] === x && last[1] === y) return;
  const id = m.id;
  doc.edit((l) => monsterById(l, dim, id)!.path.push([x, y]));
}

function popWaypoint(): void {
  const m = selectedMonster();
  if (!m || selection?.kind !== 'monster' || m.path.length < 2) return;
  const { dim, id } = selection;
  doc.edit((l) => monsterById(l, dim, id)!.path.pop());
}

function deleteMonster(dim: DimIndex, id: string): void {
  doc.edit((l) => {
    l.dimensions[dim].monsters = l.dimensions[dim].monsters.filter((m) => m.id !== id);
  });
  if (selection?.kind === 'monster' && selection.id === id) selection = null;
  render();
}

// ---------------------------------------------------------------------------
// pane input

for (const pane of panes) {
  const c = pane.canvas;
  c.addEventListener('mousedown', (e) => {
    const { x, y } = pane.cellAt(e);
    if (!grid.inBounds(x, y)) return;
    const right = e.button === 2;
    const dim = pane.dim;
    if (tool === 'paint') {
      doc.beginStroke();
      stroke = { erase: right };
      paintAt(dim, x, y, right);
    } else if (tool === 'select') {
      const m = monsterAt(dim, x, y);
      selection = m ? { kind: 'monster', dim, id: m.id } : { kind: 'cell', dim, x, y };
      render();
    } else if (tool === 'monster') {
      if (right) {
        const m = monsterAt(dim, x, y);
        if (m) deleteMonster(dim, m.id);
      } else placeMonster(dim, x, y);
    } else if (tool === 'path') {
      if (right) popWaypoint();
      else addWaypoint(dim, x, y);
    }
  });
  c.addEventListener('mousemove', (e) => {
    const { x, y } = pane.cellAt(e);
    const inside = grid.inBounds(x, y);
    const next = inside ? { dim: pane.dim, x, y } : null;
    if (stroke && inside) paintAt(pane.dim, x, y, stroke.erase);
    if (JSON.stringify(next) !== JSON.stringify(hover)) {
      hover = next;
      drawPanes();
    }
  });
  c.addEventListener('mouseleave', () => {
    hover = null;
    drawPanes();
  });
}
window.addEventListener('mouseup', () => {
  if (stroke) {
    stroke = null;
    doc.endStroke();
  }
});

// ---------------------------------------------------------------------------
// toolbar

function setTool(t: Tool): void {
  tool = t;
  renderToolbar();
}

function renderToolbar(): void {
  $('tools').replaceChildren(
    ...TOOLS.map((t) => {
      const b = h('button', { className: t.id === tool ? 'active' : '', title: t.tip }, `${t.label}`, h('kbd', {}, t.key));
      b.onclick = () => setTool(t.id);
      return b;
    }),
  );
  $('palette').replaceChildren(
    ...BLOCKS.map((def, i) => {
      const b = h(
        'button',
        { className: def.char === brush ? 'active' : '', title: def.description },
        h('span', { className: 'swatch', textContent: def.char }),
        def.label,
        h('kbd', {}, String(i + 1)),
      );
      (b.firstChild as HTMLElement).style.background = def.color;
      b.onclick = () => {
        brush = def.char;
        setTool('paint');
      };
      return b;
    }),
  );
  $('overlays').replaceChildren(
    ...(Object.keys(overlays) as (keyof Overlays)[]).map((k) => {
      const labels: Record<keyof Overlays, string> = { anchors: '轉移點 ◆', souls: '靈魂路徑', cones: '視野預覽', grid: '格線' };
      const cb = h('input', { type: 'checkbox', checked: overlays[k] });
      cb.onchange = () => {
        overlays[k] = cb.checked;
        drawPanes();
      };
      return h('label', {}, cb, labels[k]);
    }),
  );
}

// ---------------------------------------------------------------------------
// inspector

function numberInput(value: number, min: number, max: number, step: number, onCommit: (v: number) => void): HTMLInputElement {
  const el = h('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) });
  el.onchange = () => {
    const v = Math.min(max, Math.max(min, Number(el.value)));
    if (Number.isFinite(v)) onCommit(v);
  };
  return el;
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { className: 'field' }, h('span', {}, label), input);
}

function paramInput(p: ParamSchema, value: number | boolean, commit: (v: number | boolean) => void): HTMLElement {
  if (p.type === 'bool') {
    const cb = h('input', { type: 'checkbox', checked: Boolean(value) });
    cb.onchange = () => commit(cb.checked);
    return cb;
  }
  return numberInput(Number(value), p.min, p.max, 1, (v) => commit(Math.round(v)));
}

function renderInspector(): void {
  const l = doc.level;
  // level
  const id = h('input', { value: l.id });
  id.onchange = () => doc.edit((lv) => (lv.id = id.value.trim()));
  const name = h('input', { value: l.name });
  name.onchange = () => doc.edit((lv) => (lv.name = name.value));
  const w = numberInput(l.size.w, 3, 64, 1, () => {});
  const hh = numberInput(l.size.h, 3, 64, 1, () => {});
  const apply = h('button', {}, '套用尺寸');
  apply.onclick = () => doc.edit((lv) => resizeLevel(lv, Number(w.value), Number(hh.value)));
  $('level-props').replaceChildren(field('id（檔名）', id), field('名稱', name), h('div', { className: 'row' }, field('寬', w), field('高', hh), apply));

  // selection
  const sel = $('selection');
  if (selection?.kind === 'cell') {
    const { dim, x, y } = selection;
    const cell = grid.cell(dim, x, y);
    const rows: HTMLElement[] = [
      h('div', { className: 'sel-title' }, `${cell.def.label}　${DIM_IDS[dim]} (${x}, ${y})`),
      h('div', { className: 'muted' }, cell.def.description),
    ];
    const props = resolveProps(cell.def, l.dimensions[dim].props[`${x},${y}`]);
    for (const p of cell.def.params) rows.push(field(p.label, paramInput(p, props[p.key], (v) => doc.edit((lv) => setProp(lv, dim, x, y, p.key, v)))));
    if (cell.def.behavior === 'lever' || cell.def.behavior === 'door') {
      const ch = Number(props.channel);
      const linked = grid.all().filter((c) => c !== cell && (c.def.behavior === 'lever' || c.def.behavior === 'door') && c.props.channel === ch);
      rows.push(h('div', { className: 'muted' }, `頻道 ${ch} 連結：${linked.map((c) => `${c.def.label}@${DIM_IDS[c.dim]}(${c.x},${c.y})`).join('、') || '無'}`));
    }
    sel.replaceChildren(...rows);
  } else if (selection?.kind === 'monster') {
    const { dim } = selection;
    const m = selectedMonster();
    if (!m) {
      selection = null;
      sel.replaceChildren(h('div', { className: 'muted' }, '未選取'));
      return;
    }
    const mid = m.id;
    const edit = (fn: (mm: MonsterDef) => void) => doc.edit((lv) => fn(monsterById(lv, dim, mid)!));
    const idIn = h('input', { value: m.id });
    idIn.onchange = () => {
      const v = idIn.value.trim();
      if (!v) return;
      edit((mm) => (mm.id = v));
      selection = { kind: 'monster', dim, id: v };
      render();
    };
    const mode = h('select', {}, h('option', { value: 'pingpong', textContent: '來回 pingpong' }), h('option', { value: 'loop', textContent: '循環 loop' }));
    mode.value = m.mode;
    mode.onchange = () => edit((mm) => (mm.mode = mode.value as MonsterDef['mode']));
    const del = h('button', { className: 'danger' }, '刪除怪物');
    del.onclick = () => deleteMonster(dim, mid);
    const points = h(
      'ol',
      { className: 'waypoints', start: 0 },
      ...m.path.map(([px, py], i) => {
        const rm = h('button', { className: 'mini', title: '刪除此點' }, '✕');
        rm.onclick = () => edit((mm) => mm.path.length > 1 && mm.path.splice(i, 1));
        return h('li', {}, `(${px}, ${py})${i === 0 ? ' 起點' : ''} `, i > 0 ? rm : '');
      }),
    );
    sel.replaceChildren(
      h('div', { className: 'sel-title' }, `怪物（次元 ${DIM_IDS[dim]}）`),
      field('id', idIn),
      field('巡邏模式', mode),
      ...MONSTER_FIELDS.map((f) => field(f.label, numberInput(m[f.key] as number, f.min, f.max, f.step, (v) => edit((mm) => Object.assign(mm, { [f.key]: v }))))),
      h('div', { className: 'muted' }, '路徑點（「路徑」工具在畫面上點擊新增）'),
      points,
      del,
    );
  } else {
    sel.replaceChildren(h('div', { className: 'muted' }, '未選取 — 用「選取」工具點格子或怪物'));
  }
}

function renderIssues(): void {
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  const warns = report.issues.filter((i) => i.severity === 'warning').length;
  $('verdict').className = errors ? 'bad' : warns ? 'warn' : 'good';
  $('verdict').textContent = errors ? `✗ ${errors} 個錯誤` : warns ? `△ ${warns} 個警告` : '✓ 通過驗證';
  $('issues').replaceChildren(
    ...report.issues.map((i: Issue) => {
      const li = h('li', { className: i.severity }, i.message);
      if (i.dim !== undefined && (i.x !== undefined || i.monsterId)) {
        li.classList.add('link');
        li.onclick = () => {
          selection = i.monsterId ? { kind: 'monster', dim: i.dim!, id: i.monsterId } : { kind: 'cell', dim: i.dim!, x: i.x!, y: i.y! };
          render();
        };
      }
      return li;
    }),
  );
}

// ---------------------------------------------------------------------------
// rendering

function layoutPanes(): void {
  const host = $('panes');
  const { w, h: hh } = doc.level.size;
  const availW = host.clientWidth - 48;
  const availH = host.clientHeight - 40;
  // pick whichever arrangement gives bigger cells
  const sideCell = Math.min((availW - 24) / (2 * w), (availH - 24) / hh);
  const stackCell = Math.min(availW / w, (availH - 72) / (2 * hh));
  const cell = Math.floor(Math.max(sideCell, stackCell));
  host.classList.toggle('stacked', stackCell > sideCell);
  for (const p of panes) p.layout(Math.max(10, Math.min(44, cell)), w, hh);
}

function drawPanes(): void {
  for (const p of panes) p.draw({ grid, selection, hover, overlays, issues: report.issues });
  const cell = hover && grid.cell(hover.dim, hover.x, hover.y);
  $('status').textContent = cell
    ? `${DIM_IDS[cell.dim]} (${cell.x}, ${cell.y})　${cell.def.label}${grid.isShiftPoint(cell.x, cell.y) ? '　◆可轉移' : ''}`
    : '';
}

function render(): void {
  layoutPanes();
  drawPanes();
  renderInspector();
  renderIssues();
  document.title = `${doc.dirty ? '● ' : ''}${doc.level.id} — SHIFT 編輯器`;
  $('file-name').textContent = `${doc.level.id}.json${doc.dirty ? ' ●' : ''}`;
}

doc.onChange(() => {
  grid = new LevelGrid(doc.level);
  report = validateLevel(doc.level);
  if (selection?.kind === 'monster' && !selectedMonster()) selection = null;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: serializeLevel(doc.level), from: loadedFrom, dirty: doc.dirty }));
  } catch {
    /* storage unavailable: drafts are a convenience only */
  }
  render();
});

// ---------------------------------------------------------------------------
// files

async function refreshServerLevels(): Promise<void> {
  try {
    const res = await fetch('./__editor/levels');
    if (!res.ok) throw new Error(String(res.status));
    serverLevels = await res.json();
  } catch {
    serverLevels = null;
  }
  const sel = $<HTMLSelectElement>('level-list');
  sel.replaceChildren(
    h('option', { value: '', textContent: serverLevels ? '— 開啟關卡 —' : '（無開發伺服器）' }),
    ...(serverLevels ?? []).map((l) => h('option', { value: l.id, textContent: l.id })),
  );
  sel.disabled = !serverLevels;
}

function loadText(text: string, from: string | null): boolean {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    toast(`JSON 解析失敗：${(e as Error).message}`);
    return false;
  }
  const { level, errors } = parseLevel(raw);
  if (!level) {
    toast(`無法讀取：${errors.join('；')}`);
    return false;
  }
  loadedFrom = from;
  selection = null;
  doc.load(level);
  return true;
}

function confirmDiscard(): boolean {
  return !doc.dirty || confirm('目前的修改尚未存檔，確定要放棄？');
}

async function save(): Promise<void> {
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  if (errors && !confirm(`這個關卡有 ${errors} 個錯誤（遊戲可能無法通關），仍要存檔？`)) return;
  const text = serializeLevel(doc.level);
  const id = doc.level.id;
  if (!serverLevels) return download();
  if (id !== loadedFrom && serverLevels.some((l) => l.id === id) && !confirm(`levels/${id}.json 已存在，要覆蓋嗎？`)) return;
  const res = await fetch(`./__editor/save?id=${encodeURIComponent(id)}`, { method: 'POST', body: text });
  if (!res.ok) return toast(`存檔失敗：${await res.text()}`);
  loadedFrom = id;
  doc.dirty = false;
  await refreshServerLevels();
  render();
  toast(`已存檔 levels/${id}.json`);
}

function download(): void {
  const a = h('a', { href: URL.createObjectURL(new Blob([serializeLevel(doc.level)], { type: 'application/json' })), download: `${doc.level.id}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

function playtest(): void {
  storePlaytest(serializeLevel(doc.level));
  window.open('./index.html?playtest=1', 'shift-playtest');
}

function newLevel(): void {
  if (!confirmDiscard()) return;
  const used = new Set((serverLevels ?? []).map((l) => l.id));
  let n = 1;
  while (used.has(`level${String(n).padStart(2, '0')}`)) n++;
  loadedFrom = null;
  selection = null;
  doc.load(createEmptyLevel(`level${String(n).padStart(2, '0')}`));
  doc.dirty = true;
  render();
}

$('btn-new').onclick = newLevel;
$('btn-save').onclick = () => void save();
$('btn-download').onclick = download;
$('btn-play').onclick = playtest;
$('btn-undo').onclick = () => doc.undo();
$('btn-redo').onclick = () => doc.redo();
$('btn-open').onclick = () => $('file-input').click();
$<HTMLInputElement>('file-input').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f && confirmDiscard()) loadText(await f.text(), null);
  (e.target as HTMLInputElement).value = '';
};
$<HTMLSelectElement>('level-list').onchange = (e) => {
  const sel = e.target as HTMLSelectElement;
  const entry = serverLevels?.find((l) => l.id === sel.value);
  if (entry && confirmDiscard()) loadText(entry.text, entry.id);
  sel.value = '';
};

// ---------------------------------------------------------------------------
// keyboard

window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyS') {
    e.preventDefault();
    void save();
  } else if (mod && e.code === 'Enter') {
    e.preventDefault();
    playtest();
  } else if (typing) {
    return;
  } else if (mod && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) doc.redo();
    else doc.undo();
  } else if (mod && e.code === 'KeyY') {
    e.preventDefault();
    doc.redo();
  } else if (!mod) {
    const t = TOOLS.find((tt) => `Key${tt.key}` === e.code);
    if (t) setTool(t.id);
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit && BLOCKS[Number(digit[1]) - 1]) {
      brush = BLOCKS[Number(digit[1]) - 1].char;
      setTool('paint');
    }
    if ((e.code === 'Delete' || e.code === 'Backspace') && selection?.kind === 'monster') deleteMonster(selection.dim, selection.id);
    if (e.code === 'Escape') {
      selection = null;
      render();
    }
  }
});
window.addEventListener('beforeunload', (e) => {
  if (doc.dirty) e.preventDefault();
});
window.addEventListener('resize', () => render());

// ---------------------------------------------------------------------------
// boot

async function boot(): Promise<void> {
  renderToolbar();
  await refreshServerLevels();
  let restored = false;
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as { text: string; from: string | null; dirty: boolean } | null;
    if (draft?.dirty && loadText(draft.text, draft.from)) {
      doc.dirty = true;
      restored = true;
      toast('已還原上次未存檔的草稿');
    }
  } catch {
    /* ignore broken drafts */
  }
  if (!restored) {
    const first = serverLevels?.[0];
    if (!(first && loadText(first.text, first.id))) render();
  }
  render();
}

void boot();
