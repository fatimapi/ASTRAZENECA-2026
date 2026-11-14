// DICOM page: the no-AI summary (used when live AI is off) and the Finnish strings.
const fs = require('fs'), path = require('path');
globalThis.window = {candexI18n: {extend: d => { globalThis.FI = d; }}};
let checks = 0; const defects = [];
const check = (ok, msg) => { checks++; if (!ok) defects.push(msg); };
(async () => {
  const m = await import(path.join(__dirname, '..', 'dicom.js'));
  const findings = [{label: 'Lung Opacity', score: 0.4962}, {label: 'Atelectasis', score: 0.3014}, {label: 'Nodule', score: 0.1013}, {label: 'Mass', score: 0.0264}, {label: 'Effusion', score: 0.1623}];
  const en = m.summaryWithoutAI(findings, 'en'), fi = m.summaryWithoutAI(findings, 'fi');
  check(/Lung Opacity 0\.50, Atelectasis 0\.30, Effusion 0\.16/.test(en.summary), 'English: top three, sorted, two decimals');
  check(/Nodule 0\.10, Mass 0\.03/.test(en.summary) && /not probabilities/.test(en.summary), 'English: Nodule and Mass, plus caveat');
  check(/Lung Opacity 0,50/.test(fi.summary) && /Nodule 0,10, Mass 0,03/.test(fi.summary) && /kalibroimattomia/.test(fi.summary), 'Finnish: decimal commas and caveat');
  check(en.key_points.some(x => /does not rule out/.test(x)) && fi.key_points.some(x => /ei sulje pois/.test(x)), 'Both say a low score does not rule out a nodule');
  check(!/undefined|NaN/.test(JSON.stringify([en, fi])), 'No undefined or NaN');
  // Finnish results: label names, limitations and the report draft.
  check(m.labelText('Nodule', 'fi') === 'Pesäke (Nodule)' && m.labelText('Nodule', 'en') === 'Nodule', 'Labels: Finnish name with the model label kept');
  const backendLimits = [...fs.readFileSync(path.join(__dirname, '..', 'backend', 'model.py'), 'utf8').matchAll(/^    "([^"]+)",$/gm)].map(x => x[1]);
  check(backendLimits.length === 7 && backendLimits.every(l => globalThis.FI[l]), 'Every backend limitation has a Finnish translation');
  const d = m.finnishDraft({model: {name: 'TorchXRayVision', weights: 'densenet121-res224-all'}, findings});
  check(/HYVÄKSYMÄTÖN/.test(d) && /Keuhkosamentuma \(Lung Opacity\): 0,4962/.test(d) && /Pätevän lääkärin/.test(d) && !/undefined/.test(d), 'Finnish report draft with all scores');
  // Every visible English string on the page has a Finnish translation.
  const src = fs.readFileSync(path.join(__dirname, '..', 'dicom.js'), 'utf8');
  const visible = [...src.matchAll(/element\('[a-z0-9]+', '[^']*', '([^'$`]{3,})'\)/g)].map(x => x[1]);
  const missing = visible.filter(s => !globalThis.FI[s]);
  check(visible.length > 20 && !missing.length, `Finnish translation missing for: ${missing.join(' | ')}`);
  console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${checks} DICOM summary checks (no-AI summary EN/FI, ${visible.length} page strings translated).`);
  if (defects.length) process.exitCode = 1;
})();
