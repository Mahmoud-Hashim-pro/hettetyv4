"""
HETTETY 3D GPU Worker — Structured JSON Logging & Observability
Provides production-grade JSON log formatting for log aggregators (Cloud Logging, Datadog, Elastic).
"""

import os
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

class StructuredJsonFormatter(logging.Formatter):
    """
    Formats Python logging records into structured JSON lines.
    Includes timestamps in ISO-8601 UTC, log severity, thread/process info,
    and optional contextual tracing fields (jobId, propertyId, attemptId, workerId).
    """

    def __init__(self, service_name: str = "hettety-3d-worker"):
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        log_entry: Dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "service": self.service_name,
            "logger": record.name,
            "message": record.getMessage(),
            "process": record.process,
            "thread": record.threadName,
        }

        # Include standard context fields if injected into record
        for field in ("job_id", "jobId", "property_id", "propertyId", "attempt_id", "attemptId", "worker_id", "workerId", "stage"):
            if hasattr(record, field):
                val = getattr(record, field)
                if val is not None:
                    log_entry[field] = val

        # Handle exception tracebacks cleanly
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry, default=str)


def setup_worker_logging(
    log_level: str = "INFO",
    force_json: Optional[bool] = None
) -> logging.Logger:
    """
    Configures the root/worker logger with either structured JSON or human-readable format.
    Defaults to JSON when HETTETY_LOG_FORMAT=json or NODE_ENV=production.
    """
    level = getattr(logging, log_level.upper(), logging.INFO)
    use_json = force_json
    if use_json is None:
        use_json = (
            os.environ.get("HETTETY_LOG_FORMAT", "").lower() == "json" or
            os.environ.get("NODE_ENV") == "production"
        )

    root_logger = logging.getLogger("hettety-3d-worker")
    root_logger.setLevel(level)

    # Avoid adding duplicate handlers if already configured
    if not root_logger.handlers:
        handler = logging.StreamHandler()
        if use_json:
            handler.setFormatter(StructuredJsonFormatter())
        else:
            handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"))
        root_logger.addHandler(handler)

    return root_logger
