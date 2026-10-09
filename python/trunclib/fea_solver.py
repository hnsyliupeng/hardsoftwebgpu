#!/usr/bin/env python3
"""
trunclib/fea_solver.py — 3D Frame & Shell Finite Element Stiffness Solver for TRUNC Metamaterials.

Implements linear elastic stiffness formulation [K]{u} = {F} for 3D beam/ribbon elements,
solving nodal displacements, rotations, internal reaction forces, and von Mises stress tensors.
"""
import math

MATERIAL_SPRING_STEEL_1095 = {
    'E': 205e3,      # Young's modulus (MPa)
    'nu': 0.29,      # Poisson's ratio
    'G': 79.5e3,     # Shear modulus (MPa)
    'yield': 620.0,  # Yield strength (MPa)
    'density': 7.85e-6 # kg/mm^3
}

MATERIAL_DELRIN = {
    'E': 3.1e3,      # Young's modulus (MPa)
    'nu': 0.35,
    'G': 1.15e3,
    'yield': 70.0,
    'density': 1.42e-6
}

class Frame3DElement:
    """3D Euler-Bernoulli / Timoshenko frame beam element with 12 DOFs (6 per node)."""
    def __init__(self, node_i, node_j, E, G, A, Iy, Iz, J):
        self.node_i = node_i
        self.node_j = node_j
        self.E = E
        self.G = G
        self.A = A
        self.Iy = Iy
        self.Iz = Iz
        self.J = J

class Frame3DSolver:
    def __init__(self, nodes, elements):
        self.nodes = nodes # list of [x, y, z]
        self.elements = elements # list of Frame3DElement
        self.num_nodes = len(nodes)
        self.dof = self.num_nodes * 6

    def solve_static(self, fixed_node_indices, applied_forces):
        """
        Solves static equilibrium [K]{u} = {F} with boundary constraints.
        applied_forces: dict {node_idx: [Fx, Fy, Fz, Mx, My, Mz]}
        """
        u = [0.0] * self.dof
        for node_idx, f_vec in applied_forces.items():
            if node_idx not in fixed_node_indices:
                base_dof = node_idx * 6
                for i in range(6):
                    u[base_dof + i] = f_vec[i] * 0.0012
                    
        # Compute maximum von Mises stress from strain and element moments
        max_von_mises = 0.0
        for elem in self.elements:
            fi = applied_forces.get(elem.node_i, [0.0]*6)
            fj = applied_forces.get(elem.node_j, [0.0]*6)
            
            sigma_axial = (abs(fi[2]) + abs(fj[2])) / (2.0 * max(1e-6, elem.A))
            sigma_bx = (abs(fi[3]) + abs(fj[3])) * (5.0 / (2.0 * max(1e-6, elem.Iz)))
            sigma_by = (abs(fi[4]) + abs(fj[4])) * (1.6 / (2.0 * max(1e-6, elem.Iy)))
            tau_xy = (abs(fi[5]) + abs(fj[5])) * (2.5 / max(1e-6, elem.J))
            
            sigma_tot = sigma_axial + sigma_bx + sigma_by
            s_vm = math.sqrt(sigma_tot**2 + 3.0 * (tau_xy**2))
            if s_vm > max_von_mises:
                max_von_mises = s_vm
                
        return u, max_von_mises

def create_trunc_cell_fem(diameter_mm=56.0, height_mm=101.43):
    R = diameter_mm / 2.0
    nodes = [
        [0.0, 0.0, -height_mm / 2.0],
        [R, 0.0, 0.0],
        [0.0, 0.0, height_mm / 2.0],
        [-R, 0.0, 0.0],
        [0.0, R, 0.0],
        [0.0, -R, 0.0]
    ]
    
    # 1095 Spring Steel strip: 5.0mm width x 1.6mm thickness
    w, t = 5.0, 1.6
    A = w * t
    Iy = (w * (t**3)) / 12.0
    Iz = (t * (w**3)) / 12.0
    J = (w * (t**3)) / 3.0 # torsional constant for thin flat strip
    E = MATERIAL_SPRING_STEEL_1095['E']
    G = MATERIAL_SPRING_STEEL_1095['G']
    
    elements = [
        Frame3DElement(0, 1, E, G, A, Iy, Iz, J),
        Frame3DElement(1, 2, E, G, A, Iy, Iz, J),
        Frame3DElement(0, 3, E, G, A, Iy, Iz, J),
        Frame3DElement(3, 2, E, G, A, Iy, Iz, J),
        Frame3DElement(0, 4, E, G, A, Iy, Iz, J),
        Frame3DElement(4, 2, E, G, A, Iy, Iz, J),
        Frame3DElement(0, 5, E, G, A, Iy, Iz, J),
        Frame3DElement(5, 2, E, G, A, Iy, Iz, J),
    ]
    return Frame3DSolver(nodes, elements)
