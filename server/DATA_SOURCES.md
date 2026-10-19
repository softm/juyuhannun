# 주유한눈 데이터 연동과 검증 기준

확인일: 2026-10-19 (Asia/Seoul). 공식 문서 확인과 구현 검증을 구분한다. 현재 저장소에 오피넷·네이버 비밀키를 포함하지 않으며, 실제 계정 API 응답 검증은 키 연결 후 수행해야 한다.

## 1. 원본 가격 데이터

| 용도 | 공식 HTTPS 엔드포인트 | 핵심 조건 |
| --- | --- | --- |
| 반경 내 주유소 | `https://www.opinet.co.kr/api/aroundAll.do` | `certkey`, `out=json`, KATEC `x/y`, `radius` 최대 5000m, `prodcd`, `sort=1` 가격순 |
| 주유소 상세 | `https://www.opinet.co.kr/api/detailById.do` | `certkey`, `out=json`, `id`; 제품별 가격 기준일·시각 포함 |
| 지역 최저가 | `https://www.opinet.co.kr/api/lowTop10.do` | `cnt` 1~20, 시도 2자리/시군 4자리; 이름과 달리 최대 20개 |
| 전국 평균 | `https://www.opinet.co.kr/api/avgAllPrice.do` | `certkey`, `out=json`; 개별 주유소 현재가격의 대체 자료가 아님 |
| 시도/시군구 평균 | `avgSidoPrice.do`, `avgSigunPrice.do` | 지역·유종별 평균 |
| 지역코드 | `https://www.opinet.co.kr/api/areaCode.do` | 오피넷 고유 지역코드; 행정구역 법정동 코드와 동일하다고 가정하지 않음 |
| 요소수 | `https://www.opinet.co.kr/api/ureaPrice.do` | 일반 유류가격과 갱신 시각·재고 의미가 다름; 현재 앱 수집 범위에서 제외 |

근거: [오픈 API 목록](https://www.opinet.co.kr/user/custapi/openApiInfo.do), [반경 API 명세](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=3), [상세 API 명세](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=1), [최저가 API](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=2), [전국 평균](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=4), [지역 코드](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=5), [요소수](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=8).

현재 코드가 호출하는 오피넷 엔드포인트는 반경·상세 2개뿐이다. 브랜드 구분 필드는 문서 표의 `POLL_DIV_CD`와 XML 예시의 `POLL_DIV_CO`를 모두 처리한다. 유종은 휘발유 `B027`, 경유 `D047`, 고급휘발유 `B034`, LPG `K015`다. 최저가 문서 한 곳의 `K105` 표기는 다른 명세와 일치하지 않아 이 구현의 LPG 코드로 채택하지 않았다.

## 2. 이용 조건과 인증키

공식 [유가정보 API 소개](https://www.opinet.co.kr/user/custapi/custApiInfo.do)는 일반 API 19종을 무료로 안내하며 기본 호출량은 하루 300회다. 제휴를 통해 일반 API 1500회/일 이용을 신청할 수 있다. 전국 기본정보·기본정보 변경·지역별 전체 판매가격 3종은 프리미엄에 해당한다. 프리미엄은 기본적으로 유료 제휴이며 소상공인·창업기업 등의 무료 지원 조건이 별도로 안내되어 있다. 공개 소개 페이지에서 구체 계약 단가는 확인되지 않았다.

일반 API 신청: [인증키 발급](https://www.opinet.co.kr/user/custapi/openApiNew.do). 로그인 후 신청하며 공사 소개에서는 자동 승인·키 발급 절차를 안내한다. 제휴 문의는 공식 안내의 `052-216-2509`, 데이터 문의는 `052-216-2514`, `price@knoc.co.kr`이다. 이 프로젝트는 신청·계약·이메일 발송을 자동 수행하지 않는다.

프리미엄 호출 서버는 키마다 IP 최대 3개를 등록한다. 따라서 GitHub-hosted Actions의 변동 출구 IP로 프리미엄 전국 수집이 된다고 전제하지 않는다. 전국 데이터 확대에는 승인된 명세와 호출 서버 구성이 필요하다. 현 수집기는 일반 API를 사용하고 하루 300회 상한을 코드에서 지킨다.

키 없는 전국 개별 주유소 실시간 가격 피드는 공식 공개 명세에서 확인하지 못했다. [오픈 API 안내](https://www.opinet.co.kr/user/custapi/openApiIntro.do)는 공사 인증키를 필수로 정한다. 앱 화면의 내부 요청이나 타인 키를 API 대체로 사용하지 않는다. 공개 페이지의 열람 가능성과 데이터의 재배포·영리 이용 범위는 다르므로 실제 서비스의 출처 표시와 이용 범위는 발급 조건·제휴 조건을 적용한다.

## 3. 가격 기준시각과 앱 수집시각

[오피넷 가격 공개기준](https://www.opinet.co.kr/user/dopds/dopDs_4.do): 카드 단말기 수집 자료는 01·02·09·12·16·19시에 반영하고, 직접보고는 입력·수정 후 즉시 반영한다. 국내 일간 가격 통계는 자정에 전일 자료를 공개한다. [조사 방법](https://www.opinet.co.kr/user/dopds/dopDs_3.do)은 VAN 단말기 단가 수집과 사업자 직접 보고를 구분한다.

| JSON 필드 | 의미 |
| --- | --- |
| `prices[fuel].priceUpdatedAt` | 상세 API의 `TRADE_DT`+`TRADE_TM`를 검증해 만든 원본 가격 기준시각 |
| `prices[fuel].sourceDate/sourceTime` | 원본 문자열; 불완전하거나 미래 날짜인 자료도 감사 가능하게 보존 |
| `prices[fuel].fetchedAt` | 해당 가격 응답을 앱 수집기가 받은 시각 |
| `station.fetchedAt` | 해당 주유소 응답을 받은 시각 |
| 최상위 `fetchedAt` | 마지막 정상 수집 응답 시각; 일부 지역 실패 시 전체 자료가 동일 시각 자료라는 뜻은 아님 |
| `lastAttempt.at/status` | 마지막 수집 시도와 그 결과 |
| `coverage.zones[].lastSuccessAt` | 지역·유종별 마지막 정상 수집 시각 |

API는 기준시간에 시간대 접미어를 포함하지 않는다. 한국 국내 서비스 시간으로서 Asia/Seoul(+09:00)로 해석하고 UTC ISO 문자열로 직렬화한다. 운영 계약에서 다른 시간대 정의를 받으면 이 해석을 수정해야 한다. 잘못된 달력 날짜나 시각, 수집시각보다 5분 이상 미래인 기준시각은 시간 미확인으로 처리하고 원본값을 보존한다. 5분은 이 앱의 서버 시간 오차 허용치이며 오피넷의 공식 보장치가 아니다.

반경 응답에는 가격 기준시각이 없다. 이를 `fetchedAt`으로 대체하지 않는다. 상위 일부를 상세 조회해 보강하고 나머지는 `priceTimeStatus=unknown`, `priceUpdatedAt=null`을 유지한다. 과거 값·미확인 값이 자동으로 최신 추천으로 분류되지 않게 프런트에서 구분해야 한다.

## 4. 좌표 변환

오피넷은 KATEC 좌표를 제공한다. 위경도·EPSG:5179로 해석하면 위치가 잘못된다. [네이버 공식 좌표계 설명](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Service.html)은 `NHN:128`을 TM128(KATECH)로 분류한다.

`coordinates.mjs`는 [공식 geocoder SDK](https://oapi.map.naver.com/openapi/v3/maps-geocoder.js)의 TM128 정의와 독립 계산 결과를 교차검증했다. Bessel 1841, 원점 38N/128E, 축척 0.9999, False E/N 400000/600000m 및 회전 기준점을 포함한 Molodensky–Badekas 방식을 사용한다. [PROJ TM 수식](https://proj.org/en/stable/operations/projections/tmerc.html)과 [Molodensky–Badekas 수식](https://proj.org/en/stable/operations/transformations/molobadekas.html)에 따라 직접 구현했고 SDK 소스는 프로젝트에 포함하지 않았다.

공식 SDK oracle 정보: v1.3.1, 배포 주석 `2025-02-11 14:00:53`, 확인 `2026-10-19`, SHA-256 `d31dbabcc0e53b990b631329a3dd544f34b7aaac0727d2d3458a0326ccacab6f`.

한국 영역 320점 비교 시 순방향 최대 0.00750m, 역방향 최대 0.01025m 차이였다. 저장소 회귀시험에는 서울·대전·제주·독도 분산 기준점과 오피넷 SK서광 예제의 고정 기준값을 포함한다. 이는 공식 변환 계산과의 수치 차이이며 실제 주유소 좌표 정확도 보장은 아니다. 원본 KATEC 좌표도 `sourceCoordinates`에 보존한다. 오피넷은 공개 명세에 datum 세부 수치를 쓰지 않아, 네이버 변환과 실제 예제 위치의 교차확인에 근거한 선택이다.

## 5. 도로 경로와 비용

[네이버 Directions 5](https://api.ncloud-docs.com/docs/application-maps-directions5)를 사용한다. 요청은 `https://maps.apigw.ntruss.com/map-direction/v1/driving`이며 API Key ID와 비밀 Key를 서버 헤더로 전달한다. 출발·도착·경유 좌표 순서는 `경도,위도`다. 기본경로와 주유소 경유경로를 모두 `traoptimal`로 요청한다.

`summary.distance`는 m, `summary.duration`은 밀리초이며 앱은 초로 변환한다. `summary.tollFare`와 경로 좌표까지 확인해야 비교를 성공 처리한다. 한 경로라도 실패하거나 결과가 복수·불완전하거나 경유 경로가 오히려 짧아 비교 조건이 모호하면 `extra=null`이다. 경로 캐시는 메모리에서 2분만 유지하며 가격 자료와 별도로 취급한다. 실제 통행시간은 교통 상황에 따라 달라지므로 `estimate=true`로 명시한다.

대안인 [카카오모빌리티 자동차 길찾기](https://developers.kakaomobility.com/guide/navi-api/directions)는 응답 시간이 초 단위여서 네이버와 동일 처리하면 안 된다. 현재 서버는 네이버 한 공급자만 사용한다. 키가 없어도 [카카오 공식 웹 길찾기 링크](https://apis.map.kakao.com/web/guide/#routeurl)로 외부 화면을 열 수 있으나, 링크만으로 앱에 도로 거리·통행료 데이터를 가져오지는 않는다.

## 6. 실행·운영

```bash
# 로컬 서버: 비밀키는 환경변수 또는 Node의 --env-file 기능으로만 제공
node --env-file=.env server/index.mjs

# GitHub Actions / CLI 수집
node scripts/collect.mjs --output public/data/stations.json --ledger .cache/opinet-quota.json --config config/collection.json

# 내장 Node 테스트
node --test tests/opinet.test.mjs
```

필수 실제 가격 환경변수: `OPINET_API_KEY`. 경로 비교: `NAVER_MAPS_API_KEY_ID`, `NAVER_MAPS_API_KEY`. 공개 지도 JavaScript Key와 서버 비밀 Key는 구분한다. 서버 포트 기본 8787, 바인딩 기본 127.0.0.1이며 외부 호스팅 시 운영 환경의 HOST/PORT를 지정한다.

| 선택 설정 | 기본값 |
| --- | --- |
| `OPINET_DAILY_LIMIT` | 300; 이 구현은 최대 300으로 제한 |
| `OPINET_CACHE_TTL_SECONDS` | 600 |
| `OPINET_DETAIL_LIMIT` | 8 |
| `OPINET_QUOTA_LEDGER` | `.cache/opinet-quota.json` |
| `NAVER_DAILY_LIMIT` | 200; 직행·경유를 각 1회로 계산 |
| `NAVER_QUOTA_LEDGER` | `.cache/naver-quota.json` |
| `API_ALLOWED_ORIGINS` | 없음; 별도 프런트엔드가 호출할 경우 허용할 정확한 origin을 쉼표로 지정 |

수집 기본 범위는 서울시청·대전역 공공 장소 주변 각 3km, 4유종이고 전국 데이터가 아니다. 검색당 상세 3곳, 실행당 최대36회, 하루300회다. 선택 지역 전체 주유소 목록의 완전성도 보장하지 않으므로 `coverage.complete=false`다. 실제 가격이 없는 초기 배포는 빈 목록과 연결 대기 상태를 제공한다. 키 없음·인증 실패·응답 오류가 있어도 과거 가격시각을 현재 시각으로 바꾸지 않는다.

GitHub Actions는 마지막 정상/부분 스냅샷과 `.cache/opinet-quota.json`을 다음 실행 전에 복원해야 한다. 하루 중 ledger가 사라지면 이미 사용한 호출량을 서버가 알 수 없으므로, 수집기 실행과 ledger 보존을 하나의 운영 단위로 취급한다. 단말기 갱신 이후 10분 정도의 수집 시점은 앱의 운영 선택이며, 오피넷 반영 완료나 Actions 정시 실행의 보장치가 아니다.

API 응답 검증·quota·캐시·수집 실패 보존·키 누출 방지·좌표·날짜·경로 비교를 fixture로 검증한다. 현재 실행 환경은 로컬 TCP 바인딩이 제한되어 HTTP handler의 메모리 요청·응답을 검증했다. 실제 계정과 외부 API를 연결한 종단 검증은 자격증명 설정 후 필요하다.
