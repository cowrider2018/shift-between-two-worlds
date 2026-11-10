/** Colour palette shared by the game renderer and the editor (no three.js dependency). */

export interface DimTheme {
  name: string;
  background: string;
  floor: [string, string];
  wallSide: string;
  wallTop: string;
  hemiSky: string;
  hemiGround: string;
  sun: string;
}

/** DESIGN §4.3 — A is warm orange-yellow stone, B is cool blue-grey. */
export const THEMES: readonly [DimTheme, DimTheme] = [
  {
    name: '表',
    background: '#22160a',
    floor: ['#d8a65a', '#cc9a4f'],
    wallSide: '#5c3a1a',
    wallTop: '#86592b',
    hemiSky: '#ffe2a6',
    hemiGround: '#3f2712',
    sun: '#ffca7a',
  },
  {
    name: '裏',
    background: '#0e1218',
    floor: ['#7d8a99', '#75828f'],
    wallSide: '#29313c',
    wallTop: '#46505e',
    hemiSky: '#dce6f2',
    hemiGround: '#192029',
    sun: '#c2d2e4',
  },
];

/** Character model colours live in art/palette.json; this is the soul look applied at runtime. */
export const CHARACTER = {
  soul: '#bff6ff',
};

const CHANNEL_COLORS = ['#9aa0a6', '#ff5d5d', '#5db8ff', '#7ee06b', '#ffd25d', '#e15dff', '#5dffe0', '#ff9e5d', '#b0ff5d'];

export function channelColor(ch: number): string {
  return CHANNEL_COLORS[((ch % CHANNEL_COLORS.length) + CHANNEL_COLORS.length) % CHANNEL_COLORS.length];
}
