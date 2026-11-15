"""One chest X-ray analysis in its own process, which then exits so its memory is released.

    python -m backend.xray_worker --dicom [--confirmed]   stdin: the raw DICOM file
    python -m backend.xray_worker                          stdin: a float32 .npy image (0-255)

Prints {"findings": [...], "image": {...}} or {"rejected": "..."} (unsupported image) or {"error": "..."}.
The image is prepared here, before the model is loaded, so the peak is the larger of the two, not their sum.
"""
import gc
import io
import json
import sys

import numpy as np


def main():
    from .imaging import ImageRejected, prepare_dicom
    from .model import ModelUnavailable, _inner_engine_class
    args = sys.argv[1:]
    data = sys.stdin.buffer.read()
    try:
        image = None
        if "--dicom" in args:
            prepared = prepare_dicom(data, "--confirmed" in args)
            del data
            pixels = prepared.pixels_255
            image = {"width": prepared.width, "height": prepared.height, "modality": prepared.modality,
                     "preview_png_base64": prepared.preview_png_base64}
            del prepared
        else:
            pixels = np.load(io.BytesIO(data), allow_pickle=False)
            del data
        gc.collect()
        findings = _inner_engine_class()().predict(pixels)
        sys.stdout.write(json.dumps({"findings": findings, "image": image}))
    except ImageRejected as exc:
        sys.stdout.write(json.dumps({"rejected": str(exc)}))
    except ModelUnavailable as exc:
        sys.stdout.write(json.dumps({"error": str(exc)}))
        sys.exit(1)
    except Exception:
        sys.stdout.write(json.dumps({"error": "Model inference failed. No findings have been generated."}))
        sys.exit(1)


if __name__ == "__main__":
    main()
