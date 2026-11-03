import type { Box3, Object3D, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import type { App } from './app';

/** Per-frame context handed to every registered update callback. */
export interface UpdateContext {
  /** Seconds since the previous frame (tab-switch safe via THREE.Clock). */
  readonly delta: number;
  /** Seconds since the app started. */
  readonly elapsed: number;
  /** The owning app, for callbacks that need renderer/camera access. */
  readonly app: App;
}

/** A callback invoked once per animation frame. */
export type UpdateCallback = (context: UpdateContext) => void;

/**
 * A self-contained piece of world content that can be mounted onto the app.
 * Districts, railway and interaction modules all conform to this shape so the
 * composition root never needs to know their internals.
 */
export interface WorldBundle {
  /** Root of the content; added to `App.world`. */
  readonly group: Object3D;
  /** World-space bounds used for camera fitting and sun/shadow fitting. */
  readonly bounds: Box3;
  /** Optional per-frame hook. */
  readonly update?: UpdateCallback;
  /**
   * Optional off-screen pass (e.g. planar water reflection) run right before
   * the main render. Receives the live renderer/scene/camera.
   */
  readonly prepareFrame?: (renderer: WebGLRenderer, scene: Scene, camera: OrthographicCamera) => void;
  /** Optional teardown hook. */
  readonly dispose?: () => void;
}

/** Snapshot exposed through `window.__DIORAMA__.getStats()` for Playwright. */
export interface DioramaStats {
  readonly ready: boolean;
  readonly fps: number;
  readonly frameCount: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly objects: number;
  readonly loadedAssets: number;
  readonly failedAssets: number;
  readonly pendingAssets: number;
  readonly cameraPosition: [number, number, number];
  readonly cameraTarget: [number, number, number];
  readonly cameraZoom: number;
}

/**
 * Runtime module contract for the optional integration points.
 * Modules discovered under `src/districts`, `src/railway`, `src/interactions`
 * and `src/ui` may export an `install(app)` function; it is awaited during boot.
 * A module that does not exist yet is simply skipped — the base diorama must
 * always run standalone.
 */
export interface DioramaModule {
  readonly install?: (app: App) => void | Promise<void>;
  readonly name?: string;
}

/** Re-export so integration modules can type their `install` parameter. */
export type { App };