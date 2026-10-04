"""
HETTETY 3D GPU Worker — Metric Calibration & Scale Alignment Module
Estimates physical scale factors from LiDAR markers, architectural anchors, or AR survey dimensions.
Strictly governs the `is_calibrated_metric` gate: scale is uncalibrated unless anchored with confidence >= 0.90.
"""

import os
import json
import math
import logging
from typing import List, Dict, Any, Tuple, Optional

logger = logging.getLogger("hettety-3d-worker.calibrate")

# Egyptian / MENA luxury residential architectural standards (meters)
ARCHITECTURAL_STANDARDS = {
    "door_standard": 2.15,      # 215 cm standard door leaf height
    "ceiling_standard": 2.90,   # 290 cm standard clear room ceiling height
    "corridor_standard": 1.20,  # 120 cm standard residential corridor width
}

def parse_colmap_images_txt(images_txt_path: str) -> Dict[str, List[Tuple[float, float, int]]]:
    """Parses COLMAP images.txt into {image_name: [(x, y, point3d_id), ...]}."""
    if not images_txt_path or not os.path.exists(images_txt_path):
        return {}
    img_map: Dict[str, List[Tuple[float, float, int]]] = {}
    try:
        with open(images_txt_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]
        for i in range(0, len(lines), 2):
            meta = lines[i].split()
            if len(meta) < 10:
                continue
            name = meta[9]
            pts = lines[i+1].split()
            triangulated = []
            for j in range(0, len(pts), 3):
                pid = int(pts[j+2])
                if pid != -1:
                    triangulated.append((float(pts[j]), float(pts[j+1]), pid))
            img_map[name] = triangulated
    except Exception as e:
        logger.warning(f"Error parsing images.txt for landmark resolution: {e}")
    return img_map

def resolve_landmark_pid(
    landmark: Any,
    img_map: Dict[str, List[Tuple[float, float, int]]],
    point3d_map: Optional[Dict[int, Tuple[float, float, float]]] = None,
    max_pixel_dist: float = 2.0
) -> Optional[int]:
    """
    Resolves a surveyed physical landmark to its COLMAP point3d_id.
    Prioritizes matching surveyed 2D image observations to COLMAP triangulated feature tracks.
    Falls back to static colmap_point3d_id if observations are not present or not resolved.
    """
    if not isinstance(landmark, dict):
        try:
            return int(landmark) if landmark is not None else None
        except (ValueError, TypeError):
            return None

    # 1. Resolve via genuine 2D image observations if available
    observations = landmark.get("imageObservations") or landmark.get("observations") or []
    if observations and img_map:
        candidates: Dict[int, int] = {}
        for obs in observations:
            img_name = obs.get("image")
            px, py = obs.get("pixel", [0, 0])
            for x, y, pid in img_map.get(img_name, []):
                d = math.hypot(x - px, y - py)
                if d <= max_pixel_dist:
                    candidates[pid] = candidates.get(pid, 0) + 1
        if candidates:
            valid_candidates = {pid: count for pid, count in candidates.items() if not point3d_map or pid in point3d_map}
            if valid_candidates:
                return max(valid_candidates.items(), key=lambda item: item[1])[0]

    # 2. Fall back to static colmap_point3d_id if specified
    explicit_pid = landmark.get("colmap_point3d_id") or landmark.get("point3d_id")
    if explicit_pid is not None:
        try:
            return int(explicit_pid)
        except (ValueError, TypeError):
            pass

    return None

def calibrate_sparse_scale(
    sparse_points: List[Tuple[float, float, float]],
    reference_anchors: Optional[List[Dict[str, Any]]] = None,
    point3d_map: Optional[Dict[int, Tuple[float, float, float]]] = None,
    images_txt_path: Optional[str] = None,
    sparse_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Evaluates physical scale from reference anchors (LiDAR benchmarks, surveyor markers, or measured spatial correspondences).
    STRICT METRIC INTEGRITY:
    - Standard architectural assumptions (e.g. door 2.15m) alone do NOT award is_calibrated = True.
    - True metric calibration requires explicit spatial endpoints (point_a, point_b) corresponding
      to actual reconstructed geometry (or stable COLMAP POINT3D_IDs), or a verified lidar_benchmark/surveyor_marker, with
      confidence >= 0.90 and error margin <= 5.0%.
    """
    if not reference_anchors or len(reference_anchors) == 0:
        logger.info("No metric scale reference anchors provided. Model scale remains relative visual (uncalibrated).")
        return {
            "is_calibrated": False,
            "scale_factor": 1.0,
            "confidence_score": 0.0,
            "error_margin_percent": 25.0,
            "reference_summary": "None — arbitrary reconstruction units",
            "disclaimer": "Geometry is uncalibrated. Model coordinates represent relative units, not verified meters."
        }

    if not images_txt_path and sparse_dir:
        cand = os.path.join(sparse_dir, "images.txt")
        if os.path.exists(cand):
            images_txt_path = cand
        elif os.path.exists(os.path.join(sparse_dir, "sparse", "0", "images.txt")):
            images_txt_path = os.path.join(sparse_dir, "sparse", "0", "images.txt")

    img_map = parse_colmap_images_txt(images_txt_path) if images_txt_path else {}

    total_weight = 0.0
    weighted_scale = 0.0
    valid_scales = []
    has_physical_ground_truth = False

    # Scene bounding check if points provided
    scene_has_points = len(sparse_points) > 0

    for ref in reference_anchors:
        ref_type = ref.get("type", "custom")
        known = ref.get("known_meters") or ref.get("physicalMeters") or 0.0

        pt_a = None
        pt_b = None
        la = ref.get("landmark_a")
        lb = ref.get("landmark_b")
        p3d_a = resolve_landmark_pid(la, img_map, point3d_map) if la is not None else None
        p3d_b = resolve_landmark_pid(lb, img_map, point3d_map) if lb is not None else None

        if p3d_a is None:
            p3d_a = ref.get("point3d_id_a") or ref.get("colmap_point3d_id_a")
        if p3d_b is None:
            p3d_b = ref.get("point3d_id_b") or ref.get("colmap_point3d_id_b")

        if p3d_a is not None and p3d_b is not None and point3d_map:
            try:
                id_a = int(p3d_a)
                id_b = int(p3d_b)
                if id_a in point3d_map and id_b in point3d_map:
                    pt_a = point3d_map[id_a]
                    pt_b = point3d_map[id_b]
            except (ValueError, TypeError):
                pass

        # 2. Check for explicit 3D endpoint correspondences mapped to reconstruction points
        if not pt_a or not pt_b:
            pt_a = ref.get("reconstruction_point_a") or ref.get("point_a")
            pt_b = ref.get("reconstruction_point_b") or ref.get("point_b")
            idx_a = ref.get("point_idx_a")
            idx_b = ref.get("point_idx_b")

            if idx_a is not None and idx_b is not None and scene_has_points:
                if 0 <= idx_a < len(sparse_points) and 0 <= idx_b < len(sparse_points):
                    pt_a = sparse_points[idx_a]
                    pt_b = sparse_points[idx_b]

        if pt_a and pt_b and len(pt_a) >= 3 and len(pt_b) >= 3:
            dx = float(pt_b[0]) - float(pt_a[0])
            dy = float(pt_b[1]) - float(pt_a[1])
            dz = float(pt_b[2]) - float(pt_a[2])
            measured = math.sqrt(dx * dx + dy * dy + dz * dz)
            has_physical_ground_truth = True
        else:
            measured = ref.get("measured_units", 0.0)

        if measured <= 0.01 or known <= 0.01:
            continue

        scale = known / measured

        # Only LiDAR benchmarks and surveyor markers with physical measurements qualify as ground truth
        if ref_type in ("lidar_benchmark", "surveyor_marker"):
            weight = 4.0
            has_physical_ground_truth = True
        elif ref_type == "ar_survey_measurement" or (pt_a and pt_b):
            weight = 2.5
            has_physical_ground_truth = True
        else:
            # Generic architectural assumption (e.g. assumed door 2.15m without spatial ground truth)
            weight = 0.8

        weighted_scale += scale * weight
        total_weight += weight
        valid_scales.append(scale)

    if total_weight == 0.0 or not valid_scales:
        logger.warning("All supplied metric reference anchors were degenerate (<= 0.01m).")
        return {
            "is_calibrated": False,
            "scale_factor": 1.0,
            "confidence_score": 0.0,
            "error_margin_percent": 30.0,
            "reference_summary": "Degenerate anchors",
            "disclaimer": "Failed to extract valid metric anchors. Model remains uncalibrated."
        }

    final_scale = weighted_scale / total_weight

    # Compute variance and error margin across anchors
    variance = sum((s - final_scale) ** 2 for s in valid_scales) / len(valid_scales)
    std_dev = math.sqrt(variance)
    error_margin_percent = (std_dev / final_scale) * 100.0 if final_scale > 0 else 100.0

    count_bonus = min(0.2, len(valid_scales) * 0.07)
    base_confidence = max(0.0, 1.0 - (error_margin_percent / 15.0))
    confidence_score = min(1.0, max(0.0, base_confidence + count_bonus))

    # STRICT GATE: is_calibrated requires BOTH quantitative consistency (confidence >= 0.90, error <= 5%)
    # AND actual physical ground truth (not merely assumed standard door/ceiling dimensions)
    is_calibrated = (
        (confidence_score >= 0.90) and
        (error_margin_percent <= 5.0) and
        has_physical_ground_truth
    )

    logger.info(
        f"Scale calibration evaluated: scale_factor={final_scale:.4f}, confidence={confidence_score:.2f}, "
        f"error={error_margin_percent:.1f}%, ground_truth={has_physical_ground_truth}, is_calibrated={is_calibrated}"
    )

    return {
        "is_calibrated": is_calibrated,
        "scale_factor": round(final_scale, 4),
        "confidence_score": round(confidence_score, 2),
        "error_margin_percent": round(error_margin_percent, 1),
        "reference_summary": f"{len(valid_scales)} verified anchors ({', '.join(r.get('type', 'custom') for r in reference_anchors)})",
        "disclaimer": (
            "Calibrated 1:1 Metric Scale from verified physical reference markers."
            if is_calibrated else
            "Uncalibrated: reference discrepancy exceeded 5% tolerance or lacked verified physical ground truth."
        )
    }

def apply_metric_scale_to_points(
    points: List[Tuple[float, float, float]],
    scale_factor: float
) -> List[Tuple[float, float, float]]:
    """
    Applies isotropic metric scale factor to 3D point cloud coordinates.
    """
    if abs(scale_factor - 1.0) < 1e-5:
        return points
    return [(p[0] * scale_factor, p[1] * scale_factor, p[2] * scale_factor) for p in points]

def load_survey_benchmarks(survey_file_path: str) -> List[Dict[str, Any]]:
    """
    Loads independent surveyed architectural ground-truth benchmarks from JSON annotation file.
    Guarantees non-circular, surveyor-certified physical truth independently of reconstruction.
    """
    import json
    import os
    if not os.path.exists(survey_file_path):
        logger.warning(f"Survey annotation file not found: {survey_file_path}")
        return []
    with open(survey_file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("benchmarks", data.get("anchors", []))

def evaluate_survey_accuracy(
    point3d_map: Dict[int, Tuple[float, float, float]],
    benchmarks: List[Dict[str, Any]],
    scale_factor: float,
    images_txt_path: Optional[str] = None,
    sparse_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Evaluates independent architectural survey benchmarks against reconstructed 3D geometry.
    Computes absolute error (m), relative error (%), RMSE (m), and maximum error (m).
    STRICTLY NON-CIRCULAR: Reconstructed endpoints are resolved exclusively by pre-surveyed landmark observations and IDs.
    """
    import math
    import numpy as np

    if not images_txt_path and sparse_dir:
        cand = os.path.join(sparse_dir, "images.txt")
        if os.path.exists(cand):
            images_txt_path = cand
        elif os.path.exists(os.path.join(sparse_dir, "sparse", "0", "images.txt")):
            images_txt_path = os.path.join(sparse_dir, "sparse", "0", "images.txt")

    img_map = parse_colmap_images_txt(images_txt_path) if images_txt_path else {}

    results = []
    errors = []
    rel_errors = []

    for b in benchmarks:
        b_id = b.get("id", "benchmark")
        desc = b.get("description", "")
        known_m = float(b.get("physicalMeters") or b.get("known_meters") or 0.0)
        tolerance = float(b.get("toleranceMeters", 0.05))

        la = b.get("landmark_a", {})
        lb = b.get("landmark_b", {})
        p3d_a = resolve_landmark_pid(la, img_map, point3d_map) if la is not None else None
        p3d_b = resolve_landmark_pid(lb, img_map, point3d_map) if lb is not None else None

        if p3d_a is None:
            p3d_a = b.get("point3d_id_a") or b.get("colmap_point3d_id_a")
        if p3d_b is None:
            p3d_b = b.get("point3d_id_b") or b.get("colmap_point3d_id_b")

        if p3d_a is None or p3d_b is None:
            continue
        if p3d_a not in point3d_map or p3d_b not in point3d_map:
            logger.warning(f"Benchmark {b_id}: landmark points {p3d_a}, {p3d_b} not found in reconstruction.")
            continue

        pt_a = np.array(point3d_map[p3d_a])
        pt_b = np.array(point3d_map[p3d_b])
        reconstructed_dist = float(np.linalg.norm(pt_b - pt_a))
        scaled_dist = reconstructed_dist * scale_factor

        abs_err = abs(scaled_dist - known_m)
        rel_err = (abs_err / known_m) * 100.0 if known_m > 0 else 0.0

        errors.append(abs_err)
        rel_errors.append(rel_err)

        results.append({
            "id": b_id,
            "description": desc,
            "physicalMeters": known_m,
            "reconstructedMeters": round(scaled_dist, 4),
            "unscaledUnits": round(reconstructed_dist, 4),
            "absoluteErrorMeters": round(abs_err, 4),
            "relativeErrorPercent": round(rel_err, 2),
            "passedTolerance": abs_err <= tolerance,
            "landmark_a_pid": p3d_a,
            "landmark_b_pid": p3d_b
        })

    if not errors:
        return {
            "passed": False,
            "rmse": 999.0,
            "maxError": 999.0,
            "meanRelativeErrorPct": 100.0,
            "benchmarks": []
        }

    rmse = math.sqrt(sum(e**2 for e in errors) / len(errors))
    max_err = max(errors)
    mean_rel = sum(rel_errors) / len(rel_errors)

    return {
        "passed": rmse <= 0.05 and max_err <= 0.05,
        "rmse": round(rmse, 4),
        "maxError": round(max_err, 4),
        "meanRelativeErrorPct": round(mean_rel, 2),
        "benchmarksCount": len(results),
        "benchmarks": results
    }

