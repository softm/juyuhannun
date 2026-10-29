import {APP_CONFIG} from '../config.js';
import {MapController} from './map.js';
import {pickListScrollStation,setupMobileMapView} from './mobile-map-view.js';
import {createMapLoadingController} from '../shared/map-loading.js';
import {mountBottomAd,mountStationDetailAd,mountStationListAds} from './adfit.js';
import {loadStationData,loadStaticJSON,mergeStationData,reselectStationPrices} from './data-loader.js';
import {FUEL_TYPES,BRANDS,escapeHTML as esc,money,finite,distanceMeters,getFuelPrice,freshness,formatTime,filterStations,searchStations,summarizeVisiblePrices,hasMapCoordinates,stationNavigationURL} from './core.js';
import {createRouteModeController,selectRouteDisplayRows} from './route-mode.js';
import {createRouteSimulationController} from './route-simulation.js';
import {addressSearchPresentation} from './address-search.js';
import {normalizeRouteHistory,rememberRouteDestination} from './route-history.js';
import {brandVisual} from './brand-visuals.js';

const $=(id)=>document.getElementById(id);
mountBottomAd();
const iconPaths={pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',route:'<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h9a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h9"/>',heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',calculator:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',sliders:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="white"/><circle cx="15" cy="17" r="2" fill="white"/>',menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',map:'<path d="m2 6 6-3 8 3 6-3v15l-6 3-8-3-6 3Zm6-3v15m8-12v15"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M19 8a8 8 0 0 0-14-3M5 16a8 8 0 0 0 14 3"/>',locate:'<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',home:'<path d="m3 10 9-7 9 7v11H3Zm6 11v-8h6v8"/>',list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',pump:'<rect x="3" y="3" width="12" height="17" rx="2"/><path d="M6 7h6v4H6ZM1 21h16m-2-8h2v5a2 2 0 0 0 4 0V8l-4-4m3 3v4h1"/>',share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/>',phone:'<path d="M6 3H3c0 10 8 18 18 18v-4l-5-2-2 3a17 17 0 0 1-8-8l3-2-3-5Z"/>',check:'<path d="m5 12 4 4L20 5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'};
iconPaths.expand='<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>';
iconPaths.collapse='<path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5"/>';
iconPaths.plus='<path d="M12 5v14M5 12h14"/>';
iconPaths.minus='<path d="M5 12h14"/>';
iconPaths.layers='<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>';
iconPaths.droplet='<path d="M12 3s-5 6.2-5 10a5 5 0 0 0 10 0c0-3.8-5-10-5-10Z"/>';
iconPaths.star='<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>';
iconPaths.flame='<path d="M13.5 3.5c.4 3-1.7 4.3-3.2 6.1-1.2 1.4-1.8 2.8-1.8 4.5a4.5 4.5 0 0 0 9 0c0-3.4-2.1-6.2-4-10.6Z"/><path d="M10.5 16.8c0-1.5.8-2.7 2.2-4.2.2 2 .9 2.8 1.5 3.8.7 1.1.3 2.6-1.3 3-1.3.3-2.4-.8-2.4-2.6Z"/>';
iconPaths.back='<path d="m15 18-6-6 6-6"/>';
iconPaths.mic='<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/>';
iconPaths['chevron-down']='<path d="m7 10 5 5 5-5"/>';
iconPaths.navigation='<path d="m12 3 7 18-7-4-7 4 7-18Z"/>';
const icon=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name]||iconPaths.pin}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
function readStorage(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function saveStorage(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
const storedFavorites=readStorage('juyu:favorites:v1',[]);
const storedFuel=readStorage('juyu:fuel:v1','B027');
const params=new URLSearchParams(location.search);
const requestedFuel=params.get('fuel')||storedFuel;
const state={fuel:FUEL_TYPES.some(f=>f.code===requestedFuel)?requestedFuel:'B027',view:'nearby',bounds:null,listLimit:60,center:{...APP_CONFIG.defaultCenter},envelope:null,all:[],visible:[],selected:null,query:'',brand:'',self:false,freshOnly:false,sort:'price',routeSort:'recommended',routeResultScope:'recommended',favorites:new Set(Array.isArray(storedFavorites)?storedFavorites.filter(v=>typeof v==='string'&&/^[\w-]{1,50}$/.test(v)).slice(0,500):[]),generation:0,controller:null,mapReady:false,mapFailed:false,searchGeneration:0,loading:false,driving:{active:false,phase:'off',point:null,heading:null,speed:0,accuracy:null,zoomMode:'auto'}};
const FUEL_VISUAL={B027:{label:'휘발유',icon:'droplet',tone:'gasoline'},D047:{label:'경유',icon:'pump',tone:'diesel'},B034:{label:'고급휘발유',icon:'star',tone:'premium'},K015:{label:'LPG',icon:'flame',tone:'lpg'}};
function syncMobileFuelToggle(){const item=FUEL_VISUAL[state.fuel]||FUEL_VISUAL.B027;const button=$('mobile-fuel-toggle'),label=$('mobile-fuel-label'),focusButton=$('focus-fuel-toggle'),focusLabel=$('focus-fuel-label');if(focusButton){focusButton.setAttribute('aria-label',`유종 선택, 현재 ${item.label}`);const focusBadge=focusButton.querySelector('.fuel-tab-icon');if(focusBadge){focusBadge.className='fuel-tab-icon '+item.tone;focusBadge.innerHTML='<span class="icon">'+icon(item.icon)+'</span>';}}if(focusLabel)focusLabel.textContent=item.label;document.querySelectorAll('[data-focus-fuel]').forEach(x=>{const active=x.dataset.focusFuel===state.fuel;x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active));x.setAttribute('aria-pressed',String(active));});if(!button||!label)return;button.setAttribute('aria-label',`유종 선택, 현재 ${item.label}`);label.textContent=item.label;const badge=button.querySelector('.fuel-tab-icon');if(badge){badge.className='fuel-tab-icon '+item.tone;badge.innerHTML='<span class="icon">'+icon(item.icon)+'</span>';}}
const localHost=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const androidApp=/JuyuhannunAndroid\//.test(navigator.userAgent);
const sharedId=params.get('station');
if(sharedId&&/^[\w-]{1,50}$/.test(sharedId)&&params.has('slat')&&params.has('slng')){const lat=Number(params.get('slat')),lng=Number(params.get('slng'));if(finite(lat)&&finite(lng)&&lat>=32&&lat<=40&&lng>=123&&lng<=133)state.center={lat,lng};}
const apiBase=(APP_CONFIG.apiBase||(localHost?'/api':'')).replace(/\/$/,'');
let toastTimer;
let detailGeneration=0;
let recordStats;
let priceSelection;
let dataRequest=null;
let lastDataCheckAt=0;
let drivingPredictionAt=0;
let drivingPredictionKey='';
let routeMode=null;
let routePickTarget=null;
let routeOriginRequest=null;
let nearbyMapSnapshot=null;
let lastLocatedPoint=null;
let listSelectionFrame=0;
let listFocusedStationId=null;
let routePlannerOpen=false;
let mobileComparisonRefreshRequested=true;
const DATA_REFRESH_MS=5*60*1000;
function collectionStats(){const now=Date.now(),minute=Math.floor(now/60000);if(recordStats?.source===state.all&&recordStats.fuel===state.fuel&&recordStats.minute===minute)return recordStats;let mapped=0,fresh=0;for(const station of state.all){if(!hasMapCoordinates(station))continue;mapped++;const p=getFuelPrice(station,state.fuel);if(p&&freshness(p.priceUpdatedAt,p.fetchedAt,now,p.priceTimeStatus,p.sourceDate).eligible)fresh++;}return recordStats={source:state.all,fuel:state.fuel,minute,mapped,fresh};}
function refreshPriceSelection(now){const sources=state.envelope?.sourceSnapshots,minute=Math.floor(now/60000);if(!sources||(priceSelection?.sources===sources&&priceSelection.minute===minute))return;state.all=reselectStationPrices(state.all,sources,{now});priceSelection={sources,minute};}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function showDialog(id){const d=$(id);if(!d.open)d.showModal();}
function closeDialog(id){$(id).close();}
function setMapNotice(message){$('map-notice').textContent=message;$('map-notice').hidden=!message;}
function updateViewport({center,bounds}){state.center=state.driving.active&&state.driving.point?{...state.driving.point}:center;state.bounds=bounds;state.listLimit=60;render();}
function handleMapState({provider,status,message}){const typeButton=$('map-type-toggle');typeButton.hidden=provider!=='naver';if(provider!=='naver'){typeButton.setAttribute('aria-pressed','false');typeButton.setAttribute('aria-label','지도 유형 전환 미지원');typeButton.title='지도 유형 전환 미지원';}else if(typeButton.getAttribute('aria-label')==='지도 유형 전환 미지원'){typeButton.setAttribute('aria-label','위성 지도 보기');typeButton.title='위성 지도 보기';}if(status==='error'||provider==='leaflet')setMapNotice(message||'대체 지도에서 확인하고 있습니다.');else if(status==='ready')setMapNotice('');}
const map=new MapController($('map'),{onViewportChange:updateViewport,onSelect:id=>selectStation(id),onDeselect:()=>clearStationSelection(),onPick:point=>handleRouteMapPick(point),onState:handleMapState,markerPresentation:row=>state.view==='route'&&finite(row.progressMeters)?{value:row.currentPrice?.price,unit:'원',label:`${row.name} · 경로 ${(row.progressMeters/1000).toFixed(1)}km 지점`,stale:row.confidence?.eligible!==true,rank:Number(row.routeRank)>=1&&Number(row.routeRank)<=3?Number(row.routeRank):null,badgeLabel:'추천 {rank}',tone:'green'}:null});
$('map')?.addEventListener('pointerdown',()=>{if(document.body.classList.contains('mobile-map-browse')||document.body.classList.contains('mobile-map-expanded'))setMobileMapMenuExpanded(false,{restartTimer:false});},{capture:true,passive:true});
const routeSimulation=createRouteSimulationController({host:$('route-simulation'),onPosition:(point,options)=>map.setRouteSimulationPoint(point,options),onClear:()=>map.clearRouteSimulationPoint()});
const mapLoading=createMapLoadingController($('map-loading'));
const mobileMapView=setupMobileMapView({workspace:document.querySelector('.workspace'),sidebar:$('station-sidebar'),mapSection:$('map-section'),results:$('results'),toggleButton:$('mobile-map-toggle'),listButton:$('mobile-list-toggle'),detailDialog:$('detail-dialog'),detailExpandButton:$('detail-expand-toggle'),detailHandle:$('detail-sheet-handle'),listSheetHandle:$('mobile-list-sheet-handle'),listSheetCollapseButton:$('mobile-list-sheet-collapse'),listSheetClose:$('mobile-list-sheet-close'),focusDock:$('mobile-focus-dock'),focusDockList:$('focus-dock-list'),onListBack:()=>{if(!hasRouteResults())return false;selectView('nearby');return true;},onResize:()=>map.resize(),onModeChange:next=>{if(!['focus-detail','expanded-tools','map-browse','list-sheet','list-sheet-expanded'].includes(next))return;if(['list-sheet','list-sheet-expanded'].includes(next)){listFocusedStationId=null;scheduleListScrollSelection();return;}listFocusedStationId=null;const station=state.all.find(s=>s.id===state.selected);if(station&&state.mapReady&&hasMapCoordinates(station))requestAnimationFrame(()=>map.focus(station,{preserveZoom:true}));},icon});
const viewTabs=document.querySelector('.view-tabs');
const mobileMapMenuToggle=$('mobile-map-menu-toggle');
const mobileSearchToggle=$('mobile-search-toggle');
const mobileSearchForm=$('search-form');
const mobileSearchCandidates=$('search-candidates');
const MOBILE_MAP_MENU_AUTO_COLLAPSE_MS=10_000;
let mobileMapMenuTimer=0;
function mobileSearchOpen(){return document.body.classList.contains('mobile-map-search-open');}
function currentMobileSearchTerm(){return $('query')?.value.trim()||'';}
function syncMobileSearchIndicator(){
 const term=currentMobileSearchTerm(),active=Boolean(term),searchAction=mobileSearchOpen()?'검색 닫기':'검색 열기',menuExpanded=mobileMapMenuToggle?.getAttribute('aria-expanded')==='true',menuAction=menuExpanded?'지도 메뉴 닫기':'지도 메뉴 펼치기';
 const searchLabel=$('mobile-search-label'),searchIndicator=$('mobile-search-indicator'),menuIndicator=$('mobile-menu-search-indicator');
 if(searchLabel)searchLabel.textContent=active?'검색됨':'검색';
 if(searchIndicator)searchIndicator.hidden=!active;
 if(menuIndicator)menuIndicator.hidden=!active;
 mobileSearchToggle?.classList.toggle('has-search-query',active);
 mobileMapMenuToggle?.classList.toggle('has-search-query',active);
 if(mobileSearchToggle){mobileSearchToggle.setAttribute('aria-label',active?`${searchAction}, 검색어 “${term}” 입력됨`:searchAction);mobileSearchToggle.title=active?`검색어 “${term}” 입력됨`:searchAction;}
 if(mobileMapMenuToggle){mobileMapMenuToggle.setAttribute('aria-label',active?`${menuAction}, 검색어 “${term}” 입력됨`:menuAction);mobileMapMenuToggle.title=active?`검색어 “${term}” 입력됨 · ${menuAction}`:menuAction;}
}
function setMobileSearchOpen(open,{focus=true}={}){
 const wasOpen=mobileSearchOpen();
 document.body.classList.toggle('mobile-map-search-open',open);
 if(mobileSearchToggle)mobileSearchToggle.setAttribute('aria-expanded',String(open));
 if(open){$('fuel-tabs')?.classList.remove('mobile-open');$('mobile-fuel-toggle')?.setAttribute('aria-expanded','false');if($('extra-filters'))$('extra-filters').hidden=true;$('toggle-filters')?.setAttribute('aria-expanded','false');if(focus)requestAnimationFrame(()=>$('query')?.focus({preventScroll:true}));}
 else if(wasOpen){++state.searchGeneration;if(mobileSearchCandidates)mobileSearchCandidates.hidden=true;}
 syncMobileSearchIndicator();
}
function mobileMapMenuPopoverOpen(){return mobileSearchOpen()||$('fuel-tabs')?.classList.contains('mobile-open')||$('extra-filters')?.hidden===false;}
function scheduleMobileMapMenuCollapse(){
 clearTimeout(mobileMapMenuTimer);
 mobileMapMenuTimer=setTimeout(()=>{if(mobileMapMenuPopoverOpen()){scheduleMobileMapMenuCollapse();return;}setMobileMapMenuExpanded(false,{restartTimer:false});},MOBILE_MAP_MENU_AUTO_COLLAPSE_MS);
}
function setMobileMapMenuExpanded(expanded,{restartTimer=true}={}){
 clearTimeout(mobileMapMenuTimer);document.body.classList.toggle('mobile-map-menu-collapsed',!expanded);
 if(mobileMapMenuToggle){mobileMapMenuToggle.setAttribute('aria-expanded',String(expanded));const label=$('mobile-map-menu-label');if(label){label.textContent='메뉴';label.hidden=true;}const glyph=mobileMapMenuToggle.querySelector('.icon');if(glyph)glyph.innerHTML=icon(expanded?'close':'menu');}
 if(!expanded){setMobileSearchOpen(false,{focus:false});$('fuel-tabs')?.classList.remove('mobile-open');$('mobile-fuel-toggle')?.setAttribute('aria-expanded','false');if($('extra-filters'))$('extra-filters').hidden=true;$('toggle-filters')?.setAttribute('aria-expanded','false');}
 else if(restartTimer)scheduleMobileMapMenuCollapse();
 syncMobileSearchIndicator();
}
function showMobileMapMenu(){setMobileMapMenuExpanded(true);}
for(const target of [viewTabs,$('mobile-fuel-toggle'),$('fuel-tabs'),$('toggle-filters'),$('extra-filters'),mobileSearchToggle,mobileSearchForm,mobileSearchCandidates])for(const eventName of ['pointerdown','focusin','keydown'])target?.addEventListener(eventName,showMobileMapMenu);
mobileMapMenuToggle?.addEventListener('click',()=>setMobileMapMenuExpanded(mobileMapMenuToggle.getAttribute('aria-expanded')!=='true'));
mobileSearchToggle?.addEventListener('click',()=>setMobileSearchOpen(!mobileSearchOpen()));
for(const target of [mobileSearchForm,mobileSearchCandidates])target?.addEventListener('focusout',()=>setTimeout(()=>{const active=document.activeElement;if(!mobileSearchForm?.contains(active)&&!mobileSearchCandidates?.contains(active)&&active!==mobileSearchToggle)setMobileSearchOpen(false,{focus:false});},0));
mobileSearchForm?.addEventListener('keydown',event=>{if(event.key!=='Escape')return;event.preventDefault();setMobileSearchOpen(false,{focus:false});mobileSearchToggle?.focus();});
document.addEventListener('pointerdown',event=>{if(!mobileSearchOpen()||event.target.closest?.('#mobile-search-toggle,#search-form,#search-candidates'))return;setMobileSearchOpen(false,{focus:false});},true);
setMobileMapMenuExpanded(true);

async function requestJSON(url,signal,options={}){
 const response=await fetch(url,{...options,signal,cache:'no-store',credentials:'omit',headers:{Accept:'application/json',...(options.headers||{})}});let data;
 try{data=await response.json();}catch{throw new Error('서버에서 올바른 자료를 받지 못했습니다.');}
 if(!response.ok){
  const error=new Error((typeof data?.error==='string'?data.error:data?.error?.message)||'자료를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  error.code=data?.error?.code??data?.code;error.retryable=data?.retryable===true;error.retryAfterMs=Number.isFinite(Number(data?.retryAfterMs))?Number(data.retryAfterMs):null;error.httpStatus=response.status;throw error;
 }
 return data;
}
routeMode=createRouteModeController({requestJSON});
function loadData(){
 if(dataRequest)return dataRequest;
 dataRequest=loadDataOnce().finally(()=>{dataRequest=null;});
 return dataRequest;
}
async function loadDataOnce(){
 const generation=++state.generation;const ctrl=new AbortController();state.controller=ctrl;state.loading=true;
 $('results').setAttribute('aria-busy','true');$('refresh').classList.add('busy');
 const timeout=setTimeout(()=>ctrl.abort(),30000);
 try{
  const data=await loadStationData({nationwideUrl:APP_CONFIG.nationwideDataUrl||'./data/nationwide/latest.json',regionalUrl:APP_CONFIG.dataUrl||'./data/stations.json',signal:ctrl.signal,previous:state.envelope});
  let highway=null;try{highway=await loadStaticJSON(`./data/highway.json?v=${Math.floor(Date.now()/60000)}`,{signal:ctrl.signal});}catch(error){if(error?.name==='AbortError')throw error;}
  if(generation!==state.generation)return;
  if(!Array.isArray(data.stations))throw new Error('가격 자료의 형식을 확인할 수 없습니다.');
  if(data.status==='error'&&!data.stations.length)throw new Error(data.error?.message||'가격 조회에 실패했습니다. 마지막으로 받은 자료를 표시합니다.');
  state.envelope={...data,highwaySnapshot:highway};
  const dedupe=new Map();for(const s of data.stations){if(s&&typeof s.id==='string'&&typeof s.name==='string')dedupe.set(s.id,s);}for(const s of highway?.stations||[]){if(!s||typeof s.id!=='string'||typeof s.name!=='string')continue;if(s.opinetStationId)dedupe.delete(s.opinetStationId);dedupe.set(s.id,s);}
  state.all=[...dedupe.values()];state.loading=false;render();if($('detail-dialog').open)renderDetail();
  const shareId=params.get('station');if(shareId&&!state.selected&&state.all.some(s=>s.id===shareId)){const st=state.all.find(s=>s.id===shareId);if(hasMapCoordinates(st)){state.center={lat:st.lat,lng:st.lng};if(state.mapReady)map.setCenter(state.center);}render();selectStation(shareId);}
 }catch(error){if(generation!==state.generation)return;state.loading=false;state.envelope={...state.envelope,status:'error',cache:{...state.envelope?.cache,stale:true},warnings:[error.name==='AbortError'?'자료 응답이 지연되고 있습니다. 다시 시도해 주세요.':error.message],error:{message:error.name==='AbortError'?'조회 시간이 초과되었습니다.':error.message}};render();}
 finally{clearTimeout(timeout);if(generation===state.generation){lastDataCheckAt=Date.now();state.loading=false;$('results').setAttribute('aria-busy','false');$('refresh').classList.remove('busy');}}
}
function bearingDegrees(a,b){
 const rad=Math.PI/180,lat1=a.lat*rad,lat2=b.lat*rad,dLng=(b.lng-a.lng)*rad;
 const y=Math.sin(dLng)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
 return (Math.atan2(y,x)/rad+360)%360;
}
function angleDelta(a,b){const d=Math.abs(((a-b+540)%360)-180);return Number.isFinite(d)?d:180;}
function drivingStationScore(station){
 if(!state.driving.active||!state.driving.point||!Number.isFinite(state.driving.heading)||!hasMapCoordinates(station))return Infinity;
 const here=state.driving.point,distance=distanceMeters(here,station),delta=angleDelta(bearingDegrees(here,station),state.driving.heading);
 return distance*(1+Math.min(2,delta/70));
}
function drivingMapStations(rows){
 if(!state.driving.active||!state.driving.point||!Number.isFinite(state.driving.heading))return rows;
 const here=state.driving.point,heading=state.driving.heading;
 return rows.filter(station=>{
   if(station.id===state.selected)return true;
   if(!hasMapCoordinates(station))return false;
   const distance=distanceMeters(here,station);
   if(distance<=450)return true;
   const cone=state.driving.speed>=16?78:state.driving.speed>=7?92:110;
   const limit=state.driving.speed>=16?10000:state.driving.speed>=7?7000:4500;
   return distance<=limit&&angleDelta(bearingDegrees(here,station),heading)<=cone;
 }).sort((a,b)=>drivingStationScore(a)-drivingStationScore(b));
}
function syncDrivingStationStatus(station=null){
 const host=$('driving-station-status'),name=$('driving-station-name');if(!host||!name)return;
 host.hidden=!state.driving.active;
 if(!state.driving.active)return;
 const label=station?.name||'진행 방향 주유소 확인 중';name.textContent=label;host.classList.toggle('is-searching',!station);host.title=station?.name?`현재 탐색 주유소: ${station.name}`:label;
}
function routeViewOptions(){return{sort:state.routeSort,brand:state.brand,selfOnly:state.self,freshOnly:state.freshOnly,maxDetourMinutes:Number($('route-max-detour')?.value||10)};}
function routeFallbackMapStations(now=Date.now()){
 return filterStations(state.all,{fuel:state.fuel,center:state.center,bounds:state.bounds,query:state.query,brand:state.brand,self:state.self,freshOnly:state.freshOnly,favorites:nearbyMapSnapshot?.sourceView==='saved'?state.favorites:null,sort:state.sort,now});
}
function activateScrolledStation(id){
 const station=state.all.find(row=>String(row.id)===String(id));
 if(!station||String(listFocusedStationId)===String(station.id))return;
 listFocusedStationId=station.id;
 state.selected=station.id;
 $('results').querySelectorAll('.station-card[data-station]').forEach(card=>{const active=String(card.dataset.station)===String(station.id);card.classList.toggle('selected',active);if(active)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');});
 if(state.mapReady&&hasMapCoordinates(station)){try{map.focus(station,{preserveZoom:true});}catch{}}
}
function syncListScrollSelection(){
 listSelectionFrame=0;
 if(!mobileMapView.isMobile()||!['list-sheet','list-sheet-expanded'].includes(mobileMapView.getMode()))return;
 const results=$('results'),viewport=results.getBoundingClientRect();
 const items=[...results.querySelectorAll('.station-card[data-station]')].map(card=>{const rect=card.getBoundingClientRect();return{id:card.dataset.station,top:rect.top,bottom:rect.bottom};});
 const id=pickListScrollStation(items,{top:viewport.top,bottom:viewport.bottom});
 if(id)activateScrolledStation(id);
}
function scheduleListScrollSelection(){if(listSelectionFrame)cancelAnimationFrame(listSelectionFrame);listSelectionFrame=requestAnimationFrame(syncListScrollSelection);}
function routePriceBasis(row){const price=row.currentPrice;if(['daily_current_file','daily_price_file'].includes(price?.priceTimeStatus))return price.sourceDate?`${price.sourceDate} 기준`:'기준일 미확인';return formatTime(price?.priceUpdatedAt,true);}
function routeCard(row,index,{lowest,fastestId}={}){
 const saved=state.favorites.has(row.id),verified=row.detour?.verified===true,extraKm=verified?(row.detour.distanceMeters/1000).toFixed(1):null,extraMinutes=verified?Math.ceil(row.detour.durationSeconds/60):null;
 const brand=brandVisual(row.brand,row.brandName);
 const brandBadge=brand.image?`<span class="brand-badge has-logo" data-brand="${esc(row.brand)}" title="${esc(brand.label)}"><img src="${esc(brand.image)}" alt=""></span>`:`<span class="brand-badge" style="background:${esc(brand.color)};color:${esc(brand.ink)}" title="${esc(brand.label)}">${esc(brand.short)}</span>`;
 const rank=Number(row.routeRank)>=1&&Number(row.routeRank)<=3?`<span class="route-rank rank-${Number(row.routeRank)}">추천 ${Number(row.routeRank)}</span>`:'',lowestBadge=row.confidence?.eligible&&row.currentPrice.price===lowest?'<span class="route-lowest">경로 최저가</span>':'',fastestBadge=verified&&String(row.id)===String(fastestId)?'<span class="route-fastest">우회 최소</span>':'';
 const detour=verified?`<span>우회 +${extraMinutes}분</span><small>거리 +${extraKm}km</small>`:'<span>경로 인근 주유소</span><small>우회시간 미확인</small>';
 const proximity=finite(row.proximityMeters)?` · 경로에서 직선 ${(row.proximityMeters/1000).toFixed(1)}km`:'';
 const reason=verified?(row.routeRank===1?'우회가 적고 가격이 낮은 추천 주유소':'실제 자동차 경유 경로 확인됨'):'실제 경유 경로를 아직 확인하지 못했습니다';
 const nav=routeMode.navigationForStation(row.id);
 return `<article class="station-card route-station-card${state.selected===row.id?' selected':''}${row.confidence?.eligible?'':' is-reference'}" data-station="${esc(row.id)}"><button class="card-main" data-action="detail" data-id="${esc(row.id)}" aria-label="${esc(row.name)} 상세 보기"><div class="route-card-badges">${rank}${fastestBadge}${lowestBadge}<span class="route-progress">출발 후 ${(row.progressMeters/1000).toFixed(1)}km</span></div><div class="card-top"><span class="station-number">${index+1}</span>${brandBadge}<h3 class="station-name">${esc(row.name)}</h3><div class="card-price">${money(row.currentPrice.price)}<small>원/L</small></div></div><div class="route-detour${verified?' verified':''}">${detour}</div><p class="route-reason">${esc(reason+proximity)}</p><p class="route-price-date">가격 ${esc(routePriceBasis(row))} · ${esc(row.confidence?.eligible?'추천 가능':'참고 가격 · 추천 제외')}</p></button><div class="card-bottom"><span class="confidence ${esc(row.confidence?.state||'unknown')}">${esc(row.confidence?.label||'가격 기준 확인 필요')}</span><div class="card-actions">${nav?`<button class="route-navigation-button" data-action="route-nav" data-id="${esc(row.id)}" aria-label="카카오맵에서 ${esc(row.name)} 경유 길안내">${icon('route')}경유 길안내</button>`:''}<button data-action="save" data-id="${esc(row.id)}" class="${saved?'is-saved':''}" aria-label="${esc(row.name)} ${saved?'찜 해제':'찜하기'}" aria-pressed="${saved}">${icon('heart')}</button></div></div></article>`;
}
function renderRoutePanelState(rows){
 const response=routeMode.state.response,summary=$('route-summary'),chips=$('route-sort-chips'),status=$('route-api-state'),submit=$('route-submit');
 const originReady=Boolean(routeMode.state.origin),destinationReady=Boolean(routeMode.state.destination),routeReady=Boolean(response?.baseRoute),panel=$('route-panel');
 panel.classList.toggle('has-origin',originReady);panel.classList.toggle('has-destination',destinationReady);panel.classList.toggle('has-route',routeReady);
 $('route-origin-card')?.classList.toggle('is-ready',originReady);$('route-destination-card')?.classList.toggle('is-ready',destinationReady);
 const activeStep=routeReady?'results':destinationReady?'options':'destination',stepOrder=['destination','options','results'],activeIndex=stepOrder.indexOf(activeStep);
 document.querySelectorAll('[data-route-step]').forEach(step=>{const index=stepOrder.indexOf(step.dataset.routeStep),current=index===activeIndex;step.classList.toggle('is-current',current);step.classList.toggle('is-done',index<activeIndex);if(current)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});
 $('route-origin-label').textContent=routeMode.state.originLabel||'현재 위치를 허용하거나 출발지를 변경해 주세요';
 $('route-destination-label').textContent=routeMode.state.destinationLabel||'목적지를 검색하거나 지도에서 선택해 주세요';
 $('route-options-summary').textContent=`경로 ${Number($('route-corridor').value)/1000}km 이내 · 최대 ${$('route-max-detour').value}분 우회`;
 submit.disabled=routeMode.state.loading||!routeMode.state.origin||!routeMode.state.destination;
 if(!routeMode.state.loading)submit.innerHTML=destinationReady?'이 경로의 주유소 보기 <span aria-hidden="true">→</span>':'목적지를 먼저 선택해 주세요 <span aria-hidden="true">→</span>';
 if(routeMode.state.loading){status.textContent='기본 경로와 실제 경유 경로를 확인하고 있습니다…';summary.hidden=true;chips.hidden=true;return;}
 if(routeMode.state.error&&!response?.baseRoute){status.textContent=routeMode.state.error.message;status.classList.add('error');summary.hidden=true;chips.hidden=true;return;}
 status.classList.remove('error');
 if(!response?.baseRoute){status.textContent='목적지를 선택하면 실제 경로의 주유소와 우회시간을 확인합니다.';summary.hidden=true;chips.hidden=true;return;}
 const base=response.baseRoute;summary.hidden=false;summary.innerHTML=`<strong>${esc(routeMode.state.originLabel||'출발지')} → ${esc(routeMode.state.destinationLabel||'목적지')}</strong><span>${(base.distanceMeters/1000).toFixed(1)}km · 약 ${Math.ceil(base.durationSeconds/60)}분</span><span>경로상 주유소 ${Number(response.candidateCount||0).toLocaleString('ko-KR')}곳 · 우회시간 확인 ${Number(response.checkedCount||0).toLocaleString('ko-KR')}곳</span>`;
 chips.hidden=!rows.length;status.textContent=response.status==='partial'?'일부 주유소는 우회시간을 확인하지 못해 경로 인근 후보로만 표시합니다.':'추천은 실제 우회가 적은 순, 같은 수준이면 가격이 낮은 순입니다.';
 document.querySelectorAll('[data-route-sort]').forEach(button=>button.classList.toggle('active',button.dataset.routeSort===state.routeSort));
}
function syncRouteResultsToggle({total=0,recommended=0,ready=false}={}){
 const button=$('route-results-toggle');if(!button)return;
 const recommendationOnly=state.routeResultScope==='recommended',available=ready&&recommended>0&&total>recommended;
 button.hidden=!available;
 button.setAttribute('aria-pressed',String(recommendationOnly));
 button.setAttribute('aria-label',recommendationOnly?'추천 주유소만 표시 중, 전체 주유소 보기':'전체 주유소 표시 중, 추천 주유소만 보기');
 button.title=recommendationOnly?`추천 ${recommended.toLocaleString('ko-KR')}곳만 표시 중 · 전체 ${total.toLocaleString('ko-KR')}곳 보기`:`전체 ${total.toLocaleString('ko-KR')}곳 표시 중 · 추천 ${recommended.toLocaleString('ko-KR')}곳만 보기`;
 button.innerHTML=`<span class="icon">${icon(recommendationOnly?'star':'list')}</span><span class="route-results-toggle-label">${recommendationOnly?`추천 ${recommended}`:`전체 ${total}`}</span>`;
}
function renderRouteView(){
 refreshPriceSelection(Date.now());routeMode.syncStations(state.all,state.fuel);routeMode.refreshConfidence(state.fuel);
 const allRows=routeMode.rows(routeViewOptions()),recommendedRows=selectRouteDisplayRows(allRows,'recommended'),response=routeMode.state.response;
 if(state.routeResultScope==='recommended'&&allRows.length&&!recommendedRows.length)state.routeResultScope='all';
 const rows=selectRouteDisplayRows(allRows,state.routeResultScope);state.visible=rows;
 const drivingStation=state.driving.point&&Number.isFinite(state.driving.heading)?drivingMapStations(rows)[0]:null;syncDrivingStationStatus(drivingStation);
 syncRouteResultsToggle({total:allRows.length,recommended:recommendedRows.length,ready:Boolean(response?.baseRoute)});
 $('result-count').textContent=rows.length.toLocaleString('ko-KR');$('results-title').textContent='가는 길 주유소';syncFocusDockList(rows.length,{routeResults:Boolean(routeMode.state.response?.baseRoute)});
 const scopeSummary=state.routeResultScope==='recommended'?`추천 ${rows.length.toLocaleString('ko-KR')}곳 · 전체 ${allRows.length.toLocaleString('ko-KR')}곳`:`전체 ${rows.length.toLocaleString('ko-KR')}곳 · 추천 ${recommendedRows.length.toLocaleString('ko-KR')}곳`;
 $('coverage-hint').textContent=state.driving.active?`주행 탐색 · ${drivingStation?.name||'주유소 확인 중'} · ${scopeSummary}`:response?.baseRoute?`${scopeSummary} · 우회 검증 ${Number(response.checkedCount||0).toLocaleString('ko-KR')}곳 · 지도 이동과 무관`:'목적지를 선택하면 실제 자동차 경로 주변 후보를 표시합니다.';
 if(routeMode.state.loading)$('results').innerHTML='<div class="loading-state"><div class="spinner"></div><h3>가는 길의 주유소를 확인하고 있어요</h3><p>기본경로 1회와 우선 후보의 실제 경유 경로를 비교합니다.</p></div>';
 else if(!rows.length){const message=routeMode.state.error?.message||(response?.baseRoute?'조건에 맞는 경로상 주유소가 없습니다. 탐색 조건에서 거리나 우회시간을 넓혀 보세요.':'목적지를 선택한 뒤 경로상 주유소 보기를 눌러 주세요.');$('results').innerHTML=`<div class="empty-state"><div class="empty-icon">${icon('route')}</div><h3>목적지 가는 길의 주유소</h3><p>${esc(message)}</p></div>`;}
 else{const comparable=rows.filter(row=>row.confidence?.eligible),lowest=comparable.length?Math.min(...comparable.map(row=>row.currentPrice.price)):null,verified=comparable.filter(row=>row.detour?.verified&&finite(row.detour.durationSeconds)),fastest=verified.sort((a,b)=>a.detour.durationSeconds-b.detour.durationSeconds||a.currentPrice.price-b.currentPrice.price)[0];$('results').innerHTML=rows.map((row,index)=>routeCard(row,index,{lowest,fastestId:fastest?.id})).join('');}
 if(state.mapReady&&!routeMode.state.loading){const mapRows=rows.length?rows:routeFallbackMapStations();map.setStations(mapRows,rows.length?state.selected:null,state.fuel);}
 const comparable=rows.filter(row=>row.confidence?.eligible),lowest=comparable.length?Math.min(...comparable.map(row=>row.currentPrice.price)):null;
 $('lowest-price-label').textContent=state.routeResultScope==='recommended'?'추천 최저가':'경로상 최저가';$('lowest-price').textContent=money(lowest);$('summary-area').textContent=state.routeResultScope==='recommended'?`목적지 가는 길 · 추천 ${rows.length.toLocaleString('ko-KR')}곳`:'목적지 가는 길 · 전체 주유소';$('summary-caption').textContent=lowest?`${FUEL_TYPES.find(f=>f.code===state.fuel)?.name||'유종'} · 우회시간 확인 ${Number(response?.checkedCount||0)}곳 · 참고 가격 제외`:'경로에서 확인 가능한 최신 가격이 없습니다';
 renderRoutePanelState(rows);renderStatus();scheduleListScrollSelection();
}
function render(){
 if(state.view==='route'){renderRouteView();return;}
 syncRouteResultsToggle();
 const now=Date.now();refreshPriceSelection(now);
 let filtered=filterStations(state.all,{fuel:state.fuel,center:state.center,bounds:state.bounds,query:state.query,brand:state.brand,self:state.self,freshOnly:state.freshOnly,favorites:state.view==='saved'?state.favorites:null,sort:state.sort,now});
 if(state.driving.active)filtered=drivingMapStations(filtered);
 const drivingStation=state.driving.point&&Number.isFinite(state.driving.heading)?filtered[0]:null;syncDrivingStationStatus(drivingStation);
 state.visible=filtered;
 $('result-count').textContent=filtered.length;
 $('results-title').textContent=state.view==='saved'?'찜한 주유소':'지도 안 주유소';
 syncFocusDockList(filtered.length);
 const total=state.envelope?.coverage?.totalPriceStations??state.all.length,mapped=collectionStats().mapped,summary=summarizeVisiblePrices(filtered);
 $('coverage-hint').textContent=state.driving.active?`주행방향 우선 ${filtered.length.toLocaleString('ko-KR')}곳 · 탐색 ${drivingStation?.name||'주유소 확인 중'} · 파랑=이동동선 · 초록 점선=예측동선`:`현재 지도 ${filtered.length.toLocaleString('ko-KR')}곳 · 최신 비교 ${summary.comparable.toLocaleString('ko-KR')}곳 · 좌표 ${mapped.toLocaleString('ko-KR')}/${total.toLocaleString('ko-KR')}곳 확보`;
 if(!filtered.length)renderEmpty();else{const shown=filtered.slice(0,state.listLimit);$('results').innerHTML=shown.map((s,i)=>card(s,i)+([5,11,17].includes(i)?`<div class="station-detail-ad" data-list-ad="${[5,11,17].indexOf(i)}" aria-label="광고"></div>`:'')).join('')+(filtered.length>state.listLimit?`<button class="load-more" data-action="load-more">${Math.min(60,filtered.length-state.listLimit)}곳 더 보기 · ${state.listLimit.toLocaleString('ko-KR')}/${filtered.length.toLocaleString('ko-KR')}곳</button>`:'');mountStationListAds($('results').querySelectorAll('[data-list-ad]'));}
 if(state.mapReady){const refreshComparison=!mobileMapView.isMobile()||mobileComparisonRefreshRequested;map.setStations(filtered,state.selected,state.fuel,{refreshComparison});if(refreshComparison)mobileComparisonRefreshRequested=false;}
 const cheapest=summary.lowest;
 $('lowest-price-label').textContent='비교 가능한 최저가';$('lowest-price').textContent=money(cheapest);$('summary-area').textContent='현재 지도 영역 · 검색 조건 기준';
 $('summary-caption').textContent=cheapest?`${FUEL_TYPES.find(f=>f.code===state.fuel).name} · 최신 비교 ${summary.comparable}곳${summary.reference?` · 참고 가격 ${summary.reference}곳 제외`:''}${state.envelope?.coverage?.complete===false?' · 일부 자료':''}`:filtered.length?`표시된 ${filtered.length}곳은 참고 가격입니다 · 최저가 비교 제외`:'현재 지도에서 비교 가능한 가격이 없습니다';
 renderStatus();scheduleListScrollSelection();
}
function renderStatus(){
 const e=state.envelope,fresh=collectionStats().fresh;
 let title='가격 자료 연결 대기',description='공식 가격 자료가 연결되면 이곳에서 비교할 수 있어요.',cls='pending';
 if(e?.status==='error'){title='가격 자료를 다시 확인해 주세요';description=state.all.length?'마지막으로 받은 자료를 표시합니다. 가격 기준시각을 확인하세요.':e.error?.message||'잠시 후 다시 시도해 주세요.';cls='error';}
 else if(e?.status==='ready'||e?.status==='partial'){
  title=fresh?`전체 지도 자료 · 최신 비교 ${fresh.toLocaleString('ko-KR')}곳`:'마지막 수집 가격을 참고용으로 표시합니다';cls=fresh?'':'pending';
  const national=e.sourceSnapshots?.nationwide,regional=e.sourceSnapshots?.regional;
  const parts=[];
  if(national?.stations?.length){parts.push(`전국 기준 ${national.coverage?.priceDate||'미확인'} · 수집 ${formatTime(national.fetchedAt,true)}`);if(national.cache?.stale||national.downloadError)parts.push('전국 갱신 지연');}
  if(regional?.stations?.length){parts.push(`지역 수집 ${formatTime(regional.fetchedAt,true)}`);if(regional.cache?.stale||regional.downloadError)parts.push('지역 갱신 지연');}
  if(!parts.length)parts.push(`수집 ${formatTime(e.fetchedAt,true)}`);
  if(e.downloadErrors?.length)parts.push('일부 자료 연결 지연');
  parts.push('5분마다 새 자료 확인');description=parts.join(' · ');
  if(!state.all.length){title='받은 가격 자료가 없어요';description=`마지막 조회 ${formatTime(e.lastAttempt?.at||e.fetchedAt,true)} · 가격 자료 0건`;}
 }
 $('data-status').innerHTML=`<span class="status-indicator ${cls}"></span><div><strong>${esc(title)}</strong><span>${esc(description)}</span></div><button class="icon-button${state.loading?' busy':''}" id="refresh" aria-label="가격 자료 새로고침"><span class="icon">${icon('refresh')}</span></button>`;
 $('refresh').addEventListener('click',loadData);
}
function card(s,index){
 const brand=brandVisual(s.brand,BRANDS[s.brand]||s.brand);
 const brandBadge=brand.image?`<span class="brand-badge has-logo" data-brand="${esc(s.brand)}" title="${esc(brand.label)}"><img src="${esc(brand.image)}" alt=""></span>`:`<span class="brand-badge" style="background:${esc(brand.color)};color:${esc(brand.ink)}" title="${esc(brand.label)}">${esc(brand.short)}</span>`;
 const saved=state.favorites.has(s.id),mapped=hasMapCoordinates(s),address=s.roadAddress||s.address||'주소 정보 미제공';
 const other=FUEL_TYPES.filter(f=>f.code!==state.fuel).map(f=>{const p=getFuelPrice(s,f.code);if(!p)return null;const eligible=freshness(p.priceUpdatedAt,p.fetchedAt,Date.now(),p.priceTimeStatus,p.sourceDate).eligible;return `${f.name} ${money(p.price)}${eligible?'':' (참고)'}`;}).filter(Boolean).join(' · ');
 const date=['daily_current_file','daily_price_file'].includes(s.currentPrice.priceTimeStatus)?s.currentPrice.sourceDate||'기준일 미확인':formatTime(s.currentPrice.priceUpdatedAt);
 return `<article class="station-card${state.selected===s.id?' selected':''}${s.confidence.eligible?'':' is-reference'}" data-station="${esc(s.id)}"><button class="card-main" data-action="detail" data-id="${esc(s.id)}" aria-label="${esc(s.name)} 상세 보기"><div class="card-top"><span class="station-number">${index+1}</span>${brandBadge}<h3 class="station-name">${esc(s.name)}</h3><div class="card-price">${money(s.currentPrice.price)}<small>원/L</small></div></div><div class="card-sub"><span>${esc(brand.label)}</span><span>${esc(s.facilities?.self===true?'셀프':s.facilities?.self===false?'일반':'셀프 미확인')}</span><span class="distance-label">${mapped?`직선 ${(s.distance/1000).toFixed(1)}km`:'지도 좌표 확인 중'}</span></div><p class="card-address" title="${esc(address)}">${esc(address)}</p>${other?`<p class="card-other-prices" title="${esc(other)} 원/L">${esc(other)} <small>원/L</small></p>`:''}</button><div class="card-bottom"><span class="confidence ${s.confidence.state}" title="가격 기준 ${esc(date)}">${esc(s.confidence.label)}${s.confidence.eligible?'':' · 참고 가격'}</span><div class="card-actions"><button data-action="share" data-id="${esc(s.id)}" aria-label="${esc(s.name)} 공유">${icon('share')}</button><button data-action="save" data-id="${esc(s.id)}" class="${saved?'is-saved':''}" aria-label="${esc(s.name)} ${saved?'찜 해제':'찜하기'}" aria-pressed="${saved}">${icon('heart')}</button></div></div></article>`;
}
function renderEmpty(){
 if(!state.mapReady){$('results').innerHTML=state.mapFailed?'<div class="empty-state"><h3>지도를 연결하지 못했어요</h3><p>지도 연결 후 화면 안의 주유소를 확인할 수 있습니다.</p></div>':'<div class="loading-state"><div class="spinner"></div><h3>지도 영역을 확인하고 있어요</h3><p>지도가 준비되면 화면 안의 주유소를 표시합니다.</p></div>';return;}
 const e=state.envelope;let title='현재 지도 안에 맞는 주유소가 없어요',desc='지도를 이동·축소하거나 검색 조건을 바꿔 보세요.',buttons='<button class="small-button" data-action="reset-filters">검색 조건 초기화</button>';
 if(e?.status==='awaiting_credentials'||!e){title='정확한 가격을 준비하고 있어요';desc='아직 연결된 공식 가격 자료가 없습니다.<br>현재 가격은 오피넷에서 확인해 주세요.';buttons='<a class="small-button" href="https://www.opinet.co.kr/" target="_blank" rel="noopener noreferrer">오피넷에서 가격 확인 ↗</a>';}
 else if(e.status==='error'&&!state.all.length){title='가격 자료를 가져오지 못했어요';desc='연결 상태를 확인한 뒤 다시 시도해 주세요.';buttons='<button class="small-button" data-action="retry">다시 시도</button>';}
 else if(state.view==='saved'){title=state.favorites.size?'이 조건에 맞는 찜한 곳이 없어요':'자주 가는 주유소를 모아 보세요';desc=state.favorites.size?'다른 지역으로 이동하거나 유종·필터를 확인해 주세요.':'주유소의 하트를 누르면 여기에 저장됩니다.';}
 else if(!state.all.length&&e.coverage?.kind==='sample_zones'){title='수집된 주유소 가격이 없어요';desc='지정한 수집 지역에서 가격 자료를 받지 못했습니다.<br>잠시 후 다시 확인하거나 오피넷을 이용해 주세요.';buttons='<button class="small-button" data-action="retry">다시 확인</button><a class="small-button secondary" href="https://www.opinet.co.kr/" target="_blank" rel="noopener noreferrer">오피넷에서 확인 ↗</a>';}
 else if(state.freshOnly&&filterStations(state.all,{fuel:state.fuel,center:state.center,bounds:state.bounds,query:state.query,brand:state.brand,self:state.self,freshOnly:false}).length){title='최신 비교 기준을 충족한 가격이 없어요';desc='현재 최신 가격만 보기 필터가 켜져 있습니다.<br>마지막 수집 가격은 참고용으로 살펴볼 수 있어요.';buttons='<button class="small-button" data-action="show-old">오래된 가격도 살펴보기</button>';}
 else if(e.coverage?.kind==='sample_zones'){title='아직 가격이 수집되지 않은 지역이에요';desc='현재는 지정한 지역의 일부 자료를 제공합니다.<br>지도 중심을 수집 지역으로 이동해 보세요.';const zones=(e.coverage.zones||[]).filter((z,i,a)=>a.findIndex(x=>x.id===z.id)===i).slice(0,5);buttons=zones.map(z=>`<button class="small-button" data-action="zone" data-zone="${esc(z.id)}">${esc(z.name||z.id)}</button>`).join('')||'<a class="small-button" href="https://www.opinet.co.kr/" target="_blank" rel="noopener noreferrer">오피넷에서 확인 ↗</a>';}
 $('results').innerHTML=`<div class="empty-state"><div class="empty-icon">${icon(state.view==='saved'?'heart':'pump')}</div><h3>${title}</h3><p>${desc}</p><div class="empty-actions">${buttons}</div>${e?.status==='awaiting_credentials'?'<p class="note">가격 기준시각이 확인되는 자료만 비교합니다.</p>':''}</div>`;
}
function toggleFavorite(id){if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);saveStorage('juyu:favorites:v1',[...state.favorites].slice(-500));render();if($('detail-dialog').open)renderDetail();}
function useBaseRouteSimulation(response=routeMode.state.response){
 const base=response?.baseRoute;
 if(!base?.path?.length){routeSimulation.set(null);return;}
 routeSimulation.set({path:base.path,durationSeconds:base.durationSeconds,label:`${routeMode.state.originLabel||'출발지'} → ${routeMode.state.destinationLabel||'목적지'}`});
}
function useStationRouteSimulation(row,station){
 const base=routeMode.state.response?.baseRoute;
 if(!row?.viaPath?.length||!base||row.detour?.verified!==true){useBaseRouteSimulation();return;}
 routeSimulation.set({path:row.viaPath,durationSeconds:base.durationSeconds+row.detour.durationSeconds,label:`${station.name} 경유 모의주행`,stops:[{id:station.id,name:station.name,point:{lat:station.lat,lng:station.lng}}]});
}
function hasRouteResults(){return state.view==='route'&&Boolean(routeMode?.state.response?.baseRoute);}
function isRoutePlannerVisible(){return state.view==='route'&&(!hasRouteResults()||routePlannerOpen);}
function syncRouteTransitionUI(){
 const routeResults=hasRouteResults(),plannerVisible=isRoutePlannerVisible();
 document.body.classList.toggle('route-results-ready',routeResults);
 document.body.classList.toggle('route-planner-open',plannerVisible);
 $('route-panel').hidden=!plannerVisible;
 const sheetTitle=$('mobile-list-sheet-title'),sheetBack=$('mobile-list-sheet-close');
 if(sheetTitle)sheetTitle.textContent=routeResults?'가는 길 주유소':'주유소 목록';
 if(sheetBack){const label=routeResults?'가는 길 종료하고 지도 안 주유소로 돌아가기':'지도로 돌아가기';sheetBack.setAttribute('aria-label',label);sheetBack.title=label;}
 const more=$('focus-dock-more'),moreIcon=$('focus-dock-more-icon'),moreLabel=$('focus-dock-more-label');
 if(!more||!moreIcon||!moreLabel)return;
 if(routeResults){
  const label=plannerVisible?'지도 결과 보기':'경로 변경';
  moreIcon.innerHTML=icon(plannerVisible?'map':'route');moreLabel.textContent=label;more.classList.add('route-transition-control');
  more.setAttribute('aria-label',label);more.title=label;
 }else{
  moreIcon.textContent='•••';moreLabel.textContent='더보기';more.classList.remove('route-transition-control');
  more.setAttribute('aria-label','이용 안내 더보기');more.title='이용 안내 더보기';
 }
}
function openRoutePlanner(){
 routePlannerOpen=true;
 if(state.view!=='route')selectView('route');
 else{
  if(mobileMapView.isMobile()){
   const mode=mobileMapView.getMode();
   if(['list-sheet','list-sheet-expanded'].includes(mode))mobileMapView.closeListSheet();
   else mobileMapView.startMobileExpanded();
  }
  render();
 }
 if(mobileMapView.isMobile())setMobileMapMenuExpanded(false,{restartTimer:false});
 requestAnimationFrame(()=>$('route-destination-query')?.focus({preventScroll:true}));
}
function closeRoutePlanner(){
 if(!hasRouteResults())return;
 routePlannerOpen=false;
 if(mobileMapView.isMobile())mobileMapView.startMobileExpanded();
 render();
}
function closeRoutePanel(){
 if(hasRouteResults()){closeRoutePlanner();return;}
 selectView('nearby');
}
function exitRouteMode(){
 if(state.view!=='route')return;
 selectView('nearby');
 toast('가는 길 찾기를 종료했습니다.');
}
function selectView(view){
 showMobileMapMenu();mobileMapView.exit({restoreFocus:false});const next=['nearby','route','saved'].includes(view)?view:'nearby';
 if(next==='route'&&state.view!=='route'){
  let center={...state.center},zoom=null;
  if(state.mapReady){try{center=map.getCenter()||center;zoom=map.getZoom();}catch{}}
  nearbyMapSnapshot={center,zoom,selected:state.selected,scrollTop:$('results').scrollTop,sourceView:state.view};
  state.selected=null;
  if(!routeMode.state.origin&&lastLocatedPoint)routeMode.setPoint('origin',lastLocatedPoint,'현재 위치');
 }
 const leavingRoute=state.view==='route'&&next!=='route';state.view=next;if(leavingRoute)routePlannerOpen=false;if(next==='route'&&!routeMode.state.response?.baseRoute)routePlannerOpen=true;document.body.classList.toggle('route-mode',next==='route');
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);if(b.dataset.view===state.view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 if(leavingRoute){routeSimulation.set(null);if(state.mapReady){map.clearRoute();if(nearbyMapSnapshot?.center){state.center={...nearbyMapSnapshot.center};map.setCenter(nearbyMapSnapshot.center);if(Number.isFinite(nearbyMapSnapshot.zoom))map.setZoom(nearbyMapSnapshot.zoom);}state.selected=nearbyMapSnapshot?.selected||null;}}
 if(next==='route'&&routeMode.state.response?.baseRoute?.path){if(state.mapReady)map.showRoute(routeMode.state.response.baseRoute.path,{kind:'base',fitBounds:true,origin:routeMode.state.origin,destination:routeMode.state.destination});useBaseRouteSimulation();}
 render();
 if(next==='route')requestAnimationFrame(()=>{if(!routeMode.state.origin)useCurrentLocationForRoute({announce:false});if(!routeMode.state.destination)$('route-destination-query')?.focus({preventScroll:true});});
 if(leavingRoute&&nearbyMapSnapshot)requestAnimationFrame(()=>{$('results').scrollTop=nearbyMapSnapshot.scrollTop||0;});
}
async function selectStation(id){const detailRevision=++detailGeneration,dataRevision=state.generation;const station=state.all.find(s=>s.id===id);if(!station)return;state.selected=id;if(state.view==='route'){const routeRow=state.visible.find(row=>String(row.id)===String(id))||routeMode.routeForStation(id);if(routeRow?.viaPath?.length>1){map.showRoute(routeRow.viaPath,{kind:'via',fitBounds:false});useStationRouteSimulation(routeRow,station);}else{map.clearRoute('via');useBaseRouteSimulation();}}const mobileFocus=mobileMapView.enterDetail();render();renderDetail();const focusSelected=()=>{if(state.mapReady&&hasMapCoordinates(station)&&state.selected===id)map.focus(station,{preserveZoom:true});};if(mobileFocus)mobileMapView.afterLayout(focusSelected);else{focusSelected();showDialog('detail-dialog');}if(apiBase){const fuel=state.fuel;try{const result=await requestJSON(`${apiBase}/stations/${encodeURIComponent(id)}?fuel=${fuel}`,AbortSignal.timeout(15000));if(detailRevision!==detailGeneration||dataRevision!==state.generation||state.selected!==id||state.fuel!==fuel)return;if(result.station?.id===id&&result.status==='ready'){state.all=mergeStationData({status:'ready',stations:state.all},{status:'ready',provider:result.provider,source:result.source,stations:[result.station]}).stations;render();if($('detail-dialog').open)renderDetail();}}catch{if(detailRevision===detailGeneration&&dataRevision===state.generation&&state.selected===id&&$('detail-dialog').open)toast('상세 가격 갱신에 실패했습니다. 표시된 기준시각을 확인해 주세요.');}}}
function clearStationSelection(){
 if(routePickTarget||!state.selected)return;
 ++detailGeneration;state.selected=null;listFocusedStationId=null;
 if($('detail-dialog')?.open){if(mobileMapView.isMobile())mobileMapView.closeDetail();else closeDialog('detail-dialog');}
 if(state.view==='route'){map.clearRoute('via');useBaseRouteSimulation();}
 render();
}
function detailPrice(station,code,label,tone){
 const info=getFuelPrice(station,code);
 const date=info?.sourceDate||info?.priceUpdatedAt;
 const dateLabel=date?String(date).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1.$2.$3').slice(0,10):'가격 미제공';
 return `<div class="fuel-price-card fuel-price-${tone}"><span class="fuel-price-label"><i></i>${esc(label)}</span><strong>${info?money(info.price):'—'}<small>${info?'원':''}</small></strong><span class="fuel-price-date">${esc(info?dateLabel+' 기준':'가격 미제공')}</span></div>`;
}
function syncFocusDockList(count,{routeResults=false}={}){
 const button=$('focus-dock-list'),label=$('focus-dock-list-label'),glyph=$('focus-dock-list-icon'),counter=$('focus-list-count');
 if(button&&label&&glyph&&counter){
  const value=Number(count)||0,text=value.toLocaleString('ko-KR'),route=routeResults&&state.view==='route';
  label.textContent=route?'가는 길 목록':'목록';counter.textContent=text;glyph.innerHTML=icon(route?'route':'list');
  button.classList.toggle('route-result-return',route);
  button.setAttribute('aria-label',route?`가는 길 주유소 목록 ${text}곳 열기`:`주유소 목록 ${text}곳 열기`);
  button.title=route?'가는 길 주유소 목록으로 돌아가기':'주유소 목록 열기';
 }
 syncRouteTransitionUI();
}
function openFocusList(){state.listLimit=60;render();mobileMapView.openListSheet();}
function stationRegion(station){
 const address=String(station.roadAddress||station.address||'').trim();
 return address.split(/\s+/).slice(0,2).join(' ')||'지역 미확인';
}
function stationHours(station){
 const raw=station.openingHours||station.operatingHours||station.hours||station.businessHours;
 return raw?String(raw):'운영시간 정보 미제공';
}
function renderDetail(){
 const station=state.all.find(s=>s.id===state.selected);if(!station){closeDialog('detail-dialog');return;}
 const selectedPrice=getFuelPrice(station,state.fuel),confidence=selectedPrice?freshness(selectedPrice.priceUpdatedAt,selectedPrice.fetchedAt,Date.now(),selectedPrice.priceTimeStatus,selectedPrice.sourceDate):{state:'unknown',label:'선택한 유종 가격 없음',eligible:false};
 const brandVisualInfo=brandVisual(station.brand,BRANDS[station.brand]||station.brand||'상표 미확인'),brand=brandVisualInfo.label;
 const detailBrandLogo=brandVisualInfo.image?`<span class="focus-brand-logo" data-brand="${esc(station.brand)}" title="${esc(brand)}"><img src="${esc(brandVisualInfo.image)}" alt=""></span>`:'<span class="brand-flame">●</span>';
 const f=station.facilities||{},facilityLabels=[f.self===true?'셀프':f.self===false?'일반 주유':null,f.carWash===true?'세차 가능':null,f.maintenance===true?'정비 가능':null,f.convenience===true?'편의점':null].filter(Boolean);
 const routeRow=state.view==='route'?(state.visible.find(row=>String(row.id)===String(station.id))||routeMode.routeForStation(station.id)):null,routeNavigation=routeRow?routeMode.navigationForStation(station.id):null;
 const nav=stationNavigationURL(station),address=station.roadAddress||station.address||'주소 정보 미제공';
 const phone=String(station.phone||'').replace(/[^\d+\-]/g,'');
 const others=Math.max(0,state.visible.filter(s=>s.id!==station.id).length);
 const currentFuel=FUEL_TYPES.find(fuel=>fuel.code===state.fuel)?.name||'유종';
 const priceBasis=selectedPrice?(['daily_current_file','daily_price_file'].includes(selectedPrice.priceTimeStatus)?`오피넷 일일 판매가격 ${selectedPrice.sourceDate||'기준일 미확인'} · 개별 보고시각 미제공`:formatTime(selectedPrice.priceUpdatedAt)):'가격 미제공';
 const routeMeta=routeRow?`<dt>경로 진행</dt><dd>출발지에서 약 ${(routeRow.progressMeters/1000).toFixed(1)} km 지점</dd><dt>실제 우회</dt><dd>${routeRow.detour?.verified?`+${(routeRow.detour.distanceMeters/1000).toFixed(1)} km · +${Math.ceil(routeRow.detour.durationSeconds/60)}분${routeRow.detour.tollWon?` · 통행료 차이 ${money(routeRow.detour.tollWon)}원`:''}`:'미검증 · 우회 수치 표시 안 함'}</dd>`:'';
 const navigationAction=routeNavigation?`<button type="button" class="focus-route-button" data-action="route-nav" data-id="${esc(station.id)}">${icon('route')}경유 길안내</button>`:`<a class="focus-route-button" href="${nav}" target="_blank" rel="noopener noreferrer">${icon('route')}길안내</a>`;
 $('detail-content').innerHTML=`<div class="station-focus-detail">
   <p class="focus-breadcrumb">${esc(stationRegion(station))} <span>·</span> 주유소 <span>·</span> ${esc(brand)}</p>
   <h2>${esc(station.name)}</h2>
   <div class="focus-brand-badge">${detailBrandLogo}<span>${esc(brand)}${f.self===true?' · 셀프':''}</span></div>
   <div class="focus-primary-actions">
     <button type="button" class="other-stations-button" data-action="show-list">다른 주유소 <strong>${others}</strong><span aria-hidden="true">→</span></button>
   </div>
   <div class="fuel-price-grid">
     ${detailPrice(station,'B027','휘발유','green')}
     ${detailPrice(station,'D047','경유','blue')}
     ${detailPrice(station,'K015','LPG','orange')}
   </div>
   <div class="focus-detail-tabs" role="tablist" aria-label="주유소 상세 정보">
     <button type="button" role="tab" class="active" aria-selected="true" data-detail-tab="basic">기본정보</button>
     <button type="button" role="tab" aria-selected="false" data-detail-tab="detail">상세정보</button>
   </div>
   <section class="focus-tab-panel" data-detail-panel="basic">
     <h3>위치 · 연락처</h3>
     <div class="contact-row contact-address"><span class="contact-icon">${icon('pin')}</span><div><small>주소</small><p>${esc(address)}</p></div>${navigationAction}</div>
     <div class="contact-row"><span class="contact-icon">${icon('phone')}</span><div><small>전화번호</small><p>${phone?`<a href="tel:${esc(phone)}">${esc(phone)} · 전화 걸기</a>`:'전화번호 정보 미제공'}</p></div></div>
     <div class="contact-row"><span class="contact-icon">${icon('clock')}</span><div><small>운영시간</small><p>${esc(stationHours(station))}</p></div></div>
     <div class="focus-inline-actions"><button type="button" data-action="copy-address" data-id="${esc(station.id)}">주소 복사</button><button type="button" data-action="share" data-id="${esc(station.id)}">공유</button><button type="button" data-action="save" data-id="${esc(station.id)}" aria-pressed="${state.favorites.has(station.id)}">${state.favorites.has(station.id)?'찜 해제':'찜하기'}</button></div>
   </section>
   <section class="focus-tab-panel" data-detail-panel="detail" hidden>
     <h3>가격 · 시설 상세</h3>
     <dl class="focus-detail-meta"><dt>선택 유종</dt><dd>${esc(currentFuel)} ${selectedPrice?money(selectedPrice.price)+'원/L':'가격 미제공'}</dd><dt>가격 기준</dt><dd>${esc(priceBasis)}</dd><dt>수집 시각</dt><dd>${esc(formatTime(selectedPrice?.fetchedAt))}</dd><dt>자료 출처</dt><dd><a href="https://www.opinet.co.kr/" target="_blank" rel="noopener noreferrer">${esc(selectedPrice?.source?.name||'한국석유공사 오피넷')} ↗</a></dd><dt>시설</dt><dd>${esc(facilityLabels.join(' · ')||'시설 정보 미제공')}</dd>${routeMeta}<dt>거리</dt><dd>${routeRow?`경로까지 직선 ${(routeRow.proximityMeters/1000).toFixed(1)} km`:hasMapCoordinates(station)?`검색 중심에서 직선 ${(distanceMeters(state.center,station)/1000).toFixed(1)} km`:'좌표 확인 중'}</dd></dl>
     ${!confidence.eligible?'<p class="detail-warn">가격 기준시각이 확인되지 않았거나 오래된 자료는 최저가·절약액 추천에서 제외합니다.</p>':''}
   </section>
   <div id="station-detail-ad-host" class="station-detail-ad-host"></div>
 </div>`;
 mountStationDetailAd($('station-detail-ad-host'));
 $('detail-content').querySelectorAll('[data-detail-tab]').forEach(button=>button.addEventListener('click',()=>{
   const tab=button.dataset.detailTab;
   $('detail-content').querySelectorAll('[data-detail-tab]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-selected',String(active));});
   $('detail-content').querySelectorAll('[data-detail-panel]').forEach(panel=>panel.hidden=panel.dataset.detailPanel!==tab);
 }));
}
async function shareStation(id){const st=state.all.find(s=>s.id===id);if(!st)return;const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('station',id);url.searchParams.set('fuel',state.fuel);if(hasMapCoordinates(st)){url.searchParams.set('slat',String(st.lat));url.searchParams.set('slng',String(st.lng));}const p=getFuelPrice(st,state.fuel);const text=`${st.name} · ${FUEL_TYPES.find(f=>f.code===state.fuel).name} ${p?`${money(p.price)}원/L`:'가격 미확인'}\n가격 기준 ${['daily_current_file','daily_price_file'].includes(p?.priceTimeStatus)?`일일 판매가격 ${p?.sourceDate||'기준일 미확인'}`:formatTime(p?.priceUpdatedAt)} · 한국석유공사 오피넷\n현장 가격은 달라질 수 있습니다.`;try{if(navigator.share)await navigator.share({title:`${st.name} | 주유한눈`,text,url:url.href});else{await navigator.clipboard.writeText(`${text}\n${url.href}`);toast('주유소 링크를 복사했습니다.');}}catch(e){if(e.name!=='AbortError')toast('공유 기능을 사용할 수 없습니다. 주소를 직접 복사해 주세요.');}}
async function search(query,target='search-candidates',onPick){const ticket=++state.searchGeneration,box=$(target),text=query.trim();box.setAttribute('role','listbox');if(!box.hasAttribute('aria-label'))box.setAttribute('aria-label','장소 및 주소 검색 결과');if(!text){box.hidden=false;box.innerHTML='<p>장소명, 도로명 또는 지번을 입력해 주세요.</p>';return;}box.hidden=false;box.innerHTML='<p>장소와 주소를 찾고 있습니다…</p>';try{if(!state.mapReady)throw new Error('지도가 준비되면 목적지를 찾을 수 있습니다.');const results=await map.searchLocation(text);if(ticket!==state.searchGeneration)return;if(!results.length){box.innerHTML='<p>검색 결과가 없습니다. 장소명이나 주소를 다시 확인해 주세요.</p>';return;}box.innerHTML='';results.slice(0,6).forEach(item=>{const presentation=addressSearchPresentation(item),secondary=presentation.secondary?(presentation.kind==='장소'?presentation.secondary:`지번 ${presentation.secondary}`):'',b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.setAttribute('aria-label',[presentation.kind,presentation.primary,secondary].filter(Boolean).join(' · '));b.innerHTML=`<strong><span class="search-address-kind">${esc(presentation.kind)}</span><span>${esc(presentation.primary)}</span></strong>${secondary?`<small>${esc(secondary)}</small>`:''}`;b.addEventListener('click',()=>{box.hidden=true;onPick(item);});box.appendChild(b);});}catch(error){if(ticket===state.searchGeneration&&error?.name!=='AbortError')box.innerHTML=`<p>${esc(error.message||'장소 또는 주소 검색을 이용할 수 없습니다.')}</p>`;}}
function stationSearchRows(query){return searchStations(state.all,{query,fuel:state.fuel,center:state.center,brand:state.brand,self:state.self,freshOnly:state.freshOnly,limit:12});}
function showStationSearchResults(rows,query){
 const box=$('search-candidates');box.hidden=false;box.setAttribute('role','listbox');box.setAttribute('aria-label',`“${query}” 주유소 검색 결과 ${rows.length}곳`);box.innerHTML='';
 rows.forEach(station=>{const address=station.roadAddress||station.address||[station.routeName,station.direction].filter(Boolean).join(' · '),button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.setAttribute('aria-label',`${station.name} · ${address} · ${money(station.currentPrice?.price)}원`);button.innerHTML=`<strong><span class="search-address-kind station">주유소</span><span>${esc(station.name)}</span><b class="search-station-price">${money(station.currentPrice?.price)}원</b></strong><small>${esc(address)}${station.routeName?` · ${esc(station.routeName)}${station.direction?` ${esc(station.direction)} 방향`:''}`:''}</small>`;button.addEventListener('click',()=>{box.hidden=true;state.center={lat:station.lat,lng:station.lng};state.selected=station.id;state.query=query;$('query').value=query;setMobileSearchOpen(false,{focus:false});if(state.mapReady){map.setCenter(state.center);requestAnimationFrame(()=>map.focus(station,{preserveZoom:true}));}render();});box.appendChild(button);});
}

const RECENT_DESTINATIONS_KEY='juyu:route-destinations:v2';
let recentDestinations=normalizeRouteHistory(readStorage(RECENT_DESTINATIONS_KEY,readStorage('juyu:route-destinations:v1',[])));
saveStorage(RECENT_DESTINATIONS_KEY,recentDestinations);
function renderRecentDestinations(){const wrap=$('route-recent-wrap'),select=$('route-recent');if(!wrap||!select)return;wrap.hidden=!recentDestinations.length;select.innerHTML='<option value="">선택해 주세요</option>'+recentDestinations.map((item,index)=>`<option value="${index}">${esc(item.label)}</option>`).join('');}
function rememberDestination(){if(!routeMode.state.destination)return;const next={label:routeMode.state.destinationLabel||'최근 목적지',...routeMode.state.destination};recentDestinations=rememberRouteDestination(recentDestinations,next);saveStorage(RECENT_DESTINATIONS_KEY,recentDestinations);renderRecentDestinations();}
function setRoutePoint(type,point,label){try{routeMode.setPoint(type,point,label);routeSimulation.set(null);routePickTarget=null;for(const id of ['route-origin-map','route-destination-map'])$(id)?.classList.remove('is-picking');if(state.mapReady)map.clearRoute();render();}catch(error){toast(error.message);}}
function useCurrentLocationForRoute({announce=true,fresh=false}={}){
 if(routeOriginRequest)return routeOriginRequest;
 const button=$('route-origin-current');if(button)button.disabled=true;
 routeOriginRequest=(async()=>{if(!state.mapReady)throw new Error('지도가 준비되는 중입니다.');const cached=!fresh&&lastLocatedPoint&&Date.now()-Number(lastLocatedPoint.timestamp||0)<15000&&Number(lastLocatedPoint.accuracy||0)<=65?lastLocatedPoint:null;const point=cached||await map.locate();lastLocatedPoint={lat:point.lat,lng:point.lng,accuracy:Number(point.accuracy)||null,timestamp:Date.now()};setRoutePoint('origin',point,'현재 위치 (실시간)');if(announce)toast('현재 위치에서 출발합니다.');return point;})().catch(error=>{if(announce)toast(error.message||'현재 위치를 확인하지 못했습니다. 출발지를 직접 선택해 주세요.');return null;}).finally(()=>{routeOriginRequest=null;if(button)button.disabled=false;render();});
 return routeOriginRequest;
}
function handleRouteMapPick(point){if(state.view!=='route'||!routePickTarget)return;const type=routePickTarget;setRoutePoint(type,point,`지도 지정 (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})`);if(mobileMapView.isMobile()&&mobileMapView.getMode()==='map-collapsed')mobileMapView.startMobileExpanded();toast(`${type==='origin'?'출발지':'목적지'}를 지도에서 설정했습니다.`);}
function beginRouteMapPick(type){routePickTarget=type;for(const id of ['route-origin-map','route-destination-map'])$(id)?.classList.remove('is-picking');$(`route-${type}-map`)?.classList.add('is-picking');if(mobileMapView.isMobile()&&mobileMapView.getMode()!=='map-collapsed')mobileMapView.toggleMapChrome();toast(`지도에서 ${type==='origin'?'출발지':'목적지'}를 눌러 주세요. 오른쪽 펼치기 버튼으로 돌아올 수 있습니다.`);}
function searchRoutePoint(type){const input=$(`route-${type}-query`),query=input.value.trim();if(!query){input.focus();search(query,`route-${type}-candidates`,()=>{});return;}search(query,`route-${type}-candidates`,item=>{const label=addressSearchPresentation(item).primary;setRoutePoint(type,item,label);input.value='';if(type==='destination')toast(`목적지를 설정했습니다: ${label}`);});}
async function planRoute(){
 const button=$('route-submit'),settings=routeViewOptions();
 button.disabled=true;button.textContent='가는 길의 주유소를 찾는 중…';state.selected=null;state.routeResultScope='recommended';routeSimulation.set(null);if(state.mapReady)map.clearRoute();render();
 try{
  const task=routeMode.plan({stations:state.all,fuel:state.fuel,...settings,corridorMeters:Number($('route-corridor').value),option:$('route-option').value,brand:state.brand,selfOnly:state.self});render();
  const response=await task;
  if(response?.baseRoute?.path?.length>1){if(state.mapReady)map.showRoute(response.baseRoute.path,{kind:'base',fitBounds:true,origin:routeMode.state.origin,destination:routeMode.state.destination});useBaseRouteSimulation(response);}
  if(['ready','partial'].includes(response?.status)){routePlannerOpen=false;rememberDestination();render();if(mobileMapView.isMobile())mobileMapView.openListSheet();else requestAnimationFrame(()=>$('results-header')?.scrollIntoView({block:'start'}));}
  if(response?.status==='partial'&&response.warnings?.length)toast('일부 후보의 우회 경로는 확인하지 못했습니다.');
 }catch(error){if(error.name!=='AbortError')toast(error.message||'경로를 확인하지 못했습니다.');}
 finally{button.disabled=false;button.innerHTML='가는 길 주유소 보기 <span aria-hidden="true">→</span>';render();}
}
function openRouteNavigation(id){const urls=routeMode.navigationForStation(id);if(!urls){toast('출발지·주유소·목적지 좌표를 확인해 주세요.');return;}if(/JuyuhannunAndroid\//.test(navigator.userAgent)){location.href=urls.app;return;}const opened=window.open(urls.web,'_blank','noopener,noreferrer');if(!opened)location.href=urls.web;}

document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.view==='route'){openRoutePlanner();return;}selectView(b.dataset.view);}));
document.querySelectorAll('[data-fuel]').forEach(b=>{const selected=b.dataset.fuel===state.fuel;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));b.setAttribute('aria-pressed',String(selected));b.addEventListener('click',()=>{const changed=state.fuel!==b.dataset.fuel;state.fuel=b.dataset.fuel;saveStorage('juyu:fuel:v1',state.fuel);document.querySelectorAll('[data-fuel]').forEach(x=>{const active=x.dataset.fuel===state.fuel;x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active));x.setAttribute('aria-pressed',String(active));});$('fuel-tabs').classList.remove('mobile-open');$('mobile-fuel-toggle').setAttribute('aria-expanded','false');syncMobileFuelToggle();if(changed){if(state.view==='route'){routeMode.invalidate();routeSimulation.set(null);if(state.mapReady)map.clearRoute();}render();if($('detail-dialog').open)renderDetail();}});});
syncMobileFuelToggle();
$('query').addEventListener('input',()=>{state.listLimit=60;++state.searchGeneration;$('search-candidates').hidden=true;state.query=$('query').value;syncMobileSearchIndicator();render();});
$('search-form').addEventListener('submit',e=>{e.preventDefault();const query=$('query').value.trim();state.query=query;syncMobileSearchIndicator();render();if(!query)return;const stations=stationSearchRows(query);if(stations.length){showStationSearchResults(stations,query);return;}search(query,'search-candidates',item=>{if(!finite(item?.lat)||!finite(item?.lng))return;state.center={lat:item.lat,lng:item.lng};state.query=query;$('query').value=query;syncMobileSearchIndicator();setMobileSearchOpen(false,{focus:false});if(state.mapReady)map.setCenter(state.center);render();});});
$('mobile-search-back').addEventListener('click',()=>{setMobileSearchOpen(false,{focus:false});mobileSearchToggle?.focus({preventScroll:true});});
$('mobile-fuel-toggle').addEventListener('click',()=>{const tabs=$('fuel-tabs'),open=!tabs.classList.contains('mobile-open');tabs.classList.toggle('mobile-open',open);$('mobile-fuel-toggle').setAttribute('aria-expanded',String(open));if(open){setMobileSearchOpen(false,{focus:false});$('extra-filters').hidden=true;$('toggle-filters').setAttribute('aria-expanded','false');}});
$('focus-fuel-toggle')?.addEventListener('click',()=>{const tabs=$('focus-fuel-tabs'),open=tabs?.hidden!==false;if(tabs)tabs.hidden=!open;$('focus-fuel-toggle').setAttribute('aria-expanded',String(open));});
document.querySelectorAll('[data-focus-fuel]').forEach(button=>button.addEventListener('click',()=>{document.querySelector(`[data-fuel="${button.dataset.focusFuel}"]`)?.click();$('focus-fuel-tabs').hidden=true;$('focus-fuel-toggle').setAttribute('aria-expanded','false');}));
$('voice-search').addEventListener('click',()=>{const Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;if(!Recognition){toast('이 브라우저에서는 음성 검색을 지원하지 않습니다.');return;}const recognition=new Recognition();recognition.lang='ko-KR';recognition.interimResults=false;recognition.maxAlternatives=1;const button=$('voice-search');button.classList.add('is-listening');button.setAttribute('aria-label','음성 듣는 중');recognition.onresult=event=>{const value=event.results?.[0]?.[0]?.transcript?.trim();if(value){$('query').value=value;state.query=value;syncMobileSearchIndicator();render();toast(`“${value}”로 검색했습니다.`);}};recognition.onerror=()=>toast('음성을 인식하지 못했습니다. 다시 시도해 주세요.');recognition.onend=()=>{button.classList.remove('is-listening');button.setAttribute('aria-label','음성 검색');};try{recognition.start();}catch{button.classList.remove('is-listening');}});
document.addEventListener('click',e=>{if(!e.target.closest('#mobile-fuel-toggle,#fuel-tabs')){$('fuel-tabs')?.classList.remove('mobile-open');$('mobile-fuel-toggle')?.setAttribute('aria-expanded','false');}if(!e.target.closest('#focus-fuel-toggle,#focus-fuel-tabs')){if($('focus-fuel-tabs'))$('focus-fuel-tabs').hidden=true;$('focus-fuel-toggle')?.setAttribute('aria-expanded','false');}});
$('brand-filter').addEventListener('change',()=>{state.brand=$('brand-filter').value;if($('mobile-brand-filter'))$('mobile-brand-filter').value=state.brand;if(state.view==='route'&&routeMode.state.response){routeMode.invalidate();routeSimulation.set(null);if(state.mapReady)map.clearRoute();toast('정유사 조건이 바뀌었습니다. 다시 탐색해 주세요.');}render();});
$('mobile-brand-filter')?.addEventListener('change',()=>{state.brand=$('mobile-brand-filter').value;$('brand-filter').value=state.brand;if(state.view==='route'&&routeMode.state.response){routeMode.invalidate();routeSimulation.set(null);if(state.mapReady)map.clearRoute();toast('브랜드 조건이 바뀌었습니다. 다시 탐색해 주세요.');}render();});
$('self-only').addEventListener('change',()=>{state.self=$('self-only').checked;if(state.view==='route'&&routeMode.state.response){routeMode.invalidate();routeSimulation.set(null);if(state.mapReady)map.clearRoute();toast('셀프 조건이 바뀌었습니다. 다시 탐색해 주세요.');}render();});
$('fresh-only').addEventListener('change',()=>{state.freshOnly=$('fresh-only').checked;render();});
$('sort').addEventListener('change',()=>{state.sort=$('sort').value;render();});
$('toggle-filters').addEventListener('click',()=>{const open=$('extra-filters').hidden;$('extra-filters').hidden=!open;$('toggle-filters').setAttribute('aria-expanded',String(open));if(open){setMobileSearchOpen(false,{focus:false});$('fuel-tabs').classList.remove('mobile-open');$('mobile-fuel-toggle').setAttribute('aria-expanded','false');}});
$('route-origin-form').addEventListener('submit',event=>{event.preventDefault();searchRoutePoint('origin');});
$('route-destination-form').addEventListener('submit',event=>{event.preventDefault();searchRoutePoint('destination');});
$('route-origin-current').addEventListener('click',()=>useCurrentLocationForRoute({fresh:true}));
$('route-origin-map').addEventListener('click',()=>beginRouteMapPick('origin'));
$('route-destination-map').addEventListener('click',()=>beginRouteMapPick('destination'));
$('route-recent').addEventListener('change',()=>{const value=$('route-recent').value;if(value==='')return;const item=recentDestinations[Number(value)];if(item)setRoutePoint('destination',item,item.label);});
$('route-submit').addEventListener('click',planRoute);
$('route-panel-close')?.addEventListener('click',closeRoutePanel);
for(const id of ['route-panel-exit','route-mode-exit'])$(id)?.addEventListener('click',exitRouteMode);
document.querySelectorAll('[data-route-sort]').forEach(button=>button.addEventListener('click',()=>{state.routeSort=button.dataset.routeSort;render();}));
for(const id of ['route-corridor','route-max-detour','route-option'])$(id).addEventListener('change',()=>{if(routeMode.state.response){routeMode.invalidate();routeSimulation.set(null);if(state.mapReady)map.clearRoute();toast('탐색 조건이 바뀌었습니다. 다시 확인해 주세요.');}if(state.view==='route')render();});
renderRecentDestinations();
$('results').addEventListener('scroll',scheduleListScrollSelection,{passive:true});
$('refresh').addEventListener('click',loadData);
function syncDrivingButton(){
 const button=$('drive-mode');if(!button)return;
 const active=state.driving.active;
 button.setAttribute('aria-pressed',String(active));
 button.setAttribute('aria-label',active?'주행 추적 종료':'주행 추적 시작');
 button.title=active?'주행 추적 종료':'주행 추적 시작';
 document.body.classList.toggle('driving-mode',active);
 const scale=$('drive-scale');if(scale)scale.hidden=!active;
 if(!active)syncDrivingStationStatus();
}
function stopDrivingMode({message=''}={}){
 if(state.driving.active||map.isDriving())map.stopDriving({keepMarker:true});
 state.driving={active:false,phase:'off',point:null,heading:null,speed:0,accuracy:null,zoomMode:'auto'};
 syncDrivingButton();
 if(state.mapReady){state.center=map.getCenter();state.bounds=map.getBounds();}
 render();
 if(message)toast(message);
}
async function refreshDrivingRoadPrediction(point,heading,speed){
 if(!apiBase||!point||!Number.isFinite(heading))return;
 const now=Date.now(),distance=Math.max(1200,Math.min(5000,(Number(speed)||0)*140||2200));
 const key=[point.lat.toFixed(3),point.lng.toFixed(3),Math.round(heading/15)*15,Math.round(distance/500)*500].join(':');
 if(now-drivingPredictionAt<45000&&key===drivingPredictionKey)return;
 drivingPredictionAt=now;drivingPredictionKey=key;
 try{
  const url=`${apiBase}/route/predict?origin=${encodeURIComponent(point.lng+','+point.lat)}&heading=${encodeURIComponent(heading)}&distanceMeters=${Math.round(distance)}`;
  const result=await requestJSON(url,AbortSignal.timeout(12000));
  if(result?.status==='ready'&&Array.isArray(result.path)&&result.path.length>1)map.setDrivingPredictionPath(result.path);
 }catch{}
}
function handleDrivingUpdate({point,heading,speed,accuracy,phase='active'}){
 const active=['active','paused'].includes(phase);state.driving={...state.driving,active,phase,point,heading,speed,accuracy};lastLocatedPoint={...point,accuracy,timestamp:Date.now()};state.center={...point};syncDrivingButton();if(active){refreshDrivingRoadPrediction(point,heading,speed);render();}
}
function startDrivingMode(){
 if(!state.mapReady){toast('지도가 준비된 뒤 주행 추적을 시작해 주세요.');return;}
 try{
   state.driving.active=true;syncDrivingButton();syncDrivingStationStatus();
   map.startDriving({
     onUpdate:({point,heading,speed,accuracy})=>{
       handleDrivingUpdate({point,heading,speed,accuracy,phase:'active'});
     },
     onError:error=>{stopDrivingMode({message:error.message||'주행 위치를 확인하지 못했습니다.'});}
   });
   toast('주행모드 시작 · 지도와 마커는 정방향을 유지하고 차량 화살표로 진행방향을 표시합니다. 파란선은 이동동선, 초록 점선은 예상 진행동선입니다.');
 }catch(error){
   state.driving={active:false,phase:'off',point:null,heading:null,speed:0,accuracy:null,zoomMode:'auto'};syncDrivingButton();
   toast(error.message||'주행 추적을 시작하지 못했습니다.');
 }
}
$('drive-mode').addEventListener('click',()=>{if(state.driving.active)stopDrivingMode({message:'주행 추적을 종료했습니다.'});else startDrivingMode();});
$('drive-zoom-range')?.addEventListener('input',()=>{const zoom=Number($('drive-zoom-range').value);$('drive-zoom-value').value=String(zoom);state.driving.zoomMode='manual';map.setDrivingZoomMode('manual',zoom);$('drive-zoom-auto').setAttribute('aria-pressed','false');});
$('drive-zoom-auto')?.addEventListener('click',()=>{state.driving.zoomMode='auto';map.setDrivingZoomMode('auto');$('drive-zoom-auto').setAttribute('aria-pressed','true');toast('속도에 맞춰 지도 배율을 자동 조정합니다.');});
$('route-results-toggle').addEventListener('click',()=>{
 if(!hasRouteResults())return;
 const allRows=routeMode.rows(routeViewOptions()),recommendedRows=selectRouteDisplayRows(allRows,'recommended');
 state.routeResultScope=state.routeResultScope==='recommended'?'all':'recommended';
 if(state.routeResultScope==='recommended'&&!recommendedRows.length)state.routeResultScope='all';
 state.selected=null;listFocusedStationId=null;$('results').scrollTop=0;
 if(state.mapReady)map.clearRoute('via');
 useBaseRouteSimulation();render();
 toast(state.routeResultScope==='recommended'?`추천 주유소 ${recommendedRows.length.toLocaleString('ko-KR')}곳만 표시합니다.`:`경로상 주유소 ${allRows.length.toLocaleString('ko-KR')}곳을 모두 표시합니다.`);
});
$('reset-map').addEventListener('click',()=>{if(state.driving.active)stopDrivingMode();state.center={...APP_CONFIG.defaultCenter};if(state.mapReady){map.setCenter(state.center);map.setZoom(mobileMapView.isMobile()?(APP_CONFIG.mobileDefaultZoom||14):APP_CONFIG.defaultZoom);}});
$('zoom-in').addEventListener('click',()=>{if(state.mapReady){const zoom=map.zoomBy(1);if(state.driving.active){state.driving.zoomMode='manual';map.setDrivingZoomMode('manual',zoom);$('drive-zoom-range').value=String(zoom);$('drive-zoom-value').value=String(zoom);$('drive-zoom-auto').setAttribute('aria-pressed','false');}}});
$('zoom-out').addEventListener('click',()=>{if(state.mapReady){const zoom=map.zoomBy(-1);if(state.driving.active){state.driving.zoomMode='manual';map.setDrivingZoomMode('manual',zoom);$('drive-zoom-range').value=String(zoom);$('drive-zoom-value').value=String(zoom);$('drive-zoom-auto').setAttribute('aria-pressed','false');}}});
$('map-type-toggle').addEventListener('click',()=>{const b=$('map-type-toggle');if(!state.mapReady)return;const result=map.toggleMapType();if(!result.supported){b.hidden=true;return;}const satellite=result.type==='satellite';b.setAttribute('aria-pressed',String(satellite));b.setAttribute('aria-label',satellite?'일반 지도 보기':'위성 지도 보기');b.title=satellite?'일반 지도 보기':'위성 지도 보기';});
$('focus-rescan').addEventListener('click',async()=>{const button=$('focus-rescan');if(!state.mapReady||button.classList.contains('is-progress'))return;button.classList.add('is-progress');button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="rescan-spinner" aria-hidden="true"></span> 지도 영역 확인 중';mobileComparisonRefreshRequested=true;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));updateViewport({center:map.getCenter(),bounds:map.getBounds()});await new Promise(resolve=>setTimeout(resolve,320));button.classList.remove('is-progress');button.disabled=false;button.removeAttribute('aria-busy');button.innerHTML='<span aria-hidden="true">↻</span> 이 지역 재검색';toast('현재 지도 영역의 주유소와 가격 순위를 다시 확인했습니다.');});
$('focus-route-shortcut')?.addEventListener('click',()=>openRoutePlanner());
$('focus-dock-list').addEventListener('click',()=>openFocusList());
$('focus-dock-more').addEventListener('click',()=>{if(hasRouteResults()){if(isRoutePlannerVisible())closeRoutePlanner();else openRoutePlanner();return;}$('more-favorites-count').textContent=String(state.favorites.size);showDialog('more-dialog');});
$('more-favorites')?.addEventListener('click',()=>{closeDialog('more-dialog');selectView('saved');openFocusList();});
$('more-recent-clear')?.addEventListener('click',()=>{recentDestinations=[];saveStorage(RECENT_DESTINATIONS_KEY,recentDestinations);renderRecentDestinations();closeDialog('more-dialog');toast('최근 목적지를 모두 삭제했습니다.');});
$('more-info')?.addEventListener('click',()=>{closeDialog('more-dialog');showDialog('info-dialog');});
if($('more-app-exit')){$('more-app-exit').hidden=!androidApp;$('more-app-exit').addEventListener('click',()=>{closeDialog('more-dialog');location.href='juyuhannun://exit';});}
$('locate').addEventListener('click',async()=>{const b=$('locate');b.disabled=true;try{if(!state.mapReady)throw new Error('지도가 준비되는 중입니다.');const position=await map.locate();lastLocatedPoint={lat:position.lat,lng:position.lng};state.center={lat:position.lat,lng:position.lng};toast('현재 위치 주변으로 이동했습니다.');}catch(error){toast(error.message||'현재 위치를 확인하지 못했습니다. 위치 권한을 확인해 주세요.');}finally{b.disabled=false;}});
for(const id of ['open-info','footer-info'])$(id).addEventListener('click',()=>showDialog('info-dialog'));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.close==='detail-dialog'&&mobileMapView.isMobile())mobileMapView.closeDetail();else closeDialog(b.dataset.close);}));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}));
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,id=b.dataset.id;if(action==='load-more'){state.listLimit+=60;render();}else if(action==='detail')selectStation(id);else if(action==='save')toggleFavorite(id);else if(action==='route-nav')openRouteNavigation(id);else if(action==='show-list')openFocusList();else if(action==='copy-address'){const st=state.all.find(s=>s.id===id);if(st){try{await navigator.clipboard.writeText(st.roadAddress||st.address||'');toast('주소를 복사했습니다.');}catch{toast('주소 복사를 사용할 수 없습니다.');}}}else if(action==='share')shareStation(id);else if(action==='retry')loadData();else if(action==='show-old'){state.freshOnly=false;$('fresh-only').checked=false;render();}else if(action==='zone'){const zone=state.envelope?.coverage?.zones?.find(z=>z.id===b.dataset.zone);if(zone?.center){state.center=zone.center;if(state.mapReady)map.setCenter(zone.center);}}else if(action==='reset-filters'){state.query='';state.brand='';state.self=false;state.freshOnly=false;$('fresh-only').checked=false;$('query').value='';$('brand-filter').value='';$('self-only').checked=false;syncMobileSearchIndicator();render();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){showMobileMapMenu();render();if(Date.now()-lastDataCheckAt>=DATA_REFRESH_MS)loadData();}});
window.addEventListener('online',loadData);
window.addEventListener('beforeunload',()=>{if(map.isDriving())map.stopDriving({keepMarker:false});});
setInterval(()=>{if(!document.hidden){render();if($('detail-dialog').open)renderDetail();}},60000);
setInterval(()=>{if(!document.hidden)loadData();},DATA_REFRESH_MS);

async function initializeMapViewport(startupDataPromise){
 state.mapReady=true;
 const sharedStationRequested=Boolean(sharedId&&/^[\w-]{1,50}$/.test(sharedId));
 if(sharedStationRequested){
  map.setCenter(state.center);
 }else{
  mapLoading.stage('location');
  try{
   const position=await map.locate();
   lastLocatedPoint={lat:position.lat,lng:position.lng,accuracy:Number(position.accuracy)||null,timestamp:Date.now()};
   state.center={lat:position.lat,lng:position.lng};
   if(mobileMapView.isMobile())map.setZoom(APP_CONFIG.mobileDefaultZoom||14);
  }catch{
   map.setCenter(state.center);
  }
 }
 mapLoading.stage('data');
 await startupDataPromise.catch(()=>{});
 updateViewport({center:map.getCenter(),bounds:map.getBounds()});
 mapLoading.stage('markers');
 await map.waitForMarkerRender({timeoutMs:5000});
 mapLoading.complete();
 try{map.startDriving({autoDetect:true,routeActive:()=>state.view==='route'&&Boolean(routeMode?.state.response?.baseRoute),onUpdate:handleDrivingUpdate,onError:()=>{}});}catch{}
}
const startupDataPromise=loadData();
mapLoading.stage('map');
map.init().then(()=>initializeMapViewport(startupDataPromise)).catch(()=>{state.mapFailed=true;mapLoading.error('지도를 불러오지 못했습니다.');setMapNotice('지도를 불러오지 못했습니다. 지도 연결 후 화면 안의 주유소를 확인할 수 있습니다.');render();});

