# Hard–Soft Arm Lab

A browser simulation of the **TRUNC** arm — a truss-flexure soft continuum robot
whose nine tendons are driven from the base and whose joint transmits torque
rigidly (52× torsion/bending) — with five robotic tasks, a learned
inverse-kinematics network and a transformer policy distilled from a scripted
expert. JavaScript plus Rust; no build step, no dependencies, no network.

![home view](docs/screenshot-1-home.png)

## Run it — local Node.js (no install, no build)

Requires Node >= 18 and nothing else (zero dependencies).

```bash
node run.mjs                     # serve the browser app → open http://localhost:5173
node run.mjs --open              # ... and open a browser window
node run.mjs --port 8080         # ... on another port
node run.mjs --terminal          # run the simulation in this terminal (no browser)
node run.mjs --all               # all five jobs, table output
node run.mjs --train             # train the IK network + transformer, print scores
node run.mjs --selftest          # acceptance + training smoke test (exit code for CI)
node run.mjs --bundle            # build the single-file runner below
```

`hardsoftwebgpu-node.mjs` is the **same runner with the whole app embedded**
(304 kB, 20 files) — copy it anywhere and run it with no repository around it:

```bash
node hardsoftwebgpu-node.mjs --terminal --task 2 --seconds 40
node hardsoftwebgpu-node.mjs --all
node hardsoftwebgpu-node.mjs --help
```

## Run it — browser

Two ways, both offline:

**1. Single file (no server).** `hardsoftwebgpu.html` is the whole lab in one
288 kB file — every module inlined, no imports, no fetches. Open it directly in a
browser (`file://` is fine), or rebuild it after editing anything:

```bash
npm run bundle       # → hardsoftwebgpu.html
```

**2. Served.** `npm start` runs the zero-dependency dev server on
`http://0.0.0.0:5173`, which also exposes `POST /__log` and `GET /__status` for
headless diagnostics. Open the printed URL.

 WebGPU is used when the browser has it; otherwise the app
falls back to its own CPU rasteriser (the HUD badge says which is live), and it
also self-heals to the rasteriser if a GPU context initialises but draws
nothing. `?render=cpu` forces the software path.

## What is in the box

| area | files | notes |
| --- | --- | --- |
| plant | `src/core/{metamaterial,arm,physics}.js` | 3 segments × 3 printed cells, 9 tendons, 45°/joint, 710 mm reach; damped-least-squares inverse kinematics over the cable space, load-compensated, warm started |
| tasks | `src/engine/tasks.js`, `src/core/physics.js` | bolt, bulb, valve, peg and a two-stage assembly; contact-driven phase supervisor with bounded wrenches |
| learners | `src/workers/trainers.js`, `src/workers/sim.worker.js` | MLP inverse kinematics (1.6 mm rms tendon error) and a causal chunk transformer distilled from expert episodes; both train in a worker |
| engine | `src/engine/robot.js` | expert / learned / manual modes, receding-horizon transformer rollout, telemetry, trail, metrics |
| GPU | `src/gpu/` | hand-written WGSL scene + post passes, orbit camera; CPU rasteriser fallback for browsers without WebGPU |
| GUI | `index.html`, `src/app/hud.js`, `src/ui/panels.js` | mode, policy authority, IK iterations, winch slew, tendon preload, stiffness, compliance, payload, motor limits, seeds, single-shot **and continuous** validation, live charts and heatmaps |
| Rust | `rust/trunc_core/` | the same constants, chord model, MLP arithmetic and the `trunc_state`/`trunc_task_state` FFI layout; `trunc_cli layout` is the layout's source of truth |

## Interaction

* orbit / pan / zoom with the mouse; `shift`+click the scene to move the tool
  target in manual mode
* pick any of the five jobs from the task list; two-stage jobs auto-advance
* `train policy (worker)` distils the expert and installs the transformer;
  `validate` runs repeated single-shot trials per job and toasts the
  pass rate, turns and peak force (dense tooltip text, short button label)
* `policy authority` blends the transformer plan against the IK solver — see
  `docs/design.md` for the measured ablation behind its default

## Verify

```bash
npm run check:rust                     # lib ✅ bin ✅ tests ✅ (WASI toolchain; no wasm shipped)
node --test tests/*.test.mjs           # 14/14 — arm maths, nn oracle, task invariants, the port's unit checks
node .check/trunc-port.mjs             # 20/20 — the port against hand-computed MATLAB values
node .check/cpu-app.mjs                # 14/14 — the CPU page: boots, draws, verifies, replays
node .check/apptest.mjs                # boot, HUD, frames, mode + task cycling, the port panel, 44/44 checks
node .check/episode.mjs                # 5/5 task acceptance, no damage
node .check/rig-check.mjs              # drawn arm vs. kinematics (2.5 mm)
node .check/bundle-test.mjs            # the single-file build boots and renders
node .check/render-shot.mjs            # renders docs/screenshot-*.png with the real renderer
node .check/policy-sweep.mjs           # policy-authority ablation table
```

`src/app/matlabPort.js` holds the port's 44-row verification table — the same
table the CPU page's **run all checks** button prints, the WebGPU page's
**verify port** button prints and `node run.mjs --port` prints.

`.check/render-shot.mjs` is worth a note: it runs the app's own `FallbackRenderer`
inside Node against a small software Canvas2D (`softcanvas.mjs`) and writes PNGs,
so the screenshots in `docs/` are produced by the shipped renderer rather than
being mock-ups.

## Two front ends, one plant

| page | renderer | what it is for |
| --- | --- | --- |
| `index.html` | WebGPU (WGSL shaders, MSAA, shadows) with a Canvas2D fallback | the app: five jobs, the transformer planner, training, the full GUI |
| `cpu.html` | `tools/raster.js` — a software rasteriser, **no GPU at all** | the CPU reference: the same ported MATLAB plant, plus a button that runs all 44 port checks in the page |

Both pages import `src/app/matlabPort.js` (the simulation) and
`src/app/portScene.js` (the drawing), so the CPU page is not a mock-up of the
WebGPU page — it is the same replay with a different rasteriser. `docs/trunc-animation.gif`
is that drawing encoded to GIF by `tools/make-gif.mjs`.

The WebGPU page has a **MATLAB port** panel: switch it on and the ported replay
replaces the engine arm, drawn by the GPU renderer, with its own task list,
parameter sliders and a *verify port* button that runs the whole check table.

```bash
node run.mjs            # serves both pages and prints their URLs
#   WebGPU page  → http://localhost:5173/
#   CPU page     → http://localhost:5173/cpu.html
node run.mjs --port     # headless: every ported module + a replay of all five tasks
```

## MATLAB port (TRUNC) — TypeScript / JavaScript

`ts/trunc/` is a line-by-line port of the TRUNC repository's MATLAB (`training/`
and `matlab/`): the constant-curvature forward kinematics and cable-triangle
geometry, the five trajectory generators, the waypoint densifier that
`interp_waypoints.m` never shipped, the servo/rigid-body wrappers and the
cross-coupling / efficiency / CV-joint analysis scripts. `ts/sim/` adds the
damped-least-squares inverse solver, the calibrated per-task placements and the
replay animation that mirrors `follow_trajectory.m` — servo rate limit, 0.5 s
pauses, tool-motor pulses and the 15-sample pose average included.

```bash
node --disable-warning=ExperimentalWarning tools/ts-emit.mjs   # ts/** -> js/**
node .check/trunc-port.mjs        # 14/14: kinematics, placement, animation
node .check/trunc-calibrate.mjs   # re-run the task-placement search
```

`tools/make-gif.mjs` draws that animation with a dependency-free software
rasteriser (`tools/raster.js` — depth buffer, truss tube, tendons, guides, 3x5
font) and encodes it with a hand-written GIF89a encoder (`tools/gif.js` —
median-cut palette, LZW, Netscape loop): no browser, no packages.

```bash
node --disable-warning=ExperimentalWarning tools/make-gif.mjs
node ... tools/make-gif.mjs --task=bulb --frames=6 --still=3   # one task, PNG
# -> docs/trunc-animation.gif: the five tasks, 720x540, with a results card
```

## Honest status

* The learned **inverse kinematics** fits well (1.6 mm rms vs 5.6 mm for the mean
  predictor) and is used as the feed-forward term in `learned` mode.
* The **transformer policy** shapes the motion: its plan is re-solved every
  control step from the measured state. The plan *alone* does not seat a screw —
  it plateaus at ≈1.5 mm of tendon error, because the expert's action depends on a
  stateful servo, not on the instantaneous observation. That is why the app runs
  at 25 % policy authority with the solver closing the loop, and why the worker
  reports a three-arm ablation instead of a single number.
* `docs/design.md` records the constants, the ablations, and what has not been
  proven. A real browser session was not available in the build sandbox; the
  screenshots come from the shipped renderer driven headlessly, and the live
  preview is the authoritative visual check.
