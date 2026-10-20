import test from 'node:test';
import assert from 'node:assert/strict';
import { logOpinetDiagnostic } from '../server/opinet-diagnostics.mjs';
import { OpinetClient } from '../server/opinet.mjs';

function diagnostic(payload, options = {}) {
  const lines = [];
  const emitted = logOpinetDiagnostic({ endpoint: 'aroundAll.do', httpStatus: 200, payload, enabled: true, write: line => lines.push(line), ...options });
  return { emitted, lines, record: lines.length ? JSON.parse(lines[0]) : null };
}

test('diagnostics distinguish actual empty oil arrays from missing, null and malformed values', () => {
  for (const [payload, resultType, oilType, count] of [
    [{ RESULT: { OIL: [] } }, 'object', 'array', 0],
    [{ RESULT: { OIL: [{ PRICE: 1876 }, { PRICE: 1901 }] } }, 'object', 'array', 2],
    [{ RESULT: { OIL: null } }, 'object', 'null', null],
    [{ RESULT: { OIL: '' } }, 'object', 'string', null],
    [{ RESULT: {} }, 'object', 'absent', null],
    [{ RESULT: [] }, 'array', 'absent', null],
    ['untrusted provider text', 'absent', 'absent', null],
    [42, 'absent', 'absent', null],
    [false, 'absent', 'absent', null],
    [null, 'absent', 'absent', null],
    [undefined, 'absent', 'absent', null],
    [[], 'absent', 'absent', null],
  ]) {
    const result = diagnostic(payload);
    assert.equal(result.emitted, true);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].includes('\n'), false);
    assert.equal(result.record.RESULT.type, resultType);
    assert.equal(result.record.OIL.type, oilType);
    assert.equal(result.record.OIL.arrayCount, count);
  }
});

test('malicious payloads cannot copy keys, URLs, text, prices or dynamic field names into a diagnostic', () => {
  const secret = 'SENSITIVE-key-792634-DO-NOT-LOG';
  const url = `https://provider.invalid/?certkey=${secret}`;
  const payload = {
    [secret]: url, certkey: secret, message: secret, CODE: secret, errorCode: `20:${secret}`,
    ERROR: { CODE: 792634, RESULT_CODE: secret, message: url },
    RESULT: {
      [url]: secret, ERROR: { CODE: '20', message: secret, resultCode: secret },
      OIL: [{ PRICE: 98765, UNI_ID: secret, OS_NM: url, certkey: secret }],
    },
    response: { header: { resultCode: '30', errorCode: secret, resultMsg: url }, message: secret },
    header: { resultCode: '792', CODE: '634', RESULT_CODE: secret },
  };
  const { lines: [line], record } = diagnostic(payload, { apiKey: secret, endpoint: url });
  for (const forbidden of [secret, url, 'https:', 'certkey', 'message', 'PRICE', 'UNI_ID', '98765', '792634']) assert.equal(line.includes(forbidden), false);
  assert.equal(record.endpoint, 'unsupported');
  assert.equal(record.errorFields.root.CODE.present, true);
  assert.equal(record.errorFields.root.CODE.numericCode, null);
  assert.equal(record.errorFields.rootError.CODE.numericCode, null);
  assert.equal(record.errorFields.resultError.CODE.numericCode, 20);
  assert.equal(record.errorFields.responseHeader.resultCode.numericCode, 30);
  assert.equal(record.errorFields.header.resultCode.numericCode, null);
  assert.equal(record.errorFields.header.CODE.numericCode, null);
  assert.equal(record.OIL.arrayCount, 1);
  const numericSecret = diagnostic({ CODE: '20', RESULT: { OIL: [] } }, { apiKey: '20' });
  assert.equal(numericSecret.record.errorFields.root.CODE.numericCode, null);
});

test('only short integer codes are eligible and cyclic objects are never serialized', () => {
  const payload = { RESULT: { OIL: [] }, CODE: '001', RESULT_CODE: -1, errorCode: 1.5, resultCode: '1000' };
  payload.ERROR = payload;
  const { record } = diagnostic(payload);
  assert.equal(record.errorFields.root.CODE.numericCode, 1);
  for (const name of ['RESULT_CODE', 'errorCode', 'resultCode']) assert.equal(record.errorFields.root[name].numericCode, null);
  assert.equal(record.errorFields.root.ERROR.present, true);
});

test('credential format hints report booleans without lengths, prefixes or key content', () => {
  const plain = 'fixture-value-not-a-real-key';
  for (const [apiKey, flag] of [[`"${plain}"`, 'surroundingQuotes'], [`${plain} extra`, 'whitespace'], [`OPINET_API_KEY=${plain}`, 'assignment'], [`certkey=${plain}`, 'assignment'], [`https://example.invalid/?certkey=${plain}`, 'url']]) {
    const { record, lines: [line] } = diagnostic({ RESULT: { OIL: [] } }, { apiKey });
    assert.equal(record.credentialFormat[flag], true);
    assert.equal(Object.values(record.credentialFormat).every(value => typeof value === 'boolean'), true);
    assert.equal(line.includes(plain), false);
    assert.equal(line.includes(apiKey), false);
    assert.equal(line.includes('length'), false);
    assert.equal(line.includes('prefix'), false);
  }
});

test('disabled diagnostics and diagnostic failures do not inspect or break a provider response', () => {
  let reads = 0; let writes = 0;
  const payload = new Proxy({}, { getOwnPropertyDescriptor() { reads += 1; throw new Error('secret diagnostic failure'); } });
  assert.equal(logOpinetDiagnostic({ enabled: false, payload, write: () => { writes += 1; } }), false);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal(logOpinetDiagnostic({ enabled: true, payload, write: () => { writes += 1; } }), false);
  assert.equal(writes, 0);
  assert.equal(diagnostic({ RESULT: { OIL: [] } }, { write: () => { throw new Error('secret writer failure'); } }).emitted, false);
  const getterPayload = { get RESULT() { throw new Error('secret getter must not run'); } };
  assert.equal(diagnostic(getterPayload).record.RESULT.type, 'accessor');
});

test('request diagnostics use the existing parsed response once and preserve normal and error behavior', async () => {
  const oldFlag = process.env.OPINET_DIAGNOSTICS;
  const oldInfo = console.info;
  const lines = []; let calls = 0;
  const client = new OpinetClient({ apiKey: 'fixture-secret', fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify({ RESULT: { OIL: [] } }), { headers: { 'Content-Type': 'application/json' } });
  } });
  try {
    console.info = line => lines.push(line);
    delete process.env.OPINET_DIAGNOSTICS;
    assert.deepEqual(await client.request('aroundAll.do', {}), []);
    assert.equal(lines.length, 0);
    process.env.OPINET_DIAGNOSTICS = '1';
    assert.deepEqual(await client.request('avgAllPrice.do', {}), []);
    assert.equal(calls, 2);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).endpoint, 'avgAllPrice.do');
    assert.equal(JSON.parse(lines[0]).httpStatus, 200);
    assert.equal(lines[0].includes('fixture-secret'), false);
    console.info = () => { throw new Error('logger failure containing fixture-secret'); };
    assert.deepEqual(await client.request('avgSidoPrice.do', {}), []);
    assert.equal(calls, 3);
    console.info = line => lines.push(line);
    client.fetchImpl = async () => { calls += 1; return new Response(JSON.stringify({ RESULT: { ERROR: { CODE: '20', message: 'fixture-secret' } } })); };
    await assert.rejects(client.request('aroundAll.do', {}), { code: 'OPINET_PROVIDER_ERROR' });
    assert.equal(calls, 4);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).errorFields.resultError.CODE.numericCode, 20);
    assert.equal(lines[1].includes('fixture-secret'), false);
  } finally {
    console.info = oldInfo;
    if (oldFlag === undefined) delete process.env.OPINET_DIAGNOSTICS;
    else process.env.OPINET_DIAGNOSTICS = oldFlag;
  }
});
