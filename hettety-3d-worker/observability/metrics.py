"""
HETTETY 3D GPU Worker — Prometheus & Runtime Observability Metrics
Exposes real-time reconstruction telemetry:
  - Reconstruction duration (seconds)
  - Peak GPU VRAM usage (MB / Bytes)
  - Gaussian splat count
  - Camera registration ratio (registered / total)
  - Active reconstructions gauge
  - Total jobs counter (success, failed, cancelled)
Outputs standard Prometheus text format and structured JSON snapshots.
"""

import os
import time
import threading
from typing import Dict, Any, Optional, List

class WorkerMetrics:
    """
    Thread-safe Prometheus telemetry collector for the Hettety 3D GPU worker.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._active_jobs: int = 0
        self._total_jobs_success: int = 0
        self._total_jobs_failed: int = 0
        self._total_jobs_cancelled: int = 0

        # Latest gauge values
        self._latest_reconstruction_duration_sec: float = 0.0
        self._latest_peak_vram_mb: float = 0.0
        self._latest_splat_count: int = 0
        self._latest_registration_ratio: float = 0.0

        # Aggregated statistics
        self._duration_history: List[float] = []
        self._duration_sum_sec: float = 0.0
        self._failure_counters: Dict[str, int] = {}

    def get_peak_vram_mb(self) -> float:
        """
        Attempts to query current/peak GPU memory allocated via PyTorch CUDA.
        Falls back to platform memory metrics or 0.0 if CUDA is unavailable.
        """
        try:
            import torch
            if torch.cuda.is_available():
                # Returns peak memory in Megabytes
                return float(torch.cuda.max_memory_allocated() / (1024 * 1024))
        except Exception:
            pass

        # CPU fallback: process resident memory if available
        try:
            import resource
            return float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0)
        except Exception:
            pass

        return 0.0

    def record_job_start(self, job_id: str, property_id: str) -> None:
        with self._lock:
            self._active_jobs += 1

    def record_job_success(
        self,
        job_id: str,
        duration_sec: float,
        splat_count: int,
        registration_ratio: float,
        peak_vram_mb: Optional[float] = None
    ) -> None:
        with self._lock:
            self._active_jobs = max(0, self._active_jobs - 1)
            self._total_jobs_success += 1
            self._latest_reconstruction_duration_sec = max(0.0, float(duration_sec))
            self._latest_splat_count = max(0, int(splat_count))
            self._latest_registration_ratio = max(0.0, min(1.0, float(registration_ratio)))

            if peak_vram_mb is not None and peak_vram_mb > 0:
                self._latest_peak_vram_mb = float(peak_vram_mb)
            else:
                self._latest_peak_vram_mb = self.get_peak_vram_mb()

            self._duration_sum_sec += self._latest_reconstruction_duration_sec
            self._duration_history.append(self._latest_reconstruction_duration_sec)
            if len(self._duration_history) > 1000:
                self._duration_history.pop(0)

    def record_job_failure(
        self,
        job_id: str,
        error_code: str,
        duration_sec: float = 0.0
    ) -> None:
        with self._lock:
            self._active_jobs = max(0, self._active_jobs - 1)
            self._total_jobs_failed += 1
            code = error_code or "UNKNOWN"
            self._failure_counters[code] = self._failure_counters.get(code, 0) + 1

    def record_job_cancelled(
        self,
        job_id: str,
        duration_sec: float = 0.0
    ) -> None:
        with self._lock:
            self._active_jobs = max(0, self._active_jobs - 1)
            self._total_jobs_cancelled += 1

    def get_snapshot(self) -> Dict[str, Any]:
        """Returns JSON snapshot of worker telemetry."""
        with self._lock:
            total_completed = self._total_jobs_success
            avg_duration = (self._duration_sum_sec / total_completed) if total_completed > 0 else 0.0
            return {
                "activeJobs": self._active_jobs,
                "jobs": {
                    "success": self._total_jobs_success,
                    "failed": self._total_jobs_failed,
                    "cancelled": self._total_jobs_cancelled,
                    "total": self._total_jobs_success + self._total_jobs_failed + self._total_jobs_cancelled,
                },
                "metrics": {
                    "latestDurationSec": round(self._latest_reconstruction_duration_sec, 3),
                    "avgDurationSec": round(avg_duration, 3),
                    "latestPeakVramMb": round(self._latest_peak_vram_mb, 2),
                    "latestSplatCount": self._latest_splat_count,
                    "latestRegistrationRatio": round(self._latest_registration_ratio, 4),
                },
                "failureCounters": dict(self._failure_counters),
            }

    def format_prometheus(self) -> str:
        """
        Formats metrics into standard Prometheus exposition format:
        # HELP <metric_name> <docstring>
        # TYPE <metric_name> <type>
        <metric_name> <value>
        """
        with self._lock:
            lines = [
                "# HELP hettety_worker_active_reconstructions Number of currently running 3D reconstruction tasks",
                "# TYPE hettety_worker_active_reconstructions gauge",
                f"hettety_worker_active_reconstructions {self._active_jobs}",
                "",
                "# HELP hettety_worker_reconstruction_duration_seconds Reconstruction duration of the latest successful run in seconds",
                "# TYPE hettety_worker_reconstruction_duration_seconds gauge",
                f"hettety_worker_reconstruction_duration_seconds {self._latest_reconstruction_duration_sec:.3f}",
                "",
                "# HELP hettety_worker_reconstruction_duration_total_seconds Cumulative duration of all completed reconstructions",
                "# TYPE hettety_worker_reconstruction_duration_total_seconds counter",
                f"hettety_worker_reconstruction_duration_total_seconds {self._duration_sum_sec:.3f}",
                "",
                "# HELP hettety_worker_peak_vram_mb Peak GPU VRAM allocated during reconstruction in Megabytes",
                "# TYPE hettety_worker_peak_vram_mb gauge",
                f"hettety_worker_peak_vram_mb {self._latest_peak_vram_mb:.2f}",
                "",
                "# HELP hettety_worker_peak_vram_bytes Peak GPU VRAM allocated during reconstruction in Bytes",
                "# TYPE hettety_worker_peak_vram_bytes gauge",
                f"hettety_worker_peak_vram_bytes {int(self._latest_peak_vram_mb * 1024 * 1024)}",
                "",
                "# HELP hettety_worker_splat_count Number of 3D Gaussian splat primitives generated",
                "# TYPE hettety_worker_splat_count gauge",
                f"hettety_worker_splat_count {self._latest_splat_count}",
                "",
                "# HELP hettety_worker_registration_ratio Ratio of registered camera keyframes to total input images",
                "# TYPE hettety_worker_registration_ratio gauge",
                f"hettety_worker_registration_ratio {self._latest_registration_ratio:.4f}",
                "",
                "# HELP hettety_worker_jobs_total Total 3D reconstruction jobs processed by status",
                "# TYPE hettety_worker_jobs_total counter",
                f'hettety_worker_jobs_total{{status="success"}} {self._total_jobs_success}',
                f'hettety_worker_jobs_total{{status="failed"}} {self._total_jobs_failed}',
                f'hettety_worker_jobs_total{{status="cancelled"}} {self._total_jobs_cancelled}',
            ]

            if self._failure_counters:
                lines.append("")
                lines.append("# HELP hettety_worker_failure_total Total failures partitioned by error code")
                lines.append("# TYPE hettety_worker_failure_total counter")
                for err_code, count in self._failure_counters.items():
                    lines.append(f'hettety_worker_failure_total{{code="{err_code}"}} {count}')

            lines.append("")
            return "\n".join(lines)


# Global singleton instance
_GLOBAL_METRICS = WorkerMetrics()

def get_worker_metrics() -> WorkerMetrics:
    """Returns the singleton WorkerMetrics collector."""
    return _GLOBAL_METRICS
