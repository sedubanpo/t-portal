# 탈 Apps Script 남은 과정

## 현재 완료 범위

- 활성 강사 31명의 과거·현재 월 시수 요약은 Supabase를 직접 읽습니다.
- 로그인 초기 데이터는 활성 강사 31명이 본인 UID 스냅샷을 Supabase에서 직접 읽습니다.
- 수강생 통합 관리의 전체 학생 월별 요약은 관리자 1명 canary로 직접 읽습니다.
- 직접 조회가 누락·지연·오래된 상태이면 기존 Apps Script로 자동 복귀합니다.
- 모든 운영 쓰기와 강제 새로고침은 기존 서버 경로를 유지합니다.

## 남은 작업

1. **로그인 프로필 확인 경로 이전**
   - Firebase Auth 로그인 뒤 계정 역할·강사명·관리자 범위를 확인하는 `loginFirebaseAuth` 서버 호출을 Supabase identity/profile 조회로 대체합니다.
   - 계정 비활성화와 관리자 범위가 기존 응답과 일치하는지 shadow 검증이 필요합니다.

2. **관리자 학생 통계 직접 조회 확대**
   - 현재 관리자 1명 canary인 `getStudentStatsMonthlyOverview`를 전체 승인 관리자에게 확대합니다.
   - 전체 학생 메타데이터가 포함되므로 일반 강사에게는 열지 않습니다.

3. **단순 읽기 API 이전**
   - 공지, 일정, 제출 현황처럼 Supabase에 이미 저장된 읽기 API를 action별로 shadow 비교한 뒤 직접 조회로 바꿉니다.
   - 각 action은 본인·담임·관리자 범위를 별도 RLS로 검증합니다.

4. **운영 쓰기 서버 이전**
   - 시수 동의, 출결, 수업일지, 업로드 같은 쓰기는 브라우저 직접 쓰기가 아니라 Supabase Edge Function 또는 제한된 RPC로 이전합니다.
   - 중복 제출 방지, idempotency key, 감사 로그, 재시도와 롤백 검증이 선행되어야 합니다.

5. **배치·외부 연동 이전**
   - 마스터 동기화, 캐시 무효화, Notion 연동, 예약 작업을 Edge Function/스케줄러로 옮깁니다.
   - 서버 비밀키는 브라우저나 GitHub Pages에 노출하지 않습니다.

6. **Apps Script 호환 브리지 제거**
   - 모든 읽기·쓰기·배치의 운영 검증이 끝난 뒤에만 `google.script.run`과 Apps Script 배포를 제거합니다.
   - 그 전까지는 장애 시 즉시 복귀할 수 있는 fallback으로 유지합니다.
