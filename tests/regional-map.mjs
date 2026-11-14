import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../regional-map.js', import.meta.url), 'utf8');
const data = JSON.parse(fs.readFileSync(new URL('../data/finland-regions.geojson', import.meta.url), 'utf8'));
const context = vm.createContext({ window: {}, console });
vm.runInContext(source, context);
const api = context.window.CandexRegionalMapTest;
const features = api.validateData(data);
assert.equal(features.length, 19);
assert(features.some(f => f.properties.code === '21' && f.properties.name === 'Åland'));
assert.equal(new Set(features.map(f => f.properties.code)).size, 19);
assert(fs.statSync(new URL('../data/finland-regions.geojson', import.meta.url)).size < 600 * 1024);
const project = api.projection(features);
let points = 0, multiParts = 0;
for (const feature of features) {
  const path = api.pathFor(feature.geometry, project);
  assert(path.startsWith('M') && path.endsWith('Z'));
  assert(!path.includes('NaN') && !path.includes('Infinity'));
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  multiParts += polygons.length;
  for (const polygon of polygons) for (const ring of polygon) for (const coordinate of ring) {
    points++;
    const [x, y] = project(coordinate);
    assert(x >= 0 && x <= 560 && y >= 0 && y <= 640);
  }
}
assert(points > 2000, 'Must retain detailed boundary points');
assert(multiParts > 19, 'Must preserve mainland/island polygon parts');
assert.equal(api.evaluate('referral_review_days', 10).level, 'unknown');
context.window.CandexKpis = { evaluate: (_id, value) => ({ level: value <= 21 ? 'green' : 'red', thresholdLabel: 'TEST RULE' }) };
assert.equal(api.evaluate('referral_review_days', 10).level, 'green');
assert.equal(api.evaluate('referral_review_days', 30).level, 'red');
assert.equal(api.evaluate('referral_review_days', null).level, 'unknown');
assert.equal(api.evaluate('referral_review_days', NaN).level, 'unknown');
context.window.CandexKpis = { evaluate: () => ({ level: 'invalid' }) };
assert.equal(api.evaluate('referral_review_days', 10).level, 'unknown');
context.window.CandexKpis = { evaluate: () => { throw new Error('unavailable'); } };
assert.equal(api.evaluate('referral_review_days', 10).level, 'unknown');
assert.throws(() => api.validateData({ type: 'FeatureCollection', features: [] }));
const duplicate = JSON.parse(JSON.stringify(data)); duplicate.features[1].properties.code = duplicate.features[0].properties.code;
assert.throws(() => api.validateData(duplicate));
const wrongAxis = JSON.parse(JSON.stringify(data)); wrongAxis.features[0].geometry.coordinates[0][0] = [90, 90];
assert.throws(() => api.validateData(wrongAxis));
for (const row of Object.values(api.fixtures)) assert.equal(row.length, api.metrics.length);
assert(Object.values(api.fixtures).some(row => row.every(value => value === null)));
console.log(`PASS: 19 official regions, ${points} retained boundary points, ${multiParts} polygon parts, valid projection, size, status delegation and no-data/error fallbacks.`);
