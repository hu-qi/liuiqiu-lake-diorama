# -*- coding: utf-8 -*-
"""
lqk_assets.py — 练秋湖数字沙盘 资产组装层
===========================================

把 lqk_build 的构件函数组合为完整的“组团 / 地标 / 列车 / 车站 / 环境”资产。
每个 build_* 函数返回 {"root": 根锚点, "objects": [...], "meta": {...}}。

八组团 A–H 的空间语义严格对应 PROMPT §2 / §4：
    A 山顶聚落   B 水镇   C/H 城市经典轴线   D 城市大学院落
    E 森林小镇   F 广场小镇(港湾)   G 城市街区
"""

import bpy
import math
import random
from mathutils import Vector, Euler, Matrix

from lqk_kit import (mat_palette, make_root, box, cylinder, sphere, add_bevel,
                     create_railing, create_hedge, create_lamp, pbr)
from lqk_build import (
    MeshBuilder, create_facade, create_door_portal, create_building_mass,
    create_pitched_roof, create_mansard_roof, create_dormer, create_clock_tower,
    create_colonnade, create_steps, create_terrace_platform, create_courtyard,
    create_arch_bridge, create_moon_bridge, create_rainbow_bridge,
    create_capsule_center, create_train_car, create_station, create_terrain,
    create_tree, create_tree_cluster, create_flower_bed,
    create_terraced_hill, create_water_shore, create_ramp,
)

_PAL = None


def pal():
    """返回统一调色板。

    注意：不跨 reset_scene 缓存 Material 引用（reset 会清除无用户数据块），
    每次重新取用同名材质（pbr 内部按名复用，不会产生重复材质）。
    """
    global _PAL
    return mat_palette()


def clear_pal_cache():
    global _PAL
    _PAL = None


def _place(objs, loc=(0, 0, 0), rz=0.0):
    mat = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rz, 4, 'Z')
    for o in objs:
        if o is None:
            continue
        o.matrix_world = mat @ o.matrix_world
    return objs


def add_facades(collection, L, W, H, floors, fh, arcade_front=False,
                wall_mat=None, win_w=1.1, win_h=1.7, gap=0.85):
    """在四面墙体上叠加立面（窗框/玻璃/线脚），必要时正立面为拱廊。"""
    P = pal()
    wall_mat = wall_mat or P["plaster"]
    objs = []
    specs = [
        ((0, -W / 2.0, 0), 0.0, L, arcade_front),
        ((0, W / 2.0, 0), math.pi, L, False),
        ((-L / 2.0, 0, 0), -math.pi / 2.0, W, False),
        ((L / 2.0, 0, 0), math.pi / 2.0, W, False),
    ]
    for (loc, rz, ln, arc) in specs:
        fc = create_facade(
            length=ln, height=H, floors=floors, floor_height=fh,
            window_w=win_w, window_h=win_h, window_gap_x=gap,
            wall_mat=wall_mat, frame_mat=P["stone_light"], glass_mat=P["window"],
            trim_mat=P["stone_light"], arcade=arc, collection=collection,
            include_wall=False)
        for o in fc.values():
            if o is None:
                continue
            o.rotation_euler.z = rz
            o.location.x += loc[0]
            o.location.y += loc[1]
            o.location.z += loc[2]
            objs.append(o)
    return objs


def generic_building(collection, L, W, floors, fh=3.6, roof="pitched",
                     wall_mat=None, roof_mat=None, arcade_front=False,
                     entrance=True, dormers=0, seed=0, shape="rect",
                     roof_height=None, win_w=1.1, win_h=1.7, remark=None):
    """通用建筑：体量 + 四面立面 + 屋顶(flat/pitched/mansard/pyramid) + 入口。

    返回 (objects, meta)。面料与几何均参数化，保证 A–H 各栋比例一致。
    """
    P = pal()
    wall_mat = wall_mat or P["plaster"]
    roof_mat = roof_mat or P["tile_roof"]
    H = floors * fh
    objs = []
    mass, plinth = create_building_mass(L, W, H, floors, floor_height=fh,
                                        wall_mat=wall_mat,
                                        plinth_mat=P["stone_light"],
                                        collection=collection, shape=shape)
    objs.append(mass)
    if plinth:
        objs.append(plinth)
    objs.extend(add_facades(collection, L, W, H, floors, fh, arcade_front, wall_mat,
                            win_w, win_h))
    rh = roof_height if roof_height is not None else max(2.6, W * 0.24)
    if roof == "pitched":
        r = create_pitched_roof(L, W, rh, overhang=0.7, thickness=0.32,
                                mat=roof_mat, collection=collection)
        r.location.z += H
        objs.append(r)
    elif roof == "mansard":
        for r in create_mansard_roof(L, W, steep_height=rh * 0.65,
                                     top_height=rh * 0.35, mat=roof_mat,
                                     dormers=dormers, seed=seed, collection=collection):
            r.location.z += H
            objs.append(r)
    elif roof == "pyramid":
        mb = MeshBuilder("Roof_Pyramid", mat=roof_mat, collection=collection)
        mb.add_cylinder(max(L, W) * 0.78, rh, loc=(0, 0, H + rh / 2.0), verts=4,
                        radius2=0.0, rot=(0, 0, math.pi / 4))
        objs.append(mb.build())
    elif roof == "hip":
        r = create_pitched_roof(L, W, rh * 0.8, overhang=0.7, thickness=0.3,
                                mat=roof_mat, collection=collection)
        r.location.z += H
        objs.append(r)
        mb = MeshBuilder("Roof_HipEnd", mat=roof_mat, collection=collection)
        mb.add_cylinder(max(L, W) * 0.6, rh * 0.6, loc=(0, 0, H + rh * 0.6 / 2.0),
                        verts=4, radius2=0.15, rot=(0, 0, math.pi / 4))
        objs.append(mb.build())
    else:  # flat：女儿墙 + 顶部设备
        mb = MeshBuilder("Roof_Flat", mat=P["concrete"], collection=collection)
        mb.add_box((L + 0.3, W + 0.3, 0.5), (0, 0, H + 0.25))
        mb.add_box((L * 0.4, W * 0.4, 0.9), (0, 0, H + 0.7))
        mb.add_box((L * 0.2, W * 0.25, 1.6), (L * 0.2, 0, H + 1.1))
        objs.append(mb.build())
    if entrance:
        for o in create_door_portal(mat=P["wood"], glass_mat=P["glass_dark"],
                                    collection=collection):
            o.location.y += -W / 2.0 - 0.08
            objs.append(o)
    meta = {"floors": floors, "floorHeight": fh, "roof": roof,
            "footprint": [L, W], "remark": remark}
    return objs, meta


# =====================================================================
# A 区：山顶聚落
# =====================================================================

def _tier_top_at(x, y, origin, tier_tops):
    """返回给定世界 (x,y) 处的台地顶面高度（高层优先命中），否则 0（基座草坪）。"""
    ox, oy = origin
    for (z, hl, hw) in reversed(tier_tops):
        if abs(x - ox) <= hl + 0.25 and abs(y - oy) <= hw + 0.25:
            return z
    return 0.0


def _ramp_walk(name, p0, p1, width, mat, collection, thick=0.16):
    """生成一段两端标高自适应的斜板步道/坡道（贴合相邻台地顶面）。"""
    v0 = Vector(p0)
    v1 = Vector(p1)
    d = v1 - v0
    if d.length < 1e-6:
        return None
    d.normalize()
    side = Vector((-d.y, d.x, 0.0))
    if side.length < 1e-6:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    n = side.cross(d)
    n.normalize()
    hw = width / 2.0

    def ring(base):
        return [tuple(base + side * hw),
                tuple(base - side * hw),
                tuple(base - side * hw + n * thick),
                tuple(base + side * hw + n * thick)]

    mb = MeshBuilder(name, mat=mat, collection=collection)
    mb.add_loft([ring(v0), ring(v1)])
    return mb.build()


def build_district_a_hilltop(collection):
    P = pal()
    root = make_root("DISTRICT_A_HILLTOP")
    objs = []

    # ---- 基座草坪（顶面 z=0 作为绝对地面基准）----
    base = MeshBuilder("A_Base", mat=P["lawn"], collection=collection)
    base.add_box((112, 92, 0.5), (0, 0, -0.25))
    objs.append(base.build())

    # ---- 层级台地山体（“山顶”载体，实体天然落地）----
    hill_origin = (-8.0, 6.0)
    hill_objs, tier_tops = create_terraced_hill(
        length=88.0, width=66.0, tiers=4, rise=12.0, slope_ratio=0.72,
        wall_mat=P["stone_mid"], top_mat=P["lawn"], collection=collection, name="A_Hill")
    _place(hill_objs, loc=(hill_origin[0], hill_origin[1], 0))
    objs.extend(hill_objs)

    def zt(x, y):
        return _tier_top_at(x, y, hill_origin, tier_tops)

    # ---- 建筑群：顺应台地、全部落地，且带成排窗框/门厅/檐口/台阶 ----
    buildings = [
        (-5, 1, 24, 14, 4, 0.00, "pitched", P["plaster"]),        # 顶层主体（4 层，立面更完整）
        (-20, 14, 18, 12, 3, 0.10, "pitched", P["stone_light"]),  # 第 2 层
        (4, -4, 18, 12, 3, -0.15, "hip", P["brick"]),             # 第 2 层
        (-28, -10, 20, 13, 3, 0.05, "pitched", P["plaster"]),     # 第 1 层
        (14, 16, 20, 13, 2, -0.08, "pitched", P["stone_light"]),  # 第 1 层
        (-40, 24, 20, 12, 2, 0.00, "pitched", P["brick"]),        # 底层
        (26, -18, 18, 12, 1, 0.00, "pitched", P["wood"]),         # 底层（临湖）
    ]
    for (x, y, L, W, fl, rz, roof, wall) in buildings:
        b, _ = generic_building(collection, L, W, fl, fh=3.7, roof=roof,
                                wall_mat=wall, roof_mat=P["tile_roof"],
                                entrance=True, roof_height=max(2.6, W * 0.24),
                                win_w=1.8, win_h=2.8, seed=int(x + y * 7))
        _place(b, loc=(x, y, zt(x, y)), rz=rz)
        objs.extend(b)

    # ---- 制高点塔楼（高宽比 ≈3.5:1，收分/窗/檐口/尖顶）----
    tower_objs = create_clock_tower(size=6.5, height=23.0, mat=P["stone_light"],
                                    trim_mat=P["stone_mid"], roof_mat=P["tile_roof_grey"],
                                    gold_mat=P["gold"], clock_glass_mat=P["window"],
                                    collection=collection)
    _place(tower_objs, loc=(-18, 12, zt(-18, 12)))
    objs.extend(tower_objs)

    # ---- 铺装步道（沿台地顶面爬升，自动贴合标高）----
    walk_pts = [(-40, 32), (-24, 22), (-8, 14), (0, 2), (12, -8), (26, -18)]
    for i in range(len(walk_pts) - 1):
        (x0, y0), (x1, y1) = walk_pts[i], walk_pts[i + 1]
        seg = _ramp_walk(f"A_Walk_{i}", (x0, y0, zt(x0, y0) + 0.10),
                         (x1, y1, zt(x1, y1) + 0.10), 2.6, P["paving"], collection)
        if seg:
            objs.append(seg)
    # 台地之间的坡道（南侧）
    for i, (x0, y0, x1, y1) in enumerate([(-8, -32, -8, -22), (-8, -22, -20, -16)]):
        seg = _ramp_walk(f"A_Slope_{i}", (x0, y0, zt(x0, y0) + 0.12),
                         (x1, y1, zt(x1, y1) + 0.12), 3.2, P["paving"], collection)
        if seg:
            objs.append(seg)

    # ---- 临湖观景平台（悬挑）+ 栏杆 + 台阶 ----
    deck_z = zt(24, -20)
    deck = MeshBuilder("A_ViewDeck", mat=P["paving"], collection=collection)
    deck.add_box((18, 11, 0.5), (24, -20, deck_z + 0.25))
    deck.add_box((0.7, 0.7, deck_z), (16, -20, deck_z / 2.0))     # 悬挑支承
    deck.add_box((0.7, 0.7, deck_z), (32, -20, deck_z / 2.0))
    objs.append(deck.build())
    objs.extend(create_railing("A_DeckRail_N", (15, -25.4, deck_z + 0.5),
                               (33, -25.4, deck_z + 0.5), mat=P["metal"], collection=collection))
    objs.extend(create_railing("A_DeckRail_E", (33, -25.4, deck_z + 0.5),
                               (33, -14.6, deck_z + 0.5), mat=P["metal"], collection=collection))
    st = create_steps(width=4.0, steps=6, mat=P["stone_mid"], collection=collection,
                      loc=(24, -33, 0))
    objs.append(st)

    # ---- 湖畔水面占位 + 石岸线（低面数；动态水体由 Three.js 负责）----
    water_mat = pbr("MAT_WATER_PLACEHOLDER", (0.15, 0.33, 0.37), rough=0.08, alpha=0.85)
    objs.extend([o for o in create_water_shore(
        "A_Lake", size=(26.0, 24.0), loc=(40, -20, 0.0), water_mat=water_mat,
        bank_mat=P["water_stone"], collection=collection, bank_h=1.0) if o])

    # ---- 绿篱广场（替代风格突兀的粉色花坛）----
    for i, (x0, y0, x1, y1) in enumerate([(-14, 30, 6, 30), (-14, 34, -14, 22)]):
        objs.extend(create_hedge(f"A_Hedge_{i}", (x0, y0, zt(x0, y0)), (x1, y1, zt(x1, y1)),
                                 height=0.8, mat=P["hedge"], collection=collection, seed=i))

    # ---- 树木（统一 ENV 树类型、统一落地、移除糖果色/悬浮）----
    tree_spots = [
        (-46, 34, "conifer"), (-38, 8, "broad"), (-30, 30, "poplar"),
        (-44, 14, "round"), (-22, 34, "broad"), (-36, -20, "conifer"),
        (22, 30, "broad"), (30, 10, "round"), (-12, -30, "conifer"),
        (18, -30, "broad"), (46, 20, "poplar"), (50, 6, "round"),
        (6, 34, "conifer"), (-50, -6, "broad"), (40, -40, "broad"),
        (52, -8, "conifer"), (-16, 44, "round"), (24, 44, "broad"),
    ]
    leaf_of = {"conifer": P["foliage_c"], "broad": P["foliage_a"],
               "poplar": P["foliage_b"], "round": P["foliage_b"]}
    for i, (x, y, kind) in enumerate(tree_spots):
        leaf2 = P["foliage_aut"] if kind == "poplar" else leaf_of[kind]
        for o in create_tree(kind, 1.05, seed=i * 11 + 3, trunk_mat=P["bark"],
                             leaf_mat=leaf_of[kind], leaf_mat2=leaf2,
                             collection=collection):
            o.matrix_world = Matrix.Translation(Vector((x, y, zt(x, y)))) @ o.matrix_world
            objs.append(o)

    focus_objs = [o for o in objs if o is not None and (
        'Facade' in o.name or 'Mass' in o.name or 'Roof' in o.name
        or 'Tower' in o.name or 'Porch' in o.name)]
    return {"root": root, "objects": objs, "focus": focus_objs,
            "note": "v2 返修：改为层级台地山体(挡土墙)承载建筑；建筑成排窗+门厅+檐口；"
                    "塔楼高宽比3.5:1并带竖向长窗；新增静态湖面+石岸+临湖观景平台栏杆；"
                    "移除糖果色元素、树木全部落地并统一为ENV树型。",
            "meta": {"theme": "hilltop settlement (terraced)",
                     "tower": "clock tower 3.5:1 L3", "lake": "static placeholder + stone bank"}}


def _road_strip(name, points, width, mat, collection, z=0.06):
    """由折线点生成简易道路带（分段盒体，贴合坡地）。"""
    objs = []
    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        ln = math.hypot(x1 - x0, y1 - y0)
        ang = math.atan2(y1 - y0, x1 - x0)
        mb = MeshBuilder(f"{name}_{i}", mat=mat, collection=collection)
        mb.add_box((ln, width, 0.12), ((x0 + x1) / 2.0, (y0 + y1) / 2.0, z), rot=(0, 0, ang))
        objs.append(mb.build())
    return objs


# =====================================================================
# B 区：水镇
# =====================================================================

def build_district_b_watertown(collection):
    P = pal()
    root = make_root("DISTRICT_B_WATERTOWN")
    objs = []
    # 地面基板
    ground = MeshBuilder("B_Ground", mat=P["paving"], collection=collection)
    ground.add_box((90, 60, 0.4), (0, 0, -0.2))
    objs.append(ground.build())
    # 中轴河道：两侧石质驳岸 + 台阶 + 临水平台（水面由 Three.js 负责）
    bank = MeshBuilder("B_Bank", mat=P["water_stone"], collection=collection)
    bank.add_box((86, 1.6, 1.6), (0, -7.0, -0.2))
    bank.add_box((86, 1.6, 1.6), (0, 7.0, -0.2))
    objs.append(bank.build())
    # 沿河临水低层建筑（有屋脊、山墙，临水呼应）
    rows = []
    for i in range(6):
        x = -34 + i * 13.0
        for side in (-1, 1):
            L = 11.0 + (i % 3)
            W = 9.0
            fl = 1 + (i % 2)
            b, _ = generic_building(collection, L, W, fl, fh=3.4, roof="pitched",
                                    wall_mat=P["brick"] if i % 2 else P["plaster"],
                                    roof_mat=P["tile_roof"], entrance=(i % 2 == 0),
                                    win_w=0.9, win_h=1.4)
            y = side * 14.0
            _place(b, loc=(x, y, 0))
            objs.extend(b)
            rows.append((x, y))
    # 临水平台 / 水街步道
    walk = MeshBuilder("B_Walk", mat=P["paving"], collection=collection)
    for side in (-1, 1):
        walk.add_box((86, 4.0, 0.3), (0, side * 11.0, 0.15))
    objs.append(walk.build())
    objs.extend(create_railing("B_Rail", (-42, 8.0, 0.3), (42, 8.0, 0.3),
                               mat=P["metal"], collection=collection))
    objs.extend(create_railing("B_Rail2", (-42, -8.0, 0.3), (42, -8.0, 0.3),
                               mat=P["metal"], collection=collection))
    # 水街小桥（月亮式小拱，真实开放拱洞）
    for o in create_moon_bridge(span=10, rise=2.6, width=4.0,
                                mat=P["water_stone"], deck_mat=P["paving"],
                                rail_mat=P["metal"], collection=collection,
                                name="B_MiniMoon"):
        o.location.y += 0
        objs.append(o)
    # 室外休息空间：长椅 + 树
    for i in range(8):
        x = -30 + i * 9.0
        side = -1 if i % 2 else 1
        mb = MeshBuilder("B_Bench", mat=P["wood"], collection=collection)
        mb.add_box((1.8, 0.5, 0.1), (x, side * 12.0, 0.55))
        mb.add_box((0.12, 0.5, 0.5), (x - 0.8, side * 12.0, 0.3))
        mb.add_box((0.12, 0.5, 0.5), (x + 0.8, side * 12.0, 0.3))
        objs.append(mb.build())
    objs.extend(create_tree_cluster(area=(80, 20), count=14, seed=202,
                                    trunk_mat=P["bark"],
                                    leaf_mats=[P["foliage_a"], P["foliage_b"], P["blossom"]],
                                    collection=collection, avoid=[(0, 0, 9)]))
    return {"root": root, "objects": objs, "meta": {"theme": "water town", "canal": "X-axis"}}

    # =====================================================================
# C / H 区：城市经典轴线
# =====================================================================

def _urban_axis(collection, root_name, seed, accent_mat, tower=True, variant="A"):
    """城市经典轴线组团。variant 控制布局差异，保证 C/H 外观明显不同。"""
    P = pal()
    rnd = random.Random(seed)
    root = make_root(root_name)
    objs = []
    ground = MeshBuilder("Axis_Ground", mat=P["paving"], collection=collection)
    ground.add_box((110, 64, 0.4), (0, 0, -0.2))
    objs.append(ground.build())
    # 对称布局的规整研发办公楼（数量/屋顶/间距随 variant 变化）
    n_side = 4 if variant == "A" else 3
    roof_choices = (["mansard", "mansard"] if variant == "A"
                    else ["pitched", "hip"])
    spacing = 28.0 if variant == "A" else 32.0
    wall_choices = ([P["plaster"]] if variant == "A"
                    else [P["stone_light"], P["plaster"], P["brick"]])
    for i in range(n_side):
        x = -(n_side - 1) * spacing / 2.0 + i * spacing
        for side in (-1, 1):
            L, W, fl = ((22, 14, 4) if variant == "A" else (24, 15, 5))
            b, _ = generic_building(collection, L, W, fl,
                                    roof=roof_choices[(i + (side > 0)) % len(roof_choices)],
                                    wall_mat=wall_choices[i % len(wall_choices)],
                                    roof_mat=accent_mat,
                                    arcade_front=(variant == "A" and i % 2 == 0),
                                    dormers=(4 if variant == "A" else 0),
                                    seed=seed + i * 7 + side)
            _place(b, loc=(x, side * 21.0, 0))
            objs.extend(b)
    # 中央主体（体量与屋顶形态随 variant 不同）
    if variant == "A":
        cb, _ = generic_building(collection, 34, 20, 3, roof="pitched",
                                 wall_mat=P["stone_light"], roof_mat=accent_mat,
                                 arcade_front=True, roof_height=6.0, seed=seed)
        _place(cb, loc=(-6, 0, 0))
        objs.extend(cb)
        objs.extend(create_colonnade(length=30, height=6.0, columns=10,
                                     mat=P["stone_light"], collection=collection, arch=False))
    else:
        cb, _ = generic_building(collection, 40, 22, 4, roof="mansard",
                                 wall_mat=P["stone_light"], roof_mat=accent_mat,
                                 arcade_front=True, dormers=6, seed=seed)
        _place(cb, loc=(0, 0, 0))
        objs.extend(cb)
        objs.extend(create_colonnade(length=36, height=7.6, columns=12,
                                     mat=P["stone_light"], collection=collection, arch=True))
    # 景观轴线
    axis = MeshBuilder("Axis_Spine", mat=P["paving"], collection=collection)
    axis.add_box((110, 8.0, 0.2), (0, 0, 0.1))
    objs.append(axis.build())
    # 正式庭院 + 花坛 + 行道树
    objs.extend(create_courtyard(length=34 if variant == "A" else 44,
                                 width=24 if variant == "A" else 28,
                                 mat=P["stone_light"], lawn_mat=P["lawn"],
                                 paving_mat=P["paving"], collection=collection,
                                 arcade=(variant != "A")))
    for i in range(6):
        objs.extend(create_flower_bed(size=(6, 3), mat=P["stone_mid"],
                                      flower_mat=(P["blossom"] if variant == "A"
                                                  else P["foliage_aut"]), seed=i,
                                      loc=(-45 + i * 18, 26, 0.0)))
    for i in range(9):
        x = -48 + i * 12.0
        for side in (-1, 1):
            for o in create_tree("round" if variant == "A" else "conifer",
                                 1.1, seed=i * 3 + side, trunk_mat=P["bark"],
                                 leaf_mat=(P["foliage_b"] if variant == "A"
                                           else P["foliage_c"])):
                o.location.x += x
                o.location.y += side * 30.5
                objs.append(o)
    if tower:
        for o in create_clock_tower(size=4.0, height=22.0, mat=P["stone_light"],
                                    trim_mat=P["stone_mid"], roof_mat=accent_mat,
                                    gold_mat=P["gold"], clock_glass_mat=P["glass_dark"],
                                    collection=collection):
            o.location.x += (-6 if variant == "A" else 0)
            o.location.y += -16
            objs.append(o)
    return {"root": root, "objects": objs}


def build_district_c_urban_axis(collection):
    return _urban_axis(collection, "DISTRICT_C_URBAN_AXIS", 11, pal()["tile_roof"],
                       tower=True, variant="A")


def build_district_h_urban_axis(collection):
    return _urban_axis(collection, "DISTRICT_H_URBAN_AXIS", 44, pal()["tile_roof_grey"],
                       tower=False, variant="B")


# =====================================================================
# D 区：城市大学院落（Phase 1 验证资产）
# =====================================================================

def build_district_d_college(collection):
    P = pal()
    root = make_root("DISTRICT_D_COLLEGE")
    objs = []
    ground = MeshBuilder("D_Ground", mat=P["paving"], collection=collection)
    ground.add_box((120, 90, 0.4), (0, 0, -0.2))
    objs.append(ground.build())

    # ---- 主体楼（学院式，L3）----
    main_L, main_W, main_F, fh = 38.0, 18.0, 3, 4.2
    main_H = main_F * fh
    mass, plinth = create_building_mass(main_L, main_W, main_H, main_F, floor_height=fh,
                                        wall_mat=P["stone_light"],
                                        plinth_mat=P["stone_mid"],
                                        collection=collection)
    objs += [mass, plinth]
    objs.extend(add_facades(collection, main_L, main_W, main_H, main_F, fh,
                            arcade_front=True, wall_mat=P["stone_light"],
                            win_w=1.3, win_h=2.2, gap=0.9))
    # 中部凸出的门廊 + 山花
    objs.extend(create_colonnade(length=14, height=7.2, columns=6,
                                 mat=P["stone_light"], collection=collection, arch=True))
    for o in objs[-2:]:
        o.location.y += -main_W / 2.0 - 1.4
    porch = MeshBuilder("D_PorchPediment", mat=P["stone_light"], collection=collection)
    porch.add_box((15.0, 4.0, 1.2), (0, -main_W / 2.0 - 1.4, 7.8))
    porch.add_cylinder(8.5, 3.2, loc=(0, -main_W / 2.0 - 1.4, 9.6), verts=3,
                       radius2=0.0, rot=(math.pi / 2, 0, math.pi / 2))
    objs.append(porch.build())
    # 主体楼入口
    for o in create_door_portal(width=3.0, height=4.6, mat=P["wood"],
                                glass_mat=P["glass_dark"], collection=collection):
        o.location.y += -main_W / 2.0 - 2.4
        objs.append(o)
    # ---- 两侧翼楼 ----
    for side in (-1, 1):
        wL, wW, wF = 26.0, 16.0, 3
        wb, _ = generic_building(collection, wL, wW, wF, fh=4.2, roof="mansard",
                                 wall_mat=P["brick"], roof_mat=P["tile_roof"],
                                 arcade_front=True, dormers=6, seed=side,
                                 entrance=True, win_w=1.8, win_h=2.8,
                                 roof_height=3.4)
        _place(wb, loc=(side * (main_L / 2.0 + wW / 2.0 + 3.0), 6.0, 0))
        objs.extend(wb)
        # 主楼 ↔ 配楼 连廊（拱廊，统一建筑语言与细节度）
        for o in create_colonnade(length=7.0, height=5.2, columns=3,
                                  mat=P["stone_light"], collection=collection, arch=True):
            o.matrix_world = Matrix.Translation(
                Vector((side * (main_L / 2.0 + 1.0), 6.0, 0))) @ o.matrix_world
            objs.append(o)
    # ---- 主体楼屋顶（孟莎 + 老虎窗）----
    for r in create_mansard_roof(main_L, main_W, steep_height=3.6, top_height=2.2,
                                 mat=P["tile_roof_grey"], dormers=6, seed=9,
                                 collection=collection):
        r.location.z += main_H
        objs.append(r)
    # ---- 角部塔楼（L3）----
    for side in (-1, 1):
        for o in create_clock_tower(size=4.0, height=15.0, mat=P["stone_light"],
                                    trim_mat=P["stone_mid"], roof_mat=P["tile_roof_grey"],
                                    gold_mat=P["gold"], clock_glass_mat=P["window"],
                                    collection=collection, spire=True):
            o.location.x += side * (main_L / 2.0 - 1.0)
            o.location.y += -main_W / 2.0 + 1.0
            objs.append(o)
    # ---- 开放式庭院（拱廊围合）----
    for o in create_courtyard(length=67, width=30, mat=P["stone_light"],
                              lawn_mat=P["lawn"], paving_mat=P["paving"],
                              collection=collection, arcade=True, fountain=True, seed=5):
        o.location.y += -34.0
        objs.append(o)
    # ---- 连续立面窗框已在主体/翼楼体现；补庭院台阶与景观 ----
    objs.append(create_steps(width=6.0, steps=3, mat=P["stone_mid"], collection=collection,
                             loc=(0, -main_W / 2.0 - 3.6, 0)))
    objs.extend(create_tree_cluster(area=(90, 20), count=10, seed=303,
                                    trunk_mat=P["bark"],
                                    leaf_mats=[P["foliage_a"], P["foliage_b"],
                                               P["foliage_aut"], P["blossom"]],
                                    collection=collection, avoid=[(0, -34, 18)]))
    focus_objs = [o for o in objs if o is not None and (
        'Facade' in o.name or 'Mass' in o.name or 'Roof' in o.name
        or 'Tower' in o.name or 'Porch' in o.name or 'Colonnade' in o.name)]
    return {"root": root, "objects": objs, "focus": focus_objs,
            "note": "v2 返修：两侧红砖配楼升级为 3 层，补成排窗框/拱廊入口/檐口，"
                    "与主体楼学院式语言一致；主楼↔配楼加拱廊连廊。",
            "meta": {"theme": "college courtyard", "mainHall": [main_L, main_W, main_H],
                     "language": "collegiate"}}

    # =====================================================================
# E 区：森林小镇
# =====================================================================

def build_district_e_forest_town(collection):
    P = pal()
    root = make_root("DISTRICT_E_FOREST_TOWN")
    objs = []
    ground = MeshBuilder("E_Ground", mat=P["lawn"], collection=collection)
    ground.add_box((110, 80, 0.4), (0, 0, -0.2))
    objs.append(ground.build())
    rnd = random.Random(77)
    spots = [(-38, -24), (-18, -30), (8, -26), (30, -18), (-34, 6), (-8, 2),
             (18, 8), (38, 22), (-24, 26), (6, 28)]
    for i, (x, y) in enumerate(spots):
        L = rnd.uniform(14, 20)
        W = rnd.uniform(10, 14)
        fl = rnd.choice([1, 2, 2, 3])
        b, _ = generic_building(collection, L, W, fl, fh=3.6, roof="pitched",
                                wall_mat=rnd.choice([P["wood"], P["plaster"], P["brick"]]),
                                roof_mat=rnd.choice([P["tile_roof"], P["tile_roof_grey"]]),
                                seed=i + 400, entrance=True)
        _place(b, loc=(x, y, 0), rz=rnd.uniform(-0.5, 0.5))
        objs.extend(b)
        # 包围庭院的绿篱与树
        objs.extend(create_hedge(f"E_Hedge_{i}", (x - 9, y - 8, 0), (x + 9, y - 8, 0),
                                 height=0.7, mat=P["hedge"], collection=collection, seed=i))
    # 步行路径
    objs.extend(_road_strip("E_Path", [(-48, -10), (0, -6), (46, 4)], 2.4,
                            P["paving"], collection))
    objs.extend(_road_strip("E_Path2", [(-10, -36), (2, 0), (10, 34)], 2.2,
                            P["paving"], collection))
    # 小型景观台地
    for t in create_terrace_platform(20, 12, 2.4, 2, mat=P["stone_mid"],
                                     wall_mat=P["stone_dark"], collection=collection):
        t.location.x += -44
        t.location.y += 24
        objs.append(t)
    # 大量树木（森林感，5 类）
    objs.extend(create_tree_cluster(area=(100, 70), count=70, seed=505,
                                    trunk_mat=P["bark"],
                                    leaf_mats=[P["foliage_a"], P["foliage_b"],
                                               P["foliage_c"], P["foliage_aut"],
                                               P["blossom"]],
                                    collection=collection,
                                    avoid=[(x, y, 12) for (x, y) in spots]))
    return {"root": root, "objects": objs, "meta": {"theme": "forest town", "trees": 70}}


# =====================================================================
# F 区：广场小镇 / 港湾小镇
# =====================================================================

def build_district_f_plaza_town(collection):
    P = pal()
    root = make_root("DISTRICT_F_PLAZA_TOWN")
    objs = []
    ground = MeshBuilder("F_Plaza", mat=P["paving"], collection=collection)
    ground.add_box((110, 80, 0.4), (0, 0, -0.2))
    objs.append(ground.build())
    # 铺装广场分区（几何分色，避免空白铺地）
    plaza = MeshBuilder("F_PlazaDetail", mat=P["stone_light"], collection=collection)
    plaza.add_box((46, 40, 0.14), (4, -6, 0.07))
    plaza.add_cylinder(11, 0.16, loc=(4, -6, 0.16), verts=48)
    plaza.add_box((52, 3.0, 0.18), (4, -26, 0.09))
    objs.append(plaza.build())
    # 中心喷泉
    fountain = MeshBuilder("F_Fountain", mat=P["stone_mid"], collection=collection)
    fountain.add_cylinder(5.0, 1.0, loc=(4, -6, 0.5), verts=40)
    fountain.add_cylinder(3.8, 0.3, loc=(4, -6, 1.05), verts=40)
    fountain.add_cylinder(0.9, 2.4, loc=(4, -6, 2.1), verts=20)
    fountain.add_sphere(0.7, loc=(4, -6, 3.4), subdiv=2)
    objs.append(fountain.build())
    # 港湾主体建筑（高辨识度立面）
    b, _ = generic_building(collection, 46, 22, 4, fh=4.0, roof="pitched",
                            wall_mat=P["plaster"], roof_mat=P["tile_roof"],
                            arcade_front=True, roof_height=7.0, seed=600,
                            win_w=1.4, win_h=2.3)
    _place(b, loc=(4, 30, 0))
    objs.extend(b)
    # 配套建筑
    for i, (x, y, fl) in enumerate([(-40, 22, 2), (34, 20, 3), (-38, -20, 2), (38, -18, 2)]):
        mb, _ = generic_building(collection, 18, 14, fl, fh=3.8, roof="mansard",
                                 wall_mat=P["brick"], roof_mat=P["tile_roof_grey"],
                                 dormers=3, seed=610 + i)
        _place(mb, loc=(x, y, 0), rz=(-0.3 if x > 0 else 0.3))
        objs.extend(mb)
    # 临水步道 + 栏杆
    objs.extend(create_railing("F_WaterRail", (-55, -34, 0), (55, -34, 0),
                               mat=P["metal"], collection=collection))
    objs.extend(create_railing("F_WaterRail2", (-55, -35.6, 0), (55, -35.6, 0),
                               mat=P["metal"], collection=collection))
    # 休息区长椅
    for i in range(6):
        x = -20 + i * 9.0
        mb = MeshBuilder("F_Bench", mat=P["wood"], collection=collection)
        mb.add_box((1.9, 0.5, 0.1), (x, -22, 0.6))
        mb.add_box((1.9, 0.1, 0.6), (x, -22.25, 0.95))
        mb.add_box((0.12, 0.5, 0.55), (x - 0.85, -22, 0.3))
        mb.add_box((0.12, 0.5, 0.55), (x + 0.85, -22, 0.3))
        objs.append(mb.build())
    # 树阵
    for i in range(5):
        for j in range(3):
            for o in create_tree("broad", 1.15, seed=i * 7 + j, trunk_mat=P["bark"],
                                 leaf_mat=P["foliage_b"]):
                o.location.x += -38 + i * 17.0
                o.location.y += 2 + j * 10.0
                objs.append(o)
    # 路灯
    for i in range(6):
        objs.extend(create_lamp(f"F_Lamp_{i}", (-28 + i * 12.0, -18, 0),
                                mat=P["metal"], collection=collection))
    # 主体建筑周边树阵（增强环境归属感）
    objs.extend(create_tree_cluster(area=(60, 14), count=12, seed=612,
                                    trunk_mat=P["bark"],
                                    leaf_mats=[P["foliage_a"], P["foliage_b"], P["foliage_aut"]],
                                    collection=collection, scale_range=(1.0, 1.5),
                                    avoid=[(4, -30, 14)]))
    return {"root": root, "objects": objs, "meta": {"theme": "plaza/harbor town"}}


# =====================================================================
# G 区：城市街区
# =====================================================================

def build_district_g_urban_blocks(collection):
    P = pal()
    root = make_root("DISTRICT_G_URBAN_BLOCKS")
    objs = []
    ground = MeshBuilder("G_Ground", mat=P["asphalt"], collection=collection)
    ground.add_box((120, 90, 0.4), (0, 0, -0.2))
    objs.append(ground.build())
    # 人行道
    walk = MeshBuilder("G_Walk", mat=P["paving"], collection=collection)
    for (x, y, w, h) in [(0, 0, 120, 5.0), (0, 0, 5.0, 90),
                         (0, 34, 120, 4.0), (0, -34, 120, 4.0),
                         (34, 0, 4.0, 90), (-34, 0, 4.0, 90)]:
        walk.add_box((w, h, 0.22), (x, y, 0.11))
    objs.append(walk.build())
    # 街区建筑群（体量与屋顶各不相同）
    rnd = random.Random(909)
    blocks = [
        (-24, -20, 20, 16, 4, "mansard"),
        (-24, 18, 22, 14, 5, "flat"),
        (22, -20, 18, 18, 3, "pitched"),
        (22, 18, 24, 16, 4, "hip"),
        (-2, -20, 16, 14, 2, "pitched"),
        (-2, 18, 16, 16, 3, "mansard"),
        (46, -4, 16, 22, 4, "flat"),
        (-46, -4, 16, 22, 3, "pitched"),
    ]
    for i, (x, y, L, W, fl, roof) in enumerate(blocks):
        b, _ = generic_building(collection, L, W, fl, fh=3.8, roof=roof,
                                wall_mat=rnd.choice([P["plaster"], P["brick"],
                                                     P["stone_light"], P["concrete"]]),
                                roof_mat=rnd.choice([P["tile_roof"], P["tile_roof_grey"]]),
                                dormers=(4 if roof == "mansard" else 0),
                                seed=900 + i, entrance=True)
        _place(b, loc=(x, y, 0))
        objs.extend(b)
        # 街角入口
        if i % 2 == 0:
            for o in create_door_portal(width=2.0, height=3.0, mat=P["wood"],
                                        glass_mat=P["glass_dark"], collection=collection):
                o.location.x += x + L / 2.0
                o.location.y += y
                o.rotation_euler.z = math.pi / 2.0
                objs.append(o)
    # 内部庭院（部分街区）
    for o in create_courtyard(length=18, width=12, mat=P["stone_light"],
                              lawn_mat=P["lawn"], paving_mat=P["paving"],
                              collection=collection, arcade=False, fountain=False):
        o.location.x += -24
        o.location.y += 18
        objs.append(o)
    # 树木与路灯
    for i in range(8):
        x = -50 + i * 14.0
        for side in (-1, 1):
            for o in create_tree("conifer", 0.9, seed=i * 5 + side, trunk_mat=P["bark"],
                                 leaf_mat=P["foliage_c"]):
                o.location.x += x
                o.location.y += side * 40.0
                objs.append(o)
    for i in range(8):
        objs.extend(create_lamp(f"G_Lamp_{i}", (-48 + i * 14.0, -40, 0),
                                mat=P["metal"], collection=collection))
    return {"root": root, "objects": objs, "meta": {"theme": "urban blocks"}}

    # =====================================================================
# 地标：桥梁与胶囊会议中心
# =====================================================================

def build_landmark_arch_bridge(collection):
    P = pal()
    root = make_root("LANDMARK_ARCH_BRIDGE")
    objs = create_arch_bridge(spans=3, span=11.0, pier=2.6, width=7.0,
                              deck_thickness=1.0, arch_ratio=0.42,
                              mat=P["water_stone"], deck_mat=P["paving"],
                              rail_mat=P["metal"], collection=collection,
                              name="ARCH_BRIDGE")
    # 岸边道路衔接
    for side in (-1, 1):
        road = MeshBuilder(f"Arch_Approach_{side}", mat=P["asphalt"], collection=collection)
        road.add_box((9.0, 7.0, 0.3), (side * 23.0, 0, 1.5))
        objs.append(road.build())
    return {"root": root, "objects": objs,
            "meta": {"type": "multi-span arch bridge", "spans": 3}}


def build_landmark_moon_bridge(collection):
    P = pal()
    root = make_root("LANDMARK_MOON_BRIDGE")
    objs = create_moon_bridge(span=20.0, rise=6.2, width=6.0, deck_thickness=0.8,
                              mat=P["water_stone"], deck_mat=P["paving"],
                              rail_mat=P["metal"], collection=collection,
                              name="MOON_BRIDGE")
    return {"root": root, "objects": objs,
            "meta": {"type": "moon arch bridge", "span": 20.0, "rise": 6.2}}


def build_landmark_rainbow_bridge(collection):
    P = pal()
    root = make_root("LANDMARK_RAINBOW_BRIDGE")
    objs = create_rainbow_bridge(span=28.0, rise=7.4, width=10.5, ribs=7,
                                 rib_th=0.36, mat=P["stone_light"],
                                 deck_mat=P["paving"], rail_mat=P["metal"],
                                 collection=collection, name="RAINBOW_BRIDGE")
    return {"root": root, "objects": objs,
            "note": "v2 返修：改为多层同心圆弧拱圈(径向彩虹分层)的真实承重结构；"
                    "拱脚嵌入两端桥台、拱顶托住桥面；拱洞经射线验证沿桥宽真实贯通。",
            "meta": {"type": "rainbow load-bearing multi-ring arch bridge (radial color)",
                     "ribs": 7, "span": 28.0, "rise": 7.4, "archOpen": True}}


def build_landmark_capsule_center(collection):
    P = pal()
    root = make_root("LANDMARK_CAPSULE_CENTER")
    objs = create_capsule_center(length=58.0, width=22.0, height=11.0,
                                 mat=P["capsule_shell"], glass_mat=P["glass"],
                                 frame_mat=P["capsule_frame"],
                                 platform_mat=P["concrete"], collection=collection,
                                 name="CAPSULE_CENTER")
    # 周边栈道栏杆
    objs.extend(create_railing("Capsule_Rail", (-38, 16, 0.8), (38, 16, 0.8),
                               mat=P["metal"], collection=collection))
    return {"root": root, "objects": objs,
            "meta": {"type": "streamlined capsule conference center"}}


# =====================================================================
# 交通：小火车与车站
# =====================================================================

def build_train_head(collection):
    P = pal()
    root = make_root("TRAIN_HEAD")
    objs, bogies = create_train_car(
        length=16.0, width=2.9, height=2.8, is_head=True,
        body_mat=P["train_body"], accent_mat=P["train_accent"],
        dark_mat=P["train_dark"], glass_mat=P["glass_dark"],
        collection=collection, name="TRAIN_HEAD")
    return {"root": root, "objects": objs,
            "meta": {"type": "train head", "bogies": [b.name for b in bogies]}}


def build_train_car_01(collection):
    P = pal()
    root = make_root("TRAIN_CAR_01")
    objs, bogies = create_train_car(
        length=15.0, width=2.9, height=2.8, is_head=False,
        body_mat=P["train_body"], accent_mat=P["train_accent"],
        dark_mat=P["train_dark"], glass_mat=P["glass_dark"],
        collection=collection, name="TRAIN_CAR_01")
    return {"root": root, "objects": objs,
            "meta": {"type": "train car", "bogies": [b.name for b in bogies]}}


def build_station_main(collection):
    P = pal()
    root = make_root("STATION_MAIN")
    objs = create_station(length=44.0, width=10.0, platform_height=1.0,
                          mat=P["platform"], roof_mat=P["canopy"],
                          column_mat=P["metal"], bench_mat=P["wood"],
                          collection=collection, name="STATION_MAIN")
    # 站前广场
    sq = MeshBuilder("Station_Square", mat=P["paving"], collection=collection)
    sq.add_box((50, 18, 0.3), (0, -16, 0.15))
    sq.add_box((16, 6.0, 0.36), (0, -10, 0.18))
    objs.append(sq.build())
    # 广场行道树（避开雨棚正下方）
    for i in range(5):
        for side in (-1, 1):
            for o in create_tree("broad", 1.05, seed=i * 5 + side, trunk_mat=P["bark"],
                                 leaf_mat=P["foliage_b"]):
                o.location.x += -20 + i * 10.0
                o.location.y += side * 7.0 - 20.0
                objs.append(o)
    for i in range(4):
        objs.extend(create_lamp(f"Station_Lamp_{i}", (-18 + i * 12.0, -22, 0),
                                mat=P["metal"], collection=collection))
    return {"root": root, "objects": objs, "meta": {"type": "main station"}}


# =====================================================================
# 环境资产：树木 / 景观小件
# =====================================================================

def build_environment_trees(collection):
    """5 类树木合集资产（供 Three.js 实例化参考与直接摆放）。"""
    P = pal()
    root = make_root("ENV_TREE_CLUSTER")
    objs = []
    types = ["conifer", "broad", "poplar", "round", "blossom"]
    for i, t in enumerate(types):
        leaf = {"conifer": P["foliage_c"], "broad": P["foliage_a"],
                "poplar": P["foliage_b"], "round": P["foliage_b"],
                "blossom": P["blossom"]}[t]
        leaf2 = {"broad": P["foliage_b"], "blossom": P["blossom"]}.get(t, leaf)
        for o in create_tree(t, 1.3, seed=i * 13 + 1, trunk_mat=P["bark"],
                             leaf_mat=leaf, leaf_mat2=leaf2, collection=collection):
            o.location.x += -12 + i * 6.0
            objs.append(o)
    return {"root": root, "objects": objs,
            "meta": {"treeTypes": types, "count": len(types)}}


def build_environment_landscape(collection):
    """景观小件：栏杆段 / 路灯 / 长椅 / 花坛 / 绿篱。"""
    P = pal()
    root = make_root("ENV_LANDSCAPE_ASSETS")
    objs = []
    objs.extend(create_railing("ENV_Rail", (-8, 0, 0), (8, 0, 0), mat=P["metal"],
                               collection=collection))
    for i in range(3):
        objs.extend(create_lamp(f"ENV_Lamp_{i}", (-6 + i * 6.0, 6.0, 0),
                                mat=P["metal"], collection=collection))
    bench = MeshBuilder("ENV_Bench", mat=P["wood"], collection=collection)
    bench.add_box((1.9, 0.5, 0.1), (-6, -6, 0.6))
    bench.add_box((1.9, 0.1, 0.6), (-6, -6.25, 0.95))
    bench.add_box((0.12, 0.5, 0.55), (-6.85, -6, 0.3))
    bench.add_box((0.12, 0.5, 0.55), (-5.15, -6, 0.3))
    objs.append(bench.build())
    objs.extend(create_hedge("ENV_Hedge", (2, -6, 0), (9, -6, 0), mat=P["hedge"],
                             collection=collection, seed=1))
    objs.extend(create_flower_bed(size=(3, 2), mat=P["stone_mid"],
                                  flower_mat=P["blossom"], seed=2, loc=(6, 6, 0)))
    return {"root": root, "objects": objs,
            "meta": {"items": ["railing", "lamp", "bench", "hedge", "flowerbed"]}}