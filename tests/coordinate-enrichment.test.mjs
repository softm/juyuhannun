import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrichCoordinates } from '../scripts/enrich-coordinates.mjs';
import { DailyQuota, seoulDay } from '../server/quota.mjs';

const NOW = Date.parse('2026-10-22T03:00:00Z');
const DAY = 86_400_000;
const row = id => ({ id, name: '테스트주유소', lat: null, lng: null,
  prices: { B027: { price: 1745, sourceDate: '2026-10-20', priceUpdatedAt: null, fetchedAt: '2026-10-21T00:00:00Z' } } });
const detail = id => ({ UNI_ID: id, OS_NM: '공식 테스트 주유소', GIS_X_COOR: 314871.8, GIS_Y_COOR: 544012,
  OIL_PRICE: [{ PRODCD: 'B027', PRICE: 1765, TRADE_DT: '20261021', TRADE_TM: '145618' }] });
const response = rows => new Response(JSON.stringify({ RESULT: { OIL: rows } }), { headers: { 'Content-Type': 'application/json' } });

async function setup(t, rows, master = rows) {
  const directory = await mkdtemp(join(tmpdir(), 'juyu-coordinate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'search.json'), JSON.stringify({ stations: rows }));
  await writeFile(join(directory, 'master.json'), JSON.stringify({ stations: master }));
  return {
    directory,
    outputPath: join(directory, 'coordinate-enrichment.json'),
    read: async () => JSON.parse(await readFile(join(directory, 'coordinate-enrichment.json'), 'utf8')),
    options: {
      outputDirectory: directory, ledgerPath: join(directory, 'quota.json'), configPath: join(directory, 'config.json'),
      apiKey: 'test-secret-must-not-appear', clock: () => NOW,
    },
  };
}

test('only missing official IDs are enriched; budgets are checkpointed before requests and prices remain untouched', async t => {
  const originals = [row('A0000001'), row('A0000002'), { ...row('A0000003'), lat: 37.5, lng: 127 }, row('bad id')];
  const f = await setup(t, originals, [row('A0000001'), { ...row('A0000002'), lat: 36.5, lng: 127 }]);
  const searchBefore = await readFile(join(f.directory, 'search.json'), 'utf8');
  let requests = 0;
  const result = await enrichCoordinates({ ...f.options, fetchImpl: async url => {
    requests++;
    const u = new URL(url);
    assert.equal(u.pathname, '/api/detailById.do');
    assert.equal(u.searchParams.get('id'), 'A0000001');
    assert.equal(u.searchParams.get('certkey'), f.options.apiKey);
    const checkpoint = await f.read();
    assert.equal(checkpoint.dayBudget.used, 1);
    assert.equal(checkpoint.quota.used, 1);
    return response([detail('A0000001')]);
  } });
  assert.equal(result.status, 'ready');
  assert.equal(requests, 1);
  assert.equal(result.added, 1);
  const stored = await f.read();
  assert.equal(stored.stations.length, 1);
  assert.ok(Math.abs(stored.stations[0].lat - 37.49434328136702) < 0.000001);
  assert.equal(stored.stations[0].id, 'A0000001');
  assert.equal(stored.stations[0].verifiedAt, new Date(NOW).toISOString());
  for (const key of ['prices', 'priceUpdatedAt', 'sourceDate', 'fetchedAt']) assert.equal(Object.hasOwn(stored.stations[0], key), false);
  assert.equal(JSON.stringify(stored).includes(f.options.apiKey), false);
  assert.equal(await readFile(join(f.directory, 'search.json'), 'utf8'), searchBefore);
  const repeated = await enrichCoordinates({ ...f.options, fetchImpl: async () => assert.fail('successful ID must not be queried again') });
  assert.equal(repeated.calls, 0);
  assert.equal((await f.read()).stations[0].verifiedAt, new Date(NOW).toISOString());
});

test('20 calls per run and 80 per Korean day persist across restarts; the cursor resumes after a daily reset', async t => {
  const ids = Array.from({ length: 100 }, (_, i) => `A${String(i + 1).padStart(7, '0')}`);
  const f = await setup(t, ids.map(row));
  const observed = [];
  let now = NOW;
  const options = { ...f.options, clock: () => now, fetchImpl: async url => {
    const id = new URL(url).searchParams.get('id'); observed.push(id); return response([detail(id)]);
  } };
  for (let n = 0; n < 4; n++) {
    const result = await enrichCoordinates(options);
    assert.equal(result.calls, 20);
    assert.equal(result.totalEnriched, (n + 1) * 20);
  }
  const stopped = await enrichCoordinates(options);
  assert.equal(stopped.status, 'paused_quota');
  assert.equal(stopped.stopReason, 'daily_budget');
  assert.equal(stopped.calls, 0);
  assert.equal(new Set(observed).size, 80);
  assert.equal((await f.read()).dayBudget.used, 80);
  now += DAY;
  const resumed = await enrichCoordinates(options);
  assert.equal(resumed.status, 'ready');
  assert.equal(resumed.calls, 20);
  assert.equal(resumed.totalEnriched, 100);
  assert.equal(new Set(observed).size, 100);
  assert.equal((await f.read()).dayBudget.day, seoulDay(now));
  assert.equal((await f.read()).quota.used, 20);
});

test('the shared ledger preserves 40 calls for regular prices, including a concurrent reservation', async t => {
  const f = await setup(t, [row('A0000001'), row('A0000002'), row('A0000003')]);
  await writeFile(f.options.ledgerPath, JSON.stringify({ version: 1, day: seoulDay(NOW), used: 273 }));
  let requests = 0;
  const paused = await enrichCoordinates({ ...f.options, fetchImpl: async () => { requests++; assert.fail('27 remaining calls are reserved'); } });
  assert.equal(paused.status, 'paused_quota');
  assert.equal(paused.calls, 0);
  assert.equal(paused.remainingCalls, 27);
  assert.equal(requests, 0);
  await writeFile(f.options.ledgerPath, JSON.stringify({ version: 1, day: seoulDay(NOW), used: 258 }));
  const other = new DailyQuota({ ledgerPath: f.options.ledgerPath, clock: () => NOW });
  const limited = await enrichCoordinates({ ...f.options, fetchImpl: async url => {
    requests++;
    await other.reserve(); // Simulates another regular-price request after ours.
    return response([detail(new URL(url).searchParams.get('id'))]);
  } });
  assert.equal(limited.calls, 1);
  assert.equal(limited.status, 'paused_quota');
  assert.equal(limited.remainingCalls, 40);
  assert.equal((await f.read()).dayBudget.used, 1);
});

test('a mismatched ID or invalid coordinate cannot locate a station; failed IDs use backoff and cursor rotation', async t => {
  const f = await setup(t, [row('A0000001'), row('A0000002'), row('A0000003')]);
  let now = NOW;
  const requested = [];
  const first = await enrichCoordinates({ ...f.options, clock: () => now, fetchImpl: async url => {
    const id = new URL(url).searchParams.get('id'); requested.push(id);
    if (id === 'A0000001') return response([detail('A9999999')]);
    if (id === 'A0000002') return response([{ ...detail(id), GIS_X_COOR: 127, GIS_Y_COOR: 37 }]);
    return response([detail(id)]);
  } });
  assert.equal(first.added, 1);
  assert.equal(first.failed, 2);
  assert.equal(first.pendingCount, 2);
  let state = await f.read();
  assert.deepEqual(state.stations.map(s => s.id), ['A0000003']);
  assert.equal(state.failures[0].nextRetryAt, new Date(NOW + DAY).toISOString());
  const immediate = await enrichCoordinates({ ...f.options, fetchImpl: async () => assert.fail('backoff must suppress repeated requests') });
  assert.equal(immediate.calls, 0);
  assert.equal(immediate.stopReason, 'retry_backoff');
  now += DAY;
  const resumed = await enrichCoordinates({ ...f.options, clock: () => now, fetchImpl: async url => {
    const id = new URL(url).searchParams.get('id');
    return id === 'A0000001' ? response([]) : response([detail(id)]);
  } });
  assert.equal(resumed.calls, 2);
  state = await f.read();
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].attempts, 2);
  assert.equal(state.failures[0].nextRetryAt, new Date(now + 2 * DAY).toISOString());
  assert.deepEqual(state.stations.map(s => s.id), ['A0000002', 'A0000003']);
});

test('provider errors stop promptly, consume a durable call, preserve prior successes, and never expose credentials', async t => {
  const f = await setup(t, [row('A0000001'), row('A0000002')]);
  const result = await enrichCoordinates({ ...f.options, fetchImpl: async url => {
    if (new URL(url).searchParams.get('id') === 'A0000001') return response([detail('A0000001')]);
    throw new Error(`network failure: ${String(url)}`);
  } });
  assert.equal(result.status, 'partial');
  assert.equal(result.calls, 2);
  assert.equal(result.added, 1);
  assert.equal(result.stopReason, 'provider_error');
  const state = await f.read();
  assert.equal(state.dayBudget.used, 2);
  assert.equal(state.failures[0].error.code, 'OPINET_NETWORK_ERROR');
  assert.equal(state.failures[0].nextRetryAt, new Date(NOW + 3_600_000).toISOString());
  assert.equal(JSON.stringify(state).includes(f.options.apiKey), false);
  assert.equal(JSON.stringify(result).includes(f.options.apiKey), false);
  const oldVerified = state.stations[0].verifiedAt;
  const noKey = await enrichCoordinates({ ...f.options, apiKey: '', clock: () => NOW + 1000,
    fetchImpl: async () => assert.fail('no key must never trigger a request') });
  assert.equal(noKey.status, 'awaiting_credentials');
  assert.equal(noKey.calls, 0);
  assert.equal((await f.read()).stations[0].verifiedAt, oldVerified);
  assert.equal((await f.read()).lastSuccessAt, oldVerified);
});

test('a detail record without a sale price can still supply verified coordinates', async t => {
  const f = await setup(t, [row('A0000001')]);
  const result = await enrichCoordinates({ ...f.options, fetchImpl: async () => response([{ ...detail('A0000001'), OIL_PRICE: [] }]) });
  assert.equal(result.status, 'ready');
  assert.equal(result.added, 1);
  assert.equal((await f.read()).stations[0].id, 'A0000001');
});

test('corrupt state or shared quota fail closed, and a running process lock prevents duplicate calls', async t => {
  const f = await setup(t, [row('A0000001')]);
  const never = async () => assert.fail('invalid state must prevent requests');
  await writeFile(f.outputPath, 'corrupt previous state');
  await assert.rejects(enrichCoordinates({ ...f.options, fetchImpl: never }), { code: 'COORDINATE_STATE_UNREADABLE' });
  assert.equal(await readFile(f.outputPath, 'utf8'), 'corrupt previous state');
  await rm(f.outputPath);
  await writeFile(f.options.ledgerPath, '{"bad":"ledger"}');
  await assert.rejects(enrichCoordinates({ ...f.options, fetchImpl: never }), { code: 'QUOTA_LEDGER_UNREADABLE' });
  await rm(f.options.ledgerPath);
  await writeFile(`${f.outputPath}.lock`, 'active');
  await assert.rejects(enrichCoordinates({ ...f.options, fetchImpl: never }), { code: 'COORDINATE_ENRICHMENT_BUSY' });
  await rm(`${f.outputPath}.lock`);
  const result = await enrichCoordinates({ ...f.options, fetchImpl: async () => response([detail('A0000001')]) });
  assert.equal(result.added, 1);
});
