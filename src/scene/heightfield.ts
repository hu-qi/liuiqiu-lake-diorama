import { smoothstep } from '../utils/math';
import { LAKE_SPEC, TERRAIN_SPEC } from './constants';
import type { LakeOutline } from '../water/outline';

/**
 * CPU-side mirror of the terrain height field (`terrain.ts`).
 *
 * The GPU mesh is the visual truth, but scenery placed *on* the land — trees,
 * kerbs, water channels — has to follow the undulation or it sinks / floats.
 * Keeping the formula in one place means the CPU and the mesh can never drift
 * apart.
 *
 * The sampler is **analytic** (pure noise + masks), so its accuracy does not
 * depend on the mesh resolution. Both the mesh builder and every prop use this
 * exact function, which is what makes the ground-water gap zero by
 * construction rather than by tuning.
 *
 * A sampler returns the **world Y of the ground surface** (terrain base offset
 * and basin bias included), not a delta on top of it.
 */

/** Inset of the landscaped surface from the pedestal edge (`terrain.ts`). */
export const TERRAIN_INSET = 3;

/** Full turn in radians, used for safe angle wrapping. */
const TAU = Math.PI * 2;

/**
 * Octave balance of the low-frequency landform.
 *
 * Normalised so the three harmonics sum to ~±0.75; combined with
 * `TERRAIN_SPEC.amplitude` this puts the relief at the authored peak-to-peak
 * amplitude instead of letting the octave weights inflate it.
 */
const LANDFORM_OCTAVES = {
  weight1: 0.6,
  weight2: 0.3,
  weight3: 0.15,
  /** Wavenumbers (rad / m). Deliberately tiny: wide, soft parkland. */
  kx1: 0.035,
  kz1: 0.03,
  k2: 0.055,
  k3: 0.08,
  /** Global gain that brings the octave sum back to unit range. */
  gain: 0.75,
} as const;

/** Detail octave balance (shortest wavelength ≈ 8 m at frequency 2.9). */
const DETAIL_OCTAVES = {
  weight1: 0.6,
  weight2: 0.4,
  kx1: 0.145,
  kz1: 0.121,
  k2: 0.093,
} as const;

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
  /**
   * Flattening footprint of this anchor (metres).
   *
   * Not every anchor needs the same disc. Districts carry whole building
   * footprints and spur roads, so they get the full `flatInnerRadius` /
   * `flatOuterRadius` plateau. A bridge, a station or a channel midpoint only
   * needs a local pad where it meets the ground; giving those the full 36 m
   * radius made their discs reach into a neighbouring district (bridges sit as
   * close as 25 m to a district centre), which tilted the district "plateau"
   * by a few millimetres and broke the perfectly-flat guarantee.
   *
   * Omitted ⇒ the building-default radii.
   */
  readonly innerRadius?: number;
  readonly outerRadius?: number;
}

export interface TerrainSamplerOptions {
  readonly outline: LakeOutline;
  readonly phases: TerrainPhases;
  /** Flattening anchors (district / landmark centres). */
  readonly anchors: readonly TerrainAnchor[];
}

/** Two-octave landform noise, identical to the displacement in `terrain.ts`. */
export function landformNoise(x: number, z: number, phases: TerrainPhases): number {
  const o = LANDFORM_OCTAVES;
  return (
    o.gain *
    (o.weight1 * Math.sin(x * o.kx1 + phases.p1) * Math.cos(z * o.kz1 + phases.p2) +
      o.weight2 * Math.sin((x + z) * o.k2 + phases.p3) +
      o.weight3 * Math.cos((x - z) * o.k3 - phases.p2))
  );
}

/** High-frequency micro relief, identical to the second octave in `terrain.ts`. */
export function detailNoise(x: number, z: number, phases: TerrainPhases): number {
  const f = TERRAIN_SPEC.detailFrequency;
  const o = DETAIL_OCTAVES;
  return (
    o.weight1 * Math.sin(x * o.kx1 * f + phases.d1) * Math.cos(z * o.kz1 * f + phases.d2) +
    o.weight2 * Math.sin((x - z) * o.k2 * f + phases.p2)
  );
}

/**
 * 0 inside the lake and its stone apron, 1 out on the open land.
 *
 * The inner edge sits `lakeMaskInner` metres **landward of the waterline**, so
 * the entire water body is masked to exactly zero and the terrain can never
 * poke through the water. The ramp then spreads the basin-to-plateau rise over
 * `lakeMaskOuter − lakeMaskInner` metres, which is what turns the old cliff
 * into a graded bank.
 *
 * The stone apron deliberately **overlaps** the start of that ramp. Its outer
 * edge (`bandWidth = 6.5 m`) stays just below the waterline and its paving
 * covers the low, gently rising ground; the grass that emerges beyond it is
 * already a few centimetres above the water, so no green fringe can sprout
 * *through* the stone. Keeping the apron shorter than `dryShoreOffset()` is
 * therefore correct — the inverse (apron wider than the dry-shore line) is
 * what produces the fringe.
 */
export function lakeMask(outline: LakeOutline, x: number, z: number): number {
  const dx = x - outline.center.x;
  const dz = z - outline.center.y;
  const distance = Math.hypot(dx, dz);
  // `atan2` may return exactly `-π` (plainly representable), which `+2π` maps
  // to exactly `2π` — an angle the outline generator never sampled and whose
  // value can fall back to the *minimum* radius. Wrapping with `%` keeps every
  // angle inside `[0, 2π)` so the lookup always matches a sampled sector.
  const raw = Math.atan2(dz, dx);
  const normalized = ((raw % TAU) + TAU) % TAU;
  const radius = outline.radiusAt(normalized);
  return smoothstep(
    radius + TERRAIN_SPEC.lakeMaskInner,
    radius + TERRAIN_SPEC.lakeMaskOuter,
    distance,
  );
}

/**
 * 0 near a building anchor, 1 far away.
 *
 * Each anchor contributes its own smoothstep band, and the result is the
 * product of them, i.e. "flat where *any* anchor demands flat". Using the
 * product instead of a nearest-anchor lookup keeps the function continuous
 * even when the nearest anchor switches (which used to make the mask jump
 * whenever a bridge disc and a district disc overlapped).
 */
export function flatMask(anchors: readonly TerrainAnchor[], x: number, z: number): number {
  if (anchors.length === 0) return 1;
  let mask = 1;
  for (const anchor of anchors) {
    const inner = anchor.innerRadius ?? TERRAIN_SPEC.flatInnerRadius;
    const outer = anchor.outerRadius ?? TERRAIN_SPEC.flatOuterRadius;
    // Cheap reject: far anchors cannot lower the product (smoothstep saturates
    // at 1 beyond `outer`), so most of the plane skips the maths entirely.
    if (mask === 1) {
      const dx = x - anchor.x;
      const dz = z - anchor.z;
      if (dx * dx + dz * dz >= outer * outer) continue;
    }
    mask *= smoothstep(inner, outer, Math.hypot(x - anchor.x, z - anchor.z));
    if (mask === 0) return 0;
  }
  return mask;
}

/**
 * Distance (metres, along the radius) from the waterline at which the ground
 * first rises above the water surface.
 *
 * Trivial to solve analytically: the height is `TERRAIN_SPEC.y + mask × K`, so
 * it crosses `surfaceY` exactly where `mask` equals the dry-shore threshold
 * `(surfaceY − TERRAIN_SPEC.y) / basinOffset`. `smoothstep` is monotonic, so the
 * crossing exists iff that threshold lies in (0, 1) — checked here so a
 * mis-tuned constant fails loudly instead of silently flooding the basin.
 *
 * Use: it tells you **where the grass line is**. That point must sit *outside*
 * `LAKESIDE_SPEC.bandWidth`, otherwise grass would appear inside the stone
 * apron; `terrain.test.ts` asserts this. The apron itself is intentionally
 * narrower than the crossing — see the note on `lakeMask`.
 */
export function dryShoreOffset(): number {
  const threshold = (LAKE_SPEC.surfaceY - TERRAIN_SPEC.y) / TERRAIN_SPEC.basinOffset;
  if (!(threshold > 0 && threshold < 1)) {
    throw new Error(
      `terrain: basin bias cannot lift land above the water (threshold ${threshold}). ` +
        `surfaceY=${LAKE_SPEC.surfaceY}, terrainY=${TERRAIN_SPEC.y}, basinOffset=${TERRAIN_SPEC.basinOffset}`,
    );
  }
  // Invert `t²(3 − 2t)` with the closed-form root t = 0.5 − sin(asin(1 − 2x) / 3).
  const t = 0.5 - Math.sin(Math.asin(1 - 2 * threshold) / 3);
  return TERRAIN_SPEC.lakeMaskInner + (TERRAIN_SPEC.lakeMaskOuter - TERRAIN_SPEC.lakeMaskInner) * t;
}

/** Cached at module load so the invariant is asserted even if nothing queries it. */
export const DRY_SHORE_OFFSET = dryShoreOffset();

/**
 * Single source of truth for the ground surface height.
 *
 * Composition (all terms in metres above the pedestal top):
 *
 *     y = TERRAIN_SPEC.y                    fixed skim above the rock cap
 *       + basinOffset * lakeMask            terrace bias — LAND ONLY
 *       + noise * (lakeMask * flatMask)     undulation
 *
 * The basin bias is multiplied by `lakeMask`, not added unconditionally. That
 * distinction is the whole lake-vs-land contract: the water surface sits at
 * `LAKE_SPEC.surfaceY = 0.06`, so an unconditional `+0.40` would pin the basin
 * floor at 0.42 — 36 cm *above* the waterline, i.e. the lake would be buried
 * under the terrain and disappear. Gating it on `lakeMask` leaves the basin
 * floor at `TERRAIN_SPEC.y = 0.02`, safely 4 cm below the water, and still
 * lifts every district plateau to `0.42 + noise`, a readable terrace above the
 * waterline.
 *
 * Inside the lake footprint `lakeMask` is exactly 0, so both the bias and the
 * noise vanish and the floor is a perfectly flat, dry-shore-safe slab.
 */
export function terrainHeight(
  x: number,
  z: number,
  phases: TerrainPhases,
  outline: LakeOutline,
  anchors: readonly TerrainAnchor[],
): number {
  const shore = lakeMask(outline, x, z);
  const relief = shore * flatMask(anchors, x, z);
  return (
    TERRAIN_SPEC.y +
    TERRAIN_SPEC.basinOffset * shore +
    (landformNoise(x, z, phases) * TERRAIN_SPEC.amplitude +
      detailNoise(x, z, phases) * TERRAIN_SPEC.detailAmplitude) *
      relief
  );
}

/**
 * Creates a sampler for the terrain surface height at any world XZ point.
 * The formula is continuous everywhere, so props anywhere on the plane (rim
 * included) sit exactly on the visible surface.
 */
export function createTerrainHeightSampler(
  options: TerrainSamplerOptions,
): (x: number, z: number) => number {
  const { outline, phases, anchors } = options;
  // NOTE: deliberately no early-out outside the landscaped plane. The mesh is a
  // single continuous plane, so its surface extends to the pedestal edge; an
  // early-out here would make props on the rim sample a flat baseline while the
  // grass beneath them is undulating.
  return (x: number, z: number): number => terrainHeight(x, z, phases, outline, anchors);
}