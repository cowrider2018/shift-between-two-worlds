"""
Saves meshes edited by hand in Blender as data the build loads instead of generating them:
    blender -b <edited.blend> -P art/blender/bake_mesh.py -- <object> [<object> ...]
Writes art/blender/baked/<object>.json: world-space vertices and faces (the build re-parents the part itself).

Blender's viewport draws both sides of a face, the game only the front, so a face flipped while editing shows in
Blender but is a hole in the game. Each face is therefore turned to its open side: rays are cast over the half-sphere
on either side of it (against the object itself), and a face whose back sees more open sky than its front is flipped.
"""
import bpy
import json
import math
import os
import sys

from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baked")
RAYS = 48  # per side
EPS = 1e-4


def _hemisphere(n):
    """RAYS directions spread over the half-sphere around n (a Fibonacci spiral)."""
    t = n.orthogonal().normalized()
    b = n.cross(t)
    golden = math.pi * (3 - math.sqrt(5))
    for k in range(RAYS):
        z = 1 - (k + 0.5) / RAYS
        r = math.sqrt(1 - z * z)
        a = k * golden
        yield (t * (r * math.cos(a)) + b * (r * math.sin(a)) + n * z).normalized()


def _open(tree, p, n):
    return sum(tree.ray_cast(p + n * EPS, d)[0] is None for d in _hemisphere(n))


def outward(verts, faces):
    """faces, each wound so that its front is the side that sees more open sky."""
    tree = BVHTree.FromPolygons(verts, faces)
    fixed = []
    for f in faces:
        pts = [verts[i] for i in f]
        c = sum(pts, Vector()) / len(pts)
        n = Vector()
        for a, b in zip(pts, pts[1:] + pts[:1]):  # Newell's normal: sound for bent faces with many sides
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if n.length == 0:
            fixed.append(f)
            continue
        n.normalize()
        fixed.append(f[::-1] if _open(tree, c, -n) > _open(tree, c, n) else f)
    return fixed


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name in sys.argv[sys.argv.index("--") + 1:]:
        obj = bpy.data.objects[name]
        mw = obj.matrix_world
        verts = [mw @ v.co for v in obj.data.vertices]
        faces = outward(verts, [list(p.vertices) for p in obj.data.polygons])
        flipped = sum(f != list(p.vertices) for f, p in zip(faces, obj.data.polygons))
        with open(os.path.join(OUT, f"{name}.json"), "w") as fh:
            fh.write('{"verts": [\n' + ",\n".join(json.dumps([round(c, 5) for c in v]) for v in verts)
                     + '\n],\n"faces": [\n' + ",\n".join(json.dumps(f) for f in faces) + "\n]}\n")
        print("baked", name, len(verts), "verts", len(faces), "faces,", flipped, "turned to face out")
