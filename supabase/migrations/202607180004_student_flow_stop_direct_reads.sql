-- Firebase-authenticated direct dashboard reads for movement and stopped students.

create or replace function public.portal_get_student_stop_dashboard(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(100, least(coalesce(nullif(payload ->> 'limit', '')::integer, 3000), 5000));
  v_result jsonb;
begin
  if coalesce(auth.jwt() ->> 'iss', '') <> 'https://securetoken.google.com/fir-lms-prod'
     or coalesce(auth.jwt() ->> 'aud', '') <> 'fir-lms-prod'
     or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or not private.portal_can_read_all_student_stats() then
    raise insufficient_privilege using message = 'Portal administrator scope required';
  end if;
  v_result := public.get_student_stop_dashboard_snapshot(v_limit);
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('success', true, 'source', 'supabase-direct-rpc');
end;
$$;

revoke all on function public.get_student_stop_dashboard_snapshot(integer) from public, anon, authenticated;
revoke all on function public.portal_get_student_stop_dashboard(jsonb) from public, anon;
grant execute on function public.portal_get_student_stop_dashboard(jsonb) to authenticated;

create or replace function public.portal_get_teacher_student_flow_dashboard(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'iss', '') <> 'https://securetoken.google.com/fir-lms-prod'
     or coalesce(auth.jwt() ->> 'aud', '') <> 'fir-lms-prod'
     or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or not private.portal_can_read_all_student_stats() then
    raise insufficient_privilege using message = 'Portal administrator scope required';
  end if;
  return (with activity_base as (
  select a.id, a.class_date::date as class_date,
    public.student_stop_clean_name(coalesce(a.student_name, a.raw_student, '')) as student_name,
    coalesce(nullif(btrim(a.student_school), ''), '학교 미연결') as school,
    coalesce(nullif(btrim(a.student_grade), ''), '학년 미연결') as grade,
    public.student_stop_subject_group(a.category, a.subject) as subject_group,
    public.student_stop_teacher_name(a.teacher_name) as teacher_name,
    coalesce(a.start_time_text, '') as start_time_text,
    coalesce(a.end_time_text, '') as end_time_text,
    coalesce(a.category, '') as category,
    coalesce(a.campus, '') as campus,
    a.updated_at
  from public.attendance_logs a
  where a.class_date >= ((now() at time zone 'Asia/Seoul')::date - 120)
    and public.student_stop_clean_name(coalesce(a.student_name, a.raw_student, '')) <> ''
    and public.student_stop_teacher_name(a.teacher_name) <> ''
    and btrim(coalesce(a.status, '')) <> '당일취소'
    and position('삭제' in coalesce(a.status, '')) = 0
), activity as (
  select distinct on (class_date, student_name, teacher_name, start_time_text, end_time_text, category, campus) *
  from activity_base
  order by class_date, student_name, teacher_name, start_time_text, end_time_text, category, campus, updated_at desc nulls last, id desc
), ctx as (
  select greatest((now() at time zone 'Asia/Seoul')::date, coalesce(max(class_date), (now() at time zone 'Asia/Seoul')::date)) as reference_date,
    coalesce(max(class_date), (now() at time zone 'Asia/Seoul')::date) as latest_data_date
  from activity
), recent as (
  select a.* from activity a, ctx where a.class_date >= ctx.reference_date - 84
), marked as (
  select r.*, case when lag(teacher_name) over (partition by student_name, subject_group order by class_date, start_time_text, id) is distinct from teacher_name then 1 else 0 end as segment_start
  from recent r
), numbered as (
  select m.*, sum(segment_start) over (partition by student_name, subject_group order by class_date, start_time_text, id rows unbounded preceding) as segment_no
  from marked m
), segments as (
  select student_name, subject_group, segment_no, teacher_name,
    min(class_date) as start_date, max(class_date) as end_date,
    (array_agg(school order by class_date desc, start_time_text desc))[1] as school,
    (array_agg(grade order by class_date desc, start_time_text desc))[1] as grade,
    count(*)::integer as segment_lessons
  from numbered group by student_name, subject_group, segment_no, teacher_name
), ranked as (
  select s.*, row_number() over (partition by student_name, subject_group order by segment_no desc) as reverse_rank,
    sum(segment_lessons) over (partition by student_name, subject_group)::integer as lesson_count
  from segments s
), latest as (
  select l.*,
    p.teacher_name as previous_teacher, p.segment_no as previous_segment_no,
    exists(select 1 from segments x where x.student_name=l.student_name and x.subject_group=l.subject_group and x.segment_no<l.segment_no and x.teacher_name=l.teacher_name) as latest_rotated,
    exists(select 1 from segments x where p.teacher_name is not null and x.student_name=l.student_name and x.subject_group=l.subject_group and x.segment_no<p.segment_no and x.teacher_name=p.teacher_name) as previous_rotated
  from ranked l
  left join ranked p on p.student_name=l.student_name and p.subject_group=l.subject_group and p.reverse_rank=2
  where l.reverse_rank=1
), automatic as (
  select
    case when previous_teacher is not null and previous_teacher<>teacher_name and not latest_rotated and not previous_rotated and (ctx.reference_date-end_date)::int<=14 then 'switched'
      when (ctx.reference_date-end_date)::int>=28 then 'left'
      when (ctx.reference_date-end_date)::int>=14 then 'stopped' else 'active' end as status,
    case when previous_teacher is not null and previous_teacher<>teacher_name and not latest_rotated and not previous_rotated and (ctx.reference_date-end_date)::int<=14 then previous_teacher else teacher_name end as owner_teacher,
    teacher_name as target_teacher, teacher_name as current_teacher, student_name, school, grade, end_date as latest_date,
    greatest(0,(ctx.reference_date-end_date)::int) as days_since, subject_group, lesson_count,
    case when previous_teacher is not null and previous_teacher<>teacher_name and not latest_rotated and not previous_rotated and (ctx.reference_date-end_date)::int<=14 then previous_teacher || ' → ' || teacher_name
      else teacher_name || ' 수업 이후 ' || greatest(0,(ctx.reference_date-end_date)::int)::text || '일 미진행' end as change_text
  from latest, ctx
), manual as (
  select case when (ctx.reference_date-coalesce(r.stopped_date,r.latest_date,ctx.reference_date))::int>=28 then 'left' else 'stopped' end as status,
    coalesce(nullif(public.student_stop_teacher_name(r.teacher_name),''),'강사 미지정') as owner_teacher,
    coalesce(nullif(public.student_stop_teacher_name(r.teacher_name),''),'강사 미지정') as target_teacher,
    coalesce(nullif(public.student_stop_teacher_name(r.teacher_name),''),'강사 미지정') as current_teacher,
    public.student_stop_clean_name(r.student_name) as student_name,
    coalesce(nullif(btrim(r.school),''),'학교 미연결') as school,
    coalesce(nullif(btrim(r.grade),''),'학년 미연결') as grade,
    coalesce(r.latest_date,r.stopped_date,ctx.reference_date) as latest_date,
    greatest(0,(ctx.reference_date-coalesce(r.stopped_date,r.latest_date,ctx.reference_date))::int) as days_since,
    coalesce(nullif(btrim(r.subject_group),''),'기타') as subject_group, 0::integer as lesson_count,
    coalesce(nullif(btrim(r.reason),''),'수동 등록 중지생') as change_text
  from public.student_stop_dashboard_records r, ctx
  where r.deleted_at is null and (r.source='manual' or r.record_key like 'manual|%')
), combined as (
  select * from automatic a where a.status<>'active' and not exists (
    select 1 from manual m where m.student_name=a.student_name and m.subject_group=a.subject_group
  ) union all select * from manual
), records as (
  select *, student_name || '|' || subject_group || '|' || owner_teacher || '|' || target_teacher as record_key from combined
)
select jsonb_build_object(
  'success', true, 'source', 'supabase-direct-rpc',
  'referenceDateKey', to_char((select reference_date from ctx),'YYYY-MM-DD'),
  'latestDataDateKey', to_char((select latest_data_date from ctx),'YYYY-MM-DD'),
  'records', coalesce((select jsonb_agg(jsonb_build_object(
    'recordKey',record_key,'status',status,'ownerTeacher',owner_teacher,'targetTeacher',target_teacher,'currentTeacher',current_teacher,
    'student',student_name,'school',school,'grade',grade,'latestDateKey',to_char(latest_date,'YYYY-MM-DD'),'daysSince',days_since,
    'latestSubject',subject_group,'changeText',change_text,'lessonCount',lesson_count
  ) order by days_since desc, owner_teacher, student_name) from records),'[]'::jsonb)
));
end;
$$;

revoke all on function public.portal_get_teacher_student_flow_dashboard(jsonb) from public, anon;
grant execute on function public.portal_get_teacher_student_flow_dashboard(jsonb) to authenticated;

revoke all on public.teacher_student_flow_exclusions from anon, authenticated;
grant select on public.teacher_student_flow_exclusions to authenticated;
drop policy if exists teacher_student_flow_exclusions_firebase_admin_select on public.teacher_student_flow_exclusions;
create policy teacher_student_flow_exclusions_firebase_admin_select on public.teacher_student_flow_exclusions
for select to authenticated using (private.portal_can_read_all_student_stats());
