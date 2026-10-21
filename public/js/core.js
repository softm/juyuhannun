export const FUEL_TYPES = [
  { code: 'B027', name: '휘발유' }, { code: 'D047', name: '경유' },
  { code: 'B034', name: '고급휘발유' }, { code: 'K015', name: 'LPG' },
];
export const BRANDS = { SKE: 'SK에너지', GSC: 'GS칼텍스', HDO: 'HD현대오일뱅크', SOL: 'S-OIL', RTE: '알뜰주유소', RTX: '고속도로 알뜰', NHO: '농협 알뜰', ETC: '자가상표', E1G: 'E1', SKG: 'SK가스' };
export const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (v) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[v]));
export const finite = (v) => typeof v === 'number' && Number.isFinite(v);
export const hasMapCoordinates = s => finite(s?.lat) && finite(s?.lng) && s.lat>=32 && s.lat<=40 && s.lng>=123 && s.lng<=133;
export function stationNavigationURL(s){return hasMapCoordinates(s)?`https://map.kakao.com/link/to/${encodeURIComponent(s.name)},${s.lat},${s.lng}`:`https://map.kakao.com/link/search/${encodeURIComponent(s.roadAddress||s.address||s.name)}`;}
export function normalizeSearchText(v){let s=String(v||'').toLocaleLowerCase('ko-KR');for(const [from,to] of [['서울특별시','서울'],['부산광역시','부산'],['대구광역시','대구'],['인천광역시','인천'],['광주광역시','광주'],['대전광역시','대전'],['울산광역시','울산'],['세종특별자치시','세종'],['경기도','경기'],['강원특별자치도','강원'],['강원도','강원'],['충청북도','충북'],['충청남도','충남'],['전북특별자치도','전북'],['전라북도','전북'],['전라남도','전남'],['경상북도','경북'],['경상남도','경남'],['제주특별자치도','제주']])s=s.replaceAll(from,to);return s;}
export const money = (value) => finite(value) ? Math.round(value).toLocaleString('ko-KR') : '—';
export function distanceMeters(a, b) {
  if (!a || !b || ![a.lat,a.lng,b.lat,b.lng].every(finite) || Math.abs(a.lat)>90 || Math.abs(b.lat)>90 || Math.abs(a.lng)>180 || Math.abs(b.lng)>180) return Infinity;
  const r = Math.PI/180, dLat = (b.lat-a.lat)*r, dLng = (b.lng-a.lng)*r;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1,x)), Math.sqrt(Math.max(0,1-x)));
}
export function getFuelPrice(station, fuel) {
  if (station?.dataGranularity && station.dataGranularity !== 'station') return null;
  if (station?.unit && station.unit !== 'KRW/L') return null;
  const p = station?.prices?.[fuel] || (station?.fuel === fuel ? station : null);
  if (!p || (p.unit && p.unit !== 'KRW/L') || !finite(p.price) || p.price <= 0) return null;
  return { price: p.price, priceUpdatedAt: p.priceUpdatedAt ?? null, fetchedAt: p.fetchedAt ?? station.fetchedAt ?? null, priceTimeStatus: p.priceTimeStatus ?? station.priceTimeStatus ?? null, sourceDate: p.sourceDate ?? null };
}
export function freshness(priceUpdatedAt, fetchedAt, now = Date.now(), priceTimeStatus = null, sourceDate = null) {
  const source = typeof priceUpdatedAt==='string' ? Date.parse(priceUpdatedAt) : NaN;
  const fetched = typeof fetchedAt==='string' ? Date.parse(fetchedAt) : NaN;
  if (!Number.isFinite(source) && ['daily_current_file','daily_price_file'].includes(priceTimeStatus)) {
    if (!Number.isFinite(fetched) || fetched > now + 300000) return {state:'unknown',label:'일간자료 수집시각 확인 필요',eligible:false,ageHours:null};
    const fetchAge=Math.max(0,(now-fetched)/3600000);
    const day=/^\d{4}-\d{2}-\d{2}$/.test(String(sourceDate||''))?String(sourceDate):null;
    const today=new Date(now+9*60*60*1000).toISOString().slice(0,10);
    const yesterday=new Date(now+9*60*60*1000-24*60*60*1000).toISOString().slice(0,10);
    if(fetchAge>30||(day&&day!==today&&day!==yesterday))return {state:'stale',label:'일간가격 기준일 경과',eligible:false,ageHours:fetchAge};
    const prefix=day===yesterday?'전일':'당일';
    return {state:day===yesterday?'aging':'daily',label:`${prefix} 일괄가격 · 개별시각 미제공`,eligible:true,ageHours:fetchAge};
  }
  if (!Number.isFinite(source)) return {state:'unknown',label:'가격 시각 미확인',eligible:false,ageHours:null};
  if (source>now+300000 || (Number.isFinite(fetched) && source>fetched+300000)) return {state:'invalid',label:'가격 시각 확인 필요',eligible:false,ageHours:null};
  if (!Number.isFinite(fetched) || fetched>now+300000) return {state:'unknown',label:'수집 시각 미확인',eligible:false,ageHours:null};
  const ageHours = Math.max(0,(now-source)/3600000), fetchAge = Math.max(0,(now-fetched)/3600000);
  if (ageHours>24 || fetchAge>24) return {state:'stale',label:'24시간 경과',eligible:false,ageHours};
  if (ageHours>6 || fetchAge>6) return {state:'aging',label:'6시간 경과 · 확인 권장',eligible:true,ageHours};
  return {state:'fresh',label:'6시간 이내 보고',eligible:true,ageHours};
}
export function formatTime(iso, short=false) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '미확인';
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,...(!short?{year:'numeric'}:{})}).format(new Date(iso));
}
export function calculateSavings({unitPrice,referencePrice,liters,kmPerLiter,route,consumptionPrice=referencePrice,hourlyValue=0}) {
  const fail = (reason) => ({eligible:false,reason,netSavings:null});
  if (![unitPrice,referencePrice,liters,kmPerLiter,consumptionPrice].every(v=>finite(v)&&v>0) || !finite(hourlyValue)||hourlyValue<0) return fail('기준 단가·주유량·연비를 입력해 주세요.');
  if (liters>1000 || kmPerLiter>100) return fail('주유량 또는 연비의 입력 범위를 확인해 주세요.');
  if (route?.status!=='ready' || !route.direct || !route.via) return fail('출발지와 목적지를 지정하고 도로 경로를 확인해 주세요.');
  for (const leg of [route.direct,route.via]) {
    if (![leg.distanceMeters,leg.durationSeconds,leg.tollWon].every(v=>finite(v)&&v>=0)) return fail('경로 거리·시간·통행료가 모두 확인되어야 합니다.');
  }
  if (route.provider !== 'naver') return fail('확인된 도로 경로가 필요합니다.');
  const rd = route.via.distanceMeters-route.direct.distanceMeters;
  if (rd < -Math.max(100,route.direct.distanceMeters*.01)) return fail('경유 경로가 기준 경로보다 짧습니다. 경로 조건을 다시 확인해 주세요.');
  const extraDistanceMeters=Math.max(0,rd), extraDurationSeconds=Math.max(0,route.via.durationSeconds-route.direct.durationSeconds);
  const grossSavings=(referencePrice-unitPrice)*liters;
  const fuelCost=extraDistanceMeters/1000/kmPerLiter*consumptionPrice;
  const tollCost=route.via.tollWon-route.direct.tollWon;
  const timeCost=extraDurationSeconds/3600*hourlyValue;
  const netSavings=grossSavings-fuelCost-tollCost-timeCost;
  return {eligible:true,reason:null,grossSavings,fuelCost,tollCost,timeCost,netSavings,extraDistanceMeters,extraDurationSeconds,breakEvenLiters:referencePrice>unitPrice?Math.max(0,(fuelCost+tollCost+timeCost)/(referencePrice-unitPrice)):null};
}
export function filterStations(stations, {fuel,center,radius=5000,scope='nearby',query='',brand='',self=false,freshOnly=true,favorites=null,sort='price',now=Date.now()}) {
  const terms=normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  return stations.map(station=> {
    const p=getFuelPrice(station,fuel);
    return {...station,currentPrice:p,confidence:p?freshness(p.priceUpdatedAt,p.fetchedAt,now,p.priceTimeStatus,p.sourceDate):{state:'unknown',label:'가격 미제공',eligible:false},distance:hasMapCoordinates(station)?distanceMeters(center,station):Infinity};
  }).filter(s=>s.currentPrice && (scope==='national'||s.distance<=radius) && (!brand||s.brand===brand) && (!self||s.facilities?.self===true) && (!freshOnly||s.confidence.eligible) && (!favorites||favorites.has(s.id)) && terms.every(term=>normalizeSearchText([s.name,s.address,s.roadAddress,BRANDS[s.brand]].filter(Boolean).join(' ')).includes(term)))
    .sort((a,b)=>sort==='distance'?a.distance-b.distance||a.currentPrice.price-b.currentPrice.price:a.currentPrice.price-b.currentPrice.price||a.distance-b.distance);
}
