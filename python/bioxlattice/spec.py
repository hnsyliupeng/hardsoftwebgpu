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


@dataclass
class Tessellation:
    deflection_mm: float = 0.02   # high-resolution export tolerance
    angular_rad: float = 0.1


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
        if self.tessellation.deflection_mm <= 0:
            raise ValueError("deflection must be > 0")

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
