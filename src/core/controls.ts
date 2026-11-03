import type { OrthographicCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_CONSTANTS } from './constants';

/** Target options for camera focus moves. */
export interface FocusOptions {
  readonly target: Vector3;
  readonly zoom?: number;
}

/**
 * Creates the OrbitControls instance used for rotate / zoom / pan
 * (PROMPT.md §8.5 items 1). Damping keeps the miniature-model feel; the polar
 * range prevents the camera from dropping under the pedestal or spinning past
 * straight-down.
 */
export function createControls(
  camera: OrthographicCamera,
  domElement: HTMLElement,
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.7;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = 1.35;
  controls.minZoom = CAMERA_CONSTANTS.MIN_ZOOM;
  controls.maxZoom = CAMERA_CONSTANTS.MAX_ZOOM;
  controls.target.set(0, 0, 0);
  controls.update();
  return controls;
}

/** Smoothly retargets the controls (used by focus / reset interactions). */
export function focusControls(controls: OrbitControls, options: FocusOptions): void {
  controls.target.copy(options.target);
  if (options.zoom !== undefined) {
    // OrbitControls types its `object` loosely; our controls are always bound
    // to the orthographic camera.
    const camera = controls.object as OrthographicCamera;
    camera.zoom = options.zoom;
    camera.updateProjectionMatrix();
  }
  controls.update();
}