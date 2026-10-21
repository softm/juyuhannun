import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validatePublishedData,verifyPublishedData} from '../scripts/verify-published-data.mjs';

const time=Date.parse('2026-10-22T12:00:00+09:00');
const daily={price:1200,unit:'KRW/L',priceTimeStatus:'daily_price_file',priceUpdatedAt:null,sourceDate:'2026-10-20',fetchedAt:'2026-10-21T00:49:00+09:00'};
const row=(id,prices={B027:daily},coordinates={lat:37.55,lng:126.98})=>({id,name:`주유소 ${id}`,...coordinates,prices});
const snapshot=stations=>({status:'partial',stations});

test('the production gate merges recent regional prices and excludes old bargains from comparable minima',()=>{
 const recent={price:1800,unit:'KRW/L',priceTimeStatus:'reported',priceUpdatedAt:'2026-10-22T10:00:00+09:00',fetchedAt:'2026-10-22T11:00:00+09:00'};
 const nationwide=snapshot([row('shared',{B027:daily,D047:{...daily,price:1000}}),row('old')]);
 const regional=snapshot([row('shared',{B027:recent,K015:{...recent,price:900}})]);
 const original=structuredClone([nationwide,regional]);
 const result=validatePublishedData({nationwide,regional,now:time});
 assert.equal(result.ok,true);assert.equal(result.availability.displayableStationCount,2);assert.equal(result.availability.comparableStationCount,1);
 const gasoline=result.fuels.find(f=>f.code==='B027'),diesel=result.fuels.find(f=>f.code==='D047');
 assert.equal(gasoline.displayableStationCount,2);assert.equal(gasoline.comparableStationCount,1);assert.equal(gasoline.lowestComparablePrice,1800);
 assert.equal(diesel.comparableStationCount,0);assert.equal(diesel.lowestComparablePrice,null);
 assert.deepEqual([nationwide,regional],original);
});
test('only historical prices still pass a recovery deployment at midnight with an explicit warning',()=>{
 const national=snapshot([row('daily')]);
 const before=validatePublishedData({nationwide:national,now:Date.parse('2026-10-21T23:59:59+09:00')});
 const after=validatePublishedData({nationwide:national,now:Date.parse('2026-10-22T00:00:00+09:00')});
 assert.equal(before.ok,true);assert.equal(after.ok,true);assert.equal(before.availability.displayableStationCount,1);assert.equal(after.availability.displayableStationCount,1);
 assert.equal(before.availability.comparableStationCount,1);assert.equal(after.availability.comparableStationCount,0);
 assert.equal(after.fuels.find(f=>f.code==='B027').lowestComparablePrice,null);assert.ok(after.warnings.some(w=>w.code==='NO_COMPARABLE_PRICES'));
});
test('unmapped-only data and corrupted published identities or price shapes fail the production gate',()=>{
 const unmapped=validatePublishedData({nationwide:snapshot([row('unmapped',undefined,{lat:null,lng:null})]),now:time});
 assert.equal(unmapped.ok,false);assert.equal(unmapped.availability.unmappedPricedStationCount,1);assert.ok(unmapped.errors.some(e=>e.code==='NO_DISPLAYABLE_PRICES'));
 for(const [stations,code] of [
  [[row('same'),row('same')],'DUPLICATE_STATION_ID'],
  [[row('invalid',[])],'INVALID_PRICES_OBJECT'],
  [[row('invalid',{B027:{price:'1200',unit:'KRW/L'}})],'INVALID_PRICE_AMOUNT'],
  [[row('invalid',{B027:{price:1200,unit:'USD/L'}})],'INVALID_PRICE_UNIT'],
  [[row('invalid',undefined,{lat:0,lng:0})],'INVALID_COORDINATES'],
 ]){
  const result=validatePublishedData({nationwide:snapshot(stations),now:time});
  assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.code===code),code);
 }
});
test('local verification falls back from absent search to latest and reports malformed JSON without network access',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'juyu-availability-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'nationwide'));
 await writeFile(join(dir,'nationwide','latest.json'),JSON.stringify(snapshot([row('last-good')])));
 await writeFile(join(dir,'stations.json'),JSON.stringify(snapshot([])));
 const result=await verifyPublishedData({dataRoot:dir,now:time});
 assert.equal(result.ok,true);assert.equal(result.files.nationwide,'nationwide/latest.json');assert.equal(result.availability.displayableStationCount,1);
 await writeFile(join(dir,'nationwide','search.json'),'{broken');
 const broken=await verifyPublishedData({dataRoot:dir,now:time});
 assert.equal(broken.ok,false);assert.ok(broken.errors.some(e=>e.code==='INVALID_DATA_FILE'));assert.equal(broken.availability.displayableStationCount,1);
});
