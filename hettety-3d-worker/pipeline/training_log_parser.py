"""
HETTETY 3D GPU Worker — Graphdeco Training Log Parser & Authoritative Verification
==================================================================================

Extracts authoritative training iteration evidence, loss metrics, and CUDA diagnostics
from official Graphdeco 3DGS stdout and stderr streams.

Requirements:
- Never record requested iterations as achieved iterations without empirical proof.
- Parse tqdm progress bars, [ITER <num>] checkpoints, and final convergence metrics.
- Verify point cloud and checkpoint presence on disk.
- Robust against truncated, malformed, or early-terminated logs.
"""

import os
import re
import logging
from typing import Dict, Any, Optional, List

logger = logging.getLogger("hettety-3d-worker.training_log_parser")

_RE_ITER_BRACKET = re.compile(r"\[ITER\s+(\d+)\]", re.IGNORECASE)
_RE_ITER_RATIO = re.compile(r"(?:Iteration|iter|it)?:\s*(\d+)\s*/\s*(\d+)", re.IGNORECASE)
_RE_ITER_COUNT = re.compile(r"(?:Iteration|iter|it)\s+(\d+)", re.IGNORECASE)
_RE_TQDM_STEP = re.compile(r"(\d+)/(\d+)\s+\[[0-9:<>]+,\s*([0-9.]+)it/s(?:,\s*loss=([0-9.]+))?\]", re.IGNORECASE)
_RE_LOSS = re.compile(r"(?:loss|L1)\s*[=:\s]\s*([0-9.]+)", re.IGNORECASE)
_RE_PSNR = re.compile(r"PSNR\s*[=:\s]\s*([0-9.]+)", re.IGNORECASE)
_RE_CUDA_OOM = re.compile(r"(CUDA\s+out\s+of\s+memory|OutOfMemoryError|RuntimeError:\s*CUDA\s+out\s+of\s+memory)", re.IGNORECASE)
_RE_CUDA_ERR = re.compile(r"(CUDA\s+error|RuntimeError:\s*CUDA)", re.IGNORECASE)


def parse_graphdeco_training_log(
    stdout_text: str,
    stderr_text: str = "",
    requested_iterations: int = 30000,
    model_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Parses training stdout/stderr and inspects model directory to verify actual iterations.
    Fails closed: if logs do not contain verifiable iteration evidence or if iterations < requested,
    iterations_verified is False.
    """
    combined_log = (stdout_text or "") + "\n" + (stderr_text or "")
    lines = combined_log.splitlines()

    max_iteration = 0
    detected_losses: List[float] = []
    detected_psnrs: List[float] = []
    cuda_oom = False
    cuda_errors: List[str] = []

    for line in lines:
        line_clean = line.strip()
        if not line_clean:
            continue

        # Check for CUDA OOM
        if _RE_CUDA_OOM.search(line_clean):
            cuda_oom = True
            cuda_errors.append(line_clean)
        elif _RE_CUDA_ERR.search(line_clean):
            cuda_errors.append(line_clean)

        # Check [ITER <num>]
        for match in _RE_ITER_BRACKET.finditer(line_clean):
            try:
                it = int(match.group(1))
                if it > max_iteration:
                    max_iteration = it
            except ValueError:
                pass

        # Check tqdm ratio: 30000/30000
        for match in _RE_TQDM_STEP.finditer(line_clean):
            try:
                curr_it = int(match.group(1))
                if curr_it > max_iteration:
                    max_iteration = curr_it
                if match.group(4):
                    detected_losses.append(float(match.group(4)))
            except ValueError:
                pass

        # Check Iteration: X/Y
        for match in _RE_ITER_RATIO.finditer(line_clean):
            try:
                curr_it = int(match.group(1))
                if curr_it > max_iteration:
                    max_iteration = curr_it
            except ValueError:
                pass

        # Check Iteration X
        for match in _RE_ITER_COUNT.finditer(line_clean):
            try:
                curr_it = int(match.group(1))
                if curr_it > max_iteration:
                    max_iteration = curr_it
            except ValueError:
                pass

        # Check Loss
        for match in _RE_LOSS.finditer(line_clean):
            try:
                val = float(match.group(1))
                detected_losses.append(val)
            except ValueError:
                pass

        # Check PSNR
        for match in _RE_PSNR.finditer(line_clean):
            try:
                val = float(match.group(1))
                detected_psnrs.append(val)
            except ValueError:
                pass

    # Checkpoint and PLY verification on disk
    checkpoints_found: List[str] = []
    ply_verified = False

    if model_output_dir and os.path.exists(model_output_dir):
        # Look for iteration checkpoint directories
        pc_dir = os.path.join(model_output_dir, "point_cloud")
        if os.path.isdir(pc_dir):
            for entry in os.listdir(pc_dir):
                if entry.startswith("iteration_"):
                    try:
                        it_num = int(entry.replace("iteration_", ""))
                        target_ply = os.path.join(pc_dir, entry, "point_cloud.ply")
                        if os.path.isfile(target_ply) and os.path.getsize(target_ply) > 100:
                            checkpoints_found.append(entry)
                            if it_num > max_iteration:
                                # Disk checkpoint is authoritative evidence of completion
                                max_iteration = it_num
                            if it_num >= requested_iterations:
                                ply_verified = True
                    except ValueError:
                        pass

    final_loss = detected_losses[-1] if detected_losses else None
    final_psnr = detected_psnrs[-1] if detected_psnrs else None
    iterations_verified = (max_iteration >= requested_iterations) and not cuda_oom

    return {
        "completed_iterations": max_iteration,
        "requested_iterations": requested_iterations,
        "iterations_verified": iterations_verified,
        "final_loss": final_loss,
        "final_psnr": final_psnr,
        "cuda_oom_detected": cuda_oom,
        "cuda_errors": cuda_errors,
        "checkpoints_found": checkpoints_found,
        "ply_verified": ply_verified,
    }
