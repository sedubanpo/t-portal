# Apps Script 전환 2차: 시수 조회 read canary

## 현재 상태

`getTeacherHoursDashboardData`에 Firebase ID 토큰 기반 Supabase 읽기 handler를 연결했다.

관리자 `안준성` 1명에 한해 시수 조회 canary가 활성화되어 있다. 과거 월은 Supabase를 직접 읽고, 현재 월은 기존 Apps Script 결과를 적용하면서 Supabase 결과를 백그라운드에서 비교한다.

## 활성화 전 필수 조건

1. Supabase 프로젝트의 Authentication 설정에서 Firebase Third-Party Auth를 추가한다.
2. Firebase 프로젝트 ID는 `fir-lms-prod`로 제한한다.
3. 테스트 Firebase 사용자에게 `role: authenticated` custom claim을 설정한다.
4. `202607130001_firebase_portal_identity_scopes.sql`을 검토 후 적용하고 테스트 UID 범위를 투영한다.
5. `202607130002_teacher_hours_firebase_read_canary.sql`을 검토 후 적용한다.
6. RLS 허용 테스트와 다른 강사·익명·claim 누락 거부 테스트를 통과한다.
7. 테스트용 Supabase publishable key를 runtime config에 설정한다. secret/service-role key는 브라우저에 넣지 않는다.

## runtime config

```js
window.__TPORTAL_SUPABASE_PUBLIC_CONFIG__ = {
  enabled: true,
  url: 'https://wfgtqajdkwzuqkwygcft.supabase.co',
  publishableKey: 'SUPABASE_PUBLISHABLE_KEY',
  firebaseProjectId: 'fir-lms-prod',
  canaryFirebaseUids: ['teacher_01089945993'],
  pastMonthsDirect: true,
  shadowActions: ['getTeacherHoursDashboardData'],
  timeoutMs: 7000,
  maxCurrentMonthAgeMs: 900000
};
```

## 동작 방식

- 로그인 후 Firebase 토큰의 `sub`, `iss`, `aud`, `role`을 확인한다.
- `canaryFirebaseUids`에 등록된 계정만 canary route를 활성화한다.
- 과거 월은 Supabase 요약을 직접 반환한다.
- 현재 월은 기존 GAS 결과를 즉시 적용하고 Supabase 요약을 shadow 비교한다.
- 과거 월 Supabase 요청이 실패하거나 요약이 없으면 GAS로 자동 복귀한다.
- Supabase 요약은 백그라운드에서 읽고 `state` 기준으로 비교한다.
- 설정 누락, claim 누락, 권한 거부, timeout, 범위 불일치가 발생해도 사용자 결과는 GAS로 유지된다.
- 쓰기 action은 Supabase canary 대상에 포함할 수 없다.
- 현재 월의 Supabase 요약이 오래되었으면 직접 route에서는 거부한다.
- `forceRefresh`는 직접 route에서 거부하고 기존 서버 경로를 사용한다.

## 점진 전환 순서

1. 테스트 관리자 한 명으로 shadow 비교
2. 본인 강사 범위 shadow 비교
3. 과거 월 3개월의 행·시수·일자별 합계 비교
4. 현재 월 지연 시간과 최신성 비교
5. 불일치 0건을 확인한 뒤 테스트 계정의 과거 월 조회만 `supabase` 직접 읽기로 전환 — 완료
6. Supabase 실패 시 자동 GAS 복귀와 `enabled: false` rollback 확인 — 완료

전체 운영 전환 전에는 `canaryFirebaseUids`를 확대하지 않는다. 즉시 복귀할 때는 `enabled: false`로 변경한다.

## 공식 참고 자료

- [Supabase Firebase Auth 연동](https://supabase.com/docs/guides/auth/third-party/firebase-auth)
- [Supabase Third-Party Auth 개요](https://supabase.com/docs/guides/auth/third-party/overview)
