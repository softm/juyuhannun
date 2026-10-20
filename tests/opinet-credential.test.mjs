import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OpinetClient, validateAreaCodes } from '../server/opinet.mjs';
import { collect } from '../scripts/collect.mjs';

const json = rows => new Response(JSON.stringify({ RESULT: { OIL: rows } }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

test('area-code preflight distinguishes a usable Opinet certkey from empty or malformed responses', async () => {
  const validRows = [{ AREA_CD: '01', AREA_NM: '서울' }, { AREA_CD: '02', AREA_NM: '경기' }];
  assert.deepEqual(validateAreaCodes(validRows), [{ code: '01', name: '서울' }, { code: '02', name: '경기' }]);
  assert.throws(() => validateAreaCodes([]), { code: 'OPINET_CREDENTIAL_UNUSABLE' });
  assert.throws(() => validateAreaCodes([{ AREA_CD: 'broken', AREA_NM: '' }]), { code: 'OPINET_CREDENTIAL_SCHEMA_ERROR' });

  let reserved = 0;
  const requests = [];
  const client = new OpinetClient({
    apiKey: 'fixture-key',
    quota: { reserve: async count => { reserved += count; } },
    fetchImpl: async url => {
      requests.push(new URL(url));
      return json(validRows);
    },
  });
  const result = await client.verifyCredential();
  assert.deepEqual(result, { status: 'ready', count: 2 });
  assert.equal(reserved, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, '/api/areaCode.do');
  assert.deepEqual([...requests[0].searchParams.keys()].sort(), ['certkey', 'out']);
});

test('collector stops after one preflight call when the configured key gets an empty area-code response', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'juyuhannun-preflight-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'stations.json');
  const ledgerPath = join(dir, 'quota.json');
  let calls = 0;
  const summary = await collect({
    outputPath,
    ledgerPath,
    configPath: resolve('config/collection.json'),
    apiKey: 'fixture-key',
    fetchImpl: async () => { calls += 1; return json([]); },
    clock: () => Date.parse('2026-10-20T00:50:00Z'),
  });
  assert.equal(calls, 1);
  assert.equal(summary.calls, 1);
  assert.equal(summary.credentialValid, false);
  assert.equal(summary.status, 'error');
  const snapshot = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(snapshot.error.code, 'OPINET_CREDENTIAL_UNUSABLE');
  assert.equal(snapshot.lastAttempt.credential, 'failed');
  assert.ok(snapshot.coverage.zones.every(zone => zone.status === 'error'));
});
