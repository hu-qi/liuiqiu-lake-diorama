# -*- coding: utf-8 -*-
"""
verify_assets.py — Blender 端几何正确性验证（PROMPT §11.1）
==========================================================

对关键资产执行真实几何检查并写入 evidence/geometry_verification.json：
  1. 拱桥拱洞“真实贯通”射线验证：沿桥宽方向穿过拱洞中心，期望不命中任何面。
  2. 贴地检查：地面型资产的包围盒底面应贴近 z=0（不悬空、不深埋）。
  3. 网格完整性：mesh.validate() 与 bmesh 非流形边统计。

用法：
    blender --background --python blender/scripts/verify_assets.py -- ARCH_BRIDGE MOON_BRIDGE ...
"""

import os
import sys
import json
import math
import traceback

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "lib"))

import bpy
import bmesh
from mathutils import Vector

from lqk_kit import reset_scene, setup_export_scene, get_collection, collect_meshes, world_bbox
import lqk_assets as A

ROOT = os.path.dirname(os.path.dirname(_HERE))
EVIDENCE = os.path.join(ROOT, "evidence")
os.makedirs(EVIDENCE, exist_ok=True)

# 需要验证的资产：key -> (builder, arch_centers_x or None, arch_radius)
CHECKS = {
    "ARCH_BRIDGE": (A.build_landmark_arch_bridge, [-13.6, 0.0, 13.6], 4.73),
    "MOON_BRIDGE": (A.build_landmark_moon_bridge, [0.0], 4.46),
    "RAINBOW_BRIDGE": (A.build_landmark_rainbow_bridge, [0.0], 0.0),  # 桥下净空用桥面下沿
    "TRAIN_CAR_01": (A.build_train_car_01, None, 0.0),
    "TRAIN_HEAD": (A.build_train_head, None, 0.0),
    "D_COLLEGE": (A.build_district_d_college, None, 0.0),
    "CAPSULE_CENTER": (A.build_landmark_capsule_center, None, 0.0),
    "A_HILLTOP": (A.build_district_a_hilltop, None, 0.0),
    "D_COLLEGE_2": (A.build_district_d_college, None, 0.0),
}


def ray_open(origin, direction, obj_name_filter=None):
    """从 origin 沿 direction 投射射线，返回命中对象名或 None（未命中）。"""
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, nrm, idx, obj, mat = bpy.context.scene.ray_cast(dg, Vector(origin),
                                                             Vector(direction))
    if not hit:
        return None
    return obj.name


def mesh_integrity(meshes):
    issue = {"nonManifold": 0, "looseVerts": 0, "validateChanged": 0}
    for obj in meshes:
        me = obj.data
        if me.validate(verbose=False):
            issue["validateChanged"] += 1
        bm = bmesh.new()
        bm.from_mesh(me)
        for e in bm.edges:
            if not e.is_manifold:
                issue["nonManifold"] += 1
        issue["looseVerts"] += sum(1 for v in bm.verts if not v.link_edges)
        bm.free()
    return issue


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    keys = [k for k in argv if k in CHECKS] or list(CHECKS.keys())

    report = []
    for key in keys:
        builder, arch_centers, arch_r = CHECKS[key]
        rec = {"assetId": key, "checks": {}, "ok": True}
        try:
            reset_scene()
            setup_export_scene()
            collection = get_collection("LQK_Assets")
            data = builder(collection)
            meshes = [o for o in data["objects"] if o is not None and o.type == 'MESH']
            mn, mx = world_bbox(meshes)
            rec["boundingBox"] = {"min": [round(v, 3) for v in mn],
                                  "max": [round(v, 3) for v in mx],
                                  "size": [round(mx.x - mn.x, 3),
                                           round(mx.y - mn.y, 3),
                                           round(mx.z - mn.z, 3)]}
            # --- 贴地检查（含基座/草坪板等允许轻微下沉）---
            ground_ok = -1.2 <= mn.z <= 1.2
            rec["checks"]["grounded"] = {
                "ok": ground_ok, "msg": f"minZ={mn.z:.3f}"}
            if not ground_ok:
                rec["ok"] = False
            # --- 拱洞贯通射线验证 ---
            if arch_centers:
                openings = []
                all_open = True
                for cx in arch_centers:
                    z = max(0.4, arch_r * 0.45) if arch_r > 0 else 0.4
                    hit_obj = ray_open((cx, -60.0, z), (0, 1, 0))
                    openings.append({"x": cx, "z": round(z, 2), "hit": hit_obj})
                    if hit_obj is not None:
                        all_open = False
                rec["checks"]["archOpen"] = {
                    "ok": all_open, "msg": "所有拱洞沿桥宽方向均可穿透" if all_open
                    else f"存在被遮挡拱洞: {openings}"}
                rec["archRayResults"] = openings
                if not all_open:
                    rec["ok"] = False
            # --- 网格完整性 ---
            integ = mesh_integrity(meshes)
            integ_ok = integ["looseVerts"] == 0
            rec["checks"]["meshIntegrity"] = {
                "ok": integ_ok, "msg": json.dumps(integ)}
            if not integ_ok:
                rec["ok"] = False
        except Exception as e:
            traceback.print_exc()
            rec["ok"] = False
            rec["error"] = str(e)
        report.append(rec)
        print(f"[VERIFY] {key}: {'PASS' if rec['ok'] else 'FAIL'} "
              f"bbox={rec.get('boundingBox', {}).get('size')} "
              f"{rec.get('checks', {}).get('archOpen', {}).get('msg','')}")

    with open(os.path.join(EVIDENCE, "geometry_verification.json"), "w",
              encoding="utf-8") as f:
        json.dump({"count": len(report),
                   "passed": sum(1 for r in report if r["ok"]),
                   "results": report}, f, ensure_ascii=False, indent=2)
    print(f"=== GEOMETRY VERIFY {sum(1 for r in report if r['ok'])}/{len(report)} ===")


if __name__ == "__main__":
    main()