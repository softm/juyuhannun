import { ServiceError, publicError, readJsonResponse } from './errors.mjs';
import { MemoryCache, SingleFlight } from './cache.mjs';

const ENDPOINT = 'https://data.ex.co.kr/openapi/business/curStateStation';
const PAGE_SIZE = 99;
const MAX_PAGES = 20;
const CACHE_KEY = 'all';

export const HIGHWAY_SOURCE = Object.freeze({
  name: '한국도로공사',
  url: 'https://data.ex.co.kr/openapi/basicinfo/openApiInfoM?apiId=0312',
  metadataUrl: 'https://www.data.go.kr/data/15076636/openapi.do',
  endpoint: ENDPOINT,
  apiId: '0312',
});

export const HIGHWAY_OIL_COMPANIES = Object.freeze({
  AD: Object.freeze({ name: '고속도로 알뜰주유소', brand: 'RTX' }),
  HD: Object.freeze({ name: 'HD현대오일뱅크', brand: 'HDO' }),
  S: Object.freeze({ name: 'S-OIL', brand: 'SOL' }),
  SK: Object.freeze({ name: 'SK에너지', brand: 'SKE' }),
});

const text = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim().slice(0, 500) : '';
const integer = value => {
  const parsed = typeof value === 'number' ? value : /^\d+$/.test(text(value)) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const validPoint = row => Number.isFinite(row?.lat) && Number.isFinite(row?.lng) && row.lat >= 32 && row.lat <= 40 && row.lng >= 123 && row.lng <= 133;
const phoneKey = value => {
  const digits = text(value).replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
};
const compact = value => text(value).normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^0-9a-z가-힣]/g, '');
const nameKey = value => compact(value)
  .replace(/주식회사|주유소|휴게소|충전소|셀프/g, '')
  .replace(/^한국도로공사/, '');

function price(value, field) {
  const raw = text(value).replace(/\s/g, '');
  if (raw.toUpperCase() === 'X') return null;
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)원?$/.test(raw)) {
    throw new ServiceError('EX_SCHEMA_ERROR', `한국도로공사 ${field} 형식을 확인할 수 없습니다.`);
  }
  const parsed = Number(raw.replace(/[원,]/g, ''));
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 100_000) {
    throw new ServiceError('EX_SCHEMA_ERROR', `한국도로공사 ${field} 범위를 확인할 수 없습니다.`);
  }
  return parsed;
}

function indexCatalog(rows, keyOf) {
  const index = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.id !== 'string' || !validPoint(row)) continue;
    const rawKeys = keyOf(row);
    const keys = Array.isArray(rawKeys) ? rawKeys : [rawKeys];
    for (const key of new Set(keys.filter(Boolean))) {
      const records = index.get(key) ?? [];
      if (!records.some(record => record.id === row.id)) records.push(row);
      index.set(key, records);
    }
  }
  return index;
}

function uniqueRecord(records) {
  const unique = new Map((records ?? []).map(row => [row.id, row]));
  return unique.size === 1 ? unique.values().next().value : null;
}

function coordinateMatch(station, indexes) {
  const phoneMatches = indexes.phone.get(phoneKey(station.phone)) ?? [];
  if (phoneMatches.length === 1) return { row: phoneMatches[0], method: 'phone' };
  if (phoneMatches.length > 1) {
    const expectedName = nameKey(station.name);
    const narrowed = phoneMatches.filter(row => {
      const candidate = nameKey(row.name);
      return expectedName && candidate && (expectedName === candidate || expectedName.includes(candidate) || candidate.includes(expectedName));
    });
    if (narrowed.length === 1) return { row: narrowed[0], method: 'phone+name' };
    return null;
  }

  const exactName = uniqueRecord(indexes.name.get(nameKey(station.name)));
  const exactAddress = uniqueRecord(indexes.address.get(compact(station.address)));
  const candidates = new Map([exactName, exactAddress].filter(Boolean).map(row => [row.id, row]));
  if (candidates.size !== 1) return null;
  const row = candidates.values().next().value;
  return { row, method: exactName?.id === row.id ? 'name' : 'address' };
}

/**
 * Add coordinates only when an existing official station record has a unique,
 * deterministic identity match. Similar-looking names alone are never enough.
 */
export function enrichHighwayStations(stations, stationCatalog = []) {
  const indexes = {
    phone: indexCatalog(stationCatalog, row => phoneKey(row.phone)),
    name: indexCatalog(stationCatalog, row => nameKey(row.name)),
    address: indexCatalog(stationCatalog, row => [compact(row.address), compact(row.roadAddress)]),
  };
  return stations.map(station => {
    const match = coordinateMatch(station, indexes);
    if (!match) return { ...station, lat: null, lng: null };
    const source = match.row;
    return {
      ...station,
      lat: source.lat,
      lng: source.lng,
      roadAddress: text(source.roadAddress) || null,
      opinetStationId: source.id,
      coordinateSource: 'opinet-station-catalog',
      coordinateMatchedBy: match.method,
      coordinateVerifiedAt: text(source.coordinateVerifiedAt || source.verifiedAt) || null,
    };
  });
}

function required(row, field) {
  const value = text(row?.[field]);
  if (!value) throw new ServiceError('EX_SCHEMA_ERROR', `한국도로공사 ${field} 값이 비어 있습니다.`);
  return value;
}

export function normalizeHighwayStation(row, fetchedAt) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 주유소 자료 형식을 확인할 수 없습니다.');
  const serviceAreaCode = required(row, 'serviceAreaCode');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(serviceAreaCode)) throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 휴게소 코드를 확인할 수 없습니다.');
  const lpgYn = required(row, 'lpgYn');
  if (!['Y', 'N'].includes(lpgYn)) throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 LPG 판매 여부를 확인할 수 없습니다.');
  const amounts = {
    B027: price(row.gasolinePrice, '휘발유 가격'),
    D047: price(row.diselPrice, '경유 가격'),
    K015: price(row.lpgPrice, 'LPG 가격'),
  };
  if (lpgYn === 'N' && amounts.K015 !== null) throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 LPG 판매 여부와 가격이 일치하지 않습니다.');
  const prices = Object.fromEntries(Object.entries(amounts).filter(([, amount]) => amount !== null).map(([fuel, amount]) => [fuel, {
    price: amount,
    unit: 'KRW/L',
    priceUpdatedAt: null,
    priceTimeStatus: 'source_time_unavailable',
    fetchedAt,
    provider: 'ex',
  }]));
  const oilCompanyCode = required(row, 'oilCompany');
  const company = HIGHWAY_OIL_COMPANIES[oilCompanyCode] ?? null;
  return {
    id: `EX-${serviceAreaCode}`,
    serviceAreaCode,
    serviceAreaCode2: text(row.serviceAreaCode2) || null,
    dataGranularity: 'station',
    unit: 'KRW/L',
    provider: 'ex',
    name: required(row, 'serviceAreaName'),
    routeCode: required(row, 'routeCode'),
    routeName: text(row.routeName) || null,
    direction: text(row.direction) || null,
    oilCompanyCode,
    oilCompanyName: company?.name ?? null,
    operator: company?.name ?? oilCompanyCode,
    brand: company?.brand ?? null,
    phone: text(row.telNo) || null,
    address: text(row.svarAddr) || null,
    roadAddress: null,
    lat: null,
    lng: null,
    lpgAvailable: lpgYn === 'Y',
    facilities: { lpg: lpgYn === 'Y' },
    fuelAvailability: Object.fromEntries(Object.entries(amounts).map(([fuel, amount]) => [fuel, amount !== null])),
    prices,
    fetchedAt,
    source: { ...HIGHWAY_SOURCE },
  };
}

function validatePage(payload, expectedPage, expected = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 응답 구조를 확인할 수 없습니다.');
  if (text(payload.code) !== 'SUCCESS') throw new ServiceError('EX_PROVIDER_ERROR', '한국도로공사가 조회를 처리하지 못했습니다. 인증키와 사용 한도를 확인해 주세요.');
  if (!Array.isArray(payload.list)) throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 주유소 목록을 확인할 수 없습니다.');
  const count = integer(payload.count), pageNo = integer(payload.pageNo), numOfRows = integer(payload.numOfRows), pageSize = integer(payload.pageSize);
  if (count === null || pageNo !== expectedPage || numOfRows === null || numOfRows < 1 || numOfRows > PAGE_SIZE || pageSize === null || pageSize > MAX_PAGES) {
    throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 페이지 정보를 확인할 수 없습니다.');
  }
  const calculatedPages = count === 0 ? 0 : Math.ceil(count / numOfRows);
  if (pageSize !== calculatedPages || payload.list.length > numOfRows || (pageNo < pageSize && payload.list.length !== numOfRows)) {
    throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 페이지 건수가 일치하지 않습니다.');
  }
  if (expected && (count !== expected.count || numOfRows !== expected.numOfRows || pageSize !== expected.pageSize)) {
    throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 페이지 사이의 전체 건수가 일치하지 않습니다.');
  }
  return { list: payload.list, count, pageNo, numOfRows, pageSize };
}

function awaitingCredentials() {
  return {
    status: 'awaiting_credentials',
    provider: 'ex',
    dataGranularity: 'station',
    implementationReady: true,
    fetchedAt: null,
    stations: [],
    coverage: {
      kind: 'highway_stations',
      complete: false,
      description: '한국도로공사 인증키를 연결하면 고속도로 주유소 가격을 수집합니다.',
    },
    cache: { hit: false, ageSeconds: null, stale: false },
    source: { ...HIGHWAY_SOURCE },
    warnings: [],
    error: { code: 'EX_CREDENTIALS_REQUIRED', message: '한국도로공사 인증키를 연결하면 고속도로 가격을 조회할 수 있습니다.' },
  };
}

export class HighwayClient {
  constructor({ apiKey = '', quota, fetchImpl = fetch, clock = Date.now, timeoutMs = 15_000, ttlMs = 5 * 60_000 } = {}) {
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.quota = quota;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.timeoutMs = Math.max(1_000, Math.min(60_000, timeoutMs));
    this.ttlMs = Math.max(30_000, ttlMs);
    this.cache = new MemoryCache({ clock });
    this.singleFlight = new SingleFlight();
  }

  get configured() { return this.apiKey.length > 0; }
  get implementationReady() { return true; }

  async requestPage(pageNo) {
    await this.quota?.reserve(1);
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ key: this.apiKey, type: 'json', numOfRows: String(PAGE_SIZE), pageNo: String(pageNo) }).toString();
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          Referer: HIGHWAY_SOURCE.url,
          'User-Agent': 'JuyuhannunDataCollector/0.2 (+https://softm.github.io/juyuhannun/)',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return await readJsonResponse(response, 'EX');
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // Fetch exceptions may contain the complete URL. Never expose them.
      throw new ServiceError('EX_NETWORK_ERROR', '한국도로공사에 연결하지 못했습니다. 마지막 수집시각을 확인해 주세요.');
    }
  }

  async fetchSnapshot() {
    const first = validatePage(await this.requestPage(1), 1);
    const pages = [first];
    for (let pageNo = 2; pageNo <= first.pageSize; pageNo++) {
      pages.push(validatePage(await this.requestPage(pageNo), pageNo, first));
    }
    const rows = pages.flatMap(page => page.list);
    if (rows.length !== first.count) throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 전체 주유소 건수가 일치하지 않습니다.');
    const fetchedAt = new Date(this.clock()).toISOString();
    const stations = rows.map(row => normalizeHighwayStation(row, fetchedAt));
    const ids = new Set(stations.map(station => station.id));
    if (ids.size !== stations.length) throw new ServiceError('EX_SCHEMA_ERROR', '한국도로공사 주유소 식별자가 중복되었습니다.');
    return { fetchedAt, stations: stations.sort((a, b) => a.serviceAreaCode.localeCompare(b.serviceAreaCode)), sourceCount: first.count, pageCount: first.pageSize };
  }

  present(raw, stationCatalog, cache, extra = {}) {
    const stations = enrichHighwayStations(raw.stations, stationCatalog);
    const mappedStationCount = stations.filter(validPoint).length;
    const availablePriceCounts = Object.fromEntries(['B027', 'D047', 'K015'].map(fuel => [fuel, stations.filter(station => station.prices[fuel]).length]));
    const warnings = [{
      code: 'EX_PRICE_TIME_UNAVAILABLE',
      message: '도로공사 원본은 개별 가격 변경시각을 제공하지 않아 수집시각과 구분해 표시합니다.',
    }];
    const missingRouteNames = stations.filter(station => !station.routeName).length;
    const missingDirections = stations.filter(station => !station.direction).length;
    if (missingRouteNames || missingDirections) warnings.push({
      code: 'EX_ROUTE_METADATA_PARTIAL',
      missingRouteNames,
      missingDirections,
      message: '도로공사 원본에서 비어 있는 노선명·방향은 추정하지 않고 미제공으로 표시합니다.',
    });
    if (mappedStationCount < stations.length) warnings.push({
      code: 'EX_COORDINATES_PARTIAL',
      count: stations.length - mappedStationCount,
      message: '기존 공식 주유소 자료와 유일하게 연결되지 않은 시설은 좌표 없이 목록에 표시합니다.',
    });
    return {
      status: extra.status ?? 'ready',
      provider: 'ex',
      dataGranularity: 'station',
      implementationReady: true,
      fetchedAt: raw.fetchedAt,
      stations,
      coverage: {
        kind: 'highway_stations',
        complete: stations.length === raw.sourceCount,
        sourceStationCount: raw.sourceCount,
        mappedStationCount,
        unmappedStationCount: stations.length - mappedStationCount,
        availablePriceCounts,
        pageCount: raw.pageCount,
        priceTimestampProvided: false,
        description: '한국도로공사 고속도로 주유소의 유종별 가격·노선·방향·정유사 정보입니다.',
      },
      cache,
      source: { ...HIGHWAY_SOURCE },
      warnings: [...warnings, ...(extra.warnings ?? [])],
      ...(extra.error ? { error: extra.error } : {}),
    };
  }

  async snapshot({ stationCatalog = [] } = {}) {
    if (!this.configured) return awaitingCredentials();
    const cached = this.cache.get(CACHE_KEY);
    if (cached) return this.present(cached.value, stationCatalog, { hit: true, ageSeconds: cached.ageSeconds, stale: false });
    const result = await this.singleFlight.run(CACHE_KEY, async () => {
      const shared = this.cache.get(CACHE_KEY);
      if (shared) return { raw: shared.value, cache: { hit: true, ageSeconds: shared.ageSeconds, stale: false } };
      try {
        const raw = await this.fetchSnapshot();
        this.cache.set(CACHE_KEY, raw, this.ttlMs);
        return { raw, cache: { hit: false, ageSeconds: 0, stale: false } };
      } catch (error) {
        const previous = this.cache.get(CACHE_KEY, { allowStale: true });
        if (!previous) throw error;
        return {
          raw: previous.value,
          cache: { hit: true, ageSeconds: previous.ageSeconds, stale: true },
          extra: {
            status: 'partial',
            error: publicError(error),
            warnings: [{ code: 'PRESERVED_PREVIOUS_SNAPSHOT', message: '새 자료를 받지 못해 이전 고속도로 가격을 원래 수집시각으로 표시합니다.' }],
          },
        };
      }
    });
    return this.present(result.raw, stationCatalog, result.cache, result.extra);
  }
}
