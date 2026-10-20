import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpinetClient, FUELS, OPINET_SOURCE, validateSearch } from '../server/opinet.mjs';
import { DailyQuota, RunQuota, atomicWriteJson } from '../server/quota.mjs';
import { publicError, ServiceError } from '../server/errors.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hasPrice = value => Number.isFinite(value?.price) && value.price > 0 && value.price <= 100_000;

export function mergeStationRecords(previous, incoming) {
  if (!previous) return structuredClone(incoming);
  const prices = { ...previous.prices };
  for (const [fuel, price] of Object.entries(incoming.prices ?? {})) {
    const old = prices[fuel];
    // A missing/invalid observation is not a new selling price. Preserve the
    // last valid price with its original observation and source timestamps.
    if (hasPrice(old) && !hasPrice(price)) continue;
    // An unchanged undated observation can keep the older, independently
    // documented observation, with its OLD fetchedAt and source timestamp.
    if (old?.priceUpdatedAt && !price.priceUpdatedAt && old.price === price.price) continue;
    if (!old || (price.fetchedAt ?? incoming.fetchedAt ?? '') >= (old.fetchedAt ?? previous.fetchedAt ?? '')) {
      // An undated new nearby price must not inherit an old price's timestamp.
      prices[fuel] = { ...price };
    }
  }
  const base = (incoming.fetchedAt ?? '') >= (previous.fetchedAt ?? '') ? { ...previous, ...incoming } : { ...incoming, ...previous };
  const fuel = previous.fuel || incoming.fuel;
  const selected = prices[fuel];
  return { ...base, address: base.address ?? previous.address ?? incoming.address, roadAddress: base.roadAddress ?? previous.roadAddress ?? incoming.roadAddress, phone: base.phone ?? previous.phone ?? incoming.phone, fuel, prices, price: selected?.price ?? null, priceUpdatedAt: selected?.priceUpdatedAt ?? null, priceTimeStatus: selected?.priceUpdatedAt ? 'reported' : 'unknown', coverageZones: [...new Set([...(previous.coverageZones ?? []), ...(incoming.coverageZones ?? [])])] };
}

function validateConfig(config) {
  if (config?.version !== 1 || !Array.isArray(config.zones) || !config.zones.length || config.zones.length > 20 || !Array.isArray(config.fuels) || !config.fuels.length || config.fuels.some(fuel => !Object.hasOwn(FUELS, fuel))) throw new ServiceError('INVALID_COLLECTION_CONFIG', '수집 범위 설정이 올바르지 않습니다.', 400);
  const ids = new Set();
  for (const zone of config.zones) {
    if (!/^[a-z0-9-]{1,60}$/.test(zone.id) || ids.has(zone.id) || typeof zone.name !== 'string') throw new ServiceError('INVALID_COLLECTION_CONFIG', '수집 지역 식별자가 올바르지 않습니다.', 400);
    ids.add(zone.id); validateSearch({ ...zone, fuel: config.fuels[0] });
  }
  for (const [field, fallback, maximum] of [['dailyCallLimit', 300, 300], ['maxCallsPerRun', 36, 300], ['detailLimitPerSearch', 3, 20]]) {
    config[field] ??= fallback;
    if (!Number.isInteger(config[field]) || config[field] < (field === 'detailLimitPerSearch' ? 0 : 1) || config[field] > maximum) throw new ServiceError('INVALID_COLLECTION_CONFIG', '수집 호출량 설정이 허용 범위를 넘었습니다.', 400);
  }
  return config;
}

export async function collect({ outputPath, ledgerPath, configPath, apiKey = process.env.OPINET_API_KEY || '', fetchImpl = fetch, clock = Date.now } = {}) {
  outputPath ??= resolve(PROJECT_ROOT, 'public/data/stations.json');
  ledgerPath ??= resolve(PROJECT_ROOT, '.cache/opinet-quota.json');
  configPath ??= resolve(PROJECT_ROOT, 'config/collection.json');
  const config = validateConfig(JSON.parse(await readFile(configPath, 'utf8')));
  let previous = null;
  try { previous = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new ServiceError('PREVIOUS_SNAPSHOT_UNREADABLE', '이전 수집 자료를 읽을 수 없어 덮어쓰기를 중단했습니다.'); }
  const attemptedAt = new Date(clock()).toISOString();
  const dailyQuota = new DailyQuota({ ledgerPath, limit: config.dailyCallLimit, clock });
  const runQuota = new RunQuota(dailyQuota, config.maxCallsPerRun);
  const coverage = { kind: 'sample_zones', complete: false, description: config.description, zones: [] };
  const empty = { version: 1, status: 'awaiting_credentials', provider: 'opinet', fetchedAt: null, source: OPINET_SOURCE, cache: { hit: false, ageSeconds: null, stale: false }, coverage, stations: [], warnings: [] };
  if (!apiKey.trim()) {
    coverage.zones = config.zones.flatMap(zone => config.fuels.map(fuel => ({ id: zone.id, name: zone.name, center: { lat: zone.lat, lng: zone.lng }, radiusMeters: zone.radius, fuel, status: 'awaiting_credentials', count: 0, lastSuccessAt: null })));
    const retained = previous?.stations?.length ? previous : { ...empty, ...(previous || {}), coverage };
    const snapshot = { ...retained, status: 'awaiting_credentials', lastAttempt: { at: attemptedAt, status: 'awaiting_credentials', calls: 0 }, warnings: [{ code: 'OPINET_CREDENTIALS_REQUIRED', message: '오피넷 인증키가 연결되지 않았습니다. 표시 자료가 있으면 이전 수집 자료이며 가격 기준시각은 갱신하지 않았습니다.' }] };
    await atomicWriteJson(outputPath, snapshot);
    return { status: snapshot.status, count: snapshot.stations?.length ?? 0, calls: 0, fetchedAt: snapshot.fetchedAt ?? null };
  }
  const client = new OpinetClient({ apiKey, quota: runQuota, fetchImpl, clock, detailLimit: config.detailLimitPerSearch });
  const stations = new Map(); const warnings = []; let successes = 0; let failures = 0; let partials = 0; let lastSuccessAt = null;
  const previousZones = new Map((previous?.coverage?.zones ?? []).map(zone => [`${zone.id}:${zone.fuel}`, zone]));
  for (const zone of config.zones) {
    for (const fuel of [...new Set(config.fuels)]) {
      const zoneKey = `${zone.id}:${fuel}`; const oldZone = previousZones.get(zoneKey);
      const zoneMeta = { id: zone.id, name: zone.name, center: { lat: zone.lat, lng: zone.lng }, radiusMeters: zone.radius, fuel, status: 'error', count: 0, lastSuccessAt: oldZone?.lastSuccessAt ?? null };
      try {
        const result = await client.nearby({ ...zone, fuel });
        successes += 1;
        if (result.status === 'partial') partials += 1;
        lastSuccessAt = result.fetchedAt > (lastSuccessAt ?? '') ? result.fetchedAt : lastSuccessAt;
        Object.assign(zoneMeta, { status: result.status, count: result.stations.length, lastSuccessAt: result.fetchedAt });
        for (const station of result.stations) {
          const record = { ...station, coverageZones: [zoneKey] };
          stations.set(record.id, mergeStationRecords(stations.get(record.id), record));
        }
        warnings.push(...result.warnings.map(warning => ({ ...warning, zone: zoneKey })));
      } catch (error) {
        failures += 1; zoneMeta.error = publicError(error);
        warnings.push({ code: 'ZONE_COLLECTION_FAILED', message: `${zone.name} ${fuel} 자료를 갱신하지 못했습니다.`, zone: zoneKey });
        // Retain failed-zone data with its original source/fetch timestamps.
        for (const station of previous?.stations ?? []) {
          if (station.coverageZones?.includes(zoneKey)) stations.set(station.id, mergeStationRecords(stations.get(station.id), station));
        }
      }
      coverage.zones.push(zoneMeta);
    }
  }
  let snapshot;
  if (successes === 0) {
    snapshot = { ...(previous || empty), status: previous?.stations?.length ? 'partial' : 'error', coverage, lastAttempt: { at: attemptedAt, status: 'error', calls: runQuota.used }, warnings, error: { code: 'COLLECTION_FAILED', message: '새 가격 자료를 받지 못했습니다. 마지막 정상 자료가 있으면 그대로 보존했습니다.' } };
  } else {
    snapshot = { version: 1, status: failures || partials ? 'partial' : 'ready', provider: 'opinet', source: OPINET_SOURCE, fetchedAt: lastSuccessAt, lastAttempt: { at: attemptedAt, status: failures || partials ? 'partial' : 'ready', calls: runQuota.used }, coverage, stations: [...stations.values()].sort((a, b) => a.id.localeCompare(b.id)), cache: { hit: false, ageSeconds: 0, stale: false }, warnings };
  }
  snapshot.quota = await dailyQuota.snapshot().catch(() => ({ limit: config.dailyCallLimit, remaining: null, used: null, error: 'QUOTA_LEDGER_UNREADABLE' }));
  await atomicWriteJson(outputPath, snapshot);
  return { status: snapshot.status, count: snapshot.stations?.length ?? 0, calls: runQuota.used, fetchedAt: snapshot.fetchedAt ?? null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index]; const value = process.argv[index + 1];
    if (!['--output', '--ledger', '--config'].includes(flag) || !value || value.startsWith('--')) {
      console.error('사용법: node scripts/collect.mjs [--output public/data/stations.json] [--ledger .cache/opinet-quota.json] [--config config/collection.json]');
      process.exit(2);
    }
    flags[flag] = resolve(process.cwd(), value);
  }
  try {
    const summary = await collect({ outputPath: flags['--output'], ledgerPath: flags['--ledger'], configPath: flags['--config'] });
    console.log(JSON.stringify(summary));
    // Data error status stays in the output; the deployment can retain the previous snapshot.
    if (summary.status === 'error') process.exitCode = 1;
  } catch (error) { console.error(JSON.stringify(publicError(error))); process.exitCode = 1; }
}
