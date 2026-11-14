/** Built-in level catalogue: levels/*.json, in the play order of levels/order.json (id order when absent). */
import { parseLevel, type Level } from '../core/level';
import { applyOrder, parseOrder } from '../core/order';

const files = import.meta.glob<unknown>(['/levels/*.json', '!/levels/order.json'], { eager: true, import: 'default' });
const orderFile = import.meta.glob<unknown>('/levels/order.json', { eager: true, import: 'default' });

export const BUILTIN_LEVELS: Level[] = applyOrder(
  Object.values(files)
    .map((raw) => parseLevel(raw).level)
    .filter((l): l is Level => l !== null),
  parseOrder(Object.values(orderFile)[0]),
);
