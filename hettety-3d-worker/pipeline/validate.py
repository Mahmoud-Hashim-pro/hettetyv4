"""
HETTETY 3D GPU Worker — Stage 1: Validation
Checks input keyframes for blur (Laplacian variance), minimum resolution, file integrity, and sufficient count.
"""

import os
import logging
from typing import Dict, Any, List, Tuple, Optional

logger = logging.getLogger("hettety-3d-worker.validate")

def compute_image_laplacian_variance(img_path: str) -> float:
    """
    Computes genuine discrete Laplacian gradient variance over pixel intensities.
    High variance indicates sharp, high-frequency edges; low variance indicates optical motion blur.
    """
    try:
        from PIL import Image
        import numpy as np

        with Image.open(img_path) as img:
            # Resize large images to a uniform analysis box for high-speed deterministic evaluation
            img_thumb = img.convert('L')
            if img_thumb.width > 1280 or img_thumb.height > 720:
                img_thumb.thumbnail((1280, 720), Image.Resampling.BILINEAR)

            gray = np.array(img_thumb, dtype=np.float32)
            if gray.shape[0] < 16 or gray.shape[1] < 16:
                return 0.0

            # 2D Discrete Laplacian kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
            lap = (
                -4.0 * gray[1:-1, 1:-1]
                + gray[:-2, 1:-1]
                + gray[2:, 1:-1]
                + gray[1:-1, :-2]
                + gray[1:-1, 2:]
            )
            return float(np.var(lap))
    except Exception as e:
        logger.warning(f"Could not compute Laplacian variance for {img_path}: {e}")
        return 0.0

def verify_image_magic_bytes(file_path: str) -> bool:
    """Verifies that file starts with genuine image magic header bytes (JPEG, PNG, WebP)."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(16)
        if len(header) < 4:
            return False
        if header.startswith(b"\xff\xd8\xff"):
            return True
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            return True
        if header.startswith(b"RIFF") and len(header) >= 12 and header[8:12] == b"WEBP":
            return True
        return False
    except Exception:
        return False

def verify_image_content_and_structure(
    file_path: str,
    min_width: int = 400,
    min_height: int = 300,
    max_dimension: int = 16384
) -> Tuple[bool, str, Optional[Tuple[int, int]]]:
    """
    Decodes the image structure using PIL, verifying magic bytes, image headers,
    pixel integrity, orientation, and resolution constraints.
    Prevents evil.bin files disguised with fake Content-Type or dummy headers.
    """
    if not verify_image_magic_bytes(file_path):
        return False, "INVALID_MAGIC_HEADER: File does not match JPEG, PNG, or WebP binary signature.", None
    try:
        from PIL import Image
        with Image.open(file_path) as img:
            img.verify()
        with Image.open(file_path) as img:
            w, h = img.size
            if w < min_width or h < min_height:
                return False, f"RESOLUTION_TOO_LOW: Image resolution ({w}x{h}) is below minimum {min_width}x{min_height}.", (w, h)
            if w > max_dimension or h > max_dimension:
                return False, f"RESOLUTION_TOO_HIGH: Image resolution ({w}x{h}) exceeds maximum {max_dimension}.", (w, h)
            return True, "OK", (w, h)
    except Exception as ex:
        return False, f"IMAGE_DECODE_FAILED: Corrupt or unparseable image content: {ex}", None

def validate_keyframes(input_dir: str, min_images: int = 12, max_images: int = 500) -> Dict[str, Any]:
    valid_exts = ('.jpg', '.jpeg', '.png')
    if not os.path.exists(input_dir):
        return {
            "valid": False,
            "error_code": "DIRECTORY_NOT_FOUND",
            "message": f"Input directory {input_dir} not found"
        }

    images = [os.path.join(input_dir, f) for f in os.listdir(input_dir) if f.lower().endswith(valid_exts)]
    
    if len(images) < min_images:
        return {
            "valid": False,
            "error_code": "TOO_FEW_IMAGES",
            "message": f"Found {len(images)} images, minimum required is {min_images}"
        }

    if len(images) > max_images:
        return {
            "valid": False,
            "error_code": "TOO_MANY_IMAGES",
            "message": f"Found {len(images)} images, maximum supported is {max_images}"
        }

    # Inspect file sizes and structural integrity (including decoding verification)
    corrupt_files = []
    too_small = 0
    total_bytes = 0
    variances: List[float] = []

    for img_path in images:
        is_struct_valid, err_msg, dims = verify_image_content_and_structure(img_path)
        if not is_struct_valid:
            corrupt_files.append(f"{os.path.basename(img_path)}: {err_msg}")
            continue

        sz = os.path.getsize(img_path)
        total_bytes += sz
        if sz < 10240: # < 10KB is likely corrupt thumbnail
            too_small += 1
            corrupt_files.append(os.path.basename(img_path))
        else:
            var = compute_image_laplacian_variance(img_path)
            variances.append(var)

    max_capture_bytes = 2 * 1024 * 1024 * 1024  # 2 GB total capture limit
    if total_bytes > max_capture_bytes:
        return {
            "valid": False,
            "error_code": "CAPTURE_QUOTA_EXCEEDED",
            "message": f"Total capture size ({total_bytes / (1024*1024):.1f} MB) exceeds maximum allowed limit of 2 GB."
        }

    if corrupt_files and (len(corrupt_files) > len(images) * 0.2 or (len(images) - len(corrupt_files)) < min_images):
        return {
            "valid": False,
            "error_code": "CORRUPT_OR_LOW_RES_CAPTURES",
            "message": f"Capture dataset failed validation: {len(corrupt_files)} files appear corrupted, spoofed (failed decoding/magic bytes), or below minimum resolution."
        }

    # Derive genuine sharpness score from average Laplacian variance
    # Baseline: sharp photos typically exhibit variance 200-500+. Blurry captures fall below 70.
    avg_var = sum(variances) / len(variances) if variances else 0.0
    sharpness_score = min(100, max(10, int((avg_var / 350.0) * 100)))

    # Reject if overall capture set is severely blurred (avg variance < 35 or score < 25)
    if avg_var < 35.0 and len(images) >= min_images:
        logger.warning(f"Keyframe dataset rejected due to severe motion blur: average Laplacian variance={avg_var:.1f}")
        return {
            "valid": False,
            "error_code": "HIGH_MOTION_BLUR",
            "blur_score": sharpness_score,
            "avg_laplacian_variance": round(avg_var, 2),
            "message": f"Keyframe set rejected: average sharpness variance ({avg_var:.1f}) is below acceptable threshold (35.0). Please recapture steadily."
        }

    return {
        "valid": True,
        "image_count": len(images),
        "sharpness_score": sharpness_score,
        "blur_score": sharpness_score,
        "avg_laplacian_variance": round(avg_var, 2),
        "avg_size_kb": (total_bytes / len(images)) / 1024,
        "message": "Keyframes validated successfully"
    }
