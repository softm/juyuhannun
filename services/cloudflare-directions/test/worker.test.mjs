import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.mjs';
const url='https://example.workers.dev/directions';
const headers={Origin:'https://softm.github.io','Content-Type':'application/json'};
test('Worker handles browser preflight and rejects unknown origins',async()=>{
 const pre=await worker.fetch(new Request(url,{method:'OPTIONS',headers}),{});assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),headers.Origin);
 assert.equal((await worker.fetch(new Request(url,{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}),{})).status,403);
});
test('Worker limits actual body size and rejects malformed JSON before routing',async()=>{
 assert.equal((await worker.fetch(new Request(url,{method:'POST',headers,body:'x'.repeat(17000)}),{})).status,413);
 assert.equal((await worker.fetch(new Request(url,{method:'POST',headers,body:'{' }),{})).status,400);
});
test('Worker returns safe configuration error with CORS',async()=>{
 const r=await worker.fetch(new Request(url,{method:'POST',headers,body:'{}'}),{});assert.equal(r.status,503);assert.equal((await r.json()).code,'DIRECTIONS_NOT_CONFIGURED');
});
