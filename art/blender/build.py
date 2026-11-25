"""
Entry point:  blender -b -P art/blender/build.py -- <model> [<model> ...]
Writes public/models/<model>.glb and art/previews/<model>.png, and saves the built scene as
art/previews/<model>.blend to open and inspect in Blender's window (running this script with the window open fails:
operators such as join have no usable context before the window is ready). A .blend saved since the last build (edited
by hand) is never overwritten: it is moved aside to <model>.edited-<time>.blend first.
"""
import bpy
import importlib
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

names = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for name in names:
    mod = importlib.import_module(name)
    mod.build(
        os.path.join(ROOT, "public", "models", f"{name}.glb"),
        os.path.join(ROOT, "art", "previews", f"{name}.png"),
    )
    blend = os.path.join(ROOT, "art", "previews", f"{name}.blend")
    stamp = blend + ".built"  # the modification time the build left the .blend with
    if os.path.exists(blend):
        built = open(stamp).read().strip() if os.path.exists(stamp) else ""
        if str(os.path.getmtime(blend)) != built:
            kept = blend.replace(".blend", time.strftime(".edited-%Y%m%d-%H%M%S.blend"))
            os.replace(blend, kept)
            print("kept the hand-edited scene as", kept)
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    with open(stamp, "w") as f:
        f.write(str(os.path.getmtime(blend)))
