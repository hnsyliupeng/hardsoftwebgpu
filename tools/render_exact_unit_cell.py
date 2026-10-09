import sys, os, math
sys.path.insert(0, 'python')

from trunclib.plot import Canvas, Camera, render_mesh
from trunclib.model3d import Mesh, sphere, cylinder, ring

# =============================================================================
# Continuous Smooth Spherical Linkage TRUNC CAD Model (Monolithic Sheet Metal)
# =============================================================================

def make_box(center, size):
    hx, hy, hz = [s * 0.5 for s in size]
    p_min = [center[0] - hx, center[1] - hy, center[2] - hz]
    p_max = [center[0] + hx, center[1] + hy, center[2] + hz]
    verts = [
        [p_min[0], p_min[1], p_min[2]], [p_max[0], p_max[1], p_min[2]],
        [p_max[0], p_max[1], p_min[2]], [p_min[0], p_max[1], p_min[2]],
        [p_min[0], p_min[1], p_max[2]], [p_max[0], p_min[1], p_max[2]],
        [p_max[0], p_max[1], p_max[2]], [p_min[0], p_max[1], p_max[2]],
    ]
    faces = [
        [0, 1, 2], [0, 2, 3],
        [4, 6, 5], [4, 7, 6],
        [0, 4, 5], [0, 5, 1],
        [2, 6, 7], [2, 7, 3],
        [0, 3, 7], [0, 7, 4],
        [1, 5, 6], [1, 6, 2],
    ]
    return verts, faces

def make_continuous_curved_strip(p0, p1, r_sphere, width=5.0, thickness=1.6, n_sub=18):
    """
    Builds a single contiguous, seamless, smoothly curved 3D spring-steel ribbon
    between p0 and p1 on a sphere of radius r_sphere.
    """
    pts = []
    rad_norms = []
    for step in range(n_sub + 1):
        alpha = step / float(n_sub)
        interp = [p0[i] * (1.0 - alpha) + p1[i] * alpha for i in range(3)]
        L = math.sqrt(sum(c * c for c in interp)) or 1.0
        s_pt = [c * (r_sphere / L) for c in interp]
        pts.append(s_pt)
        rad_norms.append([c / r_sphere for c in s_pt])
        
    hw = width * 0.5
    ht = thickness * 0.5
    verts = []
    
    for i in range(n_sub + 1):
        p = pts[i]
        rn = rad_norms[i]
        if i == 0:
            tang = [pts[1][k] - pts[0][k] for k in range(3)]
        elif i == n_sub:
            tang = [pts[-1][k] - pts[-2][k] for k in range(3)]
        else:
            tang = [pts[i+1][k] - pts[i-1][k] for k in range(3)]
        tlen = math.sqrt(sum(c*c for c in tang)) or 1.0
        tang = [c / tlen for c in tang]
        
        lat = [
            tang[1]*rn[2] - tang[2]*rn[1],
            tang[2]*rn[0] - tang[0]*rn[2],
            tang[0]*rn[1] - tang[1]*rn[0]
        ]
        llen = math.sqrt(sum(c*c for c in lat)) or 1.0
        lat = [c / llen for c in lat]
        
        v0 = [p[k] - hw*lat[k] - ht*rn[k] for k in range(3)]
        v1 = [p[k] + hw*lat[k] - ht*rn[k] for k in range(3)]
        v2 = [p[k] + hw*lat[k] + ht*rn[k] for k in range(3)]
        v3 = [p[k] - hw*lat[k] + ht*rn[k] for k in range(3)]
        verts.extend([v0, v1, v2, v3])
        
    faces = []
    for i in range(n_sub):
        b0 = i * 4
        b1 = (i + 1) * 4
        for side in range(4):
            s_next = (side + 1) % 4
            p00 = b0 + side
            p01 = b0 + s_next
            p10 = b1 + side
            p11 = b1 + s_next
            faces.append([p00, p10, p11])
            faces.append([p00, p11, p01])
            
    # Start and end caps
    faces.append([0, 3, 2])
    faces.append([0, 2, 1])
    last = n_sub * 4
    faces.append([last + 0, last + 1, last + 2])
    faces.append([last + 0, last + 2, last + 3])
    
    return verts, faces

def make_conical_spring(r_base=16.0, r_top=8.0, h_total=48.0, turns=4.5, wire_r=0.9, n_steps=180):
    """Generates continuous smooth 3D conical helical restoring spring mesh."""
    pts = []
    for i in range(n_steps + 1):
        t = i / float(n_steps)
        theta = t * turns * 2 * math.pi
        r = r_base * (1.0 - t) + r_top * t
        z = -h_total * 0.5 + t * h_total
        pts.append([r * math.cos(theta), r * math.sin(theta), z])
    
    verts = []
    faces = []
    n_circ = 8
    
    for i, p in enumerate(pts):
        if i == 0:
            tang = [pts[1][k] - pts[0][k] for k in range(3)]
        elif i == len(pts) - 1:
            tang = [pts[-1][k] - pts[-2][k] for k in range(3)]
        else:
            tang = [pts[i+1][k] - pts[i-1][k] for k in range(3)]
        tlen = math.sqrt(sum(c*c for c in tang)) or 1.0
        tang = [c / tlen for c in tang]
        
        up = [0, 0, 1] if abs(tang[2]) < 0.9 else [1, 0, 0]
        n1 = [
            tang[1]*up[2] - tang[2]*up[1],
            tang[2]*up[0] - tang[0]*up[2],
            tang[0]*up[1] - tang[1]*up[0]
        ]
        n1_len = math.sqrt(sum(c*c for c in n1)) or 1.0
        n1 = [c / n1_len for c in n1]
        n2 = [
            tang[1]*n1[2] - tang[2]*n1[1],
            tang[2]*n1[0] - tang[0]*n1[2],
            tang[0]*n1[1] - tang[1]*n1[0]
        ]
        
        for ci in range(n_circ):
            ang = (2 * math.pi / n_circ) * ci
            cp = [
                p[k] + wire_r * math.cos(ang) * n1[k] + wire_r * math.sin(ang) * n2[k]
                for k in range(3)
            ]
            verts.append(cp)
            
    for i in range(len(pts) - 1):
        b0 = i * n_circ
        b1 = (i + 1) * n_circ
        for ci in range(n_circ):
            c_next = (ci + 1) % n_circ
            faces.append([b0 + ci, b1 + ci, b1 + c_next])
            faces.append([b0 + ci, b1 + c_next, b0 + c_next])
            
    return verts, faces

def make_revolute_pin_m2(center, normal, length=8.0, head_r=2.2, shaft_r=1.0):
    """Generates standard M2 socket head cap screw with cylindrical head and nylon lock nut."""
    nlen = math.sqrt(sum(c * c for c in normal)) or 1.0
    norm = [c / nlen for c in normal]
    
    p0 = [center[i] - norm[i] * (length * 0.5) for i in range(3)]
    p1 = [center[i] + norm[i] * (length * 0.5) for i in range(3)]
    p_head = [center[i] + norm[i] * (length * 0.5 + 2.0) for i in range(3)]
    p_nut = [center[i] - norm[i] * (length * 0.5 + 1.8) for i in range(3)]
    
    mesh = Mesh()
    # Shaft
    v_s, f_s = cylinder(p0, p1, shaft_r, seg=10)
    mesh.add(v_s, f_s, 'pins')
    # M2 Socket Head
    v_h, f_h = cylinder(p1, p_head, head_r, seg=12)
    mesh.add(v_h, f_h, 'pins')
    # M2 Nylon Lock Nut
    v_n, f_n = cylinder(p0, p_nut, head_r * 0.9, seg=6)
    mesh.add(v_n, f_n, 'pins')
    return mesh.verts, mesh.faces

# =============================================================================
# Sub-Assemblies (Arrowhead, Equatorial, Truss, Dual-Nested)
# =============================================================================

def build_arrowhead_element():
    """Double-arrowhead planar/curved linkage element (Paper Fig. S1A)."""
    mesh = Mesh()
    R = 44.0
    p_top = [0.0, 0.0, 22.0]
    p_bot = [0.0, 0.0, -22.0]
    p_left = [-20.0, 0.0, 0.0]
    p_right = [20.0, 0.0, 0.0]
    
    # 4 flat spring-steel links (w=5mm, t=1.6mm)
    v1, f1 = make_continuous_curved_strip(p_top, p_left, R, width=5.0, thickness=1.6, n_sub=12)
    v2, f2 = make_continuous_curved_strip(p_top, p_right, R, width=5.0, thickness=1.6, n_sub=12)
    v3, f3 = make_continuous_curved_strip(p_left, p_bot, R, width=5.0, thickness=1.6, n_sub=12)
    v4, f4 = make_continuous_curved_strip(p_right, p_bot, R, width=5.0, thickness=1.6, n_sub=12)
    
    mesh.add(v1, f1, 'links')
    mesh.add(v2, f2, 'links')
    mesh.add(v3, f3, 'links')
    mesh.add(v4, f4, 'links')
    
    # 4 Revolute pin screws
    for pt in [p_top, p_bot, p_left, p_right]:
        vp, fp = make_revolute_pin_m2(pt, [0, 1, 0], length=6.0, head_r=2.0)
        mesh.add(vp, fp, 'pins')
        
    return mesh

def build_equatorial_cell():
    """
    Equatorial TRUNC Unit Cell (Paper Fig. S1B / Fig. 2A, D=88mm, M=2, N=4).
    Continuous smooth spring-steel ribbons from collars to equator.
    """
    mesh = Mesh()
    R = 44.0
    N = 4
    
    # Square mounting collar blocks (18x18x10 mm)
    v_top_b, f_top_b = make_box([0, 0, 24.0], [18.0, 18.0, 10.0])
    v_bot_b, f_bot_b = make_box([0, 0, -24.0], [18.0, 18.0, 10.0])
    mesh.add(v_top_b, f_top_b, 'collars')
    mesh.add(v_bot_b, f_bot_b, 'collars')
    
    # Central 4mm Ground Steel Drive Shaft
    v_sh, f_sh = cylinder([0, 0, 32.0], [0, 0, -32.0], 2.0, seg=16)
    mesh.add(v_sh, f_sh, 'shaft')
    
    # Internal 1.22 N/mm Conical Restoring Spring
    v_sp, f_sp = make_conical_spring(r_base=16.0, r_top=9.0, h_total=40.0, turns=4.5, wire_r=0.9)
    mesh.add(v_sp, f_sp, 'spring')
    
    # 8 Equatorial Chevron Pins on Equatorial Circle
    eq_pts = []
    for k in range(2 * N):
        ang = (2 * math.pi / (2 * N)) * k
        eq_pts.append([R * math.cos(ang), R * math.sin(ang), 0.0])
        
    # 8 Equatorial Continuous Chevron Flat Strips
    for k in range(2 * N):
        p_a = eq_pts[k]
        p_b = eq_pts[(k + 1) % (2 * N)]
        v_link, f_link = make_continuous_curved_strip(p_a, p_b, R, width=5.0, thickness=1.6, n_sub=14)
        mesh.add(v_link, f_link, 'links_equatorial')
        
    # 4 Upper & 4 Lower Continuous Meridian Arches (Top Collar -> Equator -> Bottom Collar)
    top_anchor_z = 22.0
    bot_anchor_z = -22.0
    for k in range(0, 2 * N, 2):
        ang = (2 * math.pi / (2 * N)) * k
        p_top_anchor = [9.0 * math.cos(ang), 9.0 * math.sin(ang), top_anchor_z]
        p_bot_anchor = [9.0 * math.cos(ang), 9.0 * math.sin(ang), bot_anchor_z]
        p_eq = eq_pts[k]
        
        # Upper continuous arch
        v_up, f_up = make_continuous_curved_strip(p_top_anchor, p_eq, R, width=5.0, thickness=1.6, n_sub=18)
        mesh.add(v_up, f_up, 'links_equatorial')
        # Lower continuous arch
        v_dn, f_dn = make_continuous_curved_strip(p_bot_anchor, p_eq, R, width=5.0, thickness=1.6, n_sub=18)
        mesh.add(v_dn, f_dn, 'links_equatorial')

    # M2 Revolute Socket Screws at All 8 Equatorial Pins
    for pt in eq_pts:
        norm = [pt[0] / R, pt[1] / R, 0.0]
        vp, fp = make_revolute_pin_m2(pt, norm, length=8.0, head_r=2.2)
        mesh.add(vp, fp, 'pins')
        
    return mesh

def build_truss_cell():
    """
    Truss TRUNC Unit Cell (Paper Fig. S1C & Prototype Photo, D=56mm, M=3, N=4, 52.0x Torsion).
    32 continuous diagonal spring-steel strips in 3-latitude triangulated cage.
    """
    mesh = Mesh()
    R = 28.0
    N = 4
    
    v_top_b, f_top_b = make_box([0, 0, 18.0], [14.0, 14.0, 8.0])
    v_bot_b, f_bot_b = make_box([0, 0, -18.0], [14.0, 14.0, 8.0])
    mesh.add(v_top_b, f_top_b, 'collars')
    mesh.add(v_bot_b, f_bot_b, 'collars')
    
    v_sh, f_sh = cylinder([0, 0, 26.0], [0, 0, -26.0], 2.0, seg=16)
    mesh.add(v_sh, f_sh, 'shaft')
    
    v_sp, f_sp = make_conical_spring(r_base=11.0, r_top=6.5, h_total=30.0, turns=4.0, wire_r=0.8)
    mesh.add(v_sp, f_sp, 'spring')
    
    # 3 Latitude Rings: Upper (+14mm), Equator (0mm), Lower (-14mm)
    z_lat = 14.0
    r_lat = math.sqrt(R * R - z_lat * z_lat)
    
    ring_upper = []
    ring_equator = []
    ring_lower = []
    
    for k in range(2 * N):
        ang = (2 * math.pi / (2 * N)) * k
        ring_equator.append([R * math.cos(ang), R * math.sin(ang), 0.0])
        ring_upper.append([r_lat * math.cos(ang), r_lat * math.sin(ang), z_lat])
        ring_lower.append([r_lat * math.cos(ang), r_lat * math.sin(ang), -z_lat])

    # 32 Continuous Crossing Diagonal Spring-Steel Flat Strips
    for k in range(2 * N):
        k_next = (k + 1) % (2 * N)
        k_prev = (k - 1 + 2 * N) % (2 * N)
        
        # Upper to Equator
        v1, f1 = make_continuous_curved_strip(ring_upper[k], ring_equator[k_next], R, width=4.5, thickness=1.4, n_sub=12)
        v2, f2 = make_continuous_curved_strip(ring_upper[k], ring_equator[k_prev], R, width=4.5, thickness=1.4, n_sub=12)
        mesh.add(v1, f1, 'links_truss')
        mesh.add(v2, f2, 'links_truss')
        
        # Equator to Lower
        v3, f3 = make_continuous_curved_strip(ring_equator[k], ring_lower[k_next], R, width=4.5, thickness=1.4, n_sub=12)
        v4, f4 = make_continuous_curved_strip(ring_equator[k], ring_lower[k_prev], R, width=4.5, thickness=1.4, n_sub=12)
        mesh.add(v3, f3, 'links_truss')
        mesh.add(v4, f4, 'links_truss')

    # Top & Bottom collar connection strips
    for k in range(0, 2 * N, 2):
        ang = (2 * math.pi / (2 * N)) * k
        p_top_a = [7.0 * math.cos(ang), 7.0 * math.sin(ang), 16.0]
        p_bot_a = [7.0 * math.cos(ang), 7.0 * math.sin(ang), -16.0]
        v_t, f_t = make_continuous_curved_strip(p_top_a, ring_upper[k], R, width=4.5, thickness=1.4, n_sub=10)
        v_b, f_b = make_continuous_curved_strip(p_bot_a, ring_lower[k], R, width=4.5, thickness=1.4, n_sub=10)
        mesh.add(v_t, f_t, 'links_truss')
        mesh.add(v_b, f_b, 'links_truss')

    # M2 Revolute Pins at all 16 Ring Nodes
    for pt in ring_equator:
        norm = [pt[0] / R, pt[1] / R, 0.0]
        vp, fp = make_revolute_pin_m2(pt, norm, length=7.0, head_r=2.0)
        mesh.add(vp, fp, 'pins')
    for pt in ring_upper:
        norm = [pt[0] / R, pt[1] / R, pt[2] / R]
        vp, fp = make_revolute_pin_m2(pt, norm, length=7.0, head_r=2.0)
        mesh.add(vp, fp, 'pins')
    for pt in ring_lower:
        norm = [pt[0] / R, pt[1] / R, pt[2] / R]
        vp, fp = make_revolute_pin_m2(pt, norm, length=7.0, head_r=2.0)
        mesh.add(vp, fp, 'pins')

    return mesh

def build_dual_nested_assembly():
    """Dual-Nested Concentric Unit Cell Assembly (Truss D=56 inside Equatorial D=88 + Triad)."""
    mesh = Mesh()
    truss = build_truss_cell()
    for grp, f_idxs in truss.groups.items():
        for fi in f_idxs:
            f = truss.faces[fi]
            v0, v1, v2 = truss.verts[f[0]], truss.verts[f[1]], truss.verts[f[2]]
            mesh.add([v0, v1, v2], [[0, 1, 2]], group=grp)
            
    eq = build_equatorial_cell()
    for grp, f_idxs in eq.groups.items():
        for fi in f_idxs:
            f = eq.faces[fi]
            v0, v1, v2 = eq.verts[f[0]], eq.verts[f[1]], eq.verts[f[2]]
            mesh.add([v0, v1, v2], [[0, 1, 2]], group=grp)
            
    # Gold Tendon Guide Triad (R=65mm)
    for arm_idx in range(3):
        ang = arm_idx * (2 * math.pi / 3)
        p0 = [0, 0, 0]
        p1 = [65.0 * math.cos(ang), 65.0 * math.sin(ang), 0]
        sv, sf = cylinder(p0, p1, 3.5, seg=8)
        mesh.add(sv, sf, 'triad')
        rv, rf = sphere(p1, 5.0, useg=10, vseg=6)
        mesh.add(rv, rf, 'triad')
        
    return mesh

colors = {
    'links_truss': (40, 110, 220),       # Blue Spring Steel
    'links_equatorial': (220, 110, 35),  # Orange Spring Steel
    'links': (220, 110, 35),
    'pins': (210, 220, 230),             # Metallic Steel Pins
    'spring': (140, 180, 200),           # Conical Spring
    'collars': (30, 35, 45),             # Dark Delrin Collars
    'shaft': (180, 190, 200),            # Ground Steel Shaft
    'triad': (230, 190, 60),             # Gold Guide Triad
}

def to_view(p):
    return [p[0], -p[2], p[1]]

def render_all_panels():
    w, h = 1200, 900
    canvas = Canvas(w, h, bg=(255, 255, 255), supersample=2)
    pw, ph = w // 2, h // 2
    
    # Panel A: Double Arrowhead
    ca = Canvas(pw, ph, bg=(255, 255, 255), supersample=2)
    ma = build_arrowhead_element()
    va = [to_view(v) for v in ma.verts]
    cam_a = Camera(eye=[0, 0, 90], target=[0, 0, 0], up=[0, 1, 0], fov_deg=35, width=pw, height=ph)
    for grp, col in colors.items():
        idx = ma.groups.get(grp, [])
        if idx:
            sub = {'verts': va, 'faces': [ma.faces[i] for i in idx]}
            render_mesh(ca, sub, cam_a, color=col, light=[0.6, 0.8, -0.7], ambient=0.55)
    ca.text(25, 25, "(A) DOUBLE-ARROWHEAD AUXETIC ELEMENT (FIG. S1A)", (20, 30, 50), scale=2)
    ca.text(25, 50, "4 Spring-Steel Links (w=5.0mm, t=1.6mm) + 4 Revolute Pins", (80, 90, 110), scale=1)
    
    # Panel B: Equatorial Cell
    cb = Canvas(pw, ph, bg=(255, 255, 255), supersample=2)
    mb = build_equatorial_cell()
    vb = [to_view(v) for v in mb.verts]
    cam_b = Camera(eye=[80, 60, 115], target=[0, 0, 0], up=[0, 1, 0], fov_deg=40, width=pw, height=ph)
    for grp, col in colors.items():
        idx = mb.groups.get(grp, [])
        if idx:
            sub = {'verts': vb, 'faces': [mb.faces[i] for i in idx]}
            render_mesh(cb, sub, cam_b, color=col, light=[0.6, 0.8, -0.7], ambient=0.55)
    cb.text(25, 25, "(B) EQUATORIAL TRUNC CELL (D=88mm, M=2, N=4)", (20, 30, 50), scale=2)
    cb.text(25, 50, "8 Continuous Equatorial Chevrons + 8 Continuous Meridian Arches", (80, 90, 110), scale=1)

    # Panel C: Truss Cell
    cc = Canvas(pw, ph, bg=(255, 255, 255), supersample=2)
    mc = build_truss_cell()
    vc = [to_view(v) for v in mc.verts]
    cam_c = Camera(eye=[62, 42, 90], target=[0, 0, 0], up=[0, 1, 0], fov_deg=40, width=pw, height=ph)
    for grp, col in colors.items():
        idx = mc.groups.get(grp, [])
        if idx:
            sub = {'verts': vc, 'faces': [mc.faces[i] for i in idx]}
            render_mesh(cc, sub, cam_c, color=col, light=[0.6, 0.8, -0.7], ambient=0.55)
    cc.text(25, 25, "(C) TRUSS TRUNC CELL (D=56mm, M=3, 52.0x TORSION)", (20, 30, 50), scale=2)
    cc.text(25, 50, "32 Continuous Geodesic Strips + 16 M2 Screws + Conical Spring", (80, 90, 110), scale=1)

    # Panel D: Dual Nested Concentric Assembly
    cd = Canvas(pw, ph, bg=(255, 255, 255), supersample=2)
    md = build_dual_nested_assembly()
    vd = [to_view(v) for v in md.verts]
    cam_d = Camera(eye=[90, 60, 125], target=[0, 0, 0], up=[0, 1, 0], fov_deg=42, width=pw, height=ph)
    for grp, col in colors.items():
        idx = md.groups.get(grp, [])
        if idx:
            sub = {'verts': vd, 'faces': [md.faces[i] for i in idx]}
            render_mesh(cd, sub, cam_d, color=col, light=[0.6, 0.8, -0.7], ambient=0.55)
    cd.text(25, 25, "(D) DUAL-NESTED ASSEMBLY (TRUSS D56 INSIDE EQUAT D88)", (20, 30, 50), scale=2)
    cd.text(25, 50, "Inner Truss Torque Shaft + Outer Guide Cage + 65mm Gold Triad", (80, 90, 110), scale=1)

    # Composite 4 Panels
    for py in range(ph):
        for px in range(pw):
            idx = (py * ca.ss) * ca.w + (px * ca.ss)
            canvas.px(px, py, (ca.buf[idx*3], ca.buf[idx*3+1], ca.buf[idx*3+2]))
            canvas.px(px + pw, py, (cb.buf[idx*3], cb.buf[idx*3+1], cb.buf[idx*3+2]))
            canvas.px(px, py + ph, (cc.buf[idx*3], cc.buf[idx*3+1], cc.buf[idx*3+2]))
            canvas.px(px + pw, py + ph, (cd.buf[idx*3], cd.buf[idx*3+1], cd.buf[idx*3+2]))

    canvas.line(0, ph, w, ph, (200, 205, 215), 2)
    canvas.line(pw, 0, pw, h, (200, 205, 215), 2)
    canvas.save_png('docs/unit_cell_exact_paper_structure.png')
    print("  Wrote 4-panel image: docs/unit_cell_exact_paper_structure.png")

if __name__ == '__main__':
    render_all_panels()
