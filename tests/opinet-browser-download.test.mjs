import test from 'node:test';
import assert from 'node:assert/strict';
import { kstDate, previousKstDate, retryTransientDownload } from '../server/opinet-browser-download.mjs';

test('browser nationwide collector resolves Korean calendar date without fabricating UTC day',()=>{
 assert.equal(kstDate(Date.parse('2026-10-19T15:30:00Z')),'20261020');
 assert.equal(previousKstDate(Date.parse('2026-10-20T15:30:00Z')),'20261020');
});

import {parseDailyPriceCsv} from '../server/opinet-download.mjs';
test('LPG daily CSV uses eight columns and cannot become a premium gasoline price',()=>{
 const csv='"번호","지역","상호","주소","기간","상표","셀프여부","LPG"\n"A0011521","강원 강릉시","충전소","강릉시 길 1","20261109","GS칼텍스","일반","1205"';
 const rows=parseDailyPriceCsv(csv,{businessType:'lpg'});
 assert.equal(rows.length,1);assert.equal(rows[0]['자동차부탄'],'1205');assert.equal(rows[0]['고급휘발유'],undefined);
 assert.throws(()=>parseDailyPriceCsv(csv),{code:'OPINET_DOWNLOAD_SCHEMA_ERROR'});
});

test('transient browser download failures retry without delaying the test',async()=>{
 let calls=0;const retries=[];
 const result=await retryTransientDownload(async()=>{
  calls++;
  if(calls<3)throw Object.assign(new Error('timeout'),{code:'OPINET_BROWSER_DOWNLOAD_ERROR'});
  return 'ready';
 },{delayImpl:async()=>{},onRetry:retry=>retries.push(retry)});
 assert.equal(result,'ready');assert.equal(calls,3);
 assert.deepEqual(retries.map(item=>item.nextAttempt),[2,3]);
});

test('non-transient download validation errors fail immediately',async()=>{
 let calls=0;
 await assert.rejects(retryTransientDownload(async()=>{
  calls++;throw Object.assign(new Error('wrong date'),{code:'OPINET_DOWNLOAD_DATE_MISMATCH'});
 },{delayImpl:async()=>{}}),{code:'OPINET_DOWNLOAD_DATE_MISMATCH'});
 assert.equal(calls,1);
});
