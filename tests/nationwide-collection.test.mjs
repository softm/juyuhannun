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
 const downloadClient={dailyPrices:async()=>({rows:[{'고유번호':'A1','상호':station.name,'주소':'서울 중구 테스트로 1','보통휘발유':'1750','경유':'1650'},{'고유번호':'A2','상호':'서산미좌표주유소','주소':'충남 서산시 중앙로 1','보통휘발유':'1730'}],sourceDate:'20261019',bytes:123})};
 const options={outputDirectory:dir,nearbyPath:join(dir,'nearby.json'),clock:()=>now,minRows:1,fetchImpl:async()=>{throw new Error('offline');},downloadClient};
 const first=await collectNationwide(options);assert.equal(first.count,1);assert.equal(first.total,2);
 const searchable=JSON.parse(await readFile(join(dir,'search.json'),'utf8'));assert.equal(searchable.stations.length,2);assert.equal(searchable.stations[1].lat,null);assert.equal(searchable.stations[1].prices.B027.price,1730);
 const reused=await collectNationwide({...options,clock:()=>now+10000,downloadClient:{dailyPrices:()=>{throw new Error('must reuse');}}});
 assert.equal(reused.count,1);assert.equal(reused.fetchedAt,fetchedAt);assert.equal(reused.priceSource,'same_day_cache');
 const stored=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));assert.equal(stored.stations[0].prices.B027.priceUpdatedAt,null);assert.equal(stored.stations[0].prices.B027.sourceDate,'2026-10-19');
 await assert.rejects(collectNationwide({...options,forceRefresh:true,downloadClient:{dailyPrices:async()=>{throw new ServiceError('OPINET_DOWNLOAD_FAILED','공개 가격 다운로드 실패');}}}),{code:'OPINET_DOWNLOAD_FAILED'});
 const failed=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));
 assert.equal(failed.fetchedAt,fetchedAt);assert.equal(failed.stations[0].prices.B027.price,1750);assert.equal(failed.cache.stale,true);assert.equal(failed.lastAttempt.status,'error');
 assert.equal(JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')).lastAttempt.error.code,'OPINET_DOWNLOAD_FAILED');
 const failedSearch=JSON.parse(await readFile(join(dir,'search.json'),'utf8'));assert.equal(failedSearch.stations.length,2);assert.equal(failedSearch.fetchedAt,fetchedAt);assert.equal(failedSearch.cache.stale,true);
});
test('status distinguishes total prices, mapped records, quota and a failed source from a successful build',()=>{
 const d=summarizeData({manifest:{priceStationCount:10238,priceDate:'2026-10-19'},nationwide:{status:'partial',stations:[{...station,prices:{B027:{price:1750}}}],coverage:{serviceReady:true,complete:false}},regional:{status:'partial',quota:{used:300,limit:300,remaining:0},lastAttempt:{status:'error'},error:{code:'OPINET_DAILY_QUOTA_EXCEEDED',message:'한도 소진'}}});
 assert.equal(d.activeMap,'nationwide');assert.equal(d.nationwide.totalPriceStations,10238);assert.equal(d.nationwide.mappedPriceStations,1);assert.equal(d.nationwide.unmappedPriceStations,10237);assert.equal(d.quota.remaining,0);assert.equal(d.collections.find(row=>row.id==='regional').retained,true);assert.equal(d.fuels[0].mappedStationCount,1);
 const missing=summarizeData();assert.equal(missing.activeMap,'regional');assert.equal(missing.nationwide.totalPriceStations,0);assert.equal(missing.collections[0].status,'error');
});
