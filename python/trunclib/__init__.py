"""
trunclib — a dependency-free Python simulation of the TRUNC arm.

The arm is the one from *Bridging Hard and Soft: Mechanical Metamaterials Enable
Rigid Torque Transmission in Soft Robots* (Carton et al., arXiv:2412.02650v1) and
from the authors' own code, TransformativeRoboticsLab/TRUNC.

The analyses here are direct ports of the MATLAB scripts the authors shipped:

    reference/matlab/kinematics.m                 stage kinematics + cable model
    reference/matlab/workspace_analysis.m         Fig. 4D  workspace
    reference/matlab/workspace_plot.m             Fig. 4D  workspace plots
    reference/matlab/trajectory_analysis.m        Fig. S9  trajectory tracking
    reference/matlab/repeatability_analysis.m     Fig. 4E/F repeatability
    reference/matlab/plot_cvjoint.m               Fig. S2  constant-velocity joint
    reference/matlab/cross_coupling_analysis.m    Fig. S7  cross-coupling

and they read the authors' own recorded data in `data/trunc/` (copied verbatim
from that repository).
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON_DIR = os.path.dirname(HERE)
ROOT = os.path.dirname(PYTHON_DIR)
DATA = os.path.join(ROOT, 'data', 'trunc')
OUT = os.path.join(PYTHON_DIR, 'out')

__all__ = ['HERE', 'ROOT', 'DATA', 'OUT']
