import {
  Box3,
  Group,
  LoadingManager,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { App, WorldBundle } from '../core/types';
import { createLogger } from '../utils/logger';
import { applyShadowFlags, configureStaticMeshes, disposeObjectTree } from '../materials/standard';
import { discoverLayoutResolver, resolvePlacement, type PlacementResolver } from './placement';
import { isCanonicalRuntimeName, runtimeNameForAssetId } from './runtimeNames';
import type {
  AssetManifest,
  AssetManifestEntry,
  AssetPlacement,
  AssetRecord,
  LoadManifestOptions,
  LoadManifestResult,
} from './types';

const log = createLogger('loaders:manifest');

const DEFAULT_MANIFEST = 'assets-manifest.json';

/**
 * Manifest-driven GLB loader (PROMPT.md §7.6 / §8.3).
 *
 * Behaviour requirements covered here:
 *  - the manifest is fetched from the project root; a missing or malformed
 *    manifest is logged and treated as "waiting for assets" rather than fatal;
 *  - every entry's outcome is recorded (loaded / failed / skipped / pending);
 *  - failed exports and missing files are logged explicitly (`console.error`)
 *    and never silently dropped;
 *  - loaded models keep their own objects (never merged into one blob) and are
 *    tagged with the agreed runtime object names so Raycaster picking works.
 */
export async function loadAssetManifest(
  app: App,
  options: LoadManifestOptions = {},
): Promise<LoadManifestResult> {
  const startedAt = performance.now();
  const baseUrl = options.baseUrl ?? safeBaseUrl();
  const manifestUrl = options.manifestUrl ?? joinUrl(baseUrl, DEFAULT_MANIFEST);

  const records: AssetRecord[] = [];
  const assetsRoot = new Group();
  assetsRoot.name = 'ASSET_MODELS';

  const manifest = await fetchManifest(manifestUrl);
  if (!manifest) {
    log.warn(
      `assets-manifest.json not available at ${manifestUrl} — starting in "waiting for assets" mode. ` +
        'The sandbox renders the pedestal + lake only; districts/bridges/trains will appear once the modelling engine exports them.',
    );
    app.reportAssets({ loaded: 0, failed: 0, pending: 0 });
    return emptyResult(manifestUrl, startedAt, records);
  }

  const entries = collectEntries(manifest);
  if (entries.length === 0) {
    log.warn('assets-manifest.json parsed but contains no asset entries.');
    app.reportAssets({ loaded: 0, failed: 0, pending: 0 });
    return emptyResult(manifestUrl, startedAt, records);
  }

  const loadable = prepareEntries(entries, baseUrl, records);
  log.info(
    `manifest loaded: ${entries.length} entries, ${loadable.length} loadable, ${records.length} skipped.`,
  );

  // Placement sources: the integration team's layout module, if it exists yet.
  const layoutResolver = await discoverLayoutResolver();
  const placementResolvers: PlacementResolver[] = layoutResolver ? [layoutResolver] : [];
  if (layoutResolver) {
    log.info(`using integration layout from ${layoutResolver.name}`);
  } else {
    log.warn(
      'src/scene/layout.ts not found — falling back to the loader\'s provisional layout. ' +
        'The integration team owns the final placement.',
    );
  }

  const loader = new GLTFLoader(new LoadingManager());
  const bounds = new Box3();
  const placementSources = new Map<string, number>();

  let completed = 0;

  const emitProgress = (currentFraction = 0): void => {
    if (!options.onProgress) return;
    const total = loadable.length;
    const percent = total === 0 ? 100 : ((completed + currentFraction) / total) * 100;
    options.onProgress({
      loaded: completed,
      total,
      currentUrl: loadable[Math.min(completed, total - 1)]?.url ?? '',
      percent,
    });
  };

  for (const item of loadable) {
    emitProgress(0);
    try {
      const object = await loadOne(loader, item.url, (fraction) => emitProgress(fraction));
      const runtimeName = resolveRuntimeName(item.entry, object);
      object.name = runtimeName;

      const { placement, source } = resolvePlacement(item.entry, placementResolvers);
      if (placement) {
        applyPlacement(object, placement);
      } else {
        log.warn(
          `asset "${item.entry.assetId}" has no placement (manifest, layout.ts and provisional zones all missed it) — ` +
            'left at its authored transform at the origin.',
        );
      }
      placementSources.set(source, (placementSources.get(source) ?? 0) + 1);

      applyShadowFlags(object, options.castShadow ?? true, options.receiveShadow ?? true);
      configureStaticMeshes(object);
      object.updateMatrixWorld(true);

      assetsRoot.add(object);

      const objectBounds = new Box3().setFromObject(object);
      if (!objectBounds.isEmpty()) bounds.union(objectBounds);

      const triangles = countTriangles(object);

      records.push({
        assetId: item.entry.assetId,
        url: item.url,
        status: 'loaded',
        triangleCount: triangles,
        runtimeName,
        placementApplied: Boolean(placement),
        placementSource: source,
      });
      log.info(
        `loaded ${item.entry.assetId} → ${runtimeName} (${triangles.toLocaleString()} tris, placement: ${source}) from ${item.url}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      records.push({
        assetId: item.entry.assetId,
        url: item.url,
        status: 'failed',
        error: message,
      });
      log.error(`FAILED to load asset "${item.entry.assetId}" from ${item.url}: ${message}`);
    } finally {
      completed += 1;
      emitProgress(0);
    }
  }

  // Sort completed records back into manifest order for a stable ledger.
  const ordered = sortByManifestOrder(records, entries);

  const loaded = ordered.filter((r) => r.status === 'loaded');
  const failed = ordered.filter((r) => r.status === 'failed');
  const skipped = ordered.filter((r) => r.status === 'skipped');
  const pending = ordered.filter((r) => r.status === 'pending');

  const worldBundle: WorldBundle = {
    group: assetsRoot,
    bounds: bounds.isEmpty() ? new Box3() : bounds,
    dispose: () => {
      // 释放几何体、材质与纹理（disposeObjectTree 会连带释放材质引用的贴图），
      // 避免 unmountWorld() 单独卸载时泄漏材质/纹理。
      disposeObjectTree(assetsRoot);
    },
  };
  app.mountWorld(worldBundle);

  const durationMs = performance.now() - startedAt;
  const summary = `assets: ${loaded.length} loaded / ${failed.length} failed / ${skipped.length} skipped / ${pending.length} pending (${Math.round(durationMs)} ms)`;
  const placementSummary = [...placementSources.entries()]
    .map(([source, count]) => `${source}=${count}`)
    .join(', ');
  log.info(`placement sources: ${placementSummary || 'n/a'}`);
  if (failed.length > 0 || skipped.length > 0) {
    log.warn(summary);
    for (const record of failed) {
      log.error(`  ✗ ${record.assetId}: ${record.error ?? 'unknown error'}`);
    }
    for (const record of skipped) {
      log.warn(`  ⚠ ${record.assetId}: ${record.reason ?? 'skipped'}`);
    }
  } else {
    log.info(summary);
  }

  app.reportAssets({ loaded: loaded.length, failed: failed.length, pending: pending.length });

  return {
    manifestFound: true,
    manifestUrl,
    total: loadable.length,
    loaded,
    failed,
    skipped,
    pending,
    records: ordered,
    durationMs,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LoadableEntry {
  readonly entry: AssetManifestEntry;
  readonly url: string;
}

async function fetchManifest(url: string): Promise<AssetManifest | null> {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      log.warn(`manifest fetch returned HTTP ${response.status} for ${url}`);
      return null;
    }
    const json: unknown = await response.json();
    if (typeof json !== 'object' || json === null) {
      log.error(`manifest at ${url} is not a JSON object`);
      return null;
    }
    return json as AssetManifest;
  } catch (error) {
    log.warn(`could not fetch manifest at ${url}`, error);
    return null;
  }
}

function collectEntries(manifest: AssetManifest): AssetManifestEntry[] {
  const raw = manifest.assets ?? manifest.models ?? [];
  if (!Array.isArray(raw)) {
    log.error('manifest.assets / manifest.models is not an array');
    return [];
  }
  return raw.filter((entry): entry is AssetManifestEntry =>
    typeof entry === 'object' && entry !== null && typeof (entry as AssetManifestEntry).assetId === 'string',
  );
}

/** Validates entries and resolves their GLB URLs; invalid entries are logged. */
function prepareEntries(
  entries: readonly AssetManifestEntry[],
  baseUrl: string,
  records: AssetRecord[],
): LoadableEntry[] {
  const loadable: LoadableEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.assetId)) {
      records.push({
        assetId: entry.assetId,
        url: '',
        status: 'skipped',
        reason: 'duplicate assetId',
      });
      continue;
    }
    seen.add(entry.assetId);

    const rawPath = entry.outputGLB;
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      records.push({
        assetId: entry.assetId,
        url: '',
        status: 'skipped',
        reason: 'entry has no outputGLB path (export pending)',
      });
      continue;
    }

    const url = joinUrl(baseUrl, normalizeAssetPath(rawPath));
    if (entry.verified === false) {
      log.warn(`asset "${entry.assetId}" is marked verified=false — loading anyway for preview.`);
    }
    loadable.push({ entry, url });
  }

  return loadable;
}

/**
 * Loads a single GLB, mapping three.js' per-file byte progress to the overlay.
 */
function loadOne(
  loader: GLTFLoader,
  url: string,
  onFraction: (fraction: number) => void,
): Promise<Object3D> {
  return new Promise<Object3D>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      (event) => {
        if (typeof event.total === 'number' && event.total > 0) {
          onFraction(Math.min(1, event.loaded / event.total));
        }
      },
      (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function applyPlacement(object: Object3D, placement: AssetPlacement): void {
  if (placement.position) {
    object.position.set(placement.position[0], placement.position[1], placement.position[2]);
  }
  if (placement.rotation) {
    object.rotation.set(placement.rotation[0], placement.rotation[1], placement.rotation[2]);
  }
  if (placement.scale !== undefined) {
    if (typeof placement.scale === 'number') {
      object.scale.setScalar(placement.scale);
    } else {
      object.scale.set(placement.scale[0], placement.scale[1], placement.scale[2]);
    }
  }
}

function resolveRuntimeName(entry: AssetManifestEntry, loaded: Object3D): string {
  if (entry.runtimeName) return entry.runtimeName;
  if (entry.rootObjectName) return entry.rootObjectName;
  // Respect a name the exporter already set correctly.
  if (loaded.name && isCanonicalRuntimeName(loaded.name)) return loaded.name;
  return runtimeNameForAssetId(entry.assetId);
}

function countTriangles(object: Object3D): number {
  let triangles = 0;
  object.traverse((child) => {
    const mesh = child as unknown as {
      isMesh?: boolean;
      geometry?: { index?: { count: number } | null; attributes?: { position?: { count: number } } };
    };
    if (!mesh.isMesh || !mesh.geometry) return;
    if (mesh.geometry.index) {
      triangles += mesh.geometry.index.count / 3;
    } else if (mesh.geometry.attributes?.position) {
      triangles += mesh.geometry.attributes.position.count / 3;
    }
  });
  return Math.floor(triangles);
}

function sortByManifestOrder(
  records: readonly AssetRecord[],
  entries: readonly AssetManifestEntry[],
): AssetRecord[] {
  const order = new Map(entries.map((entry, index) => [entry.assetId, index]));
  return [...records].sort(
    (a, b) => (order.get(a.assetId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.assetId) ?? Number.MAX_SAFE_INTEGER),
  );
}

function normalizeAssetPath(path: string): string {
  return path
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/^public\//, '');
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${path.replace(/^\/+/, '')}`;
}

function safeBaseUrl(): string {
  try {
    return import.meta.env?.BASE_URL || '/';
  } catch {
    return '/';
  }
}

function emptyResult(
  manifestUrl: string,
  startedAt: number,
  records: readonly AssetRecord[],
): LoadManifestResult {
  return {
    manifestFound: false,
    manifestUrl,
    total: 0,
    loaded: [],
    failed: [],
    skipped: [],
    pending: [],
    records,
    durationMs: performance.now() - startedAt,
    summary: 'assets: 0 loaded / 0 failed — waiting for the modelling engine to export assets-manifest.json',
  };
}
