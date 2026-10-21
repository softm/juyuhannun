import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeData} from '../scripts/data-status.mjs';
import {availabilityAt} from '../public/js/data-status-model.js';

const station=(id,prices,coordinates={lat:37.56,lng:126.98})=>({id,name:id,...coordinates,prices});
const daily={price:1200,priceUpdatedAt:null,priceTimeStatus:'daily_price_file',sourceDate:'2026-10-20',fetchedAt:'2026-10-21T00:49:33+09:00'};
const regionalPrice={price:1800,priceUpdatedAt:'2026-10-21T21:00:00+09:00',fetchedAt:'2026-10-21T21:15:00+09:00'};

test('published status expires daily eligibility at Korean midnight without losing map availability',()=>{
 const d=summarizeData({generatedAt:'2026-10-21T23:59:00+09:00',manifest:{priceStationCount:3,priceDate:'2026-10-20'},nationwide:{status:'partial',stations:[station('A', {B027:daily}),station('B',{B027:daily})],coverage:{serviceReady:true}},searchable:{status:'partial',stations:[station('A',{B027:daily}),station('B',{B027:daily}),station('C',{B027:daily},{lat:null,lng:null})]},regional:{status:'ready',stations:[station('A',{B027:regionalPrice})]}});
 assert.equal(d.nationwide.totalPriceStations,3);
 assert.equal(d.nationwide.unmappedPriceStations,1);
 assert.equal(d.availability.displayableStationCount,2);
 assert.equal(d.fuels[0].comparableStationCount,2);
 const midnight=availabilityAt(d,Date.parse('2026-10-22T00:00:00+09:00'))[0];
 assert.deepEqual(midnight,{code:'B027',mappedStationCount:2,comparableStationCount:1,historicalStationCount:1});
 assert.equal(d.availability.priceCohorts.flatMap(row=>row.observations).find(row=>row.sourceDate==='2026-10-20').fetchedAt,daily.fetchedAt);
 const expired=availabilityAt(d,Date.parse('2026-10-23T00:00:00+09:00'))[0];
 assert.equal(expired.mappedStationCount,2);assert.equal(expired.comparableStationCount,0);
});

test('status keeps a valid alternative source after the initially selected reported price expires',()=>{
 const nationwide={status:'partial',stations:[station('A',{B027:{...daily,sourceDate:'2026-10-21',fetchedAt:'2026-10-21T22:00:00+09:00'}})]};
 const regional={status:'ready',stations:[station('A',{B027:{...regionalPrice,priceUpdatedAt:'2026-10-21T00:00:00+09:00',fetchedAt:'2026-10-21T00:10:00+09:00'}})]};
 const d=summarizeData({generatedAt:'2026-10-21T23:59:00+09:00',nationwide,regional});
 assert.equal(d.fuels[0].comparableStationCount,1);
 const next=availabilityAt(d,Date.parse('2026-10-22T00:01:00+09:00'))[0];
 assert.equal(next.mappedStationCount,1);assert.equal(next.comparableStationCount,1);
 assert.equal(d.availability.priceCohorts[0].observations.length,2);
});

test('status uses final shared quota and coordinate progress without copying the coordinate catalog',()=>{
 const quota={day:'2026-10-22',used:260,limit:300,remaining:40};
 const coordinates={status:'paused_quota',stations:[{id:'A',lat:37,lng:127}],failures:[{id:'B'}],queue:{enrichedCount:1,pendingCount:2},dayBudget:{day:'2026-10-22',used:20,limit:80},quota:{used:240,remaining:60},lastAttempt:{calls:20,successCount:1,stopReason:'reserved_for_prices'}};
 const d=summarizeData({quota,coordinates,regional:{quota:{used:230,remaining:70}}});
 assert.deepEqual(d.quota,quota);assert.equal(d.coordinates.queue.enrichedCount,1);
 assert.equal(d.coordinates.stations,undefined);assert.equal(d.coordinates.failures,undefined);
 assert.equal(d.coordinates.lastAttempt.stopReason,'reserved_for_prices');
});
