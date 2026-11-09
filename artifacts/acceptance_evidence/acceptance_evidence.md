# HETTETY v4 — 3D Reconstruction Acceptance Evidence

- **Run ID**: `acc_1794215053_ebeb76af`
- **Timestamp (UTC)**: `2026-11-09T09:04:13Z`
- **Overall Status**: **BLOCKED**
- **Blocking Reason / Prerequisite**: Physical NVIDIA GPU with CUDA support is required. Current host does not have CUDA available.

## 1. Selected Dataset
- **Fixture Name**: `prop_villa_marassi_01`
- **Real Photographic Data**: `True`
- **Image Keyframes**: 28 frames
- **Survey Benchmarks**: 4 records
- **Dataset Manifest SHA-256**: `0ea781d44f190c73900648e01912b12cf9669080ddced77dd768b446eabe17b3`

## 2. Hardware & Software Runtime
- **CUDA Available**: `False`
- **GPU Device**: `None`
- **VRAM (GB)**: `0.0 GB`
- **PyTorch**: `None` (CUDA `None`)
- **CUDA >= 11.8 Satisfied**: `False`
- **Graphdeco Extensions (diff_gaussian_rasterization, simple_knn)**: `False`
- **COLMAP Binary**: `None` (`True`)
- **Graphdeco Runner**: `None`

## 3. Photogrammetric Stages Summary
| Stage | Duration | Metrics / Outcome |
| :--- | :---: | :--- |
| *No stages executed* | N/A | Execution halted prior to stage pipeline |

## 4. Output Artifacts & Integrity Checksums
- *No artifacts produced* (Reconstruction not completed)

## 5. Acceptance Criteria Checklist
| Criterion | Status | Details |
| :--- | :---: | :--- |
| **STRICT_COLMAP** | `PENDING` | Real COLMAP binary verification |
| **DENSE_MVS** | `PENDING` | Multi-view stereo point cloud |
| **GRAPHDECO_3DGS** | `BLOCKED` | Host lacks physical NVIDIA GPU with CUDA. |
| **METRIC_CALIBRATION** | `PENDING` | Laser holdout RMSE <= 0.05m |
| **SPZ_EXPORT** | `PENDING` | Niantic SPZ v4 container |
| **GLB_EXPORT** | `PENDING` | Watertight glTF 2.0 binary |
