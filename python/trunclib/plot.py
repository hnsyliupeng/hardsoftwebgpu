"""
plot.py — a dependency-free raster plotter and PNG writer.

There is no matplotlib in this environment, and the deliverable has to run on a
plain `python3`, so this module provides just enough of one: a float RGB canvas,
a 3x5 stroke font for labels, a z-buffered flat-shaded triangle rasteriser for
3D views, and a PNG encoder built on `zlib`.

Everything is deliberately small; the analyses draw axes, trajectories and
scatter clouds, not publication figures.
"""

import math
import struct
import zlib

# ------------------------------------------------------------------ palette
# Brewer Set1, the map the MATLAB analysis scripts use (`brewermap(9,'Set1')`).

SET1 = [
    (228, 26, 28), (55, 126, 184), (77, 175, 74), (152, 78, 163),
    (255, 127, 0), (255, 255, 51), (166, 86, 40), (247, 129, 191),
    (153, 153, 153),
]
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREY = (150, 150, 150)
LGREY = (215, 215, 215)
NAVY = (33, 41, 54)

# --------------------------------------------------------------------- font
# 3x5 stroke glyphs; every character is five rows of three cells.

_GLYPHS = {
    'A': ['.#.', '#.#', '###', '#.#', '#.#'],
    'B': ['##.', '#.#', '##.', '#.#', '##.'],
    'C': ['###', '#..', '#..', '#..', '###'],
    'D': ['##.', '#.#', '#.#', '#.#', '##.'],
    'E': ['###', '#..', '##.', '#..', '###'],
    'F': ['###', '#..', '##.', '#..', '#..'],
    'G': ['###', '#..', '#.#', '#.#', '###'],
    'H': ['#.#', '#.#', '###', '#.#', '#.#'],
    'I': ['###', '.#.', '.#.', '.#.', '###'],
    'J': ['..#', '..#', '..#', '#.#', '###'],
    'K': ['#.#', '#.#', '##.', '#.#', '#.#'],
    'L': ['#..', '#..', '#..', '#..', '###'],
    'M': ['#.#', '###', '###', '#.#', '#.#'],
    'N': ['#.#', '###', '###', '###', '#.#'],
    'O': ['###', '#.#', '#.#', '#.#', '###'],
    'P': ['###', '#.#', '###', '#..', '#..'],
    'Q': ['###', '#.#', '#.#', '###', '..#'],
    'R': ['###', '#.#', '##.', '#.#', '#.#'],
    'S': ['###', '#..', '###', '..#', '###'],
    'T': ['###', '.#.', '.#.', '.#.', '.#.'],
    'U': ['#.#', '#.#', '#.#', '#.#', '###'],
    'V': ['#.#', '#.#', '#.#', '#.#', '.#.'],
    'W': ['#.#', '#.#', '###', '###', '#.#'],
    'X': ['#.#', '#.#', '.#.', '#.#', '#.#'],
    'Y': ['#.#', '#.#', '###', '.#.', '.#.'],
    'Z': ['###', '..#', '.#.', '#..', '###'],
    '0': ['###', '#.#', '#.#', '#.#', '###'],
    '1': ['.#.', '##.', '.#.', '.#.', '###'],
    '2': ['###', '..#', '###', '#..', '###'],
    '3': ['###', '..#', '###', '..#', '###'],
    '4': ['#.#', '#.#', '###', '..#', '..#'],
    '5': ['###', '#..', '###', '..#', '###'],
    '6': ['###', '#..', '###', '#.#', '###'],
    '7': ['###', '..#', '..#', '..#', '..#'],
    '8': ['###', '#.#', '###', '#.#', '###'],
    '9': ['###', '#.#', '###', '..#', '###'],
    '.': ['...', '...', '...', '...', '.#.'],
    ',': ['...', '...', '...', '.#.', '#..'],
    ':': ['...', '.#.', '...', '.#.', '...'],
    '-': ['...', '...', '###', '...', '...'],
    '+': ['...', '.#.', '###', '.#.', '...'],
    '/': ['..#', '..#', '.#.', '#..', '#..'],
    '=': ['...', '###', '...', '###', '...'],
    '(': ['..#', '.#.', '.#.', '.#.', '..#'],
    ')': ['#..', '.#.', '.#.', '.#.', '#..'],
    '%': ['#.#', '..#', '.#.', '#..', '#.#'],
    'DEG': ['##.', '#.#', '##.', '...', '...'],      # ° as four cells high
    '*': ['...', '#.#', '.#.', '#.#', '...'],
    ' ': ['...', '...', '...', '...', '...'],
}


def _glyph_bits(name):
    rows = _GLYPHS[name]
    bits = 0
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch == '#':
                bits |= 1 << (14 - (r * 3 + c))
    return bits


_BITS = {k: _glyph_bits(k) for k in _GLYPHS}


# -------------------------------------------------------------------- canvas

class Canvas:
    """
    Float RGB canvas. `supersample=2` renders at twice the resolution and box
    filters on save, which is how the scatter plots get readable edges without
    an anti-aliasing library.
    """

    def __init__(self, w, h, bg=(255, 255, 255), supersample=2):
        self.out_w, self.out_h = w, h
        self.ss = max(1, int(supersample))
        self.w, self.h = w * self.ss, h * self.ss
        self.buf = [0.0] * (self.w * self.h * 3)
        self.depth = [float('inf')] * (self.w * self.h)
        self.bg = tuple(float(c) for c in bg)
        for i in range(len(self.depth)):
            self.depth[i] = float('inf')
        self.clear(bg)

    # ------------------------------------------------------------- primitives

    def clear(self, color=None):
        color = color or self.bg
        r, g, b = (float(c) for c in color)
        buf = self.buf
        for i in range(0, len(buf), 3):
            buf[i] = r
            buf[i + 1] = g
            buf[i + 2] = b
        for i in range(len(self.depth)):
            self.depth[i] = float('inf')

    def px(self, x, y, color, z=None):
        x = int(x)
        y = int(y)
        if x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        i = y * self.w + x
        if z is not None:
            if z >= self.depth[i]:
                return
            self.depth[i] = z
        p = i * 3
        self.buf[p] = color[0]
        self.buf[p + 1] = color[1]
        self.buf[p + 2] = color[2]

    def line(self, x0, y0, x1, y1, color, width=1, z=None, dashed=False):
        x0, y0, x1, y1 = x0 * self.ss, y0 * self.ss, x1 * self.ss, y1 * self.ss
        w = max(1, int(round(width * self.ss)))
        half = w // 2
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for s in range(steps + 1):
            if dashed and (s // 6) % 2 == 1:
                continue
            t = s / steps if steps else 0.0
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            for dy in range(-half, half + 1):
                for dx in range(-half, half + 1):
                    self.px(x + dx, y + dy, color, z)

    def rect(self, x, y, w, h, color, fill=False, width=1):
        if fill:
            for yy in range(int(y * self.ss), int((y + h) * self.ss)):
                for xx in range(int(x * self.ss), int((x + w) * self.ss)):
                    self.px(xx, yy, color)
        else:
            self.line(x, y, x + w, y, color, width)
            self.line(x, y + h, x + w, y + h, color, width)
            self.line(x, y, x, y + h, color, width)
            self.line(x + w, y, x + w, y + h, color, width)

    def dot(self, x, y, color, size=3, z=None):
        r = max(0.5, size / 2.0)
        x, y = x * self.ss, y * self.ss
        R = int(math.ceil(r * self.ss))
        for dy in range(-R, R + 1):
            for dx in range(-R, R + 1):
                if dx * dx + dy * dy <= (r * self.ss) ** 2:
                    self.px(x + dx, y + dy, color, z)

    def circle(self, x, y, r, color, width=1):
        seg = max(24, int(r * 6))
        for i in range(seg + 1):
            a = 2 * math.pi * i / seg
            x0, y0 = x + r * math.cos(a), y + r * math.sin(a)
            a2 = 2 * math.pi * (i + 1) / seg
            self.line(x0, y0, x + r * math.cos(a2), y + r * math.sin(a2), color, width)

    def text(self, x, y, s, color=BLACK, scale=1, spacing=1):
        """3x5 stroke text. `scale` is pixels per font cell."""
        step = (3 + spacing) * scale * self.ss
        cell = scale * self.ss
        cx = x * self.ss
        cy = y * self.ss
        for ch in str(s).upper():
            key = 'DEG' if ch == '°' else ch
            bits = _BITS.get(key)
            if bits is None:
                cx += step
                continue
            for r in range(5):
                for c in range(3):
                    if bits & (1 << (14 - (r * 3 + c))):
                        for dy in range(cell):
                            for dx in range(cell):
                                self.px(cx + c * cell + dx, cy + r * cell + dy, color)
            cx += step
        return cx / self.ss

    def text_width(self, s, scale=1, spacing=1):
        return len(str(s)) * (3 + spacing) * scale

    # ------------------------------------------------------------- 3d raster

    def tri(self, p0, p1, p2, color, zscale=1.0):
        """Z-buffered flat triangle in device pixels."""
        xs = [p0[0] * self.ss, p1[0] * self.ss, p2[0] * self.ss]
        ys = [p0[1] * self.ss, p1[1] * self.ss, p2[1] * self.ss]
        zs = [p0[2] * zscale, p1[2] * zscale, p2[2] * zscale]
        minx, maxx = int(min(xs)), int(max(xs)) + 1
        miny, maxy = int(min(ys)), int(max(ys)) + 1
        area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
        if abs(area) < 1e-9:
            return
        minx = max(0, minx)
        miny = max(0, miny)
        maxx = min(self.w - 1, maxx)
        maxy = min(self.h - 1, maxy)
        inv = 1.0 / area
        for y in range(miny, maxy + 1):
            for x in range(minx, maxx + 1):
                px, py = x + 0.5, y + 0.5
                w0 = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) * inv
                w1 = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) * inv
                w2 = ((xs[0] - px) * (ys[1] - py) - (xs[1] - px) * (ys[0] - py)) * inv
                if w0 < -1e-6 or w1 < -1e-6 or w2 < -1e-6:
                    continue
                z = w0 * zs[0] + w1 * zs[1] + w2 * zs[2]
                i = y * self.w + x
                if z >= self.depth[i]:
                    continue
                self.depth[i] = z
                p = i * 3
                self.buf[p] = color[0]
                self.buf[p + 1] = color[1]
                self.buf[p + 2] = color[2]

    # ----------------------------------------------------------------- output

    def resolve(self):
        """Downsamples to the output resolution, returns a bytes RGB buffer."""
        ss = self.ss
        out = bytearray(self.out_w * self.out_h * 3)
        if ss == 1:
            for i in range(self.out_w * self.out_h * 3):
                out[i] = max(0, min(255, int(self.buf[i] + 0.5)))
            return bytes(out)
        n = ss * ss
        for y in range(self.out_h):
            for x in range(self.out_w):
                r = g = b = 0.0
                for j in range(ss):
                    row = ((y * ss + j) * self.w + x * ss) * 3
                    for i in range(ss):
                        p = row + i * 3
                        r += self.buf[p]
                        g += self.buf[p + 1]
                        b += self.buf[p + 2]
                p = (y * self.out_w + x) * 3
                out[p] = max(0, min(255, int(r / n + 0.5)))
                out[p + 1] = max(0, min(255, int(g / n + 0.5)))
                out[p + 2] = max(0, min(255, int(b / n + 0.5)))
        return bytes(out)

    def save_png(self, path):
        rgb = self.resolve()
        w, h = self.out_w, self.out_h
        raw = bytearray()
        for y in range(h):
            raw.append(0)                                  # filter: none
            raw += rgb[y * w * 3:(y + 1) * w * 3]
        def chunk(tag, data):
            c = struct.pack('>I', len(data)) + tag + data
            return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        png = b'\x89PNG\r\n\x1a\n'
        png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
        png += chunk(b'IDAT', zlib.compress(bytes(raw), 6))
        png += chunk(b'IEND', b'')
        with open(path, 'wb') as fh:
            fh.write(png)
        return path


# ------------------------------------------------------------------- axes

class Axes:
    """A plotting rectangle with a data→pixel mapping, ticked and labelled."""

    def __init__(self, canvas, box, xlim, ylim, xlabel='', ylabel='', title='',
                 grid=True, equal=False):
        self.c = canvas
        self.x0, self.y0, self.w, self.h = box
        self.xlim = list(xlim)
        self.ylim = list(ylim)
        if equal:
            spanx = self.xlim[1] - self.xlim[0]
            spany = self.ylim[1] - self.ylim[0]
            if spanx / self.w > spany / self.h:
                cy = 0.5 * (self.ylim[0] + self.ylim[1])
                spany = spanx * self.h / self.w
                self.ylim = [cy - spany / 2, cy + spany / 2]
            else:
                cx = 0.5 * (self.xlim[0] + self.xlim[1])
                spanx = spany * self.w / self.h
                self.xlim = [cx - spanx / 2, cx + spanx / 2]
        self.xlabel, self.ylabel, self.title, self.grid = xlabel, ylabel, title, grid

    def X(self, x):
        (a, b) = self.xlim
        return self.x0 + (x - a) / (b - a) * self.w

    def Y(self, y):
        (a, b) = self.ylim
        return self.y0 + self.h - (y - a) / (b - a) * self.h

    def plot(self, xs, ys, color=SET1[1], width=1, dashed=False):
        prev = None
        for x, y in zip(xs, ys):
            if x is None or y is None:
                prev = None
                continue
            p = (self.X(x), self.Y(y))
            if prev is not None:
                self.c.line(prev[0], prev[1], p[0], p[1], color, width, dashed=dashed)
            prev = p

    def scatter(self, xs, ys, color=SET1[1], size=3):
        for x, y in zip(xs, ys):
            self.c.dot(self.X(x), self.Y(y), color, size)

    def hline(self, y, color=GREY, width=1, dashed=True):
        self.c.line(self.x0, self.Y(y), self.x0 + self.w, self.Y(y), color, width, dashed=dashed)

    def vline(self, x, color=GREY, width=1, dashed=True):
        self.c.line(self.X(x), self.y0, self.X(x), self.y0 + self.h, color, width, dashed=dashed)

    def finish(self, xticks=5, yticks=5):
        c = self.c
        if self.grid:
            for i in range(xticks + 1):
                x = self.xlim[0] + (self.xlim[1] - self.xlim[0]) * i / xticks
                c.line(self.X(x), self.y0, self.X(x), self.y0 + self.h, LGREY, 1)
            for i in range(yticks + 1):
                y = self.ylim[0] + (self.ylim[1] - self.ylim[0]) * i / yticks
                c.line(self.x0, self.Y(y), self.x0 + self.w, self.Y(y), LGREY, 1)
        c.rect(self.x0, self.y0, self.w, self.h, BLACK, width=1)
        for i in range(xticks + 1):
            x = self.xlim[0] + (self.xlim[1] - self.xlim[0]) * i / xticks
            px = self.X(x)
            c.line(px, self.y0 + self.h, px, self.y0 + self.h + 4, BLACK, 1)
            lbl = _fmt_tick(x)
            c.text(px - c.text_width(lbl) / 2, self.y0 + self.h + 7, lbl, BLACK, 1)
        for i in range(yticks + 1):
            y = self.ylim[0] + (self.ylim[1] - self.ylim[0]) * i / yticks
            py = self.Y(y)
            c.line(self.x0 - 4, py, self.x0, py, BLACK, 1)
            lbl = _fmt_tick(y)
            c.text(self.x0 - 7 - c.text_width(lbl), py - 2, lbl, BLACK, 1)
        if self.xlabel:
            c.text(self.x0 + self.w / 2 - c.text_width(self.xlabel) / 2,
                   self.y0 + self.h + 18, self.xlabel, BLACK, 1)
        if self.ylabel:
            c.text(self.x0 - 30, self.y0 + self.h / 2, self.ylabel, BLACK, 1)
        if self.title:
            c.text(self.x0 + self.w / 2 - c.text_width(self.title) / 2, self.y0 - 12, self.title, BLACK, 1)


def _fmt_tick(v):
    if abs(v) >= 1000:
        return '%d' % round(v)
    if abs(v) >= 100:
        return '%.0f' % v
    if abs(v) >= 10:
        return '%.1f' % v
    if abs(v) >= 1:
        return '%.1f' % v
    if abs(v) >= 0.01:
        return '%.2f' % v
    return '%.3f' % v


def legend(canvas, x, y, entries, scale=1, dy=9):
    """entries: [(label, colour)]"""
    for i, (label, color) in enumerate(entries):
        yy = y + i * dy
        canvas.line(x, yy + 2, x + 10, yy + 2, color, 2)
        canvas.text(x + 14, yy, label, BLACK, scale)


# ------------------------------------------------------------------- 3d view

class Camera:
    """Look-at camera with a perspective projection, y-up world."""

    def __init__(self, eye, target, up=(0, 1, 0), fov_deg=35.0, width=900, height=600):
        self.width, self.height = width, height
        self.f = 1.0 / math.tan(math.radians(fov_deg) * 0.5)
        f = [target[i] - eye[i] for i in range(3)]
        n = math.sqrt(sum(c * c for c in f)) or 1.0
        self.fwd = [c / n for c in f]
        up = list(up)
        right = _cross(self.fwd, up)
        n = math.sqrt(sum(c * c for c in right)) or 1.0
        self.right = [c / n for c in right]
        self.up = _cross(self.right, self.fwd)
        self.eye = list(eye)

    def project(self, p):
        d = [p[i] - self.eye[i] for i in range(3)]
        x = _dot(self.right, d)
        y = _dot(self.up, d)
        z = _dot(self.fwd, d)
        if z <= 1e-6:
            return (0.0, 0.0, 1e9)
        aspect = self.width / self.height
        sx = (x / z * self.f / aspect) * 0.5 + 0.5
        sy = 1.0 - ((y / z * self.f) * 0.5 + 0.5)
        return (sx * self.width, sy * self.height, z)


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def render_mesh(canvas, mesh, camera, color=(150, 160, 175), light=(-0.4, 0.85, -0.35),
                edges=False, edge_color=(40, 45, 55), ambient=0.38):
    """
    Flat-shaded, z-buffered render of `mesh = {'verts': [...], 'faces': [[i,j,k], ...]}`.
    Shading is Lambert against a single key light, the same recipe the WebGPU app
    uses, so the Python preview reads like the browser view.
    """
    verts = mesh['verts']
    ln = math.sqrt(sum(c * c for c in light)) or 1.0
    L = [c / ln for c in light]
    proj = [camera.project(v) for v in verts]
    for face in mesh['faces']:
        try:
            a, b, c = (verts[face[0]], verts[face[1]], verts[face[2]])
        except IndexError:
            continue
        n = _cross([b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)])
        nl = math.sqrt(sum(t * t for t in n)) or 1.0
        n = [t / nl for t in n]
        lam = abs(_dot(n, L))
        k = ambient + (1.0 - ambient) * lam
        col = (min(255, color[0] * k), min(255, color[1] * k), min(255, color[2] * k))
        pa, pb, pc = proj[face[0]], proj[face[1]], proj[face[2]]
        canvas.tri(pa, pb, pc, col)
        if edges:
            canvas.line(pa[0], pa[1], pb[0], pb[1], edge_color, 1, z=pa[2] * 0.999)
            canvas.line(pb[0], pb[1], pc[0], pc[1], edge_color, 1, z=pb[2] * 0.999)
            canvas.line(pc[0], pc[1], pa[0], pa[1], edge_color, 1, z=pc[2] * 0.999)


def render_lines(canvas, camera, segs, color, width=1):
    for a, b in segs:
        pa = camera.project(a)
        pb = camera.project(b)
        if pa[2] > 1e8 or pb[2] > 1e8:
            continue
        canvas.line(pa[0], pa[1], pb[0], pb[1], color, width)
