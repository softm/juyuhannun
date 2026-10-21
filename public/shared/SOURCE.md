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
| await searchAddress(query) | 네이버 지오코더의 실제 후보 [{name,address,lat,lng}] 반환. 지도·인증 실패 시 명확한 오류 |
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
- 확대·축소만으로 목록 재생성이나 가격 파일 재요청을 하지 않습니다. 지도 자동 검색을 꺼도 배율별 모양 전환과 화면 안 마커 갱신은 동작합니다.

검증: tests/marker-rendering.test.mjs에서 배율 경계·이름표 예산·선택 우선순위·좌표 누락·중복·화면 경계·두 제공자의 5,000개 분할 렌더링·아이콘 재사용·필터 취소·캐시 제한·고속도로 사용자 지정 표시를 검증합니다. 이 SDK 대역 테스트의 실행 시간을 실제 브라우저 FPS로 해석하지 않습니다.
