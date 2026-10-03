"""
HETTETY 3D GPU Worker — Stage 2: Structure-from-Motion (SfM)
Runs feature detection, matching, and sparse bundle adjustment via COLMAP.
Optimizes matching strategy: sequential for video captures, exhaustive for <=50 photos, vocab-tree for large sets.
"""

import subprocess
import os
import logging
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger("hettety-3d-worker.colmap")

class SfMResult(dict):
    """Result object supporting dictionary access and boolean truthiness."""
    def __bool__(self):
        return bool(self.get("success", False))

def parse_colmap_reconstruction_metrics(sparse_dir: str) -> Tuple[int, int, str]:
    """
    Parses sparse reconstruction directory to extract number of registered images
    and 3D points. Checks sub-folder 0 first, then root.
    """
    candidate_dirs = [os.path.join(sparse_dir, "0"), sparse_dir]
    target_dir = ""
    for c_dir in candidate_dirs:
        if os.path.exists(c_dir):
            if any(os.path.exists(os.path.join(c_dir, f)) for f in ["images.txt", "images.bin", "cameras.bin", "cameras.txt", "points3D.txt", "points3D.bin"]):
                target_dir = c_dir
                break

    if not target_dir:
        return 0, 0, "", {
            "registered_images": 0,
            "points_count": 0,
            "sparse_dir": "",
            "mean_reprojection_error": 0.0,
            "median_reprojection_error": 0.0,
            "max_reprojection_error": 0.0,
            "mean_track_length": 0.0
        }

    # Convert binary to TXT if TXT files do not exist
    images_txt = os.path.join(target_dir, "images.txt")
    points_txt = os.path.join(target_dir, "points3D.txt")
    images_bin = os.path.join(target_dir, "images.bin")

    if not os.path.exists(images_txt) and os.path.exists(images_bin):
        try:
            cmd_convert = [
                "colmap", "model_converter",
                "--input_path", target_dir,
                "--output_path", target_dir,
                "--output_type", "TXT"
            ]
            subprocess.run(cmd_convert, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except Exception as e:
            logger.warning(f"colmap model_converter note: {e}")

    registered_images = 0
    if os.path.exists(images_txt):
        try:
            with open(images_txt, "r", encoding="utf-8", errors="ignore") as f:
                # In COLMAP images.txt, each registered image has 2 non-comment lines
                non_comment = sum(1 for line in f if not line.startswith("#") and line.strip())
                registered_images = non_comment // 2
        except Exception as e:
            logger.warning(f"Could not parse images.txt: {e}")

    points_count = 0
    errors = []
    track_lengths = []
    if os.path.exists(points_txt):
        try:
            with open(points_txt, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith("#") or not line.strip():
                        continue
                    parts = line.split()
                    if len(parts) >= 8:
                        points_count += 1
                        try:
                            err = float(parts[7])
                            errors.append(err)
                            track_len = (len(parts) - 8) // 2
                            track_lengths.append(track_len)
                        except ValueError:
                            pass
        except Exception as e:
            logger.warning(f"Could not parse points3D.txt: {e}")

    mean_reproj_error = sum(errors) / len(errors) if errors else 0.0
    sorted_errors = sorted(errors)
    median_reproj_error = sorted_errors[len(sorted_errors)//2] if sorted_errors else 0.0
    max_reproj_error = max(errors) if errors else 0.0
    mean_track_length = sum(track_lengths) / len(track_lengths) if track_lengths else 0.0

    metrics = {
        "registered_images": registered_images,
        "points_count": points_count,
        "sparse_dir": target_dir,
        "mean_reprojection_error": round(mean_reproj_error, 3),
        "median_reprojection_error": round(median_reproj_error, 3),
        "max_reprojection_error": round(max_reproj_error, 3),
        "mean_track_length": round(mean_track_length, 2)
    }

    return registered_images, points_count, target_dir, metrics

def run_sfm(image_dir: str, output_dir: str, is_video: bool = False) -> SfMResult:
    db_path = os.path.join(output_dir, "database.db")
    sparse_dir = os.path.join(output_dir, "sparse")
    os.makedirs(sparse_dir, exist_ok=True)

    images = [f for f in os.listdir(image_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    image_count = len(images)
    logger.info(f"Running COLMAP SfM on {image_count} images (is_video={is_video})")

    if image_count < 8:
        return SfMResult({
            "success": False,
            "error_code": "TOO_FEW_IMAGES",
            "registered_images": 0,
            "points_count": 0,
            "message": f"COLMAP requires at least 8 images, but only {image_count} were provided."
        })

    # 1. Feature extraction
    cmd_extract = [
        "colmap", "feature_extractor",
        "--database_path", db_path,
        "--image_path", image_dir,
        "--ImageReader.camera_model", "OPENCV",
        "--SiftExtraction.use_gpu", "1"
    ]
    subprocess.run(cmd_extract, check=True)

    # 2. Adaptive matching: sequential for video captures or >100 images, exhaustive for photo clusters
    if is_video or image_count > 100:
        logger.info("Using Sequential Matcher for continuous spatial sequence...")
        cmd_match = [
            "colmap", "sequential_matcher",
            "--database_path", db_path,
            "--SequentialMatching.overlap", "15",
            "--SiftMatching.use_gpu", "1"
        ]
    else:
        logger.info("Using Exhaustive Matcher for multi-angle photo cluster...")
        cmd_match = [
            "colmap", "exhaustive_matcher",
            "--database_path", db_path,
            "--SiftMatching.use_gpu", "1"
        ]
    subprocess.run(cmd_match, check=True)

    # 3. Mapper / Sparse Reconstruction
    cmd_mapper = [
        "colmap", "mapper",
        "--database_path", db_path,
        "--image_path", image_dir,
        "--output_path", sparse_dir,
        "--Mapper.min_num_matches", "15"
    ]
    subprocess.run(cmd_mapper, check=True)

    # 4. Quantitative verification of registered cameras and sparse point cloud
    registered_images, points_count, valid_sparse, metrics = parse_colmap_reconstruction_metrics(sparse_dir)
    logger.info(
        f"COLMAP SfM finished: {registered_images}/{image_count} images registered, {points_count} 3D points created. "
        f"Mean error: {metrics['mean_reprojection_error']}px, Track len: {metrics['mean_track_length']}"
    )

    # Strict quantitative quality gates:
    # A. Minimum registered cameras
    if registered_images < 8:
        logger.error(f"COLMAP failed to register sufficient cameras: {registered_images} registered (min 8 required).")
        return SfMResult({
            "success": False,
            "error_code": "INSUFFICIENT_REGISTERED_CAMERAS",
            "registered_images": registered_images,
            "points_count": points_count,
            "message": f"COLMAP registered only {registered_images} out of {image_count} images (minimum 8 required for 3D reconstruction)."
        })

    # B. Registration ratio (at least 35% of input photos must be registered)
    reg_ratio = registered_images / max(1, image_count)
    if reg_ratio < 0.35:
        logger.error(f"Low registration ratio: {registered_images}/{image_count} ({reg_ratio*100:.1f}%).")
        return SfMResult({
            "success": False,
            "error_code": "LOW_CAMERA_REGISTRATION_RATIO",
            "registered_images": registered_images,
            "points_count": points_count,
            "message": f"Only {registered_images}/{image_count} images ({reg_ratio*100:.1f}%) could be spatially aligned. Minimum 35% overlap required."
        })

    # C. Minimum sparse point cloud density
    if points_count < 50:
        logger.error(f"Degenerate sparse point cloud: only {points_count} points created.")
        return SfMResult({
            "success": False,
            "error_code": "INSUFFICIENT_SPARSE_POINTS",
            "registered_images": registered_images,
            "points_count": points_count,
            "message": f"COLMAP produced only {points_count} 3D sparse points (minimum 50 required)."
        })

    # D. Mean reprojection error gate (reconstruction alignment quality)
    if metrics["mean_reprojection_error"] > 3.0:
        logger.error(f"High reprojection error: {metrics['mean_reprojection_error']}px > 3.0px threshold.")
        return SfMResult({
            "success": False,
            "error_code": "HIGH_REPROJECTION_ERROR",
            "registered_images": registered_images,
            "points_count": points_count,
            "message": f"Reconstruction alignment error is too high ({metrics['mean_reprojection_error']}px). Maximum allowed is 3.0px.",
            **metrics
        })

    # E. Mean track length gate (multiview triangulation quality)
    if points_count > 0 and metrics["mean_track_length"] < 2.0:
        logger.error(f"Low track length: {metrics['mean_track_length']} < 2.0 cameras per point.")
        return SfMResult({
            "success": False,
            "error_code": "SHORT_TRACK_LENGTH",
            "registered_images": registered_images,
            "points_count": points_count,
            "message": f"Average camera track length ({metrics['mean_track_length']}) is insufficient for reliable 3D triangulation.",
            **metrics
        })

    return SfMResult({
        "success": True,
        "registered_images": registered_images,
        "points_count": points_count,
        "sparse_dir": valid_sparse or sparse_dir,
        "registration_ratio": round(reg_ratio, 3),
        "total_images": image_count,
        **metrics
    })
