# 전국·시도·시군구 평균가격 어댑터

확인일: 2026-10-19, Asia/Seoul.

`benchmarks.mjs`는 오피넷의 평균가격을 시장 참고자료로 제공한다. 전국·지역 평균과 개별 주유소 가격은 서로 다른 자료다. 모든 응답과 레코드에 `dataGranularity: "aggregate"`를 넣고, 금액 필드는 `averagePrice`로 명시한다. 이 값을 `station.price`, `station.currentPrice`, 개별 주유소 가격의 누락값, 경유 추천의 기준가격 또는 실제 절약액 계산의 기본값에 자동으로 대입해서는 안 된다.

## 1. 확인한 공식 명세

| 범위 | API | 어댑터 요청값 | 공식 응답값 |
| --- | --- | --- | --- |
| 전국 평균 | [avgAllPrice.do 명세](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=4) | `certkey`, `out=json` | `TRADE_DT`, `PRODCD`, `PRODNM`, `PRICE`, `DIFF` |
| 시도 평균 | [avgSidoPrice.do 명세](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=6) | `certkey`, `out=json`; `sido`, `prodcd` 생략 | `SIDOCD`, `SIDONM`, `PRODCD`, `PRICE`, `DIFF` |
| 시군구 평균 | [avgSigunPrice.do 명세](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=7) | `certkey`, `out=json`, `sido=선택한 2자리 코드`; `sigun`, `prodcd` 생략 | `SIGUNCD`, `SIGUNNM`, `PRODCD`, `PRICE`, `DIFF` |
| 지역코드 참고 | [areaCode.do 명세](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=5) | 시도 코드는 `area` 생략, 시군구 코드는 `area=시도코드` | `AREA_CD`, `AREA_NM` |

시도 평균의 `sido`와 `prodcd`는 선택값이다. 둘 다 생략하면 모든 시도·제품을 한 번에 조회한다. 별도의 `avgonecall` 파라미터나 API를 가정하지 않는다. 시군구 평균의 `sido`는 필수이며, `sigun`을 생략하면 선택한 시도의 모든 시군구를 조회한다. 어댑터는 개별 시군구별 반복 요청을 하지 않는다.

전국 평균의 공공데이터포털 메타데이터는 [한국석유공사 전국 주유소 평균가격 오픈 API](https://www.data.go.kr/data/15150932/openapi.do)다. 이 페이지의 제공 유형은 기관 API로 연결되는 `LINK`이며, 어댑터는 오피넷의 실제 HTTPS 엔드포인트를 호출한다.

| 제품코드 | 참고자료의 유종 | 단위 |
| --- | --- | --- |
| `B027` | 휘발유 | 원/L |
| `D047` | 자동차용경유 | 원/L |
| `B034` | 고급휘발유 | 원/L |
| `K015` | 자동차용부탄 | 원/L |
| `C004` | 실내등유 | 원/L |

실내등유는 평균자료에서만 지원한다. 개별 차량 주유소 검색의 기존 유종 설정을 확장하거나 바꾸지 않는다.

## 2. 사용 계약

기존 `OpinetClient`를 그대로 주입한다. 평균자료만을 위해 별도의 클라이언트, 인증키, 호출량 ledger를 만들지 않는다.

```js
import { OpinetBenchmarkClient } from './benchmarks.mjs';

// opinet은 주유소 조회와 동일한 OpinetClient 인스턴스다.
const benchmarks = new OpinetBenchmarkClient({ client: opinet });

// 전국 + 모든 시도, 모든 지원 유종. 처음에는 외부 API 2회.
const snapshot = await benchmarks.snapshot();

// 이미 받은 자료를 필터한다. 캐시 유효기간 안에서는 추가 호출 없음.
const seoulGasoline = await benchmarks.snapshot({ fuel: 'B027', sido: '01' });

// 명시적으로 선택했을 때만 해당 시도의 시군구 평균을 1회 추가 조회.
const withDistricts = await benchmarks.snapshot({
  fuel: 'B027',
  sido: '01',
  includeSigun: true,
});
```

| 입력 | 기본값 | 의미 |
| --- | --- | --- |
| `fuel` | `null` | 모든 지원 유종. 코드 지정 시 결과를 해당 유종으로 필터 |
| `sido` | `null` | 모든 시도. 2자리 문자열 지정 시 전국 평균과 해당 지역 평균을 반환 |
| `includeSigun` | `false` | `true`이면 `sido` 필수. 문자열이 아닌 boolean |

시도 코드 `"01"`은 오피넷의 서울 코드다. 행정구역 코드 `"11"`을 서울 코드라고 가정하면 안 된다. 지역명과 코드는 공급자 응답을 보존하고, 현행 지역 개수를 17개 같은 고정값으로 가정하지 않는다. 반환된 시군구 코드가 요청한 시도와 일치하지 않으면 해당 행을 제외한다.

### 최상위 응답

| 필드 | 의미 |
| --- | --- |
| `status` | `ready`, `partial`, `error`, `awaiting_credentials` |
| `provider` | `opinet` |
| `dataGranularity` | 항상 `aggregate` |
| `fetchedAt` | 성공한 자료 묶음 중 가장 최근 수집시각. 원본 가격 기준시각이 아님 |
| `benchmarks` | 필터를 적용한 평균가격 레코드 배열 |
| `datasets` | 전국·시도·시군구별 상태, 수집시각, 개수, 캐시, 오류, 출처 |
| `coverage` | 요청 범위, 시도·유종·시군구 옵션. 전체 시장의 완전성을 보장하지 않으므로 `complete=false` |
| `cache` | 전체 캐시 상태. 개별 묶음의 상세 상태는 `datasets[].cache` |
| `warnings` | 날짜 미제공, 잘못된 행, 일부 API 실패 등 |
| `error` | 전체 실패 또는 인증키 대기의 공개용 오류. 인증키 포함 URL을 반환하지 않음 |

`ready`는 자료 수신·구조 처리가 완료됐다는 뜻이다. 원본 기준일이 오늘인지, 모든 주유소가 조사됐는지 또는 실제 판매가격이 같은지 보장하는 상태가 아니다.

### 평균가격 레코드

| 필드 | 의미 |
| --- | --- |
| `id` | 범위·지역·유종 조합. 예: `sido:01:B027` |
| `dataGranularity` | `aggregate` |
| `scope` | `national`, `sido`, `sigun` |
| `areaCode`, `areaName` | 원본 지역코드와 지역명. 전국은 코드 `null`, 이름 `전국` |
| `sidoCode`, `sigunCode` | 오피넷 지역코드. 선행 `0`을 보존 |
| `fuel`, `fuelName` | 제품코드와 제품명. 지역 API에 제품명이 없으면 확인된 코드명 사용 |
| `averagePrice` | 숫자로 검증한 평균가격. 양의 가격이 아니거나 확인 불가하면 `null` |
| `dayOverDayChange` | 전일 대비 증감. 하락은 음수, 보합은 `0`, 확인 불가는 `null` |
| `unit` | `KRW/L`; 화면에서는 `원/L` |
| `asOfDate` | `YYYY-MM-DD` 또는 `null`. 시각·시간대·자정을 붙이지 않음 |
| `dateStatus` | `reported` 또는 `unknown` |
| `dateIssue` | `null`, `not_provided`, `invalid`, `future` |
| `sourceDate` | 원본 `TRADE_DT` 문자열. 잘못됐거나 미래인 날짜도 보존 |
| `sourcePrice`, `sourceChange` | 원본 금액·증감 표기. 예를 들어 증감의 `+` 기호 보존 |
| `fetchedAt` | 해당 API의 정상 응답을 받은 시각 |
| `source` | 오피넷 이름·홈페이지·실제 API·공식 명세. 전국은 공공데이터 메타데이터 URL도 포함 |

## 3. 기준일과 수집시각

전국 API의 `TRADE_DT`는 숫자 또는 문자열인 8자리 날짜로 받아 달력 유효성을 검사한다. `20240229`는 허용하고 `20230229`, `20260230` 같은 날짜는 거부한다. 미래 여부는 응답 수집시각을 한국 날짜로 해석한 날과 비교한다. 미래인 원본값은 `sourceDate`에 남기고 `asOfDate=null`, `dateIssue=future`로 반환한다.

시도·시군구 API의 공식 반환값에는 `TRADE_DT`가 없다. 따라서 그 응답에 날짜가 없으면 `asOfDate=null`, `dateStatus=unknown`, `dateIssue=not_provided`다. 전국 평균의 날짜나 서버 수집일을 지역 평균의 기준일로 옮겨 넣지 않는다. 이후 공급자 응답에 실제 `TRADE_DT`가 들어오는 경우에는 동일한 날짜 검증을 적용한다.

| 원본 상태 | 화면 표시 지침 |
| --- | --- |
| 검증된 `asOfDate` 있음 | `기준일 YYYY-MM-DD` |
| `not_provided` | `기준일 미제공` |
| `invalid` 또는 `future` | `기준일 확인 필요` |
| 수집시각만 있음 | `수집 YYYY-MM-DD HH:mm`를 별도 표시 |
| 갱신 실패 후 캐시 | `이전 수집 자료`와 기존 기준일·수집시각 표시 |
| `averagePrice=null` | 가격 미제공 표시. `0원`으로 표시하지 않음 |

출처 표시는 [오피넷](https://www.opinet.co.kr/)으로 연결한다. `asOfDate`가 없다는 이유로 `fetchedAt`을 가격 갱신 시각으로 명명하거나, 날짜를 현재시각으로 생성해서는 안 된다.

## 4. 캐시·오류·호출량

모든 외부 요청은 주입한 `client.request()`로 수행하며, 요청마다 동일한 quota의 `reserve(1)`을 사용한다. `client.cached()`를 통해 기존 메모리 캐시, 동시 요청 병합, 실패 캐시, 만료자료 보존 정책도 공유한다. 캐시 키는 `benchmarks:v1:` 접두어를 사용해 개별 주유소 자료와 섞이지 않는다.

| 동작 | 캐시 미존재 시 API 호출 |
| --- | ---: |
| 전국 + 시도 전체 | 2회 |
| 위 결과에서 유종 변경 | 0회 |
| 위 결과에서 시도 선택 | 0회 |
| 선택 시도의 시군구 평균 추가 | 1회 |
| 같은 시군구 자료에서 유종 변경 | 0회 |
| 인증키 없음 | 0회 |

공식 [유가정보 API 안내](https://www.opinet.co.kr/user/custapi/custApiInfo.do)는 일반 API 19종과 기본 호출량 300회/일을 안내한다. 전국·시도 평균을 1일 6회 새로 수집한다면 `2 × 6 = 12`회가 추가된다. 기존 수집 계획이 최대 216회라면 합계는 228회다. 이는 운영 계획의 계산값이며, 서버의 추가 사용자 조회와 시군구 옵션은 남은 같은 한도에서 차감한다. 서버와 예약 수집기가 서로 다른 ledger로 같은 인증키를 소비하지 않도록 운영 환경에서도 호출량 저장소를 공유해야 한다.

평균자료가 없는 상태에서 인증키가 없으면 `awaiting_credentials`, `fetchedAt=null`, `benchmarks=[]`로 반환한다. 인증 오류나 한도 소진 시 평균을 만들어내지 않는다. 한 API만 실패하면 다른 API의 성공 자료를 `partial`로 제공한다. 갱신 실패로 이전 캐시를 반환하는 경우 기준일과 수집시각은 이전 값 그대로다.

잘못된 지역·유종 식별자는 제외한다. 같은 지역·유종이 서로 다른 가격·기준일로 중복되면 임의로 하나를 선택하지 않고 해당 항목을 제외한다. 응답 전체를 신뢰할 수 없으면 구조 오류로 처리해 기존 캐시 보존 경로를 사용한다.

## 5. 개별 판매가격·파일데이터와의 구분

[전국 개별 주유소 판매가격 파일데이터 15044646](https://www.data.go.kr/data/15044646/fileData.do)은 CSV 파일데이터이며, 제공 형태는 기관 자체 다운로드다. 연결 대상은 [오피넷 유가 내려받기](https://www.opinet.co.kr/user/opdown/opDownload.do)다. 이 파일데이터를 인증키 없이 자동 호출할 수 있는 실시간 개별가격 API로 간주하지 않는다. 이 어댑터는 CSV 다운로드, 내부 웹 요청 수집, 이미지에서 읽은 숫자를 실시간 가격으로 대체하는 처리를 포함하지 않는다.

| 사용 목적 | 적용 기준 |
| --- | --- |
| 시장 상황 참고 | 전국·시도·시군구 평균을 각 범위 이름과 함께 표시 |
| 평균 대비 차이 설명 | 동일 유종·단위와 각 자료의 기준일을 확인하고 평균 대비 차이라고 명시 |
| 특정 주유소 판매가격 | 개별 주유소 원본 조회 결과 사용 |
| 경유 추천·실제 절약액 계산 | 검증된 개별 가격과 실제 경로 비교 조건 사용. 평균을 자동 기준가격으로 삼지 않음 |

## 6. 검증

```bash
node --test tests/benchmarks.test.mjs

# 각 테스트 결과를 직접 확인하는 실행 방법
node tests/benchmarks.test.mjs
```

14개 회귀시험은 공식 예제의 과거값과 별도로 표시한 합성 오류 자료만 사용한다. 시험 데이터는 운영 응답이나 공개 스냅샷으로 내보내지 않는다. 검증 범위는 숫자·문자 날짜, 윤년과 잘못된 날짜, 한국 날짜 경계의 미래값, 날짜 누락, 증감의 부호와 0, 유종·지역코드, 최초 2회 호출, 유종 변경 캐시, 같은 클라이언트의 quota·동시 요청 공유, 시군구 선택 조회, 부분 실패, 만료 캐시의 시각 보존, 인증키 비노출, 중복가격 충돌이다.

실제 인증키를 연결한 외부 API 응답 검증은 수행하지 않았다. 운영 연결 후에는 지역 평균에 날짜가 새로 추가됐는지와 제품·지역코드 표현이 공식 예제와 같은지 확인하되, 미제공 날짜를 추측해 채우지 않는다.
