"""
repeatability.py — the analysis behind Fig. 4E/4F.

The authors' repository ships the raw repeats (`matlab/training/repeatability/*`)
but not the plotting script, so this follows the method the paper states:

  "the arm visited the 100 points over five trials and we calculated the
   translational and angular distance of each data point from its cluster's mean"

i.e. for every commanded point, cluster the samples by point index, take the mean
pose of the cluster (`meanrot` = the quaternion average, here Markley's), then
report the spread of the residual distances. Point-precision and
trajectory-precision tests differ only in how the cluster order was generated.
"""

import math

from .csvio import Table
from .mathx import quat_angle, quat_average, quat_norm, rad2deg, mean, std, percentile
from .plot import Axes, Canvas, SET1, NAVY

CASES = [
    ('point', 'REPEAT-POINT', 'POINT PRECISION (RANDOM ORDER)', 2.1, 0.1),
    ('trajectory', 'REPEAT-TRAJECTORY', 'TRAJECTORY PRECISION (FIXED ORDER)', 0.4, 0.1),
]


def analyse(name, path):
    t = Table(path)
    # The cluster key is the *collection index*: the README of the data repository
    # says "Test num: Data collection index (same as p_idx for trajectory precision
    # test)". In the point-precision file the p_idx column holds the randomised
    # point label and does not group repeats of the same point (grouping by it gives
    # a 187-390 mm spread, by Test num 6-15 mm).
    idx_col = 'Test num' if t.has('Test num') else ('p_idx' if t.has('p_idx') else 'Waypoint')
    idx = [int(v) for v in t.col(idx_col)]
    x = [v * 1000.0 for v in t.col('x_end_avg')]
    y = [v * 1000.0 for v in t.col('y_end_avg')]
    z = [v * 1000.0 for v in t.col('z_end_avg')]
    q = [quat_norm([t.col('qw_end_avg')[i], t.col('qx_end_avg')[i],
                    t.col('qy_end_avg')[i], t.col('qz_end_avg')[i]]) for i in range(len(t))]

    clusters = {}
    for i, k in enumerate(idx):
        clusters.setdefault(k, []).append(i)

    pos_res, ang_res = [], []
    per_cluster = []
    for k, ids in sorted(clusters.items()):
        if len(ids) < 2:
            continue
        cx = mean([x[i] for i in ids])
        cy = mean([y[i] for i in ids])
        cz = mean([z[i] for i in ids])
        cq = quat_average([q[i] for i in ids])
        ds, angs = [], []
        for i in ids:
            ds.append(math.dist((x[i], y[i], z[i]), (cx, cy, cz)))
            angs.append(rad2deg(quat_angle(q[i], cq)))
        per_cluster.append({
            'index': k, 'samples': len(ids),
            'mean_mm': [cx, cy, cz],
            'position_sd_mm': std(ds), 'position_sd_mean_mm': mean(ds),
            'angle_sd_deg': std(angs), 'angle_mean_deg': mean(angs),
        })
        pos_res.extend(ds)
        ang_res.extend(angs)

    # the reported number is the SD of the residual distances across all samples
    return {
        'name': name,
        'clusters': len(per_cluster),
        'samples': len(pos_res),
        'position_sd_mm': std(pos_res),
        'position_mean_mm': mean(pos_res),
        'position_p95_mm': percentile(pos_res, 95),
        'angle_sd_deg': std(ang_res),
        'angle_mean_deg': mean(ang_res),
        'angle_p95_deg': percentile(ang_res, 95),
        'per_cluster': per_cluster,
        'positions_mm': list(zip(x, y, z)),
    }


def figure(results, path):
    c = Canvas(1000, 560, bg=(255, 255, 255), supersample=2)
    for k, res in enumerate(results):
        col = SET1[k]
        ox = 60 + k * 490
        ax = Axes(c, (ox, 45, 400, 300), [-320, 320], [-320, 320], 'X (MM)', 'Y (MM)',
                  res['name'].upper() + ' PRECISION', equal=True)
        pts = res['positions_mm'][:: max(1, len(res['positions_mm']) // 4000)]
        ax.scatter([p[0] for p in pts], [p[1] for p in pts], col, 2)
        ax.finish(4, 4)

        ax2 = Axes(c, (ox, 400, 400, 120), [0, 6], [0, 1200], 'RESIDUAL (MM)', 'COUNT',
                   'TRANSLATIONAL RESIDUAL')
        bins = [0] * 24
        for d in [pc['position_sd_mean_mm'] for pc in res['per_cluster']]:
            bins[min(23, int(d))] += 1
        for i, v in enumerate(bins):
            ax2.c.line(ax2.X(i * 0.25), ax2.Y(0), ax2.X(i * 0.25), ax2.Y(v), col, 3)
            ax2.c.line(ax2.X(i * 0.25), ax2.Y(v), ax2.X((i + 1) * 0.25), ax2.Y(v), col, 3)
        ax2.finish(6, 4)

        c.text(ox, 535, 'SD %.2f MM / %.2f DEG  P95 %.2f MM   (%d CLUSTERS, %d SAMPLES)'
               % (res['position_sd_mm'], res['angle_sd_deg'], res['position_p95_mm'],
                  res['clusters'], res['samples']), NAVY, 1)
    c.save_png(path)
    return path
