"""
Entry point:  blender -b -P art/blender/build.py -- <model> [<model> ...]
Writes public/models/<model>.glb and art/previews/<model>.png.
"""
import importlib
import os
import sys

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
