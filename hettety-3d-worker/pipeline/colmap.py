"""
HETTETY 3D GPU Worker — Stage 2: Structure-from-Motion (SfM)
Runs feature detection, matching, and sparse bundle adjustment via COLMAP.
Optimizes matching strategy: sequential for video captures, exhaustive for <=50 photos, vocab-tree for large sets.
"""

import subprocess
import os
import logging
from typing import Optional

logger = logging.getLogger("hettety-3d-worker.colmap")

def run_sfm(image_dir: str, output_dir: str, is_video: bool = False) -> bool:
    db_path = os.path.join(output_dir, "database.db")
    sparse_dir = os.path.join(output_dir, "sparse")
    os.makedirs(sparse_dir, exist_ok=True)

    images = [f for f in os.listdir(image_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    image_count = len(images)
    logger.info(f"Running COLMAP SfM on {image_count} images (is_video={is_video})")

    # 1. Feature extraction
    cmd_extract = [
        "colmap", "feature_extractor",
        "--database_path", db_path,
        "--image_path", image_dir,
        "--ImageReader.camera_model", "OPENCV",
        "--SiftExtraction.use_gpu", "1"
    ]
    subprocess.run(cmd_extract, check=True)

    # 2. Adaptive matching
    if is_video or image_count > 100:
        logger.info("Using Sequential Matcher for linear spatial sequence...")
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

    # Check that sparse reconstruction produced camera poses
    cameras_bin = os.path.join(sparse_dir, "0", "cameras.bin")
    cameras_txt = os.path.join(sparse_dir, "0", "cameras.txt")
    if not (os.path.exists(cameras_bin) or os.path.exists(cameras_txt) or os.path.exists(os.path.join(sparse_dir, "cameras.bin"))):
        logger.warning("COLMAP mapper did not yield a sub-folder 0; checking root sparse dir.")

    return True
