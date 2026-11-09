"""
Hero (DESIGN §4.2): small chibi adventurer — the original primitive head (sphere, half-sphere hair cap,
cone bangs, cone ears, box eyes) on an anatomical body: green tunic with belt, cream leggings, boots,
short sword. Stocky pear-shaped trunk and thick short legs (THICK x the original girth).

Outfits are modular parts on one skeleton (see VARIANTS):
  plain  — full fluffy hair, no cape, no hood
  hooded — bangs only, streamlined pointed hood, full-body cloak, clasp
The fluffy hair cannot sit under a hood, so the hair itself is a swappable part.

Faces +X, feet on z = 0, ~0.84 tiles tall. Right hand = -Y.
"""
import json
import math

import bpy
from mathutils import Quaternion, Vector

import lib
from lib import X, Y, Z

HEIGHT = 0.84
THICK = 1.5  # trunk and leg girth relative to the original slim build (heights unchanged)
H = Vector((0.0, 0.0, 0.555))  # head centre

# Outfit variants: the game shows the listed parts and hides every other part named here.
VARIANTS = {
    "plain": ["hair_full"],
    "hooded": ["hair_hood", "hood", "cape", "clasp"],
}


def h(x, y, z):
    """Point relative to the head centre."""
    return H + Vector((x, y, z))


# Proportions: narrow sloping shoulders, short legs; the trunk widens downwards (pear / bell shape).
J = {
    "pelvis": (0.00, 0.00, 0.205),
    "spine": (0.00, 0.00, 0.27),
    "chest": (0.00, 0.00, 0.34),
    "neck": (0.00, 0.00, 0.395),
    "shoulder": (0.00, 0.108, 0.368),
    "elbow": (0.005, 0.17, 0.3),
    "wrist": (0.015, 0.198, 0.24),
    "hand": (0.022, 0.208, 0.205),
    "hip": (0.00, 0.068, 0.19),
    "knee": (0.012, 0.074, 0.112),
    "ankle": (0.00, 0.076, 0.045),
    "toe": (0.07, 0.078, 0.018),
}


def L(name, s=1):
    x, y, z = J[name]
    return Vector((x, y * s, z))


# ---------------------------------------------------------------------------
# body (no head, no hair — those are separate parts)

def build_body():
    a = lib.Anatomy("hero_body", resolution=0.0045)
    skin = "hero_skin"
    tunic, belt, pants, boot = "hero_tunic", "hero_belt", "hero_pants", "hero_boot"

    a.seg(L("neck") + Vector((0, 0, -0.02)), h(0.0, 0, -0.12), 0.04, skin)  # neck
    T = THICK

    def wide(semi):  # girth (x, y) scales, height (z) does not
        return (semi[0] * T, semi[1] * T, semi[2])

    # --- trunk: narrow at the chest, widening through belly to hips -----------
    a.ell((0.005, 0, 0.335), wide((0.062, 0.068, 0.05)), tunic)               # chest (narrow)
    for s in (1, -1):
        a.ell(L("shoulder", s), (0.034, 0.034, 0.03), tunic)          # small shoulders
        a.ell((-0.04 * T, 0.036 * s * T, 0.2), wide((0.05, 0.05, 0.045)), tunic)      # bottom (under the tunic)
    a.ell((0.015, 0, 0.275), wide((0.08, 0.088, 0.055)), tunic)               # belly
    a.ell((0.008, 0, 0.225), wide((0.092, 0.106, 0.05)), tunic)               # lower belly / hips (widest)
    a.ell((0.0, 0, 0.195), wide((0.102, 0.118, 0.04)), tunic)                 # tunic hem flare
    a.ell((0.012, 0, 0.25), wide((0.088, 0.099, 0.012)), belt)                # belt band
    a.ell((0.012 + 0.088 * T, 0, 0.25), (0.008, 0.02, 0.016), "hero_buckle")          # buckle

    # --- arms: sleeve, forearm, hand with four fingers + thumb -----------------
    for s in (1, -1):
        sh, el, wr, ha = L("shoulder", s), L("elbow", s), L("wrist", s), L("hand", s)
        a.seg(sh, el, 0.03, tunic, length=0.8, offset=tuple((sh - el) * 0.12))   # short sleeve
        a.seg(sh, el, 0.024, skin)                                               # upper arm
        a.ell(el, (0.022, 0.022, 0.022), skin)                                    # elbow
        a.seg(el, wr, 0.022, skin, r2=0.024)                                      # forearm
        a.seg(wr, ha, 0.019, skin, r2=0.028)                                      # palm
        for dx in (-0.015, -0.005, 0.005, 0.015):                                 # four short fingers
            base = ha + Vector((dx, -0.004 * s, -0.005))
            a.seg(base, base + Vector((0.004, -0.006 * s, -0.027)), 0.0085, skin)
        tb = wr.lerp(ha, 0.5) + Vector((0.024, -0.006 * s, 0))
        a.seg(tb, tb + Vector((0.018, -0.01 * s, -0.02)), 0.0095, skin)          # thumb

    # --- short legs: leggings, knees, boots ------------------------------------
    for s in (1, -1):
        hj, kn, an, to = L("hip", s), L("knee", s), L("ankle", s), L("toe", s)
        a.seg(hj, kn, 0.036 * T, pants, r2=0.038 * T)                                     # thigh
        a.ell(kn + Vector((0.014 * T, 0, 0)), (0.02 * T, 0.024 * T, 0.022), pants)            # knee
        a.seg(kn, an, 0.028 * T, pants)                                               # shin
        a.seg(kn.lerp(an, 0.3), an, 0.035 * T, boot)                                  # boot shaft
        a.ell(kn.lerp(an, 0.28), (0.04 * T, 0.04 * T, 0.011), boot)                      # boot cuff
        a.seg(an + Vector((-0.028, 0, -0.026)), to, 0.038 * 1.25, boot, r2=0.026 * 1.25)        # foot
        a.ell(an + Vector((-0.028 * T, 0, -0.022)), (0.028 * T, 0.033 * 1.25, 0.026), boot)      # heel
        a.ell(to + Vector((0.005, 0, 0.004)), (0.028 * 1.25, 0.034 * 1.25, 0.02), boot)         # toe cap

    return a.build(target_tris=3600, voxel=0.0035)


# ---------------------------------------------------------------------------
# head: the original primitive head from the pre-Blender build (three.js HeroModel), rebuilt with the
# same primitives, sizes and angles and placed on this body:
#   10x8 sphere head, half-sphere hair cap, three 4-sided cone bangs, two 4-sided cone ears, box eyes.
# Old coordinates are three.js space (x forward, y up, z side) around the old head centre.

OLD_HEAD = Vector((0.01, 0.5, 0.0))
HEAD_K = 1.15  # the old model was shown at 1.3x; 1.15x fits this neck and these shoulders


def old(x, y, z):
    """three.js point of the old hero -> Blender point on this body."""
    return H + Vector((x - OLD_HEAD.x, -(z - OLD_HEAD.z), y - OLD_HEAD.y)) * HEAD_K


def old_dir(x, y, z):
    return Vector((x, -z, y)).normalized()


def uv_sphere(name, centre, r, mat, segs, rings, theta_len=math.pi):
    """Like three.js SphereGeometry: `rings` bands from the top pole down to theta_len."""
    c = Vector(centre)
    full = abs(theta_len - math.pi) < 1e-6
    ring_count = rings - 1 if full else rings
    verts = [c + Vector((0, 0, r))]
    for i in range(1, ring_count + 1):
        th = theta_len * i / rings
        for j in range(segs):
            ph = 2 * math.pi * j / segs
            verts.append(c + Vector((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th))) * r)
    faces = [(0, 1 + j, 1 + (j + 1) % segs) for j in range(segs)]
    for i in range(ring_count - 1):
        for j in range(segs):
            a, b = 1 + i * segs + j, 1 + i * segs + (j + 1) % segs
            faces.append((a, a + segs, b + segs, b))
    if full:
        verts.append(c - Vector((0, 0, r)))
        bot, last = len(verts) - 1, 1 + (ring_count - 1) * segs
        faces += [(last + j, bot, last + (j + 1) % segs) for j in range(segs)]
    return lib.mesh_from(name, verts, faces, mat, recalc=True)


def old_cone(name, centre3, dir3, radius, height, mat):
    """three.js ConeGeometry(radius, height, 4) centred at centre3, axis dir3 (both old space)."""
    c, d = old(*centre3), old_dir(*dir3)
    half = d * height / 2 * HEAD_K
    return lib.cone(name, c - half, c + half, radius * HEAD_K, mat, sides=4)


def build_head():
    k = HEAD_K
    parts = [uv_sphere("head_mesh", old(0.01, 0.5, 0), 0.15 * k, "hero_skin", 10, 8)]
    for s, side in ((1, "L"), (-1, "R")):
        # three.js: ear at z = s*0.17, rotation.x = s*1.25  ->  axis (0, cos 1.25, s*sin 1.25)
        parts.append(old_cone(f"ear.{side}", (-0.02, 0.51, s * 0.17), (0, math.cos(1.25), s * math.sin(1.25)),
                              0.035, 0.16, "hero_skin"))
        parts.append(lib.box(f"eye.{side}", old(0.145, 0.5, s * 0.055), (0.01 * k, 0.0125 * k, 0.02 * k), "hero_eye"))
    return parts


def _bangs():
    # three.js: cones at (0.12, 0.58, z), rotation.z = -2.3  ->  axis (sin 2.3, cos 2.3, 0)
    return [old_cone(f"bang{i}", (0.12, 0.58, z), (math.sin(2.3), math.cos(2.3), 0), 0.045, 0.11, "hero_hair")
            for i, z in enumerate((-0.08, 0.0, 0.08))]


def build_hair(name, full):
    """full: the old half-sphere cap + three bangs. Under the hood: the bangs only."""
    objs = _bangs()
    if full:
        objs.append(uv_sphere("cap", old(-0.015, 0.515, 0), 0.162 * HEAD_K, "hero_hair", 10, 8, math.pi * 0.55))
    return lib.join(name, objs)


def build_hood():
    """
    Streamlined hood: one lofted tube along a smooth spine. The front ring is the face opening,
    the rings grow around the skull, then taper smoothly down the back to a pointed tip.
    """
    spine = lib.catmull_rom([h(0.16, 0, 0.0), h(0.02, 0, 0.035), h(-0.14, 0, 0.045), h(-0.25, 0, -0.01),
                             h(-0.31, 0, -0.12), h(-0.33, 0, -0.25)], samples_per_segment=3)
    #            (half-width across, half-height) at each control point, interpolated along the spine
    radii = [(0.175, 0.2), (0.205, 0.215), (0.165, 0.17), (0.1, 0.1), (0.055, 0.055), (0.0, 0.0)]
    sides = 14
    rings = []
    m = len(spine) - 1
    for k, c in enumerate(spine[:-1]):
        u = k / m * (len(radii) - 1)
        i0 = min(int(u), len(radii) - 2)
        f = u - i0
        ry = radii[i0][0] * (1 - f) + radii[i0 + 1][0] * f
        rz = radii[i0][1] * (1 - f) + radii[i0 + 1][1] * f
        tangent = (spine[k + 1] - c).normalized()
        up = Y.cross(tangent).normalized()
        side = tangent.cross(up).normalized()
        rings.append([c + side * (math.cos(2 * math.pi * a / sides) * ry) + up * (math.sin(2 * math.pi * a / sides) * rz)
                      for a in range(sides)])
    return lib.loft("hood", rings, "hero_cape", tip=spine[-1])


def build_cape():
    """
    Full-body cloak: wraps the back and both sides from a raised collar down to the ankles,
    leaving only a narrow opening at the front. Gentle folds, flared hem. Weighted down the cape chain.
    """
    wrap = math.radians(160)  # angle from the back to each front edge (front opening = 2 * 20°)
    cols = 16
    k = THICK / 1.5  # radii below are sized for THICK = 1.5
    rows = [  # (z, x-radius, y-radius, x-centre)
        (0.445, 0.055, 0.062, -0.005),   # collar top
        (0.395, 0.1, 0.15, -0.005),      # shoulders
        (0.33, 0.15 * k, 0.2, 0.0),
        (0.25, 0.165 * k, 0.21 * k, 0.0),  # hips
        (0.16, 0.17 * k, 0.22 * k, 0.0),
        (0.065, 0.175 * k, 0.23 * k, 0.0),  # hem, just above the ankles
    ]
    rings = []
    for r, (z, rx, ry, cx) in enumerate(rows):
        t = r / (len(rows) - 1)
        ring = []
        for c in range(cols + 1):
            a = -wrap + 2 * wrap * c / cols          # 0 = straight back
            fold = 1 + 0.06 * t * math.sin(a * 5)    # cloth folds, deeper towards the hem
            hem = (0.012 if c % 2 else -0.004) if r == len(rows) - 1 else 0.0
            ring.append((cx - math.cos(a) * rx * fold, math.sin(a) * ry * fold, z - hem))
        rings.append(ring)
    cloak = lib.loft("cape", rings, "hero_cape", closed=False)
    clasp = lib.ico("clasp", (0.09, 0.0, 0.395), 0.014, "hero_buckle", 0)
    return cloak, clasp


def build_props():
    """The sword (rigid, always shown)."""
    out = {}

    grip = L("hand", -1) + Vector((0.005, -0.004, -0.02))
    blade_dir = Vector((0.75, 0, -0.66)).normalized()
    up = blade_dir.cross(Y).normalized()

    def pt(along, across, depth=0.0):
        return grip + blade_dir * along + Y * across + up * depth

    blade_v = [pt(0.04, -0.012), pt(0.04, 0.012), pt(0.27, 0.012), pt(0.27, -0.012), pt(0.31, 0),
               pt(0.04, 0, 0.005), pt(0.27, 0, 0.005), pt(0.04, 0, -0.005), pt(0.27, 0, -0.005)]
    blade_f = [(0, 5, 6, 3), (5, 1, 2, 6), (3, 6, 4), (6, 2, 4), (0, 3, 8, 7), (7, 8, 2, 1), (3, 4, 8), (8, 4, 2)]
    out["blade"] = (lib.mesh_from("blade", blade_v, blade_f, "hero_blade"), "hand.R")
    rot = lib.align(blade_dir)
    out["guard"] = (lib.box("guard", pt(0.035, 0), (0.008, 0.04, 0.01), "hero_buckle", rot), "hand.R")
    out["grip"] = (lib.box("grip", pt(0.0, 0), (0.032, 0.009, 0.009), "hero_grip", rot), "hand.R")
    out["pommel"] = (lib.ico("pommel", pt(-0.036, 0), 0.012, "hero_buckle", 0), "hand.R")
    return out


def build_rig():
    b = [
        ("root", (0, 0, 0), (0, 0, 0.1), None),
        ("hips", J["pelvis"], J["spine"], "root"),
        ("spine", J["spine"], J["chest"], "hips"),
        ("chest", J["chest"], J["neck"], "spine"),
        ("neck", J["neck"], tuple(h(0, 0, -0.1)), "chest"),
        ("head", tuple(h(0, 0, -0.1)), tuple(h(0, 0, 0.2)), "neck"),
        ("cape.1", (-0.1, 0, 0.4), (-0.15, 0, 0.24), "chest"),
        ("cape.2", (-0.15, 0, 0.24), (-0.18, 0, 0.065), "cape.1"),
    ]
    for s, side in ((1, "L"), (-1, "R")):
        P = lambda n: tuple(L(n, s))
        b += [
            (f"upper_arm.{side}", P("shoulder"), P("elbow"), "chest"),
            (f"forearm.{side}", P("elbow"), P("wrist"), f"upper_arm.{side}"),
            (f"hand.{side}", P("wrist"), tuple(L("hand", s) + Vector((0.005, 0, -0.03))), f"forearm.{side}"),
            (f"thigh.{side}", P("hip"), P("knee"), "hips"),
            (f"shin.{side}", P("knee"), P("ankle"), f"thigh.{side}"),
            (f"foot.{side}", P("ankle"), P("toe"), f"shin.{side}"),
        ]
    return lib.armature("hero_rig", b)


# ---------------------------------------------------------------------------
# animation. Axes (armature space): +X forward, +Y left, +Z up.
#   legs / arms swing forward = negative about Y;  spine lean forward = positive about Y;
#   left arm out to the side = positive about X (right arm: negative);  twist left = positive about Z.

def legs(l_th, r_th, l_sh, r_sh, l_ft=0.0, r_ft=0.0):
    return {"thigh.L": [(Y, l_th)], "thigh.R": [(Y, r_th)], "shin.L": [(Y, l_sh)], "shin.R": [(Y, r_sh)],
            "foot.L": [(Y, l_ft)], "foot.R": [(Y, r_ft)]}


def merge(*poses):
    out = {}
    for p in poses:
        for k, v in p.items():
            out[k] = (out.get(k, []) + v) if isinstance(v, list) else v
    return out


def build_actions(rig):
    tau = 2 * math.pi

    def walk(ph):
        c, s = math.cos(ph * tau), math.sin(ph * tau)
        return merge(
            legs(-32 * c, 32 * c, 38 * max(0, s), 38 * max(0, -s), 10 * c, -10 * c),
            {
                "upper_arm.L": [(Y, 30 * c)], "upper_arm.R": [(Y, -30 * c)],
                "forearm.L": [(Y, -20 + 10 * c)], "forearm.R": [(Y, -20 - 10 * c)],
                "hips": [(Z, 8 * c)], "chest": [(Z, -10 * c), (Y, 5)], "head": [(Z, 4 * c), (Y, -4)],
                "cape.1": [(Y, 18 + 6 * abs(s))], "cape.2": [(Y, 12 + 8 * s)],
                "_lift": 0.022 * abs(s),
            },
        )

    lib.action(rig, "walk", {f: walk((f - 1) / 16) for f in range(1, 18, 2)})

    def idle(ph):
        b = math.sin(ph * tau)
        return {
            "spine": [(Y, 1.5 * b)], "chest": [(Y, 1.5 * b)], "head": [(X, 3 * math.sin(ph * tau * 0.5))],
            "upper_arm.L": [(X, 6 + 2 * b)], "upper_arm.R": [(X, -6 - 2 * b)],
            "forearm.L": [(Y, -12)], "forearm.R": [(Y, -18)],
            "cape.1": [(Y, 3 + 2 * b)], "cape.2": [(Y, 2 + 3 * b)],
            "_lift": -0.003 * b,
        }

    lib.action(rig, "idle", {f: idle((f - 1) / 48) for f in range(1, 50, 6)})

    # attack: a right-handed forehand slash.
    # anticipation (torso twists right, sword drawn back out to the side) -> strike (sweeps across, step in)
    # -> follow-through -> recover
    wind = merge(legs(-8, 14, 18, 10, 0, 0), {
        "hips": [(Z, -14)], "spine": [(Z, -10)], "chest": [(Z, -16), (Y, -4)], "head": [(Z, 22)],
        "upper_arm.R": [(X, -80), (Z, -35)], "forearm.R": [(Y, -50)], "hand.R": [(Y, 30)],
        "upper_arm.L": [(Y, -35), (X, 15)], "forearm.L": [(Y, -35)],
        "cape.1": [(Y, 12), (X, 10)], "_lift": 0.008,
    })
    strike = merge(legs(-42, 22, 30, 14, 14, -8), {
        "hips": [(Z, 12)], "spine": [(Z, 10), (Y, 8)], "chest": [(Z, 14), (Y, 10)], "head": [(Z, -14), (Y, -10)],
        "upper_arm.R": [(Y, -80), (Z, 30)], "forearm.R": [(Y, -5)], "hand.R": [(Y, 45)],
        "upper_arm.L": [(Y, 25), (X, 30)], "forearm.L": [(Y, -40)],
        "cape.1": [(Y, 30), (X, -15)], "cape.2": [(Y, 18)], "_lift": -0.028,
    })
    follow = merge(legs(-40, 22, 28, 14, 12, -8), {
        "hips": [(Z, 18)], "spine": [(Z, 14), (Y, 10)], "chest": [(Z, 22), (Y, 12)], "head": [(Z, -20), (Y, -10)],
        "upper_arm.R": [(Y, -70), (Z, 70)], "forearm.R": [(Y, -25)], "hand.R": [(Y, 45)],
        "upper_arm.L": [(Y, 30), (X, 35)], "forearm.L": [(Y, -45)],
        "cape.1": [(Y, 36), (X, -25)], "cape.2": [(Y, 26)], "_lift": -0.032,
    })
    rest = idle(0)
    lib.action(rig, "attack", {1: rest, 3: wind, 5: strike, 7: follow, 11: rest})

    # crouch: hips dropped, knees forward, torso leaning in, arms ready
    def crouch_base(extra=None):
        return merge(legs(-70, -70, 110, 110, -40, -40), {
            "spine": [(Y, 28)], "chest": [(Y, 14)], "head": [(Y, -34)],
            "upper_arm.L": [(Y, -25), (X, 14)], "upper_arm.R": [(Y, -30), (X, -14)],
            "forearm.L": [(Y, -70)], "forearm.R": [(Y, -60)],
            "cape.1": [(Y, -18)], "cape.2": [(Y, -8)],
            "_lift": -0.068,
        }, extra or {})

    def crouch(ph):
        b = math.sin(ph * tau)
        return crouch_base({"spine": [(Y, 1.5 * b)], "head": [(Z, 6 * math.sin(ph * tau * 0.5))], "_lift": -0.068 - 0.003 * b})

    lib.action(rig, "crouch", {f: crouch((f - 1) / 48) for f in range(1, 50, 6)})

    def crouch_walk(ph):
        c, s = math.cos(ph * tau), math.sin(ph * tau)
        return merge(
            legs(-70 - 22 * c, -70 + 22 * c, 110 + 15 * max(0, s), 110 + 15 * max(0, -s), -40 + 12 * c, -40 - 12 * c),
            {
                "spine": [(Y, 30)], "chest": [(Y, 14), (Z, -7 * c)], "head": [(Y, -36), (Z, 6 * c)],
                "hips": [(Z, 9 * c), (X, 3 * s)],
                "upper_arm.L": [(Y, -25 + 14 * c), (X, 16)], "upper_arm.R": [(Y, -30 - 14 * c), (X, -16)],
                "forearm.L": [(Y, -70)], "forearm.R": [(Y, -60)],
                "cape.1": [(Y, -10 + 6 * abs(s))], "cape.2": [(Y, -4 + 6 * s)],
                "_lift": -0.07 + 0.01 * abs(s),
            },
        )

    lib.action(rig, "crouch_walk", {f: crouch_walk((f - 1) / 24) for f in range(1, 26, 3)})


# ---------------------------------------------------------------------------

def build(out_glb, out_preview):
    lib.reset()
    body = build_body()
    parts = {
        "hair_full": build_hair("hair_full", True),
        "hair_hood": build_hair("hair_hood", False),
        "hood": build_hood(),
    }
    parts["cape"], parts["clasp"] = build_cape()
    props = build_props()
    head_parts = build_head()
    rig = build_rig()
    lib.skin(body, rig)
    for obj in head_parts:
        lib.attach(obj, rig, "head")
    lib.weight_chain(parts["cape"], rig, [("chest", 0.4), ("cape.1", 0.26), ("cape.2", 0.065)])
    for name in ("hair_full", "hair_hood", "hood"):
        lib.attach(parts[name], rig, "head")
    lib.attach(parts["clasp"], rig, "chest")
    for obj, bone in props.values():
        lib.attach(obj, rig, bone)
    build_actions(rig)
    rig["variants"] = json.dumps(VARIANTS)  # the game reads this to show / hide outfit parts
    lib.export_glb(out_glb, [rig, body] + head_parts + list(parts.values()) + [o for o, _ in props.values()])

    poses = [("idle", 1), ("walk", 1), ("walk", 5), ("walk", 9), ("walk", 13), ("attack", 3),
             ("attack", 5), ("attack", 7), ("crouch", 1), ("crouch_walk", 1), ("crouch_walk", 7), ("crouch_walk", 13)]
    for variant, shown in VARIANTS.items():
        for name, obj in parts.items():
            obj.hide_render = name not in shown
        suffix = "" if variant == "plain" else f"_{variant}"
        lib.previews(out_preview.replace(".png", f"{suffix}.png"), HEIGHT, head=H)
        lib.pose_sheet(rig, out_preview.replace(".png", f"{suffix}_poses.png"), HEIGHT, poses)
    print(f"hero: body {lib.tri_count(body)}, head {sum(lib.tri_count(o) for o in head_parts)}, " + ", ".join(f"{n} {lib.tri_count(o)}" for n, o in parts.items()) + " tris")
