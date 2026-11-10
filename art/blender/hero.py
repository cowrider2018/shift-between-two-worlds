"""
Hero (DESIGN §4.2): small chibi adventurer — a primitive head (sphere, box eyes, small human ears) with
hair made of five thick turning cones (see HAIR), on an anatomical body: green tunic with belt, cream leggings, boots,
short sword. Stocky pear-shaped trunk; short legs of straight trouser tubes with wider boots worn over them.

Outfits are modular parts on one skeleton (see VARIANTS):
  plain  — the five-lock hair, no cape, no hood
  hooded — close hood with a small peak above the back of the head, full-body cloak, clasp, and the hair cut
           to what fits inside the hood (it still shows in the face opening)
The bulky locks cannot sit under a hood whole, so the hair itself is a swappable part.

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
    "plain": ["hair_full"],
    "hooded": ["hair_hood", "hood", "cape", "clasp"],
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
EAR_TOP = 0.028  # top of the ears above the head centre: locks that would hide an ear are cut level here
LOCK_RATIO = 2.0  # width : thickness, never flatter than this
# Fitted numerically: scalp ~95% covered, ~7% double-covered, face and ears clear; every lock >= 0.2 wide
# and bending >= 70 degrees around the head (big locks, no small filler spikes). The back hairline sits high and
# the back stays close to the skull (locks sunk in, not flattened); every tip flicks well outward from 40% along,
# and forward-facing tips stop above the brow (no bangs over the eyes).
HAIR = [
    ("sweep_r", (151, 88), (-96, 14), 0.200, 3.50, 0.14, 0.045, 0.085),  # right of the face: short, tip turned up
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


def build_lock(name, exit_dir, end_dir, width, taper, depth, flick, curl=0.0, cut=None, steps=7):
    """One thick turning cone: hexagonal cross-section width:thickness = LOCK_RATIO, root buried in the skull.
    curl lifts the tip straight up (on top of the outward flick), so a side lock ends turned upward.
    cut (height relative to the head centre) slices the lock level and drops everything below it."""
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
    root = H + a * HEAD_R * 0.3                                     # buried root: the lock grows out of the skull
    rings = [ring(root, (pts[1][1] - root).normalized(), a, width * 1.05)]
    for k, (n, c, w) in enumerate(pts):
        nxt = pts[k + 1][1] if k + 1 < len(pts) else tip
        rings.append(ring(c, (nxt - c).normalized(), n, w))
    obj = lib.loft(name, rings, "hero_hair", tip=tip)
    if cut is not None:
        _cut_below(obj, H.z + cut)
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


def build_hair(name):
    objs = [build_lock(f"hair_{n}", *args) for n, *args in HAIR]
    assert len(objs) == 5
    return lib.join(name, objs)


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
    """The five locks cut down to what lies inside the hood, so they show in the face opening but never poke out."""
    hair = build_hair(name)
    vol = _hood_volume()
    mod = hair.modifiers.new("hood_cut", "BOOLEAN")
    mod.operation = "INTERSECT"
    mod.solver = "EXACT"
    mod.use_self = True  # the five locks overlap each other
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

    # takedown (1.75 s): the game moves the root along the leap onto the troll's head and back off
    # (view.ts TAKEDOWN); the clip only poses the body. coil -> tuck in the air -> land crouched on the troll's
    # crown, left hand clamps its brow, blade goes straight to its throat -> ride out its thrashing with the blade
    # held under the jaw (the standoff, 0.4-1.2 s) -> release: slice across and out to the right (frame 30), sheathe
    # the blade down by the side -> push off backwards -> tuck -> land.
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
    perch = {  # knees deep on the crown, leaning out over the troll's face
        "spine": [(Y, 30)], "chest": [(Y, 20)], "head": [(Y, -40)],
        "cape.1": [(Y, 10)], "cape.2": [(Y, 6)], "_lift": -0.07,
    }
    perch_legs = legs(-80, -80, 120, 120, -40, -40)
    grab = {"upper_arm.L": [(Y, -70), (X, 10)], "forearm.L": [(Y, -40)], "hand.L": [(Y, 40)]}  # clamping the brow
    land = merge(perch_legs, perch, grab, {
        "upper_arm.R": [(Y, -20), (X, -70)], "forearm.R": [(Y, -40)], "hand.R": [(Y, 20)],  # sword drawn out right
    })
    # the blade comes across from the troll's left jaw, down under its chin, and is flung out to the right
    # pinning the troll: crouched on its brow ridge, the sword arm reaching down in front of its face so the blade
    # lies under the jaw
    draw = merge(perch_legs, grab, {
        "spine": [(Y, 20)], "chest": [(Y, 14), (Z, 8)], "head": [(Y, -14)],
        "upper_arm.R": [(Y, -40), (Z, 15)], "forearm.R": [(Y, -10)], "hand.R": [(Y, 40)],  # + tips the blade down
        "cape.1": [(Y, 10)], "cape.2": [(Y, 6)], "_lift": -0.07,
    })
    cut = merge(perch_legs, perch, grab, {
        "spine": [(Y, 18)], "chest": [(Y, 10)], "head": [(Y, -20)],
        "upper_arm.R": [(Y, -55), (Z, -5)], "forearm.R": [(Y, -10)], "hand.R": [(Y, -45)],
    })
    through = merge(perch_legs, perch, grab, {
        "hips": [(Z, -12)], "chest": [(Z, -18)],
        "upper_arm.R": [(Y, -35), (X, -60), (Z, -35)], "forearm.R": [(Y, -20)], "hand.R": [(Y, -15)],
    })
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
        """Holding on through the troll's thrashing, blade pressed under its jaw: knees wide, leaning `lean` degrees
        (+ left) against each lurch."""
        return merge(draw, {
            "thigh.L": [(X, 12)], "thigh.R": [(X, -12)],
            "spine": [(X, lean)], "chest": [(X, lean * 0.6)], "head": [(X, -lean * 0.5)],
            "_lift": bob,
        })

    sheathe = merge(perch_legs, perch, grab, {  # blade lowered, point down by the right hip
        "hips": [(Z, -6)], "chest": [(Z, -8)],
        "upper_arm.R": [(Y, 10), (X, -20)], "forearm.R": [(Y, -15)], "hand.R": [(Y, 25)],
    })
    lib.action(rig, "takedown", {1: idle(0), 4: coil, 7: tuck, 10: land, 12: ride(0),
                                 15: ride(-14, -0.01), 19: ride(16), 23: ride(-12, -0.01), 27: ride(10), 29: ride(0),
                                 30: through, 32: through, 34: sheathe, 35: push, 38: flip, 41: crouch_base(), 43: idle(0)})


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
    props = build_props()
    head_parts = build_head()
    rig = build_rig()
    lib.skin(body, rig)
    for obj in clothes:
        lib.skin(obj, rig)
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
    lib.export_glb(out_glb, [rig, body] + clothes + head_parts + list(parts.values()) + [o for o, _ in props.values()])

    poses = [("idle", 1), ("walk", 1), ("walk", 5), ("walk", 9), ("walk", 13), ("attack", 3),
             ("attack", 5), ("attack", 7), ("crouch", 1), ("crouch_walk", 1), ("crouch_walk", 7), ("crouch_walk", 13),
             ("takedown", 10), ("takedown", 15), ("takedown", 19), ("takedown", 29), ("takedown", 30), ("takedown", 34),
             ("takedown", 35), ("takedown", 38)]
    for variant, shown in VARIANTS.items():
        for name, obj in parts.items():
            obj.hide_render = name not in shown
        suffix = "" if variant == "plain" else f"_{variant}"
        lib.previews(out_preview.replace(".png", f"{suffix}.png"), HEIGHT, head=H)
        lib.pose_sheet(rig, out_preview.replace(".png", f"{suffix}_poses.png"), HEIGHT, poses)
        if variant == "plain":
            lib.head_sheet(out_preview.replace(".png", "_head.png"), H, HEIGHT * 0.65)
    print(f"hero: body {lib.tri_count(body)}, head {sum(lib.tri_count(o) for o in head_parts)}, " + ", ".join(f"{n} {lib.tri_count(o)}" for n, o in parts.items()) + " tris")
