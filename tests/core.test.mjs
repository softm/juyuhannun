import test from 'node:test';
import assert from 'node:assert/strict';
import {freshness,calculateSavings,getFuelPrice,distanceMeters,filterStations,summarizeVisiblePrices,escapeHTML} from '../public/js/core.js';
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
test('last observed prices stay visible by default but never lower the comparable minimum',()=>{
 const mk=(id,price,t)=>({id,name:id,lat:37.5,lng:127,brand:'SOL',fuel:'B027',price,priceUpdatedAt:t,fetchedAt:'2026-10-19T14:00:00Z'});
 const items=[mk('old',1000,'2026-10-17T00:00:00Z'),mk('current',1600,'2026-10-19T13:00:00Z')];
 const opts={fuel:'B027',center:{lat:37.5,lng:127},bounds:{south:37,north:38,west:126,east:128},now};
 const visible=filterStations(items,opts);
 assert.deepEqual(visible.map(s=>s.id),['old','current']);
 assert.deepEqual(summarizeVisiblePrices(visible),{total:2,comparable:1,reference:1,lowest:1600});
 assert.deepEqual(filterStations(items,{...opts,freshOnly:true}).map(s=>s.id),['current']);
});

test('KST midnight expiry changes comparison eligibility without erasing the station',()=>{
 const station={id:'daily',name:'일일 자료',lat:37.5,lng:127,prices:{B027:{price:1600,priceUpdatedAt:null,fetchedAt:'2026-10-20T15:49:00Z',priceTimeStatus:'daily_price_file',sourceDate:'2026-10-20'}}};
 const opts={fuel:'B027',center:{lat:37.5,lng:127},bounds:{south:37,north:38,west:126,east:128}};
 const before=filterStations([station],{...opts,now:Date.parse('2026-10-21T23:59:59+09:00')});
 const after=filterStations([station],{...opts,now:Date.parse('2026-10-22T00:00:00+09:00')});
 assert.equal(before.length,1);assert.equal(after.length,1);
 assert.equal(before[0].confidence.eligible,true);assert.equal(after[0].confidence.eligible,false);
 assert.equal(after[0].confidence.state,'stale');
 assert.equal(summarizeVisiblePrices(before).lowest,1600);assert.equal(summarizeVisiblePrices(after).lowest,null);
 assert.equal(filterStations([station],{...opts,now:Date.parse('2026-10-22T00:00:00+09:00'),freshOnly:true}).length,0);
 assert.equal(after[0].currentPrice.fetchedAt,'2026-10-20T15:49:00Z');
});

test('daily 30h and reported 24h collection limits remain strict',()=>{
 const current=Date.parse('2026-10-22T21:00:00+09:00');
 const daily=(hours)=>freshness(null,new Date(current-hours*3600000).toISOString(),current,'daily_price_file','2026-10-21');
 assert.equal(daily(30).eligible,true);assert.equal(daily(30+1/3600).eligible,false);
 assert.equal(freshness('2026-10-22T20:00:00+09:00','2026-10-21T20:59:59+09:00',current).eligible,false);
 const unknown={id:'unknown',name:'시각 미확인',lat:37.5,lng:127,prices:{B027:{price:1000,fetchedAt:new Date(current).toISOString(),priceUpdatedAt:null}}};
 const rows=filterStations([unknown],{fuel:'B027',center:{lat:37.5,lng:127},bounds:{south:37,north:38,west:126,east:128},now:current});
 assert.equal(rows.length,1);assert.equal(rows[0].confidence.eligible,false);
 assert.deepEqual(summarizeVisiblePrices(rows),{total:1,comparable:0,reference:1,lowest:null});
});
test('untrusted station labels are escaped',()=>assert.equal(escapeHTML('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;'));

test('daily current-price files are eligible without inventing a station report time',()=> {
 const fetched='2026-10-19T14:00:00Z';
 const current=freshness(null,fetched,now,'daily_current_file','2026-10-19');
 assert.equal(current.state,'daily'); assert.equal(current.eligible,true);
 const stale=freshness(null,'2026-10-18T07:00:00Z',now,'daily_current_file','2026-10-18');
 assert.equal(stale.state,'stale'); assert.equal(stale.eligible,false);
 const p=getFuelPrice({prices:{B027:{price:1700,fetchedAt:fetched,priceTimeStatus:'daily_current_file'}}},'B027');
 assert.equal(p.priceTimeStatus,'daily_current_file');
});

test('a recently downloaded daily file without its price date remains reference-only',()=>{
 for(const sourceDate of [null,undefined,'','unknown','20261019']){
  const result=freshness(null,'2026-10-19T14:00:00Z',now,'daily_price_file',sourceDate);
  assert.equal(result.eligible,false);assert.equal(result.state,'unknown');
  assert.match(result.label,/기준일 미확인/);
 }
});

