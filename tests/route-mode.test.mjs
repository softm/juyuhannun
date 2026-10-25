import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouteModeController} from '../public/js/route-mode.js';

const now=()=>Date.parse('2026-10-26T03:00:00Z');
const station=(price=1600)=>({
  id:'station-1',name:'경로 주유소',lat:37.01,lng:127.05,
  prices:{B027:{price,priceUpdatedAt:'2026-10-26T02:00:00Z',fetchedAt:'2026-10-26T02:30:00Z'}},
});
const response={status:'ready',baseRoute:{path:[[127,37],[127.1,37]],distanceMeters:10_000,durationSeconds:600,tollWon:0},results:[{
  stationId:'station-1',progressMeters:5_000,proximityMeters:100,
  price:{value:1600,priceUpdatedAt:'2026-10-26T02:00:00Z',fetchedAt:'2026-10-26T02:30:00Z',eligible:true,label:'최신 가격'},
  detour:{verified:true,distanceMeters:1_000,durationSeconds:180,tollWon:0},viaPath:[[127,37],[127.05,37.01],[127.1,37]],rank:1,
}]};

function points(controller){
  controller.setPoint('origin',{lat:37,lng:127},'출발지');
  controller.setPoint('destination',{lat:37,lng:127.1},'목적지');
}

test('route mode reports an explicit API requirement without inventing a route',async()=>{
  let calls=0;const controller=createRouteModeController({apiBase:'',requestJSON:async()=>{calls+=1;},clock:now});points(controller);
  const result=await controller.plan({stations:[station()],fuel:'B027',liters:30,kmPerLiter:12,maxDetourMinutes:10,corridorMeters:2000});
  assert.equal(calls,0);assert.equal(result.status,'unavailable');assert.equal(result.baseRoute,null);assert.deepEqual(result.results,[]);
});

test('route mode reuses verified detours but refreshes the local price observation',async()=>{
  let requestOptions;
  const controller=createRouteModeController({apiBase:'https://api.example.test/api',clock:now,requestJSON:async(_url,_signal,options)=>{requestOptions=options;return response;}});points(controller);
  await controller.plan({stations:[station()],fuel:'B027',liters:30,kmPerLiter:12,maxDetourMinutes:10,corridorMeters:2000});
  assert.equal(requestOptions.method,'POST');
  assert.equal(controller.rows({liters:30,kmPerLiter:12,maxDetourMinutes:10})[0].costs.totalWon,null);
  controller.syncStations([station(1500)],'B027');
  const [updated]=controller.rows({liters:30,kmPerLiter:12,referenceFuelWonPerL:1700,maxDetourMinutes:10});
  assert.equal(updated.currentPrice.price,1500);assert.equal(updated.costs.purchaseWon,45_000);assert.ok(updated.costs.totalWon>45_000);assert.equal(updated.routeRank,1);
});
