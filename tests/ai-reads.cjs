// AI second reader (research): data file, agreement rules, imaging card,
// marker logic and the approval fingerprint. Real scripts in a VM with stubs.
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mem = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)}; };
const node = () => ({innerHTML: '', textContent: '', value: '', dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, focus() {}, showModal() {}, close() {}, open: false});
const document = {querySelector: () => node(), querySelectorAll: () => [], addEventListener() {}, createElement: () => node(), documentElement: node(), title: ''};
const win = {scrollTo() {}, addEventListener() {}};
const ctx = vm.createContext({document, window: win, location: {hash: '#care/scan'}, localStorage: mem(), sessionStorage: mem(), Blob, URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, FormData: class { constructor(f) { this.f = f; } *[Symbol.iterator]() { yield* Object.entries(this.f.values || {}); } }, setTimeout: () => 1, clearTimeout() {}, console, Set, Map, Intl, crypto: globalThis.crypto});
for (const f of ['referral-store.js', 'screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', 'ai-second-reader.js', 'imaging.js', 'referral-report.js']) vm.runInContext(read(f), ctx);
vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients};', ctx);
const AI = win.candexAi, LIDC = win.candexLidc, data = win.candexAiReads, R = win.candexReport;
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };

// Data file: every read belongs to a known study; provenance is complete; no reference copied.
check(data && data.schema === 1, 'ai-reads.js defines schema 1');
check(Object.keys(data.cases).every(id => LIDC[id]), 'Every AI read matches a study in cases.js');
for (const k of ['model', 'generated', 'input', 'runs', 'promptSha', 'referenceRule', 'leaderboard', 'disclaimer']) check(data.provenance[k] != null, `Provenance has ${k}`);
check(/not for clinical use/i.test(data.provenance.disclaimer) && /not CE-marked/.test(data.provenance.disclaimer), 'Disclaimer says research only and not CE-marked');
check(Object.values(data.cases).every(r => !('reference' in r)), 'The radiologist reference is not duplicated in ai-reads.js');
check(/\d+\/\d+/.test(data.provenance.leaderboard.found) && /%/.test(data.provenance.leaderboard.ci), 'Leaderboard reports found/n with a CI');

// Agreement rules on every study, plus the known miss.
for (const id of Object.keys(data.cases)) {
  const a = AI.agreement(LIDC[id]);
  check(a && ['agrees', 'partly', 'disagrees'].includes(a.verdict), `Agreement verdict for ${id}`);
  if (!data.cases[id].nodule_present) check(a.verdict === 'disagrees' && /AI reported no nodule; radiologists marked one\./.test(AI.card(LIDC[id])), `${id}: a miss is shown as a disagreement with a clear warning`);
}
const fake = {...LIDC['LIDC-IDRI-0365']};
const c0 = AI.mainCentroid(fake);
check(AI.agreement(fake, {nodule_present: true, location: {side: 'left'}, long_axis_mm: 18, lung_rads: '4B'}).verdict === 'agrees', 'A matching read agrees');
check(AI.agreement(fake, {nodule_present: true, location: {side: 'right'}, long_axis_mm: 5, lung_rads: '2'}).verdict === 'disagrees', 'Wrong side, size and category disagrees');
check(AI.onNodule(fake, {x: c0.x + 3, y: c0.y - 2, frame: c0.frame}) === true && AI.onNodule(fake, {x: 20, y: 20, frame: c0.frame}) === false, 'Marker hit test uses the radiologists’ outline centroid');
check(AI.agreement(fake, {nodule_present: true, location: {side: 'left'}, long_axis_mm: 18, lung_rads: '4B', candidates: [{x: 20, y: 20, frame: c0.frame}]}).verdict === 'disagrees', 'A finding in the wrong place is not counted as agreement');
check(AI.agreement(fake, {nodule_present: true, location: {side: 'left'}, long_axis_mm: 18, lung_rads: '4B', extra_future_field: [1, 2]}) !== null, 'Unknown extra fields are tolerated');
{
  const ws = AI.agreement(fake, {nodule_present: true, location: {side: 'right'}, long_axis_mm: 18, lung_rads: '4B'});
  check(ws.wrongSide && ws.verdict === 'disagrees', 'A finding on the other side is a disagreement, even with the right size and category');
  check(/other side/.test(AI.card({...fake, id: 'LIDC-IDRI-0365'})) === (AI.agreement(fake).wrongSide === true), 'Card warns about other-side findings only when they happen');
}
check(/class="ct-ai"/.test(AI.markerSVG({...fake, id: 'X'}, 0)) === false, 'No marker without a read');

// Card and imaging page render cleanly.
for (const id of Object.keys(LIDC)) {
  const html = AI.card(LIDC[id]);
  check(!/undefined|NaN/.test(html) && /AI second reader \(research\)/.test(html), `Card for ${id} renders cleanly`);
}
ctx.api.state.selected = 'CX-1042';
check(/AI second reader \(research\)/.test(win.candexImaging.scanView()) && !/No imaging AI has run/.test(win.candexImaging.scanView()), 'Imaging review shows the AI card and accurate wording');

// Report section 6 carries the imaging AI findings (preview and PDF share the same object).
{
  const rep = R.build('CX-1042', {lang: 'en'}), ai = rep.ai, r = data.cases['LIDC-IDRI-0799'];
  check(ai.summary && ai.summary.startsWith(r.nodule_present ? 'AI found' : 'AI reported no nodule'), 'Report has a one-line AI finding');
  const html = R.previewHTML(rep);
  check(html.includes('AI finding (from imaging review)') && (!r.short_report || html.includes(r.short_report.slice(0, 40).replace(/&/g, '&amp;'))), 'Preview shows the AI finding and its verbatim report text');
  const missId = Object.keys(data.cases).find(id => !data.cases[id].nodule_present || AI.agreement(LIDC[id]).wrongSide);
  check(!!missId, 'The exported reads include at least one miss or other-side finding to show');
  if (missId) {
    win.candexImaging.links['CX-1043'] = missId;
    const m = R.build('CX-1043', {lang: 'en'});
    check(/must never be used to rule out|other side/.test(m.ai.miss) && R.previewHTML(m).includes('rr-ai-miss'), 'A miss or other-side finding shows a warning in the report');
    check(m.ai.verdict === 'disagrees', 'A miss or other-side finding is a disagreement in the report');
  }
  check(/found \d+\/\d+ on the correct side/.test(rep.ai.note), 'Report counts only correct-side finds');
  const fi = R.build('CX-1042', {lang: 'fi'});
  check(/^Tekoäly (löysi|ei löytänyt)/.test(fi.ai.summary) && fi.labels.aiFinding.startsWith('Tekoälyn löydös'), 'Finnish report carries the AI finding in Finnish');
}

// Approval: changing the prompt version (re-export) invalidates an approval.
R.markPreviewed('CX-1042');
R.approveNow('CX-1042');
check(R.approvalStatus('CX-1042').state === 'approved', 'Report approved');
const savedSha = data.provenance.promptSha;
data.provenance.promptSha = 'different';
check(R.approvalStatus('CX-1042').state === 'changed', 'A new AI export (prompt version) requires re-approval');
data.provenance.promptSha = savedSha;
check(R.approvalStatus('CX-1042').state === 'approved', 'Restoring the export restores the approval');
check(/AI research comparison reviewed/.test(JSON.stringify(R.build('CX-1042', {lang: 'en'}).signoff)), 'Sign-off records that the AI comparison was reviewed but not used');

console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} AI second-reader checks (data file, agreement, marker, card, approval).`);
if (defects.length) process.exitCode = 1;
