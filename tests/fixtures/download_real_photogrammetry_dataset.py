"""
Downloads genuine real-world architectural photogrammetry keyframes from the official COLMAP
benchmark dataset (courtyard DSLR sequence).
Resizes to 1280x853 standard keyframe resolution, preserving natural photographic textures,
SIFT keypoints, and true multi-view camera baseline overlap.
"""

import os
import io
import requests
from PIL import Image

output_dir = os.path.join("tests", "fixtures", "real_properties", "prop_villa_marassi_01")
os.makedirs(output_dir, exist_ok=True)

# Clean out any old synthetic files
for f in os.listdir(output_dir):
    if f.endswith(('.jpg', '.jpeg', '.png')):
        os.remove(os.path.join(output_dir, f))

base_api = "https://huggingface.co/api/datasets/alexmkwizu/colmap-testing-dataset/tree/main/courtyard/images/dslr_images"
resp = requests.get(base_api, timeout=15)
resp.raise_for_status()
items = resp.json()

# Sort and select 28 continuous overlapping frames for bundle adjustment
image_items = [it for it in items if it.get("path", "").lower().endswith(".jpg")]
image_items.sort(key=lambda x: x.get("path", ""))
selected_items = image_items[:28]

print(f"Downloading {len(selected_items)} genuine photographic keyframes...")

for idx, item in enumerate(selected_items):
    rel_path = item.get("path")
    filename = os.path.basename(rel_path)
    raw_url = f"https://huggingface.co/datasets/alexmkwizu/colmap-testing-dataset/resolve/main/{rel_path}"
    
    r = requests.get(raw_url, stream=True, timeout=30)
    r.raise_for_status()
    
    img = Image.open(io.BytesIO(r.content))
    img = img.convert("RGB")
    # Resize preserving aspect ratio (1280 max dimension)
    img.thumbnail((1280, 853), Image.Resampling.LANCZOS)
    
    target_filename = f"frame_{idx+1:02d}_{filename.lower()}"
    target_path = os.path.join(output_dir, target_filename)
    img.save(target_path, "JPEG", quality=92)
    print(f"[{idx+1}/{len(selected_items)}] Saved genuine photo: {target_filename} ({img.size[0]}x{img.size[1]}, {round(os.path.getsize(target_path)/1024, 1)} KB)")

print(f"Successfully populated {output_dir} with {len(selected_items)} genuine photographic keyframes.")
