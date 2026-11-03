/**
 * 轨道：由 `RAILWAY.controlPoints`（单一数据源）派生的
 * 道砟条带 + 钢轨（左右各两条沿曲线扫掠）+ 枕木（InstancedMesh）。
 *
 * 只用 3 个 draw call（道砟 / 钢轨 / 枕木）即可得到完整线路，
 * 且钢轨与枕木共用同一条曲线，从根本上杜绝"列车与轨道脱节"。
 */

import {
  BoxGeometry,
  CatmullRomCurve3,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { createLogger } from '../utils/logger';
import { clamp } from '../utils/math';
import { RAILWAY, STATION } from '../scene/layout';
import { createCurveRibbon, mergeRibbons } from '../scene/ribbon';

const log = createLogger('railway:track');

/** 轨道构建结果（对外契约）。 */
export interface TrackBundle {
  readonly curve: CatmullRomCurve3;
  readonly group: Group;
  /** 闭合曲线弧长（米）。 */
  readonly length: number;
  /** 主车站最近点对应的弧长参数 [0,1)。 */
  readonly stationU: number;
  /** 钢轨顶面高度（列车车轮落点）。 */
  readonly railTopY: number;
  readonly gauge: number;
  dispose(): void;
}

export function createTrack(
  controlPoints: ReadonlyArray<readonly [number, number, number]> = RAILWAY.controlPoints,
): TrackBundle {
  const points = controlPoints.map(([x, y, z]) => new Vector3(x, y, z));
  const curve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  // 提高弧长采样精度：列车按 getPointAt/getTangentAt 采样时更平滑。
  curve.arcLengthDivisions = 1800;
  const length = curve.getLength();
  const samples = clamp(Math.round(length / 1.1), 240, 900);

  const group = new Group();
  group.name = 'RAILWAY';

  const ballastMaterial = new MeshStandardMaterial({
    name: 'RAIL_BALLAST_MAT',
    color: 0x8b8474,
    roughness: 0.96,
    metalness: 0.02,
  });
  const railMaterial = new MeshStandardMaterial({
    name: 'RAIL_STEEL_MAT',
    color: 0x9ba1a6,
    roughness: 0.32,
    metalness: 0.68,
  });
  const sleeperMaterial = new MeshStandardMaterial({
    name: 'RAIL_SLEEPER_MAT',
    color: 0x6d5a44,
    roughness: 0.88,
    metalness: 0.03,
  });

  const railTopY = RAILWAY.railTopY;
  const halfGauge = RAILWAY.gauge / 2;

  // 道砟（宽 3.6 m）——单个条带。
  const ballastGeometry = createCurveRibbon(curve, 0, 3.6, railTopY - 0.3, samples);
  const ballast = new Mesh(ballastGeometry, ballastMaterial);
  ballast.name = 'RAIL_BALLAST';
  ballast.receiveShadow = true;
  group.add(ballast);

  // 钢轨：左右各"轨头 + 轨底"两条条带，合并为单个几何体（1 draw call）。
  const railPieces = [
    createCurveRibbon(curve, halfGauge, 0.16, railTopY, samples),
    createCurveRibbon(curve, -halfGauge, 0.16, railTopY, samples),
    createCurveRibbon(curve, halfGauge, 0.3, railTopY - 0.14, samples),
    createCurveRibbon(curve, -halfGauge, 0.3, railTopY - 0.14, samples),
  ];
  const railGeometry = mergeRibbons(railPieces);
  for (const piece of railPieces) piece.dispose();
  const rails = new Mesh(railGeometry, railMaterial);
  rails.name = 'RAIL_STEEL';
  rails.castShadow = true;
  rails.receiveShadow = true;
  group.add(rails);

  // 枕木：InstancedMesh（1 draw call）。
  const sleeperCount = Math.max(8, Math.floor(length / RAILWAY.sleeperSpacing));
  const sleeperGeometry = new BoxGeometry(2.8, 0.14, 0.4);
  const sleepers = new InstancedMesh(sleeperGeometry, sleeperMaterial, sleeperCount);
  sleepers.name = 'RAIL_SLEEPERS';
  sleepers.castShadow = true;
  sleepers.receiveShadow = true;

  placeSleepers(sleepers, curve, sleeperCount, railTopY - 0.23);
  group.add(sleepers);

  const stationU = findNearestU(curve, STATION.placement.center, 2400);

  log.info(
    `track built: length ${length.toFixed(1)} m, ${samples} samples, ${sleeperCount} sleepers, stationU ${stationU.toFixed(4)}`,
  );

  const dispose = (): void => {
    ballastGeometry.dispose();
    railGeometry.dispose();
    sleeperGeometry.dispose();
    ballastMaterial.dispose();
    railMaterial.dispose();
    sleeperMaterial.dispose();
  };

  return { curve, group, length, stationU, railTopY, gauge: RAILWAY.gauge, dispose };
}

const _matrix = new Matrix4();
const _basis = new Matrix4();
const _quaternion = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _lateral = new Vector3();
const _point = new Vector3();
const _tangent = new Vector3();

/** 沿曲线等距放置枕木，枕木长轴指向曲线法向（垂直于前进方向）。 */
function placeSleepers(
  sleepers: InstancedMesh,
  curve: CatmullRomCurve3,
  count: number,
  y: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const u = (i + 0.5) / count;
    curve.getPointAt(u, _point);
    curve.getTangentAt(u, _tangent);
    _lateral.crossVectors(_up, _tangent).normalize();
    if (!Number.isFinite(_lateral.x) || _lateral.lengthSq() < 1e-9) _lateral.set(1, 0, 0);

    // 局部 X = 横向，Y = 上，Z = 切向。
    _basis.makeBasis(_lateral.clone(), _up, _tangent.clone());
    _quaternion.setFromRotationMatrix(_basis);
    _matrix.compose(new Vector3(_point.x, y, _point.z), _quaternion, new Vector3(1, 1, 1));
    sleepers.setMatrixAt(i, _matrix);
  }
  sleepers.instanceMatrix.needsUpdate = true;
}

/** 找到曲线上距离目标点（XZ）最近的弧长参数 u ∈ [0,1)。 */
export function findNearestU(curve: CatmullRomCurve3, target: readonly [number, number], samples: number): number {
  let bestU = 0;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  const point = new Vector3();
  for (let i = 0; i < samples; i += 1) {
    const u = i / samples;
    curve.getPointAt(u, point);
    const dx = point.x - target[0];
    const dz = point.z - target[1];
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestU = u;
    }
  }
  return bestU;
}