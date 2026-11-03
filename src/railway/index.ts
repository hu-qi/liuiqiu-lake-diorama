/**
 * 铁路模块（`src/railway` 对外入口）。
 *
 * 与 `districts` 相同，托管到 `createApp` 安装，实际构建延迟到资产加载完成
 * （场景中出现 `ASSET_MODELS`+`TRAIN_HEAD`）之后执行，避免与加载器竞争。
 *
 * 产出：
 *  - 轨道（道砟 + 钢轨 + 枕木 InstancedMesh）；
 *  - 列车（TRAIN_HEAD + 3 节 TRAIN_CAR_* 克隆），按弧长采样运行、站点停靠；
 *  - 把控制器注册到 `INTEGRATION.train`，供 UI / `__DIORAMA__` 调用。
 */

import type { Object3D } from 'three';
import type { App, DioramaModule } from '../core/types';
import { createLogger } from '../utils/logger';
import { RAILWAY } from '../scene/layout';
import { INTEGRATION, type TrainHandle } from '../integrations';
import { Vector3 } from 'three';
import { createTrack, type TrackBundle } from './track';
import { DioramaTrain } from './train';

const log = createLogger('railway');

export const name = 'railway';

/** 车厢模型自带的"轮底离原点"高度（GLB 包围盒 min.y，见 assets-manifest.json）。 */
const WHEEL_Y = 0.4;
/** 跟随列车时的相机放大倍率（列车特写）。 */
const FOLLOW_ZOOM = 2.3;
/** 车厢节数（车头 + 3 节）。 */
const CAR_COUNT = 4;
/** 资产已就绪但列车缺失时的最大等待帧数，避免无限等待。 */
const MAX_WAIT_FRAMES = 180;

let trackRef: TrackBundle | null = null;
let trainRef: DioramaTrain | null = null;

/** 已构建的轨道（未构建时返回 null）。 */
export function getTrack(): TrackBundle | null {
  return trackRef;
}

/** 已构建的列车（未构建时返回 null）。 */
export function getTrain(): DioramaTrain | null {
  return trainRef;
}

export function install(app: App): void {
  let settled = false;
  let frames = 0;

  const unsubscribe = app.registerUpdate(() => {
    if (settled) return;
    frames += 1;

    const assets = app.scene.getObjectByName('ASSET_MODELS');
    if (!assets) return;

    const head = assets.getObjectByName('TRAIN_HEAD');
    const carPrototype = assets.getObjectByName('TRAIN_CAR_01');
    if (!head || !carPrototype) {
      if (frames > MAX_WAIT_FRAMES) {
        settled = true;
        unsubscribe();
        log.warn('railway: train assets unavailable after waiting — railway disabled');
      }
      return;
    }

    settled = true;
    unsubscribe();
    try {
      bootstrapRailway(app, head, carPrototype);
    } catch (error) {
      log.error('railway bootstrap failed', error);
    }
  });

  app.registerTeardown(() => {
    unsubscribe();
  });
}

function bootstrapRailway(app: App, head: Object3D, carPrototype: Object3D): void {
  const track = createTrack();
  trackRef = track;
  app.world.add(track.group);

  const scale = RAILWAY.trainScale;
  const cars: Object3D[] = [];

  head.removeFromParent();
  head.position.set(0, 0, 0);
  head.rotation.set(0, 0, 0);
  head.scale.setScalar(scale);
  cars.push(head);

  for (let i = 2; i <= CAR_COUNT; i += 1) {
    const clone = carPrototype.clone(true);
    clone.name = `TRAIN_CAR_${String(i).padStart(2, '0')}`;
    clone.scale.setScalar(scale);
    cars.push(clone);
  }
  carPrototype.removeFromParent();

  const train = new DioramaTrain(cars, track.curve, {
    spacing: RAILWAY.carSpacing,
    cruiseSpeed: RAILWAY.cruiseSpeed,
    railTopY: track.railTopY,
    stationU: track.stationU,
    wheelY: WHEEL_Y,
  });
  trainRef = train;
  app.world.add(train.group);

  const unsubscribeUpdate = app.registerUpdate((context) => {
    train.update(context.delta);
  });

  // 开局即启动：列车从主车站出发。
  train.start();

  INTEGRATION.train = createTrainHandle(app, train, track);

  app.registerTeardown(() => {
    unsubscribeUpdate();
    train.dispose();
    track.dispose();
    trackRef = null;
    trainRef = null;
    INTEGRATION.train = null;
  });

  log.info(
    `railway ready: track ${track.length.toFixed(1)} m, ${train.carCount} cars, stationU ${track.stationU.toFixed(4)}`,
  );
}

/** 构造对外列车控制器。 */
function createTrainHandle(app: App, train: DioramaTrain, track: TrackBundle): TrainHandle {
  return {
    start: () => train.start(),
    pause: () => train.pause(),
    setFollowing: (on: boolean) => {
      train.followCamera(app.camera, on, app.controls.target);
      if (!on) return;
      // 启用跟随时一次性拉近到"列车特写"并把注视点移到车头；之后的位移
      // 由 DioramaTrain 逐帧增量跟随（零跳变）。
      app.camera.zoom = Math.max(app.camera.zoom, FOLLOW_ZOOM);
      app.camera.updateProjectionMatrix();
      app.controls.target.copy(train.headPosition);
      app.controls.update();
      train.followCamera(app.camera, true, app.controls.target);
    },
    focusTrain: () => {
      // 把取景中心移到车头（平滑聚焦由 interactions 负责；此处仅保证跟随可用）。
      app.controls.target.copy(train.headPosition);
      app.controls.update();
    },
    get isRunning() {
      return train.isRunning;
    },
    get isFollowing() {
      return train.isFollowing;
    },
    get isDwelling() {
      return train.isDwelling;
    },
    get carCount() {
      return train.carCount;
    },
    get currentSpeed() {
      return train.currentSpeed;
    },
    get headPosition() {
      return train.headPosition;
    },
    carPositions: () => train.carPositions(),
    railOffset: () => maxRailOffset(train, track),
  };
}

/**
 * 车厢中心相对轨道曲线的最大 XZ 偏差（米）。
 * 由"各车厢独立按弧长采样"保证恒为 ≈0；若把车厢合并成一根直体会立即变大，
 * 因此这个数值可当作"脱轨"的量化证据。
 */
function maxRailOffset(train: DioramaTrain, track: TrackBundle): number {
  const sample = new Vector3();
  let worst = 0;
  for (const position of train.carPositions()) {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3600; i += 1) {
      track.curve.getPointAt(i / 3600, sample);
      const dx = sample.x - position.x;
      const dz = sample.z - position.z;
      best = Math.min(best, Math.hypot(dx, dz));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/** 模块导出契约。 */
export const railwayModule: DioramaModule = { name, install };