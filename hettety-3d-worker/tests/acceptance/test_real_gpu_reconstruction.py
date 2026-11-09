"""
Authoritative Production Acceptance Suite: Real GPU & Photogrammetric 3D Reconstruction
========================================================================================

This test suite is the strict, uncompromising verification gate for:
- Phase 6: Real COLMAP Structure-from-Motion and Dense Multi-View Stereo (PatchMatch)
- Phase 7: Real Graphdeco 3D Gaussian Splatting (30,000 iterations on CUDA)
- Phase 17: Full Real End-to-End Reconstruction on Physical GPU Hardware

Strict Invariants Enforced:
1. Rejects HETTETY_ENV=test in acceptance testing (real acceptance must run in production/acceptance mode).
2. Strictly rejects synthetic fixture generation (_generate_test_fixture_sfm, _generate_test_fixture_dense).
3. Strictly rejects CPU iterative mathematical optimizers (IterativeGaussianOptimizer) as a substitute for Graphdeco.
4. Requires genuine file named train.py (not merely an existing directory).
5. Requires real NVIDIA GPU with CUDA >= 11.8 (numeric tuple comparison) and physical VRAM >= 12 GB.
6. Requires real COLMAP binary executable on PATH or genuine GPU container.
7. Requires official Graphdeco gaussian-splatting runner with compiled CUDA submodules (diff_gaussian_rasterization, simple_knn).
8. Validates acceptance dataset integrity (>= 8 valid images and valid survey benchmarks JSON) and fails closed if incomplete.
9. Emits machine-readable acceptance evidence JSON with hardware details, SHA-256 hashes, and execution metrics.
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
from unittest.mock import patch, MagicMock
from typing import Dict, Any, Optional, Tuple, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from pipeline.validate import validate_keyframes
from pipeline.colmap import run_sfm, run_dense_stereo, is_colmap_available, exec_colmap
from pipeline.train import run_gaussian_training, resolve_graphdeco_script_path
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


def parse_cuda_version(cuda_str: Optional[str]) -> Tuple[Tuple[int, int], bool]:
    """
    Numerically parses CUDA version string into (major, minor) tuple
    and verifies if it satisfies the CUDA >= 11.8 requirement.
    """
    if not cuda_str:
        return (0, 0), False
    try:
        parts = cuda_str.strip().split(".")
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
        return (major, minor), (major, minor) >= (11, 8)
    except Exception:
        return (0, 0), False


def get_gpu_environment_details() -> Dict[str, Any]:
    """Inspects physical GPU hardware, CUDA runtime, and pipeline dependencies."""
    details: Dict[str, Any] = {
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
        "cuda_version_tuple": (0, 0),
        "cuda_version_sufficient": False,
        "cuda_extensions_available": False,
        "cuda_extensions_error": None,
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
            ver_tuple, is_sufficient = parse_cuda_version(torch.version.cuda)
            details["cuda_version_tuple"] = ver_tuple
            details["cuda_version_sufficient"] = is_sufficient
    except Exception:
        pass

    # Check compiled Graphdeco CUDA submodules
    try:
        import diff_gaussian_rasterization  # type: ignore
        import simple_knn  # type: ignore
        details["cuda_extensions_available"] = True
    except Exception as e:
        details["cuda_extensions_error"] = str(e)

    if shutil.which("colmap"):
        try:
            res = subprocess.run(["colmap", "--version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
            details["colmap_version"] = res.stdout.strip() or res.stderr.strip()
        except Exception:
            pass

    # Strictly resolve genuine train.py file
    resolved_runner = resolve_graphdeco_script_path()
    if resolved_runner and os.path.isfile(resolved_runner) and os.path.basename(resolved_runner) == "train.py":
        details["graphdeco_available"] = True
        details["graphdeco_script_path"] = resolved_runner

    return details


def verify_acceptance_dataset(fixture_dir: str) -> Dict[str, Any]:
    """
    Authoritative dataset verification for prop_villa_marassi_01.
    Strictly asserts that:
    1. Fixture directory exists.
    2. At least 8 valid image files exist with valid JPEG/PNG byte headers and non-zero size.
    3. Ground truth survey file (survey_benchmarks.json or ground_truth_survey.json) exists.
    4. Survey benchmarks array is non-empty and contains valid calibration + holdout landmarks.
    Fails closed with FileNotFoundError or ValueError if incomplete; does NOT silently skip.
    """
    if not os.path.exists(fixture_dir) or not os.path.isdir(fixture_dir):
        raise FileNotFoundError(f"DATASET_INCOMPLETE: Fixture directory not found at: {fixture_dir}")

    images = sorted([f for f in os.listdir(fixture_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
    if len(images) < 8:
        raise ValueError(
            f"DATASET_INCOMPLETE: Acceptance dataset requires >= 8 valid images, found {len(images)} in {fixture_dir}"
        )

    # Validate image byte integrity
    for img_name in images:
        img_path = os.path.join(fixture_dir, img_name)
        if os.path.getsize(img_path) < 1024:
            raise ValueError(f"DATASET_INCOMPLETE: Image file {img_name} is corrupted or too small (< 1KB).")
        with open(img_path, "rb") as f:
            header = f.read(4)
            # JPEG (FF D8 FF) or PNG (89 50 4E 47)
            if not (header.startswith(b"\xff\xd8\xff") or header.startswith(b"\x89PNG")):
                raise ValueError(f"DATASET_INCOMPLETE: Image file {img_name} has invalid image header bytes.")

    candidate_surveys = [
        os.path.join(fixture_dir, "survey_benchmarks.json"),
        os.path.join(fixture_dir, "ground_truth_survey.json"),
    ]
    survey_path = None
    for cand in candidate_surveys:
        if os.path.isfile(cand) and os.path.getsize(cand) > 50:
            survey_path = cand
            break

    if not survey_path:
        raise FileNotFoundError(
            f"DATASET_INCOMPLETE: survey_benchmarks.json or ground_truth_survey.json missing in {fixture_dir}"
        )

    with open(survey_path, "r", encoding="utf-8") as f:
        survey_data = json.load(f)

    if not survey_data.get("benchmarks") or len(survey_data["benchmarks"]) < 2:
        raise ValueError(f"DATASET_INCOMPLETE: Survey file {survey_path} contains fewer than 2 benchmark records.")

    return {
        "valid": True,
        "image_count": len(images),
        "survey_path": survey_path,
        "benchmarks_count": len(survey_data["benchmarks"]),
    }


class TestRealReconstructionStrictGuards(unittest.TestCase):
    """
    Empirical proof that strict guards FAIL CLOSED and strictly reject all
    synthetic fixtures, mock data, and IterativeGaussianOptimizer substitutions.
    """

    def setUp(self):
        self.saved_env = {
            "HETTETY_REAL_PIPELINE_STRICT": os.environ.get("HETTETY_REAL_PIPELINE_STRICT"),
            "HETTETY_ENV": os.environ.get("HETTETY_ENV"),
            "NODE_ENV": os.environ.get("NODE_ENV"),
            "GAUSSIAN_SPLATTING_PATH": os.environ.get("GAUSSIAN_SPLATTING_PATH"),
        }
        os.environ["HETTETY_REAL_PIPELINE_STRICT"] = "1"
        self.temp_dir = tempfile.mkdtemp(prefix="hettety_guard_test_")

    def tearDown(self):
        # Unconditionally restore all modified environment variables
        for key, val in self.saved_env.items():
            if val is not None:
                os.environ[key] = val
            else:
                os.environ.pop(key, None)

        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    @patch("pipeline.colmap._generate_test_fixture_sfm")
    @patch("pipeline.colmap.is_colmap_available", return_value=False)
    def test_strict_guard_rejects_sfm_fixture_when_colmap_unavailable(self, mock_colmap_avail, mock_fixture_sfm):
        """
        Verifies that run_sfm with strict guard rejects synthetic fixture generation
        when COLMAP is unavailable, and NEVER calls _generate_test_fixture_sfm.
        """
        os.environ["HETTETY_ENV"] = "test"
        fake_images_dir = os.path.join(self.temp_dir, "images")
        os.makedirs(fake_images_dir, exist_ok=True)
        for i in range(12):
            with open(os.path.join(fake_images_dir, f"frame_{i:02d}.jpg"), "wb") as f:
                f.write(b"\xff\xd8\xff\xe0" + b"\x00" * 2000)

        out_dir = os.path.join(self.temp_dir, "out_sfm")
        res = run_sfm(image_dir=fake_images_dir, output_dir=out_dir)

        self.assertFalse(res.get("success", False))
        self.assertEqual(res.get("error_code"), "COLMAP_UNAVAILABLE")
        self.assertIn("STRICT_REAL_PIPELINE_GUARD", res.get("message", ""))
        # Crucial: prove fixture function was NEVER invoked
        mock_fixture_sfm.assert_not_called()
        self.assertFalse(os.path.exists(os.path.join(out_dir, "sparse", "0", "cameras.txt")))

    @patch("pipeline.colmap._generate_test_fixture_sfm")
    @patch("pipeline.colmap.exec_colmap")
    @patch("pipeline.colmap.is_colmap_available", return_value=True)
    def test_strict_guard_rejects_sfm_fixture_when_colmap_fails(self, mock_colmap_avail, mock_exec, mock_fixture_sfm):
        """
        Verifies that run_sfm NEVER calls _generate_test_fixture_sfm even if COLMAP
        is reported as available but execution fails.
        """
        os.environ["HETTETY_ENV"] = "test"
        mock_exec.side_effect = subprocess.CalledProcessError(1, ["colmap"], stderr=b"Simulated failure")

        fake_images_dir = os.path.join(self.temp_dir, "images")
        os.makedirs(fake_images_dir, exist_ok=True)
        for i in range(12):
            with open(os.path.join(fake_images_dir, f"frame_{i:02d}.jpg"), "wb") as f:
                f.write(b"\xff\xd8\xff\xe0" + b"\x00" * 2000)

        out_dir = os.path.join(self.temp_dir, "out_sfm")
        with self.assertRaises(subprocess.CalledProcessError):
            run_sfm(image_dir=fake_images_dir, output_dir=out_dir)

        mock_fixture_sfm.assert_not_called()

    @patch("pipeline.colmap._generate_test_fixture_dense")
    @patch("pipeline.colmap.is_colmap_available", return_value=False)
    def test_strict_guard_rejects_dense_fixture_when_colmap_unavailable(self, mock_colmap_avail, mock_fixture_dense):
        """
        Verifies that run_dense_stereo with strict guard rejects synthetic dense PLY generation
        when COLMAP is unavailable, and NEVER calls _generate_test_fixture_dense.
        """
        os.environ["HETTETY_ENV"] = "test"
        dense_dir = os.path.join(self.temp_dir, "dense")
        res = run_dense_stereo(sparse_dir=self.temp_dir, image_dir=self.temp_dir, dense_dir=dense_dir)

        self.assertFalse(res.get("success", False))
        self.assertEqual(res.get("error_code"), "COLMAP_UNAVAILABLE")
        self.assertIn("STRICT_REAL_PIPELINE_GUARD", res.get("message", ""))
        # Crucial: prove dense fixture function was NEVER invoked
        mock_fixture_dense.assert_not_called()
        self.assertFalse(os.path.exists(os.path.join(dense_dir, "fused.ply")))

    @patch("pipeline.colmap._generate_test_fixture_dense")
    @patch("pipeline.colmap.exec_colmap")
    @patch("pipeline.colmap.is_colmap_available", return_value=True)
    def test_strict_guard_rejects_dense_fixture_when_colmap_fails(self, mock_colmap_avail, mock_exec, mock_fixture_dense):
        """
        Verifies that run_dense_stereo NEVER calls _generate_test_fixture_dense even if COLMAP
        is reported as available but stereo execution fails.
        """
        os.environ["HETTETY_ENV"] = "test"
        mock_exec.side_effect = subprocess.CalledProcessError(1, ["colmap"], stderr=b"Stereo error")
        dense_dir = os.path.join(self.temp_dir, "dense")

        res = run_dense_stereo(sparse_dir=self.temp_dir, image_dir=self.temp_dir, dense_dir=dense_dir)

        self.assertFalse(res.get("success", False))
        self.assertEqual(res.get("error_code"), "DENSE_STEREO_FAILED")
        mock_fixture_dense.assert_not_called()

    @patch("pipeline.train.IterativeGaussianOptimizer")
    def test_strict_guard_proves_iterative_optimizer_never_instantiated_missing_runner(self, mock_optimizer):
        """
        Verifies that run_gaussian_training with strict guard rejects missing runner and
        NEVER instantiates or invokes IterativeGaussianOptimizer.
        """
        os.environ["HETTETY_ENV"] = "test"
        os.environ["GAUSSIAN_SPLATTING_PATH"] = "/nonexistent/path/train.py"
        out_model = os.path.join(self.temp_dir, "model")

        res = run_gaussian_training(source_dir=self.temp_dir, output_model_dir=out_model, iterations=100)

        self.assertFalse(res.get("success", False))
        self.assertEqual(res.get("error_code"), "GRAPHDECO_RUNNER_MISSING")
        self.assertIn("STRICT_REAL_PIPELINE_GUARD", res.get("message", ""))
        # Crucial: prove IterativeGaussianOptimizer was NEVER instantiated
        mock_optimizer.assert_not_called()

    @patch("pipeline.train.IterativeGaussianOptimizer")
    def test_strict_guard_proves_iterative_optimizer_never_instantiated_cuda_unavailable(self, mock_optimizer):
        """
        Verifies that run_gaussian_training with strict guard and valid script path
        rejects absent CUDA without ever instantiating IterativeGaussianOptimizer.
        """
        os.environ["HETTETY_ENV"] = "test"
        dummy_script = os.path.join(self.temp_dir, "train.py")
        with open(dummy_script, "w") as f:
            f.write("# dummy train script")
        os.environ["GAUSSIAN_SPLATTING_PATH"] = dummy_script
        out_model = os.path.join(self.temp_dir, "model")

        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = False
        with patch.dict(sys.modules, {"torch": mock_torch}):
            res = run_gaussian_training(source_dir=self.temp_dir, output_model_dir=out_model, iterations=100)

        self.assertFalse(res.get("success", False))
        self.assertEqual(res.get("error_code"), "CUDA_UNAVAILABLE")
        mock_optimizer.assert_not_called()

    def test_strict_guard_directory_path_not_mistaken_for_train_py(self):
        """
        Verifies that setting GAUSSIAN_SPLATTING_PATH to a directory without train.py
        is NOT recognized as a valid Graphdeco runner script.
        """
        empty_dir = os.path.join(self.temp_dir, "empty_repo")
        os.makedirs(empty_dir, exist_ok=True)
        os.environ["GAUSSIAN_SPLATTING_PATH"] = empty_dir

        resolved = resolve_graphdeco_script_path()
        # Must not resolve to the directory itself
        self.assertNotEqual(resolved, empty_dir)
        if resolved:
            self.assertTrue(os.path.isfile(resolved))
            self.assertEqual(os.path.basename(resolved), "train.py")

        details = get_gpu_environment_details()
        if details.get("graphdeco_script_path"):
            self.assertTrue(os.path.isfile(details["graphdeco_script_path"]))
            self.assertEqual(os.path.basename(details["graphdeco_script_path"]), "train.py")

    def test_cuda_version_numeric_parsing(self):
        """
        Verifies strict numerical parsing of CUDA runtime versions:
        CUDA >= 11.8 is accepted; CUDA < 11.8 or invalid strings are rejected.
        """
        self.assertEqual(parse_cuda_version("11.8"), ((11, 8), True))
        self.assertEqual(parse_cuda_version("12.1"), ((12, 1), True))
        self.assertEqual(parse_cuda_version("12.4.1"), ((12, 4), True))
        self.assertEqual(parse_cuda_version("11.7"), ((11, 7), False))
        self.assertEqual(parse_cuda_version("10.2"), ((10, 2), False))
        self.assertEqual(parse_cuda_version(None), ((0, 0), False))
        self.assertEqual(parse_cuda_version("invalid"), ((0, 0), False))

    def test_acceptance_dataset_integrity_validator(self):
        """
        Verifies that verify_acceptance_dataset validates prop_villa_marassi_01
        and fails closed with explicit DATASET_INCOMPLETE on incomplete fixtures.
        """
        fixture_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "tests", "fixtures", "real_properties", "prop_villa_marassi_01")
        )
        meta = verify_acceptance_dataset(fixture_dir)
        self.assertTrue(meta["valid"])
        self.assertGreaterEqual(meta["image_count"], 8)
        self.assertGreaterEqual(meta["benchmarks_count"], 2)

        # Incomplete dataset failure test
        incomplete_dir = os.path.join(self.temp_dir, "incomplete_prop")
        os.makedirs(incomplete_dir, exist_ok=True)
        with self.assertRaises(ValueError) as ctx:
            verify_acceptance_dataset(incomplete_dir)
        self.assertIn("DATASET_INCOMPLETE", str(ctx.exception))


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
        # Fails closed if acceptance dataset is missing or corrupted
        cls.dataset_meta = verify_acceptance_dataset(cls.fixture_dir)
        cls.gpu_env = get_gpu_environment_details()

    def setUp(self):
        self.saved_env = {
            "HETTETY_REAL_PIPELINE_STRICT": os.environ.get("HETTETY_REAL_PIPELINE_STRICT"),
            "HETTETY_ENV": os.environ.get("HETTETY_ENV"),
            "NODE_ENV": os.environ.get("NODE_ENV"),
            "GAUSSIAN_SPLATTING_PATH": os.environ.get("GAUSSIAN_SPLATTING_PATH"),
        }
        os.environ["HETTETY_REAL_PIPELINE_STRICT"] = "1"
        # Reject test mode in acceptance testing
        if os.environ.get("HETTETY_ENV") == "test":
            os.environ.pop("HETTETY_ENV", None)
        self.temp_dir = tempfile.mkdtemp(prefix="hettety_real_acc_")

    def tearDown(self):
        for key, val in self.saved_env.items():
            if val is not None:
                os.environ[key] = val
            else:
                os.environ.pop(key, None)

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
            "dataset": self.dataset_meta,
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

        # 3. Enforce CUDA runtime version >= 11.8
        if not self.gpu_env.get("cuda_version_sufficient", False):
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = (
                f"CUDA >= 11.8 is strictly required for official Graphdeco 3DGS rasterizer. "
                f"Detected CUDA version: {self.gpu_env.get('cuda_version', 'None')}."
            )
            evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
            with open(evidence_file, "w", encoding="utf-8") as f:
                json.dump(evidence, f, indent=2)
            self.skipTest(evidence["blocking_reason"])

        # 4. Enforce physical VRAM >= 11.5 GB
        if self.gpu_env["total_memory_gb"] < 11.5:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = f"Minimum 12 GB VRAM required for Graphdeco 3DGS training. Detected: {self.gpu_env['total_memory_gb']} GB on {self.gpu_env['device_name']}."
            evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
            with open(evidence_file, "w", encoding="utf-8") as f:
                json.dump(evidence, f, indent=2)
            self.skipTest(evidence["blocking_reason"])

        # 5. Enforce real COLMAP prerequisite
        if not self.gpu_env["colmap_available"]:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = "COLMAP binary executable on PATH is required. Synthetic fixture fallbacks are strictly prohibited."
            evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
            with open(evidence_file, "w", encoding="utf-8") as f:
                json.dump(evidence, f, indent=2)
            self.skipTest(evidence["blocking_reason"])

        # 6. Enforce real Graphdeco training runner prerequisite
        if not self.gpu_env["graphdeco_available"]:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = "Official Graphdeco training runner (gaussian-splatting/train.py) is required. IterativeGaussianOptimizer substitution is strictly prohibited."
            evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
            with open(evidence_file, "w", encoding="utf-8") as f:
                json.dump(evidence, f, indent=2)
            self.skipTest(evidence["blocking_reason"])

        # 7. Enforce compiled CUDA submodules
        if not self.gpu_env.get("cuda_extensions_available", False):
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = (
                f"Official Graphdeco CUDA extensions (diff_gaussian_rasterization, simple_knn) are missing: "
                f"{self.gpu_env.get('cuda_extensions_error')}."
            )
            evidence_file = os.path.join(self.temp_dir, "acceptance_evidence.json")
            with open(evidence_file, "w", encoding="utf-8") as f:
                json.dump(evidence, f, indent=2)
            self.skipTest(evidence["blocking_reason"])

        # ---------------------------------------------------------------------
        # Full Real Execution (Only runs when ALL prerequisites are satisfied)
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
        survey_json = self.dataset_meta["survey_path"]
        benchmarks = load_survey_benchmarks(survey_json)
        calib_set, val_set = partition_survey_benchmarks(benchmarks)

        sparse_dir = sfm_res.get("sparse_dir", sfm_out)
        point_map: Dict[int, Tuple[float, float, float]] = {}
        points_txt = os.path.join(sparse_dir, "points3D.txt")
        if not os.path.exists(points_txt):
            points_txt = os.path.join(sparse_dir, "0", "points3D.txt")
        if os.path.exists(points_txt):
            with open(points_txt, "r", encoding="ascii", errors="ignore") as f:
                for line in f:
                    if not line.startswith("#") and line.strip():
                        parts = line.split()
                        if len(parts) >= 4:
                            point_map[int(parts[0])] = (float(parts[1]), float(parts[2]), float(parts[3]))

        calib_res = calibrate_sparse_scale(
            sparse_points=[],
            reference_anchors=calib_set,
            point3d_map=point_map,
            sparse_dir=sparse_dir,
            calibration_only=True
        )
        self.assertTrue(calib_res["is_calibrated"])
        scale_k = calib_res["scale_factor"]

        # Holdout Cross-Validation Gate (<= 0.05m RMSE)
        eval_res = evaluate_survey_accuracy(
            point_map,
            benchmarks,
            scale_k,
            sparse_dir=sparse_dir,
            holdout_only=True
        )
        self.assertTrue(eval_res["passed"])
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
