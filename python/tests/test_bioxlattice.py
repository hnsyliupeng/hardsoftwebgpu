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
from bioxlattice.spec import CoupledSpec, Envelope, Lattice, Skin, Tessellation, Vents  # noqa: E402
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
        vents=Vents(positions=[[-4.0, -4.0], [4.0, 4.0]], diameter=1.5),
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

    def test_vent_outside_bottom_face_rejected(self):
        with self.assertRaises(ValueError):
            CoupledSpec(vents=Vents(positions=[[30.0, 0.0]])).validate()

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

    def test_vents_open_the_sealed_lattice_gaps(self):
        m = part_metrics(self.result, self.spec)
        self.assertEqual(m["internal_void_count"], 0, m)
        self.assertTrue(m["boundary_watertight"])
        self.assertIn("skin_vent_cut", [f["feature"] for f in self.result.timeline])

    def test_tiers_all_present_for_depth_bands(self):
        used = self.result.lattice["struts_per_tier"]
        self.assertTrue(all(n > 0 for n in used), used)

    def test_timeline_records_every_feature(self):
        names = [f["feature"] for f in self.result.timeline]
        self.assertIn("skin_boolean_cut", names)
        self.assertIn("union_skin_core", names)
        self.assertTrue(any(n.endswith("_clip") for n in names))


class SecondKernel(unittest.TestCase):
    def test_envelope_and_skin_match_smlibpy(self):
        from bioxlattice.crosscheck import compare

        res = compare(CoupledSpec())  # default envelope and skin, no lattice (fast)
        self.assertTrue(res["agree_1e-5"], res)
        self.assertAlmostEqual(res["opencascade"]["skin"], 11123.221, places=2)


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


EX_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class ExampleSpecs(unittest.TestCase):
    """The FCC test model in examples/fcc_graded_test must validate and be labelled as FCC, untwisted."""

    def test_fcc_example_spec_validates(self):
        from bioxlattice.spec import CoupledSpec
        spec = CoupledSpec.load(os.path.join(EX_ROOT, "examples", "fcc_graded_test", "spec.json"))
        spec.validate()
        self.assertEqual(spec.lattice.topology, "fcc")
        self.assertEqual(spec.lattice.twist_deg_per_mm, 0.0)

    def test_description_follows_spec(self):
        from bioxlattice.__main__ import describe
        from bioxlattice.spec import CoupledSpec
        spec = CoupledSpec.load(os.path.join(EX_ROOT, "examples", "fcc_graded_test", "spec.json"))
        prompt, motif = describe(spec, None, None)
        self.assertIn("FCC", prompt)
        self.assertIn("no twist", prompt)
        self.assertNotIn("BCC", prompt)
        self.assertNotIn("helical", motif)
        default_prompt, _ = describe(CoupledSpec(), None, None)
        self.assertIn("BCC", default_prompt)
        self.assertIn("helical", default_prompt)


def _structural_report(spec, result):
    """Tessellate and STEP-verify a built part, then run every structural level (structural.py)."""
    from bioxlattice.structural import run_checks
    verts, tris = tessellate_merged(result.part, spec.tessellation.deflection_mm, spec.tessellation.angular_rad)
    tmp = tempfile.mkdtemp()
    step = os.path.join(tmp, "m.step")
    write_step(result.part, step)
    ver = verify_step(step, result.part.Volume())
    return run_checks(spec, result, verts, tris, ver)


class MultiLevel(unittest.TestCase):
    """Every structural level passes on the small reference part."""

    @classmethod
    def setUpClass(cls):
        cls.spec = small_spec()
        cls.result = build(cls.spec)
        cls.report = _structural_report(cls.spec, cls.result)

    def test_every_level_passes(self):
        self.assertEqual(self.report["failed_checks"], [], self.report["failed_checks"])
        self.assertTrue(self.report["pass"])

    def test_levels_are_all_reported(self):
        self.assertEqual(set(self.report["levels"]),
                         {"L0_envelope", "L1_skin", "L2_lattice", "L3_tiers", "coupling", "printability", "export"})

    def test_skin_matches_closed_form(self):
        from bioxlattice.structural import analytic_cavity, analytic_envelope, analytic_vent_volume
        exp = analytic_envelope(self.spec) - analytic_cavity(self.spec) - analytic_vent_volume(self.spec)
        self.assertAlmostEqual(self.result.skin.Volume(), exp, delta=1e-3)

    def test_tier_counts_rederived(self):
        from bioxlattice.structural import _tier_counts_from_spec
        counts, kept = _tier_counts_from_spec(self.spec)
        self.assertEqual(counts, self.result.lattice["struts_per_tier"])
        self.assertEqual(kept, self.result.lattice["struts_kept"])

    def test_coupling_identity_holds(self):
        overlap = self.result.skin.intersect(self.result.core).Volume()
        identity = self.result.skin.Volume() + self.result.core.Volume() - self.result.part.Volume()
        self.assertAlmostEqual(overlap, identity, delta=1e-3)


class FccKnownDefect(unittest.TestCase):
    """examples/fcc_graded_test has 60 sealed micro-pockets at the lateral walls (a real, reported defect).

    The test pins the defect: every other level must pass and only the enclosed-void gate may fail,
    with exactly 60 pockets (20 against the lateral walls at mid-height, 40 in the cavity edges where
    the lateral walls meet the top and bottom inner walls), totalling well under 2 mm^3. When the design is
    fixed, this test must be updated: the gate then passes and the failed list must be empty.
    """

    @classmethod
    def setUpClass(cls):
        spec_path = os.path.join(EX_ROOT, "examples", "fcc_graded_test", "spec.json")
        cls.spec = CoupledSpec.load(spec_path)
        cls.result = build(cls.spec)
        cls.report = _structural_report(cls.spec, cls.result)

    def test_only_enclosed_void_gate_fails(self):
        self.assertEqual(self.report["failed_checks"], ["printability.enclosed_voids"])
        for name, lv in self.report["levels"].items():
            if name != "printability":
                self.assertTrue(lv["pass"], name)

    def test_pockets_are_counted_and_located(self):
        voids = self.report["voids"]
        self.assertEqual(len(voids), 60)
        from collections import Counter
        self.assertEqual(Counter(v["location"] for v in voids), Counter({"lateral wall": 20, "edge": 40}))
        self.assertLess(sum(v["volume_mm3"] for v in voids), 2.0)

    def test_all_vents_open(self):
        vent_checks = [c for c in self.report["levels"]["printability"]["checks"] if c["id"].endswith("_open")]
        self.assertEqual(len(vent_checks), 4)
        self.assertTrue(all(c["pass"] for c in vent_checks))


class VoidLocation(unittest.TestCase):
    def test_classes(self):
        from bioxlattice.structural import _location
        hxi = hyi = 13.5
        hzi = 6.5
        self.assertEqual(_location((13.27, 11.7, -0.3), (13.5, 12.3, 0.3), hxi, hyi, hzi), "lateral wall")
        # z = -6 sits 0.5 mm from the bottom inner wall (z = -6.5): the pocket is in the cavity edge
        self.assertEqual(_location((13.27, 11.7, -6.3), (13.5, 12.3, -5.7), hxi, hyi, hzi), "edge")
        self.assertEqual(_location((-1, -1, -6.6), (1, 1, -6.3), hxi, hyi, hzi), "bottom/top wall")
        self.assertEqual(_location((-1, -1, -1), (1, 1, 1), hxi, hyi, hzi), "interior")
        self.assertEqual(_location((13.2, 0, -6.6), (13.5, 1, -6.3), hxi, hyi, hzi), "edge")
