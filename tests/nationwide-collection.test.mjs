import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {coordinateIndex,locateStation,collectNationwide} from '../scripts/collect-nationwide.mjs';
import {ServiceError} from '../server/errors.mjs';
import {summarizeData} from '../scripts/data-status.mjs';

const station={name:'테스트주유소',lat:37.55,lng:126.98,roadAddress:'서울특별시 중구 테스트로 1',address:'서울 중구 테스트동 1',phone:'02-123-4567'};
test('repeated seed/master/latest/fresh rows and both addresses retain one coordinate candidate',()=>{
 const index=coordinateIndex([station,{...station},{...station},{...station}]);
 assert.equal(locateStation({name:'테스트주유소',address:'서울 중구 테스트로 1'},index)?.lat,37.55);
 assert.equal(locateStation({name:'테스트주유소',region:'서울 중구'},index)?.lng,126.98);
 assert.equal(locateStation({phone:'02-123-4567'},index)?.lat,37.55);
 assert.equal(locateStation({name:'다른 이름',address:'서울 중구 테스트로 1'},index)?.lat,37.55);
});
test('conflicting distinct candidates and empty addresses never manufacture a match',()=>{
 const other={...station,lat:37.6,lng:127.1};
 const index=coordinateIndex([station,other,station]);
 assert.equal(locateStation({name:station.name,phone:station.phone,address:station.roadAddress,region:'서울 중구'},index),null);
 const noAddress=coordinateIndex([{name:'주소없음',lat:37.5,lng:127}]);
 assert.equal(locateStation({name:'주소없음',region:''},noAddress),null);
 assert.equal(locateStation({phone:station.phone},coordinateIndex([{...station,lat:91}])),null);
});
test('province aliases match the public road address',()=>{
 const index=coordinateIndex([{...station,roadAddress:'강원특별자치도 춘천시 테스트로 10',address:null}]);
 assert.equal(locateStation({name:station.name,address:'강원 춘천시 테스트로 10'},index)?.lat,station.lat);
});

test('collect, reuse and failed refresh preserve observations and visible failure metadata',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'juyu-nationwide-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const now=Date.parse('2026-10-20T11:00:00Z'),fetchedAt=new Date(now).toISOString();
 await writeFile(join(dir,'coordinate-seed.json'),JSON.stringify({stations:[station]}));
 const downloadClient={dailyPrices:async({targetDate})=>{if(targetDate==='20261020')throw new ServiceError('OPINET_DOWNLOAD_FAILED','당일 파일 미수신');return {rows:[{'고유번호':'A1','상호':station.name,'주소':'서울 중구 테스트로 1','보통휘발유':'1750','경유':'1650'},{'고유번호':'A2','상호':'서산미좌표주유소','주소':'충남 서산시 중앙로 1','보통휘발유':'1730'}],sourceDate:'20261019',bytes:123};}};
 const options={outputDirectory:dir,nearbyPath:join(dir,'nearby.json'),clock:()=>now,minRows:1,fetchImpl:async()=>{throw new Error('offline');},downloadClient};
 const first=await collectNationwide(options);assert.equal(first.count,1);assert.equal(first.total,2);
 const searchable=JSON.parse(await readFile(join(dir,'search.json'),'utf8'));assert.equal(searchable.stations.length,2);assert.equal(searchable.stations[1].lat,null);assert.equal(searchable.stations[1].prices.B027.price,1730);
 const reused=await collectNationwide({...options,clock:()=>now+10000,downloadClient:{dailyPrices:()=>{throw new Error('must reuse');}}});
 assert.equal(reused.count,1);assert.equal(reused.fetchedAt,fetchedAt);assert.equal(reused.priceSource,'cache');
 assert.equal(reused.collection.usedPreviousDate,true);assert.equal(reused.collection.lastDownloadStatus,'fallback');assert.equal(reused.collection.downloadCalls,0);assert.equal(reused.collection.nextRetryAt,'2026-10-20T11:37:00.000Z');
 const stored=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));assert.equal(stored.stations[0].prices.B027.priceUpdatedAt,null);assert.equal(stored.stations[0].prices.B027.sourceDate,'2026-10-19');
 await assert.rejects(collectNationwide({...options,forceRefresh:true,downloadClient:{dailyPrices:async()=>{throw new ServiceError('OPINET_DOWNLOAD_FAILED','공개 가격 다운로드 실패');}}}),{code:'OPINET_DOWNLOAD_FAILED'});
 const failed=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));
 assert.equal(failed.fetchedAt,fetchedAt);assert.equal(failed.stations[0].prices.B027.price,1750);assert.equal(failed.cache.stale,true);assert.equal(failed.lastAttempt.status,'error');
 assert.equal(JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')).lastAttempt.error.code,'OPINET_DOWNLOAD_FAILED');
 const failedSearch=JSON.parse(await readFile(join(dir,'search.json'),'utf8'));assert.equal(failedSearch.stations.length,2);assert.equal(failedSearch.fetchedAt,fetchedAt);assert.equal(failedSearch.cache.stale,true);
});
test('nationwide public download merges automotive LPG prices without using the limited API',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'juyu-lpg-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const now=Date.parse('2026-10-30T01:00:00Z');
 const lpgStation={...station,name:'테스트LPG충전소',roadAddress:'서울특별시 중구 테스트로 2',address:'서울 중구 테스트동 2'};
 await writeFile(join(dir,'coordinate-seed.json'),JSON.stringify({stations:[lpgStation]}));
 const calls=[];
 const downloadClient={
  dailyPrices:async({targetDate})=>({rows:[{'고유번호':'A1','상호':station.name,'주소':station.address,'기준일자':targetDate,'보통휘발유':'1750'}],sourceDate:targetDate,bytes:100}),
  dailyLpgPrices:async({targetDate})=>{calls.push(['lpg-price',targetDate]);return {rows:[{'고유번호':'L1','상호':lpgStation.name,'주소':lpgStation.address,'기준일자':targetDate,'자동차부탄':'1123'}],sourceDate:targetDate,bytes:50};},
  businessLpgInfo:async()=>{calls.push(['lpg-business']);return {rows:[{'고유번호':'L1','상호':lpgStation.name,'주소':lpgStation.address,'상표':'SK가스'}],bytes:25};},
 };
 const result=await collectNationwide({outputDirectory:dir,nearbyPath:join(dir,'nearby.json'),clock:()=>now,minRows:1,fetchImpl:async()=>{throw new Error('offline');},downloadClient});
 assert.equal(result.total,2);
 const searchable=JSON.parse(await readFile(join(dir,'search.json'),'utf8'));
 const lpg=searchable.stations.find(row=>row.id==='L1');
 assert.equal(lpg.prices.K015.price,1123);assert.equal(lpg.kind,'lpg');
 const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
 assert.equal(manifest.lpg.status,'ready');assert.equal(manifest.lpg.priceCount,1);assert.equal(manifest.lpg.businessInfo.count,1);
 assert.deepEqual(calls,[['lpg-business'],['lpg-price','20261030']]);
});
test('status distinguishes total prices, mapped records, quota and a failed source from a successful build',()=>{
 const d=summarizeData({manifest:{priceStationCount:10238,priceDate:'2026-10-19'},nationwide:{status:'partial',stations:[{id:'A1',...station,prices:{B027:{price:1750}}}],coverage:{serviceReady:true,complete:false}},regional:{status:'partial',quota:{used:300,limit:300,remaining:0},lastAttempt:{status:'error'},error:{code:'OPINET_DAILY_QUOTA_EXCEEDED',message:'한도 소진'}}});
 assert.equal(d.activeMap,'nationwide');assert.equal(d.nationwide.totalPriceStations,10238);assert.equal(d.nationwide.mappedPriceStations,1);assert.equal(d.nationwide.unmappedPriceStations,10237);assert.equal(d.quota.remaining,0);assert.equal(d.collections.find(row=>row.id==='regional').retained,true);assert.equal(d.fuels[0].mappedStationCount,1);
 const missing=summarizeData();assert.equal(missing.activeMap,'regional');assert.equal(missing.nationwide.totalPriceStations,0);assert.equal(missing.collections[0].status,'error');
});

const dailyRows=(date,price='1750')=>({rows:[{'고유번호':'A1','상호':station.name,'주소':'서울 중구 테스트로 1','기준일자':date,'보통휘발유':price}],sourceDate:date,bytes:123});
async function collectionFixture(t,now){
 const dir=await mkdtemp(join(tmpdir(),'juyu-freshness-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'coordinate-seed.json'),JSON.stringify({stations:[station]}));
 return {outputDirectory:dir,nearbyPath:join(dir,'nearby.json'),clock:()=>now,minRows:1,fetchImpl:async()=>{throw new Error('offline');}};
}
test('a previous-day price collected today is downloaded again at the evening refresh window',async t=>{
 const start=Date.parse('2026-10-21T00:49:00+09:00'),options=await collectionFixture(t,start),calls=[];
 await collectNationwide({...options,downloadClient:{dailyPrices:async({targetDate})=>{if(targetDate==='20261021')throw new ServiceError('OPINET_DOWNLOAD_FAILED','not ready');return dailyRows(targetDate);}}});
 // Reproduce the legacy cache: history is labelled by collection day even
 // though every price in it belongs to yesterday, and search.json is absent.
 const oldHistory=JSON.parse(await readFile(join(options.outputDirectory,'history','2026-10-20.json'),'utf8'));
 await writeFile(join(options.outputDirectory,'history','2026-10-21.json'),JSON.stringify({...oldHistory,date:'2026-10-21'}));
 const oldManifest=JSON.parse(await readFile(join(options.outputDirectory,'manifest.json'),'utf8'));
 await writeFile(join(options.outputDirectory,'manifest.json'),JSON.stringify({...oldManifest,historyDate:'2026-10-21',collection:undefined}));
 await rm(join(options.outputDirectory,'search.json'));
 const evening=await collectNationwide({...options,clock:()=>Date.parse('2026-10-21T21:48:00+09:00'),downloadClient:{dailyPrices:async({targetDate})=>{calls.push(targetDate);return dailyRows(targetDate,'1760');}}});
 assert.deepEqual(calls,['20261021']);assert.equal(evening.priceSource,'download');assert.equal(evening.priceDate,'2026-10-21');
 assert.equal(evening.collection.lastDownloadStatus,'ready');assert.equal(evening.collection.lastDownloadError,null);
 const saved=JSON.parse(await readFile(join(options.outputDirectory,'search.json'),'utf8'));
 assert.equal(saved.stations[0].prices.B027.price,1760);assert.equal(saved.stations[0].prices.B027.sourceDate,'2026-10-21');
 const history=JSON.parse(await readFile(join(options.outputDirectory,'history','2026-10-20.json'),'utf8'));
 assert.equal(history.date,'2026-10-20');assert.equal(history.collectedOn,'2026-10-21');
});
test('late fallback and failed retries preserve observations, expose failure, and wait before another download',async t=>{
 const start=Date.parse('2026-10-21T20:40:00+09:00'),options=await collectionFixture(t,start);
 const initial=await collectNationwide({...options,downloadClient:{dailyPrices:async({targetDate})=>{if(targetDate==='20261021')throw new ServiceError('OPINET_DOWNLOAD_FAILED','not ready');return dailyRows(targetDate);}}});
 assert.equal(initial.collection.nextRetryAt,'2026-10-21T13:40:00.000Z');
 const failedAt=Date.parse('2026-10-21T21:00:00+09:00');
 await assert.rejects(collectNationwide({...options,clock:()=>failedAt,forceRefresh:true,downloadClient:{dailyPrices:async()=>{throw new ServiceError('OPINET_DOWNLOAD_FAILED','download failed');}}}),{code:'OPINET_DOWNLOAD_FAILED'});
 const cached=await collectNationwide({...options,clock:()=>failedAt+60000,downloadClient:{dailyPrices:async()=>{throw new Error('must back off');}}});
 assert.equal(cached.fetchedAt,initial.fetchedAt);assert.equal(cached.collection.decisionReason,'retry_backoff');assert.equal(cached.collection.lastDownloadStatus,'error');
 assert.equal(cached.collection.nextRetryAt,'2026-10-21T14:00:00.000Z');assert.equal(cached.collection.lastDownloadError.code,'OPINET_DOWNLOAD_FAILED');
 const saved=JSON.parse(await readFile(join(options.outputDirectory,'search.json'),'utf8'));
 assert.equal(saved.lastAttempt.status,'error');assert.equal(saved.cache.stale,true);assert.equal(saved.stations[0].prices.B027.fetchedAt,initial.fetchedAt);
 const requests=[];
 await collectNationwide({...options,clock:()=>failedAt+2*60*60*1000,downloadClient:{dailyPrices:async({targetDate})=>{requests.push(targetDate);return dailyRows(targetDate);}}});
 assert.deepEqual(requests,['20261021']);
});
test('a cached price survives midnight without being relabelled as newly collected',async t=>{
 const start=Date.parse('2026-10-21T22:00:00+09:00'),options=await collectionFixture(t,start);
 const first=await collectNationwide({...options,downloadClient:{dailyPrices:async({targetDate})=>dailyRows(targetDate)}});
 const next=await collectNationwide({...options,clock:()=>Date.parse('2026-10-22T00:37:00+09:00'),downloadClient:{dailyPrices:async()=>{throw new Error('existing yesterday price is still usable');}}});
 assert.equal(next.priceSource,'cache');assert.equal(next.priceDate,'2026-10-21');assert.equal(next.fetchedAt,first.fetchedAt);assert.equal(next.collection.eligible,true);
 assert.equal(next.collection.nextRetryAt,'2026-10-22T11:37:00.000Z');
});
test('official ID coordinate enrichment adds map coverage without changing price observations',async t=>{
 const start=Date.parse('2026-10-21T10:00:00+09:00'),options=await collectionFixture(t,start);
 const first=await collectNationwide({...options,downloadClient:{dailyPrices:async({targetDate})=>({rows:[...dailyRows(targetDate).rows,{'고유번호':'A2','상호':'좌표없는주유소','주소':'충남 서산시 새길 1','보통휘발유':'1700'}],sourceDate:targetDate,bytes:123})}});
 assert.equal(first.count,1);
 const verifiedAt='2026-10-21T01:01:00.000Z';
 await writeFile(join(options.outputDirectory,'coordinate-enrichment.json'),JSON.stringify({stations:[{id:'A2',name:'다른 표기',lat:36.78,lng:126.45,coordinateSource:'opinet-detail-by-id',verifiedAt}]}));
 const next=await collectNationwide({...options,clock:()=>start+120000,downloadClient:{dailyPrices:async()=>{throw new Error('coordinate refresh cannot renew price');}}});
 assert.equal(next.count,2);assert.equal(next.fetchedAt,first.fetchedAt);
 const saved=JSON.parse(await readFile(join(options.outputDirectory,'latest.json'),'utf8')).stations.find(s=>s.id==='A2');
 assert.equal(saved.lat,36.78);assert.equal(saved.coordinateSource,'opinet-detail-by-id');assert.equal(saved.coordinateVerifiedAt,verifiedAt);assert.equal(saved.prices.B027.fetchedAt,first.fetchedAt);assert.equal(saved.prices.B027.sourceDate,'2026-10-21');
});
test('a mismatched or future source date cannot overwrite the last successful nationwide file',async t=>{
 const start=Date.parse('2026-10-21T10:00:00+09:00'),options=await collectionFixture(t,start);
 const first=await collectNationwide({...options,downloadClient:{dailyPrices:async({targetDate})=>dailyRows(targetDate)}});
 await assert.rejects(collectNationwide({...options,forceRefresh:true,clock:()=>start+60000,downloadClient:{dailyPrices:async()=>dailyRows('20261022','9999')}}),{code:'OPINET_DOWNLOAD_DATE_MISMATCH'});
 const saved=JSON.parse(await readFile(join(options.outputDirectory,'search.json'),'utf8'));
 assert.equal(saved.stations[0].prices.B027.price,1750);assert.equal(saved.fetchedAt,first.fetchedAt);assert.equal(saved.collection.lastDownloadStatus,'error');
});
test('new official coordinates are published even when both price download dates fail',async t=>{
 const start=Date.parse('2026-10-21T10:00:00+09:00'),options=await collectionFixture(t,start);
 const first=await collectNationwide({...options,downloadClient:{dailyPrices:async({targetDate})=>({rows:[...dailyRows(targetDate).rows,{'고유번호':'A2','상호':'서산주유소','주소':'충남 서산시 새길 2','보통휘발유':'1700'}],sourceDate:targetDate,bytes:123})}});
 const verifiedAt='2026-10-21T01:01:00.000Z';
 await writeFile(join(options.outputDirectory,'coordinate-enrichment.json'),JSON.stringify({stations:[{id:'A2',name:'서산주유소',lat:36.78,lng:126.45,coordinateSource:'opinet-detail-by-id',verifiedAt}]}));
 await assert.rejects(collectNationwide({...options,forceRefresh:true,clock:()=>start+120000,downloadClient:{dailyPrices:async()=>{throw new ServiceError('OPINET_DOWNLOAD_FAILED','failed');}}}),{code:'OPINET_DOWNLOAD_FAILED'});
 const latest=JSON.parse(await readFile(join(options.outputDirectory,'latest.json'),'utf8'));
 const manifest=JSON.parse(await readFile(join(options.outputDirectory,'manifest.json'),'utf8'));
 assert.equal(latest.stations.length,2);assert.equal(manifest.mappedPriceStationCount,2);
 const enriched=latest.stations.find(s=>s.id==='A2');
 assert.equal(enriched.coordinateSource,'opinet-detail-by-id');assert.equal(enriched.prices.B027.price,1700);assert.equal(enriched.prices.B027.sourceDate,'2026-10-21');
 assert.equal(enriched.prices.B027.fetchedAt,first.fetchedAt);assert.equal(latest.fetchedAt,first.fetchedAt);assert.equal(latest.collection.lastDownloadStatus,'error');assert.equal(latest.lastAttempt.status,'error');assert.equal(latest.cache.stale,true);
});

