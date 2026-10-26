import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pickListScrollStation } from '../public/js/mobile-map-view.js';

const [html, app, routeMode, map, view, css, styles] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/route-mode.js', import.meta.url), 'utf8'),
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
  assert.match(map, /resize\(\) \{[\s\S]*catch \(error\) \{ if \(this\.provider === 'naver'\) void this\._fallback/);
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
  assert.match(view, /--list-live-height/);
  assert.match(view, /setListSnap/);
  assert.match(css, /--list-live-height/);
  assert.match(css, /54dvh/);
  assert.match(css, /84dvh/);
  assert.match(css, /clamp\(270px,38dvh,340px\)/);
  assert.match(view, /listSnapHeight\('compact'\)\+listSnapHeight\('medium'\)/);
  assert.match(html, /id="mobile-focus-dock"/);
  assert.match(html, /id="mobile-list-sheet-handle"/);
  assert.match(html, /id="mobile-list-sheet-close"[\s\S]{0,180}data-icon="back"/);
  assert.match(view, /sidebar\.toggleAttribute\('data-map-overlay',listOpen\)/);
  assert.match(css, /body\.mobile-map-browse \.mobile-focus-dock/);
  assert.match(css, /body\.mobile-list-sheet\.mobile-list-expanded/);
});

test('scrolling the list selects the card crossing the focus line and activates its marker', () => {
  const viewport={top:100,bottom:500};
  assert.equal(pickListScrollStation([
    {id:'one',top:90,bottom:210},
    {id:'two',top:215,bottom:370},
    {id:'three',top:375,bottom:530},
  ],viewport),'two');
  assert.equal(pickListScrollStation([
    {id:'one',top:-50,bottom:70},
    {id:'two',top:80,bottom:190},
    {id:'three',top:195,bottom:350},
  ],viewport),'three');
  assert.equal(pickListScrollStation([],viewport),null);
  assert.match(app, /results'\)\.addEventListener\('scroll',scheduleListScrollSelection/);
  assert.match(app, /activateScrolledStation/);
  assert.match(app, /map\.focus\(station,\{preserveZoom:true\}\)/);
});

test('closing detail keeps the focused map session instead of restoring default layout', () => {
  assert.match(view, /hideDetail\(\);\s*setMode\('map-browse'\)/);
  assert.match(view, /detailReturnMode=listModes\.has\(mode\)\?'map-browse'/);
  assert.match(app, /focus-dock-list/);
  assert.match(app, /focus-rescan/);
});

test('route recommendation labels differ by rank without recoloring the station card', () => {
  assert.match(app,/route-rank rank-\$\{Number\(row\.routeRank\)\}/);
  for(const rank of [1,2,3]){
    assert.match(styles,new RegExp(`\\.route-rank\\.rank-${rank}`));
  }
  assert.match(app, /추천 \$\{Number\(row\.routeRank\)\}/);
});


test('desktop station detail uses a dedicated readable modal layout', () => {
  assert.match(html, /desktop-detail-title/);
  assert.match(styles, /@media\(min-width:1001px\)/);
  assert.match(styles, /\.detail-dialog \.detail-sheet-handle,\.detail-dialog \.detail-expand-toggle\{display:none!important\}/);
  assert.match(styles, /\.detail-dialog \.fuel-price-grid/);
});

test('compare basket stays retired while route-aware station discovery is available', () => {
  assert.doesNotMatch(html, /focus-dock-compare/);
  assert.doesNotMatch(app, /storedCompare|state\.compare|toggleCompare|data-action="compare"/);
  assert.match(html, /data-view="route"/);
  assert.match(html, /id="route-panel"/);
  assert.match(routeMode, /daycare-directions-proxy\.vercel\.app\/api\/directions/);
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


test('route mode is destination-first and keeps cost comparison out of the primary flow', () => {
  assert.match(html, /어디로 가세요\?/);
  assert.match(html, /경로상 주유소 보기/);
  assert.match(html, /현재 가격과 실제 우회시간만 간단히 보여드립니다/);
  assert.doesNotMatch(html, /평균가격|기준 단가|주유할 양|차량 연비|시간 가치/);
  assert.match(html, /class="route-options"/);
  for (const removed of ['route-liters','route-economy','route-reference-price','route-hourly','route-swap']) assert.doesNotMatch(html,new RegExp(`id="${removed}"`));
  assert.match(app, /useCurrentLocationForRoute/);
  assert.match(app, /mobileMapView\.getMode\(\)==='map-collapsed'/);
  assert.match(app, /mobileMapView\.toggleMapChrome\(\)/);
  assert.doesNotMatch(app, /routeInputNumber/);
  assert.doesNotMatch(app, /invalidateRoutes|routeGeneration|state\.routes/);
});

test('route results expose compact road-path simulation controls', () => {
  for (const control of ['route-simulation','data-simulation-play','data-simulation-restart','data-simulation-speed','data-simulation-stop']) assert.match(html,new RegExp(control));
  assert.match(app,/createRouteSimulationController/);
  assert.match(app,/useBaseRouteSimulation/);
  assert.match(app,/useStationRouteSimulation/);
  assert.match(map,/setRouteSimulationPoint/);
  assert.match(styles,/\.route-simulation\{/);
});


test('entering route mode keeps ordinary map markers until route candidates exist', () => {
  assert.match(app, /function routeFallbackMapStations/);
  assert.match(app, /const mapRows=rows\.length\?rows:routeFallbackMapStations\(\)/);
  assert.match(app, /state\.view==='route'&&finite\(row\.progressMeters\)/);
  assert.doesNotMatch(app, /state\.view==='route'\?\{value:row\.currentPrice/);
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


test('driving mode keeps map overlays upright and shows actual plus predicted travel guides', () => {
  assert.match(html,/id="drive-mode"[^>]+type="button"|type="button"[^>]+id="drive-mode"/);
  assert.match(html,/class="map-secondary-actions"[^>]+aria-label="주행 및 지도 도구"/);
  assert.match(styles,/\.map-secondary-actions\{[^}]*display:flex/);
  assert.match(styles,/@media\(min-width:761px\) and \(max-width:1366px\)\{\.map-secondary-action\{[^}]*width:48px/);
  assert.match(app,/\$\('drive-mode'\)\.addEventListener\('click'/);
  assert.match(map,/projectPoint/);
  assert.match(map,/_renderDrivingGuides/);
  assert.match(map,/strokeStyle:\s*'shortdash'/);
  assert.match(map,/dashArray:\s*'12 10'/);
  assert.match(map,/_driveTrailCoords/);
  assert.match(app,/drivingStationScore/);
  assert.match(map,/_setDrivingHeadingUp/);
  assert.match(map,/driving-guidance-active/);
  assert.doesNotMatch(styles,/\.map-surface\.heading-up/);
  assert.match(app,/파랑=이동동선/);
  assert.match(app,/refreshDrivingRoadPrediction/);
  assert.match(app,/\/route\/predict/);
  assert.match(map,/setDrivingPredictionPath/);
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
  assert.match(app,/async function initializeMapViewport\(startupDataPromise\)/);
  assert.match(app,/const position=await map\.locate\(\)/);
  assert.match(app,/state\.center=\{lat:position\.lat,lng:position\.lng\}/);
  assert.match(app,/updateViewport\(\{center:map\.getCenter\(\),bounds:map\.getBounds\(\)\}\)/);
  assert.match(app,/sharedStationRequested/);
  assert.match(app,/map\.init\(\)\.then\(\(\)=>initializeMapViewport\(startupDataPromise\)\)/);

  assert.match(app, /createMapLoadingController/);
  assert.match(app, /mapLoading\.stage\('location'\)/);
  assert.match(app, /mapLoading\.stage\('data'\)/);
  assert.match(app, /mapLoading\.stage\('markers'\)/);
  assert.match(app, /waitForMarkerRender/);
});
