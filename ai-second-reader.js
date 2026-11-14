// AI second reader (research): precomputed Gemini reads of the 5 public
// LIDC-IDRI CT studies (data/lidc/ai-reads.js, exported by
// candex-data/export_ai_reads.py). The browser never calls an AI service and no
// API key is involved. Reads are shown next to the radiologists' reference as
// a research comparison: they never set urgency, the bottom line or
// recommendations. Loaded after data/lidc/cases.js and data/lidc/ai-reads.js,
// before imaging.js and referral-report.js; uses esc, badge, icon at call time.
(() => {
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const ORDER = ['1', '2', '3', '4A', '4B', '4X'];
const norm = b => String(b ?? '').replace('-like', '');
const data = () => window.candexAiReads || null;

const read = caseId => data()?.cases?.[caseId] || null;
const provenance = () => data()?.provenance || null;

// Centroid of the radiologists' main-nodule outlines on a frame (or the
// nearest frame that has one), in the 384-px coordinates of the excerpt.
function mainCentroid(c, frameIndex = c.centre) {
  const order = [...c.frames.keys()].sort((a, b) => Math.abs(a - frameIndex) - Math.abs(b - frameIndex));
  for (const i of order) {
    const pts = c.frames[i].outlines.filter(o => o.n === 0).flatMap(o => o.pts);
    if (pts.length) return {x: pts.reduce((s, p) => s + p[0], 0) / pts.length, y: pts.reduce((s, p) => s + p[1], 0) / pts.length, frame: i};
  }
  return null;
}
// Is a candidate (x, y in 384 px, frame index) on the radiologists' main nodule?
function onNodule(c, cand, tolPx = 15) {
  if (!cand || cand.x == null || cand.y == null) return null;
  const ref = mainCentroid(c, cand.frame ?? c.centre);
  if (!ref) return null;
  return Math.hypot(cand.x - ref.x, cand.y - ref.y) <= tolPx && Math.abs((cand.frame ?? ref.frame) - ref.frame) <= 2;
}

// Agreement with the radiologists' reference, per criterion and overall.
function agreement(c, r = read(c?.id)) {
  if (!c || !r) return null;
  const main = c.nodules[0];
  const centre = mainCentroid(c);
  const refSide = centre && centre.x < 192 ? 'right' : 'left';
  const detected = !!r.nodule_present;
  const side = detected && r.location?.side === refSide;
  const tol = Math.max(3, 0.25 * main.diameter);
  const size = detected && r.long_axis_mm != null ? Math.abs(r.long_axis_mm - main.diameter) <= tol : false;
  const ref = norm(c.band), ai = norm(r.lung_rads);
  const lrExact = ai === ref;
  const lrNear = ORDER.includes(ai) && ORDER.includes(ref) && Math.abs(ORDER.indexOf(ai) - ORDER.indexOf(ref)) <= 1;
  const cands = Array.isArray(r.candidates) ? r.candidates : [];
  const located = detected && cands.length ? cands.some(cd => onNodule(c, cd)) : null;
  // A finding on the other side is a different finding (false positive), not a hit.
  const wrongSide = detected && !!r.location?.side && r.location.side !== 'not seen' && r.location.side !== refSide;
  const verdict = !detected || wrongSide || located === false ? 'disagrees'
    : side && size && lrNear ? 'agrees'
    : side || lrNear ? 'partly' : 'disagrees';
  return {detected, wrongSide, slice: Number.isInteger(r.slice) ? r.slice : null, side, refSide, size, sizeTol: Math.round(tol * 10) / 10, lrExact, lrNear, ref, ai, located, verdict, refDiameter: main.diameter};
}
const VERDICT = {agrees: ['Agrees with radiologists', ''], partly: ['Partly agrees with radiologists', 'amber'], disagrees: ['Disagrees with radiologists', 'amber']};
const pct = x => (x == null ? '—' : `${Math.round(x * 100)} %`);

// Card on the Imaging review page.
function card(c) {
  const r = read(c.id), prov = provenance();
  if (!r) return `<section class="card ai-card"><div class="card-head"><h2>AI second reader (research)</h2>${badge('Not available', 'neutral')}</div><p class="field-note">AI read not available for this study.</p></section>`;
  const a = agreement(c, r), [label, kind] = VERDICT[a.verdict];
  const mark = ok => (ok ? '✓' : '✗');
  const lines = [
    ['Nodule found', `${r.nodule_present ? T('Yes') : T('No')} ${mark(a.detected)}`],
    ['Side · lobe', r.nodule_present ? `${T(cap(r.location?.side))} · ${T(r.location?.lobe || '—')} ${mark(a.side)}` : '—'],
    ['Size: AI vs radiologists', r.nodule_present && r.long_axis_mm != null ? `${r.long_axis_mm} vs ${a.refDiameter} mm ${mark(a.size)}` : `— vs ${a.refDiameter} mm`],
    ['Lung-RADS: AI vs reference', `${a.ai || '—'} vs ${a.ref} ${a.lrExact ? '✓' : a.lrNear ? '≈' : '✗'}`],
    ['Composition', r.composition ? T(r.composition) : '—'],
    ['Model confidence (not calibrated)', pct(r.confidence)],
  ];
  if (a.slice !== null) lines.push(['AI slice · radiologists’ key slice', `${a.slice + 1} · ${(mainCentroid(c)?.frame ?? c.centre) + 1} / ${c.frames.length}`]);
  if (r.votes?.of) lines.push(['Runs that agree', `${r.votes.agree} / ${r.votes.of}`]);
  if (a.located !== null) lines.push(['Marker on the radiologists’ nodule', a.located ? T('Yes') : T('No')]);
  const miss = !r.nodule_present ? `<div class="notice ai-miss"><strong>AI reported no nodule; radiologists marked one.</strong></div>`
    : a.wrongSide ? `<div class="notice ai-miss"><strong>AI reported a finding on the other side; the radiologists’ nodule was not found.</strong></div>` : '';
  const hasMarker = Array.isArray(r.candidates) && r.candidates.some(cd => cd.x != null);
  return `<section class="card ai-card"><div class="card-head"><h2>AI second reader (research)</h2>${badge(label, kind)}</div>
<p class="field-note">Precomputed read, not live. Not a diagnosis; not used for urgency or recommendations.</p>${miss}
${lines.map(([k, v]) => `<div class="data-line"><span>${k}</span><strong translate="no">${esc(v)}</strong></div>`).join('')}
${r.short_report ? `<details class="ai-report"><summary>AI report text</summary><p translate="no">${esc(r.short_report)}</p></details>` : ''}
${prov ? `<p class="field-note ai-prov" translate="no">${esc(`${prov.model} · ${prov.generated} · ${prov.input}${prov.runs > 1 ? ` · ${prov.runs} runs` : ''}${prov.leaderboard?.found ? ` · found ${prov.leaderboard.found} on the correct side in these studies` : ''}`)}</p>` : ''}
${hasMarker ? '' : '<p class="field-note">This read has no position on the image, so no AI marker is drawn.</p>'}</section>`;
}
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '—');

// Dashed amber circles where the AI placed its finding on this frame.
function markerSVG(c, frameIndex) {
  const r = read(c?.id);
  if (!r || !Array.isArray(r.candidates)) return '';
  return r.candidates.filter(cd => cd.x != null && cd.y != null && (cd.frame == null || Math.abs(cd.frame - frameIndex) <= 1))
    .map(cd => `<circle cx="${+cd.x}" cy="${+cd.y}" r="16" class="ct-ai"/><text x="${+cd.x + 18}" y="${+cd.y - 14}" class="ct-ai-label">AI</text>`).join('');
}
const hasMarkers = c => Array.isArray(read(c?.id)?.candidates) && read(c.id).candidates.some(cd => cd.x != null);

window.candexI18n?.extend?.({
  'AI second reader (research)': 'Tekoäly toisena lukijana (tutkimus)',
  'Agrees with radiologists': 'Yhtäpitävä radiologien kanssa', 'Partly agrees with radiologists': 'Osittain yhtäpitävä radiologien kanssa', 'Disagrees with radiologists': 'Eriävä radiologien kanssa',
  'Not available': 'Ei saatavilla', 'AI read not available for this study.': 'Tekoälyluentaa ei saatavilla tälle tutkimukselle.',
  'Precomputed read, not live. Not a diagnosis; not used for urgency or recommendations.': 'Valmiiksi laskettu luenta, ei reaaliaikainen. Ei diagnoosi; ei vaikuta kiireellisyyteen tai suosituksiin.',
  'AI reported no nodule; radiologists marked one.': 'Tekoäly ei löytänyt pesäkettä; radiologit merkitsivät sen.',
  'Nodule found': 'Pesäke löytyi', 'Side · lobe': 'Puoli · lohko', 'Size: AI vs radiologists': 'Koko: tekoäly vs radiologit', 'Lung-RADS: AI vs reference': 'Lung-RADS: tekoäly vs viite',
  'Composition': 'Rakenne', 'Model confidence (not calibrated)': 'Mallin varmuus (ei kalibroitu)', 'Runs that agree': 'Yhtäpitävät ajot', 'Marker on the radiologists’ nodule': 'Merkintä radiologien pesäkkeessä',
  'AI report text': 'Tekoälyn raporttiteksti',
  'Approx. Lung-RADS': 'Arvioitu Lung-RADS', 'AI read': 'tekoälyluenta',
  'AI reported a finding on the other side; the radiologists’ nodule was not found.': 'Tekoäly ilmoitti löydöksen toisella puolella; radiologien pesäkettä se ei löytänyt.',
  'AI slice · radiologists’ key slice': 'Tekoälyn leike · radiologien avainleike',
  'Images: LIDC-IDRI, The Cancer Imaging Archive (CC BY 3.0), doi:10.7937/K9/TCIA.2015.LO9QL9SX. Armato SG III et al., Medical Physics 2011;38(2):915–931; Clark K et al., J Digit Imaging 2013. Excerpt of 11 slices, lung window, resized to 384 px. Prototype for research use only: not a medical device, not CE-marked.': 'Kuvat: LIDC-IDRI, The Cancer Imaging Archive (CC BY 3.0), doi:10.7937/K9/TCIA.2015.LO9QL9SX. Armato SG III ym., Medical Physics 2011;38(2):915–931; Clark K ym., J Digit Imaging 2013. Ote 11 leikkeestä, keuhkoikkuna, pienennetty 384 pikseliin. Vain tutkimuskäyttöön tarkoitettu prototyyppi: ei lääkinnällinen laite, ei CE-merkitty.', 'Show AI marker': 'Näytä tekoälyn merkintä',
  'This read has no position on the image, so no AI marker is drawn.': 'Luennassa ei ole sijaintia kuvassa, joten tekoälyn merkintää ei piirretä.',
  'Right': 'Oikea', 'Left': 'Vasen', 'Not seen': 'Ei nähty', 'upper': 'ylälohko', 'middle': 'keskilohko', 'lower': 'alalohko', 'lingula': 'lingula', 'uncertain': 'epävarma',
  'solid': 'kiinteä', 'part-solid': 'osittain kiinteä', 'ground-glass': 'mattalasimainen', 'calcified': 'kalkkeutunut', 'not applicable': 'ei sovellu',
});

window.candexAi = {read, provenance, agreement, card, markerSVG, hasMarkers, onNodule, mainCentroid, norm};
})();
