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

/** DESIGN §4.3 — A is warm stone, B is cool violet. */
export const THEMES: readonly [DimTheme, DimTheme] = [
  {
    name: '表',
    background: '#1d1612',
    floor: ['#c8b48e', '#bca883'],
    wallSide: '#4a382d',
    wallTop: '#6e5747',
    hemiSky: '#fff1d6',
    hemiGround: '#3a2a20',
    sun: '#ffe2b0',
  },
  {
    name: '裏',
    background: '#0d1020',
    floor: ['#6c74ab', '#646ca2'],
    wallSide: '#1d1f44',
    wallTop: '#33376b',
    hemiSky: '#d4e2ff',
    hemiGround: '#1a1530',
    sun: '#b8caff',
  },
];

export const CHARACTER = {
  skin: '#f2c9a0',
  hair: '#f5d142',
  tunic: '#3f8f3a',
  cape: '#9b2335',
  belt: '#5a3a22',
  boots: '#4a3020',
  blade: '#dfe8f0',
  troll: '#5b4e66',
  trollBelly: '#6f6380',
  trollNose: '#7d6789',
  trollEarInner: '#9a7a8e',
  trollEye: '#ffe066',
  lantern: '#fff3b0',
  soul: '#bff6ff',
};

const CHANNEL_COLORS = ['#9aa0a6', '#ff5d5d', '#5db8ff', '#7ee06b', '#ffd25d', '#e15dff', '#5dffe0', '#ff9e5d', '#b0ff5d'];

export function channelColor(ch: number): string {
  return CHANNEL_COLORS[((ch % CHANNEL_COLORS.length) + CHANNEL_COLORS.length) % CHANNEL_COLORS.length];
}
