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
from pipeline.calibrate import calibrate_sparse_scale
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

    def _report_stage(self, job_id: str, property_id: str, status: str, progress: int, stage: str, callback_url: str, api_key: str):
        """Emits live stage and progress updates to the control plane."""
        logger.info(f"[{status} {progress}%] Job {job_id}: {stage}")
        if callback_url and not callback_url.startswith("mock://"):
            try:
                import requests
                payload = {
                    "jobId": job_id,
                    "propertyId": property_id,
                    "status": status,
                    "progress": progress,
                    "stage": stage
                }
                requests.post(callback_url, json=payload, headers={"Authorization": f"Bearer {api_key}"}, timeout=5)
            except Exception as e:
                logger.debug(f"Stage progress webhook note for {job_id}: {e}")

    def process_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        job_id = job.get("id", "job_unknown")
        property_id = job.get("propertyId", "prop_unknown")
        job_type = job.get("type", "photos")
        is_video = (job_type == "video")
        capture_urls = job.get("captureUrls", [])
        reference_anchors = job.get("referenceAnchors") or job.get("scaleReferences") or []
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

        logger.info(f"==> Starting Reconstruction Pipeline for Job {job_id} (Property: {property_id}, is_video={is_video})")

        try:
            # Stage 1: Download captures
            self._report_stage(job_id, property_id, "UPLOADING", 10, "Downloading capture keyframes", callback_url, api_key)
            self.storage_client.download_capture_files(capture_urls, raw_images_dir)

            # Stage 2: Validate keyframe dataset
            self._report_stage(job_id, property_id, "VALIDATING", 20, "Analyzing Laplacian sharpness and count", callback_url, api_key)
            val_res = validate_keyframes(raw_images_dir, min_images=12)
            if not val_res.get("valid"):
                return self._fail_job(job_id, property_id, val_res.get("error_code", "VALIDATION_FAILED"), val_res.get("message", "Validation failed"), callback_url, api_key)

            # Stage 3: SfM (Structure-from-Motion)
            self._report_stage(job_id, property_id, "RECONSTRUCTING", 40, "COLMAP feature extraction & camera alignment", callback_url, api_key)
            try:
                sfm_res = run_sfm(raw_images_dir, colmap_dir, is_video=is_video)
                if not sfm_res:
                    return self._fail_job(
                        job_id,
                        property_id,
                        sfm_res.get("error_code", "SFM_FAILED"),
                        sfm_res.get("message", "COLMAP SfM did not converge."),
                        callback_url,
                        api_key
                    )
            except Exception as e:
                logger.error(f"COLMAP execution failed: {e}")
                return self._fail_job(job_id, property_id, "SFM_FAILED", f"COLMAP feature matching failed: {e}", callback_url, api_key)

            # Stage 4: 3DGS Optimization / Training
            self._report_stage(job_id, property_id, "TRAINING", 65, "Optimizing 3D Gaussian Splatting scene", callback_url, api_key)
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
            self._report_stage(job_id, property_id, "OPTIMIZING", 80, "Pruning floaters and computing spatial boundaries", callback_url, api_key)
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

            # Stage 6: Metric Calibration & Compression
            self._report_stage(job_id, property_id, "OPTIMIZING", 90, "Calibrating scale and generating metric GLB mesh", callback_url, api_key)
            calib_res = calibrate_sparse_scale([], reference_anchors)
            scale_factor = calib_res.get("scale_factor", 1.0)
            is_calibrated = calib_res.get("is_calibrated", False)

            spz_path = os.path.join(dist_dir, "scene.spz")
            glb_path = os.path.join(dist_dir, "mesh.glb")
            
            convert_res = convert_ply_to_spz(optimized_ply, spz_path)
            mesh_res = generate_metric_mesh_glb(colmap_dir, glb_path, scale_factor=scale_factor)

            if not convert_res.get("success"):
                return self._fail_job(job_id, property_id, "COMPRESSION_FAILED", convert_res.get("message", "SPZ conversion failed"), callback_url, api_key)

            if not mesh_res.get("success"):
                return self._fail_job(job_id, property_id, "MESH_GENERATION_FAILED", mesh_res.get("message", "Metric GLB mesh generation failed"), callback_url, api_key)

            # Stage 7: Publishing & Callback
            self._report_stage(job_id, property_id, "PUBLISHING", 96, "Uploading verified spatial assets", callback_url, api_key)
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
                image_count=val_res.get("image_count", 30),
                splat_count=opt_res.get("splat_count", 0),
                sharpness_score=val_res.get("sharpness_score", 85),
                registered_cameras=sfm_res.get("registered_images", 0),
                mesh_vertex_count=mesh_res.get("vertex_count", 0),
                mesh_face_count=mesh_res.get("face_count", 0),
                is_calibrated_metric=is_calibrated
            )

            if not pub_res.get("success"):
                return self._fail_job(job_id, property_id, pub_res.get("error_code", "PUBLISH_FAILED"), pub_res.get("message", "Publishing failed"), callback_url, api_key)

            self._report_stage(job_id, property_id, "READY", 100, "Spatial tour reconstruction complete", callback_url, api_key)
            logger.info(f"==> Successfully completed reconstruction for Job {job_id}!")
            return pub_res

        except Exception as e:
            logger.exception(f"Fatal error in reconstruction pipeline: {e}")
            return self._fail_job(job_id, property_id, "PROCESSING_ERROR", str(e), callback_url, api_key)
        finally:
            # STRICT DISK CLEANUP: Clean up heavy raw images, COLMAP db, and intermediate models to prevent worker disk exhaustion
            try:
                if os.path.exists(job_dir):
                    shutil.rmtree(raw_images_dir, ignore_errors=True)
                    shutil.rmtree(colmap_dir, ignore_errors=True)
                    shutil.rmtree(model_dir, ignore_errors=True)
                    shutil.rmtree(job_dir, ignore_errors=True)
                    logger.info(f"Cleaned up intermediate workspace files for {job_id}")
            except Exception as cleanup_err:
                logger.warning(f"Error during workspace cleanup for {job_id}: {cleanup_err}")

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
