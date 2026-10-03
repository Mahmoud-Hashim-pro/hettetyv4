"""
HETTETY 3D GPU Worker — Queue Consumer
Pulls reconstruction jobs from Redis queue with durable lease management,
acknowledgement (ACK), dead-letter queue (DLQ) routing, and cancellation checks.
"""

import os
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
        dlq_name: Optional[str] = None,
        worker_id: Optional[str] = None
    ):
        self.queue_name = queue_name
        self.stream_name = f"{queue_name}:stream"
        self.group_name = "hettety_workers"
        self.worker_id = worker_id or os.getenv("HETTETY_WORKER_ID", f"worker_{time.time()}")
        self.dlq_name = dlq_name or f"{queue_name}:dead_letter"
        self.redis_url = redis_url
        self.lease_timeout_sec = lease_timeout_sec
        self.redis_client = None
        self.use_streams = False
        self._in_flight: Dict[str, Dict[str, Any]] = {}

        if redis_url and not redis_url.startswith("mock://"):
            try:
                import redis
                self.redis_client = redis.from_url(redis_url, decode_responses=True)
                logger.info(f"Connected to Redis queue: {queue_name} (Stream: {self.stream_name}, DLQ: {self.dlq_name})")
                # Attempt to create consumer group for Redis Streams
                try:
                    self.redis_client.xgroup_create(self.stream_name, self.group_name, id="0", mkstream=True)
                    self.use_streams = True
                    logger.info(f"Initialized Redis Stream consumer group: {self.group_name}")
                except Exception as stream_err:
                    if "BUSYGROUP" in str(stream_err):
                        self.use_streams = True
                    else:
                        logger.debug(f"Redis Streams not active or unavailable: {stream_err}. Falling back to list queue.")
            except Exception as e:
                logger.warning(f"Could not connect to Redis: {e}. Running in local mock mode.")

    def poll_job(self, timeout_sec: int = 5) -> Optional[Dict[str, Any]]:
        """
        Polls for the next pending reconstruction job.
        Prioritizes Redis Streams with durable consumer groups and pending recovery.
        Falls back to BLPOP list queue.
        """
        if self.redis_client:
            # 1. Redis Streams path (Durable with Pending Entries List)
            if self.use_streams:
                try:
                    # Auto-claim abandoned/crashed messages older than lease_timeout_sec
                    if hasattr(self.redis_client, "xautoclaim"):
                        try:
                            claimed = self.redis_client.xautoclaim(
                                self.stream_name, self.group_name, self.worker_id,
                                min_idle_time=int(self.lease_timeout_sec * 1000),
                                start_id="0-0", count=1
                            )
                            if claimed and len(claimed) >= 2 and claimed[1]:
                                msg_id, fields = claimed[1][0]
                                payload_str = fields.get("payload") or fields.get("job")
                                if payload_str:
                                    job = json.loads(payload_str)
                                    job_id = job.get("id", f"job-{time.time()}")

                                    # Check if active lease is held by another worker (prevent concurrent stealing)
                                    lease_holder = self.redis_client.get(f"hettety:lease:{job_id}")
                                    if lease_holder and lease_holder != self.worker_id:
                                        logger.info(f"Skipping XAUTOCLAIM for job {job_id}: active lease held by {lease_holder}")
                                        # Revert message back to lease_holder's PEL immediately to prevent message theft
                                        try:
                                            self.redis_client.xclaim(
                                                self.stream_name, self.group_name, lease_holder,
                                                min_idle_time=0, message_ids=[msg_id], justid=True
                                            )
                                        except Exception as rev_err:
                                            logger.debug(f"Failed to revert stream message to {lease_holder}: {rev_err}")
                                    else:
                                        self._in_flight[job_id] = {
                                            "job": job,
                                            "leased_at": time.time(),
                                            "stream": True,
                                            "stream_msg_id": msg_id
                                        }
                                        self.heartbeat(job_id)
                                        logger.info(f"Re-claimed pending job {job_id} from stream (msg {msg_id})")
                                        return job
                        except Exception as claim_err:
                            logger.debug(f"xautoclaim note: {claim_err}")

                    # Read new stream messages
                    entries = self.redis_client.xreadgroup(
                        self.group_name, self.worker_id,
                        {self.stream_name: ">"},
                        count=1,
                        block=timeout_sec * 1000
                    )
                    if entries and entries[0][1]:
                        msg_id, fields = entries[0][1][0]
                        payload_str = fields.get("payload") or fields.get("job")
                        if payload_str:
                            job = json.loads(payload_str)
                            job_id = job.get("id", f"job-{time.time()}")
                            self._in_flight[job_id] = {
                                "job": job,
                                "leased_at": time.time(),
                                "stream": True,
                                "stream_msg_id": msg_id
                            }
                            self.heartbeat(job_id)
                            return job
                    return None
                except Exception as e:
                    logger.debug(f"Error reading from Redis Stream: {e}")
                    return None
            else:
                # 2. Redis List BLPOP path ONLY when streams are unavailable
                try:
                    item = self.redis_client.blpop(self.queue_name, timeout=timeout_sec)
                    if item:
                        _, raw_data = item
                        job = json.loads(raw_data)
                        job_id = job.get("id", f"job-{time.time()}")
                        self._in_flight[job_id] = {
                            "job": job,
                            "leased_at": time.time(),
                            "raw_data": raw_data,
                            "stream": False
                        }
                        return job
                except Exception as e:
                    logger.error(f"Error polling Redis queue '{self.queue_name}': {e}")
        return None

    def heartbeat(self, job_id: str) -> bool:
        """
        Extends the lease of an actively processing job in Redis to prevent XAUTOCLAIM theft.
        1. Refreshes the Redis key lease: hettety:lease:{job_id} with TTL.
        2. Touches the Redis Stream message in PEL using XCLAIM to reset its idle time to 0.
        """
        if not job_id:
            return False

        flight = self._in_flight.get(job_id)
        if flight:
            flight["last_heartbeat_at"] = time.time()

        if not self.redis_client:
            return True

        success = True
        try:
            # 1. Refresh key lease
            lease_ttl = max(60, int(self.lease_timeout_sec))
            self.redis_client.set(f"hettety:lease:{job_id}", self.worker_id, ex=lease_ttl)
        except Exception as e:
            logger.debug(f"Error updating Redis lease key for {job_id}: {e}")
            success = False

        # 2. Reset Stream PEL idle time via XCLAIM (min-idle-time 0 with justid=True)
        if flight and flight.get("stream"):
            msg_id = flight.get("stream_msg_id")
            if msg_id and hasattr(self.redis_client, "xclaim"):
                try:
                    self.redis_client.xclaim(
                        self.stream_name,
                        self.group_name,
                        self.worker_id,
                        min_idle_time=0,
                        message_ids=[msg_id],
                        justid=True
                    )
                except Exception as ex:
                    logger.debug(f"Error refreshing stream message idle time for {job_id}: {ex}")

        return success

    def ack_job(self, job_id: str) -> None:
        """
        Durable ACK: Confirms job was successfully processed, clearing lease and stream message.
        """
        flight = self._in_flight.get(job_id)
        if flight:
            del self._in_flight[job_id]
            if self.redis_client and flight.get("stream"):
                msg_id = flight.get("stream_msg_id")
                try:
                    self.redis_client.xack(self.stream_name, self.group_name, msg_id)
                    self.redis_client.xdel(self.stream_name, msg_id)
                except Exception as ex:
                    logger.debug(f"Error acknowledging stream msg {msg_id}: {ex}")

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

        flight = self._in_flight.get(job_id)
        if job_id in self._in_flight:
            del self._in_flight[job_id]

        if not self.redis_client:
            logger.warning(f"Mock queue NACK for job {job_id} (retry {retry_count}/{max_retries})")
            return

        try:
            if retry_count >= max_retries:
                logger.error(f"Job {job_id} exceeded max retries ({max_retries}). Routing to DLQ: {self.dlq_name}")
                if self.use_streams:
                    try:
                        self.redis_client.xadd(f"{self.stream_name}:dead_letter", "*", {"payload": json.dumps(job)})
                        if flight and flight.get("stream"):
                            self.redis_client.xack(self.stream_name, self.group_name, flight.get("stream_msg_id"))
                            self.redis_client.xdel(self.stream_name, flight.get("stream_msg_id"))
                    except Exception as stream_nack_err:
                        logger.debug(f"Stream DLQ note: {stream_nack_err}")
                else:
                    self.redis_client.rpush(self.dlq_name, json.dumps(job))
            else:
                logger.warning(f"Re-queueing job {job_id} for retry {retry_count}/{max_retries}...")
                if self.use_streams:
                    try:
                        self.redis_client.xadd(self.stream_name, "*", {
                            "jobId": job_id,
                            "attemptId": job.get("attemptId", "attempt_1"),
                            "payload": json.dumps(job),
                            "enqueuedAt": str(int(time.time() * 1000)),
                        })
                        if flight and flight.get("stream"):
                            self.redis_client.xack(self.stream_name, self.group_name, flight.get("stream_msg_id"))
                            self.redis_client.xdel(self.stream_name, flight.get("stream_msg_id"))
                    except Exception as stream_retry_err:
                        logger.debug(f"Stream retry re-enqueue note: {stream_retry_err}")
                else:
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
