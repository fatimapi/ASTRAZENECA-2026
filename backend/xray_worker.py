"""One chest X-ray prediction in its own process: reads a float32 .npy image (0-255) from stdin,
prints {"findings": [...]} or {"error": "..."} as JSON, then exits so its memory is released."""
import io
import json
import sys

import numpy as np


def main():
    from .model import ChestXrayEngine, ModelUnavailable
    try:
        pixels = np.load(io.BytesIO(sys.stdin.buffer.read()), allow_pickle=False)
        findings = ChestXrayEngine().predict(pixels)
        sys.stdout.write(json.dumps({"findings": findings}))
    except ModelUnavailable as exc:
        sys.stdout.write(json.dumps({"error": str(exc)}))
        sys.exit(1)
    except Exception:
        sys.stdout.write(json.dumps({"error": "Model inference failed. No findings have been generated."}))
        sys.exit(1)


if __name__ == "__main__":
    main()
