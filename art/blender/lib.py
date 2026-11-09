"""
Shared helpers for the character build scripts (run inside Blender, background mode).

Pipeline per character (DESIGN §4.2):
  anatomy as metaball ellipsoids  ->  voxel remesh  ->  decimate  ->  flat shading
  -> region materials (nearest anatomical shape)  ->  armature + auto weights  ->  actions  ->  .glb + previews

Conventions: Blender units = tiles. Z up, the character faces +X, feet on z = 0.
glTF export converts to Y-up keeping +X forward, which is what the game expects.
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils import Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
with open(os.path.join(ROOT, "art", "palette.json"), encoding="utf8") as f:
    PALETTE = json.load(f)

X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))


# ---------------------------------------------------------------------------
# scene / materials

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 24


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    """Material named after a palette key; the game re-maps it by name."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    hexs = PALETTE[name]["color"].lstrip("#")
    rgb = [srgb_to_linear(int(hexs[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    tree = getattr(m, "node_tree", None)
    if tree is None and hasattr(m, "use_nodes"):
        m.use_nodes = True
        tree = m.node_tree
    if tree:
        bsdf = tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*rgb, 1)
            if PALETTE[name].get("emissive"):
                bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
                bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


def apply_modifiers(obj):
    """Bake the modifier stack into the mesh without operators."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    bpy.data.meshes.remove(old)


def flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ---------------------------------------------------------------------------
# anatomy as metaballs

_K = None


def _metaball_k():
    """Visible radius of a unit-radius ball at our threshold / stiffness (measured, not assumed)."""
    global _K
    if _K is None:
        mb = bpy.data.metaballs.new("calib")
        mb.resolution = 0.02
        mb.threshold = 0.6
        el = mb.elements.new(type="BALL")
        el.radius = 1.0
        el.stiffness = 2.0
        obj = link(bpy.data.objects.new("calib", mb))
        bpy.context.view_layer.update()
        me = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        _K = max(v.co.length for v in me.vertices)
        bpy.data.objects.remove(obj)
        bpy.data.meshes.remove(me)
        bpy.data.metaballs.remove(mb)
    return _K


def align(direction):
    """Rotation taking +X onto `direction`."""
    return X.rotation_difference(Vector(direction).normalized())


class Anatomy:
    """Collects ellipsoid volumes (with region tags) and fuses them into one smooth body."""

    def __init__(self, name, resolution=0.008):
        self.name = name
        self.mb = bpy.data.metaballs.new(name + "_mb")
        self.mb.resolution = resolution
        self.mb.render_resolution = resolution
        self.mb.threshold = 0.6
        self.obj = link(bpy.data.objects.new(name + "_mb", self.mb))
        self.shapes = []  # (centre, rotation, semi-axes, tag)

    def ell(self, c, semi, tag, rot=None, stiffness=2.0, negative=False):
        """Ellipsoid with *visible* semi-axes `semi` (in its rotated frame)."""
        c = Vector(c)
        semi = Vector(semi)
        rot = rot or Quaternion()
        r = max(semi)
        el = self.mb.elements.new(type="ELLIPSOID")
        el.co = c
        el.radius = r / _metaball_k()
        el.size_x, el.size_y, el.size_z = semi.x / r, semi.y / r, semi.z / r
        el.rotation = rot
        el.stiffness = stiffness
        el.use_negative = negative
        if not negative:
            self.shapes.append((c, rot, semi, tag))

    def cut(self, c, semi, rot=None):
        """Negative volume (eye sockets, nostrils, mouth)."""
        self.ell(c, semi, None, rot, stiffness=2.0, negative=True)

    def seg(self, a, b, r, tag, r2=None, offset=(0, 0, 0), length=1.0, roll=0.0):
        """Ellipsoid spanning joint a -> b. Local y/z radii r / r2 (y stays roughly world-lateral)."""
        a, b = Vector(a), Vector(b)
        d = b - a
        rot = align(d)
        if roll:
            rot = Quaternion(d.normalized(), roll) @ rot
        self.ell((a + b) / 2 + Vector(offset), (d.length / 2 * length, r, r2 if r2 is not None else r), tag, rot)

    def build(self, target_tris, voxel=0.007):
        """Fuse -> remesh -> decimate -> flat shade -> region materials. Returns the mesh object."""
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(self.obj.evaluated_get(dg))
        obj = link(bpy.data.objects.new(self.name, me))
        bpy.data.objects.remove(self.obj)
        bpy.data.metaballs.remove(self.mb)

        rm = obj.modifiers.new("remesh", "REMESH")
        rm.mode = "VOXEL"
        rm.voxel_size = voxel
        apply_modifiers(obj)
        dec = obj.modifiers.new("decimate", "DECIMATE")
        dec.ratio = min(1.0, target_tris / max(1, tri_count(obj)))
        apply_modifiers(obj)
        flat(obj)
        self._paint(obj)
        return obj

    def _paint(self, obj):
        tags = sorted({s[3] for s in self.shapes})
        for t in tags:
            obj.data.materials.append(material(t))
        index = {t: i for i, t in enumerate(tags)}
        inv = [(c, rot.inverted(), semi, tag) for c, rot, semi, tag in self.shapes]
        for p in obj.data.polygons:
            pc = p.center
            best, best_d = None, 1e9
            for c, rinv, semi, tag in inv:
                q = rinv @ (pc - c)
                n = Vector((q.x / semi.x, q.y / semi.y, q.z / semi.z)).length
                d = q.length * (1 - 1 / n) if n > 1e-6 else -min(semi)  # approx. signed distance
                if d < best_d:
                    best, best_d = tag, d
            p.material_index = index[best]


# ---------------------------------------------------------------------------
# rigid low-poly props

def mesh_from(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([Vector(v) for v in verts], [], faces)
    me.update()
    obj = link(bpy.data.objects.new(name, me))
    me.materials.append(material(mat))
    flat(obj)
    return obj


def ico(name, c, r, mat, subdiv=1, scale=(1, 1, 1)):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])) + Vector(c)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    me.materials.append(material(mat))
    flat(obj)
    return obj


def box(name, c, half, mat, rot=None):
    hx, hy, hz = half
    vs = [Vector((sx * hx, sy * hy, sz * hz)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    if rot:
        vs = [rot @ v for v in vs]
    vs = [v + Vector(c) for v in vs]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh_from(name, vs, faces, mat)


def cone(name, base, tip, r, mat, sides=4):
    base, tip = Vector(base), Vector(tip)
    rot = Z.rotation_difference((tip - base).normalized())
    vs = [base + rot @ Vector((math.cos(a) * r, math.sin(a) * r, 0)) for a in (i * 2 * math.pi / sides for i in range(sides))]
    vs.append(tip)
    faces = [(i, (i + 1) % sides, sides) for i in range(sides)] + [tuple(reversed(range(sides)))]
    return mesh_from(name, vs, faces, mat)


# ---------------------------------------------------------------------------
# rigging & animation

def set_active(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def armature(name, bones):
    """bones: [(name, head, tail, parent)]."""
    arm = bpy.data.armatures.new(name)
    obj = link(bpy.data.objects.new(name, arm))
    set_active(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    for n, h, t, p in bones:
        eb = arm.edit_bones.new(n)
        eb.head, eb.tail = Vector(h), Vector(t)
        eb.roll = 0
        if p:
            eb.parent = arm.edit_bones[p]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def skin(mesh_obj, arm_obj):
    set_active(arm_obj)
    mesh_obj.select_set(True)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def attach(obj, arm_obj, bone):
    """Rigidly parent a prop to a bone, keeping its world placement."""
    bpy.context.view_layer.update()
    mw = obj.matrix_world.copy()
    obj.parent = arm_obj
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = mw


def _pose_rotation(arm_obj, bone, rotations):
    """rotations: [(world_axis, degrees)] applied in armature space at the bone's rest frame."""
    rest = arm_obj.data.bones[bone].matrix_local.to_quaternion()
    q = Quaternion()
    for axis, deg in rotations:
        q = Quaternion(Vector(axis), math.radians(deg)) @ q
    return rest.inverted() @ q @ rest


def action(arm_obj, name, keys, lift_bone="root"):
    """
    keys: {frame: {bone: [(axis, deg), ...], "_lift": metres}}
    Every bone is keyed on every key frame so actions never leak into each other.
    """
    arm_obj.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm_obj.animation_data.action = act
    for frame, pose in sorted(keys.items()):
        for pb in arm_obj.pose.bones:
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = _pose_rotation(arm_obj, pb.name, pose.get(pb.name, []))
            pb.location = (0, 0, 0)
            if pb.name == lift_bone:
                pb.location = (0, pose.get("_lift", 0.0), 0)  # root bone points +Z, so local Y is up
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            pb.keyframe_insert("location", frame=frame)
    arm_obj.animation_data.action = None
    return act


def export_glb(path, objs):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_materials="EXPORT",
    )


# ---------------------------------------------------------------------------
# previews

def _camera(name, loc, target, ortho_scale=None, lens=35):
    cam = bpy.data.cameras.new(name)
    if ortho_scale:
        cam.type = "ORTHO"
        cam.ortho_scale = ortho_scale
    else:
        cam.lens = lens
    obj = link(bpy.data.objects.new(name, cam))
    obj.location = Vector(loc)
    obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return obj


def _render(cam, path, w, h):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def previews(out_png, height, head=None):
    """
    3x2 sheet. Top: front, side, 3/4. Bottom: head close-up 3/4, head close-up side,
    in-game view (30° camera, 1/3 resolution, nearest upscale).
    """
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_object_outline = True
    sh.object_outline_color = (0.05, 0.04, 0.06)
    sh.show_cavity = True
    sc.world = sc.world or bpy.data.worlds.new("w")
    sc.world.color = (0.08, 0.08, 0.1)
    sc.render.image_settings.file_format = "PNG"

    c = Vector((0, 0, height * 0.5))
    s = height * 1.25
    d = height * 4
    q34 = (X * 0.8 + Y * 0.6 + Z * 0.25).normalized()
    hc = Vector(head) if head else Vector((0, 0, height * 0.85))
    tmp = os.path.join(os.path.dirname(out_png), "_tmp.png")
    tiles = [
        _render(_camera("front", c + X * d, c, s), tmp, 400, 400),
        _render(_camera("side", c + Y * d, c, s), tmp, 400, 400),
        _render(_camera("q34", c + q34 * d, c, s), tmp, 400, 400),
        _render(_camera("head34", hc + q34 * d, hc, height * 0.45), tmp, 400, 400),
        _render(_camera("headside", hc + Y * d, hc, height * 0.45), tmp, 400, 400),
    ]
    e = math.radians(30)
    tgt = Vector((0, 0, 0.75))
    loc = tgt + (X * 0.8 + Y * 0.6).normalized() * 5.2 * math.cos(e) + Z * 5.2 * math.sin(e)
    game = _render(_camera("game", loc, tgt, lens=34), tmp, 133, 133)
    game = np.repeat(np.repeat(game, 3, axis=0), 3, axis=1)
    pad = np.zeros((400, 400, 4), dtype=np.float32)
    pad[:399, :399] = game
    tiles.append(pad)
    # image rows are bottom-up in Blender
    sheet = np.vstack([np.hstack(tiles[3:6]), np.hstack(tiles[0:3])])
    img = bpy.data.images.new("sheet", 1200, 800, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = out_png
    img.file_format = "PNG"
    img.save()
    os.remove(tmp)
