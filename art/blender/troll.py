"""
Troll (DESIGN §4.2): dark violet-grey, stout and hunched, pot belly, huge drooping nose,
wide wing-like ears that flare sideways and sag, heavy brow, long arms, short thick legs.
Faces +X, feet on z = 0, ~1.4 tiles tall.
"""
import math

from mathutils import Quaternion, Vector

import lib
from lib import X, Y, Z

HEIGHT = 1.42

# ---------------------------------------------------------------------------
# skeleton landmarks (left side; right side mirrors y)
J = {
    "pelvis": (0.00, 0.00, 0.52),
    "spine": (0.04, 0.00, 0.70),
    "chest": (0.05, 0.00, 0.88),
    "neck": (0.13, 0.00, 1.00),
    "head": (0.20, 0.00, 1.12),
    "shoulder": (0.03, 0.25, 0.93),
    "elbow": (0.03, 0.37, 0.67),
    "wrist": (0.11, 0.41, 0.45),
    "hand": (0.15, 0.43, 0.34),
    "hip": (0.00, 0.12, 0.48),
    "knee": (0.08, 0.16, 0.27),
    "ankle": (0.00, 0.17, 0.08),
    "toe": (0.20, 0.18, 0.03),
}


# The head is modelled around HEAD_REF and then moved / scaled into place:
# bigger (cartoon proportions) and lower + further forward (hunch).
HEAD_REF = Vector((0.20, 0.00, 1.12))
HEAD_AT = Vector((0.25, 0.00, 1.05))
HEAD_SCALE = 1.32
EAR_SPREAD = 1.25


def hp(p):
    return HEAD_AT + (Vector(p) - HEAD_REF) * HEAD_SCALE


def hv(v):
    return tuple(c * HEAD_SCALE for c in v)


def L(name, s=1):
    x, y, z = J[name]
    return Vector((x, y * s, z))


def build_body():
    a = lib.Anatomy("troll_body")
    skin, belly, nose, ear, nail = "troll_skin", "troll_belly", "troll_nose", "troll_ear", "troll_nail"

    # --- torso -----------------------------------------------------------
    a.ell((0.02, 0, 0.86), (0.15, 0.21, 0.15), skin)                       # rib cage
    a.ell((0.00, 0, 0.97), (0.14, 0.19, 0.09), skin, Quaternion(Y, 0.55))   # trapezius hump (hunch)
    for s in (1, -1):
        a.ell((0.12, 0.09 * s, 0.85), (0.06, 0.085, 0.065), skin, Quaternion(Y, 0.3))  # sagging pecs
        a.ell((0.02, 0.17 * s, 0.80), (0.08, 0.05, 0.10), skin)                       # lats / flank
    a.ell((0.12, 0, 0.64), (0.19, 0.20, 0.19), belly)                      # pot belly
    a.cut((0.31, 0, 0.61), (0.014, 0.014, 0.018))                          # navel
    a.ell((-0.04, 0, 0.66), (0.11, 0.18, 0.13), skin)                      # lower back
    a.ell((0.00, 0, 0.52), (0.12, 0.17, 0.09), skin)                       # pelvis
    for s in (1, -1):
        a.ell((-0.08, 0.075 * s, 0.50), (0.085, 0.085, 0.09), skin)       # glutes

    # --- neck & head ------------------------------------------------------
    a.seg(L("chest") + Vector((0.03, 0, 0.05)), hp((0.15, 0, 1.08)), 0.085, skin)
    a.ell(hp((0.13, 0, 1.15)), hv((0.15, 0.135, 0.125)), skin)                     # cranium
    a.ell(hp((0.07, 0, 1.13)), hv((0.10, 0.12, 0.11)), skin)                       # occiput
    a.ell(hp((0.265, 0, 1.175)), hv((0.04, 0.115, 0.03)), skin, Quaternion(Y, -0.2))  # brow ridge
    for s in (1, -1):
        a.ell(hp((0.25, 0.095 * s, 1.19)), hv((0.035, 0.04, 0.022)), skin, Quaternion(X, 0.5 * s))  # raised brow corners
        a.ell(hp((0.255, 0.085 * s, 1.085)), hv((0.04, 0.05, 0.035)), skin)       # cheekbones
        a.cut(hp((0.30, 0.055 * s, 1.135)), hv((0.03, 0.028, 0.024)))             # eye sockets
    a.ell(hp((0.235, 0, 1.02)), hv((0.09, 0.11, 0.06)), skin)                      # heavy jaw
    a.ell(hp((0.305, 0, 0.995)), hv((0.035, 0.055, 0.035)), skin)                  # chin
    a.ell(hp((0.29, 0, 1.06)), hv((0.05, 0.085, 0.03)), skin)                      # muzzle / upper lip
    a.cut(hp((0.335, 0, 1.032)), hv((0.02, 0.06, 0.008)))                         # mouth slit

    # big drooping nose
    a.seg(hp((0.285, 0, 1.15)), hp((0.37, 0, 1.06)), 0.028 * HEAD_SCALE, nose, r2=0.032 * HEAD_SCALE)
    a.ell(hp((0.39, 0, 1.035)), hv((0.06, 0.052, 0.066)), nose, Quaternion(Y, 0.4))       # bulb
    for s in (1, -1):
        a.ell(hp((0.36, 0.035 * s, 1.03)), hv((0.025, 0.022, 0.02)), nose)        # nostril wings
        a.cut(hp((0.405, 0.022 * s, 1.012)), hv((0.012, 0.01, 0.01)))             # nostrils

    # wing-like ears: flare sideways, thin front-to-back, sag towards the tip
    for s in (1, -1):
        droop = Quaternion(X, -0.25 * s)
        e = EAR_SPREAD
        a.ell(hp((0.12, 0.17 * s, 1.14)), hv((0.024, 0.08, 0.085)), ear, droop)
        a.ell(hp((0.11, (0.17 + 0.11 * e) * s, 1.12)), hv((0.019, 0.085 * e, 0.062)), ear, droop)
        a.ell(hp((0.10, (0.17 + 0.21 * e) * s, 1.085)), hv((0.016, 0.07 * e, 0.038)), ear, droop)
        a.ell(hp((0.095, (0.17 + 0.29 * e) * s, 1.06)), hv((0.012, 0.04 * e, 0.017)), ear, droop)  # tip

    # --- arms (long, knuckles near the knees) -----------------------------
    for s in (1, -1):
        sh, el, wr, ha = L("shoulder", s), L("elbow", s), L("wrist", s), L("hand", s)
        a.ell(sh + Vector((0, 0.03 * s, 0)), (0.095, 0.08, 0.09), skin)               # deltoid
        a.seg(sh, el, 0.06, skin)                                                    # upper arm core
        a.seg(sh, el, 0.045, skin, offset=(0.035, 0, 0), length=0.7)                 # biceps
        a.seg(sh, el, 0.045, skin, offset=(-0.03, 0.005 * s, 0.02), length=0.75)     # triceps
        a.ell(el, (0.05, 0.05, 0.05), skin)                                          # elbow
        a.seg(el, el.lerp(wr, 0.55), 0.06, skin, r2=0.065)                            # forearm (thick)
        a.seg(el.lerp(wr, 0.4), wr, 0.04, skin, r2=0.048)                             # wrist taper
        a.seg(wr, ha, 0.03, skin, r2=0.055)                                           # palm (thin across y)
        # three thick fingers + thumb, curled towards the body
        for i, dx in enumerate((-0.03, 0.0, 0.03)):
            base = ha + Vector((dx, -0.005 * s, 0.01))
            mid = base + Vector((0.005, -0.012 * s, -0.055))
            tip = mid + Vector((0.01, -0.03 * s, -0.035))
            a.seg(base, mid, 0.018, skin)
            a.seg(mid, tip, 0.015, skin)
            a.ell(tip + Vector((0.0, -0.004 * s, -0.004)), (0.012, 0.01, 0.01), nail)
        tb = wr.lerp(ha, 0.4) + Vector((0.045, -0.01 * s, 0))
        tt = tb + Vector((0.045, -0.02 * s, -0.04))
        a.seg(tb, tt, 0.02, skin)
        a.ell(tt + Vector((0.008, -0.005 * s, -0.006)), (0.011, 0.01, 0.01), nail)

    # --- legs (short, thick) -----------------------------------------------
    for s in (1, -1):
        hj, kn, an, to = L("hip", s), L("knee", s), L("ankle", s), L("toe", s)
        a.seg(hj, kn, 0.095, skin, r2=0.1)                                      # thigh
        a.seg(hj, kn, 0.06, skin, offset=(0.04, 0, 0), length=0.75)             # quadriceps
        a.ell(kn + Vector((0.035, 0, 0)), (0.05, 0.06, 0.055), skin)            # knee cap
        a.seg(kn, an, 0.055, skin)                                              # shin
        a.seg(kn, kn.lerp(an, 0.7), 0.06, skin, offset=(-0.035, 0, 0), length=0.8)  # calf
        a.ell(an + Vector((0, 0, 0.005)), (0.045, 0.05, 0.045), skin)           # ankle
        a.seg(an + Vector((-0.05, 0, -0.04)), to, 0.06, skin, r2=0.035)          # foot
        a.ell(an + Vector((-0.06, 0, -0.035)), (0.045, 0.045, 0.04), skin)      # heel
        for dy in (-0.035, 0.0, 0.035):
            tb = to + Vector((-0.01, dy * s, 0.0))
            tt = tb + Vector((0.05, dy * 0.3 * s, -0.005))
            a.seg(tb, tt, 0.02, skin)
            a.ell(tt + Vector((0.008, 0, 0.004)), (0.012, 0.012, 0.009), nail)

    return a.build(target_tris=6000)


def build_props():
    """Eyes, fangs, loincloth, rope belt, lantern (rigid low-poly pieces)."""
    out = {}
    for s, side in ((1, "L"), (-1, "R")):
        k = HEAD_SCALE
        out[f"eye.{side}"] = (lib.ico(f"eye.{side}", hp((0.287, 0.055 * s, 1.133)), 0.022 * k, "troll_eye", 1), "head")
        out[f"fang.{side}"] = (lib.cone(f"fang.{side}", hp((0.33, 0.042 * s, 1.022)), hp((0.338, 0.046 * s, 1.07)), 0.011 * k, "troll_tooth", 4), "head")

    # loincloth: a ragged skirt hanging from the belt, longer at the front
    n = 16
    top, verts, faces = [], [], []
    for i in range(n):
        t = i / n * 2 * math.pi
        rx, ry = 0.205, 0.215
        x, y = math.cos(t) * rx + 0.03, math.sin(t) * ry
        front = max(0.0, math.cos(t))
        drop = 0.13 + 0.07 * front + (0.025 if i % 2 else 0.0)
        verts.append((x, y, 0.57))
        verts.append((x * 1.08 + 0.01, y * 1.08, 0.57 - drop))
    for i in range(n):
        j = (i + 1) % n
        faces.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    out["loincloth"] = (lib.mesh_from("loincloth", verts, faces, "cloth"), "hips")

    # rope belt: a low-poly ring
    ring_v, ring_f, m, k = [], [], 12, 4
    for i in range(m):
        t = i / m * 2 * math.pi
        cx, cy = math.cos(t) * 0.215 + 0.03, math.sin(t) * 0.225
        for j in range(k):
            u = j / k * 2 * math.pi
            rr = 0.016
            ring_v.append((cx + math.cos(t) * math.cos(u) * rr, cy + math.sin(t) * math.cos(u) * rr, 0.575 + math.sin(u) * rr))
    for i in range(m):
        for j in range(k):
            a, b = i * k + j, ((i + 1) % m) * k + j
            ring_f.append((a, b, ((i + 1) % m) * k + (j + 1) % k, i * k + (j + 1) % k))
    out["belt"] = (lib.mesh_from("belt", ring_v, ring_f, "rope"), "hips")

    # lantern hanging from the right fist
    h = L("hand", -1) + Vector((0.03, 0.0, -0.13))
    out["lantern_frame"] = (lib.box("lantern_frame", h, (0.045, 0.045, 0.06), "metal"), "hand.R")
    out["lantern_glow"] = (lib.box("lantern_glow", h, (0.038, 0.048, 0.045), "lantern"), "hand.R")
    out["lantern_handle"] = (lib.box("lantern_handle", h + Vector((0, 0, 0.08)), (0.006, 0.006, 0.03), "metal"), "hand.R")
    return out


def build_rig():
    b = [
        ("root", (0, 0, 0), (0, 0, 0.2), None),
        ("hips", J["pelvis"], J["spine"], "root"),
        ("spine", J["spine"], J["chest"], "hips"),
        ("chest", J["chest"], J["neck"], "spine"),
        ("neck", J["neck"], tuple(hp((0.15, 0, 1.08))), "chest"),
        ("head", tuple(hp((0.15, 0, 1.08))), tuple(hp((0.30, 0, 1.24))), "neck"),
    ]
    for s, side in ((1, "L"), (-1, "R")):
        P = lambda n: tuple(L(n, s))
        b += [
            (f"ear.{side}", tuple(hp((0.12, 0.15 * s, 1.14))), tuple(hp((0.10, (0.17 + 0.29 * EAR_SPREAD) * s, 1.06))), "head"),
            (f"upper_arm.{side}", P("shoulder"), P("elbow"), "chest"),
            (f"forearm.{side}", P("elbow"), P("wrist"), f"upper_arm.{side}"),
            (f"hand.{side}", P("wrist"), tuple(L("hand", s) + Vector((0, 0, -0.08))), f"forearm.{side}"),
            (f"thigh.{side}", P("hip"), P("knee"), "hips"),
            (f"shin.{side}", P("knee"), P("ankle"), f"thigh.{side}"),
            (f"foot.{side}", P("ankle"), P("toe"), f"shin.{side}"),
        ]
    return lib.armature("troll_rig", b)


def build_actions(rig):
    """idle (2 s), walk (1 s waddle), alert (head up, ears perk)."""
    def walk_pose(phase):
        c = math.cos(phase * 2 * math.pi)
        sn = math.sin(phase * 2 * math.pi)
        return {
            "thigh.L": [(Y, -24 * c)], "thigh.R": [(Y, 24 * c)],
            "shin.L": [(Y, 22 * max(0, sn))], "shin.R": [(Y, 22 * max(0, -sn))],
            "foot.L": [(Y, 8 * c)], "foot.R": [(Y, -8 * c)],
            "upper_arm.L": [(Y, 20 * c)], "upper_arm.R": [(Y, -20 * c)],
            "forearm.L": [(Y, -15 - 8 * c)], "forearm.R": [(Y, -15 + 8 * c)],
            "hips": [(X, 5 * c)],                       # waddle
            "chest": [(X, -4 * c), (Y, 4)],
            "head": [(X, 3 * c)],
            "ear.L": [(X, 6 * sn)], "ear.R": [(X, 6 * sn)],
            "_lift": 0.025 * abs(sn),
        }

    lib.action(rig, "walk", {f: walk_pose((f - 1) / 24) for f in range(1, 26, 3)})

    def idle_pose(phase):
        b = math.sin(phase * 2 * math.pi)
        return {
            "spine": [(Y, 2 * b)], "chest": [(Y, 2 * b)],
            "head": [(Y, -2 * b), (Z, 4 * math.sin(phase * 2 * math.pi * 0.5 + 1))],
            "upper_arm.L": [(X, -3 * b)], "upper_arm.R": [(X, 3 * b)],
            "forearm.L": [(Y, -12)], "forearm.R": [(Y, -12)],
            "ear.L": [(X, 4 * b)], "ear.R": [(X, -4 * b)],
            "_lift": -0.006 * b,
        }

    lib.action(rig, "idle", {f: idle_pose((f - 1) / 48) for f in range(1, 50, 6)})

    alert = {
        "chest": [(Y, -6)], "neck": [(Y, -8)], "head": [(Y, -10)],
        "ear.L": [(X, -14)], "ear.R": [(X, 14)],
        "upper_arm.L": [(X, -12)], "upper_arm.R": [(X, 12)],
        "forearm.L": [(Y, -25)], "forearm.R": [(Y, -25)],
        "thigh.L": [(Y, -6)], "thigh.R": [(Y, -6)], "shin.L": [(Y, 10)], "shin.R": [(Y, 10)],
    }
    lib.action(rig, "alert", {1: alert, 13: alert})


def build(out_glb, out_preview):
    lib.reset()
    body = build_body()
    props = build_props()
    rig = build_rig()
    lib.skin(body, rig)
    for obj, bone in props.values():
        lib.attach(obj, rig, bone)
    build_actions(rig)
    objs = [rig, body] + [o for o, _ in props.values()]
    lib.export_glb(out_glb, objs)
    lib.previews(out_preview, HEIGHT, head=hp((0.22, 0, 1.12)))
    print(f"troll: {lib.tri_count(body)} body tris, {sum(lib.tri_count(o) for o, _ in props.values())} prop tris")
