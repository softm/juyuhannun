import {FUEL_TYPES,hasMapCoordinates,getFuelPrice,freshness} from './core.js';
const cache=new Map();
export async function loadStaticJSON(url,{signal,fetchImpl=fetch,now=Date.now(),cacheMs=60000}={}){
 const key=String(url),cached=cache.get(key);
 if(cached&&now-cached.at<cacheMs)return cached.data;
 const request=async path=>{
  const response=await fetchImpl(path,{signal,cache:'no-store',credentials:'omit'});
  if(!response.ok)throw new Error('가격 자료를 가져오지 못했습니다.');
  return response;
 };
 let data;
 if(typeof DecompressionStream==='function'&&/\.json(?=\?|$)/.test(key)){
  try{
   const response=await request(key.replace(/\.json(?=\?|$)/,'.json.gz'));
   // Fetch already decodes a Content-Encoding response; static .gz files
   // normally arrive as application/gzip and require explicit decompression.
   data=await (response.headers.get('content-encoding')?.includes('gzip')?response:new Response(response.body.pipeThrough(new DecompressionStream('gzip')))).json();
  }catch(error){if(signal?.aborted)throw error;}
 }
 if(!data)data=await (await request(key)).json();
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(cacheMs>0){if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,{at:now,data});}
 return data;
}
export function useNationwideData(data,fuel){
 return Boolean(data&&['ready','partial'].includes(data.status)&&Array.isArray(data.stations)&&data.stations.some(s=>hasMapCoordinates(s)&&getFuelPrice(s,fuel)));
}

const timestamp = value => {
 const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
 return Number.isFinite(parsed) ? parsed : -Infinity;
};
const present = value => value !== null && value !== undefined && value !== '';
const dailyStatus = value => ['daily_current_file','daily_price_file'].includes(value);

function observation(station, fuel, snapshot) {
 const effective = getFuelPrice(station, fuel);
 if (!effective) return null;
 const raw = station.prices?.[fuel] || station;
 // Materialize inherited observation fields before joining station metadata.
 // A new regional fetch must never re-date an older nationwide fuel price.
 return {
  ...raw,
  price: effective.price,
  unit: raw.unit || station.unit || 'KRW/L',
  priceUpdatedAt: effective.priceUpdatedAt,
  priceTimeStatus: effective.priceTimeStatus,
  sourceDate: effective.sourceDate,
  fetchedAt: effective.fetchedAt,
  source: raw.source ?? station.source ?? snapshot?.source ?? null,
  provider: raw.provider ?? station.provider ?? snapshot?.provider ?? null,
 };
}

function observationRank(price, now) {
 const confidence = freshness(price.priceUpdatedAt, price.fetchedAt, now, price.priceTimeStatus, price.sourceDate);
 const reported = timestamp(price.priceUpdatedAt);
 const dailyDate = /^\d{4}-\d{2}-\d{2}$/.test(String(price.sourceDate || '')) ? price.sourceDate : null;
 const basisDay = Number.isFinite(reported)
  ? new Date(reported + 9*60*60*1000).toISOString().slice(0,10)
  : dailyStatus(price.priceTimeStatus) ? dailyDate : null;
 // Prefer usable observations, then the latest price basis. On the same
 // calendar day a reported time is more precise than a daily file.
 return [confidence.eligible ? 2 : confidence.state === 'stale' ? 1 : 0,
  basisDay ? timestamp(`${basisDay}T00:00:00+09:00`) : -Infinity,
  Number.isFinite(reported) ? reported : -Infinity,
  timestamp(price.fetchedAt)];
}

function preferObservation(previous, incoming, now) {
 if (!previous) return incoming;
 if (!incoming) return previous;
 const before = observationRank(previous, now), after = observationRank(incoming, now);
 for (let i=0; i<before.length; i++) {
  if (before[i] !== after[i]) return after[i] > before[i] ? incoming : previous;
 }
 return previous;
}

function mergeStation(previous, incoming, snapshot, now) {
 const prices = {...previous?.prices};
 for (const {code} of FUEL_TYPES) {
  const price = observation(incoming, code, snapshot);
  if (price) prices[code] = preferObservation(prices[code], price, now);
 }
 if (!Object.keys(prices).length) return previous || null;
 const newer = !previous || timestamp(incoming.fetchedAt) >= timestamp(previous.fetchedAt);
 const primary = newer ? incoming : previous, secondary = newer ? previous : incoming;
 const merged = {...secondary};
 for (const [key,value] of Object.entries(primary || {})) if (present(value)) merged[key] = value;
 merged.facilities = {...secondary?.facilities};
 for (const [key,value] of Object.entries(primary?.facilities || {})) if (present(value)) merged.facilities[key] = value;
 const located = hasMapCoordinates(primary) ? primary : hasMapCoordinates(secondary) ? secondary : null;
 merged.lat = located?.lat ?? null;
 merged.lng = located?.lng ?? null;
 merged.prices = prices;
 const selected = prices[merged.fuel];
 merged.price = selected?.price ?? null;
 merged.priceUpdatedAt = selected?.priceUpdatedAt ?? null;
 merged.priceTimeStatus = selected?.priceTimeStatus ?? null;
 return merged;
}

export function mergeStationData(nationwide, regional, {now=Date.now()}={}) {
 const snapshots = [nationwide,regional].filter(value => value && Array.isArray(value.stations));
 const rows = new Map();
 for (const snapshot of snapshots) for (const station of snapshot.stations) {
  if (!station || typeof station.id !== 'string' || typeof station.name !== 'string') continue;
  const merged = mergeStation(rows.get(station.id), station, snapshot, now);
  if (merged) rows.set(station.id,merged);
 }
 const stations = [...rows.values()];
 const primary = nationwide?.stations?.length ? nationwide : regional || nationwide || {};
 const validSnapshots = snapshots.filter(s => ['ready','partial'].includes(s.status));
 const mapped = stations.filter(hasMapCoordinates).length;
 const fetchedAt = snapshots.map(s=>s.fetchedAt).filter(v=>Number.isFinite(timestamp(v))).sort((a,b)=>timestamp(b)-timestamp(a))[0] ?? null;
 const partial = snapshots.some(s=>s.status !== 'ready' || s.cache?.stale || s.downloadError) || snapshots.length < 2;
 return {
  ...primary,
  status: stations.length ? (partial ? 'partial' : 'ready') : snapshots.some(s=>s.status==='error') ? 'error' : primary.status || 'awaiting_credentials',
  fetchedAt,
  stations,
  coverage: {...primary.coverage,
   kind: nationwide?.stations?.length ? 'nationwide' : primary.coverage?.kind || 'sample_zones',
   totalPriceStations: Math.max(Number(nationwide?.coverage?.totalPriceStations) || 0,stations.length),
   mappedPriceStations: mapped,
   regionalStationCount: regional?.stations?.length || 0,
   complete: Boolean(primary.coverage?.complete),
  },
  cache: {...primary.cache,stale: !validSnapshots.some(s=>!s.cache?.stale)},
  sourceSnapshots: {nationwide:nationwide || null,regional:regional || null},
  warnings: snapshots.flatMap(s=>s.warnings || []),
 };
}

export function reselectStationPrices(stations, sourceSnapshots, {now=Date.now()}={}) {
 if (!sourceSnapshots) return stations;
 const sources = mergeStationData(sourceSnapshots.nationwide,sourceSnapshots.regional,{now});
 // A reported price can expire before another source's daily observation.
 // Keep live detail results alongside the original candidates when reselecting.
 return mergeStationData({status:'ready',stations},sources,{now}).stations;
}

export async function loadStationData({
 nationwideSearchUrl='./data/nationwide/search.json',
 nationwideUrl='./data/nationwide/latest.json',
 regionalUrl='./data/stations.json',
 signal,now=Date.now(),previous=null,read=loadStaticJSON,
}={}) {
 const stamp = Math.floor(now/60000);
 const readSnapshot = async url => {
  const data = await read(`${url}${url.includes('?')?'&':'?'}v=${stamp}`,{signal});
  if (!data || !Array.isArray(data.stations)) throw new Error('가격 자료의 형식을 확인할 수 없습니다.');
  return data;
 };
 const national = async () => {
  let search;
  try { search = await readSnapshot(nationwideSearchUrl); if (search.stations.length) return search; }
  catch (error) { if (signal?.aborted) throw error; }
  try { return await readSnapshot(nationwideUrl); }
  catch (error) { if (signal?.aborted || !search) throw error; return search; }
 };
 const results = await Promise.allSettled([national(),readSnapshot(regionalUrl)]);
 if (signal?.aborted) throw new DOMException('Aborted','AbortError');
 if (results.every(result=>result.status==='rejected')) throw results[0].reason;
 const sources = results.map((result,index) => {
  const key = index === 0 ? 'nationwide' : 'regional';
  const old = previous?.sourceSnapshots?.[key];
  const value = result.status === 'fulfilled' ? result.value : null;
  if (value?.stations?.length || value && !['error','awaiting_credentials'].includes(value.status)) return value;
  if (old?.stations?.length) return {...old,status:'partial',cache:{...old.cache,stale:true},downloadError:{at:new Date(now).toISOString(),message:value?.error?.message || result.reason?.message || '가격 자료 갱신 실패'}};
  return value;
 });
 const merged = mergeStationData(sources[0],sources[1],{now});
 merged.downloadErrors = results.flatMap((result,index)=>result.status==='rejected'?[{source:index===0?'nationwide':'regional',message:result.reason?.message || '가격 자료 연결 실패'}]:[]);
 return merged;
}

