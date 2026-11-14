// Reference definitions are sourced; Candex warning bands are explicitly local.
// Fictional fixture values are never reported as measured Finnish performance.
(() => {
  const access = {title: 'STM — Access to treatment (nonurgent specialist care)', url: 'https://stm.fi/hoitotakuu'};
  const strategy = {title: 'Finnish Cancer Strategy 2026–2035, p. 5', url: 'https://stm.fi/documents/1271139/1329769/Kansallinen_syopastrategia_2026_2035.pdf/5057c3d1-e824-3933-0a32-7344843e9bf6/Kansallinen_syopastrategia_2026_2035.pdf?t=1762756763489'};
  const thl = {title: 'THL Ohjaus 21/2016 — Cancer waiting-time monitoring, updated 2025', url: 'https://www.julkari.fi/bitstream/handle/10024/131630/Hoitoonp%C3%A4%C3%A4syn%20seuranta%20sy%C3%B6v%C3%A4n%20hoidossa_p%C3%A4ivitys170225.pdf?isAllowed=y&sequence=6'};
  // European comparators (not Finnish standards). Sources checked 2026-11-14.
  const euCouncil = {title: 'Council Recommendation on cancer screening, 9 Dec 2022 (European Commission IP/22/7548)', url: 'https://ec.europa.eu/commission/presscorner/detail/en/ip_22_7548'};
  const euBreast = {title: 'European guidelines for quality assurance in breast cancer screening and diagnosis, 4th ed.', url: 'https://cci4eu.aws-lcb.iarc.who.int/wp-content/uploads/2025/01/EU_guidelines_BC_screening.pdf'};
  const euCrc = {title: 'European guidelines for quality assurance in colorectal cancer screening, 1st ed. (Moss et al., Endoscopy 2012)', url: 'https://doi.org/10.1055/s-0032-1309788'};
  const eusoma = {title: 'EUSOMA quality indicators in breast cancer care (Del Turco et al., Eur J Cancer 2010)', url: 'https://doi.org/10.1016/j.ejca.2010.06.119'};
  const euRules = {
    eu_screening_offer: {green: 90, yellow: 85, source: euCouncil, threshold: 'EU target: 90% offered screening by 2025; local 5-point warning band',
      basis: 'European comparator, NOT a Finnish standard: the Council Recommendation of 9 December 2022 (Europe’s Beating Cancer Plan) aims for 90% of the EU population who qualify for breast, cervical and colorectal screening to be offered it by 2025. Yellow is a local Candex convention within 5 percentage points below the target; red is a larger gap.'},
    eu_breast_participation: {green: 75, yellow: 70, source: euBreast, threshold: 'European guidelines: 70% acceptable, 75% desirable',
      basis: 'European comparator, NOT a Finnish standard: the European guidelines for breast cancer screening set participation of at least 70% as acceptable and at least 75% as desirable. Green: desirable level reached; yellow: acceptable but below desirable; red: below acceptable.'},
    eu_colorectal_participation: {green: 65, yellow: 45, source: euCrc, threshold: 'European guidelines: 45% acceptable, 65% desirable',
      basis: 'European comparator, NOT a Finnish standard: the European guidelines for colorectal cancer screening (first edition) set a minimum uptake of 45% as acceptable and recommend aiming for at least 65%. Green: desirable level reached; yellow: acceptable but below desirable; red: below acceptable.'},
    eusoma_6week_treatment: {green: 90, yellow: 75, source: eusoma, threshold: 'EUSOMA: minimum standard 75%, target 90%',
      basis: 'European comparator for breast cancer only, NOT a Finnish standard: EUSOMA breast-centre quality indicator (2010): time from the first diagnostic examination in the breast unit to surgery or the start of other treatment within 6 weeks; minimum standard 75%, target 90%. Later EUSOMA updates (2017, 2024) may set different thresholds; check before use.'},
  };
  const demoRules = {
    scan_review_hours: {direction:'lower',green:24,yellow:48,unit:'hours'},
    diagnosis_days: {direction:'lower',green:21,yellow:28,unit:'days'},
    detection_sensitivity: {direction:'higher',green:95,yellow:90,unit:'%'},
    false_positive_rate: {direction:'lower',green:5,yellow:10,unit:'%'},
    followup_completion: {direction:'higher',green:95,yellow:85,unit:'%'},
    regional_gap_days: {direction:'lower',green:7,yellow:14,unit:'days'},
    demographic_gap_pp: {direction:'lower',green:2,yellow:5,unit:'percentage points'},
    data_completeness: {direction:'higher',green:95,yellow:80,unit:'%'},
    specialist_assessment_days: {direction:'lower',green:21,yellow:35,unit:'days'},
    treatment_wait_days: {direction:'lower',green:21,yellow:35,unit:'days'}
  };
  let mode = 'national';
  try { if (localStorage.getItem('candex-kpi-mode') === 'demo') mode = 'demo'; } catch {}
  const labels = {green:'Under control',yellow:'Needs review',red:'Urgent action',unknown:'Not assessed'};
  function band(value,rule) {
    return rule.direction === 'lower'
      ? value <= rule.green ? 'green' : value <= rule.yellow ? 'yellow' : 'red'
      : value >= rule.green ? 'green' : value >= rule.yellow ? 'yellow' : 'red';
  }
  function unknown(message = 'No applicable verified national threshold is configured for this measure.') {
    return {level:'unknown',label:labels.unknown,thresholdLabel:'No applicable national threshold',basis:message,source:null};
  }
  function evaluate(id,value,options={}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return unknown('Data are missing or invalid. No status is assigned.');
    if (['screening_participation','early_stage_share','detection_sensitivity','false_positive_rate','followup_completion','data_completeness','treatment_within_pathway_target'].includes(id) && value > 100) return unknown('Percentage values must be between 0 and 100.');
    if (id === 'referral_review_days') {
      if (options.applicable === false) return unknown('This reference applies only to nonurgent specialist assessment, measured from referral receipt to assessment start.');
      const level = value <= 14 ? 'green' : value <= 21 ? 'yellow' : 'red';
      return {level,label:labels[level],thresholdLabel:'National outer limit: 21 calendar days; local warning from day 15',basis:'Nonurgent specialist care only: assessment must START within 3 weeks of referral RECEIPT. Candex local bands: green ≤14 days, yellow 15–21, red >21. This legal outer limit is not a cancer-specific clinical target or an urgency assessment. Regional medians do not establish individual compliance.',source:access};
    }
    if (id === 'screening_participation' || id === 'early_stage_share') {
      const target = id === 'screening_participation' ? 80 : 70;
      const level = value >= target ? 'green' : value >= target - 10 ? 'yellow' : 'red';
      return {level,label:labels[level],thresholdLabel:`National strategic reference: ${target}% by 2035; local 10-point warning band`,basis:id === 'screening_participation' ? '2035 strategic goal: screening participation reaches 80% in every wellbeing services county across national programmes. Candex warning colours below the goal are local conventions, not national clinical alarms. Maakunta regions are not the same units as wellbeing services counties; the map shows a synthetic illustration, not official monitoring.' : '2035 strategic goal: at least 70% of classifiable cancers diagnosed at stages I–II. Candex marks up to 10 percentage points below the goal yellow and larger gaps red as a local service-review convention. This is not an individual clinical alarm.',source:strategy};
    }
    if (Object.hasOwn(euRules,id)) {
      if(value>100||value<0)return unknown('Percentage values must be between 0 and 100.');
      const r=euRules[id], level=value>=r.green?'green':value>=r.yellow?'yellow':'red';
      return {level,label:labels[level],thresholdLabel:r.threshold,basis:r.basis,source:r.source};
    }
    if (mode === 'demo' && Object.hasOwn(demoRules,id)) {
      const rule = demoRules[id], level = band(value,rule);
      const limits = rule.direction === 'lower' ? `green ≤${rule.green}; yellow >${rule.green}–${rule.yellow}; red >${rule.yellow}` : `green ≥${rule.green}; yellow ${rule.yellow}–<${rule.green}; red <${rule.yellow}`;
      return {level,label:labels[level],thresholdLabel:`LOCAL DEMO ONLY · ${limits} ${rule.unit}`,basis:'Illustrative Candex operating bands for demonstrating traffic lights. These are not Finnish national standards, clinical thresholds or validated performance targets.',source:null};
    }
    if (id === 'specialist_assessment_days' || id === 'treatment_wait_days') return unknown('General statutory limits use 3 or 6 CALENDAR MONTHS and specific event anchors. A scalar median in days cannot establish compliance. Cancer treatment requires the appropriate THL pathway-specific target; no universal deadline is substituted here.');
    if (id === 'treatment_within_pathway_target') return {...unknown('Goal 3 monitors access within applicable target timeframes. A cancer/pathway-specific THL target and valid event dates must be selected before assessing this indicator.'),source:thl};
    return unknown();
  }
  function setMode(next) {
    if (!['national','demo'].includes(next)) throw new Error('Unknown KPI reference profile.');
    mode=next;
    try { localStorage.setItem('candex-kpi-mode',next); } catch {}
  }
  window.candexI18n?.extend?.({"EU target: 90% offered screening by 2025; local 5-point warning band": "EU-tavoite: 90 %:lle tarjotaan seulontaa vuoteen 2025 mennessä; paikallinen 5 prosenttiyksikön varoitusraja", "European guidelines: 70% acceptable, 75% desirable": "Eurooppalaiset suositukset: 70 % hyväksyttävä, 75 % tavoiteltava", "European guidelines: 45% acceptable, 65% desirable": "Eurooppalaiset suositukset: 45 % hyväksyttävä, 65 % tavoiteltava", "EUSOMA: minimum standard 75%, target 90%": "EUSOMA: vähimmäistaso 75 %, tavoite 90 %", "European comparator, NOT a Finnish standard: the Council Recommendation of 9 December 2022 (Europe’s Beating Cancer Plan) aims for 90% of the EU population who qualify for breast, cervical and colorectal screening to be offered it by 2025. Yellow is a local Candex convention within 5 percentage points below the target; red is a larger gap.": "Eurooppalainen vertailukohta, EI suomalainen standardi: neuvoston suositus 9.12.2022 (Euroopan syövänvastainen toimintasuunnitelma) tavoittelee, että 90 %:lle rinta-, kohdunkaula- ja suolistosyövän seulontaan oikeutetuista EU-kansalaisista tarjotaan seulontaa vuoteen 2025 mennessä. Keltainen on Candexin paikallinen käytäntö enintään 5 prosenttiyksikköä tavoitteen alapuolella; punainen on suurempi ero.", "European comparator, NOT a Finnish standard: the European guidelines for breast cancer screening set participation of at least 70% as acceptable and at least 75% as desirable. Green: desirable level reached; yellow: acceptable but below desirable; red: below acceptable.": "Eurooppalainen vertailukohta, EI suomalainen standardi: rintasyöpäseulonnan eurooppalaiset laatusuositukset pitävät vähintään 70 %:n osallistumista hyväksyttävänä ja vähintään 75 %:a tavoiteltavana. Vihreä: tavoitetaso saavutettu; keltainen: hyväksyttävä mutta alle tavoitteen; punainen: alle hyväksyttävän.", "European comparator, NOT a Finnish standard: the European guidelines for colorectal cancer screening (first edition) set a minimum uptake of 45% as acceptable and recommend aiming for at least 65%. Green: desirable level reached; yellow: acceptable but below desirable; red: below acceptable.": "Eurooppalainen vertailukohta, EI suomalainen standardi: suolistosyöpäseulonnan eurooppalaiset laatusuositukset (1. painos) pitävät vähintään 45 %:n osallistumista hyväksyttävänä ja suosittelevat tavoitteeksi vähintään 65 %. Vihreä: tavoitetaso saavutettu; keltainen: hyväksyttävä mutta alle tavoitteen; punainen: alle hyväksyttävän.", "European comparator for breast cancer only, NOT a Finnish standard: EUSOMA breast-centre quality indicator (2010): time from the first diagnostic examination in the breast unit to surgery or the start of other treatment within 6 weeks; minimum standard 75%, target 90%. Later EUSOMA updates (2017, 2024) may set different thresholds; check before use.": "Eurooppalainen vertailukohta vain rintasyövälle, EI suomalainen standardi: EUSOMAn rintasyöpäkeskusten laatumittari (2010): ensimmäisestä diagnostisesta tutkimuksesta rintayksikössä leikkaukseen tai muun hoidon alkuun enintään 6 viikkoa; vähimmäistaso 75 %, tavoite 90 %. EUSOMAn myöhemmät päivitykset (2017, 2024) voivat käyttää eri raja-arvoja; tarkista ennen käyttöä.", "Eligible people offered breast, cervical and bowel screening": "Rinta-, kohdunkaula- ja suolistosyövän seulontaa tarjottu oikeutetuille", "Breast screening participation": "Rintasyöpäseulontaan osallistuminen", "Colorectal screening participation": "Suolistosyöpäseulontaan osallistuminen", "Breast cancer treatment within 6 weeks of first diagnostic examination": "Rintasyövän hoito 6 viikon kuluessa ensimmäisestä diagnostisesta tutkimuksesta", "Synthetic example · EU target 90% by 2025": "Synteettinen esimerkki · EU-tavoite 90 % vuoteen 2025", "Synthetic example · European guidelines: 70% acceptable, 75% desirable": "Synteettinen esimerkki · eurooppalaiset suositukset: 70 % hyväksyttävä, 75 % tavoiteltava", "Synthetic example · European guidelines: 45% acceptable, 65% desirable": "Synteettinen esimerkki · eurooppalaiset suositukset: 45 % hyväksyttävä, 65 % tavoiteltava", "Synthetic example · EUSOMA: minimum 75%, target 90%": "Synteettinen esimerkki · EUSOMA: vähimmäistaso 75 %, tavoite 90 %", "European standards · not Finnish standards": "Eurooppalaiset standardit · eivät suomalaisia standardeja"});
  window.CandexKpis = {evaluate,getMode:()=>mode,setMode,sources:{access,strategy,thl},europe:[euCouncil,euBreast,euCrc,eusoma]};
})();
