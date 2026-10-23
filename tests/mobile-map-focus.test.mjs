import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, map, view, css, styles] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/map.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/mobile-map-view.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/mobile-map.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
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
  for (const state of ['focus-detail', 'expanded-tools', 'map-browse', 'map-collapsed']) assert.match(view, new RegExp(state));
  assert.match(view, /history\.pushState/);
  assert.match(view, /window\.addEventListener\('popstate'/);
  assert.match(view, /sidebar\.inert=next==='focus-detail'\|\|next==='map-collapsed'/);
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
  assert.match(view, /dy<-58/);
  assert.match(view, /dy>132/);
  assert.match(view, /setDetailMode\('expanded-tools'\)/);
  assert.match(css, /--sheet-drag-y/);
  assert.match(css, /touch-action:none/);
});


test('approved focus design renders price-level marker tones, selected price pin and station callout', () => {
  assert.match(map, /markerPriceBands\(/);
  assert.match(map, /markerTone\(/);
  assert.match(map, /selected-station-callout/);
  assert.match(map, /tone-green/);
  assert.match(map, /tone-orange/);
  assert.match(map, /tone-red/);
  assert.match(map, /tone-slate/);
  assert.match(map, /station-marker\.is-selected/);
});

test('station focus sheet contains three fuel cards, tabs and contact actions without compare basket', () => {
  assert.match(app, /detailPrice\(station,'B027','휘발유','green'\)/);
  assert.match(app, /detailPrice\(station,'D047','경유','blue'\)/);
  assert.match(app, /detailPrice\(station,'K015','LPG','orange'\)/);
  assert.doesNotMatch(app, /compare-station-button/);
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


test('five-state mobile focus flow includes map browse and draggable list sheet states', () => {
  for (const state of ['map-browse','list-sheet','list-sheet-expanded']) assert.match(view, new RegExp(state));
  assert.match(view, /openListSheet/);
  assert.match(view, /finishListDrag/);
  assert.match(view, /dy<-56/);
  assert.match(view, /dy>118/);
  assert.match(html, /id="mobile-focus-dock"/);
  assert.match(html, /id="mobile-list-sheet-handle"/);
  assert.match(css, /body\.mobile-map-browse \.mobile-focus-dock/);
  assert.match(css, /body\.mobile-list-sheet\.mobile-list-expanded/);
});

test('closing detail keeps the focused map session instead of restoring default layout', () => {
  assert.match(view, /hideDetail\(\);\s*setMode\('map-browse'\)/);
  assert.match(app, /focus-dock-list/);
  assert.match(app, /focus-rescan/);
});


test('desktop station detail uses a dedicated readable modal layout', () => {
  assert.match(html, /desktop-detail-title/);
  assert.match(styles, /@media\(min-width:1001px\)/);
  assert.match(styles, /\.detail-dialog \.detail-sheet-handle,\.detail-dialog \.detail-expand-toggle\{display:none!important\}/);
  assert.match(styles, /\.detail-dialog \.fuel-price-grid/);
});

test('compare basket and route-cost workflow are removed from the driving-first UI', () => {
  assert.doesNotMatch(html, /focus-dock-compare/);
  assert.doesNotMatch(app, /storedCompare|state\.compare|toggleCompare|data-action="compare"/);
  assert.doesNotMatch(html, /data-view="route"/);
  assert.doesNotMatch(html, /id="route-panel"/);
  assert.doesNotMatch(html, /id="open-calculator"/);
  assert.doesNotMatch(app, /compareSelectedRoute/);
});


test('mobile starts in full-map expanded mode and toggles to collapsed map chrome', () => {
  assert.match(view, /let mode = media\.matches \? 'map-browse' : 'default'/);
  assert.match(view, /if\(media\.matches\)startMobileExpanded\(\)/);
  assert.match(view, /mode==='map-browse'\)\{setMode\('map-collapsed'\)/);
  assert.match(view, /mode==='map-collapsed'\)\{setMode\('map-browse'\)/);
  assert.match(css, /body\.mobile-map-collapsed/);
});

test('detail expand control visibly includes the expansion icon on mobile', () => {
  assert.match(css, /detail-expand-toggle \.icon[\s\S]*display:inline-flex!important/);
  assert.match(view, /icon\(expanded\?'collapse':'expand'\)/);
});


test('driving-first copy no longer advertises route-cost calculation', () => {
  assert.doesNotMatch(html, /경로 비용 비교|예상 절약액의 계산 기준|가격부터 이동 비용까지/);
  assert.doesNotMatch(app, /invalidateRoutes|routeGeneration|state\.routes/);
});


test('expanded mobile fuel selector exposes every fuel choice instead of hiding inactive fuels', () => {
  assert.match(css, /fuel-tabs button\{[\s\S]*display:flex!important/);
  for (const fuel of ['B027','D047','B034','K015']) assert.match(html,new RegExp('data-fuel="'+fuel+'"'));
  assert.match(app, /render\(\);if\(\$\('detail-dialog'\)\.open\)renderDetail\(\)/);
});

test('filter popover explains each checkbox and marker color meaning clearly', () => {
  assert.match(html, /셀프 주유소만 보기/);
  assert.match(html, /최신 가격만 보기/);
  assert.match(html, /마커 색상 = 현재 유종의 가격 수준/);
  assert.match(styles, /\.filter-option strong\{[^}]*font-size:14px/);
  assert.match(styles, /\.filter-option input\{[^}]*width:22px/);
});


test('fuel type controls use circular icon badges like the filter control', () => {
  for (const icon of ['droplet','pump','star','flame']) assert.match(html,new RegExp('data-icon="'+icon+'"'));
  assert.match(styles,/\.fuel-tab-icon\{[^}]*border-radius:50%/);
  assert.match(css,/fuel-tabs \.fuel-tab-icon/);
  assert.match(css,/fuel-tabs button\.active/);
});


test('mobile default zoom uses the requested neighborhood-scale view', async () => {
  const config = await readFile(new URL('../public/config.js', import.meta.url), 'utf8');
  assert.match(config, /mobileDefaultZoom:\s*14/);
  assert.match(map, /_defaultZoom\(\)/);
  assert.match(map, /zoom:\s*this\._defaultZoom\(\)/);
  assert.match(map, /setZoom\(zoom\)/);
  assert.match(app, /APP_CONFIG\.mobileDefaultZoom\|\|14/);
});


test('Stitch b4d1 mobile design primitives are applied', () => {
  for (const id of ['mobile-search-back','voice-search','mobile-fuel-toggle']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(css,/Stitch screen b4d1b8b0777145cdb4add508dfb2bb44/);
  assert.match(css,/border-radius:999px/);
  assert.match(css,/top:calc\(24px \+ env\(safe-area-inset-top,0px\)\)/);
  assert.match(css,/border-radius:32px 32px 0 0/);
  assert.match(css,/background:#ebedf9/);
  assert.match(css,/background:#7565e3/);
});

test('Stitch search bar and fuel selector stay functional', () => {
  assert.match(app,/webkitSpeechRecognition/);
  assert.match(app,/mobileMapView\.toggleMapChrome\(\)/);
  assert.match(app,/fuel-tabs'\)\.classList\.remove\('mobile-open'\)/);
  assert.match(app,/syncMobileFuelToggle\(\)/);
});


test('detail handle drag changes actual sheet height and avoids duplicate click toggle', () => {
  assert.match(view,/--sheet-live-height/);
  assert.match(view,/viewportHeight\*\.58/);
  assert.match(view,/viewportHeight\*\.82/);
  assert.match(view,/suppressDetailHandleClick/);
  assert.match(css,/height:var\(--sheet-live-height,58dvh\)!important/);
  assert.match(css,/height:var\(--sheet-live-height,82dvh\)!important/);
});


test('initial map load requests current location before rendering nearby stations', () => {
  assert.match(app,/async function initializeMapViewport\(\)/);
  assert.match(app,/const position=await map\.locate\(\)/);
  assert.match(app,/state\.center=\{lat:position\.lat,lng:position\.lng\}/);
  assert.match(app,/updateViewport\(\{center:map\.getCenter\(\),bounds:map\.getBounds\(\)\}\)/);
  assert.match(app,/sharedStationRequested/);
  assert.match(app,/map\.init\(\)\.then\(initializeMapViewport\)/);
});
