"""
MoChess — Arcane Kingdom: Headless Blender 3D Asset Generator
==============================================================
Run headlessly when Blender is installed:
    blender -b -P scripts/blender/generate_pieces.py

Generates sculpted medieval-fantasy chess pieces (pawn, rook, knight, bishop, queen, king)
with multi-slot PBR materials (PrimaryBody, GoldTrim, ArcaneCore) and exports Binary glTF 2.0
to public/models/arcane_pieces.glb.

When Blender is not installed on the build machine, `node scripts/generate_glb_assets.mjs`
provides an automated Node.js + Three.js sculpted GLB asset generation fallback.
"""

import os
import math

try:
    import bpy
    import bmesh
except ImportError:
    print("[MoChess Blender Pipeline] This script must be executed inside Blender (`blender -b -P scripts/blender/generate_pieces.py`).")
    print("[MoChess Blender Pipeline] Use `npm run generate:assets` if Blender is not installed locally.")
    raise SystemExit(0)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def create_pbr_materials():
    mat_body = bpy.data.materials.new(name="PrimaryBody")
    mat_body.use_nodes = True
    bsdf_body = mat_body.node_tree.nodes.get("Principled BSDF")
    if bsdf_body:
        bsdf_body.inputs["Base Color"].default_value = (0.92, 0.90, 0.85, 1.0)
        bsdf_body.inputs["Roughness"].default_value = 0.25
        bsdf_body.inputs["Metallic"].default_value = 0.08

    mat_gold = bpy.data.materials.new(name="GoldTrim")
    mat_gold.use_nodes = True
    bsdf_gold = mat_gold.node_tree.nodes.get("Principled BSDF")
    if bsdf_gold:
        bsdf_gold.inputs["Base Color"].default_value = (0.95, 0.78, 0.32, 1.0)
        bsdf_gold.inputs["Roughness"].default_value = 0.22
        bsdf_gold.inputs["Metallic"].default_value = 0.92

    mat_arcane = bpy.data.materials.new(name="ArcaneCore")
    mat_arcane.use_nodes = True
    bsdf_arcane = mat_arcane.node_tree.nodes.get("Principled BSDF")
    if bsdf_arcane:
        bsdf_arcane.inputs["Base Color"].default_value = (0.25, 0.75, 1.0, 1.0)
        bsdf_arcane.inputs["Roughness"].default_value = 0.12
        if "Emission Color" in bsdf_arcane.inputs:
            bsdf_arcane.inputs["Emission Color"].default_value = (0.20, 0.65, 1.0, 1.0)
            bsdf_arcane.inputs["Emission Strength"].default_value = 2.5

    return mat_body, mat_gold, mat_arcane


def create_lathe_object(name, profile_points, segments=32, material=None):
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    rings = []
    for r, z in profile_points:
        ring = []
        radius = max(0.001, r)
        for i in range(segments):
            theta = (i / segments) * math.pi * 2.0
            v = bm.verts.new((math.cos(theta) * radius, math.sin(theta) * radius, z))
            ring.append(v)
        rings.append(ring)

    for s in range(len(rings) - 1):
        r0 = rings[s]
        r1 = rings[s + 1]
        for i in range(segments):
            ni = (i + 1) % segments
            bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = True

    if material:
        obj.data.materials.append(material)

    return obj


def build_piece_hierarchy(piece_name, profile, height, mat_body, mat_gold, mat_arcane):
    parent = bpy.data.objects.new(piece_name, None)
    bpy.context.collection.objects.link(parent)

    body_obj = create_lathe_object("body", profile, segments=32, material=mat_body)
    body_obj.parent = parent

    bpy.ops.mesh.primitive_torus_add(
        major_radius=profile[1][0] * 0.95,
        minor_radius=0.02,
        location=(0, 0, 0.04)
    )
    gold_obj = bpy.context.active_object
    gold_obj.name = "gold"
    gold_obj.data.materials.append(mat_gold)
    gold_obj.parent = parent

    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=1,
        radius=0.06,
        location=(0, 0, height + 0.08)
    )
    arcane_obj = bpy.context.active_object
    arcane_obj.name = "arcane"
    arcane_obj.data.materials.append(mat_arcane)
    arcane_obj.parent = parent

    return parent


def main():
    clear_scene()
    mat_body, mat_gold, mat_arcane = create_pbr_materials()

    profiles = {
        "pawn": ([(0.001, 0.0), (0.32, 0.0), (0.33, 0.05), (0.24, 0.18), (0.21, 0.58), (0.11, 0.72), (0.16, 0.90), (0.001, 1.02)], 1.02),
        "rook": ([(0.001, 0.0), (0.36, 0.0), (0.37, 0.05), (0.29, 0.21), (0.22, 0.80), (0.29, 0.96), (0.29, 1.08), (0.001, 1.08)], 1.22),
        "knight": ([(0.001, 0.0), (0.36, 0.0), (0.33, 0.12), (0.24, 0.30), (0.20, 0.75), (0.16, 1.18), (0.001, 1.32)], 1.32),
        "bishop": ([(0.001, 0.0), (0.35, 0.0), (0.33, 0.14), (0.24, 0.36), (0.16, 0.72), (0.22, 0.88), (0.17, 1.18), (0.001, 1.44)], 1.46),
        "queen": ([(0.001, 0.0), (0.38, 0.0), (0.35, 0.15), (0.27, 0.42), (0.15, 0.90), (0.21, 1.12), (0.21, 1.50), (0.001, 1.56)], 1.66),
        "king": ([(0.001, 0.0), (0.40, 0.0), (0.37, 0.16), (0.29, 0.48), (0.20, 0.96), (0.26, 1.20), (0.24, 1.58), (0.001, 1.70)], 1.84),
    }

    for name, (prof, h) in profiles.items():
        build_piece_hierarchy(name, prof, h, mat_body, mat_gold, mat_arcane)

    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "public", "models"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "arcane_pieces.glb")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True
    )
    print(f"[MoChess Blender Pipeline] Exported GLB to {out_path}")


if __name__ == "__main__":
    main()
