-- Admin-only Access attendance upload path. Firebase Third-Party Auth and RLS
-- replace the Apps Script proxy; the apply operation is atomic and idempotent.

revoke all on public.attendance_logs from anon, authenticated;
grant select on public.attendance_logs to authenticated;

drop policy if exists attendance_logs_firebase_admin_select on public.attendance_logs;
create policy attendance_logs_firebase_admin_select
on public.attendance_logs for select to authenticated
using (private.portal_can_read_all_student_stats());

create or replace function public.portal_apply_attendance_upload(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_uid text := nullif((select auth.jwt() ->> 'sub'), '');
  identity_row public.portal_identities%rowtype;
  rows_json jsonb := coalesce(payload -> 'rows', '[]'::jsonb);
  delete_json jsonb := coalesce(payload -> 'deleteIds', '[]'::jsonb);
  final_keys text[] := array(select jsonb_array_elements_text(coalesce(payload -> 'finalLegacyKeys', '[]'::jsonb)) order by 1);
  source_dates date[] := array(select value::date from jsonb_array_elements_text(coalesce(payload -> 'sourceDates', '[]'::jsonb)) value);
  source_month text := trim(coalesce(payload ->> 'sourceMonth', ''));
  monthly boolean := coalesce(payload ->> 'sourceFormat', '') = 'access-monthly-hours';
  month_start date;
  month_end date;
  v_request_key text;
  previous_response jsonb;
  batch_id uuid := gen_random_uuid();
  item jsonb;
  category_teacher text;
  delete_ids uuid[] := array(select value::uuid from jsonb_array_elements_text(delete_json) value);
  actual_keys text[];
  affected_months text[];
  response_value jsonb;
begin
  if v_actor_uid is null
     or (select auth.jwt() ->> 'iss') <> 'https://securetoken.google.com/fir-lms-prod'
     or (select auth.jwt() ->> 'aud') <> 'fir-lms-prod'
     or (select auth.jwt() ->> 'role') <> 'authenticated' then
    raise exception 'Firebase 로그인 권한을 확인할 수 없습니다.' using errcode = '42501';
  end if;
  select * into identity_row from public.portal_identities where firebase_uid = v_actor_uid and active = true;
  if not found or (identity_row.role <> 'admin' and identity_row.all_student_access is not true) then
    raise exception 'Access 업로드 관리자 권한이 없습니다.' using errcode = '42501';
  end if;
  if jsonb_typeof(rows_json) <> 'array' or jsonb_array_length(rows_json) > 5000
     or jsonb_typeof(delete_json) <> 'array' or jsonb_array_length(delete_json) > 5000 then
    raise exception '업로드 작업은 행·삭제 각각 5000건 이하여야 합니다.' using errcode = '22023';
  end if;
  if monthly then
    if source_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception '업로드 월이 올바르지 않습니다.' using errcode = '22023'; end if;
    month_start := (source_month || '-01')::date;
    month_end := (month_start + interval '1 month')::date;
  elsif coalesce(array_length(source_dates, 1), 0) < 1 or array_length(source_dates, 1) > 31 then
    raise exception '일일 업로드 날짜 범위가 올바르지 않습니다.' using errcode = '22023';
  end if;
  if coalesce(payload ->> 'sourceFormat', '') = 'access-daily'
     and (jsonb_typeof(payload -> 'hoursReviewSummary') <> 'object'
       or coalesce((payload -> 'hoursReviewSummary' ->> 'teacherMismatch')::integer, -1) <> 0) then
    raise exception '일일 Access 업로드는 반명·강사명 시수표 검토를 통과해야 합니다.' using errcode = '22023';
  end if;

  v_request_key := encode(extensions.digest(convert_to(v_actor_uid || '|' || payload::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext('attendance-upload|' || coalesce(source_month, '') || '|' || array_to_string(source_dates, ',')));
  select response_json into previous_response from public.portal_write_requests
  where portal_write_requests.actor_uid = v_actor_uid and action = 'uploadSupabaseAttendanceCsv'
    and portal_write_requests.request_key = v_request_key and status = 'completed';
  if previous_response is not null then return previous_response || jsonb_build_object('idempotentReplay', true); end if;

  insert into public.portal_write_requests(actor_uid, action, request_key, status)
  values(v_actor_uid, 'uploadSupabaseAttendanceCsv', v_request_key, 'pending')
  on conflict(actor_uid, action, request_key) do update set status='pending', response_json=null, completed_at=null;

  if coalesce(array_length(delete_ids, 1), 0) > 0 and (
    select count(*) from public.attendance_logs
    where id = any(delete_ids)
      and (case when monthly then class_date >= month_start and class_date < month_end else class_date = any(source_dates) end)
  ) <> array_length(delete_ids, 1) then
    raise exception '삭제 대상이 변경됐거나 업로드 범위를 벗어났습니다. 다시 검증해 주세요.' using errcode = '40001';
  end if;

  insert into public.import_batches(id, source, source_file, source_hash, imported_by, row_count, status, metadata)
  values(batch_id, coalesce(payload ->> 'sourceFormat', 'access-export'), left(coalesce(payload ->> 'fileName', ''), 300),
    v_actor_uid || ':' || v_request_key, left(coalesce(payload ->> 'importedBy', 'admin'), 120), jsonb_array_length(rows_json), 'pending',
    jsonb_build_object('planHash', payload ->> 'planHash', 'sourceDates', payload -> 'sourceDates', 'sourceMonth', source_month,
      'hoursReview', payload -> 'hoursReviewSummary', 'uploadPlanSummary', payload -> 'uploadPlanSummary'));

  for item in select value from jsonb_array_elements(rows_json) loop
    if coalesce(item ->> 'legacy_key', '') = '' or coalesce(item ->> 'teacher_name', '') = '' or coalesce(item ->> 'student_name', '') = ''
       or coalesce(item ->> 'class_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception '업로드 행의 필수값이 누락되었습니다.' using errcode = '22023';
    end if;
    if not (case when monthly then (item ->> 'class_date')::date >= month_start and (item ->> 'class_date')::date < month_end
                 else (item ->> 'class_date')::date = any(source_dates) end) then
      raise exception '업로드 행이 검증 날짜 범위를 벗어났습니다.' using errcode = '22023';
    end if;
    category_teacher := substring(coalesce(item ->> 'category', '') from '[（(][[:space:]]*([^()（）]+?)[[:space:]]*[）)]');
    if category_teacher ~ '^[가-힣]{2,5}$'
       and private.portal_normalize_teacher_name(category_teacher) <> private.portal_normalize_teacher_name(item ->> 'teacher_name') then
      raise exception '반명 내 강사명(%)과 입력 강사명(%)이 일치하지 않습니다.', category_teacher, item ->> 'teacher_name' using errcode = '22023';
    end if;
    insert into public.attendance_logs(legacy_key,class_date,display_date,category,subject,lesson_type,student_name,student_school,student_grade,
      teacher_name,status,campus,start_time_text,end_time_text,hours,note,raw_student,raw_row,import_batch_id)
    values(item->>'legacy_key',(item->>'class_date')::date,item->>'display_date',item->>'category',item->>'subject',item->>'lesson_type',
      item->>'student_name',item->>'student_school',item->>'student_grade',item->>'teacher_name',item->>'status',item->>'campus',
      item->>'start_time_text',item->>'end_time_text',coalesce((item->>'hours')::numeric,0),item->>'note',item->>'raw_student',
      coalesce(item->'raw_row','{}'::jsonb),batch_id)
    on conflict(legacy_key) do update set class_date=excluded.class_date,display_date=excluded.display_date,category=excluded.category,
      subject=excluded.subject,lesson_type=excluded.lesson_type,student_name=excluded.student_name,student_school=excluded.student_school,
      student_grade=excluded.student_grade,teacher_name=excluded.teacher_name,status=excluded.status,campus=excluded.campus,
      start_time_text=excluded.start_time_text,end_time_text=excluded.end_time_text,hours=excluded.hours,note=excluded.note,
      raw_student=excluded.raw_student,raw_row=excluded.raw_row,import_batch_id=excluded.import_batch_id;
  end loop;
  if coalesce(array_length(delete_ids,1),0)>0 then delete from public.attendance_logs where id=any(delete_ids); end if;

  select coalesce(array_agg(legacy_key order by legacy_key), array[]::text[]) into actual_keys
  from public.attendance_logs where case when monthly then class_date>=month_start and class_date<month_end else class_date=any(source_dates) end;
  if actual_keys is distinct from final_keys then
    raise exception '최종 저장 결과가 검증 계획과 일치하지 않습니다. 전체 작업을 취소했습니다.' using errcode = '40001';
  end if;
  affected_months := array(select distinct to_char(value,'YYYY-MM') from unnest(case when monthly then array[month_start] else source_dates end) value);
  delete from public.teacher_hours_monthly_summaries where month_key=any(affected_months);
  delete from public.student_stats_monthly_snapshots where month_key=any(affected_months);
  update public.import_batches set status='completed', row_count=jsonb_array_length(rows_json) where id=batch_id;
  insert into public.audit_events(actor,event_type,entity_table,entity_id,after_data)
  values(v_actor_uid,'attendance_upload_apply','import_batches',batch_id,jsonb_build_object('requestKey',v_request_key,'months',affected_months,
    'upserted',jsonb_array_length(rows_json),'deleted',coalesce(array_length(delete_ids,1),0)));
  response_value := jsonb_build_object('success',true,'batchId',batch_id,'importedRows',jsonb_array_length(rows_json),
    'uploadPlanSummary',coalesce(payload->'uploadPlanSummary','{}'::jsonb),'supabaseSynced',true);
  update public.portal_write_requests set status='completed',response_json=response_value,completed_at=now()
  where portal_write_requests.actor_uid=v_actor_uid and action='uploadSupabaseAttendanceCsv' and portal_write_requests.request_key=v_request_key;
  return response_value;
end;
$$;

revoke all on function public.portal_apply_attendance_upload(jsonb) from public, anon;
grant execute on function public.portal_apply_attendance_upload(jsonb) to authenticated;
