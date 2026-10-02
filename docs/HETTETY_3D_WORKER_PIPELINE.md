# HETTETY 3D — GPU Reconstruction Worker Pipeline Architecture

## 1. Overview & Separation of Concerns

As established in the architectural blueprint, the **GPU Reconstruction Worker** is completely decoupled from the React/Vercel frontend control plane.
- **Frontend & Control Plane (`hettety`)**: Runs on Vercel/Next.js. Handles user authentication, signed upload sessions, pre-flight telemetry validation, job creation, and web spatial playback.
- **GPU Reconstruction Worker (`hettety-3d-worker`)**: Runs on dedicated Linux GPU instances with NVIDIA CUDA (RunPod, Modal, AWS G5/L4, or dedicated bare-metal).

```
┌──────────────────┐       Signed URLs       ┌────────────────────────┐
│  Hettety Web     ├────────────────────────►│  Google Cloud Storage   │
│  (Next.js/React) │                         │  / S3 Bucket (Raw)     │
└────────┬─────────┘                         └───────────┬────────────┘
         │                                               │
         │ POST /api/3d/jobs                             │ Download Raw
         ▼                                               ▼
┌──────────────────┐      Job Enqueued       ┌────────────────────────┐
│  Redis / BullMQ  ├────────────────────────►│  GPU Worker Service    │
│  Job Queue       │                         │  (CUDA + COLMAP + 3DGS)│
└──────────────────┘                         └───────────┬────────────┘
                                                         │
                                                         │ Upload SPZ / GLB
                                                         ▼
                                             ┌────────────────────────┐
                                             │  Public / Signed CDN   │
                                             │  (SPZ 8-12MB, GLB)     │
                                             └────────────────────────┘
```

---

## 2. Directory Structure of `hettety-3d-worker`

```text
hettety-3d-worker/
├── Dockerfile
├── requirements.txt
├── config.yaml
├── task_queue/
│   ├── __init__.py
│   └── consumer.py             # Pulls jobs from Redis queue / RabbitMQ
├── storage/
│   ├── __init__.py
│   └── object_storage.py       # Resumable GCS / S3 client
├── pipeline/
│   ├── __init__.py
│   ├── validate.py             # Keyframe blur, EXIF, and overlap checking
│   ├── colmap.py               # Structure-from-Motion (SfM) via SuperPoint/COLMAP
│   ├── train.py                # 3D Gaussian Splatting optimization (30k iterations)
│   ├── optimize.py             # Spherical harmonics pruning & floater removal
│   ├── compress.py             # Conversion from raw 200MB PLY to 8-12MB SPZ / GLB
│   └── publish.py              # Uploads processed assets and updates Hettety DB
└── workers/
    ├── __init__.py
    └── reconstruction_worker.py # Master worker loop coordinating the stages
```

---

## 3. Pipeline Stages & Error Codes

Each job progresses through explicit, observable states:

| Stage | Progress | Operation | Error Codes |
| :--- | :---: | :--- | :--- |
| `VALIDATING` | 10% | Blur check, resolution, frame count | `TOO_FEW_IMAGES`, `LOW_IMAGE_QUALITY` |
| `UPLOADING` | 25% | Downloading raw files from object store | `STORAGE_ERROR` |
| `RECONSTRUCTING` | 50% | COLMAP feature matching & camera poses | `INSUFFICIENT_OVERLAP`, `RECONSTRUCTION_FAILED` |
| `TRAINING` | 80% | 3D Gaussian Splatting optimization | `GPU_ERROR`, `PROCESSING_TIMEOUT` |
| `OPTIMIZING` | 92% | Pruning floaters, quantizing to SPZ | `GPU_ERROR` |
| `PUBLISHING` | 100% | CDN upload & database status update | `STORAGE_ERROR` |

---

## 4. Pipeline Scripts Specification

### `pipeline/validate.py`
```python
import cv2
import glob

def calculate_laplacian_variance(image_path: str) -> float:
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    return cv2.Laplacian(img, cv2.CV_64F).var()

def validate_capture_set(folder_path: str, min_count: int = 20) -> dict:
    images = glob.glob(f"{folder_path}/*.jpg") + glob.glob(f"{folder_path}/*.png")
    if len(images) < min_count:
        return {"valid": False, "error": "TOO_FEW_IMAGES", "count": len(images)}
    
    blur_scores = [calculate_laplacian_variance(img) for img in images]
    avg_blur = sum(blur_scores) / len(blur_scores)
    if avg_blur < 60.0:
        return {"valid": False, "error": "LOW_IMAGE_QUALITY", "avg_blur": avg_blur}
    
    return {"valid": True, "count": len(images), "avg_blur": avg_blur}
```

### `pipeline/compress.py` (PLY to SPZ)
Niantic SPZ compression achieves ~10× reduction over uncompressed PLY:
```bash
# SPZ compression command executed on worker
spz pack input_point_cloud.ply output_scene.spz --sh-degree 3 --quantize-positions 16
```

---

## 5. Dockerfile for GPU Worker

```dockerfile
FROM nvidia/cuda:12.1.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y \
    python3.10 python3-pip git wget cmake build-essential \
    libgl1-mesa-glx libglib2.0-0 colmap \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install 3DGS and PyTorch
RUN pip3 install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121
RUN pip3 install --no-cache-dir submodules/diff-gaussian-rasterization submodules/simple-knn || true

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python3", "-m", "workers.reconstruction_worker"]
```
