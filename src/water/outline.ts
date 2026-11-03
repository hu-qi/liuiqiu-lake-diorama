import { Vector2 } from 'three';
import { LAKE_SPEC } from '../scene/constants';
import { createRng } from '../utils/random';

/**
 * Radial description of the lake outline.
 *
 * The lake is modelled as a star-shaped region around a centre: for any angle
 * θ, the waterline is at `radiusAt(θ)`. This keeps the surface grid aligned
 * with the outline (crisp edge, no clipping artefacts) and makes point-in-lake
 * tests a single radius comparison.
 */
export interface LakeOutline {
  readonly center: Vector2;
  readonly radiusAt: (theta: number) => number;
  /** Closed outline sampled at `sectors` points, in world XZ. */
  readonly points: readonly Vector2[];
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly sectors: number;
}

interface ShapeSpec {
  readonly baseRadius: number;
  readonly irregularity: number;
  readonly sectors: number;
}

/**
 * Builds a natural, irregular lake outline from a seeded RNG so the shoreline
 * is identical on every reload (PROMPT.md §5.1 — natural irregular contour).
 */
export function createLakeOutline(spec: ShapeSpec = LAKE_SPEC): LakeOutline {
  const rng = createRng(LAKE_SPEC.seed);

  // Deterministic harmonic phases — three octaves of low-frequency wobble plus
  // a gentle east-west elongation so the lake reads as a real basin.
  const phase1 = rng.range(0, Math.PI * 2);
  const phase2 = rng.range(0, Math.PI * 2);
  const phase3 = rng.range(0, Math.PI * 2);
  const elongation = rng.range(0.08, 0.14);

  const radiusAt = (theta: number): number => {
    const wobble =
      0.62 * Math.sin(3 * theta + phase1) +
      0.28 * Math.sin(5 * theta + phase2) +
      0.16 * Math.sin(8 * theta + phase3);
    const stretch = 1 + elongation * Math.cos(2 * theta);
    return spec.baseRadius * stretch * (1 + spec.irregularity * wobble);
  };

  const points: Vector2[] = [];
  let minRadius = Number.POSITIVE_INFINITY;
  let maxRadius = 0;

  for (let i = 0; i < spec.sectors; i += 1) {
    const theta = (i / spec.sectors) * Math.PI * 2;
    const radius = radiusAt(theta);
    minRadius = Math.min(minRadius, radius);
    maxRadius = Math.max(maxRadius, radius);
    points.push(new Vector2(Math.cos(theta) * radius, Math.sin(theta) * radius));
  }

  return {
    center: new Vector2(LAKE_SPEC.center.x, LAKE_SPEC.center.z),
    radiusAt,
    points,
    minRadius,
    maxRadius,
    sectors: spec.sectors,
  };
}

/**
 * Tests whether a world-space XZ point lies inside the lake.
 * `epsilon` shrinks the lake slightly so shoreline objects placed exactly on
 * the waterline are treated as land.
 */
export function isInsideLake(outline: LakeOutline, x: number, z: number, epsilon = 0): boolean {
  const dx = x - outline.center.x;
  const dz = z - outline.center.y;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return true;
  const theta = Math.atan2(dz, dx);
  const normalized = theta < 0 ? theta + Math.PI * 2 : theta;
  return distance <= outline.radiusAt(normalized) - epsilon;
}