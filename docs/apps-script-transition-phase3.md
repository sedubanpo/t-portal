# Apps Script 전환 3차: 수강생 통합 관리 월별 요약 직접 조회 canary

## 선정 이유

`getStudentStatsMonthlyOverview`는 관리자 로그인 직후 현재 월과 인접 과거 월을 미리 읽고, 수강생 통합 관리에서 월을 이동할 때 다시 사용한다. 월별 snapshot이 이미 `student_stats_monthly_snapshots`에 저장되므로 새 집계 로직을 브라우저에 만들지 않고 기존 서버 결과를 그대로 비교할 수 있다.

운영 Apps Script 응답의 학생 통계 스키마는 `v291`이지만 웹은 `v290`까지만 허용하고 있었다. 이 불일치로 최신 월별 요약을 거부하고 전체 월 데이터를 다시 읽는 fallback이 발생할 수 있어 웹 스키마를 `v291`로 맞췄다. `v290`과 `v289`는 전환 중 호환 응답으로만 허용한다.

## 이번 단계의 범위

- 안준성 관리자 1명에게 `getStudentStatsMonthlyOverview` Supabase 직접 조회를 활성화한다.
- 정상 상태에서는 Supabase snapshot을 바로 사용하고, 누락·오류 시 Apps Script로 자동 복귀한다.
- 현재 월 snapshot이 5분보다 오래되면 정상 자료를 먼저 표시하고 Apps Script 갱신은 백그라운드에서 실행한다.
- 현재 월 snapshot이 24시간보다 오래됐거나 누락·손상된 경우에만 화면 진입 요청이 Apps Script 복구 경로를 기다린다.
- 일반 강사는 학생 전체 snapshot을 읽을 수 없다.
- 익명 사용자는 테이블 접근 권한이 없다.
- 강제 새로고침과 모든 쓰기 action은 Apps Script 경로를 유지한다.

## 권한

`202607140003_student_stats_snapshot_admin_read_canary.sql`은 Firebase issuer, audience, authenticated claim을 확인한 뒤 활성 `portal_identities` 중 `admin` 또는 `all_student_access` 계정에만 snapshot 읽기를 허용한다. `anon` 권한과 insert/update/delete 권한은 부여하지 않는다.

## 직접 읽기 전환 조건

1. 현재 월과 인접 과거 2개월 GAS/Supabase 결과가 모두 일치한다.
2. 일반 강사 계정은 동일 쿼리에서 0행만 받는다.
3. 익명 요청은 401 또는 403으로 거부된다.
4. 업로드·복구·Firebase 동기화 후 snapshot 무효화 또는 최신성 판정 경로를 추가한다.
5. snapshot 누락·손상·24시간 초과·요청 실패 시 GAS 자동 복귀를 검증한다.

## 무효화와 캐시 안전장치

- Access 업로드·업로드 복구·Firebase 동기화가 끝나면 영향을 받은 월의 `v291` snapshot을 삭제한다.
- 학생 마스터 동기화가 끝나면 모든 `v291` snapshot을 삭제한다.
- 현재 월 브라우저 메모리·세션 캐시는 5분간 즉시 사용한다.
- 5분을 넘긴 정상 로컬 캐시는 먼저 표시한 뒤 Supabase 확인과 백그라운드 갱신을 수행한다.
- 사용자가 강제 새로고침하면 브라우저 캐시를 모두 지우고 Apps Script 집계를 실행한다.

## v481 로딩 개선

- 로그인 예열 범위를 최근 4개월에서 현재 월과 직전 월로 줄였다.
- 보강 추적기·수강생 이동 트래커·중지생 현황은 각 화면을 열 때 조회한다.
- 동일 월 요청은 하나의 진행 중 요청을 공유해 로그인 예열과 화면 진입이 중복 호출하지 않는다.
- 정상 Supabase snapshot은 5분 경과만으로 폐기하지 않는다. 먼저 표시하고 갱신 상태를 제목 아래에 안내한다.
- 수강생 통계 요청은 25초·재시도 없음으로 제한해 레거시 경로에서 장시간 화면이 멈추는 상황을 줄였다.

위 조건을 구현하고 회귀 검사를 통과한 뒤 관리자 1명에게만 직접 route를 적용한다. 일반 강사 경로와 모든 쓰기 action은 변경하지 않는다.
