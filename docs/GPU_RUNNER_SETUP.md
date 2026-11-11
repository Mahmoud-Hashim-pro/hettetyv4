# HETTETY v4 — Dedicated Physical GPU Runner Provisioning & Acceptance Guide

This guide provides authoritative, step-by-step instructions for provisioning a dedicated physical NVIDIA GPU runner to execute the Hettety v4 3D Gaussian Splatting (3DGS) photogrammetric acceptance gate (`.github/workflows/gpu-acceptance.yml`).

---

## 1. System & Hardware Requirements

| Component | Minimum Requirement | Recommended Specification |
| :--- | :--- | :--- |
| **Operating System** | Linux x86_64 (Ubuntu 22.04 LTS) | Ubuntu 22.04 / 24.04 LTS x86_64 |
| **GPU Vendor** | NVIDIA | NVIDIA Dedicated GPU |
| **Compute Capability** | $\ge 7.0$ (Volta, Turing, Ampere, Ada Lovelace, Hopper) | $\ge 8.0$ (RTX 3080/3090/4090, A100, H100) |
| **GPU VRAM** | 11.5 GiB detected (12 GB physical) | 24 GB+ VRAM (prevents OOM during dense 30k training) |
| **System Memory (RAM)** | 32 GB RAM | 64 GB+ RAM |
| **Storage** | 30 GB free NVMe SSD space | 100 GB+ high-speed NVMe |
| **Network** | Outbound access to GitHub and PyPI | Dedicated high-bandwidth connection |

> [!IMPORTANT]
> The Hettety acceptance test fails closed if less than 11.5 GiB VRAM is detected. Intel integrated graphics, Apple Silicon, and non-NVIDIA GPUs cannot satisfy this requirement.

---

## 2. NVIDIA Driver & CUDA Toolkit Installation

Ensure modern NVIDIA drivers and the CUDA toolkit are installed:

```bash
# 1. Update package lists and install essential build tools
sudo apt-get update && sudo apt-get install -y \
    build-essential \
    cmake \
    git \
    ninja-build \
    pkg-config \
    curl \
    wget

# 2. Install NVIDIA Driver (version >= 535 recommended)
sudo apt-get install -y nvidia-driver-535

# 3. Install CUDA Toolkit (>= 11.8; CUDA 12.1 or 12.4 recommended)
# Follow official NVIDIA CUDA instructions for Ubuntu:
# https://developer.nvidia.com/cuda-downloads

# 4. Verify GPU detection and driver functionality
nvidia-smi
```

Verify that `nvidia-smi` displays the detected GPU, driver version, and CUDA version.

---

## 3. Python Environment & Compatible Version Matrix

> [!WARNING]
> **DO NOT USE UPSTREAM GRAPHDECO `environment.yml`!**
> The upstream Graphdeco repository includes a legacy `environment.yml` pinning PyTorch 1.12.1 and CUDA 11.6. Installing that legacy environment will break modern NVIDIA architectures (RTX 30/40 series, compute capability 8.0/8.9) and cause CUDA compilation errors.

Use Python 3.10 or 3.11 with modern PyTorch:

```bash
# 1. Create and activate a clean Python virtual environment
python3 -m venv ~/hettety-gpu-env
source ~/hettety-gpu-env/bin/activate

# 2. Upgrade pip and build tools
pip install --upgrade pip setuptools wheel ninja

# 3. Install PyTorch >= 2.1 with matching CUDA runtime (CUDA 12.1 example)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# 4. Verify PyTorch CUDA detection
python -c "import torch; assert torch.cuda.is_available(), 'CUDA not available'; print(f'PyTorch {torch.__version__} with CUDA {torch.version.cuda} on {torch.cuda.get_device_name(0)}')"
```

---

## 4. Native COLMAP Installation

COLMAP is required for Structure-from-Motion (SfM) feature extraction, matching, bundle adjustment, and multi-view dense stereo fusion:

```bash
# Option A: Ubuntu APT package (quickest)
sudo apt-get install -y colmap

# Option B: Build latest COLMAP with CUDA acceleration (recommended for maximum performance)
# Follow official build instructions: https://colmap.github.io/install.html

# Verify COLMAP installation on PATH
colmap --version
```

---

## 5. Official Graphdeco 3DGS Setup & Provenance Locking

Hettety strictly verifies the git provenance of the Graphdeco training runner. It requires an authentic clone of the official repository pinned to an approved release commit:

```bash
# 1. Clone official Graphdeco repository to /opt/gaussian-splatting
sudo git clone --recursive https://github.com/graphdeco-inria/gaussian-splatting.git /opt/gaussian-splatting
sudo chown -R $USER:$USER /opt/gaussian-splatting

# 2. Checkout pinned authoritative release commit
cd /opt/gaussian-splatting
git checkout 21301643a4354d6e24495c0df5a85354af8bd2be

# 3. Strictly ensure the git working tree is clean
git status --porcelain
# Expected output: (empty - zero uncommitted modifications or untracked files)
```

> [!CAUTION]
> If any file in `/opt/gaussian-splatting` is modified or untracked, Hettety's supply chain security gate will immediately reject training with `GRAPHDECO_PROVENANCE_REJECTED` and fail closed.

---

## 6. Compiling Graphdeco CUDA Submodules

Compile the fast rasterizer and nearest-neighbor search submodules inside your virtual environment:

```bash
cd /opt/gaussian-splatting

# Install diff-gaussian-rasterization
pip install submodules/diff-gaussian-rasterization

# Install simple-knn
pip install submodules/simple-knn

# Verify compiled extensions
python -c "import diff_gaussian_rasterization; import simple_knn; print('Graphdeco CUDA submodules compiled successfully!')"
```

---

## 7. Installing Hettety Worker Dependencies

Clone the Hettety repository and install Python test requirements:

```bash
cd ~/
git clone https://github.com/Mahmoud-Hashim-pro/hettetyv4.git
cd hettetyv4

# Install Python requirements
pip install -r hettety-3d-worker/requirements.txt
pip install pytest
```

---

## 8. Executing Preflight Verification

Before attaching the runner to GitHub Actions, execute the standalone preflight script to ensure all 8 requirements are satisfied:

```bash
cd ~/hettetyv4
python hettety-3d-worker/scripts/gpu_runner_preflight.py --strict
```

### Expected Output:
```
==============================================================================
 HETTETY v4 — PHYSICAL GPU RUNNER ACCEPTANCE PREFLIGHT VERIFICATION
==============================================================================

[ PASS ] 1. Python Runtime (>= 3.10)
         Python 3.10.x (/home/runner/hettety-gpu-env/bin/python)

[ PASS ] 2. PyTest Framework
         Pytest 8.x.x installed

[ PASS ] 3. PyTorch & CUDA Toolkit (>= 11.8)
         PyTorch 2.1.2 with CUDA 12.1

[ PASS ] 4. Physical NVIDIA GPU Hardware (>= 11.5 GB VRAM)
         NVIDIA GeForce RTX 4090 (24.0 GB VRAM, Compute 8.9)

[ PASS ] 5. Native COLMAP Binary on PATH
         COLMAP 3.9.1 at /usr/bin/colmap

[ PASS ] 6. Graphdeco CUDA Submodules (diff_gaussian_rasterization, simple_knn)
         diff_gaussian_rasterization and simple_knn successfully imported

[ PASS ] 7. Graphdeco Runner Provenance & Commit Allowlist
         Verified Graphdeco at commit 21301643a4354d6e24495c0df5a85354af8bd2be (https://github.com/graphdeco-inria/gaussian-splatting)

[ PASS ] 8. Authoritative Acceptance Dataset
         Dataset 'prop_villa_marassi_01' (28 keyframes, 4 survey benchmarks)

------------------------------------------------------------------------------
 SUMMARY: ALL PREFLIGHT CHECKS PASSED. RUNNER IS READY FOR 30,000-ITERATION GPU ACCEPTANCE.
==============================================================================
```

---

## 9. Registering Self-Hosted GitHub Actions Runner

To connect the host to the repository:

1. Navigate to: **GitHub Repository $\to$ Settings $\to$ Actions $\to$ Runners $\to$ New self-hosted runner**.
2. Select **Linux** and **x64**.
3. Follow the instructions to download and extract the runner package:

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -o actions-runner-linux-x64-2.319.1.tar.gz -L https://github.com/actions/runner/releases/download/v2.319.1/actions-runner-linux-x64-2.319.1.tar.gz
tar xzf ./actions-runner-linux-x64-2.319.1.tar.gz
```

4. Configure the runner with `--ephemeral` and required labels:

```bash
./config.sh \
  --url https://github.com/Mahmoud-Hashim-pro/hettetyv4 \
  --token <YOUR_RUNNER_REGISTRATION_TOKEN> \
  --labels self-hosted,gpu,nvidia \
  --ephemeral
```

> [!IMPORTANT]
> The workflow job specifically requires `runs-on: [self-hosted, gpu, nvidia]`. All three labels must be assigned. The `--ephemeral` flag ensures the runner deregisters cleanly after completing the acceptance job, preventing dirty file state across jobs.

5. Start the runner within the virtual environment:

```bash
source ~/hettety-gpu-env/bin/activate
./run.sh
```

---

## 10. Triggering the Physical Acceptance Run

Once the self-hosted runner is listening:

1. Go to **Actions** in the GitHub repository.
2. Select **Dedicated Physical GPU Acceptance Gate** in the left sidebar.
3. Click **Run workflow**:
   - Branch: `fix/gpu-runner-readiness` (or target branch)
   - `run_real_gpu_acceptance`: `true`
   - `target_property_fixture`: `prop_villa_marassi_01` (or `prop_courtyard_dslr_02`)
4. Click **Run workflow**.

The job will:
1. Run `gpu_runner_preflight.py --strict` to verify all hardware, driver, and git provenance preconditions.
2. Execute full COLMAP SfM feature extraction and stereo dense reconstruction.
3. Train 30,000 iterations using official Graphdeco `train.py`.
4. Perform floater pruning, 1:1 metric calibration against survey ground truth, and dual asset compression (`.spz` and `.glb`).
5. Persist machine-readable cryptographic evidence and upload `real-gpu-acceptance-evidence-and-deliverables`.
