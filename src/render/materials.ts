import './bandedShading';
import { cobbleTexture } from './cobbleTexture';
import { woodTexture } from './woodTexture';
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

/** Toon material with the weathered-plank texture tinted by `color`. */
export function wood(color: string): MeshToonMaterial {
  const key = `wood:${color}`;
  let m = cache.get(key) as MeshToonMaterial | undefined;
  if (!m) {
    m = new MeshToonMaterial({ color: new Color(color), map: woodTexture(), gradientMap: toonRamp() });
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

/**
 * A copy of `mat` that blends to pure white light by the geometry's `whiten` attribute (0..1): texture and
 * lighting both fade out, so a glowing surface shows no stone pattern or toon bands. Chains onto any
 * onBeforeCompile `mat` already has (e.g. the camera hole).
 */
export function whitening<T extends Material>(mat: T): T {
  const m = mat.clone() as T;
  const before = mat.onBeforeCompile.bind(mat);
  m.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float whiten;
varying float vWhiten;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWhiten = whiten;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vWhiten;`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(1.0), vWhiten);
  diffuseColor *= sampledDiffuseColor;
#endif`)
      .replace('#include <opaque_fragment>', `outgoingLight = mix(outgoingLight, vec3(1.0), vWhiten);
#include <opaque_fragment>`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  m.customProgramCacheKey = () => `${key()}+whiten`;
  return m;
}
