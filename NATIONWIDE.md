# 전국 주유소 일 단위 수집

## 목표

주유한눈은 기존 일반 Open API 반경 수집을 서비스 폴백으로 유지하면서, 오피넷 프리미엄 API의 **전국 주유소 기본정보(지역별 전체)**와 **전국 주유소 판매가격(지역별 전체)**를 매일 1회 수집하는 구조를 사용한다.

공식 안내상 프리미엄 API는 계약 후 고유 Key와 Client 서버 IP 등록이 필요하므로, 운영 수집기는 고정 IP 서버 또는 고정 IP self-hosted runner에서 실행하는 것을 기준으로 한다.

## 데이터

- `public/data/nationwide/master.json`: 최신 전국 주유소 기본정보
- `public/data/nationwide/latest.json`: 화면에서 사용하는 기본정보+최신 판매가격
- `public/data/nationwide/history/YYYY-MM-DD.json`: 일별 가격만 저장한 경량 스냅샷
- `public/data/nationwide/manifest.json`: 건수·기준시각·파일 위치

브라우저는 `latest.json`이 ready/partial이고 1건 이상이면 전국본을 우선 사용한다. 그렇지 않으면 기존 `public/data/stations.json`으로 자동 폴백한다.

## 설정

Secrets:
- `OPINET_API_KEY`: 일반 API 지역코드 조회용
- `OPINET_PREMIUM_API_KEY`: 제휴 후 발급되는 프리미엄 Key

Repository variables:
- `OPINET_PREMIUM_MASTER_URL`: 계약 가이드의 전국 주유소 기본정보 엔드포인트
- `OPINET_PREMIUM_PRICE_URL`: 계약 가이드의 전국 주유소 판매가격 엔드포인트
- `OPINET_PREMIUM_KEY_PARAM`: 기본 `certkey`; 계약 가이드가 다를 때만 지정
- `OPINET_PREMIUM_AREA_PARAM`: 기본 `area`; 계약 가이드가 다를 때만 지정

엔드포인트 이름을 공개 페이지만 보고 추정하지 않는다. 계약 시 받은 프리미엄 개발가이드의 값을 그대로 등록한다.

## 실행

```bash
npm run collect:nationwide
```

GitHub Pages 워크플로에는 KST 03:37 일 단위 실행 조건이 추가되어 있다. 프리미엄 설정이 없으면 전국본을 덮어쓰지 않고 기존 일반 API 자료가 계속 서비스된다.

## 운영 주의

프리미엄 API 공식 안내는 Client 서버 IP를 확인하며 Key당 최대 3개 IP를 등록한다고 명시한다. 일반 GitHub-hosted runner의 가변 IP를 운영 프리미엄 수집기로 가정하지 않는다. 실제 제휴 후에는 고정 IP 수집 서버/self-hosted runner에서 이 스크립트를 실행하고 생성된 nationwide 디렉터리를 Pages 배포 흐름에 공급한다.
