import { readFile, readdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpinetClient, validateAreaCodes, OPINET_SOURCE } from '../server/opinet.mjs';
import { PremiumOpinetClient, normalizePremiumStation, normalizePremiumPrices } from '../server/opinet-premium.mjs';
import { atomicWriteJson, seoulDay } from '../server/quota.mjs';
import { publicError } from '../server/errors.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function pruneHistory(directory, keepDays) {
  let names = [];
  try { names = (await readdir(directory)).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse(); } catch { return; }
  await Promise.all(names.slice(keepDays).map(name => unlink(resolve(directory, name)).catch(() => {})));
}

export async function collectNationwide({
  outputDirectory = resolve(ROOT, 'public/data/nationwide'),
  generalApiKey = process.env.OPINET_API_KEY || '',
  premiumApiKey = process.env.OPINET_PREMIUM_API_KEY || '',
  masterUrl = process.env.OPINET_PREMIUM_MASTER_URL || '',
  priceUrl = process.env.OPINET_PREMIUM_PRICE_URL || '',
  keyParam = process.env.OPINET_PREMIUM_KEY_PARAM || 'certkey',
  areaParam = process.env.OPINET_PREMIUM_AREA_PARAM || 'area',
  fetchImpl = fetch,
  clock = Date.now,
  historyDays = 31,
} = {}) {
  const premium = new PremiumOpinetClient({ apiKey: premiumApiKey, masterUrl, priceUrl, keyParam, areaParam, fetchImpl });
  if (!generalApiKey.trim() || !premium.configured) {
    return { status: 'awaiting_credentials', count: 0, calls: 0, fetchedAt: null, applied: false };
  }

  const general = new OpinetClient({ apiKey: generalApiKey, fetchImpl, clock, detailLimit: 0 });
  const areas = validateAreaCodes(await general.request('areaCode.do', {}));
  const fetchedAt = new Date(clock()).toISOString();
  const byId = new Map();
  let rejected = 0;

  for (const area of areas) {
    const baseRows = await premium.request('master', area.code);
    for (const row of baseRows) {
      const station = normalizePremiumStation(row, { regionCode: area.code, fetchedAt });
      if (!station) { rejected += 1; continue; }
      const current = byId.get(station.id);
      byId.set(station.id, current ? { ...current, ...station, prices: current.prices } : station);
      for (const item of normalizePremiumPrices(row, { fetchedAt })) byId.get(station.id).prices[item.fuel] = item.value;
    }
    const priceRows = await premium.request('price', area.code);
    for (const row of priceRows) {
      const entries = normalizePremiumPrices(row, { fetchedAt });
      if (!entries.length) { rejected += 1; continue; }
      for (const item of entries) {
        const station = byId.get(item.id);
        if (!station) { rejected += 1; continue; }
        station.prices[item.fuel] = item.value;
      }
    }
  }

  const stations = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!stations.length) throw new Error('No nationwide station rows were normalized.');
  const coverage = {
    kind: 'nationwide', complete: rejected === 0,
    regionCount: areas.length,
    description: '오피넷 프리미엄 지역별 전체 기본정보와 판매가격을 일 단위로 수집한 전국 주유소 자료입니다.',
  };
  const envelope = {
    version: 1, status: rejected ? 'partial' : 'ready', provider: 'opinet-premium',
    dataGranularity: 'station', fetchedAt, source: OPINET_SOURCE, coverage,
    stations, warnings: rejected ? [{ code: 'NATIONWIDE_ROWS_OMITTED', message: '식별자·좌표·가격 형식을 확인할 수 없는 일부 전국 자료를 제외했습니다.' }] : [],
    cache: { hit: false, ageSeconds: 0, stale: false },
    lastAttempt: { at: fetchedAt, status: rejected ? 'partial' : 'ready', calls: premium.calls + 1 },
  };
  const master = {
    version: 1, status: envelope.status, provider: 'opinet-premium', fetchedAt, source: OPINET_SOURCE, coverage,
    stations: stations.map(({ prices, ...station }) => station), warnings: envelope.warnings,
  };
  const day = seoulDay(clock());
  const history = {
    version: 1, date: day, provider: 'opinet-premium', fetchedAt,
    stations: stations.map(station => ({ id: station.id, prices: station.prices })).filter(item => Object.keys(item.prices).length),
  };
  const manifest = {
    version: 1, status: envelope.status, provider: 'opinet-premium', fetchedAt,
    stationCount: stations.length, regionCount: areas.length, historyDate: day,
    latest: './latest.json', master: './master.json', history: `./history/${day}.json`,
  };

  await atomicWriteJson(resolve(outputDirectory, 'latest.json'), envelope);
  await atomicWriteJson(resolve(outputDirectory, 'master.json'), master);
  await atomicWriteJson(resolve(outputDirectory, 'manifest.json'), manifest);
  await atomicWriteJson(resolve(outputDirectory, 'history', `${day}.json`), history);
  await pruneHistory(resolve(outputDirectory, 'history'), historyDays);
  return { status: envelope.status, count: stations.length, calls: premium.calls + 1, fetchedAt, applied: true, regionCount: areas.length, rejected };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await collectNationwide();
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify(publicError(error)));
    process.exitCode = 1;
  }
}
