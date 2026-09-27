# 수업일지 파일럿 후속 검증 — 2026-09-28

## 검증 결과

- 단위·회귀 테스트 30개 통과: 초안 소유권, 관리자 본인 작성, 담당 학생 범위, 순서 역전, 중복 제출, 파일 불변성, 실패 복구, 제한 파일럿, 로컬 목록 필터.
- Auth/Firestore/Storage 에뮬레이터 + 승인된 별도 Notion DB 통합 검사 12개 통과. 재로그인 내용 유지, 경쟁 저장 200/409, 관리자 본인 작성과 타인 수정 금지, 실제 이미지 전송, 전송 실패 후 재시도, 단일 페이지 생성 확인.
- iPhone Safari: 사용자 직접 작성·새로고침 확인 보고. 서버와 Notion에서 제출 결과 별도 대조.
  - ‘1’: submitted, revision 8, 첨부 0, Notion 결과 1건.
  - ‘복구 테스트’: submitted, revision 5, 첨부 0, Notion 결과 1건.
- iPhone 오프라인 및 파일 선택/첨부는 사용자 요청으로 검증 범위에서 제외. 데스크톱 모의 시험이나 서버 파일 전송 결과를 실기기 검증으로 대체하지 않음.

## 후속 수정

- 관리자 강사/상태 필터를 IndexedDB 복구본에도 적용. 다른 강사 또는 제출 완료 필터에 본인 작성 중 복구본이 섞이지 않도록 수정.
- ownerUid가 없는 이전 로컬 초안은 서버에서 본인 소유 확인 후에만 소유 정보 보완. 오프라인에서 소유권을 추정하지 않음.

## 실행

```sh
node --test scripts/test-lesson-log-client.cjs scripts/test-lesson-logs.cjs scripts/test-identity-repair.cjs scripts/test-portal-home.cjs
# 로컬 Auth/Firestore/Storage 에뮬레이터 실행 후:
node scripts/test-lesson-logs-integration.cjs --isolated-notion-test-approved
```

## 유지한 제한

- 기본 Fillout 경로 유지, 일반 수업일지 기능은 비활성.
- 안준성 계정 제한 파일럿은 2026-09-28 22:59 KST까지. 운영 담당 학생 연결 변경 없음.
- ‘박성민 · 테스트’는 가상 선택 항목이며, 별도 Notion 테스트 DB의 가상 relation에만 연결.
- 운영 Notion relation 매핑 및 운영 DB의 Portal draft ID 속성 설정, 일반 공개 전환은 미실행. 제한 파일럿 승인을 운영 출시 승인으로 간주하지 않음.
- 2026-09-28 후속 데스크톱 브라우저 검증 시 연결된 Chrome 제어가 사용 불가. 이를 브라우저 재검증 통과로 기록하지 않음.
