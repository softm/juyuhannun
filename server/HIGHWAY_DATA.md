# 한국도로공사 고속도로 주유소 연결 상태

확인일: 2026-10-20 (Asia/Seoul)

## 현재 상태

`server/highway.mjs`는 서버와 수집기의 응답 계약을 연결하는 **명시적 미연동 경계**다. 실가격 HTTP 어댑터 구현은 완료되지 않았다. 인증키를 등록해도 현재 파일만으로 실가격 수집이 시작되지 않는다.

| 확인 항목 | 확인 결과 |
| --- | --- |
| 공식 자료 등록 | [한국도로공사 주유소별 가격·업체 현황](https://www.data.go.kr/data/15076636/openapi.do) 확인 |
| 제공 대상 | 고속도로 휴게소 주유소의 유가와 운영 업체 관련 자료 |
| 제공 포맷 | 공식 등록 설명에 XML·JSON 명시 |
| 상세 명세 위치 | [API0312 안내](https://data.ex.co.kr/openapi/basicinfo/openApiInfoM?apiId=0312) |
| HTTP 끝점·필수 매개변수 | 공식 PDF 검색 색인의 §3.10.1, p41/56에서 `http://data.ex.co.kr/openapi/business/curStateStation` 및 필수 `key`, `type` 확인 |
| 유종별 응답 필드·LPG 단위 | 확인하지 못함 |
| 페이지 번호·총건수·최대 페이지 크기 | 확인하지 못함 |
| 응답의 노선·시설 관련 필드 | 공식 PDF 검색 색인에서 `routeCode`, `serviceAreaCode`, `routeName`, `direction` 확인 |
| 좌표·주소·전화번호 필드 | 확인하지 못함 |
| 실제 가격 변경 시각 필드 | 확인하지 못함 |

공공데이터포털의 요약 설명을 구체적인 응답 스키마로 취급하지 않는다. 등록 페이지의 실시간 표시는 API 접근·갱신 설명이며, 개별 주유소 가격의 변경 시각을 증명하지 않는다.

### 공식 PDF에서 추가로 확인한 범위

[한국도로공사 OpenOASIS 활용 가이드 PDF](https://data.ex.co.kr/guidedown/openoasis_guide.pdf)의 검색 색인에서 **§3.10.1, p41/56** 내용을 확인했다. PDF 전체를 성공적으로 내려받아 검증한 상태는 아니며, 가격 필드가 있는 후속 페이지와 정상·오류 JSON의 공통 구조는 확인하지 못했다.

| 구분 | 검색 색인에서 확인한 이름 |
| --- | --- |
| 끝점 | `http://data.ex.co.kr/openapi/business/curStateStation` |
| 필수 요청 매개변수 | `key`, `type` |
| 선택 요청 매개변수 | `routeName`, `direction`, `oilCompany`, `serviceAreaName`, `routeCode`, `serviceAreaCode` |
| 확인된 응답 필드 | `routeCode`, `serviceAreaCode`, `routeName`, `direction` |

문서에 실린 HTTP 주소는 확인 사실로만 기록하며 현재 서버가 이 주소로 인증키를 전송하지 않는다. 실제 구현 전 가격 필드·단위·JSON 구조 및 HTTPS 전송 가능 여부를 검증해야 한다. **`EX_API_KEY`만 추가해도 현재 배포에서 실가격 연동이 시작되지는 않는다.**

## 현재 동작 계약

```js
const client = new HighwayClient({ apiKey, quota, fetchImpl, clock });
const result = await client.snapshot();
```

| 조건 | 응답 |
| --- | --- |
| 키 없음 | `status: awaiting_credentials`, `EX_CREDENTIALS_REQUIRED` |
| 키 있음 | `status: error`, `EX_SCHEMA_UNVERIFIED` |
| 공통 | `implementationReady: false`, `provider: ex`, `dataGranularity: station`, `stations: []`, `fetchedAt: null`, `coverage.complete: false` |
| `configured` | 키의 존재만 의미하며, 실연동 완료 여부가 아님 |
| 외부 요청·쿼터 소모 | 없음 |
| 비밀키 | 응답·오류·출처 URL에 포함하지 않음 |

기존 정상 스냅샷이 있는 운영 환경에서 실패 시각으로 기존 가격·수집 시각을 갱신하지 않는 처리는 수집기의 `preservePrevious()` 경계가 담당한다. 이 파일에는 검증되지 않은 가격 캐시를 새로 만드는 동작이 없다.

## 실가격 연동을 완성하기 위해 필요한 검증

1. 확인한 공식 끝점·필수 매개변수를 기준으로 HTTPS 전송 가능 여부와 정상·오류 JSON 구조를 검증한다.
2. `B027`(휘발유), `D047`(경유), `K015`(자동차용 LPG)로 정규화할 원본 필드와 `KRW/L` 단위를 확인한다. LPG 여부와 LPG 판매가격은 분리한다.
3. 정확한 시설 식별자 및 페이지 종료 조건을 확인하고, 실행당 요청 수·응답 크기·타임아웃 상한을 둔다. 현재 수집기 실행당 예산은 도로공사 20회다.
4. 가격 원본 시각이 없는 경우 각 `prices[fuel].priceUpdatedAt`을 `null`로 유지한다. 수집 시각은 각 가격의 `fetchedAt`과 별도로 기록한다.
5. 검증된 좌표가 없으면 `lat`, `lng`는 `null`이다. 이름을 이용한 위치 추정 및 오피넷 주유소와의 임의 병합은 하지 않는다.
6. 실제 공식 예제를 시험 전용 fixture로 검증하고, HTTP 오류·잘못된 응답·중복 또는 상충 자료·페이지 중간 실패·키 누출·이전 정상 캐시 보존을 검증한다.

예정된 주유소 UI 계약은 각 레코드의 `dataGranularity: station`, `unit: KRW/L`, `id`, `name`, `routeName`, `direction`, `operator`, `address`, `phone`, `lat`, `lng`, `fetchedAt`, `source`와 `prices.{B027,D047,K015}.{price,priceUpdatedAt,fetchedAt,unit}`이다. 확인되지 않은 원본 필드로 이 레코드를 생성하지 않는다.

```bash
node --test tests/highway.test.mjs
```

현재 시험은 미연동 상태를 성공으로 표시하지 않는지, 키 없이 외부 요청이 없는지, 비밀키가 공개 응답으로 나가지 않는지를 확인한다. 실제 도로공사 API와의 종단 검증을 통과했다는 의미는 아니다.
