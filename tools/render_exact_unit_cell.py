#!/usr/bin/env python3
"""
tools/render_exact_unit_cell.py — Accurate TRUNC metamaterial unit cells matching the paper:
  - Fig. S1A: Double-arrowhead auxetic linkage element
  - Fig. S1C / Fig. 3: M=3 Truss unit cell (D=56mm, 2 rows of arrowheads + equator)
  - Fig. S1B / Fig. 2A: M=2 Equatorial unit cell (D=88mm, 1 row of arrowheads at equator)
  - Concentric dual-nested unit cell assembly (Truss nested inside Equatorial + Guide Triad)
"""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from trunclib.model3d import Mesh, sphere, cylinder, ring
from trunclib.plot import Canvas, Camera, render_mesh
import trunclib.mathx as mx
from trunclib.metamaterial import solve_unit_cell_pose, cell_layout, LINK, MOLD_DIAMETER_MM

colors = {
    'spring_steel': (45, 115, 220),       # Blue 1095 Spring Steel
    'equatorial_steel': (230, 130, 45),   # Copper/Orange Spring Steel
    'pins': (210, 220, 235),              # Silver M2 Screws & Pins
    'delrin': (35, 40, 50),               # Dark Grey/Black Delrin Collar Hubs
    'spring': (140, 185, 210),            # Steel Blue Spring Wire
    'shaft': (185, 195, 205),             # Polished 4mm Steel Rod
    'triad': (235, 195, 65),              # Gold/Yellow Anodized Triad Guide
}

def to_view(p):
    """Map CAD world coordinates (X, Y, Z-downwards) to Camera view coordinates."""
    return [p[0], -p[2], p[1]]

def build_arrowhead_element(width=30.0, height=50.0):
    """Single double-arrowhead planar auxetic unit linkage (Fig. S1A)."""
    mesh = Mesh()
    w_half = width / 2.0
    h_half = height / 2.0
    indent = width * 0.35
    
    nodes = [
        [0.0, 0.0, -h_half],           # 0: bottom apex
        [w_half, 0.0, -h_half * 0.3],   # 1: right lower shoulder
        [indent, 0.0, 0.0],            # 2: right waist indent
        [w_half, 0.0, h_half * 0.3],    # 3: right upper shoulder
        [0.0, 0.0, h_half],            # 4: top apex
        [-w_half, 0.0, h_half * 0.3],   # 5: left upper shoulder
        [-indent, 0.0, 0.0],           # 6: left waist indent
        [-w_half, 0.0, -h_half * 0.3],  # 7: left lower shoulder
    ]
    
    edges = [(0,1), (1,2), (2,3), (3,4), (4,5), (5,6), (6,7), (7,0)]
    for a, b in edges:
        v, f = cylinder(nodes[a], nodes[b], 1.6, seg=8)
        mesh.add(v, f, 'links')
        
    for p in nodes:
        v, f = sphere(p, 2.5, useg=10, vseg=5)
        mesh.add(v, f, 'pins')
        
    return mesh

def build_truss_cell(diameter_mm=56.0, height_mm=101.43):
    """
    M=3 Truss Metamaterial Unit Cell (Fig. S1C / Prototype Photo).
    Diameter D=56mm, Height H=101.43mm.
    Features 16 double-arrowhead chevrons (2 rows on each side of equator),
    M2 revolute screw pins, Delrin mounting collars, 6655K47 bearings,
    central 4mm steel torque shaft, and conical restoring spring.
    """
    T_low = [[1,0,0,0], [0,1,0,0], [0,0,1,-height_mm/2.0], [0,0,0,1]]
    T_high = [[1,0,0,0], [0,1,0,0], [0,0,1,height_mm/2.0], [0,0,0,1]]
    pose = solve_unit_cell_pose(T_low, T_high, kind='truss', ballR=diameter_mm/2.0)
    
    mesh = Mesh()
    H_half = height_mm / 2.0
    
    # 1. Central 4mm Steel Torque Shaft
    v_s, f_s = cylinder([0, 0, -H_half], [0, 0, H_half], 2.0, seg=12)
    mesh.add(v_s, f_s, 'shaft')
    
    # 2. Delrin Mounting Collars at Top and Bottom
    v_cb, f_cb = cylinder([0, 0, -H_half], [0, 0, -H_half + 12.0], 18.0, seg=16)
    mesh.add(v_cb, f_cb, 'collars')
    v_ct, f_ct = cylinder([0, 0, H_half - 12.0], [0, 0, H_half], 18.0, seg=16)
    mesh.add(v_ct, f_ct, 'collars')
    
    # Bearing rings
    v_b1, f_b1 = cylinder([0, 0, -H_half + 2.0], [0, 0, -H_half + 8.0], 5.0, seg=12)
    mesh.add(v_b1, f_b1, 'pins')
    v_b2, f_b2 = cylinder([0, 0, H_half - 8.0], [0, 0, H_half - 2.0], 5.0, seg=12)
    mesh.add(v_b2, f_b2, 'pins')
    
    # 3. Conical Restoring Spring (5 coils)
    spring_pts = []
    n_steps = 60
    n_coils = 5
    H_sp = height_mm - 24.0
    for s in range(n_steps + 1):
        frac = s / float(n_steps)
        th = frac * n_coils * 2 * math.pi
        r_sp = 6.0 + 8.0 * math.sin(frac * math.pi)
        z_sp = (frac - 0.5) * H_sp
        spring_pts.append([r_sp * math.cos(th), r_sp * math.sin(th), z_sp])
    for s in range(n_steps):
        v_sp, f_sp = cylinder(spring_pts[s], spring_pts[s+1], 1.2, seg=6)
        mesh.add(v_sp, f_sp, 'spring')
        
    # 4. 16 Double-Arrowhead Chevrons (Spring Steel 1095)
    t_strip = 1.6
    for ch in pose['chevrons']:
        # strut a -> fold
        v_a, f_a = cylinder(ch['a'], ch['fold'], t_strip, seg=6)
        mesh.add(v_a, f_a, 'links_truss')
        # strut fold -> b
        v_b, f_b = cylinder(ch['fold'], ch['b'], t_strip, seg=6)
        mesh.add(v_b, f_b, 'links_truss')
        
        # M2 Screw pin at fold
        v_p, f_p = sphere(ch['fold'], 2.0, useg=8, vseg=4)
        mesh.add(v_p, f_p, 'pins')
        
    # Pole pins and equator pins
    for p in pose['ringTop'] + pose['ringBot'] + pose['equator']:
        v_p, f_p = sphere(p, 1.8, useg=8, vseg=4)
        mesh.add(v_p, f_p, 'pins')

    # Equatorial Ring
    R_eq = diameter_mm / 2.0
    ring_pts = []
    for s in range(24):
        ang = s * (2 * math.pi / 24)
        ring_pts.append([R_eq * math.cos(ang), R_eq * math.sin(ang), 0.0])
    for s in range(24):
        v_r, f_r = cylinder(ring_pts[s], ring_pts[(s+1)%24], 1.6, seg=6)
        mesh.add(v_r, f_r, 'links_truss')

    return mesh

def build_equatorial_cell(diameter_mm=88.0, height_mm=101.43):
    """
    M=2 Equatorial Metamaterial Unit Cell (Fig. S1B / Fig. 2A).
    Diameter D=88mm, Height H=101.43mm.
    8 chevrons meeting at equator, equatorial hoop ring,
    top/bottom mounting collars, central 4mm shaft, conical restoring spring,
    and M2 revolute screws.
    """
    T_low = [[1,0,0,0], [0,1,0,0], [0,0,1,-height_mm/2.0], [0,0,0,1]]
    T_high = [[1,0,0,0], [0,1,0,0], [0,0,1,height_mm/2.0], [0,0,0,1]]
    pose = solve_unit_cell_pose(T_low, T_high, kind='equatorial', ballR=diameter_mm/2.0)
    
    mesh = Mesh()
    H_half = height_mm / 2.0
    
    # 1. Central 4mm Steel Torque Shaft
    v_s, f_s = cylinder([0, 0, -H_half], [0, 0, H_half], 2.0, seg=12)
    mesh.add(v_s, f_s, 'shaft')
    
    # 2. Delrin Mounting Collars at Top and Bottom
    v_cb, f_cb = cylinder([0, 0, -H_half], [0, 0, -H_half + 12.0], 19.0, seg=16)
    mesh.add(v_cb, f_cb, 'collars')
    v_ct, f_ct = cylinder([0, 0, H_half - 12.0], [0, 0, H_half], 19.0, seg=16)
    mesh.add(v_ct, f_ct, 'collars')
    
    # 3. Conical Restoring Spring
    spring_pts = []
    n_steps = 60
    n_coils = 5
    H_sp = height_mm - 24.0
    for s in range(n_steps + 1):
        frac = s / float(n_steps)
        th = frac * n_coils * 2 * math.pi
        r_sp = 7.0 + 9.0 * math.sin(frac * math.pi)
        z_sp = (frac - 0.5) * H_sp
        spring_pts.append([r_sp * math.cos(th), r_sp * math.sin(th), z_sp])
    for s in range(n_steps):
        v_sp, f_sp = cylinder(spring_pts[s], spring_pts[s+1], 1.2, seg=6)
        mesh.add(v_sp, f_sp, 'spring')
        
    # 4. 8 Equatorial Chevrons
    t_strip = 1.6
    for ch in pose['chevrons']:
        v_a, f_a = cylinder(ch['a'], ch['fold'], t_strip, seg=6)
        mesh.add(v_a, f_a, 'links_equatorial')
        v_b, f_b = cylinder(ch['fold'], ch['b'], t_strip, seg=6)
        mesh.add(v_b, f_b, 'links_equatorial')
        
        v_p, f_p = sphere(ch['fold'], 2.2, useg=8, vseg=4)
        mesh.add(v_p, f_p, 'pins')
        
    for p in pose['ringTop'] + pose['ringBot']:
        v_p, f_p = sphere(p, 2.0, useg=8, vseg=4)
        mesh.add(v_p, f_p, 'pins')
        
    # Equatorial Hoop Ring (D=88mm)
    R_eq = diameter_mm / 2.0
    ring_pts = []
    for s in range(32):
        ang = s * (2 * math.pi / 32)
        ring_pts.append([R_eq * math.cos(ang), R_eq * math.sin(ang), 0.0])
    for s in range(32):
        v_r, f_r = cylinder(ring_pts[s], ring_pts[(s+1)%32], 2.0, seg=6)
        mesh.add(v_r, f_r, 'links_equatorial')

    return mesh

def build_dual_nested_assembly(height_mm=101.43):
    """
    Concentric Dual-Nested TRUNC Unit Cell Assembly:
    Inner M=3 Truss cell (D=56mm) nested concentrically inside
    Outer M=2 Equatorial cell (D=88mm), with shared top/bottom Delrin collar hubs,
    continuous central 4mm steel torque shaft, conical restoring spring,
    and 3-arm rigid tendon guide triad (R=65mm).
    """
    mesh = Mesh()
    H_half = height_mm / 2.0
    
    truss = build_truss_cell(56.0, height_mm)
    mesh.add(truss.verts, truss.faces, 'truss_assembly')
    
    eq = build_equatorial_cell(88.0, height_mm)
    mesh.add(eq.verts, eq.faces, 'equatorial_assembly')
    
    # 3-Arm Tendon Guide Triad (R=65mm) clamped to bottom collar hub
    p_center = [0.0, 0.0, -H_half]
    for arm_idx in range(3):
        ang = arm_idx * (2 * math.pi / 3)
        p_tip = [65.0 * math.cos(ang), 65.0 * math.sin(ang), -H_half]
        v_arm, f_arm = cylinder(p_center, p_tip, 3.8, seg=8)
        mesh.add(v_arm, f_arm, 'triad')
        v_eye, f_eye = sphere(p_tip, 5.2, useg=10, vseg=6)
        mesh.add(v_eye, f_eye, 'triad')
        v_hole, f_hole = cylinder([p_tip[0], p_tip[1], -H_half - 4.0], [p_tip[0], p_tip[1], -H_half + 4.0], 1.5, seg=8)
        mesh.add(v_hole, f_hole, 'pins')
        
    return mesh

def main():
    os.makedirs('docs', exist_ok=True)
    os.makedirs('docs/cad', exist_ok=True)
    
    print("Generating TRUNC unit cell CAD previews...")
    
    w_p, h_p = 1000, 800
    canvas = Canvas(w_p, h_p, bg=(255, 255, 255), supersample=2)
    dual = build_dual_nested_assembly()
    verts_v = [to_view(v) for v in dual.verts]
    cam = Camera(eye=[110, 80, 150], target=[0, 0, 0], up=[0, 1, 0], fov_deg=40, width=w_p, height=h_p)
    
    render_mesh(canvas, {'verts': verts_v, 'faces': dual.faces}, cam, color=(80, 140, 220), light=[0.6, 0.8, -0.7], ambient=0.52)
    canvas.text(40, 35, "TRUNC CONCENTRIC DUAL-NESTED METAMATERIAL UNIT CELL", (20, 30, 50), scale=2)
    canvas.text(40, 65, "Inner Truss D=56mm (M=3) + Outer Equatorial D=88mm (M=2) + Guide Triad (R=65mm)", (80, 90, 110), scale=1)
    canvas.save_png('docs/unit_cell_exact_paper_structure.png')
    print("Saved docs/unit_cell_exact_paper_structure.png")

if __name__ == '__main__':
    main()
