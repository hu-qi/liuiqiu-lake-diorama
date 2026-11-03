/**
 * 镜头平滑聚焦：把 OrbitControls 的注视点（和可选缩放）在给定时间内缓动到目标。
 *
 * 由于是正交相机，"推出/拉近"体现为 `controls.target` 平移 + `camera.zoom`；
 * 为保证视线方向不变，相机位置随注视点同步平移相同增量。
 */

import { Vector3, type OrthographicCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, smoothstep } from '../utils/math';

export class CameraFocusController {
  private camera: OrthographicCamera | null = null;
  private controls: OrbitControls | null = null;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly current = new Vector3();
  private fromZoom = 1;
  private toZoom = 1;
  private elapsed = 0;
  private duration = 1;
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  start(
    camera: OrthographicCamera,
    controls: OrbitControls,
    target: Vector3,
    durationMs = 900,
    zoom?: number,
  ): void {
    this.camera = camera;
    this.controls = controls;
    this.from.copy(controls.target);
    this.to.copy(target);
    this.fromZoom = camera.zoom;
    this.toZoom = zoom ?? camera.zoom;
    this.elapsed = 0;
    this.duration = Math.max(durationMs, 1) / 1000;
    this.active = true;
  }

  cancel(): void {
    this.active = false;
  }

  update(delta: number): void {
    if (!this.active || !this.camera || !this.controls) return;
    const camera = this.camera;
    const controls = this.controls;

    this.elapsed += delta;
    const t = clamp(this.elapsed / this.duration, 0, 1);
    const eased = smoothstep(0, 1, t);

    this.current.lerpVectors(this.from, this.to, eased);
    // 目标点位移量 → 同步平移相机，保持观察方向。
    const dx = this.current.x - controls.target.x;
    const dy = this.current.y - controls.target.y;
    const dz = this.current.z - controls.target.z;
    controls.target.copy(this.current);
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;

    camera.zoom = this.fromZoom + (this.toZoom - this.fromZoom) * eased;
    camera.updateProjectionMatrix();
    controls.update();

    if (t >= 1) this.active = false;
  }
}

/** 模块级单例（单场景单应用）。 */
export const cameraFocus = new CameraFocusController();

/** 契约函数（docs/architecture.md §7.7）。 */
export function focusOn(
  camera: OrthographicCamera,
  controls: OrbitControls,
  target: Vector3,
  durationMs = 900,
  zoom?: number,
): void {
  cameraFocus.start(camera, controls, target, durationMs, zoom);
}