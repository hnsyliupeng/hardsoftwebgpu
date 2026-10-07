"""
crosscoupling.py — port of `reference/matlab/cross_coupling_analysis.m` (Fig. S7).

Nested TRUNCs should rotate independently; whatever torque leaks across is the
cross-coupling. The Instron files record several trials back to back
(`matlab/instron/cross-coupling/trial_1_1.csv` = driving the inner truss cell,
`trial_2_1.csv` = driving the outer equatorial one). `process_data` in the MATLAB
splits the file where the rotation jumps by more than 5°, trims every trial to the
shortest, and averages — this is that same processing.
"""

from .csvio import Table
from .mathx import mean, std, percentile
from .plot import Axes, Canvas, SET1, NAVY, GREY, legend

SENSITIVITY_NMM = 2.5      # "0.05 % of the maximum rated load or 2.5 N·mm"
SPLIT_THRESHOLD_DEG = 5.0


def process_data(path, threshold=SPLIT_THRESHOLD_DEG):
    t = Table(path)
    rot = t.col('Rotation')
    tor = t.col('Torque')
    # torque column is in N·m for the Instron exports → N·mm (the MATLAB plots N·mm)
    tor = [v * 1000.0 for v in tor]

    starts = [0]
    for i in range(1, len(rot)):
        if abs(rot[i] - rot[i - 1]) > threshold:
            starts.append(i)
    trials = []
    for k, s in enumerate(starts):
        e = starts[k + 1] if k + 1 < len(starts) else len(rot)
        trials.append((rot[s:e], tor[s:e]))
    if not trials:
        return [], [], 0
    n = min(len(r) for r, _ in trials)
    mean_rot = [mean([tr[0][i] for tr in trials]) for i in range(n)]
    mean_tor = [mean([tr[1][i] for tr in trials]) for i in range(n)]
    return mean_rot, mean_tor, len(trials)


def analyse(inner_path, outer_path):
    out = {}
    for key, path in (('inner_driven', inner_path), ('outer_driven', outer_path)):
        rot, tor, ntrials = process_data(path)
        if not rot:
            out[key] = {'trials': 0}
            continue
        # the plotting window of the MATLAB: 0 … 10° of rotation
        sel = [i for i, r in enumerate(rot) if 0 <= r <= 10.0]
        tor_win = [tor[i] for i in sel]
        out[key] = {
            'trials': ntrials,
            'rotation_deg': rot,
            'torque_nmm': tor,
            'mean_torque_nmm': mean(tor_win) if tor_win else 0.0,
            'max_torque_nmm': max(tor_win) if tor_win else 0.0,
            'abs_mean_torque_nmm': mean([abs(v) for v in tor_win]) if tor_win else 0.0,
            'p95_torque_nmm': percentile([abs(v) for v in tor_win], 95) if tor_win else 0.0,
            'below_sensitivity': all(abs(v) < SENSITIVITY_NMM for v in tor_win) if tor_win else True,
            'std_torque_nmm': std(tor_win) if tor_win else 0.0,
        }
    return out


def figure(res, path):
    c = Canvas(900, 420, bg=(255, 255, 255), supersample=2)
    c.text(50, 18, 'CROSS-COUPLING OF NESTED TRUNCS (FIG. S7)', (20, 30, 60), 2)
    for k, (key, label, col) in enumerate([
            ('inner_driven', 'INNER TRUSS DRIVEN (RED CURVE IN THE PAPER)', SET1[1]),
            ('outer_driven', 'OUTER EQUATORIAL DRIVEN (BLUE CURVE IN THE PAPER)', SET1[0])]):
        r = res.get(key)
        if not r or not r.get('trials'):
            continue
        ox = 60 + k * 430
        ax = Axes(c, (ox, 60, 360, 260), [0, 10], [0, 3], 'ROTATION (DEG)', 'TORQUE (N MM)',
                  label.split(' (')[0])
        ax.hline(SENSITIVITY_NMM, GREY, 1)
        pts = [(r['rotation_deg'][i], r['torque_nmm'][i])
               for i in range(len(r['rotation_deg'])) if 0 <= r['rotation_deg'][i] <= 10]
        ax.plot([p[0] for p in pts], [p[1] for p in pts], col, 2)
        ax.finish(5, 3)
        c.text(ox, 350, '%d TRIALS   MEAN %.3f N MM   P95 %.3f' %
               (r['trials'], r['abs_mean_torque_nmm'], r['p95_torque_nmm']), NAVY, 1)
        c.text(ox, 364, 'BELOW THE 2.5 N MM SENSITIVITY: %s' %
               ('YES' if r['below_sensitivity'] else 'NO'), NAVY, 1)
    c.save_png(path)
    return path
