"""
cvjoint.py — port of `reference/matlab/plot_cvjoint.m` (Fig. S2).

The constant-velocity test: a DC motor drives one shaft of the TRUNC while two
encoders record the input and output angles. `matlab/cv/bend/*.txt` holds the
bending case (four columns: t_in, angle_in, t_out, angle_out, in degrees),
`matlab/cv/extend/*.txt` the extending case (three columns: t, counts_in,
counts_out, scaled by 360/1024 as the MATLAB does).

Two numbers come out:

  * the phase lag, exactly as the MATLAB computes it — the shift between the last
    input peak and the last output peak, in fractions of the output period
    (`di / wv`);
  * the *constant-velocity error*: the wrapped difference `angle_out - angle_in`,
    which for an ideal CV joint is a constant. Its spread is what "maintains equal
    speeds while bending" means numerically.
"""

import math
import os

from .csvio import read_csv
from .mathx import mean, std, wrap_to_180, percentile
from .plot import Axes, Canvas, SET1, NAVY

BEND = ['zerozero', 'fivedeg', 'tendeg', 'fifdeg', 'twendeg']
BEND_LABEL = ['0 DEG', '5 DEG', '10 DEG', '15 DEG', '20 DEG']
EXTEND = ['minus13mm', 'minus6p5mm', 'plus6p5mm', 'plus13mm', 'plus22p5mm']
EXTEND_LABEL = ['-13 MM', '-6.5 MM', '+6.5 MM', '+13 MM', '+22.5 MM']

COUNTS_PER_REV = 1024.0


def peaks(x):
    """Indices of strict local maxima — MATLAB `findpeaks` without the polish."""
    out = []
    for i in range(1, len(x) - 1):
        if x[i] > x[i - 1] and x[i] >= x[i + 1]:
            out.append(i)
    return out


def read_bend(path):
    _, rows = read_csv(path)
    t1, inp, t2, outp = [], [], [], []
    for r in rows:
        if len(r) < 4:
            continue
        try:
            t1.append(float(r[0]))
            inp.append(float(r[1]))
            t2.append(float(r[2]))
            outp.append(float(r[3]))
        except ValueError:
            continue
    return t1, inp, t2, outp


def read_extend(path):
    _, rows = read_csv(path)
    t, inp, outp = [], [], []
    for r in rows:
        if len(r) < 3:
            continue
        try:
            t.append(float(r[0]))
            inp.append(float(r[1]) * 360.0 / COUNTS_PER_REV)
            outp.append(float(r[2]) * 360.0 / COUNTS_PER_REV)
        except ValueError:
            continue
    # referencing to the first sample past 180°, as the MATLAB does
    def shift(v):
        for i, x in enumerate(v):
            if x >= 180.0:
                return [wrap_to_180(y - v[i]) for y in v]
        return v
    return t, shift(inp), shift(outp)


def analyse(bend_dir, extend_dir):
    bends, extends = [], []
    for name, label in zip(BEND, BEND_LABEL):
        p = os.path.join(bend_dir, name + '.txt')
        if not os.path.exists(p):
            continue
        t1, inp, t2, outp = read_bend(p)
        if not inp:
            continue
        pi, po = peaks(inp), peaks(outp)
        di = (po[-1] - pi[-1]) if (pi and po) else 0
        wv = (po[-1] - po[-2]) if len(po) >= 2 else 1
        resid = [wrap_to_180(o - i) for i, o in zip(inp, outp)]
        bends.append({
            'label': label,
            't_in': t1, 'angle_in': inp, 't_out': t2, 'angle_out': outp,
            'phase_lag_fraction': di / wv if wv else 0.0,
            'phase_lag_percent': 100.0 * di / wv if wv else 0.0,
            'residual_mean_deg': mean(resid),
            'residual_std_deg': std(resid),
            'peak_lag_samples': di,
            'period_samples': wv,
        })
    for name, label in zip(EXTEND, EXTEND_LABEL):
        p = os.path.join(extend_dir, name + '.txt')
        if not os.path.exists(p):
            continue
        t, inp, outp = read_extend(p)
        if not inp:
            continue
        resid = [wrap_to_180(o - i) for i, o in zip(inp, outp)]
        extends.append({
            'label': label,
            't': t, 'angle_in': inp, 'angle_out': outp,
            'residual_mean_deg': mean(resid),
            'residual_std_deg': std(resid),
            'residual_p95_deg': percentile([abs(r) for r in resid], 95),
        })
    return {'bend': bends, 'extend': extends}


def figure(res, path):
    """Fig. S2: input vs output angle, one tile per bend angle and per extension."""
    c = Canvas(1000, 900, bg=(255, 255, 255), supersample=2)
    c.text(60, 20, 'CONSTANT-VELOCITY JOINT - INPUT (BLACK) VS OUTPUT (RED) ANGLE', (20, 30, 60), 2)

    y = 60
    for i, b in enumerate(res['bend']):
        ax = Axes(c, (80, y, 420, 62), [0, 0.7], [-180, 180], 'T (S)' if i == 4 else '',
                  'DEG', b['label'], grid=True)
        ax.plot(b['t_in'], b['angle_in'], (20, 20, 20), 1)
        ax.plot(b['t_out'], b['angle_out'], SET1[0], 1)
        ax.finish(2, 3)
        c.text(520, y + 24, 'PHASE LAG %.1f%%  RESID %.2f +- %.2f DEG'
               % (b['phase_lag_percent'], b['residual_mean_deg'], b['residual_std_deg']), NAVY, 1)
        y += 84

    y += 10
    c.text(60, y - 6, 'EXTENDING: INPUT (BLACK) VS OUTPUT (RED)', (20, 30, 60), 2)
    y += 16
    for i, e in enumerate(res['extend']):
        ax = Axes(c, (80, y, 420, 50), [0, 1.3], [-180, 180], 'T (S)' if i == 4 else '',
                  'DEG', e['label'])
        ax.plot(e['t'], e['angle_in'], (20, 20, 20), 1)
        ax.plot(e['t'], e['angle_out'], SET1[0], 1)
        ax.finish(2, 3)
        c.text(520, y + 20, 'RESID %.2f +- %.2f DEG' % (e['residual_mean_deg'], e['residual_std_deg']), NAVY, 1)
        y += 70
    c.save_png(path)
    return path
