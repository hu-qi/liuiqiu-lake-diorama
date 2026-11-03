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
import { SCENE_OBJECT_NAMES, LAKESIDE_SPEC, TERRAIN_SPEC } from './constants';
import type { LakeOutline } from '../water/outline';

export interface LakesideBundle {
  readonly mesh: Mesh;
  readonly material: MeshStandardMaterial;
  readonly dispose: () => void;
}

interface ApronRing {
  /** Offset (metres) applied to the local waterline radius, negative = inside. */
  readonly offset: number;
  readonly y: number;
  /** Vertex colour for this ring (wet dark → dry light). */
  readonly color: number;
}

/**
 * The lakeside ground: a stone apron that tucks under the waterline on its
 * inner edge, rises into a low stone lip, then falls back to the terrain level
 * at its outer edge — so the shore and the pedestal top meet seamlessly
 * (PROMPT.md §5.1 "清晰湖岸边界" / "湖面与底座正确衔接").
 */
export function createLakesideGround(outline: LakeOutline): LakesideBundle {
  const rings: ApronRing[] = [
    { offset: -1.6, y: -0.32, color: PALETTE.WATER_SHORE_DARK },
    { offset: 1.0, y: 0.1, color: PALETTE.WATER_SHORE },
    { offset: 2.8, y: LAKESIDE_SPEC.y + LAKESIDE_SPEC.lipHeight, color: PALETTE.WATER_SHORE },
    // Outer edge drops a hair below the terrain so the grass always overlaps
    // the stone edge (e.g. where the terrain rises beside the bank) instead of
    // opening a visible crack along the shoreline.
    { offset: LAKESIDE_SPEC.bandWidth, y: TERRAIN_SPEC.y - 0.02, color: mixLight(PALETTE.WATER_SHORE) },
  ];

  const geometry = buildApronGeometry(outline, rings, outline.sectors);

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

      positions[index * 3 + 0] = cx + Math.cos(theta) * radius;
      positions[index * 3 + 1] = ring.y;
      positions[index * 3 + 2] = cz + Math.sin(theta) * radius;

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

function mixLight(hex: number): number {
  const base = new Color(hex);
  base.lerp(new Color(PALETTE.BASE_SANDSTONE_TOP), 0.4);
  return base.getHex();
}