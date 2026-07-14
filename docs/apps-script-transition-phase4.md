# Apps Script 전환 4단계: 로그인 초기 데이터 관리자 canary

## 적용 범위

- 로그인 후 공통 정보, 공지, 학생 메타데이터, 담임/SLMS 매핑 응답을 짧은 수명의 사용자별 Supabase 스냅샷으로 저장합니다.
- 첫 적용 대상은 Firebase UID `teacher_01089945993` 관리자 1명입니다.
- 일반 강사, 로그인 인증, 시수/출결 쓰기 경로는 이번 단계에서 변경하지 않습니다.

## 안전장치

- 스냅샷은 기존 Apps Script가 Firebase 토큰과 Firestore 권한 범위를 검증한 뒤 만든 최종 응답만 저장합니다.
- 브라우저는 원본 학생 테이블을 직접 읽지 않습니다.
- RLS는 본인 UID이면서 전체 학생 조회 권한이 있는 관리자만 읽도록 제한합니다.
- 익명 접근과 일반 강사의 관리자 스냅샷 접근은 차단합니다.
- 5분이 지나거나 스냅샷이 없거나 불완전하면 Apps Script로 자동 복귀하고 새 스냅샷을 생성합니다.
- 마스터 동기화나 학생 권한 범위 변경 시 기존 스냅샷을 폐기합니다.

## 기대 효과

- 첫 조회 이후 5분 동안 로그인 초기 데이터는 Supabase에서 직접 읽어 Apps Script 왕복과 스프레드시트/Firestore 재조합 시간을 줄입니다.
- 관리자 canary에서 응답 동등성, 최신성, 일반 강사 차단을 확인한 뒤 적용 대상을 넓힐 수 있습니다.

## 검증 명령

```bash
node scripts/test-login-bootstrap-snapshot.mjs
node scripts/test-login-bootstrap-direct-canary.mjs
node scripts/test-portal-api-router.mjs
node scripts/audit-apps-script-dependency.mjs
```
