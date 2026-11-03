/**
 * 几何工具：按材质合批网格，降低 draw call。
 *
 * 设计要点（docs/architecture.md §10 性能）：
 *  - 建模导出的组团由数百个"每网格一 draw call"的小网格组成（A 区 268 个、
 *    E 区 517 个）。按材质合并后，每个组团仅剩 13–20 个 draw call。
 *  - 合并前把顶点属性"拍平"为普通 `BufferAttribute`（去交织 / 统一
 *    position+normal[+uv]），并保留/统一索引，避免
 *    `mergeGeometries` 因属性集不一致而失败。
 */

import {
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  Vector3,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 合批结果统计（用于前后对比与日志）。 */
export interface BatchStats {
  /** 合并前的可合并网格数（近似 draw call）。 */
  readonly meshesBefore: number;
  /** 合并后的网格数。 */
  readonly meshesAfter: number;
  /** 参与合批的材质分组数。 */
  readonly groups: number;
  /** 因属性不兼容而保留原样的网格数。 */
  readonly skipped: number;
}

type AnyAttribute = BufferAttribute | InterleavedBufferAttribute;

/**
 * 把任意几何体规范化成"普通属性 + 可选索引"的形式，并应用局部矩阵。
 * 只保留 position / normal / uv 三个属性，保证同组几何体属性集一致。
 */
function normalizeGeometry(
  source: BufferGeometry,
  matrix: Matrix4 | null,
  keepUv: boolean,
): BufferGeometry {
  const position = source.getAttribute('position') as AnyAttribute | undefined;
  if (!position) throw new Error('normalizeGeometry: geometry has no position attribute');

  const count = position.count;
  const normalAttr = source.getAttribute('normal') as AnyAttribute | undefined;
  const uvAttr = keepUv ? (source.getAttribute('uv') as AnyAttribute | undefined) : undefined;

  const posArray = new Float32Array(count * 3);
  const nrmArray = normalAttr ? new Float32Array(count * 3) : null;
  const uvArray = uvAttr ? new Float32Array(count * 2) : null;

  const p = new Vector3();
  const n = new Vector3();
  const normalMatrix = matrix ? new Matrix3().getNormalMatrix(matrix) : null;

  for (let i = 0; i < count; i += 1) {
    p.set(position.getX(i), position.getY(i), position.getZ(i));
    if (matrix) p.applyMatrix4(matrix);
    posArray[i * 3] = p.x;
    posArray[i * 3 + 1] = p.y;
    posArray[i * 3 + 2] = p.z;

    if (normalAttr && nrmArray) {
      n.set(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
      if (normalMatrix) n.applyMatrix3(normalMatrix).normalize();
      nrmArray[i * 3] = n.x;
      nrmArray[i * 3 + 1] = n.y;
      nrmArray[i * 3 + 2] = n.z;
    }

    if (uvAttr && uvArray) {
      uvArray[i * 2] = uvAttr.getX(i);
      uvArray[i * 2 + 1] = uvAttr.getY(i);
    }
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(posArray, 3));
  if (nrmArray) out.setAttribute('normal', new BufferAttribute(nrmArray, 3));
  if (uvArray) out.setAttribute('uv', new BufferAttribute(uvArray, 2));

  const index = source.getIndex();
  if (index) {
    const indexArray = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i += 1) indexArray[i] = index.getX(i);
    out.setIndex(new BufferAttribute(indexArray, 1));
  }

  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

interface MeshEntry {
  readonly geometry: BufferGeometry;
  readonly matrix: Matrix4;
}

/**
 * 按材质合并 `root` 子树内的所有网格（原地修改）。
 *
 * @returns 合批统计；无法合并时保留原网格并计数，绝不吞掉视觉内容。
 */
export function mergeByMaterial(root: Object3D): BatchStats {
  root.updateMatrixWorld(true);
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert();

  const buckets = new Map<string, { material: Material; entries: MeshEntry[] }>();
  const originals: Mesh[] = [];
  let skipped = 0;

  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || (mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
    const geometry = mesh.geometry;
    const material = mesh.material;
    if (!geometry || Array.isArray(material)) {
      skipped += 1;
      return;
    }
    // 带形变目标的网格合并会丢失形变，直接跳过（本沙盘无此类资产）。
    if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length > 0) {
      skipped += 1;
      return;
    }

    const local = new Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
    const key = material.uuid;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, entries: [] };
      buckets.set(key, bucket);
    }
    bucket.entries.push({ geometry, matrix: local });
    originals.push(mesh);
  });

  const meshesBefore = originals.length;
  if (meshesBefore < 2 || buckets.size === 0) {
    return { meshesBefore, meshesAfter: meshesBefore, groups: buckets.size, skipped };
  }

  // 先构建合并几何体，成功后再移除原网格（失败时保证视觉不变）。
  const built: Array<{ mesh: Mesh; source: Mesh }> = [];
  let failed = 0;

  for (const bucket of buckets.values()) {
    const keepUv = bucket.entries.every((entry) => Boolean(entry.geometry.getAttribute('uv')));
    let normalized: BufferGeometry[];
    try {
      normalized = bucket.entries.map((entry) => normalizeGeometry(entry.geometry, entry.matrix, keepUv));
    } catch {
      failed += 1;
      continue;
    }

    // `mergeGeometries` 要求"全有索引"或"全无索引"。
    const indexCount = normalized.filter((geometry) => geometry.getIndex() !== null).length;
    if (indexCount !== 0 && indexCount !== normalized.length) {
      normalized = normalized.map((geometry) => geometry.toNonIndexed());
    }

    const merged = mergeGeometries(normalized, false);
    for (const geometry of normalized) geometry.dispose();
    if (!merged) {
      failed += 1;
      continue;
    }

    const sourceMesh = originals.find((mesh) => mesh.material === bucket.material);
    const mesh = new Mesh(merged, bucket.material);
    mesh.name = `${root.name || 'BATCH'}_${sanitize(bucket.material.name || 'MAT')}`;
    mesh.castShadow = sourceMesh?.castShadow ?? true;
    mesh.receiveShadow = sourceMesh?.receiveShadow ?? true;
    mesh.frustumCulled = true;
    if (sourceMesh) built.push({ mesh, source: sourceMesh });
  }

  if (failed === buckets.size) {
    return { meshesBefore, meshesAfter: meshesBefore, groups: buckets.size, skipped };
  }

  for (const mesh of originals) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
  for (const entry of built) root.add(entry.mesh);

  // 清理空壳父节点，保持层级整洁。
  pruneEmptyGroups(root);

  skipped += failed;
  return { meshesBefore, meshesAfter: built.length, groups: buckets.size, skipped };
}

/** 只统计网格数量（不合批）——供"优化前"对照。 */
export function countMeshes(root: Object3D): BatchStats {
  let meshes = 0;
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh) meshes += 1;
  });
  return { meshesBefore: meshes, meshesAfter: meshes, groups: 0, skipped: 0 };
}

function sanitize(name: string): string {
  return name.replace(/\s+/g, '_').toUpperCase();
}

function pruneEmptyGroups(root: Object3D): void {
  const empties: Object3D[] = [];
  root.traverse((child) => {
    if (child === root) return;
    const node = child as unknown as { children: Object3D[]; isMesh?: boolean; isPoints?: boolean; isLine?: boolean };
    if (node.children.length === 0 && !node.isMesh && !node.isPoints && !node.isLine) empties.push(child);
  });
  for (const node of empties) node.removeFromParent();
}
