-- Direct administrator writes. No table write grants and no service key in the browser.
begin;
create or replace function public.portal_student_admin_write(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text := btrim(coalesce(payload->>'recordKey',''));
  s jsonb := coalesce(payload->'snapshot','{}'::jsonb);
  actor text := auth.jwt()->>'sub';
  result jsonb;
  student text;
  student_key_value text;
  subject_group_value text;
  subject_name_value text;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if coalesce(auth.jwt()->>'iss','') <> 'https://securetoken.google.com/fir-lms-prod'
    or coalesce(auth.jwt()->>'aud','') <> 'fir-lms-prod'
    or coalesce(auth.jwt()->>'role','') <> 'authenticated'
    or not coalesce(private.portal_can_read_all_student_stats(),false) then
    raise exception '관리자 권한이 필요합니다.' using errcode='42501';
  end if;
  if jsonb_typeof(payload) <> 'object' or octet_length(payload::text) > 65536 then
    raise exception '저장할 내용을 확인해 주세요.' using errcode='22023';
  end if;
  if action in ('saveTeacherStudentFlowExclusion','restoreTeacherStudentFlowExclusion','saveStudentStopDashboardRecord','deleteStudentStopDashboardRecord') then
    if k = '' or length(k)>1000 or jsonb_typeof(s)<>'object' then raise exception '기록 키 또는 내용이 올바르지 않습니다.' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(k, 713));
    if action = 'saveTeacherStudentFlowExclusion' then
      insert into public.teacher_student_flow_exclusions(record_key,student_name,subject_group,owner_teacher,target_teacher,current_teacher,status,latest_date,days_since,reason,snapshot,created_by,restored_at)
      values(k,coalesce(s->>'student',''),coalesce(s->>'latestSubject',''),coalesce(s->>'ownerTeacher',''),coalesce(s->>'targetTeacher',''),coalesce(s->>'currentTeacher',''),coalesce(s->>'status',''),nullif(s->>'latestDateKey','')::date,greatest(0,coalesce(nullif(s->>'daysSince','')::integer,0)),coalesce(nullif(btrim(payload->>'reason'),''),'사유 미기재'),s,actor,null)
      on conflict(record_key) do update set student_name=excluded.student_name,subject_group=excluded.subject_group,owner_teacher=excluded.owner_teacher,target_teacher=excluded.target_teacher,current_teacher=excluded.current_teacher,status=excluded.status,latest_date=excluded.latest_date,days_since=excluded.days_since,reason=excluded.reason,snapshot=excluded.snapshot,created_by=excluded.created_by,restored_at=null
      returning to_jsonb(teacher_student_flow_exclusions.*) into result;
    elsif action = 'restoreTeacherStudentFlowExclusion' then
      update public.teacher_student_flow_exclusions set restored_at=now() where record_key=k returning to_jsonb(teacher_student_flow_exclusions.*) into result;
    elsif action = 'saveStudentStopDashboardRecord' then
      student := btrim(coalesce(payload->>'student',s->>'student',''));
      if student='' then raise exception '학생명이 없습니다.' using errcode='22023'; end if;
      insert into public.student_stop_dashboard_records(record_key,source,student_name,school,grade,subject_group,teacher_name,latest_date,stopped_date,reason,snapshot,created_by,deleted_at)
      values(k,coalesce(nullif(payload->>'source',''),s->>'source',case when k like 'manual|%' then 'manual' else 'auto' end),student,coalesce(payload->>'school',s->>'school',''),coalesce(payload->>'grade',s->>'grade',''),coalesce(payload->>'subject',s->>'subject',s->>'latestSubject',''),coalesce(payload->>'teacher',s->>'teacher',s->>'currentTeacher',s->>'ownerTeacher',''),nullif(coalesce(payload->>'latestDateKey',s->>'latestDateKey'),'')::date,nullif(coalesce(payload->>'stoppedDateKey',s->>'stoppedDateKey',s->>'latestDateKey'),'')::date,coalesce(payload->>'reason',''),s,actor,null)
      on conflict(record_key) do update set source=excluded.source,student_name=excluded.student_name,school=excluded.school,grade=excluded.grade,subject_group=excluded.subject_group,teacher_name=excluded.teacher_name,latest_date=excluded.latest_date,stopped_date=excluded.stopped_date,reason=excluded.reason,snapshot=excluded.snapshot,created_by=excluded.created_by,deleted_at=null
      returning to_jsonb(student_stop_dashboard_records.*) into result;
    else
      update public.student_stop_dashboard_records set deleted_at=now() where record_key=k returning to_jsonb(student_stop_dashboard_records.*) into result;
    end if;
    return jsonb_build_object('success',true,'row',result,'storage','supabase');
  elsif action in ('saveStudentSubjectCatalogItem','saveStudentSubjectChoices') then
    subject_group_value := btrim(coalesce(payload->>'subjectGroup',payload->>'group','기타'));
    if subject_group_value='과탐' then subject_group_value:='과학'; end if;
    if subject_group_value='사탐' then subject_group_value:='사회'; end if;
    if subject_group_value not in ('국어','영어','수학','과학','사회','기타') then raise exception '과목 분류가 올바르지 않습니다.' using errcode='22023'; end if;
    if action='saveStudentSubjectCatalogItem' then
      subject_name_value := btrim(coalesce(payload->>'subjectName',payload->>'subject',''));
      if subject_name_value='' or length(subject_name_value)>100 then raise exception '세부과목명을 확인해 주세요.' using errcode='22023'; end if;
      insert into public.student_subject_catalog(subject_group,subject_name,active,created_by)
      values(subject_group_value,subject_name_value,true,actor)
      on conflict(subject_group,subject_name) do update set active=true;
    else
      student := btrim(coalesce(payload->>'studentName',''));
      student_key_value := lower(regexp_replace(normalize(student,NFKC),'\s','','g'));
      if student_key_value='' or jsonb_typeof(payload->'subjects') is distinct from 'array' or jsonb_array_length(payload->'subjects')>100 then raise exception '학생과 선택과목을 확인해 주세요.' using errcode='22023'; end if;
      if exists(select 1 from jsonb_array_elements(payload->'subjects') v where jsonb_typeof(v)<>'string' or length(v#>>'{}')>100) then raise exception '선택과목 형식이 올바르지 않습니다.' using errcode='22023'; end if;
      perform pg_advisory_xact_lock(hashtextextended(student_key_value||'|'||subject_group_value,714));
      update public.student_subject_choices set active=false,effective_to=today where student_key=student_key_value and subject_group=subject_group_value and active;
      insert into public.student_subject_choices(student_name,student_key,school,grade,subject_group,subject_name,term_label,effective_from,active,created_by)
      select student,student_key_value,coalesce(payload->>'school',''),coalesce(payload->>'grade',''),subject_group_value,btrim(v),coalesce(payload->>'termLabel',''),today,true,actor
      from (select distinct value as v from jsonb_array_elements_text(payload->'subjects')) names where btrim(v)<>'';
    end if;
    return jsonb_build_object('success',true,'storage','supabase',
      'catalog',(select coalesce(jsonb_agg(to_jsonb(c) order by subject_group,sort_order,subject_name),'[]'::jsonb) from public.student_subject_catalog c where active),
      'choices',(select coalesce(jsonb_agg(to_jsonb(c) order by created_at desc),'[]'::jsonb) from public.student_subject_choices c where student_key=student_key_value));
  end if;
  raise exception '지원하지 않는 저장 요청입니다.' using errcode='22023';
end;
$$;
revoke all on function public.portal_student_admin_write(text,jsonb) from public, anon;
grant execute on function public.portal_student_admin_write(text,jsonb) to authenticated;
commit;
