// Reference definitions are sourced; Candex warning bands are explicitly local.
// Fictional fixture values are never reported as measured Finnish performance.
(() => {
  const access = {title: 'STM — Access to treatment (nonurgent specialist care)', url: 'https://stm.fi/hoitotakuu'};
  const strategy = {title: 'Finnish Cancer Strategy 2026–2035, p. 5', url: 'https://stm.fi/documents/1271139/1329769/Kansallinen_syopastrategia_2026_2035.pdf/5057c3d1-e824-3933-0a32-7344843e9bf6/Kansallinen_syopastrategia_2026_2035.pdf?t=1762756763489'};
  const thl = {title: 'THL Ohjaus 21/2016 — Cancer waiting-time monitoring, updated 2025', url: 'https://www.julkari.fi/bitstream/handle/10024/131630/Hoitoonp%C3%A4%C3%A4syn%20seuranta%20sy%C3%B6v%C3%A4n%20hoidossa_p%C3%A4ivitys170225.pdf?isAllowed=y&sequence=6'};
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
    if (id === 'nhs_31day_treatment_share' || id === 'nhs_62day_treatment_share') {
      if(value>100)return unknown('Percentage values must be between 0 and 100.');
      const target=id==='nhs_31day_treatment_share'?96:85;
      const level=value>=target?'green':value>=target-5?'yellow':'red';
      return {level,label:labels[level],thresholdLabel:`NHS England comparator: ${target}%; local 5-point warning band`,basis:id==='nhs_31day_treatment_share'?'Recognised external comparator, NOT a Finnish standard: NHS England operational standard is 96% starting treatment within 31 days of decision-to-treat / earliest clinically appropriate date. Yellow is a local Candex convention within 5 percentage points below target; red is a larger gap. The right cohort and event anchors are required.':'Recognised external comparator, NOT a Finnish standard: NHS England operational standard is 85% starting first definitive treatment within 62 days of the applicable urgent referral. Yellow is a local Candex convention within 5 percentage points below target; red is a larger gap. This is not a universal international cancer standard.',source:{title:'NHS England — Cancer waiting-times monitoring guidance',url:'https://www.england.nhs.uk/long-read/national-cancer-waiting-times-monitoring-dataset-guidance/'}};
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
  window.CandexKpis = {evaluate,getMode:()=>mode,setMode,sources:{access,strategy,thl}};
})();
