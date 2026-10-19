import test from 'node:test';
import assert from 'node:assert/strict';
import { energyCacheKey, retainEnergySnapshot } from '../public/js/energy-core.js';

// Synthetic observations verify UI isolation; these are not live price fixtures.
const OLD_FETCH = '2026-10-18T01:02:03.000Z';
const NEW_FETCH = '2026-10-19T01:02:03.000Z';
const row = Object.freeze({
  id: 'sido:01:B027', dataGranularity: 'aggregate', scope: 'sido',
  sidoCode: '01', fuel: 'B027', unit: 'KRW/L', averagePrice: 1667.33,
  asOfDate: '2026-10-17', sourceDate: '20261017', fetchedAt: OLD_FETCH,
});
const previous = Object.freeze({
  status: 'ready', fetchedAt: OLD_FETCH, benchmarks: Object.freeze([row]),
  cache: Object.freeze({ stale: false }), warnings: Object.freeze([]),
});

test('UI cached observations cannot cross fuel, province, district or collection boundaries', () => {
  const scopes = [
    { fuel: 'B027', sido: '', includeSigun: false },
    { fuel: 'D047', sido: '', includeSigun: false },
    { fuel: 'B027', sido: '01', includeSigun: false },
    { fuel: 'B027', sido: '02', includeSigun: false },
    { fuel: 'B027', sido: '01', includeSigun: true },
  ];
  const keys = scopes.map(scope => energyCacheKey('averages', scope));
  keys.push(energyCacheKey('highway', scopes[0]));
  assert.equal(new Set(keys).size, keys.length);
  const cache = new Map([[keys[2], previous]]);
  for (const key of keys.filter(key => key !== keys[2])) assert.equal(cache.get(key), undefined);
});

test('a failed browser refresh keeps original reference and fetch dates and explicitly marks retained data stale', () => {
  for (const status of ['error', 'awaiting_credentials']) {
    const failed = Object.freeze({ status, benchmarks: Object.freeze([]), fetchedAt: NEW_FETCH, error: { message: 'Synthetic failure' } });
    const result = retainEnergySnapshot(failed, previous, 'averages');
    assert.equal(result.status, 'partial');
    assert.equal(result.fetchedAt, OLD_FETCH);
    assert.equal(result.benchmarks[0].fetchedAt, OLD_FETCH);
    assert.equal(result.benchmarks[0].asOfDate, '2026-10-17');
    assert.equal(result.benchmarks[0].sourceDate, '20261017');
    assert.equal(result.cache.stale, true);
    assert.equal(result.cache.clientRetained, true);
    assert.equal(previous.cache.stale, false);
    assert.equal(failed.fetchedAt, NEW_FETCH);
    const retry = retainEnergySnapshot(failed, result, 'averages');
    assert.equal(retry.warnings.filter(warning => warning.code === 'PRESERVED_PREVIOUS_SNAPSHOT').length, 1);
    assert.equal(retainEnergySnapshot(failed, undefined, 'averages').benchmarks.length, 0);
  }
});

test('a valid empty response clears old rows while an invalid collection is rejected', () => {
  for (const status of ['ready', 'partial']) {
    const next = Object.freeze({ status, benchmarks: Object.freeze([]), fetchedAt: NEW_FETCH });
    const result = retainEnergySnapshot(next, previous, 'averages');
    assert.equal(result, next);
    assert.equal(result.benchmarks.length, 0);
    assert.equal(result.fetchedAt, NEW_FETCH);
  }
  assert.throws(() => retainEnergySnapshot({ status: 'ready', stations: [] }, previous, 'averages'), /Invalid energy snapshot collection/);
});
