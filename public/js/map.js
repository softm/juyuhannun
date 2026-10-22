import { APP_CONFIG } from '../config.js';
import { escapeHTML, getFuelPrice, freshness, FUEL_TYPES, BRANDS } from './core.js';
import { markerScale, labelBudget, markerDensityLimit, visibleStations, labelCandidates } from './marker-display.js';
import '../shared/care-location.js';
import '../shared/care-popup-geometry.js';
import '../shared/map-marker-placement.js';

const AUTH_EVENT = 'juyuhannun:naver-auth-failed';
const LEAFLET_VERSION = '1.9.4';
const SDK_TIMEOUT = 12000;
const markerPriceFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
let naverTask;
let leafletTask;
let naverAuthFailed = false;

const validPoint = point => point && [point.lat, point.lng].every(value => typeof value === 'number' && Number.isFinite(value)) &&
  Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
const pointFor = station => {
  const point = { lat: station?.lat ?? station?.location?.lat, lng: station?.lng ?? station?.location?.lng };
  return validPoint(point) ? point : null;
};
const abortError = (message = '이전 주소 검색이 취소되었습니다.') => Object.assign(new Error(message), { name: 'AbortError' });

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
    '.price-pin{position:relative;display:block;min-width:65px;min-height:36px;padding:7px 10px;border:1px solid #405747;border-radius:18px;background:#fff;color:#172e20;font:800 14px/1.2 system-ui,sans-serif;box-shadow:0 3px 9px #0e241f26;cursor:pointer;white-space:nowrap}',
    '.price-pin:after{content:"";position:absolute;left:calc(50% - 4px);bottom:-5px;width:8px;height:8px;transform:rotate(45deg);border-right:1px solid #405747;border-bottom:1px solid #405747;background:inherit}',
    '.price-pin:focus-visible{outline:3px solid #e49c25;outline-offset:3px}',
    '.price-pin.selected{border:2px solid #fff;background:#146d45;color:#fff;box-shadow:0 0 0 2px #146d45,0 5px 14px #173a4533}',
    '.price-pin.selected:after{border-color:#146d45}',
    '.price-pin.is-stale{border-style:dashed;color:#69736c}',
    '.price-pin.selected.is-stale{color:#fff;background:#66756b}',
    '.price-pin-value{display:block}.price-pin-value small{font-size:10px;margin-left:2px;font-weight:600}',
    '.price-pin-name{display:none;position:absolute;left:50%;bottom:calc(100% + 10px);width:max-content;max-width:200px;margin-left:0;padding:6px 9px;border:1px solid #d8e3dc;border-radius:7px;background:#fff;color:#172e20;font:600 12px/1.35 system-ui,sans-serif;white-space:normal;box-shadow:0 3px 9px #0e241f20;pointer-events:none}',
    '.price-pin.selected .price-pin-name{display:block}',

    '.station-marker{position:relative;width:72px;height:40px;pointer-events:none}',
    '.station-marker .price-pin{position:absolute;left:36px;bottom:5px;box-sizing:border-box;transform:translateX(-50%);pointer-events:auto}',
    '.price-pin-glyph{display:none;font-size:16px;line-height:1}',
    '.price-pin-glyph svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.price-label-title{display:block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.price-label-value,.price-label-detail{display:none}',
    '.price-pin-name .price-label-detail{font-size:10px;font-weight:500;line-height:1.5;margin-top:4px;color:#53655f}',
    '.price-label-detail>span{display:block;max-width:200px}',
    '.price-pin.label-visible .price-pin-name,.price-pin.label-measure .price-pin-name{display:block;transform:translateX(-50%)}',
    '.price-pin.label-measure .price-pin-name{visibility:hidden}',
    '.price-pin.label-detail .price-label-detail{display:block}',
    '.map-surface[data-marker-scale="dot"] .price-pin:not(.selected),.map-surface.dense-markers .price-pin:not(.selected){min-width:12px;width:12px;min-height:12px;height:12px;bottom:-6px;padding:0;border:2px solid #fff;border-radius:50%;background:#287b50;box-shadow:0 1px 3px #1236}',
    '.map-surface[data-marker-scale="dot"] .price-pin:not(.selected):after,.map-surface.dense-markers .price-pin:not(.selected):after{display:none}',
    '.map-surface[data-marker-scale="dot"] .price-pin:not(.selected) .price-pin-value,.map-surface[data-marker-scale="pin"] .price-pin:not(.selected) .price-pin-value,.map-surface.dense-markers .price-pin:not(.selected) .price-pin-value{display:none}',
    '.map-surface[data-marker-scale="pin"]:not(.dense-markers) .price-pin:not(.selected){min-width:28px;min-height:28px;padding:5px;border-radius:10px}',
    '.map-surface[data-marker-scale="pin"]:not(.dense-markers) .price-pin:not(.selected) .price-pin-glyph{display:block}',
    '.map-surface[data-marker-scale="dot"] .price-pin:not(.selected) .price-label-value,.map-surface[data-marker-scale="pin"] .price-pin:not(.selected) .price-label-value,.map-surface.dense-markers .price-pin:not(.selected) .price-label-value{display:block;color:#17633d;font-weight:800;margin-top:2px}',
    '.map-surface[data-marker-scale="dot"] .price-pin:not(.selected).is-stale,.map-surface.dense-markers .price-pin:not(.selected).is-stale{background:#929b93}',
    '.map-surface .price-pin.is-stale:not(.selected){border-style:dashed;color:#786b5b}',
    '.map-surface .price-pin.is-stale:not(.selected) .price-pin-name{border-style:dashed;border-color:#a49a8c}',
    '.map-surface .price-pin.is-stale:not(.selected) .price-label-value{color:#786b5b}',
    '.map-surface.dense-markers .price-pin:not(.selected){box-shadow:none}',
    '.map-surface[data-marker-size="small"] .price-pin:not(.selected){min-width:8px;width:8px;min-height:8px;height:8px;bottom:-4px;border-width:1px}',
    '.station-marker .price-pin.selected .price-pin-name{transform:translateX(-50%);border-color:#146d45;background:#f0faf3}',
    '.map-you{display:block;width:18px;height:18px;border:3px solid #fff;border-radius:50%;background:#2674db;box-shadow:0 0 0 7px #2674db30,0 2px 8px #193a6040}',
    '.juyuhannun-map .leaflet-control-attribution{font-size:10px;background:rgba(255,255,255,.92)}',
    '@media(prefers-reduced-motion:reduce){.price-pin{transition:none}}'
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
    this._listeners = [];
    this._userIntent = false;
    this._suppressUntil = 0;
    this._navigationRevision = 0;
    this._locationRevision = 0;
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
    const initialCenter = this.getCenter(), initialZoom = this.map.getZoom();
    const navigationRevision = this._navigationRevision;
    this._resizeFrame = requestAnimationFrame(() => {
      this._resizeFrame = null;
      if (!this.map || this._destroyed) return;
      // A location, station or route selected meanwhile takes precedence.
      const unchanged = navigationRevision === this._navigationRevision;
      const center = unchanged ? initialCenter : this.getCenter();
      const zoom = unchanged ? initialZoom : this.map.getZoom();
      this._internal(() => {
        if (this.provider === 'naver') {
          globalThis.naver.maps.Event.trigger(this.map, 'resize');
          this.map.setCenter(this._naverPoint(center));
        } else {
          this.map.invalidateSize({ animate: false, pan: false });
          this.map.setView([center.lat, center.lng], zoom, { animate: false });
        }
      });
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

  _initNaver() {
    const maps = globalThis.naver.maps;
    this.provider = 'naver';
    this._mapType = 'normal';
    this.map = new maps.Map(this.canvas, {
      center: this._naverPoint(this._center), zoom: APP_CONFIG.defaultZoom,
      minZoom: 7, maxZoom: 19, mapTypeId: maps.MapTypeId.NORMAL,
      zoomControl: true, zoomControlOptions: { position: maps.Position.RIGHT_CENTER },
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
        center: [center.lat, center.lng], zoom: APP_CONFIG.defaultZoom,
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
      if (this._routeCoords.length > 1) this.showRoute(this._routeCoords);
      if (this._youPoint) this._showYou(this._youPoint);
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

  setStations(stations, selectedId = null, fuel = 'B027') {
    this._stations = Array.isArray(stations) ? stations : [];
    this._selectedId = selectedId == null ? null : String(selectedId);
    this._fuel = fuel;
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
    this.canvas.classList.toggle('dense-markers', rows.length > markerDensityLimit(this.canvas.clientWidth, this.canvas.clientHeight));
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
    const sourceKey = JSON.stringify([point, row.name, row.brand, row.facilities?.self, row.roadAddress, row.address, this._fuel, selected, info, presentation, Math.floor(now / 60000)]);
    if (cached && previous?.sourceKey === sourceKey) return false;
    const price = presentation ? String(presentation.value ?? '미확인') : info ? markerPriceFormat.format(info.price) : '미확인';
    const fuelName = FUEL_TYPES.find(item => item.code === this._fuel)?.name || '유종';
    const confidence = info ? freshness(info.priceUpdatedAt, info.fetchedAt, now, info.priceTimeStatus, info.sourceDate) : { eligible: false, label: '가격 미제공' };
    const label = presentation ? String(presentation.label || row.name) : row.name + ', ' + fuelName + ' ' + (info ? price + '원' : '가격 미확인') + ', ' + confidence.label;
    const stale = presentation ? presentation.stale !== false : !confidence.eligible;
    const unit = presentation ? String(presentation.unit || '') : info ? '원' : '';
    const facts = [BRANDS[row.brand] || row.brand, row.facilities?.self === true ? '셀프' : row.facilities?.self === false ? '일반' : null, info?.sourceDate ? info.sourceDate + ' 기준' : confidence.label].filter(Boolean).join(' · ');
    const content = '<div class="station-marker"><button type="button" class="price-pin' + (selected ? ' selected' : '') +
      (stale ? ' is-stale' : '') + '" data-station-id="' + escapeHTML(id) +
      '" aria-label="' + escapeHTML(label) + '" aria-pressed="' + selected + '" title="' + escapeHTML(label) +
      '"><span class="price-pin-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="12" height="17" rx="2"/><path d="M6 7h6v4H6ZM1 21h16m-2-8h2v5a2 2 0 0 0 4 0V8l-4-4m3 3v4h1"/></svg></span><span class="price-pin-value">' + escapeHTML(price) +
      (unit ? '<small>' + escapeHTML(unit) + '</small>' : '') + '</span><span class="price-pin-name"><span class="price-label-title">' +
      escapeHTML(row.name || '주유소') + '</span><span class="price-label-value">' + escapeHTML(price + unit) +
      '</span><span class="price-label-detail">' + escapeHTML(facts) + '<span>' + escapeHTML(row.roadAddress || row.address || '') + '</span></span></span></button></div>';
    let marker = this._markers.get(id) || this._markerPool.get(id);
    const zIndex = selected ? 5000 : this._retainedLabels.has(id) ? 1000 : 100;
    const changed = !previous || previous.content !== content;
    const moved = !previous || previous.lat !== point.lat || previous.lng !== point.lng;
    const makeIcon = () => this.provider === 'naver'
      ? { content, anchor: new globalThis.naver.maps.Point(36, 40) }
      : globalThis.L.divIcon({ className: 'price-marker-shell', html: content, iconSize: [72, 40], iconAnchor: [36, 40] });
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
    this._markerState.set(id, { content, lat: point.lat, lng: point.lng, zIndex, sourceKey });
    return !cached || changed || moved || previous?.zIndex !== zIndex;
  }

  _setMarkerLayer(id, emphasized) {
    const marker = this._markers.get(id), state = this._markerState.get(id);
    const zIndex = id === this._selectedId ? 5000 : emphasized ? 1000 : 100;
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
        label.style.transform = 'translateX(-50%)';
      }
      const candidates = ids.map(id => ({ id, node: byId.get(id) })).filter(item => item.node);
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

  _showYou(point) {
    if (!this.map) return;
    if (this._you) this._removeMarker(this._you);
    if (this.provider === 'naver') this._you = new globalThis.naver.maps.Marker({
      map: this.map, position: this._naverPoint(point), title: '내 위치', zIndex: 6000,
      icon: { content: '<span class="map-you" aria-label="내 위치"></span>', anchor: new globalThis.naver.maps.Point(9, 9) }
    });
    else this._you = globalThis.L.marker([point.lat, point.lng], {
      icon: globalThis.L.divIcon({ className: 'price-marker-shell', html: '<span class="map-you" aria-label="내 위치"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      title: '내 위치', interactive: false, zIndexOffset: 6000
    }).addTo(this.map);
  }

  showRoute(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length < 2 ||
      !coordinates.every(pair => Array.isArray(pair) && pair.length >= 2 && validPoint({ lat: pair[1], lng: pair[0] }))) {
      throw new Error('도로 경로 좌표가 올바르지 않습니다.');
    }
    this._navigationRevision++;
    this.clearRoute();
    this._routeCoords = coordinates.map(pair => [pair[0], pair[1]]);
    if (!this.map) return;
    this._internal(() => {
      if (this.provider === 'naver') {
        const maps = globalThis.naver.maps;
        const path = this._routeCoords.map(pair => new maps.LatLng(pair[1], pair[0]));
        this._route = new maps.Polyline({ map: this.map, path, strokeColor: '#146d45', strokeWeight: 5, strokeOpacity: 0.9 });
        const bounds = new maps.LatLngBounds();
        path.forEach(point => bounds.extend(point));
        this.map.fitBounds(bounds, { top: 70, right: 45, bottom: 65, left: 45 });
      } else {
        this._route = globalThis.L.polyline(this._routeCoords.map(pair => [pair[1], pair[0]]), { color: '#146d45', weight: 5 }).addTo(this.map);
        this.map.fitBounds(this._route.getBounds(), { padding: [50, 60], animate: false });
      }
    });
  }

  clearRoute() {
    if (this._route) this._removeMarker(this._route);
    this._route = null;
    this._routeCoords = [];
  }

  async searchAddress(query) {
    const text = String(query || '').trim();
    if (!text) return [];
    if (text.length > 200) throw new Error('주소는 200자 이내로 입력해 주세요.');
    if (naverAuthFailed || this.provider === 'leaflet') {
      throw new Error('현재 지도에서는 주소 검색을 사용할 수 없습니다. 지도를 이동하거나 내 위치를 선택해 주세요.');
    }
    await loadNaverSDK();
    const service = globalThis.naver?.maps?.Service;
    if (!service?.geocode) throw new Error('주소 검색을 연결하지 못했습니다. 지도를 이동해 위치를 선택해 주세요.');
    const revision = ++this._geocodeRevision;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, results) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(results);
      };
      const timer = setTimeout(() => finish(new Error('주소 검색 시간이 초과되었습니다. 다시 검색해 주세요.')), 10000);
      try {
        service.geocode({ query: text }, (status, response) => {
          if (revision !== this._geocodeRevision || this._destroyed) return finish(abortError());
          if (status !== service.Status.OK) return finish(new Error('주소를 확인하지 못했습니다. 도로명 또는 지번 주소로 다시 검색해 주세요.'));
          const results = (response?.v2?.addresses || []).map(item => ({
            name: item.roadAddress || item.jibunAddress || '',
            address: item.roadAddress || item.jibunAddress || '',
            lat: Number(item.y), lng: Number(item.x)
          })).filter(item => item.address && validPoint(item));
          finish(null, results);
        });
      } catch { finish(new Error('주소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.')); }
    });
  }

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
    this._route = null;
    this._you = null;
    this.ready = false;
    this.canvas.replaceChildren();
  }

  destroy() {
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

