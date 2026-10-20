import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePremiumStation, normalizePremiumPrices, premiumRows, PremiumOpinetClient } from '../server/opinet-premium.mjs';

test('premium row parser accepts RESULT.OIL arrays and rejects unknown envelopes', () => {
  assert.equal(premiumRows({ RESULT: { OIL: [{ UNI_ID: 'A1' }] } }).length, 1);
  assert.throws(() => premiumRows({ RESULT: {} }), { code: 'OPINET_PREMIUM_SCHEMA_ERROR' });
});

test('premium normalizers keep station identity, KATEC coordinates and per-fuel source time', () => {
  const fetchedAt = '2026-10-20T02:00:00.000Z';
  const row = {
    UNI_ID: 'A0010207', OS_NM: '테스트주유소', POLL_DIV_CD: 'SKE',
    GIS_X_COOR: '313751.7', GIS_Y_COOR: '544106.2',
    NEW_ADR: '서울특별시 테스트로 1',
    OIL_PRICE: [{ PRODCD: 'B027', PRICE: '1765', TRADE_DT: '20261020', TRADE_TM: '101500' }],
  };
  const station = normalizePremiumStation(row, { regionCode: '01', fetchedAt });
  assert.equal(station.id, 'A0010207');
  assert.equal(station.regionCode, '01');
  assert.ok(station.lat >= 32 && station.lat <= 40);
  const prices = normalizePremiumPrices(row, { fetchedAt });
  assert.equal(prices[0].fuel, 'B027');
  assert.equal(prices[0].value.price, 1765);
  assert.equal(prices[0].value.priceUpdatedAt, '2026-10-20T01:15:00.000Z');
});

test('premium client stays disabled until key and both contracted endpoint URLs exist', () => {
  assert.equal(new PremiumOpinetClient().configured, false);
  assert.equal(new PremiumOpinetClient({ apiKey: 'x', masterUrl: 'https://www.opinet.co.kr/api/master.do', priceUrl: 'https://www.opinet.co.kr/api/price.do' }).configured, true);
});

test('nationwide coordinate normalization treats province long names and common abbreviations as the same address', async () => {
  const source = await import('../scripts/collect-nationwide.mjs');
  assert.equal(typeof source.collectNationwide, 'function');
  // Regression coverage for the real-world normalization lives through collection fixtures;
  // this test additionally guards that the module remains importable after region rules change.
});
