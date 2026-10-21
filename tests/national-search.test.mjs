import test from 'node:test';
import assert from 'node:assert/strict';
import {filterStations,stationNavigationURL} from '../public/js/core.js';
import {useNationwideData} from '../public/js/data-loader.js';
import {MapController} from '../public/js/map.js';
const now=Date.parse('2026-10-21T05:00:00Z');
const price={price:1750,unit:'KRW/L',priceTimeStatus:'daily_price_file',priceUpdatedAt:null,sourceDate:'2026-10-20',fetchedAt:'2026-10-20T15:49:00Z'};
const seoul={id:'A1',name:'서울주유소',lat:37.5,lng:127,brand:'SOL',facilities:{self:true},prices:{B027:price}};
const seosan={id:'A2',name:'서산주유소',roadAddress:'충청남도 서산시 중앙로 1',lat:36.78,lng:126.45,prices:{B027:{...price,price:1650}}};
const unmapped={...seosan,id:'unknown',lat:null,lng:null};
const wide={south:33,north:39,west:124,east:132};
const local={south:37.4,north:37.6,west:126.9,east:127.1};
const opts={fuel:'B027',center:{lat:37.5,lng:127},bounds:local,now};

test('same-center zoom changes results by the rectangular viewport, including stations beyond 5km',()=>{
 const rows=[seoul,seosan,unmapped];
 assert.deepEqual(filterStations(rows,opts).map(s=>s.id),['A1']);
 assert.deepEqual(filterStations(rows,{...opts,bounds:wide}).map(s=>s.id),['A2','A1']);
 assert.equal(filterStations(rows,{...opts,bounds:wide}).find(s=>s.id==='A2').distance>5000,true);
 assert.deepEqual(filterStations(rows,opts).map(s=>s.id),['A1']);
});
test('panning changes result rows and lowest price with no national/nearby mode',()=>{
 const rows=[seoul,seosan];
 const left=filterStations(rows,opts),right=filterStations(rows,{...opts,bounds:{south:36.7,north:36.9,west:126.3,east:126.6}});
 assert.deepEqual(left.map(s=>s.id),['A1']);assert.equal(left[0].currentPrice.price,1750);
 assert.deepEqual(right.map(s=>s.id),['A2']);assert.equal(right[0].currentPrice.price,1650);
});
test('viewport edges are inclusive and corners are not replaced by a circular radius',()=>{
 const corner={...seosan,id:'corner',lat:local.north,lng:local.east};
 const outside={...seosan,id:'outside',lat:local.north+0.000001,lng:local.east};
 assert.deepEqual(filterStations([corner,outside],opts).map(s=>s.id),['corner']);
});
test('missing or invalid map bounds cannot accidentally show every nationwide station',()=>{
 for(const bounds of [undefined,null,{}, {...local,north:NaN},{...local,north:local.south},{...local,east:local.west}])assert.deepEqual(filterStations([seoul,seosan],{...opts,bounds}),[]);
 assert.deepEqual(filterStations([unmapped],{...opts,bounds:wide}),[]);
});
test('text, fuel, freshness, brand, self-service and favorites remain within the viewport',()=>{
 const rows=[seoul,seosan,unmapped];
 assert.equal(filterStations(rows,{...opts,query:'충남 서산'}).length,0);
 assert.deepEqual(filterStations(rows,{...opts,bounds:wide,query:'충남 서산'}).map(s=>s.id),['A2']);
 assert.equal(filterStations(rows,{...opts,bounds:wide,fuel:'K015'}).length,0);
 assert.deepEqual(filterStations(rows,{...opts,bounds:wide,brand:'SOL',self:true}).map(s=>s.id),['A1']);
 assert.deepEqual(filterStations(rows,{...opts,bounds:wide,favorites:new Set(['A2'])}).map(s=>s.id),['A2']);
 const stale={...seosan,prices:{B027:{...price,sourceDate:'2026-10-15'}}};
 assert.equal(filterStations([stale],{...opts,bounds:wide,freshOnly:true}).length,0);
 assert.equal(filterStations([stale],{...opts,bounds:wide}).length,1);
});
test('partial coordinate coverage can populate the viewport without requiring a national search mode',()=>{
 const data={status:'partial',coverage:{serviceReady:false,searchIncludesUnmapped:true},stations:[seoul,unmapped]};
 assert.equal(useNationwideData(data,'B027'),true);assert.equal(useNationwideData(data,'K015'),false);
 assert.equal(useNationwideData({...data,stations:[unmapped]},'B027'),false);
});
test('old unlocated shared links still use address navigation rather than fabricated coordinates',()=>{
 const url=stationNavigationURL(unmapped);assert.match(url,/\/link\/search\//);assert.equal(decodeURIComponent(url).includes('충청남도 서산시 중앙로 1'),true);assert.doesNotMatch(url,/null|Infinity/);
 assert.match(stationNavigationURL(seoul),/\/link\/to\/.*37\.5,127$/);
});
test('viewport callbacks include zoom-only, programmatic and resized maps and coalesce idle events',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let bounds=local,zoom=13;const events=[];
 const c=Object.create(MapController.prototype);
 Object.assign(c,{ready:true,_destroyed:false,_userIntent:false,_scheduleMarkers(){},getCenter:()=>opts.center,getBounds:()=>bounds,map:{getZoom:()=>zoom},onViewportChange:event=>events.push(event)});
 c._idle();c._idle();t.mock.timers.tick(119);assert.equal(events.length,0);t.mock.timers.tick(1);assert.equal(events.length,1);
 zoom=12;bounds=wide;c._idle();t.mock.timers.tick(120);assert.equal(events.length,2);assert.equal(events[1].zoom,12);assert.deepEqual(events[1].bounds,wide);
 c._idle();t.mock.timers.tick(120);assert.equal(events.length,2);
 bounds={...wide,north:38};c._scheduleViewportChange();t.mock.timers.tick(120);assert.equal(events.length,3);
 c._scheduleViewportChange();c._destroyed=true;t.mock.timers.tick(120);assert.equal(events.length,3);
});

