// Every in-app link must lead to a registered page. Guards against a merge
// silently dropping a page (the DICOM page was lost this way and every
// "Analyze chest X-ray DICOM" button fell back to the workspace overview).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const files = fs.readdirSync(root).filter(f => f.endsWith('.js'));
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const titles = app.match(/const viewTitles = \{([^}]*)\}/)[1];
const registered = new Set([...titles.matchAll(/(?:^|,)\s*'?([a-z-]+)'?\s*:/g)].map(m => m[1]));
const viewsMap = app.match(/function viewContent\(\)\{const views=\{([^}]*)\}/)[1];
const mapped = new Set([...viewsMap.matchAll(/(?:^|,)\s*'?([a-z-]+)'?\s*:/g)].map(m => m[1]));

const targets = new Map();
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of src.matchAll(/navigate\(\s*'(?:care|patient|quality)\/([a-z-]+)'/g)) targets.set(m[1], f);
  for (const m of src.matchAll(/goButton\(\s*'([a-z-]+)'/g)) targets.set(m[1], f);
  for (const m of src.matchAll(/data-go="(?:care|patient|quality)\/([a-z-]+)"/g)) targets.set(m[1], f);
}
const defects = [];
for (const [view, file] of targets) if (!registered.has(view)) defects.push(`${file} links to "${view}", which is not in viewTitles`);
for (const view of registered) if (!mapped.has(view)) defects.push(`"${view}" is in viewTitles but has no view in viewContent()`);
for (const must of ['dicom', 'scan', 'reports', 'referrals', 'agents', 'cohort']) if (!registered.has(must)) defects.push(`Required page "${must}" is missing`);
console.log(defects.length ? JSON.stringify(defects, null, 2) : `PASS: ${targets.size} link targets all registered; ${registered.size} pages all have views.`);
if (defects.length) process.exitCode = 1;
