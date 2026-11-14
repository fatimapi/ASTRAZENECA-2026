# Candex — No patient left behind

## Demo sign-in

The website opens on a Candex landing page. Choose **Patient**, **Doctor** or **Quality Administrator**, then select **Enter demo workspace**. The selection is remembered in this browser tab while you refresh or follow links. **Switch workspace** and **Leave demo** return to the landing page. Direct links to another role require choosing that workspace first.

This is the hackathon **demo sign-in**, not authentication: it collects no email or password, verifies no professional identity, and uses fictional records. The role marker lives in sessionStorage and does not protect data or backend APIs. Backend requests still need their existing API token. Real accounts would require a server-side identity and authorisation service.

Leaving or switching clears clinical-agent conversations and cached backend credentials and cancels pending AI requests. Shared fictional health-check, report, appointment and referral examples are retained for demonstrating the handoff between roles. Use the existing demo data controls to reset those examples. The hosted private preview retains its separate ChatGPT access gate.

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

The demo sign-in is a prototype interface choice, not professional identity verification. This local research service is not a production patient-data system or a clinically validated diagnostic device. Use synthetic/public permitted examples for development. Burned-in patient information can exist inside pixels; suppressing DICOM metadata is not complete de-identification. No uploads or analysis results are intentionally retained by the application, but the selected server necessarily processes the uploaded file. Multipart parsing may use temporary disk files, which are closed and removed after the request.

## Other features

- Doctor → Referrals & follow-up: a referral worklist for every patient (health-check date, attached report PDF, referral status) with Upload report PDF, Create & attach PDF, and Open referral & follow-up. Each patient now has their own referral journey
- Patient summary PDF in plain language (English or Finnish) with the symptoms from the health check, screening, lifestyle points and where to get help. Available from Reports and from the patient's own health-check summary
- **Doctor → AI workspace → Clinical agent (research):**
  - Chat about one patient, grounded in their record, with cited sections.
  - Draft a referral note, a patient message or an MDT summary. Each draft goes through a drafter, then a separate safety reviewer, and can be added to the referral note.
  - Run a Gemini CT read of the linked study.
  - Live Gemini calls go through the backend: the key stays on the server, and the doctor pastes the backend token into the page. Without live AI, every tool falls back to record-only answers labelled "without AI".
  - One agent calls specialist tools (patient record, CT read), with a separate safety reviewer for every draft.
- **AI second reader (research):** a precomputed Gemini read of each CT study, shown next to the radiologists on the Imaging review page and in PDF section 6, with agreement badges and caveats. It is never used for urgency or recommendations. Method, results and limits: [docs/ai-second-reader.md](docs/ai-second-reader.md); pipeline: `tools/ai-second-reader/`
- Doctor → Reports: **Approve report**. The doctor previews the report, confirms two checks and approves it, optionally releasing it to the patient's referral journey. The PDF then shows the approval; any later change to the content needs re-approval
- Doctor → Reports: a patient summary & oncology referral as an on-page preview and a PDF, in English or Finnish. It covers patient reference, care pathway, health-check date, family history and symptoms, the CT key image with the radiologists' outlines and findings, Lung-RADS, a planned AI comparison and a plain-language summary. The structure is explained in [docs/oncology-referral-framework.md](docs/oncology-referral-framework.md)
- Patient/doctor routing and searchable care worklist
- Session-only health summaries, message drafts and research preferences
- Example care journey, reminders and calendar download
- Separate schematic CT comparison (clearly labelled demo)
- Editable template reports, eight illustrative quality/equity metrics, CSV export and PDSA template
- Larger text, higher contrast, reduced motion and keyboard-friendly controls
- Optional local navigation agent: Transformers.js with the open-source MiniLM embedding model; reviewed answers, no medical advice

## Other open-source agent frameworks

Kanta/PACS and research registries are not connected.

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


## Reviewed report → appointment → referral demo

The new **Doctor → Reports** approval panel releases an immutable reviewed report to **CX-1042 / Aino Lehtinen** in this browser’s patient demo portal. It is separate from creating a draft: edits invalidate the approval checkbox, and the wrong patient reference is rejected.

1. In Doctor → Reports, prepare the findings and plan; preview them, tick explicit clinician approval and release the reviewed version.
2. Switch to Patient → Reports & appointments. Read/download the reviewed report, choose an offered future Helsinki-time slot and consultation method, and confirm the demo booking.
3. Switch to Doctor → Referrals & follow-up. Review the booking and explicitly simulate the follow-up as completed.
4. Record a referral as issued, pending or not required, with a reason and receiving service when issued.
5. Switch back to the patient view to see the recorded outcome. New report versions preserve booked appointments but invalidate the current follow-up/decision; old versions remain in history.

This is a **browser-local, persistent demonstration**, synchronised across tabs on the same origin through browser storage. It does not send email, contact a hospital, reserve a clinical appointment or provide authenticated accounts. Use fictional data only. Reset the journey in its Demo data controls to clear the stored report/booking/decision history. The demo sign-in is not authentication.

## Detailed regional map and KPI traffic lights

Quality Administrator → Overview and Quality & Equity now use actual Statistics Finland 2026 boundaries for all **19 maakunta administrative regions**, including Åland. These are not the 21 wellbeing services county boundaries. Region selection, metric selection, keyboard controls and map zoom are supported. Boundary data are bundled locally with attribution; no map API key or external tiles are needed. See [map sources](data/map-sources.md).

Selecting a region shows a short, indicator-specific next step and suggested owner only when its status is **Needs review** or **Urgent action**. Under-control and unassessed indicators do not produce recommendations. Prompts support service-level review; map values remain synthetic.

Every performance figure is synthetic. Green/yellow/red identify the configured service-review band; grey means missing data or no applicable verified threshold. The default profile uses verified Finnish references; optional local demo operating bands are explicitly not national standards. Recognised NHS England comparators are shown separately as external references, never relabelled Finnish or universal international standards. Yellow warning bands are Candex conventions.

See [KPI reference definitions](data/kpi-standards.md) for scope, event anchors, sources and limitations. No universal cancer-diagnosis, sensitivity or false-positive target is invented. A median below an individual deadline does not prove compliance, and service colours do not determine clinical urgency.

Additional checks:

```sh
node tests/referrals-store.mjs
node tests/referrals-client.cjs
node tests/regional-map.mjs
node tests/kpis.cjs
```


## Doctor patient-record lookup

**Doctor → Patient records** looks up an existing worklist patient by exact internal ID. Try `CX-1042`, `CX-1043`, `CX-1044` or `CX-1045`. Health checks submitted through the current demo can also be found by their generated `HC-2001`-style IDs. Patient worklist rows include a Patient record shortcut.

The view brings together the existing worklist identity, that ID’s submitted health-check information, linked public research CT reference, and browser-local reviewed report/appointment/referral history when it belongs to the same ID. Missing medicines, allergies or clinical facts are explicitly not recorded. Public research scans are not represented as the fictional person’s own images. Changing the query clears the old record immediately; queries are not put into URLs or persisted by the lookup.

This is a **synthetic-data interface demonstration**, not real record access. The demo sign-in and ID are not authentication. It does not accept Finnish personal identity codes or connect to Kanta. Real use requires authenticated staff identity, server-side patient/organisation authorisation, a lawful care relationship or other permitted access basis, audit controls and an authorised source system. A real identifier alone must never unlock a record.

Test: `node tests/patient-records.cjs` covers exact matching, role guards, submitted health IDs, cross-patient isolation, safe text rendering and clearing of stale results. Browser visual testing remains separate.
