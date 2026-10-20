import { ServiceError } from './errors.mjs';
import { parseCsv } from './opinet-download.mjs';

export const DATA_GO_STATION_API='https://api.data.go.kr/openapi/tn_pubr_public_conm_api';
export const DATA_GO_PUBLIC_GRID_HEADER='https://www.data.go.kr/download/columList.json';
export const DATA_GO_PUBLIC_GRID_DATA='https://www.data.go.kr/download/standard.json';
export const DATA_GO_STATION_DATASET_ID='15129441';

const text=v=>(typeof v==='string'||typeof v==='number')?String(v).trim().slice(0,500):'';
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:NaN;};

function rawKey(key){const value=String(key??'').trim();return /%[0-9A-F]{2}/i.test(value)?value:encodeURIComponent(value);}
function items(payload){
 const body=payload?.response?.body??payload?.body??payload;
 const value=body?.items?.item??body?.items??payload?.items;
 if(Array.isArray(value))return value;
 if(value&&typeof value==='object')return [value];
 return [];
}
function total(payload){const body=payload?.response?.body??payload?.body??payload;const n=Number(body?.totalCount??payload?.totalCount);return Number.isFinite(n)&&n>=0?n:null;}

export function normalizeStandardStation(row){
 const lat=num(row?.lat??row?.LAT??row?.['위도']),lng=num(row?.lot??row?.LOT??row?.lng??row?.['경도']);
 if(!(lat>=32&&lat<=40&&lng>=123&&lng<=133))return null;
 const name=text(row?.conmNm??row?.CONM_NM??row?.['주유소명']); if(!name)return null;
 return {
  name,lat,lng,
  roadAddress:text(row?.lctnRoadNm??row?.LCTN_ROAD_NM??row?.['소재지도로명주소'])||null,
  address:text(row?.lctnLotnoAddr??row?.LCTN_LOTNO_ADDR??row?.['소재지지번주소'])||null,
  phone:text(row?.telno??row?.TELNO??row?.['전화번호'])||null,
  brandName:text(row?.tdmkSeNm??row?.TDMK_SE_NM??row?.['상표구분명'])||null,
  dataDate:text(row?.dataCrtrYmd??row?.DATA_CRTR_YMD??row?.['데이터기준일자'])||null,
 };
}

export async function fetchStandardStations({serviceKey='',fetchImpl=fetch,timeoutMs=20000,maxPages=30}={}){
 if(!String(serviceKey).trim())return {status:'awaiting_credentials',stations:[],calls:0};
 const stations=[];let calls=0,page=1,expected=null;
 while(page<=maxPages){
  const q=`pageNo=${page}&numOfRows=1000&type=json&serviceKey=${rawKey(serviceKey)}`;
  let response;
  try{response=await fetchImpl(`${DATA_GO_STATION_API}?${q}`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});}
  catch{throw new ServiceError('DATA_GO_NETWORK_ERROR','공공데이터 전국주유소표준 API에 연결하지 못했습니다.');}
  calls++;
  if(!response.ok)throw new ServiceError('DATA_GO_HTTP_ERROR','공공데이터 전국주유소표준 API 응답을 확인해 주세요.');
  let payload;try{payload=await response.json();}catch{throw new ServiceError('DATA_GO_SCHEMA_ERROR','공공데이터 전국주유소표준 응답이 JSON이 아닙니다.');}
  const rows=items(payload); if(expected===null)expected=total(payload);
  for(const row of rows){const normalized=normalizeStandardStation(row);if(normalized)stations.push(normalized);}
  if(rows.length<1000||(expected!==null&&page*1000>=expected))break;
  page++;
 }
 if(!stations.length)throw new ServiceError('DATA_GO_EMPTY','전국주유소표준 좌표 자료를 받지 못했습니다.');
 return {status:'ready',stations,calls,expected};
}


export async function fetchStandardStationsPublic({fetchImpl=fetch,timeoutMs=30000,perPage=10000,maxPages=10}={}){
 let headerResponse;
 const headerUrl=`${DATA_GO_PUBLIC_GRID_HEADER}?pk=${DATA_GO_STATION_DATASET_ID}&ext=CSV`;
 try{headerResponse=await fetchImpl(headerUrl,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});}
 catch{throw new ServiceError('DATA_GO_PUBLIC_NETWORK_ERROR','공공데이터 전국주유소표준 공개 메타데이터에 연결하지 못했습니다.');}
 if(!headerResponse.ok)throw new ServiceError('DATA_GO_PUBLIC_HTTP_ERROR','공공데이터 전국주유소표준 공개 메타데이터 응답을 확인해 주세요.');
 let header;try{header=await headerResponse.json();}catch{throw new ServiceError('DATA_GO_PUBLIC_SCHEMA_ERROR','공공데이터 전국주유소표준 공개 메타데이터가 JSON이 아닙니다.');}

 const totalCount=Number(header?.totalCount);
 const svcTableNm=text(header?.tableVO?.svcTableNm);
 const columns=(Array.isArray(header?.tableVO?.colNmList)?header.tableVO.colNmList:header?.columList?.map(item=>item?.columCode))
  ?.map(text).filter(v=>/^[A-Z0-9_]{1,60}$/.test(v))??[];
 if(!Number.isInteger(totalCount)||totalCount<1000||totalCount>50000||svcTableNm!=='tn_pubr_public_conm_svc'||!columns.includes('CONM_NM')||!columns.includes('LAT')||!columns.includes('LOT')){
  throw new ServiceError('DATA_GO_PUBLIC_SCHEMA_ERROR','공공데이터 전국주유소표준 공개 메타데이터 구조를 확인할 수 없습니다.');
 }

 const stations=[];let calls=1;
 const pages=Math.min(maxPages,Math.ceil(totalCount/perPage));
 for(let page=1;page<=pages;page++){
  const url=new URL(DATA_GO_PUBLIC_GRID_DATA);
  url.searchParams.set('publicDataPk',DATA_GO_STATION_DATASET_ID);
  url.searchParams.set('totalCount',String(totalCount));
  url.searchParams.set('svcTableNm',svcTableNm);
  url.searchParams.set('perPage',String(perPage));
  url.searchParams.set('page',String(page));
  for(const column of columns)url.searchParams.append('colNmList',column);
  let response;
  try{response=await fetchImpl(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});}
  catch{throw new ServiceError('DATA_GO_PUBLIC_NETWORK_ERROR','공공데이터 전국주유소표준 공개 자료에 연결하지 못했습니다.');}
  calls++;
  if(!response.ok)throw new ServiceError('DATA_GO_PUBLIC_HTTP_ERROR','공공데이터 전국주유소표준 공개 자료 응답을 확인해 주세요.');
  let rows;try{rows=await response.json();}catch{throw new ServiceError('DATA_GO_PUBLIC_SCHEMA_ERROR','공공데이터 전국주유소표준 공개 자료가 JSON이 아닙니다.');}
  if(!Array.isArray(rows))throw new ServiceError('DATA_GO_PUBLIC_SCHEMA_ERROR','공공데이터 전국주유소표준 공개 자료의 목록 구조를 확인할 수 없습니다.');
  for(const row of rows){const normalized=normalizeStandardStation(row);if(normalized)stations.push(normalized);}
  if(rows.length<perPage)break;
 }
 if(stations.length<1000)throw new ServiceError('DATA_GO_PUBLIC_EMPTY','전국주유소표준 공개 좌표 자료가 충분하지 않습니다.');
 return {status:'ready',stations,calls,expected:totalCount,source:'data-go-public-grid'};
}

export function parseStandardStationCsv(csvText){
 const rows=parseCsv(csvText);
 const headerIndex=rows.findIndex(row=>row.some(v=>String(v).trim()==='주유소명')&&row.some(v=>String(v).trim()==='위도')&&row.some(v=>String(v).trim()==='경도'));
 if(headerIndex<0)throw new ServiceError('DATA_GO_CSV_SCHEMA_ERROR','전국주유소표준 CSV의 주유소명·위도·경도 열을 찾지 못했습니다.');
 const headers=rows[headerIndex].map(v=>String(v??'').trim());
 const stations=[];
 for(const row of rows.slice(headerIndex+1)){
  const obj=Object.fromEntries(headers.map((h,i)=>[h,String(row[i]??'').trim()]));
  const station=normalizeStandardStation(obj);
  if(station)stations.push(station);
 }
 if(stations.length<1000)throw new ServiceError('DATA_GO_CSV_EMPTY','전국주유소표준 CSV의 좌표 행이 충분하지 않습니다.');
 return stations;
}
