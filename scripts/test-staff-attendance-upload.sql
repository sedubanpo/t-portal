begin;
-- Run in a transaction after applying the migration; all fixtures roll back.
insert into public.portal_identities(firebase_uid, role) values ('__staff_upload_fixture__','teacher');
set local role authenticated;
do $test$
declare
  uid text := '__staff_upload_fixture__';
  claims jsonb := jsonb_build_object('sub',uid,'iss','https://securetoken.google.com/fir-lms-prod','aud','fir-lms-prod','role','authenticated');
  key text := '__staff_upload_fixture_21991231__';
  input jsonb := jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('legacy_key',key,'class_date','2199-12-31','student_name','검증학생','teacher_name','검증강사','category','검증','hours',1)), 'sourceDates',jsonb_build_array('2199-12-31'),'sourceFormat','access-daily','hoursReviewSummary','{"teacherMismatch":0}'::jsonb,'finalLegacyKeys',jsonb_build_array(key),'fileName','fixture.tsv');
  candidate jsonb;
  result jsonb;
begin
  foreach candidate in array array[claims,claims||'{"portalStaffReadUntil":1}'::jsonb,claims||jsonb_build_object('portalStaffReadUntil',extract(epoch from now())::bigint+300,'iss','wrong')] loop
    perform set_config('request.jwt.claims',candidate::text,true);
    begin perform public.portal_apply_attendance_upload(input); raise exception 'Unauthorized upload accepted'; exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claims',(claims||jsonb_build_object('portalStaffReadUntil',extract(epoch from now())::bigint+300))::text,true);
  if private.portal_can_read_all_student_stats() then raise exception 'Unrelated admin scope granted'; end if;
  result:=public.portal_apply_attendance_upload(input);
  if result->>'success' is distinct from 'true' or result->>'importedRows' is distinct from '1' then raise exception 'Staff upload failed'; end if;
  if (public.portal_apply_attendance_upload(input)->>'idempotentReplay') is distinct from 'true' then raise exception 'Duplicate submission not detected'; end if;
end $test$;
rollback;
