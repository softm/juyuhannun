import test from 'node:test';
import assert from 'node:assert/strict';
import { markerScale, labelBudget, markerDensityLimit, visibleStations, labelCandidates } from '../public/js/marker-display.js';
import { MapController } from '../public/js/map.js';

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

test('돌봄한눈 14·16·18 scale boundaries and viewport-dependent name budgets', () => {
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
  const content=c._markerState.get('highway').content;assert.match(content,/수집 중/);assert.match(content,/is-stale/);assert.match(content,/고속도로 이전 수집자료/);
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
    row('cheap',{prices:{B027:{price:1600,priceUpdatedAt:new Date().toISOString()}}}),
    row('mid',{prices:{B027:{price:1700,priceUpdatedAt:new Date().toISOString()}}}),
    row('high',{prices:{B027:{price:1900,priceUpdatedAt:new Date().toISOString()}}})
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
