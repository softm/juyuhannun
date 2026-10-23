import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson } from '../server/quota.mjs';
import { ServiceError, publicError } from '../server/errors.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const valid=(row)=>Number.isFinite(row?.lat)&&Number.isFinite(row?.lng)&&row.lat>=32&&row.lat<=40&&row.lng>=123&&row.lng<=133;
const text=v=>(typeof v==='string'||typeof v==='number')?String(v).trim().slice(0,500):'';
const normalizeAddress=v=>text(v).replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();

async function readJson(path,fallback={}){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}

async function geocode(query,{apiKeyId,apiKey,fetchImpl=fetch}){
  const url=new URL('https://maps.apigw.ntruss.com/map-geocode/v2/geocode');
  url.searchParams.set('query',query);url.searchParams.set('count','3');
  const response=await fetchImpl(url,{headers:{Accept:'application/json','x-ncp-apigw-api-key-id':apiKeyId,'x-ncp-apigw-api-key':apiKey},signal:AbortSignal.timeout(12000)});
  let body;try{body=await response.json();}catch{body=null;}
  if(!response.ok)throw new ServiceError('NAVER_GEOCODE_HTTP_ERROR',`네이버 주소 좌표 변환에 실패했습니다. HTTP ${response.status}`);
  const rows=Array.isArray(body?.addresses)?body.addresses:[];
  const first=rows.map(row=>({roadAddress:text(row.roadAddress)||null,jibunAddress:text(row.jibunAddress)||null,lat:Number(row.y),lng:Number(row.x)})).find(valid);
  return first??null;
}

export async function geocodeBusinessAddresses({
  dataDirectory=resolve(ROOT,'public/data/nationwide'),
  apiKeyId=process.env.NAVER_MAPS_API_KEY_ID||process.env.NAVER_CLIENT_ID||'',
  apiKey=process.env.NAVER_MAPS_API_KEY||process.env.NAVER_CLIENT_SECRET||'',
  maxCalls=Number(process.env.NAVER_GEOCODE_MAX_PER_RUN||1000),
  fetchImpl=fetch,
  clock=Date.now,
}={}){
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>3000)throw new ServiceError('NAVER_GEOCODE_BUDGET_INVALID','주소 좌표 변환 실행당 한도는 1~3000회여야 합니다.');
  const outputPath=resolve(dataDirectory,'address-geocoding.json');
  const [business,master,latest,seed,enriched,previous]=await Promise.all([
    readJson(resolve(dataDirectory,'business.json'),{stations:[]}),
    readJson(resolve(dataDirectory,'master.json'),{stations:[]}),
    readJson(resolve(dataDirectory,'latest.json'),{stations:[]}),
    readJson(resolve(dataDirectory,'coordinate-seed.json'),{stations:[]}),
    readJson(resolve(dataDirectory,'coordinate-enrichment.json'),{stations:[]}),
    readJson(outputPath,{version:1,stations:[],failures:[]}),
  ]);
  const existing=new Map();
  for(const row of [...(master.stations||[]),...(latest.stations||[]),...(seed.stations||[]),...(enriched.stations||[]),...(previous.stations||[])])if(row?.id&&valid(row))existing.set(String(row.id),row);
  const cachedByAddress=new Map((previous.stations||[]).filter(valid).flatMap(row=>[row.roadAddress,row.address,row.queryAddress].filter(Boolean).map(a=>[normalizeAddress(a),row])));
  const stations=new Map((previous.stations||[]).filter(row=>row?.id&&valid(row)).map(row=>[String(row.id),row]));
  const failures=new Map((previous.failures||[]).filter(row=>row?.id).map(row=>[String(row.id),row]));
  const rows=(business.stations||[]).filter(row=>row?.id&&!existing.has(String(row.id))&&(row.roadAddress||row.address));
  const startedAt=new Date(clock()).toISOString();
  let calls=0,added=0,reused=0,failed=0,stopReason=null;
  if(!String(apiKeyId).trim()||!String(apiKey).trim()){
    stopReason='awaiting_credentials';
  } else {
    for(const row of rows){
      if(calls>=maxCalls){stopReason='run_budget';break;}
      const id=String(row.id),queryAddress=normalizeAddress(row.roadAddress||row.address);
      if(!queryAddress)continue;
      const cached=cachedByAddress.get(queryAddress);
      if(cached&&valid(cached)){
        stations.set(id,{id,name:row.name,lat:cached.lat,lng:cached.lng,address:row.address??cached.address??null,roadAddress:row.roadAddress??cached.roadAddress??null,queryAddress,coordinateSource:'naver-geocode-address-cache',coordinateVerifiedAt:cached.coordinateVerifiedAt??cached.verifiedAt??null,verifiedAt:cached.verifiedAt??cached.coordinateVerifiedAt??null});
        failures.delete(id);reused++;continue;
      }
      const priorFailure=failures.get(id);
      if(priorFailure?.nextRetryAt&&Date.parse(priorFailure.nextRetryAt)>clock())continue;
      calls++;
      try{
        const result=await geocode(queryAddress,{apiKeyId,apiKey,fetchImpl});
        if(!result)throw new ServiceError('NAVER_GEOCODE_NOT_FOUND','주소로 좌표를 찾지 못했습니다.');
        const verifiedAt=new Date(clock()).toISOString();
        const saved={id,name:row.name,lat:result.lat,lng:result.lng,address:row.address??result.jibunAddress??null,roadAddress:row.roadAddress??result.roadAddress??null,queryAddress,coordinateSource:'naver-geocode-address',coordinateVerifiedAt:verifiedAt,verifiedAt};
        stations.set(id,saved);cachedByAddress.set(queryAddress,saved);failures.delete(id);added++;
      }catch(error){
        failed++;
        const attempts=(priorFailure?.attempts??0)+1,at=new Date(clock()).toISOString();
        const retryMs=error?.code==='NAVER_GEOCODE_NOT_FOUND'?7*24*3600000:Math.min(24*3600000,3600000*2**Math.min(attempts-1,5));
        failures.set(id,{id,address:queryAddress,attempts,lastAttemptAt:at,nextRetryAt:new Date(clock()+retryMs).toISOString(),error:publicError(error)});
        if(error?.code==='NAVER_GEOCODE_HTTP_ERROR'&&/429|401|403/.test(error.message||'')){stopReason='provider_limit_or_auth';break;}
      }
    }
  }
  stopReason??=(rows.length===0?'complete':calls>=maxCalls?'run_budget':'complete');
  const pending=rows.filter(row=>!stations.has(String(row.id))).length;
  const result={version:1,status:stopReason==='complete'?'ready':stopReason==='awaiting_credentials'?'awaiting_credentials':stopReason==='provider_limit_or_auth'?'error':'partial',provider:'naver-geocoding',fetchedAt:stations.size?new Date(clock()).toISOString():previous.fetchedAt??null,stations:[...stations.values()].sort((a,b)=>a.id.localeCompare(b.id)),failures:[...failures.values()].sort((a,b)=>a.id.localeCompare(b.id)),queue:{businessCount:business.stations?.length??0,targetCount:rows.length,pendingCount:pending,enrichedCount:stations.size},lastAttempt:{at:startedAt,completedAt:new Date(clock()).toISOString(),status:stopReason,calls,added,reused,failed,maxCalls},source:{name:'NAVER Maps Geocoding',url:'https://api.ncloud-docs.com/docs/application-maps-geocoding'}};
  await atomicWriteJson(outputPath,result);
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const r=await geocodeBusinessAddresses();console.log(JSON.stringify({status:r.status,calls:r.lastAttempt.calls,added:r.lastAttempt.added,reused:r.lastAttempt.reused,failed:r.lastAttempt.failed,enriched:r.stations.length,pending:r.queue.pendingCount}));if(r.status==='error')process.exitCode=1;}
  catch(error){console.error(JSON.stringify(publicError(error)));process.exitCode=1;}
}
