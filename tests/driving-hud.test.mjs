import test from 'node:test';
import assert from 'node:assert/strict';
import {bearingDegrees,selectHudStations,signedBearingDelta} from '../public/js/driving-hud.js';

test('방위각과 상대 방향을 계산한다',()=>{
 const origin={lat:37.5,lng:127};
 assert.ok(Math.abs(bearingDegrees(origin,{lat:37.51,lng:127}))<1);
 assert.equal(signedBearingDelta(350,10),-20);
 assert.equal(signedBearingDelta(10,350),20);
});

test('3D HUD는 진행 방향 72도 안의 가까운 주유소만 제한해 표시한다',()=>{
 const point={lat:37.5,lng:127},stations=[
  {id:'front',lat:37.51,lng:127,distanceMeters:1100},
  {id:'right',lat:37.5,lng:127.01,distanceMeters:900},
  {id:'behind',lat:37.49,lng:127,distanceMeters:500},
  {id:'far',lat:37.6,lng:127,distanceMeters:11000}
 ];
 assert.deepEqual(selectHudStations(stations,{point,heading:0}).map(row=>row.id),['front']);
 assert.equal(selectHudStations(Array.from({length:10},(_,i)=>({id:String(i),lat:37.501+i*.0001,lng:127,distanceMeters:100+i})),{point,heading:0}).length,6);
});
