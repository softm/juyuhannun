# 전국 주유소 무료 일 단위 수집

## 운영 방식

프리미엄 API를 기본 전제로 하지 않는다. 한국석유공사 오피넷의 공개 **유가내려받기** 화면에서 로그인 없이 제공되는 CSV를 하루 1회 받아 전국 개별 판매가격을 만든다.

- 현재 판매가격(주유소): `POST https://www.opinet.co.kr/user/opdown/opDownload.do`, CSV `type=5`, `searchCond=1`
- 사업자 기본정보(주유소): 같은 주소, CSV `type=4`, `searchCond=1`
- 자동차충전소(LPG)도 `searchCond=2`로 같은 방식으로 받는다.
- 공공데이터포털 데이터셋: https://www.data.go.kr/data/15044646/fileData.do

다운로드 전 GET으로 `commonForm`과 세션 쿠키를 받고, 그 폼의 숨은 필드를 그대로 보존한 뒤 CSV 타입만 덮어쓴다. 화면 개편으로 CSV 대신 HTML이나 비정상적으로 작은 파일이 오면 기존 정상 nationwide 파일을 덮어쓰지 않는다.

## 좌표

오피넷 일괄 CSV에는 고유번호·상호·상표·주소·제품가격·셀프여부가 중심이며 지도 좌표는 별도 보강한다.

1. 이전에 확인된 Opinet 고유번호 좌표
2. 현재 일반 Open API로 수집한 좌표
3. 공공데이터포털 `전국주유소표준데이터`의 주소/전화번호 좌표

표준데이터 API: `https://api.data.go.kr/openapi/tn_pubr_public_conm_api`  
개발계정은 페이지당 최대 1000건이며 공공데이터포털 안내상 개발계정 신청 가능 트래픽은 10,000이다.

표준데이터 좌표를 자동 보강하려면 Repository Secret `DATA_GO_KR_SERVICE_KEY`를 등록한다. 키가 없어도 전국 가격·이력 수집은 수행하지만 좌표 매칭률이 80% 미만이면 브라우저는 기존 일반 Opinet 반경 자료를 계속 사용한다.

## 생성 파일

- `public/data/nationwide/master.json`: 전국 사업자 기본정보와 확보된 좌표
- `public/data/nationwide/latest.json`: 좌표가 확인된 현재 판매가격
- `public/data/nationwide/history/YYYY-MM-DD.json`: 전체 일별 가격 이력
- `public/data/nationwide/manifest.json`: 전체 가격 건수, 지도 매칭 건수/비율, 서비스 전환 여부

## 가격 기준

일괄 CSV는 개별 주유소의 정확한 보고 시각을 제공하지 않으므로 `priceUpdatedAt`을 임의 생성하지 않는다. 대신 `priceTimeStatus=daily_current_file`과 실제 파일 수집시각을 보관한다. 화면에는 **당일 일괄자료 · 개별시각 미제공**으로 표시한다.

## 실행

```bash
npm run collect:nationwide
```

GitHub Actions는 KST 03:37에 매일 실행하며 수동 실행과 코드 push 때도 수집기를 검증한다. 일반 `OPINET_API_KEY` 300회/일은 이 전국 CSV 다운로드에 사용하지 않는다.
