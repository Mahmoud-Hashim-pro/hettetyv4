"""
HETTETY v4 — Unit Tests for GPU Runner Preflight Verification Script
"""

import json
import os
import subprocess
import sys
import unittest
from unittest.mock import MagicMock, patch

from scripts.gpu_runner_preflight import (
    check_python_version,
    check_pytest_installed,
    check_cuda_and_pytorch,
    check_gpu_hardware,
    check_colmap_binary,
    check_graphdeco_submodules,
    check_graphdeco_provenance,
    check_acceptance_dataset,
    run_all_preflight_checks,
    main
)


class TestGPURunnerPreflight(unittest.TestCase):
    def test_check_python_version(self):
        passed, msg, details = check_python_version()
        self.assertTrue(passed)
        self.assertIn("Python", msg)

        with patch.object(sys, "version_info", (3, 9, 2)):
            passed_old, msg_old, _ = check_python_version()
            self.assertFalse(passed_old)
            self.assertIn("below required 3.10+", msg_old)

    def test_check_pytest_installed(self):
        passed, msg, details = check_pytest_installed()
        self.assertTrue(passed)
        self.assertIn("pytest_version", details)

    def test_check_cuda_and_pytorch(self):
        # 1. torch not installed
        with patch.dict(sys.modules, {"torch": None}):
            passed, msg, _ = check_cuda_and_pytorch()
            self.assertFalse(passed)
            self.assertIn("not installed", msg)

        # 2. torch without CUDA
        mock_torch_no_cuda = MagicMock()
        mock_torch_no_cuda.cuda.is_available.return_value = False
        with patch.dict(sys.modules, {"torch": mock_torch_no_cuda}):
            passed, msg, _ = check_cuda_and_pytorch()
            self.assertFalse(passed)
            self.assertIn("No CUDA runtime detected", msg)

        # 3. torch with CUDA < 11.8
        mock_torch_old_cuda = MagicMock()
        mock_torch_old_cuda.cuda.is_available.return_value = True
        mock_torch_old_cuda.version.cuda = "11.6"
        with patch.dict(sys.modules, {"torch": mock_torch_old_cuda}):
            passed, msg, _ = check_cuda_and_pytorch()
            self.assertFalse(passed)
            self.assertIn("below required 11.8+", msg)

        # 4. torch with CUDA >= 11.8
        mock_torch_valid = MagicMock()
        mock_torch_valid.cuda.is_available.return_value = True
        mock_torch_valid.version.cuda = "12.1"
        mock_torch_valid.__version__ = "2.1.2"
        with patch.dict(sys.modules, {"torch": mock_torch_valid}):
            passed, msg, details = check_cuda_and_pytorch()
            self.assertTrue(passed)
            self.assertEqual(details["cuda_version"], "12.1")

    def test_check_gpu_hardware(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = True
        mock_torch.cuda.device_count.return_value = 1
        mock_torch.cuda.get_device_name.return_value = "NVIDIA RTX 4090"

        # Case A: Low compute capability (< 7.0)
        props_old = MagicMock()
        props_old.major = 6
        props_old.minor = 1
        props_old.total_memory = 24 * (1024 ** 3)
        mock_torch.cuda.get_device_properties.return_value = props_old

        with patch.dict(sys.modules, {"torch": mock_torch}):
            passed, msg, _ = check_gpu_hardware()
            self.assertFalse(passed)
            self.assertIn("compute capability 6.1", msg)

        # Case B: Low VRAM (< 11.5 GB)
        props_low_vram = MagicMock()
        props_low_vram.major = 8
        props_low_vram.minor = 6
        props_low_vram.total_memory = 8 * (1024 ** 3)
        mock_torch.cuda.get_device_properties.return_value = props_low_vram

        with patch.dict(sys.modules, {"torch": mock_torch}):
            passed, msg, _ = check_gpu_hardware()
            self.assertFalse(passed)
            self.assertIn("below required 11.5 GiB", msg)

        # Case C: Valid physical hardware (>= 11.5 GB, compute >= 7.0)
        props_valid = MagicMock()
        props_valid.major = 8
        props_valid.minor = 9
        props_valid.total_memory = 24 * (1024 ** 3)
        mock_torch.cuda.get_device_properties.return_value = props_valid

        with patch.dict(sys.modules, {"torch": mock_torch}):
            passed, msg, details = check_gpu_hardware()
            self.assertTrue(passed)
            self.assertEqual(details["vram_gb"], 24.0)

    def test_check_colmap_binary(self):
        # 1. COLMAP missing from PATH
        with patch("shutil.which", return_value=None):
            passed, msg, _ = check_colmap_binary()
            self.assertFalse(passed)
            self.assertIn("not found on system PATH", msg)

        # 2. COLMAP present but --version execution throws exception
        with patch("shutil.which", return_value="/usr/local/bin/colmap"):
            with patch("subprocess.run", side_effect=OSError("Exec format error")):
                passed, msg, _ = check_colmap_binary()
                self.assertFalse(passed)
                self.assertIn("Failed executing 'colmap --version'", msg)

        # 3. COLMAP present with CUDA acceleration (version OK, smoke test OK)
        with patch("shutil.which", return_value="/usr/local/bin/colmap"):
            mock_ver = subprocess.CompletedProcess(
                args=["colmap", "--version"],
                returncode=0,
                stdout="COLMAP 3.9.1 with CUDA (Commit 12345)\n",
                stderr=""
            )
            mock_smoke = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=0,
                stdout="Extracting SIFT features using GPU... Extracted 120 features.\n",
                stderr=""
            )

            def mock_subp_run(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                elif "feature_extractor" in cmd:
                    # Create dummy smoke db file to simulate success
                    db_idx = cmd.index("--database_path") + 1
                    db_path = cmd[db_idx]
                    with open(db_path, "wb") as f:
                        f.write(b"MOCK_SQLITE_COLMAP_DATABASE")
                    return mock_smoke
                return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

            with patch("subprocess.run", side_effect=mock_subp_run):
                passed, msg, details = check_colmap_binary()
                self.assertTrue(passed)
                self.assertIn("CUDA SIFT verified", msg)
                self.assertTrue(details.get("cuda_sift_verified"))

    def test_check_colmap_binary_cpu_only_rejected(self):
        """
        Enforces rejection of CPU-only COLMAP installations (e.g. default apt-get packages)
        via SiftExtraction.use_gpu=1 smoke test failure.
        """
        with patch("shutil.which", return_value="/usr/bin/colmap"):
            mock_ver = subprocess.CompletedProcess(
                args=["colmap", "--version"],
                returncode=0,
                stdout="COLMAP 3.9.1 (Commit 12345 without CUDA)\n",
                stderr=""
            )
            # Case A: Fails with explicit non-zero exit code and CUDA error
            mock_smoke_fail = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=1,
                stdout="",
                stderr="ERROR: SiftExtraction.use_gpu is only supported if CUDA is enabled.\n"
            )

            def mock_subp_cpu_fail(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                return mock_smoke_fail

            with patch("subprocess.run", side_effect=mock_subp_cpu_fail):
                passed, msg, details = check_colmap_binary()
                self.assertFalse(passed)
                self.assertIn("lacks functional CUDA GPU support", msg)
                self.assertIn("docs/GPU_RUNNER_SETUP.md", msg)

            # Case B: Exits 0 but prints no CUDA device / without CUDA warning
            mock_smoke_warn = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=0,
                stdout="WARNING: No CUDA-capable device is detected. Falling back to CPU.\n",
                stderr=""
            )

            def mock_subp_cpu_warn(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                return mock_smoke_warn

            with patch("subprocess.run", side_effect=mock_subp_cpu_warn):
                passed, msg, details = check_colmap_binary()
                self.assertFalse(passed)
                self.assertIn("lacks functional CUDA GPU support", msg)

    def test_check_graphdeco_submodules(self):
        # Missing
        with patch.dict(sys.modules, {"diff_gaussian_rasterization": None, "simple_knn": None}):
            passed, msg, _ = check_graphdeco_submodules()
            self.assertFalse(passed)
            self.assertIn("Missing compiled Graphdeco CUDA submodules", msg)

        # Present
        mock_diff = MagicMock()
        mock_knn = MagicMock()
        with patch.dict(sys.modules, {"diff_gaussian_rasterization": mock_diff, "simple_knn": mock_knn}):
            passed, msg, _ = check_graphdeco_submodules()
            self.assertTrue(passed)
            self.assertIn("successfully imported", msg)

    def test_check_graphdeco_provenance(self):
        # Missing runner script
        passed, msg, _ = check_graphdeco_provenance(runner_path="/nonexistent/train.py")
        self.assertFalse(passed)
        self.assertIn("not found", msg)

        # Valid runner script with authentic provenance
        with patch("pipeline.train.resolve_graphdeco_script_path", return_value="/opt/gaussian-splatting/train.py"):
            with patch("os.path.isfile", return_value=True):
                prov_mock = {
                    "verified": True,
                    "commit_sha": "21301643a4354d6e24495c0df5a85354af8bd2be",
                    "remote_url": "https://github.com/graphdeco-inria/gaussian-splatting",
                    "is_clean": True
                }
                with patch("pipeline.train.validate_graphdeco_runner_provenance", return_value=(True, "Authentic", prov_mock)):
                    passed, msg, details = check_graphdeco_provenance()
                    self.assertTrue(passed)
                    self.assertIn("2130164", msg)
                    self.assertTrue(details["verified"])

    def test_check_acceptance_dataset(self):
        # Valid dataset in repo fixtures
        passed, msg, details = check_acceptance_dataset("prop_villa_marassi_01")
        self.assertTrue(passed)
        self.assertEqual(details["dataset_name"], "prop_villa_marassi_01")
        self.assertGreater(details["image_count"], 0)

        # Invalid dataset
        passed_inv, msg_inv, _ = check_acceptance_dataset("prop_invalid_fixture")
        self.assertFalse(passed_inv)
        self.assertTrue(any(phrase in msg_inv for phrase in ["Dataset validation failed", "DATASET_ALLOWLIST_VIOLATION", "Error validating acceptance dataset"]))

    def test_run_all_preflight_checks_and_cli(self):
        report = run_all_preflight_checks(strict=False)
        self.assertIn("all_passed", report)
        self.assertIn("checks", report)
        self.assertEqual(len(report["checks"]), 8)

        # Test CLI with --json and --non-strict
        with patch("sys.argv", ["gpu_runner_preflight.py", "--non-strict", "--json"]):
            code = main()
            self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
