// Doctor -> CT upload and comparison (research prototype).
// Upload one chest CT series; the backend (/api/ct/compare) finds and reads the
// most suspicious nodule with Gemini, scores all 25 public LIDC-IDRI reference
// studies, compares the key slices and summarises the raw data (EN + FI, checked
// by a reviewer). Like the chest X-ray summary, the raw data is shown in full.
// The clinician reviews and approves the comparison, which links the chosen
// reference study to the patient and feeds Imaging review, the referral report,
// the clinical agent and the patient's pathway. Browser-local storage only.
(() => {
'use strict';
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const lang = () => (window.candexI18n?.lang === 'fi' ? 'fi' : 'en');
const KEY = 'candex-ct-compare-v1';
const CLINICIAN = 'Dr. Emilia Koski';
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch { return false; } };
const get = id => read()[id] || null;
const num = (v, d = 1) => (v == null ? '—' : (lang() === 'fi' ? Number(v).toFixed(d).replace('.', ',') : Number(v).toFixed(d)));
const dt = iso => new Intl.DateTimeFormat(lang() === 'fi' ? 'fi-FI' : 'en-GB', {timeZone: 'Europe/Helsinki', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(new Date(iso));
const sideT = s => T(s === 'right' ? 'Right' : s === 'left' ? 'Left' : s === 'not seen' ? 'Not seen' : '—');
// Fingerprint of what the clinician approves (result + chosen study).
const fp = (rec, caseId) => { let h = 5381; const s = JSON.stringify([rec?.at, rec?.result?.matches?.slice(0, 3), rec?.result?.raw?.read, caseId]); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };
const approval = id => { const r = get(id); if (!r?.approval) return {state: r ? 'pending' : 'none'}; return {...r.approval, state: r.approval.fp === fp(r, r.approval.caseId) ? 'approved' : 'changed'}; };

const S = {pid: null, files: [], busy: false, error: null, started: 0};
const pid = () => (S.pid && patients.some(p => p.id === S.pid) ? S.pid : (state.selected && patients.some(p => p.id === state.selected) ? state.selected : patients[0].id));
const token = () => (window.candexAgent?.getToken?.() || '').trim();

// ---------- Rendering ----------
// AI text: numbers to 1 decimal place, asides in brackets and disclaimer items dropped
// (the page and report show the caveats once). Results saved before the backend rounded
// the pixel measurement contain values like 10.899999618530273.
// 1 decimal place; 2 when 1 would turn a non-zero value into 0.0 (e.g. a match score of 0.08).
const fmt1 = (v, L) => { const n = Number(v), x = n !== 0 && Math.abs(n) < 0.05 ? n.toFixed(2) : n.toFixed(1); return L === 'fi' ? x.replace('.', ',') : x; };
const r1 = (s, L = lang()) => String(s || '').replace(/(?<![\d.,])(\d+)[.,](\d{2,})(?![.,]?\d)/g, (m, a, b) => fmt1(`${a}.${b}`, L))
  .replace(/(?<![\d.,])(\d+)\.(\d)(?![.,]?\d)/g, (m, a, b) => (L === 'fi' ? `${a},${b}` : m));
const tidy = (s, L) => r1(String(s || '').replace(/\s*\([^()]*\)/g, '').replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').trim(), L);
const CAVEAT = /prototype|prototyyp|please note|huomaa,? että|unvalidated research|vahvistamaton tutkimus|non-diagnostic|treatment decisions|hoitopäätö|ei ole diagnoosi|päättää jatkohoido/i;
const tidyList = (xs, L) => (xs || []).filter(x => !CAVEAT.test(x)).map(x => tidy(x, L)).filter(Boolean);
const radsBySize = mm => (mm == null ? null : mm < 6 ? '2' : mm < 8 ? '3' : mm < 15 ? '4A' : '4B');
const verdict = c => (c === 0 ? ['Same', ''] : c <= 0.25 ? ['Similar', ''] : ['Different', 'amber']);
const FI = {Size: 'Koko', Side: 'Puoli', Composition: 'Rakenne', Same: 'Sama', Similar: 'Samankaltainen', Different: 'Eroaa', Feature: 'Ominaisuus', 'Uploaded CT': 'Ladattu TT', Result: 'Tulos', Right: 'Oikea', Left: 'Vasen', 'Not seen': 'Ei nähty',
  solid: 'kiinteä', 'part-solid': 'osittain kiinteä', 'ground-glass': 'mattalasimainen', calcified: 'kalkkeutunut', 'not applicable': 'ei sovellu', 'AI estimate': 'tekoälyn arvio', 'AI observation on the key slices': 'Tekoälyn havainto avainleikkeistä', 'by measured size': 'mitatun koon mukaan', AI: 'tekoäly'};
const tl = (x, L) => (L === 'fi' ? FI[x] || x : x);
// Similarities and differences as table rows, in either language (page and report).
function compareRows(res, L) {
  const rd = res.raw.read, m = rd.measured, best = res.matches[0], c = best.components || {};
  const n = v => fmt1(v, L), side = x => tl(x === 'right' ? 'Right' : x === 'left' ? 'Left' : 'Not seen', L);
  const up = m ? `${n(m.long_mm)} × ${n(m.short_mm)} mm` : rd.long_axis_mm != null ? `${n(rd.long_axis_mm)} mm (${tl('AI estimate', L)})` : '—';
  const feats = [['Size', up, `${n(best.diameter)} mm`, c.size], ['Lung-RADS', m ? `${radsBySize(m.mean_mm ?? (m.long_mm + m.short_mm) / 2)} (${tl('by measured size', L)})` : `${rd.lung_rads || '—'} (${tl('AI', L)})`, best.band, c.band],
    ['Side', side(rd.location?.side), side(best.side), c.side], ['Composition', tl(rd.composition || '—', L), tl(best.composition || '—', L), c.composition]];
  return {
    head: [tl('Feature', L), tl('Uploaded CT', L), best.caseId, tl('Result', L)], refId: best.caseId,
    features: feats.map(([k, a, b, comp]) => { const [v, tone] = verdict(comp ?? 1); return {cells: [tl(k, L), String(a), String(b), tl(v, L)], tone}; }),
    obsHead: [tl('Result', L), tl('AI observation on the key slices', L)],
    observations: [...tidyList(res.comparison[`similarities_${L}`], L).map(x => ({cells: [tl('Similar', L), x], tone: ''})), ...tidyList(res.comparison[`differences_${L}`], L).map(x => ({cells: [tl('Different', L), x], tone: 'amber'}))],
  };
}
function featureTable(res) {
  const t = compareRows(res, lang());
  return `<section class="ctc-compare"><h3>${T('Similarities and differences')}</h3>
<div class="table-wrap"><table class="ctc-table ctc-feat"><thead><tr>${t.head.map((h, i) => `<th${i === 2 ? ' translate="no"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.features.map(r => `<tr><th scope="row">${esc(r.cells[0])}</th><td translate="no">${esc(r.cells[1])}</td><td translate="no">${esc(r.cells[2])}</td><td>${badge(esc(r.cells[3]), r.tone)}</td></tr>`).join('')}</tbody></table></div>
${t.observations.length ? `<div class="table-wrap"><table class="ctc-table ctc-obs"><thead><tr>${t.obsHead.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.observations.map(r => `<tr><td>${badge(esc(r.cells[0]), r.tone)}</td><td translate="no">${esc(r.cells[1])}</td></tr>`).join('')}</tbody></table></div>` : ''}
<p class="field-note">${T('The feature rows are calculated from the raw data; the observations are the AI’s comparison of the two key slices.')}</p></section>`;
}
function rawHTML(res) {
  const r = res.raw, rd = r.read, cases = window.candexImaging?.CASES || {};
  const series = [['Slices', r.series.slices], ['Slice spacing', `${num(r.series.sliceSpacingMm)} mm`], ['Pixel size', `${num(r.series.pixelMm)} mm`], ['Matrix', r.series.matrix], ['Scan length (z)', `${num(r.series.zRangeMm)} mm`]];
  const read = [['Nodule found', T(rd.nodule_present ? 'Yes' : 'No')], ['Side · lobe', `${sideT(rd.location?.side)} · ${T(rd.location?.lobe || '—')}`], ['Measured size (from the pixels)', rd.measured ? `${num(rd.measured.long_mm)} × ${num(rd.measured.short_mm)} mm · ${num(rd.measured.volume_mm3)} mm³` : (rd.measureNote ? `— (${rd.measureNote})` : '—')], ['AI size estimate (long × short axis)', rd.long_axis_mm != null ? `${num(rd.long_axis_mm)}${rd.short_axis_mm != null ? ` × ${num(rd.short_axis_mm)}` : ''} mm` : '—'], ['Composition', T(rd.composition)], ['Margin', T(rd.margin)], ['Lung-RADS (AI)', rd.lung_rads], ['Model confidence (not calibrated)', num(rd.confidence)], ['Key slice position (z)', `${num(rd.keySliceZ)} mm`], ['Other findings', (rd.other_findings || []).join('; ') || '—']];
  const kv = rows => `<dl class="ctc-kv">${rows.map(([k, v]) => `<dt>${T(k)}</dt><dd translate="no">${esc(String(v))}</dd>`).join('')}</dl>`;
  return `<section class="ctc-raw"><h3>${T('Raw data')}</h3>
<h4>${T('Uploaded series')}</h4>${kv(series)}
<h4>${T('AI search')} <small translate="no">· ${esc(res.models.vision)}</small></h4><p class="field-note">${T('The AI looked at 24 slab views and chose these candidate views (numbers on the images):')} <span translate="no">${esc((r.find.candidates || []).join(', ') || '—')}</span>. ${T('Read in detail')}: <span translate="no">${esc((r.find.readTiles || []).filter(Boolean).join(', ') || '—')}</span>.</p>
<div class="ctc-montage">${(res.images.montage || []).map((m, i) => `<img alt="${esc(T('Slab views of the uploaded CT'))} ${i + 1}" src="data:image/jpeg;base64,${m}">`).join('')}</div>
<details class="agent-drop ctc-sub"><summary>${T('AI read of the uploaded CT (raw output)')}</summary>${kv(read)}<p class="ctc-quote" translate="no">${esc(rd.short_report || '')}</p><p class="field-note">${T('Raw AI output is shown in the model’s original wording (English). The AI summary above is in your language.')}</p></details>
<details class="agent-drop ctc-sub"><summary>${T('Match scores against all public reference studies')}</summary><p class="field-note">${T('Score = 0.5 × size difference + 0.25 × Lung-RADS band difference + 0.15 × side + 0.10 × composition (each 0 to 1). Similarity = 100 × (1 − score). Lower score = closer.')}</p>
<div class="table-wrap"><table class="ctc-table"><thead><tr><th>#</th><th>${T('Study')}</th><th>${T('Similarity')}</th><th>${T('Nodule')}</th><th>Lung-RADS</th><th>${T('Side')}</th><th>${T('Composition')}</th><th>${T('Size · band · side · comp.')}</th></tr></thead><tbody>${res.matches.map((m, i) => `<tr class="${i < 3 ? 'is-top' : ''}"><td>${i + 1}</td><td translate="no">${esc(m.caseId)}</td><td>${num(m.similarity)} %</td><td>${num(m.diameter)} mm</td><td translate="no">${esc(m.band)}</td><td>${sideT(m.side)}</td><td>${T(m.composition)}</td><td translate="no">${num(m.components.size)} · ${num(m.components.band)} · ${num(m.components.side)} · ${num(m.components.composition)}</td></tr>`).join('')}</tbody></table></div></details></section>`;
}
function resultHTML(id, rec) {
  const res = rec.result, L = lang(), ap = approval(id), cases = window.candexImaging?.CASES || {};
  const best = res.matches[0], ref = cases[best.caseId];
  const refImg = ref ? ref.frames[ref.centre].src : '';
  const points = tidyList(L === 'fi' ? res.summary.keyPointsFi : res.summary.keyPointsEn, L);
  const rv = res.review, ok = rv.verdict === 'consistent with the raw data' && !(rv.unverifiedNumbers || []).length;
  const top = res.matches.slice(0, 3);
  const chosen = ap.caseId || best.caseId;
  return `<section class="card ctc-result"><div class="card-head"><div><h2>${T('Closest public reference study')}: <span translate="no">${esc(best.caseId)}</span></h2><p class="subhead">${T('Similarity')} ${num(best.similarity)} % · ${T('uploaded')} ${esc(dt(rec.at))} · ${num(res.seconds)} s</p></div>${ap.state === 'approved' ? badge(T('Approved by clinician')) : ap.state === 'changed' ? badge(T('Changed since approval'), 'amber') : badge(T('Awaiting clinician approval'), 'amber')}</div>
<div class="ctc-pair"><figure><img alt="${esc(T('Key slice of the uploaded CT'))}" src="data:image/jpeg;base64,${res.images.key}"><figcaption>${T('Uploaded CT · key slice')} (z ${num(res.raw.read.keySliceZ)} mm)</figcaption></figure><figure>${refImg ? `<img alt="${esc(T('Key slice of the reference study'))}" src="${esc(refImg)}">` : ''}<figcaption translate="no">${esc(best.caseId)} · ${num(best.diameter)} mm · Lung-RADS ${esc(best.band)}</figcaption></figure></div>
<details class="agent-drop ctc-sum ${ok ? '' : 'is-warn'}"><summary>${T('AI summary of the raw data')} ${badge(T(ok ? 'Safety review: consistent with the raw data' : 'Safety review: needs changes'), ok ? '' : 'amber')}</summary>
<ul class="ctc-points" translate="no">${points.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
${ok ? '' : `<ul class="agent-issues" translate="no">${[...tidyList(rv[`issues_${L}`], L), ...(rv.unverifiedNumbers || []).map(n => `${T('Number not in the raw data')}: ${r1(n, L)}`)].map(x => `<li>${esc(x)}</li>`).join('')}</ul>`}</details>
${featureTable(res)}
${rawHTML(res)}
<section class="ctc-approve"><h3>${T('Clinician approval')}</h3>
${ap.state === 'approved' ? `<p>${T('Approved by')} <strong translate="no">${esc(ap.by)}</strong> · <span translate="no">${esc(dt(ap.at))}</span>. ${T('Linked reference study')}: <strong translate="no">${esc(ap.caseId)}</strong>.</p><button type="button" class="text-btn" data-ctc-withdraw>${T('Withdraw approval')}</button>`
  : `<p class="field-note">${T('Check the raw data and the images. Approving links the chosen public reference study to this patient for Imaging review, the referral report, the clinical agent and the patient’s pathway. It is a reference example, not the patient’s own scan.')}</p>
<div class="field"><label for="ctc-choice">${T('Reference study to link')}</label><select id="ctc-choice" translate="no">${top.map(m => `<option value="${esc(m.caseId)}" ${m.caseId === chosen ? 'selected' : ''}>${esc(m.caseId)} · ${num(m.similarity)} % · ${num(m.diameter)} mm · Lung-RADS ${esc(m.band)}</option>`).join('')}</select></div>
<label class="check-row"><input type="checkbox" id="ctc-check-raw"><span>${T('I have reviewed the raw data, the AI read and the images.')}</span></label>
<label class="check-row"><input type="checkbox" id="ctc-check-link"><span>${T('I agree that this reference study is a suitable comparison for this patient.')}</span></label>
<button type="button" class="button" data-ctc-approve disabled>${icon('check')}${T('Approve and link to patient')}</button>`}
<p class="field-note">${T('Research prototype: unvalidated AI, not a diagnosis. The match compares nodule features only.')}</p></section></section>`;
}
function body() {
  const id = pid(), p = patients.find(x => x.id === id), rec = get(id);
  const totalMb = S.files.reduce((a, f) => a + f.size, 0) / 1e6;
  return `<div class="ctc-layout"><aside class="card ctc-controls"><h2>${T('Upload a chest CT')}</h2>
<div class="field"><label for="ctc-patient">${icon('users')}${T('Patient')}</label><select id="ctc-patient">${patients.map(x => `<option value="${esc(x.id)}" ${x.id === id ? 'selected' : ''}>${esc(x.name)} · ${esc(x.id)}</option>`).join('')}</select></div>
<div class="field"><span class="ctc-label">${T('CT series (DICOM files)')}</span><div class="button-row"><label class="button secondary ctc-file">${icon('upload')}${T('Choose folder')}<input type="file" id="ctc-folder" webkitdirectory multiple hidden></label><label class="button secondary ctc-file">${T('Choose files')}<input type="file" id="ctc-files" accept=".dcm,application/dicom" multiple hidden></label></div>
<small>${S.files.length ? `${S.files.length} ${T('files')} · ${num(totalMb)} MB` : T('Choose the folder of one CT series (all its .dcm files). Up to 800 files, 400 MB.')}</small></div>
<label class="check-row"><input type="checkbox" id="ctc-chest"><span>${T('This is one axial chest CT series.')}</span></label>
<label class="check-row"><input type="checkbox" id="ctc-permit"><span>${T('I have permission to process this de-identified research or test image.')}</span></label>
${window.candexAgent?.tokenDrop ? window.candexAgent.tokenDrop('ctc-token') : ''}
<button type="button" class="button" data-ctc-run ${S.busy ? 'disabled' : ''}>${icon('scan')}${S.busy ? T('Comparing… (about 1 minute)') : T('Upload and compare')}</button>
${S.busy ? `<p class="field-note" role="status">${T('The AI is searching the scan, reading the nodule, scoring all 25 public studies and writing the summary.')}</p>` : ''}
${S.error ? `<p class="notice" role="alert">${esc(S.error)}</p>` : ''}
<p class="field-note">${T('Use only de-identified research or test scans. Images are processed on your backend and are not stored; only the result and two small images are kept in this browser.')}</p>
${rec ? `<button type="button" class="text-btn" data-ctc-clear>${T('Remove this patient’s comparison')}</button>` : ''}</aside>
<div class="ctc-main">${rec ? resultHTML(id, rec) : `<section class="card"><div class="agent-empty">${icon('scan')}<p>${T('Upload a CT series to find the closest of the 25 public LIDC-IDRI reference studies. The comparison then waits for your approval.')}</p></div></section>`}</div></div>`;
}
function view() {
  return `${heading('Compare a new scan.', 'Upload a chest CT, find the closest public reference study, review the AI comparison and approve it.', 'CT upload and comparison', goButton('scan', 'Back to Imaging review'))}${demoNotice('Research prototype: the AI read and the match are unvalidated. Reference studies are public LIDC-IDRI scans, not the patient’s own images.')}<div id="ctc-root">${body()}</div>`;
}
const paint = () => { const el = document.querySelector('#ctc-root'); if (el) el.innerHTML = body(); };

// ---------- Actions ----------
async function run() {
  if (S.busy) return;
  const id = pid();
  if (!S.files.length) { S.error = T('Choose the CT files first.'); return paint(); }
  if (!document.querySelector('#ctc-chest')?.checked || !document.querySelector('#ctc-permit')?.checked) { S.error = T('Confirm both checks first.'); return paint(); }
  if (!token()) { S.error = T('Paste the backend token first.'); paint(); return window.candexAgent?.openToken?.('#ctc-token'); }
  const fd = new FormData();
  for (const f of S.files) fd.append('files', f, f.name);
  fd.append('confirmed_chest', 'true'); fd.append('permitted_data', 'true');
  Object.assign(S, {busy: true, error: null, started: Date.now()}); paint();
  try {
    const res = await fetch('/api/ct/compare', {method: 'POST', headers: {Authorization: `Bearer ${token()}`, Accept: 'application/json'}, body: fd});
    let data = null; try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error(res.status === 401 ? T('The backend token was not accepted. Paste the current token.') : data?.detail || `HTTP ${res.status}`);
    const all = read(); all[id] = {at: new Date().toISOString(), result: data, approval: null};
    if (!write(all)) throw new Error(T('This browser could not save the result.'));
    S.files = [];
    toast(T('Comparison ready. Review it and approve it below.'));
  } catch (e) { S.error = e.message; }
  S.busy = false; paint();
}
function approve() {
  const id = pid(), all = read(), rec = all[id]; if (!rec) return;
  const caseId = document.querySelector('#ctc-choice')?.value || rec.result.closest;
  rec.approval = {by: CLINICIAN, at: new Date().toISOString(), caseId, fp: fp(rec, caseId)};
  write(all);
  window.candexImaging?.setLink?.(id, caseId);
  const x = !!window.candexCxrReads?.cases?.[caseId];
  window.CandexJourney?.completeImaging(id, {ct: caseId, xray: x, uploaded: true});
  toast(T('Approved. The reference study is linked, and the patient’s pathway shows the CT step as done.'));
  paint();
}
function withdraw() { const all = read(); if (all[pid()]) { all[pid()].approval = null; write(all); toast(T('Approval withdrawn.')); paint(); } }

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'ctc-patient') { S.pid = t.value; S.error = null; paint(); }
  if (t.id === 'ctc-folder' || t.id === 'ctc-files') { S.files = [...(t.files || [])].filter(f => /\.dcm$/i.test(f.name) || !/\.[a-z0-9]{2,4}$/i.test(f.name)).slice(0, 800); S.error = null; paint(); }
  if (t.id === 'ctc-check-raw' || t.id === 'ctc-check-link') { const b = document.querySelector('[data-ctc-approve]'); if (b) b.disabled = !(document.querySelector('#ctc-check-raw')?.checked && document.querySelector('#ctc-check-link')?.checked); }
});
document.addEventListener('click', e => {
  const t = e.target;
  if (t.closest?.('[data-ctc-run]')) return void run();
  if (t.closest?.('[data-ctc-approve]')) return approve();
  if (t.closest?.('[data-ctc-withdraw]')) return withdraw();
  if (t.closest?.('[data-ctc-clear]')) { const all = read(); delete all[pid()]; write(all); paint(); }
});
document.addEventListener('input', e => { if (e.target.id === 'ctc-token') window.candexAgent?.setToken?.(e.target.value); });

// ---------- For the later workflows ----------
// Summary object for one patient (referral report, Imaging review, agent, pathway).
function forPatient(id, L = 'en') {
  const rec = get(id); if (!rec) return null;
  const res = rec.result, ap = approval(id), best = res.matches[0];
  return {
    at: rec.at, approval: ap, approved: ap.state === 'approved', linked: ap.caseId || null, closest: best.caseId, similarity: best.similarity,
    read: res.raw.read, series: res.raw.series, top: res.matches.slice(0, 3), keyImage: `data:image/jpeg;base64,${res.images.key}`,
    summary: r1(L === 'fi' ? res.summary.fi : res.summary.en, L), points: tidyList(L === 'fi' ? res.summary.keyPointsFi : res.summary.keyPointsEn, L),
    similarities: tidyList(res.comparison[`similarities_${L}`], L), differences: tidyList(res.comparison[`differences_${L}`], L), compare: compareRows(res, L),
    review: res.review, models: res.models, fingerprint: fp(rec, ap.caseId || best.caseId),
  };
}
function imagingCard(id) {
  const c = forPatient(id, lang()); if (!c) return '';
  return `<section class="card ctc-mini"><div class="card-head"><h2>${T('Uploaded CT comparison')}</h2>${c.approved ? badge(T('Approved by clinician')) : badge(T('Awaiting clinician approval'), 'amber')}</div>
<p>${T('Closest public reference study')}: <strong translate="no">${esc(c.closest)}</strong> (${num(c.similarity)} %). ${c.approved ? `${T('Linked')}: <strong translate="no">${esc(c.linked)}</strong>.` : ''}</p><p class="field-note" translate="no">${esc(c.summary)}</p>${goButton('ct-compare', c.approved ? 'Open the comparison' : 'Review and approve')}</section>`;
}

window.candexI18n?.extend?.({
  'Results go to the Imaging review of': 'Tulokset siirtyvät kuvantamisen arvioon potilaalle', 'Change the patient in Imaging review. The image stays in this browser session only.': 'Vaihda potilas kuvantamisen arviossa. Kuva säilyy vain tässä selainistunnossa.', 'Back to Imaging review': 'Takaisin kuvantamisen arvioon',
  'CT and X-ray results for one patient, in one place.': 'Yhden potilaan TT- ja röntgentulokset yhdessä paikassa.',
  'Imaging review · Research prototype. AI output is unvalidated and never a diagnosis; reference studies are public LIDC-IDRI scans, not the patient’s own.': 'Kuvantamisen arvio · Tutkimusprototyyppi. Tekoälyn tulokset ovat validoimattomia eivätkä koskaan diagnoosi; vertailututkimukset ovat julkisia LIDC-IDRI-kuvia, eivät potilaan omia.',
  'What you can do here': 'Mitä täällä voi tehdä', 'CT analysis': 'TT-analyysi', 'X-ray analysis': 'Röntgenanalyysi',
  'upload a chest CT; the AI finds and measures the nodule and matches it to the closest public study. You approve the match.': 'lataa rintakehän TT; tekoäly etsii ja mittaa pesäkkeen ja valitsee lähimmän julkisen tutkimuksen. Sinä hyväksyt vertailun.',
  'upload a chest X-ray DICOM; a classifier scores it and the AI summarises the scores.': 'lataa keuhkoröntgenin DICOM-kuva; luokittelija pisteyttää sen ja tekoäly tiivistää pisteet.',
  'Results for the selected patient appear below. Mark the analysis complete when you have reviewed them.': 'Valitun potilaan tulokset näkyvät alla. Merkitse analyysi valmiiksi, kun olet tarkastanut ne.',
  'Go to CT analysis': 'Siirry TT-analyysiin', 'Go to X-ray analysis': 'Siirry röntgenanalyysiin', 'Not analysed yet': 'Ei vielä analysoitu',
  'Upload a chest CT to compare it with the public reference studies.': 'Lataa rintakehän TT verrataksesi sitä julkisiin vertailututkimuksiin.',
  'public reference': 'julkinen vertailu', 'Nodule size': 'Pesäkkeen koko', 'measured': 'mitattu', 'Closest public study': 'Lähin julkinen tutkimus',
  'Open CT analysis': 'Avaa TT-analyysi', 'Review and approve': 'Tarkasta ja hyväksy',
  'Upload a chest X-ray DICOM to screen it with the classifier.': 'Lataa keuhkoröntgenin DICOM-kuva luokittelijan seulottavaksi.',
  'Uploaded X-ray': 'Ladattu röntgenkuva', 'The AI summary is in English: the X-ray was analysed in English.': 'Tekoälyn yhteenveto on englanniksi, koska röntgenkuva analysoitiin englanninkielisenä.', 'The AI summary is in Finnish: the X-ray was analysed in Finnish.': 'Tekoälyn yhteenveto on suomeksi, koska röntgenkuva analysoitiin suomenkielisenä.', 'public study X-ray (precomputed)': 'julkisen tutkimuksen röntgenkuva (valmiiksi laskettu)', 'Screened chest X-ray': 'Seulottu keuhkoröntgenkuva', 'Screened image': 'Seulottu kuva',
  'Highest scores (0–1, uncalibrated)': 'Korkeimmat pisteet (0–1, kalibroimattomat)', 'Nodule · Mass': 'Pesäke · Massa',
  'The AI summary is still being written on the X-ray page.': 'Tekoälyn yhteenvetoa kirjoitetaan vielä röntgensivulla.',
  'Not a nodule detector: a low Nodule or Mass score does not rule out a nodule.': 'Ei pesäketunnistin: matala Pesäke- tai Massa-pistemäärä ei sulje pesäkettä pois.',
  'Public reference study viewer (radiologists’ outlines)': 'Julkisten vertailututkimusten katselin (radiologien rajaukset)',
  'Similarities and differences': 'Yhtäläisyydet ja erot', 'Feature': 'Ominaisuus', 'Uploaded CT': 'Ladattu TT', 'Result': 'Tulos', 'Size': 'Koko',
  'Same': 'Sama', 'Similar': 'Samankaltainen', 'Different': 'Eroaa', 'AI estimate': 'tekoälyn arvio', 'AI observation on the key slices': 'Tekoälyn havainto avainleikkeistä',
  'The feature rows are calculated from the raw data; the observations are the AI’s comparison of the two key slices.': 'Ominaisuusrivit on laskettu raakatiedoista; havainnot ovat tekoälyn vertailu kahdesta avainleikkeestä.',
  'Review CT studies with the radiologists’ outlines, upload a CT to compare, or analyse a chest X-ray.': 'Tarkastele TT-tutkimuksia radiologien rajauksineen, lataa TT vertailtavaksi tai analysoi keuhkoröntgenkuva.',
  "Analysis": "Analyysi",
  "CT analysis": "TT-analyysi",
  "X-ray analysis": "Röntgenanalyysi",
  "No chest X-ray for this study": "Tälle tutkimukselle ei ole keuhkoröntgenkuvaa",
  "Analyse a chest X-ray DICOM to get classifier scores and an AI summary.": "Analysoi keuhkoröntgenkuvan DICOM saadaksesi luokittelijan pisteet ja tekoälyn yhteenvedon.",
  "Analyze chest X-ray DICOM": "Analysoi keuhkoröntgen-DICOM",
  "X-ray": "Röntgen",
  "Frontal chest X-ray of the linked public study": "Linkitetyn julkisen tutkimuksen keuhkoröntgenkuva edestä",
  "Frontal chest X-ray of the linked public study, as given to the classifier.": "Linkitetyn julkisen tutkimuksen keuhkoröntgenkuva edestä sellaisena kuin luokittelija sen sai.",
  "View checked from headers; see note.": "Kuvaussuunta tarkistettu otsaketiedoista; katso huomio.",
  "View from headers.": "Kuvaussuunta otsaketiedoista.",
  "Classifier scores (raw)": "Luokittelijan pisteet (raaka)",
  "Uncalibrated scores from 0 to 1: not probabilities, no threshold. This classifier is not a nodule detector; suspected nodules need CT.": "Kalibroimattomat pisteet 0–1: eivät todennäköisyyksiä, ei raja-arvoa. Luokittelija ei tunnista pesäkkeitä; epäillyt pesäkkeet vaativat TT-tutkimuksen.",
  "AI summary of the scores": "Tekoälyn yhteenveto pisteistä",
  "Safety review: consistent": "Turvallisuustarkistus: yhtäpitävä",
  "Review notes": "Arviointimuistiinpanot",
  "Needs clinician review": "Vaatii lääkärin arvion",
  "Compare the X-ray with the CT findings. A low Nodule or Mass score never rules out a nodule.": "Vertaa röntgenkuvaa TT-löydöksiin. Matala Nodule- tai Mass-pistemäärä ei koskaan sulje pois pesäkettä.",
  "Analyse another chest X-ray DICOM": "Analysoi toinen keuhkoröntgen-DICOM",
  'CT upload and comparison': 'TT-kuvan lataus ja vertailu', 'Compare a new scan.': 'Vertaa uutta kuvausta.',
  'Upload a chest CT, find the closest public reference study, review the AI comparison and approve it.': 'Lataa rintakehän TT-kuvaus, etsi lähin julkinen vertailututkimus, tarkista tekoälyn vertailu ja hyväksy se.',
  'Back to Imaging review': 'Takaisin kuvantamisen arvioon', 'Upload CT and compare': 'Lataa TT ja vertaa',
  'Research prototype: the AI read and the match are unvalidated. Reference studies are public LIDC-IDRI scans, not the patient’s own images.': 'Tutkimusprototyyppi: tekoälyluenta ja vastaavuus ovat validoimattomia. Vertailututkimukset ovat julkisia LIDC-IDRI-kuvauksia, eivät potilaan omia kuvia.',
  'Upload a chest CT': 'Lataa rintakehän TT', 'Patient': 'Potilas', 'CT series (DICOM files)': 'TT-sarja (DICOM-tiedostot)', 'Choose folder': 'Valitse kansio', 'Choose files': 'Valitse tiedostot', 'files': 'tiedostoa',
  'Choose the folder of one CT series (all its .dcm files). Up to 800 files, 400 MB.': 'Valitse yhden TT-sarjan kansio (kaikki sen .dcm-tiedostot). Enintään 800 tiedostoa, 400 Mt.',
  'This is one axial chest CT series.': 'Tämä on yksi rintakehän aksiaalinen TT-sarja.', 'I have permission to process this de-identified research or test image.': 'Minulla on lupa käsitellä tämä tunnisteeton tutkimus- tai testikuva.',
  'Upload and compare': 'Lataa ja vertaa', 'Comparing… (about 1 minute)': 'Verrataan… (noin minuutti)',
  'The AI is searching the scan, reading the nodule, scoring all 25 public studies and writing the summary.': 'Tekoäly etsii kuvauksesta, lukee pesäkkeen, pisteyttää kaikki 25 julkista tutkimusta ja kirjoittaa yhteenvedon.',
  'Use only de-identified research or test scans. Images are processed on your backend and are not stored; only the result and two small images are kept in this browser.': 'Käytä vain tunnisteettomia tutkimus- tai testikuvauksia. Kuvat käsitellään palvelimellasi eikä niitä tallenneta; vain tulos ja kaksi pientä kuvaa säilytetään tässä selaimessa.',
  'Remove this patient’s comparison': 'Poista tämän potilaan vertailu',
  'Upload a CT series to find the closest of the 25 public LIDC-IDRI reference studies. The comparison then waits for your approval.': 'Lataa TT-sarja löytääksesi lähimmän 25 julkisesta LIDC-IDRI-vertailututkimuksesta. Vertailu odottaa sen jälkeen hyväksyntääsi.',
  'Closest public reference study': 'Lähin julkinen vertailututkimus', 'Similarity': 'Samankaltaisuus', 'uploaded': 'ladattu',
  'Approved by clinician': 'Lääkärin hyväksymä', 'Changed since approval': 'Muuttunut hyväksynnän jälkeen', 'Awaiting clinician approval': 'Odottaa lääkärin hyväksyntää',
  'Uploaded CT · key slice': 'Ladattu TT · avainleike', 'AI summary of the raw data': 'Tekoälyn yhteenveto raakatiedoista',
  'Safety review: consistent with the raw data': 'Turvallisuustarkistus: yhtäpitävä raakatietojen kanssa', 'Safety review: needs changes': 'Turvallisuustarkistus: vaatii muutoksia', 'Number not in the raw data': 'Luku, jota ei ole raakatiedoissa',
  'Similarities': 'Yhtäläisyydet', 'Differences': 'Erot', 'Raw data': 'Raakatiedot', 'Uploaded series': 'Ladattu sarja', 'Slices': 'Leikkeitä', 'Slice spacing': 'Leikeväli', 'Pixel size': 'Pikselikoko', 'Matrix': 'Matriisi', 'Scan length (z)': 'Kuvausalueen pituus (z)',
  'AI search': 'Tekoälyn haku', 'The AI looked at 24 slab views and chose these candidate views (numbers on the images):': 'Tekoäly tarkasteli 24 paksua leikenäkymää ja valitsi nämä ehdokkaat (numerot kuvissa):', 'Read in detail': 'Luettu tarkemmin', 'Slab views of the uploaded CT': 'Ladatun TT:n leikenäkymät',
  'AI read of the uploaded CT (raw output)': 'Tekoälyn luenta ladatusta TT:stä (raakatulos)', 'Nodule found': 'Pesäke löytyi', 'Yes': 'Kyllä', 'No': 'Ei', 'Side · lobe': 'Puoli · lohko', 'Size (long × short axis)': 'Koko (pitkä × lyhyt akseli)', 'Composition': 'Rakenne', 'Margin': 'Reunat',
  'Lung-RADS (AI)': 'Lung-RADS (tekoäly)', 'Model confidence (not calibrated)': 'Mallin varmuus (ei kalibroitu)', 'Key slice position (z)': 'Avainleikkeen sijainti (z)', 'Other findings': 'Muut löydökset',
  'Right': 'Oikea', 'Left': 'Vasen', 'Not seen': 'Ei nähty', 'solid': 'kiinteä', 'part-solid': 'osittain kiinteä', 'ground-glass': 'mattalasimainen', 'calcified': 'kalkkeutunut', 'not applicable': 'ei sovellu', 'smooth': 'sileä', 'lobulated': 'lobuloitu', 'spiculated': 'spikuloitunut',
  'upper': 'ylälohko', 'middle': 'keskilohko', 'lower': 'alalohko', 'lingula': 'lingula', 'uncertain': 'epävarma',
  'Match scores against all public reference studies': 'Vastaavuuspisteet kaikkiin julkisiin vertailututkimuksiin',
  'Score = 0.5 × size difference + 0.25 × Lung-RADS band difference + 0.15 × side + 0.10 × composition (each 0 to 1). Similarity = 100 × (1 − score). Lower score = closer.': 'Pisteet = 0,5 × kokoero + 0,25 × Lung-RADS-luokkaero + 0,15 × puoli + 0,10 × rakenne (kukin 0–1). Samankaltaisuus = 100 × (1 − pisteet). Pienempi pistemäärä = lähempänä.',
  'Study': 'Tutkimus', 'Nodule': 'Pesäke', 'Side': 'Puoli', 'Size · band · side · comp.': 'Koko · luokka · puoli · rakenne',
  'Clinician approval': 'Lääkärin hyväksyntä', 'Approved by': 'Hyväksyjä', 'Linked reference study': 'Linkitetty vertailututkimus', 'Withdraw approval': 'Peru hyväksyntä',
  'Check the raw data and the images. Approving links the chosen public reference study to this patient for Imaging review, the referral report, the clinical agent and the patient’s pathway. It is a reference example, not the patient’s own scan.': 'Tarkista raakatiedot ja kuvat. Hyväksyntä linkittää valitun julkisen vertailututkimuksen tälle potilaalle kuvantamisen arvioon, lähetteeseen, kliiniselle agentille ja potilaan hoitopolkuun. Se on vertailuesimerkki, ei potilaan oma kuvaus.',
  'Reference study to link': 'Linkitettävä vertailututkimus', 'I have reviewed the raw data, the AI read and the images.': 'Olen tarkistanut raakatiedot, tekoälyn luennan ja kuvat.',
  'I agree that this reference study is a suitable comparison for this patient.': 'Hyväksyn, että tämä vertailututkimus sopii tämän potilaan vertailukohdaksi.', 'Approve and link to patient': 'Hyväksy ja linkitä potilaaseen',
  'Research prototype: unvalidated AI, not a diagnosis. The match compares nodule features only.': 'Tutkimusprototyyppi: validoimaton tekoäly, ei diagnoosi. Vastaavuus vertaa vain pesäkkeen ominaisuuksia.',
  'Choose the CT files first.': 'Valitse ensin TT-tiedostot.', 'Confirm both checks first.': 'Vahvista ensin molemmat kohdat.', 'Paste the backend token first.': 'Liitä ensin palvelimen tunniste.',
  'The backend token was not accepted. Paste the current token.': 'Palvelimen tunnistetta ei hyväksytty. Liitä voimassa oleva tunniste.', 'This browser could not save the result.': 'Selain ei voinut tallentaa tulosta.',
  'Comparison ready. Review it and approve it below.': 'Vertailu valmis. Tarkista ja hyväksy se alla.',
  'Approved. The reference study is linked, and the patient’s pathway shows the CT step as done.': 'Hyväksytty. Vertailututkimus on linkitetty, ja potilaan hoitopolussa TT-vaihe näkyy valmiina.', 'Approval withdrawn.': 'Hyväksyntä peruttu.',
  'Uploaded CT comparison': 'Ladatun TT:n vertailu', 'Linked': 'Linkitetty', 'Open the comparison': 'Avaa vertailu', 'Review and approve': 'Tarkista ja hyväksy',
  'Key slice of the uploaded CT': 'Ladatun TT:n avainleike', 'Key slice of the reference study': 'Vertailututkimuksen avainleike',
});
window.candexI18n?.extend?.({
  'Imaging review · Link one of the public LIDC-IDRI research CT studies, or upload a CT to compare. Any AI read shown is research output, not a diagnosis.': 'Kuvantamisen arvio · Linkitä jokin julkisista LIDC-IDRI-tutkimuskuvauksista tai lataa TT vertailtavaksi. Tekoälyn luennat ovat tutkimustuloksia, eivät diagnooseja.',
}, [
  [/^Real public CT from LIDC-IDRI \((LIDC-IDRI-\d{4})\), linked to this fictional patient for the demo\. It is not (.+)’s own scan\. Outlines are the LIDC radiologists’ markings\. Any AI read shown is precomputed research output, not a diagnosis\.$/,
    (_, id, name) => `Todellinen julkinen TT-kuvaus LIDC-IDRI-aineistosta (${id}), linkitetty tähän kuvitteelliseen potilaaseen demoa varten. Se ei ole potilaan ${name} oma kuvaus. Rajaukset ovat LIDC-radiologien merkintöjä. Tekoälyn luennat ovat ennalta laskettuja tutkimustuloksia, eivät diagnooseja.`],
  [/^Uploaded CT · key slice \(z (.+) mm\)$/, (_, z) => `Ladattu TT · avainleike (z ${z} mm)`],
  [/^Similarity (\d+) % · uploaded (.+) · ([\d.,]+) s$/, (_, a, b, c) => `Samankaltaisuus ${a} % · ladattu ${b} · ${c} s`],
]);
window.candexCtCompare = {view, forPatient, imagingCard, approval, _read: read, _write: write, KEY};
})();
