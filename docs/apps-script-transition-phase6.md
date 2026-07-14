# Apps Script 전환 6단계: 직접 읽기 확대와 시수 동의 직접 저장

## 적용 범위

- 관리자 학생 통계 직접 조회를 특정 UID가 아닌 승인된 관리자 권한 전체로 확대했습니다.
- 공지, 과목 선택 정보, 마스터 동기화 상태를 Firebase JWT와 Supabase RLS로 직접 읽습니다.
- 수업일지와 시수 동의 `saveClassLogRows`를 Supabase 제한 RPC로 직접 저장합니다.
- 시수 동의 화면은 더 이상 `google.script.run` 호환 브리지를 호출하지 않습니다.

## 직접 저장 안전장치

- Firebase issuer, audience, authenticated claim과 활성 `portal_identities`를 서버에서 재검증합니다.
- 일반 강사는 본인 강사명 행만 저장할 수 있고 관리자는 승인 범위에서 저장할 수 있습니다.
- 동일 UID와 동일 payload는 SHA-256 요청 키와 advisory lock으로 한 번만 처리합니다.
- 수업일지 행, 날짜별 서명, 감사 로그를 하나의 트랜잭션으로 처리합니다.
- 저장 직후 영향 월의 강사 시수 요약과 학생 통계 스냅샷을 삭제해 오래된 직접 조회 결과가 재사용되지 않게 합니다.
- Supabase 저장 실패 시 Apps Script로 이중 저장하거나 자동 우회하지 않습니다. 사용자는 같은 payload를 안전하게 재시도할 수 있습니다.

## 검증

- 관리자 저장 성공
- 일반 강사 본인 저장 성공
- 일반 강사 타 강사 저장 거부
- 동일 payload 중복 제출 idempotent replay
- 익명 RPC 401 거부
- 테스트 트랜잭션 전체 롤백 및 잔여 행 0건
- 공지·과목 선택·마스터 상태의 GAS/Supabase 결과 동등성

```bash
node scripts/test-class-log-rpc.mjs
node scripts/test-simple-reads-direct.mjs
node scripts/audit-apps-script-dependency.mjs --check
```

## 아직 유지하는 Apps Script 범위

Access CSV 분석·업로드, Google Sheets 원본 마스터 동기화, Notion 동기화와 기존 복합 관리자 조회는 아직 Apps Script를 사용합니다. 이 경로는 Google/Notion 서버 자격 증명과 복합 업로드 로직을 Supabase 서버 환경으로 옮긴 뒤 제거해야 합니다.
