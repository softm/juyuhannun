import { ServiceError, publicError, readJsonResponse } from './errors.mjs';
import { MemoryCache, SingleFlight } from './cache.mjs';
import { wgs84ToKatec, katecToWgs84 } from './coordinates.mjs';

export const FUELS = Object.freeze({ B027: 'gasoline', D047: 'diesel', B034: 'premium', K015: 'lpg' });
export const OPINET_SOURCE = Object.freeze({ name: '한국석유공사 오피넷', url: 'https://www.opinet.co.kr/' });
const numberValue = value => (typeof value === 'string' && value.trim() !== '' ? Number(value.replaceAll(',', '')) : typeof value === 'number' ? value : NaN);
const textValue = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 300) : '';
const positivePrice = value => { const parsed = numberValue(value); return Number.isFinite(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : null; };
const yn = value => value === 'Y' ? true : value === 'N' ? false : null;

export function validateSearch({ lat, lng, radius = 3000, fuel = 'B027' }) {
  lat = numberValue(lat); lng = numberValue(lng); radius = numberValue(radius);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 32 || lat > 40 || lng < 123 || lng > 133) throw new ServiceError('INVALID_LOCATION', '대한민국 영역의 올바른 위도와 경도를 입력해 주세요.', 400);
  if (!Number.isInteger(radius) || radius < 100 || radius > 5000) throw new ServiceError('INVALID_RADIUS', '조회 반경은 100~5,000m 범위여야 합니다.', 400);
  if (!Object.hasOwn(FUELS, fuel)) throw new ServiceError('INVALID_FUEL', '지원하지 않는 유종입니다.', 400);
  return { lat, lng, radius, fuel };
}

export function validateStationId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,30}$/.test(id)) throw new ServiceError('INVALID_STATION_ID', '올바른 주유소 식별자가 아닙니다.', 400);
  return id;
}

// The API describes a Korean domestic reference date/time, without a timezone suffix.
// Retain it as a source reference time; never substitute the API fetch time.
export function parsePriceTimestamp(date, time) {
  const dateText = textValue(date); const rawTime = textValue(time);
  if (!/^\d{8}$/.test(dateText) || !/^\d{1,6}$/.test(rawTime)) return null;
  const timeText = rawTime.padStart(6, '0');
  const year = Number(dateText.slice(0, 4)); const month = Number(dateText.slice(4, 6)); const day = Number(dateText.slice(6, 8));
  const hour = Number(timeText.slice(0, 2)); const minute = Number(timeText.slice(2, 4)); const second = Number(timeText.slice(4, 6));
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const utcLocal = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (utcLocal.getUTCFullYear() !== year || utcLocal.getUTCMonth() !== month - 1 || utcLocal.getUTCDate() !== day) return null;
  return new Date(utcLocal.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

export function extractOil(payload) {
  const result = payload?.RESULT;
  if (!result || typeof result !== 'object' || result.ERROR || payload.ERROR) throw new ServiceError('OPINET_PROVIDER_ERROR', '오피넷이 조회를 처리하지 못했습니다. 인증키와 사용 한도를 확인해 주세요.');
  if (!Object.hasOwn(result, 'OIL')) throw new ServiceError('OPINET_SCHEMA_ERROR', '오피넷 가격 응답의 구조를 확인할 수 없습니다.');
  if (result.OIL === null || result.OIL === '') return [];
  if (Array.isArray(result.OIL)) return result.OIL;
  if (typeof result.OIL === 'object') return [result.OIL];
  throw new ServiceError('OPINET_SCHEMA_ERROR', '오피넷 가격 응답의 구조를 확인할 수 없습니다.');
}

function baseStation(row, fetchedAt) {
  const id = textValue(row?.UNI_ID); const name = textValue(row?.OS_NM);
  if (!id || !/^[A-Za-z0-9_-]{1,30}$/.test(id) || !name) return null;
  const x = numberValue(row.GIS_X_COOR); const y = numberValue(row.GIS_Y_COOR);
  let coordinates;
  try { coordinates = katecToWgs84({ x, y }); }
  catch { return null; }
  if (!Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng) || coordinates.lat < 32 || coordinates.lat > 40 || coordinates.lng < 123 || coordinates.lng > 133) return null;
  return {
    id, name, brand: textValue(row.POLL_DIV_CD ?? row.POLL_DIV_CO) || null,
    ...coordinates, sourceCoordinates: { crs: 'KATEC', x, y }, address: textValue(row.VAN_ADR) || null, roadAddress: textValue(row.NEW_ADR) || null,
    phone: textValue(row.TEL) || null, fetchedAt, source: OPINET_SOURCE,
    facilities: { self: yn(row.SELF_YN), carWash: yn(row.CAR_WASH_YN), maintenance: yn(row.MAINT_YN), convenience: yn(row.CVS_YN), lpg: row.LPG_YN === 'C' || row.LPG_YN === 'Y' ? true : row.LPG_YN === 'N' ? false : null },
  };
}

export function normalizeNearby(row, { fuel, fetchedAt }) {
  const station = baseStation(row, fetchedAt);
  if (!station) return null;
  const price = positivePrice(row.PRICE); const distance = numberValue(row.DISTANCE);
  return { ...station, fuel, price, distanceMeters: Number.isFinite(distance) && distance >= 0 ? distance : null, distanceType: 'straight_line', priceUpdatedAt: null, priceTimeStatus: 'unknown', prices: { [fuel]: { price, priceUpdatedAt: null, fetchedAt } } };
}

export function normalizeDetail(row, { fuel = 'B027', fetchedAt }) {
  const station = baseStation(row, fetchedAt);
  if (!station) return null;
  const prices = {};
  const rows = Array.isArray(row.OIL_PRICE) ? row.OIL_PRICE : row.OIL_PRICE && typeof row.OIL_PRICE === 'object' ? [row.OIL_PRICE] : [];
  for (const item of rows) {
    if (!Object.hasOwn(FUELS, item.PRODCD)) continue;
    const parsedTime = parsePriceTimestamp(item.TRADE_DT, item.TRADE_TM);
    const future = parsedTime && Date.parse(parsedTime) > Date.parse(fetchedAt) + 5 * 60 * 1000;
    prices[item.PRODCD] = { price: positivePrice(item.PRICE), priceUpdatedAt: future ? null : parsedTime, sourceDate: textValue(item.TRADE_DT) || null, sourceTime: textValue(item.TRADE_TM) || null, timestampIssue: future ? 'future' : parsedTime ? null : 'unknown_or_invalid', fetchedAt };
  }
  const selected = prices[fuel];
  return { ...station, fuel, price: selected?.price ?? null, priceUpdatedAt: selected?.priceUpdatedAt ?? null, priceTimeStatus: selected?.priceUpdatedAt ? 'reported' : 'unknown', distanceMeters: null, distanceType: 'straight_line', prices };
}

export class OpinetClient {
  constructor({ apiKey = '', quota, fetchImpl = fetch, clock = Date.now, ttlMs = 600_000, detailLimit = 8, timeoutMs = 10_000 } = {}) {
    this.apiKey = apiKey.trim(); this.quota = quota; this.fetchImpl = fetchImpl; this.clock = clock;
    this.ttlMs = Math.max(30_000, ttlMs); this.detailLimit = Math.max(0, Math.min(20, Math.floor(detailLimit))); this.timeoutMs = timeoutMs;
    this.cache = new MemoryCache({ clock }); this.singleFlight = new SingleFlight();
    this.failureCache = new MemoryCache({ clock, staleMaxMs: 0 });
  }

  get configured() { return this.apiKey.length > 0; }

  async request(endpoint, parameters) {
    if (!this.configured) throw new ServiceError('OPINET_CREDENTIALS_REQUIRED', '오피넷 인증키를 연결하면 가격을 조회할 수 있습니다.', 503);
    await this.quota?.reserve(1);
    const url = new URL(`https://www.opinet.co.kr/api/${endpoint}`);
    url.search = new URLSearchParams({ ...parameters, out: 'json', certkey: this.apiKey }).toString();
    try {
      const response = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
      return extractOil(await readJsonResponse(response, 'OPINET'));
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // Fetch exceptions can contain the complete URL, including certkey. Never expose them.
      throw new ServiceError('OPINET_NETWORK_ERROR', '오피넷에 연결하지 못했습니다. 마지막 가격 기준시각을 확인해 주세요.');
    }
  }

  async cached(key, callback) {
    const cached = this.cache.get(key);
    if (cached) return { ...cached.value, cache: { hit: true, ageSeconds: cached.ageSeconds, stale: false } };
    return this.singleFlight.run(key, async () => {
      try {
        const recentFailure = this.failureCache.get(key);
        if (recentFailure) throw new ServiceError(recentFailure.value.code, recentFailure.value.message, recentFailure.value.httpStatus);
        const value = await callback();
        this.cache.set(key, value, this.ttlMs);
        return { ...value, cache: { hit: false, ageSeconds: 0, stale: false } };
      } catch (error) {
        this.failureCache.set(key, { ...publicError(error), httpStatus: error.httpStatus ?? 502 }, 15_000);
        const previous = this.cache.get(key, { allowStale: true });
        if (!previous) throw error;
        return { ...previous.value, status: 'partial', cache: { hit: true, ageSeconds: previous.ageSeconds, stale: true }, error: publicError(error), warnings: [...(previous.value.warnings ?? []), { code: 'STALE_CACHE', message: '새 자료를 받지 못해 이전 자료를 표시합니다. 가격 기준시각을 확인해 주세요.' }] };
      }
    });
  }

  async nearby(input) {
    const search = validateSearch(input);
    const coverage = { kind: 'radius', center: { lat: search.lat, lng: search.lng }, radiusMeters: search.radius, fuel: search.fuel, complete: false, description: '검색 중심 반경 안에서 오피넷이 제공한 주유소입니다. 거리 표시는 직선거리입니다.' };
    if (!this.configured) return { status: 'awaiting_credentials', provider: 'opinet', fetchedAt: null, cache: { hit: false, ageSeconds: null, stale: false }, coverage, stations: [], warnings: [], error: { code: 'OPINET_CREDENTIALS_REQUIRED', message: '오피넷 인증키 연결 후 가격을 조회할 수 있습니다.' } };
    const key = `nearby:${search.lat}:${search.lng}:${search.radius}:${search.fuel}`;
    return this.cached(key, async () => {
      const { x, y } = wgs84ToKatec(search);
      const rows = await this.request('aroundAll.do', { x: x.toFixed(3), y: y.toFixed(3), radius: String(search.radius), prodcd: search.fuel, sort: '1' });
      const fetchedAt = new Date(this.clock()).toISOString();
      const stations = rows.map(row => normalizeNearby(row, { fuel: search.fuel, fetchedAt })).filter(Boolean);
      if (rows.length && !stations.length) throw new ServiceError('OPINET_SCHEMA_ERROR', '주유소 위치와 가격 자료를 확인할 수 없습니다.');
      const warnings = [];
      if (stations.length < rows.length) warnings.push({ code: 'INVALID_STATIONS_OMITTED', message: '위치나 식별자가 올바르지 않은 일부 자료를 제외했습니다.' });
      let detailFailure = false;
      // Sequential enrichment bounds daily call use and reuses detail cache across fuels/zones.
      for (let index = 0; index < Math.min(this.detailLimit, stations.length); index++) {
        try {
          const details = await this.detail(stations[index].id, search.fuel);
          if (details.status !== 'ready') { detailFailure = true; continue; }
          const base = stations[index];
          stations[index] = { ...details.station, distanceMeters: base.distanceMeters, distanceType: base.distanceType };
        } catch (error) {
          detailFailure = true;
          if (error.code?.includes('QUOTA')) break;
        }
      }
      if (stations.some(station => !station.priceUpdatedAt)) warnings.push({ code: 'PRICE_TIME_UNKNOWN', message: '가격 기준시각이 없는 주유소는 시간 확인이 필요한 자료입니다.' });
      if (detailFailure) warnings.push({ code: 'DETAIL_UNAVAILABLE', message: '일부 주유소의 상세 가격 기준시각을 받지 못했습니다.' });
      return { status: detailFailure || stations.length < rows.length ? 'partial' : 'ready', provider: 'opinet', fetchedAt, coverage, stations, warnings };
    });
  }

  async detail(id, fuel = 'B027') {
    validateStationId(id);
    if (!Object.hasOwn(FUELS, fuel)) throw new ServiceError('INVALID_FUEL', '지원하지 않는 유종입니다.', 400);
    if (!this.configured) return { status: 'awaiting_credentials', provider: 'opinet', fetchedAt: null, station: null, warnings: [], error: { code: 'OPINET_CREDENTIALS_REQUIRED', message: '오피넷 인증키 연결 후 상세 가격을 조회할 수 있습니다.' } };
    const envelope = await this.cached(`detail:${id}`, async () => {
      const rows = await this.request('detailById.do', { id });
      const fetchedAt = new Date(this.clock()).toISOString();
      const row = rows.find(item => textValue(item.UNI_ID) === id);
      if (!row) throw new ServiceError('STATION_NOT_FOUND', '해당 주유소의 최신 상세정보를 찾을 수 없습니다.', 404);
      const station = normalizeDetail(row, { fuel: 'B027', fetchedAt });
      if (!station) throw new ServiceError('OPINET_SCHEMA_ERROR', '주유소 상세 응답의 위치를 확인할 수 없습니다.');
      return { status: 'ready', provider: 'opinet', station, fetchedAt, warnings: [] };
    });
    const selected = envelope.station.prices[fuel];
    return { ...envelope, station: { ...envelope.station, fuel, price: selected?.price ?? null, priceUpdatedAt: selected?.priceUpdatedAt ?? null, priceTimeStatus: selected?.priceUpdatedAt ? 'reported' : 'unknown' } };
  }
}
