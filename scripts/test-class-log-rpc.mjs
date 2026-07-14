#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const SUPABASE_URL = 'https://wfgtqajdkwzuqkwygcft.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8';
const ADMIN_UID = 'teacher_01089945993';
const TEACHER_UID = 'teacher_01020837308';

function claims(uid) {
  return JSON.stringify({
    sub: uid,
    iss: 'https://securetoken.google.com/fir-lms-prod',
    aud: 'fir-lms-prod',
    role: 'authenticated'
  }).replaceAll("'", "''");
}

function row(teacher, student) {
  return JSON.stringify({ rows: [{
    teacher,
    student,
    date: '2026-07-14',
    logStatus: '제출',
    start: '10:00',
    end: '11:00',
    className: 'RPC 롤백 검증'
  }] }).replaceAll("'", "''");
}

const sql = `
begin;
do $test$
declare
  first_result jsonb;
  replay_result jsonb;
  teacher_result jsonb;
  cross_scope_rejected boolean := false;
begin
  perform set_config('request.jwt.claims', '${claims(ADMIN_UID)}', true);
  first_result := public.portal_save_class_log_rows('${row('RPC검증강사', '__CODEX_RPC_ADMIN__')}'::jsonb);
  replay_result := public.portal_save_class_log_rows('${row('RPC검증강사', '__CODEX_RPC_ADMIN__')}'::jsonb);
  if first_result ->> 'success' <> 'true' or replay_result ->> 'idempotentReplay' <> 'true' then
    raise exception '관리자 저장 또는 idempotency 검증 실패';
  end if;

  perform set_config('request.jwt.claims', '${claims(TEACHER_UID)}', true);
  teacher_result := public.portal_save_class_log_rows('${row('박은채', '__CODEX_RPC_TEACHER__')}'::jsonb);
  if teacher_result ->> 'success' <> 'true' then
    raise exception '일반 강사 본인 저장 검증 실패';
  end if;

  begin
    perform public.portal_save_class_log_rows('${row('안준성', '__CODEX_RPC_CROSS_SCOPE__')}'::jsonb);
  exception when insufficient_privilege then
    cross_scope_rejected := true;
  end;
  if not cross_scope_rejected then
    raise exception '일반 강사의 타 강사 저장이 차단되지 않음';
  end if;

  if (select count(*) from public.class_log_rows where student_name like '__CODEX_RPC_%') <> 2 then
    raise exception '트랜잭션 내 수업일지 저장 건수 불일치';
  end if;
  if exists (
    select 1 from public.class_log_rows
    where student_name like '__CODEX_RPC_%'
      and (start_time_text <> '오전 10:00' or end_time_text <> '오전 11:00')
  ) then
    raise exception '기존 Apps Script와 시간 정규화 결과 불일치';
  end if;
  if (select count(*) from public.signatures where teacher_name in ('RPC검증강사', '박은채') and class_date = date '2026-07-14') < 2 then
    raise exception '트랜잭션 내 서명 저장 건수 불일치';
  end if;
  if exists (select 1 from public.teacher_hours_monthly_summaries where month_key = '2026-07')
     or exists (select 1 from public.student_stats_monthly_snapshots where month_key = '2026-07') then
    raise exception '직접 저장 후 영향 월 요약이 무효화되지 않음';
  end if;
end
$test$;
rollback;
select count(*)::int as leftover_rows from public.class_log_rows where student_name like '__CODEX_RPC_%';
`;

const result = spawnSync('npx', ['supabase', 'db', 'query', '--linked', sql], {
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024
});
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /"leftover_rows"\s*:\s*0/, '롤백 후 검증 행이 남았습니다.');

const anonymous = await fetch(`${SUPABASE_URL}/rest/v1/rpc/portal_save_class_log_rows`, {
  method: 'POST',
  headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ payload: { rows: [] } })
});
assert.ok([401, 403].includes(anonymous.status), `익명 RPC가 ${anonymous.status}로 응답했습니다.`);

console.log(JSON.stringify({
  ok: true,
  adminWrite: true,
  idempotentReplay: true,
  teacherOwnWrite: true,
  crossTeacherWriteRejected: true,
  affectedMonthSnapshotsInvalidated: true,
  rollbackClean: true,
  anonymousStatus: anonymous.status
}, null, 2));
