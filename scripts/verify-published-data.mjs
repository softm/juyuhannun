import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FUEL_TYPES,hasMapCoordinates,getFuelPrice,filterStations,summarizeVisiblePrices} from '../public/js/core.js';
import {mergeStationData} from '../public/js/data-loader.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const KOREA_BOUNDS={south:32,north:40,west:123,east:133};
const FUEL_CODES=new Set(FUEL_TYPES.map(f=>f.code));
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const isPresent=value=>value!==null&&value!==undefined;

// This gate uses the same merge, default filters, freshness and comparable
// minimum as the app. Old observations remain useful map records; they are
// never treated as current prices just to make a deployment pass.
export function validatePublishedData({nationwide=null,regional=null,now=Date.now()}={}){
 const errors=[],warnings=[];let errorCount=0;
 const error=(code,path,message)=>{errorCount++;if(errors.length<30)errors.push({code,path,message});};
 const checkPrice=(price,path)=>{
  if(!object(price)){error('INVALID_PRICE_RECORD',path,'유종 가격은 객체여야 합니다.');return;}
  if(price.price!==null&&!(typeof price.price==='number'&&Number.isFinite(price.price)&&price.price>0&&price.price<=100000))error('INVALID_PRICE_AMOUNT',`${path}.price`,'가격은 양수인 원/L 숫자 또는 미제공 null이어야 합니다.');
  if(isPresent(price.unit)&&price.unit!=='KRW/L')error('INVALID_PRICE_UNIT',`${path}.unit`,'개별 주유소 가격 단위는 KRW/L이어야 합니다.');
 };
 for(const [name,snapshot] of [['nationwide',nationwide],['regional',regional]]){
  if(!snapshot){warnings.push({code:'SOURCE_UNAVAILABLE',source:name,message:'이 자료원은 없으며 다른 자료원으로 표시 가능 여부를 확인합니다.'});continue;}
  if(!object(snapshot)||!Array.isArray(snapshot.stations)){error('INVALID_STATION_ENVELOPE',name,'주유소 자료에는 stations 배열이 있어야 합니다.');continue;}
  const ids=new Set();
  for(const [index,station] of snapshot.stations.entries()){
   const path=`${name}.stations[${index}]`;
   if(!object(station)){error('INVALID_STATION_RECORD',path,'주유소는 객체여야 합니다.');continue;}
   if(typeof station.id!=='string'||!station.id.trim())error('MISSING_STATION_ID',`${path}.id`,'공식 주유소 ID가 필요합니다.');
   else if(ids.has(station.id))error('DUPLICATE_STATION_ID',`${path}.id`,'같은 자료원에 중복된 주유소 ID가 있습니다.');
   else ids.add(station.id);
   if(typeof station.name!=='string'||!station.name.trim())error('MISSING_STATION_NAME',`${path}.name`,'주유소명이 필요합니다.');
   if(station.dataGranularity&&station.dataGranularity!=='station')error('INVALID_PRICE_GRANULARITY',path,'지역 평균을 개별 주유소 가격으로 사용할 수 없습니다.');
   if(isPresent(station.unit)&&station.unit!=='KRW/L')error('INVALID_PRICE_UNIT',`${path}.unit`,'개별 주유소 가격 단위는 KRW/L이어야 합니다.');
   if((isPresent(station.lat)||isPresent(station.lng))&&!hasMapCoordinates(station))error('INVALID_COORDINATES',path,'입력된 위경도는 유효한 한국 범위 좌표여야 합니다. 좌표가 없으면 둘 다 null로 보관합니다.');
   if(isPresent(station.prices)){
    if(!object(station.prices))error('INVALID_PRICES_OBJECT',`${path}.prices`,'prices는 유종 코드를 키로 하는 객체여야 합니다.');
    else for(const [fuel,price] of Object.entries(station.prices)){
     if(!FUEL_CODES.has(fuel))error('UNKNOWN_FUEL_CODE',`${path}.prices.${fuel}`,'지원하지 않는 유종 코드입니다.');
     checkPrice(price,`${path}.prices.${fuel}`);
    }
   }
   if(isPresent(station.fuel)&&isPresent(station.price)){
    if(!FUEL_CODES.has(station.fuel))error('UNKNOWN_FUEL_CODE',`${path}.fuel`,'지원하지 않는 유종 코드입니다.');
    checkPrice(station,path);
   }
  }
 }
 const safeSnapshot=value=>object(value)&&Array.isArray(value.stations)?value:null;
 const merged=mergeStationData(safeSnapshot(nationwide),safeSnapshot(regional),{now});
 const displayed=new Set(),comparable=new Set();
 const fuels=FUEL_TYPES.map(({code,name})=>{
  const rows=filterStations(merged.stations,{fuel:code,center:{lat:37.5,lng:127},bounds:KOREA_BOUNDS,now});
  for(const station of rows){displayed.add(station.id);if(station.confidence.eligible)comparable.add(station.id);}
  const summary=summarizeVisiblePrices(rows);
  return {code,name,displayableStationCount:summary.total,comparableStationCount:summary.comparable,historicalStationCount:summary.reference,lowestComparablePrice:summary.lowest};
 });
 const unmapped=merged.stations.filter(s=>!hasMapCoordinates(s)&&FUEL_TYPES.some(f=>getFuelPrice(s,f.code))).length;
 if(!displayed.size)error('NO_DISPLAYABLE_PRICES','map','가격과 지도 좌표를 함께 가진 주유소가 0곳입니다. 데이터가 없는 화면의 배포를 중단합니다.');
 else if(!comparable.size)warnings.push({code:'NO_COMPARABLE_PRICES',message:'표시 가능한 자료는 있지만 최신 비교 가능 가격은 0곳입니다. 마지막 확인 가격을 표시하는 복구 배포는 허용하며 재수집 상태를 확인해야 합니다.'});
 if(displayed.size>comparable.size)warnings.push({code:'HISTORICAL_PRICES_VISIBLE',count:displayed.size-comparable.size,message:'최신 비교가 불가능한 주유소도 위치와 마지막 확인 가격은 표시하며 최저가 계산에서 제외합니다.'});
 return {ok:errorCount===0,checkedAt:new Date(now).toISOString(),errorCount,errors,warnings,
  sourceCounts:{nationwide:Array.isArray(nationwide?.stations)?nationwide.stations.length:0,regional:Array.isArray(regional?.stations)?regional.stations.length:0},
  availability:{mergedStationCount:merged.stations.length,displayableStationCount:displayed.size,comparableStationCount:comparable.size,historicalOnlyStationCount:displayed.size-comparable.size,unmappedPricedStationCount:unmapped},fuels};
}

export async function verifyPublishedData({dataRoot=resolve(ROOT,'public/data'),now=Date.now()}={}){
 const read=async path=>{
  try{return {path,data:JSON.parse(await readFile(resolve(dataRoot,path),'utf8'))};}
  catch(error){return {path,data:null,error:error.code==='ENOENT'?null:{code:'INVALID_DATA_FILE',path,message:'배포할 JSON 파일을 읽거나 파싱할 수 없습니다.'}};}
 };
 const [search,latest,regional]=await Promise.all(['nationwide/search.json','nationwide/latest.json','stations.json'].map(read));
 const nationwide=Array.isArray(search.data?.stations)&&search.data.stations.length?search:latest.data?latest:search;
 const result=validatePublishedData({nationwide:nationwide.data,regional:regional.data,now});
 const fileErrors=[search,latest,regional].flatMap(file=>file.error?[file.error]:[]);
 result.errors.push(...fileErrors);result.errorCount+=fileErrors.length;result.ok=result.errorCount===0;
 result.files={nationwide:nationwide.data?nationwide.path:null,regional:regional.data?regional.path:null};
 return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args.length&&(args.length!==2||args[0]!=='--data-root'))throw new Error('사용법: node scripts/verify-published-data.mjs [--data-root 경로]');
  const result=await verifyPublishedData(args.length?{dataRoot:resolve(args[1])}:{});
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exitCode=1;
 }catch(error){console.error(JSON.stringify({ok:false,error:{code:'DATA_VALIDATION_FAILED',message:error.message}}));process.exitCode=1;}
}
