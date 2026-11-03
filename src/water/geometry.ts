import { BufferAttribute, BufferGeometry } from 'three';
import type { LakeOutline } from './outline';

/**
 * Builds a polar (radial) surface grid that exactly matches the lake outline.
 *
 * A `ShapeGeometry` would only use the outline vertices, leaving no interior
 * vertices to displace for ripples. A polar grid has both a crisp edge (its
 * outermost ring *is* the outline) and enough interior resolution for the wave
 * shader. The surface lies in the XZ plane; the Y displacement is done in the
 * vertex shader.
 */
export function createLakeSurfaceGeometry(
  outline: LakeOutline,
  options: { rings?: number; sectors?: number; y?: number } = {},
): BufferGeometry {
  const rings = Math.max(2, options.rings ?? 44);
  const sectors = Math.max(8, options.sectors ?? outline.sectors);
  const y = options.y ?? 0;

  const vertexCount = (rings + 1) * sectors;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const normals = new Float32Array(vertexCount * 3);

  const cx = outline.center.x;
  const cz = outline.center.y;

  for (let j = 0; j <= rings; j += 1) {
    const t = j / rings;
    for (let i = 0; i < sectors; i += 1) {
      const theta = (i / sectors) * Math.PI * 2;
      const radius = outline.radiusAt(theta) * t;
      const index = j * sectors + i;
      const x = cx + Math.cos(theta) * radius;
      const z = cz + Math.sin(theta) * radius;

      positions[index * 3 + 0] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;

      uvs[index * 2 + 0] = (x - cx) / (outline.maxRadius * 2) + 0.5;
      uvs[index * 2 + 1] = (z - cz) / (outline.maxRadius * 2) + 0.5;

      normals[index * 3 + 1] = 1;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < rings; j += 1) {
    for (let i = 0; i < sectors; i += 1) {
      const next = (i + 1) % sectors;
      const inner = j * sectors + i;
      const innerNext = j * sectors + next;
      const outer = (j + 1) * sectors + i;
      const outerNext = (j + 1) * sectors + next;

      // Winding chosen so the face normal points up (+Y).
      indices.push(inner, innerNext, outerNext);
      indices.push(inner, outerNext, outer);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Builds the shoreline stone apron: a ring whose inner edge tucks just under
 * the waterline (hiding the seam) and whose outer edge rises into a low stone
 * lip that meets the terrain.
 */
export function createShoreRingGeometry(
  outline: LakeOutline,
  options: { bandWidth: number; innerOverlap: number; innerY: number; outerY: number; sectors?: number },
): BufferGeometry {
  const sectors = Math.max(8, options.sectors ?? outline.sectors);
  const positions = new Float32Array(sectors * 2 * 3);
  const uvs = new Float32Array(sectors * 2 * 2);
  const normals = new Float32Array(sectors * 2 * 3);

  const cx = outline.center.x;
  const cz = outline.center.y;

  for (let i = 0; i < sectors; i += 1) {
    const theta = (i / sectors) * Math.PI * 2;
    const radius = outline.radiusAt(theta);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    const innerIndex = i * 2;
    const outerIndex = i * 2 + 1;

    const innerRadius = radius - options.innerOverlap;
    positions[innerIndex * 3 + 0] = cx + cos * innerRadius;
    positions[innerIndex * 3 + 1] = options.innerY;
    positions[innerIndex * 3 + 2] = cz + sin * innerRadius;

    const outerRadius = radius + options.bandWidth;
    positions[outerIndex * 3 + 0] = cx + cos * outerRadius;
    positions[outerIndex * 3 + 1] = options.outerY;
    positions[outerIndex * 3 + 2] = cz + sin * outerRadius;

    uvs[innerIndex * 2 + 0] = i / sectors;
    uvs[innerIndex * 2 + 1] = 0;
    uvs[outerIndex * 2 + 0] = i / sectors;
    uvs[outerIndex * 2 + 1] = 1;

    normals[innerIndex * 3 + 1] = 1;
    normals[outerIndex * 3 + 1] = 1;
  }

  const indices: number[] = [];
  for (let i = 0; i < sectors; i += 1) {
    const next = (i + 1) % sectors;
    const inner = i * 2;
    const innerNext = next * 2;
    const outer = i * 2 + 1;
    const outerNext = next * 2 + 1;
    indices.push(inner, innerNext, outerNext);
    indices.push(inner, outerNext, outer);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Convenience: converts an outline into a flat array of world XZ points. */
export function outlineToFlatArray(outline: LakeOutline): number[] {
  const out: number[] = [];
  for (const point of outline.points) {
    out.push(point.x, 0, point.y);
  }
  return out;
}
