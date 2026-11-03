#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_manifest.py — 生成 assets-manifest.json（PROMPT §7.6）
=============================================================

数据来源：
  - evidence/blender_asset_stats.jsonl   （Blender 构建统计，按 assetId 取最新）
  - evidence/glb_validation.json         （GLB 解析校验，作为权威尺寸/面数）
输出：
  <project>/assets-manifest.json

用法： python3 blender/scripts/generate_manifest.py
"""

import os
import json

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(_HERE))
EVIDENCE = os.path.join(ROOT, "evidence")

# GLB 基础名（= assetId，遵循 PROMPT §7.4 命名）-> (中文名, 片区/类型)
ASSET_META = {
    "DISTRICT_A_HILLTOP": ("山顶聚落 A 区", "A"),
    "DISTRICT_B_WATERTOWN": ("水镇 B 区", "B"),
    "DISTRICT_C_URBAN_AXIS": ("城市经典轴线 C 区", "C"),
    "DISTRICT_D_COLLEGE": ("城市大学院落 D 区", "D"),
    "DISTRICT_E_FOREST_TOWN": ("森林小镇 E 区", "E"),
    "DISTRICT_F_PLAZA_TOWN": ("广场/港湾小镇 F 区", "F"),
    "DISTRICT_G_URBAN_BLOCKS": ("城市街区 G 区", "G"),
    "DISTRICT_H_URBAN_AXIS": ("城市经典轴线 H 区", "H"),
    "LANDMARK_MOON_BRIDGE": ("月亮桥", "landmark"),
    "LANDMARK_RAINBOW_BRIDGE": ("彩虹桥", "landmark"),
    "LANDMARK_ARCH_BRIDGE": ("拱桥", "landmark"),
    "LANDMARK_CAPSULE_CENTER": ("湖景胶囊会议中心", "landmark"),
    "TRAIN_HEAD": ("园区小火车车头", "train"),
    "TRAIN_CAR_01": ("园区小火车车厢", "train"),
    "STATION_MAIN": ("主车站", "station"),
    "ENV_TREE_CLUSTER": ("环境树木合集(5类)", "environment"),
    "ENV_LANDSCAPE_ASSETS": ("环境景观小件合集", "environment"),
}

# 构建 key（stats 中的 assetId）-> GLB 基础名，用于对齐命名
KEY_TO_GLB = {
    "A_HILLTOP": "DISTRICT_A_HILLTOP",
    "B_WATERTOWN": "DISTRICT_B_WATERTOWN",
    "C_URBAN_AXIS": "DISTRICT_C_URBAN_AXIS",
    "D_COLLEGE": "DISTRICT_D_COLLEGE",
    "E_FOREST_TOWN": "DISTRICT_E_FOREST_TOWN",
    "F_PLAZA_TOWN": "DISTRICT_F_PLAZA_TOWN",
    "G_URBAN_BLOCKS": "DISTRICT_G_URBAN_BLOCKS",
    "H_URBAN_AXIS": "DISTRICT_H_URBAN_AXIS",
    "ARCH_BRIDGE": "LANDMARK_ARCH_BRIDGE",
    "MOON_BRIDGE": "LANDMARK_MOON_BRIDGE",
    "RAINBOW_BRIDGE": "LANDMARK_RAINBOW_BRIDGE",
    "CAPSULE_CENTER": "LANDMARK_CAPSULE_CENTER",
    "TRAIN_HEAD": "TRAIN_HEAD",
    "TRAIN_CAR_01": "TRAIN_CAR_01",
    "STATION_MAIN": "STATION_MAIN",
    "ENV_TREES": "ENV_TREE_CLUSTER",
    "ENV_LANDSCAPE": "ENV_LANDSCAPE_ASSETS",
}

# 构建脚本里的 key 与 assetId 的映射（key == assetId，除 ENV_* 由 blend 名区分）


def load_stats():
    path = os.path.join(EVIDENCE, "blender_asset_stats.jsonl")
    latest = {}
    if not os.path.exists(path):
        return latest
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            latest[rec["assetId"]] = rec
    return latest


def load_validation():
    path = os.path.join(EVIDENCE, "glb_validation.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for r in data.get("results", []):
        # 用 glb 文件名（不含扩展）反查 assetId
        base = os.path.splitext(os.path.basename(r["file"]))[0]
        out[base] = r
    return out


def main():
    stats = load_stats()
    valid = load_validation()

    entries = []
    for key, st in stats.items():
        asset_id = KEY_TO_GLB.get(key, key)
        name, district = ASSET_META.get(asset_id, (asset_id, "unknown"))
        glb_base = os.path.splitext(os.path.basename(st["glb"]))[0]
        v = valid.get(glb_base, {})
        entry = {
            "assetId": asset_id,
            "name": name,
            "district": district,
            "sourceBlend": st["blend"],
            "outputGLB": st["glb"],
            "boundingBox": v.get("boundingBox") or st.get("boundingBox"),
            "triangleCount": v.get("triangleCount", st.get("triangleCount", 0)),
            "materialCount": v.get("materialCount", st.get("materialCount", 0)),
            "textureCount": v.get("textureCount", 0),
            "fileSize": v.get("fileSize", st.get("fileSize", 0)),
            "sourceReferences": st.get("sourceReferences", []),
            "fidelityLevel": st.get("fidelityLevel", "L2"),
            "verified": bool(v.get("ok", False)),
            "renderPreviews": st.get("renders", []),
            "note": st.get("note", ""),
        }
        entries.append(entry)

    entries.sort(key=lambda e: (e["district"], e["assetId"]))
    manifest = {
        "project": "Huawei Lianqiu Lake Digital Diorama",
        "version": "1.0",
        "generatedBy": "blender/scripts/generate_manifest.py",
        "assetCount": len(entries),
        "verifiedCount": sum(1 for e in entries if e["verified"]),
        "assets": entries,
    }
    out_path = os.path.join(ROOT, "assets-manifest.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Wrote {out_path}")
    print(f"assets={manifest['assetCount']} verified={manifest['verifiedCount']}")
    for e in entries:
        print(f"  {e['assetId']:26s} {e['fidelityLevel']:3s} tris={e['triangleCount']:7d} "
              f"verified={e['verified']}")


if __name__ == "__main__":
    main()