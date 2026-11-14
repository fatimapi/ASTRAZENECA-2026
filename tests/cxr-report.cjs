// Chest X-ray AI summary in the referral report: data integrity, bilingual
// content, PDF/preview wiring, and that it never changes the clinical decision.
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const node = () => ({innerHTML: '', textContent: '', value: '', dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, focus() {}, showModal() {}, close() {}, open: false});
const document = {querySelector: () => node(), querySelectorAll: () => [], addEventListener() {}, createElement: () => node(), documentElement: node(), title: ''};
const mk = withCxr => {
  const ctx = vm.createContext({document, window: {scrollTo() {}, addEventListener() {}}, location: {hash: '#care/reports'}, localStorage: {getItem: () => null, setItem() {}}, sessionStorage: {getItem: () => null, setItem() {}}, Blob, URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, FormData: class {}, setTimeout: () => 1, clearTimeout() {}, console, Set, Intl});
  for (const f of ['screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', ...(withCxr ? ['data/lidc/cxr-reads.js'] : []), 'ai-second-reader.js', 'imaging.js', 'referral-report.js']) vm.runInContext(read(f), ctx);
  vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients};', ctx);
  ctx.window.candexImaging.links['CX-1042'] = 'LIDC-IDRI-0116';
  return ctx;
};
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };

const ctx = mk(true), R = ctx.window.candexReport, D = ctx.window.candexCxrReads;
check(D?.schema === 1 && Object.keys(D.cases).length === 8, 'cxr-reads.js has 8 patients');
const cases = ctx.window.candexImaging.CASES;
for (const [pid, x] of Object.entries(D.cases)) {
  check(cases[pid], `${pid} has a CT case in the site`);
  check(fs.existsSync(path.join(__dirname, '..', x.image)), `${pid} X-ray image exists`);
  check(x.scores.length === 18 && x.scores.every(s => s.score >= 0 && s.score <= 1), `${pid} has 18 scores in 0–1`);
  check(x.summary.en && x.summary.fi && x.keyPoints.en.length && x.keyPoints.fi.length, `${pid} has English and Finnish summary and key points`);
  check(x.review?.verdict === 'consistent with the raw data', `${pid} passed the safety review`);
  // Every two-decimal number the summary quotes must match a raw score, the CT size or the view evidence.
  const allowed = new Set([...x.scores.map(s => s.score.toFixed(2)), '1.80', '1.83', '0', '1']);
  const ct = cases[pid]; if (ct) allowed.add(String(ct.nodules[0].diameter));
  const nums = (x.summary.en.match(/\b\d\.\d{2}\b/g) || []);
  check(nums.every(n => allowed.has(n)), `${pid} summary quotes only real scores (${nums.filter(n => !allowed.has(n))})`);
  check(!/\b(diagnos(is|ed) (of|with)|you have|recommend(ed)? (treatment|biopsy|surgery))\b/i.test(x.summary.en.split(/(?<=\.)\s/).filter(z => !/\bnot\b/.test(z)).join(" ")), `${pid} summary makes no diagnosis or treatment advice`);
}

for (const lang of ['en', 'fi']) {
  const r = R.build('CX-1042', {lang});
  check(r.caseId === 'LIDC-IDRI-0116' && r.cxr, `${lang}: report for a patient linked to 0116 has the X-ray section`);
  check(r.cxr.summary === D.cases['LIDC-IDRI-0116'].summary[lang], `${lang}: summary is in the report language`);
  check(r.cxr.rows.some(x => x[0] === 'Nodule') && r.cxr.rows.some(x => x[0] === 'Mass'), `${lang}: score table always shows Nodule and Mass`);
  check(/uncalibrated|kalibroimattomia/.test(r.cxr.note) && /urgency|kiireellisyyteen/.test(r.cxr.note), `${lang}: note says uncalibrated and not used for urgency`);
  const html = R.previewHTML(r);
  check(html.includes(r.labels.sx) && html.includes('data/lidc/LIDC-IDRI-0116/cxr.jpg') && !/undefined/.test(html), `${lang}: preview shows the section and image`);
}
// Finnish view notes belong to the right patient (0116: inversion fix, not 0170's leads note).
{ const fi = R.build('CX-1042', {lang: 'fi'}).cxr.view; check(/käänteiset/.test(fi) && !/Valvontajohdot/.test(fi), 'Finnish view note matches the patient'); }
ctx.window.candexImaging.links['CX-1042'] = 'LIDC-IDRI-0170';
{ const fi = R.build('CX-1042', {lang: 'fi'}).cxr.view; check(/Valvontajohdot/.test(fi) && !/Monitoring/.test(fi), '0170 note is translated'); }
ctx.window.candexImaging.links['CX-1042'] = 'LIDC-IDRI-0116';
// The X-ray summary must not change the clinical decision.
const without = mk(false).window.candexReport.build('CX-1042', {lang: 'en'}), withX = R.build('CX-1042', {lang: 'en'});
check(without.cxr === null, 'No X-ray data → no section');
check(JSON.stringify(without.impression) === JSON.stringify(withX.impression), 'Bottom line, findings and recommendations are identical with and without the X-ray summary');
// A study with no X-ray gets no section.
ctx.window.candexImaging.links['CX-1042'] = 'LIDC-IDRI-0799';
check(R.build('CX-1042').cxr === null, 'A CT study without an X-ray has no X-ray section');
// PDF writer handles the section.
const src = read('referral-report.js');
check(/if \(rep\.cxr\) \{\s*k\.section\(n\+\+, L\.sx\)/.test(src) && /cxrImage\(rep\)/.test(src), 'PDF writer draws the X-ray section and loads the image');
check(/r\.cxr \? \[r\.cxr\.summary, r\.cxr\.rows\]/.test(src), 'Approval fingerprint covers the X-ray summary');
check(/cxr\\\.jpg/.test(read('backend/app.py')), 'Backend serves cxr.jpg');
check(read('index.html').includes('data/lidc/cxr-reads.js'), 'index.html loads cxr-reads.js');

console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} chest X-ray summary checks.`);
if (defects.length) process.exitCode = 1;
