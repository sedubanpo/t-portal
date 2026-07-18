-- Keep intentionally preserved rows visible after a direct Access upload.
-- Direct uploads atomically verify finalLegacyKeys, so a batch with preserved
-- rows represents a complete canonical date even though not every final row
-- receives the newest import_batch_id.

create or replace function public.portal_get_teacher_hours_live(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := nullif(payload ->> 'year', '')::integer;
  v_month integer := nullif(payload ->> 'month', '')::integer;
  v_teacher text := btrim(coalesce(payload ->> 'teacherName', ''));
  v_start date;
  v_end date;
  v_result jsonb;
begin
  if coalesce(auth.jwt() ->> 'iss', '') <> 'https://securetoken.google.com/fir-lms-prod'
     or coalesce(auth.jwt() ->> 'aud', '') <> 'fir-lms-prod'
     or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Firebase authenticated portal session required';
  end if;
  if v_year is null or v_month is null or v_month < 1 or v_month > 12 or v_teacher = '' then
    raise exception 'Invalid teacher-hours scope';
  end if;
  if not private.portal_can_access_teacher(private.portal_teacher_id_by_name(v_teacher), v_teacher) then
    raise insufficient_privilege using message = 'Teacher scope denied';
  end if;

  v_start := make_date(v_year, v_month, 1);
  v_end := (v_start + interval '1 month')::date;

  with teacher_dates as (
    select distinct a.class_date
    from public.attendance_logs a
    where a.class_date >= v_start and a.class_date < v_end and a.teacher_name = v_teacher
  ), latest as (
    select d.class_date, batch.id, batch.expected_rows, batch.preserved_rows,
      coalesce((select count(*) from public.attendance_logs a where a.class_date = d.class_date and a.import_batch_id = batch.id), 0)::integer as actual_rows
    from teacher_dates d
    left join lateral (
      select b.id,
        case
          when snapshot.snapshot_rows > 0 then snapshot.snapshot_rows
          when jsonb_typeof(b.metadata -> 'sourceDates') = 'array' and jsonb_array_length(b.metadata -> 'sourceDates') = 1 then coalesce(b.row_count, 0)
          else coalesce((b.metadata -> 'uploadSummary' -> 'addedByDate' ->> d.class_date::text)::integer, 0)
             + coalesce((b.metadata -> 'uploadSummary' -> 'changedByDate' ->> d.class_date::text)::integer, 0)
        end::integer as expected_rows,
        coalesce((b.metadata -> 'uploadPlanSummary' ->> 'preserved')::integer, 0) as preserved_rows
      from public.import_batches b
      cross join lateral (
        select count(*)::integer as snapshot_rows
        from jsonb_array_elements(case when jsonb_typeof(b.metadata -> 'accessRowsSnapshot') = 'array' then b.metadata -> 'accessRowsSnapshot' else '[]'::jsonb end) row_data
        where coalesce(row_data ->> 'date', row_data ->> 'class_date', '') = d.class_date::text
      ) snapshot
      where b.source = 'access-daily' and b.status = 'completed'
        and (coalesce(b.metadata -> 'sourceDates', '[]'::jsonb) ? d.class_date::text
          or b.metadata ->> 'minDate' = d.class_date::text
          or b.metadata ->> 'maxDate' = d.class_date::text
          or snapshot.snapshot_rows > 0)
      order by b.imported_at desc limit 1
    ) batch on true
  ), batch_state as (
    select class_date, id, expected_rows, actual_rows,
      preserved_rows > 0 as preserve_mode,
      id is not null and preserved_rows = 0 and (actual_rows = 0 or (expected_rows > 0 and actual_rows < expected_rows)) as incomplete
    from latest
  ), filtered_attendance as (
    select a.*
    from public.attendance_logs a
    left join batch_state b on b.class_date = a.class_date
    where a.class_date >= v_start and a.class_date < v_end and a.teacher_name = v_teacher
      and (b.id is null or b.incomplete or b.preserve_mode or a.import_batch_id = b.id)
  )
  select jsonb_build_object(
    'success', true,
    'source', 'supabase-teacher-hours-live-rpc',
    'monthKey', to_char(v_start, 'YYYY-MM'),
    'teacherName', v_teacher,
    'fallbackRequired', coalesce((select bool_or(incomplete) from batch_state), false),
    'incompleteDates', coalesce((select jsonb_agg(class_date order by class_date) from batch_state where incomplete), '[]'::jsonb),
    'attendanceRows', coalesce((select jsonb_agg(to_jsonb(a) order by a.class_date, a.start_time_text, a.student_name) from filtered_attendance a), '[]'::jsonb),
    'classLogRows', coalesce((select jsonb_agg(to_jsonb(l) order by l.class_date, l.student_name) from public.class_log_rows l where l.class_date >= v_start and l.class_date < v_end and l.teacher_name = v_teacher), '[]'::jsonb),
    'signatureRows', coalesce((select jsonb_agg(to_jsonb(s) order by s.class_date) from public.signatures s where s.class_date >= v_start and s.class_date < v_end and s.teacher_name = v_teacher), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.portal_get_teacher_hours_live(jsonb) from public, anon;
grant execute on function public.portal_get_teacher_hours_live(jsonb) to authenticated;

comment on function public.portal_get_teacher_hours_live(jsonb) is
  'Returns canonical teacher hours, including intentionally preserved direct-upload rows, plus agreement evidence.';
