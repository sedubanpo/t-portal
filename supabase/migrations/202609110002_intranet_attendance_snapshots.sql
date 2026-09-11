-- Preserve only portal-bound fields at publication, not intranet drafts or private notes.
-- No backfill: old batches remain explicitly current-row fallback.
begin;
do $guard$ begin
 if (select md5(prosrc) from pg_proc where oid='public.intranet_apply_hours_v2(jsonb)'::regprocedure) <> 'bd9d1f1ac9c2bf12fe65ceb80f4bd485' then
  raise exception 'Intranet function changed; review before applying snapshot migration';
 end if;
end $guard$;
create or replace function public.intranet_apply_hours_v2(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 item jsonb; prior jsonb; result jsonb; request_key text:=payload->>'requestId';
 period_key_value text:=payload->>'periodKey'; revision_value integer:=(payload->>'revision')::integer;
 actor_value text:=payload->>'actorUid'; batch uuid:=gen_random_uuid(); month_values text[]; deleted_attendance_ids uuid[]; removed_makeup_links jsonb := '[]'::jsonb; deleted_rows jsonb := '[]'::jsonb;
begin
 if (select auth.role()) <> 'service_role' then raise exception 'Service authentication required' using errcode='42501'; end if;
 if request_key is null or period_key_value is null or revision_value is null or payload->'rows' is null or request_key !~ '^[a-f0-9]{64}$' or period_key_value !~ '^[a-f0-9]{64}$' or revision_value<1 or coalesce(actor_value,'')='' or jsonb_typeof(payload->'rows')<>'array' or jsonb_array_length(payload->'rows') not between 0 and 300 or jsonb_typeof(coalesce(payload->'deletes','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(payload->'deletes','[]'::jsonb))>300 or jsonb_array_length(payload->'rows')+jsonb_array_length(coalesce(payload->'deletes','[]'::jsonb))<1 then raise exception 'Invalid bridge request'; end if;
 perform pg_advisory_xact_lock(hashtext('intranet|'||period_key_value));
 select response into prior from public.intranet_hour_operations where request_id=request_key;
 if prior is not null then return prior || jsonb_build_object('replayed',true); end if;
 if exists(select 1 from public.intranet_hour_operations where period_key=period_key_value and revision>=revision_value) then raise exception 'Stale intranet revision'; end if;
 for item in select value from jsonb_array_elements(payload->'rows') loop
  if coalesce(item->>'legacy_key','') not like ('intranet|'||period_key_value||'|%') or coalesce(item->>'student_name','')='' or coalesce(item->>'teacher_name','')='' or coalesce(item->>'campus','')<>'반포' or item->>'hours' is null or (item->>'hours')::numeric<0 or (item->>'hours')::numeric>24 then raise exception 'Invalid attendance row'; end if;
  if exists(select 1 from public.attendance_logs a where a.legacy_key<>item->>'legacy_key' and a.legacy_key not like ('intranet|'||period_key_value||'|%') and a.class_date=(item->>'class_date')::date and replace(trim(both '/' from a.student_name),' ','')=replace(trim(both '/' from (item->>'student_name')),' ','') and private.portal_normalize_teacher_name(a.teacher_name)=private.portal_normalize_teacher_name(item->>'teacher_name') and ((private.portal_compact_time_label(a.start_time_text)=private.portal_compact_time_label(item->>'start_time_text') and private.portal_compact_time_label(a.end_time_text)=private.portal_compact_time_label(item->>'end_time_text')))) then raise exception '기존 강사 포털에 같은 학생·강사·시간의 수업이 있습니다. 원본 대조가 필요합니다.'; end if;
 end loop;
 -- Deletions are scoped to this exact intranet period; legacy/imported rows cannot be deleted.
 for item in select value from jsonb_array_elements(coalesce(payload->'deletes','[]'::jsonb)) loop
  if jsonb_typeof(item)<>'string' or (item#>>'{}') !~ ('^intranet\|'||period_key_value||'\|[A-Za-z0-9_-]+$') then raise exception 'Invalid intranet deletion'; end if;
 end loop;
 select array_agg(distinct to_char(class_date,'YYYY-MM')) into month_values from public.attendance_logs where legacy_key in(select value#>>'{}' from jsonb_array_elements(coalesce(payload->'deletes','[]'::jsonb)));
 -- Lock scoped attendance first so concurrent FK inserts cannot create new links during cleanup.
 select array_agg(id) into deleted_attendance_ids from (
  select id from public.attendance_logs
  where legacy_key in(select value#>>'{}' from jsonb_array_elements(coalesce(payload->'deletes','[]'::jsonb)))
   and legacy_key like ('intranet|'||period_key_value||'|%')
  for update
 ) scoped_attendance;
 select coalesce(jsonb_agg(to_jsonb(a) - 'raw_row' - 'raw_student'), '[]'::jsonb) into deleted_rows
 from public.attendance_logs a where a.id=any(deleted_attendance_ids);
 -- Capture exactly the removed associations. Unrelated makeup associations remain intact.
 with removed as (
  delete from public.makeup_links m
  where m.original_attendance_id=any(deleted_attendance_ids)
     or m.makeup_attendance_id=any(deleted_attendance_ids)
  returning to_jsonb(m) snapshot
 ) select coalesce(jsonb_agg(snapshot),'[]'::jsonb) into removed_makeup_links from removed;
 delete from public.attendance_logs where legacy_key in(select value#>>'{}' from jsonb_array_elements(coalesce(payload->'deletes','[]'::jsonb))) and legacy_key like ('intranet|'||period_key_value||'|%');
 insert into public.import_batches(id,source,source_file,source_hash,imported_by,row_count,status,metadata)
 values(batch,'intranet','intranet-v1',request_key,actor_value,jsonb_array_length(payload->'rows'),'pending',jsonb_build_object('periodKey',period_key_value,'revision',revision_value,
 'sourceFormat','intranet','sourceDates',(select coalesce(jsonb_agg(d order by d),'[]'::jsonb) from (select distinct value->>'class_date' d from jsonb_array_elements((payload->'rows') || deleted_rows)) dates),
 'accessRowsSnapshot',(select coalesce(jsonb_agg(value - 'raw_row' - 'raw_student'),'[]'::jsonb) from jsonb_array_elements(payload->'rows')),
 'deletedRowsSnapshot',deleted_rows,'snapshotFormatVersion',1));
 for item in select value from jsonb_array_elements(payload->'rows') loop
  insert into public.attendance_logs(legacy_key,class_date,display_date,category,subject,lesson_type,student_name,student_school,student_grade,teacher_name,status,campus,start_time_text,end_time_text,hours,note,raw_student,raw_row,import_batch_id)
  values(item->>'legacy_key',(item->>'class_date')::date,item->>'display_date',item->>'category',item->>'subject',item->>'lesson_type',item->>'student_name',item->>'student_school',item->>'student_grade',item->>'teacher_name',item->>'status',item->>'campus',item->>'start_time_text',item->>'end_time_text',(item->>'hours')::numeric,item->>'note',item->>'raw_student',item->'raw_row',batch)
  on conflict(legacy_key) do update set class_date=excluded.class_date,display_date=excluded.display_date,category=excluded.category,subject=excluded.subject,lesson_type=excluded.lesson_type,student_name=excluded.student_name,student_school=excluded.student_school,student_grade=excluded.student_grade,teacher_name=excluded.teacher_name,status=excluded.status,campus=excluded.campus,start_time_text=excluded.start_time_text,end_time_text=excluded.end_time_text,hours=excluded.hours,note=excluded.note,raw_student=excluded.raw_student,raw_row=excluded.raw_row,import_batch_id=excluded.import_batch_id;
 end loop;
 select array_agg(distinct m) into month_values from (select unnest(month_values) m union select left(value->>'class_date',7) from jsonb_array_elements(payload->'rows')) months;
 delete from public.teacher_hours_monthly_summaries where month_key=any(month_values);
 delete from public.student_stats_monthly_snapshots where month_key=any(month_values);
 update public.import_batches set status='completed' where id=batch;
 insert into public.audit_events(actor,event_type,entity_table,entity_id,after_data) values(actor_value,'intranet_hours_publish','import_batches',batch,jsonb_build_object('requestId',request_key,'revision',revision_value,'deletedAttendanceIds',coalesce(to_jsonb(deleted_attendance_ids),'[]'::jsonb),'removedMakeupLinks',removed_makeup_links));
 result:=jsonb_build_object('success',true,'protocolVersion',2,'batchId',batch,'rowCount',jsonb_array_length(payload->'rows'),'deletedCount',jsonb_array_length(coalesce(payload->'deletes','[]'::jsonb)),'revision',revision_value);
 insert into public.intranet_hour_operations(request_id,period_key,revision,actor_uid,response) values(request_key,period_key_value,revision_value,actor_value,result);
 return result;
end; $$;
revoke all on function public.intranet_apply_hours_v2(jsonb) from public,anon,authenticated;
grant execute on function public.intranet_apply_hours_v2(jsonb) to service_role;
commit;
