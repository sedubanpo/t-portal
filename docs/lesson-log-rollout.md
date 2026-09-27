# 강사 포털 수업일지 — 구현·검증·배포 메모

2026-09-27. **코드 구현 및 로컬 검증 완료, 운영 전환 전 검증 미완료. 배포하지 않음.**

## 현재 차단 사항

- 사용자가 별도 Notion 테스트 DB 생성을 승인했다. 기존 `S_LMS_NOTION_TOKEN`으로 상위 페이지 아래 테스트 공간을 생성하려 했으나 `403 Insufficient permissions for this endpoint`로 거절됐다. 테스트 공간/DB/페이지는 생성되지 않았다. 운영 DB와 기존 일지에도 쓰기를 수행하지 않았다.
- 읽기 전용 S-LMS 연결의 권한을 임의로 확대하지 않는다. 별도 Notion 연결에 **콘텐츠 읽기·생성 및 파일 업로드에 필요한 권한**, 승인된 테스트 상위 페이지 접근을 부여하고 서버 Secret Manager의 `TEACHER_PORTAL_NOTION_TOKEN`으로 등록해야 한다. 비밀키는 채팅·브라우저 코드·Git에 넣지 않는다.
- 실제 Firebase/Firestore/Storage 배포 및 에뮬레이터 통합 검증은 아직 하지 않았다. 에뮬레이터 JAR는 있으나 `java -version`에서 Java Runtime을 찾지 못했다.
- 브라우저 PDF 업로드 자동 검증은 Chrome 확장의 로컬 파일 접근 권한 부족으로 중단됐다. 확장 권한은 변경하지 않았다. 업로드 서비스의 형식/크기/소유자/불변 파일 검증은 단위 테스트로 확인했다.
- 따라서 필수 시나리오 전체가 운영 수준에서 검증됐다고 보고하지 않는다. `lesson-logs-config.js`의 기능 플래그는 `false`다.

## 구현 흐름

1. 새 수업일지를 열면 브라우저 UUID로 초안을 만들고 서버 생성 요청을 보낸다. 오프라인이면 기기 초안을 먼저 보관한다.
2. 입력마다 IndexedDB 복구본을 기록하고 약 1.3초 후 서버 저장한다. blur/visibilitychange도 저장을 시도한다. pagehide는 네트워크 성공을 가정하지 않고 로컬 보관을 시도한다.
3. 저장 중 / 저장됨 / 오프라인 임시 저장 / 저장 실패를 표시한다. IDB 실패 시 창을 닫지 말라는 경고를 표시한다.
4. 같은 계정의 초안을 이어서 작성한다. 다중 탭의 수정은 revision 충돌로 검출한다. 서로 다른 내용은 자동 덮어쓰지 않고 기기 복구본을 새 초안으로 복제하거나 서버 버전을 선택한다.
5. JPG/PNG/PDF, 파일당 10MiB, 최대 10개. 로컬 Blob을 보관하고 초안 저장 후 비공개 Storage로 업로드한다. 업로드가 끝나지 않으면 제출하지 못한다.
6. 제출 전 명시적으로 확인한다. 서버 트랜잭션이 불변 snapshot을 만든 뒤 Notion 전송 작업으로 넘긴다. 제출은 시수 동의를 변경하지 않는다.
7. Firestore 변경 트리거가 Notion 작업을 처리한다. 1분 스케줄 작업은 중단된 작업을 복구한다. 파일 업로드는 체크포인트를 남겨 하나씩 처리한다.
8. 관리자 화면은 강사/상태 필터, 오래된 초안 표시, 본문·첨부 확인, 최종 제출본 재전송을 제공한다. 관리자는 본인 소유 일지를 작성·제출·보관할 수 있으나 다른 강사의 일지 대리 작성/수정/제출/보관은 금지한다. 작성 학생 목록은 관리자 전체 조회가 아닌 본인의 기존 담당 연결로 제한한다. 실무자 운영 조회 권한은 초안 접근 권한으로 사용하지 않는다.
9. 초안 보관은 `archived` 상태로 남긴다. 영구 삭제·TTL·운영 데이터 청소는 구현하지 않았다.

## 입력 필드와 기존 양식 대응

Fillout 공개 양식을 기준으로 강사·학생·날짜·수업유형·제목·본문·수업자료·숙제·지난 숙제 피드백·테스트/평가를 제공한다. 강사는 로그인 계정, 학생 선택지는 기존 서버 범위 계산을 사용한다. 학생/수업일을 시간표에서 자동 선택하는 연결은 아직 추가하지 않았다.

Notion 2025-09-03 API로 읽기 확인한 운영 스키마:

- `수업 제목(클릭)` title, `날짜` date, `강사명`/`학생명` relation, `수업유형` select
- ` 숙제` — 실제 속성명 앞 공백을 보존한다.
- `지난 숙제 피드백`, `수업내용`, `학생명(검색용)` rich_text
- `수업자료` multi_select: 입력 줄이 기존 옵션명과 정확히 일치하는 경우에만 기존 옵션을 연결한다. 자료 링크와 나머지 텍스트도 본문에 보존한다. 임의의 운영 옵션은 만들지 않는다.
- 테스트/평가 전용 속성이 없어 페이지 본문의 별도 절에 보관한다.
- 새 연동에는 `Portal draft ID` rich_text 속성이 필요하다. 운영 DB에는 아직 추가하지 않았다.

## 저장 구조

`portalLessonDrafts/{draftId}`

- `ownerUid`, `teacherName`, `studentName`
- `content`: studentId, lessonDate, lessonType, title, content, materials, homework, feedback, assessment, attachmentIds
- `revision`, `status`, 서버 `createdAt`, `updatedAt`, `submittedAt`, `syncedAt`, `archivedAt`
- `snapshot`: 최종 content/revision, 검증된 학생·강사 Notion relation ID, 불변 첨부 목록
- `notionPageId`, `lastError` (안전한 코드만), `sync` (phase, fencing token, leaseUntil, attempts, upload checkpoints)
- 하위 `mutations/{mutationId}`: content hash, 처리 revision, 서버 생성 시각. 응답이 유실된 동일 저장 요청은 같은 결과를 돌려준다.
- 하위 `files/{fileId}`: name, MIME, size, sha256, private path, 서버 업로드 시각

`portalLessonNotionMappings/teacher:{firebaseUid}` 및 `student:{canonicalStudentId}`

```json
{"pageId":"검증된 Notion UUID", "verified":true}
```

관계는 이름을 유추해 연결하지 않는다. 기존 Firestore 샘플 필드와 canonical scope를 읽기 확인했지만 보장된 직접 Notion ID가 없어 별도 검증 매핑을 사용한다. 실제 계정/학생 매핑 등록은 배포 전 남은 작업이다.

`portalLessonLogConfig/runtime` 예시:

```json
{
  "enabled": false,
  "pilotUids": ["승인된 테스트 강사 UID"],
  "bucket": "검증된 비공개 Storage bucket",
  "notionDataSourceId": "별도 테스트 data source UUID"
}
```

Storage: `lesson-log-files/{ownerUid}/{draftId}/{fileId}`. 공개 URL을 발급하지 않고 인증된 API로만 내려받는다. 동일 파일 ID는 다른 bytes로 덮어쓸 수 없다.

## 권한과 인덱스

- 모든 API 요청에서 Firebase ID token을 검증하고 users/userProfiles/userAppAccess를 재조회한다. 비활성 계정과 STAFF는 거절한다.
- INSTRUCTOR는 자신의 초안만 읽고 쓰며, 학생 변경과 제출 시 기존 학생 권한 범위를 검증한다.
- ADMIN/SUPER_ADMIN은 전체 열람 및 최종 snapshot 재전송만 가능하다.
- 브라우저 Firestore/Storage 직접 접근은 모두 deny. API의 Admin SDK만 저장한다. `private-rules.fragment.txt`는 기존 공유 규칙에 병합할 참고 조각이며 **독립 배포 금지**다. 현재 읽기 확인한 공유 규칙의 default-deny로 새 경로는 이미 차단되지만 실제 배포된 규칙과 동일한지는 추가 검증해야 한다.
- `firestore.indexes.json`: ownerUid + updatedAt desc + name desc, status + updatedAt desc + name desc, ownerUid + status + updatedAt desc + name desc. 기존 공유 인덱스를 보존해 병합한다.
- 본문·토큰·외부 오류 본문을 콘솔이나 오류 응답에 출력하지 않는다. 관리자 열람 본문은 새 로컬 캐시에 저장하지 않는다.

## Notion 중복 방지

- 최종 제출은 draftId 한 문서의 트랜잭션 상태 전이로 고정한다. 같은 제출을 반복해도 snapshot을 재생성하지 않는다.
- worker는 임대와 fencing token으로 경쟁을 차단한다.
- `Portal draft ID`로 기존 페이지를 먼저 조회한다. 페이지 ID를 알면 재생성하지 않는다.
- 외부 POST 전에 `creating` 의도를 저장한다. 응답 유실 후 페이지가 조회되면 연결을 복구한다.
- 응답이 불확실하고 페이지도 조회되지 않으면 **새 페이지를 또 만들지 않고** `NOTION_RESULT_UNCERTAIN`으로 격리한다. Notion API에는 완전한 트랜잭션/idempotency 보장이 없으므로, 이 경우 관리자 확인이 필요하다. 무조건적인 자동 재전송 성공을 약속하지 않는다.
- 새 페이지를 만들 때 본문과 첨부를 함께 전송한다. 기존 Fillout 페이지에 PATCH/DELETE/본문 추가를 수행하는 코드가 없다.

## 검증 결과

명령:

```sh
node --test scripts/test-lesson-logs.cjs scripts/test-identity-repair.cjs scripts/test-portal-home.cjs
node --check lesson-log-editor.js
node --check portal-functions/index.js
git diff --check
```

23개 통과. 새 일지 테스트 16개 + 기존 계정 연결 6개 + 홈 회귀 테스트 파일 1개. 기존 홈 테스트의 하드코딩된 v537 기대값은 실제 APP_VERSION과 비교하도록 수정했다. 디자인 기계 검사 1회, 결과 `[]`.

필수 시나리오별 근거/잔여 검증:

| 시나리오 | 현재 근거 | 남은 확인 |
|---|---|---|
| 탭 종료 복원 | 실제 Chrome + 가상 adapter + IndexedDB, 닫고 재접속하여 본문 복원 | 운영 인증 재로그인 |
| 새로고침 복원 | 제목·날짜·학생·본문·숙제 복원 확인 | 실제 Firestore |
| 오프라인 동기화 | adapter 오프라인 입력→새로고침→연결 복구 확인 | OS 네트워크 차단, iOS Safari |
| 중복 제출 | 경쟁 제출 단위 테스트 | 실제 Firestore 트랜잭션 |
| Notion 실패 원본 보존 | worker 단위 테스트 및 모바일 실패 상태 확인 | 실제 Notion 장애 주입 |
| Notion 재시도 중복 방지 | 응답 유실/조회 지연/동시 실행 단위 테스트 | 별도 Notion DB 실전송 |
| 다른 강사 초안 차단 | 서버 load/list 및 HTTP 역할/비활성/미인증 테스트 | 규칙 에뮬레이터와 실제 계정 |
| 관리자 복구 | 읽기 전용 화면·재전송으로 제출 완료 확인 | 실제 관리자 계정 |
| 기존 자료 무변경 | legacy 보존 테스트, 운영 쓰기 없음 | 배포 후 canary |
| 모바일 | 390×844 Chrome viewport 입력/저장/복구/제출 확인 | iOS Safari, 파일 선택 UI |

화면 검증은 `tests/lesson-log-preview.html`의 명시적 가상 데이터 adapter다. 운영 연결 검증으로 혼동하지 않는다. PDF UI 자동 업로드는 확장 권한으로 막혀 미완료다.

### 2026-09-27 Notion 연결 검증

- 사용자 승인으로 기존 `S-EDU Class Log Sync` 키를 `fir-lms-prod`의 `TEACHER_PORTAL_NOTION_TOKEN` 버전 1에 등록했다. 기존 키 재발급, 연결 권한 확대, S-LMS 읽기 전용 키 변경은 하지 않았다. 임시 키 파일과 클립보드의 키는 제거했다.
- 승인된 부모 아래 분리 테스트 공간과 가상 강사·학생·수업일지 DB를 생성했다. 운영 수업일지/Fillout 자료에는 쓰기를 수행하지 않았다.
- 실제 `createNotion` adapter로 스키마 확인, 본문 5개 섹션 생성, 합성 PDF 및 PNG 업로드·페이지 첨부를 검증했다.
- `qa-portal-notion-20260927-v1` marker 재조회가 생성한 단일 페이지를 반환함을 확인했다. 이는 실제 Notion 연결 검증이며, 실제 Firestore 동시 제출/장애 복구 종단 검증을 대체하지 않는다.
- 테스트 공간: https://app.notion.com/p/3e8d8b6280e781aab69be82e346cc19b
- 검증 일지: https://app.notion.com/p/3e8d8b6280e78158bbb9d5e298d1d4b6
- 기능 플래그는 계속 비활성 상태다. 함수 배포·런타임 서비스 계정의 secret 접근·실제 인증/Firestore/Storage 검증은 남아 있다.

## 배포 전 순서

### 2026-09-27 격리 통합 검증 추가 결과

`scripts/test-lesson-logs-integration.cjs --isolated-notion-test-approved`로 Auth/Firestore/Storage 에뮬레이터(`demo-portal-journals`)와 실제 분리 Notion 테스트 DB를 연결해 11개 통합 항목을 통과했다. 운영 Firebase 계정/데이터나 운영 Notion 수업일지에는 쓰지 않았다.

- 가상 Auth 가입·재로그인 토큰 검증, 비활성/STAFF/미인증 차단, 배정 학생 제한.
- 실제 Firestore SDK 트랜잭션 경쟁 저장에서 1건 성공/1건 충돌, 서버 timestamp, 이중 제출 원본 단일 고정.
- 다른 강사의 조회·수정·첨부 다운로드 차단, 관리자 열람/재전송 허용 및 대리 제출 차단.
- Storage 업로드/다운로드·같은 파일 재전송, 다른 내용으로 동일 ID 재사용 차단.
- 테스트 전용 default-deny 규칙에서 미인증·강사·관리자의 Firestore/Storage 직접 읽기 차단. **운영에 배포된 공유 규칙의 검증은 아니다.**
- Notion 전송 실패를 주입한 뒤 `sync_failed`와 원본 보존, 관리자 재시도, 실제 이미지 첨부·페이지 생성, 경쟁 worker/재시도 후 단일 페이지 조회 확인.
- 보관 처리 후 본문 보존 및 legacy 가상 자료 불변.

실제 Chrome 화면을 같은 로컬 API에 연결하여 다중 필드 저장→새로고침 복원, 통신 실패 모의→입력→탭 종료→재접속→IndexedDB 복원→연결 복구→Firestore 저장을 확인했다. 이어 390×844 모바일 폭에서 제출하여 Notion 본문에 복구 문장이 들어간 것을 브라우저로 확인했다.

브라우저 전송 결과: https://app.notion.com/p/3e8d8b6280e781edbf40d067ba90fc44

검증 중 보완:

1. 저장소 precondition에만 의존하지 않고 Firestore에 첨부 ID/해시를 먼저 예약한다. 업로드 미완료 manifest는 제출/다운로드에서 제외한다. 저장 실패 후 동일 파일 복구 회귀 테스트를 추가했다.
2. 제출한 서버 원본과 내용이 같은 기기 복구본을 충돌로 오인하지 않도록 했다. 제출 상태에는 편집용 충돌 안내를 표시하지 않는다.

회귀 테스트는 총 24개 통과. 통합 테스트 서버는 `--serve` 옵션으로 브라우저 검증용 loopback HTTP를 제공하며, 운영 배포 대상이 아니다. Notion 테스트 DB에만 새 검증 페이지를 만든다.

재현: Java 21+와 Firebase CLI로 `firebase emulators:start --project demo-portal-journals --config tests/lesson-log-emulators/firebase.json --only auth,firestore,storage` 실행 후 위 통합 스크립트를 실행한다. 서버 비밀 항목 읽기 권한과 분리 테스트 DB가 필요하다.

남은 출시 검증: 배포 환경의 IAM/공유 보안 규칙/복합 인덱스/CORS/Eventarc·scheduler, 운영 인증의 제한된 파일럿, 실제 iOS Safari와 OS 네트워크 차단·파일 선택. 이 결과만으로 프로덕션 전체 검증 완료를 선언하지 않는다. 기능 플래그는 꺼져 있다.

1. 쓰기 권한이 있는 전용 Notion 연결과 서버 비밀키 준비. 기존 읽기 전용 토큰 권한을 자동 변경하지 않는다.
2. 승인된 테스트 공간 생성 스크립트 실행: `node scripts/setup-lesson-log-notion-test.cjs --create-approved-test-space`. 리소스 ID를 checkpoint 파일로 남긴다. POST 응답 유실의 `pending`은 수동 확인 없이 재실행하지 않는다.
3. 별도 테스트 Firebase 환경/가상 계정에서 위 10개 시나리오와 규칙·Storage·사진/PDF·Notion 실제 생성/재시도를 검증한다. Java 설치 또는 테스트 환경 확보 필요.
4. 공유 Firestore 인덱스/규칙을 보존해서 병합하고 전용 비밀키와 버킷 권한을 설정한다. runtime은 아직 disabled로 둔다.
5. 새 함수만 선택 배포: `teacherPortalLessonLogs`, `teacherPortalLessonLogWritten`, `teacherPortalLessonLogSync` (codebase teacher-portal, firebase.portal.json). 기존 bootstrap을 불필요하게 재배포하지 않는다.
6. 정확한 학생/강사 매핑을 등록한다. 운영 DB의 `Portal draft ID` 속성 추가는 별도 변경사항으로 승인받고 진행한다.
7. 소수 승인 계정에 서버 pilotUids + enabled, 프런트 기능 플래그를 켜서 canary. 관찰 후 확대한다. Fillout 링크는 계속 남긴다.
8. 문제 발생 시 프런트 플래그를 끄면 즉시 Fillout 경로로 돌아간다. 서버 enabled를 끄면 새 작업 처리도 중지한다. 초안/첨부/기존 일지는 삭제하지 않는다.

## 아직 추가하지 않은 기능/제약

- ‘일지 미작성’ 자동 감지는 보류. 기존 `attendance_logs` 인정 시수와 현재 일지 간 안정적인 lesson ID 매칭, 취소/재배정/보강의 기준을 확정해야 한다. 임의의 학생·날짜 이름 매칭으로 누락을 단정하지 않는다.
- 관리자가 모든 강사 초안을 보는 것은 구현했으나 대리 제출과 내용 변경은 의도적으로 금지했다.
- 사진은 JPG/PNG만 지원한다. iPhone HEIC 변환·바이러스 검사·보존기간 정책은 별도 작업이다.
- 브라우저 저장소 삭제/용량 부족/시크릿 모드 종료/OS 강제 종료 직전 아직 완료되지 않은 쓰기까지 영구 보장할 수 없다. 저장 상태 경고와 서버/기기 이중 저장으로 위험을 줄인다.
- 저장 원본은 plain text 중심이다. 기존 본문의 모든 리치텍스트 스타일 편집은 범위에 포함하지 않았다.

## 변경 파일

- index.html, portal-home.js: 기존 링크를 보존하는 기능 플래그와 동적 페이지 등록
- lesson-logs-config.js, lesson-log-editor.js, lesson-log-editor.css: 작성·복구 UI와 로컬 outbox
- portal-functions/index.js: 인증 API, Firestore trigger, 복구 scheduler
- portal-functions/lesson-logs/{model,service,notion,worker,http}.js
- portal-functions/lesson-logs/firestore.indexes.json, private-rules.fragment.txt
- scripts/test-lesson-logs.cjs, scripts/test-portal-home.cjs
- scripts/setup-lesson-log-notion-test.cjs
- tests/lesson-log-preview.html
- docs/lesson-log-notion-test-resources.json, docs/lesson-log-rollout.md

검증을 위해 `impeccable`의 기존 포털 디자인 기준을 재사용했다. 전체 브랜드/시간 카드/기존 운영 화면은 재설계하지 않았다.
