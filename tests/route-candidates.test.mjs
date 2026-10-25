import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRecommendationRanks,
  buildRouteSegmentIndex,
  calculateRouteCandidateCosts,
  findRouteCandidates,
  kakaoRouteURLs,
  projectPointToRoute,
  selectVerificationCandidates,
  sortRouteCandidates,
} from '../public/js/route-candidates.js';

const now=Date.parse('2026-10-26T03:00:00Z');
const freshPrice=price=>({price,priceUpdatedAt:'2026-10-26T02:00:00Z',fetchedAt:'2026-10-26T02:30:00Z'});
const station=(id,lat,lng,price=1600)=>({id,name:id,lat,lng,prices:{B027:freshPrice(price)}});
const path=[[127,37],[127.1,37],[127.2,37]];

test('polyline projection reports corridor distance and cumulative route progress',()=>{
  const index=buildRouteSegmentIndex(path,{corridorMeters:2_000});
  const first=projectPointToRoute({lat:37.005,lng:127.05},index);
  const second=projectPointToRoute({lat:37,lng:127.15},index);
  assert.ok(first.proximityMeters>500&&first.proximityMeters<600);
  assert.ok(first.progressMeters>4_000&&first.progressMeters<5_000);
  assert.ok(second.progressMeters>first.progressMeters);
  assert.equal(projectPointToRoute({lat:37.1,lng:127.05},index),null);
});

test('route candidates ignore map bounds, exclude missing fuel, and retain stale rows as reference only',()=>{
  const stale=station('stale',37.001,127.08,1400);stale.prices.B027.priceUpdatedAt='2026-10-20T00:00:00Z';
  const result=findRouteCandidates([
    station('a',37.001,127.02,1700),stale,station('far',37.1,127.1,1200),
    {id:'diesel',name:'diesel',lat:37,lng:127.1,prices:{D047:freshPrice(1300)}},
  ],path,{fuel:'B027',corridorMeters:2_000,now});
  assert.deepEqual(result.candidates.map(row=>row.id),['a','stale']);
  assert.equal(result.candidates.find(row=>row.id==='stale').confidence.eligible,false);
});

test('verification shortlist is spread across the route instead of taking only the cheapest cluster',()=>{
  const rows=Array.from({length:16},(_,index)=>({
    ...station(`s${index}`,37,127+index*.01,1000+index),
    currentPrice:freshPrice(1000+index),confidence:{eligible:true},proximityMeters:10,progressMeters:index*1_000,
  }));
  const selected=selectVerificationCandidates(rows,{limit:8,totalMeters:16_000});
  assert.equal(selected.length,8);
  assert.ok(selected.some(row=>row.progressMeters<4_000));
  assert.ok(selected.some(row=>row.progressMeters>=12_000));
});

test('cost total is withheld without an explicit consumption reference price',()=>{
  const detour={verified:true,distanceMeters:2_000,durationSeconds:300,tollWon:500};
  const partial=calculateRouteCandidateCosts({unitPrice:1600,liters:30,kmPerLiter:12,detour});
  assert.equal(partial.purchaseWon,48_000);
  assert.equal(partial.extraFuelWon,null);
  assert.equal(partial.totalWon,null);
  const full=calculateRouteCandidateCosts({unitPrice:1600,liters:30,kmPerLiter:12,referenceFuelWonPerL:1700,hourlyValueWonPerHour:12_000,detour});
  assert.equal(Math.round(full.extraFuelWon),283);
  assert.equal(Math.round(full.timeWon),1_000);
  assert.equal(Math.round(full.totalWon),49_783);
  assert.equal(Math.round(full.estimatedSavingWon),1_217);
});

test('recommendations require verified detours, valid prices and the detour limit',()=>{
  const base={confidence:{eligible:true},currentPrice:{price:1600},progressMeters:1_000,proximityMeters:100,costs:{totalWon:50_000}};
  const rows=[
    {...base,id:'ok',detour:{verified:true,distanceMeters:1_000,durationSeconds:240,tollWon:0}},
    {...base,id:'too-long',currentPrice:{price:1400},detour:{verified:true,distanceMeters:2_000,durationSeconds:900,tollWon:0},costs:{totalWon:42_000}},
    {...base,id:'unverified',currentPrice:{price:1300},detour:{verified:false}},
    {...base,id:'stale',confidence:{eligible:false},currentPrice:{price:1200},detour:{verified:true,distanceMeters:100,durationSeconds:30,tollWon:0}},
  ];
  const ranked=applyRecommendationRanks(rows,{maxDetourMinutes:10});
  assert.equal(ranked.find(row=>row.id==='ok').rank,1);
  assert.equal(ranked.filter(row=>row.rank).length,1);
  assert.equal(sortRouteCandidates(rows,{sort:'detour'})[0].id,'stale');
});

test('Kakao navigation keeps origin, one waypoint and final destination distinct',()=>{
  const urls=kakaoRouteURLs({lat:37.1,lng:127.1},{lat:37.2,lng:127.2},{lat:37.3,lng:127.3});
  assert.match(urls.app,/^kakaomap:\/\/route\?/);
  const query=new URL(urls.web).searchParams;
  assert.equal(query.get('sp'),'37.1,127.1');
  assert.equal(query.get('vp'),'37.2,127.2');
  assert.equal(query.get('ep'),'37.3,127.3');
  assert.equal(query.get('by'),'car');
});
