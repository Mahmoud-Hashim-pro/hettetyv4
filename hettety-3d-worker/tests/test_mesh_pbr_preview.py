"""
HETTETY 3D Worker — PBR Mesh & Preview Camera Trajectory Tests
Validates mesh topology cleaning, normalized UV generation, PBR GLB serialization,
texture gutter inpainting, and smooth orbit camera path synthesis.
"""

import os
import tempfile
import unittest
import numpy as np

from pipeline.compress import validate_glb_file
from pipeline.mesh_pbr import (
    clean_mesh_topology,
    compute_mesh_uvs,
    inpaint_texture_gutters,
    build_pbr_glb_container
)
from pipeline.preview_path import (
    generate_orbit_camera_trajectory,
    generate_walkthrough_transition_trajectory,
    save_camera_trajectory
)


class TestMeshPbrAndPreview(unittest.TestCase):
    def test_clean_mesh_topology_removes_degenerates_and_duplicates(self):
        # 5 vertices: 0,1,2 forms triangle 1; 1,2,3 forms triangle 2; vertex 4 is orphan
        vertices = np.array([
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
            [99.0, 99.0, 99.0] # Orphan vertex
        ], dtype=np.float32)

        faces = np.array([
            [0, 1, 2],       # Valid triangle
            [1, 2, 0],       # Duplicate of triangle 1 (different winding)
            [0, 0, 1],       # Degenerate (duplicate index 0)
            [1, 2, 3],       # Valid triangle 2
            [0, 1, 2],       # Exact duplicate
        ], dtype=np.int32)

        clean_v, clean_f, clean_norm = clean_mesh_topology(vertices, faces)

        # Orphan vertex 4 should be pruned -> 4 vertices remain
        self.assertEqual(len(clean_v), 4)
        # Only 2 unique valid faces should remain
        self.assertEqual(len(clean_f), 2)
        # Normals must match vertex count and be unit length
        self.assertEqual(len(clean_norm), 4)
        lengths = np.linalg.norm(clean_norm, axis=1)
        for l in lengths:
            self.assertAlmostEqual(float(l), 1.0, places=4)

    def test_compute_mesh_uvs_bounds(self):
        vertices = np.array([
            [-10.0, -5.0, 0.0],
            [10.0, 5.0, 3.0],
            [0.0, 0.0, 1.5]
        ], dtype=np.float32)

        uvs_box = compute_mesh_uvs(vertices, method="box")
        self.assertEqual(uvs_box.shape, (3, 2))
        self.assertTrue(np.all(uvs_box >= 0.0))
        self.assertTrue(np.all(uvs_box <= 1.0))

        uvs_cyl = compute_mesh_uvs(vertices, method="cylindrical")
        self.assertEqual(uvs_cyl.shape, (3, 2))
        self.assertTrue(np.all(uvs_cyl >= 0.0))
        self.assertTrue(np.all(uvs_cyl <= 1.0))

    def test_inpaint_texture_gutters(self):
        texture = np.zeros((64, 64, 3), dtype=np.uint8)
        # Center patch has color
        texture[16:48, 16:48] = [210, 190, 170]
        valid_mask = np.zeros((64, 64), dtype=bool)
        valid_mask[16:48, 16:48] = True

        inpainted = inpaint_texture_gutters(texture, valid_mask, inpaint_radius=3)
        self.assertEqual(inpainted.shape, (64, 64, 3))
        # Gutter right outside the valid mask should have non-zero color
        gutter_pixel = inpainted[14, 32]
        self.assertTrue(np.any(gutter_pixel > 0), "Gutter must be filled via inpainting")

    def test_build_pbr_glb_container_validation(self):
        vertices = np.array([
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [2.0, 2.0, 0.0],
            [0.0, 2.0, 0.0]
        ], dtype=np.float32)
        normals = np.array([
            [0.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, 1.0]
        ], dtype=np.float32)
        uvs = compute_mesh_uvs(vertices)
        faces = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int32)

        glb_bytes = build_pbr_glb_container(
            vertices=vertices,
            normals=normals,
            uvs=uvs,
            faces=faces,
            base_color_factor=(0.8, 0.8, 0.8, 1.0),
            metallic_factor=0.1,
            roughness_factor=0.65
        )

        with tempfile.NamedTemporaryFile("wb", suffix=".glb", delete=False) as f:
            f.write(glb_bytes)
            tmp_glb = f.name

        try:
            valid, msg, v_cnt, f_cnt = validate_glb_file(tmp_glb)
            self.assertTrue(valid, f"GLB failed validation: {msg}")
            self.assertEqual(v_cnt, 4)
            self.assertEqual(f_cnt, 2)
        finally:
            if os.path.exists(tmp_glb):
                os.remove(tmp_glb)

    def test_generate_orbit_camera_trajectory(self):
        bounds = {
            "min": [-4.0, -3.0, 0.0],
            "max": [4.0, 3.0, 2.8]
        }
        traj = generate_orbit_camera_trajectory(bounds, num_frames=30, fov=45.0)

        self.assertEqual(traj["trajectoryType"], "orbit_360")
        self.assertEqual(traj["frameCount"], 30)
        self.assertEqual(len(traj["keyframes"]), 30)
        self.assertAlmostEqual(traj["target"][0], 0.0, places=2)
        self.assertAlmostEqual(traj["target"][1], 0.0, places=2)
        self.assertAlmostEqual(traj["target"][2], 1.4, places=2)

        # Check keyframe structure
        first_frame = traj["keyframes"][0]
        self.assertIn("position", first_frame)
        self.assertIn("target", first_frame)
        self.assertIn("yawDeg", first_frame)
        self.assertIn("pitchDeg", first_frame)
        self.assertEqual(first_frame["fov"], 45.0)

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            tmp_json = f.name

        try:
            saved_path = save_camera_trajectory(traj, tmp_json)
            self.assertTrue(os.path.exists(saved_path))
            self.assertGreater(os.path.getsize(saved_path), 50)
        finally:
            if os.path.exists(tmp_json):
                os.remove(tmp_json)

    def test_generate_walkthrough_transition_trajectory(self):
        bounds = {
            "min": [-5.0, -5.0, 0.0],
            "max": [5.0, 5.0, 3.0]
        }
        traj = generate_walkthrough_transition_trajectory(bounds, num_frames=20)
        self.assertEqual(traj["trajectoryType"], "dollhouse_to_walkthrough")
        self.assertEqual(traj["frameCount"], 20)
        self.assertEqual(len(traj["keyframes"]), 20)


if __name__ == "__main__":
    unittest.main()
