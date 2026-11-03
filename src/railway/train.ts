/**
 * 园区小火车：多节车厢**各自按弧长采样**（getPointAt / getTangentAt）
 * 沿同一轨道曲线运行，因此天然贴合弯道、不会脱轨，也不会退化成
 * "一根僵直长方体"。
 *
 * 运行逻辑：
 *  - 巡航 → 接近主车站时按剩余弧长线性减速 → 进站停车（dwell）→ 再次启动；
 *  - 车厢按"车头弧长 - 车厢序号 × 间距"独立定位与朝向；
 *  - `followCamera` 用**逐帧位移增量**平移相机与目标点，确保开启时零跳变。
 */

import {
  Group,
  Matrix4,
  Quaternion,
  Vector3,
  type CatmullRomCurve3,
  type Object3D,
  type OrthographicCamera,
} from 'three';
import { createLogger } from '../utils/logger';
import { clamp } from '../utils/math';

const log = createLogger('railway:train');

/**
 * 车轮相对轨面的抬升余量（米）。
 * GLB 的车轮网格可能略低于其包围盒 min.y，留 2 cm 间隙避免静帧出现
 * "轮轨穿插"的像素级重叠。
 */
const WHEEL_CLEARANCE = 0.02;

export interface TrainOptions {
  /** 相邻车厢中心的弧长间距（米）。 */
  readonly spacing: number;
  /** 巡航速度（米/秒）。 */
  readonly cruiseSpeed: number;
  /** 钢轨顶面高度（车厢车轮落点）。 */
  readonly railTopY: number;
  /** 主车站对应的弧长参数 [0,1)。 */
  readonly stationU: number;
  /** 车厢模型自带的"轮底离原点"高度（GLB 包围盒 min.y）。 */
  readonly wheelY: number;
  /** 进站停车时长（秒）。 */
  readonly dwellSeconds?: number;
  /** 减速区长度（米）。 */
  readonly brakeDistance?: number;
}

type TrainState = 'stopped' | 'running' | 'dwelling';

export class DioramaTrain {
  readonly group: Group;
  readonly curve: CatmullRomCurve3;
  readonly length: number;

  private readonly cars: Object3D[];
  private readonly spacing: number;
  private readonly cruiseSpeed: number;
  private readonly railTopY: number;
  private readonly wheelY: number;
  private readonly stationU: number;
  private readonly dwellMax: number;
  private readonly brakeDistance: number;

  /** 车头弧长参数 [0,1)。 */
  private u: number;
  private speed = 0;
  private dwell = 0;
  private state: TrainState = 'dwelling';
  private running = false;

  private following = false;
  private followCameraRef: OrthographicCamera | null = null;
  private followTargetRef: Vector3 | null = null;

  private readonly headPositionValue = new Vector3();
  private readonly previousHead = new Vector3();
  // 复用的临时量，避免逐帧分配。
  private readonly scratchPoint = new Vector3();
  private readonly scratchTangent = new Vector3();
  private readonly scratchX = new Vector3();
  private readonly scratchY = new Vector3();
  private readonly scratchZ = new Vector3();
  private readonly scratchBasis = new Matrix4();
  private readonly scratchQuaternion = new Quaternion();
  private readonly upVector = new Vector3(0, 1, 0);

  constructor(cars: Object3D[], curve: CatmullRomCurve3, options: TrainOptions) {
    if (cars.length === 0) throw new Error('DioramaTrain requires at least one car');

    this.group = new Group();
    this.group.name = 'TRAIN';
    this.curve = curve;
    this.length = curve.getLength();
    this.cars = cars;
    this.spacing = options.spacing;
    this.cruiseSpeed = options.cruiseSpeed;
    this.railTopY = options.railTopY;
    this.wheelY = options.wheelY;
    this.stationU = options.stationU;
    this.dwellMax = options.dwellSeconds ?? 3.5;
    this.brakeDistance = options.brakeDistance ?? 24;

    // 进站状态：开局即停在主车站。
    this.u = this.stationU;
    this.dwell = this.dwellMax;
    this.state = 'dwelling';

    for (const car of cars) this.group.add(car);

    this.placeCars();
    this.previousHead.copy(this.headPositionValue);
  }

  /** 车头位置（世界坐标，只读；请勿修改）。 */
  get headPosition(): Vector3 {
    return this.headPositionValue;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isFollowing(): boolean {
    return this.following;
  }

  /** 当前速度（米/秒）。 */
  get currentSpeed(): number {
    return this.speed;
  }

  /** 各车厢世界坐标（车厢挂在无变换的 `group` 下，故 local 即 world）。 */
  carPositions(): Vector3[] {
    return this.cars.map((car) => car.position.clone());
  }

  get carCount(): number {
    return this.cars.length;
  }

  /** 是否正处于站点停靠状态。 */
  get isDwelling(): boolean {
    return this.state === 'dwelling';
  }

  start(): void {
    this.running = true;
    if (this.state === 'stopped') this.state = 'running';
    log.info('train started');
  }

  pause(): void {
    this.running = false;
    this.speed = 0;
    this.state = 'stopped';
    log.info('train paused');
  }

  /**
   * 让相机跟随列车。开启后按逐帧位移增量平移相机与 `target`，
   * 与 OrbitControls 的每帧 `update()` 兼容（不会互相打架）。
   */
  followCamera(camera: OrthographicCamera, on: boolean, target?: Vector3): void {
    this.following = on;
    this.followCameraRef = camera;
    this.followTargetRef = target ?? null;
    if (on) {
      // 重置基准，避免开启瞬间跳变。
      this.previousHead.copy(this.headPositionValue);
    }
  }

  update(delta: number): void {
    if (this.running) {
      this.advance(delta);
    }
    this.placeCars();
    this.applyFollow();
    this.previousHead.copy(this.headPositionValue);
  }

  dispose(): void {
    for (const car of this.cars) car.removeFromParent();
    this.cars.length = 0;
    this.group.removeFromParent();
  }

  // -------------------------------------------------------------------------

  private advance(delta: number): void {
    if (this.state === 'dwelling') {
      this.dwell -= delta;
      if (this.dwell <= 0) {
        this.state = 'running';
        this.dwell = 0;
      }
      this.speed = 0;
      return;
    }

    const ahead = this.distanceAhead(this.u, this.stationU);
    let target = this.cruiseSpeed;
    if (ahead < this.brakeDistance) {
      // 余量留 2% 的最小蠕行速度，保证一定能"越过"站点触发停靠。
      target = this.cruiseSpeed * clamp(ahead / this.brakeDistance, 0.02, 1);
    }
    this.speed += (target - this.speed) * clamp(delta * 1.8, 0, 1);

    const previousU = this.u;
    this.u = wrap01(this.u + (this.speed * delta) / this.length);

    if (crossed(previousU, this.u, this.stationU)) {
      this.state = 'dwelling';
      this.dwell = this.dwellMax;
      this.speed = 0;
      log.info('train arrived at STATION_MAIN');
    }
  }

  private placeCars(): void {
    for (let i = 0; i < this.cars.length; i += 1) {
      const car = this.cars[i];
      const distance = this.u * this.length - i * this.spacing;
      const ui = wrap01(distance / this.length);

      this.curve.getPointAt(ui, this.scratchPoint);
      this.curve.getTangentAt(ui, this.scratchTangent);

      // 正交基：局部 X = 前进方向，Y = 世界上方，Z = 横向（车厢宽度方向）。
      this.scratchX.copy(this.scratchTangent).normalize();
      this.scratchZ.crossVectors(this.scratchX, this.upVector).normalize();
      if (!Number.isFinite(this.scratchZ.x) || this.scratchZ.lengthSq() < 1e-9) {
        this.scratchZ.set(0, 0, 1);
      }
      this.scratchY.crossVectors(this.scratchZ, this.scratchX).normalize();
      this.scratchBasis.makeBasis(this.scratchX, this.scratchY, this.scratchZ);
      this.scratchQuaternion.setFromRotationMatrix(this.scratchBasis);

      const scaleY = car.scale.y || 1;
      car.position.set(
        this.scratchPoint.x,
        this.railTopY + WHEEL_CLEARANCE - this.wheelY * scaleY,
        this.scratchPoint.z,
      );
      car.quaternion.copy(this.scratchQuaternion);

      if (i === 0) this.headPositionValue.copy(car.position);
    }
  }

  private applyFollow(): void {
    if (!this.following || !this.followCameraRef || !this.followTargetRef) return;
    const deltaX = this.headPositionValue.x - this.previousHead.x;
    const deltaY = this.headPositionValue.y - this.previousHead.y;
    const deltaZ = this.headPositionValue.z - this.previousHead.z;
    this.followCameraRef.position.x += deltaX;
    this.followCameraRef.position.y += deltaY;
    this.followCameraRef.position.z += deltaZ;
    this.followTargetRef.x += deltaX;
    this.followTargetRef.y += deltaY;
    this.followTargetRef.z += deltaZ;
  }

  /** 从 `from` 到 `to` 沿前进方向的弧长距离（米，∈[0, length)）。 */
  private distanceAhead(from: number, to: number): number {
    const distance = (to - from) * this.length;
    const wrapped = distance - Math.floor(distance / this.length) * this.length;
    return wrapped;
  }
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

/** `stationU` 是否落在 (previousU, nextU] 区间内（按前进方向，处理环形跨越）。 */
function crossed(previousU: number, nextU: number, stationU: number): boolean {
  const start = previousU;
  let end = nextU;
  if (end < start) end += 1;
  let station = stationU;
  if (station < start) station += 1;
  return station > start && station <= end;
}
