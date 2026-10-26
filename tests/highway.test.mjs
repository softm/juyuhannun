import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichHighwayStations,
  HighwayClient,
  HIGHWAY_SOURCE,
  normalizeHighwayStation,
} from '../server/highway.mjs';

const NOW = Date.parse('2026-10-26T01:00:00.000Z');
const clock = () => NOW;
const fetchedAt = new Date(NOW).toISOString();

const exRow = (overrides = {}) => ({
  direction: '부산',
  svarAddr: '서울시 서초구 원지동 10-16',
  routeName: '경부선',
  oilCompany: 'AD',
  telNo: '02-573-7430',
  gasolinePrice: '1,864원',
  lpgPrice: '1,232원',
  serviceAreaCode: 'B00001',
  serviceAreaName: '서울만남(부산)주유소',
  routeCode: '0010',
  lpgYn: 'Y',
  diselPrice: '1,853원',
  serviceAreaCode2: '000002',
  ...overrides,
});

const page = (list, pageNo, { count = list.length, numOfRows = Math.max(1, list.length), pageSize = count ? Math.ceil(count / numOfRows) : 0, code = 'SUCCESS' } = {}) => ({
  list, count, pageNo, numOfRows, pageSize, message: code === 'SUCCESS' ? '인증키가 유효합니다.' : '오류', code,
});

test('highway without credentials returns an explicit empty state and makes no requests', async () => {
  let calls = 0; let reservations = 0;
  const client = new HighwayClient({
    quota: { reserve: async () => { reservations += 1; } },
    fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
  });
  const result = await client.snapshot();
  assert.equal(client.configured, false);
  assert.equal(client.implementationReady, true);
  assert.equal(result.status, 'awaiting_credentials');
  assert.equal(result.implementationReady, true);
  assert.deepEqual(result.stations, []);
  assert.equal(result.fetchedAt, null);
  assert.equal(result.coverage.complete, false);
  assert.equal(calls, 0);
  assert.equal(reservations, 0);
});

test('verified pages normalize all fuel fields, keep unavailable X values out, and enrich only a unique official match', async () => {
  const rows = [
    exRow(),
    exRow({ serviceAreaCode: 'B00002', serviceAreaCode2: '000006', serviceAreaName: '기흥(부산)주유소', telNo: '031-286-5185', oilCompany: 'HD', gasolinePrice: 'X', diselPrice: '1,831원', lpgPrice: 'X', lpgYn: 'N' }),
    exRow({ serviceAreaCode: 'B00003', serviceAreaCode2: '000007', serviceAreaName: '검증(서울)주유소', telNo: '031-000-0000', oilCompany: 'ZZ', gasolinePrice: '1,700원', diselPrice: 'X', lpgPrice: 'X', lpgYn: 'N' }),
  ];
  const requests = []; let reservations = 0;
  const client = new HighwayClient({
    apiKey: 'synthetic-secret-key', clock,
    quota: { reserve: async () => { reservations += 1; } },
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      const pageNo = Number(new URL(url).searchParams.get('pageNo'));
      return new Response(JSON.stringify(page([rows[pageNo - 1]], pageNo, { count: 3, numOfRows: 1, pageSize: 3 })), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  const catalog = [{
    id: 'A0011826', name: '㈜에이치앤디이 만남의광장주유소', phone: '02-573-7430',
    address: '서울 서초구 양재대로12길 73-71', roadAddress: '서울특별시 서초구 양재대로12길 73-71 (원지동)',
    lat: 37.45964464, lng: 127.0426249,
  }];
  const result = await client.snapshot({ stationCatalog: catalog });

  assert.equal(result.status, 'ready');
  assert.equal(result.implementationReady, true);
  assert.equal(result.fetchedAt, fetchedAt);
  assert.equal(result.stations.length, 3);
  assert.equal(result.coverage.sourceStationCount, 3);
  assert.equal(result.coverage.pageCount, 3);
  assert.equal(result.coverage.mappedStationCount, 1);
  assert.deepEqual(result.coverage.availablePriceCounts, { B027: 2, D047: 2, K015: 1 });
  assert.equal(reservations, 3);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(request => request.url.searchParams.get('pageNo')), ['1', '2', '3']);
  for (const request of requests) {
    assert.equal(request.url.protocol, 'https:');
    assert.equal(request.url.origin + request.url.pathname, HIGHWAY_SOURCE.endpoint);
    assert.equal(request.url.searchParams.get('key'), 'synthetic-secret-key');
    assert.equal(request.url.searchParams.get('type'), 'json');
    assert.equal(request.url.searchParams.get('numOfRows'), '99');
    assert.equal(request.options.redirect, 'error');
    assert.match(request.options.headers['User-Agent'], /JuyuhannunDataCollector/);
    assert.equal(request.options.headers.Referer, HIGHWAY_SOURCE.url);
  }

  const first = result.stations.find(row => row.serviceAreaCode === 'B00001');
  assert.equal(first.id, 'EX-B00001');
  assert.equal(first.dataGranularity, 'station');
  assert.equal(first.unit, 'KRW/L');
  assert.equal(first.oilCompanyCode, 'AD');
  assert.equal(first.oilCompanyName, '고속도로 알뜰주유소');
  assert.equal(first.brand, 'RTX');
  assert.equal(first.prices.B027.price, 1864);
  assert.equal(first.prices.D047.price, 1853);
  assert.equal(first.prices.K015.price, 1232);
  assert.equal(first.prices.B027.priceUpdatedAt, null);
  assert.equal(first.prices.B027.priceTimeStatus, 'source_time_unavailable');
  assert.equal(first.prices.B027.fetchedAt, fetchedAt);
  assert.equal(first.lat, catalog[0].lat);
  assert.equal(first.lng, catalog[0].lng);
  assert.equal(first.opinetStationId, catalog[0].id);
  assert.equal(first.coordinateMatchedBy, 'phone');
  assert.equal(first.roadAddress, catalog[0].roadAddress);

  const second = result.stations.find(row => row.serviceAreaCode === 'B00002');
  assert.equal(second.prices.B027, undefined);
  assert.equal(second.prices.D047.price, 1831);
  assert.equal(second.prices.K015, undefined);
  assert.equal(second.lpgAvailable, false);
  assert.deepEqual(second.fuelAvailability, { B027: false, D047: true, K015: false });
  assert.equal(second.oilCompanyName, 'HD현대오일뱅크');
  assert.equal(JSON.stringify(result).includes('synthetic-secret-key'), false);

  const cached = await client.snapshot({ stationCatalog: [] });
  assert.equal(cached.cache.hit, true);
  assert.equal(cached.coverage.mappedStationCount, 0, 'Coordinate enrichment must use each caller\'s current catalogue.');
  assert.equal(requests.length, 3);
  assert.equal(reservations, 3);
});

test('coordinate enrichment resolves duplicate phones only by the direction-bearing name and rejects ambiguous similarity', () => {
  const station = normalizeHighwayStation(exRow({
    serviceAreaCode: 'B00100', serviceAreaName: '섬진강(부산)주유소', telNo: '061-772-2106',
  }), fetchedAt);
  const catalog = [
    { id: 'A1', name: 'YM21유통㈜섬진강(순천방향)주유소', phone: '061-772-2106', lat: 34.9856, lng: 127.7692 },
    { id: 'A2', name: 'YM21유통㈜섬진강(부산방향)주유소', phone: '061-772-2106', lat: 34.9845, lng: 127.7701 },
  ];
  const [matched] = enrichHighwayStations([station], catalog);
  assert.equal(matched.opinetStationId, 'A2');
  assert.equal(matched.coordinateMatchedBy, 'phone+name');

  const ambiguous = enrichHighwayStations([{ ...station, name: '섬진강주유소' }], catalog)[0];
  assert.equal(ambiguous.opinetStationId, undefined);
  assert.equal(ambiguous.lat, null);
  assert.equal(ambiguous.lng, null);
});

test('an exact unique address may add coordinates, while conflicting unique evidence adds none', () => {
  const base = normalizeHighwayStation(exRow({ serviceAreaCode: 'B00101', telNo: '031-999-9999', serviceAreaName: '주소검증(서울)주유소', svarAddr: '경기 검증시 고속도로 10' }), fetchedAt);
  const address = { id: 'A1', name: '다른 이름', phone: '031-000-0001', address: '경기 검증시 고속도로 10', lat: 37.1, lng: 127.1 };
  assert.equal(enrichHighwayStations([base], [address])[0].coordinateMatchedBy, 'address');

  const sameName = { id: 'A2', name: '주소검증(서울)주유소', phone: '031-000-0002', address: '경기 다른시 고속도로 11', lat: 37.2, lng: 127.2 };
  const conflict = enrichHighwayStations([base], [address, sameName])[0];
  assert.equal(conflict.opinetStationId, undefined);
  assert.equal(conflict.lat, null);
});

test('route names and directions absent from the provider remain null instead of being inferred', () => {
  const station = normalizeHighwayStation(exRow({ routeName: null, direction: null }), fetchedAt);
  assert.equal(station.routeName, null);
  assert.equal(station.direction, null);
});

test('provider, page, price, and LPG inconsistencies fail closed without leaking credentials', async () => {
  const cases = [
    { name: 'provider error', payload: { code: 'ERROR', message: 'invalid', list: [], count: 0, pageNo: 1, numOfRows: 99, pageSize: 0 }, code: 'EX_PROVIDER_ERROR' },
    { name: 'page mismatch', payload: page([exRow()], 2), code: 'EX_SCHEMA_ERROR' },
    { name: 'invalid price', payload: page([exRow({ gasolinePrice: '무료' })], 1), code: 'EX_SCHEMA_ERROR' },
    { name: 'LPG contradiction', payload: page([exRow({ lpgYn: 'N', lpgPrice: '1,100원' })], 1), code: 'EX_SCHEMA_ERROR' },
  ];
  for (const item of cases) {
    const client = new HighwayClient({
      apiKey: 'never-publish-this-key', clock,
      quota: { reserve: async () => {} },
      fetchImpl: async () => new Response(JSON.stringify(item.payload), { headers: { 'Content-Type': 'application/json' } }),
    });
    await assert.rejects(client.snapshot(), error => {
      assert.equal(error.code, item.code, item.name);
      assert.equal(JSON.stringify({ code: error.code, message: error.message }).includes('never-publish-this-key'), false);
      return true;
    });
  }
});

test('network failures are sanitized even when the thrown exception contains the complete request URL', async () => {
  const client = new HighwayClient({
    apiKey: 'secret-in-provider-url',
    quota: { reserve: async () => {} },
    fetchImpl: async url => { throw new Error(String(url)); },
  });
  await assert.rejects(client.snapshot(), error => {
    assert.equal(error.code, 'EX_NETWORK_ERROR');
    assert.equal(error.message.includes('secret-in-provider-url'), false);
    return true;
  });
});

test('concurrent callers share one provider request but keep their own coordinate catalogues', async () => {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = new HighwayClient({
    apiKey: 'synthetic-key', clock,
    quota: { reserve: async () => {} },
    fetchImpl: async () => {
      calls += 1;
      await gate;
      return new Response(JSON.stringify(page([exRow()], 1)), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  const located = [{ id: 'A1', name: '다른 이름', phone: '02-573-7430', lat: 37.45, lng: 127.04 }];
  const firstTask = client.snapshot({ stationCatalog: located });
  const secondTask = client.snapshot({ stationCatalog: [] });
  release();
  const [first, second] = await Promise.all([firstTask, secondTask]);
  assert.equal(calls, 1);
  assert.equal(first.coverage.mappedStationCount, 1);
  assert.equal(second.coverage.mappedStationCount, 0);
});

test('source references and response state are isolated between requests', async () => {
  const client = new HighwayClient();
  const first = await client.snapshot();
  first.source.url = 'https://untrusted.example';
  first.stations.push({ id: 'unverified', prices: { B027: { price: 1 } } });
  first.coverage.complete = true;
  const next = await client.snapshot();
  assert.equal(next.source.url, HIGHWAY_SOURCE.url);
  assert.deepEqual(next.stations, []);
  assert.equal(next.coverage.complete, false);
});
