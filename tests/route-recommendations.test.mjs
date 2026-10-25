import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
import {NaverRouteClient,parseRecommendationsRequest} from '../server/route.mjs';
import {StationSnapshotStore} from '../server/station-snapshot.mjs';

const clock=()=>Date.parse('2026-10-26T03:00:00Z');
const price=(value,updated='2026-10-26T02:00:00Z')=>({price:value,priceUpdatedAt:updated,fetchedAt:'2026-10-26T02:30:00Z'});
const routePayload=({option='traoptimal',distance=20_000,duration=1_200_000,toll=1_000,path=[[127,37],[127.05,37],[127.1,37]]}={})=>({code:0,route:{[option]:[{summary:{distance,duration,tollFare:toll},path}]}});
const body={origin:{lat:37,lng:127},destination:{lat:37,lng:127.1},fuel:'B027',liters:30,kmPerLiter:12,referenceFuelWonPerL:1700,hourlyValueWonPerHour:0,maxDetourMinutes:10,corridorMeters:2000,option:'traavoidtoll',candidateIds:[]};

test('recommendations reuse one base route, verify a diverse bounded shortlist and rank only valid detours',async()=>{
  let calls=0;
  const client=new NaverRouteClient({apiKeyId:'id',apiKey:'secret',clock,recommendationLimit:8,fetchImpl:async url=>{
    calls+=1;const parsed=new URL(url),option=parsed.searchParams.get('option');assert.equal(option,'traavoidtoll');
    const via=parsed.searchParams.get('waypoints');
    if(!via)return new Response(JSON.stringify(routePayload({option})),{status:200});
    if(via.startsWith('127.02,'))return new Response(JSON.stringify(routePayload({option,distance:21_000,duration:1_440_000,toll:500})),{status:200});
    return new Response(JSON.stringify(routePayload({option,distance:25_000,duration:2_100_000,toll:1_200})),{status:200});
  }});
  const stations=[
    {id:'near',name:'경로 앞 주유소',lat:37.001,lng:127.02,prices:{B027:price(1650)}},
    {id:'slow',name:'큰 우회 주유소',lat:37.001,lng:127.08,prices:{B027:price(1500)}},
    {id:'stale',name:'오래된 가격',lat:37.001,lng:127.05,prices:{B027:price(1200,'2026-10-20T00:00:00Z')}},
  ];
  const result=await client.recommendations({request:body,stations,coverage:{complete:false},snapshotRevision:'fixture'});
  assert.equal(result.status,'ready');
  assert.equal(result.candidateCount,3);
  assert.equal(result.attemptedCount,2);
  assert.equal(result.checkedCount,2);
  assert.equal(calls,3);
  assert.equal(result.results.find(row=>row.stationId==='near').rank,1);
  assert.equal(result.results.find(row=>row.stationId==='near').detour.tollWon,-500);
  assert.equal(result.results.find(row=>row.stationId==='slow').rank,null);
  assert.equal(result.results.find(row=>row.stationId==='stale').detour.verified,false);
  assert.equal(result.results.find(row=>row.stationId==='stale').rank,null);
  assert.ok(result.results.find(row=>row.stationId==='near').costs.totalWon>0);
  const cached=await client.recommendations({request:body,stations,coverage:{complete:false},snapshotRevision:'fixture'});
  assert.equal(cached.cache.hit,true);assert.equal(calls,3);
});

test('recommendation input is bounded before route quota or station lookup',()=>{
  assert.throws(()=>parseRecommendationsRequest({...body,candidateIds:Array.from({length:13},(_,index)=>`s${index}`)}),{code:'INVALID_RECOMMENDATION_INPUT'});
  assert.throws(()=>parseRecommendationsRequest({...body,corridorMeters:9_999}),{code:'INVALID_RECOMMENDATION_INPUT'});
  assert.throws(()=>parseRecommendationsRequest({...body,option:'invented'}),{code:'INVALID_ROUTE_OPTION'});
  assert.equal(parseRecommendationsRequest({...body,liters:null,kmPerLiter:null}).liters,null);
});

function requestFor({method='POST',payload=body,contentType='application/json'}={}){
  const request=Readable.from(method==='POST'?[JSON.stringify(payload)]:[]);
  Object.assign(request,{url:'/api/route/recommendations',method,headers:{'content-type':contentType},socket:{remoteAddress:'127.0.0.1'}});
  return request;
}

async function dispatch(handler,request){
  let status,bodyText='';const headers={};
  await handler(request,{setHeader(name,value){headers[name]=value;},writeHead(value,more){status=value;Object.assign(headers,more);},end(value){bodyText=value?.toString()||'';}});
  return {status,headers,body:bodyText?JSON.parse(bodyText):null};
}

test('recommendations endpoint is POST-only and returns an explicit unconfigured state without loading a station copy',async()=>{
  let recommendationCalls=0;
  const routeClient={configured:false,recommendations:async({request})=>{recommendationCalls+=1;assert.equal(request.fuel,'B027');return{status:'unavailable',provider:'naver',results:[],error:{code:'NAVER_CREDENTIALS_REQUIRED',message:'설정 필요'}};}};
  const handler=createApp({env:{},clock,routeClient,stationSnapshotStore:{load:async()=>{throw new Error('must not load');}}});
  const get=await dispatch(handler,requestFor({method:'GET'}));assert.equal(get.status,405);
  const post=await dispatch(handler,requestFor());assert.equal(post.status,200);assert.equal(post.body.status,'unavailable');assert.equal(recommendationCalls,1);
  const invalidType=await dispatch(handler,requestFor({contentType:'text/plain'}));assert.equal(invalidType.status,415);assert.equal(invalidType.body.provider,'naver');
});

test('server station lookup falls back from a malformed search index to the complete latest snapshot',async()=>{
  const root=await mkdtemp(join(tmpdir(),'juyuhannun-route-snapshot-'));
  try{
    const directory=join(root,'public/data/nationwide');await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'search.json'),'{half-published','utf8');
    await writeFile(join(directory,'latest.json'),JSON.stringify({status:'ready',provider:'opinet',fetchedAt:'2026-10-26T02:30:00Z',stations:[{id:'fallback',name:'정상 스냅샷',lat:37,lng:127,prices:{B027:price(1650)}}]}),'utf8');
    const snapshot=await new StationSnapshotStore({projectRoot:root,clock}).load();
    assert.equal(snapshot.stations.length,1);assert.equal(snapshot.stations[0].id,'fallback');
  }finally{await rm(root,{recursive:true,force:true});}
});
