import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {loadStaticJSON,useNationwideData} from '../public/js/data-loader.js';
test('static map data decompresses gzip and repeated map searches reuse the same observation',async()=>{
 let calls=0;const data={status:'partial',fetchedAt:'2026-10-20T11:00:00Z',stations:[{id:'A1'}]};
 const fetchImpl=async url=>{calls++;assert.match(url,/latest\.json\.gz\?v=1$/);return new Response(gzipSync(JSON.stringify(data)));};
 const a=await loadStaticJSON('./test/latest.json?v=1',{fetchImpl});
 const b=await loadStaticJSON('./test/latest.json?v=1',{fetchImpl});
 assert.deepEqual(a,data);assert.equal(a,b);assert.equal(calls,1);
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
 const data={status:'partial',coverage:{serviceReady:true},stations:[{prices:{B027:{price:1750}}}]};
 assert.equal(useNationwideData(data,'B027'),true);assert.equal(useNationwideData(data,'K015'),false);
 assert.equal(useNationwideData({...data,coverage:{serviceReady:false}},'B027'),false);
});
