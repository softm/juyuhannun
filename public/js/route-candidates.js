import {finite,getFuelPrice,freshness,hasMapCoordinates} from './core.js';

const METERS_PER_LATITUDE_DEGREE = 110_574;
const METERS_PER_LONGITUDE_DEGREE = 111_320;
const DEFAULT_CORRIDOR_METERS = 2_000;
const DEFAULT_MAX_CANDIDATES = 50;

function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function gridKey(x,y){return `${x}:${y}`;}

export function normalizeRoutePath(path){
  if(!Array.isArray(path)||path.length<2)return [];
  const normalized=[];
  for(const pair of path){
    if(!Array.isArray(pair)||pair.length<2)continue;
    const lng=Number(pair[0]),lat=Number(pair[1]);
    if(!finite(lng)||!finite(lat)||lat<32||lat>40||lng<123||lng>133)continue;
    const previous=normalized.at(-1);
    if(!previous||previous[0]!==lng||previous[1]!==lat)normalized.push([lng,lat]);
  }
  return normalized.length>=2?normalized:[];
}

export function buildRouteSegmentIndex(path,{corridorMeters=DEFAULT_CORRIDOR_METERS,cellMeters}={}){
  const points=normalizeRoutePath(path);
  if(points.length<2)throw new Error('경로 폴리라인은 올바른 좌표가 2개 이상이어야 합니다.');
  const corridor=clamp(Number(corridorMeters)||DEFAULT_CORRIDOR_METERS,100,10_000);
  const cell=clamp(Number(cellMeters)||corridor,250,5_000);
  const referenceLat=points.reduce((sum,pair)=>sum+pair[1],0)/points.length;
  const lngScale=METERS_PER_LONGITUDE_DEGREE*Math.cos(referenceLat*Math.PI/180);
  const project=pair=>({x:pair[0]*lngScale,y:pair[1]*METERS_PER_LATITUDE_DEGREE});
  const projected=points.map(project),segments=[],grid=new Map();
  let progressMeters=0;
  for(let i=0;i<projected.length-1;i++){
    const a=projected[i],b=projected[i+1],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(!finite(length)||length===0)continue;
    const segment={index:segments.length,pathIndex:i,a,b,dx,dy,length,startMeters:progressMeters};
    progressMeters+=length;segments.push(segment);
    const minX=Math.floor((Math.min(a.x,b.x)-corridor)/cell),maxX=Math.floor((Math.max(a.x,b.x)+corridor)/cell);
    const minY=Math.floor((Math.min(a.y,b.y)-corridor)/cell),maxY=Math.floor((Math.max(a.y,b.y)+corridor)/cell);
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){
      const key=gridKey(x,y),bucket=grid.get(key);
      if(bucket)bucket.push(segment.index);else grid.set(key,[segment.index]);
    }
  }
  if(!segments.length)throw new Error('경로 폴리라인의 길이를 계산할 수 없습니다.');
  return {path:points,projected,segments,grid,cellMeters:cell,corridorMeters:corridor,totalMeters:progressMeters,referenceLat,lngScale};
}

export function projectPointToRoute(point,index){
  if(!hasMapCoordinates(point)||!index?.segments?.length)return null;
  const projected={x:point.lng*index.lngScale,y:point.lat*METERS_PER_LATITUDE_DEGREE};
  const bucket=index.grid.get(gridKey(Math.floor(projected.x/index.cellMeters),Math.floor(projected.y/index.cellMeters)))||[];
  let best=null;
  for(const segmentIndex of bucket){
    const segment=index.segments[segmentIndex];if(!segment)continue;
    const lengthSquared=segment.length*segment.length;
    const fraction=clamp(((projected.x-segment.a.x)*segment.dx+(projected.y-segment.a.y)*segment.dy)/lengthSquared,0,1);
    const x=segment.a.x+segment.dx*fraction,y=segment.a.y+segment.dy*fraction;
    const proximityMeters=Math.hypot(projected.x-x,projected.y-y);
    if(!best||proximityMeters<best.proximityMeters){
      best={proximityMeters,progressMeters:segment.startMeters+segment.length*fraction,segmentIndex:segment.pathIndex,pathFraction:fraction};
    }
  }
  return best&&best.proximityMeters<=index.corridorMeters?best:null;
}

function comparisonPrice(row){return row.confidence?.eligible&&finite(row.currentPrice?.price)?row.currentPrice.price:Infinity;}
function candidateOrder(a,b){return comparisonPrice(a)-comparisonPrice(b)||a.proximityMeters-b.proximityMeters||a.progressMeters-b.progressMeters||String(a.id).localeCompare(String(b.id));}

export function diversifyRouteCandidates(candidates,{limit=DEFAULT_MAX_CANDIDATES,totalMeters}={}){
  const rows=Array.isArray(candidates)?candidates:[];
  const maximum=clamp(Math.trunc(Number(limit)||DEFAULT_MAX_CANDIDATES),1,100);
  if(rows.length<=maximum)return [...rows].sort((a,b)=>a.progressMeters-b.progressMeters||candidateOrder(a,b));
  const routeLength=finite(totalMeters)&&totalMeters>0?totalMeters:Math.max(...rows.map(row=>row.progressMeters),1);
  const binCount=Math.min(10,maximum),bins=Array.from({length:binCount},()=>[]);
  for(const row of rows){
    const bin=Math.min(binCount-1,Math.floor(clamp(row.progressMeters/routeLength,0,.999999)*binCount));
    bins[bin].push(row);
  }
  bins.forEach(bin=>bin.sort(candidateOrder));
  const selected=[],seen=new Set();
  for(let depth=0;selected.length<maximum;depth++){
    let added=false;
    for(const bin of bins){
      const row=bin[depth];if(!row||seen.has(String(row.id)))continue;
      selected.push(row);seen.add(String(row.id));added=true;
      if(selected.length>=maximum)break;
    }
    if(!added)break;
  }
  return selected.sort((a,b)=>a.progressMeters-b.progressMeters||candidateOrder(a,b));
}

export function findRouteCandidates(stations,path,{fuel='B027',corridorMeters=DEFAULT_CORRIDOR_METERS,maxCandidates=DEFAULT_MAX_CANDIDATES,brand='',self=false,freshOnly=false,now=Date.now()}={}){
  const index=buildRouteSegmentIndex(path,{corridorMeters});
  const rows=[];
  for(const station of Array.isArray(stations)?stations:[]){
    if(!station||typeof station.id!=='string'||!hasMapCoordinates(station))continue;
    if(brand&&station.brand!==brand)continue;
    if(self&&station.facilities?.self!==true)continue;
    const currentPrice=getFuelPrice(station,fuel);if(!currentPrice)continue;
    const confidence=freshness(currentPrice.priceUpdatedAt,currentPrice.fetchedAt,now,currentPrice.priceTimeStatus,currentPrice.sourceDate);
    if(freshOnly&&!confidence.eligible)continue;
    const projection=projectPointToRoute(station,index);if(!projection)continue;
    rows.push({...station,currentPrice,confidence,...projection});
  }
  return {index,candidateCount:rows.length,candidates:diversifyRouteCandidates(rows,{limit:maxCandidates,totalMeters:index.totalMeters})};
}

export function selectVerificationCandidates(candidates,{limit=8,totalMeters}={}){
  const rows=(Array.isArray(candidates)?candidates:[]).filter(row=>row.confidence?.eligible&&finite(row.currentPrice?.price));
  const maximum=clamp(Math.trunc(Number(limit)||8),1,12);
  if(rows.length<=maximum)return [...rows].sort(candidateOrder);
  const routeLength=finite(totalMeters)&&totalMeters>0?totalMeters:Math.max(...rows.map(row=>row.progressMeters),1);
  const binCount=Math.min(4,maximum),bins=Array.from({length:binCount},()=>[]);
  for(const row of rows){
    const bin=Math.min(binCount-1,Math.floor(clamp(row.progressMeters/routeLength,0,.999999)*binCount));
    bins[bin].push(row);
  }
  bins.forEach(bin=>bin.sort(candidateOrder));
  const selected=[],seen=new Set();
  for(let depth=0;selected.length<maximum;depth++){
    let added=false;
    for(const bin of bins){const row=bin[depth];if(!row||seen.has(String(row.id)))continue;selected.push(row);seen.add(String(row.id));added=true;if(selected.length>=maximum)break;}
    if(!added)break;
  }
  for(const row of [...rows].sort(candidateOrder)){if(selected.length>=maximum)break;if(!seen.has(String(row.id))){selected.push(row);seen.add(String(row.id));}}
  return selected;
}

export function calculateRouteCandidateCosts({unitPrice,liters,kmPerLiter,referenceFuelWonPerL,hourlyValueWonPerHour=0,detour}={}){
  const price=Number(unitPrice),amount=Number(liters),economy=Number(kmPerLiter),reference=Number(referenceFuelWonPerL),hourly=Number(hourlyValueWonPerHour);
  const distance=Number(detour?.distanceMeters),duration=Number(detour?.durationSeconds),toll=Number(detour?.tollWon);
  const purchaseWon=finite(price)&&price>0&&finite(amount)&&amount>0?price*amount:null;
  const verified=detour?.verified===true&&finite(distance)&&distance>=0&&finite(duration)&&duration>=0&&finite(toll);
  const canEstimateFuel=verified&&finite(economy)&&economy>0&&finite(reference)&&reference>0;
  const extraFuelWon=canEstimateFuel?distance/1000/economy*reference:null;
  const extraTollWon=verified?toll:null;
  const timeWon=verified&&finite(hourly)&&hourly>=0?duration/3600*hourly:null;
  const totalWon=[purchaseWon,extraFuelWon,extraTollWon,timeWon].every(finite)?purchaseWon+extraFuelWon+extraTollWon+timeWon:null;
  const savingBase=finite(reference)&&reference>0&&finite(amount)&&amount>0&&finite(price)&&price>0?(reference-price)*amount:null;
  const estimatedSavingWon=savingBase!==null&&[extraFuelWon,extraTollWon,timeWon].every(finite)?savingBase-extraFuelWon-extraTollWon-timeWon:null;
  return {purchaseWon,extraFuelWon,extraTollWon,timeWon,totalWon,estimatedSavingWon};
}

function verifiedComparable(row,maxDetourMinutes=Infinity){
  const detour=row?.detour;
  return Boolean(row?.confidence?.eligible&&finite(row?.currentPrice?.price)&&detour?.verified===true&&finite(detour.distanceMeters)&&detour.distanceMeters>=0&&finite(detour.durationSeconds)&&detour.durationSeconds>=0&&finite(detour.tollWon)&&detour.durationSeconds<=maxDetourMinutes*60);
}

export function sortRouteCandidates(candidates,{sort='recommended',maxDetourMinutes=Infinity}={}){
  const rows=[...(Array.isArray(candidates)?candidates:[])];
  const accepted=row=>verifiedComparable(row,maxDetourMinutes);
  const price=row=>row.confidence?.eligible&&finite(row.currentPrice?.price)?row.currentPrice.price:Infinity;
  const duration=row=>row.detour?.verified&&finite(row.detour.durationSeconds)?row.detour.durationSeconds:Infinity;
  const distance=row=>row.detour?.verified&&finite(row.detour.distanceMeters)?row.detour.distanceMeters:Infinity;
  const recommendedValue=row=>finite(row.costs?.totalWon)?row.costs.totalWon:price(row);
  const compare=sort==='price'
    ?(a,b)=>price(a)-price(b)||duration(a)-duration(b)||a.progressMeters-b.progressMeters
    :sort==='detour'
      ?(a,b)=>duration(a)-duration(b)||distance(a)-distance(b)||price(a)-price(b)
      :sort==='progress'
        ?(a,b)=>a.progressMeters-b.progressMeters||a.proximityMeters-b.proximityMeters
        :(a,b)=>Number(accepted(b))-Number(accepted(a))||recommendedValue(a)-recommendedValue(b)||duration(a)-duration(b)||distance(a)-distance(b)||price(a)-price(b)||a.progressMeters-b.progressMeters;
  return rows.sort((a,b)=>compare(a,b)||String(a.id).localeCompare(String(b.id)));
}

export function applyRecommendationRanks(candidates,{maxDetourMinutes=Infinity,limit=5}={}){
  const eligible=sortRouteCandidates(candidates,{sort:'recommended',maxDetourMinutes}).filter(row=>verifiedComparable(row,maxDetourMinutes)).slice(0,clamp(limit,1,5));
  const ranks=new Map(eligible.map((row,index)=>[String(row.id),index+1]));
  return candidates.map(row=>({...row,rank:ranks.get(String(row.id))||null,reason:ranks.has(String(row.id))?(finite(row.costs?.totalWon)?'추천: 주유비+추가 이동비 예상 합계':'추천: 유효 가격과 실제 우회가 작은 순서'):row.reason||null}));
}

export function kakaoRouteURLs(origin,station,destination){
  if(!hasMapCoordinates(origin)||!hasMapCoordinates(station)||!hasMapCoordinates(destination))return null;
  const query=new URLSearchParams({sp:`${origin.lat},${origin.lng}`,vp:`${station.lat},${station.lng}`,ep:`${destination.lat},${destination.lng}`,by:'car'}).toString();
  return {app:`kakaomap://route?${query}`,web:`https://m.map.kakao.com/scheme/route?${query}`};
}
