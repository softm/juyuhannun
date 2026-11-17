# 주유한눈 Cloudflare 경로 프록시

Firebase 결제와 독립적으로 네이버 자동차 길찾기를 호출한다. 기존 `{summary,path,section}` 계약, Origin 제한, 좌표 검증, 최대 16KiB 요청, upstream 재시도와 오류 안내를 유지한다.

- Worker: `juyuhannun-directions`, POST `/directions`
- 비밀값: `NAVER_MAPS_API_SECRET` (기존 GitHub `NAVER_MAPS_API_KEY`에서 배포 시 주입)
- 테스트: `node --test services/cloudflare-directions/test/*.mjs`
- 배포: GitHub Actions `Deploy Cloudflare directions` 수동 실행
- 필요한 GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, 기존 `NAVER_MAPS_API_KEY`
- API token 권한: 해당 계정 Workers Scripts 편집 및 계정 조회. 다른 서비스 권한은 필요하지 않다.
- 배포 후 실제 URL에서 허용 Origin의 OPTIONS, POST 경로를 검증하고 `public/js/route-mode.js`의 DIRECTIONS_PROXY를 교체한다. 정상 응답 확인 전 프런트엔드 주소는 바꾸지 않는다.
- 메모리 호출 제한은 isolate별 30회/분이며 전역 비용 상한은 아니다. 기존 Firebase 함수도 인스턴스별 제한이었다.

기존 돌봄한눈 공용 Firebase 함수는 수정하지 않는다. 주유한눈만 전환 대상으로 한다.
