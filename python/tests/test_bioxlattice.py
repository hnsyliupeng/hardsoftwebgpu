"""CPU tests for the coupled bio-lattice B-Rep builder.

Run: LD_LIBRARY_PATH=.venv/stubs .venv/bin/python -m unittest discover -s python/tests -v
"""
import math
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cadquery as cq  # noqa: E402

from bioxlattice.build import build  # noqa: E402
from bioxlattice.exporter import tessellate_merged, write_step  # noqa: E402
from bioxlattice.metrics import genus_info, part_metrics  # noqa: E402
from bioxlattice.spec import CoupledSpec, Envelope, Lattice, Skin, Tessellation  # noqa: E402
from bioxlattice.topology import lattice_segments  # noqa: E402
from bioxlattice.verify import verify_mesh, verify_step  # noqa: E402


def small_spec(**kw) -> CoupledSpec:
    # small enough for a few seconds of OCC work, same feature set as the default part
    spec = CoupledSpec(
        name="test_small",
        envelope=Envelope(length=16, width=16, height=12, edge_fillet=2.0),
        skin=Skin(thickness=1.0),
        lattice=Lattice(topology="bcc", cell=4.0, twist_deg_per_mm=2.0, overlap=0.2,
                        tier_depths=[2.0, 3.5], tier_radii=[0.5, 0.4, 0.3]),
        tessellation=Tessellation(deflection_mm=0.05, angular_rad=0.3),
    )
    for k, v in kw.items():
        setattr(spec, k, v)
    return spec


class Topology(unittest.TestCase):
    def test_bcc_cell_has_eight_struts(self):
        segs = lattice_segments("bcc", (0, 0, 0), (1, 1, 1))
        self.assertEqual(len(segs), 8)

    def test_sc_edges_are_unique(self):
        # every SC edge leaves exactly one cell origin, so 2x2x2 cells give 3 * 8 unique edges
        segs = lattice_segments("sc", (0, 0, 0), (2, 2, 2))
        self.assertEqual(len(segs), 24)

    def test_fcc_shared_face_is_deduplicated(self):
        # two neighbouring cells share one face: 24 + 24 - 4 unique struts
        segs = lattice_segments("fcc", (0, 0, 0), (2, 1, 1))
        self.assertEqual(len(segs), 44)

    def test_fcc_face_struts(self):
        segs = lattice_segments("fcc", (0, 0, 0), (1, 1, 1))
        self.assertEqual(len(segs), 24)  # 6 faces x 4 corners, no duplicates inside one cell

    def test_unknown_topology_rejected(self):
        with self.assertRaises(ValueError):
            lattice_segments("diamond", (0, 0, 0), (1, 1, 1))


class Spec(unittest.TestCase):
    def test_defaults_valid(self):
        CoupledSpec().validate()

    def test_thin_skin_rejected(self):
        with self.assertRaises(ValueError):
            CoupledSpec(skin=Skin(thickness=0.2)).validate()

    def test_tier_count_checked(self):
        with self.assertRaises(ValueError):
            CoupledSpec(lattice=Lattice(tier_depths=[4.0], tier_radii=[0.8, 0.6, 0.45])).validate()

    def test_round_trip(self):
        s = CoupledSpec()
        self.assertEqual(CoupledSpec.from_dict(s.to_dict()).to_dict(), s.to_dict())


class Genus(unittest.TestCase):
    def test_hollow_box_genus_zero(self):
        outer = cq.Solid.makeBox(10, 10, 10)
        hollow = outer.cut(cq.Solid.makeBox(6, 6, 6, cq.Vector(2, 2, 2)))
        self.assertEqual(genus_info(hollow)["genus"], 0)

    def test_through_hole_genus_one(self):
        block = cq.Solid.makeBox(10, 10, 4)
        holed = block.cut(cq.Solid.makeCylinder(1.5, 10, cq.Vector(5, 5, -3)))
        self.assertEqual(genus_info(holed)["genus"], 1)


class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = small_spec()
        cls.result = build(cls.spec)

    def test_single_valid_solid(self):
        part = self.result.part
        self.assertEqual(len(part.Solids()), 1)
        self.assertTrue(part.isValid())

    def test_skin_is_closed_hollow_boolean(self):
        skin = self.result.skin
        self.assertEqual(len(skin.Solids()), 1)
        self.assertTrue(skin.isValid())
        e, t = self.spec.envelope, self.spec.skin.thickness
        outer = e.length * e.width * e.height
        inner = (e.length - 2 * t) * (e.width - 2 * t) * (e.height - 2 * t)
        self.assertLess(skin.Volume(), outer - inner + 1e-6 + outer * 0.02)
        self.assertGreater(skin.Volume(), outer - inner - outer * 0.02)

    def test_levels_add_up(self):
        m = part_metrics(self.result, self.spec)
        lv = m["levels"]
        self.assertGreater(lv["overlap_skin_core"], 0)
        self.assertAlmostEqual(lv["L1_skin_volume"] + lv["L2_lattice_core_volume"] - lv["overlap_skin_core"],
                               m["volume"], places=2)

    def test_tiers_all_present_for_depth_bands(self):
        used = self.result.lattice["struts_per_tier"]
        self.assertTrue(all(n > 0 for n in used), used)

    def test_timeline_records_every_feature(self):
        names = [f["feature"] for f in self.result.timeline]
        self.assertIn("skin_boolean_cut", names)
        self.assertIn("union_skin_core", names)
        self.assertTrue(any(n.endswith("_clip") for n in names))


class Export(unittest.TestCase):
    def test_step_is_editable_brep_and_round_trips(self):
        spec = small_spec()
        result = build(spec)
        with tempfile.TemporaryDirectory() as d:
            step = os.path.join(d, "part.step")
            write_step(result.part, step)
            v = verify_step(step, result.part.Volume())
            self.assertTrue(v["volume_ok"], v)
            self.assertTrue(v["editable_brep_ok"], v)
            self.assertEqual(v["shell_based_surface_model_entities"], 0)

    def test_mesh_is_watertight(self):
        spec = small_spec()
        result = build(spec)
        verts, tris = tessellate_merged(result.part, 0.05, 0.3)
        m = verify_mesh(verts, tris)
        self.assertTrue(m["watertight"], m)
        self.assertIsNotNone(m["outer_component_genus"])


if __name__ == "__main__":
    unittest.main()
