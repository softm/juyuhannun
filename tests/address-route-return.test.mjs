import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addressSearchPresentation, normalizeAddressSearchResults } from '../public/js/address-search.js';

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

test('destination form is explicitly an address search for road and parcel addresses', () => {
  assert.match(html, /목적지 주소로 찾기/);
  assert.match(html, /placeholder="도로명 또는 지번 주소 입력"/);
  assert.match(html, /도로명·지번 주소를 모두 검색할 수 있습니다/);
  assert.match(html, /id="route-destination-candidates"[^>]+role="listbox"/);
  assert.match(app, /addressSearchPresentation/);
  assert.match(map, /normalizeAddressSearchResults/);
  assert.match(styles, /\.search-address-kind/);
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
