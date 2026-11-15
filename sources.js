// Quality administrator → Sources: research, statistics, datasets, policy and tools on Finnish cancer
// screening, collected from the team's research for this prototype. Every link opens in a new tab.
// Loaded before app.js; uses its helpers (heading, demoNotice, icon, esc, toast) at call time.
(() => {
const T = s => (window.candexI18n ? window.candexI18n.tr(s) : s);
const lang = () => (window.candexI18n?.lang === 'fi' ? 'fi' : 'en');

// [title, url, type, note EN, note FI]
const GROUPS = [
  ['Finnish screening programmes and statistics', 'Kansalliset seulontaohjelmat ja tilastot', [
    ['Pilot study of lung cancer screening (Finnish Cancer Registry)', 'https://cancerregistry.fi/screening/research/piloting-lung-cancer-screening', 'Web page', 'Finland’s lung cancer screening pilot: who is invited, how it runs.', 'Suomen keuhkosyöpäseulonnan pilotti: ketkä kutsutaan ja miten se toteutetaan.'],
    ['Colorectal cancer screening (Finnish Cancer Registry)', 'https://cancerregistry.fi/screening/colorectal-cancer-screening', 'Web page', 'The national bowel screening programme.', 'Kansallinen suolistosyövän seulontaohjelma.'],
    ['Annual reports of cancer screening programmes', 'https://cancerregistry.fi/reports-and-publications/annual-reports-of-cancer-screening-programmes', 'Statistics', 'Yearly reports on participation and findings across programmes.', 'Vuosiraportit osallistumisesta ja löydöksistä ohjelmittain.'],
    ['Screening statistics (Finnish Cancer Registry)', 'https://cancerregistry.fi/statistics/screening-statistics', 'Statistics', 'Screening statistics for breast, cervical and colorectal programmes.', 'Rinta-, kohdunkaula- ja suolistosyövän seulontatilastot.'],
    ['Cervical cancer screening programme: annual statistics', 'https://stats.cancerregistry.fi/joukkistilastot/cervix.html', 'Statistics', 'Annual cervical screening statistics, including participation.', 'Kohdunkaulan syövän seulonnan vuositilastot, myös osallistuminen.'],
    ['Cancer statistics database (Syöpärekisteri)', 'https://tilastot.syoparekisteri.fi/syovat', 'Statistics', 'Interactive incidence, mortality and survival statistics.', 'Vuorovaikutteiset ilmaantuvuus-, kuolleisuus- ja elossaolotilastot.'],
    ['Cancer in Finland 2023 (fact sheet)', 'https://syoparekisteri.fi/assets/themes/ssy3/factsheets/cancer_in_finland_2023.html', 'Statistics', 'National overview of cancer in Finland.', 'Kansallinen katsaus syöpään Suomessa.'],
    ['Keuhkosyöpäraportti – lung cancer report (in Finnish)', 'https://syoparekisteri.fi/assets/themes/ssy3/factsheets/keuhkosyoparaportti.html', 'Statistics', 'Lung cancer figures from the Finnish Cancer Registry.', 'Syöpärekisterin keuhkosyöpäluvut.'],
  ]],
  ['Research papers', 'Tutkimusjulkaisut', [
    ['Lung cancer screening in Finland: a prospective randomized trial (Tampere University)', 'https://trepo.tuni.fi/handle/10024/233284', 'Research paper', 'Finnish randomized trial of lung cancer screening.', 'Suomalainen satunnaistettu keuhkosyöpäseulontatutkimus.'],
    ['Disparities in participation in the Finnish cervical cancer screening programme: the role of birth country, education level and age (PubMed)', 'https://pubmed.ncbi.nlm.nih.gov/42858050', 'Research paper', 'Who takes part in screening, and who is missed.', 'Ketkä osallistuvat seulontaan ja ketkä jäävät pois.'],
    ['The same paper on ResearchGate', 'https://www.researchgate.net/publication/415540217_Disparities_in_participation_in_the_Finnish_cervical_cancer_screening_programme_The_role_of_birth_country_education_level_and_age', 'Research paper', 'Alternative link to the paper above.', 'Vaihtoehtoinen linkki yllä olevaan julkaisuun.'],
    ['Disparities in cancer incidence, stage at diagnosis … (University of Helsinki, HELDA)', 'https://helda.helsinki.fi/bitstreams/fb1f9408-0cc2-4ac6-b1bc-38c78758b0d2/download', 'Report', 'Socioeconomic differences along the cancer pathway in Finland (download).', 'Sosioekonomiset erot syöpäpolulla Suomessa (lataus).'],
    ['Accuracy of Finnish Cancer Registry colorectal cancer data', 'https://www.tandfonline.com/doi/full/10.1080/00365521.2020.1867893', 'Research paper', 'How complete and accurate the registry data are.', 'Kuinka kattavia ja tarkkoja rekisteritiedot ovat.'],
    ['Timeliness of lung cancer diagnosis and treatment (PMC)', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6375422', 'Research paper', 'Delays from symptoms to diagnosis and treatment.', 'Viiveet oireista diagnoosiin ja hoitoon.'],
    ['The Victorian Lung Cancer Registry pilot (PubMed)', 'https://pubmed.ncbi.nlm.nih.gov/24907066', 'Research paper', 'How a lung cancer quality registry pilot was set up and measured.', 'Miten keuhkosyövän laaturekisterin pilotti perustettiin ja arvioitiin.'],
  ]],
  ['National strategy, quality monitoring and equity', 'Kansallinen strategia, laadunseuranta ja yhdenvertaisuus', [
    ['National Cancer Strategy 2026–2035 (Ministry of Social Affairs and Health)', 'https://stm.fi/en/-/national-cancer-strategy-2026-2035', 'Web page', 'Finland’s national cancer strategy.', 'Suomen kansallinen syöpästrategia.'],
    ['National Cancer Strategy 2026–2035 (PDF)', 'https://stm.fi/documents/1271139/1329769/National_Cancer_Strategy_2026-2035_Finland.pdf/a29aa994-91bb-2bcd-e90e-a3d3fde32b90', 'PDF', 'Full strategy document.', 'Koko strategia-asiakirja.'],
    ['Kansallinen syöpästrategia – toimeenpanon tiekartta 2026–2031 (PDF, in Finnish)', 'https://stm.fi/documents/1271139/1359637/Kansallinen_syopastrategia_toimeenpanon_tiekartta_2026_2031.pdf/6e826620-351e-d6b4-5096-4706357adc45', 'PDF', 'Implementation roadmap for the strategy.', 'Strategian toimeenpanon tiekartta.'],
    ['National Cancer Strategy – FICAN', 'https://fican.fi/en/what-we-do/national-cancer-strategy', 'Web page', 'The Finnish Cancer Centre’s role in the strategy.', 'Syöpäkeskuksen rooli strategiassa.'],
    ['Cancer quality registry project – FICAN', 'https://fican.fi/en/what-we-do/quality-and-monitoring/cancer-quality-registry-project', 'Web page', 'Building a national cancer quality registry.', 'Kansallisen syövän laaturekisterin rakentaminen.'],
    ['Expansion of the cancer quality registry study – next focus on myeloma (FICAN)', 'https://fican.fi/en/expansion-of-cancer-quality-registry-study-next-focus-on-myeloma', 'Web page', 'Next steps of the quality registry work.', 'Laaturekisterityön seuraavat vaiheet.'],
    ['Cancer treatment outcome monitoring expands to colorectal, prostate and breast cancers (FICAN)', 'https://fican.fi/en/cancer-treatment-outcome-monitoring-expands-to-colorectal-prostate-and-breast-cancers', 'Web page', 'Which cancers are now covered by outcome monitoring.', 'Mitkä syövät hoitotulosten seuranta nyt kattaa.'],
    ['Regional differences in lung cancer detection between wellbeing services counties (FICAN)', 'https://fican.fi/en/regional-differences-in-lung-cancer-detection-exist-between-wellbeing-services-counties-further-improvements-in-data-coverage-are-still-needed', 'Web page', 'Regional gaps in how early lung cancer is found.', 'Alueelliset erot keuhkosyövän toteamisessa.'],
    ['Preparation for monitoring the quality of cancer treatment (THL)', 'https://thl.fi/en/research/projects/preparation-for-monitoring-the-quality-of-cancer-treatment', 'Web page', 'THL’s project on national quality indicators.', 'THL:n hanke kansallisista laatumittareista.'],
    ['MOT: Cancer patients die sooner in Finland than in other Nordic countries (Yle News)', 'https://yle.fi/a/74-20220299', 'News', 'Investigative report on Nordic outcome differences.', 'Tutkiva juttu pohjoismaisista hoitotulosten eroista.'],
    ['MOT: Cancer treatment delays in Finland lead to poorer outcomes (Yle News)', 'https://yle.fi/a/74-20251023', 'News', 'Investigative report on treatment delays.', 'Tutkiva juttu hoitoviiveistä.'],
  ]],
  ['Datasets and data access', 'Aineistot ja tietojen saatavuus', [
    ['LIDC-IDRI – The Cancer Imaging Archive', 'https://www.cancerimagingarchive.net/collection/lidc-idri', 'Dataset', 'Public chest CT and X-ray research images used in Candex (CC BY 3.0).', 'Candexissa käytetyt julkiset rintakehän TT- ja röntgentutkimuskuvat (CC BY 3.0).'],
    ['Findata – Social and Health Data Permit Authority', 'https://findata.fi/en', 'Web page', 'Finland’s permit authority for secondary use of health data.', 'Sosiaali- ja terveystietojen toissijaisen käytön lupaviranomainen.'],
    ['Findata: available data', 'https://findata.fi/en/data', 'Dataset', 'Which Finnish health and social data can be requested.', 'Mitä sosiaali- ja terveystietoja voi hakea.'],
    ['Findata: permits', 'https://findata.fi/en/permits', 'Web page', 'How to apply for a data permit.', 'Miten tietolupaa haetaan.'],
    ['Findata: your data rights', 'https://findata.fi/en/about-findata/your-data-rights', 'Web page', 'Individuals’ rights over their health data.', 'Yksilön oikeudet terveystietoihinsa.'],
  ]],
  ['Screening methods and clinical tools', 'Seulontamenetelmät ja kliiniset työkalut', [
    ['Lung cancer screening with low-dose CT (Siemens Healthineers Finland)', 'https://www.siemens-healthineers.com/fi/clinical-specialities/oncology/cancer-types/lung-cancer/lung-cancer-screening', 'Web page', 'Vendor overview of low-dose CT screening (commercial source).', 'Laitevalmistajan katsaus matala-annos-TT-seulontaan (kaupallinen lähde).'],
    ['ESMO Checklists', 'https://www.esmo.org/frameworks-and-tools/esmo-checklists', 'Web page', 'European oncology quality checklists.', 'Eurooppalaiset syöpähoidon laatutarkistuslistat.'],
    ['ESMO Checklist: early and locally advanced non-small cell lung cancer (PDF)', 'https://dam.esmo.org/image/upload/v1737627817/ESMO%20Checklist:%20Early%20and%20Locally%20Advanced%20Non-Small%20Cell%20Lung%20Cancer.pdf', 'PDF', 'Workflow checklist for early NSCLC.', 'Tarkistuslista varhaisen NSCLC:n hoitopolkuun.'],
    ['ESMO Checklist: advanced non-small cell lung cancer (PDF)', 'https://dam.esmo.org/image/upload/v1737627819/ESMO%20Checklist:%20Advanced%20Non-Small%20Cell%20Lung%20Cancer.pdf', 'PDF', 'Workflow checklist for advanced NSCLC.', 'Tarkistuslista edenneen NSCLC:n hoitopolkuun.'],
    ['ESMO Checklist: small cell lung cancer (PDF)', 'https://dam.esmo.org/image/upload/v1737627821/ESMO%20Checklist:%20Small%20Cell%20Lung%20Cancer.pdf', 'PDF', 'Workflow checklist for small cell lung cancer.', 'Tarkistuslista pienisoluisen keuhkosyövän hoitopolkuun.'],
    ['ESMO organ-specific checklists at the point of care (CCI4EU)', 'https://resources.cci4eu.eu/resource/esmo-organ-specific-checklists-for-oncologists-at-point-of-care', 'Web page', 'How the ESMO checklists are used in practice.', 'Miten ESMO-tarkistuslistoja käytetään käytännössä.'],
    ['Comprehensive Cancer Centre (CCI4EU resource centre)', 'https://resources.cci4eu.eu/comprehensive-cancer-centre', 'Web page', 'What a comprehensive cancer centre includes.', 'Mitä kattava syöpäkeskus sisältää.'],
    ['OECI Accreditation', 'https://accreditation.oeci.eu', 'Web page', 'European accreditation for cancer centres.', 'Syöpäkeskusten eurooppalainen akkreditointi.'],
    ['Dicoogle – open-source PACS', 'https://dicoogle.com', 'Web page', 'Open-source medical image archive (PACS).', 'Avoimen lähdekoodin kuva-arkisto (PACS).'],
    ['Dicoogle source code (GitHub)', 'https://github.com/dicoogle/dicoogle', 'Web page', 'Source code of the PACS above.', 'Yllä olevan PACS:n lähdekoodi.'],
    ['Assessing available open-source PACS options (PMC)', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10584756', 'Research paper', 'Comparison of open-source image archives.', 'Avoimen lähdekoodin kuva-arkistojen vertailu.'],
  ]],
  ['Care after diagnosis', 'Hoito diagnoosin jälkeen', [
    ['Follow-up care after cancer treatment (All about cancer, Cancer Society of Finland)', 'https://allaboutcancer.fi/after-cancer/after-cancer-treatment-follow-up-care', 'Web page', 'What follow-up looks like for patients.', 'Millaista seuranta on potilaalle.'],
    ['Rehabilitation for persons with cancer (Kela)', 'https://www.kela.fi/cancer-rehabilitation', 'Web page', 'Kela rehabilitation services for cancer patients.', 'Kelan kuntoutuspalvelut syöpäpotilaille.'],
  ]],
];
const TYPE_FI = {'Web page': 'Verkkosivu', PDF: 'PDF', 'Research paper': 'Tutkimusjulkaisu', Statistics: 'Tilasto', Dataset: 'Aineisto', News: 'Uutinen', Report: 'Raportti'};
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const allUrls = () => GROUPS.flatMap(([, , items]) => items.map(i => i[1]));

function view() {
  const L = lang();
  const count = allUrls().length;
  return `${heading('Sources', 'Research, statistics, datasets and tools on Finnish cancer screening behind this dashboard.', 'Quality & equity')}
${demoNotice('Sources · Links open the original sites in a new tab. Collected from the team’s research for this prototype; check each source before relying on it.')}
<section class="card src-intro"><p><strong translate="no">${count}</strong> ${T('sources in')} <strong translate="no">${GROUPS.length}</strong> ${T('groups.')} ${T('Labels show the type: web page, PDF, research paper, statistics, dataset or news.')}</p>
<div class="button-row"><button type="button" class="button secondary" data-src-copy>${icon('file')}${T('Copy all URLs')}</button></div></section>
${GROUPS.map(([en, fi, items]) => `<section class="card src-group"><div class="card-head"><h2>${esc(L === 'fi' ? fi : en)}</h2><span class="badge neutral" translate="no">${items.length}</span></div>
<ol class="src-list">${items.map(([title, url, type, nen, nfi]) => `<li><div class="src-head"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" translate="no">${esc(title)}${icon('external')}</a><span class="badge${type === 'PDF' ? ' amber' : ' neutral'}">${esc(L === 'fi' ? TYPE_FI[type] || type : type)}</span></div>
<p class="src-note">${esc(L === 'fi' ? nfi : nen)}</p><p class="src-url" translate="no"><span>${esc(host(url))}</span> · <span class="src-full">${esc(url)}</span></p></li>`).join('')}</ol></section>`).join('')}`;
}

document.addEventListener('click', e => {
  if (!e.target.closest?.('[data-src-copy]')) return;
  const text = allUrls().join('\n');
  const done = () => (typeof toast === 'function' ? toast : () => {})(T('All source URLs copied.'));
  try { navigator.clipboard.writeText(text).then(done, () => (typeof toast === 'function' ? toast : () => {})(T('Copying was blocked by the browser.'))); } catch { (typeof toast === 'function' ? toast : () => {})(T('Copying was blocked by the browser.')); }
});

window.candexI18n?.extend?.({
  'Sources': 'Lähteet', 'Research, statistics, datasets and tools on Finnish cancer screening behind this dashboard.': 'Tämän koontinäkymän taustalla olevat tutkimukset, tilastot, aineistot ja työkalut suomalaisesta syöpäseulonnasta.',
  'Sources · Links open the original sites in a new tab. Collected from the team’s research for this prototype; check each source before relying on it.': 'Lähteet · Linkit avaavat alkuperäiset sivustot uuteen välilehteen. Koottu tiimin taustatyöstä tätä prototyyppiä varten; tarkista lähde ennen kuin luotat siihen.',
  'sources in': 'lähdettä', 'groups.': 'ryhmässä.', 'Labels show the type: web page, PDF, research paper, statistics, dataset or news.': 'Merkinnät kertovat tyypin: verkkosivu, PDF, tutkimusjulkaisu, tilasto, aineisto tai uutinen.',
  'Copy all URLs': 'Kopioi kaikki URL-osoitteet', 'All source URLs copied.': 'Kaikki lähteiden URL-osoitteet kopioitu.', 'Copying was blocked by the browser.': 'Selain esti kopioinnin.',
});
window.candexSources = {view, GROUPS, allUrls};
})();
