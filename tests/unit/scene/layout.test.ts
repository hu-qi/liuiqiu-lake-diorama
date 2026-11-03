import { describe, expect, it } from 'vitest';
import {
  BRIDGES,
  DISTRICT_ORDER,
  DISTRICT_SCALE,
  DISTRICTS,
  ENVIRONMENT_PLACEMENTS,
  LANDMARKS,
  PLINTH,
  RAILWAY,
  ROADS,
  STATION,
  THEME_REGIONS,
  WATER_BODIES,
  resolvePlacement,
  type DistrictId,
} from '../../../src/scene/layout';
import type { AssetManifestEntry } from '../../../src/loaders/types';

/** 造一个最小 manifest 条目（带包围盒，用于 y 贴地推导）。 */
function entry(assetId: string, minY = 0): AssetManifestEntry {
  return {
    assetId,
    boundingBox: { min: [-10, minY, -10], max: [10, 8, 10] },
  };
}

describe('layout — plinth contract', () => {
  it('matches the 260 × 170 × 10 pedestal contract', () => {
    expect(PLINTH.width).toBe(260);
    expect(PLINTH.depth).toBe(170);
    expect(PLINTH.thickness).toBe(10);
  });
});

describe('layout — districts (architecture §4.3)', () => {
  it('exposes all eight districts with canonical runtime names', () => {
    expect(DISTRICT_ORDER).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    const expected: Record<DistrictId, string> = {
      A: 'DISTRICT_A_HILLTOP',
      B: 'DISTRICT_B_WATERTOWN',
      C: 'DISTRICT_C_URBAN_AXIS',
      D: 'DISTRICT_D_COLLEGE',
      E: 'DISTRICT_E_FOREST_TOWN',
      F: 'DISTRICT_F_PLAZA_TOWN',
      G: 'DISTRICT_G_URBAN_BLOCKS',
      H: 'DISTRICT_H_URBAN_AXIS',
    };
    for (const id of DISTRICT_ORDER) {
      expect(DISTRICTS[id].objectName).toBe(expected[id]);
    }
  });

  it('uses the agreed district centres from the layout table', () => {
    // GIS 终版坐标：A/B 在东侧，C/H 在北侧，D/E 在西侧，F/G 在南侧。
    // 方位角 = atan2(x, -z)：A 61.4° / B 118.1° / C 24.4° / H -20.0°
    // / D -64.5° / E -110.0° / F -146.3° / G 166.4°。
    const centres: Record<DistrictId, [number, number]> = {
      A: [88, -48],
      B: [86, 46],
      C: [30, -66],
      D: [-84, -40],
      E: [-88, 32],
      F: [-44, 66],
      G: [16, 66],
      H: [-24, -66],
    };
    for (const id of DISTRICT_ORDER) {
      expect(DISTRICTS[id].placement.center).toEqual(centres[id]);
    }
  });

  it('keeps every district footprint inside the pedestal', () => {
    // Authored sizes from assets-manifest.json.
    const authored: Record<DistrictId, [number, number]> = {
      A: [112, 92.2],
      B: [90, 60],
      C: [110, 65.6],
      D: [120, 94],
      E: [110, 80.9],
      F: [110.1, 81.7],
      G: [120, 90],
      H: [110, 64.3],
    };
    for (const id of DISTRICT_ORDER) {
      const [w, d] = authored[id];
      // 终版为**非等比**三轴缩放 [sx, sy, sz]：平面 X/Z 分别用各自分量算半宽/半深。
      const scale = DISTRICTS[id].placement.scale;
      expect(Array.isArray(scale), `${id} placement.scale 应为三轴数组`).toBe(true);
      const [sx, sy, sz] = scale as readonly [number, number, number];
      expect(sy).toBeCloseTo(sx, 10); // 高度不压：sy = sx
      const [x, z] = DISTRICTS[id].placement.center;
      expect(Math.abs(x) + (w * sx) / 2).toBeLessThanOrEqual(PLINTH.width / 2 + 0.001);
      expect(Math.abs(z) + (d * sz) / 2).toBeLessThanOrEqual(PLINTH.depth / 2 + 0.001);
      // 相对体量基准值 0.29~0.35，乘 0.82 压扁后落到 0.24~0.29。
      expect(DISTRICT_SCALE[id]).toBeGreaterThanOrEqual(0.25);
      expect(DISTRICT_SCALE[id]).toBeLessThanOrEqual(0.65);
    }
  });

  it('never overlaps two district footprints', () => {
    // 终版硬约束：八团 AABB 两两不重叠（原先的重叠是"必须缩到 0.29~0.35"的根因）。
    const authored: Record<DistrictId, [number, number]> = {
      A: [112, 92.2],
      B: [90, 60],
      C: [110, 65.6],
      D: [120, 94],
      E: [110, 80.9],
      F: [110.1, 81.7],
      G: [120, 90],
      H: [110, 64.3],
    };
    const boxes = DISTRICT_ORDER.map((id) => {
      const [w, d] = authored[id];
      const scale = DISTRICTS[id].placement.scale as readonly [number, number, number];
      const [x, z] = DISTRICTS[id].placement.center;
      return {
        id,
        x0: x - (w * scale[0]) / 2,
        x1: x + (w * scale[0]) / 2,
        z0: z - (d * scale[2]) / 2,
        z1: z + (d * scale[2]) / 2,
      };
    });
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const overlapZ = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
        expect(overlapX <= 0 || overlapZ <= 0, `${a.id} 与 ${b.id} 重叠`).toBe(true);
      }
    }
  });
});

describe('layout — landmarks, station and rail (architecture §4.4 / §4.5)', () => {
  it('places the three bridges and the capsule centre at the agreed points', () => {
    // 终版方位：月亮桥跨西侧水道、彩虹桥跨西北水道、拱桥在东北引水河道。
    expect(BRIDGES.MOON.placement.center).toEqual([-42.3, 40.9]);
    expect(BRIDGES.RAINBOW.placement.center).toEqual([-53.0, -38.5]);
    expect(BRIDGES.ARCH.placement.center).toEqual([54.7, -31.6]);
    expect(LANDMARKS.CAPSULE_CENTER.placement.center).toEqual([37.8, 26.5]);
    expect(STATION.placement.center).toEqual([-10.3, -38.4]);
  });

  it('defines a closed, flat rail loop with at least 12 control points', () => {
    expect(RAILWAY.controlPoints.length).toBeGreaterThanOrEqual(12);
    for (const [, y] of RAILWAY.controlPoints) expect(y).toBe(0);
    // Every control point stays outside the water of the lake (radius > ~30).
    for (const [x, , z] of RAILWAY.controlPoints) {
      expect(Math.hypot(x, z)).toBeGreaterThan(30);
    }
    // The loop threads past STATION_MAIN (per §4.5, the station sits beside it).
    const [sx, sz] = STATION.placement.center;
    const nearest = Math.min(
      ...RAILWAY.controlPoints.map(([x, , z]) => Math.hypot(x - sx, z - sz)),
    );
    expect(nearest).toBeLessThan(12);
    expect(RAILWAY.gauge).toBeGreaterThan(1);
    expect(RAILWAY.railTopY).toBeGreaterThan(0.2);
  });

  it('models the three water channels and the ring road + 8 spurs', () => {
    expect(WATER_BODIES.length).toBe(3);
    for (const channel of WATER_BODIES) expect(channel.outline.length).toBeGreaterThanOrEqual(3);
    const ring = ROADS.find((road) => road.closed);
    expect(ring, 'a closed ring road must exist').toBeTruthy();
    expect(ROADS.length).toBe(10); // ring + 8 radial spurs + outer loop
  });

  it('ends every radial spur exactly at its district centre', () => {
    for (const id of DISTRICT_ORDER) {
      const spur = ROADS.find((road) => road.name === `ROAD_SPUR_${id}`);
      expect(spur, `缺少 ROAD_SPUR_${id}`).toBeTruthy();
      const end = spur!.points[spur!.points.length - 1];
      expect(end[0]).toBeCloseTo(DISTRICTS[id].placement.center[0], 6);
      expect(end[1]).toBeCloseTo(DISTRICTS[id].placement.center[1], 6);
    }
  });
});

describe('layout — seven theme regions', () => {
  it('collapses C/H into one axis region and covers all eight districts', () => {
    expect(THEME_REGIONS.length).toBe(7);
    const covered = new Set(THEME_REGIONS.flatMap((region) => region.districtIds));
    expect([...covered].sort()).toEqual([...DISTRICT_ORDER].sort());
  });
});

describe('layout.resolvePlacement (loader contract)', () => {
  it('grounds each district so min.y rests on the pedestal top', () => {
    for (const id of DISTRICT_ORDER) {
      const assetId = DISTRICTS[id].objectName;
      const result = resolvePlacement(entry(assetId, -0.5));
      expect(result, `${assetId} must resolve`).toBeTruthy();
      // 组团为非等比三轴缩放：X = 基准 × 0.82，Z 再 × 0.85，Y 与 X 相同（高度不压）。
      const base = DISTRICT_SCALE[id];
      const sx = base * 0.82;
      expect(result!.scale).toEqual([sx, sx, sx * 0.85]);
      expect(result!.position![0]).toBe(DISTRICTS[id].placement.center[0]);
      expect(result!.position![2]).toBe(DISTRICTS[id].placement.center[1]);
      // y = -min.y × scaleY：非等比必须用 Y 分量，用 X 会让模型陷地/悬浮。
      expect(result!.position![1]).toBeCloseTo(0.5 * sx, 6);
      expect(result!.rotation![1]).toBeCloseTo(DISTRICTS[id].placement.rotationY, 6);
    }
  });

  it('resolves bridges, landmark, station, environment and the train', () => {
    for (const bridge of Object.values(BRIDGES)) {
      expect(resolvePlacement(entry(bridge.objectName))).toBeTruthy();
    }
    expect(resolvePlacement(entry(LANDMARKS.CAPSULE_CENTER.objectName))).toBeTruthy();
    expect(resolvePlacement(entry(STATION.objectName))).toBeTruthy();
    expect(resolvePlacement(entry('ENV_LANDSCAPE_ASSETS'))).toBeTruthy();
    expect(resolvePlacement(entry('TRAIN_HEAD'))).toBeTruthy();
    expect(resolvePlacement(entry('TRAIN_CAR_01'))).toBeTruthy();
  });

  it('keeps the landscape prop on dry land outside the lake shoreline', () => {
    // 回归防护：旧坐标 [-32, -30] 半径仅 43.9 m，会浮在湖面上。
    // 湖岸名义半径 48.8 m（baseRadius 40 × 1.22 不规则度上界），道具必须在其外侧。
    const LAKE_MAX_RADIUS = 40 * 1.22;
    const [x, z] = ENVIRONMENT_PLACEMENTS.ENV_LANDSCAPE_ASSETS.center;
    // 道具自身半尺寸（17.07 × 13.3，scale 0.55）的内切距离也要落在湖外。
    const halfDiagonal = Math.hypot((17.07 * 0.55) / 2, (13.3 * 0.55) / 2);
    expect(Math.hypot(x, z) - halfDiagonal).toBeGreaterThan(LAKE_MAX_RADIUS);
  });

  it('keeps the tree-cluster original below the pedestal (its instances replace it)', () => {
    const placement = resolvePlacement(entry('ENV_TREE_CLUSTER'));
    expect(placement).toBeTruthy();
    expect(placement!.position![1]).toBeLessThan(0);
    expect(ENVIRONMENT_PLACEMENTS.ENV_TREE_CLUSTER.center).toEqual([-96, -70]);
  });

  it('returns null for an unknown asset id', () => {
    expect(resolvePlacement(entry('SOMETHING_ELSE'))).toBeNull();
  });
});