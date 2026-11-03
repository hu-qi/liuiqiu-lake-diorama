/**
 * 条带 / 扫掠几何体（路面、水道、钢轨）。
 *
 * 放在 `src/scene` 作为基础几何工具，供 `districts`（道路/水道）与
 * `railway`（钢轨/道砟）共享，避免两支各自实现造成风格漂移。
 */

import { BufferAttribute, BufferGeometry, Vector3, type Curve } from 'three';

/** 由世界 Y-up、XZ 平面折线生成平铺条带。 */
export function createPolylineRibbon(
  points: ReadonlyArray<readonly [number, number]>,
  width: number,
  y: number,
  closed = false,
): BufferGeometry {
  const count = points.length;
  const half = width / 2;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);

  for (let i = 0; i < count; i += 1) {
    const prev = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const current = points[i];
    const dirX = next[0] - prev[0];
    const dirZ = next[1] - prev[1];
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = -dirZ / len;
    const nz = dirX / len;

    const left = i * 2;
    const right = i * 2 + 1;
    positions[left * 3] = current[0] + nx * half;
    positions[left * 3 + 1] = y;
    positions[left * 3 + 2] = current[1] + nz * half;
    positions[right * 3] = current[0] - nx * half;
    positions[right * 3 + 1] = y;
    positions[right * 3 + 2] = current[1] - nz * half;

    const u = i / (count - (closed ? 0 : 1));
    uvs[left * 2] = u;
    uvs[right * 2 + 1] = 1;
    uvs[right * 2] = u;
  }

  const indices: number[] = [];
  const segments = closed ? count : count - 1;
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    indices.push(a, a + 1, b + 1, a, b + 1, b);
  }

  return finishGeometry(positions, uvs, indices);
}

/**
 * 沿折线生成一条**贴合地形起伏**的条带（路面 / 水道）。
 *
 * 与 `createPolylineRibbon` 的区别：每个顶点的 Y 由 `sampleY(x, z)` 求地
 * 面高度后再加上 `lift`，因此条带会随地形起伏而不悬空、不陷地。横向半宽内
 * 取左右两条边各自的采样高度，避免横坡上路肩一侧露缝。
 */
export function createTerrainRibbon(
  points: ReadonlyArray<readonly [number, number]>,
  width: number,
  lift: number,
  sampleY: (x: number, z: number) => number,
  closed = false,
): BufferGeometry {
  const count = points.length;
  const half = width / 2;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);

  for (let i = 0; i < count; i += 1) {
    const prev = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const current = points[i];
    const dirX = next[0] - prev[0];
    const dirZ = next[1] - prev[1];
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = -dirZ / len;
    const nz = dirX / len;

    const left = i * 2;
    const right = i * 2 + 1;
    const lx = current[0] + nx * half;
    const lz = current[1] + nz * half;
    const rx = current[0] - nx * half;
    const rz = current[1] - nz * half;

    positions[left * 3] = lx;
    positions[left * 3 + 1] = sampleY(lx, lz) + lift;
    positions[left * 3 + 2] = lz;
    positions[right * 3] = rx;
    positions[right * 3 + 1] = sampleY(rx, rz) + lift;
    positions[right * 3 + 2] = rz;

    const u = i / (count - (closed ? 0 : 1));
    uvs[left * 2] = u;
    uvs[left * 2 + 1] = 0;
    uvs[right * 2] = u;
    uvs[right * 2 + 1] = 1;
  }

  const indices: number[] = [];
  const segments = closed ? count : count - 1;
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    indices.push(a, a + 1, b + 1, a, b + 1, b);
  }

  return finishGeometry(positions, uvs, indices);
}

/**
 * 沿曲线生成一条按 `lateralOffset` 横向偏移、宽 `width`、位于 `y` 平面的条带。
 * 用于钢轨（左右各一条）与道砟。
 */
export function createCurveRibbon(
  curve: Curve<Vector3>,
  lateralOffset: number,
  width: number,
  y: number,
  samples: number,
): BufferGeometry {
  const positions = new Float32Array(samples * 2 * 3);
  const uvs = new Float32Array(samples * 2 * 2);
  const up = new Vector3(0, 1, 0);
  const point = new Vector3();
  const tangent = new Vector3();
  const lateral = new Vector3();
  const half = width / 2;

  for (let i = 0; i < samples; i += 1) {
    const u = i / samples;
    curve.getPointAt(u, point);
    curve.getTangentAt(u, tangent);
    lateral.crossVectors(up, tangent).normalize();
    if (!Number.isFinite(lateral.x) || lateral.lengthSq() < 1e-9) lateral.set(1, 0, 0);

    const x = point.x + lateral.x * lateralOffset;
    const z = point.z + lateral.z * lateralOffset;

    const left = i * 2;
    const right = i * 2 + 1;
    positions[left * 3] = x + lateral.x * half;
    positions[left * 3 + 1] = y;
    positions[left * 3 + 2] = z + lateral.z * half;
    positions[right * 3] = x - lateral.x * half;
    positions[right * 3 + 1] = y;
    positions[right * 3 + 2] = z - lateral.z * half;

    const t = i / samples;
    uvs[left * 2] = t * samples * 0.25;
    uvs[right * 2] = t * samples * 0.25;
    uvs[right * 2 + 1] = 1;
  }

  const indices: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const a = i * 2;
    const b = ((i + 1) % samples) * 2;
    indices.push(a, a + 1, b + 1, a, b + 1, b);
  }

  return finishGeometry(positions, uvs, indices);
}

/** 合并若干条带几何体为单个几何体（降低 draw call）。 */
export function mergeRibbons(geometries: readonly BufferGeometry[]): BufferGeometry {
  if (geometries.length === 1) return geometries[0];

  let positionCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    positionCount += geometry.getAttribute('position').count;
    indexCount += geometry.getIndex()?.count ?? 0;
  }

  const positions = new Float32Array(positionCount * 3);
  const uvs = new Float32Array(positionCount * 2);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const index = geometry.getIndex();
    const count = position.count;
    for (let i = 0; i < count; i += 1) {
      positions[(vertexOffset + i) * 3] = position.getX(i);
      positions[(vertexOffset + i) * 3 + 1] = position.getY(i);
      positions[(vertexOffset + i) * 3 + 2] = position.getZ(i);
      if (uv) {
        uvs[(vertexOffset + i) * 2] = uv.getX(i);
        uvs[(vertexOffset + i) * 2 + 1] = uv.getY(i);
      }
    }
    if (index) {
      for (let i = 0; i < index.count; i += 1) indices[indexOffset + i] = index.getX(i) + vertexOffset;
      indexOffset += index.count;
    }
    vertexOffset += count;
  }

  const positionsOut = positions.slice(0, vertexOffset * 3);
  const uvsOut = uvs.slice(0, vertexOffset * 2);
  return finishGeometry(positionsOut, uvsOut, Array.from(indices.slice(0, indexOffset)));
}

function finishGeometry(
  positions: Float32Array,
  uvs: Float32Array,
  indices: number[],
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}