import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRouteModeController,DIRECTIONS_PROXY,normalizeDirectionsResponse} from '../public/js/route-mode.js';

const appSource=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');

const now=()=>Date.parse('2026-10-26T03:00:00Z');
const station=(price=1600)=>({
  id:'station-1',name:'경로 주유소',lat:37.001,lng:127.05,
  prices:{B027:{price,priceUpdatedAt:'2026-10-26T02:00:00Z',fetchedAt:'2026-10-26T02:30:00Z'}},
});
const proxyResponse=({via=false}={})=>({
  summary:{distance:via?11_000:10_000,duration:via?780_000:600_000,tollFare:0},
  path:via?[[127,37],[127.05,37.001],[127.1,37]]:[[127,37],[127.1,37]],
});

function points(controller){
  controller.setPoint('origin',{lat:37,lng:127},'출발지');
  controller.setPoint('destination',{lat:37,lng:127.1},'목적지');
}

test('directions proxy response converts milliseconds and rejects incomplete routes',()=>{
  const normalized=normalizeDirectionsResponse(proxyResponse());
  assert.equal(normalized.durationSeconds,600);
  assert.equal(normalized.distanceMeters,10_000);
  assert.throws(()=>normalizeDirectionsResponse({summary:{distance:10,duration:20},path:[]}));
  assert.throws(()=>normalizeDirectionsResponse({summary:{distance:10,duration:20},path:[[127,37],[127.1,37]]}));
});

test('route mode calls the shared directions proxy directly and verifies local candidates',async()=>{
  const requests=[];
  const controller=createRouteModeController({clock:now,requestJSON:async(url,_signal,options)=>{
    assert.equal(url,DIRECTIONS_PROXY);assert.equal(options.method,'POST');
    const body=JSON.parse(options.body);requests.push(body);return proxyResponse({via:body.waypoints.length===1});
  }});points(controller);
  const result=await controller.plan({stations:[station()],fuel:'B027',maxDetourMinutes:10,corridorMeters:2000,option:'traoptimal'});
  assert.equal(result.status,'ready');assert.equal(requests.length,2);
  assert.deepEqual(requests[0],{start:{lat:37,lng:127},goal:{lat:37,lng:127.1},waypoints:[],option:'traoptimal'});
  assert.deepEqual(requests[1].waypoints,[{lat:37.001,lng:127.05}]);
  assert.equal(result.results[0].detour.durationSeconds,180);
  assert.deepEqual(result.results[0].viaPath,[[127,37],[127.05,37.001],[127.1,37]]);
});

test('route mode refreshes the local price while retaining the verified detour',async()=>{
  const controller=createRouteModeController({clock:now,requestJSON:async(_url,_signal,options)=>proxyResponse({via:JSON.parse(options.body).waypoints.length===1})});points(controller);
  await controller.plan({stations:[station()],fuel:'B027',maxDetourMinutes:10,corridorMeters:2000});
  assert.equal(controller.rows({liters:30,kmPerLiter:12,maxDetourMinutes:10})[0].costs.totalWon,null);
  controller.syncStations([station(1500)],'B027');
  const [updated]=controller.rows({liters:30,kmPerLiter:12,referenceFuelWonPerL:1700,maxDetourMinutes:10});
  assert.equal(updated.currentPrice.price,1500);assert.equal(updated.costs.purchaseWon,45_000);assert.ok(updated.costs.totalWon>45_000);assert.equal(updated.routeRank,1);
});

test('base route retries one short transient proxy failure without repeating via checks',async()=>{
  const waits=[];let calls=0;
  const controller=createRouteModeController({clock:now,waitForRetry:async(delay,signal)=>{assert.equal(signal.aborted,false);waits.push(delay);},requestJSON:async(_url,_signal,options)=>{
    calls+=1;
    if(calls===1)throw Object.assign(new Error('경로 서버가 일시적으로 응답하지 않습니다.'),{code:510,retryable:true,retryAfterMs:800});
    return proxyResponse({via:JSON.parse(options.body).waypoints.length===1});
  }});points(controller);
  const result=await controller.plan({stations:[station()],fuel:'B027',maxDetourMinutes:10,corridorMeters:2000});
  assert.equal(result.status,'ready');
  assert.equal(calls,3);
  assert.deepEqual(waits,[800]);
});

test('base route does not retry a point that is not near a road',async()=>{
  let calls=0;
  const controller=createRouteModeController({clock:now,waitForRetry:async()=>assert.fail('waited'),requestJSON:async()=>{
    calls+=1;throw Object.assign(new Error('출발지 또는 목적지가 도로에서 너무 멉니다.'),{code:2,retryable:false});
  }});points(controller);
  await assert.rejects(controller.plan({stations:[station()],fuel:'B027',maxDetourMinutes:10,corridorMeters:2000}),/도로에서 너무 멉니다/);
  assert.equal(calls,1);
  assert.equal(controller.state.error.code,2);
});

test('app forwards structured proxy retry metadata to route mode',()=>{
  assert.match(appSource,/error\.code=data\?\.error\?\.code\?\?data\?\.code/);
  assert.match(appSource,/error\.retryable=data\?\.retryable===true/);
  assert.match(appSource,/error\.retryAfterMs=Number\.isFinite/);
});
