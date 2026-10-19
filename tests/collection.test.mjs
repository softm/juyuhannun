import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectEnergy } from '../scripts/collect-energy.mjs';
import { DailyQuota } from '../server/quota.mjs';
import { createApp } from '../server/index.mjs';

const clock = () => Date.parse('2026-10-19T16:00:00Z');
const oldTime = '2026-10-19T10:00:00Z';
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'juyu-collection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, 'collection.json');
  await writeFile(configPath, JSON.stringify({ dailyCallLimit: 300 }));
  return { root, configPath, outputDirectory: join(root, 'data'), ledgerPath: join(root, 'opinet-quota.json'), highwayLedgerPath: join(root, 'ex-quota.json'), clock, apiKey: '', highwayApiKey: '' };
}

test('both collectors publish explicit empty credential states without an upstream call or invented success time', async t => {
  const options = await setup(t);
  const summary = await collectEnergy({ ...options, fetchImpl: () => { throw new Error('No provider should be called'); } });
  for (const [name, field] of [['averages', 'benchmarks'], ['highway', 'stations']]) {
    const data = JSON.parse(await readFile(join(options.outputDirectory, `${name}.json`), 'utf8'));
    assert.equal(data.status, 'awaiting_credentials');
    assert.equal(data.fetchedAt, null);
    assert.deepEqual(data[field], []);
    assert.equal(summary[name].calls, 0);
    assert.equal(data.lastAttempt.status, 'awaiting_credentials');
  }
});

test('average collection shares the station call ledger and cannot cross its remaining daily budget', async t => {
  const options = await setup(t);
  await new DailyQuota({ ledgerPath: options.ledgerPath, clock }).reserve(299);
  let requests = 0;
  const fetchImpl = async url => {
    requests += 1;
    const endpoint = new URL(url).pathname;
    const record = { PRODCD: 'B027', PRICE: '1700.25', DIFF: '-0.12', TRADE_DT: '20261019' };
    if (endpoint.endsWith('/avgSidoPrice.do')) Object.assign(record, { SIDOCD: '01', SIDONM: '서울' });
    return new Response(JSON.stringify({ RESULT: { OIL: [record] } }), { headers: { 'Content-Type': 'application/json' } });
  };
  const result = await collectEnergy({ ...options, apiKey: 'synthetic-fixture-key', fetchImpl });
  assert.equal(requests, 1);
  assert.equal(result.averages.calls, 1);
  assert.equal(result.averages.status, 'partial');
  const ledger = JSON.parse(await readFile(options.ledgerPath, 'utf8'));
  assert.equal(ledger.used, 300);
  assert.equal(result.highway.status, 'awaiting_credentials');
});

test('provider failure retains original averages while a successful empty highway response clears old stations', async t => {
  const options = await setup(t);
  await mkdir(options.outputDirectory);
  const oldAverage = { id: 'national:KR:B027', dataGranularity: 'aggregate', scope: 'national', fuel: 'B027', averagePrice: 1700, unit: 'KRW/L', asOfDate: '2026-10-18', fetchedAt: oldTime };
  await writeFile(join(options.outputDirectory, 'averages.json'), JSON.stringify({ status: 'ready', fetchedAt: oldTime, benchmarks: [oldAverage], warnings: [] }));
  await writeFile(join(options.outputDirectory, 'highway.json'), JSON.stringify({ status: 'ready', fetchedAt: oldTime, stations: [{ id: 'old-station' }], warnings: [] }));
  const summary = await collectEnergy({
    ...options,
    benchmarkClient: { snapshot: async () => ({ status: 'error', fetchedAt: null, benchmarks: [], error: { code: 'FIXTURE_FAILURE', message: '검증용 실패' } }) },
    highwayClient: { snapshot: async () => ({ status: 'ready', fetchedAt: new Date(clock()).toISOString(), stations: [], warnings: [] }) },
  });
  const averages = JSON.parse(await readFile(join(options.outputDirectory, 'averages.json'), 'utf8'));
  const highway = JSON.parse(await readFile(join(options.outputDirectory, 'highway.json'), 'utf8'));
  assert.equal(averages.fetchedAt, oldTime);
  assert.deepEqual(averages.benchmarks, [oldAverage]);
  assert.equal(averages.cache.stale, true);
  assert.equal(averages.lastAttempt.status, 'error');
  assert.equal(summary.averages.preserved, true);
  assert.deepEqual(highway.stations, []);
  assert.equal(highway.status, 'ready');
});

test('public HTTP routes expose both providers and validate average scope before any upstream request', async t => {
  const options = await setup(t);
  const handler = createApp({ env: {}, projectRoot: options.root, clock, fetchImpl: () => { throw new Error('No provider should be called'); } });
  const dispatch = async url => {
    let status, body;
    await handler({ url, method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, {
      setHeader() {}, writeHead(value) { status = value; }, end(value) { body = JSON.parse(value); },
    });
    return { status, body };
  };
  for (const [path, field] of [['/api/benchmarks', 'benchmarks'], ['/api/highway-stations', 'stations']]) {
    const response = await dispatch(path);
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'awaiting_credentials');
    assert.deepEqual(response.body[field], []);
  }
  assert.equal((await dispatch('/api/benchmarks?includeSigun=true')).status, 400);
  assert.equal((await dispatch('/api/benchmarks?fuel=invalid')).status, 400);
  const health = await dispatch('/api/health');
  assert.equal(health.body.providers.highway.configured, false);
});
