# Candex — No patient left behind

Accessible, purple patient and clinician prototype based on Brainstorming.pdf. Covers all-cancer care coordination with a detailed lung imaging example.

## Working features

- Patient/doctor routing, searchable and filterable worklist
- Session-only health summary and draft messages
- Care journey, sample calendar export and research preference demonstration
- Schematic lung review, prior/current examples and annotation toggle
- Structured clinical decisions, editable report preview and text export
- Eight illustrative quality/equity indicators, CSV export and PDSA template
- Larger text, contrast, reduced motion, keyboard controls and responsive layouts
- Browser-local retrieval agent using Transformers.js 3.8.1 and Xenova/all-MiniLM-L6-v2. It matches questions to reviewed platform guidance; it does not perform medical inference. Model download is opt-in, approximately 23 MB. Static topic matching works without AI.

## Clinical services

All records, appointments, findings and metrics are fictional. No medical service, record repository or imaging AI is connected. No clinical validation or outcome improvement is claimed.

The medical-agent workspace links verified open-source projects and describes a server integration contract:

- MedRAX: https://github.com/bowang-lab/MedRAX (Apache-2.0), chest X-ray research, external Python/model service required.
- mAIstro: https://github.com/eltzanis/mAIstro (Apache-2.0), research and radiomics, external Python/model service required.
- Radiology Swarm: https://github.com/The-Swarm-Corporation/radiology-swarm (MIT), framework requiring engineering review/repair and an external model service.

Do not add API credentials to browser assets. A real implementation needs authenticated backend services, suitable models/compute, data governance and clinician review.

## Run locally

Plain HTML/CSS/JavaScript. Serve the folder over HTTP so JavaScript modules work, then visit
http://localhost:8000.

With Node.js 20 or newer:

```sh
npm install      # once
npm run dev      # serve the project folder at http://localhost:8000
npm run build    # check the JavaScript for errors and copy the site into dist/
npm start        # serve the built dist/ folder at http://localhost:8000
```

Without Node.js:

```sh
python3 -m http.server 8000
```

## Upload to GitHub

Create a repository under your team's organisation, extract this ZIP, then upload the contents of the Candex folder to the repository root. The entry point is index.html.

For optional GitHub Pages hosting, use Settings > Pages > Deploy from a branch > main > /(root), if available to your organisation. Uploading source alone does not publish the site.

## External dependencies

Google Fonts supplies fonts. The optional AI guide loads Transformers.js from jsDelivr and model assets from Hugging Face after you enable it. Medical AI services are not connected.

This portable source package excludes Git metadata and the original Site hosting configuration. No API credentials are included.
