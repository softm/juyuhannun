import test from 'node:test';
import assert from 'node:assert/strict';
import { OpinetClient } from '../server/opinet.mjs';
import { OpinetBenchmarkClient, normalizeBenchmark, parseBenchmarkDate, validateBenchmarkQuery } from '../server/benchmarks.mjs';

const clock = () => Date.parse('2026-10-19T05:00:00Z');
const fetchedAt = new Date(clock()).toISOString();
const json = rows => new Response(JSON.stringify({ RESULT: { OIL: rows } }), { status: 200, headers: { 'Content-Type': 'application/json' } });

// Historical values in the official API examples, exclusively for regression
// tests. These fixtures are never supplied to the app or the published snapshot.
// https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=4
const national = [
  { TRADE_DT: '20250723', PRODCD: 'B027', PRODNM: '휘발유', PRICE: '1667.33', DIFF: '-0.23' },
  { TRADE_DT: 20250723, PRODCD: 'D047', PRODNM: '자동차용경유', PRICE: 1532.22, DIFF: '+0.39' },
  { TRADE_DT: '20250723', PRODCD: 'C004', PRODNM: '실내등유', PRICE: 1295.23, DIFF: '-0.72' },
];
// Regional examples explicitly contain no TRADE_DT.
// https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=6
const provinces = [
  { SIDOCD: '01', SIDONM: '서울', PRODCD: 'B027', PRICE: '1739.63', DIFF: '-0.79' },
  { SIDOCD: '01', SIDONM: '서울', PRODCD: 'D047', PRICE: '1620.41', DIFF: '0.59' },
  { SIDOCD: '02', SIDONM: '경기', PRODCD: 'B027', PRICE: '1650.50', DIFF: '-0.01' },
];
// The first district row is the official apiId=7 fixture. The second province
// and extra rows below are synthetic validation cases, not historical claims.
const districts = [
  { SIGUNCD: '0101', SIGUNNM: '서울 종로구', PRODCD: 'B027', PRICE: '1906.00', DIFF: '0.00' },
  { SIGUNCD: '0101', SIGUNNM: '서울 종로구', PRODCD: 'D047', PRICE: '1780.75', DIFF: 0 },
];

function fixtureClient(options = {}) {
  const requests = [];
  let reserved = 0;
  const client = new OpinetClient({
    apiKey: 'test-benchmark-key', clock,
    quota: { reserve: async count => { reserved += count; } },
    fetchImpl: async url => {
      const parsed = new URL(url);
      requests.push(parsed);
      const endpoint = parsed.pathname.split('/').at(-1);
      return json(endpoint === 'avgAllPrice.do' ? national : endpoint === 'avgSidoPrice.do' ? provinces : districts);
    },
    ...options,
  });
  return { client, requests, reserved: () => reserved, benchmarks: new OpinetBenchmarkClient({ client }) };
}

test('national reference dates accept string/number dates without constructing a timestamp', () => {
  assert.equal(parseBenchmarkDate('20250723'), '2025-07-23');
  assert.equal(parseBenchmarkDate(20250723), '2025-07-23');
  assert.equal(parseBenchmarkDate(20240229), '2024-02-29');
  for (const value of ['20230229', '20260230', '20261301', 20261000, '2026-10-19', '', null, undefined, NaN, '20261019T120000']) {
    assert.equal(parseBenchmarkDate(value), null);
  }
});

test('aggregate records preserve date, source, fuel, mean and signed daily change without station price fields', () => {
  const item = normalizeBenchmark(national[1], { scope: 'national', fetchedAt });
  assert.equal(item.dataGranularity, 'aggregate');
  assert.equal(item.averagePrice, 1532.22);
  assert.equal(item.dayOverDayChange, 0.39);
  assert.equal(item.sourceChange, '+0.39');
  assert.equal(item.asOfDate, '2025-07-23');
  assert.equal(item.sourceDate, '20250723');
  assert.equal(item.dateStatus, 'reported');
  assert.equal(item.unit, 'KRW/L');
  assert.equal(item.fetchedAt, fetchedAt);
  assert.equal(item.source.apiUrl, 'https://www.opinet.co.kr/api/avgAllPrice.do');
  assert.equal(item.source.metadataUrl, 'https://www.data.go.kr/data/15150932/openapi.do');
  assert.equal(item.areaCode, null);
  assert.equal(item.areaName, '전국');
  for (const key of ['price', 'currentPrice', 'priceUpdatedAt', 'station', 'stations', 'actualSavings']) assert.equal(Object.hasOwn(item, key), false);
});

test('regional averages without source dates remain undated and preserve Opinet leading-zero codes', () => {
  const item = normalizeBenchmark(provinces[0], { scope: 'sido', fetchedAt });
  assert.equal(item.areaCode, '01');
  assert.equal(item.sidoCode, '01');
  assert.equal(item.areaName, '서울');
  assert.equal(item.asOfDate, null);
  assert.equal(item.sourceDate, null);
  assert.equal(item.dateStatus, 'unknown');
  assert.equal(item.dateIssue, 'not_provided');
  assert.equal(item.fetchedAt, fetchedAt);
  const district = normalizeBenchmark(districts[0], { scope: 'sigun', sido: '01', fetchedAt });
  assert.equal(district.sigunCode, '0101');
  assert.equal(district.sidoCode, '01');
  assert.equal(district.dayOverDayChange, 0);
  assert.equal(district.asOfDate, null);
});

test('future/invalid source dates stay raw but unknown, with future validation on the Korean calendar', () => {
  const future = normalizeBenchmark({ ...national[0], TRADE_DT: 20261020 }, { scope: 'national', fetchedAt: '2026-10-19T14:59:59Z' });
  assert.equal(future.asOfDate, null);
  assert.equal(future.dateIssue, 'future');
  assert.equal(future.sourceDate, '20261020');
  assert.equal(future.averagePrice, 1667.33);
  const tomorrowInKorea = normalizeBenchmark({ ...national[0], TRADE_DT: 20261020 }, { scope: 'national', fetchedAt: '2026-10-19T15:00:01Z' });
  assert.equal(tomorrowInKorea.asOfDate, '2026-10-20');
  const invalid = normalizeBenchmark({ ...national[0], TRADE_DT: '20260230' }, { scope: 'national', fetchedAt });
  assert.equal(invalid.asOfDate, null);
  assert.equal(invalid.sourceDate, '20260230');
  assert.equal(invalid.dateIssue, 'invalid');
});

test('invalid average or change never becomes zero, free fuel, or a region inferred from an unrelated code', () => {
  for (const value of [null, '', 'wrong', '1,2,3', 0, -1, Infinity, 100_001]) {
    assert.equal(normalizeBenchmark({ ...national[0], PRICE: value }, { scope: 'national', fetchedAt }).averagePrice, null);
  }
  assert.equal(normalizeBenchmark({ ...national[0], PRICE: '1,667.33', DIFF: 'wrong' }, { scope: 'national', fetchedAt }).averagePrice, 1667.33);
  assert.equal(normalizeBenchmark({ ...national[0], DIFF: '' }, { scope: 'national', fetchedAt }).dayOverDayChange, null);
  assert.equal(normalizeBenchmark({ ...national[0], PRODCD: 'UNKNOWN' }, { scope: 'national', fetchedAt }), null);
  assert.equal(normalizeBenchmark({ ...provinces[0], SIDOCD: '11110' }, { scope: 'sido', fetchedAt }), null);
  assert.equal(normalizeBenchmark({ ...districts[0], SIGUNCD: '0201' }, { scope: 'sigun', sido: '01', fetchedAt }), null);
  assert.equal(normalizeBenchmark({ ...districts[0], SIDOCD: '02' }, { scope: 'sigun', sido: '01', fetchedAt }), null);
});

test('without an API key the aggregate adapter performs no upstream request or quota reservation', async () => {
  const { benchmarks, requests, reserved } = fixtureClient({ apiKey: '' });
  const result = await benchmarks.snapshot();
  assert.equal(result.status, 'awaiting_credentials');
  assert.equal(result.dataGranularity, 'aggregate');
  assert.equal(result.fetchedAt, null);
  assert.deepEqual(result.benchmarks, []);
  assert.equal(result.datasets.length, 2);
  assert.equal(requests.length, 0);
  assert.equal(reserved(), 0);
});

test('initial national/province requests cost two shared calls and fuel/province changes filter the same cache', async () => {
  const { benchmarks, requests, reserved } = fixtureClient();
  const all = await benchmarks.snapshot();
  assert.equal(all.status, 'ready');
  assert.equal(all.benchmarks.length, 6);
  assert.equal(requests.length, 2);
  assert.equal(reserved(), 2);
  assert.deepEqual(requests.map(url => url.pathname).sort(), ['/api/avgAllPrice.do', '/api/avgSidoPrice.do']);
  for (const url of requests) {
    assert.deepEqual([...url.searchParams.keys()].sort(), ['certkey', 'out']);
    assert.equal(url.searchParams.get('out'), 'json');
    assert.equal(url.searchParams.get('certkey'), 'test-benchmark-key');
  }
  const filtered = await benchmarks.snapshot({ fuel: 'B027', sido: '01' });
  assert.equal(filtered.benchmarks.length, 2);
  assert.ok(filtered.benchmarks.every(item => item.fuel === 'B027'));
  assert.equal(filtered.benchmarks.find(item => item.scope === 'sido').asOfDate, null);
  assert.equal(filtered.benchmarks.find(item => item.scope === 'national').asOfDate, '2025-07-23');
  assert.equal(filtered.cache.hit, true);
  assert.equal(reserved(), 2);
  assert.equal(requests.length, 2);
  assert.equal(JSON.stringify(all).includes('test-benchmark-key'), false);
  assert.equal(Object.hasOwn(all, 'stations'), false);
});

test('multiple wrappers share their OpinetClient single-flight and quota instead of multiplying calls', async () => {
  const { client, benchmarks, requests, reserved } = fixtureClient();
  const other = new OpinetBenchmarkClient({ client });
  const [first, second] = await Promise.all([benchmarks.snapshot(), other.snapshot({ fuel: 'D047' })]);
  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  assert.equal(requests.length, 2);
  assert.equal(reserved(), 2);
  await client.request('avgAllPrice.do', {});
  assert.equal(reserved(), 3);
});

test('district requests are opt-in, require the selected Opinet province, and add just one call', async () => {
  const { benchmarks, requests, reserved } = fixtureClient();
  await assert.rejects(benchmarks.snapshot({ includeSigun: true }), { code: 'INVALID_BENCHMARK_SIDO' });
  assert.equal(requests.length, 0);
  await benchmarks.snapshot({ sido: '01' });
  assert.equal(requests.length, 2);
  const result = await benchmarks.snapshot({ fuel: 'B027', sido: '01', includeSigun: true });
  assert.equal(result.status, 'ready');
  assert.equal(result.benchmarks.length, 3);
  const districtRequest = requests.find(url => url.pathname.endsWith('avgSigunPrice.do'));
  assert.deepEqual([...districtRequest.searchParams.keys()].sort(), ['certkey', 'out', 'sido']);
  assert.equal(districtRequest.searchParams.get('sido'), '01');
  assert.equal(reserved(), 3);
  await benchmarks.snapshot({ fuel: 'D047', sido: '01', includeSigun: true });
  assert.equal(reserved(), 3);
});

test('invalid query options fail before using credentials or quota', async () => {
  for (const input of [{ fuel: 'B999' }, { sido: 1 }, { sido: '1' }, { sido: '00' }, { sido: '11110' }, { includeSigun: 'true' }]) {
    assert.throws(() => validateBenchmarkQuery(input));
  }
  assert.deepEqual(validateBenchmarkQuery({ fuel: 'C004', sido: '01', includeSigun: true }), { fuel: 'C004', sido: '01', includeSigun: true });
  assert.throws(() => new OpinetBenchmarkClient({}), TypeError);
});

test('one failed source keeps independently successful national averages with a partial status', async () => {
  const { benchmarks } = fixtureClient({ fetchImpl: async url => {
    if (new URL(url).pathname.endsWith('avgSidoPrice.do')) throw new Error('https://opinet.example/?certkey=test-benchmark-key');
    return json(national);
  } });
  const result = await benchmarks.snapshot();
  assert.equal(result.status, 'partial');
  assert.equal(result.benchmarks.length, national.length);
  assert.equal(result.datasets.find(item => item.scope === 'sido').status, 'error');
  assert.equal(result.datasets.find(item => item.scope === 'national').status, 'ready');
  assert.equal(JSON.stringify(result).includes('test-benchmark-key'), false);
});

test('failed refresh returns shared stale cache without renewing source date or fetchedAt', async () => {
  let now = clock();
  let fail = false;
  let calls = 0;
  const { benchmarks } = fixtureClient({ clock: () => now, ttlMs: 30_000, fetchImpl: async url => {
    calls += 1;
    if (fail) throw new Error('certkey=test-benchmark-key');
    return json(new URL(url).pathname.endsWith('avgAllPrice.do') ? national : provinces);
  } });
  const previous = await benchmarks.snapshot();
  now += 40_000;
  fail = true;
  const result = await benchmarks.snapshot();
  assert.equal(result.status, 'partial');
  assert.equal(result.cache.stale, true);
  assert.equal(result.fetchedAt, previous.fetchedAt);
  assert.deepEqual(result.benchmarks, previous.benchmarks);
  assert.equal(JSON.stringify(result).includes('test-benchmark-key'), false);
  const callCount = calls;
  await benchmarks.snapshot();
  assert.equal(calls, callCount, 'shared failure cache must suppress immediate failed retries');
});

test('entirely malformed averages return an error, and conflicting duplicate prices are never selected', async () => {
  const broken = fixtureClient({ fetchImpl: async () => json([{ PRICE: '1500' }]) });
  const failed = await broken.benchmarks.snapshot();
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.benchmarks, []);
  assert.equal(failed.fetchedAt, null);
  const conflict = fixtureClient({ fetchImpl: async url => json(new URL(url).pathname.endsWith('avgAllPrice.do')
    ? [national[0], { ...national[0], PRICE: 999 }, national[1]] : provinces) });
  const result = await conflict.benchmarks.snapshot();
  assert.equal(result.status, 'partial');
  assert.equal(result.benchmarks.some(item => item.scope === 'national' && item.fuel === 'B027'), false);
  assert.equal(result.benchmarks.find(item => item.scope === 'national').averagePrice, 1532.22);
  assert.ok(result.warnings.some(item => item.code === 'BENCHMARK_ROWS_OMITTED'));
});

test('empty unfiltered averages are unavailable, preserve old observations, and differ from an empty local filter', async () => {
  for (const rows of [[], null, '']) {
    const { benchmarks } = fixtureClient({ fetchImpl: async () => json(rows) });
    const result = await benchmarks.snapshot();
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'OPINET_BENCHMARK_EMPTY_RESPONSE');
    assert.equal(result.fetchedAt, null);
    assert.deepEqual(result.benchmarks, []);
    assert.ok(result.datasets.every(item => item.status === 'error'));
  }

  let now = clock();
  let empty = false;
  const { benchmarks } = fixtureClient({ clock: () => now, ttlMs: 30_000, fetchImpl: async url => {
    if (empty) return json([]);
    return json(new URL(url).pathname.endsWith('avgAllPrice.do') ? national : provinces);
  } });
  const previous = await benchmarks.snapshot();
  const filtered = await benchmarks.snapshot({ fuel: 'K015' });
  assert.equal(filtered.status, 'ready');
  assert.deepEqual(filtered.benchmarks, []);
  assert.ok(filtered.datasets.every(item => item.loadedCount > 0));
  now += 40_000;
  empty = true;
  const stale = await benchmarks.snapshot();
  assert.equal(stale.status, 'partial');
  assert.equal(stale.cache.stale, true);
  assert.equal(stale.fetchedAt, previous.fetchedAt);
  assert.deepEqual(stale.benchmarks, previous.benchmarks);
  assert.ok(stale.datasets.every(item => item.error.code === 'OPINET_BENCHMARK_EMPTY_RESPONSE'));
});

test('future nationwide dates are reported as partial, never as recently collected current prices', async () => {
  const { benchmarks } = fixtureClient({ fetchImpl: async url => json(new URL(url).pathname.endsWith('avgAllPrice.do')
    ? [{ ...national[0], TRADE_DT: 20990101 }] : provinces) });
  const result = await benchmarks.snapshot();
  assert.equal(result.status, 'partial');
  const item = result.benchmarks.find(row => row.scope === 'national');
  assert.equal(item.asOfDate, null);
  assert.equal(item.sourceDate, '20990101');
  assert.equal(item.dateIssue, 'future');
  assert.ok(result.warnings.some(warning => warning.code === 'BENCHMARK_SOURCE_DATE_INVALID'));
});
