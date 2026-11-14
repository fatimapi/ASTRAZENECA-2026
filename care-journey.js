// The patient's care journey, driven by what actually happens in the demo:
//   1 Screening        - the patient submits a health check (each new check restarts the journey)
//   2 CT and X-ray     - the doctor marks the CT and X-ray analysis complete (Imaging review)
//   3 Results & report - the doctor reviews and releases the report; the patient books a follow-up;
//                        the doctor records the follow-up
//   4 Specialist       - the doctor issues a referral
//   5 Diagnosis, 6 Treatment & follow-up - upcoming
// Browser-local demonstration only. Loaded before app.js; reads other modules at call time.
(() => {
'use strict';
const KEY = 'candex-pathway-v1';
const AINO = {id: 'CX-1042', name: 'Aino Lehtinen'};
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' && v.imaging ? v : {imaging: {}}; } catch { return {imaging: {}}; } };
const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* memory only */ } };
const S = () => window.CandexReferralStore;
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const fmt = (iso, time = false) => {
  if (!iso) return '';
  const lang = window.candexI18n?.lang === 'fi' ? 'fi-FI' : 'en-GB';
  return new Intl.DateTimeFormat(lang, {timeZone: 'Europe/Helsinki', day: 'numeric', month: 'short', year: 'numeric', ...(time ? {hour: '2-digit', minute: '2-digit'} : {})}).format(new Date(iso));
};

// The patient shown in the patient portal: the latest health check submitted in this
// browser, otherwise the default demo patient (Aino).
function portalPatient() {
  const h = window.candexScreening?.latestCheck?.();
  if (h) return {id: h.id, name: (h.name || '').trim() || 'Health-check patient'};
  return {...AINO};
}
const healthCheck = id => window.candexScreening?.healthPatient?.(id) || null;
const imaging = id => read().imaging[id] || null;

function completeImaging(id, {ct = null, xray = false, uploaded = false} = {}) {
  const v = read();
  v.imaging[id] = {at: new Date().toISOString(), by: 'Dr. Emilia Koski', ct, xray: !!xray, ...(uploaded ? {uploaded: true} : {})};
  write(v); return v.imaging[id];
}
function undoImaging(id) { const v = read(); delete v.imaging[id]; write(v); }

// A new (or edited) health check restarts that patient's journey: imaging analysis,
// released report, booking, follow-up and referral are cleared.
function restart(id, name) {
  undoImaging(id);
  try { const store = S(); if (store) { store.select({id, name: (name || '').trim() || 'Health-check patient'}); store.reset(); } } catch { /* no journey yet */ }
  try { window.candexReport?.clearApproval?.(id); } catch { /* nothing approved */ }
}

function journeyOf(id) {
  try { const store = S(); return store?.peek?.(id) || null; } catch { return null; }
}

// The pathway stages for one patient, in the shape app.js draws.
function stages(id = portalPatient().id) {
  const h = healthCheck(id), img = imaging(id), j = journeyOf(id) || {}, cc = window.candexCtCompare?.forPatient?.(id, 'en');
  const report = j.currentReport, appt = j.activeAppointment, follow = j.currentFollowUp, decision = j.currentDecision;
  const hasStart = !!h || id === AINO.id && !!(img || report);
  const st = (done, current) => (done ? 'done' : current ? 'current' : 'upcoming');
  const s1 = st(hasStart, !hasStart);
  const s2 = st(!!img, hasStart && !img);
  const resultsDone = !!decision && decision.outcome !== 'pending';
  const s3 = st(resultsDone, !!img && !resultsDone);
  const referred = decision?.outcome === 'issued', noReferral = decision?.outcome === 'not-needed';
  const s4 = referred ? 'current' : 'upcoming';
  const resultsText = !img ? 'After the CT and X-ray analysis, your doctor reviews a report before you see it.'
    : !report ? 'Your doctor is reviewing your report. You will see it here once it has been reviewed and released.'
    : follow ? (decision?.outcome === 'pending' ? 'Your follow-up is complete. Your doctor has not yet decided whether a specialist referral is needed.' : !decision ? 'Your follow-up is complete. Your doctor is deciding whether a specialist referral is needed.' : noReferral ? 'Your doctor recorded that no specialist referral is needed.' : 'Your doctor has referred you to a specialist.')
    : appt ? 'Your report has been reviewed by your doctor and your follow-up appointment is booked.'
    : 'Your report has been reviewed by your doctor. Choose a follow-up appointment.';
  return [
    {key: 'screening', short: 'Screening', title: 'Screening', icon: 'file', status: s1,
      date: h ? fmt(h.submittedAt) : hasStart ? 'Completed' : 'Start with your health check', shortDate: h ? fmt(h.submittedAt) : hasStart ? '' : 'Health check',
      text: h ? 'You completed your health check. Your answers are with your care team, who decide the screening and tests you need.' : 'Complete your health check so your care team can recommend the right screening for you.',
      details: h ? [['Health check', `Submitted ${fmt(h.submittedAt, true)}`], ['Focus', T(h.focus || 'General')], ['Checked by', 'Dr. Emilia Koski · Care team']] : [['Next', 'Complete your health check']],
      means: 'Screening looks for early signs before symptoms appear. Being invited does not mean cancer has been found.',
      action: h ? null : ['go-health', 'Start your health check']},
    {key: 'imaging', short: 'CT and X-ray', title: 'CT and X-ray', icon: 'scan', status: s2,
      date: img ? fmt(img.at) : hasStart ? 'Being arranged' : 'After screening', shortDate: img ? fmt(img.at) : hasStart ? 'Next' : '',
      text: img ? 'Your CT scan and chest X-ray have been analysed by your doctor.' : 'A chest CT scan and X-ray look more closely at your lungs. Your doctor analyses the images.',
      details: img ? [['Analysed by', img.by], ['Analysis completed', fmt(img.at, true)], ['Images', [img.ct ? `CT ${img.ct}` : null, img.xray ? 'Chest X-ray' : null].filter(Boolean).join(' · ') || 'CT and X-ray'], ...(cc?.approved ? [['Your CT', 'Compared with public reference scans and checked by your doctor']] : [])] : [['Status', hasStart ? 'Waiting for your doctor’s analysis' : 'After screening']],
      means: 'Many lung findings are not cancer. Your doctor explains what the images show.',
      action: img ? ['scan-record', 'Understand the imaging result'] : null},
    {key: 'results', short: 'Results', title: 'Results and report', icon: 'chat', status: s3,
      date: report ? `Reviewed ${fmt(report.approvedAt)}` : img ? 'Report under review' : 'After imaging', shortDate: report ? fmt(report.approvedAt) : '',
      text: resultsText,
      details: [
        ['Report', report ? `Reviewed by ${report.approvedBy} · ${fmt(report.approvedAt, true)}` : img ? 'Your doctor is reviewing it' : 'Not yet available'],
        ['Follow-up', follow ? `Completed ${fmt(follow.completedAt)}` : appt ? `${fmt(appt.startsAt, true)} · ${appt.method}` : report ? 'Choose an appointment' : 'After the report'],
        ['Referral', decision ? (referred ? `Referred to ${decision.destination}` : noReferral ? 'No referral needed' : 'Decision pending') : 'After the follow-up'],
      ],
      means: 'You will always hear your result from a clinician, never only from an online message.',
      action: report ? ['go-referrals', appt || follow ? 'Reports & appointments' : 'Choose a follow-up appointment'] : null},
    {key: 'specialist', short: 'Specialist', title: 'Specialist examination', icon: 'doctor', status: s4,
      date: referred ? `Referred ${fmt(decision.recordedAt)}` : noReferral ? 'Not needed' : 'If referred', shortDate: referred ? fmt(decision.recordedAt) : '',
      text: referred ? `You have been referred to ${decision.destination}. The specialist team will contact you about your appointment.` : noReferral ? 'Your doctor recorded that you do not need a specialist referral at this time.' : 'If your doctor refers you, a specialist reviews your images and history and decides on any further tests.',
      details: referred ? [['Referred to', decision.destination], ['Referred by', decision.actor], ['Reason', decision.reason]] : [['Status', noReferral ? 'No referral needed' : 'Only if your doctor refers you']],
      means: 'You can ask questions and tell the team if a phone or in-person appointment suits you better.'},
    {key: 'diagnosis', short: 'Diagnosis', title: 'Diagnosis', icon: 'shield', status: 'upcoming', date: 'After the specialist', shortDate: '',
      text: 'Your test results are discussed by a multidisciplinary team of specialists. Your doctor then explains the result to you.',
      details: [['Who decides', 'Multidisciplinary team · Example']], means: 'You will always hear your result from a clinician.'},
    {key: 'treatment', short: 'Treatment', title: 'Treatment & follow-up', icon: 'heart', status: 'upcoming', date: 'After diagnosis', shortDate: '',
      text: 'If treatment is needed, you and your team agree a plan together. If no cancer is found, you may have follow-up imaging or be discharged.',
      details: [['Planned by', 'Your care team, together with you']], means: 'Your care coordinator stays with you through treatment and follow-up.'},
  ];
}
// Dated events for the "Key dates" card, oldest first.
function keyDates(id = portalPatient().id) {
  const h = healthCheck(id), img = imaging(id), j = journeyOf(id) || {};
  const out = [];
  if (h) out.push([h.submittedAt, 'Health check submitted', 'done']);
  if (img) out.push([img.at, 'CT and X-ray analysed', 'done']);
  const cc = window.candexCtCompare?.forPatient?.(id, 'en');
  if (cc?.approved) out.push([cc.approval.at, 'CT comparison checked by your doctor', 'done']);
  if (j.currentReport) out.push([j.currentReport.approvedAt, 'Report reviewed by your doctor', 'done']);
  if (j.activeAppointment) out.push([j.activeAppointment.startsAt, `Follow-up · ${j.activeAppointment.method}`, 'current']);
  if (j.currentFollowUp) out.push([j.currentFollowUp.completedAt, 'Follow-up completed', 'done']);
  if (j.currentDecision?.outcome === 'issued') out.push([j.currentDecision.recordedAt, `Referred to ${j.currentDecision.destination}`, 'current']);
  return out.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0])).map(([at, title, status]) => [fmt(at), title, status]);
}

// Reset every dashboard: all demo data in this browser, keeping language, theme and display settings.
const KEEP = new Set(['candex-lang', 'candex-theme', 'candex-display']);
function resetAll() {
  const stores = [typeof localStorage !== 'undefined' ? localStorage : null, typeof sessionStorage !== 'undefined' ? sessionStorage : null].filter(Boolean);
  for (const store of stores) {
    try {
      const keys = []; for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.startsWith('candex-') && !KEEP.has(k)) keys.push(k); }
      keys.forEach(k => store.removeItem(k));
    } catch { /* storage unavailable */ }
  }
}

window.candexI18n?.extend?.({
  "CT and X-ray analysis": "TT- ja röntgenanalyysi",
  "Not completed": "Ei valmis",
  "Completed by": "Valmistunut:",
  "Undo": "Peru",
  "The patient’s pathway now shows the CT and X-ray step as done, and the report can be released.": "Potilaan hoitopolussa TT- ja röntgenvaihe näkyy nyt valmiina, ja raportin voi julkaista.",
  "When you have reviewed the CT study": "Kun olet arvioinut TT-tutkimuksen",
  "and the chest X-ray": "ja keuhkoröntgenkuvan",
  "mark the analysis complete. The patient’s pathway moves on, and the report can then be released.": "merkitse analyysi valmiiksi. Potilaan hoitopolku etenee, ja raportin voi sen jälkeen julkaista.",
  "Mark CT and X-ray analysis complete": "Merkitse TT- ja röntgenanalyysi valmiiksi",
  "Link a CT study for this patient first.": "Linkitä ensin TT-tutkimus tälle potilaalle.",
  "CT and X-ray analysis marked complete. The patient’s pathway is updated.": "TT- ja röntgenanalyysi merkitty valmiiksi. Potilaan hoitopolku on päivitetty.",
  "Analysis marked not complete.": "Analyysi merkitty keskeneräiseksi.",
  "Complete the CT and X-ray analysis in Imaging review before releasing the report to the patient.": "Tee TT- ja röntgenanalyysi Kuvantamisen arviossa ennen raportin julkaisemista potilaalle.",
  "Reset all dashboards?": "Nollataanko kaikki koontinäkymät?",
  "Reset everything": "Nollaa kaikki",
  "Cancel": "Peruuta",
  "This clears every demo health check, imaging analysis, report, appointment and referral in this browser, for the patient, doctor and quality dashboards. Language, theme and display settings are kept.": "Tämä tyhjentää tämän selaimen kaikki demon terveyskyselyt, kuvantamisanalyysit, raportit, ajanvaraukset ja lähetteet potilaan, lääkärin ja laadun koontinäkymistä. Kieli-, teema- ja näyttöasetukset säilyvät.",
  "No appointment booked yet": "Aikaa ei ole vielä varattu",
  "After your doctor has reviewed your report, you can choose a follow-up appointment.": "Kun lääkärisi on tarkistanut raporttisi, voit valita seurantakäynnin.",
  "Not booked yet": "Ei vielä varattu",
  "Available after your report is reviewed": "Käytettävissä, kun raporttisi on tarkistettu",
  "Demo booking": "Demovaraus",
  "Appointment details": "Ajan tiedot",
  "Your key dates appear here as your care moves forward.": "Tärkeät päivämääräsi näkyvät tässä hoitosi edetessä.",
  "Your care moves through six steps. Here is what happens at each one, in simple words.": "Hoitosi etenee kuuden vaiheen kautta. Tässä selkokielellä, mitä kussakin vaiheessa tapahtuu.",
  "Pictures of your chest": "Kuvia rintakehästäsi",
  "A CT scan takes detailed pictures of your lungs, and an X-ray takes a quick picture. Both are painless.": "TT-kuvauksessa keuhkoistasi otetaan tarkkoja kuvia ja röntgenissä nopea kuva. Kumpikaan ei satu.",
  "Your doctor analyses the images and explains what they show.": "Lääkärisi analysoi kuvat ja kertoo, mitä niissä näkyy.",
  "Your results and report": "Tuloksesi ja raporttisi",
  "Your doctor reviews a report about your results before you see it.": "Lääkärisi tarkistaa tuloksistasi laaditun raportin ennen kuin näet sen.",
  "You then choose a follow-up appointment to talk it through, and your doctor decides whether a specialist should see you.": "Sen jälkeen valitset seurantakäynnin, jossa asia käydään läpi, ja lääkärisi päättää, tarvitsetko erikoislääkärin arviota.",
  'CT and X-ray': 'TT ja röntgen', 'Results and report': 'Tulokset ja raportti', 'Results': 'Tulokset', 'Screening': 'Seulonta',
  'Start with your health check': 'Aloita terveyskyselystä', 'Health check': 'Terveyskysely', 'Being arranged': 'Järjestetään', 'After screening': 'Seulonnan jälkeen', 'Next': 'Seuraavaksi',
  'Completed': 'Valmis', 'Report under review': 'Raportti tarkistettavana', 'After imaging': 'Kuvantamisen jälkeen', 'If referred': 'Jos lähete tehdään', 'Not needed': 'Ei tarpeen',
  'After the specialist': 'Erikoislääkärin jälkeen', 'After diagnosis': 'Diagnoosin jälkeen',
  'You completed your health check. Your answers are with your care team, who decide the screening and tests you need.': 'Täytit terveyskyselyn. Vastauksesi ovat hoitotiimilläsi, joka päättää tarvitsemistasi seulonnoista ja tutkimuksista.',
  'Complete your health check so your care team can recommend the right screening for you.': 'Täytä terveyskysely, jotta hoitotiimisi voi suositella sinulle sopivaa seulontaa.',
  'Screening looks for early signs before symptoms appear. Being invited does not mean cancer has been found.': 'Seulonnalla etsitään varhaisia merkkejä ennen oireita. Kutsu ei tarkoita, että syöpä olisi löydetty.',
  'Start your health check': 'Aloita terveyskysely', 'Next': 'Seuraavaksi', 'Complete your health check': 'Täytä terveyskysely', 'Focus': 'Painopiste', 'Checked by': 'Tarkistaja',
  'Your CT scan and chest X-ray have been analysed by your doctor.': 'Lääkärisi on analysoinut TT-kuvauksesi ja keuhkoröntgenkuvasi.',
  'A chest CT scan and X-ray look more closely at your lungs. Your doctor analyses the images.': 'Rintakehän TT-kuvaus ja röntgenkuva tutkivat keuhkojasi tarkemmin. Lääkärisi analysoi kuvat.',
  'Analysed by': 'Analysoija', 'Analysis completed': 'Analyysi valmis', 'Images': 'Kuvat', 'Status': 'Tila', 'Waiting for your doctor’s analysis': 'Odottaa lääkärin analyysiä',
  'Many lung findings are not cancer. Your doctor explains what the images show.': 'Monet keuhkolöydökset eivät ole syöpää. Lääkärisi kertoo, mitä kuvissa näkyy.',
  'After the CT and X-ray analysis, your doctor reviews a report before you see it.': 'TT- ja röntgenanalyysin jälkeen lääkärisi tarkistaa raportin ennen kuin näet sen.',
  'Your doctor is reviewing your report. You will see it here once it has been reviewed and released.': 'Lääkärisi tarkistaa raporttiasi. Näet sen täällä, kun se on tarkistettu ja julkaistu.',
  'Your report has been reviewed by your doctor and your follow-up appointment is booked.': 'Lääkärisi on tarkistanut raporttisi, ja seurantakäyntisi on varattu.',
  'Your report has been reviewed by your doctor. Choose a follow-up appointment.': 'Lääkärisi on tarkistanut raporttisi. Valitse seurantakäynti.',
  'Your follow-up is complete. Your doctor is deciding whether a specialist referral is needed.': 'Seurantakäyntisi on tehty. Lääkärisi päättää, tarvitaanko lähete erikoislääkärille.',
  'Your follow-up is complete. Your doctor has not yet decided whether a specialist referral is needed.': 'Seurantakäyntisi on tehty. Lääkärisi ei ole vielä päättänyt, tarvitaanko lähete erikoislääkärille.',
  'Your doctor recorded that no specialist referral is needed.': 'Lääkärisi kirjasi, ettei lähetettä erikoislääkärille tarvita.', 'Your doctor has referred you to a specialist.': 'Lääkärisi on tehnyt sinulle lähetteen erikoislääkärille.',
  'Report': 'Raportti', 'Follow-up': 'Seuranta', 'Referral': 'Lähete', 'Your doctor is reviewing it': 'Lääkärisi tarkistaa sitä', 'Not yet available': 'Ei vielä saatavilla',
  'Choose an appointment': 'Valitse aika', 'After the report': 'Raportin jälkeen', 'No referral needed': 'Lähetettä ei tarvita', 'Decision pending': 'Päätös odottaa', 'After the follow-up': 'Seurannan jälkeen',
  'Choose a follow-up appointment': 'Valitse seurantakäynti', 'Reports & appointments': 'Raportit ja ajanvaraukset',
  'Your doctor recorded that you do not need a specialist referral at this time.': 'Lääkärisi kirjasi, ettet tarvitse lähetettä erikoislääkärille tällä hetkellä.',
  'If your doctor refers you, a specialist reviews your images and history and decides on any further tests.': 'Jos lääkärisi tekee lähetteen, erikoislääkäri arvioi kuvasi ja taustasi ja päättää mahdollisista lisätutkimuksista.',
  'Referred to': 'Lähete kohteeseen', 'Referred by': 'Lähettäjä', 'Reason': 'Syy', 'Only if your doctor refers you': 'Vain jos lääkärisi tekee lähetteen',
  'Health check submitted': 'Terveyskysely lähetetty', 'CT comparison checked by your doctor': 'Lääkärisi tarkisti TT-vertailun', 'Your CT': 'TT-kuvauksesi', 'Compared with public reference scans and checked by your doctor': 'Verrattu julkisiin vertailukuvauksiin ja lääkärisi tarkistama', 'Uploaded CT comparison': 'Ladatun TT:n vertailu', 'CT and X-ray analysed': 'TT ja röntgen analysoitu', 'Report reviewed by your doctor': 'Lääkärisi tarkisti raportin', 'Follow-up completed': 'Seuranta tehty',
});
window.candexI18n?.extend?.({}, [
  [/^Welcome, (.+)\. Let’s take your next step with confidence\.$/, (_, n) => `Tervetuloa, ${n}. Otetaan seuraava askel luottavaisin mielin.`],
  [/^Submitted (.+)$/, (_, d) => `Lähetetty ${d}`], [/^Reviewed (.+)$/, (_, d) => `Tarkistettu ${d}`], 
  [/^Completed (.+)$/, (_, d) => `Valmis ${d}`], [/^Referred to (.+)$/, (_, d) => `Lähete: ${d}`], [/^Referred (\d.+)$/, (_, d) => `Lähete tehty ${d}`], [/^Reviewed by (.+?) · (.+)$/, (_, who, d) => `Tarkistanut ${who} · ${d}`],
  [/^CT (LIDC-IDRI-\d{4})(.*)$/, (_, id, rest) => `TT ${id}${rest.replace('Chest X-ray', 'keuhkoröntgen')}`],
  [/^You have been referred to (.+)\. The specialist team will contact you about your appointment\.$/, (_, d) => `Sinulle on tehty lähete: ${d}. Erikoislääkärin tiimi ottaa sinuun yhteyttä ajanvarauksesta.`],
]);
window.CandexJourney = {portalPatient, healthCheck, imaging, completeImaging, undoImaging, restart, stages, keyDates, resetAll, KEY};
})();
