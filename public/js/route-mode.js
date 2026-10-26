import {freshness,getFuelPrice} from './core.js';
import {
  applyRecommendationRanks,
  calculateRouteCandidateCosts,
  findRouteCandidates,
  kakaoRouteURLs,
  normalizeRoutePath,
  selectVerificationCandidates,
  sortRouteCandidates,
} from './route-candidates.js';

export const DIRECTIONS_PROXY='https://daycare-directions-proxy.vercel.app/api/directions';
const ROUTE_TIMEOUT_MS=25_000;
const VERIFICATION_CONCURRENCY=3;
const VERIFICATION_LIMIT=8;

function routeError(message,code='DIRECTIONS_PROXY_ERROR'){
  return Object.assign(new Error(message),{code});
}

export function normalizeDirectionsResponse(data){
  if(!data||typeof data!=='object'||data.error)throw routeError(typeof data?.error==='string'?data.error:'도로 경로를 찾지 못했습니다.');
  const path=normalizeRoutePath(data.path);
  const distanceMeters=Number(data.summary?.distance??data.distance);
  const durationMs=Number(data.summary?.duration??data.duration);
  const tollValue=data.summary?.tollFare??data.tollFare;
  const tollWon=Number(tollValue);
  if(path.length<2||!Number.isFinite(distanceMeters)||distanceMeters<0||!Number.isFinite(durationMs)||durationMs<0||tollValue==null||tollValue===''||!Number.isFinite(tollWon)||tollWon<0){
    throw routeError('도로 경로의 거리·시간·통행료를 확인하지 못했습니다.','DIRECTIONS_PROXY_INVALID_RESPONSE');
  }
  return {distanceMeters,durationSeconds:durationMs/1000,tollWon,path};
}

async function mapConcurrent(items,limit,worker){
  const results=new Array(items.length);let cursor=0;
  const run=async()=>{for(;;){const index=cursor++;if(index>=items.length)return;try{results[index]={status:'fulfilled',value:await worker(items[index],index)};}catch(reason){results[index]={status:'rejected',reason};}}};
  await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},run));
  return results;
}

function publicWarning(error){
  if(error?.name==='AbortError')return '경로 조회가 취소되었거나 시간이 초과되었습니다.';
  return error?.message||'실제 경유 경로를 확인하지 못했습니다.';
}

export function createRouteModeController({directionsProxy=DIRECTIONS_PROXY,requestJSON,clock=Date.now}={}){
  if(typeof requestJSON!=='function')throw new Error('경로 요청 함수를 연결해 주세요.');
  let generation=0,controller=null,timer=null;
  const state={origin:null,destination:null,originLabel:'',destinationLabel:'',response:null,rows:[],loading:false,error:null,lastRequest:null};

  function setPoint(type,point,label=''){
    if(!['origin','destination'].includes(type))throw new Error('경로 지점 종류를 확인해 주세요.');
    const lat=Number(point?.lat),lng=Number(point?.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<32||lat>40||lng<123||lng>133)throw new Error('대한민국 영역의 위치를 선택해 주세요.');
    state[type]={lat,lng};state[`${type}Label`]=String(label||`지도 지정 (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    invalidate();return state[type];
  }

  function swap(){
    const origin=state.origin,label=state.originLabel;
    state.origin=state.destination;state.originLabel=state.destinationLabel;
    state.destination=origin;state.destinationLabel=label;invalidate();
  }

  function invalidate(){generation+=1;clearTimeout(timer);controller?.abort();controller=null;timer=null;state.response=null;state.rows=[];state.error=null;state.loading=false;state.lastRequest=null;}

  function hydrate(response,stations,fuel){
    const byId=new Map((Array.isArray(stations)?stations:[]).map(station=>[String(station.id),station]));
    const rows=[];
    for(const result of Array.isArray(response?.results)?response.results:[]){
      const station=byId.get(String(result.stationId));if(!station)continue;
      const localPrice=getFuelPrice(station,fuel);
      const useLocal=Number.isFinite(Number(localPrice?.price))&&Number(localPrice.price)>0;
      const currentPrice={
        price:useLocal?Number(localPrice.price):Number(result.price?.value),sourceDate:useLocal?localPrice?.sourceDate??null:result.price?.sourceDate??null,
        priceUpdatedAt:useLocal?localPrice?.priceUpdatedAt??null:result.price?.priceUpdatedAt??null,
        fetchedAt:useLocal?localPrice?.fetchedAt??null:result.price?.fetchedAt??null,
        priceTimeStatus:localPrice?.priceTimeStatus??null,source:localPrice?.source??null,
      };
      const confidence=freshness(currentPrice.priceUpdatedAt,currentPrice.fetchedAt,clock(),currentPrice.priceTimeStatus,currentPrice.sourceDate);
      rows.push({...station,currentPrice,confidence,progressMeters:Number(result.progressMeters),proximityMeters:Number(result.proximityMeters),detour:result.detour||{verified:false},costs:result.costs||{},routeRank:result.rank||null,routeReason:result.reason||null,viaPath:Array.isArray(result.viaPath)?result.viaPath:null});
    }
    return rows;
  }

  async function directions({origin,destination,via=null,option='traoptimal'},signal){
    const body={start:origin,goal:destination,waypoints:via?[via]:[],option};
    return normalizeDirectionsResponse(await requestJSON(directionsProxy,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  }

  async function plan({stations,fuel,liters,kmPerLiter,referenceFuelWonPerL,hourlyValueWonPerHour,maxDetourMinutes,corridorMeters,option='traoptimal',brand='',selfOnly=false}={}){
    if(!state.origin||!state.destination)throw new Error('출발지와 목적지를 모두 선택해 주세요.');
    const ticket=++generation;clearTimeout(timer);controller?.abort();controller=new AbortController();timer=setTimeout(()=>controller?.abort(),ROUTE_TIMEOUT_MS);state.loading=true;state.error=null;state.rows=[];
    const request={origin:state.origin,destination:state.destination,fuel,maxDetourMinutes,corridorMeters,option,brand,selfOnly};
    state.lastRequest=request;
    try{
      const baseRoute=await directions({origin:state.origin,destination:state.destination,option},controller.signal);
      if(ticket!==generation)return null;
      const found=findRouteCandidates(stations,baseRoute.path,{fuel,corridorMeters,maxCandidates:50,brand,self:selfOnly,now:clock()});
      const shortlist=selectVerificationCandidates(found.candidates,{limit:VERIFICATION_LIMIT,totalMeters:found.index.totalMeters});
      const checked=await mapConcurrent(shortlist,VERIFICATION_CONCURRENCY,async row=>{
        const viaRoute=await directions({origin:state.origin,destination:state.destination,via:{lat:row.lat,lng:row.lng},option},controller.signal);
        const distanceMeters=viaRoute.distanceMeters-baseRoute.distanceMeters;
        const durationSeconds=viaRoute.durationSeconds-baseRoute.durationSeconds;
        const tollWon=viaRoute.tollWon-baseRoute.tollWon;
        if(distanceMeters<0||durationSeconds<0)throw routeError('직행·경유 경로의 교통 조건이 달라 우회를 확정할 수 없습니다.','ROUTE_COMPARISON_AMBIGUOUS');
        return {stationId:row.id,detour:{verified:true,distanceMeters,durationSeconds,tollWon},viaPath:viaRoute.path};
      });
      if(ticket!==generation)return null;
      if(controller.signal.aborted)throw Object.assign(new Error('경로 조회 시간이 초과되었습니다.'),{name:'AbortError'});
      const verifiedById=new Map(),warnings=[];
      checked.forEach((result,index)=>{
        const row=shortlist[index];
        if(result.status==='fulfilled')verifiedById.set(String(row.id),result.value);
        else{const message=publicWarning(result.reason);verifiedById.set(String(row.id),{stationId:row.id,detour:{verified:false,distanceMeters:null,durationSeconds:null,tollWon:null,error:{code:result.reason?.code||'ROUTE_CHECK_FAILED',message}},viaPath:null});warnings.push(`${row.name}: ${message}`);}
      });
      let candidates=found.candidates.map(row=>{
        const checkedRow=verifiedById.get(String(row.id));
        const detour=checkedRow?.detour||{verified:false,distanceMeters:null,durationSeconds:null,tollWon:null};
        const costs=calculateRouteCandidateCosts({unitPrice:row.currentPrice.price,liters,kmPerLiter,referenceFuelWonPerL,hourlyValueWonPerHour,detour});
        return {...row,detour,costs,viaPath:checkedRow?.viaPath||null};
      });
      candidates=applyRecommendationRanks(candidates,{maxDetourMinutes,limit:5});
      candidates=sortRouteCandidates(candidates,{sort:'recommended',maxDetourMinutes});
      const results=candidates.map(row=>({
        stationId:row.id,progressMeters:Math.round(row.progressMeters),proximityMeters:Math.round(row.proximityMeters),
        price:{value:row.currentPrice.price,sourceDate:row.currentPrice.sourceDate||null,priceUpdatedAt:row.currentPrice.priceUpdatedAt||null,fetchedAt:row.currentPrice.fetchedAt||null,eligible:row.confidence.eligible,label:row.confidence.label},
        detour:row.detour,costs:row.costs,rank:row.rank,reason:row.reason,viaPath:row.viaPath,
      }));
      const successful=results.filter(row=>row.detour.verified).length;
      const response={status:warnings.length?'partial':'ready',provider:'naver',option,fetchedAt:new Date(clock()).toISOString(),baseRoute,results,checkedCount:successful,attemptedCount:shortlist.length,candidateCount:found.candidateCount,warnings};
      state.response=response;state.rows=hydrate(response,stations,fuel);return response;
    }catch(error){
      if(ticket!==generation)return null;
      const message=publicWarning(error);state.error={code:error?.code||'ROUTE_REQUEST_FAILED',message};
      state.response={status:'error',provider:'naver',option,fetchedAt:new Date(clock()).toISOString(),baseRoute:null,results:[],checkedCount:0,attemptedCount:0,candidateCount:0,warnings:[],error:state.error};
      throw error;
    }finally{if(ticket===generation){clearTimeout(timer);timer=null;state.loading=false;controller=null;}}
  }

  function rows({sort='recommended',brand='',selfOnly=false,freshOnly=false,maxDetourMinutes=10,liters,kmPerLiter,referenceFuelWonPerL,hourlyValueWonPerHour=0}={}){
    let filtered=state.rows.filter(row=>(!brand||row.brand===brand)&&(!selfOnly||row.facilities?.self===true)&&(!freshOnly||row.confidence?.eligible));
    filtered=filtered.filter(row=>row.detour?.verified!==true||!Number.isFinite(row.detour.durationSeconds)||row.detour.durationSeconds<=maxDetourMinutes*60);
    filtered=filtered.map(row=>({...row,costs:calculateRouteCandidateCosts({unitPrice:row.currentPrice.price,liters,kmPerLiter,referenceFuelWonPerL,hourlyValueWonPerHour,detour:row.detour}),rank:null,reason:row.routeReason}));
    filtered=applyRecommendationRanks(filtered,{maxDetourMinutes,limit:5}).map(row=>({...row,routeRank:row.rank,routeReason:row.reason}));
    return sortRouteCandidates(filtered,{sort,maxDetourMinutes});
  }

  function routeForStation(id){return state.rows.find(row=>String(row.id)===String(id))||null;}
  function navigationForStation(id){const row=routeForStation(id);return row?kakaoRouteURLs(state.origin,row,state.destination):null;}

  return {state,setPoint,swap,invalidate,plan,rows,routeForStation,navigationForStation,syncStations(stations,fuel){if(state.response?.results)state.rows=hydrate(state.response,stations,fuel);return state.rows;},cancel(){generation+=1;clearTimeout(timer);timer=null;controller?.abort();controller=null;state.loading=false;},refreshConfidence(fuel){for(const row of state.rows){const price=getFuelPrice(row,fuel);if(price)row.confidence=freshness(price.priceUpdatedAt,price.fetchedAt,clock(),price.priceTimeStatus,price.sourceDate);}}};
}
