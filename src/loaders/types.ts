/**
 * Types for the manifest-driven asset pipeline (PROMPT.md §7.6).
 *
 * The manifest is produced by the modelling engine and lives at the project
 * root (`assets-manifest.json`). Three.js never hard-codes asset paths — it
 * always goes through this manifest.
 */

export interface AssetPlacement {
  /** World position in metres (Y-up). Defaults to [0, 0, 0]. */
  readonly position?: readonly [number, number, number];
  /** Euler rotation in radians, XYZ order. Defaults to [0, 0, 0]. */
  readonly rotation?: readonly [number, number, number];
  /** Uniform scale or per-axis scale. Defaults to 1. */
  readonly scale?: number | readonly [number, number, number];
}

export interface AssetBoundingBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface AssetManifestEntry {
  readonly assetId: string;
  readonly name?: string;
  readonly district?: string;
  readonly category?: string;
  readonly sourceBlend?: string;
  /** Path to the runtime GLB, relative to the site root (may include `public/`). */
  readonly outputGLB?: string | null;
  /** Name to give the loaded root so integration code can find it. */
  readonly rootObjectName?: string;
  /** Preferred runtime object name (e.g. `DISTRICT_A_HILLTOP`). */
  readonly runtimeName?: string;
  readonly placement?: AssetPlacement | null;
  readonly boundingBox?: AssetBoundingBox | null;
  readonly triangleCount?: number;
  readonly materialCount?: number;
  readonly textureCount?: number;
  readonly fileSize?: number;
  readonly sourceReferences?: readonly string[];
  readonly fidelityLevel?: string;
  readonly verified?: boolean;
  /** Forward-compatible: unknown fields are preserved but ignored. */
  readonly [key: string]: unknown;
}

export interface AssetManifest {
  readonly version?: string | number;
  readonly generatedAt?: string;
  readonly generator?: string;
  /** Primary collection key. */
  readonly assets?: readonly AssetManifestEntry[];
  /** Tolerated alias used by some exporters. */
  readonly models?: readonly AssetManifestEntry[];
  readonly [key: string]: unknown;
}

export type AssetStatus = 'loaded' | 'failed' | 'skipped' | 'pending';

/** One row of the loading ledger — failures are recorded, never swallowed. */
export interface AssetRecord {
  readonly assetId: string;
  readonly url: string;
  readonly status: AssetStatus;
  /** Why the asset was skipped (missing/invalid manifest field). */
  readonly reason?: string;
  /** Error message for failed loads. */
  readonly error?: string;
  readonly triangleCount?: number;
  readonly runtimeName?: string;
  readonly placementApplied?: boolean;
  /** Which resolver supplied the placement (manifest / layout / provisional). */
  readonly placementSource?: string;
}

export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
  readonly currentUrl: string;
  /** 0–100, accounting for intra-file byte progress. */
  readonly percent: number;
}

export interface LoadManifestOptions {
  /** Explicit manifest URL. Defaults to the site-root `assets-manifest.json`. */
  readonly manifestUrl?: string;
  /** Base URL used to resolve `outputGLB` paths. Defaults to Vite's BASE_URL. */
  readonly baseUrl?: string;
  /** Progress callback (drives the loading overlay). */
  readonly onProgress?: (progress: LoadProgress) => void;
  /** Whether loaded meshes cast shadows. Defaults to true. */
  readonly castShadow?: boolean;
  /** Whether loaded meshes receive shadows. Defaults to true. */
  readonly receiveShadow?: boolean;
}

export interface LoadManifestResult {
  /** False when the manifest could not be fetched/parsed (waiting for assets). */
  readonly manifestFound: boolean;
  readonly manifestUrl: string;
  /** Number of valid, loadable entries found in the manifest. */
  readonly total: number;
  readonly loaded: readonly AssetRecord[];
  readonly failed: readonly AssetRecord[];
  readonly skipped: readonly AssetRecord[];
  readonly pending: readonly AssetRecord[];
  /** Every record, in manifest order — the full failure ledger. */
  readonly records: readonly AssetRecord[];
  readonly durationMs: number;
  /** Human-readable one-line summary for logs. */
  readonly summary: string;
}