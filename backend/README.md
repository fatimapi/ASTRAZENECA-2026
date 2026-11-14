# Candex DICOM research backend

This is a **working local research pipeline**, not a clinically validated diagnostic service. It runs the open-source [TorchXRayVision](https://github.com/mlmed/torchxrayvision) DenseNet121 model (`densenet121-res224-all`) on a supported DICOM chest X-ray and returns actual model scores. It does not call MedRAX, mAIstro or Radiology Swarm.

## What is supported

- One frontal **AP or PA chest X-ray** per request; DICOM `ViewPosition` must say `AP` or `PA`.
- Computed Radiography (`CR`) or Digital X-Ray (`DX`, For Presentation) SOP class.
- Single-frame, monochrome, 8-bit or 16-bit DICOM Part 10 file.
- Maximum **20 MiB**, dimensions at least 32 × 32 and at most 16 million pixels.
- Only uncompressed Implicit/Explicit VR Little Endian or Explicit VR Big Endian transfer syntaxes are accepted. Compressed and deflated studies are rejected before full dataset parsing; export an uncompressed research image.

**CT series, MR, mammography, lateral radiographs, raw acquisition images and multi-frame studies are rejected.** A CT nodule detector would need a separate volumetric pipeline and suitable checkpoint. Do not upload a CT slice and interpret this model’s output as CT analysis.

The scores cover 18 research labels, including Nodule and Mass. They are **uncalibrated model outputs, not probabilities, cancer-risk scores, a diagnosis or a decision threshold**. There is no localisation, heatmap, segmentation, prior-scan comparison or treatment recommendation. Synthetic test images produce medically meaningless scores.

## Start on a Mac

From the repository folder containing `index.html`, run each line separately:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m backend
```

Python 3.10–3.12 and enough disk space for PyTorch/model dependencies are required. First model use downloads approximately 28 MB of weights from the upstream GitHub release; installing Python dependencies is substantially larger. A CPU is sufficient; no paid model API or API key from an AI provider is needed.

The requirements select PyTorch 2.10 / torchvision 0.25 on Apple Silicon, Linux and Windows. Intel Macs automatically select the last compatible PyTorch 2.2.2 / torchvision 0.17.2 wheels and NumPy 1.26.4; Python 3.10–3.12 Intel-macOS wheels were verified on PyPI, but this older-Mac runtime was not executed during development. The actual inference checks ran on Linux CPU. If Python 3.13+ is your default, create the environment with an installed Python 3.12 instead. On Apple Silicon, use a native arm64 Python rather than an x86_64 Python under Rosetta when possible.

Open **http://127.0.0.1:8000/#care/dicom** and keep the terminal open. The startup command prints a temporary access token once. Copy it into the Doctor DICOM backend token field. The token changes after a restart unless you set `CANDEX_API_KEY` yourself. Press Ctrl+C to stop.

If port 8000 is already used by `python3 -m http.server`, stop that server with Ctrl+C first. A static server alone cannot run the medical model.

## Windows

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m backend
```

If script activation is restricted, run `.venv\Scripts\python.exe -m pip install -r requirements.txt` and `.venv\Scripts\python.exe -m backend` directly.

## Linux, CPU-only installation

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install torch==2.10.0 torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r requirements.txt
python -m backend
```

## Try without patient data

In another activated terminal, create a nonclinical synthetic DICOM:

```sh
python -m backend.create_sample /tmp/candex-synthetic.dcm
```

On Windows choose a writable new path, for example `candex-synthetic.dcm`. Upload it through the Doctor interface and confirm both checkboxes. It exercises DICOM decoding, model loading and inference, **not medical accuracy**. Never use its findings for care. The generator writes no patient identity fields.

## Configuration

The normal launcher binds only to `127.0.0.1` and serves the website and API together. No CORS configuration is needed for this setup.

- `CANDEX_API_KEY`: optional persistent access token, at least 24 characters. Set it in your shell; do not commit it or embed it in website files. Direct `uvicorn backend.app:app` use returns HTTP 503 for analysis until this is configured.
- `CANDEX_MODEL_CACHE`: optional weights directory; default `backend/.model-cache/`. Do not commit it.
- `CANDEX_CPU_THREADS`: CPU inference threads, from 1 to 8 (default 2).
- `CANDEX_ALLOWED_ORIGINS`: optional comma-separated explicit frontend origins for a separately served UI, for example `http://localhost:8080`. No wildcards, paths or credentials are accepted. Supply the remote API base in the UI and keep the token in memory only.

The local shared-token setup is for a controlled development/research environment. Do not expose it to the internet as a clinical service. A hosted version needs HTTPS, staff identity and authorisation, upload isolation, appropriate data governance, audit controls, monitoring and clinical validation.

## Data handling and preprocessing

Requests are authenticated and capped before multipart parsing. One analysis runs at a time. No uploaded study, findings database or report is persisted by this application; upload buffers may be temporarily spooled by the framework and are closed after processing. API responses use `Cache-Control: no-store`. No patient tags, original filenames or study identifiers are returned. This is **not an automatic anonymisation service**: burned-in identifiers may remain in pixels even if metadata says otherwise. Use only permitted, appropriately de-identified test/research images.

A bounded Part 10 file-meta preflight rejects compressed/deflated transfer syntaxes before pydicom can inflate the dataset. The decoder checks SOP class, modality, frame count, dimensions, bit depth, photometric interpretation, AP/PA view, body-part metadata when present, and declared burned-in annotations. It applies modality rescale/LUT and the first VOI presentation when provided, converts full-range pixels to 0–255 and corrects MONOCHROME1 polarity. TorchXRayVision then normalises to its expected range, centre-crops and resizes to 224 × 224. These choices can discard information and require task-specific validation; they are not a universal clinical DICOM preprocessing pipeline.

Model outputs use sigmoid scores with the library’s operating-point remapping disabled. There is no assertion that a score is calibrated to an individual’s disease probability. A qualified clinician must review the original study, image quality and limitations.

## API

- `GET /api/health`: service/model metadata and loaded state; does not load or download weights.
- `POST /api/analyze`: Bearer token; multipart `file`, `confirmed_chest=true`, `permitted_data=true`. Returns a de-identified-by-omission metadata subset, PNG rendering, actual scores, model provenance, limitations and an unapproved report draft.
- A model/download/dependency failure returns an error with **no fabricated fallback findings**.

Example, with a token set in the shell:

```sh
curl -H "Authorization: Bearer $CANDEX_API_KEY" \
  -F file=@/tmp/candex-synthetic.dcm \
  -F confirmed_chest=true -F permitted_data=true \
  http://127.0.0.1:8000/api/analyze
```

## Tests

```sh
python -m pip install -r requirements-dev.txt
python -m pytest backend/tests -q
```

Default tests use explicit test stubs for endpoint behaviour and synthetic DICOM validation; they do not claim inference occurred. The opt-in test runs the actual pretrained model on synthetic pixels:

```sh
CANDEX_RUN_MODEL_TEST=1 python -m pytest backend/tests -q
```

This can download weights and establishes software integration, not clinical validity.

## Sources and licensing

- [TorchXRayVision source and preprocessing documentation](https://github.com/mlmed/torchxrayvision) — Apache-2.0 code; review upstream checkpoint and training-data terms for the intended use.
- [Model paper](https://arxiv.org/abs/2002.02497).
- [pydicom](https://github.com/pydicom/pydicom) — MIT.

No model weights or patient images are committed to this repository.
