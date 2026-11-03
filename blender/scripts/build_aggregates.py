# -*- coding: utf-8 -*-
"""
build_aggregates.py — 生成规范要求的聚合 .blend 源文件
======================================================

PROMPT §3.5 建议按主题保存 .blend；本脚本在同一会话内组装并保存：
    Bridges.blend          （月亮桥 / 彩虹桥 / 拱桥 / 胶囊会议中心）
    Train.blend            （车头 + 车厢）
    Stations.blend         （主车站）
    LandscapeAssets.blend  （5 类树木 + 景观小件）

这些聚合文件与各资产独立 .blend 并存，均保留可编辑对象与修改器。

用法： blender --background --python blender/scripts/build_aggregates.py
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "lib"))

import bpy
from lqk_common import SOURCE_DIR
from lqk_kit import (reset_scene, setup_export_scene, setup_preview_lighting,
                     get_collection, save_blend, parent_to_root)
import lqk_assets as A


def aggregate(path, builders):
    reset_scene()
    setup_export_scene()
    coll = get_collection("LQK_Assets")
    for b in builders:
        data = b(coll)
        parent_to_root(data.get("objects", []), data.get("root"))
    setup_preview_lighting()
    save_blend(path)
    print(f"[AGG] {os.path.basename(path)}: {len([o for o in bpy.data.objects if o.type=='MESH'])} meshes, "
          f"{len(bpy.data.materials)} materials")


def main():
    aggregate(os.path.join(SOURCE_DIR, "Bridges.blend"),
              [A.build_landmark_arch_bridge, A.build_landmark_moon_bridge,
               A.build_landmark_rainbow_bridge, A.build_landmark_capsule_center])
    aggregate(os.path.join(SOURCE_DIR, "Train.blend"),
              [A.build_train_head, A.build_train_car_01])
    aggregate(os.path.join(SOURCE_DIR, "Stations.blend"),
              [A.build_station_main])
    aggregate(os.path.join(SOURCE_DIR, "LandscapeAssets.blend"),
              [A.build_environment_trees, A.build_environment_landscape])


if __name__ == "__main__":
    main()