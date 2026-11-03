import { smoothstep } from '../utils/math';
import { LAKESIDE_SPEC, TERRAIN_SPEC, WORLD_GEOMETRY } from './constants';
import type { LakeOutline } from '../water/outline';

/**
 * CPU-side mirror of the terrain height field (`terrain.ts`).
 *
 * The GPU mesh is the visual truth, but scenery placed *on* the land — trees,
 * kerbs, water channels — has to follow the undulation or it sinks / floats.
 * Keeping the formula in one place means the CPU and the mesh can never drift
 * apart.
 *
 * A sampler returns the **world Y of the ground surface** (terrain base offset
 * included), not a delta on top of it.
 */

/** Inset of the landscaped surface from the pedestal edge (`terrain.ts`). */
export const TERRAIN_INSET = 3;

/** Noise phases shared by the mesh builder and the CPU sampler. */
export interface TerrainPhases {
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  readonly d1: number;
  readonly d2: number;
}

export interface TerrainAnchor {
  readonly x: number;
  readonly z: number;
}

export interface TerrainSamplerOptions {
  readonly outline: LakeOutline;
  readonly phases: TerrainPhases;
  /** Flattening anchors (district / landmark centres). */
  readonly anchors: readonly TerrainAnchor[];
}

/** Two-octave landform noise, identical to the displacement in `terrain.ts`. */
export function landformNoise(x: number, z: number, phases: TerrainPhases): number {
  return (
    0.6 * Math.sin(x * 0.035 + phases.p1) * Math.cos(z * 0.03 + phases.p2) +
    0.3 * Math.sin((x + z) * 0.055 + phases.p3) +
    0.15 * Math.cos((x - z) * 0.08 - phases.p2)
  );
}

/** High-frequency micro relief, identical to the second octave in `terrain.ts`. */
export function detailNoise(x: number, z: number, phases: TerrainPhases): number {
  const f = TERRAIN_SPEC.detailFrequency;
  return (
    0.6 * Math.sin(x * 0.145 * f + phases.d1) * Math.cos(z * 0.121 * f + phases.d2) +
    0.4 * Math.sin((x - z) * 0.093 * f + phases.p2)
  );
}

/** 0 inside the lake, 1 beyond the stone apron (same ramp as the mesh). */
export function lakeMask(outline: LakeOutline, x: number, z: number): number {
  const dx = x - outline.center.x;
  const dz = z - outline.center.y;
  const distance = Math.hypot(dx, dz);
  const theta = Math.atan2(dz, dx);
  const normalized = theta < 0 ? theta + Math.PI * 2 : theta;
  const radius = outline.radiusAt(normalized);
  return smoothstep(
    radius + LAKESIDE_SPEC.bandWidth - 1,
    radius + LAKESIDE_SPEC.bandWidth + 7,
    distance,
  );
}

/** 0 near a building anchor, 1 far away. */
export function flatMask(anchors: readonly TerrainAnchor[], x: number, z: number): number {
  if (anchors.length === 0) return 1;
  let distance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const d = Math.hypot(x - anchor.x, z - anchor.z);
    if (d < distance) distance = d;
  }
  return smoothstep(TERRAIN_SPEC.flatInnerRadius, TERRAIN_SPEC.flatOuterRadius, distance);
}

/**
 * Creates a sampler for the terrain surface height at any world XZ point.
 * Points outside the landscaped plane return the flat baseline.
 */
export function createTerrainHeightSampler(
  options: TerrainSamplerOptions,
): (x: number, z: number) => number {
  const { outline, phases, anchors } = options;
  const halfWidth = WORLD_GEOMETRY.BASE_LENGTH / 2 - TERRAIN_INSET;
  const halfDepth = WORLD_GEOMETRY.BASE_WIDTH / 2 - TERRAIN_INSET;

  return (x: number, z: number): number => {
    if (Math.abs(x) > halfWidth || Math.abs(z) > halfDepth) return TERRAIN_SPEC.y;
    const mask = lakeMask(outline, x, z) * flatMask(anchors, x, z);
    return (
      TERRAIN_SPEC.y +
      (landformNoise(x, z, phases) * TERRAIN_SPEC.amplitude +
        detailNoise(x, z, phases) * TERRAIN_SPEC.detailAmplitude) *
        mask
    );
  };
}