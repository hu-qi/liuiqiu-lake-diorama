import { Box3, OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createOrthographicCamera,
  fitOrthographicCameraToBox,
  updateFrustumForAspect,
} from '../../../src/core/camera';
import { CAMERA_CONSTANTS } from '../../../src/core/constants';

describe('createOrthographicCamera', () => {
  it('starts with a projection matrix that matches the frustum', () => {
    const camera = createOrthographicCamera(16 / 9);
    expect(camera).toBeInstanceOf(OrthographicCamera);
    const width = camera.right - camera.left;
    const height = camera.top - camera.bottom;
    expect(width / height).toBeCloseTo(16 / 9, 5);
  });
});

describe('updateFrustumForAspect', () => {
  it('keeps the vertical extent and scales the horizontal extent', () => {
    const camera = createOrthographicCamera(1);
    const height = camera.top - camera.bottom;
    updateFrustumForAspect(camera, 2);
    expect(camera.top - camera.bottom).toBeCloseTo(height, 6);
    expect(camera.right - camera.left).toBeCloseTo(height * 2, 6);
  });

  it('falls back to a 1:1 aspect when given a non-positive value', () => {
    const camera = createOrthographicCamera(2);
    updateFrustumForAspect(camera, 0);
    const height = camera.top - camera.bottom;
    expect(camera.right - camera.left).toBeCloseTo(height, 6);
  });
});

describe('fitOrthographicCameraToBox', () => {
  const box = new Box3(new Vector3(-130, -10, -85), new Vector3(130, 0, 85));

  it('produces a strictly positive frustum and positions the camera above', () => {
    const camera = createOrthographicCamera(16 / 9);
    const result = fitOrthographicCameraToBox(camera, box, 16 / 9);

    expect(camera.left).toBeLessThan(camera.right);
    expect(camera.bottom).toBeLessThan(camera.top);
    expect(result.distance).toBeGreaterThan(0);
    expect(camera.position.y).toBeGreaterThan(0);
    expect(camera.near).toBe(CAMERA_CONSTANTS.NEAR);
    expect(camera.far).toBeGreaterThan(result.distance);
  });

  it('encapsulates the box: every corner projects inside the frustum', () => {
    const camera = createOrthographicCamera(16 / 9);
    fitOrthographicCameraToBox(camera, box, 16 / 9);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const corners = [
      new Vector3(box.min.x, box.min.y, box.min.z),
      new Vector3(box.min.x, box.max.y, box.max.z),
      new Vector3(box.max.x, box.min.y, box.max.z),
      new Vector3(box.max.x, box.max.y, box.min.z),
      new Vector3(box.min.x, box.max.y, box.min.z),
      new Vector3(box.max.x, box.min.y, box.min.z),
      new Vector3(box.max.x, box.max.y, box.max.z),
      new Vector3(box.min.x, box.min.y, box.max.z),
    ];

    for (const corner of corners) {
      const projected = corner.clone().project(camera);
      expect(projected.x).toBeGreaterThanOrEqual(-1);
      expect(projected.x).toBeLessThanOrEqual(1);
      expect(projected.y).toBeGreaterThanOrEqual(-1);
      expect(projected.y).toBeLessThanOrEqual(1);
      expect(projected.z).toBeLessThanOrEqual(1);
    }
  });

  it('centres the camera target on the box centre', () => {
    const camera = createOrthographicCamera(1);
    const centre = box.getCenter(new Vector3());
    const result = fitOrthographicCameraToBox(camera, box, 1);
    expect(result.center.x).toBeCloseTo(centre.x, 6);
    expect(result.center.y).toBeCloseTo(centre.y, 6);
    expect(result.center.z).toBeCloseTo(centre.z, 6);
  });
});