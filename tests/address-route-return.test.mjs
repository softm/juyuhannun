import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addressSearchPresentation, mergeLocationSearchResults, normalizeAddressSearchResults, normalizePlaceSearchResults } from '../public/js/address-search.js';

const [html, app, map, mobileView, mobileCss, styles] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/map.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/mobile-map-view.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/mobile-map.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
]);

test('address geocoder keeps road and parcel addresses without duplicate labels', () => {
  const results = normalizeAddressSearchResults([
    { roadAddress: '서울특별시 중구 세종대로 110', jibunAddress: '서울특별시 중구 태평로1가 31', x: '126.9784', y: '37.5666' },
    { roadAddress: '서울특별시 중구 세종대로 110', jibunAddress: '서울특별시 중구 태평로1가 31', x: '126.9784', y: '37.5666' },
    { roadAddress: '', jibunAddress: '서울특별시 종로구 세종로 1', x: '126.9769', y: '37.5759' },
    { roadAddress: '좌표 없는 주소', x: '', y: '' },
  ]);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    name: '서울특별시 중구 세종대로 110',
    address: '서울특별시 중구 세종대로 110',
    roadAddress: '서울특별시 중구 세종대로 110',
    jibunAddress: '서울특별시 중구 태평로1가 31',
    lat: 37.5666,
    lng: 126.9784,
  });
  assert.deepEqual(addressSearchPresentation(results[0]), {
    primary: '서울특별시 중구 세종대로 110',
    secondary: '서울특별시 중구 태평로1가 31',
    kind: '도로명',
  });
  assert.equal(addressSearchPresentation(results[1]).kind, '지번');
});

test('place search normalizes, ranks and presents general destination names', () => {
  const places = normalizePlaceSearchResults([
    { title: '서울역', category: '중앙행정기관 > 기상청 > 기상관측소', address: { road: '서울특별시 용산구 한강대로 367', parcel: '서울특별시 용산구 동자동 43-19' }, point: { x: '126.9719031', y: '37.5512105' } },
    { title: '서울역', category: '철도시설 > 철도/지하철 > 승강장', address: { road: '서울특별시 용산구 청파로 378', parcel: '서울특별시 용산구 동자동 43-205' }, point: { x: '126.9708195', y: '37.5518655' } },
    { title: '서울역', category: '철도시설 > 철도/지하철 > 승강장', address: { road: '서울특별시 용산구 청파로 378', parcel: '서울특별시 용산구 동자동 43-205' }, point: { x: '126.9706126', y: '37.5518645' } },
  ]);
  assert.equal(places.length, 2);
  const merged = mergeLocationSearchResults([places], '서울역');
  assert.match(merged[0].placeCategory, /철도/);
  assert.deepEqual(addressSearchPresentation(merged[0]), {
    primary: '서울역',
    secondary: '서울특별시 용산구 청파로 378 · 철도시설 > 철도/지하철 > 승강장',
    kind: '장소',
  });
});

test('destination form supports place, building, road and parcel search in one input', () => {
  assert.match(html, /목적지 통합검색/);
  assert.match(html, /placeholder="장소명, 도로명 또는 지번 입력"/);
  assert.match(html, /장소·건물명·도로명·지번을 한 번에 검색할 수 있습니다/);
  assert.match(html, /id="route-destination-candidates"[^>]+role="listbox"/);
  assert.match(app, /addressSearchPresentation/);
  assert.match(app, /map\.searchLocation\(text\)/);
  assert.match(map, /searchVWorldPlaces/);
  assert.match(map, /mergeLocationSearchResults/);
  assert.match(styles, /\.search-address-kind/);
});

test('route planner keeps the input flow compact and the primary action always reachable', () => {
  for (const marker of ['route-planner-scroll', 'route-progress-steps', 'route-destination-search', 'route-action-zone', 'route-trust-note']) {
    assert.match(html, new RegExp(`class="[^"]*${marker}|id="${marker}"`));
  }
  assert.match(styles, /\.route-panel\{display:flex;flex-direction:column;min-height:0;[^}]*overflow:hidden\}/);
  assert.match(styles, /\.route-destination-search \.search-candidates:not\(\[hidden\]\)\{display:block;position:absolute/);
  assert.match(styles, /\.route-action-zone\{[^}]*flex:none/);
  assert.match(mobileCss, /display:flex!important;flex-direction:column;padding:0!important;overflow:hidden!important/);
  assert.match(mobileCss, /@media\(min-width:640px\) and \(max-width:1000px\)[\s\S]*width:470px/);
  assert.match(app, /activeStep=routeReady\?'results':destinationReady\?'options':'destination'/);
});

test('route detail closes to the map and exposes a dedicated route-results dock button', () => {
  for (const id of ['focus-dock-list-icon', 'focus-dock-list-label', 'focus-list-count']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /label\.textContent=route\?'가는 길 목록':'목록'/);
  assert.match(app, /glyph\.innerHTML=icon\(route\?'route':'list'\)/);
  assert.match(app, /가는 길 주유소 목록으로 돌아가기/);
  assert.match(app, /mobileMapView\.openListSheet\(\)/);
  assert.match(mobileView, /detailReturnMode=listModes\.has\(mode\)\?'map-browse'/);
  assert.match(mobileView, /setMode\(detailReturnMode\|\|'map-browse'\)/);
  assert.match(mobileCss, /#focus-dock-list\.route-result-return/);
  assert.match(mobileCss, /juyu-bottom-ad-active\.mobile-map-browse \.mobile-focus-dock\{bottom:calc\(18px \+ var\(--juyu-bottom-ad-space/);
  assert.match(mobileCss, /juyu-bottom-ad-active\.mobile-list-sheet \.workspace>\.sidebar\{bottom:var\(--juyu-bottom-ad-space/);
});

test('route results transition between planner, list and map without covering the result map', () => {
  for (const id of ['mobile-list-sheet-title', 'focus-dock-more-icon', 'focus-dock-more-label']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /routePlannerOpen=false;rememberDestination\(\);render\(\);if\(mobileMapView\.isMobile\(\)\)mobileMapView\.openListSheet\(\)/);
  assert.match(app, /onListBack:\(\)=>\{if\(!hasRouteResults\(\)\)return false;openRoutePlanner\(\);return true;\}/);
  assert.match(app, /목적지·경로 설정으로 돌아가기/);
  assert.match(app, /plannerVisible\?'지도 결과 보기':'경로 변경'/);
  assert.match(app, /if\(hasRouteResults\(\)\)\{if\(isRoutePlannerVisible\(\)\)closeRoutePlanner\(\);else openRoutePlanner\(\)/);
  assert.match(mobileView, /function handleListBack\(\)\{if\(onListBack\(\{mode\}\)===true\)return;closeListSheet\(\);\}/);
  assert.match(mobileCss, /body\.route-mode\.route-planner-open\.mobile-map-browse \.workspace>\.sidebar>\.route-panel/);
  assert.doesNotMatch(mobileCss, /body\.route-mode\.mobile-map-browse \.workspace>\.sidebar>\.route-panel/);
});

test('route results switch between the top recommendations and all stations from a map icon', () => {
  assert.match(html, /id="route-results-toggle"[\s\S]{0,300}data-icon="star"/);
  assert.match(app, /routeResultScope:'recommended'/);
  assert.match(app, /selectRouteDisplayRows\(allRows,state\.routeResultScope\)/);
  assert.match(app, /\$\('route-results-toggle'\)\.addEventListener\('click'/);
  assert.match(app, /map\.setStations\(mapRows,rows\.length\?state\.selected:null,state\.fuel\)/);
  assert.match(styles, /\.route-results-toggle\[aria-pressed="true"\]/);
  assert.match(mobileCss, /body\.route-mode\.route-results-ready \.map-secondary-actions \.route-results-toggle\[aria-pressed="false"\]/);
});
