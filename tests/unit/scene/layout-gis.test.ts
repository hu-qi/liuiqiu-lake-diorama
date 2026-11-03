/**
 * GIS 布局语义回归（方位不变量）。
 *
 * 与 `layout.test.ts` 的分工：
 *  - `layout.test.ts` 锁"坐标逐字快照"——保证数值没被随手改掉；
 *  - 本文件锁"方位语义"——保证即使坐标被整体换成另一套数值，8 组团相对
 *    练秋湖 GIS 导览图的**东南西北归属、绕湖相邻次序、轨道避让**依然成立。
 *
 * 为什么需要这一层：如果只做快照断言，把 A 组团从东北挪到西北、再把快照
 * 数值同步改一遍，测试会照样全绿——方位错的布局守不住。这里的断言全部基于
 * **相对关系**（象限 / 排序 / 夹角），不依赖具体坐标数值。
 *
 * ── 方位角约定（与 `src/scene/layout.ts` 文件头一致）────────────────────
 * Three.js Y-up：+X 东、-Z 北，`bearing = atan2(x, -z) * 180 / π`，归一化到
 * [0, 360)：0° = 正北，90° = 正东，180° = 正南，270° = 正西，顺时针增大。
 *
 * `assets-manifest.json` 的 authored 尺寸在测试里显式抄一份常量（与
 * `layout.test.ts` 第 75~83 行同源），避免快照与实现共用同一处读数来源。
 */
import { describe, expect, it } from 'vitest';
import {
  DISTRICT_ORDER,
  DISTRICTS,
  RAILWAY,
  type DistrictId,
} from '../../../src/scene/layout';

// ---------------------------------------------------------------------------
// 辅助：方位角
// ---------------------------------------------------------------------------

/**
 * 世界平面坐标 [x, z] → 方位角（角度制，[0, 360)，0° = 正北，顺时针为正）。
 *
 * 公式 `atan2(x, -z)`：把"北"映射到 +Y 轴前先把 -Z 转正，因此
 *   [0,-10] → atan2(0, 10) = 0°     正北
 *   [10,0]  → atan2(10, 0) = 90°    正东
 *   [0,10]  → atan2(0, -10) = 180°  正南
 *   [-10,0] → atan2(-10, 0) = -90° → 270° 正西
 */
function bearingOf([x, z]: readonly [number, number]): number {
  const deg = (Math.atan2(x, -z) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** 两个角度之间的有向最短差（-180, 180]，用于跨 0°/360° 的容差比较。 */
function angleDelta(a: number, b: number): number {
  const diff = ((a - b + 540) % 360) - 180;
  return diff;
}

function centreOf(id: DistrictId): readonly [number, number] {
  return DISTRICTS[id].placement.center;
}

// ---------------------------------------------------------------------------
// 参考值：GIS 导览图上的 8 组团方位角（取自 layout.ts 注释，带 ±10° 容差）
// ---------------------------------------------------------------------------

const REFERENCE_BEARINGS: Record<DistrictId, number> = {
  A: 61.4,
  B: 118.1,
  C: 24.4,
  D: 295.5, // = -64.5°（西北）
  E: 250.0, // = -110.0°（西南）
  F: 213.7, // = -146.3°（南偏西）
  G: 166.4,
  H: 340.0, // = -20.0°（北偏西）
};

/** 方位角允许的偏差（度）。允许微调坐标，但不足以跨到相邻象限。 */
const BEARING_TOLERANCE_DEG = 10;

/** 四象限（左闭右开，顺时针）：东北 [0,90) 东南 [90,180) 西南 [180,270) 西北 [270,360)。 */
const QUADRANTS: ReadonlyArray<{ name: string; from: number; to: number; ids: readonly DistrictId[] }> = [
  { name: '东北', from: 0, to: 90, ids: ['A', 'C'] },
  { name: '东南', from: 90, to: 180, ids: ['B', 'G'] },
  { name: '西南', from: 180, to: 270, ids: ['F', 'E'] },
  { name: '西北', from: 270, to: 360, ids: ['D', 'H'] },
];

// ---------------------------------------------------------------------------
// 用例 1：尺子本身是准的
// ---------------------------------------------------------------------------

describe('layout-gis — bearing formula', () => {
  it('maps the four cardinal directions to 0/90/180/270 degrees (clockwise, north = -Z)', () => {
    // 纯数学自测：历史上曾因公式写成 atan2(-x, -z) / atan2(x, z) 导致南北或东西颠倒，
    // 进而把全部方位断言一起带偏。这条保证后面所有断言的"尺子"是对的。
    expect(bearingOf([0, -10])).toBeCloseTo(0, 6); // 正北
    expect(bearingOf([10, 0])).toBeCloseTo(90, 6); // 正东
    expect(bearingOf([0, 10])).toBeCloseTo(180, 6); // 正南
    expect(bearingOf([-10, 0])).toBeCloseTo(270, 6); // 正西
  });

  it('returns values normalised into [0, 360) and clockwise between neighbours', () => {
    // 东北方向应落在 0°~90° 之间（顺时针增大），而不是负角度或 > 270°。
    const ne = bearingOf([10, -10]);
    expect(ne).toBeGreaterThan(0);
    expect(ne).toBeLessThan(90);
    // 正北偏西（x<0, z<0）应落在 270°~360°，而不是 0°~90°。
    const nw = bearingOf([-10, -10]);
    expect(nw).toBeGreaterThan(270);
    expect(nw).toBeLessThan(360);
    // 所有输出都必须在 [0, 360) 内。
    for (const point of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
    ] as const) {
      const b = bearingOf(point);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

// ---------------------------------------------------------------------------
// 用例 2：分象限归属
// ---------------------------------------------------------------------------

describe('layout-gis — quadrant ownership', () => {
  it('places every district in the quadrant shown on the GIS guide map', () => {
    const failures: string[] = [];
    for (const quadrant of QUADRANTS) {
      for (const id of quadrant.ids) {
        const bearing = bearingOf(centreOf(id));
        const inQuadrant = bearing >= quadrant.from && bearing < quadrant.to;
        if (!inQuadrant) {
          failures.push(
            `${id} 方位 ${bearing.toFixed(1)}° 不在${quadrant.name} [${quadrant.from}°, ${quadrant.to}°)`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('gives every district exactly one quadrant, and each quadrant its agreed pair', () => {
    const byQuadrant = new Map<string, DistrictId[]>(QUADRANTS.map((q) => [q.name, []]));
    for (const id of DISTRICT_ORDER) {
      const bearing = bearingOf(centreOf(id));
      const quadrant = QUADRANTS.find((q) => bearing >= q.from && bearing < q.to);
      expect(quadrant, `${id} 方位 ${bearing.toFixed(1)}° 落在未定义象限`).toBeTruthy();
      byQuadrant.get(quadrant!.name)!.push(id);
    }
    for (const quadrant of QUADRANTS) {
      expect(byQuadrant.get(quadrant.name)!.sort(), `${quadrant.name}象限组团`).toEqual(
        [...quadrant.ids].sort(),
      );
    }
    // 8 个组团各自只归属一个象限，没有遗漏也没有重复。
    expect([...byQuadrant.values()].flat()).toHaveLength(DISTRICT_ORDER.length);
  });

  it('keeps each district bearing within ±10° of the agreed reference (allows tweaks, forbids quadrant drift)', () => {
    const failures: string[] = [];
    for (const id of DISTRICT_ORDER) {
      const actual = bearingOf(centreOf(id));
      const delta = angleDelta(actual, REFERENCE_BEARINGS[id]);
      if (Math.abs(delta) > BEARING_TOLERANCE_DEG) {
        failures.push(
          `${id} 方位 ${actual.toFixed(1)}° 偏离参考 ${REFERENCE_BEARINGS[id].toFixed(1)}° 达 ${delta.toFixed(1)}°`,
        );
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 用例 3：绕湖方位序单调
// ---------------------------------------------------------------------------

describe('layout-gis — clockwise ring order around the lake', () => {
  it('sorts the eight districts by bearing into the agreed clockwise sequence', () => {
    // 锁"绕湖一圈的相邻关系"：只要有两个组团在环上交换位置，这条必红。
    // 快照式断言对这种"整体旋转 / 互换"无能为力，而这条能。
    const sorted = [...DISTRICT_ORDER].sort((a, b) => bearingOf(centreOf(a)) - bearingOf(centreOf(b)));
    expect(sorted).toEqual(['C', 'A', 'B', 'G', 'F', 'E', 'D', 'H']);
  });

  it('records the expected bearings strictly increasing along that sequence', () => {
    // 序列内部必须严格单调递增（相邻两个不能同方位角，否则排序不稳定、环序无意义）。
    const sequence: readonly DistrictId[] = ['C', 'A', 'B', 'G', 'F', 'E', 'D', 'H'];
    const bearings = sequence.map((id) => bearingOf(centreOf(id)));
    for (let i = 1; i < bearings.length; i += 1) {
      expect(
        bearings[i] - bearings[i - 1],
        `${sequence[i - 1]}(${bearings[i - 1].toFixed(1)}°) 应位于 ${sequence[i]}(${bearings[i].toFixed(1)}°) 之前`,
      ).toBeGreaterThan(0);
    }
    // 首尾跨越正北方向：H(340°) 到 C(24.4°) 是最短的那段弧，不能超过半圈。
    const wrap = bearings[0] + 360 - bearings[bearings.length - 1];
    expect(wrap).toBeGreaterThan(0);
    expect(wrap).toBeLessThan(90);
  });
});

// ---------------------------------------------------------------------------
// 用例 4：轨道不穿组团中心
// ---------------------------------------------------------------------------

/** assets-manifest.json 中的 authored 平面尺寸 [width(X), depth(Z)]（米）。 */
const AUTHORED_SIZE: Record<DistrictId, readonly [number, number]> = {
  A: [112.0, 92.205],
  B: [90.0, 60.0],
  C: [110.0, 65.62],
  D: [120.0, 94.0],
  E: [110.0, 80.861],
  F: [110.12, 81.7],
  G: [120.0, 90.0],
  H: [110.0, 64.3],
};

/** 组团在平面上的半宽（X）与半深（Z）：authored 尺寸 × placement.scale 的 sx/sz。 */
function halfExtentsOf(id: DistrictId): readonly [number, number] {
  const [w, d] = AUTHORED_SIZE[id];
  const scale = DISTRICTS[id].placement.scale;
  // 标量缩放时三轴相同；数组缩放时取各轴分量（终版为 [sx, sy, sz]）。
  const sx = typeof scale === 'number' ? scale : (scale?.[0] ?? 1);
  const sy = typeof scale === 'number' ? scale : (scale?.[1] ?? 1);
  const sz = typeof scale === 'number' ? scale : (scale?.[2] ?? 1);
  // 与 layout.test.ts 第 93 行一致：组团高度不压（sy = sx）。
  expect(sy, `${id} 高度不压：sy 应等于 sx`).toBeCloseTo(sx, 10);
  return [(w * sx) / 2, (d * sz) / 2];
}

describe('layout-gis — railway clears every district centre', () => {
  it('keeps each rail control point out of every district footprint (AABB)', () => {
    const failures: string[] = [];
    for (const [index, point] of RAILWAY.controlPoints.entries()) {
      const x = point[0];
      const z = point[2];
      for (const id of DISTRICT_ORDER) {
        const [cx, cz] = centreOf(id);
        const [halfX, halfZ] = halfExtentsOf(id);
        const dx = Math.abs(x - cx);
        const dz = Math.abs(z - cz);
        // 落在 AABB 内部 = 两个方向的偏移同时小于该方向半宽。
        if (dx < halfX && dz < halfZ) {
          failures.push(
            `轨道控制点 #${index} (${x}, ${z}) 落在 ${id} 包围盒内 (|dx|=${dx.toFixed(2)}<${halfX.toFixed(2)}, |dz|=${dz.toFixed(2)}<${halfZ.toFixed(2)})`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps every control point outside the mapped plinth area of each district as well', () => {
    // 半宽/半深必须为正，否则上一条断言会因退化的包围盒而"假通过"。
    for (const id of DISTRICT_ORDER) {
      const [halfX, halfZ] = halfExtentsOf(id);
      expect(halfX, `${id} 半宽`).toBeGreaterThan(0);
      expect(halfZ, `${id} 半深`).toBeGreaterThan(0);
    }
    expect(RAILWAY.controlPoints.length).toBeGreaterThanOrEqual(12);
  });
});