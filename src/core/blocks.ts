/**
 * Block registry — the single source of truth for every block type.
 *
 * A block is pure data composed from engine primitives:
 *  - `solid` / `opaque` conditions (never | always | whenClosed)
 *  - one `behavior` the simulation and solver understand
 *  - a parameter schema the editor turns into an inspector
 *
 * Adding a block: add an entry here, add a model in src/render/blockModels.ts.
 * Everything else (palette, inspector, validator, solver, sim) reads this table.
 */

export type ParamValue = number | boolean;
export type Props = Record<string, ParamValue>;

export type ParamSchema =
  | { key: string; label: string; type: 'int'; default: number; min: number; max: number }
  | { key: string; label: string; type: 'bool'; default: boolean };

/** `whenClosed` only makes sense together with the `door` behavior. */
export type Condition = 'never' | 'always' | 'whenClosed';

export type Behavior = 'none' | 'spawn' | 'core' | 'reward' | 'lever' | 'door' | 'exit';

export interface BlockDef {
  id: string;
  /** Single character used in level rows. Must be unique. */
  char: string;
  label: string;
  description: string;
  /** Editor swatch colour. */
  color: string;
  params: ParamSchema[];
  solid: Condition;
  opaque: Condition;
  /** Player may shift dimensions only where BOTH dimensions hold an anchor block. */
  shiftAnchor: boolean;
  behavior: Behavior;
  /** Count across both dimensions. */
  count?: { min?: number; max?: number };
}

const CHANNEL: ParamSchema = { key: 'channel', label: '頻道', type: 'int', default: 1, min: 0, max: 99 };

export const BLOCKS: readonly BlockDef[] = [
  {
    id: 'floor', char: '.', label: '空塊', description: '可走、可轉移的錨點。',
    color: '#c9b99a', params: [], solid: 'never', opaque: 'never', shiftAnchor: true, behavior: 'none',
  },
  {
    id: 'wall', char: '#', label: '牆', description: '擋路也擋視線。',
    color: '#4a4048', params: [], solid: 'always', opaque: 'always', shiftAnchor: false, behavior: 'none',
  },
  {
    id: 'spawn', char: 'S', label: '出生點', description: '玩家起點（全關恰一個），也是錨點。',
    color: '#5fd16b', params: [], solid: 'never', opaque: 'never', shiftAnchor: true, behavior: 'spawn',
    count: { min: 1, max: 1 },
  },
  {
    id: 'reward', char: '$', label: '獎勵塊', description: '可選收集物，加分。',
    color: '#f2c94c', params: [], solid: 'never', opaque: 'never', shiftAnchor: false, behavior: 'reward',
  },
  {
    id: 'lever', char: 'L', label: '拉桿', description: '機關塊：切換頻道訊號（跨次元有效）。',
    color: '#e07b39', params: [CHANNEL], solid: 'never', opaque: 'never', shiftAnchor: false, behavior: 'lever',
  },
  {
    id: 'door', char: 'D', label: '門', description: '頻道訊號開啟時打開（inverted 則相反）。',
    color: '#8a5a3c',
    params: [CHANNEL, { key: 'inverted', label: '反相', type: 'bool', default: false }],
    solid: 'whenClosed', opaque: 'whenClosed', shiftAnchor: false, behavior: 'door',
  },
  {
    id: 'core', char: 'C', label: '核心', description: '集齊才能開啟出口。',
    color: '#58d6e8', params: [], solid: 'never', opaque: 'never', shiftAnchor: false, behavior: 'core',
  },
  {
    id: 'exit', char: 'E', label: '出口', description: '集齊核心後通關。',
    color: '#c46bff',
    params: [{ key: 'coresRequired', label: '需要核心數（0=全部）', type: 'int', default: 0, min: 0, max: 99 }],
    solid: 'never', opaque: 'never', shiftAnchor: false, behavior: 'exit', count: { min: 1 },
  },
];

export const BLOCK_BY_ID: ReadonlyMap<string, BlockDef> = new Map(BLOCKS.map((b) => [b.id, b]));
export const BLOCK_BY_CHAR: ReadonlyMap<string, BlockDef> = new Map(BLOCKS.map((b) => [b.char, b]));

export const FLOOR = BLOCK_BY_ID.get('floor')!;
export const WALL = BLOCK_BY_ID.get('wall')!;

/** Props of a cell with schema defaults filled in and unknown keys dropped. */
export function resolveProps(def: BlockDef, stored: Props | undefined): Props {
  const out: Props = {};
  for (const p of def.params) {
    const v = stored?.[p.key];
    out[p.key] = typeof v === typeof p.default ? (v as ParamValue) : p.default;
  }
  return out;
}

export type ChannelFn = (channel: number) => boolean;

export function isDoorOpen(props: Props, channelOn: ChannelFn): boolean {
  return channelOn(Number(props.channel ?? 0)) !== Boolean(props.inverted);
}

export function evalCondition(c: Condition, def: BlockDef, props: Props, channelOn: ChannelFn): boolean {
  if (c === 'never') return false;
  if (c === 'always') return true;
  return def.behavior === 'door' ? !isDoorOpen(props, channelOn) : true;
}

/** True when a block can never be solid, whatever the channel state. */
export function neverSolid(def: BlockDef): boolean {
  return def.solid === 'never';
}
