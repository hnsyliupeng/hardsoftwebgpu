"""
csvio.py — readers for the authors' data files, stdlib only.

* `read_csv`  — a real CSV reader (quoted fields, embedded commas).
* `table`     — column access by header name, numeric coercion on demand.
* `read_mat`  — a MATLAB v5 (`.mat`) reader good enough for the files this
  project ships: numeric arrays (double/single/8/16/32/64-bit ints), chars,
  cells and structs, both uncompressed and zlib-compressed. That is what
  `positions*.csv`'s sibling `.mat` files (`wp`, `segments`, encoder traces)
  need, and it keeps the simulation dependency-free.
"""

import struct
import zlib

# --------------------------------------------------------------------- csv

def parse_csv_line(line):
    cells = []
    cur = ''
    quoted = False
    i = 0
    while i < len(line):
        ch = line[i]
        if quoted:
            if ch == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    cur += '"'
                    i += 1
                else:
                    quoted = False
            else:
                cur += ch
        elif ch == '"':
            quoted = True
        elif ch == ',':
            cells.append(cur.strip())
            cur = ''
        else:
            cur += ch
        i += 1
    cells.append(cur.strip())
    return cells


def read_csv(path):
    """Returns (header, rows) with rows as lists of strings."""
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        lines = [ln for ln in fh.read().splitlines() if ln.strip()]
    if not lines:
        return [], []
    header = [h.strip().strip('"') for h in parse_csv_line(lines[0])]
    rows = [parse_csv_line(ln) for ln in lines[1:]]
    return header, rows


def to_float(s, default=None):
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


class Table:
    """Column-wise view of a CSV: `t['z_end_avg']` → list of floats (or None)."""

    def __init__(self, path):
        self.path = path
        self.header, self.rows = read_csv(path)
        self.index = {h: i for i, h in enumerate(self.header)}

    def __len__(self):
        return len(self.rows)

    def has(self, col):
        return col in self.index

    def raw(self, col):
        i = self.index[col]
        return [r[i] if i < len(r) else '' for r in self.rows]

    def col(self, col, default=0.0):
        out = []
        for v in self.raw(col):
            f = to_float(v)
            out.append(default if f is None else f)
        return out

    def text(self, col):
        return self.raw(col)

    def cols(self, names, default=0.0):
        return {n: self.col(n, default) for n in names}

    def matrix(self, names):
        """List of rows [v1, v2, ...] for the given column names."""
        cols = [self.col(n) for n in names]
        return [[c[i] for c in cols] for i in range(len(self.rows))]


# --------------------------------------------------------------------- mat

# data type → (struct format character, width). The format characters are the
# single-character codes `struct` accepts.
_MI = {
    1: ('b', 1), 2: ('B', 1), 3: ('h', 2), 4: ('H', 2),
    5: ('i', 4), 6: ('I', 4), 7: ('f', 4), 9: ('d', 8),
    12: ('q', 8), 13: ('Q', 8),
}
_MI_COMPRESSED = 15
_MI_MATRIX = 14

_CLASS_INT8, _CLASS_UINT8, _CLASS_INT16, _CLASS_UINT16 = 8, 9, 10, 11
_CLASS_INT32, _CLASS_UINT32, _CLASS_SINGLE, _CLASS_DOUBLE = 12, 13, 7, 6
_CLASS_CHAR, _CLASS_CELL, _CLASS_STRUCT = 4, 1, 2


def _read_tag(buf, pos):
    """Returns (type, nbytes, data_start, next_pos).

    A tag is either a "small data element" — the *type in the low 16 bits* and the
    byte count in the high 16 bits of one word, the payload in the following 4 —
    or a regular 8-byte tag (type word then byte count) whose payload is padded to
    a multiple of 8 bytes.
    """
    word = struct.unpack_from('<I', buf, pos)[0]
    if word >> 16:                        # small data element
        return word & 0xFFFF, word >> 16, pos + 4, pos + 8
    nbytes = struct.unpack_from('<I', buf, pos + 4)[0]
    return word, nbytes, pos + 8, pos + 8 + ((nbytes + 7) // 8) * 8


def _read_number_array(buf, data_start, nbytes, mi_type):
    if mi_type not in _MI:
        return None
    fmt, size = _MI[mi_type]
    count = nbytes // size
    if not count:
        return []
    values = struct.unpack_from('<' + fmt * count, buf, data_start)
    return [float(v) if fmt == 'f' else v for v in values]


def _read_chars(buf, data_start, nbytes):
    return bytes(buf[data_start:data_start + nbytes]).decode('latin-1')


def _read_matrix(buf, pos):
    """Reads an miMATRIX element, returns (name, value, next_pos)."""
    _, nbytes, dstart, nxt = _read_tag(buf, pos)
    p = dstart
    # array flags: 8 bytes; the class is the low byte of the first word
    _, flags_len, flags_start, _ = _read_tag(buf, p)
    flags = struct.unpack_from('<I', buf, flags_start)[0]
    cls = flags & 0xFF
    p = flags_start + 8
    # dimensions
    dims_type, dims_len, dims_start, dims_next = _read_tag(buf, p)
    dims = list(_read_number_array(buf, dims_start, dims_len, dims_type) or []) if dims_type in _MI else []
    p = dims_next
    # name
    name_type, name_len, name_start, name_next = _read_tag(buf, p)
    if name_type in (1, 2):
        name = _read_chars(buf, name_start, name_len)
    else:
        name = ''.join(chr(int(c)) for c in (_read_number_array(buf, name_start, name_len, name_type) or []))
    p = name_next
    rows, cols = (int(dims[0]) if dims else 0), (int(dims[1]) if len(dims) > 1 else 1)
    count = rows * cols

    value = None
    if cls in (_CLASS_DOUBLE, _CLASS_SINGLE, _CLASS_INT8, _CLASS_UINT8, _CLASS_INT16,
               _CLASS_UINT16, _CLASS_INT32, _CLASS_UINT32, _CLASS_CHAR):
        t, ln, ds, dn = _read_tag(buf, p)
        flat = _read_number_array(buf, ds, ln, t) or []
        if cls == _CLASS_CHAR:
            value = _read_chars(buf, ds, ln)
        elif rows > 1 or cols > 1:
            # MATLAB stores matrices column-major: the first `rows` values are the
            # first column. Rebuild rows × cols from that.
            value = [[flat[c * rows + r] for c in range(cols)] for r in range(rows)] \
                if len(flat) >= count else flat
        else:
            value = flat[0] if flat else None
        p = dn
    elif cls == _CLASS_CELL:
        _, ln, ds, _ = _read_tag(buf, p)
        cell_end = ds + ln
        items = []
        q = ds
        while q < cell_end:
            _, item, q = _read_matrix(buf, q)
            items.append(item)
        value = items
        p = cell_end
    elif cls == _CLASS_STRUCT:
        nfields = struct.unpack_from('<i', buf, p)[0]
        field_len = struct.unpack_from('<i', buf, p + 4)[0]
        names = []
        start = p + 8
        for i in range(nfields):
            raw = buf[start + i * field_len:start + (i + 1) * field_len]
            names.append(raw.split(b'\x00')[0].decode('latin-1'))
        p += 8 + nfields * field_len
        items = []
        for _ in range(count):
            entry = {}
            for fname in names:
                _, item, p = _read_matrix(buf, p)
                entry[fname] = item
            items.append(entry)
        value = items[0] if count == 1 else items
    return name, value, nxt


def read_mat(path):
    """Returns {name: value}. Values are nested lists (row-major), scalars, or
    structs (dicts). Enough for the project's `wp`, `segments` and encoder files."""
    with open(path, 'rb') as fh:
        buf = fh.read()
    if not buf[:5] == b'MATLA':            # not a MATLAB file at all
        raise ValueError(f'{path}: not a MATLAB file')
    pos = 128
    out = {}
    while pos < len(buf) - 8:
        mi_type, nbytes, dstart, nxt = _read_tag(buf, pos)
        if mi_type == _MI_COMPRESSED:
            raw = zlib.decompress(buf[dstart:dstart + nbytes])
            inner = 0
            while inner < len(raw) - 8:
                t2, _, _, n2 = _read_tag(raw, inner)
                if t2 != _MI_MATRIX:
                    inner = n2
                    continue
                name, value, n2 = _read_matrix(raw, inner)
                out[name] = value
                inner = n2
            pos = dstart + nbytes
        elif mi_type == _MI_MATRIX:
            name, value, nxt2 = _read_matrix(buf, pos)
            out[name] = value
            pos = nxt2
        else:
            pos = nxt
        if nxt <= pos - 1 and mi_type not in (_MI_COMPRESSED, _MI_MATRIX):
            pos = nxt
    return out
