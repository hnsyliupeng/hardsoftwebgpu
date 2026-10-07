# Hard–Soft Arm Lab — design notes

A browser simulation of the TRUNC / arXiv:2412.02650 arm: a truss-flexure soft
continuum arm whose nine tendons are driven from the base, a rigid-torque
transmission joint at the tool, and a transformer policy that is distilled from
a scripted expert inside a Web Worker. Everything runs offline — no CDN, no
network, no `three.js`; the module graph is plain ES modules served by
`tools/dev-server.mjs`.

## 1. Plant

| element | value | source |
| --- | --- | --- |
| segments | 3 × 0.2367 m, 45° bend limit each | paper §"Design" |
| cables | 9 (3 per segment, ψ ∈ {90°, 210°, 330°}) | paper Fig. 3, TRUNC repo |
| neutral reach | 710 mm | paper |
| compression | 94.3 mm | paper |
| stiffness | truss 0.453 + guide 0.300 + tendon 0.810; ×6 when assembled | `src/core/metamaterial.js` |
| torque transmission | 52× torsion/bending at the joint | paper |
| step | fixed 1/240 s, winch servo at 0.35 m/s, slew limit 0.025 m/s | calibration runs |

Kinematics (`src/core/arm.js`): chord state per segment `p = (L/φ)(sin φ·Y +
(1−cos φ)·d)`, `d = (cos ψ, 0, sin ψ)`, tendon delta
`Δ = −r·bend·cos(ψ−plane) − compress`. The inverse problem is solved with
damped least squares over the 9-DOF cable space, warm-started from the previous
solution, `ikIters = 24`, `axisWeight = 0.3`, with wrinkle/soft-stop penalties.
`ikCompensated()` re-solves with the predicted contact wrench folded in.

The `Rust` mirror in `rust/trunc_core/` implements the same constants, the same
chord model, the same `trunc_state`/`trunc_task_state` scratch layout and the
same MLP arithmetic; `tools/check-rust.mjs` compiles lib + bin + tests with the
WASI toolchain and `tests/*.test.mjs` asserts the JS side matches those numbers.

## 2. Arm geometry (what is actually drawn)

**This section was rewritten after the model drawn here was rejected as not being
the paper's joint.** The earlier arm — a diamond lattice with a central shaft and
solid collars — was a *reconstruction*: it looked like a truss, but no part of it
came from the publication. It has been replaced by geometry read off
arXiv:2412.02650v1 and the authors' MATLAB. `src/core/truncSpec.js` is the single
place that mapping is written down, with the citation next to each constant.

What the paper actually specifies, and what is now drawn:

  * **The cell.** TRUNC is a **double-arrowhead auxetic cell tiled on a sphere**:
    a spherical mechanism of non-fixed radius, described by axial point groups
    `2*N`. The paper chooses four-fold equatorial symmetry (**N = 4**), so
    `cellLattice()` lays eight half-sectors of auxetic chevrons around the axis,
    widening to a waist at the equator and closing on a pole ring at each end.
  * **Two variants, two shafts.** `M = 2` is the **equatorial** joint — a single
    band of joints on the equator, the *easy* bending mode that holds the tendons
    at a constant radius (twist : bend = 11). `M = 3` is the **truss** — a second
    band above the equator, so the cell can shear internally and the twist mode is
    stiff (twist : bend = 52). The paper's arm is **two nested flex shafts**: the
    truss shaft drives the socket driver, the equatorial shaft guides the nine
    tendons. Every joint in the app therefore draws *two* nested cells, the truss
    one inside the equatorial one, both from `poseJoint()`.
  * **56 / 88 mm molds.** "Steel links were manually bent using a spherical mold
    with a 56 mm diameter for the truss cells and an 88 mm diameter mold for
    equatorial cells" (Materials and Methods). Those are the two radii the cells
    are moulded on, and `MOLD_DIAMETER_MM` carries them. A cell never scales: the
    joint-to-joint pitch (101.4 mm) is bigger than the cell, and the gap between
    two cells is the paper's connector — "a 4 mm steel rod press-fit into a
    bearing (McMaster 6655K47) ... fastened to the cell with a 3D printed
    connector" — which is exactly the arrangement of Fig. 4 A.
  * **Seven joints, eight guides, nine tendons.** The MATLAB splits the arm
    `shoulder : elbow : wrist = 3L/7 : 2L/7 : 2L/7` with `L = 695 mm`; the cells
    follow that split 3 : 2 : 2, giving a uniform 101.4 mm pitch over the 710 mm
    neutral length. A **three-arm cable guide** sits at the base, at every cell
    boundary and at the wrist (Fig. 4 C). Its arm tips *are* the cable-triangle
    corners, so the nine tendons thread exactly over the guide rollers instead of
    merely passing nearby.
  * **Restoring spring.** A **conical spring** runs down the middle of each truss
    cell (Fig. 2 E): it restores extension without transmitting torque, which is
    the whole point of the design.
  * **End effector.** The socket driver from the paper's demo (Fig. 5) — taper,
    socket head, motor sleeve that lights up while the drill relay is energised.

Three real bugs were found while re-deriving this, and all three were visible on
screen before they were fixed:

  * `portGeometry()` passed the cable ring radius in **metres** to `cornersOf()`,
    which works in **millimetres** (like the rest of the ported kinematics). Every
    tendon was therefore computed on a 0.065 mm triangle and collapsed onto the
    shaft axis — the "nine tendons" were one orange line down the middle.
  * the engine arm's cell walk used a single `cellsPerSegment` and equal thirds of
    the length, so the drawn pitches were 78.9/118.3 mm instead of the MATLAB's
    uniform 101.4 mm; `segmentSplit` now carries 3:2:2 and `segLength(s)` is what
    the FK, the bones, the guides and the tendons all walk.
  * the guide stations are placed *on* the arc samples (`SPINE_N = 12`, divisible
    by 3 and 2), so a guide's roller and the tendon that threads it are the same
    point in space rather than two points that happen to be close.

### 2.1 What the cell *does* — the linkage, and why the FK closes (rewritten)

The geometry above was right; the **mechanism** was not, and it is what the
forward kinematics is judged by. A TRUNC is not a decorated ball. It is a
linkage: rigid links of width `w` and thickness `t` pinned to each other at
revolute folds, tiled on the sphere, and therefore *over-constrained* — its two
end rings are the two nodes' own bolt patterns, and the interior fold vertices
can only sit where the link spheres meet. `poseJoint()` solves exactly that
(links as distance constraints, Gauss–Newton, two assembly branches), which
turns "is the FK right?" into a number: the worst violation of any rigid link at
the pose the FK asks for.

Getting that number down to micrometres needed four corrections, each of which
had been making the cell look plausible while being wrong:

  * **The chain runs along −z of each MATLAB frame.** `segment_transform` is
    `Rz(−t2)·Tz(d)·Rx(t1)·Rz(t2)`: it translates along the frame's own z, and the
    bend axis is that frame's x turned by `t2`. The port had been inferring a
    shaft axis from the frame's columns; `appFrameMM()` now reads the frame's
    own z (the shaft), x (the roll reference) and nothing else. The frame layout
    everywhere is the one store convention — the three triples *are* the node's
    x, shaft and z — which is also what the engine check's own frame builder got
    wrong for a while.
  * **A segment's bend is shared out over its cells.** The MATLAB applies the
    whole segment rotation at *every* station (a rigid-body simplification), so
    sampling it literally gives six of seven modules no bend at all and one
    module the segment's entire bend. The cells are rigid links joined at the
    interfaces, so the segment is sampled as a chain in which station *i* carries
    `i/N` of the segment's bend. That is what makes the drawn arm bend
    distributedly — and it is why the arm's cell bends are 1.1°/7.5°/6.3° rather
    than 0°/15°/12.4°.
  * **The plates tilt symmetrically about the rod.** Rigid connectors cannot bolt
    a plate on cocked: both bearings are press-fits and the rod between them is
    straight. The chain's sample frames put the far plate's axis up to 12° off
    the rod (no assembly), so each cell's two rings are placed at ±θ/2 about the
    rod's actual direction, each keeping its own node's roll — the half-angle map
    that makes the joint constant velocity. Measured: exact to 3e−14°.
  * **The linkage only sees the bend.** A module passes rotation through its
    **nested flex shafts** and the **thrust bearing** between the two cells
    ("nesting joints inside each other enabled concentric torque transmission";
    the connector *is* a rod running in a bearing, and it spins). Forcing the
    twist through the links instead produces millimetres of fictitious link
    strain — which is exactly what the earlier reports of "the cell cannot close
    at 45°" were. Twists are now reported (`twistDeg`) and passed, not solved
    for; the plates' plate-to-plate distance is free within the bearing's stroke
    and is taken up by a second, released solve (the conical spring's job).

What the checks now say, from `.check/engine-check.mjs` (rows `cell/…`):

  * **the unit cell is the paper's pinned double-arrowhead tiling** — N = 4
    (eight fold planes), M = 3/2 bands, 56/88 mm molds, 5×1.6 mm links, 16
    arrow-head links (truss) vs 8 (equatorial).
  * **the linkage closes at every bend, and rides a non-fixed sphere** — truss
    and equatorial closures 2.5e−14 / 4.6e−10 / 2.3e−9 mm at 0/12/30°, fold
    sphere 28.00 → 27.60 mm with bend.
  * **the cell transmits rotation at constant velocity and is frame-invariant** —
    half-angle map exact to 3e−14°, both shafts roll together to 0.0 mrad, shape
    unchanged (2.8e−14 mm) by a 145 mm move + 63° reorientation.
  * **every joint of the arm closes from its own two FK frames** — 7 joints
    (3:2:2), active 2/4/6, worst rigid-link violation **2.7e−5 mm** on the circle
    task and ≤2.6e−4 mm on every other task's joints: for every pose the FK
    produces, the paper's mechanism closes on its own to a fraction of a
    micrometre, with the connectors not sliding at all (`extend` = 0.0 mm). The
    FK and the cell now agree by measurement, not by assertion.

Scene-level work that is still true: the arm is mounted on the floor, so the
bench is a **frame with an opening** rather than a solid slab, and the fallback
rasteriser frames the 0.59 m arm (not the 1.15 m bench) with a clamped diffuse
term, because a 56 mm lattice a metre away is either blown out to white or
sub-pixel thin.

## 3. Tasks

Five jobs, all validated headlessly by `.check/episode.mjs` (5/5, no damage,
peak force ≤ 4.1 N, tip deviation < 0.05 mm):

| job | turns | depth | torque | notes |
| --- | --- | --- | --- | --- |
| bolt | 6.00 | 7.50 mm | 1.4 N·m | 1.25 mm pitch |
| bulb | 2.40 | 6.00 mm | 0.35 N·m | 2.5 mm pitch, soft pinch |
| valve | 5.00 | 10.00 mm | stiction + friction | highest load |
| peg | 3.00 | 30.01 mm | — | 10 mm pitch, compliance absorbs misalignment |
| assembly | bolt after peg | | | multi-stage objective |

Anchors were **sampled from reachable joint space** (`.check/place3.mjs`) and
verified with a 0.5 mm approach ladder (< 1.2 mm residual, < 2° joint jump), not
picked by hand from a sweep. Mirrored bending planes between neighbouring
segments (S-shapes) are treated as singularities and are excluded by the
wrinkle penalty and the 0.94·45° soft stop.

## 4. Learners

Both live in `src/workers/trainers.js` and run inside `sim.worker.js`, so the
page never blocks.

**Learned inverse kinematics** — `Mlp([19, 48, 48, 9], tanh)`, Adam, labels from
the solver. Inputs are the tool pose (7) and the current per-segment state
(3 × 4); targets are nine tendon lengths. Labels are **standardised per channel
before training** and de-standardised at prediction — without that the tanh head
spends its budget representing a large common offset and the network ends up
*worse* than predicting the mean (0.128 vs 0.094 MAE). After standardising:
mean |error| ≈ 0.027 raw ≈ **1.6 mm rms tendon error**, versus 5.6 mm for the
constant predictor.

**Transformer policy** — causal, 2 layers × 32 model dims × 2 heads, vocabulary
of phase tokens (`1 + kind·7 + phase`), conditioning vector of 29 values (job
parameters 12, measured pose 7, current tendon lengths 9, progress 1). At every
control step it is asked for a *chunk* of 16 waypoint commands; only row 0 is
executed and the chunk is re-planned from the measured state on the next step
(receding horizon). Training data is distilled from the scripted expert: ~900
(state → action-chunk) pairs sampled at 10 Hz over five nominal demonstrations,
labels standardised per channel.

### Measured ablations (all from `.check/`, 34 s episodes, same seeds)

| configuration | bolt | bulb | valve | peg |
| --- | --- | --- | --- | --- |
| expert (teacher) | 6.00 | 2.40 | 5.00 | 3.00 |
| exact replay of the expert's own tendon plan, open loop | 6.00 | — | — | — |
| transformer plan alone, open loop (policy authority 100 %) | fails in approach | fails | fails | fails |
| transformer plan + solver residual, authority 25 % (**app default**) | **6.00** | **2.40** | **5.00** | **3.00** |
| solver only, authority 0 % | 6.00 | 2.40 | 5.00 | 3.00 |

Reading: the plan is *usable* — replaying the recorded plan through the same
pathway completes the bolt, so the timing/tokenisation are right — but a
regression from the observable state to the tendon command plateaus at ≈0.33σ
(≈1.5 mm) of tendon error, because the expert's command is a function of a
stateful servo (warm-started solve + integral term), not of the instantaneous
observation. Copying that signal well enough to seat a screw is not what the
distillation achieves; what it does achieve, at 25 % authority, is a plan that
shapes the motion while the solver closes the loop. The `policy authority`
slider exposes the split instead of hiding it, and the HUD reports the
three-arm rollout score the worker measures.

Two further engineering facts the ablations pinned down, both now enforced in
code: the plan must be played on the **same clock** it was recorded on (a 63 %
time-base error alone fails the bolt even with the expert's own commands), and
the **phase supervisor must stay contact-driven** — guessing the phase from the
plan index reaches 1.31 of 6 turns where the contact state machine completes
the job.

## 5. App

![the bench, the arm at home, and the five jobs](screenshot-1-home.png)


* `index.html` → `src/app/main.js`; zero dependencies; WebGPU when
  `navigator.gpu` exists, otherwise `FallbackRenderer` (painter-sorted CPU
  rasteriser) — the banner in the HUD says which one is live.
* `src/ui/panels.js` builds sliders, toggles, readouts, charts, heatmaps and the
  task list. Parameter panels cover run/speed, control mode, policy authority,
  IK iterations, winch slew, tendon preload, stiffness, compliance, payload,
  motor limits, disturbance seeds and the training controls.
* Interaction: orbit / pan / zoom, drag the target, click-select a task, run,
  pause, step, reset, single-shot and continuous validation, live charts of bend,
  tension and contact force plus a workspace point cloud.
* `tools/dev-server.mjs` serves the tree on `0.0.0.0:5173`, sets COOP/COEP, and
  exposes `POST /__log` and `GET /__status` (`{ok, booted, recent}`) so the shell
  can report boot diagnostics even when the console is not visible.

### Screenshots are real output

`docs/screenshot-*.png` are produced by `.check/render-shot.mjs`, which runs the
shipped `FallbackRenderer` inside Node against a small software Canvas2D
(`.check/softcanvas.mjs`, ~200 lines: scanline polygon fill, gradient sky,
polyline strokes, circle sprites, PNG writer) and box-filters the 2× supersample
on write. They are the renderer's own pixels, not mock-ups — which is how two
visual bugs were caught that no headless assertion had noticed: `bones()` walked
whole-segment chords while drawing per-cell instances (a straight 1.67 m tower
whose real tip was at 0.59 m), and the fallback's triangle decimation shredded
the lattice truss into slivers. Both are fixed; `.check/rig-check.mjs` now
asserts the drawn chain ends on the kinematic tool (2.5 mm) and that tendon paths
start on the base ring.

### Two builds, one code base

`hardsoftwebgpu.html` is generated by `tools/bundle.mjs`. It is *not* a bundler
transform: every module is embedded as source text and handed to the browser's
own ES-module loader as a blob URL, so `import`/`export` semantics are untouched.
Three things genuinely need the file system and are inlined instead: the two WGSL
shaders, the training worker (a module built from its own blob URL), and
`import.meta.url` (which has no meaning in a blob module). `.check/bundle-test.mjs`
runs the shipped script text in Node with blob URLs mapped to temp files and
boots the app from it — that is how the bundle is verified without a browser.
This matters because the preview environment has been observed to stop the dev
server between sessions; the single file needs no process to survive.

## 6. Verification

```
npm run check:rust              # lib ✅ bin ✅ tests ✅ (WASI toolchain, no wasm shipped)
node --test tests/*.test.mjs    # 6/6 — math, nn oracle, task invariants
node .check/episode.mjs         # 5/5 task acceptance
node .check/apptest.mjs         # boot, HUD, 6 frames, mode + task cycling — ALL OK
node .check/rig-check.mjs       # drawn arm vs. kinematics — 2.5 mm
node .check/render-shot.mjs     # renders docs/screenshot-*.png (≈10 s)
node .check/policy-sweep.mjs    # policy-authority ablation table
```

A real browser run was **not** possible inside the build sandbox (no browser
binary, no system NSS, no CDN); the app-level test above drives the real module
graph through a DOM shim, and the served page was verified over HTTP. The live
preview is the authoritative visual check.
