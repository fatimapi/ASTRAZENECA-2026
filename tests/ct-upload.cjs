// CT upload on a small server: the browser sends only one CT series (at most 200 slices),
// starts a background job and polls it. Uses the demo DICOM files in demo-data/.
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mem = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; }}; };
const node = (extra = {}) => ({innerHTML: '', textContent: '', value: '', checked: false, dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, getAttribute() { return null; }, focus() {}, closest: () => null, ...extra});
const nodes = {'#ctc-chest': node({checked: true}), '#ctc-permit': node({checked: true})};
const listeners = {};
const document = {querySelector: sel => (nodes[sel] ||= node()), querySelectorAll: () => [], addEventListener: (n, fn) => (listeners[n] ??= []).push(fn), createElement: () => node(), documentElement: node(), body: node(), createTreeWalker: () => ({nextNode: () => null})};
const calls = [];
let script = [];
const fetch = async (url, opts = {}) => { calls.push({url, method: opts.method || 'GET', body: opts.body}); const r = script.shift(); return {ok: r.status < 400, status: r.status, json: async () => r.body}; };
class FormData { constructor() { this.items = []; } append(k, v) { this.items.push([k, v]); } }
const win = {scrollTo() {}, addEventListener() {}};
const ctx = vm.createContext({document, window: win, location: {hash: '#care/ct-compare'}, localStorage: mem(), sessionStorage: mem(), MutationObserver: class { observe() {} }, fetch, FormData, File, Blob, console, setTimeout: (fn) => setImmediate(fn), clearTimeout() {}, Set, Map, Intl, crypto: globalThis.crypto});
for (const f of ['i18n.js', 'i18n-screening.js', 'referral-store.js', 'screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', 'data/lidc/cxr-reads.js', 'ai-second-reader.js', 'imaging.js', 'care-journey.js', 'ct-compare.js', 'referral-report.js', 'agent-workspace.js']) {
  try { vm.runInContext(read(f), ctx); } catch (e) { if (!/i18n/.test(f)) throw e; }
}
vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients};', ctx);
const C = win.candexCtCompare, A = win.candexAgent;
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };
const files = dir => fs.readdirSync(dir).filter(f => f.endsWith('.dcm')).sort().map(f => new File([fs.readFileSync(path.join(dir, f))], f));
const fixture = JSON.parse(read('tests/fixtures/ct-compare-0110.json'));
const until = async cond => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setImmediate(r)); };

(async () => {
  const a = files('demo-data/ct-uploads/LIDC-IDRI-0078'), b = files('demo-data/ct-uploads/LIDC-IDRI-0110'), x = files('demo-data/chest-xrays');
  const h = await C._dicomHeader(b[0]);
  check(h && h.modality === 'CT' && /^1\.3\.6/.test(h.series) && Number.isFinite(h.z), 'Browser reads Modality, series and slice position from the header');
  check((await C._dicomHeader(x[0]))?.modality !== 'CT', 'X-ray files are recognised as not CT');
  let c = await C._chooseFiles([...a, ...x, ...b]);
  check(c.files.length === b.length && c.files.every(f => b.includes(f)) && /95 other files left out/.test(c.note), 'Only the largest CT series is sent; other series and X-rays are left out');
  c = await C._chooseFiles([...b, ...b]);
  check(c.files.length === 125 && c.original === 250 && /Sending 125 of 250 slices/.test(c.note), 'A long series is cut to at most 200 evenly spaced slices');
  c = await C._chooseFiles([new File([new Uint8Array(400)], 'junk.dcm'), ...b]);
  check(c.files.length === b.length + 1 && c.note === '', 'An unreadable header falls back to sending all files');

  // Job flow: POST answers with a job; the page polls until the result arrives.
  ctx.api.state.selected = 'CX-1042';
  A.setToken('t'.repeat(32));
  for (const fn of listeners.change || []) fn({target: {id: 'ctc-files', files: [...a, ...b]}});
  await until(() => C.view().includes('125 files'));
  check(/125 files/.test(C.view()) && /other files left out/.test(C.view()), 'Page shows what will be sent');
  script = [{status: 202, body: {job: 'J1', status: 'running', stage: 'queued'}}, {status: 200, body: {job: 'J1', status: 'running', stage: 'search'}}, {status: 200, body: {job: 'J1', status: 'done', stage: 'summary', result: fixture}}];
  for (const fn of listeners.click || []) fn({target: {closest: s => (s === '[data-ctc-run]' ? {} : null), id: ''}});
  await until(() => calls.length >= 3 && !/Comparing/.test(C.view()));
  check(calls[0].method === 'POST' && calls[0].url === '/api/ct/compare' && calls[1].url === '/api/ct/jobs/J1' && calls[2].url === '/api/ct/jobs/J1', 'Upload starts a job, then the page polls it');
  const sent = calls[0].body.items.filter(([k]) => k === 'files').length;
  check(sent === 125, 'Only the chosen series is uploaded');
  check(C.forPatient('CX-1042', 'en')?.closest === fixture.closest, 'The polled result is saved for the patient');
  // A failed job shows its message.
  for (const fn of listeners.change || []) fn({target: {id: 'ctc-files', files: b}});
  await until(() => C.view().includes('125 files'));
  calls.length = 0;
  script = [{status: 202, body: {job: 'J2', status: 'running', stage: 'queued'}}, {status: 200, body: {job: 'J2', status: 'error', stage: 'read', code: 503, detail: 'The AI service is rate-limited (too many requests or the daily quota is used up). Wait a minute and try again.'}}];
  for (const fn of listeners.click || []) fn({target: {closest: s => (s === '[data-ctc-run]' ? {} : null), id: ''}});
  await until(() => /rate-limited/.test(C.view()));
  check(/rate-limited/.test(C.view()), 'A failed job shows the server’s message');
  console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} CT upload checks (one series, 200-slice cap, header fallback, background job and polling).`);
  if (defects.length) process.exitCode = 1;
})();
