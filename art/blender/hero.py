"""
Hero (DESIGN §4.2): small chibi adventurer — a primitive head (sphere, box eyes, small human ears) with
hair made of five thick turning cones, one continued into a tail over the crown (see HAIR), on an anatomical body: green tunic with belt, cream leggings, boots,
short sword carried on the back. Stocky pear-shaped trunk; short legs of straight trouser tubes with wider boots worn over them.

Outfits are modular parts on one skeleton (see VARIANTS):
  plain  — the five-lock hair and the backpack (strap across the chest) the cloak is folded away in
  hooded — close hood with a small peak above the back of the head, full-body cloak, clasp, and the hair cut
           to what fits inside the hood (it still shows in the face opening)
  cloaking — the cloak going on (the "cloak" clip): out of the backpack, with the full hair until the hood is over it
The bulky locks cannot sit under a hood whole, so the hair itself is a swappable part.

Faces +X, feet on z = 0, ~0.84 tiles tall. Right hand = -Y.
"""
import json
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

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
# The backpack: cloak cloth, high on the back, on a leather strap from the left shoulder across the chest to the right
# hip (the scabbard crosses the back the other way). The cloak and hood are folded away in it. In the "cloak" clip its
# flap (bone "bag_flap", hinged at the top) flips open, and the bag (bone "bag") shrinks away, flap and all, as the hood
# swells out of it about the bag's centre (HOOD_PIVOT).
BAG_C = Vector((-0.118, 0.0, 0.345))  # bag centre, its front against the back
# The bag's body, bottom to top: (z, half-width, half-depth). A little wider at the bottom, rounded over the top.
BAG_RINGS = [(0.278, 0.064, 0.03), (0.29, 0.066, 0.032), (0.33, 0.063, 0.032), (0.37, 0.058, 0.031),
             (0.393, 0.05, 0.027), (0.406, 0.034, 0.017)]
BAG_TOP = 0.41
# The flap: over the top and down the outside, its free edge slanting from FLAP_EDGE[0] high on the left to
# FLAP_EDGE[1] low on the right, a round button at its middle. Its profile over the top: (out from the bag centre, z).
FLAP_PROFILE = [(-0.012, 0.409), (0.008, 0.414), (0.024, 0.406), (0.034, 0.39), (0.037, 0.37)]
FLAP_EDGE = (0.345, 0.312)
FLAP_HINGE = BAG_C + Vector((0.012, 0, BAG_TOP - BAG_C.z))  # top of the bag, back edge
STRAP_TILT = 45   # the strap's slant from the vertical (degrees), up toward the left shoulder
STRAP_C = Vector((0.0, 0.0, 0.31))    # the strap rings the trunk in the plane through here holding X and the slant
STRAP_W = 0.018
STRAP_OFF = 0.005  # how far the strap stands off the tunic
PRONE = 60  # forward pitch (degrees) of the whole body lying on the troll's back during a takedown

# Outfit variants: the game shows the listed parts and hides every other part named here.
VARIANTS = {
    "plain": ["hair_full", "bag", "bag_flap", "strap"],
    "hooded": ["hair_hood", "hood", "cape", "clasp"],
    "cloaking": ["hair_full", "hood", "cape", "clasp", "bag", "bag_flap", "strap"],
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


# Automatic skinning spreads the body and clothes over bones that should not move them:
#   - the cape bones lying just behind the back: every cape swing (it streams back while walking or running) lifted the backside
#     and the back of the tunic with it. Only the cloak itself (weight_chain) follows the cape.
#   - the thighs, up to belt height: a thigh swung forward pushes everything above its hip joint backward, so the
#     tunic bulged out at the back around the belt with every stride. Thigh weights fade out over THIGH_FADE_Z
#     (from just under the hip joints to below the belt).
#   - the upper arms, down at the waist: every arm swing tugged the sides and back of the tunic around the belt.
#     Upper arm weights fade out below ARM_FADE_Z (from the waist up to under the armpits); the tunic, which covers
#     no forearm, drops its forearm and hand weights altogether (the hanging hands sit right beside its hips).
# Those weights go to the trunk bone beside them.
CAPE_TO_TRUNK = {"cape.1": "spine", "cape.2": "hips"}
THIGH_FADE_Z = (0.18, 0.23)
ARM_FADE_Z = (0.27, 0.31)


def _clean_weights(obj):
    def move(src, dst, share):
        src, dst = obj.vertex_groups[src], obj.vertex_groups[dst]
        moved = [(v.index, g.weight, share(v)) for v in obj.data.vertices for g in v.groups if g.group == src.index]
        for i, w, k in moved:
            if k > 0:
                dst.add([i], w * k, "ADD")
                if k < 1:
                    src.add([i], w * (1 - k), "REPLACE")
                else:
                    src.remove([i])

    for cape, trunk in CAPE_TO_TRUNK.items():
        if cape in obj.vertex_groups:
            move(cape, trunk, lambda v: 1.0)
            obj.vertex_groups.remove(obj.vertex_groups[cape])
    for thigh in ("thigh.L", "thigh.R"):
        if thigh in obj.vertex_groups and "hips" in obj.vertex_groups:
            move(thigh, "hips", lambda v: _smoothstep(*THIGH_FADE_Z, v.co.z))
    for arm in ("upper_arm.L", "upper_arm.R"):
        if arm in obj.vertex_groups and "spine" in obj.vertex_groups:
            move(arm, "spine", lambda v: 1 - _smoothstep(*ARM_FADE_Z, v.co.z))
    if obj.name.startswith("hero_tunic"):
        for part in ("forearm.L", "forearm.R", "hand.L", "hand.R"):
            if part in obj.vertex_groups:
                move(part, "spine", lambda v: 1.0)


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
EAR_TOP = 0.028  # top of the ears above the head centre: locks that would hide an ear are cut level here
LOCK_RATIO = 2.0  # width : thickness, never flatter than this
TAIL_TAPER = 2.5  # how a tail closes toward its back point (1 = straight sides, larger = fuller)
# Fitted numerically: scalp ~95% covered, ~7% double-covered, face and ears clear; every lock >= 0.2 wide
# and bending >= 70 degrees around the head (big locks, no small filler spikes). The back hairline sits high and
# the back stays close to the skull (locks sunk in, not flattened); every tip flicks well outward from 40% along,
# and forward-facing tips stop above the brow (no bangs over the eyes).
HAIR = [
    ("sweep_r", (151, 88), (-96, 14), 0.200, 3.50, 0.14, 0.045, 0.085, None, 0.4),  # right of the face: short, tip turned up; its tail over the crown covers the root of sweep_l
    ("sweep_l", (56, 52), (-48, 27), 0.224, 3.43, -0.05, 0.138),
    ("side_l", (97, 16), (-13, 60), 0.200, 2.66, 0.09, 0.127),
    ("side_r", (236, 0), (-22, 45), 0.300, 3.39, -0.45, 0.035, 0.0, EAR_TOP),  # filler above the right ear: flat on the scalp, cut level at the ear top
    ("back", (116, 25), (243, 4), 0.280, 2.97, -0.27, 0.06, 0.07),  # wraps the back, tip turned up behind the right ear
]


def _sph(az, el):
    az, el = math.radians(az), math.radians(el)
    return Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def _slerp(a, b, t):
    om = math.acos(max(-1.0, min(1.0, a.dot(b))))
    if om < 1e-6:
        return a.copy()
    return (a * math.sin((1 - t) * om) + b * math.sin(t * om)) / math.sin(om)


def build_lock(name, exit_dir, end_dir, width, taper, depth, flick, curl=0.0, cut=None, tail=0.0, steps=7):
    """One thick turning cone: hexagonal cross-section width:thickness = LOCK_RATIO, root buried in the skull.
    curl lifts the tip straight up (on top of the outward flick), so a side lock ends turned upward.
    cut (height relative to the head centre) is recorded on the object; _build_locks slices the lock level there
    and drops everything below it, after the ring-based edits that need the untouched ring layout.
    tail (a fraction of the lock's arc) instead continues the same lock backward past its root along its own
    path, narrowing to a second point: one mesh, a leaf pointed at both ends."""
    a, b = _sph(*exit_dir), _sph(*end_dir)

    def ring(centre, along, normal, w):
        th = w / LOCK_RATIO
        side = normal.cross(along).normalized()
        return [centre + side * (w * x) + normal * (th * y)
                for x, y in ((0.5, 0), (0.25, 0.5), (-0.25, 0.5), (-0.5, 0), (-0.25, -0.5), (0.25, -0.5))]

    tip = H + b * (HEAD_R + flick) + Z * curl
    pts = []
    for k in range(steps):
        u = k / steps
        n = _slerp(a, b, u).normalized()
        w = width * (1 - u ** taper)
        bend = max(0.0, (u - 0.4) / 0.6) ** 2                     # the tip turns away from the head
        pts.append((n, H + n * (HEAD_R + depth * w / LOCK_RATIO + flick * bend) + Z * (curl * bend), w))
    start = None
    if tail:
        # the tail: the same path extrapolated to u < 0, the width closing like a leaf toward its back point
        back = []
        for k in range(math.ceil(tail * steps), 0, -1):
            u = -tail * k / math.ceil(tail * steps)
            n = _slerp(a, b, u).normalized()
            w = width * (1 - (-u / tail) ** TAIL_TAPER)
            back.append((n, H + n * (HEAD_R + depth * w / LOCK_RATIO), w))
        n0 = _slerp(a, b, -tail).normalized()
        start = H + n0 * (HEAD_R + depth * width * 0.05 / LOCK_RATIO)
        path = back[1:] + pts
        rings = []
    else:
        root = H + a * HEAD_R * 0.3                                 # buried root: the lock grows out of the skull
        rings = [ring(root, (pts[1][1] - root).normalized(), a, width * 1.05)]
        path = pts
    for k, (n, c, w) in enumerate(path):
        nxt = path[k + 1][1] if k + 1 < len(path) else tip
        rings.append(ring(c, (nxt - c).normalized(), n, w))
    obj = lib.loft(name, rings, "hero_hair", tip=tip, start=start)
    obj["rings"] = len(rings)
    if cut is not None:
        obj["cut"] = cut
    return obj


def _cut_below(obj, z):
    """Slice a mesh with a level plane, delete the part below and cap the cut."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(obj.data)
    bm.free()


# Root swing: on side_l and back the cone's underside (its base) left the skull in a thin, hard wedge. The first
# two layers of the lock (rings 0..2) are swung toward the head centre by ROOT_FLARE degrees, pivoting on the
# fourth ring, so the base turns into the skull and meets it at a wider, smoother angle.
ROOT_FLARE = {"side_l": 20.0, "back": 20.0}
FLARE_PIVOT = 3  # ring index the root swings about


def _flare_roots(objs):
    for (n, *_), o in zip(HAIR, objs):
        if n not in ROOT_FLARE:
            continue
        vs = o.data.vertices
        pivot = sum((vs[FLARE_PIVOT * 6 + i].co for i in range(6)), Vector()) / 6
        for r in range(FLARE_PIVOT):
            idx = range(r * 6, r * 6 + 6)
            c = sum((vs[i].co for i in idx), Vector()) / 6
            axis = (c - pivot).cross(H - pivot).normalized()      # positive angles swing toward the head
            rot = Quaternion(axis, math.radians(ROOT_FLARE[n]))
            for i in idx:
                vs[i].co = pivot + rot @ (vs[i].co - pivot)
        o.data.update()


# Tip pull: the tips stuck far out and made the head look top-heavy and lopsided. On every lock the outer part of
# its length (TIP_SPAN, or the lock's own span in TIP_OVERRIDE, measured along the ring centres to the tip) curls in
# toward the head: past the point that far from the tip, every ring turns the rest of the lock a further TIP_STEP
# degrees toward the head centre about itself, like a chain rolling up, and the rings are drawn in toward that point
# in proportion to how far out they lie (the tip to TIP_SHORTEN of its distance).
TIP_SPAN = 0.4
TIP_SHORTEN = 0.75
TIP_STEP = 3.0  # degrees per ring
TIP_OVERRIDE = {"sweep_l": 0.65, "sweep_r": 0.5}  # name: span
# The crown lock and the back lock curl in a little less (2.5 degrees per ring instead of TIP_STEP) and keep their
# full length (not shortened by TIP_SHORTEN).  name: (shorten, step)
TIP_SHAPE = {"sweep_r": (1.0, 2.5), "back": (1.0, 2.5)}


def _pull_tips(objs):
    for (n, *_), o in zip(HAIR, objs):
        span = TIP_OVERRIDE.get(n, TIP_SPAN)
        shorten, step = TIP_SHAPE.get(n, (TIP_SHORTEN, TIP_STEP))
        R = o["rings"]
        vs = o.data.vertices
        groups = [list(range(r * 6, r * 6 + 6)) for r in range(R)] + [[R * 6]]   # the rings, then the tip point
        centres = [sum((vs[i].co for i in g), Vector()) / len(g) for g in groups]
        cum = [0.0]
        for p, q in zip(centres, centres[1:]):
            cum.append(cum[-1] + (q - p).length)
        s0 = cum[-1] * (1 - span)
        k = next(i for i in range(1, len(cum)) if cum[i] >= s0)
        f = (s0 - cum[k - 1]) / max(cum[k] - cum[k - 1], 1e-9)
        pivot = centres[k - 1].lerp(centres[k], f)
        # draw in
        for g, sg in zip(groups[k:], cum[k:]):
            scale = 1 - (1 - shorten) * (sg - s0) / (cum[-1] - s0)
            for i in g:
                vs[i].co = pivot + (vs[i].co - pivot) * scale
        # curl: a fixed turn at every ring along the way
        hinge = pivot
        for j in range(k, len(groups)):
            tip = sum((vs[i].co for i in groups[-1]), Vector()) / len(groups[-1])
            axis = (tip - hinge).cross(H - hinge)
            if axis.length < 1e-9:
                break
            rot = Quaternion(axis.normalized(), math.radians(step))
            for g in groups[j:]:
                for i in g:
                    vs[i].co = hinge + rot @ (vs[i].co - hinge)
            hinge = sum((vs[i].co for i in groups[j]), Vector()) / len(groups[j])
        o.data.update()


# Scalp hug: a lock rises out of its buried root as a hard-edged cone, standing off the skull. Every lock vertex
# within HUG_BAND of the scalp is pulled radially toward it, the more the closer it already is, down to HUG_MIN
# (the height above the scalp h becomes HUG_MIN + (h - HUG_MIN) * smoothstep(HUG_MIN, HUG_BAND, h): monotonic,
# so nothing folds), while the upper surfaces and
# the tips, further out, keep their shape. The root bulges settle onto the head instead of jutting from it.
# Every lock is pressed, except where sweep_l (the fringe) meets the face: its part within FACE_ZONE of straight
# forward from the head centre is left as it is (faded over FACE_FADE), so the fringe keeps its edge on the brow.
HUG_BAND = 0.06
HUG_MIN = 0.014   # never pressed closer to the scalp than this: the ears stand ~0.011 off it and must stay under
FACE_ZONE = 0.5   # cos of the angle from straight forward inside which the fringe is left as it is
FACE_FADE = 0.15  # the hug fades out over this much of that cosine before the face zone


def _hug_scalp(obj, fringe=False):
    for v in obj.data.vertices:
        d = v.co - H
        h = d.length - HEAD_R
        if h <= HUG_MIN:
            continue                                                # already as close as it may get
        keep = _smoothstep(FACE_ZONE - FACE_FADE, FACE_ZONE, d.normalized().x) if fringe else 0.0
        pulled = HUG_MIN + (h - HUG_MIN) * _smoothstep(HUG_MIN, HUG_BAND, h)
        v.co = H + d.normalized() * (HEAD_R + h + (pulled - h) * (1 - keep))
    obj.data.update()


# Cap lift: a lock cut level (side_r, at the top of the ear) is closed by a flat cap that sticks straight out of the
# side of the skull, almost at right angles to it. The cap is turned CAP_LIFT degrees upward about the line where it
# meets the scalp. Rather than bending the cap's vertices (which folds the faces around it), the lock is cut along
# the turned cap itself: a cone opening up and out from the scalp's circle at the cut height, everything outside it
# removed. Each edge of the lock then simply ends on the cone, and the flat faces are only split, never bent. The
# cone's facets are seamed exactly where the lock's edges cross it, so the cap continues the grid of faces above.
CAP_LIFT = 75.0
CAP_MERGE = 0.006  # vertices of the cut lock closer than this are merged into one


def _lift_cap(obj, z):
    import bmesh
    r0 = math.sqrt(max(HEAD_R ** 2 - (z - H.z) ** 2, 0.0))          # the scalp's radius at the cut height
    rise = 0.3
    slope = 1 / math.tan(math.radians(CAP_LIFT))
    # seam the cone exactly where the lock's own edges cross it, so the cap's facets continue the faces above
    # (one cap facet under each face, meeting along the same lines) instead of crossing them at random
    def outside(co):
        return math.hypot(co.x - H.x, co.y - H.y) - r0 - max(co.z - z, 0.0) * slope
    angles = []
    for e in obj.data.edges:
        p, q = (obj.data.vertices[i].co for i in e.vertices)
        fp, fq = outside(p), outside(q)
        if (fp > 0) == (fq > 0) or min(p.z, q.z) < z - 1e-6:
            continue
        c = p.lerp(q, fp / (fp - fq))
        angles.append(math.atan2(c.y - H.y, c.x - H.x) % (2 * math.pi))
    angles.sort()
    seams = []
    for a in angles:
        if not seams or a - seams[-1] > math.radians(0.5):
            seams.append(a)
    if seams and 2 * math.pi - seams[-1] + seams[0] < math.radians(0.5):
        seams.pop()
    # close the ring away from the lock with a few plain seams
    filled = []
    for k, a in enumerate(seams):
        filled.append(a)
        b = seams[(k + 1) % len(seams)] + (2 * math.pi if k + 1 == len(seams) else 0.0)
        gap = b - a
        if gap > math.radians(40):
            extra = int(gap // math.radians(30))
            filled += [a + gap * (i + 1) / (extra + 1) for i in range(extra)]
    seams = filled or [2 * math.pi * k / 12 for k in range(12)]
    # the cutter: a solid ring around the vertical axis through the head, its inner wall the turned cap
    profile = [(r0, z - 0.05), (r0, z), (r0 + rise * slope, z + rise),
               (1.0, z + rise), (1.0, z - 0.05)]
    seg = len(seams)
    bm = bmesh.new()
    rows = []
    for a in seams:
        rows.append([bm.verts.new((H.x + r * math.cos(a), H.y + r * math.sin(a), h)) for r, h in profile])
    n = len(profile)
    for k in range(seg):
        A, B = rows[k], rows[(k + 1) % seg]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((A[i], A[j], B[j], B[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("cap_cutter")
    bm.to_mesh(me)
    bm.free()
    cutter = lib.link(bpy.data.objects.new("cap_cutter", me))
    mod = obj.modifiers.new("cap_lift", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
    lib.apply_modifiers(obj)
    bpy.data.objects.remove(cutter)
    bpy.data.meshes.remove(me)
    # the cut leaves near-coincident vertices (two seams a few millimetres apart, boolean slivers): merge them,
    # the lock's own edges are all well over a centimetre
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=CAP_MERGE)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bm.to_mesh(obj.data)
    bm.free()
    lib.flat(obj)


# Crown drop: the highest lock stood too tall on the crown. Its vertices are lowered by up to CROWN_DROP (about one
# art pixel at the default camera distance), fading in from CROWN_FROM above the head centre to the lock's top, so
# its lower parts stay where they are and nothing folds (the drop's slope stays well under 1).
CROWN_DROP = {"sweep_r": 0.015}
CROWN_FROM = 0.15


def _drop_crown(obj, drop):
    vs = obj.data.vertices
    lo, hi = H.z + CROWN_FROM, max(v.co.z for v in vs)
    for v in vs:
        v.co.z -= drop * _smoothstep(lo, hi, v.co.z)
    obj.data.update()


def _build_locks():
    """The locks in HAIR order: built, roots swung, cut level (and the cap lifted), pressed to the scalp."""
    objs = [build_lock(f"hair_{n}", *args) for n, *args in HAIR]
    assert len(objs) == 5
    _flare_roots(objs)
    _pull_tips(objs)
    for o in objs:
        del o["rings"]
        if "cut" in o:
            _cut_below(o, H.z + o["cut"])
            _lift_cap(o, H.z + o["cut"])
            del o["cut"]
    for (n, *_), o in zip(HAIR, objs):
        _hug_scalp(o, fringe=n == "sweep_l")
        if n in CROWN_DROP:
            _drop_crown(o, CROWN_DROP[n])
    return objs


def build_hair(name):
    return lib.join(name, _build_locks())


# Hood cross-section: an egg — narrower toward the top, fuller toward the bottom — on a gentle superellipse, so the
# face opening tapers upward yet its crown stays round (no apex). HOOD_EGG is how much the width shrinks at the top
# and grows at the bottom; HOOD_SQUARE > 2 fills the shoulders of the curve out a little.
HOOD_EGG = 0.24
HOOD_SQUARE = 2.4
# Drape: behind the face opening the lower half of the hood is pulled down to the cloak's collar, so the cloth
# hangs from the skull onto the back instead of leaving the nape and the back of the head bare.
HOOD_DRAPE_Z = 0.40  # how far down the hood's lower rim is drawn (well under the collar top at z = 0.445)


def _smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# The hood is built from its side profile (x forward, z up, relative to the head centre), sliced into vertical rings:
#   HOOD_TOP   — the top surface: one smooth convex curve from the top of the face opening, over the crown, down to a
#                slim peak close behind the skull. It never turns: its slope only steepens toward the peak.
#   HOOD_UNDER — the underside along the middle: under the chin and the head (hidden by the body), then the turn —
#                in from the peak almost level, bending down in one concave curve to the collar on the upper back.
#   HOOD_WIDTH — half-width across at each x.
HOOD_PEAK = (-0.31, 0.06)
HOOD_TOP = [(0.16, 0.2), (0.02, 0.238), (-0.12, 0.2), (-0.24, 0.12), HOOD_PEAK]
HOOD_UNDER = [(0.16, -0.2), (0.0, -0.22), (-0.1, -0.2), (-0.19, -0.155), (-0.215, -0.08), (-0.24, -0.005),
              (-0.275, 0.04), HOOD_PEAK]
HOOD_WIDTH = [(0.16, 0.175), (0.02, 0.21), (-0.1, 0.2), (-0.17, 0.17), (-0.22, 0.12), (-0.27, 0.06), (HOOD_PEAK[0], 0.0)]
HOOD_SIDES = 12
# The hood folds back about the nape (bone "hood") when it is down on the shoulders, during the "cloak" clip.
HOOD_PIVOT = BAG_C
# Ring positions (x): dense where the underside turns.
HOOD_SLICES = [0.16, 0.1, 0.03, -0.04, -0.1, -0.15, -0.185, -0.205, -0.225, -0.245, -0.265, -0.285]
# Behind the face opening and in front of the turn, the lower sides of the hood are drawn down to the collar, so the
# cloth hangs from the skull onto the shoulders and back (the turn under the peak is left exactly as profiled).
HOOD_DRAPE_X = (0.12, 0.0, -0.17, -0.2)  # drape ramps in over the first pair of x, out over the second
# The draped cloth keeps at least this far off the head centre, so it slides down the back of the skull.
HOOD_SKULL_CLEAR = HEAD_R + 0.025
# How far inside the cloth the hair is cut, so no lock pokes through a facet of the low-poly hood.
HOOD_HAIR_INSET = 0.03
# How far in front of the face opening the hair may still reach (locks peeking out of the hood).
HOOD_HAIR_LIP = 0.025


def _pchip(pts, x):
    """Monotone cubic (Fritsch-Carlson) through [(x, y)] sorted by descending x: smooth, never overshoots."""
    xs = [p[0] for p in reversed(pts)]
    ys = [p[1] for p in reversed(pts)]
    n = len(xs)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else
                  3 * (xs[i + 1] - xs[i - 1]) / ((2 * xs[i + 1] - xs[i] - xs[i - 1]) / d[i - 1] +
                                                 (xs[i + 1] + xs[i] - 2 * xs[i - 1]) / d[i])
                  for i in range(1, n - 1)] + [d[-1]]
    x = max(xs[0], min(xs[-1], x))
    i = max(0, min(n - 2, next((j for j in range(n - 1) if x <= xs[j + 1]), n - 2)))
    hh = xs[i + 1] - xs[i]
    t = (x - xs[i]) / hh
    h00, h10, h01, h11 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
    return h00 * ys[i] + h10 * hh * m[i] + h01 * ys[i + 1] + h11 * hh * m[i + 1]


def _hood_rings(draped=True):
    """
    The hood's vertical rings, front (face opening) to back, their centres, and the peak. Each ring is an egg spanning
    HOOD_TOP to HOOD_UNDER at its x; with `draped`, the lower sides in front of the turn are drawn down to the collar.
    """
    exp = 2 / HOOD_SQUARE
    rings, centres = [], []
    for x in HOOD_SLICES:
        top, under, half_w = _pchip(HOOD_TOP, x), _pchip(HOOD_UNDER, x), _pchip(HOOD_WIDTH, x)
        c = h(x, 0, (top + under) / 2)
        half_h = (top - under) / 2
        a0, a1, b0, b1 = HOOD_DRAPE_X
        drape = _smoothstep(a0, a1, x) * (1 - _smoothstep(b0, b1, x)) if draped else 0.0
        ring = []
        for a in range(HOOD_SIDES):
            t = 2 * math.pi * a / HOOD_SIDES
            ct, st = math.cos(t), math.sin(t)
            across = math.copysign(abs(ct) ** exp, ct) * (1 - HOOD_EGG * st)
            p = c + Y * (across * half_w) + Z * (math.copysign(abs(st) ** exp, st) * half_h)
            if st < 0 and drape > 0:
                w = drape * (-st) ** 0.8  # the lowest point of the ring drops the most
                p.z += (min(p.z, HOOD_DRAPE_Z) - p.z) * w
                off = p - H
                if off.length < HOOD_SKULL_CLEAR:
                    p = H + off.normalized() * HOOD_SKULL_CLEAR
            ring.append(p)
        rings.append(ring)
        centres.append(c)
    return rings, centres, h(HOOD_PEAK[0], 0, HOOD_PEAK[1])


def build_hood():
    """
    Close hood: one lofted tube along a short spine over the skull. The front ring is the face opening (an egg,
    narrower at the top); the rings follow the skull and taper to a small peak above the back of the head. Behind the
    opening the lower half of every ring is drawn down to the collar, so the cloth hangs down the back of the head.
    """
    rings, _, tip = _hood_rings()
    return lib.loft("hood", rings, "hero_cape", tip=tip)


def _hood_volume():
    """
    A closed solid just inside the hood (capped a little in front of the face opening): what the hair may fill.
    Built from the undraped tube: the drape folds the rings over each other near the peak, which would make the
    solid self-intersect, and everything below the tube is hidden under the drape anyway.
    """
    rings, centres, tip = _hood_rings(draped=False)
    inner = [[p - (p - c).normalized() * HOOD_HAIR_INSET for p in ring] for ring, c in zip(rings, centres)]
    lip = [p + X * HOOD_HAIR_LIP for p in inner[0]]
    rows = [lip] + inner
    n = HOOD_SIDES
    verts = [v for row in rows for v in row]
    faces = []
    for r in range(len(rows) - 1):
        for i in range(n):
            a, b = r * n + i, r * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    verts.append(tip)
    t = len(verts) - 1
    last = (len(rows) - 1) * n
    faces += [(last + i, last + (i + 1) % n, t) for i in range(n)]
    verts.append(sum(lip, Vector()) / n)
    f = len(verts) - 1
    faces += [(i, f, (i + 1) % n) for i in range(n)]
    return lib.mesh_from("hood_volume", verts, faces, "hero_hair", recalc=True)


def build_hooded_hair(name):
    """The locks cut down to what lies inside the hood, so they show in the face opening but never poke out."""
    hair = build_hair(name)
    vol = _hood_volume()
    mod = hair.modifiers.new("hood_cut", "BOOLEAN")
    mod.operation = "INTERSECT"
    mod.solver = "EXACT"
    mod.use_self = True  # the locks overlap each other
    mod.use_hole_tolerant = True
    mod.object = vol
    lib.apply_modifiers(hair)
    bpy.data.objects.remove(vol)
    lib.flat(hair)
    return hair


def build_cape():
    """
    Full-body cloak: wraps the back and both sides from a raised collar down to the ankles,
    leaving only a narrow opening at the front. Weighted down the cape chain.
    Cloth read: the sheet hangs in sharp pleats (alternating ridge / valley columns) that are born under
    the shoulders, deepen towards the hem and drift sideways as they fall, so each fold line turns a few
    times on the way down; uneven fold depths and a ragged, ridge-low hem keep it from looking machined.
    """
    wrap = math.radians(160)  # angle from the back to each front edge (front opening = 2 * 20°)
    cols = 20  # even: ridge and valley columns alternate, so 10 pleats around
    k = THICK / 1.5  # radii below are sized for THICK = 1.5
    d = 0.8 + 0.2 * (DEPTH - 0.7) / 0.3  # x-radii (depth) shrink with the flatter trunk; sized for DEPTH = 0.7
    rows = [  # (z, x-radius, y-radius, x-centre, pleat depth, sideways drift in radians)
        (0.445, 0.055, 0.062, -0.005, 0.0, 0.0),          # collar top
        (0.385, 0.085, 0.14, -0.005, 0.0, 0.0),           # shoulders (dropped with the shoulder caps)
        (0.355, 0.12 * k * d, 0.17, -0.002, 0.03, 0.0),   # pleats are born under the shoulders
        (0.31, 0.155 * k * d, 0.185, 0.0, 0.05, 0.03),
        (0.255, 0.163 * k * d, 0.19 * k, 0.0, 0.065, -0.02),  # hips: folds kink back
        (0.205, 0.167 * k * d, 0.195 * k, 0.0, 0.08, 0.04),
        (0.155, 0.17 * k * d, 0.2 * k, 0.0, 0.095, 0.0),
        (0.105, 0.173 * k * d, 0.205 * k, 0.0, 0.11, 0.05),
        (0.065, 0.178 * k * d, 0.212 * k, 0.0, 0.12, 0.02),  # hem, just above the ankles
    ]
    # per-pleat depth jitter (fixed, so rebuilds are identical) and per-column hem drop
    jitter = [1.0, 0.6, 1.3, 0.8, 1.15, 0.7, 1.25, 0.9, 1.1, 0.65, 1.2, 0.85, 1.0, 0.75, 1.3, 0.6, 1.1, 0.9, 1.2, 0.7, 1.0]
    rings = []
    for r, (z, rx, ry, cx, depth, drift) in enumerate(rows):
        last = r == len(rows) - 1
        ring = []
        for c in range(cols + 1):
            a = -wrap + 2 * wrap * c / cols  # 0 = straight back
            edge = c in (0, cols)
            if not edge:
                a += drift * math.sin(a * 0.5 + r)  # fold lines wander sideways as they fall
            ridge = c % 2 == 0
            # ridges stand out, valleys tuck in a little less (the sheet must stay clear of the body)
            fold = 1 + depth * jitter[c] * (1.0 if ridge else -0.35)
            if edge:
                fold = 1 + depth * 0.3  # front edges hang flat, slightly rolled out
            drop = 0.0
            if last:
                drop = (0.014 if ridge else -0.006) * jitter[c] + 0.006 * math.sin(c * 1.7)
            ring.append((cx - math.cos(a) * rx * fold, math.sin(a) * ry * fold, z - drop))
        rings.append(ring)
    cloak = lib.loft("cape", rings, "hero_cape", closed=False)
    clasp = lib.ico("clasp", (0.078, 0.0, 0.395), 0.014, "hero_buckle", 0)
    return cloak, clasp


def _bag_half_width(z):
    zs = [r[0] for r in BAG_RINGS]
    return _pchip([(z_, w) for z_, w, _ in reversed(BAG_RINGS)], min(max(z, zs[0]), zs[-1]))


def build_bag():
    """The backpack's body: rounded-rectangle rings (a superellipse) from the flat bottom up over the rounded top."""
    sides, e = 12, 0.4  # e < 1 squares the rings off

    def ring(z, hw, hd):
        pts = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            c, s_ = math.cos(a), math.sin(a)
            pts.append((BAG_C.x - math.copysign(abs(c) ** e, c) * hd, math.copysign(abs(s_) ** e, s_) * hw, z))
        return pts

    rings = [ring(*r) for r in BAG_RINGS]
    return lib.loft("bag", rings, "hero_cape", tip=(BAG_C.x, 0, BAG_TOP), start=(BAG_C.x, 0, BAG_RINGS[0][0]))


def build_bag_flap(cols=7):
    """The flap: a sheet over the top and down the outside to a slanting edge, and its round button."""
    rows = len(FLAP_PROFILE) + 2
    verts = []
    for c in range(cols):
        t = -1 + 2 * c / (cols - 1)  # -1 right side .. 1 left side
        edge = FLAP_EDGE[1] + (FLAP_EDGE[0] - FLAP_EDGE[1]) * (t + 1) / 2
        u_side, z_side = FLAP_PROFILE[-1]
        path = FLAP_PROFILE + [(u_side, z_side + (edge - z_side) * k / 2) for k in (1, 2)]
        for u, z in path:
            verts.append((BAG_C.x - u, t * (_bag_half_width(z) + 0.004), z))
    faces = [(c * rows + r, c * rows + r + 1, (c + 1) * rows + r + 1, (c + 1) * rows + r)
             for c in range(cols - 1) for r in range(rows - 1)]
    flap = lib.mesh_from("bag_flap", verts, faces, "hero_cape")
    u_side = FLAP_PROFILE[-1][0]
    button = lib.ico("bag_button", (BAG_C.x - u_side - 0.004, 0, sum(FLAP_EDGE) / 2 + 0.01), 0.009, "hero_buckle", 1,
                     scale=(0.5, 1, 1))
    return lib.join("bag_flap", [flap, button])


def build_strap(surfaces, steps=36):
    """
    The bag's strap: a flat band ringing the trunk in the slanted plane through STRAP_C, laid on the outermost of
    `surfaces` (body, tunic) by casting rays out from inside, so it follows the shoulder slope and the tunic.
    """
    from mathutils.bvhtree import BVHTree
    up = Vector((0, math.sin(math.radians(STRAP_TILT)), math.cos(math.radians(STRAP_TILT))))
    across = X.cross(up)
    deps = bpy.context.evaluated_depsgraph_get()
    trees = [BVHTree.FromObject(o, deps) for o in surfaces]
    verts = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        ray = X * math.cos(a) + up * math.sin(a)
        hits = [hit for hit in (tr.ray_cast(STRAP_C, ray) for tr in trees) if hit[0] is not None]
        loc, nrm = max(hits, key=lambda hit: hit[3])[:2]
        out, inner = loc + nrm * STRAP_OFF, loc + nrm * 0.001
        verts += [out + across * STRAP_W / 2, out - across * STRAP_W / 2,
                  inner - across * STRAP_W / 2, inner + across * STRAP_W / 2]
    faces = []
    for i in range(steps):
        j = (i + 1) % steps
        for k in range(4):
            faces.append((4 * i + k, 4 * i + (k + 1) % 4, 4 * j + (k + 1) % 4, 4 * j + k))
    return lib.mesh_from("strap", verts, faces, "hero_belt", recalc=True)


# The sword rides on the back in a scabbard and is drawn only to fight. It is two copies on two bones that never deform
# anything: "sword.R" in the right hand and "sword.back" on the chest, one shrunk to nothing at a time (lib.action
# "_hide"). They swap on GRAB, the right hand reached back over the shoulder onto the hilt: GRAB's hand rotation is
# solved (solve_grab) so the held sword lies exactly where the sheathed one is, along SWORD_BACK_DIR, flat to the back.
SWORD_GRIP = L("hand", -1) + Vector((0.005, -0.004, -0.02))
SWORD_DIR = Vector((0.75, 0, -0.66)).normalized()   # blade direction in the hand at rest
SWORD_UP = SWORD_DIR.cross(Y).normalized()          # normal of the blade's flat
SWORD_BACK_DIR = Vector((-0.15, 0.45, -0.88)).normalized()  # sheathed: hilt over the right shoulder, tip at the left hip
GRAB_ARM = {"upper_arm.R": [(Y, -160), (X, -25)], "forearm.R": [(Y, -100)]}
SHEATHED = ["sword.R"]      # "_hide" while the sword is on the back
DRAWN = ["sword.back"]      # "_hide" while it is in the hand


def build_sword(suffix):
    """The sword in the right hand at rest (blade, guard, grip, pommel), its parts named with `suffix`."""
    rot = lib.align(SWORD_DIR)

    def pt(along, across, depth=0.0):
        return SWORD_GRIP + SWORD_DIR * along + Y * across + SWORD_UP * depth

    blade_v = [pt(0.04, -0.012), pt(0.04, 0.012), pt(0.27, 0.012), pt(0.27, -0.012), pt(0.31, 0),
               pt(0.04, 0, 0.005), pt(0.27, 0, 0.005), pt(0.04, 0, -0.005), pt(0.27, 0, -0.005)]
    blade_f = [(0, 5, 6, 3), (5, 1, 2, 6), (3, 6, 4), (6, 2, 4), (0, 3, 8, 7), (7, 8, 2, 1), (3, 4, 8), (8, 4, 2)]
    return [
        lib.mesh_from(f"blade{suffix}", blade_v, blade_f, "hero_blade"),
        lib.box(f"guard{suffix}", pt(0.035, 0), (0.008, 0.04, 0.01), "hero_buckle", rot),
        lib.box(f"grip{suffix}", pt(0.0, 0), (0.032, 0.009, 0.009), "hero_grip", rot),
        lib.ico(f"pommel{suffix}", pt(-0.036, 0), 0.012, "hero_buckle", 0),
    ]


def build_scabbard():
    """A leather sheath round the blade, in the hand frame like build_sword (moved onto the back with it)."""
    c = SWORD_GRIP + SWORD_DIR * 0.165
    return lib.box("scabbard", c, (0.13, 0.017, 0.009), "hero_grip", lib.align(SWORD_DIR))


def _delta(rig, bone):
    """A posed bone's rotation relative to its rest, in armature space."""
    return rig.pose.bones[bone].matrix.to_quaternion() @ rig.data.bones[bone].matrix_local.to_quaternion().inverted()


def solve_grab(rig):
    """
    GRAB, the right hand on the hilt behind the shoulder (GRAB_ARM plus a solved hand rotation turning the held blade
    onto SWORD_BACK_DIR, flat to the back), and the transform taking the sword from the hand at rest to the back.
    """
    lib.set_pose(rig, GRAB_ARM)
    bpy.context.view_layer.update()
    held = _delta(rig, "sword.R")
    b1, n1 = held @ SWORD_DIR, held @ SWORD_UP
    b2 = SWORD_BACK_DIR
    n2 = (X - b2 * X.dot(b2)).normalized()
    if n2.dot(n1) < 0:
        n2 = -n2
    frame = lambda b, n: Matrix((b, n, b.cross(n))).transposed()
    turn = (frame(b2, n2) @ frame(b1, n1).transposed()).to_quaternion()      # world turn of the hand about the wrist
    arm = _delta(rig, "forearm.R")
    q = arm.inverted() @ turn @ arm                                            # the same turn in the hand's rest frame
    axis, angle = q.to_axis_angle()
    grab = dict(GRAB_ARM, **{"hand.R": [(tuple(axis), math.degrees(angle))]})
    lib.set_pose(rig, grab)
    bpy.context.view_layer.update()
    # sheathed copy: where the held one is in the GRAB pose, carried by the chest instead of the hand
    pb, bone = rig.pose.bones, rig.data.bones
    to_back = (bone["chest"].matrix_local @ pb["chest"].matrix.inverted() @ pb["sword.R"].matrix
               @ bone["sword.R"].matrix_local.inverted())
    lib.set_pose(rig, {})
    bpy.context.view_layer.update()
    return grab, to_back


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
        ("sword.back", (-0.1, -0.08, 0.42), (-0.12, -0.03, 0.33), "chest"),
        ("hood", tuple(HOOD_PIVOT), tuple(HOOD_PIVOT + Vector((0, 0, 0.15))), "head"),
        ("bag", tuple(BAG_C), tuple(BAG_C + Vector((0, 0, 0.08))), "chest"),
        ("bag_flap", tuple(FLAP_HINGE), tuple(FLAP_HINGE + Vector((0, 0, 0.05))), "bag"),
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
    b.append(("sword.R", tuple(SWORD_GRIP), tuple(SWORD_GRIP + SWORD_DIR * 0.1), "hand.R"))
    rig = lib.armature("hero_rig", b)
    for n in ("sword.R", "sword.back", "hood", "bag", "bag_flap"):
        rig.data.bones[n].use_deform = False  # prop holders only: automatic skinning must not use them
    return rig


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


def build_actions(rig, grab):
    tau = 2 * math.pi

    def sword(keys, drawn=(0, 0)):
        """Key which sword shows: the one in hand on frames in [drawn), the one on the back otherwise."""
        return {f: dict(p, _hide=DRAWN if drawn[0] <= f < drawn[1] else SHEATHED) for f, p in keys.items()}

    def gripping(pose):
        """`pose` with the right hand back over the shoulder on the hilt, where the sword swaps hands."""
        return dict(pose, **grab)

    # run (12 frames = 0.5 s a cycle, two strides): torso pitched into the run, long reaching thigh swings with the
    # recovering knee folded high, elbows bent near a right angle and pumping against the legs, a bounce that peaks
    # in the flight phase between footfalls.
    def run(ph):
        c, s = math.cos(ph * tau), math.sin(ph * tau)
        return merge(
            legs(-26 - 38 * c, -26 + 38 * c, 20 + 80 * max(0, s), 20 + 80 * max(0, -s), 15 * c, -15 * c),
            {
                "upper_arm.L": [(Y, -5 + 50 * c), (X, 10)], "upper_arm.R": [(Y, -5 - 50 * c), (X, -10)],
                "forearm.L": [(Y, -85 + 15 * c)], "forearm.R": [(Y, -85 - 15 * c)],
                "hips": [(Y, 8), (Z, 10 * c)], "spine": [(Y, 10)], "chest": [(Z, -14 * c), (Y, 8)],
                "head": [(Z, 5 * c), (Y, -20)],
                "cape.1": [(Y, 34 + 8 * abs(s))], "cape.2": [(Y, 22 + 10 * s)],
                "_lift": 0.034 * abs(s) - 0.012,
            },
        )

    lib.action(rig, "run", sword({f: run((f - 1) / 12) for f in range(1, 14, 2)}))

    def idle(ph):
        b = math.sin(ph * tau)
        return {
            "spine": [(Y, 1.5 * b)], "chest": [(Y, 1.5 * b)], "head": [(X, 3 * math.sin(ph * tau * 0.5))],
            "upper_arm.L": [(X, 6 + 2 * b)], "upper_arm.R": [(X, -6 - 2 * b)],
            "forearm.L": [(Y, -12)], "forearm.R": [(Y, -18)],
            "cape.1": [(Y, 3 + 2 * b)], "cape.2": [(Y, 2 + 3 * b)],
            "_lift": -0.003 * b,
        }

    lib.action(rig, "idle", sword({f: idle((f - 1) / 48) for f in range(1, 50, 6)}))

    # attack: a right-handed forehand slash, the sword drawn from the back first and put back after.
    # draw -> anticipation (torso twists right, sword drawn back out to the side) -> strike (sweeps across, step in)
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
    lib.action(rig, "attack", sword({1: rest, 3: gripping(rest), 5: wind, 7: strike, 9: follow, 13: rest,
                                     15: gripping(rest), 17: rest}, drawn=(3, 15)))

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

    lib.action(rig, "crouch", sword({f: crouch((f - 1) / 48) for f in range(1, 50, 6)}))

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

    lib.action(rig, "crouch_walk", sword({f: crouch_walk((f - 1) / 24) for f in range(1, 26, 3)}))

    # cloak (9 frames, 0.375 s): the backpack turning into the cloak as the hero crouches on the surface. The game does
    # not play it: it scrubs it by a 0-1 progress and takes only some bones from it (view.ts), over whatever the hero
    # is doing. Off, the cloak (cape.1 shrunk about its root) and the hood (shrunk, turned so it lies straight out
    # behind the bag's centre) are inside the bag. The right hand reaches over the shoulder to the bag (the sword's
    # grab pose) and flips the flap open; the bag shrinks away, flap and all, as the hood swells out of it and the
    # cloak unrolls down the back; the hand pulls the hood over the head, and lets go.
    hidden = lib.HIDDEN_SCALE
    out = -120  # the hood's turn that puts it straight out behind the bag
    lift = {"upper_arm.R": [(Y, -175), (X, -20)], "forearm.R": [(Y, -70)]}
    pull = {"upper_arm.R": [(Y, -135), (X, -15)], "forearm.R": [(Y, -95)]}

    def cloak(cape, hood, fold, bag, flap, arm=None):
        return dict(idle(0), **{"cape.1": [(Y, -6)], "hood": [(Y, hood)], "bag_flap": [(Y, flap)],
                                 "_scale": {"cape.1": cape, "hood": fold, "bag": bag}}, **(arm or {}))

    lib.action(rig, "cloak", sword({
        1: cloak(hidden, out, hidden, 1.0, 0),
        3: cloak(hidden, out, hidden, 1.0, 95, grab),
        5: cloak(0.15, out, 0.6, 0.35, 95, grab),
        6: cloak(0.4, out + 5, 0.9, hidden, 95, lift),
        8: cloak(1.05, -12, 1.0, hidden, 95, pull),
        10: cloak(1.0, 0, 1.0, hidden, 95),
    }), stepped_scale=False)

    # takedown (1.75 s): the game moves the root along the leap onto the troll's back and off again
    # (view.ts TAKEDOWN); the clip poses the body. coil -> tuck in the air, the sword drawn off the back -> land lying on the troll's back, left
    # hand clamps its brow, blade goes straight round to its throat -> ride out its thrashing with the blade held
    # under the jaw (the standoff, 0.4-1.2 s) -> release: a quick thrust in and back out (frame 30), then
    # the blade lowered -> push off backwards -> flip, the sword put back on the back -> land.
    coil = merge(legs(-60, -60, 100, 100, -35, -35), {
        "spine": [(Y, 30)], "chest": [(Y, 16)], "head": [(Y, -30)],
        "upper_arm.L": [(Y, 40), (X, 20)], "upper_arm.R": [(Y, 45), (X, -20)],
        "forearm.L": [(Y, -20)], "forearm.R": [(Y, -20)],
        "cape.1": [(Y, -10)], "cape.2": [(Y, -6)], "_lift": -0.06,
    })
    tuck = merge(legs(-95, -95, 125, 125, -20, -20), {
        "spine": [(Y, 20)], "chest": [(Y, 10)], "head": [(Y, -20)],
        "upper_arm.L": [(Y, -60), (X, 25)], "upper_arm.R": [(Y, -40), (X, -40)],
        "forearm.L": [(Y, -40)], "forearm.R": [(Y, -60)],
        "cape.1": [(Y, 40)], "cape.2": [(Y, 30)], "_lift": 0.05,
    })
    # lying chest-down on the troll's hunched back, chin over its crown: the whole body is pitched forward by the root
    # (the game pins the root to the troll's chest bone, rotation included); knees bent, hugging its sides.
    def prone(extra):
        return merge({
            "root": [(Y, PRONE)],
            "thigh.L": [(Y, -50), (X, 18)], "thigh.R": [(Y, -50), (X, -18)], "shin.L": [(Y, 90)], "shin.R": [(Y, 90)],
            "foot.L": [(Y, -20)], "foot.R": [(Y, -20)],
            "spine": [(Y, 12)], "chest": [(Y, 15)], "head": [(Y, -75)],  # curled down over its crown, face forward
            # arm angles are relative to a body pitched ~87 degrees: about -90 points the arm straight down
            "upper_arm.L": [(X, 35), (Y, -110)], "forearm.L": [(Y, -30)], "hand.L": [(Y, 30)],  # clamping its brow
            "cape.1": [(Y, -30)], "cape.2": [(Y, -20)],
        }, extra)

    land = prone({"upper_arm.R": [(X, -60), (Y, -100)], "forearm.R": [(Y, -30)], "hand.R": [(Y, 20)]})
    # held through the standoff: the sword arm hangs down the right side of the troll's head, blade by its neck.
    # (The arms are far too short to really reach the throat; the cut is sold by the quick thrust below.)
    draw = prone({"upper_arm.R": [(X, -40), (Y, -120)], "forearm.R": [(Y, -10)], "hand.R": [(Y, 20), (Z, 70)]})
    # release: a quick thrust forward through the throat and straight back out. The blade clips through the troll's
    # head only on this one key, so the clipping lasts a couple of frames.
    thrust = prone({"chest": [(Y, 10)], "upper_arm.R": [(X, -30), (Y, -140)], "forearm.R": [(Y, -10)],
                    "hand.R": [(Y, -40), (Z, 50)]})
    push = merge(legs(-90, -90, 130, 130, -45, -45), {
        "spine": [(Y, 10)], "chest": [(Y, 6)], "head": [(Y, -14)],
        "upper_arm.L": [(Y, 30), (X, 25)], "upper_arm.R": [(Y, 35), (X, -25)],
        "forearm.L": [(Y, -20)], "forearm.R": [(Y, -30)],
        "cape.1": [(Y, 4)], "_lift": -0.08,
    })
    flip = merge(legs(-100, -100, 130, 130, -20, -20), {
        "spine": [(Y, -10)], "chest": [(Y, -10)], "head": [(Y, 10)],
        "upper_arm.L": [(Y, -120), (X, 30)], "upper_arm.R": [(Y, -110), (X, -30)],
        "forearm.L": [(Y, -20)], "forearm.R": [(Y, -30)],
        "cape.1": [(Y, 50)], "cape.2": [(Y, 30)], "_lift": 0.06,
    })
    def ride(lean, bob=0.0):
        """Holding on through the troll's thrashing with the blade at its throat, leaning `lean` degrees (+ left)."""
        return merge(draw, {"spine": [(X, lean)], "chest": [(X, lean * 0.6)], "head": [(X, -lean * 0.5)], "_lift": bob})

    lower = prone({"upper_arm.R": [(X, -30), (Y, -80)], "forearm.R": [(Y, -15)], "hand.R": [(Y, 25)]})  # blade lowered
    lib.action(rig, "takedown", sword({1: idle(0), 4: coil, 7: gripping(tuck), 10: land, 12: ride(0),
                                       15: ride(-14, -0.01), 19: ride(16), 23: ride(-12, -0.01), 27: ride(10),
                                       29: ride(0), 30: thrust, 31: ride(0), 34: lower, 35: push,
                                       38: gripping(flip), 41: crouch_base(), 43: idle(0)}, drawn=(7, 38)))


# ---------------------------------------------------------------------------

def build(out_glb, out_preview):
    lib.reset()
    body = build_body()
    clothes = [build_tunic(), build_sleeves(), build_boots()]
    parts = {
        "hair_full": build_hair("hair_full"),
        "hair_hood": build_hooded_hair("hair_hood"),
        "hood": build_hood(),
    }
    parts["cape"], parts["clasp"] = build_cape()
    parts["bag"], parts["bag_flap"] = build_bag(), build_bag_flap()
    parts["strap"] = build_strap([body, clothes[0]])
    held, sheathed = build_sword(""), build_sword("_back")
    scabbard = build_scabbard()
    head_parts = build_head()
    rig = build_rig()
    lib.skin(body, rig)
    for obj in [body] + clothes:
        if obj is not body:
            lib.skin(obj, rig)
        _clean_weights(obj)
    for obj in head_parts:
        lib.attach(obj, rig, "head")
    lib.weight_chain(parts["cape"], rig, [("chest", 0.4), ("cape.1", 0.26), ("cape.2", 0.065)])
    for name in ("hair_full", "hair_hood"):
        lib.attach(parts[name], rig, "head")
    lib.attach(parts["hood"], rig, "hood")
    lib.attach(parts["bag"], rig, "bag")
    lib.attach(parts["bag_flap"], rig, "bag_flap")
    # rigid on the trunk: no arm or thigh swing may tug it
    lib.weight_chain(parts["strap"], rig, [("chest", 0.37), ("spine", 0.3), ("hips", 0.22)])
    lib.attach(parts["clasp"], rig, "chest")
    grab, to_back = solve_grab(rig)
    for obj in sheathed + [scabbard]:
        obj.matrix_world = to_back @ obj.matrix_world
    for obj in held:
        lib.attach(obj, rig, "sword.R")
    for obj in sheathed:
        lib.attach(obj, rig, "sword.back")
    lib.attach(scabbard, rig, "chest")
    props = held + sheathed + [scabbard]
    build_actions(rig, grab)
    rig["variants"] = json.dumps(VARIANTS)  # the game reads this to show / hide outfit parts
    lib.export_glb(out_glb, [rig, body] + clothes + head_parts + list(parts.values()) + props)

    poses = [("idle", 1), ("run", 1), ("run", 4), ("run", 7), ("run", 10), ("attack", 3),
             ("attack", 5), ("attack", 9), ("attack", 15), ("crouch", 1), ("crouch_walk", 1), ("crouch_walk", 7), ("crouch_walk", 13),
             ("cloak", 1), ("cloak", 3), ("cloak", 5), ("cloak", 8), ("cloak", 10),
             ("takedown", 6), ("takedown", 7), ("takedown", 10), ("takedown", 15), ("takedown", 19), ("takedown", 29), ("takedown", 30), ("takedown", 34),
             ("takedown", 35), ("takedown", 37), ("takedown", 38), ("takedown", 41)]
    for variant, shown in VARIANTS.items():
        for name, obj in parts.items():
            obj.hide_render = name not in shown
        if variant == "cloaking":
            # a passing state of the "cloak" clip: the cloak coming out of the bag, from its right side
            lib.set_pose(rig, {"_hide": SHEATHED})
            lib.pose_sheet(rig, out_preview.replace(".png", "_cloak.png"), HEIGHT,
                           [("cloak", f) for f in range(1, 11)], cols=10, view=(0, -1, 0.15))
            continue
        suffix = "" if variant == "plain" else f"_{variant}"
        lib.set_pose(rig, {"_hide": SHEATHED})  # the previews show the rest pose: sword on the back
        lib.previews(out_preview.replace(".png", f"{suffix}.png"), HEIGHT, head=H)
        lib.pose_sheet(rig, out_preview.replace(".png", f"{suffix}_poses.png"), HEIGHT, poses)
        if variant == "plain":
            lib.head_sheet(out_preview.replace(".png", "_head.png"), H, HEIGHT * 0.65)
            # the run from its right side
            lib.pose_sheet(rig, out_preview.replace(".png", "_run.png"), HEIGHT,
                           [("run", f) for f in range(1, 13, 2)], view=(0, -1, 0.1))
            # from behind: the sword on the back, drawn in the leap, put back in the flip
            lib.pose_sheet(rig, out_preview.replace(".png", "_back.png"), HEIGHT, poses, view=(-0.8, -0.5, 0.3))
    print(f"hero: body {lib.tri_count(body)}, head {sum(lib.tri_count(o) for o in head_parts)}, " + ", ".join(f"{n} {lib.tri_count(o)}" for n, o in parts.items()) + " tris")
