import {APP_CONFIG} from '../config.js';
import {MapController} from './map.js';
import {setupMobileMapView} from './mobile-map-view.js';
import {loadStationData,mergeStationData,reselectStationPrices} from './data-loader.js';
import {FUEL_TYPES,BRANDS,escapeHTML as esc,money,finite,distanceMeters,getFuelPrice,freshness,formatTime,filterStations,summarizeVisiblePrices,hasMapCoordinates,stationNavigationURL} from './core.js';

const $=(id)=>document.getElementById(id);
const iconPaths={pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',route:'<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h9a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h9"/>',heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',calculator:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',sliders:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="white"/><circle cx="15" cy="17" r="2" fill="white"/>',map:'<path d="m2 6 6-3 8 3 6-3v15l-6 3-8-3-6 3Zm6-3v15m8-12v15"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M19 8a8 8 0 0 0-14-3M5 16a8 8 0 0 0 14 3"/>',locate:'<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',home:'<path d="m3 10 9-7 9 7v11H3Zm6 11v-8h6v8"/>',list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',pump:'<rect x="3" y="3" width="12" height="17" rx="2"/><path d="M6 7h6v4H6ZM1 21h16m-2-8h2v5a2 2 0 0 0 4 0V8l-4-4m3 3v4h1"/>',share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/>',phone:'<path d="M6 3H3c0 10 8 18 18 18v-4l-5-2-2 3a17 17 0 0 1-8-8l3-2-3-5Z"/>',check:'<path d="m5 12 4 4L20 5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'};
iconPaths.expand='<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>';
iconPaths.collapse='<path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5"/>';
iconPaths.plus='<path d="M12 5v14M5 12h14"/>';
iconPaths.minus='<path d="M5 12h14"/>';
iconPaths.layers='<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>';
iconPaths.droplet='<path d="M12 3s-5 6.2-5 10a5 5 0 0 0 10 0c0-3.8-5-10-5-10Z"/>';
iconPaths.star='<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>';
iconPaths.flame='<path d="M13.5 3.5c.4 3-1.7 4.3-3.2 6.1-1.2 1.4-1.8 2.8-1.8 4.5a4.5 4.5 0 0 0 9 0c0-3.4-2.1-6.2-4-10.6Z"/><path d="M10.5 16.8c0-1.5.8-2.7 2.2-4.2.2 2 .9 2.8 1.5 3.8.7 1.1.3 2.6-1.3 3-1.3.3-2.4-.8-2.4-2.6Z"/>';
const icon=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name]||iconPaths.pin}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
function readStorage(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function saveStorage(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
const storedFavorites=readStorage('juyu:favorites:v1',[]);
const storedFuel=readStorage('juyu:fuel:v1','B027');
const params=new URLSearchParams(location.search);
const requestedFuel=params.get('fuel')||storedFuel;
const state={fuel:FUEL_TYPES.some(f=>f.code===requestedFuel)?requestedFuel:'B027',view:'nearby',bounds:null,listLimit:60,center:{...APP_CONFIG.defaultCenter},envelope:null,all:[],visible:[],selected:null,query:'',brand:'',self:false,freshOnly:false,sort:'price',favorites:new Set(Array.isArray(storedFavorites)?storedFavorites.filter(v=>typeof v==='string'&&/^[\w-]{1,50}$/.test(v)).slice(0,500):[]),generation:0,controller:null,mapReady:false,mapFailed:false,searchGeneration:0,loading:false};
const localHost=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const sharedId=params.get('station');
if(sharedId&&/^[\w-]{1,50}$/.test(sharedId)&&params.has('slat')&&params.has('slng')){const lat=Number(params.get('slat')),lng=Number(params.get('slng'));if(finite(lat)&&finite(lng)&&lat>=32&&lat<=40&&lng>=123&&lng<=133)state.center={lat,lng};}
const apiBase=(APP_CONFIG.apiBase||(localHost?'/api':'')).replace(/\/$/,'');
let toastTimer;
let detailGeneration=0;
let recordStats;
let priceSelection;
let dataRequest=null;
let lastDataCheckAt=0;
const DATA_REFRESH_MS=5*60*1000;
function collectionStats(){const now=Date.now(),minute=Math.floor(now/60000);if(recordStats?.source===state.all&&recordStats.fuel===state.fuel&&recordStats.minute===minute)return recordStats;let mapped=0,fresh=0;for(const station of state.all){if(!hasMapCoordinates(station))continue;mapped++;const p=getFuelPrice(station,state.fuel);if(p&&freshness(p.priceUpdatedAt,p.fetchedAt,now,p.priceTimeStatus,p.sourceDate).eligible)fresh++;}return recordStats={source:state.all,fuel:state.fuel,minute,mapped,fresh};}
function refreshPriceSelection(now){const sources=state.envelope?.sourceSnapshots,minute=Math.floor(now/60000);if(!sources||(priceSelection?.sources===sources&&priceSelection.minute===minute))return;state.all=reselectStationPrices(state.all,sources,{now});priceSelection={sources,minute};}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function showDialog(id){const d=$(id);if(!d.open)d.showModal();}
function closeDialog(id){$(id).close();}
function setMapNotice(message){$('map-notice').textContent=message;$('map-notice').hidden=!message;}
function updateViewport({center,bounds}){state.center=center;state.bounds=bounds;state.listLimit=60;render();}
function handleMapState({provider,status,message}){const typeButton=$('map-type-toggle');typeButton.hidden=provider!=='naver';if(provider!=='naver'){typeButton.setAttribute('aria-pressed','false');typeButton.setAttribute('aria-label','지도 유형 전환 미지원');typeButton.title='지도 유형 전환 미지원';}else if(typeButton.getAttribute('aria-label')==='지도 유형 전환 미지원'){typeButton.setAttribute('aria-label','위성 지도 보기');typeButton.title='위성 지도 보기';}if(status==='error'||provider==='leaflet')setMapNotice(message||'대체 지도에서 확인하고 있습니다.');else if(status==='ready')setMapNotice('');}
const map=new MapController($('map'),{onViewportChange:updateViewport,onSelect:id=>selectStation(id),onState:handleMapState});
const mobileMapView=setupMobileMapView({workspace:document.querySelector('.workspace'),sidebar:$('station-sidebar'),mapSection:$('map-section'),results:$('results'),toggleButton:$('mobile-map-toggle'),listButton:$('mobile-list-toggle'),detailDialog:$('detail-dialog'),detailExpandButton:$('detail-expand-toggle'),detailHandle:$('detail-sheet-handle'),listSheetHandle:$('mobile-list-sheet-handle'),listSheetClose:$('mobile-list-sheet-close'),focusDock:$('mobile-focus-dock'),focusDockList:$('focus-dock-list'),onResize:()=>map.resize(),onModeChange:next=>{if(!['focus-detail','expanded-tools','map-browse','list-sheet','list-sheet-expanded'].includes(next))return;const station=state.all.find(s=>s.id===state.selected);if(station&&state.mapReady&&hasMapCoordinates(station)&&!['list-sheet','list-sheet-expanded'].includes(next))requestAnimationFrame(()=>map.focus(station,{preserveZoom:true}));},icon});

async function requestJSON(url,signal){const response=await fetch(url,{signal,cache:'no-store',credentials:'omit',headers:{Accept:'application/json'}});let data;try{data=await response.json();}catch{throw new Error('가격 서버에서 올바른 자료를 받지 못했습니다.');}if(!response.ok&&!data.status)throw new Error('자료를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');return data;}
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
  if(generation!==state.generation)return;
  if(!Array.isArray(data.stations))throw new Error('가격 자료의 형식을 확인할 수 없습니다.');
  if(data.status==='error'&&!data.stations.length)throw new Error(data.error?.message||'가격 조회에 실패했습니다. 마지막으로 받은 자료를 표시합니다.');
  state.envelope=data;
  const dedupe=new Map();for(const s of data.stations){if(s&&typeof s.id==='string'&&typeof s.name==='string')dedupe.set(s.id,s);}
  state.all=[...dedupe.values()];state.loading=false;render();if($('detail-dialog').open)renderDetail();
  const shareId=params.get('station');if(shareId&&!state.selected&&state.all.some(s=>s.id===shareId)){const st=state.all.find(s=>s.id===shareId);if(hasMapCoordinates(st)){state.center={lat:st.lat,lng:st.lng};if(state.mapReady)map.setCenter(state.center);}render();selectStation(shareId);}
 }catch(error){if(generation!==state.generation)return;state.loading=false;state.envelope={...state.envelope,status:'error',cache:{...state.envelope?.cache,stale:true},warnings:[error.name==='AbortError'?'자료 응답이 지연되고 있습니다. 다시 시도해 주세요.':error.message],error:{message:error.name==='AbortError'?'조회 시간이 초과되었습니다.':error.message}};render();}
 finally{clearTimeout(timeout);if(generation===state.generation){lastDataCheckAt=Date.now();state.loading=false;$('results').setAttribute('aria-busy','false');$('refresh').classList.remove('busy');}}
}
function render(){
 const now=Date.now();refreshPriceSelection(now);
 let filtered=filterStations(state.all,{fuel:state.fuel,center:state.center,bounds:state.bounds,query:state.query,brand:state.brand,self:state.self,freshOnly:state.freshOnly,favorites:state.view==='saved'?state.favorites:null,sort:state.sort,now});
 state.visible=filtered;
 $('result-count').textContent=filtered.length;
 $('results-title').textContent=state.view==='saved'?'찜한 주유소':'지도 안 주유소';
 if($('focus-list-count'))$('focus-list-count').textContent=filtered.length.toLocaleString('ko-KR');
 const total=state.envelope?.coverage?.totalPriceStations??state.all.length,mapped=collectionStats().mapped,summary=summarizeVisiblePrices(filtered);
 $('coverage-hint').textContent=`현재 지도 ${filtered.length.toLocaleString('ko-KR')}곳 · 최신 비교 ${summary.comparable.toLocaleString('ko-KR')}곳 · 좌표 ${mapped.toLocaleString('ko-KR')}/${total.toLocaleString('ko-KR')}곳 확보`;
 if(!filtered.length)renderEmpty();else $('results').innerHTML=filtered.slice(0,state.listLimit).map((s,i)=>card(s,i)).join('')+(filtered.length>state.listLimit?`<button class="load-more" data-action="load-more">${Math.min(60,filtered.length-state.listLimit)}곳 더 보기 · ${state.listLimit.toLocaleString('ko-KR')}/${filtered.length.toLocaleString('ko-KR')}곳</button>`:'');
 if(state.mapReady)map.setStations(filtered,state.selected,state.fuel);
 const cheapest=summary.lowest;
 $('lowest-price').textContent=money(cheapest);$('summary-area').textContent='현재 지도 영역 · 검색 조건 기준';
 $('summary-caption').textContent=cheapest?`${FUEL_TYPES.find(f=>f.code===state.fuel).name} · 최신 비교 ${summary.comparable}곳${summary.reference?` · 참고 가격 ${summary.reference}곳 제외`:''}${state.envelope?.coverage?.complete===false?' · 일부 자료':''}`:filtered.length?`표시된 ${filtered.length}곳은 참고 가격입니다 · 최저가 비교 제외`:'현재 지도에서 비교 가능한 가격이 없습니다';
 renderStatus();
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
 const saved=state.favorites.has(s.id),mapped=hasMapCoordinates(s),address=s.roadAddress||s.address||'주소 정보 미제공';
 const other=FUEL_TYPES.filter(f=>f.code!==state.fuel).map(f=>{const p=getFuelPrice(s,f.code);if(!p)return null;const eligible=freshness(p.priceUpdatedAt,p.fetchedAt,Date.now(),p.priceTimeStatus,p.sourceDate).eligible;return `${f.name} ${money(p.price)}${eligible?'':' (참고)'}`;}).filter(Boolean).join(' · ');
 const date=['daily_current_file','daily_price_file'].includes(s.currentPrice.priceTimeStatus)?s.currentPrice.sourceDate||'기준일 미확인':formatTime(s.currentPrice.priceUpdatedAt);
 return `<article class="station-card${state.selected===s.id?' selected':''}${s.confidence.eligible?'':' is-reference'}" data-station="${esc(s.id)}"><button class="card-main" data-action="detail" data-id="${esc(s.id)}" aria-label="${esc(s.name)} 상세 보기"><div class="card-top"><span class="station-number">${index+1}</span><h3 class="station-name">${esc(s.name)}</h3><div class="card-price">${money(s.currentPrice.price)}<small>원/L</small></div></div><div class="card-sub"><span>${esc(BRANDS[s.brand]||s.brand||'상표 미확인')}</span><span>${esc(s.facilities?.self===true?'셀프':s.facilities?.self===false?'일반':'셀프 미확인')}</span><span class="distance-label">${mapped?`직선 ${(s.distance/1000).toFixed(1)}km`:'지도 좌표 확인 중'}</span></div><p class="card-address" title="${esc(address)}">${esc(address)}</p>${other?`<p class="card-other-prices" title="${esc(other)} 원/L">${esc(other)} <small>원/L</small></p>`:''}</button><div class="card-bottom"><span class="confidence ${s.confidence.state}" title="가격 기준 ${esc(date)}">${esc(s.confidence.label)}${s.confidence.eligible?'':' · 참고 가격'}</span><div class="card-actions"><button data-action="share" data-id="${esc(s.id)}" aria-label="${esc(s.name)} 공유">${icon('share')}</button><button data-action="save" data-id="${esc(s.id)}" class="${saved?'is-saved':''}" aria-label="${esc(s.name)} ${saved?'찜 해제':'찜하기'}" aria-pressed="${saved}">${icon('heart')}</button></div></div></article>`;
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
function selectView(view){mobileMapView.exit({restoreFocus:false});state.view=view==='saved'?'saved':'nearby';document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);if(b.dataset.view===state.view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});render();}
async function selectStation(id){const detailRevision=++detailGeneration,dataRevision=state.generation;const station=state.all.find(s=>s.id===id);if(!station)return;state.selected=id;const mobileFocus=mobileMapView.enterDetail();render();renderDetail();const focusSelected=()=>{if(state.mapReady&&hasMapCoordinates(station)&&state.selected===id)map.focus(station,{preserveZoom:true});};if(mobileFocus)mobileMapView.afterLayout(focusSelected);else{focusSelected();showDialog('detail-dialog');}if(apiBase){const fuel=state.fuel;try{const result=await requestJSON(`${apiBase}/stations/${encodeURIComponent(id)}?fuel=${fuel}`,AbortSignal.timeout(15000));if(detailRevision!==detailGeneration||dataRevision!==state.generation||state.selected!==id||state.fuel!==fuel)return;if(result.station?.id===id&&result.status==='ready'){state.all=mergeStationData({status:'ready',stations:state.all},{status:'ready',provider:result.provider,source:result.source,stations:[result.station]}).stations;render();if($('detail-dialog').open)renderDetail();}}catch{if(detailRevision===detailGeneration&&dataRevision===state.generation&&state.selected===id&&$('detail-dialog').open)toast('상세 가격 갱신에 실패했습니다. 표시된 기준시각을 확인해 주세요.');}}}
function detailPrice(station,code,label,tone){
 const info=getFuelPrice(station,code);
 const date=info?.sourceDate||info?.priceUpdatedAt;
 const dateLabel=date?String(date).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1.$2.$3').slice(0,10):'가격 미제공';
 return `<div class="fuel-price-card fuel-price-${tone}"><span class="fuel-price-label"><i></i>${esc(label)}</span><strong>${info?money(info.price):'—'}<small>${info?'원':''}</small></strong><span class="fuel-price-date">${esc(info?dateLabel+' 기준':'가격 미제공')}</span></div>`;
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
 const brand=BRANDS[station.brand]||station.brand||'상표 미확인';
 const f=station.facilities||{},facilityLabels=[f.self===true?'셀프':f.self===false?'일반 주유':null,f.carWash===true?'세차 가능':null,f.maintenance===true?'정비 가능':null,f.convenience===true?'편의점':null].filter(Boolean);
 const nav=stationNavigationURL(station),address=station.roadAddress||station.address||'주소 정보 미제공';
 const phone=String(station.phone||'').replace(/[^\d+\-]/g,'');
 const others=Math.max(0,state.visible.filter(s=>s.id!==station.id).length);
 const currentFuel=FUEL_TYPES.find(fuel=>fuel.code===state.fuel)?.name||'유종';
 const priceBasis=selectedPrice?(['daily_current_file','daily_price_file'].includes(selectedPrice.priceTimeStatus)?`오피넷 일일 판매가격 ${selectedPrice.sourceDate||'기준일 미확인'} · 개별 보고시각 미제공`:formatTime(selectedPrice.priceUpdatedAt)):'가격 미제공';
 $('detail-content').innerHTML=`<div class="station-focus-detail">
   <p class="focus-breadcrumb">${esc(stationRegion(station))} <span>·</span> 주유소 <span>·</span> ${esc(brand)}</p>
   <h2>${esc(station.name)}</h2>
   <div class="focus-brand-badge"><span class="brand-flame">●</span>${esc(brand)}${f.self===true?' · 셀프':''}</div>
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
     <div class="contact-row contact-address"><span class="contact-icon">${icon('pin')}</span><div><small>주소</small><p>${esc(address)}</p></div><a class="focus-route-button" href="${nav}" target="_blank" rel="noopener noreferrer">${icon('route')}길안내</a></div>
     <div class="contact-row"><span class="contact-icon">${icon('phone')}</span><div><small>전화번호</small><p>${phone?`<a href="tel:${esc(phone)}">${esc(phone)} · 전화 걸기</a>`:'전화번호 정보 미제공'}</p></div></div>
     <div class="contact-row"><span class="contact-icon">${icon('clock')}</span><div><small>운영시간</small><p>${esc(stationHours(station))}</p></div></div>
     <div class="focus-inline-actions"><button type="button" data-action="copy-address" data-id="${esc(station.id)}">주소 복사</button><button type="button" data-action="share" data-id="${esc(station.id)}">공유</button><button type="button" data-action="save" data-id="${esc(station.id)}" aria-pressed="${state.favorites.has(station.id)}">${state.favorites.has(station.id)?'찜 해제':'찜하기'}</button></div>
   </section>
   <section class="focus-tab-panel" data-detail-panel="detail" hidden>
     <h3>가격 · 시설 상세</h3>
     <dl class="focus-detail-meta"><dt>선택 유종</dt><dd>${esc(currentFuel)} ${selectedPrice?money(selectedPrice.price)+'원/L':'가격 미제공'}</dd><dt>가격 기준</dt><dd>${esc(priceBasis)}</dd><dt>수집 시각</dt><dd>${esc(formatTime(selectedPrice?.fetchedAt))}</dd><dt>자료 출처</dt><dd><a href="https://www.opinet.co.kr/" target="_blank" rel="noopener noreferrer">${esc(selectedPrice?.source?.name||'한국석유공사 오피넷')} ↗</a></dd><dt>시설</dt><dd>${esc(facilityLabels.join(' · ')||'시설 정보 미제공')}</dd><dt>거리</dt><dd>${hasMapCoordinates(station)?`검색 중심에서 직선 ${(distanceMeters(state.center,station)/1000).toFixed(1)} km`:'좌표 확인 중'}</dd></dl>
     ${!confidence.eligible?'<p class="detail-warn">가격 기준시각이 확인되지 않았거나 오래된 자료는 최저가·절약액 추천에서 제외합니다.</p>':''}
   </section>
 </div>`;
 $('detail-content').querySelectorAll('[data-detail-tab]').forEach(button=>button.addEventListener('click',()=>{
   const tab=button.dataset.detailTab;
   $('detail-content').querySelectorAll('[data-detail-tab]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-selected',String(active));});
   $('detail-content').querySelectorAll('[data-detail-panel]').forEach(panel=>panel.hidden=panel.dataset.detailPanel!==tab);
 }));
}
async function shareStation(id){const st=state.all.find(s=>s.id===id);if(!st)return;const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('station',id);url.searchParams.set('fuel',state.fuel);if(hasMapCoordinates(st)){url.searchParams.set('slat',String(st.lat));url.searchParams.set('slng',String(st.lng));}const p=getFuelPrice(st,state.fuel);const text=`${st.name} · ${FUEL_TYPES.find(f=>f.code===state.fuel).name} ${p?`${money(p.price)}원/L`:'가격 미확인'}\n가격 기준 ${['daily_current_file','daily_price_file'].includes(p?.priceTimeStatus)?`일일 판매가격 ${p?.sourceDate||'기준일 미확인'}`:formatTime(p?.priceUpdatedAt)} · 한국석유공사 오피넷\n현장 가격은 달라질 수 있습니다.`;try{if(navigator.share)await navigator.share({title:`${st.name} | 주유한눈`,text,url:url.href});else{await navigator.clipboard.writeText(`${text}\n${url.href}`);toast('주유소 링크를 복사했습니다.');}}catch(e){if(e.name!=='AbortError')toast('공유 기능을 사용할 수 없습니다. 주소를 직접 복사해 주세요.');}}
async function search(query,target='search-candidates',onPick){const ticket=++state.searchGeneration;const box=$(target);if(!query.trim()){box.hidden=true;return;}box.hidden=false;box.innerHTML='<p>주소를 찾고 있습니다…</p>';try{if(!state.mapReady)throw new Error('지도가 준비되면 주소를 찾을 수 있습니다.');const results=await map.searchAddress(query.trim());if(ticket!==state.searchGeneration)return;if(!results.length){box.innerHTML='<p>검색 결과가 없습니다. 도로명 또는 지번 주소로 검색해 주세요.</p>';return;}box.innerHTML='';results.slice(0,6).forEach(item=>{const b=document.createElement('button');b.type='button';b.innerHTML=`<strong>${esc(item.name||item.address)}</strong><small>${esc(item.address||'')}</small>`;b.addEventListener('click',()=>{box.hidden=true;onPick(item);});box.appendChild(b);});}catch(error){if(ticket===state.searchGeneration)box.innerHTML=`<p>${esc(error.message||'주소 검색을 이용할 수 없습니다.')}</p>`;}}

document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>selectView(b.dataset.view)));
document.querySelectorAll('[data-fuel]').forEach(b=>{b.classList.toggle('active',b.dataset.fuel===state.fuel);b.setAttribute('aria-pressed',String(b.dataset.fuel===state.fuel));b.addEventListener('click',()=>{if(state.fuel===b.dataset.fuel)return;state.fuel=b.dataset.fuel;saveStorage('juyu:fuel:v1',state.fuel);document.querySelectorAll('[data-fuel]').forEach(x=>{const active=x.dataset.fuel===state.fuel;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));});render();if($('detail-dialog').open)renderDetail();});});
$('query').addEventListener('input',()=>{state.listLimit=60;++state.searchGeneration;$('search-candidates').hidden=true;state.query=$('query').value;render();});
$('brand-filter').addEventListener('change',()=>{state.brand=$('brand-filter').value;render();});
$('self-only').addEventListener('change',()=>{state.self=$('self-only').checked;render();});
$('fresh-only').addEventListener('change',()=>{state.freshOnly=$('fresh-only').checked;render();});
$('sort').addEventListener('change',()=>{state.sort=$('sort').value;render();});
$('toggle-filters').addEventListener('click',()=>{const open=$('extra-filters').hidden;$('extra-filters').hidden=!open;$('toggle-filters').setAttribute('aria-expanded',String(open));});
$('refresh').addEventListener('click',loadData);
$('reset-map').addEventListener('click',()=>{state.center={...APP_CONFIG.defaultCenter};if(state.mapReady){map.setCenter(state.center);map.setZoom(mobileMapView.isMobile()?(APP_CONFIG.mobileDefaultZoom||15):APP_CONFIG.defaultZoom);}});
$('zoom-in').addEventListener('click',()=>{if(state.mapReady)map.zoomBy(1);});
$('zoom-out').addEventListener('click',()=>{if(state.mapReady)map.zoomBy(-1);});
$('map-type-toggle').addEventListener('click',()=>{const b=$('map-type-toggle');if(!state.mapReady)return;const result=map.toggleMapType();if(!result.supported){b.hidden=true;return;}const satellite=result.type==='satellite';b.setAttribute('aria-pressed',String(satellite));b.setAttribute('aria-label',satellite?'일반 지도 보기':'위성 지도 보기');b.title=satellite?'일반 지도 보기':'위성 지도 보기';});
$('focus-rescan').addEventListener('click',()=>{if(!state.mapReady)return;updateViewport({center:map.getCenter(),bounds:map.getBounds()});toast('현재 지도 영역의 주유소를 다시 확인했습니다.');});
$('focus-dock-list').addEventListener('click',()=>openFocusList());
$('focus-dock-more').addEventListener('click',()=>showDialog('info-dialog'));
$('locate').addEventListener('click',async()=>{const b=$('locate');b.disabled=true;try{if(!state.mapReady)throw new Error('지도가 준비되는 중입니다.');const position=await map.locate();state.center={lat:position.lat,lng:position.lng};toast('현재 위치 주변으로 이동했습니다.');}catch(error){toast(error.message||'현재 위치를 확인하지 못했습니다. 위치 권한을 확인해 주세요.');}finally{b.disabled=false;}});
for(const id of ['open-info','footer-info'])$(id).addEventListener('click',()=>showDialog('info-dialog'));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.close==='detail-dialog'&&mobileMapView.isMobile())mobileMapView.closeDetail();else closeDialog(b.dataset.close);}));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}));
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,id=b.dataset.id;if(action==='load-more'){state.listLimit+=60;render();}else if(action==='detail')selectStation(id);else if(action==='save')toggleFavorite(id);else if(action==='show-list')openFocusList();else if(action==='copy-address'){const st=state.all.find(s=>s.id===id);if(st){try{await navigator.clipboard.writeText(st.roadAddress||st.address||'');toast('주소를 복사했습니다.');}catch{toast('주소 복사를 사용할 수 없습니다.');}}}else if(action==='share')shareStation(id);else if(action==='retry')loadData();else if(action==='show-old'){state.freshOnly=false;$('fresh-only').checked=false;render();}else if(action==='zone'){const zone=state.envelope?.coverage?.zones?.find(z=>z.id===b.dataset.zone);if(zone?.center){state.center=zone.center;if(state.mapReady)map.setCenter(zone.center);}}else if(action==='reset-filters'){state.query='';state.brand='';state.self=false;state.freshOnly=false;$('fresh-only').checked=false;$('query').value='';$('brand-filter').value='';$('self-only').checked=false;render();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();if(Date.now()-lastDataCheckAt>=DATA_REFRESH_MS)loadData();}});
window.addEventListener('online',loadData);
setInterval(()=>{if(!document.hidden){render();if($('detail-dialog').open)renderDetail();}},60000);
setInterval(()=>{if(!document.hidden)loadData();},DATA_REFRESH_MS);

loadData();
map.init().then(()=>{state.mapReady=true;$('map-loading')?.remove();map.setCenter(state.center);updateViewport({center:map.getCenter(),bounds:map.getBounds()});}).catch(()=>{state.mapFailed=true;$('map-loading')?.remove();setMapNotice('지도를 불러오지 못했습니다. 지도 연결 후 화면 안의 주유소를 확인할 수 있습니다.');render();});

