// Quality agent + Quality reports: the data pack mirrors the page, every value is
// tagged, reports build in English and Finnish without AI, AI placeholders are
// filled only from the pack, and the offline chat answers from page data.
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mem = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)}; };
const node = () => ({innerHTML: '', textContent: '', value: '', dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, setAttribute() {}, getAttribute() { return null; }, focus() {}, showModal() {}, close() {}, open: false, scrollTop: 0, scrollHeight: 0, closest: () => null, childNodes: []});
const document = {querySelector: () => node(), querySelectorAll: () => [], addEventListener() {}, createElement: () => node(), documentElement: node(), body: node(), title: '', createTreeWalker: () => ({nextNode: () => null})};
const win = {scrollTo() {}, addEventListener() {}};
const ctx = vm.createContext({document, window: win, location: {hash: '#quality/agents'}, localStorage: mem(), sessionStorage: mem(), MutationObserver: class { observe() {} }, Blob, URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, FormData: class {}, AbortController, TextEncoder, setTimeout: () => 1, clearTimeout() {}, console, Set, Map, Intl, crypto: globalThis.crypto, fetch: () => Promise.reject(new Error('no network in tests'))});
for (const f of ['i18n.js', 'i18n-screening.js', 'kpis.js', 'regional-map.js', 'referral-store.js', 'screening.js', 'data/lidc/cases.js', 'data/lidc/ai-reads.js', 'data/lidc/cxr-reads.js', 'ai-second-reader.js', 'imaging.js', 'referral-report.js', 'referral-hub.js', 'agent-workspace.js', 'quality-agent.js']) {
  try { vm.runInContext(read(f), ctx); } catch (e) { if (!/i18n/.test(f)) throw e; }
}
vm.runInContext(read('app.js') + '\nglobalThis.api={state,patients,qualityNav,viewTitles};', ctx);
const Q = win.candexQuality;
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };

(async () => {
  const pk = Q.pack(), V = pk.values;
  const size = JSON.stringify(pk).length;
  check(size < 80000, `Data pack fits the backend limit (${size} chars)`);
  check(Object.values(V).every(v => ['SYNTHETIC', 'SOURCED REFERENCE', 'PUBLIC RESEARCH DATA'].includes(v.provenance)), 'Every value has a provenance tag');
  check(!/rank/i.test(JSON.stringify(pk)), 'No rankings in the data pack');
  // Mirrors the page.
  check(V['kpi.referral_review_days'].value === 12 && V['kpi.referral_review_days'].status && V['kpi.referral_review_days'].source, 'National KPI value, status and source as on the page');
  check(V['kpi.treatment_within_pathway_target'].status === 'unknown', '"Not assessed" stays grey');
  check(V['eu.eu_colorectal_participation'].value === 41 && /not a Finnish standard/.test(V['eu.eu_colorectal_participation'].reference) && V['eu.eu_colorectal_participation'].status === 'red' && !/NHS/.test(JSON.stringify(pk)), 'European comparators replace NHS, labelled external');
  check(V['op.regional_gap_days'].value === 11 && /Static illustrative/.test(V['op.regional_gap_days'].note) && /Static illustrative/.test(V['op.demographic_gap_pp'].note), 'Hard-coded gap cards are labelled static illustrative');
  check(V['regions.count'].value === 19 && V['regions.referral_review_days.gap'].value === 22 && V['regions.referral_review_days.withData'].value === 18, 'Regional spread computed from the map fixtures (gap 22 d, Åland no data)');
  check(V['cohort.n'].value >= 50 && typeof V['cohort.travelGap'].value === 'number' && V['cohort.completeness'].unit === '%', 'Cohort figures from kpis()');
  check(Object.entries(V).filter(([id]) => /^cohort\.group\..*\.rate$/.test(id)).every(([, v]) => typeof v.lowN === 'boolean'), 'Every cohort group carries a low-n flag');
  check(V['lung.studies'].value === 25 && V['lung.ai.found'].value === '4/5' && V['lung.ai.ci'].value && V['lung.cxr.n'].value === 8, 'Lung pilot figures (25 CT, 4/5 with CI, 8 X-rays)');
  check(/[0-9a-f]{12}/.test(await Q.hashOf(pk)), 'Data pack hash');

  // Reports: all five types, both languages, without AI.
  for (const kind of ['kpi', 'equity', 'regional', 'lung', 'standards']) for (const L of ['en', 'fi']) {
    const r = Q.buildReport(kind, L, pk, 'abc123abc123');
    const html = Q.previewHTML(r);
    check(r.summary.length && r.sections.length && r.caveats.length >= 2 && r.sources.length >= 4, `${kind}/${L}: summary, tables, caveats and sources`);
    check(!/undefined|NaN|\[\?\]/.test(html), `${kind}/${L}: no undefined, NaN or unfilled placeholder`);
    check(L === 'fi' ? /SYNTEETTINEN/.test(r.banner) && /Ei kliiniseen päätöksentekoon/.test(html) : /SYNTHETIC DEMO DATA/.test(r.banner) && /Not for clinical decisions/.test(html), `${kind}/${L}: synthetic banner and clinical-use warning`);
    check(/Template text, no AI|Mallipohjainen teksti, ei tekoälyä/.test(html) && /Draft for review|Luonnos tarkistettavaksi/.test(html), `${kind}/${L}: says template text and draft sign-off`);
  }
  const fiKpi = Q.previewHTML(Q.buildReport('kpi', 'fi', pk, 'x'));
  check(/Kiireettömän lähetteen arvioinnin aloitus/.test(fiKpi) && /Hallinnassa|Vaatii tarkistusta|Ei arvioitu/.test(fiKpi), 'Finnish report translates indicator names and statuses');
  { const fiL = Q.buildReport('lung', 'fi', pk, 'x'), fiE = Q.buildReport('equity', 'fi', pk, 'x'); const kvs = [...fiL.sections, ...fiE.sections].flatMap(s => (s.kv || []).map(r => r[0]));
    check(kvs.length > 10 && kvs.every(k => !/^(Public|Gap:|People|Up to date|Median|Meet|Core|AI second|CT studies)/.test(k)), `Finnish report row labels are Finnish (${kvs.filter(k => /^(Public|Gap:|People|Up to date|Median|Meet|Core|AI second|CT studies)/.test(k)).join(' | ')})`); }
  check(/Kainuu/.test(Q.previewHTML(Q.buildReport('regional', 'fi', pk, 'x'))) && /Etelä-Karjala/.test(Q.previewHTML(Q.buildReport('regional', 'fi', pk, 'x'))), 'Finnish regional report uses Finnish region names');
  check(/Low n: do not compare/.test(Q.previewHTML(Q.buildReport('equity', 'en', pk, 'x'))) || !Object.values(V).some(v => v.lowN), 'Low-n groups are flagged in the equity report');

  // AI narrative: placeholders are filled from the pack; unknown ones are visible.
  const R = Q._R;
  Object.assign(R, {kind: 'regional', narrativeFor: 'regional|h1', model: 'gemini-3.5-flash', review: {verdict: 'ready for clinician review', issues: []},
    narrative: {summary_en: ['Spread is {{regions.referral_review_days.gap}} days between {{regions.referral_review_days.min}} and {{regions.referral_review_days.max}}.', 'Bad {{no.such.id}}.', 'Max {{regions.referral_review_days.max}} ({{regions.referral_review_days.max.region}}).'], summary_fi: ['Ero on {{regions.referral_review_days.gap}}.'], findings_en: [], findings_fi: [], questions_en: [], questions_fi: []}});
  const ai = Q.buildReport('regional', 'en', pk, 'h1');
  check(/Spread is 22 d between 13 d \(Uusimaa\) and 35 d \(Lapland\)/.test(ai.summary[0]), 'AI placeholders filled with pack values and region names');
  check(ai.summary[2] === 'Max 35 d (Lapland).', 'Region-name placeholders work without doubling the name');
  check(ai.summary[1].includes('[?]') && ai.technical.some(([k, v]) => /Unknown placeholders/.test(k) && /no\.such\.id/.test(v)), 'Unknown placeholders are shown, not hidden');
  check(/Ero on 22 pv/.test(Q.buildReport('regional', 'fi', pk, 'h1').summary[0]), 'Finnish narrative with Finnish units');
  check(/The safety reviewer raised/.test(Q.previewHTML(Object.assign(Q.buildReport('regional', 'en', pk, 'h1'), {reviewIssues: ['x']}))), 'Reviewer issues are shown at the top of the preview');
  check(Q.buildReport('regional', 'en', pk, 'other-hash').technical.some(([, v]) => /Template text/.test(v)), 'An AI narrative is not reused when the data changes');
  R.narrative = null; R.narrativeFor = null;

  // Offline chat answers from page data, labelled.
  const off = Q.offlineAnswer('What is the referral assessment start?', 'en');
  check(/Nonurgent referral assessment start/.test(off) && /12 d/.test(off) && /Synthetic/.test(off) && /no AI/.test(off), 'Offline answer quotes the page figure with status and provenance');
  check(/Perusta: sivun tiedot/.test(Q.offlineAnswer('referral', 'fi')), 'Offline answer in Finnish');
  check(/suggested questions/.test(Q.offlineAnswer('qwertyuiop', 'en')), 'Unmatched offline question points to suggested questions');

  // Navigation and access.
  check(ctx.api.qualityNav.some(([v]) => v === 'quality-reports') && ctx.api.viewTitles['quality-reports'], 'Reports in the quality sidebar');
  check(/'quality-reports'/.test(read('entry-session.js')), 'Quality role may open the reports page');
  check(/Quality agent/.test(Q.view()) && /data-q-ask/.test(Q.view()) && /q-token/.test(Q.view()), 'Quality agent view with starter questions and token');
  check(/q-kind/.test(Q.reportsView()) && (Q.reportsView().match(/<option value="(kpi|equity|regional|lung|standards)"/g) || []).length === 5 && /data-q-pdf disabled/.test(Q.reportsView()), 'Reports page: 5 report types, PDF disabled until preview');


  // Sample-data export and the Candex wordmark on every PDF.
  check(/'export-metrics':\(\)=>window\.candexQuality\?window\.candexQuality\.exportDataPDF\(\)/.test(read('app.js')) && /'export-metrics-csv'/.test(read('app.js')), '"Export sample data" makes the PDF; CSV stays available');
  check(typeof Q.writeDataPDF === 'function' && typeof Q.dataPdf === 'function', 'Sample-data PDF writer exists');
  { const rr = read('referral-report.js'), app = read('app.js');
    const paths = s => [...s.matchAll(/ d="([^"]+)"/g)].map(m => m[1]).join('|');
    const svg = rr.match(/const WORDMARK_SVG = '([^']+)'/)[1];
    check(paths(svg) === paths(app.match(/const candexWordmark = \(\) => `([^`]+)`/)[1]), 'PDF wordmark uses the same drawing as the site wordmark');
    check(/if \(wordmarkPNG\) \{\s*if \(i === 1\)/.test(rr) && /addImage\(wordmarkPNG/.test(rr), 'The PDF kit stamps the wordmark on every page'); }

  // Side panels: drop-downs, "How it works" before "What the agent can see"; token in a drop-down.
  for (const [name, html] of [['Quality agent', Q.view()], ['Clinical agent', win.candexAgent.view()]]) {
    const how = html.indexOf('<details class="agent-drop"><summary>How it works'), sees = html.indexOf('What the agent can see');
    check(how > 0 && sees > how && /<details class="agent-drop token-drop">/.test(html) && !/<h3 class="agent-h3">/.test(html), `${name}: How it works first, drop-downs, token in a drop-down`);
  }
  check(/<details class="agent-drop token-drop">/.test(Q.reportsView()), 'Reports page: token in a drop-down');
  check(/element\('details', 'agent-drop token-drop'\)/.test(read('dicom.js')), 'DICOM page: API key in a drop-down');
  check(/r\.kind === 'regional'\) \{ k\.section\(n\+\+, tx\(r\.lang, 'Regional waiting times \(map\)'/.test(read('quality-agent.js')) && /data-q-map="0"/.test(Q.previewHTML(Q.buildReport('regional', 'en', pk, 'x'))), 'Regional report: map in the preview and the PDF');
  console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} quality agent & report checks.`);
  if (defects.length) process.exitCode = 1;
})();
