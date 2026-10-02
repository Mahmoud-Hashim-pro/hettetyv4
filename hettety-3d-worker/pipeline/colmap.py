"""
HETTETY 3D GPU Worker — Stage 2: Structure-from-Motion (SfM)
Runs feature detection, matching, and sparse bundle adjustment via COLMAP.
"""

import subprocess
import os

def run_sfm(image_dir: str, output_dir: str) -> bool:
    db_path = os.path.join(output_dir, "database.db")
    sparse_dir = os.path.join(output_dir, "sparse")
    os.makedirs(sparse_dir, exist_ok=True)

    # 1. Feature extraction
    cmd_extract = [
        "colmap", "feature_extractor",
        "--database_path", db_path,
        "--image_path", image_dir,
        "--ImageReader.camera_model", "OPENCV",
        "--SiftExtraction.use_gpu", "1"
    ]
    subprocess.run(cmd_extract, check=True)

    # 2. Sequential / Exhaustive matching
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
        "--output_path", sparse_dir
    ]
    subprocess.run(cmd_mapper, check=True)
    return True
