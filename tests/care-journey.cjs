// Patient care journey: health check -> screening -> CT and X-ray analysis ->
// reviewed report -> follow-up -> referral -> specialist; restart on each new
// health check; report release waits for the imaging analysis; reset-all.
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mem = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; }}; };
const node = () => ({innerHTML: '', textContent: '', value: '', dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, focus() {}, showModal() {}, close() {}, open: false});
const listeners = {};
const document = {querySelector: () => node(), querySelectorAll: () => [], addEventListener: (n, fn) => (listeners[n] ??= []).push(fn), createElement: () => node(), documentElement: node(), title: ''};
const win = {scrollTo() {}, addEventListener() {}};
const local = mem(), session = mem();
const ctx = vm.createContext({document, window: win, location: {hash: '#patient/pathway'}, localStorage: local, sessionStorage: session, Blob, URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, FormData: class { constructor(f) { this.f = f; } *[Symbol.iterator]() { yield* Object.entries(this.f.values || {}); } }, setTimeout: () => 1, clearTimeout() {}, console, Set, Map, Intl, crypto: globalThis.crypto});
for (const f of ['referral-store.js', 'screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', 'data/lidc/cxr-reads.js', 'ai-second-reader.js', 'imaging.js', 'care-journey.js', 'referral-report.js', 'landing.js']) vm.runInContext(read(f), ctx);
vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients,actions,stagesNow,pathwayView,patientOverview};', ctx);
const J = win.CandexJourney, store = win.CandexReferralStore, R = win.candexReport, api = ctx.api;
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };
const statuses = id => J.stages(id).map(s => `${s.key}:${s.status}`).join(' ');
const submitHealthCheck = async values => { for (const fn of listeners.submit || []) await fn({preventDefault() {}, stopImmediatePropagation() {}, target: {id: 'health-form', values}}); };

(async () => {
  // Before any health check: the portal is Aino and the pathway starts at screening.
  check(J.portalPatient().id === 'CX-1042', 'Portal patient is Aino before a health check');
  check(statuses('CX-1042').startsWith('screening:current imaging:upcoming results:upcoming specialist:upcoming'), `Starts at screening (${statuses('CX-1042')})`);
  check(J.stages().map(s => s.title).includes('CT and X-ray'), 'The imaging step is called "CT and X-ray"');
  check(!/radon/i.test(win.candexScreening.healthView()), 'The health check has no radon question');

  // Submitting a health check: the portal follows it; next step is CT and X-ray.
  await submitHealthCheck({name: 'Test Person', age: '64', sex: 'Male', focus: 'Lung', sym_haemoptysis: 'on', duration: 'More than 3 weeks', smoking: 'Currently smoke', cigs_per_day: '20', smoke_years: '40', region: 'Kainuu', travel: 'Over 60 minutes', language: 'Finnish', route: 'Public health centre'});
  const pid = J.portalPatient().id;
  check(/^HC-\d+$/.test(pid), `Portal follows the submitted health check (${pid})`);
  check(/Welcome, Test\./.test(api.patientOverview()), 'Overview greets the health-check patient by name');
  check(statuses(pid).startsWith('screening:done imaging:current results:upcoming specialist:upcoming'), `After the health check: screening done, CT and X-ray next (${statuses(pid)})`);
  check(/stage-list/.test(api.pathwayView()) && /CT and X-ray/.test(api.pathwayView()), 'My care pathway shows the live steps');

  // The report cannot be released before the imaging analysis.
  R.markPreviewed(pid);
  let blocked = '';
  try { R.approveNow(pid, {release: true}); } catch (e) { blocked = e.message; }
  check(/Complete the CT and X-ray analysis/.test(blocked), 'Report release waits for the CT and X-ray analysis');
  store.select({id: pid, name: 'Test Person'});
  check(!store.get().currentReport, 'Nothing was released to the patient');

  // Doctor completes the analysis: step 2 done; the report is being reviewed.
  const caseId = win.candexImaging.links[pid];
  check(!!caseId, 'Lung health check links a CT study');
  J.completeImaging(pid, {ct: caseId, xray: true});
  check(statuses(pid).startsWith('screening:done imaging:done results:current'), `After the analysis: results current (${statuses(pid)})`);
  check(/reviewing your report/.test(J.stages(pid)[2].text), 'Patient is told the doctor is reviewing the report');

  // Doctor reviews and releases the report; the patient sees it as reviewed.
  R.markPreviewed(pid);
  const approval = R.approveNow(pid, {release: true});
  check(approval.released === true, 'Report approved and released after the analysis');
  check(/has been reviewed by your doctor/.test(J.stages(pid)[2].text), 'Patient sees the report as reviewed only after release');

  // Patient books, doctor records the follow-up and issues a referral -> specialist.
  store.select({id: pid, name: 'Test Person'});
  const slot = store.offeredSlots()[0];
  store.bookAppointment(slot.id, store.methods[0], {role: 'patient'});
  check(/follow-up appointment is booked/.test(J.stages(pid)[2].text) && J.keyDates(pid).some(d => /Follow-up/.test(d[1])), 'Booking appears on the pathway and key dates');
  store.completeFollowUp({role: 'care', confirm: true});
  check(statuses(pid).includes('results:current') && /deciding whether a specialist referral/.test(J.stages(pid)[2].text), 'After the follow-up: awaiting the referral decision');
  store.recordReferral({outcome: 'issued', destination: 'Specialist respiratory service', reason: 'Findings need specialist assessment.'}, {role: 'care'});
  check(statuses(pid).startsWith('screening:done imaging:done results:done specialist:current'), `After the referral: specialist current (${statuses(pid)})`);
  check(/Specialist respiratory service/.test(J.stages(pid)[3].text), 'Specialist step names the receiving service');

  // A new health check for the same patient restarts the journey.
  await submitHealthCheck({name: 'Test Person', age: '64', sex: 'Male', focus: 'Lung', smoking: 'Currently smoke', region: 'Kainuu'});
  check(J.portalPatient().id === pid && !J.imaging(pid), 'Same patient, imaging analysis cleared');
  store.select({id: pid, name: 'Test Person'});
  check(!store.get().currentReport && !store.get().activeAppointment && !store.get().currentDecision, 'Report, booking and referral cleared on a new health check');
  check(statuses(pid).startsWith('screening:done imaging:current results:upcoming specialist:upcoming'), `Pathway back to CT and X-ray (${statuses(pid)})`);

  // Reset all dashboards: demo data cleared, preferences kept.
  local.setItem('candex-lang', 'fi'); local.setItem('candex-theme', 'dark');
  J.completeImaging(pid, {ct: caseId});
  J.resetAll();
  const left = [...Array(local.length).keys()].map(i => local.key(i)).concat([...Array(session.length).keys()].map(i => session.key(i))).filter(k => k.startsWith('candex-'));
  check(left.sort().join(',') === 'candex-lang,candex-theme', `Reset clears demo data and keeps preferences (left: ${left.join(', ')})`);
  check(/data-entry-action="reset-all"/.test(win.CandexLanding.view({})), 'Switch workspace page has "Reset all dashboards"');
  check(typeof api.actions['reset-all'] === 'function' && typeof api.actions['reset-all-confirm'] === 'function', 'Reset asks for confirmation first');

  console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} care-journey checks (health check -> screening -> CT and X-ray -> report -> follow-up -> specialist; restart; reset).`);
  if (defects.length) process.exitCode = 1;
})();
