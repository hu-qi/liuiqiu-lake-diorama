# 华为练秋湖数字沙盘 · 技术架构与接口契约（docs/architecture.md）

> 本文件是**并行开发的唯一对齐依据**。所有模块的坐标、命名、加载路径、API 签名以本文件为准。
> 冲突时：`PROMPT.md` > 本文件 > 各模块注释。

---

## 1. 技术栈与版本锁定

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `three` | **0.186.0（锁定）** | 实时渲染核心，r186（与 `.agents/skills/threejs-*` 一致） |
| `vite` | `^7` | 构建 / 开发服务器 |
| `typescript` | `~5.6` | 类型系统，`strict: true` |
| `vitest` | `^2` | 单元测试 |
| `@playwright/test` | `^1.4x` | e2e / 视觉截图 |
| `@gltf-transform/cli` | `^4`（devDependency） | GLB inspect / optimize |
| `eslint` + `@typescript-eslint` | 最新稳定 | 静态检查 |

**渲染器固定配置**（PROMPT §8.1）：`WebGLRenderer`、`OrthographicCamera`、`OrbitControls`、`GLTFLoader`、`ACESFilmicToneMapping`、`SRGBColorSpace`、阴影贴图、环境光 + 方向光。
**按需启用**（不强制加载）：`DRACOLoader` / `KTX2Loader` / `MeshoptDecoder` —— 仅当实际资产使用对应压缩时才挂载。

---

## 2. 目录结构（对齐 PROMPT §13）

```
liuiqiu-lake/
  docs/                     # 本批交付文档
  references/               # 参考资料（禁止发布未授权照片）
    site-plan/ architecture/ bridges/ train/ landscape/ materials/
  blender/
    source/                 # .blend 可编辑源文件（必须保留）
    scripts/                # 可重复执行的 bpy 参数化脚本
    renders/                # Blender 多角度预览截图
    export/                 # GLB 中间导出目录
  public/
    models/
      districts/            # DISTRICT_*.glb
      bridges/              # LANDMARK_*_BRIDGE.glb
      trains/               # TRAIN_*.glb
      stations/             # STATION_*.glb
      environment/          # 树木/花坛/喷泉/胶囊会议中心等
  src/
    core/                   # createApp / renderer / 正交相机 / controls / clock
    scene/                  # plinth / terrain / layout
    loaders/                # manifest 驱动加载
    districts/              # A–H 与地标摆放
    railway/                # 轨道曲线 / 枕木钢轨 / 列车运行 / 停靠
    water/                  # 练秋湖程序化水体
    materials/              # 材质预设与 PBR 调优
    interactions/           # raycast / 聚焦 / 环绕
    ui/                     # 信息面板 / 工具条
    utils/                  # 通用工具
  tests/
    e2e/ visual/ assets/
  assets-manifest.json
  package.json
  index.html
  vite.config.ts
```

**分层依赖规则（禁止循环依赖）**：
```
utils  <-  materials  <-  water
                      <-  loaders -> (读取 assets-manifest.json)
scene(layout) <- districts / railway / interactions / ui
core -> scene / districts / railway / water / interactions / ui   （core 只被 main 调用）
```
- `utils` 不依赖任何业务模块。
- `layout.ts` 是坐标唯一来源，`districts` / `railway` / `water` 均从它读取，**不得各自硬编码坐标**。
- `loaders` 只依赖 `utils` 与 `three`，不感知 UI。

---

## 3. 世界坐标约定（**强制**）

1. **坐标系**：Three.js 默认 **Y-up**；沙盘**1 单位 = 1 米**。
2. **轴向**：`+X = 东`，`-Z = 北`，`+Z = 南`，`+Y = 上`。
3. **Z-up → Y-up 转换**：**统一在 Blender 导出（`bpy.ops.export_scene.gltf(..., export_yup=True)`）阶段完成**。
   **严禁**在 Three.js 的模型加载函数中为不同模型添加各自不同的轴向补偿旋转（PROMPT §7.2）。
   若发现某资产朝向错误，修正 Blender 源文件或导出参数，而非在运行时打补丁。
4. **原点规范**（PROMPT §7.3）：
   - 建筑：原点置于**建筑地面中心**（base center，Y=0 为落地面）；
   - 列车：原点置于**沿轨道定位点**（车厢底面中心，X 轴指向车头方向）；
   - 桥梁：原点置于**桥头或桥中心**定位锚点（Y=0 为桥面设计基准）。
5. **落地约束**：所有建筑 `boundingBox.min.y ≈ 0`（相对于底座顶面），**不得悬浮或穿入底座**。
6. **统一比例**：沙盘尺寸允许艺术化压缩，但建筑 / 道路 / 人物 / 桥梁 / 列车之间的相对比例必须一致。

---

## 4. 沙盘底座与布局坐标（初始契约，可微调但需同步本文档）

### 4.1 底座尺寸
| 参数 | 值（单位） | 说明 |
| --- | --- | --- |
| `PLINTH.width`（X） | **260** | 东西向长度 |
| `PLINTH.depth`（Z） | **170** | 南北向宽度 |
| `PLINTH.thickness`（Y） | **10** | 底座总厚度 |
| 顶层 | 浅砂岩色，厚 ~4 | 可分缝纹理，承载地貌 |
| 夹层 | 绿色（草地）/ 灰色（岩层），厚 ~3 | 地质剖面感 |
| 底层 | 深灰色，厚 ~3 | 配重/阴影 |
| 铭牌 | 正面（-Z 或 +X 面）金属材质 | 项目名 + 版本 |

- 底座顶面为 **地面基准面 `y = 0`**（之上的世界按此构建）；底座体占 `y ∈ [-10, 0]`。
- A 区高地地形在基准面之上升起，最高约 **+18**。

### 4.2 练秋湖
- **居中**，不规则自然轮廓，中心 `(0, 0)`，主半径约 `45 × 32`（X×Z），由 `THREE.Shape` 程序化生成。
- 低饱和蓝绿色水体、轻微动态波纹、柔和反射、清晰湖岸边界。
- 静态岸线/石岸/临水建筑可 Blender 建模；**水体动态由 Three.js 负责**。

### 4.3 八组团近似布局（艺术化压缩，非测绘级）
| 组团 | 对象名 | 中心 (X, Z) | 朝向 rotationY | 地形抬高 | 备注 |
| --- | --- | --- | --- | --- | --- |
| A 山顶聚落 | `DISTRICT_A_HILLTOP` | (-80, -55) | 25° | +10~+18 | 需人工地形与制高点塔楼 |
| B 水镇 | `DISTRICT_B_WATERTOWN` | (-72, 26) | 90° | 0 | 依水而建，接水道 |
| C 城市经典轴线 | `DISTRICT_C_URBAN_AXIS` | (-8, -64) | 0° | 0 | 北轴，柱廊对称 |
| H 城市经典轴线 | `DISTRICT_H_URBAN_AXIS` | (-8, 62) | 180° | 0 | 南轴，与 C 共享轴线语言 |
| D 城市大学院落 | `DISTRICT_D_COLLEGE` | (78, -50) | 210° | 0 | 学院主体楼 + 塔楼 L3 |
| E 森林小镇 | `DISTRICT_E_FOREST_TOWN` | (96, 6) | 180° | 0~+3 | 林间低密度 |
| F 广场/港湾小镇 | `DISTRICT_F_PLAZA_TOWN` | (60, 50) | 135° | 0 | 临湖开放广场 |
| G 城市街区 | `DISTRICT_G_URBAN_BLOCKS` | (18, 62) | 0° | 0 | 城市肌理，街角庭院 |

### 4.4 地标
| 对象名 | 中心 (X, Z) | 说明 |
| --- | --- | --- |
| `LANDMARK_MOON_BRIDGE` | (-40, -4) | 连接 B 水镇与中央湖岸，开放桥洞 |
| `LANDMARK_RAINBOW_BRIDGE` | (42, 22) | 东侧跨水道，独立曲线桥面 |
| `LANDMARK_ARCH_BRIDGE` | (-26, -32) | 北侧连接 C 与 A 坡地 |
| `LANDMARK_CAPSULE_CENTER` | (32, 34) | 湖景胶囊会议中心（湖岸连接平台） |

### 4.5 水道 / 道路 / 轨道
- **水道**：自湖向 B（西）与 F（东南）延伸两条支流，用于水镇与港湾衔接。
- **道路**：环形主路贯穿八组团 + 组团间放射支路（`src/scene/layout.ts` 中 `ROADS`）。
- **轨道**：闭环曲线（`THREE.CatmullRomCurve3`，`closed=true`），环绕湖泊并依次经过 A→C→D→E→F→G→H→B→A 附近。
  - `STATION_MAIN` 中心 `(14, 52)`（G 区旁）。
  - **单一轨道数据源**同时驱动钢轨、枕木、列车路径（防脱轨）。

### 4.6 `src/scene/layout.ts` 契约（示例签名）
```ts
export const PLINTH = { width: 260, depth: 170, thickness: 10 } as const;
export type DistrictId = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H';
export interface Placement { center: [number, number]; rotationY: number; elevation: number; }
export const DISTRICTS: Record<DistrictId, { objectName: string; placement: Placement }>;
export const BRIDGES: Record<'MOON'|'RAINBOW'|'ARCH', Placement>;
export const LANDMARKS: Record<'CAPSULE_CENTER', Placement>;
export const RAILWAY: { controlPoints: [number, number, number][]; station: Placement };
export const WATER_BODIES: Array<{ name: string; outline: [number, number][] }>;
```

---

## 5. 运行时对象命名规范（PROMPT §7.4）

- 组团顶层对象（**交互拾取稳定标识**）：`DISTRICT_A_HILLTOP` … `DISTRICT_H_URBAN_AXIS`。
- 地标：`LANDMARK_MOON_BRIDGE` / `LANDMARK_RAINBOW_BRIDGE` / `LANDMARK_ARCH_BRIDGE` / `LANDMARK_CAPSULE_CENTER`。
- 列车：`TRAIN_HEAD`、`TRAIN_CAR_01`、`TRAIN_CAR_02` …
- 车站：`STATION_MAIN`（可扩展 `STATION_*`）。
- 代码内运行时对象前缀沿用短横线风格（如工具组 `ui-`，装饰实例 `env-tree-`），**常量用 `SCREAMING_SNAKE_CASE`，函数/变量用 `camelCase`**。

---

## 6. `assets-manifest.json` 字段定义（PROMPT §7.6）

```jsonc
{
  "version": "1.0.0",
  "generatedAt": "2026-10-22T00:00:00Z",
  "assets": [
    {
      "assetId": "district_d_college",         // string, 唯一 slug
      "name": "城市大学院落",                    // string, 中文显示名
      "district": "D",                          // "A".."H" | "BRIDGE" | "TRAIN" | "STATION" | "ENV"
      "sourceBlend": "blender/source/D_College.blend",
      "outputGLB": "public/models/districts/D_COLLEGE.glb",
      "boundingBox": { "min": [x,y,z], "max": [x,y,z] },
      "triangleCount": 52340,                   // int
      "materialCount": 7,                       // int
      "textureCount": 4,                        // int
      "fileSize": 1873421,                      // bytes
      "sourceReferences": ["https://www.archina.com/..."], // URL 数组
      "fidelityLevel": "L3",                    // "L0"|"L1"|"L2"|"L3"
      "verified": true,                         // 通过两级截图环闭环
      "notes": "主体楼与塔楼 L3；翼楼 L2"         // 可选：已知限制/近似说明
    }
  ]
}
```

**字段约束**：
- `assetId` = `outputGLB` 文件名的 snake_case（唯一键）。
- `outputGLB` 路径必须与 §8 规范一致，且文件真实存在方可 `verified=true`。
- `verified=false` 时必须填写 `notes` 说明原因（缺参考/未截图/工具不可用）。
- `fidelityLevel` 依据本文档 §art-direction 的 L0–L3 标准判定。
- Three.js **只通过 manifest 加载模型**，禁止在多文件中散落硬编码资源路径。

---

## 7. 核心模块职责与对外 API

### 7.1 `src/core`
```ts
// core/app.ts
export interface DioramaApp {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  start(): void;             // 启动渲染循环
  fpsAdapt(dt: number): void; // 相机/视锥自适应（按场景包围盒）
  dispose(): void;           // 释放资源
  getStats(): SceneStats;    // { fps, drawCalls, triangles, loadedAssets, errors }
}
export function createApp(canvas: HTMLCanvasElement): DioramaApp;
```
```ts
// core/camera.ts
export function createOrthoCamera(aspect: number): THREE.OrthographicCamera;
export function frameScene(camera: THREE.OrthographicCamera, bbox: THREE.Box3, aspect: number): void; // 自动适配视距/视锥
```
```ts
// core/clock.ts
export const createClock = (): { delta: number; elapsed: number; update(): void };
```

### 7.2 `src/scene`
```ts
// scene/plinth.ts
export function createPlinth(): THREE.Group;          // 厚底座 + 铭牌
// scene/terrain.ts
export function createTerrain(): THREE.Group;         // A 区高地等地形（含挡土墙基）
// scene/layout.ts  -> 见 §4.6
```

### 7.3 `src/water`
```ts
// water/waterBody.ts
export class WaterBody {
  readonly group: THREE.Group;
  constructor(outline: [number, number][], opts?: WaterOptions);
  update(delta: number): void;   // 更新波纹相位
  dispose(): void;
}
export interface WaterOptions { color?: number; amplitude?: number; reflectivity?: number; }
// water/material.ts
export function createWaterMaterial(opts?: WaterOptions): THREE.Material; // 低饱和蓝绿 + 柔和反射
```

### 7.4 `src/loaders`（manifest 驱动）
```ts
// loaders/manifest.ts
export interface ManifestEntry { /* 见 §6 */ }
export interface Manifest { version: string; assets: ManifestEntry[]; }
export function loadManifest(url?: string): Promise<Manifest>;   // 默认 '/assets-manifest.json'
export function filterByDistrict(m: Manifest, id: string): ManifestEntry[];

// loaders/assetLoader.ts
export interface LoadProgress { loaded: number; total: number; percent: number; currentId: string; }
export type LoadStatus = 'idle'|'loading'|'ready'|'error';
export function createGltfLoader(renderer: THREE.WebGLRenderer): GLTFLoader; // 按需挂 Draco/KTX2/Meshopt
export function loadAssets(
  gltfLoader: GLTFLoader,
  entries: ManifestEntry[],
  onProgress?: (p: LoadProgress) => void
): Promise<{ root: THREE.Group; failures: Array<{ assetId: string; error: string }> }>;
```
- 加载失败**必须记录并以 UI 提示**（PROMPT §8.3），不得静默吞掉。

### 7.5 `src/materials`
```ts
// materials/plinthMaterials.ts
export function createPlinthMaterials(): { top: THREE.Material; grass: THREE.Material; rock: THREE.Material; base: THREE.Material; nameplate: THREE.Material };
// materials/pbrPresets.ts
export function applyPbrPresets(root: THREE.Object3D): void;  // 石材粗糙度/砖墙色变/玻璃/金属栏杆/木椅等统一调优
```

### 7.6 `src/railway`
```ts
// railway/track.ts
export function createTrack(controlPoints: THREE.Vector3[]): { curve: THREE.CatmullRomCurve3; rails: THREE.Group; sleepers: THREE.Group };
// railway/train.ts
export class DioramaTrain {
  readonly group: THREE.Group;
  constructor(cars: THREE.Object3D[], curve: THREE.CatmullRomCurve3, spacing: number);
  start(): void; pause(): void; followCamera(camera: THREE.OrthographicCamera, on: boolean): void;
  update(delta: number): void;   // 按弧长采样，各车厢独立 getPointAt/getTangentAt
}
```

### 7.7 `src/interactions` / `src/ui`
```ts
// interactions/picker.ts
export class DistrictPicker {
  constructor(camera: THREE.Camera, roots: THREE.Object3D[], onSelect: (name: string, object: THREE.Object3D) => void);
  update(): void; // Raycaster 逐帧或按需
}
// interactions/cameraFocus.ts
export function focusOn(camera, controls, target: THREE.Vector3, durationMs?: number): void; // 平滑聚焦
// interactions/orbit.ts
export function setAutoOrbit(controls: OrbitControls, on: boolean, speed?: number): void;
// ui/infoPanel.ts
export function mountInfoPanel(container: HTMLElement): { show(entry: { name: string; district: string; level: string }): void; hide(): void };
// ui/toolbar.ts
export function mountToolbar(container: HTMLElement, actions: ToolbarActions): void; // 截图/Clean/全屏/主题切换/重置
```

### 7.8 `src/utils`
```ts
export function degToRad(deg: number): number;
export function setShadowLevel(renderer: THREE.WebGLRenderer, level: 'off'|'low'|'high'): void;
export function limitPixelRatio(renderer: THREE.WebGLRenderer, max: number): void; // 限制 DPR
export function namedGroup(name: string): THREE.Group; // 设置 group.name 并挂 userData
```

---

## 8. 暴露给测试的全局钩子

`src/main.ts` 在初始化后挂载（供 Vitest/Playwright 断言）：
```ts
declare global {
  interface Window {
    __DIORAMA__?: {
      ready: boolean;                     // 模型全部加载完成
      error: string | null;               // 顶层错误
      scene: THREE.Scene;                 // 场景根
      camera: THREE.OrthographicCamera;
      getStats(): { fps: number; drawCalls: number; triangles: number; loadedAssets: number };
      getObjectByName(name: string): THREE.Object3D | null; // 校验 DISTRICT_*/LANDMARK_*/TRAIN_*
      select(name: string): void;         // 触发选中，用于交互测试
    };
  }
}
```
- e2e 断言用：`window.__DIORAMA__.ready === true`、`getObjectByName('DISTRICT_D_COLLEGE') !== null`、`getStats().triangles > 0`。

---

## 9. GLB 输出路径规范

```
public/models/
  districts/    <DISTRICT_NAME>.glb     # D_COLLEGE.glb / A_HILLTOP.glb ...
  bridges/      LANDMARK_<NAME>.glb     # LANDMARK_MOON_BRIDGE.glb ...
  trains/       TRAIN_<PART>.glb        # TRAIN_HEAD.glb / TRAIN_CAR_01.glb ...
  stations/     STATION_<NAME>.glb      # STATION_MAIN.glb
  environment/  ENV_<NAME>.glb          # ENV_TREE_OAK.glb / LANDMARK_CAPSULE_CENTER.glb ...
```
- 命名与 §5 运行时对象名保持可推导映射（`outputGLB` → manifest `assetId`）。
- 导出前必须通过 PROMPT §7.5 校验清单（见 `docs/asset-pipeline.md` §4）。

---

## 10. 数据流与生命周期

```
assets-manifest.json
      │ (fetch, loaders/manifest.ts)
      ▼
GLTFLoader ──► (loaders/assetLoader.ts) ──► THREE.Group 挂到 scene
      │                                         │
      │                                         ├─ districts/* 按 layout 落位
      │                                         ├─ railway/* 采样曲线运行
      │                                         └─ water/* 每帧 update
      ▼
core/app.ts 渲染循环 ──► interactions 拾取/聚焦 ──► ui 面板 ──► window.__DIORAMA__ 供测试
```

- **启动顺序**：`createApp` → `createPlinth` + `createTerrain` + `WaterBody` → `loadManifest` → `loadAssets` → 落位 → 启动循环 → 置 `__DIORAMA__.ready = true`。
- **释放**：所有 `dispose()` 必须解绑事件、释放 geometry/material/texture，避免测试间泄漏。