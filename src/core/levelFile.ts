/**
 * A level's file name follows its name, for readability only: the game, order.json, ?level= links and tests
 * identify a level by the id inside the JSON, never by its file name.
 */
import { ORDER_FILE } from './order';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX_STEM = 80;

/** The file stem (no .json) a level named `name` is saved under; `fallback` (the id) when the name has no usable characters. */
export function fileStemFor(name: string, fallback: string): string {
  let s = name
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, MAX_STEM)
    .replace(/[. ]+$/, '');
  if (!s) s = fallback;
  if (WINDOWS_RESERVED.test(s) || `${s}.json` === ORDER_FILE) s += '_';
  return s;
}

/** Whether a stem coming from a request is one fileStemFor could have produced (no paths, no reserved names). */
export function isSafeStem(stem: string): boolean {
  return stem.length > 0 && fileStemFor(stem, '') === stem;
}

/** File systems here are case-insensitive (Windows), so two stems collide when they differ only in case. */
export function sameStem(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Ids stay plain ASCII: they appear in order.json and ?level= links. */
export const LEVEL_ID_RE = /^[a-z0-9_-]+$/i;
