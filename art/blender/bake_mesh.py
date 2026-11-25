"""
Saves meshes edited by hand in Blender as data the build loads instead of generating them:
    blender -b <edited.blend> -P art/blender/bake_mesh.py -- <object> [<object> ...]
Writes art/blender/baked/<object>.json: world-space vertices and faces (the build re-parents the part itself).
"""
import bpy
import json
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baked")
os.makedirs(OUT, exist_ok=True)

for name in sys.argv[sys.argv.index("--") + 1:]:
    obj = bpy.data.objects[name]
    mw = obj.matrix_world
    data = {
        "verts": [[round(c, 5) for c in mw @ v.co] for v in obj.data.vertices],
        "faces": [list(p.vertices) for p in obj.data.polygons],
    }
    with open(os.path.join(OUT, f"{name}.json"), "w") as f:
        f.write('{"verts": [\n' + ",\n".join(json.dumps(v) for v in data["verts"]) + '\n],\n"faces": [\n'
                + ",\n".join(json.dumps(p) for p in data["faces"]) + "\n]}\n")
    print("baked", name, len(data["verts"]), "verts", len(data["faces"]), "faces")
