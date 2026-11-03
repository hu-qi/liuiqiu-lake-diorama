/**
 * 全景自动环绕：让相机绕注视点做匀速水平环绕。
 *
 * 直接绕 Y 轴旋转"相机相对注视点的偏移"再交给 OrbitControls 归一化，
 * 因此不会破坏极角限制 / 缩放范围。
 */

import { Vector3, type OrthographicCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_SPEED = 0.16; // 弧度/秒

export class AutoOrbitController {
  private controls: OrbitControls | null = null;
  private camera: OrthographicCamera | null = null;
  private enabled = false;
  private speed = DEFAULT_SPEED;
  private readonly offset = new Vector3();

  get isEnabled(): boolean {
    return this.enabled;
  }

  set(controls: OrbitControls, on: boolean, speed?: number): void {
    this.controls = controls;
    this.camera = controls.object as OrthographicCamera;
    this.enabled = on;
    if (speed !== undefined) this.speed = speed;
  }

  update(delta: number): void {
    if (!this.enabled || !this.controls || !this.camera) return;
    this.offset.copy(this.camera.position).sub(this.controls.target);
    const angle = this.speed * delta;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = this.offset.x * cos + this.offset.z * sin;
    const z = -this.offset.x * sin + this.offset.z * cos;
    this.camera.position.set(
      this.controls.target.x + x,
      this.controls.target.y + this.offset.y,
      this.controls.target.z + z,
    );
    this.camera.updateMatrixWorld();
    this.controls.update();
  }
}

/** 模块级单例（单场景单应用）。 */
export const autoOrbit = new AutoOrbitController();

/** 契约函数（docs/architecture.md §7.7）。 */
export function setAutoOrbit(controls: OrbitControls, on: boolean, speed?: number): void {
  autoOrbit.set(controls, on, speed);
}