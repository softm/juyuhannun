import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpinetClient, OPINET_SOURCE, validateStationId } from '../server/opinet.mjs';
import { DailyQuota, atomicWriteJson, seoulDay } from '../server/quota.mjs';
import { ServiceError, publicError } from '../server/errors.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const isId = id => {
  try { return validateStationId(id) === id; } catch { return false; }
};
export const hasCoordinates = row => Number.isFinite(row?.lat) && Number.isFinite(row?.lng)
  && row.lat >= 32 && row.lat <= 40 && row.lng >= 123 && row.lng <= 133;
const isTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new ServiceError('COORDINATE_STATE_UNREADABLE', '좌표 보완 기록을 읽을 수 없어 기존 자료와 호출 예산을 보존하고 중단했습니다.');
  }
}

async function readCatalog(path) {
  const data = await readJson(path, { stations: [] });
  if (!Array.isArray(data?.stations)) throw new ServiceError('COORDINATE_CATALOG_INVALID', '주유소 목록 형식을 확인할 수 없어 좌표 보완을 중단했습니다.');
  return data.stations;
}

function validateState(state, now) {
  if (state?.version !== 1 || !Array.isArray(state.stations) || !Array.isArray(state.failures)
      || !/^\d{4}-\d{2}-\d{2}$/.test(state.dayBudget?.day)
      || !Number.isSafeInteger(state.dayBudget.used) || state.dayBudget.used < 0
      || state.dayBudget.day > seoulDay(now)
      || state.stations.some(row => !isId(row?.id) || !hasCoordinates(row) || !isTimestamp(row.verifiedAt))
      || state.failures.some(row => !isId(row?.id) || !Number.isSafeInteger(row.attempts) || row.attempts < 1 || !isTimestamp(row.nextRetryAt))) {
    throw new ServiceError('COORDINATE_STATE_INVALID', '좌표 보완 기록이 올바르지 않아 기존 자료와 호출 예산을 보존하고 중단했습니다.');
  }
  if (new Set(state.stations.map(row => row.id)).size !== state.stations.length
      || new Set(state.failures.map(row => row.id)).size !== state.failures.length) {
    throw new ServiceError('COORDINATE_STATE_INVALID', '좌표 보완 식별자가 중복되어 기존 자료를 보존하고 중단했습니다.');
  }
}

// The process lock protects the queue cursor and its independent 80-call daily
// budget. The shared DailyQuota lock separately protects all Opinet consumers.
async function withStateLock(path, callback) {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let handle;
  try {
    try { handle = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await stat(lockPath).catch(() => null);
      // A bounded run has at most 20 ten-second requests. Do not steal a live
      // lock; recover a checkpoint left by a terminated run after 30 minutes.
      if (!info || Date.now() - info.mtimeMs <= 30 * 60_000) {
        throw new ServiceError('COORDINATE_ENRICHMENT_BUSY', '좌표 보완 작업이 실행 중이므로 중복 조회를 중단했습니다.');
      }
      await unlink(lockPath);
      handle = await open(lockPath, 'wx', 0o600);
    }
    return await callback();
  } finally {
    if (handle) { await handle.close(); await unlink(lockPath).catch(() => {}); }
  }
}

/** Incremental official-ID-only enrichment. No price observations are written. */
export async function enrichCoordinates({
  outputDirectory = resolve(ROOT, 'public/data/nationwide'),
  ledgerPath = resolve(ROOT, '.cache/opinet-quota.json'),
  configPath = resolve(ROOT, 'config/collection.json'),
  apiKey = process.env.OPINET_API_KEY || '',
  fetchImpl = fetch,
  clock = Date.now,
  maxCallsPerRun = 20,
  maxCallsPerDay = 80,
  reservedCalls = 40,
} = {}) {
  const config = await readJson(configPath, { dailyCallLimit: 300 });
  const dailyLimit = config.dailyCallLimit ?? 300;
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 300
      || !Number.isInteger(maxCallsPerRun) || maxCallsPerRun < 1 || maxCallsPerRun > 20
      || !Number.isInteger(maxCallsPerDay) || maxCallsPerDay < 1 || maxCallsPerDay > 80
      || !Number.isInteger(reservedCalls) || reservedCalls < 40 || reservedCalls > 300) {
    throw new ServiceError('COORDINATE_BUDGET_INVALID', '좌표 보완은 회당 20회·하루 80회 이내이며 정규 수집용 40회 이상을 남겨야 합니다.');
  }
  const outputPath = resolve(outputDirectory, 'coordinate-enrichment.json');
  return withStateLock(outputPath, async () => {
    const startedAt = new Date(clock()).toISOString();
    const state = await readJson(outputPath, {
      version: 1, provider: 'opinet-detail', source: OPINET_SOURCE,
      fetchedAt: null, lastSuccessAt: null, stations: [], failures: [], queue: { cursor: null },
      dayBudget: { day: seoulDay(clock()), used: 0, limit: maxCallsPerDay },
    });
    validateState(state, clock());
    if (state.dayBudget.day !== seoulDay(clock())) state.dayBudget = { day: seoulDay(clock()), used: 0, limit: maxCallsPerDay };
    state.dayBudget.limit = maxCallsPerDay;
    const [master, search] = await Promise.all([
      readCatalog(resolve(outputDirectory, 'master.json')),
      readCatalog(resolve(outputDirectory, 'search.json')),
    ]);
    const catalog = new Map();
    let invalidIds = 0;
    for (const row of [...master, ...search]) {
      if (!isId(row?.id)) { invalidIds++; continue; }
      catalog.set(row.id, { id: row.id, located: hasCoordinates(row) || catalog.get(row.id)?.located === true });
    }
    const missing = [...catalog.values()].filter(row => !row.located).map(row => row.id).sort();
    const stations = new Map(state.stations.map(row => [row.id, row]));
    const failures = new Map(state.failures.map(row => [row.id, row]));
    const dailyQuota = new DailyQuota({ ledgerPath, limit: dailyLimit, clock });
    // Reserving through a lower limit on the SAME ledger makes the headroom
    // check atomic, even when another consumer reserves calls concurrently.
    const enrichmentQuota = dailyLimit > reservedCalls
      ? new DailyQuota({ ledgerPath, limit: dailyLimit - reservedCalls, clock }) : null;
    let calls = 0, added = 0, failed = 0;
    let cursor = state.queue?.cursor ?? null;
    let stopReason = null;
    state.lastAttempt = { at: startedAt, status: 'running', calls: 0, successCount: 0, failureCount: 0 };

    const refreshProgress = () => {
      const pending = missing.filter(id => !stations.has(id));
      const deferred = pending.filter(id => failures.has(id) && Date.parse(failures.get(id).nextRetryAt) > clock());
      state.stations = [...stations.values()].sort((a, b) => a.id.localeCompare(b.id));
      state.failures = [...failures.values()].sort((a, b) => a.id.localeCompare(b.id));
      state.queue = {
        cursor, catalogCount: catalog.size, missingCount: missing.length,
        pendingCount: pending.length, eligibleCount: pending.length - deferred.length,
        deferredCount: deferred.length, enrichedCount: stations.size, invalidIds,
        nextRetryAt: deferred.map(id => failures.get(id).nextRetryAt).sort()[0] ?? null,
      };
      state.lastAttempt.calls = calls;
      state.lastAttempt.successCount = added;
      state.lastAttempt.failureCount = failed;
      state.updatedAt = new Date(clock()).toISOString();
      state.budget = { maxCallsPerRun, maxCallsPerDay, reservedCalls, dailyLimit };
    };
    const checkpoint = async () => {
      refreshProgress();
      state.quota = await dailyQuota.snapshot();
      await atomicWriteJson(outputPath, state);
    };
    const quota = {
      reserve: async (count = 1) => {
        if (!Number.isSafeInteger(count) || count !== 1) throw new ServiceError('COORDINATE_BUDGET_INVALID', '좌표 보완 요청 단위가 올바르지 않습니다.');
        if (calls + count > maxCallsPerRun) throw new ServiceError('COORDINATE_RUN_QUOTA_EXCEEDED', '이번 좌표 보완 호출 예산에 도달했습니다.');
        if (state.dayBudget.day !== seoulDay(clock())) state.dayBudget = { day: seoulDay(clock()), used: 0, limit: maxCallsPerDay };
        if (state.dayBudget.used + count > maxCallsPerDay) throw new ServiceError('COORDINATE_DAILY_QUOTA_EXCEEDED', '오늘의 좌표 보완 호출 예산에 도달했습니다.');
        if (!enrichmentQuota) throw new ServiceError('COORDINATE_QUOTA_RESERVED', '정규 가격 수집용 호출 예산을 보존하여 좌표 보완을 미뤘습니다.');
        try { await enrichmentQuota.reserve(count); }
        catch (error) {
          if (error.code === 'OPINET_DAILY_QUOTA_EXCEEDED') throw new ServiceError('COORDINATE_QUOTA_RESERVED', '정규 가격 수집용 호출 예산을 보존하여 좌표 보완을 미뤘습니다.');
          throw error;
        }
        calls += count;
        state.dayBudget.used += count;
        // Persist consumed budgets BEFORE sending the request. A terminated run
        // can lose a response, but can never restore its consumed call allowance.
        await checkpoint();
      },
    };
    const client = new OpinetClient({ apiKey, quota, fetchImpl, clock, detailLimit: 0 });
    refreshProgress();
    delete state.error;

    if (!catalog.size) stopReason = 'awaiting_data';
    else if (!state.queue.pendingCount) stopReason = 'complete';
    else if (!client.configured) stopReason = 'awaiting_credentials';
    else {
      const pending = missing.filter(id => !stations.has(id));
      const nextIndex = cursor === null ? 0 : pending.findIndex(id => id > cursor);
      const start = nextIndex < 0 ? 0 : nextIndex;
      const ordered = [...pending.slice(start), ...pending.slice(0, start)];
      for (const id of ordered) {
        if (failures.has(id) && Date.parse(failures.get(id).nextRetryAt) > clock()) continue;
        if (calls >= maxCallsPerRun) { stopReason = 'run_budget'; break; }
        const before = calls;
        try {
          const result = await client.detail(id);
          const station = result.station;
          if (!station || station.id !== id || !hasCoordinates(station)) {
            throw new ServiceError('COORDINATE_DETAIL_INVALID', '공식 주유소 ID와 유효 좌표를 함께 확인하지 못했습니다.');
          }
          const verifiedAt = result.fetchedAt;
          if (!isTimestamp(verifiedAt)) throw new ServiceError('COORDINATE_DETAIL_INVALID', '좌표 확인 시각을 확인하지 못했습니다.');
          // Deliberately omit prices, priceUpdatedAt, sourceDate and fetchedAt.
          // Coordinate verification must not freshen any daily price record.
          stations.set(id, {
            id, name: station.name, lat: station.lat, lng: station.lng,
            sourceCoordinates: station.sourceCoordinates,
            coordinateSource: 'opinet-detail-by-id', verifiedAt, coordinateVerifiedAt: verifiedAt,
            source: OPINET_SOURCE,
          });
          failures.delete(id);
          cursor = id;
          added++;
          state.lastSuccessAt = verifiedAt;
          state.fetchedAt = verifiedAt;
        } catch (error) {
          if (/^COORDINATE_(RUN_QUOTA_EXCEEDED|DAILY_QUOTA_EXCEEDED|QUOTA_RESERVED)$/.test(error.code ?? '')) {
            stopReason = error.code === 'COORDINATE_RUN_QUOTA_EXCEEDED' ? 'run_budget'
              : error.code === 'COORDINATE_DAILY_QUOTA_EXCEEDED' ? 'daily_budget' : 'reserved_for_prices';
            break;
          }
          if (calls === before || /^(QUOTA_|COORDINATE_STATE_)/.test(error.code ?? '')) throw error;
          const at = new Date(clock()).toISOString();
          const prior = failures.get(id);
          const attempts = (prior?.attempts ?? 0) + 1;
          const stationFailure = ['STATION_NOT_FOUND', 'OPINET_SCHEMA_ERROR', 'COORDINATE_DETAIL_INVALID'].includes(error.code);
          const backoffMs = Math.min(7 * DAY, (stationFailure ? DAY : HOUR) * 2 ** Math.min(attempts - 1, 8));
          failures.set(id, {
            id, attempts, firstAttemptAt: prior?.firstAttemptAt ?? at, lastAttemptAt: at,
            nextRetryAt: new Date(clock() + backoffMs).toISOString(), error: publicError(error),
          });
          cursor = id;
          failed++;
          if (!stationFailure) {
            state.error = publicError(error);
            stopReason = 'provider_error';
          }
        }
        await checkpoint();
        if (stopReason === 'provider_error') break;
      }
    }

    refreshProgress();
    stopReason ??= state.queue.pendingCount === 0 ? 'complete'
      : state.queue.eligibleCount === 0 ? 'retry_backoff' : 'run_budget';
    state.status = stopReason === 'complete' ? 'ready'
      : ['reserved_for_prices', 'daily_budget'].includes(stopReason) ? 'paused_quota'
      : stopReason === 'awaiting_credentials' ? 'awaiting_credentials'
      : stopReason === 'awaiting_data' ? 'awaiting_data'
      : stopReason === 'provider_error' && added === 0 ? 'error' : 'partial';
    Object.assign(state.lastAttempt, { status: state.status, completedAt: new Date(clock()).toISOString(), stopReason });
    await checkpoint();
    return {
      status: state.status, calls, added, failed, totalEnriched: stations.size,
      pendingCount: state.queue.pendingCount, eligibleCount: state.queue.eligibleCount,
      lastSuccessAt: state.lastSuccessAt, remainingCalls: state.quota.remaining,
      dayBudgetUsed: state.dayBudget.used, stopReason,
      ...(state.error ? { error: state.error } : {}),
    };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const paths = { '--output-dir': 'outputDirectory', '--ledger': 'ledgerPath', '--config': 'configPath' };
  const counts = { '--max-calls': 'maxCallsPerRun', '--daily-budget': 'maxCallsPerDay', '--reserve': 'reservedCalls' };
  try {
    for (let index = 2; index < process.argv.length; index += 2) {
      const flag = process.argv[index], value = process.argv[index + 1];
      if (!value || value.startsWith('--') || (!Object.hasOwn(paths, flag) && !Object.hasOwn(counts, flag))) {
        throw new ServiceError('COORDINATE_ARGUMENT_INVALID', '사용법: node scripts/enrich-coordinates.mjs [--output-dir 경로] [--ledger 경로] [--config 경로] [--max-calls 1~20] [--daily-budget 1~80] [--reserve 40~300]');
      }
      if (Object.hasOwn(paths, flag)) options[paths[flag]] = resolve(process.cwd(), value);
      else options[counts[flag]] = Number(value);
    }
    const summary = await enrichCoordinates(options);
    console.log(JSON.stringify(summary));
    if (summary.status === 'error') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(publicError(error)));
    process.exitCode = 1;
  }
}
