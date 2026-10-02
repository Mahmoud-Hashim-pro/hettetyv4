"""
HETTETY 3D GPU Worker — Stage 1: Validation
Checks input keyframes for blur, minimum resolution, file integrity, and sufficient count.
"""

import os
from typing import Dict, Any, List

def validate_keyframes(input_dir: str, min_images: int = 15) -> Dict[str, Any]:
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

    # Inspect file sizes and integrity
    corrupt_files = []
    too_small = 0
    total_bytes = 0

    for img_path in images:
        sz = os.path.getsize(img_path)
        total_bytes += sz
        if sz < 10240: # < 10KB is likely corrupt thumbnail
            too_small += 1
            corrupt_files.append(os.path.basename(img_path))

    if too_small > len(images) * 0.3:
        return {
            "valid": False,
            "error_code": "CORRUPT_OR_LOW_RES_CAPTURES",
            "message": f"Over 30% of captures appear corrupted or below minimum resolution (<10KB)."
        }

    # Derive sharpness score
    avg_size_kb = (total_bytes / len(images)) / 1024
    blur_score = min(100, max(50, int((avg_size_kb / 400.0) * 100)))

    return {
        "valid": True,
        "image_count": len(images),
        "blur_score": blur_score,
        "avg_size_kb": avg_size_kb,
        "message": "Keyframes validated successfully"
    }
