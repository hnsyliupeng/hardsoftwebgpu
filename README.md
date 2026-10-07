# Hard–Soft Arm Lab

A browser simulation of the **TRUNC** arm — a truss-flexure soft continuum robot
whose nine tendons are driven from the base and whose joint transmits torque
rigidly (52× torsion/bending) — with five robotic tasks, a learned
inverse-kinematics network and a transformer policy distilled from a scripted
expert. JavaScript plus Rust; no build step, no dependencies, no network.

![home view](docs/screenshot-1-home.png)

## Run it

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
npm run check:rust              # lib ✅ bin ✅ tests ✅ (WASI toolchain; no wasm shipped)
node --test tests/*.test.mjs    # 6/6 — math, nn oracle, task invariants
node .check/episode.mjs         # 5/5 task acceptance, no damage
node .check/apptest.mjs         # boot, HUD, frames, mode + task cycling
node .check/rig-check.mjs       # drawn arm vs. kinematics (2.5 mm)
node .check/render-shot.mjs     # renders docs/screenshot-*.png with the real renderer
node .check/policy-sweep.mjs    # policy-authority ablation table
```

`.check/render-shot.mjs` is worth a note: it runs the app's own `FallbackRenderer`
inside Node against a small software Canvas2D (`softcanvas.mjs`) and writes PNGs,
so the screenshots in `docs/` are produced by the shipped renderer rather than
being mock-ups.

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
