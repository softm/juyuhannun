import { finite } from './core.js';

export const isKoreanPoint = point => point && finite(point.lat) && finite(point.lng) && point.lat >= 32 && point.lat <= 40 && point.lng >= 123 && point.lng <= 133;

export function observedRecently(value, now = Date.now(), maxAgeMs = 5 * 60 * 1000) {
  if (typeof value !== 'string' || !value) return false;
  const time = Date.parse(value), age = now - time;
  return Number.isFinite(time) && age >= -60_000 && age <= maxAgeMs;
}

export function safeSourceUrl(value, fallback) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return fallback;
    if (!['www.opinet.co.kr', 'opinet.co.kr', 'data.ex.co.kr', 'www.data.go.kr', 'data.go.kr', 'hying.or.kr', 'www.hying.or.kr'].includes(url.hostname)) return fallback;
    const privateParameters = new Set(['certkey', 'servicekey', 'key', 'apikey', 'accesskey', 'authkey', 'authorization', 'token', 'accesstoken', 'clientsecret', 'password', 'secret', 'sessionid']);
    for (const key of url.searchParams.keys()) {
      if (privateParameters.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return fallback;
    }
    return url.href;
  } catch { return fallback; }
}

/** A failed request can reuse only the exact query's earlier observation. */
export function energyCacheKey(view, { fuel = '', sido = '', includeSigun = false } = {}) {
  return JSON.stringify([view, fuel, view === 'averages' ? sido : '', view === 'averages' && includeSigun === true]);
}

/** Keep original observations and dates intact when a browser refresh fails. */
export function retainEnergySnapshot(next, previous, view) {
  const field = { highway: 'stations', averages: 'benchmarks' }[view];
  if (!field || !Array.isArray(next?.[field])) throw new Error('Invalid energy snapshot collection');
  if (!['error', 'awaiting_credentials'].includes(next.status)) return next;
  if (!Array.isArray(previous?.[field]) || !previous[field].length) return { ...next, [field]: [] };
  const warnings = [...(Array.isArray(previous.warnings) ? previous.warnings : []), ...(Array.isArray(next.warnings) ? next.warnings : [])]
    .filter(warning => warning?.code !== 'PRESERVED_PREVIOUS_SNAPSHOT');
  warnings.push({ code: 'PRESERVED_PREVIOUS_SNAPSHOT', message: '새 자료를 받지 못해 이전 수집자료를 표시합니다.' });
  return {
    ...previous,
    status: 'partial',
    error: next.error || { message: '새 자료를 받지 못했습니다.' },
    warnings,
    cache: { ...previous.cache, stale: true, clientRetained: true },
  };
}

export function visibleBenchmarks(items, { fuel, sido = '', query = '', includeSigun = true } = {}) {
  const text = String(query || '').trim().toLocaleLowerCase('ko');
  return (Array.isArray(items) ? items : []).filter(item => item?.dataGranularity === 'aggregate' && item.unit === 'KRW/L' && item.fuel === fuel &&
    ['national', 'sido', 'sigun'].includes(item.scope) && (includeSigun || item.scope !== 'sigun') &&
    (!sido || item.scope === 'national' || item.sidoCode === sido) &&
    (!text || `${item.areaName || ''} ${item.fuelName || ''}`.toLocaleLowerCase('ko').includes(text)))
    .sort((a, b) => ({ national: 0, sido: 1, sigun: 2 }[a.scope] ?? 9) - ({ national: 0, sido: 1, sigun: 2 }[b.scope] ?? 9) || String(a.areaName).localeCompare(String(b.areaName), 'ko'));
}
