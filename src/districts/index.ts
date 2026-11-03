/**
 * 组团落位与装饰（`src/districts` 对外模块）。
 *
 * 生命周期（architecture §10）：本模块在 `createApp` 阶段被安装，但资产在
 * 之后才由 `main.ts` 载入。因此安装时只注册一个"等待资产"的 update 回调，
 * 一旦场景中出现 `ASSET_MODELS`（加载器完成挂载的信号）便一次性执行：
 *
 *   1. 校验 / 归位 8 个组团、3 座桥、胶囊会议中心、主车站（顶层对象名严格为
 *      `DISTRICT_*` / `LANDMARK_*` / `STATION_MAIN`，供 raycast 稳定拾取）；
 *   2. 按材质合批（数百网格/组团 → 10~20 draw call/组团）；
 *   3. 由 `ENV_TREE_CLUSTER` 派生实例化森林（随机缩放/旋转/叶色扰动）；
 *   4. 生成环形道路网与两条水道支流。
 */

import { Box3, Group, type Object3D } from 'three';
import type { App, DioramaModule } from '../core/types';
import { createTerrainSampler } from '../scene/terrain';
import { createLogger } from '../utils/logger';
import { createLakeOutline } from '../water';
import { INTEGRATION } from '../integrations';
import {
  BRIDGES,
  DISTRICT_ORDER,
  DISTRICTS,
  LANDMARKS,
  STATION,
  WATER_BODIES,
  type BridgeId,
} from '../scene/layout';
import { countMeshes, mergeByMaterial, type BatchStats } from './geometry';
import { buildInstancedForest, buildRoadNetwork, buildWaterChannels } from './decor';

const log = createLogger('districts');

export const name = 'districts';

/** 合批前后对比（供性能汇报与 `__DIORAMA__` 读取）。 */
export interface DistrictBatchReport {
  districts: Record<string, BatchStats>;
  landmarks: Record<string, BatchStats>;
  totalBefore: number;
  totalAfter: number;
}

let lastReport: DistrictBatchReport | null = null;

/** 最近一次落位/合批报告（未初始化时为 null）。 */
export function getDistrictBatchReport(): DistrictBatchReport | null {
  return lastReport;
}

export function install(app: App): void {
  let settled = false;
  const unsubscribe = app.registerUpdate(() => {
    if (settled) return;
    const assets = app.scene.getObjectByName('ASSET_MODELS');
    if (!assets) return;
    settled = true;
    unsubscribe();
    try {
      bootstrapDistricts(app, assets);
    } catch (error) {
      log.error('district bootstrap failed', error);
    }
  });

  app.registerTeardown(() => {
    unsubscribe();
  });
}

// ---------------------------------------------------------------------------
// 一次性初始化
// ---------------------------------------------------------------------------

function bootstrapDistricts(app: App, assets: Object3D): void {
  const targets = collectTargets(assets);
  const obstacles: Box3[] = [];
  for (const target of targets) {
    const box = new Box3().setFromObject(target);
    if (!box.isEmpty()) obstacles.push(box);
  }

  // 1) 按材质合批（原地），并统计前后 draw call。
  const report: DistrictBatchReport = {
    districts: {},
    landmarks: {},
    totalBefore: 0,
    totalAfter: 0,
  };
  const skipMerge = shouldSkipMerge();
  for (const target of targets) {
    const stats = skipMerge ? countMeshes(target) : mergeByMaterial(target);
    report.totalBefore += stats.meshesBefore;
    report.totalAfter += stats.meshesAfter;
    if (target.name.startsWith('DISTRICT_')) report.districts[target.name] = stats;
    else report.landmarks[target.name] = stats;
    if (!skipMerge) {
      log.info(
        `batched ${target.name}: ${stats.meshesBefore} → ${stats.meshesAfter} meshes (${stats.groups} materials)`,
      );
    }
  }
  lastReport = report;
  INTEGRATION.districtReport = () => lastReport;

  // 2) 装饰层：森林 + 道路 + 水道。
  const decoration = new Group();
  decoration.name = 'DISTRICT_DECORATION';

  // Terrain-aware placement: trees, roads and channels must follow the same
  // undulation the land mesh shows and reuse the anchors it was flattened
  // around (so a prop never rests on a slope the building itself does not).
  const outline = createLakeOutline();
  const groundSampler = createTerrainSampler(outline, terrainAnchors());

  const cluster = assets.getObjectByName('ENV_TREE_CLUSTER');
  if (cluster) {
    const forest = buildInstancedForest(cluster, outline, obstacles, groundSampler);
    if (forest) {
      decoration.add(forest.group);
      app.registerTeardown(() => forest.dispose());
    } else {
      log.warn('ENV_TREE_CLUSTER present but produced no forest prototypes');
    }
  } else {
    log.warn('ENV_TREE_CLUSTER not found — skipping instanced forest');
  }

  decoration.add(buildRoadNetwork(groundSampler));
  decoration.add(buildWaterChannels(WATER_BODIES, groundSampler));

  app.world.add(decoration);
  app.registerTeardown(() => {
    decoration.removeFromParent();
  });

  log.info(
    `districts ready: ${targets.length} placement targets, meshes ${report.totalBefore} → ${report.totalAfter}, ` +
      `decoration children ${decoration.children.length}`,
  );
}

/**
 * Flattening anchors matching `environment.ts` — the terrain is flat inside
 * `flatInnerRadius` of each of these, so scenery there sits on `y ≈ 0`.
 */
function terrainAnchors(): Array<{ x: number; z: number }> {
  const anchors: Array<{ x: number; z: number }> = [];
  for (const id of DISTRICT_ORDER) anchors.push(toPoint(DISTRICTS[id].placement.center));
  for (const bridge of Object.values(BRIDGES)) anchors.push(toPoint(bridge.placement.center));
  for (const landmark of Object.values(LANDMARKS)) anchors.push(toPoint(landmark.placement.center));
  anchors.push(toPoint(STATION.placement.center));
  for (const channel of WATER_BODIES) {
    const mid = channel.outline[Math.floor(channel.outline.length / 2)];
    anchors.push({ x: mid[0], z: mid[1] });
  }
  return anchors;
}

function toPoint([x, z]: readonly [number, number]): { x: number; z: number } {
  return { x, z };
}

/** `?nomerge=1` 时跳过合批，用于性能"优化前"对照。 */
function shouldSkipMerge(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('nomerge') === '1';
  } catch {
    return false;
  }
}

/** 需要拾取与合批的顶层对象：8 组团 + 3 桥 + 胶囊 + 车站 + 环境小品。 */
function collectTargets(assets: Object3D): Object3D[] {
  const names = new Set<string>();
  for (const id of DISTRICT_ORDER) names.add(DISTRICTS[id].objectName);
  for (const key of Object.keys(BRIDGES) as BridgeId[]) names.add(BRIDGES[key].objectName);
  names.add(LANDMARKS.CAPSULE_CENTER.objectName);
  names.add(STATION.objectName);
  names.add('ENV_LANDSCAPE_ASSETS');

  const targets: Object3D[] = [];
  for (const objectName of names) {
    const object = assets.getObjectByName(objectName);
    if (object) targets.push(object);
    else log.warn(`placement target ${objectName} missing from ASSET_MODELS`);
  }
  return targets;
}

/** 被"实例化森林"接管原件的资产 id（原件保留在场景图中但不可见）。 */
export const DECORATION_HANDLED_ASSETS: readonly string[] = ['ENV_TREE_CLUSTER'];

/** 模块导出契约。 */
export const districtsModule: DioramaModule = { name, install };