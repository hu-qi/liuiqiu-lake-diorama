# -*- coding: utf-8 -*-
"""
build_assets.py — 练秋湖数字沙盘 资产构建入口
==============================================

用法：
    blender --background --python blender/scripts/build_assets.py -- [KEY ...]

不带 KEY 时构建全部资产。KEY 见 REGISTRY。每个资产独立 .blend + GLB + 多角度渲染。
"""

import os
import sys
import traceback

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "lib"))

from lqk_common import emit_asset   # noqa: E402
import lqk_assets as A              # noqa: E402


# key -> (builder, group, blend_file, glb_file, fidelity, references)
REGISTRY = {
    # ---- A–H 八组团 ----
    "A_HILLTOP":     (A.build_district_a_hilltop, "districts", "A_Hilltop.blend", "DISTRICT_A_HILLTOP.glb", "L3", ["references/site-plan"]),
    "B_WATERTOWN":   (A.build_district_b_watertown, "districts", "B_Watertown.blend", "DISTRICT_B_WATERTOWN.glb", "L3", ["references/site-plan"]),
    "C_URBAN_AXIS":  (A.build_district_c_urban_axis, "districts", "C_UrbanAxis.blend", "DISTRICT_C_URBAN_AXIS.glb", "L3", ["references/architecture"]),
    "D_COLLEGE":     (A.build_district_d_college, "districts", "D_College.blend", "DISTRICT_D_COLLEGE.glb", "L3", ["references/architecture"]),
    "E_FOREST_TOWN": (A.build_district_e_forest_town, "districts", "E_ForestTown.blend", "DISTRICT_E_FOREST_TOWN.glb", "L3", ["references/landscape"]),
    "F_PLAZA_TOWN":  (A.build_district_f_plaza_town, "districts", "F_PlazaTown.blend", "DISTRICT_F_PLAZA_TOWN.glb", "L3", ["references/landscape"]),
    "G_URBAN_BLOCKS": (A.build_district_g_urban_blocks, "districts", "G_UrbanBlocks.blend", "DISTRICT_G_URBAN_BLOCKS.glb", "L3", ["references/architecture"]),
    "H_URBAN_AXIS":  (A.build_district_h_urban_axis, "districts", "H_UrbanAxis.blend", "DISTRICT_H_URBAN_AXIS.glb", "L3", ["references/architecture"]),
    # ---- 地标 ----
    "ARCH_BRIDGE":   (A.build_landmark_arch_bridge, "bridges", "LANDMARK_ARCH_BRIDGE.blend", "LANDMARK_ARCH_BRIDGE.glb", "L3", ["references/bridges"]),
    "MOON_BRIDGE":   (A.build_landmark_moon_bridge, "bridges", "LANDMARK_MOON_BRIDGE.blend", "LANDMARK_MOON_BRIDGE.glb", "L3", ["references/bridges"]),
    "RAINBOW_BRIDGE": (A.build_landmark_rainbow_bridge, "bridges", "LANDMARK_RAINBOW_BRIDGE.blend", "LANDMARK_RAINBOW_BRIDGE.glb", "L3", ["references/bridges"]),
    "CAPSULE_CENTER": (A.build_landmark_capsule_center, "bridges", "LANDMARK_CAPSULE_CENTER.blend", "LANDMARK_CAPSULE_CENTER.glb", "L3", ["references/architecture"]),
    # ---- 交通 ----
    "TRAIN_HEAD":    (A.build_train_head, "trains", "TRAIN_HEAD.blend", "TRAIN_HEAD.glb", "L3", ["references/train"]),
    "TRAIN_CAR_01":  (A.build_train_car_01, "trains", "TRAIN_CAR_01.blend", "TRAIN_CAR_01.glb", "L3", ["references/train"]),
    "STATION_MAIN":  (A.build_station_main, "stations", "STATION_MAIN.blend", "STATION_MAIN.glb", "L3", ["references/train"]),
    # ---- 环境 ----
    "ENV_TREES":     (A.build_environment_trees, "environment", "EnvTrees.blend", "ENV_TREE_CLUSTER.glb", "L2", ["references/landscape"]),
    "ENV_LANDSCAPE": (A.build_environment_landscape, "environment", "LandscapeAssets.blend", "ENV_LANDSCAPE_ASSETS.glb", "L2", ["references/landscape"]),
}

PHASE1 = ["D_COLLEGE", "ARCH_BRIDGE", "TRAIN_CAR_01"]


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    keys = [k for k in argv if k in REGISTRY]
    if not keys:
        keys = list(REGISTRY.keys())

    summary = []
    for key in keys:
        builder, group, blend, glb, fid, refs = REGISTRY[key]
        try:
            stats = emit_asset(key, builder, group, blend_file=blend, glb_file=glb,
                               fidelity=fid, references=refs)
            summary.append((key, "OK", stats["triangleCount"], stats["fileSize"]))
        except Exception as e:  # 单个资产失败不影响其余
            traceback.print_exc()
            summary.append((key, "FAIL: %s" % e, 0, 0))

    print("\n================ BUILD SUMMARY ================")
    for key, st, tris, size in summary:
        print(f"{key:16s} {st:40s} tris={tris:7d} size={size}")
    print(f"BUILD {sum(1 for s in summary if s[1]=='OK')}/{len(summary)}")


if __name__ == "__main__":
    main()