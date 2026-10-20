import { readFile, readdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpinetBrowserDownloadClient, kstDate, previousKstDate } from '../server/opinet-browser-download.mjs';
import { fetchStandardStations, fetchStandardStationsPublic } from '../server/data-go-stations.mjs';
import { atomicWriteJson, seoulDay } from '../server/quota.mjs';
import { publicError } from '../server/errors.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SOURCE={name:'한국석유공사 오피넷 전국 개별 주유소 판매가격',url:'https://www.opinet.co.kr/user/opdown/opDownload.do',publicDataUrl:'https://www.data.go.kr/data/15044646/fileData.do'};
const text=v=>(typeof v==='string'||typeof v==='number')?String(v).trim().slice(0,500):'';
const key=v=>text(v).replace(/^\uFEFF/,'').replace(/[\s_\-()]/g,'').toLowerCase();
const value=(row,aliases)=>{const lookup=new Map(Object.entries(row??{}).map(([k,v])=>[key(k),v]));for(const a of aliases){const v=lookup.get(key(a));if(v!==undefined&&text(v)!=='')return text(v);}return '';};
const money=v=>{const n=Number(text(v).replaceAll(',',''));return Number.isFinite(n)&&n>0&&n<=100000?n:null;};
const self=v=>/^(y|예|셀프|1)$/i.test(text(v))?true:/^(n|아니오|일반|0)$/i.test(text(v))?false:null;
const brand=v=>{const s=text(v).toUpperCase();if(/SK가스/.test(s))return'SKG';if(/^E1|E1/.test(s))return'E1G';if(/SK/.test(s))return'SKE';if(/GS/.test(s))return'GSC';if(/현대|HD/.test(s))return'HDO';if(/S[- ]?OIL/.test(s))return'SOL';if(/EX/.test(s))return'RTX';if(/NH|농협/.test(s))return'NHO';if(/알뜰/.test(s))return'RTE';return s?'ETC':null;};
const normalAddress=v=>text(v).toLocaleLowerCase('ko-KR').replace(/\([^)]*\)/g,'').replace(/[\s,._-]/g,'').replace(/번지/g,'').replace(/호/g,'');
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
function coordinateIndex(rows){
 const add=(map,k,v)=>{if(!k)return;if(map.has(k))map.set(k,null);else map.set(k,v);};
 const phone=new Map(),address=new Map(),nameAddress=new Map(),nameRegion=new Map();
 const regionKey=v=>text(v).toLocaleLowerCase('ko-KR').replace(/[(),]/g,' ').trim().split(/\s+/).slice(0,2).join('');
 for(const r of rows){
  if(!Number.isFinite(r?.lat)||!Number.isFinite(r?.lng))continue;
  const loc={lat:r.lat,lng:r.lng,roadAddress:r.roadAddress??null,address:r.address??null,phone:r.phone??null};
  add(phone,normalPhone(r.phone),loc);
  for(const a of [r.roadAddress,r.address]){
   const ak=normalAddress(a);add(address,ak,loc);add(nameAddress,`${normalName(r.name)}|${ak}`,loc);
   add(nameRegion,`${normalName(r.name)}|${regionKey(a)}`,loc);
  }
 }
 return {phone,address,nameAddress,nameRegion,regionKey};
}
function locateStation(s,index){
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
async function prune(dir,keep){let names=[];try{names=(await readdir(dir)).filter(n=>/^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse();}catch{return;}await Promise.all(names.slice(keep).map(n=>unlink(resolve(dir,n)).catch(()=>{})));}

export async function collectNationwide({outputDirectory=resolve(ROOT,'public/data/nationwide'),serviceKey=process.env.DATA_GO_KR_SERVICE_KEY||'',fetchImpl=fetch,clock=Date.now,historyDays=31,minRows=1000}={}){
 const fetchedAt=new Date(clock()).toISOString();const client=new OpinetBrowserDownloadClient({clock});
 let targetDate=kstDate(clock()),gasPrice;
 try{gasPrice=await client.dailyPrices({businessType:'station',targetDate});}
 catch(firstError){
  const fallbackDate=previousKstDate(clock());
  if(fallbackDate===targetDate)throw firstError;
  console.info(JSON.stringify({event:'opinet_public_download_fallback',from:targetDate,to:fallbackDate,reason:firstError?.code||'download_failed'}));
  targetDate=fallbackDate;
  gasPrice=await client.dailyPrices({businessType:'station',targetDate});
 }
 const byId=mergeBasicAndPrice([],gasPrice.rows,{fetchedAt,kind:'station',sourceDate:gasPrice.sourceDate||targetDate});
 const all=[...byId.values()],priced=all.filter(s=>Object.keys(s.prices).length);
 if(priced.length<minRows)throw new Error(`Nationwide price row count too small: ${priced.length}`);

 const prior=[...(await readStations(resolve(outputDirectory,'master.json'))),...(await readStations(resolve(outputDirectory,'latest.json'))),...(await readStations(resolve(ROOT,'public/data/stations.json')))];
 let standard={status:'error',stations:[],calls:0};
 try{
  standard=await fetchStandardStationsPublic({fetchImpl});
 }catch(publicErrorValue){
  console.info(JSON.stringify({event:'data_go_public_grid_fallback',reason:publicErrorValue?.code||'public_grid_failed'}));
  if(String(serviceKey).trim()){
   try{standard=await fetchStandardStations({serviceKey,fetchImpl});}
   catch(apiError){standard={status:'error',stations:[],calls:0,error:publicError(apiError)};}
  }else standard={status:'error',stations:[],calls:0,error:publicError(publicErrorValue)};
 }
 const index=coordinateIndex([...prior,...standard.stations]);
 let located=0;
 for(const s of all){
  const loc=locateStation(s,index);
  if(loc){s.lat=loc.lat;s.lng=loc.lng;s.roadAddress=s.roadAddress||loc.roadAddress;s.address=s.address||loc.address;s.phone=s.phone||loc.phone;located++;}
  else{s.lat=null;s.lng=null;}
 }
 const mappedPriced=priced.filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng));
 const ratio=priced.length?mappedPriced.length/priced.length:0,serviceReady=ratio>=0.8&&mappedPriced.length>=1000;
 const warnings=[];
 if(!serviceReady)warnings.push({code:'NATIONWIDE_COORDINATES_INCOMPLETE',message:'전국 가격은 수집했지만 지도 좌표 매칭이 충분하지 않아 기존 지역 API 자료를 계속 표시합니다.'});
 if(standard.status!=='ready')warnings.push({code:'STANDARD_COORDINATES_UNAVAILABLE',message:'공공데이터 전국주유소표준 좌표 보강이 연결되지 않았거나 실패했습니다.'});
 const coverage={kind:'nationwide',complete:ratio>=0.98,serviceReady,totalPriceStations:priced.length,mappedPriceStations:mappedPriced.length,mappedRatio:Number(ratio.toFixed(4)),priceDate:targetDate.slice(0,4)+'-'+targetDate.slice(4,6)+'-'+targetDate.slice(6,8),description:'오피넷 유가내려받기의 사업자별 일일 판매가격 CSV를 공개 다운로드 화면에서 일 1회 수집하고 공공데이터 전국주유소표준 좌표를 병합합니다.'};
 const status=serviceReady&&ratio>=0.98?'ready':'partial';
 const latest={version:2,status,provider:'opinet-public-download',dataGranularity:'station',fetchedAt,source:SOURCE,coverage,stations:mappedPriced,cache:{hit:false,ageSeconds:0,stale:false},warnings,lastAttempt:{at:fetchedAt,status,calls:1+standard.calls}};
 const master={version:2,status,provider:'opinet-public-download',fetchedAt,source:SOURCE,coverage,stations:all.map(({prices,...s})=>s),warnings};
 const day=seoulDay(clock());
 const history={version:2,date:day,provider:'opinet-public-download',fetchedAt,stations:priced.map(s=>({id:s.id,prices:s.prices}))};
 const manifest={version:2,status,provider:'opinet-public-download',fetchedAt,stationCount:all.length,priceStationCount:priced.length,mappedPriceStationCount:mappedPriced.length,mappedRatio:coverage.mappedRatio,serviceReady,standardDataStatus:standard.status,standardCalls:standard.calls,priceDate:coverage.priceDate,downloadBytes:gasPrice.bytes,historyDate:day,latest:'./latest.json',master:'./master.json',history:`./history/${day}.json`,sources:[SOURCE,{name:'전국주유소표준데이터',url:'https://www.data.go.kr/data/15129441/standard.do'}]};
 await atomicWriteJson(resolve(outputDirectory,'latest.json'),latest);await atomicWriteJson(resolve(outputDirectory,'master.json'),master);await atomicWriteJson(resolve(outputDirectory,'manifest.json'),manifest);await atomicWriteJson(resolve(outputDirectory,'history',`${day}.json`),history);await prune(resolve(outputDirectory,'history'),historyDays);
 return {status,count:mappedPriced.length,total:priced.length,mappedRatio:coverage.mappedRatio,serviceReady,priceDate:coverage.priceDate,downloadBytes:gasPrice.bytes,standardStatus:standard.status,standardCalls:standard.calls,fetchedAt};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await collectNationwide()));}catch(error){console.error(JSON.stringify(publicError(error)));process.exitCode=1;}}
