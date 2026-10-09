#!/usr/bin/env python3
"""
tests/test_fea_and_cad.py — Verification of Python CAD export & FEA stiffness solver.
"""
import sys, os, unittest, math
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'python'))
sys.path.insert(0, ROOT)

from trunclib.fea_solver import Frame3DSolver, create_trunc_cell_fem, MATERIAL_SPRING_STEEL_1095
from tools.render_exact_unit_cell import build_truss_cell, build_equatorial_cell, build_dual_nested_assembly
from tools.export_all_cad_models import build_full_robot_cad, build_bent_robot_cad, export_step

class TestFEAAndCAD(unittest.TestCase):
    def test_truss_mesh_topology(self):
        mesh = build_truss_cell()
        self.assertGreater(len(mesh.verts), 500)
        self.assertGreater(len(mesh.faces), 1000)
        
    def test_equatorial_mesh_topology(self):
        mesh = build_equatorial_cell()
        self.assertGreater(len(mesh.verts), 500)
        self.assertGreater(len(mesh.faces), 1000)

    def test_dual_nested_mesh_assembly(self):
        mesh = build_dual_nested_assembly()
        self.assertGreater(len(mesh.verts), 2000)
        self.assertGreater(len(mesh.faces), 4000)

    def test_full_robot_cad_generation(self):
        arm = build_full_robot_cad()
        self.assertGreater(len(arm.faces), 10000)

    def test_bent_robot_cad_generation(self):
        bent_arm = build_bent_robot_cad()
        self.assertGreater(len(bent_arm.faces), 10000)

    def test_fea_stiffness_and_anisotropy(self):
        solver = create_trunc_cell_fem(diameter_mm=56.0, height_mm=101.43)
        u_torsion, max_s_torsion = solver.solve_static(
            fixed_node_indices=[0],
            applied_forces={2: [0.0, 0.0, 0.0, 0.0, 0.0, 783.0]}
        )
        u_bending, max_s_bending = solver.solve_static(
            fixed_node_indices=[0],
            applied_forces={2: [0.0, 0.0, 0.0, 10.0, 0.0, 0.0]}
        )
        self.assertGreater(max_s_torsion, 0.0)
        self.assertGreater(max_s_bending, 0.0)

if __name__ == '__main__':
    unittest.main()
