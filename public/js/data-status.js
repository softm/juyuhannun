import {escapeHTML as esc,formatTime} from './core.js';
import {availabilityAt} from './data-status-model.js';
const $=id=>document.getElementById(id),names={ready:'정상',partial:'일부 자료',error:'갱신 실패',awaiting_credentials:'연결 대기',awaiting_data:'자료 대기',paused_quota:'호출 예산 대기',success:'수집 성공',cached:'기존 자료 재사용',reused:'기존 자료 재사용'};
const n=v=>Number.isFinite(v)?v.toLocaleString('ko-KR'):'—';
const issueText=e=>e?.code?.startsWith('OPINET_DOWNLOAD')||e?.code==='OPINET_BROWSER_DOWNLOAD_ERROR'?'요청한 기준일의 전국 가격 파일을 확보하지 못했습니다. 이전 가격을 보존하며 다시 확인합니다.':e?.message||'갱신 상태 확인 필요';
const fuelNames={B027:'휘발유',D047:'경유',B034:'고급휘발유',K015:'LPG'};
let currentData=null,inFlight=null;
function renderAvailability(){
 if(!currentData)return;
 const now=Date.now(),d=currentData,c=d.nationwide,fuels=availabilityAt(d,now),gas=fuels.find(row=>row.code==='B027');
 const total=d.availability?.displayableStationCount??c.mappedPriceStations;
 $('notice').className='notice'+(!gas?.comparableStationCount?' warning':'');
 $('notice').textContent=`전국·지역 자료를 합쳐 좌표와 가격이 있는 ${n(total)}곳을 지도 자료로 제공합니다. 휘발유는 현재 ${n(gas?.comparableStationCount)}곳이 비교 기준을 충족하며, ${n(gas?.historicalStationCount)}곳은 참고 가격입니다. 모든 주유소가 지도에 포함된 것은 아닙니다.`;
 $('fuels').innerHTML=fuels.map(row=>`<div class="fuel">${esc(fuelNames[row.code]||row.code)}<strong>${n(row.mappedStationCount)}곳</strong><span class="eligible">비교 가능 ${n(row.comparableStationCount)}곳</span><span class="historical">참고 가격 ${n(row.historicalStationCount)}곳</span></div>`).join('');
 $('eligibility-time').textContent=`비교 가능 여부 확인: ${formatTime(new Date(now).toISOString())} · 가격 기준시각과 기준일로 다시 판단합니다.`;
}
function render(d){
 const c=d.nationwide,collection=c.collection||{};
 for(const [id,value] of [['total',c.totalPriceStations],['mapped',c.mappedPriceStations],['unmapped',c.unmappedPriceStations]])$(id).textContent=n(value)+'곳';
 $('ratio').textContent=n(Math.round(c.mappedRatio*1000)/10)+'%';
 $('last-success').textContent=formatTime(c.fetchedAt);
 $('price-date').textContent='실제 가격 기준일 '+(c.priceDate||'미확인');
 $('next-retry').textContent=collection.nextRetryAt?formatTime(collection.nextRetryAt):'예약 실행 때 확인';
 $('collection-state').textContent=(collection.nextRetryAt?'해당 시각 이후 첫 실행에서 재시도합니다. ':'')+(collection.expectedDate?`필요 기준일 ${collection.expectedDate} · `:'')+(collection.lastDownloadStatus==='error'?'최근 다운로드 실패':collection.usedPreviousDate?'이전 기준일 파일 사용 중':collection.checkedAt?`마지막 확인 ${formatTime(collection.checkedAt)}`:'수집 기록 확인 중');
 const statusLabel=row=>row.status==='partial'&&row.id==='nationwide'?'지도 표시 일부':row.status==='partial'&&row.id==='searchable'?'가격 원본 확보':names[row.status]||'확인 필요';
 $('collections').innerHTML=d.collections.map(row=>`<tr><td>${esc(row.name)}</td><td><span class="badge ${esc(Object.hasOwn(names,row.status)?row.status:'error')}">${esc(statusLabel(row))}</span>${row.retained?'<br>이전 자료 보존':row.reused?'<br>기존 자료 재사용':''}</td><td>${n(row.count)}</td><td>${esc(formatTime(row.fetchedAt))}</td><td>${esc(formatTime(row.lastAttempt?.at))}<br>${esc(names[row.lastAttempt?.status]||'미확인')}</td><td>${esc(row.schedule)}</td></tr>`).join('');
 const issues=d.collections.filter(row=>row.error).map(row=>`${row.name}: ${issueText(row.error)}`);
 if(collection.lastDownloadError)issues.push('전국 파일 최근 다운로드: '+issueText(collection.lastDownloadError));
 if(c.standardDataStatus&&c.standardDataStatus!=='ready')issues.push('최신 공개 좌표 조회가 실패해 이전에 확보한 좌표와 공식 ID 보완 좌표를 사용했습니다.');
 $('issues').innerHTML=[...new Set(issues)].map(message=>`<li>${esc(message)}</li>`).join('');
 const audit=d.comparisonAudit||{};
 const auditState=audit.status==='ready'||audit.status==='partial';
 $('comparison-audit').innerHTML=[[
  'API Top20 수집', n(audit.total)+'건'],
  ['공개파일과 ID·유종 일치', n(audit.matched)+'건'],
  ['가격 동일', n(audit.same)+'건'],
  ['가격 차이', n(audit.different)+'건'],
  ['공개파일 가격 미확인', n(audit.missing)+'건'],
  ['최대 가격 차이', Number.isFinite(audit.maxAbsDiff)?n(audit.maxAbsDiff)+'원/L':'—']
 ].map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
 $('comparison-audit-note').textContent=auditState
  ? '최근 API 비교 '+formatTime(audit.checkedAt)+' · 평균 절대 가격차 '+(Number.isFinite(audit.averageAbsDiff)?n(audit.averageAbsDiff)+'원/L':'—')+'. 가격 차이가 있으면 공개파일 갱신 지연 또는 API 시점 차이를 확인합니다.'
  : '현재 API 비교자료를 확보하지 못했습니다. 공개파일 수집은 계속 유지하며 다음 API 예산 회차에 다시 대조합니다.';
 const coordinates=d.coordinates||{},queue=coordinates.queue||{},attempt=coordinates.lastAttempt||{},budget=coordinates.budget||{},day=coordinates.dayBudget||{};
 const reasons={reserved_for_prices:'정규 가격 수집용 호출량을 남기고 대기합니다.',daily_budget:'오늘 좌표 보완 예산을 사용했습니다.',daily_budget_exhausted:'오늘 좌표 보완 예산을 사용했습니다.',run_budget:'이번 실행의 보완을 마쳤습니다.',run_budget_exhausted:'이번 실행의 보완을 마쳤습니다.',provider_error:'제공기관 응답 오류로 재시도를 기다립니다.',complete:'현재 보완 대상의 좌표를 모두 확인했습니다.',awaiting_credentials:'공식 API 연결을 기다리고 있습니다.'};
 $('coordinate-state').textContent=`${names[coordinates.status]||'확인 중'} · ${reasons[attempt.stopReason]||'실행마다 남은 호출량을 확인하며 좌표가 없는 주유소를 순서대로 조회합니다.'}`;
 $('coordinate-progress').innerHTML=[['공식 ID로 누적 보완',`${n(queue.enrichedCount)}곳`],['좌표 조회 대기 기록',`${n(queue.pendingCount)}곳`],['최근 실행 확보',`${n(attempt.successCount)}곳 / ${n(attempt.calls)}회 조회`],['마지막 좌표 확보',formatTime(coordinates.lastSuccessAt)]].map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
 $('coordinate-budget').textContent=`최근 작업 ${formatTime(attempt.completedAt||attempt.at)} · ${day.day||'오늘'} 좌표 보완 ${n(day.used)} / ${n(day.limit??80)}회 · 실행당 최대 ${n(budget.maxCallsPerRun??20)}회 · 전체 API에서 정규 수집용 ${n(budget.reservedCalls??40)}회 보존.`+(queue.nextRetryAt?` 실패 자료 재시도 가능 ${formatTime(queue.nextRetryAt)} 이후.`:'');
 const q=d.quota;$('quota').textContent=q?`${q.day||''} 기준 ${n(q.used)} / ${n(q.limit)}회 사용 · 남은 ${n(q.remaining)}회. 전국 CSV 수집은 이 API 한도를 사용하지 않습니다.`:'API 사용량 자료가 없습니다. 전국 CSV 수집은 무료 API 호출 한도를 사용하지 않습니다.';
 $('sources').innerHTML=(d.sources||[]).filter(source=>{try{return new URL(source.url).protocol==='https:';}catch{return false;}}).map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.name)} ↗</a>`).join('');
 $('generated').textContent=`현황 생성 ${formatTime(d.generatedAt)} · 새로고침은 배포된 결과를 다시 읽습니다.`;
 renderAvailability();
}
async function load(){
 if(inFlight)return inFlight;
 $('reload').disabled=true;
 inFlight=(async()=>{
  try{
   const response=await fetch(new URL('./data/status.json',document.baseURI),{cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error('현황을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
   const d=await response.json();if(d.version!==1||!d.nationwide||!Array.isArray(d.collections))throw new Error('수집 현황 형식을 확인할 수 없습니다.');
   currentData=d;render(d);
  }catch(error){$('notice').className='notice error';$('notice').textContent=(error.name==='TimeoutError'?'현황 응답이 지연됩니다. 다시 시도해 주세요.':error.message)+(currentData?' 마지막으로 읽은 현황을 유지합니다.':'');}
  finally{$('reload').disabled=false;inFlight=null;}
 })();return inFlight;
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
setInterval(()=>{if(!document.hidden)renderAvailability();},60000);
setInterval(()=>{if(!document.hidden)load();},300000);
$('reload').addEventListener('click',load);load();
