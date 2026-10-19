import test from 'node:test';
import assert from 'node:assert/strict';
import {freshness,calculateSavings,getFuelPrice,distanceMeters,filterStations,escapeHTML} from '../public/js/core.js';
const now=Date.parse('2026-10-19T14:30:00Z');
const route={status:'ready',provider:'naver',direct:{distanceMeters:10000,durationSeconds:1200,tollWon:0},via:{distanceMeters:13000,durationSeconds:1500,tollWon:0}};
const input={unitPrice:1600,referencePrice:1700,liters:40,kmPerLiter:10,route};
test('detour fuel and optional time reduce gross savings',()=>{
 const s=calculateSavings({...input,hourlyValue:12000});
 assert.equal(s.grossSavings,4000);assert.equal(s.fuelCost,510);assert.equal(s.timeCost,1000);assert.equal(s.netSavings,2490);
});
test('expensive detour remains a loss, no clamp or false savings',()=>{
 const s=calculateSavings({...input,liters:1});assert.equal(s.netSavings,-410);assert.equal(s.breakEvenLiters,5.1);
});
test('missing road route, null toll, zero economy and shorter inconsistent route cannot be recommended',()=>{
 assert.equal(calculateSavings({...input,route:null}).eligible,false);
 assert.equal(calculateSavings({...input,route:{...route,via:{...route.via,tollWon:null}}}).eligible,false);
 assert.equal(calculateSavings({...input,kmPerLiter:0}).eligible,false);
 assert.equal(calculateSavings({...input,route:{...route,via:{...route.via,distanceMeters:5000}}}).eligible,false);
});
test('negative toll differential is an actual cost reduction, never assumed zero',()=>{
 const s=calculateSavings({...input,route:{...route,direct:{...route.direct,tollWon:1000}}});assert.equal(s.tollCost,-1000);assert.equal(s.netSavings,4490);
});
test('new fetch does not turn old or unknown price timestamps fresh',()=>{
 assert.equal(freshness(null,new Date(now).toISOString(),now).eligible,false);
 assert.equal(freshness('2026-10-17T00:00:00Z',new Date(now).toISOString(),now).state,'stale');
 assert.equal(freshness('2026-10-19T13:00:00Z',null,now).eligible,false);
});
test('KST timestamps, 6h/24h boundaries and invalid future price',()=>{
 assert.equal(freshness('2026-10-19T23:00:00+09:00','2026-10-19T14:10:00Z',now).state,'fresh');
 assert.equal(freshness('2026-10-19T08:30:00Z',new Date(now).toISOString(),now).state,'fresh');
 assert.equal(freshness('2026-10-19T08:29:59Z',new Date(now).toISOString(),now).state,'aging');
 assert.equal(freshness('2026-10-18T14:29:59Z',new Date(now).toISOString(),now).state,'stale');
 assert.equal(freshness('2026-10-20T14:00:00Z',new Date(now).toISOString(),now).state,'invalid');
});
test('fuel-specific price required; null and zero are not bargains',()=>{
 assert.equal(getFuelPrice({fuel:'B027',price:1700},'D047'),null);
 assert.equal(getFuelPrice({prices:{B027:{price:0}}},'B027'),null);
 assert.equal(getFuelPrice({prices:{B027:{price:null}}},'B027'),null);
 assert.equal(getFuelPrice({fuel:'B027',price:1700,priceUpdatedAt:'2026-10-19T10:00:00Z'},'B027').price,1700);
});
test('geo distances are in metres; invalid coordinate never matches viewport',()=>{
 assert.equal(distanceMeters({lat:37.5,lng:127},{lat:37.5,lng:127}),0);
 assert.ok(Math.abs(distanceMeters({lat:0,lng:0},{lat:1,lng:0})-111195)<2);
 assert.equal(distanceMeters({lat:0,lng:0},{lat:null,lng:0}),Infinity);
});
test('stale cheap station excluded by default; explicit stale view includes it',()=>{
 const mk=(id,price,t)=>({id,name:id,lat:37.5,lng:127,brand:'SOL',fuel:'B027',price,priceUpdatedAt:t,fetchedAt:'2026-10-19T14:00:00Z'});
 const items=[mk('old',1000,'2026-10-17T00:00:00Z'),mk('current',1600,'2026-10-19T13:00:00Z')];
 const opts={fuel:'B027',center:{lat:37.5,lng:127},now};
 assert.deepEqual(filterStations(items,opts).map(s=>s.id),['current']);
 assert.deepEqual(filterStations(items,{...opts,freshOnly:false}).map(s=>s.id),['old','current']);
});
test('untrusted station labels are escaped',()=>assert.equal(escapeHTML('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;'));
