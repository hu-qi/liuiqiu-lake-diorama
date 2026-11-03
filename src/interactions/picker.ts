/**
 * 拾取与高亮（`interactions`）。
 *
 * - `DistrictPicker` 用 `Raycaster` 命中组团 / 地标 / 车站 / 列车等顶层对象，
 *   并把"命中网格"向上归并到带规范名的顶层对象（`DISTRICT_*` / `LANDMARK_*`…）；
 * - 悬停 → 轻量自发光；点击 → 持久选中（更强自发光）+ 回调；
 * - 通过指针位移阈值区分"点击"与"OrbitControls 拖拽旋转"。
 *
 * 高亮采用材质 `emissive` 覆写（记录原值，可无损还原），因为合批后每个
 * 资产的材质是独占的，不会误亮到别的组团。
 */

import {
  Color,
  Raycaster,
  Vector2,
  type Camera,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { createLogger } from '../utils/logger';

const log = createLogger('interactions:picker');

/** 顶层对象名前缀 —— 拾取只认这些"可交互根"。 */
const INTERACTIVE_PREFIXES = ['DISTRICT_', 'LANDMARK_', 'STATION_', 'TRAIN_'] as const;

const HOVER_COLOR = 0xffd9a0;
const SELECT_COLOR = 0xffc061;
const HOVER_INTENSITY = 0.22;
const SELECT_INTENSITY = 0.5;
/** 视为"点击"而非"拖拽"的像素阈值。 */
const CLICK_THRESHOLD = 8;

interface OriginalEmissive {
  readonly color: number;
  readonly intensity: number;
}

export interface PickTarget {
  readonly name: string;
  readonly object: Object3D;
}

export interface DistrictPickerOptions {
  readonly onChange?: (target: PickTarget | null) => void;
  readonly onDoubleClick?: (target: PickTarget) => void;
}

export class DistrictPicker {
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly roots: Object3D[];
  private readonly domElement: HTMLElement;
  private readonly camera: Camera;
  private readonly options: DistrictPickerOptions;

  private enabled = true;
  private dirty = false;
  private hovered: PickTarget | null = null;
  private selected: PickTarget | null = null;
  private highlightedSelected: Object3D | null = null;
  private highlightedHovered: Object3D | null = null;
  private readonly savedEmissive = new Map<Material, OriginalEmissive>();

  private pointerDownX = 0;
  private pointerDownY = 0;
  private isPointerDown = false;
  private dragged = false;

  constructor(
    domElement: HTMLElement,
    camera: Camera,
    roots: Object3D[],
    options: DistrictPickerOptions = {},
  ) {
    this.domElement = domElement;
    this.camera = camera;
    this.roots = roots;
    this.options = options;

    this.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.domElement.addEventListener('pointerleave', this.handlePointerLeave);
    this.domElement.addEventListener('pointercancel', this.handlePointerCancel);
    this.domElement.addEventListener('dblclick', this.handleDblClick);
  }

  /** 当前选中对象名（无选中时 null）。 */
  get selectedName(): string | null {
    return this.selected?.name ?? null;
  }

  /** 当前悬停对象名。 */
  get hoveredName(): string | null {
    return this.hovered?.name ?? null;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.hovered = null;
      this.updateCursor(false);
      this.refreshHighlight();
    }
  }

  /** 外部触发选中（供 `__DIORAMA__.select()` 与主题区域切换使用）。 */
  selectByName(name: string | null): boolean {
    if (!name) {
      this.selected = null;
      this.refreshHighlight();
      return false;
    }
    const object = this.roots.find((root) => root.name === name) ?? findByName(this.roots, name);
    if (!object) {
      log.warn(`selectByName: "${name}" not found among pick roots`);
      return false;
    }
    this.selected = { name: object.name, object };
    this.refreshHighlight();
    return true;
  }

  /** 每帧处理一次悬停（指针移动时才真正做射线检测）。 */
  update(): void {
    if (!this.enabled) {
      this.updateCursor(false);
      return;
    }
    if (!this.dirty) return;
    this.dirty = false;

    const hit = this.pick();
    this.updateCursor(hit !== null);
    if (hit?.name === this.hovered?.name) return;
    this.hovered = hit;
    this.refreshHighlight();
  }

  dispose(): void {
    this.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.domElement.removeEventListener('pointerleave', this.handlePointerLeave);
    this.domElement.removeEventListener('pointercancel', this.handlePointerCancel);
    this.domElement.removeEventListener('dblclick', this.handleDblClick);
    this.updateCursor(false);
    this.restoreEmissive();
  }

  // -------------------------------------------------------------------------

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.isPointerDown) {
      const dx = Math.abs(event.clientX - this.pointerDownX);
      const dy = Math.abs(event.clientY - this.pointerDownY);
      if (dx > CLICK_THRESHOLD || dy > CLICK_THRESHOLD) {
        this.dragged = true;
      }
    }
    this.setPointerFromEvent(event);
    this.dirty = true;
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.isPointerDown = true;
    this.pointerDownX = event.clientX;
    this.pointerDownY = event.clientY;
    this.dragged = false;
    this.setPointerFromEvent(event);
    this.dirty = true;
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const wasDragging = this.dragged;
    this.isPointerDown = false;
    this.dragged = false;
    if (wasDragging) return;

    this.setPointerFromEvent(event);
    const hit = this.pick();

    if (hit) {
      // 点击已选中的对象时取消选中（toggle selection）
      if (this.selected?.name === hit.name) {
        log.debug(`deselected ${hit.name} (toggle)`);
        this.selected = null;
        this.refreshHighlight();
        this.options.onChange?.(null);
      } else {
        log.debug(`picked ${hit.name}`);
        this.selected = hit;
        this.refreshHighlight();
        this.options.onChange?.(hit);
      }
    } else {
      log.debug('clicked empty space, deselecting');
      this.selected = null;
      this.refreshHighlight();
      this.options.onChange?.(null);
    }
  };

  private readonly handlePointerLeave = (): void => {
    this.isPointerDown = false;
    this.dragged = false;
    this.hovered = null;
    this.updateCursor(false);
    this.refreshHighlight();
  };

  private readonly handlePointerCancel = (): void => {
    this.isPointerDown = false;
    this.dragged = false;
  };

  private readonly handleDblClick = (event: MouseEvent): void => {
    if (!this.enabled) return;
    this.setPointerFromEvent(event);
    const hit = this.pick();
    if (hit) {
      log.debug(`double clicked ${hit.name}`);
      this.options.onDoubleClick?.(hit);
    }
  };

  private setPointerFromEvent(event: MouseEvent | PointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    this.pointer.set(
      ((event.clientX - rect.left) / width) * 2 - 1,
      -((event.clientY - rect.top) / height) * 2 + 1,
    );
  }

  private updateCursor(isInteractive: boolean): void {
    this.domElement.style.cursor = isInteractive ? 'pointer' : 'default';
  }

  private pick(): PickTarget | null {
    if (this.roots.length === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.roots, true);
    for (const hit of hits) {
      const root = resolvePickRoot(hit.object, this.roots);
      if (root) return { name: root.name, object: root };
    }
    return null;
  }

  private refreshHighlight(): void {
    const targetSelected = this.selected?.object ?? null;
    const targetHovered =
      this.hovered?.object && this.hovered.object !== targetSelected
        ? this.hovered.object
        : null;

    if (
      this.highlightedSelected === targetSelected &&
      this.highlightedHovered === targetHovered
    ) {
      return;
    }

    // 还原不再处于任何高亮态的物体
    if (
      this.highlightedSelected &&
      this.highlightedSelected !== targetSelected &&
      this.highlightedSelected !== targetHovered
    ) {
      this.revertHighlight(this.highlightedSelected);
    }
    if (
      this.highlightedHovered &&
      this.highlightedHovered !== targetSelected &&
      this.highlightedHovered !== targetHovered
    ) {
      this.revertHighlight(this.highlightedHovered);
    }

    // 选中的建筑保持选中金黄色自发光高亮
    if (targetSelected) {
      this.applyEmissive(targetSelected, SELECT_COLOR, SELECT_INTENSITY);
    }

    // 悬停在其他物体时展示轻量 hover 高亮
    if (targetHovered) {
      this.applyEmissive(targetHovered, HOVER_COLOR, HOVER_INTENSITY);
    }

    this.highlightedSelected = targetSelected;
    this.highlightedHovered = targetHovered;
  }

  private applyEmissive(target: Object3D, color: number, intensity: number): void {
    const tint = new Color(color);
    target.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const emissive = (material as { emissive?: Color }).emissive;
        if (!(emissive instanceof Color)) continue;
        if (!this.savedEmissive.has(material)) {
          this.savedEmissive.set(material, {
            color: emissive.getHex(),
            intensity: (material as { emissiveIntensity?: number }).emissiveIntensity ?? 1,
          });
        }
        emissive.copy(tint);
        (material as { emissiveIntensity?: number }).emissiveIntensity = intensity;
      }
    });
  }

  private revertHighlight(target: Object3D): void {
    target.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const original = this.savedEmissive.get(material);
        if (original) {
          const emissive = (material as { emissive?: Color }).emissive;
          if (emissive instanceof Color) emissive.setHex(original.color);
          (material as { emissiveIntensity?: number }).emissiveIntensity = original.intensity;
          this.savedEmissive.delete(material);
        }
      }
    });
  }

  private restoreEmissive(): void {
    for (const [material, original] of this.savedEmissive) {
      const emissive = (material as { emissive?: Color }).emissive;
      if (emissive instanceof Color) emissive.setHex(original.color);
      (material as { emissiveIntensity?: number }).emissiveIntensity = original.intensity;
    }
    this.savedEmissive.clear();
    this.highlightedSelected = null;
    this.highlightedHovered = null;
  }
}


/**
 * 从命中网格向上找到最近的"规范顶层对象"。
 *
 * 合批（`districts/geometry.ts`）会给每个批量网格起名
 * `<root.name>_<MATERIAL>`，例如 `DISTRICT_D_COLLEGE_MAT_STONE`。这些名字同样
 * 以 `DISTRICT_` 等前缀开头，若只按前缀匹配就会把它们误判为顶层对象，导致
 * 信息面板把内部网格名当成资产名展示。
 *
 * 因此这里优先比对真正的 `roots`（构造时传入的规范顶层对象）和它们的名称，
 * 只有找不到时才退回前缀匹配，并显式排除合批网格名（含 `_MAT` 段）。
 */
export function resolvePickRoot(
  object: Object3D,
  roots: readonly Object3D[],
): Object3D | null {
  let node: Object3D | null = object;
  while (node) {
    const current: Object3D = node;
    if (roots.includes(current)) return current;
    if (isCanonicalRootName(current.name, roots)) return current;
    node = node.parent;
  }
  return null;
}

/** 名称是否为某个规范顶层对象名（排除合批网格的 `<name>_MAT...` 变体）。 */
function isCanonicalRootName(name: string, roots: readonly Object3D[]): boolean {
  if (!name) return false;
  if (roots.some((root) => root.name === name)) return true;
  if (!INTERACTIVE_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
  // 合批网格名形如 `DISTRICT_D_COLLEGE_MAT_STONE`，出现 `_MAT` 段即视为非顶层。
  return !/_MAT(_|$)/.test(name);
}

function findByName(roots: readonly Object3D[], name: string): Object3D | null {
  for (const root of roots) {
    const found = root.getObjectByName(name);
    if (found) return found;
  }
  return null;
}