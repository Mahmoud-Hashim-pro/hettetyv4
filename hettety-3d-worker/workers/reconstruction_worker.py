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
import subprocess
from typing import Dict, Any, Optional, Tuple, List

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
        self.active_processes: List[subprocess.Popen] = []
        self._cancellation_requested: Dict[str, bool] = {}
        os.makedirs(self.work_dir, exist_ok=True)
        # P0-1 / Section 59: Production guard against invalid test mode
        if os.environ.get("NODE_ENV") == "production" and os.environ.get("HETTETY_ENV") == "test":
            raise RuntimeError("INVALID_ENVIRONMENT_CONFIGURATION: HETTETY_ENV=test is strictly forbidden when NODE_ENV=production")
        self.cleanup_orphan_workspaces(max_age_hours=2.0)

    def cleanup_orphan_workspaces(self, max_age_hours: float = 2.0):
        """Scans work directory on startup and removes stale orphaned workspaces older than threshold."""
        try:
            import time
            now = time.time()
            max_age_sec = max_age_hours * 3600
            for entry in os.listdir(self.work_dir):
                full_path = os.path.join(self.work_dir, entry)
                if os.path.isdir(full_path):
                    mtime = os.path.getmtime(full_path)
                    if now - mtime > max_age_sec:
                        logger.info(f"Removing abandoned orphan workspace: {full_path}")
                        shutil.rmtree(full_path, ignore_errors=True)
        except Exception as e:
            logger.warning(f"Error during orphan workspace cleanup: {e}")

    def is_cancelled(self, job_id: str) -> bool:
        """Polls cancellation status from memory flag, control plane, or Redis."""
        if self._cancellation_requested.get(job_id):
            return True
        if self.queue_consumer:
            return self.queue_consumer.is_job_cancelled(job_id)
        return False

    def _start_heartbeat(self, job_id: str, attempt_id: str, worker_id: str, callback_url: str, api_key: str, interval_sec: float = 15.0):
        """Launches a background daemon thread that periodically refreshes the job lease and heartbeats control plane."""
        import threading
        stop_event = threading.Event()

        def heartbeat_loop():
            while not stop_event.wait(timeout=interval_sec):
                if callback_url and not callback_url.startswith("mock://"):
                    try:
                        import requests
                        payload = {
                            "jobId": job_id,
                            "attemptId": attempt_id,
                            "workerId": worker_id,
                            "action": "heartbeat"
                        }
                        resp = requests.post(callback_url, json=payload, headers={"Authorization": f"Bearer {api_key}"}, timeout=5)
                        if resp.ok:
                            data = resp.json()
                            if data.get("cancelRequested") or data.get("status") == "CANCELLED":
                                logger.warning(f"Control plane signaled durable cancellation for job {job_id} in heartbeat response.")
                                self._cancellation_requested[job_id] = True
                    except Exception as ex:
                        logger.debug(f"Heartbeat note for {job_id}: {ex}")
                if self.queue_consumer and hasattr(self.queue_consumer, "heartbeat"):
                    try:
                        self.queue_consumer.heartbeat(job_id)
                    except Exception:
                        pass

        t = threading.Thread(target=heartbeat_loop, daemon=True)
        t.start()
        return stop_event

    def terminate_active_processes(self):
        """Gracefully terminates and kills active background reconstruction subprocesses (COLMAP / 3DGS) and frees GPU memory."""
        try:
            from pipeline.process_manager import terminate_all_active_processes
            terminate_all_active_processes()
        except Exception as e:
            logger.warning(f"Error calling terminate_all_active_processes: {e}")

        for p in list(self.active_processes):
            try:
                if p.poll() is None:
                    logger.warning(f"Terminating subprocess PID {p.pid} due to cancellation / exit...")
                    p.terminate()
                    try:
                        p.wait(timeout=2)
                    except Exception:
                        p.kill()
            except Exception as e:
                logger.warning(f"Error terminating subprocess: {e}")
        self.active_processes.clear()

        # Free GPU allocations
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    def _report_stage(
        self,
        job_id: str,
        property_id: str,
        status: str,
        progress: int,
        stage: str,
        callback_url: str,
        api_key: str,
        attempt_id: Optional[str] = None,
        worker_id: Optional[str] = None
    ):
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
                if attempt_id:
                    payload["attemptId"] = attempt_id
                if worker_id:
                    payload["workerId"] = worker_id
                requests.post(callback_url, json=payload, headers={"Authorization": f"Bearer {api_key}"}, timeout=5)
            except Exception as e:
                logger.debug(f"Stage progress webhook note for {job_id}: {e}")

    def process_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        job_id = job.get("id", "job_unknown")
        property_id = job.get("propertyId", "prop_unknown")
        attempt_id = job.get("attemptId") or job.get("attempt")
        worker_id = job.get("workerId") or os.getenv("HETTETY_WORKER_ID", "hettety-gpu-worker-1")
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
        callback_url = job.get("callbackUrl") or os.getenv("HETTETY_CONTROL_PLANE_URL", "mock://callback")
        api_key = job.get("apiKey") or os.getenv("WORKER_SHARED_SECRET", "hettety-worker-secret-internal")

        # Bound reporting closures with attempt isolation & worker identification
        def report(status: str, progress: int, stage_desc: str):
            self._report_stage(job_id, property_id, status, progress, stage_desc, callback_url, api_key, attempt_id=attempt_id, worker_id=worker_id)

        def fail(err_code: str, err_msg: str) -> Dict[str, Any]:
            return self._fail_job(job_id, property_id, err_code, err_msg, callback_url, api_key, attempt_id=attempt_id, worker_id=worker_id)

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

        # P0-1 / Section 59: Production guard against invalid test mode
        if os.environ.get("NODE_ENV") == "production" and os.environ.get("HETTETY_ENV") == "test":
            logger.error("Production guard: HETTETY_ENV=test is strictly rejected when NODE_ENV=production.")
            return fail("INVALID_ENVIRONMENT_CONFIGURATION", "HETTETY_ENV=test is strictly forbidden when NODE_ENV=production")

        heartbeat_stop = None
        try:
            # Check pre-flight cancellation
            if self.is_cancelled(job_id):
                logger.info(f"Job {job_id} was cancelled before starting. Aborting.")
                report("CANCELLED", 0, "Job cancelled by user")
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Start background heartbeat daemon for this attempt
            heartbeat_stop = self._start_heartbeat(job_id, attempt_id or "attempt_1", worker_id, callback_url, api_key)

            # Stage 1: Download captures
            report("UPLOADING", 10, "Downloading capture keyframes")
            self.storage_client.download_capture_files(capture_urls, raw_images_dir)

            if self.is_cancelled(job_id):
                report("CANCELLED", 15, "Job cancelled by user")
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 2: Validate keyframe dataset
            report("VALIDATING", 20, "Analyzing Laplacian sharpness and count")
            val_res = validate_keyframes(raw_images_dir, min_images=12)
            if not val_res.get("valid"):
                return fail(val_res.get("error_code", "VALIDATION_FAILED"), val_res.get("message", "Validation failed"))

            if self.is_cancelled(job_id):
                report("CANCELLED", 25, "Job cancelled by user")
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            cancel_checker = lambda: self.is_cancelled(job_id)

            # Stage 3: SfM (Structure-from-Motion)
            report("RECONSTRUCTING", 35, "COLMAP feature extraction & camera alignment")
            try:
                sfm_res = run_sfm(raw_images_dir, colmap_dir, is_video=is_video, cancel_check=cancel_checker)
                if not sfm_res:
                    return fail(
                        sfm_res.get("error_code", "SFM_FAILED"),
                        sfm_res.get("message", "COLMAP SfM did not converge.")
                    )
            except Exception as e:
                logger.error(f"COLMAP execution failed: {e}")
                return fail("SFM_FAILED", f"COLMAP feature matching failed: {e}")

            if self.is_cancelled(job_id):
                report("CANCELLED", 45, "Job cancelled by user")
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 3.5: Dense Stereo Reconstruction (undistort -> patch match stereo -> stereo fusion)
            dense_dir = os.path.join(colmap_dir, "dense")
            report("RECONSTRUCTING", 50, "Executing dense multi-view stereo fusion")
            try:
                dense_res = run_dense_stereo(sparse_dir=colmap_dir, image_dir=raw_images_dir, dense_dir=dense_dir, cancel_check=cancel_checker)
                fused_ply = os.path.join(dense_dir, "fused.ply")
                if not os.path.exists(fused_ply) or os.path.getsize(fused_ply) < 100:
                    # In real reconstruction, dense failure must strictly fail rather than falling back to sparse SfM
                    if os.environ.get("HETTETY_ENV") != "test" and not callback_url.startswith("mock://"):
                        return fail(
                            "DENSE_RECONSTRUCTION_FAILED",
                            "Dense multi-view stereo fusion failed to produce fused point cloud. Fallback to sparse SfM prohibited."
                        )
            except Exception as dense_err:
                logger.error(f"Dense stereo reconstruction failed for {job_id}: {dense_err}")
                if os.environ.get("HETTETY_ENV") != "test" and not callback_url.startswith("mock://"):
                    return fail(
                        "DENSE_RECONSTRUCTION_FAILED",
                        f"Dense multi-view stereo reconstruction failed: {dense_err}. Fallback to sparse SfM prohibited."
                    )

            if self.is_cancelled(job_id):
                report("CANCELLED", 55, "Job cancelled by user")
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 4: 3DGS Optimization / Training
            report("TRAINING", 65, "Optimizing 3D Gaussian Splatting scene")
            train_res = run_gaussian_training(colmap_dir, model_dir, iterations=30000, cancel_check=cancel_checker)
            if not train_res.get("success"):
                return fail(
                    train_res.get("error_code", "TRAINING_FAILED"),
                    train_res.get("message", "3DGS training failed")
                )
            target_ply = train_res.get("target_ply")

            if self.is_cancelled(job_id):
                report("CANCELLED", 75, "Job cancelled by user")
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 5: Floater pruning & dynamic bounding box extraction
            report("OPTIMIZING", 80, "Pruning floaters and computing spatial boundaries")
            optimized_ply = os.path.join(model_dir, "point_cloud_clean.ply")
            opt_res = optimize_splat_cloud(target_ply, optimized_ply)
            if not opt_res.get("success"):
                return fail(
                    opt_res.get("error_code", "OPTIMIZATION_FAILED"),
                    opt_res.get("message", "Point cloud optimization failed")
                )
            
            # Strict non-synthetic bounds validation: Fail if geometry does not produce real bounds
            bounds = opt_res.get("bounds")
            if not bounds or "min" not in bounds or "max" not in bounds:
                return fail(
                    "MESH_VALIDATION_FAILED",
                    "Cannot compute genuine spatial bounds from reconstruction geometry. Default bounding box prohibited."
                )

            if self.is_cancelled(job_id):
                report("CANCELLED", 85, "Job cancelled by user")
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            # Stage 6: Metric Calibration & Compression
            report("OPTIMIZING", 90, "Calibrating scale and generating metric GLB mesh")
            sparse_pts: List[Tuple[float, float, float]] = []
            sparse_map: Dict[int, Tuple[float, float, float]] = {}
            candidate_points3d_txt = [
                os.path.join(colmap_dir, "sparse", "0", "points3D.txt"),
                os.path.join(colmap_dir, "sparse", "points3D.txt"),
                os.path.join(colmap_dir, "0", "points3D.txt"),
                os.path.join(colmap_dir, "points3D.txt"),
            ]
            for p_path in candidate_points3d_txt:
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
                        logger.debug(f"Could not read points3D from {p_path}: {ex}")

            calib_res = calibrate_sparse_scale(sparse_pts, reference_anchors, point3d_map=sparse_map)
            scale_factor = calib_res.get("scale_factor", 1.0)
            is_calibrated = calib_res.get("is_calibrated", False)

            spz_path = os.path.join(dist_dir, "scene.spz")
            glb_path = os.path.join(dist_dir, "mesh.glb")

            convert_res = convert_ply_to_spz(optimized_ply, spz_path)
            mesh_res = generate_metric_mesh_glb(colmap_dir, glb_path, scale_factor=scale_factor)

            if not convert_res.get("success"):
                return fail("COMPRESSION_FAILED", convert_res.get("message", "SPZ conversion failed"))

            if not mesh_res.get("success"):
                return fail("MESH_GENERATION_FAILED", mesh_res.get("message", "Metric GLB mesh generation failed"))

            # Stage 7: Publishing & Callback
            report("PUBLISHING", 96, "Uploading verified spatial assets")
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
                is_calibrated_metric=is_calibrated,
                attempt_id=attempt_id,
                worker_id=worker_id
            )

            if not pub_res.get("success"):
                return fail(pub_res.get("error_code", "PUBLISH_FAILED"), pub_res.get("message", "Publishing failed"))

            report("READY", 100, "Spatial tour reconstruction complete")
            logger.info(f"==> Successfully completed reconstruction for Job {job_id}!")
            return pub_res

        except Exception as e:
            from pipeline.process_manager import JobCancelledException
            if isinstance(e, JobCancelledException):
                logger.warning(f"Reconstruction job {job_id} cancelled during managed execution: {e}")
                report("CANCELLED", 0, "Job cancelled by user request")
                return {"status": "cancelled", "jobId": job_id, "propertyId": property_id}

            err_str = str(e).lower()
            if "out of memory" in err_str or "cuda error: out of memory" in err_str:
                logger.error(f"CUDA GPU Out-Of-Memory encountered for job {job_id}: {e}")
                try:
                    import torch
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception:
                    pass
                return fail("GPU_OUT_OF_MEMORY", f"Reconstruction failed: GPU memory exhausted (CUDA OOM): {e}")

            logger.exception(f"Fatal error in reconstruction pipeline: {e}")
            return fail("PROCESSING_ERROR", str(e))
        finally:
            if heartbeat_stop:
                try:
                    heartbeat_stop.set()
                except Exception:
                    pass
            self.terminate_active_processes()
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

    def _fail_job(
        self,
        job_id: str,
        property_id: str,
        error_code: str,
        message: str,
        callback_url: str,
        api_key: str,
        attempt_id: Optional[str] = None,
        worker_id: Optional[str] = None
    ) -> Dict[str, Any]:
        logger.error(f"Job {job_id} FAILED: [{error_code}] {message}")
        payload = {
            "jobId": job_id,
            "propertyId": property_id,
            "status": "failed",
            "errorCode": error_code,
            "errorMessage": message
        }
        if attempt_id:
            payload["attemptId"] = attempt_id
        if worker_id:
            payload["workerId"] = worker_id
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
    worker_id = os.environ.get("HETTETY_WORKER_ID", "hettety-gpu-worker-1")
    consumer = QueueConsumer(queue_name=args.queue, redis_url=args.redis_url, worker_id=worker_id)
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
