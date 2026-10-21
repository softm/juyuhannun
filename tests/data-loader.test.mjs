import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {loadStaticJSON,useNationwideData,mergeStationData,reselectStationPrices,loadStationData} from '../public/js/data-loader.js';
import {getFuelPrice,freshness,filterStations,summarizeVisiblePrices} from '../public/js/core.js';
test('static map data decompresses gzip and repeated map searches reuse the same observation',async()=>{
 let calls=0;const data={status:'partial',fetchedAt:'2026-10-20T11:00:00Z',stations:[{id:'A1'}]};
 const fetchImpl=async url=>{calls++;assert.match(url,/latest\.json\.gz\?v=1$/);return new Response(gzipSync(JSON.stringify(data)));};
 const a=await loadStaticJSON('./test/latest.json?v=1',{fetchImpl});
 const b=await loadStaticJSON('./test/latest.json?v=1',{fetchImpl});
 assert.deepEqual(a,data);assert.equal(a,b);assert.equal(calls,1);
});

const mergeNow=Date.parse('2026-10-22T03:00:00Z');
const oldPrice={price:1700,unit:'KRW/L',priceUpdatedAt:null,priceTimeStatus:'daily_price_file',sourceDate:'2026-10-20',fetchedAt:'2026-10-20T15:49:00Z'};
const nationalSource={name:'오피넷 일일 판매가격',url:'https://www.opinet.co.kr/user/opdown/opDownload.do'};
const regionalSource={name:'오피넷 API',url:'https://www.opinet.co.kr/'};
const national={status:'partial',provider:'opinet-public-download',source:nationalSource,fetchedAt:oldPrice.fetchedAt,coverage:{kind:'nationwide',totalPriceStations:2,priceDate:'2026-10-20',complete:false},stations:[
 {id:'shared',name:'공통주유소',lat:null,lng:null,address:'서울시 중구',fetchedAt:oldPrice.fetchedAt,prices:{B027:oldPrice,D047:{...oldPrice,price:1500}}},
 {id:'national-only',name:'전국자료 주유소',lat:37.5,lng:127,fetchedAt:oldPrice.fetchedAt,prices:{B027:{...oldPrice,price:1200}}},
]};
const regionalPrice={price:1800,priceUpdatedAt:'2026-10-22T02:00:00Z',fetchedAt:'2026-10-22T02:30:00Z',sourceDate:'20261022',sourceTime:'110000'};
const regional={status:'ready',provider:'opinet',source:regionalSource,fetchedAt:regionalPrice.fetchedAt,coverage:{kind:'sample_zones',complete:false},stations:[
 {id:'shared',name:'공통주유소',lat:37.5,lng:127,address:null,priceTimeStatus:'reported',fetchedAt:regionalPrice.fetchedAt,prices:{B027:regionalPrice,K015:{...regionalPrice,price:900}}},
]};

test('new regional observations repair expired nationwide prices per ID and fuel with original provenance',()=>{
 const originals=structuredClone([national,regional]);
 const merged=mergeStationData(national,regional,{now:mergeNow});
 assert.equal(merged.stations.length,2);assert.equal(merged.coverage.mappedPriceStations,2);
 const row=merged.stations.find(s=>s.id==='shared');
 assert.equal(row.lat,37.5);assert.equal(row.address,'서울시 중구');
 assert.equal(row.prices.B027.price,1800);assert.notEqual(row.prices.B027.source,nationalSource);
 assert.deepEqual(row.prices.B027.source,regionalSource);assert.equal(row.prices.B027.provider,'opinet');
 assert.equal(row.prices.B027.sourceDate,'20261022');assert.equal(row.prices.B027.sourceTime,'110000');
 assert.equal(row.prices.B027.priceUpdatedAt,regionalPrice.priceUpdatedAt);
 assert.equal(row.prices.B027.fetchedAt,regionalPrice.fetchedAt);
 assert.equal(row.prices.D047.fetchedAt,oldPrice.fetchedAt);assert.equal(row.prices.D047.sourceDate,'2026-10-20');
 assert.equal(row.prices.D047.priceUpdatedAt,null);assert.deepEqual(row.prices.D047.source,nationalSource);
 assert.equal(row.prices.K015.price,900);
 const diesel=getFuelPrice(row,'D047');
 assert.equal(freshness(diesel.priceUpdatedAt,diesel.fetchedAt,mergeNow,diesel.priceTimeStatus,diesel.sourceDate).eligible,false);
 const visible=filterStations(merged.stations,{fuel:'B027',center:{lat:37.5,lng:127},bounds:{south:37,north:38,west:126,east:128},now:mergeNow});
 assert.deepEqual(summarizeVisiblePrices(visible),{total:2,comparable:1,reference:1,lowest:1800});
 assert.deepEqual([national,regional],originals,'Inputs must not be mutated or given new observation times');
});

test('newly fetched undated price does not replace a usable dated observation',()=>{
 const unknown={...regional,stations:[{...regional.stations[0],priceTimeStatus:'unknown',fetchedAt:'2026-10-22T02:59:00Z',prices:{B027:{price:1000,fetchedAt:'2026-10-22T02:59:00Z',priceUpdatedAt:null}}}]};
 const merged=mergeStationData(regional,unknown,{now:mergeNow});
 assert.equal(merged.stations[0].prices.B027.price,1800);
 assert.equal(merged.stations[0].prices.B027.fetchedAt,regionalPrice.fetchedAt);
});

test('price basis day wins over download recency, then exact reports win within that KST day',()=>{
 const daily={...national,stations:[{...national.stations[0],prices:{B027:{...oldPrice,sourceDate:'2026-10-22',fetchedAt:'2026-10-22T02:50:00Z'}}}]};
 const yesterday={...regional,stations:[{...regional.stations[0],prices:{B027:{...regionalPrice,priceUpdatedAt:'2026-10-21T14:00:00Z'}}}]};
 assert.equal(mergeStationData(daily,yesterday,{now:mergeNow}).stations[0].prices.B027.price,1700);
 const today={...regional,stations:[{...regional.stations[0],prices:{B027:{...regionalPrice,priceUpdatedAt:'2026-10-21T16:00:00Z'}}}]};
 assert.equal(mergeStationData(daily,today,{now:mergeNow}).stations[0].prices.B027.price,1800);
});

test('invalid prices and absent coordinates cannot destroy a valid observation or invent a map location',()=>{
 const invalid={...regional,stations:[{...regional.stations[0],lat:null,lng:null,prices:{B027:{price:0}}},{id:'unmapped',name:'좌표없음',prices:{B027:oldPrice}}]};
 const merged=mergeStationData(regional,invalid,{now:mergeNow});
 assert.equal(merged.stations.find(s=>s.id==='shared').lat,37.5);
 assert.equal(merged.stations.find(s=>s.id==='shared').prices.B027.price,1800);
 assert.equal(merged.stations.find(s=>s.id==='unmapped').lat,null);
 assert.equal(merged.coverage.mappedPriceStations,1);
});

test('time reevaluation restores a still-eligible daily price and retains live detail observations',()=>{
 const daily={price:1700,priceUpdatedAt:null,priceTimeStatus:'daily_price_file',sourceDate:'2026-10-21',fetchedAt:'2026-10-21T22:00:00+09:00'};
 const exact={price:1800,priceUpdatedAt:'2026-10-21T00:00:00+09:00',fetchedAt:'2026-10-21T00:10:00+09:00'};
 const row=(id,price)=>({id,name:id,lat:37.5,lng:127,fetchedAt:price.fetchedAt,prices:{B027:price}});
 const nationwide={status:'partial',source:nationalSource,stations:[row('A',daily),row('B',daily)]};
 const api={status:'ready',source:regionalSource,stations:[row('A',exact),row('B',exact)]};
 const before=Date.parse('2026-10-21T23:59:00+09:00'),after=Date.parse('2026-10-22T00:01:00+09:00');
 const loaded=mergeStationData(nationwide,api,{now:before});
 assert.equal(loaded.stations[0].prices.B027.price,1800);
 const detail={price:1850,priceUpdatedAt:'2026-10-21T23:50:00+09:00',fetchedAt:'2026-10-21T23:55:00+09:00',source:regionalSource};
 const current=mergeStationData(loaded,{status:'ready',stations:[row('B',detail)]},{now:before}).stations;
 const original=structuredClone({current,sourceSnapshots:loaded.sourceSnapshots});
 const renewed=reselectStationPrices(current,loaded.sourceSnapshots,{now:after});
 const a=getFuelPrice(renewed.find(s=>s.id==='A'),'B027'),b=getFuelPrice(renewed.find(s=>s.id==='B'),'B027');
 assert.equal(a.price,1700);assert.equal(a.fetchedAt,daily.fetchedAt);assert.equal(a.sourceDate,daily.sourceDate);
 assert.deepEqual(a.source,nationalSource);
 assert.equal(freshness(a.priceUpdatedAt,a.fetchedAt,after,a.priceTimeStatus,a.sourceDate).eligible,true);
 assert.equal(b.price,1850);assert.equal(b.priceUpdatedAt,detail.priceUpdatedAt);assert.equal(b.fetchedAt,detail.fetchedAt);
 assert.deepEqual({current,sourceSnapshots:loaded.sourceSnapshots},original,'Reevaluation must preserve original observations and live details');
});

test('loading always reads national and regional snapshots even when national coordinates exist',async()=>{
 const urls=[];
 const result=await loadStationData({now:mergeNow,read:async url=>{urls.push(url);return url.includes('/nationwide/')?national:regional;}});
 assert.equal(urls.length,2);assert.ok(urls.some(url=>url.includes('/stations.json')));
 assert.equal(result.stations.find(s=>s.id==='shared').prices.B027.price,1800);
 assert.equal(result.sourceSnapshots.nationwide.fetchedAt,oldPrice.fetchedAt);
});

test('a failed source refresh preserves its last snapshot without advancing any observation timestamp',async()=>{
 const previous=mergeStationData(national,regional,{now:mergeNow});
 const result=await loadStationData({now:mergeNow+300000,previous,read:async url=>{
  if(url.includes('/nationwide/'))throw new Error('nationwide temporarily unavailable');
  return regional;
 }});
 assert.equal(result.stations.length,2);
 assert.equal(result.stations.find(s=>s.id==='national-only').prices.B027.fetchedAt,oldPrice.fetchedAt);
 assert.equal(result.sourceSnapshots.nationwide.fetchedAt,oldPrice.fetchedAt);
 assert.equal(result.sourceSnapshots.nationwide.cache.stale,true);
 assert.equal(result.cache.stale,false,'A successful regional observation remains usable');
 assert.equal(result.downloadErrors[0].source,'nationwide');
 await assert.rejects(loadStationData({previous,read:async()=>{throw new Error('offline');}}),/offline/);
});
test('a missing or invalid gzip falls back to JSON; aborts do not start a fallback request',async()=>{
 for(const bad of [()=>new Response('missing',{status:404}),()=>new Response('invalid gzip')]){
  const urls=[];const d=await loadStaticJSON('./fallback/stations.json',{cacheMs:0,fetchImpl:async url=>{urls.push(url);return url.endsWith('.gz')?bad():new Response('{"stations":[]}');}});
  assert.deepEqual(d,{stations:[]});assert.equal(urls.length,2);
 }
 const ctrl=new AbortController();let calls=0;
 await assert.rejects(loadStaticJSON('./abort/stations.json',{signal:ctrl.signal,fetchImpl:async()=>{calls++;ctrl.abort();throw new DOMException('Aborted','AbortError');}}),{name:'AbortError'});
 assert.equal(calls,1);
});
test('LPG uses regional observations when the nationwide daily file only includes liquid fuels',()=>{
 const data={status:'partial',coverage:{serviceReady:true},stations:[{lat:37.5,lng:127,prices:{B027:{price:1750}}}]};
 assert.equal(useNationwideData(data,'B027'),true);assert.equal(useNationwideData(data,'K015'),false);
 assert.equal(useNationwideData({...data,coverage:{serviceReady:false}},'B027'),true);
 assert.equal(useNationwideData({...data,stations:[{lat:null,lng:null,prices:{B027:{price:1750}}}]},'B027'),false);
});

