// Quality administrator: Quality agent (AI workspace) and Quality reports (sidebar).
// Design agreed by three reviews (UX, AI architecture, data honesty/equity):
// - One "data pack" built from the SAME functions that draw the Quality & Equity
//   page (nationalKpis, nhsKpis, metrics/kpiValues, CandexKpis.evaluate(), the
//   regional fixtures, candexScreening.kpis(), the LIDC/X-ray research results).
//   Every value has an id and a provenance tag; no rankings are precomputed.
// - Chat: live Gemini via /api/agent/quality-chat; the server flags any number
//   not in the pack. Offline: answers from page data, labelled "no AI".
// - Reports: tables are computed here; the AI writes only the narrative, with
//   {{value.id}} placeholders that are filled from the pack (it never types a
//   number). Preview first, then PDF; English or Finnish; synthetic banner on
//   every page. Loaded before app.js; uses globals at call time.
(() => {
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const uiLang = () => (window.candexI18n?.lang === 'fi' ? 'fi' : 'en');
const FI = s => (window.candexI18n?.lookup ? window.candexI18n.lookup(String(s)) : String(s));
const tx = (L, en, fi) => (L === 'fi' ? fi : en);
const loc = (L, s) => (L === 'fi' ? FI(s) : s);
const fmtNum = (L, v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : (L === 'fi' ? String(v).replace('.', ',') : String(v))) : String(v ?? '—'));
const PROV = {SYNTHETIC: ['Synthetic', 'Synteettinen'], 'SOURCED REFERENCE': ['Sourced reference', 'Lähteeseen perustuva viite'], 'PUBLIC RESEARCH DATA': ['Public research data', 'Julkinen tutkimusaineisto']};
const provLabel = (L, p) => tx(L, ...(PROV[p] || [p, p]));
const STATUS = {green: ['Under control', 'Hallinnassa'], yellow: ['Needs review', 'Vaatii tarkistusta'], red: ['Urgent action', 'Kiireellisiä toimia'], unknown: ['Not assessed', 'Ei arvioitu']};
const statusLabel = (L, s) => tx(L, ...(STATUS[s] || STATUS.unknown));

// ---------- Data pack ----------
function pack() {
  const K = window.CandexKpis, M = window.CandexRegionalMapTest, S = window.candexScreening;
  const values = {};
  const add = (id, o) => { values[id] = o; return id; };
  const ev = (id, v) => { const s = K?.evaluate?.(id, v); return s ? {status: s.level, threshold: s.thresholdLabel, basis: s.basis, source: s.source?.title || null, sourceUrl: s.source?.url || null} : {status: 'unknown'}; };
  const unit = d => (/%$/.test(String(d)) ? '%' : / d$/.test(String(d)) ? 'days' : / h$/.test(String(d)) ? 'hours' : / pp$/.test(String(d)) ? 'percentage points' : '');
  const STATIC = {
    regional_gap_days: 'Static illustrative value on the page, not computed from the regional map data',
    demographic_gap_pp: 'Static illustrative value on the page, not computed from the cohort data',
  };
  const kpis = (typeof nationalKpis !== 'undefined' ? nationalKpis : []).map(([id, label, v, display, detail]) => add(`kpi.${id}`, {label, value: v, display, unit: unit(display), provenance: 'SYNTHETIC', detail, ...ev(id, v)}));
  const comparators = (typeof euKpis !== 'undefined' ? euKpis : []).map(([id, label, v, display, detail]) => add(`eu.${id}`, {label, value: v, display, unit: unit(display), provenance: 'SYNTHETIC', detail, reference: 'European comparator (not a Finnish standard)', ...ev(id, v)}));
  const operational = (typeof metrics !== 'undefined' ? metrics : []).map(([label, display, definition], i) => add(`op.${kpiMetricIds[i]}`, {label, value: kpiValues[i], display, unit: unit(display), definition, provenance: 'SYNTHETIC', ...(STATIC[kpiMetricIds[i]] ? {note: STATIC[kpiMetricIds[i]]} : {}), ...ev(kpiMetricIds[i], kpiValues[i])}));
  // Regions (19 maakunta, synthetic). No ranks: min/max/gap and status counts only.
  const regionIds = [], regionSummary = {};
  if (M) {
    const names = Object.fromEntries((M.names || []).map(([c, en, fi]) => [c, {en, fi}]));
    for (const [mi, m] of M.metrics.entries()) {
      const rows = Object.entries(M.fixtures).map(([code, arr]) => ({code, v: arr[mi]}));
      for (const r of rows) regionIds.push(add(`region.${r.code}.${m.id}`, {label: `${names[r.code]?.en || r.code} · ${m.label}`, labelFi: `${names[r.code]?.fi || r.code} · ${m.fi}`, value: r.v, unit: m.unit, provenance: 'SYNTHETIC', status: r.v == null ? 'unknown' : M.evaluate(m.id, r.v).level}));
      const withData = rows.filter(r => r.v != null), lo = withData.reduce((a, b) => (b.v < a.v ? b : a)), hi = withData.reduce((a, b) => (b.v > a.v ? b : a));
      const counts = {green: 0, yellow: 0, red: 0, unknown: 0};
      for (const r of rows) counts[r.v == null ? 'unknown' : M.evaluate(m.id, r.v).level]++;
      regionSummary[m.id] = {label: m.label, labelFi: m.fi, unit: m.unit, min: add(`regions.${m.id}.min`, {label: `Lowest regional value · ${m.label}`, value: lo.v, unit: m.unit, region: names[lo.code]?.en, regionFi: names[lo.code]?.fi, provenance: 'SYNTHETIC'}),
        max: add(`regions.${m.id}.max`, {label: `Highest regional value · ${m.label}`, value: hi.v, unit: m.unit, region: names[hi.code]?.en, regionFi: names[hi.code]?.fi, provenance: 'SYNTHETIC'}),
        gap: add(`regions.${m.id}.gap`, {label: `Regional gap (highest − lowest) · ${m.label}`, value: Math.round((hi.v - lo.v) * 10) / 10, unit: m.unit, provenance: 'SYNTHETIC'}),
        withData: add(`regions.${m.id}.withData`, {label: `Regions with data · ${m.label}`, value: withData.length, provenance: 'SYNTHETIC'}),
        counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, add(`regions.${m.id}.${k}`, {label: `Regions: ${STATUS[k][0]} · ${m.label}`, value: v, provenance: 'SYNTHETIC'})]))};
    }
    add('regions.count', {label: 'Map regions (maakunta, incl. Åland)', value: Object.keys(M.fixtures).length, provenance: 'SYNTHETIC'});
  }
  // Simulated cohort (n=50 + people added through the health-check form).
  const cohort = {};
  const k = S?.kpis?.();
  if (k) {
    const rate = o => (o.n ? Math.round((o.up / o.n) * 100) : null);
    add('cohort.n', {label: 'People in the screening cohort', value: k.n, provenance: 'SYNTHETIC'});
    add('cohort.simulated', {label: 'Simulated people', value: k.simulated, provenance: 'SYNTHETIC'});
    add('cohort.fromForm', {label: 'People added through the health-check form', value: k.fromForm, provenance: 'SYNTHETIC'});
    for (const p of ['breast', 'cervical', 'bowel', 'overall']) {
      add(`cohort.${p}.rate`, {label: `Up to date with screening · ${p}`, value: rate(k[p]), unit: '%', provenance: 'SYNTHETIC'});
      add(`cohort.${p}.n`, {label: `Screening invitations considered · ${p}`, value: k[p].n, provenance: 'SYNTHETIC'});
    }
    cohort.groups = k.groups.map(g => {
      const slug = g.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      add(`cohort.group.${slug}.rate`, {label: `Up to date · ${g.label}`, value: g.rate, unit: '%', provenance: 'SYNTHETIC', lowN: g.n < 5});
      add(`cohort.group.${slug}.n`, {label: `Invitations considered · ${g.label}`, value: g.n, provenance: 'SYNTHETIC'});
      add(`cohort.group.${slug}.people`, {label: `People · ${g.label}`, value: g.people, provenance: 'SYNTHETIC'});
      return {slug, label: g.label};
    });
    add('cohort.travelGap', {label: 'Gap: travel under 30 min minus 30 min or more (up to date)', value: k.travelGap, unit: 'percentage points', provenance: 'SYNTHETIC'});
    add('cohort.langGap', {label: 'Gap: Finnish or Swedish minus other languages (up to date)', value: k.langGap, unit: 'percentage points', provenance: 'SYNTHETIC'});
    const urban = k.groups.find(g => g.label === 'Urban counties'), rural = k.groups.find(g => g.label === 'Other counties');
    const occ = k.groups.find(g => g.label === 'Occupational health'), pub = k.groups.find(g => g.label === 'Public health centre');
    if (urban && rural && urban.rate != null && rural.rate != null) add('cohort.urbanGap', {label: 'Gap: urban minus other counties (up to date)', value: urban.rate - rural.rate, unit: 'percentage points', provenance: 'SYNTHETIC'});
    if (occ && pub && occ.rate != null && pub.rate != null) add('cohort.routeGap', {label: 'Gap: occupational health minus public health centre (up to date)', value: occ.rate - pub.rate, unit: 'percentage points', provenance: 'SYNTHETIC'});
    add('cohort.lungEligible', {label: 'Meet USPSTF lung-screening criteria', value: k.lungEligible, provenance: 'SYNTHETIC'});
    add('cohort.symptomatic', {label: 'People reporting symptoms', value: k.symptomatic, provenance: 'SYNTHETIC'});
    add('cohort.urgent', {label: 'People with red-flag symptoms', value: k.urgent, provenance: 'SYNTHETIC'});
    add('cohort.medianDays', {label: 'Median days from symptom to GP', value: k.medianDays, unit: 'days', provenance: 'SYNTHETIC'});
    add('cohort.daysOcc', {label: 'Median days to GP · occupational health', value: k.daysOcc, unit: 'days', provenance: 'SYNTHETIC'});
    add('cohort.daysPub', {label: 'Median days to GP · public health centre', value: k.daysPub, unit: 'days', provenance: 'SYNTHETIC'});
    add('cohort.completeness', {label: 'Core health-check answers completed', value: k.completeness, unit: '%', provenance: 'SYNTHETIC'});
    for (const [id, label] of [['smokers', 'Currently smoke'], ['alcohol', 'Alcohol above the risk limit'], ['inactive', 'Low physical activity'], ['obese', 'BMI 30 or more'], ['support', 'Asked for support'], ['genetics', 'Family-history pattern']]) add(`cohort.${id}`, {label, value: k[id], provenance: 'SYNTHETIC'});
  }
  // Lung pilot: public LIDC-IDRI research CT + chest X-rays.
  const lung = {cases: [], cxr: []};
  const C = window.candexImaging?.CASES || {}, A = window.candexAi, P = A?.provenance?.() || window.candexAiReads?.provenance;
  add('lung.studies', {label: 'Public LIDC-IDRI CT studies in Candex', value: Object.keys(C).length, provenance: 'PUBLIC RESEARCH DATA'});
  for (const b of ['2', '3', '4A', '4B', '4X-like']) add(`lung.band.${b}`, {label: `CT studies · approx. Lung-RADS ${b}`, value: Object.values(C).filter(c => c.band === b).length, provenance: 'PUBLIC RESEARCH DATA'});
  if (P?.leaderboard) {
    const lb = P.leaderboard;
    add('lung.ai.found', {label: 'AI second reader: nodules found on the radiologists’ side', value: lb.found, provenance: 'PUBLIC RESEARCH DATA'});
    add('lung.ai.ci', {label: 'AI second reader: 95% confidence interval (Clopper–Pearson)', value: lb.ci, provenance: 'PUBLIC RESEARCH DATA'});
    add('lung.ai.consensusFound', {label: 'AI second reader: consensus nodules found (≥3 of 4 readers)', value: lb.consensusFound, provenance: 'PUBLIC RESEARCH DATA'});
    add('lung.ai.sizeError', {label: 'AI second reader: mean signed size error', value: lb.meanSignedSizeErrorMm, unit: 'mm', provenance: 'PUBLIC RESEARCH DATA'});
    add('lung.ai.wrongSide', {label: 'AI second reader: findings on the wrong side', value: lb.wrongSideFindings, provenance: 'PUBLIC RESEARCH DATA'});
    add('lung.ai.runs', {label: 'AI second reader: runs per study', value: P.runs, provenance: 'PUBLIC RESEARCH DATA'});
    lung.model = P.model;
  }
  for (const id of Object.keys(window.candexAiReads?.cases || {})) {
    const c = C[id], r = A?.read?.(id), ag = c && r ? A.agreement(c, r) : null;
    if (ag) lung.cases.push({id, band: c.band, verdict: ag.verdict, side: ag.side, size: ag.size});
  }
  const verdicts = {agrees: 0, partly: 0, disagrees: 0};
  for (const c of lung.cases) verdicts[c.verdict] = (verdicts[c.verdict] || 0) + 1;
  for (const [v, n] of Object.entries(verdicts)) add(`lung.ai.${v}`, {label: `AI second reads that ${v === 'partly' ? 'partly agree' : v === 'agrees' ? 'agree' : 'disagree'} with the radiologists`, value: n, provenance: 'PUBLIC RESEARCH DATA'});
  const X = window.candexCxrReads?.cases || {};
  add('lung.cxr.n', {label: 'Chest X-rays run through the classifier', value: Object.keys(X).length, provenance: 'PUBLIC RESEARCH DATA'});
  const xs = Object.entries(X).map(([id, x]) => ({id, nodule: Math.round(x.nodule * 100) / 100, mass: Math.round(x.mass * 100) / 100, top: [...x.scores].sort((a, b) => b.score - a.score)[0]}));
  if (xs.length) {
    add('lung.cxr.maxNodule', {label: 'Chest X-ray classifier: highest Nodule score (uncalibrated, 0–1)', value: Math.max(...xs.map(x => x.nodule)), provenance: 'PUBLIC RESEARCH DATA'});
    add('lung.cxr.maxMass', {label: 'Chest X-ray classifier: highest Mass score (uncalibrated, 0–1)', value: Math.max(...xs.map(x => x.mass)), provenance: 'PUBLIC RESEARCH DATA'});
  }
  lung.cxr = xs.map(x => ({id: x.id, nodule: x.nodule, mass: x.mass, topLabel: x.top?.label, topScore: Math.round((x.top?.score || 0) * 100) / 100}));
  const src = K?.sources || {};
  return {
    about: 'Candex Quality & Equity data (research prototype). Values are synthetic unless tagged otherwise. Finnish references are sourced; European figures (EU screening target, European screening guidelines, EUSOMA) are external comparators.',
    referenceProfile: K?.getMode?.() === 'demo' ? 'Local demo operating bands (not national standards)' : 'Verified Finnish references (unsupported measures remain grey)',
    provenanceKey: {SYNTHETIC: 'Invented example values, not measured Finnish performance', 'SOURCED REFERENCE': 'Published Finnish reference or external comparator', 'PUBLIC RESEARCH DATA': 'LIDC-IDRI public research images (TCIA, CC BY 3.0)'},
    sections: {kpis, comparators, operational, regions: regionSummary, cohortGroups: cohort.groups || [], lungCases: lung.cases, chestXrays: lung.cxr, lungModel: lung.model || null},
    values,
    sources: [src.access, src.strategy, src.thl, ...(K?.europe || []), {title: 'LIDC-IDRI, The Cancer Imaging Archive (CC BY 3.0)', url: 'https://www.cancerimagingarchive.net/collection/lidc-idri/'}].filter(Boolean),
  };
}
async function hashOf(p) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(p.values) + p.referenceProfile));
    return [...new Uint8Array(buf)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return 'unavailable'; }
}
const display = (L, v) => {
  if (!v) return '[?]';
  if (v.value == null) return tx(L, 'no data', 'ei tietoa');
  const u = v.unit === 'days' ? tx(L, ' d', ' pv') : v.unit === 'hours' ? ' h' : v.unit === '%' ? ' %' : v.unit === 'percentage points' ? tx(L, ' pp', ' %-yks.') : v.unit === 'mm' ? ' mm' : '';
  return fmtNum(L, v.value) + u;
};

// ---------- Backend ----------
let status = null, busy = false;
const log = [];
const token = () => (window.candexAgent?.getToken?.() || '').trim();
const tokenField = hint => (window.candexAgent?.tokenDrop ? window.candexAgent.tokenDrop('q-token', hint) : `<div class="field"><label for="q-token">${T('Backend token')}</label><input id="q-token" type="password" autocomplete="off" value="${esc(token())}"></div>`);
async function api(path, body) {
  const res = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token()}`}, body: JSON.stringify(body)});
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error(data?.detail || `HTTP ${res.status}`), {status: res.status});
  return data;
}
async function refreshStatus() {
  try { const r = await fetch('/api/agent/status', {headers: {Accept: 'application/json'}}); status = r.ok ? await r.json() : {error: `HTTP ${r.status}`}; } catch { status = {error: 'offline'}; }
  const el = document.querySelector('#q-status'); if (el) el.innerHTML = statusHTML();
}
function statusHTML() {
  if (!status) return badge(T('Checking live AI…'), 'neutral');
  if (status.error || !status.configured) return `${badge(T('Offline: answers from page data'), 'amber')}<small>${T(status.error ? 'The backend is not reachable.' : 'The server has no Gemini key.')}</small>`;
  return `${badge(T('Live AI connected'))}<small translate="no">gemini-3.5-flash</small>`;
}

// ---------- Quality agent (chat) ----------
const STARTERS = [
  'Which indicators need review or urgent action, and what reference sets each threshold?',
  'Is the 21-day referral limit a cancer-specific target?',
  'How large is the regional spread in referral assessment times?',
  'Which groups in the simulated cohort are least up to date with screening?',
  'How well did the AI second reader agree with the radiologists?',
  'Why is “Treatment within applicable pathway target” not assessed?',
];
const md = s => esc(String(s || '')).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^\s*[-*]\s+/gm, '• ').replace(/\n/g, '<br>');
function offlineAnswer(q, L) {
  const p = pack(), words = q.toLowerCase().split(/[^a-zåäö0-9]+/).filter(w => w.length > 3);
  const hits = Object.entries(p.values).filter(([id]) => !id.startsWith('region.')).map(([id, v]) => [id, v, words.filter(w => (v.label + ' ' + (v.labelFi || '') + ' ' + id).toLowerCase().includes(w)).length]).filter(x => x[2]).sort((a, b) => b[2] - a[2]).slice(0, 6);
  if (!hits.length) return tx(L, 'Live AI is not available, and no page figure matches that question. Try one of the suggested questions.', 'Tekoäly ei ole käytettävissä, eikä mikään sivun luku vastaa kysymystä. Kokeile ehdotettua kysymystä.');
  return hits.map(([id, v]) => `**${L === 'fi' ? (v.labelFi || FI(v.label)) : v.label}**: ${display(L, v)}${v.status && v.status !== 'unknown' ? ` · ${statusLabel(L, v.status)}` : v.status === 'unknown' && id.startsWith('kpi.') ? ` · ${statusLabel(L, 'unknown')}` : ''} · ${provLabel(L, v.provenance)}${v.threshold ? ` · ${loc(L, v.threshold)}` : ''}${v.note ? ` · ${tx(L, 'static illustrative value', 'kiinteä esimerkkiarvo')}` : ''}`).join('\n') + `\n\n${tx(L, 'Based on: page data (no AI).', 'Perusta: sivun tiedot (ei tekoälyä).')}`;
}
function msgHTML(m, i) {
  if (m.role === 'user') return `<div class="agent-msg is-user"><p translate="no">${esc(m.text)}</p></div>`;
  if (m.type === 'thinking') return `<div class="agent-msg is-agent is-thinking"><p>${T('Thinking…')}</p></div>`;
  return `<div class="agent-msg is-agent${m.offline ? ' is-offline' : ''}">${m.offline ? `<small class="q-tag">${T('Offline answer from page data, no AI')}</small>` : ''}<p translate="no">${md(m.text)}</p>${m.unverified?.length ? `<p class="q-unverified">${T('Numbers not found in the page data:')} <span translate="no">${esc(m.unverified.join(', '))}</span></p>` : ''}<div class="agent-actions"><small translate="no">${esc(m.model || '')}</small><button type="button" class="text-btn" data-q-copy="${i}">${icon('file')}${T('Copy answer')}</button></div></div>`;
}
function drawLog() {
  const el = document.querySelector('#q-log'); if (!el) return;
  el.innerHTML = log.length ? log.map(msgHTML).join('') : `<div class="agent-empty">${icon('sparkle')}<p>${T('Ask about any figure on the Quality & Equity page: KPIs and their references, regional figures, the simulated cohort or the lung pilot data.')}</p></div>`;
  el.scrollTop = el.scrollHeight;
  document.querySelectorAll('.q-chat button, #q-input').forEach(b => { b.disabled = busy; });
}
async function ask(text) {
  if (busy || !text.trim()) return;
  busy = true;
  const L = uiLang();
  log.push({role: 'user', text}, {role: 'model', type: 'thinking'}); drawLog();
  let reply;
  try {
    if (!status?.configured) throw Object.assign(new Error('offline'), {status: 503});
    if (!token()) throw Object.assign(new Error('token'), {status: 401});
    const p = pack();
    const history = log.filter(m => m.role === 'user' || (m.role === 'model' && m.type === 'text' && !m.offline)).slice(-12).map(m => ({role: m.role, text: String(m.text).slice(0, 4000)}));
    const out = await api('/api/agent/quality-chat', {lang: L, pack: p, packHash: await hashOf(p), messages: history});
    reply = {role: 'model', type: 'text', text: out.text, unverified: out.unverified, model: out.model};
  } catch (e) {
    reply = e.status === 401 ? {role: 'model', type: 'text', offline: true, text: `${tx(L, 'The backend token is missing or wrong. Paste the token from the backend terminal on the left. Meanwhile, from page data:', 'Palvelimen tunniste puuttuu tai on väärä. Liitä tunniste vasemmalle. Sillä välin sivun tiedoista:')}\n\n${offlineAnswer(text, L)}`}
      : {role: 'model', type: 'text', offline: true, text: offlineAnswer(text, L)};
  }
  log.pop(); log.push(reply); busy = false; drawLog();
}
function view() {
  setTimeout(() => { refreshStatus(); drawLog(); hashOf(pack()).then(h => { const el = document.querySelector('#q-hash'); if (el) el.textContent = h; }); }, 0);
  const p = pack();
  const sees = [['Finnish reference indicators', 'SOURCED REFERENCE', p.sections.kpis.length], ['Workflow and model measures', 'SYNTHETIC', p.sections.operational.length], ['Regions (19 maakunta)', 'SYNTHETIC', Object.keys(p.sections.regions).length], ['Simulated screening cohort', 'SYNTHETIC', p.values['cohort.n']?.value], ['Lung pilot (LIDC-IDRI, chest X-rays)', 'PUBLIC RESEARCH DATA', p.values['lung.studies']?.value]];
  return `<div class="agent-layout"><aside class="stack">
<section class="card agent-side"><div class="card-head"><h2>Quality agent</h2>${badge('Research', 'amber')}</div>
<div class="agent-status" id="q-status" aria-live="polite">${statusHTML()}</div>
${tokenField('One token for the whole page. The Gemini key stays on the server.')}
<details class="agent-drop"><summary>${T('How it works')}</summary><ul class="agent-how">
<li><strong>${T('Grounded:')}</strong> ${T('answers use only the figures on the Quality & Equity page, each tagged synthetic, sourced reference or public research data.')}</li>
<li><strong>${T('Checked:')}</strong> ${T('the server checks every number in an answer against the page data and flags any it cannot find.')}</li>
<li><strong>${T('Honest:')}</strong> ${T('no patient-level conclusions and no rankings of real regions; the figures are synthetic.')}</li></ul></details>
<details class="agent-drop"><summary>${T('What the agent can see')}</summary><ul class="q-sees">${sees.map(([s, prov]) => `<li>${icon('check')}<span>${T(s)}</span><small class="q-prov q-prov-${prov === 'SYNTHETIC' ? 'syn' : prov === 'SOURCED REFERENCE' ? 'ref' : 'res'}">${provLabel(uiLang(), prov)}</small></li>`).join('')}</ul>
<p class="field-note">${T('Reference profile')}: ${esc(T(p.referenceProfile))}</p></details>
<details class="agent-drop"><summary>${T('Technical details')}</summary><p>${T('Data pack')}: <code id="q-hash" translate="no">…</code> · ${Object.keys(p.values).length} ${T('values')}</p></details></section></aside>
<section class="card agent-chat q-chat" aria-labelledby="q-title"><div class="card-head"><div><h2 id="q-title">${T('Ask about quality and equity')}</h2><p class="subhead">${T('KPIs, references, regions, the simulated cohort and the lung pilot')}</p></div><button type="button" class="text-btn" data-q-clear>${T('Clear conversation')}</button></div>
<div class="agent-log" id="q-log" aria-live="polite"></div>
<div class="agent-prompts">${STARTERS.map(q => `<button type="button" class="agent-chip" data-q-ask="${esc(q)}">${T(q)}</button>`).join('')}</div>
<form id="q-form" class="agent-form"><label class="sr-only" for="q-input">${T('Ask the quality agent')}</label><textarea id="q-input" rows="2" maxlength="1500" translate="no" placeholder="${esc(T('Ask about a figure… (Enter to send, Shift+Enter for a new line)'))}"></textarea><button class="button" type="submit">${icon('arrow')}${T('Ask')}</button></form>
<p class="field-note">${T('General-purpose AI, unvalidated: it can be wrong. All figures are synthetic examples unless tagged otherwise.')}</p></section></div>`;
}

// ---------- Reports ----------
const KINDS = {
  kpi: ['KPI status vs Finnish references', 'KPI-tila suhteessa suomalaisiin viitteisiin', 'Every indicator with its status, the reference behind it, and why some are not assessed.', 'Jokainen mittari, sen tila, taustalla oleva viite ja syy, miksi osaa ei arvioida.'],
  equity: ['Screening equity gaps (simulated cohort)', 'Seulonnan yhdenvertaisuuserot (simuloitu kohortti)', 'Up-to-date screening by group with n, the travel, language, area and care-route gaps, and low-n flags.', 'Seulontojen ajantasaisuus ryhmittäin (n), matka-, kieli-, alue- ja hoitoreittierot sekä pienten ryhmien merkinnät.'],
  regional: ['Regional access (maakunta, synthetic)', 'Alueellinen saatavuus (maakunnat, synteettinen)', 'Spread of each access measure across the 19 regions and how many regions fall in each status.', 'Saatavuusmittareiden vaihtelu 19 maakunnassa ja kuinka moni alue on kussakin tilassa.'],
  lung: ['Lung pathway & AI evaluation', 'Keuhkopolku ja tekoälyn arviointi', 'The public LIDC-IDRI CT studies, AI second-reader agreement with its confidence interval, and the chest X-ray tests.', 'Julkiset LIDC-IDRI-TT-tutkimukset, tekoälyn toisen lukijan yhtäpitävyys luottamusväleineen ja keuhkoröntgentestit.'],
  standards: ['Standards, definitions & data limitations', 'Standardit, määritelmät ja aineiston rajoitukset', 'What each reference means, why measures are grey, static example values and data completeness.', 'Mitä kukin viite tarkoittaa, miksi mittarit ovat harmaita, kiinteät esimerkkiarvot ja tietojen kattavuus.'],
};
const R = {kind: 'kpi', lang: null, narrative: null, narrativeFor: null, review: null, model: null, busy: false, previewed: null, error: null};
const reportLang = () => R.lang || uiLang();

function fill(L, s, pk, bad) {
  // A unit typed after a placeholder is dropped when the value already carries one.
  return String(s).replace(/\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}(\s*(?:mm|%|days?|d|pv|päivää|hours?|h|tuntia|pp|percentage points|prosenttiyksikköä)\b)?/g, (all, id, unitAfter) => { const sub = id.match(/^(.+)\.(region|regionFi)$/); if (sub && pk.values[sub[1]]?.region) return (L === 'fi' ? pk.values[sub[1]].regionFi : pk.values[sub[1]].region) + (unitAfter || ''); const v = pk.values[id]; if (!v) { bad.add(id); return '[?]' + (unitAfter || ''); } return display(L, v) + (v.region ? ` (${L === 'fi' ? v.regionFi : v.region})` : '') + (v.unit ? '' : unitAfter || ''); });
}
function templateNarrative(kind, L, pk) {
  const v = id => display(L, pk.values[id]);
  const cnt = lvl => [...pk.sections.kpis, ...pk.sections.comparators, ...pk.sections.operational].filter(id => pk.values[id].status === lvl).length;
  const s = {
    kpi: [tx(L, `Indicators on the page under the current reference profile: under control ${cnt('green')}, needs review ${cnt('yellow')}, urgent action ${cnt('red')}, not assessed ${cnt('unknown')}.`, `Sivun mittarit nykyisellä viiteprofiililla: hallinnassa ${cnt('green')}, vaatii tarkistusta ${cnt('yellow')}, kiireellisiä toimia ${cnt('red')}, arvioimatta ${cnt('unknown')}.`), tx(L, 'All values are synthetic examples; references are sourced.', 'Kaikki arvot ovat synteettisiä esimerkkejä; viitteet perustuvat lähteisiin.')],
    equity: [tx(L, `In the simulated cohort (n = ${v('cohort.n')}), ${v('cohort.overall.rate')} of screening invitations are up to date.`, `Simuloidussa kohortissa (n = ${v('cohort.n')}) seulontakutsuista ${v('cohort.overall.rate')} on ajan tasalla.`), tx(L, `The travel-time gap is ${v('cohort.travelGap')} and the language gap ${v('cohort.langGap')}; these gaps were built into the simulation.`, `Matka-aikaero on ${v('cohort.travelGap')} ja kieliero ${v('cohort.langGap')}; erot on rakennettu simulaatioon.`)],
    regional: [tx(L, `Referral assessment start ranges from ${v('regions.referral_review_days.min')} to ${v('regions.referral_review_days.max')} across regions with data (gap ${v('regions.referral_review_days.gap')}).`, `Lähetteen arvioinnin aloitus vaihtelee ${v('regions.referral_review_days.min')}–${v('regions.referral_review_days.max')} alueilla, joilta on tietoa (ero ${v('regions.referral_review_days.gap')}).`), tx(L, 'Figures are synthetic and describe maakunta regions, not wellbeing services counties.', 'Luvut ovat synteettisiä ja koskevat maakuntia, eivät hyvinvointialueita.')],
    lung: [tx(L, `Candex holds ${v('lung.studies')} public LIDC-IDRI CT studies. The AI second reader found ${v('lung.ai.found')} nodules on the radiologists’ side (95% CI ${v('lung.ai.ci')}).`, `Candexissa on ${v('lung.studies')} julkista LIDC-IDRI-TT-tutkimusta. Tekoäly löysi ${v('lung.ai.found')} pesäkettä radiologien osoittamalta puolelta (95 %:n LV ${v('lung.ai.ci')}).`), tx(L, `The chest X-ray classifier’s highest Nodule score was ${v('lung.cxr.maxNodule')}: it is not a nodule detector.`, `Keuhkoröntgenluokittelijan suurin Nodule-pistemäärä oli ${v('lung.cxr.maxNodule')}: se ei tunnista pesäkkeitä.`)],
    standards: [tx(L, 'Finnish references define particular access limits and strategic goals, not universal traffic-light bands.', 'Suomalaiset viitteet määrittävät tiettyjä saatavuusrajoja ja strategisia tavoitteita, eivät yleisiä liikennevaloraja-arvoja.'), tx(L, `Core health-check answers are ${v('cohort.completeness')} complete in the simulated cohort.`, `Simuloidussa kohortissa terveyskyselyn ydinkysymyksiin on vastattu ${v('cohort.completeness')}.`)],
  }[kind];
  return {summary: s, findings: [], questions: [tx(L, 'Which of these signals would need real, measured data before any service decision?', 'Mitkä näistä signaaleista vaatisivat todellista mitattua tietoa ennen palvelupäätöksiä?')]};
}

function buildReport(kind, L, pk, hash) {
  const bad = new Set();
  const ai = R.narrative && R.narrativeFor === `${kind}|${hash}` ? R.narrative : null;
  const nar = ai ? {summary: ai[`summary_${L}`], findings: ai[`findings_${L}`], questions: ai[`questions_${L}`]} : templateNarrative(kind, L, pk);
  const F = arr => (arr || []).map(s => fill(L, s, pk, bad).replace(/\(([^()]+)\)\s*\(\1\)/g, '($1)'));
  const val = id => display(L, pk.values[id]);
  const lab = id => (L === 'fi' ? (pk.values[id].labelFi || FI(pk.values[id].label)) : pk.values[id].label);
  const st = id => statusLabel(L, pk.values[id].status);
  const sections = [];
  if (kind === 'kpi') {
    const rows = ids => ids.map(id => [lab(id), pk.values[id].value == null ? statusLabel(L, 'unknown') : val(id), st(id), loc(L, pk.values[id].threshold || '—'), provLabel(L, pk.values[id].provenance)]);
    const head = [tx(L, 'Indicator', 'Mittari'), tx(L, 'Value', 'Arvo'), tx(L, 'Status', 'Tila'), tx(L, 'Reference / threshold', 'Viite / raja-arvo'), tx(L, 'Data', 'Aineisto')];
    sections.push({title: tx(L, 'Finnish reference indicators', 'Suomalaiset viitemittarit'), table: {head, rows: rows(pk.sections.kpis), widths: [52, 20, 26, 54, 26]}});
    sections.push({title: tx(L, 'European comparators (not Finnish standards)', 'Eurooppalaiset vertailukohdat (eivät suomalaisia standardeja)'), table: {head, rows: rows(pk.sections.comparators), widths: [52, 20, 26, 54, 26]}});
    sections.push({title: tx(L, 'Clinical workflow & model measures', 'Kliininen työnkulku ja mallimittarit'), table: {head, rows: rows(pk.sections.operational), widths: [52, 20, 26, 54, 26]}});
    const grey = [...pk.sections.kpis, ...pk.sections.operational].filter(id => pk.values[id].status === 'unknown');
    sections.push({title: tx(L, 'Why some measures are not assessed', 'Miksi osaa mittareista ei arvioida'), list: grey.map(id => `${lab(id)}: ${loc(L, pk.values[id].basis || '—')}`)});
  } else if (kind === 'equity') {
    const g = pk.sections.cohortGroups;
    sections.push({title: tx(L, 'Up to date with screening, by group', 'Seulonnat ajan tasalla ryhmittäin'), table: {head: [tx(L, 'Group', 'Ryhmä'), tx(L, 'Invitations (n)', 'Kutsut (n)'), tx(L, 'People', 'Henkilöt'), tx(L, 'Up to date', 'Ajan tasalla'), tx(L, 'Note', 'Huomio')], rows: g.map(x => [loc(L, x.label), val(`cohort.group.${x.slug}.n`), val(`cohort.group.${x.slug}.people`), val(`cohort.group.${x.slug}.rate`), pk.values[`cohort.group.${x.slug}.rate`].lowN ? tx(L, 'Low n: do not compare', 'Pieni n: älä vertaa') : '']), widths: [52, 28, 24, 28, 46]}});
    sections.push({title: tx(L, 'Gaps (percentage points)', 'Erot (prosenttiyksikköä)'), kv: ['cohort.travelGap', 'cohort.langGap', 'cohort.urbanGap', 'cohort.routeGap'].filter(id => pk.values[id]).map(id => [lab(id), val(id)])});
    sections.push({title: tx(L, 'Programmes and pathway', 'Ohjelmat ja hoitopolku'), kv: ['cohort.breast.rate', 'cohort.cervical.rate', 'cohort.bowel.rate', 'cohort.lungEligible', 'cohort.symptomatic', 'cohort.urgent', 'cohort.medianDays', 'cohort.daysOcc', 'cohort.daysPub', 'cohort.completeness'].map(id => [lab(id), val(id)])});
  } else if (kind === 'regional') {
    const rs = pk.sections.regions;
    sections.push({title: tx(L, 'Spread across regions', 'Vaihtelu alueittain'), table: {head: [tx(L, 'Measure', 'Mittari'), tx(L, 'Lowest', 'Pienin'), tx(L, 'Highest', 'Suurin'), tx(L, 'Gap', 'Ero'), tx(L, 'Regions by status', 'Alueet tilan mukaan')], rows: Object.values(rs).map(m => [L === 'fi' ? m.labelFi : m.label, `${val(m.min)} (${L === 'fi' ? pk.values[m.min].regionFi : pk.values[m.min].region})`, `${val(m.max)} (${L === 'fi' ? pk.values[m.max].regionFi : pk.values[m.max].region})`, val(m.gap), ['green', 'yellow', 'red', 'unknown'].map(k => `${statusLabel(L, k)} ${val(m.counts[k])}`).join(' · ')]), widths: [40, 34, 34, 18, 52]}});
    const M = window.CandexRegionalMapTest;
    if (M) sections.push({title: tx(L, 'All regions (synthetic figures)', 'Kaikki alueet (synteettiset luvut)'), table: {head: [tx(L, 'Region', 'Alue'), ...M.metrics.map(m => (L === 'fi' ? m.fi : m.label))], rows: (M.names || []).map(([code, en, fi]) => [L === 'fi' ? fi : en, ...M.metrics.map(m => display(L, pk.values[`region.${code}.${m.id}`]))]), widths: [38, 28, 28, 28, 28, 28]}});
  } else if (kind === 'lung') {
    sections.push({title: tx(L, 'CT studies (public LIDC-IDRI)', 'TT-tutkimukset (julkinen LIDC-IDRI)'), kv: ['lung.studies', 'lung.band.2', 'lung.band.3', 'lung.band.4A', 'lung.band.4B', 'lung.band.4X-like'].map(id => [lab(id), val(id)])});
    if (pk.values['lung.ai.found']) sections.push({title: tx(L, 'AI second reader vs radiologists', 'Tekoäly toisena lukijana vs radiologit'), kv: [...['lung.ai.found', 'lung.ai.ci', 'lung.ai.consensusFound', 'lung.ai.sizeError', 'lung.ai.wrongSide', 'lung.ai.runs', 'lung.ai.agrees', 'lung.ai.partly', 'lung.ai.disagrees'].map(id => [lab(id), val(id)]), [tx(L, 'Model', 'Malli'), pk.sections.lungModel || '—']]});
    sections.push({title: tx(L, 'Chest X-ray classifier (TorchXRayVision, uncalibrated scores)', 'Keuhkoröntgenluokittelija (TorchXRayVision, kalibroimattomat pisteet)'), table: {head: [tx(L, 'Study', 'Tutkimus'), 'Nodule', 'Mass', tx(L, 'Highest label', 'Korkein nimike')], rows: pk.sections.chestXrays.map(x => [x.id, fmtNum(L, x.nodule), fmtNum(L, x.mass), `${x.topLabel} ${fmtNum(L, x.topScore)}`]), widths: [44, 30, 30, 74]}});
  } else {
    sections.push({title: tx(L, 'References and what they mean', 'Viitteet ja niiden merkitys'), list: pk.sections.kpis.map(id => `${lab(id)}: ${loc(L, pk.values[id].threshold || '—')}. ${loc(L, pk.values[id].basis || '')}`)});
    sections.push({title: tx(L, 'Static illustrative values', 'Kiinteät esimerkkiarvot'), list: pk.sections.operational.filter(id => pk.values[id].note).map(id => `${lab(id)} (${val(id)}): ${tx(L, 'shown on the page as a fixed example; it is not computed from the regional or cohort data.', 'näytetään sivulla kiinteänä esimerkkinä; sitä ei lasketa alue- tai kohorttiaineistosta.')}`)});
    sections.push({title: tx(L, 'Data completeness', 'Tietojen kattavuus'), kv: [[lab('cohort.completeness'), val('cohort.completeness')], [lab('op.data_completeness'), val('op.data_completeness')], [lab('regions.data_completeness.withData'), val('regions.data_completeness.withData')]]});
    sections.push({title: tx(L, 'Terminology', 'Termit'), list: [tx(L, 'Map regions are maakunta (19 regions incl. Åland); the cohort uses wellbeing services counties (hyvinvointialueet). They are not merged.', 'Kartan alueet ovat maakuntia (19, Ahvenanmaa mukaan lukien); kohortti käyttää hyvinvointialueita. Niitä ei yhdistetä.'), tx(L, 'Access to treatment (hoitotakuu): non-urgent assessment must start within 3 weeks of referral receipt. It is not a cancer-treatment target.', 'Hoitotakuu: kiireettömän hoidon tarpeen arviointi alkaa 3 viikon kuluessa lähetteen saapumisesta. Se ei ole syöpähoidon tavoite.'), tx(L, 'National Cancer Strategy 2026–2035 goals are strategic goals (tavoite 2035), not standards.', 'Kansallisen syöpästrategian 2026–2035 tavoitteet ovat strategisia tavoitteita (tavoite 2035), eivät standardeja.')]});
  }
  const caveats = [
    tx(L, 'All Candex metric, regional and cohort values are synthetic examples, not measured Finnish performance.', 'Kaikki Candexin mittari-, alue- ja kohorttiarvot ovat synteettisiä esimerkkejä, eivät mitattua suomalaista suorituskykyä.'),
    tx(L, 'Not for clinical decisions or individual-level conclusions.', 'Ei kliiniseen päätöksentekoon eikä yksilötason johtopäätöksiin.'),
    ...(kind === 'equity' ? [tx(L, 'The cohort’s gaps were built into the simulation (oversampling and participation penalties); they illustrate the method, not real groups. Groups under 5 people are flagged and not compared.', 'Kohortin erot on rakennettu simulaatioon (yliotanta ja osallistumista heikentävät tekijät); ne havainnollistavat menetelmää, eivät todellisia ryhmiä. Alle 5 hengen ryhmät on merkitty, eikä niitä verrata.')] : []),
    ...(kind === 'regional' ? [tx(L, 'A regional median does not show that individual patients were seen in time. Åland has no data.', 'Alueellinen mediaani ei osoita, että yksittäiset potilaat hoidettiin ajallaan. Ahvenanmaalta ei ole tietoa.')] : []),
    ...(kind === 'lung' ? [tx(L, 'Research data only: the AI reader is unvalidated and not CE-marked; 5 studies give a wide confidence interval. The chest X-ray classifier is not a nodule detector, and X-ray and CT dates are unknown.', 'Vain tutkimusaineistoa: tekoälylukija on validoimaton eikä CE-merkitty; viisi tutkimusta antaa leveän luottamusvälin. Keuhkoröntgenluokittelija ei tunnista pesäkkeitä, eikä röntgen- ja TT-kuvien päivämääriä tunneta.')] : []),
  ];
  return {
    kind, lang: L, pk, title: tx(L, KINDS[kind][0], KINDS[kind][1]),
    banner: tx(L, 'SYNTHETIC DEMO DATA · NOT MEASURED FINNISH PERFORMANCE · DRAFT', 'SYNTEETTINEN ESIMERKKIAINEISTO · EI MITATTUA SUOMALAISTA SUORITUSKYKYÄ · LUONNOS'),
    summary: F(nar.summary), findings: F(nar.findings), questions: F(nar.questions), sections, caveats, reviewIssues: ai ? R.review?.[`issues_${L}`] || R.review?.issues || [] : [],
    provenance: [[tx(L, 'KPI values, regional figures, cohort', 'KPI-arvot, alueluvut, kohortti'), provLabel(L, 'SYNTHETIC'), 'app.js · regional-map.js · screening.js'], [tx(L, 'Finnish references, European comparators', 'Suomalaiset viitteet, eurooppalaiset vertailukohdat'), provLabel(L, 'SOURCED REFERENCE'), 'kpis.js'], [tx(L, 'LIDC-IDRI CT and chest X-ray results', 'LIDC-IDRI-TT- ja keuhkoröntgentulokset'), provLabel(L, 'PUBLIC RESEARCH DATA'), 'data/lidc/*.js']],
    sources: pk.sources,
    technical: [[tx(L, 'Generated', 'Laadittu'), new Date().toISOString().slice(0, 16).replace('T', ' ')], [tx(L, 'KPI reference profile', 'KPI-viiteprofiili'), loc(L, pk.referenceProfile)], [tx(L, 'Data pack', 'Tietopaketti'), hash], [tx(L, 'Narrative', 'Teksti'), ai ? `${R.model} (AI, ${tx(L, 'numbers filled from the data pack', 'luvut täytetty tietopaketista')})` : tx(L, 'Template text, no AI', 'Mallipohjainen teksti, ei tekoälyä')], ...(ai ? [[tx(L, 'Safety review', 'Turvallisuustarkistus'), R.review?.issues?.length ? `${R.review.issues.length} ${tx(L, 'issue(s)', 'huomiota')}: ${(R.review[`issues_${L}`] || R.review.issues).join(' ')}` : tx(L, 'no issues found', 'ei huomautettavaa')]] : []), ...(bad.size ? [[tx(L, 'Unknown placeholders', 'Tuntemattomat paikkamerkit'), [...bad].join(', ')]] : [])],
    signoff: [[tx(L, 'Status', 'Tila'), tx(L, 'Draft for review, not approved', 'Luonnos tarkistettavaksi, ei hyväksytty')], [tx(L, 'Prepared by', 'Laatija'), tx(L, 'Quality Administrator (demo) in Candex', 'Laatuhallinnoija (demo) Candexissa')], [tx(L, 'Reviewed and approved by', 'Tarkistanut ja hyväksynyt'), '____________________'], [tx(L, 'Date', 'Päivämäärä'), '____________________']],
    labels: {reviewWarn: tx(L, 'The safety reviewer raised these points about the AI text. Check them before using the report:', 'Turvallisuustarkastaja nosti esiin nämä kohdat tekoälyn tekstistä. Tarkista ne ennen raportin käyttöä:'), summary: tx(L, 'Summary', 'Yhteenveto'), findings: tx(L, 'Key findings', 'Keskeiset havainnot'), questions: tx(L, 'Questions for service review', 'Kysymyksiä palvelun arviointiin'), caveats: tx(L, 'Limitations', 'Rajoitukset'), provenance: tx(L, 'Data provenance', 'Tietojen alkuperä'), sources: tx(L, 'Sources', 'Lähteet'), technical: tx(L, 'Technical details', 'Tekniset tiedot'), signoff: tx(L, 'Sign-off', 'Hyväksyntä'), page: tx(L, 'Page', 'Sivu'), of: tx(L, 'of', '/'), dataset: tx(L, 'Dataset', 'Aineisto'), type: tx(L, 'Type', 'Tyyppi'), file: tx(L, 'Source in Candex', 'Lähde Candexissa')},
  };
}
function previewHTML(r) {
  const sec = s => `<h4>${esc(s.title)}</h4>${s.table ? `<div class="table-wrap"><table><thead><tr>${s.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}${s.kv ? `<dl class="q-kv">${s.kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}${s.list ? `<ul>${s.list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  const L = r.labels;
  return `<article class="rr-doc q-doc" translate="no" lang="${r.lang}"><header class="rr-head"><div><strong>${esc(r.title)}</strong><small>${esc(r.banner)}</small></div></header>
${r.reviewIssues?.length ? `<div class="q-review-warn"><strong>${esc(L.reviewWarn)}</strong><ul>${r.reviewIssues.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}<div class="rr-bottom"><small>${esc(L.summary)}</small>${r.summary.map(s => `<p>${esc(s)}</p>`).join('')}</div>
${r.kind === 'regional' ? `<h4>${esc(tx(r.lang, 'Regional waiting times (map)', 'Alueelliset odotusajat (kartta)'))}</h4><div class="q-maps"><figure class="q-map-main"><img data-q-map="0" alt="${esc(tx(r.lang, 'Map: referral receipt to assessment start by region', 'Kartta: lähetteen saapumisesta arvioinnin alkuun alueittain'))}"><figcaption>${esc(tx(r.lang, 'Referral receipt → assessment start (days). Colours as on the Workspace map.', 'Lähetteen saapuminen → arvioinnin alku (päivää). Värit kuten Työtila-sivun kartassa.'))}</figcaption></figure><figure><img data-q-map="1" alt="${esc(tx(r.lang, 'Map: specialist assessment days by region', 'Kartta: erikoislääkärin arvio päivinä alueittain'))}"><figcaption>${esc(tx(r.lang, 'Specialist assessment (days), shaded by days: no national threshold.', 'Erikoislääkärin arvio (päivää), sävytetty päivien mukaan: ei kansallista raja-arvoa.'))}</figcaption></figure><figure><img data-q-map="2" alt="${esc(tx(r.lang, 'Map: treatment waiting time by region', 'Kartta: hoidon odotusaika alueittain'))}"><figcaption>${esc(tx(r.lang, 'Treatment waiting time (days), shaded by days: no national threshold.', 'Hoidon odotusaika (päivää), sävytetty päivien mukaan: ei kansallista raja-arvoa.'))}</figcaption></figure></div>` : ''}
${r.findings.length ? `<h4>${esc(L.findings)}</h4><ul>${r.findings.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
${r.sections.map(sec).join('')}
${r.questions.length ? `<h4>${esc(L.questions)}</h4><ul>${r.questions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
<h4>${esc(L.caveats)}</h4><ul>${r.caveats.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
<h4>${esc(L.provenance)}</h4><div class="table-wrap"><table><thead><tr><th>${esc(L.dataset)}</th><th>${esc(L.type)}</th><th>${esc(L.file)}</th></tr></thead><tbody>${r.provenance.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<h4>${esc(L.sources)}</h4><ul>${r.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>
<details class="q-tech"><summary>${esc(L.technical)}</summary><dl class="q-kv">${r.technical.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>
<h4>${esc(L.signoff)}</h4><dl class="q-kv">${r.signoff.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></article>`;
}
function writePDF(jsPDF, r, maps = null) {
  const C = window.candexReport, k = C.makeKit(jsPDF), doc = k.doc, L = r.labels;
  doc.setLanguage?.(r.lang === 'fi' ? 'fi' : 'en-GB');
  doc.setProperties({title: `Candex · ${r.title}`, subject: r.banner, author: 'Candex (demonstration)', creator: 'Candex'});
  k.title(r.title, `Candex · ${tx(r.lang, 'Quality report', 'Laaturaportti')} · ${new Date().toISOString().slice(0, 10)}`, r.banner);
  if (r.reviewIssues?.length) k.callout(L.reviewWarn, r.reviewIssues.join(' '), {fill: [252, 240, 223], bar: [154, 90, 41]});
  k.callout(L.summary, r.summary.join(' '));
  let n = 1;
  if (r.findings.length) { k.section(n++, L.findings); k.list(r.findings); }
  if (r.kind === 'regional') { k.section(n++, tx(r.lang, 'Regional waiting times (map)', 'Alueelliset odotusajat (kartta)')); drawRegionalMaps(k, r.lang, r.pk, maps); }
  for (const s of r.sections) {
    k.section(n++, s.title);
    if (s.table) k.table(s.table.head, s.table.rows, s.table.widths.map(w => (w * k.CW) / s.table.widths.reduce((a, b) => a + b, 0)));
    if (s.kv) k.kv(s.kv, 78);
    if (s.list) k.list(s.list);
  }
  if (r.questions.length) { k.section(n++, L.questions); k.list(r.questions); }
  k.section(n++, L.caveats); k.list(r.caveats);
  k.section(n++, L.provenance); k.table([L.dataset, L.type, L.file], r.provenance, [70, 44, k.CW - 114]);
  k.section(n++, L.sources); k.list(r.sources.map(s => `${s.title}: ${s.url}`));
  k.section(n++, L.technical); k.kv(r.technical, 52);
  k.section(n++, L.signoff); k.kv(r.signoff, 52);
  k.frame(`Candex · ${r.title}`, r.banner, L.page, L.of);
  return doc;
}
async function current() {
  const pk = pack(), hash = await hashOf(pk);
  return {pk, hash, r: buildReport(R.kind, reportLang(), pk, hash)};
}
const fpOf = (r, hash) => `${r.kind}|${r.lang}|${hash}|${R.narrativeFor || ''}`;
function reportsView() {
  setTimeout(() => { refreshStatus(); paintReport(); }, 0);
  const L = uiLang();
  return `${heading('Turn the data into a report.', 'Choose a report summary, preview it, then download the PDF in English or Finnish.', 'Quality reports')}${demoNotice('All metric, regional and cohort values are synthetic examples. Reports are drafts for review, not measured Finnish performance.')}
<div class="q-reports"><aside class="card q-controls"><h2>${T('Report settings')}</h2>
<div class="field"><label for="q-kind">${icon('file')}${T('Report type')}</label><select id="q-kind">${Object.entries(KINDS).map(([id, k]) => `<option value="${id}" ${id === R.kind ? 'selected' : ''}>${esc(tx(L, k[0], k[1]))}</option>`).join('')}</select><small id="q-kind-desc">${esc(tx(L, KINDS[R.kind][2], KINDS[R.kind][3]))}</small></div>
<div class="field"><label for="q-lang">${T('Report language')}</label><select id="q-lang"><option value="en" ${reportLang() === 'en' ? 'selected' : ''}>English</option><option value="fi" ${reportLang() === 'fi' ? 'selected' : ''}>Suomi</option></select></div>
<p class="field-note">${T('Reference profile')}: ${esc(T(pack().referenceProfile))}</p>
<div class="agent-status" id="q-status">${statusHTML()}</div>
${tokenField('One token for the whole page. The Gemini key stays on the server.')}
<div class="button-row"><button class="button secondary" data-q-ai ${R.busy ? 'disabled' : ''}>${icon('sparkle')}${R.busy ? T('Writing the summary… (30–40 s)') : T('Write AI summary')}</button><button class="button" data-q-preview>${T('Preview report')}</button><button class="button" data-q-pdf disabled>${icon('download')}${T('Download PDF')}</button></div>
<p class="field-note" id="q-report-note">${T('Tables are computed from the page data. The AI summary is optional; without it the report uses template text. Preview the report before downloading.')}</p>
${R.error ? `<p class="notice" role="alert">${esc(R.error)}</p>` : ''}</aside>
<section class="card q-preview" aria-live="polite"><div id="q-report"><div class="agent-empty">${icon('file')}<p>${T('Choose a report type and select Preview report.')}</p></div></div></section></div>`;
}
async function paintReport(show = false) {
  const btn = document.querySelector('[data-q-pdf]');
  const {r, hash} = await current();
  if (show) {
    const box = document.querySelector('#q-report'); if (box) box.innerHTML = previewHTML(r); R.previewed = fpOf(r, hash);
    if (r.kind === 'regional') regionalMaps().then(m => { if (m) document.querySelectorAll('[data-q-map]').forEach(img => { img.src = m[+img.dataset.qMap]; }); });
  }
  if (btn) btn.disabled = R.previewed !== fpOf(r, hash);
}
async function writeAI() {
  if (R.busy) return;
  const L = uiLang();
  if (!status?.configured) { toast(T('Live AI is not available. The report will use template text.')); return; }
  if (!token()) { toast(T('Paste the backend token first.')); window.candexAgent?.openToken?.('#q-token'); return; }
  R.busy = true; R.error = null; render(true);
  try {
    const pk = pack(), hash = await hashOf(pk);
    const out = await api('/api/agent/quality-report', {kind: R.kind, pack: pk, packHash: hash});
    Object.assign(R, {narrative: out.narrative, narrativeFor: `${R.kind}|${hash}`, review: out.review, model: out.model});
    if (out.typedNumbers?.length || out.unknownTokens?.length) {
      R.narrative = null; R.narrativeFor = null;
      R.error = tx(L, `The AI summary used numbers that are not in the data (${[...out.typedNumbers, ...out.unknownTokens].join(', ')}), so it was not used. The report uses template text.`, `Tekoälyn yhteenvedossa oli lukuja, joita aineistossa ei ole (${[...out.typedNumbers, ...out.unknownTokens].join(', ')}), joten sitä ei käytetty. Raportti käyttää mallipohjaista tekstiä.`);
    }
  } catch (e) {
    R.error = e.status === 401 ? `${T('The backend token was not accepted.')} ${window.candexAgent?.tokenWhere?.() || ''}` : `${T('The AI summary failed; the report uses template text.')} (${e.message})`;
  }
  R.busy = false; render(true);
  setTimeout(() => paintReport(true), 50);
}
async function downloadPDF() {
  try {
    const {r, hash} = await current();
    if (R.previewed !== fpOf(r, hash)) { toast(T('Preview the current report before downloading.')); return; }
    const lib = await window.candexReport.loadJsPDF();
    const maps = r.kind === 'regional' ? await regionalMaps() : null;
    writePDF(lib.jsPDF, r, maps).save(`candex-${r.kind}-report-${r.lang}-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast(T('PDF downloaded. It is a draft built from synthetic data.'));
  } catch { toast(T('The PDF library could not load (offline?). Use the preview and your browser’s Print → Save as PDF.')); }
}

// ---------- Quality & Equity: sample-data PDF (the page's "Export sample data") ----------
// Every KPI on the page with its status and reference, the regional waiting-time
// maps (drawn from the same boundaries, projection and status rules as the page)
// and a table of all regions. Built from the data pack, so it matches the page.
const MAP_COLOURS = {green: '#a1c7ad', yellow: '#e9cc77', red: '#d898a4', unknown: '#d9d6df'};
const MAP_RGB = {green: [161, 199, 173], yellow: [233, 204, 119], red: [216, 152, 164], unknown: [217, 214, 223]};
let geo = null;
async function regionsGeo() {
  if (geo) return geo;
  const r = await fetch(new URL('data/finland-regions.geojson', document.baseURI), {credentials: 'same-origin'});
  if (!r.ok) throw new Error('boundaries unavailable');
  return (geo = await r.json());
}
function labelPoint(geometry, project) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const ring = polys.map(p => p[0]).sort((a, b) => b.length - a.length)[0];
  const pts = ring.map(project);
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}
// A measure with no applicable threshold is all grey on the page; in the PDF it is
// shaded by value instead (lighter = lower), so the waiting times stay readable.
const SHADE = [[239, 232, 246], [109, 76, 148]];
const shadeOf = t => SHADE[0].map((c, i) => Math.round(c + (SHADE[1][i] - c) * t));
function shadedMetric(metricIndex) {
  const M = window.CandexRegionalMapTest, m = M.metrics[metricIndex];
  const vals = Object.values(M.fixtures).map(a => a[metricIndex]).filter(v => v != null);
  return vals.every(v => M.evaluate(m.id, v).level === 'unknown') ? {min: Math.min(...vals), max: Math.max(...vals)} : null;
}
async function mapImage(metricIndex, {labels = false, px = 1100} = {}) {
  const M = window.CandexRegionalMapTest, g = await regionsGeo(), m = M.metrics[metricIndex], shade = shadedMetric(metricIndex);
  const project = M.projection(g.features), W = 560, H = 640, sc = px / W;
  const cv = document.createElement('canvas'); cv.width = Math.round(W * sc); cv.height = Math.round(H * sc);
  const ctx = cv.getContext('2d'); ctx.scale(sc, sc); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  for (const f of g.features) {
    const v = M.fixtures[f.properties.code]?.[metricIndex], lvl = v == null ? 'unknown' : M.evaluate(m.id, v).level;
    const path = new Path2D(M.pathFor(f.geometry, project));
    ctx.fillStyle = shade && v != null ? `rgb(${shadeOf((v - shade.min) / (shade.max - shade.min || 1)).join(',')})` : MAP_COLOURS[lvl]; ctx.fill(path, 'evenodd'); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4; ctx.stroke(path);
  }
  if (labels) {
    ctx.font = `bold ${px < 1000 ? 19 : 15}px Helvetica, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const f of g.features) {
      const v = M.fixtures[f.properties.code]?.[metricIndex], [x, y] = labelPoint(f.geometry, project);
      const t = v == null ? '–' : String(v);
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.strokeText(t, x, y); ctx.fillStyle = '#32283c'; ctx.fillText(t, x, y);
    }
  }
  return cv.toDataURL('image/png');
}
// The regional maps (same boundaries and rules as the Workspace and Quality & Equity
// map): a large labelled map of referral assessment start with a region table, then
// the two waiting-time measures. Shared by the sample-data export and the regional report.
function drawRegionalMaps(k, L, pk, maps) {
  const doc = k.doc, M = window.CandexRegionalMapTest, V = pk.values;
  const legend = y => { let x = k.M; for (const lvl of ['green', 'yellow', 'red', 'unknown']) { doc.setFillColor(...MAP_RGB[lvl]); doc.rect(x, y - 2.6, 3.4, 3.4, 'F'); k.font(7.6, false, k.INK); const t = statusLabel(L, lvl); doc.text(clean(t), x + 4.6, y); x += 6 + doc.getTextWidth(clean(t)) + 4; } };
  const clean = window.candexReport.clean;
  if (maps) {
    const mw = 84, mh = mw * 640 / 560;
    k.ensure(mh + 14);
    const m0 = M.metrics[0], top = k.y;
    k.font(9.4, true, k.PURPLE); doc.text(clean(`${L === 'fi' ? m0.fi : m0.label} (${tx(L, 'days', 'päivää')})`), k.M, top + 3);
    doc.addImage(maps[0], 'PNG', k.M, top + 5, mw, mh);
    // Region table to the right of the map, ordered by region code (not ranked).
    const x0 = k.M + mw + 6, colW = [44, 16, 26];
    k.font(7.6, true, k.MUTED); doc.text(clean(tx(L, 'Region', 'Alue')), x0, top + 8); doc.text(clean(tx(L, 'Days', 'Päivää')), x0 + colW[0], top + 8); doc.text(clean(tx(L, 'Status', 'Tila')), x0 + colW[0] + colW[1], top + 8);
    let y = top + 12.5;
    for (const [code, en, fi] of M.names) {
      const v = V[`region.${code}.${m0.id}`];
      doc.setFillColor(...MAP_RGB[v.status]); doc.rect(x0 - 3.6, y - 2.4, 2.4, 2.4, 'F');
      k.font(7.8, false, k.INK); doc.text(clean(L === 'fi' ? fi : en), x0, y); doc.text(clean(v.value == null ? '–' : String(v.value)), x0 + colW[0], y); doc.text(clean(statusLabel(L, v.status)), x0 + colW[0] + colW[1], y);
      y += 4.55;
    }
    k.y = Math.max(top + 5 + mh, y) + 3; legend(k.y); k.y += 4;
    k.para(tx(L, 'Numbers on the map are synthetic median days from referral receipt to the start of assessment. Colours use the same rules as the page. Åland has no data.', 'Kartan luvut ovat synteettisiä mediaanipäiviä lähetteen saapumisesta arvioinnin alkuun. Värit noudattavat sivun sääntöjä. Ahvenanmaalta ei ole tietoa.'), {size: 8.2, color: k.MUTED});
    const sw = 78, sh = sw * 640 / 560;
    k.ensure(sh + 18);
    const t2 = k.y;
    for (const [i, mi] of [[0, 1], [1, 2]]) {
      const m = M.metrics[mi], x = k.M + i * (sw + 10);
      k.font(9, true, k.PURPLE); doc.text(doc.splitTextToSize(clean(`${L === 'fi' ? m.fi : m.label} (${tx(L, 'days', 'päivää')})`), sw), x, t2 + 3);
      doc.addImage(maps[mi], 'PNG', x, t2 + 7, sw, sh);
    }
    k.y = t2 + 9 + sh;
    const sh1 = shadedMetric(1), sh2 = shadedMetric(2);
    if (sh1 || sh2) {
      for (let i = 0; i < 6; i++) { doc.setFillColor(...shadeOf(i / 5)); doc.rect(k.M + i * 5, k.y - 2.6, 5, 3.4, 'F'); }
      k.font(7.6, false, k.INK); doc.text(clean(tx(L, 'Shorter wait  →  longer wait', 'Lyhyempi odotus  →  pidempi odotus')), k.M + 33, k.y);
      k.y += 4;
      k.para(tx(L, 'No national threshold applies to these two measures under the current reference profile, so they are not assessed (grey on the page). Here they are shaded by days instead; numbers are synthetic median days.', 'Näille kahdelle mittarille ei nykyisellä viiteprofiililla ole kansallista raja-arvoa, joten niitä ei arvioida (harmaa sivulla). Tässä ne on sävytetty päivien mukaan; luvut ovat synteettisiä mediaanipäiviä.'), {size: 8.2, color: k.MUTED});
    } else { legend(k.y); k.y += 5; }
  } else {
    k.para(tx(L, 'The map boundaries could not load, so the maps are left out; the tables below have every value.', 'Alueiden rajoja ei voitu ladata, joten kartat puuttuvat; alla olevissa taulukoissa ovat kaikki arvot.'), {color: k.MUTED});
  }
}
function writeDataPDF(jsPDF, L, pk, hash, maps) {
  const k = window.candexReport.makeKit(jsPDF), doc = k.doc, M = window.CandexRegionalMapTest;
  const V = pk.values, val = id => display(L, V[id]), lab = id => (L === 'fi' ? (V[id].labelFi || FI(V[id].label)) : V[id].label);
  const st = id => statusLabel(L, V[id].status);
  const banner = tx(L, 'SYNTHETIC DEMO DATA · NOT MEASURED FINNISH PERFORMANCE', 'SYNTEETTINEN ESIMERKKIAINEISTO · EI MITATTUA SUOMALAISTA SUORITUSKYKYÄ');
  const title = tx(L, 'Quality & Equity: sample data report', 'Laatu ja yhdenvertaisuus: esimerkkiaineiston raportti');
  doc.setLanguage?.(L === 'fi' ? 'fi' : 'en-GB');
  doc.setProperties({title: `Candex · ${title}`, subject: banner, author: 'Candex (demonstration)', creator: 'Candex'});
  k.title(title, `Candex · ${new Date().toISOString().slice(0, 10)} · ${loc(L, pk.referenceProfile)}`, banner);
  const all = [...pk.sections.kpis, ...pk.sections.comparators, ...pk.sections.operational];
  const cnt = lvl => all.filter(id => V[id].status === lvl).length;
  const rr = pk.sections.regions.referral_review_days;
  k.callout(tx(L, 'At a glance', 'Yhdellä silmäyksellä'), tx(L,
    `${all.length} indicators: ${cnt('green')} under control, ${cnt('yellow')} need review, ${cnt('red')} need urgent action, ${cnt('unknown')} not assessed. Referral assessment start ranges from ${val(rr.min)} (${V[rr.min].region}) to ${val(rr.max)} (${V[rr.max].region}) across ${val(rr.withData)} regions with data. All values are synthetic examples.`,
    `${all.length} mittaria: hallinnassa ${cnt('green')}, vaatii tarkistusta ${cnt('yellow')}, kiireellisiä toimia ${cnt('red')}, arvioimatta ${cnt('unknown')}. Lähetteen arvioinnin aloitus vaihtelee ${val(rr.min)} (${V[rr.min].regionFi}) – ${val(rr.max)} (${V[rr.max].regionFi}) ${val(rr.withData)} alueella, joilta on tietoa. Kaikki arvot ovat synteettisiä esimerkkejä.`));
  let n = 1;
  k.section(n++, tx(L, 'How to read this report', 'Raportin lukuohje'));
  k.kv([[statusLabel(L, 'green'), tx(L, 'Meets the stated reference.', 'Täyttää ilmoitetun viitteen.')], [statusLabel(L, 'yellow'), tx(L, 'Within the local warning band: review the service.', 'Paikallisella varoitusalueella: tarkista palvelu.')], [statusLabel(L, 'red'), tx(L, 'Beyond the reference: urgent service action.', 'Viitteen ulkopuolella: kiireellisiä palvelutoimia.')], [statusLabel(L, 'unknown'), tx(L, 'No applicable threshold or not enough data.', 'Ei soveltuvaa raja-arvoa tai riittävästi tietoa.')], [tx(L, 'Important', 'Tärkeää'), tx(L, 'Colours are service-review signals, not patient triage. Finnish sources define particular limits and strategic goals; yellow bands are local Candex conventions.', 'Värit ovat palvelun arvioinnin signaaleja, eivät potilaiden kiireellisyysluokitus. Suomalaiset lähteet määrittävät tietyt rajat ja strategiset tavoitteet; keltaiset alueet ovat Candexin paikallisia käytäntöjä.')]], 44);
  const head = [tx(L, 'Indicator', 'Mittari'), tx(L, 'Value', 'Arvo'), tx(L, 'Status', 'Tila'), tx(L, 'Reference / threshold', 'Viite / raja-arvo')];
  const W4 = [k.CW * 0.34, k.CW * 0.12, k.CW * 0.16, k.CW * 0.38];
  const rows = ids => ids.map(id => [lab(id), V[id].value == null ? statusLabel(L, 'unknown') : val(id), st(id), loc(L, V[id].threshold || '—')]);
  k.section(n++, tx(L, 'Finnish reference indicators', 'Suomalaiset viitemittarit'));
  k.table(head, rows(pk.sections.kpis), W4);
  k.sub(tx(L, 'What each reference means', 'Mitä kukin viite tarkoittaa'));
  k.list(pk.sections.kpis.map(id => `${lab(id)}: ${loc(L, V[id].basis || '—')}${V[id].source ? ` (${V[id].source})` : ''}`));
  k.section(n++, tx(L, 'European comparators', 'Eurooppalaiset vertailukohdat'));
  k.para(tx(L, 'EU screening target, European screening guidelines and the EUSOMA breast-centre indicator. Use only as external benchmarks with matching definitions and cohorts. They are not Finnish standards.', 'EU:n seulontatavoite, eurooppalaiset seulontasuositukset ja EUSOMAn rintasyöpäkeskusmittari. Käytä vain ulkoisina vertailukohtina, kun määritelmät ja kohortit vastaavat toisiaan. Ne eivät ole suomalaisia standardeja.'), {size: 8.6, color: k.MUTED});
  k.table(head, rows(pk.sections.comparators), W4);
  k.sub(tx(L, 'What each comparator means', 'Mitä kukin vertailukohta tarkoittaa'));
  k.list(pk.sections.comparators.map(id => `${lab(id)}: ${loc(L, V[id].basis || '—')}${V[id].source ? ` (${V[id].source})` : ''}`));
  k.section(n++, tx(L, 'Clinical workflow & model measures', 'Kliininen työnkulku ja mallimittarit'));
  k.table([tx(L, 'Measure', 'Mittari'), tx(L, 'Value', 'Arvo'), tx(L, 'Status', 'Tila'), tx(L, 'Definition', 'Määritelmä')], pk.sections.operational.map(id => [lab(id) + (V[id].note ? ' *' : ''), val(id), st(id), loc(L, V[id].definition || '')]), W4);
  k.para(tx(L, `* Static illustrative value shown on the page; it is not computed from the regional or cohort data (the map data give a referral-assessment gap of ${val(rr.gap)}).`, `* Sivulla näytettävä kiinteä esimerkkiarvo; sitä ei lasketa alue- tai kohorttiaineistosta (karttatietojen mukaan lähetteen arvioinnin ero on ${val(rr.gap)}).`), {size: 8.2, color: k.MUTED});
  // Regional waiting times: large labelled map + table, then two smaller maps.
  k.section(n++, tx(L, 'Regional waiting times (map)', 'Alueelliset odotusajat (kartta)'));
  drawRegionalMaps(k, L, pk, maps);
  k.sub(tx(L, 'Spread across regions', 'Vaihtelu alueittain'));
  const rs = pk.sections.regions;
  k.table([tx(L, 'Measure', 'Mittari'), tx(L, 'Lowest', 'Pienin'), tx(L, 'Highest', 'Suurin'), tx(L, 'Gap', 'Ero'), tx(L, 'Regions by status', 'Alueet tilan mukaan')],
    Object.values(rs).map(m => [L === 'fi' ? m.labelFi : m.label, `${val(m.min)} (${L === 'fi' ? V[m.min].regionFi : V[m.min].region})`, `${val(m.max)} (${L === 'fi' ? V[m.max].regionFi : V[m.max].region})`, val(m.gap), ['green', 'yellow', 'red', 'unknown'].map(s => `${statusLabel(L, s)} ${val(m.counts[s])}`).join(' · ')]),
    [k.CW * 0.22, k.CW * 0.2, k.CW * 0.2, k.CW * 0.1, k.CW * 0.28]);
  k.sub(tx(L, 'All regions and measures', 'Kaikki alueet ja mittarit'));
  k.table([tx(L, 'Region', 'Alue'), ...M.metrics.map(m => (L === 'fi' ? m.fi : m.label))], M.names.map(([code, en, fi]) => [L === 'fi' ? fi : en, ...M.metrics.map(m => display(L, V[`region.${code}.${m.id}`]))]), [k.CW * 0.2, ...Array(5).fill(k.CW * 0.16)]);
  k.section(n++, tx(L, 'Standards and measurement definitions', 'Standardit ja mittausmääritelmät'));
  k.list([
    tx(L, 'STM, access to treatment (hoitotakuu): non-urgent specialist assessment starts within 3 weeks of referral receipt. Three- and six-month limits are not converted into 90/180-day cancer targets.', 'STM, hoitotakuu: kiireetön erikoissairaanhoidon arviointi alkaa 3 viikon kuluessa lähetteen saapumisesta. Kolmen ja kuuden kuukauden rajoja ei muunneta 90/180 päivän syöpätavoitteiksi.'),
    tx(L, 'National Cancer Strategy 2026–2035: screening and early-stage references are strategic goals (2035); Goal 3 requires the applicable treatment timeframe.', 'Kansallinen syöpästrategia 2026–2035: seulonta- ja varhaisvaiheen viitteet ovat strategisia tavoitteita (2035); tavoite 3 edellyttää sovellettavaa hoidon aikarajaa.'),
    tx(L, 'THL cancer waiting-time monitoring: choose the correct cancer pathway and event anchors. Published comparison bins are not treatment deadlines.', 'THL:n syövän hoitoonpääsyn seuranta: valitse oikea syöpäpolku ja tapahtumien alkupisteet. Julkaistut vertailuluokat eivät ole hoidon määräaikoja.'),
    tx(L, 'A regional median below a deadline does not prove that every referral met it. Case mix, missing data, cohort size and uncertainty must be considered.', 'Alueellinen mediaani määräajan alapuolella ei osoita, että jokainen lähete täytti sen. Tapausjakauma, puuttuvat tiedot, kohortin koko ja epävarmuus on otettava huomioon.'),
  ]);
  k.section(n++, tx(L, 'Limitations and data provenance', 'Rajoitukset ja tietojen alkuperä'));
  k.list([tx(L, 'All Candex metric and regional values are synthetic examples, not measured Finnish performance.', 'Kaikki Candexin mittari- ja alueluvut ovat synteettisiä esimerkkejä, eivät mitattua suomalaista suorituskykyä.'), tx(L, 'Map regions are maakunta (Statistics Finland boundaries), not wellbeing services counties.', 'Kartan alueet ovat maakuntia (Tilastokeskuksen rajat), eivät hyvinvointialueita.'), tx(L, 'Not for clinical decisions or individual-level conclusions.', 'Ei kliiniseen päätöksentekoon eikä yksilötason johtopäätöksiin.')]);
  k.kv([[tx(L, 'Sources', 'Lähteet'), pk.sources.map(s => `${s.title}: ${s.url}`).join('\n')], [tx(L, 'Generated', 'Laadittu'), new Date().toISOString().slice(0, 16).replace('T', ' ')], [tx(L, 'KPI reference profile', 'KPI-viiteprofiili'), loc(L, pk.referenceProfile)], [tx(L, 'Data pack', 'Tietopaketti'), hash]], 44);
  k.frame(`Candex · ${title}`, banner, tx(L, 'Page', 'Sivu'), tx(L, 'of', '/'));
  return doc;
}
async function regionalMaps() {
  try { return await Promise.all([mapImage(0, {labels: true}), mapImage(1, {labels: true, px: 900}), mapImage(2, {labels: true, px: 900})]); } catch { return null; }
}
async function dataPdf(L = uiLang()) {
  const pk = pack(), hash = await hashOf(pk);
  const maps = await regionalMaps();
  const lib = await window.candexReport.loadJsPDF();
  return writeDataPDF(lib.jsPDF, L, pk, hash, maps);
}
async function exportDataPDF() {
  try {
    toast(T('Preparing the PDF…'));
    (await dataPdf()).save(`candex-quality-equity-sample-data-${uiLang()}-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast(T('PDF downloaded. All values are synthetic examples.'));
  } catch { toast(T('The PDF library could not load (offline?). Use the preview and your browser’s Print → Save as PDF.')); }
}

document.addEventListener('click', e => {
  const t = e.target;
  const ask1 = t.closest?.('[data-q-ask]'); if (ask1) { ask(T(ask1.dataset.qAsk)); return; }
  if (t.closest?.('[data-q-clear]')) { log.length = 0; drawLog(); return; }
  const cp = t.closest?.('[data-q-copy]'); if (cp) { navigator.clipboard?.writeText(log[+cp.dataset.qCopy]?.text || '').then(() => toast(T('Copied.')), () => {}); return; }
  if (t.closest?.('[data-q-preview]')) { paintReport(true); return; }
  if (t.closest?.('[data-q-ai]')) { writeAI(); return; }
  if (t.closest?.('[data-q-pdf]')) { downloadPDF(); }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'q-form') return;
  e.preventDefault(); e.stopImmediatePropagation();
  const input = document.querySelector('#q-input'), text = input.value.trim();
  if (text) { input.value = ''; ask(text).then(() => document.querySelector('#q-input')?.focus()); }
}, true);
document.addEventListener('keydown', e => { if (e.target.id === 'q-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form?.requestSubmit(); } });
document.addEventListener('input', e => { if (e.target.id === 'q-token') window.candexAgent?.setToken?.(e.target.value); });
document.addEventListener('change', e => {
  if (e.target.id === 'q-kind') { R.kind = e.target.value; const d = document.querySelector('#q-kind-desc'); if (d) d.textContent = tx(uiLang(), KINDS[R.kind][2], KINDS[R.kind][3]); paintReport(document.querySelector('#q-report .q-doc') !== null); }
  if (e.target.id === 'q-lang') { R.lang = e.target.value; paintReport(document.querySelector('#q-report .q-doc') !== null); }
  if (e.target.id === 'kpi-profile') { R.narrative = null; R.narrativeFor = null; }
});

window.candexI18n?.extend?.({
  // Data-pack labels (used by Finnish reports through lookup()).
  "People in the screening cohort": "Henkilöitä seulontakohortissa",
  "Simulated people": "Simuloituja henkilöitä",
  "People added through the health-check form": "Terveyskyselyn kautta lisätyt henkilöt",
  "Up to date with screening": "Seulonnat ajan tasalla",
  "Screening invitations considered": "Huomioidut seulontakutsut",
  "breast": "rinta",
  "cervical": "kohdunkaula",
  "bowel": "suolisto",
  "overall": "kaikki",
  "Up to date": "Ajan tasalla",
  "Invitations considered": "Huomioidut kutsut",
  "People": "Henkilöt",
  "Gap: travel under 30 min minus 30 min or more (up to date)": "Ero: matka alle 30 min miinus vähintään 30 min (ajan tasalla)",
  "Gap: Finnish or Swedish minus other languages (up to date)": "Ero: suomi tai ruotsi miinus muut kielet (ajan tasalla)",
  "Gap: urban minus other counties (up to date)": "Ero: kaupunkialueet miinus muut alueet (ajan tasalla)",
  "Gap: occupational health minus public health centre (up to date)": "Ero: työterveyshuolto miinus julkinen terveysasema (ajan tasalla)",
  "Meet USPSTF lung-screening criteria": "Täyttää USPSTF:n keuhkoseulontakriteerit",
  "People reporting symptoms": "Oireita ilmoittaneet",
  "People with red-flag symptoms": "Hälytysoireita ilmoittaneet",
  "Median days from symptom to GP": "Mediaani päivinä oireesta lääkäriin",
  "Median days to GP": "Mediaani päivinä lääkäriin",
  "occupational health": "työterveyshuolto",
  "public health centre": "julkinen terveysasema",
  "Core health-check answers completed": "Terveyskyselyn ydinvastausten kattavuus",
  "Alcohol above the risk limit": "Alkoholinkäyttö yli riskirajan",
  "Low physical activity": "Vähäinen liikunta",
  "BMI 30 or more": "BMI 30 tai yli",
  "Asked for support": "Pyysi tukea",
  "Family-history pattern": "Sukuhistoriaan viittaava kuvio",
  "Public LIDC-IDRI CT studies in Candex": "Julkiset LIDC-IDRI-TT-tutkimukset Candexissa",
  "CT studies": "TT-tutkimukset",
  "AI second reader: nodules found on the radiologists’ side": "Tekoäly toisena lukijana: löydetyt pesäkkeet radiologien osoittamalla puolella",
  "AI second reader: 95% confidence interval (Clopper–Pearson)": "Tekoäly toisena lukijana: 95 %:n luottamusväli (Clopper–Pearson)",
  "AI second reader: consensus nodules found (≥3 of 4 readers)": "Tekoäly toisena lukijana: löydetyt konsensuspesäkkeet (≥3/4 lukijaa)",
  "AI second reader: mean signed size error": "Tekoäly toisena lukijana: keskimääräinen etumerkillinen kokovirhe",
  "AI second reader: findings on the wrong side": "Tekoäly toisena lukijana: löydökset väärällä puolella",
  "AI second reader: runs per study": "Tekoäly toisena lukijana: ajoja tutkimusta kohden",
  "AI second reads that agree with the radiologists": "Tekoälyluennat, jotka ovat yhtäpitäviä radiologien kanssa",
  "AI second reads that partly agree with the radiologists": "Tekoälyluennat, jotka ovat osittain yhtäpitäviä radiologien kanssa",
  "AI second reads that disagree with the radiologists": "Tekoälyluennat, jotka eroavat radiologeista",
  "Chest X-rays run through the classifier": "Luokittelijalla analysoidut keuhkoröntgenkuvat",
  "Chest X-ray classifier: highest Nodule score (uncalibrated, 0–1)": "Keuhkoröntgenluokittelija: suurin Nodule-pistemäärä (kalibroimaton, 0–1)",
  "Chest X-ray classifier: highest Mass score (uncalibrated, 0–1)": "Keuhkoröntgenluokittelija: suurin Mass-pistemäärä (kalibroimaton, 0–1)",
  "Map regions (maakunta, incl. Åland)": "Kartan alueet (maakunnat, Ahvenanmaa mukaan lukien)",
  "Lowest regional value": "Pienin alueellinen arvo",
  "Highest regional value": "Suurin alueellinen arvo",
  "Regional gap (highest − lowest)": "Alueellinen ero (suurin − pienin)",
  "Regions with data": "Alueet, joilta on tietoa",
  "Regions: Under control": "Alueet: hallinnassa",
  "Regions: Needs review": "Alueet: vaatii tarkistusta",
  "Regions: Urgent action": "Alueet: kiireellisiä toimia",
  "Regions: Not assessed": "Alueet: ei arvioitu",
  'Quality agent': 'Laatuagentti', 'Quality reports': 'Laaturaportit', 'Ask about quality and equity': 'Kysy laadusta ja yhdenvertaisuudesta',
  'KPIs, references, regions, the simulated cohort and the lung pilot': 'Mittarit, viitteet, alueet, simuloitu kohortti ja keuhkopilotti',
  'Checking live AI…': 'Tarkistetaan tekoälyä…', 'Offline: answers from page data': 'Ei yhteyttä: vastaukset sivun tiedoista', 'Live AI connected': 'Tekoäly yhdistetty',
  'The backend is not reachable.': 'Palvelimeen ei saada yhteyttä.', 'The server has no Gemini key.': 'Palvelimella ei ole Gemini-avainta.',
  'One token for the whole page. The Gemini key stays on the server.': 'Yksi tunniste koko sivulle. Gemini-avain pysyy palvelimella.',
  'Finnish reference indicators': 'Suomalaiset viitemittarit', 'Workflow and model measures': 'Työnkulku- ja mallimittarit', 'Regions (19 maakunta)': 'Alueet (19 maakuntaa)',
  'Simulated screening cohort': 'Simuloitu seulontakohortti', 'Lung pilot (LIDC-IDRI, chest X-rays)': 'Keuhkopilotti (LIDC-IDRI, keuhkoröntgen)',
  'Reference profile': 'Viiteprofiili', 'Technical details': 'Tekniset tiedot', 'Data pack': 'Tietopaketti', 'values': 'arvoa',
  'Verified Finnish references (unsupported measures remain grey)': 'Varmennetut suomalaiset viitteet (tukemattomat mittarit pysyvät harmaina)',
  'Local demo operating bands (not national standards)': 'Paikalliset demorajat (eivät kansallisia standardeja)',
  'Grounded:': 'Perusteltu:', 'Checked:': 'Tarkistettu:', 'Honest:': 'Rehellinen:',
  'answers use only the figures on the Quality & Equity page, each tagged synthetic, sourced reference or public research data.': 'vastaukset käyttävät vain Laatu ja yhdenvertaisuus -sivun lukuja, ja jokainen on merkitty synteettiseksi, lähteeseen perustuvaksi viitteeksi tai julkiseksi tutkimusaineistoksi.',
  'the server checks every number in an answer against the page data and flags any it cannot find.': 'palvelin tarkistaa vastauksen jokaisen luvun sivun tiedoista ja merkitsee luvut, joita se ei löydä.',
  'no patient-level conclusions and no rankings of real regions; the figures are synthetic.': 'ei potilastason johtopäätöksiä eikä todellisten alueiden paremmuusjärjestystä; luvut ovat synteettisiä.',
  'Which indicators need review or urgent action, and what reference sets each threshold?': 'Mitkä mittarit vaativat tarkistusta tai kiireellisiä toimia, ja mikä viite määrittää kunkin raja-arvon?',
  'Is the 21-day referral limit a cancer-specific target?': 'Onko 21 päivän raja lähetteen arvioinnin aloitukselle syöpäkohtainen tavoite?',
  'How large is the regional spread in referral assessment times?': 'Kuinka suuria ovat alueelliset erot lähetteiden arvioinnin aloituksessa?',
  'Which groups in the simulated cohort are least up to date with screening?': 'Mitkä simuloidun kohortin ryhmät ovat vähiten ajan tasalla seulonnoissa?',
  'How well did the AI second reader agree with the radiologists?': 'Kuinka hyvin tekoäly toisena lukijana oli yhtä mieltä radiologien kanssa?',
  'Why is “Treatment within applicable pathway target” not assessed?': 'Miksi mittaria ”Hoito sovellettavan hoitopolun tavoitteessa” ei arvioida?',
  'Ask about any figure on the Quality & Equity page: KPIs and their references, regional figures, the simulated cohort or the lung pilot data.': 'Kysy mistä tahansa Laatu ja yhdenvertaisuus -sivun luvusta: mittareista ja niiden viitteistä, alueluvuista, simuloidusta kohortista tai keuhkopilotin tiedoista.',
  'Offline answer from page data, no AI': 'Vastaus sivun tiedoista ilman tekoälyä', 'Numbers not found in the page data:': 'Lukuja, joita ei löydy sivun tiedoista:', 'Copy answer': 'Kopioi vastaus', 'Copied.': 'Kopioitu.',
  'Ask the quality agent': 'Kysy laatuagentilta', 'Ask about a figure… (Enter to send, Shift+Enter for a new line)': 'Kysy luvusta… (Enter lähettää, Shift+Enter uusi rivi)', 'Ask': 'Kysy',
  'General-purpose AI, unvalidated: it can be wrong. All figures are synthetic examples unless tagged otherwise.': 'Yleiskäyttöinen tekoäly, validoimaton: se voi olla väärässä. Kaikki luvut ovat synteettisiä esimerkkejä, ellei toisin merkitty.',
  'Turn the data into a report.': 'Tee aineistosta raportti.', 'Choose a report summary, preview it, then download the PDF in English or Finnish.': 'Valitse raporttiyhteenveto, esikatsele se ja lataa PDF englanniksi tai suomeksi.',
  'All metric, regional and cohort values are synthetic examples. Reports are drafts for review, not measured Finnish performance.': 'Kaikki mittari-, alue- ja kohorttiarvot ovat synteettisiä esimerkkejä. Raportit ovat tarkistettavia luonnoksia, eivät mitattua suomalaista suorituskykyä.',
  'Report settings': 'Raportin asetukset', 'Report type': 'Raportin tyyppi', 'Report language': 'Raportin kieli',
  'Write AI summary': 'Kirjoita tekoälyn yhteenveto', 'Writing the summary… (30–40 s)': 'Kirjoitetaan yhteenvetoa… (30–40 s)', 'Preview report': 'Esikatsele raporttia', 'Download PDF': 'Lataa PDF',
  'Tables are computed from the page data. The AI summary is optional; without it the report uses template text. Preview the report before downloading.': 'Taulukot lasketaan sivun tiedoista. Tekoälyn yhteenveto on valinnainen; ilman sitä raportti käyttää mallipohjaista tekstiä. Esikatsele raportti ennen lataamista.',
  'Choose a report type and select Preview report.': 'Valitse raportin tyyppi ja valitse Esikatsele raporttia.',
  'Live AI is not available. The report will use template text.': 'Tekoäly ei ole käytettävissä. Raportti käyttää mallipohjaista tekstiä.',
  'The AI summary failed; the report uses template text.': 'Tekoälyn yhteenveto epäonnistui; raportti käyttää mallipohjaista tekstiä.',
  'Preview the current report before downloading.': 'Esikatsele nykyinen raportti ennen lataamista.', 'PDF downloaded. It is a draft built from synthetic data.': 'PDF ladattu. Se on synteettisestä aineistosta koottu luonnos.',
  'The PDF library could not load (offline?). Use the preview and your browser’s Print → Save as PDF.': 'PDF-kirjasto ei latautunut (ei yhteyttä?). Käytä esikatselua ja selaimen Tulosta → Tallenna PDF:nä.',
  'Paste the backend token first.': 'Liitä ensin palvelimen tunniste.', 'The backend token was not accepted.': 'Palvelimen tunnistetta ei hyväksytty.',
  'Reports': 'Raportit', 'Set': 'Asetettu', 'Not set': 'Ei asetettu', 'Backend token': 'Palvelimen tunniste', 'How it works': 'Miten se toimii', 'What the agent can see': 'Mitä agentti näkee', 'Kept in this page’s memory only. The Gemini key stays on the server.': 'Säilyy vain tämän sivun muistissa. Gemini-avain pysyy palvelimella.', 'Export sample data (PDF)': 'Vie esimerkkidata (PDF)', 'CSV': 'CSV', 'PDF downloaded. All values are synthetic examples.': 'PDF ladattu. Kaikki arvot ovat synteettisiä esimerkkejä.', 'Preparing the PDF…': 'Valmistellaan PDF:ää…',
});
window.candexQuality = {pack, hashOf, regionalMaps, dataPdf, exportDataPDF, writeDataPDF, view, reportsView, buildReport, previewHTML, writePDF, offlineAnswer, templateNarrative, ask, _R: R, _log: log, _setStatus: v => { status = v; }};
})();
