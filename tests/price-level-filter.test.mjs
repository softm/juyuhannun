import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  filterStations,priceBandsForStations,priceLevelForStation,filterPriceLevelRows
} from '../public/js/core.js';

const now=Date.parse('2026-11-13T09:30:00Z');
const updated=new Date(now-30*60*1000).toISOString();
const bounds={south:37,north:38,west:126,east:128};
const center={lat:37.5,lng:127};
const station=(id,price,{stale=false,lat=37.5}={})=>({
  id,name:id,lat,lng:127,brand:'SKE',
  prices:{B027:{price,priceUpdatedAt:stale?'2026-11-10T09:30:00Z':updated,fetchedAt:updated}}
});
const data=[
 station('cheap-1',1500),station('cheap-2',1520),
 station('middle-1',1550),station('middle-2',1600),
 station('expensive-1',1640),station('expensive-2',1700),
 station('old-reference',1450,{stale:true})
];
const selected=()=>filterStations(data,{fuel:'B027',center,bounds,now});

test('map thirds are calculated from comparable prices, excluding stale reference prices',()=>{
  const rows=selected(),bands=priceBandsForStations(rows,'B027',now);
  assert.deepEqual(bands,{count:6,min:1500,low:1520,high:1640});
  assert.deepEqual(rows.map(s=>[s.id,priceLevelForStation(s,'B027',bands,now)]),[
    ['old-reference','reference'],['cheap-1','low'],['cheap-2','low'],
    ['middle-1','mid'],['middle-2','mid'],['expensive-1','high'],['expensive-2','high']
  ]);
});

test('price level buttons match OR selection; no selection keeps reference prices',()=>{
  const rows=selected(),bands=priceBandsForStations(rows,'B027',now);
  assert.equal(filterPriceLevelRows(rows,[],bands,'B027',now),rows);
  assert.deepEqual(filterPriceLevelRows(rows,['low'],bands,'B027',now).map(s=>s.id),['cheap-1','cheap-2']);
  assert.deepEqual(filterPriceLevelRows(rows,['low','mid'],bands,'B027',now).map(s=>s.id),[
    'cheap-1','cheap-2','middle-1','middle-2'
  ]);
  assert.deepEqual(filterPriceLevelRows(rows,['low','high'],bands,'B027',now).map(s=>s.id),[
    'cheap-1','cheap-2','expensive-1','expensive-2'
  ]);
  assert.deepEqual(filterPriceLevelRows(rows,['low','mid','high'],bands,'B027',now).map(s=>s.id),[
    'cheap-1','cheap-2','middle-1','middle-2','expensive-1','expensive-2'
  ]);
});

test('price levels stay stable when filtering, changing fuel and moving map region',()=>{
  const all=selected(),bands=priceBandsForStations(all,'B027',now);
  const low=filterPriceLevelRows(all,['low'],bands,'B027',now);
  assert.equal(priceLevelForStation(low[1],'B027',bands,now),'low');
  // The filter would reclassify the second low station as expensive if
  // marker bands were recomputed from the filtered rows. Pass original bands.
  assert.notDeepEqual(priceBandsForStations(low,'B027',now),bands);
  assert.deepEqual(filterPriceLevelRows([],['low'],bands,'B027',now),[]);
  assert.deepEqual(filterPriceLevelRows(all,['high'],priceBandsForStations(all,'D047',now),'D047',now),[]);
});

test('single comparable station is neutral, matching map marker display',()=>{
  const rows=selected().filter(x=>x.id==='cheap-1'),bands=priceBandsForStations(rows,'B027',now);
  assert.equal(bands.count,1);
  assert.equal(priceLevelForStation(rows[0],'B027',bands,now),'mid');
});

test('filter control offers accessible independent price-level toggle buttons',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  for(const level of ['low','mid','high']){
    assert.match(html,new RegExp('data-price-level="'+level+'" aria-pressed="false"'));
  }
  assert.match(html,/id="price-level-indicator"/);
  assert.match(html,/id="price-level-help"/);
});
