import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { countMeshes, mergeByMaterial } from '../../../src/districts/geometry';

function meshAt(material: MeshStandardMaterial, x: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
  mesh.position.set(x, 0, 0);
  return mesh;
}

function collectMeshes(root: Group): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((child) => {
    if ((child as Mesh).isMesh) meshes.push(child as Mesh);
  });
  return meshes;
}

describe('mergeByMaterial', () => {
  it('merges meshes that share a material into one draw call', () => {
    const material = new MeshStandardMaterial({ name: 'SHARED' });
    const group = new Group();
    group.name = 'BATCH_TEST';
    group.add(meshAt(material, -2), meshAt(material, 2));
    group.updateMatrixWorld(true);

    const stats = mergeByMaterial(group);

    expect(stats.meshesBefore).toBe(2);
    expect(stats.meshesAfter).toBe(1);
    expect(stats.groups).toBe(1);
    const meshes = collectMeshes(group);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].material).toBe(material);

    // The merged geometry keeps both boxes at their baked offsets.
    const geometry = meshes[0].geometry;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBeCloseTo(-2.5, 5);
    expect(geometry.boundingBox!.max.x).toBeCloseTo(2.5, 5);
    expect(geometry.getAttribute('position')).toBeTruthy();
  });

  it('keeps distinct materials as separate merged meshes', () => {
    const a = new MeshStandardMaterial({ name: 'A' });
    const b = new MeshStandardMaterial({ name: 'B' });
    const group = new Group();
    group.name = 'BATCH_TEST';
    group.add(meshAt(a, -2), meshAt(a, -4), meshAt(b, 2));
    group.updateMatrixWorld(true);

    const stats = mergeByMaterial(group);

    expect(stats.meshesBefore).toBe(3);
    expect(stats.meshesAfter).toBe(2);
    expect(stats.groups).toBe(2);
    expect(collectMeshes(group)).toHaveLength(2);
  });

  it('leaves a single-mesh group untouched', () => {
    const group = new Group();
    group.name = 'SINGLE';
    group.add(meshAt(new MeshStandardMaterial(), 0));
    group.updateMatrixWorld(true);

    const stats = mergeByMaterial(group);

    expect(stats.meshesBefore).toBe(1);
    expect(stats.meshesAfter).toBe(1);
    expect(collectMeshes(group)).toHaveLength(1);
  });

  it('preserves shadow flags and marks the batch cullable', () => {
    const material = new MeshStandardMaterial();
    const group = new Group();
    group.name = 'FLAGS';
    const first = meshAt(material, -1);
    first.castShadow = false;
    first.receiveShadow = true;
    group.add(first, meshAt(material, 1));
    group.updateMatrixWorld(true);

    mergeByMaterial(group);

    const merged = collectMeshes(group)[0];
    expect(merged.castShadow).toBe(false);
    expect(merged.receiveShadow).toBe(true);
    expect(merged.frustumCulled).toBe(true);
  });
});

describe('countMeshes', () => {
  it('counts every mesh without merging anything', () => {
    const material = new MeshStandardMaterial();
    const group = new Group();
    group.add(meshAt(material, -2), meshAt(material, 2));

    const stats = countMeshes(group);

    expect(stats.meshesBefore).toBe(2);
    expect(stats.meshesAfter).toBe(2);
    expect(collectMeshes(group)).toHaveLength(2);
  });
});