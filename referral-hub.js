// Doctor → Referrals & follow-up: a worklist summary above the existing
// referral workspace. For each worklist patient: health-check date, an attached
// report PDF (uploaded, or generated from Reports), referral status from
// referral-store.js, and a button that opens that patient's referral journey.
// PDFs stay in this browser tab (sessionStorage, up to 1.5 MB each); nothing is
// uploaded to a server. Loaded before app.js; uses patients, state, esc, badge,
// icon, render, toast at call time.
(() => {
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const MAX_BYTES = 10 * 1024 * 1024, KEEP_BYTES = 1.5 * 1024 * 1024;
const STORE = 'candex-referral-attachments';
const files = new Map(); // patient id -> {name, size, at, source, url, dataUrl?}
let message = null;

const store = () => window.CandexReferralStore;
const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = iso => { try { return new Intl.DateTimeFormat(window.candexI18n?.lang === 'fi' ? 'fi-FI' : 'en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki'}).format(new Date(iso)); } catch { return ''; } };
const validId = id => typeof id === 'string' && /^(?:CX|HC)-\d{3,8}$/.test(id);

function persist() {
  try {
    const keep = {};
    for (const [id, f] of files) if (f.dataUrl) keep[id] = {name: f.name, size: f.size, at: f.at, source: f.source, dataUrl: f.dataUrl};
    sessionStorage.setItem(STORE, JSON.stringify(keep));
  } catch { /* storage full or unavailable: files stay for this page view */ }
}
function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || '{}');
    for (const [id, f] of Object.entries(saved)) {
      if (!validId(id) || typeof f?.dataUrl !== 'string' || !f.dataUrl.startsWith('data:application/pdf;base64,')) continue;
      const bin = atob(f.dataUrl.split(',')[1]), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      files.set(id, {...f, name: String(f.name).slice(0, 120), url: URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}))});
    }
  } catch { /* ignore unreadable saved attachments */ }
}
const toDataUrl = blob => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(blob); });

async function attach(id, blob, name, source) {
  if (!validId(id) || !patients.some(p => p.id === id)) throw new Error('Choose a patient from the worklist.');
  if (!blob || blob.size === 0) throw new Error('The file is empty.');
  if (blob.size > MAX_BYTES) throw new Error('The PDF is larger than 10 MB.');
  const head = await blob.slice(0, 5).text();
  if (head !== '%PDF-') throw new Error('That file is not a PDF.');
  const old = files.get(id);
  if (old?.url) URL.revokeObjectURL(old.url);
  const pdf = new Blob([blob], {type: 'application/pdf'});
  const entry = {name: String(name || `${id}.pdf`).replace(/[\\/]/g, '_').slice(0, 120), size: pdf.size, at: new Date().toISOString(), source, url: URL.createObjectURL(pdf)};
  if (pdf.size <= KEEP_BYTES) entry.dataUrl = await toDataUrl(pdf);
  files.set(id, entry);
  persist();
  return entry;
}
function detach(id) {
  const f = files.get(id);
  if (f?.url) URL.revokeObjectURL(f.url);
  files.delete(id); persist();
}

// Referral status for one patient, read without switching the active journey.
function status(id) {
  let j = null;
  try { j = store()?.peek?.(id) || null; } catch { j = null; }
  if (!j || !j.reports?.length) return {text: 'Not started', kind: 'neutral', step: 0};
  if (j.currentDecision) return {text: j.currentDecision.outcome === 'issued' ? 'Referral issued' : j.currentDecision.outcome === 'pending' ? 'Referral pending' : 'No referral needed', kind: j.currentDecision.outcome === 'pending' ? 'amber' : '', step: 4};
  if (j.currentFollowUp) return {text: 'Follow-up completed', kind: 'blue', step: 3};
  if (j.activeAppointment) return {text: `Follow-up booked · ${fmtDate(j.activeAppointment.startsAt)}`, kind: 'blue', step: 2};
  return {text: `Report released · v${j.currentReport?.version || j.reports.length}`, kind: 'blue', step: 1};
}

function approvalLine(id) {
  const a = window.candexReport?.approvalStatus?.(id);
  if (!a || a.state === 'none') return `<small class="rh-appr">${T('Report not approved')}</small>`;
  return a.state === 'approved' ? `<small class="rh-appr is-ok">${icon('check')}${T(`Report approved · v${a.version}`)}</small>` : `<small class="rh-appr is-warn">${T('Changed since approval')}</small>`;
}
function pdfCell(id) {
  const f = files.get(id);
  if (!f) return `<span class="muted">No PDF attached</span>${approvalLine(id)}`;
  return `${approvalLine(id)}<a class="rh-file" href="${f.url}" target="_blank" rel="noopener" translate="no">${icon('file')}${esc(f.name)}</a><small>${fmtSize(f.size)} · ${f.source === 'generated' ? T('Created in Candex') : T('Uploaded')} · ${esc(fmtDate(f.at))}</small><button type="button" class="text-btn rh-remove" data-remove-pdf="${esc(id)}">${T('Remove')}</button>`;
}

function overview(role) {
  if (role !== 'care' || !store()) return '';
  const active = store().patient;
  const rows = patients.map(p => ({p, s: status(p.id), h: window.candexScreening?.healthPatient?.(p.id)}));
  const count = f => rows.filter(f).length;
  const chips = [[`${patients.length} ${T('patients')}`, ''], [`${count(r => files.has(r.p.id))} ${T('with report PDF')}`, ''], [`${count(r => r.s.step >= 1)} ${T(count(r => r.s.step >= 1) === 1 ? 'report released' : 'reports released')}`, 'blue'], [`${count(r => r.s.step >= 4)} ${T(count(r => r.s.step >= 4) === 1 ? 'referral decision' : 'referral decisions')}`, '']];
  const activeFile = files.get(active.id);
  return `<section class="card referral-hub" aria-labelledby="rh-title" style="margin-bottom:24px">
<div class="card-head"><div><h2 id="rh-title">Referral worklist</h2><p class="subhead">Attach each patient’s report PDF, then open their referral and follow-up.</p></div><div class="rh-chips">${chips.map(([c, k]) => badge(c, k || 'neutral')).join('')}</div></div>
${message ? `<div class="rh-msg ${message.kind === 'error' ? 'is-error' : ''}" role="${message.kind === 'error' ? 'alert' : 'status'}">${esc(T(message.text))}</div>` : ''}
<div class="table-wrap"><table class="rh-table"><caption class="sr-only">Referral worklist</caption><thead><tr><th>Patient</th><th>Care pathway</th><th>Review priority</th><th>Health check</th><th>Report PDF</th><th>Referral status</th><th>Action</th></tr></thead><tbody>
${rows.map(({p, s, h}) => `<tr class="${p.id === active.id ? 'is-active' : ''}"><td><div class="patient-mini"><span class="avatar">${esc(p.initials)}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.id)} · ${esc(p.age)} ${T('years')}</small></div></div></td>
<td>${esc(T(p.type))}<small>${esc(T(p.region))}</small></td>
<td>${badge(T(p.priority), p.priority === 'Priority review' ? 'amber' : 'neutral')}</td>
<td>${h?.submittedAt ? esc(fmtDate(h.submittedAt)) : '<span class="muted">—</span>'}</td>
<td class="rh-pdf">${pdfCell(p.id)}</td>
<td>${badge(T(s.text), s.kind || 'neutral')}</td>
<td><div class="rh-actions"><label class="text-btn rh-upload">${icon('upload')}${T('Upload report PDF')}<input type="file" class="sr-only" accept="application/pdf,.pdf" data-upload-pdf="${esc(p.id)}" aria-label="${esc(T('Upload report PDF'))} · ${esc(p.name)}"></label><button type="button" class="text-btn" data-generate-pdf="${esc(p.id)}">${icon('file')}${T('Create & attach PDF')}</button><button type="button" class="button rh-open" data-open-referral="${esc(p.id)}">${T('Open referral & follow-up')}${icon('arrow')}</button></div></td></tr>`).join('')}
</tbody></table></div>
<p class="field-note">PDFs stay in this browser tab for the demo. Nothing is sent to a hospital or the patient. The detailed journey below is for the highlighted patient.</p></section>
<div class="rh-active" id="rh-active">${icon('route')}<span>${T('Referral & follow-up for')} <strong translate="no">${esc(active.name)} · ${esc(active.id)}</strong></span>${activeFile ? `<a class="text-btn" href="${activeFile.url}" target="_blank" rel="noopener">${icon('file')}${T('View attached PDF')}</a>` : `<span class="muted">${T('No report PDF attached yet')}</span>`}</div>`;
}

function say(text, kind = 'success') { message = {text, kind}; }
function openFor(id) {
  const p = patients.find(x => x.id === id);
  if (!p) return;
  try { store().select({id: p.id, name: p.name}); } catch (e) { say(e.message, 'error'); }
  render();
  setTimeout(() => document.querySelector('#rh-active')?.scrollIntoView?.({behavior: 'smooth', block: 'start'}), 50);
}

document.addEventListener('change', async e => {
  const input = e.target.closest?.('[data-upload-pdf]');
  if (!input) return;
  const id = input.dataset.uploadPdf, file = input.files?.[0];
  if (!file) return;
  try { await attach(id, file, file.name, 'upload'); say(`PDF attached for ${id}.`); }
  catch (err) { say(err.message || 'The PDF could not be attached.', 'error'); }
  render();
});
document.addEventListener('click', async e => {
  const open = e.target.closest?.('[data-open-referral]');
  if (open) { openFor(open.dataset.openReferral); return; }
  const remove = e.target.closest?.('[data-remove-pdf]');
  if (remove) { detach(remove.dataset.removePdf); say('PDF removed.'); render(); return; }
  const gen = e.target.closest?.('[data-generate-pdf]');
  if (gen) {
    const id = gen.dataset.generatePdf;
    gen.disabled = true;
    try {
      toast('Preparing the PDF…');
      const blob = await window.candexReport.pdfBlob(id, 'referral');
      await attach(id, blob, `candex-referral-${id}.pdf`, 'generated');
      say(`PDF attached for ${id}.`);
    } catch (err) {
      say(err?.message === 'The PDF is larger than 10 MB.' ? err.message : 'The PDF could not be created (offline?). Use Reports → Preview and print to PDF, then upload it.', 'error');
    }
    render();
  }
});

window.candexI18n?.extend?.({
  'Referral worklist': 'Lähetteiden työlista',
  'Attach each patient’s report PDF, then open their referral and follow-up.': 'Liitä kunkin potilaan raportti PDF-muodossa ja avaa sitten hänen lähetteensä ja seurantansa.',
  'patients': 'potilasta', 'with report PDF': 'raportti-PDF liitetty', 'reports released': 'raporttia julkaistu', 'report released': 'raportti julkaistu', 'referral decision': 'lähetepäätös', 'referral decisions': 'lähetepäätöstä',
  'Health check': 'Terveyskysely', 'Report PDF': 'Raportti-PDF', 'Referral status': 'Lähetteen tila',
  'No PDF attached': 'Ei liitettyä PDF:ää', 'Created in Candex': 'Luotu Candexissa', 'Uploaded': 'Ladattu', 'Remove': 'Poista',
  'Not started': 'Ei aloitettu', 'Referral issued': 'Lähete annettu', 'Referral pending': 'Lähete odottaa', 'No referral needed': 'Lähetettä ei tarvita', 'Follow-up completed': 'Seuranta toteutunut',
  'Upload report PDF': 'Lataa raportti-PDF', 'Create & attach PDF': 'Luo ja liitä PDF', 'Open referral & follow-up': 'Avaa lähete ja seuranta',
  'PDFs stay in this browser tab for the demo. Nothing is sent to a hospital or the patient. The detailed journey below is for the highlighted patient.': 'PDF-tiedostot säilyvät demossa tässä selainvälilehdessä. Mitään ei lähetetä sairaalaan tai potilaalle. Alla oleva tarkempi polku koskee korostettua potilasta.',
  'Referral & follow-up for': 'Lähete ja seuranta:', 'View attached PDF': 'Näytä liitetty PDF', 'No report PDF attached yet': 'Raportti-PDF:ää ei ole vielä liitetty',
  'PDF removed.': 'PDF poistettu.', 'The file is empty.': 'Tiedosto on tyhjä.', 'The PDF is larger than 10 MB.': 'PDF on yli 10 Mt.', 'That file is not a PDF.': 'Tiedosto ei ole PDF.',
  'Choose a patient from the worklist.': 'Valitse potilas työlistalta.',
  'The PDF could not be created (offline?). Use Reports → Preview and print to PDF, then upload it.': 'PDF:ää ei voitu luoda (ei verkkoyhteyttä?). Käytä Raportit → Esikatsele ja tulosta PDF:ksi, ja lataa se sitten.',
}, [
  [/^PDF attached for ((?:CX|HC)-\d+)\.$/, (m, id) => `PDF liitetty potilaalle ${id}.`],
  [/^Report released · v(\d+)$/, (m, v) => `Raportti julkaistu · v${v}`],
  [/^Follow-up booked · (.+)$/, (m, d) => `Seurantakäynti varattu · ${d}`],
]);

restore();
window.candexReferralHub = {overview, attach, detach, status, files, openFor};
})();
