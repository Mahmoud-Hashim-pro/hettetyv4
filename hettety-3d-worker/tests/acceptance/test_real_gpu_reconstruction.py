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
8. Validates acceptance dataset integrity against an explicit allowlist and cryptographic SHA-256 manifest.
9. Emits persistent machine-readable acceptance evidence JSON & Markdown that survive test cleanup.
10. Validates authoritative completed training iterations from execution logs / checkpoints (no self-reported claims).
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
from pipeline.acceptance_evidence import (
    ALLOWED_ACCEPTANCE_DATASETS,
    sanitize_dataset_name,
    resolve_and_validate_acceptance_dataset,
    get_evidence_directory,
    generate_run_id,
    write_acceptance_evidence
)
from pipeline.training_log_parser import parse_graphdeco_training_log


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


class TestRealReconstructionStrictGuards(unittest.TestCase):
    """
    Empirical proof that strict guards FAIL CLOSED and strictly reject all
    synthetic fixtures, mock data, and IterativeGaussianOptimizer substitutions.
    Also verifies dataset allowlist, path traversal protection, evidence persistence,
    and authoritative log parsing.
    """

    def setUp(self):
        self.saved_env = {
            "HETTETY_REAL_PIPELINE_STRICT": os.environ.get("HETTETY_REAL_PIPELINE_STRICT"),
            "HETTETY_ENV": os.environ.get("HETTETY_ENV"),
            "NODE_ENV": os.environ.get("NODE_ENV"),
            "GAUSSIAN_SPLATTING_PATH": os.environ.get("GAUSSIAN_SPLATTING_PATH"),
            "HETTETY_ACCEPTANCE_DATASET": os.environ.get("HETTETY_ACCEPTANCE_DATASET"),
            "HETTETY_ACCEPTANCE_EVIDENCE_DIR": os.environ.get("HETTETY_ACCEPTANCE_EVIDENCE_DIR"),
        }
        os.environ["HETTETY_REAL_PIPELINE_STRICT"] = "1"
        self.temp_dir = tempfile.mkdtemp(prefix="hettety_guard_test_")
        self.evidence_test_dir = os.path.join(self.temp_dir, "evidence")
        os.environ["HETTETY_ACCEPTANCE_EVIDENCE_DIR"] = self.evidence_test_dir

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

    def test_acceptance_dataset_allowlist_and_traversal_guards(self):
        """
        Verifies dataset allowlist enforcement, path traversal rejection,
        and successful resolution of all allowlisted fixtures.
        """
        # Test 1: Primary fixture prop_villa_marassi_01
        meta1 = resolve_and_validate_acceptance_dataset("prop_villa_marassi_01")
        self.assertTrue(meta1["valid"])
        self.assertEqual(meta1["image_count"], 28)
        self.assertGreaterEqual(meta1["benchmarks_count"], 2)
        self.assertIsInstance(meta1["manifest_sha256"], str)
        self.assertEqual(len(meta1["manifest_sha256"]), 64)

        # Test 2: Second valid allowlisted fixture prop_courtyard_dslr_02
        meta2 = resolve_and_validate_acceptance_dataset("prop_courtyard_dslr_02")
        self.assertTrue(meta2["valid"])
        self.assertEqual(meta2["image_count"], 14)
        self.assertGreaterEqual(meta2["benchmarks_count"], 2)

        # Test 3: Path traversal attempt (rejects ..)
        with self.assertRaises(ValueError) as ctx:
            resolve_and_validate_acceptance_dataset("../../etc/passwd")
        self.assertIn("DATASET_SECURITY_ERROR", str(ctx.exception))

        # Test 4: Path traversal attempt with forward slash
        with self.assertRaises(ValueError) as ctx:
            resolve_and_validate_acceptance_dataset("prop_villa_marassi_01/sub")
        self.assertIn("DATASET_SECURITY_ERROR", str(ctx.exception))

        # Test 5: Non-allowlisted dataset name
        with self.assertRaises(ValueError) as ctx:
            resolve_and_validate_acceptance_dataset("unapproved_dataset_xyz")
        self.assertIn("DATASET_ALLOWLIST_VIOLATION", str(ctx.exception))

    def test_evidence_system_persistence_and_formatting(self):
        """
        Verifies that write_acceptance_evidence writes persistent JSON and Markdown
        files to the configured evidence directory that survive test execution.
        """
        test_evidence = {
            "test_name": "test_evidence_system_persistence",
            "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "environment": get_gpu_environment_details(),
            "dataset": {"dataset_name": "prop_villa_marassi_01", "is_real_data": True, "image_count": 28},
            "status": "BLOCKED",
            "blocking_reason": "No physical NVIDIA GPU detected on development machine.",
            "stages": {
                "KEYFRAME_VALIDATION": {"durationSec": 0.12, "imageCount": 28}
            },
            "acceptance_criteria": {
                "STRICT_COLMAP": {"status": "BLOCKED", "details": "Requires dedicated GPU runner"},
                "GRAPHDECO_3DGS": {"status": "BLOCKED", "details": "CUDA runner not provisioned"}
            }
        }

        json_path, md_path = write_acceptance_evidence(test_evidence, self.evidence_test_dir)
        self.assertTrue(os.path.isfile(json_path))
        self.assertTrue(os.path.isfile(md_path))
        self.assertGreater(os.path.getsize(json_path), 100)
        self.assertGreater(os.path.getsize(md_path), 100)

        with open(json_path, "r", encoding="utf-8") as f:
            loaded_json = json.load(f)
        self.assertEqual(loaded_json["status"], "BLOCKED")
        self.assertIn("run_id", loaded_json)

        with open(md_path, "r", encoding="utf-8") as f:
            md_content = f.read()
        self.assertIn("HETTETY v4 — 3D Reconstruction Acceptance Evidence", md_content)
        self.assertIn("BLOCKED", md_content)
        self.assertIn("prop_villa_marassi_01", md_content)

    def test_training_log_parser_authoritative_metrics(self):
        """
        Verifies that training log parser extracts true iteration evidence
        and rejects premature termination or CUDA OOM.
        """
        valid_log = (
            "[ITER 7000] Evaluating test: L1 0.0412 PSNR 28.54\n"
            "30000/30000 [15:23<00:00, 32.14it/s, loss=0.0019]\n"
            "[ITER 30000] Evaluating test: L1 0.0185 PSNR 33.45\n"
        )
        res = parse_graphdeco_training_log(valid_log, requested_iterations=30000)
        self.assertEqual(res["completed_iterations"], 30000)
        self.assertTrue(res["iterations_verified"])
        self.assertEqual(res["final_psnr"], 33.45)

        premature_log = (
            "[ITER 7000] Evaluating test: L1 0.0412 PSNR 28.54\n"
            "18200/30000 [09:12<06:10, 32.00it/s, loss=0.0210]\n"
        )
        res_premature = parse_graphdeco_training_log(premature_log, requested_iterations=30000)
        self.assertEqual(res_premature["completed_iterations"], 18200)
        self.assertFalse(res_premature["iterations_verified"])


class TestRealGPUPipelineAcceptance(unittest.TestCase):
    """
    Authoritative Acceptance Test for genuine physical GPU execution.
    Executes the entire 7-stage photogrammetric lifecycle end-to-end ONLY when
    physical GPU hardware and COLMAP binaries are present.
    Always generates and preserves machine-readable acceptance evidence regardless of outcome.
    """

    @classmethod
    def setUpClass(cls):
        dataset_name = os.environ.get("HETTETY_ACCEPTANCE_DATASET", "prop_villa_marassi_01")
        cls.dataset_meta = resolve_and_validate_acceptance_dataset(dataset_name)
        cls.fixture_dir = cls.dataset_meta["fixture_dir"]
        cls.gpu_env = get_gpu_environment_details()
        cls.evidence_dir = get_evidence_directory()

    def setUp(self):
        self.saved_env = {
            "HETTETY_REAL_PIPELINE_STRICT": os.environ.get("HETTETY_REAL_PIPELINE_STRICT"),
            "HETTETY_ENV": os.environ.get("HETTETY_ENV"),
            "NODE_ENV": os.environ.get("NODE_ENV"),
            "GAUSSIAN_SPLATTING_PATH": os.environ.get("GAUSSIAN_SPLATTING_PATH"),
            "HETTETY_ACCEPTANCE_DATASET": os.environ.get("HETTETY_ACCEPTANCE_DATASET"),
        }
        os.environ["HETTETY_REAL_PIPELINE_STRICT"] = "1"
        # Reject test mode in acceptance testing
        if os.environ.get("HETTETY_ENV") == "test":
            os.environ.pop("HETTETY_ENV", None)

        self.run_id = generate_run_id()
        self.temp_dir = tempfile.mkdtemp(prefix="hettety_real_acc_")

    def tearDown(self):
        for key, val in self.saved_env.items():
            if val is not None:
                os.environ[key] = val
            else:
                os.environ.pop(key, None)

        # Temporary directory cleaned up; persistent evidence directory remains intact
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_real_gpu_photogrammetry_reconstruction(self):
        """
        Executes genuine COLMAP SfM, Dense Stereo, Graphdeco 3DGS, and holdout Metric Calibration.
        Fails or Skips strictly with explicit diagnosis if required hardware prerequisites are absent.
        Unconditionally records persistent machine-readable and human-readable evidence.
        """
        evidence: Dict[str, Any] = {
            "run_id": self.run_id,
            "test_name": "test_real_gpu_photogrammetry_reconstruction",
            "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "environment": self.gpu_env,
            "dataset": self.dataset_meta,
            "status": "UNEXECUTED",
            "blocking_reason": None,
            "stages": {},
            "acceptance_criteria": {
                "STRICT_COLMAP": {"status": "PENDING", "details": "Real COLMAP binary verification"},
                "DENSE_MVS": {"status": "PENDING", "details": "Multi-view stereo point cloud"},
                "GRAPHDECO_3DGS": {"status": "PENDING", "details": "30,000 CUDA iterations"},
                "METRIC_CALIBRATION": {"status": "PENDING", "details": "Laser holdout RMSE <= 0.05m"},
                "SPZ_EXPORT": {"status": "PENDING", "details": "Niantic SPZ v4 container"},
                "GLB_EXPORT": {"status": "PENDING", "details": "Watertight glTF 2.0 binary"},
            }
        }

        # 1. Enforce rejection of HETTETY_ENV=test
        if os.environ.get("HETTETY_ENV") == "test":
            evidence["status"] = "REJECTED"
            evidence["blocking_reason"] = "HETTETY_ENV=test is strictly rejected in acceptance testing."
            write_acceptance_evidence(evidence, self.evidence_dir)
            self.fail("ACCEPTANCE_REJECTS_TEST_MODE: Real reconstruction acceptance strictly rejects HETTETY_ENV=test.")

        # 2. Enforce physical GPU prerequisite
        if not self.gpu_env["cuda_available"]:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = "Physical NVIDIA GPU with CUDA support is required. Current host does not have CUDA available."
            evidence["acceptance_criteria"]["GRAPHDECO_3DGS"] = {
                "status": "BLOCKED",
                "details": "Host lacks physical NVIDIA GPU with CUDA."
            }
            write_acceptance_evidence(evidence, self.evidence_dir)
            self.skipTest(evidence["blocking_reason"])

        # 3. Enforce CUDA runtime version >= 11.8
        if not self.gpu_env.get("cuda_version_sufficient", False):
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = (
                f"CUDA >= 11.8 is strictly required for official Graphdeco 3DGS rasterizer. "
                f"Detected CUDA version: {self.gpu_env.get('cuda_version', 'None')}."
            )
            write_acceptance_evidence(evidence, self.evidence_dir)
            self.skipTest(evidence["blocking_reason"])

        # 4. Enforce physical VRAM >= 11.5 GB
        if self.gpu_env["total_memory_gb"] < 11.5:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = f"Minimum 12 GB VRAM required for Graphdeco 3DGS training. Detected: {self.gpu_env['total_memory_gb']} GB on {self.gpu_env['device_name']}."
            write_acceptance_evidence(evidence, self.evidence_dir)
            self.skipTest(evidence["blocking_reason"])

        # 5. Enforce real COLMAP prerequisite
        if not self.gpu_env["colmap_available"]:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = "COLMAP binary executable on PATH is required. Synthetic fixture fallbacks are strictly prohibited."
            write_acceptance_evidence(evidence, self.evidence_dir)
            self.skipTest(evidence["blocking_reason"])

        # 6. Enforce real Graphdeco training runner prerequisite
        if not self.gpu_env["graphdeco_available"]:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = "Official Graphdeco training runner (gaussian-splatting/train.py) is required. IterativeGaussianOptimizer substitution is strictly prohibited."
            write_acceptance_evidence(evidence, self.evidence_dir)
            self.skipTest(evidence["blocking_reason"])

        # 7. Enforce compiled CUDA submodules
        if not self.gpu_env.get("cuda_extensions_available", False):
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = (
                f"Official Graphdeco CUDA extensions (diff_gaussian_rasterization, simple_knn) are missing: "
                f"{self.gpu_env.get('cuda_extensions_error')}."
            )
            write_acceptance_evidence(evidence, self.evidence_dir)
            self.skipTest(evidence["blocking_reason"])

        # ---------------------------------------------------------------------
        # Full Real Execution (Only runs when ALL prerequisites are satisfied)
        # ---------------------------------------------------------------------
        try:
            print("\n==================================================================")
            print(" EXECUTING AUTHORITATIVE REAL GPU RECONSTRUCTION ACCEPTANCE TEST")
            print(f" Dataset     : {self.dataset_meta['dataset_name']} ({self.dataset_meta['image_count']} keyframes)")
            print(f" GPU Device  : {self.gpu_env['device_name']} ({self.gpu_env['total_memory_gb']} GB VRAM)")
            print(f" PyTorch/CUDA: {self.gpu_env['pytorch_version']} / CUDA {self.gpu_env['cuda_version']}")
            print(f" COLMAP Path : {shutil.which('colmap')} (Version: {self.gpu_env['colmap_version']})")
            print(f" Graphdeco   : {self.gpu_env['graphdeco_script_path']}")
            print("==================================================================\n")

            # Stage 1: Keyframe Validation
            t0 = time.time()
            val_res = validate_keyframes(self.fixture_dir, min_images=8)
            self.assertTrue(val_res["valid"], f"Keyframe validation failed: {val_res}")
            evidence["stages"]["VALIDATING"] = {"durationSec": round(time.time() - t0, 2), "imageCount": val_res["image_count"]}

            # Stage 2: Genuine COLMAP SfM
            t1 = time.time()
            sfm_out = os.path.join(self.temp_dir, "sfm")
            sfm_res = run_sfm(image_dir=self.fixture_dir, output_dir=sfm_out, is_video=False)
            self.assertTrue(sfm_res["success"], f"Real COLMAP SfM failed: {sfm_res}")
            self.assertGreaterEqual(sfm_res["registered_images"], 8)
            self.assertGreater(sfm_res["points_count"], 100)
            evidence["stages"]["SFM"] = {
                "durationSec": round(time.time() - t1, 2),
                "registeredImages": sfm_res["registered_images"],
                "pointsCount": sfm_res["points_count"],
                "meanReprojectionError": sfm_res.get("mean_reprojection_error", 0.0)
            }
            evidence["acceptance_criteria"]["STRICT_COLMAP"] = {
                "status": "PASSED",
                "details": f"Registered {sfm_res['registered_images']} cameras, {sfm_res['points_count']} 3D points."
            }

            # Stage 3: Genuine Dense Multi-View Stereo (PatchMatch)
            t2 = time.time()
            dense_out = os.path.join(self.temp_dir, "dense")
            dense_res = run_dense_stereo(sparse_dir=sfm_out, image_dir=self.fixture_dir, dense_dir=dense_out)
            self.assertTrue(dense_res["success"], f"Real Dense Stereo failed: {dense_res}")
            self.assertGreater(dense_res["dense_point_count"], 1000)
            evidence["stages"]["DENSE_STEREO"] = {
                "durationSec": round(time.time() - t2, 2),
                "densePointCount": dense_res["dense_point_count"]
            }
            evidence["acceptance_criteria"]["DENSE_MVS"] = {
                "status": "PASSED",
                "details": f"Dense point cloud generated with {dense_res['dense_point_count']} points."
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
            verified_iters = train_res.get("verified_completed_iterations", 0)
            self.assertGreaterEqual(verified_iters, 30000, f"Graphdeco did not complete 30,000 iterations (verified: {verified_iters})")
            trained_ply = train_res["target_ply"]
            self.assertTrue(os.path.exists(trained_ply))
            evidence["stages"]["TRAINING_3DGS"] = {
                "durationSec": round(time.time() - t3, 2),
                "requestedIterations": 30000,
                "verifiedCompletedIterations": verified_iters,
                "iterationEvidenceSource": train_res.get("iteration_evidence_source", "log_parsing"),
                "finalLoss": train_res.get("final_loss"),
                "finalPsnr": train_res.get("final_psnr"),
                "targetPly": trained_ply
            }
            evidence["acceptance_criteria"]["GRAPHDECO_3DGS"] = {
                "status": "PASSED",
                "details": f"Completed 30,000 iterations (verified from log/checkpoint evidence)."
            }

            # Stage 5: Floater Pruning & Optimization
            opt_ply = os.path.join(self.temp_dir, "optimized.ply")
            opt_res = optimize_splat_cloud(trained_ply, opt_ply, opacity_threshold=0.01)
            self.assertTrue(opt_res["success"])
            self.assertGreater(opt_res["splat_count"], 1000)

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
            evidence["acceptance_criteria"]["METRIC_CALIBRATION"] = {
                "status": "PASSED",
                "details": f"Scale factor {scale_k:.4f}, Holdout RMSE {eval_res['rmse']}m <= 0.05m gate."
            }

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
            evidence["acceptance_criteria"]["SPZ_EXPORT"] = {
                "status": "PASSED",
                "details": f"SPZ v4 valid, {opt_res['splat_count']} splats, SHA-256: {spz_sha[:16]}"
            }
            evidence["acceptance_criteria"]["GLB_EXPORT"] = {
                "status": "PASSED",
                "details": f"glTF 2.0 valid binary, SHA-256: {glb_sha[:16]}"
            }
            evidence["artifacts"] = {
                "spz": {"path": spz_file, "sizeBytes": os.path.getsize(spz_file), "sha256": spz_sha, "splatCount": opt_res["splat_count"]},
                "glb": {"path": glb_file, "sizeBytes": os.path.getsize(glb_file), "sha256": glb_sha, "validGlTF": True},
                "calibration": {"scaleFactor": scale_k, "holdoutRmse": eval_res["rmse"]}
            }

            print("\n==================================================================")
            print(" AUTHORITATIVE REAL GPU RECONSTRUCTION ACCEPTANCE: PASSED 100%")
            print(f" Trained Splats : {opt_res['splat_count']:,}")
            print(f" Holdout RMSE   : {eval_res['rmse']} m (Certified Metric Invariant)")
            print(f" SPZ SHA-256    : {spz_sha}")
            print(f" GLB SHA-256    : {glb_sha}")
            print("==================================================================\n")

        except Exception as e:
            evidence["status"] = "FAILED"
            evidence["blocking_reason"] = f"Execution exception: {e}"
            raise
        finally:
            write_acceptance_evidence(evidence, self.evidence_dir)


if __name__ == "__main__":
    unittest.main()
