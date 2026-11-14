// Referral report builder: content, measurements and safety checks.
// Runs the real scripts in a VM with small DOM stubs (no browser needed).
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const node = () => ({innerHTML: '', textContent: '', value: '', dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, focus() {}, showModal() {}, close() {}, open: false});
const listeners = {};
const document = {querySelector: () => node(), querySelectorAll: () => [], addEventListener: (n, fn) => (listeners[n] ??= []).push(fn), createElement: () => node(), documentElement: node(), title: ''};
const ctx = vm.createContext({document, window: {scrollTo() {}, addEventListener() {}}, location: {hash: '#care/reports'}, localStorage: {getItem: () => null, setItem() {}}, Blob, URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, FormData: class { constructor(f) { this.f = f; } *[Symbol.iterator]() { yield* Object.entries(this.f.values || {}); } }, setTimeout: () => 1, clearTimeout() {}, console, Set, Intl});
for (const f of ['screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', 'ai-second-reader.js', 'imaging.js', 'referral-report.js']) vm.runInContext(read(f), ctx);
vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients};', ctx);
const R = ctx.window.candexReport, S = ctx.window.candexScreening, api = ctx.api;
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };

(async () => {
  // A submitted health check: 64-year-old current smoker with coughing up blood.
  for (const fn of listeners.submit || []) await fn({preventDefault() {}, target: {id: 'health-form', values: {name: 'Test Person', age: '64', sex: 'Male', focus: 'Lung', sym_haemoptysis: 'on', duration: 'More than 3 weeks', smoking: 'Currently smoke', cigs_per_day: '20', smoke_years: '40', family: 'Two or more close relatives, or one diagnosed under 50', region: 'Kainuu', travel: 'Over 60 minutes', language: 'Arabic', route: 'Public health centre', radon: 'Never measured'}}});
  const hc = api.patients.find(p => p.source === 'health-check');
  check(hc, 'Health check did not create a patient');

  // Aino (CX-1042) is linked to LIDC-IDRI-0799 (approx. Lung-RADS 4A, 8.4 mm).
  const a = R.build('CX-1042');
  check(a.caseId === 'LIDC-IDRI-0799', 'Aino should use the linked study');
  check(a.geometry.long >= 6 && a.geometry.long <= 14, `Implausible long axis ${a.geometry.long}`);
  check(a.geometry.short > 0 && a.geometry.short <= a.geometry.long, 'Short axis must be positive and not exceed the long axis');
  check(/Lung-RADS 4A/.test(a.impression.bottomLine), 'Bottom line should state the category');
  // AI second reader: precomputed research read, never part of the clinical decision.
  check(a.ai.rows.some(r => r[0] === 'Overall') && a.ai.rows.every(r => r[2] !== 'Pending') && ['agrees', 'partly', 'disagrees'].includes(a.ai.verdict), 'AI read should fill the comparison with an overall verdict');
  check(/research comparison, not for clinical use/i.test(a.ai.note) && /not calibrated/.test(a.ai.note) && /95% CI/.test(a.ai.note), 'AI note must carry the research disclaimer, calibration warning and CI');
  check(a.labels.s6 === 'AI second reader: research comparison', 'Section 6 is labelled as a research comparison');
  {
    const saved = ctx.window.candexAiReads;
    const withAi = R.build('CX-1042', {lang: 'en'});
    ctx.window.candexAiReads = undefined;
    const noAi = R.build('CX-1042', {lang: 'en'});
    check(noAi.ai.rows.some(r => r[2] === 'Pending') && /No AI second read/.test(noAi.ai.note), 'Without the AI file the comparison stays pending');
    check(JSON.stringify([withAi.impression, withAi.pathway.find(r => r[0] === 'Urgency')]) === JSON.stringify([noAi.impression, noAi.pathway.find(r => r[0] === 'Urgency')]), 'The AI read must not change the impression, recommendations or urgency');
    check(!R.previewHTML(noAi).includes('undefined'), 'Preview without AI data stays clean');
    ctx.window.candexAiReads = saved;
  }
  check(a.patient.find(r => r[0] === 'Health check submitted')[1] === 'No health check on record', 'Missing health check must be stated');
  check(a.context.every(r => !/^No$|^None$/.test(r[1])), 'Missing data must read "Not recorded", not a negative');
  check(/Not evaluated/.test(a.findings.nodal) && /Not evaluated/.test(a.findings.distant), 'Unreviewed regions must be marked not evaluated');

  // The health-check patient gets a study automatically (lung pathway).
  const h = R.build(hc.id);
  check(h.caseId && h.findings, 'Lung health-check patient should have a linked study');
  check(/Urgent/.test(h.pathway.find(r => r[0] === 'Urgency')[1]), 'Red-flag symptom must make the referral urgent');
  check(h.context.find(r => r[0] === 'Presenting symptoms')[1].includes('[red flag]'), 'Red-flag symptom must be labelled');
  check(/pack-years/.test(h.context.find(r => r[0] === 'Smoking')[1]), 'Pack-years missing');
  check(h.impression.recs.some(r => /smoking-cessation/.test(r)), 'Current smoker needs cessation advice');
  check(h.impression.recs.some(r => /genetics/.test(r)), 'Family history pattern needs genetics advice');
  check(h.impression.recs.some(r => /interpreter/i.test(r)), 'Arabic speaker needs an interpreter recommendation');
  check(h.patient.find(r => r[0] === 'Health check submitted')[1] !== 'No health check on record', 'Submission date missing');

  // A non-lung patient without imaging still produces a complete report.
  const m = R.build('CX-1043');
  check(!m.findings && !m.ai, 'Unlinked patient must not show imaging findings');
  check(/No suspicious imaging|without imaging/.test(m.impression.bottomLine), 'Unlinked patient bottom line');

  // Finnish report: same content, Finnish labels and wording.
  const fi = R.build(hc.id, {lang: 'fi'});
  check(fi.lang === 'fi' && fi.title === 'Potilasyhteenveto ja syöpälähete', 'Finnish title missing');
  check(/Kiireellinen/.test(fi.pathway.find(r => r[0] === 'Kiireellisyys')[1]), 'Finnish urgency missing');
  check(fi.labels.s7 === 'Johtopäätökset' && fi.impression.recs.some(r => /tupakoinnin lopettamiseen/.test(r)), 'Finnish impression/recommendations missing');
  check(/Lung-RADS 4B \(arvio\)/.test(fi.impression.bottomLine), 'Finnish bottom line missing');
  check(!/ years|Urgent|Not recorded|Bottom line/.test(JSON.stringify([fi.labels, fi.pathway.map(r => r[0]), fi.impression, fi.plain])), 'English text left in the Finnish report structure');
  check(/^[\x00-\xFF]*$/.test(R.clean(JSON.stringify(fi))), 'Finnish report must stay within Latin-1 after clean()');
  check(R.build(hc.id, {lang: 'en'}).lang === 'en', 'Switching back to English failed');

  // Preview escapes text and never prints "undefined"; PDF text is Latin-1.
  for (const rep of [a, h, m, fi]) {
    const html = R.previewHTML(rep);
    check(!html.includes('undefined') && !html.includes('NaN'), `Preview for ${rep.id} contains undefined/NaN`);
    const all = JSON.stringify(rep);
    check(/^[\x00-\xFF]*$/.test(R.clean(all)), 'clean() must leave only Latin-1 characters');
  }
  console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} referral-report checks (measurements, urgency, negatives vs not evaluated, AI pending, preview safety).`);
  if (defects.length) process.exitCode = 1;
})();
