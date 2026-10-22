"""Run the upstream Bioinspired123D Blender code (headless bpy) and measure the clipped volume.

The base-code templates are read from data/raw/biodataset_basecodes.csv of a Bioinspired123D checkout
(Apache-2.0; read only, not copied into this repository). Placeholders are filled with str.format, the
code is executed as written, and the resulting mesh is intersected with the build envelope so that the
volume can be compared with the Monte Carlo and gallery numbers (1 unit = 10 mm, envelope 2 units).

Usage: python3 python/validation/run_upstream_bpy.py <Bioinspired123D checkout> <ID> [key=value ...]
Prints one JSON line. Needs bpy (pip install bpy, Python 3.11) in a separate environment.
"""
import csv
import json
import math
import os
import random
import sys

import bpy  # noqa: E402  (headless Blender Python module)


def load_template(checkout, base_id):
    path = os.path.join(checkout, "data/raw/biodataset_basecodes.csv")
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row["ID"] == base_id:
                return row["Code"]
    raise KeyError(base_id)


def envelope_intersect_volume(envelope_loc, envelope_size):
    """Volume (mm^3, 1 unit = 10 mm) of all mesh objects clipped to the envelope cube."""
    bpy.ops.mesh.primitive_cube_add(size=envelope_size, location=envelope_loc)
    env = bpy.context.object
    env.name = "__envelope__"
    total = 0.0
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o is not env]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for ob in meshes:
        # Use the evaluated mesh (all modifiers applied: wireframe, subdivision, boolean, ...), not the base mesh.
        # Copying the object and applying only the clip modifier would skip modifiers that come before it.
        ev = ob.evaluated_get(depsgraph)
        me = bpy.data.meshes.new_from_object(ev)
        dup = bpy.data.objects.new("__measure__", me)
        dup.matrix_world = ob.matrix_world.copy()
        bpy.context.collection.objects.link(dup)
        mod = dup.modifiers.new(name="clip", type="BOOLEAN")
        mod.operation = "INTERSECT"
        mod.object = env
        bpy.context.view_layer.objects.active = dup
        bpy.ops.object.modifier_apply(modifier=mod.name)
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(dup.data)
        bm.transform(dup.matrix_world)
        total += abs(sum(bmesh_tet_volume(f) for f in bm.faces))
        bm.free()
        bpy.data.objects.remove(dup, do_unlink=True)
    return total * 1000.0


def bmesh_tet_volume(face):
    """Signed volume of the tetrahedron fan from the origin over one face (divergence theorem)."""
    verts = [v.co for v in face.verts]
    v0 = verts[0]
    vol = 0.0
    for i in range(1, len(verts) - 1):
        a, b = v0, verts[i]
        c = verts[i + 1]
        vol += a.dot(b.cross(c)) / 6.0
    return vol


def main():
    checkout, base_id = sys.argv[1], sys.argv[2]
    params = {}
    for kv in sys.argv[3:]:
        k, v = kv.split("=")
        params[k] = float(v) if "." in v else int(v)
    seed = params.pop("seed", 42)
    random.seed(seed)
    # Blender C-side RNG used by Fracture Cell (mathutils.noise.random_unit_vector); Python random does not reach it
    import mathutils.noise as _mn
    _mn.seed_set(seed)
    code = load_template(checkout, base_id).format(**params)
    call_fixed = False
    if base_id == "tubular_generic" and "create_tubules(tubule_count)" in code:
        # upstream defines create_tubules() with no parameters but calls it with one (TypeError as published).
        # The only change made here is the call; the geometry is the upstream code's.
        code = code.replace("create_tubules(tubule_count)", "create_tubules()")
        call_fixed = True
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    ns = {"__name__": "__upstream__"}
    exec(compile(code, base_id, "exec"), ns)
    if base_id.startswith("helical"):
        # the upstream plies are not bounded by a cube: clip to the 20 mm envelope [-1,1]^2 x [0,2]
        vol = envelope_intersect_volume((0, 0, 1), 2.0)
    else:
        # the tubular base codes start from a cube of size 2 at the origin (the envelope itself)
        vol = envelope_intersect_volume((0, 0, 0), 2.0)
    meshes = [o.name for o in bpy.context.scene.objects if o.type == "MESH"]
    print(json.dumps({"id": base_id, "params": params, "seed": seed, "call_fixed": call_fixed,
                      "clipped_volume_mm3": round(vol, 2), "objects": len(meshes)}))


if __name__ == "__main__":
    main()
