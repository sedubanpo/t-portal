-- Fast stopped-student dashboard snapshot for the teacher portal.

create index if not exists attendance_logs_stop_dashboard_date_idx
  on public.attendance_logs (class_date desc);

create index if not exists attendance_logs_stop_dashboard_student_date_idx
  on public.attendance_logs (student_name, class_date desc);

create index if not exists attendance_logs_stop_dashboard_teacher_date_idx
  on public.attendance_logs (teacher_name, class_date desc);

create or replace function public.student_stop_clean_name(value text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      split_part(regexp_replace(coalesce(value, ''), '^/+|/+$', '', 'g'), '/', 1),
      '^1:1[[:space:]]*',
      '',
      'i'
    )
  );
$$;

create or replace function public.student_stop_teacher_name(value text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(regexp_replace(coalesce(value, ''), '[[:space:]]*T$', '', 'i'), '[[:space:]]+', '', 'g'));
$$;

create or replace function public.student_stop_subject_group(category text, subject text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(subject, '') in ('국어', '영어', '수학', '과탐', '사탐') then subject
    when coalesce(subject, '') in ('과학') then '과탐'
    when coalesce(subject, '') in ('사회') then '사탐'
    when coalesce(category, '') || ' ' || coalesce(subject, '') ~ '(국어|문학|독서|언매|화작)' then '국어'
    when coalesce(category, '') || ' ' || coalesce(subject, '') ~ '(영어)' then '영어'
    when coalesce(category, '') || ' ' || coalesce(subject, '') ~ '(수학)' then '수학'
    when coalesce(category, '') || ' ' || coalesce(subject, '') ~ '(사탐|사회|사문|통사|통합사회|생윤|윤사|윤리|경제|정법|법정|정치와법|한지|한국지리|세지|세계지리|동사|세계사|역사|한국사|지리)' then '사탐'
    when coalesce(category, '') || ' ' || coalesce(subject, '') ~ '(과탐|과학|생명|생물|물리|화학|지구과학|지학|지구|통합과학|통과)' then '과탐'
    else '기타'
  end;
$$;

create or replace function public.get_student_stop_dashboard_snapshot(p_limit integer default 3000)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with config as (
  select greatest(100, least(coalesce(p_limit, 3000), 5000)) as row_limit
),
activity_base as (
  select
    al.id,
    al.class_date::date as class_date,
    public.student_stop_clean_name(coalesce(al.student_name, al.raw_student, '')) as student_name,
    btrim(coalesce(al.student_school, '')) as school,
    btrim(coalesce(al.student_grade, '')) as grade,
    public.student_stop_subject_group(al.category, al.subject) as subject_group,
    public.student_stop_teacher_name(al.teacher_name) as teacher_name,
    coalesce(al.category, '') as category,
    coalesce(al.campus, '') as campus,
    coalesce(al.start_time_text, '') as start_time_text,
    coalesce(al.end_time_text, '') as end_time_text,
    coalesce(al.status, '') as status,
    al.updated_at
  from public.attendance_logs al
  where al.class_date is not null
    and public.student_stop_clean_name(coalesce(al.student_name, al.raw_student, '')) <> ''
    and public.student_stop_teacher_name(al.teacher_name) <> ''
    and btrim(coalesce(al.status, '')) <> '당일취소'
    and position('삭제' in coalesce(al.status, '')) = 0
),
activity as (
  select distinct on (
    class_date,
    student_name,
    teacher_name,
    start_time_text,
    end_time_text,
    category,
    campus
  ) *
  from activity_base
  order by
    class_date,
    student_name,
    teacher_name,
    start_time_text,
    end_time_text,
    category,
    campus,
    updated_at desc nulls last,
    id desc
),
ctx as (
  select
    greatest(
      (now() at time zone 'Asia/Seoul')::date,
      coalesce(max(class_date), (now() at time zone 'Asia/Seoul')::date)
    ) as reference_date,
    coalesce(max(class_date), (now() at time zone 'Asia/Seoul')::date) as latest_data_date
  from activity
),
recent_activity as (
  select a.*
  from activity a
  cross join ctx
  where a.class_date >= ctx.reference_date - 120
),
latest_ranked as (
  select
    ra.*,
    row_number() over (
      partition by ra.student_name
      order by ra.class_date desc, ra.start_time_text desc, ra.updated_at desc nulls last, ra.id desc
    ) as rn,
    count(*) over (partition by ra.student_name) as lesson_count
  from recent_activity ra
),
latest_by_student as (
  select *
  from latest_ranked
  where rn = 1
),
manual_records as (
  select
    r.record_key,
    'manual'::text as source,
    case
      when greatest(0, (ctx.reference_date - coalesce(r.stopped_date, r.latest_date, ctx.reference_date))::int) >= 28 then 'left'
      else 'stopped'
    end as status,
    public.student_stop_clean_name(r.student_name) as student_name,
    coalesce(nullif(btrim(r.school), ''), '학교 미연결') as school,
    coalesce(nullif(btrim(r.grade), ''), '학년 미연결') as grade,
    coalesce(nullif(btrim(r.subject_group), ''), '기타') as subject_group,
    coalesce(nullif(public.student_stop_teacher_name(r.teacher_name), ''), '강사 미지정') as teacher_name,
    coalesce(r.latest_date, r.stopped_date, ctx.reference_date) as latest_date,
    coalesce(r.stopped_date, r.latest_date, ctx.reference_date) as stopped_date,
    greatest(0, (ctx.reference_date - coalesce(r.stopped_date, r.latest_date, ctx.reference_date))::int) as days_since,
    coalesce(r.reason, '') as reason,
    0::bigint as lesson_count,
    r.created_at,
    r.updated_at
  from public.student_stop_dashboard_records r
  cross join ctx
  left join latest_by_student lbs
    on lbs.student_name = public.student_stop_clean_name(r.student_name)
  where r.deleted_at is null
    and (r.source = 'manual' or r.record_key like 'manual|%')
    and public.student_stop_clean_name(r.student_name) <> ''
    and (
      lbs.class_date is null
      or lbs.class_date <= coalesce(r.stopped_date, r.latest_date, ctx.reference_date)
    )
),
auto_candidates as (
  select
    'auto|' || lbs.student_name || '|' || lbs.subject_group || '|' || lbs.teacher_name || '|' || lbs.teacher_name as record_key,
    'auto'::text as source,
    case when (ctx.reference_date - lbs.class_date)::int >= 28 then 'left' else 'stopped' end as status,
    lbs.student_name,
    coalesce(nullif(lbs.school, ''), '학교 미연결') as school,
    coalesce(nullif(lbs.grade, ''), '학년 미연결') as grade,
    coalesce(nullif(lbs.subject_group, ''), '기타') as subject_group,
    coalesce(nullif(lbs.teacher_name, ''), '강사 미지정') as teacher_name,
    lbs.class_date as latest_date,
    lbs.class_date as stopped_date,
    (ctx.reference_date - lbs.class_date)::int as days_since,
    coalesce(saved.reason, '') as reason,
    lbs.lesson_count,
    saved.created_at,
    saved.updated_at
  from latest_by_student lbs
  cross join ctx
  left join public.student_stop_dashboard_records saved
    on saved.record_key = 'auto|' || lbs.student_name || '|' || lbs.subject_group || '|' || lbs.teacher_name || '|' || lbs.teacher_name
    and saved.deleted_at is null
  where (ctx.reference_date - lbs.class_date)::int between 14 and 84
    and not exists (
      select 1
      from manual_records mr
      where mr.student_name = lbs.student_name
        and mr.subject_group = lbs.subject_group
    )
),
all_records as (
  select * from auto_candidates
  union all
  select * from manual_records
),
ordered_records as (
  select *
  from all_records
  order by days_since asc, stopped_date desc nulls last, student_name asc
),
limited_records as (
  select *
  from ordered_records
  limit (select row_limit from config)
),
subject_stats as (
  select
    subject_group as name,
    count(*)::int as total,
    count(*) filter (where status = 'stopped')::int as stopped,
    count(*) filter (where status = 'left')::int as left_count,
    count(*) filter (where btrim(coalesce(reason, '')) = '')::int as missing_reason
  from ordered_records
  group by subject_group
),
teacher_stats as (
  select
    teacher_name as name,
    count(*)::int as total,
    count(*) filter (where status = 'stopped')::int as stopped,
    count(*) filter (where status = 'left')::int as left_count,
    count(*) filter (where btrim(coalesce(reason, '')) = '')::int as missing_reason
  from ordered_records
  group by teacher_name
),
student_metas as (
  select *
  from latest_by_student
  order by student_name asc
  limit 5000
)
select jsonb_build_object(
  'source', 'supabase-rpc',
  'referenceDateKey', to_char((select reference_date from ctx), 'YYYY-MM-DD'),
  'latestDataDateKey', to_char((select latest_data_date from ctx), 'YYYY-MM-DD'),
  'generatedAt', now(),
  'totalRecords', (select count(*) from ordered_records),
  'summary', jsonb_build_object(
    'ALL', (select count(*) from ordered_records),
    'stopped', (select count(*) from ordered_records where status = 'stopped'),
    'left', (select count(*) from ordered_records where status = 'left'),
    'manual', (select count(*) from ordered_records where source = 'manual'),
    'missingReason', (select count(*) from ordered_records where btrim(coalesce(reason, '')) = ''),
    'reasoned', (select count(*) from ordered_records where btrim(coalesce(reason, '')) <> '')
  ),
  'records', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'recordKey', record_key,
        'source', source,
        'status', status,
        'student', student_name,
        'school', school,
        'grade', grade,
        'subject', subject_group,
        'teacher', teacher_name,
        'latestDateKey', to_char(latest_date, 'YYYY-MM-DD'),
        'stoppedDateKey', to_char(stopped_date, 'YYYY-MM-DD'),
        'daysSince', days_since,
        'reason', reason,
        'lessonCount', lesson_count,
        'createdAt', created_at,
        'updatedAt', updated_at
      )
      order by days_since asc, stopped_date desc nulls last, student_name asc
    )
    from limited_records
  ), '[]'::jsonb),
  'subjectStats', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', name,
        'total', total,
        'stopped', stopped,
        'left', left_count,
        'missingReason', missing_reason
      )
      order by total desc, name asc
    )
    from subject_stats
  ), '[]'::jsonb),
  'teacherStats', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', name,
        'total', total,
        'stopped', stopped,
        'left', left_count,
        'missingReason', missing_reason
      )
      order by total desc, name asc
    )
    from teacher_stats
  ), '[]'::jsonb),
  'studentMetas', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'student', student_name,
        'school', coalesce(nullif(school, ''), '학교 미연결'),
        'grade', coalesce(nullif(grade, ''), '학년 미연결'),
        'subject', coalesce(nullif(subject_group, ''), '기타'),
        'teacher', coalesce(nullif(teacher_name, ''), ''),
        'latestDateKey', to_char(class_date, 'YYYY-MM-DD')
      )
      order by student_name asc
    )
    from student_metas
  ), '[]'::jsonb)
);
$$;
