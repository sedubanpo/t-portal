-- Manual movement records are confirmed stops, not automatically inferred
-- departures. Preserve their server record key and explicit stopped status.

create or replace function public.portal_get_teacher_student_flow_dashboard_v2(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_records jsonb;
begin
  v_base := public.portal_get_teacher_student_flow_dashboard(payload);
  select coalesce(jsonb_agg(
    case when manual.record_key is null then source_row.value else source_row.value || jsonb_build_object(
      'recordKey', manual.record_key,
      'source', 'manual',
      'manualStop', true,
      'status', 'stopped',
      'statusLabel', '중지생',
      'stoppedDateKey', to_char(coalesce(manual.stopped_date, manual.latest_date), 'YYYY-MM-DD'),
      'changeText', '수동 등록: ' || coalesce(nullif(btrim(manual.reason), ''), '사유 미기재'),
      'stopReason', coalesce(manual.reason, '')
    ) end order by coalesce((source_row.value ->> 'daysSince')::integer, 0) desc
  ), '[]'::jsonb) into v_records
  from jsonb_array_elements(coalesce(v_base -> 'records', '[]'::jsonb)) source_row(value)
  left join lateral (
    select r.record_key, r.stopped_date, r.latest_date, r.reason
    from public.student_stop_dashboard_records r
    where r.deleted_at is null
      and (r.source = 'manual' or r.record_key like 'manual|%')
      and public.student_stop_clean_name(r.student_name) = source_row.value ->> 'student'
      and coalesce(nullif(btrim(r.subject_group), ''), '기타') = source_row.value ->> 'latestSubject'
      and coalesce(nullif(public.student_stop_teacher_name(r.teacher_name), ''), '강사 미지정') = source_row.value ->> 'currentTeacher'
    order by r.updated_at desc nulls last
    limit 1
  ) manual on true;
  return v_base || jsonb_build_object('records', v_records, 'source', 'supabase-direct-rpc-v2');
end;
$$;

revoke all on function public.portal_get_teacher_student_flow_dashboard_v2(jsonb) from public, anon;
grant execute on function public.portal_get_teacher_student_flow_dashboard_v2(jsonb) to authenticated;
