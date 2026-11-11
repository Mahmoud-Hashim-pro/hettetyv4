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

    def _create_mock_colmap_db(self, db_path: str, num_keypoints: int = 150, num_matches: int = 95):
        """Helper to create a mock SQLite COLMAP database fixture for preflight unit tests."""
        import sqlite3
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("CREATE TABLE IF NOT EXISTS images (image_id INTEGER PRIMARY KEY, name TEXT);")
        c.execute("CREATE TABLE IF NOT EXISTS keypoints (image_id INTEGER PRIMARY KEY, rows INTEGER, cols INTEGER, data BLOB);")
        c.execute("CREATE TABLE IF NOT EXISTS matches (pair_id INTEGER PRIMARY KEY, rows INTEGER, cols INTEGER, data BLOB);")
        c.execute("CREATE TABLE IF NOT EXISTS two_view_geometries (pair_id INTEGER PRIMARY KEY, rows INTEGER, cols INTEGER, data BLOB, config INTEGER);")

        c.execute("INSERT OR REPLACE INTO images VALUES (1, 'smoke_01.ppm'), (2, 'smoke_02.ppm');")
        if num_keypoints > 0:
            c.execute(
                "INSERT OR REPLACE INTO keypoints VALUES (1, ?, 4, ?), (2, ?, 4, ?);",
                (num_keypoints, b"\x00" * (num_keypoints * 4 * 4), num_keypoints, b"\x00" * (num_keypoints * 4 * 4))
            )
        else:
            c.execute("INSERT OR REPLACE INTO keypoints VALUES (1, 0, 4, ?), (2, 0, 4, ?);", (b"", b""))

        if num_matches > 0:
            c.execute("INSERT OR REPLACE INTO matches VALUES (1, ?, 2, ?);", (num_matches, b"\x00" * (num_matches * 2 * 4)))
            c.execute("INSERT OR REPLACE INTO two_view_geometries VALUES (1, ?, 2, ?, 2);", (num_matches, b"\x00" * (num_matches * 2 * 4)))
        conn.commit()
        conn.close()

    def test_check_colmap_binary(self):
        """[Unit Test] Validates missing binary and execution failure rejection."""
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

    def test_check_colmap_binary_cuda_sift_extraction_and_matching_success(self):
        """
        [Unit Test] Verifies successful CUDA SIFT extraction and matching flow.
        Confirms log checks, SQLite database queries for keypoints/matches, and details dict.
        Note: Mocked for CI unit testing; does not claim physical GPU validation.
        """
        with patch("shutil.which", return_value="/usr/local/bin/colmap"):
            mock_ver = subprocess.CompletedProcess(
                args=["colmap", "--version"],
                returncode=0,
                stdout="COLMAP 3.9.1 with CUDA (Commit 12345)\n",
                stderr=""
            )
            mock_extract = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=0,
                stdout=(
                    "==============================================================================\n"
                    "Creating SIFT GPU feature extractor\n"
                    "Processed file [1/2] Name: smoke_01.ppm Features: 150\n"
                    "Processed file [2/2] Name: smoke_02.ppm Features: 150\n"
                ),
                stderr=""
            )
            mock_match = subprocess.CompletedProcess(
                args=["colmap", "exhaustive_matcher"],
                returncode=0,
                stdout=(
                    "=== Feature matching & geometric verification ===\n"
                    "Creating SIFT GPU feature matcher\n"
                    "Generating exhaustive image pairs...\n"
                    "Processing block [1/1, 1/1] feature_matching...\n"
                ),
                stderr=""
            )

            def mock_subp_run(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                db_idx = cmd.index("--database_path") + 1
                db_path = cmd[db_idx]
                if "feature_extractor" in cmd:
                    self._create_mock_colmap_db(db_path, num_keypoints=150, num_matches=0)
                    return mock_extract
                elif "exhaustive_matcher" in cmd:
                    self._create_mock_colmap_db(db_path, num_keypoints=150, num_matches=95)
                    return mock_match
                return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

            with patch("subprocess.run", side_effect=mock_subp_run):
                passed, msg, details = check_colmap_binary()
                self.assertTrue(passed)
                self.assertIn("CUDA SIFT extraction & matching verified", msg)
                self.assertTrue(details.get("cuda_sift_verified"))
                self.assertTrue(details.get("cuda_sift_extraction_verified"))
                self.assertTrue(details.get("cuda_sift_matching_verified"))
                self.assertEqual(details.get("matches_found"), 95)
                self.assertEqual(details.get("features_extracted", {}).get("smoke_01.ppm"), 150)

    def test_check_colmap_binary_cpu_only_rejected(self):
        """
        [Unit Test] Enforces rejection of CPU-only COLMAP installations (e.g. default apt-get packages)
        via SiftExtraction.use_gpu=1 or SiftMatching.use_gpu=1 failure.
        Note: Mocked for CI unit testing; does not claim physical GPU validation.
        """
        with patch("shutil.which", return_value="/usr/bin/colmap"):
            mock_ver = subprocess.CompletedProcess(
                args=["colmap", "--version"],
                returncode=0,
                stdout="COLMAP 3.9.1 (Commit 12345 without CUDA)\n",
                stderr=""
            )

            # Case A: Feature extractor fails with CUDA missing error
            mock_extract_fail = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=1,
                stdout="",
                stderr="ERROR: SiftExtraction.use_gpu is only supported if CUDA is enabled.\n"
            )

            def mock_subp_extract_fail(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                return mock_extract_fail

            with patch("subprocess.run", side_effect=mock_subp_extract_fail):
                passed, msg, details = check_colmap_binary()
                self.assertFalse(passed)
                self.assertIn("lacks functional CUDA GPU support", msg)
                self.assertIn("docs/GPU_RUNNER_SETUP.md", msg)

            # Case B: Feature matcher fails with CUDA missing error
            mock_extract_ok = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=0,
                stdout="Creating SIFT GPU feature extractor\n",
                stderr=""
            )
            mock_match_fail = subprocess.CompletedProcess(
                args=["colmap", "exhaustive_matcher"],
                returncode=1,
                stdout="",
                stderr="ERROR: SiftMatching.use_gpu is only supported if CUDA is enabled.\n"
            )

            def mock_subp_match_fail(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                db_idx = cmd.index("--database_path") + 1
                db_path = cmd[db_idx]
                if "feature_extractor" in cmd:
                    self._create_mock_colmap_db(db_path, num_keypoints=150, num_matches=0)
                    return mock_extract_ok
                return mock_match_fail

            with patch("subprocess.run", side_effect=mock_subp_match_fail):
                passed, msg, details = check_colmap_binary()
                self.assertFalse(passed)
                self.assertIn("feature matching failed", msg)

    def test_check_colmap_binary_silent_cpu_fallback_rejected(self):
        """
        [Unit Test] Enforces fail-closed behavior if feature extraction or matching silently falls back to CPU.
        Note: Mocked for CI unit testing; does not claim physical GPU validation.
        """
        with patch("shutil.which", return_value="/usr/bin/colmap"):
            mock_ver = subprocess.CompletedProcess(
                args=["colmap", "--version"],
                returncode=0,
                stdout="COLMAP 3.9.1 (Commit 12345)\n",
                stderr=""
            )

            # Case A: Feature extractor logs CPU extractor
            mock_extract_cpu = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=0,
                stdout="Creating SIFT CPU feature extractor\n",
                stderr=""
            )

            def mock_subp_extract_cpu(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                db_idx = cmd.index("--database_path") + 1
                db_path = cmd[db_idx]
                self._create_mock_colmap_db(db_path, num_keypoints=150, num_matches=0)
                return mock_extract_cpu

            with patch("subprocess.run", side_effect=mock_subp_extract_cpu):
                passed, msg, details = check_colmap_binary()
                self.assertFalse(passed)
                self.assertIn("silently fell back to CPU SIFT feature extraction", msg)

            # Case B: Matcher logs CPU matcher
            mock_extract_gpu = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=0,
                stdout="Creating SIFT GPU feature extractor\n",
                stderr=""
            )
            mock_match_cpu = subprocess.CompletedProcess(
                args=["colmap", "exhaustive_matcher"],
                returncode=0,
                stdout="Creating SIFT CPU feature matcher\n",
                stderr=""
            )

            def mock_subp_match_cpu(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                db_idx = cmd.index("--database_path") + 1
                db_path = cmd[db_idx]
                if "feature_extractor" in cmd:
                    self._create_mock_colmap_db(db_path, num_keypoints=150, num_matches=0)
                    return mock_extract_gpu
                elif "exhaustive_matcher" in cmd:
                    self._create_mock_colmap_db(db_path, num_keypoints=150, num_matches=95)
                    return mock_match_cpu
                return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

            with patch("subprocess.run", side_effect=mock_subp_match_cpu):
                passed, msg, details = check_colmap_binary()
                self.assertFalse(passed)
                self.assertIn("silently fell back to CPU SIFT feature matching", msg)

    def test_check_colmap_binary_empty_keypoints_rejected(self):
        """
        [Unit Test] Rejects feature extraction when database keypoints table contains 0 features.
        Note: Mocked for CI unit testing; does not claim physical GPU validation.
        """
        with patch("shutil.which", return_value="/usr/local/bin/colmap"):
            mock_ver = subprocess.CompletedProcess(
                args=["colmap", "--version"],
                returncode=0,
                stdout="COLMAP 3.9.1 with CUDA\n",
                stderr=""
            )
            mock_extract = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=0,
                stdout="Creating SIFT GPU feature extractor\nProcessed file [1/2] Features: 0\n",
                stderr=""
            )

            def mock_subp_empty_pts(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                db_idx = cmd.index("--database_path") + 1
                db_path = cmd[db_idx]
                # Database with 0 keypoints
                self._create_mock_colmap_db(db_path, num_keypoints=0, num_matches=0)
                return mock_extract

            with patch("subprocess.run", side_effect=mock_subp_empty_pts):
                passed, msg, details = check_colmap_binary()
                self.assertFalse(passed)
                self.assertIn("zero keypoints", msg)

    def test_check_colmap_binary_matching_failure_or_empty_matches_rejected(self):
        """
        [Unit Test] Rejects matching when database matches table contains 0 valid match records.
        Note: Mocked for CI unit testing; does not claim physical GPU validation.
        """
        with patch("shutil.which", return_value="/usr/local/bin/colmap"):
            mock_ver = subprocess.CompletedProcess(
                args=["colmap", "--version"],
                returncode=0,
                stdout="COLMAP 3.9.1 with CUDA\n",
                stderr=""
            )
            mock_extract = subprocess.CompletedProcess(
                args=["colmap", "feature_extractor"],
                returncode=0,
                stdout="Creating SIFT GPU feature extractor\nProcessed file [1/2] Features: 150\n",
                stderr=""
            )
            mock_match_empty = subprocess.CompletedProcess(
                args=["colmap", "exhaustive_matcher"],
                returncode=0,
                stdout="Creating SIFT GPU feature matcher\nProcessing block [1/1, 1/1] feature_matching...\n",
                stderr=""
            )

            def mock_subp_empty_matches(cmd, *args, **kwargs):
                if "--version" in cmd:
                    return mock_ver
                db_idx = cmd.index("--database_path") + 1
                db_path = cmd[db_idx]
                if "feature_extractor" in cmd:
                    self._create_mock_colmap_db(db_path, num_keypoints=150, num_matches=0)
                    return mock_extract
                elif "exhaustive_matcher" in cmd:
                    # Database remains with 0 matches
                    self._create_mock_colmap_db(db_path, num_keypoints=150, num_matches=0)
                    return mock_match_empty
                return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

            with patch("subprocess.run", side_effect=mock_subp_empty_matches):
                passed, msg, details = check_colmap_binary()
                self.assertFalse(passed)
                self.assertIn("zero valid match records", msg)

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
