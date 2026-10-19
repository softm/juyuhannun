import { FUELS, OPINET_SOURCE } from './opinet.mjs';
import { ServiceError, publicError } from './errors.mjs';

// Aggregate references deliberately use averagePrice, never station.price.
export const BENCHMARK_FUELS = Object.freeze({ ...FUELS, C004: 'kerosene' });
const FUEL_NAMES = Object.freeze({ B027: '휘발유', D047: '자동차용경유', B034: '고급휘발유', K015: '자동차용부탄', C004: '실내등유' });
const DEFINITIONS = Object.freeze({
  national: { endpoint: 'avgAllPrice.do', apiId: 4 },
  sido: { endpoint: 'avgSidoPrice.do', apiId: 6 },
  sigun: { endpoint: 'avgSigunPrice.do', apiId: 7 },
});
const textValue = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 300) : '';
const emptyCache = () => ({ hit: false, ageSeconds: null, stale: false });
const hasFuel = fuel => Object.hasOwn(BENCHMARK_FUELS, fuel);

function decimal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const result = Number(text.replaceAll(',', ''));
  return Number.isFinite(result) ? result : null;
}

function sourceFor(scope) {
  const definition = DEFINITIONS[scope];
  return {
    ...OPINET_SOURCE,
    apiUrl: `https://www.opinet.co.kr/api/${definition.endpoint}`,
    documentationUrl: `https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=${definition.apiId}`,
    ...(scope === 'national' ? { metadataUrl: 'https://www.data.go.kr/data/15150932/openapi.do' } : {}),
  };
}

/** Validate an official YYYYMMDD reference date without inventing a time. */
export function parseBenchmarkDate(value) {
  const text = textValue(value);
  if (!/^\d{8}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

export function validateBenchmarkQuery({ fuel = null, sido = null, includeSigun = false } = {}) {
  if (fuel === '') fuel = null;
  if (sido === '') sido = null;
  if (fuel !== null && (typeof fuel !== 'string' || !hasFuel(fuel))) {
    throw new ServiceError('INVALID_BENCHMARK_FUEL', '평균가격 조회에 지원하지 않는 유종입니다.', 400);
  }
  if (sido !== null && (typeof sido !== 'string' || !/^\d{2}$/.test(sido) || sido === '00')) {
    throw new ServiceError('INVALID_BENCHMARK_SIDO', '오피넷의 시도코드 2자리를 선택해 주세요.', 400);
  }
  if (typeof includeSigun !== 'boolean') {
    throw new ServiceError('INVALID_BENCHMARK_OPTION', '시군구 평균가격 조회 여부는 true 또는 false여야 합니다.', 400);
  }
  if (includeSigun && !sido) {
    throw new ServiceError('INVALID_BENCHMARK_SIDO', '시군구 평균가격을 조회하려면 시도를 먼저 선택해 주세요.', 400);
  }
  return { fuel, sido, includeSigun };
}

/**
 * Normalize only documented aggregate fields. A regional response without
 * TRADE_DT stays undated even if a national response carries a date.
 */
export function normalizeBenchmark(row, { scope, sido = null, fetchedAt } = {}) {
  if (!Object.hasOwn(DEFINITIONS, scope) || !row || typeof row !== 'object') return null;
  const fuel = textValue(row.PRODCD);
  if (!hasFuel(fuel)) return null;
  let areaCode = null;
  let areaName = '전국';
  let sidoCode = null;
  let sigunCode = null;
  if (scope === 'sido') {
    areaCode = textValue(row.SIDOCD);
    if (!/^\d{2}$/.test(areaCode) || areaCode === '00') return null;
    areaName = textValue(row.SIDONM) || null;
    sidoCode = areaCode;
  } else if (scope === 'sigun') {
    areaCode = textValue(row.SIGUNCD);
    if (typeof sido !== 'string' || !/^\d{2}$/.test(sido) || !/^\d{4}$/.test(areaCode) || !areaCode.startsWith(sido)) return null;
    if (textValue(row.SIDOCD) && textValue(row.SIDOCD) !== sido) return null;
    areaName = textValue(row.SIGUNNM) || null;
    sidoCode = sido;
    sigunCode = areaCode;
  }
  const sourceDate = textValue(row.TRADE_DT) || null;
  const parsedDate = parseBenchmarkDate(sourceDate);
  const fetchedMs = Date.parse(fetchedAt);
  const fetchedDay = Number.isFinite(fetchedMs) ? new Date(fetchedMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : null;
  const future = parsedDate !== null && fetchedDay !== null && parsedDate > fetchedDay;
  const asOfDate = future ? null : parsedDate;
  const average = decimal(row.PRICE);
  const change = decimal(row.DIFF);
  return {
    id: `${scope}:${areaCode ?? 'KR'}:${fuel}`,
    dataGranularity: 'aggregate',
    scope, areaCode, areaName, sidoCode, sigunCode,
    fuel, fuelName: textValue(row.PRODNM) || FUEL_NAMES[fuel],
    averagePrice: average !== null && average > 0 && average <= 100_000 ? average : null,
    dayOverDayChange: change !== null && Math.abs(change) <= 100_000 ? change : null,
    unit: 'KRW/L',
    asOfDate,
    dateStatus: asOfDate ? 'reported' : 'unknown',
    dateIssue: future ? 'future' : parsedDate ? null : sourceDate ? 'invalid' : 'not_provided',
    sourceDate,
    sourcePrice: textValue(row.PRICE) || null,
    sourceChange: textValue(row.DIFF) || null,
    fetchedAt: Number.isFinite(fetchedMs) ? fetchedAt : null,
    source: sourceFor(scope),
  };
}

function normalizeDataset(rows, { scope, sido, fetchedAt }) {
  const byId = new Map();
  const conflicts = new Set();
  let rejected = 0;
  for (const row of rows) {
    const record = normalizeBenchmark(row, { scope, sido, fetchedAt });
    if (!record) { rejected += 1; continue; }
    if (conflicts.has(record.id)) continue;
    const previous = byId.get(record.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
      byId.delete(record.id);
      conflicts.add(record.id);
    } else {
      byId.set(record.id, record);
    }
  }
  const benchmarks = [...byId.values()];
  if (rows.length > 0 && (!benchmarks.length || benchmarks.every(item => item.averagePrice === null))) {
    throw new ServiceError('OPINET_BENCHMARK_SCHEMA_ERROR', '평균가격 응답의 지역·유종·가격을 확인할 수 없습니다.');
  }
  const warnings = [];
  if (rejected || conflicts.size) warnings.push({ code: 'BENCHMARK_ROWS_OMITTED', message: '지역·유종 식별자가 잘못됐거나 중복 가격이 서로 다른 평균자료를 제외했습니다.' });
  if (benchmarks.some(item => item.averagePrice === null)) warnings.push({ code: 'BENCHMARK_PRICE_INVALID', message: '값을 확인할 수 없는 평균가격은 표시하지 않습니다.' });
  if (benchmarks.some(item => !item.asOfDate)) warnings.push({ code: 'BENCHMARK_DATE_UNKNOWN', message: '기준일이 제공되지 않거나 확인되지 않은 평균자료가 있습니다. 수집시각은 가격 기준일이 아닙니다.' });
  if (benchmarks.some(item => item.dateIssue === 'future' || item.dateIssue === 'invalid')) warnings.push({ code: 'BENCHMARK_SOURCE_DATE_INVALID', message: '잘못됐거나 미래인 원본 기준일을 현재 기준일로 사용하지 않았습니다.' });
  if (benchmarks.some(item => item.dayOverDayChange === null)) warnings.push({ code: 'BENCHMARK_CHANGE_UNKNOWN', message: '전일 대비 증감을 확인할 수 없는 자료가 있습니다.' });
  const partial = rejected > 0 || conflicts.size > 0 || benchmarks.some(item => item.averagePrice === null || item.dateIssue === 'future' || item.dateIssue === 'invalid' || (scope === 'national' && !item.asOfDate));
  return { status: partial ? 'partial' : 'ready', provider: 'opinet', dataGranularity: 'aggregate', scope, sido, fetchedAt, benchmarks, warnings, source: sourceFor(scope) };
}

function requestedDefinitions(query) {
  return [
    { scope: 'national', parameters: {} },
    { scope: 'sido', parameters: {} },
    ...(query.includeSigun ? [{ scope: 'sigun', parameters: { sido: query.sido } }] : []),
  ];
}

/** Uses the same OpinetClient instance, durable quota, cache and single-flight. */
export class OpinetBenchmarkClient {
  constructor({ client } = {}) {
    if (!client || typeof client.request !== 'function' || typeof client.cached !== 'function' || typeof client.clock !== 'function') {
      throw new TypeError('OpinetBenchmarkClient requires an existing OpinetClient');
    }
    this.client = client;
  }

  get configured() { return this.client.configured; }

  async dataset(scope, parameters) {
    const endpoint = DEFINITIONS[scope].endpoint;
    const sido = parameters.sido ?? null;
    // One request returns every documented product. Local filtering prevents
    // multiplying quota use when the UI switches fuel or selected province.
    return this.client.cached(`benchmarks:v1:${scope}:${sido ?? 'all'}`, async () => {
      const rows = await this.client.request(endpoint, parameters);
      const fetchedAt = new Date(this.client.clock()).toISOString();
      return normalizeDataset(rows, { scope, sido, fetchedAt });
    });
  }

  async snapshot(input = {}) {
    const query = validateBenchmarkQuery(input);
    const requested = requestedDefinitions(query);
    const coverage = {
      kind: 'regional_average',
      scopes: requested.map(item => item.scope),
      fuel: query.fuel,
      sido: query.sido,
      sigunRequested: query.includeSigun,
      complete: false,
      description: '전국·지역별 평균가격 참고자료입니다. 개별 주유소의 판매가격이나 실제 절약액을 나타내지 않습니다.',
    };
    if (!this.configured) {
      const error = { code: 'OPINET_CREDENTIALS_REQUIRED', message: '오피넷 인증키 연결 후 평균가격을 조회할 수 있습니다.' };
      return {
        status: 'awaiting_credentials', provider: 'opinet', dataGranularity: 'aggregate', fetchedAt: null,
        benchmarks: [], datasets: requested.map(({ scope }) => ({ scope, status: 'awaiting_credentials', fetchedAt: null, count: 0, cache: emptyCache(), source: sourceFor(scope) })),
        coverage, cache: emptyCache(), warnings: [], error,
      };
    }
    const loaded = await Promise.allSettled(requested.map(({ scope, parameters }) => this.dataset(scope, parameters)));
    const benchmarks = [];
    const datasets = [];
    const warnings = [];
    let successes = 0;
    for (let index = 0; index < loaded.length; index += 1) {
      const result = loaded[index];
      const scope = requested[index].scope;
      if (result.status === 'rejected') {
        const error = publicError(result.reason);
        datasets.push({ scope, status: 'error', fetchedAt: null, count: 0, cache: emptyCache(), source: sourceFor(scope), error });
        warnings.push({ scope, code: 'BENCHMARK_DATASET_UNAVAILABLE', message: `${scope === 'national' ? '전국' : scope === 'sido' ? '시도별' : '시군구별'} 평균가격을 받지 못했습니다.` });
        continue;
      }
      successes += 1;
      const value = result.value;
      const selected = value.benchmarks.filter(item => (!query.fuel || item.fuel === query.fuel) && (item.scope === 'national' || !query.sido || item.sidoCode === query.sido));
      benchmarks.push(...selected);
      warnings.push(...value.warnings.map(item => ({ scope, ...item })));
      datasets.push({
        scope, status: value.status, fetchedAt: value.fetchedAt, count: selected.length, loadedCount: value.benchmarks.length,
        cache: value.cache, source: value.source,
        ...(value.error ? { error: value.error } : {}),
      });
    }
    const status = successes === 0 ? 'error' : datasets.every(item => item.status === 'ready') ? 'ready' : 'partial';
    const fetches = datasets.map(item => item.fetchedAt).filter(Boolean).sort();
    const ages = datasets.map(item => item.cache.ageSeconds).filter(Number.isFinite);
    return {
      status, provider: 'opinet', dataGranularity: 'aggregate', fetchedAt: fetches.at(-1) ?? null,
      benchmarks, datasets, coverage,
      cache: { hit: datasets.every(item => item.cache.hit), ageSeconds: ages.length ? Math.max(...ages) : null, stale: datasets.some(item => item.cache.stale) },
      warnings,
      ...(status === 'error' ? { error: datasets.find(item => item.error)?.error } : {}),
    };
  }
}
