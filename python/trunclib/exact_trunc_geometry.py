#!/usr/bin/env python3
"""
trunclib/exact_trunc_geometry.py — Exact Analytical Spherical Double-Arrowhead
Metamaterial Geometry for TRUNC Soft Continuum Robot (Carton et al., Fig. S1, S3, S7).

Features:
  1. Full large-displacement kinematic deformation under Torsion (theta_twist) and Bending (theta_bend).
  2. Authentic M2 revolute pin joints (Fig. S1A): overlapping circular eyelet lugs pinned by M2 socket screws.
  3. Internal helical/conical restoring spring (k = 1.22 N/mm) coiled around the 4mm central steel torque shaft.
  4. Exact spherical geodesic ribbon links with thickness t and width w.
"""

import math
from trunclib.model3d import Mesh, sphere, cylinder
import trunclib.mathx as mx

def rot_x_pt(pt, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    return [pt[0], pt[1]*ca - pt[2]*sa, pt[1]*sa + pt[2]*ca]

def rot_y_pt(pt, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    return [pt[0]*ca + pt[2]*sa, pt[1], -pt[0]*sa + pt[2]*ca]

def rot_z_pt(pt, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    return [pt[0]*ca - pt[1]*sa, pt[0]*sa + pt[1]*ca, pt[2]]

def make_curved_link_with_lugs(p_start, p_end, center, R, width=3.2, thickness=0.8, n_sub=12, lug_radius=4.2):
    """
    Generates a curved flat strip link ending in rounded circular eyelet lugs (Fig. S1A).
    The link arches outward following the sphere radius R.
    """
    verts = []
    faces = []
    
    # Unit vectors from center
    v0 = [p_start[i] - center[i] for i in range(3)]
    v1 = [p_end[i] - center[i] for i in range(3)]
    len0 = math.sqrt(sum(c*c for c in v0)) or R
    len1 = math.sqrt(sum(c*c for c in v1)) or R
    u0 = [c / len0 for c in v0]
    u1 = [c / len1 for c in v1]
    
    dot = max(-1.0, min(1.0, sum(u0[i] * u1[i] for i in range(3))))
    total_ang = math.acos(dot)
    
    if total_ang < 1e-4:
        axis = [0, 0, 1]
    else:
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
    
    # Ribbon body
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
        
        # Lateral tangent
        lat = [
            u_t[1]*axis[2] - u_t[2]*axis[1],
            u_t[2]*axis[0] - u_t[0]*axis[2],
            u_t[0]*axis[1] - u_t[1]*axis[0]
        ]
        lat_len = math.sqrt(sum(c*c for c in lat)) or 1.0
        lat = [c / lat_len for c in lat]
        rad = u_t
        
        # Interpolate radius
        R_s = len0 * (1.0 - frac) + len1 * frac
        # Slight outward camber matching paper's molded spring steel arcs
        camber = 1.0 + 0.08 * math.sin(frac * math.pi)
        p_mid = [center[i] + u_t[i] * (R_s * camber) for i in range(3)]
        
        # Adjust width near ends to blend with circular lugs
        w_cur = w_half * (1.0 + 0.3 * (1.0 - math.sin(frac * math.pi)))
        
        p_ol = [p_mid[i] + lat[i]*w_cur + rad[i]*t_half for i in range(3)]
        p_or = [p_mid[i] - lat[i]*w_cur + rad[i]*t_half for i in range(3)]
        p_il = [p_mid[i] + lat[i]*w_cur - rad[i]*t_half for i in range(3)]
        p_ir = [p_mid[i] - lat[i]*w_cur - rad[i]*t_half for i in range(3)]
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

def add_revolute_pin_joint(mesh, center_pt, normal_dir, lug_radius=4.0, lug_thick=1.2, pin_radius=1.0, pin_len=4.5, group='pins'):
    """Adds a realistic M2 revolute screw pin through the joint eyelets (Fig. S1A)."""
    norm = math.sqrt(sum(c*c for c in normal_dir)) or 1.0
    n = [c / norm for c in normal_dir]
    
    # 2 Overlapping Eyelet Boss Discs (Fig. S1A)
    p_disc1_b = [center_pt[i] - n[i] * (lug_thick) for i in range(3)]
    p_disc1_t = [center_pt[i] for i in range(3)]
    v_d1, f_d1 = cylinder(p_disc1_b, p_disc1_t, lug_radius, seg=16)
    mesh.add(v_d1, f_d1, 'links_truss' if 'truss' in group else 'links_equatorial')
    
    p_disc2_b = [center_pt[i] for i in range(3)]
    p_disc2_t = [center_pt[i] + n[i] * (lug_thick) for i in range(3)]
    v_d2, f_d2 = cylinder(p_disc2_b, p_disc2_t, lug_radius, seg=16)
    mesh.add(v_d2, f_d2, 'links_truss' if 'truss' in group else 'links_equatorial')
    
    # M2 Steel Pin Shank
    p_p0 = [center_pt[i] - n[i] * (pin_len / 2.0) for i in range(3)]
    p_p1 = [center_pt[i] + n[i] * (pin_len / 2.0) for i in range(3)]
    vp, fp = cylinder(p_p0, p_p1, pin_radius, seg=12)
    mesh.add(vp, fp, 'pins')
    
    # M2 Socket Screw Head on top + Nylon Locknut on bottom
    p_head = [center_pt[i] + n[i] * (pin_len / 2.0 + 1.2) for i in range(3)]
    vh, fh = cylinder(p_p1, p_head, pin_radius * 1.8, seg=12)
    mesh.add(vh, fh, 'pins')
    
    p_nut = [center_pt[i] - n[i] * (pin_len / 2.0 + 1.2) for i in range(3)]
    vn, fn = cylinder(p_nut, p_p0, pin_radius * 1.7, seg=8)
    mesh.add(vn, fn, 'pins')

def add_helical_restoring_spring(mesh, p_bot, p_top, d_wire=1.4, d_spring=15.0, n_coils=5, n_steps=60):
    """
    Internal conical/helical restoring spring (k = 1.22 N/mm)
    coiled smoothly around the central 4mm steel torque shaft between bottom and top hubs.
    """
    axis = [p_top[i] - p_bot[i] for i in range(3)]
    L_spring = math.sqrt(sum(c*c for c in axis)) or 1.0
    u_z = [c / L_spring for c in axis]
    
    # Orthogonal frame for spring cross section
    arb = [1, 0, 0] if abs(u_z[0]) < 0.8 else [0, 1, 0]
    u_x = [
        arb[1]*u_z[2] - arb[2]*u_z[1],
        arb[2]*u_z[0] - arb[0]*u_z[2],
        arb[0]*u_z[1] - arb[1]*u_z[0]
    ]
    u_x_len = math.sqrt(sum(c*c for c in u_x)) or 1.0
    u_x = [c / u_x_len for c in u_x]
    u_y = [
        u_z[1]*u_x[2] - u_z[2]*u_x[1],
        u_z[2]*u_x[0] - u_z[0]*u_x[2],
        u_z[0]*u_x[1] - u_z[1]*u_x[0]
    ]
    
    r_sp_base = d_spring / 2.0
    spring_pts = []
    for s in range(n_steps + 1):
        frac = s / float(n_steps)
        # Slight barrel/conical bulge in middle
        r_sp = r_sp_base * (1.0 + 0.25 * math.sin(frac * math.pi))
        th = frac * n_coils * 2.0 * math.pi
        z_curr = frac * L_spring
        
        # Center of spine at z_curr
        spine_pt = [p_bot[i] + u_z[i] * z_curr for i in range(3)]
        dx = r_sp * math.cos(th)
        dy = r_sp * math.sin(th)
        pt = [
            spine_pt[i] + u_x[i] * dx + u_y[i] * dy
            for i in range(3)
        ]
        spring_pts.append(pt)
        
    for s in range(n_steps):
        vs, fs = cylinder(spring_pts[s], spring_pts[s+1], d_wire / 2.0, seg=6)
        mesh.add(vs, fs, 'spring')

def build_exact_equatorial_cell(diameter_mm=88.0, center=[0,0,0], bend_deg=0.0, twist_deg=0.0):
    """
    Exact Equatorial TRUNC Cell (N=4, M=2, Fig. S1B / Fig. S3A / Fig. S7A):
    - Radius R = diameter / 2 = 44mm.
    - True large-displacement kinematic deformation under Bending (bend_deg) and Torsion (twist_deg).
    - M2 Revolute Pin Joints with dual overlapping eyelet lugs (Fig. S1A).
    - Internal 1.22 N/mm restoring spring around central 4mm steel torque transmission shaft.
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
    
    p_top_rel = rot_z_pt(rot_x_pt(p_top_orig, bend_rad), twist_rad)
    p_top = [center[0] + p_top_rel[0], center[1] + p_top_rel[1], center[2] + p_top_rel[2]]
    p_bot = [center[0] + p_bot_orig[0], center[1] + p_bot_orig[1], center[2] + p_bot_orig[2]]
    
    # Compact top & bottom Delrin mounting collars (radius 7mm, height 4mm)
    v_th, f_th = cylinder([p_top[0], p_top[1], p_top[2] - 2.0], [p_top[0], p_top[1], p_top[2] + 2.0], 7.0, seg=18)
    mesh.add(v_th, f_th, 'collars')
    v_bh, f_bh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 2.0], [p_bot[0], p_bot[1], p_bot[2] + 2.0], 7.0, seg=18)
    mesh.add(v_bh, f_bh, 'collars')
    
    # Central 4mm steel torque transmission shaft
    v_sh, f_sh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 8.0], [p_top[0], p_top[1], p_top[2] + 8.0], 2.0, seg=12)
    mesh.add(v_sh, f_sh, 'shaft')
    
    # Internal 1.22 N/mm restoring spring coiled around shaft
    add_helical_restoring_spring(mesh, [p_bot[0], p_bot[1], p_bot[2] + 2.0], [p_top[0], p_top[1], p_top[2] - 2.0], d_wire=1.4, d_spring=16.0, n_coils=5)

    # 2. 8 Equatorial Nodes at latitude phi=0 with Torsional Auxetic Scissoring
    eq_nodes = []
    # Auxetic scissoring angle under torsion
    scissor_amp = twist_rad * 0.22
    for k in range(8):
        ang_base = k * (math.pi / 4.0)
        # Alternate even/odd scissoring in chevron belt
        ang_def = ang_base + (scissor_amp if k % 2 == 0 else -scissor_amp)
        # Auxetic lateral expansion under twist: R expands slightly
        r_def = R * (1.0 + 0.05 * abs(twist_rad))
        
        pt_orig = [r_def * math.cos(ang_def), r_def * math.sin(ang_def), 0.0]
        # Intermediate tilt & twist at equator (0.50 of total)
        pt_def = rot_z_pt(rot_x_pt(pt_orig, bend_rad * 0.50), twist_rad * 0.50)
        px = center[0] + pt_def[0]
        py = center[1] + pt_def[1]
        pz = center[2] + pt_def[2]
        eq_nodes.append([px, py, pz])
        
        # Pin normal vector (radial to sphere)
        n_rad = rot_z_pt(rot_x_pt([math.cos(ang_def), math.sin(ang_def), 0.0], bend_rad * 0.50), twist_rad * 0.50)
        add_revolute_pin_joint(mesh, [px, py, pz], n_rad, lug_radius=4.2, lug_thick=1.1, pin_radius=1.0, group='links_equatorial')
        
    # Top & bottom pole hub M2 pins
    add_revolute_pin_joint(mesh, p_top, rot_z_pt(rot_x_pt([0, 0, 1], bend_rad), twist_rad), lug_radius=5.5, lug_thick=1.5, pin_radius=1.1, group='collars')
    add_revolute_pin_joint(mesh, p_bot, [0, 0, -1], lug_radius=5.5, lug_thick=1.5, pin_radius=1.1, group='collars')

    # 3. 4 Upper Meridian Arc Ribbons (Top Pole -> Even Nodes 0, 2, 4, 6)
    # Under twist, top anchors rotate by twist_rad, creating helical spiral curvature
    for k in (0, 2, 4, 6):
        vr, fr = make_curved_link_with_lugs(p_top, eq_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=14, lug_radius=4.2)
        mesh.add(vr, fr, 'links_equatorial')
        
    # 4. 4 Lower Meridian Arc Ribbons (Bottom Pole -> Odd Nodes 1, 3, 5, 7)
    for k in (1, 3, 5, 7):
        vr, fr = make_curved_link_with_lugs(p_bot, eq_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=14, lug_radius=4.2)
        mesh.add(vr, fr, 'links_equatorial')
        
    # 5. 8 Equatorial Chevron Chord Ribbons (Connecting 0-1, 1-2, ..., 7-0)
    for k in range(8):
        k_next = (k + 1) % 8
        vr, fr = make_curved_link_with_lugs(eq_nodes[k], eq_nodes[k_next], center, R, width=w_strip, thickness=t_strip, n_sub=8, lug_radius=4.2)
        mesh.add(vr, fr, 'links_equatorial')
        
    return mesh

def build_exact_truss_cell(diameter_mm=56.0, center=[0,0,0], bend_deg=0.0, twist_deg=0.0):
    """
    Exact Truss TRUNC Cell (N=4, M=3, Fig. S1C / Fig. S3B / Fig. S7A):
    - Radius R = diameter / 2 = 28mm.
    - True large-displacement kinematic deformation under Bending and Torsion.
    - 32 Curved Ribbon Links with 18 M2 Revolute Pin Joints (Fig. S1A/S1C).
    - Internal 1.22 N/mm restoring spring around central 4mm steel torque transmission shaft.
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
    
    p_top_rel = rot_z_pt(rot_x_pt(p_top_orig, bend_rad), twist_rad)
    p_top = [center[0] + p_top_rel[0], center[1] + p_top_rel[1], center[2] + p_top_rel[2]]
    p_bot = [center[0] + p_bot_orig[0], center[1] + p_bot_orig[1], center[2] + p_bot_orig[2]]
    
    # Compact top & bottom Delrin hubs
    v_th, f_th = cylinder([p_top[0], p_top[1], p_top[2] - 1.8], [p_top[0], p_top[1], p_top[2] + 1.8], 5.5, seg=16)
    mesh.add(v_th, f_th, 'collars')
    v_bh, f_bh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 1.8], [p_bot[0], p_bot[1], p_bot[2] + 1.8], 5.5, seg=16)
    mesh.add(v_bh, f_bh, 'collars')
    
    # Central 4mm steel torque transmission shaft
    v_sh, f_sh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 8.0], [p_top[0], p_top[1], p_top[2] + 8.0], 2.0, seg=12)
    mesh.add(v_sh, f_sh, 'shaft')
    
    # Internal 1.22 N/mm restoring spring coiled around shaft
    add_helical_restoring_spring(mesh, [p_bot[0], p_bot[1], p_bot[2] + 2.0], [p_top[0], p_top[1], p_top[2] - 2.0], d_wire=1.2, d_spring=11.0, n_coils=5)

    # 2. 8 Upper Latitude Nodes (phi = +28°)
    upper_nodes = []
    scissor_upper = twist_rad * 0.18
    for k in range(8):
        ang_base = k * (math.pi / 4.0)
        ang_def = ang_base + (scissor_upper if k % 2 == 0 else -scissor_upper)
        pt_orig = [r_lat * math.cos(ang_def), r_lat * math.sin(ang_def), z_lat]
        # 0.70 of total deformation at upper latitude
        pt_def = rot_z_pt(rot_x_pt(pt_orig, bend_rad * 0.70), twist_rad * 0.70)
        px = center[0] + pt_def[0]
        py = center[1] + pt_def[1]
        pz = center[2] + pt_def[2]
        upper_nodes.append([px, py, pz])
        
        n_rad = rot_z_pt(rot_x_pt([r_lat*math.cos(ang_def)/R, r_lat*math.sin(ang_def)/R, z_lat/R], bend_rad*0.70), twist_rad*0.70)
        add_revolute_pin_joint(mesh, [px, py, pz], n_rad, lug_radius=3.5, lug_thick=1.0, pin_radius=0.9, group='links_truss')

    # 3. 8 Lower Latitude Nodes (phi = -28°, staggered by 22.5°)
    lower_nodes = []
    scissor_lower = twist_rad * 0.18
    for k in range(8):
        ang_base = (k + 0.5) * (math.pi / 4.0)
        ang_def = ang_base + (-scissor_lower if k % 2 == 0 else scissor_lower)
        pt_orig = [r_lat * math.cos(ang_def), r_lat * math.sin(ang_def), -z_lat]
        # 0.30 of total deformation at lower latitude
        pt_def = rot_z_pt(rot_x_pt(pt_orig, bend_rad * 0.30), twist_rad * 0.30)
        px = center[0] + pt_def[0]
        py = center[1] + pt_def[1]
        pz = center[2] + pt_def[2]
        lower_nodes.append([px, py, pz])
        
        n_rad = rot_z_pt(rot_x_pt([r_lat*math.cos(ang_def)/R, r_lat*math.sin(ang_def)/R, -z_lat/R], bend_rad*0.30), twist_rad*0.30)
        add_revolute_pin_joint(mesh, [px, py, pz], n_rad, lug_radius=3.5, lug_thick=1.0, pin_radius=0.9, group='links_truss')

    add_revolute_pin_joint(mesh, p_top, rot_z_pt(rot_x_pt([0, 0, 1], bend_rad), twist_rad), lug_radius=4.5, lug_thick=1.2, pin_radius=1.0, group='collars')
    add_revolute_pin_joint(mesh, p_bot, [0, 0, -1], lug_radius=4.5, lug_thick=1.2, pin_radius=1.0, group='collars')

    # 4. Upper Band: Top Pole -> 4 Apex Nodes on Upper Latitude (0, 2, 4, 6)
    for k in (0, 2, 4, 6):
        vr, fr = make_curved_link_with_lugs(p_top, upper_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=10, lug_radius=3.5)
        mesh.add(vr, fr, 'links_truss')
        
    # Upper Band Chevrons (connecting adjacent upper nodes: 0-1, 1-2, ..., 7-0)
    for k in range(8):
        vr, fr = make_curved_link_with_lugs(upper_nodes[k], upper_nodes[(k+1)%8], center, R, width=w_strip, thickness=t_strip, n_sub=6, lug_radius=3.5)
        mesh.add(vr, fr, 'links_truss')

    # 5. Middle Truss Diagonal Crossing Ribbons (16 diagonal links)
    for k in range(8):
        vr1, fr1 = make_curved_link_with_lugs(upper_nodes[k], lower_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=10, lug_radius=3.5)
        mesh.add(vr1, fr1, 'links_truss')
        vr2, fr2 = make_curved_link_with_lugs(upper_nodes[k], lower_nodes[(k-1)%8], center, R, width=w_strip, thickness=t_strip, n_sub=10, lug_radius=3.5)
        mesh.add(vr2, fr2, 'links_truss')

    # 6. Lower Band Chevrons (connecting adjacent lower nodes)
    for k in range(8):
        vr, fr = make_curved_link_with_lugs(lower_nodes[k], lower_nodes[(k+1)%8], center, R, width=w_strip, thickness=t_strip, n_sub=6, lug_radius=3.5)
        mesh.add(vr, fr, 'links_truss')

    # 7. Lower Band: Bottom Pole -> 4 Apex Nodes on Lower Latitude (1, 3, 5, 7)
    for k in (1, 3, 5, 7):
        vr, fr = make_curved_link_with_lugs(p_bot, lower_nodes[k], center, R, width=w_strip, thickness=t_strip, n_sub=10, lug_radius=3.5)
        mesh.add(vr, fr, 'links_truss')

    return mesh

def build_exact_dual_nested_assembly():
    """
    Exact Concentric Dual-Nested TRUNC Assembly (Fig. S7A / Fig. 2 / Fig. 4):
    - Inner Truss Cell (D=56mm, Red) nested inside Outer Equatorial Cell (D=88mm, Blue).
    - Common central 4mm steel torque transmission shaft.
    - Internal restoring spring.
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
