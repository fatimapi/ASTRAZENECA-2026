// Real-service client. There are no generated findings or simulated progress steps.
// Connection credentials and results remain in page memory, never localStorage.
let currentCleanup;
let sessionBackend = '';
let sessionToken = '';
// Latest analysed X-ray per patient, for Imaging review and the report. Page memory only
// (never browser storage): cleared on "Clear image & results", on leaving the session and on reload.
const xrayStore = () => (window.candexXray ||= {byPatient: {}});
const currentPatient = () => { try { return typeof state !== 'undefined' && state?.selected ? String(state.selected) : null; } catch { return null; } };
export function resetDicomSession() {
  if (window.candexXray) window.candexXray.byPatient = {};
  sessionBackend = '';
  sessionToken = '';
  window.candexAgent?.setToken?.('');
  currentCleanup?.();
}
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;
const text = (value, limit = 5000) => String(value ?? '').slice(0, limit);

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function field(labelText, control, hint) {
  const wrapper = element('div', 'field');
  const label = element('label', '', labelText);
  label.htmlFor = control.id;
  wrapper.append(label, control);
  if (hint) {
    const help = element('small', '', hint);
    help.id = `${control.id}-help`;
    control.setAttribute('aria-describedby', help.id);
    wrapper.append(help);
  }
  return wrapper;
}

function normaliseBackend(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a complete backend address, such as http://localhost:8000.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS backend address without a username, password, query or fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

async function parseResponse(response) {
  let body;
  try { body = await response.json(); } catch { throw new Error('The backend did not return JSON. Check that this is the Candex API address, rather than a static web server.'); }
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : typeof body.error === 'string' ? body.error : '';
    if (response.status === 401 || response.status === 403) throw new Error(`${window.candexI18n?.tr?.('The API key was not accepted.') || 'The API key was not accepted.'} ${window.candexAgent?.tokenWhere?.() || ''}`.trim());
    if (response.status === 413) throw new Error('This file exceeds the backend upload limit. Use a DICOM file smaller than 20 MiB.');
    throw new Error(detail || `The backend could not complete this request (HTTP ${response.status}).`);
  }
  return body;
}

function modelName(model) { return text(model?.name || 'Unnamed model', 250); }

window.candexI18n?.extend?.({
'Set': 'Asetettu', 'Not set': 'Ei asetettu',
"Research prototype only; not clinically validated for Candex or for making patient-care decisions.": "Vain tutkimusprototyyppi; ei kliinisesti validoitu Candexille eikä hoitopäätösten tekemiseen.",
"Frontal AP/PA CR/DX chest X-rays only. CT, MR, mammography, lateral images and multi-frame studies are unsupported.": "Vain edestä otetut AP/PA CR/DX -keuhkoröntgenkuvat. TT-, MR- ja mammografiakuvia, sivukuvia ja monikuvaisia tutkimuksia ei tueta.",
"Scores are uncalibrated model outputs, not disease probabilities or a diagnosis. No decision threshold is applied.": "Pisteet ovat kalibroimattomia mallin tuloksia, eivät sairauden todennäköisyyksiä eivätkä diagnoosi. Päätösrajaa ei käytetä.",
"No lesion localisation, cancer confirmation, segmentation or comparison with earlier scans is performed.": "Muutoksia ei paikanneta, syöpää ei varmisteta, rajauksia ei tehdä eikä aiempiin kuviin verrata.",
"DICOM presentation processing, full-range scaling, centre cropping and 224 × 224 resizing can change or exclude image detail.": "DICOM-esityksen käsittely, koko alueen skaalaus, keskirajaus ja 224 × 224 -koon muutos voivat muuttaa tai poistaa kuvan yksityiskohtia.",
"Images may contain burned-in identifiers that metadata checks cannot detect. Use permitted, de-identified research/test images only.": "Kuviin voi olla upotettu tunnisteita, joita metatietojen tarkistus ei havaitse. Käytä vain luvallisia, tunnisteettomia tutkimus- tai testikuvia.",
"All outputs require qualified clinician review. Model performance can vary across acquisition settings and patient groups.": "Kaikki tulokset vaativat pätevän lääkärin arvion. Mallin suorituskyky voi vaihdella kuvausasetusten ja potilasryhmien välillä.",
"AI summary": "Tekoälyn yhteenveto",
"Summary without AI": "Yhteenveto ilman tekoälyä",
"Research · AI-generated": "Tutkimus · tekoälyn laatima",
"Live AI not available": "Tekoäly ei käytettävissä",
"Add summary to report draft": "Lisää yhteenveto raporttiluonnokseen",
"Added to the report draft": "Lisätty raporttiluonnokseen",
"Writing a short summary of these scores with live AI, then checking it against the raw numbers…": "Tekoäly kirjoittaa lyhyen yhteenvedon pisteistä ja tarkistaa sen raakalukuja vasten…",
"Real model output. Clear limitations.": "Todellinen mallin tulos. Selkeät rajoitukset.",
"Upload a permitted chest X-ray DICOM to your research backend for model inference.": "Lähetä luvallinen keuhkoröntgenkuvan DICOM-tiedosto tutkimuspalvelimellesi mallin analysoitavaksi.",
"Doctor · DICOM AI": "Lääkäri · DICOM-tekoäly",
"DICOM AI analysis": "DICOM-tekoälyanalyysi",
"Loading the analysis Dashboard…": "Ladataan analyysin koontinäkymää…",
"Experimental · Chest X-ray DICOM": "Kokeellinen · Keuhkoröntgen-DICOM",
"Run the open-source TorchXRayVision classifier on one permitted chest X-ray. These model scores are research outputs for clinician review—not a cancer diagnosis or a validated cancer-risk estimate.": "Aja avoimen lähdekoodin TorchXRayVision-luokittelija yhdelle luvalliselle keuhkoröntgenkuvalle. Mallin pisteet ovat tutkimustuloksia lääkärin arvioitaviksi – eivät syöpädiagnoosi eivätkä validoitu syöpäriskin arvio.",
"Connect your analysis service": "Yhdistä analyysipalveluun",
"The Python backend runs the model. This page does not upload anything until you choose “Analyse DICOM”. Checking the connection sends no image.": "Python-palvelin ajaa mallin. Tämä sivu ei lähetä mitään ennen kuin valitset ”Analysoi DICOM”. Yhteyden tarkistus ei lähetä kuvaa.",
"Backend URL": "Palvelimen osoite",
"Backend API key": "Palvelimen API-avain",
"Paste your backend API key": "Liitä palvelimen API-avain",
"Enter the CANDEX_API_KEY set on your server. It stays in this page’s memory and is sent only to the backend you select.": "Anna palvelimellesi asetettu CANDEX_API_KEY. Se säilyy vain tämän sivun muistissa ja lähetetään vain valitsemallesi palvelimelle.",
"Use your local backend or a trusted HTTPS deployment. A plain Python static server does not provide the analysis API.": "Käytä paikallista palvelinta tai luotettua HTTPS-palvelua. Pelkkä Pythonin staattinen palvelin ei tarjoa analyysirajapintaa.",
"Check connection": "Tarkista yhteys",
"Forget API key": "Unohda API-avain",
"Connection check": "Yhteyden tarkistus",
"Not connected. Start the Python backend, then check the connection.": "Ei yhteyttä. Käynnistä Python-palvelin ja tarkista yhteys.",
"Checking the backend. No image is being sent.": "Tarkistetaan palvelinta. Kuvaa ei lähetetä.",
"Model is loaded.": "Malli on ladattu.",
"Model will load on the first analysis.": "Malli latautuu ensimmäisessä analyysissä.",
"Choose a chest X-ray study": "Valitse keuhkoröntgentutkimus",
"DICOM file": "DICOM-tiedosto",
"No file selected.": "Tiedostoa ei ole valittu.",
"Supported: one uncompressed, single-frame, monochrome frontal AP/PA CR or DX chest X-ray DICOM file, up to 20 MiB and 16 million pixels. CT series, MRI, compressed DICOM, colour images and multiframe studies are not supported by this connector.": "Tuettu: yksi pakkaamaton, yksikuvainen, harmaasävyinen edestä otettu AP/PA CR- tai DX-keuhkoröntgenkuva DICOM-muodossa, enintään 20 MiB ja 16 miljoonaa pikseliä. TT-sarjoja, MRI:tä, pakattuja DICOM-tiedostoja, värikuvia ja monikuvaisia tutkimuksia ei tueta.",
"DICOM can contain identifying information, including text embedded in pixels. Use approved de-identified research or test files. Nothing here de-identifies the source image for you.": "DICOM voi sisältää tunnistetietoja, myös kuvaan upotettua tekstiä. Käytä hyväksyttyjä, tunnisteettomia tutkimus- tai testitiedostoja. Tämä sivu ei poista tunnisteita puolestasi.",
"I confirm this is a frontal AP/PA chest X-ray, not a CT slice or another body region.": "Vahvistan, että tämä on edestä otettu AP/PA-keuhkoröntgenkuva, ei TT-leike tai muu kehon alue.",
"I have permission to process this de-identified research or test image with the selected backend.": "Minulla on lupa käsitellä tämä tunnisteeton tutkimus- tai testikuva valitulla palvelimella.",
"Analyse DICOM": "Analysoi DICOM",
"Cancel request": "Peruuta pyyntö",
"Clear image & results": "Tyhjennä kuva ja tulokset",
"Connect the backend, enter the API key, choose a file and confirm both checks to analyse.": "Yhdistä palvelin, anna API-avain, valitse tiedosto ja vahvista molemmat kohdat analysoidaksesi.",
"Check the backend connection before running analysis.": "Tarkista palvelinyhteys ennen analyysiä.",
"Check the backend connection first.": "Tarkista ensin palvelinyhteys.",
"Enter the backend API key (at least 24 characters) to enable analysis.": "Anna palvelimen API-avain (vähintään 24 merkkiä) analyysin käyttöön ottamiseksi.",
"Select one supported DICOM file to continue.": "Valitse yksi tuettu DICOM-tiedosto jatkaaksesi.",
"Confirm the chest X-ray and data-permission checks to continue.": "Vahvista keuhkoröntgen- ja tietolupakohdat jatkaaksesi.",
"Ready. The file will be sent only when you choose Analyse DICOM.": "Valmis. Tiedosto lähetetään vasta, kun valitset Analysoi DICOM.",
"Ready. Public demo: no API key needed for the demo X-rays.": "Valmis. Julkinen esittely: esimerkkiröntgenkuviin ei tarvita API-avainta.",
"Uploading your own file needs the backend API key. Choose a demo X-ray to try it without one.": "Oman tiedoston lataaminen vaatii palvelimen API-avaimen. Valitse esimerkkiröntgenkuva, niin voit kokeilla ilman avainta.",
"Not needed for the demo X-rays: anyone can try those. The key is only needed to upload your own file. It stays in this page’s memory and is sent only to the backend you select.": "Ei tarvita esimerkkiröntgenkuviin: niitä voi kokeilla kuka tahansa. Avain tarvitaan vain oman tiedoston lataamiseen. Se säilyy vain tämän sivun muistissa ja lähetetään vain valitsemallesi palvelimelle.",
"This file is larger than the 20 MiB limit.": "Tiedosto ylittää 20 MiB:n rajan.",
"Choose a DICOM file smaller than 20 MiB.": "Valitse alle 20 MiB:n DICOM-tiedosto.",
"Choose a file within the size limit, enter the API key and confirm both checks.": "Valitse kokorajan sisällä oleva tiedosto, anna API-avain ja vahvista molemmat kohdat.",
"API key cleared from this page session.": "API-avain poistettu tämän sivun istunnosta.",
"Image selection and analysis results cleared from this page.": "Kuvavalinta ja analyysitulokset tyhjennetty tältä sivulta.",
"Backend address changed. Check the new connection before analysing.": "Palvelimen osoite muuttui. Tarkista uusi yhteys ennen analyysiä.",
"The backend is running the model. Waiting for its actual response…": "Palvelin ajaa mallia. Odotetaan sen vastausta…",
"The backend is processing this request. The first run may need to download model weights. You can cancel waiting; the server may continue its current computation.": "Palvelin käsittelee pyyntöä. Ensimmäinen ajo voi ladata mallin painot. Voit peruuttaa odotuksen; palvelin voi silti jatkaa laskentaa.",
"Analysis completed by the backend. Review the model outputs and limitations below.": "Palvelin suoritti analyysin. Tarkista mallin tulokset ja rajoitukset alta.",
"Analysis results": "Analyysin tulokset",
"Real results begin with a real connection.": "Todelliset tulokset alkavat todellisesta yhteydestä.",
"Your image preview, model outputs and report draft will appear here after the backend completes an analysis. No sample findings are mixed into this Dashboard.": "Kuvan esikatselu, mallin tulokset ja raporttiluonnos näkyvät tässä, kun palvelin on suorittanut analyysin. Koontinäkymään ei sekoiteta esimerkkilöydöksiä.",
"What runs, and what this model cannot tell you": "Mitä ajetaan ja mitä malli ei pysty kertomaan",
"The backend reads supported DICOM pixels, prepares a chest X-ray and runs the pretrained TorchXRayVision DenseNet model. It returns image-level pathology scores. It does not locate a lesion, segment a tumour, compare CT volumes, determine malignancy or recommend treatment. Model outputs require independent clinical interpretation.": "Palvelin lukee tuetut DICOM-pikselit, valmistelee keuhkoröntgenkuvan ja ajaa esikoulutetun TorchXRayVision DenseNet -mallin. Se palauttaa koko kuvaa koskevat patologiapisteet. Se ei paikanna muutosta, rajaa kasvainta, vertaa TT-kuvia, määritä pahanlaatuisuutta eikä suosittele hoitoa. Mallin tulokset vaativat itsenäisen kliinisen tulkinnan.",
"The first analysis may download model weights and take longer. No artificial progress or findings are shown. For a separately hosted backend, configure an explicit allowed website origin on that server; a browser connection can also fail if an HTTPS page tries to use an HTTP backend.": "Ensimmäinen analyysi voi ladata mallin painot ja kestää pidempään. Keinotekoista edistymistä tai löydöksiä ei näytetä. Erikseen isännöidylle palvelimelle on määritettävä sallittu verkkosivuston alkuperä; selainyhteys voi myös epäonnistua, jos HTTPS-sivu yrittää käyttää HTTP-palvelinta.",
"View TorchXRayVision source": "Näytä TorchXRayVisionin lähdekoodi",
"Uploaded image · Backend preview": "Lähetetty kuva · Palvelimen esikatselu",
"Preview supplied by your backend. No tumour outlines or lesion localisation are produced by this classifier.": "Esikatselu palvelimelta. Luokittelija ei tuota kasvainrajauksia eikä paikanna muutoksia.",
"Preview generated from the uploaded chest X-ray DICOM. This classifier provides image-level scores without lesion localisation.": "Esikatselu lähetetystä keuhkoröntgen-DICOMista. Luokittelija antaa koko kuvaa koskevat pisteet paikantamatta muutoksia.",
"Image-level model outputs": "Mallin tulokset koko kuvalle",
"Chest X-ray": "Keuhkoröntgenkuva",
"Choose an X-ray…": "Valitse röntgenkuva…",
"Upload a new X-ray file…": "Lataa uusi röntgenkuva…",
"Choose a demo X-ray or upload a new file.": "Valitse esimerkkiröntgenkuva tai lataa uusi tiedosto.",
"Choose a demo X-ray or a file within the size limit, enter the API key and confirm both checks.": "Valitse esimerkkiröntgenkuva tai kokorajan sisällä oleva tiedosto, anna API-avain ja vahvista molemmat kohdat.",
"Scores run from 0 to 1.": "Pisteet ovat välillä 0–1.",
"They are uncalibrated model outputs—not probabilities, a diagnosis, or the likelihood that this person has cancer.": "Ne ovat kalibroimattomia mallin tuloksia – eivät todennäköisyyksiä, diagnoosi eivätkä todennäköisyys sille, että henkilöllä on syöpä.",
"All scores and model details": "Kaikki pisteet ja mallin tiedot",
"Scores run from 0 to 1. They are uncalibrated model outputs—not probabilities, a diagnosis, or the likelihood that this person has cancer.": "Pisteet ovat välillä 0–1. Ne ovat kalibroimattomia mallin tuloksia – eivät todennäköisyyksiä, diagnoosi eivätkä todennäköisyys sille, että henkilöllä on syöpä.",
"Actual classifier scores returned by the connected backend, ranked from highest to lowest": "Yhdistetyn palvelimen palauttamat luokittelijan pisteet suurimmasta pienimpään",
"Model label": "Mallin nimike",
"Raw score": "Raakapisteet",
"Model": "Malli",
"Version": "Versio",
"Weights": "Painot",
"Task": "Tehtävä",
"Analysis reference": "Analyysin tunniste",
"Not reported": "Ei ilmoitettu",
"Limitations & clinical review": "Rajoitukset ja kliininen arvio",
"Reviewable report draft": "Tarkistettava raporttiluonnos",
"This structured draft contains the returned model information. Edit it for your research review. Downloading does not sign a clinical report.": "Tämä jäsennelty luonnos sisältää mallin palauttamat tiedot. Muokkaa sitä tutkimusarviota varten. Lataaminen ei allekirjoita kliinistä raporttia.",
"Draft findings and limitations": "Löydösten ja rajoitusten luonnos",
"Download review draft": "Lataa tarkistusluonnos",
"The API key was not accepted.": "API-avainta ei hyväksytty.",
"Could not reach the Candex backend. Check its address, that it is running, its allowed origins, and whether your browser is blocking an HTTP backend from an HTTPS page.": "Candex-palvelimeen ei saatu yhteyttä. Tarkista osoite, että palvelin on käynnissä, sen sallitut alkuperät ja estääkö selain HTTP-palvelimen HTTPS-sivulta.",
"Request cancelled. The backend may still be processing an analysis already started.": "Pyyntö peruttu. Palvelin voi yhä käsitellä jo aloitettua analyysiä.",
"This address did not return the expected Candex model-service health response.": "Tämä osoite ei palauttanut odotettua Candex-mallipalvelun tilavastausta.",
"This file exceeds the backend upload limit. Use a DICOM file smaller than 20 MiB.": "Tiedosto ylittää palvelimen kokorajan. Käytä alle 20 MiB:n DICOM-tiedostoa."
});
const LABEL_FI = {"Atelectasis": "Atelektaasi", "Consolidation": "Konsolidaatio", "Infiltration": "Infiltraatti", "Pneumothorax": "Ilmarinta", "Edema": "Keuhkoödeema", "Emphysema": "Emfyseema", "Fibrosis": "Fibroosi", "Effusion": "Pleuraneste", "Pneumonia": "Keuhkokuume", "Pleural_Thickening": "Keuhkopussin paksuuntuma", "Cardiomegaly": "Sydämen suurentuma", "Nodule": "Pesäke", "Mass": "Massa", "Hernia": "Tyrä", "Lung Lesion": "Keuhkomuutos", "Fracture": "Murtuma", "Lung Opacity": "Keuhkosamentuma", "Enlarged Cardiomediastinum": "Laajentunut sydän-välikarsinavarjo"};
// Finnish name with the model's own label kept in brackets, so it still matches the raw output.
export const labelText = (label, lang) => (lang === 'fi' && LABEL_FI[label] ? `${LABEL_FI[label]} (${label})` : label);
export function finnishDraft(result) {
  const m = result.model || {};
  return `CANDEX — HYVÄKSYMÄTÖN TUTKIMUSMALLIN TULOS\n\n${modelName(m)} / ${text(m.weights || '', 200)}\nKeuhkoröntgenkuvan luokittelu (edestä)\n\n${[...result.findings].sort((a, b) => b.score - a.score).map(f => `${labelText(text(f.label, 150), 'fi')}: ${Number(f.score).toFixed(4).replace('.', ',')} (kalibroimaton mallin pistemäärä)`).join('\n')}\n\nKliinistä raja-arvoa, paikannusta tai syöpädiagnoosia ei anneta. Pätevän lääkärin on arvioitava alkuperäinen tutkimus ja kaikki mallin rajoitukset.`;
}
const reportLang = () => (window.candexI18n?.lang === 'fi' ? 'fi' : 'en');
const two = (v, lang) => (lang === 'fi' ? Number(v).toFixed(2).replace('.', ',') : Number(v).toFixed(2));

// Summary built from the scores alone, used when live AI is unavailable. Exported for tests.
export function summaryWithoutAI(findings, lang = 'en') {
  const sorted = [...findings].sort((a, b) => b.score - a.score);
  const get = label => findings.find(f => f.label === label);
  const top = sorted.slice(0, 3).map(f => `${f.label} ${two(f.score, lang)}`).join(', ');
  const nm = ['Nodule', 'Mass'].map(l => get(l) ? `${l} ${two(get(l).score, lang)}` : null).filter(Boolean).join(', ');
  return lang === 'fi'
    ? {summary: `Korkeimmat pisteet: ${top}.${nm ? ` Pesäkkeisiin liittyvät nimikkeet: ${nm}.` : ''} Pisteet ovat kalibroimattomia mallin tuloksia (0–1), eivät todennäköisyyksiä eivätkä diagnoosi.`,
       key_points: ['Luokittelija ei tunnista pesäkkeitä: matala Nodule- tai Mass-pistemäärä ei sulje pois pesäkettä tai syöpää.', 'Epäilty pesäke vaatii TT-tutkimuksen.', 'Pisteet koskevat koko kuvaa; luokittelija ei paikanna löydöksiä.']}
    : {summary: `Highest scores: ${top}.${nm ? ` Nodule-related labels: ${nm}.` : ''} Scores are uncalibrated model outputs (0–1), not probabilities or a diagnosis.`,
       key_points: ['This classifier is not a nodule detector: a low Nodule or Mass score does not rule out a nodule or cancer.', 'A suspected nodule needs CT.', 'Scores are for the whole image; the classifier does not localise findings.']};
}

export function mountDicomPanel(container) {
  currentCleanup?.();
  if (!(container instanceof HTMLElement)) throw new TypeError('DICOM panel needs a container element.');
  let alive = true;
  let connected = false;
  let publicDemo = false; // the server lets anyone run its demo X-rays without the API key
  let backend = '';
  let busy = false;
  let activeController;
  let timer;
  let lastResult;
  let summaryController;
  let timedOut = false;
  const listeners = [];
  const listen = (target, name, callback) => { target.addEventListener(name, callback); listeners.push(() => target.removeEventListener(name, callback)); };

  const root = element('div', 'dicom-workspace');
  const introduction = element('div', 'dicom-introduction');
  introduction.append(element('span', 'badge', 'Experimental · Chest X-ray DICOM'), element('p', '', 'Run the open-source TorchXRayVision classifier on one permitted chest X-ray. These model scores are research outputs for clinician review—not a cancer diagnosis or a validated cancer-risk estimate.'));
  root.append(introduction);
  const layout = element('div', 'dicom-layout');
  const controls = element('div', 'dicom-controls');
  const connectionCard = element('section', 'card');
  connectionCard.setAttribute('aria-labelledby', 'dicom-connection-title');
  const connectionTitle = element('h2', '', 'Connect your analysis service');
  connectionTitle.id = 'dicom-connection-title';
  connectionCard.append(connectionTitle);
  connectionCard.append(element('p', 'dicom-section-copy', 'The Python backend runs the model. This page does not upload anything until you choose “Analyse DICOM”. Checking the connection sends no image.'));

  const urlInput = element('input');
  urlInput.id = 'dicom-backend-url';
  urlInput.type = 'url';
  urlInput.inputMode = 'url';
  urlInput.spellcheck = false;
  urlInput.autocomplete = 'off';
  urlInput.value = sessionBackend || (['http:', 'https:'].includes(location.protocol) ? location.origin : 'http://localhost:8000');
  urlInput.placeholder = 'http://localhost:8000';
  const tokenInput = element('input');
  tokenInput.id = 'dicom-api-key';
  tokenInput.type = 'password';
  tokenInput.autocomplete = 'off';
  tokenInput.spellcheck = false;
  tokenInput.value = sessionToken || window.candexAgent?.getToken?.() || '';
  tokenInput.placeholder = 'Paste your backend API key';
  connectionCard.append(field('Backend URL', urlInput, 'Use your local backend or a trusted HTTPS deployment. A plain Python static server does not provide the analysis API.'));
  // The API key sits in a drop-down (closed by default); its summary says whether it is set.
  const tokenDrop = element('details', 'agent-drop token-drop');
  const tokenSummary = element('summary');
  const tokenState = element('span', `token-state${tokenInput.value.trim() ? ' is-set' : ''}`, tokenInput.value.trim() ? 'Set' : 'Not set');
  tokenSummary.append(element('span', '', 'Backend API key'), tokenState);
  tokenDrop.append(tokenSummary, field('Backend API key', tokenInput, 'Not needed for the demo X-rays: anyone can try those. The key is only needed to upload your own file. It stays in this page’s memory and is sent only to the backend you select.'));
  connectionCard.append(tokenDrop);
  const showTokenState = () => { const set = !!tokenInput.value.trim(); tokenState.textContent = set ? 'Set' : 'Not set'; tokenState.classList.toggle('is-set', set); };
  const connectionButtons = element('div', 'button-row');
  const connectButton = element('button', 'button secondary', 'Check connection');
  connectButton.type = 'button';
  const forgetButton = element('button', 'text-btn', 'Forget API key');
  forgetButton.type = 'button';
  connectionButtons.append(connectButton, forgetButton);
  const connectionStatus = element('div', 'dicom-status', 'Not connected. Start the Python backend, then check the connection.');
  connectionStatus.setAttribute('role', 'status');
  connectionStatus.setAttribute('aria-live', 'polite');
  connectionCard.append(connectionButtons, connectionStatus);

  const uploadCard = element('section', 'card');
  const uploadTitle = element('h2', '', 'Choose a chest X-ray study');
  uploadTitle.id = 'dicom-upload-title';
  uploadCard.setAttribute('aria-labelledby', uploadTitle.id);
  uploadCard.append(uploadTitle);
  uploadCard.append(element('p', 'dicom-section-copy', 'Supported: one uncompressed, single-frame, monochrome frontal AP/PA CR or DX chest X-ray DICOM file, up to 20 MiB and 16 million pixels. CT series, MRI, compressed DICOM, colour images and multiframe studies are not supported by this connector.'));
  const form = element('form', 'dicom-upload-form');
  const fileInput = element('input');
  fileInput.id = 'dicom-study';
  fileInput.type = 'file';
  fileInput.accept = '.dcm,.dicom,application/dicom';
  const fileDetails = element('p', 'dicom-file-details', 'Choose a demo X-ray or upload a new file.');
  fileDetails.id = 'dicom-file-details';
  fileInput.setAttribute('aria-describedby', fileDetails.id);
  // Source: a demo X-ray on the server (demo-data/chest-xrays = the team's FINAL DEMO XRAY) or a new upload.
  const sourceSelect = element('select');
  sourceSelect.id = 'dicom-source';
  const sourcePlaceholder = element('option', '', 'Choose an X-ray…');
  sourcePlaceholder.value = '';
  const demoGroup = element('optgroup');
  demoGroup.label = 'FINAL DEMO XRAY';
  const uploadOption = element('option', '', 'Upload a new X-ray file…');
  uploadOption.value = 'upload';
  sourceSelect.append(sourcePlaceholder, uploadOption);
  const fileField = field('DICOM file', fileInput);
  fileField.hidden = true;
  form.append(field('Chest X-ray', sourceSelect), fileField, fileDetails);
  const demoChoice = () => (sourceSelect.value.startsWith('demo:') ? sourceSelect.value.slice(5) : '');
  fetch('/api/demo/files', {headers: {Accept: 'application/json'}, credentials: 'omit'}).then(r => (r.ok ? r.json() : null)).then(d => {
    if (!alive || !d?.xray?.length) return;
    for (const x of d.xray) { const o = element('option', '', `${text(x.id, 40)} · ${Number(x.mb) || '?'} MB`); o.value = `demo:${text(x.id, 40)}`; o.setAttribute('translate', 'no'); demoGroup.append(o); }
    sourceSelect.insertBefore(demoGroup, uploadOption);
  }).catch(() => {});
  const chestLabel = element('label', 'check-row');
  const chestCheck = element('input');
  chestCheck.type = 'checkbox';
  chestCheck.id = 'dicom-confirm-chest';
  chestCheck.required = true;
  chestLabel.append(chestCheck, element('span', '', 'I confirm this is a frontal AP/PA chest X-ray, not a CT slice or another body region.'));
  const permissionLabel = element('label', 'check-row');
  const permissionCheck = element('input');
  permissionCheck.type = 'checkbox';
  permissionCheck.id = 'dicom-permitted';
  permissionCheck.required = true;
  permissionLabel.append(permissionCheck, element('span', '', 'I have permission to process this de-identified research or test image with the selected backend.'));
  const uploadNote = element('p', 'dicom-small-note', 'DICOM can contain identifying information, including text embedded in pixels. Use approved de-identified research or test files. Nothing here de-identifies the source image for you.');
  form.append(chestLabel, permissionLabel, uploadNote);
  const runButtons = element('div', 'button-row');
  const analyseButton = element('button', 'button', 'Analyse DICOM');
  analyseButton.type = 'submit';
  const cancelButton = element('button', 'button secondary', 'Cancel request');
  cancelButton.type = 'button';
  cancelButton.hidden = true;
  const clearButton = element('button', 'text-btn', 'Clear image & results');
  clearButton.type = 'button';
  runButtons.append(analyseButton, cancelButton, clearButton);
  const runHint = element('p', 'dicom-small-note', 'Connect the backend, enter the API key, choose a file and confirm both checks to analyse.');
  const requestStatus = element('div', 'dicom-status');
  requestStatus.setAttribute('role', 'status');
  requestStatus.setAttribute('aria-live', 'polite');
  form.append(runButtons, runHint, requestStatus);
  uploadCard.append(form);
  controls.append(connectionCard, uploadCard);

  const resultArea = element('section', 'dicom-results');
  resultArea.setAttribute('aria-labelledby', 'dicom-results-title');
  const resultTitle = element('h2', 'sr-only', 'Analysis results');
  resultTitle.id = 'dicom-results-title';
  resultArea.append(resultTitle);
  const placeholder = element('div', 'dicom-result-placeholder');
  placeholder.append(element('div', 'dicom-placeholder-mark', '+'), element('h3', '', 'Real results begin with a real connection.'), element('p', '', 'Your image preview, model outputs and report draft will appear here after the backend completes an analysis. No sample findings are mixed into this Dashboard.'));
  resultArea.append(placeholder);
  layout.append(controls, resultArea);
  root.append(layout);
  const implementation = element('details', 'dicom-implementation');
  implementation.append(element('summary', '', 'What runs, and what this model cannot tell you'));
  implementation.append(element('p', '', 'The backend reads supported DICOM pixels, prepares a chest X-ray and runs the pretrained TorchXRayVision DenseNet model. It returns image-level pathology scores. It does not locate a lesion, segment a tumour, compare CT volumes, determine malignancy or recommend treatment. Model outputs require independent clinical interpretation.'));
  implementation.append(element('p', '', 'The first analysis may download model weights and take longer. No artificial progress or findings are shown. For a separately hosted backend, configure an explicit allowed website origin on that server; a browser connection can also fail if an HTTPS page tries to use an HTTP backend.'));
  const sourceLink = element('a', 'text-btn', 'View TorchXRayVision source');
  sourceLink.href = 'https://github.com/mlmed/torchxrayvision';
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener';
  implementation.append(sourceLink);
  root.append(implementation);
  container.replaceChildren(root);

  function setStatus(node, message, kind = '') {
    node.textContent = message;
    node.className = `dicom-status${kind ? ` is-${kind}` : ''}`;
  }
  function resetResult() {
    lastResult = undefined;
    summaryController?.abort();
    resultArea.replaceChildren(resultTitle, placeholder);
  }
  // The API key is needed for uploads, or when the server has no public demo.
  const needsKey = () => !(publicDemo && demoChoice());
  const keyMissing = () => needsKey() && tokenInput.value.trim().length < 24;
  function syncControls() {
    const file = fileInput.files?.[0];
    const chosen = demoChoice() ? true : sourceSelect.value === 'upload' && file && file.size <= MAX_FILE_BYTES;
    analyseButton.disabled = busy || !connected || keyMissing() || !chosen || !chestCheck.checked || !permissionCheck.checked;
    sourceSelect.disabled = busy;
    connectButton.disabled = busy;
    forgetButton.disabled = busy;
    clearButton.disabled = busy;
    urlInput.disabled = busy;
    tokenInput.disabled = busy;
    fileInput.disabled = busy;
    chestCheck.disabled = busy;
    permissionCheck.disabled = busy;
    cancelButton.hidden = !busy;
    form.setAttribute('aria-busy', String(busy));
    if (busy) runHint.textContent = 'The backend is processing this request. The first run may need to download model weights. You can cancel waiting; the server may continue its current computation.';
    else if (!connected) runHint.textContent = 'Check the backend connection before running analysis.';
    else if (keyMissing()) runHint.textContent = publicDemo ? 'Uploading your own file needs the backend API key. Choose a demo X-ray to try it without one.' : 'Enter the backend API key (at least 24 characters) to enable analysis.';
    else if (!demoChoice() && !file) runHint.textContent = 'Select one supported DICOM file to continue.';
    else if (!demoChoice() && file.size > MAX_FILE_BYTES) runHint.textContent = 'Choose a DICOM file smaller than 20 MiB.';
    else if (!chestCheck.checked || !permissionCheck.checked) runHint.textContent = 'Confirm the chest X-ray and data-permission checks to continue.';
    else if (!needsKey() && !tokenInput.value.trim()) runHint.textContent = 'Ready. Public demo: no API key needed for the demo X-rays.';
    else runHint.textContent = 'Ready. The file will be sent only when you choose Analyse DICOM.';
  }
  function disconnect() {
    connected = false;
    publicDemo = false;
    resetResult();
    setStatus(connectionStatus, 'Backend address changed. Check the new connection before analysing.');
    setStatus(requestStatus, '');
    syncControls();
  }
  function networkError(error, purpose) {
    if (error.name === 'AbortError') return timedOut ? `${purpose} timed out. Check the backend terminal; the server may still be processing.` : 'Request cancelled. The backend may still be processing an analysis already started.';
    if (error instanceof TypeError) return 'Could not reach the Candex backend. Check its address, that it is running, its allowed origins, and whether your browser is blocking an HTTP backend from an HTTPS page.';
    return text(error.message || 'The request failed. Check the backend terminal and try again.');
  }
  async function request(url, options, timeout) {
    activeController = new AbortController();
    timedOut = false;
    timer = setTimeout(() => { timedOut = true; activeController?.abort(); }, timeout);
    try { return await parseResponse(await fetch(url, { ...options, signal: activeController.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' })); }
    finally { clearTimeout(timer); activeController = undefined; }
  }

  listen(urlInput, 'input', () => { sessionBackend = urlInput.value; disconnect(); });
  listen(tokenInput, 'input', () => { sessionToken = tokenInput.value; window.candexAgent?.setToken?.(tokenInput.value); showTokenState(); syncControls(); });
  listen(forgetButton, 'click', () => { sessionToken = ''; tokenInput.value = ''; showTokenState(); resetResult(); setStatus(requestStatus, 'API key cleared from this page session.'); syncControls(); });
  listen(sourceSelect, 'change', () => {
    resetResult();
    setStatus(requestStatus, '');
    fileField.hidden = sourceSelect.value !== 'upload';
    fileInput.value = '';
    const id = demoChoice();
    const fi = reportLang() === 'fi';
    fileDetails.textContent = id ? `FINAL DEMO XRAY · ${id} · ${fi ? 'luetaan palvelimelta; tältä tietokoneelta ei lähetetä mitään.' : 'read on the server; nothing is uploaded from this computer.'}` : sourceSelect.value === 'upload' ? 'No file selected.' : 'Choose a demo X-ray or upload a new file.';
    chestCheck.checked = false;
    permissionCheck.checked = false;
    syncControls();
  });
  listen(fileInput, 'change', () => {
    resetResult();
    setStatus(requestStatus, '');
    const file = fileInput.files?.[0];
    fileDetails.textContent = file ? `${text(file.name, 200)} · ${(file.size / (1024 * 1024)).toFixed(2)} MiB · Selected locally; not sent yet.` : 'No file selected.';
    chestCheck.checked = false;
    permissionCheck.checked = false;
    if (file?.size > MAX_FILE_BYTES) setStatus(requestStatus, 'This file is larger than the 20 MiB limit.', 'error');
    syncControls();
  });
  listen(chestCheck, 'change', syncControls);
  listen(permissionCheck, 'change', syncControls);
  listen(cancelButton, 'click', () => activeController?.abort());
  listen(clearButton, 'click', () => {
    const pid = currentPatient(); if (pid && window.candexXray) delete window.candexXray.byPatient[pid];
    fileInput.value = '';
    sourceSelect.value = '';
    fileField.hidden = true;
    chestCheck.checked = false;
    permissionCheck.checked = false;
    fileDetails.textContent = 'Choose a demo X-ray or upload a new file.';
    resetResult();
    setStatus(requestStatus, 'Image selection and analysis results cleared from this page.');
    syncControls();
  });
  listen(connectButton, 'click', async () => {
    if (busy) return;
    resetResult();
    connected = false;
    publicDemo = false;
    try { backend = normaliseBackend(urlInput.value.trim()); }
    catch (error) { setStatus(connectionStatus, error.message, 'error'); syncControls(); return; }
    sessionBackend = backend;
    urlInput.value = backend;
    busy = true;
    syncControls();
    setStatus(connectionStatus, 'Checking the backend. No image is being sent.');
    try {
      const data = await request(`${backend}/api/health`, { method: 'GET', headers: { Accept: 'application/json' } }, 20000);
      if (!alive) return;
      if (data.status !== 'ok' || !data.model?.name || !Array.isArray(data.model.supported_modalities)) throw new Error('This address did not return the expected Candex model-service health response.');
      connected = true;
      publicDemo = data.public_demo === true;
      setStatus(connectionStatus, reportLang() === 'fi' ? `Palvelin tavoitettavissa · ${modelName(data.model)}. ${data.model.loaded ? 'Malli on ladattu.' : 'Malli latautuu ensimmäisessä analyysissä.'} API-avain tarkistetaan, kun analyysi alkaa.` : `Backend reachable · ${modelName(data.model)}. ${data.model.loaded ? 'Model is loaded.' : 'Model will load on the first analysis.'} API credentials are checked when analysis starts.`, 'success');
    } catch (error) { if (alive) setStatus(connectionStatus, networkError(error, 'Connection check'), 'error'); }
    finally { if (alive) { busy = false; syncControls(); } }
  });
  listen(form, 'submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (!connected) { setStatus(requestStatus, 'Check the backend connection first.', 'error'); return; }
    const file = fileInput.files?.[0];
    const key = tokenInput.value.trim();
    const demoId = demoChoice();
    if ((!demoId && (!file || file.size > MAX_FILE_BYTES)) || !chestCheck.checked || !permissionCheck.checked || keyMissing()) { setStatus(requestStatus, 'Choose a demo X-ray or a file within the size limit, enter the API key and confirm both checks.', 'error'); return; }
    const body = new FormData();
    if (demoId) body.append('demo_file', demoId); else body.append('file', file);
    body.append('confirmed_chest', 'true');
    body.append('permitted_data', 'true');
    resetResult();
    busy = true;
    syncControls();
    setStatus(requestStatus, 'The backend is running the model. Waiting for its actual response…');
    try {
      const result = await request(`${backend}/api/analyze`, { method: 'POST', headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body }, ANALYSIS_TIMEOUT_MS);
      if (!alive) return;
      validateResult(result);
      lastResult = result;
      const pid = currentPatient();
      if (pid && result.image?.preview_png_base64) {
        const sorted = [...result.findings].sort((a, b) => b.score - a.score);
        xrayStore().byPatient[pid] = {at: new Date().toISOString(), image: `data:image/png;base64,${result.image.preview_png_base64}`, model: modelName(result.model),
          top: sorted.slice(0, 3).map(f => ({label: text(f.label, 80), score: f.score})), nodule: sorted.filter(f => /^(Nodule|Mass)$/.test(f.label)).map(f => ({label: f.label, score: f.score})), summary: null, points: [], live: false, lang: reportLang()};
      }
      renderResult(result);
      setStatus(requestStatus, 'Analysis completed by the backend. Review the model outputs and limitations below.', 'success');
    } catch (error) { if (alive) setStatus(requestStatus, networkError(error, 'Analysis'), 'error'); }
    finally { if (alive) { busy = false; syncControls(); } }
  });

  // Short AI summary of the returned scores: live Gemini via the backend
  // (summariser + safety reviewer), else a summary built from the scores alone.
  async function summarise(result, card, draft) {
    summaryController?.abort();
    const controller = summaryController = new AbortController();
    const lang = reportLang();
    const show = (data, live, note) => {
      if (!alive || controller.signal.aborted) return;
      const head = element('div', 'dicom-ai-head');
      head.append(element('h2', '', live ? 'AI summary' : 'Summary without AI'), element('span', `badge${live ? '' : ' amber'}`, live ? 'Research · AI-generated' : 'Live AI not available'));
      const list = element('ul');
      for (const point of data.key_points.slice(0, 6)) list.append(element('li', '', text(point, 600)));
      const add = element('button', 'button secondary', 'Add summary to report draft');
      add.type = 'button';
      listen(add, 'click', () => {
        const block = `${lang === 'fi' ? 'YHTEENVETO' : 'SUMMARY'} (${live ? (lang === 'fi' ? 'tekoälyn laatima, tarkistettava' : 'AI-generated, to be checked') : (lang === 'fi' ? 'ilman tekoälyä' : 'without AI')})\n${data.summary}\n${data.key_points.map(x => `- ${x}`).join('\n')}\n\n`;
        if (!draft.value.startsWith(block)) draft.value = block + draft.value;
        add.disabled = true; add.textContent = 'Added to the report draft';
      });
      card.replaceChildren(head, element('p', 'dicom-ai-text', text(data.summary, 3000)), list, element('p', 'dicom-small-note', note), add);
      const rec = xrayStore().byPatient[currentPatient()];
      if (rec && result === lastResult) Object.assign(rec, {summary: text(data.summary, 1500), points: data.key_points.slice(0, 4).map(x => text(x, 300)), live, lang});
    };
    card.replaceChildren(element('h2', '', 'AI summary'), element('p', 'dicom-status', 'Writing a short summary of these scores with live AI, then checking it against the raw numbers…'));
    const L = (en, fi) => (lang === 'fi' ? fi : en);
    const fallback = reason => show(summaryWithoutAI(result.findings, lang), false, `${reason} ${L('This summary is built directly from the scores, without AI.', 'Tämä yhteenveto on muodostettu suoraan pisteistä ilman tekoälyä.')}`);
    let out;
    try {
      const response = await fetch(`${backend}/api/agent/cxr-summary`, {method: 'POST', signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
        headers: {'Content-Type': 'application/json', Accept: 'application/json', ...(tokenInput.value.trim() ? {Authorization: `Bearer ${tokenInput.value.trim()}`} : {})},
        body: JSON.stringify({lang, model: `${modelName(result.model)} ${text(result.model.weights || '', 100)}`.trim(), findings: result.findings.slice(0, 40).map(f => ({label: text(f.label, 80), score: f.score}))})});
      if (response.status === 503 || response.status === 404) return fallback(L('Live AI is not configured on this backend.', 'Tekoälyä ei ole otettu käyttöön tällä palvelimella.'));
      out = await parseResponse(response);
    } catch (error) {
      if (error.name === 'AbortError') return;
      return fallback(`${L('Live AI summary failed:', 'Tekoälyn yhteenveto epäonnistui:')} ${networkError(error, L('The summary', 'Yhteenveto'))}`);
    }
    if (typeof out?.summary !== 'string' || !Array.isArray(out.key_points)) return fallback(L('The AI summary was incomplete.', 'Tekoälyn yhteenveto jäi puutteelliseksi.'));
    const ok = out.review?.verdict === 'consistent with the raw scores';
    const issues = Array.isArray(out.review?.issues) ? out.review.issues.map(x => text(x, 400)).join(' ') : '';
    show(out, true, L(`Written by ${text(out.model, 60)} from the scores above, then checked by a separate AI safety review: ${ok ? 'consistent with the raw scores.' : `needs changes. ${issues}`} Uncalibrated scores; not a diagnosis. This classifier is not a nodule detector; suspected nodules need CT.`,
      `Kirjoittanut ${text(out.model, 60)} yllä olevista pisteistä; erillinen tekoälyn turvallisuustarkistus: ${ok ? 'yhtäpitävä raakapisteiden kanssa.' : `vaatii muutoksia. ${issues}`} Kalibroimattomat pisteet; ei diagnoosi. Luokittelija ei tunnista pesäkkeitä; epäillyt pesäkkeet vaativat TT-tutkimuksen.`));
  }

  function validateResult(result) {
    if (result.status !== 'completed' || !result.model?.name || result.requires_clinician_review !== true || !Array.isArray(result.findings) || !Array.isArray(result.limitations) || typeof result.report_draft !== 'string') throw new Error('The backend response is incomplete. No findings have been displayed.');
    if (!result.findings.length || result.findings.length > 100 || result.findings.some(f => typeof f.label !== 'string' || !Number.isFinite(f.score) || f.score < 0 || f.score > 1)) throw new Error('The backend returned invalid model scores. No findings have been displayed.');
    const png = result.image?.preview_png_base64;
    if (typeof png !== 'string' || png.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(png) || !png.startsWith('iVBORw0KGgo')) throw new Error('The backend did not return a valid PNG preview. No findings have been displayed.');
  }

  function renderResult(result) {
    const imageCard = element('section', 'dicom-image-card');
    const imageHeader = element('div', 'dicom-image-heading');
    imageHeader.append(element('h3', '', 'Uploaded image · Backend preview'), element('span', '', `${text(result.image.modality, 15)} · ${Number(result.image.width) || '?'} × ${Number(result.image.height) || '?'}`));
    const image = element('img', 'dicom-preview-image');
    image.src = `data:image/png;base64,${result.image.preview_png_base64}`;
    image.alt = 'Preview generated from the uploaded chest X-ray DICOM. This classifier provides image-level scores without lesion localisation.';
    const imageCaption = element('p', '', 'Preview supplied by your backend. No tumour outlines or lesion localisation are produced by this classifier.');
    imageCard.append(imageHeader, image, imageCaption);
    const summaryCard = element('section', 'card dicom-ai-summary');
    summaryCard.setAttribute('aria-live', 'polite');
    const outputCard = element('section', 'card');
    outputCard.append(element('h2', '', 'Image-level model outputs'), element('p', 'dicom-section-copy', 'Scores run from 0 to 1.'));
    const outputDrop = element('details', 'agent-drop dicom-drop');
    outputDrop.append(element('summary', '', 'All scores and model details'), element('p', 'dicom-section-copy', 'They are uncalibrated model outputs—not probabilities, a diagnosis, or the likelihood that this person has cancer.'));
    const wrap = element('div', 'table-wrap');
    const table = element('table', 'dicom-score-table');
    const caption = element('caption', 'sr-only', 'Actual classifier scores returned by the connected backend, ranked from highest to lowest');
    const head = element('thead');
    const header = element('tr');
    const labelHeader = element('th', '', 'Model label');
    const scoreHeader = element('th', '', 'Raw score');
    labelHeader.scope = 'col'; scoreHeader.scope = 'col';
    header.append(labelHeader, scoreHeader); head.append(header);
    const body = element('tbody');
    for (const finding of [...result.findings].sort((a, b) => b.score - a.score)) {
      const row = element('tr');
      const name = element('th', '', labelText(text(finding.label, 150), reportLang()));
      name.setAttribute('translate', 'no');
      name.scope = 'row';
      const value = element('td', 'dicom-score', reportLang() === 'fi' ? Number(finding.score).toFixed(4).replace('.', ',') : Number(finding.score).toFixed(4));
      row.append(name, value); body.append(row);
    }
    table.append(caption, head, body); wrap.append(table); outputDrop.append(wrap);
    const provenance = element('dl', 'dicom-provenance');
    for (const [name, value] of [['Model', modelName(result.model)], ['Version', result.model.version || 'Not reported'], ['Weights', result.model.weights || 'Not reported'], ['Task', result.model.task || 'Not reported'], ['Analysis reference', result.analysis_id || 'Not reported']]) provenance.append(element('dt', '', name), element('dd', '', text(value, 300)));
    outputDrop.append(provenance);
    outputCard.append(outputDrop);
    const limits = element('details', 'agent-drop dicom-drop dicom-limitations');
    limits.append(element('summary', '', 'Limitations & clinical review'));
    const limitList = element('ul');
    for (const limitation of result.limitations.slice(0, 30)) limitList.append(element('li', '', text(limitation, 2000)));
    limits.append(limitList);
    const reportCard = element('section', 'card');
    reportCard.append(element('h2', '', 'Reviewable report draft'), element('p', 'dicom-section-copy', 'This structured draft contains the returned model information. Edit it for your research review. Downloading does not sign a clinical report.'));
    const draft = element('textarea', 'dicom-report-draft');
    draft.id = 'dicom-returned-report';
    draft.value = reportLang() === 'fi' ? finnishDraft(result) : text(result.report_draft, 30000);
    draft.rows = 15;
    reportCard.append(field('Draft findings and limitations', draft));
    const downloadButton = element('button', 'button secondary', 'Download review draft');
    downloadButton.type = 'button';
    listen(downloadButton, 'click', () => {
      if (!lastResult) return;
      const link = element('a');
      const url = URL.createObjectURL(new Blob([draft.value], { type: 'text/plain;charset=utf-8' }));
      link.href = url;
      link.download = reportLang() === 'fi' ? 'candex-tutkimusanalyysi-luonnos.txt' : 'candex-research-analysis-draft.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    reportCard.append(downloadButton);
    resultArea.replaceChildren(resultTitle, imageCard, summaryCard, outputCard, limits, reportCard);
    summarise(result, summaryCard, draft);
  }

  syncControls();
  const cleanup = () => {
    alive = false;
    activeController?.abort();
    summaryController?.abort();
    clearTimeout(timer);
    for (const remove of listeners) remove();
    lastResult = undefined;
    if (currentCleanup === cleanup) currentCleanup = undefined;
  };
  currentCleanup = cleanup;
  // When the site is served by the backend itself (e.g. the published site), check the connection
  // straight away (no image is sent), so visitors can try a demo X-ray without extra steps.
  if (['http:', 'https:'].includes(location.protocol) && urlInput.value.trim() === location.origin) connectButton.click();
  return cleanup;
}
