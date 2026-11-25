"""
Exports a .blend edited by hand to the game's .glb, with the same settings as build.py:
    blender -b <edited.blend> -P art/blender/export_blend.py -- <out.glb> [<built.blend>]
Exports the armature and every object parented to it. With <built.blend>, objects found there but missing from the
edited file are appended first, so a part deleted by accident does not vanish from the game. The edited file is not saved.
"""
import bpy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
out = os.path.abspath(args[0])
rig = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")

if len(args) > 1:
    have = {o.name for o in bpy.data.objects}
    with bpy.data.libraries.load(os.path.abspath(args[1])) as (src, dst):
        dst.objects = [n for n in src.objects if n not in have]
    for o in dst.objects:
        if o.parent and o.parent.type == "ARMATURE":  # the built file's rig comes along as a copy; re-parent to ours
            bpy.context.scene.collection.objects.link(o)
            mw = o.matrix_world.copy()
            o.parent = rig
            o.matrix_world = mw
            for m in o.modifiers:
                if m.type == "ARMATURE":
                    m.object = rig
            print("restored", o.name)

objs = [rig] + [o for o in bpy.context.scene.objects if o.parent == rig]
lib.export_glb(out, objs)
print("exported", len(objs), "objects to", out)
