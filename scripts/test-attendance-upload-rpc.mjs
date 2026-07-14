#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const adminClaims = JSON.stringify({sub:'teacher_01089945993',iss:'https://securetoken.google.com/fir-lms-prod',aud:'fir-lms-prod',role:'authenticated'});
const teacherClaims = JSON.stringify({sub:'teacher_01020837308',iss:'https://securetoken.google.com/fir-lms-prod',aud:'fir-lms-prod',role:'authenticated'});
const key = 'attendance|2099-12-31|rpc|rollback|10:00|11:00|검증|반포|#1';
const payload = JSON.stringify({
  rows:[{legacy_key:key,class_date:'2099-12-31',display_date:'12/31',category:'검증',subject:'기타',lesson_type:'개별',student_name:'__CODEX_ACCESS_RPC__',teacher_name:'RPC검증강사',status:'출석',campus:'반포',start_time_text:'오전 10:00',end_time_text:'오전 11:00',hours:1,note:'rollback',raw_student:'__CODEX_ACCESS_RPC__',raw_row:{source:'test'}}],
  deleteIds:[],finalLegacyKeys:[key],sourceDates:['2099-12-31'],sourceMonth:'2099-12',sourceFormat:'access-daily',fileName:'codex-rollback.tsv',importedBy:'Codex',planHash:'rollback-test',uploadPlanSummary:{created:1},hoursReviewSummary:{teacherMismatch:0}
}).replaceAll("'", "''");
const mismatchPayload = payload.replace('"category":"검증"', '"category":"영어-개별(다른강사)-1h"');
const sql = `begin;
do $test$ declare first_result jsonb; replay_result jsonb; rejected boolean:=false; mismatch_rejected boolean:=false; begin
  perform set_config('request.jwt.claims', '${adminClaims}', true);
  first_result:=public.portal_apply_attendance_upload('${payload}'::jsonb);
  replay_result:=public.portal_apply_attendance_upload('${payload}'::jsonb);
  if first_result->>'success'<>'true' or replay_result->>'idempotentReplay'<>'true' then raise exception 'admin/idempotency failed'; end if;
  if (select count(*) from public.attendance_logs where student_name='__CODEX_ACCESS_RPC__')<>1 then raise exception 'write count mismatch'; end if;
  perform set_config('request.jwt.claims', '${teacherClaims}', true);
  begin perform public.portal_apply_attendance_upload('${payload}'::jsonb); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'teacher write was not rejected'; end if;
  perform set_config('request.jwt.claims', '${adminClaims}', true);
  begin perform public.portal_apply_attendance_upload('${mismatchPayload}'::jsonb); exception when invalid_parameter_value then mismatch_rejected:=true; end;
  if not mismatch_rejected then raise exception 'category teacher mismatch was not rejected'; end if;
end $test$;
rollback;
select count(*)::int as leftover_rows from public.attendance_logs where student_name='__CODEX_ACCESS_RPC__';`;
const result=spawnSync('npx',['supabase','db','query','--linked',sql],{encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(result.status,0,[result.stderr,result.stdout].filter(Boolean).join('\n'));
assert.match(result.stdout,/"leftover_rows"\s*:\s*0/);
console.log(JSON.stringify({ok:true,adminWrite:true,idempotentReplay:true,teacherRejected:true,categoryTeacherMismatchRejected:true,rollbackClean:true},null,2));
