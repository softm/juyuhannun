import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {routeMilestones,routePathLengths,routeTrajectory} from '../public/js/route-simulation.js';

const path=[[127,37],[127.05,37],[127.1,37]];

test('route simulation follows cumulative road distance instead of point count',()=>{
  const pointAt=routeTrajectory([[127,37],[127.01,37],[127.1,37]]);
  const middle=pointAt(.5);
  assert.ok(middle.lng>127.045&&middle.lng<127.055);
  assert.equal(middle.lat,37);
  const measured=routePathLengths(path);
  assert.ok(measured.total>8_000&&measured.total<10_000);
});

test('route simulation places a station milestone on the closest forward segment',()=>{
  const [stop]=routeMilestones(path,[{id:'station',name:'경로 주유소',point:{lat:37.001,lng:127.05}}]);
  assert.equal(stop.id,'station');
  assert.ok(stop.fraction>.49&&stop.fraction<.51);
});

test('route simulation keeps the current station name visible while driving',async()=>{
  const [html,script,styles]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/js/route-simulation.js',import.meta.url),'utf8'),
    readFile(new URL('../public/styles.css',import.meta.url),'utf8'),
  ]);
  assert.match(html,/data-simulation-station hidden/);
  assert.match(script,/station\.textContent=value\?`탐색 주유소 · \$\{value\}`:''/);
  assert.match(script,/setStationName\(milestones\[0\]\?\.name\)/);
  assert.match(styles,/\[data-simulation-station\]/);
});
