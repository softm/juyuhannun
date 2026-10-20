import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OpinetClient, parsePriceTimestamp, normalizeNearby, normalizeDetail, validateSearch, extractOil } from '../server/opinet.mjs';
import { DailyQuota, RunQuota, seoulDay } from '../server/quota.mjs';
import { wgs84ToKatec, katecToWgs84 } from '../server/coordinates.mjs';
import { NaverRouteClient, normalizeNaverRoute } from '../server/route.mjs';
import { collect, mergeStationRecords } from '../scripts/collect.mjs';
import { createApp } from '../server/index.mjs';

const clock = () => Date.parse('2026-10-19T05:00:00Z');
const search = { lat: 37.5665, lng: 126.978, radius: 3000, fuel: 'B027' };
// Official Opinet detailed-response fixture. The historical price is ONLY a test
// value; this record is never exported to the public snapshot or live API.
const nearbyRow = { UNI_ID: 'A0010207', POLL_DIV_CO: 'SKE', OS_NM: 'SK서광주유소', PRICE: 1745, DISTANCE: 1234, GIS_X_COOR: 314871.8, GIS_Y_COOR: 544012 };
const detailRow = { ...nearbyRow, VAN_ADR: '서울 강남구 역삼동 834-47', NEW_ADR: '서울 강남구 역삼로 142', TEL: '02-562-4855', LPG_YN: 'N', MAINT_YN: 'Y', CAR_WASH_YN: 'Y', CVS_YN: 'N', OIL_PRICE: [{ PRODCD: 'B027', PRICE: 1745, TRADE_DT: '20250723', TRADE_TM: '145618' }, { PRODCD: 'D047', PRICE: 1629, TRADE_DT: '20250723', TRADE_TM: '144009' }] };
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'juyuhannun-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('source price dates validate calendar/time and interpret domestic reference time as KST', () => {
  assert.equal(parsePriceTimestamp('20250723', '145618'), '2025-07-23T05:56:18.000Z');
  assert.equal(parsePriceTimestamp('20240229', '001005'), '2024-02-28T15:10:05.000Z');
  assert.equal(parsePriceTimestamp('20230229', '120000'), null);
  assert.equal(parsePriceTimestamp('20260230', '120000'), null);
  assert.equal(parsePriceTimestamp('20261301', '120000'), null);
  assert.equal(parsePriceTimestamp('20261019', '240000'), null);
  assert.equal(parsePriceTimestamp('20261019', '125960'), null);
  assert.equal(parsePriceTimestamp('20261019', ''), null);
  assert.equal(parsePriceTimestamp(null, '130000'), null);
});

test('KATEC conversion agrees with independent official NAVER SDK fixture', () => {
  // Oracle: official maps-geocoder.js v1.3.1, TransCoord.fromTM128ToLatLng.
  const result = katecToWgs84({ x: 314871.8, y: 544012 });
  assert.ok(Math.abs(result.lat - 37.49434328136702) < 0.000001);
  assert.ok(Math.abs(result.lng - 127.03509256702557) < 0.000001);
  const projected = wgs84ToKatec(result);
  assert.ok(Math.hypot(projected.x - 314871.8, projected.y - 544012) < 0.1);
  assert.throws(() => katecToWgs84({ x: 127, y: 37 }));
  assert.throws(() => katecToWgs84({ x: 953901, y: 1952032 }));
  assert.throws(() => wgs84ToKatec({ lat: 127, lng: 37 }));
  const officialFixtures = [
    [{ lat: 37.5666103, lng: 126.9783882 }, { x: 309944.5880554867, y: 552085.1818521289 }],
    [{ lat: 36.3325, lng: 127.4342 }, { x: 349400.56137611286, y: 414799.0009996996 }],
    [{ lat: 33.4996, lng: 126.5312 }, { x: 263722.22812379943, y: 101365.05081527313 }],
    [{ lat: 37.241, lng: 131.869 }, { x: 743528.9343700192, y: 522487.19058297295 }],
  ];
  for (const [input, expected] of officialFixtures) {
    const point = wgs84ToKatec(input);
    assert.ok(Math.hypot(point.x - expected.x, point.y - expected.y) < 0.1);
  }
});

test('nearby source missing time never becomes a freshly reported price', () => {
  const station = normalizeNearby(nearbyRow, { fuel: 'B027', fetchedAt: '2026-10-19T05:00:00Z' });
  assert.equal(station.priceUpdatedAt, null);
  assert.equal(station.prices.B027.priceUpdatedAt, null);
  assert.equal(station.priceTimeStatus, 'unknown');
  assert.equal(station.distanceType, 'straight_line');
  assert.equal(station.facilities.self, null);
  assert.equal(station.brand, 'SKE');
  const detail = normalizeDetail(detailRow, { fuel: 'D047', fetchedAt: '2026-10-19T05:00:00Z' });
  assert.equal(detail.price, 1629);
  assert.equal(detail.priceUpdatedAt, '2025-07-23T05:40:09.000Z');
  const future = normalizeDetail({ ...detailRow, OIL_PRICE: [{ PRODCD: 'B027', PRICE: 1745, TRADE_DT: '20990101', TRADE_TM: '120000' }] }, { fuel: 'B027', fetchedAt: '2026-10-19T05:00:00Z' });
  assert.equal(future.priceUpdatedAt, null);
  assert.equal(future.prices.B027.sourceDate, '20990101');
});

test('invalid prices and positions do not produce free or misplaced fuel', () => {
  for (const value of [0, -1, '', null, 'not-a-price']) {
    assert.equal(normalizeNearby({ ...nearbyRow, PRICE: value }, { fuel: 'B027', fetchedAt: '2026-10-19T05:00:00Z' }).price, null);
  }
  assert.equal(normalizeNearby({ ...nearbyRow, GIS_X_COOR: 127, GIS_Y_COOR: 37 }, { fuel: 'B027', fetchedAt: '2026-10-19T05:00:00Z' }), null);
  assert.throws(() => extractOil({ RESULT: { ERROR: { CODE: 'E001' } } }));
  assert.throws(() => extractOil({ message: 'invalid' }));
  assert.deepEqual(extractOil({ RESULT: { OIL: [] } }), []);
  assert.throws(() => validateSearch({ ...search, radius: 5001 }), { code: 'INVALID_RADIUS' });
});

test('without credentials no upstream request or quota is consumed', async () => {
  let calls = 0;
  const client = new OpinetClient({ fetchImpl: () => { calls += 1; throw new Error('must not call'); } });
  const result = await client.nearby(search);
  assert.equal(result.status, 'awaiting_credentials');
  assert.deepEqual(result.stations, []);
  assert.equal(result.fetchedAt, null);
  assert.equal(calls, 0);
});

test('concurrent identical nearby requests merge, use certkey, and get per-fuel reference time', async () => {
  const requests = []; let reserved = 0;
  const client = new OpinetClient({ apiKey: 'test-key-never-public', clock, quota: { reserve: async () => { reserved += 1; } }, fetchImpl: async url => {
    requests.push(new URL(url));
    await Promise.resolve();
    return json({ RESULT: { OIL: new URL(url).pathname.endsWith('detailById.do') ? [detailRow] : [nearbyRow] } });
  } });
  const [a, b] = await Promise.all([client.nearby(search), client.nearby(search)]);
  assert.equal(reserved, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get('certkey'), 'test-key-never-public');
  assert.equal(requests[0].searchParams.has('code'), false);
  assert.ok(Number(requests[0].searchParams.get('x')) > 100_000);
  assert.equal(a.stations[0].priceUpdatedAt, '2025-07-23T05:56:18.000Z');
  assert.deepEqual(a.stations, b.stations);
  assert.equal(JSON.stringify(a).includes('test-key-never-public'), false);
  assert.equal((await client.nearby(search)).cache.hit, true);
  assert.equal(reserved, 2);
});

test('upstream failure preserves stale data and never renews the price or fetch timestamp', async () => {
  let now = clock(); let fail = false;
  const client = new OpinetClient({ apiKey: 'do-not-leak', clock: () => now, ttlMs: 30_000, detailLimit: 0, fetchImpl: async () => { if (fail) throw new Error('URL certkey=do-not-leak'); return json({ RESULT: { OIL: [nearbyRow] } }); } });
  const good = await client.nearby(search);
  now += 40_000; fail = true;
  const failed = await client.nearby(search);
  assert.equal(failed.status, 'partial');
  assert.equal(failed.cache.stale, true);
  assert.equal(failed.fetchedAt, good.fetchedAt);
  assert.equal(failed.stations[0].priceUpdatedAt, null);
  assert.equal(JSON.stringify(failed).includes('do-not-leak'), false);
});

test('a fresh nearby price invalidates conflicting older detail cache, including beyond enrichment limit', async () => {
  for (const detailLimit of [0, 1]) {
    let now = clock(); let detailCalls = 0; let failDetail = false;
    const client = new OpinetClient({ apiKey: 'fixture-only', clock: () => now, detailLimit, fetchImpl: async url => {
      if (new URL(url).pathname.endsWith('detailById.do')) {
        detailCalls += 1;
        if (failDetail) throw new Error('temporary provider failure');
        return json({ RESULT: { OIL: [{ ...detailRow, OIL_PRICE: [{ PRODCD: 'B027', PRICE: detailCalls === 1 ? 1745 : 1800, TRADE_DT: '20261019', TRADE_TM: detailCalls === 1 ? '140000' : '140900' }] }] } });
      }
      return json({ RESULT: { OIL: [{ ...nearbyRow, PRICE: 1800 }] } });
    } });
    const old = await client.detail(nearbyRow.UNI_ID);
    now += 9 * 60_000;
    const fresh = await client.nearby(search);
    const station = fresh.stations[0];
    assert.equal(station.price, 1800);
    assert.equal(station.priceUpdatedAt, null);
    assert.equal(station.prices.B027.priceUpdatedAt, null);
    assert.equal(station.prices.B027.fetchedAt, new Date(now).toISOString());
    assert.equal(station.prices.B027.sourceDate, undefined);
    assert.equal(station.metadataFetchedAt, old.station.fetchedAt);
    assert.equal(station.roadAddress, detailRow.NEW_ADR);
    assert.equal(station.facilities.carWash, true);
    assert.equal(fresh.status, 'partial');
    assert.equal(detailCalls, 1);

    // Opening details cannot revive the conflicting old value, even as a
    // stale fallback when the provider is temporarily unavailable.
    failDetail = true;
    await assert.rejects(client.detail(nearbyRow.UNI_ID), { code: 'OPINET_NETWORK_ERROR' });
    now += 16_000; failDetail = false;
    const reopened = await client.detail(nearbyRow.UNI_ID);
    assert.equal(reopened.cache.hit, false);
    assert.equal(reopened.station.price, 1800);
    assert.equal(reopened.station.priceUpdatedAt, '2026-10-19T05:09:00.000Z');
    assert.equal(detailCalls, 3);
  }
});

test('incomplete detail prices cannot erase nearby or collected observations, including cached failures', async () => {
  for (const missingPrice of [undefined, 0, null, '']) {
    let now = clock(); let failDetail = false; let nearbyPrice = 1800;
    const oilPrices = [detailRow.OIL_PRICE[1]];
    if (missingPrice !== undefined) oilPrices.push({ PRODCD: 'B027', PRICE: missingPrice, TRADE_DT: '20261019', TRADE_TM: '140001' });
    const incomplete = { ...detailRow, OIL_PRICE: oilPrices };
    const client = new OpinetClient({ apiKey: 'fixture-only', clock: () => now, detailLimit: 1, fetchImpl: async url => {
      if (new URL(url).pathname.endsWith('detailById.do')) {
        if (failDetail) throw new Error('temporary provider failure');
        now += 1000;
        return json({ RESULT: { OIL: [incomplete] } });
      }
      return json({ RESULT: { OIL: [{ ...nearbyRow, PRICE: nearbyPrice }] } });
    } });
    const first = await client.nearby(search);
    const station = first.stations[0];
    assert.equal(first.status, 'partial');
    assert.equal(station.price, 1800);
    assert.equal(station.priceUpdatedAt, null);
    assert.equal(station.prices.B027.priceUpdatedAt, null);
    assert.equal(station.prices.B027.fetchedAt, new Date(clock()).toISOString());
    assert.equal(station.prices.B027.sourceDate, undefined);
    assert.equal(station.roadAddress, detailRow.NEW_ADR);
    assert.equal(station.facilities.carWash, true);
    assert.equal(station.metadataFetchedAt, new Date(now).toISOString());

    // Popup's ready-only merge must not consume a missing selected price.
    const selected = await client.detail(nearbyRow.UNI_ID, 'B027');
    assert.equal(selected.cache.hit, true);
    assert.equal(selected.status, 'partial');
    assert.equal(selected.station.priceUpdatedAt, null);
    assert.equal(selected.station.prices.B027, undefined);
    // A valid other fuel must not carry null prices that erase stored fuels.
    const diesel = await client.detail(nearbyRow.UNI_ID, 'D047');
    assert.equal(diesel.status, 'ready');
    assert.equal(diesel.station.prices.D047.price, 1629);
    assert.equal(({ ...station.prices, ...diesel.station.prices }).B027.price, 1800);

    const known = normalizeDetail(detailRow, { fetchedAt: '2025-07-23T06:00:00Z' });
    const incoming = normalizeDetail(incomplete, { fuel: 'B027', fetchedAt: new Date(now).toISOString() });
    const merged = mergeStationRecords(known, incoming);
    assert.deepEqual(merged.prices.B027, known.prices.B027);
    assert.equal(merged.price, known.price);
    assert.equal(merged.priceUpdatedAt, known.priceUpdatedAt);

    // An expired detail followed by a provider failure still cannot roll the
    // newly observed price back, or mark it with a stale detail timestamp.
    now += 601_000; failDetail = true; nearbyPrice = 1810;
    const later = await client.nearby(search);
    assert.equal(later.stations[0].price, 1810);
    assert.equal(later.stations[0].priceUpdatedAt, null);
    assert.equal(later.stations[0].prices.B027.fetchedAt, new Date(now).toISOString());
    const [reopened] = await Promise.allSettled([client.detail(nearbyRow.UNI_ID, 'B027')]);
    if (reopened.status === 'fulfilled') assert.notEqual(reopened.value.status, 'ready');
    else assert.equal(reopened.reason.code, 'OPINET_NETWORK_ERROR');
  }
});

test('durable quota prevents races/restarts and resets on the Korean calendar day', async t => {
  const dir = await temporary(t); const ledgerPath = join(dir, 'quota.json');
  let now = Date.parse('2026-10-19T14:59:59Z');
  const a = new DailyQuota({ ledgerPath, limit: 2, clock: () => now });
  const b = new DailyQuota({ ledgerPath, limit: 2, clock: () => now });
  const results = await Promise.allSettled([a.reserve(), b.reserve(), a.reserve()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal((await new DailyQuota({ ledgerPath, limit: 2, clock: () => now }).snapshot()).remaining, 0);
  now += 2000;
  assert.equal(seoulDay(now), '2026-10-20');
  await a.reserve(); assert.equal((await a.snapshot()).used, 1);
  await writeFile(ledgerPath, 'corrupted');
  await assert.rejects(a.reserve(), { code: 'QUOTA_LEDGER_UNREADABLE' });
});

test('per-run quota bounds collection even when the daily budget is larger', async () => {
  let calls = 0;
  const quota = new RunQuota({ reserve: async () => { calls += 1; } }, 2);
  await quota.reserve(); await quota.reserve();
  await assert.rejects(quota.reserve(), { code: 'COLLECTION_RUN_QUOTA_EXCEEDED' });
  assert.equal(calls, 2);
});

const routeFixture = (distance = 1000, duration = 600_000, toll = 0) => ({ code: 0, route: { traoptimal: [{ summary: { distance, duration, tollFare: toll }, path: [[126.978, 37.5665], [127.035, 37.4943]] }] } });

test('NAVER routing converts milliseconds, preserves toll delta, and requires both complete routes', async () => {
  assert.equal(normalizeNaverRoute(routeFixture()).durationSeconds, 600);
  let calls = 0;
  const route = new NaverRouteClient({ apiKeyId: 'id', apiKey: 'secret', clock, fetchImpl: async url => {
    calls += 1; const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('option'), 'traoptimal');
    return json(parsed.searchParams.has('waypoints') ? routeFixture(1400, 720_000, 500) : routeFixture());
  } });
  const result = await route.route({ origin: '126.978,37.5665', destination: '127.035,37.4943', via: '127.01,37.53' });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.extra, { distanceMeters: 400, durationSeconds: 120, tollWon: 500 });
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('missing route toll, ambiguous/failed route, and absent keys never create an extra-cost estimate', async () => {
  assert.throws(() => normalizeNaverRoute({ code: 0, route: { traoptimal: [{ summary: { distance: 1000, duration: 1000 }, path: [[127, 37], [127.1, 37.1]] }] } }));
  for (const viaPayload of [{ code: 3 }, routeFixture(900, 500_000), { code: 0, route: { traoptimal: [routeFixture().route.traoptimal[0], routeFixture().route.traoptimal[0]] } }]) {
    let calls = 0;
    const client = new NaverRouteClient({ apiKeyId: 'id', apiKey: 'secret', fetchImpl: async () => json(++calls === 1 ? routeFixture() : viaPayload) });
    const result = await client.route({ origin: '126.978,37.5665', destination: '127.035,37.4943', via: '127.01,37.53' });
    assert.equal(result.status, 'error'); assert.equal(result.extra, null);
  }
  const result = await new NaverRouteClient().route({ origin: '126.978,37.5665', destination: '127.035,37.4943' });
  assert.equal(result.status, 'unavailable'); assert.equal(result.extra, null);
});

test('collector with missing credentials preserves old timestamps and no sample station is invented', async t => {
  const dir = await temporary(t); const outputPath = join(dir, 'stations.json'); const ledgerPath = join(dir, 'quota.json');
  const configPath = resolve('config/collection.json');
  const first = await collect({ outputPath, ledgerPath, configPath, apiKey: '', clock });
  assert.equal(first.status, 'awaiting_credentials'); assert.equal(first.count, 0); assert.equal(first.calls, 0);
  const historical = { status: 'ready', fetchedAt: '2025-07-23T06:00:00Z', stations: [normalizeDetail(detailRow, { fetchedAt: '2025-07-23T06:00:00Z' })] };
  await writeFile(outputPath, JSON.stringify(historical));
  await collect({ outputPath, ledgerPath, configPath, apiKey: '', clock });
  const retained = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(retained.fetchedAt, historical.fetchedAt);
  assert.equal(retained.stations[0].priceUpdatedAt, historical.stations[0].priceUpdatedAt);
  assert.equal(retained.lastAttempt.at, '2026-10-19T05:00:00.000Z');
});

test('collector retains last good snapshot after every zone fails and enforces aggregate quota', async t => {
  const dir = await temporary(t); const outputPath = join(dir, 'stations.json'); const ledgerPath = join(dir, 'quota.json');
  const historical = { status: 'ready', fetchedAt: '2025-07-23T06:00:00Z', coverage: { zones: [] }, stations: [{ ...normalizeDetail(detailRow, { fetchedAt: '2025-07-23T06:00:00Z' }), coverageZones: ['seoul-city-hall:B027'] }] };
  await writeFile(outputPath, JSON.stringify(historical));
  const result = await collect({ outputPath, ledgerPath, configPath: resolve('config/collection.json'), apiKey: 'never-publish', clock, fetchImpl: async url => {
    if (new URL(url).pathname.endsWith('areaCode.do')) return json({ RESULT: { OIL: [{ AREA_CD: '01', AREA_NM: '서울' }] } });
    throw new Error('never-publish');
  } });
  const retained = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(result.status, 'partial'); assert.equal(result.calls, 9);
  assert.deepEqual(retained.stations, historical.stations);
  assert.equal(retained.fetchedAt, historical.fetchedAt);
  assert.equal(JSON.stringify(retained).includes('never-publish'), false);
});

test('a changed undated price cannot inherit the old timestamp during snapshot merge', () => {
  const old = normalizeDetail(detailRow, { fetchedAt: '2025-07-23T06:00:00Z' });
  const incoming = normalizeNearby({ ...nearbyRow, PRICE: 1800 }, { fuel: 'B027', fetchedAt: '2026-10-19T05:00:00Z' });
  const merged = mergeStationRecords(old, incoming);
  assert.equal(merged.prices.B027.price, 1800); assert.equal(merged.prices.B027.priceUpdatedAt, null);
  assert.equal(merged.prices.D047.price, 1629);
});

test('partial collection publishes only successful/retained regions with independent source times', async t => {
  const dir = await temporary(t); const outputPath = join(dir, 'stations.json'); const ledgerPath = join(dir, 'quota.json'); const configPath = join(dir, 'collection.json');
  const config = { version: 1, description: '공공 장소 검증 범위', fuels: ['B027'], maxCallsPerRun: 10, detailLimitPerSearch: 1, zones: [{ id: 'seoul-city-hall', name: '서울시청', lat: 37.5665, lng: 126.978, radius: 3000 }, { id: 'daejeon-station', name: '대전역', lat: 36.3322, lng: 127.4346, radius: 3000 }] };
  await writeFile(configPath, JSON.stringify(config));
  const oldStation = { ...normalizeDetail({ ...detailRow, UNI_ID: 'A0099999' }, { fetchedAt: '2025-07-23T06:00:00Z' }), coverageZones: ['daejeon-station:B027'] };
  await writeFile(outputPath, JSON.stringify({ status: 'ready', fetchedAt: '2025-07-23T06:00:00Z', coverage: { zones: [{ id: 'daejeon-station', fuel: 'B027', lastSuccessAt: '2025-07-23T06:00:00Z' }] }, stations: [oldStation] }));
  const result = await collect({ outputPath, ledgerPath, configPath, apiKey: 'testing-only', clock, fetchImpl: async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('areaCode.do')) return json({ RESULT: { OIL: [{ AREA_CD: '01', AREA_NM: '서울' }] } });
    if (parsed.pathname.endsWith('detailById.do')) return json({ RESULT: { OIL: [detailRow] } });
    if (Number(parsed.searchParams.get('x')) > 330_000) throw new Error('region unavailable');
    return json({ RESULT: { OIL: [nearbyRow] } });
  } });
  const snapshot = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(result.status, 'partial'); assert.equal(result.calls, 4); assert.equal(result.count, 2);
  assert.equal(snapshot.fetchedAt, '2026-10-19T05:00:00.000Z');
  assert.equal(snapshot.coverage.zones[0].status, 'ready'); assert.equal(snapshot.coverage.zones[1].status, 'error');
  assert.equal(snapshot.coverage.zones[1].lastSuccessAt, '2025-07-23T06:00:00Z');
  assert.equal(snapshot.stations.find(station => station.id === 'A0099999').fetchedAt, '2025-07-23T06:00:00Z');
  assert.equal(snapshot.stations.find(station => station.id === 'A0010207').priceUpdatedAt, '2025-07-23T05:56:18.000Z');
});

test('HTTP request handler exposes only public assets and reports missing provider configuration safely', async t => {
  const dir = await temporary(t);
  await mkdir(join(dir, 'public')); await mkdir(join(dir, 'server'));
  await writeFile(join(dir, 'public/index.html'), '<h1>주유한눈</h1>');
  await writeFile(join(dir, 'server/secret.json'), '{"secret":"never-serve"}');
  await writeFile(join(dir, '.env'), 'OPINET_API_KEY=never-serve');
  const handler = createApp({ env: {}, projectRoot: dir, clock });
  const dispatch = async (url, requestHeaders = {}) => {
    const headers = {}; let status; let body;
    await handler({ url, method: 'GET', headers: requestHeaders, socket: { remoteAddress: '127.0.0.1' } }, {
      setHeader: (name, value) => { headers[name] = value; },
      writeHead: (code, moreHeaders) => { status = code; Object.assign(headers, moreHeaders); },
      end: value => { body = value?.toString() ?? ''; },
    });
    return { status, headers, body, json: () => JSON.parse(body) };
  };
  assert.equal((await dispatch('/')).status, 200);
  assert.equal((await dispatch('/')).headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal((await dispatch('/server/secret.json')).status, 404);
  assert.equal((await dispatch('/.env')).status, 404);
  const health = (await dispatch('/api/health')).json();
  assert.equal(health.providers.opinet.configured, false);
  assert.equal(health.providers.naver.configured, false);
  const stations = (await dispatch('/api/stations?lat=37.5665&lng=126.978&radius=3000&fuel=B027')).json();
  assert.equal(stations.status, 'awaiting_credentials');
  assert.deepEqual(stations.stations, []);
  assert.equal((await dispatch('/api/stations?lat=37&lng=127&radius=10000')).status, 400);
  assert.equal((await dispatch('/api/health', { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await dispatch('/api/health', { origin: 'http://localhost:8787' })).status, 200);
});
