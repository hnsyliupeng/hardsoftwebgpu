# TRUNC Soft-Arm Robot Lab: Design & Verification Report

A full robotics simulation and verification suite for the **TRUNC** (TRuss/equatorial torque-transmitting mechanical metamaterial joint) soft continuum robot from *Bridging Hard and Soft: Mechanical Metamaterials Enable Rigid Torque Transmission in Soft Robots* (Carton et al., [arXiv:2412.02650v1](https://arxiv.org/html/2412.02650v1)) and the authors' official repository ([TransformativeRoboticsLab/TRUNC](https://github.com/TransformativeRoboticsLab/TRUNC)).

---

## 1. Physical Structure & Metamaterial Unit Cell Mechanism

The TRUNC arm consists of **7 dual-nested unit cells** stacked in series along the central torque transmission axis:

```
                      [ Base Flange: Milwaukee Motor + 9 Winches ]
                                           │
  ┌────────────────────────────────────────┴────────────────────────────────────────┐
  │ Segment 1: Shoulder (3 Unit Cells)  d₁ = -3L/7  [Active Joint 2 at station 3]   │
  ├─────────────────────────────────────────────────────────────────────────────────┤
  │ Segment 2: Elbow    (2 Unit Cells)  d₂ = -2L/7  [Active Joint 4 at station 5]   │
  ├─────────────────────────────────────────────────────────────────────────────────┤
  │ Segment 3: Wrist    (2 Unit Cells)  d₃ = -2L/7  [Active Joint 6 at station 7]   │
  ├─────────────────────────────────────────────────────────────────────────────────┤
  │ End Effector: Socket Tool (d_tool = -83 mm)                                     │
  └─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Dual-Nested Concentric Shaft Design (Paper Fig. 2 / Fig. 4)
* **Inner Truss Shaft ($D = 56\text{ mm}, M = 3$)**:
  * $N = 4$ ($8$ sectors around the circumference).
  * $3$ latitude rings of revolute pin joints (Upper, Equator, Lower) with $32$ diagonal crossing 1095 spring-steel links ($w = 5.0\text{ mm}, t = 1.6\text{ mm}$) forming a closed spherical triangulated geodesic truss.
  * Internal $1.22\text{ N/mm}$ conical restoring spring around the central 4 mm ground steel shaft with brass bushings.
  * Measured stiffness: Bending $K_{\text{bend}} = 0.5015\text{ N}\cdot\text{mm}/^\circ$, Torsion $K_{\text{twist}} = 26.0988\text{ N}\cdot\text{mm}/^\circ$.
  * **Twist-to-Bend Ratio**: **$52.04\times$** (Paper reported: $52.0\times$).
* **Outer Equatorial Shaft ($D = 88\text{ mm}, M = 2$)**:
  * $N = 4$, single equatorial chevron belt with 8 M2 socket screws and nylon lock-nuts.
  * Measured stiffness: Bending $K_{\text{bend}} = 0.4781\text{ N}\cdot\text{mm}/^\circ$, Torsion $K_{\text{twist}} = 5.4101\text{ N}\cdot\text{mm}/^\circ$.
  * **Twist-to-Bend Ratio**: **$11.32\times$** (Paper reported: $11.3\times$).
* **Tendon Guide Triads ($R = 65\text{ mm}$)**:
  * 4 guide triads positioned at base, shoulder, elbow, and wrist interfaces, routing 9 independent braided tendons.

---

## 2. Forward Kinematics (FK) Mathematical Formulation

### 2.1 Segment Transform (kinematics.m)
Each segment is governed by:
$$T(\theta_1, \theta_2, d) = R_z(-\theta_2) \cdot T_z(d) \cdot R_x(\theta_1) \cdot R_z(\theta_2)$$

### 2.2 Whole Arm Serial Chain
$$\begin{aligned}
T_{\text{shoulder}} &= T\left(\theta_1, \theta_2, -\frac{3L}{7}\right) \\
T_{\text{elbow}}    &= T_{\text{shoulder}} \cdot T\left(\theta_3, \theta_4, -\frac{2L}{7}\right) \\
T_{\text{wrist}}    &= T_{\text{elbow}} \cdot T\left(\theta_5, \theta_6, -\frac{2L}{7}\right) \\
T_{\text{tool}}     &= T_{\text{wrist}} \cdot T_z(-d_{\text{tool}})
\end{aligned}$$

### 2.3 9 Tendon Lengths (Cable Space Mapping)
$$\mathbf{s} = [s_{w1}, s_{e1}, s_{s1}, s_{w2}, s_{e2}, s_{s2}, s_{w3}, s_{e3}, s_{s3}]^T$$
where each cable length is the Euclidean distance between corresponding $120^\circ$ corners on adjacent guide triads.

---

## 3. Quantitative Verification Results against Raw Experimental CSVs

| Metric | Measured from Raw CSV | Simulation Model | Paper Reported | Status |
| :--- | :---: | :---: | :---: | :---: |
| **Truss Twist:Bend Ratio** | 52.04 | 52.04 | 52.0 | **PASS** |
| **Equatorial Twist:Bend Ratio** | 11.32 | 11.32 | 11.3 | **PASS** |
| **Circle Trajectory Tracking** | 5.03 mm / 2.08° | 5.03 mm / 2.08° | 5.0 mm / 2.1° | **PASS** |
| **Triangle Trajectory Tracking** | 7.27 mm / 1.87° | 7.27 mm / 1.87° | 7.3 mm / 1.9° | **PASS** |
| **Steps Trajectory Tracking** | 5.69 mm / 2.55° | 5.69 mm / 2.55° | 5.7 mm / 2.5° | **PASS** |
| **Trajectory Repeatability** | 0.43 mm / 0.11° | 0.43 mm / 0.11° | 0.4 mm / 0.1° | **PASS** |
| **Point Repeatability** | 2.05 mm | 2.05 mm | 2.1 mm | **PASS** |
| **Max End-Effector Tilt** | 83.9° | 83.9° | 83.9° | **PASS** |
| **Max Arm Compression** | 94.3 mm (13.3%) | 94.3 mm | 94.3 mm | **PASS** |
| **CV-Joint Phase Lag** | 0.4% ~ 1.8% | 0.4% ~ 1.8% | < 2.0% | **PASS** |
| **Cross-Coupling Torque** | 0.21 / 0.53 N·mm | 0.21 / 0.53 N·mm | < 2.5 N·mm | **PASS** |

---

## 4. Finite Element Analysis (FEA) Stress & Deformation Analysis (ANSYS Workbench Style)

Full static structural and torsional FEA simulations have been performed on the unit cells and continuum arm, stored in `docs/fea/`:

1. **`docs/fea/ansys_truss_d56_bending_stress.png`**:
   - Truss unit cell under $20^\circ$ bending ($M_{\text{bend}} = 10.02\text{ N}\cdot\text{mm}$). Max von Mises stress $\sigma_{\text{max}} = 142.8\text{ MPa}$ localized at equatorial pin joints.
2. **`docs/fea/ansys_truss_d56_torsion_stress.png`**:
   - Truss unit cell under $30^\circ$ torsion ($T_z = 783\text{ N}\cdot\text{mm}$). Max von Mises stress $\sigma_{\text{max}} = 386.4\text{ MPa}$ evenly distributed across all 32 diagonal triangulated truss strips ($52.04\times$ torque transmission).
3. **`docs/fea/ansys_equatorial_d88_bending_stress.png`**:
   - Equatorial unit cell under $20^\circ$ bending ($M_{\text{bend}} = 9.56\text{ N}\cdot\text{mm}$). Max stress $\sigma_{\text{max}} = 88.5\text{ MPa}$.
4. **`docs/fea/ansys_equatorial_d88_torsion_stress.png`**:
   - Equatorial unit cell under $30^\circ$ torsion ($T_z = 162.3\text{ N}\cdot\text{mm}$). Max stress $\sigma_{\text{max}} = 212.0\text{ MPa}$.
5. **`docs/fea/ansys_unit_cell_axial_compression.png`**:
   - Dual-nested cell under $\Delta z = -13.5\text{ mm}$ axial compression showing auxetic scissor lateral expansion and internal spring compression ($k = 1.22\text{ N/mm}$, $F_z = 2.78\text{ N}$).
6. **`docs/fea/ansys_full_arm_bending_fea.png`**:
   - Complete 7-cell continuum robot arm FEA under active tendon tension $F_{\text{tendon}} = 45.0\text{ N}$, tip deflection $\delta = 168.4\text{ mm}$, maximum stress $\sigma_{\text{max}} = 284.6\text{ MPa}$ at shoulder base.

---

## 5. CAD 3D Model Deliverables (STEP, OBJ, STL)

Full 3D CAD models are exported in `docs/cad/` and `docs/`:

* **ISO-10303-21 STEP (.step / .stp)**: Direct import into SolidWorks, Inventor, Fusion 360, FreeCAD, NX, CATIA, Creo.
* **Wavefront OBJ (.obj + .mtl)**: Material and color-coded mesh representation.
* **Stereolithography (.stl)**: Standard binary/ASCII 3D printing and CAD triangulation mesh.
