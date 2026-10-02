"""
HETTETY 3D GPU Worker — Object Storage Client
Handles downloading raw input captures and uploading finished 3DGS/GLB assets.
"""

from .object_storage import ObjectStorageClient

__all__ = ["ObjectStorageClient"]
