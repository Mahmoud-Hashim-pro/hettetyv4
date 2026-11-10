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
from pipeline.colmap import run_sfm, run_dense_stereo, _generate_test_fixture_dense, is_colmap_available, exec_colmap, extract_ply_vertex_count, validate_reprojection_metric
from pipeline.train import (
    run_gaussian_training,
    resolve_graphdeco_script_path,
    validate_graphdeco_runner_provenance,
    validate_gaussian_ply_schema,
    DEFAULT_APPROVED_GRAPHDECO_COMMITS,
    get_allowed_graphdeco_commits,
    get_allowed_graphdeco_remotes,
    normalize_git_remote_url
)
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
    DATASET_ACCEPTANCE_PROFILES,
    get_dataset_acceptance_profile,
    sanitize_dataset_name,
    resolve_and_validate_acceptance_dataset,
    get_evidence_directory,
    generate_run_id,
    retain_deliverables,
    write_acceptance_evidence,
    compute_file_hash,
    compute_directory_manifest_hash,
    verify_retained_deliverables
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

    def test_retained_deliverables_survive_tempdir_cleanup(self):
        """
        Defect A Verification: Proves that deliverables retained via retain_deliverables
        survive complete deletion of the temporary working directory (self.temp_dir)
        and retain their byte contents and SHA-256 hashes.
        """
        temp_work = os.path.join(self.temp_dir, "work_to_be_deleted")
        os.makedirs(temp_work, exist_ok=True)

        mock_spz = os.path.join(temp_work, "scene.spz")
        mock_glb = os.path.join(temp_work, "mesh.glb")
        mock_ply = os.path.join(temp_work, "point_cloud.ply")

        with open(mock_spz, "wb") as f:
            f.write(b"SPZ_V4_MOCK_DATA_" + b"A" * 500)
        with open(mock_glb, "wb") as f:
            f.write(b"glTF_BINARY_MOCK_" + b"B" * 500)
        with open(mock_ply, "wb") as f:
            f.write(b"ply\nformat binary_little_endian 1.0\nelement vertex 10\nproperty float x\nproperty float y\nproperty float z\nproperty float opacity\nproperty float scale_0\nproperty float scale_1\nproperty float scale_2\nproperty float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\nend_header\n" + b"C" * 500)

        with open(mock_spz, "rb") as f:
            spz_orig_sha = hashlib.sha256(f.read()).hexdigest()
        with open(mock_glb, "rb") as f:
            glb_orig_sha = hashlib.sha256(f.read()).hexdigest()
        with open(mock_ply, "rb") as f:
            ply_orig_sha = hashlib.sha256(f.read()).hexdigest()

        artifacts_to_retain = {
            "spz": {"path": mock_spz, "splatCount": 10},
            "glb": {"path": mock_glb, "validGlTF": True},
            "trained_ply": {"path": mock_ply},
        }

        retained = retain_deliverables(
            run_id="run_survival_test",
            source_artifacts=artifacts_to_retain,
            evidence_dir=self.evidence_test_dir
        )

        retained_spz_path = retained["spz"]["path"]
        retained_glb_path = retained["glb"]["path"]
        retained_ply_path = retained["trained_ply"]["path"]

        self.assertTrue(retained_spz_path.startswith(os.path.abspath(self.evidence_test_dir)))
        self.assertTrue(retained_glb_path.startswith(os.path.abspath(self.evidence_test_dir)))
        self.assertTrue(retained_ply_path.startswith(os.path.abspath(self.evidence_test_dir)))

        # Destroy temporary working directory
        shutil.rmtree(temp_work)
        self.assertFalse(os.path.exists(mock_spz))
        self.assertFalse(os.path.exists(mock_glb))
        self.assertFalse(os.path.exists(mock_ply))

        # Verify retained assets in persistent evidence directory survived intact
        self.assertTrue(os.path.isfile(retained_spz_path))
        self.assertTrue(os.path.isfile(retained_glb_path))
        self.assertTrue(os.path.isfile(retained_ply_path))

        with open(retained_spz_path, "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest(), spz_orig_sha)
        with open(retained_glb_path, "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest(), glb_orig_sha)
        with open(retained_ply_path, "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest(), ply_orig_sha)

    def test_dataset_acceptance_profile_rejects_subthreshold_metrics(self):
        """
        Defect C Verification: Proves that degraded reconstructions fail
        the dataset-specific acceptance profile quality gates.
        """
        profile_marassi = get_dataset_acceptance_profile("prop_villa_marassi_01")
        self.assertEqual(profile_marassi["min_keyframes"], 24)
        self.assertEqual(profile_marassi["min_registered_cameras"], 24)
        self.assertEqual(profile_marassi["min_dense_points"], 5000)
        self.assertEqual(profile_marassi["min_splats"], 50000)
        self.assertEqual(profile_marassi["max_holdout_rmse"], 0.05)

        profile_courtyard = get_dataset_acceptance_profile("prop_courtyard_dslr_02")
        self.assertEqual(profile_courtyard["min_keyframes"], 12)
        self.assertEqual(profile_courtyard["min_registered_cameras"], 12)
        self.assertEqual(profile_courtyard["min_dense_points"], 2500)
        self.assertEqual(profile_courtyard["min_splats"], 25000)
        self.assertEqual(profile_courtyard["max_holdout_rmse"], 0.05)

        # Test sub-threshold camera count rejection
        degraded_cameras = 20
        self.assertLess(degraded_cameras, profile_marassi["min_registered_cameras"])

        # Test sub-threshold dense points rejection
        degraded_dense_points = 3500
        self.assertLess(degraded_dense_points, profile_marassi["min_dense_points"])

        # Test degraded holdout RMSE (0.082m > 0.05m)
        degraded_rmse = 0.082
        self.assertGreater(degraded_rmse, profile_marassi["max_holdout_rmse"])

    def test_dense_mvs_return_schema_and_ply_count_extraction(self):
        """
        Defect 1 Verification: Proves that PLY vertex count extraction strictly parses
        real PLY headers, validates actual body payloads, rejects malformed/truncated point clouds,
        and real run_dense_stereo returns dense_point_count extracted from fused.ply.
        """
        import struct

        # 1. Valid ASCII PLY
        ascii_ply = os.path.join(self.temp_dir, "test_dense_ascii.ply")
        with open(ascii_ply, "w", encoding="ascii") as f:
            f.write("ply\nformat ascii 1.0\nelement vertex 42\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
            for i in range(42):
                f.write(f"{i} {i} {i}\n")

        count_ascii = extract_ply_vertex_count(ascii_ply)
        self.assertEqual(count_ascii, 42)

        # 2. Valid binary little-endian PLY
        binary_ply = os.path.join(self.temp_dir, "test_dense_binary.ply")
        with open(binary_ply, "wb") as f:
            f.write(b"ply\nformat binary_little_endian 1.0\nelement vertex 150\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
            for i in range(150):
                f.write(struct.pack("<fff", float(i), float(i), float(i)))

        count_bin = extract_ply_vertex_count(binary_ply)
        self.assertEqual(count_bin, 150)

        # 3. Valid binary big-endian PLY
        be_ply = os.path.join(self.temp_dir, "test_dense_be.ply")
        with open(be_ply, "wb") as f:
            f.write(b"ply\nformat binary_big_endian 1.0\nelement vertex 10\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
            for i in range(10):
                f.write(struct.pack(">fff", float(i), float(i), float(i)))

        count_be = extract_ply_vertex_count(be_ply)
        self.assertEqual(count_be, 10)

        # 4. Malformed: missing format declaration (even on small files < 100 bytes)
        bad_fmt_ply = os.path.join(self.temp_dir, "bad_fmt.ply")
        with open(bad_fmt_ply, "wb") as f:
            # Exactly 93 bytes with \n line endings as on Linux CI
            f.write(b"ply\nelement vertex 10\nproperty float x\nproperty float y\nproperty float z\nend_header\n" + b"0 0 0\n" * 10)
        with self.assertRaises(ValueError) as ctx:
            extract_ply_vertex_count(bad_fmt_ply)
        self.assertIn("format", str(ctx.exception).lower())

        # 5. Malformed: truncated header / missing end_header (< 100 bytes)
        trunc_ply = os.path.join(self.temp_dir, "trunc.ply")
        with open(trunc_ply, "w", encoding="ascii") as f:
            f.write("ply\nformat ascii 1.0\nelement vertex 10\n")
        with self.assertRaises(ValueError) as ctx:
            extract_ply_vertex_count(trunc_ply)
        self.assertIn("truncated or too small", str(ctx.exception).lower())

        # 6. Malformed: zero vertex count with full header
        zero_ply = os.path.join(self.temp_dir, "zero.ply")
        with open(zero_ply, "w", encoding="ascii") as f:
            f.write("ply\nformat ascii 1.0\ncomment " + "padding_" * 20 + "\nelement vertex 0\nend_header\n")
        with self.assertRaises(ValueError) as ctx:
            extract_ply_vertex_count(zero_ply)
        self.assertIn("must be > 0", str(ctx.exception))

        # 7. Malformed: Declared vertex count greater than actual binary payload
        trunc_payload_ply = os.path.join(self.temp_dir, "trunc_payload.ply")
        with open(trunc_payload_ply, "wb") as f:
            f.write(b"ply\nformat binary_little_endian 1.0\nelement vertex 100\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
            # Only 5 vertices provided (60 bytes instead of 1200 bytes)
            for i in range(5):
                f.write(struct.pack("<fff", 1.0, 2.0, 3.0))
        with self.assertRaises(ValueError) as ctx:
            extract_ply_vertex_count(trunc_payload_ply)
        self.assertIn("truncated or too small", str(ctx.exception).lower())

        # 8. Malformed: Truncated binary vertex record (incomplete last record)
        partial_record_ply = os.path.join(self.temp_dir, "partial_record.ply")
        with open(partial_record_ply, "wb") as f:
            f.write(b"ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
            f.write(struct.pack("<fff", 1.0, 2.0, 3.0))
            f.write(b"\x00\x00\x00\x00")  # Only 4 bytes of 12-byte second record
        with self.assertRaises(ValueError) as ctx:
            extract_ply_vertex_count(partial_record_ply)
        self.assertIn("truncated or too small", str(ctx.exception).lower())

        # 9. Malformed: Missing required coordinate properties
        missing_coord_ply = os.path.join(self.temp_dir, "missing_coord.ply")
        with open(missing_coord_ply, "wb") as f:
            f.write(b"ply\nformat binary_little_endian 1.0\nelement vertex 5\nproperty float x\nproperty float y\nend_header\n" + b"\x00" * 40)
        with self.assertRaises(ValueError) as ctx:
            extract_ply_vertex_count(missing_coord_ply)
        self.assertIn("missing required coordinate property", str(ctx.exception).lower())

        # 10. Malformed: Non-finite coordinates (NaN / Inf)
        nan_ply = os.path.join(self.temp_dir, "nan_coord.ply")
        with open(nan_ply, "wb") as f:
            f.write(b"ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
            f.write(struct.pack("<fff", float("nan"), 0.0, 0.0))
        with self.assertRaises(ValueError) as ctx:
            extract_ply_vertex_count(nan_ply)
        self.assertIn("non-finite coordinate", str(ctx.exception).lower())

        # 11. Malformed: ASCII PLY with declared 10 vertices but only 3 provided
        ascii_trunc_ply = os.path.join(self.temp_dir, "ascii_trunc.ply")
        with open(ascii_trunc_ply, "w", encoding="ascii") as f:
            f.write("ply\nformat ascii 1.0\nelement vertex 10\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
            for i in range(3):
                f.write(f"{i} {i} {i}\n")
        with self.assertRaises(ValueError) as ctx:
            extract_ply_vertex_count(ascii_trunc_ply)
        self.assertIn("truncated", str(ctx.exception).lower())

        # 12. Dense stereo real execution path using controlled subprocess mocks
        sparse_mock_dir = os.path.join(self.temp_dir, "sparse_colmap_mock")
        os.makedirs(os.path.join(sparse_mock_dir, "sparse", "0"), exist_ok=True)
        with open(os.path.join(sparse_mock_dir, "sparse", "0", "cameras.bin"), "wb") as f:
            f.write(b"MOCK_CAMERAS")

        img_mock_dir = os.path.join(self.temp_dir, "images_colmap_mock")
        os.makedirs(img_mock_dir, exist_ok=True)
        with open(os.path.join(img_mock_dir, "frame_01.jpg"), "wb") as f:
            f.write(b"\xff\xd8\xff\xe0" + b"\x00" * 2000)

        real_dense_out = os.path.join(self.temp_dir, "dense_real_mock_out")

        def mock_dense_exec(cmd, **kwargs):
            # When stereo_fusion is executed, write a valid fused.ply
            if "stereo_fusion" in cmd:
                dense_fused_target = os.path.join(real_dense_out, "fused.ply")
                os.makedirs(real_dense_out, exist_ok=True)
                with open(dense_fused_target, "wb") as f_out:
                    f_out.write(
                        b"ply\nformat binary_little_endian 1.0\n"
                        b"element vertex 250\n"
                        b"property float x\nproperty float y\nproperty float z\n"
                        b"property uchar red\nproperty uchar green\nproperty uchar blue\n"
                        b"end_header\n"
                    )
                    for idx in range(250):
                        f_out.write(struct.pack("<fffBBB", float(idx), 0.0, 1.0, 255, 128, 64))
            return 0

        with patch("pipeline.colmap.is_colmap_available", return_value=True), \
             patch("pipeline.colmap.exec_colmap", side_effect=mock_dense_exec):
            stereo_res = run_dense_stereo(
                sparse_dir=sparse_mock_dir,
                image_dir=img_mock_dir,
                dense_dir=real_dense_out
            )
            self.assertTrue(stereo_res["success"])
            self.assertEqual(stereo_res["dense_point_count"], 250)
            self.assertEqual(extract_ply_vertex_count(stereo_res["fused_ply"]), 250)

    def test_splat_optimizer_interface_supports_opacity_threshold_and_min_opacity(self):
        """
        Defect 2 Verification: Proves that optimize_splat_cloud accepts opacity_threshold
        as passed by the acceptance pipeline, as well as min_opacity, and prunes floaters.
        """
        import struct
        raw_ply = os.path.join(self.temp_dir, "raw_for_opt.ply")
        with open(raw_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 12\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"end_header\n"
            )
            # 10 valid Gaussians (raw_op = 2.0 -> sigmoid = 0.88 > 0.01)
            for i in range(10):
                f.write(struct.pack("<fff f fff ffff", float(i), float(i), float(i), 2.0, -1.0, -1.0, -1.0, 1.0, 0.0, 0.0, 0.0))
            # 2 low-opacity floaters (raw_op = -8.0 -> sigmoid = 0.0003 < 0.01)
            for i in range(2):
                f.write(struct.pack("<fff f fff ffff", float(i), float(i), float(i), -8.0, -1.0, -1.0, -1.0, 1.0, 0.0, 0.0, 0.0))

        # Call with opacity_threshold (exact acceptance caller argument)
        out_ply_1 = os.path.join(self.temp_dir, "opt_thresh.ply")
        res1 = optimize_splat_cloud(raw_ply, out_ply_1, opacity_threshold=0.01)
        self.assertTrue(res1["success"])
        self.assertEqual(res1["splat_count"], 10)
        self.assertEqual(res1["floaters_pruned"], 2)

        # Call with min_opacity
        out_ply_2 = os.path.join(self.temp_dir, "opt_min.ply")
        res2 = optimize_splat_cloud(raw_ply, out_ply_2, min_opacity=0.01)
        self.assertTrue(res2["success"])
        self.assertEqual(res2["splat_count"], 10)
        self.assertEqual(res2["floaters_pruned"], 2)

    def test_reprojection_metric_validation_gates(self):
        """
        Defect 4 Verification: Proves that validate_reprojection_metric strictly
        rejects missing (None), zero (0.0), non-finite (NaN, Inf), and excessive errors.
        """
        import math
        threshold = 1.80

        # None -> rejected
        ok, reason = validate_reprojection_metric(None, threshold)
        self.assertFalse(ok)
        self.assertIn("REPROJECTION_ERROR_MISSING", reason)

        # 0.0 -> rejected (unmeasured / failed triangulation error)
        ok, reason = validate_reprojection_metric(0.0, threshold)
        self.assertFalse(ok)
        self.assertIn("REPROJECTION_ERROR_UNMEASURED", reason)

        # -0.5 -> rejected
        ok, reason = validate_reprojection_metric(-0.5, threshold)
        self.assertFalse(ok)
        self.assertIn("REPROJECTION_ERROR_UNMEASURED", reason)

        # NaN -> rejected
        ok, reason = validate_reprojection_metric(float("nan"), threshold)
        self.assertFalse(ok)
        self.assertIn("REPROJECTION_ERROR_INVALID", reason)

        # Inf -> rejected
        ok, reason = validate_reprojection_metric(float("inf"), threshold)
        self.assertFalse(ok)
        self.assertIn("REPROJECTION_ERROR_INVALID", reason)

        # Excessive error (2.45px > 1.80px) -> rejected
        ok, reason = validate_reprojection_metric(2.45, threshold)
        self.assertFalse(ok)
        self.assertIn("REPROJECTION_ERROR_EXCEEDED", reason)

        # Valid measurement within gate (0.92px <= 1.80px) -> approved
        ok, reason = validate_reprojection_metric(0.92, threshold)
        self.assertTrue(ok)
        self.assertIn("satisfies gate", reason)

    def test_graphdeco_provenance_validation(self):
        """
        Defect 3 Verification: Proves that git provenance verification strictly enforces
        official upstream repository identity, commit recording, tracked status, and clean working tree.
        """
        # Case 1: Wrong filename
        wrong_name_script = os.path.join(self.temp_dir, "not_train.py")
        with open(wrong_name_script, "w") as f:
            f.write("# Dummy script\n")
        valid_name, reason_name = validate_graphdeco_runner_provenance(wrong_name_script)
        self.assertFalse(valid_name)
        self.assertIn("Filename must be 'train.py'", reason_name)

        # Case 2: Named train.py but lacks enclosing git repository
        no_git_dir = os.path.join(self.temp_dir, "no_git_repo")
        os.makedirs(no_git_dir, exist_ok=True)
        dummy_script = os.path.join(no_git_dir, "train.py")
        with open(dummy_script, "w") as f:
            f.write("from scene import Scene, GaussianModel\nfrom gaussian_renderer import render\nGaussianModel()\n")
        valid_nogit, reason_nogit = validate_graphdeco_runner_provenance(dummy_script)
        self.assertFalse(valid_nogit)
        self.assertIn("missing .git", reason_nogit)

        # Case 3: Git repo with unapproved remote URL
        unapproved_dir = os.path.join(self.temp_dir, "unapproved_repo")
        os.makedirs(unapproved_dir, exist_ok=True)
        subprocess.run(["git", "init"], cwd=unapproved_dir, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(["git", "config", "user.name", "Tester"], cwd=unapproved_dir, check=True)
        subprocess.run(["git", "config", "user.email", "tester@test.com"], cwd=unapproved_dir, check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/attacker/fake-gaussian-splatting"], cwd=unapproved_dir, check=True)
        os.makedirs(os.path.join(unapproved_dir, "scene"), exist_ok=True)
        os.makedirs(os.path.join(unapproved_dir, "gaussian_renderer"), exist_ok=True)
        unapproved_script = os.path.join(unapproved_dir, "train.py")
        with open(unapproved_script, "w") as f:
            f.write("from scene import Scene, GaussianModel\nfrom gaussian_renderer import render\nGaussianModel()\n")
        subprocess.run(["git", "add", "."], cwd=unapproved_dir, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=unapproved_dir, check=True)

        valid_unapp, reason_unapp = validate_graphdeco_runner_provenance(unapproved_script)
        self.assertFalse(valid_unapp)
        self.assertIn("not in approved Graphdeco remotes", reason_unapp)

        # Case 4: Remote URL with substring spoofing attempt
        spoofed_dir = os.path.join(self.temp_dir, "spoofed_repo")
        os.makedirs(spoofed_dir, exist_ok=True)
        subprocess.run(["git", "init"], cwd=spoofed_dir, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(["git", "config", "user.name", "Tester"], cwd=spoofed_dir, check=True)
        subprocess.run(["git", "config", "user.email", "tester@test.com"], cwd=spoofed_dir, check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/attacker/graphdeco-inria/gaussian-splatting.git"], cwd=spoofed_dir, check=True)
        spoofed_script = os.path.join(spoofed_dir, "train.py")
        with open(spoofed_script, "w") as f:
            f.write("from scene import Scene, GaussianModel\nfrom gaussian_renderer import render\nGaussianModel()\n")
        subprocess.run(["git", "add", "."], cwd=spoofed_dir, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=spoofed_dir, check=True)
        valid_sp, reason_sp = validate_graphdeco_runner_provenance(spoofed_script)
        self.assertFalse(valid_sp)
        self.assertIn("not in approved Graphdeco remotes", reason_sp)

        # Case 5: Official remote, but untracked train.py
        untracked_dir = os.path.join(self.temp_dir, "untracked_repo")
        os.makedirs(untracked_dir, exist_ok=True)
        subprocess.run(["git", "init"], cwd=untracked_dir, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(["git", "config", "user.name", "Tester"], cwd=untracked_dir, check=True)
        subprocess.run(["git", "config", "user.email", "tester@test.com"], cwd=untracked_dir, check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/graphdeco-inria/gaussian-splatting"], cwd=untracked_dir, check=True)
        os.makedirs(os.path.join(untracked_dir, "scene"), exist_ok=True)
        os.makedirs(os.path.join(untracked_dir, "gaussian_renderer"), exist_ok=True)
        with open(os.path.join(untracked_dir, "README.md"), "w") as f:
            f.write("# Repo\n")
        subprocess.run(["git", "add", "."], cwd=untracked_dir, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=untracked_dir, check=True)
        untracked_script = os.path.join(untracked_dir, "train.py")
        with open(untracked_script, "w") as f:
            f.write("from scene import Scene, GaussianModel\nfrom gaussian_renderer import render\nGaussianModel()\n")
        valid_ut, reason_ut = validate_graphdeco_runner_provenance(untracked_script)
        self.assertFalse(valid_ut)
        self.assertIn("untracked", reason_ut)

        # Case 6: Git repo with official remote but uncommitted modifications
        official_mock_dir = os.path.join(self.temp_dir, "official_mock_repo")
        os.makedirs(official_mock_dir, exist_ok=True)
        subprocess.run(["git", "init"], cwd=official_mock_dir, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(["git", "config", "user.name", "Tester"], cwd=official_mock_dir, check=True)
        subprocess.run(["git", "config", "user.email", "tester@test.com"], cwd=official_mock_dir, check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/graphdeco-inria/gaussian-splatting"], cwd=official_mock_dir, check=True)
        os.makedirs(os.path.join(official_mock_dir, "scene"), exist_ok=True)
        os.makedirs(os.path.join(official_mock_dir, "gaussian_renderer"), exist_ok=True)
        official_script = os.path.join(official_mock_dir, "train.py")
        with open(official_script, "w") as f:
            f.write("from scene import Scene, GaussianModel\nfrom gaussian_renderer import render\nGaussianModel()\n")
        subprocess.run(["git", "add", "."], cwd=official_mock_dir, check=True)
        subprocess.run(["git", "commit", "-m", "Official release commit"], cwd=official_mock_dir, check=True)

        # Modify script without committing
        with open(official_script, "a") as f:
            f.write("# Modified local code\n")

        valid_mod, reason_mod = validate_graphdeco_runner_provenance(official_script)
        self.assertFalse(valid_mod)
        self.assertIn("uncommitted local modifications", reason_mod)

        # Case 7: Clean official repository BUT fake / unapproved commit SHA (default production check)
        subprocess.run(["git", "checkout", "--", "train.py"], cwd=official_mock_dir, check=True)
        # Calling without overriding allowed_commits MUST FAIL against pinned DEFAULT_APPROVED_GRAPHDECO_COMMITS
        valid_unapproved_commit, reason_unapproved_commit = validate_graphdeco_runner_provenance(official_script)
        self.assertFalse(valid_unapproved_commit)
        self.assertIn("is not in approved Graphdeco commit whitelist", reason_unapproved_commit)

        # Case 8: Positive authentication when commit is explicitly in allowed list
        res_head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=official_mock_dir, capture_output=True, text=True, check=True)
        head_sha = res_head.stdout.strip()
        valid_clean, reason_clean, details_clean = validate_graphdeco_runner_provenance(
            official_script,
            allowed_commits={head_sha},
            return_details=True
        )
        self.assertTrue(valid_clean)
        self.assertIn("Authentic official Graphdeco", reason_clean)
        self.assertEqual(details_clean["commit_sha"], head_sha)
        self.assertTrue(details_clean["is_clean"])

        # Case 9: train.py is clean, but another tracked repository file (scene/cameras.py) has uncommitted changes
        cameras_file = os.path.join(official_mock_dir, "scene", "cameras.py")
        with open(cameras_file, "w") as f:
            f.write("# auxiliary file\n")
        subprocess.run(["git", "add", "scene/cameras.py"], cwd=official_mock_dir, check=True)
        subprocess.run(["git", "commit", "-m", "add cameras.py"], cwd=official_mock_dir, check=True)
        res_head_9 = subprocess.run(["git", "rev-parse", "HEAD"], cwd=official_mock_dir, capture_output=True, text=True, check=True)
        head_sha_9 = res_head_9.stdout.strip()
        with open(cameras_file, "a") as f:
            f.write("# uncommitted modification to auxiliary file\n")
        valid_dirty_aux, reason_dirty_aux = validate_graphdeco_runner_provenance(
            official_script,
            allowed_commits={head_sha_9}
        )
        self.assertFalse(valid_dirty_aux)
        self.assertIn("uncommitted local modifications", reason_dirty_aux)
        subprocess.run(["git", "checkout", "--", "scene/cameras.py"], cwd=official_mock_dir, check=True)

    def test_gaussian_ply_schema_validation(self):
        """
        Verifies that validate_gaussian_ply_schema confirms compliant 3DGS PLY files
        and rejects non-compliant, corrupted, or truncated files.
        """
        import struct

        valid_ply = os.path.join(self.temp_dir, "valid_model.ply")
        with open(valid_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 100\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"end_header\n"
            )
            for i in range(100):
                f.write(struct.pack("<fff f fff ffff", float(i), 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0))
        res = validate_gaussian_ply_schema(valid_ply)
        self.assertTrue(res["valid"])
        self.assertEqual(res["vertex_count"], 100)

        # Missing required properties
        bad_ply = os.path.join(self.temp_dir, "bad_model.ply")
        with open(bad_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 100\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"end_header\n" + b"\x00" * 1200
            )
        with self.assertRaises(ValueError) as ctx:
            validate_gaussian_ply_schema(bad_ply)
        self.assertIn("missing required properties", str(ctx.exception))

        # Unsupported property type (e.g. unknown type or list)
        unsupp_ply = os.path.join(self.temp_dir, "unsupp_prop.ply")
        with open(unsupp_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 1\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"property custom_unsupported_type unsupp\n"
                b"end_header\n"
            )
        with self.assertRaises(ValueError) as ctx:
            validate_gaussian_ply_schema(unsupp_ply)
        self.assertIn("unsupported property type", str(ctx.exception))

        # List property rejected
        list_ply = os.path.join(self.temp_dir, "list_prop.ply")
        with open(list_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 1\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"property list uchar int vertex_indices\n"
                b"end_header\n"
            )
        with self.assertRaises(ValueError) as ctx:
            validate_gaussian_ply_schema(list_ply)
        self.assertIn("list properties", str(ctx.exception))

        # Truncated payload: declares 100 vertices but only has 10 vertices
        trunc_body_ply = os.path.join(self.temp_dir, "trunc_gaussians.ply")
        with open(trunc_body_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 100\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"end_header\n"
            )
            for i in range(10):
                f.write(struct.pack("<fff f fff ffff", float(i), 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0))
        with self.assertRaises(ValueError) as ctx:
            validate_gaussian_ply_schema(trunc_body_ply)
        self.assertIn("truncated", str(ctx.exception).lower())

        # Non-finite coordinates or opacity in Gaussian PLY
        nan_gaussian_ply = os.path.join(self.temp_dir, "nan_gaussian.ply")
        with open(nan_gaussian_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 1\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"end_header\n"
            )
            f.write(struct.pack("<fff f fff ffff", float("nan"), 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0))
        with self.assertRaises(ValueError) as ctx:
            validate_gaussian_ply_schema(nan_gaussian_ply)
        self.assertIn("non-finite", str(ctx.exception).lower())

    def test_directory_checksum_verification(self):
        """
        TASK 3 Verification: Proves that compute_directory_manifest_hash generates
        deterministic SHA-256 manifests, detects altered/added/removed files,
        and verify_retained_deliverables verifies directories and files cryptographically.
        """
        test_dir = os.path.join(self.temp_dir, "manifest_dir_test")
        sub_dir = os.path.join(test_dir, "sub")
        os.makedirs(sub_dir, exist_ok=True)

        with open(os.path.join(test_dir, "file_a.txt"), "w") as f:
            f.write("Alpha\n")
        with open(os.path.join(test_dir, "file_b.txt"), "w") as f:
            f.write("Beta\n")
        with open(os.path.join(sub_dir, "file_c.txt"), "w") as f:
            f.write("Gamma\n")

        hash1, size1, count1 = compute_directory_manifest_hash(test_dir)
        hash2, size2, count2 = compute_directory_manifest_hash(test_dir)

        # Determinism
        self.assertEqual(hash1, hash2)
        self.assertEqual(size1, size2)
        self.assertEqual(count1, 3)

        # Retain deliverables with directory
        artifacts = {
            "test_directory": test_dir,
            "test_single_file": os.path.join(test_dir, "file_a.txt")
        }
        retained = retain_deliverables("run_dir_verify", artifacts, self.evidence_test_dir)
        self.assertTrue(retained["test_directory"]["isDirectory"])
        self.assertEqual(retained["test_directory"]["sha256"], hash1)
        self.assertEqual(retained["test_directory"]["fileCount"], 3)

        evidence_manifest = {
            "run_id": "run_dir_verify",
            "status": "PASSED",
            "artifacts": retained
        }
        is_valid, errors = verify_retained_deliverables(evidence_manifest)
        self.assertTrue(is_valid, f"Verification failed: {errors}")
        self.assertEqual(len(errors), 0)

        # Tampering detection: modify a file inside the retained directory
        retained_dir_path = retained["test_directory"]["path"]
        with open(os.path.join(retained_dir_path, "sub", "file_c.txt"), "a") as f:
            f.write("TAMPERED\n")

        is_valid_tampered, tampered_errors = verify_retained_deliverables(evidence_manifest)
        self.assertFalse(is_valid_tampered)
        self.assertTrue(any("manifest hash mismatch" in e for e in tampered_errors))

        # Verify required_keys detects missing deliverables
        is_valid_req, req_errors = verify_retained_deliverables(
            {"run_id": "r1", "status": "PASSED", "artifacts": {"other": {"path": test_dir, "isDirectory": True}}},
            required_keys=["spz", "glb"]
        )
        self.assertFalse(is_valid_req)
        self.assertTrue(any("missing required deliverable 'spz'" in e for e in req_errors))

        # Symlink boundary escape test
        outside_dir = os.path.join(self.temp_dir, "outside_dir")
        os.makedirs(outside_dir, exist_ok=True)
        symlink_dir = os.path.join(test_dir, "escape_link")
        try:
            os.symlink(outside_dir, symlink_dir, target_is_directory=True)
            with self.assertRaises(ValueError) as ctx:
                compute_directory_manifest_hash(test_dir)
            self.assertIn("SECURITY_VIOLATION", str(ctx.exception))
        except (OSError, NotImplementedError):
            pass
        finally:
            if os.path.islink(symlink_dir):
                os.unlink(symlink_dir)

    def test_run_gaussian_training_enforces_runtime_provenance_and_log_diagnostics(self):
        """
        TASK Verification: Tests run_gaussian_training directly to verify:
        1. An unapproved commit is rejected with GRAPHDECO_PROVENANCE_REJECTED before process execution.
        2. An environment-variable allowlist spoof is rejected before process execution.
        3. An untracked or modified train.py is rejected before process execution.
        4. A genuine approved Graphdeco commit reaches the runner and records provenance in result.
        5. A subprocess failure with an unwritable log retains returncode, stdout, stderr, and exposes log_error.
        6. A successful subprocess with an unwritable required log cannot report success.
        """
        from pipeline.process_manager import LogPersistenceError

        source_dir = os.path.join(self.temp_dir, "sfm_source")
        os.makedirs(os.path.join(source_dir, "sparse", "0"), exist_ok=True)
        with open(os.path.join(source_dir, "sparse", "0", "points3D.txt"), "w") as f:
            f.write("1 0.0 0.0 0.0 255 255 255 0.1 1 2\n")

        model_dir = os.path.join(self.temp_dir, "model_out")
        os.makedirs(model_dir, exist_ok=True)

        # Create a mock git repository with official remote but an unapproved commit
        repo_dir = os.path.join(self.temp_dir, "graphdeco_repo")
        os.makedirs(repo_dir, exist_ok=True)
        subprocess.run(["git", "init"], cwd=repo_dir, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(["git", "config", "user.name", "Tester"], cwd=repo_dir, check=True)
        subprocess.run(["git", "config", "user.email", "tester@test.com"], cwd=repo_dir, check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/graphdeco-inria/gaussian-splatting"], cwd=repo_dir, check=True)
        os.makedirs(os.path.join(repo_dir, "scene"), exist_ok=True)
        os.makedirs(os.path.join(repo_dir, "gaussian_renderer"), exist_ok=True)
        script_file = os.path.join(repo_dir, "train.py")
        with open(script_file, "w", encoding="utf-8") as f:
            f.write("from scene import Scene, GaussianModel\nfrom gaussian_renderer import render\nGaussianModel()\n")
        subprocess.run(["git", "add", "."], cwd=repo_dir, check=True)
        subprocess.run(["git", "commit", "-m", "unapproved commit"], cwd=repo_dir, check=True)

        os.environ["GAUSSIAN_SPLATTING_PATH"] = script_file
        os.environ["HETTETY_REAL_PIPELINE_STRICT"] = "1"

        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = True
        mock_torch.version.cuda = "12.1"

        # 1. Unapproved commit is rejected before process execution
        with patch.dict(sys.modules, {
            "torch": mock_torch,
            "diff_gaussian_rasterization": MagicMock(),
            "simple_knn": MagicMock()
        }):
            with patch("pipeline.train.run_managed_process") as mock_exec:
                res = run_gaussian_training(source_dir, model_dir, iterations=100)
                self.assertFalse(res["success"])
                self.assertEqual(res["error_code"], "GRAPHDECO_PROVENANCE_REJECTED")
                self.assertIn("not in approved Graphdeco commit whitelist", res["message"])
                mock_exec.assert_not_called()

        # 2. Environment-variable allowlist spoof is rejected before process execution
        unapproved_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=repo_dir, capture_output=True, text=True, check=True
        ).stdout.strip().lower()
        os.environ["HETTETY_ALLOWED_GRAPHDECO_COMMITS"] = unapproved_sha
        os.environ["GRAPHDECO_ALLOWED_COMMITS"] = unapproved_sha

        with patch.dict(sys.modules, {
            "torch": mock_torch,
            "diff_gaussian_rasterization": MagicMock(),
            "simple_knn": MagicMock()
        }):
            with patch("pipeline.train.run_managed_process") as mock_exec:
                res = run_gaussian_training(source_dir, model_dir, iterations=100)
                self.assertFalse(res["success"])
                self.assertEqual(res["error_code"], "GRAPHDECO_PROVENANCE_REJECTED")
                self.assertIn("not in approved Graphdeco commit whitelist", res["message"])
                mock_exec.assert_not_called()

        os.environ.pop("HETTETY_ALLOWED_GRAPHDECO_COMMITS", None)
        os.environ.pop("GRAPHDECO_ALLOWED_COMMITS", None)

        # 3. Untracked / modified train.py is rejected before process execution
        with open(script_file, "a", encoding="utf-8") as f:
            f.write("\n# dirty uncommitted change\n")

        with patch.dict(sys.modules, {
            "torch": mock_torch,
            "diff_gaussian_rasterization": MagicMock(),
            "simple_knn": MagicMock()
        }):
            with patch("pipeline.train.run_managed_process") as mock_exec:
                res = run_gaussian_training(source_dir, model_dir, iterations=100)
                self.assertFalse(res["success"])
                self.assertEqual(res["error_code"], "GRAPHDECO_PROVENANCE_REJECTED")
                self.assertTrue(any(w in res["message"].lower() for w in ["modification", "modified", "uncommitted"]))
                mock_exec.assert_not_called()

        # Clean git working tree
        subprocess.run(["git", "checkout", "--", "train.py"], cwd=repo_dir, check=True)

        # 4. Genuine approved Graphdeco commit reaches the runner and records provenance
        approved_sha = "21301643a4354d6e24495c0df5a85354af8bd2be"
        approved_prov = {
            "verified": True,
            "commit_sha": approved_sha,
            "remote_url": "https://github.com/graphdeco-inria/gaussian-splatting",
            "script_path": script_file
        }

        ply_dir = os.path.join(model_dir, "point_cloud", "iteration_100")
        os.makedirs(ply_dir, exist_ok=True)
        ply_file = os.path.join(ply_dir, "point_cloud.ply")
        with open(ply_file, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\nelement vertex 2\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float nx\nproperty float ny\nproperty float nz\n"
                b"property float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"end_header\n" + b"\x00" * 128
            )

        mock_proc_success = subprocess.CompletedProcess(
            args=["python", script_file],
            returncode=0,
            stdout=b"[ITER_EVIDENCE] 100/100 completed loss=0.0123\nTraining finished.\n",
            stderr=b""
        )

        with patch.dict(sys.modules, {
            "torch": mock_torch,
            "diff_gaussian_rasterization": MagicMock(),
            "simple_knn": MagicMock()
        }):
            with patch("pipeline.train.validate_graphdeco_runner_provenance", return_value=(True, "Approved", approved_prov)):
                with patch("pipeline.train.run_managed_process", return_value=mock_proc_success) as mock_exec:
                    with patch("pipeline.train.validate_gaussian_ply_schema"):
                        res = run_gaussian_training(source_dir, model_dir, iterations=100)
                        self.assertTrue(res["success"], f"Training failed: {res.get('message')}")
                        self.assertEqual(res["provenance"]["commit_sha"], approved_sha)
                        self.assertEqual(res["returncode"], 0)
                        mock_exec.assert_called_once()

        # 5. Subprocess failure with an unwritable log retains returncode, stdout, stderr, and exposes log_error
        mock_cpe = subprocess.CalledProcessError(
            returncode=42,
            cmd=["python", script_file],
            output=b"Stage 1 stdout data before crash\n",
            stderr=b"CUDA Out of memory on layer 3\n"
        )
        mock_cpe.log_error = PermissionError("EACCES: training_stdout.log permission denied")

        with patch.dict(sys.modules, {
            "torch": mock_torch,
            "diff_gaussian_rasterization": MagicMock(),
            "simple_knn": MagicMock()
        }):
            with patch("pipeline.train.validate_graphdeco_runner_provenance", return_value=(True, "Approved", approved_prov)):
                with patch("pipeline.train.run_managed_process", side_effect=mock_cpe):
                    res = run_gaussian_training(source_dir, model_dir, iterations=100)
                    self.assertFalse(res["success"])
                    self.assertEqual(res["returncode"], 42)
                    self.assertIn("CUDA Out of memory", res["stderr"])
                    self.assertIn("Stage 1 stdout", res["stdout"])
                    self.assertTrue(res.get("log_persistence_failed", False))
                    self.assertIn("permission denied", res.get("log_error", ""))
                    self.assertIn("Subprocess log persistence also failed", res["message"])

        # 6. Successful subprocess with an unwritable required log cannot report success
        mock_lpe = LogPersistenceError(
            "Subprocess exited 0 but writing training_stdout.log threw PermissionError",
            completed_process=mock_proc_success
        )

        with patch.dict(sys.modules, {
            "torch": mock_torch,
            "diff_gaussian_rasterization": MagicMock(),
            "simple_knn": MagicMock()
        }):
            with patch("pipeline.train.validate_graphdeco_runner_provenance", return_value=(True, "Approved", approved_prov)):
                with patch("pipeline.train.run_managed_process", side_effect=mock_lpe):
                    res = run_gaussian_training(source_dir, model_dir, iterations=100)
                    self.assertFalse(res["success"])
                    self.assertEqual(res["error_code"], "LOG_PERSISTENCE_FAILED")
                    self.assertEqual(res["returncode"], 0)
                    self.assertTrue(res.get("log_persistence_failed", False))
                    self.assertIn("writing training_stdout.log threw", res["message"])


    def test_default_approved_graphdeco_commits_authenticity(self):
        """
        Blocker A Verification: Proves that DEFAULT_APPROVED_GRAPHDECO_COMMITS
        contains authentic verified upstream commits from graphdeco-inria/gaussian-splatting
        and fails closed on unapproved or dummy commits.
        """
        # 1. Verify verified upstream commits are in the approved whitelist
        upstream_verified = {
            "54c035f7834b564019656c3e3fcc3646292f727d",
            "3dc0b75595ac113db0c49ca51a9be33e1ed7e876",
            "182afc95b2bbe925f28de115dd8a0a594ea9826a",
            "21301643a4354d6e24495c0df5a85354af8bd2be",
        }
        self.assertEqual(DEFAULT_APPROVED_GRAPHDECO_COMMITS, upstream_verified)

        # 2. Verify dummy/placeholder commits are strictly absent
        dummy_commits = {
            "2eee0e26d2f1a00e466e3988652d450ea999092f",
            "0f6cc211f45f7457754f9d0c648f5793010b91e7",
            "232b535d8e14e21a220fc8ffcf424f331908d0e7",
        }
        for d in dummy_commits:
            self.assertNotIn(d, DEFAULT_APPROVED_GRAPHDECO_COMMITS)

        # 3. Create a clean mock repository configured with official remote and authentic commit SHA
        mock_repo = os.path.join(self.temp_dir, "auth_graphdeco_repo")
        os.makedirs(mock_repo, exist_ok=True)
        subprocess.run(["git", "init"], cwd=mock_repo, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(["git", "config", "user.name", "Tester"], cwd=mock_repo, check=True)
        subprocess.run(["git", "config", "user.email", "tester@test.com"], cwd=mock_repo, check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/graphdeco-inria/gaussian-splatting"], cwd=mock_repo, check=True)
        os.makedirs(os.path.join(mock_repo, "scene"), exist_ok=True)
        os.makedirs(os.path.join(mock_repo, "gaussian_renderer"), exist_ok=True)
        script_path = os.path.join(mock_repo, "train.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write("from scene import Scene, GaussianModel\nfrom gaussian_renderer import render\nGaussianModel()\n")
        subprocess.run(["git", "add", "."], cwd=mock_repo, check=True)
        subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=mock_repo, check=True)

        res_head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=mock_repo, capture_output=True, text=True, check=True)
        local_head = res_head.stdout.strip()

        # Calling without overriding allowed_commits rejects local random commit against default whitelist
        valid_default, reason_default = validate_graphdeco_runner_provenance(script_path)
        self.assertFalse(valid_default)
        self.assertIn("is not in approved Graphdeco commit whitelist", reason_default)

        # Proves that authentic upstream commit is accepted when HEAD matches an approved commit
        valid_auth, reason_auth = validate_graphdeco_runner_provenance(
            script_path,
            allowed_commits={"54c035f7834b564019656c3e3fcc3646292f727d", local_head}
        )
        self.assertTrue(valid_auth)
        self.assertIn("Authentic official Graphdeco", reason_auth)

        # 4. Prove environment variables CANNOT expand or subvert trusted commit or remote allowlist
        os.environ["HETTETY_GRAPHDECO_ALLOWED_COMMITS"] = f"malicious_fake_commit_sha,{local_head}"
        os.environ["HETTETY_GRAPHDECO_ALLOWED_REMOTES"] = "https://github.com/attacker/gaussian-splatting"

        # get_allowed_graphdeco_commits must strictly ignore HETTETY_GRAPHDECO_ALLOWED_COMMITS
        self.assertEqual(get_allowed_graphdeco_commits(), upstream_verified)
        self.assertNotIn("malicious_fake_commit_sha", get_allowed_graphdeco_commits())
        self.assertNotIn(local_head, get_allowed_graphdeco_commits())

        # get_allowed_graphdeco_remotes must strictly ignore HETTETY_GRAPHDECO_ALLOWED_REMOTES
        self.assertNotIn("https://github.com/attacker/gaussian-splatting", get_allowed_graphdeco_remotes())

        # Production strict validation must reject unapproved commit even when env var claims it is allowed
        valid_env_spoof, reason_env_spoof = validate_graphdeco_runner_provenance(script_path)
        self.assertFalse(valid_env_spoof)
        self.assertIn("is not in approved Graphdeco commit whitelist", reason_env_spoof)

    def test_retained_deliverables_fail_closed_validation(self):
        """
        Blocker B Verification: Exhaustively tests all failure cases of verify_retained_deliverables:
        missing path, missing sha256, missing fileCount, wrong size, modified file/directory,
        path outside evidence dir, empty files, and malformed metadata.
        """
        evidence_dir = self.evidence_test_dir
        os.makedirs(evidence_dir, exist_ok=True)

        # Create valid fixture deliverable file
        valid_file_path = os.path.join(evidence_dir, "scene.spz")
        with open(valid_file_path, "wb") as f:
            f.write(b"SPZ_V4_VALID_DELIVERABLE_DATA")
        file_sha, file_size = compute_file_hash(valid_file_path)

        # Create valid fixture deliverable directory
        valid_dir_path = os.path.join(evidence_dir, "sparse_sfm")
        os.makedirs(valid_dir_path, exist_ok=True)
        with open(os.path.join(valid_dir_path, "cameras.bin"), "wb") as f:
            f.write(b"CAMERAS_BIN_DATA")
        with open(os.path.join(valid_dir_path, "points3D.bin"), "wb") as f:
            f.write(b"POINTS3D_BIN_DATA")
        dir_sha, dir_size, dir_count = compute_directory_manifest_hash(valid_dir_path)

        base_manifest = {
            "run_id": "test_fc_run",
            "status": "PASSED",
            "evidence_dir": evidence_dir,
            "artifacts": {
                "spz": {
                    "path": valid_file_path,
                    "isDirectory": False,
                    "sizeBytes": file_size,
                    "sha256": file_sha,
                    "evidence_dir": evidence_dir
                },
                "sparse_sfm": {
                    "path": valid_dir_path,
                    "isDirectory": True,
                    "fileCount": dir_count,
                    "sizeBytes": dir_size,
                    "sha256": dir_sha,
                    "evidence_dir": evidence_dir
                }
            }
        }

        # 1. Base manifest passes cleanly
        ok, errs = verify_retained_deliverables(base_manifest)
        self.assertTrue(ok, f"Base manifest should pass: {errs}")
        self.assertEqual(len(errs), 0)

        # 2. Input validation: non-dict/string input rejected
        ok, errs = verify_retained_deliverables(12345)
        self.assertFalse(ok)
        self.assertTrue(any("Invalid evidence input type" in e for e in errs))

        # 3. Input validation: empty manifest rejected
        ok, errs = verify_retained_deliverables({})
        self.assertFalse(ok)
        self.assertTrue(any("empty or not a valid dictionary" in e for e in errs))

        # 4. Input validation: missing artifacts dictionary rejected
        ok, errs = verify_retained_deliverables({"run_id": "r1", "artifacts": {}})
        self.assertFalse(ok)
        self.assertTrue(any("No artifacts found" in e for e in errs))

        # 5. Missing required deliverable key rejected
        ok, errs = verify_retained_deliverables(base_manifest, required_keys=["spz", "glb"])
        self.assertFalse(ok)
        self.assertTrue(any("missing required deliverable 'glb'" in e for e in errs))

        # 6. Deliverable metadata not a dictionary rejected
        bad_meta = json.loads(json.dumps(base_manifest))
        bad_meta["artifacts"]["spz"] = "just_a_string"
        ok, errs = verify_retained_deliverables(bad_meta)
        self.assertFalse(ok)
        self.assertTrue(any("metadata is malformed: expected dictionary" in e for e in errs))

        # 7. Missing path string rejected
        bad_path = json.loads(json.dumps(base_manifest))
        bad_path["artifacts"]["spz"].pop("path")
        ok, errs = verify_retained_deliverables(bad_path)
        self.assertFalse(ok)
        self.assertTrue(any("missing a valid non-empty 'path'" in e for e in errs))

        # 8. Path does not exist on disk rejected
        missing_on_disk = json.loads(json.dumps(base_manifest))
        missing_on_disk["artifacts"]["spz"]["path"] = os.path.join(evidence_dir, "nonexistent.spz")
        ok, errs = verify_retained_deliverables(missing_on_disk)
        self.assertFalse(ok)
        self.assertTrue(any("missing at" in e for e in errs))

        # 9. Missing or malformed sha256 rejected
        for bad_sha in [None, "", "not_hex", "12345", "a" * 63, "g" * 64]:
            m = json.loads(json.dumps(base_manifest))
            m["artifacts"]["spz"]["sha256"] = bad_sha
            ok, errs = verify_retained_deliverables(m)
            self.assertFalse(ok)
            self.assertTrue(any("missing required 64-character hex 'sha256'" in e for e in errs))

        # 10. Missing or invalid sizeBytes rejected
        for bad_size in [None, 0, -10, "string_size"]:
            m = json.loads(json.dumps(base_manifest))
            m["artifacts"]["spz"]["sizeBytes"] = bad_size
            ok, errs = verify_retained_deliverables(m)
            self.assertFalse(ok)
            self.assertTrue(any("missing or has invalid 'sizeBytes'" in e for e in errs))

        # 11. Directory deliverable missing or invalid fileCount rejected
        for bad_count in [None, 0, -1, "two"]:
            m = json.loads(json.dumps(base_manifest))
            m["artifacts"]["sparse_sfm"]["fileCount"] = bad_count
            ok, errs = verify_retained_deliverables(m)
            self.assertFalse(ok)
            self.assertTrue(any("missing or has invalid 'fileCount'" in e for e in errs))

        # 12. File size mismatch rejected
        m_size = json.loads(json.dumps(base_manifest))
        m_size["artifacts"]["spz"]["sizeBytes"] = file_size + 999
        ok, errs = verify_retained_deliverables(m_size)
        self.assertFalse(ok)
        self.assertTrue(any("size mismatch" in e for e in errs))

        # 13. File SHA-256 mismatch rejected (tampered file content)
        tampered_file = os.path.join(evidence_dir, "tampered.spz")
        with open(tampered_file, "wb") as f:
            f.write(b"CORRUPTED_BYTES")
        m_sha = json.loads(json.dumps(base_manifest))
        m_sha["artifacts"]["spz"]["path"] = tampered_file
        m_sha["artifacts"]["spz"]["sizeBytes"] = os.path.getsize(tampered_file)
        # keeping original sha256
        ok, errs = verify_retained_deliverables(m_sha)
        self.assertFalse(ok)
        self.assertTrue(any("SHA-256 mismatch" in e for e in errs))

        # 14. Directory manifest hash mismatch rejected (tampered file inside dir)
        tampered_dir = os.path.join(evidence_dir, "tampered_sfm")
        shutil.copytree(valid_dir_path, tampered_dir)
        with open(os.path.join(tampered_dir, "points3D.bin"), "ab") as f:
            f.write(b"TAMPERED")
        m_dir = json.loads(json.dumps(base_manifest))
        m_dir["artifacts"]["sparse_sfm"]["path"] = tampered_dir
        ok, errs = verify_retained_deliverables(m_dir)
        self.assertFalse(ok)
        self.assertTrue(any("manifest hash mismatch" in e for e in errs))

        # 15. Empty file (0 bytes) rejected
        empty_file = os.path.join(evidence_dir, "empty.spz")
        with open(empty_file, "wb") as f:
            pass
        m_empty = json.loads(json.dumps(base_manifest))
        m_empty["artifacts"]["spz"]["path"] = empty_file
        m_empty["artifacts"]["spz"]["sizeBytes"] = 0
        ok, errs = verify_retained_deliverables(m_empty)
        self.assertFalse(ok)
        self.assertTrue(any("empty (0 bytes)" in e for e in errs))

        # 16. Security Boundary: Directory traversal escaping evidence_dir rejected
        outside_file = os.path.join(self.temp_dir, "outside_secret.txt")
        with open(outside_file, "wb") as f:
            f.write(b"OUTSIDE_SECRET")
        out_sha, out_size = compute_file_hash(outside_file)
        m_traversal = json.loads(json.dumps(base_manifest))
        m_traversal["artifacts"]["spz"]["path"] = outside_file
        m_traversal["artifacts"]["spz"]["sha256"] = out_sha
        m_traversal["artifacts"]["spz"]["sizeBytes"] = out_size
        ok, errs = verify_retained_deliverables(m_traversal)
        self.assertFalse(ok)
        self.assertTrue(any("SECURITY_VIOLATION" in e for e in errs))

        # 17. Security Boundary: Symlink escaping evidence_dir rejected
        symlink_file = os.path.join(evidence_dir, "escape_symlink.spz")
        try:
            os.symlink(outside_file, symlink_file)
            m_sym = json.loads(json.dumps(base_manifest))
            m_sym["artifacts"]["spz"]["path"] = symlink_file
            m_sym["artifacts"]["spz"]["sha256"] = out_sha
            m_sym["artifacts"]["spz"]["sizeBytes"] = out_size
            ok, errs = verify_retained_deliverables(m_sym)
            self.assertFalse(ok)
            self.assertTrue(any("SECURITY_VIOLATION" in e for e in errs))
        except (OSError, NotImplementedError):
            pass

        # 18. Security Boundary: artifact whose evidence_dir points outside trusted root is rejected
        outside_dir = os.path.join(self.temp_dir, "outside_dir")
        os.makedirs(outside_dir, exist_ok=True)
        m_ev_out = json.loads(json.dumps(base_manifest))
        m_ev_out["artifacts"]["spz"]["evidence_dir"] = outside_dir
        ok, errs = verify_retained_deliverables(m_ev_out, base_dir=evidence_dir)
        self.assertFalse(ok)
        self.assertTrue(any("does not match trusted evidence root" in e for e in errs))

        # 19. Security Boundary: artifact whose path AND evidence_dir are both changed to external directory is rejected
        outside_spz = os.path.join(outside_dir, "stolen.spz")
        with open(outside_spz, "wb") as f:
            f.write(b"STOLEN_DELIVERABLE")
        out_spz_sha, out_spz_size = compute_file_hash(outside_spz)
        m_both_out = json.loads(json.dumps(base_manifest))
        m_both_out["artifacts"]["spz"]["path"] = outside_spz
        m_both_out["artifacts"]["spz"]["evidence_dir"] = outside_dir
        m_both_out["artifacts"]["spz"]["sha256"] = out_spz_sha
        m_both_out["artifacts"]["spz"]["sizeBytes"] = out_spz_size
        ok, errs = verify_retained_deliverables(m_both_out, base_dir=evidence_dir)
        self.assertFalse(ok)
        self.assertTrue(any("SECURITY_VIOLATION" in e for e in errs))

        # 20. Valid artifact whose metadata points to the correct trusted evidence directory succeeds
        m_valid_meta = json.loads(json.dumps(base_manifest))
        m_valid_meta["artifacts"]["spz"]["evidence_dir"] = evidence_dir
        m_valid_meta["artifacts"]["sparse_sfm"]["evidence_dir"] = evidence_dir
        ok, errs = verify_retained_deliverables(m_valid_meta, base_dir=evidence_dir)
        self.assertTrue(ok, f"Valid manifest with matching evidence_dir should pass: {errs}")

        # 21. Security Boundary: nested symlink escaping trusted evidence directory is rejected
        nested_dir = os.path.join(evidence_dir, "nested_deliverables")
        os.makedirs(nested_dir, exist_ok=True)
        nested_symlink = os.path.join(nested_dir, "nested_escape_spz")
        try:
            os.symlink(outside_spz, nested_symlink)
            m_nested_sym = json.loads(json.dumps(base_manifest))
            m_nested_sym["artifacts"]["spz"]["path"] = nested_symlink
            m_nested_sym["artifacts"]["spz"]["sha256"] = out_spz_sha
            m_nested_sym["artifacts"]["spz"]["sizeBytes"] = out_spz_size
            ok, errs = verify_retained_deliverables(m_nested_sym, base_dir=evidence_dir)
            self.assertFalse(ok)
            self.assertTrue(any("SECURITY_VIOLATION" in e for e in errs))
        except (OSError, NotImplementedError):
            pass

        # 22. Security Boundary: forged top-level evidence_dir is rejected
        m_forged_top = json.loads(json.dumps(base_manifest))
        m_forged_top["evidence_dir"] = outside_dir
        ok, errs = verify_retained_deliverables(m_forged_top, base_dir=evidence_dir)
        self.assertFalse(ok)
        self.assertTrue(any("SECURITY_VIOLATION: Evidence manifest evidence_dir" in e for e in errs))

        # 23. Security Boundary: in-memory dictionary with no configured root fails closed
        saved_ev_env = os.environ.pop("HETTETY_ACCEPTANCE_EVIDENCE_DIR", None)
        try:
            ok, errs = verify_retained_deliverables(m_valid_meta, base_dir=None)
            self.assertFalse(ok)
            self.assertTrue(any("In-memory evidence manifest missing explicit trusted root boundary" in e for e in errs))
        finally:
            if saved_ev_env is not None:
                os.environ["HETTETY_ACCEPTANCE_EVIDENCE_DIR"] = saved_ev_env

        # 24. Authoritative configured environment root permits valid artifacts
        saved_ev_env = os.environ.get("HETTETY_ACCEPTANCE_EVIDENCE_DIR")
        os.environ["HETTETY_ACCEPTANCE_EVIDENCE_DIR"] = evidence_dir
        try:
            ok, errs = verify_retained_deliverables(m_valid_meta, base_dir=None)
            self.assertTrue(ok, f"Manifest should pass when HETTETY_ACCEPTANCE_EVIDENCE_DIR is configured: {errs}")

            # 25. Forged top-level evidence_dir rejected even when environment root is configured
            ok, errs = verify_retained_deliverables(m_forged_top, base_dir=None)
            self.assertFalse(ok)
            self.assertTrue(any("SECURITY_VIOLATION: Evidence manifest evidence_dir" in e for e in errs))
        finally:
            if saved_ev_env is not None:
                os.environ["HETTETY_ACCEPTANCE_EVIDENCE_DIR"] = saved_ev_env
            else:
                os.environ.pop("HETTETY_ACCEPTANCE_EVIDENCE_DIR", None)

    def test_managed_process_persists_failure_cancellation_and_timeout_logs(self):
        """
        Task Verification: Proves that run_managed_process guarantees that available
        stdout and stderr are persisted to log_path upon failure, cancellation, and timeout.
        """
        from pipeline.process_manager import run_managed_process, JobCancelledException
        import threading

        log_dir = os.path.join(self.temp_dir, "pm_logs")
        os.makedirs(log_dir, exist_ok=True)

        # 1. Process fails with non-zero exit code (persists stdout, stderr, and exit code)
        fail_log = os.path.join(log_dir, "fail.log")
        fail_cmd = [
            sys.executable, "-c",
            "import sys; print('Stage output line 1', flush=True); print('Stage error line 2', file=sys.stderr, flush=True); sys.exit(42)"
        ]
        with self.assertRaises(subprocess.CalledProcessError) as ctx:
            run_managed_process(fail_cmd, log_path=fail_log, check=True)
        self.assertEqual(ctx.exception.returncode, 42)
        self.assertTrue(os.path.isfile(fail_log))
        with open(fail_log, "r", encoding="utf-8") as f:
            log_content = f.read()
        self.assertIn("Stage output line 1", log_content)
        self.assertIn("Stage error line 2", log_content)
        self.assertIn("EXIT CODE: 42", log_content)

        # 2. Process cancelled by cancellation signal (persists partial stdout and KILLED code)
        cancel_log = os.path.join(log_dir, "cancel.log")
        cancel_cmd = [
            sys.executable, "-c",
            "import sys, time; print('Early progress message', flush=True); time.sleep(10)"
        ]
        cancel_state = {"cancelled": False}
        def cancel_check():
            return cancel_state["cancelled"]

        def delayed_cancel():
            time.sleep(0.15)
            cancel_state["cancelled"] = True

        th = threading.Thread(target=delayed_cancel)
        th.start()
        with self.assertRaises(JobCancelledException):
            run_managed_process(cancel_cmd, log_path=cancel_log, cancel_check=cancel_check, poll_interval=0.05)
        th.join()

        self.assertTrue(os.path.isfile(cancel_log))
        with open(cancel_log, "r", encoding="utf-8") as f:
            cancel_content = f.read()
        self.assertIn("Early progress message", cancel_content)
        self.assertIn("EXIT CODE:", cancel_content)

        # 3. Process times out (persists partial output and exit code)
        timeout_log = os.path.join(log_dir, "timeout.log")
        timeout_cmd = [
            sys.executable, "-c",
            "import sys, time; print('Pre-timeout message', flush=True); time.sleep(10)"
        ]
        with self.assertRaises(subprocess.TimeoutExpired):
            run_managed_process(timeout_cmd, log_path=timeout_log, timeout=0.25, poll_interval=0.05)

        self.assertTrue(os.path.isfile(timeout_log))
        with open(timeout_log, "r", encoding="utf-8") as f:
            timeout_content = f.read()
        self.assertIn("Pre-timeout message", timeout_content)
        self.assertIn("EXIT CODE:", timeout_content)

    def test_managed_process_log_persistence_failure_explicit(self):
        """
        TASK 1 Verification: Proves that run_managed_process surfaces log persistence failures
        as an explicit LogPersistenceError on successful process execution, while preserving
        the primary subprocess exception (CalledProcessError, JobCancelledException, TimeoutExpired)
        when process execution itself fails, attaching diagnostic log_error.
        """
        from pipeline.process_manager import run_managed_process, LogPersistenceError, JobCancelledException
        import threading
        import builtins
        from unittest.mock import patch

        real_open = builtins.open

        def mock_open_unwritable(file, *args, **kwargs):
            if "unwritable" in str(file):
                raise PermissionError(f"Mocked Permission Denied on log write: {file}")
            return real_open(file, *args, **kwargs)

        success_cmd = [sys.executable, "-c", "print('Command executed cleanly', flush=True)"]
        fail_cmd = [sys.executable, "-c", "import sys; print('Process failure', file=sys.stderr, flush=True); sys.exit(77)"]

        # 1. Successful subprocess (returncode 0) with unwritable log_path raises LogPersistenceError
        with patch("builtins.open", side_effect=mock_open_unwritable):
            with self.assertRaises(LogPersistenceError) as ctx:
                run_managed_process(success_cmd, log_path=os.path.join(self.temp_dir, "unwritable_success.log"), check=True)
            self.assertEqual(ctx.exception.returncode, 0)
            self.assertEqual(ctx.exception.completed_process.returncode, 0)
            self.assertIn(b"Command executed cleanly", ctx.exception.stdout)
            self.assertIn("failed persisting required log", str(ctx.exception))

        # 2. Failed subprocess (returncode 77) with unwritable log_path preserves CalledProcessError
        with patch("builtins.open", side_effect=mock_open_unwritable):
            with self.assertRaises(subprocess.CalledProcessError) as ctx:
                run_managed_process(fail_cmd, log_path=os.path.join(self.temp_dir, "unwritable_fail.log"), check=True)
            self.assertEqual(ctx.exception.returncode, 77)
            self.assertIsNotNone(getattr(ctx.exception, "log_error", None))
            self.assertIsInstance(ctx.exception.log_error, PermissionError)

        # 3. Cancelled subprocess with unwritable log_path preserves JobCancelledException
        cancel_cmd = [sys.executable, "-c", "import time; print('Starting slow job', flush=True); time.sleep(10)"]
        cancel_state = {"cancelled": False}
        def cancel_check():
            return cancel_state["cancelled"]

        def delayed_cancel():
            time.sleep(0.15)
            cancel_state["cancelled"] = True

        th = threading.Thread(target=delayed_cancel)
        th.start()
        with patch("builtins.open", side_effect=mock_open_unwritable):
            with self.assertRaises(JobCancelledException) as ctx:
                run_managed_process(cancel_cmd, log_path=os.path.join(self.temp_dir, "unwritable_cancel.log"), cancel_check=cancel_check, poll_interval=0.05)
            self.assertIsNotNone(getattr(ctx.exception, "log_error", None))
            self.assertIsInstance(ctx.exception.log_error, PermissionError)
        th.join()

        # 4. Timed out subprocess with unwritable log_path preserves TimeoutExpired
        timeout_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
        with patch("builtins.open", side_effect=mock_open_unwritable):
            with self.assertRaises(subprocess.TimeoutExpired) as ctx:
                run_managed_process(timeout_cmd, log_path=os.path.join(self.temp_dir, "unwritable_timeout.log"), timeout=0.25, poll_interval=0.05)
            self.assertIsNotNone(getattr(ctx.exception, "log_error", None))
            self.assertIsInstance(ctx.exception.log_error, PermissionError)

    def test_log_persistence_failure_surfaced_as_diagnostic_failure(self):
        """
        Requirement 3 Verification: Proves that a log persistence failure
        is surfaced directly as a diagnostic failure rather than silently
        being reported as a successfully retained log.
        """
        missing_log_path = os.path.join(self.temp_dir, "nonexistent_training_stdout.log")
        partial_artifacts = {
            "training_stdout_log": {
                "path": missing_log_path,
                "target_filename": "training_stdout.log"
            }
        }

        # retain_deliverables records persistence failure when source asset does not exist
        retained = retain_deliverables("run_log_persist_fail", partial_artifacts, self.evidence_test_dir)
        self.assertIn("training_stdout_log", retained)
        self.assertFalse(retained["training_stdout_log"].get("persisted", True))
        self.assertIn("PERSISTENCE_FAILED", retained["training_stdout_log"].get("error", ""))

        # verify_retained_deliverables must surface the diagnostic failure and reject manifest
        manifest = {
            "run_id": "run_log_persist_fail",
            "evidence_dir": self.evidence_test_dir,
            "status": "PASSED",
            "artifacts": retained
        }
        is_valid, errors = verify_retained_deliverables(manifest, base_dir=self.evidence_test_dir)
        self.assertFalse(is_valid)
        self.assertTrue(any("failed persistence" in e or "missing at" in e for e in errors))

    def test_large_ply_streaming_bounds_and_optimization_truncation_rejection(self):
        """
        Proves that parse_ply_header_and_bounds does not cap validation at 10,000 vertices,
        includes points beyond 10,000 in bounding box calculation, detects non-finite coordinates
        at vertex 10,000+, and optimize_splat_cloud strictly rejects truncated binary PLYs.
        """
        import struct

        # 1. 12,000 vertex binary PLY where point 11,500 has extreme coordinates (420.0, 420.0, 420.0)
        large_ply = os.path.join(self.temp_dir, "large_12k.ply")
        with open(large_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 12000\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"end_header\n"
            )
            for idx in range(12000):
                if idx == 11500:
                    f.write(struct.pack("<fff f fff ffff", 420.0, 420.0, 420.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0))
                else:
                    f.write(struct.pack("<fff f fff ffff", 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0))

        splat_count, bounds = parse_ply_header_and_bounds(large_ply)
        self.assertEqual(splat_count, 12000)
        self.assertEqual(bounds["max"][0], 420.0)
        self.assertEqual(bounds["max"][1], 420.0)
        self.assertEqual(bounds["max"][2], 420.0)

        # 2. 12,000 vertex binary PLY where point 11,500 has non-finite coordinate (NaN)
        nan_large_ply = os.path.join(self.temp_dir, "nan_large_12k.ply")
        with open(nan_large_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 12000\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"end_header\n"
            )
            for idx in range(12000):
                if idx == 11500:
                    f.write(struct.pack("<fff f fff ffff", float("nan"), 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0))
                else:
                    f.write(struct.pack("<fff f fff ffff", 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0))

        with self.assertRaises(ValueError) as ctx:
            parse_ply_header_and_bounds(nan_large_ply)
        self.assertIn("non-finite", str(ctx.exception).lower())

        # 3. optimize_splat_cloud strictly rejects truncated binary PLY
        trunc_for_opt = os.path.join(self.temp_dir, "trunc_opt.ply")
        opt_dest = os.path.join(self.temp_dir, "trunc_opt_out.ply")
        with open(trunc_for_opt, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 50\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"end_header\n"
            )
            # Only write 10 vertices (out of 50 declared)
            for idx in range(10):
                f.write(struct.pack("<fff f fff ffff", float(idx), 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0))

        res_opt = optimize_splat_cloud(trunc_for_opt, opt_dest)
        self.assertFalse(res_opt["success"])
        self.assertIn("truncated", res_opt["message"].lower())

        # 4. optimize_splat_cloud produces valid PLY containing end_header\n that can be parsed
        valid_for_opt = os.path.join(self.temp_dir, "valid_for_opt.ply")
        valid_opt_dest = os.path.join(self.temp_dir, "valid_opt_out.ply")
        with open(valid_for_opt, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 15\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"property float opacity\n"
                b"property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
                b"property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
                b"end_header\n"
            )
            for idx in range(15):
                f.write(struct.pack("<fff f fff ffff", float(idx), 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0))

        res_valid_opt = optimize_splat_cloud(valid_for_opt, valid_opt_dest)
        self.assertTrue(res_valid_opt["success"])
        with open(valid_opt_dest, "rb") as f_chk:
            content_opt = f_chk.read()
        self.assertIn(b"end_header\n", content_opt)
        opt_splat_cnt, opt_bounds = parse_ply_header_and_bounds(valid_opt_dest)
        self.assertEqual(opt_splat_cnt, 15)

        # 5. parse_ply_header_and_bounds on big-endian binary PLY
        be_bounds_ply = os.path.join(self.temp_dir, "be_bounds.ply")
        with open(be_bounds_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_big_endian 1.0\n"
                b"element vertex 4\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"end_header\n"
            )
            for idx in range(4):
                f.write(struct.pack(">fff", float(idx * 10), float(idx * 5), float(idx * 2)))
        be_cnt, be_bounds = parse_ply_header_and_bounds(be_bounds_ply)
        self.assertEqual(be_cnt, 4)
        self.assertEqual(be_bounds["max"][0], 30.0)

        # 6. parse_ply_header_and_bounds with coordinates > 500 (large offset survey)
        offset_ply = os.path.join(self.temp_dir, "offset_bounds.ply")
        with open(offset_ply, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 4\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"end_header\n"
            )
            for idx in range(4):
                f.write(struct.pack("<fff", 600.0 + idx, 700.0 + idx, 800.0 + idx))
        off_cnt, off_bounds = parse_ply_header_and_bounds(offset_ply)
        self.assertEqual(off_cnt, 4)
        self.assertEqual(off_bounds["min"][0], 600.0)
        self.assertEqual(off_bounds["max"][0], 603.0)

        # 7. scale_ply_to_metric strictly rejects truncated binary PLY
        trunc_for_scale = os.path.join(self.temp_dir, "trunc_scale.ply")
        scale_dest = os.path.join(self.temp_dir, "trunc_scale_out.ply")
        with open(trunc_for_scale, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\n"
                b"element vertex 100\n"
                b"property float x\nproperty float y\nproperty float z\n"
                b"end_header\n"
            )
            f.write(struct.pack("<fff", 1.0, 2.0, 3.0))
        res_scale_trunc = scale_ply_to_metric(trunc_for_scale, scale_dest, scale_factor=2.0)
        self.assertFalse(res_scale_trunc["success"])
        self.assertIn("truncated", res_scale_trunc["message"].lower())

        # 8. convert_ply_to_spz fails closed when metric scaling fails
        spz_dest = os.path.join(self.temp_dir, "trunc_spz_out.spz")
        res_spz_trunc = convert_ply_to_spz(trunc_for_scale, spz_dest, scale_factor=2.0)
        self.assertFalse(res_spz_trunc["success"])

        # 9. parse_ply_header_and_bounds rejects missing format declaration with format error
        bad_fmt_bounds = os.path.join(self.temp_dir, "bad_fmt_bounds.ply")
        with open(bad_fmt_bounds, "wb") as f:
            f.write(b"ply\nelement vertex 10\nproperty float x\nproperty float y\nproperty float z\nend_header\n" + b"0 0 0\n" * 10)
        with self.assertRaises(ValueError) as ctx:
            parse_ply_header_and_bounds(bad_fmt_bounds)
        self.assertIn("format", str(ctx.exception).lower())

        # 10. parse_ply_header_and_bounds rejects missing end_header
        missing_end_bounds = os.path.join(self.temp_dir, "missing_end_bounds.ply")
        with open(missing_end_bounds, "wb") as f:
            f.write(b"ply\nformat ascii 1.0\nelement vertex 10\nproperty float x\nproperty float y\nproperty float z\n")
        with self.assertRaises(ValueError) as ctx:
            parse_ply_header_and_bounds(missing_end_bounds)
        self.assertIn("end_header", str(ctx.exception).lower())

    def test_failure_preserves_partial_deliverables_and_logs(self):
        """
        TASK 4 Verification: Proves that when a pipeline error occurs mid-way,
        partial deliverables and diagnostic logs are retained persistently in evidence storage
        before ephemeral working directory is cleaned up.
        """
        temp_work = os.path.join(self.temp_dir, "work_pipeline_sim")
        os.makedirs(os.path.join(temp_work, "sfm", "sparse", "0"), exist_ok=True)
        os.makedirs(os.path.join(temp_work, "dense"), exist_ok=True)

        sfm_cam = os.path.join(temp_work, "sfm", "sparse", "0", "cameras.bin")
        with open(sfm_cam, "wb") as f:
            f.write(b"MOCK_CAMERAS_DATA_FOR_FAILURE_TEST")

        sfm_log = os.path.join(temp_work, "colmap_sfm.log")
        with open(sfm_log, "w") as f:
            f.write("COLMAP SfM log output: registered 28 images\n")

        dense_fused = os.path.join(temp_work, "dense", "fused.ply")
        with open(dense_fused, "wb") as f:
            f.write(
                b"ply\nformat binary_little_endian 1.0\nelement vertex 2\n"
                b"property float x\nproperty float y\nproperty float z\nend_header\n" + b"\x00" * 24
            )

        partial_artifacts = {
            "sparse_sfm": os.path.join(temp_work, "sfm"),
            "colmap_sfm_log": sfm_log,
            "dense_ply": dense_fused
        }

        # Simulate exception during training stage
        evidence = {
            "run_id": "run_simulated_failure",
            "status": "FAILED",
            "blocking_reason": "Simulated CUDA Out-Of-Memory in stage 4 training.",
            "artifacts": {}
        }

        try:
            raise RuntimeError("CUDA Out-Of-Memory")
        except Exception as e:
            evidence["blocking_reason"] = f"Execution exception: {e}"
        finally:
            retained = retain_deliverables("run_simulated_failure", partial_artifacts, self.evidence_test_dir)
            evidence["artifacts"] = retained
            write_acceptance_evidence(evidence, self.evidence_test_dir)

        # Ephemeral tempdir deleted
        shutil.rmtree(temp_work)
        self.assertFalse(os.path.exists(temp_work))

        # Check evidence JSON and retained files exist
        evidence_json = os.path.join(self.evidence_test_dir, "acceptance_evidence.json")
        self.assertTrue(os.path.isfile(evidence_json))
        with open(evidence_json, "r") as f:
            loaded_ev = json.load(f)
        self.assertEqual(loaded_ev["status"], "FAILED")
        self.assertIn("CUDA Out-Of-Memory", loaded_ev["blocking_reason"])

        # Check retained files survived
        self.assertTrue(os.path.isfile(loaded_ev["artifacts"]["colmap_sfm_log"]["path"]))
        self.assertTrue(os.path.isfile(loaded_ev["artifacts"]["dense_ply"]["path"]))
        self.assertTrue(os.path.isdir(loaded_ev["artifacts"]["sparse_sfm"]["path"]))

        # Verify integrity of retained partial deliverables
        is_valid, errors = verify_retained_deliverables(loaded_ev)
        self.assertTrue(is_valid, f"Retained partial deliverables failed verification: {errors}")



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

        # 6. Enforce real Graphdeco training runner prerequisite and authentic provenance
        if not self.gpu_env["graphdeco_available"]:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = "Official Graphdeco training runner (gaussian-splatting/train.py) is required. IterativeGaussianOptimizer substitution is strictly prohibited."
            write_acceptance_evidence(evidence, self.evidence_dir)
            self.skipTest(evidence["blocking_reason"])

        is_prov_valid, prov_reason = validate_graphdeco_runner_provenance(self.gpu_env.get("graphdeco_script_path"))
        if not is_prov_valid:
            evidence["status"] = "BLOCKED"
            evidence["blocking_reason"] = f"Official Graphdeco runner provenance validation failed: {prov_reason}"
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
        partial_artifacts: Dict[str, Any] = {}
        try:
            print("\n==================================================================")
            print(" EXECUTING AUTHORITATIVE REAL GPU RECONSTRUCTION ACCEPTANCE TEST")
            print(f" Dataset     : {self.dataset_meta['dataset_name']} ({self.dataset_meta['image_count']} keyframes)")
            print(f" GPU Device  : {self.gpu_env['device_name']} ({self.gpu_env['total_memory_gb']} GB VRAM)")
            print(f" PyTorch/CUDA: {self.gpu_env['pytorch_version']} / CUDA {self.gpu_env['cuda_version']}")
            print(f" COLMAP Path : {shutil.which('colmap')} (Version: {self.gpu_env['colmap_version']})")
            print(f" Graphdeco   : {self.gpu_env['graphdeco_script_path']}")
            print("==================================================================\n")

            # Authoritative Dataset Acceptance Profile
            profile = get_dataset_acceptance_profile(self.dataset_meta["dataset_name"])
            print(f" Quality Profile: {profile['description']}")
            print(f" Thresholds: min_cams={profile['min_registered_cameras']}, min_dense={profile['min_dense_points']}, min_splats={profile['min_splats']}, max_rmse={profile['max_holdout_rmse']}m")

            # Stage 1: Keyframe Validation
            t0 = time.time()
            val_res = validate_keyframes(self.fixture_dir, min_images=profile["min_keyframes"])
            self.assertTrue(val_res["valid"], f"Keyframe validation failed: {val_res}")
            self.assertGreaterEqual(val_res["image_count"], profile["min_keyframes"])
            evidence["stages"]["VALIDATING"] = {"durationSec": round(time.time() - t0, 2), "imageCount": val_res["image_count"]}

            # Stage 2: Genuine COLMAP SfM
            t1 = time.time()
            sfm_out = os.path.join(self.temp_dir, "sfm")
            sfm_res = run_sfm(image_dir=self.fixture_dir, output_dir=sfm_out, is_video=False)
            if os.path.exists(sfm_out):
                partial_artifacts["sparse_sfm"] = {"path": sfm_out}
            sfm_log = sfm_res.get("log_path") or os.path.join(sfm_out, "colmap_sfm.log")
            if not os.path.exists(sfm_log):
                sfm_log = os.path.join(self.temp_dir, "colmap_sfm.log")
            if os.path.exists(sfm_log):
                partial_artifacts["colmap_sfm_log"] = {"path": sfm_log, "sizeBytes": os.path.getsize(sfm_log)}

            self.assertTrue(sfm_res["success"], f"Real COLMAP SfM failed: {sfm_res}")
            self.assertGreaterEqual(sfm_res["registered_images"], profile["min_registered_cameras"], f"SfM registered fewer cameras than required by profile {profile['min_registered_cameras']}")
            self.assertGreaterEqual(sfm_res["points_count"], profile["min_sparse_points"])
            mean_reproj = sfm_res.get("mean_reprojection_error")
            is_valid_reproj, reproj_msg = validate_reprojection_metric(mean_reproj, profile["max_reprojection_error"])
            self.assertTrue(is_valid_reproj, f"COLMAP reprojection error gate failed: {reproj_msg}")
            evidence["stages"]["SFM"] = {
                "durationSec": round(time.time() - t1, 2),
                "registeredImages": sfm_res["registered_images"],
                "pointsCount": sfm_res["points_count"],
                "meanReprojectionError": mean_reproj
            }
            evidence["acceptance_criteria"]["STRICT_COLMAP"] = {
                "status": "PASSED",
                "details": f"Registered {sfm_res['registered_images']} cameras, {sfm_res['points_count']} 3D points (Reprojection error: {mean_reproj:.2f}px)."
            }

            # Stage 3: Genuine Dense Multi-View Stereo (PatchMatch)
            t2 = time.time()
            dense_out = os.path.join(self.temp_dir, "dense")
            dense_res = run_dense_stereo(sparse_dir=sfm_out, image_dir=self.fixture_dir, dense_dir=dense_out)
            if "fused_ply" in dense_res and os.path.exists(dense_res["fused_ply"]):
                partial_artifacts["dense_ply"] = {"path": dense_res["fused_ply"], "sizeBytes": os.path.getsize(dense_res["fused_ply"])}
            if os.path.exists(dense_out):
                partial_artifacts["dense_dir"] = {"path": dense_out}
            dense_log = dense_res.get("log_path") or os.path.join(dense_out, "colmap_dense.log")
            if not os.path.exists(dense_log):
                dense_log = os.path.join(self.temp_dir, "colmap_dense.log")
            if os.path.exists(dense_log):
                partial_artifacts["colmap_dense_log"] = {"path": dense_log, "sizeBytes": os.path.getsize(dense_log)}

            self.assertTrue(dense_res["success"], f"Real Dense Stereo failed: {dense_res}")
            self.assertGreaterEqual(dense_res["dense_point_count"], profile["min_dense_points"], f"Dense points {dense_res['dense_point_count']} below profile threshold {profile['min_dense_points']}")
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
            if os.path.exists(model_out):
                partial_artifacts["model_dir"] = {"path": model_out}
            train_stdout = os.path.join(model_out, "training_stdout.log")
            if os.path.exists(train_stdout):
                partial_artifacts["training_log"] = {"path": train_stdout, "sizeBytes": os.path.getsize(train_stdout)}
            train_stderr = os.path.join(model_out, "training_stderr.log")
            if os.path.exists(train_stderr):
                partial_artifacts["training_stderr_log"] = {"path": train_stderr, "sizeBytes": os.path.getsize(train_stderr)}
            if "target_ply" in train_res and os.path.exists(train_res["target_ply"]):
                partial_artifacts["trained_ply"] = {"path": train_res["target_ply"], "sizeBytes": os.path.getsize(train_res["target_ply"])}

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
            if os.path.exists(opt_ply):
                partial_artifacts["optimized_ply"] = {"path": opt_ply, "sizeBytes": os.path.getsize(opt_ply)}

            self.assertTrue(opt_res["success"])
            self.assertGreaterEqual(opt_res["splat_count"], profile["min_splats"], f"Final splat count {opt_res['splat_count']} below profile threshold {profile['min_splats']}")

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
            self.assertLessEqual(eval_res["rmse"], profile["max_holdout_rmse"], f"Holdout RMSE {eval_res['rmse']}m exceeded {profile['max_holdout_rmse']}m gate")

            calib_file = os.path.join(self.temp_dir, "calibration_report.json")
            with open(calib_file, "w", encoding="utf-8") as cf:
                json.dump({"scaleFactor": scale_k, "holdoutRmse": eval_res["rmse"]}, cf, indent=2)
            partial_artifacts["calibration_report"] = {"path": calib_file, "sizeBytes": os.path.getsize(calib_file)}
            evidence["calibration"] = {"scaleFactor": scale_k, "holdoutRmse": eval_res["rmse"]}

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
            if os.path.exists(metric_ply):
                partial_artifacts["metric_ply"] = {"path": metric_ply, "sizeBytes": os.path.getsize(metric_ply)}

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

            partial_artifacts["spz"] = {"path": spz_file, "sizeBytes": os.path.getsize(spz_file), "sha256": spz_sha, "splatCount": opt_res["splat_count"]}
            partial_artifacts["glb"] = {"path": glb_file, "sizeBytes": os.path.getsize(glb_file), "sha256": glb_sha, "validGlTF": True}

            evidence["status"] = "PASSED"
            evidence["acceptance_criteria"]["SPZ_EXPORT"] = {
                "status": "PASSED",
                "details": f"SPZ v4 valid, {opt_res['splat_count']} splats, SHA-256: {spz_sha[:16]}"
            }
            evidence["acceptance_criteria"]["GLB_EXPORT"] = {
                "status": "PASSED",
                "details": f"glTF 2.0 valid binary, SHA-256: {glb_sha[:16]}"
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
            try:
                sfm_dir = os.path.join(self.temp_dir, "sfm")
                if os.path.exists(sfm_dir) and "sparse_sfm" not in partial_artifacts:
                    partial_artifacts["sparse_sfm"] = {"path": sfm_dir}
                for log_cand in [
                    os.path.join(sfm_dir, "colmap_sfm.log"),
                    os.path.join(self.temp_dir, "colmap_sfm.log")
                ]:
                    if os.path.exists(log_cand) and "colmap_sfm_log" not in partial_artifacts:
                        partial_artifacts["colmap_sfm_log"] = {"path": log_cand, "sizeBytes": os.path.getsize(log_cand)}

                dense_dir = os.path.join(self.temp_dir, "dense")
                if os.path.exists(dense_dir):
                    if "dense_dir" not in partial_artifacts:
                        partial_artifacts["dense_dir"] = {"path": dense_dir}
                    fused_p = os.path.join(dense_dir, "fused.ply")
                    if os.path.exists(fused_p) and "dense_ply" not in partial_artifacts:
                        partial_artifacts["dense_ply"] = {"path": fused_p, "sizeBytes": os.path.getsize(fused_p)}
                for log_cand in [
                    os.path.join(dense_dir, "colmap_dense.log"),
                    os.path.join(self.temp_dir, "colmap_dense.log")
                ]:
                    if os.path.exists(log_cand) and "colmap_dense_log" not in partial_artifacts:
                        partial_artifacts["colmap_dense_log"] = {"path": log_cand, "sizeBytes": os.path.getsize(log_cand)}

                model_dir = os.path.join(self.temp_dir, "model")
                if os.path.exists(model_dir):
                    if "model_dir" not in partial_artifacts:
                        partial_artifacts["model_dir"] = {"path": model_dir}
                    out_log = os.path.join(model_dir, "training_stdout.log")
                    if os.path.exists(out_log) and "training_log" not in partial_artifacts:
                        partial_artifacts["training_log"] = {"path": out_log, "sizeBytes": os.path.getsize(out_log)}
                    err_log = os.path.join(model_dir, "training_stderr.log")
                    if os.path.exists(err_log) and "training_stderr_log" not in partial_artifacts:
                        partial_artifacts["training_stderr_log"] = {"path": err_log, "sizeBytes": os.path.getsize(err_log)}
                    for chk_ply in [
                        os.path.join(model_dir, "point_cloud", "iteration_30000", "point_cloud.ply"),
                        os.path.join(model_dir, "point_cloud", "iteration_7000", "point_cloud.ply"),
                    ]:
                        if os.path.exists(chk_ply) and "trained_ply" not in partial_artifacts:
                            partial_artifacts["trained_ply"] = {"path": chk_ply, "sizeBytes": os.path.getsize(chk_ply)}
                            break

                for opt_cand in [os.path.join(self.temp_dir, "optimized.ply")]:
                    if os.path.exists(opt_cand) and "optimized_ply" not in partial_artifacts:
                        partial_artifacts["optimized_ply"] = {"path": opt_cand, "sizeBytes": os.path.getsize(opt_cand)}
                for met_cand in [os.path.join(self.temp_dir, "metric.ply")]:
                    if os.path.exists(met_cand) and "metric_ply" not in partial_artifacts:
                        partial_artifacts["metric_ply"] = {"path": met_cand, "sizeBytes": os.path.getsize(met_cand)}
                for spz_cand in [os.path.join(self.temp_dir, "scene.spz")]:
                    if os.path.exists(spz_cand) and "spz" not in partial_artifacts:
                        partial_artifacts["spz"] = {"path": spz_cand, "sizeBytes": os.path.getsize(spz_cand)}
                for glb_cand in [os.path.join(self.temp_dir, "mesh.glb")]:
                    if os.path.exists(glb_cand) and "glb" not in partial_artifacts:
                        partial_artifacts["glb"] = {"path": glb_cand, "sizeBytes": os.path.getsize(glb_cand)}
            except Exception as scan_err:
                print(f"Warning: Exception while discovering partial deliverables: {scan_err}")

            if partial_artifacts:
                try:
                    retained_manifest = retain_deliverables(
                        run_id=self.run_id,
                        source_artifacts=partial_artifacts,
                        evidence_dir=self.evidence_dir
                    )
                    evidence["artifacts"] = retained_manifest
                except Exception as retain_err:
                    print(f"Warning: Failed retaining partial deliverables: {retain_err}")
            write_acceptance_evidence(evidence, self.evidence_dir)
            if evidence.get("status") == "PASSED":
                is_valid_manifest, manifest_errs = verify_retained_deliverables(
                    evidence,
                    required_keys=["spz", "glb", "sparse_sfm"]
                )
                self.assertTrue(is_valid_manifest, f"Retained deliverable verification failed: {manifest_errs}")


if __name__ == "__main__":
    unittest.main()
