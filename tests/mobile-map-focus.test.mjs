import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, map, view, css] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/map.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/mobile-map-view.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/mobile-map.css', import.meta.url), 'utf8'),
]);

test('mobile focus detail has sheet controls and real map tools', () => {
  for (const id of ['detail-expand-toggle', 'zoom-in', 'zoom-out', 'map-type-toggle', 'mobile-map-toggle']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /detail-dialog[^>]+data-map-overlay/);
  assert.match(app, /mobileMapView\.enterDetail\(\)/);
  assert.match(app, /mobileMapView\.afterLayout\(focusSelected\)/);
});

test('mobile map view models focus, expanded tools, full map and history exit', () => {
  for (const state of ['focus-detail', 'expanded-tools', 'full-map']) assert.match(view, new RegExp(state));
  assert.match(view, /history\.pushState/);
  assert.match(view, /window\.addEventListener\('popstate'/);
  assert.match(view, /sidebar\.inert = next === 'focus-detail' \|\| next === 'full-map'/);
  assert.match(view, /detailExpandButton/);
});

test('expanded mobile mode exposes search/filter layout and safe-area sheet', () => {
  assert.match(css, /body\.mobile-map-expanded \.workspace>\.sidebar>\.search-block/);
  assert.match(css, /body\.mobile-map-focus \.detail-dialog\[open\]/);
  assert.match(css, /100dvh/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});

test('map controller uses actual SDK zoom and Naver map type APIs', () => {
  assert.match(map, /zoomBy\(delta = 1\)/);
  assert.match(map, /toggleMapType\(\)/);
  assert.match(map, /setMapTypeId/);
  assert.match(map, /MapTypeId\.SATELLITE/);
  assert.match(app, /map\.toggleMapType\(\)/);
});
