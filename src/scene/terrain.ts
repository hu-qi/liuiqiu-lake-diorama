import {
  BufferAttribute,
  Color,
  PlaneGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { PALETTE } from '../materials/palette';
import { createGrassTexture } from '../materials/textures';
import { createRng, type Rng } from '../utils/random';
import { clamp } from '../utils/math';
import {
  createTerrainHeightSampler,
  terrainHeight,
  TERRAIN_INSET,
  type TerrainAnchor,
  type TerrainPhases,
} from './heightfield';
import { SCENE_OBJECT_NAMES, TERRAIN_SPEC, WORLD_GEOMETRY } from './constants';
import type { LakeOutline } from '../water/outline';

export interface TerrainBundle {
  readonly mesh: Mesh;
  readonly material: MeshStandardMaterial;
  readonly dispose: () => void;
}

/** A point the terrain must stay flat around (district / landmark / station). */
export type TerrainFlattenAnchor = TerrainAnchor;

/**
 * Builds the landscaped top surface of the pedestal.
 *
 * The surface is an undulating grass plane, inset from the pedestal edge so a
 * light sandstone rim stays visible. Height noise is suppressed inside the lake
 * footprint (terrain can never poke through the water) and flattened around
 * every building anchor (nothing floats / sinks).
 *
 * Three layers are summed by the shared `terrainHeight()` helper:
 *  - a static basin bias that lifts every district plateau above the water;
 *  - a low-frequency landform that gives the park its rolling silhouette;
 *  - a high-frequency micro relief that breaks up large facets so the grass
 *    does not read as a plastic sheet.
 */
export function createTerrain(
  outline: LakeOutline,
  anchors: readonly TerrainFlattenAnchor[] = [],
): TerrainBundle {
  const width = WORLD_GEOMETRY.BASE_LENGTH - TERRAIN_INSET * 2;
  const depth = WORLD_GEOMETRY.BASE_WIDTH - TERRAIN_INSET * 2;

  const geometry = new PlaneGeometry(width, depth, TERRAIN_SPEC.segmentsX, TERRAIN_SPEC.segmentsZ);
  // PlaneGeometry lives in XY; rotate it flat into XZ (Y-up convention).
  geometry.rotateX(-Math.PI / 2);

  const rng = createRng(TERRAIN_SPEC.seed);
  const phases = terrainPhases(TERRAIN_SPEC.seed);

  const positions = geometry.getAttribute('position') as BufferAttribute;
  const vertexCount = positions.count;
  const colors = new Float32Array(vertexCount * 3);

  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;

  // Displacement goes through the shared `terrainHeight()` — the *same*
  // function the CPU sampler exposes. One formula ⇒ props can never drift
  // from the visible mesh (the previous revision duplicated it inline).
  for (let i = 0; i < vertexCount; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const height = terrainHeight(x, z, phases, outline, anchors);
    positions.setY(i, height);
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
  }

  // Second pass for vertex colour: needs the final height extremes for the
  // normalisation, so it cannot be folded into the displacement loop.
  paintHeightTint(colors, positions, minHeight, maxHeight);

  positions.needsUpdate = true;
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const texture = createGrassTexture(rng);
  const material = new MeshStandardMaterial({
    name: 'TERRAIN_MAT',
    // With a colour map present the albedo stays white so the texel brightness
    // is not double-darkened; the per-vertex tint then modulates it.
    color: texture ? 0xffffff : PALETTE.TERRAIN_GRASS,
    roughness: 0.96,
    metalness: 0,
    map: texture ?? undefined,
    vertexColors: true,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = SCENE_OBJECT_NAMES.TERRAIN;
  mesh.position.set(0, 0, 0);
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
 * Height sampler for scenery placed on the terrain (trees, kerbs, channels).
 * Shares the exact noise phases the mesh was built with, so props sit on the
 * visible surface instead of the flat baseline.
 */
export function createTerrainSampler(
  outline: LakeOutline,
  anchors: readonly TerrainFlattenAnchor[],
  seed: number = TERRAIN_SPEC.seed,
): (x: number, z: number) => number {
  return createTerrainHeightSampler({ outline, phases: terrainPhases(seed), anchors });
}

/**
 * The exact noise phases the terrain mesh is built from.
 *
 * Exported so the lakeside apron (and any future draped geometry) can sample
 * the *same* surface: sharing the phases is what keeps the stone/grass seam
 * watertight even when the land undulates.
 */
export function terrainPhases(seed: number = TERRAIN_SPEC.seed): TerrainPhases {
  return derivePhases(createRng(seed));
}

/** Consumes the same five draws `createTerrain` takes, in the same order. */
function derivePhases(rng: Rng): TerrainPhases {
  return {
    p1: rng.range(0, Math.PI * 2),
    p2: rng.range(0, Math.PI * 2),
    p3: rng.range(0, Math.PI * 2),
    d1: rng.range(0, Math.PI * 2),
    d2: rng.range(0, Math.PI * 2),
  };
}

/**
 * Tints the grass by height: troughs read a touch darker/cooler, ridges a
 * warmer dry green. The mix strength stays low so the authored palette wins.
 */
function paintHeightTint(
  colors: Float32Array,
  positions: BufferAttribute,
  minHeight: number,
  maxHeight: number,
): void {
  const lowTint = new Color(PALETTE.TERRAIN_GRASS_DARK);
  const highTint = new Color(PALETTE.TERRAIN_GRASS);
  const tint = new Color();
  const span = Math.max(1e-6, maxHeight - minHeight);

  for (let i = 0; i < positions.count; i += 1) {
    const t = clamp((positions.getY(i) - minHeight) / span, 0, 1);
    // Ease so the mid-range stays close to the authored grass colour.
    const mix = t * t * (3 - 2 * t) * TERRAIN_SPEC.grassTintStrength;
    tint.copy(lowTint).lerp(highTint, mix);
    colors[i * 3 + 0] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
}