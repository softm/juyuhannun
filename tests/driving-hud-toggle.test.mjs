import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('HUD 재진입은 마지막 카드와 신뢰 가능한 진행 방향을 유지한다',async()=>{
 const [app,hud,html,css]=await Promise.all([
  readFile(new URL('../public/js/app.js',import.meta.url),'utf8'),
  readFile(new URL('../public/js/driving-hud.js',import.meta.url),'utf8'),
  readFile(new URL('../public/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/styles.css',import.meta.url),'utf8')
 ]);
 assert.match(app,/lastDrivingHeading/);
 assert.match(app,/Number\.isFinite\(state\.driving\.heading\)\?state\.driving\.heading:lastDrivingHeading/);
 assert.match(app,/state\.driving\.point=lastDrivingPoint\|\|lastLocatedPoint/);
 assert.doesNotMatch(hud,/if\(!active\)stationsHost\.replaceChildren\(\)/);
 assert.match(html,/id="drive-hud-nearest"[^>]+aria-live="polite"/);
 assert.match(hud,/drive-hud-distance/);
 assert.match(hud,/가장 가까운 곳.*m 남음/);
 assert.match(css,/\.drive-hud-distance\{/);
});
