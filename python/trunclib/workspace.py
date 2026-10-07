"""
workspace.py — port of `reference/matlab/workspace_analysis.m` + `workspace_plot.m`.

Reads the authors' 18,300-pose motion-capture set
(`data/trunc/mocap/workspace-poses.csv`, the file the MATLAB script loads as
`positions_norm_full.csv`) and reconstructs Fig. 4D: the reachable workspace of
the arm, its bounding circle in the x–y plane as a fraction of the 710 mm neutral
arm length, the compression along z, and the end-effector tilt distribution.

The MATLAB used an alpha shape (α = 34.4 mm) for the concave hull volume. There
is no CGAL here, so this port estimates the same volume with an occupancy grid
and the same α: a voxel counts as inside when its centre is within α of any
sampled pose. That is the α-shape's own definition, sampled on a grid.
"""

import math

from .csvio import Table
from .mathx import mean, percentile, quat_rotate
from .plot import Axes, Canvas, SET1, NAVY, GREY, legend

ALPHA_MM = 34.4          # the paper's alpha shape radius
VOXEL_MM = 10.0


def load_poses(path):
    t = Table(path)
    data = {
        'x': t.col('x_end_avg'),
        'y': t.col('y_end_avg'),
        'z': t.col('z_end_avg'),
        'qw': t.col('qw_end_avg'),
        'qx': t.col('qx_end_avg'),
        'qy': t.col('qy_end_avg'),
        'qz': t.col('qz_end_avg'),
        'cables': [t.col(f'l{i}') for i in range(9)] if t.has('l0') else [],
        'waypoint': t.col('Waypoint') if t.has('Waypoint') else [],
    }
    # metres → millimetres (the MATLAB multiplies by 1000 for the plots)
    for k in ('x', 'y', 'z'):
        data[k] = [v * 1000.0 for v in data[k]]
    return data


def _polygon_area(pts):
    """Shoelace area of a closed polygon."""
    if len(pts) < 3:
        return 0.0
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2.0


def tilt_deg(quats):
    """Angle between the global z axis and the end-effector axis, per the MATLAB
    (R(q) applied to [0,0,1], clipped, then acos)."""
    out = []
    for q in quats:
        v = quat_rotate(q, [0.0, 0.0, 1.0])
        c = max(-1.0, min(1.0, v[2] / (math.sqrt(sum(x * x for x in v)) or 1.0)))
        out.append(math.degrees(math.acos(c)))
    return out


def convex_hull_2d(points):
    """Andrew's monotone chain — the hull of the x-y cloud."""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def min_enclosing_circle(points):
    """
    Smallest enclosing circle (iterative Welzl) of the x-y cloud.

    Runs on the convex hull rather than all 18,300 samples, which is what the
    paper's "the projection of the workspace onto the xy plane approximates a
    circle with a diameter of ~600 mm" measures.
    """
    hull = convex_hull_2d([tuple(p) for p in points])
    if not hull:
        return (0.0, 0.0), 0.0
    if len(hull) == 1:
        return hull[0], 0.0

    def from2(a, b):
        return ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0), math.dist(a, b) / 2.0

    def from3(a, b, c):
        ax, ay = a
        bx, by = b
        cx, cy = c
        d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
        if abs(d) < 1e-12:
            pair = max(((a, b), (b, c), (a, c)), key=lambda p: math.dist(*p))
            return from2(*pair)
        ux = ((ax ** 2 + ay ** 2) * (by - cy) + (bx ** 2 + by ** 2) * (cy - ay) +
              (cx ** 2 + cy ** 2) * (ay - by)) / d
        uy = ((ax ** 2 + ay ** 2) * (cx - bx) + (bx ** 2 + by ** 2) * (ax - cx) +
              (cx ** 2 + cy ** 2) * (bx - ax)) / d
        return (ux, uy), math.dist((ux, uy), a)

    c, r = hull[0], 0.0
    for i, p in enumerate(hull):
        if math.dist(c, p) <= r + 1e-9:
            continue
        c, r = p, 0.0
        for j in range(i):
            q = hull[j]
            if math.dist(c, q) <= r + 1e-9:
                continue
            c, r = from2(p, q)
            for k in range(j):
                s = hull[k]
                if math.dist(c, s) <= r + 1e-9:
                    continue
                c, r = from3(p, q, s)
    return c, r


def alpha_volume(points, alpha=ALPHA_MM, voxel=VOXEL_MM):
    """Occupancy-grid α-shape volume (mm³)."""
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    dims = [max(1, int((hi[i] - lo[i]) / voxel) + 1) for i in range(3)]
    grid = bytearray(dims[0] * dims[1] * dims[2])
    step = int(math.ceil(alpha / voxel))
    for p in points:
        ci = [int((p[i] - lo[i]) / voxel) for i in range(3)]
        for dx in range(-step, step + 1):
            x = ci[0] + dx
            if x < 0 or x >= dims[0]:
                continue
            for dy in range(-step, step + 1):
                y = ci[1] + dy
                if y < 0 or y >= dims[1]:
                    continue
                for dz in range(-step, step + 1):
                    z = ci[2] + dz
                    if z < 0 or z >= dims[2]:
                        continue
                    c = [lo[i] + (ci[i] + (dx, dy, dz)[i]) * voxel for i in range(3)]
                    if math.dist(c, p) <= alpha:
                        grid[(z * dims[1] + y) * dims[0] + x] = 1
    inside = sum(grid)
    return inside * voxel ** 3, inside, dims


def analyse(path, arm_length=710.0):
    d = load_poses(path)
    X, Y, Z = d['x'], d['y'], d['z']
    quats = list(zip(d['qw'], d['qx'], d['qy'], d['qz']))
    tilt = tilt_deg(quats)

    pts_xy = list(zip(X, Y))
    ctr, r = min_enclosing_circle(pts_xy)
    diameter = 2 * r

    # The paper's "~600 mm circle or 84.5 % of the arm's neutral length" is the
    # cloud's footprint; measured on the whole cloud, and on the mid-height slice
    # (the repository also plots `mid_xy`), plus the equal-area circle.
    zs = sorted(Z)
    med = zs[len(zs) // 2]
    band = 0.12 * (max(Z) - min(Z))
    mid = [i for i in range(len(Z)) if abs(Z[i] - med) <= band]
    ctr_mid, r_mid = min_enclosing_circle([(X[i], Y[i]) for i in mid])
    area_xy = _polygon_area(convex_hull_2d(list(zip(X, Y))))
    diameter_eq = 2 * math.sqrt(area_xy / math.pi)

    # height of the endpoint cloud along z (the paper's extension degree of freedom)
    dz = max(Z) - min(Z)

    vol, voxels, dims = alpha_volume(list(zip(X, Y, Z)))

    # point density, exactly as the MATLAB computes it
    density = None
    if d['waypoint']:
        # consecutive-waypoint spacing of the first trajectory sweep
        pts = list(zip(X, Y, Z))
        n = 100
        dists = [math.dist(pts[i], pts[i + n]) for i in range(0, min(len(pts) - n, n * 100), n)]
        if dists:
            density = 100.0 / (sum(dists) / len(dists))

    return {
        'poses': len(X),
        'x_mm': X, 'y_mm': Y, 'z_mm': Z,
        'tilt_deg': tilt,
        'xy_circle_centre_mm': list(ctr),
        'xy_diameter_mm': diameter,
        'xy_diameter_pct_of_arm': 100.0 * diameter / arm_length,
        'xy_diameter_midslice_mm': 2 * r_mid,
        'xy_midslice_samples': len(mid),
        'xy_diameter_equal_area_mm': diameter_eq,
        'z_span_mm': dz,
        'z_span_pct_of_arm': 100.0 * dz / arm_length,
        'volume_cm3': vol / 1000.0,
        'voxels': voxels,
        'grid': dims,
        'tilt_max_deg': max(tilt),
        'tilt_mean_deg': mean(tilt),
        'tilt_p95_deg': percentile(tilt, 95),
        'point_density_per_100mm': density,
        'cable_delta_mm': [min(c) for c in d['cables']] if d['cables'] else [],
    }


def figure(res, path, arm_length=710.0):
    """Fig. 4D: top view + side cross-section, plus the tilt histogram."""
    w, h = 1000, 700
    c = Canvas(w, h, bg=(255, 255, 255), supersample=2)
    X, Y, Z, tilt = res['x_mm'], res['y_mm'], res['z_mm'], res['tilt_deg']

    ax1 = Axes(c, (70, 45, 400, 400), [-320, 320], [-320, 320], 'X (MM)', 'Y (MM)',
               'TOP VIEW (FIG. 4D)', equal=True)
    tmin, tmax = min(tilt), max(tilt)
    for x, y, t in zip(X, Y, tilt):
        f = (t - tmin) / (tmax - tmin or 1)
        col = (int(40 + 200 * f), int(70 + 60 * (1 - f)), int(180 - 120 * f))
        ax1.scatter([x], [y], col, 2)
    ax1.finish(4, 4)
    c.circle(ax1.X(res['xy_circle_centre_mm'][0]), ax1.Y(res['xy_circle_centre_mm'][1]),
             res['xy_diameter_mm'] / 2 * (ax1.w / 640.0), SET1[0], 2)
    c.text(80, 470, 'BOUNDING CIRCLE %.1f MM = %.1f%% OF %.0f MM'
           % (res['xy_diameter_mm'], res['xy_diameter_pct_of_arm'], arm_length),
           NAVY, 1)

    ax2 = Axes(c, (70, 510, 400, 150), [-320, 320], [min(Z), max(Z)], 'X (MM)', 'Z (MM)',
               'SIDE CROSS-SECTION')
    ax2.scatter(X, Z, (70, 110, 170), 1)
    ax2.finish(4, 3)

    ax3 = Axes(c, (560, 45, 380, 250), [0, 90], [0, 2500], 'TILT (DEG)', 'COUNT',
               'END-EFFECTOR TILT')
    bins = [0] * 18
    for t in tilt:
        bins[min(17, int(t / 5))] += 1
    for i, v in enumerate(bins):
        ax3.c.line(ax3.X(i * 5), ax3.Y(0), ax3.X(i * 5), ax3.Y(v), SET1[1], 3)
        ax3.c.line(ax3.X(i * 5), ax3.Y(v), ax3.X((i + 1) * 5), ax3.Y(v), SET1[1], 3)
    ax3.finish(6, 5)
    c.text(565, 320, 'MEAN %.1f DEG  P95 %.1f DEG  MAX %.1f DEG'
           % (res['tilt_mean_deg'], res['tilt_p95_deg'], res['tilt_max_deg']), NAVY, 1)
    c.text(565, 340, '%%  OF NEUTRAL LENGTH IN Z: %.1f' % res['z_span_pct_of_arm'], NAVY, 1)
    c.text(565, 360, 'Z SPAN %.1f MM (PAPER: 94.3 MM)' % res['z_span_mm'], NAVY, 1)
    c.text(565, 380, 'ALPHA-SHAPE VOLUME %.0f CM3  (ALPHA=34.4 MM)'
           % res['volume_cm3'], NAVY, 1)
    c.text(565, 400, 'POSES %d' % res['poses'], NAVY, 1)
    if res['point_density_per_100mm']:
        c.text(565, 420, 'DENSITY %.1f PTS / 100 MM' % res['point_density_per_100mm'], NAVY, 1)
    c.save_png(path)
    return path
