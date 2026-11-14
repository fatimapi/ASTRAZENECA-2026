// Uploaded CT -> closest public study: page (raw data, matches, approval), and the
// later workflows (Imaging review, referral report, clinical agent, patient pathway)
// in English and Finnish. Uses a real backend result (LIDC-IDRI-0110) as fixture.
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mem = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; }}; };
const node = () => ({innerHTML: '', textContent: '', value: '', checked: false, dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, getAttribute() { return null; }, focus() {}, showModal() {}, close() {}, open: false, closest: () => null, childNodes: []});
const nodes = {};
const listeners = {};
const document = {querySelector: sel => (nodes[sel] ||= node()), querySelectorAll: () => [], addEventListener: (n, fn) => (listeners[n] ??= []).push(fn), createElement: () => node(), documentElement: node(), body: node(), title: '', createTreeWalker: () => ({nextNode: () => null})};
const win = {scrollTo() {}, addEventListener() {}};
const ctx = vm.createContext({document, window: win, location: {hash: '#care/ct-compare'}, localStorage: mem(), sessionStorage: mem(), MutationObserver: class { observe() {} }, Blob, URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, FormData: class {}, TextEncoder, setTimeout: () => 1, clearTimeout() {}, console, Set, Map, Intl, crypto: globalThis.crypto});
for (const f of ['i18n.js', 'i18n-screening.js', 'referral-store.js', 'screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', 'data/lidc/cxr-reads.js', 'ai-second-reader.js', 'imaging.js', 'care-journey.js', 'ct-compare.js', 'referral-report.js', 'agent-workspace.js']) {
  try { vm.runInContext(read(f), ctx); } catch (e) { if (!/i18n/.test(f)) throw e; }
}
vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients};', ctx);
const C = win.candexCtCompare, R = win.candexReport, J = win.CandexJourney, I = win.candexImaging, A = win.candexAgent, L18 = win.candexI18n;
const result = JSON.parse(read('tests/fixtures/ct-compare-0110.json'));
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };
const click = sel => { for (const fn of listeners.click || []) fn({target: {closest: s => (s === sel ? {} : null), id: ''}}); };
const change = (id, extra = {}) => { for (const fn of listeners.change || []) fn({target: {id, ...extra}}); };

const pid = 'CX-1042';
ctx.api.state.selected = pid;
// Store a comparison as the page does after a successful upload.
C._write({[pid]: {at: new Date().toISOString(), result, approval: null}});

// Page: raw data in full, all 25 matches, approval needs both checks.
const html = C.view();
check(/Closest public reference study/.test(html) && html.includes(result.closest), 'Page names the closest study');
check(/Raw data/.test(html) && /Uploaded series/.test(html) && /AI read of the uploaded CT \(raw output\)/.test(html) && /Match scores against all public reference studies/.test(html), 'Raw data sections shown');
check((html.match(/<tr class="(is-top)?">/g) || []).length === 25, 'All 25 public studies are scored and listed');
check(/0\.5 × size difference/.test(html), 'The match formula is shown');
check(/Measured size \(from the pixels\)/.test(html) && /AI size estimate/.test(html) && html.includes('10.9 × 10.1 mm'), 'Page shows the measured size next to the AI estimate');
check(/data-ctc-approve disabled/.test(html) && /Awaiting clinician approval/.test(html), 'Approval disabled until both checks; status awaiting');
check(!/undefined|NaN/.test(html), 'No undefined or NaN on the page');
// Layout: AI summary is a drop-down of bullet points; similarities/differences in a table;
// raw data is a plain section with the AI read and the match scores as drop-downs.
check(/<details class="agent-drop ctc-sum[^"]*"><summary>AI summary of the raw data/.test(html) && /<details class="agent-drop ctc-sum[\s\S]*?<ul class="ctc-points"[\s\S]*?<\/details>/.test(html), 'AI summary is a drop-down of bullet points');
check(/<section class="ctc-compare"><h3>Similarities and differences/.test(html) && /ctc-feat/.test(html) && /<th scope="row">Size<\/th><td translate="no">10\.9 × 10\.1 mm<\/td><td translate="no">9\.4 mm<\/td>/.test(html) && /ctc-obs/.test(html), 'Similarities and differences shown in a table');
check(!/ctc-cols/.test(html) && !/\(a reference example, not the patient/.test(html) && !/Please note this is a research prototype/.test(html), 'Comparison wording made concise (no asides or disclaimer rows)');
check(/<section class="ctc-raw"><h3>Raw data<\/h3>/.test(html) && !/<details[^>]*ctc-raw/.test(html), 'Raw data is not a drop-down');
check(/<details class="agent-drop ctc-sub"><summary>AI read of the uploaded CT \(raw output\)<\/summary>/.test(html) && /<details class="agent-drop ctc-sub"><summary>Match scores against all public reference studies<\/summary>/.test(html), 'AI read and match scores are drop-downs');
check(html.indexOf('Uploaded series') < html.indexOf('ctc-sub') && html.indexOf('ctc-montage') < html.indexOf('ctc-sub'), 'Series and AI search shown before the drop-downs');
const text = html.replace(/<p class="field-note">Score = [^<]*<\/p>/, '').replace(/<[^>]+>/g, ' ').replace(/data:image[^"\s]+/g, ''); // the formula weights stay exact
check(!/\d[.,]\d{2,}/.test(text) && /92\.0 %/.test(text) && /0\.7 mm/.test(text), 'All numbers on the page have 1 decimal place');

// Later workflows before approval: report says awaiting; Imaging review card.
let rep = R.build(pid, {lang: 'en'});
check(rep.ctc && !rep.ctc.approved && /Awaiting clinician approval/.test(rep.ctc.status) && rep.ctc.rows.length === 3, 'Report: section present, awaiting approval, top 3 matches');
const fpBefore = JSON.stringify(rep.ctc.fp);
check(/Uploaded CT comparison/.test(C.imagingCard(pid)) && /Review and approve/.test(C.imagingCard(pid)), 'Imaging review shows the comparison card');

// Approve (as the page does): links the chosen study, completes the CT step.
nodes['#ctc-choice'] = {...node(), value: result.matches[1].caseId};
click('[data-ctc-approve]');
const ap = C.approval(pid);
check(ap.state === 'approved' && ap.caseId === result.matches[1].caseId && ap.by === 'Dr. Emilia Koski', 'Clinician approval recorded with the chosen study');
check(I.links[pid] === result.matches[1].caseId, 'Approved study is linked to the patient');
check(!!J.imaging(pid) && J.imaging(pid).uploaded === true, 'Patient pathway: CT step completed by the approval');
check(J.keyDates(pid).some(d => /CT comparison checked by your doctor/.test(d[1])), 'Pathway key dates show the approved comparison');
rep = R.build(pid, {lang: 'en'});
check(rep.ctc.approved && /Approved by Dr\. Emilia Koski/.test(rep.ctc.status) && rep.ctc.refId === result.matches[1].caseId, 'Report: approved, with the linked study');
check(JSON.stringify(rep.ctc.fp) !== fpBefore || rep.ctc.approved, 'Report approval check covers the comparison');
const prev = R.previewHTML(rep);
check(/Measured size \(from the pixels\)/.test(prev) && /10\.9 × 10\.1 mm/.test(prev), 'Report shows the measured size');
check(/Uploaded CT: comparison with public reference studies/.test(prev) && /Closest public reference studies/.test(prev) && !/undefined|NaN/.test(prev), 'Report preview shows the section');
check(/Uploaded CT comparison/.test(JSON.stringify(A.record(pid))) && /Approved by/.test(JSON.stringify(A.record(pid))), 'Clinical agent sees the approved comparison');

// Finnish: report section and page.
const fi = R.build(pid, {lang: 'fi'});
const fiPrev = R.previewHTML(fi);
check(/Ladattu TT: vertailu julkisiin vertailututkimuksiin/.test(fiPrev) && /Hyväksynyt/.test(fiPrev) && /Lähimmät julkiset vertailututkimukset/.test(fiPrev), 'Finnish report section');
check(/10,9 x 10,1 mm/.test(fi.ctc.summary) && !/\d[.,]\d{2,}/.test(fi.ctc.summary + fi.ctc.points.join() + fi.ctc.similarities.join() + fi.ctc.differences.join()) && fi.ctc.similarities.length >= 2 && fi.ctc.differences.length >= 2, 'Finnish summary and comparison (1 decimal place)');
check(!/\d[.,]\d{2,}/.test(fiPrev.slice(fiPrev.indexOf('Ladattu TT: vertailu')).replace(/data:image[^"]+/g, '').split('<section')[0]), 'Report CT comparison section: 1 decimal place');
check(!/Research comparison: the AI read/.test(fiPrev) && !/Awaiting clinician approval/.test(fiPrev), 'No English text in the Finnish section');
L18?.setLang?.('fi');
const fiPage = C.view();
check(/Lähin julkinen vertailututkimus|Closest public reference study/.test(fiPage) && /Tekoälyn yhteenveto raakatiedoista|AI summary of the raw data/.test(fiPage), 'Page renders in Finnish mode');
check(/10,9 x 10,1 mm/.test(C.forPatient(pid, 'fi').summary) && /Yhtäläisyydet ja erot/.test(fiPage) && /Tekoälyn yhteenveto raakatiedoista/.test(fiPage), 'Finnish AI summary and table on the page');
L18?.setLang?.('en');

// Imaging review: CT / X-ray drop-down; completion card at the bottom.
ctx.api.state.scanMode = 'ct';
const scan = I.scanView();
check(/id="scan-mode"/.test(scan) && /CT analysis/.test(scan) && /X-ray analysis/.test(scan), 'Imaging review has the CT / X-ray drop-down');
check(scan.lastIndexOf('analysis-card') > scan.lastIndexOf('scan-layout'), 'Completion card is at the bottom (CT)');
ctx.api.state.scanMode = 'xray';
const xr = I.scanView();
check(/Classifier scores \(raw\)|No chest X-ray for this study/.test(xr) && xr.lastIndexOf('analysis-card') > Math.max(xr.lastIndexOf('scan-layout'), xr.lastIndexOf('empty-scan')), 'X-ray section, completion card at the bottom');

// Imaging review overview: functions, two links, and this patient's CT and X-ray results.
ctx.api.state.scanMode = 'ct';
let ov = I.scanView();
check(/What you can do here/.test(ov) && /data-go="care\/ct-compare"/.test(ov) && /Go to CT analysis/.test(ov) && /data-action="upload"[^>]*>[\s\S]{0,200}Go to X-ray analysis/.test(ov), 'Imaging review: overview with links to the CT and X-ray pages');
check(/class="card ir-result"[\s\S]*?ctc-pair[\s\S]*?Uploaded CT · key slice[\s\S]*?public reference/.test(ov) && /10\.9 × 10\.1 mm/.test(ov) && /class="ir-points"/.test(ov), 'Imaging review: CT key slice next to the public reference, with a concise summary');
check(/<details class="agent-drop ir-more"/.test(ov) && ov.lastIndexOf('analysis-card') > ov.lastIndexOf('ir-more'), 'Detailed viewer in a drop-down; completion card at the bottom');
check(!/Uploaded X-ray/.test(ov), 'No uploaded X-ray shown before one is analysed');
win.candexXray = {byPatient: {[pid]: {at: new Date().toISOString(), image: 'data:image/png;base64,iVBORw0KGgo=', model: 'TorchXRayVision DenseNet121', top: [{label: 'Effusion', score: 0.61234}, {label: 'Atelectasis', score: 0.5}, {label: 'Infiltration', score: 0.41}], nodule: [{label: 'Nodule', score: 0.08}], summary: 'Highest score is Effusion 0.61.', points: ['Effusion has the highest score, 0.61.'], live: true, lang: 'en'}}};
ov = I.scanView();
check(/Uploaded X-ray/.test(ov) && /src="data:image\/png;base64,iVBORw0KGgo="/.test(ov) && /Effusion 0\.61/.test(ov) && /Effusion has the highest score/.test(ov), 'Imaging review: screened X-ray image with scores and summary');
const xrep = R.build(pid, {lang: 'en'}), xprev = R.previewHTML(xrep);
check(xrep.cxr?.uploaded && /Uploaded chest X-ray as screened/.test(xprev) && /Effusion/.test(xprev) && /0\.61/.test(xprev), 'Report: uploaded X-ray section with image and scores');
check(/<h4>Similarities and differences<\/h4><div class="table-wrap"><table>/.test(xprev) && /<td>Size<\/td><td>10\.9 × 10\.1 mm<\/td><td>9\.4 mm<\/td><td>Similar<\/td>/.test(xprev) && !/<h4>Similarities<\/h4>/.test(xprev), 'Report: similarities and differences as a table');
check(/<h4>AI summary of the raw data<\/h4><ul>/.test(xprev), 'Report: AI summary as bullet points');
const xfi = R.previewHTML(R.build(pid, {lang: 'fi'}));
check(/Yhtäläisyydet ja erot/.test(xfi) && /<td>Koko<\/td>/.test(xfi) && /Samankaltainen/.test(xfi) && /Ladattu keuhkoröntgenkuva/.test(xfi) && /0,61/.test(xfi) && /Yhteenveto on kirjoitettu englanniksi/.test(xfi) && /<h4>Tekoälyn yhteenveto luokittelijan raakapisteistä<\/h4><ul>/.test(xfi), 'Finnish report: table and uploaded X-ray');
delete win.candexXray;
// Finnish AI phrases with a decimal point get a decimal comma.
const fx = JSON.parse(JSON.stringify(result)); fx.comparison.similarities_fi = ['Samankokoiset: 10.9 x 10.1 mm ja 9.4 mm', 'Molemmat oikeassa keuhkossa'];
C._write({[pid]: {at: new Date().toISOString(), result: fx, approval: C.approval(pid)}});
check(C.forPatient(pid, 'fi').similarities[0] === 'Samankokoiset: 10,9 x 10,1 mm ja 9,4 mm' && C.forPatient(pid, 'en').similarities.length > 0, 'Finnish decimal commas in AI phrases');
C._write({[pid]: {at: new Date().toISOString(), result, approval: C.approval(pid)}});

// Withdrawing approval: report shows it is not approved.
click('[data-ctc-withdraw]');
check(C.approval(pid).state === 'pending' && !R.build(pid, {lang: 'en'}).ctc.approved, 'Withdrawn approval: report no longer shows it approved');

console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} CT comparison checks (page, approval, report, agent, pathway, imaging review, Finnish).`);
if (defects.length) process.exitCode = 1;
