import { Vector3 } from 'three';

/**
 * Renderer / camera tuning constants for the diorama runtime.
 * World-geometry constants (pedestal size, lake radius, …) live in
 * `src/scene/constants.ts` because they describe the model, not the engine.
 */

export const RENDER_CONSTANTS = {
  /** Cap the fill rate on high-DPI displays (PROMPT.md §10). */
  MAX_PIXEL_RATIO: 2,
  /** ACES filmic exposure — tuned for warm afternoon light without clipping. */
  TONE_MAPPING_EXPOSURE: 1.05,
  /** Directional shadow map resolution (powers of two only). */
  SHADOW_MAP_SIZE: 2048,
} as const;

export const CAMERA_CONSTANTS = {
  /** Three-quarter isometric view direction (X right, Y up, Z toward viewer). */
  ISO_DIRECTION: new Vector3(1, 0.82, 1).normalize(),
  /** Extra breathing room around the fitted bounding box. */
  FIT_MARGIN: 1.14,
  /** Ortho near plane; the camera is pushed far enough back that this is safe. */
  NEAR: 0.5,
  /** Minimum zoom-in factor allowed on the OrbitControls dolly. */
  MIN_ZOOM: 0.35,
  /** Maximum zoom-out factor allowed on the OrbitControls dolly. */
  MAX_ZOOM: 4,
} as const;