import sys, os, math
sys.path.insert(0, 'python')

from trunclib.plot import Canvas, Camera, render_mesh
from trunclib.model3d import Mesh, sphere, cylinder, ring

# =============================================================================
# Exact Spherical Linkage TRUNC CAD Model (Faithful to Fig. S1 & Prototype Photo)
# =============================================================================

def make_box(center, size):
    hx, hy, hz = [s * 0.5 for s in size]
    p_min = [center[0] - hx, center[1] - hy, center[2] - hz]
    p_max = [center[0] + hx, center[1] + hy, center[2] + hz]
    verts = [
        [p_min[0], p_min[1], p_min[2]], [p_max[0], p_min[1], p_min[2]],
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

def make_curved_strip(p0, p1, r_sphere, width=5.0, thickness=1.6, n_sub=8):
    pts = []
    for step in range(n_sub + 1):
        alpha = step / n_sub
        interp = [p0[i] * (1 - alpha) + p1[i] * alpha for i in range(3)]
        L = math.sqrt(sum(c * c for c in interp)) or 1.0
        s_pt = [c * (r_sphere / L) for c in interp]
        pts.append(s_pt)
    
    verts = []
    faces = []
    for step in range(n_sub):
        a0, a1 = pts[step], pts[step + 1]
        tang = [a1[i] - a0[i] for i in range(3)]
        t_len = math.sqrt(sum(c * c for c in tang)) or 1.0
        tang = [c / t_len for c in tang]
        mid = [(a0[i] + a1[i]) * 0.5 for i in range(3)]
        m_len = math.sqrt(sum(c * c for c in mid)) or 1.0
        rad_norm = [c / m_len for c in mid]
        
        lat = [
            tang[1] * rad_norm[2] - tang[2] * rad_norm[1],
            tang[2] * rad_norm[0] - tang[0] * rad_norm[2],
            tang[0] * rad_norm[1] - tang[1] * rad_norm[0]
        ]
        l_len = math.sqrt(sum(c * c for c in lat)) or 1.0
        lat = [c / l_len for c in lat]
        
        hw = width * 0.5
        ht = thickness * 0.5
        
        c = []
        for p in (a0, a1):
            for sx in (-1, 1):
                for sz in (-1, 1):
                    pt = [p[i] + sx * hw * lat[i] + sz * ht * rad_norm[i] for i in range(3)]
                    c.append(pt)
        
        base = len(verts)
        verts.extend(c)
        faces.extend([
            [base + 0, base + 1, base + 3], [base + 1, base + 2, base + 3],
            [base + 4, base + 6, base + 5], [base + 4, base + 7, base + 6],
            [base + 0, base + 4, base + 5], [base + 0, base + 5, base + 1],
            [base + 1, base + 5, base + 6], [base + 1, base + 6, base + 2],
            [base + 2, base + 6, base + 7], [base + 2, base + 7, base + 3],
            [base + 3, base + 7, base + 4], [base + 3, base + 4, base + 0],
        ])
    return verts, faces

def add_screw_pin(mesh, pos, normal, radius=1.6, head_r=2.8, length=5.0):
    n_len = math.sqrt(sum(c * c for c in normal)) or 1.0
    n = [c / n_len for c in normal]
    p_bot = [pos[i] - n[i] * (length * 0.5) for i in range(3)]
    p_top = [pos[i] + n[i] * (length * 0.5) for i in range(3)]
    p_head = [pos[i] + n[i] * (length * 0.5 + 2.0) for i in range(3)]
    v1, f1 = cylinder(p_bot, p_top, radius, radius, seg=10)
    v2, f2 = cylinder(p_top, p_head, head_r, head_r, seg=10)
    mesh.add(v1, f1, group='pin_screws')
    mesh.add(v2, f2, group='pin_screws')

def add_conical_spring(mesh, z_bot, z_top, r_bot=16.0, r_top=8.5, turns=5.5, wire_r=1.0, segs=80):
    pts = []
    for i in range(segs + 1):
        t = i / segs
        phi = t * turns * 2 * math.pi
        z = z_bot + (z_top - z_bot) * t
        r = r_bot * (1 - t) + r_top * t
        pts.append([r * math.cos(phi), r * math.sin(phi), z])
    for i in range(len(pts) - 1):
        v, f = cylinder(pts[i], pts[i+1], wire_r, wire_r, seg=6)
        mesh.add(v, f, group='spring')

# -----------------------------------------------------------------------------
# 1. Double-Arrowhead Auxetic Element (Fig. S1A)
# -----------------------------------------------------------------------------
def build_arrowhead_element():
    m = Mesh()
    p_apex = [0, 0, 24]
    p_left = [-22, 0, 0]
    p_right = [22, 0, 0]
    p_inner = [0, 0, 11]
    
    links = [
        (p_apex, p_left), (p_apex, p_right),
        (p_left, p_inner), (p_right, p_inner)
    ]
    for p0, p1 in links:
        v, f = make_curved_strip(p0, p1, r_sphere=30.0, width=5.0, thickness=1.6, n_sub=1)
        m.add(v, f, group='strip_links')
    
    for p in (p_apex, p_left, p_right, p_inner):
        add_screw_pin(m, p, [0, 1, 0], radius=1.6, head_r=2.8, length=4.5)
    return m

# -----------------------------------------------------------------------------
# 2. Equatorial TRUNC Unit Cell (Fig. S1B & Fig. 2A: D=88mm, M=2, N=4)
# -----------------------------------------------------------------------------
def build_equatorial_cell():
    m = Mesh()
    r = 44.0  # D = 88 mm
    z_pole = 42.0
    
    # End Collar Blocks
    v_t, f_t = make_box([0, 0, z_pole], [18, 18, 8])
    v_b, f_b = make_box([0, 0, -z_pole], [18, 18, 8])
    m.add(v_t, f_t, group='collars')
    m.add(v_b, f_b, group='collars')
    
    # Central 4mm Drive Shaft
    v_s, f_s = cylinder([0, 0, -z_pole - 12], [0, 0, z_pole + 12], 2.0, 2.0, seg=12)
    m.add(v_s, f_s, group='shaft')
    
    # Conical restoring spring
    add_conical_spring(m, -z_pole + 4, z_pole - 4, r_bot=18.0, r_top=10.0, turns=5.0)
    
    # 8-sector Equatorial Chevron Belt (M=2)
    lat_ang = math.radians(24)
    pins = []
    for k in range(8):
        phi = k * (2 * math.pi / 8)
        lat = lat_ang if (k % 2 == 0) else -lat_ang
        pos = [
            r * math.cos(lat) * math.cos(phi),
            r * math.cos(lat) * math.sin(phi),
            r * math.sin(lat)
        ]
        pins.append(pos)
        add_screw_pin(m, pos, pos, radius=1.6, head_r=2.8, length=5.5)
    
    for k in range(8):
        p0 = pins[k]
        p1 = pins[(k + 1) % 8]
        v, f = make_curved_strip(p0, p1, r_sphere=r, width=5.0, thickness=1.6, n_sub=4)
        m.add(v, f, group='strip_links_equat')
    
    p_top_pole = [0, 0, z_pole - 4]
    for k in (0, 2, 4, 6):
        v, f = make_curved_strip(p_top_pole, pins[k], r_sphere=r, width=5.0, thickness=1.6, n_sub=4)
        m.add(v, f, group='strip_links_equat')
        
    p_bot_pole = [0, 0, -z_pole + 4]
    for k in (1, 3, 5, 7):
        v, f = make_curved_strip(pins[k], p_bot_pole, r_sphere=r, width=5.0, thickness=1.6, n_sub=4)
        m.add(v, f, group='strip_links_equat')
        
    return m

# -----------------------------------------------------------------------------
# 3. Truss TRUNC Unit Cell (Fig. S1C & Prototype Photo: D=56mm, M=3, N=4)
# -----------------------------------------------------------------------------
def build_truss_cell():
    m = Mesh()
    r = 28.0  # D = 56 mm
    z_pole = 28.0
    
    v_t, f_t = make_box([0, 0, z_pole], [16, 16, 8])
    v_b, f_b = make_box([0, 0, -z_pole], [16, 16, 8])
    m.add(v_t, f_t, group='collars')
    m.add(v_b, f_b, group='collars')
    
    v_b1, f_b1 = cylinder([0, 0, z_pole - 6], [0, 0, z_pole - 2], 4.5, 4.5, seg=12)
    v_b2, f_b2 = cylinder([0, 0, -z_pole + 2], [0, 0, -z_pole + 6], 4.5, 4.5, seg=12)
    m.add(v_b1, f_b1, group='bearings')
    m.add(v_b2, f_b2, group='bearings')
    
    v_s, f_s = cylinder([0, 0, -z_pole - 14], [0, 0, z_pole + 14], 2.0, 2.0, seg=12)
    m.add(v_s, f_s, group='shaft')
    
    add_conical_spring(m, -z_pole + 4, z_pole - 4, r_bot=14.0, r_top=7.5, turns=5.5, wire_r=0.9)
    
    lat_ang = math.radians(30)
    upper_pins, equat_pins, lower_pins = [], [], []
    
    for k in range(8):
        phi_up = k * (2 * math.pi / 8)
        pos_up = [
            r * math.cos(lat_ang) * math.cos(phi_up),
            r * math.cos(lat_ang) * math.sin(phi_up),
            r * math.sin(lat_ang)
        ]
        upper_pins.append(pos_up)
        add_screw_pin(m, pos_up, pos_up, radius=1.6, head_r=2.8, length=5.0)
        
        phi_eq = k * (2 * math.pi / 8) + (math.pi / 8)
        pos_eq = [r * math.cos(phi_eq), r * math.sin(phi_eq), 0.0]
        equat_pins.append(pos_eq)
        add_screw_pin(m, pos_eq, pos_eq, radius=1.6, head_r=2.8, length=5.0)
        
        phi_dn = k * (2 * math.pi / 8)
        pos_dn = [
            r * math.cos(-lat_ang) * math.cos(phi_dn),
            r * math.cos(-lat_ang) * math.sin(phi_dn),
            r * math.sin(-lat_ang)
        ]
        lower_pins.append(pos_dn)
        add_screw_pin(m, pos_dn, pos_dn, radius=1.6, head_r=2.8, length=5.0)
    
    for k in range(8):
        p_up = upper_pins[k]
        p_eq1 = equat_pins[k]
        p_eq2 = equat_pins[(k - 1) % 8]
        v1, f1 = make_curved_strip(p_up, p_eq1, r_sphere=r, width=5.0, thickness=1.6, n_sub=3)
        v2, f2 = make_curved_strip(p_up, p_eq2, r_sphere=r, width=5.0, thickness=1.6, n_sub=3)
        m.add(v1, f1, group='strip_links_truss')
        m.add(v2, f2, group='strip_links_truss')
        
    for k in range(8):
        p_eq = equat_pins[k]
        p_dn1 = lower_pins[k]
        p_dn2 = lower_pins[(k + 1) % 8]
        v1, f1 = make_curved_strip(p_eq, p_dn1, r_sphere=r, width=5.0, thickness=1.6, n_sub=3)
        v2, f2 = make_curved_strip(p_eq, p_dn2, r_sphere=r, width=5.0, thickness=1.6, n_sub=3)
        m.add(v1, f1, group='strip_links_truss')
        m.add(v2, f2, group='strip_links_truss')
        
    p_top_pole = [0, 0, z_pole - 4]
    p_bot_pole = [0, 0, -z_pole + 4]
    for k in (0, 2, 4, 6):
        v_t, f_t = make_curved_strip(p_top_pole, upper_pins[k], r_sphere=r, width=5.0, thickness=1.6, n_sub=3)
        v_b, f_b = make_curved_strip(lower_pins[k], p_bot_pole, r_sphere=r, width=5.0, thickness=1.6, n_sub=3)
        m.add(v_t, f_t, group='strip_links_truss')
        m.add(v_b, f_b, group='strip_links_truss')
        
    return m

# -----------------------------------------------------------------------------
# 4. Dual-Nested Assembly
# -----------------------------------------------------------------------------
def build_dual_nested_assembly():
    m = Mesh()
    m_truss = build_truss_cell()
    m_equat = build_equatorial_cell()
    
    for g_name, face_indices in m_truss.groups.items():
        sub_faces = [m_truss.faces[idx] for idx in face_indices]
        m.add(m_truss.verts, sub_faces, group=g_name)
        
    for g_name, face_indices in m_equat.groups.items():
        sub_faces = [m_equat.faces[idx] for idx in face_indices]
        m.add(m_equat.verts, sub_faces, group=g_name)
        
    v_g, f_g = ring([0, 0, 0], 65.0, seg=36, r=2.0)
    m.add(v_g, f_g, group='guide_triad')
    for k in range(3):
        ang = k * (2 * math.pi / 3) + math.pi / 2
        p_arm = [65.0 * math.cos(ang), 65.0 * math.sin(ang), 0]
        va, fa = cylinder([0, 0, 0], p_arm, 1.8, 1.8, seg=8)
        m.add(va, fa, group='guide_triad')
        
    return m

colors = {
    'strip_links': (35, 45, 60),
    'strip_links_truss': (25, 65, 165),
    'strip_links_equat': (195, 80, 20),
    'pin_screws': (20, 20, 25),
    'collars': (30, 30, 35),
    'shaft': (180, 185, 195),
    'bearings': (210, 175, 60),
    'spring': (190, 195, 205),
    'guide_triad': (180, 150, 40),
}

def to_view(p):
    return [p[0], p[2], -p[1]]

def render_all_panels():
    w_tot, h_tot = 1200, 900
    canvas = Canvas(w_tot, h_tot, bg=(255, 255, 255), supersample=2)

    panels = [
        (build_arrowhead_element, [0, 85, 42], [0, 8, 0], [0, 1, 0], (40, 70, 540, 360),
         "(A) Double-Arrowhead Auxetic Element (Fig. S1A: w=5mm, t=1.6mm, 4 Pinned Joints)"),
        (build_equatorial_cell, [85, 65, 120], [0, 0, 0], [0, 1, 0], (620, 70, 540, 360),
         "(B) Equatorial TRUNC Cell (Fig. S1B / Fig. 2A: D=88mm, M=2, 8 Chevrons + Spring)"),
        (build_truss_cell, [65, 45, 95], [0, 0, 0], [0, 1, 0], (40, 470, 540, 360),
         "(C) Truss TRUNC Cell (Fig. S1C & Prototype Photo: D=56mm, M=3, 52x Twist:Bend)"),
        (build_dual_nested_assembly, [105, 80, 145], [0, 0, 0], [0, 1, 0], (620, 470, 540, 360),
         "(D) Dual-Nested Concentric Assembly (Truss D=56 inside Equatorial D=88 + Triad)"),
    ]

    for builder_fn, eye, target, up, (rx, ry, rw, rh), title in panels:
        mesh = builder_fn()
        verts_v = [to_view(v) for v in mesh.verts]
        sub_canvas = Canvas(rw, rh, bg=(250, 252, 255), supersample=2)
        cam = Camera(eye=eye, target=target, up=up, fov_deg=44, width=rw, height=rh)

        for grp, col in colors.items():
            idx = mesh.groups.get(grp, [])
            if idx:
                sub = {'verts': verts_v, 'faces': [mesh.faces[i] for i in idx]}
                render_mesh(sub_canvas, sub, cam, color=col, light=[0.6, 0.8, -0.7], ambient=0.52)

        ss = canvas.ss
        for y in range(rh * ss):
            for x in range(rw * ss):
                sub_idx = (y * (rw * ss) + x) * 3
                main_x = rx * ss + x
                main_y = ry * ss + y
                main_idx = (main_y * (w_tot * ss) + main_x) * 3
                canvas.buf[main_idx] = sub_canvas.buf[sub_idx]
                canvas.buf[main_idx + 1] = sub_canvas.buf[sub_idx + 1]
                canvas.buf[main_idx + 2] = sub_canvas.buf[sub_idx + 2]

        canvas.rect(rx, ry, rw, rh, (210, 220, 235), width=1)
        canvas.text(rx + 10, ry + 15, title, (20, 35, 60), scale=1)

    canvas.text(w_tot // 2 - 270, 25, "TRUNC UNIT CELL EXACT PAPER & PROTOTYPE CAD RECONSTRUCTION", (15, 25, 45), scale=2)
    os.makedirs('docs', exist_ok=True)
    os.makedirs('python/out', exist_ok=True)
    canvas.save_png('python/out/unit_cell_exact_paper_structure.png')
    canvas.save_png('docs/unit_cell_exact_paper_structure.png')

if __name__ == '__main__':
    render_all_panels()
    print("Saved docs/unit_cell_exact_paper_structure.png")
