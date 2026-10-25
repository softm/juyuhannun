# 가는 길 주유 — 경로상 주유소 추천 기능 설계 v1.0

- 프로젝트: [주유한눈](https://github.com/softm/juyuhannun) / [서비스](https://softm.github.io/juyuhannun/)
- 대상: 웹(GitHub Pages) 및 Android WebView(`softm/juyuhannun.android`)
- 문서 상태: **설계 확정안 / 기능 코드는 미구현**
- 원칙: 기존 오피넷 수집·가격시각·지도 집중모드·경로 비용 계산 로직 재사용. 전체 서비스나 데이터 저장소 재배포 금지.

## 1. 목표와 정의

출발지→목적지를 입력하면 **기본 자동차 경로**를 구하고, 경로 주변 주유소들을 찾아 실제 자동차 우회 소요를 계산한 뒤, 사용자가 선택한 유종·주유량·차량 연비를 바탕으로 최저가, 최소 우회, 추천순, 경로 진행순으로 보여준다.

- **경로 인근 후보**: 경로 Polyline에 지리적으로 가까움. 실제 차량 접근 가능·우회거리 검증을 의미하지 않는다.
- **우회 검증 완료**: 동일 출발지·목적지·동일 경로 옵션에서 주유소를 경유하도록 재탐색해 추가 주행거리·시간·통행료를 얻음.
- **추천 TOP 5**: *우회 검증 완료* + *가격 비교 가능* + *사용자 제한조건 만족* 주유소에만 부여.
- **가격 절약액**: 명시적 기준 단가가 있는 경우에만 '기준 대비 예상 절약액'이라고 표기. 없으면 '주유비+추가 이동비 예상 합계'로 순위 결정.
- 경로 안내·가격은 추정치이며 내비게이션·현장 단가와 달라질 수 있다.

## 2. 기존 코드 재사용 지점 (2026-10-26 main 확인)

| 기존 | 역할 | 필요한 확장 |
|---|---|---|
| `public/js/app.js` | 목록·필터·마커·상세·검색·주행상태 | 별도 routeMode state, 탭/결과/상세 이벤트 |
| `public/js/core.js` | freshness / getFuelPrice / calculateSavings | 통합 비용 계산과 추천 정렬; 기존 freshness 정책 그대로 |
| `public/js/map.js` | showRoute / clearRoute / setStations / GPS | 기본경로·우회경로 별도 polyline, fitBounds 옵션, 시작·목적지 마커 |
| `public/js/mobile-map-view.js` | map-browse / focus-detail / expanded-tools / list-sheet | routeMode 중에도 기존 compact/expanded/full, drag, 뒤로가기 보존 |
| `server/route.mjs` | NaverRouteClient.request, route, predict | 기준경로 1회 + 후보별 경유경로 1회 재사용·캐시·쿼터 |
| `server/index.mjs` | 기존 GET /api/route, IP rate limit | 후보 일괄 추천 API, 입력 검증, 남용 방지 |
| `public/js/data-loader.js` | 전국 JSON+지역 자료 병합 | 재사용, 별도 전국 복제 금지 |
| `softm/juyuhannun.android` MainActivity | Android WebView, kakaomap 외부 scheme | 경유지+목적지 링크/앱 미설치 폴백 검증 |

**운영상 중요**: GitHub Pages의 `public/config.js` 기본 `apiBase: ''`이고 Pages는 정적 호스팅이다. 개발 저장소에 `/api/route`가 존재하는 것만으로 운영 경로 API가 작동하지 않는다. 경로 키를 숨겨 처리하는 HTTPS 엔드포인트만 따로 배포하고 `PUBLIC_API_BASE`를 연결해야 한다. 서버·DB에 주유소 스냅샷을 이중 보관할 필요는 없다.

## 3. 화면 및 상태 설계

### 3-1. 상단 탭

`지도 안 주유소 | 가는 길 주유 | 찜한 곳`

- 가는 길 주유 최초 진입: GPS 현재 위치(권한 필요) / 수동 출발지 선택; 목적지 입력(주소 검색·지도 지정·최근 목적지). 출발지↔목적지 교환 가능.
- 목적지는 '주소·장소명 검색 결과 중 선택'이 완료돼야 좌표 확정. 주소 탐색에 기존 `MapController.searchAddress()` 재사용, 장소명 POI 검색은 별도 공식 장소 검색 API를 확인한 후 연동. 좌표 임의 생성 금지.
- 유종은 기존 저장값을 사용; 주유량 기본 30L, 연비 기본 12km/L은 '**예시 가정**'으로 명확하게 노출, 편집 가능. 주유할 양/연비 미입력 시 비용 추정 대신 가격·우회거리 중심 노출.
- 기본 설정: 최대 우회 10분, 경로 인근 탐색반경 2km(초기 후보용). 반경 0.5/1/2/3km; 최대 우회 3/5/10/15분.
- 메인 버튼 '가는 길 주유소 찾기', 경로 결과와 TOP 5 카드 노출.
- 최근 목적지는 **선택적 기기 로컬 저장**, 위치 기록·경로 서버 영구저장 금지.

### 3-2. 결과 UI

상단: `출발지 → 목적지 | 기본경로 xx km · xx분 | 주유소 후보 n곳 · 우회 검증 m곳`.

정렬 칩: **추천순 / 최저가순 / 최소 우회순 / 경로 진행순**. 필터: 유종/셀프/정유사/최신가격/최대우회. 경로 편집 및 '다시 탐색' 유지.

카드 필드: 순위, 주유소명, 원/L, 가격기준일, 경로 진행 지점(예: 42km 지점), '+1.4km / +4분' 또는 '우회 미검증', 예상 주유비, 추가 이동비, 근거('추천: 가격+우회비 최소'), 길안내.
- '가장 저렴'과 '가장 추천'은 다른 속성, 구분 표시.
- 일일/개별 가격의 신뢰도는 기존 `freshness()` 판정과 동일; 참고값은 별도 영역에 보이되 추천·최저가 제외.
- 좌표 미확보 및 데이터 수집 공백 노출: '일부 주유소는 위치 정보가 없어 검색되지 않을 수 있습니다.'
- API 미연결: '경로 인근 후보 — 우회거리 미확인'만 표시. +km/+분/절약액을 가짜로 만들지 않음.

### 3-3. 지도 집중모드 연계

- 일반 `nearby`와 독립적인 `route` 보기 상태로 관리; 기존 `map-browse` / `focus-detail` / `expanded-tools` / `list-sheet`를 재사용.
- 지도: 기본 경로선(청록), 선택된 주유소 경유 경로선(진녹), 출발지·목적지 아이콘, 경로 후보 마커, 추천 TOP1~5 배지와 bounce(사용자 reduced-motion 존중).
- 경로 모드 결과 목록은 **지도 bounds**가 아니라 경로 후보로 결정; 지도를 드래그했다고 목록이 소실되지 않게 한다.
- 마커/라벨/목록 카드 → 동일 선택 ID → 팝업 열기. 선택 마커와 경로선이 팝업/바텀시트에 가리지 않게 패딩 보정.
- compact: 지도+핵심 카드/최소 조작; expanded: 검색·필터·경로 편집; full/list: 드래그 가능한 목록; 자세히 보기 이후 닫으면 **경로·정렬·스크롤 유지**.
- `showRoute`가 현재 항상 `fitBounds` 하므로 최초 계획 시에만 전체경로 맞춤; 카드 변경 시 `fitBounds:false`로 시야 튐 방지. GPS 궤적과 계획 경로는 별도 레이어/스타일.
- 원래 '지도 안 주유소'로 복귀 시 이전 필터·지도 중심·줌·스크롤 보존.

## 4. 후보 탐색 알고리즘

1. **기본경로**: 출발 O, 목적 D, 우회옵션(일반/무료도로) 선택 후 `NaverRouteClient.request({origin,destination,option})` **1회**. 응답 `path: [lng,lat][]`, 거리 m, 시간 초, 통행료 원.
2. **전국 후보**: `state.all` 또는 동일 버전의 배포 JSON에서 `hasMapCoordinates`, 유종 유효, 가격 신뢰도를 반영. 기존 `filterStations`는 지도 bounds를 필수로 하므로 **사용 금지**: 별도 route candidate 전처리.
3. **공간 근접**: Polyline을 지역 평면 미터 좌표로 변환, station→segment 정사영으로 최소 거리 및 해당 경로 누적거리(`progressMeters`) 추출. 경로 구간 bbox 2km 확장 + 공간 인덱스(grid/R-tree)를 이용해 연산량 제한.
4. **방향성**: 현재 GPS 경로 진행지점보다 뒤인 후보는 기본 제외; 고속도로 반대편·IC 진출/복귀·중앙분리 도로 여부는 지리적 거리만으로 단정 불가. 실제 경유 경로 확인에서 과도한 우회를 판별.
5. **다양성**: 시작/중간/후반 구간별 고르게 후보를 뽑는다. 저렴순만 택하면 특정 구간에 쏠림. 1차 후보 30~50곳 표시/요약, 경유 재탐색 우선 최대 8곳(선행실험값).
6. **실제 우회 검증**: 기준경로 응답을 재사용하고 각 후보에 대해 `NaverRouteClient.request({origin,destination,via:station,option})` 1회. `extraDistanceMeters=via.distanceMeters-base.distanceMeters`, `extraDurationSeconds=via.durationSeconds-base.durationSeconds`, `extraTollWon=via.tollWon-base.tollWon`.
7. **필터/랭킹**: 모든 검증 필드 완전+유효 가격+최대우회 충족 대상만 추천. 추가 거리/시간이 음수 등 비교가 모호하면 '확인 불가'로 제외. 순위 근거/검증 건수 표시.
8. 비검증 후보를 상세 선택하면 개별 재탐색(쿼터·캐시 검토)하여 결과 카드 업데이트.

초기 후보반경(예 2km)은 도로 우회거리와 **다른 값**이다. 기본경로가 크게 달라지는 조건, 정비 공사, IC 방향, 휴게소 접근 불가, 주유소 영업시간 미확인 등은 앱이 보장하지 않는다.

## 5. 추천 및 비용 공식

```text
baseRoute = route(O,D)
viaRoute(i) = route(O,station_i,D)
extraKm = max(0, via.distanceKm - base.distanceKm)   # 음수·모호하면 비교 제외
extraMinutes = max(0,via.durationMin - base.durationMin)
additionalFuelWon = extraKm / kmPerLiter * referenceFuelWonPerL
additionalTollWon = via.tollWon - base.tollWon
optionalTimeWon = extraMinutes / 60 * timeValueWonPerHour
purchaseWon = stationFuelWonPerL * liters
estimatedTotalWon = purchaseWon + additionalFuelWon + additionalTollWon + optionalTimeWon
# 기준가격을 직접 제공했을 때만
estimatedSavingWon = (referenceFuelWonPerL - stationFuelWonPerL) * liters
                     - additionalFuelWon - additionalTollWon - optionalTimeWon
```

- 기본 **추천순**: 조건을 통과한 주유소의 `estimatedTotalWon` 오름차순(동률이면 우회시간, 우회거리, 가격, 경로 진행순). 기준단가가 있으면 `estimatedSavingWon` 내림차순과 동치.
- 시간가치 기본 0원/시간(시간은 별도로 +분 표시), 이용자가 직접 6천/1만/2만원 등 설정 시 합계에 반영. 숨은 가중치 없음.
- 소비연료 단가는 사용자가 정한 기준단가 또는 명시된 가정가격을 사용; 사용자 미설정 시 비용·절약액 추정은 보류하거나 가정임을 강조.
- '최저가순'은 원/L 가격만, '최소 우회순'은 추가 분→추가 km, '경로 진행순'은 출발지로부터의 누적거리.
- 추천은 유효가격과 실제 우회 재탐색이 완료된 범위의 **부분 순위**이며 전체 전국 최저가를 주장하지 않는다.

## 6. API 및 배포 구조

```text
[GitHub Pages: 정적 JS·가격 JSON·네이버 지도]
     ├─ 오피넷 전국/지역 JSON 로드 (기존 방식)
     ├─ 목적지/출발지 설정, 후보 인근 계산
     └─ HTTPS Route API로 우회 검증 요청
            ├─ Directions 5 서버 비밀키 (환경변수)
            ├─ 기준 경로 캐시(메모리 TTL 2분)
            ├─ 후보별 경유 요청, 동시성 제한 2~3
            ├─ 사용량 제한·백오프·중복 요청 병합
            └─ 검증 결과만 프런트로 전달
[Android WebView] → 같은 GitHub Pages 화면, 외부 Kakao 경유지 길안내
```

권장 신규 엔드포인트: `POST /api/route/recommendations` (가벼운 JSON body). 기존 GET 전용 서버에 해당 엔드포인트만 POST·OPTIONS 허용하도록 추가. 요청: `{origin:{lat,lng}, destination:{lat,lng}, fuel, liters, kmPerLiter, maxDetourMinutes, corridorMeters, candidateIds:[...] }`. 후보 개수 8~12개 서버 상한/IDs 검증. server는 배포 스냅샷과 ID/좌표 일치 확인 또는 서버가 직접 후보 선별해 변조/과금 남용 방지. 실제 인증·트래픽이 없는 소규모 운영이라도 일·분당 호출량 제한은 필수.

응답: `{status, baseRoute:{distanceMeters,durationSeconds,tollWon,path}, results:[{stationId,progressMeters,proximityMeters,price:{value,sourceDate,eligible}, detour:{distanceMeters,durationSeconds,tollWon,verified}, costs:{purchaseWon,extraFuelWon,extraTollWon,timeWon,totalWon},rank,reason,viaPath}], checkedCount, candidateCount, coverage, fetchedAt, warnings }`.

메모리 라우트 캐시 2분은 기존 클라이언트에 있음. 실사용량/서버리스 다중인스턴스가 생기면 전역 호출원장은 내구성 저장소(KV 등)에 분리. **GitHub Pages와 기존 오피넷 데이터는 이전/복제하지 않는다**.

현재 `NAVER_DAILY_LIMIT` 기본값은 **앱 자체 안전 제한 200회/일**이며 Naver 상품 무료량이 아니다. 1회 탐색에 기준경로 1회+8개 후보=9회가 필요하므로 공개 서비스 전에 예산/요금 확인 후 설정 조정, 캐시와 API 호출량 표시가 중요하다.

## 7. 외부 내비게이션 연결

카카오맵 공식 Android/iOS URL Scheme은 **출발지, 최대 5개 경유지, 목적지** 자동차 길찾기를 지원한다.
- 앱: `kakaomap://route?sp=LAT,LNG&vp=LAT,LNG&ep=LAT,LNG&by=car`
- 웹 폴백: `https://m.map.kakao.com/scheme/route?sp=LAT,LNG&vp=LAT,LNG&ep=LAT,LNG&by=car` (공식 예시 일부는 http 사용)
- 이동 전 '카카오맵에서 주유소 경유 후 목적지 안내'라고 설명, 앱 설치 여부/실제 경유지 수용 테스트. 다른 내비앱은 각 공식 딥링크 지원범위 검증 후 제공.
- Android의 `MainActivity.shouldOverrideUrlLoading`은 이미 `kakaomap` scheme을 외부 Intent로 보내지만 앱 미설치시 openExternal 실패 폴백이 필요.

참고:
- https://apis.map.kakao.com/android_v2/docs/api-guide/urlscheme/
- https://api.ncloud-docs.com/docs/ai-naver-mapsdirections-driving
- https://www.ncloud.com/charge/price/ko

## 8. 데이터 신뢰도·보안·예외

- 전국 좌표 확보율이 100%가 아니며 누락을 숨기지 않는다. 모든 가격 기준일, 보고/수집시각을 그대로 재사용.
- 가격 미확인·오래된 데이터는 지도 '참고' 영역에 남기되 추천·최저가·예상 비용 정확값에서 제외.
- 지역에 실제 후보가 없으면 '우회 제한 완화 / 반경 확대 / 다른 경로' 제공.
- 길찾기 API 키·오피넷 키는 브라우저/Android/Pages에 노출하지 않는다.
- 위치 접근 거부 시 수동 출발지 입력; 사용자 위치를 경로 서버/데이터베이스 영구 저장하지 않는다.
- API 장애/쿼터 초과 시 후보 목록은 보이되 경로 실측 없이 우회거리 수치/확정 순위를 표시하지 않는다.
- 고속도로 방향/진출입 가능성은 실제 Directions 재탐색과 추가시간 필터로 우선 검증; 운전자 안전 위해 이동 중 편집 최소화.

## 9. 구현 단계 / 수락 기준

| 단계 | 산출물 | 완료 판정 |
|---|---|---|
| P1 | routeMode 화면, O/D 선택·저장, 기본 경로선 | 길찾기 성공/실패/권한거부 및 뒤로가기 처리 |
| P2 | Polyline 후보 추출, 가격 신뢰도, 경로 진행 정렬 | 지도 bounds를 바꿔도 목록 유지, 좌표 누락 명시 |
| P3 | 키 보호 API, 기준 1회+후보별 1회, 경로 비교 | 양방향/고속도로 반대편 우회시간이 실제 도로로 검증 |
| P4 | 추천/가격/우회 정렬·총비용 공식, TOP5 배지 | 임의 숫자 없음, 가격이 오래되면 추천 제외 |
| P5 | 모바일 집중모드 바텀시트/팝업, 외부 카카오 길안내 | 목록/마커 동기화, 선택 후 복귀 상태 보존 |
| P6 | API 비용·쿼터·로그 최소화·E2E | 캐시/쿼터/병렬요청/실패/실기기 Android 확인 |

**핵심 회귀 시나리오**:
1. 출발 O→목적 D, 후보 A/B: 가격은 B가 저렴하지만 B 우회시간이 15분이면 기본 10분 제한에 의해 A만 추천.
2. 고속도로 건너편 주유소: 직선거리 100m라도 IC 우회로 20분 추가 시 추천 제외.
3. stale 가격: 참고 마커는 보이지만 TOP5/최저가에서는 제외.
4. 직행 경로/경유 경로 중 일부 누락: '미검증', 예상 절약액 계산 금지.
5. 지도 이동/팝업/목록 드래그 후에도 경로선·선택·랭킹 유지.
6. Android에서 카카오맵 경유지+최종 목적지 올바른 값 전달, 설치 안 됨 폴백.
7. NAVER API 미연결 상태: 실제 거리·우회 분 생성 금지, 설정 필요 안내.

## 10. 다음 구현 착수 우선순위

1. 실제 Pages 운영 URL과 route API 설정 존재 여부부터 확인.
2. `public/js/route-candidates.js`, `public/js/route-mode.js` 독립 모듈 작성; 기존 일반 필터 분리.
3. `server/route.mjs`의 같은 기본경로 중복 호출 제거, `server/index.mjs`에 추천 endpoint 추가.
4. 기존 map focus·상세 팝업과 완전히 연결하고 테스트 후 GitHub Pages 정상 경로로 배포.
5. Android 하이브리드는 웹 변경 자동 반영; 외부 내비 미설치 폴백만 네이티브 빌드 변경.

---

**비고:** 이 문서는 설계 기록이다. API 서버 배포·실제 기능 구현·가격/경로 동작 검증 완료를 뜻하지 않는다.
