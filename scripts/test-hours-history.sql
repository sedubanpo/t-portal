begin;
select set_config('test.teacher', (select jsonb_build_object('uid',firebase_uid,'name',teacher_name)::text from public.portal_identities where active and role='teacher' and not all_teacher_access and teacher_name not in ('안종성','김이천','에스에듀') and teacher_id is not null limit 1),true);
set local role authenticated;
do $$
declare claims jsonb; result jsonb; denied boolean:=false;
begin
 claims:=jsonb_build_object('sub','teacher_01086262428','iss','https://securetoken.google.com/fir-lms-prod','aud','fir-lms-prod','role','authenticated','portalStaffReadUntil',extract(epoch from now())::bigint+600);
 perform set_config('request.jwt.claims',claims::text,true);
 result:=public.portal_get_hours_history('{"teacherName":"김이천","monthKey":"2026-09"}');
 if (result->>'total')::integer<1 then raise exception 'Expected published history'; end if;
 if exists(select 1 from jsonb_array_elements(result->'rows') r where coalesce(r->'before'->>'teacher_name','김이천')!='김이천' or coalesce(r->'after'->>'teacher_name','김이천')!='김이천') then raise exception 'Other teacher history leak'; end if;
 if exists(select 1 from jsonb_array_elements(result->'rows') r where r->'before' ? 'note' or r->'after' ? 'note') then raise exception 'Private note leak'; end if;
 perform set_config('request.jwt.claims',(claims-'portalStaffReadUntil')::text,true);
 begin perform public.portal_get_hours_history('{"teacherName":"김이천","monthKey":"2026-09"}');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Unscoped history allowed'; end if;
 claims:=jsonb_build_object('sub',current_setting('test.teacher')::jsonb->>'uid','iss','https://securetoken.google.com/fir-lms-prod','aud','fir-lms-prod','role','authenticated');
 perform set_config('request.jwt.claims',claims::text,true);
 result:=public.portal_get_hours_history(jsonb_build_object('teacherName',current_setting('test.teacher')::jsonb->>'name','monthKey','2026-09'));
 if result->>'success'!='true' then raise exception 'Own history rejected'; end if;
 denied:=false;
 begin perform public.portal_get_hours_history('{"teacherName":"김이천","monthKey":"2026-09"}');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Teacher can read another teacher'; end if;
end $$;
rollback;
select 'PASS: scoped STAFF history, no other-teacher/note leak, missing claim denied' result;
