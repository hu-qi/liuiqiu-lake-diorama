# -*- coding: utf-8 -*-
"""smoke_test.py — 对 lqk_build 全部构件函数做无头运行冒烟测试。

运行： blender --background --python blender/scripts/smoke_test.py
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

import bpy
from lqk_kit import reset_scene, mat_palette, count_triangles, collect_meshes, world_bbox
import lqk_build as B

reset_scene()
pal = mat_palette()
C = None

results = []

def check(name, fn):
    try:
        objs = fn()
        if objs is None:
            raise RuntimeError("返回 None")
        if not isinstance(objs, (list, tuple)):
            objs = [objs]
        tris = count_triangles([o for o in objs if o is not None and o.type == 'MESH'])
        results.append((name, "OK", len(objs), tris))
    except Exception as e:
        results.append((name, "FAIL: %s" % e, 0, 0))
        traceback.print_exc()

check("window_module", lambda: list(B.create_window_module(frame_mat=pal["metal"], glass_mat=pal["glass"]).values()))
check("facade", lambda: list(B.create_facade(length=24, height=12, floors=3, wall_mat=pal["plaster"], frame_mat=pal["metal"], glass_mat=pal["glass"], trim_mat=pal["stone_light"]).values()))
check("facade_arcade", lambda: list(B.create_facade(length=18, height=10, floors=2, wall_mat=pal["brick"], frame_mat=pal["metal"], glass_mat=pal["glass"], arcade=True).values()))
check("door_portal", lambda: B.create_door_portal(mat=pal["wood"], glass_mat=pal["glass_dark"]))
check("building_mass", lambda: list(B.create_building_mass(30, 14, 12, 3, wall_mat=pal["plaster"], plinth_mat=pal["stone_light"])))
check("pitched_roof", lambda: B.create_pitched_roof(30, 14, 4.5, mat=pal["tile_roof"]))
check("mansard_roof", lambda: B.create_mansard_roof(30, 16, mat=pal["tile_roof_grey"], dormers=3))
check("dormer", lambda: B.create_dormer(mat=pal["tile_roof"], window_mat=pal["glass"]))
check("clock_tower", lambda: B.create_clock_tower(size=5, height=26, mat=pal["stone_light"], trim_mat=pal["stone_mid"], roof_mat=pal["tile_roof_grey"], gold_mat=pal["gold"], clock_glass_mat=pal["glass_dark"]))
check("colonnade", lambda: B.create_colonnade(length=20, height=5, columns=8, mat=pal["stone_light"], arch=True))
check("steps", lambda: B.create_steps(width=4, steps=4, mat=pal["stone_mid"]))
check("terrace", lambda: B.create_terrace_platform(40, 26, 8, 4, mat=pal["lawn"], wall_mat=pal["stone_mid"]))
check("courtyard", lambda: B.create_courtyard(40, 30, mat=pal["stone_light"], lawn_mat=pal["lawn"], paving_mat=pal["paving"]))
check("arch_bridge", lambda: B.create_arch_bridge(spans=3, span=10, pier=2.4, width=6, mat=pal["water_stone"], deck_mat=pal["stone_light"], rail_mat=pal["metal"]))
check("moon_bridge", lambda: B.create_moon_bridge(span=16, rise=5, width=5, mat=pal["water_stone"], deck_mat=pal["paving"], rail_mat=pal["metal"]))
check("rainbow_bridge", lambda: B.create_rainbow_bridge(span=22, rise=6, width=9, mat=pal["stone_light"], deck_mat=pal["paving"], rail_mat=pal["metal"]))
check("capsule_center", lambda: B.create_capsule_center(54, 20, 10, mat=pal["capsule_shell"], glass_mat=pal["glass"], frame_mat=pal["capsule_frame"], platform_mat=pal["concrete"]))
check("train_car", lambda: B.create_train_car(length=15, width=2.9, height=3.4, is_head=False, body_mat=pal["train_body"], accent_mat=pal["train_accent"], dark_mat=pal["train_dark"], glass_mat=pal["glass_dark"])[0])
check("train_head", lambda: B.create_train_car(length=16, width=2.9, height=3.4, is_head=True, body_mat=pal["train_body"], accent_mat=pal["train_accent"], dark_mat=pal["train_dark"], glass_mat=pal["glass_dark"], name="TRAIN_HEAD")[0])
check("station", lambda: B.create_station(40, 9, mat=pal["platform"], roof_mat=pal["canopy"], column_mat=pal["metal"], bench_mat=pal["wood"]))
check("terrain", lambda: B.create_terrain(120, 90, 12, 40, seed=7, mat=pal["lawn"]))
check("tree_broad", lambda: B.create_tree("broad", 1.2, seed=3, trunk_mat=pal["bark"], leaf_mat=pal["foliage_a"], leaf_mat2=pal["foliage_b"]))
check("tree_conifer", lambda: B.create_tree("conifer", 1.0, seed=4, trunk_mat=pal["bark"], leaf_mat=pal["foliage_c"]))
check("tree_cluster", lambda: B.create_tree_cluster(area=(30, 20), count=12, seed=11, trunk_mat=pal["bark"], leaf_mats=[pal["foliage_a"], pal["foliage_b"], pal["foliage_c"], pal["foliage_aut"], pal["blossom"]]))
check("flower_bed", lambda: B.create_flower_bed(size=(6, 3), mat=pal["stone_mid"], flower_mat=pal["blossom"], seed=5))

print("\n================ SMOKE TEST SUMMARY ================")
ok = 0
for name, st, n, tris in results:
    print(f"{name:16s} {st:12s} objs={n:3d} tris={tris}")
    if st == "OK":
        ok += 1
print(f"PASS {ok}/{len(results)}")