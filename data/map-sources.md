# Finland regional boundary source

- **Producer:** Statistics Finland (Tilastokeskus).
- **Dataset:** Municipality-based statistical units; 2026 administrative regions (`maakunta`), official generalised 1:4,500,000 boundary layer.
- **Layer:** `tilastointialueet:maakunta4500k_2026`.
- **Downloaded:** 14 November 2026.
- **CRS in this snapshot:** WGS84 longitude/latitude (`EPSG:4326` GeoJSON coordinates).
- **Licence:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
- **Attribution:** Source: Statistics Finland, administrative regions 2026. Property names were normalised and file metadata removed. The official generalised polygon coordinates were retained; no third-party basemap or tile service is used.

## Primary sources

- [Dataset description](https://stat.fi/en/services/statistical-data-services/geographic-data/statistical-areas/municipality-based-statistical-units)
- [Statistics Finland interface documentation](https://stat.fi/en/services/statistical-data-services/open-data-and-interfaces/interface-use-of-geographic-data)
- [Statistics Finland licence and terms](https://stat.fi/en/about-us/get-to-know-statistics-finland/legislation/terms-of-use)
- [Exact WFS download](https://geo.stat.fi/geoserver/tilastointialueet/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=tilastointialueet%3Amaakunta4500k_2026&outputFormat=application%2Fjson&srsName=EPSG%3A4326)

## Coverage and limitations

All **19 administrative regions**, including Åland, are represented. Administrative regions are **not** the same division as the 21 wellbeing services counties, Helsinki and Åland service arrangements; the interface explicitly uses the administrative-region label. The 1:4,500,000 source is generalised for national visualisation; this is not a cadastral or clinical catchment map.

The local SVG renderer projects longitude with a fixed cosine latitude factor and latitude linearly. This is a display projection, not a surveying or travel-distance tool. All polygon parts and holes in the source snapshot are preserved.

Every care-performance value in `regional-map.js` is an explicitly synthetic demonstration fixture. These values are **not** Statistics Finland statistics and are not joined to real patient records. Åland's fixture values are intentionally absent to demonstrate the grey no-data state. KPI colours are provided by `window.CandexKpis.evaluate`; absent or invalid evaluations remain grey. A boundary's official status does not validate its synthetic care-performance figures.
