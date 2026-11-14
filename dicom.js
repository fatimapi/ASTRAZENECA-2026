// Real-service client. There are no generated findings or simulated progress steps.
// Connection credentials and results remain in page memory, never localStorage.
let currentCleanup;
let sessionBackend = '';
let sessionToken = '';
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
    if (response.status === 401 || response.status === 403) throw new Error('The API key was not accepted. Check the key configured on the backend, then try again.');
    if (response.status === 413) throw new Error('This file exceeds the backend upload limit. Use a DICOM file smaller than 20 MiB.');
    throw new Error(detail || `The backend could not complete this request (HTTP ${response.status}).`);
  }
  return body;
}

function modelName(model) { return text(model?.name || 'Unnamed model', 250); }

export function mountDicomPanel(container) {
  currentCleanup?.();
  if (!(container instanceof HTMLElement)) throw new TypeError('DICOM panel needs a container element.');
  let alive = true;
  let connected = false;
  let backend = '';
  let busy = false;
  let activeController;
  let timer;
  let lastResult;
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
  tokenInput.value = sessionToken;
  tokenInput.placeholder = 'Paste your backend API key';
  connectionCard.append(field('Backend URL', urlInput, 'Use your local backend or a trusted HTTPS deployment. A plain Python static server does not provide the analysis API.'));
  connectionCard.append(field('Backend API key', tokenInput, 'Enter the CANDEX_API_KEY set on your server. It stays in this page’s memory and is sent only to the backend you select.'));
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
  fileInput.required = true;
  const fileDetails = element('p', 'dicom-file-details', 'No file selected.');
  fileDetails.id = 'dicom-file-details';
  fileInput.setAttribute('aria-describedby', fileDetails.id);
  form.append(field('DICOM file', fileInput), fileDetails);
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
  placeholder.append(element('div', 'dicom-placeholder-mark', '+'), element('h3', '', 'Real results begin with a real connection.'), element('p', '', 'Your image preview, model outputs and report draft will appear here after the backend completes an analysis. No sample findings are mixed into this workspace.'));
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
    resultArea.replaceChildren(resultTitle, placeholder);
  }
  function syncControls() {
    const file = fileInput.files?.[0];
    analyseButton.disabled = busy || !connected || tokenInput.value.trim().length < 24 || !file || file.size > MAX_FILE_BYTES || !chestCheck.checked || !permissionCheck.checked;
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
    else if (tokenInput.value.trim().length < 24) runHint.textContent = 'Enter the backend API key (at least 24 characters) to enable analysis.';
    else if (!file) runHint.textContent = 'Select one supported DICOM file to continue.';
    else if (file.size > MAX_FILE_BYTES) runHint.textContent = 'Choose a DICOM file smaller than 20 MiB.';
    else if (!chestCheck.checked || !permissionCheck.checked) runHint.textContent = 'Confirm the chest X-ray and data-permission checks to continue.';
    else runHint.textContent = 'Ready. The file will be sent only when you choose Analyse DICOM.';
  }
  function disconnect() {
    connected = false;
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
  listen(tokenInput, 'input', () => { sessionToken = tokenInput.value; syncControls(); });
  listen(forgetButton, 'click', () => { sessionToken = ''; tokenInput.value = ''; resetResult(); setStatus(requestStatus, 'API key cleared from this page session.'); syncControls(); });
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
    fileInput.value = '';
    chestCheck.checked = false;
    permissionCheck.checked = false;
    fileDetails.textContent = 'No file selected.';
    resetResult();
    setStatus(requestStatus, 'Image selection and analysis results cleared from this page.');
    syncControls();
  });
  listen(connectButton, 'click', async () => {
    if (busy) return;
    resetResult();
    connected = false;
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
      setStatus(connectionStatus, `Backend reachable · ${modelName(data.model)}. ${data.model.loaded ? 'Model is loaded.' : 'Model will load on the first analysis.'} API credentials are checked when analysis starts.`, 'success');
    } catch (error) { if (alive) setStatus(connectionStatus, networkError(error, 'Connection check'), 'error'); }
    finally { if (alive) { busy = false; syncControls(); } }
  });
  listen(form, 'submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (!connected) { setStatus(requestStatus, 'Check the backend connection first.', 'error'); return; }
    const file = fileInput.files?.[0];
    const key = tokenInput.value.trim();
    if (!file || file.size > MAX_FILE_BYTES || !chestCheck.checked || !permissionCheck.checked || key.length < 24) { setStatus(requestStatus, 'Choose a file within the size limit, enter the API key and confirm both checks.', 'error'); return; }
    const body = new FormData();
    body.append('file', file);
    body.append('confirmed_chest', 'true');
    body.append('permitted_data', 'true');
    resetResult();
    busy = true;
    syncControls();
    setStatus(requestStatus, 'The backend is running the model. Waiting for its actual response…');
    try {
      const result = await request(`${backend}/api/analyze`, { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${key}` }, body }, ANALYSIS_TIMEOUT_MS);
      if (!alive) return;
      validateResult(result);
      lastResult = result;
      renderResult(result);
      setStatus(requestStatus, 'Analysis completed by the backend. Review the model outputs and limitations below.', 'success');
    } catch (error) { if (alive) setStatus(requestStatus, networkError(error, 'Analysis'), 'error'); }
    finally { if (alive) { busy = false; syncControls(); } }
  });

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
    const outputCard = element('section', 'card');
    outputCard.append(element('h2', '', 'Image-level model outputs'), element('p', 'dicom-section-copy', 'Scores run from 0 to 1. They are uncalibrated model outputs—not probabilities, a diagnosis, or the likelihood that this person has cancer.'));
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
      const name = element('th', '', text(finding.label, 150));
      name.scope = 'row';
      const value = element('td', 'dicom-score', Number(finding.score).toFixed(4));
      row.append(name, value); body.append(row);
    }
    table.append(caption, head, body); wrap.append(table); outputCard.append(wrap);
    const provenance = element('dl', 'dicom-provenance');
    for (const [name, value] of [['Model', modelName(result.model)], ['Version', result.model.version || 'Not reported'], ['Weights', result.model.weights || 'Not reported'], ['Task', result.model.task || 'Not reported'], ['Analysis reference', result.analysis_id || 'Not reported']]) provenance.append(element('dt', '', name), element('dd', '', text(value, 300)));
    outputCard.append(provenance);
    const limits = element('section', 'dicom-limitations');
    limits.append(element('h3', '', 'Limitations & clinical review'));
    const limitList = element('ul');
    for (const limitation of result.limitations.slice(0, 30)) limitList.append(element('li', '', text(limitation, 2000)));
    limits.append(limitList);
    const reportCard = element('section', 'card');
    reportCard.append(element('h2', '', 'Reviewable report draft'), element('p', 'dicom-section-copy', 'This structured draft contains the returned model information. Edit it for your research review. Downloading does not sign a clinical report.'));
    const draft = element('textarea', 'dicom-report-draft');
    draft.id = 'dicom-returned-report';
    draft.value = text(result.report_draft, 30000);
    draft.rows = 15;
    reportCard.append(field('Draft findings and limitations', draft));
    const downloadButton = element('button', 'button secondary', 'Download review draft');
    downloadButton.type = 'button';
    listen(downloadButton, 'click', () => {
      if (!lastResult) return;
      const link = element('a');
      const url = URL.createObjectURL(new Blob([draft.value], { type: 'text/plain;charset=utf-8' }));
      link.href = url;
      link.download = 'candex-research-analysis-draft.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    reportCard.append(downloadButton);
    resultArea.replaceChildren(resultTitle, imageCard, outputCard, limits, reportCard);
  }

  syncControls();
  const cleanup = () => {
    alive = false;
    activeController?.abort();
    clearTimeout(timer);
    for (const remove of listeners) remove();
    lastResult = undefined;
    if (currentCleanup === cleanup) currentCleanup = undefined;
  };
  currentCleanup = cleanup;
  return cleanup;
}
