#!/usr/bin/env python3
"""
HETTETY 3D Reconstruction CLI — Standalone Local Runner
Processes a folder of real property photos or an MP4/MOV video walkthrough
directly through the 7-stage 3D reconstruction pipeline into verified SPZ & GLB assets.
Does not require Redis or external control plane webhooks.
"""

import os
import sys
import shutil
import time
import argparse
import logging
from typing import Optional, List

# Ensure hettety-3d-worker root is in path
WORKER_ROOT = os.path.dirname(os.path.abspath(__file__))
if WORKER_ROOT not in sys.path:
    sys.path.insert(0, WORKER_ROOT)

from pipeline.validate import validate_keyframes
from pipeline.colmap import run_sfm, run_dense_stereo
from pipeline.train import run_gaussian_training
from pipeline.optimize import optimize_splat_cloud
from pipeline.compress import convert_ply_to_spz, generate_metric_mesh_glb, scale_ply_to_metric
from pipeline.calibrate import calibrate_sparse_scale, load_survey_benchmarks

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"
)
logger = logging.getLogger("hettety-cli")

def extract_video_frames(video_path: str, output_dir: str, target_fps: float = 2.0, max_frames: int = 300) -> int:
    import cv2
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Failed to open video file: {video_path}")
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(video_fps / target_fps)))
    extracted = 0
    frame_idx = 0
    while cap.isOpened() and extracted < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step == 0:
            out_file = os.path.join(output_dir, f"frame_{extracted:04d}.jpg")
            cv2.imwrite(out_file, frame)
            extracted += 1
        frame_idx += 1
    cap.release()
    return extracted

def main():
    parser = argparse.ArgumentParser(description="Hettety 3D Local Reconstruction CLI")
    parser.add_argument("--input", "-i", required=True, help="Path to video file (.mp4/.mov) or folder of images")
    parser.add_argument("--output", "-o", required=True, help="Directory to save reconstructed .spz and .glb assets")
    parser.add_argument("--property-id", default="local_prop_01", help="Property identifier for metadata")
    parser.add_argument("--job-id", default=f"local_job_{int(time.time())}", help="Job identifier")
    parser.add_argument("--survey", help="Optional path to ground_truth_survey.json for certified metric calibration")
    parser.add_argument("--iterations", type=int, default=30000, help="3DGS training iterations (default: 30000)")
    parser.add_argument("--keep-intermediates", action="store_true", help="Preserve intermediate SfM and raw ply files")

    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_dir = os.path.abspath(args.output)
    os.makedirs(output_dir, exist_ok=True)

    work_dir = os.path.join(output_dir, ".scratch_workspace")
    images_dir = os.path.join(work_dir, "images")
    sfm_dir = os.path.join(work_dir, "sfm")
    model_dir = os.path.join(work_dir, "output")

    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(sfm_dir, exist_ok=True)
    os.makedirs(model_dir, exist_ok=True)

    t_start = time.time()
    logger.info("=" * 70)
    logger.info(f"HETTETY 3D RECONSTRUCTION CLI — STARTING")
    logger.info(f"Input:        {input_path}")
    logger.info(f"Output:       {output_dir}")
    logger.info(f"Property ID:  {args.property_id}")
    logger.info(f"Job ID:       {args.job_id}")
    logger.info("=" * 70)

    # 1. Collect / Extract Keyframes
    is_video = False
    if os.path.isfile(input_path):
        ext = os.path.splitext(input_path)[1].lower()
        if ext in (".mp4", ".mov", ".webm", ".avi", ".mkv"):
            is_video = True
            logger.info(f"[Stage 1/7] Extracting video keyframes from {input_path}...")
            count = extract_video_frames(input_path, images_dir)
            logger.info(f"Extracted {count} keyframes from video.")
        else:
            raise ValueError(f"Single file input must be a video walkthrough. Received: {input_path}")
    elif os.path.isdir(input_path):
        logger.info(f"[Stage 1/7] Ingesting photos from {input_path}...")
        valid_exts = ('.jpg', '.jpeg', '.png')
        files = [f for f in os.listdir(input_path) if f.lower().endswith(valid_exts)]
        for i, f in enumerate(files):
            shutil.copy2(os.path.join(input_path, f), os.path.join(images_dir, f"frame_{i:04d}.jpg"))
        logger.info(f"Copied {len(files)} photos.")
    else:
        raise FileNotFoundError(f"Input path not found: {input_path}")

    # 2. Validate Keyframes
    logger.info("[Stage 2/7] Validating keyframe dataset...")
    val_res = validate_keyframes(images_dir, min_images=12)
    if not val_res.get("valid"):
        logger.error(f"Validation FAILED: {val_res}")
        sys.exit(1)
    logger.info(f"Keyframe dataset approved: {val_res.get('image_count')} images, sharpness={val_res.get('sharpness_score')}")

    # 3. Structure from Motion (COLMAP)
    logger.info("[Stage 3/7] Running Structure-from-Motion (COLMAP)...")
    sfm_res = run_sfm(images_dir, sfm_dir, is_video=is_video)
    if not sfm_res or not sfm_res.get("success"):
        logger.error(f"SfM failed: {sfm_res}")
        sys.exit(2)
    logger.info(f"SfM aligned {sfm_res.get('registered_images')} cameras, {sfm_res.get('points_count')} sparse 3D points.")

    # 3.5 Dense stereo reconstruction
    dense_dir = os.path.join(sfm_dir, "dense")
    logger.info("[Stage 3.5/7] Running Dense Stereo Fusion...")
    run_dense_stereo(sparse_dir=sfm_dir, image_dir=images_dir, dense_dir=dense_dir)

    # 4. 3DGS Training
    logger.info(f"[Stage 4/7] Optimizing 3D Gaussian Splats ({args.iterations} iterations)...")
    train_res = run_gaussian_training(sfm_dir, model_dir, iterations=args.iterations)
    if not train_res.get("success"):
        logger.error(f"3DGS training failed: {train_res}")
        sys.exit(3)
    target_ply = train_res.get("target_ply")
    logger.info(f"Trained raw Gaussian cloud at {target_ply}")

    # 5. Floater Pruning & Spatial Bounds Extraction
    logger.info("[Stage 5/7] Pruning floaters and extracting spatial bounds...")
    clean_ply = os.path.join(model_dir, "point_cloud_clean.ply")
    opt_res = optimize_splat_cloud(target_ply, clean_ply)
    if not opt_res.get("success"):
        logger.error(f"Optimization failed: {opt_res}")
        sys.exit(4)
    bounds = opt_res.get("bounds")
    splat_count = opt_res.get("splat_count")
    logger.info(f"Optimized cloud: {splat_count} splats. Bounds: {bounds}")

    # 6. Metric Calibration
    scale_factor = 1.0
    if args.survey and os.path.exists(args.survey):
        logger.info(f"[Stage 6/7] Applying certified survey calibration from {args.survey}...")
        benchmarks = load_survey_benchmarks(args.survey)
        # Parse sparse points
        sparse_pts = []
        p3d_file = os.path.join(sfm_dir, "sparse", "0", "points3D.txt")
        if not os.path.exists(p3d_file):
            p3d_file = os.path.join(sfm_dir, "sparse", "points3D.txt")
        if os.path.exists(p3d_file):
            with open(p3d_file, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if not line.startswith("#") and line.strip():
                        parts = line.split()
                        if len(parts) >= 4:
                            sparse_pts.append((float(parts[1]), float(parts[2]), float(parts[3])))
            calib_res = calibrate_sparse_scale(sparse_pts, benchmarks, sparse_dir=sfm_dir)
            if calib_res.get("is_calibrated"):
                scale_factor = calib_res.get("scale_factor", 1.0)
                logger.info(f"Certified metric scale calibrated: factor={scale_factor:.6f}, confidence={calib_res.get('confidence_score')}")

    # Scale PLY to true metric meters
    metric_ply = os.path.join(model_dir, "point_cloud_metric.ply")
    scale_ply_to_metric(clean_ply, metric_ply, scale_factor=scale_factor)

    # 7. Format Conversion & Metric Mesh Generation
    logger.info("[Stage 7/7] Generating dual representations (.spz splat + .glb metric mesh)...")
    out_spz = os.path.join(output_dir, f"{args.property_id}_tour.spz")
    out_glb = os.path.join(output_dir, f"{args.property_id}_mesh.glb")

    convert_ply_to_spz(metric_ply, out_spz)
    generate_metric_mesh_glb(sfm_dir, out_glb, scale_factor=scale_factor)

    elapsed = round(time.time() - t_start, 2)
    spz_size_mb = os.path.getsize(out_spz) / (1024 * 1024)
    glb_size_mb = os.path.getsize(out_glb) / (1024 * 1024) if os.path.exists(out_glb) else 0

    if not args.keep_intermediates:
        shutil.rmtree(work_dir, ignore_errors=True)

    logger.info("=" * 70)
    logger.info("RECONSTRUCTION COMPLETED SUCCESSFULLY!")
    logger.info(f"Total time:       {elapsed}s")
    logger.info(f"Gaussian Splat:   {out_spz} ({spz_size_mb:.2f} MB, {splat_count:,} splats)")
    logger.info(f"Metric 3D Mesh:   {out_glb} ({glb_size_mb:.2f} MB)")
    logger.info(f"Spatial Bounds:   min={bounds['min']} max={bounds['max']}")
    logger.info("=" * 70)

if __name__ == "__main__":
    main()
