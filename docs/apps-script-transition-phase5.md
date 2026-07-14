# Apps Script 전환 5단계: 로그인 프로필 Firestore 직접 조회

## 적용 범위

- Firebase Auth 로그인 직후 `users`, `userProfiles`, `userAppAccess`에서 본인 계정·직책·프로필 이미지·업무 링크를 직접 읽습니다.
- 관리자 계정은 Firestore rules가 허용한 경우에만 활성 강사 목록을 직접 읽습니다.
- 활성 강사 canary UID 31명에 적용하며, 실제 강사 포털 접근 권한은 Firestore `apps.teacherPortal`과 관리자 role로 다시 판정합니다.
- 로그인 초기 학생·공지 데이터, 시수 조회, 모든 쓰기 action의 기존 안전장치는 유지합니다.

## 권한과 안전장치

- Firebase Auth에 성공한 사용자의 UID 문서만 읽습니다.
- 일반 강사의 다른 계정 문서와 전체 계정 목록 조회는 Firestore rules에서 403으로 차단됩니다.
- 퇴사·비활성 상태나 `teacherPortal` 권한이 없는 계정은 기존 Apps Script와 같은 오류로 거부합니다.
- 직접 읽기 실패, 규칙 오류, 문서 누락 시 기존 `loginFirebaseAuth` Apps Script 호출로 자동 복귀합니다.
- 런타임 설정의 `directFirebaseLoginProfile`을 `false`로 배포하면 즉시 전체 서버 경로로 되돌릴 수 있습니다.

## 운영 검증

- 관리자 안준성, 일반 강사 박은채·김인중의 이름, 과목, 링크, 프로필 이미지, teacherId, 관리자 여부가 Apps Script 응답과 일치했습니다.
- 관리자 강사 목록 34건도 정렬 순서와 모든 표시 필드가 일치했습니다.
- 일반 강사의 본인 문서 조회는 성공하고 타 계정·전체 목록 조회는 403으로 차단됐습니다.
- 안종성 계정은 기존 상태와 동일하게 강사 포털 접근 권한 없음으로 거부됐습니다.
- Firestore 장애를 모사했을 때 Apps Script fallback이 실행되는 것을 확인했습니다.

## 검증 명령

```bash
node scripts/test-firebase-login-profile-direct.mjs
node scripts/audit-apps-script-dependency.mjs --check
```
