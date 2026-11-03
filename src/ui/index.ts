/**
 * UI 模块（`src/ui` 对外入口）。
 *
 * 交付：
 *  - 左上标题卡、底部 12 项工具条、右上信息面板（均不遮挡主体）；
 *  - 从 `assets-manifest.json` 读取真实元数据（中文名 / 品级 / 三角形数）；
 *  - Clean 模式、全屏、截图、调试 HUD 显隐（默认隐藏）；
 *  - 把 UI 控制器注册到 `INTEGRATION.ui`，供 `__DIORAMA__` 调用。
 */

import type { App, DioramaModule } from '../core/types';
import { createLogger } from '../utils/logger';
import {
  BRIDGES,
  DISTRICT_ORDER,
  DISTRICTS,
  LANDMARKS,
  STATION,
  THEME_REGIONS,
  districtLabel,
  districtThemeRegion,
  type BridgeId,
  type DistrictId,
} from '../scene/layout';
import { INTEGRATION, type SelectionEvent, type UiHandle } from '../integrations';
import { injectUiStyles } from './styles';
import { mountInfoPanel, type InfoPanelData, type InfoPanelHandle } from './infoPanel';
import { mountToolbar, type ToolbarHandle } from './toolbar';

const log = createLogger('ui');

export const name = 'ui';

interface AssetMeta {
  readonly name: string;
  readonly district: string;
  readonly level: string;
  readonly triangles: number;
  readonly note?: string;
}

export function install(app: App): void {
  injectUiStyles(app.container.ownerDocument);

  const title = document.createElement('div');
  title.className = 'dq-title';
  const h1 = document.createElement('h1');
  h1.textContent = '华为练秋湖数字沙盘';
  const p = document.createElement('p');
  p.textContent = 'LIANQIU LAKE · HUAWEI R&D CENTER';
  title.append(h1, p);
  app.container.appendChild(title);

  const infoPanel = mountInfoPanel(app.container);
  const meta = new Map<string, AssetMeta>();
  void loadAssetMeta(meta);

  let cleanMode = false;
  let infoVisible = true;
  let debugHud = isDebugRequested();

  const applyHud = (): void => {
    const hud = document.getElementById('hud');
    if (hud) hud.hidden = !debugHud;
  };
  applyHud();

  const toolbar = mountToolbar(
    app.container,
    buildActions(),
    THEME_REGIONS.map((region) => ({ id: region.id, label: region.label })),
  );

  // 选中 → 信息面板
  const unsubscribeSelection =
    INTEGRATION.interaction?.onSelect((event: SelectionEvent | null) => {
      if (!event) {
        infoPanel.hide();
        return;
      }
      infoPanel.show(describe(event.name, meta));
    }) ?? (() => undefined);

  // 低频同步工具条按压态（列车 / 环绕 / 跟随 / 全屏）。
  let sync = 0;
  const unsubscribeTick = app.registerUpdate(({ delta }) => {
    sync += delta;
    if (sync < 0.35) return;
    sync = 0;
    const train = INTEGRATION.train;
    if (train) {
      toolbar.setPressed('train', train.isRunning);
      toolbar.setPressed('follow', train.isFollowing);
    }
    toolbar.setPressed('orbit', INTEGRATION.interaction?.isAutoOrbit() ?? false);
    toolbar.setPressed('controls', !app.controls.enabled);
    toolbar.setPressed('fullscreen', Boolean(document.fullscreenElement));
    toolbar.setPressed('clean', cleanMode);
  });

  const uiHandle: UiHandle = {
    setCleanMode: (on: boolean) => setCleanMode(on),
    isCleanMode: () => cleanMode,
    setInfoPanelVisible: (on: boolean) => setInfoPanel(on),
    setDebugHud: (on: boolean) => {
      debugHud = on;
      applyHud();
    },
    isDebugHud: () => debugHud,
    takeScreenshot: () => takeScreenshot(app),
    toggleFullscreen: () => void toggleFullscreen(),
  };
  INTEGRATION.ui = uiHandle;

  // 键盘快捷键：C = Clean、D = 调试 HUD、R = 重置、Esc = 退出 Clean / 全屏。
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (key === 'c') setCleanMode(!cleanMode);
    else if (key === 'd') uiHandle.setDebugHud(!debugHud);
    else if (key === 'r') INTEGRATION.interaction?.resetCamera();
    else if (event.key === 'Escape' && cleanMode) setCleanMode(false);
  };
  window.addEventListener('keydown', onKeyDown);

  app.registerTeardown(() => {
    window.removeEventListener('keydown', onKeyDown);
    unsubscribeSelection();
    unsubscribeTick();
    toolbar.dispose();
    infoPanel.dispose();
    title.remove();
    document.body.classList.remove('dq-clean');
    INTEGRATION.ui = null;
  });

  log.info('ui installed', { themeRegions: THEME_REGIONS.length });

  // -------------------------------------------------------------------------

  function buildActions() {
    return {
      onToggleControls: (locked: boolean) => {
        const enabled = !locked;
        app.controls.enabled = enabled;
        app.controls.enableRotate = enabled;
        app.controls.enableZoom = enabled;
        app.controls.enablePan = enabled;
      },
      onToggleHighlight: (on: boolean) => INTEGRATION.interaction?.setHighlightEnabled(on),
      onToggleInfoPanel: (on: boolean) => setInfoPanel(on),
      onFocus: () => {
        const selected = INTEGRATION.interaction?.getSelected();
        if (selected) INTEGRATION.interaction?.focusOn(selected);
        else app.resetView();
      },
      onToggleAutoOrbit: (on: boolean) => INTEGRATION.interaction?.setAutoOrbit(on),
      onToggleTrain: (on: boolean) => {
        const train = INTEGRATION.train;
        if (!train) return;
        if (on) train.start();
        else train.pause();
      },
      onToggleFollow: (on: boolean) => {
        const train = INTEGRATION.train;
        if (!train) return;
        if (on) INTEGRATION.interaction?.setAutoOrbit(false);
        train.setFollowing(on);
      },
      onResetCamera: () => INTEGRATION.interaction?.resetCamera(),
      onScreenshot: () => takeScreenshot(app),
      onToggleClean: (on: boolean) => setCleanMode(on),
      onToggleFullscreen: () => void toggleFullscreen(),
      onSelectThemeRegion: (id: string) => INTEGRATION.interaction?.focusThemeRegion(id),
    };
  }

  function setInfoPanel(on: boolean): void {
    if (infoVisible === on && infoPanel.isVisible() === on) return;
    infoVisible = on;
    if (on) {
      const selected = INTEGRATION.interaction?.getSelected();
      if (selected) infoPanel.show(describe(selected, meta));
      else infoPanel.setVisible(true);
    } else {
      infoPanel.setVisible(false);
    }
    toolbar.setPressed('info', on);
  }

  function setCleanMode(on: boolean): void {
    cleanMode = on;
    document.body.classList.toggle('dq-clean', on);
    toolbar.setPressed('clean', on);
    if (on) infoPanel.setVisible(false);
  }

  function takeScreenshot(application: App): void {
    const canvas = application.renderer.domElement;
    try {
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      link.download = `lianqiu-lake-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      link.click();
      log.info('screenshot exported');
    } catch (error) {
      log.error('screenshot failed', error);
    }
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
      toolbar.setPressed('fullscreen', Boolean(document.fullscreenElement));
    } catch (error) {
      log.warn('fullscreen request rejected', error);
    }
  }
}

// ---------------------------------------------------------------------------
// 元数据
// ---------------------------------------------------------------------------

interface RawManifestEntry {
  readonly assetId?: string;
  readonly name?: string;
  readonly district?: string;
  readonly fidelityLevel?: string;
  readonly triangleCount?: number;
  readonly note?: string;
}

async function loadAssetMeta(target: Map<string, AssetMeta>): Promise<void> {
  try {
    const base = import.meta.env.BASE_URL ?? '/';
    const url = `${base.endsWith('/') ? base : `${base}/`}assets-manifest.json`;
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      log.warn(`manifest unavailable for UI metadata (HTTP ${response.status})`);
      return;
    }
    const json = (await response.json()) as { assets?: RawManifestEntry[] };
    for (const entry of json.assets ?? []) {
      if (!entry.assetId) continue;
      target.set(entry.assetId, {
        name: entry.name ?? entry.assetId,
        district: entry.district ?? '—',
        level: entry.fidelityLevel ?? '—',
        triangles: entry.triangleCount ?? 0,
        note: entry.note || undefined,
      });
    }
    log.info(`UI metadata loaded: ${target.size} assets`);
  } catch (error) {
    log.warn('failed to load UI asset metadata', error);
  }
}

function describe(name: string, meta: Map<string, AssetMeta>): InfoPanelData {
  const entry = meta.get(name);

  const districtId = findDistrictId(name);
  if (districtId) {
    return {
      name: `${districtId} 区 · ${districtLabel(districtId)}`,
      district: districtThemeRegion(districtId),
      level: entry?.level ?? 'L3',
      triangles: entry?.triangles,
      assetId: name,
      note: entry?.note,
    };
  }

  const bridge = findBridgeId(name);
  if (bridge) {
    return {
      name: BRIDGES[bridge].label,
      district: entry?.district ?? 'LANDMARK',
      level: entry?.level ?? 'L3',
      triangles: entry?.triangles,
      assetId: name,
      note: entry?.note,
    };
  }

  if (name === LANDMARKS.CAPSULE_CENTER.objectName) {
    return {
      name: LANDMARKS.CAPSULE_CENTER.label,
      district: entry?.district ?? 'LANDMARK',
      level: entry?.level ?? 'L3',
      triangles: entry?.triangles,
      assetId: name,
    };
  }

  if (name === STATION.objectName) {
    return {
      name: STATION.label,
      district: entry?.district ?? 'STATION',
      level: entry?.level ?? 'L3',
      triangles: entry?.triangles,
      assetId: name,
    };
  }

  if (name.startsWith('TRAIN_')) {
    return {
      name: name === 'TRAIN_HEAD' ? '园区小火车车头' : '园区小火车车厢',
      district: 'TRAIN 园内小火车',
      level: entry?.level ?? 'L3',
      triangles: entry?.triangles,
      assetId: name,
      note: '按弧长采样运行；进站自动减速停靠。',
    };
  }

  return {
    name: entry?.name ?? name,
    district: entry?.district ?? '—',
    level: entry?.level ?? '—',
    triangles: entry?.triangles,
    assetId: name,
    note: entry?.note,
  };
}

function findDistrictId(objectName: string): DistrictId | null {
  for (const id of DISTRICT_ORDER) {
    if (DISTRICTS[id].objectName === objectName) return id;
  }
  return null;
}

function findBridgeId(objectName: string): BridgeId | null {
  for (const key of Object.keys(BRIDGES) as BridgeId[]) {
    if (BRIDGES[key].objectName === objectName) return key;
  }
  return null;
}

/** 调试 HUD 默认隐藏；仅 `?debug=1` / `#debug` 时开启。 */
function isDebugRequested(): boolean {
  try {
    const search = new URLSearchParams(window.location.search);
    return search.get('debug') === '1' || window.location.hash === '#debug';
  } catch {
    return false;
  }
}

/** 模块导出契约。 */
export const uiModule: DioramaModule = { name, install };

export type { InfoPanelHandle, ToolbarHandle };