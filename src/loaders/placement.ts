import { createLogger } from '../utils/logger';
import { RUNTIME_NAME_ALIASES } from './runtimeNames';
import type { AssetManifestEntry, AssetPlacement } from './types';

const log = createLogger('loaders:placement');

/**
 * Resolves a world placement for a manifest entry.
 *
 * Placement is NOT part of `assets-manifest.json` (per PROMPT.md §7.6, the
 * manifest only carries geometry metadata). Layout is owned by the integration
 * team through `src/scene/layout.ts`. This module keeps the loader decoupled
 * from that file:
 *
 *  1. `entry.placement` from the manifest, when present, always wins;
 *  2. otherwise `src/scene/layout.ts` is consulted if it exists;
 *  3. otherwise a clearly-labelled provisional fallback lays out the known
 *     asset ids so the default view is coherent instead of stacking every
 *     model at the origin.
 */
export interface PlacementResolver {
  /** Human-readable source, recorded in the load ledger. */
  readonly name: string;
  resolvePlacement(entry: AssetManifestEntry): AssetPlacement | null;
}

export interface ResolvedPlacement {
  readonly placement: AssetPlacement | null;
  readonly source: string;
}

/**
 * `import.meta.glob` returns an empty record when `src/scene/layout.ts` does
 * not exist, so the loader never hard-depends on a file owned by another team.
 */
const LAYOUT_MODULES: Record<string, () => Promise<unknown>> = import.meta.glob([
  '../scene/layout.ts',
]);

/**
 * Discovers the integration team's layout module, accepting either of two
 * shapes:
 *  - `export function resolvePlacement(entry): AssetPlacement | null`
 *  - `export const layout: Record<assetId, AssetPlacement>`
 */
export async function discoverLayoutResolver(): Promise<PlacementResolver | null> {
  const entries = Object.entries(LAYOUT_MODULES);
  if (entries.length === 0) return null;

  const [path, load] = entries[0];
  try {
    const module = (await load()) as {
      resolvePlacement?: (entry: AssetManifestEntry) => AssetPlacement | null;
      layout?: Record<string, AssetPlacement>;
      default?: Record<string, AssetPlacement>;
    };

    if (typeof module.resolvePlacement === 'function') {
      const fn = module.resolvePlacement;
      return { name: `${path}#resolvePlacement`, resolvePlacement: (entry) => fn(entry) ?? null };
    }

    const table = module.layout ?? module.default;
    if (table && typeof table === 'object') {
      return {
        name: `${path}#layout`,
        resolvePlacement: (entry) => table[entry.assetId] ?? null,
      };
    }

    log.warn(`${path} exists but exports neither resolvePlacement() nor layout{}`);
    return null;
  } catch (error) {
    log.error(`failed to load integration layout module ${path}`, error);
    return null;
  }
}

/** Resolution order: manifest → integration layout → provisional fallback. */
export function resolvePlacement(
  entry: AssetManifestEntry,
  extraResolvers: readonly PlacementResolver[] = [],
): ResolvedPlacement {
  if (entry.placement) {
    return { placement: entry.placement, source: 'manifest.placement' };
  }

  for (const resolver of [...extraResolvers, PROVISIONAL_RESOLVER]) {
    const placement = resolver.resolvePlacement(entry);
    if (placement) return { placement, source: resolver.name };
  }

  return { placement: null, source: 'none' };
}

// ---------------------------------------------------------------------------
// Provisional fallback layout
// ---------------------------------------------------------------------------

interface Zone {
  readonly x: number;
  readonly z: number;
  /** Target footprint (metres). When omitted the model keeps its own scale. */
  readonly width?: number;
  readonly depth?: number;
  readonly rotationY?: number;
  readonly scale?: number;
}

/**
 * PROVISIONAL arrangement pending the integration team's `src/scene/layout.ts`.
 *
 * Zones are placed on the 260 × 170 pedestal with the lake (≈ 56 m max radius)
 * centred, leaving a left/right band and a shallow front band for districts.
 * Districts are uniformly scaled to fit their zone so authored proportions are
 * preserved; bridges/train/environment keep their authored scale.
 */
const PROVISIONAL_ZONES: Record<string, Zone> = {
  // Left column.
  A_HILLTOP: { x: -96, z: -56, width: 60, depth: 50 },
  E_FOREST_TOWN: { x: -96, z: 4, width: 60, depth: 52 },
  F_PLAZA_TOWN: { x: -96, z: 60, width: 60, depth: 46 },
  // Right column.
  C_URBAN_AXIS: { x: 96, z: -56, width: 60, depth: 50 },
  D_COLLEGE: { x: 96, z: 4, width: 60, depth: 52 },
  G_URBAN_BLOCKS: { x: 96, z: 60, width: 60, depth: 46 },
  // Front band (shallow).
  H_URBAN_AXIS: { x: -44, z: 70, width: 44, depth: 20 },
  B_WATERTOWN: { x: 44, z: 70, width: 44, depth: 20 },
  STATION_MAIN: { x: 0, z: 68, width: 30, depth: 20 },
  // Landmark on the north shore.
  CAPSULE_CENTER: { x: 0, z: -66, scale: 0.6 },
  // Bridges across the lake edges (authored scale, rotated onto the shoreline).
  MOON_BRIDGE: { x: -52, z: 16, rotationY: Math.PI / 2 },
  RAINBOW_BRIDGE: { x: 50, z: -14, rotationY: -Math.PI / 2 },
  ARCH_BRIDGE: { x: 0, z: 50 },
  // Rolling stock along the front edge.
  TRAIN_HEAD: { x: 10, z: 82, rotationY: Math.PI },
  TRAIN_CAR_01: { x: 28, z: 82, rotationY: Math.PI },
  // Environment props.
  ENV_TREES: { x: -110, z: 40, scale: 1.2 },
  ENV_LANDSCAPE: { x: -110, z: -34, scale: 1.4 },
};

/** 规范运行时名 → 兜底表所用的短 id（`DISTRICT_A_HILLTOP` → `A_HILLTOP`）。 */
const PROVISIONAL_CANONICAL_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(RUNTIME_NAME_ALIASES).map(([shortId, canonical]) => [canonical, shortId]),
);

const PROVISIONAL_RESOLVER: PlacementResolver = {
  name: 'loaders/provisional-layout',
  resolvePlacement(entry) {
    // 兜底表既接受短 id（测试 / 旧导出），也接受清单里实际的规范名
    // （`DISTRICT_A_HILLTOP` / `LANDMARK_MOON_BRIDGE` …），避免布局模块缺失时
    // 所有资产都堆在原点。
    const zone =
      PROVISIONAL_ZONES[entry.assetId] ??
      PROVISIONAL_ZONES[PROVISIONAL_CANONICAL_TO_ID[entry.assetId]];
    if (!zone) return null;

    const bbox = entry.boundingBox;
    const sizeX = bbox ? Math.abs(bbox.max[0] - bbox.min[0]) : 0;
    const sizeZ = bbox ? Math.abs(bbox.max[2] - bbox.min[2]) : 0;

    let scale = zone.scale ?? 1;
    if (zone.scale === undefined && zone.width && zone.depth && sizeX > 0 && sizeZ > 0) {
      const sx = zone.width / sizeX;
      const sz = zone.depth / sizeZ;
      scale = Math.min(sx, sz);
    }

    // Lift the model so its lowest point rests exactly on the pedestal top.
    const minY = bbox?.min?.[1] ?? 0;
    const y = Math.max(0, -minY * scale);

    const rotation: [number, number, number] = [0, zone.rotationY ?? 0, 0];
    const placement: AssetPlacement = {
      position: [zone.x, y, zone.z],
      rotation,
      scale,
    };
    return placement;
  },
};