import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { resolvePickRoot } from '../../../src/interactions/picker';

function makeMesh(name: string): Mesh {
  const mesh = new Mesh(undefined, new MeshStandardMaterial());
  mesh.name = name;
  return mesh;
}

describe('resolvePickRoot', () => {
  it('resolves a raycast hit back to the canonical district root, not the merged batch mesh', () => {
    // 还原真实场景：组团根节点下挂着一个按材质合批的网格。
    const root = new Group();
    root.name = 'DISTRICT_D_COLLEGE';
    const batch = makeMesh('DISTRICT_D_COLLEGE_MAT_STONE');
    root.add(batch);

    const resolved = resolvePickRoot(batch, [root]);

    expect(resolved).toBe(root);
    expect(resolved?.name).toBe('DISTRICT_D_COLLEGE');
  });

  it('does not treat a merged batch mesh name as a pickable root', () => {
    // 合批网格名同样以 `DISTRICT_` 开头，绝不能因此被当成顶层对象。
    const root = new Group();
    root.name = 'DISTRICT_A_HILLTOP';
    const batch = makeMesh('DISTRICT_A_HILLTOP_MAT_LIGHT');
    root.add(batch);

    const resolved = resolvePickRoot(batch, [root]);

    expect(resolved?.name).not.toContain('_MAT_');
    expect(resolved).toBe(root);
  });

  it('resolves landmark and station roots the same way', () => {
    const bridge = new Group();
    bridge.name = 'LANDMARK_ARCH_BRIDGE';
    const bridgeBatch = makeMesh('LANDMARK_ARCH_BRIDGE_MAT_STONE');
    bridge.add(bridgeBatch);

    const station = new Group();
    station.name = 'STATION_MAIN';
    const stationBatch = makeMesh('STATION_MAIN_MAT_METAL');
    station.add(stationBatch);

    expect(resolvePickRoot(bridgeBatch, [bridge])).toBe(bridge);
    expect(resolvePickRoot(stationBatch, [station])).toBe(station);
  });

  it('returns null when the hit is outside every known root', () => {
    const stray = makeMesh('ENV_TREE_CLUSTER_MAT_TRUNK');

    expect(resolvePickRoot(stray, [])).toBeNull();
  });

  it('still resolves a bare canonical mesh that is itself a registered root', () => {
    const root = makeMesh('TRAIN_HEAD');

    expect(resolvePickRoot(root, [root])).toBe(root);
  });
});