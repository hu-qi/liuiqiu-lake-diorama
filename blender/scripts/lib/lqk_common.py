# -*- coding: utf-8 -*-
"""
lqk_common.py — 构建脚本公共引导层
==================================

统一处理：sys.path 注入、目录常量、资产出图/保存/导出的标准流程，
让各个 build_*.py 只关心“如何建模”。

用法（在 build_*.py 顶部）：

    import os, sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
    from lqk_common import emit_asset, ROOT, SOURCE_DIR, EXPORT_DIR, RENDERS_DIR, MODELS_DIR
"""

import os
import sys
import json
import math

_HERE = os.path.dirname(os.path.abspath(__file__))
_LIB = os.path.join(_HERE, "lib")
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)

# 项目根：lib -> scripts -> blender -> ROOT（lib 位于 ROOT/blender/scripts/lib）
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))
SOURCE_DIR = os.path.join(ROOT, "blender", "source")
EXPORT_DIR = os.path.join(ROOT, "blender", "export")
RENDERS_DIR = os.path.join(ROOT, "blender", "renders")
MODELS_DIR = os.path.join(ROOT, "public", "models")
EVIDENCE_DIR = os.path.join(ROOT, "evidence")

import bpy
from lqk_kit import (
    reset_scene, setup_export_scene, setup_preview_lighting, export_glb,
    save_blend, render_views, collect_meshes, world_bbox, count_triangles,
    parent_to_root, mat_palette, get_collection, link_object, make_root,
)

for _d in (SOURCE_DIR, EXPORT_DIR, RENDERS_DIR, MODELS_DIR, EVIDENCE_DIR):
    os.makedirs(_d, exist_ok=True)

# 每个资产的统计输出会追加到这里，供 generate_manifest.py 汇总
STATS_FILE = os.path.join(EVIDENCE_DIR, "blender_asset_stats.jsonl")


def _ensure_group_dir(group):
    d = os.path.join(MODELS_DIR, group)
    os.makedirs(d, exist_ok=True)
    return d


def emit_asset(asset_id, builder, group, blend_file=None, glb_file=None,
               fidelity="L3", views=("front", "side", "top", "three_quarter"),
               do_render=True, render_res=(900, 700), samples=32,
               references=None, note=""):
    """构建单个资产：建模 → 预览光照 → 保存 .blend → 导出 GLB → 多角度渲染。

    builder: 无参函数，返回 {"root": obj, "objects": [obj,...], "meta": {...}}
    返回统计数据 dict。
    """
    reset_scene()
    setup_export_scene()
    collection = get_collection("LQK_Assets")

    data = builder(collection)
    root = data.get("root")
    objs = data.get("objects", [])
    meta = data.get("meta", {})

    # 统一挂到根锚点
    if root is not None:
        link_object(root, collection)
        parent_to_root(objs, root)

    # 预览光照（保证 .blend 直接可渲染）
    setup_preview_lighting()

    blend_file = blend_file or f"{asset_id}.blend"
    blend_path = os.path.join(SOURCE_DIR, blend_file)
    save_blend(blend_path)

    glb_file = glb_file or f"{asset_id}.glb"
    group_dir = _ensure_group_dir(group)
    glb_path = os.path.join(group_dir, glb_file)

    sel = ([root] if root is not None else []) + collect_meshes(root)
    export_glb(glb_path, objs=sel, apply_modifiers=True)
    # 同步一份到 blender/export/
    export_glb(os.path.join(EXPORT_DIR, os.path.basename(glb_file)), objs=sel,
               apply_modifiers=True)

    renders = []
    if do_render:
        prefix = os.path.join(RENDERS_DIR, asset_id)
        renders = render_views(prefix, collect_meshes(root) or objs, views=views,
                               resolution=render_res, samples=samples)
        # 建筑立面聚焦图（放大建筑主体，便于核验门窗细节）
        focus = data.get("focus")
        if focus:
            focus = [o for o in focus if o is not None and o.type == 'MESH']
            if focus:
                renders += render_views(os.path.join(RENDERS_DIR, asset_id + "_focus"),
                                        focus, views=("three_quarter", "front"),
                                        resolution=render_res, samples=samples,
                                        ground_shadow=False)

    meshes = collect_meshes(root)
    mn, mx = world_bbox(meshes)
    stats = {
        "assetId": asset_id,
        "group": group,
        "blend": os.path.relpath(blend_path, ROOT),
        "glb": os.path.relpath(glb_path, ROOT),
        "glbExportCopy": os.path.relpath(os.path.join(EXPORT_DIR, os.path.basename(glb_file)), ROOT),
        "renders": [os.path.relpath(p, ROOT) for p in renders],
        "meshObjects": len(meshes),
        "triangleCount": count_triangles(meshes),
        "materialCount": len({m.name for o in meshes for m in o.data.materials if m}),
        "fileSize": os.path.getsize(glb_path) if os.path.exists(glb_path) else 0,
        "boundingBox": {
            "min": [round(mn.x, 3), round(mn.y, 3), round(mn.z, 3)],
            "max": [round(mx.x, 3), round(mx.y, 3), round(mx.z, 3)],
            "size": [round(mx.x - mn.x, 3), round(mx.y - mn.y, 3), round(mx.z - mn.z, 3)],
        },
        "fidelityLevel": fidelity,
        "sourceReferences": references or [],
        "note": note or data.get("note", ""),
    }
    with open(STATS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(stats, ensure_ascii=False) + "\n")
    print(f"[EMIT] {asset_id}: tris={stats['triangleCount']} mats={stats['materialCount']} "
          f"size={stats['fileSize']}B bbox={stats['boundingBox']['size']} renders={len(renders)}")
    return stats


def transform_group(objs, location=(0, 0, 0), rotation_z=0.0):
    """对一组对象整体做平移/绕 Z 旋转（就地）。"""
    from mathutils import Matrix, Vector, Euler
    mat = (Matrix.Translation(Vector(location))
           @ Matrix.Rotation(rotation_z, 4, 'Z'))
    for o in objs:
        o.matrix_world = mat @ o.matrix_world
    return objs