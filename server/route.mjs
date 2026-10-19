import { ServiceError, readJsonResponse, publicError } from './errors.mjs';
import { MemoryCache, SingleFlight } from './cache.mjs';

export function parseRoutePoint(value) {
  if (typeof value !== 'string') throw new ServiceError('INVALID_ROUTE_POINT', '경로의 출발지와 목적지를 선택해 주세요.', 400);
  const parts = value.split(',');
  if (parts.length !== 2 || parts.some(part => part.trim() === '')) throw new ServiceError('INVALID_ROUTE_POINT', '경로 좌표는 경도,위도 형식이어야 합니다.', 400);
  const [lng, lat] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 32 || lat > 40 || lng < 123 || lng > 133) throw new ServiceError('INVALID_ROUTE_POINT', '대한민국 영역의 올바른 경로 좌표를 입력해 주세요.', 400);
  return { lat, lng };
}

export function normalizeNaverRoute(payload, option = 'traoptimal') {
  const routes = payload?.route?.[option];
  if (payload?.code !== 0 || !Array.isArray(routes) || routes.length !== 1) throw new ServiceError('ROUTE_NOT_CONFIRMED', '경로 제공사가 하나의 확정된 경로를 반환하지 않았습니다.');
  const route = routes[0]; const summary = route.summary;
  const distanceMeters = summary?.distance; const durationMs = summary?.duration; const tollWon = summary?.tollFare;
  if (![distanceMeters, durationMs, tollWon].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) || !Array.isArray(route.path) || route.path.length < 2) {
    throw new ServiceError('ROUTE_INCOMPLETE', '거리·시간·통행료를 모두 확인하지 못해 우회 비용을 계산할 수 없습니다.');
  }
  const path = route.path.map(point => {
    if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(value => typeof value === 'number' && Number.isFinite(value))) throw new ServiceError('ROUTE_INCOMPLETE', '경로의 위치 정보가 올바르지 않습니다.');
    const [lng, lat] = point;
    if (lng < 123 || lng > 133 || lat < 32 || lat > 40) throw new ServiceError('ROUTE_INCOMPLETE', '경로가 조회 가능한 영역을 벗어났습니다.');
    return [lng, lat];
  });
  return { distanceMeters, durationSeconds: durationMs / 1000, tollWon, path };
}

export class NaverRouteClient {
  constructor({ apiKeyId = '', apiKey = '', quota, fetchImpl = fetch, clock = Date.now, timeoutMs = 12_000, ttlMs = 120_000 } = {}) {
    this.apiKeyId = apiKeyId.trim(); this.apiKey = apiKey.trim(); this.quota = quota;
    this.fetchImpl = fetchImpl; this.clock = clock; this.timeoutMs = timeoutMs; this.ttlMs = ttlMs;
    // Locations are retained only in a short-lived in-memory cache; no route persistence.
    this.cache = new MemoryCache({ clock, staleMaxMs: 0, maxEntries: 50 }); this.singleFlight = new SingleFlight();
  }
  get configured() { return Boolean(this.apiKeyId && this.apiKey); }

  async request({ origin, destination, via, option }) {
    await this.quota?.reserve(1);
    const params = new URLSearchParams({ start: `${origin.lng},${origin.lat}`, goal: `${destination.lng},${destination.lat}`, option });
    if (via) params.set('waypoints', `${via.lng},${via.lat}`);
    try {
      const response = await this.fetchImpl(`https://maps.apigw.ntruss.com/map-direction/v1/driving?${params}`, { headers: { 'x-ncp-apigw-api-key-id': this.apiKeyId, 'x-ncp-apigw-api-key': this.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
      return normalizeNaverRoute(await readJsonResponse(response, 'NAVER', 5_000_000), option);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('NAVER_NETWORK_ERROR', '도로 경로를 조회하지 못했습니다. 우회 비용을 확정할 수 없습니다.');
    }
  }

  async route({ origin: originText, destination: destinationText, via: viaText }) {
    const origin = parseRoutePoint(originText); const destination = parseRoutePoint(destinationText);
    const via = viaText ? parseRoutePoint(viaText) : null; const option = 'traoptimal';
    const empty = { provider: 'naver', option, fetchedAt: null, direct: null, via: null, extra: null };
    if (!this.configured) return { ...empty, status: 'unavailable', error: { code: 'NAVER_CREDENTIALS_REQUIRED', message: '도로 경로가 연결되면 우회 거리·시간·통행료를 비교할 수 있습니다.' } };
    if (origin.lat === destination.lat && origin.lng === destination.lng) throw new ServiceError('ROUTE_SAME_ENDPOINTS', '출발지와 목적지를 서로 다르게 선택해 주세요.', 400);
    const key = JSON.stringify({ origin, destination, via, option });
    const cached = this.cache.get(key);
    if (cached) return { ...cached.value, cache: { hit: true, ageSeconds: cached.ageSeconds } };
    return this.singleFlight.run(key, async () => {
      try {
        const direct = await this.request({ origin, destination, option });
        const withVia = via ? await this.request({ origin, destination, via, option }) : null;
        const extra = withVia ? { distanceMeters: withVia.distanceMeters - direct.distanceMeters, durationSeconds: withVia.durationSeconds - direct.durationSeconds, tollWon: withVia.tollWon - direct.tollWon } : null;
        // A materially shorter via route may reflect a different traffic solution.
        // Keep the comparison unconfirmed instead of converting it into a guaranteed saving.
        if (extra && (extra.distanceMeters < 0 || extra.durationSeconds < 0)) {
          return { ...empty, status: 'error', fetchedAt: new Date(this.clock()).toISOString(), direct, via: withVia, error: { code: 'ROUTE_COMPARISON_AMBIGUOUS', message: '직행·경유 경로의 교통 조건이 달라 우회 비용을 확정할 수 없습니다. 다시 비교해 주세요.' } };
        }
        const value = { status: 'ready', provider: 'naver', option, fetchedAt: new Date(this.clock()).toISOString(), direct, via: withVia, extra, estimate: true };
        this.cache.set(key, value, this.ttlMs);
        return { ...value, cache: { hit: false, ageSeconds: 0 } };
      } catch (error) {
        return { ...empty, status: 'error', error: publicError(error) };
      }
    });
  }
}
