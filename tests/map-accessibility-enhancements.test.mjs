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
 assert.equal(BRAND_VISUALS.SKE.image,'./assets/brands/sk-energy.jpg');
 assert.equal(BRAND_VISUALS.GSC.image,'./assets/brands/gs-caltex.png');
 assert.equal(BRAND_VISUALS.HDO.image,'./assets/brands/hd-hyundai-oilbank.svg');
 assert.equal(BRAND_VISUALS.SOL.image,'./assets/brands/s-oil.png');
 assert.equal(BRAND_VISUALS.E1G.image,'./assets/brands/e1.png');
 assert.match(html,/brand-logo-sk[\s\S]*brand-logo-gs[\s\S]*brand-logo-hd[\s\S]*brand-logo-soil/);
 assert.match(styles,/\.more-hero\{[\s\S]*linear-gradient/);
 assert.match(styles,/brand-logo-sk\{background-image:url\('\.\/assets\/brands\/sk-energy\.jpg'\)\}/);
 assert.match(app,/brand\.image\?`<span class="brand-badge has-logo"/);
 assert.match(map,/brand\.image\?'<span class="marker-brand-badge has-logo"/);
 assert.match(map,/--brand-logo-scale:/);
 assert.match(map,/transform:scale\(var\(--brand-logo-scale,1\)\)/);
 assert.equal(BRAND_VISUALS.SKE.logoScale,2.05);
 assert.equal(BRAND_VISUALS.E1G.logoScale,1.65);
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
