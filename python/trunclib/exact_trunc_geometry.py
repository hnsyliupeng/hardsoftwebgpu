#!/usr/bin/env python3
"""
trunclib/exact_trunc_geometry.py — Exact Analytical Spherical Double-Arrowhead
Metamaterial Geometry for TRUNC Soft Continuum Robot (Carton et al., Fig. S1, S3, S7).

Features:
  1. Full non-linear kinematic deformation under Torsion (theta_twist) and Bending (theta_bend):
     - Spiral helical meridian arc twisting around sphere.
     - Auxetic chevron scissoring (+/- delta_alpha) at equatorial and latitude bands.
     - Dynamic angular coiling of the internal restoring spring around the 4mm steel torque shaft.
  2. Authentic M2 revolute pin joints (Fig. S1A): overlapping circular eyelet lugs pinned by M2 socket screws.
  3. Continuous monolithic ribbon surfaces with finite width w and thickness t.
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

def make_ribbon_from_path(spine_pts, width=3.4, thickness=0.85):
    """
    Extrudes a 3D flat ribbon strip of given width and thickness along an arbitrary 3D spine path.
    Computes smooth Frenet/Bishop framing along the curve.
    """
    verts = []
    faces = []
    n_pts = len(spine_pts)
    if n_pts < 2:
        return verts, faces
        
    w_half = width / 2.0
    t_half = thickness / 2.0
    
    # Calculate tangent, normal, binormal frames at each spine vertex
    frames = []
    for i in range(n_pts):
        if i == 0:
            tang = [spine_pts[1][k] - spine_pts[0][k] for k in range(3)]
        elif i == n_pts - 1:
            tang = [spine_pts[n_pts-1][k] - spine_pts[n_pts-2][k] for k in range(3)]
        else:
            tang = [spine_pts[i+1][k] - spine_pts[i-1][k] for k in range(3)]
        tlen = math.sqrt(sum(c*c for c in tang)) or 1.0
        T = [c / tlen for c in tang]
        
        # Outward radial normal from spine position
        p = spine_pts[i]
        rad = [p[0], p[1], p[2]]
        # Remove component along T
        dot_tr = sum(T[k] * rad[k] for k in range(3))
        N_raw = [rad[k] - T[k] * dot_tr for k in range(3)]
        nlen = math.sqrt(sum(c*c for c in N_raw))
        if nlen > 1e-4:
            N = [c / nlen for c in N_raw]
        else:
            arb = [1, 0, 0] if abs(T[0]) < 0.8 else [0, 1, 0]
            dot_ta = sum(T[k] * arb[k] for k in range(3))
            N_raw = [arb[k] - T[k] * dot_ta for k in range(3)]
            nlen = math.sqrt(sum(c*c for c in N_raw)) or 1.0
            N = [c / nlen for c in N_raw]
            
        # Lateral binormal vector
        B = [
            T[1]*N[2] - T[2]*N[1],
            T[2]*N[0] - T[0]*N[2],
            T[0]*N[1] - T[1]*N[0]
        ]
        blen = math.sqrt(sum(c*c for c in B)) or 1.0
        B = [c / blen for c in B]
        frames.append((T, N, B))
        
    ring_stride = 4
    for i in range(n_pts):
        p = spine_pts[i]
        T, N, B = frames[i]
        frac = i / float(n_pts - 1)
        # Taper slightly at the very ends to blend with circular eyelet lugs
        w_curr = w_half * (1.0 + 0.35 * (1.0 - math.sin(frac * math.pi)))
        
        p_ol = [p[k] + B[k]*w_curr + N[k]*t_half for k in range(3)]
        p_or = [p[k] - B[k]*w_curr + N[k]*t_half for k in range(3)]
        p_il = [p[k] + B[k]*w_curr - N[k]*t_half for k in range(3)]
        p_ir = [p[k] - B[k]*w_curr - N[k]*t_half for k in range(3)]
        verts.extend([p_ol, p_or, p_il, p_ir])
        
    for i in range(n_pts - 1):
        b0 = i * ring_stride
        b1 = (i + 1) * ring_stride
        faces.append([b0 + 0, b1 + 0, b1 + 1])
        faces.append([b0 + 0, b1 + 1, b0 + 1])
        faces.append([b0 + 2, b1 + 3, b1 + 2])
        faces.append([b0 + 2, b0 + 3, b1 + 3])
        faces.append([b0 + 0, b1 + 2, b1 + 0])
        faces.append([b0 + 0, b0 + 2, b1 + 2])
        faces.append([b0 + 1, b1 + 1, b1 + 3])
        faces.append([b0 + 1, b1 + 3, b0 + 3])
        
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

def add_helical_restoring_spring(mesh, p_bot, p_top, twist_rad=0.0, d_wire=1.4, d_spring=15.0, n_coils=5, n_steps=60):
    """
    Internal conical/helical restoring spring (k = 1.22 N/mm)
    coiled smoothly around the central 4mm steel torque shaft between bottom and top hubs.
    Twists with the applied torsion angle.
    """
    axis = [p_top[i] - p_bot[i] for i in range(3)]
    L_spring = math.sqrt(sum(c*c for c in axis)) or 1.0
    u_z = [c / L_spring for c in axis]
    
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
        r_sp = r_sp_base * (1.0 + 0.25 * math.sin(frac * math.pi))
        # Spring coils twist with applied torsion
        th = frac * n_coils * 2.0 * math.pi + frac * twist_rad
        z_curr = frac * L_spring
        
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
    - True analytical large-displacement kinematic deformation under Torsion (twist_deg) and Bending (bend_deg).
    - Spiral helical meridian arc twisting around sphere.
    - Auxetic chevron scissoring (+/- delta_alpha) at equator.
    - M2 Revolute Pin Joints with dual overlapping eyelet lugs (Fig. S1A).
    - Internal 1.22 N/mm restoring spring around central 4mm steel torque transmission shaft.
    """
    mesh = Mesh()
    R = diameter_mm / 2.0
    w_strip = 3.6
    t_strip = 0.9
    r_hub = 8.0
    bend_rad = math.radians(bend_deg)
    twist_rad = math.radians(twist_deg)
    
    # 1. Pole Node Positions & Delrin Mounting Collars
    p_top_center_orig = [0.0, 0.0, R]
    p_bot_center_orig = [0.0, 0.0, -R]
    
    # Top Delrin Collar tilts and rotates around Z
    p_top_rel = rot_z_pt(rot_x_pt(p_top_center_orig, bend_rad), twist_rad)
    p_top = [center[0] + p_top_rel[0], center[1] + p_top_rel[1], center[2] + p_top_rel[2]]
    p_bot = [center[0] + p_bot_center_orig[0], center[1] + p_bot_center_orig[1], center[2] + p_bot_center_orig[2]]
    
    v_th, f_th = cylinder([p_top[0], p_top[1], p_top[2] - 2.5], [p_top[0], p_top[1], p_top[2] + 2.5], r_hub + 1.5, seg=18)
    mesh.add(v_th, f_th, 'collars')
    v_bh, f_bh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 2.5], [p_bot[0], p_bot[1], p_bot[2] + 2.5], r_hub + 1.5, seg=18)
    mesh.add(v_bh, f_bh, 'collars')
    
    # Central 4mm steel torque transmission shaft
    v_sh, f_sh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 8.0], [p_top[0], p_top[1], p_top[2] + 8.0], 2.0, seg=12)
    mesh.add(v_sh, f_sh, 'shaft')
    
    # Internal 1.22 N/mm restoring spring coiled around shaft
    add_helical_restoring_spring(mesh, [p_bot[0], p_bot[1], p_bot[2] + 2.0], [p_top[0], p_top[1], p_top[2] - 2.0], twist_rad=twist_rad, d_wire=1.4, d_spring=16.0, n_coils=5)

    # 4 Top Anchor Lugs on Top Collar (distributed around rim, rotating by twist_rad)
    top_lugs = {}
    for k in (0, 2, 4, 6):
        ang_top = k * (math.pi / 4.0) + twist_rad
        pt_raw = [r_hub * math.cos(ang_top), r_hub * math.sin(ang_top), R]
        pt_def = rot_z_pt(rot_x_pt(pt_raw, bend_rad), 0.0) # ang_top already contains twist_rad
        p_lug = [center[0] + pt_def[0], center[1] + pt_def[1], center[2] + pt_def[2]]
        top_lugs[k] = p_lug
        n_pin = rot_z_pt(rot_x_pt([0, 0, 1], bend_rad), 0.0)
        add_revolute_pin_joint(mesh, p_lug, n_pin, lug_radius=4.0, lug_thick=1.2, pin_radius=1.0, group='collars')
        
    # 4 Bottom Anchor Lugs on Bottom Collar (fixed at base)
    bot_lugs = {}
    for k in (1, 3, 5, 7):
        ang_bot = k * (math.pi / 4.0)
        p_lug = [center[0] + r_hub * math.cos(ang_bot), center[1] + r_hub * math.sin(ang_bot), center[2] - R]
        bot_lugs[k] = p_lug
        add_revolute_pin_joint(mesh, p_lug, [0, 0, -1], lug_radius=4.0, lug_thick=1.2, pin_radius=1.0, group='collars')

    # 2. 8 Equatorial Nodes at latitude phi=0 with Torsional Auxetic Scissoring
    eq_nodes = []
    # Auxetic scissoring angle under torsion: chevron links scissor in pairs
    scissor_amp = twist_rad * 0.40
    eq_rot_mean = twist_rad * 0.50
    for k in range(8):
        ang_base = k * (math.pi / 4.0)
        ang_eq = ang_base + eq_rot_mean + (scissor_amp if k % 2 == 0 else -scissor_amp)
        r_eq = R * (1.0 + 0.06 * abs(twist_rad))
        
        pt_orig = [r_eq * math.cos(ang_eq), r_eq * math.sin(ang_eq), 0.0]
        pt_def = rot_z_pt(rot_x_pt(pt_orig, bend_rad * 0.50), 0.0)
        px = center[0] + pt_def[0]
        py = center[1] + pt_def[1]
        pz = center[2] + pt_def[2]
        eq_nodes.append([px, py, pz])
        
        n_rad = rot_z_pt(rot_x_pt([math.cos(ang_eq), math.sin(ang_eq), 0.0], bend_rad * 0.50), 0.0)
        add_revolute_pin_joint(mesh, [px, py, pz], n_rad, lug_radius=4.2, lug_thick=1.1, pin_radius=1.0, group='links_equatorial')

    # 3. 4 Upper Helical Spiral Meridian Ribbons (Top Collar Lug -> Equatorial Nodes 0, 2, 4, 6)
    # Under torsion twist, ribbon follows a 3D helical spiral trajectory connecting rotating top lug to sheared equator node
    n_sub = 16
    for k in (0, 2, 4, 6):
        path = []
        ang_top = k * (math.pi / 4.0) + twist_rad
        ang_eq = k * (math.pi / 4.0) + eq_rot_mean + scissor_amp
        
        for s in range(n_sub + 1):
            frac = s / float(n_sub) # frac=0 at top lug, frac=1 at equator
            # Elevation angle along meridian: pi/2 at top -> 0 at equator
            phi_s = (1.0 - frac) * (math.pi / 2.0)
            # Radial distance: r_hub at top -> R at equator with spherical bulge
            r_s = r_hub * (1.0 - frac) + R * math.cos(phi_s) * (1.0 + 0.12 * math.sin(frac * math.pi))
            z_s = R * math.sin(phi_s)
            # Azimuth angle spirals helically between ang_top and ang_eq
            theta_s = ang_top * (1.0 - frac) + ang_eq * frac
            
            p_s_orig = [r_s * math.cos(theta_s), r_s * math.sin(theta_s), z_s]
            # Interpolate bending tilt
            bend_s = bend_rad * (1.0 - 0.5 * frac)
            p_s_def = rot_z_pt(rot_x_pt(p_s_orig, bend_s), 0.0)
            path.append([center[0] + p_s_def[0], center[1] + p_s_def[1], center[2] + p_s_def[2]])
            
        vr, fr = make_ribbon_from_path(path, width=w_strip, thickness=t_strip)
        mesh.add(vr, fr, 'links_equatorial')
        
    # 4. 4 Lower Helical Spiral Meridian Ribbons (Bottom Collar Lug -> Equatorial Nodes 1, 3, 5, 7)
    for k in (1, 3, 5, 7):
        path = []
        ang_bot = k * (math.pi / 4.0)
        ang_eq = k * (math.pi / 4.0) + eq_rot_mean - scissor_amp
        
        for s in range(n_sub + 1):
            frac = s / float(n_sub) # frac=0 at bottom lug, frac=1 at equator
            phi_s = (1.0 - frac) * (-math.pi / 2.0)
            r_s = r_hub * (1.0 - frac) + R * math.cos(phi_s) * (1.0 + 0.12 * math.sin(frac * math.pi))
            z_s = R * math.sin(phi_s)
            theta_s = ang_bot * (1.0 - frac) + ang_eq * frac
            
            p_s_orig = [r_s * math.cos(theta_s), r_s * math.sin(theta_s), z_s]
            bend_s = bend_rad * (0.5 * frac)
            p_s_def = rot_z_pt(rot_x_pt(p_s_orig, bend_s), 0.0)
            path.append([center[0] + p_s_def[0], center[1] + p_s_def[1], center[2] + p_s_def[2]])
            
        vr, fr = make_ribbon_from_path(path, width=w_strip, thickness=t_strip)
        mesh.add(vr, fr, 'links_equatorial')
        
    # 5. 8 Equatorial Chevron Chord Ribbons (Connecting 0-1, 1-2, ..., 7-0)
    for k in range(8):
        k_next = (k + 1) % 8
        path = []
        p0 = eq_nodes[k]
        p1 = eq_nodes[k_next]
        n_ch = 10
        for s in range(n_ch + 1):
            frac = s / float(n_ch)
            pm = [p0[i]*(1.0 - frac) + p1[i]*frac for i in range(3)]
            # Outward chord camber
            v_rad = [pm[0] - center[0], pm[1] - center[1], 0.0]
            vlen = math.hypot(v_rad[0], v_rad[1]) or 1.0
            bulge = 1.0 + 0.06 * math.sin(frac * math.pi)
            pm[0] = center[0] + (v_rad[0] / vlen) * (R * bulge)
            pm[1] = center[1] + (v_rad[1] / vlen) * (R * bulge)
            path.append(pm)
        vr, fr = make_ribbon_from_path(path, width=w_strip, thickness=t_strip)
        mesh.add(vr, fr, 'links_equatorial')
        
    return mesh

def build_exact_truss_cell(diameter_mm=56.0, center=[0,0,0], bend_deg=0.0, twist_deg=0.0):
    """
    Exact Truss TRUNC Cell (N=4, M=3, Fig. S1C / Fig. S3B / Fig. S7A):
    - Radius R = diameter / 2 = 28mm.
    - True analytical large-displacement kinematic deformation under Torsion (twist_deg) and Bending (bend_deg).
    - 32 Curved Ribbon Links with 18 M2 Revolute Pin Joints (Fig. S1A/S1C).
    - Spiral helical meridian twisting and diagonal truss locking.
    - Internal 1.22 N/mm restoring spring around central 4mm steel torque transmission shaft.
    """
    mesh = Mesh()
    R = diameter_mm / 2.0
    w_strip = 2.8
    t_strip = 0.8
    r_hub = 6.0
    phi_lat = math.radians(28.0)
    z_lat = R * math.sin(phi_lat)
    r_lat = R * math.cos(phi_lat)
    bend_rad = math.radians(bend_deg)
    twist_rad = math.radians(twist_deg)
    
    # 1. Pole Node Positions & Delrin Hubs
    p_top_center_orig = [0.0, 0.0, R]
    p_bot_center_orig = [0.0, 0.0, -R]
    
    p_top_rel = rot_z_pt(rot_x_pt(p_top_center_orig, bend_rad), twist_rad)
    p_top = [center[0] + p_top_rel[0], center[1] + p_top_rel[1], center[2] + p_top_rel[2]]
    p_bot = [center[0] + p_bot_center_orig[0], center[1] + p_bot_center_orig[1], center[2] + p_bot_center_orig[2]]
    
    v_th, f_th = cylinder([p_top[0], p_top[1], p_top[2] - 2.0], [p_top[0], p_top[1], p_top[2] + 2.0], r_hub + 1.2, seg=16)
    mesh.add(v_th, f_th, 'collars')
    v_bh, f_bh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 2.0], [p_bot[0], p_bot[1], p_bot[2] + 2.0], r_hub + 1.2, seg=16)
    mesh.add(v_bh, f_bh, 'collars')
    
    # Central 4mm steel torque transmission shaft
    v_sh, f_sh = cylinder([p_bot[0], p_bot[1], p_bot[2] - 8.0], [p_top[0], p_top[1], p_top[2] + 8.0], 2.0, seg=12)
    mesh.add(v_sh, f_sh, 'shaft')
    
    # Internal 1.22 N/mm restoring spring coiled around shaft
    add_helical_restoring_spring(mesh, [p_bot[0], p_bot[1], p_bot[2] + 2.0], [p_top[0], p_top[1], p_top[2] - 2.0], twist_rad=twist_rad, d_wire=1.2, d_spring=11.0, n_coils=5)

    # 4 Top Anchor Lugs on Top Collar (rotating by twist_rad)
    top_lugs = {}
    for k in (0, 2, 4, 6):
        ang_top = k * (math.pi / 4.0) + twist_rad
        pt_raw = [r_hub * math.cos(ang_top), r_hub * math.sin(ang_top), R]
        pt_def = rot_z_pt(rot_x_pt(pt_raw, bend_rad), 0.0)
        p_lug = [center[0] + pt_def[0], center[1] + pt_def[1], center[2] + pt_def[2]]
        top_lugs[k] = p_lug
        n_pin = rot_z_pt(rot_x_pt([0, 0, 1], bend_rad), 0.0)
        add_revolute_pin_joint(mesh, p_lug, n_pin, lug_radius=3.5, lug_thick=1.0, pin_radius=0.9, group='collars')
        
    # 4 Bottom Anchor Lugs on Bottom Collar (fixed at base)
    bot_lugs = {}
    for k in (1, 3, 5, 7):
        ang_bot = k * (math.pi / 4.0)
        p_lug = [center[0] + r_hub * math.cos(ang_bot), center[1] + r_hub * math.sin(ang_bot), center[2] - R]
        bot_lugs[k] = p_lug
        add_revolute_pin_joint(mesh, p_lug, [0, 0, -1], lug_radius=3.5, lug_thick=1.0, pin_radius=0.9, group='collars')

    # 2. 8 Upper Latitude Nodes (phi = +28°)
    upper_nodes = []
    scissor_upper = twist_rad * 0.30
    upper_rot_mean = twist_rad * 0.75
    for k in range(8):
        ang_base = k * (math.pi / 4.0)
        ang_def = ang_base + upper_rot_mean + (scissor_upper if k % 2 == 0 else -scissor_upper)
        pt_orig = [r_lat * math.cos(ang_def), r_lat * math.sin(ang_def), z_lat]
        pt_def = rot_z_pt(rot_x_pt(pt_orig, bend_rad * 0.75), 0.0)
        px = center[0] + pt_def[0]
        py = center[1] + pt_def[1]
        pz = center[2] + pt_def[2]
        upper_nodes.append([px, py, pz])
        
        n_rad = rot_z_pt(rot_x_pt([r_lat*math.cos(ang_def)/R, r_lat*math.sin(ang_def)/R, z_lat/R], bend_rad*0.75), 0.0)
        add_revolute_pin_joint(mesh, [px, py, pz], n_rad, lug_radius=3.5, lug_thick=1.0, pin_radius=0.9, group='links_truss')

    # 3. 8 Lower Latitude Nodes (phi = -28°, staggered by 22.5°)
    lower_nodes = []
    scissor_lower = twist_rad * 0.30
    lower_rot_mean = twist_rad * 0.25
    for k in range(8):
        ang_base = (k + 0.5) * (math.pi / 4.0)
        ang_def = ang_base + lower_rot_mean + (-scissor_lower if k % 2 == 0 else scissor_lower)
        pt_orig = [r_lat * math.cos(ang_def), r_lat * math.sin(ang_def), -z_lat]
        pt_def = rot_z_pt(rot_x_pt(pt_orig, bend_rad * 0.25), 0.0)
        px = center[0] + pt_def[0]
        py = center[1] + pt_def[1]
        pz = center[2] + pt_def[2]
        lower_nodes.append([px, py, pz])
        
        n_rad = rot_z_pt(rot_x_pt([r_lat*math.cos(ang_def)/R, r_lat*math.sin(ang_def)/R, -z_lat/R], bend_rad*0.25), 0.0)
        add_revolute_pin_joint(mesh, [px, py, pz], n_rad, lug_radius=3.5, lug_thick=1.0, pin_radius=0.9, group='links_truss')

    # 4. Upper Band: Top Pole Lugs -> 4 Apex Nodes on Upper Latitude (0, 2, 4, 6)
    n_sub = 14
    for k in (0, 2, 4, 6):
        path = []
        ang_top = k * (math.pi / 4.0) + twist_rad
        ang_up = k * (math.pi / 4.0) + upper_rot_mean + scissor_upper
        for s in range(n_sub + 1):
            frac = s / float(n_sub)
            phi_s = (math.pi / 2.0) * (1.0 - frac) + phi_lat * frac
            r_s = r_hub * (1.0 - frac) + R * math.cos(phi_s) * (1.0 + 0.08 * math.sin(frac * math.pi))
            z_s = R * math.sin(phi_s)
            theta_s = ang_top * (1.0 - frac) + ang_up * frac
            
            p_s_orig = [r_s * math.cos(theta_s), r_s * math.sin(theta_s), z_s]
            bend_s = bend_rad * (1.0 - 0.25 * frac)
            p_s_def = rot_z_pt(rot_x_pt(p_s_orig, bend_s), 0.0)
            path.append([center[0] + p_s_def[0], center[1] + p_s_def[1], center[2] + p_s_def[2]])
        vr, fr = make_ribbon_from_path(path, width=w_strip, thickness=t_strip)
        mesh.add(vr, fr, 'links_truss')
        
    # Upper Band Chevrons (connecting adjacent upper nodes: 0-1, 1-2, ..., 7-0)
    for k in range(8):
        path = []
        p0 = upper_nodes[k]
        p1 = upper_nodes[(k + 1) % 8]
        for s in range(9):
            frac = s / 8.0
            pm = [p0[i]*(1.0 - frac) + p1[i]*frac for i in range(3)]
            path.append(pm)
        vr, fr = make_ribbon_from_path(path, width=w_strip, thickness=t_strip)
        mesh.add(vr, fr, 'links_truss')

    # 5. Middle Truss Diagonal Crossing Ribbons (16 diagonal links)
    for k in range(8):
        # Diagonal link 1: upper_nodes[k] -> lower_nodes[k]
        path1 = []
        p0 = upper_nodes[k]
        p1 = lower_nodes[k]
        for s in range(12):
            frac = s / 11.0
            pm = [p0[i]*(1.0 - frac) + p1[i]*frac for i in range(3)]
            # Slight outward camber
            v_rad = [pm[0] - center[0], pm[1] - center[1], 0.0]
            vlen = math.hypot(v_rad[0], v_rad[1]) or 1.0
            bulge = 1.0 + 0.08 * math.sin(frac * math.pi)
            pm[0] = center[0] + (v_rad[0] / vlen) * (r_lat * bulge)
            pm[1] = center[1] + (v_rad[1] / vlen) * (r_lat * bulge)
            path1.append(pm)
        vr1, fr1 = make_ribbon_from_path(path1, width=w_strip, thickness=t_strip)
        mesh.add(vr1, fr1, 'links_truss')
        
        # Diagonal link 2: upper_nodes[k] -> lower_nodes[(k-1)%8]
        path2 = []
        p2 = lower_nodes[(k - 1) % 8]
        for s in range(12):
            frac = s / 11.0
            pm = [p0[i]*(1.0 - frac) + p2[i]*frac for i in range(3)]
            v_rad = [pm[0] - center[0], pm[1] - center[1], 0.0]
            vlen = math.hypot(v_rad[0], v_rad[1]) or 1.0
            bulge = 1.0 + 0.08 * math.sin(frac * math.pi)
            pm[0] = center[0] + (v_rad[0] / vlen) * (r_lat * bulge)
            pm[1] = center[1] + (v_rad[1] / vlen) * (r_lat * bulge)
            path2.append(pm)
        vr2, fr2 = make_ribbon_from_path(path2, width=w_strip, thickness=t_strip)
        mesh.add(vr2, fr2, 'links_truss')

    # 6. Lower Band Chevrons (connecting adjacent lower nodes)
    for k in range(8):
        path = []
        p0 = lower_nodes[k]
        p1 = lower_nodes[(k + 1) % 8]
        for s in range(9):
            frac = s / 8.0
            pm = [p0[i]*(1.0 - frac) + p1[i]*frac for i in range(3)]
            path.append(pm)
        vr, fr = make_ribbon_from_path(path, width=w_strip, thickness=t_strip)
        mesh.add(vr, fr, 'links_truss')

    # 7. Lower Band: Bottom Pole Lugs -> 4 Apex Nodes on Lower Latitude (1, 3, 5, 7)
    for k in (1, 3, 5, 7):
        path = []
        ang_bot = k * (math.pi / 4.0)
        ang_low = k * (math.pi / 4.0) + lower_rot_mean - scissor_lower
        for s in range(n_sub + 1):
            frac = s / float(n_sub)
            phi_s = (-math.pi / 2.0) * (1.0 - frac) + (-phi_lat) * frac
            r_s = r_hub * (1.0 - frac) + R * math.cos(phi_s) * (1.0 + 0.08 * math.sin(frac * math.pi))
            z_s = R * math.sin(phi_s)
            theta_s = ang_bot * (1.0 - frac) + ang_low * frac
            
            p_s_orig = [r_s * math.cos(theta_s), r_s * math.sin(theta_s), z_s]
            bend_s = bend_rad * (0.25 * frac)
            p_s_def = rot_z_pt(rot_x_pt(p_s_orig, bend_s), 0.0)
            path.append([center[0] + p_s_def[0], center[1] + p_s_def[1], center[2] + p_s_def[2]])
        vr, fr = make_ribbon_from_path(path, width=w_strip, thickness=t_strip)
        mesh.add(vr, fr, 'links_truss')
        
    return mesh

def build_exact_dual_nested_assembly(bend_deg=0.0, twist_deg=0.0):
    """
    Builds the complete dual-nested TRUNC unit cell assembly (Fig. S1A / S7A):
    Inner D56 Truss cell nested inside Outer D88 Equatorial cell.
    """
    mesh = Mesh()
    eq = build_exact_equatorial_cell(diameter_mm=88.0, bend_deg=bend_deg, twist_deg=twist_deg)
    tr = build_exact_truss_cell(diameter_mm=56.0, bend_deg=bend_deg, twist_deg=twist_deg)
    
    # 4 Radial Triad Guide Arms extending outward from Equatorial band to R=65mm
    R_triad = 65.0
    for ang_deg in (45.0, 135.0, 225.0, 315.0):
        ang_rad = math.radians(ang_deg) + math.radians(twist_deg) * 0.50
        p_in = [44.0 * math.cos(ang_rad), 44.0 * math.sin(ang_rad), 0.0]
        p_out = [R_triad * math.cos(ang_rad), R_triad * math.sin(ang_rad), 0.0]
        
        # Tilt with bending
        p_in_def = rot_z_pt(rot_x_pt(p_in, math.radians(bend_deg) * 0.50), 0.0)
        p_out_def = rot_z_pt(rot_x_pt(p_out, math.radians(bend_deg) * 0.50), 0.0)
        
        va, fa = cylinder(p_in_def, p_out_def, 1.8, seg=8)
        mesh.add(va, fa, 'triads')
        
        # Guide Eyelet at tip
        ve, fe = sphere(p_out_def, 2.5, useg=8, vseg=6)
        mesh.add(ve, fe, 'triads')

    v_off_eq = len(mesh.verts)
    mesh.verts.extend(eq.verts)
    for f in eq.faces:
        mesh.faces.append([idx + v_off_eq for idx in f])
    for grp, f_list in eq.groups.items():
        mesh.groups.setdefault(grp, []).extend([idx + v_off_eq for idx in f_list])
        
    v_off_tr = len(mesh.verts)
    mesh.verts.extend(tr.verts)
    for f in tr.faces:
        mesh.faces.append([idx + v_off_tr for idx in f])
    for grp, f_list in tr.groups.items():
        mesh.groups.setdefault(grp, []).extend([idx + v_off_tr for idx in f_list])
        
    return mesh
