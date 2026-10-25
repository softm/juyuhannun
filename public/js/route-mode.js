import {freshness,getFuelPrice} from './core.js';
import {applyRecommendationRanks,calculateRouteCandidateCosts,kakaoRouteURLs,sortRouteCandidates} from './route-candidates.js';

function unavailableResult(message){return {status:'unavailable',baseRoute:null,results:[],checkedCount:0,attemptedCount:0,candidateCount:0,warnings:[],error:{code:'ROUTE_API_REQUIRED',message}};}

export function createRouteModeController({apiBase='',requestJSON,clock=Date.now}={}){
  let generation=0,controller=null;
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

  function invalidate(){generation+=1;controller?.abort();controller=null;state.response=null;state.rows=[];state.error=null;state.loading=false;state.lastRequest=null;}

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

  async function plan({stations,fuel,liters,kmPerLiter,referenceFuelWonPerL,hourlyValueWonPerHour,maxDetourMinutes,corridorMeters,option='traoptimal',brand='',selfOnly=false}={}){
    if(!state.origin||!state.destination)throw new Error('출발지와 목적지를 모두 선택해 주세요.');
    const ticket=++generation;controller?.abort();controller=new AbortController();state.loading=true;state.error=null;state.rows=[];
    const request={origin:state.origin,destination:state.destination,fuel,liters,kmPerLiter,referenceFuelWonPerL,hourlyValueWonPerHour,maxDetourMinutes,corridorMeters,option,brand,selfOnly,candidateIds:[]};
    state.lastRequest=request;
    try{
      if(!apiBase){
        const response=unavailableResult('경로 서비스를 아직 연결하지 못했습니다. 연결이 완료되면 목적지까지 실제 경로의 주유소를 바로 보여드립니다.');
        if(ticket===generation){state.response=response;state.error=response.error;}
        return response;
      }
      const response=await requestJSON(`${apiBase}/route/recommendations`,controller.signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
      if(ticket!==generation)return null;
      state.response=response;
      if(!['ready','partial'].includes(response?.status))state.error=response?.error||{message:'경로를 확인하지 못했습니다.'};
      state.rows=hydrate(response,stations,fuel);
      return response;
    }catch(error){
      if(ticket!==generation)return null;
      const message=error?.name==='AbortError'?'경로 조회가 취소되었거나 시간이 초과되었습니다.':error?.message||'경로를 확인하지 못했습니다.';
      state.error={code:'ROUTE_REQUEST_FAILED',message};state.response=unavailableResult(message);throw error;
    }finally{if(ticket===generation){state.loading=false;controller=null;}}
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

  return {state,setPoint,swap,invalidate,plan,rows,routeForStation,navigationForStation,syncStations(stations,fuel){if(state.response?.results)state.rows=hydrate(state.response,stations,fuel);return state.rows;},cancel(){generation+=1;controller?.abort();controller=null;state.loading=false;},refreshConfidence(fuel){for(const row of state.rows){const price=getFuelPrice(row,fuel);if(price)row.confidence=freshness(price.priceUpdatedAt,price.fetchedAt,clock(),price.priceTimeStatus,price.sourceDate);}}};
}
