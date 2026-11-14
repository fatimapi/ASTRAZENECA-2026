# Candex oncology referral framework

How the Doctor → Reports PDF ("Patient summary & oncology referral") is structured, and where every field comes from. It refines a general oncology imaging-report framework for Candex's actual situation: **a pre-diagnostic referral built from a health check and one baseline CT**, not follow-up of a treated cancer.

The report is generated in English or Finnish (*Report language* selector). Every report is an **unsigned draft** that a clinician must review and sign. Patients are fictional, and the CT studies are public LIDC-IDRI research scans linked to them for the demonstration.

## What changed from the original framework

| Original framework | Candex refinement | Why |
|---|---|---|
| Primary tumour histology, molecular markers, current treatment | Stated explicitly as **absent**: "No known cancer diagnosis… pre-diagnostic referral". If the health check reports a previous cancer, the report asks for details from Kanta | Our patients have no diagnosis yet. Saying so is clearer than leaving the fields blank |
| Most recent prior scan + baseline/nadir scan | "None available"; "This study is the baseline. Interval change and treatment response are not assessable" | Each simulated patient has a single CT |
| Contrast phase, slice thickness, artefacts | Slice thickness, pixel size and image count from the DICOM metadata; contrast "not recorded"; the 11-slice excerpt named as the main limitation | Only what the data supports |
| Size in two orthogonal dimensions | **Long × short axis computed from the radiologists' outlines** on the key image, plus the readers' mean diameter and craniocaudal extent | LIDC gives 4 readers' contours per slice |
| Nodal disease, distant metastases | **"Not evaluated"**, with the step needed (full-study review, PET/CT) | Only slices around the nodule were exported. "Not evaluated" is never presented as negative |
| RECIST / iRECIST / LI-RADS / PI-RADS | **Lung-RADS v2022**, approximated from reader size and ratings, with its management step | RECIST measures treatment response; screening-detected lung nodules use Lung-RADS |
| Treatment-related changes | "Not applicable: no cancer treatment has been given" | Pre-diagnostic |
| — | **New: health-check context.** Symptoms with red flags and duration, family history pattern, pack-years and USPSTF eligibility, AUDIT-C, BMI, radon, work exposures, screening status | The referral's reason usually comes from the patient's own report |
| — | **New: access and equity.** Language with interpreter flag, travel time, usual place of care, access support | Candex's equity aim: the receiving team can plan support before booking |
| — | **New: AI second reader (research comparison)**. Precomputed Gemini read vs radiologists with agreement, AI report text and caveats (see `docs/ai-second-reader.md`) | Shows what an AI adds and where it fails, without letting it drive decisions |
| Patient-accessible clarity | A separate **plain-language summary** section and a glossary | Patients read reports in OmaKanta before seeing the doctor |

## Report structure and data sources

**Bottom line** (top of page 1, repeated in the Impression): the category or main reason, the size and side, the urgency and the destination, e.g. *"Lung-RADS 4B (approximated), very suspicious: 18.6 × 15.5 mm solid nodule in the left lung. Urgent referral to Pulmonology / lung cancer MDT."*

1. **Patient & referral details.** The ID and fictional name (worklist); age and sex; wellbeing services county; preferred language (an interpreter is flagged unless Finnish, Swedish or English); usual place of care; travel time; contact preference; access support; **date the health check was submitted** (`screening.js`, stored per browser tab).
2. **Care pathway.** Pathway, worklist status and review priority (clinical need only); worklist reason. The latest reviewed report, appointment, follow-up and referral decision come from `referral-store.js`, Aino only. The destination service (automatic, or chosen) and urgency complete the section.
3. **Clinical context.** Oncologic history; reason for the check; **symptoms with red-flag labels and duration**; **family history**; smoking with pack-years; USPSTF lung-screening eligibility; AUDIT-C; BMI; radon; work exposures; other lifestyle factors; screening programme status. The referring clinician's note is added if given.
4. **Imaging: comparison & technique.** Study ID and provenance; technique; contrast; prior and baseline scans; limits on accuracy (`data/lidc/cases.js`).
5. **Structured findings.**
   - Key image (the slice with the most reader outlines at the nodule centre) with the outlines drawn, plus a ×4 zoom.
   - **Primary lesion:** side and image half (lobe to be confirmed), long × short axis, craniocaudal extent, composition from the LIDC texture rating, margin from spiculation, the readers' malignancy rating, reader agreement, key image number and table position. Invasion is marked "not evaluated".
   - **Other nodules**: each with size, composition and readers, or a pertinent negative ("No other nodules ≥ 3 mm marked by the 4 radiologists in the full study").
   - **Nodal disease** and **distant metastases**: "Not evaluated", with the step needed.
   - **Standardised category**: Lung-RADS v2022 (approximated), with its caveat.
   - **Treatment-related changes**: not applicable.
6. **AI second reader: research comparison.** The precomputed AI finding in one line, with its verdict (agrees, partly agrees or disagrees); a table of radiologists vs AI vs agreement (detection, side and lobe, size, composition, Lung-RADS, slice, confidence); the AI report text verbatim; and provenance with the exploratory result (95% CI), the training-data caveat and "not used for urgency or recommendations". If no read exists, it shows *Pending*. Details: `docs/ai-second-reader.md`.
7. **Impression.**
   - The bottom line.
   - **Key findings in order of importance**, each with measurements and the key-image reference.
   - **Pertinent negatives**, only where the data supports them.
   - An explicit "not evaluated, so not negative" line.
   - **Recommendations**: the Lung-RADS management step; confirming the lobe, nodes and metastases on the full study; smoking cessation; clinical genetics; radon; screening invitations that are due; interpreter; access support; named owner and response time (urgent: 3 working days; soon: 2 weeks).
8. **For the patient: plain-language summary.** What was seen, what the category means, what happens next, and that the draft is not yet checked. Followed by a glossary (CT, LDCT, Lung-RADS, PET/CT, MDT, AUDIT-C, pack-year, USPSTF).
9. **Sign-off.** Status (unsigned draft), when prepared, who must sign, data provenance and the LIDC-IDRI citation.

## Clinician approval

A report becomes **Approved** only after the doctor:
1. previews the current version
2. ticks *"I have reviewed the patient details, findings and key image"*
3. ticks *"The recommendations, destination and urgency are clinically appropriate"*

Approving can also release the report into that patient's referral journey: the patient portal shows it, and booking and the referral decision open up.

Once approved:
- The PDF banner, sign-off and patient wording change, e.g. "Your doctor has reviewed this summary…".
- The approval is tied to a fingerprint of the clinical content. Switching between English and Finnish keeps it. Any content change (note, destination, health-check answers, linked CT) shows **"Changed since approval"** until the doctor re-approves, which creates a new version. **Withdraw approval** returns the report to draft.

This is a demonstration approval, not a legal e-signature. A real service would need strong authentication and a signed audit trail.

## Language rules applied

- **No hedging.** Each statement is either a finding with its measurement, an explicit "not evaluated" with the step that would evaluate it, or a recommendation with a time frame. The report never says "cannot be ruled out" or "clinical correlation recommended".
- **Missing is not negative.** Fields without data read "Not recorded" (*Ei kirjattu*). Tests check this.
- **Urgency comes from clinical need only.** The Lung-RADS category and red-flag symptoms set it; region, language and income never do. Equity information is used to plan support.
- **Acronyms are defined** in the glossary and in the plain-language section.

## Rules used (and their limits)

- Lung-RADS v2022 (American College of Radiology) management steps. The category is approximated from LIDC reader size and ratings, and part-solid and ground-glass rules are simplified.
- USPSTF 2021 lung-screening criteria: age 50–80, ≥ 20 pack-years, current smoker or quit within 15 years.
- AUDIT-C thresholds from the Finnish Current Care guideline: ≥ 6 for men, ≥ 5 for women.
- STUK radon reference level: 300 Bq/m³.
- LIDC texture → composition: ≥ 4 solid, 2–3.9 part-solid, < 2 ground-glass.

Implementation: `referral-report.js` (build, preview, PDF), `referral-report.css`, tests in `tests/referral-report.cjs`. The PDF uses jsPDF 2.5.1, loaded from cdnjs with an integrity hash when *Download PDF* is pressed. If it can't load (offline), the preview opens for the browser's *Print → Save as PDF*.
