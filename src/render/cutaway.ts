/**
 * Camera cutaway: a round hole punched through tall geometry between the camera and the hero.
 *
 * Materials wrapped with `withHole` discard fragments that are nearer to the camera than the hero and fall
 * inside a screen-space circle around the hero. The inner HOLE_INNER of the radius is fully open; across the
 * outer rim the surface comes back through an ordered (Bayer) dither, so the edge fades by pixel density
 * rather than by transparency. gl_FragCoord is in low-res render pixels, so the dither is in art pixels.
 */
import { Vector2, Vector3, type Material, type WebGLProgramParametersWithUniforms } from 'three';

/** Fraction of the radius that is fully open; the rest is the dithered rim. */
export const HOLE_INNER = 0.75;

/** Shared by every hole material; the view writes them once per frame. */
export const HOLE = {
  uHoleCenter: { value: new Vector2() },
  /** Radius in render pixels. */
  uHoleRadius: { value: 1 },
  /** View-space depth; only fragments nearer than this are cut. 0 disables the hole. */
  uHoleDepth: { value: 0 },
};

const VERT_DECL = /* glsl */ `#include <common>
varying float vHoleDepth;`;
const VERT_BODY = /* glsl */ `#include <project_vertex>
vHoleDepth = -mvPosition.z;`;
const FRAG_DECL = /* glsl */ `#include <common>
uniform vec2 uHoleCenter;
uniform float uHoleRadius;
uniform float uHoleDepth;
varying float vHoleDepth;
float holeBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float holeBayer4(vec2 a) { return holeBayer2(0.5 * a) * 0.25 + holeBayer2(a); }`;
const FRAG_BODY = /* glsl */ `#include <clipping_planes_fragment>
if (vHoleDepth < uHoleDepth) {
  float holeD = distance(gl_FragCoord.xy, uHoleCenter) / uHoleRadius;
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

/** An arched opening in a wall face, in world space: the middle of its sill, the outward normal of the face,
 *  the direction along the face, its half width and the height where the round top springs. */
export interface Mouth { origin: Vector3; normal: Vector3; along: Vector3; half: number; spring: number }

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
uniform vec2 uMouthSize;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  vec3 rd = vMouthWorld - cameraPosition;
  float side = dot(cameraPosition - uMouthOrigin, uMouthNormal);
  float dn = dot(rd, uMouthNormal);
  if (side > 0.0 && dn < 0.0) {
    vec3 hit = cameraPosition + rd * (-side / dn) - uMouthOrigin;
    float u = abs(dot(hit, uMouthAlong));
    float y = hit.y;
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
