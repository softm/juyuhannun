import { readFile, readdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpinetBrowserDownloadClient, kstDate, previousKstDate } from '../server/opinet-browser-download.mjs';
import { fetchStandardStations, fetchStandardStationsPublic } from '../server/data-go-stations.mjs';
import { atomicWriteJson, seoulDay } from '../server/quota.mjs';
import { publicError, ServiceError } from '../server/errors.mjs';
import { normalizePriceDate, planNationwideCollection, NATIONWIDE_RETRY_MS } from '../server/nationwide-policy.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SOURCE={name:'한국석유공사 오피넷 전국 개별 주유소 판매가격',url:'https://www.opinet.co.kr/user/opdown/opDownload.do',publicDataUrl:'https://www.data.go.kr/data/15044646/fileData.do'};
const text=v=>(typeof v==='string'||typeof v==='number')?String(v).trim().slice(0,500):'';
const key=v=>text(v).replace(/^\uFEFF/,'').replace(/[\s_\-()]/g,'').toLowerCase();
const value=(row,aliases)=>{const lookup=new Map(Object.entries(row??{}).map(([k,v])=>[key(k),v]));for(const a of aliases){const v=lookup.get(key(a));if(v!==undefined&&text(v)!=='')return text(v);}return '';};
const money=v=>{const n=Number(text(v).replaceAll(',',''));return Number.isFinite(n)&&n>0&&n<=100000?n:null;};
const self=v=>/^(y|예|셀프|1)$/i.test(text(v))?true:/^(n|아니오|일반|0)$/i.test(text(v))?false:null;
const brand=v=>{const s=text(v).toUpperCase();if(/SK가스/.test(s))return'SKG';if(/^E1|E1/.test(s))return'E1G';if(/SK/.test(s))return'SKE';if(/GS/.test(s))return'GSC';if(/현대|HD/.test(s))return'HDO';if(/S[- ]?OIL/.test(s))return'SOL';if(/EX/.test(s))return'RTX';if(/NH|농협/.test(s))return'NHO';if(/알뜰/.test(s))return'RTE';return s?'ETC':null;};
const normalizeRegionText=v=>{
 let s=text(v).toLocaleLowerCase('ko-KR');
 for(const [pattern,replacement] of [
  [/서울특별시|서울시|서울/g,'서울'],[/부산광역시|부산시|부산/g,'부산'],[/대구광역시|대구시|대구/g,'대구'],[/인천광역시|인천시|인천/g,'인천'],
  [/광주광역시|광주시|광주/g,'광주'],[/대전광역시|대전시|대전/g,'대전'],[/울산광역시|울산시|울산/g,'울산'],[/세종특별자치시|세종시|세종/g,'세종'],
  [/경기도|경기/g,'경기'],[/강원특별자치도|강원도|강원/g,'강원'],[/충청북도|충북/g,'충북'],[/충청남도|충남/g,'충남'],
  [/전북특별자치도|전라북도|전북/g,'전북'],[/전남광주통합특별시|전라남도|전남/g,'전남'],[/경상북도|경북/g,'경북'],[/경상남도|경남/g,'경남'],
  [/제주특별자치도|제주도|제주/g,'제주'],
 ])s=s.replace(pattern,replacement);
 return s;
};
const normalAddress=v=>normalizeRegionText(v).replace(/\([^)]*\)/g,'').replace(/번지|번|호/g,'').replace(/[\s,._\-·]/g,'');
const normalPhone=v=>text(v).replace(/\D/g,'');
const normalName=v=>text(v).toLocaleLowerCase('ko-KR').replace(/\(주\)|주식회사|㈜/g,'').replace(/\s/g,'').replace(/주유소|충전소/g,'');

function parseOpinetRow(row,{fetchedAt,kind,sourceDate=null}={}){
 const id=value(row,['고유번호','상호고유번호','주유소고유번호','충전소고유번호','uni_id','uniid']);
 const name=value(row,['상호','상호명','주유소명','충전소명']);
 if(!id||!name)return null;
 const prices={};
 for(const [fuel,aliases] of Object.entries({B034:['고급휘발유'],B027:['보통휘발유','휘발유'],D047:['자동차용경유','경유'],K015:['자동차부탄','LPG','엘피지']})){
  const p=money(value(row,aliases));if(p!==null){const rowDate=value(row,['기준일자','기준일','date'])||sourceDate;prices[fuel]={price:p,unit:'KRW/L',priceUpdatedAt:null,priceTimeStatus:'daily_price_file',sourceDate:/^\d{8}$/.test(rowDate)?`${rowDate.slice(0,4)}-${rowDate.slice(4,6)}-${rowDate.slice(6,8)}`:rowDate||null,fetchedAt};}
 }
 return {id,name,dataGranularity:'station',kind,brand:brand(value(row,['상표','상표명'])),brandName:value(row,['상표','상표명'])||null,address:value(row,['주소','소재지주소','소재지'])||null,roadAddress:value(row,['도로명주소'])||null,phone:value(row,['전화번호','전화'])||null,region:value(row,['지역','시도'])||null,facilities:{self:self(value(row,['셀프여부','셀프구분','셀프']))},prices,fetchedAt,source:SOURCE};
}

function mergeBasicAndPrice(basicRows,currentRows,{fetchedAt,kind,sourceDate=null}){
 const byId=new Map();
 for(const row of basicRows){const s=parseOpinetRow(row,{fetchedAt,kind,sourceDate});if(s)byId.set(s.id,s);}
 for(const row of currentRows){const s=parseOpinetRow(row,{fetchedAt,kind,sourceDate});if(!s)continue;const old=byId.get(s.id);byId.set(s.id,old?{...old,...s,address:s.address??old.address,roadAddress:s.roadAddress??old.roadAddress,phone:s.phone??old.phone,prices:{...old.prices,...s.prices},facilities:{...old.facilities,...s.facilities}}:s);}
 return byId;
}
export function coordinateIndex(rows){
 // The same public record occurs in the seed, previous snapshots and fresh data,
 // and both of its addresses can yield the same regional key. Those repetitions
 // are one candidate. Only genuinely different stations make a key ambiguous.
 const add=(map,k,v)=>{
  if(!k)return;
  if(!map.has(k)){map.set(k,v);return;}
  const old=map.get(k);
  if(!old||old.identity!==v.identity)map.set(k,null);
 };
 const byId=new Map(),phone=new Map(),address=new Map(),nameAddress=new Map(),nameRegion=new Map();
 const regionKey=v=>normalizeRegionText(v).replace(/[(),]/g,' ').trim().split(/\s+/).slice(0,2).join('');
 for(const r of rows){
  if(!Number.isFinite(r?.lat)||!Number.isFinite(r?.lng)||r.lat<32||r.lat>40||r.lng<123||r.lng>133)continue;
  const loc={lat:r.lat,lng:r.lng,roadAddress:r.roadAddress??null,address:r.address??null,phone:r.phone??null,coordinateSource:r.coordinateSource??'public-standard-match',coordinateVerifiedAt:r.coordinateVerifiedAt??r.verifiedAt??null,sourceCoordinates:r.sourceCoordinates??null,identity:`${normalName(r.name)}|${r.lat.toFixed(5)}|${r.lng.toFixed(5)}`};
  if(r.id){const old=byId.get(String(r.id));if(!old||r.coordinateSource==='opinet-detail-by-id'||old.coordinateSource!=='opinet-detail-by-id')byId.set(String(r.id),loc);}
  add(phone,normalPhone(r.phone),loc);
  for(const a of [r.roadAddress,r.address]){
   const ak=normalAddress(a);if(!ak)continue;add(address,ak,loc);add(nameAddress,`${normalName(r.name)}|${ak}`,loc);
   add(nameRegion,`${normalName(r.name)}|${regionKey(a)}`,loc);
  }
 }
 return {byId,phone,address,nameAddress,nameRegion,regionKey};
}
export function locateStation(s,index){
 const byId=s.id&&index.byId?.get(String(s.id));if(byId)return byId;
 const byPhone=index.phone.get(normalPhone(s.phone));if(byPhone)return byPhone;
 for(const a of [s.roadAddress,s.address]){
  const ak=normalAddress(a);if(!ak)continue;
  const named=index.nameAddress.get(`${normalName(s.name)}|${ak}`);if(named)return named;
  const exact=index.address.get(ak);if(exact)return exact;
  const regional=index.nameRegion.get(`${normalName(s.name)}|${index.regionKey(a)}`);if(regional)return regional;
 }
 if(s.region){const regional=index.nameRegion.get(`${normalName(s.name)}|${index.regionKey(s.region)}`);if(regional)return regional;}
 return null;
}
async function readStations(path){try{const d=JSON.parse(await readFile(path,'utf8'));return Array.isArray(d.stations)?d.stations:[];}catch{return[];}}
async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
async function readCachedPrices(outputDirectory,day,minRows){
 const [master,search,manifest]=await Promise.all(['master','search','manifest'].map(name=>readJson(resolve(outputDirectory,`${name}.json`))));
 let stations=search?.stations,fetchedAt=search?.fetchedAt;
 if(!Array.isArray(stations)||stations.length<minRows){
  const historyDay=normalizePriceDate(manifest?.historyDate)??day;
  const history=await readJson(resolve(outputDirectory,'history',`${historyDay}.json`));
  if(Array.isArray(master?.stations)&&Array.isArray(history?.stations)){
   const prices=new Map(history.stations.filter(row=>row?.id&&row.prices).map(row=>[row.id,row.prices]));
   stations=master.stations.filter(row=>prices.has(row.id)).map(row=>({...row,prices:prices.get(row.id),source:SOURCE}));
   fetchedAt=history.fetchedAt;
  }
 }
 if(!Array.isArray(stations)||stations.length<minRows)return {manifest,cache:null};
 const priceRecords=stations.flatMap(row=>Object.values(row.prices||{}));
 const dates=[...new Set(priceRecords.map(price=>normalizePriceDate(price.sourceDate)).filter(Boolean))];
 const sourceDate=dates.length===1?dates[0]:dates.length===0?normalizePriceDate(manifest?.priceDate):null;
 if(!sourceDate)return {manifest,cache:null};
 return {manifest,cache:{stations,sourceDate,fetchedAt:fetchedAt||priceRecords[0]?.fetchedAt||manifest?.fetchedAt||null,downloadBytes:manifest?.downloadBytes??0}};
}
async function prune(dir,keep){let names=[];try{names=(await readdir(dir)).filter(n=>/^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse();}catch{return;}await Promise.all(names.slice(keep).map(n=>unlink(resolve(dir,n)).catch(()=>{})));}

async function collectNationwideSnapshot({outputDirectory=resolve(ROOT,'public/data/nationwide'),nearbyPath=resolve(ROOT,'public/data/stations.json'),serviceKey=process.env.DATA_GO_KR_SERVICE_KEY||'',fetchImpl=fetch,clock=Date.now,historyDays=31,minRows=1000,forceRefresh=process.env.NATIONWIDE_FORCE_REFRESH==='1',downloadClient=new OpinetBrowserDownloadClient({clock})}={}){
 const started=clock(),attemptedAt=new Date(started).toISOString(),day=seoulDay(started);
 const {manifest:previousManifest,cache:reused}=await readCachedPrices(outputDirectory,day,minRows);
 const previousCollection=previousManifest?.collection??{};
 const previousAttemptAt=previousCollection.lastDownloadAttemptAt??(previousManifest?.lastAttempt?.status==='error'?previousManifest.lastAttempt.at:previousManifest?.fetchedAt)??null;
 const previousDownloadStatus=previousCollection.lastDownloadStatus??(previousManifest?.lastAttempt?.status==='error'?'error':reused?'ready':null);
 const plan=planNationwideCollection({now:started,hasPrices:Boolean(reused),sourceDate:reused?.sourceDate,fetchedAt:reused?.fetchedAt,lastDownloadAttemptAt:previousAttemptAt,lastDownloadStatus:previousDownloadStatus,forceRefresh});
 let fetchedAt=reused?.fetchedAt??null,targetDate=reused?.sourceDate?.replaceAll('-','')??kstDate(started),downloadBytes=reused?.downloadBytes??0,all=reused?.stations??null,priceSource='cache';
 let downloadCalls=0,downloadAttempts=[],downloadError=null,downloadFailure=null;
 let businessStations=[],businessStatus='unavailable',businessFetchedAt=null,businessBytes=0,businessError=null;
 let lastDownloadedAt=previousCollection.lastDownloadedAt??null,lastDownloadStatus=previousDownloadStatus,lastDownloadAttemptAt=previousAttemptAt;
 const previousBusiness=await readJson(resolve(outputDirectory,'business.json'));
 businessStations=Array.isArray(previousBusiness?.stations)?previousBusiness.stations:[];
 businessFetchedAt=previousBusiness?.fetchedAt??null;businessBytes=previousBusiness?.bytes??0;
 businessStatus=previousBusiness?.status??(businessStations.length?'ready':'unavailable');
 const businessAge=started-Date.parse(businessFetchedAt??'');
 const businessDue=forceRefresh||!businessStations.length||!Number.isFinite(businessAge)||businessAge>=6*60*60*1000;
 if(businessDue){
  try{
   const businessResult=await downloadClient.businessInfo({businessType:'station'});
   businessFetchedAt=new Date(clock()).toISOString();businessBytes=businessResult.bytes;
   businessStations=[...mergeBasicAndPrice(businessResult.rows,[],{fetchedAt:businessFetchedAt,kind:'station'}).values()];
   if(businessStations.length<minRows)throw new ServiceError('OPINET_BUSINESS_DOWNLOAD_EMPTY','사업자 기본정보에서 유효한 주유소를 충분히 받지 못했습니다.');
   businessStatus='ready';businessError=null;
   await atomicWriteJson(resolve(outputDirectory,'business.json'),{version:1,status:'ready',provider:'opinet-public-download',fetchedAt:businessFetchedAt,source:{...SOURCE,name:'한국석유공사 오피넷 사업자 기본정보(현재기준)'},count:businessStations.length,bytes:businessBytes,stations:businessStations.map(({prices,...s})=>s),lastAttempt:{at:attemptedAt,status:'ready'}});
  }catch(error){
   businessError=publicError(error);
   businessStatus=businessStations.length?'partial':'error';
   await atomicWriteJson(resolve(outputDirectory,'business.json'),{...(previousBusiness??{version:1,provider:'opinet-public-download',stations:[],count:0,bytes:0,fetchedAt:null}),status:businessStatus,lastAttempt:{at:attemptedAt,status:'error',error:businessError},cache:{...previousBusiness?.cache,stale:Boolean(businessStations.length)},error:businessError});
  }
 }
 if(plan.due){
  const dates=[kstDate(started),previousKstDate(started)];let gasPrice=null;
  lastDownloadAttemptAt=attemptedAt;
  for(const requestedDate of dates){
   downloadCalls++;
   const attempt={targetDate:normalizePriceDate(requestedDate),at:new Date(clock()).toISOString()};
   try{
    const result=await downloadClient.dailyPrices({businessType:'station',targetDate:requestedDate});
    const receivedDate=normalizePriceDate(result.sourceDate??requestedDate);
    const rowDates=new Set((result.rows??[]).map(row=>value(row,['기준일자','기준일','date'])).filter(Boolean).map(normalizePriceDate));
    if(receivedDate!==normalizePriceDate(requestedDate)||[...rowDates].some(date=>date!==receivedDate))throw new ServiceError('OPINET_DOWNLOAD_DATE_MISMATCH','전국 CSV 가격 기준일이 요청한 날짜와 다릅니다.');
    const rows=[...mergeBasicAndPrice([],result.rows,{fetchedAt:attemptedAt,kind:'station',sourceDate:requestedDate}).values()];
    if(rows.filter(s=>Object.keys(s.prices||{}).length).length<minRows)throw new ServiceError('OPINET_DOWNLOAD_EMPTY','전국 CSV에서 유효한 개별 가격을 충분히 받지 못했습니다.');
    gasPrice=result;
    if(businessStations.length){
     const merged=new Map(businessStations.map(s=>[s.id,{...s,prices:{...(s.prices||{})}}]));
     for(const s of rows){const old=merged.get(s.id);merged.set(s.id,old?{...old,...s,address:s.address||old.address,roadAddress:s.roadAddress||old.roadAddress,phone:s.phone||old.phone,brand:s.brand||old.brand,brandName:s.brandName||old.brandName,facilities:{...old.facilities,...s.facilities},prices:{...old.prices,...s.prices}}:s);}
     all=[...merged.values()];
    }else all=rows;
    targetDate=requestedDate;fetchedAt=attemptedAt;downloadBytes=result.bytes;priceSource='download';
    lastDownloadedAt=new Date(clock()).toISOString();lastDownloadStatus=downloadCalls>1?'fallback':'ready';
    downloadAttempts.push({...attempt,status:'ready',completedAt:lastDownloadedAt});
    break;
   }catch(error){
    downloadError=publicError(error);downloadAttempts.push({...attempt,status:'error',error:downloadError});
    if(requestedDate===dates.at(-1)){
     error.collectionAttempt={at:attemptedAt,expectedDate:plan.expectedDate,downloadCalls,downloadAttempts,decisionReason:plan.reason};
     if(reused){downloadFailure=error;lastDownloadStatus='error';break;}
     throw error;
    }
    console.info(JSON.stringify({event:'opinet_public_download_fallback',from:requestedDate,to:dates.at(-1),reason:error?.code||'download_failed'}));
   }
  }
  if(!gasPrice&&!downloadFailure)throw new ServiceError('OPINET_DOWNLOAD_EMPTY','전국 가격 파일을 받지 못했습니다.');
 }else {
  console.info(JSON.stringify({event:'opinet_daily_price_reuse',date:targetDate,rows:all?.length??0,reason:plan.reason,nextRetryAt:plan.nextRetryAt}));
 }
 const afterPlan=planNationwideCollection({now:clock(),hasPrices:Boolean(all?.length),sourceDate:targetDate,fetchedAt,lastDownloadAttemptAt,lastDownloadStatus});
 const collection={...previousCollection,checkedAt:attemptedAt,lastDownloadAttemptAt,lastDownloadedAt,lastDownloadStatus,lastDownloadError:plan.due?downloadError:(previousCollection.lastDownloadError??previousManifest?.lastAttempt?.error??null),lastDownloadCalls:plan.due?downloadCalls:previousCollection.lastDownloadCalls??0,downloadCalls,downloadAttempts:plan.due?downloadAttempts:previousCollection.downloadAttempts??[],sourceDate:normalizePriceDate(targetDate),expectedDate:afterPlan.expectedDate,usedPreviousDate:afterPlan.usedPreviousDate,eligible:afterPlan.eligible,expectedDateAvailable:afterPlan.expectedDateAvailable,nextRetryAt:afterPlan.nextRetryAt,decisionReason:plan.reason,pendingReason:afterPlan.pendingReason??null};
 if(!all){
  for(const name of ['latest','search','manifest']){const previous=await readJson(resolve(outputDirectory,`${name}.json`));if(previous)await atomicWriteJson(resolve(outputDirectory,`${name}.json`),{...previous,collection});}
  return {status:'error',count:0,total:0,priceSource,fetchedAt:null,collection};
 }
 const priced=all.filter(s=>Object.keys(s.prices||{}).length);
 const businessIds=new Set(businessStations.map(s=>s.id)),priceIds=new Set(priced.map(s=>s.id));
 const businessMatchedPrice=[...businessIds].filter(id=>priceIds.has(id)).length;
 const businessWithoutPrice=Math.max(0,businessIds.size-businessMatchedPrice);
 const priceWithoutBusiness=[...priceIds].filter(id=>!businessIds.has(id)).length;
 if(priced.length<minRows)throw new Error(`Nationwide price row count too small: ${priced.length}`);

 const prior=[
  ...(await readStations(resolve(outputDirectory,'coordinate-seed.json'))),
  ...(await readStations(resolve(outputDirectory,'master.json'))),
  ...(await readStations(resolve(outputDirectory,'latest.json'))),
  ...(await readStations(nearbyPath)),
  ...(await readStations(resolve(outputDirectory,'coordinate-enrichment.json')))
 ];
 let standard={status:previousManifest?.standardDataStatus??'error',stations:[],calls:0};
 let standardFetchedAt=previousManifest?.standardFetchedAt??null,standardLastAttemptAt=previousManifest?.standardLastAttemptAt??null;
 const standardAge=started-Date.parse(standardFetchedAt??''),standardAttemptAge=started-Date.parse(standardLastAttemptAt??'');
 const standardDue=(!Number.isFinite(standardAge)||standardAge>=24*60*60*1000)&&(!Number.isFinite(standardAttemptAge)||standardAttemptAge>=NATIONWIDE_RETRY_MS);
 if(standardDue){
  standardLastAttemptAt=attemptedAt;
  try{
   standard=await fetchStandardStationsPublic({fetchImpl});
  }catch(publicErrorValue){
   console.info(JSON.stringify({event:'data_go_public_grid_fallback',reason:publicErrorValue?.code||'public_grid_failed'}));
   if(String(serviceKey).trim()){
    try{standard=await fetchStandardStations({serviceKey,fetchImpl});}
    catch(apiError){standard={status:'error',stations:[],calls:0,error:publicError(apiError)};}
   }else standard={status:'error',stations:[],calls:0,error:publicError(publicErrorValue)};
  }
  if(standard.status==='ready')standardFetchedAt=new Date(clock()).toISOString();
 }
 const index=coordinateIndex([...prior,...standard.stations]);
 let located=0;
 for(const s of all){
  const loc=locateStation(s,index);
  if(loc){s.lat=loc.lat;s.lng=loc.lng;s.coordinateSource=loc.coordinateSource;s.coordinateVerifiedAt=loc.coordinateVerifiedAt;if(loc.sourceCoordinates)s.sourceCoordinates=loc.sourceCoordinates;s.roadAddress=s.roadAddress||loc.roadAddress;s.address=s.address||loc.address;s.phone=s.phone||loc.phone;located++;}
  else{s.lat=null;s.lng=null;}
 }
 const mappedPriced=priced.filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng));
 const ratio=priced.length?mappedPriced.length/priced.length:0;
 // The public standard master currently covers only part of Opinet's full nationwide price roster.
 // Prefer this nationwide partial map once it contains a broad, geographically distributed base;
 // coverage.complete remains false and the UI explicitly says it is not every station.
 const serviceReady=ratio>=0.4&&mappedPriced.length>=4000;
 const warnings=[];
 if(!serviceReady)warnings.push({code:'NATIONWIDE_COORDINATES_INCOMPLETE',message:'전국 가격의 지도 좌표가 아직 충분히 확보되지 않아 좌표가 확인된 주유소와 지역 API 자료를 함께 표시합니다.'});
 else if(ratio<0.98)warnings.push({code:'NATIONWIDE_COORDINATES_PARTIAL',message:'전국 일일 가격 중 좌표가 확인된 주유소를 우선 표시합니다. 전체 주유소가 모두 지도에 포함된 것은 아닙니다.'});
 if(standard.status!=='ready')warnings.push({code:'STANDARD_COORDINATES_USING_SEED',message:'공공데이터 최신 좌표 조회가 실패해 저장된 공개 표준 좌표 시드를 사용했습니다.'});
 if(collection.usedPreviousDate)warnings.push({code:'NATIONWIDE_PREVIOUS_DATE',message:'이전 기준일의 일일가격입니다. 개별 주유소의 현재 보고 시각을 뜻하지 않습니다.'});
 if(!collection.eligible)warnings.push({code:'NATIONWIDE_PRICE_REFRESH_PENDING',message:'가격 기준일 또는 수집 경과시간이 최신 비교 범위를 벗어나 마지막 확인 가격으로 보관하고 재수집을 기다립니다.'});
 if(collection.lastDownloadStatus==='error')warnings.push({code:'NATIONWIDE_DOWNLOAD_RETRY_PENDING',message:'전국 가격 다운로드가 실패해 기존 가격과 기준시각을 보존하고 다음 수집 때 재시도합니다.'});
 if(businessStatus!=='ready')warnings.push({code:'BUSINESS_INFO_DOWNLOAD_'+businessStatus.toUpperCase(),message:businessStations.length?'사업자 기본정보 새 다운로드가 실패해 이전 기본정보를 유지합니다.':'사업자 기본정보를 아직 확보하지 못했습니다.'});
 const coverage={kind:'nationwide',complete:ratio>=0.98,serviceReady,totalPriceStations:priced.length,mappedPriceStations:mappedPriced.length,mappedRatio:Number(ratio.toFixed(4)),priceDate:targetDate.slice(0,4)+'-'+targetDate.slice(4,6)+'-'+targetDate.slice(6,8),description:'오피넷 유가내려받기의 사업자별 일일 판매가격 CSV를 정기 수집하고 필요할 때 재시도하며 공공데이터와 공식 상세 API 좌표를 병합합니다.'};
 const status=serviceReady&&ratio>=0.98&&collection.eligible&&lastDownloadStatus!=='error'?'ready':'partial';
 const lastAttempt=plan.due?{at:attemptedAt,status:downloadCalls>1?'partial':status,calls:downloadCalls+standard.calls,downloadCalls}:previousManifest?.lastAttempt??{at:fetchedAt,status,calls:0};
 const latest={version:2,status,provider:'opinet-public-download',dataGranularity:'station',fetchedAt,source:SOURCE,coverage,stations:mappedPriced,cache:{hit:priceSource==='cache',ageSeconds:Number.isFinite(Date.parse(fetchedAt))?Math.max(0,Math.floor((clock()-Date.parse(fetchedAt))/1000)):null,stale:!collection.eligible||lastDownloadStatus==='error'},warnings,lastAttempt,collection};
 const master={version:2,status,provider:'opinet-public-download',fetchedAt,source:SOURCE,coverage,stations:all.map(({prices,...s})=>s),warnings};
 const history={version:2,date:coverage.priceDate,collectedOn:Number.isFinite(Date.parse(fetchedAt))?seoulDay(Date.parse(fetchedAt)):null,provider:'opinet-public-download',fetchedAt,stations:priced.map(s=>({id:s.id,prices:s.prices}))};
 const manifest={version:2,status,provider:'opinet-public-download',fetchedAt,lastAttempt:latest.lastAttempt,collection,stationCount:all.length,priceStationCount:priced.length,mappedPriceStationCount:mappedPriced.length,mappedRatio:coverage.mappedRatio,serviceReady,standardDataStatus:standard.status,standardCalls:standard.calls,standardFetchedAt,standardLastAttemptAt,priceDate:coverage.priceDate,downloadBytes,priceSource,businessInfo:{status:businessStatus,fetchedAt:businessFetchedAt,count:businessStations.length,bytes:businessBytes,matchedPriceCount:businessMatchedPrice,businessWithoutPriceCount:businessWithoutPrice,priceWithoutBusinessCount:priceWithoutBusiness,error:businessError},historyDate:coverage.priceDate,latest:'./latest.json',master:'./master.json',business:'./business.json',history:`./history/${coverage.priceDate}.json`,sources:[SOURCE,{name:'한국석유공사 오피넷 사업자 기본정보(현재기준)',url:'https://www.opinet.co.kr/user/opdown/opDownload.do'},{name:'전국주유소표준데이터',url:'https://www.data.go.kr/data/15129441/standard.do'}]};
 // List search retains every priced station; missing coordinates only exclude a map marker.
 const searchable={...latest,coverage:{...coverage,searchIncludesUnmapped:true},stations:priced};
 await atomicWriteJson(resolve(outputDirectory,'search.json'),searchable);
 await atomicWriteJson(resolve(outputDirectory,'latest.json'),latest);await atomicWriteJson(resolve(outputDirectory,'master.json'),master);await atomicWriteJson(resolve(outputDirectory,'manifest.json'),manifest);await atomicWriteJson(resolve(outputDirectory,'history',`${coverage.priceDate}.json`),history);await prune(resolve(outputDirectory,'history'),historyDays);
 // Coordinate enrichment is independent of price download availability. Publish
 // newly verified locations with the unchanged cached observations before
 // propagating the download failure and recording its retry state.
 if(downloadFailure)throw downloadFailure;
 return {status,count:mappedPriced.length,total:priced.length,mappedRatio:coverage.mappedRatio,serviceReady,priceDate:coverage.priceDate,downloadBytes,priceSource,businessInfo:manifest.businessInfo,standardStatus:standard.status,standardCalls:standard.calls,fetchedAt,collection};
}
export async function collectNationwide(options={}){
 try{return await collectNationwideSnapshot(options);}
 catch(error){
  const dir=options.outputDirectory??resolve(ROOT,'public/data/nationwide');
  const now=(options.clock??Date.now)(),at=error.collectionAttempt?.at??new Date(now).toISOString();
  const failure=publicError(error),lastAttempt={at,status:'error',error:failure,calls:error.collectionAttempt?.downloadCalls??0};
  const manifest=await readJson(resolve(dir,'manifest.json'));
  const sourceDate=manifest?.priceDate??null;
  const retryPlan=planNationwideCollection({now,hasPrices:Boolean(manifest?.priceStationCount),sourceDate,fetchedAt:manifest?.fetchedAt,lastDownloadAttemptAt:at,lastDownloadStatus:'error'});
  const collection={...manifest?.collection,checkedAt:new Date(now).toISOString(),lastDownloadAttemptAt:at,lastDownloadedAt:manifest?.collection?.lastDownloadedAt??null,lastDownloadStatus:'error',lastDownloadError:failure,downloadCalls:error.collectionAttempt?.downloadCalls??0,lastDownloadCalls:error.collectionAttempt?.downloadCalls??0,downloadAttempts:error.collectionAttempt?.downloadAttempts??[],sourceDate,expectedDate:retryPlan.expectedDate,usedPreviousDate:retryPlan.usedPreviousDate,eligible:retryPlan.eligible,expectedDateAvailable:retryPlan.expectedDateAvailable,nextRetryAt:retryPlan.nextRetryAt,decisionReason:error.collectionAttempt?.decisionReason??'collection_failed',pendingReason:retryPlan.pendingReason??null};
  // A failed download must be visible while retaining original observations.
  for(const name of ['latest','search','manifest']){
   const previous=await readJson(resolve(dir,`${name}.json`));
   const retained=name!=='manifest'?Boolean(previous?.stations?.length):Boolean(previous?.priceStationCount);
   await atomicWriteJson(resolve(dir,`${name}.json`),{...(previous??{version:2,provider:'opinet-public-download',fetchedAt:null,...(name!=='manifest'?{stations:[],coverage:{kind:'nationwide',complete:false,serviceReady:false}}:{stationCount:0,priceStationCount:0,mappedPriceStationCount:0,serviceReady:false})}),status:retained?'partial':'error',cache:{...previous?.cache,stale:true},lastAttempt,collection});
  }
  throw error;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const result=await collectNationwide();console.log(JSON.stringify(result));if(result.status==='error')process.exitCode=1;}catch(error){console.error(JSON.stringify(publicError(error)));process.exitCode=1;}}

