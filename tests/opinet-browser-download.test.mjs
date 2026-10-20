import test from 'node:test';
import assert from 'node:assert/strict';
import { kstDate, previousKstDate } from '../server/opinet-browser-download.mjs';

test('browser nationwide collector resolves Korean calendar date without fabricating UTC day',()=>{
 assert.equal(kstDate(Date.parse('2026-10-19T15:30:00Z')),'20261020');
 assert.equal(previousKstDate(Date.parse('2026-10-20T15:30:00Z')),'20261020');
});
