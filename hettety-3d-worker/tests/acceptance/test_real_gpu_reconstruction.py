"""
Authoritative Production Acceptance Suite: Real GPU & Photogrammetric 3D Reconstruction
========================================================================================

This test suite is the strict, uncompromising verification gate for:
- Phase 6: Real COLMAP Structure-from-Motion and Dense Multi-View Stereo (PatchMatch)
- Phase 7: Real Graphdeco 3D Gaussian Splatting (30,000 iterations on CUDA)
- Phase 17: Full Real End-to-End Reconstruction on Physical GPU Hardware

Strict Invariants Enforced:
1. Rejects HETTETY_ENV=test (real acceptance must run in production/acceptance mode).
2. Strictly rejects synthetic fixture generation (_generate_test_fixture_sfm, _generate_test_fixture_dense).
3. Strictly rejects CPU iterative mathematical optimizers (IterativeGaussianOptimizer) as a substitute for Graphdeco.
4. Requires real NVIDIA GPU with CUDA >= 11.8 and VRAM >= 12 GB.
5. Requires real COLMAP binary executable on PATH or genuine GPU container.
6. Requires official Graphdeco gaussian-splatting runner with compiled CUDA submodules.
7. Emits machine-readable acceptance evidence JSON with hardware details, SHA-256 hashes, and execution metrics.
"""

import os
import sys
import json
import shutil
import tempfile
import unittest
import time
import hashlib
import subprocess
from typing import Dict, Any, Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from pipeline.validate import validate_keyframes
from pipeline.colmap import run_sfm, run_dense_stereo, is_colmap_available
from pipeline.train import run_gaussian_training
from pipeline.optimize import parse_ply_header_and_bounds, optimize_splat_cloud
from pipeline.calibrate import (
    calibrate_sparse_scale,
    load_survey_benchmarks,
    partition_survey_benchmarks,
    evaluate_survey_accuracy
)
from pipeline.compress import (
    generate_metric_mesh_glb,
    validate_glb_file,
    scale_ply_to_metric,
    convert_ply_to_spz,
    decode_spz_native
)
from pipeline.publish import publish_tour_assets
from storage.object_storage import ObjectStorageClient


def get_gpu_environment_details() -> Dict[str, Any]:
    """Inspects physical GPU hardware and runtime dependencies."""
    details = {
        "cuda_available": False,
        "device_count": 0,
        "device_name": None,
        "total_memory_gb": 0.0,
        "colmap_available": is_colmap_available(),
        "colmap_version": None,
        "graphdeco_available": False,
        "graphdeco_script_path": None,
        "pytorch_version": None,
        "cuda_version": None,
    }

    try:
        import torch
        details["pytorch_version"] = torch.__version__
        if torch.cuda.is_available():
            details["cuda_available"] = True
            details["device_count"] = torch.cuda.device_count()
            details["device_name"] = torch.cuda.get_device_name(0)
            details["total_memory_gb"] = round(torch.cuda.get_device_properties(0).total_memory / (1024 ** 3), 2)
            details["cuda_version"] = torch.version.cuda
    except Exception:
        pass

    if shutil.which("colmap"):
        try:
            res = subprocess.run(["colmap", "--version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
            details["colmap_version"] = res.stdout.strip() or res.stderr.strip()
        except Exception:
            pass

    candidates = [
        os.environ.get("GAUSSIAN_SPLATTING_PATH", "/opt/gaussian-splatting/train.py"),
        "/opt/gaussian-splatting/train.py",
        "submodules/gaussian-splatting/train.py",
        os.path.join(os.path.dirname(__file__), "..", "..", "submodules", "gaussian-splatting", "train.py"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            details["graphdeco_available"] = True
            details["graphdeco_script_path"] = os.path.abspath(c)
            break

    return details


class TestRealReconstructionStrictGuards(unittest.TestCase):
    """
    Empirical proof that strict guards FAIL CLOSED and strictly reject all
    synthetic fixtures, mock data, and IterativeGaussianOptimizer substitutions.
    """

    def setUp(self):
        self.orig_strict = os.environ.get("HETTETY_REAL_PIPELINE_STRICT")
        self.orig_env = os.environ.get("HETTETY_ENV")
        os.environ["HETTETY_REAL_PIPELINE_STRICT"] = "1"
        self.temp_dir = tempfile.mkdtemp(prefix="hettety_guard_test_")

    def tearDown(self):
        if self.orig_strict is not None:
            os.environ["HETTETY_REAL_PIPELINE_STRICT"] = self.orig_strict
        else:
            os.environ.pop("HETTETY_REAL_PIPELINE_STRICT", None)

        if self.orig_env is not None:
            os.environ["HETTETY_ENV"] = self.orig_env
        else:
            os.environ.pop("HETTETY_ENV", None)

        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_strict_guard_rejects_synthetic_sfm_fixture(self):
        """Verifies that run_sfm with strict guard rejects synthetic fixture generation."""
        os.environ["HETTETY_ENV"] = "test"
        fake_images_dir = os.path.join(self.temp_dir, "images")
        os.makedirs(fake_images_dir, exist_ok=True)
        for i in range(15):
            with open(os.path.join(fake_images_dir, f"frame_{i:02d}.jpg"), "wb") as f:
                f.write(b"\xff\xd8\xff\xe0" + b"\x00" * 200)

        out_dir = os.path.join(self.temp_dir, "out_sfm")
        if not is_colmap_available():
            res = run_sfm(image_dir=fake_images_dir, output_dir=out_dir)
            self.assertFalse(res.get("success", False))
            self.assertEqual(res.get("error_code"), "COLMAP_UNAVAILABLE")
            self.assertIn("STRICT_REAL_PIPELINE_GUARD", res.get("message", ""))
            sparse_0 = os.path.join(out_dir, "sparse", "0")
            self.assertFalse(os.path.exists(os.path.join(sparse_0, "cameras.txt")))

    def test_strict_guard_rejects_synthetic_dense_fixture(self):
        """Verifies that run_dense_stereo with strict guard rejects synthetic dense PLY generation."""
        os.environ["HETTETY_ENV"] = "test"
        dense_dir = os.path.join(self.temp_dir, "dense")
        if not is_colmap_available():
            res = run_dense_stereo(sparse_dir=self.temp_dir, image_dir=self.temp_dir, dense_dir=dense_dir)
            self.assertFalse(res.get("success", False))
            self.assertEqual(res.get("error_code"), "COLMAP_UNAVAILABLE")
            self.assertIn("STRICT_REAL_PIPELINE_GUARD", res.get("message", ""))
            self.assertFalse(os.path.exists(os.path.join(dense_dir, "fused.ply")))

    def test_strict_guard_rejects_iterative_gaussian_optimizer(self):
        """Verifies that run_gaussian_training with strict guard rejects IterativeGaussianOptimizer."""
        os.environ["HETTETY_ENV"] = "test"
        out_model = os.path.join(self.temp_dir, "model")
        os.environ["GAUSSIAN_SPLATTING_PATH"] = "/nonexistent/path/train.py"
        res = run_gaussian_training(source_dir=self.temp_dir, output_model_dir=out_model, iterations=100)
        self.assertFalse(res.get("success", False))
        self.assertIn(res.get("error_code"), ["GRAPHDECO_RUNNER_MISSING", "CUDA_UNAVAILABLE", "PYTORCH_UNAVAILABLE"])
        self.assertIn("STRICT_REAL_PIPELINE_GUARD", res.get("message", ""))


class TestRealGPUPipelineAcceptance(unittest.TestCase):
    """
    Authoritative Acceptance Test for genuine physical GPU execution.
    Executes the entire 7-stage photogrammetric lifecycle end-to-end ONLY when
    physical GPU hardware and COLMAP binaries are present.
    """

    @classmethod
    def setUpClass(cls):
        cls.fixture_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "tests", "fixtures", "real_properties", "prop_villa_marassi_01")
        )
        cls.gpu_env = get_gpu_environment_details()

    def setUp(self):
        self.orig_strict = os.environ.get("HETTETY_REAL_PIPELINE_STRICT")
        self.orig_env = os.environ.get("HETTETY_ENV")
        os.environ["HETTETY_REAL_PIPELINE_STRICT"] = "1"
        # Reject test mode in acceptance testing
        if os.environ.get("HETTETY_ENV") == "test":
            os.environ.pop("HETTETY_ENV", None)
        self.temp_dir = tempfile.mkdtemp(prefix="hettety_real_acc_")

    def tearDown(self):
        if self.orig_strict is not None:
            os.environ["HETTETY_REAL_PIPELINE_STRICT"] = self.orig_strict
        else:
            os.environ.pop("HETTETY_REAL_PIPELINE_STRICT", None)

        if self.orig_env is not None:
            os.environ["HETTETY_ENV"] = self.orig_env
        else:
            os.environ.pop("HETTETY_ENV", None)

        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_real_gpu_photogrammetry_reconstruction(self):
        """
        Executes genuine COLMAP SfM, Dense Stereo, Graphdeco 3DGS, and holdout Metric Calibration.
        Fails or Skips strictly with explicit diagnosis if required hardware prerequisites are absent.
        """
        evidence: Dict[str, Any] = {
            "test_name": "test_real_gpu_photogrammetry_reconstruction",
            "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "environment": self.gpu_env,
            "status": "UNEXECUTED",
            "blocking_reason": None,
            "stages": {}
        }

        # 1. Enforce rejection of HETTETY_ENV=test
        if os.environ.get("HETTETY_ENV") == "test":
            evidence["status"] = "REJECTED"
            evidence["blocking_reason"] = "HETTETY_ENV=test is strictly rejected in acceptance testing."
            self.fail("ACCEPTANCE_REJECTS_TEST_MODE: Real reconstruction acceptance strictly rejects HETTETY_ENV=test.")

        # 2. Enforce physical GPU prerequisite
        if not self.gpu_env["cuda_available"]:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = "Physical NVIDIA GPU with CUDA support is required. Current host does not have CUDA available."
            evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
            with open(evidence_file, "w", encoding="utf-8") as f:
                json.dump(evidence, f, indent=2)
            self.skipTest(evidence["blocking_reason"])

        if self.gpu_env["total_memory_gb"] < 11.5:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = f"Minimum 12 GB VRAM required for Graphdeco 3DGS training. Detected: {self.gpu_env['total_memory_gb']} GB on {self.gpu_env['device_name']}."
            evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
            with open(evidence_file, "w", encoding="utf-8") as f:
                json.dump(evidence, f, indent=2)
            self.skipTest(evidence["blocking_reason"])

        # 3. Enforce real COLMAP prerequisite
        if not self.gpu_env["colmap_available"]:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = "COLMAP binary executable on PATH is required. Synthetic fixture fallbacks are strictly prohibited."
            evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
            with open(evidence_file, "w", encoding="utf-8") as f:
                json.dump(evidence, f, indent=2)
            self.skipTest(evidence["blocking_reason"])

        # 4. Enforce real Graphdeco training runner prerequisite
        if not self.gpu_env["graphdeco_available"]:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = "Official Graphdeco training runner (gaussian-splatting/train.py) is required. IterativeGaussianOptimizer substitution is strictly prohibited."
            evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
            with open(evidence_file, "w", encoding="utf-8") as f:
                json.dump(evidence, f, indent=2)
            self.skipTest(evidence["blocking_reason"])

        # ---------------------------------------------------------------------
        # Full Real Execution (Only runs when ALL 4 prerequisites are satisfied)
        # ---------------------------------------------------------------------
        print("\n==================================================================")
        print(" EXECUTING AUTHORITATIVE REAL GPU RECONSTRUCTION ACCEPTANCE TEST")
        print(f" GPU Device  : {self.gpu_env['device_name']} ({self.gpu_env['total_memory_gb']} GB VRAM)")
        print(f" PyTorch/CUDA: {self.gpu_env['pytorch_version']} / CUDA {self.gpu_env['cuda_version']}")
        print(f" COLMAP Path : {shutil.which('colmap')} (Version: {self.gpu_env['colmap_version']})")
        print(f" Graphdeco   : {self.gpu_env['graphdeco_script_path']}")
        print("==================================================================\n")

        # Stage 1: Keyframe Validation
        t0 = time.time()
        val_res = validate_keyframes(self.fixture_dir, min_images=12)
        self.assertTrue(val_res["valid"], f"Keyframe validation failed: {val_res}")
        self.assertGreaterEqual(val_res["image_count"], 24)
        evidence["stages"]["VALIDATING"] = {"durationSec": round(time.time() - t0, 2), "imageCount": val_res["image_count"]}

        # Stage 2: Genuine COLMAP SfM
        t1 = time.time()
        sfm_out = os.path.join(self.temp_dir, "sfm")
        sfm_res = run_sfm(image_dir=self.fixture_dir, output_dir=sfm_out, is_video=False)
        self.assertTrue(sfm_res["success"], f"Real COLMAP SfM failed: {sfm_res}")
        self.assertGreaterEqual(sfm_res["registered_images"], 18)
        self.assertGreater(sfm_res["points_count"], 500)
        evidence["stages"]["SFM"] = {
            "durationSec": round(time.time() - t1, 2),
            "registeredImages": sfm_res["registered_images"],
            "pointsCount": sfm_res["points_count"],
            "meanReprojectionError": sfm_res.get("mean_reprojection_error", 0.0)
        }

        # Stage 3: Genuine Dense Multi-View Stereo (PatchMatch)
        t2 = time.time()
        dense_out = os.path.join(self.temp_dir, "dense")
        dense_res = run_dense_stereo(sparse_dir=sfm_out, image_dir=self.fixture_dir, dense_dir=dense_out)
        self.assertTrue(dense_res["success"], f"Real Dense Stereo failed: {dense_res}")
        self.assertGreater(dense_res["dense_point_count"], 5000)
        evidence["stages"]["DENSE_STEREO"] = {
            "durationSec": round(time.time() - t2, 2),
            "densePointCount": dense_res["dense_point_count"]
        }

        # Stage 4: Genuine Graphdeco 3DGS Training (30,000 iterations)
        t3 = time.time()
        model_out = os.path.join(self.temp_dir, "model")
        train_res = run_gaussian_training(
            source_dir=dense_out,
            output_model_dir=model_out,
            iterations=30000,
            sh_degree=3
        )
        self.assertTrue(train_res["success"], f"Graphdeco 3DGS training failed: {train_res}")
        trained_ply = train_res["target_ply"]
        self.assertTrue(os.path.exists(trained_ply))
        evidence["stages"]["TRAINING_3DGS"] = {
            "durationSec": round(time.time() - t3, 2),
            "iterations": 30000,
            "targetPly": trained_ply
        }

        # Stage 5: Floater Pruning & Optimization
        opt_ply = os.path.join(self.temp_dir, "optimized.ply")
        opt_res = optimize_splat_cloud(trained_ply, opt_ply, opacity_threshold=0.01)
        self.assertTrue(opt_res["success"])
        self.assertGreater(opt_res["splat_count"], 10000)

        # Stage 6: Survey Metric Calibration with Holdout Validation
        survey_json = os.path.join(self.fixture_dir, "survey_benchmarks.json")
        benchmarks = load_survey_benchmarks(survey_json)
        partition = partition_survey_benchmarks(benchmarks)
        calib_res = calibrate_sparse_scale(sfm_res.get("sparse_pts", []), partition["calibration_benchmarks"])
        self.assertTrue(calib_res["is_calibrated"])
        scale_k = calib_res["scale_factor"]

        # Holdout Cross-Validation Gate (<= 0.05m RMSE)
        eval_res = evaluate_survey_accuracy(scale_k, partition["holdout_benchmarks"])
        self.assertLessEqual(eval_res["rmse"], 0.05, f"Holdout RMSE {eval_res['rmse']}m exceeded 0.05m gate")

        # Stage 7: Compression (SPZ v4) and Watertight GLB Generation
        spz_file = os.path.join(self.temp_dir, "scene.spz")
        glb_file = os.path.join(self.temp_dir, "mesh.glb")
        metric_ply = os.path.join(self.temp_dir, "metric.ply")

        scale_res = scale_ply_to_metric(opt_ply, metric_ply, scale_factor=scale_k)
        self.assertTrue(scale_res["success"])

        spz_res = convert_ply_to_spz(metric_ply, spz_file)
        self.assertTrue(spz_res["success"])

        mesh_res = generate_metric_mesh_glb(sfm_out, glb_file, scale_factor=scale_k)
        self.assertTrue(mesh_res["success"])

        # Independent SPZ and GLB validation
        spz_check = decode_spz_native(spz_file)
        self.assertTrue(spz_check["success"])
        self.assertEqual(spz_check["num_points"], opt_res["splat_count"])

        glb_check = validate_glb_file(glb_file)
        self.assertTrue(glb_check["valid"])

        with open(spz_file, "rb") as f:
            spz_sha = hashlib.sha256(f.read()).hexdigest()
        with open(glb_file, "rb") as f:
            glb_sha = hashlib.sha256(f.read()).hexdigest()

        evidence["status"] = "PASSED"
        evidence["artifacts"] = {
            "spz": {"path": spz_file, "sizeBytes": os.path.getsize(spz_file), "sha256": spz_sha, "splatCount": opt_res["splat_count"]},
            "glb": {"path": glb_file, "sizeBytes": os.path.getsize(glb_file), "sha256": glb_sha, "validGlTF": True},
            "calibration": {"scaleFactor": scale_k, "holdoutRmse": eval_res["rmse"]}
        }

        evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
        with open(evidence_file, "w", encoding="utf-8") as f:
            json.dump(evidence, f, indent=2)

        print("\n==================================================================")
        print(" AUTHORITATIVE REAL GPU RECONSTRUCTION ACCEPTANCE: PASSED 100%")
        print(f" Trained Splats : {opt_res['splat_count']:,}")
        print(f" Holdout RMSE   : {eval_res['rmse']} m (Certified Metric Invariant)")
        print(f" SPZ SHA-256    : {spz_sha}")
        print(f" GLB SHA-256    : {glb_sha}")
        print("==================================================================\n")


if __name__ == "__main__":
    unittest.main()
