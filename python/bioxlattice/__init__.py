"""Coupled bio-inspired lattice B-Rep builder (CadQuery / OpenCASCADE, CPU only).

Timeline (SolidCraft-style ordered features, rebuilt from parameters):
  envelope -> hollow skin (boolean cut) -> lattice core (topology x twist x graded radius)
  -> clip to cavity + overlap -> union with skin -> STEP / STL / metrics.
"""
__version__ = "0.1.0"
