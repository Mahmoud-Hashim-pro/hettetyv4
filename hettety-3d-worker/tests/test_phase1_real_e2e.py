"""
Phase 1: Real Property Image -> Real 3D E2E Pipeline Test
Validates the complete 7-stage reconstruction lifecycle on real architectural keyframe dataset:
1. Input keyframe validation (28 real architectural photos of Villa Marassi)
2. Laplacian sharpness and magic bytes integrity
3. Point cloud geometry parsing and floater pruning
4. Metric scale calibration using ground-truth surveyor anchor
5. Binary glTF 2.0 GLB watertight mesh generation (Zero fake cuboid)
6. Progressive SPZ container generation with SHA-256 cryptographic integrity
7. Publication to control plane and grounded quality telemetry
"""

import os
import sys
import shutil
import tempfile
import unittest
import time
import hashlib
import numpy as np
from typing import Dict, Any

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from pipeline.validate import validate_keyframes, compute_image_laplacian_variance
from pipeline.colmap import run_sfm, run_dense_stereo
from pipeline.train import run_gaussian_training
from pipeline.optimize import parse_ply_header_and_bounds, optimize_splat_cloud
from pipeline.calibrate import (
    calibrate_sparse_scale,
    apply_metric_scale_to_points,
    load_survey_benchmarks,
    evaluate_survey_accuracy
)
from pipeline.compress import (
    generate_metric_mesh_glb,
    validate_glb_file,
    convert_ply_to_spz,
    decode_spz_native
)
from pipeline.publish import publish_tour_assets
from storage.object_storage import ObjectStorageClient

class TestPhase1RealPropertyE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "real_properties", "prop_villa_marassi_01")
        )

    def setUp(self):
        self.orig_env = os.environ.get("HETTETY_ENV")
        self.temp_dir = tempfile.mkdtemp(prefix="hettety_phase1_")

    def tearDown(self):
        if self.orig_env is not None:
            os.environ["HETTETY_ENV"] = self.orig_env
        else:
            os.environ.pop("HETTETY_ENV", None)
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_phase1_complete_real_property_e2e_run(self):
        """
        Executes the authoritative Phase 1 pipeline on the Villa Marassi multi-view capture set.
        Records telemetry: jobId, attemptId, workerId, input images, stage durations, output artifacts, sizes, SHA-256.
        """
        telemetry: Dict[str, Any] = {
            "jobId": "job_villa_marassi_phase1_001",
            "attemptId": "attempt_1",
            "workerId": "hettety-gpu-worker-node-alpha",
            "propertyId": "prop_villa_marassi_01",
            "stages": {},
            "outputArtifacts": {},
            "finalStatus": "UNKNOWN",
        }

        # -------------------------------------------------------------------------
        # Stage 1: Keyframe Validation on Real Architectural Capture Set
        # -------------------------------------------------------------------------
        t0 = time.time()
        self.assertTrue(os.path.exists(self.fixture_dir), f"Fixture directory not found at {self.fixture_dir}")
        val_res = validate_keyframes(self.fixture_dir, min_images=12)
        stage1_duration = round(time.time() - t0, 3)
        telemetry["stages"]["VALIDATING"] = {
            "durationSec": stage1_duration,
            "imageCount": val_res.get("image_count", 0),
            "sharpnessScore": val_res.get("sharpness_score", 0),
            "avgLaplacianVariance": round(val_res.get("avg_laplacian_variance", 0.0), 2),
            "valid": val_res.get("valid", False),
        }
        self.assertTrue(val_res["valid"], f"Validation failed: {val_res}")
        self.assertGreaterEqual(val_res["image_count"], 24)
        self.assertGreater(val_res["sharpness_score"], 60)

        # -------------------------------------------------------------------------
        # Stage 2: Genuine Spatial Sparse Point Cloud Generation & Camera Alignment
        # -------------------------------------------------------------------------
        t1 = time.time()
        sfm_output_dir = os.path.join(self.temp_dir, "sfm")
        sfm_res = run_sfm(image_dir=self.fixture_dir, output_dir=sfm_output_dir, is_video=False)
        stage2_duration = round(time.time() - t1, 3)

        self.assertTrue(sfm_res["success"], f"SfM reconstruction failed: {sfm_res}")
        self.assertGreaterEqual(sfm_res["registered_images"], 18, f"Too few cameras registered: {sfm_res['registered_images']}")
        self.assertGreater(sfm_res["points_count"], 500, f"Too few 3D points created: {sfm_res['points_count']}")
        self.assertLessEqual(sfm_res["mean_reprojection_error"], 3.0)

        sparse_dir = sfm_res["sparse_dir"]
        points3d_txt = os.path.join(sparse_dir, "points3D.txt")
        self.assertTrue(os.path.exists(points3d_txt), f"Missing points3D.txt at {points3d_txt}")

        # Parse genuine reconstructed 3D points from COLMAP
        point_cloud_coords = []
        point_map = {}
        with open(points3d_txt, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.split()
                if len(parts) >= 8:
                    try:
                        pid = int(parts[0])
                        coord = (float(parts[1]), float(parts[2]), float(parts[3]))
                        point_cloud_coords.append(coord)
                        point_map[pid] = coord
                    except ValueError:
                        pass

        telemetry["stages"]["RECONSTRUCTING"] = {
            "durationSec": stage2_duration,
            "sparsePointCount": len(point_cloud_coords),
            "cameraCount": sfm_res["registered_images"],
            "registrationRatio": sfm_res.get("registration_ratio", 1.0),
            "meanReprojectionError": sfm_res.get("mean_reprojection_error", 0.0),
            "meanTrackLength": sfm_res.get("mean_track_length", 0.0),
        }
        self.assertGreaterEqual(len(point_cloud_coords), 500)

        # -------------------------------------------------------------------------
        # Stage 3: Metric Scale Calibration (Independent Architectural Survey Benchmarks)
        # -------------------------------------------------------------------------
        t2 = time.time()
        survey_file = os.path.join(self.fixture_dir, "ground_truth_survey.json")
        self.assertTrue(os.path.exists(survey_file), f"Missing ground truth survey file: {survey_file}")
        benchmarks = load_survey_benchmarks(survey_file)
        self.assertGreaterEqual(len(benchmarks), 3)

        calib_res = calibrate_sparse_scale(point_cloud_coords, benchmarks, point3d_map=point_map, sparse_dir=sparse_dir)
        stage3_duration = round(time.time() - t2, 3)

        self.assertTrue(calib_res["is_calibrated"], f"Calibration failed: {calib_res}")
        self.assertGreaterEqual(calib_res["confidence_score"], 0.90)
        self.assertLessEqual(calib_res["error_margin_percent"], 5.0)

        # STRICT INDEPENDENT VALIDATION: Reconstructed endpoints resolved strictly by surveyed landmark observations (Non-Circular)
        eval_res = evaluate_survey_accuracy(point_map, benchmarks, calib_res["scale_factor"], sparse_dir=sparse_dir)
        self.assertTrue(eval_res["passed"], f"Survey accuracy evaluation failed: {eval_res}")
        self.assertLessEqual(eval_res["rmse"], 0.05, f"RMSE {eval_res['rmse']}m exceeds 5cm certified threshold")
        self.assertLessEqual(eval_res["maxError"], 0.05, f"Max error {eval_res['maxError']}m exceeds 5cm certified threshold")

        for b in eval_res["benchmarks"]:
            self.assertTrue(b["passedTolerance"], f"Benchmark {b['id']} failed tolerance: {b}")

        telemetry["stages"]["CALIBRATION"] = {
            "durationSec": stage3_duration,
            "isCalibrated": calib_res.get("is_calibrated", False),
            "scaleFactor": calib_res.get("scale_factor", 1.0),
            "confidenceScore": calib_res.get("confidence_score", 0.0),
            "errorMarginPercent": calib_res.get("error_margin_percent", 0.0),
            "anchorsVerified": len(benchmarks),
            "surveyValidation": {
                "rmseMeters": eval_res["rmse"],
                "maxErrorMeters": eval_res["maxError"],
                "meanRelativeErrorPct": eval_res["meanRelativeErrorPct"],
                "benchmarks": eval_res["benchmarks"]
            }
        }

        # -------------------------------------------------------------------------
        # Stage 3.5: Dense Multi-View Stereo Fusion
        # -------------------------------------------------------------------------
        t2_dense = time.time()
        dense_dir = os.path.join(sfm_output_dir, "dense")
        dense_res = run_dense_stereo(sparse_dir=sfm_output_dir, image_dir=self.fixture_dir, dense_dir=dense_dir)
        stage_dense_duration = round(time.time() - t2_dense, 3)
        telemetry["stages"]["DENSE_STEREO"] = {
            "durationSec": stage_dense_duration,
            "success": dense_res.get("success", False),
            "dense_dir": dense_dir
        }

        # -------------------------------------------------------------------------
        # Stage 4: Genuine 3D Gaussian Splatting Training & Optimization
        # -------------------------------------------------------------------------
        t3 = time.time()
        model_dir = os.path.join(self.temp_dir, "model")
        os.environ["HETTETY_ENV"] = "test"
        train_res = run_gaussian_training(source_dir=sfm_output_dir, output_model_dir=model_dir, iterations=30000)
        self.assertTrue(train_res["success"], f"3DGS training failed: {train_res}")
        target_ply = train_res["target_ply"]
        self.assertTrue(os.path.exists(target_ply))
        self.assertGreater(os.path.getsize(target_ply), 1000)

        clean_ply = os.path.join(self.temp_dir, "point_cloud_clean.ply")
        opt_res = optimize_splat_cloud(target_ply, clean_ply, min_opacity=0.05)
        stage4_duration = round(time.time() - t3, 3)
        telemetry["stages"]["TRAINING_AND_OPTIMIZING"] = {
            "durationSec": stage4_duration,
            "splatCount": opt_res.get("splat_count", 0),
            "floatersPruned": opt_res.get("floaters_pruned", 0),
            "bounds": opt_res.get("bounds", {}),
        }
        self.assertTrue(opt_res["success"])
        self.assertGreater(opt_res["splat_count"], 100)
        self.assertIsNotNone(opt_res["bounds"])

        # -------------------------------------------------------------------------
        # Stage 5: Compression — SPZ & Metric GLB Generation
        # -------------------------------------------------------------------------
        t4 = time.time()
        dist_dir = os.path.join(self.temp_dir, "dist")
        os.makedirs(dist_dir, exist_ok=True)
        spz_file = os.path.join(dist_dir, "scene.spz")
        glb_file = os.path.join(dist_dir, "mesh.glb")

        convert_res = convert_ply_to_spz(clean_ply, spz_file)
        self.assertTrue(convert_res["success"])
        self.assertTrue(os.path.exists(spz_file))
        self.assertGreater(os.path.getsize(spz_file), 0)

        # Stage 5.5: SPZ Decoder Round-Trip Compatibility Verification
        decoded_spz = decode_spz_native(spz_file)
        self.assertTrue(decoded_spz["success"], f"SPZ decoding failed: {decoded_spz}")
        self.assertEqual(decoded_spz["decodedCount"], opt_res["splat_count"])
        self.assertTrue(np.isfinite(decoded_spz["bounds"]["min"][0]))
        self.assertTrue(np.isfinite(decoded_spz["bounds"]["max"][0]))

        # GLB mesh generation using Alpha-Shape surface reconstruction on real COLMAP sparse directory
        mesh_res = generate_metric_mesh_glb(sparse_dir, glb_file, scale_factor=calib_res["scale_factor"])
        self.assertTrue(mesh_res["success"], f"GLB generation failed: {mesh_res}")
        self.assertTrue(os.path.exists(glb_file))
        self.assertGreater(mesh_res["vertex_count"], 0)
        self.assertGreater(mesh_res["face_count"], 0)

        is_valid_glb, glb_msg, v_cnt, f_cnt = validate_glb_file(glb_file)
        self.assertTrue(is_valid_glb, glb_msg)
        self.assertIn("verified geometry", glb_msg)

        stage5_duration = round(time.time() - t4, 3)
        telemetry["stages"]["COMPRESSION"] = {
            "durationSec": stage5_duration,
            "spzSizeBytes": os.path.getsize(spz_file),
            "glbSizeBytes": os.path.getsize(glb_file),
            "meshVertices": v_cnt,
            "meshFaces": f_cnt,
        }

        # -------------------------------------------------------------------------
        # Stage 6: SHA-256 Cryptographic Hash Generation
        # -------------------------------------------------------------------------
        def get_sha256(path: str) -> str:
            h = hashlib.sha256()
            with open(path, "rb") as fp:
                while chunk := fp.read(65536):
                    h.update(chunk)
            return h.hexdigest()

        spz_hash = get_sha256(spz_file)
        glb_hash = get_sha256(glb_file)
        self.assertEqual(len(spz_hash), 64)
        self.assertEqual(len(glb_hash), 64)

        telemetry["outputArtifacts"]["spz"] = {
            "path": f"properties/{telemetry['propertyId']}/tour/scene.spz",
            "sizeBytes": os.path.getsize(spz_file),
            "sha256": spz_hash,
            "splatCount": opt_res["splat_count"],
        }
        telemetry["outputArtifacts"]["glb"] = {
            "path": f"properties/{telemetry['propertyId']}/tour/mesh.glb",
            "sizeBytes": os.path.getsize(glb_file),
            "sha256": glb_hash,
            "vertexCount": v_cnt,
            "faceCount": f_cnt,
            "isCalibratedMetric": calib_res["is_calibrated"],
        }

        # -------------------------------------------------------------------------
        # Stage 7: Publication to Control Plane & Grounded Quality Report
        # -------------------------------------------------------------------------
        t5 = time.time()
        local_storage = ObjectStorageClient(provider="local")
        pub_res = publish_tour_assets(
            job_id=telemetry["jobId"],
            property_id=telemetry["propertyId"],
            spz_path=spz_file,
            glb_path=glb_file,
            bounds=opt_res["bounds"],
            cdn_base_url="https://cdn.hettety.com",
            callback_url="mock://callback",
            api_key="worker-secret-alpha",
            storage_client=local_storage,
            image_count=val_res["image_count"],
            splat_count=opt_res["splat_count"],
            sharpness_score=val_res["sharpness_score"],
            registered_cameras=val_res["image_count"],
            mesh_vertex_count=v_cnt,
            mesh_face_count=f_cnt,
            is_calibrated_metric=calib_res["is_calibrated"],
            attempt_id=telemetry["attemptId"],
            worker_id=telemetry["workerId"],
            mean_reprojection_error=sfm_res.get("mean_reprojection_error", 0.0),
            calibration_confidence=calib_res.get("confidence_score", 0.0),
            calibration_rmse=eval_res["rmse"]
        )
        stage7_duration = round(time.time() - t5, 3)
        self.assertTrue(pub_res["success"], f"Publishing failed: {pub_res}")
        telemetry["stages"]["PUBLISHING"] = {"durationSec": stage7_duration}
        telemetry["finalStatus"] = "READY"
        telemetry["viewerUrl"] = f"https://hettety.com/properties/{telemetry['propertyId']}?tour=3d"

        # Verify publication payload integrity & Authoritative Quality Gate
        payload = pub_res["payload"]
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["attemptId"], telemetry["attemptId"])
        self.assertEqual(payload["workerId"], telemetry["workerId"])
        self.assertEqual(payload["representation"]["gaussianSplat"]["sha256"], spz_hash)
        self.assertEqual(payload["representation"]["mesh"]["sha256"], glb_hash)
        self.assertTrue(payload["representation"]["mesh"]["isCalibratedMetric"])
        self.assertTrue(payload["qualityReport"]["passed"])
        self.assertEqual(payload["qualityReport"]["status"], "READY")

        # Log comprehensive Phase 1 verification summary
        print("\n=======================================================")
        print(" PHASE 1: REAL PROPERTY IMAGE -> REAL 3D E2E REPORT")
        print("=======================================================")
        print(f" Property ID      : {telemetry['propertyId']}")
        print(f" Job ID / Attempt : {telemetry['jobId']} / {telemetry['attemptId']}")
        print(f" Bound Worker ID  : {telemetry['workerId']}")
        print(f" Final Status     : {telemetry['finalStatus']}")
        print(f" Input Images     : {telemetry['stages']['VALIDATING']['imageCount']} keyframes (Laplacian var: {telemetry['stages']['VALIDATING']['avgLaplacianVariance']})")
        print(f" Reconstructed Pts: {telemetry['stages']['RECONSTRUCTING']['sparsePointCount']}")
        print(f" Metric Calib     : Calibrated={telemetry['stages']['CALIBRATION']['isCalibrated']} (Conf: {telemetry['stages']['CALIBRATION']['confidenceScore']}, Scale: {telemetry['stages']['CALIBRATION']['scaleFactor']})")
        print(f" SPZ Splat Count  : {telemetry['outputArtifacts']['spz']['splatCount']:,} splats ({telemetry['outputArtifacts']['spz']['sizeBytes']:,} bytes)")
        print(f" SPZ SHA-256      : {telemetry['outputArtifacts']['spz']['sha256']}")
        print(f" GLB Mesh Geometry: {telemetry['outputArtifacts']['glb']['vertexCount']} vertices, {telemetry['outputArtifacts']['glb']['faceCount']} faces ({telemetry['outputArtifacts']['glb']['sizeBytes']:,} bytes)")
        print(f" GLB SHA-256      : {telemetry['outputArtifacts']['glb']['sha256']}")
        print(f" Viewer URL       : {telemetry['viewerUrl']}")
        print("=======================================================\n")

if __name__ == "__main__":
    unittest.main()
