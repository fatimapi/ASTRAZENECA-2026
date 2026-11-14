// Candex imaging review: pick any worklist patient and review a CT study.
// The studies are 5 public LIDC-IDRI research CTs (data/lidc/cases.js, made by
// candex-data/export_ct.py). They are NOT the fictional patients' own scans:
// a study is linked to a patient for the demo. Outlines are the LIDC
// radiologists' own nodule markings. No imaging AI runs here.
// Loaded before app.js; uses its helpers (heading, badge, icon, esc, patients,
// state, render, navigate) at call time.
(() => {
// Translate a piece of text now (Finnish when selected). Used for text built
// from several parts, which the page-level translator cannot match whole.
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const CASES = window.candexLidc || {};
const ORDER = ['LIDC-IDRI-0799', 'LIDC-IDRI-0365', 'LIDC-IDRI-0116', 'LIDC-IDRI-0977', 'LIDC-IDRI-0317'].filter(id => CASES[id]);
const STORE = 'candex-imaging-links';
let links = {'CX-1042': 'LIDC-IDRI-0799'};
try { Object.assign(links, JSON.parse(sessionStorage.getItem(STORE) || '{}')); } catch { /* storage unavailable */ }
const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(links)); } catch { /* ignore */ } };
const sliceAt = {}; // case id -> current slice index

// Lung-RADS v2022 management, used to explain the approximate category.
const LUNG_RADS = {
  '2': ['Benign appearance or behaviour', 'Continue annual low-dose CT screening.'],
  '3': ['Probably benign', 'Low-dose CT in 6 months.'],
  '4A': ['Suspicious', 'Low-dose CT in 3 months; PET/CT may be used for solid parts of 8 mm or more.'],
  '4B': ['Very suspicious', 'Diagnostic chest CT, PET/CT and/or tissue sampling, depending on the probability of cancer.'],
  '4X-like': ['Very suspicious, with additional features', 'As 4B. Here, "4X-like" means large with high radiologist malignancy and spiculation ratings.'],
};
const MALIGNANCY = ['', 'Highly unlikely', 'Moderately unlikely', 'Indeterminate', 'Moderately suspicious', 'Highly suspicious'];

function autoLink(pid) {
  if (links[pid] || !ORDER.length) return;
  const used = new Set(Object.values(links));
  links[pid] = ORDER.find(id => !used.has(id)) || ORDER[Object.keys(links).length % ORDER.length];
  save();
}

const overlaySVG = frame => (state.overlay ? frame.outlines.map(o => `<polygon points="${o.pts.map(p => p.join(',')).join(' ')}" class="${o.n === 0 ? 'ct-main' : 'ct-other'}"/>`).join('') : '');
const caption = (c, i) => `Slice ${i + 1} of ${c.frames.length} around the main nodule · table position ${c.frames[i].z} mm · lung window${c.frames[i].outlines.length ? ` · ${c.frames[i].outlines.length} radiologist outline${c.frames[i].outlines.length === 1 ? '' : 's'} on this slice` : ''}`;

function contextLines(p) {
  const h = window.candexScreening?.healthPatient(p.id);
  if (!h) return `<p translate="no">${esc(p.age)} ${T('years')} · ${esc(T(p.region))} · ${esc(T(p.type))}. ${T('Clinical information is fictional.')}</p>`;
  const r = window.candexScreening.assess(h);
  return `<p translate="no">${esc(p.age)} ${T('years')} · ${esc(T(h.sex || 'Sex not stated'))} · ${esc(T(p.region))}</p><p translate="no">${T('From the patient health check')}: ${esc(T(h.smoking || 'Smoking not stated'))}${r.py != null ? ` (${r.py} ${T('pack-years')})` : ''}${r.lungEligible ? ` · ${T('meets USPSTF lung-screening criteria')}` : ''}${r.symptoms.length ? ` · ${T('symptoms reported')}: ${r.symptoms.length}` : ''}</p>`;
}

function picker(p) {
  return `<section class="card scan-picker"><div class="field"><label for="scan-patient">${icon('users')}Reviewing patient</label><select id="scan-patient">${patients.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)} · ${esc(x.id)} · ${esc(T(x.type))}${links[x.id] ? ` · ${T('CT linked')}` : ''}</option>`).join('')}</select></div><div class="field"><label for="scan-study">${icon('scan')}Linked CT study (public LIDC-IDRI)</label><select id="scan-study"><option value="">No study linked</option>${ORDER.map(id => `<option value="${id}" ${links[p.id] === id ? 'selected' : ''}>${id} · approx. Lung-RADS ${CASES[id].band} · main nodule ${CASES[id].nodules[0].diameter} mm</option>`).join('')}</select></div></section>`;
}

function decisionForm() {
  return `<section class="card"><div class="card-head"><h2>Structured decision support</h2>${icon('doctor')}</div><form id="decision-form"><div class="field"><label for="decision">What is the next clinical action?</label><select id="decision" name="decision"><option value="">Select for this demonstration</option><option value="Surveillance / repeat imaging">Surveillance / repeat imaging</option><option value="Further imaging or specialist investigation">Further imaging or specialist investigation</option><option value="Biopsy / pathology assessment">Biopsy / pathology assessment</option><option value="Discuss at multidisciplinary team review">Discuss at multidisciplinary team review</option></select></div><div class="field space-top"><label for="rationale">Review notes</label><textarea id="rationale" name="rationale" placeholder="Record your reasoning. Use fictional details only." maxlength="1500"></textarea></div><button class="button space-top" type="submit">Prepare review draft${icon('arrow')}</button></form></section>`;
}

function scanView() {
  const p = patients.find(x => x.id === state.selected) || patients[0];
  state.selected = p.id;
  const c = CASES[links[p.id]];
  const head = `${heading('A second look. A fuller picture.', 'Choose a patient from the worklist and review their linked CT study with the radiologists’ outlines.', 'Clinical imaging', `<button class="button secondary" data-action="upload">${icon('upload')}Analyze chest X-ray DICOM</button>`)}`;
  if (!c) {
    return `${head}${demoNotice('Imaging review · Link one of 5 public LIDC-IDRI research CT studies to try the viewer. No imaging AI has run.')}${picker(p)}<section class="card empty-scan"><div class="empty-scan-icon">${icon('scan')}</div><h2>No CT study linked for ${esc(p.name)}</h2><p translate="no">${esc(T(p.type))} · ${esc(T(p.reason))}</p><p>Choose a study above to open the viewer, or analyse a chest X-ray DICOM with the research model.</p></section>${decisionForm()}`;
  }
  const i = Math.min(sliceAt[c.id] ?? c.centre, c.frames.length - 1);
  const f = c.frames[i], main = c.nodules[0], [meaning, action] = LUNG_RADS[c.band] || ['', ''];
  return `${head}${demoNotice(`Real public CT from LIDC-IDRI (${c.id}), linked to this fictional patient for the demo. It is not ${esc(p.name)}’s own scan. Outlines are the LIDC radiologists’ markings. No imaging AI has run.`)}${picker(p)}
<div class="scan-layout"><div class="stack"><section class="scan-viewer"><div class="scan-toolbar"><span>${esc(p.id)} · ${esc(p.name)}</span>${badge(`${c.id} · CT`)}</div>
<div class="scan-stage ct-stage"><div class="ct-frame"><img id="ct-img" src="${f.src}" width="384" height="384" alt="Axial chest CT slice from public study ${c.id}"><svg id="ct-overlay" viewBox="0 0 384 384" aria-hidden="true">${overlaySVG(f)}</svg></div></div>
<p class="scan-caption" id="ct-caption">${caption(c, i)}</p>
<div class="scan-controls ct-controls"><label class="ct-slider" for="ct-slice">Slice <input type="range" id="ct-slice" min="0" max="${c.frames.length - 1}" value="${i}"></label><button type="button" data-action="ct-centre">Go to nodule centre</button><label><input type="checkbox" id="overlay" ${state.overlay ? 'checked' : ''}>Show radiologist outlines</label></div></section>
<section class="card"><div class="card-head"><h2>Radiologist reference</h2>${badge(`${main.readers} of 4 LIDC readers`, 'neutral')}</div>
<div class="data-line"><span>Main nodule · mean diameter</span><strong>${main.diameter} mm</strong></div>
<div class="data-line"><span>Approximate Lung-RADS category</span><strong translate="no">${c.band} · ${T(meaning)}</strong></div>
<div class="data-line"><span>Malignancy rating (1–5, readers’ mean)</span><strong translate="no">${main.malignancy} · ${T(MALIGNANCY[Math.round(main.malignancy)])}</strong></div>
<div class="data-line"><span>Spiculation (1–5)</span><strong>${main.spiculation}</strong></div>
<div class="data-line"><span>Other nodules marked</span><strong>${c.nodules.length - 1}</strong></div>
<div class="data-line"><span>Slice thickness · pixel size</span><strong>${c.sliceMm} mm · ${c.pixelMm} mm</strong></div>
<p style="font-size:.7rem;margin-top:13px"><span translate="no">${T('Lung-RADS v2022 suggests:')} ${T(action)}</span> The category here is approximated from the readers’ size and ratings; LIDC-IDRI has no Lung-RADS labels.</p></section></div>
<div class="stack"><section class="card"><div class="card-head"><h2>Review notes</h2>${badge('Needs clinician review', 'amber')}</div><ul class="findings"><li><strong><span class="finding-dot"></span>Main nodule · ${main.diameter} mm</strong><p>Marked by ${main.readers} radiologist${main.readers === 1 ? '' : 's'}. Use the slider to follow it through the slices and confirm on the full study.</p></li><li><strong>Clinical context</strong>${contextLines(p)}</li><li><strong>AI model</strong><p>Not connected for CT. A lung-nodule detector (for example MONAI) could add its own outline here for comparison with the radiologists.</p></li></ul></section>${decisionForm()}</div></div>
<p class="field-note" style="margin-bottom:24px">Images: LIDC-IDRI, The Cancer Imaging Archive (CC BY 3.0). Armato SG III et al., Medical Physics 2011;38(2):915–931.</p>`;
}

function showSlice(i) {
  const p = patients.find(x => x.id === state.selected), c = p && CASES[links[p.id]];
  if (!c) return;
  i = Math.max(0, Math.min(c.frames.length - 1, i));
  sliceAt[c.id] = i;
  const q = sel => document.querySelector(sel);
  const img = q('#ct-img'), svg = q('#ct-overlay'), cap = q('#ct-caption'), range = q('#ct-slice');
  if (img) img.src = c.frames[i].src;
  if (svg) svg.innerHTML = overlaySVG(c.frames[i]);
  if (cap) cap.textContent = T(caption(c, i));
  if (range && +range.value !== i) range.value = i;
}

document.addEventListener('input', e => { if (e.target.id === 'ct-slice') showSlice(+e.target.value); });
document.addEventListener('change', e => {
  if (e.target.id === 'scan-patient') { state.selected = e.target.value; render(); }
  if (e.target.id === 'scan-study') { if (e.target.value) links[state.selected] = e.target.value; else delete links[state.selected]; save(); render(); }
});
// "Imaging review" buttons on the worklist, workspace and patient dialogs.
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-scan]');
  if (!b) return;
  state.selected = b.dataset.scan;
  const d = document.querySelector('#dialog');
  if (d?.open) d.close();
  navigate('care/scan');
});

window.candexImaging = {
  scanView, autoLink, links, CASES,
  actions: {'ct-centre': () => { const p = patients.find(x => x.id === state.selected), c = p && CASES[links[p.id]]; if (c) showSlice(c.centre); }},
};
})();
