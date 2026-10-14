"""Copy-executable parametric build (run from this folder: python design_code.py).

Needs cadquery 2.8 (see python/requirements.txt). The spec below is the DesignState parameter set.
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "python"))
from bioxlattice.spec import CoupledSpec
from bioxlattice.build import build
from bioxlattice.exporter import write_step

SPEC = json.loads('{"name": "fcc_graded_test", "envelope": {"length": 30.0, "width": 30.0, "height": 16.0, "edge_fillet": 2.0}, "skin": {"thickness": 1.5}, "lattice": {"topology": "fcc", "cell": 6.0, "twist_deg_per_mm": 0.0, "overlap": 0.2, "tier_depths": [3.0, 6.0], "tier_radii": [0.9, 0.6, 0.4]}, "vents": {"enabled": true, "diameter": 1.6, "positions": [[-7.0, -7.0], [7.0, -7.0], [-7.0, 7.0], [7.0, 7.0]]}, "tessellation": {"deflection_mm": 0.02, "angular_rad": 0.1}}')

if __name__ == "__main__":
    spec = CoupledSpec.from_dict(SPEC)
    result = build(spec)
    write_step(result.part, os.path.join(HERE, spec.name + ".step"))
    print("volume_mm3", round(result.part.Volume(), 3), "solids", len(result.part.Solids()))
