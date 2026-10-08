"""
HETTETY 3D GPU Worker — Authoritative Reconstruction Quality Gate
Single source of truth for tour quality evaluation across the entire lifecycle.
Evaluates camera alignment, Gaussian splatting distribution, metric mesh geometry, and spatial scale integrity.
Jobs that fail this gate are strictly blocked from publishing and moved to FAILED.
"""

import math
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("hettety-3d-worker.quality_gate")

def evaluate_reconstruction_quality(
    image_count: int,
    registered_cameras: int,
    mean_reprojection_error: float,
    splat_count: int,
    bounds: Optional[Dict[str, Any]],
    mesh_vertex_count: int,
    mesh_face_count: int,
    glb_size_bytes: int,
    is_calibrated_metric: bool = False,
    calibration_confidence: float = 0.0,
    calibration_rmse: Optional[float] = None,
    has_nan_or_inf: bool = False,
    sharpness_score: Optional[int] = None,
    floaters_pruned: Optional[int] = None
) -> Dict[str, Any]:
    """
    Authoritative quality gate evaluation.
    Returns:
    {
        "passed": bool,
        "status": "READY" | "REJECTED" | "WARNING",
        "overallScore": int (0 - 100),
        "checks": {
            "cameraAlignment": {"passed": bool, "score": int, "issues": [...]},
            "gaussianSplatting": {"passed": bool, "score": int, "issues": [...]},
            "meshGeometry": {"passed": bool, "score": int, "issues": [...]},
            "metricCalibration": {"passed": bool, "score": int, "issues": [...]}
        },
        "reasons": [...]
    }
    """
    reasons: List[str] = []

    # 1. Camera Alignment Check
    cam_issues: List[str] = []
    cam_passed = True
    if registered_cameras < 8:
        cam_passed = False
        msg = f"Insufficient registered cameras: {registered_cameras} (minimum 8 required)"
        cam_issues.append(msg)
        reasons.append(msg)

    reg_ratio = (registered_cameras / max(1, image_count)) if image_count > 0 else 0.0
    if reg_ratio < 0.35:
        cam_passed = False
        msg = f"Camera alignment ratio too low: {reg_ratio * 100:.1f}% (minimum 35% overlap required)"
        cam_issues.append(msg)
        reasons.append(msg)

    if mean_reprojection_error > 3.0:
        cam_passed = False
        msg = f"Mean reprojection error exceeds 3.0px limit: {mean_reprojection_error:.2f}px"
        cam_issues.append(msg)
        reasons.append(msg)

    cam_score = int(min(100, max(0, reg_ratio * 60.0 + max(0, (3.0 - mean_reprojection_error) / 3.0) * 40.0)))

    # 2. Gaussian Splatting Check
    gs_issues: List[str] = []
    gs_passed = True
    if splat_count < 100:
        gs_passed = False
        msg = f"Degenerate splat cloud: only {splat_count} splats produced"
        gs_issues.append(msg)
        reasons.append(msg)

    if floaters_pruned is not None and floaters_pruned > 0:
        total_splats = splat_count + floaters_pruned
        prune_ratio = floaters_pruned / total_splats if total_splats > 0 else 0.0
        if prune_ratio > 0.80:
            gs_passed = False
            msg = f"Excessive floater pruning ratio: {floaters_pruned}/{total_splats} ({prune_ratio*100:.1f}% > 80.0% pruned, indicating noisy or unreliable reconstruction)"
            gs_issues.append(msg)
            reasons.append(msg)

    if has_nan_or_inf:
        gs_passed = False
        msg = "Corrupted non-finite (NaN or Inf) coordinates detected in Gaussian primitives"
        gs_issues.append(msg)
        reasons.append(msg)

    if not bounds or "min" not in bounds or "max" not in bounds:
        gs_passed = False
        msg = "Missing or invalid bounding box boundaries for reconstructed scene"
        gs_issues.append(msg)
        reasons.append(msg)
    else:
        # Check that bounding box has positive volume
        b_min = bounds.get("min", [0, 0, 0])
        b_max = bounds.get("max", [0, 0, 0])
        dx = b_max[0] - b_min[0]
        dy = b_max[1] - b_min[1]
        dz = b_max[2] - b_min[2]
        if dx <= 0.01 or dy <= 0.01 or dz <= 0.01:
            gs_passed = False
            msg = f"Degenerate bounding box volume: [{dx:.2f}, {dy:.2f}, {dz:.2f}]"
            gs_issues.append(msg)
            reasons.append(msg)

    gs_score = int(min(100, max(20, min(splat_count / 10000.0, 1.0) * 60.0 + (40.0 if gs_passed else 0.0))))

    # 3. Metric Mesh Geometry Check
    mesh_issues: List[str] = []
    mesh_passed = True
    if mesh_vertex_count < 4 or mesh_face_count < 2:
        mesh_passed = False
        msg = f"Degenerate metric mesh: {mesh_vertex_count} vertices, {mesh_face_count} faces"
        mesh_issues.append(msg)
        reasons.append(msg)

    if glb_size_bytes > 0 and glb_size_bytes < 12:
        mesh_passed = False
        msg = f"Corrupted GLB container size ({glb_size_bytes} bytes < 12 byte glTF binary header)"
        mesh_issues.append(msg)
        reasons.append(msg)

    mesh_score = int(min(100, max(20, (50.0 if mesh_face_count >= 20 else 30.0) + (50.0 if mesh_passed else 0.0))))

    # 4. Metric Calibration Check
    calib_issues: List[str] = []
    calib_passed = True
    if is_calibrated_metric:
        if calibration_confidence is not None and calibration_confidence > 0.0 and calibration_confidence < 0.85:
            calib_passed = False
            msg = f"Metric calibration confidence {calibration_confidence:.2f} below certified threshold (0.85)"
            calib_issues.append(msg)
            reasons.append(msg)
        if calibration_rmse is not None and calibration_rmse > 0.05:
            calib_passed = False
            msg = f"Metric calibration RMSE {calibration_rmse:.4f}m exceeds 5cm certified threshold"
            calib_issues.append(msg)
            reasons.append(msg)
    calib_score = 100 if (is_calibrated_metric and calib_passed) else (70 if not is_calibrated_metric else 40)

    # Global Decision
    visual_ready = cam_passed and gs_passed and mesh_passed
    metric_certified = bool(is_calibrated_metric and calib_passed)
    overall_passed = cam_passed and gs_passed and mesh_passed and calib_passed
    overall_score = int(cam_score * 0.35 + gs_score * 0.30 + mesh_score * 0.20 + calib_score * 0.15)
    status = "READY" if overall_passed else "REJECTED"

    logger.info(
        f"Reconstruction Quality Gate: status={status}, score={overall_score}, "
        f"cam={cam_passed}, gs={gs_passed}, mesh={mesh_passed}, calib={calib_passed}, "
        f"visualReady={visual_ready}, metricCertified={metric_certified}, reasons={reasons}"
    )

    return {
        "passed": overall_passed,
        "status": status,
        "overallScore": overall_score,
        "certification": {
            "visualReady": visual_ready,
            "metricCertified": metric_certified,
        },
        "checks": {
            "cameraAlignment": {"passed": cam_passed, "score": cam_score, "issues": cam_issues},
            "gaussianSplatting": {"passed": gs_passed, "score": gs_score, "issues": gs_issues},
            "meshGeometry": {"passed": mesh_passed, "score": mesh_score, "issues": mesh_issues},
            "metricCalibration": {"passed": calib_passed, "score": calib_score, "issues": calib_issues}
        },
        "reasons": reasons
    }
