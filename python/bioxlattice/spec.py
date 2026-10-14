"""Design specification (JSON-serialisable). All lengths in mm, angles in degrees."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

from .topology import TOPOLOGIES


@dataclass
class Envelope:
    length: float = 40.0      # X
    width: float = 40.0       # Y
    height: float = 20.0      # Z (lattice / layer axis)
    edge_fillet: float = 3.0  # vertical edges


@dataclass
class Skin:
    thickness: float = 2.0    # L1 closed skin, made by boolean cut (not shell())


@dataclass
class Vents:
    """Through-holes in the bottom skin that open the sealed lattice gaps to the outside (printability)."""
    enabled: bool = True
    diameter: float = 2.0
    positions: list[list[float]] = field(default_factory=lambda: [[-10.0, -10.0], [10.0, -10.0], [-10.0, 10.0], [10.0, 10.0]])


@dataclass
class Lattice:
    topology: str = "bcc"     # L2 core topology
    cell: float = 5.0         # cell edge, mm
    twist_deg_per_mm: float = 2.0   # L2 bio coupling: helical (Bouligand-like) twist of nodes along z
    overlap: float = 0.2      # struts enter the skin by this much so they fuse with it
    # L3 graded strut radius by depth below the envelope surface (cortical-like gradient)
    tier_depths: list[float] = field(default_factory=lambda: [4.0, 7.0])
    tier_radii: list[float] = field(default_factory=lambda: [0.8, 0.6, 0.45])
    # lattice origin offset in mm (x, y, z). [0, 0, 0] keeps nodes on integer multiples of the cell.
    phase: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    # Multi-zone fusion: contiguous z-bands, each with its own topology, cell, twist rate and radius
    # scale. Empty list = one band covering the envelope with the top-level values above.
    # Keys per zone: z0, z1 (mm, envelope z), topology, cell, twist_deg_per_mm, radius_scale.
    zones: list[dict] = field(default_factory=list)


ZONE_KEYS = ("z0", "z1", "topology", "cell", "twist_deg_per_mm", "radius_scale")


def resolved_zones(spec: "CoupledSpec") -> list[dict]:
    """Zones with every key filled. One implicit band when `lattice.zones` is empty.

    Zone grids are anchored at the lattice phase, not at z0, so a zone with the same cell as the
    top level keeps the same node positions as the single-zone model.
    """
    l, hz = spec.lattice, spec.envelope.height / 2
    if not l.zones:
        return [{"z0": -hz, "z1": hz, "topology": l.topology, "cell": l.cell,
                 "twist_deg_per_mm": l.twist_deg_per_mm, "radius_scale": 1.0}]
    out = []
    for z in l.zones:
        out.append({
            "z0": float(z["z0"]), "z1": float(z["z1"]),
            "topology": z.get("topology", l.topology),
            "cell": float(z.get("cell", l.cell)),
            "twist_deg_per_mm": float(z.get("twist_deg_per_mm", l.twist_deg_per_mm)),
            "radius_scale": float(z.get("radius_scale", 1.0)),
        })
    return out


@dataclass
class Tessellation:
    deflection_mm: float = 0.02   # high-resolution export tolerance
    angular_rad: float = 0.1
    max_edge_mm: float = 2.5      # longest triangle edge after conformal refinement (no needles)


@dataclass
class CoupledSpec:
    name: str = "coupled_bio_lattice"
    envelope: Envelope = field(default_factory=Envelope)
    skin: Skin = field(default_factory=Skin)
    lattice: Lattice = field(default_factory=Lattice)
    vents: Vents = field(default_factory=Vents)
    tessellation: Tessellation = field(default_factory=Tessellation)

    def validate(self) -> None:
        e, s, l = self.envelope, self.skin, self.lattice
        if l.topology not in TOPOLOGIES:
            raise ValueError(f"topology must be one of {TOPOLOGIES}")
        if min(e.length, e.width, e.height) <= 2 * s.thickness + 2 * l.cell:
            raise ValueError("envelope too small for skin plus at least one lattice cell")
        if s.thickness < 0.4:
            raise ValueError("skin thickness below the 0.4 mm printable floor")
        if l.cell <= 0 or l.overlap <= 0 or l.overlap >= s.thickness:
            raise ValueError("cell must be > 0 and overlap in (0, skin thickness)")
        if len(l.phase) != 3:
            raise ValueError("lattice.phase must have 3 components (mm)")
        if len(l.tier_radii) != len(l.tier_depths) + 1:
            raise ValueError("need len(tier_radii) == len(tier_depths) + 1")
        if any(r < 0.2 for r in l.tier_radii):
            raise ValueError("strut radius below 0.2 mm")
        if sorted(l.tier_depths) != list(l.tier_depths):
            raise ValueError("tier_depths must be ascending")
        v = self.vents
        if v.enabled:
            if v.diameter < 0.4:
                raise ValueError("vent diameter below the 0.4 mm printable floor")
            for x, y in v.positions:
                if abs(x) + v.diameter / 2 >= e.length / 2 - s.thickness or abs(y) + v.diameter / 2 >= e.width / 2 - s.thickness:
                    raise ValueError(f"vent at ({x}, {y}) is outside the bottom face")
        zs = resolved_zones(self)
        for i, z in enumerate(l.zones):
            unknown = set(z) - set(ZONE_KEYS)
            if unknown:
                raise ValueError(f"zone {i} has unknown keys {sorted(unknown)}")
            if "z0" not in z or "z1" not in z:
                raise ValueError(f"zone {i} needs z0 and z1")
        for i, z in enumerate(zs):
            if z["topology"] not in TOPOLOGIES:
                raise ValueError(f"zone {i} topology {z['topology']!r} not in {TOPOLOGIES}")
            if z["cell"] <= 0:
                raise ValueError(f"zone {i} cell must be > 0")
            if not (0 < z["radius_scale"] <= 2.0):
                raise ValueError(f"zone {i} radius_scale must be in (0, 2]")
            if z["z1"] <= z["z0"]:
                raise ValueError(f"zone {i} needs z1 > z0")
            if min(l.tier_radii) * z["radius_scale"] < 0.2:
                raise ValueError(f"zone {i} scales strut radius below 0.2 mm")
            if z["cell"] * 2 > min(e.length, e.width):
                raise ValueError(f"zone {i} cell too large for the envelope")
        if l.zones:
            hz = e.height / 2
            if zs[0]["z0"] > -hz + 1e-9 or zs[-1]["z1"] < hz - 1e-9:
                raise ValueError("zones must cover the full envelope height")
            for a_, b_ in zip(zs, zs[1:]):
                if abs(a_["z1"] - b_["z0"]) > 1e-9:
                    raise ValueError("zones must be contiguous and ascending")
        if self.tessellation.deflection_mm <= 0:
            raise ValueError("deflection must be > 0")
        if self.tessellation.max_edge_mm <= 0:
            raise ValueError("max_edge_mm must be > 0")

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "CoupledSpec":
        spec = CoupledSpec(
            name=d.get("name", "coupled_bio_lattice"),
            envelope=Envelope(**d.get("envelope", {})),
            skin=Skin(**d.get("skin", {})),
            lattice=Lattice(**d.get("lattice", {})),
            vents=Vents(**d.get("vents", {})),
            tessellation=Tessellation(**d.get("tessellation", {})),
        )
        spec.validate()
        return spec

    @staticmethod
    def load(path: str) -> "CoupledSpec":
        with open(path, encoding="utf8") as fh:
            return CoupledSpec.from_dict(json.load(fh))
