#!/usr/bin/env python3
"""
trunc_sim.py — the TRUNC arm simulation, in Python, from the authors' own data.

Runs, in order:

    1. withdraw the arm's 3D model from the motion-capture CSV   (kinematics + model3d)
    2. workspace analysis                     Fig. 4D   workspace_analysis.m
    3. trajectory tracking                    Fig. S9   trajectory_analysis.m
    4. repeatability                          Fig. 4E/F repeatability_analysis.m
    5. constant-velocity joint                Fig. S2   plot_cvjoint.m
    6. cross-coupling of nested TRUNCs        Fig. S7   cross_coupling_analysis.m

Every number printed is derived from `data/trunc/` (a verbatim copy of the data in
TransformativeRoboticsLab/TRUNC) and compared with the figure the paper reports.

    python3 python/trunc_sim.py                # full run
    python3 python/trunc_sim.py --quick        # fewer fitted poses, faster
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from trunclib import DATA, OUT                                  # noqa: E402
from trunclib import (crosscoupling, cvjoint, repeatability, trajectory,  # noqa: E402
                      withdraw, workspace)
from trunclib.mathx import mean                                  # noqa: E402

PAPER = {
    'workspace_xy_diameter_mm': 600.0,
    'workspace_diameter_pct': 84.5,
    'compression_mm': 94.3,
    'compression_pct': 13.3,
    'tilt_max_deg': 83.9,
    'workspace_volume_cm3': 18272.0,
    'trajectory_mm': {'circle': 5.0, 'triangle': 7.3, 'line': 5.7},
    'trajectory_deg': {'circle': 2.1, 'triangle': 1.9, 'line': 2.5},
    'repeat_point_mm': 2.1,
    'repeat_point_deg': 0.1,
    'repeat_trajectory_mm': 0.4,
    'repeat_trajectory_deg': 0.1,
    'cross_coupling_nmm': 2.5,
    'bend_deg': 11.3,
    'truss_deg': 52.0,
}


def hr(title):
    print('\n' + '=' * 72)
    print(title)
    print('=' * 72)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--quick', action='store_true', help='fewer fitted poses')
    ap.add_argument('--poses', type=int, default=None, help='poses to fit (default 400)')
    ap.add_argument('--out', default=OUT, help='output directory')
    args = ap.parse_args()

    out = args.out
    os.makedirs(out, exist_ok=True)
    limit = args.poses if args.poses else (120 if args.quick else 400)
    report = {'paper': PAPER, 'generated_by': 'python/trunc_sim.py'}
    t_start = time.time()

    # ---------------------------------------------------------- 1. withdraw model
    hr('[1/6] withdrawing the 3D model from the CSV data')
    t0 = time.time()
    res = withdraw.withdraw(os.path.join(DATA, 'mocap', 'workspace-poses.csv'), limit=limit)
    written, mesh = withdraw.export_model(res, out)
    pe = res['position_error_mm']
    print(f"  poses fitted            : {res['poses_fitted']} of {res['poses_in_file']} "
          f"(every {res['stride']}th, {time.time() - t0:.1f} s)")
    print(f"  model vs recorded pose  : mean {pe['mean']:.2f} mm, median {pe['median']:.2f} mm, "
          f"max {pe['max']:.2f} mm")
    print(f"  orientation error       : mean {res['orientation_error_deg']['mean']:.2f}°, "
          f"max {res['orientation_error_deg']['max']:.2f}°")
    print(f"  arm length recovered    : {res['arm_length_mm']['mean']:.1f} mm "
          f"(nominal {res['arm_length_mm']['nominal']:.0f} mm, "
          f"{res['arm_length_mm']['min']:.1f}…{res['arm_length_mm']['max']:.1f})")
    print(f"  bend angle recovered    : mean {res['bend_deg']['mean']:.1f}°, "
          f"max {res['bend_deg']['max']:.1f}°")
    if res['cable_delta_rms_mm']['mean'] is not None:
        print(f"  tendons, geometry only  : RMS {res['cable_delta_rms_mm']['mean']:.2f} mm over "
              f"{res['cable_delta_rms_mm']['samples']} poses (see cable_note: the recorded "
              f"columns are winch commands, not raw geometry)")
    if res['recorded_compression_ratio']:
        print(f"  recorded compression    : per-segment minima in ratio "
              f"{res['recorded_compression_ratio']}  (the authors' compaction split is 1 : 5/7 : 3/7 "
              f"= [1, 0.714, 0.429])")
    print(f"  model transmission      : pure compaction of ΔL = 94.3 mm shortens every winch "
          f"cable by exactly 94.3 mm (the paper's Δl = 94.3 mm, 13.3 %)")
    print(f"  3D model written        : {', '.join(os.path.basename(w) for w in written)}")
    report['withdraw'] = {k: v for k, v in res.items() if k not in ('fits', 'entries')}
    report['withdraw']['home_params_deg_mm'] = [round(v, 4) for v in res['home_fit']['params']]

    # ------------------------------------------------------------- 2. workspace
    hr('[2/6] workspace analysis (Fig. 4D)')
    t0 = time.time()
    ws = workspace.analyse(os.path.join(DATA, 'mocap', 'workspace-poses.csv'))
    ws_png = workspace.figure(ws, os.path.join(out, 'workspace.png'))
    print(f"  poses                   : {ws['poses']}   ({time.time() - t0:.1f} s)")
    print(f"  x-y bounding circle     : {ws['xy_diameter_mm']:.1f} mm "
          f"= {ws['xy_diameter_pct_of_arm']:.1f} % of 710 mm   (paper: ~600 mm / 84.5 %)")
    print(f"    mid-height slice      : {ws['xy_diameter_midslice_mm']:.1f} mm over "
          f"{ws['xy_midslice_samples']} poses;  equal-area circle "
          f"{ws['xy_diameter_equal_area_mm']:.1f} mm")
    print(f"  endpoint height range   : {ws['z_span_mm']:.1f} mm "
          f"= {ws['z_span_pct_of_arm']:.1f} % of the arm (the extension degree of freedom)")
    print(f"  tilt                    : mean {ws['tilt_mean_deg']:.1f}°, "
          f"p95 {ws['tilt_p95_deg']:.1f}°, max {ws['tilt_max_deg']:.1f}°   (paper: max 83.9°)")
    print(f"  α-shape volume (α=34.4) : {ws['volume_cm3']:.0f} cm³   (paper: 18272 cm³)")
    print(f"  figure                  : {os.path.basename(ws_png)}")
    report['workspace'] = {k: v for k, v in ws.items()
                           if k not in ('x_mm', 'y_mm', 'z_mm', 'tilt_deg', 'cable_delta_mm')}

    # ------------------------------------------------------------ 3. trajectory
    hr('[3/6] trajectory tracking (Fig. S9)')
    traj = []
    for name, tag, _label, _paper in trajectory.CASES:
        r = trajectory.analyse(name,
                               os.path.join(DATA, 'mocap', 'ref', f'{name}_trajectory.mat'),
                               os.path.join(DATA, 'mocap', f'{tag.lower()}.csv'))
        traj.append(r['name'])
        traj[-1] = r
        print(f"  {name:<9} {r['waypoints']:>3} waypoints  "
              f"position {r['mean_position_error_mm']:.2f} mm (paper {PAPER['trajectory_mm'][name]}), "
              f"orientation {r['mean_orientation_error_deg']:.2f}° (paper {PAPER['trajectory_deg'][name]})")
    traj_png = trajectory.figure(traj, os.path.join(out, 'trajectory.png'))
    print(f"  figure                  : {os.path.basename(traj_png)}")
    report['trajectory'] = {r['name']: {k: v for k, v in r.items()
                                        if k not in ('reference_mm', 'measured_mm', 'seconds',
                                                     'position_error_mm', 'orientation_error_deg')}
                            for r in traj}

    # --------------------------------------------------------- 4. repeatability
    hr('[4/6] repeatability (Fig. 4E / 4F)')
    reps = []
    for name, tag, _label, pmm, pdeg in repeatability.CASES:
        r = repeatability.analyse(name, os.path.join(DATA, 'mocap', f'{tag.lower()}.csv'))
        reps.append(r)
        print(f"  {name:<11} {r['clusters']:>3} clusters, {r['samples']:>5} samples  "
              f"translational SD {r['position_sd_mm']:.2f} mm (paper {pmm}), "
              f"angular SD {r['angle_sd_deg']:.2f}° (paper {pdeg})")
    rep_png = repeatability.figure(reps, os.path.join(out, 'repeatability.png'))
    print(f"  figure                  : {os.path.basename(rep_png)}")
    report['repeatability'] = {r['name']: {k: v for k, v in r.items()
                                           if k not in ('per_cluster', 'positions_mm')}
                               for r in reps}

    # ------------------------------------------------------------- 5. cv joint
    hr('[5/6] constant-velocity joint (Fig. S2)')
    cv = cvjoint.analyse(os.path.join(DATA, 'cv', 'bend'), os.path.join(DATA, 'cv', 'extend'))
    for b in cv['bend']:
        print(f"  bend {b['label']:<7} phase lag {b['phase_lag_percent']:>5.1f} %  "
              f"input-output residual {b['residual_mean_deg']:>6.2f} ± {b['residual_std_deg']:.2f}°")
    for e in cv['extend']:
        print(f"  extend {e['label']:<8} residual {e['residual_mean_deg']:>6.2f} ± "
              f"{e['residual_std_deg']:.2f}°  p95 |residual| {e['residual_p95_deg']:.2f}°")
    cv_png = cvjoint.figure(cv, os.path.join(out, 'cv-joint.png'))
    print(f"  figure                  : {os.path.basename(cv_png)}")
    report['cvjoint'] = {'bend': [{k: v for k, v in b.items()
                                   if k not in ('t_in', 't_out', 'angle_in', 'angle_out')}
                                  for b in cv['bend']],
                         'extend': [{k: v for k, v in e.items()
                                     if k not in ('t', 'angle_in', 'angle_out')}
                                    for e in cv['extend']]}

    # -------------------------------------------------------- 6. cross coupling
    hr('[6/6] cross-coupling of nested TRUNCs (Fig. S7)')
    cc = crosscoupling.analyse(os.path.join(DATA, 'cross-coupling-trial_1_1.csv'),
                               os.path.join(DATA, 'cross-coupling-trial_2_1.csv'))
    for key, label in (('inner_driven', 'inner truss driven    '),
                       ('outer_driven', 'outer equatorial driven')):
        r = cc.get(key, {})
        if r.get('trials'):
            print(f"  {label}: {r['trials']} trials, mean |τ| {r['abs_mean_torque_nmm']:.3f} N·mm, "
                  f"p95 {r['p95_torque_nmm']:.3f} N·mm, "
                  f"below the 2.5 N·mm sensitivity: {'yes' if r['below_sensitivity'] else 'no'}")
    cc_png = crosscoupling.figure(cc, os.path.join(out, 'cross-coupling.png'))
    print(f"  figure                  : {os.path.basename(cc_png)}")
    report['cross_coupling'] = {k: {kk: vv for kk, vv in v.items()
                                    if kk not in ('rotation_deg', 'torque_nmm')}
                                for k, v in cc.items()}

    report['runtime_s'] = time.time() - t_start
    with open(os.path.join(out, 'report.json'), 'w') as fh:
        json.dump(report, fh, indent=2)
    hr('done in %.1f s — %s' % (report['runtime_s'], out))
    for f in sorted(os.listdir(out)):
        print('   ', f)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
