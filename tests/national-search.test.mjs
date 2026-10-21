import test from 'node:test';
import assert from 'node:assert/strict';
import {filterStations,hasMapCoordinates,stationNavigationURL} from '../public/js/core.js';
import {useNationwideData} from '../public/js/data-loader.js';
const now=Date.parse('2026-10-21T05:00:00Z');
const price={price:1750,unit:'KRW/L',priceTimeStatus:'daily_price_file',priceUpdatedAt:null,sourceDate:'2026-10-20',fetchedAt:'2026-10-20T15:49:00Z'};
const mapped={id:'A1',name:'서울주유소',lat:37.5,lng:127,prices:{B027:price}};
const unmapped={id:'A2',name:'서산주유소',roadAddress:'충청남도 서산시 중앙로 1',lat:null,lng:null,prices:{B027:price}};
const opts={fuel:'B027',center:{lat:37.5,lng:127},now};
test('nearby search excludes missing coordinates while national search keeps their real prices',()=>{
 assert.deepEqual(filterStations([mapped,unmapped],opts).map(s=>s.id),['A1']);
 const all=filterStations([mapped,unmapped],{...opts,scope:'national'});
 assert.equal(all.length,2);assert.equal(all.find(s=>s.id==='A2').currentPrice.price,1750);
 assert.equal(all.find(s=>s.id==='A2').distance,Infinity);assert.equal(hasMapCoordinates(unmapped),false);
});
test('national text search applies province aliases, independent words, fuel, freshness and brand filters',()=>{
 assert.deepEqual(filterStations([mapped,unmapped],{...opts,scope:'national',query:'충남 서산'}).map(s=>s.id),['A2']);
 assert.equal(filterStations([mapped,unmapped],{...opts,scope:'national',query:'서산',fuel:'K015'}).length,0);
 assert.equal(filterStations([unmapped],{...opts,scope:'national',brand:'SKE'}).length,0);
 const stale={...unmapped,prices:{B027:{...price,sourceDate:'2026-10-15'}}};
 assert.equal(filterStations([stale],{...opts,scope:'national'}).length,0);
 assert.equal(filterStations([stale],{...opts,scope:'national',freshOnly:false}).length,1);
});
test('unlocated detail uses address search and never sends null or Infinity as navigation coordinates',()=>{
 const url=stationNavigationURL(unmapped);assert.match(url,/\/link\/search\//);assert.equal(decodeURIComponent(url).includes('충청남도 서산시 중앙로 1'),true);assert.doesNotMatch(url,/null|Infinity/);
 assert.match(stationNavigationURL(mapped),/\/link\/to\/.*37\.5,127$/);
});
test('a complete price list can be searched before the coordinate map readiness threshold is reached',()=>{
 const data={status:'partial',coverage:{serviceReady:false,searchIncludesUnmapped:true},stations:[unmapped]};
 assert.equal(useNationwideData(data,'B027'),false);assert.equal(useNationwideData(data,'B027',{nationalSearch:true}),true);
 assert.equal(useNationwideData(data,'K015',{nationalSearch:true}),false);
});
