import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { markerScale, labelBudget, markerDensityLimit, visibleStations, labelCandidates } from '../public/js/marker-display.js';
import { MapController } from '../public/js/map.js';

const mapSource = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');

const nationwide = { south: 32, north: 40, west: 123, east: 133 };
const row = (id, extra = {}) => ({ id: String(id), name: '테스트 ' + id, lat: 37.5, lng: 127, prices: { B027: { price: 1700, priceUpdatedAt: new Date().toISOString() }, D047: { price: 1600, priceUpdatedAt: new Date().toISOString() } }, ...extra });

function harness(provider = 'naver') {
  let nextFrame = 0, zoom = 13, bounds = nationwide;
  const frames = new Map(), counts = { created: 0, icons: 0, moved: 0, z: 0, attached: 0, removed: 0, labels: 0 };
  globalThis.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  class Marker {
    constructor(options) { this.options = options; this.icon = options.icon; counts.created++; }
    setIcon(icon) { this.icon = icon; counts.icons++; }
    setPosition() { counts.moved++; }
    setLatLng() { counts.moved++; }
    setZIndex() { counts.z++; }
    setZIndexOffset() { counts.z++; }
    setMap(map) { counts[map ? 'attached' : 'removed']++; }
    addTo() { counts.attached++; return this; }
    remove() { counts.removed++; }
  }
  globalThis.naver = { maps: { Marker, Point: class { constructor(x,y) { Object.assign(this,{x,y}); } }, LatLng: class { constructor(lat,lng) { Object.assign(this,{lat,lng}); } } } };
  globalThis.L = { divIcon: options => options, marker: (point,options) => new Marker(options) };
  const controller = Object.create(MapController.prototype);
  Object.assign(controller, {
    provider, map: { getZoom: () => zoom }, ready: true, _destroyed: false, _renderRevision: 0,
    _stations: [], _markers: new Map(), _markerPool: new Map(), _markerState: new Map(), _retainedLabels: new Map(),
    canvas: { dataset: {}, clientWidth: 1000, clientHeight: 720, classList: { toggle() {} } },
    getBounds: () => bounds, _layoutLabels: () => counts.labels++,
  });
  const step = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  const flush = () => { let steps=0; while(frames.size && steps++ < 10000)step(); assert.equal(frames.size,0); return steps; };
  return { controller, counts, step, flush, zoom: value => { zoom=value; }, bounds: value => { bounds=value; } };
}

test('주유한눈 14·16·18 scale boundaries keep wide mobile views light and show prices from neighborhood zoom', () => {
  for (const [zoom,scale] of [[7,'dot'],[13.99,'dot'],[14,'pin'],[15.99,'pin'],[16,'name'],[17.99,'name'],[18,'detail'],[19,'detail']]) assert.equal(markerScale(zoom),scale);
  const budgets = [7,12,14,16,18].map(zoom=>labelBudget(zoom,390,600));
  assert.ok(budgets.every((b,i)=>b>0 && (!i || b>=budgets[i-1])));
  assert.equal(labelBudget(13,0,600),0);
  assert.equal(labelBudget(18,4000,4000),40);
  assert.equal(markerDensityLimit(390,600),26);
});

test('viewport culling keeps every matching point, deduplicates IDs and excludes missing coordinates', () => {
  const rows = [row('a'),row('b',{lat:35}),row('c',{lat:null,lng:null}),row('a'),row('d',{lat:NaN}),row('e',{lng:Infinity})];
  assert.deepEqual(visibleStations(rows,{south:37,north:38,west:126,east:128},'a').map(s=>s.id),['a']);
  assert.deepEqual(visibleStations([row('a'),row('b')],nationwide,'b').map(s=>s.id),['b','a']);
  assert.equal(visibleStations(Array.from({length:10000},(_,i)=>row(i)),nationwide).length,10000);
});

test('labels retain selected and previously visible stations independent of list order', () => {
  const retained=new Map([['b','left']]);
  assert.deepEqual(labelCandidates(['a','b','c','z'],'z',retained,1),['z','b','a']);
  assert.deepEqual(labelCandidates(['z','c','b','a'],'z',retained,1),['z','b','a']);
});

for (const provider of ['naver','leaflet']) {
  test(provider+': 5,000 markers are frame-batched, reused on zoom and only changed icons update', () => {
    const h=harness(provider), c=h.controller;
    const rows=Array.from({length:5000},(_,i)=>row(i));
    c.setStations(rows); h.step();
    assert.ok(h.counts.created>0 && h.counts.created<=64, 'first frame cannot create thousands of overlays');
    assert.ok(h.flush()>1);assert.equal(c._markers.size,5000);
    const snapshot={...h.counts};
    h.zoom(18);c.setStations(rows);h.flush();
    assert.equal(c.canvas.dataset.markerScale,'detail');
    for (const key of ['created','icons','moved','removed']) assert.equal(h.counts[key],snapshot[key],key+' churn on zoom');
    c.setStations(rows,'4999');h.flush();assert.equal(h.counts.icons,snapshot.icons+1);
    c.setStations(rows,'4998');h.flush();assert.equal(h.counts.icons,snapshot.icons+3);
    const changed=rows.map(s=>({...s}));changed[0]={...changed[0],prices:{...changed[0].prices,B027:{...changed[0].prices.B027,price:1800}}};
    c.setStations(changed,'4998');h.flush();assert.equal(h.counts.icons,snapshot.icons+4);
    assert.match(c._markerState.get('0').content,/1,800/);
    c.setStations(changed,'4998','D047');h.flush();assert.match(c._markerState.get('0').content,/1,600/);
  });
  test(provider+': offscreen overlays detach and returning views reuse the bounded pool', () => {
    const h=harness(provider),c=h.controller;
    const rows=[row('a'),row('b',{lat:35})];c.setStations(rows);h.flush();const a=c._markers.get('a');
    h.bounds({south:34,north:36,west:126,east:128});c._scheduleMarkers();h.flush();
    assert.deepEqual([...c._markers.keys()],['b']);assert.equal(c._markerPool.get('a'),a);
    h.bounds(nationwide);c._scheduleMarkers();h.flush();assert.equal(c._markers.get('a'),a);assert.equal(h.counts.created,2);
    c.setStations([]);h.flush();assert.equal(c._markers.size,0);
  });
}

test('a newer filter cancels pending work before old markers can finish mounting',()=>{
  const h=harness(),c=h.controller;c.setStations(Array.from({length:5000},(_,i)=>row(i)));h.step();
  c.setStations([row('new')]);h.flush();assert.deepEqual([...c._markers.keys()],['new']);
  assert.ok(h.counts.created<=65);assert.ok(c._markerPool.size<=800);
});

test('pool does not retain all nationwide overlays and custom presentation stays authoritative',()=>{
  const h=harness(),c=h.controller;c.setStations(Array.from({length:1000},(_,i)=>row(i)));h.flush();
  c.setStations([]);h.flush();assert.equal(c._markerPool.size,800);assert.equal(c._markerState.size,800);
  c.markerPresentation=()=>({value:'수집 중',unit:'',stale:true,label:'고속도로 이전 수집자료'});
  c.setStations([row('highway')]);h.flush();
  const content=c._markerState.get('highway').content;assert.match(content,/price-pin-value">1,700/);assert.match(content,/is-stale/);assert.match(content,/고속도로 이전 수집자료/);assert.doesNotMatch(content,/price-pin-value">수집 중/);assert.doesNotMatch(content,/서울|주소|도로명/);
});


test('name labels sit above location dots and keep that layer across unchanged renders',()=>{
  const h=harness(),c=h.controller;c.setStations([row('a'),row('b')]);h.flush();
  c._setMarkerLayer('a',true);c._retainedLabels.set('a','top');
  assert.equal(c._markerState.get('a').zIndex,1000);
  const before=h.counts.z;c.setStations(c._stations);h.flush();assert.equal(h.counts.z,before);
  c._setMarkerLayer('a',false);assert.equal(c._markerState.get('a').zIndex,100);
  c.setStations(c._stations,'b');h.flush();c._setMarkerLayer('b',false);assert.equal(c._markerState.get('b').zIndex,5000);
  h.zoom(7);c._updateMarkerScale();assert.equal(c.canvas.dataset.markerSize,'small');
  h.zoom(13);c._updateMarkerScale();assert.equal(c.canvas.dataset.markerSize,'normal');
});


test('selected marker keeps its price-level tone and readable marker scales show price inside',()=>{
  const h=harness(),c=h.controller;
  const rows=[
    row('cheap',{prices:{B027:{price:1600,priceUpdatedAt:new Date().toISOString(),fetchedAt:new Date().toISOString()}}}),
    row('mid',{prices:{B027:{price:1700,priceUpdatedAt:new Date().toISOString(),fetchedAt:new Date().toISOString()}}}),
    row('high',{prices:{B027:{price:1900,priceUpdatedAt:new Date().toISOString(),fetchedAt:new Date().toISOString()}}})
  ];
  c.setStations(rows,'high');h.flush();
  assert.match(c._markerState.get('cheap').content,/station-marker tone-green/);
  assert.match(c._markerState.get('mid').content,/station-marker tone-orange/);
  assert.match(c._markerState.get('high').content,/station-marker tone-red is-selected/);

  h.zoom(14);c._updateMarkerScale();
  assert.equal(c.canvas.dataset.markerScale,'pin');
  h.zoom(16);c._updateMarkerScale();
  assert.equal(c.canvas.dataset.markerScale,'name');
  h.zoom(18);c._updateMarkerScale();
  assert.equal(c.canvas.dataset.markerScale,'detail');
});


test('stale or missing price markers use slate rather than price-level colors',()=>{
  const h=harness(),c=h.controller;
  c.setStations([row('stale',{prices:{B027:{price:1500,priceUpdatedAt:'2020-01-01T00:00:00Z'}}})]);h.flush();
  assert.match(c._markerState.get('stale').content,/station-marker tone-slate/);
});


test('selected marker combines brand logo and price with bounce selection animation',()=>{
  const h=harness(),c=h.controller;
  const fresh=new Date().toISOString();
  c.setStations([row('selected',{brand:'GSC',roadAddress:'서울특별시 테스트로 1',prices:{B027:{price:1589,priceUpdatedAt:fresh,fetchedAt:fresh}}})],'selected');h.flush();
  const content=c._markerState.get('selected').content;
  assert.match(content,/price-pin-value">1,589/);
  assert.doesNotMatch(content,/price-label-detail[^<]*서울특별시 테스트로 1/);
  assert.match(content,/station-marker tone-orange is-selected is-lowest rank-1 has-visible-price/);
  assert.match(content,/price-pin selected[\s\S]*marker-brand-badge has-logo[\s\S]*price-pin-value">1,589/);
  const callout=content.match(/<button type="button" class="selected-station-callout"[\s\S]*?<\/button>/)?.[0]||'';
  assert.doesNotMatch(callout,/marker-brand-badge/);
  assert.match(content,/selected-station-callout/);
  assert.match(content,/테스트 selected/);
});


test('brand logo appears inside its rendered price marker and is omitted when price is unavailable',()=>{
  const h=harness(),c=h.controller;
  const fresh=new Date().toISOString();
  c.setStations([
    row('priced',{brand:'GSC',prices:{B027:{price:1688,priceUpdatedAt:fresh,fetchedAt:fresh}}}),
    row('missing',{brand:'SKE',prices:{}})
  ]);h.flush();
  const priced=c._markerState.get('priced').content;
  const missing=c._markerState.get('missing').content;
  assert.match(priced,/has-visible-price/);
  assert.match(priced,/lowest-price-badge[\s\S]*marker-brand-badge has-logo[\s\S]*<strong>1,688원/);
  assert.match(priced,/price-pin[\s\S]*marker-brand-badge has-logo[\s\S]*price-pin-value">1,688/);
  assert.doesNotMatch(missing,/has-visible-price|marker-brand-badge/);
  assert.match(missing,/price-pin-value">—/);
  assert.match(mapSource,/\.price-pin>\.marker-brand-badge\{[^']*display:none/);
  assert.match(mapSource,/data-marker-scale="pin"[^']*price-pin>\.marker-brand-badge[^']*display:flex/);
});


test('selected station callout is a clickable detail selector',()=>{
  const h=harness(),c=h.controller;
  const fresh=new Date().toISOString();
  c.setStations([row('selected',{prices:{B027:{price:1589,priceUpdatedAt:fresh,fetchedAt:fresh}}})],'selected');h.flush();
  const content=c._markerState.get('selected').content;
  assert.match(content,/<button type="button" class="selected-station-callout"[^>]+data-station-id="selected"/);
  assert.match(content,/aria-label="테스트 selected 상세 보기"/);
  assert.match(content,/<\/button>/);
});


test('lowest price badge is a clickable station selector',()=>{
  const h=harness(),c=h.controller;
  const fresh=new Date().toISOString();
  const rows=[
    row('low',{prices:{B027:{price:1578,priceUpdatedAt:fresh,fetchedAt:fresh}}}),
    row('mid',{prices:{B027:{price:1700,priceUpdatedAt:fresh,fetchedAt:fresh}}})
  ];
  c.setStations(rows);h.flush();
  const content=c._markerState.get('low').content;
  assert.match(content,/<button type="button" class="lowest-price-badge rank-1"[^>]+data-station-id="low"/);
  assert.match(content,/최저 1,578원 상세 보기/);
  assert.match(content,/최저/);
  assert.match(content,/1,578원/);
});


test('top five current-fuel prices get bouncing clickable rank badges',()=>{
  const h=harness(),c=h.controller;
  const fresh=new Date().toISOString();
  const rows=[1578,1580,1590,1600,1610,1620].map((price,index)=>row('rank'+(index+1),{
    prices:{B027:{price,priceUpdatedAt:fresh,fetchedAt:fresh}}
  }));
  c.setStations(rows);h.flush();
  for(let rank=1;rank<=5;rank++){
    const content=c._markerState.get('rank'+rank).content;
    const tag=rank===1?'최저':rank+'위';
    assert.match(content,new RegExp('lowest-price-badge rank-'+rank));
    assert.match(content,new RegExp('data-station-id="rank'+rank+'"'));
    assert.match(content,new RegExp('>'+tag+'<'));
    assert.equal(c._markerState.get('rank'+rank).rank,rank);
  }
  assert.doesNotMatch(c._markerState.get('rank6').content,/lowest-price-badge/);
  assert.equal(c._markerState.get('rank6').rank,null);
});

test('selected top-five station keeps its rank chip alongside the selected marker',()=>{
  const h=harness(),c=h.controller;
  const fresh=new Date().toISOString();
  const rows=[1578,1580,1590,1600,1610,1620].map((price,index)=>row('rank'+(index+1),{
    prices:{B027:{price,priceUpdatedAt:fresh,fetchedAt:fresh}}
  }));
  c.setStations(rows,'rank3');h.flush();
  const selected=c._markerState.get('rank3').content;
  assert.match(selected,/station-marker tone-[a-z]+ is-selected is-lowest rank-3/);
  assert.doesNotMatch(selected,/lowest-price-badge/);
  assert.match(selected,/selected-rank-chip rank-3">3위</);
  assert.match(selected,/price-pin selected/);
  assert.match(selected,/selected-station-callout/);
  assert.match(mapSource,/\.selected-rank-chip\{[^']*position:absolute[^']*pointer-events:none/);
  assert.match(mapSource,/\.selected-rank-chip\.rank-3\{background:#7c3aed/);
});

test('dot-scale markers keep a larger transparent touch target without growing the visible dot',()=>{
  assert.match(mapSource,/data-marker-scale="dot"[^']*price-pin:not\(\.selected\):before[^']*inset:-10px[^']*background:transparent/);
  assert.match(mapSource,/data-marker-scale="dot"[^']*price-pin:not\(\.selected\)\{width:15px;height:15px/);
});

test('route recommendation bubbles keep one green body and color only rank text pills',()=>{
  assert.match(mapSource,/\.lowest-price-badge\{[^']*background:#159b72/);
  assert.match(mapSource,/\.lowest-price-badge:after\{[^']*background:#159b72/);
  assert.match(mapSource,/\.station-marker\.is-lowest:not\(\.is-selected\) \.price-pin\{display:none\}/);
  const rankColors={1:'#ffcf00',2:'#2563eb',3:'#7c3aed',4:'#ea580c',5:'#dc2626'};
  assert.match(mapSource,/\.lowest-price-badge \.lowest-tag\{[^']*border:2px solid #fff[^']*box-shadow:/);
  for(const [rank,color] of Object.entries(rankColors))assert.match(mapSource,new RegExp(`\\.lowest-price-badge\\.rank-${rank} \\.lowest-tag\\{background:${color}`));
  assert.doesNotMatch(mapSource,/\.lowest-price-badge\.rank-2,\.lowest-price-badge\.rank-3[^']*background:/);
});

test('route lines use contrasting casings below station markers',()=>{
  assert.match(mapSource,/base: Object\.freeze\(\{ color:'#1d4ed8', weight:6, casingWeight:11, zIndex:60 \}\)/);
  assert.match(mapSource,/via: Object\.freeze\(\{ color:'#7c3aed', weight:7, casingWeight:12, zIndex:80 \}\)/);
  assert.match(mapSource,/strokeColor:'#fff', strokeWeight:appearance\.casingWeight[^\n]+zIndex:appearance\.zIndex/);
  assert.match(mapSource,/strokeColor:appearance\.color[^\n]+zIndex:appearance\.zIndex\+1/);
  assert.match(mapSource,/body\.route-mode \.map-surface\[data-marker-scale="dot"\][^']*width:18px[^']*border-width:3px/);
  assert.match(mapSource,/\.route-endpoint-start\{background:#1d4ed8\}\.route-endpoint-destination\{background:#111827\}/);
  assert.match(mapSource,/if\(this\._baseRouteCasing\)this\._removeMarker\(this\._baseRouteCasing\)/);
  assert.match(mapSource,/if\(this\._viaRouteCasing\)this\._removeMarker\(this\._viaRouteCasing\)/);
});

test('stale prices are excluded from top-five rank badges',()=>{
  const h=harness(),c=h.controller;
  const fresh=new Date().toISOString();
  const rows=[
    row('stale-cheap',{prices:{B027:{price:1000,priceUpdatedAt:'2020-01-01T00:00:00Z',fetchedAt:'2020-01-01T00:00:00Z'}}}),
    row('fresh',{prices:{B027:{price:1700,priceUpdatedAt:fresh,fetchedAt:fresh}}})
  ];
  c.setStations(rows);h.flush();
  assert.doesNotMatch(c._markerState.get('stale-cheap').content,/lowest-price-badge/);
  assert.match(c._markerState.get('fresh').content,/lowest-price-badge rank-1/);
});
