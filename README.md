# Candex — No patient left behind

An accessible patient and doctor prototype, with a real, locally run chest-X-ray DICOM model connector. The existing records, CT illustration, appointments and quality metrics are fictional examples. The separate **Doctor → DICOM AI analysis** page displays actual model output only after a successful backend request.

## Run the website with DICOM AI

Use Python 3.10–3.12. First download/clone this repository and open a terminal **inside the folder containing `index.html`**.

### macOS / Linux

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m backend
```

### Windows PowerShell

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m backend
```

Keep the terminal running and open **http://localhost:8000/#care/dicom**. The launcher prints a temporary API key if you have not set `CANDEX_API_KEY`. Copy that key into the Doctor page's API key field, check the connection, select a permitted chest-X-ray DICOM, confirm the two research-use checks, and choose **Analyze**.

Requirements automatically select compatible PyTorch versions for Apple Silicon and Intel Macs. The Intel Mac dependency path is documented but has not been runtime-tested here. Dependency installation can be substantial because it includes PyTorch. The first analysis downloads pretrained model weights; later requests reuse the local cache. CPU inference is supported, so a GPU or paid model API is not required for this first connector. See [backend/README.md](backend/README.md) for configuration, test commands, a synthetic sample generator and limits.

### Website only

```sh
python3 -m http.server 8000
```

This serves the patient/doctor prototype and optional browser-local guide, **but cannot run DICOM inference**. The DICOM page will explain that the backend is unavailable. Use `python -m backend` for the full workflow. If port 8000 is occupied by an earlier server, stop it with Control+C first.

## What the DICOM model does

- Uses [TorchXRayVision](https://github.com/mlmed/torchxrayvision), a pretrained DenseNet (`densenet121-res224-all`), to return image-level pathology scores on supported uncompressed, single-frame **frontal AP/PA CR/DX chest X-rays**.
- Reads DICOM pixels on the Python server, validates the modality and image representation, applies the model's crop/resize/normalization, and returns a preview without exposing patient metadata.
- Returns model provenance, uncalibrated scores, limitations and an editable, unsigned report draft. The report is assembled from the actual scores; it is not an LLM interpretation.
- Uses bearer authentication, bounded uploads and an explicit optional CORS allowlist. The default launcher binds to the local computer only.
- Does **not** accept CT, MRI, compressed DICOM or multiframe studies; locate tumours; calculate cancer probabilities; or establish a diagnosis. Those tasks require other models and preprocessing. Chest anatomy and permitted use must be confirmed by the uploader.

The role switch is a prototype interface choice, not professional identity verification. This local research service is not a production patient-data system or a clinically validated diagnostic device. Use synthetic/public permitted examples for development. Burned-in patient information can exist inside pixels; suppressing DICOM metadata is not complete de-identification. No uploads or analysis results are intentionally retained by the application, but the selected server necessarily processes the uploaded file. Multipart parsing may use temporary disk files, which are closed and removed after the request.

## Other features

- Patient/doctor routing and searchable care worklist
- Session-only health summaries, message drafts and research preferences
- Example care journey, reminders and calendar download
- Separate schematic CT comparison (clearly labelled demo)
- Editable template reports, eight illustrative quality/equity metrics, CSV export and PDSA template
- Larger text, higher contrast, reduced motion and keyboard-friendly controls
- Optional local navigation agent: Transformers.js with the open-source MiniLM embedding model; reviewed answers, no medical advice

## Other open-source agent frameworks

The AI workspace describes [MedRAX](https://github.com/bowang-lab/MedRAX), [mAIstro](https://github.com/eltzanis/mAIstro) and [Radiology Swarm](https://github.com/The-Swarm-Corporation/radiology-swarm). They remain separate integration options and are not executed by this connector. Kanta/PACS and research registries are not connected.

## Checks

```sh
python -m pip install -r requirements-dev.txt
python -m pytest backend/tests -q
node tests/dicom-client.mjs
```

Backend tests validate DICOM handling and API failures with synthetic images and explicit stubs. An opt-in test runs real pretrained inference; see backend documentation. The Node client test uses DOM/network stubs and does not replace browser testing.

## Code map

| File / folder | Purpose |
| --- | --- |
| `app.js`, `style.css`, `index.html` | Existing interface, routes and styling |
| `dicom.js`, `dicom.css` | Authenticated Doctor-side upload and actual result display |
| `backend/` | DICOM processing, model inference, API, launcher and tests |
| `requirements.txt` | Python runtime dependencies |
| `guide.js` | Optional browser-local platform guidance |

Static hosting can serve the interface, but live analysis requires the Python service. For a remotely hosted frontend, configure a trusted HTTPS backend URL and matching `CANDEX_ALLOWED_ORIGINS`; never embed a permanent API key in frontend code. Public deployment requires stronger identity, access controls and operational safeguards than this local development connector.

External network requests: Google Fonts; optional jsDelivr/Hugging Face assets for the browser guide; and pretrained weight downloads for the backend. Uploaded pixels are not sent to an external model API by this implementation. Follow the upstream library, model-weight and training-data licence terms for your use.
