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
        meshes = gltf_json.get("meshes", [])
        if meshes and "primitives" in meshes[0] and meshes[0]["primitives"]:
            idx_accessor_id = meshes[0]["primitives"][0].get("indices")
            if idx_accessor_id is not None and idx_accessor_id < len(accessors):
                face_count = accessors[idx_accessor_id].get("count", 0) // 3
        if face_count == 0 and len(accessors) > 2:
            face_count = accessors[-1].get("count", 0) // 3

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
    Generates a genuine compliant binary GLB surface mesh from reconstructed spatial points.
    Applies 3D Alpha-Shape / Concave Hull triangulation on real reconstructed points,
    calculates physical surface normals, applies calibrated metric scaling, and produces
    a compliant glTF 2.0 binary container.
    STRICTLY NON-SYNTHETIC: Vertices are direct reconstructed points, not a bounding box cuboid.
    """
    logger.info(f"Extracting true metric surface GLB mesh to: {output_glb} (scale_factor={scale_factor})")
    os.makedirs(os.path.dirname(output_glb), exist_ok=True)

    # 1. Gather 3D points prioritizing dense stereo reconstruction (fused.ply), then sparse SfM
    points: List[Tuple[float, float, float]] = []
    candidate_paths = [
        os.path.join(colmap_sparse_dir, "dense", "fused.ply"),
        os.path.join(colmap_sparse_dir, "fused.ply"),
        os.path.join(colmap_sparse_dir, "..", "dense", "fused.ply"),
        os.path.join(colmap_sparse_dir, "..", "sfm", "dense", "fused.ply"),
        os.path.join(colmap_sparse_dir, "0", "points3D.txt"),
        os.path.join(colmap_sparse_dir, "points3D.txt"),
        os.path.join(colmap_sparse_dir, "0", "sparse_points.ply"),
        os.path.join(colmap_sparse_dir, "sparse_points.ply"),
    ]

    def _read_ply_points(p_path: str) -> List[Tuple[float, float, float]]:
        p_pts = []
        try:
            with open(p_path, "rb") as f:
                header_bytes = f.read(4096)
            header_text = header_bytes.decode("ascii", errors="ignore")
            header_end = -1
            for i in range(len(header_bytes) - 10):
                if header_bytes[i:i+10] == b"end_header":
                    header_end = i + 10
                    if i + 11 < len(header_bytes) and header_bytes[i+10] in (10, 13):
                        header_end += 1
                    if i + 12 < len(header_bytes) and header_bytes[i+11] in (10, 13):
                        header_end += 1
                    break

            import re
            m = re.search(r"element vertex (\d+)", header_text)
            v_count = int(m.group(1)) if m else 0
            if v_count <= 0:
                return p_pts

            props = []
            for line in header_text[:header_end].splitlines():
                line = line.strip()
                if line.startswith("property "):
                    parts = line.split()
                    if len(parts) >= 3:
                        props.append((parts[1], parts[2]))

            x_off, y_off, z_off = -1, -1, -1
            curr_off = 0
            for p_type, p_name in props:
                p_size = 4 if p_type in ("float", "float32", "int", "uint", "int32", "uint32") else (8 if p_type in ("double", "float64") else 1)
                if p_name == "x": x_off = curr_off
                elif p_name == "y": y_off = curr_off
                elif p_name == "z": z_off = curr_off
                curr_off += p_size
            stride = curr_off

            is_binary = "format binary_little_endian" in header_text
            with open(p_path, "rb") as f:
                f.seek(header_end if header_end != -1 else 0)
                subsample = max(1, v_count // 15000)
                if is_binary and stride > 0 and x_off != -1:
                    for idx in range(v_count):
                        chunk = f.read(stride)
                        if len(chunk) < stride: break
                        if idx % subsample == 0:
                            px = struct.unpack_from("<f", chunk, x_off)[0]
                            py = struct.unpack_from("<f", chunk, y_off)[0]
                            pz = struct.unpack_from("<f", chunk, z_off)[0]
                            if abs(px) < 1000 and abs(py) < 1000 and abs(pz) < 1000:
                                p_pts.append((px, py, pz))
                else:
                    idx = 0
                    for line in f:
                        line_str = line.decode("ascii", errors="ignore").strip()
                        if not line_str or line_str.startswith("#"): continue
                        parts = line_str.split()
                        if len(parts) >= 3 and idx % subsample == 0:
                            try:
                                px, py, pz = float(parts[0]), float(parts[1]), float(parts[2])
                                if abs(px) < 1000 and abs(py) < 1000 and abs(pz) < 1000:
                                    p_pts.append((px, py, pz))
                            except ValueError:
                                pass
                        idx += 1
        except Exception as e:
            logger.warning(f"Failed to read points from {p_path}: {e}")
        return p_pts

    for p_path in candidate_paths:
        if os.path.exists(p_path) and os.path.getsize(p_path) > 0:
            if p_path.endswith(".ply"):
                pts = _read_ply_points(p_path)
                if len(pts) >= 8:
                    points = pts
                    logger.info(f"Loaded {len(points)} reconstructed 3D points from {p_path}")
                    break
            else:
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
                        logger.info(f"Loaded {len(points)} reconstructed 3D points from {p_path}")
                        break
                except Exception as e:
                    logger.warning(f"Could not parse candidate points at {p_path}: {e}")

    # STRICT INVARIANT: Never synthesize a fake room. Fail explicitly if geometry was not reconstructed.
    if len(points) < 8:
        logger.error(f"Cannot generate metric mesh: reconstruction in '{colmap_sparse_dir}' produced only {len(points)} valid 3D points.")
        return {
            "success": False,
            "error_code": "INSUFFICIENT_GEOMETRY_FOR_MESH",
            "message": f"COLMAP reconstruction produced only {len(points)} points (minimum 8 required). Real mesh extraction cannot proceed without reconstructed geometry."
        }

    # Apply calibrated metric scale transform if present
    if abs(scale_factor - 1.0) > 1e-5:
        points = [(p[0] * scale_factor, p[1] * scale_factor, p[2] * scale_factor) for p in points]

    # 2. Genuine Surface Reconstruction via 3D Alpha Shape / Concave Hull
    import numpy as np
    from scipy.spatial import Delaunay, distance
    from collections import Counter

    pts_arr = np.array(points, dtype=np.float32)
    # Remove duplicates
    unique_pts = np.unique(pts_arr, axis=0)

    if len(unique_pts) < 4:
        return {
            "success": False,
            "error_code": "DEGENERATE_POINT_CLOUD",
            "message": "Reconstructed points are coplanar or degenerate (<4 unique spatial coordinates)."
        }

    boundary_triangles = []
    try:
        tri = Delaunay(unique_pts, qhull_options="QJ")
        sample_subset = unique_pts[:min(len(unique_pts), 500)]
        dists = distance.pdist(sample_subset)
        med_dist = float(np.median(dists)) if len(dists) > 0 else 1.0

        tetra_pts = unique_pts[tri.simplices] # (N, 4, 3)
        A = tetra_pts[:, 0]
        B = tetra_pts[:, 1]
        C = tetra_pts[:, 2]
        D = tetra_pts[:, 3]

        a = A - D
        b = B - D
        c = C - D

        b_cross_c = np.cross(b, c)
        c_cross_a = np.cross(c, a)
        a_cross_b = np.cross(a, b)

        det = 2.0 * np.abs(np.einsum('ij,ij->i', a, b_cross_c))
        valid_det = det > 1e-6

        a_sq = np.sum(a*a, axis=1, keepdims=True)
        b_sq = np.sum(b*b, axis=1, keepdims=True)
        c_sq = np.sum(c*c, axis=1, keepdims=True)

        num = a_sq * b_cross_c + b_sq * c_cross_a + c_sq * a_cross_b
        R = np.full(len(tri.simplices), np.inf)
        R[valid_det] = np.linalg.norm(num[valid_det], axis=1) / det[valid_det]

        # Multi-scale alpha candidate search to preserve tightest non-convex boundary
        valid_R = R[valid_det]
        if len(valid_R) > 0:
            for alpha_mult in [1.5, 2.5, 3.5, 5.0, 8.0]:
                alpha = max(med_dist * alpha_mult, 0.8)
                valid_tetra = np.where(R <= alpha)[0]
                if len(valid_tetra) == 0:
                    continue
                faces = []
                for s_idx in valid_tetra:
                    s = tri.simplices[s_idx]
                    for i in range(4):
                        faces.append(tuple(sorted([int(s[j]) for j in range(4) if j != i])))
                counts = Counter(faces)
                candidates = [f for f, cnt in counts.items() if cnt == 1]
                if len(candidates) >= 4:
                    boundary_triangles = candidates
                    break

    except Exception as alpha_err:
        logger.warning(f"Alpha shape surface extraction note: {alpha_err}")

    # STRICT INVARIANT: Never fall back to ConvexHull. It destroys non-convex room topology.
    if len(boundary_triangles) < 4:
        logger.error(f"Cannot generate metric mesh: Alpha shape produced {len(boundary_triangles)} boundary triangles. Convex hull fallback is prohibited.")
        return {
            "success": False,
            "error_code": "INSUFFICIENT_GEOMETRY_FOR_MESH",
            "message": f"Surface alpha-shape reconstruction failed to extract valid boundary triangles ({len(boundary_triangles)} found). Convex hull fallback is prohibited to prevent architectural distortion."
        }

    # Re-orient triangles outward from point cloud centroid
    centroid = np.mean(unique_pts, axis=0)
    oriented_triangles = []
    for tri_indices in boundary_triangles:
        i0, i1, i2 = tri_indices
        v0, v1, v2 = unique_pts[i0], unique_pts[i1], unique_pts[i2]
        tri_center = (v0 + v1 + v2) / 3.0
        face_normal = np.cross(v1 - v0, v2 - v0)
        norm_len = np.linalg.norm(face_normal)
        if norm_len > 1e-6:
            face_normal = face_normal / norm_len
            # Outward check: dot product with (tri_center - centroid) should be positive
            if np.dot(tri_center - centroid, face_normal) < 0:
                oriented_triangles.append((i0, i2, i1)) # flip winding
            else:
                oriented_triangles.append((i0, i1, i2))
        else:
            oriented_triangles.append((i0, i1, i2))

    # Map referenced vertices
    used_indices = sorted(list(set(idx for t in oriented_triangles for idx in t)))
    old_to_new = {old_idx: new_idx for new_idx, old_idx in enumerate(used_indices)}
    mesh_vertices = [tuple(float(x) for x in unique_pts[idx]) for idx in used_indices]
    mesh_indices = [old_to_new[idx] for t in oriented_triangles for idx in t]

    # Compute smoothed vertex normals
    vertex_normals = np.zeros((len(mesh_vertices), 3), dtype=np.float32)
    for i in range(0, len(mesh_indices), 3):
        i0, i1, i2 = mesh_indices[i], mesh_indices[i+1], mesh_indices[i+2]
        v0 = np.array(mesh_vertices[i0])
        v1 = np.array(mesh_vertices[i1])
        v2 = np.array(mesh_vertices[i2])
        fn = np.cross(v1 - v0, v2 - v0)
        vertex_normals[i0] += fn
        vertex_normals[i1] += fn
        vertex_normals[i2] += fn

    norm_lengths = np.linalg.norm(vertex_normals, axis=1, keepdims=True)
    norm_lengths[norm_lengths < 1e-6] = 1.0
    vertex_normals = vertex_normals / norm_lengths
    normals_list = [tuple(float(x) for x in n) for n in vertex_normals]

    # 3. Serialize into glTF 2.0 Binary Buffer
    pos_bytes = bytearray()
    for vx, vy, vz in mesh_vertices:
        pos_bytes.extend(struct.pack("<fff", vx, vy, vz))

    norm_bytes = bytearray()
    for nx, ny, nz in normals_list:
        norm_bytes.extend(struct.pack("<fff", nx, ny, nz))

    use_short_indices = len(mesh_vertices) < 65535
    idx_bytes = bytearray()
    if use_short_indices:
        for idx in mesh_indices:
            idx_bytes.extend(struct.pack("<H", idx))
    else:
        for idx in mesh_indices:
            idx_bytes.extend(struct.pack("<I", idx))

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
            "generator": "Hettety Metric Surface Reconstruction Engine 2.0"
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "ReconstructedSurfaceGeometry"}],
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
                "count": len(mesh_vertices),
                "type": "VEC3",
                "min": [min(v[0] for v in mesh_vertices), min(v[1] for v in mesh_vertices), min(v[2] for v in mesh_vertices)],
                "max": [max(v[0] for v in mesh_vertices), max(v[1] for v in mesh_vertices), max(v[2] for v in mesh_vertices)]
            },
            {
                "bufferView": 1,
                "componentType": 5126, # FLOAT
                "count": len(normals_list),
                "type": "VEC3"
            },
            {
                "bufferView": 2,
                "componentType": 5123 if use_short_indices else 5125, # UNSIGNED_SHORT or UNSIGNED_INT
                "count": len(mesh_indices),
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
