import test from 'node:test';
import assert from 'node:assert/strict';
import { HighwayClient, HIGHWAY_SOURCE } from '../server/highway.mjs';

test('highway without credentials returns no invented prices and makes no requests', async () => {
  let calls = 0; let reservations = 0;
  const client = new HighwayClient({
    quota: { reserve: async () => { reservations += 1; } },
    fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
  });
  const result = await client.snapshot();
  assert.equal(client.configured, false);
  assert.equal(result.status, 'awaiting_credentials');
  assert.deepEqual(result.stations, []);
  assert.equal(result.fetchedAt, null);
  assert.equal(result.coverage.complete, false);
  assert.equal(calls, 0);
  assert.equal(reservations, 0);
});

test('a configured key cannot turn an unverified source contract into a ready data source', async () => {
  let calls = 0; let reservations = 0;
  const client = new HighwayClient({
    apiKey: ' secret-not-for-public-output ',
    quota: { reserve: async () => { reservations += 1; } },
    fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
    clock: () => Date.parse('2026-10-19T16:00:00Z'),
  });
  const result = await client.snapshot();
  assert.equal(client.configured, true);
  assert.equal(client.implementationReady, false);
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'EX_SCHEMA_UNVERIFIED');
  assert.equal(result.dataGranularity, 'station');
  assert.equal(result.provider, 'ex');
  assert.equal(result.fetchedAt, null);
  assert.deepEqual(result.stations, []);
  assert.equal(JSON.stringify(result).includes('secret-not-for-public-output'), false);
  assert.equal(calls, 0);
  assert.equal(reservations, 0);
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
