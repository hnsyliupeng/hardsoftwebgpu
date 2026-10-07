# TRUNC arm — Python simulation, driven by the authors' CSVs

A dependency-free Python implementation of the soft robotic arm from *Bridging
Hard and Soft: Mechanical Metamaterials Enable Rigid Torque Transmission in Soft
Robots* (Carton et al., [arXiv:2412.02650v1](https://arxiv.org/html/2412.02650v1))
and the authors' own repository
([TransformativeRoboticsLab/TRUNC](https://github.com/TransformativeRoboticsLab/TRUNC)).

Nothing here needs `pip`: pure `python3`, standard library only. Everything it
plots and computes comes out of the data in `data/trunc/`, which is a verbatim
copy of the authors' recorded measurements and motion-capture sessions.

```bash
python3 python/trunc_sim.py            # the full run (≈90 s)
python3 python/trunc_sim.py --quick    # fewer fitted poses, ≈40 s
```

Outputs land in `python/out/`: six figures, the withdrawn 3D model (`arm-model.obj`
plus six fitted poses), and `report.json` with every number.

## What it does, and where each piece comes from

| step | module | the MATLAB it ports |
| --- | --- | --- |
| withdraw the 3D model from the CSV | `trunclib/withdraw.py`, `kinematics.py`, `model3d.py` | `training/kinematics.m`, `training/trunc_model.m` |
| workspace — Fig. 4D | `trunclib/workspace.py` | `workspace_analysis.m`, `workspace_plot.m` |
| trajectory tracking — Fig. S9 | `trunclib/trajectory.py` | `trajectory_analysis.m` |
| repeatability — Fig. 4E/4F | `trunclib/repeatability.py` | (method: "distance of each data point from its cluster's mean") |
| constant-velocity joint — Fig. S2 | `trunclib/cvjoint.py` | `plot_cvjoint.m` |
| cross-coupling — Fig. S7 | `trunclib/crosscoupling.py` | `cross_coupling_analysis.m` |
| the two cells' structural features | `tools/trunc-data.mjs` (JS) | `ansys_analysis.m`, `instron_plots.m` |

The MATLAB sources this ports are kept in `reference/matlab/` for side-by-side
reading.

## Withdrawing the model from the CSV

The recordings contain end-effector poses and the nine winch commands — no joint
angles. The arm's model is therefore *withdrawn* from them:

1. `kinematics.forward` builds the arm exactly as the authors' model does:
   a spherical + prismatic stage per segment (`Rz(-θ₂)·Tz(d)·Rx(θ₁)·Rz(θ₂)`,
   "spherical joint with prismatic joint"), split 3L/7 : 2L/7 : 2L/7 over the
   three segments plus the 83 mm tool offset, tendons between the 65 mm cable
   triads of consecutive frames.
2. For every recorded pose, `fit_stage` solves the seven model coordinates
   (θ₁…θ₆, L) that put the tool frame on the measured pose. Over the whole
   18,300-pose session the fit reproduces the recording to ~0.05 mm mean and
   0.01° (max ≈ 2.6 mm at the extreme corner of the workspace), which is what
   makes the drawn model *the arm's own geometry* rather than a look-alike.
3. `model3d.build_arm` instantiates that configuration: seven TRUNC cells
   (3 + 2 + 2), each a pair of concentric shells representing the paper's two
   **nested** cells — the inner truss cell (mould D = 56 mm), which is the
   torque path to the tool, inside the outer equatorial cell (mould D = 88 mm)
   that guides the tendons — joined by 4 mm rod + bearing connectors, with a
   cable-guide triad and 65 mm cable ring at each stage frame, three tendons per
   ring, and the socket tool past the wrist.

### The capture frame

The motion-capture CSVs are in the capture frame, which is the model frame with
y and z reversed. Fitting recorded poses gives 0.03 mm mean residual in the
flipped frame against 226 mm in the raw one (and 0.0° orientation error), so the
two frames are related by a 180° rotation about x — the same relation the browser
app carries as `MATLAB_TO_ROBOT = diag(1, −1, −1)`.

### A note on the `l0…l8` columns

They are the winch commands produced by the authors' own model
(`trunc_model.m:find_lengths`, with its `dl_offset` and the `0.75` wrist
coupling), not raw tendon geometry, so a geometry-only comparison of the tendon
path carries that calibration offset (≈75 mm RMS). What matches exactly is the
*convention*: a pure compaction of ΔL shortens every one of the nine commands by
exactly ΔL, and in the deepest-compression rows the three pieces of a corner
shorten in the ratio 1 : 0.74 : 0.45 against the authors' `comp_delta` split
1 : 5/7 : 3/7 = 1 : 0.714 : 0.429. The pure-compression sweep that produces the
paper's **Δl = 94.3 mm (13.3 %)** is computed from the same model and printed in
step 1 of the run.

## The numbers, against the paper

| quantity | this simulation | paper |
| --- | --- | --- |
| pose reproduction | 0.05 mm mean (max 2.6 mm), 0.01° | — |
| arm length recovered | 710.6 mm (710.0 … 715.3) | l = 710 mm |
| x-y workspace footprint | 665.5 mm; equal-area circle 609 mm | ≈600 mm, 84.5 % of l |
| endpoint tilt | max 83.9° | 83.9° |
| circle trajectory | 5.03 mm / 2.08° | 5.0 mm / 2.1° |
| triangle trajectory | 7.27 mm / 1.87° | 7.3 mm / 1.9° |
| staircase trajectory | 5.69 mm / 2.55° | 5.7 mm / 2.5° |
| trajectory repeatability | 0.43 mm / 0.11° | 0.4 mm / 0.1° |
| point repeatability | 2.05 mm | 2.1 mm |
| cross-coupling, inner driven | 0.21 N·mm (p95 0.38) | below the 2.5 N·mm sensitivity |
| cross-coupling, outer driven | 0.53 N·mm (p95 0.73) | below the 2.5 N·mm sensitivity |
| CV joint, bending | phase lag 0.4–1.8 % | phase-matched |
| cell twist/bend ratio | 11.3 equatorial, 52.0 truss | 11 and 52 |

The workspace volume is reported with the same α = 34.4 mm definition the paper
uses, evaluated on an occupancy grid because there is no α-shape library here.
