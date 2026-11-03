# -*- coding: utf-8 -*-
"""
lqk_kit.py — 练秋湖数字沙盘 Blender 参数化建模核心库
=====================================================

职责：提供与 bpy 无关的高层建筑/几何构造基元，供各 build_*.py 脚本复用。

设计约定
--------
* 单位：1 Blender 单位 = 1 米（m）。
* 坐标系：Blender Z-up；资产地面位于 z=0，建筑原点设在“地面中心”。
* 导出：GLB 使用 export_yup=True 一次性完成 Z-up → glTF Y-up。
* 材质：全部使用 Principled BSDF（兼容 glTF PBR），不使用 Blender 专有节点。
* 修改器：.blend 源文件保留可编辑修改器；GLB 导出时由 export_apply=True 展开。

本模块只做“纯几何与材质”的构造，不执行任何文件 IO 之外的副作用。
"""

import bpy
import bmesh
import math
import random
from mathutils import Vector, Matrix, Euler

TAU = math.pi * 2.0


# =====================================================================
# 0. 场景管理
# =====================================================================

def reset_scene():
    """清空当前场景中的所有对象与孤立数据块，得到干净可复现的起点。"""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (
        bpy.data.meshes, bpy.data.materials, bpy.data.curves,
        bpy.data.cameras, bpy.data.lights, bpy.data.images,
        bpy.data.node_groups,
    ):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def get_collection(name="LQK_Assets"):
    """取得或新建一个集合（用于把资产对象归组）。"""
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def link_object(obj, collection=None):
    """把对象链接进指定集合，并从其它集合中移除。"""
    if collection is None:
        return obj
    if obj.name not in collection.objects:
        collection.objects.link(obj)
    for c in list(obj.users_collection):
        if c != collection:
            c.objects.unlink(obj)
    return obj


def make_root(name, location=(0.0, 0.0, 0.0)):
    """创建一个空的根对象（资产锚点），供 Three.js 侧稳定拾取。"""
    root = bpy.data.objects.new(name, None)
    root.empty_display_type = 'PLAIN_AXES'
    root.empty_display_size = 1.0
    root.location = location
    bpy.context.scene.collection.objects.link(root)
    return root


def parent_to_root(objs, root):
    """把一组对象挂到根锚点下，同时保留其世界变换。"""
    for o in objs:
        if o is None or o == root:
            continue
        if o.parent is None:
            o.parent = root
            o.matrix_parent_inverse = root.matrix_world.inverted()


# =====================================================================
# 1. 材质（glTF PBR 兼容的 Principled BSDF）
# =====================================================================

def pbr(name, color, rough=0.75, metal=0.0, alpha=1.0, emission=None,
        emission_strength=1.0, ior=1.45, specular=0.5):
    """创建/复用一个 Principled BSDF 材质。

    color: (r,g,b) 0-1 线性色；alpha<1 时自动开启 BLEND 透明。
    """
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (-300, 0)
    out.location = (50, 0)

    rgba = (color[0], color[1], color[2], alpha)
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    # 不同 Blender 版本输入名略有差异，做容错
    for key, val in (("Alpha", alpha), ("IOR", ior), ("Specular IOR Level", specular),
                     ("Specular", specular)):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = val
    if emission is not None:
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (emission[0], emission[1], emission[2], 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission_strength
        elif "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = (emission[0], emission[1], emission[2], 1.0)

    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    mat.blend_method = 'BLEND' if alpha < 1.0 else 'OPAQUE'
    if hasattr(mat, "use_backface_culling"):
        mat.use_backface_culling = False
    return mat


def mat_palette():
    """返回本项目统一调色板（温暖午后、低饱和、微缩建筑摄影风）。

    颜色为近似 sRGB 视觉值转线性空间的近似；这里直接给出线性近似值以保证
    glTF 导出后色调柔和。
    """
    return {
        "stone_light": pbr("MAT_STONE_LIGHT", (0.62, 0.58, 0.51), rough=0.85),
        "stone_mid":   pbr("MAT_STONE_MID",   (0.46, 0.43, 0.38), rough=0.88),
        "stone_dark":  pbr("MAT_STONE_DARK",  (0.22, 0.21, 0.20), rough=0.9),
        "concrete":    pbr("MAT_CONCRETE",    (0.70, 0.69, 0.66), rough=0.9),
        "brick":       pbr("MAT_BRICK",       (0.55, 0.33, 0.26), rough=0.9),
        "plaster":     pbr("MAT_PLASTER",     (0.80, 0.76, 0.68), rough=0.85),
        "tile_roof":   pbr("MAT_TILE_ROOF",   (0.35, 0.19, 0.15), rough=0.8),
        "tile_roof_grey": pbr("MAT_TILE_ROOF_GREY", (0.28, 0.29, 0.30), rough=0.8),
        "metal":       pbr("MAT_METAL",       (0.20, 0.21, 0.23), rough=0.35, metal=0.9),
        "metal_light": pbr("MAT_METAL_LIGHT", (0.45, 0.47, 0.5), rough=0.4, metal=0.85),
        "wood":        pbr("MAT_WOOD",        (0.40, 0.26, 0.15), rough=0.7),
        "wood_light":  pbr("MAT_WOOD_LIGHT",  (0.60, 0.44, 0.28), rough=0.7),
        "glass":       pbr("MAT_GLASS",       (0.30, 0.40, 0.46), rough=0.06, metal=0.0, alpha=0.55, ior=1.5),
        "glass_dark":  pbr("MAT_GLASS_DARK",  (0.12, 0.17, 0.20), rough=0.08, metal=0.0, alpha=0.78, ior=1.5),
        # 建筑立面窗：近黑、高不透明度，保证远景/俯视正交渲染下成排窗清晰可读
        # （Three.js 侧可替换为真实玻璃材质与环境反射）
        "window":      pbr("MAT_WINDOW",      (0.06, 0.09, 0.12), rough=0.14, metal=0.0, alpha=1.0, ior=1.5),
        "lawn":        pbr("MAT_LAWN",        (0.20, 0.34, 0.15), rough=0.95),
        "hedge":       pbr("MAT_HEDGE",       (0.13, 0.24, 0.11), rough=0.95),
        "foliage_a":   pbr("MAT_FOLIAGE_A",   (0.16, 0.30, 0.13), rough=0.92),
        "foliage_b":   pbr("MAT_FOLIAGE_B",   (0.24, 0.38, 0.16), rough=0.92),
        "foliage_c":   pbr("MAT_FOLIAGE_C",   (0.12, 0.26, 0.14), rough=0.92),
        "foliage_aut": pbr("MAT_FOLIAGE_AUTUMN", (0.52, 0.40, 0.16), rough=0.9),
        "blossom":     pbr("MAT_BLOSSOM",     (0.78, 0.55, 0.58), rough=0.85),
        "bark":        pbr("MAT_BARK",        (0.26, 0.19, 0.13), rough=0.9),
        "water_stone": pbr("MAT_WATER_STONE", (0.34, 0.33, 0.30), rough=0.85),
        "asphalt":     pbr("MAT_ASPHALT",     (0.16, 0.16, 0.17), rough=0.95),
        "paving":      pbr("MAT_PAVING",      (0.66, 0.62, 0.55), rough=0.85),
        "gold":        pbr("MAT_GOLD",        (0.72, 0.55, 0.20), rough=0.3, metal=0.95),
        "train_body":  pbr("MAT_TRAIN_BODY",  (0.86, 0.85, 0.82), rough=0.4, metal=0.15),
        "train_accent":pbr("MAT_TRAIN_ACCENT",(0.62, 0.16, 0.14), rough=0.45),
        "train_dark":  pbr("MAT_TRAIN_DARK",  (0.14, 0.15, 0.17), rough=0.5, metal=0.3),
        "rainbow_r":   pbr("MAT_RAINBOW_RED",    (0.80, 0.24, 0.20), rough=0.45),
        "rainbow_o":   pbr("MAT_RAINBOW_ORANGE", (0.88, 0.52, 0.18), rough=0.45),
        "rainbow_y":   pbr("MAT_RAINBOW_YELLOW", (0.90, 0.78, 0.28), rough=0.45),
        "rainbow_g":   pbr("MAT_RAINBOW_GREEN",  (0.30, 0.62, 0.32), rough=0.45),
        "rainbow_b":   pbr("MAT_RAINBOW_BLUE",   (0.24, 0.44, 0.72), rough=0.45),
        "capsule_shell": pbr("MAT_CAPSULE_SHELL", (0.83, 0.84, 0.83), rough=0.3, metal=0.35),
        "capsule_frame": pbr("MAT_CAPSULE_FRAME", (0.30, 0.32, 0.35), rough=0.4, metal=0.7),
        "platform":    pbr("MAT_PLATFORM",    (0.58, 0.55, 0.50), rough=0.9),
        "canopy":      pbr("MAT_CANOPY",      (0.55, 0.22, 0.18), rough=0.5, metal=0.2),
    }


# =====================================================================
# 2. 基础几何基元（bmesh 精确构造）
# =====================================================================

def _obj_from_bmesh(name, bm, mat=None, collection=None, smooth=False):
    """由 bmesh 生成网格对象并入库。"""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    if mat is not None:
        obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    bpy.context.scene.collection.objects.link(obj)
    if collection is not None:
        link_object(obj, collection)
    return obj


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None,
        collection=None, bevel=None):
    """轴对齐（可选旋转）长方体。size=(sx,sy,sz) 为完整边长，loc 为中心。

    bevel=(width, segments) 时附加倒角修改器，产生微缩建筑边缘高光。
    """
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=Vector((sx, sy, sz)))
    obj = _obj_from_bmesh(name, bm, mat=mat, collection=collection)
    obj.location = loc
    obj.rotation_euler = Euler(rot, 'XYZ')
    if bevel is not None:
        add_bevel(obj, bevel[0], segments=bevel[1] if len(bevel) > 1 else 2)
    return obj


def cylinder(name, radius, depth, loc=(0, 0, 0), axis='Z', verts=24,
             mat=None, collection=None, smooth=True, cap=True, radius2=None):
    """圆柱/圆锥/圆台。axis 指定轴向。radius2 给出则为锥台。"""
    bm = bmesh.new()
    r2 = radius if radius2 is None else radius2
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=verts,
                          radius1=radius, radius2=r2, depth=depth)
    if axis == 'X':
        bmesh.ops.rotate(bm, verts=bm.verts,
                         cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    elif axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts,
                         cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    obj = _obj_from_bmesh(name, bm, mat=mat, collection=collection, smooth=smooth)
    obj.location = loc
    return obj


def sphere(name, radius, loc=(0, 0, 0), subdiv=2, mat=None, collection=None,
           smooth=True, scale=(1, 1, 1)):
    """icosphere 球体，用于树冠、景观球等。"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    if scale != (1, 1, 1):
        bmesh.ops.scale(bm, verts=bm.verts, vec=Vector(scale))
    obj = _obj_from_bmesh(name, bm, mat=mat, collection=collection, smooth=smooth)
    obj.location = loc
    return obj


def solid_loft(name, rings, mat=None, collection=None, cap_start=True,
               cap_end=True, smooth=False, close_loop=True):
    """把一串“环”（等顶点的点列表）逐段桥接成实体。

    这是屋顶、坡面、胶囊壳体、拱券等复杂体量的通用构造器。
    rings: List[List[(x,y,z)]]，所有环顶点数一致且方向一致。
    """
    if not rings or len(rings) < 2:
        raise ValueError("solid_loft 至少需要 2 个环")
    n = len(rings[0])
    for r in rings:
        if len(r) != n:
            raise ValueError("solid_loft 各环顶点数必须一致")

    bm = bmesh.new()
    ring_verts = []
    for ring in rings:
        ring_verts.append([bm.verts.new(Vector(p)) for p in ring])
    bm.verts.ensure_lookup_table()

    steps = len(rings)
    for i in range(steps - 1):
        a, b = ring_verts[i], ring_verts[i + 1]
        seg = n if close_loop else n - 1
        for j in range(seg):
            k = (j + 1) % n
            try:
                bm.faces.new((a[j], a[k], b[k], b[j]))
            except ValueError:
                pass
    if cap_start:
        try:
            bm.faces.new(list(reversed(ring_verts[0])))
        except ValueError:
            pass
    if cap_end:
        try:
            bm.faces.new(ring_verts[-1])
        except ValueError:
            pass
    return _obj_from_bmesh(name, bm, mat=mat, collection=collection, smooth=smooth)


def extrude_profile(name, profile_xz, axis_len, axis='Y', loc=(0, 0, 0),
                    mat=None, collection=None, smooth=False):
    """把 XZ 平面上的 2D 多边形沿指定轴挤出成棱柱。

    profile_xz: List[(x,z)]，逆时针。用于拱券墙板、山墙、桥墩等。
    """
    rings = []
    if axis == 'Y':
        for y in (-axis_len / 2.0, axis_len / 2.0):
            rings.append([(px, y, pz) for (px, pz) in profile_xz])
    elif axis == 'X':
        for x in (-axis_len / 2.0, axis_len / 2.0):
            rings.append([(x, py, pz) for (py, pz) in profile_xz])
    elif axis == 'Z':
        for z in (-axis_len / 2.0, axis_len / 2.0):
            rings.append([(px, py, z) for (px, py) in profile_xz])
    else:
        raise ValueError("axis 只能是 X/Y/Z")
    obj = solid_loft(name, rings, mat=mat, collection=collection,
                     smooth=smooth)
    obj.location = loc
    return obj


# =====================================================================
# 3. 修改器与变换工具
# =====================================================================

def add_bevel(obj, width, segments=2, angle=40.0, clamp=True,
              harden=False, profile=0.7):
    """附加倒角修改器（保留可编辑）。"""
    m = obj.modifiers.new("Bevel", 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = clamp
    m.profile = profile
    if hasattr(m, "harden_normals"):
        m.harden_normals = harden
    return m


def add_mirror(obj, axis='X', bisect=False):
    """镜像修改器（保留可编辑）。"""
    m = obj.modifiers.new("Mirror", 'MIRROR')
    m.use_axis[0] = axis == 'X'
    m.use_axis[1] = axis == 'Y'
    m.use_axis[2] = axis == 'Z'
    m.use_bisect_axis[0] = bisect and axis == 'X'
    m.use_bisect_axis[1] = bisect and axis == 'Y'
    m.use_bisect_axis[2] = bisect and axis == 'Z'
    return m


def add_array(obj, count, offset=(0, 0, 0), relative=False, axis=None):
    """阵列修改器（保留可编辑）。offset 为常量位移。"""
    m = obj.modifiers.new("Array", 'ARRAY')
    m.count = count
    if relative:
        m.use_relative_offset = True
        m.relative_offset_displace = offset
    else:
        m.use_constant_offset = True
        m.constant_offset_displace = offset
    if axis is not None:
        m.use_axis[0] = axis == 'X'
        m.use_axis[1] = axis == 'Y'
        m.use_axis[2] = axis == 'Z'
    return m


def add_boolean(obj, cutter, operation='DIFFERENCE', solver='EXACT'):
    """布尔修改器（真实几何挖空）。cutter 会被标记为不导出。"""
    m = obj.modifiers.new("Boolean", 'BOOLEAN')
    m.operation = operation
    m.object = cutter
    if hasattr(m, "solver"):
        m.solver = solver
    cutter.hide_render = True
    cutter.display_type = 'WIRE'
    cutter["_lqk_cutter"] = True
    return m


def add_subsurf(obj, levels=1, render_levels=None):
    m = obj.modifiers.new("Subsurf", 'SUBSURF')
    m.levels = levels
    m.render_levels = render_levels if render_levels is not None else levels
    return m


def mirror_duplicate(obj, axis='X', new_name=None):
    """直接生成镜像副本网格（用于需要左右不同图层的场景）。"""
    me = obj.data.copy()
    dup = bpy.data.objects.new(new_name or (obj.name + "_M"), me)
    bpy.context.scene.collection.objects.link(dup)
    dup.matrix_world = Matrix.Diagonal(Vector((
        -1 if axis == 'X' else 1,
        -1 if axis == 'Y' else 1,
        -1 if axis == 'Z' else 1, 1))) @ obj.matrix_world
    return dup


def set_origin_ground_center(obj):
    """把对象原点移动到其世界包围盒的“地面中心”（x,y 中心, z 最小）。"""
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    minz = min(c.z for c in corners)
    minx = min(c.x for c in corners); maxx = max(c.x for c in corners)
    miny = min(c.y for c in corners); maxy = max(c.y for c in corners)
    new_origin = Vector(((minx + maxx) / 2.0, (miny + maxy) / 2.0, minz))
    delta = new_origin - obj.matrix_world.translation
    obj.data.transform(Matrix.Translation(-delta))
    return obj


def world_bbox(objs):
    """返回一组对象的世界包围盒 (min_xyz, max_xyz)。"""
    bpy.context.view_layer.update()
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for obj in objs:
        if obj.type != 'MESH':
            continue
        for c in obj.bound_box:
            w = obj.matrix_world @ Vector(c)
            mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
            mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
    return mn, mx


def count_triangles(objs, depsgraph=None):
    """统计三角面数（含修改器求值结果）。"""
    if depsgraph is None:
        depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in objs:
        if obj.type != 'MESH':
            continue
        ev = obj.evaluated_get(depsgraph)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
        ev.to_mesh_clear()
    return total


def collect_meshes(root=None):
    """收集根对象下全部网格对象（含未挂根但可见的）。"""
    out = []
    if root is not None:
        stack = [root]
        while stack:
            o = stack.pop()
            if o.type == 'MESH':
                out.append(o)
            stack.extend(o.children)
    else:
        out = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    return out


# =====================================================================
# 4. 曲线 / 栏杆 / 花坛等装饰件
# =====================================================================

def poly_curve(name, points, bevel_depth, mat=None, collection=None,
               bevel_resolution=2, cyclic=False, tilt=0.0):
    """由点列表生成带厚度的管状曲线（栏杆横杆、灯杆、花架等）。"""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = bevel_depth
    cu.bevel_resolution = bevel_resolution
    cu.resolution_u = 12
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (p[0], p[1], p[2], 1.0)
        sp.points[i].tilt = tilt
    sp.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, cu)
    if mat is not None:
        obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    if collection is not None:
        link_object(obj, collection)
    return obj


def create_railing(name, start, end, height=1.05, post_spacing=1.6,
                   mat=None, collection=None, post_size=0.12, rail_r=0.06):
    """沿 start→end 直线的栏杆：立柱（instancing）+ 两道横杆。"""
    s = Vector(start); e = Vector(end)
    length = (e - s).length
    n_posts = max(2, int(round(length / post_spacing)) + 1)
    objs = []
    post_proto = None
    for i in range(n_posts):
        t = i / (n_posts - 1)
        p = s.lerp(e, t)
        post = box(f"{name}_Post_{i}", (post_size, post_size, height),
                   loc=(p.x, p.y, p.z + height / 2.0), mat=mat,
                   collection=collection)
        objs.append(post)
        if post_proto is None:
            post_proto = post
    # 从第二个起用阵列修改器实例化，减少重复对象（保留编辑能力）
    if post_proto is not None and n_posts > 1:
        pass  # 为保持 .blend 可读性，这里保留独立对象；后续可换 GeometryNodes
    rails = []
    for h in (height * 0.55, height * 0.98):
        rail = box(f"{name}_Rail_{int(h*100)}",
                   (length, rail_r * 2, rail_r * 2),
                   loc=((s.x + e.x) / 2.0, (s.y + e.y) / 2.0, s.z + h),
                   mat=mat, collection=collection)
        # 让横杆沿 start→end 朝向
        angle = math.atan2(e.y - s.y, e.x - s.x)
        rail.rotation_euler = Euler((0, 0, angle), 'XYZ')
        rails.append(rail)
    return objs + rails


def create_hedge(name, start, end, height=0.7, width=0.6, mat=None,
                 collection=None, seed=0):
    """低矮绿篱：分段盒体 + 轻微随机高度，避免绝对笔直。"""
    rnd = random.Random(seed)
    s = Vector(start); e = Vector(end)
    length = (e - s).length
    segs = max(1, int(length / 1.2))
    objs = []
    angle = math.atan2(e.y - s.y, e.x - s.x)
    for i in range(segs):
        t = (i + 0.5) / segs
        p = s.lerp(e, t)
        h = height * (0.9 + rnd.random() * 0.25)
        o = box(f"{name}_Seg_{i}", (length / segs * 1.02, width, h),
                loc=(p.x, p.y, p.z + h / 2.0), mat=mat, collection=collection)
        o.rotation_euler = Euler((0, 0, angle), 'XYZ')
        add_bevel(o, 0.06, 2)
        objs.append(o)
    return objs


def create_lamp(name, loc, height=4.2, mat=None, collection=None, head_mat=None):
    """景观路灯：细杆 + 横挑臂 + 灯头。"""
    x, y, _ = loc
    parts = []
    parts.append(cylinder(f"{name}_Pole", 0.08, height, loc=(x, y, height / 2.0),
                          mat=mat, collection=collection, verts=12))
    parts.append(cylinder(f"{name}_Base", 0.16, 0.3, loc=(x, y, 0.15),
                          mat=mat, collection=collection, verts=12))
    arm = box(f"{name}_Arm", (0.6, 0.06, 0.06), loc=(x + 0.3, y, height - 0.05),
              mat=mat, collection=collection)
    parts.append(arm)
    head = sphere(f"{name}_Head", 0.16, loc=(x + 0.58, y, height - 0.12),
                  mat=head_mat or mat, collection=collection, smooth=True)
    parts.append(head)
    return parts


# =====================================================================
# 5. 导出 / 渲染 / 保存 工具（供各 build 脚本调用）
# =====================================================================

def setup_export_scene():
    """为导出/渲染准备一个干净的场景环境（删除默认相机灯光除外）。"""
    # 确保场景单位与朝向
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1.0
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.view_settings.view_transform = 'Standard'


def export_glb(filepath, objs=None, apply_modifiers=True):
    """导出所选对象为 GLB。

    - export_yup=True：一次性完成 Blender Z-up → glTF Y-up
    - export_apply=True：导出时展开修改器
    - 不导出相机与灯光
    - 跳过标了 _lqk_cutter 的布尔切割体与隐藏对象
    """
    bpy.ops.object.select_all(action='DESELECT')
    export_list = []
    if objs is None:
        export_list = [o for o in bpy.context.scene.objects
                       if o.type in ('MESH', 'EMPTY') and not o.get("_lqk_cutter")]
    else:
        for o in objs:
            if o is None:
                continue
            if o.get("_lqk_cutter"):
                continue
            export_list.append(o)
            if o.type == 'MESH':
                pass
    for o in export_list:
        o.hide_set(False)
        o.select_set(True)
    if export_list:
        bpy.context.view_layer.objects.active = next(
            (o for o in export_list if o.type == 'MESH'), export_list[0])
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=apply_modifiers,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_normals=True,
        export_texcoords=True,
        export_animations=False,
    )
    return filepath


def save_blend(filepath):
    """保存 .blend 源文件（保留可编辑对象与修改器）。"""
    bpy.ops.wm.save_as_mainfile(filepath=filepath, compress=False)


def setup_preview_lighting(warm=True):
    """配置温暖午后光照 + 世界环境（用于 Eevee 预览渲染）。"""
    scene = bpy.context.scene
    # 世界背景：浅米灰
    world = bpy.data.worlds.get("LQK_World") or bpy.data.worlds.new("LQK_World")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs[0].default_value = (0.90, 0.88, 0.83, 1.0)
    bg.inputs[1].default_value = 1.0
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    scene.world = world

    # 太阳光：暖色、低角度（午后）
    sun_data = bpy.data.lights.new("LQK_Sun", 'SUN')
    sun_data.energy = 3.2
    sun_data.angle = math.radians(3.0)
    sun_data.color = (1.0, 0.94, 0.82) if warm else (1.0, 1.0, 1.0)
    sun = bpy.data.objects.new("LQK_Sun", sun_data)
    sun.rotation_euler = Euler((math.radians(52), 0, math.radians(38)), 'XYZ')
    scene.collection.objects.link(sun)

    # 补光：柔和天空填充
    fill_data = bpy.data.lights.new("LQK_Fill", 'AREA')
    fill_data.energy = 220.0
    fill_data.size = 40.0
    fill_data.color = (0.82, 0.88, 1.0)
    fill = bpy.data.objects.new("LQK_Fill", fill_data)
    fill.location = (-30, -30, 35)
    fill.rotation_euler = Euler((math.radians(35), 0, math.radians(-45)), 'XYZ')
    scene.collection.objects.link(fill)

    # 顶部柔光：营造接触阴影与体积感
    top_data = bpy.data.lights.new("LQK_Top", 'AREA')
    top_data.energy = 900.0
    top_data.size = 120.0
    top_data.color = (1.0, 0.97, 0.92)
    top = bpy.data.objects.new("LQK_Top", top_data)
    top.location = (0, 0, 70)
    top.rotation_euler = Euler((0, 0, 0), 'XYZ')
    scene.collection.objects.link(top)
    return sun, fill


def render_views(output_prefix, target_objs, views=("front", "side", "top", "three_quarter"),
                 resolution=(900, 700), engine='BLENDER_EEVEE', samples=48,
                 margin=1.10, bg=(0.90, 0.88, 0.83), ground_shadow=True):
    """对一组对象渲染多角度预览图，写入 <output_prefix>_<view>.png。

    使用正交相机自动取景，保证对象完整入画；可选临时地面用于接触阴影
    （该地面只在渲染期间存在，不影响导出的 GLB）。
    """
    scene = bpy.context.scene
    scene.render.engine = engine
    if engine == 'BLENDER_EEVEE':
        try:
            scene.eevee.taa_render_samples = samples
        except Exception:
            pass
        for attr, val in (("use_gtao", True), ("use_shadows", True),
                          ("use_raytracing", True), ("use_bloom", False)):
            if hasattr(scene.eevee, attr):
                try:
                    setattr(scene.eevee, attr, val)
                except Exception:
                    pass
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'

    # 取景
    mn, mx = world_bbox(target_objs)
    center = (mn + mx) * 0.5
    size = mx - mn
    radius = max(size.x, size.y, size.z) * 0.5
    if radius <= 1e-6:
        radius = 1.0

    # 临时地面（仅用于观感/接触阴影）
    ground = None
    if ground_shadow:
        gmat = pbr("MAT_RENDER_GROUND", (0.80, 0.77, 0.72), rough=0.95)
        span = max(size.x, size.y) * 3.0 + 30.0
        ground = box("_RenderGround", (span, span, 0.2),
                     loc=(center.x, center.y, mn.z - 0.11), mat=gmat)
        # 顶部柔和补光营造接触阴影
        for attr, val in (("use_shadow", True),):
            if hasattr(ground, attr):
                setattr(ground, attr, val)

    cam_data = bpy.data.cameras.get("LQK_PreviewCam")
    if cam_data is None:
        cam_data = bpy.data.cameras.new("LQK_PreviewCam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = radius * 2.0 * margin
    cam = bpy.data.objects.get("LQK_PreviewCam")
    if cam is None:
        cam = bpy.data.objects.new("LQK_PreviewCam", cam_data)
        scene.collection.objects.link(cam)
    scene.camera = cam

    dist = radius * 4.0 + 10.0
    dirs = {
        "front": Vector((0, -1, 0.18)),
        "back": Vector((0, 1, 0.18)),
        "side": Vector((1, 0, 0.18)),
        "left": Vector((-1, 0, 0.18)),
        "top": Vector((0.001, 0.001, 1)),
        "three_quarter": Vector((-0.85, -0.85, 0.55)),
    }
    outputs = []
    for v in views:
        d = dirs.get(v, Vector((0, -1, 0.2)))
        eye = center + d.normalized() * dist
        cam.location = eye
        # 朝向 center
        look = (center - eye)
        cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
        path = f"{output_prefix}_{v}.png"
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        outputs.append(path)
    if ground is not None:
        bpy.data.objects.remove(ground, do_unlink=True)
    return outputs