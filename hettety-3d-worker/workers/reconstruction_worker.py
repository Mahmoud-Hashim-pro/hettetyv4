"""
HETTETY 3D GPU Worker — Master Coordinator
Executes the full reconstruction lifecycle from raw keyframes to SPZ / GLB dual representations.
Enforces strict failure invariants: no silent progression past failed SfM or training.
"""

import os
import shutil
import logging
import argparse
from typing import Dict, Any

from pipeline.validate import validate_keyframes
from pipeline.colmap import run_sfm
from pipeline.train import run_gaussian_training
from pipeline.optimize import optimize_splat_cloud
from pipeline.compress import convert_ply_to_spz, generate_metric_mesh_glb
from pipeline.publish import publish_tour_assets
from storage.object_storage import ObjectStorageClient
from task_queue.consumer import QueueConsumer

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"
)
logger = logging.getLogger("hettety-3d-worker.master")

class ReconstructionWorker:
    def __init__(self, work_dir: str = "/tmp/hettety_3d", cdn_base_url: str = "https://storage.googleapis.com/hettety-spatial-assets"):
        self.work_dir = work_dir
        self.cdn_base_url = cdn_base_url
        self.storage_client = ObjectStorageClient()
        os.makedirs(self.work_dir, exist_ok=True)

    def process_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        job_id = job.get("id", "job_unknown")
        property_id = job.get("propertyId", "prop_unknown")
        capture_urls = job.get("captureUrls", [])
        callback_url = job.get("callbackUrl", "mock://callback")
        api_key = job.get("apiKey", "")

        job_dir = os.path.join(self.work_dir, job_id)
        raw_images_dir = os.path.join(job_dir, "images")
        colmap_dir = os.path.join(job_dir, "sfm")
        model_dir = os.path.join(job_dir, "output")
        dist_dir = os.path.join(job_dir, "dist")

        os.makedirs(raw_images_dir, exist_ok=True)
        os.makedirs(colmap_dir, exist_ok=True)
        os.makedirs(model_dir, exist_ok=True)
        os.makedirs(dist_dir, exist_ok=True)

        logger.info(f"==> Starting Reconstruction Pipeline for Job {job_id} (Property: {property_id})")

        try:
            # Stage 1: Download captures
            logger.info("[Stage 1/7: UPLOADING/FETCHING] Downloading capture files...")
            self.storage_client.download_capture_files(capture_urls, raw_images_dir)

            # Stage 2: Validate
            logger.info("[Stage 2/7: VALIDATING] Validating keyframes...")
            val_res = validate_keyframes(raw_images_dir, min_images=12)
            if not val_res.get("valid"):
                return self._fail_job(job_id, property_id, val_res.get("error_code", "VALIDATION_FAILED"), val_res.get("message", "Validation failed"), callback_url, api_key)

            # Stage 3: SfM (Structure-from-Motion)
            logger.info("[Stage 3/7: RECONSTRUCTING] Running COLMAP feature extraction & bundle adjustment...")
            try:
                sfm_ok = run_sfm(raw_images_dir, colmap_dir)
                if not sfm_ok:
                    return self._fail_job(job_id, property_id, "SFM_FAILED", "COLMAP SfM did not converge.", callback_url, api_key)
            except Exception as e:
                logger.error(f"COLMAP execution failed: {e}")
                return self._fail_job(job_id, property_id, "SFM_FAILED", f"COLMAP feature matching failed: {e}", callback_url, api_key)

            # Stage 4: 3DGS Optimization / Training
            logger.info("[Stage 4/7: TRAINING] Optimizing 3D Gaussian Splatting scene (30,000 iterations)...")
            train_res = run_gaussian_training(colmap_dir, model_dir, iterations=30000)
            if not train_res.get("success"):
                return self._fail_job(
                    job_id,
                    property_id,
                    train_res.get("error_code", "TRAINING_FAILED"),
                    train_res.get("message", "3DGS training failed"),
                    callback_url,
                    api_key
                )
            target_ply = train_res.get("target_ply")

            # Stage 5: Floater pruning & bounding box extraction
            logger.info("[Stage 5/7: OPTIMIZING] Pruning floaters and computing spatial boundaries...")
            optimized_ply = os.path.join(model_dir, "point_cloud_clean.ply")
            opt_res = optimize_splat_cloud(target_ply, optimized_ply)
            if not opt_res.get("success"):
                return self._fail_job(
                    job_id,
                    property_id,
                    opt_res.get("error_code", "OPTIMIZATION_FAILED"),
                    opt_res.get("message", "Point cloud optimization failed"),
                    callback_url,
                    api_key
                )
            bounds = opt_res.get("bounds", {"min": [-5.0, -1.0, -5.0], "max": [5.0, 3.5, 5.0]})

            # Stage 6: SPZ compression & Metric GLB mesh extraction
            logger.info("[Stage 6/7: COMPRESSING] Packaging into SPZ and generating metric GLB mesh...")
            spz_path = os.path.join(dist_dir, "scene.spz")
            glb_path = os.path.join(dist_dir, "mesh.glb")
            
            convert_res = convert_ply_to_spz(optimized_ply, spz_path)
            mesh_res = generate_metric_mesh_glb(colmap_dir, glb_path)

            if not convert_res.get("success"):
                return self._fail_job(job_id, property_id, "COMPRESSION_FAILED", "SPZ conversion failed", callback_url, api_key)

            # Stage 7: Publishing & Callback
            logger.info("[Stage 7/7: PUBLISHING] Publishing artifacts and notifying Hettety control plane...")
            pub_res = publish_tour_assets(
                job_id=job_id,
                property_id=property_id,
                spz_path=spz_path,
                glb_path=glb_path,
                bounds=bounds,
                cdn_base_url=self.cdn_base_url,
                callback_url=callback_url,
                api_key=api_key,
                storage_client=self.storage_client,
                image_count=val_res.get("image_count", 30)
            )

            logger.info(f"==> Successfully completed reconstruction for Job {job_id}!")
            return pub_res

        except Exception as e:
            logger.exception(f"Fatal error in reconstruction pipeline: {e}")
            return self._fail_job(job_id, property_id, "PROCESSING_ERROR", str(e), callback_url, api_key)
        finally:
            logger.info(f"Cleaning working artifacts for {job_id}")

    def _fail_job(self, job_id: str, property_id: str, error_code: str, message: str, callback_url: str, api_key: str) -> Dict[str, Any]:
        logger.error(f"Job {job_id} FAILED: [{error_code}] {message}")
        payload = {
            "jobId": job_id,
            "propertyId": property_id,
            "status": "failed",
            "errorCode": error_code,
            "errorMessage": message
        }
        # Attempt error webhook
        if callback_url and not callback_url.startswith("mock://"):
            try:
                import requests
                requests.post(callback_url, json=payload, headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
            except Exception as ex:
                logger.warning(f"Failed to post error callback: {ex}")
        return payload
