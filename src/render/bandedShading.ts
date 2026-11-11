/**
 * DESIGN §4.1 — banded, normalised shading for every toon material, with complementary-colour shadows.
 *
 * three's toon lighting bands each light separately and then adds them up (sun + sky + point lights), so the sum
 * lands on arbitrary in-between values that differ per surface. Here the summed light is measured as a factor of
 * the surface's own colour (light ÷ albedo, by luminance, so texture and material colour cancel out), that
 * factor is sorted into a fixed set of bands, and every material takes the same band values. On top of that:
 * - the shadow band leans toward the complement of the sun's colour (a warm sun gives cool blue-grey shadows, a
 *   cold one warm shadows), as a painter would shade instead of just darkening;
 * - the lit and hot bands lean toward the sun's own colour.
 * The tints are derived in the shader from the first directional light, so they follow each dimension's theme.
 *
 * Patches ShaderLib.toon before anything compiles, so per-material onBeforeCompile hooks (camera hole, whitening,
 * cave mouth) still apply on top unchanged.
 */
import { ShaderLib } from 'three';

/** Light-factor thresholds between bands (shadow | mid | lit | hot), in linear light ÷ albedo. */
export const BAND_EDGES = [0.45, 0.75, 1.3];
/** Brightness of each band, as a multiple of the surface colour (linear). */
export const BAND_VALUES = [0.34, 0.6, 0.9, 1.15];
/** How far the shadow band leans toward the sun's complementary colour, and the lit / hot bands toward the sun. */
export const SHADOW_TINT = 0.4;
export const LIGHT_TINT = 0.25;

const f = (x: number) => x.toFixed(3);

const BANDING = /* glsl */ `
	{
		const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
		vec3 albedo = diffuseColor.rgb;
		float lightFactor = dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, LUMA)
			/ max(dot(albedo, LUMA), 1e-4);
		#if NUM_DIR_LIGHTS > 0
			vec3 sunC = directionalLights[0].color;
		#else
			vec3 sunC = vec3(1.0);
		#endif
		vec3 sunHue = sunC / max(max(sunC.r, sunC.g), max(sunC.b, 1e-4));
		// the complement about the colour's own grey axis: orange -> blue, pale blue -> warm cream
		vec3 comp = vec3(max(max(sunHue.r, sunHue.g), sunHue.b) + min(min(sunHue.r, sunHue.g), sunHue.b)) - sunHue;
		// unit-luminance hues: a colour is pushed toward one at its own luminance, so the hue moves but the band's
		// brightness does not (multiplying instead would turn an orange floor under a blue tint green)
		vec3 warm = sunHue / max(dot(sunHue, LUMA), 1e-4);
		vec3 cool = comp / max(dot(comp, LUMA), 1e-4);
		vec3 c;
		if (lightFactor < ${f(BAND_EDGES[0])}) {
			c = albedo * ${f(BAND_VALUES[0])};
			c = mix(c, dot(c, LUMA) * cool, ${f(SHADOW_TINT)});
		} else if (lightFactor < ${f(BAND_EDGES[1])}) {
			c = albedo * ${f(BAND_VALUES[1])};
		} else {
			c = albedo * (lightFactor < ${f(BAND_EDGES[2])} ? ${f(BAND_VALUES[2])} : ${f(BAND_VALUES[3])});
			c = mix(c, dot(c, LUMA) * warm, ${f(LIGHT_TINT)});
		}
		outgoingLight = c + totalEmissiveRadiance;
	}
`;

const MARKER = '#include <opaque_fragment>';
if (!ShaderLib.toon.fragmentShader.includes('lightFactor')) {
  ShaderLib.toon.fragmentShader = ShaderLib.toon.fragmentShader.replace(MARKER, BANDING + MARKER);
}
