import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRouteHistory,rememberRouteDestination} from '../public/js/route-history.js';

test('recent destinations merge nearby entries and keep ten newest rows',()=>{
 let rows=[];for(let i=0;i<12;i++)rows=rememberRouteDestination(rows,{label:`목적지 ${i}`,lat:37.5+i*.01,lng:127},{now:i+1});
 assert.equal(rows.length,10);assert.equal(rows[0].label,'목적지 11');
 rows=rememberRouteDestination(rows,{label:'같은 곳',lat:rows[0].lat,lng:rows[0].lng},{now:20});
 assert.equal(rows.length,10);assert.equal(rows[0].useCount,2);
});

test('invalid route history entries are discarded',()=>{assert.deepEqual(normalizeRouteHistory([{label:'x',lat:0,lng:0},null]),[]);});
