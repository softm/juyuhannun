import { ServiceError } from './errors.mjs';

export const DATA_GO_STATION_API='https://api.data.go.kr/openapi/tn_pubr_public_conm_api';
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
 const lat=num(row?.lat??row?.LAT),lng=num(row?.lot??row?.LOT??row?.lng);
 if(!(lat>=32&&lat<=40&&lng>=123&&lng<=133))return null;
 const name=text(row?.conmNm??row?.CONM_NM); if(!name)return null;
 return {name,lat,lng,roadAddress:text(row?.lctnRoadNm??row?.LCTN_ROAD_NM)||null,address:text(row?.lctnLotnoAddr??row?.LCTN_LOTNO_ADDR)||null,phone:text(row?.telno??row?.TELNO)||null,brandName:text(row?.tdmkSeNm??row?.TDMK_SE_NM)||null,dataDate:text(row?.dataCrtrYmd??row?.DATA_CRTR_YMD)||null};
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
