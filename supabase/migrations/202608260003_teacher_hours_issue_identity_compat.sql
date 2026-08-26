-- Keep teacher hours issue replies visible after Firebase account/UID remapping.
--
-- The original inbox ownership check used reporter_uid only. Account-management
-- migrations can legitimately replace a Firebase UID while preserving the
-- authenticated portal identity and canonical teacher name. In that case the
-- report and the staff reply still belong to the same teacher, but disappeared
-- from the teacher-facing hours modal. Retain the exact UID check and add a
-- canonical teacher-name ownership fallback for non-admin identities.

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
  where (
      identity_row.role = 'admin'
      or r.reporter_uid = identity_row.firebase_uid
      or (
        identity_row.role in ('teacher', 'homeroom')
        and nullif(btrim(identity_row.teacher_name), '') is not null
        and public.normalize_portal_name(r.teacher_name)
          = public.normalize_portal_name(identity_row.teacher_name)
      )
    )
    and (v_start is null or (r.lesson_date >= v_start and r.lesson_date < v_end))
    and (v_status = '' or r.workflow_status = v_status)
    and (
      v_teacher = ''
      or public.normalize_portal_name(r.teacher_name) = public.normalize_portal_name(v_teacher)
    );

  return jsonb_build_object(
    'success', true,
    'isAdmin', identity_row.role = 'admin',
    'rows', result_rows
  );
end;
$$;

revoke all on function public.portal_list_teacher_hours_issues(jsonb) from public, anon;
grant execute on function public.portal_list_teacher_hours_issues(jsonb) to authenticated;

comment on function public.portal_list_teacher_hours_issues(jsonb) is
  'Lists hours issue reports for admins or the authenticated teacher, preserving ownership across Firebase UID remapping by canonical teacher name.';
