import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDownloadForm, parseCsv, parseDailyPriceCsv, decodeKoreanCsv, OpinetDownloadClient } from '../server/opinet-download.mjs';
import { normalizeStandardStation, parseStandardStationCsv, fetchStandardStationsPublic } from '../server/data-go-stations.mjs';

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

test('historical daily CSV parser keeps the documented nationwide price column order',()=>{
 const csv='제목\r\n"고유번호","지역","상호","주소","기준일자","상표","셀프","고급휘발유","보통휘발유","경유","등유"\r\n"A001","서울 중구","테스트주유소","서울 중구 테스트로 1","20261020","SK","셀프","1999","1799","1699","1399"\r\n';
 const rows=parseDailyPriceCsv(csv);
 assert.equal(rows.length,1);
 assert.equal(rows[0]['고유번호'],'A001');
 assert.equal(rows[0]['기준일자'],'20261020');
 assert.equal(rows[0]['보통휘발유'],'1799');
 assert.equal(rows[0]['경유'],'1699');
});

test('standard station CSV parser accepts the public Korean headers',()=>{
 const header='주유소명,시도명,시군구명,소재지도로명주소,소재지지번주소,전화번호,위도,경도,상표구분명,데이터기준일자\r\n';
 const body=Array.from({length:1001},(_,i)=>`테스트${i},서울특별시,중구,서울특별시 중구 테스트로 ${i},,02-1,37.5,127.1,SK,2026-10-01`).join('\r\n');
 const rows=parseStandardStationCsv(header+body);
 assert.equal(rows.length,1001);
 assert.equal(rows[0].name,'테스트0');
 assert.equal(rows[0].lat,37.5);
});

test('public data-go grid fetcher reads the keyless header contract and nationwide station rows',async()=>{
 const header={fileName:'전국주유소표준데이터',totalCount:1001,tableVO:{svcTableNm:'tn_pubr_public_conm_svc',colNmList:['CONM_NM','CTPV_NM','SGG_NM','LCTN_ROAD_NM','TELNO','LAT','LOT','DATA_CRTR_YMD']}};
 const rows=Array.from({length:1001},(_,i)=>({CONM_NM:`테스트${i}`,CTPV_NM:'서울특별시',SGG_NM:'중구',LCTN_ROAD_NM:`서울특별시 중구 테스트로 ${i}`,TELNO:'02-1',LAT:'37.5',LOT:'127.1',DATA_CRTR_YMD:'2026-10-01'}));
 const calls=[];
 const result=await fetchStandardStationsPublic({fetchImpl:async url=>{calls.push(String(url));return new Response(JSON.stringify(calls.length===1?header:rows),{headers:{'Content-Type':'application/json'}});}});
 assert.equal(result.status,'ready');
 assert.equal(result.stations.length,1001);
 assert.equal(result.calls,2);
 assert.match(calls[0],/columList\.json\?pk=15129441&ext=CSV/);
 assert.match(calls[1],/standard\.json/);
 assert.match(calls[1],/colNmList=CONM_NM/);
});
