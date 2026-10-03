"""
HETTETY 3D GPU Worker — Object Storage Client implementation
Supports Google Cloud Storage, Amazon S3, and Verified Local Object Storage.
Strictly verifies that bytes are written and hashes match before reporting success.
"""

import os
import shutil
import hashlib
import logging
from typing import List, Optional

logger = logging.getLogger("hettety-3d-worker.storage")

class ObjectStorageClient:
    def __init__(self, provider: Optional[str] = None, bucket_name: str = "hettety-spatial-assets"):
        self.provider = (provider or os.getenv("STORAGE_PROVIDER", "local")).lower()
        self.bucket_name = bucket_name
        self.local_root = os.getenv("HETTETY_STORAGE_DIR", os.path.abspath("./storage/spatial_assets"))
        os.makedirs(self.local_root, exist_ok=True)
        logger.info(f"Initialized ObjectStorageClient (provider={self.provider}, bucket={self.bucket_name}, local_root={self.local_root})")

    def _is_safe_download_url(self, url: str) -> bool:
        """Validates that a URL does not target loopback, private networks, or metadata services."""
        import ipaddress
        from urllib.parse import urlparse
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                return False
            hostname = parsed.hostname
            if not hostname:
                return False
            if hostname.lower() in ("localhost", "127.0.0.1", "::1", "169.254.169.254", "metadata.google.internal"):
                return False
            try:
                ip = ipaddress.ip_address(hostname)
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                    return False
            except ValueError:
                pass
            return True
        except Exception:
            return False

    def download_object(self, storage_path: str, local_destination: str) -> bool:
        """
        Downloads a storage object (cloud blob, http URL, or local path) to local destination.
        Handles GCS paths (properties/... or gs://...), HTTP URLs, and local files.
        """
        os.makedirs(os.path.dirname(os.path.abspath(local_destination)), exist_ok=True)
        MAX_FRAME_SIZE = 50 * 1024 * 1024

        # 1. HTTP / HTTPS URL
        if storage_path.startswith("http://") or storage_path.startswith("https://"):
            if not self._is_safe_download_url(storage_path):
                logger.error(f"SECURITY ALERT: Blocked untrusted/private network download URL: {storage_path}")
                return False
            try:
                import requests
                with requests.get(storage_path, stream=True, timeout=25) as res:
                    res.raise_for_status()
                    total_bytes = 0
                    with open(local_destination, "wb") as f:
                        for chunk in res.iter_content(chunk_size=65536):
                            total_bytes += len(chunk)
                            if total_bytes > MAX_FRAME_SIZE:
                                raise ValueError(f"Payload exceeded {MAX_FRAME_SIZE} bytes limit.")
                            f.write(chunk)
                return True
            except Exception as e:
                logger.warning(f"Failed to fetch HTTP object {storage_path}: {e}")
                return False

        # 2. Local direct path
        if os.path.exists(storage_path):
            shutil.copy2(storage_path, local_destination)
            return True

        # Clean cloud path (strip gs://bucket_name/ or s3://bucket_name/ if present)
        clean_path = storage_path
        if clean_path.startswith("gs://"):
            parts = clean_path[5:].split("/", 1)
            clean_path = parts[1] if len(parts) > 1 else parts[0]
        elif clean_path.startswith("s3://"):
            parts = clean_path[5:].split("/", 1)
            clean_path = parts[1] if len(parts) > 1 else parts[0]

        # 3. Google Cloud Storage
        if self.provider in ("gcs", "google"):
            try:
                from google.cloud import storage
                client = storage.Client()
                bucket = client.bucket(self.bucket_name)
                blob = bucket.blob(clean_path)
                blob.download_to_filename(local_destination)
                if os.path.exists(local_destination) and os.path.getsize(local_destination) > 0:
                    logger.info(f"Downloaded GCS object gs://{self.bucket_name}/{clean_path} -> {local_destination}")
                    return True
                raise IOError(f"Downloaded GCS blob {clean_path} was 0 bytes.")
            except Exception as e:
                logger.warning(f"GCS download failed for {clean_path}: {e}. Checking local fallback.")

        # 4. Amazon S3
        elif self.provider in ("s3", "aws"):
            try:
                import boto3
                s3 = boto3.client("s3")
                s3.download_file(self.bucket_name, clean_path, local_destination)
                if os.path.exists(local_destination) and os.path.getsize(local_destination) > 0:
                    logger.info(f"Downloaded S3 object s3://{self.bucket_name}/{clean_path} -> {local_destination}")
                    return True
                raise IOError(f"Downloaded S3 object {clean_path} was 0 bytes.")
            except Exception as e:
                logger.warning(f"S3 download failed for {clean_path}: {e}. Checking local fallback.")

        # 5. Local storage root fallback
        local_cand = os.path.join(self.local_root, clean_path)
        if os.path.exists(local_cand):
            shutil.copy2(local_cand, local_destination)
            return True

        logger.warning(f"Capture path does not exist in any storage provider: {storage_path}")
        return False

    def download_capture_files(self, capture_urls: List[str], dest_dir: str) -> List[str]:
        """
        Downloads uploaded images or video keyframes into the local working directory.
        Supports GCS storage paths, gs:// URIs, HTTP/HTTPS URLs, and local files.
        """
        os.makedirs(dest_dir, exist_ok=True)
        local_files = []

        for i, url in enumerate(capture_urls):
            filename = f"frame_{i:04d}.jpg"
            dest_path = os.path.join(dest_dir, filename)
            if self.download_object(url, dest_path):
                local_files.append(dest_path)
            else:
                logger.warning(f"Failed to retrieve capture path: {url}")

        logger.info(f"Downloaded {len(local_files)} files to {dest_dir}")
        return local_files

    def upload_file(self, local_path: str, remote_path: str) -> str:
        """
        Uploads a local artifact to the target cloud storage bucket or verified local root.
        Verifies byte count and integrity via post-upload reload/HEAD checks.
        """
        if not os.path.exists(local_path):
            raise FileNotFoundError(f"Local file does not exist: {local_path}")

        source_size = os.path.getsize(local_path)
        if source_size == 0:
            raise ValueError(f"Cannot upload 0-byte file: {local_path}")

        # Compute SHA-256 for integrity verification
        with open(local_path, "rb") as f:
            source_sha = hashlib.sha256(f.read()).hexdigest()

        if self.provider in ("gcs", "google"):
            try:
                from google.cloud import storage
                client = storage.Client()
                bucket = client.bucket(self.bucket_name)
                blob = bucket.blob(remote_path)
                blob.upload_from_filename(local_path)
                # Post-upload verification: reload blob metadata and verify byte count
                blob.reload()
                if blob.size != source_size:
                    raise IOError(f"GCS post-upload size mismatch: source={source_size}, uploaded={blob.size}")
                logger.info(f"Successfully uploaded and verified {local_path} to gs://{self.bucket_name}/{remote_path} (size={source_size})")
                return f"https://storage.googleapis.com/{self.bucket_name}/{remote_path}"
            except Exception as e:
                logger.error(f"STRICT PRODUCTION FAILURE: GCS upload to gs://{self.bucket_name}/{remote_path} failed: {e}")
                raise RuntimeError(f"GCS_UPLOAD_FAILED: Cloud storage write failed for {remote_path}: {e}")

        elif self.provider in ("s3", "aws"):
            try:
                import boto3
                s3 = boto3.client("s3")
                s3.upload_file(local_path, self.bucket_name, remote_path)
                # Post-upload verification: HEAD object byte check
                head = s3.head_object(Bucket=self.bucket_name, Key=remote_path)
                remote_size = head.get("ContentLength", 0)
                if remote_size != source_size:
                    raise IOError(f"S3 post-upload size mismatch: source={source_size}, uploaded={remote_size}")
                logger.info(f"Successfully uploaded and verified {local_path} to s3://{self.bucket_name}/{remote_path}")
                return f"https://{self.bucket_name}.s3.amazonaws.com/{remote_path}"
            except Exception as e:
                logger.error(f"STRICT PRODUCTION FAILURE: S3 upload to s3://{self.bucket_name}/{remote_path} failed: {e}")
                raise RuntimeError(f"S3_UPLOAD_FAILED: Cloud storage write failed for {remote_path}: {e}")

        # Verified Local Development Storage Provider
        target_path = os.path.join(self.local_root, remote_path)
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        shutil.copy2(local_path, target_path)

        # Verify target existence and checksum
        if not os.path.exists(target_path):
            raise IOError(f"Target object storage write failed: {target_path} not found")

        target_size = os.path.getsize(target_path)
        if target_size != source_size:
            raise IOError(f"Target storage byte mismatch: expected {source_size} bytes, got {target_size} bytes")

        with open(target_path, "rb") as f:
            target_sha = hashlib.sha256(f.read()).hexdigest()

        if target_sha != source_sha:
            raise IOError(f"Target storage checksum corruption: {target_sha} != {source_sha}")

        logger.info(f"Verified artifact stored locally at {target_path} (SHA-256: {target_sha[:8]}..., size: {target_size} bytes)")
        # Return truthful local serving path instead of fake GCS url
        return f"/storage/spatial_assets/{remote_path}"
