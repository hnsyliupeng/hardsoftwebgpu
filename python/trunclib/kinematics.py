"""
kinematics.py — the arm's kinematic model, ported from the authors' MATLAB.

Faithful port of `reference/matlab/kinematics.m` and `reference/matlab/trunc_model.m`
(TransformativeRoboticsLab/TRUNC):

    segment_transform(theta_1, theta_2, d) = Rz(-theta_2) * Tz(d) * Rx(theta_1) * Rz(theta_2)

is the arm's stage — "spherical joint with prismatic joint" in the authors' words,
i.e. exactly what a chained TRUNC pair gives you: a spherical (bend) DOF plus an
axial slide along the shaft. Three stages of `3L/7 : 2L/7 : 2L/7`, then the tool
offset `d_tool = 83 mm`, and nine cable lengths measured between the corners of
the 65 mm cable triangle on consecutive stage frames.

`fit_stage` inverts that model numerically against a measured pose, which is how
`withdraw_model.py` recovers the arm's 3D configuration from the motion-capture
CSV (the recorded file has end-effector poses and cable lengths, not joint
angles).
"""

import math

from .mathx import (
    deg2rad, eye, mXV, mdot, quat_angle, quat_conj, quat_mul, quat_to_R,
    rad2deg, rot_x, rot_z, trans_z, translation,
)

# --------------------------------------------------------------- constants
# kinematics.m / trunc_model.m

L0 = 710.0                  # neutral arm length (mm)
TOOL_LENGTH = 83.0          # wrist frame → tool tip (mm)
CABLE_RADIUS = 65.0         # cable triangle radius (mm)
SEGMENT_SPLIT = (3 / 7, 2 / 7, 2 / 7)
MAX_COMPRESSION = 70.0      # mm the arm may shorten (kinematics.m sweep bound)
MAX_SHOULDER_DEG = 50.0
MAX_ELBOW_DEG = 50.0
MAX_WRIST_DEG = 40.0
SERVO_MIN, SERVO_MAX = -250, 150

# The paper's cell counts: seven TRUNC cells in the arm, 3 + 2 + 2.
CELLS_PER_SEGMENT = (3, 2, 2)
CELLS_TOTAL = sum(CELLS_PER_SEGMENT)
CELL_PITCH = L0 / CELLS_TOTAL              # 101.43 mm — nominal cell pitch


# ------------------------------------------------------- capture ↔ model frame
# The motion-capture CSVs are written in the *capture* frame, which is the model
# frame with y and z reversed (in the browser app the same relation appears as
# `MATLAB_TO_ROBOT = diag(1, -1, -1)`, used the other way round). Verified by
# fitting recorded poses: 0.03 mm mean residual in this frame against 226 mm in
# the raw one, and 0.0° orientation error.
_Q_FLIP = [0.0, 1.0, 0.0, 0.0]          # 180° about x


def capture_point_to_model(p):
    return [p[0], -p[1], -p[2]]


def capture_quat_to_model(q):
    return quat_mul(quat_mul(_Q_FLIP, q), quat_conj(_Q_FLIP))


def model_point_to_capture(p):
    return [p[0], -p[1], -p[2]]


def segment_transform(t1, t2, d):
    """`Segment_transform(theta_1, theta_2, d)` from kinematics.m."""
    Rz = rot_z(t2)
    Rz_m = rot_z(-t2)
    Rx = rot_x(t1)
    Tz = trans_z(d)
    return mdot(mdot(Rz_m, Tz), mdot(Rx, Rz))


def cable_triangle(r=CABLE_RADIUS):
    """The three cable corners on a stage frame (`tri_origin` in trunc_model.m)."""
    h = math.sin(math.pi / 3)
    c = math.cos(math.pi / 3)
    pts = [[0.0, r, 0.0], [r * h, -r * c, 0.0], [-r * h, -r * c, 0.0]]
    return [translation(p) for p in pts]


def corners_of(T, r=CABLE_RADIUS):
    return [mXV(T, mXV(P, [0, 0, 0])) for P in cable_triangle(r)]


def segment_cables(Ta, Tb, r=CABLE_RADIUS):
    a = corners_of(Ta, r)
    b = corners_of(Tb, r)
    return [math.dist(a[i], b[i]) for i in range(3)]


def winch_cables(cables):
    """
    The nine segment pieces as three continuous tendons.

    A tendon is one winch cable: it leaves the winch, threads the base triad, and
    runs shoulder → elbow → wrist corner of the same index, so its length is the
    sum of that corner's three pieces. This is also why a pure compression of the
    arm by ΔL shortens every winch cable by exactly ΔL (checked: ΔL = −94.3 mm
    gives −94.3 mm on all three), which is the 94.3 mm compression the paper
    reports.
    """
    return [cables[0] + cables[1] + cables[2],
            cables[3] + cables[4] + cables[5],
            cables[6] + cables[7] + cables[8]]


def forward(t1, t2, t3, t4, t5, t6, length, tool=TOOL_LENGTH, r=CABLE_RADIUS):
    """
    Forward kinematics + cable lengths for one configuration.

    Returns dict with the four stage transforms (base, shoulder, elbow, wrist,
    tool), the per-segment cable lengths, the nine cable lengths in the MATLAB's
    own order `[w1, e1, s1, w2, e2, s2, w3, e3, s3]`, the end-effector position
    and orientation, and the stage node positions.
    """
    s0, s1, s2 = SEGMENT_SPLIT
    T_base = eye(4)
    T_shoulder = segment_transform(t1, t2, -s0 * length)
    T_elbow = mdot(T_shoulder, segment_transform(t3, t4, -s1 * length))
    T_wrist = mdot(T_elbow, segment_transform(t5, t6, -s2 * length))
    T_tool = mdot(T_wrist, segment_transform(0, 0, -tool))

    shoulder = segment_cables(T_base, T_shoulder, r)
    elbow = segment_cables(T_shoulder, T_elbow, r)
    wrist = segment_cables(T_elbow, T_wrist, r)
    cables = [wrist[0], elbow[0], shoulder[0],
              wrist[1], elbow[1], shoulder[1],
              wrist[2], elbow[2], shoulder[2]]

    return {
        'stages': [T_base, T_shoulder, T_elbow, T_wrist],
        'tool': T_tool,
        'segments': [shoulder, elbow, wrist],
        'cables': cables,
        'cable_ring': [corners_of(T, r) for T in (T_base, T_shoulder, T_elbow, T_wrist)],
        'position': [T_tool[0][3], T_tool[1][3], T_tool[2][3]],
        'rotation': [row[:3] for row in T_tool[:3]],
        'nodes': [[T[0][3], T[1][3], T[2][3]] for T in (T_base, T_shoulder, T_elbow, T_wrist)],
    }


def stage_frames_from_lengths(length_fractions):
    """Cell-by-cell frames along the arm, for drawing the seven TRUNC cells.

    `length_fractions` is the per-cell fraction of the (possibly compressed)
    arm length; the cell phase is the same spherical interpolation the browser
    app uses: the stage bend is spread evenly over that stage's cells.
    """
    return None  # provided by model3d.build_arm (kept here as a documented seam)


# ------------------------------------------------------------------ solver

def _solve_linear(A, b):
    """Gaussian elimination with partial pivoting (n x n)."""
    n = len(A)
    M = [list(A[i]) + [b[i]] for i in range(n)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-14:
            continue
        M[col], M[piv] = M[piv], M[col]
        pv = M[col][col]
        for j in range(col, n + 1):
            M[col][j] /= pv
        for r in range(n):
            if r == col:
                continue
            f = M[r][col]
            if f:
                for j in range(col, n + 1):
                    M[r][j] -= f * M[col][j]
    return [M[i][n] for i in range(n)]


def _residual(params, target_p, target_q, weight_rot, reg, seed,
              cables=None, home_cables=None, weight_cable=1.0, cable_group=None):
    t1, t2, t3, t4, t5, t6, L = params
    fk = forward(t1, t2, t3, t4, t5, t6, L)
    p = fk['position']
    r = [target_p[i] - p[i] for i in range(3)]
    if target_q is not None:
        R = fk['rotation']
        Rf = [R[0] + [0], R[1] + [0], R[2] + [0], [0, 0, 0, 1]]
        Rq = quat_to_R(target_q)
        # rotation vector of R_pred^T R_target
        E = [[sum(Rf[k][i] * Rq[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        ang = math.acos(max(-1.0, min(1.0, (E[0][0] + E[1][1] + E[2][2] - 1) / 2)))
        if ang > 1e-9:
            axis = [(E[2][1] - E[1][2]) / (2 * math.sin(ang)),
                    (E[0][2] - E[2][0]) / (2 * math.sin(ang)),
                    (E[1][0] - E[0][1]) / (2 * math.sin(ang))]
            r += [weight_rot * ang * a for a in axis]
        else:
            r += [0.0, 0.0, 0.0]
    if cables and home_cables:
        model = list(fk['cables'])
        if cable_group == 'winch':
            model = winch_cables(model)          # home_cables is already grouped
        r += [weight_cable * ((model[i] - home_cables[i]) - cables[i]) for i in range(len(model))]
    r += [reg * (params[i] - seed[i]) for i in range(7)]
    return r


def fit_stage(target_p, target_q=None, seed=None,
              weight_rot=150.0, reg=0.6, iters=40,
              cables=None, home_cables=None, weight_cable=1.0, cable_group=None):
    """
    Least-squares fit of the seven model coordinates (six joint angles + the arm
    length L) to a measured end-effector pose.

    Damped Gauss-Newton with a numerical Jacobian. `weight_rot` converts angular
    error to millimetres of lever arm (150 mm ≈ tool lever) and `reg` keeps the
    solution near the seed, since one pose cannot pin seven coordinates. The
    result is the configuration *implied by the recorded pose*, which is what
    lets the model be withdrawn from the CSV rather than guessed.
    """
    if seed is None:
        seed = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, L0]
    params = list(seed)
    lam = 1e-2
    r = _residual(params, target_p, target_q, weight_rot, reg, seed,
                  cables, home_cables, weight_cable, cable_group)
    cost = sum(v * v for v in r)
    for _ in range(iters):
        J = []
        base = list(r)
        eps = [1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-2]
        for k in range(7):
            step = list(params)
            step[k] += eps[k]
            rk = _residual(step, target_p, target_q, weight_rot, reg, seed,
                           cables, home_cables, weight_cable, cable_group)
            J.append([(rk[i] - base[i]) / eps[k] for i in range(len(base))])
        n = len(base)
        JTJ = [[sum(J[i][k] * J[j][k] for k in range(n)) for j in range(7)] for i in range(7)]
        JTr = [sum(J[i][k] * base[k] for k in range(n)) for i in range(7)]
        for i in range(7):
            JTJ[i][i] *= (1.0 + lam)
        delta = _solve_linear(JTJ, [-v for v in JTr])
        cand = [params[i] + delta[i] for i in range(7)]
        # keep the solution physically sane
        cand[6] = max(L0 - MAX_COMPRESSION, min(L0 + 60.0, cand[6]))
        rc = _residual(cand, target_p, target_q, weight_rot, reg, seed,
                       cables, home_cables, weight_cable, cable_group)
        cc = sum(v * v for v in rc)
        if cc < cost:
            params, r, cost = cand, rc, cc
            lam = max(1e-4, lam * 0.5)
        else:
            lam = min(1e3, lam * 4.0)
        if max(abs(d) for d in delta) < 1e-9:
            break
    fk = forward(*params)
    pos_err = math.dist(target_p, fk['position'])
    cable_err = None
    if cables and home_cables:
        model = list(fk['cables'])
        home = list(home_cables)
        if cable_group == 'winch':
            model = winch_cables(model)          # `home` is already grouped
        cable_err = [((model[i] - home[i]) - cables[i]) for i in range(len(model))]
    ang_err = 0.0
    if target_q is not None:
        R = forward(*params)['rotation']
        from .mathx import R_to_quat
        ang_err = rad2deg(quat_angle(R_to_quat(R), target_q))
    return {
        'params': params,
        't_deg': [rad2deg(t) for t in params[:6]],
        'L': params[6],
        'position_error_mm': pos_err,
        'orientation_error_deg': ang_err,
        'cable_error_mm': cable_err,
        'residual': math.sqrt(cost),
    }


def ik_from_cable_deltas(cable_deltas, seed=None, weight_rot=150.0, reg=0.6):
    """
    Inverse kinematics directly on the nine recorded cable deltas (the `l0…l8`
    columns): fit the seven model coordinates so the model's own cable lengths
    reproduce the recorded deltas. Returns (fit, cable errors in mm).
    """
    def stage_errors(params):
        fk = forward(*params)
        # recorded deltas are relative to the home configuration; compare after
        # removing the mean, which is what the winches hold as pre-tension.
        model = fk['cables']
        m = sum(model) / len(model)
        mm_ = [c - m for c in model]
        d = list(cable_deltas)
        dm = sum(d) / len(d)
        dd = [c - dm for c in d]
        return [mm_[i] - dd[i] for i in range(9)]

    params = list(seed) if seed else [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, L0]
    lam = 1e-2
    r = stage_errors(params)
    cost = sum(v * v for v in r)
    for _ in range(30):
        base = list(r)
        eps = [1e-4] * 6 + [1e-2]
        J = []
        for k in range(7):
            step = list(params)
            step[k] += eps[k]
            rk = stage_errors(step)
            J.append([(rk[i] - base[i]) / eps[k] for i in range(9)])
        JTJ = [[sum(J[i][k] * J[j][k] for k in range(9)) for j in range(7)] for i in range(7)]
        JTr = [sum(J[i][k] * base[k] for k in range(9)) for i in range(7)]
        for i in range(7):
            JTJ[i][i] *= (1.0 + lam)
        delta = _solve_linear(JTJ, [-v for v in JTr])
        cand = [params[i] + delta[i] for i in range(7)]
        cand[6] = max(L0 - MAX_COMPRESSION, min(L0 + 60.0, cand[6]))
        cc = sum(v * v for v in stage_errors(cand))
        if cc < cost:
            params, r, cost = cand, stage_errors(cand), cc
            lam = max(1e-4, lam * 0.5)
        else:
            lam = min(1e3, lam * 4.0)
    return params, stage_errors(params)
