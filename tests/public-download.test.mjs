import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDownloadForm, parseCsv, decodeKoreanCsv, OpinetDownloadClient } from '../server/opinet-download.mjs';
import { normalizeStandardStation } from '../server/data-go-stations.mjs';

test('download form parser keeps hidden fields and CSV parser handles quoted commas',()=>{
 const html='<form name="commonForm"><input type="hidden" name="menuNo" value="11"><input type="hidden" name="subMenuNo" value="22"></form>';
 const f=extractDownloadForm(html);assert.equal(f.get('menuNo'),'11');assert.equal(f.get('subMenuNo'),'22');
 const rows=parseCsv('고유번호,상호,주소\r\nA1,"테스트,주유소","서울, 중구"\r\n');
 assert.deepEqual(rows[1],['A1','테스트,주유소','서울, 중구']);
});
test('download client GETs form first, carries cookie, and posts type 5 for current-price CSV',async()=>{
 const calls=[];const csv='고유번호,상호,보통휘발유\r\nA1,테스트주유소,1700\r\n'.repeat(30);
 const client=new OpinetDownloadClient({fetchImpl:async(url,init={})=>{calls.push({url:String(url),init});if(!init.method)return new Response('<form name="commonForm"><input type="hidden" name="menuNo" value="1"></form>',{headers:{'set-cookie':'JSESSIONID=fixture; Path=/'}});return new Response(csv,{headers:{'content-type':'text/csv'}});}});
 const result=await client.download({kind:'current',searchCond:'1'});assert.ok(result.rows.length>1);assert.equal(calls.length,2);assert.match(calls[1].init.body,/type=5/);assert.match(calls[1].init.body,/searchCond=1/);assert.match(calls[1].init.headers.Cookie,/JSESSIONID=fixture/);
});
test('standard station normalizer accepts documented coordinate fields',()=>{
 const s=normalizeStandardStation({conmNm:'테스트',lat:'37.5',lot:'127.1',lctnRoadNm:'서울 테스트로 1',telno:'02-1'});
 assert.equal(s.name,'테스트');assert.equal(s.lat,37.5);assert.equal(s.lng,127.1);
});
