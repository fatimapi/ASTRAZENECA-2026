// Candex imaging review: pick any worklist patient and review a CT study.
// The studies are 5 public LIDC-IDRI research CTs (data/lidc/cases.js, made by
// candex-data/export_ct.py). They are NOT the fictional patients' own scans:
// a study is linked to a patient for the demo. Outlines are the LIDC
// radiologists' own nodule markings. AI reads are precomputed research output
// from ai-second-reader.js (data/lidc/ai-reads.js); no AI service is called here.
// Loaded before app.js; uses its helpers (heading, badge, icon, esc, patients,
// state, render, navigate) at call time.
(() => {
// Translate a piece of text now (Finnish when selected). Used for text built
// from several parts, which the page-level translator cannot match whole.
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const CASES = window.candexLidc || {};
// Every exported study. The first five keep their original order so existing
// links stay the same (Aino → 0799; the next lung patient → 0365); the rest
// follow by approximate Lung-RADS band, then ID.
const BANDS = ['2', '3', '4A', '4B', '4X-like'];
const FIRST = ['LIDC-IDRI-0799', 'LIDC-IDRI-0365', 'LIDC-IDRI-0116', 'LIDC-IDRI-0977', 'LIDC-IDRI-0317'].filter(id => CASES[id]);
const ORDER = [...FIRST, ...Object.keys(CASES).filter(id => !FIRST.includes(id)).sort((a, b) => BANDS.indexOf(CASES[a].band) - BANDS.indexOf(CASES[b].band) || a.localeCompare(b))];
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

const overlaySVG = (frame, c, i) => (state.overlay ? frame.outlines.map(o => `<polygon points="${o.pts.map(p => p.join(',')).join(' ')}" class="${o.n === 0 ? 'ct-main' : 'ct-other'}"/>`).join('') : '')
  + (state.aiMarker && c && window.candexAi ? window.candexAi.markerSVG(c, i) : '');
const caption = (c, i) => `Slice ${i + 1} of ${c.frames.length} around the main nodule · table position ${c.frames[i].z} mm · lung window${c.frames[i].outlines.length ? ` · ${c.frames[i].outlines.length} radiologist outline${c.frames[i].outlines.length === 1 ? '' : 's'} on this slice` : ''}`;

function contextLines(p) {
  const h = window.candexScreening?.healthPatient(p.id);
  if (!h) return `<p translate="no">${esc(p.age)} ${T('years')} · ${esc(T(p.region))} · ${esc(T(p.type))}. ${T('Clinical information is fictional.')}</p>`;
  const r = window.candexScreening.assess(h);
  return `<p translate="no">${esc(p.age)} ${T('years')} · ${esc(T(h.sex || 'Sex not stated'))} · ${esc(T(p.region))}</p><p translate="no">${T('From the patient health check')}: ${esc(T(h.smoking || 'Smoking not stated'))}${r.py != null ? ` (${r.py} ${T('pack-years')})` : ''}${r.lungEligible ? ` · ${T('meets USPSTF lung-screening criteria')}` : ''}${r.symptoms.length ? ` · ${T('symptoms reported')}: ${r.symptoms.length}` : ''}</p>`;
}

function picker(p) {
  return `<section class="card scan-picker"><div class="field"><label for="scan-patient">${icon('users')}Reviewing patient</label><select id="scan-patient">${patients.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)} · ${esc(x.id)} · ${esc(T(x.type))}${links[x.id] ? ` · ${T('CT linked')}` : ''}</option>`).join('')}</select></div><div class="field"><label for="scan-study">${icon('scan')}Linked CT study (public LIDC-IDRI)</label><select id="scan-study"><option value="">No study linked</option>${BANDS.map(b => { const ids = ORDER.filter(id => CASES[id].band === b); return ids.length ? `<optgroup label="${T('Approx. Lung-RADS')} ${b}">${ids.map(id => `<option value="${id}" ${links[p.id] === id ? 'selected' : ''}>${id} · approx. Lung-RADS ${CASES[id].band} · main nodule ${CASES[id].nodules[0].diameter} mm${window.candexAi?.read(id) ? ` · ${T('AI read')}` : ''}</option>`).join('')}</optgroup>` : ''; }).join('')}</select></div></section>`;
}

function decisionForm() {
  return `<section class="card"><div class="card-head"><h2>Structured decision support</h2>${icon('doctor')}</div><form id="decision-form"><div class="field"><label for="decision">What is the next clinical action?</label><select id="decision" name="decision"><option value="">Select for this demonstration</option><option value="Surveillance / repeat imaging">Surveillance / repeat imaging</option><option value="Further imaging or specialist investigation">Further imaging or specialist investigation</option><option value="Biopsy / pathology assessment">Biopsy / pathology assessment</option><option value="Discuss at multidisciplinary team review">Discuss at multidisciplinary team review</option></select></div><div class="field space-top"><label for="rationale">Review notes</label><textarea id="rationale" name="rationale" placeholder="Record your reasoning. Use fictional details only." maxlength="1500"></textarea></div><div class="form-actions" style="justify-content:flex-start"><button class="button" type="submit">Prepare review draft${icon('arrow')}</button><button class="button secondary" type="button" data-report="${esc(state.selected || '')}">${icon('file')}Referral report</button></div></form></section>`;
}

// Doctor marks the CT and X-ray analysis complete; the patient's pathway updates (care-journey.js).
function analysisCard(p, c) {
  const J = window.CandexJourney; if (!J) return '';
  const done = J.imaging(p.id), xray = !!(c && window.candexCxrReads?.cases?.[c.id]);
  const when = done ? new Intl.DateTimeFormat(window.candexI18n?.lang === 'fi' ? 'fi-FI' : 'en-GB', {timeZone: 'Europe/Helsinki', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(new Date(done.at)) : '';
  return `<section class="card analysis-card${done ? ' is-done' : ''}"><div class="card-head"><h2>${T('CT and X-ray analysis')}</h2>${done ? badge(T('Completed')) : badge(T('Not completed'), 'amber')}</div>
${done ? `<p>${T('Completed by')} <strong translate="no">${esc(done.by)}</strong> · <span translate="no">${esc(when)}</span>. ${T('The patient’s pathway now shows the CT and X-ray step as done, and the report can be released.')}</p><button type="button" class="text-btn" data-action="imaging-undo">${T('Undo')}</button>`
    : c ? `<p>${T('When you have reviewed the CT study')}${xray ? ` ${T('and the chest X-ray')}` : ''}, ${T('mark the analysis complete. The patient’s pathway moves on, and the report can then be released.')}</p><button type="button" class="button" data-action="imaging-complete">${icon('check')}${T('Mark CT and X-ray analysis complete')}</button>`
    : `<p>${T('Link a CT study for this patient first.')}</p>`}</section>`;
}
// Analysis section drop-down (CT or X-ray); both sections share one layout.
function modeSelect() {
  return `<section class="card scan-mode"><div class="field"><label for="scan-mode">${icon('scan')}${T('Analysis')}</label><select id="scan-mode"><option value="ct" ${state.scanMode !== 'xray' ? 'selected' : ''}>${T('CT analysis')}</option><option value="xray" ${state.scanMode === 'xray' ? 'selected' : ''}>${T('X-ray analysis')}</option></select></div></section>`;
}
function xraySection(p, c) {
  const x = c && window.candexCxrReads?.cases?.[c.id], L = window.candexI18n?.lang === 'fi' ? 'fi' : 'en';
  if (!x) return `<section class="card empty-scan"><div class="empty-scan-icon">${icon('scan')}</div><h2>${T('No chest X-ray for this study')}</h2><p>${T('Analyse a chest X-ray DICOM to get classifier scores and an AI summary.')}</p><button class="button" data-action="upload">${icon('upload')}${T('Analyze chest X-ray DICOM')}</button></section>`;
  const top = [...x.scores].sort((a, b) => b.score - a.score);
  const shown = [...top.slice(0, 6), ...top.filter(s => ['Nodule', 'Mass'].includes(s.label) && !top.slice(0, 6).includes(s))];
  const n = v => (L === 'fi' ? v.toFixed(2).replace('.', ',') : v.toFixed(2));
  const ok = x.review?.verdict === 'consistent with the raw data';
  return `<div class="scan-layout"><div class="stack"><section class="scan-viewer"><div class="scan-toolbar"><span>${esc(p.id)} · ${esc(p.name)}</span>${badge(`${c.id} · ${T('X-ray')}`)}</div>
<div class="scan-stage xray-stage"><img src="${esc(x.image)}" alt="${esc(T('Frontal chest X-ray of the linked public study'))}"></div>
<p class="scan-caption">${T('Frontal chest X-ray of the linked public study, as given to the classifier.')} ${esc(T(x.viewNote ? 'View checked from headers; see note.' : 'View from headers.'))}</p></section>
<section class="card"><div class="card-head"><h2>${T('Classifier scores (raw)')}</h2>${badge('TorchXRayVision', 'neutral')}</div>
${shown.map(s => `<div class="data-line"><span translate="no">${esc(s.label)}</span><strong>${n(s.score)}</strong></div>`).join('')}
<p style="font-size:.7rem;margin-top:13px">${T('Uncalibrated scores from 0 to 1: not probabilities, no threshold. This classifier is not a nodule detector; suspected nodules need CT.')}</p></section></div>
<div class="stack"><section class="card"><div class="card-head"><h2>${T('AI summary of the scores')}</h2>${ok ? badge(T('Safety review: consistent')) : badge(T('Safety review: needs changes'), 'amber')}</div><p translate="no">${esc(x.summary[L])}</p><ul class="findings" translate="no">${(x.keyPoints?.[L] || []).map(k => `<li><p>${esc(k)}</p></li>`).join('')}</ul></section>
<section class="card"><div class="card-head"><h2>${T('Review notes')}</h2>${badge(T('Needs clinician review'), 'amber')}</div><p>${T('Compare the X-ray with the CT findings. A low Nodule or Mass score never rules out a nodule.')}</p><button class="text-btn" data-action="upload">${T('Analyse another chest X-ray DICOM')}${icon('arrow')}</button></section></div></div>`;
}
// Imaging review: a short overview, the two analysis pages, and this patient's results.
const L2 = () => (window.candexI18n?.lang === 'fi' ? 'fi' : 'en');
const n1 = v => { const x = Number(v).toFixed(1); return L2() === 'fi' ? x.replace('.', ',') : x; };
const n2 = v => { const x = Number(v).toFixed(2); return L2() === 'fi' ? x.replace('.', ',') : x; };
const when = at => new Intl.DateTimeFormat(L2() === 'fi' ? 'fi-FI' : 'en-GB', {timeZone: 'Europe/Helsinki', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(new Date(at));
function overviewCard() {
  return `<section class="card ir-overview"><div class="card-head"><h2>${T('What you can do here')}</h2></div>
<ul class="ir-functions"><li><strong>${T('CT analysis')}</strong>: ${T('upload a chest CT; the AI finds and measures the nodule and matches it to the closest public study. You approve the match.')}</li>
<li><strong>${T('X-ray analysis')}</strong>: ${T('upload a chest X-ray DICOM; a classifier scores it and the AI summarises the scores.')}</li>
<li>${T('Results for the selected patient appear below. Mark the analysis complete when you have reviewed them.')}</li></ul>
<div class="button-row">${goButton('ct-compare', 'Go to CT analysis', true, 'care')}<button class="button" data-action="upload">${icon('upload')}${T('Go to X-ray analysis')}</button></div></section>`;
}
function ctResultCard(p) {
  const cc = window.candexCtCompare?.forPatient?.(p.id, L2());
  if (!cc) return `<section class="card ir-result ir-empty"><div class="card-head"><h2>${T('CT analysis')}</h2>${badge(T('Not analysed yet'), 'neutral')}</div><p>${T('Upload a chest CT to compare it with the public reference studies.')}</p>${goButton('ct-compare', 'Go to CT analysis', false, 'care')}</section>`;
  const refId = cc.linked || cc.closest, ref = CASES[refId], rd = cc.read, m = rd.measured, top = cc.top.find(x => x.caseId === refId) || cc.top[0];
  const size = m ? `${n1(m.long_mm)} × ${n1(m.short_mm)} mm` : rd.long_axis_mm != null ? `${n1(rd.long_axis_mm)} mm` : '—';
  const status = cc.approved ? badge(T('Approved by clinician')) : cc.approval.state === 'changed' ? badge(T('Changed since approval'), 'amber') : badge(T('Awaiting clinician approval'), 'amber');
  return `<section class="card ir-result"><div class="card-head"><h2>${T('CT analysis')}</h2>${status}</div>
<div class="ctc-pair"><figure><img alt="${esc(T('Key slice of the uploaded CT'))}" src="${esc(cc.keyImage)}"><figcaption>${T('Uploaded CT · key slice')}</figcaption></figure><figure>${ref ? `<img alt="${esc(T('Key slice of the reference study'))}" src="${esc(ref.frames[ref.centre].src)}">` : ''}<figcaption translate="no">${esc(refId)} · ${T('public reference')}</figcaption></figure></div>
<div class="data-line"><span>${T('Nodule size')}${m ? ` (${T('measured')})` : ''}</span><strong translate="no">${esc(size)}</strong></div>
<div class="data-line"><span>${T('Closest public study')}</span><strong translate="no">${esc(refId)} · ${n1(top.similarity)} % · ${n1(top.diameter)} mm · Lung-RADS ${esc(top.band)}</strong></div>
<ul class="ir-points" translate="no">${(cc.points || []).slice(0, 3).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
${goButton('ct-compare', cc.approved ? 'Open CT analysis' : 'Review and approve', false, 'care')}</section>`;
}
function xrayResultCard(p, c) {
  const up = window.candexXray?.byPatient?.[p.id], pre = c && window.candexCxrReads?.cases?.[c.id], L = L2();
  if (!up && !pre) return `<section class="card ir-result ir-empty"><div class="card-head"><h2>${T('X-ray analysis')}</h2>${badge(T('Not analysed yet'), 'neutral')}</div><p>${T('Upload a chest X-ray DICOM to screen it with the classifier.')}</p><button class="text-btn" data-action="upload">${T('Go to X-ray analysis')}${icon('arrow')}</button></section>`;
  const img = up ? up.image : pre.image;
  const top = up ? up.top : [...pre.scores].sort((a, b) => b.score - a.score).slice(0, 3);
  const points = up ? (up.points || []).slice(0, 3) : (pre.keyPoints?.[L] || []).slice(0, 3);
  const nod = up ? up.nodule : pre.scores.filter(s => ['Nodule', 'Mass'].includes(s.label));
  const src = up ? `${T('Uploaded X-ray')} · ${esc(when(up.at))}` : `<span translate="no">${esc(c.id)}</span> · ${T('public study X-ray (precomputed)')}`;
  return `<section class="card ir-result"><div class="card-head"><h2>${T('X-ray analysis')}</h2>${badge(T('Needs clinician review'), 'amber')}</div>
<div class="xray-stage ir-xray"><img src="${esc(img)}" alt="${esc(T('Screened chest X-ray'))}"></div><p class="scan-caption">${T('Screened image')} · ${src}</p>
<div class="data-line"><span>${T('Highest scores (0–1, uncalibrated)')}</span><strong translate="no">${top.map(s => `${esc(s.label)} ${n2(s.score)}`).join(' · ')}</strong></div>
${nod.length ? `<div class="data-line"><span>${T('Nodule · Mass')}</span><strong translate="no">${nod.map(s => n2(s.score)).join(' · ')}</strong></div>` : ''}
${points.length ? `<ul class="ir-points" translate="no">${points.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="field-note">${T('The AI summary is still being written on the X-ray page.')}</p>`}
<p class="field-note">${T('Not a nodule detector: a low Nodule or Mass score does not rule out a nodule.')}</p></section>`;
}
function scanView() {
  const p = patients.find(x => x.id === state.selected) || patients[0];
  state.selected = p.id;
  const c = CASES[links[p.id]];
  return `${heading('Imaging review', 'CT and X-ray results for one patient, in one place.', 'Clinical imaging')}${demoNotice('Imaging review · Research prototype. AI output is unvalidated and never a diagnosis; reference studies are public LIDC-IDRI scans, not the patient’s own.')}
${overviewCard()}${picker(p)}<div class="ir-results">${ctResultCard(p)}${xrayResultCard(p, c)}</div>
<details class="agent-drop ir-more" id="scan-more" ${state.scanMore ? 'open' : ''}><summary>${T('Public reference study viewer (radiologists’ outlines)')}</summary>${detailView(p)}</details>
${analysisCard(p, c)}`;
}
function detailView(p) {
  const c = CASES[links[p.id]];
  const head = '';
  if (!c) {
    return `${head}${demoNotice('Imaging review · Link one of the public LIDC-IDRI research CT studies, or upload a CT to compare. Any AI read shown is research output, not a diagnosis.')}${modeSelect()}<section class="card empty-scan"><div class="empty-scan-icon">${icon('scan')}</div><h2>No CT study linked for ${esc(p.name)}</h2><p translate="no">${esc(T(p.type))} · ${esc(T(p.reason))}</p><p>Choose a study above to open the viewer, or analyse a chest X-ray DICOM with the research model.</p></section>${decisionForm()}`;
  }
  const i = Math.min(sliceAt[c.id] ?? c.centre, c.frames.length - 1);
  const f = c.frames[i], main = c.nodules[0], [meaning, action] = LUNG_RADS[c.band] || ['', ''];
  return `${head}${demoNotice(`Real public CT from LIDC-IDRI (${c.id}), linked to this fictional patient for the demo. It is not ${esc(p.name)}’s own scan. Outlines are the LIDC radiologists’ markings. Any AI read shown is precomputed research output, not a diagnosis.`)}${modeSelect()}${state.scanMode === 'xray' ? xraySection(p, c) : `<div class="scan-layout"><div class="stack"><section class="scan-viewer"><div class="scan-toolbar"><span>${esc(p.id)} · ${esc(p.name)}</span>${badge(`${c.id} · CT`)}</div>
<div class="scan-stage ct-stage"><div class="ct-frame"><img id="ct-img" src="${f.src}" width="384" height="384" alt="Axial chest CT slice from public study ${c.id}"><svg id="ct-overlay" viewBox="0 0 384 384" aria-hidden="true">${overlaySVG(f, c, i)}</svg></div></div>
<p class="scan-caption" id="ct-caption">${caption(c, i)}</p>
<div class="scan-controls ct-controls"><label class="ct-slider" for="ct-slice">Slice <input type="range" id="ct-slice" min="0" max="${c.frames.length - 1}" value="${i}"></label><button type="button" data-action="ct-centre">Go to nodule centre</button><label><input type="checkbox" id="overlay" ${state.overlay ? 'checked' : ''}>Show radiologist outlines</label>${window.candexAi?.hasMarkers(c) ? `<label><input type="checkbox" id="ai-marker" ${state.aiMarker ? 'checked' : ''}>Show AI marker</label>` : ''}</div></section>
<section class="card"><div class="card-head"><h2>Radiologist reference</h2>${badge(`${main.readers} of 4 LIDC readers`, 'neutral')}</div>
<div class="data-line"><span>Main nodule · mean diameter</span><strong>${main.diameter} mm</strong></div>
<div class="data-line"><span>Approximate Lung-RADS category</span><strong translate="no">${c.band} · ${T(meaning)}</strong></div>
<div class="data-line"><span>Malignancy rating (1–5, readers’ mean)</span><strong translate="no">${main.malignancy} · ${T(MALIGNANCY[Math.round(main.malignancy)])}</strong></div>
<div class="data-line"><span>Spiculation (1–5)</span><strong>${main.spiculation}</strong></div>
<div class="data-line"><span>Other nodules marked</span><strong>${c.nodules.length - 1}</strong></div>
<div class="data-line"><span>Slice thickness · pixel size</span><strong>${c.sliceMm} mm · ${c.pixelMm} mm</strong></div>
<p style="font-size:.7rem;margin-top:13px"><span translate="no">${T('Lung-RADS v2022 suggests:')} ${T(action)}</span> The category here is approximated from the readers’ size and ratings; LIDC-IDRI has no Lung-RADS labels.</p></section>${window.candexAi ? window.candexAi.card(c) : ''}</div>
<div class="stack"><section class="card"><div class="card-head"><h2>Review notes</h2>${badge('Needs clinician review', 'amber')}</div><ul class="findings"><li><strong><span class="finding-dot"></span>Main nodule · ${main.diameter} mm</strong><p>Marked by ${main.readers} radiologist${main.readers === 1 ? '' : 's'}. Use the slider to follow it through the slices and confirm on the full study.</p></li><li><strong>Clinical context</strong>${contextLines(p)}</li><li><strong>AI second reader</strong><p>${window.candexAi?.read(c.id) ? 'A precomputed research read is shown under the radiologist reference. Compare it with the outlines; it does not change urgency or recommendations.' : 'No AI read is available for this study.'}</p></li></ul></section>${decisionForm()}</div></div>
<p class="field-note" style="margin-bottom:24px">Images: LIDC-IDRI, The Cancer Imaging Archive (CC BY 3.0), doi:10.7937/K9/TCIA.2015.LO9QL9SX. Armato SG III et al., Medical Physics 2011;38(2):915–931; Clark K et al., J Digit Imaging 2013. Excerpt of 11 slices, lung window, resized to 384 px. Prototype for research use only: not a medical device, not CE-marked.</p>`}`;
}

function showSlice(i) {
  const p = patients.find(x => x.id === state.selected), c = p && CASES[links[p.id]];
  if (!c) return;
  i = Math.max(0, Math.min(c.frames.length - 1, i));
  sliceAt[c.id] = i;
  const q = sel => document.querySelector(sel);
  const img = q('#ct-img'), svg = q('#ct-overlay'), cap = q('#ct-caption'), range = q('#ct-slice');
  if (img) img.src = c.frames[i].src;
  if (svg) svg.innerHTML = overlaySVG(c.frames[i], c, i);
  if (cap) cap.textContent = T(caption(c, i));
  if (range && +range.value !== i) range.value = i;
}

document.addEventListener('input', e => { if (e.target.id === 'ct-slice') showSlice(+e.target.value); });
document.addEventListener('toggle', e => { if (e.target?.id === 'scan-more') state.scanMore = e.target.open; }, true);
document.addEventListener('change', e => {
  if (e.target.id === 'scan-patient') { state.selected = e.target.value; render(); }
  if (e.target.id === 'scan-mode') { state.scanMode = e.target.value; render(); }
  if (e.target.id === 'ai-marker') { state.aiMarker = e.target.checked; const p = patients.find(x => x.id === state.selected), c = p && CASES[links[p.id]]; if (c) showSlice(sliceAt[c.id] ?? c.centre); }
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
  setLink: (pid, caseId) => { if (CASES[caseId]) { links[pid] = caseId; save(); } },
  actions: {
    'imaging-complete': () => { const p = patients.find(x => x.id === state.selected), c = p && CASES[links[p.id]]; if (!p || !c) return; window.CandexJourney?.completeImaging(p.id, {ct: c.id, xray: !!window.candexCxrReads?.cases?.[c.id]}); toast(T('CT and X-ray analysis marked complete. The patient’s pathway is updated.')); render(true); },
    'imaging-undo': () => { const p = patients.find(x => x.id === state.selected); if (!p) return; window.CandexJourney?.undoImaging(p.id); toast(T('Analysis marked not complete.')); render(true); },
    'ct-centre': () => { const p = patients.find(x => x.id === state.selected), c = p && CASES[links[p.id]]; if (c) showSlice(c.centre); }},
};
})();
