"""
model3d.py — the arm's 3D model, built from the model withdrawn from the CSVs.

The geometry follows the paper's own composition (`trunc_model.m: draw_arm` draws
the joints as spheres at the stage frames; the paper's Fig. 3/4 text gives the
nesting):

  * seven TRUNC cells along the arm — 3 in the shoulder, 2 in the elbow, 2 in the
    wrist (Fig. 4A, Materials and Methods);
  * two *nested* shafts: the inner truss cell (mould D = 56 mm) carries torque to
    the tool, the outer equatorial cell (mould D = 88 mm) wraps it and guides the
    actuation tendons ("The truss flex shaft is then nested within an equatorial
    shaft that guides the actuation tendons");
  * the 4 mm steel rod + bearing connectors between chained cells;
  * a cable guide triad at each of the four stage frames, cables at the MATLAB's
    65 mm triangle radius, nine tendons in three groups of three;
  * the tool offset (83 mm) beyond the wrist.

`export_obj` writes it as Wavefront OBJ (faces + tendon lines) so the withdrawn
model can be opened in any CAD viewer, and `render_preview` rasterises it with
the pure-Python renderer in plot.py.
"""

import math

from .kinematics import CELLS_PER_SEGMENT, CABLE_RADIUS, TOOL_LENGTH, corners_of, forward, segment_transform
from .mathx import mXV, mdot
from .plot import Camera, Canvas, render_lines, render_mesh

# mould diameters (Materials and Methods: "a spherical mold with a 56 mm diameter
# for the truss cells and an 88 mm diameter mold for equatorial cells")
TRUSS_R = 56.0 / 2
EQUATORIAL_R = 88.0 / 2
ROD_R = 2.0            # 4 mm steel rod between chained cells
BEARING_R = 6.5        # 6655K47 bearing OD/2 the rod slides in
GUIDE_R = 2.4


# ---------------------------------------------------------------- primitives

def sphere(center, r, useg=14, vseg=7):
    verts, faces = [], []
    for j in range(vseg + 1):
        phi = math.pi * j / vseg
        for i in range(useg):
            th = 2 * math.pi * i / useg
            verts.append([
                center[0] + r * math.sin(phi) * math.cos(th),
                center[1] + r * math.cos(phi),
                center[2] + r * math.sin(phi) * math.sin(th),
            ])
    for j in range(vseg):
        for i in range(useg):
            a = j * useg + i
            b = j * useg + (i + 1) % useg
            c = (j + 1) * useg + (i + 1) % useg
            d = (j + 1) * useg + i
            faces.append([a, b, c])
            faces.append([a, c, d])
    return verts, faces


def cylinder(p0, p1, r0, r1=None, seg=10):
    """Closed truncated cone from p0 to p1."""
    r1 = r0 if r1 is None else r1
    d = [p1[i] - p0[i] for i in range(3)]
    L = math.sqrt(sum(c * c for c in d)) or 1e-9
    axis = [c / L for c in d]
    ref = [0.0, 1.0, 0.0] if abs(axis[1]) < 0.9 else [1.0, 0.0, 0.0]
    u = _norm(_cross(axis, ref))
    v = _cross(axis, u)
    verts, faces = [], []
    for k, (p, r) in enumerate(((p0, r0), (p1, r1))):
        for i in range(seg):
            th = 2 * math.pi * i / seg
            verts.append([
                p[0] + r * (math.cos(th) * u[0] + math.sin(th) * v[0]),
                p[1] + r * (math.cos(th) * u[1] + math.sin(th) * v[1]),
                p[2] + r * (math.cos(th) * u[2] + math.sin(th) * v[2]),
            ])
    for i in range(seg):
        a, b = i, (i + 1) % seg
        c, d2 = seg + (i + 1) % seg, seg + i
        faces.append([a, b, c])
        faces.append([a, c, d2])
    center0 = len(verts)
    verts.append(list(p0))
    center1 = len(verts)
    verts.append(list(p1))
    for i in range(seg):
        a, b = i, (i + 1) % seg
        faces.append([center0, b, a])
        faces.append([center1, seg + a, seg + b])
    return verts, faces


def ring(center, R, seg=24, r=1.2):
    """A thin torus in the plane normal to +Y at `center`."""
    verts, faces = [], []
    for i in range(seg):
        th = 2 * math.pi * i / seg
        cx = center[0] + R * math.cos(th)
        cz = center[2] + R * math.sin(th)
        for j in range(4):
            ph = 2 * math.pi * j / 4
            verts.append([
                center[0] + (R + r * math.cos(ph)) * math.cos(th),
                center[1] + r * math.sin(ph),
                center[2] + (R + r * math.cos(ph)) * math.sin(th),
            ])
    for i in range(seg):
        for j in range(4):
            a = (i % seg) * 4 + j
            b = (i % seg) * 4 + (j + 1) % 4
            c = ((i + 1) % seg) * 4 + (j + 1) % 4
            d = ((i + 1) % seg) * 4 + j
            faces.append([a, b, c])
            faces.append([a, c, d])
    return verts, faces


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _norm(a):
    n = math.sqrt(sum(c * c for c in a)) or 1e-9
    return [c / n for c in a]


class Mesh:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.groups = {}          # name → list of face indices
        self.lines = {}           # name → list of point polylines

    def add(self, verts, faces, group=None):
        base = len(self.verts)
        self.verts.extend(verts)
        idx = []
        for f in faces:
            self.faces.append([i + base for i in f])
            idx.append(len(self.faces) - 1)
        if group:
            self.groups.setdefault(group, []).extend(idx)
        return idx

    def add_line(self, points, group):
        self.lines.setdefault(group, []).append([list(p) for p in points])

    def stats(self):
        return {
            'vertices': len(self.verts),
            'triangles': len(self.faces),
            'groups': {k: len(v) for k, v in self.groups.items()},
            'tendons': sum(len(v) for v in self.lines.values()),
        }


# --------------------------------------------------------------- arm builder

def cell_frames(fk, cells_per_segment=CELLS_PER_SEGMENT):
    """
    One frame per TRUNC cell, by spreading each stage's bend over its cells —
    the same `segment_transform(a*f, b, -len*f)` distribution the browser app and
    the two-pass linkage solver use.
    """
    out = []
    tl = fk['tool_params']
    t1, t2, t3, t4, t5, t6, L = tl
    splits = (3 / 7, 2 / 7, 2 / 7)
    for s, n in enumerate(cells_per_segment):
        a = [t1, t3, t5][s]
        b = [t2, t4, t6][s]
        for k in range(n):
            f = (k + 1) / n
            T = segment_transform(a * f, b, -splits[s] * L * f)
            out.append(T)
    return out


def build_arm(fk_params, cells_per_segment=CELLS_PER_SEGMENT, equatorial_shell=True):
    """
    The complete 3D model for one configuration. `fk_params` is
    (t1..t6, L) as produced by `kinematics.fit_stage`.

    Returns a Mesh with groups: 'truss_cells', 'equatorial_cells', 'connectors',
    'guides', 'tool', plus line groups 'tendons' and 'axis'.
    """
    fk = forward(*fk_params)
    fk['tool_params'] = list(fk_params)
    mesh = Mesh()

    # ---- the nested cell chains along the arm
    frames = [('base', None)] + [(f'cell{i}', T) for i, T in enumerate(cell_frames(fk, cells_per_segment))]
    nodes = [p for p in fk['nodes']]
    # cell centres: from the base frame through each cell frame
    centres = [[0.0, 0.0, 0.0]] + [[T[0][3], T[1][3], T[2][3]] for T in cell_frames(fk, cells_per_segment)]
    for c in centres[1:]:
        v, f = sphere(c, TRUSS_R, 12, 6)
        mesh.add(v, f, 'truss_cells')
        if equatorial_shell:
            v, f = sphere(c, EQUATORIAL_R, 16, 8)
            mesh.add(v, f, 'equatorial_cells')
    # the 4 mm rod + bearing between chained cells, and from base/wrist outward
    chain = [[0.0, 0.0, 0.0]] + centres[1:]
    for a, b in zip(chain[:-1], chain[1:]):
        v, f = cylinder(a, b, ROD_R, seg=8)
        mesh.add(v, f, 'connectors')
        mid = [(a[i] + b[i]) / 2 for i in range(3)]
        v, f = sphere(mid, BEARING_R, 10, 5)
        mesh.add(v, f, 'connectors')
    wrist_p = fk['nodes'][3]
    tool_p = [fk['tool'][0][3], fk['tool'][1][3], fk['tool'][2][3]]
    v, f = cylinder(chain[-1], tool_p, ROD_R, seg=8)
    mesh.add(v, f, 'connectors')

    # ---- cable guide triads at the four stage frames, cables at 65 mm
    for T in fk['stages']:
        origin = [T[0][3], T[1][3], T[2][3]]
        v, f = ring(origin, CABLE_RADIUS, 28, 1.4)
        mesh.add(v, f, 'guides')
        for corner in corners_of(T, CABLE_RADIUS):
            v, f = cylinder(origin, corner, GUIDE_R, 1.6, seg=6)
            mesh.add(v, f, 'guides')
            v, f = sphere(corner, 2.2, 8, 4)
            mesh.add(v, f, 'guides')

    # ---- nine tendons: three per segment, corner i to corner i of the next frame
    rings = fk['cable_ring']
    for s in range(3):
        for i in range(3):
            mesh.add_line([rings[s][i], rings[s + 1][i]], 'tendons')

    # ---- tool: the socket driver past the wrist
    tool_dir = _norm([fk['tool'][0][2], fk['tool'][1][2], fk['tool'][2][2]])
    tool_len = abs(TOOL_LENGTH)
    end = [tool_p[i] + tool_dir[i] * tool_len for i in range(3)]
    v, f = cylinder(tool_p, end, 11.0, 9.0, seg=12)
    mesh.add(v, f, 'tool')
    v, f = cylinder(end, [end[i] + tool_dir[i] * 6 for i in range(3)], 9.0, 9.0, seg=12)
    mesh.add(v, f, 'tool')

    mesh.add_line([chain[0], tool_p], 'axis')
    return mesh


# ------------------------------------------------------------------ outputs

def export_obj(path, mesh, title='TRUNC arm — 3D model withdrawn from the CSV data'):
    lines = [f'# {title}', f'# vertices={len(mesh.verts)} faces={len(mesh.faces)}', 'o trunc_arm']
    for v in mesh.verts:
        lines.append('v %.4f %.4f %.4f' % (v[0], v[1], v[2]))
    for name, idxs in mesh.groups.items():
        lines.append(f'g {name}')
        for i in idxs:
            f = mesh.faces[i]
            lines.append('f %d %d %d' % (f[0] + 1, f[1] + 1, f[2] + 1))
    for name, polys in mesh.lines.items():
        for poly in polys:
            base = len(mesh.verts)
            # OBJ lines reference vertices; reuse existing coordinates by index is
            # not possible here, so re-emit them as a separate line group
            lines.append(f'g {name}')
            for p in poly:
                lines.append('v %.4f %.4f %.4f' % (p[0], p[1], p[2]))
            lines.append('l ' + ' '.join(str(len(mesh.verts) + k + 1) for k in range(len(poly))))
            mesh.verts.extend(poly)
    with open(path, 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    return path


GROUPS_OF = ['truss_cells', 'equatorial_cells', 'connectors', 'guides', 'tool']


def render_preview(path, mesh, width=900, height=640, title='', eye_scale=1.0):
    """
    Rasterise the model: solid primitives shaded, tendons as coloured lines.

    The model lives in the kinematics' own frame, where the arm grows along −Z.
    For the picture it is rotated into a y-up view — `(x, y, z) → (x, −z, y)` —
    so the arm rises up the image, which is how the paper photographs it.
    """
    def to_view(p):
        return [p[0], -p[2], p[1]]

    canvas = Canvas(width, height, bg=(250, 250, 252), supersample=1)
    verts = [to_view(v) for v in mesh.verts]
    lo = [min(v[i] for v in verts) for i in range(3)]
    hi = [max(v[i] for v in verts) for i in range(3)]
    ctr = [(lo[i] + hi[i]) / 2 for i in range(3)]
    span = max(hi[i] - lo[i] for i in range(3)) or 1.0
    dist = 1.85 * span * eye_scale
    cam = Camera([ctr[0] + dist * 0.42, ctr[1] + dist * 0.18, ctr[2] + dist * 0.88], ctr,
                 fov_deg=30, width=width, height=height)
    colors = {
        'truss_cells': (108, 122, 142),
        'equatorial_cells': (176, 188, 205),
        'connectors': (150, 150, 156),
        'guides': (200, 168, 96),
        'tool': (176, 178, 184),
    }
    # draw the outer shells first so the inner truss reads through them
    for name in ['equatorial_cells', 'truss_cells', 'guides', 'connectors', 'tool']:
        idx = mesh.groups.get(name)
        if not idx:
            continue
        sub = {'verts': verts, 'faces': [mesh.faces[i] for i in idx]}
        render_mesh(canvas, sub, cam, color=colors.get(name, (150, 150, 150)),
                    light=(-0.42, 0.8, -0.43), edges=False, ambient=0.46)
    palette = [(228, 26, 28), (55, 126, 184), (77, 175, 74)]
    for name, polys in mesh.lines.items():
        if name == 'tendons':
            for k, poly in enumerate(polys):
                col = palette[k % 3]
                pv = [to_view(p) for p in poly]
                segs = [(pv[i], pv[i + 1]) for i in range(len(pv) - 1)]
                render_lines(canvas, cam, segs, col, 3)
        else:
            for poly in polys:
                pv = [to_view(p) for p in poly]
                segs = [(pv[i], pv[i + 1]) for i in range(len(pv) - 1)]
                render_lines(canvas, cam, segs, (60, 60, 66), 2)
    if title:
        canvas.text(12, 12, title, (40, 44, 52), 2)
    canvas.save_png(path)
    return path
