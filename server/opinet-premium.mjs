import { ServiceError } from './errors.mjs';
import { katecToWgs84 } from './coordinates.mjs';
import { FUELS, OPINET_SOURCE, parsePriceTimestamp } from './opinet.mjs';

const text = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim().slice(0, 500) : '';
const number = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  return Number(value.replaceAll(',', ''));
};
const price = value => {
  const parsed = number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100000 ? parsed : null;
};
const yn = value => value === 'Y' ? true : value === 'N' ? false : null;

export function premiumRows(payload) {
  const oil = payload?.RESULT?.OIL ?? payload?.result?.oil ?? payload?.data?.items ?? payload?.items;
  if (Array.isArray(oil)) return oil;
  if (oil && typeof oil === 'object') return [oil];
  throw new ServiceError('OPINET_PREMIUM_SCHEMA_ERROR', '오피넷 프리미엄 API 응답 구조를 확인할 수 없습니다.');
}

export function normalizePremiumStation(row, { regionCode, fetchedAt } = {}) {
  if (!row || typeof row !== 'object') return null;
  const id = text(row.UNI_ID ?? row.uniId ?? row.ID);
  const name = text(row.OS_NM ?? row.osNm ?? row.NAME);
  if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || !name) return null;
  let lat = number(row.LAT ?? row.lat), lng = number(row.LNG ?? row.lng ?? row.LON ?? row.lon);
  const x = number(row.GIS_X_COOR ?? row.x), y = number(row.GIS_Y_COOR ?? row.y);
  if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
    if (!(Number.isFinite(x) && Number.isFinite(y))) return null;
    try { ({ lat, lng } = katecToWgs84({ x, y })); } catch { return null; }
  }
  if (lat < 32 || lat > 40 || lng < 123 || lng > 133) return null;
  return {
    id, name, dataGranularity: 'station',
    brand: text(row.POLL_DIV_CD ?? row.POLL_DIV_CO ?? row.brand) || null,
    lat, lng, regionCode: text(regionCode) || null,
    address: text(row.VAN_ADR ?? row.address) || null,
    roadAddress: text(row.NEW_ADR ?? row.roadAddress) || null,
    phone: text(row.TEL ?? row.phone) || null,
    facilities: {
      self: yn(row.SELF_YN), carWash: yn(row.CAR_WASH_YN),
      maintenance: yn(row.MAINT_YN), convenience: yn(row.CVS_YN),
      lpg: row.LPG_YN === 'C' || row.LPG_YN === 'Y' ? true : row.LPG_YN === 'N' ? false : null,
    },
    fetchedAt, source: OPINET_SOURCE, prices: {},
  };
}

export function normalizePremiumPrices(row, { fetchedAt } = {}) {
  if (!row || typeof row !== 'object') return [];
  const id = text(row.UNI_ID ?? row.uniId ?? row.ID);
  if (!id) return [];
  const nested = Array.isArray(row.OIL_PRICE) ? row.OIL_PRICE : row.OIL_PRICE && typeof row.OIL_PRICE === 'object' ? [row.OIL_PRICE] : null;
  const candidates = nested ?? [row];
  const result = [];
  for (const item of candidates) {
    const fuel = text(item.PRODCD ?? item.prodcd ?? item.PRODUCT_CODE);
    if (!Object.hasOwn(FUELS, fuel)) continue;
    const amount = price(item.PRICE ?? item.price);
    if (amount === null) continue;
    const parsedAt = parsePriceTimestamp(item.TRADE_DT ?? item.tradeDate, item.TRADE_TM ?? item.tradeTime);
    result.push({
      id, fuel,
      value: {
        price: amount, unit: 'KRW/L', priceUpdatedAt: parsedAt,
        fetchedAt, sourceDate: text(item.TRADE_DT ?? item.tradeDate) || null,
        sourceTime: text(item.TRADE_TM ?? item.tradeTime) || null,
      },
    });
  }
  return result;
}

function validateEndpoint(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new ServiceError('OPINET_PREMIUM_CONFIG_INVALID', `${label} 주소를 확인해 주세요.`, 500); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !(url.hostname === 'opinet.co.kr' || url.hostname.endsWith('.opinet.co.kr'))) {
    throw new ServiceError('OPINET_PREMIUM_CONFIG_INVALID', `${label}는 오피넷 HTTPS 주소여야 합니다.`, 500);
  }
  return url;
}

export class PremiumOpinetClient {
  constructor({ apiKey = '', masterUrl = '', priceUrl = '', keyParam = 'certkey', areaParam = 'area', fetchImpl = fetch, timeoutMs = 20000 } = {}) {
    this.apiKey = apiKey.trim();
    this.masterUrl = masterUrl.trim();
    this.priceUrl = priceUrl.trim();
    this.keyParam = /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(keyParam) ? keyParam : 'certkey';
    this.areaParam = /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(areaParam) ? areaParam : 'area';
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }
  get configured() { return Boolean(this.apiKey && this.masterUrl && this.priceUrl); }
  async request(endpoint, area) {
    if (!this.configured) throw new ServiceError('OPINET_PREMIUM_CREDENTIALS_REQUIRED', '전국 주유소 수집용 프리미엄 API 설정이 필요합니다.', 503);
    const base = validateEndpoint(endpoint === 'master' ? this.masterUrl : this.priceUrl, endpoint === 'master' ? '기본정보 API' : '가격 API');
    const url = new URL(base);
    url.searchParams.set(this.keyParam, this.apiKey);
    url.searchParams.set(this.areaParam, area);
    if (!url.searchParams.has('out')) url.searchParams.set('out', 'json');
    this.calls += 1;
    try {
      const response = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error('provider response');
      const payload = await response.json();
      return premiumRows(payload);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('OPINET_PREMIUM_NETWORK_ERROR', '오피넷 프리미엄 API에서 전국 자료를 받지 못했습니다.');
    }
  }
}
