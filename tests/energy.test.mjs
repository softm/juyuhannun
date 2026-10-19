import test from 'node:test';
import assert from 'node:assert/strict';
import { observedRecently, safeSourceUrl, visibleBenchmarks } from '../public/js/energy-core.js';
import { getFuelPrice } from '../public/js/core.js';
import { preservePrevious } from '../scripts/snapshot.mjs';

// Synthetic fixtures exercise display/retention boundaries, not live prices.
const NOW = Date.parse('2026-10-19T06:00:00.000Z');
const OLD_FETCH = '2026-10-18T05:00:00.000Z';
const NEW_FETCH = new Date(NOW).toISOString();
const FALLBACK = 'https://www.opinet.co.kr/';
const at = offset => new Date(NOW + offset).toISOString();

function average(overrides = {}) {
  return {
    id: 'national:KR:B027', dataGranularity: 'aggregate', scope: 'national',
    areaCode: null, areaName: '전국', sidoCode: null, sigunCode: null,
    fuel: 'B027', fuelName: '휘발유', averagePrice: 1667.33,
    dayOverDayChange: -0.23, unit: 'KRW/L', asOfDate: '2026-10-18',
    dateStatus: 'reported', sourceDate: '20261018', fetchedAt: OLD_FETCH,
    source: { name: '한국석유공사 오피넷', url: FALLBACK },
    ...overrides,
  };
}

function station(overrides = {}) {
  return {
    id: 'synthetic-station', dataGranularity: 'station', name: '검증용 주유소',
    fuel: 'B027', unit: 'KRW/L', price: 1650, fetchedAt: OLD_FETCH,
    prices: { B027: { price: 1650, unit: 'KRW/L', priceUpdatedAt: '2026-10-18T04:00:00.000Z', fetchedAt: OLD_FETCH } },
    ...overrides,
  };
}

function averageEnvelope(overrides = {}) {
  return {
    status: 'ready', provider: 'opinet', dataGranularity: 'aggregate', fetchedAt: OLD_FETCH,
    benchmarks: [average()], warnings: [],
    coverage: { kind: 'regional_average', scopes: ['national', 'sido'], complete: false },
    cache: { hit: false, ageSeconds: 0, stale: false },
    ...overrides,
  };
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

test('recent observations require a parseable string; missing dates never become a fresh observation', () => {
  for (const value of [undefined, null, '', ' ', 'not-a-date', {}, [], NOW, new Date(NOW)]) {
    assert.equal(observedRecently(value, NOW), false, String(value));
  }
  assert.equal(observedRecently(NEW_FETCH, NOW), true);
});

test('recent observation expiry and the explicit one-minute clock-skew allowance have strict boundaries', () => {
  assert.equal(observedRecently(at(-5 * 60_000), NOW), true);
  assert.equal(observedRecently(at(-5 * 60_000 - 1), NOW), false);
  assert.equal(observedRecently(OLD_FETCH, NOW), false);
  assert.equal(observedRecently(at(60_000), NOW), true);
  assert.equal(observedRecently(at(60_001), NOW), false);
  assert.equal(observedRecently(at(24 * 60 * 60_000), NOW), false);
  assert.equal(observedRecently(at(-60_001), NOW, 60_000), false);
});

test('average display admits only aggregate records in the requested fuel and KRW/L unit', () => {
  const valid = average();
  const input = [
    valid, station(),
    average({ id: 'electricity', unit: 'KRW/kWh' }),
    average({ id: 'hydrogen', unit: 'KRW/kg' }),
    average({ id: 'foreign-currency', unit: 'USD/L' }),
    average({ id: 'unverified-unit', unit: '원/L' }),
    average({ id: 'missing-unit', unit: undefined }),
    average({ id: 'diesel', fuel: 'D047' }),
    average({ id: 'missing-granularity', dataGranularity: undefined }),
    null, undefined,
  ];
  assert.deepEqual(visibleBenchmarks(input, { fuel: 'B027' }), [valid]);
  assert.equal(getFuelPrice(valid, 'B027'), null, 'An average must not become an individual price or a savings input.');
  assert.equal(getFuelPrice(average({ prices: station().prices }), 'B027'), null, 'Aggregate records cannot cross the boundary even with a stray prices field.');
  assert.equal(getFuelPrice(station({ unit: 'KRW/kg' }), 'B027'), null, 'A hydrogen unit cannot become a liquid fuel price.');
  assert.equal(getFuelPrice(station(), 'B027').price, 1650);
});

test('average filters preserve Opinet region codes, keep the national reference and order geographic scopes', () => {
  const national = average();
  const seoul = average({ id: 'sido:01:B027', scope: 'sido', areaCode: '01', areaName: '서울', sidoCode: '01', asOfDate: null });
  const jongno = average({ id: 'sigun:0101:B027', scope: 'sigun', areaCode: '0101', areaName: '서울 종로구', sidoCode: '01', sigunCode: '0101', asOfDate: null });
  const jeju = average({ id: 'sido:11:B027', scope: 'sido', areaCode: '11', areaName: '제주', sidoCode: '11', asOfDate: null });
  const input = freezeDeep([jongno, jeju, seoul, national]);
  assert.deepEqual(visibleBenchmarks(input, { fuel: 'B027', sido: '01' }), [national, seoul, jongno]);
  assert.deepEqual(visibleBenchmarks(input, { fuel: 'B027', sido: '11' }), [national, jeju]);
  assert.deepEqual(visibleBenchmarks(input, { fuel: 'B027', sido: '01', query: ' 서울 ' }), [seoul, jongno]);
  assert.deepEqual(input, [jongno, jeju, seoul, national], 'Sorting a display must not rewrite the cached collection.');
  assert.equal(seoul.asOfDate, null, 'Filtering must not borrow a national date for an undated region.');
});

test('unavailable average amounts remain unavailable instead of borrowing station prices or converting to zero', () => {
  const unavailable = average({ averagePrice: null, sourcePrice: null, dayOverDayChange: null });
  const output = visibleBenchmarks([unavailable, station()], { fuel: 'B027' });
  assert.deepEqual(output, [unavailable]);
  assert.equal(output[0].averagePrice, null);
  assert.equal(getFuelPrice(output[0], 'B027'), null);
});

test('source links retain approved HTTPS documentation but reject executable schemes, credentials and lookalike hosts', () => {
  const documentation = 'https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=4';
  assert.equal(safeSourceUrl(documentation, FALLBACK), documentation);
  assert.equal(safeSourceUrl('https://data.ex.co.kr/openapi/basicinfo/openApiInfoM?apiId=0312', FALLBACK), 'https://data.ex.co.kr/openapi/basicinfo/openApiInfoM?apiId=0312');
  for (const value of [
    undefined, null, '', '/relative', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'http://www.opinet.co.kr/',
    'https://user:secret@www.opinet.co.kr/', 'https://secret@www.opinet.co.kr/',
    'https://www.opinet.co.kr.evil.example/', 'https://www.opinet.co.kr@evil.example/',
    'https://evil.example/www.opinet.co.kr',
  ]) assert.equal(safeSourceUrl(value, FALLBACK), FALLBACK, String(value));
});

test('source links reject provider authentication keys in query strings instead of exposing them publicly', () => {
  for (const query of [
    'certkey=synthetic-secret', 'serviceKey=synthetic-secret',
    'ServiceKey=synthetic-secret', 'key=synthetic-secret',
    'apiKey=synthetic-secret', 'api_key=synthetic-secret',
    'apiId=4&%63ertkey=synthetic-secret',
  ]) assert.equal(safeSourceUrl(`https://www.opinet.co.kr/api/avgAllPrice.do?${query}`, FALLBACK), FALLBACK, query);
});

test('failed collection and missing credentials retain every original reference and fetch timestamp without mutating inputs', () => {
  for (const status of ['error', 'awaiting_credentials']) {
    const previous = freezeDeep(averageEnvelope());
    const next = freezeDeep(averageEnvelope({
      status, fetchedAt: NEW_FETCH, benchmarks: [],
      error: { code: 'SYNTHETIC_FAILURE', message: '검증용 수집 실패' },
    }));
    const result = preservePrevious(next, previous, 'averages');
    assert.equal(result.status, 'partial');
    assert.equal(result.fetchedAt, OLD_FETCH);
    assert.deepEqual(result.benchmarks, previous.benchmarks);
    assert.equal(result.benchmarks[0].asOfDate, '2026-10-18');
    assert.equal(result.benchmarks[0].sourceDate, '20261018');
    assert.equal(result.benchmarks[0].fetchedAt, OLD_FETCH);
    assert.equal(result.error.code, 'SYNTHETIC_FAILURE');
    assert.ok(result.warnings.some(warning => warning.code === 'PRESERVED_PREVIOUS_SNAPSHOT'));
    assert.equal(previous.status, 'ready');
    assert.equal(next.fetchedAt, NEW_FETCH);
    assert.equal(next.benchmarks.length, 0);
  }
});

test('a failed refresh marks retained averages stale even when the last fetch was under five minutes ago', () => {
  const fetchedAt = at(-60_000);
  const record = average({ fetchedAt });
  const previous = freezeDeep({ status: 'ready', fetchedAt, benchmarks: [record], warnings: [], cache: { hit: false, ageSeconds: 0, stale: false } });
  const result = preservePrevious({ status: 'error', fetchedAt: NEW_FETCH, benchmarks: [] }, previous, 'averages');
  assert.equal(observedRecently(record.fetchedAt, NOW), true, 'Age alone cannot identify a newly failed refresh.');
  assert.equal(result.cache.stale, true, 'A recently fetched result must still disclose the failed refresh.');
  assert.equal(result.fetchedAt, fetchedAt);
  assert.deepEqual(result.benchmarks, [record]);
  assert.equal(previous.cache.stale, false);
});

test('failed highway collection retains per-fuel report/fetch timestamps rather than renewing prices', () => {
  const oldStation = station();
  const previous = { status: 'ready', fetchedAt: OLD_FETCH, stations: [oldStation], warnings: [] };
  const result = preservePrevious({ status: 'error', fetchedAt: NEW_FETCH, stations: [] }, previous, 'highway');
  assert.equal(result.fetchedAt, OLD_FETCH);
  assert.deepEqual(result.stations, [oldStation]);
  assert.equal(getFuelPrice(result.stations[0], 'B027').priceUpdatedAt, '2026-10-18T04:00:00.000Z');
  assert.equal(getFuelPrice(result.stations[0], 'B027').fetchedAt, OLD_FETCH);
});

test('a new valid result replaces the previous geographic coverage even if its reported coverage is narrower', () => {
  const previous = averageEnvelope({ benchmarks: [average(), average({ id: 'sido:01:B027', scope: 'sido', sidoCode: '01' }), average({ id: 'sido:02:B027', scope: 'sido', sidoCode: '02' })] });
  for (const status of ['ready', 'partial']) {
    const next = freezeDeep(averageEnvelope({
      status, fetchedAt: NEW_FETCH,
      benchmarks: [average({ fetchedAt: NEW_FETCH, averagePrice: 1659.75, asOfDate: '2026-10-19' })],
      coverage: { kind: 'regional_average', scopes: ['national'], complete: false },
    }));
    const result = preservePrevious(next, previous, 'averages');
    assert.deepEqual(result, next);
    assert.equal(result.benchmarks.length, 1, 'Old regions must not silently appear in a new successful coverage response.');
    assert.equal(result.benchmarks[0].averagePrice, 1659.75);
    assert.equal(result.fetchedAt, NEW_FETCH);
  }
});

test('a successful empty collection clears older facilities rather than resurrecting them', () => {
  for (const [collection, field] of [['highway', 'stations'], ['averages', 'benchmarks']]) {
    const previous = { status: 'ready', fetchedAt: OLD_FETCH, [field]: [{ id: 'old-record' }] };
    const next = freezeDeep({ status: 'ready', fetchedAt: NEW_FETCH, [field]: [] });
    assert.deepEqual(preservePrevious(next, previous, collection), next);
  }
});

test('failure without a usable previous collection stays empty without fabricating data or dates', () => {
  const next = freezeDeep(averageEnvelope({ status: 'awaiting_credentials', fetchedAt: null, benchmarks: [] }));
  for (const previous of [undefined, null, {}, { benchmarks: null }, { benchmarks: [] }, { stations: [station()] }]) {
    assert.deepEqual(preservePrevious(next, previous, 'averages'), next);
  }
});

test('snapshot collection boundaries reject a station-only payload and average display excludes a misfiled station record', () => {
  assert.throws(() => preservePrevious({ status: 'ready', stations: [station()] }, null, 'averages'), /Invalid public snapshot collection/);
  assert.throws(() => preservePrevious({ status: 'ready', benchmarks: [] }, null, 'unknown'), /Invalid public snapshot collection/);
  const previous = { status: 'ready', fetchedAt: OLD_FETCH, benchmarks: [station()] };
  const retained = preservePrevious({ status: 'error', benchmarks: [] }, previous, 'averages');
  assert.deepEqual(visibleBenchmarks(retained.benchmarks, { fuel: 'B027' }), []);
  assert.deepEqual(visibleBenchmarks([average()], { fuel: 'B027' }).map(row => getFuelPrice(row, 'B027')), [null]);
});

test('partial averages retain only the explicitly failed dataset in the same coverage without relabelling new observations stale', () => {
  const coverage = { kind: 'regional_average', scopes: ['national', 'sido'], fuel: 'B027', sido: null, sigunRequested: false, complete: false };
  const oldRegion = average({ id: 'sido:01:B027', scope: 'sido', sidoCode: '01', areaName: '서울' });
  const previous = freezeDeep(averageEnvelope({
    coverage,
    benchmarks: [average(), oldRegion],
    datasets: [
      { scope: 'national', status: 'ready', count: 1, fetchedAt: OLD_FETCH, cache: { stale: false } },
      { scope: 'sido', status: 'ready', count: 1, fetchedAt: OLD_FETCH, cache: { stale: false } },
    ],
  }));
  const freshNational = average({ fetchedAt: NEW_FETCH, averagePrice: 1659.75, asOfDate: '2026-10-19' });
  const next = freezeDeep(averageEnvelope({
    status: 'partial', coverage, fetchedAt: NEW_FETCH, benchmarks: [freshNational],
    datasets: [
      { scope: 'national', status: 'ready', count: 1, fetchedAt: NEW_FETCH, cache: { stale: false } },
      { scope: 'sido', status: 'error', count: 0, fetchedAt: null, cache: { stale: false }, error: { code: 'SYNTHETIC_NETWORK_FAILURE' } },
    ],
  }));
  const result = preservePrevious(next, previous, 'averages');
  assert.deepEqual(result.benchmarks, [freshNational, oldRegion]);
  assert.equal(result.fetchedAt, NEW_FETCH);
  assert.equal(result.benchmarks[1].fetchedAt, OLD_FETCH);
  assert.equal(result.benchmarks[1].asOfDate, '2026-10-18');
  assert.equal(result.datasets[0].cache.stale, false);
  assert.equal(result.datasets[1].cache.stale, true);
  assert.equal(result.datasets[1].fetchedAt, OLD_FETCH);
  assert.equal(result.datasets[1].count, 1);
  assert.equal(result.datasets[1].error.code, 'SYNTHETIC_NETWORK_FAILURE');
  assert.equal(result.cache.stale, true);
  assert.ok(result.warnings.some(warning => warning.code === 'PRESERVED_PREVIOUS_DATASET' && warning.scope === 'sido'));
  assert.ok(!result.warnings.some(warning => warning.code === 'PRESERVED_PREVIOUS_SNAPSHOT'));
  assert.equal(previous.datasets[1].cache.stale, false);
  assert.equal(next.benchmarks.length, 1);
  for (const changed of [{ fuel: 'D047' }, { sido: '02' }, { sigunRequested: true }, { scopes: ['national'] }]) {
    const otherCoverage = { ...next, coverage: { ...coverage, ...changed } };
    assert.equal(preservePrevious(otherCoverage, previous, 'averages'), otherCoverage);
  }
  const successfulEmpty = { ...next, datasets: [next.datasets[0], { ...next.datasets[1], status: 'ready', error: undefined }] };
  assert.equal(preservePrevious(successfulEmpty, previous, 'averages'), successfulEmpty);
});
