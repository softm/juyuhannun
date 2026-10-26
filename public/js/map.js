import { APP_CONFIG } from '../config.js';
import { escapeHTML, getFuelPrice, freshness, FUEL_TYPES, BRANDS } from './core.js';
import { markerScale, labelBudget, markerDensityLimit, visibleStations, labelCandidates } from './marker-display.js';
import { mergeLocationSearchResults, normalizeAddressSearchResults, normalizePlaceSearchResults } from './address-search.js';
import '../shared/care-location.js';
import '../shared/care-popup-geometry.js';
import '../shared/map-marker-placement.js';

const AUTH_EVENT = 'juyuhannun:naver-auth-failed';
const LEAFLET_VERSION = '1.9.4';
const SDK_TIMEOUT = 12000;
const VWORLD_SEARCH_URL = 'https://api.vworld.kr/req/search';
const markerPriceFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
let naverTask;
let leafletTask;
let naverAuthFailed = false;
let vworldSearchSequence = 0;

const validPoint = point => point && [point.lat, point.lng].every(value => typeof value === 'number' && Number.isFinite(value)) &&
  Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
const pointFor = station => {
  const point = { lat: station?.lat ?? station?.location?.lat, lng: station?.lng ?? station?.location?.lng };
  return validPoint(point) ? point : null;
};
const abortError = (message = '이전 주소 검색이 취소되었습니다.') => Object.assign(new Error(message), { name: 'AbortError' });
const normalizeHeading = value => {
  const number = Number(value);
  return Number.isFinite(number) ? (number % 360 + 360) % 360 : null;
};
const geoDistance = (a, b) => {
  if (!validPoint(a) || !validPoint(b)) return Infinity;
  const rad = Math.PI / 180, lat1 = a.lat * rad, lat2 = b.lat * rad;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
};
const geoBearing = (a, b) => {
  if (!validPoint(a) || !validPoint(b)) return null;
  const rad = Math.PI / 180, lat1 = a.lat * rad, lat2 = b.lat * rad, dLng = (b.lng - a.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeHeading(Math.atan2(y, x) / rad);
};

const projectPoint = (origin, heading, distanceMeters) => {
  if (!validPoint(origin)) return null;
  const bearing = (normalizeHeading(heading) ?? 0) * Math.PI / 180;
  const angular = Math.max(0, Number(distanceMeters) || 0) / 6371000;
  const lat1 = origin.lat * Math.PI / 180, lng1 = origin.lng * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
};

function loadNaverSDK() {
  if (naverAuthFailed) return Promise.reject(new Error('네이버 지도 인증을 확인할 수 없습니다.'));
  if (globalThis.naver?.maps?.Map) return Promise.resolve(globalThis.naver.maps);
  if (naverTask) return naverTask;
  if (!APP_CONFIG.naverClientId) return Promise.reject(new Error('네이버 지도 연결 정보가 없습니다.'));
  naverTask = new Promise((resolve, reject) => {
    let settled = false;
    const script = document.createElement('script');
    const previousFailure = globalThis.navermap_authFailure;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { script.remove(); reject(error); }
      else resolve(globalThis.naver.maps);
    };
    globalThis.navermap_authFailure = () => {
      naverAuthFailed = true;
      document.dispatchEvent(new Event(AUTH_EVENT));
      finish(new Error('네이버 지도 인증에 실패했습니다.'));
      if (typeof previousFailure === 'function') {
        try { previousFailure(); } catch { /* Preserve this app's recoverable map state. */ }
      }
    };
    globalThis.__juyuhannunNaverReady = () => {
      if (!globalThis.naver?.maps?.Map) finish(new Error('네이버 지도를 불러오지 못했습니다.'));
      else finish();
    };
    const timer = setTimeout(() => finish(new Error('네이버 지도 연결 시간이 초과되었습니다.')), SDK_TIMEOUT);
    const url = new URL('https://oapi.map.naver.com/openapi/v3/maps.js');
    url.searchParams.set('ncpKeyId', APP_CONFIG.naverClientId);
    url.searchParams.set('submodules', 'geocoder');
    url.searchParams.set('callback', '__juyuhannunNaverReady');
    script.src = url.href;
    script.async = true;
    script.onerror = () => finish(new Error('네이버 지도 연결에 실패했습니다.'));
    document.head.append(script);
  }).catch(error => { naverTask = null; throw error; });
  return naverTask;
}

function loadLeaflet() {
  if (globalThis.L?.map && document.querySelector('link[data-juyuhannun-leaflet="ready"]')) return Promise.resolve(globalThis.L);
  if (leafletTask) return leafletTask;
  leafletTask = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@' + LEAFLET_VERSION + '/dist/leaflet.css';
    css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    css.crossOrigin = 'anonymous';
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@' + LEAFLET_VERSION + '/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = 'anonymous';
    script.async = true;
    let cssReady = false, jsReady = false, settled = false;
    const finish = error => {
      if (settled || (!error && !(cssReady && jsReady))) return;
      settled = true;
      clearTimeout(timer);
      if (error) { css.remove(); script.remove(); reject(error); }
      else resolve(globalThis.L);
    };
    const timer = setTimeout(() => finish(new Error('대체 지도 연결 시간이 초과되었습니다.')), SDK_TIMEOUT);
    css.onload = () => { cssReady = true; css.dataset.juyuhannunLeaflet = 'ready'; finish(); };
    script.onload = () => {
      jsReady = Boolean(globalThis.L?.map);
      if (!jsReady) finish(new Error('대체 지도 모듈을 불러오지 못했습니다.'));
      else finish();
    };
    css.onerror = script.onerror = () => finish(new Error('대체 지도를 불러오지 못했습니다.'));
    document.head.append(css, script);
  }).catch(error => { leafletTask = null; throw error; });
  return leafletTask;
}

function searchVWorldPlaces(query, timeout = 10000) {
  if (!APP_CONFIG.vworldSearchKey) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const callbackName = `juyuhannunVWorld${Date.now()}${++vworldSearchSequence}`;
    const script = document.createElement('script');
    const url = new URL(VWORLD_SEARCH_URL);
    let settled = false;
    const finish = (error, results = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.remove();
      try { delete globalThis[callbackName]; } catch { globalThis[callbackName] = undefined; }
      if (error) reject(error); else resolve(results);
    };
    globalThis[callbackName] = data => {
      const response = data?.response;
      if (response?.status === 'NOT_FOUND') return finish(null, []);
      if (response?.status !== 'OK') return finish(new Error(String(response?.error?.text || '장소 검색을 이용할 수 없습니다.').slice(0, 160)));
      finish(null, normalizePlaceSearchResults(response?.result?.items || []));
    };
    const timer = setTimeout(() => finish(new Error('장소 검색 시간이 초과되었습니다. 다시 검색해 주세요.')), timeout);
    for (const [key, value] of Object.entries({
      service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', size: '10', page: '1',
      query, type: 'place', format: 'json', errorformat: 'json', key: APP_CONFIG.vworldSearchKey,
      domain: location.hostname, callback: callbackName,
    })) url.searchParams.set(key, value);
    script.async = true;
    script.src = url.href;
    script.onerror = () => finish(new Error('장소 검색 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.'));
    document.head.appendChild(script);
  });
}

function markerPriceBands(stations, fuel, now = Date.now()) {
  const prices = [];
  for (const station of Array.isArray(stations) ? stations : []) {
    const info = getFuelPrice(station, fuel);
    if (!info || !Number.isFinite(Number(info.price))) continue;
    const status = freshness(info.priceUpdatedAt, info.fetchedAt, now, info.priceTimeStatus, info.sourceDate);
    if (status.eligible) prices.push(Number(info.price));
  }
  prices.sort((a,b)=>a-b);
  if (!prices.length) return { count:0, min:null, low:null, high:null };
  if (prices.length === 1) return { count:1, min:prices[0], low:prices[0], high:prices[0] };
  const last = prices.length - 1;
  const lowIndex = Math.max(0, Math.floor(last / 3));
  const highIndex = Math.min(last, Math.ceil(last * 2 / 3));
  return { count:prices.length, min:prices[0], low:prices[lowIndex], high:prices[highIndex] };
}

function markerTopPriceRanks(stations, fuel, now = Date.now(), limit = 5) {
  const rows = [];
  for (const station of Array.isArray(stations) ? stations : []) {
    if (station?.id == null) continue;
    const info = getFuelPrice(station, fuel);
    const price = Number(info?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const status = freshness(info.priceUpdatedAt, info.fetchedAt, now, info.priceTimeStatus, info.sourceDate);
    if (!status.eligible) continue;
    rows.push({ id:String(station.id), price });
  }
  rows.sort((a,b)=>a.price-b.price || a.id.localeCompare(b.id));
  return new Map(rows.slice(0, Math.max(0, limit)).map((row,index)=>[row.id,index+1]));
}

function markerTone(info, stale, bands) {
  if (stale || !info || !Number.isFinite(Number(info.price))) return 'slate';
  const price = Number(info.price);
  if (!bands || bands.count < 2) return 'orange';
  if (price <= bands.low) return 'green';
  if (price >= bands.high) return 'red';
  return 'orange';
}

const ROUTE_LINE_STYLE = Object.freeze({
  base: Object.freeze({ color:'#1d4ed8', weight:6, casingWeight:11, zIndex:60 }),
  via: Object.freeze({ color:'#7c3aed', weight:7, casingWeight:12, zIndex:80 }),
});

function installMarkerStyles() {
  if (document.getElementById('juyuhannun-map-style')) return;
  const style = document.createElement('style');
  style.id = 'juyuhannun-map-style';
  style.textContent = [
    '.juyuhannun-map{isolation:isolate;background:#eef2ef}',
    '.juyuhannun-map>.map-surface{position:absolute;inset:0;z-index:0}',
    '.map-provider-notice{position:absolute;left:12px;bottom:48px;z-index:1000;max-width:min(310px,calc(100% - 70px));padding:9px 12px;border:1px solid #d8e0dc;border-radius:10px;background:rgba(255,255,255,.97);color:#405449;font-size:12px;line-height:1.45;box-shadow:0 3px 12px #12251a12;pointer-events:none}',
    '.map-provider-notice[hidden]{display:none}',
    '.price-marker-shell{background:none!important;border:0!important}',
    '.station-marker{position:relative;width:72px;height:64px;pointer-events:none}',
    '.station-marker .price-pin{position:absolute;left:36px;bottom:7px;display:flex;align-items:center;justify-content:center;width:34px;height:34px;min-width:34px;min-height:34px;padding:0;border:3px solid #fff;border-radius:50%;background:var(--pin,#2f7df6);color:#fff;box-shadow:0 3px 10px #132b3c4a;cursor:pointer;pointer-events:auto}',
    '.station-marker .price-pin:after{content:"";position:absolute;left:50%;bottom:-7px;width:10px;height:10px;transform:translateX(-50%) rotate(45deg);border-right:3px solid #fff;border-bottom:3px solid #fff;background:var(--pin,#2f7df6);border-radius:0 0 2px 0}',
    '.station-marker.tone-green{--pin:#18a875}.station-marker.tone-orange{--pin:#efa516}.station-marker.tone-red{--pin:#e4545d}.station-marker.tone-slate{--pin:#7d8b98}',
    '.price-pin:focus-visible{outline:3px solid #f6b632;outline-offset:3px}',
    '.price-pin-glyph{display:flex;align-items:center;justify-content:center;position:relative;z-index:2}',
    '.price-pin-glyph svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2}',
    '.price-pin-value{display:none;position:relative;z-index:2;font:800 18px/1 system-ui,sans-serif}.price-pin-value small{display:none}',
    '.station-marker.is-selected{width:96px;height:92px}',
    '@keyframes selected-pin-bounce{0%{transform:translateY(0) scale(1)}28%{transform:translateY(-14px) scale(1.07)}48%{transform:translateY(0) scale(.98)}68%{transform:translateY(-7px) scale(1.035)}100%{transform:translateY(0) scale(1)}}',
    '.station-marker .price-pin.selected{left:48px;bottom:5px;width:66px;height:66px;min-width:66px;min-height:66px;border-width:4px;background:var(--pin,#347ee8);box-shadow:0 0 0 3px #fff8,0 8px 22px color-mix(in srgb,var(--pin,#347ee8) 45%,transparent);animation:selected-pin-bounce .72s cubic-bezier(.22,.8,.3,1) 1 both;transform-origin:50% 100%}',
    '.station-marker .price-pin.selected:after{bottom:-10px;width:17px;height:17px;border-width:4px;background:var(--pin,#347ee8)}',
    '.station-marker .price-pin.selected .price-pin-glyph{display:none}',
    '.station-marker .price-pin.selected .price-pin-value{display:block}',
    '@keyframes lowest-price-bounce{0%,100%{transform:translateX(-50%) translateY(0) scale(1)}18%{transform:translateX(-50%) translateY(-8px) scale(1.035)}36%{transform:translateX(-50%) translateY(0) scale(.99)}52%{transform:translateX(-50%) translateY(-4px) scale(1.018)}68%{transform:translateX(-50%) translateY(0) scale(1)}}',
    '.lowest-price-badge{position:absolute;left:36px;bottom:45px;z-index:7;display:flex;align-items:center;gap:6px;width:max-content;min-width:94px;height:38px;padding:0 10px 0 7px;border:3px solid #fff;border-radius:20px;background:#159b72;color:#fff;box-shadow:0 6px 16px #173d3252;font:800 13px/1 system-ui,sans-serif;letter-spacing:-.3px;pointer-events:auto;cursor:pointer;touch-action:manipulation;transform-origin:50% 100%;animation:lowest-price-bounce 1.6s cubic-bezier(.22,.8,.3,1) var(--rank-delay,0s) infinite}',
    '.lowest-price-badge:after{content:"";position:absolute;left:50%;bottom:-7px;width:10px;height:10px;transform:translateX(-50%) rotate(45deg);border-right:3px solid #fff;border-bottom:3px solid #fff;background:#159b72;border-radius:0 0 2px 0}',
    '.lowest-price-badge .lowest-tag{position:relative;z-index:2;padding:4px 6px;border-radius:999px;background:#e4f4ed;color:#087156;font-size:10px;font-weight:900;letter-spacing:-.4px}',
    '.lowest-price-badge.rank-1 .lowest-tag{background:#fff1ba;color:#765000}',
    '.lowest-price-badge.rank-2 .lowest-tag{background:#dceeff;color:#1f5f9e}',
    '.lowest-price-badge.rank-3 .lowest-tag{background:#f0e5ff;color:#6b42a4}',
    '.lowest-price-badge strong{position:relative;z-index:2;font-size:14px;font-weight:900;white-space:nowrap}',
    '.lowest-price-badge:focus-visible{outline:3px solid #0b5c4f;outline-offset:3px}',
    '.price-pin.is-stale:not(.selected){filter:saturate(.55);opacity:.84}',
    '.selected-station-callout{position:absolute;left:48px;bottom:82px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;width:max-content;max-width:240px;min-height:44px;padding:8px 12px 8px 9px;border:1px solid #d8e3dc;border-radius:14px;background:#fff;color:#173e34;box-shadow:0 7px 22px #102a2433;font:800 13px/1.25 system-ui,sans-serif;pointer-events:none;z-index:6}',
    '.selected-station-callout:after{content:"";position:absolute;left:50%;bottom:-7px;width:13px;height:13px;transform:translateX(-50%) rotate(45deg);border-right:1px solid #d8e3dc;border-bottom:1px solid #d8e3dc;background:#fff}',
    '.selected-station-callout .callout-pump{display:flex;align-items:center;justify-content:center;width:29px;height:29px;border-radius:50%;background:var(--pin,#347ee8);color:#fff;flex:none}',
    '.selected-station-callout .callout-pump svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2}',
    '.selected-station-callout strong{max-width:168px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.selected-station-callout b{font-size:18px;font-weight:500;color:#42675d}',
    '.price-pin-name{display:none!important}',
    '.map-surface[data-marker-scale="dot"] .price-pin:not(.selected),.map-surface.dense-markers .price-pin:not(.selected){width:15px;height:15px;min-width:15px;min-height:15px;border-width:2px;bottom:1px;box-shadow:0 1px 4px #1236}',
    'body.route-mode .map-surface[data-marker-scale="dot"] .price-pin:not(.selected),body.route-mode .map-surface.dense-markers .price-pin:not(.selected){width:18px;height:18px;min-width:18px;min-height:18px;border-width:3px;box-shadow:0 0 0 1px #0f172a4d,0 2px 7px #0f172a66}',
    '.map-surface[data-marker-scale="dot"] .price-pin:not(.selected):after,.map-surface.dense-markers .price-pin:not(.selected):after{display:none}',
    '.map-surface[data-marker-scale="dot"] .price-pin:not(.selected) .price-pin-glyph,.map-surface.dense-markers .price-pin:not(.selected) .price-pin-glyph{display:none}',
    '.map-surface[data-marker-size="small"] .price-pin:not(.selected){width:11px;height:11px;min-width:11px;min-height:11px;border-width:2px}',
    '.map-surface[data-marker-scale="pin"] .station-marker:not(.is-selected) .price-pin,.map-surface[data-marker-scale="name"] .station-marker:not(.is-selected) .price-pin,.map-surface[data-marker-scale="detail"] .station-marker:not(.is-selected) .price-pin{width:58px;height:34px;min-width:58px;min-height:34px;padding:0 8px;border-radius:18px}',
    '.map-surface[data-marker-scale="pin"] .station-marker:not(.is-selected) .price-pin-glyph,.map-surface[data-marker-scale="name"] .station-marker:not(.is-selected) .price-pin-glyph,.map-surface[data-marker-scale="detail"] .station-marker:not(.is-selected) .price-pin-glyph{display:none}',
    '.map-surface[data-marker-scale="pin"] .station-marker:not(.is-selected) .price-pin-value,.map-surface[data-marker-scale="name"] .station-marker:not(.is-selected) .price-pin-value,.map-surface[data-marker-scale="detail"] .station-marker:not(.is-selected) .price-pin-value{display:block;font-size:12px;letter-spacing:-.3px}',
    '.map-surface[data-marker-scale="detail"] .station-marker:not(.is-selected) .price-pin-value{font-size:13px}',
    '.map-you{display:block;position:relative;width:18px;height:18px;border:3px solid #fff;border-radius:50%;background:#2674db;box-shadow:0 0 0 7px #2674db30,0 2px 8px #193a6040}',
    '.map-you.is-driving{width:30px;height:30px;border-width:4px;background:#1769d7;box-shadow:0 0 0 9px #2674db26,0 4px 14px #193a6050}',
    '.map-you.is-driving:before{content:"";position:absolute;left:50%;top:-15px;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:15px solid #1769d7;transform:translateX(-50%) rotate(var(--drive-heading,0deg));transform-origin:50% 30px;filter:drop-shadow(0 1px 1px #fff)}',
    '.route-endpoint{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:3px solid #fff;border-radius:50%;color:#fff;box-shadow:0 4px 13px #183a3445;font:900 12px/1 system-ui,sans-serif}',
    '.route-endpoint-start{background:#1d4ed8}.route-endpoint-destination{background:#111827}',
    '.route-simulation-car{display:flex;align-items:center;justify-content:center;width:42px;height:42px;border:3px solid #fff;border-radius:50%;background:#0f6b57;color:#fff;box-shadow:0 0 0 7px #0f6b5726,0 6px 18px #173a3150;font:24px/1 system-ui,sans-serif}',
    '.juyuhannun-map .leaflet-control-attribution{font-size:10px;background:rgba(255,255,255,.92)}',
    '@media(max-width:1000px){.station-marker .price-pin.selected{width:70px;height:70px;min-width:70px;min-height:70px}.selected-station-callout{font-size:14px;min-height:46px}.lowest-price-badge{height:40px;min-width:98px;font-size:14px}}',
    '@media(prefers-reduced-motion:reduce){.price-pin{transition:none}.station-marker .price-pin.selected,.lowest-price-badge{animation:none}}'
  ].join('\n');
  document.head.append(style);
}

/**
 * The controller owns only physical map rendering and location input.
 * Price freshness, API query generations and road-cost calculations stay in the app.
 * setCenter/focus/locate/showRoute do not call onCenterChange.
 */
export class MapController {
  constructor(container, { onCenterChange = () => {}, onViewportChange = () => {}, onSelect = () => {}, onPick = null, onState = () => {}, markerPresentation = null } = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    if (!this.container) throw new Error('지도를 표시할 영역이 없습니다.');
    this.onCenterChange = onCenterChange;
    this.onViewportChange = onViewportChange;
    this.onSelect = onSelect;
    this.onPick = onPick;
    this.onState = onState;
    this.markerPresentation = typeof markerPresentation === 'function' ? markerPresentation : null;
    this.provider = 'none';
    this.ready = false;
    this.map = null;
    this._center = { ...APP_CONFIG.defaultCenter };
    this._stations = [];
    this._selectedId = null;
    this._fuel = 'B027';
    this._markers = new Map();
    this._markerPool = new Map();
    this._markerState = new Map();
    this._retainedLabels = new Map();
    this._renderRevision = 0;
    this._queryCenter = { ...this._center };
    this._routeCoords = [];
    this._baseRouteCoords = [];
    this._viaRouteCoords = [];
    this._routeEndpoints = null;
    this._baseRoute = null;
    this._viaRoute = null;
    this._baseRouteCasing = null;
    this._viaRouteCasing = null;
    this._routeStart = null;
    this._routeDestination = null;
    this._routeSimulationMarker = null;
    this._routeSimulationPoint = null;
    this._listeners = [];
    this._userIntent = false;
    this._suppressUntil = 0;
    this._navigationRevision = 0;
    this._locationRevision = 0;
    this._driveWatchId = null;
    this._driveHeading = null;
    this._driveTrailCoords = [];
    this._driveRoadPredictionCoords = [];
    this._driveTrail = null;
    this._drivePrediction = null;
    this._driveRoadPredictionCoords = [];
    this._drivePoint = null;
    this._driveSpeed = 0;
    this._geocodeRevision = 0;
    this._mapType = 'normal';
    this._destroyed = false;
    this._initTask = null;
    this._fallbackTask = null;
    installMarkerStyles();
    this.container.classList.add('juyuhannun-map');
    this.canvas = document.createElement('div');
    this.canvas.className = 'map-surface';
    this.canvas.setAttribute('aria-label', '주유소 가격 지도');
    this.notice = document.createElement('div');
    this.notice.className = 'map-provider-notice';
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;
    this.container.append(this.canvas, this.notice);
    this._bindDOM();
  }

  _state(status, message = '') {
    this.status = status;
    this.onState({ status, provider: this.provider, message, ready: this.ready });
  }

  _notice(message) {
    this.notice.textContent = message;
    this.notice.hidden = !message;
  }

  _bindDOM() {
    this._intentHandler = event => {
      if (event.target.closest?.('[data-station-id]')) return;
      this._navigationRevision++;
      this._userIntent = true;
      this._suppressUntil = 0;
      clearTimeout(this._centerTimer);
    };
    this._selectHandler = event => {
      const button = event.target.closest?.('[data-station-id]');
      if (!button || !this.canvas.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.stationId;
      if (!this._markers.has(id)) return;
      this.setStations(this._stations, id, this._fuel);
      this.onSelect(id);
    };
    for (const type of ['pointerdown', 'wheel', 'touchstart', 'keydown']) {
      this.canvas.addEventListener(type, this._intentHandler, { passive: true, capture: true });
    }
    this.canvas.addEventListener('click', this._selectHandler, true);
    this._authHandler = () => {
      if (this.ready && this.provider === 'naver') {
        void this._fallback(new Error('네이버 지도 인증에 실패했습니다.')).catch(() => {});
      }
    };
    document.addEventListener(AUTH_EVENT, this._authHandler);
    if (typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(this.container);
    }
  }

  resize() {
    if (!this.map || this._destroyed || this._resizeFrame) return;
    // Capture before a layout switch and resize after its CSS has taken effect.
    let initialCenter, initialZoom;
    try { initialCenter = this.getCenter(); initialZoom = this.map.getZoom(); }
    catch (error) { if (this.provider === 'naver') void this._fallback(error).catch(() => {}); return; }
    const navigationRevision = this._navigationRevision;
    this._resizeFrame = requestAnimationFrame(() => {
      this._resizeFrame = null;
      if (!this.map || this._destroyed) return;
      // A location, station or route selected meanwhile takes precedence.
      const unchanged = navigationRevision === this._navigationRevision;
      const center = unchanged ? initialCenter : this.getCenter();
      const zoom = unchanged ? initialZoom : this.map.getZoom();
      try {
        this._internal(() => {
          if (this.provider === 'naver') {
            globalThis.naver.maps.Event.trigger(this.map, 'resize');
            this.map.setCenter(this._naverPoint(center));
          } else {
            this.map.invalidateSize({ animate: false, pan: false });
            this.map.setView([center.lat, center.lng], zoom, { animate: false });
          }
        });
      } catch (error) { if (this.provider === 'naver') void this._fallback(error).catch(() => {}); return; }
      this._scheduleMarkers();
      this._scheduleViewportChange();
    });
  }

  async init() {
    if (this._destroyed) throw new Error('종료된 지도를 다시 열 수 없습니다.');
    if (this.ready) return this;
    if (this._initTask) return this._initTask;
    this._state('loading', '지도를 불러오는 중입니다.');
    this._notice('지도를 불러오는 중입니다.');
    this._initTask = (async () => {
      try {
        await loadNaverSDK();
        if (this._destroyed) throw new Error('지도 열기가 취소되었습니다.');
        if (naverAuthFailed) throw new Error('네이버 지도 인증에 실패했습니다.');
        this._initNaver();
        this.ready = true;
        this._notice('');
        this._state('ready', '네이버 지도');
      } catch (error) {
        if (this._destroyed) throw error;
        await this._fallback(error);
      }
      this.setStations(this._stations, this._selectedId, this._fuel);
      return this;
    })().catch(error => { this._initTask = null; throw error; });
    return this._initTask;
  }

  _naverPoint(point) { return new globalThis.naver.maps.LatLng(point.lat, point.lng); }

  _defaultZoom() {
    const mobile = globalThis.matchMedia?.('(max-width:1000px)')?.matches === true;
    const configured = mobile ? APP_CONFIG.mobileDefaultZoom : APP_CONFIG.defaultZoom;
    return Number.isFinite(Number(configured)) ? Number(configured) : 13;
  }

  _initNaver() {
    const maps = globalThis.naver.maps;
    this.provider = 'naver';
    this._mapType = 'normal';
    this.map = new maps.Map(this.canvas, {
      center: this._naverPoint(this._center), zoom: this._defaultZoom(),
      minZoom: 7, maxZoom: 19, mapTypeId: maps.MapTypeId.NORMAL,
      zoomControl: false,
      scrollWheel: true, pinchZoom: true, draggable: true
    });
    const listen = (name, callback) => this._listeners.push(maps.Event.addListener(this.map, name, callback));
    listen('dragstart', () => { this._navigationRevision++; this._userIntent = true; this._suppressUntil = 0; clearTimeout(this._centerTimer); });
    listen('zoom_changed', () => this._updateMarkerScale());
    listen('idle', () => this._idle());
    listen('click', event => {
      const point = { lat: event.coord?.lat(), lng: event.coord?.lng() };
      if (validPoint(point)) this.onPick?.(point);
    });
  }

  async _fallback(reason) {
    if (this._fallbackTask) return this._fallbackTask;
    this._fallbackTask = (async () => {
      const center = this.getCenter();
      this._notice('네이버 지도 연결을 확인하지 못해 대체 지도를 여는 중입니다.');
      this._state('fallback-loading', reason.message);
      await loadLeaflet();
      if (this._destroyed) throw new Error('지도 열기가 취소되었습니다.');
      this._disposeMap();
      this.provider = 'leaflet';
      this._mapType = 'normal';
      const L = globalThis.L;
      this.map = L.map(this.canvas, {
        center: [center.lat, center.lng], zoom: this._defaultZoom(),
        minZoom: 5, maxZoom: 19, zoomControl: false, attributionControl: true
      });
      L.control.zoom({ position: 'topright' }).addTo(this.map);
      const tiles = L.tileLayer(APP_CONFIG.fallbackTileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: APP_CONFIG.fallbackAttribution,
        updateWhenIdle: true, keepBuffer: 1
      }).addTo(this.map);
      let failures = 0;
      tiles.on('tileload', () => { failures = 0; });
      tiles.on('tileerror', () => {
        failures++;
        if (failures >= 3) {
          this._notice('지도 타일 연결이 원활하지 않습니다. 주유소 목록을 이용해 주세요.');
          this._state('tile-error', '지도 타일을 불러오지 못했습니다. 가격 목록은 계속 사용할 수 있습니다.');
        }
      });
      this.map.on('dragstart', () => { this._navigationRevision++; this._userIntent = true; this._suppressUntil = 0; clearTimeout(this._centerTimer); });
      this.map.on('zoom', () => this._updateMarkerScale());
      this.map.on('moveend zoomend', () => this._idle());
      this.map.on('click', event => this.onPick?.({ lat: event.latlng.lat, lng: event.latlng.lng }));
      this.ready = true;
      this._center = center;
      this._notice('네이버 지도를 연결하지 못해 OpenStreetMap 지도로 표시합니다.');
      this._state('fallback', 'OpenStreetMap 지도 · 네이버 지도 연결을 확인하지 못했습니다.');
      this.setStations(this._stations, this._selectedId, this._fuel);
      if (this._baseRouteCoords.length > 1) this.showRoute(this._baseRouteCoords,{kind:'base',fitBounds:true,...(this._routeEndpoints||{})});
      if (this._viaRouteCoords.length > 1) this.showRoute(this._viaRouteCoords,{kind:'via',fitBounds:false});
      if (this._youPoint) this._showYou(this._youPoint, { heading: this._driveHeading, driving: this._driveWatchId != null });
      if (this._routeSimulationPoint) this.setRouteSimulationPoint(this._routeSimulationPoint);
      if (this._driveWatchId != null) { this._setDrivingHeadingUp(this._driveHeading, true); this._setDrivingInteraction(true); }
    })().catch(error => {
      this.ready = false;
      this._notice('지도를 불러오지 못했습니다. 주유소 가격 목록은 계속 사용할 수 있습니다.');
      this._state('error', '지도를 불러오지 못했습니다. 가격 목록은 계속 사용할 수 있습니다.');
      throw error;
    }).finally(() => { this._fallbackTask = null; });
    return this._fallbackTask;
  }

  _internal(action) {
    this._userIntent = false;
    this._suppressUntil = Date.now() + 900;
    clearTimeout(this._centerTimer);
    action();
  }

  _idle() {
    if (!this.map || this._destroyed) return;
    this._center = this.getCenter();
    this._scheduleMarkers();
    this._scheduleViewportChange();
    if (!this._userIntent || Date.now() < this._suppressUntil) return;
    clearTimeout(this._centerTimer);
    this._centerTimer = setTimeout(() => {
      if (!this._userIntent || !this.ready || this._destroyed) return;
      this._userIntent = false;
      const center = this.getCenter();
      const signature = [center.lat.toFixed(6), center.lng.toFixed(6), this.map.getZoom()].join(',');
      if (signature === this._lastNotified) return;
      this._lastNotified = signature;
      const zoomOnly = Math.abs(center.lat - this._queryCenter.lat) < 0.000001 && Math.abs(center.lng - this._queryCenter.lng) < 0.000001;
      this._queryCenter = { ...center };
      this.onCenterChange(center, { zoomOnly });
    }, 450);
  }

  _scheduleViewportChange() {
    clearTimeout(this._viewportTimer);
    this._viewportTimer = setTimeout(() => {
      if (!this.map || !this.ready || this._destroyed) return;
      const center = this.getCenter(), bounds = this.getBounds(), zoom = this.map.getZoom();
      if (!bounds) return;
      const signature = [center.lat,center.lng,zoom,bounds.south,bounds.north,bounds.west,bounds.east].map(n=>Number(n).toFixed(6)).join(',');
      if (signature === this._lastViewport) return;
      this._lastViewport = signature;
      // Bounds changes include pure zoom, programmatic focus and container resizing.
      this.onViewportChange({ center, bounds, zoom });
    }, 120);
  }

  getCenter() {
    const center = this.map?.getCenter();
    if (!center) return { ...this._center };
    return this.provider === 'naver' ? { lat: center.lat(), lng: center.lng() } : { lat: center.lat, lng: center.lng };
  }

  getBounds() {
    if (!this.map) return null;
    const bounds = this.map.getBounds();
    return this.provider === 'naver'
      ? { south: bounds.getSW().lat(), north: bounds.getNE().lat(), west: bounds.getSW().lng(), east: bounds.getNE().lng() }
      : { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() };
  }

  setCenter(point) {
    if (!validPoint(point)) throw new Error('지도 좌표가 올바르지 않습니다.');
    this._navigationRevision++;
    this._center = { ...point };
    this._queryCenter = { ...point };
    if (this.map) this._internal(() => {
      if (this.provider === 'naver') this.map.setCenter(this._naverPoint(point));
      else this.map.setView([point.lat, point.lng], this.map.getZoom(), { animate: false });
    });
    return { ...point };
  }

  setZoom(zoom) {
    if (!this.map || this._destroyed) return null;
    const min = this.provider === 'naver' ? 7 : 5, max = 19;
    const next = Math.max(min, Math.min(max, Number(zoom)));
    if (!Number.isFinite(next)) return null;
    this._navigationRevision++;
    this._internal(() => {
      if (this.provider === 'naver') this.map.setZoom(next);
      else this.map.setZoom(next, { animate: false });
    });
    return next;
  }

  getZoom(){
    const zoom=Number(this.map?.getZoom?.());
    return Number.isFinite(zoom)?zoom:this._defaultZoom();
  }

  zoomBy(delta = 1) {
    if (!this.map || this._destroyed) return null;
    const current = Number(this.map.getZoom());
    if (!Number.isFinite(current)) return null;
    const min = this.provider === 'naver' ? 7 : 5, max = 19;
    const next = Math.max(min, Math.min(max, current + (Number(delta) || 0)));
    if (next === current) return next;
    this._navigationRevision++;
    this._internal(() => {
      if (this.provider === 'naver') this.map.setZoom(next);
      else this.map.setZoom(next, { animate: false });
    });
    return next;
  }

  toggleMapType() {
    if (!this.map || this._destroyed || this.provider !== 'naver') return { supported: false, type: this._mapType };
    const maps = globalThis.naver?.maps;
    if (!maps?.MapTypeId?.NORMAL || !maps?.MapTypeId?.SATELLITE || typeof this.map.setMapTypeId !== 'function') return { supported: false, type: this._mapType };
    const next = this._mapType === 'satellite' ? 'normal' : 'satellite';
    this.map.setMapTypeId(next === 'satellite' ? maps.MapTypeId.SATELLITE : maps.MapTypeId.NORMAL);
    this._mapType = next;
    return { supported: true, type: next };
  }

  async waitForMarkerRender({ timeoutMs = 4000 } = {}) {
    const started=performance.now();
    return new Promise(resolve=>{
      const check=()=>{
        if(this._destroyed||!this._markerFrame){resolve({count:this._markers.size,timedOut:false});return;}
        if(performance.now()-started>=timeoutMs){resolve({count:this._markers.size,timedOut:true});return;}
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  setStations(stations, selectedId = null, fuel = 'B027') {
    this._stations = Array.isArray(stations) ? stations : [];
    this._selectedId = selectedId == null ? null : String(selectedId);
    this._fuel = fuel;
    const now = Date.now();
    this._priceBands = markerPriceBands(this._stations, this._fuel, now);
    this._priceRanks = markerTopPriceRanks(this._stations, this._fuel, now, 5);
    this._scheduleMarkers();
  }

  _updateMarkerScale() {
    if (!this.map) return;
    const zoom = this.map.getZoom(), scale = markerScale(zoom), size = zoom < 12 ? 'small' : 'normal';
    if (this.canvas.dataset.markerScale === scale && this.canvas.dataset.markerSize === size) return;
    this.canvas.dataset.markerSize = size;
    // CSS changes the shape at the existing anchor; zoom never replaces SDK icons.
    this.canvas.dataset.markerScale = scale;
    this._layoutLabels();
  }

  _scheduleMarkers() {
    if (!this.map || !this.ready || this._destroyed) return;
    this._updateMarkerScale();
    const revision = ++this._renderRevision;
    cancelAnimationFrame(this._markerFrame);
    cancelAnimationFrame(this._labelFrame);
    this._markerFrame = requestAnimationFrame(() => this._renderMarkers(revision));
  }

  _renderMarkers(revision) {
    if (revision !== this._renderRevision || !this.ready || this._destroyed) return;
    const rows = visibleStations(this._stations, this.getBounds(), this._selectedId);
    const ids = new Set(rows.map(row => String(row.id)));
    const scale = markerScale(this.map.getZoom());
    this.canvas.classList.toggle('dense-markers', scale === 'dot' && rows.length > markerDensityLimit(this.canvas.clientWidth, this.canvas.clientHeight));
    const removed = [...this._markers.keys()].filter(id => !ids.has(id));
    let removeIndex = 0, rowIndex = 0;
    const now = Date.now();
    const batch = () => {
      if (revision !== this._renderRevision || !this.ready || this._destroyed) return;
      const started = performance.now();
      let count = 0;
      // Bound SDK/DOM work per frame, including removal. A new view cancels old work.
      while (count < 64 && performance.now() - started < 6) {
        if (removeIndex < removed.length) { this._parkMarker(removed[removeIndex++]); count++; }
        else if (rowIndex < rows.length) { if (this._upsertMarker(rows[rowIndex++], now)) count++; }
        else {
          this._markerFrame = null;
          this._layoutLabels();
          return;
        }
      }
      this._markerFrame = requestAnimationFrame(batch);
    };
    batch();
  }

  _parkMarker(id) {
    const marker = this._markers.get(id);
    if (!marker) return;
    this._removeMarker(marker);
    this._markers.delete(id);
    this._markerPool.set(id, marker);
    // Reuse nearby/filter return visits without retaining nationwide DOM overlays.
    while (this._markerPool.size > 800) {
      const oldest = this._markerPool.keys().next().value;
      this._markerPool.delete(oldest);
      this._markerState.delete(oldest);
    }
  }

  _upsertMarker(row, now) {
    const id = String(row.id), point = pointFor(row), selected = id === this._selectedId;
    const previous = this._markerState.get(id);
    const cached = this._markers.get(id);
    const info = getFuelPrice(row, this._fuel);
    const presentation = this.markerPresentation?.(row, { fuel: this._fuel });
    const confidence = info ? freshness(info.priceUpdatedAt, info.fetchedAt, now, info.priceTimeStatus, info.sourceDate) : { eligible: false, label: '가격 미제공' };
    const stale = presentation ? presentation.stale !== false : !confidence.eligible;
    const tone = presentation ? (stale ? 'slate' : presentation.tone||'orange') : markerTone(info, stale, this._priceBands);
    const numericPrice=Number(info?.price);
    const presentationRank=Number(presentation?.rank);
    const priceRank=Number.isInteger(presentationRank)&&presentationRank>=1&&presentationRank<=5?presentationRank:!presentation&&!stale?(this._priceRanks?.get(id)??null):null;
    const isTopPrice=Number.isInteger(priceRank)&&priceRank>=1&&priceRank<=5;
    const sourceKey = JSON.stringify([point, row.name, row.brand, row.facilities?.self, row.roadAddress, row.address, this._fuel, selected, priceRank, info, presentation, tone, this._priceBands, Math.floor(now / 60000)]);
    if (cached && previous?.sourceKey === sourceKey) return false;
    const price = presentation ? String(presentation.value ?? '미확인') : Number.isFinite(numericPrice) && numericPrice > 0 ? markerPriceFormat.format(numericPrice) : '미확인';
    const numericPresentation=Number(presentation?.value);
    const visiblePrice=Number.isFinite(numericPrice)&&numericPrice>0?markerPriceFormat.format(numericPrice):(Number.isFinite(numericPresentation)&&numericPresentation>0?markerPriceFormat.format(numericPresentation):'—');
    const fuelName = FUEL_TYPES.find(item => item.code === this._fuel)?.name || '유종';
    const label = presentation ? String(presentation.label || row.name) : row.name + ', ' + fuelName + ' ' + (info ? price + '원' : '가격 미확인') + ', ' + confidence.label;
    const unit = presentation ? String(presentation.unit || '') : info ? '원' : '';
    const facts = [BRANDS[row.brand] || row.brand, row.facilities?.self === true ? '셀프' : row.facilities?.self === false ? '일반' : null, info?.sourceDate ? info.sourceDate + ' 기준' : confidence.label].filter(Boolean).join(' · ');
    const callout=selected?'<div class="selected-station-callout"><span class="callout-pump" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="12" height="17" rx="2"/><path d="M6 7h6v4H6ZM1 21h16m-2-8h2v5a2 2 0 0 0 4 0V8l-4-4m3 3v4h1"/></svg></span><strong>'+escapeHTML(row.name||'주유소')+'</strong><b aria-hidden="true">›</b></div>':'';
    const rankLabel=presentation?.badgeLabel&&priceRank?String(presentation.badgeLabel).replace('{rank}',String(priceRank)):priceRank===1?'최저':priceRank?priceRank+'위':'';
    const rankDelay=priceRank?((priceRank-1)*0.12).toFixed(2)+'s':'0s';
    const lowestBadge=isTopPrice&&!selected?'<button type="button" class="lowest-price-badge rank-'+priceRank+'" style="--rank-delay:'+rankDelay+'" data-station-id="'+escapeHTML(id)+'" aria-label="'+escapeHTML((row.name||'주유소')+' '+rankLabel+' '+visiblePrice+'원 상세 보기')+'" title="'+escapeHTML((row.name||'주유소')+' 상세 보기')+'"><span class="lowest-tag">'+escapeHTML(rankLabel)+'</span><strong>'+escapeHTML(visiblePrice)+'원</strong></button>':'';
    const detailLabel=selected?'':'<span class="price-pin-name"><span class="price-label-title">'+escapeHTML(row.name || '주유소')+'</span><span class="price-label-value">'+escapeHTML(visiblePrice+(visiblePrice!=='—'?unit:''))+'</span><span class="price-label-detail">'+escapeHTML(facts)+'</span></span>';
    const content = '<div class="station-marker tone-' + tone + (selected ? ' is-selected' : '') + (isTopPrice ? ' is-lowest rank-'+priceRank : '') + '">'+lowestBadge+callout+'<button type="button" class="price-pin' + (selected ? ' selected' : '') +
      (stale ? ' is-stale' : '') + '" data-station-id="' + escapeHTML(id) +
      '" aria-label="' + escapeHTML(label) + '" aria-pressed="' + selected + '" title="' + escapeHTML(label) +
      '"><span class="price-pin-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="12" height="17" rx="2"/><path d="M6 7h6v4H6ZM1 21h16m-2-8h2v5a2 2 0 0 0 4 0V8l-4-4m3 3v4h1"/></svg></span><span class="price-pin-value">' + escapeHTML(visiblePrice) +
      (visiblePrice!=='—'&&unit ? '<small>' + escapeHTML(unit) + '</small>' : '') + '</span>'+detailLabel+'</button></div>';
    let marker = this._markers.get(id) || this._markerPool.get(id);
    const zIndex = selected ? 5000 : isTopPrice ? 4100-priceRank*10 : this._retainedLabels.has(id) ? 1000 : 100;
    const changed = !previous || previous.content !== content;
    const moved = !previous || previous.lat !== point.lat || previous.lng !== point.lng;
    const makeIcon = () => {
      const size = selected ? [96, 92] : [72, 64];
      const anchor = selected ? [48, 78] : [36, 51];
      return this.provider === 'naver'
        ? { content, anchor: new globalThis.naver.maps.Point(anchor[0], anchor[1]) }
        : globalThis.L.divIcon({ className: 'price-marker-shell', html: content, iconSize: size, iconAnchor: anchor });
    };
    if (!marker) {
      marker = this.provider === 'naver'
        ? new globalThis.naver.maps.Marker({ map: this.map, position: this._naverPoint(point), title: row.name, icon: makeIcon(), zIndex })
        : globalThis.L.marker([point.lat, point.lng], { icon: makeIcon(), keyboard: false, bubblingMouseEvents: false, title: row.name, zIndexOffset: zIndex }).addTo(this.map);
    } else {
      if (moved) {
        if (this.provider === 'naver') marker.setPosition(this._naverPoint(point));
        else marker.setLatLng([point.lat, point.lng]);
      }
      if (changed) marker.setIcon(makeIcon());
      if (previous?.zIndex !== zIndex) {
        if (this.provider === 'naver') marker.setZIndex(zIndex);
        else marker.setZIndexOffset(zIndex);
      }
      if (this._markerPool.has(id)) {
        if (this.provider === 'naver') marker.setMap(this.map);
        else marker.addTo(this.map);
        this._markerPool.delete(id);
      }
    }
    this._markers.set(id, marker);
    this._markerState.set(id, { content, lat: point.lat, lng: point.lng, zIndex, sourceKey, lowest:isTopPrice, rank:priceRank });
    return !cached || changed || moved || previous?.zIndex !== zIndex;
  }

  _setMarkerLayer(id, emphasized) {
    const marker = this._markers.get(id), state = this._markerState.get(id);
    const zIndex = id === this._selectedId ? 5000 : state?.rank ? 4100-state.rank*10 : emphasized ? 1000 : 100;
    if (!marker || !state || state.zIndex === zIndex) return;
    if (this.provider === 'naver') marker.setZIndex(zIndex);
    else marker.setZIndexOffset(zIndex);
    state.zIndex = zIndex;
  }

  _layoutLabels() {
    cancelAnimationFrame(this._labelFrame);
    this._labelFrame = requestAnimationFrame(() => {
      if (!this.ready || this._destroyed) return;
      const bounds = this.canvas.getBoundingClientRect();
      const zoom = this.map.getZoom(), budget = labelBudget(zoom, bounds.width, bounds.height);
      const ids = labelCandidates(this._markers.keys(), this._selectedId, this._retainedLabels, budget);
      // Only a bounded set of labels is measured, never every nationwide marker.
      const wanted = new Set([...ids, ...this._retainedLabels.keys()]);
      const nodes = [...this.canvas.querySelectorAll('[data-station-id]')].filter(node => wanted.has(node.dataset.stationId));
      const byId = new Map(nodes.map(node => [node.dataset.stationId, node]));
      for (const node of nodes) {
        node.classList.remove('label-visible', 'label-measure', 'label-detail');
        const label = node.querySelector('.price-pin-name');
        if (label) label.style.transform = 'translateX(-50%)';
      }
      const candidates = ids.map(id => ({ id, node: byId.get(id) })).filter(item => item.node && item.id !== this._selectedId && item.node.querySelector('.price-pin-name'));
      const controls = [...this.container.parentElement.querySelectorAll('.map-top,.map-bottom,.map-actions,.map-notice,[data-map-overlay]')]
        .filter(node => !node.hidden).map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height);
      // Batch style writes and measurements by level to avoid per-label forced layouts.
      candidates.forEach(item => item.node.classList.add('label-measure'));
      candidates.forEach(item => {
        item.label = item.node.querySelector('.price-pin-name');
        item.pin = item.node.getBoundingClientRect();
        item.rects = [item.label.getBoundingClientRect()];
      });
      if (zoom >= 18) {
        candidates.forEach(item => item.node.classList.add('label-detail'));
        candidates.forEach(item => item.rects.push(item.label.getBoundingClientRect()));
      }
      candidates.forEach(item => item.node.classList.remove('label-measure', 'label-detail'));
      const occupied = [...controls], retained = new Map();
      let remaining = budget;
      for (const item of candidates) {
        const selected = item.id === this._selectedId;
        if (!remaining && !selected) continue;
        const placement = globalThis.CareMarkerPlacement.fit(item.rects, item.pin, bounds, occupied, this._retainedLabels.get(item.id) || 'top');
        if (!placement && !selected) continue;
        item.node.classList.add('label-visible');
        if (placement?.level > 0) item.node.classList.add('label-detail');
        if (placement) {
          item.label.style.transform = 'translateX(-50%) translate(' + placement.dx + 'px,' + placement.dy + 'px)';
          occupied.push(placement.rect);
        } else occupied.push(item.rects[0]);
        retained.set(item.id, placement?.side || 'top');
        if (!selected) remaining--;
      }
      // SDK overlays form separate stacking contexts; a label needs its marker above dots.
      for (const id of new Set([...this._retainedLabels.keys(), ...retained.keys()])) this._setMarkerLayer(id, retained.has(id));
      this._retainedLabels = retained;
    });
  }

  focus(station, { preserveZoom = true } = {}) {
    const point = pointFor(station);
    if (!point) throw new Error('이 주유소의 위치를 확인할 수 없습니다.');
    this._navigationRevision++;
    this._selectedId = String(station.id);
    this.setStations(this._stations, this._selectedId, this._fuel);
    let target = point;
    if (this.map) {
      const panel = [...document.querySelectorAll('[data-map-overlay]')].find(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.hidden;
      });
      target = globalThis.CarePopupGeometry.focusCenter(point, this.getBounds(), this.canvas.getBoundingClientRect(),
        panel?.getBoundingClientRect(), { top: 60, right: 28, bottom: 50, left: 28, gap: 18 });
      this._internal(() => {
        if (this.provider === 'naver') {
          this.map.panTo(this._naverPoint(target));
          if (!preserveZoom) this.map.setZoom(15);
        } else this.map.setView([target.lat, target.lng], preserveZoom ? this.map.getZoom() : 15, { animate: false });
      });
    }
    this._center = target;
    this._queryCenter = { ...target };
    return { ...point };
  }

  async locate() {
    const navigationRevision = this._navigationRevision;
    const locationRevision = ++this._locationRevision;
    const isCurrent = () => !this._destroyed && navigationRevision === this._navigationRevision && locationRevision === this._locationRevision;
    const point = await globalThis.CareLocation.request({ isCurrent });
    if (!isCurrent()) throw abortError('지도 위치가 바뀌어 이전 위치 요청을 취소했습니다.');
    this._youPoint = point;
    this.setCenter(point);
    this._showYou(point);
    return { ...point };
  }

  _setDrivingHeadingUp(heading, active = true) {
    // Naver Maps JS does not expose a native bearing/rotation control.
    // Rotating the entire map DOM also rotates baked map labels and station overlays,
    // so keep the base map north-up and express travel direction with the vehicle arrow
    // plus trail/prediction guides.
    if (!this.canvas) return;
    this.canvas.classList.toggle('driving-guidance-active',Boolean(active));
    this.canvas.style.setProperty('--drive-heading',String(normalizeHeading(heading) ?? 0));
  }

  _setDrivingInteraction(active) {
    if (!this.map) return;
    try {
      if (this.provider === 'naver') {
        this.map.setOptions?.({
          draggable: !active,
          scrollWheel: !active,
          pinchZoom: !active
        });
      } else {
        const toggle=(control,enable)=>{ if (!control) return; try { enable ? control.enable?.() : control.disable?.(); } catch {} };
        toggle(this.map.dragging,!active);
        toggle(this.map.scrollWheelZoom,!active);
        toggle(this.map.touchZoom,!active);
        toggle(this.map.doubleClickZoom,!active);
      }
    } catch {}
  }

  _drivingCenter(point, heading, speed = 0) {
    const bounds = this.getBounds();
    if (!bounds) return { ...point };
    const latSpan = Math.max(0.003, Math.abs(bounds.north - bounds.south));
    const visibleMeters = latSpan * 111320;
    const speedFactor = Math.max(0, Math.min(1, Number(speed) / 28));
    const leadMeters = Math.max(180, Math.min(1800, visibleMeters * (0.16 + speedFactor * 0.08)));
    return projectPoint(point, heading, leadMeters) || { ...point };
  }

  isDriving() {
    return this._driveWatchId != null;
  }

  _clearDrivingGuides() {
    if (this._driveTrail) this._removeMarker(this._driveTrail);
    if (this._drivePrediction) this._removeMarker(this._drivePrediction);
    this._driveTrail = null;
    this._drivePrediction = null;
  }

  setDrivingPredictionPath(coordinates) {
    if (!Array.isArray(coordinates)) return false;
    const next=coordinates.map(pair=>Array.isArray(pair)?{lng:Number(pair[0]),lat:Number(pair[1])}:{lat:Number(pair?.lat),lng:Number(pair?.lng)}).filter(validPoint);
    if (next.length < 2) return false;
    this._driveRoadPredictionCoords=next.slice(0,240);
    if (this._drivePoint) this._renderDrivingGuides(this._drivePoint,this._driveHeading,this._driveSpeed);
    return true;
  }

  _renderDrivingGuides(point, heading, speed = 0) {
    if (!this.map || !validPoint(point)) return;
    const previous = this._driveTrailCoords.at(-1);
    if (!previous || geoDistance(previous, point) >= 4) {
      this._driveTrailCoords.push({ ...point, at: Date.now() });
      if (this._driveTrailCoords.length > 120) this._driveTrailCoords.splice(0, this._driveTrailCoords.length - 120);
    }
    const trailPoints = this._driveTrailCoords.map(({ lat, lng }) => ({ lat, lng }));
    const horizon = Math.max(900, Math.min(5000, (Number(speed) || 0) * 120));
    const fallbackPredicted = [0.28,0.56,0.8,1].map(ratio => projectPoint(point, heading, horizon * ratio)).filter(Boolean);
    const predicted = this._driveRoadPredictionCoords.length > 1 ? this._driveRoadPredictionCoords.map(p=>({lat:p.lat,lng:p.lng})) : fallbackPredicted;

    this._clearDrivingGuides();
    if (this.provider === 'naver') {
      const maps = globalThis.naver.maps;
      if (trailPoints.length > 1) {
        this._driveTrail = new maps.Polyline({
          map: this.map,
          path: trailPoints.map(p => new maps.LatLng(p.lat, p.lng)),
          strokeColor: '#1769d7',
          strokeWeight: 5,
          strokeOpacity: 0.72
        });
      }
      if (predicted.length) {
        this._drivePrediction = new maps.Polyline({
          map: this.map,
          path: [point,...predicted].map(p => new maps.LatLng(p.lat, p.lng)),
          strokeColor: '#0f6b57',
          strokeWeight: 5,
          strokeOpacity: 0.78,
          strokeStyle: 'shortdash'
        });
      }
    } else {
      if (trailPoints.length > 1) {
        this._driveTrail = globalThis.L.polyline(trailPoints.map(p => [p.lat,p.lng]), {
          color: '#1769d7', weight: 5, opacity: .72
        }).addTo(this.map);
      }
      if (predicted.length) {
        this._drivePrediction = globalThis.L.polyline([point,...predicted].map(p => [p.lat,p.lng]), {
          color: '#0f6b57', weight: 5, opacity: .78, dashArray: '12 10'
        }).addTo(this.map);
      }
    }
  }

  startDriving({ onUpdate = () => {}, onError = () => {} } = {}) {
    if (this._destroyed) throw new Error('종료된 지도에서는 주행 추적을 시작할 수 없습니다.');
    if (!navigator.geolocation?.watchPosition) throw new Error('이 브라우저에서는 실시간 위치 추적을 지원하지 않습니다.');
    if (this._driveWatchId != null) return true;
    let previousPoint = this._drivePoint;
    let lastHeading = normalizeHeading(this._driveHeading);
    const errorMessage = error => {
      if (error?.code === 1) return '주행 추적을 사용하려면 위치 권한을 허용해 주세요.';
      if (error?.code === 2) return '현재 위치 신호를 받을 수 없습니다. GPS 상태를 확인해 주세요.';
      if (error?.code === 3) return '현재 위치 확인 시간이 초과되었습니다.';
      return '주행 위치를 확인하지 못했습니다.';
    };
    const success = position => {
      if (this._destroyed || this._driveWatchId == null) return;
      const point = { lat: Number(position.coords.latitude), lng: Number(position.coords.longitude) };
      if (!validPoint(point)) return;
      const moved = previousPoint ? geoDistance(previousPoint, point) : 0;
      let heading = normalizeHeading(position.coords.heading);
      if (heading == null && previousPoint && moved >= 4) heading = geoBearing(previousPoint, point);
      if (heading == null) heading = lastHeading;
      if (heading == null) heading = 0;
      const speed = Number.isFinite(Number(position.coords.speed)) && Number(position.coords.speed) >= 0 ? Number(position.coords.speed) : 0;
      lastHeading = heading;
      previousPoint = point;
      this._drivePoint = { ...point };
      this._driveHeading = heading;
      this._driveSpeed = speed;
      this._youPoint = { ...point };
      this._setDrivingHeadingUp(heading, true);
      this._showYou(point, { heading, driving: true });
      this._renderDrivingGuides(point, heading, speed);

      if (this.map && this.ready) {
        const currentZoom = Number(this.map.getZoom());
        const targetZoom = speed >= 22 ? 13 : speed >= 11 ? 14 : 15;
        const camera = this._drivingCenter(point, heading, speed);
        this._center = { ...camera };
        this._queryCenter = { ...camera };
        this._internal(() => {
          if (this.provider === 'naver') {
            if (Number.isFinite(currentZoom) && currentZoom !== targetZoom) this.map.setZoom(targetZoom);
            this.map.panTo(this._naverPoint(camera));
          } else {
            this.map.setView([camera.lat, camera.lng], targetZoom, { animate: false });
          }
        });
        this._scheduleMarkers();
        this._scheduleViewportChange();
      }
      onUpdate({
        point: { ...point },
        heading,
        speed,
        accuracy: Number(position.coords.accuracy) || null,
        timestamp: Number(position.timestamp) || Date.now()
      });
    };
    const failure = error => {
      const wrapped = new Error(errorMessage(error));
      wrapped.cause = error;
      onError(wrapped);
    };
    try {
      this._setDrivingInteraction(true);
      this._driveWatchId = navigator.geolocation.watchPosition(success, failure, {
        enableHighAccuracy: true,
        maximumAge: 1500,
        timeout: 12000
      });
    } catch (error) {
      this._driveWatchId = null;
      throw error;
    }
    return true;
  }

  stopDriving({ keepMarker = true } = {}) {
    if (this._driveWatchId != null && navigator.geolocation?.clearWatch) {
      try { navigator.geolocation.clearWatch(this._driveWatchId); } catch { /* ignore browser cleanup errors */ }
    }
    this._driveWatchId = null;
    this._driveSpeed = 0;
    this._setDrivingHeadingUp(0, false);
    this._setDrivingInteraction(false);
    this._clearDrivingGuides();
    this._driveTrailCoords = [];
    if (!keepMarker && this._you) {
      this._removeMarker(this._you);
      this._you = null;
      this._youPoint = null;
    } else if (keepMarker && this._youPoint) {
      this._showYou(this._youPoint, { heading: this._driveHeading, driving: false });
    }
  }

  _showYou(point, { heading = null, driving = false } = {}) {
    if (!this.map) return;
    const normalized = normalizeHeading(heading) ?? 0;
    const content = '<span class="map-you' + (driving ? ' is-driving' : '') + '" style="--drive-heading:' + normalized.toFixed(1) + 'deg" aria-label="' + (driving ? '주행 중 현재 위치' : '내 위치') + '"></span>';
    const size = driving ? 30 : 18;
    const anchor = size / 2;
    if (this.provider === 'naver') {
      const icon = { content, anchor: new globalThis.naver.maps.Point(anchor, anchor) };
      if (this._you) {
        this._you.setPosition(this._naverPoint(point));
        this._you.setIcon(icon);
        this._you.setZIndex(6000);
      } else {
        this._you = new globalThis.naver.maps.Marker({ map: this.map, position: this._naverPoint(point), title: '내 위치', zIndex: 6000, icon });
      }
      return;
    }
    const icon = globalThis.L.divIcon({ className: 'price-marker-shell', html: content, iconSize: [size, size], iconAnchor: [anchor, anchor] });
    if (this._you) {
      this._you.setLatLng([point.lat, point.lng]);
      this._you.setIcon(icon);
    } else {
      this._you = globalThis.L.marker([point.lat, point.lng], {
        icon, title: '내 위치', interactive: false, zIndexOffset: 6000
      }).addTo(this.map);
    }
  }

  setRouteSimulationPoint(point,{follow=false}={}){
    if(!validPoint(point))return false;
    this._routeSimulationPoint={lat:Number(point.lat),lng:Number(point.lng)};
    if(!this.map||!this.ready)return false;
    const content='<span class="route-simulation-car" aria-label="모의주행 차량">🚗</span>';
    if(this.provider==='naver'){
      const icon={content,anchor:new globalThis.naver.maps.Point(21,21)};
      if(this._routeSimulationMarker){this._routeSimulationMarker.setPosition(this._naverPoint(point));this._routeSimulationMarker.setIcon(icon);}
      else this._routeSimulationMarker=new globalThis.naver.maps.Marker({map:this.map,position:this._naverPoint(point),title:'모의주행 차량',zIndex:7000,icon});
    }else{
      const icon=globalThis.L.divIcon({className:'price-marker-shell',html:content,iconSize:[42,42],iconAnchor:[21,21]});
      if(this._routeSimulationMarker){this._routeSimulationMarker.setLatLng([point.lat,point.lng]);this._routeSimulationMarker.setIcon(icon);}
      else this._routeSimulationMarker=globalThis.L.marker([point.lat,point.lng],{icon,title:'모의주행 차량',interactive:false,zIndexOffset:7000}).addTo(this.map);
    }
    if(follow){
      const bounds=this.getBounds();
      if(bounds){
        const latMargin=(bounds.north-bounds.south)*.12,lngMargin=(bounds.east-bounds.west)*.12;
        const nearEdge=point.lat<bounds.south+latMargin||point.lat>bounds.north-latMargin||point.lng<bounds.west+lngMargin||point.lng>bounds.east-lngMargin;
        if(nearEdge)this._internal(()=>{if(this.provider==='naver')this.map.panTo(this._naverPoint(point));else this.map.panTo([point.lat,point.lng],{animate:true,duration:.35});});
      }
    }
    return true;
  }

  clearRouteSimulationPoint(){
    if(this._routeSimulationMarker)this._removeMarker(this._routeSimulationMarker);
    this._routeSimulationMarker=null;this._routeSimulationPoint=null;
  }

  showRoute(coordinates,{kind='via',fitBounds=true,origin=null,destination=null}={}) {
    if (!Array.isArray(coordinates) || coordinates.length < 2 ||
      !coordinates.every(pair => Array.isArray(pair) && pair.length >= 2 && validPoint({ lat: pair[1], lng: pair[0] }))) {
      throw new Error('도로 경로 좌표가 올바르지 않습니다.');
    }
    if(!['base','via'].includes(kind))throw new Error('경로 종류를 확인해 주세요.');
    this._navigationRevision++;
    this.clearRoute(kind,{keepCoordinates:false,keepEndpoints:true});
    const routeCoords=coordinates.map(pair => [pair[0], pair[1]]);
    if(kind==='base'){this._baseRouteCoords=routeCoords;this._routeCoords=routeCoords;if(validPoint(origin)&&validPoint(destination))this._routeEndpoints={origin:{...origin},destination:{...destination}};}
    else this._viaRouteCoords=routeCoords;
    if (!this.map) return;
    this._internal(() => {
      const appearance=ROUTE_LINE_STYLE[kind];
      if (this.provider === 'naver') {
        const maps = globalThis.naver.maps;
        const path = routeCoords.map(pair => new maps.LatLng(pair[1], pair[0]));
        const casing = new maps.Polyline({ map:this.map, path, strokeColor:'#fff', strokeWeight:appearance.casingWeight, strokeOpacity:.96, strokeStyle:'solid', zIndex:appearance.zIndex, clickable:false });
        const polyline = new maps.Polyline({ map:this.map, path, strokeColor:appearance.color, strokeWeight:appearance.weight, strokeOpacity:.98, strokeStyle:'solid', zIndex:appearance.zIndex+1, clickable:false });
        if(kind==='base'){this._baseRouteCasing=casing;this._baseRoute=polyline;}else{this._viaRouteCasing=casing;this._viaRoute=polyline;}
        if(fitBounds){const bounds=new maps.LatLngBounds();path.forEach(point=>bounds.extend(point));const mobile=globalThis.matchMedia?.('(max-width:1000px)')?.matches===true;this.map.fitBounds(bounds,{top:mobile?110:80,right:55,bottom:mobile?150:90,left:mobile?55:470});}
      } else {
        const path=routeCoords.map(pair=>[pair[1],pair[0]]),common={opacity:.98,lineCap:'round',lineJoin:'round',interactive:false};
        const casing=globalThis.L.polyline(path,{...common,color:'#fff',weight:appearance.casingWeight}).addTo(this.map);
        const polyline=globalThis.L.polyline(path,{...common,color:appearance.color,weight:appearance.weight}).addTo(this.map);
        if(kind==='base'){this._baseRouteCasing=casing;this._baseRoute=polyline;}else{this._viaRouteCasing=casing;this._viaRoute=polyline;}
        if(fitBounds){const mobile=globalThis.matchMedia?.('(max-width:1000px)')?.matches===true;this.map.fitBounds(polyline.getBounds(),{paddingTopLeft:[mobile?55:470,mobile?110:80],paddingBottomRight:[55,mobile?150:90],animate:false});}
      }
    });
    if(kind==='base'&&this._routeEndpoints)this._renderRouteEndpoints();
  }

  _renderRouteEndpoints(){
    this._clearRouteEndpoints();
    if(!this.map||!this._routeEndpoints)return;
    const make=(point,label,tone)=>{
      const content=`<span class="route-endpoint route-endpoint-${tone}" aria-label="${label}">${tone==='start'?'출':'도'}</span>`;
      if(this.provider==='naver')return new globalThis.naver.maps.Marker({map:this.map,position:this._naverPoint(point),title:label,zIndex:5200,icon:{content,anchor:new globalThis.naver.maps.Point(18,18)}});
      return globalThis.L.marker([point.lat,point.lng],{title:label,interactive:false,zIndexOffset:5200,icon:globalThis.L.divIcon({className:'price-marker-shell',html:content,iconSize:[36,36],iconAnchor:[18,18]})}).addTo(this.map);
    };
    this._routeStart=make(this._routeEndpoints.origin,'출발지','start');
    this._routeDestination=make(this._routeEndpoints.destination,'목적지','destination');
  }

  _clearRouteEndpoints(){
    if(this._routeStart)this._removeMarker(this._routeStart);if(this._routeDestination)this._removeMarker(this._routeDestination);
    this._routeStart=null;this._routeDestination=null;
  }

  clearRoute(kind='all',{keepCoordinates=false,keepEndpoints=false}={}) {
    if(kind==='all')this.clearRouteSimulationPoint();
    if(kind==='all'||kind==='base'){
      if(this._baseRouteCasing)this._removeMarker(this._baseRouteCasing);this._baseRouteCasing=null;
      if(this._baseRoute)this._removeMarker(this._baseRoute);this._baseRoute=null;
      if(!keepCoordinates){this._baseRouteCoords=[];this._routeCoords=[];}
    }
    if(kind==='all'||kind==='via'){
      if(this._viaRouteCasing)this._removeMarker(this._viaRouteCasing);this._viaRouteCasing=null;
      if(this._viaRoute)this._removeMarker(this._viaRoute);this._viaRoute=null;
      if(!keepCoordinates)this._viaRouteCoords=[];
    }
    if(!keepEndpoints&&(kind==='all'||kind==='base')){this._clearRouteEndpoints();this._routeEndpoints=null;}
  }

  async searchLocation(query) {
    const text = String(query || '').trim();
    if (!text) return [];
    if (text.length > 200) throw new Error('검색어는 200자 이내로 입력해 주세요.');
    const revision = ++this._geocodeRevision;
    const searches = [searchVWorldPlaces(text)];
    if (!naverAuthFailed && this.provider !== 'leaflet') {
      searches.push((async () => {
        await loadNaverSDK();
        const service = globalThis.naver?.maps?.Service;
        if (!service?.geocode) throw new Error('주소 검색을 연결하지 못했습니다.');
        return new Promise((resolve, reject) => {
          let settled = false;
          const finish = (error, results = []) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error); else resolve(results);
          };
          const timer = setTimeout(() => finish(new Error('주소 검색 시간이 초과되었습니다.')), 10000);
          try {
            service.geocode({ query: text }, (status, response) => {
              if (revision !== this._geocodeRevision || this._destroyed) return finish(abortError());
              if (status !== service.Status.OK) return finish(new Error('주소를 확인하지 못했습니다.'));
              finish(null, normalizeAddressSearchResults(response?.v2?.addresses || []));
            });
          } catch { finish(new Error('주소 검색에 실패했습니다.')); }
        });
      })());
    }
    const settled = await Promise.allSettled(searches);
    if (revision !== this._geocodeRevision || this._destroyed) throw abortError();
    const fulfilled = settled.filter(result => result.status === 'fulfilled');
    if (fulfilled.length) return mergeLocationSearchResults(fulfilled.map(result => result.value), text);
    const failure = settled.find(result => result.status === 'rejected');
    throw failure?.reason || new Error('장소 또는 주소 검색을 이용할 수 없습니다.');
  }

  searchAddress(query) { return this.searchLocation(query); }

  _removeMarker(marker) {
    if (this.provider === 'naver') marker.setMap(null);
    else marker.remove();
  }

  _disposeMap() {
    cancelAnimationFrame(this._resizeFrame);
    this._resizeFrame = null;
    clearTimeout(this._centerTimer);
    clearTimeout(this._viewportTimer);
    this._lastViewport = null;
    cancelAnimationFrame(this._labelFrame);
    cancelAnimationFrame(this._markerFrame);
    this._renderRevision++;
    if (this.provider === 'naver') {
      this._listeners.forEach(listener => globalThis.naver.maps.Event.removeListener(listener));
      this._listeners = [];
      this.map?.destroy?.();
    } else this.map?.remove?.();
    this.map = null;
    this._markers.clear();
    this._markerPool.clear();
    this._markerState.clear();
    this._retainedLabels.clear();
    this._baseRoute = null;
    this._viaRoute = null;
    this._baseRouteCasing = null;
    this._viaRouteCasing = null;
    this._routeStart = null;
    this._routeDestination = null;
    this._routeSimulationMarker = null;
    this._you = null;
    this.ready = false;
    this.canvas.replaceChildren();
  }

  destroy() {
    this.stopDriving({ keepMarker: false });
    this._destroyed = true;
    this._geocodeRevision++;
    this._resizeObserver?.disconnect();
    document.removeEventListener(AUTH_EVENT, this._authHandler);
    for (const type of ['pointerdown', 'wheel', 'touchstart', 'keydown']) this.canvas.removeEventListener(type, this._intentHandler, true);
    this.canvas.removeEventListener('click', this._selectHandler, true);
    this._disposeMap();
    this.canvas.remove();
    this.notice.remove();
  }
}

