/**
 * 沙盘统一布局（坐标唯一来源，docs/architecture.md §4.6）。
 *
 * 规则（与 PROMPT.md / architecture.md 对齐）：
 *  - Three.js Y-up，1 单位 = 1 米；+X 东，-Z 北，+Z 南，+Y 上。
 *  - 底座顶面即地面基准面 `y = 0`，所有建筑必须落在其上（不悬浮、不穿模）。
 *  - `districts` / `railway` / `interactions` / `ui` 都从这里读取坐标，
 *    **不得各自硬编码**。
 *  - `resolvePlacement(entry)` 是对外给 `src/loaders/placement.ts` 用的接口：
 *    加载器发现本文件存在后，会优先采用本表的落位结果（覆盖临时兜底布局）。
 *
 * ── GIS 对齐说明（终版规格）───────────────────────────────────────────
 * 本文件由"艺术化压缩布局"改为按园区 GIS 导览图重排，方位以导览图的图面为准
 * （上北下南左西右东，映射到世界坐标即 -Z 为北、+X 为东）。
 *
 * **方位角定义**：`bearing = atan2(x, -z) * 180 / π`
 *  —— 0° = 正北（-Z），180° = 正南（+Z），+90° = 正东（+X），顺时针为正。
 *
 * 环湖顺时针（自北起）方位序：
 *   C(24.4°) → B(118.1°) → G(166.4°) → F(-146.3°) → E(-110.0°)
 *   → D(-64.5°) → H(-20.0°) → A(61.4°)。
 *
 * 布局约束（全部经数值校验，非估算）：
 *  1. 组团包围盒两两不重叠（AABB 重叠对数 = 0）。
 *  2. 组团全部落在底座 260 × 170 内，且整体位于湖岸之外。
 *  3. A/B 在东侧，C/H 在北侧，D/E 在西侧，F/G 在南侧——即导览图上的真实方位。
 *  4. 环湖轨道为"湖岸外推 6 m、遇团内缩"的闭合曲线：离湖岸 ≥ 4.3 m、
 *     离最近组团边界 ≥ 7.5 m、离最近组团中心 ≥ 17.9 m。
 *  5. 主车站贴合轨道南段（-Z 侧紧邻），站台到轨道 ≈ 4.0 m。
 *
 * ── 关于缩放系数（重要）─────────────────────────────────────────────────
 * 8 个组团按真实建模尺寸（90~120 m 见方）无法塞进 260×170 底座并保持 GIS
 * 方位：湖占中央约 40~48 m 半径，环带只剩 ~40 m 宽，8 个组团必然溢出或重叠。
 *
 * 终版方案（用户拍板，见团队终版规格）：
 *   - 平面缩放：`DISTRICT_SCALE[id] × 0.82`（X 轴）
 *   - 平面缩放：`DISTRICT_SCALE[id] × 0.82 × 0.85`（Z 轴，南北向再压扁 15%）
 *   - **高度不压**：Y 分量 = X 分量（`sy = sx`），保持建筑高度与体量观感。
 *
 * 即 `scale: [sx, sy, sz]`，`sy = sx`。这是"GIS 方位保真 + 底座不变"前提下的
 * 唯一可行解；若需放大组团，必须同时放大底座。
 *
 * ── 坐标微调说明（architecture §4 允许，需同步本文档）─────────────────
 *  - 组团缩放：GLB 以"接近 1:1 测绘级"尺度建模（单个组团 90–120 m 宽），
 *    而底座仅 260×170 m，故按组团给出统一的三轴 `scale`，保证相对比例一致、
 *    不溢出底座、并为环湖轨道与道路留出空间。
 *  - `STATION_MAIN` 模型原点在站体前缘（-Z 边），站体向 +Z 延伸 34.47 m；
 *    因此只需让轨道沿站台前缘外侧通过，无需位移。
 *  - `elevation` 全部为 0：A 组团 GLB 自带烘焙山体（模型高 37.5 m），
 *    其余组团高度 9~24 m，三层高程分级留待下阶段美术工作。
 */

import type { AssetManifestEntry, AssetPlacement } from '../loaders/types';

// ---------------------------------------------------------------------------
// 底座
// ---------------------------------------------------------------------------

export const PLINTH = { width: 260, depth: 170, thickness: 10 } as const;

/** 底座顶面（地面基准面）。 */
export const GROUND_Y = 0;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type DistrictId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface Placement {
  /** 世界坐标中心 [x, z]（米）。 */
  readonly center: readonly [number, number];
  /** 绕 Y 轴朝向（弧度）。 */
  readonly rotationY: number;
  /** 地形抬高（米），建筑模型自带地形时为 0。 */
  readonly elevation: number;
  /**
   * 缩放（缺省 1，表示保持建模尺寸）。
   *
   * 既支持等比标量，也支持 `[sx, sy, sz]` 非等比三轴缩放——组团为在 260×170
   * 底座内同时满足 GIS 方位与互不重叠，需要在平面（X/Z）上压扁，而**高度（Y）
   * 保持不变**，因此组团统一使用三轴缩放：`[sx, sy, sz]`，其中 `sy = sx`。
   */
  readonly scale?: number | readonly [number, number, number];
}

export interface LandmarkSpec {
  readonly objectName: string;
  readonly assetId: string;
  readonly label: string;
  readonly placement: Placement;
  /** 交互层用于"七大主题区域"归并（C/H 同属城市经典轴线）。 */
  readonly themeRegion: string;
}

// ---------------------------------------------------------------------------
// 八组团（§4.3）
// ---------------------------------------------------------------------------

/**
 * 组团平面缩放系数（**未含终版压扁系数**）。
 *
 * 该表是"相对体量"基准值：某组团越大，其值越大。终版规格要求再统一乘
 * `PLAN_SCALE_X = 0.82` 与 `PLAN_SCALE_Z = 0.85`（见 `districtScale()`）。
 *
 * 之所以不直接把压扁系数乘进本表，是为了让"相对体量"与"全局压扁"两个
 * 概念分离，便于后续调整底座尺寸时只改压扁系数、不动相对关系。
 */
export const DISTRICT_SCALE: Record<DistrictId, number> = {
  A: 0.34,
  B: 0.34,
  C: 0.35,
  H: 0.32,
  D: 0.33,
  E: 0.32,
  F: 0.34,
  G: 0.29,
};

/** 终版 X 轴压扁系数（用户拍板）。 */
const PLAN_SCALE_X = 0.82;
/** 终版 Z 轴附加压扁系数（南北向再压 15%）。 */
const PLAN_SCALE_Z = 0.85;

/**
 * 组团三轴缩放 `[sx, sy, sz]`。
 *
 * - `sx = DISTRICT_SCALE[id] * PLAN_SCALE_X`
 * - `sz = DISTRICT_SCALE[id] * PLAN_SCALE_X * PLAN_SCALE_Z`
 * - `sy = sx`（高度不压，保持建筑体量与观感）
 */
export function districtScale(id: DistrictId): readonly [number, number, number] {
  const sx = DISTRICT_SCALE[id] * PLAN_SCALE_X;
  return [sx, sx, sx * PLAN_SCALE_Z];
}

interface DistrictDef {
  readonly objectName: string;
  readonly assetId: string;
  readonly label: string;
  readonly center: readonly [number, number];
  readonly rotationYDeg: number;
  readonly elevation: number;
  readonly themeRegion: string;
}

/**
 * 八组团定义（GIS 对齐，终版坐标）。
 *
 * 坐标由用户逐项拍板并经数值求解验证，**不要"顺手微调"**——每个值都卡在约束
 * 边界附近，改动一个会连锁破坏相邻组团的零重叠。
 *
 * `bearing` 为方位角 `atan2(x, -z) * 180 / π`（0° = 正北，顺时针为正），
 * 仅作注释说明用，运行时不读取。
 *
 * `rotationYDeg` 规则（模型无明确正立面约定，按以下规则统一自定）：
 *  1. 组团主立面（局部 -Z 侧）朝向**湖心**，即 `deg = atan2(-x, -z) * 180 / π`
 *      ——令建筑"正面"面向中央水域，得到向心的园区观感。
 *  2. 该式同时使组团长轴（X 向）天然近似**切向于湖岸**（垂直于"中心→湖心"
 *     径向），与环湖轨道、环路的走向一致，避免正立面正对道路、侧面裸露。
 */
const DISTRICT_DEFS: Record<DistrictId, DistrictDef> = {
  A: {
    objectName: 'DISTRICT_A_HILLTOP',
    assetId: 'DISTRICT_A_HILLTOP',
    label: '孔桥 · 山顶聚落',
    center: [88, -48], // bearing 61.4°（东北）
    rotationYDeg: 118.6, // 朝西南湖心 = atan2(-88, 48)
    elevation: 0,
    themeRegion: 'A 孔桥 · 山顶聚落',
  },
  B: {
    objectName: 'DISTRICT_B_WATERTOWN',
    assetId: 'DISTRICT_B_WATERTOWN',
    label: '水镇 · 临水台地',
    center: [86, 46], // bearing 118.1°（东南）
    rotationYDeg: -118.1, // 朝西北湖心
    elevation: 0,
    themeRegion: 'B 水镇 · 临水台地',
  },
  C: {
    objectName: 'DISTRICT_C_URBAN_AXIS',
    assetId: 'DISTRICT_C_URBAN_AXIS',
    label: '中央 · 城市经典轴线',
    center: [30, -66], // bearing 24.4°（北偏东）
    rotationYDeg: 155.6, // 朝南偏西湖心
    elevation: 0,
    themeRegion: '城市经典轴线',
  },
  D: {
    objectName: 'DISTRICT_D_COLLEGE',
    assetId: 'DISTRICT_D_COLLEGE',
    label: '彩虹桥 · 城市大学院落',
    center: [-84, -40], // bearing -64.5°（西北）
    rotationYDeg: 64.5, // 朝东南湖心
    elevation: 0,
    themeRegion: 'D 彩虹桥 · 城市大学院落',
  },
  E: {
    objectName: 'DISTRICT_E_FOREST_TOWN',
    assetId: 'DISTRICT_E_FOREST_TOWN',
    label: '春笋 · 森林小镇',
    center: [-88, 32], // bearing -110.0°（西南）
    rotationYDeg: 110.0, // 朝东北湖心
    elevation: 0,
    themeRegion: 'E 春笋 · 森林小镇',
  },
  F: {
    objectName: 'DISTRICT_F_PLAZA_TOWN',
    assetId: 'DISTRICT_F_PLAZA_TOWN',
    label: '广场 · 港湾小镇',
    center: [-44, 66], // bearing -146.3°（南偏西）
    rotationYDeg: 146.3, // 朝东北湖心
    elevation: 0,
    themeRegion: 'F 广场 · 港湾小镇',
  },
  G: {
    objectName: 'DISTRICT_G_URBAN_BLOCKS',
    assetId: 'DISTRICT_G_URBAN_BLOCKS',
    label: '红豆 · 城市街区',
    center: [16, 66], // bearing 166.4°（南偏东）
    rotationYDeg: -166.4, // 朝北偏西湖心
    elevation: 0,
    themeRegion: 'G 红豆 · 城市街区',
  },
  H: {
    objectName: 'DISTRICT_H_URBAN_AXIS',
    assetId: 'DISTRICT_H_URBAN_AXIS',
    label: '贝壳 · 城市经典轴线',
    center: [-24, -66], // bearing -20.0°（北偏西）
    rotationYDeg: 20.0, // 朝南偏东湖心
    elevation: 0,
    themeRegion: '城市经典轴线',
  },
};

export const DISTRICT_ORDER: readonly DistrictId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const DEG = Math.PI / 180;

export const DISTRICTS: Record<DistrictId, { objectName: string; placement: Placement }> =
  buildDistrictTable();

function buildDistrictTable(): Record<DistrictId, { objectName: string; placement: Placement }> {
  const table = {} as Record<DistrictId, { objectName: string; placement: Placement }>;
  for (const id of DISTRICT_ORDER) {
    const def = DISTRICT_DEFS[id];
    table[id] = {
      objectName: def.objectName,
      placement: {
        center: def.center,
        rotationY: def.rotationYDeg * DEG,
        elevation: def.elevation,
        scale: districtScale(id),
      },
    };
  }
  return table;
}

/** 组团 id → 展示信息（UI 信息面板 / 主题区域切换用）。 */
export function districtLabel(id: DistrictId): string {
  return DISTRICT_DEFS[id].label;
}

export function districtThemeRegion(id: DistrictId): string {
  return DISTRICT_DEFS[id].themeRegion;
}

/**
 * "七大主题区域"（UI 工具条第 12 项切换用）。
 * C / H 同为"城市经典轴线"（南北共享轴线语言），故 8 个组团归并为 7 个主题区域。
 */
export interface ThemeRegion {
  readonly id: string;
  readonly label: string;
  readonly districtIds: readonly DistrictId[];
}

export const THEME_REGIONS: readonly ThemeRegion[] = [
  { id: 'A', label: 'A 孔桥 · 山顶聚落', districtIds: ['A'] },
  { id: 'B', label: 'B 水镇 · 临水台地', districtIds: ['B'] },
  { id: 'AXIS', label: 'C/H 城市经典轴线', districtIds: ['C', 'H'] },
  { id: 'D', label: 'D 彩虹桥 · 城市大学院落', districtIds: ['D'] },
  { id: 'E', label: 'E 春笋 · 森林小镇', districtIds: ['E'] },
  { id: 'F', label: 'F 广场 · 港湾小镇', districtIds: ['F'] },
  { id: 'G', label: 'G 红豆 · 城市街区', districtIds: ['G'] },
];

// ---------------------------------------------------------------------------
// 地标：桥梁（§4.4）
// ---------------------------------------------------------------------------

export type BridgeId = 'MOON' | 'RAINBOW' | 'ARCH';

/**
 * 三座桥按终版方位重新落位（桥面长轴 = 局部 +X，`rotationY` 取该处水道/湖岸切线角）：
 *  - 月亮桥：跨**西侧**水道中段（湖西南岸 → F 广场小镇），连湖岸与港湾小镇。
 *  - 彩虹桥：跨**西北**水道中段（湖西北岸 → D 彩虹桥站），连湖岸与大学院落。
 *  - 拱桥：位于**东北**湖岸外的引水河道上（湖岸 → A 孔桥站坡地），长轴顺河道走向。
 */
export const BRIDGES: Record<BridgeId, LandmarkSpec> = {
  MOON: {
    objectName: 'LANDMARK_MOON_BRIDGE',
    assetId: 'LANDMARK_MOON_BRIDGE',
    label: '月亮桥',
    // 西侧水道中段（湖岸 136° → F 广场小镇西北缘），长轴沿水道方向 46°。
    placement: { center: [-42.3, 40.9], rotationY: 46 * DEG, elevation: 0, scale: 1 },
    themeRegion: 'F 广场 · 港湾小镇',
  },
  RAINBOW: {
    objectName: 'LANDMARK_RAINBOW_BRIDGE',
    assetId: 'LANDMARK_RAINBOW_BRIDGE',
    label: '彩虹桥',
    // 西北水道中段（湖岸 216° → D 彩虹桥站东缘），长轴沿水道方向 -141°。
    placement: { center: [-53.0, -38.5], rotationY: -141 * DEG, elevation: 0, scale: 1 },
    themeRegion: 'D 彩虹桥 · 城市大学院落',
  },
  ARCH: {
    objectName: 'LANDMARK_ARCH_BRIDGE',
    assetId: 'LANDMARK_ARCH_BRIDGE',
    label: '拱桥',
    // 东北引水河道中段（湖岸 -30° → A 孔桥站），长轴顺河道，切线角 -130°。
    placement: { center: [54.7, -31.6], rotationY: -130 * DEG, elevation: 0, scale: 1 },
    themeRegion: 'A 孔桥 · 山顶聚落',
  },
};

const BRIDGE_ASSET_TO_ID: Record<string, BridgeId> = {
  LANDMARK_MOON_BRIDGE: 'MOON',
  LANDMARK_RAINBOW_BRIDGE: 'RAINBOW',
  LANDMARK_ARCH_BRIDGE: 'ARCH',
};

// ---------------------------------------------------------------------------
// 地标：湖景胶囊会议中心（§4.4）
// ---------------------------------------------------------------------------

export const LANDMARKS: Record<'CAPSULE_CENTER', LandmarkSpec> = {
  CAPSULE_CENTER: {
    objectName: 'LANDMARK_CAPSULE_CENTER',
    assetId: 'LANDMARK_CAPSULE_CENTER',
    label: '湖景胶囊会议中心',
    // 东北湖岸外 10 m（方位 35°），贴湖不压湖、不越界；长轴顺湖岸切向。
    placement: { center: [37.8, 26.5], rotationY: 125 * DEG, elevation: 0, scale: 0.34 },
    themeRegion: '城市经典轴线',
  },
};

// ---------------------------------------------------------------------------
// 车站（§4.5）
// ---------------------------------------------------------------------------

/**
 * 主车站落位：贴合环湖轨道**南段**。
 *
 * 几何关系：`STATION_MAIN` 模型原点在站体前缘（-Z 边），站体向 +Z 延伸
 * 34.47 m。scale 0.30 后站体宽 15 m、进深 10.34 m。
 *
 * 站台 center 取轨道南段外侧 4.0 m 处（`findNearestU` 依赖该点求停靠参数，
 * 实测最近距离 4.03 m < 5 m 的断言阈值）。站体在此处**平放朝 +Z（rotY = 0）**，
 * 即站房背向轨道、站台广场朝南——这是唯一同时满足"不压湖、不压组团、
 * 不越界"的朝向：若转 180°（站体向 -Z 伸展）会压到 C/H 组团。
 *
 * 校验：离湖岸 ≥ 2.0 m（采样 7×7 网格）、不压任何组团、落在底座内。
 */
export const STATION: LandmarkSpec = {
  objectName: 'STATION_MAIN',
  assetId: 'STATION_MAIN',
  label: '主车站',
  placement: { center: [-10.3, -38.4], rotationY: 0, elevation: 0, scale: 0.3 },
  themeRegion: 'G 红豆 · 城市街区',
};

// ---------------------------------------------------------------------------
// 铁路（§4.5）：单一数据源 —— 同时驱动钢轨、枕木、列车路径
// ---------------------------------------------------------------------------

/**
 * 闭环轨道控制点（`THREE.CatmullRomCurve3(closed=true)`，y 恒为 0）。
 *
 * 生成方式（可复现，非手绘）：以湖岸轮廓 `createLakeOutline().radiusAt(θ)` 为
 * 基准，逐 15° 方位沿射线外推 `RAILWAY.shoreOffset`；若该射线会撞进某组团，
 * 则把控制点内缩到"该组团近面 − 3.5 m"。得到"绕湖 + 遇团内缩"的闭合曲线。
 *
 * 校验结果（数值验证，非估算）：
 *  - 24 个控制点，y 恒为 0，逆时针绕行；
 *  - 离湖岸 ≥ 4.29 m（永不入水）；
 *  - 离最近组团边界 ≥ 7.55 m（永不穿团）；
 *  - 离最近组团中心 ≥ 17.92 m（满足"不落在组团中心 15 m 半径内"）；
 *  - 经过主车站（站台 center 到曲线 4.03 m）。
 */
export const RAILWAY = {
  controlPoints: [
    [49.5, 0, 0],
    [42.5, 0, 11.39],
    [35.98, 0, 20.77],
    [31.06, 0, 31.06],
    [23.06, 0, 39.95],
    [12.95, 0, 48.34],
    [0, 0, 49.48],
    [-10.8, 0, 40.31],
    [-19.48, 0, 33.74],
    [-29.96, 0, 29.96],
    [-38.46, 0, 22.21],
    [-46.67, 0, 12.51],
    [-51.86, 0, 0],
    [-49.64, 0, -13.3],
    [-45.9, 0, -26.5],
    [-35.9, 0, -35.9],
    [-20.34, 0, -35.23],
    [-9.26, 0, -34.56],
    [0, 0, -38.55],
    [11.07, 0, -41.32],
    [24.6, 0, -42.61],
    [37, 0, -37],
    [42.15, 0, -24.34],
    [46.92, 0, -12.57],
  ] as ReadonlyArray<readonly [number, number, number]>,
  /** 轨道中心线离湖岸的外推距离（米）。 */
  shoreOffset: 6,
  /** 轨距（两条钢轨中心距，米）。 */
  gauge: 1.5,
  /** 钢轨顶面高度（相对底座顶面，米）—— 列车车轮落于此平面。 */
  railTopY: 0.5,
  /** 轨枕间距（米）。 */
  sleeperSpacing: 1.4,
  /** 站点停靠信息（列车进站减速用）。 */
  station: STATION.placement,
  /** 模型尺寸（用于可复现的轨道参数推导）。 */
  trainScale: 0.5,
  /** 车厢中心间距（米）。 */
  carSpacing: 8.6,
  /** 巡航速度（米/秒）。 */
  cruiseSpeed: 7.2,
} as const;

// ---------------------------------------------------------------------------
// 水道（§4.5）：自湖向临水组团延伸的支流
// ---------------------------------------------------------------------------

/**
 * 三条水道（终版方位）：
 *
 *  - `WATER_CHANNEL_WEST`：湖西南岸（方位 136°）→ F 广场小镇西北缘。
 *    月亮桥跨其**中段**（第 3 个点即月亮桥桥心）。
 *  - `WATER_CHANNEL_NORTHWEST`：湖西北岸（方位 216°）→ D 彩虹桥站东缘。
 *    彩虹桥跨其中段（第 3 个点即彩虹桥桥心）。
 *  - `WATER_CHANNEL_NORTHEAST`：湖东北岸（方位 -30°）→ A 孔桥站西缘。
 *    拱桥跨其中段（第 3 个点即拱桥桥心）。此河同时承担"跨湖引水入 A 组团"
 *    的叙事功能，因此在本版由 2 条增至 3 条。
 *
 * 起点贴湖岸（外推 1 m，避免水面盖住岸线），终点落在目标组团包围盒的输入侧
 * 边界上（内缩 1 m，避免河道钻进组团内部）。
 */
export const WATER_BODIES: ReadonlyArray<{ name: string; outline: ReadonlyArray<readonly [number, number]> }> = [
  {
    name: 'WATER_CHANNEL_WEST',
    // 湖西南岸 → F 广场小镇西北缘。
    outline: [
      [-27.0, 26.1],
      [-34.7, 33.5],
      [-42.3, 40.9],
      [-49.9, 48.2],
      [-57.6, 55.6],
    ],
  },
  {
    name: 'WATER_CHANNEL_NORTHWEST',
    // 湖西北岸 → D 彩虹桥站东缘。
    outline: [
      [-39.1, -28.4],
      [-46.0, -33.4],
      [-53.0, -38.5],
      [-60.0, -43.6],
      [-67.0, -48.7],
    ],
  },
  {
    name: 'WATER_CHANNEL_NORTHEAST',
    // 湖东北岸 → A 孔桥站西缘。
    outline: [
      [37.8, -21.8],
      [46.2, -26.7],
      [54.7, -31.6],
      [63.1, -36.4],
      [71.5, -41.3],
    ],
  },
];

// ---------------------------------------------------------------------------
// 道路（§4.5）：环形主路 + 组团间放射支路
// ---------------------------------------------------------------------------

export interface RoadSpec {
  readonly name: string;
  readonly closed: boolean;
  /** 路面宽度（米）。 */
  readonly widthM: number;
  readonly points: ReadonlyArray<readonly [number, number]>;
}

/**
 * 环形主路：与环湖轨道同构（湖岸外推 + 遇团内缩），位于轨道外侧约 5 m。
 * 半径 40.8 ~ 58.0 m，24 个控制点，与轨道同向（逆时针）绕行。
 *
 * 校验：离湖岸 ≥ 9.25 m（绝不入水）、离组团边界 ≥ 2.58 m。
 */
const ROAD_RING: ReadonlyArray<readonly [number, number]> = [
  [54.5, 0],
  [47.33, 12.68],
  [40.31, 23.27],
  [34.59, 34.59],
  [25.56, 44.28],
  [14.25, 53.17],
  [0, 54.48],
  [-12.1, 45.14],
  [-21.98, 38.07],
  [-33.5, 33.5],
  [-42.79, 24.71],
  [-51.5, 13.8],
  [-56.86, 0],
  [-54.47, -14.59],
  [-50.23, -29],
  [-39.44, -39.44],
  [-22.84, -39.56],
  [-10.55, -39.39],
  [0, -43.55],
  [12.37, -46.15],
  [27.1, -46.94],
  [40.53, -40.53],
  [46.48, -26.84],
  [51.75, -13.87],
];

/**
 * 外围车行环路：贴底座内缘，四周留约 12 m 边距（x = ±118、z = ±73 的椭圆）。
 *
 * 20 个控制点闭合环。作用是把园区各组团外侧串成一条完整车行环路，
 * 与环湖主路一起构成"内环（慢行/景观）+ 外环（车行/消防）"双环结构。
 *
 * 预期交叠：外环会从 A/B/D/E 四个外围组团的**外侧边沿**穿过（组团外缘
 * 最远到 |x| ≈ 103），这是设计意图——道路贴着园区外围连通，不从组团内部穿。
 */
const ROAD_OUTER_LOOP: ReadonlyArray<readonly [number, number]> = [
  [118, 0],
  [112.2, 22.6],
  [95.5, 42.9],
  [69.4, 59.1],
  [36.5, 69.4],
  [0, 73],
  [-36.5, 69.4],
  [-69.4, 59.1],
  [-95.5, 42.9],
  [-112.2, 22.6],
  [-118, 0],
  [-112.2, -22.6],
  [-95.5, -42.9],
  [-69.4, -59.1],
  [-36.5, -69.4],
  [0, -73],
  [36.5, -69.4],
  [69.4, -59.1],
  [95.5, -42.9],
  [112.2, -22.6],
];

/**
 * 环湖主路 + 外围车行环路 + 8 条放射支路（共 10 条）。
 * 每条支路从**环线的最近点**出发，终点严格等于该组团 `center`
 * （`ROAD_SPUR_A` 接 A 组团，依此类推）。
 */
export const ROADS: readonly RoadSpec[] = [
  { name: 'ROAD_RING', closed: true, widthM: 5.2, points: ROAD_RING },
  // `closed: true`，故末点无需与首点重复（曲线自动闭合）。
  { name: 'ROAD_OUTER_LOOP', closed: true, widthM: 7.0, points: ROAD_OUTER_LOOP },
  // A 孔桥站（东北）：环线东段 → 组团中心
  { name: 'ROAD_SPUR_A', closed: false, widthM: 3.6, points: [[46.48, -26.84], [67.2, -37.4], [88, -48]] },
  // B 水镇站（东南）：环线东南段 → 组团中心
  { name: 'ROAD_SPUR_B', closed: false, widthM: 3.6, points: [[40.31, 23.27], [63.2, 34.6], [86, 46]] },
  // C 中央站（北偏东）：环线北段 → 组团中心
  { name: 'ROAD_SPUR_C', closed: false, widthM: 3.6, points: [[27.1, -46.94], [28.6, -56.5], [30, -66]] },
  // D 彩虹桥站（西北）：环线西段 → 组团中心
  { name: 'ROAD_SPUR_D', closed: false, widthM: 3.6, points: [[-50.23, -29], [-67.1, -34.5], [-84, -40]] },
  // E 春笋站（西南）：环线西南段 → 组团中心
  { name: 'ROAD_SPUR_E', closed: false, widthM: 3.6, points: [[-51.5, 13.8], [-69.8, 22.9], [-88, 32]] },
  // F 广场站（南偏西）：环线南段 → 组团中心
  { name: 'ROAD_SPUR_F', closed: false, widthM: 3.6, points: [[-33.5, 33.5], [-38.8, 49.8], [-44, 66]] },
  // G 红豆站（南偏东）：环线南段 → 组团中心
  { name: 'ROAD_SPUR_G', closed: false, widthM: 3.6, points: [[14.25, 53.17], [15.1, 59.6], [16, 66]] },
  // H 贝壳站（北偏西）：环线北段 → 组团中心
  { name: 'ROAD_SPUR_H', closed: false, widthM: 3.6, points: [[-22.84, -39.56], [-23.4, -52.8], [-24, -66]] },
];

// ---------------------------------------------------------------------------
// 环境小品（ENV_*）落位
// ---------------------------------------------------------------------------

/**
 * 环境小品落位：
 *  - `ENV_LANDSCAPE_ASSETS`：置于主车站（[-10.3, -38.4]）西南侧空地，
 *    作为站前景观铺陈。半径 69.4 m，位于湖岸（≈48.8 m）之外，
 *    包围盒 [-50.7,-41.3]×[-55.7,-48.3] 与任何组团、轨道均不重叠。
 *    （旧坐标 [-32,-30] 半径仅 43.9 m，会落在湖面上，已废弃。）
 *  - `ENV_TREE_CLUSTER`：树木簇原件被"实例化森林"取代，置于底座之下
 *    （[-96, -70] 角落，远离新布局），立即可见性为零，不影响取景。
 */
export const ENVIRONMENT_PLACEMENTS: Record<string, Placement> = {
  ENV_LANDSCAPE_ASSETS: { center: [-46, -52], rotationY: 0.35, elevation: 0, scale: 0.55 },
  // 树木簇原件被"实例化森林"取代：置于底座之下，立即可见性为零（不影响取景）。
  ENV_TREE_CLUSTER: { center: [-96, -70], rotationY: 0, elevation: 0, scale: 1 },
};

/** `ENV_TREE_CLUSTER` 原件在实例化后隐藏。 */
export const HIDDEN_ASSET_IDS: readonly string[] = ['ENV_TREE_CLUSTER'];

/** 原件需抬高到地面之下的资产（避免落位瞬间外露）。 */
const SUB_GROUND_ASSET_IDS: readonly string[] = ['ENV_TREE_CLUSTER'];
const SUB_GROUND_Y = -40;

// ---------------------------------------------------------------------------
// 加载器接口：resolvePlacement(entry)
// ---------------------------------------------------------------------------

/** 资产 id → 落位（直接可用表，供加载器 `layout{}` 兜底分支）。 */
export const layout: Record<string, AssetPlacement> = buildLayoutTable();

function buildLayoutTable(): Record<string, AssetPlacement> {
  const table: Record<string, AssetPlacement> = {};
  for (const id of DISTRICT_ORDER) {
    const spec = DISTRICTS[id];
    table[spec.objectName] = placementToAsset(spec.placement);
  }
  for (const key of Object.keys(BRIDGES) as BridgeId[]) {
    const spec = BRIDGES[key];
    table[spec.objectName] = placementToAsset(spec.placement);
  }
  for (const key of Object.keys(LANDMARKS) as Array<keyof typeof LANDMARKS>) {
    const spec = LANDMARKS[key];
    table[spec.objectName] = placementToAsset(spec.placement);
  }
  table[STATION.objectName] = placementToAsset(STATION.placement);
  for (const [assetId, placement] of Object.entries(ENVIRONMENT_PLACEMENTS)) {
    table[assetId] = placementToAsset(placement);
  }
  return table;
}

/** 归一化缩放：标量 → 原样；数组 → 原样（缺省 1）。 */
function normalizeScale(scale: Placement['scale']): number | readonly [number, number, number] {
  return scale ?? 1;
}

/** 取缩放的 Y 分量（"底面贴地"换算必须用 Y 分量，不能用 X 或 Z）。 */
function scaleYOf(scale: number | readonly [number, number, number]): number {
  return typeof scale === 'number' ? scale : scale[1];
}

/**
 * 把布局表转换为加载器可直接应用的 `AssetPlacement`。
 *
 * `y` 由模型自身包围盒底面推导，保证模型**底面恰好贴在地面基准面**上
 * （不悬浮、不陷地）：
 *
 *     y = elevation + max(0, -bboxMinY * scaleY)
 *
 * 注意：这里必须用 **Y 分量**缩放。组团为"平面压扁、高度不压"的非等比
 * 三轴缩放（sx = sy ≠ sz），若误用 X/Z 分量，模型会悬浮或陷地。
 */
function placementToAsset(placement: Placement, bboxMinY = 0): AssetPlacement {
  const scale = normalizeScale(placement.scale);
  const sy = scaleYOf(scale);
  const y = placement.elevation + Math.max(0, -bboxMinY * sy);
  return {
    position: [placement.center[0], y, placement.center[1]],
    rotation: [0, placement.rotationY, 0],
    scale,
  };
}

/**
 * `src/loaders/placement.ts` 优先调用的落位解析函数（取代临时兜底布局）。
 * 返回 `null` 表示本表未覆盖该资产（加载器会记录并保留原始变换）。
 */
export function resolvePlacement(entry: AssetManifestEntry): AssetPlacement | null {
  const id = entry.assetId;
  const minY = entry.boundingBox?.min[1] ?? 0;

  // 组团
  const district = findDistrictByAssetId(id);
  if (district) {
    const spec = DISTRICTS[district];
    return placementToAsset(spec.placement, minY);
  }

  // 桥梁
  const bridge = BRIDGE_ASSET_TO_ID[id];
  if (bridge) {
    return placementToAsset(BRIDGES[bridge].placement, minY);
  }

  // 湖景胶囊会议中心
  if (id === LANDMARKS.CAPSULE_CENTER.assetId) {
    return placementToAsset(LANDMARKS.CAPSULE_CENTER.placement, minY);
  }

  // 车站
  if (id === STATION.assetId) {
    return placementToAsset(STATION.placement, minY);
  }

  // 环境小品
  const env = ENVIRONMENT_PLACEMENTS[id];
  if (env) {
    if (SUB_GROUND_ASSET_IDS.includes(id)) {
      return {
        position: [env.center[0], SUB_GROUND_Y, env.center[1]],
        rotation: [0, env.rotationY, 0],
        scale: env.scale ?? 1,
      };
    }
    return placementToAsset(env, minY);
  }

  // 列车（机车/车厢）初始停在主车站；运行期由 src/railway 重新安置。
  if (id === 'TRAIN_HEAD' || id.startsWith('TRAIN_CAR_')) {
    const scale = RAILWAY.trainScale;
    return {
      position: [STATION.placement.center[0], RAILWAY.railTopY - 0.4 * scale, STATION.placement.center[1]],
      rotation: [0, 0, 0],
      scale,
    };
  }

  return null;
}

function findDistrictByAssetId(assetId: string): DistrictId | null {
  for (const id of DISTRICT_ORDER) {
    if (DISTRICTS[id].objectName === assetId) return id;
  }
  return null;
}