import test from 'node:test';
import assert from 'node:assert/strict';
import { kstDate, previousKstDate } from '../server/opinet-browser-download.mjs';

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
