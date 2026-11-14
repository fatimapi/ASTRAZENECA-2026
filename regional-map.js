/* Official local boundary snapshot + explicitly synthetic care-performance fixtures.
 * No public patient data, external map tiles, API keys or inferred regional statistics.
 */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SIZE = { width: 560, height: 640, padding: 26 };
  const COS64 = Math.cos(64 * Math.PI / 180);
  const METRICS = [
    { id: 'referral_review_days', label: 'Referral receipt → assessment start', fi: 'Lähetteen saapuminen → arvioinnin alku', unit: 'days', fiUnit: 'päivää' },
    { id: 'specialist_assessment_days', label: 'Specialist assessment', fi: 'Erikoislääkärin arvio', unit: 'days', fiUnit: 'päivää' },
    { id: 'treatment_wait_days', label: 'Treatment waiting time', fi: 'Hoidon odotusaika', unit: 'days', fiUnit: 'päivää' },
    { id: 'followup_completion', label: 'Follow-up completion', fi: 'Seurannan toteutuminen', unit: '%', fiUnit: '%' },
    { id: 'data_completeness', label: 'Data completeness', fi: 'Tietojen kattavuus', unit: '%', fiUnit: '%' }
  ];
  // Values are synthetic fixtures, deliberately varied to exercise the status rules.
  // Order: referral-review days, specialist-assessment days, treatment-wait days,
  // follow-up completion %, data completeness %. No clinical urgency is inferred.
  const FIXTURES = {
    '01': [13, 55, 68, 96, 95], '02': [18, 69, 80, 94, 91],
    '04': [22, 85, 105, 91, 87], '05': [15, 66, 82, 97, 96],
    '06': [17, 78, 95, 94, 93], '07': [25, 96, 120, 90, 88],
    '08': [20, 82, 100, 92, 90], '09': [29, 104, 125, 86, 84],
    '10': [23, 92, 110, 90, 89], '11': [26, 98, 118, 89, 87],
    '12': [24, 102, 122, 88, 86], '13': [19, 79, 96, 94, 92],
    '14': [16, 71, 87, 95, 94], '15': [14, 64, 77, 97, 96],
    '16': [21, 88, 105, 91, 90], '17': [28, 109, 132, 87, 83],
    '18': [31, 117, 145, 85, 82], '19': [35, 128, 160, 83, 79],
    '21': [null, null, null, null, null]
  };
  const FALLBACK_NAMES = [
    ['01','Uusimaa','Uusimaa'], ['02','Southwest Finland','Varsinais-Suomi'],
    ['04','Satakunta','Satakunta'], ['05','Kanta-Häme','Kanta-Häme'],
    ['06','Pirkanmaa','Pirkanmaa'], ['07','Päijät-Häme','Päijät-Häme'],
    ['08','Kymenlaakso','Kymenlaakso'], ['09','South Karelia','Etelä-Karjala'],
    ['10','South Savo','Etelä-Savo'], ['11','North Savo','Pohjois-Savo'],
    ['12','North Karelia','Pohjois-Karjala'], ['13','Central Finland','Keski-Suomi'],
    ['14','South Ostrobothnia','Etelä-Pohjanmaa'], ['15','Ostrobothnia','Pohjanmaa'],
    ['16','Central Ostrobothnia','Keski-Pohjanmaa'], ['17','North Ostrobothnia','Pohjois-Pohjanmaa'],
    ['18','Kainuu','Kainuu'], ['19','Lapland','Lappi'], ['21','Åland','Ahvenanmaa']
  ];
  const STATUS_TEXT = {
    green: ['Under control', 'Hallinnassa'], yellow: ['Needs review', 'Vaatii tarkistusta'],
    red: ['Urgent action', 'Kiireellisiä toimia'], unknown: ['No data / no applicable target', 'Ei tietoa / soveltuvaa tavoitetta']
  };
  function text(en, fi) { return window.candexI18n?.lang === 'fi' ? fi : en; }
  function el(tag, cls, content) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }
  function eachRing(geometry, callback) {
    if (geometry.type === 'Polygon') geometry.coordinates.forEach(callback);
    else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(polygon => polygon.forEach(callback));
  }
  function projection(features) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const feature of features) eachRing(feature.geometry, ring => {
      for (const [lon, lat] of ring) {
        const x = lon * COS64, y = -lat;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    });
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) throw new Error('Invalid boundary extent');
    const scale = Math.min((SIZE.width - 2 * SIZE.padding) / (maxX - minX), (SIZE.height - 2 * SIZE.padding) / (maxY - minY));
    const left = (SIZE.width - (maxX - minX) * scale) / 2;
    const top = (SIZE.height - (maxY - minY) * scale) / 2;
    return ([lon, lat]) => [left + (lon * COS64 - minX) * scale, top + (-lat - minY) * scale];
  }
  function pathFor(geometry, project) {
    let path = '';
    eachRing(geometry, ring => {
      if (!Array.isArray(ring) || ring.length < 4) return;
      path += ring.map((coordinate, i) => {
        const [x, y] = project(coordinate);
        return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
      }).join('') + 'Z';
    });
    return path;
  }
  function displayValue(metric, value) {
    return Number.isFinite(value) ? `${value}${metric.unit === '%' ? '%' : ` ${text(metric.unit, metric.fiUnit)}`}` : text('No data', 'Ei tietoa');
  }
  function evaluate(metricId, value) {
    const fallback = { level: 'unknown', label: text(...STATUS_TEXT.unknown), thresholdLabel: text('No applicable target is configured.', 'Soveltuvaa tavoitetta ei ole määritetty.'), basis: 'unconfigured' };
    if (!Number.isFinite(value)) return { ...fallback, label: text('No data', 'Ei tietoa') };
    try {
      const result = window.CandexKpis?.evaluate(metricId, value);
      return result && Object.hasOwn(STATUS_TEXT, result.level) ? result : fallback;
    } catch { return fallback; }
  }
  function validateData(data) {
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length !== 19) throw new Error('Expected the 19-region boundary snapshot');
    const codes = new Set();
    for (const feature of data.features) {
      const code = feature.properties?.code;
      if (!Object.hasOwn(FIXTURES, code) || codes.has(code) || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) throw new Error('Invalid region boundary');
      codes.add(code);
      eachRing(feature.geometry, ring => {
        if (!Array.isArray(ring) || ring.length < 4 || ring.some(point => !Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 18 || point[0] > 33 || point[1] < 59 || point[1] > 71)) throw new Error('Invalid boundary coordinates');
      });
    }
    return data.features;
  }
  function mount(container, { onSelect } = {}) {
    if (!(container instanceof HTMLElement)) throw new TypeError('The regional map requires a container');
    let alive = true, selected = '01', metricIndex = 0, zoom = 1, geometryFeatures;
    const controller = new AbortController();
    const listeners = [], pathNodes = new Map(), featureCentres = new Map();
    const listen = (node, event, callback) => { node.addEventListener(event, callback); listeners.push(() => node.removeEventListener(event, callback)); };
    const root = el('section', 'regional-map-workspace');
    const intro = el('div', 'regional-map-intro');
    intro.append(el('span', 'badge', text('Official boundaries · Synthetic care data', 'Viralliset rajat · Kuvitteelliset hoitotiedot')),
      el('h2', '', text('Explore Finland, region by region', 'Tutustu Suomeen maakunnittain')),
      el('p', '', text('Detailed 2026 administrative regions (maakunta), including Åland. These 19 regions are not the wellbeing services county division. Select a region to inspect the illustrative indicator and its threshold basis.', 'Vuoden 2026 maakuntarajat, Ahvenanmaa mukaan lukien. Nämä 19 maakuntaa eivät vastaa hyvinvointialuejakoa. Valitse maakunta nähdäksesi kuvitteellisen mittarin ja raja-arvon perusteen.')));
    root.append(intro);
    const toolbar = el('div', 'regional-map-toolbar');
    const metricLabel = el('label', '', text('Indicator', 'Mittari'));
    const metricSelect = el('select'); metricSelect.id = 'regional-map-metric'; metricLabel.htmlFor = metricSelect.id;
    for (const [index, metric] of METRICS.entries()) { const option = el('option', '', text(metric.label, metric.fi)); option.value = String(index); metricSelect.append(option); }
    const regionLabel = el('label', '', text('Region', 'Maakunta'));
    const regionSelect = el('select'); regionSelect.id = 'regional-map-region'; regionLabel.htmlFor = regionSelect.id;
    for (const [code, en, fi] of FALLBACK_NAMES) { const option = el('option', '', text(en, fi)); option.value = code; regionSelect.append(option); }
    toolbar.append(metricLabel, metricSelect, regionLabel, regionSelect); root.append(toolbar);
    const layout = el('div', 'regional-map-layout');
    const mapColumn = el('div', 'regional-map-column');
    const frame = el('div', 'regional-map-frame');
    const loading = el('p', 'regional-map-loading', text('Loading local geographic boundaries…', 'Ladataan paikallisia maakuntarajoja…')); loading.setAttribute('role', 'status');
    frame.append(loading);
    const svg = svgEl('svg', { viewBox: `0 0 ${SIZE.width} ${SIZE.height}`, role: 'group', 'aria-label': text('Interactive map of Finland’s 19 administrative regions. Use Tab and Enter to choose a region.', 'Suomen 19 maakunnan interaktiivinen kartta. Valitse maakunta sarkaimella ja Enterillä.') });
    const svgTitle = svgEl('title'); svgTitle.textContent = text('Finland administrative regions, 2026', 'Suomen maakunnat vuonna 2026'); svg.append(svgTitle);
    const shapeGroup = svgEl('g', { class: 'regional-map-shapes' }); svg.append(shapeGroup);
    const zoomControls = el('div', 'regional-map-zoom');
    const zoomIn = el('button', '', '+'), zoomOut = el('button', '', '−'), reset = el('button', '', text('Reset', 'Palauta'));
    zoomIn.type = zoomOut.type = reset.type = 'button';
    zoomIn.setAttribute('aria-label', text('Zoom in on selected region', 'Lähennä valittuun maakuntaan'));
    zoomOut.setAttribute('aria-label', text('Zoom out', 'Loitonna'));
    zoomControls.append(zoomIn, zoomOut, reset);
    frame.append(zoomControls);
    const mapHint = el('p', 'regional-map-hint', text('Tab to a region and press Enter or Space. Arrow keys move between regions. Zoom centres on the selected region.', 'Siirry maakuntaan sarkaimella ja paina Enteriä tai välilyöntiä. Nuolinäppäimet vaihtavat maakuntaa. Lähennys kohdistuu valittuun maakuntaan.'));
    const legend = el('ul', 'regional-map-legend'); legend.setAttribute('aria-label', text('KPI status legend', 'Mittarien tilojen selite'));
    for (const level of ['green', 'yellow', 'red', 'unknown']) {
      const item = el('li'); item.append(el('span', `regional-map-swatch is-${level}`), el('span', '', text(...STATUS_TEXT[level]))); legend.append(item);
    }
    mapColumn.append(frame, mapHint, legend); layout.append(mapColumn);
    const detail = el('aside', 'regional-map-detail'); detail.setAttribute('aria-live', 'polite'); detail.setAttribute('aria-atomic', 'true'); layout.append(detail); root.append(layout);
    const tableDetails = el('details', 'regional-map-table-details'); tableDetails.append(el('summary', '', text('View all 19 regions as a table', 'Näytä kaikki 19 maakuntaa taulukkona')));
    const tableWrap = el('div', 'table-wrap'); const table = el('table'); const caption = el('caption', 'sr-only', text('Synthetic regional indicator values', 'Kuvitteelliset maakuntien mittariarvot')); table.append(caption);
    const tableHead = el('thead'); const headRow = el('tr'); for (const name of [text('Region', 'Maakunta'), text('Illustrative value', 'Kuvitteellinen arvo'), text('Status', 'Tila')]) { const th = el('th', '', name); th.scope = 'col'; headRow.append(th); } tableHead.append(headRow); table.append(tableHead);
    const tableBody = el('tbody'); table.append(tableBody); tableWrap.append(table); tableDetails.append(tableWrap); root.append(tableDetails);
    const attribution = el('p', 'regional-map-attribution');
    attribution.append(document.createTextNode(text('Boundaries: Statistics Finland, 2026 · CC BY 4.0. Care values are synthetic demo fixtures. ', 'Rajat: Tilastokeskus, 2026 · CC BY 4.0. Hoitotiedot ovat kuvitteellisia demoarvoja. ')));
    const sourceLink = el('a', '', text('Source & licence', 'Lähde ja lisenssi')); sourceLink.href = 'https://stat.fi/en/services/statistical-data-services/geographic-data/statistical-areas/municipality-based-statistical-units'; sourceLink.target = '_blank'; sourceLink.rel = 'noopener'; attribution.append(sourceLink); root.append(attribution);
    container.replaceChildren(root);

    function selectedName(code) { const row = FALLBACK_NAMES.find(row => row[0] === code); return text(row[1], row[2]); }
    function statusLabel(status) { return text(...STATUS_TEXT[status.level]); }
    function updateZoom() {
      const width = SIZE.width / zoom, height = SIZE.height / zoom;
      const centre = featureCentres.get(selected) || [SIZE.width / 2, SIZE.height / 2];
      const x = zoom === 1 ? 0 : Math.max(0, Math.min(SIZE.width - width, centre[0] - width / 2));
      const y = zoom === 1 ? 0 : Math.max(0, Math.min(SIZE.height - height, centre[1] - height / 2));
      svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
      zoomOut.disabled = zoom === 1; zoomIn.disabled = zoom >= 4; reset.disabled = zoom === 1;
    }
    function updateDetails() {
      const metric = METRICS[metricIndex], value = FIXTURES[selected][metricIndex], status = evaluate(metric.id, value);
      const title = el('h3', '', selectedName(selected)); const code = el('p', 'regional-map-code', `${text('Administrative region', 'Maakunta')} ${selected} · 2026`);
      const heading = el('h4', '', text(metric.label, metric.fi)); const number = el('strong', 'regional-map-value', displayValue(metric, value));
      const statusNode = el('span', `regional-map-state is-${status.level}`, statusLabel(status));
      const basisTitle = el('h4', '', text('Threshold basis', 'Raja-arvon peruste'));
      const basis = el('p', 'regional-map-basis', String(status.thresholdLabel || status.basis || text('No applicable threshold', 'Ei soveltuvaa raja-arvoa')));
      const note = el('p', 'regional-map-note', text('This is an illustrative value, not a measurement of this region’s healthcare. Red signals a pathway-management action under the stated rule; it is not an individual patient’s clinical urgency.', 'Tämä on kuvitteellinen arvo, ei maakunnan terveydenhuollon mittaustulos. Punainen tarkoittaa hoitopolun hallinnan toimenpidetarvetta ilmoitetun säännön mukaan, ei yksittäisen potilaan kliinistä kiireellisyyttä.'));
      detail.replaceChildren(title, code, heading, number, statusNode, basisTitle, basis);
      if (status.source) {
        const href = typeof status.source === 'string' ? status.source : status.source.url;
        if (typeof href === 'string' && /^https:\/\//.test(href)) {
          const link = el('a', 'text-btn', text('View threshold source', 'Näytä raja-arvon lähde')); link.href = href; link.target = '_blank'; link.rel = 'noopener'; detail.append(link);
        }
      }
      detail.append(note);
    }
    function redraw() {
      const metric = METRICS[metricIndex];
      tableBody.replaceChildren();
      for (const [code, en, fi] of FALLBACK_NAMES) {
        const value = FIXTURES[code][metricIndex], status = evaluate(metric.id, value), name = text(en, fi);
        const path = pathNodes.get(code);
        if (path) {
          path.setAttribute('class', `regional-map-region is-${status.level}${selected === code ? ' is-selected' : ''}`);
          path.setAttribute('aria-pressed', String(selected === code));
          path.setAttribute('aria-label', `${name}: ${displayValue(metric, value)}. ${statusLabel(status)}. ${text('Synthetic data', 'Kuvitteellista dataa')}`);
          path.firstChild.textContent = `${name} · ${displayValue(metric, value)} · ${statusLabel(status)}`;
        }
        const row = el('tr'); const th = el('th'); th.scope = 'row';
        const button = el('button', 'regional-map-row-button', name); button.type = 'button'; button.dataset.regionCode = code; button.setAttribute('aria-pressed', String(selected === code)); th.append(button);
        const valueCell = el('td', '', displayValue(metric, value)); const statusCell = el('td'); statusCell.append(el('span', `regional-map-state is-${status.level}`, statusLabel(status)));
        row.append(th, valueCell, statusCell); tableBody.append(row);
      }
      regionSelect.value = selected; updateDetails(); updateZoom();
    }
    function select(code, notify = true) {
      if (!Object.hasOwn(FIXTURES, code)) return;
      selected = code; redraw();
      if (notify && typeof onSelect === 'function') onSelect({ code, name: selectedName(code), metricId: METRICS[metricIndex].id, value: FIXTURES[code][metricIndex], synthetic: true });
    }
    listen(regionSelect, 'change', () => select(regionSelect.value));
    listen(metricSelect, 'change', () => { metricIndex = Number(metricSelect.value); redraw(); });
    listen(tableBody, 'click', event => { const button = event.target.closest?.('[data-region-code]'); if (button && tableBody.contains(button)) { const code = button.dataset.regionCode; select(code); tableBody.querySelector(`[data-region-code="${code}"]`)?.focus(); } });
    listen(zoomIn, 'click', () => { zoom = Math.min(4, zoom + .5); updateZoom(); });
    listen(zoomOut, 'click', () => { zoom = Math.max(1, zoom - .5); updateZoom(); });
    listen(reset, 'click', () => { zoom = 1; updateZoom(); });
    redraw();

    fetch(new URL('data/finland-regions.geojson', document.baseURI), { signal: controller.signal, cache: 'force-cache', credentials: 'same-origin' })
      .then(response => { if (!response.ok) throw new Error('Boundary file unavailable'); return response.json(); })
      .then(data => {
        if (!alive) return;
        geometryFeatures = validateData(data); const project = projection(geometryFeatures);
        geometryFeatures.forEach((feature, index) => {
          const code = feature.properties.code; const path = svgEl('path', { d: pathFor(feature.geometry, project), tabindex: '0', role: 'button', 'fill-rule': 'evenodd', 'data-region': code });
          const title = svgEl('title'); path.append(title); pathNodes.set(code, path); shapeGroup.append(path);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          eachRing(feature.geometry, ring => ring.forEach(coordinate => { const [x, y] = project(coordinate); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }));
          featureCentres.set(code, [(minX + maxX) / 2, (minY + maxY) / 2]);
          listen(path, 'click', () => select(code));
          listen(path, 'keydown', event => {
            if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(code); }
            else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
              event.preventDefault(); const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
              const next = geometryFeatures[(index + direction + geometryFeatures.length) % geometryFeatures.length].properties.code;
              select(next); pathNodes.get(next).focus();
            }
          });
        });
        frame.replaceChildren(svg, zoomControls); redraw();
      })
      .catch(error => {
        if (!alive || error.name === 'AbortError') return;
        loading.textContent = text('Geographic boundaries could not load. The region selector, indicator details and full table below remain available.', 'Maakuntarajoja ei voitu ladata. Maakuntavalitsin, mittaritiedot ja alla oleva taulukko ovat edelleen käytettävissä.');
        loading.setAttribute('role', 'alert'); zoomControls.hidden = true;
      });
    return () => { alive = false; controller.abort(); for (const remove of listeners) remove(); };
  }
  window.CandexRegionalMap = { mount };
  // Pure helpers support non-browser checks without requiring a browser runner.
  window.CandexRegionalMapTest = { validateData, projection, pathFor, evaluate, metrics: METRICS, fixtures: FIXTURES };
})();
