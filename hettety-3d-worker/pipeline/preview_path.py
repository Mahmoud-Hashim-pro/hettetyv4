"""
HETTETY 3D Worker — Cinematic Preview Camera Trajectory Engine
Inspired by Microsoft TRELLIS.2 (render_utils.py, yaw_pitch_r_fov_to_extrinsics, and orbit generation).

Generates smooth, professional 360-degree orbit and dollhouse walkthrough camera paths
grounded in the reconstructed property's real spatial bounding box.
"""

import math
import json
import logging
from typing import Dict, Any, List, Tuple, Optional

logger = logging.getLogger("hettety-3d-worker.preview_path")


def generate_orbit_camera_trajectory(
    bounds: Dict[str, List[float]],
    num_frames: int = 60,
    fov: float = 45.0,
    pitch_deg: float = 20.0
) -> Dict[str, Any]:
    """
    Generates a 360-degree orbit camera trajectory centered around the property's bounds.
    
    Args:
        bounds: {"min": [x1, y1, z1], "max": [x2, y2, z2]}
        num_frames: Number of animation frames.
        fov: Vertical field of view in degrees.
        pitch_deg: Elevation angle above the ground plane.

    Returns:
        Dictionary with metadata and keyframes array.
    """
    b_min = bounds.get("min", [0.0, 0.0, 0.0])
    b_max = bounds.get("max", [0.0, 0.0, 0.0])

    cx = (b_min[0] + b_max[0]) / 2.0
    cy = (b_min[1] + b_max[1]) / 2.0
    cz = (b_min[2] + b_max[2]) / 2.0
    target = [round(cx, 4), round(cy, 4), round(cz, 4)]

    dx = b_max[0] - b_min[0]
    dy = b_max[1] - b_min[1]
    dz = b_max[2] - b_min[2]
    extent = math.sqrt(dx * dx + dy * dy + dz * dz)
    # Ensure sufficient standoff distance to frame the entire property
    radius = max(extent * 0.85, 3.0)

    keyframes: List[Dict[str, Any]] = []

    for i in range(num_frames):
        # Progress 0.0 to 1.0
        t = i / max(1, num_frames)
        # Yaw angle [0, 2*PI]
        yaw = 2.0 * math.pi * t
        # Subtle harmonic pitch undulation (e.g. +/- 4 degrees around pitch_deg)
        pitch_rad = math.radians(pitch_deg + 4.0 * math.sin(yaw))

        # Position relative to target
        cam_x = cx + radius * math.sin(yaw) * math.cos(pitch_rad)
        cam_y = cy + radius * math.cos(yaw) * math.cos(pitch_rad)
        cam_z = cz + radius * math.sin(pitch_rad)

        keyframes.append({
            "frame": i,
            "timeSec": round(i / 30.0, 3), # 30 fps nominal
            "position": [round(cam_x, 4), round(cam_y, 4), round(cam_z, 4)],
            "target": target,
            "yawDeg": round(math.degrees(yaw), 2),
            "pitchDeg": round(math.degrees(pitch_rad), 2),
            "fov": fov
        })

    return {
        "version": "1.0",
        "trajectoryType": "orbit_360",
        "frameCount": len(keyframes),
        "target": target,
        "radius": round(radius, 4),
        "bounds": bounds,
        "keyframes": keyframes
    }


def generate_walkthrough_transition_trajectory(
    bounds: Dict[str, List[float]],
    num_frames: int = 60
) -> Dict[str, Any]:
    """
    Generates a smooth transition trajectory from a high dollhouse angle down into a walk-in perspective.
    """
    b_min = bounds.get("min", [0.0, 0.0, 0.0])
    b_max = bounds.get("max", [0.0, 0.0, 0.0])

    cx = (b_min[0] + b_max[0]) / 2.0
    cy = (b_min[1] + b_max[1]) / 2.0
    cz = (b_min[2] + b_max[2]) / 2.0

    dx = b_max[0] - b_min[0]
    dy = b_max[1] - b_min[1]
    dz = b_max[2] - b_min[2]
    extent = math.sqrt(dx * dx + dy * dy + dz * dz)

    start_radius = max(extent * 1.2, 5.0)
    end_radius = max(extent * 0.35, 1.5)

    keyframes: List[Dict[str, Any]] = []

    for i in range(num_frames):
        t = i / max(1, num_frames)
        # Smooth cosine interpolation
        smooth_t = (1.0 - math.cos(t * math.pi)) / 2.0

        r = start_radius * (1.0 - smooth_t) + end_radius * smooth_t
        pitch_deg = 45.0 * (1.0 - smooth_t) + 5.0 * smooth_t
        pitch_rad = math.radians(pitch_deg)
        yaw = math.radians(30.0 * (1.0 - smooth_t))

        cam_x = cx + r * math.sin(yaw) * math.cos(pitch_rad)
        cam_y = cy - r * math.cos(yaw) * math.cos(pitch_rad)
        cam_z = cz + r * math.sin(pitch_rad)

        keyframes.append({
            "frame": i,
            "timeSec": round(i / 30.0, 3),
            "position": [round(cam_x, 4), round(cam_y, 4), round(cam_z, 4)],
            "target": [round(cx, 4), round(cy, 4), round(cz, 4)],
            "fov": 50.0
        })

    return {
        "version": "1.0",
        "trajectoryType": "dollhouse_to_walkthrough",
        "frameCount": len(keyframes),
        "target": [round(cx, 4), round(cy, 4), round(cz, 4)],
        "keyframes": keyframes
    }


def save_camera_trajectory(trajectory: Dict[str, Any], output_path: str) -> str:
    """Serializes trajectory data to JSON file."""
    import os
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(trajectory, f, indent=2)
    return output_path
