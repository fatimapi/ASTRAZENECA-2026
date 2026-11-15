#!/usr/bin/env bash
# Render build (render.yaml → buildCommand). Installs the backend, then converts the X-ray model to ONNX.
# PyTorch is installed for that conversion only; the running server uses ONNX Runtime and never imports it
# (backend/xray_onnx.py), which keeps it inside the free plan's 512 MB.
set -euo pipefail
PY="$(command -v python)"
TORCH="torch==2.10.0 torchvision==0.25.0"
CPU_INDEX="https://download.pytorch.org/whl/cpu"   # CPU-only wheels: no ~2 GB of GPU libraries

if command -v uv >/dev/null 2>&1 || { python -m pip install --quiet --disable-pip-version-check uv && command -v uv >/dev/null 2>&1; }; then
  echo "Installing with uv"
  uv pip install --python "$PY" $TORCH --index-url "$CPU_INDEX"
  uv pip install --python "$PY" -r requirements.txt onnx
else
  echo "uv unavailable; installing with pip"
  python -m pip install --no-cache-dir $TORCH --index-url "$CPU_INDEX"
  python -m pip install --no-cache-dir -r requirements.txt onnx
fi

# Convert the official weights and check the result against PyTorch (the build fails if they differ).
python -m backend.export_xray_onnx
