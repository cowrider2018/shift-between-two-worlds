/** Built-in level catalogue (levels/*.json, sorted by id) + the editor's playtest slot. */
import { parseLevel, type Level } from '../core/level';

const files = import.meta.glob<unknown>('/levels/*.json', { eager: true, import: 'default' });

export const BUILTIN_LEVELS: Level[] = Object.values(files)
  .map((raw) => parseLevel(raw).level)
  .filter((l): l is Level => l !== null)
  .sort((a, b) => a.id.localeCompare(b.id));

export const PLAYTEST_KEY = 'shift.playtest';

export function loadPlaytest(): Level | null {
  try {
    const text = localStorage.getItem(PLAYTEST_KEY);
    return text ? parseLevel(JSON.parse(text)).level : null;
  } catch {
    return null;
  }
}
