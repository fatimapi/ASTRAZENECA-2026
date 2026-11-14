// Clinician approval of the referral report: preview-before-approve, release
// to the referral journey, language independence, change detection, withdraw.
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mem = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)}; };
const node = () => ({innerHTML: '', textContent: '', value: '', dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, focus() {}, showModal() {}, close() {}, open: false});
const listeners = {};
const document = {querySelector: () => node(), querySelectorAll: () => [], addEventListener: (n, fn) => (listeners[n] ??= []).push(fn), createElement: () => node(), documentElement: node(), title: ''};
const win = {scrollTo() {}, addEventListener() {}};
const ctx = vm.createContext({document, window: win, location: {hash: '#care/reports'}, localStorage: mem(), sessionStorage: mem(), Blob, URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, FormData: class { constructor(f) { this.f = f; } *[Symbol.iterator]() { yield* Object.entries(this.f.values || {}); } }, setTimeout: () => 1, clearTimeout() {}, console, Set, Map, Intl, crypto: globalThis.crypto});
for (const f of ['referral-store.js', 'screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', 'ai-second-reader.js', 'imaging.js', 'referral-report.js', 'referral-hub.js']) vm.runInContext(read(f), ctx);
vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients};', ctx);
const R = win.candexReport, store = win.CandexReferralStore, I = win.candexImaging;
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };
const throws = (fn, msg) => { checks++; try { fn(); defects.push(msg); } catch { /* expected */ } };

(async () => {
  for (const fn of listeners.submit || []) await fn({preventDefault() {}, target: {id: 'health-form', values: {name: 'Test Person', age: '64', sex: 'Male', focus: 'Lung', sym_haemoptysis: 'on', duration: 'More than 3 weeks', smoking: 'Currently smoke', cigs_per_day: '20', smoke_years: '40'}}});
  const id = ctx.api.patients.find(p => p.source === 'health-check').id;

  check(R.approvalStatus(id).state === 'none', 'New report starts unapproved');
  check(/UNSIGNED DRAFT/.test(R.build(id, {lang: 'en'}).labels.banner), 'Unapproved report shows the draft banner');
  throws(() => R.approveNow(id), 'Approval must require a preview of the current version');

  R.markPreviewed(id);
  const a = R.approveNow(id, {release: true});
  check(a.version === 1 && a.released && a.by === 'Dr. Emilia Koski', 'Approval records version, clinician and release');
  check(store.peek(id).reports.length === 1 && store.peek(id).reports[0].approvedBy === 'Dr. Emilia Koski', 'Approved report is released to that patient’s journey');
  check(store.peek('CX-1042').reports.length === 0, 'Other patients’ journeys are untouched');
  check(R.approvalStatus(id).state === 'approved', 'Release does not invalidate the approval');

  const en = R.build(id, {lang: 'en'});
  check(/^APPROVED/.test(en.labels.banner) && en.labels.draft === 'Approved · v1', 'Approved banner and badge');
  check(en.signoff.some(([k, v]) => k === 'Approved by' && v.startsWith('Dr. Emilia Koski')), 'Sign-off names the approving clinician');
  check(/Your doctor has reviewed this summary/.test(en.plain) && !/not yet been checked/.test(en.plain), 'Patient wording reflects the approval');
  check(/reviewed this summary/.test(R.buildPatient(id, {lang: 'en'}).main), 'Patient summary PDF reflects the approval');
  const fi = R.build(id, {lang: 'fi'});
  check(R.approvalStatus(id).state === 'approved' && /^HYVÄKSYTTY/.test(fi.labels.banner), 'Approval survives a language switch (Finnish banner)');

  // Changing the clinical content (a different CT study) invalidates the approval.
  const before = I.links[id];
  I.links[id] = Object.keys(I.CASES).find(k => k !== before);
  check(R.approvalStatus(id).state === 'changed', 'Content change marks the report as changed');
  check(/^CHANGED SINCE APPROVAL/.test(R.build(id, {lang: 'en'}).labels.banner), 'Changed report shows the re-approval banner');
  throws(() => R.approveNow(id), 'Re-approval also needs a fresh preview');
  R.markPreviewed(id);
  check(R.approveNow(id).version === 2, 'Re-approval increments the version');

  R.withdrawApproval(id);
  check(R.approvalStatus(id).state === 'none' && /UNSIGNED DRAFT/.test(R.build(id, {lang: 'en'}).labels.banner), 'Withdraw returns the report to draft');
  check(!R.previewHTML(R.build(id)).includes('undefined'), 'Preview stays clean');

  console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} approval checks (preview first, release, language-independent, change detection, withdraw).`);
  if (defects.length) process.exitCode = 1;
})();
