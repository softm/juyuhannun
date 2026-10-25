import { APP_CONFIG } from '../config.js';
import { MapController } from './map.js';
import { escapeHTML as esc, money, finite, getFuelPrice, formatTime, freshness } from './core.js';
import { isKoreanPoint, safeSourceUrl, visibleBenchmarks, energyCacheKey, retainEnergySnapshot } from './energy-core.js';
import { mountBottomAd } from './adfit.js';

const $ = id => document.getElementById(id);
mountBottomAd();
const apiBase = (APP_CONFIG.apiBase || (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? '/api' : '')).replace(/\/$/, '');
const sources = {
  averages: { eyebrow: 'FUEL PRICE REFERENCE', title: '우리 지역 기름값,<br>평균과 비교하세요.', description: '전국·지역별 평균으로 가격 흐름을 확인하세요.', label: '평균 유가', sourceName: '한국석유공사 오피넷', url: 'https://www.opinet.co.kr/user/custapi/custApiInfo.do', field: 'benchmarks', path: 'benchmarks', file: 'averages.json', symbol: '▥' },
  highway: { eyebrow: 'HIGHWAY FUEL', title: '고속도로 위에서도<br>가격을 확인하세요.', description: '휴게소 이름과 노선·운행 방향을 함께 확인하세요.', label: '고속도로 주유소', sourceName: '한국도로공사', url: 'https://data.ex.co.kr/openapi/basicinfo/openApiInfoM?apiId=0312', field: 'stations', path: 'highway-stations', file: 'highway.json', symbol: '↗' },
  hydrogen: { eyebrow: 'HYDROGEN REFERENCE', title: '수소 가격은<br>기준월을 확인하세요.', description: '수소충전소별 직전월 평균 판매가격에 관한 공식 자료 안내입니다.', label: '수소 월평균 정보', sourceName: '한국석유관리원', url: 'https://www.data.go.kr/data/15145097/openapi.do', symbol: 'H₂' },
};
const allFuels = [['B027', '휘발유'], ['D047', '경유'], ['B034', '고급휘발유'], ['K015', 'LPG'], ['C004', '실내등유']];
const highwayFuels = allFuels.filter(([code]) => ['B027', 'D047', 'K015'].includes(code));
const state = {
  view: 'averages', envelope: null, records: [], visible: [], center: { ...APP_CONFIG.defaultCenter },
  fuel: 'B027', sido: '', includeSigun: false, query: '', selected: null,
  generation: 0, controller: null, ready: false, loading: false, locating: false, cache: new Map(), regions: new Map(), mapNotice: '',
};
let toastTimer, searchRevision = 0, mapTask;

function toast(text) {
  $('energy-toast').textContent = text;
  $('energy-toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('energy-toast').hidden = true; }, 5000);
}

const map = new MapController($('energy-map'), {
  onCenterChange: center => { state.center = center; },
  onSelect: id => openDetail(id),
  onState: ({ status, provider, message }) => {
    state.mapNotice = status === 'error' || status === 'tile-error' || provider === 'leaflet' ? message || '대체 지도를 표시합니다.' : '';
    renderMapNotice();
  },
  markerPresentation: row => {
    const p = getFuelPrice(row, state.fuel), stale = isRetained(row) || !p || !freshness(p.priceUpdatedAt, p.fetchedAt).eligible;
    return { value: money(p?.price), unit: '원/L', stale, label: `${row.name}, ${fuelName(state.fuel)} ${money(p?.price)}원/L, ${isRetained(row) ? '이전 수집자료, ' : ''}가격 기준시각 ${displayTime(p?.priceUpdatedAt)}` };
  },
});

function ensureMap() {
  if (state.ready || mapTask) return;
  mapTask = map.init().then(() => {
    state.ready = true;
    $('energy-map-loading')?.remove();
    render();
  }).catch(() => {
    $('energy-map-loading')?.remove();
    state.mapNotice = '지도를 불러오지 못했습니다. 목록과 상세정보를 확인할 수 있습니다.';
    renderMapNotice();
  }).finally(() => { mapTask = null; });
}

function fuelName(code) { return allFuels.find(([fuel]) => fuel === code)?.[1] || '유종'; }
function recordsFor(envelope, view = state.view) { const field = sources[view].field; return field && Array.isArray(envelope?.[field]) ? envelope[field] : []; }
function displayTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return '미제공·미확인';
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.now() + 300_000 ? formatTime(value) : '미제공·미확인';
}
function referenceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '미제공·미확인';
  const date = new Date(`${value}T00:00:00.000Z`);
  const todayKST = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= todayKST ? value : '미제공·미확인';
}
function hasPreviousWarning() { return Array.isArray(state.envelope?.warnings) && state.envelope.warnings.some(warning => warning?.code === 'PRESERVED_PREVIOUS_SNAPSHOT'); }
function isRetained(row) {
  const envelope = state.envelope;
  if (envelope?.cache?.clientRetained || hasPreviousWarning()) return true;
  const dataset = row?.scope && Array.isArray(envelope?.datasets) && envelope.datasets.find(item => item?.scope === row.scope);
  return dataset ? dataset.cache?.stale === true : envelope?.cache?.stale === true;
}
function setBusy() {
  $('energy-results').setAttribute('aria-busy', String(state.loading));
  $('energy-refresh').disabled = state.loading;
  $('energy-refresh').textContent = state.loading ? '조회 중…' : '새로고침 ↻';
  $('energy-locate').disabled = !state.ready || state.locating;
  $('energy-home').disabled = !state.ready;
}

async function loadData() {
  const generation = ++state.generation;
  state.controller?.abort();
  state.controller = null;
  if (state.view === 'hydrogen') {
    state.loading = false;
    state.envelope = { status: 'reference_only' };
    state.records = [];
    render();
    return;
  }
  const view = state.view, source = sources[view];
  const scope = { fuel: state.fuel, sido: state.sido, includeSigun: state.includeSigun };
  const key = energyCacheKey(view, scope), previous = state.cache.get(key), ctrl = new AbortController();
  state.controller = ctrl;
  state.envelope = previous || null;
  state.records = recordsFor(previous, view);
  state.loading = true;
  render();
  const query = new URLSearchParams();
  if (view === 'averages') {
    query.set('fuel', scope.fuel);
    if (scope.sido) query.set('sido', scope.sido);
    if (scope.includeSigun) query.set('includeSigun', 'true');
  }
  const url = apiBase ? `${apiBase}/${source.path}${query.size ? `?${query}` : ''}` : `./data/${source.file}?v=${Math.floor(Date.now() / 60000)}`;
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const response = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (generation !== state.generation) return;
    if (!data || !Array.isArray(data[source.field]) || !['ready', 'partial', 'error', 'awaiting_credentials'].includes(data.status)) throw new Error('Invalid public data response');
    if (!response.ok && !['error', 'awaiting_credentials'].includes(data.status)) throw new Error('Public data request failed');
    state.envelope = retainEnergySnapshot(data, previous, view);
    state.records = recordsFor(state.envelope, view);
    if (['ready', 'partial'].includes(state.envelope.status)) state.cache.set(key, state.envelope);
    if (view === 'averages') updateAverageRegions();
  } catch (error) {
    if (generation !== state.generation) return;
    const failed = {
      status: 'error', [source.field]: [], fetchedAt: null,
      error: { message: error.name === 'AbortError' ? '자료 응답이 지연되고 있습니다. 잠시 후 다시 조회해 주세요.' : '자료를 가져오지 못했습니다. 잠시 후 다시 조회해 주세요.' },
    };
    state.envelope = retainEnergySnapshot(failed, previous, view);
    state.records = recordsFor(state.envelope, view);
    if (state.records.length) state.cache.set(key, state.envelope);
  } finally {
    clearTimeout(timer);
    if (generation === state.generation) {
      state.controller = null;
      state.loading = false;
      render();
    }
  }
}

function updateAverageControls() {
  const canQueryDistricts = Boolean(apiBase && state.sido);
  if (!canQueryDistricts) state.includeSigun = false;
  $('energy-sigun').disabled = !canQueryDistricts;
  $('energy-sigun').checked = state.includeSigun;
  $('energy-average-help').textContent = apiBase
    ? state.sido ? '시군구 평균을 함께 조회할 수 있습니다. 각 자료의 기준일을 확인하세요.' : '지역을 선택하면 해당 시도의 시군구 평균도 조회할 수 있습니다.'
    : '현재는 수집된 전국·시도 평균을 제공합니다. 시군구 추가 조회는 아직 제공되지 않습니다.';
}
function updateAverageRegions() {
  for (const row of state.records) {
    if (row?.dataGranularity === 'aggregate' && row.scope === 'sido' && /^\d{2}$/.test(row.sidoCode) && row.sidoCode !== '00') {
      state.regions.set(row.sidoCode, row.areaName || row.sidoCode);
    }
  }
  const select = $('energy-average-region');
  select.replaceChildren(new Option('전국 · 모든 시도', ''));
  for (const [code, name] of [...state.regions].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ko'))) select.add(new Option(name, code));
  select.value = state.sido;
  updateAverageControls();
}

function closeDetail() { if ($('energy-detail').open) $('energy-detail').close(); }
function selectView(view) {
  if (!Object.hasOwn(sources, view)) return;
  ++searchRevision;
  if (state.ready) map.setCenter(map.getCenter());
  closeDetail();
  state.view = view;
  state.query = '';
  state.selected = null;
  $('energy-query').value = '';
  const source = sources[view], fuels = view === 'averages' ? allFuels : highwayFuels;
  $('energy-fuel').replaceChildren(...fuels.map(([code, name]) => new Option(name, code)));
  if (!fuels.some(([code]) => code === state.fuel)) state.fuel = 'B027';
  $('energy-fuel').value = state.fuel;
  document.querySelectorAll('[data-energy]').forEach(button => {
    const selected = button.dataset.energy === view;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  $('energy-eyebrow').textContent = source.eyebrow;
  $('energy-title').innerHTML = source.title;
  $('energy-description').textContent = source.description;
  $('energy-result-title').textContent = source.label;
  $('energy-source').href = source.url;
  $('energy-source').textContent = `${source.sourceName} 자료 안내 ↗`;
  $('energy-filters').hidden = view === 'hydrogen';
  $('energy-average-filters').hidden = view !== 'averages';
  $('energy-query').placeholder = view === 'averages' ? '표시된 지역 이름 검색' : '주유소 이름 또는 노선 검색';
  $('energy-query-label').textContent = view === 'averages' ? '평균유가 지역 이름 검색' : '고속도로 주유소 이름, 주소 또는 노선 검색';
  document.body.classList.toggle('energy-reference-view', view !== 'highway');
  $('energy-map').hidden = view !== 'highway';
  $('energy-map-buttons').hidden = view !== 'highway';
  $('energy-mobile-toggle').hidden = view !== 'highway';
  $('energy-inline-status').hidden = view === 'highway';
  $('energy-status').hidden = view !== 'highway';
  updateAverageControls();
  renderMapMessage();
  const url = new URL(location.href);
  url.searchParams.set('view', view);
  history.replaceState(null, '', url);
  loadData();
  if (view === 'highway') ensureMap();
}

function queryMatches(row) {
  return !state.query || [row.name, row.address, row.routeName, row.direction, row.operator].filter(Boolean).join(' ').toLocaleLowerCase('ko').includes(state.query.toLocaleLowerCase('ko'));
}
function render() {
  if (state.view === 'hydrogen') { state.visible = []; renderHydrogen(); }
  else if (state.view === 'averages') {
    state.visible = visibleBenchmarks(state.records, { fuel: state.fuel, sido: state.sido, query: state.query, includeSigun: state.includeSigun });
    if (state.visible.length) renderAverages(); else renderEmpty();
  } else {
    state.visible = state.records.filter(row => row && row.dataGranularity === 'station' && row.unit === 'KRW/L' && typeof row.id === 'string' && typeof row.name === 'string' && queryMatches(row) && getFuelPrice(row, state.fuel));
    state.visible.sort((a, b) => getFuelPrice(a, state.fuel).price - getFuelPrice(b, state.fuel).price || a.name.localeCompare(b.name, 'ko'));
    if (state.visible.length) $('energy-results').innerHTML = warningHTML() + state.visible.slice(0, 200).map(highwayCard).join(''); else renderEmpty();
  }
  if (state.selected && !state.visible.some(row => row.id === state.selected)) { state.selected = null; closeDetail(); }
  if ($('energy-detail').open) renderDetail();
  $('energy-count').textContent = state.view === 'hydrogen' ? '공식 안내' : String(state.visible.length);
  const restricted = state.envelope?.coverage?.complete === false;
  $('energy-coverage').textContent = state.view === 'hydrogen' ? '' : state.view === 'highway' && state.visible.length > 200 ? '가격순 200곳 표시' : restricted && state.records.length ? '수집된 범위 자료' : '';
  const mapped = state.view === 'highway' ? state.visible.slice(0, 200).filter(isKoreanPoint) : [];
  if (state.ready) map.setStations(mapped, state.selected, state.fuel);
  $('energy-map-message').hidden = state.view === 'highway' && mapped.length > 0;
  setBusy();
  renderStatus();
  renderMapNotice();
}

function warningHTML() {
  if (hasPreviousWarning() || state.envelope?.cache?.clientRetained) return '<p class="energy-warning">새 조회에 실패해 이전 수집자료를 표시합니다. 가격 기준일과 수집시각은 이전 값 그대로입니다.</p>';
  if (state.envelope?.cache?.stale) return '<p class="energy-warning">일부 자료는 이전 수집 결과입니다. 각 항목의 기준일과 수집시각을 확인하세요.</p>';
  if (state.envelope?.status === 'partial') return '<p class="energy-warning">일부 자료를 확인하지 못했습니다. 표시된 지역·유종과 기준일을 확인하세요.</p>';
  return '';
}
function renderStatus() {
  const e = state.envelope, source = sources[state.view];
  let title = `${source.label} 자료 연결 대기`, message = `${source.sourceName}에서 현재 자료를 확인할 수 있습니다.`, status = 'pending';
  if (state.loading) {
    title = '공식 자료를 확인하고 있습니다';
    message = state.records.length ? `이전 수집 ${displayTime(e?.fetchedAt)} · 조회가 끝나면 표시를 갱신합니다.` : '잠시만 기다려 주세요.';
  } else if (state.view === 'hydrogen') {
    title = '수소 월평균 자료 안내';
    message = '충전소별 평균가격 수치는 아직 제공되지 않습니다.';
  } else if (state.view === 'highway' && e?.implementationReady === false) {
    title = '고속도로 가격 자료 연결 준비';
    message = '현재 가격은 한국도로공사에서 확인해 주세요.';
  } else if (hasPreviousWarning() || e?.cache?.clientRetained) {
    title = '새 조회 실패 · 이전 자료 표시';
    message = `마지막 수집 ${displayTime(e?.fetchedAt)} · 가격 기준일은 각 항목에서 확인하세요.`;
    status = 'error';
  } else if (e?.status === 'error') {
    title = '새 자료를 확인하지 못했습니다';
    message = '잠시 후 새로고침하거나 제공기관에서 확인해 주세요.';
    status = 'error';
  } else if (['ready', 'partial'].includes(e?.status)) {
    title = state.view === 'averages' ? '전국·지역 평균 참고자료' : '고속도로 주유소 가격';
    message = `수집 ${displayTime(e.fetchedAt)} · ${state.view === 'averages' ? '가격 기준일은 항목별 표시' : '실제 가격 변경시각은 별도 확인'}`;
    if (e.cache?.stale) { title += ' · 이전 자료 포함'; status = 'error'; }
    else if (e.status === 'partial') { title += ' · 일부 범위'; status = 'pending'; }
    else status = 'ready';
  }
  const html = `<span class="source-dot"></span><div><strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;
  for (const id of ['energy-status', 'energy-inline-status']) { $(id).innerHTML = html; $(id).dataset.state = status; }
}
function renderMapNotice() {
  $('energy-map-notice').textContent = state.mapNotice;
  $('energy-map-notice').hidden = state.view !== 'highway' || !state.mapNotice;
}
function renderMapMessage() {
  const content = state.view === 'averages'
    ? ['AVERAGE PRICE', '비교의 기준을<br>함께 확인하세요.', '같은 유종과 기준일의 지역 평균을 살펴보세요.<br>실제 주유소 판매가격은 가격 비교 화면에서 확인할 수 있습니다.', [['전국·지역', '평균 원/L'], ['가격 기준', '자료의 기준일'], ['수집', '자료를 받은 시각']]]
    : state.view === 'hydrogen'
      ? ['HYDROGEN', '수소 가격 자료,<br>기준연월부터.', '충전소별 직전월 평균 판매가격에 관한 자료입니다.<br>실제 충전 전 당일 가격과 영업 여부를 확인하세요.', [['대상', '수소충전소'], ['가격 기준', '직전월 평균'], ['현재 제공', '공식 자료 안내']]]
      : ['HIGHWAY FUEL', '노선과 운행 방향을<br>함께 확인하세요.', '위치가 확인된 주유소만 지도에 표시합니다.<br>좌표가 없는 시설도 목록에서 가격과 업체 정보를 확인할 수 있습니다.', [['주유 가격', '원/L'], ['이용 방향', '노선·방향'], ['가격 시각', '보고 여부 확인']]];
  $('energy-map-message').innerHTML = `<span class="tag">${content[0]}</span><h2>${content[1]}</h2><p>${content[2]}</p><div class="energy-unit-row">${content[3].map(([label, value]) => `<span>${label}<b>${value}</b></span>`).join('')}</div>`;
}

function renderEmpty() {
  const source = sources[state.view];
  if (state.loading && !state.records.length) {
    $('energy-results').innerHTML = '<div class="energy-empty energy-loading"><div class="spinner" aria-hidden="true"></div><h3>공식 자료를 조회하고 있어요</h3><p>자료가 도착하면 가격 기준일과 수집시각을 함께 보여드립니다.</p></div>';
    return;
  }
  const unconnected = !state.envelope || state.envelope.status === 'awaiting_credentials';
  let title = unconnected ? '아직 가격 자료가 연결되지 않았어요' : '이 조건의 자료가 없습니다';
  let description = unconnected ? `${source.sourceName}에서 가격과 제공 범위를 확인할 수 있습니다.` : '유종·지역·검색어를 확인해 주세요. 수집 범위 밖의 자료는 표시되지 않습니다.';
  if (state.envelope?.status === 'error') { title = '자료를 가져오지 못했어요'; description = '잠시 후 새로고침하거나 제공기관에서 확인해 주세요.'; }
  if (state.view === 'highway' && state.envelope?.implementationReady === false) {
    title = '고속도로 가격 정보를 준비하고 있어요';
    description = '아직 이 화면에서 가격을 제공하지 않습니다. 현재 가격과 업체 정보는 한국도로공사에서 확인해 주세요.';
  }
  const facts = state.view === 'highway'
    ? [['비교 대상', '고속도로 주유소의 유종별 판매가격과 업체 정보'], ['가격 시각', '가격 변경시각이 제공되지 않으면 미제공으로 표시합니다.'], ['지도와 경로', '검증된 위치가 있는 시설만 지도에 표시합니다. 노선·운행 방향을 확인하세요.']]
    : [['통계 단위', '전국·시도·시군구의 유종별 평균가격'], ['기준 날짜', '원본에 기준일이 없으면 미제공으로 표시합니다.'], ['가격 비교', '개별 주유소 판매가격은 주유소 가격 비교 화면에서 확인하세요.']];
  $('energy-results').innerHTML = `${warningHTML()}<div class="energy-empty"><div class="energy-empty-symbol" aria-hidden="true">${source.symbol}</div><h3>${esc(title)}</h3><p>${esc(description)}</p><a class="small-button" href="${source.url}" target="_blank" rel="noopener noreferrer">${source.sourceName}에서 확인 ↗</a><div class="energy-facts">${facts.map(([label, detail]) => `<div><strong>${label}</strong><span>${detail}</span></div>`).join('')}</div></div>`;
}
function highwayCard(row) {
  const price = getFuelPrice(row, state.fuel), retained = isRetained(row);
  return `<article class="energy-card${state.selected === row.id ? ' selected' : ''}"><h3>${esc(row.name)}</h3><p class="energy-card-sub">${esc([row.routeName, row.direction, row.operator].filter(Boolean).join(' · ') || '노선·운영 방향 정보 미제공')}</p><div class="energy-card-price">${money(price?.price)}<small>원/L · ${fuelName(state.fuel)}</small></div><span class="confidence unknown">${retained ? '이전 수집자료 · ' : ''}가격 기준 ${esc(displayTime(price?.priceUpdatedAt))}</span><p class="energy-card-note">수집 ${esc(displayTime(price?.fetchedAt || row.fetchedAt))}</p><div class="energy-card-actions"><button type="button" class="small-button secondary" data-energy-detail="${esc(row.id)}">업체·유종별 가격</button>${isKoreanPoint(row) ? '<span class="tag">지도 위치 있음</span>' : '<span class="energy-card-note">좌표 미제공</span>'}</div></article>`;
}
function renderAverages() {
  $('energy-results').innerHTML = warningHTML() + '<p class="aggregate-note">전국·지역의 평균 판매가격입니다. 같은 유종·기준일끼리 비교하세요. 수집시각은 가격 기준일과 다릅니다.</p>' + state.visible.map(row => {
    const amount = finite(row.averagePrice) && row.averagePrice > 0 && row.averagePrice <= 100_000 ? row.averagePrice.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '—';
    const change = finite(row.dayOverDayChange) && Math.abs(row.dayOverDayChange) <= 100_000 ? `전일 대비 ${row.dayOverDayChange > 0 ? '+' : ''}${row.dayOverDayChange.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원` : '전일 대비 미제공';
    const source = safeSourceUrl(row.source?.documentationUrl || row.source?.url, sources.averages.url);
    return `<article class="benchmark-row"><div><h3>${esc(row.areaName || row.areaCode || '지역 미확인')} · ${esc(row.fuelName || fuelName(row.fuel))}</h3><p>기준일 ${esc(referenceDate(row.asOfDate))}<br>수집 ${esc(displayTime(row.fetchedAt))}</p>${isRetained(row) ? '<span class="confidence stale">이전 수집자료</span>' : ''}<a class="benchmark-source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">오피넷 자료 안내 ↗</a></div><div class="benchmark-value"><strong>${amount}<small>원/L</small></strong><p>${change}</p></div></article>`;
  }).join('');
}
function renderHydrogen() {
  $('energy-results').innerHTML = `<div class="energy-empty"><div class="energy-empty-symbol" aria-hidden="true">H₂</div><h3>수소충전소별 직전월 평균가격</h3><p>한국석유관리원의 수소충전소별 직전월 평균 판매가격 자료입니다. 기준연월을 확인하고 이용하세요.</p><a class="small-button" href="${sources.hydrogen.url}" target="_blank" rel="noopener noreferrer">수소 월평균 공식 자료 ↗</a><div class="energy-facts"><div><strong>대상</strong><span>수소충전소별 평균 판매가격</span></div><div><strong>기간</strong><span>공식 자료에서 제공하는 기준연월</span></div><div><strong>현재 제공</strong><span>공식 자료 안내를 제공합니다. 개별 충전소의 월평균 수치는 아직 표시되지 않습니다.</span></div><div><strong>이용 전 확인</strong><span>당일 판매가격·영업 여부·충전 가능 여부를 충전소에서 확인하세요.</span></div></div></div>`;
}

function openDetail(id) {
  if (state.view !== 'highway') return;
  const row = state.visible.find(item => item.id === id);
  if (!row) return;
  state.selected = id;
  if (state.ready && isKoreanPoint(row)) map.focus(row, { preserveZoom: true });
  render();
  renderDetail();
  if (!$('energy-detail').open) $('energy-detail').showModal();
}
function renderDetail() {
  const row = state.view === 'highway' && state.visible.find(item => item.id === state.selected);
  if (!row) { closeDetail(); return; }
  const source = sources.highway;
  const nav = isKoreanPoint(row) ? `https://map.kakao.com/link/to/${encodeURIComponent(row.name)},${row.lat},${row.lng}` : null;
  const prices = highwayFuels.map(([fuel, name]) => {
    const price = getFuelPrice(row, fuel);
    return `<tr><th scope="row">${name}</th><td>${price ? `${money(price.price)}원/L` : '미제공'}</td><td>${esc(displayTime(price?.priceUpdatedAt))}</td><td>${esc(displayTime(price?.fetchedAt))}</td></tr>`;
  }).join('');
  $('energy-detail-content').innerHTML = `<span class="eyebrow">${source.eyebrow}</span><h2 id="energy-detail-title">${esc(row.name)}</h2><p>${esc(row.address || '주소 정보 미제공')}</p>${warningHTML()}<dl><dt>노선·방향</dt><dd>${esc([row.routeName, row.direction].filter(Boolean).join(' · ') || '미제공')}</dd><dt>운영업체</dt><dd>${esc(row.operator || '미제공')}</dd><dt>시설 ID</dt><dd>${esc(row.id)}</dd></dl><div class="energy-price-table-wrap"><table class="energy-price-table"><caption>유종별 판매가격과 자료 시각</caption><thead><tr><th scope="col">유종</th><th scope="col">판매가격</th><th scope="col">가격 기준시각</th><th scope="col">수집시각</th></tr></thead><tbody>${prices}</tbody></table></div><p class="aggregate-note">수집시각은 가격이 변경된 시각과 다릅니다. 실제 이용 전 가격·노선·운행 방향과 진입 가능 여부를 확인하세요.</p><div class="energy-card-actions">${nav ? `<a class="small-button" href="${esc(nav)}" target="_blank" rel="noopener noreferrer">지도 길찾기 ↗</a>` : ''}<a class="small-button secondary" href="${esc(safeSourceUrl(row.source?.url, source.url))}" target="_blank" rel="noopener noreferrer">${source.sourceName} 원문 ↗</a></div>`;
}
function changeScope() {
  state.selected = null;
  closeDetail();
  $('energy-results').scrollTop = 0;
  loadData();
}

document.querySelectorAll('[data-energy]').forEach(button => button.addEventListener('click', () => selectView(button.dataset.energy)));
$('energy-query').addEventListener('input', () => { state.query = $('energy-query').value.trim(); render(); });
$('energy-fuel').addEventListener('change', () => { state.fuel = $('energy-fuel').value; changeScope(); });
$('energy-average-region').addEventListener('change', () => { state.sido = $('energy-average-region').value; updateAverageControls(); changeScope(); });
$('energy-sigun').addEventListener('change', () => { state.includeSigun = $('energy-sigun').checked; changeScope(); });
$('energy-refresh').addEventListener('click', loadData);
$('energy-mobile-toggle').addEventListener('click', () => {
  const expanded = document.body.classList.toggle('energy-list-expanded');
  $('energy-mobile-toggle').textContent = expanded ? '지도 넓게 보기' : '목록 넓게 보기';
  $('energy-mobile-toggle').setAttribute('aria-expanded', String(expanded));
});
$('energy-detail-close').addEventListener('click', closeDetail);
$('energy-detail').addEventListener('click', event => { if (event.target === $('energy-detail')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDetail(); } });
$('energy-detail').addEventListener('close', () => { const button = [...document.querySelectorAll('[data-energy-detail]')].find(item => item.dataset.energyDetail === state.selected); button?.focus({ preventScroll: true }); });
$('energy-results').addEventListener('click', event => { const button = event.target.closest('[data-energy-detail]'); if (button) openDetail(button.dataset.energyDetail); });
$('energy-home').addEventListener('click', () => { ++searchRevision; state.center = { ...APP_CONFIG.defaultCenter }; if (state.ready) map.setCenter(state.center); });
$('energy-locate').addEventListener('click', async () => {
  if (!state.ready || state.view !== 'highway') return;
  const revision = ++searchRevision;
  state.locating = true;
  $('energy-locate').disabled = true;
  try {
    const point = await map.locate();
    if (revision !== searchRevision) return;
    state.center = { lat: point.lat, lng: point.lng };
    toast('지도를 현재 위치로 이동했습니다. 목록은 수집된 고속도로 주유소의 가격순입니다.');
  } catch (error) { if (revision === searchRevision) toast(error.message || '현재 위치를 확인하지 못했습니다.'); }
  finally { state.locating = false; setBusy(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
const requestedView = new URLSearchParams(location.search).get('view');
selectView(Object.hasOwn(sources, requestedView) ? requestedView : 'averages');
