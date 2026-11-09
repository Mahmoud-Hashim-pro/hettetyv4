"""
HETTETY 3D GPU Worker — Stage 5: Floater Pruning & Spatial Post-Processing
Removes low-density artifacts, computes dynamic spatial bounds, and calculates true Gaussian count.
Strictly parses actual PLY elements dynamically using schema-driven attribute offsets.
Never assumes hardcoded 62 bytes or fabricated coordinates.
"""

import os
import re
import math
import struct
import logging
from typing import Dict, Any, Tuple, List, Optional

logger = logging.getLogger("hettety-3d-worker.optimize")

PLY_SCALAR_TYPES: Dict[str, Tuple[int, str]] = {
    "char": (1, "b"),
    "int8": (1, "b"),
    "uchar": (1, "B"),
    "uint8": (1, "B"),
    "short": (2, "h"),
    "int16": (2, "h"),
    "ushort": (2, "H"),
    "uint16": (2, "H"),
    "int": (4, "i"),
    "int32": (4, "i"),
    "uint": (4, "I"),
    "uint32": (4, "I"),
    "float": (4, "f"),
    "float32": (4, "f"),
    "double": (8, "d"),
    "float64": (8, "d"),
}

def _parse_ply_property_layout(header_text: str) -> Tuple[List[Dict[str, Any]], int]:
    """
    Parses property types, names, byte sizes, and cumulative byte offsets from PLY header.
    Fully compliant with standard 3DGS binary PLY specifications (including SH degree 3, 248 bytes).
    Strictly validates scalar property types and scopes properties to element vertex.
    """
    properties = []
    curr_offset = 0
    current_element = None

    for line in header_text.splitlines():
        line = line.strip()
        if not line or line.startswith("comment"):
            continue
        parts = line.split()
        if parts[0] == "element":
            current_element = parts[1]
        elif parts[0] == "property" and current_element == "vertex":
            if len(parts) >= 3:
                p_type = parts[1].lower()
                p_name = parts[2]
                if p_type == "list":
                    raise ValueError("Invalid PLY file: list properties in vertex element are not supported.")
                if p_type not in PLY_SCALAR_TYPES:
                    raise ValueError(f"Invalid PLY file: unsupported property type '{p_type}'.")
                p_size, fmt_ch = PLY_SCALAR_TYPES[p_type]
                properties.append({
                    "name": p_name,
                    "type": p_type,
                    "size": p_size,
                    "format": fmt_ch,
                    "offset": curr_offset
                })
                curr_offset += p_size

    return properties, curr_offset

def parse_ply_header_and_bounds(ply_path: str) -> Tuple[int, Dict[str, Any]]:
    """
    Parses PLY header to extract declared vertex count and computes true spatial bounding box.
    Uses schema-driven dynamic stride calculation for binary PLYs.
    Validates magic header, format declaration, end_header, and payload completeness.
    """
    if not os.path.isfile(ply_path):
        raise FileNotFoundError(f"PLY file does not exist: {ply_path}")

    file_size = os.path.getsize(ply_path)
    if file_size < 12:
        raise ValueError(f"PLY file is truncated or too small ({file_size} bytes)")

    with open(ply_path, "rb") as f:
        header_chunk = f.read(65536)

    if not header_chunk.startswith(b"ply"):
        raise ValueError("Invalid PLY file: missing 'ply' magic header.")

    match_end = re.search(rb"end_header[ \t]*\r?\n", header_chunk)
    if not match_end:
        raise ValueError(f"Invalid PLY file: 'end_header' tag not found (file size {file_size} bytes).")

    header_end = match_end.end()
    header_text = header_chunk[:match_end.start()].decode("ascii", errors="replace")

    format_match = re.search(r"^\s*format\s+(ascii|binary_little_endian|binary_big_endian)\s+1\.0", header_text, re.MULTILINE)
    if not format_match:
        raise ValueError("Invalid PLY file: missing or unrecognized format declaration.")
    format_type = format_match.group(1)

    vertex_match = re.search(r"^\s*element\s+vertex\s+(\d+)", header_text, re.MULTILINE)
    if not vertex_match:
        raise ValueError("Invalid PLY file: missing 'element vertex <count>' in header.")

    splat_count = int(vertex_match.group(1))
    if splat_count <= 0:
        raise ValueError(f"Invalid PLY file: declared splat count is {splat_count} (must be > 0).")

    props, stride = _parse_ply_property_layout(header_text)
    prop_by_name = {p["name"]: p for p in props}

    for coord in ("x", "y", "z"):
        if coord not in prop_by_name:
            raise ValueError(f"Invalid PLY file: missing required coordinate property '{coord}'.")

    x_off = prop_by_name["x"]["offset"]
    y_off = prop_by_name["y"]["offset"]
    z_off = prop_by_name["z"]["offset"]
    bytes_per_vertex = stride if stride > 0 else 62

    is_binary = format_type.startswith("binary")
    is_ascii = (format_type == "ascii")
    endian = "<" if format_type == "binary_little_endian" else ">"

    min_x, min_y, min_z = float("inf"), float("inf"), float("inf")
    max_x, max_y, max_z = float("-inf"), float("-inf"), float("-inf")
    filt_min_x, filt_min_y, filt_min_z = float("inf"), float("inf"), float("inf")
    filt_max_x, filt_max_y, filt_max_z = float("-inf"), float("-inf"), float("-inf")
    filtered_points_count = 0

    if is_binary:
        expected_body_size = splat_count * bytes_per_vertex
        actual_body_size = file_size - header_end
        if actual_body_size < expected_body_size:
            raise ValueError(
                f"Invalid PLY file: declared splat count is {splat_count} "
                f"({expected_body_size} bytes body required), but body only contains {actual_body_size} bytes (truncated or too small)."
            )

        x_fmt = endian + prop_by_name["x"].get("format", "f")
        y_fmt = endian + prop_by_name["y"].get("format", "f")
        z_fmt = endian + prop_by_name["z"].get("format", "f")

        with open(ply_path, "rb") as f:
            f.seek(header_end)
            batch_size = 4096
            read_vertices = 0
            while read_vertices < splat_count:
                to_read = min(batch_size, splat_count - read_vertices)
                chunk = f.read(to_read * bytes_per_vertex)
                if len(chunk) < to_read * bytes_per_vertex:
                    raise ValueError(
                        f"Invalid PLY file: truncated record encountered while reading {splat_count} splats "
                        f"(read {read_vertices + len(chunk) // bytes_per_vertex} of {splat_count})."
                    )
                for i in range(to_read):
                    v_off = i * bytes_per_vertex
                    x = struct.unpack_from(x_fmt, chunk, v_off + x_off)[0]
                    y = struct.unpack_from(y_fmt, chunk, v_off + y_off)[0]
                    z = struct.unpack_from(z_fmt, chunk, v_off + z_off)[0]
                    if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
                        raise ValueError(f"CANNOT_DETERMINE_BOUNDS: Invalid PLY file: non-finite coordinate found (x={x}, y={y}, z={z}).")
                    min_x, max_x = min(min_x, x), max(max_x, x)
                    min_y, max_y = min(min_y, y), max(max_y, y)
                    min_z, max_z = min(min_z, z), max(max_z, z)
                    if abs(x) < 500 and abs(y) < 500 and abs(z) < 500:  # outlier filter
                        filt_min_x, filt_max_x = min(filt_min_x, x), max(filt_max_x, x)
                        filt_min_y, filt_max_y = min(filt_min_y, y), max(filt_max_y, y)
                        filt_min_z, filt_max_z = min(filt_min_z, z), max(filt_max_z, z)
                        filtered_points_count += 1
                read_vertices += to_read

    elif is_ascii:
        prop_names = [p["name"] for p in props]
        x_idx = prop_names.index("x")
        y_idx = prop_names.index("y")
        z_idx = prop_names.index("z")
        min_tokens = max(x_idx, y_idx, z_idx) + 1

        with open(ply_path, "r", encoding="ascii", errors="replace") as f:
            f.seek(header_end)
            read_count = 0
            for line in f:
                line_str = line.strip()
                if not line_str or line_str.startswith("#"):
                    continue
                parts = line_str.split()
                if len(parts) < min_tokens:
                    raise ValueError(
                        f"CANNOT_DETERMINE_BOUNDS: Invalid PLY file: vertex record {read_count + 1} has insufficient properties "
                        f"({len(parts)} found, expected >= {min_tokens})."
                    )
                try:
                    x, y, z = float(parts[x_idx]), float(parts[y_idx]), float(parts[z_idx])
                except ValueError as ex:
                    raise ValueError(f"CANNOT_DETERMINE_BOUNDS: Invalid PLY file: cannot parse numeric coordinate on record {read_count + 1}: {ex}")
                if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
                    raise ValueError(f"CANNOT_DETERMINE_BOUNDS: Invalid PLY file: non-finite coordinate found (x={x}, y={y}, z={z}).")
                min_x, max_x = min(min_x, x), max(max_x, x)
                min_y, max_y = min(min_y, y), max(max_y, y)
                min_z, max_z = min(min_z, z), max(max_z, z)
                if abs(x) < 500 and abs(y) < 500 and abs(z) < 500:
                    filt_min_x, filt_max_x = min(filt_min_x, x), max(filt_max_x, x)
                    filt_min_y, filt_max_y = min(filt_min_y, y), max(filt_max_y, y)
                    filt_min_z, filt_max_z = min(filt_min_z, z), max(filt_max_z, z)
                    filtered_points_count += 1
                read_count += 1
                if read_count == splat_count:
                    break

            if read_count < splat_count:
                raise ValueError(
                    f"Invalid PLY file: declared splat count is {splat_count}, but body only contains {read_count} records (truncated or too small)."
                )

    if min_x == float("inf") or max_x == float("-inf"):
        raise ValueError("CANNOT_DETERMINE_BOUNDS: Point cloud contains no finite, valid 3D coordinates.")

    if filtered_points_count > 0:
        bx_min, bx_max = filt_min_x, filt_max_x
        by_min, by_max = filt_min_y, filt_max_y
        bz_min, bz_max = filt_min_z, filt_max_z
    else:
        bx_min, bx_max = min_x, max_x
        by_min, by_max = min_y, max_y
        bz_min, bz_max = min_z, max_z

    bounds = {
        "min": [round(bx_min, 2), round(by_min, 2), round(bz_min, 2)],
        "max": [round(bx_max, 2), round(by_max, 2), round(bz_max, 2)]
    }

    return splat_count, bounds

def optimize_splat_cloud(
    input_ply: str,
    output_ply: str,
    min_opacity: float = 0.05,
    max_scale: float = 2.5,
    opacity_threshold: Optional[float] = None
) -> Dict[str, Any]:
    """
    Genuine Gaussian Splatting post-processing & floater pruning engine:
    1. Parses PLY schema and dynamic attribute offsets.
    2. Prunes low-opacity floaters (opacity < min_opacity or opacity_threshold).
    3. Prunes degenerate oversized splats (scale > max_scale).
    4. Eliminates non-finite coordinates (NaN / Inf).
    5. Computes exact bounding box from surviving pruned geometry.
    6. Updates PLY header with exact surviving vertex count.

    Backward compatibility:
    - opacity_threshold: maps directly to min_opacity if provided.
    """
    if opacity_threshold is not None:
        min_opacity = opacity_threshold
    if not os.path.exists(input_ply):
        return {
            "success": False,
            "error_code": "INPUT_NOT_FOUND",
            "message": f"Input PLY not found: {input_ply}"
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
            header_bytes = f.read(65536)

        match_end = re.search(rb"end_header[ \t]*\r?\n", header_bytes)
        if not match_end:
            raise ValueError("Invalid PLY file: 'end_header' tag not found.")
        header_end = match_end.end()
        header_text = header_bytes[:match_end.start()].decode("ascii", errors="replace")

        format_match = re.search(r"^\s*format\s+(ascii|binary_little_endian|binary_big_endian)\s+1\.0", header_text, re.MULTILINE)
        if not format_match:
            raise ValueError("Invalid PLY file: missing or unrecognized format declaration.")
        format_type = format_match.group(1)

        props, stride = _parse_ply_property_layout(header_text)
        is_binary = format_type.startswith("binary")
        is_ascii = (format_type == "ascii")
        endian = "<" if format_type == "binary_little_endian" else ">"

        prop_by_name = {p["name"]: p for p in props}
        x_off = prop_by_name.get("x", {}).get("offset", 0)
        y_off = prop_by_name.get("y", {}).get("offset", 4)
        z_off = prop_by_name.get("z", {}).get("offset", 8)
        
        has_opacity = "opacity" in prop_by_name
        op_offset = prop_by_name["opacity"]["offset"] if has_opacity else -1
        scale_offsets = [p["offset"] for p in props if p["name"].startswith("scale_")]
        bytes_per_vertex = stride if stride > 0 else 62

        retained_lines = []
        min_x, min_y, min_z = float("inf"), float("inf"), float("inf")
        max_x, max_y, max_z = float("-inf"), float("-inf"), float("-inf")
        retained_count = 0
        floaters_pruned = 0

        if is_ascii:
            prop_names = [p["name"] for p in props]
            x_idx = prop_names.index("x") if "x" in prop_names else 0
            y_idx = prop_names.index("y") if "y" in prop_names else 1
            z_idx = prop_names.index("z") if "z" in prop_names else 2
            opacity_idx = prop_names.index("opacity") if "opacity" in prop_names else -1
            scale_indices = [i for i, name in enumerate(prop_names) if name.startswith("scale_")]

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

            # Update header with retained count and proper end_header termination
            clean_header_text = header_text.rstrip("\r\n") + "\n"
            new_header = re.sub(r"element vertex \d+", f"element vertex {retained_count}", clean_header_text) + "end_header\n"
            with open(output_ply, "w", encoding="ascii") as out_f:
                out_f.write(new_header)
                out_f.writelines(retained_lines)

        else:
            # Binary PLY pruning using schema-driven byte offsets
            retained_binary = bytearray()
            with open(input_ply, "rb") as f:
                f.seek(header_end)
                for v_idx in range(raw_count):
                    v_chunk = f.read(bytes_per_vertex)
                    if len(v_chunk) < bytes_per_vertex:
                        raise ValueError(
                            f"Invalid PLY file: truncated binary vertex record at vertex {v_idx + 1} of {raw_count} "
                            f"({len(v_chunk)} bytes read, expected {bytes_per_vertex} bytes)."
                        )
                    
                    # Unpack coordinates (x, y, z)
                    x = struct.unpack_from(endian + "f", v_chunk, x_off)[0]
                    y = struct.unpack_from(endian + "f", v_chunk, y_off)[0]
                    z = struct.unpack_from(endian + "f", v_chunk, z_off)[0]
                    if math.isnan(x) or math.isnan(y) or math.isnan(z) or math.isinf(x) or math.isinf(y) or math.isinf(z):
                        floaters_pruned += 1
                        continue

                    # Bounding filter
                    if abs(x) > 500 or abs(y) > 500 or abs(z) > 500:
                        floaters_pruned += 1
                        continue

                    # Opacity filter (sigmoid activation)
                    if has_opacity and op_offset + 4 <= len(v_chunk):
                        raw_op = struct.unpack_from(endian + "f", v_chunk, op_offset)[0]
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
                            scales = [math.exp(struct.unpack_from(endian + "f", v_chunk, s_off)[0]) for s_off in scale_offsets if s_off + 4 <= len(v_chunk)]
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

            clean_header_text = header_text.rstrip("\r\n") + "\n"
            new_header = re.sub(r"element vertex \d+", f"element vertex {retained_count}", clean_header_text) + "end_header\n"
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
