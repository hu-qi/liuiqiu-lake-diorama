/**
 * 交互模块（`src/interactions` 对外入口）。
 *
 * 组装：`DistrictPicker`（raycast 拾取 → 高亮 → 回调）、`cameraFocus`
 * （平滑聚焦）、`autoOrbit`（自动环绕），并把控制器注册到
 * `INTEGRATION.interaction` 供 UI / `__DIORAMA__` 调用。
 *
 * 与其它模块一致：安装时只登记"等待资产"回调和每帧 tick，真正的拾取根
 * 在 `ASSET_MODELS` 出现后才构建。
 */

import { Box3, Vector3, type Object3D } from 'three';
import type { App, DioramaModule } from '../core/types';
import { createLogger } from '../utils/logger';
import {
  BRIDGES,
  DISTRICT_ORDER,
  DISTRICTS,
  LANDMARKS,
  STATION,
  THEME_REGIONS,
  type BridgeId,
} from '../scene/layout';
import { INTEGRATION, type InteractionHandle, type SelectionEvent } from '../integrations';
import { DistrictPicker, type PickTarget } from './picker';
import { cameraFocus, focusOn } from './cameraFocus';
import { autoOrbit, setAutoOrbit } from './orbit';

const log = createLogger('interactions');

export const name = 'interactions';

/** 聚焦单个组团时的默认放大倍率。 */
const DISTRICT_FOCUS_ZOOM = 1.9;
const FOCUS_DURATION_MS = 850;

export function install(app: App): void {
  const roots: Object3D[] = [];
  const listeners = new Set<(event: SelectionEvent | null) => void>();
  let picker: DistrictPicker | null = null;
  let highlightEnabled = true;

  const emit = (target: PickTarget | null): void => {
    if (!target) {
      for (const listener of listeners) listener(null);
      return;
    }
    const center = new Box3().setFromObject(target.object).getCenter(new Vector3());
    const event: SelectionEvent = {
      name: target.name,
      position: [center.x, center.y, center.z],
    };
    for (const listener of listeners) listener(event);
  };

  /** 资产就绪后构建拾取根（只建一次）。 */
  const ensurePicker = (): void => {
    if (picker || !app.scene.getObjectByName('ASSET_MODELS')) return;

    const names = new Set<string>();
    for (const id of DISTRICT_ORDER) names.add(DISTRICTS[id].objectName);
    for (const key of Object.keys(BRIDGES) as BridgeId[]) names.add(BRIDGES[key].objectName);
    names.add(LANDMARKS.CAPSULE_CENTER.objectName);
    names.add(STATION.objectName);

    for (const objectName of names) {
      const object = app.scene.getObjectByName(objectName);
      if (object) roots.push(object);
    }
    const train = app.scene.getObjectByName('TRAIN');
    if (train) roots.push(train);

    picker = new DistrictPicker(app.renderer.domElement, app.camera, roots, {
      onChange: emit,
      onDoubleClick: (target) => {
        handle.focusOn(target.name);
      },
    });
    picker.setEnabled(highlightEnabled);
    log.info(`picker ready with ${roots.length} pick roots`);
  };

  const onControlsStart = (): void => {
    if (cameraFocus.isActive) {
      log.debug('controls interaction started, cancelling cameraFocus');
      cameraFocus.cancel();
    }
  };
  app.controls.addEventListener('start', onControlsStart);

  const selectExternal = (targetName: string | null): void => {
    ensurePicker();
    if (targetName === null) {
      picker?.selectByName(null);
      emit(null);
      return;
    }
    const object = app.scene.getObjectByName(targetName);
    if (!object) {
      log.warn(`select("${targetName}") — object not available`);
      return;
    }
    picker?.selectByName(targetName);
    emit({ name: targetName, object });
  };

  const handle: InteractionHandle = {
    select: selectExternal,
    getSelected: () => picker?.selectedName ?? null,
    focusOn: (objectName: string, options) => {
      INTEGRATION.train?.setFollowing(false);
      autoOrbit.set(app.controls, false);
      const object = app.scene.getObjectByName(objectName);
      if (!object) {
        log.warn(`focusOn: "${objectName}" not found`);
        return;
      }
      const box = new Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const center = box.getCenter(new Vector3());
      focusOn(
        app.camera,
        app.controls,
        center,
        options?.durationMs ?? FOCUS_DURATION_MS,
        options?.zoom ?? DISTRICT_FOCUS_ZOOM,
      );
      selectExternal(objectName);
    },
    focusThemeRegion: (id: string) => {
      const region = THEME_REGIONS.find((entry) => entry.id === id);
      if (!region) return;
      const box = new Box3();
      let hasBounds = false;
      for (const districtId of region.districtIds) {
        const object = app.scene.getObjectByName(DISTRICTS[districtId].objectName);
        if (!object) continue;
        const districtBox = new Box3().setFromObject(object);
        if (districtBox.isEmpty()) continue;
        box.union(districtBox);
        hasBounds = true;
      }
      if (!hasBounds) return;
      const center = box.getCenter(new Vector3());
      autoOrbit.set(app.controls, false);
      INTEGRATION.train?.setFollowing(false);
      focusOn(app.camera, app.controls, center, FOCUS_DURATION_MS, DISTRICT_FOCUS_ZOOM);
      selectExternal(DISTRICTS[region.districtIds[0]].objectName);
    },
    resetCamera: () => {
      cameraFocus.cancel();
      autoOrbit.set(app.controls, false);
      INTEGRATION.train?.setFollowing(false);
      app.resetView();
      selectExternal(null);
    },
    setAutoOrbit: (on: boolean) => {
      autoOrbit.set(app.controls, on);
      if (on) {
        // 自动环绕与跟随列车是两套相机运动，互斥。
        INTEGRATION.train?.setFollowing(false);
      }
    },
    isAutoOrbit: () => autoOrbit.isEnabled,
    setHighlightEnabled: (on: boolean) => {
      picker?.setEnabled(on);
      highlightEnabled = on;
    },
    isHighlightEnabled: () => highlightEnabled,
    onSelect: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      app.controls.removeEventListener('start', onControlsStart);
      cameraFocus.cancel();
      autoOrbit.set(app.controls, false);
      picker?.dispose();
      picker = null;
      listeners.clear();
    },
  };

  INTEGRATION.interaction = handle;

  const unsubscribeTick = app.registerUpdate((context) => {
    ensurePicker();
    picker?.update();
    cameraFocus.update(context.delta);
    autoOrbit.update(context.delta);
  });

  app.registerTeardown(() => {
    unsubscribeTick();
    handle.dispose();
    INTEGRATION.interaction = null;
  });

  log.info('interactions installed');
}

/** 模块导出契约。 */
export const interactionsModule: DioramaModule = { name, install };

export { DistrictPicker };
export { focusOn, setAutoOrbit, cameraFocus, autoOrbit };
export type { PickTarget };