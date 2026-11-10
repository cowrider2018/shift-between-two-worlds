import { cobbleTexture } from './cobbleTexture';
import {
  AdditiveBlending, Color, DataTexture, DoubleSide, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RedFormat,
  type Material,
} from 'three';

let gradient: DataTexture | null = null;

/** 3-step toon ramp — gives the flat, banded lighting the pixel look relies on. */
function toonRamp(): DataTexture {
  if (!gradient) {
    gradient = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
    gradient.minFilter = NearestFilter;
    gradient.magFilter = NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const cache = new Map<string, Material>();

export function toon(color: string, emissive?: string, doubleSided = false): MeshToonMaterial {
  const key = `toon:${color}:${emissive ?? ''}:${doubleSided}`;
  let m = cache.get(key) as MeshToonMaterial | undefined;
  if (!m) {
    m = new MeshToonMaterial({ color: new Color(color), gradientMap: toonRamp() });
    if (emissive) m.emissive = new Color(emissive);
    if (doubleSided) m.side = DoubleSide;
    cache.set(key, m);
  }
  return m;
}

/** Toon material with the cobblestone texture; `vertexColors` tints per vertex instead of by `color`. */
export function cobble(color: string, vertexColors = false): MeshToonMaterial {
  const key = `cobble:${color}:${vertexColors}`;
  let m = cache.get(key) as MeshToonMaterial | undefined;
  if (!m) {
    m = new MeshToonMaterial({ color: new Color(color), map: cobbleTexture(), gradientMap: toonRamp(), vertexColors });
    cache.set(key, m);
  }
  return m;
}

export function glow(color: string): MeshBasicMaterial {
  const key = `glow:${color}`;
  let m = cache.get(key) as MeshBasicMaterial | undefined;
  if (!m) {
    m = new MeshBasicMaterial({ color: new Color(color) });
    cache.set(key, m);
  }
  return m;
}

export function ghost(color: string, opacity = 0.3): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: new Color(color), transparent: true, opacity, depthWrite: false, blending: AdditiveBlending,
  });
}
