begin;
create or replace function private.portal_hours_history_projection(r jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select case when r is null or r='null'::jsonb then null else jsonb_build_object(
 'class_date',r->>'class_date','student_name',r->>'student_name','teacher_name',r->>'teacher_name',
 'subject',r->>'subject','category',r->>'category','lesson_type',r->>'lesson_type',
 'status',r->>'status','start_time_text',r->>'start_time_text','end_time_text',r->>'end_time_text','hours',r->'hours') end;
$$;
revoke all on function private.portal_hours_history_projection(jsonb) from public,anon;

create or replace function public.portal_get_hours_history(payload jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare teacher text:=btrim(coalesce(payload->>'teacherName','')); start_date date;
 end_date date; page_offset integer:=greatest(0,coalesce((payload->>'offset')::integer,0)); result jsonb;
begin
 perform private.portal_require_authenticated_identity();
 if teacher='' or coalesce(payload->>'monthKey','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Invalid history scope'; end if;
 if not (private.portal_can_access_teacher(private.portal_teacher_id_by_name(teacher),teacher) or private.portal_staff_read_access()) then
   raise insufficient_privilege using message='Teacher history scope denied';
 end if;
 start_date:=((payload->>'monthKey')||'-01')::date; end_date:=(start_date+interval '1 month')::date;
 with snapshots as (
   select b.id,b.imported_at,b.imported_by,x->>'legacy_key' row_key,false deleted,
     private.portal_hours_history_projection(x) row_data
   from public.import_batches b cross join lateral jsonb_array_elements(coalesce(b.metadata->'accessRowsSnapshot','[]')) x
   where b.source='intranet' and b.status='completed'
   union all
   select b.id,b.imported_at,b.imported_by,x->>'legacy_key',true,private.portal_hours_history_projection(x)
   from public.import_batches b cross join lateral jsonb_array_elements(coalesce(b.metadata->'deletedRowsSnapshot','[]')) x
   where b.source='intranet' and b.status='completed'
 ), ordered as (
   select *,lag(case when deleted then null else row_data end) over(partition by row_key order by imported_at,id,deleted desc) previous_data
   from snapshots where row_key is not null
 ), changes as (
   select *,case when deleted then row_data else previous_data end before_data,
     case when deleted then null else row_data end after_data
   from ordered
   where deleted or row_data is distinct from previous_data
 ), scoped as (
   select id,imported_at,imported_by,row_key,
     case when private.portal_normalize_teacher_name(before_data->>'teacher_name')=private.portal_normalize_teacher_name(teacher) then before_data end before_data,
     case when private.portal_normalize_teacher_name(after_data->>'teacher_name')=private.portal_normalize_teacher_name(teacher) then after_data end after_data
   from changes
   where (private.portal_normalize_teacher_name(before_data->>'teacher_name')=private.portal_normalize_teacher_name(teacher)
       and (before_data->>'class_date')::date>=start_date and (before_data->>'class_date')::date<end_date)
      or (private.portal_normalize_teacher_name(after_data->>'teacher_name')=private.portal_normalize_teacher_name(teacher)
       and (after_data->>'class_date')::date>=start_date and (after_data->>'class_date')::date<end_date)
 ), page_rows as (
   select s.*,coalesce(nullif(p.teacher_name,''),case when s.imported_by ~ '^[가-힣 ]{2,20}$' then s.imported_by end,'담당자 정보 없음') actor_name
   from scoped s left join public.portal_identities p on p.firebase_uid=s.imported_by
   order by s.imported_at desc,s.id desc,s.row_key limit 100 offset page_offset
 )
 select jsonb_build_object('success',true,'total',(select count(*) from scoped),'offset',page_offset,'limit',100,
   'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id::text||':'||md5(row_key),'changedAt',imported_at,'actor',actor_name,'actorKey',md5(imported_by),
   'kind',case when after_data is null then 'removed' when before_data is null then 'published' else 'changed' end,
   'before',before_data,'after',after_data) order by imported_at desc,id desc,row_key) from page_rows),'[]'::jsonb),
   'coverage','저장된 인트라넷 반영 기록 기준 · 최초 기록 이전의 변경은 복원하지 않습니다.') into result;
 return result;
end $$;
revoke all on function public.portal_get_hours_history(jsonb) from public,anon;
grant execute on function public.portal_get_hours_history(jsonb) to authenticated;
commit;
