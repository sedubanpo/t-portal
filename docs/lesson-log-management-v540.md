# 수업일지 관리 v540 — 2026-09-28

## UI

- 수업일지 관리로 명칭 통일. PC 목록은 가로 전체 폭과 수업일·유형·첨부 수·저장 시각·상태를 제공.
- 모바일은 세로 목록 유지. 강사/학생/학교는 포털의 S-LMS 공통 아이콘 렌더러 재사용.
- Fillout 공식 favicon 표시 (no-referrer). 기능과 대체 진입 경로 유지.
- 실제 조회 대기 동안 파란 기록 애니메이션 표시. prefers-reduced-motion 준수.
- PC 요약은 전체 DB 통계가 아닌 불러온 목록 기준임을 명시.

## 승인된 복구 가능 삭제

대상은 scripts/archive-approved-journal-tests.cjs에 명시된 안준성 테스트 4건만.
운영/테스트 Notion 페이지 3건은 휴지통 이동. 첨부 2개와 원본은 유지.
기존 Fillout, 다른 작성자의 QA 기록 및 실제 수업일지는 변경하지 않음.

- portalLessonDrafts: deletedAt 설정, archived 전환. 내용/첨부 유지.
- portalLessonDeletionBackups/{draftId}: 변경 전 문서 전체와 처리 사유 보존.
- portalLessonDeletedDrafts/{draftId}: ownerUid와 삭제 시각. 자신의 삭제 ID만 init API에 전달.
- 삭제 문서는 목록/열람/변경에서 제외. 오래된 기기 복구본의 재등장·동일 ID 재생성 차단.
- 추가 클라이언트 쓰기 권한이나 복합 인덱스는 필요하지 않음.

복구는 서버 관리자 작업: 대상 원본/Notion 페이지를 먼저 대조하고,
Notion 휴지통에서 복원한 다음 백업 original을 원래 draft 문서에 복원,
해당 tombstone을 제거한다. 제출 완료 원본을 새 제출로 재전송하지 않는다.
첨부 파일은 원래 비공개 경로 그대로 유지한다.

## 검증

- 기존 31건 + 삭제 문서 숨김/재생성 차단/원본 보존 테스트 1건 통과.
- 로컬 Chrome PC와 390px 모바일 반응형 목록 확인, 가로 넘침 없음.
- UI 정적 검사 통과.
- 실제 iPhone 재검증은 이번 작업에서 수행하지 않음.
