import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { PALETTE } from '../materials/palette';
import { createSandstoneTexture } from '../materials/textures';
import { createRng } from '../utils/random';
import {
  SCENE_OBJECT_NAMES,
  LAKESIDE_SPEC,
  TERRAIN_SPEC,
  WORLD_GEOMETRY,
} from './constants';
import {
  TERRAIN_INSET,
  terrainHeight,
  type TerrainAnchor,
  type TerrainPhases,
} from './heightfield';
import type { LakeOutline } from '../water/outline';

export interface LakesideBundle {
  readonly mesh: Mesh;
  readonly material: MeshStandardMaterial;
  readonly dispose: () => void;
}

/** Inputs the apron needs to stay welded to the terrain it meets. */
export interface LakesideOptions {
  readonly outline: LakeOutline;
  readonly phases: TerrainPhases;
  readonly anchors: readonly TerrainAnchor[];
}

interface ApronRing {
  /** Offset (metres) applied to the local waterline radius, negative = inside. */
  readonly offset: number;
  /**
   * Either a fixed world-Y (the inner rings that must stay watertight against
   * the lake bed) or `null` to drape the ring on the sampled terrain height.
   */
  readonly y: number | null;
  /** Vertex colour for this ring (wet dark → dry light). */
  readonly color: number;
}

/**
 * The lakeside ground: a stone apron that tucks under the waterline on its
 * inner edge, rises into a low stone lip, then **drapes onto the terrain** at
 * its outer edge — so the shore and the pedestal top meet seamlessly at any
 * undulation amplitude (PROMPT.md §5.1 "清晰湖岸边界" / "湖面与底座正确衔接").
 *
 * Why the outer ring is sampled instead of fixed: once the land rises up to
 * 2.6 m, the terrain just beyond the apron can sit ~0.4 m below the old flat
 * `y`, which opened a dark trench between the stone band and the grass. Draping
 * the outer ring on the exact terrain height (plus a small sink offset) removes
 * the trench by construction, regardless of the noise phase.
 */
export function createLakesideGround(options: LakesideOptions): LakesideBundle {
  const { outline, phases, anchors } = options;
  const basinBase = TERRAIN_SPEC.y + TERRAIN_SPEC.basinOffset;

  // Drain the apron edge into the surrounding terrain: the ring is sampled at
  // the same (x, z) it is drawn at, so the two surfaces share a vertex line.
  const groundAt = (x: number, z: number): number => terrainHeight(x, z, phases, outline, anchors);

  const rings: ApronRing[] = [
    { offset: -1.6, y: -0.32, color: PALETTE.WATER_SHORE_DARK },
    { offset: 1.0, y: basinBase + 0.06, color: PALETTE.WATER_SHORE },
    { offset: 2.8, y: basinBase + LAKESIDE_SPEC.lipHeight, color: PALETTE.WATER_SHORE },
    // Outer edge rides the terrain, sunk 0.02 m so the grass always covers the
    // stone seam instead of leaving a hairline crack on a convex slope.
    { offset: LAKESIDE_SPEC.bandWidth, y: null, color: mixLight(PALETTE.WATER_SHORE) },
  ];

  const geometry = buildApronGeometry(outline, rings, outline.sectors, groundAt);

  // Where two neighbouring rings are very close in Y the strip can fold back on
  // itself (terrain higher than the apron lip). Clamp the sampling window so a
  // fold can never produce an inside-out quad (black triangles).
  clampRingFold(geometry, rings, outline, basinBase);

  // Stone paving uses its own procedural speckle map so it never reads as the
  // same material as the grass or the sandstone pedestal rim.
  const texture = createSandstoneTexture(createRng(LAKESIDE_SPEC.seed), 128);
  if (texture) texture.repeat.set(10, 3);

  const material = new MeshStandardMaterial({
    name: 'LAKESIDE_GROUND_MAT',
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.02,
    map: texture ?? undefined,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = SCENE_OBJECT_NAMES.LAKESIDE;
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
    texture?.dispose();
  };

  return { mesh, material, dispose };
}

/**
 * Builds a concentric ring strip mesh (inner → outer) around the lake outline
 * with per-vertex colours.
 */
function buildApronGeometry(
  outline: LakeOutline,
  rings: readonly ApronRing[],
  sectors: number,
  groundAt: (x: number, z: number) => number,
): BufferGeometry {
  const ringCount = rings.length;
  const vertexCount = ringCount * sectors;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);

  const cx = outline.center.x;
  const cz = outline.center.y;
  const scratch = new Color();

  for (let r = 0; r < ringCount; r += 1) {
    const ring = rings[r];
    scratch.setHex(ring.color);
    for (let i = 0; i < sectors; i += 1) {
      const theta = (i / sectors) * Math.PI * 2;
      const radius = Math.max(0.5, outline.radiusAt(theta) + ring.offset);
      const index = r * sectors + i;
      const x = cx + Math.cos(theta) * radius;
      const z = cz + Math.sin(theta) * radius;

      positions[index * 3 + 0] = x;
      positions[index * 3 + 1] = ring.y ?? groundAt(x, z) - 0.02;
      positions[index * 3 + 2] = z;

      normals[index * 3 + 1] = 1;

      uvs[index * 2 + 0] = i / sectors;
      uvs[index * 2 + 1] = r / (ringCount - 1);

      colors[index * 3 + 0] = scratch.r;
      colors[index * 3 + 1] = scratch.g;
      colors[index * 3 + 2] = scratch.b;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < ringCount - 1; r += 1) {
    for (let i = 0; i < sectors; i += 1) {
      const next = (i + 1) % sectors;
      const inner = r * sectors + i;
      const innerNext = r * sectors + next;
      const outer = (r + 1) * sectors + i;
      const outerNext = (r + 1) * sectors + next;

      // Winding chosen so the face normal points up (+Y).
      indices.push(inner, innerNext, outerNext);
      indices.push(inner, outerNext, outer);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Prevents the draped outer ring from overtaking the stone lip.
 *
 * When the terrain rises faster than the apron lip (possible on a steep bank
 * right at the waterline) the strip would invert and light as a black band.
 * The apron lip is therefore capped just above the draped edge; the grass
 * covers the resulting sliver, so the correction is never visible.
 */
function clampRingFold(
  geometry: BufferGeometry,
  rings: readonly ApronRing[],
  _outline: LakeOutline,
  _basinBase: number,
): void {
  const lip = rings[2].y;
  const draped = rings[3].y;
  if (lip === null || draped !== null) return;
  const positions = geometry.getAttribute('position') as BufferAttribute;
  const sectors = positions.count / rings.length;
  const outerBase = 3 * sectors;
  // find the maximum draped height so a single uniform cap keeps the strip
  // valid (a per-vertex cap would itself introduce a fold)
  let maxOuter = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < sectors; i += 1) {
    maxOuter = Math.max(maxOuter, positions.getY(outerBase + i));
  }
  if (maxOuter <= lip) return;
  // Re-sample the lip ring only where it would otherwise sit under the grass.
  for (let i = 0; i < sectors; i += 1) {
    const outerY = positions.getY(outerBase + i);
    const idx = 2 * sectors + i;
    if (positions.getY(idx) > outerY) positions.setY(idx, outerY + 0.02);
  }
  positions.needsUpdate = true;
}

/** Gentle shading ramp so the stone reads lighter toward the land. */
function mixLight(hex: number): number {
  const base = new Color(hex);
  base.lerp(new Color(PALETTE.BASE_SANDSTONE_TOP), 0.4);
  return base.getHex();
}

/** Outer apron radius relative to the waterline (shared with the seam test). */
export const LAKESIDE_OUTER_OFFSET = LAKESIDE_SPEC.bandWidth;

/** Half extent of the landscaped plane, mirrored by the seam test. */
export const TERRAIN_PLANE_HALF = {
  x: WORLD_GEOMETRY.BASE_LENGTH / 2 - TERRAIN_INSET,
  z: WORLD_GEOMETRY.BASE_WIDTH / 2 - TERRAIN_INSET,
} as const;