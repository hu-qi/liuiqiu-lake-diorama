import { PALETTE } from '../materials/palette';

/**
 * World-geometry constants for the sandbox model.
 *
 * Project conventions (agreed with the modelling engine):
 *  - Three.js Y-up, 1 unit = 1 metre.
 *  - The pedestal is 260 × 170 × 10 (length × width × height) centred on the
 *    origin in XZ; its top surface sits at y = 0, its underside at y = -10.
 *  - Every building must rest on or above y = 0 — nothing floats.
 */
export const WORLD_GEOMETRY = {
  /** Pedestal length along X. */
  BASE_LENGTH: 260,
  /** Pedestal width along Z. */
  BASE_WIDTH: 170,
  /** Pedestal total height. */
  BASE_HEIGHT: 10,
  /** Top surface of the pedestal (buildings rest on this plane). */
  BASE_TOP_Y: 0,
  /** Underside of the pedestal. */
  BASE_BOTTOM_Y: -10,
} as const;

/** One geological / material stratum of the pedestal, ordered top → bottom. */
export interface BaseLayerSpec {
  readonly name: string;
  readonly color: number;
  readonly height: number;
  /** Small outward inset so the strata read as a real cut-through model. */
  readonly inset: number;
  /** Optional stratified rock texture identifier. */
  readonly texture: 'sandstone' | 'green' | 'grey' | null;
}

/**
 * Stratigraphy of the thick pedestal (PROMPT.md §8.2):
 * a light sandstone cap, a green + grey geological band, and a deep grey base.
 * Heights sum to `WORLD_GEOMETRY.BASE_HEIGHT`.
 */
export const BASE_LAYERS: readonly BaseLayerSpec[] = [
  {
    name: 'BASE_SANDSTONE_TOP',
    color: PALETTE.BASE_SANDSTONE_TOP,
    height: 3.4,
    inset: 0,
    texture: 'sandstone',
  },
  {
    name: 'BASE_GEOLOGY_GREEN',
    color: PALETTE.BASE_GEOLOGY_GREEN,
    height: 2.1,
    // Small inset only: a deep recess let the sandstone cap overhang and
    // shadow the band, which visually erased the stratigraphy.
    inset: 0.3,
    texture: 'green',
  },
  {
    name: 'BASE_GEOLOGY_GREY',
    color: PALETTE.BASE_GEOLOGY_GREY,
    height: 1.8,
    inset: 0.3,
    texture: 'grey',
  },
  {
    name: 'BASE_DEEP_LAYER',
    color: PALETTE.BASE_DEEP_GREY,
    height: 2.7,
    inset: 0.9,
    texture: 'grey',
  },
] as const;

/** Front-face metal nameplate dimensions (kept inside the sandstone stratum). */
export const NAMEPLATE_SPEC = {
  width: 92,
  height: 3.4,
  y: -2.0,
} as const;

/** Lianqiu Lake layout. The surface is generated procedurally in `src/water`. */
export const LAKE_SPEC = {
  /** Centred so the lake sits in the middle of the pedestal (PROMPT.md §1). */
  center: { x: 0, z: 0 },
  /** Nominal radius before the outline's low-frequency irregularity. */
  baseRadius: 40,
  /** Radial irregularity amplitude as a fraction of `baseRadius`. */
  irregularity: 0.22,
  /** Sector count for the shoreline outline and the surface grid. */
  sectors: 180,
  /** Concentric rings of the radial surface grid. */
  rings: 44,
  /** Water surface height above the pedestal top. */
  surfaceY: 0.06,
  /**
   * Depth of the water column (metres). The lake bed is drawn this far below
   * the waterline; shore colouring and the Fresnel tint read this value.
   */
  waterDepth: 0.62,
  /** Seed for the deterministic outline (same lake every reload). */
  seed: 20240711,
} as const;

/**
 * Water material tuning (Fresnel / shimmer / ripple).
 *
 * The surface must stay visually "flat" — the ripple amplitude is deliberately
 * capped at 0.06 m so the lake never reads as a choppy sea, and the mirrored
 * reflection is sampled through a normal-based distortion of at most a few
 * percent of the water plane.
 */
export const WATER_SPEC = {
  /** Peak vertical ripple displacement (metres). Hard ceiling: 0.06. */
  rippleAmplitude: 0.05,
  /** Ripple angular frequency multiplier (higher = shorter waves). */
  rippleScale: 1.35,
  /** UV-space scale of the procedural ripple pattern. */
  normalScale: 0.22,
  /** How strongly ripples distort the mirrored reflection (0–1). */
  distortionScale: 0.045,
  /** Fresnel exponent: higher = reflection only at grazing angles. */
  fresnelPower: 2.8,
  /** Maximum share of the mirror image blended into the final colour. */
  reflectionStrength: 0.82,
  /** Planar mirror render target edge (px). One extra pass, not per-object. */
  reflectionTextureSize: 512,
  /** Clip bias of the oblique reflection frustum (avoids shoreline crawl). */
  clipBias: 0.02,
  /** Sky colour blended in at grazing angles. */
  skyTint: 0xd2d8d5,
  /** Specular glitter tightness for the sun highlight. */
  glitterPower: 90,
  /** Specular glitter strength. */
  glitterStrength: 0.35,
} as const;

/**
 * Terrain surface: a hair above the sandstone cap to avoid z-fighting.
 *
 * Undulation is staged in three layers:
 *  - `basinOffset` — a **staticterrace bias**, applied **only where `lakeMask`
 *    is non-zero** (i.e. on land, never inside the lake). It lifts every
 *    district plateau to ≈ 0.42 m + undulation, so each district reads as a
 *    terrace above the 0.06 m waterline. Gating it on `lakeMask` is essential:
 *    applied unconditionally it would pin the basin floor at 0.42 m — 36 cm
 *    *above* the water — and bury the lake under its own terrain;
 *  - `amplitude` — low-frequency landform (the silhouette you read at a glance);
 *  - `detailAmplitude` — high-frequency micro relief that kills the "plastic
 *    flat plane" look. Deliberately **decoupled** from `amplitude` (0.40 m,
 *    not a fixed 25 % share): scaling it with the base would blow it up to
 *    ~0.75 m and turn the hills into noise.
 *
 * Land height is `TERRAIN_SPEC.y + lakeMask × (basinOffset + relief)`, so the
 * shoreline transition is a pure `lakeMask` ramp: the gradient is
 * `basinOffset / (lakeMaskOuter − lakeMaskInner)` ≈ 2.9 % (1.6°) — a graded
 * bank, not the 51 % (27°) wall the previous `smoothstep(radius+5.5,
 * radius+13.5)` produced at this amplitude.
 *
 * Both noise layers are suppressed inside the lake footprint and flattened
 * around every building; the flatten radii are hard guarantees, see the
 * numerical audit in `TERRAIN_SPEC` comments below.
 */
export const TERRAIN_SPEC = {
  y: 0.02,
  /** Grid resolution of the undulating land surface. */
  segmentsX: 200,
  segmentsZ: 140,
  /**
   * Static upward bias of the land, multiplied by `lakeMask` (metres).
   * The lake floor therefore stays at `y = 0.02`, 4 cm under the 0.06 m water.
   */
  basinOffset: 0.4,
  /** Maximum low-frequency height variation (metres). */
  amplitude: 2.6,
  /** High-frequency relief amplitude (metres). Decoupled from `amplitude`. */
  detailAmplitude: 0.4,
  /**
   * Detail-noise frequency multiplier relative to the base octave.
   * Shortest detail wavelength ≈ 2π / (0.093 × 2.9 × √2) ≈ 8.2 m, i.e. ≈ 5.8
   * grid cells at the 200 × 140 resolution — above the 4-cell Nyquist
   * requirement, so the micro relief reads as texture and not as sawteeth.
   */
  detailFrequency: 2.9,
  seed: 771,
  /**
   * Building flattening: within `flatInnerRadius` of a district / landmark
   * the terrain relief is exactly zero; it ramps back to full undulation over
   * `flatOuterRadius`. Note the bias is **not** flattened — terraces keep their
   * height, only the noise swing is removed.
   *
   * Audit (measured, not estimated): the smallest distance between two *districts*
   * is C–H = 54.0 m, so a 36 m outer radius leaves an 18 m buffer and cannot
   * merge two plateaus. Bridges, stations and channel midpoints are deliberately
   * much closer (min 25.2 m, F→MOON) — they are planted *on* the district ramp
   * by design and must not be treated as plateau collisions.
   */
  flatInnerRadius: 30,
  /**
   * Outer flatten radius of a district plateau. Kept at 36 m ⇒ a 6 m transition
   * band, which keeps the smoothstep from leaning on a building wall while
   * leaving the C–H gap unmerged. Widening it to 45 m was evaluated and
   * rejected: neighbouring districts would have their flatten discs grow from
   * 12 m to 18 m of overlap and start flattening the parkland between them.
   */
  flatOuterRadius: 36,
  /**
   * Flattening pad of a **secondary** anchor (bridge, station, channel mouth).
   *
   * Deliberately much smaller than a district plateau. A bridge only needs the
   * ground flat where its deck meets the bank; giving it the district radii let
   * its 36 m disc reach the district centre 25 m away and tilt the "perfectly
   * flat" plateau by ~4 mm. With an 8/14 m pad the two discs stop overlapping
   * (measured min district→bridge distance is 25.2 m > 14 m + 8 m).
   */
  propInnerRadius: 8,
  propOuterRadius: 14,
  /**
   * Lake-mask ramp, as offsets (metres) from the local waterline radius.
   * Positive = landward. The mask is 0 for every distance ≤ `lakeMaskInner`
   * (whole lake + the lower bank), then ramps to 1 at `lakeMaskOuter`.
   *
   * Audited: max terrain height anywhere inside the waterline is exactly
   * `TERRAIN_SPEC.y = 0.020`, strictly below the 0.06 m water surface, so no
   * vertex can break the water.
   *
   * The grass line lands at `dryShoreOffset() ≈ 9.76 m` past the waterline
   * (measured 8.80–9.78 m across 720 bearings; the spread comes from bearing-
   * varying plateau relief). `lakeMaskInner = 8.0` keeps that crossing outside
   * the 6.5 m stone apron, so the perimeter band reads as lake → stone → dry
   * grass with ~3 m of margin. Going back to 3.0 put the crossing at 4.4 m —
   * *inside* the apron, so grass sprouted through the paving.
   *
   * `lakeMaskOuter = 17.0` keeps the full ramp inside the available land: the
   * shoreline sits ≥ 34.7 m from the terrain edge on every bearing. Mean slope
   * is `basinOffset / (outer − inner) = 0.4 / 9 ≈ 4.4 %` (2.5°), a graded bank.
   */
  lakeMaskInner: 8.0,
  lakeMaskOuter: 17.0,
  /** Grass colour variation between low and high areas (0–1 mix). */
  grassTintStrength: 0.32,
} as const;

/** Lakeside stone apron (shoreline ring) around the water. */
export const LAKESIDE_SPEC = {
  y: 0.03,
  /** Width of the stone bank measured outward from the waterline. */
  bandWidth: 6.5,
  /** The outer lip of the bank rises slightly above the water level. */
  lipHeight: 0.35,
  /** Deterministic seed for the procedural stone-paving texture. */
  seed: 4181,
} as const;

/** Runtime object names used by the integration team for picking. */
export const SCENE_OBJECT_NAMES = {
  PEDESTAL: 'BASE_PEDESTAL',
  NAMEPLATE: 'BASE_NAMEPLATE',
  TERRAIN: 'TERRAIN_SURFACE',
  LAKESIDE: 'LAKESIDE_GROUND',
  LAKE: 'LQ_LAKE',
  LAKE_SHORE: 'LQ_LAKE_SHORE',
  WATER: 'LK_WATER',
  SHORE: 'LK_SHORE',
} as const;