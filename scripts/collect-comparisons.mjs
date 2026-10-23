import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpinetClient, FUELS, OPINET_SOURCE } from '../server/opinet.mjs';
import { DailyQuota, RunQuota } from '../server/quota.mjs';
import { ServiceError, publicError } from '../server/errors.mjs';
import { saveSnapshot } from './snapshot.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const FUEL_NAMES={B027:'휘발유',D047:'경유',B034:'고급휘발유',K015:'LPG'};
const text=v=>(typeof v==='string'||typeof v==='number')?String(v).trim().slice(0,300):'';
const price=v=>{const n=Number(text(v).replaceAll(',',''));return Number.isFinite(n)&&n>0&&n<=100000?n:null;};

function normalize(row,{fuel,fetchedAt}){
  const id=text(row?.UNI_ID),value=price(row?.PRICE);
  if(!id||!value)return null;
  return {
    id:`${fuel}:${id}`,
    stationId:id,
    fuel,
    fuelName:FUEL_NAMES[fuel]||fuel,
    price:value,
    rank:Number.isFinite(Number(row?.RANK))?Number(row.RANK):null,
    brand:text(row?.POLL_DIV_CD)||null,
    stationName:text(row?.OS_NM)||null,
    address:text(row?.VAN_ADR)||null,
    fetchedAt,
    source:{...OPINET_SOURCE,apiUrl:'https://www.opinet.co.kr/api/lowTop10.do',documentationUrl:'https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=2'}
  };
}

export async function collectComparisons({
  outputPath=resolve(ROOT,'public/data/comparisons.json'),
  ledgerPath=resolve(ROOT,'.cache/opinet-quota.json'),
  configPath=resolve(ROOT,'config/collection.json'),
  apiKey=process.env.OPINET_API_KEY||'',
  fetchImpl=fetch,
  clock=Date.now,
}={}){
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const dailyLimit=config.dailyCallLimit??300;
  const fuels=config.apiBudgetPolicy?.lowestPriceComparisonFuels??['B027','D047','B034','K015'];
  if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>300||!Array.isArray(fuels)||fuels.some(f=>!Object.hasOwn(FUELS,f))){
    throw new ServiceError('INVALID_COLLECTION_CONFIG','최저가 비교 수집 설정을 확인해 주세요.');
  }
  const quota=new RunQuota(new DailyQuota({ledgerPath,limit:dailyLimit,clock}),Math.min(8,fuels.length));
  const client=new OpinetClient({apiKey,quota,fetchImpl,clock,detailLimit:0});
  const fetchedAt=new Date(clock()).toISOString();
  if(!client.configured){
    const next={version:1,status:'awaiting_credentials',provider:'opinet',fetchedAt:null,comparisons:[],lastAttempt:{at:fetchedAt,status:'awaiting_credentials',calls:0},warnings:[{code:'OPINET_CREDENTIALS_REQUIRED',message:'오피넷 인증키 연결 후 전국 최저가 비교자료를 수집합니다.'}]};
    return saveSnapshot(outputPath,next,'comparisons');
  }
  const comparisons=[],warnings=[];let successes=0;
  for(const fuel of fuels){
    try{
      const rows=await client.request('lowTop10.do',{prodcd:fuel,cnt:'20'});
      const normalized=rows.map(row=>normalize(row,{fuel,fetchedAt})).filter(Boolean);
      if(rows.length&&!normalized.length)throw new ServiceError('OPINET_COMPARISON_SCHEMA_ERROR','전국 최저가 응답의 주유소와 가격을 확인할 수 없습니다.');
      comparisons.push(...normalized);
      successes++;
    }catch(error){
      warnings.push({fuel,code:'LOWEST_PRICE_COMPARISON_FAILED',message:`${FUEL_NAMES[fuel]||fuel} 전국 최저가 비교자료를 갱신하지 못했습니다.`,error:publicError(error)});
      if(error?.code==='OPINET_DAILY_QUOTA_EXCEEDED')break;
    }
  }
  const status=successes===fuels.length?'ready':successes?'partial':'error';
  const next={version:1,status,provider:'opinet',fetchedAt:successes?fetchedAt:null,comparisons,lastAttempt:{at:fetchedAt,status,calls:quota.used},coverage:{kind:'national_lowest_top20',complete:successes===fuels.length,fuels},warnings,...(status==='error'?{error:warnings[0]?.error??{code:'COMPARISON_COLLECTION_FAILED',message:'전국 최저가 비교자료를 받지 못했습니다.'}}:{})};
  return saveSnapshot(outputPath,next,'comparisons');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await collectComparisons();
    console.log(JSON.stringify({status:result.status,count:result.comparisons?.length??0,calls:result.lastAttempt?.calls??0,fetchedAt:result.fetchedAt??null}));
    if(result.status==='error')process.exitCode=1;
  }catch(error){console.error(JSON.stringify(publicError(error)));process.exitCode=1;}
}
