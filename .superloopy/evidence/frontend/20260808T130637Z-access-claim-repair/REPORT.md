# Access 출결 모아보기 인증 복구

- Target: SEDU Teacher Portal v510, authenticated internal DOM Web, Chrome/macOS production deployment
- Affected users: 강사 포털의 Access 업로드를 사용하는 관리자 계정
- Affected journey: 로그인 → Supabase 업로드 → Access 출결 모아보기
- Adjacent regression surfaces: 강사 시수 조회, 주간 시간표, 수강생 이동 트래커, 중지생 현황, Access 업로드
- Root cause: Firebase custom claim의 `role`을 앱 업무 역할(`ADMIN`)과 Supabase JWT 역할(`authenticated`)에 동시에 사용한 레거시 충돌. 관리자 4명의 토큰이 `role: ADMIN`이어서 Supabase 직접 조회 전 검증에서 거부됨.
- Account-management finding: 현재 `provisionTeacherAccount`는 이미 `authenticated`를 쓰고 있었으므로 이번 개편의 일반 강사 생성 흐름이 직접 원인은 아니었다. 다만 관리자 claim projection이 명시적이지 않아 `role`/`isAdmin` 분리를 고정하고 회귀 검사를 추가함.

## UX delta

권한 claim이 오래된 관리자 계정은 오류 화면으로 종료하지 않고, 활성 강사 포털 권한을 서버에서 확인한 뒤 claim을 한 번 복구하고 새 ID 토큰으로 원래 조회를 자동 재개한다. 복구 요청은 동시에 여러 조회가 시작돼도 하나로 병합한다.

- Design impact: unchanged — 레이아웃, 색상, 문구 및 컨트롤은 변경하지 않음.
- Visual evidence: not applicable — 비시각적 인증·복구 동작 수정.
- Accessibility impact: unchanged — 기존 상태 영역과 오류 전달 구조를 유지함.
- Recovery truth: 활성 계정·강사 포털 권한을 서버가 확인하지 못하면 기존 오류가 그대로 표시되며, 허가되지 않은 계정에 claim을 부여하지 않음.

## Implementation traceability

| Invariant | Owner | Test / evidence |
| --- | --- | --- |
| Supabase JWT `role`은 `authenticated`이며 관리자 여부는 `isAdmin`으로 분리 | `account-management/functions/index.js` | Node 22 runtime verification 통과 |
| 기존 claim은 보존하고 잘못된 역할만 복구 | `repairTeacherPortalAccess` | 실서버 `ALREADY_READY`, unauthenticated 401, CORS 204 |
| 읽기 전에 잘못된 `ADMIN` 역할을 자동 복구하고 원 요청 재개 | `index.html#getValidatedPortalSupabaseToken_` | `test-supabase-teacher-hours-backend.mjs` 통과 |
| 복구 요청은 동시 조회에서 중복 실행하지 않음 | `teacherPortalSupabaseAccessRepairPending_` | 정적 구현 검토 및 백엔드 테스트 |
| 인접 Supabase 직접 조회도 동일한 안전망 사용 | Access/주간시간표/이동트래커/중지생 직접 경로 | 관련 회귀검사 통과 |

## Verification

- Active teacher-portal accounts audited: 34
- Accounts repaired: 4 (`김용찬`, `안준성`, `에스에듀`, `홍성우`)
- Post-repair invalid claims: 0
- Preserved admin authority: all 4 retained `isAdmin: true`
- Production Firebase Functions: Node.js 22, ACTIVE
- Production endpoint guard: CORS preflight 204; unauthenticated POST 401
- Production admin token: `role: authenticated`, `isAdmin: true`
- Production Supabase read: HTTP 200, representative August attendance row returned
- Production repair endpoint: HTTP 200, `ALREADY_READY`
- Portal tests: Supabase backend, instant agreement cache, weekly timetable direct safeguards all passed

## Limitation

실사용 브라우저의 기존 ID 토큰은 최대 한 번 새로고침이 필요할 수 있다. v510은 Access 조회를 시작할 때 강제 토큰 갱신 및 자동 복구를 수행하므로, 배포 후 페이지 새로고침으로 정상화된다.
