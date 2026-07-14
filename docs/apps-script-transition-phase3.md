# Apps Script 전환 3차: 수강생 통합 관리 월별 요약 shadow

## 선정 이유

`getStudentStatsMonthlyOverview`는 관리자 로그인 직후 현재 월과 인접 과거 월을 미리 읽고, 수강생 통합 관리에서 월을 이동할 때 다시 사용한다. 월별 snapshot이 이미 `student_stats_monthly_snapshots`에 저장되므로 새 집계 로직을 브라우저에 만들지 않고 기존 서버 결과를 그대로 비교할 수 있다.

운영 Apps Script 응답의 학생 통계 스키마는 `v291`이지만 웹은 `v290`까지만 허용하고 있었다. 이 불일치로 최신 월별 요약을 거부하고 전체 월 데이터를 다시 읽는 fallback이 발생할 수 있어 웹 스키마를 `v291`로 맞췄다. `v290`과 `v289`는 전환 중 호환 응답으로만 허용한다.

## 이번 단계의 범위

- 안준성 관리자 1명에게 `getStudentStatsMonthlyOverview` Supabase shadow 비교를 활성화한다.
- 사용자가 받는 결과는 계속 Apps Script 응답이다.
- Supabase 결과는 백그라운드에서 월·입력 행 수·학생별 집계 행을 비교한다.
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
5. snapshot 누락·stale·요청 실패 시 GAS 자동 복귀를 검증한다.

4번 조건이 구현되기 전에는 학생 통계 API를 Supabase 직접 route로 전환하지 않고 shadow 상태로 유지한다.
