// Doctor → AI workspace → Clinical agent (research prototype).
// An interactive assistant for one patient at a time, backed by live Gemini
// through the Candex backend (backend/agent.py). The browser never sees the
// Gemini key; requests carry the backend's temporary token, kept in page memory.
// Tools: grounded Q&A on the patient record, document drafts (drafter + safety
// reviewer), and a CT read of the linked study. Without live AI it answers from
// the record and says so. Loaded before app.js; uses patients, state, esc,
// badge, icon, toast, navigate at call time.
(() => {
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const lang = () => (window.candexI18n?.lang === 'fi' ? 'fi' : 'en');
const convo = {};            // patient id -> [{role, type, text, data}]
let token = '';              // backend token, page memory only
let status = null;           // {configured, chatModel, visionModel, ctInput} | {error}
let busy = false, selected = null;
let sessionRevision = 0;
const requests = new Set();

// Leaving a demo workspace must not retain its backend token or restore an
// old conversation when an earlier request eventually returns.
function resetSession() {
  sessionRevision++;
  for (const controller of requests) controller.abort();
  requests.clear();
  token = ''; status = null; selected = null; busy = false;
  for (const id of Object.keys(convo)) delete convo[id];
}

const pid = () => (selected && patients.some(p => p.id === selected) ? selected : (state.selected && patients.some(p => p.id === state.selected) ? state.selected : patients[0].id));
const caseOf = id => { const k = window.candexImaging?.links?.[id]; return k ? window.candexImaging.CASES[k] : null; };
const log = id => (convo[id] ||= []);

// ---------- The record the agent may see (the same data as the referral report) ----------
function record(id) {
  const R = window.candexReport;
  if (!R) return {note: 'Record unavailable'};
  const r = R.build(id, {lang: 'en', skipApproval: true});
  const rows = a => Object.fromEntries((a || []).map(([k, v]) => [k, v]));
  return {
    'About': 'Fictional demo patient. Any CT is a public LIDC-IDRI research scan linked for the demo. Research prototype, not for clinical use.',
    'Patient': rows(r.patient),
    'Care pathway': rows(r.pathway),
    'Clinical context': rows(r.context),
    ...(r.technique ? {'Imaging technique': rows(r.technique)} : {'Imaging': 'No CT study linked'}),
    ...(r.findings ? {'Structured findings': {primary: rows(r.findings.primary), otherNodules: r.findings.others, nodal: r.findings.nodal, distant: r.findings.distant, category: r.findings.category}} : {}),
    ...(r.ai && r.ai.summary ? {'AI second reader': {summary: r.ai.summary, verdict: r.ai.verdictText, comparison: r.ai.rows.map(x => x.join(' | ')), caveat: 'Unvalidated research read; not used for urgency or recommendations.'}} : {}),
    ...(() => { const cc = window.candexCtCompare?.forPatient?.(id, 'en'); return cc ? {'Uploaded CT comparison': {status: cc.approved ? `Approved by ${cc.approval.by}; linked reference study ${cc.linked}` : 'Awaiting clinician approval: do not rely on it', closestPublicStudy: cc.closest, similarityPercent: cc.similarity, aiRead: {nodulePresent: cc.read.nodule_present, side: cc.read.location?.side, longAxisMm: cc.read.long_axis_mm, composition: cc.read.composition, lungRads: cc.read.lung_rads}, topMatches: cc.top.map(m => `${m.caseId} ${m.similarity}% (${m.diameter} mm, Lung-RADS ${m.band}, ${m.side || 'side unknown'})`), summary: cc.summary, caveat: 'Unvalidated AI read; the match compares nodule features only; the reference is a public scan, not the patient’s own.'}} : {}; })(),
    'Impression': {bottomLine: r.impression.bottomLine, keyFindings: r.impression.bullets, pertinentNegatives: r.impression.negatives, notEvaluated: r.impression.notEvaluated, recommendations: r.impression.recs},
  };
}
const SECTIONS = ['Patient', 'Care pathway', 'Clinical context', 'Imaging technique', 'Structured findings', 'AI second reader', 'Uploaded CT comparison', 'Impression'];

// ---------- Backend calls ----------
async function api(path, body) {
  const controller = new AbortController();
  requests.add(controller);
  try {
    const res = await fetch(path, {method: 'POST', signal: controller.signal, headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token.trim()}`}, body: JSON.stringify(body)});
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) { const e = new Error(data?.detail || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return data;
  } finally { requests.delete(controller); }
}
async function refreshStatus() {
  const revision = sessionRevision, controller = new AbortController();
  requests.add(controller);
  let next;
  try { const r = await fetch('/api/agent/status', {signal: controller.signal, headers: {Accept: 'application/json'}}); next = r.ok ? await r.json() : {error: `HTTP ${r.status}`}; }
  catch { next = {error: 'offline'}; }
  finally { requests.delete(controller); }
  if (revision !== sessionRevision) return;
  status = next;
  const el = document.querySelector('#agent-status');
  if (el) el.innerHTML = statusHTML();
}
function statusHTML() {
  if (!status) return `${badge(T('Checking live AI…'), 'neutral')}`;
  if (status.error) return `${badge(T('Live AI unavailable'), 'amber')}<small>${T('The backend is not reachable. Answers come from the record only.')}</small>`;
  if (!status.configured) return `${badge(T('Live AI off'), 'amber')}<small>${T('The server has no Gemini key. Answers come from the record only.')}</small>`;
  return `${badge(T('Live AI on'))}<small translate="no">${esc(status.chatModel)} · CT: ${esc(status.visionModel)} (${esc(status.ctInput)})</small>`;
}

// ---------- Offline answers (no AI): straight from the record ----------
function offline(kind, id, reason) {
  const r = window.candexReport.build(id, {lang: lang(), skipApproval: true});
  const ctx = Object.fromEntries(r.context);
  const head = `${T('Live AI unavailable')}${reason ? ` (${reason})` : ''}. ${T('This answer is assembled from the record without AI.')}`;
  if (kind === 'draft') return {type: 'draft', text: `${head}`, data: {kind: 'template', draft: [r.impression.bottomLine, '', ...r.impression.bullets.map(b => `• ${b}`), '', ...r.impression.recs.map((x, i) => `${i + 1}. ${x}`)].join('\n'), review: null, offline: true}};
  const lines = [r.impression.bottomLine, ...Object.entries(ctx).filter(([k]) => /symptom|Family|Smoking/i.test(k) || /oire|Suku|Tupak/i.test(k)).map(([k, v]) => `${k}: ${v}`), `${r.pathway.at(-1)[0]}: ${r.pathway.at(-1)[1]}`];
  return {type: 'offline', text: `${head}\n\n${lines.join('\n')}`};
}

// ---------- Rendering ----------
const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`?\[([^\]\n]{2,40})\]`?/g, '<span class="agent-cite">$1</span>').replace(/\n/g, '<br>');
function messageHTML(m, i, id) {
  if (m.role === 'user') return `<div class="agent-msg is-user"><p translate="no">${esc(m.text)}</p></div>`;
  if (m.type === 'thinking') return `<div class="agent-msg is-agent is-thinking" role="status"><p>${T(m.text)}</p></div>`;
  if (m.type === 'error') return `<div class="agent-msg is-agent is-error" role="alert"><p>${esc(m.text)}</p></div>`;
  if (m.type === 'draft') {
    const d = m.data, rv = d.review;
    const title = {referral: 'Referral note', patient: 'Message to the patient', mdt: 'MDT case summary', template: 'Record summary (no AI)'}[d.kind] || 'Draft';
    return `<div class="agent-msg is-agent is-draft"><div class="agent-draft-head"><strong>${T('Draft')}: ${T(title)}</strong>${rv ? badge(`${T('Safety reviewer')}: ${T(rv.verdict)}`, rv.verdict === 'ready for clinician review' ? '' : 'amber') : badge(T('Not reviewed'), 'neutral')}</div>
${d.offline ? `<p class="agent-note">${esc(m.text)}</p>` : ''}${rv?.issues?.length ? `<ul class="agent-issues">${rv.issues.map(x => `<li translate="no">${esc(x)}</li>`).join('')}</ul>` : ''}
<label class="sr-only" for="agent-draft-${i}">${T('Edit the draft')}</label><textarea id="agent-draft-${i}" class="agent-draft" translate="no" rows="12">${esc(plain(d.draft))}</textarea>
<div class="agent-actions"><small>${T('Draft for clinician review. Edit before use; nothing is sent.')}</small><button type="button" class="text-btn" data-agent-copy="${i}">${icon('file')}${T('Copy')}</button><button type="button" class="text-btn" data-agent-note="${i}">${icon('arrow')}${T('Add to referral note')}</button></div></div>`;
  }
  if (m.type === 'ct') {
    const r = m.data.read, c = caseOf(id), A = window.candexAi, ag = c && A ? A.agreement(c, r) : null;
    const V = {agrees: ['Agrees with radiologists', ''], partly: ['Partly agrees with radiologists', 'amber'], disagrees: ['Disagrees with radiologists', 'amber']}[ag?.verdict] || ['', 'neutral'];
    return `<div class="agent-msg is-agent is-ct"><div class="agent-draft-head"><strong>${T('CT read (research)')}</strong>${ag ? badge(T(V[0]), V[1]) : ''}</div>
<p translate="no">${r.nodule_present ? `${esc(cap(r.location.side))} · ${esc(r.location.lobe)} · ${r.long_axis_mm ?? '—'}${r.short_axis_mm != null ? ` × ${r.short_axis_mm}` : ''} mm · ${esc(r.composition)} · Lung-RADS ${esc(r.lung_rads)}${r.slice != null ? ` · ${T('slice')} ${r.slice + 1}` : ''}` : esc(T('No nodule reported.'))} · ${T('confidence')} ${Math.round(r.confidence * 100)} % (${T('not calibrated')})</p>
${ag ? `<p class="agent-note" translate="no">${T('Radiologists')}: ${esc(cap(ag.refSide))} · ${ag.refDiameter} mm · Lung-RADS ${esc(ag.ref)}${ag.wrongSide ? ` · ${esc(T('AI reported a finding on the other side; the radiologists’ nodule was not found.'))}` : ''}</p>` : ''}
${r.answer ? `<p translate="no"><strong>${T('Answer')}:</strong> ${esc(r.answer)}</p>` : ''}<details><summary>${T('AI report text')}</summary><p translate="no">${esc(r.short_report)}</p></details>
<p class="agent-note" translate="no">${esc(m.data.model)} · ${esc(m.data.input)}. ${esc(T('Research read: not a diagnosis; not used for urgency or recommendations.'))}</p></div>`;
  }
  return `<div class="agent-msg is-agent${m.type === 'offline' ? ' is-offline' : ''}"><p translate="no">${fmt(m.text)}</p></div>`;
}
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '—');
// Drafts go into a plain-text box: drop Markdown emphasis and rules, use bullets.
const plain = s => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*\*\*\*\s*$/gm, '').replace(/^(\s*)[*-]\s+/gm, '$1• ').replace(/`(\[[^\]]+\])`/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
function drawLog() {
  const id = pid(), el = document.querySelector('#agent-log');
  if (!el) return;
  const items = log(id);
  el.innerHTML = items.length ? items.map((m, i) => messageHTML(m, i, id)).join('') : `<div class="agent-empty">${icon('sparkle')}<p>${T('Ask about this patient, draft a document, or run a CT read. Answers use only the record shown on the left and cite where each fact comes from.')}</p></div>`;
  el.scrollTop = el.scrollHeight;
  document.querySelectorAll('.agent-chat button, #agent-input').forEach(b => { b.disabled = busy; });
}

function view() {
  const id = pid(), p = patients.find(x => x.id === id), c = caseOf(id), rec = record(id);
  const revision = sessionRevision;
  setTimeout(() => { if (revision !== sessionRevision) return; if (!status) refreshStatus(); drawLog(); }, 0);
  const prompts = ['Summarise this patient in three lines.', 'What is the urgency, and which findings drive it?', 'What is missing from the record before referral?', 'How does the AI second read compare with the radiologists?'];
  return `${demoNotice('Clinical agent (research prototype): fictional patients, public research CT. Answers and drafts must be checked by a clinician; nothing is sent.')}
<div class="agent-layout"><aside class="stack">
<section class="card agent-side"><div class="card-head"><h2>Clinical agent</h2>${badge('Research', 'amber')}</div>
<div class="field"><label for="agent-patient">${icon('users')}Patient</label><select id="agent-patient">${patients.map(x => `<option value="${esc(x.id)}" ${x.id === id ? 'selected' : ''}>${esc(x.name)} · ${esc(x.id)} · ${esc(T(x.type))}</option>`).join('')}</select></div>
<div class="agent-status" id="agent-status" aria-live="polite">${statusHTML()}</div>
${tokenDrop('agent-token')}
<details class="agent-drop"><summary>How it works</summary><ul class="agent-how">
<li><strong>Tools:</strong> one agent calls specialist tools: the patient record and a Gemini CT read of the linked study.</li>
<li><strong>Review roles:</strong> each draft is written by a drafter, then checked against the record by a separate safety reviewer.</li>
<li><strong>Grounded:</strong> answers use only this record, cite sections, and say “not recorded” instead of guessing. Urgency is never changed.</li></ul></details>
<details class="agent-drop"><summary>What the agent can see</summary><ul class="agent-sees">${SECTIONS.map(s => `<li class="${rec[s] ? '' : 'is-off'}">${icon(rec[s] ? 'check' : 'close')}${T(s)}</li>`).join('')}</ul>
<p class="field-note">${c ? `${T('CT study')}: <span translate="no">${esc(c.id)}</span>` : T('No CT study linked. Link one in Imaging review to enable the CT read.')}</p></details></section></aside>
<section class="card agent-chat" aria-labelledby="agent-title"><div class="card-head"><div><h2 id="agent-title" translate="no">${esc(p.name)} · ${esc(p.id)}</h2><p class="subhead">${esc(T(p.type))} · ${esc(T(p.reason))}</p></div><button type="button" class="text-btn" data-agent-clear>${T('Clear conversation')}</button></div>
<div class="agent-log" id="agent-log" aria-live="polite"></div>
<div class="agent-prompts">${prompts.map(q => `<button type="button" class="agent-chip" data-agent-ask="${esc(q)}">${T(q)}</button>`).join('')}</div>
<div class="agent-tools"><button type="button" class="button secondary" data-agent-draft="referral">${icon('file')}Draft referral note</button><button type="button" class="button secondary" data-agent-draft="patient">${icon('chat')}Draft patient message</button><button type="button" class="button secondary" data-agent-draft="mdt">${icon('users')}Draft MDT summary</button><button type="button" class="button secondary" data-agent-ct ${c ? '' : 'disabled'}>${icon('scan')}Run CT read</button></div>
<form id="agent-form" class="agent-form"><label class="sr-only" for="agent-input">Ask the clinical agent</label><textarea id="agent-input" rows="2" maxlength="1500" translate="no" placeholder="${esc(T('Ask about this patient… (Enter to send, Shift+Enter for a new line)'))}"></textarea><button class="button" type="submit">${icon('arrow')}Send</button></form>
<p class="field-note">General-purpose AI, unvalidated: it can be wrong. The clinician decides. Do not enter real patient data.</p></section></div>`;
}

// ---------- Actions ----------
async function run(kind, payload) {
  const revision = sessionRevision;
  const id = pid();
  if (busy) return;
  if (kind !== 'ct' && !token.trim() && status?.configured) { toast('Paste the backend token first.'); openToken('#agent-token'); return; }
  busy = true;
  const items = log(id);
  if (payload.userText) items.push({role: 'user', text: payload.userText});
  items.push({role: 'model', type: 'thinking', text: kind === 'ct' ? 'Reading the CT…' : kind === 'draft' ? 'Drafting, then reviewing…' : 'Thinking…'});
  drawLog();
  let reply;
  try {
    if (!status?.configured) throw Object.assign(new Error(status?.error ? 'backend not reachable' : 'no Gemini key on the server'), {status: 503});
    if (kind === 'chat') {
      const history = items.filter(m => m.role === 'user' || (m.role === 'model' && ['text', undefined].includes(m.type))).slice(-12).map(m => ({role: m.role, text: String(m.text).slice(0, 4000)}));
      const out = await api('/api/agent/chat', {lang: lang(), record: record(id), messages: history});
      reply = {role: 'model', type: 'text', text: out.text || T('No answer.')};
    } else if (kind === 'draft') {
      const out = await api('/api/agent/draft', {lang: lang(), record: record(id), kind: payload.kind});
      reply = {role: 'model', type: 'draft', data: {kind: payload.kind, draft: out.draft, review: out.review}};
    } else {
      const c = caseOf(id);
      const out = await api('/api/agent/analyze-ct', {caseId: c.id, question: payload.question || ''});
      reply = {role: 'model', type: 'ct', data: out};
    }
  } catch (e) {
    if (revision !== sessionRevision) return;
    if (e.status === 401) reply = {role: 'model', type: 'error', text: T('The backend token is missing or wrong. Paste the token printed by python -m backend.')};
    else if (kind === 'ct') {
      const pre = window.candexAi?.read(caseOf(id)?.id);
      reply = pre ? {role: 'model', type: 'ct', data: {read: pre, model: `${window.candexAi.provenance()?.model || 'precomputed'} (precomputed)`, input: T('Live AI unavailable; showing the precomputed research read')}} : {role: 'model', type: 'error', text: `${T('Live AI unavailable')}: ${e.message}`};
    } else reply = {role: 'model', ...offline(kind, id, e.message)};
  }
  if (revision !== sessionRevision) return;
  items.pop();
  items.push(reply);
  busy = false;
  drawLog();
}

document.addEventListener('submit', e => {
  if (e.target.id !== 'agent-form') return;
  e.preventDefault(); e.stopImmediatePropagation();
  const input = document.querySelector('#agent-input'), text = input.value.trim();
  if (!text) return;
  input.value = '';
  run('chat', {userText: text});
}, true);
document.addEventListener('keydown', e => {
  if (e.target.id === 'agent-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.querySelector('#agent-form')?.requestSubmit(); }
});
document.addEventListener('input', e => { if (e.target.id === 'agent-token') setToken(e.target.value); });
document.addEventListener('change', e => {
  if (e.target.id === 'agent-patient') { selected = e.target.value; state.selected = selected; render(); }
});
document.addEventListener('click', e => {
  const t = e.target.closest?.('[data-agent-ask],[data-agent-draft],[data-agent-ct],[data-agent-copy],[data-agent-note],[data-agent-clear]');
  if (!t) return;
  if (t.dataset.agentAsk) run('chat', {userText: T(t.dataset.agentAsk)});
  else if (t.dataset.agentDraft) run('draft', {kind: t.dataset.agentDraft, userText: `${T('Draft')}: ${T({referral: 'Referral note', patient: 'Message to the patient', mdt: 'MDT case summary'}[t.dataset.agentDraft])}`});
  else if (t.hasAttribute('data-agent-ct')) run('ct', {userText: T('Run a CT read of the linked study.')});
  else if (t.dataset.agentCopy) { const v = document.querySelector(`#agent-draft-${t.dataset.agentCopy}`)?.value || ''; navigator.clipboard?.writeText(v).then(() => toast('Draft copied.'), () => toast('Copy failed; select the text instead.')); }
  else if (t.dataset.agentNote) { const v = document.querySelector(`#agent-draft-${t.dataset.agentNote}`)?.value || ''; window.candexReport?.setNote?.(v); toast(v.length > 800 ? 'Added to the referral note (first 800 characters). Open Reports to review it.' : 'Added to the referral note. Open Reports to review it.'); }
  else if (t.hasAttribute('data-agent-clear')) { convo[pid()] = []; drawLog(); }
});

window.candexI18n?.extend?.({
  'Research prototype. The agents use Gemini through your local backend, on fictional patients, synthetic statistics and public research images; the Candex guide runs a small open-source model in your browser. Outputs are unvalidated and never set urgency or decisions.': 'Tutkimusprototyyppi. Agentit käyttävät Geminiä paikallisen palvelimesi kautta kuvitteellisille potilaille, synteettisille tilastoille ja julkisille tutkimuskuville; Candex-opas ajaa pientä avoimen lähdekoodin mallia selaimessasi. Tulokset ovat validoimattomia, eivätkä ne koskaan määritä kiireellisyyttä tai päätöksiä.',
  'Clinical agent': 'Kliininen agentti', 'Research': 'Tutkimus', 'Backend token': 'Taustapalvelun tunniste',
  'Paste the token printed by python -m backend': 'Liitä python -m backend -komennon tulostama tunniste',
  'Kept in this page’s memory only. The Gemini key stays on the server.': 'Säilyy vain tämän sivun muistissa. Gemini-avain pysyy palvelimella.',
  'What the agent can see': 'Mitä agentti näkee', 'How it works': 'Miten se toimii',
  'Tools:': 'Työkalut:', 'one agent calls specialist tools: the patient record and a Gemini CT read of the linked study.': 'yksi agentti käyttää erikoistyökaluja: potilastietoja ja linkitetyn TT-kuvan Gemini-luentaa.',
  'Review roles:': 'Tarkistusroolit:', 'each draft is written by a drafter, then checked against the record by a separate safety reviewer.': 'kirjoittaja laatii jokaisen luonnoksen, ja erillinen turvallisuustarkastaja tarkistaa sen potilastietoja vasten.',
  'Grounded:': 'Perusteltu:', 'answers use only this record, cite sections, and say “not recorded” instead of guessing. Urgency is never changed.': 'vastaukset perustuvat vain näihin potilastietoihin, viittaavat osioihin ja kertovat ”ei kirjattu” arvaamisen sijaan. Kiireellisyyttä ei koskaan muuteta.',
  'Checking live AI…': 'Tarkistetaan tekoälyyhteyttä…', 'Live AI unavailable': 'Tekoäly ei käytettävissä', 'Live AI off': 'Tekoäly pois päältä', 'Live AI on': 'Tekoäly käytössä',
  'The backend is not reachable. Answers come from the record only.': 'Taustapalveluun ei saada yhteyttä. Vastaukset koostetaan vain potilastiedoista.',
  'The server has no Gemini key. Answers come from the record only.': 'Palvelimella ei ole Gemini-avainta. Vastaukset koostetaan vain potilastiedoista.',
  'This answer is assembled from the record without AI.': 'Tämä vastaus on koottu potilastiedoista ilman tekoälyä.',
  'Imaging technique': 'Kuvantamistekniikka', 'Structured findings': 'Jäsennellyt löydökset', 'AI second reader': 'Tekoäly toisena lukijana', 'Impression': 'Johtopäätökset', 'Care pathway': 'Hoitopolku', 'Clinical context': 'Kliininen tausta', 'Patient': 'Potilas',
  'CT study': 'TT-tutkimus', 'No CT study linked. Link one in Imaging review to enable the CT read.': 'TT-tutkimusta ei ole linkitetty. Linkitä se kuvantamisen arviossa ottaaksesi TT-luennan käyttöön.',
  'Clear conversation': 'Tyhjennä keskustelu', 'Draft referral note': 'Luonnostele lähete', 'Draft patient message': 'Luonnostele viesti potilaalle', 'Draft MDT summary': 'Luonnostele MDT-yhteenveto', 'Run CT read': 'Aja TT-luenta',
  'Ask about this patient… (Enter to send, Shift+Enter for a new line)': 'Kysy tästä potilaasta… (Enter lähettää, Shift+Enter uusi rivi)', 'Send': 'Lähetä', 'Ask the clinical agent': 'Kysy kliiniseltä agentilta',
  'General-purpose AI, unvalidated: it can be wrong. The clinician decides. Do not enter real patient data.': 'Yleiskäyttöinen, validoimaton tekoäly voi olla väärässä. Lääkäri päättää. Älä syötä oikeita potilastietoja.',
  'Summarise this patient in three lines.': 'Tiivistä tämä potilas kolmeen riviin.', 'What is the urgency, and which findings drive it?': 'Mikä on kiireellisyys ja mitkä löydökset vaikuttavat siihen?',
  'What is missing from the record before referral?': 'Mitä potilastiedoista puuttuu ennen lähetettä?', 'How does the AI second read compare with the radiologists?': 'Miten tekoälyn luenta vertautuu radiologeihin?',
  'Draft': 'Luonnos', 'Referral note': 'Lähete', 'Message to the patient': 'Viesti potilaalle', 'MDT case summary': 'MDT-tapausyhteenveto', 'Record summary (no AI)': 'Yhteenveto potilastiedoista (ei tekoälyä)',
  'Safety reviewer': 'Turvallisuustarkastaja', 'ready for clinician review': 'valmis lääkärin tarkistettavaksi', 'needs changes': 'vaatii muutoksia', 'Not reviewed': 'Ei tarkastettu',
  'Edit the draft': 'Muokkaa luonnosta', 'Draft for clinician review. Edit before use; nothing is sent.': 'Luonnos lääkärin tarkistettavaksi. Muokkaa ennen käyttöä; mitään ei lähetetä.',
  'Copy': 'Kopioi', 'Add to referral note': 'Lisää lähetteen huomioon', 'CT read (research)': 'TT-luenta (tutkimus)', 'slice': 'leike', 'confidence': 'varmuus', 'not calibrated': 'ei kalibroitu',
  'No nodule reported.': 'Pesäkettä ei ilmoitettu.', 'Radiologists': 'Radiologit', 'Answer': 'Vastaus', 'AI report text': 'Tekoälyn raporttiteksti',
  'Research read: not a diagnosis; not used for urgency or recommendations.': 'Tutkimusluenta: ei diagnoosi; ei käytetä kiireellisyyteen tai suosituksiin.',
  'Ask about this patient, draft a document, or run a CT read. Answers use only the record shown on the left and cite where each fact comes from.': 'Kysy potilaasta, luonnostele asiakirja tai aja TT-luenta. Vastaukset perustuvat vain vasemmalla näkyviin tietoihin ja kertovat lähteensä.',
  'Reading the CT…': 'Luetaan TT-kuvaa…', 'Drafting, then reviewing…': 'Luonnostellaan ja tarkastetaan…', 'Thinking…': 'Mietitään…', 'No answer.': 'Ei vastausta.',
  'The backend token is missing or wrong. Paste the token printed by python -m backend.': 'Taustapalvelun tunniste puuttuu tai on väärä. Liitä python -m backend -komennon tulostama tunniste.',
  'Live AI unavailable; showing the precomputed research read': 'Tekoäly ei käytettävissä; näytetään valmiiksi laskettu tutkimusluenta', 'Run a CT read of the linked study.': 'Aja TT-luenta linkitetystä tutkimuksesta.',
  'Paste the backend token first.': 'Liitä ensin taustapalvelun tunniste.', 'Draft copied.': 'Luonnos kopioitu.', 'Copy failed; select the text instead.': 'Kopiointi epäonnistui; valitse teksti.',
  'Added to the referral note. Open Reports to review it.': 'Lisätty lähetteen huomioon. Tarkista se Raportit-sivulla.', 'Added to the referral note (first 800 characters). Open Reports to review it.': 'Lisätty lähetteen huomioon (ensimmäiset 800 merkkiä). Tarkista se Raportit-sivulla.',
  'Clinical agent (research prototype): fictional patients, public research CT. Answers and drafts must be checked by a clinician; nothing is sent.': 'Kliininen agentti (tutkimusprototyyppi): kuvitteelliset potilaat, julkinen tutkimus-TT. Lääkärin on tarkistettava vastaukset ja luonnokset; mitään ei lähetetä.',
  'Open-source agents behind these ideas': 'Ideoiden taustalla olevat avoimen lähdekoodin agentit',
});

// One backend token for the whole page (clinical agent and DICOM page).
const getToken = () => token;
// The backend token field, as a drop-down (closed by default; opened when needed).
const tokenState = () => (token.trim() ? T('Set') : T('Not set'));
function tokenDrop(id, hint = 'Kept in this page’s memory only. The Gemini key stays on the server.') {
  return `<details class="agent-drop token-drop"><summary>${icon('lock')}<span>${T('Backend token')}</span><span class="token-state${token.trim() ? ' is-set' : ''}">${tokenState()}</span></summary>
<div class="field"><label class="sr-only" for="${id}">${T('Backend token')}</label><input id="${id}" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(T('Paste the token printed by python -m backend'))}" value="${esc(token)}"><small>${T(hint)}</small></div></details>`;
}
function openToken(sel) { const el = document.querySelector(sel); el?.closest?.('details')?.setAttribute?.('open', ''); el?.focus?.(); }
const setToken = v => {
  token = String(v ?? '');
  for (const el of document.querySelectorAll('#agent-token, #q-token')) if (el.value !== token) el.value = token;
  for (const el of document.querySelectorAll('.token-drop .token-state')) { el.textContent = tokenState(); el.classList.toggle('is-set', !!token.trim()); }
};
window.candexAgent = {view, record, refreshStatus, resetSession, plain, run, getToken, setToken, tokenDrop, openToken, _convo: convo, _setStatus: v => { status = v; }};
})();
