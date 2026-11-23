/**
 * Camera cutaway: a round hole punched through tall geometry between the camera and the hero.
 *
 * Materials wrapped with `withHole` discard fragments inside a cut volume: a cylinder along the view (a fixed
 * screen-space circle round the hero) from the camera up to the hero, closed on the hero's side by a hemisphere
 * whose tip sits just in front of the hero. Walls nearer the camera than the cap get the full circle; across the
 * cap the circle shrinks with depth like a sphere's cross-section, so a wall hugging the hero is cut less rather
 * than the hole snapping shut at one depth plane. The inner HOLE_INNER of the radius is fully open; across the
 * outer rim the surface comes back through an ordered (Bayer) dither, so the edge fades by pixel density
 * rather than by transparency. gl_FragCoord is in low-res render pixels, so the dither is in art pixels.
 */
import {
  ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, Vector2, Vector3, type Material, type WebGLProgramParametersWithUniforms,
} from 'three';

/** Fraction of the radius that is fully open; the rest is the dithered rim. */
export const HOLE_INNER = 0.75;

/** Shared by every hole material; the view writes them once per frame. */
export const HOLE = {
  uHoleCenter: { value: new Vector2() },
  /** Radius in render pixels. */
  uHoleRadius: { value: 1 },
  /** x: view-space depth of the cap's tip (nothing at or past it is cut; 0 disables the hole);
   *  y: the cap's radius in world units at that depth (the cylinder's radius). */
  uHoleCap: { value: new Vector2() },
};

/** GLSL: how much of the hole's screen radius applies at view depth z (1 in the cylinder, shrinking across the
 *  hemispherical cap, 0 at and beyond the tip). Shared with the outline pass so it skips the same dithered rim. */
export const HOLE_SCALE_GLSL = /* glsl */ `
float holeScale(float z, vec2 cap) {
  if (z >= cap.x) return 0.0;
  float k = (z - (cap.x - cap.y)) / max(cap.y, 1e-4);
  return k <= 0.0 ? 1.0 : sqrt(1.0 - k * k);
}`;

const VERT_DECL = /* glsl */ `#include <common>
varying float vHoleDepth;`;
const VERT_BODY = /* glsl */ `#include <project_vertex>
vHoleDepth = -mvPosition.z;`;
const FRAG_DECL = /* glsl */ `#include <common>
uniform vec2 uHoleCenter;
uniform float uHoleRadius;
uniform vec2 uHoleCap;
varying float vHoleDepth;
${HOLE_SCALE_GLSL}
float holeBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float holeBayer4(vec2 a) { return holeBayer2(0.5 * a) * 0.25 + holeBayer2(a); }`;
const FRAG_BODY = /* glsl */ `#include <clipping_planes_fragment>
float holeS = holeScale(vHoleDepth, uHoleCap);
if (holeS > 0.0) {
  float holeD = distance(gl_FragCoord.xy, uHoleCenter) / (uHoleRadius * holeS);
  if (holeD < 1.0) {
    float keep = (holeD - ${HOLE_INNER.toFixed(3)}) / ${(1 - HOLE_INNER).toFixed(3)};
    if (keep <= holeBayer4(gl_FragCoord.xy)) discard;
  }
}`;

function patch(shader: WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, HOLE);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', VERT_DECL)
    .replace('#include <project_vertex>', VERT_BODY);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', FRAG_DECL)
    .replace('#include <clipping_planes_fragment>', FRAG_BODY);
}

const cache = new Map<string, Material>();

/** A copy of `mat` that the camera hole cuts through (cached per source material). */
export function withHole<T extends Material>(mat: T): T {
  let m = cache.get(mat.uuid) as T | undefined;
  if (!m) {
    m = mat.clone() as T;
    m.onBeforeCompile = patch;
    m.customProgramCacheKey = () => 'camera-hole';
    cache.set(mat.uuid, m);
  }
  return m;
}

/**
 * Per dimension, how much of each cell's rock stands (see nearFade): one texel per cell, red = (value + 0.5) / 2 so
 * 255 is standing, read with linear filtering at the fragment's world x, z so the thinning ramps across the cell next
 * to the cut. The view fills it.
 */
export const FADE = [0, 1].map(() => ({
  uFadeMap: { value: fadeTexture(1, 1) },
  uFadeSize: { value: new Vector2(1, 1) },
}));

/** A blank (all standing) fade map for a w × h grid. */
export function fadeTexture(w: number, h: number): DataTexture {
  const tex = new DataTexture(new Uint8Array(w * h * 4).fill(255), w, h, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const fadeCache = new Map<string, Material>();

/**
 * A copy of `mat` (already given the camera hole) thinned by its dimension's fade map: where a cell's rock stands
 * only partly, its pixels drop out through the same ordered dither as the hole's rim, so the cut edge fades by pixel
 * density. Cached per source material and dimension.
 */
export function withFade<T extends Material>(mat: T, dim: number): T {
  const ck = `${mat.uuid}:${dim}`;
  let m = fadeCache.get(ck) as T | undefined;
  if (m) return m;
  m = mat.clone() as T;
  const uniforms = FADE[dim];
  const before = mat.onBeforeCompile.bind(mat);
  m.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec2 vFadeXZ;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vFadeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vFadeXZ;
uniform sampler2D uFadeMap;
uniform vec2 uFadeSize;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  float fadeKeep = texture2D(uFadeMap, vFadeXZ / uFadeSize).r * 2.0 - 0.5;
  if (fadeKeep < 0.999 && fadeKeep <= holeBayer4(gl_FragCoord.xy)) discard;
}`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  m.customProgramCacheKey = () => `${key()}+fade`;
  fadeCache.set(ck, m);
  return m;
}

/** An arched opening in a wall face, in world space: the middle of its sill, the outward normal of the face,
 *  the direction along the face, its half width and the height where the round top springs. */
export interface Mouth { origin: Vector3; normal: Vector3; along: Vector3; half: number; spring: number }

/** +1 normally; the view sets -1 while it renders the reflection, where the world hangs upside down below the floor,
 *  so a mouth's arch is measured downwards there instead of everything inside it being cut away. */
export const MOUTH_UP = { value: 1 };

/**
 * A copy of `mat` (already given the camera hole) that only shows through `mouth`: a fragment is kept only if the
 * line from the camera to it crosses the face plane inside the arch. Whatever sits behind the opening (a cave) is
 * then hidden like the wall around it from every other angle, e.g. when the camera hole cuts into that wall.
 */
export function throughMouth<T extends Material>(mat: T, mouth: Mouth): T {
  const m = mat.clone() as T;
  const uniforms = {
    uMouthOrigin: { value: mouth.origin },
    uMouthNormal: { value: mouth.normal },
    uMouthAlong: { value: mouth.along },
    uMouthSize: { value: new Vector2(mouth.half, mouth.spring) },
    uMouthUp: MOUTH_UP,
  };
  const before = mat.onBeforeCompile.bind(mat);
  m.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vMouthWorld;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vMouthWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vMouthWorld;
uniform vec3 uMouthOrigin, uMouthNormal, uMouthAlong;
uniform vec2 uMouthSize;
uniform float uMouthUp;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  vec3 rd = vMouthWorld - cameraPosition;
  float side = dot(cameraPosition - uMouthOrigin, uMouthNormal);
  float dn = dot(rd, uMouthNormal);
  if (side > 0.0 && dn < 0.0) {
    vec3 hit = cameraPosition + rd * (-side / dn) - uMouthOrigin;
    float u = abs(dot(hit, uMouthAlong));
    float y = hit.y * uMouthUp;
    float r = uMouthSize.x + 0.03;
    bool inside = y > -0.03 && u < r && (y < uMouthSize.y || length(vec2(u, y - uMouthSize.y)) < r);
    if (!inside) discard;
  }
}`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  m.customProgramCacheKey = () => `${key()}+mouth`;
  return m;
}
