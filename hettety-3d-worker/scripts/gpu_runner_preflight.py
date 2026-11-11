#!/usr/bin/env python3
"""
HETTETY v4 — Authoritative GPU Runner Host & Dependency Preflight Verification Script

Performs exhaustive preflight validation of the dedicated self-hosted NVIDIA GPU runner
prior to executing the 30,000-iteration Graphdeco 3DGS photogrammetric acceptance suite.

Checks:
1. Python Runtime: Python >= 3.10
2. Testing Framework: PyTest installed and available
3. PyTorch & CUDA Toolkit: torch with CUDA >= 11.8 support
4. Physical GPU Hardware: Compute capability >= 7.0, detected VRAM >= 11.5 GiB
5. COLMAP Photogrammetry: Native colmap binary on PATH
6. Graphdeco CUDA Submodules: diff_gaussian_rasterization and simple_knn compiled
7. Graphdeco Runner Provenance: Official upstream git repo, approved commit, clean tree
8. Acceptance Dataset: Keyframe images, survey benchmarks, and manifest valid

Exit Codes:
- 0: All checks passed. Runner is ready for physical GPU acceptance.
- 1: One or more checks failed. Remediation instructions printed.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple


def check_python_version() -> Tuple[bool, str, Dict[str, Any]]:
    """Validates Python version >= 3.10."""
    major, minor, micro = sys.version_info[:3]
    version_str = f"{major}.{minor}.{micro}"
    details = {
        "python_version": version_str,
        "executable": sys.executable,
        "platform": sys.platform
    }
    if (major, minor) < (3, 10):
        return False, f"Python {version_str} is below required 3.10+", details
    return True, f"Python {version_str} ({sys.executable})", details


def check_pytest_installed() -> Tuple[bool, str, Dict[str, Any]]:
    """Validates pytest is installed and can be imported."""
    try:
        import pytest
        details = {"pytest_version": getattr(pytest, "__version__", "unknown")}
        return True, f"Pytest {details['pytest_version']} installed", details
    except ImportError:
        return False, "pytest is not installed in the active Python environment", {}


def check_cuda_and_pytorch() -> Tuple[bool, str, Dict[str, Any]]:
    """Validates PyTorch is installed and CUDA >= 11.8 is available."""
    try:
        import torch
    except ImportError:
        return False, "PyTorch (torch) is not installed", {}

    details: Dict[str, Any] = {
        "pytorch_version": getattr(torch, "__version__", "unknown"),
        "cuda_available": torch.cuda.is_available()
    }

    if not torch.cuda.is_available():
        return False, "torch.cuda.is_available() is False. No CUDA runtime detected by PyTorch.", details

    cuda_ver = torch.version.cuda or ""
    details["cuda_version"] = cuda_ver

    if not cuda_ver:
        return False, "PyTorch was compiled without CUDA support (torch.version.cuda is None)", details

    try:
        tokens = cuda_ver.split(".")
        cuda_major = int(tokens[0])
        cuda_minor = int(tokens[1]) if len(tokens) > 1 else 0
        details["cuda_version_parsed"] = [cuda_major, cuda_minor]
        if (cuda_major, cuda_minor) < (11, 8):
            return False, f"CUDA runtime version {cuda_ver} is below required 11.8+", details
    except Exception as e:
        return False, f"Failed parsing CUDA version '{cuda_ver}': {e}", details

    return True, f"PyTorch {torch.__version__} with CUDA {cuda_ver}", details


def check_gpu_hardware() -> Tuple[bool, str, Dict[str, Any]]:
    """Validates physical NVIDIA GPU compute capability >= 7.0 and VRAM >= 11.5 GiB."""
    try:
        import torch
        if not torch.cuda.is_available():
            return False, "CUDA unavailable; cannot inspect physical GPU devices.", {}

        device_count = torch.cuda.device_count()
        if device_count == 0:
            return False, "torch.cuda.device_count() returned 0.", {}

        device_name = torch.cuda.get_device_name(0)
        props = torch.cuda.get_device_properties(0)
        vram_bytes = props.total_memory
        vram_gb = round(vram_bytes / (1024 ** 3), 2)
        compute_cap = (props.major, props.minor)

        details = {
            "device_count": device_count,
            "device_name": device_name,
            "vram_gb": vram_gb,
            "compute_capability": f"{props.major}.{props.minor}",
        }

        if compute_cap < (7, 0):
            return (
                False,
                f"GPU compute capability {props.major}.{props.minor} on {device_name} is below required 7.0+ (Volta/Turing/Ampere/Ada/Hopper required)",
                details
            )

        if vram_gb < 11.5:
            return (
                False,
                f"GPU VRAM {vram_gb} GB on {device_name} is below required 11.5 GiB (12 GB physical minimum for 30k 3DGS training)",
                details
            )

        return True, f"{device_name} ({vram_gb} GB VRAM, Compute {props.major}.{props.minor})", details
    except Exception as e:
        return False, f"Failed querying NVIDIA GPU hardware: {e}", {}


def _generate_textured_ppm(width: int = 256, height: int = 256, shift_x: int = 0, shift_y: int = 0) -> bytes:
    """
    Generates a deterministic multi-frequency high-contrast textured PPM (P6 binary).
    Zero external dependencies (pure Python). Produces rich corners, edges, and features
    across multiple spatial scales suitable for SIFT keypoint detection and matching.
    """
    header = f"P6\n{width} {height}\n255\n".encode("ascii")
    pixels = bytearray(width * height * 3)
    idx = 0
    for y in range(height):
        sy = (y + shift_y) % height
        for x in range(width):
            sx = (x + shift_x) % width
            # Multi-scale checkerboards
            c1 = 255 if ((sx // 16) % 2 == (sy // 16) % 2) else 0
            c2 = 255 if ((sx // 4) % 2 == (sy // 4) % 2) else 0
            # Diagonal grating
            c3 = 255 if ((sx + sy) // 8) % 2 == 0 else 0
            # Crosshair corner markers at 32px intervals
            is_cross = 255 if (sx % 32 < 4 or sy % 32 < 4) else 0

            r = (c1 ^ c2) & 0xFF
            g = (c2 ^ c3) & 0xFF
            b = (c3 ^ is_cross) & 0xFF
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            idx += 3
    return header + bytes(pixels)


def check_colmap_binary() -> Tuple[bool, str, Dict[str, Any]]:
    """
    Validates native COLMAP binary is on PATH and verifies functional CUDA SIFT acceleration.
    Executes an isolated two-image GPU feature extraction and matching smoke test with:
      - SiftExtraction.use_gpu=1
      - SiftMatching.use_gpu=1
    Inspects the resulting SQLite database to verify non-empty keypoint and match records,
    and inspects process logs to confirm GPU execution and reject CPU fallbacks.
    Guarantees immediate cleanup of all smoke test temporary files.
    """
    import sqlite3
    import tempfile

    colmap_path = shutil.which("colmap")
    if not colmap_path:
        return False, "Native 'colmap' executable not found on system PATH", {}

    details: Dict[str, Any] = {"colmap_path": colmap_path}
    try:
        res = subprocess.run(
            ["colmap", "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10
        )
        out = (res.stdout + res.stderr).strip()
        version_line = out.splitlines()[0] if out.splitlines() else "COLMAP (unknown version)"
        details["colmap_version"] = version_line
        if res.returncode != 0 and "COLMAP" not in version_line:
            return False, f"COLMAP returned non-zero exit code {res.returncode}: {out}", details
    except Exception as e:
        return False, f"Failed executing 'colmap --version': {e}", details

    with tempfile.TemporaryDirectory() as tmp_dir:
        img_dir = os.path.join(tmp_dir, "images")
        os.makedirs(img_dir, exist_ok=True)
        db_path = os.path.join(tmp_dir, "smoke.db")

        # 1. Generate two textured PPM test fixtures with rich multi-scale features
        ppm1 = _generate_textured_ppm(256, 256, shift_x=0, shift_y=0)
        ppm2 = _generate_textured_ppm(256, 256, shift_x=12, shift_y=8)
        with open(os.path.join(img_dir, "smoke_01.ppm"), "wb") as f:
            f.write(ppm1)
        with open(os.path.join(img_dir, "smoke_02.ppm"), "wb") as f:
            f.write(ppm2)

        # 2. Run feature extraction with GPU acceleration
        cmd_extract = [
            colmap_path, "feature_extractor",
            "--database_path", db_path,
            "--image_path", img_dir,
            "--ImageReader.camera_model", "SIMPLE_PINHOLE",
            "--ImageReader.single_camera", "1",
            "--SiftExtraction.use_gpu", "1"
        ]

        try:
            res_extract = subprocess.run(
                cmd_extract,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30
            )
            extract_log = (res_extract.stdout + "\n" + res_extract.stderr).strip()
        except Exception as e:
            return (
                False,
                f"Failed executing COLMAP CUDA SIFT feature extraction smoke test: {e}",
                {"colmap_path": colmap_path, "colmap_version": version_line}
            )

        extract_lower = extract_log.lower()
        details["extract_log"] = extract_log

        # Reject CPU-only builds, errors, or silent CPU fallbacks during extraction
        if res_extract.returncode != 0:
            err_line = extract_log.splitlines()[-1] if extract_log.splitlines() else f"returncode {res_extract.returncode}"
            return (
                False,
                f"Native COLMAP at '{colmap_path}' lacks functional CUDA GPU support: {err_line}. "
                "Hettety requires CUDA-enabled COLMAP (--SiftExtraction.use_gpu 1). "
                "Default Ubuntu apt-get packages are CPU-only; build COLMAP from source with -DCUDA_ENABLED=ON (see docs/GPU_RUNNER_SETUP.md).",
                details
            )

        if "only supported if cuda is enabled" in extract_lower or "without cuda" in extract_lower or "cuda error" in extract_lower or "no cuda-capable device" in extract_lower:
            return (
                False,
                f"Native COLMAP at '{colmap_path}' lacks functional CUDA GPU support for feature extraction. "
                "Default Ubuntu apt-get packages are CPU-only; build COLMAP from source with -DCUDA_ENABLED=ON (see docs/GPU_RUNNER_SETUP.md).",
                details
            )

        if "creating sift cpu feature extractor" in extract_lower or "cpu feature extractor" in extract_lower or "falling back to cpu" in extract_lower:
            return (
                False,
                f"Native COLMAP at '{colmap_path}' silently fell back to CPU SIFT feature extraction. "
                "GPU execution (--SiftExtraction.use_gpu 1) is mandatory for Hettety acceptance.",
                details
            )

        if "creating sift gpu feature extractor" not in extract_lower and "sift gpu feature extractor" not in extract_lower and "using gpu" not in extract_lower:
            return (
                False,
                f"Native COLMAP at '{colmap_path}' did not confirm GPU SIFT feature extraction in execution logs.",
                details
            )

        # 3. Inspect SQLite database for extracted images and keypoints
        if not os.path.isfile(db_path) or os.path.getsize(db_path) == 0:
            return False, f"COLMAP database '{db_path}' was not created or is empty after feature extraction.", details

        conn = None
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            try:
                cursor.execute("SELECT image_id, name FROM images ORDER BY image_id")
                images = cursor.fetchall()
            except sqlite3.OperationalError as e:
                return False, f"COLMAP database missing 'images' table after feature extraction: {e}", details

            if len(images) < 2:
                return (
                    False,
                    f"COLMAP database contains {len(images)} images; expected 2 smoke test images.",
                    details
                )

            try:
                cursor.execute("SELECT image_id, rows, cols, length(data) FROM keypoints ORDER BY image_id")
                keypoints_rows = cursor.fetchall()
            except sqlite3.OperationalError as e:
                return False, f"COLMAP database missing 'keypoints' table after feature extraction: {e}", details

            features_extracted = {}
            for row in keypoints_rows:
                img_id, num_features, cols, blob_len = row
                img_name = next((name for iid, name in images if iid == img_id), f"image_{img_id}")
                features_extracted[img_name] = num_features

            details["features_extracted"] = features_extracted

            if len(keypoints_rows) < 2:
                return (
                    False,
                    f"COLMAP keypoints table has {len(keypoints_rows)} entries; expected 2 for the smoke test images.",
                    details
                )

            for img_id, num_features, cols, blob_len in keypoints_rows:
                if num_features <= 0 or not blob_len or blob_len == 0:
                    return (
                        False,
                        f"COLMAP feature extraction produced zero keypoints (or empty payload) for image id {img_id}.",
                        details
                    )
        except Exception as e:
            return False, f"Failed querying COLMAP SQLite database after feature extraction: {e}", details
        finally:
            if conn:
                conn.close()

        # 4. Run two-image GPU matching smoke test (--SiftMatching.use_gpu 1)
        cmd_match = [
            colmap_path, "exhaustive_matcher",
            "--database_path", db_path,
            "--SiftMatching.use_gpu", "1"
        ]

        try:
            res_match = subprocess.run(
                cmd_match,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30
            )
            match_log = (res_match.stdout + "\n" + res_match.stderr).strip()
        except Exception as e:
            return (
                False,
                f"Failed executing COLMAP CUDA SIFT exhaustive matcher smoke test: {e}",
                details
            )

        match_lower = match_log.lower()
        details["match_log"] = match_log

        # Reject CPU-only builds, errors, or silent CPU fallbacks during matching
        if res_match.returncode != 0:
            err_line = match_log.splitlines()[-1] if match_log.splitlines() else f"returncode {res_match.returncode}"
            return (
                False,
                f"Native COLMAP feature matching failed (code {res_match.returncode}): {err_line}. "
                "Hettety requires CUDA-enabled COLMAP matching (--SiftMatching.use_gpu 1).",
                details
            )

        if "only supported if cuda is enabled" in match_lower or "without cuda" in match_lower or "cuda error" in match_lower or "no cuda-capable device" in match_lower:
            return (
                False,
                f"Native COLMAP at '{colmap_path}' lacks functional CUDA support for SIFT feature matching.",
                details
            )

        if "creating sift cpu feature matcher" in match_lower or "cpu feature matcher" in match_lower or "falling back to cpu" in match_lower:
            return (
                False,
                f"Native COLMAP at '{colmap_path}' silently fell back to CPU SIFT feature matching. "
                "GPU matching (--SiftMatching.use_gpu 1) is mandatory for Hettety acceptance.",
                details
            )

        if "creating sift gpu feature matcher" not in match_lower and "sift gpu feature matcher" not in match_lower and "using gpu" not in match_lower:
            return (
                False,
                f"Native COLMAP at '{colmap_path}' did not confirm GPU SIFT feature matcher in execution logs.",
                details
            )

        # 5. Inspect SQLite database for match records
        conn = None
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            total_matches = 0
            try:
                cursor.execute("SELECT pair_id, rows, cols, length(data) FROM matches WHERE rows > 0")
                matches_rows = cursor.fetchall()
                total_matches = sum(row[1] for row in matches_rows)
            except sqlite3.OperationalError:
                pass

            total_verified = 0
            try:
                cursor.execute("SELECT pair_id, rows, cols, length(data) FROM two_view_geometries WHERE rows > 0")
                two_view_rows = cursor.fetchall()
                total_verified = sum(row[1] for row in two_view_rows)
            except sqlite3.OperationalError:
                pass

            details["matches_found"] = total_matches
            details["verified_matches_found"] = total_verified

            if total_matches <= 0 and total_verified <= 0:
                return (
                    False,
                    "COLMAP GPU feature matching completed but produced zero valid match records between smoke test images.",
                    details
                )
        except Exception as e:
            return False, f"Failed querying COLMAP SQLite database after feature matching: {e}", details
        finally:
            if conn:
                conn.close()

    details["cuda_sift_verified"] = True
    details["cuda_sift_extraction_verified"] = True
    details["cuda_sift_matching_verified"] = True

    feat_summary = "/".join(str(v) for v in details.get("features_extracted", {}).values())
    match_count = details.get("matches_found", 0) or details.get("verified_matches_found", 0)

    return (
        True,
        f"{version_line} at {colmap_path} (CUDA SIFT extraction & matching verified: {feat_summary} features, {match_count} matches)",
        details
    )


def check_graphdeco_submodules() -> Tuple[bool, str, Dict[str, Any]]:
    """Validates compiled Graphdeco CUDA submodules diff_gaussian_rasterization and simple_knn."""
    errors = []
    details = {}
    try:
        import diff_gaussian_rasterization
        details["diff_gaussian_rasterization"] = getattr(diff_gaussian_rasterization, "__file__", "loaded")
    except ImportError as e:
        errors.append(f"diff_gaussian_rasterization: {e}")

    try:
        import simple_knn
        details["simple_knn"] = getattr(simple_knn, "__file__", "loaded")
    except ImportError as e:
        errors.append(f"simple_knn: {e}")

    if errors:
        return False, f"Missing compiled Graphdeco CUDA submodules: {'; '.join(errors)}", details

    return True, "diff_gaussian_rasterization and simple_knn successfully imported", details


def check_graphdeco_provenance(runner_path: Optional[str] = None) -> Tuple[bool, str, Dict[str, Any]]:
    """Validates Graphdeco runner script git provenance, commit allowlist, and clean tree."""
    sys_path_added = False
    worker_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if worker_dir not in sys.path:
        sys.path.insert(0, worker_dir)
        sys_path_added = True

    try:
        from pipeline.train import (
            resolve_graphdeco_script_path,
            validate_graphdeco_runner_provenance,
            DEFAULT_APPROVED_GRAPHDECO_COMMITS
        )

        resolved_runner = runner_path or resolve_graphdeco_script_path()
        if not resolved_runner or not os.path.isfile(resolved_runner):
            return (
                False,
                f"Graphdeco runner script 'train.py' not found at '{resolved_runner}'. Set GAUSSIAN_SPLATTING_PATH or install to /opt/gaussian-splatting/train.py.",
                {"runner_path": resolved_runner}
            )

        valid, reason, details = validate_graphdeco_runner_provenance(resolved_runner, return_details=True)
        if not valid:
            return False, f"Graphdeco runner provenance failed: {reason}", details

        return True, f"Verified Graphdeco at commit {details.get('commit_sha')} ({details.get('remote_url')})", details
    except Exception as e:
        return False, f"Error validating Graphdeco runner provenance: {e}", {}


def check_acceptance_dataset(dataset_name: Optional[str] = None) -> Tuple[bool, str, Dict[str, Any]]:
    """Validates configured acceptance dataset keyframes, survey benchmarks, and manifest."""
    sys_path_added = False
    worker_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if worker_dir not in sys.path:
        sys.path.insert(0, worker_dir)
        sys_path_added = True

    try:
        from pipeline.acceptance_evidence import (
            resolve_and_validate_acceptance_dataset,
            get_dataset_acceptance_profile
        )

        target = dataset_name or os.environ.get("HETTETY_ACCEPTANCE_DATASET", "prop_villa_marassi_01")
        meta = resolve_and_validate_acceptance_dataset(target)
        profile = get_dataset_acceptance_profile(target)
        details = {
            "dataset_name": target,
            "image_count": meta.get("image_count", 0),
            "benchmarks_count": meta.get("benchmarks_count", 0),
            "manifest_sha256": meta.get("manifest_sha256"),
            "acceptance_profile": profile
        }
        return True, f"Dataset '{target}' ({meta.get('image_count')} keyframes, {meta.get('benchmarks_count')} survey benchmarks)", details
    except Exception as e:
        return False, f"Error validating acceptance dataset: {e}", {}


def run_all_preflight_checks(
    strict: bool = True,
    runner_path: Optional[str] = None,
    dataset_name: Optional[str] = None
) -> Dict[str, Any]:
    """Runs all 8 preflight checks and compiles a comprehensive verification report."""
    checks = [
        ("1. Python Runtime (>= 3.10)", check_python_version),
        ("2. PyTest Framework", check_pytest_installed),
        ("3. PyTorch & CUDA Toolkit (>= 11.8)", check_cuda_and_pytorch),
        ("4. Physical NVIDIA GPU Hardware (>= 11.5 GB VRAM)", check_gpu_hardware),
        ("5. Native COLMAP with CUDA Acceleration on PATH", check_colmap_binary),
        ("6. Graphdeco CUDA Submodules (diff_gaussian_rasterization, simple_knn)", check_graphdeco_submodules),
        ("7. Graphdeco Runner Provenance & Commit Allowlist", lambda: check_graphdeco_provenance(runner_path)),
        ("8. Authoritative Acceptance Dataset", lambda: check_acceptance_dataset(dataset_name)),
    ]

    results: Dict[str, Any] = {
        "all_passed": True,
        "failed_count": 0,
        "passed_count": 0,
        "checks": {}
    }

    for name, fn in checks:
        passed, message, details = fn()
        results["checks"][name] = {
            "passed": passed,
            "message": message,
            "details": details
        }
        if passed:
            results["passed_count"] += 1
        else:
            results["all_passed"] = False
            results["failed_count"] += 1

    return results


def print_preflight_report(results: Dict[str, Any]) -> None:
    """Prints a formatted human-readable terminal report with remediation guidance."""
    print("\n" + "=" * 78)
    print(" HETTETY v4 — PHYSICAL GPU RUNNER ACCEPTANCE PREFLIGHT VERIFICATION")
    print("=" * 78)

    for name, data in results["checks"].items():
        symbol = "[ PASS ]" if data["passed"] else "[ FAIL ]"
        print(f"\n{symbol} {name}")
        print(f"         {data['message']}")

    print("\n" + "-" * 78)
    if results["all_passed"]:
        print(" SUMMARY: ALL PREFLIGHT CHECKS PASSED. RUNNER IS READY FOR 30,000-ITERATION GPU ACCEPTANCE.")
    else:
        print(f" SUMMARY: {results['failed_count']} CHECK(S) FAILED. RUNNER IS NOT ACCEPTANCE READY.")
        print("\n REMEDIATION GUIDANCE:")
        print(" Consult docs/GPU_RUNNER_SETUP.md for complete step-by-step setup instructions.")
        for name, data in results["checks"].items():
            if not data["passed"]:
                print(f" - For {name}: {data['message']}")
    print("=" * 78 + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Authoritative GPU Runner Host & Dependency Preflight Verification"
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        default=True,
        help="Fail closed with exit code 1 if any check fails (default: True)"
    )
    parser.add_argument(
        "--non-strict",
        action="store_false",
        dest="strict",
        help="Print report but exit 0 regardless of failures"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output machine-readable JSON status"
    )
    parser.add_argument(
        "--runner",
        type=str,
        default=None,
        help="Path to Graphdeco train.py runner script"
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default=None,
        help="Name of acceptance dataset to validate"
    )

    args = parser.parse_args()
    results = run_all_preflight_checks(
        strict=args.strict,
        runner_path=args.runner,
        dataset_name=args.dataset
    )

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print_preflight_report(results)

    if args.strict and not results["all_passed"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
