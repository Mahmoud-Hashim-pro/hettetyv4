"""
Unit tests for Worker Observability & Prometheus Metrics (Phase 17)
"""

import unittest
import json
import logging
from observability.metrics import WorkerMetrics
from observability.logger import StructuredJsonFormatter
from workers.reconstruction_worker import ReconstructionWorker

class TestWorkerObservability(unittest.TestCase):
    def setUp(self):
        self.metrics = WorkerMetrics()

    def test_job_lifecycle_telemetry_and_counters(self):
        # 1. Start job
        self.metrics.record_job_start("job_obs_1", "prop_1")
        snapshot = self.metrics.get_snapshot()
        self.assertEqual(snapshot["activeJobs"], 1)

        # 2. Complete job with metrics
        self.metrics.record_job_success(
            job_id="job_obs_1",
            duration_sec=14.52,
            splat_count=320000,
            registration_ratio=0.92,
            peak_vram_mb=4096.5
        )
        snapshot = self.metrics.get_snapshot()
        self.assertEqual(snapshot["activeJobs"], 0)
        self.assertEqual(snapshot["jobs"]["success"], 1)
        self.assertEqual(snapshot["metrics"]["latestDurationSec"], 14.52)
        self.assertEqual(snapshot["metrics"]["latestSplatCount"], 320000)
        self.assertEqual(snapshot["metrics"]["latestRegistrationRatio"], 0.92)
        self.assertEqual(snapshot["metrics"]["latestPeakVramMb"], 4096.5)

        # 3. Failure metrics
        self.metrics.record_job_failure("job_obs_2", "COLMAP_SFM_FAILED", duration_sec=5.2)
        snapshot = self.metrics.get_snapshot()
        self.assertEqual(snapshot["jobs"]["failed"], 1)
        self.assertEqual(snapshot["failureCounters"]["COLMAP_SFM_FAILED"], 1)

        # 4. Cancellation metrics
        self.metrics.record_job_cancelled("job_obs_3", duration_sec=2.1)
        snapshot = self.metrics.get_snapshot()
        self.assertEqual(snapshot["jobs"]["cancelled"], 1)
        self.assertEqual(snapshot["jobs"]["total"], 3)

    def test_prometheus_exposition_format(self):
        self.metrics.record_job_success(
            job_id="job_prom_1",
            duration_sec=12.345,
            splat_count=250000,
            registration_ratio=0.88,
            peak_vram_mb=3500.0
        )
        self.metrics.record_job_failure("job_prom_2", "QUALITY_GATE_REJECTED", duration_sec=4.0)

        prom_text = self.metrics.format_prometheus()
        self.assertIn("# HELP hettety_worker_reconstruction_duration_seconds", prom_text)
        self.assertIn("hettety_worker_reconstruction_duration_seconds 12.345", prom_text)
        self.assertIn("# HELP hettety_worker_peak_vram_mb", prom_text)
        self.assertIn("hettety_worker_peak_vram_mb 3500.00", prom_text)
        self.assertIn("hettety_worker_peak_vram_bytes 3670016000", prom_text)
        self.assertIn("# HELP hettety_worker_splat_count", prom_text)
        self.assertIn("hettety_worker_splat_count 250000", prom_text)
        self.assertIn("# HELP hettety_worker_registration_ratio", prom_text)
        self.assertIn("hettety_worker_registration_ratio 0.8800", prom_text)
        self.assertIn('hettety_worker_jobs_total{status="success"} 1', prom_text)
        self.assertIn('hettety_worker_jobs_total{status="failed"} 1', prom_text)
        self.assertIn('hettety_worker_failure_total{code="QUALITY_GATE_REJECTED"} 1', prom_text)

    def test_structured_json_logger(self):
        formatter = StructuredJsonFormatter(service_name="hettety-3d-worker")
        record = logging.LogRecord(
            name="hettety-3d-worker.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=42,
            msg="Reconstruction stage validated",
            args=(),
            exc_info=None
        )
        record.jobId = "test_job_123"
        record.propertyId = "test_prop_456"
        record.stage = "OPTIMIZING"

        formatted = formatter.format(record)
        parsed = json.loads(formatted)
        self.assertEqual(parsed["level"], "INFO")
        self.assertEqual(parsed["service"], "hettety-3d-worker")
        self.assertEqual(parsed["message"], "Reconstruction stage validated")
        self.assertEqual(parsed["jobId"], "test_job_123")
        self.assertEqual(parsed["propertyId"], "test_prop_456")
        self.assertEqual(parsed["stage"], "OPTIMIZING")
        self.assertIn("timestamp", parsed)

    def test_reconstruction_worker_metrics_methods(self):
        worker = ReconstructionWorker(work_dir="/tmp/test_obs_worker")
        metrics = worker.get_metrics()
        self.assertIn("activeJobs", metrics)
        self.assertIn("metrics", metrics)
        prom = worker.get_prometheus_metrics()
        self.assertIn("hettety_worker_active_reconstructions", prom)


if __name__ == "__main__":
    unittest.main()
