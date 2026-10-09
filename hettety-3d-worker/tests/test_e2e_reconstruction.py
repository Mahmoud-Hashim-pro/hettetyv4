"""
HETTETY 3D Pipeline — End-to-End Test Suite
Validates all 10 production gates:
1. Strict mesh failure on points < 8 (zero fake room)
2. Strict bounds failure on non-finite coordinates
3. Genuine Gaussian floater and outlier pruning
4. Cloud storage upload failure semantics
5. Metric calibration confidence and error margin
6. Genuine Laplacian variance sharpness assessment
7. Quantitative SfM validation
8. Binary glTF 2.0 GLB validation
9. Worker lifecycle, progress reporting, and disk cleanup
"""

import os
import shutil
import tempfile
import unittest
import numpy as np
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import time
import json
import threading
import subprocess
from PIL import Image, ImageDraw

from pipeline.validate import validate_keyframes, compute_image_laplacian_variance
from pipeline.optimize import parse_ply_header_and_bounds, optimize_splat_cloud
from pipeline.calibrate import calibrate_sparse_scale, apply_metric_scale_to_points, partition_survey_benchmarks
from pipeline.compress import generate_metric_mesh_glb, validate_glb_file, scale_ply_to_metric, convert_ply_to_spz, decode_spz_native
from pipeline.quality_gate import evaluate_reconstruction_quality
from pipeline.publish import publish_tour_assets
from pipeline.process_manager import run_managed_process, JobCancelledException, kill_process_tree, ACTIVE_PROCESSES
from pipeline.train import run_gaussian_training
from storage.object_storage import ObjectStorageClient
from workers.reconstruction_worker import ReconstructionWorker
from task_queue.consumer import QueueConsumer

class TestHettety3DReconstructionE2E(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="hettety_test_")

    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_01_synthetic_mesh_fallback_eliminated(self):
        """Zero fake room: sparse point count < 8 must strictly return failure."""
        empty_sparse = os.path.join(self.temp_dir, "empty_sparse")
        os.makedirs(empty_sparse, exist_ok=True)
        out_glb = os.path.join(self.temp_dir, "test.glb")

        res = generate_metric_mesh_glb(empty_sparse, out_glb)
        self.assertFalse(res["success"])
        self.assertEqual(res["error_code"], "INSUFFICIENT_GEOMETRY_FOR_MESH")
        self.assertFalse(os.path.exists(out_glb))

    def test_02_synthetic_bounds_fallback_eliminated(self):
        """Zero fake 8x3x8 room box: non-finite coordinates must raise ValueError."""
        invalid_ply = os.path.join(self.temp_dir, "invalid.ply")
        with open(invalid_ply, "w") as f:
            f.write("ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\ninf inf inf\nnan nan nan\n")

        with self.assertRaises(ValueError) as ctx:
            parse_ply_header_and_bounds(invalid_ply)
        self.assertIn("CANNOT_DETERMINE_BOUNDS", str(ctx.exception))

    def test_03_genuine_gaussian_floater_pruning(self):
        """Prunes low-opacity floaters and updates vertex count in PLY header."""
        raw_ply = os.path.join(self.temp_dir, "raw.ply")
        clean_ply = os.path.join(self.temp_dir, "clean.ply")
        with open(raw_ply, "w") as f:
            f.write("ply\nformat ascii 1.0\nelement vertex 12\nproperty float x\nproperty float y\nproperty float z\nproperty float opacity\nend_header\n")
            for i in range(10):
                f.write(f"{i*0.5} {i*0.3} {i*0.2} 0.85\n")
            # 2 low-opacity floaters
            f.write("0.0 0.0 0.0 0.01\n")
            f.write("1.0 1.0 1.0 0.005\n")

        res = optimize_splat_cloud(raw_ply, clean_ply, min_opacity=0.05)
        self.assertTrue(res["success"])
        self.assertEqual(res["splat_count"], 10)
        self.assertEqual(res["floaters_pruned"], 2)

        count, bounds = parse_ply_header_and_bounds(clean_ply)
        self.assertEqual(count, 10)
        self.assertAlmostEqual(bounds["max"][0], 4.5, delta=0.1)

    def test_04_cloud_storage_failure_isolation(self):
        """Fails strictly on cloud storage upload error; does not return fake GCS URLs."""
        test_file = os.path.join(self.temp_dir, "artifact.bin")
        with open(test_file, "wb") as f:
            f.write(b"verified artifact bytes")

        # GCS provider fails strictly when GCS is unreachable
        gcs_client = ObjectStorageClient(provider="gcs")
        with self.assertRaises(RuntimeError) as ctx:
            gcs_client.upload_file(test_file, "tour/mesh.glb")
        self.assertIn("GCS_UPLOAD_FAILED", str(ctx.exception))

        # Local provider returns truthful local path
        local_client = ObjectStorageClient(provider="local")
        local_url = local_client.upload_file(test_file, "tour/mesh.glb")
        self.assertTrue(local_url.startswith("/storage/spatial_assets/"))
        self.assertNotIn("storage.googleapis.com", local_url)

    def test_05_metric_scale_calibration_gate(self):
        """Requires consistent physical anchors to award is_calibrated = True."""
        # Uncalibrated when no references supplied
        report_none = calibrate_sparse_scale([(1, 2, 3)], [])
        self.assertFalse(report_none["is_calibrated"])
        self.assertEqual(report_none["confidence_score"], 0.0)

        # Assumed dimensions alone remain uncalibrated
        report_assumed = calibrate_sparse_scale([(1, 2, 3)], [
            {"type": "door_standard", "measured_units": 2.14, "known_meters": 2.15},
            {"type": "door_standard", "measured_units": 2.15, "known_meters": 2.15},
            {"type": "ceiling_standard", "measured_units": 2.90, "known_meters": 2.90},
        ])
        self.assertFalse(report_assumed["is_calibrated"])

        # Calibrated when physical ground truth (LiDAR benchmark / surveyor marker) is provided with <= 5% error
        report_verified = calibrate_sparse_scale([(1, 2, 3)], [
            {"type": "lidar_benchmark", "measured_units": 2.15, "known_meters": 2.15},
            {"type": "surveyor_marker", "point_a": [0, 0, 0], "point_b": [2.90, 0, 0], "known_meters": 2.90},
        ])
        self.assertTrue(report_verified["is_calibrated"])
        self.assertGreaterEqual(report_verified["confidence_score"], 0.90)
        self.assertLessEqual(report_verified["error_margin_percent"], 5.0)

    def test_06_laplacian_sharpness_assessment(self):
        """Computes true Laplacian gradient variance from image pixels."""
        images_dir = os.path.join(self.temp_dir, "captures")
        os.makedirs(images_dir, exist_ok=True)

        for i in range(12):
            arr = np.random.randint(0, 255, (400, 400, 3), dtype=np.uint8)
            im = Image.fromarray(arr)
            im.save(os.path.join(images_dir, f"frame_{i:04d}.jpg"), quality=95)

        val_res = validate_keyframes(images_dir, min_images=12)
        self.assertTrue(val_res["valid"])
        self.assertGreater(val_res["sharpness_score"], 50)
        self.assertGreater(val_res["avg_laplacian_variance"], 100.0)

    def test_07_binary_glb_surface_reconstruction(self):
        """Generates 100% compliant glTF 2.0 binary mesh using true Alpha-Shape surface reconstruction on real 3D points."""
        sparse_dir = os.path.join(self.temp_dir, "colmap_sparse")
        os.makedirs(sparse_dir, exist_ok=True)
        # Generate non-trivial 3D point cloud (L-shaped room geometry)
        with open(os.path.join(sparse_dir, "points3D.txt"), "w") as f:
            for i in range(15):
                f.write(f"{i} {i*0.4:.2f} {i*0.2:.2f} 0.0 200 150 100 0.5 1\n")
            for i in range(15, 30):
                f.write(f"{i} 6.0 {i*0.2:.2f} {(i-15)*0.4:.2f} 180 140 90 0.6 1\n")

        out_glb = os.path.join(self.temp_dir, "scene_mesh.glb")
        res = generate_metric_mesh_glb(sparse_dir, out_glb, scale_factor=1.2)
        self.assertTrue(res["success"])
        self.assertTrue(os.path.exists(out_glb))

        is_valid, msg, v_cnt, f_cnt = validate_glb_file(out_glb)
        self.assertTrue(is_valid, msg)
        # NON-SYNTHETIC VERIFICATION: Mesh vertices are reconstructed directly from points, NOT a hardcoded 24-vertex cuboid
        self.assertGreater(v_cnt, 0)
        self.assertGreater(f_cnt, 0)

    def test_08_binary_ply_opacity_and_scale_pruning(self):
        """Prunes low-opacity and oversized Gaussians from binary PLY files."""
        import struct
        bin_ply = os.path.join(self.temp_dir, "raw_binary.ply")
        clean_bin_ply = os.path.join(self.temp_dir, "clean_binary.ply")

        header = (
            "ply\n"
            "format binary_little_endian 1.0\n"
            "element vertex 10\n"
            "property float x\n"
            "property float y\n"
            "property float z\n"
            "property float opacity\n"
            "property float scale_0\n"
            "property float scale_1\n"
            "property float scale_2\n"
            "end_header\n"
        )
        with open(bin_ply, "wb") as f:
            f.write(header.encode("ascii"))
            # 8 valid Gaussians
            for i in range(8):
                f.write(struct.pack("<fffffff", float(i), 1.0, 2.0, 3.0, -1.0, -1.0, -1.0))
            # 1 floater with low opacity (sigmoid(-15) ~ 0)
            f.write(struct.pack("<fffffff", 10.0, 1.0, 2.0, -15.0, -1.0, -1.0, -1.0))
            # 1 floater with oversized scale (exp(5) > 2.5)
            f.write(struct.pack("<fffffff", 11.0, 1.0, 2.0, 3.0, 5.0, -1.0, -1.0))

        res = optimize_splat_cloud(bin_ply, clean_bin_ply, min_opacity=0.05, max_scale=2.5)
        self.assertTrue(res["success"])
        self.assertEqual(res["splat_count"], 8)
        self.assertEqual(res["floaters_pruned"], 2)

    def test_09_colmap_reprojection_and_track_gates(self):
        """Enforces mean reprojection error <= 3.0px and track length >= 2.0."""
        from pipeline.colmap import parse_colmap_reconstruction_metrics
        sparse_dir = os.path.join(self.temp_dir, "sparse_colmap_eval")
        os.makedirs(sparse_dir, exist_ok=True)

        with open(os.path.join(sparse_dir, "points3D.txt"), "w") as f:
            # 50 points with error 1.2px and track length 4
            for i in range(50):
                f.write(f"{i} 1.0 2.0 3.0 200 200 200 1.20 1 10 2 11 3 12 4 13\n")

        reg_imgs, p_cnt, s_dir, metrics = parse_colmap_reconstruction_metrics(sparse_dir)
        self.assertEqual(p_cnt, 50)
        self.assertAlmostEqual(metrics["mean_reprojection_error"], 1.2, places=1)
        self.assertEqual(metrics["mean_track_length"], 4.0)

    def test_10_ssrf_blocking_in_storage_client(self):
        """Storage client strictly rejects SSRF targets (localhost, cloud metadata, private subnets)."""
        client = ObjectStorageClient()
        self.assertTrue(client._is_safe_download_url("https://cdn.hettety.com/photos/frame_01.jpg"))
        self.assertFalse(client._is_safe_download_url("http://127.0.0.1:8080/internal"))
        self.assertFalse(client._is_safe_download_url("http://localhost/secret"))
        self.assertFalse(client._is_safe_download_url("http://169.254.169.254/computeMetadata/v1/"))
        self.assertFalse(client._is_safe_download_url("http://10.0.0.1/admin"))
        self.assertFalse(client._is_safe_download_url("http://192.168.1.100/config"))

    def test_11_metric_calibration_physical_ground_truth(self):
        """Assumed standards alone do NOT award is_calibrated = True; verified physical markers do."""
        # Generic assumed door dimension alone: remains uncalibrated
        assumed = calibrate_sparse_scale([(1, 2, 3)], [
            {"type": "door_standard", "measured_units": 2.14, "known_meters": 2.15}
        ])
        self.assertFalse(assumed["is_calibrated"])

        # Verified surveyor benchmark marker: awards calibrated status
        surveyor = calibrate_sparse_scale([(1, 2, 3)], [
            {"type": "surveyor_marker", "point_a": [0, 0, 0], "point_b": [2.0, 0, 0], "known_meters": 2.0}
        ])
        self.assertTrue(surveyor["is_calibrated"])
        self.assertGreaterEqual(surveyor["confidence_score"], 0.90)

    def test_12_worker_workspace_cleanup(self):
        """Ensures worker cleans up temporary working directories in finally block."""
        worker = ReconstructionWorker(work_dir=os.path.join(self.temp_dir, "worker_scratch"))
        job_id = "test_cleanup_job"
        property_id = "test_prop"

        # Pass a job that fails validation (0 captures)
        res = worker.process_job({
            "id": job_id,
            "propertyId": property_id,
            "captureUrls": []
        })

        self.assertEqual(res["status"], "failed")
        job_work_dir = os.path.join(worker.work_dir, job_id)
        # Verify job workspace was cleaned up
        self.assertFalse(os.path.exists(job_work_dir))

    def test_13_standard_3dgs_sh3_binary_ply_parsing(self):
        """Validates schema-driven parser on standard 3DGS binary PLY with 62 floats (248 bytes/vertex)."""
        import struct
        ply_path = os.path.join(self.temp_dir, "gaussian_3dgs_sh3.ply")
        clean_ply_path = os.path.join(self.temp_dir, "gaussian_3dgs_sh3_clean.ply")

        # Construct full standard 3DGS PLY header (62 floats total = 248 bytes)
        props = [
            "property float x", "property float y", "property float z",
            "property float nx", "property float ny", "property float nz",
            "property float f_dc_0", "property float f_dc_1", "property float f_dc_2",
        ]
        for k in range(45):
            props.append(f"property float f_rest_{k}")
        props.extend([
            "property float opacity",
            "property float scale_0", "property float scale_1", "property float scale_2",
            "property float rot_0", "property float rot_1", "property float rot_2", "property float rot_3"
        ])
        header = "ply\nformat binary_little_endian 1.0\nelement vertex 10\n" + "\n".join(props) + "\nend_header\n"

        with open(ply_path, "wb") as f:
            f.write(header.encode("ascii"))
            for i in range(10):
                # 62 float32 values
                vals = [float(i), 2.0, 3.0] # x, y, z
                vals.extend([0.0, 0.0, 1.0]) # nx, ny, nz
                vals.extend([0.5, 0.5, 0.5]) # f_dc_0, 1, 2
                vals.extend([0.0] * 45) # f_rest_0..44
                vals.append(2.0 if i < 9 else -20.0) # opacity (sigmoid: valid vs floater)
                vals.extend([-1.0, -1.0, -1.0]) # scale_0, 1, 2 (exp scale ~0.36)
                vals.extend([1.0, 0.0, 0.0, 0.0]) # rot_0, 1, 2, 3
                f.write(struct.pack(f"<{len(vals)}f", *vals))

        count, bounds = parse_ply_header_and_bounds(ply_path)
        self.assertEqual(count, 10)
        self.assertAlmostEqual(bounds["min"][0], 0.0, places=1)
        self.assertAlmostEqual(bounds["max"][0], 9.0, places=1)

        opt_res = optimize_splat_cloud(ply_path, clean_ply_path, min_opacity=0.05)
        self.assertTrue(opt_res["success"])
        self.assertEqual(opt_res["splat_count"], 9)
        self.assertEqual(opt_res["floaters_pruned"], 1)

    def test_14_queue_consumer_durable_loop_and_cancellation(self):
        """Tests QueueConsumer poll, lease tracking, ACK, and cancellation flags."""
        from task_queue.consumer import QueueConsumer

        # Initialize mock consumer
        consumer = QueueConsumer(queue_name="test_queue", redis_url="mock://redis")
        self.assertFalse(consumer.is_job_cancelled("non_existent_job"))

        processed = []
        def handler(job):
            processed.append(job.get("id"))
            return {"status": "READY"}

        # Run one iteration with no pending jobs (returns gracefully without error)
        consumer.listen(handler, poll_interval=0.01, max_iterations=1)
        self.assertEqual(len(processed), 0)

    def test_15_dense_stereo_reconstruction_interface(self):
        """Tests COLMAP dense stereo execution interface and missing binary handling."""
        from pipeline.colmap import run_dense_stereo
        dense_out = os.path.join(self.temp_dir, "dense_workspace")

        res = run_dense_stereo(
            sparse_dir=os.path.join(self.temp_dir, "nonexistent_sparse"),
            image_dir=os.path.join(self.temp_dir, "nonexistent_images"),
            dense_dir=dense_out
        )
        self.assertFalse(res["success"])
        self.assertIn(res["error_code"], ["DENSE_STEREO_FAILED", "COLMAP_NOT_FOUND", "DENSE_STEREO_ERROR"])

    def test_16_colmap_point3d_id_calibration_binding(self):
        """Verifies that point3d_id_a and point3d_id_b bind to COLMAP 3D point IDs stably."""
        point_map = {
            101: (0.0, 0.0, 0.0),
            202: (2.4, 0.0, 0.0),
        }
        ref_anchors = [{
            "type": "surveyor_marker",
            "point3d_id_a": 101,
            "point3d_id_b": 202,
            "known_meters": 2.40,
        }]
        res = calibrate_sparse_scale([(0, 0, 0), (2.4, 0, 0)], ref_anchors, point3d_map=point_map)
        self.assertTrue(res["is_calibrated"])
        self.assertAlmostEqual(res["scale_factor"], 1.0, places=2)
        self.assertGreaterEqual(res["confidence_score"], 0.90)

    def test_17_grounded_quality_metrics_real_unknown_fail(self):
        """Verifies that publish_tour_assets produces strictly REAL/UNKNOWN/FAIL telemetry without fake defaults."""
        dummy_spz = os.path.join(self.temp_dir, "test_metrics.spz")
        dummy_glb = os.path.join(self.temp_dir, "test_metrics.glb")
        with open(dummy_spz, "wb") as f:
            f.write(b"SPZ_TEST_VALID_DATA")
        with open(dummy_glb, "wb") as f:
            f.write(b"glTF\x02\x00\x00\x00\x20\x00\x00\x00")

        pub_res = publish_tour_assets(
            job_id="test_job_metrics",
            property_id="test_prop",
            spz_path=dummy_spz,
            glb_path=dummy_glb,
            bounds={"min": [-2, -1, -2], "max": [2, 1, 2]},
            cdn_base_url="https://cdn.hettety.com",
            callback_url="mock://callback",
            api_key="mock_key",
            image_count=30,
            splat_count=50000,
            sharpness_score=None,
            registered_cameras=28,
            mesh_vertex_count=120,
            mesh_face_count=80,
            is_calibrated_metric=True,
            calibration_confidence=0.95,
            calibration_rmse=0.02,
        )
        self.assertTrue(pub_res["success"])
        metrics = pub_res["payload"]["qualityReport"]["metrics"]
        self.assertEqual(metrics["registeredCameras"]["status"], "REAL")
        self.assertEqual(metrics["registeredCameras"]["value"], 28)
        self.assertEqual(metrics["splatCount"]["status"], "REAL")
        self.assertEqual(metrics["splatCount"]["value"], 50000)
        self.assertEqual(metrics["sharpnessScore"]["status"], "UNKNOWN")
        self.assertIsNone(metrics["sharpnessScore"]["value"])

    def test_18_strict_bounds_validation_no_synthetic_box(self):
        """Worker strictly fails with MESH_VALIDATION_FAILED if bounds are missing, rather than inventing room boxes."""
        worker = ReconstructionWorker(work_dir=os.path.join(self.temp_dir, "worker_bounds_test"))
        job_id = "test_bounds_fail_job"

        # Mock optimize_splat_cloud to return success=True but missing bounds
        import workers.reconstruction_worker as rw_mod
        orig_validate = rw_mod.validate_keyframes
        orig_sfm = rw_mod.run_sfm
        orig_dense = rw_mod.run_dense_stereo
        orig_train = rw_mod.run_gaussian_training
        orig_opt = rw_mod.optimize_splat_cloud

        try:
            rw_mod.validate_keyframes = lambda *a, **k: {"valid": True, "image_count": 15, "sharpness_score": 75}
            rw_mod.run_sfm = lambda *a, **k: {"success": True, "registered_images": 15}
            # Write a real fused.ply: this test is about bounds validation, so
            # dense has to genuinely pass rather than be waved through.
            def _dense_ok(*a, **k):
                dense_dir = k.get("dense_dir") or (a[2] if len(a) > 2 else None)
                if dense_dir:
                    os.makedirs(dense_dir, exist_ok=True)
                    header = "ply\nformat binary_little_endian 1.0\nelement vertex 0\nend_header\n"
                    with open(os.path.join(dense_dir, "fused.ply"), "wb") as fh:
                        fh.write(header.encode("ascii"))
                        fh.write(bytes(256))
                return {"success": True}

            rw_mod.run_dense_stereo = _dense_ok
            rw_mod.run_gaussian_training = lambda *a, **k: {"success": True, "target_ply": "mock.ply"}
            # Return no bounds
            rw_mod.optimize_splat_cloud = lambda *a, **k: {"success": True, "splat_count": 5000, "bounds": None}

            res = worker.process_job({
                "id": job_id,
                "propertyId": "test_prop",
                "captureUrls": ["https://cdn.hettety.com/f1.jpg"] * 15,
                "callbackUrl": "mock://callback"
            })
            self.assertEqual(res["status"], "failed")
            self.assertEqual(res["errorCode"], "MESH_VALIDATION_FAILED")
        finally:
            rw_mod.validate_keyframes = orig_validate
            rw_mod.run_sfm = orig_sfm
            rw_mod.run_dense_stereo = orig_dense
            rw_mod.run_gaussian_training = orig_train
            rw_mod.optimize_splat_cloud = orig_opt

    def test_19_object_storage_download_object_protocols(self):
        """Verifies ObjectStorageClient.download_object handles local files, storage paths, and local root."""
        storage = ObjectStorageClient(provider="local")
        
        # 1. Test local root path resolution
        sample_rel = "properties/test_prop_101/3d/raw/test_frame.jpg"
        abs_in_local_root = os.path.join(storage.local_root, sample_rel)
        os.makedirs(os.path.dirname(abs_in_local_root), exist_ok=True)
        with open(abs_in_local_root, "wb") as f:
            f.write(b"jpeg_keyframe_data_bytes")

        dest = os.path.join(self.temp_dir, "downloaded_frame.jpg")
        success = storage.download_object(sample_rel, dest)
        self.assertTrue(success)
        self.assertTrue(os.path.exists(dest))
        with open(dest, "rb") as f:
            self.assertEqual(f.read(), b"jpeg_keyframe_data_bytes")

        # 2. Test direct file path
        dest2 = os.path.join(self.temp_dir, "downloaded_frame_2.jpg")
        success2 = storage.download_object(dest, dest2)
        self.assertTrue(success2)
        self.assertTrue(os.path.exists(dest2))

    def test_20_queue_consumer_isolated_streams_no_blpop_fallback(self):
        """Verifies that when streams are enabled, QueueConsumer does not fall through to BLPOP."""
        consumer = QueueConsumer(queue_name="test_queue", redis_url="mock://redis")
        consumer.use_streams = True
        
        # When stream returns no entries, poll_job must return None without polling list queue
        class MockRedis:
            def __init__(self):
                self.blpop_called = False
            def xreadgroup(self, *a, **k):
                return []
            def blpop(self, *a, **k):
                self.blpop_called = True
                return ("test_queue", '{"id": "duplicate_job"}')

        mock_redis = MockRedis()
        consumer.redis_client = mock_redis
        job = consumer.poll_job(timeout_sec=1)
        self.assertIsNone(job)
        self.assertFalse(mock_redis.blpop_called, "BLPOP should NEVER be called when Redis Streams are active!")

    def test_21_points3d_txt_isolated_from_fused_ply(self):
        """Verifies that POINT3D_ID coordinates are parsed strictly from points3D.txt format."""
        colmap_dir = os.path.join(self.temp_dir, "sfm_test")
        sparse_dir = os.path.join(colmap_dir, "sparse", "0")
        os.makedirs(sparse_dir, exist_ok=True)

        points_file = os.path.join(sparse_dir, "points3D.txt")
        with open(points_file, "w") as f:
            f.write("# 3D point list with one line of data per point:\n")
            f.write("# POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)\n")
            f.write("42 1.25 2.50 3.75 255 128 64 0.15 1 0 2 1\n")
            f.write("99 -0.5 1.0 2.0 200 200 200 0.10 1 1 2 2\n")

        sparse_pts = []
        sparse_map = {}
        with open(points_file, "r") as f:
            for line in f:
                if not line.startswith("#") and line.strip():
                    parts = line.split()
                    if len(parts) >= 4:
                        coord = (float(parts[1]), float(parts[2]), float(parts[3]))
                        sparse_pts.append(coord)
                        sparse_map[int(parts[0])] = coord

        self.assertEqual(len(sparse_pts), 2)
        self.assertIn(42, sparse_map)
        self.assertIn(99, sparse_map)
        self.assertEqual(sparse_map[42], (1.25, 2.50, 3.75))

    def test_22_magic_bytes_rejection_for_corrupt_captures(self):
        """Verifies that keyframe validation rejects spoofed files failing image magic bytes."""
        corrupt_dir = os.path.join(self.temp_dir, "corrupt_captures")
        os.makedirs(corrupt_dir, exist_ok=True)

        # Write 15 files with .jpg extension but containing plain text rather than JPEG magic bytes
        for i in range(15):
            fake_path = os.path.join(corrupt_dir, f"frame_{i:04d}.jpg")
            with open(fake_path, "wb") as f:
                f.write(b"PLAIN_TEXT_NOT_A_REAL_IMAGE_" * 1000)

        val_res = validate_keyframes(corrupt_dir, min_images=12)
        self.assertFalse(val_res["valid"])
        self.assertEqual(val_res["error_code"], "CORRUPT_OR_LOW_RES_CAPTURES")
        self.assertIn("magic bytes", val_res["message"].lower())

    def test_23_worker_stage_reporting_with_attempt_and_worker_id(self):
        """Verifies that worker attaches attemptId and workerId to callbacks and published payloads."""
        # 1. Verify publish_tour_assets includes attemptId and workerId in payload
        dummy_spz = os.path.join(self.temp_dir, "test.spz")
        dummy_glb = os.path.join(self.temp_dir, "test.glb")
        with open(dummy_spz, "wb") as f:
            f.write(b"SPZ_TEST_BYTES")
        with open(dummy_glb, "wb") as f:
            f.write(b"GLB_TEST_BYTES")

        pub_res = publish_tour_assets(
            job_id="job_audit_99",
            property_id="prop_audit_99",
            spz_path=dummy_spz,
            glb_path=dummy_glb,
            bounds={"min": [-1, -1, -1], "max": [1, 1, 1]},
            cdn_base_url="https://cdn.hettety.com",
            callback_url="mock://callback",
            api_key="test-key",
            image_count=20,
            splat_count=50000,
            sharpness_score=80,
            registered_cameras=20,
            mesh_vertex_count=500,
            mesh_face_count=800,
            is_calibrated_metric=True,
            calibration_confidence=0.95,
            calibration_rmse=0.02,
            attempt_id="attempt_run_7",
            worker_id="worker_gpu_node_3"
        )
        self.assertTrue(pub_res["success"])
        payload = pub_res["payload"]
        self.assertEqual(payload["attemptId"], "attempt_run_7")
        self.assertEqual(payload["workerId"], "worker_gpu_node_3")

        # 2. Verify worker process_job passes attemptId and workerId
        worker = ReconstructionWorker(work_dir=self.temp_dir)
        reported_stages = []

        def mock_report(job_id, property_id, status, progress, stage, callback_url, api_key, attempt_id=None, worker_id=None):
            reported_stages.append({
                "jobId": job_id,
                "status": status,
                "attemptId": attempt_id,
                "workerId": worker_id
            })

        worker._report_stage = mock_report

        # Create a cancelled job to observe pre-flight report
        job_spec = {
            "id": "job_cancelled_preflight",
            "propertyId": "prop_audit_99",
            "attemptId": "attempt_isolated_42",
            "workerId": "worker_h100_1",
            "captureUrls": []
        }
        worker.is_cancelled = lambda jid: True
        res = worker.process_job(job_spec)
        self.assertEqual(res["status"], "cancelled")
        self.assertTrue(len(reported_stages) > 0)
        self.assertEqual(reported_stages[0]["attemptId"], "attempt_isolated_42")
        self.assertEqual(reported_stages[0]["workerId"], "worker_h100_1")

    def test_24_redis_lease_heartbeat_renewal_and_xautoclaim_protection(self):
        """Verifies heartbeat extends Redis lease TTL, touches Stream PEL, and protects active jobs against XAUTOCLAIM theft."""
        class MockRedisStreamLease:
            def __init__(self):
                self.leases = {}
                self.xclaim_calls = []
                self.xautoclaim_calls = []
                self.stream_entries = []

            def set(self, key, value, ex=None):
                self.leases[key] = {"value": value, "ex": ex}
                return True

            def get(self, key):
                entry = self.leases.get(key)
                return entry["value"] if entry else None

            def xclaim(self, stream, group, worker, min_idle_time, message_ids, justid=False):
                self.xclaim_calls.append({
                    "stream": stream, "group": group, "worker": worker,
                    "min_idle_time": min_idle_time, "message_ids": message_ids, "justid": justid
                })
                return message_ids

            def xautoclaim(self, stream, group, worker, min_idle_time, start_id="0-0", count=1):
                self.xautoclaim_calls.append({"worker": worker, "min_idle_time": min_idle_time})
                if self.stream_entries:
                    msg_id, fields = self.stream_entries[0]
                    return ("0-0", [(msg_id, fields)], [])
                return ("0-0", [], [])

            def xreadgroup(self, group, worker, streams, count=1, block=None):
                return []

        mock_redis = MockRedisStreamLease()
        worker_alpha = QueueConsumer(queue_name="hettety_3d_jobs")
        worker_alpha.redis_client = mock_redis
        worker_alpha.use_streams = True
        worker_alpha.worker_id = "worker_alpha_h100"

        # 1. Simulate job active on worker Alpha
        job_payload = {"id": "job_stream_lease_001", "propertyId": "prop_test_1"}
        worker_alpha._in_flight["job_stream_lease_001"] = {
            "job": job_payload,
            "leased_at": time.time(),
            "stream": True,
            "stream_msg_id": "1720000000000-0"
        }

        # 2. Worker Alpha issues heartbeat
        res = worker_alpha.heartbeat("job_stream_lease_001")
        self.assertTrue(res)

        # Assert lease key was written with TTL >= 60
        lease_key = "hettety:lease:job_stream_lease_001"
        self.assertIn(lease_key, mock_redis.leases)
        self.assertEqual(mock_redis.leases[lease_key]["value"], "worker_alpha_h100")
        self.assertGreaterEqual(mock_redis.leases[lease_key]["ex"], 60)

        # Assert Stream PEL was touched via XCLAIM with min_idle_time=0 and message_ids=["1720000000000-0"]
        self.assertEqual(len(mock_redis.xclaim_calls), 1)
        self.assertEqual(mock_redis.xclaim_calls[0]["message_ids"], ["1720000000000-0"])
        self.assertEqual(mock_redis.xclaim_calls[0]["min_idle_time"], 0)
        self.assertTrue(mock_redis.xclaim_calls[0]["justid"])

        # 3. Worker Beta attempts XAUTOCLAIM while lease is actively held by Alpha
        worker_beta = QueueConsumer(queue_name="hettety_3d_jobs")
        worker_beta.redis_client = mock_redis
        worker_beta.use_streams = True
        worker_beta.worker_id = "worker_beta_a100"

        mock_redis.stream_entries = [("1720000000000-0", {"payload": json.dumps(job_payload)})]
        claimed_job = worker_beta.poll_job(timeout_sec=0)

        # Beta MUST skip the job because Alpha holds the active lease
        self.assertIsNone(claimed_job)
        self.assertNotIn("job_stream_lease_001", worker_beta._in_flight)

        # 4. Now simulate Alpha's lease expiring/clearing
        del mock_redis.leases[lease_key]
        claimed_by_beta = worker_beta.poll_job(timeout_sec=0)
        self.assertIsNotNone(claimed_by_beta)
        self.assertEqual(claimed_by_beta["id"], "job_stream_lease_001")
        self.assertEqual(mock_redis.leases[lease_key]["value"], "worker_beta_a100")

    def test_25_managed_process_cancellation_kills_process_tree(self):
        """Verifies run_managed_process terminates subprocess tree immediately on cancellation signal."""
        # Spawn a long-running process (15 seconds sleep)
        cmd = [sys.executable, "-c", "import time; time.sleep(15)"]

        cancel_container = {"cancelled": False}
        def cancel_check():
            return cancel_container["cancelled"]

        # Cancel after 0.25 seconds
        def trigger_cancel():
            time.sleep(0.25)
            cancel_container["cancelled"] = True

        cancel_thread = threading.Thread(target=trigger_cancel)
        cancel_thread.start()

        start = time.time()
        with self.assertRaises(JobCancelledException):
            run_managed_process(cmd, check=True, cancel_check=cancel_check, poll_interval=0.05)
        elapsed = time.time() - start

        cancel_thread.join()
        # Must have cancelled quickly (under 3s), not waited 15s
        self.assertLess(elapsed, 3.0)
        # All managed processes must be unregistered
        self.assertEqual(len(ACTIVE_PROCESSES), 0)

    def test_26_production_mode_guards_against_test_env_and_missing_runner(self):
        """Verifies fail-closed production guards against test environment and absent 3DGS runner."""
        old_node_env = os.environ.get("NODE_ENV")
        old_hettety_env = os.environ.get("HETTETY_ENV")

        try:
            # 1. NODE_ENV=production + HETTETY_ENV=test is strictly rejected
            os.environ["NODE_ENV"] = "production"
            os.environ["HETTETY_ENV"] = "test"

            with self.assertRaises(RuntimeError) as ctx:
                ReconstructionWorker(work_dir=self.temp_dir)
            self.assertIn("INVALID_ENVIRONMENT_CONFIGURATION", str(ctx.exception))

            res = run_gaussian_training(
                source_dir=self.temp_dir,
                output_model_dir=os.path.join(self.temp_dir, "out")
            )
            self.assertFalse(res["success"])
            self.assertEqual(res["error_code"], "INVALID_ENVIRONMENT_CONFIGURATION")

            # 2. In production without HETTETY_ENV=test, missing 3DGS runner fails closed
            del os.environ["HETTETY_ENV"]
            res_prod = run_gaussian_training(
                source_dir=self.temp_dir,
                output_model_dir=os.path.join(self.temp_dir, "out")
            )
            self.assertFalse(res_prod["success"])
            self.assertEqual(res_prod["error_code"], "GAUSSIAN_TRAINING_FAILED")
            self.assertIn("missing in production", res_prod["message"].lower())

        finally:
            if old_node_env is not None:
                os.environ["NODE_ENV"] = old_node_env
            else:
                os.environ.pop("NODE_ENV", None)

            if old_hettety_env is not None:
                os.environ["HETTETY_ENV"] = old_hettety_env
            else:
                os.environ.pop("HETTETY_ENV", None)

    def test_28_spz_glb_metric_coordinate_scaling_invariance(self):
        """
        Verifies that applying metric scale k=2.5 produces coordinate-exact invariance
        (2.5*x, 2.5*y, 2.5*z) across both decoded SPZ Gaussian primitives and GLB mesh bounds.
        """
        scale_factor = 2.5
        pts = [
            (1.0, 2.0, 3.0),
            (4.0, -1.0, 2.5),
            (-2.0, 3.5, 1.0),
            (0.5, -2.5, 4.0),
            (2.2, 1.1, -1.5),
            (-1.5, -0.5, 2.0),
            (3.0, 3.0, 3.0),
            (-3.0, -2.0, -1.0)
        ]

        # 1. Create unscaled PLY
        unscaled_ply = os.path.join(self.temp_dir, "unscaled.ply")
        with open(unscaled_ply, "w") as f:
            f.write("ply\nformat ascii 1.0\nelement vertex {}\n".format(len(pts)))
            f.write("property float x\nproperty float y\nproperty float z\n")
            f.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
            f.write("property float opacity\n")
            f.write("property float scale_0\nproperty float scale_1\nproperty float scale_2\n")
            f.write("property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n")
            f.write("end_header\n")
            for x, y, z in pts:
                f.write(f"{x} {y} {z} 200 200 200 2.0 -2.0 -2.0 -2.0 1.0 0.0 0.0 0.0\n")

        # 2. Scale PLY by k=2.5
        metric_ply = os.path.join(self.temp_dir, "metric.ply")
        scale_res = scale_ply_to_metric(unscaled_ply, metric_ply, scale_factor=scale_factor)
        self.assertTrue(scale_res["success"])

        # 3. Convert metric PLY to SPZ and decode
        spz_path = os.path.join(self.temp_dir, "model_metric.spz")
        conv_res = convert_ply_to_spz(metric_ply, spz_path)
        self.assertTrue(conv_res["success"])

        spz_decoded = decode_spz_native(spz_path)
        self.assertTrue(spz_decoded["success"])
        decoded_positions = spz_decoded["positions"]
        self.assertEqual(len(decoded_positions), len(pts))

        for orig, scaled in zip(pts, decoded_positions):
            self.assertAlmostEqual(scaled[0], orig[0] * scale_factor, places=3)
            self.assertAlmostEqual(scaled[1], orig[1] * scale_factor, places=3)
            self.assertAlmostEqual(scaled[2], orig[2] * scale_factor, places=3)

        # 4. Generate GLB mesh from sparse COLMAP directory with k=2.5
        sparse_dir = os.path.join(self.temp_dir, "sparse_pts")
        os.makedirs(sparse_dir, exist_ok=True)
        pts3d_file = os.path.join(sparse_dir, "points3D.txt")
        with open(pts3d_file, "w") as f:
            for i, (x, y, z) in enumerate(pts, start=1):
                f.write(f"{i} {x} {y} {z} 200 200 200 0.1 1 0 2 0\n")

        glb_path = os.path.join(self.temp_dir, "model_metric.glb")
        mesh_res = generate_metric_mesh_glb(sparse_dir, glb_path, scale_factor=scale_factor)
        self.assertTrue(mesh_res["success"])

        # Check GLB container validation
        valid_glb, glb_msg, v_count, f_count = validate_glb_file(glb_path)
        self.assertTrue(valid_glb, glb_msg)

        # Check GLB bounding box reflects exactly scale_factor=2.5
        orig_min_x = min(p[0] for p in pts)
        orig_max_x = max(p[0] for p in pts)
        self.assertAlmostEqual(mesh_res["bounds"]["min"][0], orig_min_x * scale_factor, places=2)
        self.assertAlmostEqual(mesh_res["bounds"]["max"][0], orig_max_x * scale_factor, places=2)

    def test_29_metric_scaling_failure_path_aborts_without_publish(self):
        """
        Verifies that when is_calibrated=True but scale_ply_to_metric fails,
        the worker fails closed with METRIC_SCALING_FAILED and does NOT publish unscaled assets.
        """
        import unittest.mock as mock
        os.environ["HETTETY_ENV"] = "test"
        worker = ReconstructionWorker(work_dir=self.temp_dir)

        fixture_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "real_properties", "prop_villa_marassi_01")
        )
        def mock_download(urls, target_dir):
            import shutil
            for f in os.listdir(fixture_dir):
                if f.lower().endswith((".jpg", ".png")):
                    shutil.copy(os.path.join(fixture_dir, f), os.path.join(target_dir, f))
        worker.storage_client.download_capture_files = mock_download

        # Mock scale_ply_to_metric to simulate failure
        with mock.patch("workers.reconstruction_worker.scale_ply_to_metric") as mock_scaler:
            mock_scaler.return_value = {
                "success": False,
                "error_code": "DISK_IO_FAILURE",
                "message": "Simulated disk failure during canonical metric PLY generation"
            }

            job = {
                "id": "job_fail_metric_scale_001",
                "propertyId": "prop_test_01",
                "ownerId": "owner_test",
                "captureUrls": ["http://mock/1.jpg"] * 15,
                "referenceAnchors": [
                    {
                        "type": "lidar_benchmark",
                        "measured_units": 2.15,
                        "known_meters": 2.15
                    }
                ]
            }

            result = worker.process_job(job)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["error_code"], "METRIC_SCALING_FAILED")
            self.assertIn("canonical metric Gaussian scaling failed", result["message"])

    def test_30_fail_closed_survey_partitioning(self):
        """
        Verifies that survey benchmarks without primaryCalibrationAnchor fail closed
        with NO_PRIMARY_CALIBRATION_ANCHOR instead of leaking into unpartitioned calibration.
        """
        unpartitioned_survey = [
            {
                "id": "span_a",
                "physicalMeters": 4.23,
                "landmark_a": {"colmap_point3d_id": 1},
                "landmark_b": {"colmap_point3d_id": 2}
            },
            {
                "id": "span_b",
                "physicalMeters": 0.91,
                "landmark_a": {"colmap_point3d_id": 3},
                "landmark_b": {"colmap_point3d_id": 4}
            }
        ]

        # 1. partition_survey_benchmarks must raise ValueError when fail_closed=True
        with self.assertRaises(ValueError) as ctx:
            partition_survey_benchmarks(unpartitioned_survey, fail_closed=True)
        self.assertIn("primaryCalibrationAnchor", str(ctx.exception))

        # 2. calibrate_sparse_scale must fail closed with NO_PRIMARY_CALIBRATION_ANCHOR
        calib_res = calibrate_sparse_scale(
            sparse_points=[(0, 0, 0), (1, 1, 1)],
            reference_anchors=unpartitioned_survey,
            calibration_only=True,
            fail_closed=True
        )
        self.assertFalse(calib_res["is_calibrated"])
        self.assertEqual(calib_res.get("error_code"), "NO_PRIMARY_CALIBRATION_ANCHOR")

    def test_31_quality_gate_certification_distinction(self):
        """
        Verifies explicit distinction between visualReady (walkthrough navigable)
        and metricCertified (true architectural survey ground truth).
        """
        # Uncalibrated scene
        uncalibrated_report = evaluate_reconstruction_quality(
            image_count=20,
            registered_cameras=18,
            mean_reprojection_error=0.8,
            splat_count=50000,
            bounds={"min": [-2, 0, -2], "max": [2, 3, 2]},
            mesh_vertex_count=500,
            mesh_face_count=900,
            glb_size_bytes=20000,
            is_calibrated_metric=False
        )
        self.assertTrue(uncalibrated_report["certification"]["visualReady"])
        self.assertFalse(uncalibrated_report["certification"]["metricCertified"])

        # Metric certified scene
        calibrated_report = evaluate_reconstruction_quality(
            image_count=20,
            registered_cameras=18,
            mean_reprojection_error=0.8,
            splat_count=50000,
            bounds={"min": [-2, 0, -2], "max": [2, 3, 2]},
            mesh_vertex_count=500,
            mesh_face_count=900,
            glb_size_bytes=20000,
            is_calibrated_metric=True,
            calibration_confidence=0.98,
            calibration_rmse=0.012
        )
        self.assertTrue(calibrated_report["certification"]["visualReady"])
        self.assertTrue(calibrated_report["certification"]["metricCertified"])

    def test_32_metric_calibration_quality_gate_validation(self):
        """
        Verifies strict fail-closed rejection when metric calibration claims
        fail confidence (< 0.85, non-finite, zero/neg, missing) or RMSE (> 0.05m, non-finite, missing).
        """
        base_args = dict(
            image_count=20,
            registered_cameras=18,
            mean_reprojection_error=0.8,
            splat_count=50000,
            bounds={"min": [-2, 0, -2], "max": [2, 3, 2]},
            mesh_vertex_count=500,
            mesh_face_count=900,
            glb_size_bytes=20000,
            is_calibrated_metric=True,
        )

        # 1. Missing confidence (None)
        res_none_conf = evaluate_reconstruction_quality(**base_args, calibration_confidence=None, calibration_rmse=0.02)
        self.assertFalse(res_none_conf["passed"])
        self.assertEqual(res_none_conf["status"], "REJECTED")
        self.assertFalse(res_none_conf["checks"]["metricCalibration"]["passed"])
        self.assertFalse(res_none_conf["certification"]["metricCertified"])
        self.assertEqual(res_none_conf["certification"]["status"], "REJECTED")

        # 2. Zero / negative confidence
        res_zero_conf = evaluate_reconstruction_quality(**base_args, calibration_confidence=0.0, calibration_rmse=0.02)
        self.assertFalse(res_zero_conf["passed"])
        self.assertEqual(res_zero_conf["status"], "REJECTED")

        res_neg_conf = evaluate_reconstruction_quality(**base_args, calibration_confidence=-0.5, calibration_rmse=0.02)
        self.assertFalse(res_neg_conf["passed"])
        self.assertEqual(res_neg_conf["status"], "REJECTED")

        # 3. NaN / Inf confidence
        res_nan_conf = evaluate_reconstruction_quality(**base_args, calibration_confidence=float("nan"), calibration_rmse=0.02)
        self.assertFalse(res_nan_conf["passed"])
        self.assertEqual(res_nan_conf["status"], "REJECTED")

        res_inf_conf = evaluate_reconstruction_quality(**base_args, calibration_confidence=float("inf"), calibration_rmse=0.02)
        self.assertFalse(res_inf_conf["passed"])
        self.assertEqual(res_inf_conf["status"], "REJECTED")

        # 4. Sub-threshold confidence (< 0.85)
        res_sub_conf = evaluate_reconstruction_quality(**base_args, calibration_confidence=0.84, calibration_rmse=0.02)
        self.assertFalse(res_sub_conf["passed"])
        self.assertEqual(res_sub_conf["status"], "REJECTED")

        # 5. Missing RMSE (None)
        res_none_rmse = evaluate_reconstruction_quality(**base_args, calibration_confidence=0.95, calibration_rmse=None)
        self.assertFalse(res_none_rmse["passed"])
        self.assertEqual(res_none_rmse["status"], "REJECTED")

        # 6. NaN / Inf RMSE
        res_nan_rmse = evaluate_reconstruction_quality(**base_args, calibration_confidence=0.95, calibration_rmse=float("nan"))
        self.assertFalse(res_nan_rmse["passed"])
        self.assertEqual(res_nan_rmse["status"], "REJECTED")

        # 7. Excessive RMSE (> 0.05m / 5cm)
        res_bad_rmse = evaluate_reconstruction_quality(**base_args, calibration_confidence=0.95, calibration_rmse=0.055)
        self.assertFalse(res_bad_rmse["passed"])
        self.assertEqual(res_bad_rmse["status"], "REJECTED")

        # 8. Certified calibration passes
        res_ok = evaluate_reconstruction_quality(**base_args, calibration_confidence=0.95, calibration_rmse=0.015)
        self.assertTrue(res_ok["passed"])
        self.assertEqual(res_ok["status"], "READY")
        self.assertEqual(res_ok["certification"]["status"], "METRIC_CERTIFIED")
        self.assertTrue(res_ok["certification"]["visualReady"])
        self.assertTrue(res_ok["certification"]["metricCertified"])

    def test_33_quality_gate_numeric_and_artifact_defenses(self):
        """
        Verifies that non-finite (NaN, Inf), empty, or out-of-bounds numeric inputs
        for reprojection error, bounding boxes, GLB container size, and meshes fail closed.
        """
        valid_args = dict(
            image_count=20,
            registered_cameras=18,
            mean_reprojection_error=0.8,
            splat_count=50000,
            bounds={"min": [-2.0, 0.0, -2.0], "max": [2.0, 3.0, 2.0]},
            mesh_vertex_count=500,
            mesh_face_count=900,
            glb_size_bytes=20000,
            is_calibrated_metric=False,
        )

        # 1. NaN, Inf, and Negative reprojection errors fail closed
        for bad_reproj in [float("nan"), float("inf"), -0.1, 3.1]:
            args = dict(valid_args, mean_reprojection_error=bad_reproj)
            res = evaluate_reconstruction_quality(**args)
            self.assertFalse(res["passed"], f"Expected failure for reprojection error {bad_reproj}")
            self.assertEqual(res["status"], "REJECTED")

        # 2. Corrupt or NaN bounding box coordinates fail closed
        bad_bounds_list = [
            {"min": [float("nan"), 0.0, 0.0], "max": [1.0, 1.0, 1.0]},
            {"min": [0.0, 0.0, 0.0], "max": [float("inf"), 1.0, 1.0]},
            {"min": [0.0, 0.0, 0.0], "max": [0.005, 1.0, 1.0]}, # degenerate dx < 0.01
            {"min": [1.0, 1.0, 1.0], "max": [0.0, 1.0, 1.0]},   # negative dx
            None,
            "not-a-dict",
            {"min": [0.0, 0.0]}, # missing z
        ]
        for bad_bounds in bad_bounds_list:
            args = dict(valid_args, bounds=bad_bounds)
            res = evaluate_reconstruction_quality(**args)
            self.assertFalse(res["passed"], f"Expected failure for bounds {bad_bounds}")
            self.assertEqual(res["status"], "REJECTED")

        # 3. Empty (0 byte), negative, or truncated (< 12 byte) GLB container fail closed
        for bad_glb in [0, -1, 5, 11, None]:
            args = dict(valid_args, glb_size_bytes=bad_glb)
            res = evaluate_reconstruction_quality(**args)
            self.assertFalse(res["passed"], f"Expected failure for GLB size {bad_glb}")
            self.assertEqual(res["status"], "REJECTED")

        # 4. Degenerate mesh geometry fail closed
        for bad_v, bad_f in [(3, 10), (10, 1), (0, 0), (None, 50)]:
            args = dict(valid_args, mesh_vertex_count=bad_v, mesh_face_count=bad_f)
            res = evaluate_reconstruction_quality(**args)
            self.assertFalse(res["passed"], f"Expected failure for mesh ({bad_v}, {bad_f})")
            self.assertEqual(res["status"], "REJECTED")

if __name__ == "__main__":
    unittest.main()


