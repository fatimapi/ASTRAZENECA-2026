// Referral worklist: per-patient journeys, PDF attachment checks and the
// patient plain-language summary. Real scripts in a VM with small stubs.
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mem = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)}; };
const node = () => ({innerHTML: '', textContent: '', value: '', dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, focus() {}, showModal() {}, close() {}, open: false});
const listeners = {};
const document = {querySelector: () => node(), querySelectorAll: () => [], addEventListener: (n, fn) => (listeners[n] ??= []).push(fn), createElement: () => node(), documentElement: node(), title: ''};
let urls = 0;
class FileReader { readAsDataURL(b) { b.arrayBuffer().then(buf => { this.result = `data:${b.type};base64,` + Buffer.from(buf).toString('base64'); this.onload(); }); } }
const win = {scrollTo() {}, addEventListener() {}};
const ctx = vm.createContext({document, window: win, location: {hash: '#care/referrals'}, localStorage: mem(), sessionStorage: mem(), Blob, FileReader, atob: s => Buffer.from(s, 'base64').toString('binary'), URL: {createObjectURL: () => `blob:${++urls}`, revokeObjectURL() {}}, FormData: class { constructor(f) { this.f = f; } *[Symbol.iterator]() { yield* Object.entries(this.f.values || {}); } }, setTimeout: () => 1, clearTimeout() {}, console, Set, Map, Intl, crypto: globalThis.crypto});
for (const f of ['referral-store.js', 'screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', 'ai-second-reader.js', 'imaging.js', 'referral-report.js', 'referral-hub.js']) vm.runInContext(read(f), ctx);
vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients};', ctx);
const store = win.CandexReferralStore, hub = win.candexReferralHub, R = win.candexReport, api = ctx.api;
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };
const expectError = async (fn, msg) => { try { await fn(); defects.push(msg); } catch { /* expected */ } checks++; };

(async () => {
  // Per-patient journeys: releasing for Mika must not touch Aino.
  check(store.patient.id === 'CX-1042', 'Aino is the default journey');
  store.select({id: 'CX-1043', name: 'Mika Korhonen'});
  check(store.patient.id === 'CX-1043' && store.key !== 'candex-referrals-v1', 'Mika gets his own journey key');
  store.releaseReport({patient: 'CX-1043 · Mika Korhonen', type: 'Colorectal', findings: 'Example finding', plan: 'Example plan'}, {role: 'care', approved: true});
  check(store.peek('CX-1043').reports.length === 1, 'Mika has a released report');
  check(store.peek('CX-1042').reports.length === 0, 'Aino is unaffected by Mika’s report');
  check(hub.status('CX-1043').step === 1 && hub.status('CX-1042').step === 0, 'Status reflects each patient');
  check(store.patient.id === 'CX-1043', 'peek() must not switch the active journey');
  await expectError(() => store.select({id: 'not-an-id', name: 'X'}), 'Invalid patient IDs must be rejected');
  await expectError(() => store.select({id: 'CX-1044', name: ''}), 'A patient name is required');
  check(store.peek('<script>') === null, 'peek() rejects invalid IDs');
  store.select({id: 'CX-1042', name: 'Aino Lehtinen'});
  check(store.key === 'candex-referrals-v1', 'Aino keeps the original storage key');

  // PDF attachments: only real PDFs, within the size limit, for worklist patients.
  const pdf = new Blob(['%PDF-1.4\n% demo\n'], {type: 'application/pdf'});
  const entry = await hub.attach('CX-1044', pdf, 'report.pdf', 'upload');
  check(entry.size > 0 && hub.files.get('CX-1044')?.name === 'report.pdf', 'A valid PDF is attached');
  check(JSON.parse(ctx.sessionStorage.getItem('candex-referral-attachments'))['CX-1044']?.dataUrl?.startsWith('data:application/pdf;base64,'), 'Small PDFs persist for the tab');
  await expectError(() => hub.attach('CX-1044', new Blob(['hello'], {type: 'application/pdf'}), 'fake.pdf', 'upload'), 'A renamed non-PDF must be rejected');
  await expectError(() => hub.attach('CX-1044', new Blob([]), 'empty.pdf', 'upload'), 'An empty file must be rejected');
  await expectError(() => hub.attach('CX-9999', pdf, 'x.pdf', 'upload'), 'Unknown patients must be rejected');
  const weird = await hub.attach('CX-1045', pdf, '../../etc/passwd.pdf', 'upload');
  check(!weird.name.includes('/'), 'File names cannot contain path separators');
  hub.detach('CX-1044');
  check(!hub.files.has('CX-1044'), 'Remove detaches the PDF');

  // Overview markup: every worklist patient, escaped, with the three actions.
  const html = hub.overview('care');
  check(api.patients.every(p => html.includes(`data-open-referral="${p.id}"`) && html.includes(`data-upload-pdf="${p.id}"`) && html.includes(`data-generate-pdf="${p.id}"`)), 'Each patient has upload, create and open actions');
  check(hub.overview('patient') === '' && hub.overview('quality') === '', 'Overview is for the Doctor view only');
  check(!html.includes('undefined'), 'Overview must not print undefined');

  // Patient plain-language summary includes the health-check symptoms.
  for (const fn of listeners.submit || []) await fn({preventDefault() {}, target: {id: 'health-form', values: {name: 'Test Person', age: '64', sex: 'Male', focus: 'Lung', sym_haemoptysis: 'on', sym_cough3w: 'on', duration: 'More than 3 weeks', smoking: 'Currently smoke', cigs_per_day: '20', smoke_years: '40', language: 'Arabic'}}});
  const hc = api.patients.find(p => p.source === 'health-check');
  const en = R.buildPatient(hc.id, {lang: 'en'});
  check(en.symptoms.length === 2 && en.symptoms.some(s => s.urgent && /Coughing up blood/.test(s.text)), 'Patient summary lists the reported symptoms with red flags');
  check(/within the next few days/.test(en.advice), 'Urgent symptoms give a clear next step');
  check(en.duration === 'More than 3 weeks' && en.submitted, 'Duration and submission date are included');
  check(en.help.some(h => /interpreter/.test(h)) && en.help.some(h => /112/.test(h)), 'Help section has emergency numbers and the interpreter offer');
  const fi = R.buildPatient(hc.id, {lang: 'fi'});
  check(fi.title === 'Terveyskyselysi yhteenveto' && /lähipäivinä/.test(fi.advice), 'Finnish patient summary');
  check(!/[<>]/.test(R.patientHTML(en).replace(/<[^>]+>/g, '')), 'Patient preview text is escaped');
  const none = R.buildPatient('CX-1043', {lang: 'en'});
  check(none.symptoms.length === 0 && none.submitted === null, 'Patient without a health check gets no invented symptoms');

  console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} referral-worklist checks (per-patient journeys, PDF validation, patient summary).`);
  if (defects.length) process.exitCode = 1;
})();
