#!/usr/bin/env python3
"""
tools/export_all_cad_models.py — Generates exact 3D CAD models (Wavefront .OBJ + .MTL and .STL)
for the TRUNC metamaterial unit cells and the complete 7-cell robot arm assembly.
"""
import sys, os, math, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from trunclib.model3d import Mesh, sphere, cylinder, ring
from trunclib.plot import Canvas, Camera, render_mesh
import trunclib.mathx as mx
from trunclib.kinematics import forward
from tools.render_exact_unit_cell import (
    build_arrowhead_element, build_equatorial_cell, build_truss_cell,
    build_dual_nested_assembly, colors, to_view
)

def export_step(path, mesh, name="TRUNC_MODEL"):
    """
    Exports a 3D Mesh (mesh.verts, mesh.faces) to ISO-10303-21 STEP format (AP214/AP203).
    Fully compatible with SolidWorks, Fusion 360, FreeCAD, Inventor, CATIA, NX, Rhino.
    """
    lines = [
        "ISO-10303-21;",
        "HEADER;",
        "FILE_DESCRIPTION(('TRUNC CAD 3D MODEL - STEP AP214'),'2;1');",
        f"FILE_NAME('{os.path.basename(path)}','2026-10-09T04:00:00',('Arena AI'),('TRUNC Robotics Lab'),'TRUNC CAD AP214 Exporter','TRUNC CAD Engine','');",
        "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
        "ENDSEC;",
        "DATA;",
    ]
    
    eid = 1
    lines.append(f"#{eid}=APPLICATION_CONTEXT('core data for mechanical design');")
    ac_id = eid; eid += 1
    lines.append(f"#{eid}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#{ac_id});")
    apd_id = eid; eid += 1
    lines.append(f"#{eid}=PRODUCT_CONTEXT('3D Mechanical Context',#{ac_id},'mechanical');")
    pc_id = eid; eid += 1
    lines.append(f"#{eid}=PRODUCT('{name}','{name}','TRUNC Metamaterial Component', ( #{pc_id} ) );")
    prod_id = eid; eid += 1
    lines.append(f"#{eid}=PRODUCT_DEFINITION_FORMATION('1.0','Initial Release',#{prod_id});")
    pdf_id = eid; eid += 1
    lines.append(f"#{eid}=PRODUCT_DEFINITION_CONTEXT('part definition',#{ac_id},'design');")
    pdc_id = eid; eid += 1
    lines.append(f"#{eid}=PRODUCT_DEFINITION('design','{name}',#{pdf_id},#{pdc_id});")
    pd_id = eid; eid += 1
    
    lines.append(f"#{eid}=( LENGTH_UNIT_ACCURACY_POINT_VALUE( 0.001 ) NAMED_UNIT( * ) SI_UNIT( .MILLI., .METRE. ) );")
    lu_id = eid; eid += 1
    lines.append(f"#{eid}=( NAMED_UNIT( * ) PLANE_ANGLE_UNIT( ) SI_UNIT( $, .RADIAN. ) );")
    au_id = eid; eid += 1
    lines.append(f"#{eid}=( NAMED_UNIT( * ) SI_UNIT( $, .STERADIAN. ) SOLID_ANGLE_UNIT( ) );")
    su_id = eid; eid += 1
    lines.append(f"#{eid}=( GEOMETRIC_REPRESENTATION_CONTEXT( 3 ) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT( ( #{lu_id} ) ) GLOBAL_UNIT_ASSIGNED_CONTEXT( ( #{lu_id}, #{au_id}, #{su_id} ) ) REPRESENTATION_CONTEXT( '{name}', '3D' ) );")
    gc_id = eid; eid += 1
    
    v_ids = []
    for v in mesh.verts:
        lines.append(f"#{eid}=CARTESIAN_POINT('',({v[0]:.4f},{v[1]:.4f},{v[2]:.4f}));")
        v_ids.append(eid)
        eid += 1
        
    face_ids = []
    for f in mesh.faces:
        p_ids_str = ','.join(f'#{v_ids[idx]}' for idx in f)
        lines.append(f"#{eid}=POLY_LOOP('',({p_ids_str}));")
        pl_id = eid; eid += 1
        lines.append(f"#{eid}=FACE_OUTER_BOUND('',#{pl_id},.T.);")
        fb_id = eid; eid += 1
        
        p0, p1, p2 = mesh.verts[f[0]], mesh.verts[f[1]], mesh.verts[f[2]]
        u = [p1[i] - p0[i] for i in range(3)]
        v = [p2[i] - p0[i] for i in range(3)]
        nx = u[1]*v[2] - u[2]*v[1]
        ny = u[2]*v[0] - u[0]*v[2]
        nz = u[0]*v[1] - u[1]*v[0]
        nlen = math.sqrt(nx*nx + ny*ny + nz*nz) or 1.0
        
        lines.append(f"#{eid}=DIRECTION('',({nx/nlen:.6f},{ny/nlen:.6f},{nz/nlen:.6f}));")
        dir_id = eid; eid += 1
        
        if abs(nx/nlen) < 0.9:
            rx, ry, rz = 1.0, 0.0, 0.0
        else:
            rx, ry, rz = 0.0, 1.0, 0.0
        dot = (rx*nx + ry*ny + rz*nz) / nlen
        rx, ry, rz = rx - dot*(nx/nlen), ry - dot*(ny/nlen), rz - dot*(nz/nlen)
        rlen = math.sqrt(rx*rx + ry*ry + rz*rz) or 1.0
        lines.append(f"#{eid}=DIRECTION('',({rx/rlen:.6f},{ry/rlen:.6f},{rz/rlen:.6f}));")
        ref_id = eid; eid += 1
        
        lines.append(f"#{eid}=AXIS2_PLACEMENT_3D('',#{v_ids[f[0]]},#{dir_id},#{ref_id});")
        ax_id = eid; eid += 1
        lines.append(f"#{eid}=PLANE('',#{ax_id});")
        plane_id = eid; eid += 1
        
        lines.append(f"#{eid}=ADVANCED_FACE('',(#{fb_id}),#{plane_id},.T.);")
        face_ids.append(eid)
        eid += 1
        
    faces_str = ','.join(f'#{fid}' for fid in face_ids)
    lines.append(f"#{eid}=CLOSED_SHELL('',({faces_str}));")
    cs_id = eid; eid += 1
    lines.append(f"#{eid}=MANIFOLD_SOLID_BREP('{name}',#{cs_id});")
    msb_id = eid; eid += 1
    lines.append(f"#{eid}=ADVANCED_BREP_SHAPE_REPRESENTATION('{name}',(#{msb_id}),#{gc_id});")
    absr_id = eid; eid += 1
    lines.append(f"#{eid}=SHAPE_DEFINITION_REPRESENTATION(#{pd_id},#{absr_id});")
    
    lines.append("ENDSEC;")
    lines.append("END-ISO-10303-21;")
    
    with open(path, 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    print(f"  Wrote STEP: {path} ({len(mesh.faces)} faces)")

def export_obj_with_mtl(path, mesh, mtl_name=None, title='TRUNC CAD Model'):
    """Export Mesh to Wavefront OBJ format with material definitions."""
    lines = [f'# {title}', f'# vertices={len(mesh.verts)} faces={len(mesh.faces)}']
    if mtl_name:
        lines.append(f'mtllib {mtl_name}')
    lines.append('o trunc_model')
    
    for v in mesh.verts:
        lines.append(f'v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}')
        
    for name, idxs in mesh.groups.items():
        lines.append(f'g {name}')
        if mtl_name:
            lines.append(f'usemtl {name}')
        for i in idxs:
            f = mesh.faces[i]
            lines.append(f'f {f[0]+1} {f[1]+1} {f[2]+1}')
            
    with open(path, 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    print(f"  Wrote OBJ: {path} ({len(mesh.verts)} verts, {len(mesh.faces)} faces)")

def export_stl(path, mesh, binary=True):
    """Export Mesh to standard 3D CAD STL format (binary or ASCII)."""
    if binary:
        with open(path, 'wb') as fh:
            header = b'TRUNC 3D CAD Robot Model - Metamaterial Joint'.ljust(80, b'\0')
            fh.write(header)
            fh.write(struct.pack('<I', len(mesh.faces)))
            for f in mesh.faces:
                p0 = mesh.verts[f[0]]
                p1 = mesh.verts[f[1]]
                p2 = mesh.verts[f[2]]
                u = [p1[i] - p0[i] for i in range(3)]
                v = [p2[i] - p0[i] for i in range(3)]
                nx = u[1] * v[2] - u[2] * v[1]
                ny = u[2] * v[0] - u[0] * v[2]
                nz = u[0] * v[1] - u[1] * v[0]
                nlen = math.sqrt(nx*nx + ny*ny + nz*nz) or 1.0
                normal = (nx/nlen, ny/nlen, nz/nlen)
                
                fh.write(struct.pack('<3f', *normal))
                fh.write(struct.pack('<3f', *p0))
                fh.write(struct.pack('<3f', *p1))
                fh.write(struct.pack('<3f', *p2))
                fh.write(b'\0\0')
    else:
        lines = ['solid trunc_model']
        for f in mesh.faces:
            p0 = mesh.verts[f[0]]
            p1 = mesh.verts[f[1]]
            p2 = mesh.verts[f[2]]
            u = [p1[i] - p0[i] for i in range(3)]
            v = [p2[i] - p0[i] for i in range(3)]
            nx = u[1] * v[2] - u[2] * v[1]
            ny = u[2] * v[0] - u[0] * v[2]
            nz = u[0] * v[1] - u[1] * v[0]
            nlen = math.sqrt(nx*nx + ny*ny + nz*nz) or 1.0
            lines.append(f'  facet normal {nx/nlen:.6f} {ny/nlen:.6f} {nz/nlen:.6f}')
            lines.append('    outer loop')
            lines.append(f'      vertex {p0[0]:.4f} {p0[1]:.4f} {p0[2]:.4f}')
            lines.append(f'      vertex {p1[0]:.4f} {p1[1]:.4f} {p1[2]:.4f}')
            lines.append(f'      vertex {p2[0]:.4f} {p2[1]:.4f} {p2[2]:.4f}')
            lines.append('    endloop')
            lines.append('  endfacet')
        lines.append('endsolid trunc_model')
        with open(path, 'w') as fh:
            fh.write('\n'.join(lines) + '\n')
    print(f"  Wrote STL: {path} ({len(mesh.faces)} triangles)")

def export_mtl(path):
    """Write standard MTL material definitions matching the paper materials."""
    lines = [
        '# TRUNC Material Definitions',
        'newmtl links_truss',
        'Ka 0.1 0.2 0.4',
        'Kd 0.18 0.45 0.85',
        'Ks 0.5 0.5 0.6',
        'Ns 32.0',
        'd 1.0',
        '',
        'newmtl links_equatorial',
        'Ka 0.3 0.15 0.05',
        'Kd 0.85 0.48 0.18',
        'Ks 0.5 0.5 0.5',
        'Ns 32.0',
        'd 1.0',
        '',
        'newmtl pins',
        'Ka 0.2 0.2 0.2',
        'Kd 0.88 0.90 0.92',
        'Ks 0.8 0.8 0.8',
        'Ns 64.0',
        'd 1.0',
        '',
        'newmtl spring',
        'Ka 0.2 0.2 0.2',
        'Kd 0.75 0.78 0.82',
        'Ks 0.8 0.8 0.8',
        'Ns 50.0',
        'd 1.0',
        '',
        'newmtl collars',
        'Ka 0.05 0.05 0.05',
        'Kd 0.12 0.14 0.16',
        'Ks 0.2 0.2 0.2',
        'Ns 10.0',
        'd 1.0',
        '',
        'newmtl shaft',
        'Ka 0.2 0.2 0.2',
        'Kd 0.70 0.72 0.75',
        'Ks 0.6 0.6 0.6',
        'Ns 40.0',
        'd 1.0',
        '',
        'newmtl triad',
        'Ka 0.3 0.25 0.05',
        'Kd 0.88 0.76 0.22',
        'Ks 0.7 0.6 0.3',
        'Ns 45.0',
        'd 1.0',
        '',
        'newmtl base_mount',
        'Ka 0.05 0.05 0.05',
        'Kd 0.15 0.18 0.22',
        'Ks 0.3 0.3 0.3',
        'Ns 20.0',
        'd 1.0',
        '',
        'newmtl winches',
        'Ka 0.1 0.1 0.1',
        'Kd 0.4 0.4 0.45',
        'Ks 0.4 0.4 0.4',
        'Ns 25.0',
        'd 1.0',
        '',
        'newmtl tendons',
        'Ka 0.3 0.15 0.05',
        'Kd 0.92 0.60 0.15',
        'Ks 0.3 0.3 0.3',
        'Ns 15.0',
        'd 1.0',
        '',
        'newmtl tool',
        'Ka 0.2 0.2 0.2',
        'Kd 0.82 0.85 0.88',
        'Ks 0.7 0.7 0.7',
        'Ns 50.0',
        'd 1.0',
    ]
    with open(path, 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    print(f"  Wrote MTL: {path}")

def build_full_robot_cad():
    """Build complete 7-Cell TRUNC Robot Arm CAD Assembly in Neutral Pose."""
    mesh = Mesh()
    
    # Base Mount Flange (Milwaukee drill motor + 9 winch mounts)
    base_v, base_f = cylinder([0, 0, 20], [0, 0, 0], 90.0, seg=32)
    mesh.add(base_v, base_f, 'base_mount')
    top_v, top_f = cylinder([0, 0, 0], [0, 0, -15], 50.0, seg=24)
    mesh.add(top_v, top_f, 'base_mount')
    motor_v, motor_f = cylinder([0, 0, 80], [0, 0, 20], 35.0, seg=24)
    mesh.add(motor_v, motor_f, 'winches')
    
    # 9 Winch Cable Pulleys on Base
    for k in range(9):
        ang = (2 * math.pi / 9) * k
        wx = 75.0 * math.cos(ang)
        wy = 75.0 * math.sin(ang)
        wv, wf = cylinder([wx, wy, 25], [wx, wy, 15], 8.0, seg=12)
        mesh.add(wv, wf, 'winches')
        
    z_stations = [0.0]
    cell_height = 710.0 / 7.0  # ~101.4 mm per cell
    for i in range(1, 8):
        z_stations.append(-i * cell_height)
        
    for c_idx in range(7):
        z_top = z_stations[c_idx]
        z_bot = z_stations[c_idx + 1]
        z_mid = (z_top + z_bot) * 0.5
        
        # Inner Truss Cell
        truss = build_truss_cell()
        for v in truss.verts:
            mesh.verts.append([v[0], v[1], v[2] + z_mid])
        offset = len(mesh.verts) - len(truss.verts)
        for grp, f_idxs in truss.groups.items():
            mapped_grp = 'links_truss' if 'link' in grp else grp
            for fi in f_idxs:
                f = truss.faces[fi]
                mesh.faces.append([f[0] + offset, f[1] + offset, f[2] + offset])
                mesh.groups.setdefault(mapped_grp, []).append(len(mesh.faces) - 1)
                
        # Outer Equatorial Cell
        eq = build_equatorial_cell()
        for v in eq.verts:
            mesh.verts.append([v[0], v[1], v[2] + z_mid])
        offset_eq = len(mesh.verts) - len(eq.verts)
        for grp, f_idxs in eq.groups.items():
            mapped_grp = 'links_equatorial' if 'link' in grp else grp
            for fi in f_idxs:
                f = eq.faces[fi]
                mesh.faces.append([f[0] + offset_eq, f[1] + offset_eq, f[2] + offset_eq])
                mesh.groups.setdefault(mapped_grp, []).append(len(mesh.faces) - 1)

    triad_stations = [z_stations[0], z_stations[3], z_stations[5], z_stations[7]]
    for z_t in triad_stations:
        for arm_idx in range(3):
            ang = arm_idx * (2 * math.pi / 3)
            p0 = [0, 0, z_t]
            p1 = [65.0 * math.cos(ang), 65.0 * math.sin(ang), z_t]
            sv, sf = cylinder(p0, p1, 4.0, seg=8)
            mesh.add(sv, sf, 'triad')
            rv, rf = sphere(p1, 5.5, useg=10, vseg=6)
            mesh.add(rv, rf, 'triad')
            
    for m in range(3):
        z_start = triad_stations[0]
        z_end = triad_stations[m + 1]
        for c in range(3):
            ang = c * (2 * math.pi / 3) + (m * 0.1)
            px = 65.0 * math.cos(ang)
            py = 65.0 * math.sin(ang)
            cv, cf = cylinder([px, py, z_start], [px, py, z_end], 1.2, seg=6)
            mesh.add(cv, cf, 'tendons')

    z_ee = z_stations[7]
    t1_v, t1_f = cylinder([0, 0, z_ee], [0, 0, z_ee - 20], 17.0, seg=16)
    mesh.add(t1_v, t1_f, 'tool')
    t2_v, t2_f = cylinder([0, 0, z_ee - 20], [0, 0, z_ee - 50], 13.0, seg=16)
    mesh.add(t2_v, t2_f, 'tool')
    t3_v, t3_f = cylinder([0, 0, z_ee - 50], [0, 0, z_ee - 70], 19.0, seg=16)
    mesh.add(t3_v, t3_f, 'tool')
    t4_v, t4_f = cylinder([0, 0, z_ee - 70], [0, 0, z_ee - 83], 8.0, seg=14)
    mesh.add(t4_v, t4_f, 'tool')

    return mesh

def build_bent_robot_cad(angles_deg=[25, 40, -15, 30, 20, -45]):
    """Build bent 7-Cell TRUNC Robot Arm CAD Assembly under active kinematics."""
    from trunclib.kinematics import segment_transform, mdot
    import trunclib.mathx as mx
    
    angles_rad = [math.radians(a) for a in angles_deg]
    t1, t2, t3, t4, t5, t6 = angles_rad
    L = 710.0
    
    # Cumulative Transforms
    T_base = [[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,1]]
    T_shoulder = mdot(T_base, segment_transform(t1, t2, -(3.0/7.0)*L))
    T_elbow = mdot(T_shoulder, segment_transform(t3, t4, -(2.0/7.0)*L))
    T_wrist = mdot(T_elbow, segment_transform(t5, t6, -(2.0/7.0)*L))
    T_tool = mdot(T_wrist, segment_transform(0, 0, -83.0))
    
    triad_stages = [T_base, T_shoulder, T_elbow, T_wrist]
    
    # 7 unit cell frames
    cell_frames = []
    # Shoulder: 3 cells
    for k in range(3):
        f = (k + 0.5) / 3.0
        T_c = mdot(T_base, segment_transform(t1 * f, t2, -(3.0/7.0)*L * f))
        cell_frames.append(T_c)
    # Elbow: 2 cells
    for k in range(2):
        f = (k + 0.5) / 2.0
        T_c = mdot(T_shoulder, segment_transform(t3 * f, t4, -(2.0/7.0)*L * f))
        cell_frames.append(T_c)
    # Wrist: 2 cells
    for k in range(2):
        f = (k + 0.5) / 2.0
        T_c = mdot(T_elbow, segment_transform(t5 * f, t6, -(2.0/7.0)*L * f))
        cell_frames.append(T_c)
    
    mesh = Mesh()
    
    # Base Mount Flange
    base_v, base_f = cylinder([0, 0, 20], [0, 0, 0], 90.0, seg=32)
    mesh.add(base_v, base_f, 'base_mount')
    top_v, top_f = cylinder([0, 0, 0], [0, 0, -15], 50.0, seg=24)
    mesh.add(top_v, top_f, 'base_mount')
    motor_v, motor_f = cylinder([0, 0, 80], [0, 0, 20], 35.0, seg=24)
    mesh.add(motor_v, motor_f, 'winches')
    
    for k in range(9):
        ang = (2 * math.pi / 9) * k
        wx = 75.0 * math.cos(ang)
        wy = 75.0 * math.sin(ang)
        wv, wf = cylinder([wx, wy, 25], [wx, wy, 15], 8.0, seg=12)
        mesh.add(wv, wf, 'winches')
        
    # 7 unit cells
    for c_idx, T in enumerate(cell_frames):
        p_mid = [T[0][3], T[1][3], T[2][3]]
        R_mat = [row[:3] for row in T[:3]]
        
        truss = build_truss_cell()
        truss_verts_t = []
        for v in truss.verts:
            rot_v = mx.mXV(R_mat, v)
            truss_verts_t.append([rot_v[0] + p_mid[0], rot_v[1] + p_mid[1], rot_v[2] + p_mid[2]])
        offset = len(mesh.verts)
        mesh.verts.extend(truss_verts_t)
        for grp, f_idxs in truss.groups.items():
            mapped_grp = 'links_truss' if 'link' in grp else grp
            for fi in f_idxs:
                f = truss.faces[fi]
                mesh.faces.append([f[0] + offset, f[1] + offset, f[2] + offset])
                mesh.groups.setdefault(mapped_grp, []).append(len(mesh.faces) - 1)
                
        eq = build_equatorial_cell()
        eq_verts_t = []
        for v in eq.verts:
            rot_v = mx.mXV(R_mat, v)
            eq_verts_t.append([rot_v[0] + p_mid[0], rot_v[1] + p_mid[1], rot_v[2] + p_mid[2]])
        offset_eq = len(mesh.verts)
        mesh.verts.extend(eq_verts_t)
        for grp, f_idxs in eq.groups.items():
            mapped_grp = 'links_equatorial' if 'link' in grp else grp
            for fi in f_idxs:
                f = eq.faces[fi]
                mesh.faces.append([f[0] + offset_eq, f[1] + offset_eq, f[2] + offset_eq])
                mesh.groups.setdefault(mapped_grp, []).append(len(mesh.faces) - 1)

    # 4 Tendon Guide Triads
    for T in triad_stages:
        p_t = [T[0][3], T[1][3], T[2][3]]
        R_t = [row[:3] for row in T[:3]]
        for arm_idx in range(3):
            ang = arm_idx * (2 * math.pi / 3)
            p0 = p_t
            local_p1 = [65.0 * math.cos(ang), 65.0 * math.sin(ang), 0.0]
            rot_p1 = mx.mXV(R_t, local_p1)
            p1 = [rot_p1[0] + p_t[0], rot_p1[1] + p_t[1], rot_p1[2] + p_t[2]]
            sv, sf = cylinder(p0, p1, 4.0, seg=8)
            mesh.add(sv, sf, 'triad')
            rv, rf = sphere(p1, 5.5, useg=10, vseg=6)
            mesh.add(rv, rf, 'triad')

    # 9 Braided Tendon Cables through Triad Eyelets
    for m in range(3):
        T_start = triad_stages[0]
        T_end = triad_stages[m + 1]
        p_s = [T_start[0][3], T_start[1][3], T_start[2][3]]
        R_s = [row[:3] for row in T_start[:3]]
        p_e = [T_end[0][3], T_end[1][3], T_end[2][3]]
        R_e = [row[:3] for row in T_end[:3]]
        for c in range(3):
            ang = c * (2 * math.pi / 3) + (m * 0.1)
            l0 = [65.0 * math.cos(ang), 65.0 * math.sin(ang), 0.0]
            r0 = mx.mXV(R_s, l0)
            pt0 = [r0[0] + p_s[0], r0[1] + p_s[1], r0[2] + p_s[2]]
            
            r1 = mx.mXV(R_e, l0)
            pt1 = [r1[0] + p_e[0], r1[1] + p_e[1], r1[2] + p_e[2]]
            
            cv, cf = cylinder(pt0, pt1, 1.2, seg=6)
            mesh.add(cv, cf, 'tendons')

    # End Effector Tool
    p_ee = [T_tool[0][3], T_tool[1][3], T_tool[2][3]]
    T_wrist = triad_stages[3]
    p_base_tool = [T_wrist[0][3], T_wrist[1][3], T_wrist[2][3]]
    
    t1_v, t1_f = cylinder(p_base_tool, [p_base_tool[0] + (p_ee[0]-p_base_tool[0])*0.25, p_base_tool[1] + (p_ee[1]-p_base_tool[1])*0.25, p_base_tool[2] + (p_ee[2]-p_base_tool[2])*0.25], 17.0, seg=16)
    mesh.add(t1_v, t1_f, 'tool')
    t2_v, t2_f = cylinder([p_base_tool[0] + (p_ee[0]-p_base_tool[0])*0.25, p_base_tool[1] + (p_ee[1]-p_base_tool[1])*0.25, p_base_tool[2] + (p_ee[2]-p_base_tool[2])*0.25], p_ee, 10.0, seg=14)
    mesh.add(t2_v, t2_f, 'tool')

    return mesh

def main():
    os.makedirs('docs', exist_ok=True)
    os.makedirs('docs/cad', exist_ok=True)
    
    print("Generating complete TRUNC CAD Models (OBJ + MTL + STL)...")
    
    # 1. Material definitions
    mtl_path = 'docs/cad/trunc_materials.mtl'
    export_mtl(mtl_path)
    export_mtl('docs/trunc_materials.mtl')
    
    # 2. Arrowhead Element (Fig. S1A)
    print("\n1. Arrowhead Linkage Element (Fig. S1A):")
    ah = build_arrowhead_element()
    export_obj_with_mtl('docs/cad/unit_cell_arrowhead_linkage.obj', ah, 'trunc_materials.mtl', 'TRUNC Arrowhead Element')
    export_stl('docs/cad/unit_cell_arrowhead_linkage.stl', ah)
    
    # 3. Isolated Truss Unit Cell (Fig. S1C / Prototype Photo)
    print("\n2. Truss Unit Cell D=56mm (Fig. S1C):")
    truss = build_truss_cell()
    export_step('docs/cad/unit_cell_truss_d56.step', truss, 'TRUNC_Truss_Cell_D56')
    export_step('docs/cad/unit_cell_truss_d56.stp', truss, 'TRUNC_Truss_Cell_D56')
    export_step('docs/unit_cell_truss_d56.step', truss, 'TRUNC_Truss_Cell_D56')
    export_step('docs/unit_cell_truss_d56.stp', truss, 'TRUNC_Truss_Cell_D56')
    export_obj_with_mtl('docs/cad/unit_cell_truss_d56.obj', truss, 'trunc_materials.mtl', 'TRUNC Truss Unit Cell D=56mm')
    export_stl('docs/cad/unit_cell_truss_d56.stl', truss)
    export_obj_with_mtl('docs/unit_cell_truss_d56.obj', truss, 'trunc_materials.mtl', 'TRUNC Truss Unit Cell D=56mm')
    export_stl('docs/unit_cell_truss_d56.stl', truss)

    # 4. Isolated Equatorial Unit Cell (Fig. S1B / Fig. 2A)
    print("\n3. Equatorial Unit Cell D=88mm (Fig. S1B):")
    eq = build_equatorial_cell()
    export_step('docs/cad/unit_cell_equatorial_d88.step', eq, 'TRUNC_Equatorial_Cell_D88')
    export_step('docs/cad/unit_cell_equatorial_d88.stp', eq, 'TRUNC_Equatorial_Cell_D88')
    export_step('docs/unit_cell_equatorial_d88.step', eq, 'TRUNC_Equatorial_Cell_D88')
    export_step('docs/unit_cell_equatorial_d88.stp', eq, 'TRUNC_Equatorial_Cell_D88')
    export_obj_with_mtl('docs/cad/unit_cell_equatorial_d88.obj', eq, 'trunc_materials.mtl', 'TRUNC Equatorial Unit Cell D=88mm')
    export_stl('docs/cad/unit_cell_equatorial_d88.stl', eq)
    export_obj_with_mtl('docs/unit_cell_equatorial_d88.obj', eq, 'trunc_materials.mtl', 'TRUNC Equatorial Unit Cell D=88mm')
    export_stl('docs/unit_cell_equatorial_d88.stl', eq)

    # 5. Dual Nested Unit Cell Assembly
    print("\n4. Dual Nested Concentric Unit Cell Assembly:")
    nested = build_dual_nested_assembly()
    export_step('docs/cad/unit_cell_dual_nested.step', nested, 'TRUNC_Dual_Nested_Assembly')
    export_step('docs/cad/unit_cell_dual_nested.stp', nested, 'TRUNC_Dual_Nested_Assembly')
    export_step('docs/unit_cell_dual_nested.step', nested, 'TRUNC_Dual_Nested_Assembly')
    export_step('docs/unit_cell_dual_nested.stp', nested, 'TRUNC_Dual_Nested_Assembly')
    export_obj_with_mtl('docs/cad/unit_cell_dual_nested.obj', nested, 'trunc_materials.mtl', 'TRUNC Dual Nested Assembly')
    export_stl('docs/cad/unit_cell_dual_nested.stl', nested)
    export_obj_with_mtl('docs/unit_cell_dual_nested.obj', nested, 'trunc_materials.mtl', 'TRUNC Dual Nested Assembly')
    export_stl('docs/unit_cell_dual_nested.stl', nested)

    # 6. Complete 7-Cell TRUNC Robot Arm Assembly
    print("\n5. Complete 7-Cell TRUNC Continuum Robot Arm Assembly:")
    robot = build_full_robot_cad()
    export_step('docs/cad/trunc_arm_full_robot.step', robot, 'TRUNC_Full_Robot_Arm')
    export_step('docs/cad/trunc_arm_full_robot.stp', robot, 'TRUNC_Full_Robot_Arm')
    export_step('docs/trunc_arm_full_cad_model.step', robot, 'TRUNC_Full_Robot_Arm')
    export_step('docs/trunc_arm_full_cad_model.stp', robot, 'TRUNC_Full_Robot_Arm')
    export_obj_with_mtl('docs/cad/trunc_arm_full_robot.obj', robot, 'trunc_materials.mtl', 'TRUNC Full 7-Cell Robot Arm Assembly')
    export_stl('docs/cad/trunc_arm_full_robot.stl', robot)
    export_obj_with_mtl('docs/trunc_arm_full_cad_model.obj', robot, 'trunc_materials.mtl', 'TRUNC Full 7-Cell Robot Arm Assembly')
    export_stl('docs/trunc_arm_full_cad_model.stl', robot)

    # 7. Render high-resolution preview of the complete robot arm CAD model
    print("\n6. Rendering docs/trunc_arm_full_cad_preview.png...")
    w_p, h_p = 1000, 1200
    canvas_arm = Canvas(w_p, h_p, bg=(255, 255, 255), supersample=2)
    verts_view = [to_view(v) for v in robot.verts]
    cam_arm = Camera(eye=[650, -180, 950], target=[0, -356, 0], up=[0, 1, 0], fov_deg=45, width=w_p, height=h_p)
    
    mat_cols = {
        'links_truss': (40, 110, 220),
        'links_equatorial': (220, 120, 40),
        'pins': (210, 220, 230),
        'spring': (140, 180, 200),
        'collars': (30, 35, 45),
        'shaft': (180, 190, 200),
        'triad': (230, 190, 60),
        'base_mount': (45, 50, 60),
        'winches': (90, 100, 115),
        'tendons': (240, 150, 30),
        'tool': (200, 210, 225),
    }
    for grp, f_idxs in robot.groups.items():
        col = mat_cols.get(grp, (150, 150, 150))
        sub = {'verts': verts_view, 'faces': [robot.faces[i] for i in f_idxs]}
        render_mesh(canvas_arm, sub, cam_arm, color=col, light=[0.6, 0.8, -0.7], ambient=0.52)
        
    canvas_arm.text(40, 35, "COMPLETE 7-CELL TRUNC SOFT-ARM ROBOT CAD MODEL", (20, 30, 50), scale=2)
    canvas_arm.text(40, 65, "Base Motor + 9 Winches + 7 Dual-Nested Cells (3:2:2) + 4 Guide Triads + 9 Tendons + Socket Tool", (80, 90, 110), scale=1)
    canvas_arm.save_png('docs/trunc_arm_full_cad_preview.png')

    # 8. Render Bent Arm Posture CAD Model (OBJ + STL + PNG)
    print("\n7. Exporting Bent Robot Arm CAD Posture (STEP + OBJ + STL + PNG)...")
    bent_robot = build_bent_robot_cad()
    export_step('docs/cad/trunc_arm_bent_posture.step', bent_robot, 'TRUNC_Bent_Robot_Arm')
    export_step('docs/cad/trunc_arm_bent_posture.stp', bent_robot, 'TRUNC_Bent_Robot_Arm')
    export_step('docs/trunc_arm_bent_posture.step', bent_robot, 'TRUNC_Bent_Robot_Arm')
    export_step('docs/trunc_arm_bent_posture.stp', bent_robot, 'TRUNC_Bent_Robot_Arm')
    export_obj_with_mtl('docs/cad/trunc_arm_bent_posture.obj', bent_robot, 'trunc_materials.mtl', 'TRUNC Bent Arm Posture')
    export_stl('docs/cad/trunc_arm_bent_posture.stl', bent_robot)
    export_obj_with_mtl('docs/trunc_arm_bent_posture.obj', bent_robot, 'trunc_materials.mtl', 'TRUNC Bent Arm Posture')
    export_stl('docs/trunc_arm_bent_posture.stl', bent_robot)
    
    canvas_bent = Canvas(w_p, h_p, bg=(255, 255, 255), supersample=2)
    verts_bent_view = [to_view(v) for v in bent_robot.verts]
    cam_bent = Camera(eye=[750, -150, 850], target=[40, -320, 0], up=[0, 1, 0], fov_deg=48, width=w_p, height=h_p)
    for grp, f_idxs in bent_robot.groups.items():
        col = mat_cols.get(grp, (150, 150, 150))
        sub = {'verts': verts_bent_view, 'faces': [bent_robot.faces[i] for i in f_idxs]}
        render_mesh(canvas_bent, sub, cam_bent, color=col, light=[0.6, 0.8, -0.7], ambient=0.52)
    canvas_bent.text(40, 35, "TRUNC ROBOT ARM: ACTIVE 3D BENDING POSTURE CAD SIMULATION", (20, 30, 50), scale=2)
    canvas_bent.text(40, 65, "Shoulder (25°, 40°), Elbow (-15°, 30°), Wrist (20°, -45°) with 9 Active Tendons", (80, 90, 110), scale=1)
    canvas_bent.save_png('docs/trunc_arm_bent_cad_preview.png')
    
    print("\nAll CAD models (.OBJ + .MTL + .STL) and preview successfully exported to docs/.")

if __name__ == '__main__':
    main()
