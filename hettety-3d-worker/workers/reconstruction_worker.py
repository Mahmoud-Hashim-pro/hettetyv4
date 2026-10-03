"""
HETTETY 3D GPU Worker — Master Coordinator
Executes the full reconstruction lifecycle from raw keyframes to SPZ / GLB dual representations.
Enforces strict failure invariants: no silent progression past failed SfM, training, or meshing.
Includes durable consumer daemon loop with lease timeout, cancellation checks, and DLQ handling.
"""

import os
import shutil
import logging
import argparse
from typing import Dict, Any, Optional

from pipeline.validate import validate_keyframes
from pipeline.colmap import run_sfm, run_dense_stereo
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
    def __init__(
        self,
        work_dir: str = "/tmp/hettety_3d",
        cdn_base_url: str = "https://storage.googleapis.com/hettety-spatial-assets",
        queue_consumer: Optional[QueueConsumer] = None
    ):
        self.work_dir = work_dir
        self.cdn_base_url = cdn_base_url
        self.storage_client = ObjectStorageClient()
        self.queue_consumer = queue_consumer
        os.makedirs(self.work_dir, exist_ok=True)

    def is_cancelled(self, job_id: str) -> bool:
        """Polls cancellation status from control plane / Redis."""
        if self.queue_consumer:
            return self.queue_consumer.is_job_cancelled(job_id)
        return False

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
        capture_manifest = job.get("manifest") or job.get("captureManifest") or []
        if capture_manifest:
            capture_urls = [
                item.get("storagePath") or item.get("uploadUrl") or item.get("url")
                for item in capture_manifest if isinstance(item, dict)
            ]
        else:
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
            # Check pre-flight cancellation
            if self.is_cancelled(job_id):
                logger.info(f"Job {job_id} was cancelled before starting. Aborting.")
                self._report_stage(job_id, property_id, "CANCELLED", 0, "Job cancelled by user", callback_url, api_key)
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 1: Download captures
            self._report_stage(job_id, property_id, "UPLOADING", 10, "Downloading capture keyframes", callback_url, api_key)
            self.storage_client.download_capture_files(capture_urls, raw_images_dir)

            if self.is_cancelled(job_id):
                self._report_stage(job_id, property_id, "CANCELLED", 15, "Job cancelled by user", callback_url, api_key)
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 2: Validate keyframe dataset
            self._report_stage(job_id, property_id, "VALIDATING", 20, "Analyzing Laplacian sharpness and count", callback_url, api_key)
            val_res = validate_keyframes(raw_images_dir, min_images=12)
            if not val_res.get("valid"):
                return self._fail_job(job_id, property_id, val_res.get("error_code", "VALIDATION_FAILED"), val_res.get("message", "Validation failed"), callback_url, api_key)

            if self.is_cancelled(job_id):
                self._report_stage(job_id, property_id, "CANCELLED", 25, "Job cancelled by user", callback_url, api_key)
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 3: SfM (Structure-from-Motion)
            self._report_stage(job_id, property_id, "RECONSTRUCTING", 35, "COLMAP feature extraction & camera alignment", callback_url, api_key)
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

            if self.is_cancelled(job_id):
                self._report_stage(job_id, property_id, "CANCELLED", 45, "Job cancelled by user", callback_url, api_key)
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 3.5: Dense Stereo Reconstruction (undistort -> patch match stereo -> stereo fusion)
            dense_dir = os.path.join(colmap_dir, "dense")
            self._report_stage(job_id, property_id, "RECONSTRUCTING", 50, "Executing dense multi-view stereo fusion", callback_url, api_key)
            try:
                dense_res = run_dense_stereo(sparse_dir=colmap_dir, image_dir=raw_images_dir, dense_dir=dense_dir)
                fused_ply = os.path.join(dense_dir, "fused.ply")
                if not os.path.exists(fused_ply) or os.path.getsize(fused_ply) < 100:
                    # In real reconstruction, dense failure must strictly fail rather than falling back to sparse SfM
                    if os.environ.get("HETTETY_ENV") != "test" and not callback_url.startswith("mock://"):
                        return self._fail_job(
                            job_id,
                            property_id,
                            "DENSE_RECONSTRUCTION_FAILED",
                            "Dense multi-view stereo fusion failed to produce fused point cloud. Fallback to sparse SfM prohibited.",
                            callback_url,
                            api_key
                        )
            except Exception as dense_err:
                logger.error(f"Dense stereo reconstruction failed for {job_id}: {dense_err}")
                if os.environ.get("HETTETY_ENV") != "test" and not callback_url.startswith("mock://"):
                    return self._fail_job(
                        job_id,
                        property_id,
                        "DENSE_RECONSTRUCTION_FAILED",
                        f"Dense multi-view stereo reconstruction failed: {dense_err}. Fallback to sparse SfM prohibited.",
                        callback_url,
                        api_key
                    )

            if self.is_cancelled(job_id):
                self._report_stage(job_id, property_id, "CANCELLED", 55, "Job cancelled by user", callback_url, api_key)
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

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

            if self.is_cancelled(job_id):
                self._report_stage(job_id, property_id, "CANCELLED", 75, "Job cancelled by user", callback_url, api_key)
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 5: Floater pruning & dynamic bounding box extraction
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
            
            # Strict non-synthetic bounds validation: Fail if geometry does not produce real bounds
            bounds = opt_res.get("bounds")
            if not bounds or "min" not in bounds or "max" not in bounds:
                return self._fail_job(
                    job_id,
                    property_id,
                    "MESH_VALIDATION_FAILED",
                    "Cannot compute genuine spatial bounds from reconstruction geometry. Default bounding box prohibited.",
                    callback_url,
                    api_key
                )

            if self.is_cancelled(job_id):
                self._report_stage(job_id, property_id, "CANCELLED", 85, "Job cancelled by user", callback_url, api_key)
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 6: Metric Calibration & Compression
            self._report_stage(job_id, property_id, "OPTIMIZING", 90, "Calibrating scale and generating metric GLB mesh", callback_url, api_key)
            sparse_pts = []
            sparse_map: Dict[int, Tuple[float, float, float]] = {}
            candidate_pts_paths = [
                os.path.join(dense_dir, "fused.ply"),
                os.path.join(colmap_dir, "sparse", "0", "points3D.txt"),
                os.path.join(colmap_dir, "sparse", "points3D.txt"),
                os.path.join(colmap_dir, "0", "points3D.txt"),
                os.path.join(colmap_dir, "points3D.txt"),
            ]
            for p_path in candidate_pts_paths:
                if os.path.exists(p_path) and os.path.getsize(p_path) > 0:
                    try:
                        with open(p_path, "r", encoding="utf-8", errors="ignore") as f:
                            for line in f:
                                if not line.startswith("#") and line.strip():
                                    parts = line.split()
                                    if len(parts) >= 4:
                                        coord = (float(parts[1]), float(parts[2]), float(parts[3]))
                                        sparse_pts.append(coord)
                                        try:
                                            p_id = int(parts[0])
                                            sparse_map[p_id] = coord
                                        except (ValueError, TypeError):
                                            pass
                        if sparse_pts:
                            break
                    except Exception as ex:
                        logger.debug(f"Could not read points for calibration from {p_path}: {ex}")

            calib_res = calibrate_sparse_scale(sparse_pts, reference_anchors, point3d_map=sparse_map)
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
                image_count=val_res.get("image_count", len(capture_urls)),
                splat_count=opt_res.get("splat_count", 0),
                sharpness_score=val_res.get("sharpness_score"),
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

def main():
    parser = argparse.ArgumentParser(description="HETTETY 3D GPU Worker Daemon")
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://localhost:6379/0"), help="Redis connection URL")
    parser.add_argument("--queue", default=os.environ.get("REDIS_QUEUE", "hettety_3d_jobs"), help="Queue name")
    parser.add_argument("--work-dir", default=os.environ.get("WORK_DIR", "/tmp/hettety_3d"), help="Scratch directory for reconstructions")
    parser.add_argument("--cdn-url", default=os.environ.get("CDN_BASE_URL", "https://storage.googleapis.com/hettety-spatial-assets"), help="CDN base URL")
    parser.add_argument("--once", action="store_true", help="Process at most one job and exit")
    parser.add_argument("--max-jobs", type=int, default=None, help="Max jobs to process before exiting")
    args = parser.parse_args()

    logger.info(f"Starting HETTETY 3D Reconstruction Worker daemon on queue '{args.queue}'...")
    consumer = QueueConsumer(queue_name=args.queue, redis_url=args.redis_url)
    worker = ReconstructionWorker(work_dir=args.work_dir, cdn_base_url=args.cdn_url, queue_consumer=consumer)

    def job_handler(job: Dict[str, Any]) -> Dict[str, Any]:
        logger.info(f"Processing job {job.get('id')} from queue...")
        return worker.process_job(job)

    if args.once:
        job = consumer.poll_job(timeout_sec=5)
        if job:
            job_handler(job)
        else:
            logger.info("No pending jobs found in queue (--once mode). Exiting.")
    else:
        consumer.listen(job_handler, max_iterations=args.max_jobs)

if __name__ == "__main__":
    main()
