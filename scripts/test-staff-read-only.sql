-- Integration assertions; all test state is rolled back.
begin;
set local role authenticated;
do $$
declare claims jsonb; blocked boolean:=false;
begin
  claims:=jsonb_build_object('sub','teacher_01086262428','iss','https://securetoken.google.com/fir-lms-prod','aud','fir-lms-prod','role','authenticated','portalStaffReadUntil',extract(epoch from now())::bigint+600);
  perform set_config('request.jwt.claims',claims::text,true);
  if not private.portal_staff_read_access() then raise exception 'STAFF read claim rejected'; end if;
  if private.portal_can_read_all_student_stats() then raise exception 'shared write scope widened'; end if;
  if not exists(select 1 from public.student_stats_monthly_snapshots) then raise exception 'STAFF snapshots not readable'; end if;
  begin
    perform public.portal_student_admin_write('saveStudentSubjectCatalogItem','{"subjectGroup":"기타","subjectName":"__STAFF_ROLLBACK_TEST__"}');
  exception when insufficient_privilege then blocked:=true;
  end;
  if not blocked then raise exception 'STAFF write permission widened'; end if;
  perform set_config('request.jwt.claims',(claims-'portalStaffReadUntil')::text,true);
  if private.portal_staff_read_access() then raise exception 'missing claim accepted'; end if;
  if exists(select 1 from public.student_stats_monthly_snapshots) then raise exception 'unscoped snapshot leak'; end if;
  perform set_config('request.jwt.claims',(claims||'{"portalStaffReadUntil":1}')::text,true);
  if private.portal_staff_read_access() then raise exception 'expired claim accepted'; end if;
  perform set_config('request.jwt.claims',(claims||'{"iss":"untrusted"}')::text,true);
  if private.portal_staff_read_access() then raise exception 'wrong issuer accepted'; end if;
  perform set_config('request.jwt.claims',(claims||'{"sub":"nonexistent-staff"}')::text,true);
  if private.portal_staff_read_access() then raise exception 'unknown identity accepted'; end if;
end $$;
rollback;
select 'PASS: STAFF reads, writes denied, no-claim/expired/wrong-issuer/unknown denied; rolled back' as result;
