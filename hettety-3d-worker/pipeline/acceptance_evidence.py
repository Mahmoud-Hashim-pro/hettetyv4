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
import shutil
import hashlib
from typing import Dict, Any, Optional, Tuple, List, Set, Union

# Allowed fixture datasets explicitly permitted for acceptance testing
ALLOWED_ACCEPTANCE_DATASETS: Set[str] = {
    "prop_villa_marassi_01",
    "prop_courtyard_dslr_02",
}

# Authoritative quality criteria profiles per allowlisted dataset
DATASET_ACCEPTANCE_PROFILES: Dict[str, Dict[str, Any]] = {
    "prop_villa_marassi_01": {
        "dataset_name": "prop_villa_marassi_01",
        "description": "28 High-Resolution DSLR Keyframes with 4 Laser Survey Anchors",
        "min_keyframes": 24,
        "total_keyframes": 28,
        "min_registered_cameras": 24,  # >= 85% of total
        "min_sparse_points": 500,
        "max_reprojection_error": 1.80,  # pixels
        "min_dense_points": 5000,
        "min_splats": 50000,
        "max_holdout_rmse": 0.05,  # 5 cm
        "min_survey_benchmarks": 4,
    },
    "prop_courtyard_dslr_02": {
        "dataset_name": "prop_courtyard_dslr_02",
        "description": "14 High-Resolution DSLR Keyframes with 2 Laser Survey Anchors",
        "min_keyframes": 12,
        "total_keyframes": 14,
        "min_registered_cameras": 12,  # >= 85% of total
        "min_sparse_points": 300,
        "max_reprojection_error": 2.00,  # pixels
        "min_dense_points": 2500,
        "min_splats": 25000,
        "max_holdout_rmse": 0.05,  # 5 cm
        "min_survey_benchmarks": 2,
    },
}


def get_dataset_acceptance_profile(dataset_name: Optional[str]) -> Dict[str, Any]:
    """Retrieves authoritative acceptance quality thresholds for the given dataset."""
    name = sanitize_dataset_name(dataset_name or "prop_villa_marassi_01")
    if name not in DATASET_ACCEPTANCE_PROFILES:
        raise ValueError(f"No acceptance quality profile configured for dataset '{name}'.")
    return dict(DATASET_ACCEPTANCE_PROFILES[name])


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




def compute_file_hash(filepath: str) -> Tuple[str, int]:
    """Calculates SHA-256 hash and byte size of a file in streaming 64KB chunks."""
    hasher = hashlib.sha256()
    total_size = 0
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
            total_size += len(chunk)
    return hasher.hexdigest(), total_size


def compute_directory_manifest_hash(dir_path: str) -> Tuple[str, int, int]:
    """
    Computes a deterministic, tamper-evident manifest hash of an entire directory tree.
    Recursively scans files, handles symlinks securely (rejects links escaping dir_path),
    normalizes relative paths with forward slashes '/', sorts paths lexicographically,
    and updates the SHA-256 manifest hasher with '<relative_path>:<file_sha256>:<file_size_bytes>\\n'.
    Returns (manifest_sha256, total_size_bytes, file_count).
    """
    real_dir = os.path.realpath(os.path.abspath(dir_path))
    if not os.path.isdir(real_dir):
        raise ValueError(f"Directory not found or not a directory: {dir_path}")

    manifest_hasher = hashlib.sha256()
    total_size = 0
    file_count = 0
    entries: List[Tuple[str, str, int]] = []

    for root, dirs, files in os.walk(real_dir):
        for d in dirs:
            dp = os.path.join(root, d)
            if os.path.islink(dp):
                target = os.path.realpath(dp)
                try:
                    common = os.path.commonpath([real_dir, target])
                    if common != real_dir:
                        raise ValueError(f"SECURITY_VIOLATION: Directory symlink '{dp}' escapes directory boundary '{real_dir}' -> '{target}'")
                except ValueError as err:
                    raise ValueError(f"SECURITY_VIOLATION: Directory symlink error on '{dp}': {err}")

        for f in files:
            fp = os.path.join(root, f)
            # Safely verify symlinks do not escape target directory
            if os.path.islink(fp):
                target = os.path.realpath(fp)
                try:
                    common = os.path.commonpath([real_dir, target])
                    if common != real_dir:
                        raise ValueError(f"SECURITY_VIOLATION: Symlink '{fp}' escapes directory boundary '{real_dir}' -> '{target}'")
                except ValueError as err:
                    raise ValueError(f"SECURITY_VIOLATION: Symlink error on '{fp}': {err}")

            rel_path = os.path.relpath(fp, real_dir).replace("\\", "/")
            file_sha, file_size = compute_file_hash(fp)
            entries.append((rel_path, file_sha, file_size))

    # Sort lexicographically by normalized relative path
    entries.sort(key=lambda x: x[0])

    for rel_path, file_sha, file_size in entries:
        line = f"{rel_path}:{file_sha}:{file_size}\n"
        manifest_hasher.update(line.encode("utf-8"))
        total_size += file_size
        file_count += 1

    return manifest_hasher.hexdigest(), total_size, file_count


def retain_deliverables(
    run_id: str,
    source_artifacts: Dict[str, Any],
    evidence_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Persistently copies authoritative 3D reconstruction deliverables, PLYs,
    meshes, sparse data, and execution logs from ephemeral working directories
    into the persistent evidence repository.

    Ensures 3D deliverables survive test tearDown cleanup (temp directory rmtree).
    Calculates and verifies SHA-256 checksums and file sizes for all retained assets.
    Returns an updated manifest dictionary with persistent paths.
    """
    target_evidence_dir = os.path.abspath(evidence_dir or get_evidence_directory())
    run_deliverables_dir = os.path.join(target_evidence_dir, "runs", run_id, "deliverables")
    os.makedirs(run_deliverables_dir, exist_ok=True)

    retained: Dict[str, Any] = {}

    def _copy_and_audit(src_path: str, dest_name: str) -> Optional[Dict[str, Any]]:
        if not src_path or not os.path.exists(src_path):
            return None
        dest_path = os.path.join(run_deliverables_dir, dest_name)
        if os.path.isdir(src_path):
            if os.path.exists(dest_path):
                shutil.rmtree(dest_path, ignore_errors=True)
            shutil.copytree(src_path, dest_path)
            orig_sha, orig_size, orig_count = compute_directory_manifest_hash(src_path)
            dest_sha, dest_size, dest_count = compute_directory_manifest_hash(dest_path)
            if dest_sha != orig_sha or dest_size != orig_size or dest_count != orig_count:
                raise ValueError(
                    f"COPY_INTEGRITY_VIOLATION: Retained directory '{dest_name}' manifest {dest_sha} != source {orig_sha}"
                )
            return {
                "path": dest_path,
                "isDirectory": True,
                "fileCount": dest_count,
                "sizeBytes": dest_size,
                "sha256": dest_sha,
                "evidence_dir": target_evidence_dir,
            }
        else:
            orig_h, orig_s = compute_file_hash(src_path)
            shutil.copy2(src_path, dest_path)
            h, s = compute_file_hash(dest_path)
            if h != orig_h or s != orig_s:
                raise ValueError(f"COPY_INTEGRITY_VIOLATION: Retained file '{dest_name}' hash {h} != source hash {orig_h}")
            return {
                "path": dest_path,
                "isDirectory": False,
                "sizeBytes": s,
                "sha256": h,
                "evidence_dir": target_evidence_dir,
            }

    for art_key, art_val in source_artifacts.items():
        if isinstance(art_val, str):
            res = _copy_and_audit(art_val, os.path.basename(art_val))
            if res:
                retained[art_key] = res
            else:
                retained[art_key] = {
                    "path": art_val,
                    "persisted": False,
                    "error": f"PERSISTENCE_FAILED: Source asset not found on disk at '{art_val}'"
                }
        elif isinstance(art_val, dict):
            src_p = art_val.get("path")
            if src_p and os.path.exists(src_p):
                filename = art_val.get("target_filename") or os.path.basename(src_p)
                audit_res = _copy_and_audit(src_p, filename)
                if audit_res:
                    merged = dict(art_val)
                    merged.update(audit_res)
                    retained[art_key] = merged
            else:
                failed = dict(art_val)
                failed["persisted"] = False
                failed["error"] = f"PERSISTENCE_FAILED: Source asset not found on disk at '{src_p}'"
                retained[art_key] = failed
        else:
            retained[art_key] = art_val

    # Also maintain latest deliverables copy
    latest_deliverables_dir = os.path.join(target_evidence_dir, "retained_artifacts")
    os.makedirs(latest_deliverables_dir, exist_ok=True)
    for art_key, info in retained.items():
        if isinstance(info, dict) and "path" in info and os.path.exists(info["path"]):
            p = info["path"]
            target_latest = os.path.join(latest_deliverables_dir, os.path.basename(p))
            if os.path.isfile(p):
                shutil.copy2(p, target_latest)
            elif os.path.isdir(p):
                if os.path.exists(target_latest):
                    shutil.rmtree(target_latest, ignore_errors=True)
                shutil.copytree(p, target_latest)

    return retained


def verify_retained_deliverables(
    evidence_json_or_dict: Union[str, Dict[str, Any]],
    base_dir: Optional[str] = None,
    required_keys: Optional[List[str]] = None
) -> Tuple[bool, List[str]]:
    """
    Authoritative Fail-Closed Verification of Retained Acceptance Deliverables:
    1. Rejects malformed input types or empty manifest.
    2. Validates presence of all required deliverable keys.
    3. Rejects missing, empty, or non-string paths.
    4. Enforces strict boundary containment within configured evidence directory
       (fails closed on directory traversal or symlink boundary escapes).
    5. Proves each deliverable exists on disk and is non-empty.
    6. Strictly requires valid 64-character hex 'sha256' and integer 'sizeBytes' (> 0).
    7. For directories: strictly requires positive 'fileCount' (> 0) and verifies
       recomputed recursive deterministic manifest hash, file count, and byte size.
    8. For files: recomputes SHA-256 and byte size, proving exact match against manifest.
    Returns (is_valid, list_of_errors). Returns (False, errors) on any discrepancy.
    """
    if isinstance(evidence_json_or_dict, str):
        if not os.path.isfile(evidence_json_or_dict):
            return False, [f"Evidence JSON file not found: {evidence_json_or_dict}"]
        try:
            with open(evidence_json_or_dict, "r", encoding="utf-8") as f:
                evidence = json.load(f)
        except Exception as e:
            return False, [f"Evidence JSON file malformed at '{evidence_json_or_dict}': {e}"]
    elif isinstance(evidence_json_or_dict, dict):
        evidence = evidence_json_or_dict
    else:
        return False, [f"Invalid evidence input type: {type(evidence_json_or_dict).__name__}"]

    if not isinstance(evidence, dict) or not evidence:
        return False, ["Evidence manifest is empty or not a valid dictionary."]

    artifacts = evidence.get("artifacts")
    if artifacts is None:
        artifacts = evidence.get("retained_artifacts")

    if not isinstance(artifacts, dict) or not artifacts:
        return False, ["No artifacts found in evidence manifest."]

    errors: List[str] = []

    if required_keys:
        for req in required_keys:
            if req not in artifacts:
                errors.append(f"Retained evidence manifest is missing required deliverable '{req}'.")

    # Authoritative trusted evidence root boundary determination:
    # 1. Prefer explicit base_dir argument.
    # 2. Otherwise for a JSON file path, use its containing directory.
    # 3. Otherwise use trusted HETTETY_ACCEPTANCE_EVIDENCE_DIR from environment.
    # 4. In-memory dictionary with no explicit base_dir and no configured environment root must FAIL CLOSED.
    # NEVER trust evidence["evidence_dir"] as the root boundary.
    trusted_root: Optional[str] = None
    if base_dir:
        trusted_root = os.path.realpath(os.path.abspath(base_dir))
    elif isinstance(evidence_json_or_dict, str):
        trusted_root = os.path.realpath(os.path.abspath(os.path.dirname(evidence_json_or_dict)))
    elif os.environ.get("HETTETY_ACCEPTANCE_EVIDENCE_DIR"):
        trusted_root = os.path.realpath(os.path.abspath(os.environ["HETTETY_ACCEPTANCE_EVIDENCE_DIR"]))

    if not trusted_root:
        return False, ["SECURITY_VIOLATION: In-memory evidence manifest missing explicit trusted root boundary."]

    # Top-level evidence_dir validation: if present in manifest, it MUST match trusted_root
    manifest_ev_dir = evidence.get("evidence_dir")
    if manifest_ev_dir is not None:
        if not isinstance(manifest_ev_dir, str) or not manifest_ev_dir.strip():
            errors.append("SECURITY_VIOLATION: Evidence manifest declares invalid 'evidence_dir'.")
        else:
            canonical_manifest_dir = os.path.realpath(os.path.abspath(manifest_ev_dir))
            if os.path.normcase(canonical_manifest_dir) != os.path.normcase(trusted_root):
                errors.append(
                    f"SECURITY_VIOLATION: Evidence manifest evidence_dir '{manifest_ev_dir}' does not match trusted evidence root '{trusted_root}'."
                )

    for key, art_meta in artifacts.items():
        if not isinstance(art_meta, dict):
            errors.append(f"Deliverable '{key}' metadata is malformed: expected dictionary, got {type(art_meta).__name__}")
            continue

        # Surface log or deliverable persistence failures directly as diagnostic failures
        if art_meta.get("persisted") is False or "error" in art_meta:
            err_msg = art_meta.get("error", "persistence failed")
            errors.append(f"Deliverable '{key}' failed persistence: {err_msg}")
            continue

        p = art_meta.get("path")
        if not p or not isinstance(p, str) or not p.strip():
            errors.append(f"Deliverable '{key}' metadata is missing a valid non-empty 'path' string.")
            continue

        # If artifact metadata declares evidence_dir, it MUST match trusted_root (no override permitted)
        meta_ev_dir = art_meta.get("evidence_dir")
        if meta_ev_dir is not None:
            if not isinstance(meta_ev_dir, str) or not meta_ev_dir.strip():
                errors.append(f"SECURITY_VIOLATION: Deliverable '{key}' evidence_dir is invalid.")
                continue
            canonical_meta_dir = os.path.realpath(os.path.abspath(meta_ev_dir))
            if os.path.normcase(canonical_meta_dir) != os.path.normcase(trusted_root):
                errors.append(
                    f"SECURITY_VIOLATION: Deliverable '{key}' evidence_dir '{meta_ev_dir}' does not match trusted evidence root '{trusted_root}'."
                )
                continue

        # Check deliverable path containment strictly inside trusted_root
        if not os.path.isabs(p):
            resolved_p = os.path.join(trusted_root, p)
        else:
            resolved_p = p

        canonical_p = os.path.realpath(os.path.abspath(resolved_p))

        try:
            common = os.path.commonpath([trusted_root, canonical_p])
            if os.path.normcase(common) != os.path.normcase(trusted_root):
                errors.append(f"SECURITY_VIOLATION: Deliverable '{key}' path '{p}' escapes trusted evidence directory '{trusted_root}'.")
                continue
        except Exception as ve:
            errors.append(f"SECURITY_VIOLATION: Deliverable '{key}' boundary verification error for '{p}': {ve}")
            continue

        if not os.path.exists(canonical_p):
            errors.append(f"Retained artifact '{key}' missing at '{p}'")
            continue

        # Check sha256 metadata: required, must be 64-char hex string
        expected_sha = art_meta.get("sha256")
        if not expected_sha or not isinstance(expected_sha, str) or len(expected_sha) != 64 or not all(c in "0123456789abcdefABCDEF" for c in expected_sha):
            errors.append(f"Deliverable '{key}' is missing required 64-character hex 'sha256'.")
            expected_sha = None

        # Check sizeBytes metadata: required, must be integer > 0
        expected_size = art_meta.get("sizeBytes") if "sizeBytes" in art_meta else art_meta.get("size_bytes")
        if expected_size is None or not isinstance(expected_size, int) or expected_size <= 0:
            errors.append(f"Deliverable '{key}' is missing or has invalid 'sizeBytes' (must be integer > 0).")
            expected_size = None

        is_dir = art_meta.get("isDirectory", False) or os.path.isdir(canonical_p)

        if is_dir:
            if not os.path.isdir(canonical_p):
                errors.append(f"Artifact '{key}' expected to be directory but is file at '{p}'")
                continue

            expected_count = art_meta.get("fileCount") if "fileCount" in art_meta else art_meta.get("file_count")
            if expected_count is None or not isinstance(expected_count, int) or expected_count <= 0:
                errors.append(f"Directory deliverable '{key}' is missing or has invalid 'fileCount' (must be integer > 0).")
                expected_count = None

            try:
                actual_sha, actual_size, actual_count = compute_directory_manifest_hash(canonical_p)
                if actual_count == 0:
                    errors.append(f"Directory deliverable '{key}' is empty on disk (0 files).")
                elif expected_count is not None and actual_count != expected_count:
                    errors.append(f"Directory '{key}' file count mismatch: expected {expected_count}, got {actual_count}")

                if actual_size == 0:
                    errors.append(f"Directory deliverable '{key}' has 0 bytes total size.")
                elif expected_size is not None and actual_size != expected_size:
                    errors.append(f"Directory '{key}' size mismatch: expected {expected_size}, got {actual_size}")

                if expected_sha and actual_sha.lower() != expected_sha.lower():
                    errors.append(f"Directory '{key}' manifest hash mismatch: expected {expected_sha}, got {actual_sha}")
            except Exception as e:
                errors.append(f"Failed to audit directory '{key}' at '{p}': {e}")
        else:
            if not os.path.isfile(canonical_p):
                errors.append(f"Artifact '{key}' expected to be file but is directory at '{p}'")
                continue

            actual_size = os.path.getsize(canonical_p)
            if actual_size == 0:
                errors.append(f"Retained artifact '{key}' is empty (0 bytes) at '{p}'")
                continue

            if expected_size is not None and actual_size != expected_size:
                errors.append(f"Artifact '{key}' size mismatch: expected {expected_size}, got {actual_size}")

            try:
                actual_sha, _ = compute_file_hash(canonical_p)
                if expected_sha and actual_sha.lower() != expected_sha.lower():
                    errors.append(f"Artifact '{key}' SHA-256 mismatch: expected {expected_sha}, got {actual_sha}")
            except Exception as e:
                errors.append(f"Failed to hash file '{key}' at '{p}': {e}")

    return len(errors) == 0, errors

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
    evidence["evidence_dir"] = target_dir

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
        for art_key, art_val in sorted(artifacts.items()):
            if isinstance(art_val, dict) and "path" in art_val:
                sha_str = art_val.get("sha256", "N/A")
                size_str = f"{art_val.get('sizeBytes', 0):,} bytes" if "sizeBytes" in art_val else "N/A"
                extra = f", {art_val.get('splatCount'):,} splats" if "splatCount" in art_val else ""
                md_lines.append(f"- **{art_key.upper()}**: `{art_val['path']}` ({size_str}{extra}) SHA-256: `{sha_str}`")
        if "calibration" in artifacts and isinstance(artifacts["calibration"], dict):
            calib = artifacts["calibration"]
            md_lines.append(f"- **METRIC CALIBRATION**: Scale Factor = {calib.get('scaleFactor', 'N/A')}, Holdout RMSE = {calib.get('holdoutRmse', 'N/A')} m")
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
