# Apps Script 전환 1차 기반

## 목적

강사 포털의 화면 코드를 특정 백엔드 호출 방식에서 분리하고, Firebase UID 기반 Supabase 권한 모델을 운영 적용 전에 검증할 수 있게 한다.

이번 단계는 기존 사용자 경로를 변경하지 않는다. 모든 action의 기본 route는 `gas`다.

## `portalApi` route

- `gas`: 현재 Apps Script JSONP 또는 iframe POST 경로
- `supabase`: 등록된 Supabase backend로 단독 호출
- `shadow`: GAS 결과를 사용자에게 반환하고, 읽기 전용 Supabase 결과를 백그라운드에서 비교

쓰기 action은 `shadow`로 설정할 수 없다. 브라우저 이중 쓰기를 방지하기 위한 고정 규칙이다.

라우팅은 `window.portalApi`에서 관리한다.

```js
portalApi.registerBackend('supabase', supabaseHandler);
portalApi.setRoute('getTeacherHoursDashboardData', 'shadow');
portalApi.getSnapshot();
```

운영 코드에서 route를 변경하기 전 다음 조건을 모두 충족해야 한다.

1. Firebase token 검증 또는 Supabase Firebase Third-Party Auth가 준비되어 있다.
2. Firebase UID와 강사·담임·관리자 범위가 Supabase identity/scope에 투영되어 있다.
3. 대상 테이블 RLS의 허용·거부 테스트가 통과했다.
4. 기존 GAS 결과와 shadow 결과가 선택 월·강사·관리자 범위에서 일치한다.
5. 운영 route를 즉시 `gas`로 되돌릴 수 있다.

## 권한 마이그레이션

`202607130001_firebase_portal_identity_scopes.sql`은 다음 기반만 만든다.

- Firebase UID와 teacher ID 연결
- 강사·담임·관리자 역할
- 전체 강사/학생 접근 여부
- 명시적 강사·학생 scope
- 본인 identity/scope만 읽을 수 있는 RLS
- 향후 업무 테이블 정책에서 사용할 접근 판정 함수

이 마이그레이션은 `attendance_logs`, `class_log_rows`, `signatures` 등 운영 테이블의 정책을 열지 않는다. UID backfill과 데이터 동등성 검증 전에는 직접 조회를 허용하지 않는다.

## 검사 명령

```sh
node scripts/audit-apps-script-dependency.mjs --check
node scripts/test-portal-api-router.mjs
```

감사 결과의 핵심 지표:

- Apps Script dispatcher action 수
- 브라우저 bridge action 수와 읽기/쓰기 구분
- `google.script.run` 참조 수
- 브라우저 Supabase client 연결 수
- RLS 활성화 테이블과 policy 수
- bridge action의 dispatcher/metadata 누락

## 다음 구현 대상

1. Supabase Firebase Third-Party Auth 가능 여부와 custom claim 생성 경로 검증
2. 테스트 UID로 identity/scope seed
3. `getTeacherHoursDashboardData`의 읽기 전용 Supabase handler
4. shadow 비교에서 volatile metadata를 제외한 action별 비교 규칙
5. 관리자 canary에서 과거 월 조회 데이터·지연 시간 비교

