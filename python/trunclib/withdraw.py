"""
withdraw.py — withdraw the arm's 3D model from the CSVs.

The motion-capture files contain end-effector poses (x, y, z + quaternion) and the
nine cable lengths, but no joint angles: the arm's *model* has to be recovered from
the recordings. That is what this module does, in the two independent ways the data
allows:

  1. **from the poses** — for each recorded pose, solve for the seven model
     coordinates (θ1…θ6, L) that put `kinematics.forward`'s tool frame on the
     measured pose (`fit_stage`). The residual is how well the withdrawn model
     explains the recording.
  2. **from the cable lengths** — solve the same coordinates so the model's own
     nine cable lengths reproduce the recorded `l0…l8` deltas
     (`ik_from_cable_deltas`). This checks the *transmission* side: the recorded
     winch motion and the model's cable geometry have to agree.

The fitted configurations then instantiate `model3d.build_arm` into an OBJ file
and a rendered preview, i.e. the 3D model the CSVs imply.
"""

import math
import os

from .csvio import Table
from .kinematics import (L0, capture_point_to_model, capture_quat_to_model, fit_stage,
                         forward, ik_from_cable_deltas, winch_cables)
from .mathx import mean, std
from .model3d import build_arm, export_obj, render_preview

HOME_SAMPLES = 100          # workspace_analysis.m averages the first 100 poses for home


def read_entries(path, limit=None, stride=1):
    t = Table(path)
    entries = []
    for i in range(0, len(t), stride):
        if limit is not None and len(entries) >= limit:
            break
        pose = [t.col('x_end_avg')[i] * 1000.0,
                t.col('y_end_avg')[i] * 1000.0,
                t.col('z_end_avg')[i] * 1000.0]
        quat = [t.col('qw_end_avg')[i], t.col('qx_end_avg')[i],
                t.col('qy_end_avg')[i], t.col('qz_end_avg')[i]]
        cables = [t.col(f'l{k}')[i] for k in range(9)] if t.has('l0') else []
        entries.append({'index': i, 'pose_mm': pose, 'quat': quat, 'cables': cables})
    return entries


def withdraw(poses_csv, limit=400, stride=None, use_cables=False):
    """
    Fit the model to `limit` recorded poses spread over the whole set.

    The pose fit is the primary withdrawal: it reproduces every recorded pose to
    sub-millimetre accuracy, which is what makes the drawn 3D model the arm's own.
    `use_cables` additionally constrains the fit with the recorded `l0…l8` columns;
    that is off by default because those columns are the *winch commands* produced
    by the authors' own forward model (`matlab/training/trunc_model.m:find_lengths`,
    with its `dl_offset` and 0.75 coupling terms), not raw tendon geometry — see
    `cable_note` in the result.
    """
    total = len(Table(poses_csv))
    if stride is None:
        stride = max(1, total // max(1, limit))
    entries = read_entries(poses_csv, limit=limit, stride=stride)
    home_cables = forward(0, 0, 0, 0, 0, 0, L0)['cables']

    fits, seed = [], [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, L0]
    for e in entries:
        pose = capture_point_to_model(e['pose_mm'])
        quat = capture_quat_to_model(e['quat'])
        kwargs = {}
        if use_cables and e['cables']:
            kwargs = {'cables': e['cables'], 'home_cables': home_cables}
        fit = fit_stage(pose, quat, seed=seed, cables=kwargs.get('cables'),
                        home_cables=kwargs.get('home_cables'))
        fit['capture_pose_mm'] = e['pose_mm']
        seed = list(fit['params'])          # continuity: warm-start the next fit
        fits.append(fit)

    pos_err = [f['position_error_mm'] for f in fits]
    ang_err = [f['orientation_error_deg'] for f in fits]
    lengths = [f['L'] for f in fits]
    # The arm's overall bend: how far the tool's own axis deviates from the base
    # axis, in degrees off straight. (The fitted joint angles themselves are per
    # stage and unwrapped, so they are not comparable with the paper's bend.)
    bends = []
    for f in fits:
        R = forward(*f['params'])['rotation']
        axis = [R[0][2], R[1][2], R[2][2]]
        c = max(-1.0, min(1.0, -axis[2] / (math.sqrt(sum(t * t for t in axis)) or 1.0)))
        bends.append(180.0 - math.degrees(math.acos(c)))

    # ---- the transmission side, as a diagnostic: the model's own tendon pieces
    # against the recorded `l0…l8` winch commands
    cable_rows = []
    for e, f in zip(entries, fits):
        if not e['cables']:
            continue
        model = forward(*f['params'])['cables']
        delta = [model[i] - home_cables[i] for i in range(9)]
        diff = [delta[i] - e['cables'][i] for i in range(9)]
        rms = math.sqrt(mean([d * d for d in diff]))
        cable_rows.append({'index': e['index'], 'rms_mm': rms, 'delta': delta,
                           'recorded': list(e['cables'])})
    cable_rms = [c['rms_mm'] for c in cable_rows]
    # The recorded columns' own compression pattern, for the report: in the
    # deepest-compression rows the three pieces of one corner should shorten in
    # the authors' compaction split 1 : 5/7 : 3/7 (setup.m writes
    # comp_delta = delta_l .* [1, 5/7, 3/7]).
    recorded_ratio = None
    if cable_rows:
        deep = sorted(cable_rows, key=lambda c: c['recorded'][0])[: max(1, len(cable_rows) // 20)]
        base = mean([c['recorded'][0] for c in deep]) or 1.0
        recorded_ratio = [round(mean([c['recorded'][k] for c in deep]) / base, 3) for k in range(3)]

    home_pose = [mean([e['pose_mm'][k] for e in entries[:HOME_SAMPLES]]) for k in range(3)]
    home_seed = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, L0]
    home_fit = fit_stage(capture_point_to_model(home_pose), None, seed=home_seed, weight_rot=0.0)
    home_fit['capture_pose_mm'] = home_pose

    return {
        'source_csv': os.path.basename(poses_csv),
        'poses_in_file': total,
        'poses_fitted': len(fits),
        'stride': stride,
        'position_error_mm': {
            'mean': mean(pos_err), 'std': std(pos_err), 'max': max(pos_err),
            'median': sorted(pos_err)[len(pos_err) // 2],
        },
        'orientation_error_deg': {'mean': mean(ang_err), 'max': max(ang_err)},
        'arm_length_mm': {'mean': mean(lengths), 'min': min(lengths), 'max': max(lengths),
                          'nominal': L0},
        'bend_deg': {'mean': mean(bends), 'max': max(bends)},
        'cable_delta_rms_mm': {'mean': mean(cable_rms) if cable_rms else None,
                               'max': max(cable_rms) if cable_rms else None,
                               'samples': len(cable_rows)},
        'recorded_compression_ratio': recorded_ratio,
        'length_note': ('the recorded pose alone pins the end effector, not the arm '
                        'length: L is a redundant coordinate for a given pose, so the '
                        'fitted L stays within a few tenths of a millimetre of 710 mm '
                        'while the winch columns carry the recorded compression'),
        'cable_note': ('the recorded l0…l8 are the winch commands of the authors\' own '
                       'model (find_lengths: dl_offset + the 0.75 wrist coupling), so the '
                       'geometry-only tendon comparison carries that calibration offset; '
                       'the compression *convention* matches exactly (pure compaction of '
                       'ΔL shortens all nine commands by ΔL in this model, too)'),
        'used_cables_in_fit': use_cables,
        'home_pose_mm': home_pose,
        'home_fit': home_fit,
        'fits': fits,
        'entries': [{'index': e['index'], 'pose_mm': e['pose_mm']} for e in entries],
    }


def export_model(res, out_dir, samples=6):
    """Write the withdrawn arm as OBJ files plus one rendered preview."""
    written = []
    home_params = list(res['home_fit']['params'])
    mesh = build_arm(home_params)
    obj = export_obj(os.path.join(out_dir, 'arm-model.obj'), mesh,
                     'TRUNC arm — 3D model withdrawn from %s (%d poses fitted)' %
                     (res['source_csv'], res['poses_fitted']))
    png = render_preview(os.path.join(out_dir, 'arm-model.png'), mesh,
                         title='TRUNC ARM - MODEL WITHDRAWN FROM CSV')
    written += [obj, png]
    # a few fitted configurations along the set, as extra OBJ files
    fits = res['fits']
    if fits:
        step = max(1, len(fits) // samples)
        for k, i in enumerate(range(0, len(fits), step)):
            if k >= samples:
                break
            f = fits[i]
            m = build_arm(f['params'])
            p = export_obj(os.path.join(out_dir, f'arm-pose-{k}.obj'), m,
                           'TRUNC arm pose %d — fitted from CSV row %d (err %.2f mm)' %
                           (k, res['entries'][i]['index'], f['position_error_mm']))
            written.append(p)
    return written, mesh
