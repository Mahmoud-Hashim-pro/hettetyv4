"""The worker's trust boundaries: its own credential, its own workspace, and
the one environment allowed to publish without dense geometry.

Each test here fails against the code as it stood before these were written.
"""

import os
import unittest

from workers.reconstruction_worker import (
    ReconstructionWorker,
    resolve_worker_secret,
    resolve_control_plane_url,
    safe_job_workspace,
    dense_failure_is_tolerated,
)


class EnvSandbox(unittest.TestCase):
    """Restores every environment variable these tests touch."""

    KEYS = ("NODE_ENV", "HETTETY_ENV", "WORKER_SHARED_SECRET", "HETTETY_CONTROL_PLANE_URL")

    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in self.KEYS}
        for k in self.KEYS:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class TestWorkerSecret(EnvSandbox):
    def test_job_payload_cannot_supply_the_credential(self):
        # The job arrives over the queue. If it can hand the worker the secret
        # the worker then authenticates with, writing a job mints a credential.
        os.environ["WORKER_SHARED_SECRET"] = "the-real-secret"
        got = resolve_worker_secret({"apiKey": "attacker-chosen"})
        self.assertEqual(got, "the-real-secret")

    def test_production_refuses_to_run_without_a_configured_secret(self):
        os.environ["NODE_ENV"] = "production"
        with self.assertRaises(RuntimeError) as ctx:
            resolve_worker_secret({})
        self.assertIn("WORKER_SHARED_SECRET", str(ctx.exception))

    def test_no_literal_credential_reaches_production(self):
        os.environ["NODE_ENV"] = "production"
        os.environ["WORKER_SHARED_SECRET"] = "configured"
        self.assertEqual(resolve_worker_secret({"apiKey": "x"}), "configured")

    def test_development_still_has_a_usable_default(self):
        # Dev parity with the control plane, which keeps the same fallback.
        self.assertEqual(resolve_worker_secret({}), "hettety-worker-secret-internal")


class TestControlPlaneUrl(EnvSandbox):
    def test_production_refuses_to_default_to_a_mock_callback(self):
        # Nothing in the control plane sets callbackUrl and the env var was
        # configured nowhere, so the default silently became mock://callback.
        os.environ["NODE_ENV"] = "production"
        with self.assertRaises(RuntimeError) as ctx:
            resolve_control_plane_url({})
        self.assertIn("HETTETY_CONTROL_PLANE_URL", str(ctx.exception))

    def test_uses_the_configured_url_when_present(self):
        os.environ["NODE_ENV"] = "production"
        os.environ["HETTETY_CONTROL_PLANE_URL"] = "https://hettety.example/api/reconstruction"
        self.assertEqual(
            resolve_control_plane_url({}),
            "https://hettety.example/api/reconstruction",
        )

    def test_development_may_still_use_a_mock_callback(self):
        self.assertTrue(resolve_control_plane_url({}).startswith("mock://"))

    def test_the_job_cannot_choose_where_the_credential_is_sent(self):
        # The worker POSTs "Authorization: Bearer <shared secret>" to this URL
        # from progress, heartbeat, failure and publish. A job that could name
        # the address could collect the secret and then act as the worker.
        os.environ["HETTETY_CONTROL_PLANE_URL"] = "https://hettety.example/api/reconstruction"
        got = resolve_control_plane_url({"callbackUrl": "https://attacker.example/collect"})
        self.assertEqual(got, "https://hettety.example/api/reconstruction")

    def test_a_job_supplied_url_is_ignored_even_with_nothing_configured(self):
        got = resolve_control_plane_url({"callbackUrl": "https://attacker.example/collect"})
        self.assertTrue(got.startswith("mock://"))


class TestDenseFailureTolerance(EnvSandbox):
    def test_a_mock_callback_alone_never_excuses_missing_dense_geometry(self):
        # This was the whole bug: the skip keyed on the callback URL, which
        # defaulted to mock://, so a dense failure fell through to publish.
        self.assertFalse(dense_failure_is_tolerated("mock://callback"))

    def test_only_an_explicit_test_environment_tolerates_it(self):
        os.environ["HETTETY_ENV"] = "test"
        self.assertTrue(dense_failure_is_tolerated("mock://callback"))

    def test_production_tolerates_it_under_no_circumstances(self):
        os.environ["NODE_ENV"] = "production"
        os.environ["HETTETY_ENV"] = "test"
        self.assertFalse(dense_failure_is_tolerated("mock://callback"))


class TestWorkspaceIsolation(EnvSandbox):
    def setUp(self):
        super().setUp()
        import tempfile
        self.root = tempfile.mkdtemp(prefix="hettety_ws_")

    def test_accepts_an_ordinary_job_id(self):
        path = safe_job_workspace(self.root, "job_abc-123")
        self.assertTrue(path.startswith(os.path.realpath(self.root)))

    def test_refuses_a_job_id_that_climbs_out_of_the_workspace(self):
        for bad in ("../escape", "../../etc", "a/../../b", "/absolute", "..\\windows"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    safe_job_workspace(self.root, bad)

    def test_refuses_separators_and_empty_ids(self):
        for bad in ("", None, "with/slash", "with\\backslash", "with space", "nul\x00byte"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    safe_job_workspace(self.root, bad)

    def test_refuses_an_absurdly_long_id(self):
        with self.assertRaises(ValueError):
            safe_job_workspace(self.root, "a" * 300)


class TestStartupRefusal(EnvSandbox):
    """A misconfigured worker must not start.

    Refusing per job raises before the fail() closure exists, so no FAILED
    callback can be sent, and the exception escapes into the consumer, which
    nacks and dead-letters after three attempts. That turns a missing
    environment variable into the quiet destruction of every queued job.
    """

    def _work_dir(self):
        import tempfile
        return tempfile.mkdtemp(prefix="hettety_boot_")

    def test_worker_constructs_in_development(self):
        self.assertIsNotNone(ReconstructionWorker(work_dir=self._work_dir()))

    def test_production_without_a_secret_refuses_to_construct(self):
        os.environ["NODE_ENV"] = "production"
        os.environ["HETTETY_CONTROL_PLANE_URL"] = "https://hettety.example/api/reconstruction"
        with self.assertRaises(RuntimeError) as ctx:
            ReconstructionWorker(work_dir=self._work_dir())
        self.assertIn("WORKER_SHARED_SECRET", str(ctx.exception))

    def test_production_without_a_control_plane_refuses_to_construct(self):
        os.environ["NODE_ENV"] = "production"
        os.environ["WORKER_SHARED_SECRET"] = "configured"
        with self.assertRaises(RuntimeError) as ctx:
            ReconstructionWorker(work_dir=self._work_dir())
        self.assertIn("HETTETY_CONTROL_PLANE_URL", str(ctx.exception))

    def test_a_fully_configured_production_worker_starts(self):
        # The deployment README documents: this must not be the broken one.
        os.environ["NODE_ENV"] = "production"
        os.environ["WORKER_SHARED_SECRET"] = "configured"
        os.environ["HETTETY_CONTROL_PLANE_URL"] = "https://hettety.example/api/reconstruction"
        self.assertIsNotNone(ReconstructionWorker(work_dir=self._work_dir()))


class TestShippedImageDeclaresProduction(unittest.TestCase):
    def test_dockerfile_sets_node_env(self):
        # Every guard keys on this. Without it the container took the
        # development branch and fell back to a published default secret.
        import io, os as _os
        here = _os.path.dirname(_os.path.abspath(__file__))
        dockerfile = _os.path.join(here, "..", "Dockerfile")
        content = io.open(dockerfile, encoding="utf-8").read()
        self.assertIn("ENV NODE_ENV=production", content)


if __name__ == "__main__":
    unittest.main()
