"""
HETTETY 3D GPU Worker — Stage 2: Structure-from-Motion (SfM)
Runs feature detection, matching, and sparse bundle adjustment via COLMAP.
Optimizes matching strategy: sequential for video captures, exhaustive for <=50 photos, vocab-tree for large sets.
"""

import subprocess
import os
import shutil
import logging
from typing import Optional, Tuple, Dict, Any, List, Callable

from pipeline.process_manager import run_managed_process

logger = logging.getLogger("hettety-3d-worker.colmap")

class SfMResult(dict):
    """Result object supporting dictionary access and boolean truthiness."""
    def __bool__(self):
        return bool(self.get("success", False))

def is_gpu_acceleration_available() -> bool:
    """
    Checks if NVIDIA GPU acceleration is available on the host/container.
    Respects explicit environment overrides COLMAP_FORCE_CPU and COLMAP_FORCE_GPU.
    """
    if os.environ.get("COLMAP_FORCE_CPU", "").lower() in ("1", "true"):
        return False
    if os.environ.get("COLMAP_FORCE_GPU", "").lower() in ("1", "true"):
        return True
    try:
        import torch
        if torch.cuda.is_available():
            return True
    except Exception:
        pass
    if shutil.which("nvidia-smi"):
        try:
            res = subprocess.run(["nvidia-smi"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            if res.returncode == 0:
                return True
        except Exception:
            pass
    return False

def exec_colmap(
    cmd: List[str],
    check: bool = True,
    cancel_check: Optional[Callable[[], bool]] = None,
    timeout: Optional[float] = None
) -> subprocess.CompletedProcess:
    """
    Executes a COLMAP command via managed process tracking.
    If 'colmap' is on PATH, runs it directly.
    Otherwise, if docker is available, runs via container 'hettety-colmap:latest'
    with automatic directory volume mounting, GPU passthrough if available, and path translation.
    Terminates immediately if cancel_check() returns True.
    """
    gpu_available = is_gpu_acceleration_available()

    if shutil.which("colmap"):
        # Direct COLMAP execution on host
        return run_managed_process(cmd, check=check, cancel_check=cancel_check, timeout=timeout)

    if shutil.which("docker"):
        subcommand = cmd[1] if len(cmd) > 1 else ""
        raw_args = cmd[2:] if len(cmd) > 2 else []

        path_flags = {
            "--database_path", "--image_path", "--output_path", "--input_path",
            "--workspace_path"
        }

        mount_map = {}  # host_abs_dir -> container_dir
        idx = 0
        while idx < len(raw_args):
            arg = raw_args[idx]
            if arg in path_flags and idx + 1 < len(raw_args):
                host_target = os.path.abspath(raw_args[idx + 1])
                host_dir = host_target if os.path.isdir(host_target) or not os.path.splitext(host_target)[1] else os.path.dirname(host_target)
                os.makedirs(host_dir, exist_ok=True)

                matched = False
                for h_dir in mount_map:
                    try:
                        if os.path.commonpath([h_dir, host_dir]) == h_dir:
                            matched = True
                            break
                    except ValueError:
                        pass
                if not matched:
                    c_dir = f"/mnt/vol_{len(mount_map)}"
                    mount_map[host_dir] = c_dir
                idx += 2
            else:
                idx += 1

        new_args = []
        idx = 0
        while idx < len(raw_args):
            arg = raw_args[idx]
            if arg in path_flags and idx + 1 < len(raw_args):
                new_args.append(arg)
                host_target = os.path.abspath(raw_args[idx + 1])
                translated = False
                for h_dir, c_dir in mount_map.items():
                    try:
                        if os.path.commonpath([h_dir, host_target]) == h_dir:
                            rel = os.path.relpath(host_target, h_dir).replace("\\", "/")
                            c_target = f"{c_dir}/{rel}" if rel != "." else c_dir
                            new_args.append(c_target)
                            translated = True
                            break
                    except ValueError:
                        pass
                if not translated:
                    new_args.append(raw_args[idx + 1])
                idx += 2
            else:
                # GPU passthrough handling: keep use_gpu 1 if GPU is available, else downgrade to 0
                if "use_gpu" in arg and idx + 1 < len(raw_args):
                    new_args.append(arg)
                    if gpu_available:
                        new_args.append(raw_args[idx + 1])
                    else:
                        new_args.append("0")
                    idx += 2
                else:
                    new_args.append(arg)
                    idx += 1

        docker_cmd = ["docker", "run", "--rm"]
        if gpu_available:
            docker_cmd.extend(["--gpus", "all"])
        for h_dir, c_dir in mount_map.items():
            h_dir_posix = h_dir.replace("\\", "/")
            docker_cmd.extend(["-v", f"{h_dir_posix}:{c_dir}"])
        docker_cmd.append("hettety-colmap:latest")
        if subcommand:
            docker_cmd.append(subcommand)
        docker_cmd.extend(new_args)

        return run_managed_process(docker_cmd, check=check, cancel_check=cancel_check, timeout=timeout)

    return run_managed_process(cmd, check=check, cancel_check=cancel_check, timeout=timeout)

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
            exec_colmap(cmd_convert, check=False)
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

def run_sfm(
    image_dir: str,
    output_dir: str,
    is_video: bool = False,
    cancel_check: Optional[Callable[[], bool]] = None
) -> SfMResult:
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
    exec_colmap(cmd_extract, check=True, cancel_check=cancel_check)

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
    exec_colmap(cmd_match, check=True, cancel_check=cancel_check)

    # 3. Mapper / Sparse Reconstruction
    cmd_mapper = [
        "colmap", "mapper",
        "--database_path", db_path,
        "--image_path", image_dir,
        "--output_path", sparse_dir,
        "--Mapper.min_num_matches", "15"
    ]
    exec_colmap(cmd_mapper, check=True, cancel_check=cancel_check)

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

def run_dense_stereo(
    sparse_dir: str,
    image_dir: str,
    dense_dir: str,
    max_image_size: int = 2000,
    cancel_check: Optional[Callable[[], bool]] = None
) -> Dict[str, Any]:
    """
    Executes genuine multi-view dense stereo reconstruction:
    1. colmap image_undistorter
    2. colmap patch_match_stereo
    3. colmap stereo_fusion -> produces fused.ply point cloud
    """
    logger.info(f"Running COLMAP dense stereo reconstruction in: {dense_dir}")
    os.makedirs(dense_dir, exist_ok=True)
    fused_ply = os.path.join(dense_dir, "fused.ply")

    # Verify sparse model exists across candidate directory layouts
    candidates = [
        os.path.join(sparse_dir, "sparse", "0"),
        os.path.join(sparse_dir, "0"),
        os.path.join(sparse_dir, "sparse"),
        sparse_dir
    ]
    candidate_sparse = sparse_dir
    for c in candidates:
        if os.path.exists(c) and any(os.path.exists(os.path.join(c, f)) for f in ["images.bin", "images.txt", "cameras.bin", "cameras.txt"]):
            candidate_sparse = c
            break

    try:
        # 1. Image Undistortion
        logger.info("Stage 1/3: Undistorting camera frames for dense stereo...")
        cmd_undistort = [
            "colmap", "image_undistorter",
            "--image_path", image_dir,
            "--input_path", candidate_sparse,
            "--output_path", dense_dir,
            "--output_type", "COLMAP",
            "--max_image_size", str(max_image_size)
        ]
        exec_colmap(cmd_undistort, check=True, cancel_check=cancel_check)

        # 2. Patch Match Stereo (Photometric + Geometric depth consistency)
        logger.info("Stage 2/3: Computing dense photometric depth maps (PatchMatchStereo)...")
        cmd_stereo = [
            "colmap", "patch_match_stereo",
            "--workspace_path", dense_dir,
            "--workspace_format", "COLMAP",
            "--PatchMatchStereo.geom_consistency", "true"
        ]
        exec_colmap(cmd_stereo, check=True, cancel_check=cancel_check)

        # 3. Stereo Fusion (Fusing multiview depth maps into dense 3D point cloud)
        logger.info("Stage 3/3: Fusing depth maps into dense 3D point cloud (StereoFusion)...")
        cmd_fuse = [
            "colmap", "stereo_fusion",
            "--workspace_path", dense_dir,
            "--workspace_format", "COLMAP",
            "--input_type", "geometric",
            "--output_path", fused_ply
        ]
        exec_colmap(cmd_fuse, check=True, cancel_check=cancel_check)

        if not os.path.exists(fused_ply) or os.path.getsize(fused_ply) < 100:
            return {
                "success": False,
                "error_code": "DENSE_FUSION_EMPTY",
                "message": "COLMAP stereo fusion produced an empty or missing fused.ply point cloud."
            }

        logger.info(f"Dense stereo reconstruction completed successfully: {fused_ply} ({os.path.getsize(fused_ply)} bytes)")
        return {
            "success": True,
            "fused_ply": fused_ply,
            "dense_dir": dense_dir,
            "size_bytes": os.path.getsize(fused_ply)
        }

    except subprocess.CalledProcessError as e:
        err_msg = e.stderr.decode("utf-8", errors="ignore") if isinstance(e.stderr, bytes) else str(e)
        logger.error(f"COLMAP dense stereo subprocess error: {err_msg}")
        return {
            "success": False,
            "error_code": "DENSE_STEREO_FAILED",
            "message": f"COLMAP dense stereo failed: {err_msg}"
        }
    except FileNotFoundError:
        logger.warning("COLMAP executable not found on PATH for dense stereo.")
        return {
            "success": False,
            "error_code": "COLMAP_NOT_FOUND",
            "message": "COLMAP is not installed in worker environment."
        }
    except Exception as ex:
        logger.exception(f"Unexpected error in dense stereo reconstruction: {ex}")
        return {
            "success": False,
            "error_code": "DENSE_STEREO_ERROR",
            "message": str(ex)
        }

