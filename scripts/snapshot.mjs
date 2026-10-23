import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const COLLECTION_FIELDS = { highway: 'stations', averages: 'benchmarks', comparisons: 'comparisons' };
const AVERAGE_SCOPES = new Set(['national', 'sido', 'sigun']);

function sameAverageCoverage(next, previous) {
  if (!next || !previous || next.kind !== 'regional_average' || previous.kind !== next.kind) return false;
  if (['fuel', 'sido', 'sigunRequested'].some(key => !Object.hasOwn(next, key) || !Object.hasOwn(previous, key) || next[key] !== previous[key])) return false;
  const validScopes = value => Array.isArray(value) && value.length > 0 && value.every(scope => AVERAGE_SCOPES.has(scope)) && new Set(value).size === value.length;
  return validScopes(next.scopes) && validScopes(previous.scopes) && [...next.scopes].sort().join(',') === [...previous.scopes].sort().join(',');
}

/** Partial success can retain only explicitly failed datasets in the same query. */
function preserveFailedAverageDatasets(next, previous) {
  if (!sameAverageCoverage(next.coverage, previous?.coverage) || !Array.isArray(next.datasets) || !Array.isArray(previous?.datasets) || !Array.isArray(previous?.benchmarks)) return next;
  const restored = new Map();
  const nextIds = new Set(next.benchmarks.map(row => row?.id));
  for (const dataset of next.datasets) {
    if (dataset?.status !== 'error' || !next.coverage.scopes.includes(dataset.scope) || restored.has(dataset.scope)) continue;
    // A contradictory payload is not an empty failed dataset to restore.
    if (next.benchmarks.some(row => row?.scope === dataset.scope)) continue;
    const oldDataset = previous.datasets.find(row => row?.scope === dataset.scope && ['ready', 'partial'].includes(row.status));
    if (!oldDataset) continue;
    const rows = previous.benchmarks.filter(row => row?.scope === dataset.scope && row.dataGranularity === 'aggregate' && row.unit === 'KRW/L' && typeof row.id === 'string' &&
      (!next.coverage.fuel || row.fuel === next.coverage.fuel) && (!next.coverage.sido || row.scope === 'national' || row.sidoCode === next.coverage.sido) && !nextIds.has(row.id));
    if (!rows.length) continue;
    for (const row of rows) nextIds.add(row.id);
    restored.set(dataset.scope, { rows, dataset: { ...oldDataset, status: 'partial', count: rows.length, cache: { ...oldDataset.cache, stale: true }, error: dataset.error || { code: 'DATASET_UNAVAILABLE', message: '새 지역 평균자료를 수집하지 못했습니다.' } } });
  }
  if (!restored.size) return next;
  return {
    ...next,
    benchmarks: [...next.benchmarks, ...[...restored.values()].flatMap(item => item.rows)],
    datasets: next.datasets.map(dataset => restored.get(dataset?.scope)?.dataset || dataset),
    cache: { ...next.cache, stale: true },
    warnings: [
      ...(Array.isArray(next.warnings) ? next.warnings : []),
      ...[...restored.keys()].map(scope => ({ code: 'PRESERVED_PREVIOUS_DATASET', scope, message: '조회에 실패한 범위의 이전 평균자료를 원래 기준일과 수집시각으로 표시합니다.' })),
    ],
  };
}

/** Only failed collections retain a previous result; timestamps stay untouched. */
export function preservePrevious(next, previous, collection) {
  const field = COLLECTION_FIELDS[collection];
  if (!field || !Array.isArray(next?.[field])) throw new Error('Invalid public snapshot collection');
  if (collection === 'averages' && next.status === 'partial') return preserveFailedAverageDatasets(next, previous);
  if (!['error', 'awaiting_credentials'].includes(next.status) || !Array.isArray(previous?.[field]) || !previous[field].length) return next;
  return {
    ...previous,
    status: 'partial',
    cache: { ...(previous.cache || {}), stale: true },
    ...(next.lastAttempt ? { lastAttempt: next.lastAttempt } : {}),
    ...(Array.isArray(previous.datasets) ? { datasets: previous.datasets.map(dataset => ({ ...dataset, cache: { ...(dataset.cache || {}), stale: true } })) } : {}),
    warnings: [...(previous.warnings || []), { code: 'PRESERVED_PREVIOUS_SNAPSHOT', message: '새 자료를 받지 못해 이전 자료를 표시합니다. 원래의 기준시각과 수집 시각을 유지했습니다.' }].slice(-20),
    error: next.error || { code: 'COLLECTION_UNAVAILABLE', message: '새 자료를 수집하지 못했습니다.' },
  };
}

export async function saveSnapshot(path, next, collection) {
  let previous = null;
  try { previous = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Previous public snapshot is unreadable'); }
  const result = preservePrevious(next, previous, collection);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o644 });
  await rename(temp, path);
  return result;
}
