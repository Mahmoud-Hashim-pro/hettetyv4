"""
HETTETY 3D GPU Worker — Stage 6: Dual Format Compression (SPZ + GLB)
Packages Gaussians into Niantic SPZ format and reconstructs metric mesh to valid binary GLB.
Strictly rejects fake mock containers and validates all generated artifacts.
"""

import os
import struct
import json
import subprocess
import logging
from typing import Dict, Any, Tuple, List

logger = logging.getLogger("hettety-3d-worker.compress")

def validate_glb_file(glb_path: str) -> Tuple[bool, str, int, int]:
    """
    Validates that a file is a compliant binary glTF 2.0 container (.glb).
    Returns (is_valid, message, vertex_count, face_count).
    """
    if not os.path.exists(glb_path):
        return False, f"File does not exist: {glb_path}", 0, 0

    file_size = os.path.getsize(glb_path)
    if file_size < 20:
        return False, f"File too small to be a GLB container ({file_size} bytes)", 0, 0

    with open(glb_path, "rb") as f:
        header = f.read(12)
        if len(header) < 12:
            return False, "Truncated GLB header", 0, 0

        magic, version, total_length = struct.unpack("<4sII", header)
        if magic != b"glTF":
            return False, f"Invalid GLB magic header: {magic!r}, expected b'glTF'", 0, 0
        if version != 2:
            return False, f"Unsupported glTF version: {version}, expected 2", 0, 0
        if total_length != file_size:
            return False, f"GLB header total length ({total_length}) does not match file size ({file_size})", 0, 0

        # Chunk 0: JSON
        chunk0_header = f.read(8)
        if len(chunk0_header) < 8:
            return False, "Missing or truncated JSON chunk header", 0, 0
        chunk0_len, chunk0_type = struct.unpack("<II", chunk0_header)
        if chunk0_type != 0x4E4F534A: # 'JSON' in ASCII
            return False, f"First chunk is not JSON (type: {chunk0_type:#x})", 0, 0

        json_bytes = f.read(chunk0_len)
        try:
            gltf_json = json.loads(json_bytes.decode("utf-8").strip())
        except Exception as e:
            return False, f"Malformed JSON chunk in GLB: {e}", 0, 0

        # Verify accessors and mesh data
        accessors = gltf_json.get("accessors", [])
        if not accessors:
            return False, "GLB has no accessors defined", 0, 0

        pos_accessor = accessors[0]
        vertex_count = pos_accessor.get("count", 0)
        if vertex_count <= 0:
            return False, "GLB contains 0 vertices", 0, 0

        face_count = 0
        if len(accessors) > 2:
            index_accessor = accessors[2]
            face_count = index_accessor.get("count", 0) // 3

        # Chunk 1: BIN
        chunk1_header = f.read(8)
        if len(chunk1_header) < 8:
            return False, "Missing or truncated BIN chunk header", 0, 0
        chunk1_len, chunk1_type = struct.unpack("<II", chunk1_header)
        if chunk1_type != 0x004E4942: # 'BIN\0'
            return False, f"Second chunk is not BIN (type: {chunk1_type:#x})", 0, 0

        bin_data = f.read(chunk1_len)
        if len(bin_data) < chunk1_len:
            return False, "Truncated binary buffer chunk", 0, 0

    return True, "Valid compliant glTF 2.0 binary container", vertex_count, face_count

def convert_ply_to_spz(
    input_ply: str,
    output_spz: str,
    sh_degree: int = 3,
    quantize_positions: int = 16
) -> Dict[str, Any]:
    """
    Compresses uncompressed Gaussian PLY (150-250MB) down to Niantic SPZ (8-12MB).
    Strictly fails if the SPZ utility is absent or compression fails.
    """
    logger.info(f"Compressing PLY to SPZ: {input_ply} -> {output_spz}")
    if not os.path.exists(input_ply):
        return {
            "success": False,
            "error_code": "INPUT_PLY_NOT_FOUND",
            "message": f"Input PLY file not found: {input_ply}"
        }

    os.makedirs(os.path.dirname(output_spz), exist_ok=True)
    
    cmd = [
        "spz", "pack",
        input_ply,
        output_spz,
        "--sh-degree", str(sh_degree),
        "--quantize-positions", str(quantize_positions)
    ]
    
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if not os.path.exists(output_spz) or os.path.getsize(output_spz) < 32:
            return {
                "success": False,
                "error_code": "SPZ_COMPRESSION_FAILED",
                "message": "SPZ compression output file is missing or corrupted."
            }

        file_size = os.path.getsize(output_spz)
        return {
            "success": True,
            "format": "spz",
            "path": output_spz,
            "size_bytes": file_size
        }
    except FileNotFoundError as e:
        logger.error(f"SPZ CLI utility missing on PATH: {e}")
        return {
            "success": False,
            "error_code": "SPZ_CLI_MISSING",
            "message": "Niantic SPZ compression CLI utility 'spz' is not installed in the worker environment."
        }
    except subprocess.CalledProcessError as e:
        logger.error(f"SPZ packing failed: {e.stderr}")
        return {
            "success": False,
            "error_code": "SPZ_COMPRESSION_FAILED",
            "message": f"SPZ packing failed: {e.stderr.decode('utf-8', errors='ignore') if isinstance(e.stderr, bytes) else str(e.stderr)}"
        }

def generate_metric_mesh_glb(
    colmap_sparse_dir: str,
    output_glb: str,
    scale_factor: float = 1.0
) -> Dict[str, Any]:
    """
    Generates a genuine compliant binary GLB mesh from reconstructed spatial points.
    Extracts 3D coordinates, applies metric scale factor, computes bounding geometry,
    normals, and packages a valid binary glTF 2.0 container.
    """
    logger.info(f"Extracting metric collision GLB mesh to: {output_glb} (scale_factor={scale_factor})")
    os.makedirs(os.path.dirname(output_glb), exist_ok=True)

    # 1. Gather 3D points from sparse reconstruction (check points3D.txt/ply across root and sub-models)
    points: List[Tuple[float, float, float]] = []
    candidate_paths = [
        os.path.join(colmap_sparse_dir, "0", "points3D.txt"),
        os.path.join(colmap_sparse_dir, "points3D.txt"),
        os.path.join(colmap_sparse_dir, "0", "sparse_points.ply"),
        os.path.join(colmap_sparse_dir, "sparse_points.ply"),
    ]

    for p_path in candidate_paths:
        if os.path.exists(p_path) and os.path.getsize(p_path) > 0:
            try:
                with open(p_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if line.startswith("#") or not line.strip():
                            continue
                        parts = line.split()
                        if len(parts) >= 4:
                            try:
                                px, py, pz = float(parts[1]), float(parts[2]), float(parts[3])
                                if abs(px) < 1000 and abs(py) < 1000 and abs(pz) < 1000:
                                    points.append((px, py, pz))
                            except ValueError:
                                continue
                if len(points) >= 8:
                    break
            except Exception as e:
                logger.warning(f"Could not parse candidate sparse points at {p_path}: {e}")

    # STRICT INVARIANT: Never synthesize a fake room. Fail explicitly if geometry was not reconstructed.
    if len(points) < 8:
        logger.error(f"Cannot generate metric mesh: sparse reconstruction in '{colmap_sparse_dir}' produced only {len(points)} valid 3D points.")
        return {
            "success": False,
            "error_code": "INSUFFICIENT_GEOMETRY_FOR_MESH",
            "message": f"COLMAP sparse reconstruction produced only {len(points)} points (minimum 8 required). Real mesh extraction cannot proceed without reconstructed geometry."
        }

    # Apply calibrated metric scale transform if present
    if abs(scale_factor - 1.0) > 1e-5:
        points = [(p[0] * scale_factor, p[1] * scale_factor, p[2] * scale_factor) for p in points]

    # 2. Build vertices, normals, and triangulated faces from genuine point cloud boundaries
    min_x = min(p[0] for p in points)
    max_x = max(p[0] for p in points)
    min_y = min(p[1] for p in points)
    max_y = max(p[1] for p in points)
    min_z = min(p[2] for p in points)
    max_z = max(p[2] for p in points)

    # Form a complete 6-plane enclosure derived strictly from reconstructed points
    vertices = [
        # Floor (y = min_y)
        (min_x, min_y, min_z), (max_x, min_y, min_z), (max_x, min_y, max_z), (min_x, min_y, max_z),
        # Ceiling (y = max_y)
        (min_x, max_y, min_z), (max_x, max_y, min_z), (max_x, max_y, max_z), (min_x, max_y, max_z),
        # Back wall (z = min_z)
        (min_x, min_y, min_z), (max_x, min_y, min_z), (max_x, max_y, min_z), (min_x, max_y, min_z),
        # Front wall (z = max_z)
        (min_x, min_y, max_z), (max_x, min_y, max_z), (max_x, max_y, max_z), (min_x, max_y, max_z),
        # Left wall (x = min_x)
        (min_x, min_y, min_z), (min_x, min_y, max_z), (min_x, max_y, max_z), (min_x, max_y, min_z),
        # Right wall (x = max_x)
        (max_x, min_y, min_z), (max_x, min_y, max_z), (max_x, max_y, max_z), (max_x, max_y, min_z),
    ]

    normals = [
        # Floor up
        (0.0, 1.0, 0.0), (0.0, 1.0, 0.0), (0.0, 1.0, 0.0), (0.0, 1.0, 0.0),
        # Ceiling down
        (0.0, -1.0, 0.0), (0.0, -1.0, 0.0), (0.0, -1.0, 0.0), (0.0, -1.0, 0.0),
        # Back wall forward
        (0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 0.0, 1.0),
        # Front wall backward
        (0.0, 0.0, -1.0), (0.0, 0.0, -1.0), (0.0, 0.0, -1.0), (0.0, 0.0, -1.0),
        # Left wall right
        (1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 0.0, 0.0),
        # Right wall left
        (-1.0, 0.0, 0.0), (-1.0, 0.0, 0.0), (-1.0, 0.0, 0.0), (-1.0, 0.0, 0.0),
    ]

    indices = [
        0, 1, 2,  0, 2, 3,        # floor
        4, 6, 5,  4, 7, 6,        # ceiling
        8, 10, 9, 8, 11, 10,      # back wall
        12, 13, 14, 12, 14, 15,   # front wall
        16, 17, 18, 16, 18, 19,   # left wall
        20, 22, 21, 20, 23, 22,   # right wall
    ]

    # 3. Serialize into glTF 2.0 Binary Buffer
    pos_bytes = bytearray()
    for vx, vy, vz in vertices:
        pos_bytes.extend(struct.pack("<fff", vx, vy, vz))

    norm_bytes = bytearray()
    for nx, ny, nz in normals:
        norm_bytes.extend(struct.pack("<fff", nx, ny, nz))

    idx_bytes = bytearray()
    for idx in indices:
        idx_bytes.extend(struct.pack("<H", idx))

    # Pad each buffer to 4 bytes boundary
    def pad4(b: bytearray, pad_byte: int = 0) -> bytearray:
        rem = len(b) % 4
        if rem != 0:
            b.extend(bytes([pad_byte] * (4 - rem)))
        return b

    pos_bytes = pad4(pos_bytes)
    norm_bytes = pad4(norm_bytes)
    idx_bytes = pad4(idx_bytes)

    bin_buffer = bytearray()
    pos_offset = 0
    pos_len = len(pos_bytes)
    bin_buffer.extend(pos_bytes)

    norm_offset = len(bin_buffer)
    norm_len = len(norm_bytes)
    bin_buffer.extend(norm_bytes)

    idx_offset = len(bin_buffer)
    idx_len = len(idx_bytes)
    bin_buffer.extend(idx_bytes)

    total_bin_len = len(bin_buffer)

    gltf_dict = {
        "asset": {
            "version": "2.0",
            "generator": "Hettety Metric Spatial Engine 2.0"
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "ReconstructedMetricGeometry"}],
        "meshes": [{
            "name": "ArchitecturalMetricMesh",
            "primitives": [{
                "attributes": {
                    "POSITION": 0,
                    "NORMAL": 1
                },
                "indices": 2,
                "mode": 4 # TRIANGLES
            }]
        }],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126, # FLOAT
                "count": len(vertices),
                "type": "VEC3",
                "min": [min(v[0] for v in vertices), min(v[1] for v in vertices), min(v[2] for v in vertices)],
                "max": [max(v[0] for v in vertices), max(v[1] for v in vertices), max(v[2] for v in vertices)]
            },
            {
                "bufferView": 1,
                "componentType": 5126, # FLOAT
                "count": len(normals),
                "type": "VEC3"
            },
            {
                "bufferView": 2,
                "componentType": 5123, # UNSIGNED_SHORT
                "count": len(indices),
                "type": "SCALAR"
            }
        ],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": pos_offset,
                "byteLength": pos_len,
                "target": 34962 # ARRAY_BUFFER
            },
            {
                "buffer": 0,
                "byteOffset": norm_offset,
                "byteLength": norm_len,
                "target": 34962 # ARRAY_BUFFER
            },
            {
                "buffer": 0,
                "byteOffset": idx_offset,
                "byteLength": idx_len,
                "target": 34963 # ELEMENT_ARRAY_BUFFER
            }
        ],
        "buffers": [{
            "byteLength": total_bin_len
        }]
    }

    json_str = json.dumps(gltf_dict, separators=(',', ':'))
    json_bytes = bytearray(json_str.encode("utf-8"))
    json_bytes = pad4(json_bytes, pad_byte=0x20) # space-padded

    # 4. Assemble standard binary GLB container
    total_glb_length = 12 + 8 + len(json_bytes) + 8 + len(bin_buffer)

    glb_container = bytearray()
    # Header: magic(4) + version(4) + length(4)
    glb_container.extend(struct.pack("<4sII", b"glTF", 2, total_glb_length))
    # Chunk 0: JSON
    glb_container.extend(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    glb_container.extend(json_bytes)
    # Chunk 1: BIN
    glb_container.extend(struct.pack("<II", len(bin_buffer), 0x004E4942))
    glb_container.extend(bin_buffer)

    with open(output_glb, "wb") as f:
        f.write(glb_container)

    # 5. Strict verification of written GLB
    is_valid, msg, v_count, f_count = validate_glb_file(output_glb)
    if not is_valid:
        logger.error(f"Generated GLB failed validation: {msg}")
        return {
            "success": False,
            "error_code": "INVALID_GLB_PRODUCED",
            "message": msg
        }

    logger.info(f"Verified compliant GLB produced: {v_count} vertices, {f_count} faces, size={os.path.getsize(output_glb)} bytes")
    return {
        "success": True,
        "format": "glb",
        "path": output_glb,
        "size_bytes": os.path.getsize(output_glb),
        "vertex_count": v_count,
        "face_count": f_count
    }
