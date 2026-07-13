# Apps Script 전환 2차: 시수 조회 read canary

## 현재 상태

`getTeacherHoursDashboardData`에 Firebase ID 토큰 기반 Supabase 읽기 handler를 연결했다.

활성 강사 31명의 시수 조회 canary가 준비되어 있다. 과거 월은 Supabase를 직접 읽고, 현재 월은 기존 Apps Script 결과를 적용하면서 Supabase 결과를 백그라운드에서 비교한다. 안준성은 관리자 범위, 나머지 30명은 본인 강사 범위만 읽을 수 있다.

Firebase 강사 identity와 Supabase `teachers` identity는 정규화한 휴대폰 번호와 표시 이름이 모두 일치하는 경우에만 연결한다. Firestore의 기존 `supabaseInstructorId` 값은 이 전환의 연결 근거로 사용하지 않는다.

## 활성화 전 필수 조건

1. Supabase 프로젝트의 Authentication 설정에서 Firebase Third-Party Auth를 추가한다.
2. Firebase 프로젝트 ID는 `fir-lms-prod`로 제한한다.
3. 대상 Firebase 사용자에게 `role: authenticated` custom claim을 설정한다.
4. `202607130001_firebase_portal_identity_scopes.sql`을 검토 후 적용하고 대상 UID 범위를 투영한다.
5. `202607130002_teacher_hours_firebase_read_canary.sql`을 검토 후 적용한다.
6. `202607140002_expand_teacher_hours_all_active_identities.sql`을 적용해 활성 강사 31명의 identity를 휴대폰 번호와 표시 이름으로 엄격히 대조한다.
7. RLS 허용 테스트와 다른 강사·익명·claim 누락 거부 테스트를 통과한다.
8. Supabase publishable key를 runtime config에 설정한다. secret/service-role key는 브라우저에 넣지 않는다.

## runtime config

```js
window.__TPORTAL_SUPABASE_PUBLIC_CONFIG__ = {
  enabled: true,
  url: 'https://wfgtqajdkwzuqkwygcft.supabase.co',
  publishableKey: 'SUPABASE_PUBLISHABLE_KEY',
  firebaseProjectId: 'fir-lms-prod',
  // 실제 목록은 scripts/teacher-hours-canary-users.mjs와
  // portal-runtime-config.js에서 동일한 31명으로 관리한다.
  canaryFirebaseUids: ['teacher_...'],
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

1. 테스트 관리자 한 명으로 shadow 비교 — 완료
2. 본인 강사 2명의 범위와 결과 비교 — 완료
3. 3명 canary의 과거 월 직접 읽기 전환 — 완료
4. 활성 강사 31명의 Firebase Auth claim과 Supabase identity 엄격 대조 — 완료
5. 2026년 6월 시수 결과 31/31 동등성 확인 — 완료
6. 일반 강사 30명의 타 강사 범위 접근 차단 확인 — 완료
7. claim 누락 사용자와 익명 사용자의 401 응답 확인 — 완료
8. Supabase 실패 시 자동 GAS 복귀와 `enabled: false` rollback 확인 — 완료

2026년 6월 최종 검사에서 31명 모두 Apps Script 결과와 Supabase 결과가 일치했다. 비교 시 응답 생성 시각인 `fetchedAt`은 업무 데이터가 아니므로 제외하며, 행·시수·일자별 합계 등 실제 상태값은 계속 엄격히 비교한다.

### 현재 canary 범위

- 안준성: 관리자 권한으로 전체 강사 조회 가능
- 나머지 활성 강사 30명: 본인 시수만 조회 가능
- 정식 목록: `scripts/teacher-hours-canary-users.mjs`

현재 월과 모든 쓰기 action은 계속 Apps Script 경로를 사용한다. 이번 단계는 과거 월 시수 조회만 직접 읽기로 전환하며 운영 출결·시수 원본을 수정하지 않는다.

롤백은 `portal-runtime-config.js`의 `enabled`를 `false`로 배포해 모든 브라우저 읽기 경로를 GAS로 즉시 복귀시킨다. 필요하면 이후 대상 Firebase custom claim의 `role`과 `portal_identities` 활성 상태를 별도로 회수한다.

## 공식 참고 자료

- [Supabase Firebase Auth 연동](https://supabase.com/docs/guides/auth/third-party/firebase-auth)
- [Supabase Third-Party Auth 개요](https://supabase.com/docs/guides/auth/third-party/overview)
