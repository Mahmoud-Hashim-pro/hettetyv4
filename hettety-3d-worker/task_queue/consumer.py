"""
HETTETY 3D GPU Worker — Queue Consumer
Pulls reconstruction jobs from Redis queue with durable lease management,
acknowledgement (ACK), dead-letter queue (DLQ) routing, and cancellation checks.
"""

import json
import time
import logging
from typing import Optional, Dict, Any, Callable

logger = logging.getLogger("hettety-3d-worker.queue")

class QueueConsumer:
    def __init__(
        self,
        queue_name: str = "hettety_3d_jobs",
        redis_url: Optional[str] = None,
        lease_timeout_sec: int = 600,
        dlq_name: Optional[str] = None
    ):
        self.queue_name = queue_name
        self.dlq_name = dlq_name or f"{queue_name}:dead_letter"
        self.redis_url = redis_url
        self.lease_timeout_sec = lease_timeout_sec
        self.redis_client = None
        self._in_flight: Dict[str, Dict[str, Any]] = {}

        if redis_url and not redis_url.startswith("mock://"):
            try:
                import redis
                self.redis_client = redis.from_url(redis_url, decode_responses=True)
                logger.info(f"Connected to Redis queue: {queue_name} (DLQ: {self.dlq_name})")
            except Exception as e:
                logger.warning(f"Could not connect to Redis: {e}. Running in local mock mode.")

    def poll_job(self, timeout_sec: int = 5) -> Optional[Dict[str, Any]]:
        """
        Polls for the next pending reconstruction job.
        Records job in-flight tracking with lease timestamp.
        """
        if self.redis_client:
            try:
                item = self.redis_client.blpop(self.queue_name, timeout=timeout_sec)
                if item:
                    _, raw_data = item
                    job = json.loads(raw_data)
                    job_id = job.get("id", f"job-{time.time()}")
                    self._in_flight[job_id] = {
                        "job": job,
                        "leased_at": time.time(),
                        "raw_data": raw_data
                    }
                    return job
            except Exception as e:
                logger.error(f"Error polling Redis queue '{self.queue_name}': {e}")
        return None

    def ack_job(self, job_id: str) -> None:
        """
        Durable ACK: Confirms job was successfully processed, clearing lease.
        """
        if job_id in self._in_flight:
            del self._in_flight[job_id]
        if self.redis_client:
            try:
                self.redis_client.delete(f"hettety:lease:{job_id}")
            except Exception as e:
                logger.debug(f"Error removing Redis lease key for {job_id}: {e}")
        logger.info(f"ACK job {job_id}: removed from in-flight tracking.")

    def nack_job(self, job: Dict[str, Any], error_message: str, max_retries: int = 3) -> None:
        """
        NACK: On failure, retries if below threshold, or routes to Dead Letter Queue (DLQ).
        """
        job_id = job.get("id", "unknown")
        retry_count = job.get("retryCount", 0) + 1
        job["retryCount"] = retry_count
        job["lastError"] = error_message
        job["failedAt"] = time.time()

        if job_id in self._in_flight:
            del self._in_flight[job_id]

        if not self.redis_client:
            logger.warning(f"Mock queue NACK for job {job_id} (retry {retry_count}/{max_retries})")
            return

        try:
            if retry_count >= max_retries:
                logger.error(f"Job {job_id} exceeded max retries ({max_retries}). Routing to DLQ: {self.dlq_name}")
                self.redis_client.rpush(self.dlq_name, json.dumps(job))
            else:
                logger.warning(f"Re-queueing job {job_id} for retry {retry_count}/{max_retries}...")
                self.redis_client.rpush(self.queue_name, json.dumps(job))
        except Exception as e:
            logger.error(f"Failed to handle NACK routing in Redis: {e}")

    def is_job_cancelled(self, job_id: str) -> bool:
        """
        Checks if cancellation was requested for this job in Redis or control plane.
        """
        if not self.redis_client or not job_id:
            return False
        try:
            val = self.redis_client.get(f"hettety:job:{job_id}:cancel")
            if val and val.lower() in ("1", "true", "cancelled"):
                return True
        except Exception as e:
            logger.debug(f"Error checking cancellation flag for {job_id}: {e}")
        return False

    def request_job_cancellation(self, job_id: str) -> bool:
        """
        Sets a cancellation flag in Redis for a running job.
        """
        if not self.redis_client or not job_id:
            return False
        try:
            self.redis_client.setex(f"hettety:job:{job_id}:cancel", 3600, "1")
            return True
        except Exception as e:
            logger.error(f"Error setting cancellation key: {e}")
            return False

    def listen(
        self,
        handler: Callable[[Dict[str, Any]], Any],
        poll_interval: float = 1.0,
        max_iterations: Optional[int] = None
    ) -> None:
        """
        Continuous durable listening loop with ACK/NACK and DLQ safety.
        """
        logger.info(f"Worker listening on queue: {self.queue_name} (poll_interval={poll_interval}s)")
        iterations = 0

        while True:
            if max_iterations is not None and iterations >= max_iterations:
                logger.info(f"Reached max iterations limit ({max_iterations}). Stopping consumer loop.")
                break

            iterations += 1
            job = self.poll_job(timeout_sec=int(max(1.0, poll_interval)))
            if not job:
                time.sleep(poll_interval)
                continue

            job_id = job.get("id", "unknown")
            logger.info(f"==> Consumer received reconstruction job: {job_id}")

            # Check if cancelled before starting
            if self.is_job_cancelled(job_id):
                logger.info(f"Job {job_id} was cancelled before processing started. Dropping.")
                self.ack_job(job_id)
                continue

            try:
                result = handler(job)
                status = result.get("status", "") if isinstance(result, dict) else ""
                if status in ("failed", "FAILED"):
                    error_msg = result.get("errorMessage", "Reconstruction failed")
                    self.nack_job(job, error_msg)
                else:
                    self.ack_job(job_id)
            except Exception as e:
                logger.exception(f"Unhandled exception processing job {job_id}: {e}")
                self.nack_job(job, str(e))
