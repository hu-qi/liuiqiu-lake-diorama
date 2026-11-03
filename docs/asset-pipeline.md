# 华为练秋湖数字沙盘 · 资产流水线（docs/asset-pipeline.md）

> 定义 Blender → GLB → Three.js 的可复现资产生产流程、导出校验清单、坐标/原点/命名规范与清单维护方式。
> 严格对齐 `PROMPT §3 / §7 / §11`。

---

## 1. 流水线总览

```
[参考图/索引]  references/*
      │  阅读、提取轮廓/层数/屋顶/立面特征
      ▼
[bpy 参数化脚本]  blender/scripts/*.py   ← 可重复执行，不依赖临时 Blender 会话
      │  调用 create_building_mass / create_facade / ...
      ▼
[.blend 源文件]  blender/source/*.blend  ← 保留可编辑对象与修改器（GLB 不替代源文件）
      │  Blender MCP 检查对象/网格/材质 + 渲染多角度
      ▼
[渲染预览图]  blender/renders/*.png        ← 正面/侧面/顶部/三分之四
      │  发现问题 → 回改 bpy / 源文件 → 重渲
      ▼
[GLB 导出]  public/models/{districts,bridges,trains,stations,environment}/*.glb
      │  导出即执行 §4 校验清单（脚本自动 + 人工）
      ▼
[Three.js 加载]  GLTFLoader + manifest 驱动  → 浏览器截图验证
      │
      ▼
[更新 assets-manifest.json]  记录 结构/尺寸/面数/等级/verified
```

**核心纪律**：
- 每个关键资产必须完成「建模 → 渲染 → 浏览器显示」**闭环**（PROMPT §3.2），缺一不算完成。
- 必须**两级截图**：A. Blender 预览；B. Three.js 浏览器截图（PROMPT §11.3）。
- **不得把"编写了 Blender Python 代码"误认为"已成功建立模型"**（PROMPT §0）。

---

## 2. Blender MCP 使用规范

### 2.1 连接检查（PROMPT §3.1）
1. 调用 `get_addon_status` 确认 Blender 连接与插件能力。
2. 调用 `get_scene_info` 获取当前对象/材质/层级/统计。
3. 用 `execute_blender_code` 执行 bpy 建模。
4. 用 `look` 查看视口/多角度/渲染结果。
5. 按需 `search_assets` / `import_asset`（仅合规资产）。

> **工具名随 MCP 版本变化，必须以实际发现的工具定义为准，不得猜测调用成功**（PROMPT §3.1）。
> MCP 不可用时：改用本地 `blender --background --python blender/scripts/xxx.py`，并在交付说明中**如实记录执行方式**（PROMPT §0）。

### 2.2 参数化建模函数（PROMPT §3.3，建议命名）
```
create_building_mass()    create_facade()
create_window_module()    create_door_portal()
create_pitched_roof()     create_mansard_roof()
create_clock_tower()      create_courtyard()
create_arch_bridge()      create_rainbow_bridge()   # 独立曲线，禁止改色复用
create_moon_bridge()      create_railing()
create_train_car()        create_tree_cluster()
```
**参数维度**：长度 / 宽度 / 层高 / 楼层数 / 屋顶坡度 / 屋顶形态 / 窗户数量 / 窗户间距 / 材质 / 装饰复杂度 / **随机种子**。
- 建筑共性抽取为模块；**参考图中真正具辨识度的部分**作为独立几何资产。
- 禁止逐个手工复制建筑。

### 2.3 建模技术（PROMPT §3.4）
Mesh Modeling、Bevel / Array / Mirror / Boolean Modifier、Curve Geometry、Geometry Nodes、Instancing、Material Nodes、UV Mapping、Normal 修正与拓扑检查。
- 桥梁拱洞**真实几何挖空**；山坡地形用网格/曲面/几何节点；屋顶有真实厚度与坡面。

---

## 3. 坐标 / 原点 / 命名规范（PROMPT §7.2–7.4）

### 3.1 坐标与比例
- Blender 使用一致单位规范（建议 `unit_scale = 1.0`，1 BU = 1 m）。
- 导出统一处理轴向：`bpy.ops.export_scene.gltf(..., export_yup=True)`，将 Blender **Z-up → glTF/Three.js Y-up**。
- **禁止**在 Three.js 加载函数中为不同模型添加不同轴向补偿旋转。发现朝向错误 → 改 Blender 源文件 / 导出参数。
- 沙盘总体尺寸允许艺术化压缩，但**建筑/道路/人物/桥梁/列车相对比例必须统一**。

### 3.2 原点
| 资产 | 原点位置 |
| --- | --- |
| 建筑 | 建筑**地面中心**（Y=0 为落地面）。确保导入后 `boundingBox.min.y ≈ 0` |
| 列车 | 沿轨道定位点（车厢底面中心，局部 +X 指向车头） |
| 桥梁 | 桥头或桥中心定位锚点 |

### 3.3 命名
- **Blender 对象 / GLB 节点名** 与运行时名称一致（PROMPT §7.4）：
  `DISTRICT_A_HILLTOP` … `DISTRICT_H_URBAN_AXIS`、`LANDMARK_MOON_BRIDGE` / `LANDMARK_RAINBOW_BRIDGE` / `LANDMARK_ARCH_BRIDGE` / `LANDMARK_CAPSULE_CENTER`、`TRAIN_HEAD` / `TRAIN_CAR_01` …、`STATION_MAIN`。
- **源文件命名**（PROMPT §3.5）：`A_Hilltop.blend`、`B_Watertown.blend`、`C_UrbanAxis.blend`、`D_College.blend`、`E_ForestTown.blend`、`F_PlazaTown.blend`、`G_UrbanBlocks.blend`、`H_UrbanAxis.blend`、`Bridges.blend`、`Train.blend`、`Stations.blend`、`LandscapeAssets.blend`。
- 顶层对象**保留可用于交互拾取的稳定标识**。
- GLB 输出路径规范见 `docs/architecture.md §9`。

---

## 4. GLB 导出校验清单（PROMPT §7.5，必须逐项通过）

导出后自动 + 人工核对以下 10 项：
1. **文件存在**（路径与 manifest `outputGLB` 一致）。
2. **文件可以解析**（`npx @gltf-transform/cli inspect <file>` 无错）。
3. **网格不为空**（`triangleCount > 0`）。
4. **材质正常**（材质数与预期一致，无丢材质发黑）。
5. **尺寸合理**（围绕 boundingBox 与设计目标比对，无一维异常爆表）。
6. **旋转正确**（Y-up 落地，无倒置/侧躺）。
7. **法线方向正确**（无黑面/翻转面）。
8. **不存在严重破面**（无大面积空洞/翻转）。
9. **没有不需要的相机与灯光**（导出剔除 camera / light）。
10. **没有意外导出隐藏的高面数参考对象**（导出前删除或排除隐藏参考 mesh）。

> 建议自动化脚本：`blender/scripts/validate_glb.py`（读取 GLB → 输出 §4 报告 JSON），并纳入 `tests/assets/`。

---

## 5. 两级验证闭环（PROMPT §11）

### 5.1 Blender 端（A 级截图）
每个关键资产完成后：
- 检查场景对象与材质（`get_scene_info`）；
- 从**正面、侧面、顶部、三分之四**观察；
- 渲染预览图存 `blender/renders/`；
- 检查完整性：窗户/屋顶/台阶/桥梁结构；穿模/破面/悬浮；
- MCP 支持截图/多角度查看时**必须实际调用**；
- 发现问题 → 修改 → **重新验证**。

### 5.2 Three.js 端（B 级截图）
通过 Playwright：
1. 启动本地服务 → 2. 打开页面 → 3. 等待加载完成（`window.__DIORAMA__.ready`）→ 4. 截图 → 5. 检查页面错误与加载失败 → 6. 检查相机是否裁切底座 → 7. 检查各建筑显示 → 8. 检查桥梁/列车存在 → 9. 交互测试 → 10. 保存最终截图。

> **必须真实截图验证**，不能仅靠源码推断画面正确（PROMPT §11.2）。

### 5.3 自动迭代规则（PROMPT §12）
循环「制作—渲染—检查—修复—复测」，每次视觉检查关注：
建筑是否过于简陋 / 是否大量重复盒子 / 比例是否合理 / 湖泊是否被遮挡 / 桥梁是否开放 / 列车是否与轨道一致 / 植被是否过密 / 视觉焦点是否清楚 / 光照是否过曝 / 是否悬空或穿模。
**优先修复影响整体视觉品质的问题；不要用无关装饰掩盖模型不足。**

---

## 6. 资产清单（assets-manifest.json）维护方式

- **唯一清单文件**：`assets-manifest.json`（字段定义见 `docs/architecture.md §6`）。
- **维护时机**：每完成/修改一个 GLB 即更新对应条目（禁止批量补记导致漏项）。
- **更新流程**：
  1. 导出 GLB → 运行 §4 校验 → 记录 `triangleCount` / `materialCount` / `textureCount` / `fileSize` / `boundingBox`；
  2. 完成两级截图 → 置 `verified=true`；
  3. 未达标/未截图/缺参考 → 置 `verified=false` + 填写 `notes` 原因；
  4. 首次进入的资产补齐 `sourceReferences`（对应 `docs/references.md`）与 `fidelityLevel`。
- **消费方式**：Three.js 仅通过 manifest 加载，禁止在多文件中硬编码资源路径（PROMPT §7.6）。

---

## 7. 优化与压缩（Phase 7，PROMPT §10）

- 命令行优化（示例）：
  ```bash
  npx @gltf-transform/cli inspect public/models/districts/D_COLLEGE.glb
  npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp --texture-size 2048
  npx @gltf-transform/cli inspect out.glb   # 对比优化前后
  ```
- 启用某压缩后，**仅在运行时挂载对应解码器**（Draco→`DRACOLoader`，KTX2→`KTX2Loader`，Meshopt→`MeshoptDecoder`），不需要的解码器**不强制加载**（PROMPT §8.1）。
- 手段：GLB 压缩、Meshopt/Draco、纹理压缩、LOD、Frustum Culling、InstancedMesh、重复材质合并、静态网格合批、可选阴影等级、限制 DPR、减少透明过度绘制。
- **红线**：不得通过移除窗户、桥梁细节、建筑立面来换取性能；必须提交优化前后视觉差异对比（PROMPT §10）。

---

## 8. 可复现性要求（PROMPT §13 / §3.5）
- 所有 bpy 脚本必须**可重复执行**（幂等，先清空/新建再构建）。
- 不得仅把关键模型保存在临时 Blender 会话中。
- `.blend` 源文件与 `.glb` **两者都必须保留**（GLB 不替代源文件）。