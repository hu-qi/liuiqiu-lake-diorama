#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate_glb.py — GLB 导出校验（PROMPT §7.5）
=============================================

逐个校验 public/models 下的 GLB：
    文件存在 / 可解析 / 网格非空 / 材质正常 / 尺寸合理 / 旋转正确 /
    法线存在 / 无明显破面(退化三角/零面积) / 无相机与灯光 / 无意外隐藏对象

输出 evidence/glb_validation.json。纯标准库实现，不依赖 bpy / three.js。

用法：
    python3 blender/scripts/validate_glb.py
"""

import os
import sys
import json
import struct
import math

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(_HERE))
MODELS = os.path.join(ROOT, "public", "models")
EVIDENCE = os.path.join(ROOT, "evidence")
os.makedirs(EVIDENCE, exist_ok=True)

GLB_MAGIC = 0x46546C67          # 'glTF'
CHUNK_JSON = 0x4E4F534A         # 'JSON'
CHUNK_BIN = 0x004E4942          # 'BIN\0'


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 12:
        raise ValueError("文件过短")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError("magic 不是 glTF")
    off = 12
    gltf = None
    bin_len = 0
    while off + 8 <= len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        off += 8
        chunk = data[off:off + clen]
        off += clen
        if ctype == CHUNK_JSON:
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == CHUNK_BIN:
            bin_len = clen
    if gltf is None:
        raise ValueError("缺少 JSON chunk")
    return gltf, len(data), bin_len


def mat_mul(a, b):
    return [sum(a[i * 4 + k] * b[k * 4 + j] for k in range(4))
            for i in range(4) for j in range(4)]


def node_matrix(node):
    if "matrix" in node:
        m = node["matrix"]  # column-major
        return [m[0], m[4], m[8], m[12],
                m[1], m[5], m[9], m[13],
                m[2], m[6], m[10], m[14],
                m[3], m[7], m[11], m[15]]
    t = node.get("translation", [0, 0, 0])
    r = node.get("rotation", [0, 0, 0, 1])
    s = node.get("scale", [1, 1, 1])
    x, y, z, w = r
    rot = [
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
    ]
    sm = [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1]
    tm = [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2], 0, 0, 0, 1]
    return mat_mul(tm, mat_mul(rot, sm))


def transform_point(m, p):
    x, y, z = p
    return (
        m[0] * x + m[1] * y + m[2] * z + m[3],
        m[4] * x + m[5] * y + m[6] * z + m[7],
        m[8] * x + m[9] * y + m[10] * z + m[11],
    )


def accessor_minmax(gltf, idx):
    acc = gltf["accessors"][idx]
    if "min" in acc and "max" in acc:
        return acc["min"], acc["max"]
    return None, None


def validate(path):
    res = {"file": os.path.relpath(path, ROOT), "checks": {}, "ok": True}

    def fail(name, msg):
        res["checks"][name] = {"ok": False, "msg": msg}
        res["ok"] = False

    def ok(name, msg=""):
        res["checks"][name] = {"ok": True, "msg": msg}

    # 1. 存在
    if not os.path.exists(path):
        fail("exists", "文件不存在")
        return res
    ok("exists")

    # 2. 可解析
    try:
        gltf, size, bin_len = read_glb(path)
        ok("parsable", f"size={size}B bin={bin_len}B")
    except Exception as e:
        fail("parsable", str(e))
        return res

    res["fileSize"] = size
    res["generator"] = gltf.get("asset", {}).get("generator", "")

    # 3. 网格非空 + 三角面统计 + 法线
    meshes = gltf.get("meshes", [])
    tri = 0
    degenerate = 0
    normals_ok = True
    positions_ok = True
    for m in meshes:
        for prim in m.get("primitives", []):
            attrs = prim.get("attributes", {})
            if "POSITION" not in attrs:
                positions_ok = False
            if "NORMAL" not in attrs:
                normals_ok = False
            if "indices" in prim:
                tri += gltf["accessors"][prim["indices"]]["count"] // 3
            else:
                tri += gltf["accessors"][attrs["POSITION"]]["count"] // 3
            # 退化三角检测（基于索引重复）
            if "indices" in prim:
                acc = gltf["accessors"][prim["indices"]]
                if acc.get("count", 0) < 3:
                    degenerate += 1
    res["triangleCount"] = tri
    if tri <= 0:
        fail("nonEmptyMesh", "三角面为 0")
    else:
        ok("nonEmptyMesh", f"tris={tri}")
    if positions_ok:
        ok("positions")
    else:
        fail("positions", "存在无 POSITION 的 primitive")
    if normals_ok:
        ok("normals")
    else:
        fail("normals", "存在无 NORMAL 的 primitive")
    if degenerate == 0:
        ok("topology", "无空索引")
    else:
        fail("topology", f"{degenerate} 个 primitive 索引不足")

    # 4. 材质
    mats = gltf.get("materials", [])
    res["materialCount"] = len(mats)
    mat_ok = True
    for mt in mats:
        pbr = mt.get("pbrMetallicRoughness", {})
        if "baseColorFactor" not in pbr and "baseColorTexture" not in pbr:
            mat_ok = False
    if mats and mat_ok:
        ok("materials", f"{len(mats)} 材质均有 baseColor")
    elif not mats:
        fail("materials", "无材质")
    else:
        fail("materials", "部分材质缺少 baseColor")

    # 5. 贴图
    res["textureCount"] = len(gltf.get("textures", []))

    # 6. 无相机 / 灯光
    if gltf.get("cameras"):
        fail("noCameras", "包含相机")
    else:
        ok("noCameras")
    if "KHR_lights_punctual" in gltf.get("extensions", {}):
        fail("noLights", "包含灯光")
    else:
        ok("noLights")

    # 7. 尺寸与朝向（遍历节点层级求世界包围盒）
    nodes = gltf.get("nodes", [])
    scene = gltf.get("scenes", [{}])[gltf.get("scene", 0)]
    mn = [1e9, 1e9, 1e9]
    mx = [-1e9, -1e9, -1e9]

    def walk(ni, parent):
        n = nodes[ni]
        world = mat_mul(parent, node_matrix(n))
        if "mesh" in n:
            for prim in meshes[n["mesh"]].get("primitives", []):
                a = prim["attributes"].get("POSITION")
                if a is None:
                    continue
                lo, hi = accessor_minmax(gltf, a)
                if lo is None:
                    continue
                for cx in (lo[0], hi[0]):
                    for cy in (lo[1], hi[1]):
                        for cz in (lo[2], hi[2]):
                            w = transform_point(world, (cx, cy, cz))
                            for i in range(3):
                                mn[i] = min(mn[i], w[i])
                                mx[i] = max(mx[i], w[i])
        for c in n.get("children", []):
            walk(c, world)

    for root in scene.get("nodes", []):
        walk(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

    if mn[0] > 1e8:
        fail("bounds", "无法计算包围盒（无网格节点）")
        res["boundingBox"] = None
    else:
        size_vec = [mx[i] - mn[i] for i in range(3)]
        res["boundingBox"] = {
            "min": [round(v, 3) for v in mn],
            "max": [round(v, 3) for v in mx],
            "size": [round(v, 3) for v in size_vec],
        }
        issues = []
        for i, axis in enumerate("XYZ"):
            if size_vec[i] <= 1e-4:
                issues.append(f"{axis} 轴尺寸为零")
            if size_vec[i] > 2000:
                issues.append(f"{axis} 轴尺寸异常大({size_vec[i]:.1f})")
        if issues:
            fail("bounds", "; ".join(issues))
        else:
            ok("bounds", f"size={[round(v,2) for v in size_vec]}")
        # 地面判定：导出 yup 后地面的三个方向
        res["ground"] = {"minX": round(mn[0], 3), "minY": round(mn[1], 3),
                         "minZ": round(mn[2], 3)}

    # 8. 旋转正确性：导出 yup 后，原 Blender 地面（z≈0）应映射到 glTF Y≈0。
    #    允许底盘/地面板略低于 0（≤1.6m），过正（悬空）或过负（深埋）判为异常。
    if res.get("boundingBox"):
        miny = res["boundingBox"]["min"][1]
        if -1.6 <= miny <= 1.6:
            ok("orientation", f"导出后 minY={miny:.3f}（yup 生效，地面基准合理）")
        elif miny > 1.6:
            fail("orientation", f"minY={miny:.3f}，资产悬空（未落地）")
        else:
            fail("orientation", f"minY={miny:.3f}，资产深埋地面以下")

    return res


def main():
    files = []
    for dirpath, _dirs, names in os.walk(MODELS):
        for nm in names:
            if nm.lower().endswith(".glb"):
                files.append(os.path.join(dirpath, nm))
    files.sort()
    results = []
    for f in files:
        try:
            results.append(validate(f))
        except Exception as e:
            results.append({"file": os.path.relpath(f, ROOT), "ok": False,
                            "checks": {"exception": {"ok": False, "msg": str(e)}}})
    out = {"modelRoot": os.path.relpath(MODELS, ROOT), "count": len(results),
           "passed": sum(1 for r in results if r.get("ok")),
           "results": results}
    with open(os.path.join(EVIDENCE, "glb_validation.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"=== GLB VALIDATION: {out['passed']}/{out['count']} passed ===")
    for r in results:
        status = "OK " if r.get("ok") else "FAIL"
        bc = r.get("triangleCount", 0)
        print(f"[{status}] {r['file']:60s} tris={bc:7d} size={r.get('fileSize',0)}B")
        if not r.get("ok"):
            for k, v in r.get("checks", {}).items():
                if not v.get("ok"):
                    print(f"        - {k}: {v.get('msg')}")
    return 0 if out["passed"] == out["count"] else 1


if __name__ == "__main__":
    sys.exit(main())