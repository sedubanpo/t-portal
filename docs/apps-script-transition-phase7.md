# Apps Script 전환 7단계: Access 업로드 직접 전환과 Notion 보류

## 적용 범위

- Access 일일·월별 CSV 및 표 붙여넣기의 파싱, 기존 데이터 비교, 변경 선택 처리를 브라우저의 독립 검증 엔진으로 이전했습니다.
- 최종 반영은 Firebase JWT를 검증하는 관리자 전용 Supabase RPC `portal_apply_attendance_upload`가 담당합니다.
- 기존 Apps Script의 Access 분석·업로드 엔드포인트는 종료 응답만 반환하며 운영 데이터 쓰기를 수행하지 않습니다.
- Notion 수업일지 UI와 자동 조회를 숨기고, Apps Script Notion 동기화·조회 엔드포인트도 보류 응답으로 고정했습니다. 기존 Notion 데이터와 설정은 삭제하지 않았습니다.

## Access 업로드 안전장치

- Firebase issuer, audience, authenticated claim과 활성 관리자 identity를 서버에서 재검증합니다.
- 신규 생성, 기존 덮어쓰기, 식별정보 교체, 삭제 후보를 분리하고 사용자가 필요한 항목을 검토합니다.
- 부분 수정본으로 판단되는 날짜는 기존 행 보존을 기본 선택으로 제안합니다.
- 일일 파일은 반명 내 강사명과 입력 강사명의 불일치가 0건이어야 하며 서버에서도 다시 검사합니다.
- 월별 기존 데이터가 1,000행을 넘더라도 페이지를 이어 읽어 전체 범위를 비교합니다.
- 업로드 행 upsert, 선택 삭제, 최종 legacy key 집합 확인, 월별 시수·학생 통계 캐시 무효화, 감사 로그를 하나의 트랜잭션에서 처리합니다.
- 동일 사용자와 동일 payload는 멱등 요청 키로 중복 반영되지 않습니다.
- 최종 저장 결과가 검증 계획과 다르면 전체 트랜잭션을 취소합니다.

## 검증 결과

- 관리자 RPC 성공 및 동일 payload 재요청 멱등 replay
- 일반 강사 RPC 거부, 익명 조회 401 거부
- 반명·강사명 불일치 서버 거부
- 테스트 트랜잭션 rollback 후 잔여 행 0건
- 2026년 6월 운영 범위 1,774행을 1,000행 단위로 연속 조회
- 월별 파일에서 사라진 날짜의 기존 행을 삭제 후보로 검출
- 부분 일일 파일의 누락 행은 보존을 기본 제안
- 브라우저 제출 함수와 호환 브리지에 Apps Script Access 호출이 남지 않았음을 정적 감사

```bash
node scripts/test-access-upload-direct.mjs
node scripts/test-attendance-upload-rpc.mjs
node scripts/test-attendance-upload-auth.mjs
node scripts/audit-apps-script-dependency.mjs --check
```

## 남아 있는 범위

이번 단계는 Access 분석·업로드 경로의 Apps Script를 완전히 제거한 것입니다. 강사 포털 전체에서는 마스터 동기화, 일반 출결 입력, 일부 복합 관리자 조회와 호환 fallback 등 32개 Apps Script 브리지 action이 남아 있습니다. Notion은 이전 대상이 아니라 보류 대상입니다.
