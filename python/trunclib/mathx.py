"""
mathx.py — small vector / matrix / quaternion helpers.

Pure Python, no dependencies. Matrices are row-major nested lists of 4x4 for
transforms (the MATLAB code's convention: `T * x` with column vectors) and the
rotation part is used for the FK.
"""

import math

# ------------------------------------------------------------------ vectors

def vadd(a, b):
    return [a[i] + b[i] for i in range(3)]


def vsub(a, b):
    return [a[i] - b[i] for i in range(3)]


def vscale(a, s):
    return [a[i] * s for i in range(3)]


def vdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vcross(a, b):
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def vnorm(a):
    n = math.sqrt(vdot(a, a))
    return [a[0] / n, a[1] / n, a[2] / n] if n > 1e-15 else [0.0, 0.0, 0.0]


def vlen(a):
    return math.sqrt(vdot(a, a))


# ----------------------------------------------------------------- matrices

def eye(n=4):
    return [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]


def mdot(A, B):
    n, k, m = len(A), len(B), len(B[0])
    return [[sum(A[i][t] * B[t][j] for t in range(k)) for j in range(m)] for i in range(n)]


def mXV(A, v):
    """4x4 transform applied to a 3-vector, or 3x3 applied to a 3-vector."""
    if len(A) == 4:
        return [sum(A[i][j] * v[j] for j in range(3)) + A[i][3] for i in range(3)]
    return [sum(A[i][j] * v[j] for j in range(3)) for i in range(3)]


def rot_x(t):
    c, s = math.cos(t), math.sin(t)
    return [[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]]


def rot_y(t):
    c, s = math.cos(t), math.sin(t)
    return [[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]


def rot_z(t):
    c, s = math.cos(t), math.sin(t)
    return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def trans_z(d):
    T = eye(4)
    T[2][3] = d
    return T


def translation(p):
    T = eye(4)
    T[0][3], T[1][3], T[2][3] = p
    return T


def pose_of(T):
    """(position, 3x3 rotation) of a 4x4 transform."""
    R = [row[:3] for row in T[:3]]
    p = [T[0][3], T[1][3], T[2][3]]
    return p, R


# -------------------------------------------------------------- quaternions
# Stored as (w, x, y, z), matching MATLAB's quaternion ordering conventions
# used by the project's CSVs ([qw, qx, qy, qz]).

def quat_norm(q):
    n = math.sqrt(sum(c * c for c in q))
    return [c / n for c in q] if n > 1e-15 else [1.0, 0.0, 0.0, 0.0]


def quat_mul(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return [
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    ]


def quat_conj(q):
    return [q[0], -q[1], -q[2], -q[3]]


def quat_to_R(q):
    w, x, y, z = quat_norm(q)
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ]


def R_to_quat(R):
    """Rotation matrix → (w, x, y, z), the same branch MATLAB's rotm2quat takes."""
    m = R
    tr = m[0][0] + m[1][1] + m[2][2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2.0
        w = 0.25 * s
        x = (m[2][1] - m[1][2]) / s
        y = (m[0][2] - m[2][0]) / s
        z = (m[1][0] - m[0][1]) / s
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0
        w = (m[2][1] - m[1][2]) / s
        x = 0.25 * s
        y = (m[0][1] + m[1][0]) / s
        z = (m[0][2] + m[2][0]) / s
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0
        w = (m[0][2] - m[2][0]) / s
        x = (m[0][1] + m[1][0]) / s
        y = 0.25 * s
        z = (m[1][2] + m[2][1]) / s
    else:
        s = math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0
        w = (m[1][0] - m[0][1]) / s
        x = (m[0][2] + m[2][0]) / s
        y = (m[1][2] + m[2][1]) / s
        z = 0.25 * s
    q = quat_norm([w, x, y, z])
    return [-c for c in q] if q[0] < 0 else q


def quat_angle(a, b):
    """Rotation angle (radians) between two orientations, MATLAB `dist`."""
    d = abs(sum(a[i] * b[i] for i in range(4)))
    d = min(1.0, max(-1.0, d))
    return 2.0 * math.acos(d)


def quat_rotate(q, v):
    R = quat_to_R(q)
    return mXV(R, v)


def quat_average(quats):
    """Markley's quaternion average (normalised eigenvector of the outer-product
    sum) — the `meanrot` the workspace script uses."""
    M = [[0.0] * 4 for _ in range(4)]
    for q in quats:
        qn = quat_norm(q)
        for i in range(4):
            for j in range(4):
                M[i][j] += qn[i] * qn[j]
    # power iteration: the dominant eigenvector of the 4x4 scatter matrix
    v = [1.0, 0.0, 0.0, 0.0]
    for _ in range(64):
        v = [sum(M[i][j] * v[j] for j in range(4)) for i in range(4)]
        n = math.sqrt(sum(c * c for c in v)) or 1.0
        v = [c / n for c in v]
    return v if v[0] >= 0 else [-c for c in v]


def wrap_to_180(deg):
    """MATLAB `wrapTo180`."""
    return (deg + 180.0) % 360.0 - 180.0


def deg2rad(d):
    return d * math.pi / 180.0


def rad2deg(r):
    return r * 180.0 / math.pi


# ------------------------------------------------------------------ statistics

def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else 0.0


def std(xs):
    xs = list(xs)
    if len(xs) < 2:
        return 0.0
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return 0.0
    return xs[n // 2] if n % 2 else 0.5 * (xs[n // 2 - 1] + xs[n // 2])


def percentile(xs, p):
    xs = sorted(xs)
    if not xs:
        return 0.0
    k = max(0, min(len(xs) - 1, int(round((p / 100.0) * (len(xs) - 1)))))
    return xs[k]


def linfit(xs, ys):
    """Least-squares slope/intercept + r²."""
    n = len(xs)
    sx = sum(xs)
    sy = sum(ys)
    sxy = sum(x * y for x, y in zip(xs, ys))
    sxx = sum(x * x for x in xs)
    den = n * sxx - sx * sx
    k = (n * sxy - sx * sy) / den if den else 0.0
    b = (sy - k * sx) / n if n else 0.0
    ybar = sy / n if n else 0.0
    sst = sum((y - ybar) ** 2 for y in ys)
    sse = sum((y - (k * x + b)) ** 2 for x, y in zip(xs, ys))
    return k, b, (1 - sse / sst if sst else 1.0)
