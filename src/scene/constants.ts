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
 * Undulation is staged in two octaves:
 *  - `amplitude` — low-frequency landform (the silhouette you read at a glance);
 *  - `detailAmplitude` — high-frequency micro relief that kills the "plastic
 *    flat plane" look (≈ 25 % of the base amplitude).
 *
 * Both are suppressed inside the lake footprint and flattened around every
 * building so districts keep resting exactly on `y = 0` (see `terrain.ts`).
 */
export const TERRAIN_SPEC = {
  y: 0.02,
  /** Grid resolution of the gently undulating land surface. */
  segmentsX: 120,
  segmentsZ: 84,
  /** Maximum low-frequency height variation (metres). */
  amplitude: 0.64,
  /** High-frequency relief amplitude (metres), ≈ 25 % of `amplitude`. */
  detailAmplitude: 0.16,
  /** Detail-noise frequency multiplier relative to the base octave. */
  detailFrequency: 3.4,
  seed: 771,
  /**
   * Building flattening: within `FLAT_INNER_RADIUS` of a district / landmark
   * the terrain height is 0; it ramps smoothly back to full undulation over
   * `FLAT_OUTER_RADIUS`. Guarantees no gap appears under a GLB footprint.
   */
  flatInnerRadius: 25,
  flatOuterRadius: 36,
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