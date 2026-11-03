/**
 * Canonical runtime object names (PROMPT.md §7.4).
 *
 * The manifest uses short asset ids (`A_HILLTOP`), but the interaction layer,
 * Raycaster picking and the district modules all key off the agreed runtime
 * names (`DISTRICT_A_HILLTOP`). This table is the single mapping between them,
 * so no two subsystems ever disagree about what a loaded group is called.
 *
 * A loaded GLB whose own root object already carries a canonical name is left
 * untouched — the mapping only fills in names the exporter did not set.
 */
export const RUNTIME_NAME_ALIASES: Readonly<Record<string, string>> = {
  A_HILLTOP: 'DISTRICT_A_HILLTOP',
  B_WATERTOWN: 'DISTRICT_B_WATERTOWN',
  C_URBAN_AXIS: 'DISTRICT_C_URBAN_AXIS',
  D_COLLEGE: 'DISTRICT_D_COLLEGE',
  E_FOREST_TOWN: 'DISTRICT_E_FOREST_TOWN',
  F_PLAZA_TOWN: 'DISTRICT_F_PLAZA_TOWN',
  G_URBAN_BLOCKS: 'DISTRICT_G_URBAN_BLOCKS',
  H_URBAN_AXIS: 'DISTRICT_H_URBAN_AXIS',
  MOON_BRIDGE: 'LANDMARK_MOON_BRIDGE',
  RAINBOW_BRIDGE: 'LANDMARK_RAINBOW_BRIDGE',
  ARCH_BRIDGE: 'LANDMARK_ARCH_BRIDGE',
  CAPSULE_CENTER: 'LANDMARK_CAPSULE_CENTER',
  TRAIN_HEAD: 'TRAIN_HEAD',
  TRAIN_CAR_01: 'TRAIN_CAR_01',
  STATION_MAIN: 'STATION_MAIN',
  ENV_TREES: 'ENV_TREE_CLUSTER',
  ENV_LANDSCAPE: 'ENV_LANDSCAPE_ASSETS',
} as const;

/** Prefixes that mark a name as already canonical. */
const CANONICAL_PREFIXES = [
  'DISTRICT_',
  'LANDMARK_',
  'TRAIN_',
  'STATION_',
  'ENV_',
  'BASE_',
  'LQ_',
] as const;

/** True when `name` already follows the runtime naming convention. */
export function isCanonicalRuntimeName(name: string): boolean {
  return CANONICAL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Resolves the runtime name for a manifest asset id. */
export function runtimeNameForAssetId(assetId: string): string {
  return RUNTIME_NAME_ALIASES[assetId] ?? assetId;
}