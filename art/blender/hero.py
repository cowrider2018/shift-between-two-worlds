"""
Hero (DESIGN §4.2): small chibi adventurer — a primitive head (sphere, box eyes, small human ears) with
hair made of five thick turning cones (see HAIR), on an anatomical body: green tunic with belt, cream leggings, boots,
short sword. Stocky pear-shaped trunk; short legs of straight trouser tubes with wider boots worn over them.

Outfits are modular parts on one skeleton (see VARIANTS):
  plain  — the five-lock hair, no cape, no hood
  hooded — streamlined pointed hood, full-body cloak, clasp, hair hidden
The bulky locks cannot sit under a hood, so the hair itself is a swappable part.

Faces +X, feet on z = 0, ~0.84 tiles tall. Right hand = -Y.
"""
import json
import math

import bpy
from mathutils import Quaternion, Vector

import lib
from lib import X, Y, Z

HEIGHT = 0.84
# Facet density outside the head matches the primitive head (10x8 sphere): coarse planes, few turns.
BODY_TRIS = 700
TUNIC_TRIS = 450
SLEEVE_TRIS = 120
BOOT_TRIS = 260
CLOTH = 0.008  # how far the tunic stands off the body: the visible thickness of its hem
HEM_Z = 0.172  # tunic hem height
SLEEVE_R = 0.034  # sleeve tube radius over the 0.025 arm
PANT_R = 0.05   # trouser leg radius: full, nearly straight
BOOT_R = 0.06   # boot shaft radius: only a touch wider, so the rim is a small step, not a big tuck
BOOT_TOP = 0.34  # boot rim height between ankle and knee: low, so the trouser leg reads long
THICK = 1.5  # trunk and leg girth relative to the original slim build (heights unchanged)
DEPTH = 0.7  # the trunk's front-to-back depth relative to THICK (a flatter, less barrel-chested body)
H = Vector((0.0, 0.0, 0.555))  # head centre

# Outfit variants: the game shows the listed parts and hides every other part named here.
VARIANTS = {
    "plain": ["hair"],
    "hooded": ["hood", "cape", "clasp"],
}


def h(x, y, z):
    """Point relative to the head centre."""
    return H + Vector((x, y, z))


# Proportions: small dropped shoulders, rounded egg-shaped trunk with a tucked round bottom, thick short legs.
J = {
    "pelvis": (0.00, 0.00, 0.205),
    "spine": (0.00, 0.00, 0.27),
    "chest": (0.00, 0.00, 0.34),
    "neck": (0.00, 0.00, 0.395),
    "shoulder": (0.00, 0.098, 0.35),   # low and set in: the acromion sits on the chest's slope, no shrug
    "elbow": (0.004, 0.158, 0.288),
    "wrist": (0.014, 0.186, 0.23),
    "hand": (0.021, 0.196, 0.196),
    "hip": (0.00, 0.064, 0.19),
    "knee": (0.012, 0.074, 0.112),
    "ankle": (0.00, 0.076, 0.045),
    "toe": (0.07, 0.078, 0.018),
}


def L(name, s=1):
    x, y, z = J[name]
    return Vector((x, y * s, z))


# ---------------------------------------------------------------------------
# body (no head, no hair — those are separate parts)

_D = THICK * DEPTH


def wide(semi, side=1.0):
    """Girth scales (depth x by THICK * DEPTH, width y by THICK * side); height z does not."""
    return Vector((semi[0] * _D, semi[1] * THICK * side, semi[2]))


# Trunk: a pear that widens in one steady slope; the bands overlap deeply in height so it reads as one form.
TRUNK = [
    ((0.005, 0, 0.332), wide((0.062, 0.068, 0.056))),        # chest, sloping into the shoulders
    ((0.015, 0, 0.278), wide((0.08, 0.088, 0.075), 0.9)),    # belly
    ((0.008, 0, 0.228), wide((0.092, 0.106, 0.072), 0.78)),  # lower belly / hips
    ((0.002, 0, 0.198), wide((0.092, 0.112, 0.05), 0.72)),   # hem region
]


def build_body():
    a = lib.Anatomy("hero_body", resolution=0.0045)
    skin, pants = "hero_skin", "hero_pants"

    a.seg(L("neck") + Vector((0, 0, -0.02)), h(0.0, 0, -0.12), 0.04, skin)  # neck
    # trunk (under the tunic shell; only its lower part shows, as trousers below the hem)
    for c, semi in TRUNK:
        a.ell(c, semi, pants)
    for s in (1, -1):
        a.ell((-0.05 * _D / 1.5, 0.042 * s, 0.2), (0.062 * _D / 1.5, 0.056, 0.064), pants)  # bottom cheek
    # hips-to-legs: one block across both thigh roots, so the widest part of the pear runs straight on
    # into the outer thighs; the legs only part below it
    a.ell((-0.006, 0, 0.16), (0.075, 0.122, 0.05), pants)

    # --- arms: one smooth tapering tube per limb; the skeleton does the bending, so the surface carries no
    #     elbow or muscle segments (overlapping pieces would sum into bulges at the joints)
    for s in (1, -1):
        sh, el, wr, ha = L("shoulder", s), L("elbow", s), L("wrist", s), L("hand", s)
        a.seg(sh, wr, 0.025, skin, r2=0.021)                                     # shoulder to wrist in one
        a.ell(ha + Vector((0.004, -0.002 * s, -0.008)), (0.022, 0.017, 0.03), skin)  # mitten hand: one plain oval

    # --- short legs: one smooth trouser tube per leg (the boots are a separate shell worn over it) ---------
    for s in (1, -1):
        hj, an = L("hip", s), L("ankle", s)
        a.ell(hj + Vector((-0.012, 0.01 * s, -0.022)), (0.062, 0.056, 0.05), pants)  # full upper thigh
        a.seg(hj, an, PANT_R * 1.03, pants, r2=PANT_R)                          # hip to ankle in one, no knee seam

    return a.build(target_tris=BODY_TRIS, voxel=0.006)


# ---------------------------------------------------------------------------
# clothes: separate shells worn over the body, so every garment edge (tunic hem, sleeve cuff, boot rim)
# is a real cut edge with thickness instead of a colour change

def build_tunic():
    a = lib.Anatomy("hero_tunic", resolution=0.0045)
    m = CLOTH
    for c, (x, y, z) in TRUNK:
        a.ell(c, (x + m, y + m, z + m), "hero_tunic")
    a.ell((-0.006, 0, 0.17), (0.075 + m, 0.122 + m, 0.05), "hero_tunic")       # over the hip block, down to the hem
    for s in (1, -1):
        a.ell((-0.05 * _D / 1.5, 0.042 * s, 0.2), (0.062 * _D / 1.5 + m, 0.056 + m, 0.064), "hero_tunic")
        a.ell(L("shoulder", s) + Vector((0, -0.006 * s, -0.004)), (0.03, 0.03, 0.026), "hero_tunic")  # shoulder
    a.ell((0.012, 0, 0.25), wide((0.1, 0.099, 0.017), 0.9) + Vector((m, m, 0)), "hero_belt")         # belt band
    a.ell((0.012 + 0.1 * _D + m, 0, 0.25), (0.01, 0.022, 0.019), "hero_buckle")                       # buckle
    a.subtract((0, 0, HEM_Z - 1.0), (1.5, 1.5, 1.0))   # the hem: a level cut edge over the trousers
    return a.build(target_tris=TUNIC_TRIS, voxel=0.006)


def build_sleeves():
    a = lib.Anatomy("hero_sleeves", resolution=0.0045)
    for s in (1, -1):
        sh, el = L("shoulder", s), L("elbow", s)
        d = (el - sh).normalized()
        end = sh.lerp(el, 0.55)
        a.seg(sh - d * 0.01, end + d * 0.03, SLEEVE_R, "hero_tunic")
        a.subtract(end + d * 0.6, (0.6, 0.6, 0.6))      # square cuff across the arm
    return a.build(target_tris=SLEEVE_TRIS, voxel=0.005)


def build_boots():
    a = lib.Anatomy("hero_boots", resolution=0.0045)
    rim = 0.0
    for s in (1, -1):
        kn, an, to = L("knee", s), L("ankle", s), L("toe", s)
        top = an.lerp(kn, BOOT_TOP)
        rim = top.z
        # shaft over the trouser leg, dropping straight down to the floor: that is the heel
        a.seg(Vector((an.x - 0.006, an.y, -0.03)), top + Vector((0, 0, 0.03)), BOOT_R, "hero_boot")
        a.seg(Vector((an.x, an.y, 0.01)), Vector((to.x + 0.024, an.y, 0.012)), 0.036, "hero_boot", r2=0.03)  # toe
    a.subtract((0, 0, -1.0), (1.5, 1.5, 1.0))           # flat soles
    a.subtract((0, 0, rim + 1.0), (1.5, 1.5, 1.0))      # the rim: a level cut edge around the trouser leg
    return a.build(target_tris=BOOT_TRIS, voxel=0.005)


# ---------------------------------------------------------------------------
# head: the original primitive head from the pre-Blender build (three.js HeroModel), rebuilt with the
# same primitives, sizes and angles and placed on this body:
#   10x8 sphere head, box eyes. Ears are small human ears; hair: see HAIR below.
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
        # small rounded human ear, flat against the side of the head, tilted slightly back
        parts.append(lib.ico(f"ear.{side}", H + Vector((-0.012, s * (HEAD_R - 0.006), -0.012)), 1.0, "hero_skin", 1,
                             scale=(0.026, 0.011, 0.038), rot=Quaternion(Y, math.radians(-12)).to_matrix()))
        parts.append(lib.box(f"eye.{side}", old(0.145, 0.5, s * 0.055), (0.01 * k, 0.0125 * k, 0.02 * k), "hero_eye"))
    return parts


# Hair: five big, thick cones ("locks") and nothing else — no caps, spheres, sheets or bangs.
# Each lock is a solid cone at most twice as wide as it is thick (LOCK_RATIO). Its root is buried in the skull;
# it turns as it leaves the scalp and bends along the head, so its own bulk covers a region of the skull.
# The five are placed to wrap the head with as little overlap as possible, tips turning outward.
#   (name, exit (azimuth, elevation), end (azimuth, elevation), width, taper exponent,
#    centre depth relative to the scalp in thicknesses (negative = sunk in), tip flick outward)
#   azimuth 0 = forward, +90 = the hero's left; elevation 90 = straight up.
HEAD_R = 0.15 * HEAD_K
LOCK_RATIO = 2.0  # width : thickness, never flatter than this
# Fitted numerically: scalp ~95% covered, ~7% double-covered, face and ears clear; every lock >= 0.2 wide
# and bending >= 70 degrees around the head (big locks, no small filler spikes). The back hairline sits high and
# the back stays close to the skull (locks sunk in, not flattened); every tip flicks well outward from 40% along,
# and forward-facing tips stop above the brow (no bangs over the eyes).
HAIR = [
    ("sweep_r", (151, 88), (-103, -23), 0.200, 3.50, 0.14, 0.076),
    ("sweep_l", (56, 52), (-48, 27), 0.224, 3.43, -0.05, 0.138),
    ("side_l", (97, 16), (-13, 60), 0.200, 2.66, 0.09, 0.127),
    ("side_r", (241, -10), (-22, 45), 0.200, 3.39, -0.57, 0.092),
    ("back", (116, 25), (251, -12), 0.280, 2.97, -0.27, 0.114),
]


def _sph(az, el):
    az, el = math.radians(az), math.radians(el)
    return Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def _slerp(a, b, t):
    om = math.acos(max(-1.0, min(1.0, a.dot(b))))
    if om < 1e-6:
        return a.copy()
    return (a * math.sin((1 - t) * om) + b * math.sin(t * om)) / math.sin(om)


def build_lock(name, exit_dir, end_dir, width, taper, depth, flick, steps=7):
    """One thick turning cone: hexagonal cross-section width:thickness = LOCK_RATIO, root buried in the skull."""
    a, b = _sph(*exit_dir), _sph(*end_dir)

    def ring(centre, along, normal, w):
        th = w / LOCK_RATIO
        side = normal.cross(along).normalized()
        return [centre + side * (w * x) + normal * (th * y)
                for x, y in ((0.5, 0), (0.25, 0.5), (-0.25, 0.5), (-0.5, 0), (-0.25, -0.5), (0.25, -0.5))]

    tip = H + b * (HEAD_R + flick)
    pts = []
    for k in range(steps):
        u = k / steps
        n = _slerp(a, b, u).normalized()
        w = width * (1 - u ** taper)
        lift = flick * max(0.0, (u - 0.4) / 0.6) ** 2            # the tip turns away from the head
        pts.append((n, H + n * (HEAD_R + depth * w / LOCK_RATIO + lift), w))
    root = H + a * HEAD_R * 0.3                                     # buried root: the lock grows out of the skull
    rings = [ring(root, (pts[1][1] - root).normalized(), a, width * 1.05)]
    for k, (n, c, w) in enumerate(pts):
        nxt = pts[k + 1][1] if k + 1 < len(pts) else tip
        rings.append(ring(c, (nxt - c).normalized(), n, w))
    return lib.loft(name, rings, "hero_hair", tip=tip)


def build_hair(name):
    objs = [build_lock(f"hair_{n}", *args) for n, *args in HAIR]
    assert len(objs) == 5
    return lib.join(name, objs)


def build_hood():
    """
    Streamlined hood: one lofted tube along a smooth spine. The front ring is the face opening,
    the rings grow around the skull, then taper smoothly down the back to a pointed tip.
    """
    spine = lib.catmull_rom([h(0.16, 0, 0.0), h(0.02, 0, 0.035), h(-0.14, 0, 0.045), h(-0.25, 0, -0.01),
                             h(-0.31, 0, -0.12), h(-0.33, 0, -0.25)], samples_per_segment=2)
    #            (half-width across, half-height) at each control point, interpolated along the spine
    radii = [(0.175, 0.2), (0.205, 0.215), (0.165, 0.17), (0.1, 0.1), (0.055, 0.055), (0.0, 0.0)]
    sides = 8
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
    cols = 10
    k = THICK / 1.5  # radii below are sized for THICK = 1.5
    d = 0.8 + 0.2 * (DEPTH - 0.7) / 0.3  # x-radii (depth) shrink with the flatter trunk; sized for DEPTH = 0.7
    rows = [  # (z, x-radius, y-radius, x-centre)
        (0.445, 0.055, 0.062, -0.005),   # collar top
        (0.385, 0.085, 0.14, -0.005),    # shoulders (dropped with the shoulder caps)
        (0.33, 0.15 * k * d, 0.185, 0.0),
        (0.25, 0.165 * k * d, 0.19 * k, 0.0),  # hips
        (0.16, 0.17 * k * d, 0.2 * k, 0.0),
        (0.065, 0.175 * k * d, 0.21 * k, 0.0),  # hem, just above the ankles
    ]
    rings = []
    for r, (z, rx, ry, cx) in enumerate(rows):
        t = r / (len(rows) - 1)
        ring = []
        for c in range(cols + 1):
            a = -wrap + 2 * wrap * c / cols          # 0 = straight back
            fold = 1 + 0.06 * t * math.sin(a * 3)    # cloth folds, deeper towards the hem
            hem = (0.012 if c % 2 else -0.004) if r == len(rows) - 1 else 0.0
            ring.append((cx - math.cos(a) * rx * fold, math.sin(a) * ry * fold, z - hem))
        rings.append(ring)
    cloak = lib.loft("cape", rings, "hero_cape", closed=False)
    clasp = lib.ico("clasp", (0.078, 0.0, 0.395), 0.014, "hero_buckle", 0)
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
        ("cape.1", (-0.08, 0, 0.4), (-0.12, 0, 0.24), "chest"),
        ("cape.2", (-0.12, 0, 0.24), (-0.145, 0, 0.065), "cape.1"),
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
    clothes = [build_tunic(), build_sleeves(), build_boots()]
    parts = {
        "hair": build_hair("hair"),
        "hood": build_hood(),
    }
    parts["cape"], parts["clasp"] = build_cape()
    props = build_props()
    head_parts = build_head()
    rig = build_rig()
    lib.skin(body, rig)
    for obj in clothes:
        lib.skin(obj, rig)
    for obj in head_parts:
        lib.attach(obj, rig, "head")
    lib.weight_chain(parts["cape"], rig, [("chest", 0.4), ("cape.1", 0.26), ("cape.2", 0.065)])
    for name in ("hair", "hood"):
        lib.attach(parts[name], rig, "head")
    lib.attach(parts["clasp"], rig, "chest")
    for obj, bone in props.values():
        lib.attach(obj, rig, bone)
    build_actions(rig)
    rig["variants"] = json.dumps(VARIANTS)  # the game reads this to show / hide outfit parts
    lib.export_glb(out_glb, [rig, body] + clothes + head_parts + list(parts.values()) + [o for o, _ in props.values()])

    poses = [("idle", 1), ("walk", 1), ("walk", 5), ("walk", 9), ("walk", 13), ("attack", 3),
             ("attack", 5), ("attack", 7), ("crouch", 1), ("crouch_walk", 1), ("crouch_walk", 7), ("crouch_walk", 13)]
    for variant, shown in VARIANTS.items():
        for name, obj in parts.items():
            obj.hide_render = name not in shown
        suffix = "" if variant == "plain" else f"_{variant}"
        lib.previews(out_preview.replace(".png", f"{suffix}.png"), HEIGHT, head=H)
        lib.pose_sheet(rig, out_preview.replace(".png", f"{suffix}_poses.png"), HEIGHT, poses)
        if variant == "plain":
            lib.head_sheet(out_preview.replace(".png", "_head.png"), H, HEIGHT * 0.65)
    print(f"hero: body {lib.tri_count(body)}, head {sum(lib.tri_count(o) for o in head_parts)}, " + ", ".join(f"{n} {lib.tri_count(o)}" for n, o in parts.items()) + " tris")
