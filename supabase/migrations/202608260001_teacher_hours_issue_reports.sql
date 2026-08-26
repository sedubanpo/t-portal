create table if not exists public.teacher_hours_issue_reports (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  attendance_log_id uuid references public.attendance_logs(id) on delete set null,
  lesson_fingerprint text not null,
  lesson_date date not null,
  reporter_uid text not null,
  teacher_name text not null,
  student_name text not null,
  student_school text not null default '',
  student_grade text not null default '',
  subject text not null default '',
  lesson_type text not null default '',
  attendance_status text not null default '',
  start_time_text text not null default '',
  end_time_text text not null default '',
  hours numeric(6,2) not null default 0,
  issue_category text not null default 'other',
  issue_text text not null,
  workflow_status text not null default 'received',
  staff_message text not null default '',
  handled_by_uid text,
  handled_by_name text,
  handled_at timestamptz,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_hours_issue_category_check check (issue_category in ('hours_time','student_info','lesson_type','attendance','other')),
  constraint teacher_hours_issue_status_check check (workflow_status in ('received','held','applied','rejected')),
  constraint teacher_hours_issue_text_check check (length(btrim(issue_text)) between 2 and 1000)
);

create index if not exists teacher_hours_issue_reports_teacher_month_idx
  on public.teacher_hours_issue_reports (teacher_name, lesson_date desc);
create index if not exists teacher_hours_issue_reports_status_created_idx
  on public.teacher_hours_issue_reports (workflow_status, created_at desc);
create index if not exists teacher_hours_issue_reports_reporter_idx
  on public.teacher_hours_issue_reports (reporter_uid, created_at desc);
create unique index if not exists teacher_hours_issue_reports_open_lesson_idx
  on public.teacher_hours_issue_reports (reporter_uid, lesson_fingerprint)
  where workflow_status in ('received', 'held');

drop trigger if exists teacher_hours_issue_reports_touch_updated_at on public.teacher_hours_issue_reports;
create trigger teacher_hours_issue_reports_touch_updated_at
before update on public.teacher_hours_issue_reports
for each row execute function public.touch_updated_at();

alter table public.teacher_hours_issue_reports enable row level security;
revoke all on public.teacher_hours_issue_reports from anon, authenticated;

create or replace function private.portal_require_authenticated_identity()
returns public.portal_identities
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  identity_row public.portal_identities%rowtype;
begin
  if coalesce(auth.jwt() ->> 'iss', '') <> 'https://securetoken.google.com/fir-lms-prod'
     or coalesce(auth.jwt() ->> 'aud', '') <> 'fir-lms-prod'
     or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Firebase authenticated portal session required';
  end if;
  select * into identity_row
  from public.portal_identities
  where firebase_uid = nullif(auth.jwt() ->> 'sub', '') and active = true;
  if not found then
    raise insufficient_privilege using message = 'Active portal identity required';
  end if;
  return identity_row;
end;
$$;

create or replace function public.portal_submit_teacher_hours_issue(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_row public.portal_identities%rowtype := private.portal_require_authenticated_identity();
  v_client_request_id uuid := nullif(payload ->> 'clientRequestId', '')::uuid;
  v_teacher text := btrim(coalesce(payload ->> 'teacherName', ''));
  v_student text := btrim(coalesce(payload ->> 'studentName', ''));
  v_lesson_date date := nullif(payload ->> 'lessonDate', '')::date;
  v_fingerprint text := btrim(coalesce(payload ->> 'lessonFingerprint', ''));
  v_issue_category text := btrim(coalesce(payload ->> 'issueCategory', 'other'));
  v_issue_text text := btrim(coalesce(payload ->> 'issueText', ''));
  result_row public.teacher_hours_issue_reports%rowtype;
begin
  if v_client_request_id is null or v_teacher = '' or v_student = '' or v_lesson_date is null
     or v_fingerprint = '' or length(v_issue_text) < 2 then
    raise exception '오류 제보 필수값이 누락되었습니다.' using errcode = '22023';
  end if;
  if identity_row.role <> 'admin'
     and public.normalize_portal_name(identity_row.teacher_name) <> public.normalize_portal_name(v_teacher) then
    raise insufficient_privilege using message = '다른 강사의 시수 오류는 제보할 수 없습니다';
  end if;

  insert into public.teacher_hours_issue_reports (
    client_request_id, attendance_log_id, lesson_fingerprint, lesson_date,
    reporter_uid, teacher_name, student_name, student_school, student_grade,
    subject, lesson_type, attendance_status, start_time_text, end_time_text, hours,
    issue_category, issue_text, source_snapshot
  ) values (
    v_client_request_id,
    nullif(payload ->> 'attendanceLogId', '')::uuid,
    v_fingerprint, v_lesson_date, identity_row.firebase_uid, v_teacher, v_student,
    btrim(coalesce(payload ->> 'studentSchool', '')),
    btrim(coalesce(payload ->> 'studentGrade', '')),
    btrim(coalesce(payload ->> 'subject', '')),
    btrim(coalesce(payload ->> 'lessonType', '')),
    btrim(coalesce(payload ->> 'attendanceStatus', '')),
    btrim(coalesce(payload ->> 'startTime', '')),
    btrim(coalesce(payload ->> 'endTime', '')),
    coalesce(nullif(payload ->> 'hours', '')::numeric, 0),
    v_issue_category, v_issue_text, coalesce(payload -> 'sourceSnapshot', '{}'::jsonb)
  )
  on conflict (client_request_id) do update set client_request_id = excluded.client_request_id
  returning * into result_row;

  insert into public.audit_events(actor, event_type, entity_table, entity_id, after_data)
  values (identity_row.firebase_uid, 'teacher_hours_issue_submitted', 'teacher_hours_issue_reports', result_row.id,
    jsonb_build_object('teacherName', v_teacher, 'studentName', v_student, 'lessonDate', v_lesson_date, 'category', v_issue_category));

  return jsonb_build_object('success', true, 'report', to_jsonb(result_row));
exception
  when unique_violation then
    select * into result_row from public.teacher_hours_issue_reports
    where reporter_uid = identity_row.firebase_uid and lesson_fingerprint = v_fingerprint
      and workflow_status in ('received','held') order by created_at desc limit 1;
    return jsonb_build_object('success', true, 'duplicate', true, 'report', to_jsonb(result_row));
end;
$$;

create or replace function public.portal_list_teacher_hours_issues(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  identity_row public.portal_identities%rowtype := private.portal_require_authenticated_identity();
  v_year integer := nullif(payload ->> 'year', '')::integer;
  v_month integer := nullif(payload ->> 'month', '')::integer;
  v_status text := btrim(coalesce(payload ->> 'status', ''));
  v_teacher text := btrim(coalesce(payload ->> 'teacherName', ''));
  v_start date;
  v_end date;
  result_rows jsonb;
begin
  if v_year is not null and v_month is not null then
    v_start := make_date(v_year, v_month, 1);
    v_end := (v_start + interval '1 month')::date;
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  into result_rows
  from public.teacher_hours_issue_reports r
  where (identity_row.role = 'admin' or r.reporter_uid = identity_row.firebase_uid)
    and (v_start is null or (r.lesson_date >= v_start and r.lesson_date < v_end))
    and (v_status = '' or r.workflow_status = v_status)
    and (v_teacher = '' or public.normalize_portal_name(r.teacher_name) = public.normalize_portal_name(v_teacher));
  return jsonb_build_object('success', true, 'isAdmin', identity_row.role = 'admin', 'rows', result_rows);
end;
$$;

create or replace function public.portal_review_teacher_hours_issue(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_row public.portal_identities%rowtype := private.portal_require_authenticated_identity();
  v_id uuid := nullif(payload ->> 'id', '')::uuid;
  v_status text := btrim(coalesce(payload ->> 'status', ''));
  v_message text := left(btrim(coalesce(payload ->> 'staffMessage', '')), 1000);
  result_row public.teacher_hours_issue_reports%rowtype;
begin
  if identity_row.role <> 'admin' then
    raise insufficient_privilege using message = '관리자만 오류 제보를 처리할 수 있습니다';
  end if;
  if v_id is null or v_status not in ('received','held','applied','rejected') then
    raise exception '처리 상태가 올바르지 않습니다.' using errcode = '22023';
  end if;
  update public.teacher_hours_issue_reports set
    workflow_status = v_status,
    staff_message = v_message,
    handled_by_uid = identity_row.firebase_uid,
    handled_by_name = identity_row.teacher_name,
    handled_at = now()
  where id = v_id
  returning * into result_row;
  if not found then raise exception '오류 제보를 찾지 못했습니다.' using errcode = 'P0002'; end if;

  insert into public.audit_events(actor, event_type, entity_table, entity_id, after_data)
  values (identity_row.firebase_uid, 'teacher_hours_issue_reviewed', 'teacher_hours_issue_reports', result_row.id,
    jsonb_build_object('status', v_status, 'staffMessage', v_message));
  return jsonb_build_object('success', true, 'report', to_jsonb(result_row));
end;
$$;

revoke all on function private.portal_require_authenticated_identity() from public, anon;
revoke all on function public.portal_submit_teacher_hours_issue(jsonb) from public, anon;
revoke all on function public.portal_list_teacher_hours_issues(jsonb) from public, anon;
revoke all on function public.portal_review_teacher_hours_issue(jsonb) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.portal_require_authenticated_identity() to authenticated;
grant execute on function public.portal_submit_teacher_hours_issue(jsonb) to authenticated;
grant execute on function public.portal_list_teacher_hours_issues(jsonb) to authenticated;
grant execute on function public.portal_review_teacher_hours_issue(jsonb) to authenticated;

comment on table public.teacher_hours_issue_reports is 'Teacher-submitted hours corrections and staff workflow responses.';
