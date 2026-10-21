import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const count=v=>Array.isArray(v)?v.length:0;
const number=v=>Number.isInteger(v)&&v>=0?v:0;
const validCoordinates=s=>Number.isFinite(s?.lat)&&Number.isFinite(s?.lng)&&s.lat>=32&&s.lat<=40&&s.lng>=123&&s.lng<=133;
export function summarizeData({manifest={},nationwide={},searchable={},regional={},averages={},highway={},generatedAt=new Date().toISOString()}={}){
 const mapped=count(nationwide.stations),total=number(manifest.priceStationCount??nationwide.coverage?.totalPriceStations);
 const serviceReady=mapped>0&&['ready','partial'].includes(nationwide.status)&&nationwide.coverage?.serviceReady!==false;
 const summary=(id,name,data,rows,schedule)=>({id,name,status:data.status??'error',count:count(rows),fetchedAt:data.fetchedAt??null,lastAttempt:data.lastAttempt??null,retained:Boolean(data.cache?.stale||data.lastAttempt?.status==='error'),error:data.lastAttempt?.error??data.error??null,schedule});
 const collections=[
  summary('nationwide','전국 주유소 일괄가격',nationwide,nationwide.stations,'매일 20:37 · 한국시간'),
  summary('searchable','전국 목록 검색 · 좌표 미확보 포함',searchable,searchable.stations,'전국 일일가격 수집 시 갱신'),
  summary('regional','지역 API 보완',regional,regional.stations,'매일 01:17 · 02:17 · 09:17 · 12:17 · 16:17 · 19:17'),
  summary('averages','전국·시도 평균유가',averages,averages.benchmarks,'지역 API 수집 후 갱신'),
  summary('highway','고속도로 주유소',highway,highway.stations,'지역 API 수집 후 갱신'),
 ];
 return {version:1,generatedAt,activeMap:serviceReady?'nationwide':'regional',nationwide:{status:nationwide.status??'error',totalPriceStations:total,searchablePriceStations:count(searchable.stations),mappedPriceStations:mapped,unmappedPriceStations:Math.max(0,total-mapped),mappedRatio:total?Number((mapped/total).toFixed(4)):0,complete:nationwide.coverage?.complete===true,serviceReady,priceDate:manifest.priceDate??nationwide.coverage?.priceDate??null,fetchedAt:nationwide.fetchedAt??null,priceSource:manifest.priceSource??null,standardDataStatus:manifest.standardDataStatus??null},collections,quota:regional.quota??null,fuels:['B027','D047','B034','K015'].map(code=>({code,mappedStationCount:(nationwide.stations??[]).filter(s=>validCoordinates(s)&&Number.isFinite(s.prices?.[code]?.price)&&s.prices[code].price>0).length})),sources:[{name:'한국석유공사 오피넷 일일가격',url:'https://www.opinet.co.kr/user/opdown/opDownload.do'},{name:'전국주유소표준데이터 · 좌표',url:'https://www.data.go.kr/data/15129441/standard.do'},{name:'오피넷 Open API · 주변·평균',url:'https://www.opinet.co.kr/user/custapi/custApiInfo.do'},{name:'한국도로공사 · 고속도로 주유소',url:'https://data.ex.co.kr/openapi/basicinfo/openApiInfoM?apiId=0312'}]};
}

export async function writeDataStatus(dataRoot){
 const read=async name=>{try{return JSON.parse(await readFile(resolve(dataRoot,`${name}.json`),'utf8'));}catch{return{status:'error',error:{code:'DATA_FILE_UNAVAILABLE',message:'수집 결과 파일을 읽을 수 없습니다.'}};}};
 const [manifest,nationwide,searchable,regional,averages,highway]=await Promise.all(['nationwide/manifest','nationwide/latest','nationwide/search','stations','averages','highway'].map(read));
 const result=summarizeData({manifest,nationwide,searchable,regional,averages,highway});
 await mkdir(dataRoot,{recursive:true});await writeFile(resolve(dataRoot,'status.json'),JSON.stringify(result,null,2)+'\n');return result;
}
