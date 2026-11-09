"""
HETTETY 3D GPU Worker — Managed Subprocess & Cancellation Engine
Provides process tree tracking, cancellation polling, and atomic process killing
across Windows and Linux platforms (COLMAP, PatchMatch, StereoFusion, 3DGS).
"""

import os
import sys
import time
import signal
import logging
import subprocess
import threading
from typing import List, Optional, Callable, Dict, Any, Set

logger = logging.getLogger("hettety-3d-worker.process_manager")

class JobCancelledException(Exception):
    """Raised when a managed subprocess is terminated due to an explicit cancellation signal."""
    pass

_PROCESS_LOCK = threading.Lock()
ACTIVE_PROCESSES: Set[subprocess.Popen] = set()

def register_process(proc: subprocess.Popen) -> None:
    with _PROCESS_LOCK:
        ACTIVE_PROCESSES.add(proc)
        logger.debug(f"Registered managed subprocess PID {proc.pid} (Total active: {len(ACTIVE_PROCESSES)})")

def unregister_process(proc: subprocess.Popen) -> None:
    with _PROCESS_LOCK:
        ACTIVE_PROCESSES.discard(proc)
        logger.debug(f"Unregistered managed subprocess PID {proc.pid} (Total active: {len(ACTIVE_PROCESSES)})")

def kill_process_tree(pid: int) -> None:
    """
    Terminates a process and all its child/grandchild processes across Windows and POSIX.
    Ensures Docker, COLMAP, and multi-threaded Python/CUDA child workers are not orphaned.
    """
    if os.name == "nt":
        # Windows: taskkill with /T (tree) and /F (force)
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False
            )
            logger.info(f"taskkill /F /T /PID {pid} executed successfully.")
        except Exception as e:
            logger.debug(f"taskkill error for PID {pid}: {e}")
    else:
        # Unix/Linux: process group kill or SIGKILL
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except Exception:
            try:
                os.kill(pid, signal.SIGKILL)
            except Exception as e:
                logger.debug(f"POSIX kill error for PID {pid}: {e}")

def terminate_all_active_processes() -> None:
    """
    Kills all tracked processes immediately and releases CUDA GPU memory.
    """
    with _PROCESS_LOCK:
        procs = list(ACTIVE_PROCESSES)
        ACTIVE_PROCESSES.clear()

    for p in procs:
        try:
            if p.poll() is None:
                logger.warning(f"Terminating managed subprocess PID {p.pid}...")
                kill_process_tree(p.pid)
                try:
                    p.wait(timeout=2)
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Error terminating PID {p.pid}: {e}")

    # Clear PyTorch GPU allocations if available
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            logger.info("Cleared torch.cuda cache following process termination.")
    except Exception:
        pass

def run_managed_process(
    cmd: List[str],
    check: bool = True,
    cancel_check: Optional[Callable[[], bool]] = None,
    timeout: Optional[float] = None,
    env: Optional[Dict[str, str]] = None,
    poll_interval: float = 0.2,
    log_path: Optional[str] = None,
    log_mode: str = "a"
) -> subprocess.CompletedProcess:
    """
    Executes a subprocess with continuous cancellation monitoring and process-tree termination.
    Persists full stdout and stderr to log_path if provided (even on error, timeout, or cancellation).
    Raises JobCancelledException if cancel_check() evaluates to True during execution.
    """
    start_time = time.time()
    logger.info(f"Executing managed subprocess: {' '.join(cmd[:6])}...")

    # On Windows, creationflags=0; on POSIX, start_new_session=True to enable process-group signaling
    kwargs: Dict[str, Any] = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "env": env or os.environ.copy()
    }
    if os.name != "nt":
        kwargs["start_new_session"] = True

    proc = subprocess.Popen(cmd, **kwargs)
    register_process(proc)

    stdout: Optional[bytes] = None
    stderr: Optional[bytes] = None

    def _persist_log():
        if not log_path:
            return
        try:
            os.makedirs(os.path.dirname(os.path.abspath(log_path)), exist_ok=True)
            with open(log_path, log_mode, encoding="utf-8", errors="replace") as f:
                f.write(f"\n=== MANAGED SUBPROCESS: {' '.join(cmd)} (PID: {proc.pid}) ===\n")
                if stdout:
                    f.write("--- STDOUT ---\n")
                    f.write(stdout.decode("utf-8", errors="replace"))
                    if not stdout.endswith(b"\n"):
                        f.write("\n")
                if stderr:
                    f.write("--- STDERR ---\n")
                    f.write(stderr.decode("utf-8", errors="replace"))
                    if not stderr.endswith(b"\n"):
                        f.write("\n")
                exit_str = proc.returncode if proc.returncode is not None else "KILLED"
                f.write(f"=== EXIT CODE: {exit_str} ===\n")
        except Exception as ex:
            logger.warning(f"Failed writing process output log to '{log_path}': {ex}")

    try:
        while True:
            # 1. Check cancellation signal
            if cancel_check and cancel_check():
                logger.warning(f"Cancellation signal received during execution of PID {proc.pid}! Killing process tree...")
                kill_process_tree(proc.pid)
                try:
                    stdout, stderr = proc.communicate(timeout=2)
                except Exception:
                    pass
                _persist_log()
                raise JobCancelledException(f"Subprocess (PID {proc.pid}) was terminated due to job cancellation.")

            # 2. Check timeout
            if timeout and (time.time() - start_time) > timeout:
                logger.error(f"Subprocess PID {proc.pid} exceeded timeout limit of {timeout}s! Killing...")
                kill_process_tree(proc.pid)
                try:
                    stdout, stderr = proc.communicate(timeout=2)
                except Exception:
                    pass
                _persist_log()
                raise subprocess.TimeoutExpired(cmd, timeout)

            # 3. Read output chunks with timeout without blocking pipe buffer
            try:
                stdout, stderr = proc.communicate(timeout=poll_interval)
                break
            except subprocess.TimeoutExpired:
                continue

        _persist_log()

        if check and proc.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="ignore") if stderr else ""
            out_msg = stdout.decode("utf-8", errors="ignore") if stdout else ""
            logger.error(f"Managed process exited with code {proc.returncode}: {err_msg[:500]}")
            raise subprocess.CalledProcessError(proc.returncode, cmd, output=stdout, stderr=stderr)

        return subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)

    finally:
        unregister_process(proc)
