/** Hand-off slot between the editor and the game (kept separate so the editor never imports the level catalogue). */
import { parseLevel, type Level } from '../core/level';

export const PLAYTEST_KEY = 'shift.playtest';

export function storePlaytest(text: string): void {
  localStorage.setItem(PLAYTEST_KEY, text);
}

export function loadPlaytest(): Level | null {
  try {
    const text = localStorage.getItem(PLAYTEST_KEY);
    return text ? parseLevel(JSON.parse(text)).level : null;
  } catch {
    return null;
  }
}
