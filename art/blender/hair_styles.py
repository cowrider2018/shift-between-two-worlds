"""
Hair generators for the hero (hero.py, HERO_HAIR). Each one takes the five HAIR locks as trend lines — the same
centrelines build_lock draws — and returns, per lock, its strands: a path of centres and widths from the root out to
the tip. hero.py lofts the strands, then presses and cuts each lock group as before.

Paths are sampled on a uniform grid over their own parameter 0..1 (`_ev`), so a branch is simply a sub-range of its
parent, re-sampled and leaned sideways.

Three weight rules, one per style:
  fork   — area conservation: a lock splits into two children whose cross-sections add up to the parent's,
           w1^2 + w2^2 = w^2 (面積守恆). The trunk stops at the split, so the fork reads as a Y.
  murray — Murray's law: w^3 = w1^3 + w2^3 at every split (分枝律), two levels. Each branch turns by the golden
           angle around its parent, so the splits do not line up in one plane.
  fan    — linear coverage: three flow strands cover one lock's width (the middle one long, the sides shorter and
           lifted over it), so the tips stack in layers instead of one solid end.
"""
import math

from mathutils import Vector

LOCK_RATIO = 2.0  # width : thickness, as in hero.py
GOLDEN = math.radians(137.508)
N = 24            # samples per trunk path
MIN_W = 0.004     # widths never collapse to zero (a zero ring folds the loft)


def _sph(az, el):
    az, el = math.radians(az), math.radians(el)
    return Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def _slerp(a, b, t):
    om = math.acos(max(-1.0, min(1.0, a.dot(b))))
    if om < 1e-6:
        return a.copy()
    return (a * math.sin((1 - t) * om) + b * math.sin(t * om)) / math.sin(om)


def _trunk(H, R, entry):
    """The centreline build_lock draws for a HAIR entry, sampled over u = 0..1. Returns (name, path, cut)."""
    name, exit_dir, end_dir, width, taper, depth, flick, *rest = entry
    curl = rest[0] if rest else 0.0
    cut = rest[1] if len(rest) > 1 else None
    a, b = _sph(*exit_dir), _sph(*end_dir)
    pts, ws = [], []
    for k in range(N):
        u = k / (N - 1)
        n = _slerp(a, b, u).normalized()
        w = width * (1 - u ** taper)
        bend = max(0.0, (u - 0.4) / 0.6) ** 2
        pts.append(H + n * (R + depth * w / LOCK_RATIO + flick * bend) + Vector((0, 0, curl * bend)))
        ws.append(max(w, MIN_W))
    return name, (pts, ws), cut


def _ev(path, u):
    """Point and width at parameter u (0..1) of a path on a uniform grid."""
    pts, ws = path
    x = max(0.0, min(1.0, u)) * (len(pts) - 1)
    i = min(int(x), len(pts) - 2)
    f = x - i
    return pts[i].lerp(pts[i + 1], f), ws[i] + (ws[i + 1] - ws[i]) * f


def _side(H, path, u, roll=0.0):
    """Lateral unit vector at u: tangent x outward normal, optionally rolled about the tangent by `roll`."""
    p0, _ = _ev(path, u - 0.02)
    p1, _ = _ev(path, u + 0.02)
    t = (p1 - p0).normalized()
    nrm = (_ev(path, u)[0] - H).normalized()
    s = t.cross(nrm).normalized()
    return s * math.cos(roll) + nrm * math.sin(roll)


def _slice(path, a, b, n=10):
    """The part of a path between a and b, re-sampled on its own grid."""
    us = [a + (b - a) * j / (n - 1) for j in range(n)]
    samples = [_ev(path, u) for u in us]
    return [p for p, _ in samples], [max(w, MIN_W) for _, w in samples]


def _lean(H, path, a, sgn, lean, scale, roll, n=10):
    """A child that leaves the parent at a and runs on to its tip, leaning sideways by lean (x its width at a) and
    carrying `scale` times the parent's width."""
    _, w0 = _ev(path, a)
    pts, ws = [], []
    for j in range(n):
        u = a + (1 - a) * j / (n - 1)
        p, w = _ev(path, u)
        pts.append(p + _side(H, path, u, roll) * sgn * lean * w0 * (j / (n - 1)))
        ws.append(max(w * scale, MIN_W))
    return pts, ws


def _groups(H, R, locks, grow):
    out = []
    for entry in locks:
        name, path, cut = _trunk(H, R, entry)
        out.append((name, grow(H, path), cut))
    return out


# ---------------------------------------------------------------------------
# fork — area conservation at a single split
FORK_AT = 0.5    # where the lock forks, along its length
FORK_LEAN = 0.5  # how far each child leans out, in parent widths at the split
FORK_SCALE = 2 ** -0.5  # each child's width: two of them fill the parent's cross-section


def _grow_fork(H, path):
    strands = [_slice(path, 0.0, FORK_AT)]
    for sgn in (1, -1):
        strands.append(_lean(H, path, FORK_AT, sgn, FORK_LEAN, FORK_SCALE, roll=0.0))
    return strands


def fork(H, R, locks):
    return _groups(H, R, locks, _grow_fork)


# ---------------------------------------------------------------------------
# murray — Murray's law, two levels of splits
MURRAY_AT = 0.5                            # each branch splits halfway along its own length
MURRAY_SMALL = 0.7                         # the smaller daughter's width, in the parent's width
MURRAY_LARGE = (1 - MURRAY_SMALL ** 3) ** (1 / 3)  # so that small^3 + large^3 = 1 (Murray's law)
MURRAY_LEAN = 0.6
MURRAY_LEVELS = 2


def _grow_murray(H, path, level=MURRAY_LEVELS, roll=0.0):
    if level == 0:
        return [_slice(path, 0.0, 1.0)]
    strands = [_slice(path, 0.0, MURRAY_AT)]
    for sgn, scale in ((1, MURRAY_SMALL), (-1, MURRAY_LARGE)):
        child = _lean(H, path, MURRAY_AT, sgn, MURRAY_LEAN, scale, roll=roll + sgn * GOLDEN * 0.5)
        strands += _grow_murray(H, child, level - 1, roll)
    return strands


def murray(H, R, locks):
    return _groups(H, R, locks, _grow_murray)


# ---------------------------------------------------------------------------
# fan — three flow strands covering the lock, the outer two shorter and lifted over the middle one
FAN = [  # (offset across the width, end along the lock, lift over the scalp in widths)
    (-0.3, 0.86, 0.5),
    (0.0, 1.0, 0.0),
    (0.3, 0.92, 0.5),
]
FAN_COVER = 0.5  # each strand's width in the lock's width (three of them overlap for cover)
FAN_STEPS = 12


def _grow_fan(H, path):
    strands = []
    for offset, end, lift in FAN:
        pts, ws = [], []
        for j in range(FAN_STEPS):
            u = end * j / (FAN_STEPS - 1)
            p, w = _ev(path, u)
            side = _side(H, path, u)
            nrm = (p - H).normalized()
            pts.append(p + side * offset * w + nrm * lift * w / LOCK_RATIO)
            ws.append(max(w * FAN_COVER * (1 - (u / end) ** 3), MIN_W))
        strands.append((pts, ws))
    return strands


def fan(H, R, locks):
    return _groups(H, R, locks, _grow_fan)


STYLES = {"fork": fork, "murray": murray, "fan": fan}
