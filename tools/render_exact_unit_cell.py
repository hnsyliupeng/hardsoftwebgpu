#!/usr/bin/env python3
"""
tools/render_exact_unit_cell.py — Exact TRUNC Metamaterial Unit Cell Geometry
Strictly Ported from Carton et al. (Fig. S1, Fig. S3, Fig. S7).
"""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from trunclib.model3d import Mesh, sphere, cylinder
from trunclib.plot import Canvas, Camera, render_mesh
import trunclib.mathx as mx
from trunclib.exact_trunc_geometry import (
    build_exact_equatorial_cell, build_exact_truss_cell, build_exact_dual_nested_assembly
)

def to_view(v):
    # Align Z-up for rendering: [X, Z, -Y]
    return [v[0], v[2], -v[1]]

def build_arrowhead_element():
    """Fig. S1A: Single double-arrowhead auxetic linkage."""
    mesh = Mesh()
    # 4 vertices of double arrowhead: tip, left_wing, center_fold, right_wing
    p_tip = [0.0, 0.0, 24.0]
    p_left = [-20.0, 0.0, -4.0]
    p_fold = [0.0, 0.0, 8.0]
    p_right = [20.0, 0.0, -4.0]
    
    from trunclib.exact_trunc_geometry import make_ribbon_from_path, add_revolute_pin_joint
    for pa, pb in [(p_left, p_tip), (p_tip, p_right), (p_left, p_fold), (p_fold, p_right)]:
        v, f = make_ribbon_from_path([pa, pb], width=3.2, thickness=0.9)
        mesh.add(v, f, 'links_truss')
    
    for pt in (p_tip, p_left, p_fold, p_right):
        add_revolute_pin_joint(mesh, pt, [0, 1, 0], lug_radius=4.5, lug_thick=1.2, pin_radius=1.2, group='links_truss')
    return mesh

def build_equatorial_cell(diameter_mm=88.0, height_mm=88.0):
    return build_exact_equatorial_cell(diameter_mm)

def build_truss_cell(diameter_mm=56.0, height_mm=56.0):
    return build_exact_truss_cell(diameter_mm)

def build_dual_nested_assembly(height_mm=88.0):
    return build_exact_dual_nested_assembly()

def main():
    os.makedirs('docs', exist_ok=True)
    os.makedirs('docs/cad', exist_ok=True)
    
    print("Generating exact TRUNC unit cell CAD previews matching Fig. S1, S3, S7...")
    w_p, h_p = 1000, 800
    canvas = Canvas(w_p, h_p, bg=(255, 255, 255), supersample=1)
    dual = build_exact_dual_nested_assembly()
    verts_v = [to_view(v) for v in dual.verts]
    cam = Camera(eye=[100, 70, 135], target=[0, 0, 0], up=[0, 1, 0], fov_deg=40, width=w_p, height=h_p)
    
    mat_cols = {
        'links_truss': (220, 60, 50),        # Red Inner Truss (Fig. S7A)
        'links_equatorial': (45, 110, 225),  # Blue Outer Equatorial (Fig. S7A)
        'pins': (210, 220, 230),             # Stainless M2 Screws
        'collars': (40, 45, 55),             # Delrin Endcaps
        'shaft': (180, 190, 205),            # Central Steel Flex-Shaft
        'triad': (230, 180, 45),             # Yellow Triad
    }
    
    for grp, f_idxs in dual.groups.items():
        col = mat_cols.get(grp, (150, 150, 150))
        sub = {'verts': verts_v, 'faces': [dual.faces[i] for i in f_idxs]}
        render_mesh(canvas, sub, cam, color=col, light=[0.6, 0.8, -0.7], ambient=0.52)
        
    canvas.text(40, 35, "TRUNC CONCENTRIC DUAL-NESTED METAMATERIAL UNIT CELL (FIG. S1 / FIG. S7)", (20, 30, 50), scale=2)
    canvas.text(40, 65, "Inner M=3 Truss (D=56mm, Red) + Outer M=2 Equatorial (D=88mm, Blue) + 4mm Shaft", (80, 90, 110), scale=1)
    canvas.save_png('docs/unit_cell_exact_paper_structure.png')
    print("Saved docs/unit_cell_exact_paper_structure.png")

if __name__ == '__main__':
    main()
