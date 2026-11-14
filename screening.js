// Candex screening health check + simulated cohort for the quality KPIs.
// Loaded before app.js; uses its shared helpers (heading, badge, icon, esc,
// demoNotice) at call time. Nothing here is a validated risk model: it maps
// answers onto published screening rules and lifestyle guidance, and every
// output tells the person to discuss it with a clinician.
//
// Rule sources (checked Nov 2026):
//  - Finnish programmes: breast 50–69 every ~2 y; cervical 25–65 every 5 y
//    (some counties start at 30); colorectal FIT every 2 y, phased in by birth
//    cohort (HUS invites 60–72 in 2026), extending to 56–74 by 2031.
//    https://www.luvn.fi/en/services/health-services/health-stations/cancer-screening
//    https://stm.fi/en/screening
//  - Lung (no Finnish programme): USPSTF 2021 — age 50–80, >=20 pack-years,
//    current smoker or quit within 15 years.
//  - Prostate (no programme): EU Council Recommendation 2022/C 473/01 asks
//    countries to evaluate organised PSA + MRI testing up to age 70.
//  - Symptoms: NICE NG12 "Suspected cancer: recognition and referral" and the
//    Cancer Society of Finland (Syöpäjärjestöt) symptom guidance.
//  - Alcohol: AUDIT-C; Finnish Current Care threshold >=6 men, >=5 women.
//  - Activity: UKK Institute / WHO >=150 min moderate activity per week.
//  - Radon: STUK reference level 300 Bq/m³ for homes.
//  - IARC: processed meat Group 1; night-shift work Group 2A.
(() => {
// Translate a piece of text now (Finnish when selected). Used for text built
// from several parts, which the page-level translator cannot match whole.
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const opt = (values, current) => values.map(v => `<option value="${esc(v)}" ${current === v ? 'selected' : ''}>${esc(v)}</option>`).join('');
// Every question starts unanswered ("Choose…"), so skipping one never counts
// as an answer. The care area is the exception: it drives the symptom list.
const sel = (name, label, values, h, extra = '') => `<div class="field ${extra}"><label for="${name}">${label}</label><select id="${name}" name="${name}">${name === 'focus' ? '' : `<option value="" ${h[name] ? '' : 'selected'}>Choose…</option>`}${opt(values, h[name])}</select></div>`;
const num = (name, label, h, attrs, hint = '') => `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="number" inputmode="decimal" ${attrs} value="${esc(h[name] || '')}">${hint ? `<small>${hint}</small>` : ''}</div>`;

const sec = (name, title, first = false) => `<h3 class="form-section with-icon${first ? '' : ' space-top'}"><span class="sec-icon">${icon(name)}</span>${title}</h3>`;

const COUNTIES = ['Prefer not to say', 'Helsinki', 'East Uusimaa', 'Central Uusimaa', 'West Uusimaa', 'Vantaa and Kerava', 'Southwest Finland', 'Satakunta', 'Kanta-Häme', 'Pirkanmaa', 'Päijät-Häme', 'Kymenlaakso', 'South Karelia', 'South Savo', 'North Savo', 'North Karelia', 'Central Finland', 'South Ostrobothnia', 'Ostrobothnia', 'Central Ostrobothnia', 'North Ostrobothnia', 'Kainuu', 'Lapland', 'Åland', 'Outside Finland'];
const URBAN = new Set(['Helsinki', 'Vantaa and Kerava', 'Central Uusimaa', 'West Uusimaa', 'East Uusimaa', 'Pirkanmaa', 'Southwest Finland']);
const LANGS = ['Finnish', 'Swedish', 'Sámi', 'English', 'Russian', 'Estonian', 'Arabic', 'Somali', 'Ukrainian', 'Other'];
const NATIONAL_LANGS = new Set(['Finnish', 'Swedish']);

// Symptoms per care area. urgent:true = contact a health centre within days.
const SYMPTOMS = {
  'Lung': [
    ['cough3w', 'A cough that has lasted more than 3 weeks, or a long-standing cough that has changed'],
    ['haemoptysis', 'Coughing up blood', true],
    ['breathless', 'New or worsening shortness of breath'],
    ['chestpain', 'Chest or shoulder pain that does not go away'],
    ['infections', 'Repeated chest infections, or one that does not clear'],
    ['hoarse', 'Hoarse voice for more than 3 weeks'],
  ],
  'Breast': [
    ['lump', 'A new lump or thickening in the breast or armpit', true],
    ['shape', 'A change in the size or shape of a breast'],
    ['skin', 'Dimpling, puckering, redness or orange-peel skin'],
    ['nipple', 'Nipple turning inwards, a rash on the nipple, or discharge (especially bloody)'],
    ['breastpain', 'Pain in one breast or armpit that does not go away'],
  ],
  'Colorectal': [
    ['bleed', 'Blood in or on your stool, or bleeding from the bottom', true],
    ['habit', 'A change in bowel habit (looser, more frequent or constipation) lasting more than 3 weeks'],
    ['abdo', 'Tummy pain, bloating or a lump in the abdomen'],
    ['anaemia', 'Unusual tiredness or breathlessness (can be a sign of low iron)'],
    ['incomplete', 'Feeling you have not fully emptied your bowel'],
  ],
  'Prostate': [
    ['frequency', 'Needing to urinate more often, especially at night'],
    ['flow', 'Difficulty starting, a weak flow, or straining to urinate'],
    ['haematuria', 'Blood in urine or semen', true],
    ['bone', 'New pain in the back, hips or pelvis'],
    ['ed', 'New difficulty getting or keeping an erection'],
  ],
  'Skin': [
    ['mole', 'A new mole, or a mole that changes in size, shape or colour', true],
    ['abcde', 'A mole that is uneven, has a ragged edge, several colours or is wider than 6 mm'],
    ['molebleed', 'A mole or spot that itches, bleeds or crusts'],
    ['sore', 'A sore or patch that has not healed after 4 weeks'],
    ['nodule', 'A new shiny, pearly or firm lump on the skin'],
  ],
};
const GENERAL = [
  ['weight', 'Losing weight without trying', true],
  ['fatigue', 'Tiredness that does not get better with rest'],
  ['sweats', 'Heavy night sweats or a fever with no clear cause'],
  ['newlump', 'A new lump or swelling anywhere (neck, armpit, groin)'],
  ['bleeding', 'Unusual bleeding, including bleeding after menopause or between periods', true],
  ['swallow', 'Difficulty swallowing, or food sticking', true],
  ['heartburn', 'Persistent heartburn or indigestion'],
  ['pain', 'Pain that is new, persistent and unexplained'],
];
const symptomsFor = area => [...(SYMPTOMS[area] || []), ...GENERAL];
const ALL_SYMPTOMS = Object.fromEntries([...Object.values(SYMPTOMS).flat(), ...GENERAL].map(([id, label, urgent]) => [id, {label, urgent: !!urgent}]));

function symptomList(area, h) {
  const specific = SYMPTOMS[area] || [];
  const group = (title, list) => list.length ? `<fieldset class="symptom-group"><legend>${title}</legend>${list.map(([id, label, urgent]) =>
    `<label class="check-row"><input type="checkbox" name="sym_${id}" ${h['sym_' + id] ? 'checked' : ''}><span>${label}${urgent ? ' <span class="badge amber">Contact care soon</span>' : ''}</span></label>`).join('')}</fieldset>` : '';
  return group(specific.length ? `Signs to look out for: ${area.toLowerCase()} cancer` : '', specific) + group('General warning signs (any cancer)', GENERAL);
}

// ---------- Assessment ----------
const n = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const AUDIT = {
  freq: ['Never', 'Monthly or less', '2–4 times a month', '2–3 times a week', '4 or more times a week'],
  qty: ['1–2', '3–4', '5–6', '7–9', '10 or more'],
  binge: ['Never', 'Less than monthly', 'Monthly', 'Weekly', 'Daily or almost daily'],
};
const auditScore = h => {
  const parts = [['alc_freq', AUDIT.freq], ['alc_qty', AUDIT.qty], ['alc_binge', AUDIT.binge]].map(([k, list]) => list.indexOf(h[k]));
  if (parts[0] === 0) return 0; // non-drinkers score 0 overall
  return parts.some(p => p < 0) ? null : parts.reduce((a, b) => a + b, 0);
};
const packYears = h => {
  const perDay = n(h.cigs_per_day), years = n(h.smoke_years);
  return perDay == null || years == null ? null : Math.round(perDay / 20 * years * 10) / 10;
};

function assess(h) {
  const age = n(h.age), sex = h.sex, female = sex === 'Female', male = sex === 'Male';
  const sexUnknown = !female && !male;
  const programmes = [], factors = [];
  const add = (list, item) => list.push(item);

  // Finnish organised programmes
  if (age != null) {
    if (female || sexUnknown) {
      if (age >= 50 && age <= 69) {
        const s = {'Within the last 2 years': 'up', 'More than 2 years ago': 'due', 'Never': 'due'}[h.last_mammo] || 'unknown';
        add(programmes, {key: 'breast', name: 'Breast screening (mammography)', status: s, detail: 'Finland invites women aged 50–69 about every 2 years.', eligible: true});
      } else if (age >= 70 && age <= 74 && female) {
        add(programmes, {key: 'breast', name: 'Breast screening (mammography)', status: 'discuss', detail: 'Aged 70–74: not invited in most counties; ask whether screening is right for you.', eligible: false});
      }
      if (age >= 25 && age <= 65) {
        const s = {'Within the last 5 years': 'up', 'More than 5 years ago': 'due', 'Never': 'due'}[h.last_cervical] || 'unknown';
        add(programmes, {key: 'cervical', name: 'Cervical screening (HPV / Pap test)', status: s, detail: 'Invited every 5 years between 25 and 65 (some counties start at 30).', eligible: true});
      }
    }
    if (age >= 56 && age <= 74) {
      const s = {'Returned a kit within the last 2 years': 'up', 'Invited but did not return the kit': 'due', 'Never been invited': 'notyet'}[h.last_bowel] || 'unknown';
      const now = age >= 60 && age <= 72;
      add(programmes, {key: 'bowel', name: 'Bowel screening (home stool test, FIT)', status: s, detail: now ? 'Invited every 2 years by birth year; HUS invites everyone aged 60–72 in 2026.' : 'The programme is extending to ages 56–74 by 2031; invitations depend on your birth year and county.', eligible: true});
    }
  }
  const py = packYears(h), quitYears = n(h.quit_years);
  const smoker = h.smoking === 'Currently smoke', former = h.smoking === 'Previously smoked';
  const lungEligible = age != null && age >= 50 && age <= 80 && py != null && py >= 20 && (smoker || (former && quitYears != null && quitYears <= 15));
  if (lungEligible) add(programmes, {key: 'lung', name: 'Lung screening (low-dose CT)', status: 'noprog', detail: `No national programme in Finland. You meet the US (USPSTF 2021) criteria: age 50–80, ${py} pack-years, ${smoker ? 'currently smoking' : `quit ${quitYears} years ago`}. Ask your GP about lung-screening studies or a CT referral.`, eligible: true});
  if (male && age != null && age >= 50 && age <= 69) add(programmes, {key: 'prostate', name: 'Prostate (PSA) testing', status: 'discuss', detail: 'No programme in Finland. A PSA test has benefits and harms; it is a personal decision to make with your doctor.', eligible: false});
  if (sexUnknown && age != null) add(programmes, {key: 'organs', name: 'Screening based on your body', status: 'discuss', detail: 'Screening depends on the organs you have (for example breasts, a cervix or a prostate), not on gender. Your care team can check which invitations apply to you.', eligible: false});

  // Lifestyle and exposure factors (things to discuss, not a score)
  if (smoker) add(factors, {key: 'smoking', label: 'Smoking', detail: `Stopping smoking is the single biggest way to lower cancer risk${py != null ? ` (about ${py} pack-years so far)` : ''}. Free support: Stumppi.fi or your health centre.`});
  const audit = auditScore(h), auditCut = male ? 6 : 5;
  if (audit != null && audit >= auditCut) add(factors, {key: 'alcohol', label: 'Alcohol', detail: `AUDIT-C score ${audit} (risk threshold ${auditCut}). Alcohol is linked to at least 7 cancers, including breast and bowel.`});
  const height = n(h.height), weight = n(h.weight);
  const bmi = height && weight ? Math.round(weight / ((height / 100) ** 2) * 10) / 10 : null;
  if (bmi != null && bmi >= 30) add(factors, {key: 'weight', label: 'Body weight', detail: `BMI ${bmi}. Excess weight is linked to 13 types of cancer.`});
  if (['Less than 30 minutes', '30–149 minutes'].includes(h.activity)) add(factors, {key: 'activity', label: 'Physical activity', detail: 'Below 150 minutes of moderate activity a week (UKK Institute recommendation). Activity lowers bowel, breast and womb cancer risk.'});
  if (['Less than 6 hours', 'More than 9 hours'].includes(h.sleep)) add(factors, {key: 'sleep', label: 'Sleep', detail: 'Sleep outside 6–9 hours affects overall health. Its direct link to cancer is not established, so this is a general wellbeing point.'});
  if (h.nightshift === 'Yes, regularly') add(factors, {key: 'nightshift', label: 'Night-shift work', detail: 'IARC classifies night-shift work as probably carcinogenic (Group 2A). Keep up with breast screening if invited.'});
  if (h.processed_meat === 'Most days') add(factors, {key: 'diet', label: 'Processed meat', detail: 'Processed meat raises bowel cancer risk (IARC Group 1). Limit sausages, ham and cold cuts.'});
  if (h.fruit_veg === '0–1 portions') add(factors, {key: 'fibre', label: 'Fruit, vegetables and fibre', detail: 'Low intake. Fibre-rich diets lower bowel cancer risk; aim for at least 500 g of vegetables, fruit and berries a day.'});
  if (h.sunburn === 'Several times') add(factors, {key: 'sun', label: 'Sun exposure', detail: 'Repeated blistering sunburns raise melanoma risk. Check your skin regularly and protect it from the sun.'});
  if (h.radon === 'Measured above 300 Bq/m³') add(factors, {key: 'radon', label: 'Radon at home', detail: 'Above STUK’s 300 Bq/m³ reference level. Radon is the second biggest cause of lung cancer in Finland, and it can be reduced.'});
  if (h.radon === 'Never measured') add(factors, {key: 'radon-unknown', label: 'Radon not measured', detail: 'Radon is common in Finnish homes, especially in the south. STUK offers affordable home test kits.', minor: true});
  if (h.occupation === 'Yes') add(factors, {key: 'occupation', label: 'Work exposures', detail: 'Asbestos, silica, diesel exhaust, wood dust and some solvents raise cancer risk. Tell your occupational health service.'});
  if (h.family === 'Two or more close relatives, or one diagnosed under 50') add(factors, {key: 'family', label: 'Family history', detail: 'This pattern can mean an inherited risk (for example BRCA or Lynch syndrome). Ask whether a genetics clinic referral is right for you.'});
  else if (h.family === 'One close relative') add(factors, {key: 'family1', label: 'Family history', detail: 'One close relative with cancer. Mention which cancer and their age at diagnosis to your care team.', minor: true});
  if (h.history === 'Yes') add(factors, {key: 'history', label: 'Previous cancer', detail: 'Your follow-up plan after earlier cancer treatment takes priority over general screening.'});

  const symptoms = Object.keys(h).filter(k => k.startsWith('sym_') && h[k]).map(k => ALL_SYMPTOMS[k.slice(4)]).filter(Boolean);
  const urgent = symptoms.some(s => s.urgent);
  const longDuration = h.duration === 'More than 3 weeks';
  return {age, programmes, factors, symptoms, urgent, longDuration, bmi, audit, py, lungEligible};
}

const STATUS = {up: ['Up to date', ''], due: ['Due now', 'amber'], notyet: ['Not yet invited', 'blue'], unknown: ['Check your status', 'neutral'], discuss: ['Discuss with your doctor', 'blue'], noprog: ['No Finnish programme', 'blue']};

function resultHTML(h) {
  const r = assess(h);
  const sym = r.symptoms.length ? `<div class="notice ${r.urgent ? 'notice-urgent' : ''}"><div class="symptom-advice"><strong>${r.urgent ? 'Please contact your health centre within the next few days.' : r.longDuration ? 'Please book a health centre appointment.' : 'If these continue for more than 3 weeks, book a health centre appointment.'}</strong><p>You ticked:</p><p translate="no">${r.symptoms.map(s => esc(T(s.label))).join('; ')}</p><p>Most of these are caused by something other than cancer, but they should be checked. Do not wait for a screening invitation.</p></div></div>` : '';
  const progs = r.programmes.length ? r.programmes.map(p => `<div class="record-row screening-row"><span class="sec-icon">${icon(p.key === 'lung' || p.key === 'organs' ? 'scan' : p.key === 'prostate' ? 'user' : 'shield')}</span><div><h3>${p.name} ${badge(...STATUS[p.status])}</h3><p>${p.detail}</p></div></div>`).join('') : '<p>No organised screening programme applies to your age group. That does not replace checking symptoms.</p>';
  const facts = r.factors.length ? `<ul class="factor-list">${r.factors.map(f => `<li><span class="factor-icon">${icon('leaf')}</span><span><strong>${f.label}.</strong> ${f.detail}</span></li>`).join('')}</ul>` : '<p>Nothing from your lifestyle answers stood out. Keep it up.</p>';
  return `<div class="report-preview screening-result">DEMONSTRATION · NOT A DIAGNOSIS</div>${sym}${sec('shield', 'Screening that applies to you')}${progs}${sec('chat', 'Things you could discuss with your care team')}${facts}${h.notes ? `<h3 class="form-section space-top">Your note for the care team</h3><p translate="no">${esc(h.notes)}</p>` : ''}<p class="muted" style="font-size:.7rem">Based on Finnish screening programmes, USPSTF lung-screening criteria and published lifestyle guidance. This is not a cancer risk score. In a live service, a clinician would review your answers.</p>`;
}

// ---------- Form ----------
function healthView() {
  if (!state.health) currentPid = null;
  const h = state.health || {};
  const area = h.focus || 'General concern';
  return `${heading('Your story matters.', 'A guided check of screening, symptoms and lifestyle, to prepare for a conversation with your care team.', 'Patient health check')}${demoNotice('Try the health check with fictional information only. It maps your answers onto Finnish screening programmes and published guidance. It does not calculate cancer risk or give a diagnosis.')}
<div class="two-col"><section class="card"><div class="card-head"><h2>Tell us a little about your health</h2>${badge('About 6 minutes')}</div>${currentPid ? `<div class="editing-banner">${icon('info')}<span>You are editing health check <strong>${esc(currentPid)}</strong>. Saving updates the same patient for the care team.</span><button type="button" class="text-btn" data-action="new-health-check">Start a new health check${icon('arrow')}</button></div>` : ''}<form id="health-form">
${sec('user','About you',true)}<div class="form-grid">
<div class="field span2"><label for="name">Your name (use a made-up name)</label><input id="name" name="name" maxlength="60" autocomplete="off" translate="no" placeholder="e.g. Aino Example" value="${esc(h.name || '')}"><small>Shown to the demo care team so you can find yourself in the worklist.</small></div>
${num('age', 'Age', h, 'min="18" max="110" required placeholder="e.g. 58"')}
${sel('sex', 'Sex assigned at birth', ['Prefer not to say', 'Female', 'Male', 'Intersex'], h)}
${num('height', 'Height (cm)', h, 'min="120" max="230" placeholder="e.g. 168"')}
${num('weight', 'Weight (kg)', h, 'min="30" max="300" placeholder="e.g. 72"', 'Used only to work out your BMI.')}
</div>
${sec('chat','What would you like to discuss?')}<div class="form-grid">
${sel('focus', 'Care area', ['General concern', 'Lung', 'Breast', 'Colorectal', 'Prostate', 'Skin', 'Other / unsure'], {focus: area})}
${sel('symptoms', 'Reason for your check', ['A new or persistent symptom', 'A screening invitation', 'Family history', 'An existing referral', 'General information'], h)}
${sel('duration', 'How long have you noticed it?', ['Not applicable', 'Less than 2 weeks', '2–3 weeks', 'More than 3 weeks'], h, 'span2')}
</div><div id="symptom-list" aria-live="polite">${symptomList(area, h)}</div>
${sec('leaf','Smoking and alcohol')}<div class="form-grid">
${sel('smoking', 'Smoking', ['Prefer not to say', 'Never smoked', 'Previously smoked', 'Currently smoke'], h, 'span2')}
${num('cigs_per_day', 'Cigarettes a day (when smoking)', h, 'min="0" max="100" placeholder="e.g. 15"')}
${num('smoke_years', 'Years smoked in total', h, 'min="0" max="90" placeholder="e.g. 30"')}
${num('quit_years', 'Years since you quit (if you have)', h, 'min="0" max="90" placeholder="e.g. 5"', 'Used to check lung-screening criteria.')}
${sel('alc_freq', 'How often do you drink alcohol?', AUDIT.freq, h)}
${sel('alc_qty', 'Drinks on a typical drinking day', AUDIT.qty, h)}
${sel('alc_binge', 'How often do you have 6 or more drinks at once?', AUDIT.binge, h)}
</div><p class="field-note">One drink = a 33 cl bottle of beer, 12 cl of wine or 4 cl of spirits.</p>
${sec('heart','Everyday life')}<div class="form-grid">
${sel('activity', 'Moderate activity per week (brisk walking, cycling…)', ['Less than 30 minutes', '30–149 minutes', '150–299 minutes', '300 minutes or more'], h)}
${sel('sleep', 'Sleep on a typical night', ['Less than 6 hours', '6–7 hours', '7–9 hours', 'More than 9 hours'], h)}
${sel('nightshift', 'Do you work night shifts?', ['No', 'Occasionally', 'Yes, regularly'], h)}
${sel('fruit_veg', 'Portions of vegetables, fruit or berries a day', ['0–1 portions', '2–4 portions', '5 or more portions'], h)}
${sel('processed_meat', 'How often do you eat processed meat (ham, sausage)?', ['Rarely or never', 'A few times a week', 'Most days'], h)}
${sel('sunburn', 'Blistering sunburn in your life', ['Never', 'Once or twice', 'Several times'], h)}
</div>
${sec('file','Health history and exposures')}<div class="form-grid">
${sel('family', 'Close relatives (parent, sibling, child) with cancer', ['Not sure / prefer not to say', 'No known family history', 'One close relative', 'Two or more close relatives, or one diagnosed under 50'], h, 'span2')}
${sel('history', 'Have you had cancer before?', ['No', 'Yes', 'Prefer not to say'], h)}
${sel('hpv', 'HPV vaccine', ['Not sure', 'Yes', 'No'], h)}
${sel('radon', 'Radon at home', ['Never measured', 'Measured below 300 Bq/m³', 'Measured above 300 Bq/m³', 'Not sure'], h)}
${sel('occupation', 'Work exposure to asbestos, silica, diesel or solvents', ['No', 'Yes', 'Not sure'], h)}
</div>
${sec('location','Where you live and how care works for you')}<div class="form-grid">
${sel('region', 'Wellbeing services county', COUNTIES, h)}
${sel('travel', 'Travel time to your health centre', ['Under 15 minutes', '15–30 minutes', '30–60 minutes', 'Over 60 minutes'], h)}
${sel('language', 'Language you prefer for health information', LANGS, h)}
${sel('route', 'Where you usually get care', ['Public health centre', 'Occupational health', 'Private clinic', 'Student health (YTHS)', 'No regular place'], h)}
${sel('contact', 'Preferred consultation', ['Video consultation', 'Phone call', 'In person'], h)}
</div><label class="check-row"><input type="checkbox" name="support" ${h.support ? 'checked' : ''}>I would like help with travel, language, technology or the cost of accessing care.</label>
<div class="field space-top"><label for="notes">Anything else you would like your team to know? (optional)</label><textarea id="notes" name="notes" maxlength="1500" translate="no" placeholder="${esc(T('For example, a change you’ve noticed or a question you want to ask.'))}">${esc(h.notes || '')}</textarea></div>
<div class="form-actions"><small>Demo only: kept in this browser tab. Submitting shows you to the demo care team (Doctor view).</small><button type="submit" class="button">See my summary${icon('arrow')}</button></div></form></section>
<aside class="stack"><div class="health-art"><img src="health-illustration.svg" alt="" width="320" height="220"><p>Six short sections. Skip anything you prefer not to answer.</p></div><div class="info-panel">${icon('shield')}<h3>You’re in control</h3><p>Share only what feels comfortable. Where you live, your language and access needs help the team plan support; they are not treated as signs of cancer.</p><h3>What you get</h3><ul><li>Which Finnish screening programmes apply to you, and whether you are due.</li><li>Symptoms that mean you should not wait for screening.</li><li>Lifestyle points worth discussing, with the evidence behind them.</li></ul></div><div class="card"><h3>If you need help now</h3><p class="subhead" style="margin-bottom:0;font-size:.77rem">Do not wait for an online review if you feel seriously unwell. In Finland, call <a href="tel:112">112</a> for an emergency or <a href="tel:116117">116117</a> for urgent medical advice.</p></div></aside></div>`;
}

function summaryHTML() {
  return state.health ? (currentPid ? `<div class="notice sent-notice">${icon('check')}<span>Added to the demo care team as <strong>${esc(currentPid)}</strong>. Switch to <strong>Doctor</strong> to see it in the workspace, patient worklist and Quality &amp; equity.</span></div>` : '') + resultHTML(state.health) + (currentPid && window.candexReport ? `<div class="form-actions" style="justify-content:flex-start;margin:6px 0 14px"><button type="button" class="button secondary" data-action="patient-summary-pdf">${icon('download')}Download my summary (PDF)</button></div>` : '') : `<p>You haven’t completed a demo health check yet.</p>${goButton('health', 'Start health check', true, 'patient')}`;
}

// Update the symptom checklist when the care area changes, keeping ticks.
document.addEventListener('change', e => {
  if (e.target.id !== 'focus') return;
  const form = e.target.form, box = document.getElementById('symptom-list');
  if (!form || !box) return;
  const ticks = Object.fromEntries([...form.querySelectorAll('input[name^="sym_"]')].map(i => [i.name, i.checked]));
  box.innerHTML = symptomList(e.target.value, ticks);
});

// ---------- Simulated cohort (n = 50) ----------
// A fixed seed so every teammate and judge sees the same 50 people. Seed 39
// was picked from a search because every KPI then has cases (>=4
// lung-eligible people, >=8 people in each comparison group). People
// with other languages and remote homes are deliberately oversampled, as an
// equity survey would, so the gaps are visible in a cohort of 50.
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function simulate(seed = 39, size = 50) {
  const rnd = mulberry32(seed);
  const pick = (list, weights) => { let x = rnd() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < list.length; i++) { x -= weights[i]; if (x < 0) return list[i]; } return list.at(-1); };
  const chance = p => rnd() < p;
  const out = [];
  for (let i = 0; i < size; i++) {
    const age = 30 + Math.floor(rnd() * 51); // 30–80
    const sex = chance(0.52) ? 'Female' : 'Male';
    const region = pick(['Helsinki', 'Vantaa and Kerava', 'Pirkanmaa', 'Southwest Finland', 'North Ostrobothnia', 'North Savo', 'North Karelia', 'Kainuu', 'Lapland', 'Ostrobothnia'], [4, 2, 3, 2, 2, 2, 1.5, 1, 1.5, 1]);
    const urban = URBAN.has(region);
    const travel = urban ? pick(['Under 15 minutes', '15–30 minutes', '30–60 minutes'], [5, 4, 1]) : pick(['15–30 minutes', '30–60 minutes', 'Over 60 minutes'], [3, 4, 3]);
    const language = region === 'Ostrobothnia' ? pick(['Swedish', 'Finnish'], [6, 4]) : pick(['Finnish', 'Swedish', 'Russian', 'Arabic', 'Estonian', 'English', 'Somali', 'Ukrainian'], [52, 6, 9, 7, 7, 6, 6, 7]);
    const route = age < 65 && chance(0.45) ? 'Occupational health' : pick(['Public health centre', 'Private clinic', 'No regular place'], [8, 1, 1]);
    const smoking = pick(['Never smoked', 'Previously smoked', 'Currently smoke'], [55, 30, 15]);
    const ever = smoking !== 'Never smoked';
    const smoke_years = ever ? Math.min(age - 16, 8 + Math.floor(rnd() * 35)) : '';
    const cigs_per_day = ever ? 5 + Math.floor(rnd() * 21) : '';
    const quit_years = smoking === 'Previously smoked' ? 1 + Math.floor(rnd() * 25) : '';
    const height = sex === 'Female' ? 158 + Math.floor(rnd() * 18) : 170 + Math.floor(rnd() * 20);
    const bmiTarget = 20 + rnd() * 14;
    const weight = Math.round(bmiTarget * (height / 100) ** 2);
    const remote = travel === 'Over 60 minutes';
    const otherLang = !NATIONAL_LANGS.has(language);
    // Simulated participation: lower with long travel, a non-national language
    // and no regular place of care, as reported in Finnish screening research.
    const pAttend = Math.max(0.2, 0.85 - (remote ? 0.25 : travel === '30–60 minutes' ? 0.1 : 0) - (otherLang ? 0.25 : 0) - (route === 'No regular place' ? 0.2 : 0));
    const area = pick(['General concern', 'Lung', 'Breast', 'Colorectal', 'Prostate', 'Skin'], [5, 2, sex === 'Female' ? 2 : 0, 2, sex === 'Male' ? 2 : 0, 1]);
    const h = {
      id: `HC-${String(101 + i)}`, simulated: true, age: String(age), sex, height: String(height), weight: String(weight), region, travel, language, route,
      smoking, cigs_per_day: String(cigs_per_day), smoke_years: String(smoke_years), quit_years: String(quit_years),
      alc_freq: pick(AUDIT.freq, [15, 30, 30, 18, 7]), alc_qty: pick(AUDIT.qty, [50, 28, 12, 7, 3]), alc_binge: pick(AUDIT.binge, [35, 35, 18, 10, 2]),
      activity: pick(['Less than 30 minutes', '30–149 minutes', '150–299 minutes', '300 minutes or more'], [12, 35, 35, 18]),
      sleep: pick(['Less than 6 hours', '6–7 hours', '7–9 hours', 'More than 9 hours'], [12, 30, 52, 6]),
      nightshift: pick(['No', 'Occasionally', 'Yes, regularly'], [78, 12, 10]),
      fruit_veg: pick(['0–1 portions', '2–4 portions', '5 or more portions'], [28, 55, 17]),
      processed_meat: pick(['Rarely or never', 'A few times a week', 'Most days'], [25, 50, 25]),
      sunburn: pick(['Never', 'Once or twice', 'Several times'], [30, 45, 25]),
      family: pick(['Not sure / prefer not to say', 'No known family history', 'One close relative', 'Two or more close relatives, or one diagnosed under 50'], [12, 50, 30, 8]),
      history: chance(0.06) ? 'Yes' : 'No', hpv: age < 40 ? pick(['Yes', 'No', 'Not sure'], [5, 3, 2]) : 'No',
      radon: pick(['Never measured', 'Measured below 300 Bq/m³', 'Measured above 300 Bq/m³', 'Not sure'], [60, 25, 7, 8]),
      occupation: pick(['No', 'Yes', 'Not sure'], [80, 10, 10]),
      last_mammo: chance(pAttend) ? 'Within the last 2 years' : pick(['More than 2 years ago', 'Never'], [6, 4]),
      last_cervical: chance(pAttend - 0.05) ? 'Within the last 5 years' : pick(['More than 5 years ago', 'Never'], [6, 4]),
      last_bowel: age >= 60 && age <= 72 ? (chance(pAttend - 0.1) ? 'Returned a kit within the last 2 years' : 'Invited but did not return the kit') : age >= 56 && age <= 74 ? 'Never been invited' : 'Not applicable',
      focus: area, duration: 'Not applicable', symptoms: 'General information',
      support: remote || otherLang ? chance(0.6) : chance(0.1),
    };
    if (chance(0.3)) { // about 30% report a symptom
      const list = symptomsFor(area); const [id] = list[Math.floor(rnd() * list.length)];
      h['sym_' + id] = 'on'; h.symptoms = 'A new or persistent symptom';
      h.duration = pick(['Less than 2 weeks', '2–3 weeks', 'More than 3 weeks'], [3, 3, 4]);
      // simulated days from health check to a GP appointment
      h.days_to_gp = Math.round((route === 'Occupational health' ? 2 : route === 'Private clinic' ? 3 : 9) + rnd() * (remote ? 16 : 8));
    }
    if (chance(0.08)) h.smoking = 'Prefer not to say'; // realistic missing answers
    out.push(h);
  }
  return out;
}
const COHORT = simulate();

// ---------- KPIs from the cohort ----------
const pct = (a, b) => b ? Math.round(a / b * 100) : null;
const fmtPct = (a, b) => b ? `${pct(a, b)}%` : '—';
const median = xs => { xs = xs.filter(x => typeof x === 'number' && !isNaN(x)); if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------- Health checks submitted from the patient form ----------
// Kept for this browser tab (sessionStorage), so a page refresh during a demo
// does not lose them. Each submission becomes a worklist patient.
const STORE = 'candex-health-checks';
let submitted = [];
try { submitted = JSON.parse(sessionStorage.getItem(STORE) || '[]'); } catch { submitted = []; }
let currentPid = null; // the record the open health-check form edits
const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(submitted)); } catch { /* storage unavailable */ } };
const TYPE = {'General concern': 'General', 'Other / unsure': 'General'};
const liveList = () => (typeof patients !== 'undefined' ? patients : null);

function toPatient(h) {
  const r = assess(h);
  const name = (h.name || '').trim() || 'New health-check patient';
  const initials = name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  const due = r.programmes.filter(p => p.status === 'due').map(p => p.key);
  return {
    id: h.id, name, age: Number(h.age) || '—', type: TYPE[h.focus] || h.focus || 'General',
    region: h.region && h.region !== 'Prefer not to say' ? h.region : 'Region not stated',
    // Priority follows clinical need only (symptoms), never region or language.
    priority: r.urgent ? 'Priority review' : 'Routine review',
    reason: r.urgent ? 'Health check: symptom needing contact within days' : r.symptoms.length ? 'Health check: symptom to assess' : due.length ? `Health check: ${due.join(' and ')} screening due` : 'Health check submitted',
    initials: initials || 'HC', status: 'New health check', source: 'health-check', submittedAt: h.submittedAt,
  };
}
function upsertPatient(h) {
  const list = liveList(); if (!list) return;
  const p = toPatient(h), i = list.findIndex(x => x.id === p.id);
  if (i >= 0) list[i] = p; else list.push(p);
}
function register(data) {
  const existing = currentPid && submitted.find(h => h.id === currentPid);
  const id = existing ? currentPid : `HC-${2001 + submitted.length}`;
  const h = {...data, id, submittedAt: existing?.submittedAt || new Date().toISOString()};
  if (existing) submitted[submitted.indexOf(existing)] = h; else submitted.push(h);
  currentPid = id;
  save(); upsertPatient(h);
  if (h.focus === 'Lung') window.candexImaging?.autoLink(id);
  return h;
}
// Runs before app.js's submit handler (this script loads first).
document.addEventListener('submit', e => {
  const form = e.target;
  if (form?.id !== 'health-form') return;
  register(Object.fromEntries(new FormData(form)));
});
// Called once by app.js before the first render, after `patients` exists.
function restore() { submitted.forEach(upsertPatient); submitted.forEach(h => { if (h.focus === 'Lung') window.candexImaging?.autoLink(h.id); }); }
const healthPatient = id => submitted.find(h => h.id === id);

// ---------- KPIs ----------
const fullCohort = () => [...COHORT, ...submitted.map(h => ({...h, fromForm: true}))];

function kpis(cohort = fullCohort()) {
  const rows = cohort.map(h => ({h, r: assess(h)}));
  const progSlots = rows.flatMap(({h, r}) => r.programmes.filter(p => p.eligible && ['breast', 'cervical', 'bowel'].includes(p.key) && !['notyet', 'unknown'].includes(p.status)).map(p => ({h, p})));
  const upToDate = s => s.filter(x => x.p.status === 'up').length;
  const byProg = k => { const s = progSlots.filter(x => x.p.key === k); return {n: s.length, up: upToDate(s)}; };
  const group = (label, f) => { const s = progSlots.filter(x => f(x.h)); return {label, n: s.length, people: new Set(s.map(x => x.h.id)).size, up: upToDate(s), rate: pct(upToDate(s), s.length)}; };
  const near = group('Travel under 30 min', h => ['Under 15 minutes', '15–30 minutes'].includes(h.travel));
  const far = group('Travel 30 min or more', h => ['30–60 minutes', 'Over 60 minutes'].includes(h.travel));
  const natLang = group('Finnish or Swedish', h => NATIONAL_LANGS.has(h.language));
  const othLang = group('Other languages', h => h.language && !NATIONAL_LANGS.has(h.language));
  const urban = group('Urban counties', h => URBAN.has(h.region));
  const rural = group('Other counties', h => h.region && !URBAN.has(h.region) && h.region !== 'Prefer not to say');
  const occ = group('Occupational health', h => h.route === 'Occupational health');
  const pub = group('Public health centre', h => h.route === 'Public health centre');
  const symptomatic = rows.filter(x => x.r.symptoms.length);
  const days = k => median(symptomatic.filter(x => k(x.h)).map(x => x.h.days_to_gp));
  const answered = cohort.reduce((acc, h) => { const keys = ['age', 'sex', 'smoking', 'family', 'region', 'radon', 'language', 'travel']; return acc + keys.filter(k => h[k] && !/prefer not|not sure/i.test(h[k])).length; }, 0);
  const share = f => rows.filter(f).length;
  return {
    n: cohort.length, simulated: cohort.filter(h => !h.fromForm).length, fromForm: cohort.filter(h => h.fromForm).length, rows,
    breast: byProg('breast'), cervical: byProg('cervical'), bowel: byProg('bowel'),
    overall: {n: progSlots.length, up: upToDate(progSlots)},
    lungEligible: share(x => x.r.lungEligible),
    symptomatic: symptomatic.length, urgent: symptomatic.filter(x => x.r.urgent).length,
    medianDays: median(symptomatic.map(x => x.h.days_to_gp)), daysOcc: days(h => h.route === 'Occupational health'), daysPub: days(h => h.route === 'Public health centre'),
    travelGap: near.rate != null && far.rate != null ? near.rate - far.rate : null,
    langGap: natLang.rate != null && othLang.rate != null ? natLang.rate - othLang.rate : null,
    groups: [near, far, natLang, othLang, urban, rural, occ, pub],
    smokers: share(x => x.h.smoking === 'Currently smoke'), alcohol: share(x => x.r.factors.some(f => f.key === 'alcohol')),
    inactive: share(x => x.r.factors.some(f => f.key === 'activity')), obese: share(x => x.r.bmi >= 30),
    support: share(x => x.h.support), genetics: share(x => x.r.factors.some(f => f.key === 'family')),
    completeness: pct(answered, cohort.length * 8),
  };
}

// ---------- Doctor pages ----------
const personRow = ({h, r}) => `<tr${h.fromForm ? ' class="row-new"' : ''}><td><strong>${esc(h.id)}</strong>${h.fromForm ? `<small>${esc(h.name || 'Health-check patient')}</small>` : ''}</td><td>${esc(h.age)} · ${h.sex ? esc(T(h.sex)[0]) : '—'}</td><td>${esc(h.region || '—')}</td><td>${esc(h.travel || '—')}</td><td>${esc(h.language || '—')}</td><td>${esc(h.route || '—')}</td><td translate="no">${r.programmes.filter(p => p.status === 'due').map(p => T(p.key)).join(', ') || '—'}</td><td>${r.symptoms.length ? (r.urgent ? badge('Within days', 'amber') : badge('Book GP', 'blue')) : '—'}</td><td translate="no">${r.factors.filter(f => !f.minor).map(f => T(f.label)).join(', ') || '—'}</td></tr>`;
const peopleTable = (rows, caption) => `<div class="table-wrap"><table><caption class="sr-only">${caption}</caption><thead><tr><th>ID</th><th>Age · sex</th><th>County</th><th>Travel</th><th>Language</th><th>Care route</th><th>Screening due</th><th>Symptoms</th><th>Factors</th></tr></thead><tbody>${rows.map(personRow).join('')}</tbody></table></div>`;

function cohortView() {
  const k = kpis();
  const tile = (title, value, detail) => `<article class="metric"><p>${title}</p><strong>${value}</strong><small>${detail}</small></article>`;
  const gap = g => g == null ? '—' : `${Math.abs(g)} pp`;
  const lowN = g => g.people < 5 ? ' <span class="badge neutral">Low n</span>' : '';
  const newRows = k.rows.filter(x => x.h.fromForm).reverse();
  return `${heading('Measure the gaps in screening.', 'Which of your health-check patients are up to date with screening, and who is being left behind.', 'Quality & equity', `<button class="button secondary" data-action="export-cohort">${icon('download')}Export cohort CSV</button>`)}${demoNotice(`Simulated cohort of ${k.simulated} people${k.fromForm ? ` plus ${k.fromForm} health check${k.fromForm === 1 ? '' : 's'} submitted in this session` : ''}. Calculated live with the same rules as the patient form. Not Finnish health data.`)}
<div class="cohort-strip">${badge(`${k.simulated} simulated`, 'amber')}${badge(`${k.fromForm} from the patient form`, k.fromForm ? '' : 'neutral')}<span class="muted">Fill in the patient health check to add someone here.</span>${goButton('health', 'Open patient health check', false, 'patient')}</div>
<div class="metric-grid">
${tile('Screening up to date', fmtPct(k.overall.up, k.overall.n), `${k.overall.up} of ${k.overall.n} eligible programme invitations (breast, cervical, bowel)`)}
${tile('Participation gap: travel', gap(k.travelGap), `Up to date: ${k.groups[0].rate ?? '—'}% under 30 min vs ${k.groups[1].rate ?? '—'}% at 30 min or more`)}
${tile('Participation gap: language', gap(k.langGap), `Up to date: ${k.groups[2].rate ?? '—'}% Finnish/Swedish vs ${k.groups[3].rate ?? '—'}% other languages`)}
${tile('Symptom to GP appointment', k.medianDays == null ? '—' : `${k.medianDays} d`, `Median for people reporting symptoms (${k.symptomatic} people, ${k.urgent} needing contact within days)`)}
${tile('Breast screening', fmtPct(k.breast.up, k.breast.n), `${k.breast.up} of ${k.breast.n} women aged 50–69 screened within 2 years`)}
${tile('Cervical screening', fmtPct(k.cervical.up, k.cervical.n), `${k.cervical.up} of ${k.cervical.n} women aged 25–65 screened within 5 years`)}
${tile('Bowel kits returned', fmtPct(k.bowel.up, k.bowel.n), `${k.bowel.up} of ${k.bowel.n} invited people returned a kit within 2 years`)}
${tile('Lung screening: unmet need', String(k.lungEligible), 'Meet USPSTF criteria, but Finland has no lung programme')}
</div>
${newRows.length ? `<section class="card cohort-new" style="margin-bottom:24px"><div class="card-head"><h2>New from the patient health check</h2>${badge(`${newRows.length} this session`)}</div>${peopleTable(newRows, 'Health checks submitted in this session')}</section>` : ''}
<div class="two-col"><section class="card"><div class="card-head"><h2>Who is up to date with screening?</h2>${badge('Up-to-date rate', 'neutral')}</div><div class="table-wrap"><table><caption class="sr-only">Screening up-to-date rate by group</caption><thead><tr><th>Group</th><th>People</th><th>Up to date</th><th>Rate</th></tr></thead><tbody>${k.groups.map(g => `<tr><td>${g.label}${lowN(g)}</td><td>${g.people}</td><td>${g.up} / ${g.n}</td><td><strong>${g.rate == null ? '—' : g.rate + '%'}</strong></td></tr>`).join('')}</tbody></table></div><p class="field-note">Groups with fewer than 5 people are flagged; with real data they would be suppressed. Other-language speakers and remote residents are oversampled. Simulated participation is lowered for long travel, other languages and no regular place of care, reflecting published Finnish screening research.</p></section>
<section class="card"><div class="card-head"><h2>Prevention and support signals</h2>${icon('heart')}</div>
<div class="data-line"><span>Currently smoking</span><strong>${k.smokers} of ${k.n} · ${fmtPct(k.smokers, k.n)}</strong></div>
<div class="data-line"><span>AUDIT-C above risk threshold</span><strong>${k.alcohol} · ${fmtPct(k.alcohol, k.n)}</strong></div>
<div class="data-line"><span>Under 150 min activity a week</span><strong>${k.inactive} · ${fmtPct(k.inactive, k.n)}</strong></div>
<div class="data-line"><span>BMI 30 or more</span><strong>${k.obese} · ${fmtPct(k.obese, k.n)}</strong></div>
<div class="data-line"><span>Possible inherited risk (genetics referral)</span><strong>${k.genetics}</strong></div>
<div class="data-line"><span>Asked for access support</span><strong>${k.support} · ${fmtPct(k.support, k.n)}</strong></div>
<div class="data-line"><span>Median days to GP: occupational vs public</span><strong>${k.daysOcc ?? '—'} d vs ${k.daysPub ?? '—'} d</strong></div>
<div class="data-line"><span>Core answers complete</span><strong>${k.completeness}%</strong></div></section></div>
<section class="card" style="margin-bottom:24px"><details class="cohort-details"><summary>View all ${k.n} people in the cohort</summary>${peopleTable(k.rows, 'Health check cohort')}</details></section>`;
}

// Workspace card: new patients arriving from the patient health check.
function newChecksCard() {
  const list = liveList() || [];
  const fresh = submitted.map(h => list.find(p => p.id === h.id)).filter(Boolean).reverse();
  return `<section class="card new-checks" style="margin-bottom:24px"><div class="card-head"><div><h2>New health checks</h2><p class="subhead">Submitted by patients through the Candex health check</p></div>${badge(fresh.length ? `${fresh.length} new` : 'None yet', fresh.length ? 'amber' : 'neutral')}</div>${fresh.length ? fresh.map(p => `<div class="record-row"><span class="avatar">${esc(p.initials)}</span><div><h3>${esc(p.name)} <span class="muted" style="font-weight:400">· ${esc(p.age)} · ${esc(p.id)}</span></h3><p translate="no">${esc(T(p.type))} · ${esc(T(p.reason))}</p></div>${p.priority === 'Priority review' ? badge('Priority', 'amber') : ''}<button class="text-btn" data-case="${esc(p.id)}">Open${icon('arrow')}</button><button class="text-btn" data-scan="${esc(p.id)}">${icon('scan')}Imaging</button></div>`).join('') : `<p class="muted" style="font-size:.78rem">When a patient completes the health check, they appear here, in the patient worklist and in Quality &amp; equity.</p>${goButton('health', 'Try the patient health check', false, 'patient')}`}</section>`;
}

// Dialog content when a doctor opens a health-check patient.
function patientDialog(id) {
  const h = healthPatient(id); if (!h) return null;
  return `<p translate="no">${esc(h.id)} · ${esc(h.age)} ${T('years')} · ${esc(T(h.region || 'Region not stated'))} · ${esc(T(h.language || 'Language not stated'))}</p><p>Submitted through the patient health check in this session</p>${resultHTML(h)}<div class="form-actions"><button class="button" data-scan="${esc(h.id)}">${icon('scan')}Imaging review</button></div>`;
}

function exportCohort() {
  const cols = ['id', 'source', 'age', 'sex', 'region', 'travel', 'language', 'route', 'smoking', 'pack_years', 'audit_c', 'bmi', 'activity', 'sleep', 'family', 'radon', 'breast', 'cervical', 'bowel', 'lung_uspstf', 'symptoms', 'urgent', 'days_to_gp', 'support'];
  const lines = [cols.join(',')].concat(kpis().rows.map(({h, r}) => {
    const st = k => r.programmes.find(p => p.key === k)?.status || '';
    return [h.id, h.fromForm ? 'health check' : 'simulated', h.age, h.sex, h.region, h.travel, h.language, h.route, h.smoking, r.py ?? '', r.audit ?? '', r.bmi ?? '', h.activity, h.sleep, h.family, h.radon, st('breast'), st('cervical'), st('bowel'), r.lungEligible ? 'yes' : 'no', r.symptoms.map(s => s.label).join('; '), r.urgent ? 'yes' : 'no', h.days_to_gp ?? '', h.support ? 'yes' : 'no']
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
  }));
  download('candex-health-check-cohort.csv', lines.join('\n'), 'text/csv');
}

window.candexScreening = {
  healthView, summaryHTML, resultHTML, assess, kpis, cohortView, newChecksCard, patientDialog, restore, healthPatient, simulate, COHORT, SYMPTOMS, GENERAL,
  get currentPid() { return currentPid; },
  actions: {
    'export-cohort': exportCohort,
    'new-health-check': () => { currentPid = null; state.health = null; render(true); },
  },
};
})();
