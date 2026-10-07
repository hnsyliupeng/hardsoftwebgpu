"""
trajectory.py — port of `reference/matlab/trajectory_analysis.m` (Fig. S9).

The authors record each test trajectory twice: the commanded waypoints
(`*_trajectory.mat`, matrix `wp` = [x y z qx qy qz qw]) and the measured
end-effector pose (`positions.csv`). The script compares them:

    position error    = || wp(:,1:3) - 1000 * [x y z] ||      (mm, per waypoint)
    orientation error = rad2deg(dist(q_ref, q_measured))       (deg, per waypoint)

after `remove_twist` on the measured quaternion, which takes out the rotation
about the tool axis (the tool spins during the demonstrations, the reference
waypoint quaternions do not track that spin).
"""

import math
import os

from .csvio import Table, read_mat
from .mathx import (
    quat_angle, quat_mul, quat_norm, quat_to_R, R_to_quat, rad2deg, mean, std,
)
from .plot import Axes, Canvas, SET1, NAVY

CASES = [
    ('circle', 'TRAJ-CIRCLE', 'CIRCLE (CUBIC INTERPOLATION)', 5.0),
    ('triangle', 'TRAJ-TRIANGLE', 'TRIANGLE (LINEAR)', 7.3),
    ('line', 'TRAJ-LINE', 'STAIRCASE (X-Z PLANE)', 5.7),
]


def seconds_from_stamps(stamps):
    """`find_seconds` in the MATLAB: hours*3600 + minutes*60 + seconds, t0 = 0."""
    out = []
    for s in stamps:
        try:
            date, time = s.split(' ')
            hh, mm, ss = time.split(':')
            out.append(int(hh) * 3600 + int(mm) * 60 + float(ss))
        except ValueError:
            out.append(float('nan'))
    base = next((v for v in out if v == v), 0.0)
    return [v - base for v in out]


def remove_twist(quats):
    """
    Remove the spin about the tool axis, as `remove_twist` does: take the yaw of
    the first sample, then post-multiply every sample by that rotation's inverse.
    """
    if not quats:
        return []
    R1 = quat_to_R(quats[0])
    theta = -math.atan2(R1[1][0], R1[0][0])
    c, s = math.cos(theta), math.sin(theta)
    Rz = [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]]
    out = []
    for q in quats:
        R = quat_to_R(q)
        Rn = [[sum(R[i][k] * Rz[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        out.append(R_to_quat(Rn))
    return out


def analyse(name, mat_path, csv_path):
    wp = read_mat(mat_path)['wp']
    if wp and not isinstance(wp[0], list):
        wp = [wp]
    ref_pos = [[r[0], r[1], r[2]] for r in wp]
    ref_quat = [[r[6], r[3], r[4], r[5]] for r in wp]     # qw, qx, qy, qz

    t = Table(csv_path)
    px = [v * 1000.0 for v in t.col('x_end_avg')]
    py = [v * 1000.0 for v in t.col('y_end_avg')]
    pz = [v * 1000.0 for v in t.col('z_end_avg')]
    meas = list(zip(px, py, pz))
    meas_q = [quat_norm([t.col('qw_end_avg')[i], t.col('qx_end_avg')[i],
                         t.col('qy_end_avg')[i], t.col('qz_end_avg')[i]])
              for i in range(len(t))]
    meas_q = remove_twist(meas_q)
    stamps = t.text('date and time') if t.has('date and time') else []
    secs = seconds_from_stamps(stamps)

    n = min(len(ref_pos), len(meas))
    pos_err, ang_err = [], []
    for i in range(n):
        pos_err.append(math.dist(ref_pos[i], meas[i]))
        ang_err.append(rad2deg(quat_angle(ref_quat[i], meas_q[i])))

    return {
        'name': name,
        'waypoints': n,
        'reference_mm': ref_pos[:n],
        'measured_mm': meas[:n],
        'seconds': secs[:n],
        'position_error_mm': pos_err,
        'orientation_error_deg': ang_err,
        'mean_position_error_mm': mean(pos_err),
        'std_position_error_mm': std(pos_err),
        'max_position_error_mm': max(pos_err),
        'mean_orientation_error_deg': mean(ang_err),
        'max_orientation_error_deg': max(ang_err),
        'seconds_total': secs[n - 1] if secs else 0.0,
    }


def figure(results, path, paper=(5.0, 7.3, 5.7)):
    """Fig. S9: the three trajectories, side by side, with their error traces."""
    c = Canvas(1000, 720, bg=(255, 255, 255), supersample=2)
    for k, res in enumerate(results):
        col = SET1[k]
        ox = 60 + k * 315
        ax = Axes(c, (ox, 45, 260, 260), [-110, 110], [-110, 110], 'X (MM)', 'Y (MM)',
                  res['name'].upper(), equal=True)
        rx = [p[0] for p in res['reference_mm']]
        ry = [p[1] for p in res['reference_mm']]
        mx = [p[0] for p in res['measured_mm']]
        my = [p[1] for p in res['measured_mm']]
        ax.plot(rx, ry, (120, 120, 128), 2)
        ax.scatter(rx, ry, (150, 150, 160), 3)
        ax.plot(mx, my, col, 2)
        ax.finish(4, 4)

        ax2 = Axes(c, (ox, 360, 260, 120), [0, max(1, res['waypoints'])], [0, 20],
                   'WAYPOINT', 'ERR (MM)', 'POSITION ERROR')
        ax2.plot(range(res['waypoints']), res['position_error_mm'], col, 1)
        ax2.finish(4, 4)

        ax3 = Axes(c, (ox, 530, 260, 120), [0, max(1, res['waypoints'])], [0, 6],
                   'WAYPOINT', 'ERR (DEG)', 'ORIENTATION ERROR')
        ax3.plot(range(res['waypoints']), res['orientation_error_deg'], col, 1)
        ax3.finish(4, 4)

        c.text(ox, 680, 'MEAN %.1f MM / %.1f DEG   (PAPER %.1f / %.1f)'
               % (res['mean_position_error_mm'], res['mean_orientation_error_deg'],
                  paper[k], (2.1, 1.9, 2.5)[k]), NAVY, 1)
    c.save_png(path)
    return path
