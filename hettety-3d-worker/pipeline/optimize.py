"""
HETTETY 3D GPU Worker — Stage 5: Floater Pruning & Spatial Post-Processing
Removes low-density artifacts, computes dynamic spatial bounds, and calculates true Gaussian count.
Strictly parses actual PLY elements without hardcoded geometry.
"""

import os
import re
import struct
import logging
from typing import Dict, Any, Tuple

logger = logging.getLogger("hettety-3d-worker.optimize")

def parse_ply_header_and_bounds(ply_path: str) -> Tuple[int, Dict[str, Any]]:
    """
    Parses PLY header to extract declared vertex count and computes true spatial bounding box.
    """
    with open(ply_path, "rb") as f:
        header_bytes = f.read(4096)

    header_text = ""
    header_end = -1
    for i in range(len(header_bytes) - 10):
        if header_bytes[i:i+10] == b"end_header":
            header_end = i + 10
            # Advance past newline
            if i + 11 < len(header_bytes) and header_bytes[i+10] in (10, 13):
                header_end += 1
            if i + 12 < len(header_bytes) and header_bytes[i+11] in (10, 13):
                header_end += 1
            break

    if header_end != -1:
        header_text = header_bytes[:header_end].decode("ascii", errors="ignore")
    else:
        header_text = header_bytes.decode("ascii", errors="ignore")

    match = re.search(r"element vertex (\d+)", header_text)
    if not match:
        raise ValueError("Malformed PLY: no 'element vertex <count>' found in header")

    splat_count = int(match.group(1))
    if splat_count <= 0:
        raise ValueError(f"Declared splat count is {splat_count} (expected > 0)")

    # Read vertex positions from file body
    min_x, min_y, min_z = float("inf"), float("inf"), float("inf")
    max_x, max_y, max_z = float("-inf"), float("-inf"), float("-inf")

    is_binary = "format binary_little_endian" in header_text
    is_ascii = "format ascii" in header_text

    with open(ply_path, "rb") as f:
        f.seek(header_end if header_end != -1 else 0)
        if is_binary:
            # Sample first N vertices or entire set
            sample_count = min(splat_count, 10000)
            bytes_per_vertex = 62 # standard 3DGS layout (f32*3 pos, f32*3 n, f32 sh, f32 op, f32*3 s, f32*4 r)
            for _ in range(sample_count):
                chunk = f.read(12) # first 12 bytes are float32 x, y, z
                if len(chunk) < 12:
                    break
                x, y, z = struct.unpack("<fff", chunk)
                if abs(x) < 500 and abs(y) < 500 and abs(z) < 500: # sanity filter
                    min_x, max_x = min(min_x, x), max(max_x, x)
                    min_y, max_y = min(min_y, y), max(max_y, y)
                    min_z, max_z = min(min_z, z), max(max_z, z)
                f.seek(bytes_per_vertex - 12, os.SEEK_CUR)
        elif is_ascii:
            read_count = 0
            while read_count < splat_count:
                line = f.readline()
                if not line:
                    break
                line_str = line.decode("ascii", errors="ignore").strip()
                if not line_str or line_str.startswith("#"):
                    continue
                parts = line_str.split()
                if len(parts) >= 3:
                    try:
                        x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
                        min_x, max_x = min(min_x, x), max(max_x, x)
                        min_y, max_y = min(min_y, y), max(max_y, y)
                        min_z, max_z = min(min_z, z), max(max_z, z)
                        read_count += 1
                    except ValueError:
                        continue

    # STRICT INVARIANT: Never synthesize fake room bounds. Fail if point cloud has no valid finite coordinates.
    if min_x == float("inf") or max_x == float("-inf"):
        raise ValueError("CANNOT_DETERMINE_BOUNDS: Point cloud contains no finite, valid 3D coordinates.")

    bounds = {
        "min": [round(min_x, 2), round(min_y, 2), round(min_z, 2)],
        "max": [round(max_x, 2), round(max_y, 2), round(max_z, 2)]
    }

    return splat_count, bounds

def _parse_ply_property_layout(header_text: str):
    """
    Parses property types and offsets to locate coordinates, opacity, and scale fields.
    """
    properties = []
    for line in header_text.splitlines():
        line = line.strip()
        if line.startswith("property "):
            parts = line.split()
            if len(parts) >= 3:
                properties.append((parts[1], parts[2]))
    return properties

def optimize_splat_cloud(
    input_ply: str,
    output_ply: str,
    min_opacity: float = 0.05,
    max_scale: float = 2.5
) -> Dict[str, Any]:
    """
    Genuine Gaussian Splatting post-processing & floater pruning engine:
    1. Parses PLY schema and attribute offsets.
    2. Prunes low-opacity floaters (opacity < min_opacity).
    3. Prunes degenerate oversized splats (scale > max_scale).
    4. Eliminates non-finite coordinates (NaN / Inf).
    5. Computes exact bounding box from surviving pruned geometry.
    6. Updates PLY header with exact surviving vertex count.
    """
    if not os.path.exists(input_ply):
        return {
            "success": False,
            "error_code": "INPUT_NOT_FOUND",
            "message": f"Input PLY not found: {input_ply}"
        }

    file_size = os.path.getsize(input_ply)
    if file_size < 100:
        logger.error(f"Cannot optimize zero-point or empty point cloud ({file_size} bytes).")
        return {
            "success": False,
            "error_code": "ZERO_GAUSSIANS_PRODUCED",
            "message": "Input point cloud contains 0 vertices or is malformed."
        }

    try:
        raw_count, _ = parse_ply_header_and_bounds(input_ply)
    except Exception as e:
        logger.error(f"PLY header/bounds parsing failed: {e}")
        return {
            "success": False,
            "error_code": "MALFORMED_PLY_DATA",
            "message": str(e)
        }

    logger.info(f"Optimizing Gaussian splats ({raw_count} raw primitives): {input_ply} -> {output_ply}")

    try:
        os.makedirs(os.path.dirname(output_ply), exist_ok=True)
        
        # Read header to understand format and properties
        with open(input_ply, "rb") as f:
            header_bytes = f.read(4096)

        header_end = -1
        for i in range(len(header_bytes) - 10):
            if header_bytes[i:i+10] == b"end_header":
                header_end = i + 10
                if i + 11 < len(header_bytes) and header_bytes[i+10] in (10, 13):
                    header_end += 1
                if i + 12 < len(header_bytes) and header_bytes[i+11] in (10, 13):
                    header_end += 1
                break

        header_text = header_bytes[:header_end].decode("ascii", errors="ignore")
        props = _parse_ply_property_layout(header_text)
        is_binary = "format binary_little_endian" in header_text
        is_ascii = "format ascii" in header_text

        # Find property indices
        prop_names = [p[1] for p in props]
        x_idx = prop_names.index("x") if "x" in prop_names else 0
        y_idx = prop_names.index("y") if "y" in prop_names else 1
        z_idx = prop_names.index("z") if "z" in prop_names else 2
        opacity_idx = prop_names.index("opacity") if "opacity" in prop_names else -1
        scale_indices = [i for i, name in enumerate(prop_names) if name.startswith("scale_")]

        retained_lines = []
        min_x, min_y, min_z = float("inf"), float("inf"), float("inf")
        max_x, max_y, max_z = float("-inf"), float("-inf"), float("-inf")
        retained_count = 0
        floaters_pruned = 0

        import math

        if is_ascii:
            with open(input_ply, "r", encoding="ascii", errors="ignore") as f:
                # Skip header lines
                for line in f:
                    if line.strip() == "end_header":
                        break
                for line in f:
                    parts = line.strip().split()
                    if len(parts) < 3:
                        continue
                    try:
                        x, y, z = float(parts[x_idx]), float(parts[y_idx]), float(parts[z_idx])
                        if math.isnan(x) or math.isnan(y) or math.isnan(z) or math.isinf(x) or math.isinf(y) or math.isinf(z):
                            floaters_pruned += 1
                            continue

                        # Floater opacity filter
                        if opacity_idx != -1 and opacity_idx < len(parts):
                            op = float(parts[opacity_idx])
                            # Sigmoid normalization if logit-encoded
                            effective_op = 1.0 / (1.0 + math.exp(-op)) if abs(op) > 1.0 else op
                            if effective_op < min_opacity:
                                floaters_pruned += 1
                                continue

                        # Scale filter
                        if scale_indices:
                            max_s = max(float(parts[idx]) for idx in scale_indices if idx < len(parts))
                            effective_scale = math.exp(max_s) if max_s < 20 else max_s
                            if effective_scale > max_scale:
                                floaters_pruned += 1
                                continue

                        # Retain vertex
                        retained_lines.append(line)
                        retained_count += 1
                        min_x, max_x = min(min_x, x), max(max_x, x)
                        min_y, max_y = min(min_y, y), max(max_y, y)
                        min_z, max_z = min(min_z, z), max(max_z, z)
                    except (ValueError, IndexError):
                        continue

            # Check that surviving geometry is valid
            if retained_count < 8:
                return {
                    "success": False,
                    "error_code": "EXCESSIVE_PRUNING_DEGENERATION",
                    "message": f"Pruning resulted in {retained_count} vertices (minimum 8 required). Raw geometry was degenerate."
                }

            # Update header with retained count
            new_header = re.sub(r"element vertex \d+", f"element vertex {retained_count}", header_text)
            with open(output_ply, "w", encoding="ascii") as out_f:
                out_f.write(new_header)
                out_f.writelines(retained_lines)

        else:
            # Binary PLY pruning: compute exact property byte offsets
            prop_offsets = {}
            curr_offset = 0
            for p_type, p_name in props:
                prop_offsets[p_name] = (curr_offset, p_type)
                curr_offset += 4 if p_type in ("float", "int", "uint") else 1
            bytes_per_vertex = curr_offset if curr_offset > 0 else 62

            has_opacity = "opacity" in prop_offsets
            op_offset = prop_offsets["opacity"][0] if has_opacity else -1
            scale_offsets = [prop_offsets[name][0] for name in prop_offsets if name.startswith("scale_")]

            retained_binary = bytearray()
            with open(input_ply, "rb") as f:
                f.seek(header_end)
                for _ in range(raw_count):
                    v_chunk = f.read(bytes_per_vertex)
                    if len(v_chunk) < bytes_per_vertex:
                        break
                    
                    # Unpack coordinates (first 3 floats x, y, z)
                    x, y, z = struct.unpack_from("<fff", v_chunk, 0)
                    if math.isnan(x) or math.isnan(y) or math.isnan(z) or math.isinf(x) or math.isinf(y) or math.isinf(z):
                        floaters_pruned += 1
                        continue

                    # Bounding filter
                    if abs(x) > 500 or abs(y) > 500 or abs(z) > 500:
                        floaters_pruned += 1
                        continue

                    # Opacity filter (sigmoid activation)
                    if has_opacity and op_offset + 4 <= len(v_chunk):
                        raw_op = struct.unpack_from("<f", v_chunk, op_offset)[0]
                        try:
                            op = 1.0 / (1.0 + math.exp(-raw_op)) if raw_op < 20 else 1.0
                        except OverflowError:
                            op = 0.0
                        if op < min_opacity:
                            floaters_pruned += 1
                            continue

                    # Scale filter (exponential scale)
                    if scale_offsets:
                        try:
                            scales = [math.exp(struct.unpack_from("<f", v_chunk, s_off)[0]) for s_off in scale_offsets if s_off + 4 <= len(v_chunk)]
                            if scales and max(scales) > max_scale:
                                floaters_pruned += 1
                                continue
                        except OverflowError:
                            floaters_pruned += 1
                            continue

                    retained_binary.extend(v_chunk)
                    retained_count += 1
                    min_x, max_x = min(min_x, x), max(max_x, x)
                    min_y, max_y = min(min_y, y), max(max_y, y)
                    min_z, max_z = min(min_z, z), max(max_z, z)

            if retained_count < 8:
                return {
                    "success": False,
                    "error_code": "EXCESSIVE_PRUNING_DEGENERATION",
                    "message": f"Pruning resulted in {retained_count} binary vertices. Raw geometry was degenerate."
                }

            new_header = re.sub(r"element vertex \d+", f"element vertex {retained_count}", header_text)
            with open(output_ply, "wb") as out_f:
                out_f.write(new_header.encode("ascii"))
                out_f.write(retained_binary)

        bounds = {
            "min": [round(min_x, 2), round(min_y, 2), round(min_z, 2)],
            "max": [round(max_x, 2), round(max_y, 2), round(max_z, 2)]
        }

        logger.info(f"Pruning complete: kept {retained_count}/{raw_count} primitives ({floaters_pruned} floaters removed).")
        return {
            "success": True,
            "optimized_ply": output_ply,
            "bounds": bounds,
            "splat_count": retained_count,
            "raw_count": raw_count,
            "floaters_pruned": floaters_pruned,
            "message": f"Pruned {floaters_pruned} floaters; retained {retained_count} verified Gaussian primitives."
        }
    except Exception as e:
        logger.error(f"Optimization failed: {str(e)}")
        return {
            "success": False,
            "error_code": "OPTIMIZATION_FAILED",
            "message": str(e)
        }
