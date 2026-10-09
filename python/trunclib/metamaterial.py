#!/usr/bin/env python3
"""
trunclib/metamaterial.py — Exact TRUNC metamaterial joint kinematic & geometric solver.
Ported directly from src/core/truncSpec.js matching the original paper:
  Carton, Kowalewski, Guo, Alpert, Garg, Revier, Lipton,
  "Bridging Hard and Soft: Torque-Transmitting Metamaterial Joints for High-Dexterity Robots",
  arXiv:2412.02650v1 (2024).
"""
import math
import trunclib.mathx as mx

SYMMETRY_N = 4
BANDS = {'equatorial': 2, 'truss': 3}
MOLD_DIAMETER_MM = {'truss': 56.0, 'equatorial': 88.0}
LINK = {'width': 5.0, 'thickness': 1.6, 'pinRadius': 1.15, 'holeRadius': 1.6}
SEGMENT_JOINTS = [3, 2, 2]
CABLE_TRIANGLE_MM = 65.0
ARM_LENGTH_MM = 710.0
JOINT_PITCH_MM = ARM_LENGTH_MM / 7.0 # 101.42857 mm

def add3(a, b): return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]
def sub3(a, b): return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]
def mul3s(a, s): return [a[0]*s, a[1]*s, a[2]*s]
def dot3(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
def cross3(a, b): return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
def len3(a): return math.hypot(a[0], a[1], a[2])
def unit3(a):
    n = len3(a) or 1.0
    return [a[0]/n, a[1]/n, a[2]/n]

def cell_layout(kind='truss', ballR=None, poleR=None):
    bands = BANDS[kind]
    sectors = 2 * SYMMETRY_N # 8
    ball_r = ballR or (MOLD_DIAMETER_MM[kind] / 2.0)
    end_ring_r = poleR or (12.0 * (ball_r / 28.0))
    v_pole = math.asin(max(-1.0, min(1.0, end_ring_r / ball_r)))
    v_range = math.pi - 2.0 * v_pole
    waist_v = (v_range / 4.0) if bands == 3 else None
    
    half_sector = math.pi / sectors
    azimuths = [k * 2 * half_sector for k in range(sectors)]
    
    def on_sphere(u, v):
        # u is azimuth, v is polar angle from top pole (0 at top, pi at bottom)
        return [
            ball_r * math.sin(v) * math.cos(u),
            ball_r * math.cos(v),
            ball_r * math.sin(v) * math.sin(u)
        ]
        
    ring_top = [on_sphere(u, v_pole) for u in azimuths]
    ring_bot = [on_sphere(u, math.pi - v_pole) for u in azimuths]
    
    if bands == 3: # Truss (M=3)
        waist_up = [on_sphere(u + half_sector, v_pole + waist_v) for u in azimuths]
        equator = [on_sphere(u, math.pi / 2.0) for u in azimuths]
        waist_dn = [on_sphere(u + half_sector, math.pi - v_pole - waist_v) for u in azimuths]
    else: # Equatorial (M=2)
        waist_up = None
        equator = [on_sphere(u + half_sector, math.pi / 2.0) for u in azimuths]
        waist_dn = None
        
    return {
        'kind': kind,
        'bands': bands,
        'sectors': sectors,
        'ballR': ball_r,
        'poleR': end_ring_r,
        'vPole': v_pole,
        'cellHeight': 2.0 * ball_r * math.cos(v_pole),
        'ringTop': ring_top,
        'ringBot': ring_bot,
        'waistUp': waist_up,
        'equator': equator,
        'waistDn': waist_dn,
    }

def solve_unit_cell_pose(T_low, T_high, kind='truss', ballR=None):
    """
    Solves exact 3D world-space coordinates of the TRUNC unit cell given
    T_low and T_high 4x4 transformation matrices.
    """
    R = ballR or (MOLD_DIAMETER_MM[kind] / 2.0)
    layout = cell_layout(kind=kind, ballR=R)
    
    p_low = [T_low[i][3] for i in range(3)]
    p_high = [T_high[i][3] for i in range(3)]
    R_low = [row[:3] for row in T_low[:3]]
    R_high = [row[:3] for row in T_high[:3]]
    
    p_mid = mul3s(add3(p_low, p_high), 0.5)
    
    axis_y = sub3(p_high, p_low)
    dist = len3(axis_y) or 1.0
    axis_y = unit3(axis_y) # +Y along the chain
    
    # Orthonormal frame
    axis_x = unit3([(R_low[0][i] + R_high[0][i]) / 2.0 for i in range(3)])
    dot_xy = dot3(axis_x, axis_y)
    axis_x = unit3(sub3(axis_x, mul3s(axis_y, dot_xy)))
    axis_z = unit3(cross3(axis_x, axis_y))
    
    R_frame = [
        [axis_x[0], axis_y[0], axis_z[0]],
        [axis_x[1], axis_y[1], axis_z[1]],
        [axis_x[2], axis_y[2], axis_z[2]]
    ]
    
    def to_world(loc):
        rot = mx.mXV(R_frame, loc)
        return add3(p_mid, rot)
        
    ring_top_w = [to_world(p) for p in layout['ringTop']]
    ring_bot_w = [to_world(p) for p in layout['ringBot']]
    equator_w = [to_world(p) for p in layout['equator']]
    waist_up_w = [to_world(p) for p in layout['waistUp']] if layout['waistUp'] else None
    waist_dn_w = [to_world(p) for p in layout['waistDn']] if layout['waistDn'] else None
    
    chevrons = []
    sectors = layout['sectors']
    if kind == 'truss':
        for k in range(sectors):
            k_next = (k + 1) % sectors
            # Top row
            chevrons.append({'a': ring_top_w[k], 'fold': waist_up_w[k], 'b': ring_top_w[k_next], 'row': 'top'})
            # Upper waist to equator
            chevrons.append({'a': waist_up_w[k], 'fold': equator_w[k], 'b': waist_up_w[k_next], 'row': 'mid_up'})
            # Lower waist to equator
            chevrons.append({'a': waist_dn_w[k], 'fold': equator_w[k], 'b': waist_dn_w[k_next], 'row': 'mid_dn'})
            # Bottom row
            chevrons.append({'a': ring_bot_w[k], 'fold': waist_dn_w[k], 'b': ring_bot_w[k_next], 'row': 'bot'})
    else: # Equatorial
        for k in range(sectors):
            k_next = (k + 1) % sectors
            # Connect top ring to equator fold and bottom ring
            chevrons.append({'a': ring_top_w[k], 'fold': equator_w[k], 'b': ring_bot_w[k], 'row': 'equatorial'})
            chevrons.append({'a': ring_top_w[k_next], 'fold': equator_w[k], 'b': ring_bot_w[k_next], 'row': 'equatorial'})
            
    return {
        'kind': kind,
        'p_low': p_low,
        'p_high': p_high,
        'p_mid': p_mid,
        'axis': axis_y,
        'R_frame': R_frame,
        'ringTop': ring_top_w,
        'ringBot': ring_bot_w,
        'equator': equator_w,
        'waistUp': waist_up_w,
        'waistDn': waist_dn_w,
        'chevrons': chevrons,
        'cellHeight': layout['cellHeight']
    }
