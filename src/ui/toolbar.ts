/**
 * 工具条（`ui/toolbar.ts`）—— PROMPT/任务要求的 12 项能力全部落地：
 *
 *   1 旋转缩放（锁定 / 解锁视角）      7 跟随列车
 *   2 建筑点击高亮                     8 重置相机
 *   3 信息面板显隐                     9 截图
 *   4 镜头平滑聚焦                    10 Clean 模式
 *   5 全景自动环绕                    11 全屏
 *   6 列车启停                        12 七大主题区域切换
 *
 * 契约（docs/architecture.md §7.7）：`mountToolbar(container, actions)`。
 */

import { createLogger } from '../utils/logger';

const log = createLogger('ui:toolbar');

/** 工具条动作回调（全部可选，缺省为无操作）。 */
export interface ToolbarActions {
  readonly onToggleControls?: (on: boolean) => void;
  readonly onToggleHighlight?: (on: boolean) => void;
  readonly onToggleInfoPanel?: (on: boolean) => void;
  readonly onFocus?: () => void;
  readonly onToggleAutoOrbit?: (on: boolean) => void;
  readonly onToggleTrain?: (on: boolean) => void;
  readonly onToggleFollow?: (on: boolean) => void;
  readonly onResetCamera?: () => void;
  readonly onScreenshot?: () => void;
  readonly onToggleClean?: (on: boolean) => void;
  readonly onToggleFullscreen?: (on: boolean) => void;
  readonly onSelectThemeRegion?: (id: string) => void;
}

export interface ThemeRegionOption {
  readonly id: string;
  readonly label: string;
}

export interface ToolbarHandle {
  readonly element: HTMLElement;
  /** 设置某个按钮的选中态（aria-pressed）。 */
  setPressed(id: ToolbarButtonId, on: boolean): void;
  /** 设置当前激活的主题区域（无则为 null）。 */
  setActiveRegion(id: string | null): void;
  /** 展开 / 收起主题区域选择器。 */
  setRegionsOpen(on: boolean): void;
  dispose(): void;
}

export type ToolbarButtonId =
  | 'controls'
  | 'highlight'
  | 'info'
  | 'focus'
  | 'orbit'
  | 'train'
  | 'follow'
  | 'reset'
  | 'screenshot'
  | 'clean'
  | 'fullscreen'
  | 'regions';

interface ButtonSpec {
  readonly id: ToolbarButtonId;
  readonly label: string;
  readonly toggle: boolean;
  readonly icon: string;
}

const ICONS: Record<string, string> = {
  controls:
    '<path d="M12 3a9 9 0 1 0 9 9" /><path d="M21 3v6h-6" /><path d="M12 8v8M8 12h8" />',
  highlight:
    '<path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" /><path d="M14 6l3 3" /><path d="M4 4h6M4 8h3" />',
  info: '<circle cx="12" cy="12" r="9" /><path d="M12 10v6" /><path d="M12 7.4v.1" />',
  focus:
    '<circle cx="12" cy="12" r="4.2" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />',
  orbit:
    '<ellipse cx="12" cy="12" rx="9" ry="4.6" /><path d="M12 3v18" /><circle cx="12" cy="12" r="1.4" />',
  train:
    '<rect x="7" y="4" width="10" height="13" rx="2.2" /><path d="M9 20l1.2-3M15 20l-1.2-3" /><path d="M7 12h10" />',
  play: '<path d="M9 6.5l9 5.5-9 5.5z" />',
  pause: '<path d="M9.5 6.5v11M14.5 6.5v11" />',
  follow:
    '<path d="M3 12l7-7v4h5v-4l7 7-7 7v-4H10v4z" />',
  reset:
    '<path d="M4 12a8 8 0 1 1 2.4 5.7" /><path d="M4 19v-5h5" />',
  screenshot:
    '<rect x="3" y="7" width="18" height="12" rx="2.6" /><circle cx="12" cy="13" r="3.4" /><path d="M8.5 7l1.2-2.2h4.6L15.5 7" />',
  clean:
    '<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z" /><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />',
  fullscreen:
    '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />',
  regions:
    '<path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />',
};

const BUTTONS: readonly ButtonSpec[] = [
  { id: 'controls', label: '锁定视角', toggle: true, icon: 'controls' },
  { id: 'highlight', label: '建筑点击高亮', toggle: true, icon: 'highlight' },
  { id: 'info', label: '信息面板', toggle: true, icon: 'info' },
  { id: 'focus', label: '镜头平滑聚焦', toggle: false, icon: 'focus' },
  { id: 'orbit', label: '全景自动环绕', toggle: true, icon: 'orbit' },
  { id: 'train', label: '列车启停', toggle: true, icon: 'train' },
  { id: 'follow', label: '跟随列车', toggle: true, icon: 'follow' },
  { id: 'reset', label: '重置相机', toggle: false, icon: 'reset' },
  { id: 'screenshot', label: '截图', toggle: false, icon: 'screenshot' },
  { id: 'clean', label: 'Clean 模式', toggle: true, icon: 'clean' },
  { id: 'fullscreen', label: '全屏', toggle: true, icon: 'fullscreen' },
  { id: 'regions', label: '七大主题区域切换', toggle: true, icon: 'regions' },
];

/** 在 `container` 内挂载工具条。 */
export function mountToolbar(
  container: HTMLElement,
  actions: ToolbarActions,
  regions: readonly ThemeRegionOption[] = [],
): ToolbarHandle {
  const nav = document.createElement('nav');
  nav.className = 'dq-toolbar';
  nav.setAttribute('aria-label', '沙盘工具条');

  const buttons = new Map<ToolbarButtonId, HTMLButtonElement>();

  // 分组：视角 | 相机 | 列车 | 相机复位/截图 | 系统
  const separatorBefore = new Set<ToolbarButtonId>(['focus', 'train', 'reset', 'clean']);

  for (const spec of BUTTONS) {
    if (separatorBefore.has(spec.id)) nav.append(separator());

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dq-btn';
    button.dataset.action = spec.id;
    button.title = spec.label;
    button.setAttribute('aria-label', spec.label);
    if (spec.toggle) button.setAttribute('aria-pressed', 'false');
    button.innerHTML = svg(spec.icon);
    button.addEventListener('click', () => handleClick(spec));
    buttons.set(spec.id, button);
    nav.append(button);
  }

  const regionsPanel = document.createElement('div');
  regionsPanel.className = 'dq-regions';
  regionsPanel.setAttribute('data-open', 'false');
  regionsPanel.setAttribute('role', 'group');
  regionsPanel.setAttribute('aria-label', '七大主题区域');
  const regionButtons = new Map<string, HTMLButtonElement>();
  for (const region of regions) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'dq-chip';
    chip.textContent = region.label;
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      const active = chip.getAttribute('aria-pressed') === 'true';
      setActiveRegion(active ? null : region.id);
      if (!active) actions.onSelectThemeRegion?.(region.id);
    });
    regionButtons.set(region.id, chip);
    regionsPanel.append(chip);
  }

  const cleanExit = document.createElement('button');
  cleanExit.type = 'button';
  cleanExit.className = 'dq-clean-exit';
  cleanExit.title = '退出 Clean 模式';
  cleanExit.setAttribute('aria-label', '退出 Clean 模式');
  cleanExit.innerHTML = svg('clean');
  cleanExit.addEventListener('click', () => {
    // 由 ui 模块维护实际状态；这里直接调用回调并以 pressed 状态为准。
    actions.onToggleClean?.(false);
  });

  container.append(nav, regionsPanel, cleanExit);

  const pressed: Record<string, boolean> = {
    controls: false,
    highlight: true,
    info: true,
    orbit: false,
    train: true,
    follow: false,
    clean: false,
    fullscreen: false,
    regions: false,
  };

  function handleClick(spec: ButtonSpec): void {
    const isOn = pressed[spec.id] ?? false;
    const next = spec.toggle ? !isOn : isOn;

    switch (spec.id) {
      case 'controls':
        pressed.controls = next;
        actions.onToggleControls?.(next);
        break;
      case 'highlight':
        pressed.highlight = next;
        actions.onToggleHighlight?.(next);
        break;
      case 'info':
        pressed.info = next;
        actions.onToggleInfoPanel?.(next);
        break;
      case 'focus':
        actions.onFocus?.();
        break;
      case 'orbit':
        pressed.orbit = next;
        actions.onToggleAutoOrbit?.(next);
        break;
      case 'train':
        pressed.train = next;
        actions.onToggleTrain?.(next);
        updateTrainIcon(next);
        break;
      case 'follow':
        pressed.follow = next;
        actions.onToggleFollow?.(next);
        break;
      case 'reset':
        actions.onResetCamera?.();
        break;
      case 'screenshot':
        actions.onScreenshot?.();
        break;
      case 'clean':
        pressed.clean = next;
        actions.onToggleClean?.(next);
        break;
      case 'fullscreen':
        actions.onToggleFullscreen?.(next);
        break;
      case 'regions':
        pressed.regions = next;
        setRegionsOpen(next);
        break;
      default:
        break;
    }

    if (spec.toggle) {
      const button = buttons.get(spec.id);
      button?.setAttribute('aria-pressed', String(next));
    }
  }

  function updateTrainIcon(running: boolean): void {
    const button = buttons.get('train');
    if (button) button.innerHTML = svg(running ? 'pause' : 'play');
  }

  function setPressed(id: ToolbarButtonId, on: boolean): void {
    pressed[id] = on;
    const button = buttons.get(id);
    button?.setAttribute('aria-pressed', String(on));
    if (id === 'train') updateTrainIcon(on);
  }

  function setRegionsOpen(on: boolean): void {
    regionsPanel.setAttribute('data-open', on ? 'true' : 'false');
    pressed.regions = on;
    const button = buttons.get('regions');
    button?.setAttribute('aria-pressed', String(on));
  }

  function setActiveRegion(id: string | null): void {
    for (const [regionId, chip] of regionButtons) {
      chip.setAttribute('aria-pressed', String(regionId === id));
    }
  }

  updateTrainIcon(true);
  log.debug('toolbar mounted');

  return {
    element: nav,
    setPressed,
    setActiveRegion,
    setRegionsOpen,
    dispose(): void {
      nav.remove();
      regionsPanel.remove();
      cleanExit.remove();
    },
  };
}

function separator(): HTMLElement {
  const sep = document.createElement('span');
  sep.className = 'dq-sep';
  sep.setAttribute('aria-hidden', 'true');
  return sep;
}

function svg(name: string): string {
  const path = ICONS[name] ?? '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}