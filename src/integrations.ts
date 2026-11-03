/**
 * 跨模块集成注册表（composition 层，见 docs/architecture.md §10）。
 *
 * `createApp` 在 `main.ts` 安装 `window.__DIORAMA__` **之前**就安装好了
 * `districts / railway / interactions / ui` 四个模块，因此这些模块无法在
 * 安装阶段直接往桥对象上挂方法。这里用一个小型单例对象作为"集线器"：
 * 各模块把自己的控制器注册进来，`main.ts` 再把它们暴露给
 * `window.__DIORAMA__`，供 e2e 测试调用。
 */

import type { Vector3 } from 'three';

/** 列车控制器（由 `src/railway` 注册）。 */
export interface TrainHandle {
  start(): void;
  pause(): void;
  setFollowing(on: boolean): void;
  focusTrain(): void;
  readonly isRunning: boolean;
  readonly isFollowing: boolean;
  readonly isDwelling: boolean;
  readonly carCount: number;
  readonly currentSpeed: number;
  readonly headPosition: Vector3;
  /** 各车厢世界坐标（用于验证多节车厢各自贴合曲线、不脱轨）。 */
  carPositions(): Vector3[];
  /** 所有车厢中心到轨道曲线的最大 XZ 距离（米）；≈0 表示完全在轨。 */
  railOffset(): number;
}

/** 选中事件（由 `src/interactions` 发出，`src/ui` 消费并渲染信息面板）。 */
export interface SelectionEvent {
  /** 顶层对象名（`DISTRICT_*` / `LANDMARK_*` / `STATION_MAIN` / `TRAIN_*`）。 */
  readonly name: string;
  /** 命中处的世界坐标，用于镜头聚焦。 */
  readonly position: readonly [number, number, number];
}

/** 交互控制器（由 `src/interactions` 注册）。 */
export interface InteractionHandle {
  select(name: string | null): void;
  getSelected(): string | null;
  focusOn(objectName: string, options?: { readonly zoom?: number; readonly durationMs?: number }): void;
  focusThemeRegion(id: string): void;
  resetCamera(): void;
  setAutoOrbit(on: boolean): void;
  isAutoOrbit(): boolean;
  /** 开启 / 关闭建筑点击高亮（拾取本身保留）。 */
  setHighlightEnabled(on: boolean): void;
  isHighlightEnabled(): boolean;
  /** 订阅选中变化；返回取消订阅函数。 */
  onSelect(listener: (event: SelectionEvent | null) => void): () => void;
  dispose(): void;
}

/** UI 控制器（由 `src/ui` 注册）。 */
export interface UiHandle {
  setCleanMode(on: boolean): void;
  isCleanMode(): boolean;
  setInfoPanelVisible(on: boolean): void;
  setDebugHud(on: boolean): void;
  isDebugHud(): boolean;
  takeScreenshot(): void;
  toggleFullscreen(): void;
}

/** 合批报告的最小结构（由 `src/districts` 注册，避免跨模块类型循环）。 */
export interface DistrictBatchSummary {
  readonly totalBefore: number;
  readonly totalAfter: number;
  readonly districts: Record<string, { readonly meshesBefore: number; readonly meshesAfter: number }>;
  readonly landmarks: Record<string, { readonly meshesBefore: number; readonly meshesAfter: number }>;
}

export interface IntegrationRegistry {
  train: TrainHandle | null;
  interaction: InteractionHandle | null;
  ui: UiHandle | null;
  /** 合批前后 draw call 统计（资产就绪后可用）。 */
  districtReport: (() => DistrictBatchSummary | null) | null;
}

export const INTEGRATION: IntegrationRegistry = {
  train: null,
  interaction: null,
  ui: null,
  districtReport: null,
};