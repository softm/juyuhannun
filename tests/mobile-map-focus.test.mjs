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


test('focus mode keeps marker callout and stages compact versus expanded tools', () => {
  assert.match(html, /compact-map-action/);
  assert.match(html, /map-secondary-actions/);
  assert.match(map, /selected-station-callout/);
  assert.match(css, /mobile-map-focus[\s\S]*compact-map-action/);
  assert.match(css, /mobile-map-expanded[\s\S]*expanded-map-action/);
});

test('detail sheet handle is interactive and snaps focus modes', () => {
  assert.match(html, /id="detail-sheet-handle"/);
  assert.match(view, /pointerdown/);
  assert.match(view, /pointermove/);
  assert.match(view, /finishHandleDrag/);
  assert.match(view, /dy < -58/);
  assert.match(view, /dy > 132/);
  assert.match(view, /setDetailMode\('expanded-tools'\)/);
  assert.match(css, /--sheet-drag-y/);
  assert.match(css, /touch-action:none/);
});


test('approved focus design renders branded marker tones, selected price pin and station callout', () => {
  assert.match(map, /markerTone\(/);
  assert.match(map, /selected-station-callout/);
  assert.match(map, /tone-blue/);
  assert.match(map, /#2f7df6/);
  assert.match(map, /station-marker\.is-selected/);
});

test('station focus sheet contains three fuel cards, compare action, tabs and contact actions', () => {
  assert.match(app, /detailPrice\(station,'B027','휘발유','green'\)/);
  assert.match(app, /detailPrice\(station,'D047','경유','blue'\)/);
  assert.match(app, /detailPrice\(station,'K015','LPG','orange'\)/);
  assert.match(app, /compare-station-button/);
  assert.match(app, /focus-detail-tabs/);
  assert.match(app, /copy-address/);
  assert.match(app, /운영시간 정보 미제공/);
});

test('expanded tools match approved staged design', () => {
  assert.match(html, /map-secondary-actions/);
  assert.match(css, /mobile-map-expanded \.map-secondary-actions/);
  assert.match(css, /mobile-map-expanded \.search-block \.fuel-tabs button\.active/);
  assert.match(css, /mobile-map-expanded \.search-block \.filter-button/);
  assert.match(css, /focus-route-button/);
});
