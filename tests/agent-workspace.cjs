// Clinical agent workspace: grounded record, rendering and the no-AI fallbacks.
// Live Gemini calls are tested manually against the backend; here the backend
// is "not configured", so every tool must fall back honestly without AI.
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mem = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)}; };
const node = () => ({innerHTML: '', textContent: '', value: '', dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, focus() {}, showModal() {}, close() {}, open: false, scrollTop: 0, scrollHeight: 0});
const document = {querySelector: () => node(), querySelectorAll: () => [], addEventListener() {}, createElement: () => node(), documentElement: node(), title: ''};
const win = {scrollTo() {}, addEventListener() {}};
const ctx = vm.createContext({document, window: win, location: {hash: '#care/agents'}, localStorage: mem(), sessionStorage: mem(), Blob, URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, FormData: class {}, setTimeout: () => 1, clearTimeout() {}, console, Set, Map, Intl, crypto: globalThis.crypto, fetch: () => Promise.reject(new Error('no network in tests'))});
for (const f of ['referral-store.js', 'screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', 'ai-second-reader.js', 'imaging.js', 'referral-report.js', 'referral-hub.js', 'agent-workspace.js']) vm.runInContext(read(f), ctx);
vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients};', ctx);
const A = win.candexAgent;
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };

(async () => {
  // The record the agent may see: same data as the referral report, with the disclaimer.
  const rec = A.record('CX-1042');
  for (const s of ['About', 'Patient', 'Care pathway', 'Clinical context', 'Structured findings', 'AI second reader', 'Impression']) check(rec[s], `Record has ${s}`);
  check(/Fictional demo patient/.test(rec.About) && /not for clinical use/i.test(rec.About), 'Record states fictional patient and research use');
  check(/Unvalidated research read/.test(rec['AI second reader'].caveat), 'AI section carries the research caveat');
  check(!JSON.stringify(rec).includes('undefined'), 'Record has no undefined values');
  check(JSON.stringify(rec).length < 60000, 'Record fits the backend size limit');

  // The page renders for the doctor.
  ctx.api.state.role = 'care'; ctx.api.state.view = 'agents'; ctx.api.state.agent = 'clinical';
  const html = A.view();
  check(/Clinical agent/.test(html) && /data-agent-draft="referral"/.test(html) && /data-agent-ct/.test(html) && /agent-token/.test(html), 'View has chat, drafts, CT tool and token field');
  check(!/undefined/.test(html), 'View has no undefined');
  check(/How it works/.test(html) && !/MedRAX|mAIstro|Radiology Swarm/.test(html), 'View explains how it works without naming removed agents');

  // Without live AI (status not configured), every tool falls back honestly.
  A._setStatus({configured: false});
  await A.run('chat', {userText: 'Summarise'});
  let last = A._convo['CX-1042'].at(-1);
  check(last.type === 'offline' && /without AI/.test(last.text) && /Lung-RADS/.test(last.text), 'Chat falls back to a record-only answer labelled "without AI"');
  await A.run('draft', {kind: 'referral', userText: 'Draft'});
  last = A._convo['CX-1042'].at(-1);
  check(last.type === 'draft' && last.data.offline && last.data.review === null && last.data.draft.length > 20, 'Draft falls back to an unreviewed record template');
  await A.run('ct', {userText: 'CT'});
  last = A._convo['CX-1042'].at(-1);
  check(last.type === 'ct' && /precomputed/.test(last.data.model) && last.data.read.nodule_present !== undefined, 'CT read falls back to the precomputed research read');
  check(!A._convo['CX-1042'].some(m => m.type === 'thinking'), 'No "thinking" placeholder is left behind');

  // Draft text becomes plain text (no Markdown markers).
  check(A.plain('**DRAFT**\n* **Patient:** X `[Patient]`') === 'DRAFT\n• Patient: X [Patient]', 'Drafts are converted to plain text');

  // Report note can be set from the agent.
  win.candexReport.setNote('Agent draft note');
  check(JSON.stringify(win.candexReport.build('CX-1042', {lang: 'en'}).context).includes('Agent draft note'), '"Add to referral note" reaches the report');

  console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} clinical-agent checks (grounded record, rendering, honest no-AI fallbacks).`);
  if (defects.length) process.exitCode = 1;
})();
