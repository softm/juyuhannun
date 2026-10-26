import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpinetClient } from '../server/opinet.mjs';
import { OpinetBenchmarkClient } from '../server/benchmarks.mjs';
import { HighwayClient } from '../server/highway.mjs';
import { DailyQuota, RunQuota } from '../server/quota.mjs';
import { publicError, ServiceError } from '../server/errors.mjs';
import { saveSnapshot } from './snapshot.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readStations(path) {
  try {
    const snapshot = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(snapshot?.stations) ? snapshot.stations : [];
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function loadStationCatalog(outputDirectory) {
  const [search, latest, regional] = await Promise.all([
    readStations(resolve(outputDirectory, 'nationwide/search.json')),
    readStations(resolve(outputDirectory, 'nationwide/latest.json')),
    readStations(resolve(outputDirectory, 'stations.json')),
  ]);
  const catalog = new Map([...(search.length ? search : latest), ...regional].filter(row => typeof row?.id === 'string').map(row => [row.id, row]));
  return [...catalog.values()];
}

/** Averages share the station collector's durable Opinet call ledger. */
export async function collectEnergy({
  outputDirectory = resolve(ROOT, 'public/data'),
  ledgerPath = resolve(ROOT, '.cache/opinet-quota.json'),
  highwayLedgerPath = resolve(ROOT, '.cache/ex-quota.json'),
  configPath = resolve(ROOT, 'config/collection.json'),
  apiKey = process.env.OPINET_API_KEY || '',
  highwayApiKey = process.env.EX_API_KEY || '',
  fetchImpl = fetch,
  clock = Date.now,
  benchmarkClient,
  highwayClient,
  stationCatalog,
} = {}) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const limit = config.dailyCallLimit ?? 300;
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) throw new ServiceError('INVALID_COLLECTION_CONFIG', '일일 오피넷 호출량 설정을 확인해 주세요.');
  const opinetQuota = new RunQuota(new DailyQuota({ ledgerPath, limit, clock }), 2);
  const exQuota = new RunQuota(new DailyQuota({ ledgerPath: highwayLedgerPath, limit: 1000, clock, provider: 'EX' }), 20);
  const opinet = new OpinetClient({ apiKey, quota: opinetQuota, fetchImpl, clock });
  const averages = benchmarkClient ?? new OpinetBenchmarkClient({ client: opinet });
  const highway = highwayClient ?? new HighwayClient({ apiKey: highwayApiKey, quota: exQuota, fetchImpl, clock });
  const highwayStationCatalog = stationCatalog ?? await loadStationCatalog(outputDirectory);
  const definitions = [
    { name: 'averages', file: 'averages.json', field: 'benchmarks', provider: 'opinet', granularity: 'aggregate', client: averages, quota: opinetQuota },
    { name: 'highway', file: 'highway.json', field: 'stations', provider: 'ex', granularity: 'station', client: highway, quota: exQuota, snapshotOptions: { stationCatalog: highwayStationCatalog } },
  ];
  const summary = {};
  // Provider operations and snapshot writes are sequential, with separate
  // failure boundaries so one provider cannot suppress the other's update.
  for (const item of definitions) {
    let next;
    try {
      next = await item.client.snapshot(item.snapshotOptions);
      if (!Array.isArray(next?.[item.field]) || !['ready', 'partial', 'error', 'awaiting_credentials'].includes(next.status)) {
        throw new ServiceError('INVALID_COLLECTION_RESPONSE', '제공기관의 자료 형식을 확인할 수 없습니다.');
      }
    } catch (error) {
      next = { status: 'error', provider: item.provider, dataGranularity: item.granularity, fetchedAt: null, [item.field]: [], warnings: [], error: publicError(error) };
    }
    next = { ...next, lastAttempt: { at: new Date(clock()).toISOString(), status: next.status, calls: item.quota.used } };
    const saved = await saveSnapshot(resolve(outputDirectory, item.file), next, item.name);
    summary[item.name] = {
      status: saved.status,
      attemptStatus: next.status,
      count: saved[item.field].length,
      fetchedAt: saved.fetchedAt ?? null,
      preserved: saved.cache?.stale === true,
      calls: item.quota.used,
    };
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index], value = process.argv[index + 1];
    if (!['--output-dir', '--ledger', '--highway-ledger', '--config'].includes(flag) || !value || value.startsWith('--')) {
      console.error('사용법: node scripts/collect-energy.mjs [--output-dir public/data] [--ledger .cache/opinet-quota.json] [--highway-ledger .cache/ex-quota.json] [--config config/collection.json]');
      process.exit(2);
    }
    flags[flag] = resolve(process.cwd(), value);
  }
  try {
    const summary = await collectEnergy({ outputDirectory: flags['--output-dir'], ledgerPath: flags['--ledger'], highwayLedgerPath: flags['--highway-ledger'], configPath: flags['--config'] });
    console.log(JSON.stringify(summary));
    if (Object.values(summary).some(item => item.attemptStatus === 'error')) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(publicError(error)));
    process.exitCode = 1;
  }
}
