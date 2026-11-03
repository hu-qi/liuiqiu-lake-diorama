/**
 * 建筑信息面板（`ui/infoPanel.ts`）。
 *
 * 契约（docs/architecture.md §7.7）：`mountInfoPanel(container)` 返回
 * `{ show(entry), hide() }`。这里在其上扩展了三角形数、资产 id、备注等字段。
 */

import { createLogger } from '../utils/logger';

const log = createLogger('ui:infoPanel');

/** 面板展示数据。 */
export interface InfoPanelData {
  /** 建筑 / 地标显示名。 */
  readonly name: string;
  /** 所属组团或分类。 */
  readonly district: string;
  /** 还原等级 L0–L3。 */
  readonly level: string;
  /** 三角形数量（可选）。 */
  readonly triangles?: number;
  /** 资源 id（可选，便于调试）。 */
  readonly assetId?: string;
  /** 备注 / 已知限制（可选）。 */
  readonly note?: string;
}

export interface InfoPanelHandle {
  readonly element: HTMLElement;
  show(data: InfoPanelData): void;
  hide(): void;
  isVisible(): boolean;
  setVisible(on: boolean): void;
  dispose(): void;
}

const DEFAULT_HINT = '点击沙盘中的组团 / 地标 / 车站查看详情；点击空白处取消选中。';

/** 在 `container` 内挂载信息面板。 */
export function mountInfoPanel(container: HTMLElement): InfoPanelHandle {
  const root = document.createElement('aside');
  root.className = 'dq-info';
  root.setAttribute('data-visible', 'false');
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', '建筑信息面板');

  const title = document.createElement('h2');
  title.textContent = '练秋湖数字沙盘';

  const subtitle = document.createElement('p');
  subtitle.className = 'dq-info-sub';
  subtitle.textContent = 'LIANQIU LAKE DIORAMA';

  const list = document.createElement('dl');

  const hint = document.createElement('p');
  hint.className = 'dq-hint';
  hint.textContent = DEFAULT_HINT;

  root.append(title, subtitle, list, hint);
  container.appendChild(root);

  let visible = false;

  const addRow = (key: string, makeValue: () => Node): void => {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.appendChild(makeValue());
    list.append(dt, dd);
  };

  const textNode = (text: string): Node => document.createTextNode(text);

  const render = (data: InfoPanelData): void => {
    title.textContent = data.name;
    subtitle.textContent = `${data.district} · ${data.level}`;
    list.replaceChildren();

    addRow('组团 / 分类', () => textNode(data.district));
    addRow('还原品级', () => {
      const badge = document.createElement('span');
      badge.className = 'dq-level';
      badge.textContent = data.level;
      return badge;
    });
    addRow('三角形数', () =>
      textNode(data.triangles === undefined ? '—' : data.triangles.toLocaleString()),
    );
    if (data.assetId) addRow('资产 id', () => textNode(data.assetId as string));

    hint.textContent = data.note ?? DEFAULT_HINT;
  };

  const setVisible = (on: boolean): void => {
    visible = on;
    root.setAttribute('data-visible', on ? 'true' : 'false');
  };

  log.debug('info panel mounted');

  return {
    element: root,
    show(data: InfoPanelData): void {
      render(data);
      setVisible(true);
    },
    hide(): void {
      setVisible(false);
    },
    isVisible(): boolean {
      return visible;
    },
    setVisible,
    dispose(): void {
      root.remove();
    },
  };
}