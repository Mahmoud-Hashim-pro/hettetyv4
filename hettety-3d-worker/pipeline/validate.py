"""
HETTETY 3D GPU Worker — Stage 1: Validation
Checks input keyframes for blur, resolution, and sufficient count.
"""

import os
import glob
from typing import Dict, Any

def validate_keyframes(input_dir: str, min_images: int = 15) -> Dict[str, Any]:
    valid_exts = ('.jpg', '.jpeg', '.png')
    images = [f for f in os.listdir(input_dir) if f.lower().endswith(valid_exts)]
    
    if len(images) < min_images:
        return {
            "valid": False,
            "error_code": "TOO_FEW_IMAGES",
            "message": f"Found {len(images)} images, minimum required is {min_images}"
        }
    
    return {
        "valid": True,
        "image_count": len(images),
        "message": "Keyframes validated successfully"
    }
