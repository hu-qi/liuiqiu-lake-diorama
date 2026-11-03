/**
 * Shared colour palette for the Lianqiu Lake diorama.
 *
 * Art direction (PROMPT.md §1, §9.4): premium architectural-model photography —
 * warm, low-saturation, soft global light. No neon, no mirror-glass city, no
 * high-chroma cartoon palettes. Values are linear-ready sRGB hex numbers used
 * by `THREE.Color`.
 */

export const PALETTE = {
  /** Scene backdrop — light beige-grey, matches the page background. */
  SCENE_BACKGROUND: 0xefeae0,

  // ----- Pedestal (PROMPT.md §8.2) -----
  BASE_SANDSTONE_TOP: 0xd9d0bd,
  BASE_SANDSTONE_EDGE: 0xc9bda4,
  BASE_GEOLOGY_GREEN: 0x8b966f,
  BASE_GEOLOGY_GREY: 0xa3a9a4,
  BASE_DEEP_GREY: 0x474a4e,
  BASE_CAP_HIGHLIGHT: 0xe6ddcb,

  // ----- Metal nameplate -----
  // Deliberately much darker than the sandstone so the plaque reads as a
  // distinct dark-bronze plate instead of blending into the pedestal side.
  NAMEPLATE_METAL: 0x6b5a2a,
  NAMEPLATE_FRAME: 0x3f382a,
  NAMEPLATE_ENGRAVING: 0x241f14,

  // ----- Terrain / landscape -----
  TERRAIN_GRASS: 0x8d9a70,
  TERRAIN_GRASS_DARK: 0x71805a,
  TERRAIN_SOIL: 0xa89a80,

  // ----- Water (PROMPT.md §5.1) -----
  WATER_DEEP: 0x2c5a60,
  WATER_SHALLOW: 0x6f9d9a,
  WATER_SKY_REFLECT: 0xd2d8d5,
  WATER_SHORE: 0xa79a80,
  WATER_SHORE_DARK: 0x6f6552,

  // ----- Lighting (warm afternoon) -----
  SUN_COLOR: 0xfff0da,
  SKY_COLOR: 0xdde6ea,
  GROUND_BOUNCE: 0xb6ac99,
  AMBIENT_COLOR: 0xfff4e6,
} as const;

export type PaletteKey = keyof typeof PALETTE;