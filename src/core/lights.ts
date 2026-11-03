import {
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Box3,
  type Vector3,
} from 'three';
import { PALETTE } from '../materials/palette';
import { RENDER_CONSTANTS } from './constants';

/** Bundle returned by {@link createLighting}. */
export interface LightingBundle {
  readonly group: Group;
  readonly sun: DirectionalLight;
  readonly hemisphere: HemisphereLight;
  readonly ambient: AmbientLight;
}

/**
 * Warm-afternoon lighting rig (PROMPT.md §9.4):
 *  - hemisphere sky/ground fill for soft global illumination
 *  - a low ambient lift so nothing reads as pure black
 *  - a single shadow-casting directional "sun" fitted to the scene bounds
 *
 * Only one shadow-casting light is used: extra shadow maps would multiply the
 * depth passes for no visual gain at this scale.
 */
export function createLighting(bounds: Box3): LightingBundle {
  const group = new Group();
  group.name = 'LIGHTING_RIG';

  const hemisphere = new HemisphereLight(PALETTE.SKY_COLOR, PALETTE.GROUND_BOUNCE, 0.42);
  hemisphere.position.set(0, 100, 0);

  const ambient = new AmbientLight(PALETTE.AMBIENT_COLOR, 0.24);

  const sun = new DirectionalLight(PALETTE.SUN_COLOR, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER_CONSTANTS.SHADOW_MAP_SIZE, RENDER_CONSTANTS.SHADOW_MAP_SIZE);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.intensity = 0.72;

  group.add(hemisphere, ambient, sun);
  fitSunToBounds(sun, bounds);

  return { group, sun, hemisphere, ambient };
}

/**
 * Places the sun and tightens its shadow frustum around the given bounds so
 * shadow texels are not wasted on empty space.
 */
export function fitSunToBounds(sun: DirectionalLight, bounds: Box3): void {
  const center = bounds.getCenter(sun.position.clone());
  const size = bounds.getSize(sun.target.position.clone());
  const radius = Math.max(size.x, size.z, size.y) * 0.5;
  const spread = Math.max(radius * 1.9, 50);

  // Warm afternoon sun: elevated, slightly from the south-east.
  sun.position.set(center.x + spread * 0.62, center.y + spread * 1.25, center.z + spread * 0.46);
  sun.target.position.copy(center);

  const shadowCam = sun.shadow.camera;
  shadowCam.left = -spread * 1.05;
  shadowCam.right = spread * 1.05;
  shadowCam.top = spread * 1.05;
  shadowCam.bottom = -spread * 1.05;
  shadowCam.near = 1;
  shadowCam.far = spread * 3.4;
  shadowCam.updateProjectionMatrix();

  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
}

/** Re-aims the sun after the world grows (e.g. GLB districts loaded later). */
export function refreshLightingForBounds(lighting: LightingBundle, bounds: Box3): void {
  fitSunToBounds(lighting.sun, bounds);
}

export type { Vector3 };