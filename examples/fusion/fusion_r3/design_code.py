"""Copy-executable parametric build (run from this folder: python design_code.py).

Needs cadquery 2.8 (see python/requirements.txt). The spec below is the DesignState parameter set.
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "python"))
from bioxlattice.spec import CoupledSpec
from bioxlattice.build import build
from bioxlattice.exporter import write_step

SPEC = json.loads('{"name": "fusion_r3", "envelope": {"length": 40.0, "width": 40.0, "height": 20.0, "edge_fillet": 3.0}, "skin": {"thickness": 2.0}, "lattice": {"topology": "bcc", "cell": 5.0, "twist_deg_per_mm": 2.0, "overlap": 0.2, "tier_depths": [4.0, 7.0], "tier_radii": [0.8, 0.6, 0.45], "phase": [0.0, 0.0, 0.0], "zones": [{"z0": -10, "z1": -5, "topology": "bcc", "cell": 5.0, "twist_deg_per_mm": 0.0, "radius_scale": 1.0}, {"z0": -5, "z1": 5, "topology": "bcc", "cell": 5.0, "twist_deg_per_mm": 4.0, "radius_scale": 1.0}, {"z0": 5, "z1": 10, "topology": "bcc", "cell": 5.0, "twist_deg_per_mm": 8.0, "radius_scale": 1.0}]}, "vents": {"enabled": true, "diameter": 2.0, "positions": [[-10.0, -10.0], [10.0, -10.0], [-10.0, 10.0], [10.0, 10.0]]}, "tessellation": {"deflection_mm": 0.02, "angular_rad": 0.1, "max_edge_mm": 2.5}}')

if __name__ == "__main__":
    spec = CoupledSpec.from_dict(SPEC)
    result = build(spec)
    write_step(result.part, os.path.join(HERE, spec.name + ".step"))
    print("volume_mm3", round(result.part.Volume(), 3), "solids", len(result.part.Solids()))
