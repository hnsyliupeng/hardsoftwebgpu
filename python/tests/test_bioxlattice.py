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
    verts, tris = tessellate_merged(result.part, spec.tessellation.deflection_mm, spec.tessellation.angular_rad,
                                    max_edge=spec.tessellation.max_edge_mm)
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
                         {"L0_envelope", "L1_skin", "L2_lattice", "L2_zones", "L3_tiers", "coupling", "printability", "export"})

    def test_skin_matches_closed_form(self):
        from bioxlattice.structural import analytic_cavity, analytic_envelope, analytic_vent_volume
        exp = analytic_envelope(self.spec) - analytic_cavity(self.spec) - analytic_vent_volume(self.spec)
        self.assertAlmostEqual(self.result.skin.Volume(), exp, delta=1e-3)

    def test_tier_counts_rederived(self):
        from bioxlattice.structural import _tier_counts_from_spec
        counts, kept, per_zone = _tier_counts_from_spec(self.spec)
        self.assertEqual(counts, self.result.lattice["struts_per_tier"])
        self.assertEqual(kept, self.result.lattice["struts_kept"])
        self.assertEqual(sum(per_zone), kept)

    def test_coupling_identity_holds(self):
        overlap = self.result.skin.intersect(self.result.core).Volume()
        identity = self.result.skin.Volume() + self.result.core.Volume() - self.result.part.Volume()
        self.assertAlmostEqual(overlap, identity, delta=1e-3)


class FccPhase(unittest.TestCase):
    """examples/fcc_graded_test: lattice phase (3, 3, 0) mm removes the 60 wall pockets found at phase 0.

    The phase-0 design had 60 sealed micro-pockets (20 at lateral walls, 40 at cavity edges). Phase
    (3, 3, 0) gives 0 enclosed voids and every structural level passes. Overlap, clip box and layer seams
    did not change the count at phase 0 (see docs/COUPLED_LATTICE.md), so the phase is the fix.
    """

    @classmethod
    def setUpClass(cls):
        spec_path = os.path.join(EX_ROOT, "examples", "fcc_graded_test", "spec.json")
        cls.spec = CoupledSpec.load(spec_path)
        cls.result = build(cls.spec)
        cls.report = _structural_report(cls.spec, cls.result)

    def test_phase_is_recorded(self):
        self.assertEqual(self.spec.lattice.phase, [3.0, 3.0, 0.0])
        self.assertEqual(self.result.lattice["phase_mm"], [3.0, 3.0, 0.0])

    def test_every_level_passes(self):
        self.assertEqual(self.report["failed_checks"], [], self.report["failed_checks"])
        self.assertTrue(self.report["pass"])

    def test_no_enclosed_voids(self):
        self.assertEqual(self.report["voids"], [])

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


class MeshRefine(unittest.TestCase):
    """Long-edge refinement keeps the mesh closed, orientation-consistent and volume-exact."""

    @staticmethod
    def _signed_volume(V, T):
        s = 0.0
        for a, b, c in T:
            pa, pb, pc = V[a], V[b], V[c]
            s += (pa[0] * (pb[1] * pc[2] - pb[2] * pc[1]) - pa[1] * (pb[0] * pc[2] - pb[2] * pc[0])
                  + pa[2] * (pb[0] * pc[1] - pb[1] * pc[0])) / 6.0
        return s

    @staticmethod
    def _open_edges(T):
        from collections import Counter
        cnt = Counter()
        for a, b, c in T:
            for u, v in ((a, b), (b, c), (c, a)):
                cnt[(min(u, v), max(u, v))] += 1
        return sum(1 for n in cnt.values() if n != 2)

    def test_box_refined_is_closed_and_volume_exact(self):
        from bioxlattice.mesh_refine import quality_report, refine_long_edges
        box = cq.Workplane("XY").box(40, 40, 16).edges("|Z").fillet(3).val()
        V, T = tessellate_merged(box, 0.02, 0.1)
        self.assertGreater(quality_report(V, T)["max_edge_mm"], 20.0)  # the raw mesh has needles
        V2, T2 = refine_long_edges(V, T, 2.5)
        self.assertLessEqual(quality_report(V2, T2)["max_edge_mm"], 2.5 + 1e-9)
        self.assertEqual(quality_report(V2, T2)["needles_aspect_gt_100_span_ge_5.0mm"], 0)
        self.assertEqual(self._open_edges(T2), 0)
        self.assertAlmostEqual(self._signed_volume(V2, T2), self._signed_volume(V, T), delta=1e-6)

    def test_refine_is_noop_when_within_bound(self):
        from bioxlattice.mesh_refine import refine_long_edges
        V = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)]
        T = [(0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3)]
        V2, T2 = refine_long_edges(V, T, 5.0)
        self.assertEqual(len(T2), len(T))
        self.assertEqual(len(V2), len(V))

    def test_default_bound_in_spec(self):
        self.assertEqual(CoupledSpec().tessellation.max_edge_mm, 2.5)


class Fusion(unittest.TestCase):
    """Multi-zone fusion: new topologies, zone resolution, twist continuity, regression of counts."""

    def test_bccz_segment_lengths_and_count(self):
        from bioxlattice.topology import _cell_segments
        segs = _cell_segments("bccz", 0, 0, 0)
        self.assertEqual(len(segs), 12)  # 8 BCC corner struts + 4 vertical cell edges
        lengths = sorted({round(math.dist(a, b), 6) for a, b in segs})
        self.assertEqual(lengths, sorted({round(math.sqrt(3) / 2, 6), 1.0}))

    def test_octet_all_struts_equal_length(self):
        from bioxlattice.topology import _cell_segments
        segs = _cell_segments("octet", 0, 0, 0)
        self.assertEqual(len(segs), 36)  # 24 FCC star struts + 12 octahedron edges
        for a, b in segs:
            self.assertAlmostEqual(math.dist(a, b), math.sqrt(2) / 2, places=9)
        self.assertEqual(len({frozenset((a, b)) for a, b in segs}), 36)

    def test_single_zone_default_covers_envelope(self):
        from bioxlattice.spec import resolved_zones
        spec = small_spec()
        zs = resolved_zones(spec)
        self.assertEqual(len(zs), 1)
        hz = spec.envelope.height / 2
        self.assertEqual((zs[0]["z0"], zs[0]["z1"]), (-hz, hz))
        self.assertEqual(zs[0]["topology"], spec.lattice.topology)

    def test_zone_validation_rejects_gaps_overlaps_and_bad_keys(self):
        spec = small_spec()
        base = [{"z0": -10, "z1": 0}, {"z0": 0, "z1": 10}]  # envelope height 20 mm
        spec.lattice.zones = [dict(z, topology="bcc", cell=5.0) for z in base]
        spec.validate()  # contiguous full cover is valid
        bad = [
            [{"z0": -10, "z1": 0}, {"z0": 1, "z1": 10}],        # gap
            [{"z0": -10, "z1": 1}, {"z0": 0, "z1": 10}],        # overlap
            [{"z0": -10, "z1": 0}],                             # does not reach the top
            [{"z0": -10, "z1": 0, "bogus": 1}, {"z0": 0, "z1": 10}],
        ]
        for zones in bad:
            spec.lattice.zones = zones
            with self.assertRaises(ValueError):
                spec.validate()
        spec.lattice.zones = [{"z0": -10, "z1": 0, "topology": "gyroid"}, {"z0": 0, "z1": 10}]
        with self.assertRaises(ValueError):
            spec.validate()

    def test_twist_angle_single_zone_is_kappa_z(self):
        from bioxlattice.build import twist_angle
        from bioxlattice.spec import resolved_zones
        zs = resolved_zones(small_spec())
        for z in (-7.0, -1.0, 0.0, 3.0, 9.0):
            self.assertAlmostEqual(twist_angle(zs, z), math.radians(small_spec().lattice.twist_deg_per_mm) * z, places=12)

    def test_twist_gradient_is_continuous_across_interfaces(self):
        from bioxlattice.build import twist_angle
        from bioxlattice.spec import resolved_zones
        spec = small_spec()
        spec.lattice.zones = [
            {"z0": -10, "z1": 0, "topology": "bcc", "cell": 5.0, "twist_deg_per_mm": 0.0},
            {"z0": 0, "z1": 10, "topology": "bcc", "cell": 5.0, "twist_deg_per_mm": 4.0},
        ]
        zs = resolved_zones(spec)
        self.assertAlmostEqual(twist_angle(zs, 0.0 - 1e-9), twist_angle(zs, 0.0 + 1e-9), places=8)
        # 0 -> 5 mm at 4 deg/mm gives 20 degrees
        self.assertAlmostEqual(math.degrees(twist_angle(zs, 5.0)), 20.0, places=9)

    def test_regression_single_zone_counts_match_committed_examples(self):
        # The zone-aware re-derivation must reproduce the recorded counts of the committed
        # single-zone examples (same rules as before zones were added).
        from bioxlattice.structural import _tier_counts_from_spec
        fcc = CoupledSpec.load(os.path.join(os.path.dirname(__file__), "..", "..", "examples", "fcc_graded_test", "spec.json"))
        counts, kept, per_zone = _tier_counts_from_spec(fcc)
        self.assertEqual(counts, [1600, 188, 132])
        self.assertEqual(kept, 1920)
        self.assertEqual(per_zone, [1920])

    def test_zone_counts_sum_to_total(self):
        from bioxlattice.structural import _tier_counts_from_spec
        spec = small_spec()
        spec.lattice.zones = [
            {"z0": -10, "z1": -5, "topology": "fcc", "cell": 5.0},
            {"z0": -5, "z1": 5, "topology": "bcc", "cell": 5.0},
            {"z0": 5, "z1": 10, "topology": "bccz", "cell": 5.0, "radius_scale": 0.9},
        ]
        spec.validate()
        counts, kept, per_zone = _tier_counts_from_spec(spec)
        self.assertEqual(sum(per_zone), kept)
        self.assertEqual(sum(counts), kept)
        self.assertTrue(all(n > 0 for n in per_zone))

