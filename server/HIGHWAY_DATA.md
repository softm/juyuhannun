# 한국도로공사 고속도로 주유소 연결

검증일: 2026-10-26 (Asia/Seoul)

## 연결 상태

`server/highway.mjs`는 한국도로공사 OpenAPI 0312의 HTTPS 끝점에 연결해 고속도로 주유소 가격을 수집한다. 인증키가 없을 때는 외부 요청 없이 `awaiting_credentials`를 반환하며, 키가 있을 때만 페이지별 호출량을 먼저 예약한다.

| 확인 항목 | 검증 결과 |
| --- | --- |
| 공식 자료 | [한국도로공사 주유소별 가격·업체 현황](https://data.ex.co.kr/openapi/basicinfo/openApiInfoM?apiId=0312) |
| 끝점 | `https://data.ex.co.kr/openapi/business/curStateStation` |
| 필수 요청값 | `key`, `type=json` |
| 페이지 요청값 | `numOfRows`, `pageNo` |
| 1회 최대 반환 | 99건. 1,000건을 요청해도 99건으로 제한됨 |
| 2026-10-26 실제 응답 | 전체 226건, 99·99·28건의 3페이지 |
| 정상 봉투 | `code=SUCCESS`, `message`, `count`, `pageNo`, `numOfRows`, `pageSize`, `list` |
| 가격 | `gasolinePrice`, `diselPrice`, `lpgPrice`; `1,864원` 형태 또는 `X` |
| 시설 정보 | `serviceAreaCode`, `serviceAreaCode2`, `serviceAreaName`, `routeCode`, `routeName`, `direction`, `oilCompany`, `lpgYn`, `telNo`, `svarAddr` |
| 좌표 | 원본 API에 없음 |
| 가격 변경시각 | 원본 API에 없음 |

공식 가이드 PDF는 `serviceAreaCode2`, `svarAddr`, 페이지 봉투를 모두 싣지 않은 오래된 문서다. 현재 안내 페이지와 실제 JSON 응답을 함께 검증해 계약을 확정했다. `diselPrice`는 제공기관의 실제 필드 철자를 그대로 읽고 앱에서는 `D047`로 정규화한다.

## 정규화 계약

| 원본 | 앱 필드 |
| --- | --- |
| `serviceAreaCode` | `id=EX-{serviceAreaCode}`, `serviceAreaCode` |
| `serviceAreaCode2` | `serviceAreaCode2` |
| `gasolinePrice` | `prices.B027.price` |
| `diselPrice` | `prices.D047.price` |
| `lpgPrice` | `prices.K015.price` |
| `lpgYn` | `lpgAvailable`, `facilities.lpg` |
| `oilCompany` | `oilCompanyCode`, 확인된 코드의 `oilCompanyName`·공통 `brand` |
| `svarAddr`, `telNo` | `address`, `phone` |

숫자 가격은 `KRW/L`로 저장한다. `X`는 0원이 아니라 해당 유종 가격 미제공으로 처리해 `prices`에서 제외한다. 원본에 가격 변경시각이 없으므로 모든 가격의 `priceUpdatedAt`은 `null`, `priceTimeStatus`는 `source_time_unavailable`이다. API를 받은 시각인 `fetchedAt`을 가격 변경시각으로 바꾸지 않는다.

2026-10-26 응답에는 휘발유 211곳, 경유 212곳, LPG 149곳의 숫자 가격이 있었다. 14곳은 휘발유와 경유가 모두 `X`였다. 노선명 2곳과 방향 4곳은 원본이 비어 있어 추정하지 않고 `null`로 보관한다.

## 기존 전국 자료와의 위치 보강

도로공사 응답 226곳 중 배포 중인 오피넷 전국 자료와 다음 근거로만 연결한다.

1. 유효 좌표가 있는 공식 주유소의 전화번호가 유일하게 일치한다.
2. 같은 전화번호가 여러 곳이면 방향을 포함한 정규화 명칭으로 한 곳만 결정된다.
3. 전화번호 일치가 없을 때 방향 포함 명칭 또는 주소가 정확히 일치하고 결과가 한 곳뿐이다.
4. 근거가 충돌하거나 단순 유사 명칭뿐이면 연결하지 않는다.

실제 대조에서 202곳에 좌표를 연결했고 24곳은 좌표 없이 유지했다. 연결된 레코드는 도로공사 ID를 그대로 주 식별자로 사용하고 `opinetStationId`, `coordinateMatchedBy`, `coordinateSource`를 별도로 기록한다. 도로공사 주소는 `address`에 보존하며 연결된 현재 도로명주소는 `roadAddress`에 추가한다. 오피넷 가격으로 도로공사 가격을 덮어쓰지 않는다.

## 페이지·오류·비밀키 경계

- 첫 페이지의 `count`, `numOfRows`, `pageSize`로 필요한 페이지 수를 계산하고 최대 20페이지를 넘으면 중단한다.
- 모든 페이지의 전체 건수와 페이지 크기가 같고, 합친 행 수가 `count`와 일치해야 발행한다.
- 식별자 중복, 잘못된 가격, LPG 여부와 가격의 모순, 오류 코드, 중간 페이지 실패는 새 스냅샷 전체 실패다.
- 실패 시 저장 계층은 이전 정상 스냅샷의 원래 `fetchedAt`과 가격을 유지하고 `partial`, `cache.stale`, 실패 경고를 붙인다.
- 인증키는 서버 환경과 GitHub Actions Secret에서만 읽는다. 공개 JSON, 오류, 출처 URL, 로그에는 넣지 않는다.
- 제공기관의 HTTPS 끝점만 사용하며 리디렉션을 허용하지 않는다.

## 실행과 검증

```bash
EX_API_KEY=발급키 npm run collect:energy
node --test tests/highway.test.mjs tests/collection.test.mjs tests/energy.test.mjs
npm run check
```

테스트 fixture는 페이지 순회, `X` 처리, 단위·시각, 좌표 연결, 모순 응답 거부, 네트워크 오류의 인증키 비노출, 캐시·동시 요청을 검증한다. 실운영 응답 검증에서는 공개 결과에 인증키가 포함되지 않는지 별도로 확인한다.
