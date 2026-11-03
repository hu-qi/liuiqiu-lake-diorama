import {
  Box3,
  Clock,
  Color,
  Group,
  Scene,
  Vector3,
  type OrthographicCamera,
  type WebGLRenderer,
} from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLogger } from '../utils/logger';
import { disposeObjectTree } from '../materials/standard';
import { createRenderer, readElementSize } from './renderer';
import {
  createOrthographicCamera,
  fitOrthographicCameraToBox,
  type CameraFitResult,
  type FitOptions,
} from './camera';
import { createControls } from './controls';
import { createLighting, refreshLightingForBounds, type LightingBundle } from './lights';
import { RENDER_CONSTANTS } from './constants';
import { PALETTE } from '../materials/palette';
import type { DioramaStats, UpdateCallback, UpdateContext, WorldBundle } from './types';

const log = createLogger('core:app');

interface HomeView {
  readonly position: Vector3;
  readonly target: Vector3;
  readonly zoom: number;
}

interface AssetSummary {
  loaded: number;
  failed: number;
  pending: number;
}

/**
 * The diorama runtime.
 *
 * Owns the renderer, scene, orthographic camera, controls, clock and lighting,
 * drives a single `setAnimationLoop` render loop, and exposes extension points
 * (`registerUpdate`, `mountWorld`) so district / railway / UI modules can be
 * added later without touching core code.
 *
 * Instances are created through {@link createApp}; the constructor is private.
 */
export class App {
  readonly container: HTMLElement;
  readonly scene: Scene;
  /** Root for all world content (pedestal, lake, districts, railway). */
  readonly world: Group;
  readonly renderer: WebGLRenderer;
  readonly camera: OrthographicCamera;
  readonly controls: OrbitControls;
  readonly clock: Clock;
  readonly lighting: LightingBundle;

  private readonly updates = new Set<UpdateCallback>();
  private readonly teardowns = new Set<() => void>();
  private readonly worlds: WorldBundle[] = [];
  private readonly worldUnsubscribers = new Map<WorldBundle, () => void>();

  private running = false;
  private disposed = false;
  private elapsed = 0;
  private frameCount = 0;
  private fps = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private fittedHalfHeight = 1;
  private homeView: HomeView | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private assets: AssetSummary = { loaded: 0, failed: 0, pending: 0 };

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = createRenderer(container);

    this.scene = new Scene();
    this.scene.background = new Color(PALETTE.SCENE_BACKGROUND);

    this.world = new Group();
    this.world.name = 'WORLD_ROOT';
    this.scene.add(this.world);

    const { width, height } = readElementSize(container);
    this.camera = createOrthographicCamera(width / height);
    this.controls = createControls(this.camera, this.renderer.domElement);
    this.clock = new Clock();

    const bounds = new Box3(new Vector3(-140, -12, -90), new Vector3(140, 60, 90));
    this.lighting = createLighting(bounds);
    this.scene.add(this.lighting.group);

    this.resize();
    this.attachResizeHandling();
    log.debug('App constructed', { width, height });
  }

  // ---------------------------------------------------------------------
  // Extension points
  // ---------------------------------------------------------------------

  /**
   * Registers a per-frame update callback. Returns an unsubscribe function.
   * Callbacks are isolated: one throwing callback never stops the loop.
   */
  registerUpdate(callback: UpdateCallback): () => void {
    this.updates.add(callback);
    return () => {
      this.updates.delete(callback);
    };
  }

  /** Registers a teardown callback run during {@link dispose}. */
  registerTeardown(callback: () => void): () => void {
    this.teardowns.add(callback);
    return () => {
      this.teardowns.delete(callback);
    };
  }

  /** Mounts a world bundle (district, railway, environment, …). */
  mountWorld(bundle: WorldBundle): void {
    this.worlds.push(bundle);
    this.world.add(bundle.group);
    if (bundle.update) {
      this.worldUnsubscribers.set(bundle, this.registerUpdate(bundle.update));
    }
    log.debug('mountWorld', bundle.group.name || '(unnamed)');
  }

  /** Removes a previously mounted world bundle and releases its resources. */
  unmountWorld(bundle: WorldBundle): void {
    const unsub = this.worldUnsubscribers.get(bundle);
    if (unsub) {
      unsub();
      this.worldUnsubscribers.delete(bundle);
    }
    this.world.remove(bundle.group);
    bundle.dispose?.();
    const index = this.worlds.indexOf(bundle);
    if (index >= 0) this.worlds.splice(index, 1);
  }

  /** Records asset-loading counters surfaced via {@link getStats}. */
  reportAssets(summary: Partial<AssetSummary>): void {
    this.assets = { ...this.assets, ...summary };
  }

  /** All currently mounted world bundles (read-only). */
  getWorlds(): readonly WorldBundle[] {
    return this.worlds;
  }

  // ---------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------

  /**
   * Fits the orthographic camera to a world-space box (PROMPT.md §8.4).
   * When `box` is omitted the union of all mounted world bounds is used.
   *
   * Pass `{ rehome: true }` to also recapture the view used by
   * {@link resetView} — done once the GLB assets have been mounted so the
   * "home" composition frames the finished sandbox.
   */
  fitToBox(box?: Box3, options: FitOptions & { readonly rehome?: boolean } = {}): CameraFitResult {
    const { rehome = false, ...cameraOptions } = options;
    const target = box ?? this.computeWorldBounds();
    const { width, height } = readElementSize(this.container);
    const result = fitOrthographicCameraToBox(this.camera, target, width / height, cameraOptions);

    this.fittedHalfHeight = result.halfHeight;
    this.controls.target.copy(result.center);
    this.controls.update();

    if (rehome || !this.homeView) {
      this.homeView = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        zoom: this.camera.zoom,
      };
    }
    return result;
  }

  /** Restores the initial composition captured on the first {@link fitToBox}. */
  resetView(): void {
    if (!this.homeView) return;
    this.camera.position.copy(this.homeView.position);
    this.camera.zoom = this.homeView.zoom;
    this.controls.target.copy(this.homeView.target);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Union of all mounted world bounds, padded to a minimum size. */
  computeWorldBounds(): Box3 {
    const bounds = new Box3();
    let hasBounds = false;
    for (const bundle of this.worlds) {
      if (bundle.bounds.isEmpty()) continue;
      bounds.union(bundle.bounds);
      hasBounds = true;
    }
    if (!hasBounds) {
      bounds.set(new Vector3(-130, -12, -85), new Vector3(130, 60, 85));
    }
    return bounds;
  }

  /** Re-aims the sun/shadow frustum after the world changes (e.g. GLB load). */
  refreshLighting(): void {
    refreshLightingForBounds(this.lighting, this.computeWorldBounds());
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  /** Starts the render loop. Idempotent. */
  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.handleFrame);
    log.info('render loop started');
  }

  /** Stops the render loop without disposing resources. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  /** True once the loop is running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Tears down the runtime: loop, controls, world resources and renderer. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();

    for (const teardown of this.teardowns) {
      try {
        teardown();
      } catch (error) {
        log.error('teardown callback failed', error);
      }
    }
    this.teardowns.clear();

    for (const bundle of this.worlds) {
      bundle.dispose?.();
    }
    this.worlds.length = 0;
    this.worldUnsubscribers.clear();
    this.updates.clear();

    disposeObjectTree(this.world);
    disposeObjectTree(this.lighting.group);

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.handleWindowResize);

    this.controls.dispose();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    log.info('App disposed');
  }

  // ---------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------

  private readonly handleFrame = (): void => {
    if (this.disposed) return;

    const rawDelta = this.clock.getDelta();
    // Clamp to avoid huge jumps after the tab was backgrounded.
    const delta = Math.min(rawDelta, 0.1);
    this.elapsed += delta;

    this.controls.update();

    const context: UpdateContext = { delta, elapsed: this.elapsed, app: this };
    for (const callback of this.updates) {
      try {
        callback(context);
      } catch (error) {
        log.error('update callback threw', error);
      }
    }

    this.prepareBundles();
    this.renderer.render(this.scene, this.camera);

    this.frameCount += 1;
    this.fpsAccumulator += delta;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccumulator;
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }
  };

  /** Renders a single frame without starting the loop (used by tests). */
  renderOnce(deltaSeconds = 1 / 60): void {
    this.elapsed += deltaSeconds;
    const context: UpdateContext = { delta: deltaSeconds, elapsed: this.elapsed, app: this };
    for (const callback of this.updates) {
      callback(context);
    }
    this.controls.update();
    this.prepareBundles();
    this.renderer.render(this.scene, this.camera);
    this.frameCount += 1;
  }

  /**
   * Runs every world bundle's pre-render pass (water reflection). Failures are
   * isolated per bundle so a broken pass never blanks the frame.
   */
  private prepareBundles(): void {
    for (const bundle of this.worlds) {
      if (!bundle.prepareFrame) continue;
      try {
        bundle.prepareFrame(this.renderer, this.scene, this.camera);
      } catch (error) {
        log.error('prepareFrame callback threw', error);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Sizing
  // ---------------------------------------------------------------------

  private attachResizeHandling(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
    }
    window.addEventListener('resize', this.handleWindowResize);
  }

  private readonly handleWindowResize = (): void => {
    this.resize();
  };

  /** Resizes the renderer and re-derives the ortho frustum from the aspect. */
  resize(): void {
    if (this.disposed) return;
    const { width, height } = readElementSize(this.container);
    const aspect = width / Math.max(height, 1);

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, RENDER_CONSTANTS.MAX_PIXEL_RATIO),
    );
    this.renderer.setSize(width, height, false);

    // Preserve the vertical framing captured by the last fit, keep the camera
    // pointing at the same composition, and only widen/narrow horizontally.
    this.camera.top = this.fittedHalfHeight;
    this.camera.bottom = -this.fittedHalfHeight;
    this.camera.left = -this.fittedHalfHeight * aspect;
    this.camera.right = this.fittedHalfHeight * aspect;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------

  /** Snapshot for Playwright assertions and the debug HUD. */
  getStats(): DioramaStats {
    const info = this.renderer.info;
    const target = this.controls.target;
    return {
      ready: !this.disposed,
      fps: Math.round(this.fps * 10) / 10,
      frameCount: this.frameCount,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      objects: this.world.children.length,
      loadedAssets: this.assets.loaded,
      failedAssets: this.assets.failed,
      pendingAssets: this.assets.pending,
      cameraPosition: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      cameraTarget: [target.x, target.y, target.z],
      cameraZoom: this.camera.zoom,
    };
  }

  /** True when at least one frame has been rendered. */
  get hasRendered(): boolean {
    return this.frameCount > 0;
  }
}