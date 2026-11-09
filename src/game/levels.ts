/** Built-in level catalogue: levels/*.json, sorted by id. */
import { parseLevel, type Level } from '../core/level';

const files = import.meta.glob<unknown>('/levels/*.json', { eager: true, import: 'default' });

export const BUILTIN_LEVELS: Level[] = Object.values(files)
  .map((raw) => parseLevel(raw).level)
  .filter((l): l is Level => l !== null)
  .sort((a, b) => a.id.localeCompare(b.id));
