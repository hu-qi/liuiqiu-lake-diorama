# -*- coding: utf-8 -*-
"""
lqk_build.py — 练秋湖数字沙盘 参数化资产构件库
================================================

在 lqk_kit 的几何基元之上，提供 PROMPT §3.3 要求的可复用建模函数：

    建筑：create_building_mass / create_facade / create_window_module /
          create_door_portal / create_pitched_roof / create_mansard_roof /
          create_clock_tower / create_courtyard / create_dormer /
          create_colonnade / create_steps / create_terrace_platform
    桥梁：create_arch_bridge / create_moon_bridge / create_rainbow_bridge
    交通：create_train_car / create_train_head / create_station
    特殊：create_capsule_center / create_terrain
    景观：create_tree_cluster / create_tree / create_hedge(见 kit) /
          create_railing(见 kit) / create_lamp(见 kit) / create_flower_bed

所有函数均以“参数 + 随机种子”驱动，重复执行结果可复现。
"""

import bpy
import bmesh
import math
import random
from mathutils import Vector, Matrix, Euler

from lqk_kit import (
    box, cylinder, sphere, solid_loft, extrude_profile, poly_curve,
    _obj_from_bmesh, add_bevel, add_mirror, add_array, add_boolean, add_subsurf,
    get_collection, link_object, make_root, parent_to_root, TAU,
    create_lamp, pbr,
)


# =====================================================================
# MeshBuilder：把成千上万的小构件合并为单一网格，控制对象数与 Draw Call
# =====================================================================

class MeshBuilder:
    """按材质为单位合并几何，避免“每个窗框一个对象”。"""

    def __init__(self, name, mat=None, collection=None, smooth=False):
        self.name = name
        self.mat = mat
        self.collection = collection
        self.smooth = smooth
        self.bm = bmesh.new()

    # -- 内部：合并一个已变换的临时 bmesh --
    def _merge(self, tmp):
        me = bpy.data.meshes.new("_tmp_merge")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def _apply(self, tmp, matrix):
        bmesh.ops.transform(tmp, matrix=matrix, verts=tmp.verts)
        self._merge(tmp)

    def add_mesh(self, me):
        """把一个 bpy mesh 数据块合并进当前 builder，并释放该数据块。"""
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def absorb(self, obj):
        """把临时对象合并进当前 builder，并删除该对象。"""
        me = obj.data.copy()
        bpy.data.objects.remove(obj, do_unlink=True)
        self.add_mesh(me)

    @staticmethod
    def _matrix(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        return (Matrix.Translation(Vector(loc))
                @ Euler(rot, 'XYZ').to_matrix().to_4x4()
                @ Matrix.Diagonal(Vector((scale[0], scale[1], scale[2], 1.0))))

    def add_box(self, size, loc=(0, 0, 0), rot=(0, 0, 0)):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        bmesh.ops.scale(tmp, verts=tmp.verts, vec=Vector(size))
        self._apply(tmp, self._matrix(loc, rot))

    def add_cylinder(self, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0),
                     axis='Z', verts=16, radius2=None):
        tmp = bmesh.new()
        r2 = radius if radius2 is None else radius2
        bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=verts,
                              radius1=radius, radius2=r2, depth=depth)
        if axis == 'X':
            bmesh.ops.rotate(tmp, verts=tmp.verts, cent=(0, 0, 0),
                             matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
        elif axis == 'Y':
            bmesh.ops.rotate(tmp, verts=tmp.verts, cent=(0, 0, 0),
                             matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
        self._apply(tmp, self._matrix(loc, rot))

    def add_sphere(self, radius, loc=(0, 0, 0), scale=(1, 1, 1), subdiv=2):
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=radius)
        self._apply(tmp, self._matrix(loc, (0, 0, 0), scale))

    def add_loft(self, rings, cap_start=True, cap_end=True, loc=(0, 0, 0),
                 rot=(0, 0, 0)):
        pts = []
        for ring in rings:
            pts.append([Vector(p) for p in ring])
        tmp = bmesh.new()
        rv = [[tmp.verts.new(p) for p in ring] for ring in pts]
        tmp.verts.ensure_lookup_table()
        n = len(pts[0])
        for i in range(len(pts) - 1):
            a, b = rv[i], rv[i + 1]
            for j in range(n):
                k = (j + 1) % n
                try:
                    tmp.faces.new((a[j], a[k], b[k], b[j]))
                except ValueError:
                    pass
        if cap_start:
            try:
                tmp.faces.new(list(reversed(rv[0])))
            except ValueError:
                pass
        if cap_end:
            try:
                tmp.faces.new(rv[-1])
            except ValueError:
                pass
        self._apply(tmp, self._matrix(loc, rot))

    def add_profile(self, profile_xz, length, axis='Y', loc=(0, 0, 0), rot=(0, 0, 0)):
        rings = []
        if axis == 'Y':
            for y in (-length / 2.0, length / 2.0):
                rings.append([(px, y, pz) for (px, pz) in profile_xz])
        elif axis == 'X':
            for x in (-length / 2.0, length / 2.0):
                rings.append([(x, py, pz) for (py, pz) in profile_xz])
        else:
            for z in (-length / 2.0, length / 2.0):
                rings.append([(px, py, z) for (px, py) in profile_xz])
        self.add_loft(rings, loc=loc, rot=rot)

    def build(self):
        obj = _obj_from_bmesh(self.name, self.bm, mat=self.mat,
                              collection=self.collection, smooth=self.smooth)
        self.bm = bmesh.new()
        return obj


# =====================================================================
# 2D 剖面生成器
# =====================================================================

def rect_profile(w, h, cx=0.0, cz=0.0):
    """居中矩形剖面，逆时针（XZ 平面）。"""
    hw, hh = w / 2.0, h / 2.0
    return [(cx - hw, cz - hh), (cx + hw, cz - hh),
            (cx + hw, cz + hh), (cx - hw, cz + hh)]


def rounded_rect_profile(w, h, r, seg=4, cx=0.0, cz=0.0):
    """圆角矩形剖面（胶囊/壳体截面）。"""
    hw, hh = w / 2.0 - r, h / 2.0 - r
    pts = []
    centers = [(hw, hh, 0), (-hw, hh, math.pi / 2),
               (-hw, -hh, math.pi), (hw, -hh, 3 * math.pi / 2)]
    for ccx, ccz, a0 in centers:
        for i in range(seg + 1):
            a = a0 + (math.pi / 2) * (i / seg)
            pts.append((cx + ccx + r * math.cos(a), cz + ccz + r * math.sin(a)))
    return pts


def circle_profile(radius, seg=24, cx=0.0, cz=0.0):
    return [(cx + radius * math.cos(TAU * i / seg),
             cz + radius * math.sin(TAU * i / seg)) for i in range(seg)]


def ellipse_profile(a, b, seg=24, cx=0.0, cz=0.0):
    return [(cx + a * math.cos(TAU * i / seg),
             cz + b * math.sin(TAU * i / seg)) for i in range(seg)]


def arch_wall_profile(total_len, height, arches, bottom=0.0):
    """生成“带真实拱洞的桥墙”单连通剖面。

    arches: List[(center_x, radius)]，拱洞为从 bottom 起算的半圆。
    剖面为逆时针：底部左→右（遇拱洞时沿半圆上绕），右侧上行，顶部右→左，左侧下行。
    """
    left = -total_len / 2.0
    right = total_len / 2.0
    arches = sorted(arches, key=lambda a: a[0])
    pts = []
    pts.append((left, bottom))
    for (cx, r) in arches:
        pts.append((cx - r, bottom))
        seg = 18
        for i in range(1, seg):
            a = math.pi - math.pi * (i / seg)   # 从 π 到 0
            pts.append((cx + r * math.cos(a), bottom + r * math.sin(a)))
        pts.append((cx + r, bottom))
    pts.append((right, bottom))
    pts.append((right, height))
    pts.append((left, height))
    return pts


def curved_arch_wall_profile(total_len, rise, arches, thickness_hint=0.6):
    """月亮桥：顶部为圆弧（拱形桥面），底部含半圆拱洞的剖面。"""
    a = total_len / 2.0
    H = rise
    R = (a * a + H * H) / (2.0 * H) if H > 1e-6 else 1e9
    def top(x):
        # 圆心 (0, H-R)，圆通过 (±a,0),(0,H)
        cy = H - R
        val = R * R - x * x
        val = max(val, 0.0)
        return cy + math.sqrt(val)
    pts = []
    pts.append((-a, 0.0))
    for (cx, r) in sorted(arches, key=lambda t: t[0]):
        pts.append((cx - r, 0.0))
        seg = 20
        for i in range(1, seg):
            ang = math.pi - math.pi * (i / seg)
            pts.append((cx + r * math.cos(ang), r * math.sin(ang)))
        pts.append((cx + r, 0.0))
    pts.append((a, 0.0))
    # 顶部圆弧：右→左
    steps = 36
    for i in range(0, steps + 1):
        x = a - 2 * a * (i / steps)
        pts.append((x, top(x)))
    return pts


# =====================================================================
# 建筑构件
# =====================================================================

def create_window_module(width=1.2, height=1.8, depth=0.22, frame_w=0.08,
                         mullions_x=1, mullions_y=0, sill=True,
                         frame_mat=None, glass_mat=None, collection=None):
    """单个窗户构件：真实凹进玻璃 + 窗框 + 中挺 + 窗台。

    返回 dict {frame, glass, sill}（对象在原点，朝向 -Y）。
    """
    fb = MeshBuilder("Window_Frame", mat=frame_mat, collection=collection)
    gb = MeshBuilder("Window_Glass", mat=glass_mat, collection=collection)
    hw, hh, d = width / 2.0, height / 2.0, depth
    # 四周框（略微外凸）
    t = frame_w
    fb.add_box((width + 2 * t, t, t), (0, -d * 0.35, hh + t / 2.0))
    fb.add_box((width + 2 * t, t, t), (0, -d * 0.35, -hh - t / 2.0))
    fb.add_box((t, t, height), (-hw - t / 2.0, -d * 0.35, 0))
    fb.add_box((t, t, height), (hw + t / 2.0, -d * 0.35, 0))
    # 中挺
    for i in range(1, mullions_x + 1):
        x = -hw + width * i / (mullions_x + 1)
        fb.add_box((t * 0.6, t * 0.7, height), (x, -d * 0.4, 0))
    for j in range(1, mullions_y + 1):
        z = -hh + height * j / (mullions_y + 1)
        fb.add_box((width, t * 0.7, t * 0.6), (0, -d * 0.4, z))
    # 玻璃（凹进）
    gb.add_box((width, 0.04, height), (0, -d * 0.1, 0))
    # 窗台
    objs = {"frame": fb.build(), "glass": gb.build()}
    if sill:
        sb = MeshBuilder("Window_Sill", mat=frame_mat, collection=collection)
        sb.add_box((width + 2.2 * t, 0.16, 0.07), (0, -0.02, -hh - t))
        objs["sill"] = sb.build()
    return objs


def _facade_windows_frame(frame_mat, glass_mat, length, height, floors,
                          floor_height, win_w, win_h, gap_x, gap_y,
                          mullions_x, collection):
    """返回 (frames_obj, glass_obj)，窗户沿 X 排列、朝 -Y，原点在地面中心。

    窗户为“加粗外凸窗框 + 深色玻璃”的真实几何组合：窗框外凸 0.12m、宽 0.16m，
    玻璃嵌入框内并缩进，形成明确阴影层次，保证成排窗在远景渲染下清晰可读。
    """
    fb = MeshBuilder("Facade_Frames", mat=frame_mat, collection=collection)
    gb = MeshBuilder("Facade_Glass", mat=glass_mat, collection=collection)
    cols = max(1, int((length - gap_x) // (win_w + gap_x)))
    total_w = cols * win_w + (cols - 1) * gap_x
    x0 = -total_w / 2.0 + win_w / 2.0
    t = 0.16           # 窗框宽度/厚度（加粗）
    fy = -0.12         # 窗框中心深度（外凸 0.12m）
    gy = -0.07         # 玻璃深度（相对框外表面缩进，形成凹槽）
    for f in range(floors):
        z = f * floor_height + floor_height * 0.5
        h = win_h * (1.15 if f == 0 else 1.0)
        for c in range(cols):
            x = x0 + c * (win_w + gap_x)
            fb.add_box((win_w + 2 * t, t, t), (x, fy, z + h / 2.0 + t / 2.0))
            fb.add_box((win_w + 2 * t, t, t), (x, fy, z - h / 2.0 - t / 2.0))
            fb.add_box((t, t, h), (x - win_w / 2.0 - t / 2.0, fy, z))
            fb.add_box((t, t, h), (x + win_w / 2.0 + t / 2.0, fy, z))
            for i in range(1, mullions_x + 1):
                mx = x - win_w / 2.0 + win_w * i / (mullions_x + 1)
                fb.add_box((t * 0.5, t * 0.7, h), (mx, fy + 0.02, z))
            gb.add_box((win_w, 0.05, h), (x, gy, z))
    return fb.build(), gb.build()


def create_facade(length=24.0, height=12.0, floors=3, floor_height=3.6,
                  window_w=1.1, window_h=1.7, window_gap_x=0.75,
                  wall_mat=None, frame_mat=None, glass_mat=None,
                  trim_mat=None, cornice=True, base=True,
                  arcade=False, collection=None, include_wall=True):
    """立面构件：墙体 + 连续窗框 + 玻璃 + 檐口线脚 + 基座。

    在局部坐标：沿 X 展开、朝 -Y、地面在 z=0。
    arcade=True 时首层生成拱廊（真实半圆拱洞）。
    include_wall=False 时只输出窗框/玻璃/线脚（叠加在既有体量上）。
    返回 dict{wall, frames, glass, trim}
    """
    wall_b = MeshBuilder("Facade_Wall", mat=wall_mat, collection=collection)
    if include_wall:
        wall_b.add_box((length, 0.3, height), (0, 0, height / 2.0))
        if base:
            wall_b.add_box((length + 0.35, 0.42, 0.55), (0, 0, 0.275))
    trim_b = MeshBuilder("Facade_Trim", mat=trim_mat or wall_mat, collection=collection)
    if cornice:
        trim_b.add_box((length + 0.55, 0.44, 0.28), (0, 0, height - 0.14))
        for f in range(1, floors):
            trim_b.add_box((length + 0.2, 0.4, 0.12), (0, 0, f * floor_height))

    if arcade:
        # 首层拱廊：用带拱洞的墙板替换实墙，产生真实开放拱券
        arches = []
        span = 3.0
        n = max(1, int(length // span))
        start = -(n - 1) * span / 2.0
        for i in range(n):
            arches.append((start + i * span, span * 0.34))
        prof = arch_wall_profile(length, floor_height, arches, bottom=0.3)
        wall_b.add_profile(prof, 0.5, axis='Y', loc=(0, 0.05, 0))

    frames, glass = _facade_windows_frame(
        frame_mat, glass_mat, length, height, floors, floor_height,
        window_w, window_h, window_gap_x, 0.4, 1, collection)
    return {"wall": wall_b.build(), "trim": trim_b.build(),
            "frames": frames, "glass": glass}


def create_door_portal(width=2.4, height=3.2, depth=0.5, mat=None,
                       glass_mat=None, awning=True, steps=3,
                       collection=None, label=None):
    """主入口门厅：门框、双开门、门楣、雨篷、台阶。"""
    mb = MeshBuilder("Portal", mat=mat, collection=collection)
    hw, h = width / 2.0, height
    t = 0.16
    # 门框
    mb.add_box((t, depth, h + 0.3), (-hw - t / 2.0, -0.1, (h + 0.3) / 2.0))
    mb.add_box((t, depth, h + 0.3), (hw + t / 2.0, -0.1, (h + 0.3) / 2.0))
    mb.add_box((width + 2 * t, depth, t), (0, -0.1, h + 0.3 - t / 2.0))
    mb.add_box((width + 0.8, depth + 0.3, 0.22), (0, -0.35, h + 0.45))  # 门楣
    objs = [mb.build()]
    # 门扇（内凹，深色玻璃）
    gb = MeshBuilder("Portal_Glass", mat=glass_mat, collection=collection)
    gb.add_box((width - 0.2, 0.06, h - 0.15), (0, -0.05, (h - 0.15) / 2.0))
    objs.append(gb.build())
    if awning:
        aw = MeshBuilder("Portal_Awning", mat=mat, collection=collection)
        aw.add_box((width + 1.0, 0.9, 0.12), (0, -0.55, h + 0.75))
        aw.add_box((0.1, 0.1, h + 0.75), (-hw - 0.5, -0.95, (h + 0.75) / 2.0))
        aw.add_box((0.1, 0.1, h + 0.75), (hw + 0.5, -0.95, (h + 0.75) / 2.0))
        objs.append(aw.build())
    # 台阶
    if steps > 0:
        sb = MeshBuilder("Portal_Steps", mat=mat, collection=collection)
        for i in range(steps):
            sb.add_box((width + 1.2 - i * 0.25, 0.34, 0.18),
                       (0, -0.5 - 0.34 * (steps - 1 - i) - 0.17, 0.09 + i * 0.18))
        # 两侧栏杆柱
        sb.add_box((0.2, 0.2, 0.9), (-hw - 0.7, -0.7, 0.45))
        sb.add_box((0.2, 0.2, 0.9), (hw + 0.7, -0.7, 0.45))
        objs.append(sb.build())
    return objs


def create_building_mass(length=30.0, width=14.0, height=12.0, floors=3,
                         floor_height=3.6, wall_mat=None, bevel=(0.06, 1),
                         plinth=True, plinth_mat=None, collection=None,
                         shape="rect", notch=0.0):
    """建筑主体体量：规整外壳 + 可选基座裙房。

    shape="rect"|"courtyard"(中庭) | "L"(L 形体量)。
    """
    b = MeshBuilder("Mass", mat=wall_mat, collection=collection)
    b.add_box((length, width, height), (0, 0, height / 2.0))
    if plinth:
        pm = plinth_mat or wall_mat
        b2 = MeshBuilder("Mass_Plinth", mat=pm, collection=collection)
        b2.add_box((length + 1.2, width + 1.2, 0.5), (0, 0, 0.25))
        plinth_obj = b2.build()
        if bevel:
            add_bevel(plinth_obj, bevel[0] * 1.2, 1)
    else:
        plinth_obj = None
    if shape == "L":
        # L 形：再补一个侧翼体量
        b.add_box((length * 0.4, width * 0.5, height), (length * 0.3, -width * 0.25, height / 2.0))

    obj = b.build()
    if bevel:
        add_bevel(obj, bevel[0], bevel[1])
    return obj, plinth_obj


def create_pitched_roof(length=30.0, width=14.0, height=4.5, overhang=0.7,
                        thickness=0.35, mat=None, ridge_along='X',
                        ridge_width=0.3, collection=None, gable_barge=True):
    """真实厚度的双坡屋顶（山墙端面为完整三角形，带出檐）。

    通过五/六边形截面沿屋脊方向 loft 生成，具备真实体积与坡面厚度。
    """
    L = length + 2 * overhang
    W = width + 2 * overhang
    hw = W / 2.0
    rw = ridge_width / 2.0
    # 截面 (u: 横向, z: 竖向)
    prof = [(-hw, 0.0), (hw, 0.0), (hw, thickness), (rw, height),
            (-rw, height), (-hw, thickness)]
    mb = MeshBuilder("Roof_Pitched", mat=mat, collection=collection)
    if ridge_along == 'X':
        rings = []
        for x in (-L / 2.0, L / 2.0):
            rings.append([(x, u, z) for (u, z) in prof])
        mb.add_loft(rings)
    else:
        rings = []
        for y in (-L / 2.0, L / 2.0):
            rings.append([(u, y, z) for (u, z) in prof])
        mb.add_loft(rings)
    roof = mb.build()
    add_bevel(roof, 0.04, 1)
    return roof


def create_mansard_roof(length=30.0, width=16.0, steep_height=3.2,
                        top_height=1.8, overhang=0.6, mat=None,
                        top_mat=None, collection=None, dormers=0, seed=0):
    """孟莎式屋顶：下部陡坡（四坡）+ 上部缓坡顶 + 可选老虎窗。"""
    L = length + 2 * overhang
    W = width + 2 * overhang
    inset = 0.42
    # 下部陡坡：两个矩形环 loft（沿 Z）
    ring0 = [(-L / 2.0, -W / 2.0, 0.0), (L / 2.0, -W / 2.0, 0.0),
             (L / 2.0, W / 2.0, 0.0), (-L / 2.0, W / 2.0, 0.0)]
    topL, topW = L * (1 - inset), W * (1 - inset)
    ring1 = [(-topL / 2.0, -topW / 2.0, steep_height), (topL / 2.0, -topW / 2.0, steep_height),
             (topL / 2.0, topW / 2.0, steep_height), (-topL / 2.0, topW / 2.0, steep_height)]
    mb = MeshBuilder("Roof_Mansard", mat=mat, collection=collection)
    mb.add_loft([ring0, ring1])
    lower = mb.build()
    add_bevel(lower, 0.05, 1)

    top = create_pitched_roof(length=topL, width=topW, height=top_height,
                              overhang=0.15, thickness=0.28,
                              mat=top_mat or mat, collection=collection,
                              gable_barge=False)
    top.location = (0, 0, steep_height)
    objs = [lower, top]

    rnd = random.Random(seed)
    for i in range(dormers):
        t = (i + 0.6) / (dormers + 0.2)
        x = -topL / 2.0 + t * topL
        for d in create_dormer(mat=mat, window_mat=None, collection=collection):
            # 沿陡坡面朝外向（+Y）略微下沉
            d.location.x += x
            d.location.y += W / 2.0 - (W - topW) * 0.35
            d.location.z += steep_height * 0.42
            objs.append(d)
    return objs


def create_dormer(mat=None, window_mat=None, collection=None, size=(1.3, 1.3, 1.1)):
    """老虎窗：小体量 + 小双坡顶（真实几何）。"""
    w, d, h = size
    mb = MeshBuilder("Dormer", mat=mat, collection=collection)
    mb.add_box((w, d, h), (0, 0, h / 2.0))
    body = mb.build()
    roof = create_pitched_roof(length=w * 0.45, width=d + 0.3, height=0.5,
                               overhang=0.15, thickness=0.14, mat=mat,
                               ridge_along='Y', collection=collection,
                               gable_barge=False)
    roof.location = (0, 0, h)
    objs = [body, roof]
    if window_mat is not None:
        gb = MeshBuilder("Dormer_Glass", mat=window_mat, collection=collection)
        gb.add_box((w * 0.5, 0.05, h * 0.5), (0, -d / 2.0 - 0.02, h * 0.52))
        objs.append(gb.build())
    return objs


def create_clock_tower(size=6.0, height=22.0, clock_z=None, mat=None,
                       trim_mat=None, roof_mat=None, gold_mat=None,
                       clock_glass_mat=None, collection=None, spire=True,
                       clock_faces=True, windows=True):
    """标志性钟楼（L3 精细）。

    基座（两级台明）+ 三段收分塔身（带竖向长窗/角壁柱）+ 多层檐口线脚
    + 钟楼层（四向钟面与指针）+ 塔顶尖顶与金色顶饰。
    总高由 height 驱动；塔身高宽比由调用方以 size/height 控制（建议 3:1~4:1）。
    """
    gl = clock_glass_mat or gold_mat or mat
    tr = trim_mat or mat
    rf = roof_mat or mat
    gd = gold_mat or tr

    base_h = 1.8
    band_h = 2.4
    roof_h = max(3.8, height * 0.24)
    crown_h = 0.9
    shaft_h = max(4.0, height - base_h - band_h - roof_h - crown_h)
    shaft_z0 = base_h
    shaft_z1 = base_h + shaft_h
    band_z = shaft_z1 + band_h / 2.0

    objs = []

    # ---- 基座（两级台明）----
    plinth = MeshBuilder("Tower_Plinth", mat=tr, collection=collection)
    plinth.add_box((size + 1.8, size + 1.8, base_h * 0.5), (0, 0, base_h * 0.25))
    plinth.add_box((size + 1.0, size + 1.0, base_h * 0.5), (0, 0, base_h * 0.75))
    p = plinth.build()
    add_bevel(p, 0.05, 1)
    objs.append(p)

    # ---- 塔身（三段收分 + 角壁柱）----
    shaft = MeshBuilder("Tower_Shaft", mat=mat, collection=collection)
    seg_fracs = [(1.00, 0.30), (0.90, 0.35), (0.80, 0.35)]
    seg_info = []
    zz = shaft_z0
    for frac, fh in seg_fracs:
        sh = shaft_h * fh
        s = size * frac
        shaft.add_box((s, s, sh), (0, 0, zz + sh / 2.0))
        seg_info.append((zz, sh, s))
        zz += sh
    for sx in (-1, 1):
        for sy in (-1, 1):
            shaft.add_box((size * 0.14, size * 0.14, shaft_h),
                          (sx * (size * 0.43), sy * (size * 0.43), shaft_z0 + shaft_h / 2.0))
    s_obj = shaft.build()
    add_bevel(s_obj, 0.05, 1)
    objs.append(s_obj)

    # ---- 塔身竖向长窗（每段每面，真实窗框 + 玻璃，非贴片）----
    if windows:
        wg = MeshBuilder("Tower_WinGlass", mat=gl, collection=collection)
        wf = MeshBuilder("Tower_WinFrame", mat=tr, collection=collection)
        for (sz, sh, s) in seg_info:
            wh = min(sh * 0.6, 2.8)
            wz = sz + sh * 0.52
            ww = max(0.5, size * 0.11)
            off = s / 2.0
            for idx, idy, ax in ((1, 0, 'X'), (-1, 0, 'X'), (0, 1, 'Y'), (0, -1, 'Y')):
                if ax == 'X':
                    wg.add_box((0.07, ww, wh), (idx * (off - 0.05), 0, wz))
                    wf.add_box((0.11, ww + 0.26, 0.11), (idx * (off + 0.02), 0, wz + wh / 2 + 0.06))
                    wf.add_box((0.11, ww + 0.26, 0.11), (idx * (off + 0.02), 0, wz - wh / 2 - 0.06))
                    wf.add_box((0.11, 0.11, wh), (idx * (off + 0.02), -ww / 2 - 0.06, wz))
                    wf.add_box((0.11, 0.11, wh), (idx * (off + 0.02), ww / 2 + 0.06, wz))
                    wf.add_box((0.08, ww, 0.06), (idx * (off + 0.03), 0, wz))
                else:
                    wg.add_box((ww, 0.07, wh), (0, idy * (off - 0.05), wz))
                    wf.add_box((ww + 0.26, 0.11, 0.11), (0, idy * (off + 0.02), wz + wh / 2 + 0.06))
                    wf.add_box((ww + 0.26, 0.11, 0.11), (0, idy * (off + 0.02), wz - wh / 2 - 0.06))
                    wf.add_box((0.11, 0.11, wh), (-ww / 2 - 0.06, idy * (off + 0.02), wz))
                    wf.add_box((0.11, 0.11, wh), (ww / 2 + 0.06, idy * (off + 0.02), wz))
                    wf.add_box((ww, 0.08, 0.06), (0, idy * (off + 0.03), wz))
        objs.append(wg.build())
        objs.append(wf.build())

    # ---- 檐口线脚（塔身顶 + 钟楼层上下，多层出挑）----
    trims = MeshBuilder("Tower_Trim", mat=tr, collection=collection)
    for (zline, ext) in ((shaft_z1 - 0.25, 0.55), (shaft_z1, 0.75),
                         (shaft_z1 + band_h + 0.2, 0.9), (shaft_z1 + band_h + 0.6, 0.6)):
        trims.add_box((size * 0.88 + ext, size * 0.88 + ext, 0.30), (0, 0, zline))
    objs.append(trims.build())

    # ---- 钟楼层（四向钟面 + 金色指针）----
    cb = MeshBuilder("Tower_ClockBand", mat=mat, collection=collection)
    cb.add_box((size * 0.9, size * 0.9, band_h), (0, 0, band_z))
    objs.append(cb.build())
    if clock_faces:
        off = size * 0.9 / 2.0
        for idx, idy, ax in ((1, 0, 'X'), (-1, 0, 'X'), (0, 1, 'Y'), (0, -1, 'Y')):
            ring = MeshBuilder("Tower_ClockRing", mat=tr, collection=collection)
            ring.add_cylinder(min(1.15, size * 0.22), 0.26,
                              loc=(idx * off, idy * off, band_z), axis=ax, verts=28)
            objs.append(ring.build())
            face = MeshBuilder("Tower_ClockFace", mat=gl, collection=collection)
            face.add_cylinder(min(0.95, size * 0.18), 0.32,
                              loc=(idx * off, idy * off, band_z), axis=ax, verts=28)
            objs.append(face.build())
            hands = MeshBuilder("Tower_Hands", mat=gd, collection=collection)
            if ax == 'X':
                hands.add_box((0.10, 0.14, 0.9), (idx * (off + 0.2), 0, band_z + 0.30))
                hands.add_box((0.10, 0.66, 0.14), (idx * (off + 0.2), 0, band_z + 0.05))
            else:
                hands.add_box((0.14, 0.10, 0.9), (0, idy * (off + 0.2), band_z + 0.30))
                hands.add_box((0.66, 0.10, 0.14), (0, idy * (off + 0.2), band_z + 0.05))
            objs.append(hands.build())

    # ---- 尖顶（四棱锥）+ 金色顶饰 ----
    if spire:
        base = shaft_z1 + band_h + crown_h
        rb = MeshBuilder("Tower_Roof", mat=rf, collection=collection)
        r = size * 0.62 * math.sqrt(2.0)
        rb.add_cylinder(r, roof_h, loc=(0, 0, base + roof_h / 2.0), verts=4,
                        radius2=0.0, rot=(0, 0, math.pi / 4))
        objs.append(rb.build())
        fb = MeshBuilder("Tower_Finial", mat=gd, collection=collection)
        fb.add_cylinder(0.09, roof_h * 0.3, loc=(0, 0, base + roof_h + roof_h * 0.15), verts=10)
        fb.add_sphere(0.18, loc=(0, 0, base + roof_h + roof_h * 0.3 + 0.1))
        objs.append(fb.build())
    return objs


def create_colonnade(length=20.0, height=5.0, columns=8, mat=None,
                     collection=None, arch=False, cap_height=0.6):
    """柱廊 / 拱廊：等距立柱 + 顶部楣梁，arch=True 时立柱间为真实拱券。"""
    mb = MeshBuilder("Colonnade_Cols", mat=mat, collection=collection)
    span = length / (columns - 1) if columns > 1 else length
    x0 = -length / 2.0
    for i in range(columns):
        x = x0 + i * span
        # 带轻微收分的圆柱
        mb.add_cylinder(0.22, height, loc=(x, 0, height / 2.0), verts=14)
        mb.add_box((0.62, 0.62, 0.3), (x, 0, 0.15))
        mb.add_box((0.62, 0.62, 0.28), (x, 0, height - 0.14))
    cols = mb.build()
    cap = MeshBuilder("Colonnade_Cap", mat=mat, collection=collection)
    cap.add_box((length + 0.8, 0.8, cap_height), (0, 0, height + cap_height / 2.0))
    objs = [cols, cap.build()]
    if arch:
        ab = MeshBuilder("Colonnade_Arches", mat=mat, collection=collection)
        for i in range(columns - 1):
            x = x0 + (i + 0.5) * span
            ab.add_profile(arch_wall_profile(span, height, [(0, span * 0.34)]),
                           0.35, axis='Y', loc=(x, 0, 0.3))
        objs.append(ab.build())
    return objs


def create_steps(width=4.0, steps=4, rise=0.18, run=0.34, mat=None,
                 collection=None, loc=(0, 0, 0)):
    """几何台阶（每级独立实体，具有真实层次）。"""
    mb = MeshBuilder("Steps", mat=mat, collection=collection)
    for i in range(steps):
        mb.add_box((width, run, rise), (0, -run * (steps - 1 - i), rise / 2.0 + i * rise))
    obj = mb.build()
    obj.location = loc
    return obj


def create_terrace_platform(length=40.0, width=26.0, height=8.0, tiers=4,
                            mat=None, wall_mat=None, collection=None,
                            railing_mat=None, seed=0):
    """A 区台地：多级挡土台地 + 栏杆 + 坡道。"""
    objs = []
    tier_h = height / tiers
    for t in range(tiers):
        w = width * (1 - t * 0.12)
        l = length * (1 - t * 0.12)
        mb = MeshBuilder(f"Terrace_{t}", mat=mat, collection=collection)
        mb.add_box((l, w, tier_h + 0.05), (0, t * (width - w) / 2.0, tier_h / 2.0 + t * tier_h))
        objs.append(mb.build())
        # 挡土墙
        wb = MeshBuilder(f"TerraceWall_{t}", mat=wall_mat or mat, collection=collection)
        wb.add_box((l + 0.4, 0.35, tier_h), (0, t * (width - w) / 2.0 - w / 2.0 - 0.18,
                                             tier_h / 2.0 + t * tier_h))
        objs.append(wb.build())
    return objs


def create_terraced_hill(length=86.0, width=66.0, tiers=4, rise=12.0,
                         slope_ratio=0.72, wall_mat=None, top_mat=None,
                         collection=None, name="Hill", wall_lip=0.45):
    """层级台地山体（A 区“山顶”载体）。

    每层为石砌挡土台地（实体，天然落地）＋草坪顶面，逐层收分形成山体轮廓。
    返回 (objs, tier_tops)；tier_tops[t] = (top_z, half_len, half_wid)，便于把
    建筑/树木/栏杆精确放到对应台地顶面（保证落地、不被坡体吞没）。
    """
    objs = []
    tier_tops = []
    tier_h = rise / tiers
    for t in range(tiers):
        s = slope_ratio ** t
        L = length * s
        W = width * s
        z0 = t * tier_h
        # 台地结构体（石砌挡土墙整体，顶面含檐口出挑）
        struct = MeshBuilder(f"{name}_Struct_{t}", mat=wall_mat, collection=collection)
        struct.add_box((L, W, tier_h), (0, 0, z0 + tier_h / 2.0))
        struct.add_box((L + wall_lip * 2, W + wall_lip * 2, 0.35),
                       (0, 0, z0 + tier_h - 0.1))          # 挡土墙压顶线脚
        objs.append(struct.build())
        # 顶面草坪薄层
        top = MeshBuilder(f"{name}_Lawn_{t}", mat=top_mat, collection=collection)
        top.add_box((L - 0.6, W - 0.6, 0.16), (0, 0, z0 + tier_h + 0.02))
        objs.append(top.build())
        tier_tops.append((z0 + tier_h + 0.10, L / 2.0, W / 2.0))
    return objs, tier_tops


def arc_arch_ring_profile(radius_center, thickness, cy, seg=30):
    """圆弧拱环剖面（XZ 平面，拱脚 z=0）。

    radius_center: 中心弧半径；thickness: 径向厚度；cy: 圆心竖坐标（<0）。
    生成“外弧右→左 + 内弧左→右”的闭合环带多边形，用于挤出成有厚度的拱圈。
    """
    r_out = radius_center + thickness / 2.0
    r_in = radius_center - thickness / 2.0
    th0_out = math.asin(max(-1.0, min(1.0, -cy / r_out)))
    th0_in = math.asin(max(-1.0, min(1.0, -cy / r_in)))
    pts = []
    for k in range(seg + 1):
        th_ = th0_out + (math.pi - 2.0 * th0_out) * (k / seg)
        pts.append((r_out * math.cos(th_), cy + r_out * math.sin(th_)))
    for k in range(seg + 1):
        th_ = (math.pi - th0_in) - (math.pi - 2.0 * th0_in) * (k / seg)
        pts.append((r_in * math.cos(th_), cy + r_in * math.sin(th_)))
    return pts


def create_water_shore(name="WaterShore", size=(36.0, 30.0), loc=(0, 0, 0),
                       water_mat=None, bank_mat=None, collection=None,
                       bank_h=0.9, bank_w=1.6):
    """静态湖水占位 + 石砌岸线（低面数）。

    说明：PROMPT §5.1 规定水体动态由 Three.js 负责；此处仅提供低面数的静态
    水面占位与石岸线，用于 Blender 预览与湖岸衔接表达，运行时可由动态水体覆盖。
    """
    objs = []
    w, d = size
    # 湖底/水体（单层薄实体，极低面数）
    lake = MeshBuilder(f"{name}_Pond", mat=water_mat, collection=collection)
    lake.add_box((w, d, 0.5), (0, 0, -0.05))
    pond = lake.build()
    pond.location = loc
    objs.append(pond)
    # 石岸线（四边矮墙）
    bank = MeshBuilder(f"{name}_Bank", mat=bank_mat, collection=collection)
    bank.add_box((w + 2 * bank_w, bank_w, bank_h), (0, d / 2.0 + bank_w / 2.0, bank_h / 2.0))
    bank.add_box((w + 2 * bank_w, bank_w, bank_h), (0, -d / 2.0 - bank_w / 2.0, bank_h / 2.0))
    bank.add_box((bank_w, d, bank_h), (-w / 2.0 - bank_w / 2.0, 0, bank_h / 2.0))
    bank.add_box((bank_w, d, bank_h), (w / 2.0 + bank_w / 2.0, 0, bank_h / 2.0))
    b = bank.build()
    b.location = loc
    objs.append(b)
    return objs


def create_ramp(name="Ramp", length=12.0, width=3.0, rise=3.0, mat=None,
                collection=None, loc=(0, 0, 0), along='Y'):
    """坡地坡道（倾斜实体，衔接不同标高台地）。"""
    ang = math.atan2(rise, length)
    slope_len = math.hypot(length, rise)
    mb = MeshBuilder(name, mat=mat, collection=collection)
    if along == 'Y':
        mb.add_box((width, slope_len, 0.22), (0, 0, rise / 2.0), rot=(math.pi / 2 - ang, 0, 0))
    else:
        mb.add_box((slope_len, width, 0.22), (0, 0, rise / 2.0), rot=(0, -(math.pi / 2 - ang), 0))
    o = mb.build()
    o.location = loc
    return o


def create_courtyard(length=40.0, width=30.0, wall_height=1.2, mat=None,
                     lawn_mat=None, paving_mat=None, collection=None,
                     hedges=True, fountain=True, arcade=True, seed=0):
    """庭院：草坪 + 铺装十字路 + 拱廊边廊 + 绿篱 + 中心水景。"""
    objs = []
    lawn = MeshBuilder("Courtyard_Lawn", mat=lawn_mat, collection=collection)
    lawn.add_box((length, width, 0.12), (0, 0, 0.06))
    objs.append(lawn.build())
    pave = MeshBuilder("Courtyard_Paving", mat=paving_mat, collection=collection)
    pave.add_box((length, 3.0, 0.16), (0, 0, 0.08))
    pave.add_box((3.0, width, 0.16), (0, 0, 0.08))
    pave.add_cylinder(5.5, 0.16, loc=(0, 0, 0.09), verts=40)
    objs.append(pave.build())
    if fountain:
        fb = MeshBuilder("Courtyard_Fountain", mat=paving_mat, collection=collection)
        fb.add_cylinder(3.2, 0.9, loc=(0, 0, 0.45), verts=32)
        fb.add_cylinder(2.4, 0.25, loc=(0, 0, 0.9), verts=32)
        fb.add_cylinder(0.6, 1.4, loc=(0, 0, 1.4), verts=16)
        objs.append(fb.build())
    if hedges:
        rnd = random.Random(seed)
        for sx in (-1, 1):
            for sy in (-1, 1):
                mb = MeshBuilder("Courtyard_Hedge", mat=lawn_mat, collection=collection)
                mb.add_box((6.0, 1.0, 0.8), (sx * (length / 2.0 - 4.5), sy * (width / 2.0 - 4.5), 0.4))
                objs.append(mb.build())
    if arcade:
        for sy in (-1, 1):
            cols = create_colonnade(length=length * 0.7, height=3.6, columns=7,
                                    mat=mat, collection=collection, arch=True)
            for o in cols:
                o.location.y += sy * (width / 2.0 - 1.0)
            objs.extend(cols)
    return objs


# =====================================================================
# 桥梁构件
# =====================================================================

def _bridge_railings(length, width, base_z, mat, collection, along='X',
                     post_spacing=1.6, height=1.1):
    """桥面两侧栏杆（立柱 + 双横杆）。"""
    objs = []
    posts = MeshBuilder("Bridge_Rail", mat=mat, collection=collection)
    n = max(2, int(length / post_spacing))
    for side in (-1, 1):
        for i in range(n + 1):
            x = -length / 2.0 + length * i / n
            y = side * (width / 2.0 - 0.08)
            posts.add_box((0.12, 0.12, height), (x, y, base_z + height / 2.0))
    objs.append(posts.build())
    rails = MeshBuilder("Bridge_Rail_Bar", mat=mat, collection=collection)
    for side in (-1, 1):
        y = side * (width / 2.0 - 0.08)
        for h in (height * 0.55, height * 0.98):
            rails.add_box((length, 0.1, 0.14), (0, y, base_z + h))
    objs.append(rails.build())
    return objs


def create_arch_bridge(spans=3, span=10.0, pier=2.4, width=6.0,
                       deck_thickness=1.0, arch_ratio=0.42, mat=None,
                       deck_mat=None, rail_mat=None, collection=None,
                       rail_height=1.1, approach=5.0, name="ArchBridge"):
    """多孔拱桥：真实几何挖空的开放拱洞（非贴片）。

    拱洞通过单连通剖面挤出实现——底部边界沿半圆上绕，形成真实空心。
    """
    total = spans * span + (spans + 1) * pier
    L = total
    body_h = deck_thickness + span * arch_ratio
    arches = []
    x = -L / 2.0 + pier
    for i in range(spans):
        center = x + span / 2.0
        arches.append((center, span / 2.0 * 0.86))
        x += span + pier
    prof = arch_wall_profile(L, body_h, arches)
    mb = MeshBuilder(f"{name}_Body", mat=mat, collection=collection)
    mb.add_profile(prof, width * 0.72, axis='Y', loc=(0, 0, 0))
    body = mb.build()

    # 桥面板（略宽于墙体，形成出挑）
    deck = MeshBuilder(f"{name}_Deck", mat=deck_mat or mat, collection=collection)
    deck.add_box((L + approach, width, deck_thickness), (0, 0, body_h + deck_thickness / 2.0))
    # 桥面边缘收边
    deck.add_box((L + approach, width + 0.5, 0.22), (0, 0, body_h + deck_thickness + 0.11))
    deck_obj = deck.build()
    add_bevel(deck_obj, 0.05, 1)

    # 两端引道
    objs = [body, deck_obj]
    rails = _bridge_railings(L, width, body_h + deck_thickness + 0.22,
                             rail_mat or mat, collection, height=rail_height)
    objs.extend(rails)
    # 桥墩加厚装饰
    piers = MeshBuilder(f"{name}_Piers", mat=mat, collection=collection)
    x = -L / 2.0
    for i in range(spans + 1):
        px = x
        piers.add_box((pier + 0.5, width * 0.72 + 0.4, body_h * 0.35),
                      (px + pier / 2.0, 0, body_h * 0.175))
        x += span + pier
    objs.append(piers.build())
    return objs


def create_moon_bridge(span=16.0, rise=5.0, width=5.0, deck_thickness=0.7,
                       mat=None, deck_mat=None, rail_mat=None, collection=None,
                       name="MoonBridge", rail_height=1.05):
    """月亮桥：单拱高耸、拱形桥面（顶部为真实圆弧），开放拱洞。"""
    arch_r = min(rise * 0.72, span / 2.0 * 0.92)
    prof = curved_arch_wall_profile(span, rise, [(0.0, arch_r)])
    mb = MeshBuilder(f"{name}_Body", mat=mat, collection=collection)
    mb.add_profile(prof, width * 0.8, axis='Y')
    body = mb.build()

    # 弧形桥面：沿顶部圆弧生成等厚实体（真实厚度坡面）
    a = span / 2.0
    H = rise
    R = (a * a + H * H) / (2.0 * H)
    cy = H - R

    def ztop(x):
        return cy + math.sqrt(max(R * R - x * x, 0.0))

    deck_b = MeshBuilder(f"{name}_Deck", mat=deck_mat or mat, collection=collection)
    steps = 36
    for i in range(steps):
        x0 = -a + 2 * a * (i / steps)
        x1 = -a + 2 * a * ((i + 1) / steps)
        xm = (x0 + x1) / 2.0
        zm = ztop(xm)
        ang = math.atan2(ztop(x1) - ztop(x0), x1 - x0)
        seg = MeshBuilder("_deckseg", mat=deck_mat or mat, collection=collection)
        seg.add_box((math.hypot(x1 - x0, ztop(x1) - ztop(x0)) + 0.04, width, deck_thickness),
                    (xm, 0, zm + deck_thickness / 2.0), rot=(0, -ang, 0))
        deck_b.absorb(seg.build())
    deck = deck_b.build()

    objs = [body, deck]
    # 弧形栏杆（跟随桥面曲线，双横杆 + 立柱）
    rail_b = MeshBuilder(f"{name}_RailBase", mat=rail_mat or mat, collection=collection)
    n = 18
    for side in (-1, 1):
        y = side * (width / 2.0 - 0.06)
        for i in range(n + 1):
            x = -a + 2 * a * (i / n)
            rail_b.add_box((0.1, 0.1, rail_height),
                           (x, y, ztop(x) + deck_thickness + rail_height / 2.0))
    objs.append(rail_b.build())
    rail_bar = MeshBuilder(f"{name}_RailBar", mat=rail_mat or mat, collection=collection)
    for side in (-1, 1):
        y = side * (width / 2.0 - 0.06)
        for h in (rail_height * 0.55, rail_height * 0.98):
            for i in range(n):
                x0 = -a + 2 * a * (i / n)
                x1 = -a + 2 * a * ((i + 1) / n)
                xm = (x0 + x1) / 2.0
                z0 = ztop(x0) + deck_thickness + h
                z1 = ztop(x1) + deck_thickness + h
                ang = math.atan2(z1 - z0, x1 - x0)
                seg = MeshBuilder("_rails", mat=rail_mat or mat, collection=collection)
                seg.add_box((math.hypot(x1 - x0, z1 - z0) + 0.05, 0.09, 0.12),
                            (xm, y, (z0 + z1) / 2.0), rot=(0, -ang, 0))
                rail_bar.absorb(seg.build())
    objs.append(rail_bar.build())
    return objs


def create_rainbow_bridge(span=26.0, rise=7.2, width=10.0, ribs=7, rib_th=0.34,
                          mat=None, deck_mat=None, rail_mat=None, collection=None,
                          name="RAINBOW_BRIDGE", abutment_w=4.0, deck_th=0.9):
    """彩虹桥：多层同心圆弧拱圈（径向分层着色）真实承重、托起桥面。

    结构逻辑（非贴皮装饰）：
      - 以跨度两端 (±a, 0) 与拱顶 (0, rise) 确定的中心弧为基准，向内外逐层
        堆叠“有厚度的圆弧拱环”，各层颜色沿径向分层形成彩虹。
      - 拱脚落在 (±a, 0) 附近并嵌入两端石砌桥台；拱顶托住桥面底部 —— 形成
        可信的受力结构。
      - 最内层拱环的内缘即真实贯通的桥洞（沿桥宽方向射线可穿透）。
    与月亮桥区别：跨度更大、拱更扁平、多层彩色拱圈 + 平桥面 + 石砌桥台。
    """
    a = span / 2.0
    objs = []
    from lqk_kit import pbr
    rainbow = [
        ("MAT_RAINBOW_RED",    (0.80, 0.22, 0.18)),
        ("MAT_RAINBOW_ORANGE", (0.88, 0.50, 0.16)),
        ("MAT_RAINBOW_YELLOW", (0.90, 0.78, 0.26)),
        ("MAT_RAINBOW_GREEN",  (0.28, 0.62, 0.30)),
        ("MAT_RAINBOW_CYAN",   (0.20, 0.60, 0.66)),
        ("MAT_RAINBOW_BLUE",   (0.20, 0.40, 0.74)),
        ("MAT_RAINBOW_VIOLET", (0.42, 0.28, 0.66)),
    ]
    mats = [pbr(n, c, rough=0.4, metal=0.15) for (n, c) in rainbow]

    # 中心弧：过 (±a, 0) 与 (0, rise)
    Rc = (a * a + rise * rise) / (2.0 * rise)
    cy = rise - Rc
    outer_top = rise + ribs * rib_th / 2.0

    # 多层同心圆弧拱环（径向分层着色）
    for i in range(ribs):
        rc = Rc - (ribs / 2.0) * rib_th + (i + 0.5) * rib_th
        prof = arc_arch_ring_profile(rc, rib_th, cy, seg=30)
        mb = MeshBuilder(f"{name}_Rib_{i}", mat=mats[i % len(mats)], collection=collection)
        # 拱圈沿桥宽挤出：与桥面同宽（拱圈端面比桥台略宽，保证侧视可见彩色拱圈）
        bw = width
        mb.add_profile(prof, bw, axis='Y')
        objs.append(mb.build())

    # 两端石砌桥台（拱脚嵌入其中）
    ab = MeshBuilder(f"{name}_Abutments", mat=deck_mat or mat, collection=collection)
    for side in (-1, 1):
        ab.add_box((abutment_w, width * 0.9, outer_top + deck_th),
                   (side * (a - 0.5), 0, (outer_top + deck_th) / 2.0))
    objs.append(ab.build())

    # 桥面（底部略低于最外拱顶，形成托接）
    deck_bottom = outer_top - 0.25
    deck = MeshBuilder(f"{name}_Deck", mat=deck_mat or mat, collection=collection)
    deck.add_box((span + 2 * abutment_w, width, deck_th),
                 (0, 0, deck_bottom + deck_th / 2.0))
    deck.add_box((span + 2 * abutment_w, width + 0.5, 0.22),
                 (0, 0, deck_bottom + deck_th + 0.11))
    objs.append(deck.build())

    objs.extend(_bridge_railings(span + 2 * abutment_w, width,
                                 deck_bottom + deck_th + 0.22,
                                 rail_mat or mat, collection, height=1.15))
    return objs


# =====================================================================
# 特殊建筑：湖景胶囊会议中心
# =====================================================================

def create_capsule_center(length=54.0, width=20.0, height=10.0, mat=None,
                          glass_mat=None, frame_mat=None, collection=None,
                          name="CapsuleCenter", platform_mat=None,
                          taper=0.42):
    """流线型胶囊会议中心。

    流线型曲面壳体（多工位收分椭圆截面 loft）+ 贴合曲面的环形玻璃幕墙带
    （沿椭圆弧采样，非贴片）+ 竖向分格梃与上下框 + 端部门厅雨棚 + 湖岸连接平台。
    """
    a = length / 2.0
    base_z = 0.8                       # 壳体坐落于平台之上
    center_z = base_z + height * 0.5   # 壳体截面中心高度
    vR = height * 0.5

    def scale_at(x):
        t = abs(x) / a
        return max(0.34, 1.0 - taper * (t ** 2))

    def shell_y(x, z_abs):
        s = scale_at(x)
        wy = (width * s) / 2.0
        t = max(-1.0, min(1.0, (z_abs - center_z) / vR))
        return wy * math.sqrt(max(0.0, 1.0 - t * t))

    def arc_loop(x, z0, z1, nz, scale=1.012):
        """沿椭圆外表面在 z0..z1 之间采样的闭合环（前弧 + 后弧）。"""
        ring = []
        for j in range(nz):
            z = z0 + (z1 - z0) * (j / (nz - 1))
            ring.append((x, shell_y(x, z) * scale, z))
        for j in range(nz - 1, -1, -1):
            z = z0 + (z1 - z0) * (j / (nz - 1))
            ring.append((x, -shell_y(x, z) * scale, z))
        return ring

    segs, nseg = 30, 32
    # ---- 壳体（收分椭圆截面 loft）----
    shell_b = MeshBuilder(f"{name}_Shell", mat=mat, collection=collection)
    rings = []
    for i in range(segs + 1):
        x = -a + 2 * a * (i / segs)
        s = scale_at(x)
        w = width * s
        rings.append([(x, (w / 2.0) * math.cos(TAU * k / nseg),
                       center_z + (height / 2.0) * math.sin(TAU * k / nseg))
                      for k in range(nseg)])
    shell_b.add_loft(rings)
    objs = [shell_b.build()]

    # ---- 贴合曲面的环形玻璃幕墙带 ----
    gz0 = center_z - height * 0.15
    gz1 = center_z + height * 0.15
    nz = 7
    glass_b = MeshBuilder(f"{name}_Glass", mat=glass_mat, collection=collection)
    band = []
    for i in range(segs + 1):
        x = -a + 2 * a * (i / segs)
        band.append(arc_loop(x, gz0, gz1, nz, scale=1.014))
    glass_b.add_loft(band, cap_start=False, cap_end=False)
    objs.append(glass_b.build())

    frame_b = MeshBuilder(f"{name}_GlassFrame", mat=frame_mat, collection=collection)
    # 上下框带（跟随曲面）
    for (za, zb) in ((gz0 - 0.12, gz0), (gz1, gz1 + 0.12)):
        fr = []
        for i in range(segs + 1):
            x = -a + 2 * a * (i / segs)
            fr.append(arc_loop(x, za, zb, 3, scale=1.022))
        frame_b.add_loft(fr, cap_start=False, cap_end=False)
    # 竖向分格梃（前后表面）
    for i in range(0, segs + 1, 2):
        x = -a + 2 * a * (i / segs)
        ymid = shell_y(x, center_z) * 1.02
        for side in (-1, 1):
            frame_b.add_box((0.18, 0.18, (gz1 - gz0) + 0.28),
                            (x, side * ymid, center_z))
    # 顶部纵向脊 + 底部收边
    frame_b.add_box((length, width * 0.14, 0.28), (0, 0, base_z + height + 0.04))
    frame_b.add_box((length * 0.98, width * 0.98, 0.22), (0, 0, base_z + 0.11))
    objs.append(frame_b.build())

    # ---- 端部门厅（入口）+ 雨棚 ----
    portal = MeshBuilder(f"{name}_Portal", mat=mat, collection=collection)
    px = a - 0.6
    portal.add_box((3.2, width * 0.46, height * 0.72), (px, 0, base_z + height * 0.36))
    objs.append(portal.build())
    door = MeshBuilder(f"{name}_PortalGlass", mat=glass_mat, collection=collection)
    door.add_box((0.1, width * 0.34, height * 0.5), (px + 1.62, 0, base_z + height * 0.33))
    objs.append(door.build())
    aw = MeshBuilder(f"{name}_PortalAwning", mat=frame_mat, collection=collection)
    aw.add_box((3.6, width * 0.56, 0.26), (px + 1.4, 0, base_z + height * 0.74))
    objs.append(aw.build())

    # ---- 湖岸连接平台 ----
    pb = MeshBuilder(f"{name}_Platform", mat=platform_mat or mat, collection=collection)
    pb.add_box((length + 9.0, width + 12.0, base_z), (0, 0, base_z / 2.0))
    pb.add_box((length + 4.0, width + 6.0, 0.4), (0, 0, base_z + 0.2))
    objs.append(pb.build())
    return objs


# =====================================================================
# 交通：小火车与车站
# =====================================================================

def _rounded_body_profile(w, h, chamfer, seg=3):
    """车厢截面：底部平、顶角倒圆的近似圆角矩形（YZ 平面, 以 y 为横）。"""
    hw, hh = w / 2.0, h / 2.0
    pts = []
    # 右下 -> 右上（圆角）-> 左上（圆角）-> 左下
    for i in range(seg + 1):
        a0 = -math.pi / 2 + (math.pi / 2) * (i / seg)
        pts.append((hw - chamfer + chamfer * math.cos(a0), -hh + chamfer + chamfer * math.sin(a0)))
    for i in range(seg + 1):
        a0 = 0 + (math.pi / 2) * (i / seg)
        pts.append((hw - chamfer + chamfer * math.cos(a0), hh - chamfer + chamfer * math.sin(a0)))
    for i in range(seg + 1):
        a0 = math.pi / 2 + (math.pi / 2) * (i / seg)
        pts.append((-hw + chamfer + chamfer * math.cos(a0), hh - chamfer + chamfer * math.sin(a0)))
    for i in range(seg + 1):
        a0 = math.pi + (math.pi / 2) * (i / seg)
        pts.append((-hw + chamfer + chamfer * math.cos(a0), -hh + chamfer + chamfer * math.sin(a0)))
    return pts


def create_train_car(length=15.0, width=2.9, height=2.9, is_head=False,
                     body_mat=None, accent_mat=None, dark_mat=None,
                     glass_mat=None, collection=None, name="TRAIN_CAR_01",
                     roof_equipment=True):
    """精细列车车厢/车头。

    纵向基准：z=0 为轨面/地面（车轮落在 z=0），车体地板在 z0，转向架可独立操作。
    包含：多工位收分车体、侧窗带与窗柱、车门(带玻璃)、腰线彩带、车顶设备、
          侧裙、车端车钩、两组转向架（每架 2 轴 4 轮）与轴箱。
    原点位于车厢地面中心（适合沿轨道定位）。返回 (objs, bogies)。
    """
    objs = []
    bogies = []
    wheel_r = 0.42
    z0 = 1.05                 # 车体地板高度（轨面上方）
    body_top = z0 + height
    cz = z0 + height / 2.0
    hw = width / 2.0

    # ---- 车体壳体：多工位 loft（端部轻微收分，形成更真实的列车断面）----
    prof = _rounded_body_profile(width, height, min(0.42, height * 0.14), 3)
    stations = [-length / 2.0, -length * 0.46, 0.0, length * 0.46, length / 2.0]
    taper = [0.90, 0.99, 1.0, 0.99, 0.90]
    if is_head:
        taper = [0.88, 0.98, 1.0, 1.0, 0.74]   # 前端更收，形成机头
    body_b = MeshBuilder(f"{name}_Body", mat=body_mat, collection=collection)
    rings = []
    for x, s in zip(stations, taper):
        rings.append([(x, py * s, cz + pz * s) for (py, pz) in prof])
    body_b.add_loft(rings)
    body = body_b.build()
    add_bevel(body, 0.05, 2)
    objs.append(body)

    # ---- 侧窗带（玻璃）+ 窗柱 ----
    glass_b = MeshBuilder(f"{name}_Windows", mat=glass_mat, collection=collection)
    frame_b = MeshBuilder(f"{name}_WinFrames", mat=dark_mat, collection=collection)
    win_h = height * 0.34
    win_z = z0 + height * 0.62
    if is_head:
        for side in (-1, 1):
            glass_b.add_box((length * 0.34, 0.06, win_h), (length * 0.20,
                             side * (hw - 0.02), win_z))
            frame_b.add_box((0.1, 0.09, win_h * 1.1), (length * 0.20 - length * 0.19,
                             side * (hw - 0.01), win_z))
            frame_b.add_box((0.1, 0.09, win_h * 1.1), (length * 0.20 + length * 0.19,
                             side * (hw - 0.01), win_z))
    else:
        n_win = 6
        span = length * 0.72
        for side in (-1, 1):
            for i in range(n_win):
                x = -span / 2.0 + i * span / (n_win - 1)
                w = span / n_win * 0.68
                glass_b.add_box((w, 0.06, win_h), (x, side * (hw - 0.02), win_z))
                frame_b.add_box((w * 0.22, 0.09, win_h * 1.12),
                                (x + span / n_win / 2.0, side * (hw - 0.01), win_z))
            # 窗带上下沿
            frame_b.add_box((span + 0.3, 0.08, 0.10), (0, side * (hw - 0.005),
                             win_z + win_h / 2.0 + 0.05))
            frame_b.add_box((span + 0.3, 0.08, 0.10), (0, side * (hw - 0.005),
                             win_z - win_h / 2.0 - 0.05))
    objs.append(glass_b.build())
    objs.append(frame_b.build())

    # ---- 车门（含车门玻璃）+ 侧裙 ----
    door_b = MeshBuilder(f"{name}_Doors", mat=dark_mat, collection=collection)
    door_glass = MeshBuilder(f"{name}_DoorGlass", mat=glass_mat, collection=collection)
    if not is_head:
        for side in (-1, 1):
            for x in (-length * 0.28, length * 0.28):
                # 车门：抬升到地板以上，避免与腰线彩带交叉
                door_b.add_box((1.15, 0.08, height * 0.56), (x, side * (hw - 0.015),
                                z0 + height * 0.46))
                door_b.add_box((0.07, 0.06, height * 0.56), (x, side * (hw + 0.01),
                                z0 + height * 0.46))
                door_glass.add_box((1.0, 0.05, height * 0.22), (x, side * (hw + 0.005),
                                    z0 + height * 0.60))
    else:
        door_b.add_box((1.2, 0.08, height * 0.6), (-length * 0.30, hw - 0.02,
                        z0 + height * 0.42))
        door_glass.add_box((0.9, 0.05, height * 0.3), (-length * 0.30, hw + 0.005,
                           z0 + height * 0.58))
    objs.append(door_b.build())
    objs.append(door_glass.build())

    # 侧裙（下部车身护板）
    skirt = MeshBuilder(f"{name}_Skirt", mat=dark_mat, collection=collection)
    skirt.add_box((length * 0.92, width * 0.94, 0.34), (0, 0, z0 - 0.18))
    objs.append(skirt.build())

    # ---- 腰线彩带（置于车门下沿以下，避免穿插）----
    if accent_mat is not None:
        stripe = MeshBuilder(f"{name}_Stripe", mat=accent_mat, collection=collection)
        stripe.add_box((length * 0.985, width + 0.05, 0.22), (0, 0, z0 + height * 0.14))
        objs.append(stripe.build())

    # ---- 车顶弧形 + 设备 ----
    roof_b = MeshBuilder(f"{name}_Roof", mat=body_mat, collection=collection)
    roof_b.add_box((length * 0.96, width * 0.84, 0.18), (0, 0, body_top - 0.02))
    objs.append(roof_b.build())
    if roof_equipment:
        eq = MeshBuilder(f"{name}_Equip", mat=dark_mat, collection=collection)
        eq.add_box((length * 0.24, width * 0.5, 0.3), (-length * 0.10, 0, body_top + 0.18))
        eq.add_box((length * 0.14, width * 0.38, 0.2), (length * 0.22, 0, body_top + 0.14))
        # 受电弓（仅车头/动力车）
        if is_head:
            eq.add_box((1.6, 0.08, 0.08), (-length * 0.05, 0, body_top + 0.55),
                       rot=(0, -0.35, 0))
            eq.add_box((1.6, 0.08, 0.08), (length * 0.25, 0, body_top + 0.55),
                       rot=(0, 0.35, 0))
            eq.add_box((0.1, width * 0.7, 0.08), (length * 0.42, 0, body_top + 0.78))
        objs.append(eq.build())

    # ---- 车头部件 ----
    if is_head:
        from lqk_kit import pbr
        headlight_mat = pbr("MAT_HEADLIGHT", (1.0, 0.96, 0.85), rough=0.2,
                            emission=(1.0, 0.95, 0.8), emission_strength=3.0)
        taillight_mat = pbr("MAT_TAILLIGHT", (0.7, 0.08, 0.05), rough=0.3,
                            emission=(0.9, 0.1, 0.05), emission_strength=2.0)
        # 驾驶室（抬高顶棚，与车厢区分）
        cab = MeshBuilder(f"{name}_Cab", mat=body_mat, collection=collection)
        cab.add_box((length * 0.26, width * 0.9, 0.5),
                    (-length * 0.36, 0, body_top + 0.2))
        objs.append(cab.build())
        # 斜切机鼻
        nose = MeshBuilder(f"{name}_Nose", mat=body_mat, collection=collection)
        nose.add_box((0.9, width * 0.8, height * 0.74), (length / 2.0 + 0.15, 0,
                     z0 + height * 0.44), rot=(0, 0.30, 0))
        nose.add_box((0.5, width * 0.62, height * 0.5), (length / 2.0 + 0.6, 0,
                     z0 + height * 0.36), rot=(0, 0.45, 0))
        objs.append(nose.build())
        # 环绕式前风挡（驾驶室大窗）
        cg = MeshBuilder(f"{name}_Windshield", mat=glass_mat, collection=collection)
        cg.add_box((0.55, width * 0.78, height * 0.40), (length / 2.0 + 0.05, 0,
                    z0 + height * 0.66))
        for side in (-1, 1):
            cg.add_box((length * 0.2, 0.06, height * 0.38),
                       (-length * 0.34, side * (hw - 0.02), z0 + height * 0.66))
        objs.append(cg.build())
        # 前照灯（发光）+ 尾灯
        light_b = MeshBuilder(f"{name}_HeadLights", mat=headlight_mat, collection=collection)
        for side in (-1, 1):
            light_b.add_cylinder(0.2, 0.16, loc=(length / 2.0 + 0.5,
                                                 side * width * 0.3,
                                                 z0 + height * 0.42), axis='X', verts=16)
            light_b.add_cylinder(0.1, 0.12, loc=(length / 2.0 + 0.5,
                                                 side * width * 0.16,
                                                 z0 + height * 0.42), axis='X', verts=12)
        objs.append(light_b.build())
        tail_b = MeshBuilder(f"{name}_TailLights", mat=taillight_mat, collection=collection)
        for side in (-1, 1):
            tail_b.add_cylinder(0.12, 0.1, loc=(-length / 2.0 - 0.03,
                                                side * width * 0.3,
                                                z0 + height * 0.42), axis='X', verts=12)
        objs.append(tail_b.build())
        # 排障器（倾斜铲板）
        cow = MeshBuilder(f"{name}_Cowcatcher", mat=dark_mat, collection=collection)
        cow.add_box((0.7, width * 0.86, height * 0.36), (length / 2.0 + 0.62, 0,
                    z0 + height * 0.10), rot=(0, 0.5, 0))
        cow.add_box((0.2, width * 0.86, 0.14), (length / 2.0 + 0.95, 0,
                    z0 + height * 0.02))
        objs.append(cow.build())
        # 喇叭 / 雨刷（车头顶部小件）
        horn = MeshBuilder(f"{name}_Horn", mat=dark_mat, collection=collection)
        horn.add_box((0.5, 0.1, 0.12), (-length * 0.1, 0, body_top + 0.34),
                     rot=(0, -0.2, 0))
        horn.add_box((0.5, 0.1, 0.12), (-length * 0.1, 0, body_top + 0.34),
                     rot=(0, 0.2, 0))
        objs.append(horn.build())

    # ---- 车端车钩 ----
    coup = MeshBuilder(f"{name}_Couplers", mat=dark_mat, collection=collection)
    for ex in (-length / 2.0 - 0.12, length / 2.0 + 0.12):
        coup.add_box((0.35, 0.3, 0.3), (ex, 0, z0 - 0.35))
        coup.add_cylinder(0.08, 0.4, loc=(ex + (0.2 if ex > 0 else -0.2), 0, z0 - 0.35),
                          axis='X', verts=10)
    objs.append(coup.build())

    # ---- 底盘 + 转向架 + 车轮 ----
    under = MeshBuilder(f"{name}_Underframe", mat=dark_mat, collection=collection)
    under.add_box((length * 0.96, width * 0.7, 0.3), (0, 0, z0 - 0.5))
    objs.append(under.build())

    for b in (-1, 1):
        bogie_root = bpy.data.objects.new(f"{name}_Bogie_{'F' if b < 0 else 'R'}", None)
        bpy.context.scene.collection.objects.link(bogie_root)
        bogie_root.location = (b * length * 0.33, 0, 0)
        bogie_parts = []
        bb = MeshBuilder(f"{name}_BogieFrame", mat=dark_mat, collection=collection)
        bb.add_box((2.2, width * 0.62, 0.34), (0, 0, wheel_r + 0.24))
        bb.add_box((2.6, 0.16, 0.16), (0, 0, wheel_r + 0.45))  # 摇枕
        bogie_parts.append(bb.build())
        for ax in (-0.75, 0.75):
            # 车轴
            axl = MeshBuilder(f"{name}_Axle", mat=dark_mat, collection=collection)
            axl.add_cylinder(0.07, width * 0.8, loc=(ax, 0, wheel_r), axis='Y', verts=10)
            bogie_parts.append(axl.build())
            for side in (-1, 1):
                wb = MeshBuilder(f"{name}_Wheel", mat=dark_mat, collection=collection)
                wy = side * (width * 0.42)
                wb.add_cylinder(wheel_r, 0.12, loc=(ax, wy, wheel_r), axis='Y', verts=24)
                wb.add_cylinder(wheel_r * 0.86, 0.16, loc=(ax, wy, wheel_r), axis='Y', verts=24)
                wb.add_cylinder(0.14, 0.2, loc=(ax, side * (width * 0.46), wheel_r),
                                axis='Y', verts=12)  # 轴箱
                bogie_parts.append(wb.build())
        parent_to_root(bogie_parts, bogie_root)
        if collection is not None:
            link_object(bogie_root, collection)
        bogies.append(bogie_root)
        objs.extend(bogie_parts)
    return objs, bogies


def create_station(length=40.0, width=9.0, platform_height=0.9, mat=None,
                   roof_mat=None, column_mat=None, bench_mat=None,
                   collection=None, name="STATION_MAIN", canopy=True):
    """车站：站台 + 雨棚（柱列 + 桁架）+ 长椅 + 站牌 + 灯具。"""
    objs = []
    # 站台
    pb = MeshBuilder(f"{name}_Platform", mat=mat, collection=collection)
    pb.add_box((length, width, platform_height), (0, 0, platform_height / 2.0))
    pb.add_box((length, width * 0.55, platform_height + 0.06), (0, -width * 0.2,
                                                              platform_height + 0.03))
    objs.append(pb.build())

    if canopy:
        cb = MeshBuilder(f"{name}_Canopy", mat=roof_mat, collection=collection)
        # 弧形雨棚（拱形薄壳）
        steps = 12
        w = width * 0.9
        rings = []
        for i in range(steps + 1):
            x = -length / 2.0 + length * (i / steps)
            rings.append([(x, -w / 2.0, platform_height + 3.6),
                          (x, 0, platform_height + 4.1),
                          (x, w / 2.0, platform_height + 3.6),
                          (x, w / 2.0, platform_height + 3.5),
                          (x, 0, platform_height + 4.0),
                          (x, -w / 2.0, platform_height + 3.5)])
        cb.add_loft(rings)
        objs.append(cb.build())
        cols = MeshBuilder(f"{name}_Columns", mat=column_mat or mat, collection=collection)
        n = max(2, int(length / 6))
        for i in range(n + 1):
            x = -length / 2.0 + length * i / n
            for side in (-1, 1):
                cols.add_cylinder(0.14, 3.6, loc=(x, side * w * 0.42, platform_height + 1.8),
                                  verts=12)
        objs.append(cols.build())
        # 桁架横梁
        truss = MeshBuilder(f"{name}_Truss", mat=column_mat or mat, collection=collection)
        for i in range(n + 1):
            x = -length / 2.0 + length * i / n
            truss.add_box((0.12, w * 0.9, 0.18), (x, 0, platform_height + 3.5))
        truss.add_box((length, 0.12, 0.18), (0, 0, platform_height + 3.35))
        objs.append(truss.build())

    from lqk_kit import pbr
    # 站台安全警示带（临轨侧）
    warn = MeshBuilder(f"{name}_SafetyLine",
                       mat=pbr("MAT_WARNING", (0.85, 0.68, 0.18), rough=0.6),
                       collection=collection)
    warn.add_box((length - 0.4, 0.45, 0.05), (0, width * 0.44, platform_height + 0.03))
    objs.append(warn.build())

    # 长椅（沿站台临轨侧，朝向轨道，清晰可见）
    bench = MeshBuilder(f"{name}_Benches", mat=bench_mat, collection=collection)
    for i in range(6):
        x = -length * 0.4 + i * (length * 0.8 / 5.0)
        by = width * 0.24
        sz = platform_height + 0.45
        bench.add_box((1.8, 0.5, 0.1), (x, by, sz))                     # 座板
        bench.add_box((1.8, 0.1, 0.5), (x, by + 0.22, sz + 0.3))        # 靠背
        bench.add_box((0.12, 0.5, 0.45), (x - 0.82, by, sz - 0.22))     # 左腿
        bench.add_box((0.12, 0.5, 0.45), (x + 0.82, by, sz - 0.22))     # 右腿
    objs.append(bench.build())

    # 站牌（双柱门式牌 + 雨棚悬挂导向牌）
    sign = MeshBuilder(f"{name}_Sign", mat=column_mat or mat, collection=collection)
    sx = -length * 0.36
    sign.add_cylinder(0.09, 3.4, loc=(sx, width * 0.34, platform_height + 1.7), verts=10)
    sign.add_cylinder(0.09, 3.4, loc=(sx + 2.0, width * 0.34, platform_height + 1.7), verts=10)
    sign.add_box((2.4, 0.14, 0.9), (sx + 1.0, width * 0.34, platform_height + 3.25))
    sign.add_box((2.2, 0.06, 0.72), (sx + 1.0, width * 0.34 + 0.11, platform_height + 3.25))
    sign.add_box((2.0, 0.12, 0.45), (0, 0, platform_height + 3.05))
    objs.append(sign.build())

    # 站台灯
    for i in range(5):
        x = -length * 0.4 + i * (length * 0.8 / 4.0)
        objs.extend(create_lamp(f"{name}_Lamp_{i}", (x, width * 0.36, platform_height),
                                height=3.2, mat=column_mat or mat, collection=collection))
    return objs


# =====================================================================
# 地形与景观
# =====================================================================

def create_terrain(length=120.0, width=90.0, height=12.0, res=48,
                   seed=7, mat=None, collection=None, water_mat=None,
                   shore_mat=None):
    """A 区人工山地：带起伏的网格地形 + 湖水占位（湖岸石岸线）。"""
    import math as _m
    rnd = random.Random(seed)
    bm = bmesh.new()
    grid = {}
    for i in range(res + 1):
        for j in range(res + 1):
            x = -length / 2.0 + length * i / res
            y = -width / 2.0 + width * j / res
            u = i / res
            v = j / res
            # 复合多峰起伏（多个高斯峰叠加）
            peak1 = _m.exp(-(((u - 0.30) ** 2 + (v - 0.35) ** 2) / 0.06))
            peak2 = _m.exp(-(((u - 0.72) ** 2 + (v - 0.62) ** 2) / 0.05))
            peak3 = _m.exp(-(((u - 0.55) ** 2 + (v - 0.20) ** 2) / 0.04))
            h = height * (0.9 * peak1 + 0.7 * peak2 + 0.35 * peak3)
            h += rnd.uniform(-0.25, 0.25)
            # 湖洼地（右下角低地）：收浅，避免下探过深受埋
            lake = _m.exp(-(((u - 0.85) ** 2 + (v - 0.15) ** 2) / 0.02))
            h -= lake * (height * 0.16)
            h = max(h, -1.2)
            grid[(i, j)] = bm.verts.new((x, y, h))
    bm.verts.ensure_lookup_table()
    for i in range(res):
        for j in range(res):
            try:
                bm.faces.new((grid[(i, j)], grid[(i + 1, j)],
                              grid[(i + 1, j + 1)], grid[(i, j + 1)]))
            except ValueError:
                pass
    obj = _obj_from_bmesh("Terrain", bm, mat=mat, collection=collection)
    return obj


def create_tree(tree_type="broad", scale=1.0, seed=0, trunk_mat=None,
                leaf_mat=None, leaf_mat2=None, collection=None):
    """单株树（≥5 类：conifer 针叶 / broad 阔叶 / poplar 白杨 /
    round 球形 / blossom 花树），带树干与分层树冠。"""
    rnd = random.Random(seed)
    objs = []
    trunk_h = 2.4 * scale
    # 树干
    tb = MeshBuilder("Tree_Trunk", mat=trunk_mat, collection=collection)
    tb.add_cylinder(0.16 * scale, trunk_h, loc=(0, 0, trunk_h / 2.0),
                    verts=10, radius2=0.11 * scale)
    # 分枝
    for k in range(3):
        ang = TAU * k / 3 + 0.4
        tb.add_cylinder(0.07 * scale, 1.3 * scale,
                        loc=(0.35 * scale * math.cos(ang), 0.35 * scale * math.sin(ang),
                             trunk_h * 0.85), verts=8)
    objs.append(tb.build())

    lb = MeshBuilder("Tree_Leaves", mat=leaf_mat, collection=collection)
    lb2 = MeshBuilder("Tree_Leaves2", mat=leaf_mat2 or leaf_mat, collection=collection)
    if tree_type == "conifer":
        # 3 层圆锥
        for k, cs in enumerate((1.0, 0.78, 0.5)):
            r = 1.5 * scale * cs
            h = 1.6 * scale * cs
            z = trunk_h + k * 1.15 * scale
            lb.add_cylinder(r, h, loc=(0, 0, z + h / 2.0), verts=12, radius2=0.0)
    elif tree_type == "poplar":
        lb.add_sphere(0.9 * scale, loc=(0, 0, trunk_h + 2.2 * scale),
                      scale=(0.55, 0.55, 2.1))
    elif tree_type == "round":
        lb.add_sphere(2.1 * scale, loc=(0, 0, trunk_h + 1.9 * scale),
                      scale=(1.0, 1.0, 0.95), subdiv=3)
    elif tree_type == "blossom":
        lb.add_sphere(1.9 * scale, loc=(0, 0, trunk_h + 1.8 * scale),
                      scale=(1.1, 1.1, 0.9), subdiv=3)
        lb2.add_sphere(1.1 * scale, loc=(0.7 * scale, 0.5 * scale, trunk_h + 2.4 * scale),
                       scale=(0.8, 0.8, 0.7), subdiv=2)
    else:  # broad
        lb.add_sphere(2.0 * scale, loc=(0, 0, trunk_h + 1.9 * scale),
                      scale=(1.15, 1.05, 0.85), subdiv=3)
        for k in range(3):
            ang = TAU * k / 3 + rnd.random()
            lb2.add_sphere(1.25 * scale,
                           loc=(1.1 * scale * math.cos(ang), 1.1 * scale * math.sin(ang),
                                trunk_h + 2.3 * scale),
                           scale=(1.0, 1.0, 0.8), subdiv=2)
    objs.append(lb.build())
    if tree_type in ("broad", "blossom"):
        objs.append(lb2.build())
    return objs


def create_tree_cluster(area=(30.0, 20.0), count=12, seed=0, types=None,
                        scale_range=(0.85, 1.35), trunk_mat=None,
                        leaf_mats=None, collection=None, avoid=None):
    """树丛：统一随机种子，随机类型/缩放/位置，形成自然园林（非一致绿球）。"""
    rnd = random.Random(seed)
    types = types or ["conifer", "broad", "poplar", "round", "blossom"]
    all_objs = []
    ax, ay = area
    for i in range(count):
        t = types[i % len(types)]
        s = rnd.uniform(*scale_range)
        for attempt in range(8):
            x = rnd.uniform(-ax / 2.0, ax / 2.0)
            y = rnd.uniform(-ay / 2.0, ay / 2.0)
            if avoid is None:
                break
            if all((x - cx) ** 2 + (y - cy) ** 2 > r ** 2 for (cx, cy, r) in avoid):
                break
        leaf = rnd.choice(leaf_mats) if leaf_mats else None
        leaf2 = rnd.choice(leaf_mats) if leaf_mats else None
        objs = create_tree(t, s, seed=rnd.randint(0, 99999), trunk_mat=trunk_mat,
                           leaf_mat=leaf, leaf_mat2=leaf2, collection=collection)
        for o in objs:
            o.location.x += x
            o.location.y += y
        all_objs.extend(objs)
    return all_objs


def create_flower_bed(name="FlowerBed", size=(6.0, 3.0), mat=None,
                      flower_mat=None, collection=None, seed=0, loc=(0, 0, 0)):
    """花坛：石边 + 泥土 + 花丛簇。"""
    rnd = random.Random(seed)
    w, d = size
    objs = []
    border = MeshBuilder(f"{name}_Border", mat=mat, collection=collection)
    border.add_box((w, d, 0.45), (0, 0, 0.225))
    border.add_box((w - 0.5, d - 0.5, 0.5), (0, 0, 0.25))
    b = border.build()
    b.location = loc
    objs.append(b)
    fb = MeshBuilder(f"{name}_Flowers", mat=flower_mat, collection=collection)
    for _ in range(int(w * d * 0.8)):
        fx = rnd.uniform(-w / 2.0 + 0.5, w / 2.0 - 0.5)
        fy = rnd.uniform(-d / 2.0 + 0.5, d / 2.0 - 0.5)
        fb.add_sphere(rnd.uniform(0.14, 0.26), loc=(fx, fy, 0.55), subdiv=1)
    f = fb.build()
    f.location = loc
    objs.append(f)
    return objs