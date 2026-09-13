-- Explicit rollback-only integration test. Never called by the offline runner.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"teacher_01089945993","iss":"https://securetoken.google.com/fir-lms-prod","aud":"fir-lms-prod","role":"authenticated"}',true) is not null as claims_set;
do $$
declare r jsonb; blocked boolean:=false;
begin
  r:=public.portal_student_admin_write('saveStudentSubjectCatalogItem','{"subjectGroup":"기타","subjectName":"__PORTAL_ROLLBACK_TEST__"}');
  if r->>'success'<>'true' then raise exception 'catalog failed'; end if;
  r:=public.portal_student_admin_write('saveStudentSubjectChoices','{"studentName":"__PORTAL_ROLLBACK_TEST__","subjectGroup":"기타","subjects":["A","A","B"]}');
  if jsonb_array_length(r->'choices')<>2 then raise exception 'choice dedupe failed'; end if;
  r:=public.portal_student_admin_write('saveStudentSubjectChoices','{"studentName":"__PORTAL_ROLLBACK_TEST__","subjectGroup":"기타","subjects":[]}');
  if exists(select 1 from jsonb_array_elements(r->'choices') c where (c->>'active')::boolean) then raise exception 'choice history failed'; end if;
  r:=public.portal_student_admin_write('saveTeacherStudentFlowExclusion','{"recordKey":"__PORTAL_ROLLBACK_TEST__","snapshot":{"student":"__PORTAL_ROLLBACK_TEST__","latestDateKey":"2026-09-13"}}');
  if r#>>'{row,created_by}'<>'teacher_01089945993' then raise exception 'actor failed'; end if;
  r:=public.portal_student_admin_write('restoreTeacherStudentFlowExclusion','{"recordKey":"__PORTAL_ROLLBACK_TEST__"}');
  if r#>>'{row,restored_at}' is null then raise exception 'restore failed'; end if;
  r:=public.portal_student_admin_write('saveStudentStopDashboardRecord','{"recordKey":"manual|__PORTAL_ROLLBACK_TEST__","student":"__PORTAL_ROLLBACK_TEST__","school":"test","stoppedDateKey":"2026-09-13"}');
  if r#>>'{row,student_name}'<>'__PORTAL_ROLLBACK_TEST__' then raise exception 'stop failed'; end if;
  r:=public.portal_student_admin_write('deleteStudentStopDashboardRecord','{"recordKey":"manual|__PORTAL_ROLLBACK_TEST__"}');
  if r#>>'{row,deleted_at}' is null then raise exception 'soft delete failed'; end if;
  perform set_config('request.jwt.claims','{"sub":"teacher_01020837308","iss":"https://securetoken.google.com/fir-lms-prod","aud":"fir-lms-prod","role":"authenticated"}',true);
  begin
    perform public.portal_student_admin_write('saveStudentSubjectCatalogItem','{"subjectGroup":"기타","subjectName":"__PORTAL_ROLLBACK_TEST__"}');
  exception when insufficient_privilege then blocked:=true;
  end;
  if not blocked then raise exception 'teacher privilege bypass'; end if;
end $$;
rollback;
select (select count(*) from public.student_subject_catalog where subject_name='__PORTAL_ROLLBACK_TEST__')+
       (select count(*) from public.student_subject_choices where student_name='__PORTAL_ROLLBACK_TEST__')+
       (select count(*) from public.student_stop_dashboard_records where record_key='manual|__PORTAL_ROLLBACK_TEST__')+
       (select count(*) from public.teacher_student_flow_exclusions where record_key='__PORTAL_ROLLBACK_TEST__') as leftover_test_rows;
