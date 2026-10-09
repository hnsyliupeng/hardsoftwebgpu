#!/usr/bin/env python3
"""
trunclib/exact_trunc_geometry.py — Exact Analytical Spherical Double-Arrowhead
Metamaterial Geometry for TRUNC Soft Continuum Robot (Carton et al., Fig. S1, S3, S7).
"""

import math
from trunclib.model3d import Mesh, sphere, cylinder
import trunclib.mathx as mx

def make_spherical_arc_ribbon(p_start, p_end, center, R, width=3.2, thickness=0.8, n_sub=12):
    """Generates a curved flat ribbon lying on a sphere of radius R between p_start and p_end."""
    verts = []
    faces = []
    
    v0 = [p_start[i] - center[i] for i in range(3)]
    v1 = [p_end[i] - center[i] for i in range(3)]
    len0 = math.sqrt(sum(c*c for c in v0)) or R
    len1 = math.sqrt(sum(c*c for c in v1)) or R
    u0 = [c / len0 for c in v0]
    u1 = [c / len1 for c in v1]
    
    dot = max(-1.0, min(1.0, sum(u0[i] * u1[i] for i in range(3))))
    total_ang = math.acos(dot)
    if total_ang < 1e-4:
        return verts, faces
        
    axis = [
        u0[1]*u1[2] - u0[2]*u1[1],
        u0[2]*u1[0] - u0[0]*u1[2],
        u0[0]*u1[1] - u0[1]*u1[0]
    ]
    ax_len = math.sqrt(sum(c*c for c in axis)) or 1.0
    axis = [c / ax_len for c in axis]
    
    w_half = width / 2.0
    t_half = thickness / 2.0
    ring_stride = 4
    
    for s in range(n_sub + 1):
        frac = s / float(n_sub)
        ang = frac * total_ang
        cos_a = math.cos(ang)
        sin_a = math.sin(ang)
        dot_ax = sum(axis[i] * u0[i] for i in range(3))
        cross_ax = [
            axis[1]*u0[2] - axis[2]*u0[1],
            axis[2]*u0[0] - axis[0]*u0[2],
            axis[0]*u0[1] - axis[1]*u0[0]
        ]
        u_t = [
            u0[i] * cos_a + cross_ax[i] * sin_a + axis[i] * dot_ax * (1.0 - cos_a)
            for i in range(3)
        ]
        
        lat = [
            u_t[1]*axis[2] - u_t[2]*axis[1],
            u_t[2]*axis[0] - u_t[0]*axis[2],
            u_t[0]*axis[1] - u_t[1]*axis[0]
        ]
        lat_len = math.sqrt(sum(c*c for c in lat)) or 1.0
        lat = [c / lat_len for c in lat]
        rad = u_t
        
        # Radius along interpolation (allows spherical blending)
        R_s = len0 * (1.0 - frac) + len1 * frac
        p_mid = [center[i] + u_t[i] * R_s for i in range(3)]
        
        p_ol = [p_mid[i] + lat[i]*w_half + rad[i]*t_half for i in range(3)]
        p_or = [p_mid[i] - lat[i]*w_half + rad[i]*t_half for i in range(3)]
        p_il = [p_mid[i] + lat[i]*w_half - rad[i]*t_half for i in range(3)]
        p_ir = [p_mid[i] - lat[i]*w_half - rad[i]*t_half for i in range(3)]
        verts.extend([p_ol, p_or, p_il, p_ir])
        
    for s in range(n_sub):
        base0 = s * ring_stride
        base1 = (s + 1) * ring_stride
        faces.append([base0 + 0, base1 + 0, base1 + 1])
        faces.append([base0 + 0, base1 + 1, base0 + 1])
        faces.append([base0 + 2, base1 + 3, base1 + 2])
        faces.append([base0 + 2, base0 + 3, base1 + 3])
        faces.append([base0 + 0, base1 + 2, base1 + 0])
        faces.append([base0 + 0, base0 + 2, base1 + 2])
        faces.append([base0 + 1, base1 + 1, base1 + 3])
        faces.append([base0 + 1, base1 + 3, base0 + 3])
        
    return verts, faces

def add_revolute_joint_boss(mesh, center_pt, normal_dir, boss_radius=4.5, boss_thick=2.0, pin_radius=1.1, group='boss'):
    norm = math.sqrt(sum(c*c for c in normal_dir)) or 1.0
    n = [c / norm for c in normal_dir]
    p_top = [center_pt[i] + n[i] * (boss_thick / 2.0) for i in range(3)]
    p_bot = [center_pt[i] - n[i] * (boss_thick / 2.0) for i in range(3)]
    
    vb, fb = cylinder(p_bot, p_top, boss_radius, seg=16)
    mesh.add(vb, fb, group)
    
    p_pin1 = [center_pt[i] + n[i] * (boss_thick / 2.0 + 1.2) for i in range(3)]
    p_pin0 = [center_pt[i] - n[i] * (boss_thick / 2.0 + 1.2) for i in range(3)]
    vp, fp = cylinder(p_pin0, p_pin1, pin_radius, seg=12)
    mesh.add(vp, fp, 'pins')

def rot_x_pt(pt, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    return [pt[0], pt[1]*ca - pt[2]*sa, pt[1]*sa + pt[2]*ca]

def rot_z_pt(pt, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    return [pt[0]*ca - pt[1]*sa, pt[0]*sa + pt[1]*ca, pt[2]]

def build_exact_equatorial_cell(diameter_mm=88.0, center=[0,0,0], bend_deg=0.0, twist_deg=0.0):
    """
    Exact Equatorial TRUNC Cell (N=4, M=2, Fig. S1B / Fig. S3A / Fig. S7A):
    - Radius R = diameter / 2 = 44mm.
    - Top Pole: [0, 0, +R], Bottom Pole: [0, 0, -R].
    - Equator: 8 Joint Bosses at [R*cos(k*45°), R*sin(k*45°), 0].
    - 4 Upper Ribbons: Top Pole -> Equatorial Nodes 0, 2, 4, 6 (0°, 90°, 180°, 270°).
    - 4 Lower Ribbons: Bottom Pole -> Equatorial Nodes 1, 3, 5, 7 (45°, 135°, 225°, 315°).
    - 8 Equatorial Chevron Ribbons: Connecting (0-1, 1-2, 2-3, ..., 7-0).
    """
    mesh = Mesh()
    R = diameter_mm / 2.0
    w_strip = 3.6
    t_strip = 0.9
    bend_rad = math.radians(bend_deg)
    twist_rad = math.radians(twist_deg)
    
    # 1. Pole Node Positions
    p_top_orig = [0.0, 0.0, R]
    p_bot_orig = [0.0, 0.0, -R]
    
    p_top = rot_z_pt(rot_x_pt(p_top_orig, bend_rad), twist_rad)
    p_top = [center[0] + p_top[0], center[1] + p_top[1], center[2] + p_top[2]]
    
    p_bot = [center[0] + p_bot_orig[0], center[1] + p_bot_orig[1], center[2] + p_bot_orig[2]]
    
    # Small top & bottom Delrin hubs (radius 7mm, height 4mm)
    v_th, f_th = cylinder([p_top[0], p_top[1], p_top[2] - 2.0], [p_top[0], p_top[1], p_top[2] + 2.0], 7.0, seg=18)
    mesh.add(v_th, f_th, 'collars')
    v_bh, f_bh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 2.0], [p_bot[0], p_bot[1], p_bot[2] + 2.0], 7.0, seg=18)
    mesh.add(v_bh, f_bh, 'collars')
    
    # Central 4mm steel torque shaft
    v_sh, f_sh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 6.0], [p_top[0], p_top[1], p_top[2] + 6.0], 2.0, seg=12)
    mesh.add(v_sh, f_sh, 'shaft')

    # 2. 8 Equatorial Nodes at latitude phi=0
    eq_nodes = []
    for k in range(8):
        ang = k * (math.pi / 4.0)
        pt_orig = [R * math.cos(ang), R * math.sin(ang), 0.0]
        # Half deformation at equator
        pt_def = rot_z_pt(rot_x_pt(pt_orig, bend_rad * 0.5), twist_rad * 0.5)
        px = center[0] + pt_def[0]
        py = center[1] + pt_def[1]
        pz = center[2] + pt_def[2]
        eq_nodes.append([px, py, pz])
        
        n_rad = rot_z_pt(rot_x_pt([math.cos(ang), math.sin(ang), 0.0], bend_rad * 0.5), twist_rad * 0.5)
        add_revolute_joint_boss(mesh, [px, py, pz], n_rad, boss_radius=4.2, boss_thick=2.2, pin_radius=1.1, group='links_equatorial')
        
    add_revolute_joint_boss(mesh, p_top, [0, 0, 1], boss_radius=5.5, boss_thick=2.5, pin_radius=1.2, group='collars')
    add_revolute_joint_boss(mesh, p_bot, [0, 0, -1], boss_radius=5.5, boss_thick=2.5, pin_radius=1.2, group='collars')
    
    # 3. 4 Upper Meridian Arc Ribbons (Top Pole -> Even Nodes 0, 2, 4, 6)
    for k in (0, 2, 4, 6):
        vr, fr = make_spherical_arc_ribbon(p_top, eq_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=14)
        mesh.add(vr, fr, 'links_equatorial')
        
    # 4. 4 Lower Meridian Arc Ribbons (Bottom Pole -> Odd Nodes 1, 3, 5, 7)
    for k in (1, 3, 5, 7):
        vr, fr = make_spherical_arc_ribbon(p_bot, eq_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=14)
        mesh.add(vr, fr, 'links_equatorial')
        
    # 5. 8 Equatorial Chevron Chord Ribbons (Connecting 0-1, 1-2, ..., 7-0)
    for k in range(8):
        k_next = (k + 1) % 8
        vr, fr = make_spherical_arc_ribbon(eq_nodes[k], eq_nodes[k_next], center, R, width=w_strip, thickness=t_strip, n_sub=8)
        mesh.add(vr, fr, 'links_equatorial')
        
    return mesh

def build_exact_truss_cell(diameter_mm=56.0, center=[0,0,0], bend_deg=0.0, twist_deg=0.0):
    """
    Exact Truss TRUNC Cell (N=4, M=3, Fig. S1C / Fig. S3B / Fig. S7A):
    - Radius R = diameter / 2 = 28mm.
    - Top Pole: [0, 0, +R], Bottom Pole: [0, 0, -R].
    - Upper Latitude Band (phi = +28°): 8 Bosses at [R*cos(28°)*cos(k*45°), R*cos(28°)*sin(k*45°), +R*sin(28°)].
    - Lower Latitude Band (phi = -28°): 8 Bosses at [R*cos(28°)*cos((k+0.5)*45°), R*cos(28°)*sin((k+0.5)*45°), -R*sin(28°)].
    - 4 Upper chevrons: Top Pole -> Upper Latitude Nodes.
    - 16 Diagonal crossing ribbons: Upper Latitude Nodes <-> Lower Latitude Nodes.
    - 4 Lower chevrons: Lower Latitude Nodes -> Bottom Pole.
    - Central 4mm steel torque shaft through pole hubs.
    """
    mesh = Mesh()
    R = diameter_mm / 2.0
    w_strip = 2.8
    t_strip = 0.8
    phi_lat = math.radians(28.0)
    z_lat = R * math.sin(phi_lat)
    r_lat = R * math.cos(phi_lat)
    bend_rad = math.radians(bend_deg)
    twist_rad = math.radians(twist_deg)
    
    # 1. Pole Node Positions
    p_top_orig = [0.0, 0.0, R]
    p_bot_orig = [0.0, 0.0, -R]
    
    p_top = rot_z_pt(rot_x_pt(p_top_orig, bend_rad), twist_rad)
    p_top = [center[0] + p_top[0], center[1] + p_top[1], center[2] + p_top[2]]
    p_bot = [center[0] + p_bot_orig[0], center[1] + p_bot_orig[1], center[2] + p_bot_orig[2]]
    
    # Small top & bottom Delrin hubs
    v_th, f_th = cylinder([p_top[0], p_top[1], p_top[2] - 1.8], [p_top[0], p_top[1], p_top[2] + 1.8], 5.5, seg=16)
    mesh.add(v_th, f_th, 'collars')
    v_bh, f_bh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 1.8], [p_bot[0], p_bot[1], p_bot[2] + 1.8], 5.5, seg=16)
    mesh.add(v_bh, f_bh, 'collars')
    
    # Central 4mm steel torque transmission shaft
    v_sh, f_sh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 8.0], [p_top[0], p_top[1], p_top[2] + 8.0], 2.0, seg=12)
    mesh.add(v_sh, f_sh, 'shaft')
    
    # 2. 8 Upper Latitude Nodes (phi = +28°)
    upper_nodes = []
    for k in range(8):
        ang = k * (math.pi / 4.0)
        pt_orig = [r_lat * math.cos(ang), r_lat * math.sin(ang), z_lat]
        pt_def = rot_z_pt(rot_x_pt(pt_orig, bend_rad * 0.70), twist_rad * 0.70)
        px = center[0] + pt_def[0]
        py = center[1] + pt_def[1]
        pz = center[2] + pt_def[2]
        upper_nodes.append([px, py, pz])
        n_rad = rot_z_pt(rot_x_pt([r_lat*math.cos(ang)/R, r_lat*math.sin(ang)/R, z_lat/R], bend_rad*0.70), twist_rad*0.70)
        add_revolute_joint_boss(mesh, [px, py, pz], n_rad, boss_radius=3.5, boss_thick=1.8, pin_radius=0.9, group='links_truss')

    # 3. 8 Lower Latitude Nodes (phi = -28°, staggered by 22.5°)
    lower_nodes = []
    for k in range(8):
        ang = (k + 0.5) * (math.pi / 4.0)
        pt_orig = [r_lat * math.cos(ang), r_lat * math.sin(ang), -z_lat]
        pt_def = rot_z_pt(rot_x_pt(pt_orig, bend_rad * 0.30), twist_rad * 0.30)
        px = center[0] + pt_def[0]
        py = center[1] + pt_def[1]
        pz = center[2] + pt_def[2]
        lower_nodes.append([px, py, pz])
        n_rad = rot_z_pt(rot_x_pt([r_lat*math.cos(ang)/R, r_lat*math.sin(ang)/R, -z_lat/R], bend_rad*0.30), twist_rad*0.30)
        add_revolute_joint_boss(mesh, [px, py, pz], n_rad, boss_radius=3.5, boss_thick=1.8, pin_radius=0.9, group='links_truss')

    add_revolute_joint_boss(mesh, p_top, [0, 0, 1], boss_radius=4.5, boss_thick=2.0, pin_radius=1.0, group='collars')
    add_revolute_joint_boss(mesh, p_bot, [0, 0, -1], boss_radius=4.5, boss_thick=2.0, pin_radius=1.0, group='collars')

    # 4. Upper Band: Top Pole -> 4 Apex Nodes on Upper Latitude (0, 2, 4, 6)
    for k in (0, 2, 4, 6):
        vr, fr = make_spherical_arc_ribbon(p_top, upper_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=10)
        mesh.add(vr, fr, 'links_truss')
        
    # Upper Band Chevrons (connecting adjacent upper nodes: 0-1, 1-2, ..., 7-0)
    for k in range(8):
        vr, fr = make_spherical_arc_ribbon(upper_nodes[k], upper_nodes[(k+1)%8], center, R, width=w_strip, thickness=t_strip, n_sub=6)
        mesh.add(vr, fr, 'links_truss')

    # 5. Middle Truss Diagonal Crossing Ribbons (16 diagonal links)
    for k in range(8):
        vr1, fr1 = make_spherical_arc_ribbon(upper_nodes[k], lower_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=10)
        mesh.add(vr1, fr1, 'links_truss')
        vr2, fr2 = make_spherical_arc_ribbon(upper_nodes[k], lower_nodes[(k-1)%8], center, R, width=w_strip, thickness=t_strip, n_sub=10)
        mesh.add(vr2, fr2, 'links_truss')

    # 6. Lower Band Chevrons (connecting adjacent lower nodes)
    for k in range(8):
        vr, fr = make_spherical_arc_ribbon(lower_nodes[k], lower_nodes[(k+1)%8], center, R, width=w_strip, thickness=t_strip, n_sub=6)
        mesh.add(vr, fr, 'links_truss')

    # 7. Lower Band: Bottom Pole -> 4 Apex Nodes on Lower Latitude (1, 3, 5, 7)
    for k in (1, 3, 5, 7):
        vr, fr = make_spherical_arc_ribbon(p_bot, lower_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=10)
        mesh.add(vr, fr, 'links_truss')

    return mesh

def build_exact_dual_nested_assembly():
    """
    Exact Concentric Dual-Nested TRUNC Assembly (Fig. S7A / Fig. 2 / Fig. 4):
    - Inner Truss Cell (D=56mm, Red) nested inside Outer Equatorial Cell (D=88mm, Blue).
    - Common central 4mm steel torque transmission shaft.
    - 3-Arm Tendon Guide Triad (R=65mm) at bottom pole.
    """
    mesh = Mesh()
    truss = build_exact_truss_cell(56.0, center=[0,0,0])
    mesh.add(truss.verts, truss.faces, 'links_truss')
    eq = build_exact_equatorial_cell(88.0, center=[0,0,0])
    mesh.add(eq.verts, eq.faces, 'links_equatorial')
    
    p_center = [0.0, 0.0, -44.0]
    for arm_idx in range(3):
        ang = arm_idx * (2 * math.pi / 3)
        p_tip = [65.0 * math.cos(ang), 65.0 * math.sin(ang), -44.0]
        v_arm, f_arm = cylinder(p_center, p_tip, 3.2, seg=8)
        mesh.add(v_arm, f_arm, 'triad')
        v_eye, f_eye = sphere(p_tip, 4.5, useg=10, vseg=6)
        mesh.add(v_eye, f_eye, 'triad')
        v_hole, f_hole = cylinder([p_tip[0], p_tip[1], -47.0], [p_tip[0], p_tip[1], -41.0], 1.2, seg=8)
        mesh.add(v_hole, f_hole, 'pins')
        
    return mesh
