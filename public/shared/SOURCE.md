# 지도 공통 소스와 운영 조건

확인일: 2026-10-19

## 사용자 소스 재사용

사용자의 요청에 따라 [돌봄한눈 원본 저장소](https://github.com/softm/homecare-nationwide-care-services-map)의 지도 공통 모듈을 재사용했습니다. 원본 README의 공개 브랜드는 **돌봄한눈**입니다.

기준 커밋은 [6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d](https://github.com/softm/homecare-nationwide-care-services-map/commit/6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d)입니다. 아래 세 파일은 원본 바이트를 그대로 보존했으며 git blob SHA를 대조했습니다.

| 이 저장소 파일 | 원본 파일 | git blob SHA | 사용 범위 |
| --- | --- | --- | --- |
| care-location.js | [care-location.js](https://github.com/softm/homecare-nationwide-care-services-map/blob/6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d/care-location.js) | 0c639b8c9de87deb27d63d92c99c59fbc382ae14 | 위치 권한, 낮은 정확도 우선 요청, 위치 신호 지연 재시도, 동시 요청 공유 |
| care-popup-geometry.js | [care-popup-geometry.js](https://github.com/softm/homecare-nationwide-care-services-map/blob/6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d/care-popup-geometry.js) | 86d69f3b08f6e90c41eeecc4595b52880046e0cd | 상세 패널을 피해 선택 주유소로 지도 이동 |
| map-marker-placement.js | [map-marker-placement.js](https://github.com/softm/homecare-nationwide-care-services-map/blob/6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d/map-marker-placement.js) | 76176ec5fd0470806036a0a295ef3de8c5af193a | 선택한 가격 마커의 이름을 가려지지 않는 방향에 표시 |

public/js/map.js의 지도 제어부는 원본 [index.html](https://github.com/softm/homecare-nationwide-care-services-map/blob/6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d/index.html)과 [map-experience.js](https://github.com/softm/homecare-nationwide-care-services-map/blob/6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d/map-experience.js)의 사용자 이동과 프로그램 이동 구분, 지도 이동 후 지연 재조회, 목록·마커 선택 원칙을 주유소용 ES module로 분리 구현했습니다. 돌봄기관 데이터, 광고단위, 개인정보 또는 서버의 비밀키는 가져오지 않았습니다.

## 네이버 지도 설정

public/config.js의 naverClientId는 사용자가 소유한 위 원본 index.html의 **공개 브라우저용 Application ID**를 복사한 값입니다. 서버용 Client Secret이 아닙니다.

원본 README는 배포 Origin을 해당 네이버 Maps Application의 Web 서비스 URL에 등록하도록 설명합니다. 이 작업에서 실제 네이버 콘솔의 등록 목록을 읽지는 않았으므로 **https://softm.github.io 및 향후 새 도메인 등록 여부는 미확인**입니다. 기존 서버의 CORS 허용 목록과 네이버 Maps Application 등록은 서로 다른 설정입니다.

SDK는 공식 문서의 ncpKeyId 파라미터와 geocoder 서브모듈을 사용합니다. 인증 오류 콜백, 스크립트 오류 또는 시간 초과 시 대체 지도를 시도합니다.

- [네이버 지도 SDK 시작하기 및 인증 오류 처리](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)
- [네이버 Maps 등록·API 사용 가이드](https://guide.ncloud-docs.com/docs/application-maps-procedure)
- [네이버 클라우드 Maps 서비스 이용약관](https://xv-ncloud.pstatic.net/images/provision/%5B%EB%AF%BC%EA%B0%84%5DMaps%EC%84%9C%EB%B9%84%EC%8A%A4%EC%9D%B4%EC%9A%A9%EC%95%BD%EA%B4%80_v0.4_%28CLEAN%29_1742433558704.pdf)

도로 경로 서버에는 별도로 NAVER_MAPS_API_KEY_ID, NAVER_MAPS_API_SECRET 환경변수가 필요합니다. public/config.js에는 이 비밀키를 넣지 않습니다. 지도 타일을 그리는 기능이 도로 경로 계산을 대신하지 않습니다.

## 토지한눈 방식의 장소 통합검색

사용자의 요청에 따라 [토지한눈](https://github.com/softm/softm.tojihannun)의 VWorld 장소검색 방식을 참고해 목적지 검색에 적용했습니다. 기준 구현은 커밋 `a4afb8bf`의 `searchVWorld`, 장소 후보 정규화·순위·중복 제거 흐름입니다. 주유한눈은 기존 네이버 도로명·지번 지오코딩과 VWorld `type=place` 조회를 병렬 실행하고, 장소명 일치도와 이동 목적에 유용한 철도·지하철·공항 등의 분류를 반영해 하나의 후보 목록으로 합칩니다.

public/config.js의 `vworldSearchKey`는 서버 비밀키가 아니라 등록 도메인에서 사용하는 공개 브라우저 키입니다. 요청에는 현재 호스트를 `domain`으로 전달하며, 사용자가 검색 버튼을 누른 때에만 장소 검색어를 전송합니다. 실제 `softm.github.io` 도메인으로 `서울역` 장소 응답이 반환되는 것을 확인했습니다.

## 실제 지도 대체 경로

네이버 연결 실패 시 **Leaflet 1.9.4 + OpenStreetMap Standard 타일**로 실제 지도를 표시합니다. 마커·내 위치·지도 이동·실제 응답의 도로 경로 선은 사용할 수 있습니다. 네이버 주소 검색이 불가능한 경우에는 오류를 명시하며 추정 좌표를 만들지 않습니다.

Leaflet의 [공식 다운로드 안내](https://leafletjs.com/download.html)에 기재된 unpkg CDN 주소와 SRI 값을 사용합니다. Leaflet의 [BSD 2-Clause 라이선스](https://github.com/Leaflet/Leaflet/blob/v1.9.4/LICENSE)를 따릅니다.

OpenStreetMap 타일은 다음 공식 조건을 따릅니다.

- [타일 이용 정책](https://operations.osmfoundation.org/policies/tiles/)
- [OpenStreetMap 저작권 및 라이선스](https://www.openstreetmap.org/copyright)
- [OSMF 이용약관](https://wiki.osmfoundation.org/wiki/Terms_of_Use)
- [OSMF 개인정보처리방침](https://osmfoundation.org/wiki/Privacy_Policy)

지도에 OpenStreetMap 기여자 표기를 항상 표시합니다. 타일은 사용자가 보는 영역에서만 요청하고 브라우저의 기본 캐시 정책과 Referer를 유지합니다. 대량 다운로드, 오프라인 저장, 전국 타일 선취 기능은 구현하지 않았습니다. 이 타일 서버는 서비스 수준 보장이 없으며 상업 서비스에도 계속 제공을 보장하지 않습니다. 운영 규모가 커지면 이용 조건에 맞는 별도 타일 제공자를 설정해야 합니다. fallbackTileUrl과 fallbackAttribution을 public/config.js에서 교체할 수 있습니다.

## 지도 제어부 계약

public/js/map.js는 MapController를 export하며 public/config.js는 APP_CONFIG를 export하고 globalThis.APP_CONFIG에도 연결합니다. 지도 모듈이 공통 파일 세 개를 import하므로 HTML에서 중복으로 script 태그를 추가하지 않습니다.

| 함수 | 동작 |
| --- | --- |
| new MapController(container, callbacks) | DOM 요소 또는 CSS 선택자와 onCenterChange, onSelect, 선택적인 onPick·onState를 받음 |
| await init() | 네이버 지도 우선. 실패하면 실제 대체 지도. 양쪽 연결 실패 시 reject하며 가격 목록 처리는 앱이 유지 |
| setStations(stations, selectedId, fuel) | id·name·lat·lng·prices[fuel].price를 사용하는 현재 결과와 선택 마커 표시. 자체 배율 변경 없음 |
| focus(station, {preserveZoom: true}) | 선택 강조 후 이동. data-map-overlay 속성의 보이는 패널을 피해 이동 |
| getCenter(), getBounds() | 현재 실제 지도 중심·화면 경계 반환 |
| setCenter({lat,lng}) | 지도 중심을 직접 지정하고 현재 배율 유지 |
| await locate() | 공통 위치 모듈로 요청하고 내 위치 표시·중심 이동. 좌표를 반환 |
| showRoute([[lng,lat],...]), clearRoute() | 서버에서 받은 실제 도로 좌표 표시·해제. 경로 표시 시 범위에 맞춤 |
| await searchLocation(query) | VWorld 장소와 네이버 도로명·지번 후보를 병합해 [{name,address,lat,lng}] 반환. 한 제공자가 실패해도 다른 실제 결과를 유지 |
| await searchAddress(query) | 기존 호출부 호환을 위해 searchLocation을 호출하는 별칭 |
| destroy() | 리스너·지도 인스턴스·관찰자 해제 |

onCenterChange({lat,lng})는 사용자 이동이 끝난 뒤 450ms 동안 추가 이동이 없을 때만 호출합니다. focus, setCenter, locate, showRoute가 일으킨 프로그램 이동은 이 콜백을 발생시키지 않습니다. 내 위치 조회 버튼에서는 locate가 반환한 좌표로 앱이 주유소를 재조회해야 합니다.

onState는 {status,provider,message,ready}를 전달합니다. provider는 naver·leaflet·none이며 status는 loading·ready·fallback-loading·fallback·tile-error·error 등이 됩니다. fallback 자체가 주유소 가격의 최신성 또는 경로 데이터 상태를 의미하지 않습니다.

지도는 가격을 생성하거나 보정하지 않습니다. 가격 시각 판정, 조회 응답의 세대 토큰, 재시도·갱신 상태, 실제 추가 주행비 계산은 앱과 서버의 데이터 로직에서 처리합니다.

## 배율별 주유소 표시와 대량 렌더링 (2026-10-21)

[돌봄한눈 cadd491](https://github.com/softm/homecare-nationwide-care-services-map/commit/cadd491849a0cec9223a37295339eec03157c002)의 [map-marker-labels.js](https://github.com/softm/homecare-nationwide-care-services-map/blob/cadd491849a0cec9223a37295339eec03157c002/map-marker-labels.js), map-marker-density.css, index.html의 loadMarkers·clearQueryMarkers를 확인해 적용했습니다. 아래 기능은 주유소 데이터·두 지도 제공자에 맞게 구현한 것이며 원본 바이트 복사본이 아닙니다.

- public/js/marker-display.js: 원본의 배율 14·16·18 경계, 화면 면적별 이름표 예산(최대 6·12·24·40), 밀도 기준(면적/9000, 12~80), 선택·기존 이름·ID 순서 우선순위.
- public/js/map.js: 14 미만 위치점, 14~15 주유소 핀, 16~17 가격·이름, 18 이상 가격·이름·정유사·셀프·가격 기준일·주소. 밀집 화면은 일반 마커를 위치점으로 간소화하고 가격·이름표는 예산과 충돌 검사로 배치합니다. 선택 마커는 항상 가격·이름을 강조합니다. 12 미만의 넓은 배율에서는 위치점을 8px로 줄이고, 표시된 이름표는 다른 위치점보다 위 레이어에 둡니다.
- 배율 변경은 호스트의 data-marker-scale 속성만 바꿔 기존 DOM과 좌표 앵커를 유지합니다. 모든 배율에서 일부 일반 이름·가격을 남기며, 이름표 측정 후보는 화면 예산의 3배 이내입니다.
- 화면 경계 안의 모든 유효 주유소를 표시하며 표본 추출로 결과를 누락하지 않습니다. 목록은 화면 마커 수와 별도로 전체 검색 결과를 유지합니다. 화면 밖 마커는 SDK에서 분리하고 재방문 캐시는 800개로 제한합니다.
- 생성·삭제·변경을 한 프레임당 최대 64개/6ms 작업으로 분할합니다(단일 SDK 호출의 실행 시간은 SDK에 의존). 새 조회가 들어오면 이전 예약 작업을 취소합니다. 아이콘 내용·좌표·선택 상태가 달라진 경우에만 SDK를 갱신합니다.
- 지도 이동·확대·축소·화면 크기 변경에 따라 현재 지도 경계 안의 목록·마커·최저가를 함께 재계산합니다. 이 과정에서 가격 파일을 재요청하지 않으며, 별도의 검색 범위·반경·자동 검색 선택은 없습니다.

검증: tests/marker-rendering.test.mjs에서 배율 경계·이름표 예산·선택 우선순위·좌표 누락·중복·화면 경계·두 제공자의 5,000개 분할 렌더링·아이콘 재사용·필터 취소·캐시 제한·고속도로 사용자 지정 표시를 검증합니다. 이 SDK 대역 테스트의 실행 시간을 실제 브라우저 FPS로 해석하지 않습니다.

## 현재 지도 영역 검색으로 통일 (2026-10-21)

사용자 요청에 따라 지도 주변/전국 검색 구분, 1·3·5km 반경, 자동 검색 체크박스와 수동 지역 검색 버튼을 제거했습니다. 화면 안의 사각형 경계를 단일 검색 범위로 사용합니다.

- MapController의 onViewportChange({center,bounds,zoom})는 사용자 이동뿐 아니라 동일 중심 확대·축소, 프로그램 이동, 컨테이너 크기 변경도 알립니다. 지도 정지 후 120ms로 연속 이벤트를 합치고 동일 경계는 중복 통지하지 않습니다. 기존 onCenterChange는 고속도로 화면과의 호환을 위해 유지합니다.
- core.js의 filterStations는 유효한 지도 경계를 필수로 받습니다. 좌표 미확인·화면 밖 자료를 먼저 제외한 뒤 유종·이름/주소·정유사·셀프·최신성·찜 조건을 적용합니다. 경계를 모를 때 전국 결과를 임의로 표시하지 않습니다.
- 목록 건수·최저가·지도 마커가 같은 필터 결과를 사용합니다. 더 보기로 목록 DOM만 60개씩 늘리며, 지도와 결과 집계에는 화면 안의 전체 결과가 반영됩니다.
- 가격 파일은 전국 압축 스냅샷을 재사용합니다. 일부 좌표만 확보되어도 지도에 표시할 유종 자료가 있으면 사용하고, 해당 유종이 없으면 기존 지역 스냅샷으로 대체합니다. 이동·배율 변경은 반경 API 호출이나 파일 재다운로드를 일으키지 않습니다.
- 좌표 없는 주유소의 기존 공유 상세·주소 길찾기는 유지하지만, 지도 경계 안의 검색 결과로 집계하지 않습니다. 화면 안내에 전체 좌표 확보 현황을 표시합니다.
- 주소 이동 검색과 주유소 선택은 지도 배율을 유지하며, 이동 후 새 화면 경계로 결과가 갱신됩니다. 이전 scope=all 링크는 별도 검색 모드를 만들지 않습니다.

## 모바일 전체 지도 (2026-10-22)

[돌봄한눈 cadd491](https://github.com/softm/homecare-nationwide-care-services-map/commit/cadd491849a0cec9223a37295339eec03157c002)의 care-map-focus.js와 care-mobile-focus.js를 참고했습니다. 같은 지도 DOM과 인스턴스를 유지하고 CSS로 화면을 확장하는 방식, 진입 전 목록·포커스 보존, 명시적 복귀 버튼, 열린 상세창에 Esc를 먼저 넘기는 동작을 주유한눈에 맞게 구현했습니다.

- 너비 1,000px 이하에서 지도 오른쪽 아래 **전체지도** 버튼으로 진입합니다. 전체 지도에서는 헤더·검색 목록·큰 가격 요약을 접고, 현재 위치·확대/축소·자료 상태와 복귀 버튼을 유지합니다.
- **줄이기**는 진입 전 목록 상태로 복귀하고, **검색·목록**은 목록을 펼쳐 유종·검색·필터를 다시 고를 수 있게 합니다. 상세창을 닫아도 전체 지도 모드는 유지합니다. 경로 입력이 필요한 동작은 전체 모드를 종료하고 기존 경로 패널로 이동합니다.
- 100dvh와 safe-area 여백을 사용합니다. 모바일 범위를 벗어나면 모드와 접근성 속성을 함께 초기화합니다. 새 지도나 가격 요청을 생성하지 않습니다.
- MapController.resize()는 레이아웃 변경 전 중심·배율을 보존하고 다음 프레임에서 네이버 resize 또는 Leaflet invalidateSize를 처리합니다. 실제로 넓어진 지도 범위의 목록·마커·최저가는 기존 경계 검색 로직으로 다시 계산합니다.


## 공통 지도 초기 로딩 UX

지도형 앱은 기본 중심 좌표가 먼저 보인 뒤 위치/데이터/마커 작업이 진행되면서 멈춘 화면처럼 보이지 않도록 단계형 로딩을 사용한다.

공통 단계:
1. 지도 연결
2. 현재 위치 확인
3. 서비스 데이터 로딩
4. 현재 뷰포트 마커 렌더링

`shared/map-loading.js`의 `createMapLoadingController()`를 재사용한다. 지도 SDK 준비만으로 로딩을 닫지 않고, 초기 위치 결정과 데이터 로딩 후 첫 마커 렌더링이 완료되었을 때 `complete()`한다. 위치 확인 실패 시 기본 중심 좌표로 계속 진행하되 로딩은 데이터/마커 단계까지 유지한다. 지도 자체가 실패한 경우에만 `error()` 상태를 유지한다.
