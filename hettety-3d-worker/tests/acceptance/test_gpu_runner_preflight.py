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

        # 2. COLMAP present
        with patch("shutil.which", return_value="/usr/local/bin/colmap"):
            mock_proc = subprocess.CompletedProcess(
                args=["colmap", "--version"],
                returncode=0,
                stdout="COLMAP 3.9.1 (Commit 12345)\n",
                stderr=""
            )
            with patch("subprocess.run", return_value=mock_proc):
                passed, msg, details = check_colmap_binary()
                self.assertTrue(passed)
                self.assertIn("COLMAP 3.9.1", msg)

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
