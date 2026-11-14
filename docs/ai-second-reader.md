# AI second reader: research comparison

**Exploratory. Prototype for research use only; not a medical device, not CE-marked.** On 5 nodules from 5 public LIDC-IDRI scans, the published read found 4/5 on the correct side (95% CI 28–99%). Every model tested underestimated nodule size and was confident when it was wrong. No conclusion about clinical performance can be drawn.

## What the app shows
- **Doctor → Imaging review → "AI second reader (research)":** the model's finding next to the radiologists' reference, with an agreement badge.
  - The card shows: found, side and lobe, size, Lung-RADS, composition, the slice the AI pointed to, and its confidence (not calibrated).
  - The AI's own report text is behind a fold.
  - The card warns about misses and findings on the wrong side.
- **Doctor → Reports → PDF section 6, "AI second reader: research comparison":** the one-line AI finding with the verdict, the comparison table, the AI's report text (verbatim), provenance and caveats.
- **What the AI read never sets:** urgency, the bottom line or the recommendations. A test checks this.
- **Approval:** a report approval covers the AI rows and the AI export version, so a new export needs re-approval.
- **Data:** reads are precomputed into `data/lidc/ai-reads.js` by `tools/ai-second-reader/`. The browser never calls an AI service and no API key is in the site.

## Method
- **Data:** 5 public LIDC-IDRI CT studies, one per approximate Lung-RADS band: 0317, 0977, 0799, 0365, 0116. The reference is the LIDC radiologists' outlines and ratings.
- **Reference rule:** all 5 main nodules. Also reported: the LUNA16-style consensus subset, nodules marked by at least 3 of 4 readers (0116, 0365, 0799). 0317 had 2 readers and 0977 had 1.
- **Blind read:** the model never sees the radiologists' outlines or ratings, and it gets the pixel scale. Lung-RADS is approximated by the team; LIDC-IDRI has no Lung-RADS labels.
- **Models:** 10 Gemini and Gemma models were compared with the same input (3 slices). Then input and prompt variants were tested on the 3 best models, 135 calls in total. Leaderboards are in `tools/ai-second-reader/`.
- **Published configuration:** `gemini-4-argon`, given all 11 excerpt slices from the original DICOM at 512 px (lung window) plus one soft-tissue window slice, with a plain prompt, a single call at temperature 0 and no voting. The model's image coordinates were unreliable (vertical offsets around 180 px), so only the slice it named is shown, not a marker.
- **What did not help:**
  - more slices at low resolution
  - zoomed tiles
  - a "search first" prompt
  - giving the Lung-RADS thresholds in the prompt (categories then followed its too-small measurements)
  - 3-run majority voting (3× the cost, no gain, still overconfident)

## Results of the published read

| Study | Readers | AI | Verdict |
|---|---|---|---|
| 0317 (4.1 mm, LR 2) | 2/4 | left upper lobe, 4.9 mm, LR 2 | agrees |
| 0799 (8.4 mm, LR 4A) | 4/4 | right, 8.2 mm, LR 4A | agrees |
| 0116 (27.6 mm, 4X-like) | 4/4 | right, 19.5 mm, LR 4B | partly (undersized) |
| 0365 (18.8 mm, LR 4B) | 4/4 | left, 12.7 mm, LR 4A | partly (undersized) |
| 0977 (8.0 mm, LR 3) | 1/4 | finding on the **right**; nodule is on the left | disagrees (miss plus possible false positive) |

- **Detection:** found on the correct side 4/5 (95% CI 28–99%, Clopper–Pearson). Consensus nodules: 3/3.
- **Size:** mean signed error −3.4 mm and mean absolute error 3.8 mm on the hits. With n = 4, no Bland–Altman limits are given.
- **Confidence:** 0.75 on the wrong-side finding. Across all experiments, misses still had 0.75–0.95 confidence, so it is shown as "not calibrated".
- **Reporting:** with n = 5, no kappa or calibration metrics are reported. These items follow CLAIM 2024, TRIPOD-LLM and STARD: reference standard, case selection, model, prompt and date, uncertainty, and limitations.

## Limitations
- **Not a search of the whole scan:** each excerpt is centred on the nodule, so this tests describing a nodule, not finding one in a full scan.
- **Possible training-data exposure:** LIDC-IDRI is public and widely redistributed, so the models may have seen these images or annotations during training. That would inflate agreement.
- **General-purpose models**, not validated for medical imaging. Published evaluations of GPT-4V and Gemini on CT report missed small nodules, invented findings, size errors and poor calibration. Our results match that pattern.

## Regulation and data protection (summary; verify before relying on it)
- **EU AI Act:** an AI that outputs Lung-RADS categories for patient care would be high-risk under the EU AI Act (Reg. (EU) 2024/1689, Art. 6(1), Annex I), as a medical device needing notified-body review. Research-only systems that aren't placed on the market are exempt (Art. 2(6), 2(8)).
- **MDR (EU) 2017/745 Rule 11:** software informing diagnosis is at least class IIa, and IIb if errors could seriously harm health.
- **Finland:** the competent authority is Fimea. Secondary use of real health data needs a Findata permit (Act 552/2019).
- **Gemini API terms** prohibit clinical use. On the free tier, inputs may be used to improve Google's products and reviewed by people.
- **Real patient images** are GDPR special-category data. They would need all of the following:
  - a legal basis
  - a data protection impact assessment
  - a data processing agreement with EU data residency
  - a Findata permit
- This prototype only sends public, de-identified research images.

## Data citation
LIDC-IDRI, The Cancer Imaging Archive, CC BY 3.0, doi:10.7937/K9/TCIA.2015.LO9QL9SX. Cite:
- Armato SG III et al., Medical Physics 2011;38(2):915–931, doi:10.1118/1.3528204
- Clark K et al., J Digit Imaging 2013, doi:10.1007/s10278-013-9622-7

Changes made to the images: an 11-slice excerpt, lung window, resized to 384 px.
