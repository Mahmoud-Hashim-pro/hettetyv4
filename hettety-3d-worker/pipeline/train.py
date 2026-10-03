"""
HETTETY 3D GPU Worker — Stage 4: Gaussian Splatting Optimization
Trains 3D Gaussian Splatting representation from COLMAP sparse output.
Strictly requires genuine training and rejects 0-vertex proxy fallbacks.
"""

import os
import subprocess
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("hettety-3d-worker.train")

def run_gaussian_training(
    source_dir: str,
    output_model_dir: str,
    iterations: int = 30000,
    sh_degree: int = 3,
    eval_step: int = 7000
) -> Dict[str, Any]:
    """
    Executes the 3D Gaussian Splatting optimization loop.
    Source dir contains the COLMAP sparse reconstruction and input images.
    Output dir will contain the trained point cloud (iteration_30000/point_cloud.ply).
    Fails explicitly if submodule is absent or outputs 0 vertices.
    """
    os.makedirs(output_model_dir, exist_ok=True)
    logger.info(f"Starting 3DGS training: source={source_dir}, iters={iterations}")

    import sys
    base_env_path = os.environ.get("GAUSSIAN_SPLATTING_PATH", "/opt/gaussian-splatting")
    candidates = [
        os.path.join(base_env_path, "train.py"),
        "/opt/gaussian-splatting/train.py",
        "submodules/gaussian-splatting/train.py",
        os.path.join(os.path.dirname(__file__), "..", "submodules", "gaussian-splatting", "train.py"),
        os.path.join(os.path.dirname(__file__), "..", "..", "submodules", "gaussian-splatting", "train.py"),
    ]

    script_path = None
    for cand in candidates:
        if os.path.exists(cand):
            script_path = os.path.abspath(cand)
            break

    if not script_path:
        logger.error(f"Gaussian Splatting training script not present in candidate paths: {candidates}.")
        return {
            "success": False,
            "error_code": "GAUSSIAN_TRAINING_FAILED",
            "message": f"3DGS training script missing (checked {base_env_path} and submodules). Simulation/proxy 0-vertex output prohibited in production."
        }

    cmd = [
        sys.executable, script_path,
        "-s", source_dir,
        "-m", output_model_dir,
        "--iterations", str(iterations),
        "--sh_degree", str(sh_degree),
        "--save_iterations", str(eval_step), str(iterations)
    ]

    try:
        process = subprocess.run(
            cmd,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        logger.info("3DGS training completed successfully.")
        
        target_ply = os.path.join(
            output_model_dir,
            "point_cloud",
            f"iteration_{iterations}",
            "point_cloud.ply"
        )

        if not os.path.exists(target_ply) or os.path.getsize(target_ply) < 100:
            logger.error(f"3DGS training yielded empty or zero-point PLY at {target_ply}.")
            return {
                "success": False,
                "error_code": "ZERO_GAUSSIANS_PRODUCED",
                "message": "Reconstruction produced zero Gaussian primitives."
            }
        
        return {
            "success": True,
            "target_ply": target_ply,
            "iterations": iterations,
            "message": "Optimization converged successfully"
        }
    except FileNotFoundError as e:
        logger.error(f"Gaussian Splatting runner binary not found: {e}")
        return {
            "success": False,
            "error_code": "GAUSSIAN_BINARY_NOT_FOUND",
            "message": str(e)
        }
    except subprocess.CalledProcessError as e:
        logger.error(f"3DGS training failed with non-zero exit code: {e.stderr}")
        return {
            "success": False,
            "error_code": "TRAINING_FAILED",
            "message": e.stderr
        }
