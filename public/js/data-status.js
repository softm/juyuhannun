import {escapeHTML as esc,formatTime} from './core.js';
const $=id=>document.getElementById(id),names={ready:'정상',partial:'일부 자료',error:'갱신 실패',awaiting_credentials:'연결 대기'};
const n=v=>Number.isFinite(v)?v.toLocaleString('ko-KR'):'—';
async function load(){
 $('reload').disabled=true;
 try{
  // Keep the data URL relative to the page, including for versioned JS assets.
  const response=await fetch(new URL('./data/status.json',document.baseURI),{cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('현황을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const d=await response.json();if(d.version!==1||!d.nationwide||!Array.isArray(d.collections))throw new Error('수집 현황 형식을 확인할 수 없습니다.');
  const c=d.nationwide;
  for(const [id,value] of [['total',c.totalPriceStations],['mapped',c.mappedPriceStations],['unmapped',c.unmappedPriceStations]])$(id).textContent=n(value)+'곳';
  $('ratio').textContent=n(Math.round(c.mappedRatio*1000)/10)+'%';$('price-date').textContent='가격 기준일 '+(c.priceDate||'미확인');
  const stale=Number.isFinite(Date.parse(c.fetchedAt))&&Date.now()-Date.parse(c.fetchedAt)>30*3600000;
  $('notice').className='notice'+(!c.serviceReady||stale?' warning':'');
  $('notice').textContent=(d.activeMap==='nationwide'?`전국 가격 ${n(c.totalPriceStations)}곳 중 좌표가 확인된 ${n(c.mappedPriceStations)}곳을 지도 자료로 사용합니다.`:'현재 지도는 지역 API에서 확보한 일부 자료를 사용합니다.')+(c.complete?'':' 전체 주유소가 모두 지도에 포함된 것은 아닙니다.')+(c.searchablePriceStations?` 전국 목록 검색에서는 좌표 미확보 주유소를 포함해 ${n(c.searchablePriceStations)}곳의 가격·주소를 확인할 수 있습니다.`:'')+(stale?' 수집 시각이 경과했습니다. 방문 전 가격을 확인하세요.':'');
  $('collections').innerHTML=d.collections.map(row=>`<tr><td>${esc(row.name)}</td><td><span class="badge ${esc(Object.hasOwn(names,row.status)?row.status:'error')}">${esc(names[row.status]||'확인 필요')}</span>${row.retained?'<br>이전 자료 보존':''}</td><td>${n(row.count)}</td><td>${esc(formatTime(row.fetchedAt))}</td><td>${esc(formatTime(row.lastAttempt?.at))}<br>${esc(names[row.lastAttempt?.status]||'미확인')}</td><td>${esc(row.schedule)}</td></tr>`).join('');
  $('issues').innerHTML=d.collections.filter(row=>row.error).map(row=>`<li>${esc(row.name)}: ${esc(row.error.message||'갱신 상태 확인 필요')} (${esc(row.error.code||'UNKNOWN')})</li>`).join('')+(c.standardDataStatus&&c.standardDataStatus!=='ready'?'<li>최신 공개 좌표 조회가 실패해 기존에 확보한 좌표를 사용했습니다.</li>':'');
  const fuels={B027:'휘발유',D047:'경유',B034:'고급휘발유',K015:'LPG'};
  $('fuels').innerHTML=(d.fuels||[]).map(row=>`<div class="fuel">${esc(fuels[row.code]||row.code)}<strong>${n(row.mappedStationCount)}곳</strong></div>`).join('');
  const q=d.quota;$('quota').textContent=q?`${q.day||''} 기준 ${n(q.used)} / ${n(q.limit)}회 사용 · 남은 ${n(q.remaining)}회. 전국 CSV 수집은 이 API 한도를 사용하지 않습니다.`:'API 사용량 자료가 없습니다. 전국 CSV 수집은 무료 API 호출 한도를 사용하지 않습니다.';
  $('sources').innerHTML=(d.sources||[]).filter(source=>{try{return new URL(source.url).protocol==='https:';}catch{return false;}}).map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.name)} ↗</a>`).join('');
  $('generated').textContent=`현황 생성 ${formatTime(d.generatedAt)} · 새로고침은 배포된 결과를 다시 읽습니다.`;
 }catch(error){$('notice').className='notice error';$('notice').textContent=error.name==='TimeoutError'?'현황 응답이 지연됩니다. 다시 시도해 주세요.':error.message;}
 finally{$('reload').disabled=false;}
}
$('reload').addEventListener('click',load);load();
