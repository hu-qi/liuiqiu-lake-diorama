import type { Clock, Object3D, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { App } from './app';
import type { DioramaStats } from './types';
import type { AssetRecord } from '../loaders/types';
import { INTEGRATION, type DistrictBatchSummary } from '../integrations';

/** Version reported through `window.__DIORAMA__.version`. */
export const DIORAMA_VERSION = '0.1.0';

/** Asset-loading ledger mirrored onto the debug bridge. */
export interface DioramaAssetLedger {
  loaded: number;
  failed: number;
  skipped: number;
  pending: number;
  summary: string;
  records: readonly AssetRecord[];
}

/**
 * Snapshot of the integration controllers (district / railway / interactions /
 * UI), used by Playwright to drive and assert the interactive features.
 */
/** Train snapshot for derailment / multi-car sampling assertions. */
export interface TrainState {
  readonly head: readonly [number, number, number];
  readonly cars: ReadonlyArray<readonly [number, number, number]>;
  /** 车厢中心到轨道曲线的最大 XZ 距离（米）。 */
  readonly railOffset: number;
  readonly speed: number;
  readonly running: boolean;
  readonly following: boolean;
  readonly dwelling: boolean;
}

export interface DioramaIntegration {
  readonly trainRunning: boolean;
  readonly trainFollowing: boolean;
  readonly trainDwelling: boolean;
  readonly trainCars: number;
  readonly trainSpeed: number;
  readonly autoOrbit: boolean;
  readonly cleanMode: boolean;
  readonly debugHud: boolean;
  readonly selected: string | null;
}

/**
 * Debug / automation bridge exposed on `window.__DIORAMA__`.
 *
 * Playwright (and any other automation) uses this to wait for `ready`, read
 * frame statistics, inspect the loaded-asset ledger, and drive the interactive
 * features (selection, camera focus, train, clean mode) without scraping the UI.
 */
export interface DioramaBridge {
  readonly version: string;
  readonly app: App;
  readonly scene: Scene;
  readonly renderer: WebGLRenderer;
  readonly camera: OrthographicCamera;
  readonly controls: OrbitControls;
  readonly clock: Clock;
  /** Flipped to true once the first frames have rendered and assets settled. */
  ready: boolean;
  /** Top-level error captured during boot (null when healthy). */
  error: string | null;
  assets: DioramaAssetLedger;
  /** Live renderer/scene statistics. */
  getStats: () => DioramaStats;

  // ----- PROMPT §8 / architecture §5-§8 test hooks -----
  /** Canonical lookup for `DISTRICT_*` / `LANDMARK_*` / `TRAIN_*` / `STATION_*`. */
  getObjectByName: (name: string) => Object3D | null;
  /** Triggers selection (highlight + info panel + focus hooks). */
  select: (name: string | null) => void;

  // ----- Integration controls -----
  setTrainRunning: (on: boolean) => void;
  setFollowTrain: (on: boolean) => void;
  setAutoOrbit: (on: boolean) => void;
  setCleanMode: (on: boolean) => void;
  setDebugHud: (on: boolean) => void;
  selectThemeRegion: (id: string) => void;
  resetCamera: () => void;
  toggleFullscreen: () => void;
  getIntegration: () => DioramaIntegration;
  /** 组团合批前后 draw call 统计（性能对比用）。 */
  getDistrictReport: () => DistrictBatchSummary | null;
  /** 列车状态快照（脱轨 / 多车厢采样验证用）。 */
  getTrainState: () => TrainState | null;
}

declare global {
  interface Window {
    __DIORAMA__?: DioramaBridge;
  }
}

/**
 * Installs (or refreshes) the global bridge. Safe to call repeatedly — the
 * bridge object identity is stable so Playwright handles captured early keep
 * working as the scene grows.
 */
export function installDioramaBridge(app: App, assets: DioramaAssetLedger): DioramaBridge {
  const target = window.__DIORAMA__;

  if (target) {
    target.ready = false;
    target.assets = assets;
    return target;
  }

  const bridge: DioramaBridge = {
    version: DIORAMA_VERSION,
    app,
    scene: app.scene,
    renderer: app.renderer,
    camera: app.camera,
    controls: app.controls,
    clock: app.clock,
    ready: false,
    error: null,
    assets,
    getStats: () => app.getStats(),

    getObjectByName: (name: string) => app.scene.getObjectByName(name) ?? null,
    select: (name: string | null) => {
      INTEGRATION.interaction?.select(name);
    },

    setTrainRunning: (on: boolean) => {
      const train = INTEGRATION.train;
      if (!train) return;
      if (on) train.start();
      else train.pause();
    },
    setFollowTrain: (on: boolean) => {
      INTEGRATION.train?.setFollowing(on);
    },
    setAutoOrbit: (on: boolean) => {
      INTEGRATION.interaction?.setAutoOrbit(on);
    },
    setCleanMode: (on: boolean) => {
      INTEGRATION.ui?.setCleanMode(on);
    },
    setDebugHud: (on: boolean) => {
      INTEGRATION.ui?.setDebugHud(on);
    },
    selectThemeRegion: (id: string) => {
      INTEGRATION.interaction?.focusThemeRegion(id);
    },
    resetCamera: () => {
      INTEGRATION.interaction?.resetCamera();
    },
    toggleFullscreen: () => {
      INTEGRATION.ui?.toggleFullscreen();
    },
    getDistrictReport: () => INTEGRATION.districtReport?.() ?? null,
    getTrainState: (): TrainState | null => {
      const train = INTEGRATION.train;
      if (!train) return null;
      const head = train.headPosition;
      return {
        head: [head.x, head.y, head.z],
        cars: train.carPositions().map((car) => [car.x, car.y, car.z] as const),
        railOffset: train.railOffset(),
        speed: train.currentSpeed,
        running: train.isRunning,
        following: train.isFollowing,
        dwelling: train.isDwelling,
      };
    },
    getIntegration: (): DioramaIntegration => {
      const train = INTEGRATION.train;
      const ui = INTEGRATION.ui;
      return {
        trainRunning: train?.isRunning ?? false,
        trainFollowing: train?.isFollowing ?? false,
        trainDwelling: train?.isDwelling ?? false,
        trainCars: train?.carCount ?? 0,
        trainSpeed: train?.currentSpeed ?? 0,
        autoOrbit: INTEGRATION.interaction?.isAutoOrbit() ?? false,
        cleanMode: ui?.isCleanMode() ?? false,
        debugHud: ui?.isDebugHud() ?? false,
        selected: INTEGRATION.interaction?.getSelected() ?? null,
      };
    },
  };

  window.__DIORAMA__ = bridge;
  return bridge;
}