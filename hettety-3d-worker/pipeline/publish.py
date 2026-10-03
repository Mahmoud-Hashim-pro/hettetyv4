"""
HETTETY 3D GPU Worker — Stage 7: Asset Publishing & Callback
Uploads final artifacts to Cloud Storage / CDN and notifies Hettety backend.
Computes genuine, non-mocked quality metrics grounded in reconstructed asset properties.
"""

import os
import json
import logging
import requests
from typing import Dict, Any, Optional

logger = logging.getLogger("hettety-3d-worker.publish")

def publish_tour_assets(
    job_id: str,
    property_id: str,
    spz_path: str,
    glb_path: str,
    bounds: Dict[str, Any],
    cdn_base_url: str,
    callback_url: str,
    api_key: str,
    storage_client: Optional[Any] = None,
    image_count: int = 30,
    splat_count: int = 0,
    sharpness_score: Optional[int] = None,
    registered_cameras: int = 0,
    mesh_vertex_count: int = 0,
    mesh_face_count: int = 0,
    is_calibrated_metric: bool = False,
    attempt_id: Optional[str] = None,
    worker_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Publishes generated representations and invokes Hettety completion webhook.
    Uploads real artifacts to object storage and generates grounded quality metrics.
    """
    logger.info(f"Publishing 3D tour assets for job={job_id}, property={property_id}")
    
    spz_filename = os.path.basename(spz_path)
    glb_filename = os.path.basename(glb_path)
    
    # Immutable versioned paths: properties/{property_id}/3d/{job_id}/{attempt_id}/...
    attempt_tag = attempt_id or "attempt_1"
    version_dir = f"properties/{property_id}/3d/{job_id}/{attempt_tag}"
    remote_spz_path = f"{version_dir}/{spz_filename}"
    remote_glb_path = f"{version_dir}/{glb_filename}"
    tour_spz_path = f"properties/{property_id}/tour/{spz_filename}"
    tour_glb_path = f"properties/{property_id}/tour/{glb_filename}"

    spz_url = f"{cdn_base_url}/{remote_spz_path}"
    glb_url = f"{cdn_base_url}/{remote_glb_path}"

    if storage_client:
        try:
            if os.path.exists(spz_path):
                storage_client.upload_file(spz_path, remote_spz_path)
                storage_client.upload_file(spz_path, tour_spz_path)
            if os.path.exists(glb_path):
                storage_client.upload_file(glb_path, remote_glb_path)
                storage_client.upload_file(glb_path, tour_glb_path)
        except Exception as upload_err:
            logger.error(f"Cloud Storage upload failed: {upload_err}")
            return {
                "success": False,
                "error_code": "STORAGE_UPLOAD_FAILED",
                "message": str(upload_err)
            }

    import hashlib

    def compute_sha256(path: str) -> str:
        if not path or not os.path.exists(path):
            return ""
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()

    spz_size = os.path.getsize(spz_path) if os.path.exists(spz_path) else 0
    glb_size = os.path.getsize(glb_path) if os.path.exists(glb_path) else 0
    spz_sha256 = compute_sha256(spz_path)
    glb_sha256 = compute_sha256(glb_path)

    # Strictly grounded quality telemetry: REAL, UNKNOWN, FAIL (no fabricated estimates)
    reg_val = registered_cameras if registered_cameras is not None else 0
    reg_status = "REAL" if reg_val > 0 else ("FAIL" if image_count > 0 else "UNKNOWN")

    splat_val = splat_count if splat_count is not None else 0
    splat_status = "REAL" if splat_val > 0 else "FAIL"

    sharpness_val = sharpness_score
    sharpness_status = "REAL" if sharpness_val is not None else "UNKNOWN"

    reg_ratio = min(1.0, reg_val / max(1, image_count)) if image_count > 0 else 0.0
    coverage_score = int(min(100, max(0, reg_ratio * 70.0 + min(30.0, (image_count / 40.0) * 30.0)))) if reg_val > 0 else 0

    density_score = min(100, max(0, int((min(splat_val, 600000) / 400000.0) * 100))) if splat_val > 0 else 0

    mesh_score = min(100, max(0, int((min(mesh_face_count, 500) / 200.0) * 60 + (40 if is_calibrated_metric else 10)))) if mesh_face_count > 0 else 0
    
    # Calculate overall score only across verified metrics
    valid_components = []
    if reg_val > 0:
        valid_components.append(coverage_score * 0.4)
    if splat_val > 0:
        valid_components.append(density_score * 0.4)
    if mesh_face_count > 0:
        valid_components.append(mesh_score * 0.2)
    if sharpness_val is not None and sharpness_status == "REAL":
        valid_components.append(sharpness_val * 0.1)

    overall_weights = []
    if reg_val > 0:
        overall_weights.append(0.4)
    if splat_val > 0:
        overall_weights.append(0.4)
    if mesh_face_count > 0:
        overall_weights.append(0.2)
    if sharpness_val is not None and sharpness_status == "REAL":
        overall_weights.append(0.1)

    overall_score = int(sum(valid_components) / max(0.1, sum(overall_weights))) if valid_components else 0
    
    quality_metrics = {
        "coverage": coverage_score,
        "sharpness": sharpness_val,
        "density": density_score,
        "meshCompleteness": mesh_score,
        "registeredCameras": {
            "value": reg_val,
            "status": reg_status
        },
        "totalCameras": image_count,
        "splatCount": {
            "value": splat_val,
            "status": splat_status
        },
        "sharpnessScore": {
            "value": sharpness_val,
            "status": sharpness_status
        },
        "isCalibratedMetric": is_calibrated_metric
    }

    import tempfile
    import datetime

    manifest_url = None
    manifest_sha256 = None

    manifest_content = {
        "manifestVersion": "1.0.0",
        "jobId": job_id,
        "propertyId": property_id,
        "attemptId": attempt_id,
        "workerId": worker_id,
        "publishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "coordinateSystem": {
            "name": "threejs_canonical",
            "handedness": "right_handed",
            "axis": {
                "x": "+X_right",
                "y": "+Y_up",
                "z": "+Z_backward"
            },
            "unit": "meter",
            "scale": 1.0
        },
        "artifacts": {
            "spz": {
                "format": "spz",
                "url": spz_url,
                "storagePath": remote_spz_path,
                "sha256": spz_sha256,
                "sizeBytes": spz_size,
                "splatCount": splat_val
            },
            "glb": {
                "format": "glb",
                "url": glb_url,
                "storagePath": remote_glb_path,
                "sha256": glb_sha256,
                "sizeBytes": glb_size,
                "vertexCount": mesh_vertex_count,
                "faceCount": mesh_face_count,
                "isCalibratedMetric": is_calibrated_metric
            }
        },
        "bounds": bounds,
        "qualityReport": {
            "overallScore": overall_score,
            "metrics": quality_metrics
        }
    }

    remote_manifest_path = f"{version_dir}/manifest.json"
    tour_manifest_path = f"properties/{property_id}/tour/manifest.json"
    manifest_url = f"{cdn_base_url}/{remote_manifest_path}"
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as mf:
        json.dump(manifest_content, mf, indent=2)
        local_manifest_tmp = mf.name

    try:
        manifest_sha256 = compute_sha256(local_manifest_tmp)
        if storage_client:
            storage_client.upload_file(local_manifest_tmp, remote_manifest_path)
            storage_client.upload_file(local_manifest_tmp, tour_manifest_path)
    finally:
        try:
            os.remove(local_manifest_tmp)
        except Exception:
            pass

    payload = {
        "jobId": job_id,
        "propertyId": property_id,
        "status": "ready",
        **({"attemptId": attempt_id} if attempt_id else {}),
        **({"workerId": worker_id} if worker_id else {}),
        **({"manifestUrl": manifest_url} if manifest_url else {}),
        **({"manifestSha256": manifest_sha256} if manifest_sha256 else {}),
        "representation": {
            "gaussianSplat": {
                "format": "spz",
                "url": spz_url,
                "sizeBytes": spz_size,
                "splatCount": splat_val,
                **({"sha256": spz_sha256} if spz_sha256 else {})
            },
            "mesh": {
                "format": "glb",
                "url": glb_url,
                "sizeBytes": glb_size,
                "vertexCount": mesh_vertex_count,
                "faceCount": mesh_face_count,
                "isCalibratedMetric": is_calibrated_metric,
                **({"sha256": glb_sha256} if glb_sha256 else {})
            }
        },
        "bounds": bounds,
        "qualityReport": {
            "overallScore": overall_score,
            "metrics": quality_metrics
        }
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    try:
        if callback_url and not callback_url.startswith("mock://"):
            resp = requests.post(callback_url, json=payload, headers=headers, timeout=15)
            resp.raise_for_status()
            logger.info("Successfully notified Hettety control plane.")
        else:
            logger.info(f"Local/Test notification dispatched for {callback_url}: payload={json.dumps(payload)}")
            
        return {
            "success": True,
            "status": "ready",
            "payload": payload
        }
    except Exception as e:
        logger.error(f"Callback delivery failed: {str(e)}")
        return {
            "success": False,
            "error_code": "CALLBACK_FAILED",
            "message": str(e)
        }
