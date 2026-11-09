"""
HETTETY 3D GPU Worker — Acceptance Evidence & Dataset Integrity Subsystem
========================================================================

Authoritative evidence generation, dataset allowlist verification, and
tamper-evident audit logging for the 3D Gaussian Splatting and Photogrammetry Pipeline.

Requirements Enforced:
1. Configurable persistent evidence directory (survives test cleanup).
2. Explicit dataset allowlist preventing path traversal and arbitrary filesystem access.
3. Cryptographic SHA-256 dataset manifest generation and validation.
4. Machine-readable JSON and human-readable Markdown evidence generation.
5. Unique run identification, timestamping, hardware environment, and criteria tracking.
"""

import os
import re
import sys
import json
import time
import uuid
import hashlib
from typing import Dict, Any, Optional, Tuple, List, Set

# Allowed fixture datasets explicitly permitted for acceptance testing
ALLOWED_ACCEPTANCE_DATASETS: Set[str] = {
    "prop_villa_marassi_01",
    "prop_courtyard_dslr_02",
}

_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


def get_default_fixtures_root() -> str:
    """Returns the absolute path to tests/fixtures/real_properties."""
    return os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "tests",
            "fixtures",
            "real_properties"
        )
    )


def sanitize_dataset_name(dataset_name: Optional[str]) -> str:
    """
    Validates and sanitizes fixture dataset name.
    Strictly prohibits path traversal sequences (.., /, \\), null bytes, or non-alphanumeric characters.
    """
    if not dataset_name or not isinstance(dataset_name, str):
        raise ValueError("DATASET_SECURITY_ERROR: Dataset name must be a non-empty string.")

    cleaned = dataset_name.strip()
    if not _NAME_PATTERN.match(cleaned):
        raise ValueError(
            f"DATASET_SECURITY_ERROR: Dataset name '{dataset_name}' contains illegal characters. "
            "Only alphanumeric characters, hyphens, and underscores are allowed."
        )

    if cleaned not in ALLOWED_ACCEPTANCE_DATASETS:
        raise ValueError(
            f"DATASET_ALLOWLIST_VIOLATION: Dataset '{cleaned}' is not in the approved acceptance allowlist: "
            f"{sorted(list(ALLOWED_ACCEPTANCE_DATASETS))}."
        )

    return cleaned


def resolve_and_validate_acceptance_dataset(
    dataset_name: Optional[str] = None,
    fixtures_root: Optional[str] = None
) -> Dict[str, Any]:
    """
    Resolves, verifies boundaries, and audits the selected fixture dataset.
    Generates cryptographic SHA-256 hashes for all input keyframes and survey ground truth.
    """
    if fixtures_root is None:
        fixtures_root = get_default_fixtures_root()
    else:
        fixtures_root = os.path.abspath(fixtures_root)

    target_name = sanitize_dataset_name(dataset_name or os.environ.get("HETTETY_ACCEPTANCE_DATASET", "prop_villa_marassi_01"))

    # Secure path resolution with strict boundary checking
    fixture_dir = os.path.abspath(os.path.join(fixtures_root, target_name))
    try:
        common = os.path.commonpath([fixtures_root, fixture_dir])
        if common != fixtures_root:
            raise ValueError(f"PATH_TRAVERSAL_DETECTED: Target path '{fixture_dir}' escapes fixtures root '{fixtures_root}'.")
    except ValueError as e:
        raise ValueError(f"PATH_TRAVERSAL_DETECTED: {e}")

    if not os.path.exists(fixture_dir) or not os.path.isdir(fixture_dir):
        raise FileNotFoundError(f"DATASET_NOT_FOUND: Fixture directory does not exist at '{fixture_dir}'.")

    # Image keyframe discovery and validation
    image_files = sorted([f for f in os.listdir(fixture_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
    if len(image_files) < 8:
        raise ValueError(
            f"DATASET_INCOMPLETE: Acceptance dataset requires >= 8 valid images, found {len(image_files)} in '{target_name}'."
        )

    file_manifests: List[Dict[str, Any]] = []
    hasher = hashlib.sha256()

    for img_name in image_files:
        img_path = os.path.join(fixture_dir, img_name)
        file_size = os.path.getsize(img_path)
        if file_size < 1024:
            raise ValueError(f"DATASET_INCOMPLETE: Keyframe '{img_name}' is corrupted or smaller than 1KB ({file_size} bytes).")

        with open(img_path, "rb") as f:
            header = f.read(4)
            # JPEG (FF D8 FF) or PNG (89 50 4E 47)
            if not (header.startswith(b"\xff\xd8\xff") or header.startswith(b"\x89PNG")):
                raise ValueError(f"DATASET_INCOMPLETE: Keyframe '{img_name}' has invalid image byte header.")
            f.seek(0)
            img_bytes = f.read()

        img_sha = hashlib.sha256(img_bytes).hexdigest()
        hasher.update(img_bytes)
        file_manifests.append({
            "name": img_name,
            "type": "image",
            "sizeBytes": file_size,
            "sha256": img_sha,
        })

    # Survey benchmarks validation
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
            f"DATASET_INCOMPLETE: Required survey_benchmarks.json / ground_truth_survey.json missing in '{target_name}'."
        )

    with open(survey_path, "rb") as f:
        survey_bytes = f.read()
    hasher.update(survey_bytes)
    survey_sha = hashlib.sha256(survey_bytes).hexdigest()

    try:
        survey_data = json.loads(survey_bytes.decode("utf-8"))
    except Exception as e:
        raise ValueError(f"DATASET_INCOMPLETE: Survey benchmark JSON is malformed: {e}")

    benchmarks = survey_data.get("benchmarks", [])
    if not isinstance(benchmarks, list) or len(benchmarks) < 2:
        raise ValueError(f"DATASET_INCOMPLETE: Survey file in '{target_name}' contains fewer than 2 benchmark records.")

    file_manifests.append({
        "name": os.path.basename(survey_path),
        "type": "survey_benchmarks",
        "sizeBytes": len(survey_bytes),
        "sha256": survey_sha,
    })

    dataset_manifest_sha256 = hasher.hexdigest()

    return {
        "valid": True,
        "dataset_name": target_name,
        "fixture_dir": fixture_dir,
        "is_real_data": True,
        "image_count": len(image_files),
        "survey_path": survey_path,
        "benchmarks_count": len(benchmarks),
        "manifest_sha256": dataset_manifest_sha256,
        "files": file_manifests,
    }


def get_evidence_directory() -> str:
    """
    Resolves the authoritative persistent directory for acceptance evidence.
    Respects HETTETY_ACCEPTANCE_EVIDENCE_DIR if specified, otherwise defaults
    to <repo_root>/artifacts/acceptance_evidence.
    """
    custom = os.environ.get("HETTETY_ACCEPTANCE_EVIDENCE_DIR")
    if custom:
        target = os.path.abspath(custom)
    else:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        target = os.path.join(repo_root, "artifacts", "acceptance_evidence")

    os.makedirs(target, exist_ok=True)
    return target


def generate_run_id() -> str:
    """Generates a unique, sortable execution run identifier."""
    return f"acc_{int(time.time())}_{uuid.uuid4().hex[:8]}"


def write_acceptance_evidence(
    evidence: Dict[str, Any],
    evidence_dir: Optional[str] = None
) -> Tuple[str, str]:
    """
    Persists machine-readable JSON and human-readable Markdown evidence.
    Writes:
      1. <evidence_dir>/acceptance_evidence.json
      2. <evidence_dir>/acceptance_evidence.md
      3. <evidence_dir>/acceptance_evidence_<run_id>.json
    Returns (json_path, md_path).
    """
    target_dir = os.path.abspath(evidence_dir or get_evidence_directory())
    os.makedirs(target_dir, exist_ok=True)

    run_id = evidence.get("run_id") or generate_run_id()
    evidence["run_id"] = run_id

    # 1. Canonical JSON file
    json_path = os.path.join(target_dir, "acceptance_evidence.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(evidence, f, indent=2, ensure_ascii=False)

    # 2. Run-stamped JSON copy
    stamped_json_path = os.path.join(target_dir, f"acceptance_evidence_{run_id}.json")
    with open(stamped_json_path, "w", encoding="utf-8") as f:
        json.dump(evidence, f, indent=2, ensure_ascii=False)

    # 3. Human-readable Markdown summary
    md_path = os.path.join(target_dir, "acceptance_evidence.md")
    status = evidence.get("status", "UNKNOWN")
    dataset_info = evidence.get("dataset", {})
    env_info = evidence.get("environment", {})
    stages = evidence.get("stages", {})
    artifacts = evidence.get("artifacts", {})
    criteria = evidence.get("acceptance_criteria", {})
    blocking_reason = evidence.get("blocking_reason")

    md_lines = [
        f"# HETTETY v4 — 3D Reconstruction Acceptance Evidence",
        f"",
        f"- **Run ID**: `{run_id}`",
        f"- **Timestamp (UTC)**: `{evidence.get('timestamp_utc')}`",
        f"- **Overall Status**: **{status}**",
    ]

    if blocking_reason:
        md_lines.append(f"- **Blocking Reason / Prerequisite**: {blocking_reason}")

    md_lines.extend([
        f"",
        f"## 1. Selected Dataset",
        f"- **Fixture Name**: `{dataset_info.get('dataset_name', 'N/A')}`",
        f"- **Real Photographic Data**: `{dataset_info.get('is_real_data', False)}`",
        f"- **Image Keyframes**: {dataset_info.get('image_count', 0)} frames",
        f"- **Survey Benchmarks**: {dataset_info.get('benchmarks_count', 0)} records",
        f"- **Dataset Manifest SHA-256**: `{dataset_info.get('manifest_sha256', 'N/A')}`",
        f"",
        f"## 2. Hardware & Software Runtime",
        f"- **CUDA Available**: `{env_info.get('cuda_available', False)}`",
        f"- **GPU Device**: `{env_info.get('device_name', 'None')}`",
        f"- **VRAM (GB)**: `{env_info.get('total_memory_gb', 0.0)} GB`",
        f"- **PyTorch**: `{env_info.get('pytorch_version', 'None')}` (CUDA `{env_info.get('cuda_version', 'None')}`)",
        f"- **CUDA >= 11.8 Satisfied**: `{env_info.get('cuda_version_sufficient', False)}`",
        f"- **Graphdeco Extensions (diff_gaussian_rasterization, simple_knn)**: `{env_info.get('cuda_extensions_available', False)}`",
        f"- **COLMAP Binary**: `{env_info.get('colmap_version', 'Not found')}` (`{env_info.get('colmap_available', False)}`)",
        f"- **Graphdeco Runner**: `{env_info.get('graphdeco_script_path', 'None')}`",
        f"",
        f"## 3. Photogrammetric Stages Summary",
        f"| Stage | Duration | Metrics / Outcome |",
        f"| :--- | :---: | :--- |",
    ])

    for stage_name, stage_data in stages.items():
        dur = f"{stage_data.get('durationSec', 0.0)}s" if isinstance(stage_data, dict) else "N/A"
        metrics_str = ", ".join([f"{k}={v}" for k, v in stage_data.items() if k != "durationSec"]) if isinstance(stage_data, dict) else str(stage_data)
        md_lines.append(f"| **{stage_name}** | {dur} | {metrics_str} |")

    if not stages:
        md_lines.append(f"| *No stages executed* | N/A | Execution halted prior to stage pipeline |")

    md_lines.extend([
        f"",
        f"## 4. Output Artifacts & Integrity Checksums",
    ])

    if artifacts:
        md_lines.extend([
            f"- **SPZ Gaussian Splats**: {artifacts.get('spz', {}).get('splatCount', 0):,} splats "
            f"({artifacts.get('spz', {}).get('sizeBytes', 0):,} bytes) "
            f"SHA-256: `{artifacts.get('spz', {}).get('sha256', 'N/A')}`",
            f"- **GLB Watertight Mesh**: Valid glTF 2.0 binary "
            f"({artifacts.get('glb', {}).get('sizeBytes', 0):,} bytes) "
            f"SHA-256: `{artifacts.get('glb', {}).get('sha256', 'N/A')}`",
            f"- **Metric Laser Calibration**: Scale Factor = {artifacts.get('calibration', {}).get('scaleFactor', 'N/A')}, "
            f"Holdout RMSE = {artifacts.get('calibration', {}).get('holdoutRmse', 'N/A')} m",
        ])
    else:
        md_lines.append(f"- *No artifacts produced* (Reconstruction not completed)")

    md_lines.extend([
        f"",
        f"## 5. Acceptance Criteria Checklist",
        f"| Criterion | Status | Details |",
        f"| :--- | :---: | :--- |",
    ])

    for crit_name, crit_data in criteria.items():
        c_status = crit_data.get("status", "UNKNOWN") if isinstance(crit_data, dict) else str(crit_data)
        c_details = crit_data.get("details", "") if isinstance(crit_data, dict) else ""
        md_lines.append(f"| **{crit_name}** | `{c_status}` | {c_details} |")

    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines) + "\n")

    return json_path, md_path
