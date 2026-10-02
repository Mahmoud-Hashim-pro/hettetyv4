"""
HETTETY 3D GPU Worker — Queue Consumer
Pulls reconstruction jobs from Redis / RabbitMQ queue and manages worker concurrency.
"""

import json
import time
import logging
from typing import Optional, Dict, Any, Callable

logger = logging.getLogger("hettety-3d-worker.queue")

class QueueConsumer:
    def __init__(self, queue_name: str = "hettety:3d:reconstruction", redis_url: Optional[str] = None):
        self.queue_name = queue_name
        self.redis_url = redis_url
        self.redis_client = None

        if redis_url and not redis_url.startswith("mock://"):
            try:
                import redis
                self.redis_client = redis.from_url(redis_url)
                logger.info(f"Connected to Redis queue: {queue_name}")
            except Exception as e:
                logger.warning(f"Could not connect to Redis: {e}. Running in local mock mode.")

    def poll_job(self, timeout_sec: int = 5) -> Optional[Dict[str, Any]]:
        """
        Polls for the next pending reconstruction job.
        """
        if self.redis_client:
            try:
                item = self.redis_client.blpop(self.queue_name, timeout=timeout_sec)
                if item:
                    _, raw_data = item
                    return json.loads(raw_data)
            except Exception as e:
                logger.error(f"Error polling Redis: {e}")
        return None

    def listen(self, handler: Callable[[Dict[str, Any]], None], poll_interval: float = 1.0):
        """
        Continuous listening loop.
        """
        logger.info(f"Worker listening on queue: {self.queue_name}")
        while True:
            job = self.poll_job(timeout_sec=int(poll_interval))
            if job:
                logger.info(f"Received reconstruction job: {job.get('id', 'unknown')}")
                handler(job)
            else:
                time.sleep(poll_interval)
