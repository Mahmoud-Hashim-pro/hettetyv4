FROM nvidia/cuda:12.1.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV TZ=UTC
# The guards key on this. Without it the shipped image took the
# development branch and fell back to a published default secret.
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y \
    python3.10 \
    python3.10-dev \
    python3-pip \
    git \
    wget \
    curl \
    cmake \
    build-essential \
    libgl1-mesa-glx \
    libglib2.0-0 \
    colmap \
    ffmpeg \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip
RUN python3.10 -m pip install --no-cache-dir --upgrade pip setuptools wheel

# Install PyTorch with CUDA 12.1 support
RUN pip3 install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121

ENV GAUSSIAN_SPLATTING_PATH=/opt/gaussian-splatting

# Clone and pin verified 3D Gaussian Splatting repository
RUN git clone --recursive https://github.com/graphdeco-inria/gaussian-splatting /opt/gaussian-splatting \
    && cd /opt/gaussian-splatting \
    && git checkout 2eee0e26d2f1a00e1312e0145ac507fb0837fb4c \
    && mkdir -p /app/submodules \
    && ln -s /opt/gaussian-splatting /app/submodules/gaussian-splatting

# Build and install open-source Niantic spz compression CLI tool (Strictly required in production)
RUN git clone https://github.com/nianticlabs/spz.git /tmp/spz \
    && mkdir -p /tmp/spz/build && cd /tmp/spz/build \
    && cmake .. -DCMAKE_BUILD_TYPE=Release \
    && make -j$(nproc) \
    && cp spz /usr/local/bin/spz \
    && chmod +x /usr/local/bin/spz \
    && rm -rf /tmp/spz \
    && which spz && spz --version

# Install project Python requirements
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy worker application code
COPY . .

# Run reconstruction worker entrypoint daemon
CMD ["python3", "-m", "workers.reconstruction_worker"]
