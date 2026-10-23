import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FUEL_TYPES,hasMapCoordinates,getFuelPrice,freshness} from '../public/js/core.js';
import {mergeStationData} from '../public/js/data-loader.js';
import {DailyQuota} from '../server/quota.mjs';

const count=v=>Array.isArray(v)?v.length:0;
const number=v=>Number.isInteger(v)&&v>=0?v:0;
export function summarizeData({manifest={},nationwide={},searchable={},regional={},averages={},highway={},comparisons={},coordinates={},quota=null,generatedAt=new Date().toISOString()}={}){
 const now=Date.parse(generatedAt),mapped=count(nationwide.stations),total=number(manifest.priceStationCount??nationwide.coverage?.totalPriceStations);
 const serviceReady=mapped>0&&['ready','partial'].includes(nationwide.status)&&nationwide.coverage?.serviceReady!==false;
 const nationalSource=count(searchable.stations)?searchable:nationwide;
 const merged=mergeStationData(nationalSource,regional,{now});
 const mapStations=merged.stations.filter(s=>hasMapCoordinates(s)&&FUEL_TYPES.some(f=>getFuelPrice(s,f.code)));
 const candidates=new Map();
 for(const snapshot of [nationalSource,regional])for(const s of snapshot.stations||[]){
  if(typeof s?.id!=='string'||typeof s?.name!=='string')continue;
  if(!candidates.has(s.id))candidates.set(s.id,[]);candidates.get(s.id).push(s);
 }
 const cohorts=new Map();
 const fuels=FUEL_TYPES.map(({code})=>{
  let mappedStationCount=0,comparableStationCount=0;
  for(const s of mapStations){
   const p=getFuelPrice(s,code);if(!p)continue;mappedStationCount++;
   const confidence=freshness(p.priceUpdatedAt,p.fetchedAt,now,p.priceTimeStatus,p.sourceDate);
   if(confidence.eligible)comparableStationCount++;
   // Keep the alternative source too: when a reported price expires, a still
   // eligible daily observation may become the selected price without a build.
   const observations=(candidates.get(s.id)||[]).map(row=>getFuelPrice(row,code)).filter(Boolean).map(({priceUpdatedAt,fetchedAt,priceTimeStatus,sourceDate})=>({priceUpdatedAt,fetchedAt,priceTimeStatus,sourceDate}));
   const key=JSON.stringify([code,observations]);
   const cohort=cohorts.get(key)||{code,observations,count:0};
   cohort.count++;cohorts.set(key,cohort);
  }
  return {code,mappedStationCount,comparableStationCount,historicalStationCount:mappedStationCount-comparableStationCount};
 });
 const summary=(id,name,data,rows,schedule)=>({id,name,status:data.status??'error',count:count(rows),fetchedAt:data.fetchedAt??null,lastAttempt:data.lastAttempt??null,retained:Boolean(data.cache?.stale||data.lastAttempt?.status==='error'),reused:Boolean(data.cache?.hit),error:data.lastAttempt?.error??data.error??null,schedule});
 const comparisonRows=Array.isArray(comparisons.comparisons)?comparisons.comparisons:[];
 const nationalById=new Map((nationalSource.stations||[]).map(row=>[row.id,row]));
 let comparisonMatched=0,comparisonSame=0,comparisonDifferent=0,comparisonMissing=0,comparisonMaxAbsDiff=0,comparisonAbsDiffTotal=0;
 for(const row of comparisonRows){
  const station=nationalById.get(row.stationId);
  const observed=station?getFuelPrice(station,row.fuel):null;
  if(!observed||!Number.isFinite(Number(observed.price))){comparisonMissing++;continue;}
  comparisonMatched++;
  const diff=Number(row.price)-Number(observed.price),abs=Math.abs(diff);
  comparisonAbsDiffTotal+=abs;comparisonMaxAbsDiff=Math.max(comparisonMaxAbsDiff,abs);
  if(diff===0)comparisonSame++;else comparisonDifferent++;
 }
 const comparisonAudit={
  status:comparisons.status??'error',checkedAt:comparisons.fetchedAt??comparisons.lastAttempt?.at??null,total:comparisonRows.length,matched:comparisonMatched,
  same:comparisonSame,different:comparisonDifferent,missing:comparisonMissing,maxAbsDiff:comparisonMatched?comparisonMaxAbsDiff:null,
  averageAbsDiff:comparisonMatched?Number((comparisonAbsDiffTotal/comparisonMatched).toFixed(1)):null,
 };
 const collection=manifest.collection??nationwide.collection??null;
 const collections=[
  summary('nationwide','전국 주유소 일일가격',nationwide,nationwide.stations,'매일 08:17 · 14:17 · 20:17 · 한국시간'),
  summary('searchable','전국 가격 원본 · 좌표 미확보 포함',searchable,searchable.stations,'전국 수집 결과 보관 · 지도에는 좌표 확보 자료 표시'),
  summary('regional','지역 API 보완',regional,regional.stations,'매일 08:17 · 14:17 · 20:17'),
  summary('averages','전국·시도 평균유가',averages,averages.benchmarks,'매일 08:17 · 14:17 · 20:17'),
  summary('comparisons','전국 최저가 Top20 비교',comparisons,comparisons.comparisons,'유종별 Top20 · 매일 08:17 · 14:17 · 20:17'),
  summary('highway','고속도로 주유소',highway,highway.stations,'매일 08:17 · 14:17 · 20:17'),
 ];
 return {
  version:1,generatedAt,activeMap:serviceReady?'nationwide':'regional',mapStrategy:'merged',
  nationwide:{status:nationwide.status??'error',totalPriceStations:total,searchablePriceStations:count(searchable.stations),mappedPriceStations:mapped,unmappedPriceStations:Math.max(0,total-mapped),mappedRatio:total?Number((mapped/total).toFixed(4)):0,complete:nationwide.coverage?.complete===true,serviceReady,priceDate:manifest.priceDate??nationwide.coverage?.priceDate??null,fetchedAt:nationwide.fetchedAt??null,priceSource:manifest.priceSource??null,businessInfo:manifest.businessInfo??null,standardDataStatus:manifest.standardDataStatus??null,collection},
  availability:{checkedAt:generatedAt,displayableStationCount:mapStations.length,defaultIncludesHistorical:true,priceCohorts:[...cohorts.values()]},
  coordinates:{status:coordinates.status??'awaiting_data',queue:coordinates.queue??null,lastAttempt:coordinates.lastAttempt??null,lastSuccessAt:coordinates.lastSuccessAt??null,dayBudget:coordinates.dayBudget??null,budget:coordinates.budget??null,error:coordinates.error??null},comparisonAudit,collections,quota:quota??coordinates.quota??regional.quota??null,fuels,
  sources:[{name:'한국석유공사 오피넷 일일가격',url:'https://www.opinet.co.kr/user/opdown/opDownload.do'},{name:'전국주유소표준데이터 · 좌표',url:'https://www.data.go.kr/data/15129441/standard.do'},{name:'오피넷 Open API · 주변·상세·평균',url:'https://www.opinet.co.kr/user/custapi/custApiInfo.do'},{name:'한국도로공사 · 고속도로 주유소',url:'https://data.ex.co.kr/openapi/basicinfo/openApiInfoM?apiId=0312'}]
 };
}

export async function writeDataStatus(dataRoot){
 const read=async name=>{try{return JSON.parse(await readFile(resolve(dataRoot,`${name}.json`),'utf8'));}catch{return{status:'error',error:{code:'DATA_FILE_UNAVAILABLE',message:'수집 결과 파일을 읽을 수 없습니다.'}};}};
 const [manifest,nationwide,searchable,regional,averages,highway,comparisons,coordinates]=await Promise.all(['nationwide/manifest','nationwide/latest','nationwide/search','stations','averages','highway','comparisons','nationwide/coordinate-enrichment'].map(read));
 // Use the final shared ledger after regional, energy and coordinate requests.
 let quota=null;
 const ledgerPath=resolve(dirname(fileURLToPath(import.meta.url)),'../.cache/opinet-quota.json');
 try{await readFile(ledgerPath);quota=await new DailyQuota({ledgerPath}).snapshot();}catch{}
 const result=summarizeData({manifest,nationwide,searchable,regional,averages,highway,comparisons,coordinates,quota});
 await mkdir(dataRoot,{recursive:true});await writeFile(resolve(dataRoot,'status.json'),JSON.stringify(result,null,2)+'\n');return result;
}
