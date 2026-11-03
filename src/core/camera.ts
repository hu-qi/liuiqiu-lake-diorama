import { OrthographicCamera, Vector3, type Box3 } from 'three';
import { CAMERA_CONSTANTS } from './constants';

/** Options for {@link fitOrthographicCameraToBox}. */
export interface FitOptions {
  /** Extra margin multiplier around the fitted extent (default 1.14). */
  readonly margin?: number;
  /** View direction from the target towards the camera. */
  readonly direction?: Vector3;
}

/** Result of a camera fit, useful for reset / cinematic moves. */
export interface CameraFitResult {
  readonly center: Vector3;
  readonly direction: Vector3;
  readonly distance: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/**
 * Creates the orthographic three-quarter camera (PROMPT.md §8.4).
 * The frustum is filled in by {@link fitOrthographicCameraToBox} once the
 * world bounding box is known.
 */
export function createOrthographicCamera(aspect: number): OrthographicCamera {
  const camera = new OrthographicCamera(-1, 1, 1, -1, CAMERA_CONSTANTS.NEAR, 5000);
  camera.position.copy(CAMERA_CONSTANTS.ISO_DIRECTION).multiplyScalar(600);
  camera.lookAt(0, 0, 0);
  camera.zoom = 1;
  updateFrustumForAspect(camera, aspect);
  return camera;
}

/**
 * Recomputes the left/right planes so the ortho frustum matches the viewport
 * aspect ratio while preserving the vertical extent. Called on resize.
 */
export function updateFrustumForAspect(camera: OrthographicCamera, aspect: number): void {
  const height = camera.top - camera.bottom;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const width = height * safeAspect;
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.updateProjectionMatrix();
}

/**
 * Fits the orthographic camera to an axis-aligned bounding box using a
 * three-quarter isometric direction.
 *
 * Because an orthographic projection has no perspective divide, the on-screen
 * extent of the box is exactly the box's projection onto the camera's right /
 * up axes — so we project all eight corners onto that basis, take the maximum
 * absolute extent, expand it to the viewport aspect, and place the camera far
 * enough along the view direction that nothing is clipped.
 */
export function fitOrthographicCameraToBox(
  camera: OrthographicCamera,
  box: Box3,
  aspect: number,
  options: FitOptions = {},
): CameraFitResult {
  const margin = options.margin ?? CAMERA_CONSTANTS.FIT_MARGIN;
  const direction = (options.direction ?? CAMERA_CONSTANTS.ISO_DIRECTION).clone().normalize();
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;

  const center = box.getCenter(new Vector3());
  const corners = getBoxCorners(box);

  // Camera basis: `right` is perpendicular to the view direction and world up.
  const worldUp = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(direction, worldUp).normalize();
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  const up = new Vector3().crossVectors(right, direction).normalize();

  let extentRight = 0;
  let extentUp = 0;
  let extentDepth = 0;
  const offset = new Vector3();

  for (const corner of corners) {
    offset.copy(corner).sub(center);
    extentRight = Math.max(extentRight, Math.abs(offset.dot(right)));
    extentUp = Math.max(extentUp, Math.abs(offset.dot(up)));
    extentDepth = Math.max(extentDepth, Math.abs(offset.dot(direction)));
  }

  // Expand the tighter axis so the whole box fits the viewport aspect.
  let halfWidth = extentRight * margin;
  let halfHeight = extentUp * margin;
  if (halfWidth / halfHeight > safeAspect) {
    halfHeight = halfWidth / safeAspect;
  } else {
    halfWidth = halfHeight * safeAspect;
  }

  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;

  const distance = extentDepth * margin + CAMERA_CONSTANTS.NEAR + 1;
  camera.near = CAMERA_CONSTANTS.NEAR;
  camera.far = distance + extentDepth * 2 + 10;
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.up.copy(worldUp);
  camera.lookAt(center);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  return { center, direction, distance, halfWidth, halfHeight };
}

/** Returns the eight corners of an axis-aligned bounding box. */
function getBoxCorners(box: Box3): Vector3[] {
  const { min, max } = box;
  return [
    new Vector3(min.x, min.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(max.x, max.y, max.z),
  ];
}