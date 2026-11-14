// Candex patient summary & oncology referral report (Doctor → Reports).
// Builds one structured report from the data the demo already holds:
//   worklist patient · health check (screening.js) · linked LIDC-IDRI CT and
//   radiologist outlines (imaging.js, data/lidc/cases.js) · referral journey
//   (referral-store.js, Aino only). Renders an on-page preview and a PDF,
//   in English or Finnish.
// The framework (docs/oncology-referral-framework.md) adapts an oncology
// follow-up template to a pre-diagnostic referral with one baseline CT.
// Nothing here is a validated clinical tool; every report is an unsigned draft.
// Loaded before app.js; uses its helpers (patients, state, esc, badge, icon,
// toast, navigate) at call time.
(() => {
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
const SERVICES = ['Pulmonology / lung cancer MDT', 'Oncology MDT', 'Breast clinic', 'Gastroenterology / colorectal surgery', 'Urology', 'Dermatology', 'Primary care review'];
const AUTO_SERVICE = {Lung: 'Pulmonology / lung cancer MDT', Breast: 'Breast clinic', Colorectal: 'Gastroenterology / colorectal surgery', Prostate: 'Urology', Skin: 'Dermatology'};
let selectedId = null, service = 'auto', note = '', reportLang = null;

// ---------- Language ----------
// t('English', 'Suomi') picks the report language; V() translates stored
// English answers (symptoms, regions, options) through the site dictionary.
let lang = 'en';
const t = (en, fi) => (lang === 'fi' ? fi : en);
const V = s => (lang === 'fi' && s != null && window.candexI18n?.lookup ? window.candexI18n.lookup(String(s)) : s);
const currentLang = () => reportLang || (window.candexI18n?.lang === 'fi' ? 'fi' : 'en');

const lungRads = band => ({
  '2': {meaning: t('benign appearance or behaviour', 'hyvänlaatuinen ulkonäkö tai käyttäytyminen'), action: t('Continue annual low-dose CT (LDCT) screening.', 'Jatka vuosittaista pieniannoksista TT-seulontaa (LDCT).'), level: 'routine'},
  '3': {meaning: t('probably benign', 'todennäköisesti hyvänlaatuinen'), action: t('LDCT in 6 months.', 'Pieniannoksinen TT 6 kuukauden kuluttua.'), level: 'routine'},
  '4A': {meaning: t('suspicious', 'epäilyttävä'), action: t('LDCT in 3 months; PET/CT may be used when the solid component is 8 mm or more.', 'Pieniannoksinen TT 3 kuukauden kuluttua; PET-TT:tä voidaan käyttää, kun kiinteä osa on vähintään 8 mm.'), level: 'soon'},
  '4B': {meaning: t('very suspicious', 'hyvin epäilyttävä'), action: t('Diagnostic chest CT with contrast, PET/CT and/or tissue sampling, depending on the probability of cancer; discuss at the lung cancer MDT.', 'Diagnostinen varjoainetehosteinen keuhkojen TT, PET-TT ja/tai kudosnäyte syövän todennäköisyyden mukaan; käsittely keuhkosyövän moniammatillisessa kokouksessa.'), level: 'urgent'},
  '4X-like': {meaning: t('very suspicious, with additional features (large, spiculated, high reader malignancy rating)', 'hyvin epäilyttävä, lisäpiirteitä (suuri, spikuloitunut, korkea pahanlaatuisuusarvio)'), action: t('As 4B: diagnostic chest CT with contrast, PET/CT and/or tissue sampling; discuss at the lung cancer MDT.', 'Kuten 4B: diagnostinen varjoainetehosteinen keuhkojen TT, PET-TT ja/tai kudosnäyte; käsittely keuhkosyövän moniammatillisessa kokouksessa.'), level: 'urgent'},
})[band];
const malignancy = n => [null, t('highly unlikely', 'erittäin epätodennäköinen'), t('moderately unlikely', 'melko epätodennäköinen'), t('indeterminate', 'epäselvä'), t('moderately suspicious', 'melko epäilyttävä'), t('highly suspicious', 'erittäin epäilyttävä')][Math.round(n)] || '';
// LIDC texture 1-5: 1 = ground-glass (non-solid), 3 = part-solid, 5 = solid.
const composition = x => (x >= 4 ? t('solid', 'kiinteä') : x >= 2 ? t('part-solid', 'osittain kiinteä') : t('ground-glass', 'mattalasimainen'));
const urgencyText = level => ({urgent: t('Urgent (suspected cancer)', 'Kiireellinen (syöpäepäily)'), soon: t('Soon (within 2 weeks)', 'Pian (2 viikon sisällä)'), routine: t('Routine', 'Ei kiireellinen')})[level];

// ---------- Geometry from the radiologists' outlines ----------
// Outlines are stored at 384 px (exported from 512 px slices).
function axes(pts) {
  let best = 0, a = pts[0], b = pts[0];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if (d > best) { best = d; a = pts[i]; b = pts[j]; }
  }
  const ux = best ? (b[0] - a[0]) / best : 1, uy = best ? (b[1] - a[1]) / best : 0;
  const proj = pts.map(p => -uy * p[0] + ux * p[1]);
  return {long: best, short: Math.max(...proj) - Math.min(...proj), cx: pts.reduce((s, p) => s + p[0], 0) / pts.length, cy: pts.reduce((s, p) => s + p[1], 0) / pts.length};
}
function geometry(c) {
  const mm = c.pixelMm * 512 / 384;
  const withMain = c.frames.map((f, i) => ({i, f, main: f.outlines.filter(o => o.n === 0 && o.pts.length > 2)})).filter(x => x.main.length);
  if (!withMain.length) return null;
  const key = withMain.find(x => x.i === c.centre) || withMain.reduce((a, b) => (b.main.length > a.main.length ? b : a));
  const per = key.main.map(o => axes(o.pts));
  const avg = k => per.reduce((s, x) => s + x[k], 0) / per.length;
  const zs = withMain.map(x => x.f.z);
  const cx = avg('cx'), cy = avg('cy');
  return {
    long: Math.round(avg('long') * mm * 10) / 10, short: Math.round(avg('short') * mm * 10) / 10,
    cc: Math.round((Math.max(...zs) - Math.min(...zs) + c.sliceMm) * 10) / 10,
    truncated: withMain[0].i === 0 || withMain.at(-1).i === c.frames.length - 1,
    // Radiological convention: the image's left side is the patient's right.
    right: cx < 192, anterior: cy < 192,
    frame: key.i, z: key.f.z, cx, cy,
  };
}
const fmtDate = iso => { try { return new Intl.DateTimeFormat(lang === 'fi' ? 'fi-FI' : 'en-GB', {day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki'}).format(new Date(iso)); } catch { return iso || ''; } };
const num = x => (lang === 'fi' ? String(x).replace('.', ',') : String(x));

// ---------- Clinician approval ----------
// A demonstration approval, not a legal e-signature. Each approval stores a
// fingerprint of the report's clinical content in English, so switching the
// report language keeps it, but any change to the content (note, destination,
// health-check answers, linked CT) shows "Changed since approval" until the
// doctor approves it again. Kept for this browser tab (sessionStorage).
const APPROVALS = 'candex-report-approvals';
const CLINICIAN = 'Dr. Emilia Koski';
let approvals = {};
try { approvals = JSON.parse(sessionStorage.getItem(APPROVALS) || '{}') || {}; } catch { approvals = {}; }
const saveApprovals = () => { try { sessionStorage.setItem(APPROVALS, JSON.stringify(approvals)); } catch { /* storage unavailable */ } };
const previewed = {}; // patient id -> fingerprint of the version last previewed
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
// Referral-journey rows change when the approved report is released, so they
// are not part of the clinical content that the approval covers.
const JOURNEY_ROWS = ['Reviewed report', 'Follow-up appointment', 'Follow-up outcome', 'Referral decision'];
function fingerprint(id) {
  const saved = lang;
  try {
    const r = build(id, {lang: 'en', skipApproval: true});
    return hash(JSON.stringify([r.patient, r.pathway.filter(([k]) => !JOURNEY_ROWS.includes(k)), r.context, r.technique, r.findings, r.ai?.rows, window.candexAiReads?.provenance?.promptSha || null, r.cxr ? [r.cxr.summary, r.cxr.rows] : null, r.impression, r.plain]));
  } finally { lang = saved; }
}
function approvalStatus(id) {
  const a = approvals[id];
  if (!a) return {state: 'none'};
  return {...a, state: a.fp === fingerprint(id) ? 'approved' : 'changed'};
}
function markPreviewed(id) { previewed[id] = fingerprint(id); }
function approveNow(id, {release = false} = {}) {
  const p = patients.find(x => x.id === id);
  if (!p) throw new Error('Choose a patient from the worklist.');
  const fp = fingerprint(id);
  if (previewed[id] !== fp) throw new Error('Preview the current report before approving it.');
  const entry = {by: CLINICIAN, at: new Date().toISOString(), fp, version: (approvals[id]?.version || 0) + 1, released: false};
  let releaseError = null;
  if (release) {
    try {
      const r = build(id, {lang: 'en', skipApproval: true}), S = window.CandexReferralStore;
      S.select({id: p.id, name: p.name});
      S.releaseReport({patient: `${p.id} · ${p.name}`, type: `${p.type} pathway`.slice(0, 100), findings: [r.impression.bottomLine, ...r.impression.bullets].join('\n').slice(0, 6000), plan: r.impression.recs.join('\n').slice(0, 6000)}, {role: 'care', approved: true});
      entry.released = true;
    } catch (e) { releaseError = e; }
  }
  approvals[id] = entry; saveApprovals();
  if (releaseError) throw new Error(`Approved, but not released: ${releaseError.message}`);
  return {...entry, state: 'approved'};
}
function withdrawApproval(id) { delete approvals[id]; saveApprovals(); }
// Switches labels, banner, sign-off and the patient wording to the approval state.
function applyApproval(rep) {
  const saved = lang, st = approvalStatus(rep.id);
  lang = rep.lang;
  rep.approval = st;
  const provenance = rep.signoff.at(-1);
  if (st.state === 'approved') {
    rep.labels.banner = t('APPROVED · FICTIONAL PATIENT · DEMONSTRATION', 'HYVÄKSYTTY · KUVITTEELLINEN POTILAS · DEMO');
    rep.labels.draft = t(`Approved · v${st.version}`, `Hyväksytty · v${st.version}`);
    rep.labels.header = t('approved', 'hyväksytty');
    rep.labels.footer = t('Demonstration only. Fictional patient; public research CT. Approved in the Candex demo (not a legal e-signature).', 'Vain demo. Kuvitteellinen potilas; julkinen tutkimus-TT. Hyväksytty Candex-demossa (ei oikeudellinen sähköinen allekirjoitus).');
    rep.signoff = [
      [t('Status', 'Tila'), t(`Approved, version ${st.version}`, `Hyväksytty, versio ${st.version}`)],
      [t('Approved by', 'Hyväksyjä'), `${st.by}, ${fmtDate(st.at)}`],
      [t('Clinician confirmed', 'Lääkäri vahvisti'), t('Patient details, findings and key image reviewed; recommendations, destination and urgency clinically appropriate. AI research comparison reviewed; not used for urgency or recommendations.', 'Potilastiedot, löydökset ja avainkuva tarkistettu; suositukset, kohde ja kiireellisyys kliinisesti asianmukaisia. Tekoälyn tutkimusvertailu tarkistettu; ei käytetty kiireellisyyteen eikä suosituksiin.')],
      ...(st.released ? [[t('Released', 'Julkaistu'), t("To the patient's referral journey (demo portal).", 'Potilaan lähetepolulle (demoportaali).')]] : []),
      provenance,
    ];
    rep.plain = rep.plain
      .replace('This draft has not yet been checked by your doctor, who will explain what it means for you.', 'Your doctor has reviewed this summary and will explain what it means for you.')
      .replace('Lääkäri ei ole vielä tarkistanut tätä luonnosta; hän kertoo, mitä se tarkoittaa sinulle.', 'Lääkärisi on tarkistanut tämän yhteenvedon ja kertoo, mitä se tarkoittaa sinulle.');
  } else if (st.state === 'changed') {
    rep.labels.banner = t('CHANGED SINCE APPROVAL · RE-APPROVAL NEEDED · NOT FOR CLINICAL USE', 'MUUTTUNUT HYVÄKSYNNÄN JÄLKEEN · VAATII UUDEN HYVÄKSYNNÄN · EI KLIINISEEN KÄYTTÖÖN');
    rep.labels.draft = t('Changed since approval', 'Muuttunut hyväksynnän jälkeen');
    rep.signoff = [[t('Status', 'Tila'), t(`Changed after ${st.by} approved version ${st.version}. Approve again before use.`, `Muuttunut sen jälkeen, kun ${st.by} hyväksyi version ${st.version}. Hyväksy uudelleen ennen käyttöä.`)], ...rep.signoff.slice(1)];
  }
  lang = saved;
  return rep;
}

// ---------- Build the report object ----------
function build(id, opts = {}) {
  lang = opts.lang || currentLang();
  const p = patients.find(x => x.id === id) || patients[0];
  const S = window.candexScreening, I = window.candexImaging;
  const h = S?.healthPatient(p.id) || null;
  const r = h ? S.assess(h) : null;
  const caseId = I?.links?.[p.id];
  const c = caseId ? I.CASES[caseId] : null;
  const g = c ? geometry(c) : null;
  const main = c?.nodules?.[0];
  const band = c?.band;
  const lr = band ? lungRads(band) : null;
  const journey = window.CandexReferralStore?.peek?.(p.id) || (p.id === 'CX-1042' ? window.CandexReferralStore?.get?.() : null);
  const nr = t('Not recorded', 'Ei kirjattu');
  const symptoms = r?.symptoms || [];
  const urgentSymptoms = symptoms.filter(s => s.urgent);
  const lower = s => V(s.label).toLowerCase();
  const factorLabels = (r?.factors || []).filter(f => !f.minor).map(f => V(f.label));
  const side = g ? (g.right ? t('right', 'oikea') : t('left', 'vasen')) : '';
  const sideIn = g ? (g.right ? t('right lung', 'oikeassa keuhkossa') : t('left lung', 'vasemmassa keuhkossa')) : '';

  // Urgency follows clinical need only: imaging category and red-flag symptoms.
  const level = lr?.level === 'urgent' || r?.urgent ? 'urgent' : lr?.level === 'soon' || symptoms.length ? 'soon' : 'routine';
  const urgency = urgencyText(level);
  const svcEn = service !== 'auto' ? service : (band === '4B' || band === '4X-like') ? 'Pulmonology / lung cancer MDT' : AUTO_SERVICE[p.type] || 'Primary care review';
  const svc = V(svcEn);

  // 1. Patient & referral details
  const lng = h?.language;
  const patient = [
    [t('Patient reference', 'Potilaan tunniste'), `${p.id} · ${p.name} (${t('fictional demo patient', 'kuvitteellinen demopotilas')})`],
    [t('Age · sex', 'Ikä · sukupuoli'), `${p.age} ${t('years', 'vuotta')} · ${h?.sex ? V(h.sex) : nr}`],
    [t('Wellbeing services county', 'Hyvinvointialue'), V(p.region) || nr],
    [t('Preferred language', 'Asiointikieli'), lng ? `${V(lng)}${['Finnish', 'Swedish', 'English'].includes(lng) ? '' : t(' (arrange an interpreter)', ' (järjestä tulkki)')}` : nr],
    [t('Usual place of care', 'Tavallinen hoitopaikka'), h?.route ? V(h.route) : nr],
    [t('Travel time to health centre', 'Matka-aika terveysasemalle'), h?.travel ? V(h.travel) : nr],
    [t('Contact preference', 'Toivottu yhteydenottotapa'), h?.contact ? V(h.contact) : nr],
    [t('Access support requested', 'Pyydetty tukea hoitoon pääsyyn'), h ? (h.support ? t('Yes: travel, language, technology or cost', 'Kyllä: matkat, kieli, teknologia tai kustannukset') : t('No', 'Ei')) : nr],
    [t('Health check submitted', 'Terveyskysely lähetetty'), h?.submittedAt ? fmtDate(h.submittedAt) : t('No health check on record', 'Ei terveyskyselyä')],
  ];

  // 2. Care pathway
  const latest = journey?.reports?.at(-1), appt = journey?.appointments?.at(-1), fu = journey?.followUps?.at(-1), decision = journey?.decisions?.at(-1);
  const none = t('None recorded', 'Ei kirjattu');
  const pathway = [
    [t('Care pathway', 'Hoitopolku'), lang === 'fi' ? ({Lung: 'Keuhkosyövän hoitopolku', Breast: 'Rintasyövän hoitopolku', Colorectal: 'Suolistosyövän hoitopolku', Prostate: 'Eturauhassyövän hoitopolku', Skin: 'Ihosyövän hoitopolku'})[p.type] || 'Yleinen hoitopolku' : `${p.type} pathway`],
    [t('Worklist status', 'Työlistan tila'), V(p.status)],
    [t('Review priority', 'Arvioinnin kiireellisyys'), `${V(p.priority)} (${t('set by clinical need only', 'määritetty vain kliinisen tarpeen mukaan')})`],
    [t('Reason on worklist', 'Peruste työlistalla'), V(p.reason)],
    [t('Reviewed report', 'Tarkastettu raportti'), latest ? `${t('Version', 'Versio')} ${latest.version}, ${t('approved by', 'hyväksyjä')} ${latest.approvedBy}, ${fmtDate(latest.approvedAt)}` : none],
    [t('Follow-up appointment', 'Seurantakäynti'), appt ? `${V(appt.status)}, ${fmtDate(appt.startsAt)} (${V(appt.method)}, ${appt.durationMinutes} min)` : t('None booked', 'Ei varattu')],
    [t('Follow-up outcome', 'Seurannan tulos'), fu ? V(fu.outcome || fu.status || 'Recorded') : none],
    [t('Referral decision', 'Lähetepäätös'), decision ? [decision.outcome, decision.destination].filter(Boolean).map(V).join(' · ') || t('Recorded', 'Kirjattu') : none],
    [t('Referral to', 'Lähete kohteeseen'), svc],
    [t('Urgency', 'Kiireellisyys'), urgency],
  ];

  // 3. Clinical context
  const smoking = !h ? nr : h.smoking === 'Currently smoke' ? `${t('Current smoker', 'Tupakoi nykyisin')}${r.py != null ? `, ${num(r.py)} ${t('pack-years', 'askivuotta')}` : ''}`
    : h.smoking === 'Previously smoked' ? `${t('Former smoker', 'Entinen tupakoija')}${r.py != null ? `, ${num(r.py)} ${t('pack-years', 'askivuotta')}` : ''}${h.quit_years ? `, ${t(`quit ${h.quit_years} years ago`, `lopetti ${h.quit_years} vuotta sitten`)}` : ''}` : (h.smoking ? V(h.smoking) : nr);
  const progStatus = s => ({up: t('up to date', 'ajan tasalla'), due: t('due', 'ajankohtainen'), notyet: t('not yet invited', 'ei vielä kutsuttu'), unknown: t('status not recorded', 'tila ei tiedossa'), discuss: t('discuss', 'keskustele lääkärin kanssa'), noprog: t('no Finnish programme', 'ei suomalaista ohjelmaa')})[s];
  const context = [
    [t('Oncologic history', 'Onkologinen tausta'), h?.history === 'Yes'
      ? t('Previous cancer reported in the health check. Type, histology, markers and treatment are not recorded: request them from the patient record (Kanta).', 'Terveyskyselyssä ilmoitettu aiempi syöpä. Tyyppiä, histologiaa, merkkiaineita ja hoitoa ei ole kirjattu: pyydä ne potilastiedoista (Kanta).')
      : t('No known cancer diagnosis. No histology, molecular markers or treatment yet: this is a pre-diagnostic referral.', 'Ei tiedossa olevaa syöpädiagnoosia. Histologiaa, molekyylimerkkiaineita tai hoitoa ei vielä ole: kyseessä on diagnoosia edeltävä lähete.')],
    [t('Reason for health check', 'Terveyskyselyn syy'), h?.symptoms ? V(h.symptoms) : nr],
    [t('Presenting symptoms', 'Oireet'), symptoms.length ? symptoms.map(s => `${V(s.label)}${s.urgent ? t(' [red flag]', ' [hälytysoire]') : ''}`).join('; ') : (h ? t('None reported', 'Ei ilmoitettuja oireita') : nr)],
    [t('Symptom duration', 'Oireiden kesto'), symptoms.length ? (h.duration ? V(h.duration) : nr) : '—'],
    [t('Family history', 'Sukuhistoria'), h?.family ? V(h.family) : nr],
    [t('Smoking', 'Tupakointi'), smoking],
    [t('Lung-screening eligibility (USPSTF 2021)', 'Keuhkoseulontakelpoisuus (USPSTF 2021)'), r ? (r.lungEligible ? t('Eligible: age 50–80, ≥20 pack-years, current or quit within 15 years', 'Täyttyy: ikä 50–80, ≥20 askivuotta, tupakoi tai lopetti alle 15 vuotta sitten') : t('Not eligible', 'Ei täyty')) : nr],
    [t('Alcohol (AUDIT-C)', 'Alkoholi (AUDIT-C)'), r?.audit != null ? `${r.audit} (${t('risk threshold', 'riskiraja')} ${h.sex === 'Male' ? 6 : 5})` : nr],
    [t('Body mass index', 'Painoindeksi'), r?.bmi != null ? num(r.bmi) : nr],
    [t('Radon at home', 'Radon kotona'), h?.radon ? V(h.radon) : nr],
    [t('Work exposures', 'Työperäiset altisteet'), h?.occupation ? V(h.occupation) : nr],
    [t('Other factors to discuss', 'Muut keskusteltavat tekijät'), factorLabels.length ? factorLabels.join(', ') : (h ? t('None flagged', 'Ei merkittyjä') : nr)],
    [t('Screening programmes', 'Seulontaohjelmat'), r?.programmes?.length ? r.programmes.map(x => `${V(x.name)}: ${progStatus(x.status)}`).join('; ') : (h ? t('None apply by age', 'Ikäryhmään ei kohdistu ohjelmia') : nr)],
  ];
  if (note.trim()) context.push([t("Referring clinician's note", 'Lähettävän lääkärin huomio'), note.trim()]);

  // 4–5. Imaging, comparison, findings
  let technique = null, findings = null, ai = null;
  if (c && g && main) {
    technique = [
      [t('Study', 'Tutkimus'), `${c.id}: ${t("public LIDC-IDRI research CT, linked to this fictional patient for the demonstration (not the patient's own scan)", 'julkinen LIDC-IDRI-tutkimus-TT, linkitetty tähän kuvitteelliseen potilaaseen demoa varten (ei potilaan oma kuva)')}`],
      [t('Technique', 'Tekniikka'), t(`CT chest, axial; slice thickness ${c.sliceMm} mm; pixel size ${c.pixelMm} mm; ${c.slices} images in the full study`, `Keuhkojen TT, aksiaalinen; leikepaksuus ${num(c.sliceMm)} mm; pikselikoko ${num(c.pixelMm)} mm; koko tutkimuksessa ${c.slices} kuvaa`)],
      [t('Contrast phase', 'Varjoainevaihe'), t('Not recorded in the source metadata', 'Ei kirjattu lähdeaineiston metatietoihin')],
      [t('Most recent prior scan', 'Edellinen tutkimus'), t('None available', 'Ei saatavilla')],
      [t('Baseline / nadir scan', 'Lähtötaso- / nadirtutkimus'), t('This study is the baseline. Interval change and treatment response are not assessable.', 'Tämä tutkimus on lähtötaso. Muutosta tai hoitovastetta ei voi arvioida.')],
      [t('Limits on accuracy', 'Tarkkuuden rajoitukset'), t(`Review is of ${c.frames.length} exported slices around the main nodule (lung window). Mediastinum, pleura, bones and upper abdomen were not reviewed. Sizes come from the radiologists' outlines on 384-pixel images.`, `Arvioitu ${c.frames.length} pääpesäkkeen ympäriltä vietyä leikettä (keuhkoikkuna). Välikarsinaa, keuhkopussia, luustoa ja ylävatsaa ei arvioitu. Mitat perustuvat radiologien rajauksiin 384 pikselin kuvissa.`)],
    ];
    const others = c.nodules.slice(1);
    findings = {
      primary: [
        [t('Location', 'Sijainti'), t(`${side[0].toUpperCase() + side.slice(1)} lung, ${g.anterior ? 'anterior' : 'posterior'} half of the axial image. Lobe to be confirmed on the full study.`, `${side[0].toUpperCase() + side.slice(1)} keuhko, aksiaalikuvan ${g.anterior ? 'etu' : 'taka'}osa. Lohko varmistetaan koko tutkimuksesta.`)],
        [t('Size', 'Koko'), t(`${g.long} × ${g.short} mm (long × short axis on the key image); readers' mean diameter ${main.diameter} mm`, `${num(g.long)} × ${num(g.short)} mm (pitkä × lyhyt akseli avainkuvassa); lukijoiden keskimääräinen halkaisija ${num(main.diameter)} mm`)],
        [t('Craniocaudal extent', 'Kraniokaudaalinen ulottuvuus'), `${g.truncated ? t('at least ', 'vähintään ') : ''}${num(g.cc)} mm`],
        [t('Composition', 'Rakenne'), `${composition(main.texture)} (${t('texture rating', 'rakennearvio')} ${num(main.texture)}/5)`],
        [t('Margin', 'Reunat'), main.spiculation >= 3 ? `${t('spiculated', 'spikuloitunut')} (${t('spiculation', 'spikulaatio')} ${num(main.spiculation)}/5)` : `${t('smooth or lobulated', 'sileä tai lobuloitunut')} (${t('spiculation', 'spikulaatio')} ${num(main.spiculation)}/5)`],
        [t('Radiologists’ malignancy rating', 'Radiologien pahanlaatuisuusarvio'), `${num(main.malignancy)}/5: ${malignancy(main.malignancy)}`],
        [t('Reader agreement', 'Lukijoiden yksimielisyys'), t(`${main.readers} of 4 radiologists marked this nodule`, `${main.readers}/4 radiologia merkitsi pesäkkeen`)],
        [t('Key image', 'Avainkuva'), t(`Image ${g.frame + 1} of ${c.frames.length} in the excerpt, table position ${g.z} mm`, `Kuva ${g.frame + 1}/${c.frames.length} otteessa, pöydän sijainti ${num(g.z)} mm`)],
        [t('Invasion of adjacent structures', 'Kasvu ympäröiviin rakenteisiin'), t('Not evaluated (requires full-study review)', 'Ei arvioitu (vaatii koko tutkimuksen arvion)')],
      ],
      others: others.length
        ? others.map((n, i) => t(`Nodule ${i + 2}: ${n.diameter} mm, ${composition(n.texture)}, marked by ${n.readers} of 4 readers, malignancy rating ${n.malignancy}`, `Pesäke ${i + 2}: ${num(n.diameter)} mm, ${composition(n.texture)}, ${n.readers}/4 lukijaa merkitsi, pahanlaatuisuusarvio ${num(n.malignancy)}`))
        : [t('No other nodules of 3 mm or more were marked by the 4 radiologists in the full study.', 'Neljä radiologia ei merkinnyt koko tutkimuksessa muita vähintään 3 mm:n pesäkkeitä.')],
      nodal: t('Not evaluated: outside the exported slices. Assess hilar and mediastinal stations on the full study.', 'Ei arvioitu: viedyn otteen ulkopuolella. Arvioi hilus- ja välikarsina-asemat koko tutkimuksesta.'),
      distant: t('Not evaluated: staging needs a full chest CT including the upper abdomen, and/or PET/CT.', 'Ei arvioitu: levinneisyysselvitys vaatii koko keuhkojen ja ylävatsan TT:n ja/tai PET-TT:n.'),
      category: t(`Lung-RADS v2022 category ${band} (approximated): ${lr.meaning}. Approximated from the readers' size and ratings; LIDC-IDRI has no Lung-RADS labels, and part-solid and ground-glass rules are simplified.`, `Lung-RADS v2022 -luokka ${band} (arvioitu): ${lr.meaning}. Arvioitu lukijoiden koko- ja arviotiedoista; LIDC-IDRI-aineistossa ei ole Lung-RADS-merkintöjä, ja osittain kiinteiden ja mattalasimaisten pesäkkeiden säännöt on yksinkertaistettu.`),
      treatment: t('Not applicable: no cancer treatment has been given.', 'Ei sovellu: syöpähoitoa ei ole annettu.'),
    };
    // AI second reader (research): precomputed read from ai-second-reader.js.
    // Shown for comparison only; it never feeds urgency, bottom line or recommendations.
    const A = window.candexAi, aiRead = A?.read(c.id) || null, prov = A?.provenance() || null, ag = aiRead ? A.agreement(c, aiRead) : null;
    const pend = t('Pending', 'Odottaa');
    if (aiRead && ag) {
      const yn = b => (b ? t('Yes', 'Kyllä') : t('No', 'Ei'));
      const tick = ok => (ok ? '✓' : '✗');
      const sideT = s => t(s, ({right: 'oikea', left: 'vasen', 'not seen': 'ei nähty'})[s] || s);
      const lobeT = l => t(l, ({upper: 'ylälohko', middle: 'keskilohko', lower: 'alalohko', lingula: 'lingula', uncertain: 'epävarma'})[l] || l);
      const compT = x => t(x, ({solid: 'kiinteä', 'part-solid': 'osittain kiinteä', 'ground-glass': 'mattalasimainen', calcified: 'kalkkeutunut', 'not applicable': 'ei sovellu'})[x] || x);
      const found = !!aiRead.nodule_present;
      const verdict = {agrees: t('Agrees with radiologists', 'Yhtäpitävä radiologien kanssa'), partly: t('Partly agrees with radiologists', 'Osittain yhtäpitävä radiologien kanssa'), disagrees: t('Disagrees with radiologists', 'Eriävä radiologien kanssa')}[ag.verdict];
      const lb = prov?.leaderboard || {};
      ai = {
        verdict: ag.verdict,
        verdictText: verdict,
        summary: found
          ? t(`AI found a ${aiRead.composition || 'nodule'} nodule in the ${aiRead.location?.side || ''} lung${aiRead.location?.lobe && aiRead.location.lobe !== 'uncertain' ? `, ${aiRead.location.lobe} lobe` : ''}, ${aiRead.long_axis_mm != null ? `${aiRead.long_axis_mm} mm` : 'size not given'}, Lung-RADS ${aiRead.lung_rads || '—'} (model confidence ${Math.round((aiRead.confidence ?? 0) * 100)} %, not calibrated).`,
              `Tekoäly löysi ${compT(aiRead.composition || 'nodule').replace('nodule', 'pesäkkeen')} pesäkkeen ${sideT(aiRead.location?.side) === 'oikea' ? 'oikeasta' : sideT(aiRead.location?.side) === 'vasen' ? 'vasemmasta' : ''} keuhkosta${aiRead.location?.lobe && aiRead.location.lobe !== 'uncertain' ? ` (${lobeT(aiRead.location.lobe)})` : ''}, ${aiRead.long_axis_mm != null ? `${num(aiRead.long_axis_mm)} mm` : 'koko ei tiedossa'}, Lung-RADS ${aiRead.lung_rads || '—'} (mallin varmuus ${Math.round((aiRead.confidence ?? 0) * 100)} %, ei kalibroitu).`)
          : t(`AI reported no nodule (model confidence ${Math.round((aiRead.confidence ?? 0) * 100)} %, not calibrated).`, `Tekoäly ei löytänyt pesäkettä (mallin varmuus ${Math.round((aiRead.confidence ?? 0) * 100)} %, ei kalibroitu).`),
        miss: !found ? t('AI reported no nodule; radiologists marked one. A negative AI read must never be used to rule out a nodule.', 'Tekoäly ei löytänyt pesäkettä; radiologit merkitsivät sen. Negatiivista tekoälyluentaa ei saa koskaan käyttää pesäkkeen poissulkemiseen.')
          : ag.wrongSide ? t('AI reported a finding on the other side, so the radiologists\u2019 nodule was not found. Treat this as a miss plus a possible false positive.', 'Tekoäly ilmoitti löydöksen toisella puolella, joten radiologien pesäkettä se ei löytänyt. Käsittele tätä ohituksena ja mahdollisena vääränä positiivisena.') : null,
        report: aiRead.short_report || null,
        markers: Array.isArray(aiRead.candidates) ? aiRead.candidates.filter(cd => cd.x != null && cd.y != null && (cd.frame == null || Math.abs(cd.frame - g.frame) <= 1)) : [],
        rows: [
          [t('Nodule detected', 'Pesäke havaittu'), t(`Yes (${main.readers} of 4 readers)`, `Kyllä (${main.readers}/4 lukijaa)`), yn(found), tick(found)],
          [t('Side · lobe', 'Puoli · lohko'), `${sideT(ag.refSide)} · ${t('lobe to confirm', 'lohko varmistettava')}`, found ? `${sideT(aiRead.location?.side)} · ${lobeT(aiRead.location?.lobe || 'uncertain')}` : '—', found ? tick(ag.side) : '—'],
          [t('Size (long axis)', 'Koko (pitkä akseli)'), t(`${main.diameter} mm readers' mean; ${g.long} × ${g.short} mm on key image`, `${num(main.diameter)} mm lukijoiden keskiarvo; ${num(g.long)} × ${num(g.short)} mm avainkuvassa`), aiRead.long_axis_mm != null ? `${num(aiRead.long_axis_mm)}${aiRead.short_axis_mm != null ? ` × ${num(aiRead.short_axis_mm)}` : ''} mm` : '—', found ? (ag.size ? '✓' : `✗ (±${num(ag.sizeTol)} mm)`) : '—'],
          [t('Composition', 'Rakenne'), composition(main.texture), found && aiRead.composition ? compT(aiRead.composition) : '—', found ? tick(compT(aiRead.composition) === composition(main.texture)) : '—'],
          [t('Lung-RADS (approx.)', 'Lung-RADS (arvio)'), band, aiRead.lung_rads || '—', ag.lrExact ? '✓' : ag.lrNear ? t('≈ one category apart', '≈ yhden luokan ero') : '✗'],
          ...(ag.slice !== null ? [[t('Slice (of 11 in excerpt)', 'Leike (11:stä otteessa)'), String(g.frame + 1), String(ag.slice + 1), Math.abs(ag.slice - g.frame) <= 1 ? '✓' : '✗']] : []),
          [t('Model confidence', 'Mallin varmuus'), '—', aiRead.confidence != null ? `${Math.round(aiRead.confidence * 100)} %` : '—', t('not calibrated', 'ei kalibroitu')],
          ...(aiRead.votes?.of ? [[t('Runs that agree', 'Yhtäpitävät ajot'), '—', `${aiRead.votes.agree} / ${aiRead.votes.of}`, '—']] : []),
          ...(ag.located !== null ? [[t('AI position on the radiologists’ nodule', 'Tekoälyn sijainti radiologien pesäkkeessä'), '—', yn(ag.located), tick(ag.located)]] : []),
          [t('Overall', 'Kokonaisuus'), '', '', verdict],
        ],
        note: [
          t('Exploratory research comparison, not for clinical use.', 'Alustava tutkimusvertailu, ei kliiniseen käyttöön.'),
          prov ? t(`AI: ${prov.model} (general-purpose model, unvalidated), precomputed ${prov.generated}; input: ${prov.input}${prov.coordinates ? '; image coordinates withheld as unreliable' : ''}${prov.runs > 1 ? `; ${prov.runs} runs, majority vote` : ''}.`, `Tekoäly: ${prov.model} (yleiskäyttöinen, validoimaton malli), laskettu ${prov.generated}; syöte: ${prov.inputFi || prov.input}${prov.runs > 1 ? `; ${prov.runs} ajoa, enemmistöpäätös` : ''}.`) : '',
          lb.found ? t(`Across the 5 public study nodules it found ${lb.found} on the correct side (95% CI ${lb.ci})${lb.consensusFound ? `, and ${lb.consensusFound} of those marked by at least 3 of 4 radiologists` : ''}${lb.wrongSideFindings ? `; ${lb.wrongSideFindings} finding${lb.wrongSideFindings === 1 ? ' was' : 's were'} on the wrong side` : ''}.`, `Viiden julkisen tutkimuksen pesäkkeistä se löysi oikealta puolelta ${lb.found} (95 %:n LV ${lb.ci})${lb.consensusFound ? ` ja vähintään 3/4 radiologin merkitsemistä ${lb.consensusFound}` : ''}${lb.wrongSideFindings ? `; ${lb.wrongSideFindings} löydös oli väärällä puolella` : ''}.`) : '',
          t('It may miss or invent findings and misstate size; its confidence is not calibrated. LIDC-IDRI is public and widely redistributed, so the model may have seen these images in training, which would inflate agreement. Not used for urgency or recommendations.', 'Se voi jättää löydöksiä huomaamatta, keksiä niitä tai arvioida koon väärin; sen varmuus ei ole kalibroitu. LIDC-IDRI on julkinen ja laajasti jaettu, joten malli on voinut nähdä nämä kuvat koulutuksessa, mikä liioittelisi yhtäpitävyyttä. Ei käytetty kiireellisyyteen eikä suosituksiin.'),
        ].filter(Boolean).join(' '),
      };
    } else {
      ai = {
        verdict: null,
        rows: [
          [t('Nodule detected', 'Pesäke havaittu'), t(`Yes (${main.readers} of 4 readers)`, `Kyllä (${main.readers}/4 lukijaa)`), pend, '—'],
          [t('Long × short axis', 'Pitkä × lyhyt akseli'), `${num(g.long)} × ${num(g.short)} mm`, pend, '—'],
          [t('Composition', 'Rakenne'), composition(main.texture), pend, '—'],
          [t('Lung-RADS (approx.)', 'Lung-RADS (arvio)'), band, pend, '—'],
        ],
        note: t('No AI second read is available for this study. Any future AI read will be shown here as a research comparison and will not set urgency or recommendations.', 'Tälle tutkimukselle ei ole tekoälyluentaa. Mahdollinen tuleva luenta näytetään tässä tutkimusvertailuna, eikä se vaikuta kiireellisyyteen tai suosituksiin.'),
      };
    }
  }

  // Chest X-ray classifier (research): precomputed TorchXRayVision scores with an
  // AI summary (Gemini, safety-reviewed). Shown for context only; never feeds
  // urgency, bottom line or recommendations.
  // Finnish for the known test-copy notes (cxr_manifest.csv); unknown notes stay in English.
  const viewNoteFi = note => note.split(/(?<=\.)\s+(?=[A-Z])/).map(x =>
    /^Monitoring leads/.test(x) ? 'Valvontajohdot ja katetri näkyvät kuten osastopotilaalla; otsaketiedot viittaavat silti tavalliseen PA-kuvaukseen. Suuntaa ei ole varmistettu kuvasta.'
    : /^Pixel data is inverted/.test(x) ? 'Kuvan pikselitiedot ovat käänteiset MONOCHROME2-merkintään nähden (selkäranka tumma, keuhkot vaaleat); testikopio merkitty MONOCHROME1:ksi kuvan tarkastelun jälkeen.'
    : /^Relabelled MONOCHROME1/.test(x) ? ''
    : /^Stored display window/.test(x) ? 'Tallennettu näyttöikkuna leikkasi suurimman osan pikseleistä valkoisiksi; se poistettiin testikopiosta.'
    : /^(View not confirmed|headers still)/.test(x) ? '' : x).filter(Boolean).join(' ');
  const xr = c ? window.candexCxrReads?.cases?.[c.id] : null, xp = window.candexCxrReads?.provenance;
  let cxr = null;
  if (xr) {
    const two = v => (lang === 'fi' ? v.toFixed(2).replace('.', ',') : v.toFixed(2));
    const top = [...xr.scores].sort((a, b) => b.score - a.score).slice(0, 5);
    const keep = [...top, ...xr.scores.filter(x => ['Nodule', 'Mass'].includes(x.label) && !top.includes(x))];
    cxr = {
      image: xr.image,
      summary: t(xr.summary.en, xr.summary.fi),
      points: lang === 'fi' ? xr.keyPoints.fi : xr.keyPoints.en,
      rows: keep.map(x => [x.label, two(x.score), ['Nodule', 'Mass'].includes(x.label) ? t('nodule-related label', 'pesäkkeeseen liittyvä nimike') : top.indexOf(x) === 0 ? t('highest score', 'korkein pistemäärä') : '']),
      view: t(`Frontal ${xr.view} (inferred from headers: ${xr.viewEvidence})${xr.viewNote ? `. Note: ${xr.viewNote}` : ''}`, `Edestä ${xr.view} (päätelty otsaketiedoista: ${xr.viewEvidence})${xr.viewNote ? `. Huomio: ${viewNoteFi(xr.viewNote)}` : ''}`),
      review: xr.review?.verdict === 'consistent with the raw data' ? t('Safety review: consistent with the raw scores (0 issues).', 'Turvallisuustarkistus: yhtäpitävä raakapisteiden kanssa (0 huomiota).') : t(`Safety review found ${(xr.review?.issues || []).length} issue(s); read the raw scores: ${(xr.review?.issues || []).join(' ')}`, `Turvallisuustarkistus löysi ${(xr.review?.issues || []).length} huomiota; tarkista raakapisteet: ${(xr.review?.issues || []).join(' ')}`),
      note: [
        t(`Classifier: ${xp?.classifier || 'TorchXRayVision DenseNet121'}. Summary: ${xp?.summaryModel || 'Gemini'} (general-purpose model, unvalidated), generated ${xp?.generated || ''}, then checked against the raw scores by a second AI review.`, `Luokittelija: ${xp?.classifier || 'TorchXRayVision DenseNet121'}. Yhteenveto: ${xp?.summaryModel || 'Gemini'} (yleiskäyttöinen, validoimaton malli), laadittu ${xp?.generated || ''}, minkä jälkeen toinen tekoälytarkistus vertasi sen raakapisteisiin.`),
        t('Scores are uncalibrated (0–1, not probabilities) and have no threshold. This classifier is not a nodule detector: on 8 LIDC-IDRI X-rays with 8–36 mm CT nodules, Nodule and Mass stayed at or below 0.10 and 0.12. X-ray and CT dates are de-identified, so the time between them is unknown. Not used for urgency or recommendations.', 'Pisteet ovat kalibroimattomia (0–1, eivät todennäköisyyksiä), eikä niillä ole raja-arvoa. Luokittelija ei tunnista pesäkkeitä: kahdeksassa LIDC-IDRI-röntgenkuvassa, joiden TT:ssä oli 8–36 mm:n pesäke, Nodule- ja Mass-pisteet olivat enintään 0,10 ja 0,12. Röntgen- ja TT-kuvien päivämäärät on anonymisoitu, joten niiden väli ei ole tiedossa. Ei käytetty kiireellisyyteen eikä suosituksiin.'),
      ].join(' '),
    };
  }

  // 6. Impression
  const sizeText = g ? t(`${g.long} × ${g.short} mm ${composition(main.texture)} nodule in the ${sideIn}`, `${num(g.long)} × ${num(g.short)} mm:n ${composition(main.texture)} pesäke ${sideIn}`) : '';
  const action = level === 'urgent' ? t('Urgent referral', 'Kiireellinen lähete') : level === 'soon' ? t('Referral within 2 weeks', 'Lähete 2 viikon sisällä') : t('Routine follow-up', 'Tavanomainen seuranta');
  let bottomLine;
  if (c && g) bottomLine = t(`Lung-RADS ${band} (approximated), ${lr.meaning}: ${sizeText}. ${action} to ${svc}.`, `Lung-RADS ${band} (arvio), ${lr.meaning}: ${sizeText}. ${action}: ${svc}.`);
  else if (urgentSymptoms.length) bottomLine = t(`Red-flag symptoms without imaging on record (${urgentSymptoms.map(lower).join('; ')}). Urgent assessment by ${svc}.`, `Hälytysoireita ilman kuvantamistutkimusta (${urgentSymptoms.map(lower).join('; ')}). Kiireellinen arvio: ${svc}.`);
  else if (symptoms.length) bottomLine = t(`Symptoms to assess without imaging on record. Referral within 2 weeks to ${svc}.`, `Arvioitavia oireita ilman kuvantamistutkimusta. Lähete 2 viikon sisällä: ${svc}.`);
  else bottomLine = t(`No suspicious imaging or red-flag symptoms on record. ${svc} for screening and prevention.`, `Ei epäilyttäviä kuvantamislöydöksiä tai hälytysoireita. ${svc}: seulonta ja ennaltaehkäisy.`);

  const bullets = [];
  if (c && g) bullets.push(t(`Main nodule: ${sizeText}, ${main.spiculation >= 3 ? 'spiculated' : 'non-spiculated'}, readers' malignancy rating ${main.malignancy}/5 (key image ${g.frame + 1}, table position ${g.z} mm).`, `Pääpesäke: ${sizeText}, ${main.spiculation >= 3 ? 'spikuloitunut' : 'ei spikuloitunut'}, lukijoiden pahanlaatuisuusarvio ${num(main.malignancy)}/5 (avainkuva ${g.frame + 1}, pöydän sijainti ${num(g.z)} mm).`));
  const dur = h?.duration ? ` (${V(h.duration).toLowerCase()})` : '';
  if (urgentSymptoms.length) bullets.push(`${t('Red-flag symptoms', 'Hälytysoireet')}: ${urgentSymptoms.map(lower).join('; ')}${dur}.`);
  else if (symptoms.length) bullets.push(`${t('Symptoms', 'Oireet')}: ${symptoms.map(lower).join('; ')}${dur}.`);
  if (r?.py != null && h.smoking !== 'Never smoked') bullets.push(`${t('Smoking exposure', 'Tupakointialtistus')}: ${smoking.toLowerCase()}${r.lungEligible ? t('; meets USPSTF lung-screening criteria', '; täyttää USPSTF:n keuhkoseulontakriteerit') : ''}.`);
  if (r?.factors?.some(f => f.key === 'family')) bullets.push(t('Family history pattern suggests possible inherited risk (two or more close relatives, or one diagnosed under 50).', 'Sukuhistoria viittaa mahdolliseen perinnölliseen riskiin (kaksi tai useampi lähisukulainen tai yksi alle 50-vuotiaana sairastunut).'));
  if (c && c.nodules.length > 1) bullets.push(t(`${c.nodules.length - 1} additional nodule${c.nodules.length > 2 ? 's' : ''} marked: largest ${Math.max(...c.nodules.slice(1).map(n => n.diameter))} mm.`, `${c.nodules.length - 1} muu${c.nodules.length > 2 ? 'ta' : ''} merkitty pesäke: suurin ${num(Math.max(...c.nodules.slice(1).map(n => n.diameter)))} mm.`));
  if (!bullets.length) bullets.push(t('No findings requiring specialist action are on record.', 'Ei erikoissairaanhoidon toimia vaativia löydöksiä.'));

  const negatives = [];
  if (c && c.nodules.length === 1) negatives.push(t('No other nodules of 3 mm or more in the full study (all 4 readers).', 'Koko tutkimuksessa ei muita vähintään 3 mm:n pesäkkeitä (kaikki 4 lukijaa).'));
  if (h && !symptoms.length) negatives.push(t('No symptoms reported in the health check.', 'Terveyskyselyssä ei ilmoitettuja oireita.'));
  if (h && h.smoking === 'Never smoked') negatives.push(t('Never smoked.', 'Ei ole koskaan tupakoinut.'));
  const notEvaluated = c
    ? t('Not evaluated, so not negative: lymph nodes, distant metastases and invasion of adjacent structures.', 'Ei arvioitu, joten ei negatiivinen löydös: imusolmukkeet, etäpesäkkeet ja kasvu ympäröiviin rakenteisiin.')
    : t('No CT study is linked: no imaging findings can be reported.', 'TT-tutkimusta ei ole linkitetty: kuvantamislöydöksiä ei voi raportoida.');

  const recs = [];
  if (lr) recs.push(`${lr.action} (${t('Lung-RADS v2022 management for category', 'Lung-RADS v2022 -hoitosuositus luokalle')} ${band === '4X-like' ? '4X' : band}.)`);
  if (c) recs.push(t('Confirm the lobe, nodal stations and any distant disease on the full study before staging.', 'Varmista lohko, imusolmukeasemat ja mahdollinen etälevinneisyys koko tutkimuksesta ennen levinneisyysluokitusta.'));
  if (!c && symptoms.length) recs.push(t('Clinical assessment of the reported symptoms; arrange imaging appropriate to the pathway (for example chest X-ray or CT for lung symptoms).', 'Ilmoitettujen oireiden kliininen arvio; järjestä hoitopolkuun sopiva kuvantaminen (esimerkiksi keuhkoröntgen tai TT keuhko-oireissa).'));
  if (h?.smoking === 'Currently smoke') recs.push(t('Offer smoking-cessation support (Stumppi.fi or the health centre).', 'Tarjoa tukea tupakoinnin lopettamiseen (Stumppi.fi tai terveysasema).'));
  if (r?.factors?.some(f => f.key === 'family')) recs.push(t('Consider referral to a clinical genetics service.', 'Harkitse lähetettä perinnöllisyyspoliklinikalle.'));
  if (h?.radon === 'Never measured') recs.push(t('Advise a home radon measurement (STUK).', 'Suosittele kodin radonmittausta (STUK).'));
  if (h?.radon === 'Measured above 300 Bq/m³') recs.push(t('Advise radon remediation (above the STUK 300 Bq/m³ reference level).', 'Suosittele radonkorjausta (yli STUKin 300 Bq/m³ viitearvon).'));
  (r?.programmes || []).filter(x => x.status === 'due').forEach(x => recs.push(`${V(x.name)}: ${t('due; send or renew the invitation.', 'ajankohtainen; lähetä tai uusi kutsu.')}`));
  if (lng && !['Finnish', 'Swedish', 'English'].includes(lng)) recs.push(t(`Book an interpreter (${lng}) for appointments.`, `Varaa tulkki (${V(lng).toLowerCase()}) vastaanotoille.`));
  if (h?.support) recs.push(t('Arrange access support (travel, language, technology or cost) before booking.', 'Järjestä tuki hoitoon pääsyyn (matkat, kieli, teknologia tai kustannukset) ennen ajanvarausta.'));
  const respond = {urgent: t('within 3 working days', '3 arkipäivän kuluessa'), soon: t('within 2 weeks', '2 viikon kuluessa'), routine: t('at the next routine review', 'seuraavassa tavanomaisessa arviossa')}[level];
  recs.push(t(`Named owner: referring clinician (demo: Dr. Emilia Koski). Respond by: ${respond}.`, `Vastuuhenkilö: lähettävä lääkäri (demo: Emilia Koski). Vastaus: ${respond}.`));

  // 7. Plain-language summary for the patient
  let plain;
  if (c && g) {
    const mmTxt = Math.round(g.long);
    const sev = band === '2' ? t('This type of spot is very likely harmless. The usual plan is your next yearly scan.', 'Tällainen muutos on hyvin todennäköisesti vaaraton. Tavallisesti seuraava askel on ensi vuoden seulontakuvaus.')
      : band === '3' ? t('This type of spot is probably harmless, but a repeat scan in about 6 months checks that it does not change.', 'Tällainen muutos on todennäköisesti vaaraton, mutta uusi kuvaus noin 6 kuukauden kuluttua varmistaa, ettei se muutu.')
      : band === '4A' ? t('This spot needs a closer look. The usual next step is another scan in about 3 months, and sometimes a PET/CT scan.', 'Muutos vaatii tarkempaa tutkimista. Tavallisesti seuraava askel on uusi kuvaus noin 3 kuukauden kuluttua ja joskus PET-TT-kuvaus.')
      : t('This spot needs further tests soon. Your doctor will refer you to a lung specialist team for more scans and possibly a small tissue sample (biopsy).', 'Muutos vaatii pian lisätutkimuksia. Lääkärisi lähettää sinut keuhkosairauksien erikoistiimiin lisäkuvauksiin ja mahdollisesti pieneen kudosnäytteeseen (biopsia).');
    plain = t(`Your CT scan (a detailed X-ray picture of the chest) shows a small spot on the ${side} lung, about ${mmTxt} mm across. Doctors call a spot like this a nodule. ${sev} Many lung nodules are not cancer. This draft has not yet been checked by your doctor, who will explain what it means for you.`,
      `TT-kuvauksessasi (tarkka röntgenkuvaus rintakehästä) näkyy ${g.right ? 'oikeassa' : 'vasemmassa'} keuhkossa pieni, noin ${mmTxt} mm:n kokoinen muutos. Lääkärit kutsuvat tällaista muutosta pesäkkeeksi. ${sev} Monet keuhkopesäkkeet eivät ole syöpää. Lääkäri ei ole vielä tarkistanut tätä luonnosta; hän kertoo, mitä se tarkoittaa sinulle.`);
  } else if (symptoms.length) {
    plain = t(`In your health check you told us about ${symptoms.length === 1 ? 'a symptom' : 'some symptoms'} that should be checked by a doctor${urgentSymptoms.length ? ' within the next few days' : ''}. Most symptoms like these have causes other than cancer. Your care team will contact you about the next step.`,
      `Kerroit terveyskyselyssä ${symptoms.length === 1 ? 'oireesta' : 'oireista'}, jotka lääkärin on hyvä tutkia${urgentSymptoms.length ? ' lähipäivinä' : ''}. Useimmilla tällaisilla oireilla on muu syy kuin syöpä. Hoitotiimisi ottaa sinuun yhteyttä seuraavasta vaiheesta.`);
  } else {
    plain = t('Nothing in your health check needs urgent action. Your care team may talk with you about screening invitations and healthy habits.', 'Terveyskyselyssäsi ei ole kiireellisiä asioita. Hoitotiimisi voi keskustella kanssasi seulontakutsuista ja terveellisistä elintavoista.');
  }

  const created = fmtDate(new Date().toISOString());
  const rep = {
    lang, id: p.id, name: p.name, title: t('Patient summary & oncology referral', 'Potilasyhteenveto ja syöpälähete'),
    reportId: `RF-${p.id}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`, created,
    patient, pathway, context, technique, findings, ai, cxr, caseId: c?.id, keyFrame: c && g ? c.frames[g.frame] : null, geometry: g,
    impression: {bottomLine, bullets, negatives, notEvaluated, recs},
    plain,
    glossary: lang === 'fi'
      ? [['TT', 'tietokonetomografia, tarkka röntgenkuvaus'], ['LDCT', 'pieniannoksinen TT'], ['Lung-RADS', 'American College of Radiologyn luokitus keuhkopesäkkeille (2 = hyvänlaatuinen, 4B/4X = hyvin epäilyttävä)'], ['PET-TT', 'kuvaus, joka näyttää kudosten aineenvaihdunnan aktiivisuuden'], ['MDT', 'moniammatillinen tiimi'], ['AUDIT-C', 'kolmen kysymyksen alkoholin käytön seulontatesti'], ['Askivuosi', '20 savuketta päivässä vuoden ajan'], ['USPSTF', 'Yhdysvaltain ennaltaehkäisevien palvelujen työryhmä']]
      : [['CT', 'computed tomography, a detailed X-ray scan'], ['LDCT', 'low-dose CT'], ['Lung-RADS', 'American College of Radiology system for grading lung nodules (2 = benign, 4B/4X = very suspicious)'], ['PET/CT', 'scan showing how active tissue is'], ['MDT', 'multidisciplinary team'], ['AUDIT-C', 'three-question alcohol screening test'], ['Pack-year', '20 cigarettes a day for one year'], ['USPSTF', 'US Preventive Services Task Force']],
    signoff: [
      [t('Status', 'Tila'), t('Unsigned draft for clinician review. Not a diagnosis.', 'Allekirjoittamaton luonnos lääkärin tarkistettavaksi. Ei diagnoosi.')],
      [t('Prepared', 'Laadittu'), `${created} ${t('in Candex (demonstration)', 'Candexissa (demo)')}`],
      [t('To be signed by', 'Allekirjoittaja'), t('Responsible clinician', 'Vastuulääkäri')],
      [t('Data provenance', 'Tietojen alkuperä'), t('Fictional patient and simulated health check. CT images: LIDC-IDRI, The Cancer Imaging Archive (CC BY 3.0); Armato SG III et al., Medical Physics 2011;38(2):915–931; data doi:10.7937/K9/TCIA.2015.LO9QL9SX; Clark K et al., J Digit Imaging 2013 (TCIA). Prototype for research use only: not a medical device, not CE-marked.', 'Kuvitteellinen potilas ja simuloitu terveyskysely. TT-kuvat: LIDC-IDRI, The Cancer Imaging Archive (CC BY 3.0); Armato SG III ym., Medical Physics 2011;38(2):915–931; aineisto doi:10.7937/K9/TCIA.2015.LO9QL9SX; Clark K ym., J Digit Imaging 2013 (TCIA). Vain tutkimuskäyttöön tarkoitettu prototyyppi: ei lääkinnällinen laite, ei CE-merkitty.')],
    ],
    labels: {
      bottom: t('Bottom line', 'Johtopäätös lyhyesti'), draft: t('Unsigned draft · demo', 'Allekirjoittamaton luonnos · demo'),
      banner: t('UNSIGNED DRAFT · FICTIONAL PATIENT · NOT FOR CLINICAL USE', 'ALLEKIRJOITTAMATON LUONNOS · KUVITTEELLINEN POTILAS · EI KLIINISEEN KÄYTTÖÖN'),
      s1: t('Patient & referral details', 'Potilas- ja lähetetiedot'), s2: t('Care pathway', 'Hoitopolku'), s3: t('Clinical context', 'Kliininen tausta'),
      s4: t('Imaging: comparison & technique', 'Kuvantaminen: vertailu ja tekniikka'), s4none: t('Imaging', 'Kuvantaminen'),
      noImg: t('No CT study is linked to this patient, so no imaging findings are reported.', 'Potilaalle ei ole linkitetty TT-tutkimusta, joten kuvantamislöydöksiä ei raportoida.'),
      noImgHint: t('No CT study is linked to this patient. Link one in Imaging review to add findings and a key image.', 'Potilaalle ei ole linkitetty TT-tutkimusta. Linkitä tutkimus kuvantamisen arviossa lisätäksesi löydökset ja avainkuvan.'),
      s5: t('Structured findings', 'Jäsennellyt löydökset'), primary: t('Primary lesion', 'Pääpesäke'), others: t('Other nodules', 'Muut pesäkkeet'),
      nodal: t('Nodal disease', 'Imusolmukkeet'), distant: t('Distant metastases', 'Etäpesäkkeet'), category: t('Standardised category', 'Standardoitu luokitus'), treatment: t('Treatment-related changes', 'Hoitoon liittyvät muutokset'),
      keyImg: g ? t(`Key image ${g.frame + 1}, table position ${g.z} mm. Purple: radiologist outlines of the main nodule.`, `Avainkuva ${g.frame + 1}, pöydän sijainti ${num(g.z)} mm. Violetti: radiologien rajaukset pääpesäkkeestä.`) : '',
      zoom: t('Main nodule, zoomed x4.', 'Pääpesäke, suurennettu 4x.'),
      s6: t('AI second reader: research comparison', 'Tekoäly toisena lukijana: tutkimusvertailu'),
      aiFinding: t('AI finding (from imaging review)', 'Tekoälyn löydös (kuvantamisen arviosta)'), aiReport: t('AI report text (verbatim, unedited)', 'Tekoälyn raporttiteksti (sellaisenaan, muokkaamaton)'), aiMarker: t('Amber dashed circle: AI marker.', 'Oranssi katkoviivaympyrä: tekoälyn merkintä.'), aiHead: [t('Measure', 'Mittari'), t('Radiologists (LIDC)', 'Radiologit (LIDC)'), t('AI model', 'Tekoälymalli'), t('Agreement', 'Yhtäpitävyys')],
      sx: t('Chest X-ray AI summary: research', 'Keuhkoröntgenkuvan tekoälyyhteenveto: tutkimus'), cxrFinding: t('AI summary of the raw classifier scores', 'Tekoälyn yhteenveto luokittelijan raakapisteistä'), cxrPoints: t('Key points', 'Keskeiset kohdat'), cxrImg: t('Frontal chest X-ray as given to the classifier.', 'Keuhkoröntgenkuva edestä, sellaisena kuin luokittelija sen sai.'), cxrHead: [t('Label (model output)', 'Nimike (mallin tulos)'), t('Score', 'Pisteet'), t('Note', 'Huomio')], cxrView: t('View', 'Kuvaussuunta'),
      s7: t('Impression', 'Johtopäätökset'), keyFindings: t('Key findings, in order of importance', 'Keskeiset löydökset tärkeysjärjestyksessä'), negatives: t('Pertinent negatives', 'Merkitykselliset negatiiviset löydökset'), recs: t('Recommendations', 'Suositukset'),
      s8: t('For the patient: plain-language summary', 'Potilaalle: selkokielinen yhteenveto'), terms: t('Terms used', 'Käytetyt termit'), s9: t('Sign-off', 'Hyväksyntä'),
      header: t('unsigned draft', 'allekirjoittamaton luonnos'),
      footer: t('Demonstration only. Fictional patient; public research CT. Requires clinician review and signature.', 'Vain demo. Kuvitteellinen potilas; julkinen tutkimus-TT. Vaatii lääkärin tarkistuksen ja allekirjoituksen.'),
      page: t('Page', 'Sivu'), of: t('of', '/'),
    },
  };
  return opts.skipApproval ? rep : applyApproval(rep);
}

// ---------- Key images: CT slice with outlines, plus the chest X-ray ----------
function cxrImage(rep) {
  return new Promise(resolve => {
    if (!rep.cxr?.image || typeof Image === 'undefined') return resolve(null);
    const img = new Image();
    img.onload = () => { try { const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; cv.getContext('2d').drawImage(img, 0, 0); resolve({cxr: cv.toDataURL('image/jpeg', 0.9), cxrW: cv.width, cxrH: cv.height}); } catch { resolve(null); } };
    img.onerror = () => resolve(null);
    img.src = rep.cxr.image;
  });
}
async function keyImages(rep) {
  const [ct, x] = await Promise.all([ctImages(rep), cxrImage(rep)]);
  return ct || x ? {...(ct || {}), ...(x || {})} : null;
}
function ctImages(rep) {
  return new Promise(resolve => {
    if (!rep.keyFrame || typeof Image === 'undefined') return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const draw = (size, crop) => {
          const cv = document.createElement('canvas'); cv.width = cv.height = size;
          const ctx = cv.getContext('2d');
          const [sx, sy, sw] = crop || [0, 0, 384];
          ctx.drawImage(img, sx, sy, sw, sw, 0, 0, size, size);
          const k = size / sw;
          for (const o of rep.keyFrame.outlines) {
            ctx.beginPath(); o.pts.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (x - sx) * k, (y - sy) * k)); ctx.closePath();
            ctx.lineWidth = Math.max(1.5, k * 0.9); ctx.strokeStyle = o.n === 0 ? '#e2c6ff' : '#f4c98b'; ctx.setLineDash(o.n === 0 ? [] : [4, 3]); ctx.stroke();
          }
          for (const m of rep.ai?.markers || []) {
            ctx.beginPath(); ctx.arc((m.x - sx) * k, (m.y - sy) * k, 16 * k, 0, Math.PI * 2);
            ctx.lineWidth = Math.max(2, k * 1.2); ctx.strokeStyle = '#f4c98b'; ctx.setLineDash([6, 4]); ctx.stroke();
          }
          return cv.toDataURL('image/jpeg', 0.9);
        };
        const g = rep.geometry, half = 48;
        const sx = Math.max(0, Math.min(384 - 2 * half, g.cx - half)), sy = Math.max(0, Math.min(384 - 2 * half, g.cy - half));
        resolve({full: draw(768), zoom: draw(576, [sx, sy, 2 * half])});
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = rep.keyFrame.src;
  });
}

// ---------- On-page preview ----------
const kvHTML = rows => `<dl class="rr-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
function previewHTML(rep) {
  const L = rep.labels, f = rep.findings;
  const sec = (n, title, body) => `<section class="rr-sec"><h3><span>${n}</span>${esc(title)}</h3>${body}</section>`;
  let n = 1;
  return `<article class="rr-doc" translate="no" lang="${rep.lang}" aria-label="${esc(rep.title)}">
<header class="rr-head"><div><strong>${esc(rep.title)}</strong><small>${esc(rep.id)} · ${esc(rep.name)} · ${esc(rep.reportId)} · ${esc(rep.created)}</small></div><span class="badge ${rep.approval?.state === 'approved' ? 'rr-approved' : 'amber'}">${esc(L.draft)}</span></header>
<div class="rr-bottom"><small>${esc(L.bottom)}</small><p>${esc(rep.impression.bottomLine)}</p></div>
${sec(n++, L.s1, kvHTML(rep.patient))}
${sec(n++, L.s2, kvHTML(rep.pathway))}
${sec(n++, L.s3, kvHTML(rep.context))}
${rep.technique ? sec(n++, L.s4, kvHTML(rep.technique)) : sec(n++, L.s4none, `<p>${esc(L.noImgHint)}</p>`)}
${f ? sec(n++, L.s5, `<div class="rr-img"><figure><img id="rr-full" alt="${esc(L.keyImg)}"><figcaption>${esc(L.keyImg)}</figcaption></figure><figure><img id="rr-zoom" alt="${esc(L.zoom)}"><figcaption>${esc(L.zoom)}</figcaption></figure></div><h4>${esc(L.primary)}</h4>${kvHTML(f.primary)}<h4>${esc(L.others)}</h4><ul>${f.others.map(x => `<li>${esc(x)}</li>`).join('')}</ul><h4>${esc(L.nodal)}</h4><p>${esc(f.nodal)}</p><h4>${esc(L.distant)}</h4><p>${esc(f.distant)}</p><h4>${esc(L.category)}</h4><p>${esc(f.category)}</p><h4>${esc(L.treatment)}</h4><p>${esc(f.treatment)}</p>`) : ''}
${rep.ai ? sec(n++, L.s6, `${rep.ai.summary ? `<div class="rr-bottom rr-ai ${rep.ai.verdict === 'agrees' ? '' : 'rr-ai-warn'}"><small>${esc(L.aiFinding)} · ${esc(rep.ai.verdictText)}</small><p>${esc(rep.ai.summary)}</p></div>` : ''}${rep.ai.miss ? `<p class="rr-ai-miss">${esc(rep.ai.miss)}</p>` : ''}<div class="table-wrap"><table><thead><tr>${L.aiHead.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rep.ai.rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rep.ai.report ? `<h4>${esc(L.aiReport)}</h4><blockquote class="rr-quote">${esc(rep.ai.report)}</blockquote>` : ''}<p class="rr-note">${esc(rep.ai.note)}</p>`) : ''}
${rep.cxr ? sec(n++, L.sx, `<div class="rr-cxr"><figure><img src="${esc(rep.cxr.image)}" alt="${esc(L.cxrImg)}"><figcaption>${esc(L.cxrImg)}</figcaption></figure><div><div class="rr-bottom rr-ai"><small>${esc(L.cxrFinding)}</small><p>${esc(rep.cxr.summary)}</p></div><h4>${esc(L.cxrPoints)}</h4><ul>${rep.cxr.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>${kvHTML([[L.cxrView, rep.cxr.view]])}<div class="table-wrap"><table><thead><tr>${L.cxrHead.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rep.cxr.rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="rr-note">${esc(rep.cxr.review)} ${esc(rep.cxr.note)}</p>`) : ''}
${sec(n++, L.s7, `<p class="rr-bl">${esc(rep.impression.bottomLine)}</p><h4>${esc(L.keyFindings)}</h4><ol>${rep.impression.bullets.map(x => `<li>${esc(x)}</li>`).join('')}</ol>${rep.impression.negatives.length ? `<h4>${esc(L.negatives)}</h4><ul>${rep.impression.negatives.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="rr-note">${esc(rep.impression.notEvaluated)}</p><h4>${esc(L.recs)}</h4><ol>${rep.impression.recs.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`)}
${sec(n++, L.s8, `<p>${esc(rep.plain)}</p><h4>${esc(L.terms)}</h4>${kvHTML(rep.glossary)}`)}
${sec(n++, L.s9, kvHTML(rep.signoff))}
</article>`;
}

// ---------- PDF ----------
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSPDF_URL; s.integrity = JSPDF_SRI; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
    s.onload = () => (window.jspdf?.jsPDF ? resolve(window.jspdf) : reject(new Error('PDF library unavailable')));
    s.onerror = () => reject(new Error('PDF library could not be loaded'));
    document.head.appendChild(s);
  });
}
// The built-in PDF fonts cover Latin-1 only (Finnish ä, ö, å included):
// map typographic characters and replace anything else.
const clean = s => String(s ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/[^\x00-\xFF]/g, '?');

// Shared PDF layout helpers (A4, mm). Both the clinician referral and the
// patient summary use them, so the two documents look like one family.
function makeKit(jsPDF, {base = 9.2} = {}) {
  const doc = new jsPDF({unit: 'mm', format: 'a4'});
  const W = 210, H = 297, M = 16, CW = W - 2 * M;
  const PURPLE = [103, 66, 135], INK = [50, 40, 60], MUTED = [108, 103, 113];
  const k = {doc, W, H, M, CW, PURPLE, INK, MUTED, y: 0};
  const lh = size => size * 0.3528 * 1.38;
  k.ensure = h => { if (k.y + h > H - 16) { doc.addPage(); k.y = 22; } };
  k.font = (size, bold = false, color = INK) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color); };
  k.para = (text, {size = base, bold = false, color = INK, after = 1.6} = {}) => {
    k.font(size, bold, color);
    for (const line of doc.splitTextToSize(clean(text), CW)) { k.ensure(lh(size)); doc.text(line, M, k.y + lh(size) * 0.78); k.y += lh(size); }
    k.y += after;
  };
  k.section = (n, title) => {
    k.ensure(16); k.y += 3;
    doc.setFillColor(...PURPLE); doc.roundedRect(M, k.y, 6.5, 6.5, 1.2, 1.2, 'F');
    k.font(9, true, [255, 255, 255]); doc.text(String(n), M + 3.25, k.y + 4.6, {align: 'center'});
    k.font(base + 2.8, true, PURPLE); doc.text(clean(title), M + 9, k.y + 5);
    k.y += 8.5; doc.setDrawColor(226, 223, 230); doc.setLineWidth(0.3); doc.line(M, k.y, W - M, k.y); k.y += 3;
  };
  k.sub = s => { k.ensure(9); k.y += 1.5; k.para(s, {size: base + 0.4, bold: true, color: PURPLE, after: 0.6}); };
  k.kv = (rows, LW = 52) => {
    const size = base - 0.4;
    for (const [key, v] of rows) {
      k.font(size, true, MUTED); const kl = doc.splitTextToSize(clean(key), LW - 3);
      k.font(size, false, INK); const vl = doc.splitTextToSize(clean(v), CW - LW);
      const h = Math.max(kl.length, vl.length) * lh(size) + 1.8;
      k.ensure(h);
      k.font(size, true, MUTED); kl.forEach((l, i) => doc.text(l, M, k.y + lh(size) * (i + 0.78)));
      k.font(size, false, INK); vl.forEach((l, i) => doc.text(l, M + LW, k.y + lh(size) * (i + 0.78)));
      k.y += h; doc.setDrawColor(238, 235, 241); doc.line(M, k.y - 0.9, W - M, k.y - 0.9);
    }
    k.y += 1.5;
  };
  k.list = (items, ordered = false) => items.forEach((it, i) => {
    k.font(base); const lines = doc.splitTextToSize(clean(it), CW - 6);
    k.ensure(lh(base));
    doc.text(ordered ? `${i + 1}.` : '•', M + 1, k.y + lh(base) * 0.78);
    lines.forEach(l => { k.ensure(lh(base)); doc.text(l, M + 6, k.y + lh(base) * 0.78); k.y += lh(base); });
    k.y += 1;
  });
  k.callout = (label, text, {fill = [242, 236, 248], bar = PURPLE} = {}) => {
    const size = base + 1.3;
    k.font(size, true, INK); const lines = doc.splitTextToSize(clean(text), CW - 10);
    const h = lines.length * lh(size) + 11; k.ensure(h);
    doc.setFillColor(...fill); doc.setDrawColor(...bar); doc.setLineWidth(0.8);
    doc.rect(M, k.y, CW, h, 'F'); doc.line(M, k.y, M, k.y + h);
    k.font(7.5, true, bar); doc.text(clean(label.toUpperCase()), M + 5, k.y + 5);
    k.font(size, true, INK); lines.forEach((l, i) => doc.text(l, M + 5, k.y + 9.5 + lh(size) * i));
    k.y += h + 3;
  };
  k.table = (head, rows, widths) => {
    const size = base - 0.6;
    const drawRow = (cells, bold, fill) => {
      k.font(size, bold, bold ? MUTED : INK);
      const split = cells.map((c, i) => doc.splitTextToSize(clean(c), widths[i] - 3));
      const h = Math.max(...split.map(s => s.length)) * lh(size) + 3;
      k.ensure(h);
      if (fill) { doc.setFillColor(247, 245, 249); doc.rect(M, k.y, CW, h, 'F'); }
      let x = M; split.forEach((s, i) => { s.forEach((l, j) => doc.text(l, x + 1.5, k.y + 2 + lh(size) * (j + 0.78))); x += widths[i]; });
      k.y += h; doc.setDrawColor(226, 223, 230); doc.line(M, k.y, W - M, k.y);
    };
    drawRow(head, true, true); rows.forEach(r => drawRow(r, false, false)); k.y += 2;
  };
  k.title = (title, line2, banner) => {
    doc.setFillColor(...PURPLE); doc.rect(0, 0, W, 30, 'F');
    k.font(17, true, [255, 255, 255]); doc.text(clean(title), M, 14);
    k.font(9, false, [229, 214, 243]); doc.text(clean(line2), M, 21);
    k.font(8, true, [255, 222, 170]); doc.text(clean(banner), M, 26.5);
    k.y = 36;
  };
  k.frame = (header, footer, pageWord, ofWord) => {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      if (i > 1) { k.font(7.5, false, MUTED); doc.text(clean(header), M, 11); doc.setDrawColor(226, 223, 230); doc.line(M, 13, W - M, 13); }
      k.font(7.5, false, MUTED);
      doc.text(doc.splitTextToSize(clean(footer), CW - 24), M, H - 8);
      doc.text(clean(`${pageWord} ${i} ${ofWord} ${pages}`), W - M, H - 8, {align: 'right'});
    }
  };
  return k;
}

function writePDF(jsPDF, rep, images) {
  const L = rep.labels;
  const k = makeKit(jsPDF), doc = k.doc;
  doc.setLanguage?.(rep.lang === 'fi' ? 'fi' : 'en-GB');
  doc.setProperties({title: `${rep.title} · ${rep.id}`, subject: L.banner, author: 'Candex (demonstration)', creator: 'Candex'});
  k.title(rep.title, `${rep.id} · ${rep.name} · ${rep.reportId} · ${rep.created}`, L.banner);
  k.callout(L.bottom, rep.impression.bottomLine);
  let n = 1;
  k.section(n++, L.s1); k.kv(rep.patient);
  k.section(n++, L.s2); k.kv(rep.pathway);
  k.section(n++, L.s3); k.kv(rep.context);
  k.section(n++, rep.technique ? L.s4 : L.s4none);
  if (rep.technique) k.kv(rep.technique); else k.para(L.noImg);
  if (rep.findings) {
    const f = rep.findings;
    k.section(n++, L.s5);
    if (images?.full) {
      const s1 = 74, s2 = 56; k.ensure(s1 + 12);
      doc.addImage(images.full, 'JPEG', k.M, k.y, s1, s1); doc.addImage(images.zoom, 'JPEG', k.M + s1 + 6, k.y, s2, s2);
      k.font(7.8, false, k.MUTED);
      doc.text(doc.splitTextToSize(clean(L.keyImg + (rep.ai?.markers?.length ? ` ${L.aiMarker}` : '')), s1), k.M, k.y + s1 + 4);
      doc.text(clean(L.zoom), k.M + s1 + 6, k.y + s2 + 4);
      k.y += s1 + 12;
    }
    k.sub(L.primary); k.kv(f.primary);
    k.sub(L.others); k.list(f.others);
    k.sub(L.nodal); k.para(f.nodal);
    k.sub(L.distant); k.para(f.distant);
    k.sub(L.category); k.para(f.category);
    k.sub(L.treatment); k.para(f.treatment);
  }
  if (rep.ai) {
    k.section(n++, L.s6);
    if (rep.ai.summary) k.callout(`${L.aiFinding} · ${rep.ai.verdictText}`, rep.ai.summary, rep.ai.verdict === 'agrees' ? {} : {fill: [252, 240, 223], bar: [154, 90, 41]});
    if (rep.ai.miss) k.para(rep.ai.miss, {bold: true, color: [131, 85, 29]});
    // The built-in PDF fonts cannot draw ✓ ✗ ≈, so spell the agreement out.
    const sym = v => String(v).replace(/✓/g, rep.lang === 'fi' ? 'Täsmää' : 'Match').replace(/✗/g, rep.lang === 'fi' ? 'Eroaa' : 'Differs').replace(/≈/g, '~');
    k.table(L.aiHead, rep.ai.rows.map(r => r.map(sym)), [46, 62, 36, k.CW - 144]);
    if (rep.ai.report) { k.sub(L.aiReport); k.para(`"${rep.ai.report}"`, {color: [80, 72, 88]}); }
    k.para(rep.ai.note, {size: 8.4, color: k.MUTED});
  }
  if (rep.cxr) {
    k.section(n++, L.sx);
    if (images?.cxr) {
      const w = 52, h = Math.round(w * (images.cxrH / images.cxrW || 1)); k.ensure(h + 10);
      doc.addImage(images.cxr, 'JPEG', k.M, k.y, w, h);
      k.font(7.8, false, k.MUTED); doc.text(doc.splitTextToSize(clean(L.cxrImg), w), k.M, k.y + h + 4);
      k.y += h + 10;
    }
    k.callout(L.cxrFinding, rep.cxr.summary);
    k.sub(L.cxrPoints); k.list(rep.cxr.points);
    k.kv([[L.cxrView, rep.cxr.view]]);
    k.table(L.cxrHead, rep.cxr.rows, [60, 30, k.CW - 90]);
    k.para(`${rep.cxr.review} ${rep.cxr.note}`, {size: 8.4, color: k.MUTED});
  }
  k.section(n++, L.s7);
  k.para(rep.impression.bottomLine, {size: 10, bold: true});
  k.sub(L.keyFindings); k.list(rep.impression.bullets, true);
  if (rep.impression.negatives.length) { k.sub(L.negatives); k.list(rep.impression.negatives); }
  k.para(rep.impression.notEvaluated, {size: 8.6, color: k.MUTED});
  k.sub(L.recs); k.list(rep.impression.recs, true);
  k.section(n++, L.s8); k.para(rep.plain, {size: 9.6});
  k.sub(L.terms); k.kv(rep.glossary);
  k.section(n++, L.s9); k.kv(rep.signoff);
  k.frame(`Candex · ${rep.title} · ${rep.id} · ${L.header}`, L.footer, L.page, L.of);
  return doc;
}

// ---------- Patient summary (plain language, for the patient) ----------
// Written for the person, not the clinician: larger type, short sentences,
// the symptoms they reported with what to do, and where to get help.
function buildPatient(id, opts = {}) {
  const rep = build(id, opts); // sets `lang`, reuses the same data and rules
  const S = window.candexScreening;
  const h = S?.healthPatient(rep.id) || null;
  const r = h ? S.assess(h) : null;
  const symptoms = r?.symptoms || [];
  const advice = !symptoms.length ? null
    : r.urgent ? t('Please contact your health centre within the next few days. Do not wait for a screening invitation.', 'Ota yhteyttä terveysasemaasi lähipäivinä. Älä odota seulontakutsua.')
    : r.longDuration ? t('Please book an appointment at your health centre.', 'Varaa aika terveysasemaltasi.')
    : t('If these continue for more than 3 weeks, book an appointment at your health centre.', 'Jos oireet jatkuvat yli 3 viikkoa, varaa aika terveysasemaltasi.');
  const status = s => ({up: t('Up to date', 'Ajan tasalla'), due: t('Due now', 'Ajankohtainen nyt'), notyet: t('Not yet invited', 'Ei vielä kutsuttu'), unknown: t('Check your invitation letters', 'Tarkista kutsukirjeesi'), discuss: t('Talk to your doctor', 'Keskustele lääkärisi kanssa'), noprog: t('No Finnish programme', 'Ei suomalaista ohjelmaa')})[s];
  const lng = h?.language;
  return {
    lang, id: rep.id, name: rep.name, created: rep.created,
    title: t('Your health check summary', 'Terveyskyselysi yhteenveto'),
    submitted: h?.submittedAt ? fmtDate(h.submittedAt) : null,
    main: rep.plain,
    advice,
    symptoms: symptoms.map(s => ({text: V(s.label), urgent: s.urgent})),
    duration: symptoms.length && h?.duration ? V(h.duration) : null,
    programmes: (r?.programmes || []).map(p => ({name: V(p.name), status: status(p.status), detail: V(p.detail)})),
    factors: (r?.factors || []).map(f => ({label: V(f.label), detail: V(f.detail)})),
    scan: rep.findings ? t('Your doctor will go through your CT scan with you. The summary at the top explains what it showed in everyday words.', 'Lääkärisi käy TT-kuvauksesi läpi kanssasi. Yllä oleva yhteenveto kertoo arkikielellä, mitä kuvauksessa näkyi.') : null,
    help: [
      t('Emergency: call 112.', 'Hätätilanteessa soita 112.'),
      t('Urgent medical advice, day or night: call 116117.', 'Kiireellinen hoidon tarve vuorokauden ympäri: soita 116117.'),
      ...(lng && !['Finnish', 'Swedish', 'English'].includes(lng) ? [t(`You can ask for an interpreter (${lng}) free of charge.`, `Voit pyytää maksutonta tulkkia (${V(lng).toLowerCase()}).`)] : []),
      ...(h?.support ? [t('You asked for help with travel, language, technology or cost. Your care team will contact you about it.', 'Pyysit apua matkoihin, kieleen, teknologiaan tai kustannuksiin. Hoitotiimisi ottaa sinuun yhteyttä.')] : []),
      t('Stopping smoking: free support at Stumppi.fi.', 'Tupakoinnin lopettaminen: maksutonta tukea Stumppi.fi-palvelusta.'),
    ],
    words: rep.glossary.filter(([w]) => ['CT', 'TT', 'Lung-RADS', 'PET/CT', 'PET-TT', 'Pack-year', 'Askivuosi'].includes(w)),
    L: {
      banner: t('FOR THE PATIENT · DEMONSTRATION · NOT A DIAGNOSIS', 'POTILAALLE · DEMO · EI DIAGNOOSI'),
      main: t('What this means for you', 'Mitä tämä tarkoittaa sinulle'),
      s1: t('About this summary', 'Tietoa yhteenvedosta'), s2: t('Symptoms you told us about', 'Oireet, joista kerroit'),
      s3: t('Screening that applies to you', 'Sinua koskevat seulonnat'), s4: t('Things that can lower your risk', 'Asioita, jotka voivat pienentää riskiäsi'),
      s5: t('Getting help', 'Mistä saat apua'), s6: t('Words explained', 'Sanojen selitykset'),
      name: t('Name', 'Nimi'), id: t('Your reference', 'Tunnuksesi'), when: t('Health check submitted', 'Terveyskysely lähetetty'), made: t('Summary made', 'Yhteenveto laadittu'),
      noHc: t('No health check on record', 'Ei terveyskyselyä'),
      none: t('You did not report any symptoms in the health check.', 'Et ilmoittanut terveyskyselyssä oireita.'),
      soon: t('contact care soon', 'ota pian yhteyttä hoitoon'), lasted: t('How long', 'Kesto'),
      noProg: t('No organised screening programme applies to your age group.', 'Ikäryhmääsi ei koske järjestetty seulontaohjelma.'),
      noFactors: t('Nothing from your lifestyle answers stood out. Keep it up.', 'Elintapavastauksissasi ei noussut esiin mitään. Jatka samaan malliin.'),
      footer: t('Demonstration only: fictional information. This is not a diagnosis. Your doctor will explain your results.', 'Vain demo: kuvitteellisia tietoja. Tämä ei ole diagnoosi. Lääkärisi kertoo tuloksistasi.'),
      header: t('Your health check summary', 'Terveyskyselysi yhteenveto'), page: t('Page', 'Sivu'), of: t('of', '/'),
    },
  };
}
function writePatientPDF(jsPDF, p) {
  const L = p.L, k = makeKit(jsPDF, {base: 11}), doc = k.doc;
  doc.setLanguage?.(p.lang === 'fi' ? 'fi' : 'en-GB');
  doc.setProperties({title: `${p.title} · ${p.id}`, subject: L.banner, author: 'Candex (demonstration)', creator: 'Candex'});
  k.title(p.title, `${p.name} · ${p.id} · ${p.created}`, L.banner);
  k.callout(L.main, p.main);
  if (p.advice) k.callout(t('Do this next', 'Tee seuraavaksi'), p.advice, {fill: [252, 240, 223], bar: [154, 90, 41]});
  let n = 1;
  k.section(n++, L.s1);
  k.kv([[L.name, p.name], [L.id, p.id], [L.when, p.submitted || L.noHc], [L.made, p.created]], 58);
  k.section(n++, L.s2);
  if (p.symptoms.length) {
    k.list(p.symptoms.map(s => `${s.text}${s.urgent ? ` (${L.soon})` : ''}`));
    if (p.duration) k.para(`${L.lasted}: ${p.duration}`, {color: k.MUTED});
    k.para(t('Most of these are caused by something other than cancer, but they should be checked.', 'Useimmat näistä johtuvat muusta kuin syövästä, mutta ne on hyvä tutkia.'));
  } else k.para(L.none);
  if (p.scan) k.para(p.scan);
  k.section(n++, L.s3);
  if (p.programmes.length) p.programmes.forEach(x => { k.sub(`${x.name}: ${x.status}`); k.para(x.detail); });
  else k.para(L.noProg);
  k.section(n++, L.s4);
  if (p.factors.length) p.factors.forEach(f => { k.sub(f.label); k.para(f.detail); });
  else k.para(L.noFactors);
  k.section(n++, L.s5); k.list(p.help);
  if (p.words.length) { k.section(n++, L.s6); k.kv(p.words, 40); }
  k.frame(`Candex · ${L.header} · ${p.id}`, L.footer, L.page, L.of);
  return doc;
}
function patientHTML(p) {
  const L = p.L;
  return `<article class="rr-doc" translate="no" lang="${p.lang}"><header class="rr-head"><div><strong>${esc(p.title)}</strong><small>${esc(p.name)} · ${esc(p.id)} · ${esc(p.created)}</small></div></header>
<div class="rr-bottom"><small>${esc(L.main)}</small><p>${esc(p.main)}</p></div>${p.advice ? `<div class="rr-bottom rr-advice"><p>${esc(p.advice)}</p></div>` : ''}
<section class="rr-sec"><h3><span>1</span>${esc(L.s2)}</h3>${p.symptoms.length ? `<ul>${p.symptoms.map(s => `<li>${esc(s.text)}${s.urgent ? ` <strong>(${esc(L.soon)})</strong>` : ''}</li>`).join('')}</ul>${p.duration ? `<p class="rr-note">${esc(L.lasted)}: ${esc(p.duration)}</p>` : ''}` : `<p>${esc(L.none)}</p>`}</section>
<section class="rr-sec"><h3><span>2</span>${esc(L.s3)}</h3>${p.programmes.length ? p.programmes.map(x => `<h4>${esc(x.name)}: ${esc(x.status)}</h4><p>${esc(x.detail)}</p>`).join('') : `<p>${esc(L.noProg)}</p>`}</section>
<section class="rr-sec"><h3><span>3</span>${esc(L.s4)}</h3>${p.factors.length ? p.factors.map(f => `<h4>${esc(f.label)}</h4><p>${esc(f.detail)}</p>`).join('') : `<p>${esc(L.noFactors)}</p>`}</section>
<section class="rr-sec"><h3><span>4</span>${esc(L.s5)}</h3><ul>${p.help.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section></article>`;
}

// ---------- UI on the Reports page ----------
function currentId() {
  if (selectedId && patients.some(p => p.id === selectedId)) return selectedId;
  if (state.selected && patients.some(p => p.id === state.selected)) return state.selected;
  const fresh = patients.filter(p => p.source === 'health-check');
  return (fresh.at(-1) || patients[0]).id;
}
function section() {
  const id = currentId(), rl = currentLang();
  return `<section class="card referral-card" style="margin-bottom:24px"><div class="card-head"><div><h2>Patient summary &amp; oncology referral</h2><p class="subhead">Built from the worklist, health check, linked CT and referral journey</p></div>${badge('PDF')}</div>
<div class="form-grid rr-controls"><div class="field"><label for="rr-patient">Patient</label><select id="rr-patient">${patients.map(p => `<option value="${esc(p.id)}" ${p.id === id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.id)} · ${esc(T(p.type))}</option>`).join('')}</select></div>
<div class="field"><label for="rr-service">Refer to</label><select id="rr-service"><option value="auto" ${service === 'auto' ? 'selected' : ''}>Automatic, from findings and pathway</option>${SERVICES.map(s => `<option value="${esc(s)}" ${service === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
<div class="field"><label for="rr-lang">Report language</label><select id="rr-lang"><option value="en" ${rl === 'en' ? 'selected' : ''} translate="no">English</option><option value="fi" ${rl === 'fi' ? 'selected' : ''} translate="no">Suomi</option></select></div>
<div class="field span2"><label for="rr-note">Referring clinician's note (optional)</label><textarea id="rr-note" maxlength="800" translate="no" placeholder="${esc(T('Add context the receiving team should know. Use fictional details only.'))}">${esc(note)}</textarea></div></div>
<ul class="rr-includes">${['Patient reference', 'Care pathway', 'Health-check date', 'Family history & symptoms', 'CT key image & findings', 'AI comparison (research)', 'Impression & recommendations', 'Plain-language summary'].map(x => `<li>${icon('check')}${x}</li>`).join('')}</ul>
<div class="form-actions"><small>The report is an unsigned draft for clinician review.</small><button class="button secondary" type="button" data-action="report-preview">${icon('file')}Preview</button><button class="button secondary" type="button" data-action="patient-summary-pdf">${icon('heart')}Patient summary PDF</button><button class="button" type="button" data-action="report-pdf">${icon('download')}Download PDF</button></div>
<div class="rr-approval" id="rr-approval" aria-live="polite">${approvalPanel(id)}</div>
<div id="referral-preview"></div></section>`;
}

// Approval panel on the Reports page (dates follow the site language).
const uiDate = iso => { try { return new Intl.DateTimeFormat(window.candexI18n?.lang === 'fi' ? 'fi-FI' : 'en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki'}).format(new Date(iso)); } catch { return iso; } };
function approvalPanel(id) {
  const st = approvalStatus(id), seen = previewed[id] === fingerprint(id);
  const shield = icon('shield');
  if (st.state === 'approved') {
    return `<div class="rr-approval-head">${shield}${badge(`Approved · v${st.version}`)}<span>Approved by <strong translate="no">${esc(st.by)}</strong> <span translate="no">· ${esc(uiDate(st.at))}</span>${st.released ? ' · released to the referral journey' : ''}</span></div>
<div class="form-actions"><small>Demonstration approval, not a legal e-signature. The PDF now shows the approval.</small><button type="button" class="button secondary" data-action="report-withdraw">Withdraw approval</button></div>`;
  }
  const head = st.state === 'changed'
    ? `${badge('Changed since approval', 'amber')}<span>The content changed after version ${st.version} was approved. Review it and approve again.</span>`
    : `${badge('Draft: not approved', 'neutral')}<span>Preview the report, check it, then approve it.</span>`;
  const dis = seen ? '' : 'disabled';
  return `<div class="rr-approval-head">${shield}${head}</div>
<label class="check-row"><input type="checkbox" id="rr-check-review" ${dis}><span>I have reviewed the patient details, findings and key image in this preview.</span></label>
<label class="check-row"><input type="checkbox" id="rr-check-plan" ${dis}><span>The recommendations, destination and urgency are clinically appropriate.</span></label>
<label class="check-row"><input type="checkbox" id="rr-release" checked ${dis}><span>Also release it to the patient’s referral journey (demo portal).</span></label>
<div class="form-actions"><small>${seen ? 'Approving as Dr. Emilia Koski (demo account). Not a legal e-signature.' : 'Preview this version of the report first.'}</small><button type="button" class="button" data-action="report-approve" id="rr-approve" disabled>${icon('check')}Approve report</button></div>`;
}
function updatePanel() { const el = document.querySelector('#rr-approval'); if (el && el.innerHTML !== undefined) el.innerHTML = approvalPanel(currentId()); }
async function approve() {
  const id = currentId();
  if (!document.querySelector('#rr-check-review')?.checked || !document.querySelector('#rr-check-plan')?.checked) { toast('Tick both confirmations to approve the report.'); return; }
  try {
    const a = approveNow(id, {release: !!document.querySelector('#rr-release')?.checked});
    toast(a.released ? 'Report approved and released to the referral journey.' : 'Report approved.');
  } catch (e) { toast(e.message || 'The report could not be approved.'); }
  updatePanel();
  if (document.querySelector('#referral-preview')?.innerHTML) await preview();
}
function withdraw() {
  withdrawApproval(currentId());
  toast('Approval withdrawn. A released report stays in the referral journey history.');
  updatePanel();
  if (document.querySelector('#referral-preview')?.innerHTML) preview();
}


async function preview() {
  try {
    const box = document.querySelector('#referral-preview');
    if (!box) return;
    const rep = build(currentId());
    box.innerHTML = previewHTML(rep);
    markPreviewed(rep.id); updatePanel();
    const imgs = await ctImages(rep);
    if (imgs) { const a = document.querySelector('#rr-full'), b = document.querySelector('#rr-zoom'); if (a) a.src = imgs.full; if (b) b.src = imgs.zoom; }
    box.scrollIntoView?.({behavior: 'smooth', block: 'start'});
  } catch { toast('The report preview could not be prepared.'); }
}
async function pdf() {
  try {
    const rep = build(currentId());
    toast('Preparing the PDF…');
    const [lib, imgs] = await Promise.all([loadJsPDF(), keyImages(rep)]);
    writePDF(lib.jsPDF, rep, imgs).save(`candex-${rep.lang === 'fi' ? 'lahete' : 'referral'}-${rep.id}.pdf`);
    toast(rep.approval?.state === 'approved' ? 'PDF downloaded: approved report.' : 'PDF downloaded. It is an unsigned demonstration draft.');
  } catch {
    toast('The PDF library could not load (offline?). Opening the preview instead; use your browser’s Print → Save as PDF.');
    await preview();
  }
}

// Plain-language summary for the patient (Reports page, or the patient's own health check).
async function patientPdf(id) {
  if (!id) { toast('Complete the health check first.'); return; }
  let p;
  try {
    p = buildPatient(id);
    toast('Preparing the PDF…');
    const lib = await loadJsPDF();
    writePatientPDF(lib.jsPDF, p).save(`candex-${p.lang === 'fi' ? 'yhteenveto' : 'patient-summary'}-${p.id}.pdf`);
    toast('PDF downloaded. It is an unsigned demonstration draft.');
  } catch {
    if (!p) { toast('The report preview could not be prepared.'); return; }
    toast('The PDF library could not load (offline?). Opening the preview instead; use your browser’s Print → Save as PDF.');
    showDialog(esc(p.title), patientHTML(p));
  }
}
const patientIdForRole = () => (state.role === 'patient' ? window.candexScreening?.currentPid : currentId());
// A finished PDF as a Blob, for attaching to the referral worklist.
async function pdfBlob(id, kind = 'referral', opts = {}) {
  const lib = await loadJsPDF();
  if (kind === 'patient') return writePatientPDF(lib.jsPDF, buildPatient(id, opts)).output('blob');
  const rep = build(id, opts);
  return writePDF(lib.jsPDF, rep, await keyImages(rep)).output('blob');
}

const refresh = () => { const box = document.querySelector('#referral-preview'); if (box?.innerHTML) preview(); };
document.addEventListener('change', e => {
  if (e.target.id === 'rr-patient') { selectedId = e.target.value; updatePanel(); refresh(); }
  if (e.target.id === 'rr-service') { service = e.target.value; updatePanel(); refresh(); }
  if (e.target.id === 'rr-lang') { reportLang = e.target.value; refresh(); }
  if (['rr-check-review', 'rr-check-plan'].includes(e.target.id)) { const b = document.querySelector('#rr-approve'); if (b) b.disabled = !(document.querySelector('#rr-check-review')?.checked && document.querySelector('#rr-check-plan')?.checked); }
});
document.addEventListener('input', e => { if (e.target.id === 'rr-note') { note = e.target.value; updatePanel(); } });
// "Referral report" buttons elsewhere (imaging review) open the Reports page with the patient selected.
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-report]');
  if (!b) return;
  selectedId = b.dataset.report;
  const d = document.querySelector('#dialog'); if (d?.open) d.close();
  navigate('care/reports');
  setTimeout(preview, 60);
});

window.candexI18n?.extend?.({
  'Patient summary & oncology referral': 'Potilasyhteenveto ja syöpälähete',
  'Built from the worklist, health check, linked CT and referral journey': 'Koottu työlistasta, terveyskyselystä, linkitetystä TT-kuvasta ja lähetepolusta',
  'Refer to': 'Lähete kohteeseen', 'Automatic, from findings and pathway': 'Automaattinen löydösten ja hoitopolun mukaan',
  'Report language': 'Raportin kieli',
  "Referring clinician's note (optional)": 'Lähettävän lääkärin huomio (valinnainen)',
  'Add context the receiving team should know. Use fictional details only.': 'Lisää tietoja, jotka vastaanottavan tiimin tulee tietää. Käytä vain kuvitteellisia tietoja.',
  'Health-check date': 'Terveyskyselyn päivämäärä', 'Family history & symptoms': 'Sukuhistoria ja oireet', 'CT key image & findings': 'TT-avainkuva ja löydökset',
  'AI comparison (research)': 'Tekoälyvertailu (tutkimus)', 'Impression & recommendations': 'Johtopäätös ja suositukset', 'Plain-language summary': 'Selkokielinen yhteenveto',
  'The report is an unsigned draft for clinician review.': 'Raportti on allekirjoittamaton luonnos lääkärin tarkistettavaksi.',
  'Approve report': 'Hyväksy raportti', 'Withdraw approval': 'Peru hyväksyntä', 'Draft: not approved': 'Luonnos: ei hyväksytty', 'Changed since approval': 'Muuttunut hyväksynnän jälkeen',
  'Preview the report, check it, then approve it.': 'Esikatsele raportti, tarkista se ja hyväksy se.',
  'I have reviewed the patient details, findings and key image in this preview.': 'Olen tarkistanut potilastiedot, löydökset ja avainkuvan tästä esikatselusta.',
  'The recommendations, destination and urgency are clinically appropriate.': 'Suositukset, kohde ja kiireellisyys ovat kliinisesti asianmukaisia.',
  'Also release it to the patient’s referral journey (demo portal).': 'Julkaise se myös potilaan lähetepolulle (demoportaali).',
  'Approving as Dr. Emilia Koski (demo account). Not a legal e-signature.': 'Hyväksyjä: Emilia Koski (demotili). Ei oikeudellinen sähköinen allekirjoitus.',
  'Preview this version of the report first.': 'Esikatsele ensin tämä raportin versio.',
  'Demonstration approval, not a legal e-signature. The PDF now shows the approval.': 'Demohyväksyntä, ei oikeudellinen sähköinen allekirjoitus. PDF näyttää nyt hyväksynnän.',
  'Approved by': 'Hyväksyjä', '· released to the referral journey': '· julkaistu lähetepolulle',
  'Tick both confirmations to approve the report.': 'Rastita molemmat vahvistukset hyväksyäksesi raportin.',
  'Report approved and released to the referral journey.': 'Raportti hyväksytty ja julkaistu lähetepolulle.', 'Report approved.': 'Raportti hyväksytty.',
  'Approval withdrawn. A released report stays in the referral journey history.': 'Hyväksyntä peruttu. Julkaistu raportti jää lähetepolun historiaan.',
  'Preview the current report before approving it.': 'Esikatsele nykyinen raportti ennen hyväksymistä.', 'PDF downloaded: approved report.': 'PDF ladattu: hyväksytty raportti.',
  'The report could not be approved.': 'Raporttia ei voitu hyväksyä.', 'Report approved': 'Raportti hyväksytty', 'Report not approved': 'Raporttia ei hyväksytty',
  'Patient summary PDF': 'Potilaan yhteenveto PDF', 'Download my summary (PDF)': 'Lataa yhteenvetoni (PDF)', 'Complete the health check first.': 'Täytä ensin terveyskysely.',
  'Preview': 'Esikatsele', 'Download PDF': 'Lataa PDF', 'Referral report': 'Lähetepohja',
  'Preparing the PDF…': 'Valmistellaan PDF-tiedostoa…', 'PDF downloaded. It is an unsigned demonstration draft.': 'PDF ladattu. Se on allekirjoittamaton demoluonnos.',
  'The report preview could not be prepared.': 'Raportin esikatselua ei voitu valmistella.',
  'The PDF library could not load (offline?). Opening the preview instead; use your browser’s Print → Save as PDF.': 'PDF-kirjasto ei latautunut (ei verkkoyhteyttä?). Avataan esikatselu; käytä selaimen Tulosta → Tallenna PDF-tiedostona.',
  'Pulmonology / lung cancer MDT': 'Keuhkosairaudet / keuhkosyövän moniammatillinen tiimi', 'Oncology MDT': 'Syöpätautien moniammatillinen tiimi', 'Breast clinic': 'Rintarauhaspoliklinikka',
  'Gastroenterology / colorectal surgery': 'Gastroenterologia / kolorektaalikirurgia', 'Urology': 'Urologia', 'Dermatology': 'Ihotaudit', 'Primary care review': 'Perusterveydenhuollon arvio',
}, [
  [/^Approved · v(\d+)$/, (m, n) => `Hyväksytty · v${n}`],
  [/^Report approved · v(\d+)$/, (m, n) => `Raportti hyväksytty · v${n}`],
  [/^The content changed after version (\d+) was approved\. Review it and approve it again\.$/, (m, n) => `Sisältö on muuttunut version ${n} hyväksynnän jälkeen. Tarkista ja hyväksy se uudelleen.`],
  [/^Approved, but not released: (.+)$/, (m, x) => `Hyväksytty, mutta ei julkaistu: ${window.candexI18n.lookup(x)}`],
]);

window.candexReport = {
  // Set the referring clinician's note (used by the clinical agent's "Add to referral note").
  setNote: v => { note = String(v ?? '').slice(0, 800); },
  build, buildPatient, previewHTML, approvalStatus, approveNow, withdrawApproval, markPreviewed, patientHTML, geometry, section, clean, pdfBlob,
  patientPdfDataUri: async (id, opts = {}) => { const lib = await loadJsPDF(); return writePatientPDF(lib.jsPDF, buildPatient(id, opts)).output('datauristring'); },
  // The finished PDF as a data URI (used by tests and for embedding).
  pdfDataUri: async (id, opts = {}) => { const rep = build(id || currentId(), opts); const [lib, imgs] = await Promise.all([loadJsPDF(), keyImages(rep)]); return writePDF(lib.jsPDF, rep, imgs).output('datauristring'); },
  actions: {'report-approve': () => approve(), 'report-withdraw': () => withdraw(), 'report-preview': () => preview(), 'report-pdf': () => pdf(), 'patient-summary-pdf': () => patientPdf(patientIdForRole())},
};
})();
