import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BRAND_VISUALS,brandVisual} from '../public/js/brand-visuals.js';

const [html,app,map,styles,mobileCss]=await Promise.all([
 readFile(new URL('../public/index.html',import.meta.url),'utf8'),
 readFile(new URL('../public/js/app.js',import.meta.url),'utf8'),
 readFile(new URL('../public/js/map.js',import.meta.url),'utf8'),
 readFile(new URL('../public/styles.css',import.meta.url),'utf8'),
 readFile(new URL('../public/mobile-map.css',import.meta.url),'utf8')
]);

test('brand visuals expose recognizable color wordmarks',()=>{
 assert.equal(BRAND_VISUALS.SKE.logo,'SK energy');
 assert.equal(BRAND_VISUALS.GSC.logo,'GS Caltex');
 assert.equal(BRAND_VISUALS.SOL.logo,'S-OIL');
 assert.match(brandVisual('HDO').color,/^#/);
 assert.match(html,/brand-logo-sk[\s\S]*brand-logo-gs[\s\S]*brand-logo-hd[\s\S]*brand-logo-soil/);
 assert.match(styles,/\.more-hero\{[\s\S]*linear-gradient/);
});

test('SDK marker click opens detail and an empty map click clears selection',()=>{
 assert.match(map,/_selectStationMarker\(id\)/);
 assert.match(map,/Event\.addListener\(marker,'click'/);
 assert.match(map,/marker\.on\?\.\('click'/);
 assert.match(map,/_deselectFromMap\(\)/);
 assert.match(app,/onDeselect:\(\)=>clearStationSelection\(\)/);
 assert.match(app,/function clearStationSelection\(\)/);
});

test('going-there remains reachable while the mobile menu is folded',()=>{
 assert.match(html,/id="focus-route-shortcut"[^>]+가는 길 주유소 찾기/);
 assert.match(app,/focus-route-shortcut[\s\S]{0,120}openRoutePlanner/);
 assert.match(mobileCss,/mobile-map-browse \.focus-route-shortcut[\s\S]*mobile-map-expanded \.focus-route-shortcut/);
 assert.doesNotMatch(mobileCss,/mobile-map-menu-collapsed[^}]*focus-route-shortcut[^}]*display:none/);
});

test('area rescan exposes an in-progress state before completion',()=>{
 assert.match(app,/focus-rescan[\s\S]*classList\.add\('is-progress'\)/);
 assert.match(app,/setAttribute\('aria-busy','true'\)/);
 assert.match(app,/지도 영역 확인 중/);
 assert.match(mobileCss,/\.rescan-spinner\{/);
});
