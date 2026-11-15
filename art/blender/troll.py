"""
Troll (DESIGN §4.2): dark violet-grey, stout and hunched, pot belly, huge drooping nose,
wide wing-like ears that flare sideways and sag, heavy brow, long arms, short thick legs.
Faces +X, feet on z = 0, ~1.4 tiles tall.
"""
import math

import bpy
from mathutils.bvhtree import BVHTree

from mathutils import Matrix, Quaternion, Vector

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
    """Eyes, fangs, loincloth, rope belt, lantern (low-poly pieces, rigid on one bone; the loincloth hangs from its own
    bone chains instead, see skin_loincloth)."""
    out = {}
    for s, side in ((1, "L"), (-1, "R")):
        k = HEAD_SCALE
        out[f"eye.{side}"] = (lib.ico(f"eye.{side}", hp((0.287, 0.055 * s, 1.133)), 0.022 * k, "troll_eye", 1), "head")
        out[f"fang.{side}"] = (lib.cone(f"fang.{side}", hp((0.33, 0.042 * s, 1.022)), hp((0.338, 0.046 * s, 1.07)), 0.011 * k, "troll_tooth", 4), "head")

    # loincloth: a ragged skirt hanging from the belt, longer at the front, one column per skirt bone chain
    rings = skirt_rings()
    verts = [p for ring in rings for p in ring]
    faces = [(k * SKIRT_N + i, k * SKIRT_N + (i + 1) % SKIRT_N, (k + 1) * SKIRT_N + (i + 1) % SKIRT_N, (k + 1) * SKIRT_N + i)
             for k in range(SKIRT_K) for i in range(SKIRT_N)]
    out["loincloth"] = (lib.mesh_from("loincloth", verts, faces, "cloth"), None)

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


# The loincloth is cut into SKIRT_N columns round the belt, each a chain of SKIRT_K bones from the belt to the hem
# (the usual game-cloth rig). The chains are not animated by hand: drape_skirt() hangs them on every key of every clip,
# so the cloth always lies on the posed body under its own weight.
SKIRT_N, SKIRT_K = 16, 3
BELT_Z = 0.57


def skirt_rings():
    """The loincloth's vertex rings at rest, belt first: SKIRT_K + 1 rings of SKIRT_N points."""
    rings = []
    for k in range(SKIRT_K + 1):
        f = k / SKIRT_K
        ring = []
        for i in range(SKIRT_N):
            t = i / SKIRT_N * 2 * math.pi
            x, y = math.cos(t) * 0.205 + 0.03, math.sin(t) * 0.215
            drop = 0.13 + 0.07 * max(0.0, math.cos(t)) + (0.025 if i % 2 else 0.0)  # longer at the front, ragged
            flare = 1 + 0.08 * f
            ring.append((x * flare + 0.01 * f, y * flare, BELT_Z - drop * f))
        rings.append(ring)
    return rings


def skirt_bone(i, k):
    return f"skirt{i:02d}_{k}"


SKIRT_BONES = tuple(skirt_bone(i, k) for i in range(SKIRT_N) for k in range(1, SKIRT_K + 1))


def skin_loincloth(obj, rig):
    """The belt ring rides the hips; every lower vertex sits at the tail of its column's bone for that ring."""
    groups = {}
    for v in obj.data.vertices:
        k, i = divmod(v.index, SKIRT_N)
        name = "hips" if k == 0 else skirt_bone(i, k)
        if name not in groups:
            groups[name] = obj.vertex_groups.new(name=name)
        groups[name].add([v.index], 1.0, "REPLACE")
    obj.parent = rig
    obj.modifiers.new("armature", "ARMATURE").object = rig


# drape: how far the cloth keeps off the skin and the floor, and how much each column is drawn in toward the hips as it
# falls (the belt's pull, which keeps it hanging on the body rather than standing off it)
SKIN_GAP, FLOOR_Z, CLING = 0.012, 0.01, 0.3


def drape_skirt(rig, body):
    """Hang each column of the loincloth from the belt of the posed body: every link falls straight down under its
    own weight, is pushed back out where it would sink into the body or the floor, and keeps its length. The cloth
    therefore lies over the belly, thighs and lap whatever the pose, and never stretches or shrinks."""
    vl = bpy.context.view_layer
    vl.update()
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(body.evaluated_get(dg), dg)
    to_body = body.matrix_world.inverted()
    from_body = body.matrix_world
    centre = rig.pose.bones["hips"].head.copy()
    down = Vector((0, 0, -1))
    for i in range(SKIRT_N):
        prev = rig.pose.bones[skirt_bone(i, 1)].head.copy()
        out = Vector((prev.x - centre.x, prev.y - centre.y, 0))
        out = out.normalized() if out.length > 1e-6 else Vector((1, 0, 0))
        for k in range(1, SKIRT_K + 1):
            pb = rig.pose.bones[skirt_bone(i, k)]
            length = pb.bone.length
            p = prev + (down - out * CLING).normalized() * length
            for _ in range(6):
                q = to_body @ p
                loc, nrm, _, _ = bvh.find_nearest(q)
                if loc is not None and (q - loc).dot(nrm) < SKIN_GAP:
                    p = from_body @ (loc + nrm * SKIN_GAP)
                p.z = max(p.z, FLOOR_Z)
                p = prev + (p - prev).normalized() * length
            head = pb.head.copy()
            turn = (pb.tail - head).rotation_difference(p - head).to_matrix().to_4x4()
            pb.matrix = Matrix.Translation(head) @ turn @ Matrix.Translation(-head) @ pb.matrix
            vl.update()
            prev = p


def build_rig():
    b = [
        ("root", (0, 0, 0), (0, 0, 0.2), None),
        ("hips", J["pelvis"], J["spine"], "root"),
        ("spine", J["spine"], J["chest"], "hips"),
        ("chest", J["chest"], J["neck"], "spine"),
        ("neck", J["neck"], tuple(hp((0.15, 0, 1.08))), "chest"),
        ("head", tuple(hp((0.15, 0, 1.08))), tuple(hp((0.30, 0, 1.24))), "neck"),
    ]
    rings = skirt_rings()
    for i in range(SKIRT_N):
        for k in range(1, SKIRT_K + 1):
            b.append((skirt_bone(i, k), rings[k - 1][i], rings[k][i], "hips" if k == 1 else skirt_bone(i, k - 1)))
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


def build_actions(rig, settle=None):
    """idle (2 s), sit (3 s, slumped on the floor), walk (1 s heavy stomping waddle), alert (head up, ears perk),
    attack (overhead lantern bonk), death."""
    tau = 2 * math.pi

    def leg(side, p):
        """One leg at gait phase p: [0, .5) stance (planted, sweeps back), [.5, 1) swing (knee lifts, reaches)."""
        c, sn = math.cos(p * tau), math.sin(p * tau)
        swing = max(0.0, -sn)
        return {
            f"thigh.{side}": [(Y, -30 * c - 14 * swing)],              # forward = negative; lift the knee in swing
            f"shin.{side}": [(Y, 48 * swing + 8 * max(0.0, sn) ** 4)],  # big knee bend in swing, small give at contact
            f"foot.{side}": [(Y, 14 * c - 10 * swing)],                 # heel strike, toe-off
        }

    def walk_pose(ph):
        c, sn = math.cos(ph * tau), math.sin(ph * tau)
        bounce = math.sin(2 * ph * tau - 1.0)                           # twice per cycle, lagging the steps
        pose = {**leg("L", ph), **leg("R", (ph + 0.5) % 1)}
        upper_r = -14 * c
        fore_r = -20 + 6 * c
        pose.update({
            "hips": [(X, 7 * c), (Z, -10 * c)],                         # weight onto the stance leg, hip leads the leg
            "spine": [(Y, 6), (Z, 4 * c)],
            "chest": [(Y, 8 + 3 * abs(sn)), (Z, 9 * c), (X, -5 * c)],   # hunched lean, counter-twist against the hips
            "neck": [(Y, -4)],
            "head": [(Y, -8 + 5 * bounce), (X, 4 * c), (Z, -5 * c)],    # nod on each stomp, keeps looking ahead
            # free left arm: long knuckle-dragger swing, elbow bends when it comes forward, hand trails
            "upper_arm.L": [(Y, 32 * c), (X, 8 + 4 * abs(sn))],
            "forearm.L": [(Y, -14 - 22 * max(0.0, -c))],
            "hand.L": [(Y, -12 * sn)],
            # lantern arm: shorter swing; the wrist counters it so the lantern stays roughly hanging
            "upper_arm.R": [(Y, upper_r), (X, -10)],
            "forearm.R": [(Y, fore_r)],
            "hand.R": [(Y, -(upper_r + fore_r) + 10 * sn)],
            "ear.L": [(X, 12 * bounce)], "ear.R": [(X, -12 * bounce)],  # floppy ears flap after each stomp
            "_lift": 0.04 * abs(sn) ** 1.5,
        })
        return pose

    lib.action(rig, "walk", {f: walk_pose((f - 1) / 24) for f in range(1, 26, 2)}, settle=settle)

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

    lib.action(rig, "idle", {f: idle_pose((f - 1) / 48) for f in range(1, 50, 6)}, settle=settle)

    # sit (3 s loop): a monster that never walks slumps on the floor, leaning back. The lantern-side knee is drawn up
    # with the forearm draped over it, the lantern dangling past the knee; the other leg lies splayed with its hand
    # resting on that knee. Slow breathing, a lazy head loll, the lantern swaying a little.
    # HIP: how far the pelvis rolls back to give the legs room on the floor (only partly: more lifts the belly with it;
    # the thighs bend the rest); the spine bends forward over the legs to a LEAN past upright
    HIP, LEAN, LIFT = 30, 4, -0.375

    def sit_pose(phase):
        b = math.sin(phase * tau)
        sway = math.sin(phase * tau + 0.8)
        return {
            "hips": [(Y, -HIP)],
            "spine": [(Y, 0.45 * (HIP + LEAN) + 1.5 * b)],
            "chest": [(Y, 0.55 * (HIP + LEAN) + 2 * b)],
            "neck": [(Y, -14)],
            "head": [(Y, -16 - 2 * b), (X, 6), (Z, 12 + 3 * sway)],
            # lantern side: knee up, foot flat in front
            "thigh.R": [(Y, HIP - 148)],
            "shin.R": [(Y, 100)],
            "foot.R": [(Y, 40)],
            # free side: knee lower, falling outwards
            "thigh.L": [(Y, HIP - 118), (Z, 20)],
            "shin.L": [(Y, 60)],
            "foot.L": [(Y, 30), (X, 25)],
            # forearm over the knee, the hand drooping so the lantern hangs past it
            "upper_arm.R": [(X, 18), (Y, -58 - LEAN - 1.5 * b)],
            "forearm.R": [(Y, -42)],
            "hand.R": [(Y, 75 + 6 * sway)],
            # free hand resting on its knee
            "upper_arm.L": [(X, -14), (Y, -54 - LEAN - 1.5 * b)],
            "forearm.L": [(Y, -34)],
            "hand.L": [(Y, 40)],
            "ear.L": [(X, 8 + 3 * b)], "ear.R": [(X, -8 - 3 * b)],
            "_lift": LIFT - 0.004 * b,
        }

    lib.action(rig, "sit", {f: sit_pose((f - 1) / 72) for f in range(1, 74, 8)}, settle=settle)

    alert = {
        "chest": [(Y, -6)], "neck": [(Y, -8)], "head": [(Y, -10)],
        "ear.L": [(X, -14)], "ear.R": [(X, 14)],
        "upper_arm.L": [(X, -12)], "upper_arm.R": [(X, 12)],
        "forearm.L": [(Y, -25)], "forearm.R": [(Y, -25)],
        "thigh.L": [(Y, -6)], "thigh.R": [(Y, -6)], "shin.L": [(Y, 10)], "shin.R": [(Y, 10)],
    }
    lib.action(rig, "alert", {1: alert, 13: alert}, settle=settle)

    # attack: raise the lantern overhead with the elbow cocked behind the head, then slam it down in front
    # (impact on frame 10, 0.375 s in), let the torso follow through and settle. The free arm braces.
    def legs(lead, back):
        return {"thigh.L": [(Y, -lead)], "shin.L": [(Y, lead * 0.8)], "foot.L": [(Y, lead * 0.2)],
                "thigh.R": [(Y, back)], "shin.R": [(Y, back * 0.5)], "foot.R": [(Y, -back * 0.3)]}

    rest = idle_pose(0)
    wind = {**legs(10, 6),
            "hips": [(Z, 8)], "spine": [(Y, -6), (Z, 6)], "chest": [(Y, -12), (Z, 10)],
            "neck": [(Y, -6)], "head": [(Y, -12)],
            "upper_arm.R": [(Y, -165), (X, -12)], "forearm.R": [(Y, -60)], "hand.R": [(Y, -20)],
            "upper_arm.L": [(Y, -30), (X, 14)], "forearm.L": [(Y, -30)],
            "ear.L": [(X, -12)], "ear.R": [(X, 12)], "_lift": 0.02}
    strike = {**legs(30, 14),
              "hips": [(Z, -8), (Y, 6)], "spine": [(Y, 12), (Z, -6)], "chest": [(Y, 22), (Z, -10)],
              "neck": [(Y, 4)], "head": [(Y, 8)],
              "upper_arm.R": [(Y, -65), (X, 4)], "forearm.R": [(Y, -10)], "hand.R": [(Y, -30)],
              "upper_arm.L": [(Y, 25), (X, 20)], "forearm.L": [(Y, -20)],
              "ear.L": [(X, 16)], "ear.R": [(X, -16)], "_lift": -0.04}
    follow = {**legs(30, 14),
              "hips": [(Z, -10), (Y, 8)], "spine": [(Y, 14), (Z, -8)], "chest": [(Y, 26), (Z, -12)],
              "neck": [(Y, 6)], "head": [(Y, 4)],
              "upper_arm.R": [(Y, -40), (X, 6)], "forearm.R": [(Y, -6)], "hand.R": [(Y, -10)],
              "upper_arm.L": [(Y, 28), (X, 22)], "forearm.L": [(Y, -22)],
              "ear.L": [(X, 8)], "ear.R": [(X, -8)], "_lift": -0.045}
    lib.action(rig, "attack", {1: rest, 7: wind, 10: strike, 13: follow, 22: rest}, settle=settle)

    # death (2.04 s, starts with the hero's takedown): the hero lands on its head (frame 9) with a blade at its throat;
    # the troll ducks and clamps both hands over its throat, thrashing left and right to shake the hero off (the
    # standoff, 0.4-1.2 s). The cut lands (frame 30): the head jerks up, the arms fling open and it lunges forward
    # onto its face and settles.
    def clutch(roll, knee=0.0, lean=0.0, twist=0.0, bow=0.0):
        """Both hands clamped on the throat, the body rolled `roll` degrees towards its left (+) / right (-),
        the head ducked forward by `bow` degrees."""
        return {
            # feet planted, pelvis still: the waist twists and the upper body thrashes
            "spine": [(X, roll * 0.5), (Y, 6 + lean * 0.5), (Z, twist * 0.6)],
            "chest": [(X, roll * 0.7), (Y, 4 + lean), (Z, twist)],
            "neck": [(Y, 10 + bow * 0.5)], "head": [(Y, 18 + bow), (X, -roll * 0.5)],
            "upper_arm.L": [(Y, -40), (X, -20)], "forearm.L": [(Y, -100), (Z, -35)], "hand.L": [(Z, -40)],
            "upper_arm.R": [(Y, -40), (X, 20)], "forearm.R": [(Y, -100), (Z, 35)], "hand.R": [(Z, 40)],
            "thigh.L": [(Y, -knee)], "thigh.R": [(Y, -knee)],
            "shin.L": [(Y, knee * 1.6)], "shin.R": [(Y, knee * 1.6)], "foot.L": [(Y, -knee * 0.6)], "foot.R": [(Y, -knee * 0.6)],
            "ear.L": [(X, -10 - roll * 0.8)], "ear.R": [(X, 10 - roll * 0.8)],
            "_lift": -0.0035 * knee,
        }

    grabbed = {**rest, "chest": [(Y, -8)], "neck": [(Y, -18)], "head": [(Y, -22)],
               "upper_arm.L": [(Y, -25), (X, 16)], "upper_arm.R": [(Y, -25), (X, -16)],
               "forearm.L": [(Y, -30)], "forearm.R": [(Y, -30)],
               "thigh.L": [(Y, -8)], "thigh.R": [(Y, -8)], "shin.L": [(Y, 14)], "shin.R": [(Y, 14)],
               "ear.L": [(X, -16)], "ear.R": [(X, 16)], "_lift": -0.03}
    def topple(pitch, lift, knee, reach, spread, hunch):
        """Falling forward with the arms flung open: `reach` swings them up towards overhead (ahead once the body
        is down), `spread` opens them sideways; `hunch` is how curled the back still is."""
        p = clutch(0, knee, 0)
        p.update({
            "root": [(Y, pitch)], "hips": [], "spine": [(Y, hunch * 0.5)], "chest": [(Y, hunch)],
            "neck": [(Y, -6)], "head": [(Y, -14)],
            # open sideways first, then swing up: the arms stay on their own side however far overhead they go
            "upper_arm.L": [(X, spread), (Y, -reach)], "forearm.L": [(Y, -10)], "hand.L": [(Y, -10)],
            "upper_arm.R": [(X, -spread), (Y, -reach)], "forearm.R": [(Y, -10)], "hand.R": [(Y, -10)],
            "ear.L": [(X, 20)], "ear.R": [(X, -20)],
            "_lift": lift,
        })
        return p

    lib.action(rig, "death", {
        1: rest, 9: grabbed, 12: clutch(0, 8, 6, 0, -28),
        15: clutch(18, 6, 4, 25, -24), 19: clutch(-20, 8, 6, -28, -22), 23: clutch(16, 6, 2, 22, -28),
        27: clutch(-14, 8, 6, -20, -24), 29: clutch(-4, 8, 4, -5, -28),
        31: clutch(0, 4, -10, 0, -30),
        33: topple(0, -0.04, 10, 40, 85, -5), 36: topple(20, -0.08, 20, 80, 75, 15), 39: topple(55, -0.06, 10, 130, 65, 8),
        42: topple(84, 0.0, 0, 160, 60, 0), 45: topple(76, 0.04, 0, 155, 60, 0), 50: topple(82, 0.01, 0, 160, 60, 0),
    }, settle=settle)


def build(out_glb, out_preview):
    lib.reset()
    body = build_body()
    props = build_props()
    rig = build_rig()
    # the skirt chains move the loincloth only: keep them out of the body's automatic weights
    for b in SKIRT_BONES:
        rig.data.bones[b].use_deform = False
    lib.skin(body, rig)
    for b in SKIRT_BONES:
        rig.data.bones[b].use_deform = True
    for obj, bone in props.values():
        if bone:
            lib.attach(obj, rig, bone)
    skin_loincloth(props["loincloth"][0], rig)
    build_actions(rig, settle=lambda r: drape_skirt(r, body))
    objs = [rig, body] + [o for o, _ in props.values()]
    lib.export_glb(out_glb, objs)
    lib.previews(out_preview, HEIGHT, head=hp((0.22, 0, 1.12)))
    lib.pose_sheet(rig, out_preview.replace(".png", "_poses.png"), HEIGHT,
                   [("idle", 1), ("sit", 1), ("alert", 1)] + [("walk", f) for f in range(1, 24, 3)]
                   + [("attack", f) for f in (7, 10, 13)]
                   + [("death", f) for f in (9, 12, 15, 19, 29, 31, 33, 36, 39, 42)], cols=5)
    print(f"troll: {lib.tri_count(body)} body tris, {sum(lib.tri_count(o) for o, _ in props.values())} prop tris")
