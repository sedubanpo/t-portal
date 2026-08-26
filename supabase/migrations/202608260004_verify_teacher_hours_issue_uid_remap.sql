-- Production-safe verification for the UID-remap compatibility path.
-- The report is written by an admin on behalf of a teacher, so reporter_uid is
-- intentionally different. The teacher must still receive the report by the
-- canonical teacher identity. All QA rows are removed in the same transaction.

do $$
declare
  teacher_identity public.portal_identities%rowtype;
  admin_identity public.portal_identities%rowtype;
  submitted jsonb;
  listed jsonb;
  report_id uuid;
  request_id uuid := gen_random_uuid();
  fingerprint text := 'qa-hours-issue-uid-remap-' || gen_random_uuid()::text;
begin
  select * into strict teacher_identity
  from public.portal_identities
  where firebase_uid = 'teacher_01020837308' and active = true;

  select * into strict admin_identity
  from public.portal_identities
  where firebase_uid = 'teacher_01089945993' and active = true and role = 'admin';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', admin_identity.firebase_uid,
    'iss', 'https://securetoken.google.com/fir-lms-prod',
    'aud', 'fir-lms-prod',
    'role', 'authenticated'
  )::text, true);

  submitted := public.portal_submit_teacher_hours_issue(jsonb_build_object(
    'clientRequestId', request_id,
    'lessonFingerprint', fingerprint,
    'lessonDate', '2026-08-01',
    'teacherName', teacher_identity.teacher_name,
    'studentName', 'QA UID 변경 검증 학생',
    'hours', 2,
    'issueCategory', 'hours_time',
    'issueText', 'UID 변경 호환 조회 검증 후 즉시 삭제됩니다.',
    'sourceSnapshot', jsonb_build_object('qa', true, 'uidRemap', true)
  ));
  report_id := (submitted #>> '{report,id}')::uuid;
  if report_id is null then
    raise exception 'UID-remap report setup failed';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', teacher_identity.firebase_uid,
    'iss', 'https://securetoken.google.com/fir-lms-prod',
    'aud', 'fir-lms-prod',
    'role', 'authenticated'
  )::text, true);

  listed := public.portal_list_teacher_hours_issues(jsonb_build_object(
    'year', 2026,
    'month', 8,
    'teacherName', teacher_identity.teacher_name
  ));
  if not exists (
    select 1
    from jsonb_array_elements(listed -> 'rows') row_value
    where row_value ->> 'id' = report_id::text
  ) then
    raise exception 'UID-remap teacher issue list verification failed';
  end if;

  delete from public.audit_events
  where entity_table = 'teacher_hours_issue_reports' and entity_id = report_id;
  delete from public.teacher_hours_issue_reports where id = report_id;
end;
$$;
