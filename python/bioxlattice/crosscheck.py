"""Second-kernel check: the envelope and skin rebuilt with smlibpy (SMLib, the kernel behind
smlibwasm) must match the CadQuery (OpenCASCADE) volumes of the same spec.

Lattice struts are not cross-checked here (the full part is too slow to repeat in a second kernel).
"""
from __future__ import annotations

import cadquery as cq

from .spec import CoupledSpec


def opencascade_volumes(spec: CoupledSpec) -> dict:
    e, t = spec.envelope, spec.skin.thickness
    r_in = max(e.edge_fillet - t, 0.2)
    outer = cq.Workplane("XY").box(e.length, e.width, e.height).edges("|Z").fillet(e.edge_fillet).val()
    cavity = (cq.Workplane("XY").box(e.length - 2 * t, e.width - 2 * t, e.height - 2 * t)
              .edges("|Z").fillet(r_in).val())
    return {"envelope": outer.Volume(), "cavity": cavity.Volume(), "skin": outer.cut(cavity).Volume()}


def smlibpy_volumes(spec: CoupledSpec) -> dict:
    import smlibpy as sm

    e, t = spec.envelope, spec.skin.thickness
    r_in = max(e.edge_fillet - t, 0.2)

    def rbox(lx, ly, lz, r):
        p = sm.Box(lx, ly, lz)
        return p.fillet(p.edges().parallel_to((0, 0, 1)), r)

    outer = rbox(e.length, e.width, e.height, e.edge_fillet)
    cavity = rbox(e.length - 2 * t, e.width - 2 * t, e.height - 2 * t, r_in)
    return {"envelope": outer.volume, "cavity": cavity.volume, "skin": outer.cut(cavity).volume}


def compare(spec: CoupledSpec) -> dict:
    a = opencascade_volumes(spec)
    b = smlibpy_volumes(spec)
    rel = {k: abs(a[k] - b[k]) / a[k] for k in a}
    return {"opencascade": a, "smlibpy": b, "rel_error": rel, "agree_1e-5": all(v < 1e-5 for v in rel.values())}
